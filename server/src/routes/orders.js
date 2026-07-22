// Orders API. Permissions enforced in code (your backend replaces Supabase RLS):
//   • seller  → only their own orders
//   • staff   → all orders
import { q } from '../db.js';
import { hashOf, isPhash } from '../fingerprint.js';
import { isStaff } from '../auth.js';
import { egBroadcast } from '../events.js';
import { notify } from './notifications.js';
import { aiComplete } from './support_ai.js';
import { audit } from '../audit.js';
import { quoteOrder, freezeQuote } from '../pricing.js';
import { moveFunds, balanceOf } from './wallet.js';
import { readAll } from './factory_settings.js';
import { orderCharges, refundOrder } from './order_refunds.js';
import { reserveConsigned, releaseConsigned } from './consignment.js';
import { autoReplenish } from '../replenish.js';
import { storageEnabled, putObject, fromDataUrl, presignGet, publicUrl, designUrlTtlDays } from '../storage.js';
import { emitWebhook } from '../webhooks.js';

/**
 * Tell the order's owner's webhook endpoints that something happened to it.
 *
 * Resolves the seller and the current tracking itself rather than trusting the caller:
 * every emit site would otherwise have to remember to include them, and an order.shipped
 * without a tracking code is the one payload a partner cannot use.
 *
 * Swallows everything. A notification is downstream of work already committed.
 */
function notifyOrderEvent(orderId, event, extra) {
  (async () => {
    const r = await q('select id, seq, seller_id, status, factory_status, carrier, tracking, total, meta from orders where id=$1', [orderId]);
    const o = r.rows[0];
    if (!o || !o.seller_id) return;
    // Why it was refused, when it was. A cancellation with no reason forces the partner
    // to ask a human, which is the thing an API is supposed to remove — and "we can't
    // make this" and "you cancelled it" are the same event to them otherwise.
    const rej = (o.meta && o.meta.rejection) || null;
    emitWebhook(o.seller_id, event, {
      id: o.id, number: o.seq ?? null,
      status: o.factory_status || o.status || null,
      tracking: { carrier: o.carrier || null, code: o.tracking || null },
      total: o.total ?? null,
      ...(rej ? { reason: rej.reason || null, rejected_by: rej.by || 'factory', rejected_at: rej.at || null } : {}),
      ...(extra || {}),
    });
  })().catch(() => {});
}

// ── Stage vocabulary ───────────────────────────────────────────────────────────
// Mirrors normalizeStage in web/lib/factory-status.ts — keep the two in sync. The
// client filters the dropdown so operators aren't shown options that would 403;
// THIS is what actually enforces it.
const PIPELINE = ['in_review', 'awaiting_scan', 'printed', 'working', 'shipped'];
const EXCEPTIONS = ['on_hold', 'flagged', 'backorder', 'cancelled', 'refunded'];
function normalizeStage(s) {
  const v = String(s || '').toLowerCase().trim();
  if (['new', 'draft', 'none', 'pending'].includes(v)) return '';
  if (PIPELINE.includes(v) || EXCEPTIONS.includes(v)) return v;
  if (['approved', 'ready_print', 'in_queue', 'queued', 'prescan'].includes(v)) return 'awaiting_scan';
  if (['scanned', 'label', 'labelled', 'labeled'].includes(v)) return 'printed';
  if (['printing', 'qc', 'production', 'in_production', 'in-prod', 'prepress',
       'packing', 'packed', 'ready', 'finished'].includes(v)) return 'working';
  if (['fulfilled', 'delivered', 'in_transit'].includes(v)) return 'shipped';
  if (['escalated', 'action'].includes(v)) return 'flagged';
  if (['replacement'].includes(v)) return 'backorder';
  return '';
}

// Who may set which stage. The operator's zone ends at the scan, because a stage is a
// claim about PHYSICAL CUSTODY: once the warehouse holds the goods, only they (or
// admin) can report where it is — an operator setting 'working' asserts a fact they
// cannot observe. Two deliberate carve-outs from that rule:
//   • flagged/on_hold are a STOP signal, not a custody claim, so artwork review can
//     pull the andon cord at ANY stage. A design defect often only shows on the
//     printed garment — the blank is sunk by then, but the reprint and reship aren't.
//     A stop neither advances nor rewinds; it parks the item for warehouse/admin.
//   • cancelled/refunded are money calls (admin), backorder is a stock call
//     (warehouse/admin). The operator flags; whoever has the authority resolves.
const OP_ZONE = new Set(['', 'in_review', 'awaiting_scan']);   // normalized
const OP_STOPS = new Set(['flagged', 'on_hold']);
const MONEY_STAGES = new Set(['cancelled', 'refunded']);

// null = allowed; a string = the refusal shown to the user.
export function stageDenial(role, current, target) {
  if (role === 'admin') return null;
  const at = normalizeStage(current), to = normalizeStage(target);
  if (role === 'warehouse') {
    return MONEY_STAGES.has(to) ? 'Cancelling or refunding is an admin decision.' : null;
  }
  if (role === 'operator') {
    if (MONEY_STAGES.has(to)) return 'Cancelling or refunding is an admin decision — flag the order instead.';
    if (to === 'backorder') return 'Backorder is a stock call — warehouse or admin.';
    if (OP_STOPS.has(to)) return null;                        // andon cord: any stage
    // Raising a stop is the operator's; CLEARING one is not — that's the whole point of
    // handing the decision over. (An operator who mis-flags needs warehouse/admin to
    // resume it. Accepted: factory_status is one field, so a stop overwrites the stage
    // it interrupted and there's nothing to resume TO without a human deciding.)
    if (EXCEPTIONS.includes(at)) return 'This item is stopped — warehouse or admin decides what happens next.';
    if (!OP_ZONE.has(at)) return 'The warehouse has this item — only warehouse or admin can change its status now.';
    if (!OP_ZONE.has(to)) return 'Operators can move an item as far as Awaiting scan.';
    // Reverting OUT of in_review un-does a submission the seller was CHARGED for. The
    // charge is idempotent so nothing double-bills, but the order goes back to looking
    // untouched while the money stays taken — and the seller sees it as editable again.
    // Anything that leaves a paid order looking unpaid is warehouse or admin.
    if (at === 'in_review' && (to === '' || to === 'new' || to === 'draft')) {
      return 'This order has been paid for — only warehouse or admin can send it back.';
    }
    return null;
  }
  return 'Your role cannot change production status.';        // designer, and anything new
}

/**
 * Can this order be reported SHIPPED?
 *
 * Ported from warehouse.html's canFinishOrder + the "all items packed" print-queue rule.
 * The old floor worked item-by-item but gated the ORDER on two whole-order facts, and
 * that split is deliberate: production is per item (one line can be printed while another
 * waits), but a parcel is indivisible — you cannot ship half an order.
 *
 *   1. every decorated item has artwork  (order_designs row for its sku)
 *   2. a label exists                    (tracking on the order)
 *
 * An item is "decorated" if it carries a print method. A plain blank with no method needs
 * no artwork, so requiring one would deadlock those orders.
 */
/** Items still missing artwork. Exported because label purchase must apply the same rule
 *  — it writes 'shipped' directly, and would otherwise ship undecorated work. */

/**
 * Auto-push a line's artwork to the Designer board when it enters the design stage —
 * UNLESS we already have what the designer would produce.
 *
 * The point is to save a manual step per line, not to create work. So three things hold
 * a push back, in order of cost:
 *   1. no artwork          — nothing to digitise; an empty card tells a designer nothing
 *   2. already carded      — the line is on the board already
 *   3. a file already exists for this EXACT artwork — someone has digitised it before,
 *      on any order, for any seller, so re-cutting it is paid-for duplicate work
 *
 * Only the exact hash counts here. A perceptual near-match is a suggestion for a human to
 * confirm in the UI; silently skipping a push on a lookalike would leave a real job
 * un-designed and nobody would notice until it failed to ship.
 *
 * Best-effort throughout: this is a convenience on top of a status change, so a failure
 * here must never fail the status change itself.
 */
// Extension for a stored object. Purely cosmetic — the key is a content hash, so this
// only makes a URL recognisable (and lets a CDN/browser guess the type from the path).
// The shareable link for one design row: signed + expiring while a TTL is set, a plain
// public URL when TTL is 0, null for rows that predate storage (inline base64).
function designUrlOf(row) {
  if (!row || !row.storage_key) return null;
  return designUrlTtlDays() > 0 ? presignGet(row.storage_key) : publicUrl(row.storage_key);
}

function extFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  if (m.includes('svg')) return '.svg';
  if (m.includes('pdf')) return '.pdf';
  return '';
}

async function autoPushDesigns(orderId, lineId, sku) {
  const key = lineId ? 'line_id' : 'sku';
  const val = lineId || sku;
  const it = await q(
    `select sku, line_id, name, print_type, img, design_src, color, size
       from order_items where order_id=$1 and ${key}=$2 limit 1`, [orderId, val]
  ).then((r) => r.rows[0]);
  if (!it) return { pushed: false, reason: 'no-item' };

  const design = await q('select data, art_hash from order_designs where order_id=$1 and sku=$2 limit 1',
    [orderId, it.sku]).then((r) => r.rows[0]).catch(() => null);
  const hasArt = !!((design && design.data) || it.design_src);
  if (!hasArt) return { pushed: false, reason: 'no-artwork' };

  const carded = await q(
    `select 1 from design_cards where order_id=$1 and coalesce(sku,'')=coalesce($2,'') limit 1`,
    [orderId, it.sku]).then((r) => r.rows.length > 0).catch(() => false);
  if (carded) return { pushed: false, reason: 'already-on-board' };

  if (design && design.art_hash) {
    const existing = await q(
      `select f.design_id from design_file_data f
         join order_designs d on d.order_id = f.order_id and d.sku = f.sku
        where d.art_hash = $1 and f.order_id <> $2 and f.kind in ('pes','emb') limit 1`,
      [design.art_hash, orderId]).then((r) => r.rows[0]).catch(() => null);
    if (existing) return { pushed: false, reason: 'file-exists', designId: existing.design_id };
  }

  // Cards are NOT auto-sent to the design partner. Sellers generally upload print-ready
  // artwork, so most flat-print jobs need no outsourced design at all — auto-pushing
  // would open, and pay for, a task for every one of them. The partner is an escape
  // hatch for when a file genuinely does need work, so sending is a human decision:
  // the board's "Send to design partner" button.
  const id = Date.now() + Math.floor(Math.random() * 1000);
  const product = [it.color, it.size, it.print_type].filter(Boolean).join(' \u00b7 ');
  // The card thumb is the ARTWORK — the customer's synced upload, or what we placed
  // ourselves. Never the marketplace listing photo: a designer opening a card needs to see
  // what they're digitising, and a photo of the finished product tells them nothing about
  // the file. design_src (a URL) is preferred over the placed data (base64) to keep the row small.
  const thumb = it.design_src || (design && design.data) || null;
  await q(
    `insert into design_cards (id, order_id, sku, title, col, type, product, pay_status, payment, is_emb, thumb, notes)
     values ($1,$2,$3,$4,'incoming',$5,$6,'pending',0,$7,$8,$9)
     on conflict (id) do nothing`,
    [id, orderId, it.sku || null, it.name || it.sku || 'Design', it.print_type || null, product,
     /emb/i.test(it.print_type || ''), thumb,
     JSON.stringify([])]).catch(() => {});
  return { pushed: true, cardId: id };
}

