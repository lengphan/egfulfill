// reserve.js — hold blanks against an order the moment the factory accepts it.
//
// `inventory.reserved` has existed as a column and a table header since the beginning and
// nothing ever wrote to it: Available read exactly the same as In stock, so two orders for
// the last six shirts both looked makeable and the second one found out at the bench. This
// is the writer.
//
// FOUR RULES, because a reservation that drifts is worse than none — an inflated `reserved`
// hides stock that is physically there, and the floor stops trusting the number:
//
//  1. RESERVED IS NOT PICKED. Only `reserved` moves here; `in_stock` is what is on the
//     shelf and only a scan (or a receipt) may change it. Decrementing both would count one
//     garment twice.
//  2. IDEMPOTENT BY ORDER. What an order holds is stored per (order, sku), so accepting
//     twice, re-saving a line, or bouncing working → hold → working settles on the same
//     number instead of stacking. Each call computes the DELTA against what is already
//     held.
//  3. HELD ONLY WHERE THERE IS A ROW TO HOLD IT ON. A blank we do not stock has nothing to
//     reserve; recording a reservation against a row that does not exist would come back as
//     a phantom decrement the day somebody creates it.
//  4. RELEASED ON SHIPPED AND ON CANCELLED. Shipped: the units left, and the scan that took
//     them off the shelf is what lowers in_stock — the hold must not survive it or the same
//     garment is subtracted twice. Cancelled: the work will never happen.
import { q } from './db.js';
import { catalogIndex } from './pricing.js';
import { stockKeysFor, stockKeyOf } from './replenish.js';

let ready = null;
async function ensure() {
  if (!ready) {
    ready = q(`create table if not exists stock_reservations (
      order_id   text not null,
      sku        text not null,
      qty        integer not null default 0,
      updated_at timestamptz not null default now(),
      primary key (order_id, sku)
    )`).catch(() => {});
  }
  return ready;
}

/**
 * What this order needs, per inventory sku.
 *
 * Through replenishment's own ladder, so a hold and a purchase land on the SAME row. Holding
 * against the product sku while the shelf is kept per colourway reserves units on a row that
 * does not exist — nothing moves, and Available keeps reading as though the order were not
 * in production.
 */
async function needsOf(orderId) {
  const lines = (await q(
    'select sku, blank, qty, color, size from order_items where order_id=$1', [orderId]
  ).catch(() => ({ rows: [] }))).rows;
  if (!lines.length) return new Map();
  const idx = await catalogIndex();
  // Which rungs exist, asked once for every line's candidates.
  const candidates = new Set();
  for (const r of lines) for (const k of stockKeysFor(idx, r)) candidates.add(k);
  const known = new Set(
    candidates.size
      ? (await q('select upper(sku) as sku from inventory where upper(sku) = any($1)', [[...candidates]])
          .catch(() => ({ rows: [] }))).rows.map((r) => r.sku)
      : []
  );
  const need = new Map();
  for (const r of lines) {
    const sku = stockKeyOf(idx, r, known);
    if (!sku) continue;
    need.set(sku, (need.get(sku) || 0) + (Number(r.qty) || 1));
  }
  return need;
}

/**
 * Move this order's holds to `want`, applying only the difference.
 *
 * Returns { held: [{sku, qty}], released: [{sku, qty}], skipped: [sku] }. Never throws into
 * the caller — a status change must not fail because a shelf number could not be adjusted.
 */
async function applyReservation(orderId, want) {
  await ensure();
  const have = new Map(
    (await q('select sku, qty from stock_reservations where order_id=$1', [orderId])
      .catch(() => ({ rows: [] }))).rows.map((r) => [String(r.sku).toUpperCase(), Number(r.qty) || 0])
  );
  const skus = new Set([...want.keys(), ...have.keys()]);
  const held = [], released = [], skipped = [];

  for (const sku of skus) {
    const target = Math.max(0, want.get(sku) || 0);
    const current = have.get(sku) || 0;
    const delta = target - current;
    if (delta === 0) continue;

    // greatest(0, …) so a row that was zeroed by hand can never be driven negative by a
    // release — a negative reservation would read as free stock that does not exist.
    const r = await q(
      `update inventory set reserved = greatest(0, coalesce(reserved,0) + $2)
        where upper(sku) = $1`,
      [sku, delta]
    ).catch(() => ({ rowCount: 0 }));

    if (!r.rowCount) {
      // Nothing on the shelf under that key. Not an error — plenty of blanks are bought to
      // order — but the hold is not recorded, so a row created later starts clean.
      if (target > 0) skipped.push(sku);
      if (current > 0) await q('delete from stock_reservations where order_id=$1 and sku=$2', [orderId, sku]).catch(() => {});
      continue;
    }

    if (target > 0) {
      await q(
        `insert into stock_reservations (order_id, sku, qty, updated_at) values ($1,$2,$3, now())
         on conflict (order_id, sku) do update set qty=excluded.qty, updated_at=now()`,
        [orderId, sku, target]
      ).catch(() => {});
    } else {
      await q('delete from stock_reservations where order_id=$1 and sku=$2', [orderId, sku]).catch(() => {});
    }
    (delta > 0 ? held : released).push({ sku, qty: Math.abs(delta) });
  }
  return { held, released, skipped };
}

