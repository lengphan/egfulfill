// Per-order refunds — give a seller back some or all of what an order charged them.
// -----------------------------------------------------------------------------
// The existing money loop has exactly two moments: charge on submit, refund in full on
// cancel. Everything in between had no answer. A job that shipped late, an express
// upgrade that didn't get used, a garment that came out wrong — all of those are money
// that needs to go back WITHOUT cancelling an order that was really produced.
//
// So: an itemised view of everything an order has charged, and a refund that can be
// issued at any time, for any amount up to what's left.
//
// Admin and warehouse only. Operators and designers are staff, but moving money back to
// a seller is not a production decision — same line design_files.js draws for pricing.
import { q, withLock } from '../db.js';
import { moveFunds, balanceOf } from './wallet.js';
import { audit } from '../audit.js';
import { canMoveMoney, canSeeMoney, resolveSeller, canSurface } from '../auth.js';
import { notify } from './notifications.js';
import { egBroadcast } from '../events.js';
import { notifyChannelStillOpen } from './orders.js';

// Which part of an order a refund row paid back. Added idempotently at load, like the
// other late columns in this codebase — schema.sql only runs on a first DB init, so an
// existing deployment would never see it otherwise.
q('alter table wallet_ledger add column if not exists refund_part text').catch(() => {});

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
// One shared predicate in auth.js — this was a private copy of the same rule wallet.js
// and design_files.js each also kept, and the three had already drifted (wallet.js was
// gating on the much broader isStaff).
const canRefund = canMoveMoney;

/**
 * Every charge type that bills a SELLER for an order, with the ref shape it uses.
 *
 * Refs are inconsistent across the app for historical reasons (production keys on the
 * bare order id, expedite prefixes it, file sales suffix a sku). Rather than retro-fit
 * one scheme onto live ledger rows — which would mean rewriting money records — the
 * shapes are declared here and matched on read.
 */
const CHARGE_KINDS = [
  { type: 'order-charge', label: 'Production',         ref: (id) => id },
  { type: 'expedite',     label: 'Expedited Shipping', ref: (id) => `expedite-${id}` },
  { type: 'express-ship', label: 'Express shipping',   ref: (id) => `express-${id}` },
  { type: 'design-fee',   label: 'Design service',     ref: (id) => `design-${id}` },
];
// Design-file sales key on `orderId|sku`, so they're matched by prefix rather than
// by an exact ref — one order can sell several files.
const FILE_TYPES = ['emb-file', 'design-file'];

const REFUND_TYPE = 'order-refund';

/**
 * A LATER PRICE ADJUSTMENT — money charged to the seller AFTER the order was billed.
 *
 * The loop only ever ran one way: charge on submit, and give some back. But a quote can be
 * wrong in the other direction too — a heavier parcel than the estimate, a colour added at
 * the machine, a re-print of one line — and with no way to record that, the money either
 * never got taken or it got taken as some unrelated ledger entry with no order against it.
 *
 * Several per order, so it is matched by PREFIX like the file sales rather than by an exact
 * ref: `fee-<orderId>-<stamp>`. Each row keeps its own note, which is the reason the seller
 * reads on their statement, and which is REQUIRED — an unexplained debit is the one thing a
 * seller will always ask about, and "ask the person who did it" is not an answer a ledger
 * should give.
 *
 * It is an ordinary charge in every other respect: it lands in a part, it counts toward what
 * the order has charged, and it is REFUNDABLE. A fee added by mistake has to be reversible
 * by the same panel that added it, or the only fix is a hand-written ledger row.
 */
const FEE_TYPE = 'order-fee';

/**
 * The refundable PARTS of an order, in the order a refund should consume them.
 *
 * A marketplace refund isn't one number — it's "give back the shipping", or "refund the
 * garment but keep the expedite fee we already paid the partner". So every charge is
 * placed in a named part, each with its own cap, and a refund names the parts it touches.
 *
 * Production is one ledger row covering both product and shipping, so it's split back
 * apart from the frozen per-item costs (see productionSplit). Those two are far and away
 * the most common things to refund separately, and a single "Production $47.50" line
 * would force whoever's refunding to do the arithmetic by hand.
 *
 * Order matters: an unallocated amount is consumed top-down, so a partial refund with no
 * parts named takes product cost first and the fees we've already paid out last.
 */
