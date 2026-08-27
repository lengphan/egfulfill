// Orders API. Permissions enforced in code (your backend replaces Supabase RLS):
//   • seller  → only their own orders
//   • staff   → all orders
import crypto from 'node:crypto';
import { q } from '../db.js';
import { hashOf, isPhash } from '../fingerprint.js';
import { isStaff, resolveSeller as _resolveSeller, canSurface, canSeeMoney } from '../auth.js';
import { egBroadcast } from '../events.js';
import { notify } from './notifications.js';
import { aiComplete } from './support_ai.js';
import { sendMail, mailConfigured } from '../mailer.js';
import { supportReplyEmail } from '../emails.js';
import { audit } from '../audit.js';
import { isGrantEnabled } from './role_grants.js';
import { designNoFor, designLabel, ensureDesignIds } from '../design-id.js';
import { quoteOrder, freezeQuote, catalogIndex, resolveBlankName, priceLines, computeTotals, feeSettings } from '../pricing.js';
import { moveFunds, balanceOf } from './wallet.js';
import { readAll } from './factory_settings.js';
import { orderCharges, refundOrder } from './order_refunds.js';
import { reserveConsigned, releaseConsigned } from './consignment.js';
import { autoReplenish } from '../replenish.js';
import { reserveForOrder, releaseForOrder, consumeForOrder, restoreForOrder } from '../reserve.js';
import { storageEnabled, putObject, getObject, fromDataUrl, presignGet, publicUrl, designUrlTtlDays } from '../storage.js';
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
// THE LINE DESCRIBES PRODUCTION. NOTHING ELSE.
//
// 'awaiting_scan' was removed for the same reason 'printed' was before it: it is not a
// state of the GOODS. It described where the LABEL had got to — bought, queued, waiting on
// the scan service — and a label's journey runs BESIDE production, not through it. One
// column can hold one value, so the label kept winning it: a cap being embroidered read
// "Awaiting scan", and an order byeastside had already picked read "Awaiting scan" too,
// because the partner sync writes label_scanned_at and never touches the stage.
//
// That fact has a home already — `label_scanned_at`, plus the Label/Scan chips the row has
// always carried (web/lib/order-readiness.ts). The dispatch queue is now read from those:
// a label we bought, not yet scanned. Legacy rows fold to 'working' below, exactly as
// 'printed'/'scanned'/'packing' already do.
/* Approved sits between the seller's submission and production: a person has selected or
   confirmed the blank on every line. See FACTORY_STAGES in web/lib/factory-status.ts —
   these two mirror each other and must change together. 'approved' was in the retired list
   below, folding onto working; it is out of it now, and no live row carried it. */
const PIPELINE = ['in_review', 'approved', 'working', 'shipped'];
// Flagged + Backorder were retired; normalizeStage collapses any legacy value onto on_hold.
const EXCEPTIONS = ['on_hold', 'cancelled', 'refunded'];
// EXPORTED so tools/check-order-rules.mjs can EXECUTE it against web/shared/order-rules.ts
// rather than compare the two by eye. Nothing else imports it; the export is the seam the
// drift guard needs, and reading a rule is what let three divergences through before.
export function normalizeStage(s) {
  const v = String(s || '').toLowerCase().trim();
  if (['new', 'draft', 'none', 'pending'].includes(v)) return '';
  if (PIPELINE.includes(v) || EXCEPTIONS.includes(v)) return v;
  // Every retired id folds onto 'working' — they all meant "accepted and being made",
  // whatever paperwork step they were named after. 'awaiting_scan' joins them: the 3 orders
  // and 6 line items still carrying it were accepted into production, which is what
  // 'working' says, and their label state is read from label_scanned_at as it always was.
  if (['ready_print', 'in_queue', 'queued', 'prescan', 'printed', 'label', 'labelled', 'labeled',
       'awaiting_scan', 'awaiting-scan',
       'scanned', 'printing', 'qc', 'production', 'in_production', 'in-prod', 'prepress',
       'packing', 'packed', 'ready', 'finished'].includes(v)) return 'working';
  if (['fulfilled', 'delivered', 'in_transit'].includes(v)) return 'shipped';
  // Flagged + Backorder were retired — collapse them and their aliases onto on_hold, the one
  // remaining stop, so an existing order at either keeps a valid, actionable stage.
  if (['flagged', 'escalated', 'action', 'backorder', 'replacement'].includes(v)) return 'on_hold';
  return '';
}

// Who may set which stage. The operator's zone ends at the scan, because a stage is a
// claim about PHYSICAL CUSTODY: once the warehouse holds the goods, only they (or
// admin) can report where it is — an operator setting 'working' asserts a fact they
// cannot observe. Two deliberate carve-outs from that rule:
//   • on_hold is a STOP signal, not a custody claim, so artwork review can pull the andon
//     cord at ANY stage. A design defect often only shows on the printed garment — the
//     blank is sunk by then, but the reprint and reship aren't. A stop neither advances
//     nor rewinds; it parks the item for warehouse/admin.
//   • cancelled/refunded are money calls (admin). The operator puts it on hold; whoever
//     has the authority resolves.
// An operator may accept work INTO production; they still cannot claim it left.
//
// THE ZONE ENDS AT APPROVED, NOT AT WORKING. It said 'working' because it was written
// before Approved existed, and inserting a stage into PIPELINE silently moved the boundary
// without anyone changing this line: the operator kept the stage one PAST the one that is
// actually theirs, and lost the one the new stage was added FOR. So an operator pressing
// Approve — the control the web offers them as their own job — got a 403 whose text still
// named 'Awaiting scan', a stage retired two refactors ago.
//
// Confirming the blank on every line IS the operator's job, and Approved is where that
// judgement is recorded. Committing the order to production is the WAREHOUSE's call, made
// by whoever is going to make the thing. That handover is the whole reason there are two
// stages rather than one, so Working is out of reach here even though Approved is not.
//
// MIRRORS OP_ZONE in web/lib/factory-status.ts — the web is canonical; change both.
const OP_ZONE = new Set(['', 'in_review', 'approved']);   // normalized
const OP_STOPS = new Set(['on_hold']);
const MONEY_STAGES = new Set(['cancelled', 'refunded']);

// The linear order, '' (Received) first, for adjacency checks. EXCEPTIONS are deliberately
// absent: a stop is not a position on this line, which is why it can be entered from
// anywhere and never counts as a skip.
//
// TWO LINES, BECAUSE `in_review` IS A SELLER STAGE, NOT A STEP OF MAKING ANYTHING.
//
// "Pending" means: the seller submitted, we took their money, and we have not accepted the
// job yet. A factory-owned order has no seller, is never charged (the charge lives in the
// `if (sel)` block, and staff resolve to sel = null) and approves itself — so the stage
// cannot describe anything true about it. It was only ever passed THROUGH, to satisfy the
// one-step rule: the floor's own orders were walked new → in_review → working in under a
// second, and any that stopped halfway sat in the seller queue looking like work someone
// was waiting on us for.
//
// So for those orders the stage simply isn't on the line: '' → working is one step.
// This does not weaken the skip rule. That rule exists so nobody can assert PHYSICAL WORK
// that didn't happen — printed, scanned, shipped. in_review is a payment-and-approval
// state that cannot exist for a factory order, so stepping over it asserts nothing at all.
// Every other hop stays one-at-a-time, for every role, exactly as before.
const SELLER_LINE = ['', ...PIPELINE];
const FACTORY_LINE = SELLER_LINE.filter((s) => s !== 'in_review');
const lineFor = (isFactory) => (isFactory ? FACTORY_LINE : SELLER_LINE);
// -1 for anything off this order's line — a stop, or (for a factory order) the legacy
// in_review rows written before this. Off-line means "not a position", so it is never a
// skip in either direction, which is what lets those rows be moved anywhere forward.
const posOf = (s, isFactory = false) => lineFor(isFactory).indexOf(normalizeStage(s));
// Human names, so a refusal can say which stages would be skipped rather than printing
// the internal ids at someone.
// COMPLETE, because the fallback below is `STAGE_LABEL[s] || s` — a missing entry does not
// fail, it prints the raw id. 'approved' was inserted into PIPELINE and never added here, so
// every refused skip past it read "That would skip Pending, approved." to whoever tried.
// Found by tools/check-order-rules.mjs, which runs this against web/shared/order-rules.ts.
const STAGE_LABEL = {
  '': 'Draft', in_review: 'Pending', approved: 'Approved', working: 'Working',
  shipped: 'Shipped', on_hold: 'On hold', cancelled: 'Cancelled', refunded: 'Refunded',
};

/**
 * Would this move SKIP part of the pipeline?
 *
 * Forward moves must be one step. Nothing enforced this before: warehouse's rule was
 * "anything that isn't a money stage" and admin's was "anything", so Received → Shipped
 * was one click, and an order could be marked shipped having never been scanned, printed
 * or made. The stages are a record of what physically happened to the goods; letting one
 * be asserted without the ones before it makes the whole record untrustworthy, and it is
 * the report the floor and the seller both read.
 *
 * Backwards is NOT a skip and stays open — correcting a mis-click has to remain possible,
 * and stepping back to any earlier stage is a claim that less has happened, which is
 * always safe to assert. Entering or leaving a stop is likewise never a skip.
 */
function skipsPipeline(current, target, isFactory = false) {
  const at = posOf(current, isFactory), to = posOf(target, isFactory);
  if (at < 0 || to < 0) return false;      // a stop at either end — not on the line
  return to > at + 1;
}

/**
 * null = allowed; a string = the refusal shown to the user.
 *
 * `isFactory` — this order belongs to the factory rather than to a seller (orders.factory_order,
 * derived from the owner's role). It selects which line the adjacency rules read; see the note
 * on FACTORY_LINE. Defaults false, so a caller that doesn't know is held to the stricter line.
 */