export async function missingArtwork(orderId) {
  const items = await q('select sku, name, print_type from order_items where order_id=$1', [orderId]).then((r) => r.rows);
  const designs = await q('select distinct sku from order_designs where order_id=$1', [orderId])
    .then((r) => new Set(r.rows.map((x) => String(x.sku))))
    .catch(() => new Set());
  return items
    .filter((it) => String(it.print_type || '').trim())
    .filter((it) => !designs.has(String(it.sku || '')))
    .map((it) => it.name || it.sku || 'an item');
}

async function shipBlockers(orderId) {
  const [missing, order] = await Promise.all([
    missingArtwork(orderId),
    q('select tracking from orders where id=$1', [orderId]).then((r) => r.rows[0] || {}),
  ]);
  const blockers = [];
  if (missing.length) blockers.push(`${missing.length} item${missing.length === 1 ? '' : 's'} still ${missing.length === 1 ? 'has' : 'have'} no artwork: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`);
  if (!order.tracking) blockers.push('no shipping label has been bought for this order yet');
  return blockers;
}

// ── The order money loop ───────────────────────────────────────────────────────
// Submitting to production is the charge point: the seller pays the factory to make
// the thing. Cancelling before anyone picks it up reverses that charge in full.
//
// Both sides move through wallet.js's moveFunds (one money mechanism for the whole
// app) and are idempotent on the order id, so a double-click, a retry, or two tabs
// submitting at once can only ever produce ONE charge and ONE refund.
const CHARGE_TYPE = 'order-charge';   // refunds live in order_refunds.js

// Has this order already been charged? Reads the ledger rather than a flag on the
// order — the ledger is the source of truth for money, and a flag could drift from it.
async function chargedAmount(orderId) {
  const r = await q(
    `select coalesce(sum(delta),0) as amt from wallet_ledger where ref=$1 and type=$2`,
    [String(orderId), CHARGE_TYPE + '-in']);      // the factory's credit leg
  return parseFloat(r.rows[0].amt) || 0;
}
// (A refundedAmount() used to live here, matching refunds on the bare order id. Partial
// refunds key on `refund-<id>-<n>`, so it silently under-counted them — and anything
// deciding "how much is left" from an under-count pays out money twice. orderCharges()
// in order_refunds.js is the one reader now.)

// Charge the seller for an order. Returns {ok} or {error, ...} — never throws for an
// expected refusal (short balance, unpriceable line), so the caller can pass the
// message straight to the seller.
async function chargeForSubmit(orderId, sellerId, by, hideMoney = false) {
  if (await chargedAmount(orderId) > 0) return { ok: true, already: true };
  const quote = await quoteOrder(orderId);
  if (quote.unpriced.length) {
    // No catalog match = no cost. Charging 0 would fulfil it free, forever, silently.
    const names = quote.unpriced.map((u) => u.sku).join(', ');
    return { error: `These items aren't in the catalog yet, so they can't be priced: ${names}. Pick a catalog product for them first.`, unpriced: quote.unpriced };
  }
  if (!quote.lines.length) return { error: 'This order has no items to produce.' };
  if (quote.total <= 0) return { error: 'This order prices out at $0 — check the catalog base cost.' };
  const balance = await balanceOf(sellerId);
  if (balance < quote.total) {
    // A team member who can't SEE the wallet mustn't learn its balance from an error
    // message — and telling them to "top up" is a dead end, because only the owner can.
    // They get the fact (it can't go through) and the resolution (the owner funds it),
    // with no figures; the owner gets notified so it doesn't just sit there.
    if (hideMoney) {
      return {
        error: 'This order can\'t be submitted yet — the account needs funding. The account owner has been notified.',
        needsOwnerTopup: true,
      };
    }
    return { error: `Not enough balance. This order costs $${quote.total.toFixed(2)} and your wallet has $${balance.toFixed(2)}.`,
             shortfall: Math.round((quote.total - balance) * 100) / 100, required: quote.total, balance, quote };
  }
  await freezeQuote(orderId, quote);
  await moveFunds({ from: sellerId, to: 'factory', amount: quote.total, type: CHARGE_TYPE,
                    ref: String(orderId), note: `Order ${orderId} pushed to production`, by });
  // Hold any of the seller's OWN consigned stock this order needs, so a second order
  // can't be promised the same units. Best-effort: consignment is an optional service,
  // and a failure here must never block an order that's already been paid for.
  reserveConsigned(orderId).catch(() => {});
  return { ok: true, charged: quote.total, quote };
}

// Reverse the charge when a seller cancels inside their zone. Idempotent: refunding
// twice is a no-op, and an order that was never charged has nothing to give back.
//
// Refunds what is LEFT, not what was charged. Admin/warehouse can now issue partial
// refunds mid-flight (order_refunds.js), so "charged $50" no longer implies "$50 is
// owed back" — a $10 goodwill refund followed by a cancel must return $40, not $50.
// Reading the remainder makes both directions safe: nothing is paid twice, and a
// partly-refunded order still gets its balance back rather than being treated as done.
async function refundForCancel(orderId, sellerId, by) {
  const state = await orderCharges(orderId);
  if (state.charged <= 0) return { ok: true, nothingToRefund: true };
  if (state.refundable <= 0) return { ok: true, already: true };
  // A cancellation returns EVERYTHING still owed — every part, not a figure. Naming an
  // amount here would freeze a total read a moment earlier; `full` is evaluated inside
  // the lock against the balances that are true when the money actually moves.
  const out = await refundOrder({ orderId, full: true, by,
                                  note: `Order ${orderId} cancelled — refund`,
                                  clientId: `cancel-${orderId}` });
  if (out.error) return out;
  // Give the units back. Without this a cancelled order strands the seller's own stock
  // as permanently reserved against work that will never happen.
  releaseConsigned(orderId).catch(() => {});
  return { ok: true, refunded: out.refunded };
}

