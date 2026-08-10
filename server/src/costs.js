// External costs — what WE pay outside suppliers, booked as it happens.
// -----------------------------------------------------------------------------
// Revenue already lives in wallet_ledger (order charges, expedite fees, subscriptions,
// file sales). Costs were scattered: byeastside was in the ledger, purchase orders sat
// in their own table, and label + design-partner costs weren't recorded anywhere at all.
// A P&L can't be assembled from that.
//
// So every external cost is written HERE, into the same ledger, as a one-sided debit on
// the house account. One source of truth: the billing view is a read over the money
// itself rather than a second set of books that can drift from it.
//
// Recorded AT THE MOMENT IT'S INCURRED, never recomputed later from supplier prices —
// prices move, and a report that recalculates history from today's rates misstates it.
// This is also why the capture matters now: a cost never written down cannot be
// backfilled. Shippo tells us what a label cost exactly once.
import { q } from './db.js';

/** The one house account costs are booked against — same wallet the revenue credits. */
const HOUSE = 'factory';

/**
 * Cost categories. Kept as an explicit list so the billing view can group without
 * pattern-matching strings, and so a typo becomes an unknown category rather than a
 * silently-invisible line.
 */
export const COST_TYPES = {
  label: 'label-cost',            // postage bought from Shippo / EasyPost / USPS
  dispatch: 'expedite-cost',      // byeastside per-label pick fee
  design: 'design-partner-cost',  // Pink Design task
  blanks: 'blanks-cost',          // S&S / Otto purchase orders
  // A sourcing sample. Factory spend like the rest — never a seller charge — and its own
  // type rather than folded into `blanks` because a sample is money spent to DECIDE, not
  // stock bought to sell: it has no order behind it and no margin to sit against, and
  // averaging it into COGS would quietly worsen every product's cost.
  sample: 'sample-cost',
};

/**
 * Book one external cost.
 *
 * Idempotent on `ref`: the same label bought twice, a retried webhook or a re-received PO
 * books once. `ref` should identify the THING that cost money (an order id, a PO number),
 * not the moment — a timestamped ref would defeat the de-dupe it exists for.
 *
 * Best-effort by design: never throw. A cost record failing must not roll back the label
 * purchase or the partner push it describes — losing one accounting row is bad, failing a
 * customer's dispatch over it is worse.
 *
 * @param {'label'|'dispatch'|'design'|'blanks'|'sample'} kind
 * @param {number} amount   positive; what we PAID (stored as a negative delta)
 * @param {string} ref      stable id for the thing, e.g. `label-FF-1042`
 */
export async function recordCost(kind, amount, ref, note = null, meta = {}) {
  const type = COST_TYPES[kind];
  const amt = Number(amount);
  if (!type || !isFinite(amt) || amt <= 0 || !ref) return { ok: false, skipped: true };
  try {
    await q(
      `insert into wallet_ledger (account, delta, type, ref, note)
       values ($1, $2, $3, $4, $5)
       on conflict do nothing`,
      [HOUSE, -Math.abs(amt), type, String(ref), note || null]
    );
    // The order id, where there is one, so a cost can be traced to the job that caused it
    // — "what did FF-1042 actually cost us" is the question that finds a bad margin.
    if (meta.orderId) {
      await q(
        `update wallet_ledger set order_id=$1 where ref=$2 and type=$3 and order_id is null`,
        [String(meta.orderId), String(ref), type]
      ).catch(() => {});
    }
    return { ok: true, type, amount: amt };
  } catch {
    return { ok: false };
  }
}

/** Idempotent column add — costs carry the order they belong to, when they belong to one. */
export async function ensureCostColumns() {
  await q('alter table wallet_ledger add column if not exists order_id text').catch(() => {});
  await q('create index if not exists wallet_ledger_order on wallet_ledger (order_id)').catch(() => {});
}

/**
 * Reverse an external cost — a supplier credit, a refunded label, a task we were not
 * charged for after all.
 *
 * A separate POSITIVE row rather than deleting or editing the original. The ledger is
 * append-only for the same reason a paper one is: "we spent $400 and got $120 back" and
 * "we spent $280" are different facts, and only the first survives an audit. Netting them
 * at write time throws away the history that explains the number.
 *
 * Idempotent on its own ref, so a credit confirmed twice lands once.
 *
 * @param {'label'|'dispatch'|'design'|'blanks'|'sample'} kind  what the credit reverses
 * @param {number} amount   positive; what came BACK (stored as a positive delta)
 * @param {string} ref      stable id for the credit, e.g. `po-return-PO-123-1`
 */
export async function recordCredit(kind, amount, ref, note = null, meta = {}) {
  const type = COST_TYPES[kind];
  const amt = Number(amount);
  if (!type || !isFinite(amt) || amt <= 0 || !ref) return { ok: false, skipped: true };
  try {
    await q(
      `insert into wallet_ledger (account, delta, type, ref, note)
       values ($1, $2, $3, $4, $5)
       on conflict do nothing`,
      [HOUSE, Math.abs(amt), type + '-credit', String(ref), note || null]
    );
    if (meta.orderId) {
      await q(
        `update wallet_ledger set order_id=$1 where ref=$2 and type=$3 and order_id is null`,
        [String(meta.orderId), String(ref), type + '-credit']
      ).catch(() => {});
    }
    return { ok: true, type: type + '-credit', amount: amt };
  } catch {
    return { ok: false };
  }
}
