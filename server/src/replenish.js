// replenish.js — when an order is ACCEPTED INTO PRODUCTION (reaches 'working'), top up the
// blanks it consumed by appending them to a DRAFT purchase order.
//
// Three decisions worth stating, because they're the difference between this being
// useful and it being a way to accidentally buy 400 shirts:
//
//  1. It appends to a DRAFT and never places. Placing spends money and contacts a
//     supplier — that stays a human click in the Purchase board. (It also can't
//     place safely yet: the S&S/Otto payloads are still unvalidated dry runs.)
//  2. ONE open draft per supplier, merged by SKU. Ten orders for the same blank add
//     ten quantities to one line, not ten purchase orders.
//  3. It counts COMMITTED demand, not just in_stock. The moment an order is accepted
//     nothing has been picked off the shelf yet, so in_stock still reads high.
//     Ordering against it would under-order every time. What matters is in_stock
//     minus everything already promised to unshipped orders.
import { q } from './db.js';
import { catalogIndex, resolveStockSku } from './pricing.js';

const AUTO_PO = (supplier) => 'PO-AUTO-' + String(supplier || 'UNASSIGNED').toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 24);

// Order SKUs carry a print-method suffix that inventory rows don't (a line is
// "LA6-EMB", the shelf holds "LA6"). Carried over from the old store's
// reportDesignPush — without it every embroidery line looks like an unstocked SKU
// and files a shortage against blanks we actually hold plenty of.
const METHOD_SUFFIX = /-(EMB|DTG|DTF|APL|LSR|SUB|SCR)$/i;
/** Exported so the public stock feed strips suffixes the SAME way replenishment does —
 *  two copies of this rule drifting is how a partner is told a blank is out of stock
 *  while the shelf is full. */
export const stripMethod = (s) => String(s || '').trim().replace(METHOD_SUFFIX, '');

/**
 * The blank a line consumes, as the SKU inventory is actually keyed by.
 *
 * This used to be `stripMethod(r.blank || r.sku)` — the raw blank, which is a product NAME,
 * matched against `inventory.sku`. 144 lines carried a blank and none of them could ever
 * match, so every line where somebody had chosen a blank was skipped as "not an inventory
 * item" and nothing was ever replenished for it.
 */
const blankOf = (idx, r) => stripMethod(resolveStockSku(idx, r) || r.blank || r.sku).toUpperCase();

/**
 * Park this order's short blanks in the shared saved-for-later list.
 * Returns { ordered: [{sku, qty, supplier, po}], short: [...], skipped: [...] } — or
 * null if there was nothing to do. Never throws into the caller's path.
 */