// 'fee' is LAST on purpose. An unallocated partial refund is consumed top-down, and what
// should go back first is what the seller paid for the goods — not an adjustment that was
// raised for a cost we have already met.
export const PART_ORDER = ['product', 'shipping', 'expedite', 'express', 'design', 'files', 'fee'];
const PART_LABELS = {
  /**
   * BASE COST, because "product cost" already means something else here.
   *
   * The product editor has used the pair for a long time: PRODUCT COST is what the blank
   * costs US from the supplier (COGS), BASE COST is what the seller is charged for it. The
   * order summary was labelling the seller's number with the supplier's word, so an order
   * reading "Product cost $37.00" for two beanies we buy at $1.50 each looked either like a
   * catastrophic margin or a bug, depending on who was reading. Same money, correct name.
   */
  product: 'Base cost',
  shipping: 'Shipping',
  // NB these two read alike but are different money. `expedite` is the DISPATCH-partner
  // fee — charged per label when one is pushed to the partner's pre-scan queue — while
  // `express` is a faster carrier service on the parcel itself. The labels were
  // 'Expedited dispatch' / 'Express shipping'; renamed on request. If anyone later
  // mistakes one for the other, that pair of names is why.
  expedite: 'Expedited Shipping',
  express: 'Express shipping',
  design: 'Design service',
  files: 'Design files',
  // Deliberately not 'Fee'. Every one of these carries its own reason on the line, and the
  // part is the sum of them — "Price adjustment" is what the sum is, where "Fee" invites the
  // reading that there is one of them.
  fee: 'Price adjustment',
};

/**
 * Split the single production charge back into product vs shipping.
 *
 * Uses the FROZEN per-item costs (unit_cost/ship_fee are written at charge time), not a
 * fresh quote — a catalog edit since then would otherwise re-split an old charge and the
 * two halves would stop summing to what was actually taken.
 *
 * Shipping is derived as the remainder rather than summed independently, so the parts
 * always add up to the charge exactly, whatever drift exists in the item rows.
 */
async function productionSplit(orderId, charged) {
  if (charged <= 0) return { product: 0, shipping: 0 };
  const items = await q('select qty, unit_cost from order_items where order_id=$1', [String(orderId)])
    .catch(() => ({ rows: [] }));
  const product = money(items.rows.reduce(
    (s, it) => s + (Number(it.unit_cost) || 0) * Math.max(1, parseInt(it.qty, 10) || 1), 0));
  // Clamp: if the frozen costs somehow exceed what was charged, product takes the whole
  // charge rather than producing a negative shipping part.
  const p = Math.min(product, charged);
  return { product: money(p), shipping: money(charged - p) };
}

/**
 * What this order has charged, what's already gone back, and what may still be refunded —
 * broken down by part.
 *
 * Charges are read from the FACTORY's credit leg and refunds from its debit leg, so the
 * figures come from the same rows the balance is computed from. A cached total on the
 * order row could disagree with the ledger; this cannot.
 */