/** Accepted into production — hold what it will consume. */
export async function reserveForOrder(orderId) {
  return applyReservation(orderId, await needsOf(orderId)).catch(() => null);
}

/** Shipped, cancelled, or otherwise done — give the hold back. */
export async function releaseForOrder(orderId) {
  return applyReservation(orderId, new Map()).catch(() => null);
}

// ── PICKED, NOT JUST PROMISED ────────────────────────────────────────────────
/**
 * THE SHELF ACTUALLY GOES DOWN NOW.
 *
 * This file, replenish.js and orders.js all said "the scan that lowered in_stock" — and no
 * such code was ever written. Every write to `in_stock` in the server was a hand edit, an
 * adjustment, a PO receipt or a supplier return; not one came from an order. So a job held
 * units at Working and gave the hold back at Shipped, and the count ended exactly where it
 * started while the garment left the building. The floor's answer to that is to correct the
 * number by hand, which is the same as not having one.
 *
 * WORKING IS THE PICK. Committing to make something is when the blank comes off the rack.
 * Not the postage and not the scan — both of those happen to a parcel that already contains
 * it, so keying the decrement there means the shelf reads high for the whole time the thing
 * is being made, which is precisely when someone is deciding whether it can be.
 *
 * Recorded per (order, sku) exactly as the hold is, and applied as a DELTA against what this
 * order has already taken, so working → hold → working settles on one decrement instead of
 * stacking. That ledger is also what makes it reversible: a move back out of production, a
 * cancel or a refund credits the quantities THIS ORDER took, rather than recomputing from
 * lines that may have been edited since.
 */
let consumeReady = null;
async function ensureConsume() {
  if (!consumeReady) {
    consumeReady = q(`create table if not exists stock_consumption (
      order_id   text not null,
      sku        text not null,
      qty        integer not null default 0,
      updated_at timestamptz not null default now(),
      primary key (order_id, sku)
    )`).catch(() => {});
  }
  return consumeReady;
}

/** Move this order's take to `want`, applying only the difference. Never throws. */
async function applyConsumption(orderId, want) {
  await ensureConsume();
  const have = new Map(
    (await q('select sku, qty from stock_consumption where order_id=$1', [orderId])
      .catch(() => ({ rows: [] }))).rows.map((r) => [String(r.sku).toUpperCase(), Number(r.qty) || 0])
  );
  const skus = new Set([...want.keys(), ...have.keys()]);
  const took = [], gave = [], skipped = [];

  for (const sku of skus) {
    const target = Math.max(0, want.get(sku) || 0);
    const current = have.get(sku) || 0;
    const delta = target - current;                 // >0 take more, <0 give back
    if (delta === 0) continue;

    // greatest(0, …) so the shelf can never go negative — a count below zero is not a
    // fact about a warehouse, and it would read as stock owed rather than stock missing.
    // The consumption row still records the full amount, so giving it back is exact even
    // when the take was clamped.
    const r = await q(
      `update inventory set in_stock = greatest(0, coalesce(in_stock,0) - $2), updated_at = now()
        where upper(sku) = $1`,
      [sku, delta]
    ).catch(() => ({ rowCount: 0 }));

    if (!r.rowCount) {
      // No shelf under that key — plenty of blanks are bought to order. Nothing is
      // recorded, so a row created later starts clean rather than owing this order units.
      if (target > 0) skipped.push(sku);
      if (current > 0) await q('delete from stock_consumption where order_id=$1 and sku=$2', [orderId, sku]).catch(() => {});
      continue;
    }

    if (target > 0) {
      await q(
        `insert into stock_consumption (order_id, sku, qty, updated_at) values ($1,$2,$3, now())
         on conflict (order_id, sku) do update set qty=excluded.qty, updated_at=now()`,
        [orderId, sku, target]
      ).catch(() => {});
    } else {
      await q('delete from stock_consumption where order_id=$1 and sku=$2', [orderId, sku]).catch(() => {});
    }
    (delta > 0 ? took : gave).push({ sku, qty: Math.abs(delta) });
  }
  return { took, gave, skipped };
}

/**
 * Being MADE — take the blanks off the shelf, and drop the hold that stood in for them.
 *
 * The order matters: consume first, release second. A hold released before the decrement
 * leaves a window in which the units read as free, and that window is exactly when the
 * replenishment sweep runs.
 */
export async function consumeForOrder(orderId) {
  const out = await applyConsumption(orderId, await needsOf(orderId)).catch(() => null);
  await releaseForOrder(orderId);
  return out;
}

/** Back out of production, cancelled or refunded — put back what this order took. */
export async function restoreForOrder(orderId) {
  return applyConsumption(orderId, new Map()).catch(() => null);
}
