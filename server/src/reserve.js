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
import { blankOf } from './replenish.js';

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

/** What this order needs, per inventory sku. Uses replenishment's own resolver so a hold
 *  and a purchase are counted against the same key. */
async function needsOf(orderId) {
  const lines = (await q(
    'select sku, blank, qty, color, size from order_items where order_id=$1', [orderId]
  ).catch(() => ({ rows: [] }))).rows;
  if (!lines.length) return new Map();
  const idx = await catalogIndex();
  const need = new Map();
  for (const r of lines) {
    const sku = blankOf(idx, r);
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