export async function orderCharges(orderId) {
  const id = String(orderId);
  const refs = CHARGE_KINDS.map((k) => k.ref(id));
  const inTypes = CHARGE_KINDS.map((k) => k.type + '-in');

  const [flat, files, fees, refunds] = await Promise.all([
    q(`select type, ref, delta, note, created_at from wallet_ledger
        where account='factory' and type = any($1) and ref = any($2) order by created_at`,
      [inTypes, refs]),
    q(`select type, ref, delta, note, created_at from wallet_ledger
        where type = any($1) and ref like $2 order by created_at`,
      [FILE_TYPES, id + '|%']),
    // Prefix, not an exact ref: an order can carry several adjustments, each its own row
    // with its own reason. Read off the FACTORY's credit leg like every other charge, so
    // these figures come from the same rows the balance is computed from.
    q(`select type, ref, delta, note, created_at, created_by from wallet_ledger
        where account='factory' and type=$1 and ref like $2 order by created_at`,
      [FEE_TYPE + '-in', `fee-${id}-%`]),
    q(`select ref, delta, note, refund_part, created_at, created_by from wallet_ledger
        where account='factory' and type=$1 and (ref = $2 or ref like $3) order by created_at`,
      [REFUND_TYPE + '-out', id, `refund-${id}-%`]),
  ]);

  // ── charges, bucketed by part ────────────────────────────────────────────────
  const chargedBy = Object.fromEntries(PART_ORDER.map((k) => [k, 0]));
  const lines = [];
  for (const r of flat.rows) {
    const kind = CHARGE_KINDS.find((k) => k.type + '-in' === r.type);
    const amt = money(r.delta);
    if (kind?.type === 'order-charge') {
      const split = await productionSplit(id, amt);
      chargedBy.product += split.product;
      chargedBy.shipping += split.shipping;
      lines.push({ part: 'product', label: PART_LABELS.product, amount: split.product, at: r.created_at });
      if (split.shipping > 0) lines.push({ part: 'shipping', label: PART_LABELS.shipping, amount: split.shipping, at: r.created_at });
      continue;
    }
    const part = kind?.type === 'expedite' ? 'expedite'
      : kind?.type === 'express-ship' ? 'express'
        : kind?.type === 'design-fee' ? 'design' : 'files';
    chargedBy[part] += amt;
    lines.push({ part, label: kind?.label || r.type, amount: amt, note: r.note, at: r.created_at });
  }
  // Each adjustment is its OWN line, never a merged total: the reason is the point of the
  // row, and two adjustments summed into one line lose both of them.
  for (const r of fees.rows) {
    const amt = money(r.delta);
    if (amt <= 0) continue;
    chargedBy.fee += amt;
    lines.push({ part: 'fee', label: PART_LABELS.fee, amount: amt, note: r.note, at: r.created_at, by: r.created_by });
  }
  // File sales are recorded as the SELLER's debit (negative), so flip the sign to state
  // them as a charge like every other line.
  for (const r of files.rows) {
    if (Number(r.delta) >= 0) continue;
    const amt = money(-r.delta);
    chargedBy.files += amt;
    lines.push({ part: 'files', label: r.type === 'emb-file' ? 'Embroidery file' : 'Design file',
                 amount: amt, note: r.note, at: r.created_at });
  }

  // ── refunds, bucketed the same way ───────────────────────────────────────────
  // Rows written before parts existed carry no refund_part. They're counted against the
  // TOTAL (so the overall cap still holds) and attributed top-down, which is where an
  // unallocated refund would have landed anyway.
  const refundedBy = Object.fromEntries(PART_ORDER.map((k) => [k, 0]));
  let unattributed = 0;
  for (const r of refunds.rows) {
    const amt = money(Math.abs(Number(r.delta) || 0));
    if (r.refund_part && refundedBy[r.refund_part] != null) refundedBy[r.refund_part] += amt;
    else unattributed += amt;
  }
  for (const key of PART_ORDER) {
    if (unattributed <= 0) break;
    const room = Math.max(0, money(chargedBy[key]) - refundedBy[key]);
    const take = Math.min(room, unattributed);
    refundedBy[key] = money(refundedBy[key] + take);
    unattributed = money(unattributed - take);
  }

  const parts = PART_ORDER
    .filter((k) => money(chargedBy[k]) > 0)
    .map((k) => ({
      key: k,
      label: PART_LABELS[k],
      charged: money(chargedBy[k]),
      refunded: money(refundedBy[k]),
      refundable: money(Math.max(0, money(chargedBy[k]) - refundedBy[k])),
    }));

  const charged = money(lines.reduce((s, l) => s + l.amount, 0));
  const refunded = money(refunds.rows.reduce((s, r) => s + Math.abs(Number(r.delta) || 0), 0));
  return {
    lines: lines.sort((a, b) => new Date(a.at) - new Date(b.at)),
    parts,
    refunds: refunds.rows.map((r) => ({ amount: money(Math.abs(Number(r.delta) || 0)), part: r.refund_part || null,
                                        note: r.note, at: r.created_at, by: r.created_by })),
    charged,
    refunded,
    refundable: money(Math.max(0, charged - refunded)),
  };
}

