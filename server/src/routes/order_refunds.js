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

// Which part of an order a refund row paid back. Added idempotently at load, like the
// other late columns in this codebase — schema.sql only runs on a first DB init, so an
// existing deployment would never see it otherwise.
q('alter table wallet_ledger add column if not exists refund_part text').catch(() => {});

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const canRefund = (u) => !!u && (u.role === 'admin' || u.role === 'warehouse');

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
  { type: 'expedite',     label: 'Expedited dispatch', ref: (id) => `expedite-${id}` },
  { type: 'express-ship', label: 'Express shipping',   ref: (id) => `express-${id}` },
  { type: 'design-fee',   label: 'Design service',     ref: (id) => `design-${id}` },
];
// Design-file sales key on `orderId|sku`, so they're matched by prefix rather than
// by an exact ref — one order can sell several files.
const FILE_TYPES = ['emb-file', 'design-file'];

const REFUND_TYPE = 'order-refund';

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
export const PART_ORDER = ['product', 'shipping', 'expedite', 'express', 'design', 'files'];
const PART_LABELS = {
  product: 'Product cost',
  shipping: 'Shipping',
  expedite: 'Expedited dispatch',
  express: 'Express shipping',
  design: 'Design service',
  files: 'Design files',
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

  const [flat, files, refunds] = await Promise.all([
    q(`select type, ref, delta, note, created_at from wallet_ledger
        where account='factory' and type = any($1) and ref = any($2) order by created_at`,
      [inTypes, refs]),
    q(`select type, ref, delta, note, created_at from wallet_ledger
        where type = any($1) and ref like $2 order by created_at`,
      [FILE_TYPES, id + '|%']),
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
    return { ok: true, refunded: plan.total, parts: plan.alloc, ...after,
             balance: await balanceOf(row.seller_id).catch(() => null) };
  });
}

export function orderRefundRoutes(app, requireAuth) {
  // Itemised charges for one order. Staff-readable — an operator seeing what an order
  // cost is harmless and useful; only ISSUING money is restricted.
  app.get('/api/orders/:id/charges', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.user || req.user.role === 'seller') { reply.code(403); return { error: 'Staff only' }; }
    const state = await orderCharges(req.params.id);
    return { ...state, canRefund: canRefund(req.user) };
  });

  app.post('/api/orders/:id/refund', { preHandler: requireAuth }, async (req, reply) => {
    if (!canRefund(req.user)) {
      reply.code(403);
      return { error: 'Only admin or warehouse can refund an order.' };
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
    // Money moving back to a seller is exactly the kind of act that needs a name against
    // it later — who, how much, which parts, and what it left behind.
    audit(req, 'order.refund', {
      entityType: 'order', entityId: String(req.params.id),
      before: { refunded: before.refunded, refundable: before.refundable },
      after: { refunded: out.refunded, parts: out.parts, note: b.note || null, refundableLeft: out.refundable },
    });
    return out;
  });
}
