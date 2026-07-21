// Orders API. Permissions enforced in code (your backend replaces Supabase RLS):
//   • seller  → only their own orders
//   • staff   → all orders
import { q } from '../db.js';
import { hashOf, isPhash } from '../fingerprint.js';
import { isStaff } from '../auth.js';
import { egBroadcast } from '../events.js';
import { notify } from './notifications.js';
import { audit } from '../audit.js';
import { quoteOrder, freezeQuote } from '../pricing.js';
import { moveFunds, balanceOf } from './wallet.js';
import { orderCharges, refundOrder } from './order_refunds.js';
import { reserveConsigned, releaseConsigned } from './consignment.js';
import { autoReplenish } from '../replenish.js';
import { storageEnabled, putObject, fromDataUrl, presignGet, publicUrl, designUrlTtlDays } from '../storage.js';

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
  // Save one design (data URL) for an order item. Upsert by (order, sku, kind).
  app.post('/api/orders/:id/designs', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const { sku, data, name, kind, pos } = req.body || {};
    if (!sku || !data) return { error: 'sku and data required' };
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
      `insert into order_designs (order_id, sku, kind, data, storage_key, name, pos, art_hash, art_phash, updated_at)
       values ($1,$2,$3,$4,$9,$5,$6,$7,$8, now())
       on conflict (order_id, sku, kind) do update set data=excluded.data, storage_key=excluded.storage_key, name=excluded.name, pos=excluded.pos,
         art_hash=excluded.art_hash, art_phash=coalesce(excluded.art_phash, order_designs.art_phash), updated_at=now()`,
      [req.params.id, sku, kind || 'raster', storedData, name || null, posJson, artHash, artPhash, storedKey]
    );
    audit(req, 'design.saved', { entityType: 'order', entityId: req.params.id, after: { sku, kind: kind || 'raster', name: name || null } });
    return { ok: true };
  });
  // Fetch all designs for one order — called lazily when the order is opened, so a
  // big base64 payload never rides along on the main /api/orders list.
  app.get('/api/orders/:id/designs', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const r = await q(`select sku, kind, data, storage_key, name, pos from order_designs where order_id=$1`, [req.params.id]);
    // Minted per read, not stored: a signed URL expires, so a persisted one would go
    // stale. Returned through `data` because that's what every client already renders
    // (an <img src> takes a URL or a data-URL either way).
    return r.rows.map((row) => {
      const url = designUrlOf(row);
      return { sku: row.sku, kind: row.kind, name: row.name, pos: row.pos, data: url || row.data, url };
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
  // out of both seller-facing channels (the seller's support thread and the seller↔
  // factory order thread) and get `design-<orderId>` instead, which the seller can't see.
  function canSeeThread(user, channelId) {
    const id = String(channelId);
    const role = user?.role;
    if (id.indexOf('design-') === 0) return isStaff(user);          // staff-only, never the seller
    if (id === 'staff-general') return isStaff(user);               // internal room — designers included
    if (id.indexOf('support-') === 0) {
      if (isStaff(user)) return role !== 'designer';
      return id === ('support-' + user.sub);
    }
    if (role === 'designer') return false;                          // seller↔factory order thread
    return canSeeOrder(user, channelId);
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

  app.post('/api/orders/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeThread(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const b = req.body || {};
    // `escalated` is what makes "Talk to a human" mean something. Without it every
    // support message looked identical to staff, so an explicit request for help was
    // indistinguishable from small talk. Only a SELLER can raise one.
    const escalated = !!b.escalated && !isStaff(req.user);
    const meta = { by: b.by || null, system: !!b.system, internal: !!b.internal, ts: b.ts || null, escalated };
    await q(
      `insert into order_messages (order_id, sender_id, sender_role, body, attachment, meta, client_id)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (client_id) where client_id is not null do nothing`,
      [req.params.id, req.user.sub, b.role || 'seller', b.text || '',
       (b.attachment && typeof b.attachment === 'object') ? b.attachment : null,
       JSON.stringify(meta), b.clientId || null]);
    egBroadcast({ type: 'order-message' });

    // Tell somebody. A message that only lands in a table nobody is watching is how
    // "Talk to a human" used to disappear silently.
    const isSupport = String(req.params.id).startsWith('support-');
    const isDesign = String(req.params.id).startsWith('design-');
    const fromSeller = !isStaff(req.user);
    if (isDesign) {
      // Artwork thread — designer ↔ factory. The seller is not part of this channel.
      notify({
        roles: ['admin', 'operator', 'warehouse', 'designer'],
        type: 'design-message',
        title: `Artwork note on ${String(req.params.id).replace('design-', '')}`,
        body: String(b.text || '').slice(0, 140),
        href: '/designer',
        entityId: req.params.id,
      });
    } else if (isSupport && fromSeller) {
      // Seller wrote in their support thread → alert the staff who answer it. An
      // escalation gets its own type + wording so it stands out from ordinary chatter.
      notify({
        roles: ['admin', 'operator', 'warehouse'],
        type: escalated ? 'support-escalation' : 'support-message',
        title: escalated ? `${b.by || 'A seller'} asked for a human` : `${b.by || 'A seller'} sent a message`,
        body: String(b.text || '').slice(0, 140),
        href: '/chat',
        entityId: req.params.id,
      });
    } else if (!isSupport) {
      // Order thread: notify the other side (seller ↔ factory).
      const o = (await q('select seller_id, seq from orders where id=$1', [req.params.id])).rows[0];
      if (o) {
        const num = o.seq ? `#${o.seq}` : req.params.id;
        if (fromSeller) notify({ roles: ['admin', 'operator', 'warehouse'], type: 'order-message', title: `New message on ${num}`, body: String(b.text || '').slice(0, 140), href: '/operator', entityId: req.params.id });
        else if (o.seller_id) notify({ userIds: [o.seller_id], type: 'order-message', title: `Reply on ${num}`, body: String(b.text || '').slice(0, 140), href: `/orders/${req.params.id}`, entityId: req.params.id });
      }
    }
    return { ok: true };
  });

  app.get('/api/orders/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeThread(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const r = await q(
      `select id, sender_role, body, attachment, meta, client_id, created_at
         from order_messages where order_id=$1 order by created_at asc, id asc`, [req.params.id]);
    // Reconstruct the client entry shape so getOrderChat round-trips unchanged.
    return r.rows.map((m) => {
      const meta = m.meta || {};
      const e = { id: m.client_id || m.id, by: meta.by || (m.sender_role || 'Unknown'),
        role: m.sender_role || 'seller', text: m.body || '',
        ts: meta.ts || (m.created_at ? new Date(m.created_at).getTime() : 0), system: !!meta.system };
      if (m.attachment) e.attachment = m.attachment;
      if (meta.internal) e.internal = true;
      return e;
    });
  });
}