/**
 * Work out what each part pays toward a refund. Pure — the arithmetic that decides how
 * much of someone's money moves shouldn't need a database to test.
 *
 * Three shapes, matching how a refund actually gets asked for:
 *   • full            → every part's remaining balance
 *   • {product: 5}    → named amounts, each capped at that part's remainder
 *   • ['shipping']    → those parts in full
 *   • a bare amount   → consumed top-down through PART_ORDER
 *
 * @returns {{alloc: Array<{part:string, amount:number}>, total:number}|{error:string}}
 */
export function allocateRefund({ parts, full, amount, select }) {
  const avail = (parts || []).map((p) => ({ part: p.key, room: money(p.refundable) })).filter((p) => p.room > 0);
  const totalRoom = money(avail.reduce((s, p) => s + p.room, 0));
  if (totalRoom <= 0) return { error: 'There is nothing left to refund on this order.' };

  // Named parts, in full.
  if (Array.isArray(select) && select.length) {
    const alloc = avail.filter((p) => select.includes(p.part)).map((p) => ({ part: p.part, amount: p.room }));
    if (!alloc.length) return { error: 'Those parts have already been refunded in full.' };
    return { alloc, total: money(alloc.reduce((s, a) => s + a.amount, 0)) };
  }
  // Named parts, with amounts.
  if (amount && typeof amount === 'object') {
    const alloc = [];
    for (const [part, raw] of Object.entries(amount)) {
      const want = money(raw);
      if (!isFinite(want) || want <= 0) continue;
      const hit = avail.find((p) => p.part === part);
      if (!hit) return { error: `There's nothing left to refund on ${PART_LABELS[part] || part}.` };
      if (want > hit.room) {
        return { error: `${PART_LABELS[part] || part} has only $${hit.room.toFixed(2)} left to refund.` };
      }
      alloc.push({ part, amount: want });
    }
    if (!alloc.length) return { error: 'Enter an amount greater than zero.' };
    return { alloc, total: money(alloc.reduce((s, a) => s + a.amount, 0)) };
  }
  // Everything left.
  if (full || amount == null || amount === '') {
    return { alloc: avail.map((p) => ({ part: p.part, amount: p.room })), total: totalRoom };
  }
  // A bare figure — spend it down the parts in order.
  const want = money(amount);
  if (!isFinite(want) || want <= 0) return { error: 'Enter an amount greater than zero.' };
  if (want > totalRoom) return { error: `That's more than this order has left to refund ($${totalRoom.toFixed(2)}).`, refundable: totalRoom };
  const alloc = [];
  let left = want;
  for (const p of avail) {
    if (left <= 0) break;
    const take = money(Math.min(p.room, left));
    if (take > 0) { alloc.push({ part: p.part, amount: take }); left = money(left - take); }
  }
  return { alloc, total: want };
}

/**
 * Refund some or all of an order, by part, back to the seller's wallet.
 *
 * Held under a per-order lock: the caps are a read-then-write decision, and two clicks
 * arriving together would otherwise both see the same remaining balance and both pay out.
 * The usual overdraft guard is no help here — the payer is the house account, which is
 * deliberately allowed to run negative.
 *
 * One ledger row PER PART rather than a single lump. It costs a few extra rows and buys
 * an exact answer to "has the shipping been refunded on this order" — which is the
 * question a second refund on the same order has to answer correctly to avoid paying
 * twice. A lump sum can only ever answer it by inference.
 *
 * `clientId` makes a single button press idempotent (a double-click reuses it, and
 * moveFunds dedupes on the ref), while genuinely separate refunds get separate refs.
 */