export function stageDenial(role, current, target, isFactory = false) {
  const at = normalizeStage(current), to = normalizeStage(target);

  // SKIPPING IS DENIED FOR EVERYONE, admin included. This is not a permission — it is
  // what the pipeline MEANS. An admin has the authority to correct any record; nobody has
  // the authority to make an order have been printed when it wasn't. Admin keeps every
  // other freedom: backwards, stops, money stages, one step at a time as far as they like.
  if (skipsPipeline(at, to, isFactory)) {
    const missed = lineFor(isFactory).slice(posOf(at, isFactory) + 1, posOf(to, isFactory));
    return `That would skip ${missed.map((s) => STAGE_LABEL[s] || s).join(', ')}. Move it one stage at a time.`;
  }

  // A shipped order is done — the only change left is a Refund (un-shipping can't reverse the
  // buyer's tracking, and it's too late to cancel). Every role; Refund is admin-gated below.
  // Mirrors stageDenialReason in web/lib/factory-status.ts.
  if (at === 'shipped' && to !== 'shipped' && to !== 'refunded') {
    return 'This order has shipped — the only change left is a refund.';
  }

  /**
   * CANCELLED AND REFUNDED ARE THE END. Every role, admin included.
   *
   * They were not terminal at all: a cancelled order could be put ON HOLD, which is a
   * production state for work that is going to continue, on an order that is not. Worse, the
   * hold remembers where it came from so it can be resumed — so cancelling, holding, then
   * clearing the hold offered "Back to Cancelled", and the board grew a button that undid a
   * stop by returning the order to a stop.
   *
   * A cancelled order may still be REFUNDED, because the money is a separate fact from the
   * work and often settles later. A refunded one is finished outright.
   *
   * Mirrors stageDenialReason in web/lib/factory-status.ts.
   */
  if (at === 'cancelled' && to !== 'cancelled' && to !== 'refunded') {
    return 'This order was cancelled — the only change left is a refund.';
  }
  if (at === 'refunded' && to !== 'refunded') {
    return 'This order was refunded. That is the end of it.';
  }

  /**
   * A PAID ORDER CANNOT BE DRAFT. Every role, admin included.
   *
   * Draft is not a stage — it is a statement about money: nobody submitted this and nobody
   * was charged. So an order sitting at Draft with a charge against it is a contradiction
   * the rest of the system then acts on: the seller's Submit unlocks (their own zone is
   * ['', 'new', 'draft', 'in_review']), the order reads untouched and editable, and the
   * money stays taken. This was the operator's rule alone, which meant the two roles most
   * likely to be tidying up a board were the two who could create the contradiction.
   *
   * It takes nothing away. Every real reason to reach for it is already served, and served
   * honestly: a mis-click steps back one stage inside production, a pause is On hold, and
   * an order that should not be made is Cancelled — which refunds. Only the word Draft is
   * refused, because it is the only one of the four that says something untrue.
   *
   * Never applies to a factory order: nothing was ever charged on one, so "this has been
   * paid for" would be a false statement about the floor's own work.
   */
  if (!isFactory && (to === '' || to === 'new' || to === 'draft') && posOf(at, isFactory) > posOf('', isFactory)) {
    return 'This order has been paid for, so it cannot go back to Draft. Step it back one stage, put it on hold, or cancel it to refund.';
  }

  if (role === 'admin') return null;
  if (role === 'warehouse') {
    if (MONEY_STAGES.has(to)) return 'Cancelling or refunding is an admin decision.';
    /**
     * PRODUCTION STARTS FROM APPROVED, and only from there.
     *
     * Approved means an operator has confirmed the blank on every line — the whole reason
     * the stage exists. Starting from Pending would be the warehouse making that judgement
     * itself, on an order whose variants may still be unset, which is the case Approved was
     * added to catch.
     *
     * Coming off a HOLD is not starting production — it is putting the order back where the
     * stop found it, which may well be Working. Gating that on Approved would strand every
     * held order that was already being made.
     *
     * MIRRORS stageDenialReason in web/lib/factory-status.ts — change both.
     */
    if (to === 'working' && at !== 'approved' && at !== 'on_hold') {
      return 'Start it from Approved — an operator confirms the blank first.';
    }
    return null;
  }
  if (role === 'operator') {
    if (MONEY_STAGES.has(to)) return 'Cancelling or refunding is an admin decision — put the order on hold instead.';
    if (OP_STOPS.has(to)) return null;                        // andon cord: any stage
    // Raising a stop is the operator's; CLEARING one is not — that's the whole point of
    // handing the decision over. (An operator who mis-flags needs warehouse/admin to
    // resume it. Accepted: factory_status is one field, so a stop overwrites the stage
    // it interrupted and there's nothing to resume TO without a human deciding.)
    /**
     * AND THE CORD LETS GO. Raising a stop is an operator's right from any stage; releasing
     * it has to be the same right, or the andon cord is a trap — the one who pulled it
     * cannot undo a false alarm, and has to go and find a warehouse to say "never mind".
     *
     * Coming off hold is not starting production: it is putting the order back where it was
     * before the stop, which is why it is allowed even to Working, which an operator may not
     * otherwise set. Money stages are still refused above, and cancelled/refunded are
     * already terminal for every role further up, so this only ever releases on_hold.
     *
     * MIRRORS stageDenialReason in web/lib/factory-status.ts — the web is canonical.
     */
    if (at === 'on_hold') return null;
    /**
     * AN OPERATOR APPROVES; THE WAREHOUSE STARTS. See OP_ZONE above — tested explicitly so
     * the refusal can say whose call it is rather than "that's out of your zone".
     */
    if (to === 'working') return 'Approving is yours — the warehouse starts production from there.';
    if (!OP_ZONE.has(at)) return 'The warehouse has this item — only warehouse or admin can change its status now.';
    if (!OP_ZONE.has(to)) return 'Operators can move an item as far as Approved.';
    // Reverting OUT of in_review un-does a submission the seller was CHARGED for. The
    // charge is idempotent so nothing double-bills, but the order goes back to looking
    // untouched while the money stays taken — and the seller sees it as editable again.
    // Anything that leaves a paid order looking unpaid is warehouse or admin.
    // The test is the DESTINATION, not the origin. Written as `at === 'in_review'` it only
    // blocked the direct hop, and OP_ZONE holds the next stage along too — so the same move
    // went through in two clicks:
    //     Submitted --X--> Received        blocked
    //     Submitted --OK--> Working --OK--> Received     same result, guard skipped
    // Anything that has reached in_review has been PAID for; sending it back to Received
    // makes a paid order read as untouched and editable while the money stays taken. That
    // is true whichever stage it is sent back FROM, so the rule is about where it lands.
    // The whole justification is the CHARGE, so it cannot apply to a factory order —
    // nothing was ever taken, and refusing an operator with "this order has been paid for"
    // would be telling them something untrue about their own floor's order. Custody is
    // still protected: the OP_ZONE tests above already stop them touching anything the
    // warehouse holds, so the most this permits is walking back a mis-click of their own.
    // (Sending a paid order back to Draft is refused for every role above — this used to
    // be the only copy of that rule, which is how warehouse and admin kept the hole.)
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
  /**
   * SAME-ORIGIN FIRST — because the "permanent public address" isn't one.
   *
   * With DESIGN_URL_TTL_DAYS=0 this returned publicUrl(), which prefers SPACES_CDN when it
   * is set. It is set, to cdn.egful.store — a host that has never been connected and
   * answers NXDOMAIN. So every storage-backed order design pointed at a hostname that does
   * not exist, and the artwork simply never loaded. Measured on the live database: 16 rows
   * affected (the other 173 hold inline base64 and were never routed through this).
   *
   * Nor would dropping the CDN alias fix it: the bucket is PRIVATE, so its direct address
   * refuses an unsigned read. A public URL was never the right shape for these bytes.
   *
   * So they are re-served through this API, exactly as design_cards already does for card
   * artwork (/api/design_cards/art/:hash) and for exactly the same reason — that route
   * exists because this problem was solved once already, on the other table. Keyed by the
   * content hash, which is unguessable, so an <img> that cannot send an auth header still
   * loads. Rows written before art_hash existed fall back to the old behaviour rather than
   * losing their link.
   */
  if (row.art_hash) {
    const ext = (String(row.storage_key).match(/\.[a-z0-9]+$/i) || [''])[0] || '';
    return `/api/order_designs/art/${row.art_hash}${ext}`;
  }
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

  const design = await q('select data, art_hash, storage_key from order_designs where order_id=$1 and sku=$2 limit 1',
    [orderId, it.sku]).then((r) => r.rows[0]).catch(() => null);
  // storage_key COUNTS AS ARTWORK. Once object storage was switched on `data` is null on
  // every new row, so a line with perfectly good artwork reported 'no-artwork' here and
  // never reached the board.
  const hasArt = !!((design && (design.data || design.storage_key)) || it.design_src);
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
  // A stored design contributes its same-origin address for the same reason — it is a short
  // string rather than a megabyte of base64, and it does not expire the way a signed link does.
  const thumb = it.design_src
    || (design && design.storage_key && design.art_hash ? `/api/order_designs/art/${design.art_hash}` : null)
    || (design && design.data) || null;
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

/**
 * WHY THIS ORDER CANNOT BE APPROVED YET, or an empty list.
 *
 * APPROVED WAS A CLAIM NOBODY CHECKED. Two separate comments in this file describe it as
 * "the stage where a human has confirmed the blank on every line" — it is the reason the
 * stage exists, and the reason variant editing locks the moment it is reached. Nothing
 * verified it. stageDenial gates WHO may move a stage and IN WHAT ORDER; it never asked
 * whether the line being approved was finished.
 *
 * So an order with no blank, no colour, no size and no artwork walked Pending → Approved →
 * Working without a word, and the first refusal came at shipBlockers — which runs only at
 * SHIPPED. That is the worst possible arrangement of a guard: too late to stop the work
 * being done, and after the point where the variant fields lock, so the correction it
 * demands is already sealed off.
 *
 * What it refuses, and why each one is genuinely unmakeable rather than merely untidy:
 *   · NO BLANK — there is no garment. This is the exact thing Approved claims to confirm.
 *   · A COLOUR OR SIZE the blank offers and the line has not picked. Only when the catalog
 *     actually lists that axis: plenty of blanks have neither, and demanding a size for a
 *     patch would block work that is perfectly ready. Marketplace orders arrive with
 *     variants UNSET by design (CLAUDE.md §5), which is precisely why an operator has to
 *     set them, and precisely why nothing should move past Approved until they have.
 *   · A PRINT METHOD WITH NO ARTWORK — reuses missingArtwork, the same rule the ship gate
 *     already applies, just asked at the point where it can still be fixed cheaply.
 *
 * Not checked: a label, or anything about money. Those belong to shipping and are already
 * shipBlockers' job — an order can be entirely ready to MAKE with no postage bought.
 */
/**
 * THE DECISION, with the database taken out of it.
 *
 * Separated so it can be driven with real inputs and asserted. The alternative is mocking
 * q(), and a mock that answers regardless of the query is exactly what once hid a SELECT
 * naming a column that did not exist (CLAUDE.md §7). This half has no I/O, so a test of it
 * is a test of the shipped code rather than of a stand-in.
 *
 * `axes` maps a blank's sku to whether the catalog offers colours/sizes for it at all.
 */
export function approvalBlockersFor(items, missing, axes) {
  if (!items.length) return ['this order has no lines on it'];
  const label = (it) => it.name || it.sku || 'a line';
  const axisOf = (it) => axes.get(String(it.blank || '').trim());

  const noBlank = items.filter((it) => !String(it.blank || '').trim()).map(label);
  const noColour = items.filter((it) => {
    const a = axisOf(it); return a && a.colors && !String(it.color || '').trim();
  }).map(label);
  const noSize = items.filter((it) => {
    const a = axisOf(it); return a && a.sizes && !String(it.size || '').trim();
  }).map(label);

  const list = (xs) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? '\u2026' : '');
  const many = (xs, one, more) => (xs.length === 1 ? one : more);
  const blockers = [];
  if (noBlank.length) blockers.push(`no blank picked on ${noBlank.length} ${many(noBlank, 'line', 'lines')}: ${list(noBlank)}`);
  if (noColour.length) blockers.push(`no colour picked on ${noColour.length} ${many(noColour, 'line', 'lines')}: ${list(noColour)}`);
  if (noSize.length) blockers.push(`no size picked on ${noSize.length} ${many(noSize, 'line', 'lines')}: ${list(noSize)}`);
  if (missing.length) blockers.push(`${missing.length} ${many(missing, 'item', 'items')} still ${many(missing, 'has', 'have')} no artwork: ${list(missing)}`);
  return blockers;
}

/**
 * WHY THIS ORDER CANNOT BE APPROVED YET, or an empty list.
 *
 * APPROVED WAS A CLAIM NOBODY CHECKED. Two separate comments in this file describe it as
 * "the stage where a human has confirmed the blank on every line" — it is the reason the
 * stage exists, and the reason variant editing locks the moment it is reached. Nothing
 * verified it. stageDenial gates WHO may move a stage and IN WHAT ORDER; it never asked
 * whether the line being approved was finished.
 *
 * So an order with no blank, no colour, no size and no artwork walked Pending -> Approved
 * -> Working without a word, and the first refusal came at shipBlockers, which runs only at
 * SHIPPED. That is the worst arrangement of a guard available: too late to stop the work,
 * and after the point where the variant fields lock, so the correction it demands is
 * already sealed off.
 *
 * A colour or size is only required where the CATALOG offers that axis — plenty of blanks
 * have neither, and demanding a size for a patch would block work that is perfectly ready.
 * Marketplace orders arrive with variants UNSET by design (CLAUDE.md §5), which is exactly
 * why an operator has to set them and exactly why nothing should pass Approved until done.
 *
 * Not checked: a label, or anything about money. Those are shipping's business and already
 * shipBlockers' job — an order can be entirely ready to MAKE with no postage bought.
 */
export async function approvalBlockers(orderId) {
  const [items, missing] = await Promise.all([
    q(`select sku, name, blank, color, size, print_type from order_items where order_id=$1`, [orderId])
      .then((r) => r.rows).catch(() => []),
    missingArtwork(orderId),
  ]);
  const blanks = [...new Set(items.map((it) => String(it.blank || '').trim()).filter(Boolean))];
  const axes = new Map();
  if (blanks.length) {
    const rows = await q(
      `select sku, colors, sizes from catalog_products where sku = any($1::text[])`, [blanks]
    ).then((r) => r.rows).catch(() => []);
    const arr = (v) => (Array.isArray(v) ? v : (() => { try { return JSON.parse(v || '[]'); } catch (e) { return []; } })());
    for (const r of rows) axes.set(String(r.sku), { colors: arr(r.colors).length > 0, sizes: arr(r.sizes).length > 0 });
  }
  return approvalBlockersFor(items, missing, axes);
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
/**
 * `extra` is the design/check fee charged ALONGSIDE production — see the submit block in
 * PATCH /api/orders/:id. It is not moved here (each design fee is its own ledger row, with
 * its own ref, so it can be refunded on its own), but it IS part of what the seller is
 * about to pay, so the balance has to cover both. Testing production alone let an order
 * through on a wallet that could fund the garment and not the fee, and the fee then failed
 * silently after the goods were already on the floor.
 */
async function chargeForSubmit(orderId, sellerId, by, hideMoney = false, extra = 0) {
  /**
   * ALREADY PAID, OR PAID AND GIVEN BACK? THEY ARE NOT THE SAME ANSWER.
   *
   * This asked chargedAmount() — the sum of the CHARGE leg alone. A refund writes its own
   * type and never subtracts from that leg, so an order charged $50 and refunded $50 still
   * read "charged" and this returned ok without moving a cent.
   *
   * Reachable, and it produces goods for free. An admin may set any stage, so: charge →
   * full refund → back to Draft → submit. The seller has their money, the floor has the
   * order, and nothing bills. Re-charging is not the fix either — moveFunds is idempotent
   * on (ref, type) and the ref is the order id, so a second charge on the same order is
   * deduped and silently moves nothing, which lands in exactly the same place.
   *
   * So a retry still passes (charged, nothing refunded → net > 0 → already), and an order
   * whose money has been handed back is REFUSED with the way forward: Duplicate makes a new
   * order with a new id, an empty ledger, and therefore a real charge.
   */
  const state = await orderCharges(orderId).catch(() => null);
  const charged = state ? Number(state.charged) || 0 : await chargedAmount(orderId);
  const net = state ? Number(state.refundable) || 0 : charged;
  if (charged > 0 && net > 0) return { ok: true, already: true };
  if (charged > 0 && net <= 0) {
    return { error: 'This order was charged and then refunded in full, so it cannot be submitted again. Duplicate it instead — the copy is charged properly.',
             refundedInFull: true, charged };
  }
  const quote = await quoteOrder(orderId);
  if (quote.unpriced.length) {
    // No catalog match = no cost. Charging 0 would fulfil it free, forever, silently.
    const names = quote.unpriced.map((u) => u.sku).join(', ');
    return { error: `These items aren't in the catalog yet, so they can't be priced: ${names}. Pick a catalog product for them first.`, unpriced: quote.unpriced };
  }
  if (!quote.lines.length) return { error: 'This order has no items to produce.' };
  if (quote.total <= 0) return { error: 'This order prices out at $0 — check the catalog base cost.' };
  const balance = await balanceOf(sellerId);
  const due = Math.round((quote.total + (Number(extra) || 0)) * 100) / 100;
  if (balance < due) {
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
    return { error: `Not enough balance. This order costs $${due.toFixed(2)} and your wallet has $${balance.toFixed(2)}.`,
             shortfall: Math.round((due - balance) * 100) / 100, required: due, balance, quote };
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

/** Money as a seller reads it. Bare numbers in a sentence about a charge read as
 *  quantities — "came to 2" is not a price. */
const fmtMoney = (n) => `$${(Number(n) || 0).toFixed(2)}`;

/**
 * WHICH MARKETPLACE AN ORDER BELONGS TO — its own id, or the one it is a copy of.
 *
 * One rule, because two things ask: the tracking push, and the notice telling a seller
 * their channel still shows the order as open. If those two ever disagreed, we would push
 * tracking to a shop we had just told the seller we could not reach.
 */
const CHANNEL_NAME = { etsy: 'Etsy', shopify: 'Shopify', tiktok: 'TikTok Shop' };
function marketplaceChannelOf(order) {
  const of = (v) => (/^etsy-/i.test(v) ? 'etsy' : /^shopify-/i.test(v) ? 'shopify' : /^tiktok-/i.test(v) ? 'tiktok' : null);
  const id = String((order && order.id) || '');
  const meta = order && order.meta && typeof order.meta === 'object' ? order.meta : {};
  return of(id) || of(String(meta.duplicated_from || ''));
}

/**
 * WE SETTLED OUR SIDE. THEIRS IS STILL OPEN — say so, to the person who has to close it.
 *
 * Cancelling or refunding here moves money in the seller's EGFULFILL wallet: it reverses
 * what they paid US to make the thing. The buyer paid the MARKETPLACE, and that money is
 * the seller's own transaction with them — we have no access to it and could not touch it
 * if we wanted to. There is no outbound cancel or refund to any channel in this codebase,
 * deliberately.
 *
 * So the order sits open on Etsy with nobody working it, and the shop takes the
 * late-shipment hit — which is the kind of thing that puts a seller's account at risk (§2.6).
 * That gap was silent. It isn't now.
 *
 * Sent whoever pressed the button, INCLUDING the seller themselves: someone cancelling
 * their own order here has no particular reason to know that their channel didn't hear it.
 * Only for a marketplace order — a manual one has no channel to close.
 */
export async function notifyChannelStillOpen(orderId, what) {
  try {
    const o = (await q('select id, seller_id, meta from orders where id=$1', [orderId])).rows[0];
    if (!o || !o.seller_id) return;
    const channel = marketplaceChannelOf(o);
    if (!channel) return;
    const name = CHANNEL_NAME[channel] || channel;
    notify({
      userIds: [String(o.seller_id)],
      type: 'order-channel-open',
      title: `${name} still shows this order as open`,
      body: `Order ${orderId} was ${what} here and your wallet has been settled. We can't cancel or refund a buyer's order on your behalf — that part is yours to do on ${name}, and leaving it open counts against your shop.`,
      href: `/orders/${orderId}`,
      entityId: String(orderId),
    });
  } catch (e) { /* a missed bell must never break the cancel */ }
}

/**
 * Push a shipped order's tracking to its marketplace so the buyer's shop marks it shipped
 * (and, for Etsy, emails the buyer). Routes by the order's id prefix.
 *
 * GATED. It only sends for real when MARKETPLACE_FULFILL_LIVE=1 — a deliberate flip. Until
 * then it returns a logged DRY RUN (no send, no buyer email), so the whole routing is in
 * place and testable on a limited/test app without touching live buyers. The switch flips it
 * to production with no code change. Best-effort: the caller must never fail a ship over it.
 * Shopify + TikTok fulfilment aren't wired yet — the routing is here for when they are.
 */
async function pushMarketplaceTracking(order, tracking, carrier) {
  const id = String((order && order.id) || '');
  /**
   * WHICH CHANNEL — from the id, or from what this order is a copy OF.
   *
   * A duplicate is minted as `FF-dup-…` with source 'manual', deliberately: a copy of an
   * Etsy order is not that order, and claiming it was would put a fake receipt in the
   * channel reports. But it still FULFILS the original's receipt — a reprint or a
   * replacement is the same buyer, still waiting, on the marketplace's clock.
   *
   * etsy.js already handles this (receiptIdOf falls back to meta.duplicated_from) and
   * could never be reached: this line read the id prefix alone, so every duplicate was
   * dropped as 'not-applicable' before the resolver saw it, and tracking had to be pasted
   * into the channel by hand on precisely the orders where someone is waiting.
   */
  const channel = marketplaceChannelOf(order);
  if (!channel || !tracking) return { skipped: 'not-applicable' };
  if (process.env.MARKETPLACE_FULFILL_LIVE !== '1') return { channel, dryRun: true, wouldSend: { tracking, carrier } };
  try {
    if (channel === 'etsy') {
      const { etsyPushTracking } = await import('./etsy.js');
      return await etsyPushTracking(order, tracking, carrier);
    }
    if (channel === 'shopify') {
      const { shopifyPushTracking } = await import('./shopify.js');
      return await shopifyPushTracking(order, tracking, carrier);
    }
    if (channel === 'tiktok') {
      const { tiktokPushTracking } = await import('./tiktok.js');
      return await tiktokPushTracking(order, tracking, carrier);
    }
    return { channel, skipped: 'not-wired' };
  } catch (e) {
    return { channel, error: (e && e.message) || 'push failed' };
  }
}

/**
 * Push an order's tracking to its marketplace, ONCE, from wherever the tracking came from.
 *
 * The push used to live only in the order-status PATCH, so it fired when someone marked the
 * order shipped — but the label-buy paths (usps.js) and the standalone-label attach
 * (dispatch.js) write `orders.tracking` with their own UPDATE and never went near it. Tracking
 * therefore existed on our side and never reached Etsy: five Etsy orders carried a number and
 * not one had `marketplace_fulfilled_at`, four of them still sitting at status `new`.
 *
 * `marketplace_fulfilled_at` is the once-only guard — it is stamped only on a real send, so a
 * re-save, a re-attach or a second caller can never re-email the buyer, and a dry run leaves it
 * null so flipping the gate later still fires the first real push.
 *
 * A TEST label must never come through here: it would mark a live receipt shipped and email a
 * real buyer a tracking number the carrier has never heard of. Callers pass `test` and get a
 * no-op. Best-effort by contract — the label is already bought and paid for, so nothing in here
 * may turn a successful purchase into a failed one. Never throws.
 */
export async function fulfillMarketplace(orderId, { test = false } = {}) {
  if (!orderId || test) return { skipped: test ? 'test-label' : 'no-order' };
  try {
    const o = (await q(
      // `meta` is not decoration here — it carries duplicated_from, which is how a copy
      // finds the receipt it fulfils. Without it every duplicate fell out as 'not-applicable'.
      'select id, store, seller_id, tracking, carrier, meta, marketplace_fulfilled_at from orders where id=$1',
      [orderId])).rows[0];
    if (!o || !o.tracking || o.marketplace_fulfilled_at) return { skipped: 'nothing-to-push' };
    const push = await pushMarketplaceTracking(o, o.tracking, o.carrier);
    if (push && push.ok) {
      await q('update orders set marketplace_fulfilled_at=now() where id=$1', [orderId]).catch(() => {});
    }
    return push;
  } catch (e) {
    return { error: (e && e.message) || 'push failed' };
  }
}

/**
 * WHAT A STAGE DOES TO THE SHELF — in one place, because two routes set stages.
 *
 * The order PATCH and the per-item status route were each holding their own half of this
 * and had already drifted: one reserved on working and released on shipped, the other did
 * the same but only released once every line was out. Neither ever decremented anything.
 *
 *   Pending / Approved   HOLD.      Accepted, not started — the units are committed to this
 *                                   order and must stop looking available to another, which
 *                                   is the whole job `reserved` was added for.
 *   Working              TAKE.      The blank comes off the rack. The hold is dropped in the
 *                                   same step, or the garment is subtracted twice.
 *   Shipped / On hold    NOTHING.   Already taken, and it stays taken — a stop pauses the
 *                                   work, it does not put the fabric back on the shelf.
 *   Draft / Cancelled / Refunded    GIVE BACK. The work will not happen (or has not begun),
 *                                   so anything this order took returns, and the hold with it.
 *
 * Best-effort by contract: a status change must never fail because a shelf number could not
 * be adjusted. Every verb inside is idempotent per order, so re-entering a stage settles.
 */
/**
 * Stamp the acceptance, once. Approved is the stage that means it, but working and shipped
 * both imply it — an order that reached either was accepted, whatever route it took — and
 * every row written before this column existed passed through none of them under this name.
 * coalesce, so the FIRST acceptance is the one on record.
 */
async function markApproved(orderId, stage) {
  if (!['approved', 'working', 'shipped'].includes(normalizeStage(stage))) return;
  await q('update orders set approved_at = coalesce(approved_at, now()) where id=$1', [orderId]).catch(() => {});
}

async function applyStockForStage(orderId, stage) {
  const at = normalizeStage(stage);
  try {
    if (at === 'working') return await consumeForOrder(orderId);
    if (at === 'in_review' || at === 'approved') {
      // Coming BACKWARDS out of production: give the units back first, then hold them
      // again. Doing it in the other order would leave the hold on top of a decrement.
      await restoreForOrder(orderId);
      return await reserveForOrder(orderId);
    }
    if (at === '' || at === 'cancelled' || at === 'refunded') {
      const back = await restoreForOrder(orderId);
      await releaseForOrder(orderId);
      return back;
    }
    // 'shipped' still releases any hold, for orders that reached working before this
    // existed and are carrying one with nothing to match it.
    if (at === 'shipped') return await releaseForOrder(orderId);
  } catch (e) { /* the shelf must never fail a stage change */ }
  return null;
}

export function ordersRoutes(app, requireAuth) {
  // Idempotent: ensure the factory_order column exists (also created in etsy.js).
  q('alter table orders add column if not exists factory_order boolean not null default false').catch(() => {});
  // When we successfully pushed tracking to the marketplace (Etsy receipt shipped + buyer
  // email). Stamped once so a re-save can't re-email the buyer; a DRY RUN never stamps it.
  q('alter table orders add column if not exists marketplace_fulfilled_at timestamptz').catch(() => {});
  /**
   * WHEN THE FACTORY ACCEPTED THIS JOB — stamped once, and never cleared.
   *
   * The seller's cancel window was read off the CURRENT stage: at in_review they may
   * cancel for a full refund, past it they may not. That made the window re-openable —
   * stepping an order back from Approved to Pending, which is the ordinary undo of a
   * mis-click, silently handed the seller a full refund on work the floor had already
   * accepted and may have bought blanks for.
   *
   * Approval is a fact about US, not a position on a line: once we have said we will make
   * this, we have said it. So the window closes on this stamp instead, and an internal
   * correction stays internal. It does not trap anyone — an order that genuinely should
   * not be made is cancelled by the factory, which refunds properly and is recorded as our
   * decision rather than appearing as the seller's.
   */
  q('alter table orders add column if not exists approved_at timestamptz').catch(() => {});
  /**
   * THE MARKETPLACE'S OWN SHIP-BY DATE — a promise, not an inference.
   *
   * Lateness was decided by age: open for more than `overdue_days` and you were overdue.
   * That is a guess about a promise, and it is wrong in both directions — a 2-day blank tee
   * and a digitised embroidery order are not equally late on day 10.
   *
   * Etsy hands us the real thing on every transaction (`expected_ship_date`), which is the
   * date it shows the buyer AND the date it measures the shop's late-shipment rate against.
   * Written by the sync (etsy.js) and never guessed here: an order with no ship_by simply
   * falls back to the age threshold, which is what every manual order will always do.
   */
  q('alter table orders add column if not exists ship_by timestamptz').catch(() => {});
  // This row exists ONLY to hold a standalone label — a re-ship, a sample, someone else's
  // parcel. It has no lines and nothing to produce, so it stays off the production boards
  // and lives in Shipments instead. Kept as a flag on orders rather than a separate
  // shipments table because manifests, dispatch, tracking and the ledger all key off
  // order_id today; splitting that is a much larger change than the problem warrants.
  q('alter table orders add column if not exists label_only boolean not null default false').catch(() => {});
  /**
   * THE FACTORY'S OWN NOTE ON AN ORDER — staff to staff, never the seller.
   *
   * The panel already had a "Note" box, but it printed the BUYER's checkout message from
   * Etsy: read-only, usually empty, and no use for "Hoa is re-hooping this" or "waiting on
   * navy thread". There was nowhere to write that except the chat thread, which nobody
   * opens while working a row.
   *
   * SEPARATE COLUMN, not folded into `notes` (jsonb, buyer-facing) or `meta`, precisely so
   * the seller-facing shaper can drop one named field rather than pick through a blob.
   */
  q('alter table orders add column if not exists internal_note text').catch(() => {});
  // Per-seller display number ("#1, #2 …" for manual orders). The id stays the
  // globally-unique PK; this is just the friendly number the seller sees.
  q('alter table orders add column if not exists seq integer').catch(() => {});
  // Who CREATED the order (the acting user, which may be a team member of the seller) —
  // distinct from seller_id (the shop owner it belongs to). Only ever surfaced to a seller
  // when the creator is the owner or one of the owner's own team members; never leaks a
  // factory account. See the getOrders seller query.
  q('alter table orders add column if not exists created_by uuid').catch(() => {});
  // Free-form editable order info (notes, priority, gift message, …) kept on the
  // seller's order-detail panel. One jsonb bag so new fields don't need migrations.
  q(`alter table orders add column if not exists meta jsonb default '{}'`).catch(() => {});

  /**
   * RUSH — a human saying "this one jumps the queue", with their name on it.
   *
   * Deliberately separate from `overdue`, which is computed from age. Late is a fact about
   * the clock; rush is a DECISION, and a decision nobody can trace is one nobody trusts —
   * so who set it and when are stored beside it. Clearing it is a decision too, so the
   * columns are nulled rather than the row rewritten silently.
   */
  q('alter table orders add column if not exists rush boolean not null default false').catch(() => {});
  q('alter table orders add column if not exists rushed_by uuid').catch(() => {});
  q('alter table orders add column if not exists rushed_at timestamptz').catch(() => {});
  // Overdue and rush are both list-wide filters on every board, so they get an index.
  q('create index if not exists orders_rush_idx on orders (rush) where rush = true').catch(() => {});
  // Classify factory_order by OWNER ROLE ALONE. It used to also require `id like 'etsy-%'`,
  // which made the flag answer "is this an order on the factory's own Etsy shop" when every
  // reader of it is asking "does this order belong to a seller who pays us". A manual FF-*
  // order raised on a factory board, and a TikTok/Shopify order on a factory-owned shop,
  // both had factory_order = FALSE while being as factory-owned as anything gets — which is
  // why the staff board query carries an `or exists (… role <> 'seller')` clause bolted on
  // beside this flag, and why the design-fee exemption missed them.
  //
  // One derivation, owner role, everywhere. A seller's own Etsy/Shopify shop stays false, so
  // their orders still show on their dashboard and are still charged for. Idempotent — the
  // where clause only touches rows whose flag disagrees.
  q(`update orders set factory_order = exists (select 1 from users u where u.id = orders.seller_id and u.role <> 'seller')
      where factory_order is distinct from exists (select 1 from users u where u.id = orders.seller_id and u.role <> 'seller')`).catch(() => {});
  // Composite design position {x,y,w,h} per line item — persisted so the mockup
  // overlay lands in the same spot on every board + the mobile app after a sync.
  // schema.sql already declares it for fresh DBs; this covers older ones.
  q('alter table order_items add column if not exists design_pos jsonb').catch(() => {});
  // Stable per-line id (client-generated) so a line item's design/image/status keys
  // never collide between identical-SKU siblings. Preserved across replaceItems.
  q('alter table order_items add column if not exists line_id text').catch(() => {});
  // ADDRESSABILITY BACKFILL. Item-setup / item-status / design all address a line by line_id
  // OR sku; a line with NEITHER (a marketplace/manual line whose blank isn't picked yet, or a
  // row that pre-dates line_id) is impossible to edit — "line_id or sku required" — and the
  // blank can never be set. Mint a STABLE line_id from the immutable row id for every such
  // orphan, once, so every order type (Etsy, Shopify, TikTok, manual, sandbox, old or new) is
  // editable on every board. `BL` prefix can't collide with marketplace/`FFL-` ids. Idempotent.
  q(`update order_items set line_id = 'BL' || id where (line_id is null or line_id = '') and (sku is null or sku = '')`)
    .then((r) => { if (r && r.rowCount) console.log(`[order_items] minted line_id for ${r.rowCount} unaddressable line(s)`); })
    .catch(() => {});
  /**
   * AND THE COLLIDING SIBLINGS — a line with a sku but no line_id is addressable only as
   * `S:<sku>`, which is not an address at all when another line on the same order has the
   * same sku. Editing one changed both; artwork placed on one showed on both.
   *
   * Targeted rather than blanket: only rows that ACTUALLY share a sku with a sibling. A
   * lone line keyed by its sku is unambiguous and is left alone, so this is a small write
   * that touches only the orders that were broken.
   */
  q(`update order_items t set line_id = 'BL' || t.id
       where (t.line_id is null or t.line_id = '')
         and exists (select 1 from order_items s
                      where s.order_id = t.order_id
                        and coalesce(s.sku, '') = coalesce(t.sku, '')
                        and s.id <> t.id)`)
    .then((r) => { if (r && r.rowCount) console.log(`[order_items] separated ${r.rowCount} identical-sku sibling line(s)`); })
    .catch(() => {});
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
  /**
   * THE SELLER'S OWN MOCKUP — a BACKDROP, never the print file.
   *
   * Sellers mostly already have product photography, and placing artwork on OUR blank photo
   * means the picture they list with and the picture the floor works from are two different
   * images of the same job. This is the one they supply, per line and per side:
   * `{"front": "/api/support/asset/…", "back": "…"}`.
   *
   * ON order_items, AND THAT IS THE POINT. It would fit as neatly in order_designs — until
   * you read missingArtwork(), which gates SHIPPING on "does this sku have an order_designs
   * row" and does not care what kind. A mockup filed there would satisfy the artwork check
   * for a decorated line, and an order with a nice photo and no print file would sail
   * through the one gate that exists to stop exactly that. A different table cannot be
   * mistaken for artwork by any query that has not been written yet.
   *
   * A URL, not the bytes. GET /api/orders returns every item, and a base64 photo per line
   * would put megabytes back into the list the img_ref split took them out of.
   */
  q('alter table order_items add column if not exists mockups jsonb').catch(() => {});
  q('alter table order_items add column if not exists design_tier text').catch(() => {});
  q('alter table order_items add column if not exists design_tier_at timestamptz').catch(() => {});
  q('alter table order_items add column if not exists design_tier_by text').catch(() => {});
  /* What staff typed INSTEAD of the tier's list price. Null = use the list price, which is
     the normal case; a number here is a deliberate override of one job's fee and is what
     both the estimate and the charge then use. Numeric, not integer — fees are dollars. */
  q('alter table order_items add column if not exists design_fee_override numeric').catch(() => {});
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
  // ONE definition of the design key. It appears in the index and in every ON CONFLICT
  // that writes artwork; a copy that drifts by one character throws 42P10 at runtime, on a
  // path nobody exercises until a seller uploads.
  const DESIGN_KEY = "coalesce('L:' || line_id, 'S:' || sku)";
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
    // GET /api/orders joins design_ids for the per-line design number, so it must exist
    // before the first list request — not merely on the first upload that mints one.
    .then(() => ensureDesignIds().catch(() => {}))
    // GET /api/orders ends `order by o.created_at desc` on every board, with no index behind
    // it — so each load sorted the whole table. The seller list additionally filters by
    // seller_id, and the existing orders_seller_idx can't serve both the filter and the sort.
    .then(() => q('create index if not exists orders_created_idx on orders (created_at desc)').catch(() => {}))
    .then(() => q('create index if not exists orders_seller_created_idx on orders (seller_id, created_at desc)').catch(() => {}))
    /**
     * LINE IDENTITY. The primary key was (order_id, sku, kind), so two lines of the SAME
     * sku on one order shared ONE design row — attaching artwork to the second silently
     * overwrote the first, and both lines then rendered the same image. A customer buying
     * two of the same hoodie with different personalisation got one of them printed twice.
     *
     * order_items has carried line_id for a while and item status is already keyed on it
     * (see setItemStatus); the design store never learned. This closes that.
     *
     * The key is (order_id, coalesce('L:'||line_id, 'S:'||sku), kind) — rows predating the
     * column keep working on sku while new ones key on the line.
     *
     * THE PREFIXES ARE LOAD-BEARING. Plain coalesce(line_id, sku) mixes two identifier
     * namespaces, and Etsy uses the same id shape for both: one row's line_id equalled
     * another row's sku on the same order, so the index refused to build and every design
     * save returned 500 with nothing for ON CONFLICT to match. Prefixing makes the two
     * spaces disjoint by construction rather than by luck.
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
      /**
       * THE THREE-COLUMN INDEX IS TRIED, NOT DEMANDED.
       *
       * It was created here and then ASSERTED — "order_designs_line_key IS MISSING. Artwork
       * uploads are broken. Create it by hand." — which was true when it was the ON CONFLICT
       * target of every artwork save, and stopped being true the moment the per-side index
       * below superseded it.
       *
       * Worse, it can never succeed again. Once any line carries artwork on two sides, front
       * and back share (order, line, kind), so the unique index it demands is a constraint
       * the data deliberately violates. The migration below even DROPS it on purpose.
       *
       * So the alarm fired on every boot of a healthy server, claiming an outage that was not
       * happening. An alarm that is always on is an alarm nobody reads — and the log it was
       * printed into is where a real failure has to be visible. It is a create-if-possible
       * step now; the loud assertion moved to the index the inserts actually use.
       */
      await q(`create unique index if not exists order_designs_line_key on order_designs (order_id, (${DESIGN_KEY}), kind)`)
        .catch(() => { /* superseded by order_designs_line_side_key below — see the note */ });
    })
    /**
     * A SIDE IS PART OF A DESIGN'S IDENTITY.
     *
     * A line could hold ONE artwork. The garment has a front, a back and two sleeves, and
     * the designer's face tabs only chose which mockup you were looking at — saving on the
     * back overwrote the front, because (order, line, kind) was the whole key.
     *
     * Existing rows have no side and are FRONT: that is what they have always been, every
     * mockup drew them there, and coalescing rather than backfilling means a deployment
     * that never gets this far still reads them correctly.
     *
     * THE ORDER OF THESE THREE STATEMENTS IS THE MIGRATION.
     *
     * The old index enforces one row per (order, line, kind), so it must go or a back
     * design is refused — but it is also the ON CONFLICT target every artwork save used
     * until this deploy. Dropping it before its replacement exists is a window where every
     * save 500s with 42P10. So: create the new one, PROVE it is there, and only then drop
     * the old. If the create fails the old index survives and the worst case is what we
     * already had — one side per line — rather than no artwork saves at all.
     */
    .then(async () => {
      await q('alter table order_designs add column if not exists side text')
        .catch((e) => console.error('[order_designs] could not add side:', e.message));
      /**
       * WHICH TEMPLATE THIS ARTWORK CAME OFF, if any.
       *
       * A template is a placement recipe — artwork, where it sits, which blank it was placed
       * on — and picking one threw its identity away the instant the pieces landed on the
       * canvas. So a submitted order carried the RESULT of TPL-12 with no memory that TPL-12
       * existed, and the factory had no way to ask "what else have we cut from this recipe".
       *
       * It rides on the ARTWORK, not the order: a template is chosen per line and per side,
       * and two lines of one order can come off two different templates. Nullable and never
       * required — most artwork is a file somebody dropped, and that is not a failure state.
       *
       * This is the same identifier Printful's Orders API accepts as `product_template_id`
       * on an order item: a template id is a legitimate way to say what to make, not just a
       * design-time convenience.
       */
      await q('alter table order_designs add column if not exists template_id text')
        .catch((e) => console.error('[order_designs] could not add template_id:', e.message));
      await q(`create unique index if not exists order_designs_line_side_key
                 on order_designs (order_id, (${DESIGN_KEY}), kind, coalesce(side,'front'))`)
        .catch((e) => console.error('[order_designs] COULD NOT CREATE order_designs_line_side_key — per-side artwork is off and saves keep the old one-per-line behaviour:', e.message));
      const ok = await q("select 1 from pg_indexes where tablename='order_designs' and indexname='order_designs_line_side_key'")
        .then((r) => r.rowCount).catch(() => 0);
      if (!ok) {
        // THE one that matters: this is the ON CONFLICT target of every artwork save, so
        // without it a save raises 42P10 and returns 500. The old index is left in place
        // deliberately — one side per line is a smaller failure than no artwork at all.
        console.error('[order_designs] order_designs_line_side_key IS MISSING — ARTWORK SAVES WILL FAIL (42P10). The superseded one-per-line index is kept so saves degrade to front-only rather than stopping.');
        return;
      }
      // Safe: its replacement is in place and covers strictly more.
      await q('drop index if exists order_designs_line_key')
        .catch((e) => console.error('[order_designs] could not drop the superseded order_designs_line_key — a second side will be refused until it goes:', e.message));
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
  // The carrier's own event times (not our poll time), for fulfilment-speed metrics:
  // delivered_at = when it was delivered; est_delivery = the ETA frozen at first sighting.
  // Both filled by refreshTracking off the Shippo track response. est_delivery may already
  // exist from an earlier schema; the guard makes this a no-op then.
  q('alter table orders add column if not exists delivered_at timestamptz').catch(() => {});
  q('alter table orders add column if not exists est_delivery timestamptz').catch(() => {});
  q('alter table order_items add column if not exists ship_fee numeric').catch(() => {});

  // Guarantee every returned line is ADDRESSABLE. Any line with neither line_id nor sku gets a
  // stable line_id minted from its row id (same scheme as the load-time backfill) and PERSISTED,
  // so the id the client receives is the one item-setup will match. Self-healing: covers any
  // insert path that ever forgets to set a key, for every order type, without touching a board.
  async function healOrphanLines(row) {
    const items = row && Array.isArray(row.items) ? row.items : [];
    // Unaddressable = no line_id AND (no sku, OR a sibling on this order shares the sku).
    // The second half is the one that was missing: identical-sku lines both key on `S:<sku>`,
    // so a write meant for one lands on all of them.
    const skuCount = new Map();
    for (const it of items) { const k = String(it && it.sku != null ? it.sku : ''); skuCount.set(k, (skuCount.get(k) || 0) + 1); }
    const orphans = items.filter((it) => it && it.id != null && !it.line_id
      && (it.sku == null || it.sku === '' || (skuCount.get(String(it.sku)) || 0) > 1));
    if (!orphans.length) return row;
    await Promise.all(orphans.map((it) => q(`update order_items set line_id = 'BL' || id where id = $1 and line_id is null`, [it.id]).catch(() => {})));
    for (const it of orphans) it.line_id = 'BL' + it.id;
    return row;
  }

  // List
  // ONE order. The detail page used to fetch every order and search it, so an order the
  // list happened to exclude read as "not found" even though it existed. Staff may read
  // any order; a seller only their own.

  /**
   * Hide a MARKETPLACE buyer's contact details from the seller side.
   *
   * The seller is not the risk here — the surface is. Buyer names and street addresses on a
   * marketplace order are that marketplace's data held under our API terms, and the fewer
   * accounts that can read them the smaller the incident is when one is compromised. Staff see
   * everything, because someone has to answer a "this never arrived" claim months later; a
   * seller sees enough to recognise the order and no more.
   *
   * This is ACCESS CONTROL, not retention: nothing is destroyed, so a dispute at month six is
   * still answerable. (Amazon's Data Protection Policy separately requires actual DELETION
   * within 30 days of shipment for Amazon orders — masking does not satisfy it. Nothing is
   * connected to Amazon yet; when it is, the pii_retention purge has to come back on for that
   * channel.)
   *
   * MUST run server-side. Hiding these in the client still ships them in the JSON, where any
   * seller can read them out of devtools — which is not a restriction, it is a decoration.
   *
   * Leaves a MANUAL order alone: its address was typed into our own form by the seller's side,
   * so they already hold it, and hiding back what someone just entered reads as a bug.
   *
   * `masked: true` travels with the row on purpose. Without it the client cannot tell "hidden
   * from you" from "never arrived" — and those two look identical while meaning opposite
   * things, which is the whole reason Etsy's redacted addresses were mistaken for our bug.
   */
  /**
   * Remove staff-only fields. Deliberately NOT part of maskBuyerPII: that function returns
   * early for manual orders, so putting the note there would have published it on every
   * manual order — the exact shape of leak that is hardest to notice, because the common
   * case looks right.
   */
  /**
   * DROP WHAT IS EMPTY — 46% of this response, measured on production.
   *
   * An order carries 67 columns and 890 of them ship on every read of this list. Most of
   * those columns are null on most orders, and JSON pays for a null twice: the value, and
   * the KEY NAME repeated once per row. Measured: 2,323 KB as sent, 1,245 KB with empties
   * dropped.
   *
   * Gzip barely notices (201 KB → 182 KB) because repeated key names compress well — which
   * is exactly why this is worth doing anyway. The cost that was hurting is not the wire, it
   * is JSON.parse and the object allocation on the main thread, and that halves.
   *
   * Safe because a missing key reads as `undefined`, and every client check on these fields
   * is truthiness or `??` — audited before shipping: no `=== null` and no hasOwnProperty on
   * an order or a line anywhere in web/.
   */
  function compact(v) {
    if (Array.isArray(v)) return v.map(compact);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (val === null || val === undefined) continue;
        if (Array.isArray(val) && !val.length) continue;
        out[k] = compact(val);
      }
      return out;
    }
    return v;
  }

  /**
   * WHAT EACH ORDER COSTS, ON THE LIST.
   *
   * The queue showed a Total column holding `orders.total` — the BUYER's money — so a manual
   * order with no retail price recorded read "$0.00", which is the one thing it definitely
   * did not cost. What a seller wants from their own board is what the order costs THEM, and
   * that number was only ever on the detail page.
   *
   * TWO SOURCES, AND THEY ARE NOT THE SAME CLAIM:
   *   charged   the ledger — money that actually moved. Exact, and it is the answer whenever
   *             it exists, because a frozen order's price is history.
   *   estimate  the live ladder, for an order nobody has paid for yet.
   *
   * `cost_estimated` says which, so the column can render an estimate differently instead of
   * asserting a charge that has not happened.
   *
   * IT COSTS TWO QUERIES FOR THE WHOLE REQUEST, not two per order: the catalogue and the fee
   * table are read once and the ladder runs in memory over items the aggregate already
   * returned. The two per-order reads a full quote makes — how many faces each line prints,
   * and the volume rate — are deliberately skipped, which is exactly why this is an estimate
   * and can only be equal or slightly HIGH, never low.
   *
   * WITHHELD FROM ANYONE WHO MAY NOT SEE MONEY. `canSeeMoney` is the same predicate the
   * charges route gates on; a warehouse hand gets no cost field at all rather than a blank
   * column they will ask about.
   */
  async function attachCost(rows, user) {
    if (!rows.length || !canSeeMoney(user)) return rows;
    const ids = rows.map((r) => String(r.id));
    const [idx, fees, chargedRows] = await Promise.all([
      catalogIndex().catch(() => ({ exact: new Map(), rows: [] })),
      feeSettings().catch(() => ({})),
      q(`select ref, coalesce(sum(delta),0) as amt from wallet_ledger
          where type=$1 and ref = any($2::text[]) group by ref`, [CHARGE_TYPE + '-in', ids])
        .then((r) => r.rows).catch(() => []),
    ]);
    const charged = new Map(chargedRows.map((r) => [String(r.ref), parseFloat(r.amt) || 0]));
    for (const o of rows) {
      const paid = charged.get(String(o.id)) || 0;
      if (paid > 0) { o.cost = paid; o.cost_estimated = false; continue; }
      const items = Array.isArray(o.items) ? o.items : [];
      if (!items.length) continue;
      const { lines, unpriced } = priceLines(items, idx, fees);
      // No priced line means no answer — NOT zero. The column prints nothing and the row
      // still says how many lines could not be priced, which is the actionable half.
      o.cost = lines.length ? computeTotals(lines, fees, 0).total : null;
      o.cost_estimated = true;
      if (unpriced.length) o.cost_unpriced = unpriced.length;
    }
    return rows;
  }

  function stripStaffOnly(row) {
    if (!row) return row;
    // seller_name goes too: it is only ever the reader's own name, and shipping a field
    // that names an account is not something to do by accident on a seller-facing route.
    const { internal_note, seller_name, ...rest } = row;   // eslint-disable-line no-unused-vars
    return rest;
  }

  function maskBuyerPII(row) {
    if (!row) return row;
    if (String(row.source || '').toLowerCase() === 'manual') return row;
    const a = row.address && typeof row.address === 'object' ? row.address : null;
    const c = row.customer && typeof row.customer === 'object' ? row.customer : null;
    return {
      ...row,
      customer: c ? { name: c.name ?? null, masked: true } : c,
      address: a ? {
        masked: true,
        name: a.name ?? null,
        city: a.city ?? null,
        state: a.state ?? null,
        country: a.country ?? a.country_iso ?? null,
        // The buyer's OWN order reference is not contact data, and a seller needs it to match
        // the order against their marketplace.
        ref: a.ref ?? null,
      } : a,
      // The full address is PRINTED on the label PDF, so leaving this link reachable would
      // make every line above cosmetic.
      tracking_label_url: null,
    };
  }

  app.get('/api/orders/:id', { preHandler: requireAuth }, async (req, reply) => {
    const agg = `coalesce(json_agg(i.* order by i.id) filter (where i.id is not null), '[]') as items`;
    // Have the blanks for this order gone to a supplier? It is what decides whether an
    // admin may still correct a variant — see the item-setup route.
    const placedPO = `exists (
        select 1 from purchase_orders po
         where coalesce(po.status,'draft') <> 'draft'
           and exists (
             select 1 from jsonb_array_elements(coalesce(po.items,'[]'::jsonb)) it,
                          jsonb_array_elements(coalesce(it->'sources','[]'::jsonb)) src
              where src->>'order' = o.id)) as blanks_ordered`;
    // WHOSE ORDER THIS IS — see the list route. Selected for everyone and removed again for
    // sellers by stripStaffOnly, rather than branching the query: one statement, and the
    // redaction sits in the one function that already owns "what a seller may not read".
    const sellerName = `(select coalesce(nullif(su.name,''), su.email) from users su where su.id = o.seller_id) as seller_name`;
    const r = await q(
      `select o.*, ${placedPO}, ${sellerName}, ${agg} from orders o left join order_items i on i.order_id = o.id
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
      return stripStaffOnly(maskBuyerPII(await healOrphanLines(row)));
    }
    return healOrphanLines(row);
  });

  /**
   * One line's thumbnail, as BYTES rather than as base64 inside the order list.
   *
   * The list hands back `img_ref` pointing here whenever the stored value is a data: URL (see
   * the aggregate in GET /api/orders). Splitting it out is what takes the list from 6MB to
   * ~1.5MB: the browser fetches only the thumbnails on screen, in parallel, and the immutable
   * cache header means it never fetches the same one twice — across pages OR across boards.
   *
   * UNAUTHENTICATED BY DESIGN, exactly like /api/design_cards/art/:hash, /api/wilcom/asset and
   * the supplier image proxy: AN <img> CANNOT CARRY A BEARER HEADER. This route originally sat
   * behind requireAuth, so every thumbnail on every board 401'd and the whole Items column
   * rendered as broken-image icons — the browser sends no Authorization on an image load, and
   * there is no cookie session to fall back on (the JWT lives in localStorage).
   *
   * What guards it instead is the key: order_items.id is `gen_random_uuid()`, 122 bits, so the
   * URL can't be walked the way a sequential id could. It is a capability URL — holding it is
   * the permission — and it only ever reaches someone the order list already authorised, since
   * that list is where img_ref comes from. Same trade the card-art route already makes.
   *
   * Immutable is safe because the URL is keyed by the ITEM's row id and the bytes are part of
   * that row: changing the artwork writes a different row or a different value, and anything
   * that re-uses this id with new bytes would need this header revisited.
   */
  app.get('/api/order_items/:id/img', async (req, reply) => {
    // Validate the shape before it reaches Postgres: a non-UUID would make `$1::uuid` throw,
    // and .catch(() => null) would turn that into an indistinguishable 404.
    const id = String(req.params.id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      reply.code(404); return { error: 'No image' };
    }
    const r = await q(`select img from order_items where id = $1::uuid`, [id]).catch(() => null);
    const row = r && r.rows[0];
    if (!row || !row.img) { reply.code(404); return { error: 'No image' }; }
    const m = String(row.img).match(/^data:([^;,]+);base64,(.+)$/s);
    // Not a data: URL — the list would have passed it through and never pointed here, so this
    // is only reachable if the value changed under us. Redirect rather than 404: the caller
    // wants the image, and that URL is the image.
    if (!m) { reply.redirect(String(row.img)); return; }
    reply
      .header('Content-Type', m[1])
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(Buffer.from(m[2], 'base64'));
  });

  app.get('/api/orders', { preHandler: requireAuth }, async (req) => {
    /**
     * THE ARTWORK ON EACH LINE, so a board can be searched by design rather than only by
     * order number or buyer.
     *
     * A LATERAL, not a plain join: order_designs is keyed (order, line, KIND), so one line
     * can hold several rows (raster + vector) and a flat join would multiply that line in
     * the aggregate below — the same order appearing to have four items when it has two.
     * One row per line, newest first, is the only shape that can't corrupt the list.
     *
     * The key expression mirrors the unique index exactly, prefixes included: Etsy reuses
     * one id shape for both line_id and sku, so an unprefixed coalesce matches across the
     * two namespaces and attaches the wrong artwork.
     */
    const join = `left join order_items i on i.order_id = o.id
      left join lateral (
        select d.name, d.art_hash, di.design_no
          from order_designs d
          left join design_ids di on di.art_hash = d.art_hash
         where d.order_id = i.order_id
           and (
             -- Properly line-keyed.
             (d.line_id is not null and d.line_id = i.line_id)
             -- Legacy, before order_designs learned line_id: the row is keyed by sku,
             -- which in practice holds EITHER the real sku or — on rows written by the
             -- older client — the line id itself. indexDesigns() on the client files such
             -- a row under both keys for exactly this reason; matching only one of them
             -- left real artwork invisible to the list (verified against order 12345,
             -- whose design row carries the line id in its sku column).
             or (d.line_id is null and (d.sku = i.sku or d.sku = i.line_id))
           )
         order by (d.line_id is not null) desc,   -- a line-keyed row beats a guess
                  (d.sku = i.line_id) desc,       -- then one naming this exact line
                  -- THE FRONT, before "most recently touched". A line holds a row per side
                  -- now, so without this a back design saved after the front would name the
                  -- item in every list — the same trap indexDesigns() has on the client, and
                  -- the two must agree or the board and the page disagree about one line.
                  (coalesce(d.side,'front') = 'front') desc,
                  d.updated_at desc nulls last
         limit 1
      ) dz on true`;
    // ORDER BY i.id keeps line-item order stable across every board, so the per-line
    // design "slot" (1st vs 2nd same-SKU item) resolves to the same artwork everywhere.
    // IMAGE BYTES DO NOT TRAVEL IN THE LIST. Measured on a real board: 703 orders came to
    // 5.97MB, of which items.img alone was 4.44MB — 74% — because some import paths store the
    // thumbnail as a `data:` URL, i.e. base64 image bytes inlined into every row. That made
    // the JSON un-cacheable, un-parallel and blocking: nothing rendered until all 6MB had
    // arrived and been parsed, on every board, on every navigation.
    //
    // So a data: URL is swapped for a REFERENCE to /api/order_items/:id/img, which serves the
    // same bytes with an immutable cache header. The browser then fetches only the thumbnails
    // actually on screen, in parallel, and never fetches them twice. Ordinary http(s) URLs are
    // already references and pass through untouched. Nothing stored changes; this is purely
    // what the LIST hands back. The single-order route below still returns img inline — one
    // order's thumbnails are not a payload problem.
    // AN EXPLICIT PROJECTION, not to_jsonb(i.*).
    //
    // Measured at 700 orders / 1,120 lines: the response was 1.27MB, `items` was 70% of it,
    // and inside items the JSON KEYS outweighed the values (569KB of structure to 222KB of
    // content). That is what `to_jsonb(i.*)` costs — it ships all 31 columns of every line
    // whether or not anything reads them, and the column NAME is repeated per row.
    //
    // The eight fields left out below have ZERO readers anywhere in web/ (grepped, not
    // assumed): listing, ship_fee, unit_cost, design_pos, design_tier_at, design_tier_by,
    // design_quote_at, design_charged_at. unit_cost/ship_fee are the frozen price and DO
    // matter — but they are settled server-side (pricing.js, order_refunds.js) and read by
    // the client through /api/orders/:id/charges, never off the list.
    //
    // Anything a DETAIL view needs is unaffected: GET /api/orders/:id still returns whole
    // rows. This is the list/detail split made explicit rather than every board paying
    // detail-page weight on first paint.
    //
    // Adding a column to order_items no longer changes this response, which is the point —
    // but it also means a NEW field a board needs must be added here deliberately.
    const agg = `coalesce(jsonb_agg(
        jsonb_build_object(
          'id', i.id, 'order_id', i.order_id, 'sku', i.sku, 'name', i.name,
          'qty', i.qty, 'color', i.color, 'size', i.size, 'variant', i.variant,
          'blank', i.blank, 'print_type', i.print_type, 'line_id', i.line_id,
          'factory_status', i.factory_status, 'unit_price', i.unit_price,
          'design_src', i.design_src, 'threads', i.threads,
          'personalization', i.personalization, 'created_at', i.created_at,
          -- What the artwork on this line is called, and its automatic number (DSN-1042).
          -- Both travel on the LIST because searching by design is the point: a name that
          -- only arrives when a row is expanded can't be typed into a filter box.
          'design_name', dz.name, 'design_no', dz.design_no,
          'design_tier', i.design_tier, 'design_quote_status', i.design_quote_status,
          'design_quote_make', i.design_quote_make, 'design_quote_download', i.design_quote_download,
          -- img / img_ref: see the note above the query.
          'img',     case when i.img like 'data:%' then null else i.img end,
          'img_ref', case when i.img like 'data:%' then '/api/order_items/' || i.id::text || '/img' else null end
        ) order by i.id) filter (where i.id is not null), '[]'::jsonb) as items`;
    // Does this order have a machine file (a .pes/.emb) already? The Design readiness tag
    // flips to "done" on one, but the full file list is only fetched when a row is expanded
    // — so on a collapsed row the tag couldn't tell, and an order with an uploaded .emb read
    // as "nothing designed yet". This one boolean per row lets the tag be right everywhere
    // without fetching every order's files. design_file_data is created idempotently with an
    // order_id index (design_files.js), so the correlated EXISTS is safe and cheap.
    const machineFile = `exists(select 1 from design_file_data f where f.order_id = o.id and f.kind in ('pes','emb')) as has_machine_file`;
    // Design-board state for the readiness chip: is a card on the board for this order, and
    // has it reached the APPROVED lane. The chip stays amber ("sent for review / check")
    // until approval, then goes violet — a file existing isn't the same as it being approved.
    const designBoard = `exists(select 1 from design_cards dc where dc.order_id = o.id) as design_on_board,
      exists(select 1 from design_cards dc where dc.order_id = o.id and dc.col = 'approved') as design_approved`;
    if (isStaff(req.user)) {
      // Staff (factory) see factory-OWNED orders (the admin marketplace shops, which
      // need factory setup) PLUS any SELLER order that's been PUSHED to production.
      // A seller order sits at factory_status 'new'/'draft' while the seller is still
      // managing it; Push moves it to 'in_review'. So until Push it stays OFF the
      // factory boards (seller-managed). factory_order rows show regardless of status.
      // WHOSE ORDER THIS IS. The staff boards render every seller's work in one queue and
      // had no way to say which seller a row belonged to — the shop name answers "which
      // storefront", which is not the same question once one seller runs three shops or two
      // sellers both call a shop "Home". Staff branch only: a seller reading their own list
      // would only ever see themselves.
      const sellerName = `(select coalesce(nullif(su.name,''), su.email) from users su where su.id = o.seller_id) as seller_name`;
      const r = await q(
        `select o.*, ${machineFile}, ${designBoard}, ${sellerName}, ${agg} from orders o ${join}
         -- A LABEL IS NOT AN ORDER. Buying a standalone label (re-ship, sample, someone
         -- else's parcel) mints an FF-* row purely so the label has somewhere to live —
         -- it has no lines, nothing to make, and nothing to dispatch, but it was landing
         -- on the production board as a Draft with Label/Scan/Design/Stock chips it can
         -- never satisfy. ShipStation's equivalent creates a SHIPMENT and no order at all;
         -- this is the same separation without a second table. It still appears in
         -- Shipments, which is the list it belongs to.
         where coalesce(o.label_only, false) = false
           and (o.factory_order = true
            or coalesce(o.factory_status, '') not in ('new', 'draft', '')
            -- ...OR the order belongs to a STAFF account, i.e. the factory created it
            -- itself. Without this a manual order made on a factory board was invisible
            -- to the board that made it: factory_order is derived from the id (etsy-%),
            -- so a manual FF-* order can never set it, and a brand-new order is still at
            -- '' / 'new', which the push filter excludes.
            or exists (select 1 from users u where u.id = o.seller_id and u.role <> 'seller'))
         group by o.id order by o.created_at desc`);
      await Promise.all(r.rows.map(healOrphanLines));
      await attachCost(r.rows, req.user);
      return r.rows.map(compact);
    }
    // Sellers only see their OWN orders, never the admin/factory-synced ones. A team member sees
    // their OWNER's orders (if their permissions include 'orders'); a plain seller sees their own.
    const sel = await resolveSeller(req.user);
    if (!_canSurface(sel, 'orders')) return [];
    const r = await q(
      // created_by_name: WHO uploaded it, resolved to a name ONLY when the creator is the
      // shop owner ($1) or one of the owner's own active team members. A factory account or
      // anyone outside the team resolves to null — a seller never learns of factory hands.
      `select o.*, ${machineFile}, ${agg},
         (select coalesce(cu.name, cu.email) from users cu
            where cu.id = o.created_by
              and (cu.id = $1
                or exists (select 1 from team_members tm
                             where tm.owner_id = $1::text and lower(tm.email) = lower(cu.email) and tm.status = 'active'))
         ) as created_by_name
       from orders o ${join} where o.seller_id=$1 and o.factory_order=false group by o.id order by o.created_at desc`,
      [sel.id]
    );
    await Promise.all(r.rows.map(healOrphanLines));
    await attachCost(r.rows, req.user);
    return r.rows.map((x) => compact(stripStaffOnly(maskBuyerPII(x))));
  });

  /**
   * Capacity status for the CURRENT seller — information only, never a gate.
   *
   * Answers "have I crossed my daily order limit, and if so what should I be told?". A team
   * member resolves to the OWNER, so a team shares one limit. `over` is true only once the
   * count has ACTUALLY reached the limit — so the delay notice can't pop up prematurely. When
   * no limit applies (0/unset) it returns over:false and the client shows nothing.
   */
  app.get('/api/orders/limit-status', { preHandler: requireAuth }, async (req) => {
    const sel = await resolveSeller(req.user).catch(() => null);
    const sellerId = (sel && sel.id) || req.user.sub;
    const [row, cfg] = await Promise.all([
      q('select order_limit from users where id=$1', [String(sellerId)]).then((r) => r.rows[0]).catch(() => null),
      readAll().catch(() => ({})),
    ]);
    const mode = !!Number(cfg.capacity_mode || 0);
    if (!mode) return { mode: false, limit: 0, usedToday: 0, over: false, notice: null };
    const limit = (row && row.order_limit != null) ? Number(row.order_limit) : Number(cfg.order_limit_default || 0);
    const hasLimit = isFinite(limit) && limit > 0;
    // Count is ORDERS UPLOADED TODAY (created), so the header ticks up on every upload/import.
    const used = await q(
      "select count(*)::int as n from orders where seller_id=$1 and created_at >= current_date",
      [String(sellerId)]
    ).then((r) => r.rows[0]?.n || 0).catch(() => 0);
    const sellerOver = hasLimit && used >= limit;
    // Whole-floor maxed → notify EVERY seller, even ones with no personal limit (the
    // "auto-notice all when the factory is at capacity" behaviour). Broadcasts the crunch.
    const factoryLimit = Number(cfg.factory_daily_limit || 0);
    let factoryOver = false;
    if (isFinite(factoryLimit) && factoryLimit > 0) {
      // Whole-floor load today, counting EVERY order that needs producing — including the
      // factory's own synced shop (factory_order = true). Those consume the same machines
      // and hours as a seller's, so leaving them out understated the crunch.
      const fUsed = await q(
        "select count(*)::int as n from orders where created_at >= current_date"
      ).then((r) => r.rows[0]?.n || 0).catch(() => 0);
      factoryOver = fUsed >= factoryLimit;
    }
    const over = sellerOver || factoryOver;
    const notice = String(cfg.capacity_notice || '').trim()
      || 'Due to high order volume, orders submitted now may ship later than usual.';
    return { mode: true, limit: hasLimit ? limit : 0, usedToday: used, over, notice: over ? notice : null };
  });

  /**
   * Whole-factory intake today — STAFF only, for the capacity readout in their header.
   * "used" is EVERY order created today — seller uploads AND the factory's own synced shop
   * (factory_order) — since both take the same production capacity. Sellers never see this.
   */
  app.get('/api/orders/factory-capacity', { preHandler: requireAuth }, async (req) => {
    if (!isStaff(req.user)) return { mode: false, limit: 0, usedToday: 0 };
    const cfg = await readAll().catch(() => ({}));
    if (!Number(cfg.capacity_mode || 0)) return { mode: false, limit: 0, usedToday: 0 };
    const limit = Number(cfg.factory_daily_limit || 0);
    const used = await q(
      "select count(*)::int as n from orders where created_at >= current_date"
    ).then((r) => r.rows[0]?.n || 0).catch(() => 0);
    return { mode: true, limit: isFinite(limit) && limit > 0 ? limit : 0, usedToday: used };
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
      `insert into orders (id, seller_id, store, source, customer, address, status, factory_status, total, profit, delivery, carrier, tracking, seq, meta, factory_order, created_by, label_only)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, false, $16, $17)
       on conflict (id) do update set
         store=excluded.store, customer=excluded.customer, address=excluded.address,
         status=excluded.status, factory_status=excluded.factory_status,
         total=excluded.total, profit=excluded.profit, delivery=excluded.delivery,
         carrier=excluded.carrier, tracking=excluded.tracking,
         seq=coalesce(orders.seq, excluded.seq),
         meta=coalesce(excluded.meta, orders.meta), factory_order=false,
         created_by=coalesce(orders.created_by, excluded.created_by),
         -- Never un-flags an existing order: a label-only row that later gains real work
         -- is a decision someone makes, not something an edit should do by accident.
         label_only=orders.label_only or excluded.label_only
       returning (xmax = 0) as inserted`,
      [o.id, ownerId, o.store || null, o.source || 'manual', o.customer || {}, o.address || {},
       o.status || 'new', o.factoryStatus || o.status || 'new', o.total || 0, o.profit || 0,
       o.delivery || null, o.carrier || null, o.tracking || null,
       (o.seq != null && o.seq !== '') ? parseInt(o.seq, 10) : null,
       (o.meta && typeof o.meta === 'object') ? o.meta : {}, req.user.sub || null,
       // Only ever set by the standalone-label flow. Anything else omits it and gets false.
       o.labelOnly === true]
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
    const prev = await q('select sku, line_id, img, unit_cost, ship_fee from order_items where order_id=$1', [orderId]);
    const imgBySku = {};
    for (const r of prev.rows) { if (r.sku != null && r.img && !(r.sku in imgBySku)) imgBySku[r.sku] = r.img; }
    // The FROZEN price (freezeQuote stamps unit_cost/ship_fee at the moment of charge) has
    // to survive this delete-and-reinsert too, and for a harder reason than the image.
    //
    // Money is settled from these columns after the fact: productionSplit (order_refunds.js)
    // divides a production charge into product vs shipping from the stored unit_cost rather
    // than a fresh quote. Losing them doesn't just blank a field — it scores the product part
    // at $0 and hands the whole charge to shipping, so a per-part refund on an order a staff
    // member had edited would pay back the wrong amounts.
    //
    // Keyed LINE first, then sku — same rule as everything else addressing a line, and the
    // reason matters here: two lines of the same SKU can hold different frozen costs (a size
    // upgrade on one of them), and keying on sku alone would copy one line's price onto its
    // sibling. Prefixes keep the two id namespaces apart, matching the design-upsert key.
    const costByKey = {};
    for (const r of prev.rows) {
      if (r.unit_cost == null && r.ship_fee == null) continue;
      const val = { unit_cost: r.unit_cost, ship_fee: r.ship_fee };
      if (r.line_id) costByKey['L:' + r.line_id] = val;
      if (r.sku != null && !('S:' + r.sku in costByKey)) costByKey['S:' + r.sku] = val;
    }
    await q('delete from order_items where order_id=$1', [orderId]);
    // Auto-resolve a missing blank from the SKU (imports often carry a SKU but no Blank
    // column) so lines come in production-ready instead of "not set up". Built once per save;
    // only fills a blank that's empty, never overrides one that was chosen.
    const needsBlank = items.some((it) => it.sku && !(it.blank != null && String(it.blank).trim()));
    const catIdx = needsBlank ? await catalogIndex().catch(() => null) : null;
    let li = 0;
    for (const it of items) {
      const img = (it.img != null && it.img !== '') ? it.img : (imgBySku[it.sku] || null);
      const designPos = (it.designPos && typeof it.designPos === 'object') ? JSON.stringify(it.designPos) : null;
      const blank = (it.blank != null && String(it.blank).trim()) ? it.blank : (catIdx ? resolveBlankName(catIdx, it) : null) || null;
      // Every line must be ADDRESSABLE — item-setup/status/design all key on line_id or sku.
      // A manual line often starts with NO sku (blank not picked yet) and no line_id, which
      // left it impossible to ever set the blank ("line_id or sku required"). Mint a stable
      // line_id here when the client didn't send one and there's no sku to key on. The client
      // reads it back and echoes it on later edits, so it stays stable.
      /**
       * ALWAYS MINT. A SKU IS NOT IDENTITY.
       *
       * This minted an id only when the line had no sku — so two lines of the SAME sku both
       * came out with line_id null, and every downstream write keys on `sku` when there is
       * no line_id. Editing one sibling's blank edited both; artwork upserted onto
       * `S:<sku>` and appeared on both. That is the reported bug, and CLAUDE.md §5 names
       * the rule it broke: two lines of the same SKU are different jobs.
       *
       * A supplied lineId still wins — marketplace importers carry their own, and they must
       * stay stable across a re-sync.
       */
      const lineId = it.lineId || `FFL-${Date.now().toString(36)}${(li++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      // Re-inherit the frozen price for this line. Never taken from the request body: the
      // client has no business naming what an order already cost, and the only legitimate
      // writer of these columns is freezeQuote at charge time.
      const frozen = (lineId && costByKey['L:' + lineId]) || (it.sku != null && costByKey['S:' + it.sku]) || null;
      await q(
        `insert into order_items (order_id, sku, name, print_type, qty, color, size, variant, unit_price, design_src, img, blank, design_pos, line_id, unit_cost, ship_fee)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [orderId, it.sku || null, it.name || null, it.printType || it.tech || null, it.qty || 1,
         it.color || null, it.size || null, it.variant || null, it.unitPrice || 0, it.designSrc || null,
         img, blank, designPos, lineId, frozen ? frozen.unit_cost : null, frozen ? frozen.ship_fee : null]
      );
    }
  }

  // Patch status/tracking/etc. Staff may also replace the line items (used when a
  // factory board picks a base blank → the chosen mockup must reach mobile scan).
  app.patch('/api/orders/:id', { preHandler: requireAuth }, async (req, reply) => {
    /**
     * THE ORDER NUMBER IS EDITABLE — carefully, and only by staff.
     *
     * `seq` is the `#6` on the header: an integer, minted per seller as max(seq)+1, and the
     * label everything human-facing uses. It is NOT the primary key — `orders.id` is, and it
     * is referenced by order_items, order_designs, order_messages, order_threads,
     * design_cards, design_file_data, shipments, manifests and the wallet ledger's refs, so
     * that one is a migration and not something a text field may touch.
     *
     * Three things have to hold, and none of them are optional:
     *
     *  · STAFF ONLY. The number appears in the seller's own emails and in audit entries; a
     *    seller renumbering their orders to match something else is not an edit anyone can
     *    reconstruct afterwards.
     *  · NEVER INTO A COLLISION. Nothing joins on seq, so a duplicate does not corrupt
     *    anything — it does something worse and quieter: two orders answer to `#6`, and the
     *    factory picks one. Checked against the same scope the number is MINTED in
     *    (seller + factory_order), or the check would disagree with the generator.
     *  · WRITTEN DOWN. It falls through to the normal `map` below, so the before/after
     *    snapshot and `order.updated` audit cover it exactly like any other field.
     */
    if ((req.body || {}).seq !== undefined) {
      if (!isStaff(req.user)) { reply.code(403); return { error: 'Only staff can change an order number.' }; }
      const want = Number(req.body.seq);
      if (!Number.isInteger(want) || want < 1) {
        reply.code(400); return { error: 'An order number is a whole number above zero.' };
      }
      const own = (await q('select seller_id, coalesce(factory_order,false) as fo from orders where id=$1', [req.params.id])).rows[0];
      if (!own) { reply.code(404); return { error: 'Order not found' }; }
      const clash = await q(
        `select id from orders where seller_id=$1 and coalesce(factory_order,false)=$2 and seq=$3 and id <> $4 limit 1`,
        [own.seller_id, own.fo, want, req.params.id]);
      if (clash.rowCount) { reply.code(409); return { error: `#${want} already belongs to another order.` }; }
      req.body.seq = want;   // normalised, so the generic writer below stores an int
    }
    const map = { factoryStatus: 'factory_status', status: 'status', tracking: 'tracking',
                  carrier: 'carrier', total: 'total', timeline: 'timeline', notes: 'notes', meta: 'meta',
                  address: 'address', customer: 'customer' };
    // Staff-only fields: a seller may PATCH their own order, so the guard is on the FIELD
    // and not only on the route. Without it a seller could write — and by writing, read
    // back — the factory's private note on their own order.
    if (isStaff(req.user)) { map.internalNote = 'internal_note'; map.seq = 'seq'; }
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
      const cur = (await q('select factory_status, approved_at from orders where id=$1 and seller_id=$2', [req.params.id, sel.id])).rows[0];
      if (!cur) { reply.code(404); return { error: 'Order not found' }; }
      const fs = String(cur.factory_status || '');
      // The seller's own zone. 'in_review' is theirs too: they've submitted (and been
      // charged) but nobody has picked the order up, so cancelling is still safe and
      // fully refundable. Once it's working or beyond, the floor owns it and the only
      // route back is a refund REQUEST the factory approves.
      const SELLER_ZONE = ['', 'new', 'draft', 'in_review'];
      // ONCE ACCEPTED, ALWAYS ACCEPTED. The stage alone made this window re-openable by an
      // ordinary undo on the board — see approved_at. Both tests still have to pass, so an
      // order that has never been approved and is sitting at Pending is cancellable exactly
      // as it always was.
      const started = !SELLER_ZONE.includes(fs) || !!cur.approved_at;
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
        /**
         * DESIGN AND CHECK FEES ARE CHARGED AT SUBMIT, with everything else.
         *
         * They were charged in exactly one place — a staff member setting the tier on the
         * line — so an order nobody had classified was produced with the check fee shown in
         * the Summary, added into the Total the seller confirmed, and never taken. After
         * submit the Summary reads the LEDGER rather than the quote, so the row that had
         * been on screen the whole time simply disappeared: "the design fees aren't showing
         * up at all". They weren't missing from the page; they were missing from the money.
         *
         * Only fees with a settled amount. A complex design is quoted (`amount: null`) and
         * charged when the seller accepts it — billing an unquoted figure at submit is the
         * one thing that flow exists to prevent — and `status: 'charged'` is a group some
         * earlier action already billed.
         */
        const dueFees = await computeDesignFees(req.params.id)
          .then((d) => (d.items || []).filter((f) => f.status === 'estimated' && Number(f.amount) > 0))
          .catch(() => []);
        const dueTotal = dueFees.reduce((t, f) => t + Number(f.amount), 0);
        const paid = await chargeForSubmit(req.params.id, sel.id, req.user.sub, !seesWallet, dueTotal);
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
        /**
         * AFTER production, and only once it went through — the fee is for work on an order
         * that is actually being made. Each is its own ledger row (`design-<order>-<line>`),
         * refundable on its own, and chargeDesign stamps every line the one fee covers so a
         * sibling line can't bill it twice.
         *
         * The tier is WRITTEN, not left inferred. computeDesignFees reads the stored tier
         * first and falls back to reading the line — so once money has moved on the strength
         * of that reading, the reading becomes the record. Otherwise attaching a machine
         * file to an already-charged line would silently re-describe what was paid for.
         */
        if (dueFees.length) {
          const feeCfg = await readAll().catch(() => ({}));
          for (const f of dueFees) {
            const got = await chargeDesign(req, req.params.id, f.line_id, f.sku, f.tier, feeCfg,
                                           f.overridden ? f.amount : undefined)
              .catch(() => ({ charged: 0 }));
            if (got.charged > 0) {
              _charged += got.charged;
              const ids = (f.lines || []).map((l) => l.line_id).filter(Boolean);
              const skus = (f.lines || []).filter((l) => !l.line_id).map((l) => l.sku).filter(Boolean);
              await q(`update order_items set design_tier = coalesce(design_tier, $2)
                        where order_id=$1 and (line_id = any($3::text[]) or (line_id is null and sku = any($4::text[])))`,
                [req.params.id, f.tier, ids, skus]).catch(() => {});
            }
          }
        }
      }
      if (want === 'cancelled' && !started) {
        const back = await refundForCancel(req.params.id, sel.id, req.user.sub);
        _refunded = back.refunded || 0;
        await notifyChannelStillOpen(req.params.id, 'cancelled');
      }
    }
    /**
     * THE ROLE GATE, ON THE ORDER AND NOT ONLY ON THE LINE.
     *
     * stageDenial was enforced by the per-item route and by the UI's menu, and by nothing
     * on this route — so every rule in it (one step at a time, shipped is terminal, money
     * stages are admin's) was a suggestion to anything holding a staff token. The menu
     * builds itself from the same function, so this changes no legitimate click; it closes
     * the API behind it.
     *
     * The one exemption is the label: a purchase writes tracking and 'shipped' in a single
     * patch, and that is a shipment being RECORDED rather than somebody moving a stage. The
     * ship gate below still applies to it.
     */
    if (isStaff(req.user) && (body.factoryStatus !== undefined || body.status !== undefined)) {
      const want = normalizeStage(String(body.factoryStatus ?? body.status ?? ''));
      const cur = await q('select factory_status, factory_order from orders where id=$1', [req.params.id])
        .then((r) => r.rows[0]).catch(() => null);
      const recordingLabel = body.tracking !== undefined && want === 'shipped';
      if (cur && !recordingLabel) {
        const denial = stageDenial(String(req.user.role || ''), cur.factory_status, want, cur.factory_order === true);
        if (denial) { reply.code(403); return { error: denial }; }
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
      /**
       * APPROVED IS NOW A CHECK, NOT A CLAIM. Refused for EVERY role including admin, the
       * same way a pipeline skip is: this is not a permission, it is whether the thing
       * being approved exists yet. Asked HERE rather than at shipped because this is the
       * last moment the variant fields are still editable — after Approved they lock.
       *
       * Only on the way IN. Coming back off a hold, or stepping backwards, must not be
       * blocked by a line that was already incomplete when it went in; that would strand
       * the order at a stage nobody can leave.
       */
      if (want === 'approved') {
        const at = await q('select factory_status from orders where id=$1', [req.params.id])
          .then((r) => normalizeStage(r.rows[0] && r.rows[0].factory_status)).catch(() => '');
        const blockers = at === 'approved' ? [] : await approvalBlockers(req.params.id);
        if (blockers.length) { reply.code(409); return { error: `Can't approve — ${blockers.join('; and ')}.`, blockers }; }
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
        await notifyChannelStillOpen(req.params.id, 'cancelled');
      }
    }
    if (sets.length) {
      let where = `id=$${n}`; vals.push(req.params.id);
      if (!isStaff(req.user)) { where += ` and seller_id=$${n + 1}`; vals.push(sel.id); }
      await q(`update orders set ${sets.join(',')} where ${where}`, vals);
    }
    // Replacing the lines REWRITES RECORDED HISTORY, so it has to leave a trail that says
    // what it rewrote. This used to audit `{items: 'replaced'}` against a null `before` —
    // the verb with none of the fact. Nobody reading the log afterwards could tell whether
    // a size had been corrected or the whole order swapped out, which is the same as not
    // logging it. Snapshot both sides and store the difference.
    //
    // Deliberately narrow: the identifying + PRICED fields only, never img/design_src.
    // Those are base64 payloads that would bloat every audit row, and they aren't what
    // anyone is trying to reconstruct when they ask what changed.
    const lineSnap = (rows) => rows.map((r) => ({
      line_id: r.line_id, sku: r.sku, name: r.name, qty: r.qty, color: r.color, size: r.size,
      variant: r.variant, print_type: r.print_type, blank: r.blank,
      unit_price: r.unit_price, unit_cost: r.unit_cost, ship_fee: r.ship_fee,
    }));
    const ITEM_COLS = 'line_id, sku, name, qty, color, size, variant, print_type, blank, unit_price, unit_cost, ship_fee';
    let itemsBefore = null;
    if (wantsItems) {
      itemsBefore = await q(`select ${ITEM_COLS} from order_items where order_id=$1 order by id`, [req.params.id])
        .then((r) => lineSnap(r.rows)).catch(() => null);
    }
    if (wantsItems) await replaceItems(req.params.id, body.items);
    let itemsAfter = null;
    if (wantsItems) {
      itemsAfter = await q(`select ${ITEM_COLS} from order_items where order_id=$1 order by id`, [req.params.id])
        .then((r) => lineSnap(r.rows)).catch(() => null);
    }
    // Record only the changed scalar fields (not the heavy items array).
    const after = {}; for (const k in body) if (map[k]) after[k] = body[k];
    if (Object.keys(after).length || wantsItems) {
      const beforeEntry = wantsItems ? { ...(before || {}), items: itemsBefore } : before;
      const afterEntry = wantsItems ? { ...after, items: itemsAfter } : after;
      audit(req, 'order.updated', { entityType: 'order', entityId: req.params.id, before: beforeEntry, after: afterEntry });
    }
    if (_charged) audit(req, 'order.charged', { entityType: 'order', entityId: req.params.id, after: { amount: _charged } });
    if (_refunded) audit(req, 'order.refunded', { entityType: 'order', entityId: req.params.id, after: { amount: _refunded } });
    // ── Somebody else changed the lines on an order you have already paid for ──────
    // Tell the seller. A settled order is a record they're entitled to consider fixed, so
    // a staff edit to it can't be something they only discover by re-reading the page.
    //
    // Gated on the CHARGE, not on staff-ness, and that's the whole judgement: before the
    // money moves, staff edits are ordinary setup work (picking a blank for a marketplace
    // line that arrived with no variants) and notifying on each one would be noise nobody
    // reads. After it, the same edit alters a record with a price attached to it.
    //
    // Best-effort and last: a notification failing must never fail an edit that has
    // already been written.
    // A RENUMBER COUNTS AS A CHANGE. The number is how the seller finds the order and what
    // their own confirmation email says, so moving it on a settled order is precisely the
    // kind of edit they must not discover by re-reading the page. Same gate as the lines:
    // before the money moves this is ordinary setup, after it, it alters a paid record.
    const renumbered = body.seq !== undefined && before && String(before.seq ?? '') !== String(body.seq);
    if ((wantsItems || renumbered) && isStaff(req.user)) {
      (async () => {
        const row = (await q('select seller_id, seq from orders where id=$1', [req.params.id])).rows[0];
        if (!row || !row.seller_id) return;
        if (await chargedAmount(req.params.id) <= 0) return;
        const num = row.seq ? `#${row.seq}` : req.params.id;
        notify({
          userIds: [String(row.seller_id)],
          type: 'order-edited',
          title: `Order ${num} was changed`,
          body: renumbered && !wantsItems
            ? `This order used to be #${before.seq ?? '—'}. The factory renumbered it; nothing else about it changed.`
            : 'The factory updated the items on this order after it was submitted. Open it to see what changed.',
          href: `/orders/${encodeURIComponent(req.params.id)}`,
          entityId: req.params.id,
        });
      })().catch(() => {});
    }
    /**
     * MOVING THE ORDER MOVES ITS LINES — here, in one request, instead of the browser
     * looping over them.
     *
     * Every client that changed an order's stage fired one item-status call PER LINE and
     * then PATCHed the order. Two problems, and both are real: a line that failed halfway
     * left the order half-moved with no way back and nothing on screen to say which lines
     * went, and the per-line gate and the order gate were evaluated SEPARATELY — the
     * authority for one move was checked twice, against two different current stages.
     *
     * The denial has already run ONCE above, against the order's own stage, which is the
     * decision the person actually made ("set this order to Working"). The lines follow it.
     *
     * NOT a replacement for item-status: production is genuinely per line, and the floor
     * moves one at a time. This is the order-level act — the one the boards and the order
     * screen mean — and it is now atomic in the only sense that matters here, a single
     * statement over every line of the order.
     */
    if (body.factoryStatus !== undefined) {
      const want = String(body.factoryStatus ?? '');
      const r = await q('update order_items set factory_status=$1 where order_id=$2', [want, req.params.id])
        .catch((e) => { console.error('[orders] lines did not follow the order stage:', e.message); return null; });
      if (r) audit(req, 'order.stage_lines', {
        entityType: 'order', entityId: String(req.params.id),
        after: { status: want, lines: r.rowCount },
      });
    }
    // The stage's effect on the shelf, whichever stage it is — see applyStockForStage.
    // This was `if working: reserve`, which is why nothing was ever given back when an
    // order moved the other way.
    let _parked = null;
    if (body.factoryStatus !== undefined || body.status !== undefined) {
      const want = String(body.factoryStatus ?? body.status ?? '');
      await markApproved(req.params.id, want);
      await applyStockForStage(req.params.id, want);
      /**
       * WHAT WE HAVEN'T GOT, IN THE CART, AT THE MOMENT WE TOOK THE JOB.
       *
       * Shortages were only parked at WORKING — the stage where somebody is already at the
       * bench and the blank is supposed to be in their hand. Approved is where the factory
       * accepts the order, and it is the last quiet moment before that: a line whose shelf
       * reads zero has to be bought, and the person who buys it needs it on their list now,
       * not when the press stops.
       *
       * autoReplenish is idempotent per (order, cart line) — it records the order on the
       * parked row and skips a second visit — so approving, then working, then bouncing back
       * cannot double-order. It parks NOTHING when the shelf can cover the line.
       */
      const stage = normalizeStage(want);
      if (stage === 'approved' || stage === 'working') {
        _parked = await autoReplenish(req.params.id).catch(() => null);
      }
    }
    egBroadcast({ type: 'orders' });
    // The cart badge is a live count in every open tab, so a shortage parked here has to
    // announce itself the same way an order does.
    if (_parked && _parked.saved) egBroadcast({ type: 'cart' });
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
      /**
       * WHERE IT WAS WHEN IT WAS HELD.
       *
       * On hold is a STOP, not a place in the pipeline, so coming off it has to go
       * somewhere — and "somewhere" is where the work actually was. Recorded at the moment
       * of holding, because afterwards the stage IS on_hold and the previous one is gone.
       * The UI falls back to Working when this is absent, which is what every order held
       * before today will do.
       */
      if (stage === 'on_hold') {
        const cur = await q('select factory_status from orders where id=$1', [req.params.id])
          .then((r) => String(r.rows[0]?.factory_status || '')).catch(() => '');
        const from = normalizeStage(cur);
        if (from && from !== 'on_hold') {
          await q(`update orders set meta = coalesce(meta,'{}'::jsonb) || $2::jsonb where id=$1`,
            [req.params.id, JSON.stringify({ held_from: from })]).catch(() => {});
        }
      }
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
      /**
       * THE HOLD FOLLOWS THE ORDER OUT OF PRODUCTION.
       *
       * Whole-order shipped, cancelled or refunded all end the claim these blanks had on
       * the shelf. Shipped is the one that matters most: the scan that took the units off
       * is what lowers in_stock, so a reservation surviving it subtracts the same garment
       * twice and hides real stock. Cancelled and refunded never consumed anything at all.
       */
      // (The shelf is handled by applyStockForStage above — for EVERY stage, not only
      //  these three. Cancelled and refunded now put back what the order actually took.)
      if (body.tracking !== undefined || stage === 'shipped') {
        notifyOrderEvent(req.params.id, 'order.shipped');
        // Auto-push tracking to the marketplace (GATED — a dry run until MARKETPLACE_FULFILL_LIVE=1).
        // Best-effort: a marketplace hiccup must never fail the ship. Guarded by
        // marketplace_fulfilled_at so a re-save can't re-email the buyer; a dry run doesn't
        // stamp it, so flipping the gate later still fires the real push.
        try {
          const push = await fulfillMarketplace(req.params.id);
          if (push && push.ok) {
            audit(req, 'order.marketplace_fulfilled', { entityType: 'order', entityId: req.params.id, after: { channel: push.channel } });
          }
        } catch (e) { req.log && req.log.warn && req.log.warn({ err: String(e) }, 'marketplace tracking push failed'); }
      }
      else if (stage === 'cancelled' || stage === 'refunded') notifyOrderEvent(req.params.id, 'order.cancelled');
      else if (stage) notifyOrderEvent(req.params.id, 'order.status_changed');
    }
    // `parked` — how many cart lines this stage change added, so the caller can move the
    // cart badge without refetching the list.
    return { ok: true, parked: (_parked && _parked.saved) || undefined,
             charged: _charged || undefined, refunded: _refunded || undefined };
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
    const designFees = await computeDesignFees(req.params.id).catch(() => ({ items: [], total: 0 }));
    /**
     * WHAT THE BLANKS COST US NEVER REACHES A SELLER.
     *
     * It names our margin outright, and read across a few orders it reconstructs our
     * supplier's price list — the same reason sellerSafe strips productCost from the
     * catalogue and §2.9 withholds who supplies us. Stripped HERE, on the way out, rather
     * than left to each screen to remember: a field that has to be hidden by every
     * consumer is a field that will be shown by one of them.
     */
    if (!isStaff(req.user)) {
      quote.lines = (quote.lines || []).map(({ supplierCost, ...l }) => l);
      delete quote.supplierTotal;
      delete quote.supplierKnown;
    }
    return { ...quote, designFees, charged: paid > 0 ? paid : 0, balance: await balanceOf(row.seller_id) };
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

  /**
   * Flag or clear a rush. ANY staff, operators included.
   *
   * This is the andon cord: the person who notices a job is urgent is usually the one
   * standing at the machine, and an operator's zone ending at scan is about custody and
   * money, not about being unable to raise a hand. Nothing here moves a stage or touches a
   * balance — it reorders a queue — so gating it to warehouse would only mean the operator
   * tells someone else to click it.
   */
  app.post('/api/orders/:id/rush', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }
    const on = (req.body || {}).rush !== false;
    const r = await q(
      `update orders set rush=$1, rushed_by=$2, rushed_at=$3 where id=$4
        returning id, rush, rushed_at`,
      [on, on ? req.user.sub : null, on ? new Date() : null, String(req.params.id)]
    ).catch(() => ({ rows: [] }));
    if (!r.rows[0]) { reply.code(404); return { error: 'No such order.' }; }
    audit(req, on ? 'order.rush' : 'order.rush_cleared', { entityType: 'order', entityId: String(req.params.id) });
    return { ok: true, rush: r.rows[0].rush, rushed_at: r.rows[0].rushed_at };
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
    // The order's OWNER comes back with the line: which line the stage rules read depends
    // on whether this is a seller's order or the factory's own (see FACTORY_LINE). Read in
    // the same round trip rather than a second query — this runs once per line item, and a
    // batch move walks every line of the order.
    const pre = await q(
      `select i.factory_status, coalesce(o.factory_order, false) as factory_order
         from order_items i join orders o on o.id = i.order_id
        where i.order_id=$1 and i.${key}=$2 limit 1`, [req.params.id, val]);
    if (!pre.rows[0]) { reply.code(404); return { error: 'item not found' }; }
    // Role gate — see stageDenial. Read the CURRENT stage first: an operator's reach
    // depends on where the item already is, not just where they're sending it.
    const denial = stageDenial(String(req.user.role || ''), pre.rows[0].factory_status, status, pre.rows[0].factory_order);
    if (denial) { reply.code(403); return { error: denial }; }
    // Shipping is an ORDER-level claim even when set per item: a parcel can't go out
    // half-made. Everything before shipped stays per-item and unrestricted.
    if (normalizeStage(status) === 'shipped') {
      const blockers = await shipBlockers(req.params.id);
      if (blockers.length) { reply.code(409); return { error: `Can't mark shipped — ${blockers.join('; and ')}.`, blockers }; }
    }
    /* Same check the order PATCH makes — an item route can walk a line to Approved just as
       easily, and a gate present on one path and absent on the other is not a gate. Only
       on the way in; see the note there. */
    if (normalizeStage(status) === 'approved' && normalizeStage(pre.rows[0].factory_status) !== 'approved') {
      const blockers = await approvalBlockers(req.params.id);
      if (blockers.length) { reply.code(409); return { error: `Can't approve — ${blockers.join('; and ')}.`, blockers }; }
    }
    await q(`update order_items set factory_status=$1 where order_id=$2 and ${key}=$3`,
      [status || '', req.params.id, val]);
    audit(req, 'item.status', { entityType: 'order', entityId: req.params.id,
      before: { sku, status: (pre.rows[0] && pre.rows[0].factory_status) || '' }, after: { sku, status: status || '' } });
    /**
     * A rush ENDS when the order does — and only then.
     *
     * It deliberately survives every other stage change: the whole point is that it stays
     * visible from wherever it was raised until the parcel leaves, and a flag that cleared
     * on the next stage would have to be re-raised at each step by someone who no longer
     * remembers why. But a shipped order pinned to the top of the queue forever is the
     * wallpaper problem the Overdue count already showed us, so shipped clears it.
     *
     * Only when EVERY line is shipped: one line of a three-line order going out is not the
     * order going out.
     */
    if (normalizeStage(status) === 'shipped') {
      const left = await q(
        `select 1 from order_items where order_id=$1 and coalesce(factory_status,'') <> 'shipped' limit 1`,
        [req.params.id]
      ).catch(() => ({ rowCount: 1 }));
      if (!left.rowCount) {
        await q('update orders set rush=false, rushed_by=null, rushed_at=null where id=$1 and rush=true',
          [req.params.id]).catch(() => {});
      }
    }
    // Tell whoever pushed this order that it moved. Fire and forget — a partner's
    // endpoint being down must never fail the floor's status write.
    notifyOrderEvent(req.params.id, normalizeStage(status) === 'shipped' ? 'order.shipped' : 'order.status_changed',
      { line: { sku, line_id: lineId || null }, status: normalizeStage(status) || null });
    // ACCEPTING WORK tops the blanks back up: anything now projected below its reorder
    // point is appended to that supplier's DRAFT purchase order (draft only — placing an
    // order stays a human click on the Purchase board).
    //
    // Keyed on 'working', which is where an accepted order now lands. It was keyed on the
    // retired scan stage, which was the same moment under a name that described the label.
    // Committing to make something is what consumes a blank; buying its postage is not.
    //
    // Designs are DELIBERATELY not auto-carded here. A design reaches the board only when a
    // human sends it (Send to designer / Send to Pink), so a status change — or a label —
    // never floods the board. `design` stays null to keep the response shape stable for
    // existing callers. (autoPushDesigns is now dormant.)
    //
    // AND IT HOLDS THE BLANKS. Accepting the work is the moment the units stop being
    // available to anything else, which is what `reserved` was always for and what nothing
    // ever wrote — so Available read exactly as In stock and two orders for the last six
    // shirts both looked makeable. Idempotent per order, so bouncing working → hold →
    // working settles rather than stacks. Only `reserved` moves; a scan is still the only
    // thing that takes a garment off the shelf.
    let design = null, replenish = null, reserved = null;
    // The shelf follows the stage here exactly as it does on the order — one helper, so the
    // board and the order screen can never disagree about what Working means to inventory.
    // Only when the WHOLE order has reached the stage, though: this route moves one line,
    // and stock is held and taken per order. A single line going to Working while its
    // siblings sit at Approved must not take the other lines' blanks off the shelf.
    {
      const want = normalizeStage(status);
      const behind = await q(
        `select 1 from order_items where order_id=$1 and coalesce(factory_status,'') <> $2 limit 1`,
        [req.params.id, status]
      ).catch(() => ({ rowCount: 1 }));
      // Both are ORDER-level facts, so both wait for the whole order to arrive: one line of
      // five reaching Approved is not the factory accepting the job, and must not close the
      // seller's cancel window or take the other lines' blanks off the shelf.
      if (!behind.rowCount) {
        await markApproved(req.params.id, want);
        reserved = await applyStockForStage(req.params.id, want);
      }
      /**
       * APPROVED PARKS THE SHORTAGES TOO — see the note on the same call in PATCH above.
       * Approved is the factory accepting the job; a blank the shelf cannot cover has to
       * reach the buyer's cart then, not when someone picks the line up to work it.
       * Idempotent per (order, cart line), so a line arriving at approved and then at
       * working parks once.
       */
      if (want === 'approved' || want === 'working') replenish = await autoReplenish(req.params.id).catch(() => null);
    }
    egBroadcast({ type: 'item-status' });   // no id/sku — see the note above
    // Same as the order route: a parked shortage moves the cart badge for everyone looking.
    if (replenish && replenish.saved) egBroadcast({ type: 'cart' });
    return { ok: true, design, replenish, reserved };
  });

  // ── Variant setup — the blank/colour/size/method for a line item ────────────
  // Marketplace orders (Etsy/Shopify) arrive with UNSET variants, so they can't be
  // priced or submitted until someone picks them; a listing published FROM our catalog
  // arrives already resolvable by SKU. Either way this is where the picks are saved.
  // Keyed by line_id when present (identical-SKU siblings), else sku. Seller-owner OR
  // staff may set them (canSeeOrder), but ONLY before the price is locked: once the
  // seller has submitted (and been charged), the frozen cost must not silently drift
  // from the variants it was based on.
  /**
   * Set (or clear) the seller's own mockup for one side of one line.
   *
   * canSeeOrder, like item-setup: this is the seller's own photograph of their own product,
   * so the owner sets it and staff working the line can too. It is NOT gated on the price
   * being unlocked the way variants are — a backdrop changes nothing that was quoted.
   *
   * IT IS NOT ARTWORK, and nothing here treats it as any. The ship gate reads order_designs;
   * this writes order_items.mockups. A line with a beautiful mockup and no print file is
   * still a line with no print file, and still cannot ship.
   *
   * `url` null clears the side and falls the stage back to our catalogue photo. Only a
   * SAME-ORIGIN path is accepted: the client uploads through /api/support/attachment and
   * hands back what that returns, so nothing here fetches or stores a remote address that
   * could rot, redirect, or point at a supplier's CDN (§2.9).
   */
  app.post('/api/orders/:id/item-mockup', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const b = req.body || {};
    const lineId = b.line_id ? String(b.line_id) : null;
    const sku = b.sku != null ? String(b.sku) : null;
    if (!lineId && !sku) { reply.code(400); return { error: 'line_id or sku required' }; }
    const side = String(b.side || 'front').toLowerCase().trim() || 'front';
    /**
     * SAME-ORIGIN, AND STORED AS A PATH.
     *
     * This accepted only a value already starting with /api/ — and the upload route it is
     * fed from returns an ABSOLUTE url (`${attachBase()}/api/support/asset/…`). So every
     * save was refused with a 400 the moment it left the browser, and the backdrop never
     * changed: the whole feature was dead on arrival and looked like a rendering fault.
     *
     * The PATH is what gets stored, absolute or not. It is what the rest of the app already
     * does with an asset (assetUrl adds the origin back), it survives the host moving — this
     * VPS has moved once already — and it is the part worth checking anyway. An address on
     * somebody else's domain is still refused: a stored remote url can rot, redirect, or name
     * a supplier's CDN (§2.9), none of which we would find out about.
     */
    let raw = b.url == null || b.url === '' ? null : String(b.url);
    if (raw) {
      let path = raw;
      if (/^https?:\/\//i.test(raw)) {
        try { path = new URL(raw).pathname; } catch { path = ''; }
      }
      if (!/^\/api\/(support\/asset|design_cards\/art|order_designs\/art|order_items)\//.test(path)) {
        reply.code(400);
        return { error: 'A mockup has to be an image uploaded here, not a link to one elsewhere.' };
      }
      raw = path;
    }
    const key = lineId ? 'line_id' : 'sku';
    const val = lineId || sku;
    // Merge, never replace: the sides are independent, and writing the whole object would
    // drop the front the moment somebody set a back.
    const r = await q(
      `update order_items
          set mockups = case when $1::text is null
                             then coalesce(mockups, '{}'::jsonb) - $2::text
                             else coalesce(mockups, '{}'::jsonb) || jsonb_build_object($2::text, $1::text) end
        where order_id=$3 and ${key}=$4
        returning mockups`,
      [raw, side, req.params.id, val]
    );
    if (!r.rows[0]) { reply.code(404); return { error: 'item not found' }; }
    audit(req, raw ? 'item.mockup' : 'item.mockup_cleared',
      { entityType: 'order', entityId: String(req.params.id), after: { line: lineId || sku, side } });
    return { ok: true, mockups: r.rows[0].mockups || {} };
  });

  app.post('/api/orders/:id/item-setup', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const b = req.body || {};
    const lineId = b.line_id ? String(b.line_id) : null;
    const sku = b.sku != null ? String(b.sku) : null;
    if (!lineId && !sku) { reply.code(400); return { error: 'line_id or sku required' }; }
    // Editable only before production. A charged order's variants are settled — changing
    // them would desync order_items.unit_cost/ship_fee (frozen at submit). Cheapest guard:
    // block once anything on the order has been charged.
    // NB the lock is PERMANENT, and the message has to say so. chargedAmount reads the
    // charge leg of an append-only ledger, and a refund writes a different type entirely
    // ('order-refund'), so cancelling never brings this back below zero. Nor should it:
    // a cancelled order can't be resubmitted either (the submit guard refuses any
    // factory_status outside ''/new/draft), so there is no second charge for edited
    // variants to be priced into. The old wording promised "cancel it first to change
    // variants", which reads as a way out and is one the code has never had.
    /**
     * THE FLOOR MAY CORRECT A LINE UNTIL IT IS APPROVED.
     *
     * The lock used to be "charged", which put it at SUBMIT — before an operator had so
     * much as looked at the order. They are the ones who spot the wrong colour on the way
     * in, and they had to ask an admin to change it.
     *
     * Approved is the honest boundary: it is the stage where a human has confirmed the
     * blank on every line, so after it a change contradicts the check rather than being
     * part of it. Draft and Pending stay open to staff; approved, working and shipped are
     * closed to everyone bar the admin carve-out below.
     *
     * WHAT THIS DOES NOT DO: re-price anything. unit_cost/ship_fee are frozen on the line
     * at submit, so an edit here changes what we MAKE, never what was billed — the same
     * thing that was already true of the admin correction. A costlier blank or a raised
     * quantity is absorbed, not invoiced, and the client says so where it is offered.
     */
    const stageNow = await q('select factory_status from orders where id=$1', [req.params.id])
      .then((r) => normalizeStage(r.rows[0] && r.rows[0].factory_status)).catch(() => '');
    const beforeApproval = stageNow === '' || stageNow === 'in_review';
    const staffMayEdit = isStaff(req.user) && beforeApproval;
    const charged = await chargedAmount(req.params.id);
    /* Declared out here because the AUDIT at the end of this handler records it, and the
       lock below is a block — a const inside it is not in scope where the row is written. */
    let grantedOperator = false;
    if (charged > 0 && !staffMayEdit) {
      /**
       * ADMIN MAY STILL CORRECT A LINE UNTIL THE BLANKS ARE ORDERED.
       *
       * The price is frozen at submit either way — unit_cost/ship_fee are stored on the
       * line — so an edit after charging changes what we MAKE, not what was billed. Up to
       * the moment a purchase order goes to the supplier that is a correction; after it,
       * the wrong garment is already bought and the fix is a new line, not a new colour.
       * Everyone else stays locked at submit.
       */
      const isAdmin = req.user && req.user.role === 'admin';
      /**
       * AND AN OPERATOR MAY, IF AN ADMIN HAS SWITCHED IT ON (Settings › Permissions).
       *
       * The window this opens is exactly the admin one above — corrections stop when the
       * blanks are ordered — because the reason it stops is a fact about the world (the wrong
       * garment is already bought), not a fact about rank. What the grant changes is WHO may
       * act inside it, which is the actual problem it exists for: a wrong colour spotted
       * after approval otherwise waits for an admin to be free.
       *
       * It stays outside §2.6 and the money: unit_cost/ship_fee were frozen on the line at
       * submit, so nothing here re-prices, and cancel/refund are not on this route at all.
       * The grant reads FAIL CLOSED, so a database that cannot answer leaves the rule exactly
       * as it is without one.
       */
      grantedOperator = !isAdmin
        && !!req.user && req.user.role === 'operator'
        && await isGrantEnabled('operator.editAfterApproval');
      const mayCorrect = isAdmin || grantedOperator;
      const placed = mayCorrect ? await q(
        `select 1 from purchase_orders po
          where coalesce(po.status,'draft') <> 'draft'
            and exists (
              select 1 from jsonb_array_elements(coalesce(po.items,'[]'::jsonb)) it,
                           jsonb_array_elements(coalesce(it->'sources','[]'::jsonb)) src
               where src->>'order' = $1)
          limit 1`, [req.params.id]).then((r) => r.rowCount > 0).catch(() => true) : false;
      if (!mayCorrect || placed) {
        reply.code(409);
        return { error: placed ? 'Blanks already ordered — this line is locked.' : 'Order submitted — variants are locked.' };
      }
    }
    // Only the fields the picker owns; undefined = leave as-is.
    const sets = [], vals = []; let n = 1;
    for (const [key, col] of [['blank', 'blank'], ['color', 'color'], ['size', 'size'], ['printType', 'print_type'], ['variant', 'variant']]) {
      if (b[key] !== undefined) { sets.push(`${col}=$${n++}`); vals.push(b[key] === '' ? null : String(b[key])); }
    }
    // QTY, clamped rather than trusted. A line of 0 is a line that should have been
    // removed, and there is no order on this platform for ten thousand of one item — an
    // unbounded number here reaches pricing, purchase orders and the floor's pick list.
    if (b.qty !== undefined) {
      const qn = Math.max(1, Math.min(999, Math.round(Number(b.qty) || 0)));
      sets.push(`qty=$${n++}`); vals.push(qn);
    }
    if (!sets.length) { reply.code(400); return { error: 'nothing to set' }; }
    let where = `order_id=$${n++}`; vals.push(req.params.id);
    if (lineId) { where += ` and line_id=$${n++}`; vals.push(lineId); }
    else { where += ` and sku=$${n++}`; vals.push(sku); }
    const r = await q(`update order_items set ${sets.join(',')} where ${where}`, vals);
    if (!r.rowCount) { reply.code(404); return { error: 'item not found' }; }
    audit(req, 'item.setup', {
      entityType: 'order', entityId: req.params.id,
      // `grant` names the permission that allowed a change the role could not otherwise
      // make. Absent on every ordinary edit, so its presence is the whole signal.
      after: { line_id: lineId, sku, ...b, ...(grantedOperator ? { grant: 'operator.editAfterApproval' } : null) },
    });
    egBroadcast({ type: 'orders' });
    return { ok: true };
  });

  /**
   * ADD A LINE TO AN ORDER THAT IS STILL BEING SET UP.
   *
   * An order arrives with what the buyer bought, and sometimes that is not what has to be
   * made — a second garment, a replacement for one that can't be sourced. The only way to
   * add one was to raise a whole new order, which splits one parcel into two.
   *
   * Same boundary as item-setup: staff, until the order is approved. It writes a line with
   * NO unit_cost, so nothing about the money changes — an added line is produced, and the
   * charge, which was frozen at submit, is not reopened. That is a deliberate asymmetry and
   * the client says so at the button.
   */
  app.post('/api/orders/:id/items', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    // Staff only. A seller adding a line to an order they have already been charged for
    // would be asking to be produced something nobody billed them for.
    if (!isStaff(req.user)) { reply.code(403); return { error: 'forbidden' }; }
    const stageNow = await q('select factory_status from orders where id=$1', [req.params.id])
      .then((r) => (r.rowCount ? normalizeStage(r.rows[0].factory_status) : null)).catch(() => null);
    if (stageNow === null) { reply.code(404); return { error: 'order not found' }; }
    if (!(stageNow === '' || stageNow === 'in_review')) {
      reply.code(409);
      return { error: 'This order has been approved — add a line before approval, or raise a new order.' };
    }
    const b = req.body || {};
    const qty = Math.max(1, Math.min(999, Math.round(Number(b.qty) || 1)));
    // EVERY LINE IS ADDRESSABLE. line_id is the identity the designer, the artwork rows and
    // the pick list all key on; a line without one collides with its own siblings (see the
    // backfill at the top of this file).
    const lineId = `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await q(
      `insert into order_items (order_id, sku, name, print_type, qty, color, size, blank, line_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.params.id, b.sku ? String(b.sku) : null, b.name ? String(b.name) : 'New item',
       b.printType ? String(b.printType) : null, qty,
       b.color ? String(b.color) : null, b.size ? String(b.size) : null,
       b.blank ? String(b.blank) : null, lineId]
    );
    audit(req, 'item.add', { entityType: 'order', entityId: req.params.id, after: { line_id: lineId, name: b.name || 'New item', qty } });
    egBroadcast({ type: 'orders' });
    return { ok: true, lineId };
  });

  /**
   * REMOVE A LINE — because a buyer orders the wrong thing and somebody has to fix it.
   *
   * MIRRORS THE ADD ROUTE EXACTLY, and that is what makes it safe. Staff only, and only
   * while the order is unsubmitted or in review — which is BEFORE chargeForSubmit runs, so
   * there is no wallet leg to unwind. A delete allowed after approval would need a refund
   * and would rewrite a settled charge; it is refused instead, with the same sentence the
   * add route uses, because the honest answer at that point is to cancel and raise again.
   *
   * A SYNCED LINE DELETES LIKE ANY OTHER. It is our copy of what the marketplace sent, and
   * removing it changes nothing at Etsy or Shopify — sync must never overwrite what it did
   * not author (§2.6), and this does not write upstream at all.
   *
   * The audit carries the whole row as `before`. §"recorded history never changes silently":
   * a line that existed and now does not is exactly the case where the record has to say
   * what was there.
   */
  /**
   * TWO SHAPES, ONE HANDLER — and the second exists because of a real failure.
   *
   * With the identifier as a PATH segment, anything that makes it empty or oddly encoded
   * produces a URL that matches no route at all, and Fastify answers with its own 404 whose
   * body is {error:"Not Found"} — which the client then shows verbatim. That looks like the
   * line is missing when the truth is the request never reached this handler.
   *
   * `?line=` cannot do that: the route matches on the path alone, so a bad identifier
   * reaches the handler and gets an answer that says what is actually wrong.
   */
  const removeLine = async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    if (!isStaff(req.user)) { reply.code(403); return { error: 'forbidden' }; }
    const stageNow = await q('select factory_status from orders where id=$1', [req.params.id])
      .then((r) => (r.rowCount ? normalizeStage(r.rows[0].factory_status) : null)).catch(() => null);
    if (stageNow === null) { reply.code(404); return { error: 'order not found' }; }
    if (!(stageNow === '' || stageNow === 'in_review')) {
      reply.code(409);
      return { error: 'This order has been approved — remove a line before approval, or cancel and raise a new order.' };
    }
    /**
     * line_id is line IDENTITY (§5), and it is what this deletes by. But a caller can only
     * send what the row HAS: the client addresses a line as `line_id ?? sku`, because the
     * backfill has not always run and older rows carry only a sku. Matching line_id alone
     * meant those rows returned "line not found" for a line plainly on the screen.
     *
     * So: line_id first. Falling back to sku ONLY when exactly one row carries it — two
     * lines of one sku are two jobs, and deleting "the sku" would take the sibling with it,
     * which on a two-colour order is the wrong line half the time. Ambiguous means refuse
     * and say why, never guess.
     */
    const key = String(req.params.lineId ?? (req.query && req.query.line) ?? '').trim();
    if (!key) { reply.code(400); return { error: 'No line was named to remove. Reload the page and try again.' }; }
    let found = await q('select * from order_items where order_id=$1 and line_id=$2', [req.params.id, key]);
    let byLineId = found.rowCount > 0;
    if (!byLineId) {
      const bySku = await q('select * from order_items where order_id=$1 and sku=$2', [req.params.id, key]);
      if (bySku.rowCount > 1) {
        reply.code(409);
        return { error: 'This order has more than one line with that SKU and they are different jobs. Reload the page so each line carries its own id, then remove the one you mean.' };
      }
      found = bySku;
    }
    if (!found.rowCount) { reply.code(404); return { error: 'That line is no longer on this order — it may already have been removed.' }; }
    await q(
      byLineId
        ? 'delete from order_items where order_id=$1 and line_id=$2'
        : 'delete from order_items where order_id=$1 and sku=$2',
      [req.params.id, key]
    );
    audit(req, 'item.remove', { entityType: 'order', entityId: req.params.id, before: found.rows[0] });
    egBroadcast({ type: 'orders' });
    return { ok: true };
  };
  app.delete('/api/orders/:id/items/:lineId', { preHandler: requireAuth }, removeLine);
  app.delete('/api/orders/:id/items', { preHandler: requireAuth }, removeLine);

  /**
   * DUPLICATE AN ORDER INTO A FRESH DRAFT.
   *
   * A cancelled order is settled — it was cancelled, and if it had been charged the seller
   * was refunded. Reopening it would rewrite that, and there is a money trap underneath:
   * chargeForSubmit skips when chargedAmount() > 0, and chargedAmount sums only the CHARGE
   * leg. A refund writes a different type and never subtracts, so a reopened order would
   * read "already charged" and go to production for nothing.
   *
   * So the cancelled order stays cancelled and this makes a NEW one. New id, empty charge
   * ledger, submit charges properly. It is the same shape purchasing already uses to buy a
   * past PO's lines again.
   *
   * IT CARRIES EVERYTHING BUT THE MONEY: lines, variants, quantities, customer, address and
   * the artwork on every line — an embroidery order re-uploaded by hand is most of the work
   * done twice. What it deliberately drops is unit_cost and ship_fee (frozen at the old
   * order's submit — the new one is priced today) and every charge, refund and status.
   */
  app.post('/api/orders/:id/duplicate', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const src = await q('select * from orders where id=$1', [req.params.id]).then((r) => r.rows[0]);
    if (!src) { reply.code(404); return { error: 'Order not found' }; }
    // A seller may only duplicate their own; staff may duplicate any they can see.
    const sel = isStaff(req.user) ? null : await resolveSeller(req.user);
    if (sel && src.seller_id !== sel.id) { reply.code(403); return { error: 'forbidden' }; }

    const items = await q('select * from order_items where order_id=$1 order by id', [req.params.id]).then((r) => r.rows);
    if (!items.length) { reply.code(409); return { error: 'This order has no lines to copy.' }; }

    // Same shape the client mints: FF-<tag>-<ms base36>-<rand>. Server-side because the
    // copy has to be atomic with the lines and the artwork.
    const newId = 'FF-dup-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
    const seq = await q("select coalesce(max(seq),0) + 1 as n from orders where seller_id=$1 and coalesce(factory_order,false)=false",
      [src.seller_id]).then((r) => r.rows[0]?.n || 1).catch(() => null);

    /**
     * SOURCE BECOMES MANUAL. The original may have come from Etsy, and this order did not —
     * nothing was bought on a marketplace, so claiming it was would put a fake receipt in
     * the channel reports. Where it came from is recorded in meta instead, which is also
     * what makes the pair readable afterwards.
     */
    const meta = { ...(src.meta && typeof src.meta === 'object' ? src.meta : {}), duplicated_from: String(req.params.id) };
    delete meta.retail_set;                       // the sale price was the OLD order's claim
    await q(
      `insert into orders (id, seller_id, store, source, customer, address, status, factory_status,
                           total, seq, meta, factory_order, created_by)
       values ($1,$2,$3,'manual',$4,$5,'new','',0,$6,$7,$8,$9)`,
      [newId, src.seller_id, src.store || null, src.customer, src.address, seq, JSON.stringify(meta),
       src.factory_order === true, req.user.sub]
    );

    // Lines, each with a NEW line_id — the old one addresses the old order's artwork, and
    // two orders sharing a line id is the collision this codebase has already paid for once.
    const lineMap = new Map();
    for (const it of items) {
      const lineId = `FFL-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
      lineMap.set(it.line_id || ('S:' + it.sku), lineId);
      await q(
        `insert into order_items (order_id, sku, name, print_type, qty, color, size, variant,
                                  unit_price, design_src, img, blank, design_pos, line_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [newId, it.sku, it.name, it.print_type, it.qty, it.color, it.size, it.variant,
         it.unit_price, it.design_src, it.img, it.blank, it.design_pos, lineId]
      );
    }

    /**
     * AND THE ARTWORK. Copied by REFERENCE where the bytes are in storage (storage_key) and
     * by value where they are inline, so a duplicate costs no extra storage for the common
     * case. Best-effort per row: a design that fails to copy must not lose the order.
     */
    let art = 0;
    const designs = await q('select * from order_designs where order_id=$1', [req.params.id])
      .then((r) => r.rows).catch(() => []);
    for (const d of designs) {
      const to = lineMap.get(d.line_id || ('S:' + d.sku));
      if (!to) continue;
      const ok = await q(
        `insert into order_designs (order_id, sku, line_id, kind, side, data, storage_key, name, pos, art_hash, art_phash, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         on conflict do nothing`,
        [newId, d.sku, to, d.kind, d.side, d.data, d.storage_key, d.name, d.pos, d.art_hash, d.art_phash]
      ).then(() => true).catch(() => false);
      if (ok) art++;
    }

    audit(req, 'order.duplicate', { entityType: 'order', entityId: newId,
      before: { from: String(req.params.id) }, after: { id: newId, lines: items.length, artwork: art } });
    egBroadcast({ type: 'orders' });
    return { ok: true, id: newId, seq, lines: items.length, artwork: art };
  });

  // ── Design uploads (server-stored, so localStorage size is irrelevant) ──────
  // Save one design (data URL) for an order item.
  //
  // Upsert key is (order_id, coalesce('L:'||line_id, 'S:'||sku), kind) — LINE first, and the
  // prefixes keep the two id namespaces apart. This comment used
  // to say "(order, sku, kind)", which is the pre-line_id behaviour and is wrong: keyed on
  // sku alone, two lines of the same sku share one artwork row and attaching art to one
  // silently replaces the other's. The SQL was fixed; the comment was not, and it has since
  // been believed by someone writing new code against it.
  app.post('/api/orders/:id/designs', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const { sku, data, name, kind, pos } = req.body || {};
    // Line identity, when the caller knows it. Falls back to sku-keying so older clients
    // and marketplace sync keep working — see the migration above.
    const lineId = (req.body || {}).line_id ? String((req.body || {}).line_id) : null;
    /**
     * WHICH FACE OF THE GARMENT. Absent means front, which is what every row written before
     * per-side artwork existed already is.
     *
     * Normalised to lower-case and length-capped, and deliberately NOT checked against a
     * fixed list: the faces a blank has come from its own mockups and its product type
     * (front/back/left/right, plus hood or pocket on some), so an enum here would refuse a
     * face the catalogue legitimately offers. The value only ever selects a row.
     */
    const side = (req.body || {}).side
      ? (String((req.body || {}).side).trim().toLowerCase().slice(0, 24) || 'front')
      : 'front';
    // Artwork keys line-first (coalesce('L:'||line_id,'S:'||sku)), so a marketplace line whose
    // SKU is still unset attaches by line_id. Require DATA + a line identity, not specifically
    // a SKU — the old `!sku` check rejected exactly those lines with "sku and data required".
    if (!data || (!sku && !lineId)) return { error: 'data and (sku or line id) required' };
    const posJson = (pos && typeof pos === 'object') ? JSON.stringify(pos) : null;
    // Exact hash is ours, never the client's — it decides whether an already-produced
    // machine file may be reused, so a forged one would attach the wrong deliverable.
    // The perceptual hash is only ever a suggestion, so taking it from the client is fine.
    const artPhash = isPhash(req.body && req.body.phash) ? String(req.body.phash).toLowerCase() : null;
    /**
     * BYTES OR A REFERENCE — and this route could not tell them apart.
     *
     * `data` is a data: URL when someone has just picked a file, and one of OUR OWN artwork
     * addresses when they opened a design that is already saved, nudged it, and pressed
     * Save again. Both were handed to fromDataUrl(), whose fallback base64-DECODES anything
     * that isn't a data: URL — so a ~500-character signed storage link decoded (Node's
     * decoder stops at the first '=') to 64 bytes of noise, which was uploaded OVER the
     * row's own object and written back as its storage key. The save returned ok, the
     * readiness tag stayed green, and the artwork was gone.
     *
     * Not hypothetical: order_designs for etsy-4128916808 and etsy-4127934165 each hold a
     * 64-byte object whose first bytes are the decode of "https://egfulfill-files…". Those
     * two are unrecoverable — the originals were replaced in the bucket.
     *
     * design_cards.js hit the identical trap on its own upload and documents it there; the
     * fix never reached this route. So a reference is now RESOLVED, never decoded: both
     * shapes this API has handed out are recognised — the same-origin re-serve
     * (/api/order_designs/art/<hash>) and a bucket URL carrying the object key — and the
     * row that owns those bytes supplies them. Re-saving a position is then a metadata
     * write that touches no object at all.
     *
     * Otherwise: push the bytes to object storage when it's configured and keep only the
     * key in Postgres. Base64 artwork bloats the DB and every query that touches it, and an
     * outside design partner (Pink Design) can only be given a URL. When storage is off,
     * `data` keeps the inline base64 exactly as before.
     */
    const raw = String(data);
    let artHash = hashOf(raw), storedData = raw, storedKey = null;
    if (/^data:/i.test(raw)) {
      if (storageEnabled()) {
        try {
          const parsed = fromDataUrl(raw);
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
    } else {
      const byHash = raw.match(/\/api\/order_designs\/art\/([0-9a-f]{16,64})/i);
      const byKey = byHash ? null : raw.match(/\/(order-designs\/[^?#\s]+)/i);
      if (byHash || byKey) {
        // A hash can match several rows — the same artwork on two lines, one saved before
        // storage was switched on and one after. Prefer the row that still has an object:
        // taking the inline twin would quietly move megabytes of base64 back into Postgres,
        // which is the thing object storage exists to stop.
        const prior = await q(
          `select data, storage_key, art_hash from order_designs where ${byHash ? 'art_hash' : 'storage_key'}=$1
            order by (storage_key is not null) desc limit 1`,
          [byHash ? byHash[1].toLowerCase() : decodeURIComponent(byKey[1])]
        ).then((r) => r.rows[0]).catch(() => null);
        // Not found → fall through and keep the link verbatim. A link that renders is a
        // worse row than the real bytes and a far better one than 64 bytes of noise.
        if (prior) {
          storedData = prior.data; storedKey = prior.storage_key;
          if (prior.art_hash) artHash = prior.art_hash;
        }
      }
      // Anything else is a plain link — a marketplace image, a library pick. Stored as a
      // link, which is what it is; readers already render `data` as an <img src>.
    }
    /**
     * ABSENT, EMPTY AND SET ARE THREE DIFFERENT ANSWERS.
     *
     * - absent  — the caller has nothing to say about provenance (the mobile app, an older
     *             web build, any integration written before this existed). KEEP what is
     *             recorded: a client that does not know about templates must not be able to
     *             erase one by saving a line for an unrelated reason.
     * - ""      — the caller is saying "this artwork did NOT come off a template", which is
     *             what replacing a templated design with an uploaded file means. CLEAR it,
     *             because leaving the old id would attribute a new picture to a recipe it
     *             was never cut from, and a wrong provenance is worse than none.
     * - "TPL-…" — set it.
     */
    const rawTpl = (req.body || {}).template_id ?? (req.body || {}).templateId;
    const tplSpoken = rawTpl !== undefined && rawTpl !== null;
    const templateId = String(rawTpl || '').trim().slice(0, 64) || null;
    await q(
      `insert into order_designs (order_id, sku, line_id, kind, side, data, storage_key, name, pos, art_hash, art_phash, template_id, updated_at)
       values ($1,$2,$10,$3,$11,$4,$9,$5,$6,$7,$8,$12, now())
       on conflict (order_id, (coalesce('L:' || line_id, 'S:' || sku)), kind, (coalesce(side,'front'))) do update set data=excluded.data, storage_key=excluded.storage_key, name=excluded.name, pos=excluded.pos,
         art_hash=excluded.art_hash, art_phash=coalesce(excluded.art_phash, order_designs.art_phash),
         /* $13 is "the caller spoke about templates at all" — see tplSpoken above. A save
            that says nothing keeps what is there; a save that says "" clears it. */
         template_id=(case when $13 then $12 else coalesce($12, order_designs.template_id) end), updated_at=now()`,
      [req.params.id, sku, kind || 'raster', storedData, name || null, posJson, artHash, artPhash, storedKey, lineId, side, templateId, tplSpoken]
    );
    // The artwork now has a number, minted on first sight of these exact bytes and reused
    // every time they turn up again — see design-id.js. Handed back so the uploader sees it
    // immediately rather than on the next load.
    const designNo = await designNoFor(artHash, req.params.id);
    audit(req, 'design.saved', { entityType: 'order', entityId: req.params.id, after: { sku, kind: kind || 'raster', name: name || null, design_no: designNo } });
    return { ok: true, design_no: designNo, design_id: designLabel(designNo) };
  });

  /**
   * TAKE THE ARTWORK OFF A LINE. This never existed.
   *
   * The designer has always had a ✕ on the artwork, and it only ever called setDesignUrl("")
   * — it cleared the CANVAS. Saving then refused ("Upload artwork first"), so the row stayed
   * exactly where it was and reopening the window brought the design back. A control that
   * looks like a delete and silently changes nothing is worse than no control, because the
   * person believes the job is now blank.
   *
   * WHOSE ZONE, mirroring `filesLocked` on the order page rather than inventing a new rule:
   * before submit the order is the seller's to change and staff keep their hands off; after
   * submit it is in production and the seller's is settled. Admin is the escape hatch, as
   * everywhere else here.
   *
   * WHAT IT DOES NOT DO: it does not touch design_charged_at. If the work was billed, it was
   * billed — the fee paid for a person's time, and deleting the picture afterwards does not
   * give that time back. Refunds are a decision someone makes, not a side effect of a delete
   * (see recorded history: settled records stay settled, and the audit carries the removal).
   */
  app.delete('/api/orders/:id/designs', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const b = req.body || {};
    const lineId = b.line_id ? String(b.line_id) : null;
    const sku = b.sku ? String(b.sku) : null;
    // Absent = every side on the line. A caller that knows the side removes only that one,
    // which is what a per-side ✕ needs.
    const side = b.side ? String(b.side).trim().toLowerCase().slice(0, 24) : null;
    if (!lineId && !sku) { reply.code(400); return { error: 'line id or sku required' }; }

    const ord = (await q('select factory_status from orders where id=$1', [req.params.id])).rows[0];
    const preSubmit = ['', 'new', 'draft'].includes(String((ord && ord.factory_status) || ''));
    const staff = isStaff(req.user);
    const admin = req.user && req.user.role === 'admin';
    if (!admin && (staff ? preSubmit : !preSubmit)) {
      reply.code(409);
      return { error: staff
        ? 'This order is still with the seller — artwork is theirs to change until it is submitted.'
        : 'This order is in production, so its artwork is settled. Ask us to change it.' };
    }

    /**
     * Matched the way the row was WRITTEN: line-first, with the sku slot reachable only for
     * rows that carry no line at all. Letting a sku match a line-keyed row would delete a
     * SIBLING's artwork on an order with two lines of the same sku — the exact bug the
     * line_id migration exists to prevent, in its most destructive form.
     */
    const r = await q(
      `delete from order_designs
        where order_id = $1
          and ( ($2::text is not null and line_id = $2)
             or (line_id is null and $3::text is not null and sku = $3) )
          and ($4::text is null or coalesce(side,'front') = $4)`,
      [req.params.id, lineId, sku, side]
    );
    const removed = r.rowCount || 0;
    if (removed) {
      audit(req, 'design.removed', {
        entityType: 'order', entityId: req.params.id,
        before: { line_id: lineId, sku, side: side || 'all sides', rows: removed },
      });
    }
    return { ok: true, removed };
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
  async function chargeDesign(req, orderId, lineId, sku, tier, fees, override) {
    /*
     * AN OVERRIDE IS THE PRICE, when there is one.
     *
     * The tier still says what KIND of work this was — that is a fact about the job and it
     * stays true — but the amount is a judgement, and a fee list cannot know that this
     * particular file took twenty minutes to clean up. Staff type a number; that number is
     * what is charged, not the list price for its class.
     *
     * Zero is a legitimate override (waive the fee) and must not fall through to the list
     * price, which is why this tests for null rather than for truthiness.
     */
    /*
     * THE CHECK FEE IS RETIRED (2026-08-24). A seller who brings their own machine file is
     * not billed for us opening it.
     *
     * Zero rather than a deleted branch, and BEFORE the override is applied — so a typed
     * figure cannot put the fee back by the side door. `supplied` survives as a TIER because
     * it is a true fact about the job (this line came with its own stitch file) and it is
     * what design_charged_at rows already recorded; only its price is gone.
     */
    const listed = tier === 'supplied'
      ? 0
      : tier === 'complex'
        ? Number(fees.design_fee_complex) || 0
        : Number(fees.design_fee_standard) || 0;
    const amount = tier === 'supplied'
      ? 0
      : (override != null && isFinite(Number(override))) ? Number(override) : listed;
    if (!(amount > 0)) return { charged: 0, reason: 'no-fee-set' };
    const key = lineId ? 'line_id' : 'sku';
    const row = await q(
      `select i.design_charged_at, o.seller_id, o.factory_order from order_items i
         join orders o on o.id = i.order_id
        where i.order_id=$1 and i.${key}=$2 limit 1`, [orderId, lineId || sku])
      .then((r) => r.rows[0]).catch(() => null);
    if (!row) return { charged: 0, reason: 'no-line' };
    if (row.design_charged_at) return { charged: 0, reason: 'already-charged' };
    if (!row.seller_id) return { charged: 0, reason: 'no-seller' };
    /**
     * THE SAME JOB IS PAID FOR ONCE — the charge obeys the rule the estimate shows.
     *
     * One file on five items is one file checked; one picture on five items is one
     * digitising job. The estimate groups by the design for exactly that reason, and if
     * this billed per line the seller would be quoted three fees and charged five. Every
     * line carrying this design is stamped below, so the second one through this function
     * stops at the already-charged guard above.
     */
    const lines = await designLines(orderId);
    const me = lines.find((l) => String(lineId ? l.line_id : l.sku) === String(lineId || sku));
    const sameDesign = me ? lines.filter((l) => designKeyOf(l, tier) === designKeyOf(me, tier)) : [];
    if (sameDesign.some((l) => l.design_charged_at)) return { charged: 0, reason: 'already-charged-same-design' };
    /**
     * A FACTORY-OWNED order charges nobody.
     *
     * Our own shop's orders carry a staff account as seller_id, so charging one would move
     * money from the factory wallet to the factory wallet. That nets to zero, which sounds
     * harmless and isn't: it books revenue that was never earned, so every margin figure
     * that reads design-work rows counts our own costs as income and the real number is
     * quietly wrong.
     *
     * The tier is still RECORDED. Whether a design was ordinary, intricate or supplied is a
     * fact about the work, and it stays true on our own orders — it just doesn't bill.
     */
    if (row.factory_order) return { charged: 0, reason: 'factory-order' };

    // The line's own name, for the ledger. A seller reading their statement sees "Design
    // work · Unisex Tee · #4099", not "design-work · FF-12jt… · G5000-COPY-WHT-S" — the
    // second is the same fact and unreadable, which is how a legitimate charge becomes a
    // support ticket.
    const line = await q(
      `select i.name, o.seq from order_items i join orders o on o.id = i.order_id
        where i.order_id=$1 and i.${key}=$2 limit 1`, [orderId, lineId || sku])
      .then((r) => r.rows[0]).catch(() => null);
    const orderLabel = line && line.seq ? `#${line.seq}` : orderId;
    const itemLabel = (line && line.name) || sku || lineId;

    const ref = `design-${orderId}-${lineId || sku}`;
    try {
      await moveFunds({
        from: row.seller_id, to: 'factory', amount,
        type: 'design-work', ref,
        note: `${tier === 'supplied' ? 'Design file check' : 'Design work'} · ${itemLabel} · ${orderLabel}`,
        by: req.user && req.user.sub,
      });
    } catch (e) {
      return { charged: 0, reason: 'wallet-failed', error: e.message };
    }

    /**
     * Say WHY, on the order, in the seller's own thread.
     *
     * A charge they can see but not account for is worse than a surprise — it reads as an
     * error, and the first thing they do is ask. The tier itself stays internal: "your
     * design was classified complex" invites an argument about the classification rather
     * than about the price, and the classification is our judgement to make.
     *
     * Posted automatically. A note somebody has to remember to write is a note that mostly
     * doesn't get written, and the charge lands either way.
     */
    const why = tier === 'supplied'
      ? `You sent your own machine file for ${itemLabel}. We open and check every one before it goes near a machine — wrong size, wrong format and wrong machine type are all common and all expensive to find at the press. That check is ${fmtMoney(amount)}, which is less than having us digitise it.`
      : tier === 'complex'
        ? `Digitising the artwork for ${itemLabel} came to ${fmtMoney(amount)} — this one needed more work than a standard design, which you approved before we started.`
        : `Digitising the artwork for ${itemLabel} came to ${fmtMoney(amount)}. That's our standard rate for turning a picture into a stitch file.`;
    await q(
      `insert into order_messages (order_id, sender_id, sender_role, body, meta)
       values ($1, null, 'assistant', $2, $3)`,
      [orderId, why, JSON.stringify({ by: 'Billing', design_fee: amount, order_ref: orderId })]
    ).catch(() => {});
    egBroadcast({ type: 'order-message' });
    // EVERY line this one payment covers is stamped, not just the one that triggered it —
    // otherwise the next line carrying the same file walks back in and bills it again.
    const stampIds = sameDesign.map((l) => l.line_id).filter(Boolean);
    const stampSkus = sameDesign.filter((l) => !l.line_id).map((l) => l.sku).filter(Boolean);
    if (stampIds.length || stampSkus.length) {
      await q(
        `update order_items set design_charged_at = now()
          where order_id=$1 and (line_id = any($2::text[]) or (line_id is null and sku = any($3::text[])))`,
        [orderId, stampIds, stampSkus]).catch(() => {});
    } else {
      await q(`update order_items set design_charged_at = now() where order_id=$1 and ${key}=$2`,
        [orderId, lineId || sku]).catch(() => {});
    }
    audit(req, 'design.charged', { entityType: 'order', entityId: orderId, after: { tier, amount, line_id: lineId, sku } });
    return { charged: amount, tier };
  }

  /**
   * Design/check fees per line, for the order Summary — so a fee is VISIBLE, never a surprise
   * on the statement. Tier comes from the stored design_tier once staff has classified the
   * line; before that it's INFERRED for a seller-facing estimate (own machine file → check
   * fee; image → we digitise it, standard). Complex is quoted, so its amount is left null =
   * "To Be Determined" until accepted, rather than hidden. Amounts mirror chargeDesign.
   */
  /**
   * Every line of an order with the design it carries — the file it was given, or the
   * artwork placed on it. One query, because both the estimate and the charge have to
   * answer "is this the same job as that one" the same way.
   *
   * LINE-FIRST, like every other per-line read. Matching on coalesce(sku,'') meant that on
   * an order whose lines have no sku yet — an import, or any marketplace line before a
   * variant is picked — ONE machine file matched EVERY line. A file with no line id is
   * genuinely order-wide and still counts for all of them, which is the second branch.
   */
  async function designLines(orderId) {
    return q(
      `select i.line_id, i.sku, i.name, i.print_type, i.design_tier, i.design_quote_status, i.design_charged_at,
              i.design_fee_override,
              (select coalesce(f.content_hash, f.design_id) from design_file_data f
                 where f.order_id = i.order_id
                   and (f.line_id = i.line_id
                        or (f.line_id is null and coalesce(f.sku,'') = coalesce(i.sku,'')))
                 order by (f.line_id is not null) desc, f.created_at desc limit 1) as machine_key,
              (select coalesce(d.art_hash, d.storage_key, left(d.data, 64)) from order_designs d
                 where d.order_id = i.order_id
                   and (d.line_id = i.line_id or (d.line_id is null and d.sku = i.sku))
                   and (d.data is not null or d.storage_key is not null)
                 order by (d.line_id is not null) desc limit 1) as image_key
         from order_items i where i.order_id = $1`,
      [orderId]).then((r) => r.rows).catch(() => []);
  }

  /**
   * What this line attracts, if anything.
   *
   * A CHECK FEE IS AN EMBROIDERY FEE — it pays for someone opening a stitch file and
   * judging whether it will run. So is digitising. A DTG or DTF line has neither: the
   * artwork IS the print file, and there is nothing to cut. Neither fee is inferred there,
   * however a file ended up attached to it.
   *
   * Only the INFERENCE is gated. Staff's own classification wins outright: if someone has
   * looked at a line and called it supplied, they had a reason, and this is not the place
   * to overrule it.
   */
  function tierOf(r) {
    if (r.design_tier) return r.design_tier;
    if (!/emb/i.test(String(r.print_type || ''))) return null;
    return r.machine_key ? 'supplied' : r.image_key ? 'standard' : null;
  }

  /** What makes two lines the SAME job: the same file, or the same artwork. A line with
   *  neither (a staff-set tier on an empty line) is only ever itself. */
  function designKeyOf(r, tier) {
    const own = `L:${r.line_id || r.sku || ''}`;
    if (tier === 'supplied') return r.machine_key || own;
    return r.image_key || r.machine_key || own;
  }

  async function computeDesignFees(orderId) {
    const fees = await readAll().catch(() => ({}));
    const CHECK = Number(fees.check_fee) || 0;
    const STD = Number(fees.design_fee_standard) || 0;
    const CPX = Number(fees.design_fee_complex) || 0;
    const rows = await designLines(orderId);
    /**
     * ONE FEE PER DESIGN, NOT PER LINE.
     *
     * Both fees pay for a piece of WORK done once. The check fee is a person opening a
     * stitch file and judging whether it will run; the standard fee is digitising a picture
     * into stitches. Put the same file on five items and it is checked once; put the same
     * picture on five items and it is digitised once. Billing per line charged five times
     * for one job — which is what the summary was doing, six identical check-fee rows for a
     * single uploaded file.
     *
     * So lines are GROUPED by the design they carry — the file's content hash, or the
     * artwork's — and each group is one fee. Five embroidered items carrying three files
     * and two pictures is three check fees and two standard fees, which is the number of
     * times somebody actually sits down to work.
     */
    const groups = new Map();
    for (const r of rows) {
      const tier = tierOf(r);
      if (!tier) continue;
      const key = `${tier}|${designKeyOf(r, tier)}`;
      const g = groups.get(key);
      if (g) { g.lines.push(r); if (r.design_charged_at) g.charged = true; continue; }
      groups.set(key, { tier, lines: [r], charged: !!r.design_charged_at, quote: r.design_quote_status });
    }
    const items = []; let total = 0;
    for (const g of groups.values()) {
      const first = g.lines[0];
      /*
       * RETIRED, BUT NOT ERASED. The check fee is no longer quoted or charged, so a supplied
       * line contributes nothing to this list — unless one was ALREADY taken, in which case
       * the row stays and still names its amount. wallet_ledger is append-only and a seller
       * who paid it is entitled to see what the payment was for; dropping the row would leave
       * money in their statement that the order could not explain.
       */
      if (g.tier === 'supplied' && !g.charged) continue;
      let label, amount;
      if (g.tier === 'supplied') { label = 'Check fee'; amount = CHECK; }
      else if (g.tier === 'complex') {
        label = 'Complex design fee';
        // Fixed only once accepted or charged; otherwise under review → To Be Determined.
        amount = (g.charged || g.quote === 'accepted') ? CPX : null;
      } else { label = 'Design fee'; amount = STD; }
      /*
       * AN OVERRIDE WINS THE NUMBER — because the charge obeys it, and an estimate that
       * disagrees with what will actually be billed is worse than no estimate.
       *
       * Any line in the group carrying one sets it (they are one job, so one price). It also
       * settles a COMPLEX row: a quoted fee is To Be Determined precisely because nobody has
       * named a figure yet, and typing one is naming it.
       *
       * `!= null` rather than truthy — a deliberate zero is a waived fee, not an absent one.
       */
      const ov = g.lines.map((l) => l.design_fee_override).find((v) => v != null && v !== '');
      const overridden = ov != null && isFinite(Number(ov));
      if (overridden) amount = Number(ov);
      const status = g.charged ? 'charged' : (amount == null ? 'tbd' : 'estimated');
      if (amount != null) total += amount;
      // The rest of the group is NAMED rather than silently folded in: "ab11 +2 items"
      // says one fee covers three lines, which is the fact a seller is checking for.
      const extra = g.lines.length - 1;
      const name = (first.name || first.sku || 'Item') + (extra > 0 ? ` +${extra} item${extra === 1 ? '' : 's'}` : '');
      items.push({
        line_id: first.line_id || null, sku: first.sku || null, name,
        tier: g.tier, label, amount, status,
        /** Staff typed this figure rather than taking the tier's list price — the row says
         *  so, so an unusual number is not mistaken for a pricing bug. */
        overridden,
        // Every line this one fee covers, so a caller can mark them all rather than
        // guessing which line the row stands for.
        lines: g.lines.map((l) => ({ line_id: l.line_id || null, sku: l.sku || null })),
      });
    }
    return { items, total };
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
    /*
     * AN OPTIONAL AMOUNT, and `null` is a real value here.
     *
     * Omitting `amount` leaves whatever override is stored alone — that is what a plain tier
     * change does, and it must not silently wipe a price somebody typed. Sending null CLEARS
     * the override and returns the line to the list price. Sending a number sets it.
     *
     * Bounded and finite: an unbounded number on a billing field is a typo away from a
     * five-figure charge, and NaN would sail through a `> 0` test as false and quietly bill
     * the list price instead of the one on screen.
     */
    const hasAmount = Object.prototype.hasOwnProperty.call(b, 'amount');
    let override;
    if (hasAmount) {
      if (b.amount === null || b.amount === '') override = null;
      else {
        const n = Number(b.amount);
        if (!isFinite(n) || n < 0 || n > 100000) { reply.code(400); return { error: 'amount must be a number between 0 and 100000, or null to clear it.' }; }
        override = n;
      }
    }
    // COMPLEX opens a quote and charges nothing. The other two are charged here, because
    // setting them IS the decision — there is no second party to ask.
    const quoted = tier === 'complex';
    // The quote is what the SELLER will be asked to accept, so an override has to move it
    // too — quoting the list price and then charging a different number is the one outcome
    // this must never produce.
    const quoteMake = quoted ? (override != null ? override : Number(fees.design_fee_complex) || 0) : null;
    const r = await q(
      `update order_items set design_tier=$3, design_tier_at=now(), design_tier_by=$4,
              design_quote_status = $5,
              design_quote_make = $6, design_quote_download = $7, design_quote_at = $8,
              design_fee_override = case when $9::boolean then $10::numeric else design_fee_override end
        where order_id=$1 and ${key}=$2`,
      [String(req.params.id), lineId || sku, tier, String((req.user && req.user.sub) || ''),
       quoted ? 'pending' : null,
       quoteMake,
       quoted ? Number(fees.emb_price_complex) || 0 : null,
       quoted ? new Date().toISOString() : null,
       hasAmount, override ?? null]);
    if (!r.rowCount) { reply.code(404); return { error: 'No such line on this order.' }; }
    audit(req, 'design.tier', { entityType: 'order', entityId: String(req.params.id), after: { tier, line_id: lineId, sku, ...(hasAmount ? { amount: override } : {}) } });

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
      const stored = hasAmount ? override : await q(
        `select design_fee_override from order_items where order_id=$1 and ${key}=$2 limit 1`,
        [String(req.params.id), lineId || sku]).then((x) => (x.rows[0] ? x.rows[0].design_fee_override : null)).catch(() => null);
      charged = await chargeDesign(req, String(req.params.id), lineId, sku, tier, fees, stored);
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
    const own = await q('select seller_id, factory_order from orders where id=$1', [orderId])
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

    const amount = own.factory_order ? 0 : (Number(line.design_quote_make) || 0);
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
  /**
   * Same-origin re-serve of one order design's bytes — what designUrlOf now points at.
   *
   * UNAUTHENTICATED BY DESIGN, identically to /api/design_cards/art/:hash: an <img> cannot
   * carry a Bearer header, and the path key is the artwork's SHA-256 content hash, which is
   * unguessable and reveals nothing about the order it belongs to. The alternative — a
   * signed storage URL — leaks the bucket and expires; the one before that pointed at a
   * hostname that does not resolve.
   */
  app.get('/api/order_designs/art/:hash', async (req, reply) => {
    const hash = String(req.params.hash || '').replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    if (!/^[0-9a-f]{16,64}$/.test(hash)) { reply.code(404); return { error: 'not found' }; }
    const row = (await q('select storage_key, data from order_designs where art_hash=$1 limit 1', [hash])
      .catch(() => ({ rows: [] }))).rows[0];
    if (!row) { reply.code(404); return { error: 'not found' }; }
    reply.header('Cache-Control', 'public, max-age=86400');
    const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf' };
    // Rows that predate storage keep their bytes inline; serve those decoded rather than 404.
    if (!row.storage_key && row.data) {
      const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(String(row.data));
      if (m) {
        reply.header('Content-Type', m[1] || 'application/octet-stream');
        return reply.send(Buffer.from(m[3], m[2] ? 'base64' : 'utf8'));
      }
    }
    if (!row.storage_key) { reply.code(404); return { error: 'not found' }; }
    const obj = await getObject(row.storage_key).catch(() => null);
    if (!obj || !obj.body) { reply.code(404); return { error: 'not found' }; }
    const ext = (String(row.storage_key).match(/\.([a-z0-9]+)$/i) || [null, ''])[1].toLowerCase();
    reply.header('Content-Type', obj.contentType || MIME[ext] || 'application/octet-stream');
    return reply.send(obj.body);
  });

  /**
   * EVERY ORDER'S ARTWORK ON ONE PAGE, IN ONE REQUEST.
   *
   * The factory board draws a photo on every collapsed row, so it was fetching
   * /api/orders/:id/designs once PER ROW — fifty round trips to paint one page. On a link
   * with 260ms of latency that is thirteen seconds of waiting before anything appears, and
   * none of it is the database: each query answers in single-digit milliseconds.
   *
   * PERMISSION IS STILL PER ORDER. canSeeOrder runs for every id and unreadable ones are
   * dropped from the result rather than refused — a batch must never widen what a caller
   * can see, and one forbidden order in a page must not fail the other forty-nine. That is
   * N cheap local checks in exchange for N-1 network round trips, which is the whole trade.
   *
   * Capped at 200 ids so a hand-written query string cannot ask for the table.
   *
   * Registered BEFORE /api/orders/:id/designs deliberately. Fastify prefers a static
   * segment over a parameterised one, so 'designs' could not be read as an :id either way —
   * but reading them in this order is how the next person sees that they do not collide.
   */
  app.get('/api/orders/designs', { preHandler: requireAuth }, async (req) => {
    const raw = String(req.query?.ids || '').trim();
    if (!raw) return {};
    const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 200);
    if (!ids.length) return {};
    const allowed = [];
    for (const id of ids) { if (await canSeeOrder(req.user, id)) allowed.push(id); }
    if (!allowed.length) return {};
    const r = await q(
      `select order_id, sku, line_id, kind, coalesce(side,'front') as side, data, storage_key,
              art_hash, name, pos, template_id
         from order_designs where order_id = any($1::text[])`,
      [allowed]
    );
    // Every allowed id gets a key, empty or not: the client can then tell "no artwork" from
    // "not fetched" without a second source of truth.
    const out = {};
    for (const id of allowed) out[id] = [];
    for (const row of r.rows) {
      const url = designUrlOf(row);
      const designId = row.art_hash ? `D-${String(row.art_hash).slice(0, 8).toUpperCase()}` : null;
      (out[row.order_id] ||= []).push({
        sku: row.sku, line_id: row.line_id, kind: row.kind, side: row.side, name: row.name,
        pos: row.pos, data: url || row.data, url, design_id: designId,
        template_id: row.template_id || null,
      });
    }
    return out;
  });
  app.get('/api/orders/:id/designs', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    // art_hash IS SELECTED, and has to be: designUrlOf prefers the same-origin re-serve
    // (/api/order_designs/art/<hash>) and falls back to a bucket link only for rows that
    // predate the column. Omitting it here made every storage-backed design come back as a
    // SIGNED CROSS-ORIGIN link instead — which expires, taints the canvas so the thread
    // matcher reports "couldn't open this image to read its colours", and is the string the
    // client hands back on the next save.
    const r = await q(`select sku, line_id, kind, coalesce(side,'front') as side, data, storage_key, art_hash, name, pos, template_id from order_designs where order_id=$1`, [req.params.id]);
    // Minted per read, not stored: a signed URL expires, so a persisted one would go
    // stale. Returned through `data` because that's what every client already renders
    // (an <img src> takes a URL or a data-URL either way).
    return r.rows.map((row) => {
      const url = designUrlOf(row);
      /*
       * A SHORT ID THE FLOOR CAN READ OUT AND SEARCH BY.
       *
       * art_hash is the artwork's content hash, so the SAME picture carries the same id on
       * every order it appears on — which is the question the factory actually asks ("have we
       * cut this one before?"). Truncated to eight characters because it is read aloud and
       * typed into a search box; the full hash is a wall of hex nobody transcribes.
       *
       * Prefixed `D-` so it can never be mistaken for an order number or a SKU when it turns
       * up in a search field alongside both.
       */
      const designId = row.art_hash ? `D-${String(row.art_hash).slice(0, 8).toUpperCase()}` : null;
      // line_id is what a caller should key on; sku stays for rows that predate it.
      /* The template this artwork came off, if it came off one. Not a secret and not
         seller-specific — it names one of OUR placement recipes, so it travels to whoever
         can already see the order. Null for artwork somebody simply dropped, which is most
         of it. */
      return { sku: row.sku, line_id: row.line_id, kind: row.kind, side: row.side, name: row.name, pos: row.pos, data: url || row.data, url, design_id: designId, template_id: row.template_id || null };
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
        costRef: `aibrief-${crypto.randomBytes(8).toString('hex')}`,
        costNote: 'Order brief',
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
    // desk-<uid> is the private personal Workbench — a synthetic channel like the others,
    // never a real order, so it passes straight through (access is gated in canSeeThread).
    // gen-<accountId> is a seller ACCOUNT's AI generations channel — synthetic like the
    // others, and scoped to the account rather than the person so a team shares one, exactly
    // as they already share one wallet.
    if (s === 'staff-general' || s === 'announce' || s.indexOf('support-') === 0
        || s.indexOf('desk-') === 0 || s.indexOf('gen-') === 0) {
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
  // Both of these now live in auth.js — this file kept the original private copies, and
  // wallet.js kept a second one, which is exactly the drift the canMoveMoney comment
  // warns about. These thin wrappers keep every existing call site in this file unchanged
  // while there is only ONE definition of the rule.
  const resolveSeller = (user) => _resolveSeller(user, q);
  const _canSurface = canSurface;

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
      // EGFUL can cover billing and account matters the owner never delegated. The
      // member gets their own channel instead. Same rule as before this refactor.
      return id === ('support-' + user.sub);
    }
    // Private personal Workbench — ONLY its owner may read or write it, ever. Not staff,
    // not a team owner, not the support inbox. A desk that leaked would be the same class
    // of failure as an internal brief reaching a seller, so this is a hard identity match
    // on the authenticated user and nothing else.
    if (id.indexOf('desk-') === 0) return id === ('desk-' + user.sub);
    /*
     * AI GENERATIONS — the seller account's own channel.
     *
     * Per ACCOUNT, not per person: resolveSeller, so a team member opens the same channel the
     * owner does. That is the opposite choice from `support-` directly above, and deliberately
     * so — a support conversation can cover billing the owner never delegated, whereas the
     * images a team generates are the account's work and are paid for from the account's wallet.
     *
     * Staff are excluded. These exist precisely so generated images stop landing in the
     * support thread that staff read; letting staff read them here would undo that.
     */
    if (id.indexOf('gen-') === 0) {
      if (isStaff(user)) return false;
      const sel = await resolveSeller(user);
      return !!sel?.id && id === ('gen-' + sel.id);
    }
    return false;
  }

  async function canSeeOrder(user, orderId) {
    /*
     * GENERATIONS ARE CHECKED BEFORE THE STAFF SHORTCUT, and that order is the rule.
     *
     * `isStaff(user) → true` below is a blanket pass, so a `gen-` id tested after it would be
     * readable by every staff account — which is exactly the leak these channels exist to
     * close. Account-scoped, sellers only, no staff exception.
     */
    if (String(orderId).indexOf('gen-') === 0) {
      if (isStaff(user)) return false;
      const s = await resolveSeller(user);
      return !!s?.id && orderId === ('gen-' + s.id);
    }
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

  /* ── Channel read stamps ───────────────────────────────────────────────────
   * The rail badges the PINNED channels (EG Channel, My Assistant, Announcements)
   * the same way it badges a seller thread, because a row that carries a number is
   * the only thing that tells you a room has something new in it without opening it.
   *
   * But "unanswered" is the wrong count here. That number means "a seller is waiting
   * on us", which is a real state in a support thread and no state at all in a room
   * where staff talk to each other or an admin broadcasts. So these count UNREAD:
   * messages that landed since this person last had the channel open.
   *
   * Per USER, not per account — two staffers read the factory room independently.
   * ────────────────────────────────────────────────────────────────────────── */
  q(`create table if not exists channel_reads (
       user_id    uuid references users(id) on delete cascade,
       channel_id text not null,
       read_at    timestamptz not null default now(),
       primary key (user_id, channel_id)
     )`).catch(() => {});

  /**
   * Last message + unread count for a set of channels, in one round trip.
   *
   * Takes ids rather than deriving the list: which rooms a person has pinned is a
   * front-end decision (a seller has no factory room, a designer has no announcements),
   * and every id is still run through canSeeThread — the query only ever sees channels
   * this user may read, so passing someone else's id gets you nothing back rather than
   * an error that confirms it exists.
   */
  app.get('/api/support/channels', { preHandler: requireAuth }, async (req) => {
    const ids = String(req.query?.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
    if (!ids.length) return [];
    const allowed = [];
    for (const id of ids) {
      const { channel, orderRef } = await resolveChannel(id);
      // An order slice is a VIEW of a channel, not a room of its own — it has no rail row.
      if (orderRef || allowed.includes(channel)) continue;
      if (await canSeeThread(req.user, channel)) allowed.push(channel);
    }
    if (!allowed.length) return [];
    const staff = isStaff(req.user);
    const r = await q(
      `select m.order_id,
              max(m.created_at) as last_at,
              -- An attachment-only message has an empty body, and a rail row that goes
              -- blank when someone sends a photo reads as a broken channel.
              (select coalesce(nullif(x.body, ''), case when x.attachment is not null then 'Attachment' else '' end)
                 from order_messages x
                where x.order_id = m.order_id
                  and ($2::boolean or not coalesce((x.meta->>'internal')::boolean, false))
                order by x.created_at desc, x.id desc limit 1) as last_body,
              -- Mine are never unread. The assistant's are: sender_id is null on an AI
              -- reply, so it can't be mistaken for something I wrote.
              count(*) filter (
                where m.created_at > coalesce(cr.read_at, '-infinity'::timestamptz)
                  and m.sender_id is distinct from $3::uuid
              )::int as unread
         from order_messages m
         left join channel_reads cr on cr.user_id = $3::uuid and cr.channel_id = m.order_id
        where m.order_id = any($1::text[])
          and ($2::boolean or not coalesce((m.meta->>'internal')::boolean, false))
        group by m.order_id, cr.read_at`,
      [allowed, staff, req.user.sub]);
    const by = new Map(r.rows.map((x) => [x.order_id, x]));
    return allowed.map((id) => {
      const x = by.get(id);
      return {
        id,
        last: (x && x.last_body) || '',
        last_at: x && x.last_at ? new Date(x.last_at).getTime() : 0,
        unread: (x && x.unread) || 0,
      };
    });
  });

  // Staff-only: list every seller support thread (one row per seller) with its last message, so the
  // staff chat can show "EGFUL Support" conversations that sellers started. Sellers never hit this.
  app.get('/api/support/threads', { preHandler: requireAuth }, async (req, reply) => {
    // Designers excluded: they don't answer sellers, so seller conversations aren't theirs
    // to read. See canSeeThread.
    if (!isStaff(req.user) || req.user.role === 'designer') { reply.code(403); return { error: 'forbidden' }; }
    const r = await q(`
      select m.order_id,
             max(m.created_at) as last_at,
             count(*)::int as n,
             (select body from order_messages x where x.order_id = m.order_id order by created_at desc, id desc limit 1) as last_body,
             -- A WEBSITE enquiry has no user row — its id is 'support-web-ps_…', so the
             -- users lookup finds nothing and the rail fell back to showing the raw id.
             -- Fall through to the name/email the visitor gave in the bubble.
             coalesce(
               (select coalesce(nullif(u.name,''), u.email) from users u where u.id::text = replace(m.order_id, 'support-', '')),
               (select coalesce(nullif(ps.name,''), ps.email) from public_support ps
                 where 'support-web-' || ps.id = m.order_id)
             ) as seller_name,
             -- THE FACE THAT GOES WITH THE NAME. The rail drew the same parcel glyph on every
             -- row, so eight conversations looked like eight copies of one thing and finding
             -- the person you were mid-sentence with meant reading names. The account already
             -- carries an avatar (Settings › Profile) and every other surface shows it.
             -- Null for a website visitor: no user row, so the rail falls back to their
             -- initial rather than inventing a face for someone who has no account.
             (select u.avatar_emoji from users u where u.id::text = replace(m.order_id, 'support-', '')) as avatar_emoji,
             (select u.avatar_color from users u where u.id::text = replace(m.order_id, 'support-', '')) as avatar_color,
             -- Open escalation = the seller asked for a human and no HUMAN has replied since.
             -- That's what sorts a thread to the top of the inbox. The AI assistant and its
             -- auto-acknowledgments (both role 'assistant') deliberately do NOT clear it —
             -- only a real teammate does — otherwise a bot reply would bury the request.
             (select count(*) from order_messages e
               where e.order_id = m.order_id
                 and coalesce((e.meta->>'escalated')::boolean, false)
                 and e.created_at > coalesce((select max(s.created_at) from order_messages s
                                               where s.order_id = m.order_id
                                                 and s.sender_role not in ('seller', 'assistant')), '-infinity'::timestamptz)
             )::int as open_escalations,
             /**
              * WHAT IS STILL WAITING ON US — the number the rail badges.
              *
              * It badged the TOTAL, so a conversation someone had answered an hour ago still
              * showed "36" and the rail gave no way to tell a finished thread from one with
              * a question sitting in it. A count that never goes down is decoration.
              *
              * So: incoming messages since the last time a HUMAN ON OUR SIDE replied.
              *
              * "Our side" is the ROLE, not the presence of an author. A signed-in seller
              * writes with their own sender_id, so an author-based test is true of both
              * halves of a seller thread — measured against the live rail it reported every
              * conversation as answered, including ones with an open request for a human
              * sitting in them. The escalation subquery above already had this right:
              * anything not 'seller' and not 'assistant' is us.
              *
              * Answer it and the badge goes to zero on the next load; say nothing and it
              * stays.
              */
             (select count(*) from order_messages a
               where a.order_id = m.order_id
                 and a.sender_role = 'seller'
                 and a.created_at > coalesce((select max(h.created_at) from order_messages h
                                               where h.order_id = m.order_id
                                                 and h.sender_role not in ('seller', 'assistant')), '-infinity'::timestamptz)
             )::int as unanswered
        from order_messages m
       where m.order_id like 'support-%'
       group by m.order_id
       order by last_at desc`);
    return r.rows.map((x) => ({
      order_id: x.order_id,
      seller_id: String(x.order_id).replace('support-', ''),
      seller_name: x.seller_name || null,
      avatar_emoji: x.avatar_emoji || null,
      avatar_color: x.avatar_color || null,
      last: x.last_body || '',
      last_at: x.last_at ? new Date(x.last_at).getTime() : 0,
      n: x.n,
      /** Incoming since our last human reply — what the rail badges. */
      unanswered: x.unanswered,
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
    // The private Workbench is a personal AI + notes space, not order-linked: don't run
    // @order resolution there (with a null seller it would match ANY order), and a "note"
    // is just a message flagged meta.note so the client can pin it and the AI can read it.
    const isDesk = channel.indexOf('desk-') === 0;
    const ref = isDesk ? null : (orderRef || (b.orderRef ? String(b.orderRef) : null)
      || (await resolveMention(b.text, channelSeller)));
    const meta = { by: b.by || null, system: !!b.system, internal: !!b.internal, ts: b.ts || null, escalated, note: !!b.note };
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
    /*
     * Whoever answers should see the internal picture before they reply. Fire-and-forget:
     * the message is already saved, the brief catches up a moment later.
     *
     * ONLY WHEN A SELLER WROTE IT. The brief is written FOR staff, so a staff message
     * triggering one is an AI call that briefs the person who just spoke. That was every
     * internal note and every attachment — the package photo the phone posts is a staff
     * message about an order, so each one bought a briefing nobody asked for.
     */
    if (ref && channel !== 'announce' && !isStaff(req.user)) postOrderBriefing(channel, ref);

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
          type: 'support-message', title: `EGFUL replied${about}`,
          body, href: ref ? `/orders/${ref}` : '/chat', entityId: ref || channel,
        });
        // Email the seller too, so a human's reply reaches them off-app — the "a teammate
        // will reply" promise landing in the inbox, which matters most for the after-hours
        // seller who escalated and left. Best-effort (never blocks the post), and only on
        // the FIRST reply of a staff burst — if the previous message was already from a
        // teammate, they're mid-conversation and don't need another email per line.
        if (mailConfigured() && String(b.text || '').trim()) {
          const sellerId = channel.slice(8);
          (async () => {
            const prev = await q(
              `select sender_role from order_messages where order_id=$1 order by created_at desc, id desc limit 1 offset 1`, [channel]);
            const prevRole = prev.rows[0] && prev.rows[0].sender_role;
            if (prevRole && prevRole !== 'seller' && prevRole !== 'assistant') return; // mid-burst
            const u = await q('select email, name from users where id=$1', [sellerId]);
            const to = u.rows[0] && u.rows[0].email;
            if (!to) return;
            const mail = supportReplyEmail(u.rows[0].name, String(b.text).slice(0, 200));
            await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text });
          })().catch(() => { /* email is a nicety; the in-app notification already fired */ });
        }
      }
    }

    // @-mention of a TEAMMATE (any channel) → notify them, so pinging a person works even
    // when the message isn't about an order. Match the @token against username, email-prefix
    // or first name of a staff user; never the sender themselves.
    try {
      const toks = [];
      const re = /(?:^|\s)@([a-z0-9][a-z0-9_.-]{1,63})/gi;
      let mm;
      while ((mm = re.exec(String(b.text || ''))) && toks.length < 10) toks.push(mm[1].toLowerCase());
      if (toks.length) {
        const u = await q(
          `select id from users
            where role <> 'seller' and active is not false
              and (lower(username) = any($1)
                   or lower(split_part(email,'@',1)) = any($1)
                   or lower(split_part(name,' ',1)) = any($1))
            limit 10`, [toks]);
        const ids = u.rows.map((r) => String(r.id)).filter((id) => id !== String(req.user.sub));
        if (ids.length) {
          notify({
            userIds: ids, type: 'mention',
            title: `${b.by || 'Someone'} mentioned you`,
            body: String(b.text || '').slice(0, 140), href: '/chat', entityId: channel,
          });
        }
      }
    } catch { /* a mention that can't resolve is just not a mention */ }

    return { ok: true };
  });

  // Orders to suggest when "@"-tagging in a support thread. Scoped to the THREAD's seller —
  // so it works whether the seller is on their own thread OR a staffer is on that seller's
  // inbox thread (getOrders() only ever returns the CALLER's own orders, which is why staff
  // got no suggestions). Gated by the same visibility guard as reading the thread.
  app.get('/api/support/order-mentions', { preHandler: requireAuth }, async (req, reply) => {
    const thread = String((req.query && req.query.thread) || '');
    // Optional search: `@14` searches by order NUMBER (seq) or id, so an OLD order past the
    // recent window still surfaces. No q → the recent list for the initial dropdown.
    const rawQ = String((req.query && req.query.q) || '').trim().slice(0, 40);
    const like = rawQ ? `%${rawQ.replace(/[%_\\]/g, (c) => '\\' + c)}%` : null;
    const cols = 'id, seq, customer, store, source, status, factory_status';
    // A SELLER support thread returns that seller's orders — a staffer answering the seller
    // sees the seller's, the seller sees their own. A staffer's OWN "My EG" has no seller
    // orders, so it falls through to the staff-wide list below.
    if (thread.indexOf('support-') === 0) {
      if (!(await canSeeThread(req.user, thread))) { reply.code(403); return { error: 'forbidden' }; }
      const sellerId = thread.slice('support-'.length);
      if (!(isStaff(req.user) && sellerId === req.user.sub)) {
        const filt = like ? ` and (cast(seq as text) ilike $2 or id ilike $2)` : '';
        const r = await q(
          `select ${cols} from orders where seller_id = $1${filt} order by created_at desc limit ${like ? 20 : 100}`,
          like ? [sellerId, like] : [sellerId]);
        return { orders: r.rows };
      }
    }
    // Staff channels (the Factory channel) + a staffer's own thread: staff may tag ANY
    // order. A seller can only ever reach their own support thread (handled above), so this
    // whole-board list is never exposed to a seller — the "Mention an order with @" the
    // Factory channel promises now actually works.
    if (isStaff(req.user)) {
      const filt = like ? ` where (cast(seq as text) ilike $1 or id ilike $1)` : '';
      const r = await q(
        `select ${cols} from orders${filt} order by created_at desc limit ${like ? 20 : 100}`,
        like ? [like] : []);
      return { orders: r.rows };
    }
    return { orders: [] };
  });

  // Chat attachment upload. The client downsizes images first (canvas), so this just stores
  // the bytes PRIVATE and hands back a same-origin proxy URL — loads in an <img> without a
  // public bucket, same pattern as the site assets. Any signed-in user; the file is only
  // reachable via the unguessable key it's posted into a thread with.
  const attachBase = () => (process.env.PUBLIC_API_ORIGIN || 'https://egful.store').replace(/\/+$/, '');
  const ATT_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'application/pdf': 'pdf' };
  app.post('/api/support/attachment', { preHandler: requireAuth }, async (req, reply) => {
    if (!storageEnabled()) { reply.code(503); return { error: 'File storage is not configured on the server.' }; }
    const b = req.body || {};
    if (!b.dataUrl || typeof b.dataUrl !== 'string') { reply.code(400); return { error: 'dataUrl required' }; }
    const { mime, buffer } = fromDataUrl(b.dataUrl);
    // Generous ceiling — images arrive already downsized; this catches an oversized PDF.
    if (buffer.length > 12 * 1024 * 1024) { reply.code(413); return { error: 'File is too large (max 12MB).' }; }
    const ext = ATT_EXT[mime] || 'bin';
    const name = `att-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    try {
      await putObject(`chat/${name}`, buffer, mime, 'private');
      return { url: `${attachBase()}/api/support/asset/${name}`, name: String(b.name || '').slice(0, 120), mime, size: buffer.length };
    } catch (e) {
      reply.code(502); return { error: 'Upload failed: ' + (e && e.message ? e.message : 'storage error') };
    }
  });

  // Serve a chat attachment through our origin (private object, signed GET). Hard-scoped to
  // the chat/ prefix via a bare-filename check, so it can't read any other object.
  app.get('/api/support/asset/:name', async (req, reply) => {
    const name = String(req.params.name || '');
    if (!/^[A-Za-z0-9._-]+$/.test(name)) { reply.code(400); return { error: 'bad name' }; }
    if (!storageEnabled()) { reply.code(503); return { error: 'storage not configured' }; }
    try {
      const obj = await getObject(`chat/${name}`);
      if (!obj) { reply.code(404); return { error: 'not found' }; }
      reply.header('Content-Type', obj.contentType || 'application/octet-stream');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(obj.body);
    } catch { reply.code(502); return { error: 'unavailable' }; }
  });

  // People to suggest when "@"-mentioning a teammate — not everything is about an order.
  // Staff only (you mention a colleague to pull them in); the mention notifies them (below).
  app.get('/api/support/mention-people', { preHandler: requireAuth }, async () => {
    const r = await q(
      `select id, coalesce(nullif(name,''), split_part(email,'@',1)) as name, username, role
         from users where role <> 'seller' and active is not false
         order by name limit 100`);
    return { people: r.rows };
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
      `select id, sender_id, sender_role, body, attachment, meta, client_id, created_at
         from order_messages where order_id=$1
           and ($2::text is null or meta->>'order_ref' = $2)
           and ($3::boolean or not coalesce((meta->>'internal')::boolean, false))
         order by created_at asc, id asc`, [channel, orderRef, isStaff(req.user)]);
    /*
     * READING THE CHANNEL IS WHAT MARKS IT READ — stamped here, on the only read path,
     * rather than in a "mark read" call the client has to remember to make. A badge that
     * depends on the front-end calling a second endpoint is a badge that gets stuck the
     * first time someone adds a new way to open a thread.
     *
     * Only when the WHOLE channel was asked for: an order slice shows a filtered handful
     * of messages, so treating it as having read the room would clear a count for
     * conversations that were never on screen.
     *
     * Fire-and-forget. This is a read route and a failed stamp must never fail the fetch.
     */
    if (!orderRef && req.user?.sub) {
      q(`insert into channel_reads (user_id, channel_id, read_at) values ($1,$2, now())
           on conflict (user_id, channel_id) do update set read_at = now()`,
        [req.user.sub, channel]).catch(() => {});
    }
    // Reconstruct the client entry shape so getOrderChat round-trips unchanged.
    return r.rows.map((m) => {
      const meta = m.meta || {};
      /**
       * WHICH SIDE THE BUBBLE GOES ON — answered by IDENTITY, from the column that already
       * records it.
       *
       * The client had to guess. It fell back to `by === myName`, a display-name string
       * comparison, because this route never sent the flag it was written to prefer. Any
       * drift between the name stored on the account and the name attached when the message
       * was posted — a rename, a message sent from the phone, a session whose user has no
       * name and reads "You" — makes every comparison false and pushes the ENTIRE thread
       * to the left, sender and recipient alike, which is not a state a chat can be in.
       *
       * `sender_id` has been on the row since schema.sql and is written by all three insert
       * paths; it simply was not selected. So this is right retroactively, for messages
       * already in the table, and it cannot be fooled by two people sharing a first name.
       *
       * The assistant has no sender_id, so it is never "mine" — which is what the seller
       * and the factory both need, since an AI reply is not either of them.
       */
      const e = { id: m.client_id || m.id, by: meta.by || (m.sender_role || 'Unknown'),
        role: m.sender_role || 'seller', text: m.body || '',
        me: !!m.sender_id && String(m.sender_id) === String((req.user && req.user.sub) || ''),
        ts: meta.ts || (m.created_at ? new Date(m.created_at).getTime() : 0), system: !!meta.system };
      if (m.attachment) e.attachment = m.attachment;
      if (meta.internal) e.internal = true;
      // A pinned note in the private Workbench — rendered as a saved card, not a chat bubble.
      if (meta.note) e.note = true;
      // Which order this message is about, now that orders don't own channels.
      if (meta.order_ref) e.orderRef = String(meta.order_ref);
      return e;
    });
  });
}
