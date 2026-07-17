// What a seller pays the factory to produce an order.
//
//   charge = Σ(base cost × qty)  +  first item's shipping  +  ship_extra × (every other unit)
//
// One order is one parcel, so shipping is charged ONCE and each additional unit only
// adds the extra-item fee. That's why `ship_extra` exists in factory settings; charging
// full shipping per unit would bill a 3-tee order as three shipments.
//
// NB this is NOT orders.total. total is REVENUE — for an Etsy order it's the buyer's
// grandtotal (etsy.js sets it from rc.grandtotal). The old app charged o.total flat
// (orders.html), which would have billed a seller their own gross on every synced
// order. Cost comes from the catalog's base_price, never from the order's revenue.
import { q } from './db.js';

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Platform fee defaults. Keys are `ship_first`/`ship_extra` — the ones factory_settings.js
// reads and the Settings UI writes. (schema.sql also seeds eg_default_shipping_fee /
// eg_default_addl_item_fee, but nothing has ever read those; they're old-app orphans.)
const FALLBACK = { ship_first: 5, ship_extra: 2 };
export async function feeSettings() {
  const out = { ...FALLBACK };
  try {
    const r = await q(`select key, value from settings where key = any($1)`, [['ship_first', 'ship_extra']]);
    for (const row of r.rows) { const n = num(row.value); if (n != null && n >= 0) out[row.key] = n; }
  } catch { /* table not ready → fall back */ }
  return out;
}

// Resolve an item's SKU to its catalog product. Ported from egfulfill-store.js's image
// resolver, which is the app's established matching rule: a product owns its base `sku`
// plus `variantSkus: [{sku,color,size}]` (older rows use `variants`), matched exactly,
// then by base↔variant prefix. Keep the two in sync — a SKU that resolves to a picture
// in one place and to nothing here would price an item at zero.
function candidateSkus(row) {
  const d = row.data || {};
  const out = [];
  const push = (s) => { if (s) out.push(String(s).toUpperCase().trim()); };
  push(row.sku || d.sku);
  const variants = Array.isArray(d.variantSkus) ? d.variantSkus : (Array.isArray(d.variants) ? d.variants : []);
  for (const v of variants) push(typeof v === 'string' ? v : (v && (v.sku || v.SKU)));
  return out.filter(Boolean);
}

export async function catalogIndex() {
  let rows = [];
  try { rows = (await q('select id, sku, base_price, data from catalog_products')).rows; } catch { return { exact: new Map(), rows: [] }; }
  const exact = new Map();
  for (const row of rows) for (const c of candidateSkus(row)) if (!exact.has(c)) exact.set(c, row);
  return { exact, rows };
}

function matchProduct(idx, sku) {
  const s = String(sku || '').toUpperCase().trim();
  if (!s) return null;
  const hit = idx.exact.get(s);
  if (hit) return hit;
  // base ↔ variant prefix (TEE-WHT ↔ TEE-WHT-L), same rule as the image resolver.
  for (const row of idx.rows) {
    for (const c of candidateSkus(row)) {
      if (s.startsWith(c + '-') || c.startsWith(s + '-')) return row;
    }
  }
  return null;
}

// Per-unit cost. A size can override the base (`sizePrices` / `size_prices`:
// {"2XL": 12.5}) — a 3XL blank genuinely costs more than an S.
function unitCostOf(row, size) {
  const d = row.data || {};
  const table = d.sizePrices || d.size_prices || null;
  if (table && size) {
    const key = Object.keys(table).find((k) => k.toLowerCase() === String(size).toLowerCase());
    const n = key != null ? num(table[key]) : null;
    if (n != null) return n;
  }
  return num(d.basePrice ?? d.base_price ?? row.base_price) ?? null;
}

// Per-unit shipping for this variant, most specific first: a per-size fee, then the
// product's own fee, then the platform default.
function shipFeeOf(row, size, fees) {
  const d = row.data || {};
  const table = d.shipFees || d.ship_fees || null;
  if (table && size) {
    const key = Object.keys(table).find((k) => k.toLowerCase() === String(size).toLowerCase());
    const n = key != null ? num(table[key]) : null;
    if (n != null) return n;
  }
  const own = num(d.shippingFee ?? d.shipping_fee);
  return own != null ? own : fees.ship_first;
}

// Quote one order. Returns every line priced, the totals, and anything unpriceable.
// `unpriced` is the caller's cue to refuse: an item with no catalog match has no cost,
// and charging 0 for it would fulfil it for free — silently, forever.
export async function quoteOrder(orderId) {
  const [items, fees, idx] = await Promise.all([
    q('select id, sku, name, qty, size, unit_cost, ship_fee from order_items where order_id=$1 order by id', [orderId]).then((r) => r.rows),
    feeSettings(),
    catalogIndex(),
  ]);
  const lines = [];
  const unpriced = [];
  for (const it of items) {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    // A frozen cost wins: once charged, an order's price is history and must not move
    // when someone edits the catalog.
    const frozen = num(it.unit_cost);
    const frozenShip = num(it.ship_fee);
    let cost = frozen, ship = frozenShip;
    if (cost == null || ship == null) {
      const row = matchProduct(idx, it.sku);
      if (!row) { unpriced.push({ sku: it.sku || '(no sku)', name: it.name || '' }); continue; }
      if (cost == null) cost = unitCostOf(row, it.size);
      if (ship == null) ship = shipFeeOf(row, it.size, fees);
      if (cost == null) { unpriced.push({ sku: it.sku || '(no sku)', name: it.name || '' }); continue; }
    }
    lines.push({ id: it.id, sku: it.sku, name: it.name, qty, size: it.size, unitCost: money(cost), shipFee: money(ship ?? fees.ship_first) });
  }
  return { lines, unpriced, fees, ...computeTotals(lines, fees) };
}

// The money formula, kept pure and exported so it can be tested without a database:
//   subtotal = Σ(unit cost × qty)
//   shipping = the FIRST unit's variant fee + ship_extra for every other UNIT
//   total    = subtotal + shipping
// Note "unit", not "line": 3× of one tee is 3 units in one parcel, so it pays one
// shipping fee and two extra-item fees — not one extra fee for being a single line.
export function computeTotals(lines, fees) {
  const subtotal = money(lines.reduce((s, l) => s + l.unitCost * l.qty, 0));
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const shipping = units > 0 ? money(lines[0].shipFee + (fees.ship_extra || 0) * (units - 1)) : 0;
  return { subtotal, shipping, units, total: money(subtotal + shipping) };
}

// Freeze the quoted prices onto the items, so the charge is reproducible and a later
// catalog edit can never rewrite what someone was already billed.
export async function freezeQuote(orderId, quote) {
  for (const l of quote.lines) {
    await q('update order_items set unit_cost=$1, ship_fee=$2 where id=$3', [l.unitCost, l.shipFee, l.id]).catch(() => {});
  }
}