export async function refundOrder({ orderId, amount, select, full, note, by, clientId }) {
  const id = String(orderId);
  return withLock(`order-refund:${id}`, async () => {
    const row = await q('select id, seller_id from orders where id=$1', [id]).then((r) => r.rows[0]);
    if (!row) return { error: 'Order not found' };
    if (!row.seller_id) return { error: 'This order has no seller to refund.' };

    const state = await orderCharges(id);
    if (state.charged <= 0) return { error: 'This order was never charged, so there is nothing to refund.' };
    const plan = allocateRefund({ parts: state.parts, amount, select, full });
    if (plan.error) return plan;

    const stamp = clientId || Date.now().toString(36);
    for (const a of plan.alloc) {
      const ref = `refund-${id}-${stamp}-${a.part}`;
      await moveFunds({ from: 'factory', to: row.seller_id, amount: a.amount, type: REFUND_TYPE,
                        ref, note: note || `Order ${id} — ${PART_LABELS[a.part] || a.part} refund`, by });
      // Tag the row with its order and part, so the next refund on this order reads an
      // exact remaining balance instead of inferring one.
      await q('update wallet_ledger set order_id=$1, refund_part=$2 where ref=$3', [id, a.part, ref]).catch(() => {});
    }

    const after = await orderCharges(id);
    /**
     * `refundedNow` / `alloc` ARE SEPARATE KEYS, and they have to be.
     *
     * This used to read `{ refunded: plan.total, parts: plan.alloc, ...after }` — and the
     * spread comes last, so `after.refunded` (everything this order has EVER refunded) and
     * `after.parts` (the order's charge parts) silently overwrote both. The caller asking
     * "how much did I just send back" was handed the cumulative total, which is right only
     * for the first refund on an order, and the audit trail recorded the charge parts where
     * it meant to record the allocation.
     */
    return { ok: true, ...after,
             refundedNow: plan.total, alloc: plan.alloc,
             balance: await balanceOf(row.seller_id).catch(() => null) };
  });
}

/**
 * Charge a later price adjustment to the seller, against this order.
 *
 * THE MIRROR OF refundOrder, and held to the same rules, because it is the same money
 * moving the other way:
 *
 *   • ONE LEDGER PAIR, through moveFunds — never a hand-written row. That is what keeps the
 *     seller's balance a SUM of the ledger rather than a number somebody maintains.
 *   • IDEMPOTENT on the ref, so a double-click is one charge and a retry after a timeout is
 *     the same charge, not a second one. `clientId` is the press; separate presses are
 *     separate refs and genuinely separate money.
 *   • THE ORDER LOCK, shared with refunds. A fee and a refund arriving together would
 *     otherwise both read the same charge total, and the refund cap would be computed
 *     against a state that no longer existed by the time it wrote.
 *   • A REASON IS REQUIRED. It is written onto the ledger row, which is what the seller
 *     reads on their statement.
 *
 * The overdraft guard in moveFunds is NOT bypassed. A seller whose wallet cannot cover the
 * adjustment gets a refusal naming the shortfall, and the floor asks them to top up — a
 * wallet quietly pushed negative by the factory is a different product decision, and not one
 * to make inside a fee button.
 */
