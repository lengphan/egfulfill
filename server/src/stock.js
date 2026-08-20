// stock.js — THE JOURNAL BEHIND `in_stock`.
//
// `inventory.in_stock` was a running number with no history: a count could be wrong and
// nothing could say why, or when, or who. Every other number in this system that matters is
// backed by an append-only ledger for exactly that reason — wallet_ledger for money,
// audit_log for records — and stock is the one people argue about most, because it is the
// one a human can also change by walking to a shelf.
//
// So every write to in_stock lands a row here too. Same discipline as wallet_ledger:
//
//  · APPEND ONLY. A correction is another row, never an edit or a delete. (scan_history is
//    the exception on purpose — a mis-scan is deleted there so the scan drawer stays a list
//    of what was actually scanned — and this ledger records the undo as its own entry.)
//  · in_stock SHOULD EQUAL THE SUM OF THE DELTAS. That is a check you can run, and it is
//    the whole point: a shelf that disagrees with its journal is a fact to chase rather
//    than a mystery to absorb.
//  · NO MONEY LIVES HERE. Blanks are expensed the day they arrive (recordCost('blanks') on
//    a received PO) and postage when the label is bought, so an order consuming stock costs
//    nothing NEW — booking it again would double-count COGS. wallet_ledger has no quantity
//    column and its balance is a SUM over deltas; zero-value rows in it would be noise in
//    the P&L that still could not tell you how many shirts moved.
import { q } from './db.js';

/**
 * Why the shelf moved. An explicit list so the history can group without matching strings,
 * and so a typo shows up as an unknown reason rather than a silently-uncategorised row.
 */
export const STOCK_REASONS = {
  consume: 'order-consume',       // − an order reached Working; the blank came off the rack
  restore: 'order-restore',       // + it came back out of production, or was cancelled
  receive: 'po-receipt',          // + a purchase order was received
  supplierReturn: 'supplier-return', // − goods physically going back to the supplier
  scanIn: 'scan-in',              // + scan gun, inbound
  scanOut: 'scan-out',            // − scan gun, outbound
  scanUndo: 'scan-undo',          // ± a mis-scan reversed
  set: 'count-set',               // ± a human typed a number (the Inventory grid, a PATCH)
};

let ready = null;
async function ensure() {
  if (!ready) {
    ready = q(`create table if not exists stock_movements (
      id         bigserial primary key,
      sku        text not null,
      delta      integer not null,
      reason     text not null,
      ref        text,
      order_id   text,
      note       text,
      by_user    text,
      at         timestamptz not null default now()
    )`).then(() => q(
      `create index if not exists stock_movements_sku_at on stock_movements (upper(sku), at desc)`
    )).catch(() => {});
  }
  return ready;
}

/**
 * Record one movement. Never throws into the caller and never blocks the write it follows —
 * losing the journal entry is bad, but failing a receipt or a stage change because the
 * journal was unavailable would be worse, and the shelf number is still correct either way.
 *
 * A zero delta is dropped: "somebody saved the row and changed nothing" is not a movement,
 * and a page of them would bury the ones that are.
 */
export async function recordStockMove({ sku, delta, reason, ref = null, orderId = null, note = null, by = null }) {
  const n = Math.round(Number(delta) || 0);
  const key = String(sku || '').trim();
  if (!key || !n) return;
  await ensure();
  await q(
    `insert into stock_movements (sku, delta, reason, ref, order_id, note, by_user)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [key, n, String(reason || 'unknown'), ref, orderId, note, by ? String(by) : null]
  ).catch(() => {});
}

/** One sku's history, newest first. */
export async function stockMovementsFor(sku, limit = 100) {
  await ensure();
  const r = await q(
    `select id, sku, delta, reason, ref, order_id, note, by_user, at
       from stock_movements where upper(sku) = upper($1)
      order by at desc, id desc limit $2`,
    [String(sku || ''), Math.min(500, Math.max(1, Number(limit) || 100))]
  ).catch(() => ({ rows: [] }));
  return r.rows;
}

/**
 * MANY SKUs AT ONCE — a product's whole shelf, not one variant of it.
 *
 * The Inventory page draws a multi-variant product as a GRID, so its rows have no menu to
 * hang a per-sku history on; and "why did this product's stock change" is the question
 * someone actually asks, across every colour and size at once. One query, newest first,
 * with the sku on each row so the merged list still says which variant moved.
 */
export async function stockMovementsForMany(skus, limit = 200) {
  await ensure();
  const keys = (Array.isArray(skus) ? skus : []).map((k) => String(k || '').trim().toUpperCase()).filter(Boolean);
  if (!keys.length) return [];
  const r = await q(
    `select id, sku, delta, reason, ref, order_id, note, by_user, at
       from stock_movements where upper(sku) = any($1)
      order by at desc, id desc limit $2`,
    [keys, Math.min(1000, Math.max(1, Number(limit) || 200))]
  ).catch(() => ({ rows: [] }));
  return r.rows;
}

/** The journal total across a set of skus — held against the sum of their shelves. */
export async function stockJournalSumMany(skus) {
  await ensure();
  const keys = (Array.isArray(skus) ? skus : []).map((k) => String(k || '').trim().toUpperCase()).filter(Boolean);
  if (!keys.length) return 0;
  const r = await q(
    `select coalesce(sum(delta),0)::int as n from stock_movements where upper(sku) = any($1)`,
    [keys]
  ).catch(() => ({ rows: [{ n: 0 }] }));
  return Number(r.rows[0]?.n) || 0;
}

/**
 * Does the shelf agree with its journal? The sum of every movement for a sku, so a caller
 * can hold it against in_stock. They can legitimately differ for a row that existed before
 * this ledger did — which is itself worth SAYING rather than hiding.
 */
export async function stockJournalSum(sku) {
  await ensure();
  const r = await q(
    `select coalesce(sum(delta),0)::int as n from stock_movements where upper(sku) = upper($1)`,
    [String(sku || '')]
  ).catch(() => ({ rows: [{ n: 0 }] }));
  return Number(r.rows[0]?.n) || 0;
}
