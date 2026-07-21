// replenish.js — when an order reaches awaiting_scan, top up the blanks it consumed
// by appending them to a DRAFT purchase order.
//
// Three decisions worth stating, because they're the difference between this being
// useful and it being a way to accidentally buy 400 shirts:
//
//  1. It appends to a DRAFT and never places. Placing spends money and contacts a
//     supplier — that stays a human click in the Purchase board. (It also can't
//     place safely yet: the S&S/Otto payloads are still unvalidated dry runs.)
//  2. ONE open draft per supplier, merged by SKU. Ten orders for the same blank add
//     ten quantities to one line, not ten purchase orders.
//  3. It counts COMMITTED demand, not just in_stock. At awaiting_scan the label is
//     printed but nothing has been scanned off the shelf yet, so in_stock still
//     reads high. Ordering against it would under-order every time. What matters is
//     in_stock minus everything already promised to unshipped orders.
import { q } from './db.js';

const AUTO_PO = (supplier) => 'PO-AUTO-' + String(supplier || 'UNASSIGNED').toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 24);

// Order SKUs carry a print-method suffix that inventory rows don't (a line is
// "LA6-EMB", the shelf holds "LA6"). Carried over from the old store's
// reportDesignPush — without it every embroidery line looks like an unstocked SKU
// and files a shortage against blanks we actually hold plenty of.
const METHOD_SUFFIX = /-(EMB|DTG|DTF|APL|LSR|SUB|SCR)$/i;
const stripMethod = (s) => String(s || '').trim().replace(METHOD_SUFFIX, '');

/** The blank a line consumes: the chosen blank, else the line's own sku, method stripped. */
const blankOf = (r) => stripMethod(r.blank || r.sku).toUpperCase();

/**
 * Park this order's short blanks in the shared saved-for-later list.
 * Returns { ordered: [{sku, qty, supplier, po}], short: [...], skipped: [...] } — or
 * null if there was nothing to do. Never throws into the caller's path.
 */
export async function autoReplenish(orderId) {
  const lines = (await q(
    `select sku, blank, qty from order_items where order_id=$1`, [orderId]
  ).catch(() => ({ rows: [] }))).rows;
  if (!lines.length) return null;

  // The distinct blanks this order touches. A line with no blank chosen (unset
  // marketplace variant) resolves to its listing sku, which won't match inventory —
  // it falls out below as "unknown" rather than silently ordering nothing.
  const wanted = [...new Set(lines.map(blankOf).filter(Boolean))];
  if (!wanted.length) return null;

  const inv = (await q(
    `select upper(sku) as sku, in_stock, reorder_at, supplier from inventory where upper(sku) = any($1)`,
    [wanted]
  ).catch(() => ({ rows: [] }))).rows;
  const bySku = new Map(inv.map((r) => [r.sku, r]));

  // Committed demand across the whole floor: every unshipped line promised to an
  // order. This is the "reserved" number the inventory table never maintained.
  const committed = new Map();
  for (const r of (await q(
    // Must strip the method suffix on THIS side too — grouping the raw sku would
    // split "LA6-EMB" and "LA6-DTG" into two buckets, neither matching the blank.
    `select upper(regexp_replace(coalesce(nullif(i.blank,''), i.sku), '-(EMB|DTG|DTF|APL|LSR|SUB|SCR)$', '', 'i')) as sku,
            sum(i.qty)::int as qty
       from order_items i
       join orders o on o.id = i.order_id
      where upper(regexp_replace(coalesce(nullif(i.blank,''), i.sku), '-(EMB|DTG|DTF|APL|LSR|SUB|SCR)$', '', 'i')) = any($1)
        and coalesce(i.factory_status,'') <> 'shipped'
        and coalesce(o.status,'') not in ('cancelled','canceled','refunded')
      group by 1`, [wanted]
  ).catch(() => ({ rows: [] }))).rows) committed.set(r.sku, Number(r.qty) || 0);

  const ordered = [], skipped = [];
  // Group the shortfalls by supplier so each supplier's draft is written once.
  const bySupplier = new Map();

  for (const sku of wanted) {
    const row = bySku.get(sku);
    if (!row) { skipped.push({ sku, reason: 'not an inventory item' }); continue; }
    const have = Number(row.in_stock) || 0;
    const promised = committed.get(sku) || 0;
    const floor = Number(row.reorder_at) || 0;
    const projected = have - promised;
    if (projected >= floor) continue;                       // still comfortable

    // Order back up to the reorder point, in whole units. reorder_at is the floor we
    // never want to cross, so that's what we restore to.
    const qty = Math.max(1, floor - projected);
    const supplier = row.supplier || 'Unassigned';
    if (!bySupplier.has(supplier)) bySupplier.set(supplier, []);
    bySupplier.get(supplier).push({ sku, qty, have, promised, floor });
  }
  if (!bySupplier.size) return { ordered: [], skipped, po: null };

  // ── Park the shortfall; do NOT create a purchase order ───────────────────────
  // This used to open (or append to) a draft PO by itself. That put quantities on a
  // document nobody had chosen to create, from orders nobody could see — and committed
  // spend is not something software should decide. It also assumed the money was there.
  //
  // So shortages land in the shared "saved for later" list with the ORDER that needs
  // them, and a human turns them into a PO when they're ready and funded.
  const savedKey = 'po_saved';
  // Columns are k/v, not key/value — the wrong names would have thrown into the catch
  // and silently parked nothing.
  const cur = (await q('select v from factory_lists where k=$1', [savedKey])
    .catch(() => ({ rows: [] }))).rows[0];
  const list = Array.isArray(cur?.v) ? cur.v : [];

  for (const [supplier, items] of bySupplier) {
    for (const it of items) {
      const hit = list.find((x) => String(x.sku || '').toUpperCase() === it.sku);
      const src = { order: String(orderId), qty: it.qty };
      if (hit) {
        // Same blank needed by another order: raise the quantity and record who for,
        // rather than a second row saying the same thing with no context.
        const seen = Array.isArray(hit.sources) ? hit.sources : [];
        if (seen.some((x) => String(x.order) === String(orderId))) continue;   // idempotent
        hit.qty = (Number(hit.qty) || 0) + it.qty;
        hit.sources = [...seen, src];
      } else {
        list.push({ sku: it.sku, qty: it.qty, price: 0, supplier, auto: true,
                    sources: [src], savedAt: new Date().toISOString() });
      }
      ordered.push({ sku: it.sku, qty: it.qty, supplier, saved: true, have: it.have, promised: it.promised });
    }
  }

  await q(
    `insert into factory_lists (k, v, updated_at) values ($1,$2::jsonb, now())
     on conflict (k) do update set v=excluded.v, updated_at=now()`,
    [savedKey, JSON.stringify(list)]
  ).catch(() => {});

  return { ordered, skipped, saved: ordered.length, po: null };
}