export async function chargeOrderFee({ orderId, amount, note, by, clientId }) {
  const id = String(orderId);
  const amt = money(amount);
  if (!isFinite(amt) || amt <= 0) return { error: 'Enter an amount greater than zero.' };
  const why = String(note || '').trim();
  if (!why) return { error: 'Say what the adjustment is for — it goes on the seller’s statement.' };

  return withLock(`order-refund:${id}`, async () => {
    const row = await q('select id, seller_id from orders where id=$1', [id]).then((r) => r.rows[0]);
    if (!row) return { error: 'Order not found' };
    if (!row.seller_id) return { error: 'This order has no seller to charge.' };

    const ref = `fee-${id}-${clientId || Date.now().toString(36)}`;
    try {
      await moveFunds({ from: row.seller_id, to: 'factory', amount: amt, type: FEE_TYPE,
                        ref, note: why, by });
    } catch (e) {
      // The shortfall is the useful half of this — it is the number they have to top up by.
      if (e && e.code === 'INSUFFICIENT_FUNDS') {
        return { error: e.message, shortfall: e.shortfall, balance: e.balance };
      }
      throw e;
    }
    // Tag both legs with the order, so it appears on the order's own money history and not
    // only in a flat wallet statement.
    await q('update wallet_ledger set order_id=$1 where ref=$2', [id, ref]).catch(() => {});

    // TELL THEM. A debit that appears with no warning is the one that becomes a support
    // thread; the reason is already written, so it costs nothing to send it.
    notify({ userIds: [row.seller_id], type: 'order-fee',
             title: `$${amt.toFixed(2)} charged on order ${id}`,
             body: why, href: `/orders/${encodeURIComponent(id)}`, entityId: id }).catch(() => {});

    const after = await orderCharges(id);
    return { ok: true, charged: amt, ...after, balance: await balanceOf(row.seller_id).catch(() => null) };
  });
}

