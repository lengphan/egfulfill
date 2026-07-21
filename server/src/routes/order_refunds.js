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
 * What this order has charged, what's already gone back, and what may still be refunded.
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
    q(`select ref, delta, note, created_at, created_by from wallet_ledger
        where account='factory' and type=$1 and (ref = $2 or ref like $3) order by created_at`,
      [REFUND_TYPE + '-out', id, `refund-${id}-%`]),
  ]);

  const lines = [];
  for (const r of flat.rows) {
    const kind = CHARGE_KINDS.find((k) => k.type + '-in' === r.type);
    lines.push({ kind: kind?.type || r.type, label: kind?.label || r.type, amount: money(r.delta), note: r.note, at: r.created_at });
  }
  // File sales are recorded as the SELLER's debit (negative), so flip the sign to state
  // them as a charge like every other line.
  for (const r of files.rows) {
    if (Number(r.delta) >= 0) continue;
    lines.push({ kind: r.type, label: r.type === 'emb-file' ? 'Embroidery file' : 'Design file',
                 amount: money(-r.delta), note: r.note, at: r.created_at });
  }

  const charged = money(lines.reduce((s, l) => s + l.amount, 0));
  // The factory's leg of a refund is negative; refunds are stated positive.
  const refunded = money(refunds.rows.reduce((s, r) => s + Math.abs(Number(r.delta) || 0), 0));
  return {
    lines: lines.sort((a, b) => new Date(a.at) - new Date(b.at)),
    refunds: refunds.rows.map((r) => ({ amount: money(Math.abs(Number(r.delta) || 0)), note: r.note, at: r.created_at, by: r.created_by })),
    charged,
    refunded,
    refundable: money(Math.max(0, charged - refunded)),
  };
}

/**
 * Decide what a refund request is allowed to pay out. Pure, and separate from the money
 * movement, so the rule that stops an over-refund can be tested without a database —
 * everything below this line is I/O, and everything a mistake here would cost is real.
 *
 * @param {{charged:number, refunded:number, requested:number|null|undefined|''}} s
 * @returns {{amount:number}|{error:string, refundable?:number}}
 */
export function refundDecision({ charged, refunded, requested }) {
  const refundable = money(Math.max(0, money(charged) - money(refunded)));
  if (refundable <= 0) {
    return { error: money(charged) > 0
      ? 'Everything charged on this order has already been refunded.'
      : 'This order was never charged, so there is nothing to refund.' };
  }
  // Omitted amount means "all of it" — the common case is refunding an order whole, and
  // making someone retype a figure they can see is how the wrong figure gets typed.
  const want = requested == null || requested === '' ? refundable : money(requested);
  if (!isFinite(want) || want <= 0) return { error: 'Enter an amount greater than zero.' };
  if (want > refundable) {
    return { error: `That's more than this order has left to refund ($${refundable.toFixed(2)}).`, refundable };
  }
  return { amount: want };
}

/**
 * Refund `amount` (or everything left, when amount is omitted) to the order's seller.
 *
 * Held under a per-order lock: the cap is a read-then-write decision, and two clicks
 * arriving together would otherwise both see "nothing refunded yet" and both pay out.
 * The usual overdraft guard is no help here — the payer is the house account, which is
 * deliberately allowed to run negative.
 *
 * `clientId` makes a single button press idempotent (a double-click reuses it, and
 * moveFunds dedupes on the ref), while genuinely separate refunds get separate refs.
 */
export async function refundOrder({ orderId, amount, note, by, clientId }) {
  const id = String(orderId);
  return withLock(`order-refund:${id}`, async () => {
    const row = await q('select id, seller_id from orders where id=$1', [id]).then((r) => r.rows[0]);
    if (!row) return { error: 'Order not found' };
    if (!row.seller_id) return { error: 'This order has no seller to refund.' };

    const state = await orderCharges(id);
    const decided = refundDecision({ charged: state.charged, refunded: state.refunded, requested: amount });
    if (decided.error) return decided;
    const want = decided.amount;

    const ref = `refund-${id}-${clientId || Date.now().toString(36)}`;
    await moveFunds({ from: 'factory', to: row.seller_id, amount: want, type: REFUND_TYPE,
                      ref, note: note || `Order ${id} — refund`, by });
    // Tie the row to its order so the billing view and this panel agree without
    // re-deriving anything from the ref's shape.
    await q('update wallet_ledger set order_id=$1 where ref=$2', [id, ref]).catch(() => {});

    const after = await orderCharges(id);
    return { ok: true, refunded: want, ...after, balance: await balanceOf(row.seller_id).catch(() => null) };
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
      amount: b.amount,
      note: b.note,
      by: req.user.sub,
      clientId: b.clientId,
    });
    if (out.error) { reply.code(400); return out; }
    // Money moving back to a seller is exactly the kind of act that needs a name against
    // it later — who, how much, and what it left behind.
    audit(req, 'order.refund', {
      entityType: 'order', entityId: String(req.params.id),
      before: { refunded: before.refunded, refundable: before.refundable },
      after: { refunded: out.refunded, note: b.note || null, refundableLeft: out.refundable },
    });
    return out;
  });
}