export async function autoReplenish(orderId) {
  const lines = (await q(
    `select sku, blank, qty, color, size from order_items where order_id=$1`, [orderId]
  ).catch(() => ({ rows: [] }))).rows;
  if (!lines.length) return null;

  // One catalog read for the whole call — matchProduct walks it per line.
  const idx = await catalogIndex();

  /**
   * HOW MANY OF EACH BLANK THIS ORDER NEEDS — and in WHICH VARIANT.
   *
   * Two lines of the same blank add up: they are two jobs but one shelf, and ordering for
   * each separately would buy the same shortfall twice. But they only add up per COLOURWAY
   * AND SIZE — the cart keys its lines `sku|variant` precisely because 10 White/XL and 2
   * Black/2XL are not 12 of anything. Parking a line with no variant, as this did, collapses
   * every colour of a blank into one line wearing whichever variant happened to be first,
   * which is the fault the cart's own lineKey exists to prevent, arriving from the server.
   *
   * "Colour / Size", the same string /api/purchase/resolve-suppliers builds, so a parked
   * line and a picked one merge instead of sitting beside each other saying the same thing.
   */
  const variantOf = (r) => [r.color, r.size].map((v) => String(v ?? '').trim()).filter(Boolean).join(' / ');
  const need = new Map();          // blank sku -> total units
  const byVariant = new Map();     // blank sku -> Map(variant -> units)
  for (const r of lines) {
    const sku = blankOf(idx, r);
    if (!sku) continue;
    const qty = Number(r.qty) || 1;
    need.set(sku, (need.get(sku) || 0) + qty);
    if (!byVariant.has(sku)) byVariant.set(sku, new Map());
    const v = byVariant.get(sku);
    const key = variantOf(r);
    v.set(key, (v.get(key) || 0) + qty);
  }
  const wanted = [...need.keys()];
  if (!wanted.length) return null;

  const inv = (await q(
    `select upper(sku) as sku, in_stock, reorder_at, supplier from inventory where upper(sku) = any($1)`,
    [wanted]
  ).catch(() => ({ rows: [] }))).rows;
  const bySku = new Map(inv.map((r) => [r.sku, r]));

  /**
   * WHAT OTHER UNSHIPPED ORDERS HAVE ALREADY CLAIMED. This is the "reserved" number the
   * inventory table never maintained.
   *
   * Resolved in JS rather than grouped in SQL, because the blank on a line is a product
   * NAME and only matchProduct knows how to turn one into a sku. The old query grouped on
   * `coalesce(blank, sku)` directly, so its buckets were a mix of names and skus and none
   * of the name ones matched inventory.
   *
   * THIS ORDER IS EXCLUDED. Its own lines are the demand we are about to satisfy; counting
   * them as already-promised would subtract this order's need from its own availability and
   * order roughly twice what is missing.
   */
  const committed = new Map();
  for (const r of (await q(
    `select i.sku, i.blank, i.qty from order_items i
       join orders o on o.id = i.order_id
      where coalesce(i.factory_status,'') <> 'shipped'
        and coalesce(o.status,'') not in ('cancelled','canceled','refunded')
        and i.order_id <> $1`, [orderId]
  ).catch(() => ({ rows: [] }))).rows) {
    const sku = blankOf(idx, r);
    if (!sku || !need.has(sku)) continue;   // only the blanks this order touches
    committed.set(sku, (committed.get(sku) || 0) + (Number(r.qty) || 1));
  }

  const ordered = [], skipped = [];
  // Group the shortfalls by supplier so each supplier's draft is written once.
  const bySupplier = new Map();

  for (const sku of wanted) {
    const row = bySku.get(sku);
    if (!row) { skipped.push({ sku, reason: 'not an inventory item' }); continue; }
    /**
     * SHORTFALL AGAINST WHAT IS ACTUALLY FREE — not against in_stock, and not a top-up.
     *
     * in_stock reads high the moment an order is accepted, because nothing has been picked
     * off the shelf yet. Ordering against it under-orders every time: the units are there,
     * they are just already promised to somebody else, and you find that out at the bench.
     * So availability is stock MINUS everything other unshipped orders have claimed.
     *
     * The quantity is what THIS order is missing, deliberately. It buys no buffer — the
     * same blank gets bought again for the next order — and that is the accepted trade for
     * a cart that maps 1:1 to orders somebody can look at before spending money.
     * reorder_at is untouched here; restoring a buffer is a separate, scheduled job if it
     * is ever wanted.
     */
    const have = Number(row.in_stock) || 0;
    const promised = committed.get(sku) || 0;
    const available = Math.max(0, have - promised);
    const want = need.get(sku) || 0;
    if (available >= want) continue;                        // makeable from stock on hand

    /**
     * SPLIT THE SHORTFALL ACROSS THE VARIANTS THAT NEED IT.
     *
     * Stock is held per BLANK — every inventory row has an empty `variant` — so there is no
     * per-colour number to subtract from, and any allocation of the units we DO hold is
     * arbitrary. Handing them out in the order the lines appear is the simplest rule that is
     * honest about that: the TOTAL bought is exactly the blank's shortfall, and every line
     * emitted names a real colourway somebody can actually pick off a supplier's site.
     *
     * The alternative — one line with the summed quantity and no variant — is the thing that
     * gets you twelve of one colour and none of the other.
     */
    let left = available;
    const supplier = row.supplier || 'Unassigned';
    if (!bySupplier.has(supplier)) bySupplier.set(supplier, []);
    for (const [variant, units] of (byVariant.get(sku) || new Map())) {
      const covered = Math.min(left, units);
      left -= covered;
      const qty = units - covered;
      if (qty <= 0) continue;
      bySupplier.get(supplier).push({ sku, variant, qty, have, promised, want, available });
    }
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

  /**
   * THE CART'S OWN KEY, mirrored exactly — sku uppercased, variant lowercased, both trimmed.
   * See lineKey in web/components/app/purchase-view.tsx; change both together. Matching on
   * sku alone here would merge Black/2XL into White/XL on the way IN, which is the same
   * twelve-of-one-colour failure the cart's key prevents on the way out.
   */
  const lineKey = (l) => `${String(l.sku ?? '').trim().toUpperCase()}|${String(l.variant ?? '').trim().toLowerCase()}`;

  for (const [supplier, items] of bySupplier) {
    for (const it of items) {
      const hit = list.find((x) => lineKey(x) === lineKey(it));
      const src = { order: String(orderId), qty: it.qty };
      if (hit) {
        // Same blank needed by another order: raise the quantity and record who for,
        // rather than a second row saying the same thing with no context.
        const seen = Array.isArray(hit.sources) ? hit.sources : [];
        if (seen.some((x) => String(x.order) === String(orderId))) continue;   // idempotent
        hit.qty = (Number(hit.qty) || 0) + it.qty;
        hit.sources = [...seen, src];
      } else {
        list.push({ sku: it.sku, variant: it.variant || '', qty: it.qty, price: 0, supplier,
                    auto: true, sources: [src], savedAt: new Date().toISOString() });
      }
      ordered.push({ sku: it.sku, variant: it.variant || '', qty: it.qty, supplier,
                     saved: true, have: it.have, promised: it.promised });
    }
  }

  await q(
    `insert into factory_lists (k, v, updated_at) values ($1,$2::jsonb, now())
     on conflict (k) do update set v=excluded.v, updated_at=now()`,
    [savedKey, JSON.stringify(list)]
  ).catch(() => {});

  return { ordered, skipped, saved: ordered.length, po: null };
}