export function orderRefundRoutes(app, requireAuth) {
  /**
   * Design-partner state for one order's lines: who has each line's artwork and where it
   * is on their side.
   *
   * A SEPARATE read rather than a join into the order query. Attaching it there would put
   * a lateral join into the path behind every order page and every board, so a mistake in
   * it takes out order detail entirely — where a mistake here costs a badge. The state is
   * decoration; the order is not.
   *
   * Keyed by sku because that's what design_cards stores. Two lines of the same sku
   * therefore share one card — a limitation of that table (line_id is the real line
   * identity everywhere else), so this reports "the card for this sku" rather than
   * pretending to be per line.
   */
  app.get('/api/orders/:id/design-status', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.user || req.user.role === 'seller') { reply.code(403); return { error: 'Staff only' }; }
    /**
     * KEYED BY LINE, because that is what a card is attached to.
     *
     * This was `distinct on (sku)`, which is the one thing design_cards.js says not to do:
     * "line_id IS the line's identity — two lines of the same sku are different jobs". So a
     * card sent from line A collapsed onto its sibling B, and — because assignDesignCard
     * writes line_id and this read it by sku — the row that actually went to the board could
     * come back matching nothing at all. That is why "Send to Board" stayed pressable on a
     * line already on it.
     *
     * Both maps are returned. `byLine` is the answer; `bySku` stays for rows written before
     * line_id existed, which carry a sku and no line, and dropping them would un-flag real
     * cards on live orders. Same precedence the rest of the app uses: line beats sku, sku is
     * the legacy fallback.
     */
    const r = await q(
      `select distinct on (coalesce('L:' || line_id, 'S:' || coalesce(sku,'')))
              coalesce(sku,'') as sku, line_id, id, vendor, vendor_ref, col, updated_at
         from design_cards where order_id = $1
        order by coalesce('L:' || line_id, 'S:' || coalesce(sku,'')), id desc`,
      [String(req.params.id)]
    ).catch(() => ({ rows: [] }));
    const shape = (c) => ({
      cardId: String(c.id), vendor: c.vendor || null, vendorRef: c.vendor_ref || null,
      col: c.col || null, updatedAt: c.updated_at,
    });
    return {
      byLine: Object.fromEntries(r.rows.filter((c) => c.line_id).map((c) => [String(c.line_id), shape(c)])),
      bySku: Object.fromEntries(r.rows.filter((c) => !c.line_id && c.sku).map((c) => [c.sku, shape(c)])),
    };
  });

  /**
   * Itemised charges for one order.
   *
   * Staff read any order — an operator seeing what one cost is harmless and useful; only
   * ISSUING money is restricted (canRefund).
   *
   * A SELLER reads their OWN order. This used to be flat "Staff only", which made the
   * person who actually paid the one party who couldn't see the itemisation — every fee
   * beyond production and shipping (expedited shipping, express, design service, design
   * files) was invisible to them anywhere in the app.
   *
   * A TEAM MEMBER sees it only if the leader granted 'order_fees'. That check is HERE, in
   * the response, not in the client: a member can call this endpoint directly, so hiding
   * the panel in React would be decoration rather than a gate. Without the grant the
   * amounts are never serialised at all — the reply carries `gated: true` and nothing to
   * add up, so there is no figure on the wire to read off.
   */
  app.get('/api/orders/:id/charges', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.user) { reply.code(401); return { error: 'Sign in required' }; }
    const staff = req.user.role !== 'seller';
    if (!staff) {
      const sel = await resolveSeller(req.user, q);
      const own = await q('select seller_id from orders where id=$1', [req.params.id]);
      if (!own.rows[0]) { reply.code(404); return { error: 'Order not found' }; }
      if (String(own.rows[0].seller_id || '') !== String(sel.id || '')) {
        reply.code(403); return { error: 'forbidden' };
      }
      // The leader's switch. Owners (perms === null) always pass; members need the grant.
      if (!canSurface(sel, 'order_fees')) {
        return { gated: true, canRefund: false, lines: [], parts: [], refunds: [],
                 charged: 0, refunded: 0, refundable: 0 };
      }
    }
    // THE FLOOR IS NOT TOLD WHAT THE ORDER WAS WORTH. Same withheld shape a team member gets
    // without the order_fees grant, so the page already knows how to say "not shown to you"
    // rather than printing a row of zeros — which reads as "this order charged nothing".
    if (!canSeeMoney(req.user)) {
      return { gated: true, canRefund: false, lines: [], parts: [], refunds: [],
               charged: 0, refunded: 0, refundable: 0 };
    }
    const state = await orderCharges(req.params.id);
    return { ...state, canRefund: canRefund(req.user) };
  });

  app.post('/api/orders/:id/refund', { preHandler: requireAuth }, async (req, reply) => {
    if (!canRefund(req.user)) {
      reply.code(403);
      return { error: 'Only an admin can refund an order.' };
    }
    const b = req.body || {};
    const before = await orderCharges(req.params.id);
    const out = await refundOrder({
      orderId: req.params.id,
      // Three ways to ask, matching how a refund actually comes up: everything back,
      // named parts in full ("refund the shipping"), or specific amounts per part.
      full: !!b.full,
      select: Array.isArray(b.select) ? b.select : undefined,
      amount: b.amount,
      note: b.note,
      by: req.user.sub,
      clientId: b.clientId,
    });
    if (out.error) { reply.code(400); return out; }
    // OUR side is settled; the buyer's is not, and cannot be from here. See the note on
    // notifyChannelStillOpen — the seller's own transaction with their buyer is theirs to
    // reverse, and until this it was never said.
    await notifyChannelStillOpen(req.params.id, 'refunded');
    // Money moving back to a seller is exactly the kind of act that needs a name against
    // it later — who, how much, which parts, and what it left behind.
    audit(req, 'order.refund', {
      entityType: 'order', entityId: String(req.params.id),
      before: { refunded: before.refunded, refundable: before.refundable },
      // What THIS press moved and where it went — not the order's running totals, which is
      // what `out.refunded` / `out.parts` are. See the note on refundOrder's return.
      after: { refunded: out.refundedNow, parts: out.alloc, note: b.note || null, refundableLeft: out.refundable },
    });

    /**
     * A FULLY REFUNDED ORDER SAYS SO ON THE BOARD.
     *
     * Refunding moved the money and left `factory_status` alone, so an order refunded down
     * to nothing kept whatever stage it was on — `in_review` renders as "Pending", which is
     * how a fully refunded order sat in the queue reading as work waiting to start. The
     * floor picks that up and MAKES it, with the money already back in the seller's wallet.
     *
     * `refunded` is not a new state invented here: it is already in EXCEPTIONS beside
     * cancelled, already in MONEY_STAGES, already labelled "Refunded", and canSetStage
     * already permits shipped -> refunded. Nothing had ever set it.
     *
     * ONLY WHEN NOTHING IS LEFT. A partial refund must not move the stage — sending back the
     * shipping on a shipped order does not un-ship it — so this reads what the refund left
     * behind rather than the caller's `full` flag, which describes the request and not the
     * result. A cent of tolerance, because these are dollar amounts in floating point.
     *
     * Never over a stage that is already terminal for money: cancelled stays cancelled, and
     * a second refund on an already-refunded order changes nothing.
     */
    if (Number(out.refundable ?? 0) <= 0.005) {
      const cur = await q('select factory_status from orders where id=$1', [req.params.id])
        .then((r) => String(r.rows[0]?.factory_status || '').toLowerCase()).catch(() => null);
      if (cur !== null && cur !== 'refunded' && cur !== 'cancelled') {
        await q("update orders set factory_status='refunded' where id=$1", [req.params.id]).catch(() => {});
        audit(req, 'order.stage', {
          entityType: 'order', entityId: String(req.params.id),
          before: { factory_status: cur }, after: { factory_status: 'refunded', because: 'refunded in full' },
        });
        egBroadcast({ type: 'orders' });
      }
    }

    /**
     * KEEPING A FEE BACK is a refund AND a charge, never a smaller refund.
     *
     * "Send back $53.95 but keep $5" could be recorded as a single $48.95 refund, and it
     * would net out the same. It would also be the one entry on the seller's statement that
     * cannot be read: a number that matches neither what they paid nor what they were told
     * they would get, with the $5 existing nowhere at all. So both legs are written — the
     * refund they are owed, and the adjustment, with its own reason — and the net is left to
     * arithmetic, which is what a ledger is for.
     *
     * AFTER the refund, deliberately: the refund is the money they are owed, and it must not
     * be held up by a charge. It also means the funds are there, so the overdraft guard
     * cannot refuse a fee the refund itself just covered.
     *
     * A failed fee leg does NOT fail the refund. It is reported instead — `fee.error` — and
     * the refund it followed stands, because unwinding a completed money movement to report
     * a second one is how one honest failure becomes two dishonest rows.
     */
    let fee = null;
    if (b.fee && Number(b.fee.amount) > 0) {
      fee = await chargeOrderFee({
        orderId: req.params.id, amount: b.fee.amount,
        note: b.fee.note || b.note, by: req.user.sub,
        // Its own key, so the fee and the refund of one press never collide on a ref.
        clientId: b.clientId ? `${b.clientId}-fee` : undefined,
      }).catch((e) => ({ error: e instanceof Error ? e.message : 'The fee could not be charged.' }));
      if (fee.ok) {
        audit(req, 'order.fee', {
          entityType: 'order', entityId: String(req.params.id),
          after: { charged: fee.charged, note: b.fee.note || b.note || null, withRefund: out.refundedNow },
        });
      }
    }
    // The charge state moved under us, so re-read it rather than returning the pre-fee copy.
    const state = fee && fee.ok ? await orderCharges(req.params.id) : null;
    return { ...out, ...(state || {}),
             fee: fee ? (fee.ok ? { charged: fee.charged } : { error: fee.error, shortfall: fee.shortfall }) : null };
  });

  /**
   * A price adjustment on its own — no refund involved.
   *
   * Same authority as a refund (canMoveMoney: admin and warehouse), because it is the same
   * act: moving money between a seller's wallet and the house against a specific order. An
   * operator may not do it for the same reason they may not refund one.
   */
  app.post('/api/orders/:id/fee', { preHandler: requireAuth }, async (req, reply) => {
    if (!canRefund(req.user)) {
      reply.code(403);
      return { error: 'Only an admin can adjust what an order charges.' };
    }
    const b = req.body || {};
    const out = await chargeOrderFee({
      orderId: req.params.id, amount: b.amount, note: b.note, by: req.user.sub, clientId: b.clientId,
    });
    if (out.error) { reply.code(400); return out; }
    audit(req, 'order.fee', {
      entityType: 'order', entityId: String(req.params.id),
      after: { charged: out.charged, note: String(b.note || '').trim() || null },
    });
    return out;
  });
}