export function ordersRoutes(app, requireAuth) {
  // Idempotent: ensure the factory_order column exists (also created in etsy.js).
  q('alter table orders add column if not exists factory_order boolean not null default false').catch(() => {});
  // Per-seller display number ("#1, #2 …" for manual orders). The id stays the
  // globally-unique PK; this is just the friendly number the seller sees.
  q('alter table orders add column if not exists seq integer').catch(() => {});
  // Free-form editable order info (notes, priority, gift message, …) kept on the
  // seller's order-detail panel. One jsonb bag so new fields don't need migrations.
  q(`alter table orders add column if not exists meta jsonb default '{}'`).catch(() => {});
  // Classify factory_order by OWNER ROLE, not by id: an Etsy order is factory-owned
  // ONLY when its connection owner is staff (the admin/factory shop). A seller's own
  // Etsy shop → factory_order=false so it shows on their dashboard (seller-managed
  // until pushed). Manual seller orders stay false. Idempotent (only fixes wrong rows).
  q(`update orders set factory_order = (id like 'etsy-%' and exists (select 1 from users u where u.id = orders.seller_id and u.role <> 'seller'))
      where factory_order is distinct from (id like 'etsy-%' and exists (select 1 from users u where u.id = orders.seller_id and u.role <> 'seller'))`).catch(() => {});
  // Composite design position {x,y,w,h} per line item — persisted so the mockup
  // overlay lands in the same spot on every board + the mobile app after a sync.
  // schema.sql already declares it for fresh DBs; this covers older ones.
  q('alter table order_items add column if not exists design_pos jsonb').catch(() => {});
  // Stable per-line id (client-generated) so a line item's design/image/status keys
  // never collide between identical-SKU siblings. Preserved across replaceItems.
  q('alter table order_items add column if not exists line_id text').catch(() => {});
  /**
   * Which design charge this line attracts. One field, three mutually exclusive outcomes:
   *
   *   'standard'  we cut the machine file from the seller's artwork  -> design_fee_standard
   *   'complex'   same, but intricate — quoted and ACCEPTED first    -> design_fee_complex
   *   'supplied'  the seller brought their own machine file          -> check_fee
   *
   * Null means undecided, which is the honest state for a line nobody has looked at yet —
   * defaulting to 'standard' would assert a difficulty judgement no human has made, and
   * that judgement is the difference between a $2 charge and a $15 one.
   *
   * NOTHING IS CHARGED FROM THIS COLUMN YET. It records the decision; the money moves in
   * the quote flow, where the seller sees the number and accepts it. A tier that silently
   * billed on write would make 'complex' a charge nobody agreed to.
   */
  q('alter table order_items add column if not exists design_tier text').catch(() => {});
  q('alter table order_items add column if not exists design_tier_at timestamptz').catch(() => {});
  q('alter table order_items add column if not exists design_tier_by text').catch(() => {});
  /**
   * The complex-work quote, and its FROZEN prices.
   *
   * Frozen because the settings can change between quoting and accepting, and a seller must
   * be charged what they agreed to — not what the number happened to be when they clicked.
   * Same reason order refunds split on the stored unit_cost rather than re-quoting.
   *
   * Only 'complex' needs this. Standard and supplied are ordinary charges a seller already
   * consented to by ordering embroidery; complex is a different, much larger number, and
   * applying it silently is how chargebacks happen.
   */
  q('alter table order_items add column if not exists design_quote_status text').catch(() => {});
  q('alter table order_items add column if not exists design_quote_make numeric(12,2)').catch(() => {});
  q('alter table order_items add column if not exists design_quote_download numeric(12,2)').catch(() => {});
  q('alter table order_items add column if not exists design_quote_at timestamptz').catch(() => {});
  q('alter table order_items add column if not exists design_charged_at timestamptz').catch(() => {});
  // Design uploads live SERVER-side, not in browser localStorage (~5MB, overflows
  // the moment a seller uploads a few images → "Browser storage is full"). One row
  // per (order, item, kind): kind='raster' for png/jpg/etc, 'emb' for stitch files.
  // Chained from the CREATE onward. The ALTERs used to be bare q() calls sitting beside
  // it, and a bare q() takes whatever pool connection is free — so on a fresh database
  // they raced the CREATE, lost, and every failure went into a .catch(() => {}). The
  // result was a live server whose order_designs had only the six original columns, so
  // every POST /api/orders/:id/designs died on `column "storage_key" does not exist`.
  // It self-healed on the next boot (the table existed by then), which is exactly what
  // made it hard to see: broken on fresh deploys only.
  q(`create table if not exists order_designs (
       order_id text not null, sku text not null, kind text not null default 'raster',
       data text, name text, updated_at timestamptz default now(),
       primary key (order_id, sku, kind))`)
    // Placement (%-coords {x,y,w,h,r}) saved by the seller's order customizer — kept
    // here (seller-writable via canSeeOrder) because order_items.design_pos is staff-only.
    .then(() => q('alter table order_designs add column if not exists pos jsonb'))
    // Artwork fingerprints, so "we have already digitised this" is answerable. art_hash is
    // exact and computed here; art_phash is fuzzy and comes from the browser (see
    // fingerprint.js).
    .then(() => q('alter table order_designs add column if not exists art_hash text'))
    .then(() => q('alter table order_designs add column if not exists art_phash text'))
    // Object-storage URL for the artwork. When set, `data` is null — the bytes live in
    // storage, not Postgres. Readers take url ?? data.
    .then(() => q('alter table order_designs add column if not exists storage_key text'))
    .then(() => q('create index if not exists order_designs_art_hash on order_designs (art_hash)'))
    /**
     * LINE IDENTITY. The primary key was (order_id, sku, kind), so two lines of the SAME
     * sku on one order shared ONE design row — attaching artwork to the second silently
     * overwrote the first, and both lines then rendered the same image. A customer buying
     * two of the same hoodie with different personalisation got one of them printed twice.
     *
     * order_items has carried line_id for a while and item status is already keyed on it
     * (see setItemStatus); the design store never learned. This closes that.
     *
     * The key becomes (order_id, coalesce(line_id, sku), kind), so rows that predate the
     * column keep working on sku while new ones key on the line. Safe to create: before the
     * backfill every line_id is null, so coalesce() is exactly the old key and no duplicate
     * can exist.
     */
    .then(() => q('alter table order_designs add column if not exists line_id text'))
    .then(async () => {
      // Backfill ONLY where it is certain: a sku appearing exactly once on its order maps
      // to exactly one line. Where a sku repeats, the row genuinely cannot be attributed —
      // the information was never stored — and guessing would print one line's artwork on
      // its sibling, which is worse than the ambiguity. Those stay null and get surfaced.
      const r = await q(`
        update order_designs d
           set line_id = x.line_id
          from (
            select i.order_id, i.sku, min(i.line_id) as line_id
              from order_items i
             where i.line_id is not null and i.sku is not null
             group by i.order_id, i.sku
            having count(*) = 1
          ) x
         where d.order_id = x.order_id and d.sku = x.sku and d.line_id is null`);
      if (r && r.rowCount) console.log(`[order_designs] backfilled line_id on ${r.rowCount} rows`);
    })
    /**
     * THE KEY SWAP, made independent of everything before it.
     *
     * These two were links in the same long .then() chain, under a single trailing
     * .catch(() => {}). The backfill above sits between them, and if it threw — for any
     * reason, on any deployment — every later step was skipped in silence. The result was
     * not a missing feature: the insert below uses ON CONFLICT against this index, so
     * without it Postgres raises 42P10 and EVERY design save returns 500. A migration that
     * quietly half-applies took artwork uploads down.
     *
     * Now each statement runs on its own and reports its own failure. The old primary key
     * being dropped and the new index existing are separate facts; neither should depend
     * on the other having gone well, and neither should depend on a backfill.
     */
    .then(async () => {
      await q('alter table order_designs drop constraint if exists order_designs_pkey')
        .catch((e) => console.error('[order_designs] could not drop the old primary key:', e.message));
      await q('create unique index if not exists order_designs_line_key on order_designs (order_id, (coalesce(line_id, sku)), kind)')
        .catch((e) => console.error('[order_designs] COULD NOT CREATE order_designs_line_key — design saves will fail with 42P10 until this exists:', e.message));
      // Assert it, loudly. This index is load-bearing for every artwork write, and the
      // failure mode is a 500 on a path nobody tests until a seller uses it.
      const ok = await q("select 1 from pg_indexes where tablename='order_designs' and indexname='order_designs_line_key'")
        .then((r) => r.rowCount).catch(() => 0);
      if (!ok) console.error('[order_designs] order_designs_line_key IS MISSING. Artwork uploads are broken. Create it by hand.');
    })
    .then(async () => {
      // Say out loud how much is left unattributable. Silence here would read as "clean".
      const r = await q(`
        select count(*)::int as n from order_designs d
         where d.line_id is null
           and exists (select 1 from order_items i
                        where i.order_id = d.order_id and i.sku = d.sku
                        group by i.order_id, i.sku having count(*) > 1)`).catch(() => null);
      const n = r && r.rows[0] ? r.rows[0].n : 0;
      if (n) console.warn(`[order_designs] ${n} design rows sit on orders with repeated SKUs and cannot be attributed to a line — see GET /api/orders/designs/ambiguous`);
    })
    .then(async () => {
      // Backfill in bounded batches: without it, every design saved before this feature
      // is invisible to reuse, which is most of them.
      const r = await q('select order_id, sku, kind, data from order_designs where art_hash is null and data is not null limit 1000');
      for (const row of r.rows) {
        const h = hashOf(row.data);
        if (h) await q('update order_designs set art_hash=$1 where order_id=$2 and sku=$3 and kind=$4',
          [h, row.order_id, row.sku, row.kind]).catch(() => {});
      }
    })
    .catch(() => {});
  // What the seller was CHARGED per unit, frozen at submit (see pricing.js). Distinct
  // from unit_price, which is what the BUYER paid. Without freezing, editing a catalog
  // base price would silently rewrite the cost of orders already billed.
  q('alter table order_items add column if not exists unit_cost numeric').catch(() => {});
  // When the shipping label was actually PRINTED. Distinct from having one: a bought
  // label sits in the system until someone puts it on paper, and "we have a label" vs
  // "the label is on the parcel" are different answers to "can this go out?".
  q('alter table orders add column if not exists label_printed_at timestamptz').catch(() => {});
  // When the label was PRE-SCANNED at dispatch (byeastside flips a label NEW → PICKED).
  // Deliberately a timestamp, NOT a pipeline stage: pre-scan starts the carrier/marketplace
  // clock, which is INDEPENDENT of how far the physical work has got — an order can be
  // pre-scanned and still being made, and a stage can only hold one of those facts. It's
  // also per-ORDER (one parcel, one label) while factory_status is per-item.
  // Keeping it separate is what makes "pre-scanned but not shipped" a findable queue.
  q('alter table orders add column if not exists label_scanned_at timestamptz').catch(() => {});
  // Carrier delivery status, kept SEPARATE from factory_status on purpose.
  //
  // factory_status is what WE claim about the order — it drives permissions, the ship
  // gate, who may move what. 'shipped' means we handed the parcel over, and that stays
  // true whatever happens next. Delivery is the CARRIER's claim about the same parcel:
  // a different fact, from a different party, that we don't control.
  //
  // Folding TRANSIT/DELIVERED into factory_status would mean every stage rule
  // (canSetStage, stageDenial, orderStage, the ship gate) suddenly has to reason about
  // states no human sets — and a carrier webhook could move an order behind the floor's
  // back. Two fields, each owned by whoever actually knows.
  q('alter table orders add column if not exists delivery_status text').catch(() => {});
  q('alter table orders add column if not exists delivery_detail text').catch(() => {});
  q('alter table orders add column if not exists delivery_checked_at timestamptz').catch(() => {});
  q('alter table order_items add column if not exists ship_fee numeric').catch(() => {});

  // List
  // ONE order. The detail page used to fetch every order and search it, so an order the
  // list happened to exclude read as "not found" even though it existed. Staff may read
  // any order; a seller only their own.
  app.get('/api/orders/:id', { preHandler: requireAuth }, async (req, reply) => {
    const agg = `coalesce(json_agg(i.* order by i.id) filter (where i.id is not null), '[]') as items`;
    const r = await q(
      `select o.*, ${agg} from orders o left join order_items i on i.order_id = o.id
        where o.id = $1 group by o.id`, [req.params.id]);
    const row = r.rows[0];
    if (!row) { reply.code(404); return { error: 'Order not found' }; }
    if (!isStaff(req.user)) {
      // resolveSeller returns an OBJECT {id, perms, member}. This compared String(sel) —
      // always "[object Object]" — so the check could never pass and every seller got a
      // 404 on their own order. Fail-closed, so nothing leaked, but the real ownership
      // test wasn't running either.
      //
      // 404 (not 403) on all three refusals on purpose: telling a stranger "that exists
      // but isn't yours" confirms the id. Same reason a team member without the `orders`
      // surface gets the same answer as someone asking for an order that doesn't exist.
      const sel = await resolveSeller(req.user);
      const mine = sel && sel.id && String(row.seller_id) === String(sel.id);
      if (!mine || !_canSurface(sel, 'orders') || row.factory_order) {
        reply.code(404); return { error: 'Order not found' };
      }
    }
    return row;
  });

  app.get('/api/orders', { preHandler: requireAuth }, async (req) => {
    const join = `left join order_items i on i.order_id = o.id`;
    // ORDER BY i.id keeps line-item order stable across every board, so the per-line
    // design "slot" (1st vs 2nd same-SKU item) resolves to the same artwork everywhere.
    const agg  = `coalesce(json_agg(i.* order by i.id) filter (where i.id is not null), '[]') as items`;
    if (isStaff(req.user)) {
      // Staff (factory) see factory-OWNED orders (the admin marketplace shops, which
      // need factory setup) PLUS any SELLER order that's been PUSHED to production.
      // A seller order sits at factory_status 'new'/'draft' while the seller is still
      // managing it; Push moves it to 'in_review'. So until Push it stays OFF the
      // factory boards (seller-managed). factory_order rows show regardless of status.
      const r = await q(
        `select o.*, ${agg} from orders o ${join}
         where o.factory_order = true
            or coalesce(o.factory_status, '') not in ('new', 'draft', '')
            -- ...OR the order belongs to a STAFF account, i.e. the factory created it
            -- itself. Without this a manual order made on a factory board was invisible
            -- to the board that made it: factory_order is derived from the id (etsy-%),
            -- so a manual FF-* order can never set it, and a brand-new order is still at
            -- '' / 'new', which the push filter excludes.
            or exists (select 1 from users u where u.id = o.seller_id and u.role <> 'seller')
         group by o.id order by o.created_at desc`);
      return r.rows;
    }
    // Sellers only see their OWN orders, never the admin/factory-synced ones. A team member sees
    // their OWNER's orders (if their permissions include 'orders'); a plain seller sees their own.
    const sel = await resolveSeller(req.user);
    if (!_canSurface(sel, 'orders')) return [];
    const r = await q(
      `select o.*, ${agg} from orders o ${join} where o.seller_id=$1 and o.factory_order=false group by o.id order by o.created_at desc`,
      [sel.id]
    );
    return r.rows;
  });

  // Create / upsert (the seller who creates it owns it)
  app.post('/api/orders', { preHandler: requireAuth }, async (req, reply) => {
    const o = req.body || {};
    if (!o.id) { return { error: 'order id required' }; }
    // Ownership guard: a seller may only create/update THEIR OWN, non-factory
    // orders. Block a crafted id from overwriting another seller's order or
    // un-flagging a factory order into the seller's own view. Staff may upsert any.
    let ownerId = req.user.sub;
    if (!isStaff(req.user)) {
      const sel = await resolveSeller(req.user);   // a team member creates/edits under the OWNER
      if (!_canSurface(sel, 'orders')) { reply.code(403); return { error: 'No access to orders' }; }
      ownerId = sel.id;
      const ex = await q('select seller_id, factory_order from orders where id=$1', [o.id]);
      const row = ex.rows[0];
      if (row && (row.factory_order || row.seller_id !== sel.id)) {
        reply.code(403); return { error: 'Not allowed to modify this order' };
      }
    }
    // This route only ever creates SELLER/staff-made orders — Etsy imports use
    // importReceipt(). So factory_order is always false here (insert AND on
    // conflict), guaranteeing manual orders stay visible to the seller even if a
    // prior run mis-flagged them.
    // `(xmax = 0) as inserted` distinguishes a fresh INSERT from an ON CONFLICT
    // UPDATE — needed so editing an order doesn't re-alert the floor as if it were new.
    const up = await q(
      `insert into orders (id, seller_id, store, source, customer, address, status, factory_status, total, profit, delivery, carrier, tracking, seq, meta, factory_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, false)
       on conflict (id) do update set
         store=excluded.store, customer=excluded.customer, address=excluded.address,
         status=excluded.status, factory_status=excluded.factory_status,
         total=excluded.total, profit=excluded.profit, delivery=excluded.delivery,
         carrier=excluded.carrier, tracking=excluded.tracking,
         seq=coalesce(orders.seq, excluded.seq),
         meta=coalesce(excluded.meta, orders.meta), factory_order=false
       returning (xmax = 0) as inserted`,
      [o.id, ownerId, o.store || null, o.source || 'manual', o.customer || {}, o.address || {},
       o.status || 'new', o.factoryStatus || o.status || 'new', o.total || 0, o.profit || 0,
       o.delivery || null, o.carrier || null, o.tracking || null,
       (o.seq != null && o.seq !== '') ? parseInt(o.seq, 10) : null,
       (o.meta && typeof o.meta === 'object') ? o.meta : {}]
    );
    const isNew = !!(up.rows[0] && up.rows[0].inserted);
    if (Array.isArray(o.items)) await replaceItems(o.id, o.items);
    audit(req, 'order.saved', { entityType: 'order', entityId: o.id, after: { status: o.status, total: o.total, customer: (o.customer && o.customer.name) || null } });
    // Cache-invalidation ping only — NO id/sku in the payload. Broadcasts reach every
    // connected client, so anything identifying here would disclose one seller's order
    // ids + SKUs to every other seller. Receivers re-fetch through their own
    // access-controlled endpoint, which is where scoping belongs.
    egBroadcast({ type: 'orders' });
    // A NEW order is the thing the floor most needs to hear about — and only a new
    // one, so re-saving an order doesn't re-alert everyone.
    if (isNew) {
      const num = o.seq ? `#${o.seq}` : o.id;
      notify({
        roles: ['admin', 'operator', 'warehouse'],
        type: 'order-new',
        title: `New order ${num}`,
        body: [(o.customer && o.customer.name) || null, o.store || o.source || 'manual'].filter(Boolean).join(' · '),
        href: '/operator',
        entityId: o.id,
      });
    }
    return { ok: true, id: o.id };
  });

  // Replace an order's line items wholesale. Carries the factory-chosen blank +
  // its composite image (it.img / it.blank) so a scanned order shows the right
  // mockup on the mobile app — the boards persist these when an operator picks a
  // base blank for a still-"new" item.
  async function replaceItems(orderId, items) {
    // The seller's uploaded LISTING image (it.img) is heavy, and a lean client
    // patch may legitimately omit it (send null) to keep the payload small. Snapshot
    // the existing img per SKU and re-inherit it when an incoming item doesn't carry
    // one — otherwise an edit (e.g. picking a blank, changing qty) wipes the stored
    // picture. That wipe is the root of "the image disappears every time I edit".
    const prev = await q('select sku, img from order_items where order_id=$1', [orderId]);
    const imgBySku = {};
    for (const r of prev.rows) { if (r.sku != null && r.img && !(r.sku in imgBySku)) imgBySku[r.sku] = r.img; }
    await q('delete from order_items where order_id=$1', [orderId]);
    for (const it of items) {
      const img = (it.img != null && it.img !== '') ? it.img : (imgBySku[it.sku] || null);
      const designPos = (it.designPos && typeof it.designPos === 'object') ? JSON.stringify(it.designPos) : null;
      await q(
        `insert into order_items (order_id, sku, name, print_type, qty, color, size, variant, unit_price, design_src, img, blank, design_pos, line_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [orderId, it.sku || null, it.name || null, it.printType || it.tech || null, it.qty || 1,
         it.color || null, it.size || null, it.variant || null, it.unitPrice || 0, it.designSrc || null,
         img, it.blank || null, designPos, it.lineId || null]
      );
    }
  }

  // Patch status/tracking/etc. Staff may also replace the line items (used when a
  // factory board picks a base blank → the chosen mockup must reach mobile scan).
  app.patch('/api/orders/:id', { preHandler: requireAuth }, async (req, reply) => {
    const map = { factoryStatus: 'factory_status', status: 'status', tracking: 'tracking',
                  carrier: 'carrier', total: 'total', timeline: 'timeline', notes: 'notes', meta: 'meta',
                  address: 'address', customer: 'customer' };
    const sets = [], vals = []; let n = 1;
    for (const k in (req.body || {})) if (map[k]) { sets.push(`${map[k]}=$${n++}`); vals.push(req.body[k]); }
    const body = req.body || {};
    const wantsItems = isStaff(req.user) && Array.isArray(body.items);
    if (!sets.length && !wantsItems) return { ok: true };
    // Snapshot the fields we're about to change, so the audit trail shows the
    // BEFORE value (the "my address/status/tracking was changed" inquiry).
    let before = null;
    if (sets.length) {
      const cols = Object.keys(body).filter((k) => map[k]).map((k) => map[k]);
      if (cols.length) {
        const pre = await q(`select ${cols.join(',')} from orders where id=$1`, [req.params.id]);
        before = pre.rows[0] || null;
      }
    }
    // sellers may only patch their own orders; staff any; a team member patches the OWNER's.
    const sel = isStaff(req.user) ? null : await resolveSeller(req.user);
    if (sel && !_canSurface(sel, 'orders')) { reply.code(403); return { error: 'No access to orders' }; }

    // What a SELLER may change on their own order. Ownership was already scoped, but
    // that alone let a seller set ANY production status on their own order — including
    // factory_status='shipped' — or edit the address after the floor had started.
    // Production belongs to the factory; the seller's only status move is cancelling,
    // and only while nobody has picked it up yet.
    let _charged = 0, _refunded = 0;   // reported back so the UI can show the wallet moving
    if (sel) {
      const cur = (await q('select factory_status from orders where id=$1 and seller_id=$2', [req.params.id, sel.id])).rows[0];
      if (!cur) { reply.code(404); return { error: 'Order not found' }; }
      const fs = String(cur.factory_status || '');
      // The seller's own zone. 'in_review' is theirs too: they've submitted (and been
      // charged) but nobody has picked the order up, so cancelling is still safe and
      // fully refundable. Once it's awaiting_scan or beyond, the floor owns it and the
      // only route back is a refund REQUEST the factory approves.
      const SELLER_ZONE = ['', 'new', 'draft', 'in_review'];
      const started = !SELLER_ZONE.includes(fs);
      if (body.tracking !== undefined || body.carrier !== undefined) {
        reply.code(403); return { error: 'Tracking is set by the factory.' };
      }
      if (body.factoryStatus !== undefined || body.status !== undefined) {
        const want = String(body.factoryStatus ?? body.status ?? '');
        // 'in_review' = submit to production (the charge point). 'cancelled' = pull it
        // back. Everything else on the pipeline belongs to the factory.
        const sellerMay = ['cancelled', 'in_review'];
        if (!sellerMay.includes(want)) { reply.code(403); return { error: 'Only the factory can change production status.' }; }
        if (want === 'cancelled' && started) { reply.code(403); return { error: 'This order is already in production — request a refund instead.', locked: true }; }
        if (want === 'in_review' && fs && !['', 'new', 'draft'].includes(fs)) { reply.code(403); return { error: 'This order has already been submitted.' }; }
      }
      if (started && (body.address !== undefined || body.customer !== undefined)) {
        reply.code(403); return { error: 'This order is already in production — its address can no longer be edited here.', locked: true };
      }
      // ── Money. Do this BEFORE the status write, so a refused charge leaves the order
      // exactly where it was. The reverse order would push unfunded work to the floor.
      const want = String(body.factoryStatus ?? body.status ?? '');
      if (want === 'in_review' && ['', 'new', 'draft'].includes(fs)) {
        // A member submitting under the owner: hide the figures unless the owner has
        // shared the wallet with them.
        const seesWallet = !sel.member || (Array.isArray(sel.perms) && sel.perms.indexOf('wallet') >= 0);
        const paid = await chargeForSubmit(req.params.id, sel.id, req.user.sub, !seesWallet);
        if (paid.error) {
          // Tell the OWNER, whoever hit the wall. A member can't top up and can't see the
          // balance, so without this the order simply stops with nobody informed.
          if (paid.needsOwnerTopup || paid.shortfall != null) {
            notify({
              userIds: [String(sel.id)],
              type: 'wallet-low',
              title: 'An order needs funds',
              body: `${req.user.email || 'A team member'} tried to submit order ${req.params.id} but the wallet balance is too low.`,
              href: '/wallet',
              entityId: String(req.params.id),
            });
          }
          reply.code(402); return paid;                          // 402 Payment Required
        }
        _charged = paid.charged || 0;
      }
      if (want === 'cancelled' && !started) {
        const back = await refundForCancel(req.params.id, sel.id, req.user.sub);
        _refunded = back.refunded || 0;
      }
    }
    // Same ship gate as the per-item route. Staff-initiated too: a warehouse marking the
    // whole order shipped is making the identical claim, so it answers to the identical
    // facts. Skipped when tracking arrives in the same patch — that IS the label being
    // recorded (a label purchase writes tracking and 'shipped' together).
    if (isStaff(req.user) && body.tracking === undefined) {
      const want = normalizeStage(String(body.factoryStatus ?? body.status ?? ''));
      if (want === 'shipped') {
        const blockers = await shipBlockers(req.params.id);
        if (blockers.length) { reply.code(409); return { error: `Can't mark shipped — ${blockers.join('; and ')}.`, blockers }; }
      }

      // ── 'Refunded' is a CLAIM ABOUT MONEY, so it has to match the ledger ────────
      // Setting it from the dropdown moved nothing: the money loop only ever ran on the
      // seller's own cancel path, so an admin marking an order Refunded got the word and
      // none of the money. The seller sees "Refunded", their balance never changes, and
      // the only trace is a status nobody can distinguish from a real one.
      //
      // The status doesn't move money either — deliberately. Paying money out of a
      // dropdown is not something that should be one mis-click away; the Refund panel
      // exists so an amount is chosen and recorded. This just refuses to let the label
      // assert something the ledger contradicts.
      if (want === 'refunded') {
        const state = await orderCharges(req.params.id).catch(() => null);
        if (state && state.charged > 0 && state.refunded <= 0) {
          reply.code(409);
          return {
            error: `Nothing has been refunded on this order yet, so it can't be marked Refunded. Use the Refund panel on the order to send money back — the status follows from that.`,
            needsRefund: true, charged: state.charged,
          };
        }
      }

      // Cancelling an order the floor hasn't started gives the money back, exactly as it
      // does when the seller cancels it themselves. Same act, same consequence — the only
      // difference being who clicked, which shouldn't decide whether a seller is repaid.
      if (want === 'cancelled') {
        // Read the CURRENT row rather than the audit snapshot: `before` only holds the
        // columns this request happens to be changing, and is null when none are.
        const row = await q('select seller_id, factory_status from orders where id=$1', [req.params.id])
          .then((r) => r.rows[0]).catch(() => null);
        const cur = normalizeStage(String(row?.factory_status || ''));
        const startedNow = !['', 'in_review'].includes(cur);
        if (row && row.seller_id && !startedNow) {
          await refundForCancel(req.params.id, row.seller_id, req.user.sub).catch(() => {});
        }
      }
    }
    if (sets.length) {
      let where = `id=$${n}`; vals.push(req.params.id);
      if (!isStaff(req.user)) { where += ` and seller_id=$${n + 1}`; vals.push(sel.id); }
      await q(`update orders set ${sets.join(',')} where ${where}`, vals);
    }
    if (wantsItems) await replaceItems(req.params.id, body.items);
    // Record only the changed scalar fields (not the heavy items array).
    const after = {}; for (const k in body) if (map[k]) after[k] = body[k];
    if (Object.keys(after).length || wantsItems) {
      audit(req, 'order.updated', { entityType: 'order', entityId: req.params.id, before, after: Object.keys(after).length ? after : { items: 'replaced' } });
    }
    if (_charged) audit(req, 'order.charged', { entityType: 'order', entityId: req.params.id, after: { amount: _charged } });
    if (_refunded) audit(req, 'order.refunded', { entityType: 'order', entityId: req.params.id, after: { amount: _refunded } });
    egBroadcast({ type: 'orders' });
    if (_charged || _refunded) egBroadcast({ type: 'wallet' });
    // Tracking arriving IS the shipment as far as a partner is concerned — a label
    // purchase writes tracking and 'shipped' together, so key off that rather than the
    // status word, which can also be set by hand without a parcel existing.
    {
      const stage = normalizeStage(String(body.factoryStatus ?? body.status ?? ''));
      // A refusal needs a REASON, and it has to be stored before the webhook reads it
      // back — awaiting the merge rather than firing and hoping is the difference
      // between a partner learning "we can't print that colour" and learning nothing.
      // Merged into meta rather than assigned, so cancelling never clobbers external_id.
      if (stage === 'cancelled' && typeof body.reason === 'string' && body.reason.trim()) {
        await q(
          `update orders set meta = coalesce(meta,'{}'::jsonb) || $2::jsonb where id=$1`,
          [req.params.id, JSON.stringify({ rejection: {
            reason: body.reason.trim().slice(0, 500),
            by: isStaff(req.user) ? 'factory' : 'seller',
            at: new Date().toISOString(),
          } })]
        ).catch(() => {});
      }
      if (body.tracking !== undefined || stage === 'shipped') notifyOrderEvent(req.params.id, 'order.shipped');
      else if (stage === 'cancelled' || stage === 'refunded') notifyOrderEvent(req.params.id, 'order.cancelled');
      else if (stage) notifyOrderEvent(req.params.id, 'order.status_changed');
    }
    return { ok: true, charged: _charged || undefined, refunded: _refunded || undefined };
  });

  // What would this order cost to produce? The seller's Submit button reads this to show
  // the price BEFORE they commit, and to tell them the shortfall if they can't cover it.
  // Same quote the charge uses, so the number they see is the number they pay.
  app.get('/api/orders/:id/quote', { preHandler: requireAuth }, async (req, reply) => {
    const own = await q('select seller_id, factory_status from orders where id=$1', [req.params.id]);
    const row = own.rows[0];
    if (!row) { reply.code(404); return { error: 'Order not found' }; }
    if (!isStaff(req.user)) {
      const sel = await resolveSeller(req.user);
      if (!sel || row.seller_id !== sel.id) { reply.code(403); return { error: 'forbidden' }; }
    }
    const quote = await quoteOrder(req.params.id);
    const paid = await chargedAmount(req.params.id);
    return { ...quote, charged: paid > 0 ? paid : 0, balance: await balanceOf(row.seller_id) };
  });

  // Per-item production status — the warehouse "Working" flag. Staff-only. Keyed
  // by (order, sku) to match the boards' item-status store; order_items already
  // has factory_status and /api/orders returns it on each item, so mobile and all
  // factory boards converge on the server instead of per-browser localStorage.
  // Stamp a label as printed. Called when the label is actually opened for printing, so
  // the board can distinguish "labelled" from "label on the parcel" without anyone
  // remembering to tick a box.
  app.post('/api/orders/:id/label-printed', { preHandler: requireAuth }, async (req, reply) => {
    // Dispatch is view-only for operators, and this stamp is a dispatch action —
    // it asserts a label is on the parcel, which is a custody claim. Was staff-only,
    // so the UI hid the button while the API still accepted it.
    const role = req.user && req.user.role;
    if (role !== 'admin' && role !== 'warehouse') { reply.code(403); return { error: 'Warehouse or admin only' }; }
    const undo = (req.body || {}).undo === true;
    await q('update orders set label_printed_at=$1 where id=$2', [undo ? null : new Date(), req.params.id]);
    audit(req, undo ? 'label.unprinted' : 'label.printed', { entityType: 'order', entityId: req.params.id });
    return { ok: true, label_printed_at: undo ? null : new Date().toISOString() };
  });

  app.post('/api/orders/:id/item-status', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    const { sku, status } = req.body || {};
    // Keyed by line_id when present, exactly as item-setup is. Keying on sku alone was
    // broken for two common cases: a marketplace line with a NULL sku never matched
    // (sku = NULL is never true in SQL, so the update silently hit no rows and the
    // status appeared not to save), and identical-SKU siblings moved TOGETHER because
    // one UPDATE touched both. Both are routine on Etsy orders.
    const lineId = (req.body || {}).line_id ? String((req.body || {}).line_id) : null;
    if (!lineId && !sku) { reply.code(400); return { error: 'line_id or sku required' }; }
    const key = lineId ? 'line_id' : 'sku';
    const val = lineId || sku;
    const pre = await q(`select factory_status from order_items where order_id=$1 and ${key}=$2 limit 1`, [req.params.id, val]);
    if (!pre.rows[0]) { reply.code(404); return { error: 'item not found' }; }
    // Role gate — see stageDenial. Read the CURRENT stage first: an operator's reach
    // depends on where the item already is, not just where they're sending it.
    const denial = stageDenial(String(req.user.role || ''), pre.rows[0].factory_status, status);
    if (denial) { reply.code(403); return { error: denial }; }
    // Shipping is an ORDER-level claim even when set per item: a parcel can't go out
    // half-made. Everything before shipped stays per-item and unrestricted.
    if (normalizeStage(status) === 'shipped') {
      const blockers = await shipBlockers(req.params.id);
      if (blockers.length) { reply.code(409); return { error: `Can't mark shipped — ${blockers.join('; and ')}.`, blockers }; }
    }
    await q(`update order_items set factory_status=$1 where order_id=$2 and ${key}=$3`,
      [status || '', req.params.id, val]);
    audit(req, 'item.status', { entityType: 'order', entityId: req.params.id,
      before: { sku, status: (pre.rows[0] && pre.rows[0].factory_status) || '' }, after: { sku, status: status || '' } });
    // Tell whoever pushed this order that it moved. Fire and forget — a partner's
    // endpoint being down must never fail the floor's status write.
    notifyOrderEvent(req.params.id, normalizeStage(status) === 'shipped' ? 'order.shipped' : 'order.status_changed',
      { line: { sku, line_id: lineId || null }, status: normalizeStage(status) || null });
    // Entering the design stage hands the line to a designer — so do it automatically,
    // and report what was HELD BACK. Silence would be wrong here: "nothing happened"
    // and "we already have that file" look identical from the board.
    let design = null, replenish = null;
    if (normalizeStage(status) === 'awaiting_scan') {
      design = await autoPushDesigns(req.params.id, lineId, sku).catch(() => null);
      // Same gate tops the blanks back up: anything now projected below its reorder
      // point is appended to that supplier's DRAFT purchase order. Draft only —
      // placing an order with a supplier stays a human click on the Purchase board.
      replenish = await autoReplenish(req.params.id).catch(() => null);
    }
    egBroadcast({ type: 'item-status' });   // no id/sku — see the note above
    return { ok: true, design, replenish };
  });

  // ── Variant setup — the blank/colour/size/method for a line item ────────────
  // Marketplace orders (Etsy/Shopify) arrive with UNSET variants, so they can't be
  // priced or submitted until someone picks them; a listing published FROM our catalog
  // arrives already resolvable by SKU. Either way this is where the picks are saved.
  // Keyed by line_id when present (identical-SKU siblings), else sku. Seller-owner OR
  // staff may set them (canSeeOrder), but ONLY before the price is locked: once the
  // seller has submitted (and been charged), the frozen cost must not silently drift
  // from the variants it was based on.
  app.post('/api/orders/:id/item-setup', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const b = req.body || {};
    const lineId = b.line_id ? String(b.line_id) : null;
    const sku = b.sku != null ? String(b.sku) : null;
    if (!lineId && !sku) { reply.code(400); return { error: 'line_id or sku required' }; }
    // Editable only before production. A charged order's variants are settled — changing
    // them would desync order_items.unit_cost/ship_fee (frozen at submit). Cheapest guard:
    // block once anything on the order has been charged.
    const charged = await chargedAmount(req.params.id);
    if (charged > 0) { reply.code(409); return { error: 'This order is already submitted — its items are locked. Cancel it first to change variants.' }; }
    // Only the fields the picker owns; undefined = leave as-is.
    const sets = [], vals = []; let n = 1;
    for (const [key, col] of [['blank', 'blank'], ['color', 'color'], ['size', 'size'], ['printType', 'print_type'], ['variant', 'variant']]) {
      if (b[key] !== undefined) { sets.push(`${col}=$${n++}`); vals.push(b[key] === '' ? null : String(b[key])); }
    }
    if (!sets.length) { reply.code(400); return { error: 'nothing to set' }; }
    let where = `order_id=$${n++}`; vals.push(req.params.id);
    if (lineId) { where += ` and line_id=$${n++}`; vals.push(lineId); }
    else { where += ` and sku=$${n++}`; vals.push(sku); }
    const r = await q(`update order_items set ${sets.join(',')} where ${where}`, vals);
    if (!r.rowCount) { reply.code(404); return { error: 'item not found' }; }
    audit(req, 'item.setup', { entityType: 'order', entityId: req.params.id, after: { line_id: lineId, sku, ...b } });
    egBroadcast({ type: 'orders' });
    return { ok: true };
  });

  // ── Design uploads (server-stored, so localStorage size is irrelevant) ──────
  // Save one design (data URL) for an order item.
  //
  // Upsert key is (order_id, coalesce(line_id, sku), kind) — LINE first. This comment used
  // to say "(order, sku, kind)", which is the pre-line_id behaviour and is wrong: keyed on
  // sku alone, two lines of the same sku share one artwork row and attaching art to one
  // silently replaces the other's. The SQL was fixed; the comment was not, and it has since
  // been believed by someone writing new code against it.
  app.post('/api/orders/:id/designs', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const { sku, data, name, kind, pos } = req.body || {};
    if (!sku || !data) return { error: 'sku and data required' };
    // Line identity, when the caller knows it. Falls back to sku-keying so older clients
    // and marketplace sync keep working — see the migration above.
    const lineId = (req.body || {}).line_id ? String((req.body || {}).line_id) : null;
    const posJson = (pos && typeof pos === 'object') ? JSON.stringify(pos) : null;
    // Exact hash is ours, never the client's — it decides whether an already-produced
    // machine file may be reused, so a forged one would attach the wrong deliverable.
    // The perceptual hash is only ever a suggestion, so taking it from the client is fine.
    const artHash = hashOf(data);
    const artPhash = isPhash(req.body && req.body.phash) ? String(req.body.phash).toLowerCase() : null;
    // Push the bytes to object storage when it's configured, and keep only the URL in
    // Postgres. Two reasons: base64 artwork bloats the DB and every query that touches it,
    // and an outside design partner (Pink Design) can ONLY be given a URL — it has no file
    // upload. When storage is off, `data` keeps the inline base64 exactly as before, so
    // nothing breaks on an unconfigured server. Readers take `url ?? data`.
    let storedData = data, storedKey = null;
    if (storageEnabled()) {
      try {
        const parsed = fromDataUrl(data);
        const key = `order-designs/${artHash}${extFromMime(parsed.mime)}`;
        // PRIVATE when links are meant to expire — a public-read object stays readable
        // forever by anyone holding the URL, which would make the TTL a lie. TTL 0 is an
        // explicit opt-in to permanent links, so public-read is right there.
        await putObject(key, parsed.buffer, parsed.mime, designUrlTtlDays() > 0 ? 'private' : 'public-read');
        storedKey = key;          // the URL is minted per read, never stored
        storedData = null;
      } catch (e) {
        req.log?.warn?.({ err: e }, 'design upload to storage failed - keeping inline base64');
      }
    }
    await q(
      `insert into order_designs (order_id, sku, line_id, kind, data, storage_key, name, pos, art_hash, art_phash, updated_at)
       values ($1,$2,$10,$3,$4,$9,$5,$6,$7,$8, now())
       on conflict (order_id, (coalesce(line_id, sku)), kind) do update set data=excluded.data, storage_key=excluded.storage_key, name=excluded.name, pos=excluded.pos,
         art_hash=excluded.art_hash, art_phash=coalesce(excluded.art_phash, order_designs.art_phash), updated_at=now()`,
      [req.params.id, sku, kind || 'raster', storedData, name || null, posJson, artHash, artPhash, storedKey, lineId]
    );
    audit(req, 'design.saved', { entityType: 'order', entityId: req.params.id, after: { sku, kind: kind || 'raster', name: name || null } });
    return { ok: true };
  });
  /**
   * Charge a seller for design work on ONE line.
   *
   * Idempotent on (order, line, 'design-work'): the ledger's own (account, type, ref)
   * uniqueness means a retried request, a double-click, or a tier re-set to the same value
   * cannot bill twice. Re-tiering a line that was already charged does NOT charge again —
   * correcting a mis-categorised line is a fix, not a second sale, and the difference is
   * settled by hand if it matters.
   *
   * Returns what happened rather than throwing: the tier decision is already recorded, and
   * losing that record because a wallet call failed would leave the line uncategorised with
   * no sign anything went wrong.
   */
  async function chargeDesign(req, orderId, lineId, sku, tier, fees) {
    const amount = tier === 'supplied'
      ? Number(fees.check_fee) || 0
      : tier === 'complex'
        ? Number(fees.design_fee_complex) || 0
        : Number(fees.design_fee_standard) || 0;
    if (!(amount > 0)) return { charged: 0, reason: 'no-fee-set' };
    const key = lineId ? 'line_id' : 'sku';
    const row = await q(
      `select i.design_charged_at, o.seller_id from order_items i
         join orders o on o.id = i.order_id
        where i.order_id=$1 and i.${key}=$2 limit 1`, [orderId, lineId || sku])
      .then((r) => r.rows[0]).catch(() => null);
    if (!row) return { charged: 0, reason: 'no-line' };
    if (row.design_charged_at) return { charged: 0, reason: 'already-charged' };
    if (!row.seller_id) return { charged: 0, reason: 'no-seller' };

    const ref = `design-${orderId}-${lineId || sku}`;
    try {
      await moveFunds({
        from: row.seller_id, to: 'factory', amount,
        type: 'design-work', ref,
        note: `Design ${tier === 'supplied' ? 'check' : 'work'} · ${orderId} · ${sku || lineId}`,
        by: req.user && req.user.sub,
      });
    } catch (e) {
      return { charged: 0, reason: 'wallet-failed', error: e.message };
    }
    await q(`update order_items set design_charged_at = now() where order_id=$1 and ${key}=$2`,
      [orderId, lineId || sku]).catch(() => {});
    audit(req, 'design.charged', { entityType: 'order', entityId: orderId, after: { tier, amount, line_id: lineId, sku } });
    return { charged: amount, tier };
  }

  /**
   * Record which design charge a line attracts. Staff decide; the seller is billed later,
   * and for 'complex' only after they accept the quote.
   *
   * Keyed by line_id, not sku — two lines of the same sku can genuinely differ here, one
   * seller-supplied and one for us to cut.
   */
  app.post('/api/orders/:id/design-tier', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }
    const b = req.body || {};
    const tier = String(b.tier || '').trim();
    const TIERS = ['standard', 'complex', 'supplied'];
    if (!TIERS.includes(tier)) { reply.code(400); return { error: `tier must be one of: ${TIERS.join(', ')}` }; }
    const lineId = b.line_id ? String(b.line_id) : null;
    const sku = b.sku ? String(b.sku) : null;
    if (!lineId && !sku) { reply.code(400); return { error: 'line_id or sku required' }; }
    const key = lineId ? 'line_id' : 'sku';
    const fees = await readAll().catch(() => ({}));
    // COMPLEX opens a quote and charges nothing. The other two are charged here, because
    // setting them IS the decision — there is no second party to ask.
    const quoted = tier === 'complex';
    const r = await q(
      `update order_items set design_tier=$3, design_tier_at=now(), design_tier_by=$4,
              design_quote_status = $5,
              design_quote_make = $6, design_quote_download = $7, design_quote_at = $8
        where order_id=$1 and ${key}=$2`,
      [String(req.params.id), lineId || sku, tier, String((req.user && req.user.sub) || ''),
       quoted ? 'pending' : null,
       quoted ? Number(fees.design_fee_complex) || 0 : null,
       quoted ? Number(fees.emb_price_complex) || 0 : null,
       quoted ? new Date().toISOString() : null]);
    if (!r.rowCount) { reply.code(404); return { error: 'No such line on this order.' }; }
    audit(req, 'design.tier', { entityType: 'order', entityId: String(req.params.id), after: { tier, line_id: lineId, sku } });

    let charged = null;
    if (quoted) {
      const seller = await q('select seller_id from orders where id=$1', [String(req.params.id)])
        .then((x) => x.rows[0] && x.rows[0].seller_id).catch(() => null);
      if (seller) {
        notify({
          userIds: [seller], type: 'design-quote',
          title: 'This design needs a quote',
          body: `We've looked at your artwork and it's intricate — $${(Number(fees.design_fee_complex) || 0).toFixed(2)} to digitise. Open the order to accept or cancel the line.`,
          href: `/orders`, entityId: String(req.params.id),
        }).catch(() => {});
      }
    } else {
      charged = await chargeDesign(req, String(req.params.id), lineId, sku, tier, fees);
    }
    egBroadcast({ type: 'orders' });
    return { ok: true, tier, lines: r.rowCount, quoted, charged };
  });

  /**
   * The seller answers the quote.
   *
   * Seller-owned, not staff: this is the whole point. A complex charge is several times the
   * standard one, and it applies only because the person paying it said yes. Staff can set
   * the tier; only the seller can accept the number.
   *
   * Accepting charges the FROZEN price stored at quote time, not today's setting — the
   * seller agreed to a number and that is the number.
   *
   * Declining records the decision and tells staff. It does NOT cancel the line: cancelling
   * moves money (the production charge has to come back) and that path already exists,
   * tested, in the cancel flow. A second, hastier implementation of a refund is exactly the
   * kind of thing that quietly pays the wrong amount.
   */
  app.post('/api/orders/:id/design-quote', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    const decision = String(b.decision || '').trim();
    if (!['accept', 'decline'].includes(decision)) { reply.code(400); return { error: "decision must be 'accept' or 'decline'" }; }
    const lineId = b.line_id ? String(b.line_id) : null;
    const sku = b.sku ? String(b.sku) : null;
    if (!lineId && !sku) { reply.code(400); return { error: 'line_id or sku required' }; }

    const orderId = String(req.params.id);
    const sel = await resolveSeller(req.user);
    const own = await q('select seller_id from orders where id=$1', [orderId])
      .then((r) => r.rows[0]).catch(() => null);
    if (!own) { reply.code(404); return { error: 'Order not found' }; }
    // 404 rather than 403 on someone else's order — the same reason every other read here
    // does: telling a stranger "that exists but isn't yours" confirms the id.
    const mine = sel && sel.id && String(own.seller_id) === String(sel.id);
    if (!mine && !isStaff(req.user)) { reply.code(404); return { error: 'Order not found' }; }

    const key = lineId ? 'line_id' : 'sku';
    const line = await q(
      `select design_quote_status, design_quote_make, design_charged_at
         from order_items where order_id=$1 and ${key}=$2 limit 1`, [orderId, lineId || sku])
      .then((r) => r.rows[0]).catch(() => null);
    if (!line) { reply.code(404); return { error: 'No such line on this order.' }; }
    if (line.design_quote_status !== 'pending') {
      reply.code(409);
      return { error: `This quote is already ${line.design_quote_status || 'not open'}.` };
    }

    if (decision === 'decline') {
      await q(`update order_items set design_quote_status='declined' where order_id=$1 and ${key}=$2`,
        [orderId, lineId || sku]);
      audit(req, 'design.quote.declined', { entityType: 'order', entityId: orderId, after: { line_id: lineId, sku } });
      notify({
        roles: ['operator', 'warehouse', 'admin'], excludeUserId: req.user && req.user.sub,
        type: 'design-quote', title: 'Design quote declined',
        body: `${orderId} · ${sku || lineId} — the seller declined the complex design fee. Cancel the line or agree something else.`,
        href: `/operator?order=${orderId}`, entityId: orderId,
      }).catch(() => {});
      egBroadcast({ type: 'orders' });
      return { ok: true, decision: 'declined' };
    }

    const amount = Number(line.design_quote_make) || 0;
    if (line.design_charged_at) {
      // Already paid: accept the click, change nothing, say so. Erroring here would look
      // like the acceptance failed and invite a second attempt.
      await q(`update order_items set design_quote_status='accepted' where order_id=$1 and ${key}=$2`,
        [orderId, lineId || sku]);
      return { ok: true, decision: 'accepted', charged: 0, already: true };
    }
    if (amount > 0) {
      const bal = await balanceOf(own.seller_id).catch(() => 0);
      if (bal < amount) {
        reply.code(402);
        return { error: `Not enough balance — this needs $${amount.toFixed(2)} and you have $${Number(bal).toFixed(2)}. Top up and accept again.`, needsTopup: true, amount };
      }
      try {
        await moveFunds({
          from: own.seller_id, to: 'factory', amount,
          type: 'design-work', ref: `design-${orderId}-${lineId || sku}`,
          note: `Complex design · ${orderId} · ${sku || lineId}`, by: req.user && req.user.sub,
        });
      } catch (e) { reply.code(400); return { error: e.message }; }
    }
    await q(`update order_items set design_quote_status='accepted', design_charged_at=now() where order_id=$1 and ${key}=$2`,
      [orderId, lineId || sku]);
    audit(req, 'design.quote.accepted', { entityType: 'order', entityId: orderId, after: { amount, line_id: lineId, sku } });
    notify({
      roles: ['operator', 'warehouse', 'admin'],
      type: 'design-quote', title: 'Design quote accepted',
      body: `${orderId} · ${sku || lineId} — cleared to digitise.`,
      href: `/operator?order=${orderId}`, entityId: orderId,
    }).catch(() => {});
    egBroadcast({ type: 'orders' });
    return { ok: true, decision: 'accepted', charged: amount };
  });

  /**
   * Design rows we cannot attribute to a line.
   *
   * These are artwork saved before line_id existed, on orders where the same SKU appears
   * more than once. The row is real; which of the siblings it belongs to was never
   * recorded, and no amount of querying recovers it — so this lists them for a human
   * rather than letting the app pick one and print the wrong hoodie.
   *
   * `saves` counts design.saved audits for that (order, sku). More than one means a second
   * design was attached and OVERWROTE the first — so the sibling's artwork is not merely
   * unattributed, it is gone and needs re-uploading. One means only one line was ever
   * decorated and the row just needs pointing at the right line.
   */
  app.get('/api/orders/designs/ambiguous', { preHandler: requireAuth }, async (req, reply) => {
    // ordersRoutes only receives requireAuth; every other staff gate in this file is
    // checked in-handler, so this follows the same shape rather than inventing a preHandler
    // the file was never given.
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }
    const r = await q(`
      select d.order_id, d.sku, d.name, d.updated_at,
             o.seq,
             (select count(*)::int from order_items i
               where i.order_id = d.order_id and i.sku = d.sku) as lines,
             (select count(*)::int from audit_log a
               where a.entity_type = 'order' and a.entity_id = d.order_id
                 and a.action = 'design.saved' and a.after::text like '%' || d.sku || '%') as saves
        from order_designs d
        join orders o on o.id = d.order_id
       where d.line_id is null
         and (select count(*) from order_items i
               where i.order_id = d.order_id and i.sku = d.sku) > 1
         -- Not SUPERSEDED. Once every line of that sku has its own line-keyed design, the
         -- unattributed row is never read (lookup is line_id first, sku only as fallback),
         -- so asking a human to attribute it is asking about something already resolved.
         -- Without this the list never empties and stops being read.
         and (select count(*) from order_designs x
               where x.order_id = d.order_id and x.sku = d.sku and x.line_id is not null)
             < (select count(*) from order_items i
                 where i.order_id = d.order_id and i.sku = d.sku)
       order by d.updated_at desc nulls last
       limit 500`).catch(() => ({ rows: [] }));
    return {
      rows: r.rows.map((x) => ({
        orderId: x.order_id, num: x.seq ? '#' + x.seq : x.order_id,
        sku: x.sku, name: x.name, updatedAt: x.updated_at, lines: x.lines,
        // Stated as what it means, not as a count nobody can interpret.
        overwritten: x.saves > 1,
      })),
    };
  });

  /** Point an unattributed design row at the line it belongs to. A human decides; this
   *  only records the decision. */
  app.post('/api/orders/:id/designs/attribute', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }
    const b = req.body || {};
    const sku = String(b.sku || '').trim(), lineId = String(b.lineId || '').trim();
    if (!sku || !lineId) { reply.code(400); return { error: 'sku and lineId are both required.' }; }
    const owns = await q('select 1 from order_items where order_id=$1 and line_id=$2 and sku=$3',
      [String(req.params.id), lineId, sku]).then((r) => r.rowCount).catch(() => 0);
    if (!owns) { reply.code(400); return { error: 'That line is not on this order, or its SKU differs.' }; }
    const r = await q('update order_designs set line_id=$3 where order_id=$1 and sku=$2 and line_id is null',
      [String(req.params.id), sku, lineId]);
    audit(req, 'design.attributed', { entityType: 'order', entityId: String(req.params.id), after: { sku, lineId } });
    return { ok: true, updated: r.rowCount };
  });

  // Fetch all designs for one order — called lazily when the order is opened, so a
  // big base64 payload never rides along on the main /api/orders list.
  app.get('/api/orders/:id/designs', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const r = await q(`select sku, line_id, kind, data, storage_key, name, pos from order_designs where order_id=$1`, [req.params.id]);
    // Minted per read, not stored: a signed URL expires, so a persisted one would go
    // stale. Returned through `data` because that's what every client already renders
    // (an <img src> takes a URL or a data-URL either way).
    return r.rows.map((row) => {
      const url = designUrlOf(row);
      // line_id is what a caller should key on; sku stays for rows that predate it.
      return { sku: row.sku, line_id: row.line_id, kind: row.kind, name: row.name, pos: row.pos, data: url || row.data, url };
    });
  });

  // ── Thread colours (embroidery) — persisted SERVER-side so they survive a refresh
  //    and reach the factory cross-device (they used to live only in the seller's
  //    localStorage, so a reload or a different browser showed none). ──────────────
  q(`create table if not exists order_threads (
       order_id text, sku text, threads jsonb, updated_at timestamptz default now(),
       primary key (order_id, sku)
     )`).catch(() => {});
  app.post('/api/orders/:id/threads', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const { sku, threads } = req.body || {};
    if (!sku) return { error: 'sku required' };
    await q(
      `insert into order_threads (order_id, sku, threads, updated_at) values ($1,$2,$3, now())
       on conflict (order_id, sku) do update set threads=excluded.threads, updated_at=now()`,
      [req.params.id, sku, JSON.stringify(threads || [])]
    );
    return { ok: true };
  });
  app.get('/api/orders/:id/threads', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const r = await q(`select sku, threads from order_threads where order_id=$1`, [req.params.id]);
    return r.rows;
  });

  // ── Order chat — persisted in order_messages so a conversation survives a
  //    refresh and reaches every board / device (used to live only in the
  //    sender's localStorage under eg_order_chats). meta holds the client's
  //    display fields; client_id makes re-sends idempotent. ─────────────────
  q(`alter table order_messages add column if not exists meta jsonb`).catch(() => {});
  q(`alter table order_messages add column if not exists client_id text`).catch(() => {});
  q(`create unique index if not exists order_messages_client on order_messages (client_id) where client_id is not null`).catch(() => {});
  // order_id also holds SYNTHETIC channel ids (support-<seller>, staff-general) that
  // aren't real orders — the FK to orders(id) rejected those inserts, so support/staff
  // chat messages silently failed (the bubble "flashed and reverted"). Drop the FK.
  q(`alter table order_messages drop constraint if exists order_messages_order_id_fkey`).catch(() => {});

  // ── Channel unification ────────────────────────────────────────────────────
  // Channels used to fan out per ORDER: every order carried a seller↔factory thread
  // and a `design-<orderId>` artwork thread, so a busy shop buried the rail under
  // dozens of near-empty rooms and the same conversation happened in three places.
  //
  // One rule now: the ONLY dimension a channel fans out on is seller identity.
  //   support-<sellerId>  seller ↔ non-designer staff (+ AI)
  //   staff-general       every staff role, designers included
  //   announce            admin → all sellers, read-only downstream
  //
  // Per-order context isn't lost — it moves from the channel id into meta.order_ref,
  // which the order page filters on. That also makes this migration REVERSIBLE: the
  // original order_id is preserved in order_ref, never discarded.
  q(`create index if not exists order_messages_order_ref
       on order_messages ((meta->>'order_ref')) where meta ? 'order_ref'`).catch(() => {});
  async function foldChannels() {
    // Don't depend on the unawaited ALTER above having landed: factory_order is added
    // fire-and-forget at route load, so racing it made this whole migration silently
    // no-op on a fresh database (the catch swallowed "column does not exist").
    await q('alter table orders add column if not exists factory_order boolean not null default false');
    // Artwork threads → the one factory room.
    await q(`update order_messages
                set order_id = 'staff-general',
                    meta = coalesce(meta,'{}'::jsonb)
                           || jsonb_build_object('order_ref', replace(order_id,'design-',''))
              where order_id like 'design-%'`);
    // Seller↔factory order threads → that seller's channel. A thread on a factory
    // order (no seller) has no seller channel to go to, so it joins the staff room
    // rather than being dropped.
    await q(`update order_messages m
                set order_id = 'support-' || o.seller_id,
                    meta = coalesce(m.meta,'{}'::jsonb) || jsonb_build_object('order_ref', m.order_id)
               from orders o
              where o.id = m.order_id and o.seller_id is not null and o.factory_order is not true`);
    await q(`update order_messages m
                set order_id = 'staff-general',
                    meta = coalesce(m.meta,'{}'::jsonb) || jsonb_build_object('order_ref', m.order_id)
               from orders o
              where o.id = m.order_id`);
  }
  foldChannels().catch(() => {});

  // ── @order mentions ────────────────────────────────────────────────────────
  // A seller writes "@4099" (or "@etsy-abc123") and that message becomes *about*
  // that order. This is what makes one channel per seller workable: the order
  // reference moved out of the channel id and into the message.
  //
  // Resolution is SCOPED to the channel's seller. Without that, a seller could
  // mention arbitrary ids and use whether an order surfaces as an oracle for
  // another shop's order numbers.
  async function resolveMention(text, sellerId) {
    const toks = [];
    // The @ must start a word, or "bob@shop.com" reads as a mention of "shop".
    const re = /(?:^|\s)@#?([A-Za-z0-9][A-Za-z0-9_-]{2,63})/g;
    let m;
    while ((m = re.exec(String(text || ''))) && toks.length < 5) toks.push(m[1]);
    if (!toks.length) return null;
    // o.id ≠ o.num: marketplace orders are `etsy-abc`, but a seller reads #4099 off
    // the board. Match either. seq is an int column, so only digit tokens go to it.
    const nums = toks.filter((t) => /^\d+$/.test(t)).map(Number);
    const r = await q(
      `select id from orders
        where ($2::uuid is null or seller_id = $2)
          and (id = any($1::text[]) or (seq is not null and seq = any($3::int[])))
        order by created_at desc limit 1`,
      [toks, sellerId || null, nums]);
    return r.rows[0]?.id || null;
  }

  // Staff-only order briefing, posted into the channel as an INTERNAL message.
  // The point: when a seller asks about an order, whoever answers should already
  // see the full internal picture — factory stage, gates, tracking — without
  // leaving the conversation to go read the board.
  //
  // The seller must never see this. Two independent guards: meta.internal is
  // stripped from non-staff reads (see GET), and the summary is generated from
  // internal columns a seller's own view would never include.
  async function postOrderBriefing(channel, orderId) {
    try {
      // Don't re-brief the same order every message — a back-and-forth about one
      // order would otherwise cost an AI call per line.
      const recent = await q(
        `select 1 from order_messages
          where order_id=$1 and meta->>'order_ref'=$2 and coalesce((meta->>'summary')::boolean,false)
            and created_at > now() - interval '10 minutes' limit 1`, [channel, orderId]);
      if (recent.rows.length) return;

      const o = (await q(
        `select id, seq, source, store, status, factory_status, gates, tracking, carrier,
                service, delivery, est_delivery, total, customer, timeline, created_at
           from orders where id=$1`, [orderId])).rows[0];
      if (!o) return;
      const items = (await q(
        `select sku, name, qty, print_type, variant from order_items where order_id=$1`, [orderId])).rows;

      const facts = JSON.stringify({ order: o, items }).slice(0, 12000);
      const text = await aiComplete({
        system:
          'You brief print-on-demand factory staff on one order so they can answer the seller. ' +
          'Reply with 4-7 terse markdown bullets, no preamble and no closing line. Cover: where the order ' +
          'actually is in production, anything blocking it, shipping/tracking state, and what to tell the ' +
          'seller. Quote real values from the data. If a field is missing say so plainly — never guess a ' +
          'stage or a date.',
        messages: [{ role: 'user', content: `Order data:\n${facts}` }],
        maxTokens: 500,
      });
      if (!text) return;
      await q(
        `insert into order_messages (order_id, sender_id, sender_role, body, meta)
         values ($1, null, 'assistant', $2, $3)`,
        [channel, text, JSON.stringify({
          by: `Order brief · ${o.seq ? '#' + o.seq : o.id}`,
          internal: true, summary: true, order_ref: orderId,
        })]);
      egBroadcast({ type: 'order-message' });
    } catch (e) {
      // A failed briefing must never fail the message that triggered it.
    }
  }

  // Map an incoming :id onto (channel, orderRef). Real order ids and legacy
  // `design-<id>` links keep working — they resolve to the channel that absorbed
  // them and filter to that order — so old bookmarks and the order page's chat
  // panel don't 404.
  async function resolveChannel(id) {
    const s = String(id);
    if (s === 'staff-general' || s === 'announce' || s.indexOf('support-') === 0) {
      return { channel: s, orderRef: null };
    }
    if (s.indexOf('design-') === 0) return { channel: 'staff-general', orderRef: s.slice(7) };
    const o = (await q('select seller_id, factory_order from orders where id=$1', [s])).rows[0];
    if (!o) return { channel: s, orderRef: null };
    const seller = !o.factory_order && o.seller_id;
    return { channel: seller ? 'support-' + o.seller_id : 'staff-general', orderRef: s };
  }

  // A seller who is an ACTIVE team member of an owner acts on the OWNER's board. Returns the effective
  // seller id (owner for a member, else self) + the member's permission surfaces (perms=null means a
  // full owner, not a team member). Staff → own id, not a member. This is what enforces the "team
  // members see their owner's orders" exception server-side, not just in the UI.
  async function resolveSeller(user) {
    if (!user) return { id: null, perms: null, member: false };
    if (isStaff(user)) return { id: user.sub, perms: null, member: false };
    try {
      const r = await q("select owner_id, permissions from team_members where lower(email)=lower($1) and status='active' limit 1", [user.email || '']);
      const row = r.rows[0];
      if (row && row.owner_id) return { id: row.owner_id, perms: Array.isArray(row.permissions) ? row.permissions : [], member: true };
    } catch (e) {}
    return { id: user.sub, perms: null, member: false };
  }
  // A team member is limited to their granted surfaces (hide/unhide). A full owner (perms=null) passes.
  function _canSurface(sel, surface) { return !(sel && sel.member && sel.perms && sel.perms.indexOf(surface) < 0); }

  // Chat-channel access. Deliberately SEPARATE from canSeeOrder: that one also gates
  // design uploads/threads the designer board needs, so narrowing it would break the
  // designer's own work. This governs who may read/write a CONVERSATION.
  //
  // Designers don't deal with sellers — they work artwork for the factory. So they are
  // out of the seller channels entirely and work in staff-general, where artwork talk
  // now lives alongside the rest of production.
  //
  // Takes a RESOLVED channel id (see resolveChannel) — never a raw order id.
  async function canSeeThread(user, channelId) {
    const id = String(channelId);
    const role = user?.role;
    if (id === 'staff-general') return isStaff(user);               // internal room — designers included
    if (id === 'announce') return true;                             // everyone reads; writes gated separately
    if (id.indexOf('support-') === 0) {
      if (isStaff(user)) return role !== 'designer';
      // A seller sees only their OWN channel. Deliberately NOT resolveSeller(): a team
      // member acts on the owner's board for orders, but the owner's conversation with
      // EGFULFILL can cover billing and account matters the owner never delegated. The
      // member gets their own channel instead. Same rule as before this refactor.
      return id === ('support-' + user.sub);
    }
    return false;
  }

  async function canSeeOrder(user, orderId) {
    if (isStaff(user)) return true;
    // Support conversations ride on order_messages under a synthetic id `support-<sellerId>`.
    // A seller may only see/post to their OWN support thread; staff (above) see all of them.
    if (String(orderId).indexOf('support-') === 0) return orderId === ('support-' + user.sub);
    const sel = await resolveSeller(user);
    if (!_canSurface(sel, 'orders')) return false;
    const r = await q('select seller_id, factory_order from orders where id=$1', [orderId]);
    const row = r.rows[0];
    return !!(row && !row.factory_order && row.seller_id === sel.id);
  }

  // Staff-only: list every seller support thread (one row per seller) with its last message, so the
  // staff chat can show "EGFULFILL Support" conversations that sellers started. Sellers never hit this.
  app.get('/api/support/threads', { preHandler: requireAuth }, async (req, reply) => {
    // Designers excluded: they don't answer sellers, so seller conversations aren't theirs
    // to read. See canSeeThread.
    if (!isStaff(req.user) || req.user.role === 'designer') { reply.code(403); return { error: 'forbidden' }; }
    const r = await q(`
      select m.order_id,
             max(m.created_at) as last_at,
             count(*)::int as n,
             (select body from order_messages x where x.order_id = m.order_id order by created_at desc, id desc limit 1) as last_body,
             (select coalesce(nullif(u.name,''), u.email) from users u where u.id::text = replace(m.order_id, 'support-', '')) as seller_name,
             -- Open escalation = the seller asked for a human and no staffer has replied
             -- since. That's what sorts a thread to the top of the inbox.
             (select count(*) from order_messages e
               where e.order_id = m.order_id
                 and coalesce((e.meta->>'escalated')::boolean, false)
                 and e.created_at > coalesce((select max(s.created_at) from order_messages s
                                               where s.order_id = m.order_id
                                                 and s.sender_role <> 'seller'), '-infinity'::timestamptz)
             )::int as open_escalations
        from order_messages m
       where m.order_id like 'support-%'
       group by m.order_id
       order by last_at desc`);
    return r.rows.map((x) => ({
      order_id: x.order_id,
      seller_id: String(x.order_id).replace('support-', ''),
      seller_name: x.seller_name || null,
      last: x.last_body || '',
      last_at: x.last_at ? new Date(x.last_at).getTime() : 0,
      n: x.n,
      escalated: x.open_escalations > 0,
    }));
  });

  // Staff-only: find a seller by name or email to open a channel with them.
  // /api/support/threads only lists sellers who already wrote in, so without this
  // there was no way to START a conversation — and the cases that most need one
  // (unvalidated address, missing artwork) are always factory-initiated.
  app.get('/api/support/sellers', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user) || req.user.role === 'designer') { reply.code(403); return { error: 'forbidden' }; }
    const term = String(req.query?.q || '').trim();
    if (term.length < 2) return [];
    const like = `%${term.replace(/[%_]/g, (c) => '\\' + c)}%`;
    const r = await q(
      `select id, coalesce(nullif(name,''), email) as name, email
         from users
        where role = 'seller' and active is not false
          and (name ilike $1 or email ilike $1)
        order by name limit 12`, [like]);
    return r.rows.map((x) => ({ seller_id: x.id, channel: `support-${x.id}`, name: x.name, email: x.email }));
  });

  app.post('/api/orders/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const { channel, orderRef } = await resolveChannel(req.params.id);
    if (!(await canSeeThread(req.user, channel))) { reply.code(403); return { error: 'forbidden' }; }
    // Announcements are a broadcast, not a conversation: admin writes, sellers read.
    if (channel === 'announce' && req.user?.role !== 'admin') { reply.code(403); return { error: 'forbidden' }; }
    const b = req.body || {};
    // `escalated` is what makes "Talk to a human" mean something. Without it every
    // support message looked identical to staff, so an explicit request for help was
    // indistinguishable from small talk. Only a SELLER can raise one.
    const escalated = !!b.escalated && !isStaff(req.user);
    // order_ref is what replaced the per-order channel: it keeps "which order is this
    // about" without giving the order its own room.
    // Explicit order id in the URL wins; otherwise an @mention in the body decides
    // what this message is about.
    const channelSeller = channel.indexOf('support-') === 0 ? channel.slice(8) : null;
    const ref = orderRef || (b.orderRef ? String(b.orderRef) : null)
      || (await resolveMention(b.text, channelSeller));
    const meta = { by: b.by || null, system: !!b.system, internal: !!b.internal, ts: b.ts || null, escalated };
    if (ref) meta.order_ref = ref;
    await q(
      `insert into order_messages (order_id, sender_id, sender_role, body, attachment, meta, client_id)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (client_id) where client_id is not null do nothing`,
      [channel, req.user.sub, b.role || 'seller', b.text || '',
       (b.attachment && typeof b.attachment === 'object') ? b.attachment : null,
       JSON.stringify(meta), b.clientId || null]);
    egBroadcast({ type: 'order-message' });

    // Tell somebody. A message that only lands in a table nobody is watching is how
    // "Talk to a human" used to disappear silently.
    // Three channels, so three notification flows. Each excludes the sender — a bell
    // for your own message was noise that made the real ones easier to miss.
    const body = String(b.text || '').slice(0, 140);
    // "on #4099" reads better than a bare uuid, and only costs a lookup when there's a ref.
    let about = '';
    if (ref) {
      const o = (await q('select seq from orders where id=$1', [ref])).rows[0];
      about = ` on ${o?.seq ? '#' + o.seq : ref}`;
    }
    if (channel === 'staff-general') {
      notify({
        roles: ['admin', 'operator', 'warehouse', 'designer'], excludeUserId: req.user.sub,
        type: 'staff-message', title: `${b.by || 'A teammate'} posted in the factory channel${about}`,
        body, href: '/chat', entityId: ref || channel,
      });
    } else if (channel === 'announce') {
      notify({
        roles: ['seller'], excludeUserId: req.user.sub,
        type: 'announcement', title: b.by ? `Announcement from ${b.by}` : 'Announcement',
        body, href: '/chat', entityId: channel,
      });
    }
    // Whoever answers should see the internal picture before they reply. Fire-and-
    // forget: the message is already saved, the brief catches up a moment later.
    if (ref && channel !== 'announce') postOrderBriefing(channel, ref);

    if (channel.indexOf('support-') === 0) {
      const fromSeller = !isStaff(req.user);
      if (fromSeller) {
        // An escalation gets its own type + wording so an explicit request for help
        // stands out from ordinary chatter.
        notify({
          roles: ['admin', 'operator', 'warehouse'], excludeUserId: req.user.sub,
          type: escalated ? 'support-escalation' : 'support-message',
          title: escalated ? `${b.by || 'A seller'} asked for a human` : `${b.by || 'A seller'} sent a message${about}`,
          body, href: '/chat', entityId: ref || channel,
        });
      } else {
        notify({
          userIds: [channel.slice(8)], excludeUserId: req.user.sub,
          type: 'support-message', title: `EGFULFILL replied${about}`,
          body, href: ref ? `/orders/${ref}` : '/chat', entityId: ref || channel,
        });
      }
    }
    return { ok: true };
  });

  app.get('/api/orders/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const { channel, orderRef } = await resolveChannel(req.params.id);
    if (!(await canSeeThread(req.user, channel))) { reply.code(403); return { error: 'forbidden' }; }
    // Asking by order id gives the order's slice of the channel; asking by channel id
    // gives the whole conversation. Same table, two views.
    // Internal messages — staff order briefings and internal notes — live in the
    // SAME channel as the seller conversation, so they must be filtered out on the
    // way to a seller. Doing it in SQL, not in the client, is the point: this is the
    // only read path, and a seller must never receive the row at all.
    const r = await q(
      `select id, sender_role, body, attachment, meta, client_id, created_at
         from order_messages where order_id=$1
           and ($2::text is null or meta->>'order_ref' = $2)
           and ($3::boolean or not coalesce((meta->>'internal')::boolean, false))
         order by created_at asc, id asc`, [channel, orderRef, isStaff(req.user)]);
    // Reconstruct the client entry shape so getOrderChat round-trips unchanged.
    return r.rows.map((m) => {
      const meta = m.meta || {};
      const e = { id: m.client_id || m.id, by: meta.by || (m.sender_role || 'Unknown'),
        role: m.sender_role || 'seller', text: m.body || '',
        ts: meta.ts || (m.created_at ? new Date(m.created_at).getTime() : 0), system: !!meta.system };
      if (m.attachment) e.attachment = m.attachment;
      if (meta.internal) e.internal = true;
      // Which order this message is about, now that orders don't own channels.
      if (meta.order_ref) e.orderRef = String(meta.order_ref);
      return e;
    });
  });
}
