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
import { shippingBandOf, SETTING_DEFAULTS } from './routes/factory_settings.js';

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The per-band shipping and per-method surcharge keys, so a settings change is a pricing
// change without a deploy. Defaults come from factory_settings so the admin screen and
// the billing path can't disagree about what "unset" means.
const FEE_KEYS = [
  'ship_first', 'ship_extra',
  'ship_cap', 'ship_heavy', 'ship_garment',
  'method_dtg', 'method_dtf', 'method_emb', 'method_apl', 'method_lsr',
  'method_scr', 'method_sub', 'method_vnl',
  'base_markup',
];
export async function feeSettings() {
  // SETTING_DEFAULTS is the ONE definition of an unset fee — the Settings screen reads
  // the same object, so what an admin sees is what the quote charges.
  const out = { ...SETTING_DEFAULTS };
  try {
    const r = await q(`select key, value from settings where key = any($1)`, [FEE_KEYS]);
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

// Resolve an item to its catalog product, mirroring chosenProduct() in
// eg-design-tools.js — the chain that decides what the boards SHOW, so pricing and
// display can never disagree about which blank an item is:
//   1. the blank someone explicitly picked (it.blank), matched by name/sku/id
//   2. the item's SKU, matched against the product's base + variant SKUs
// (1) is what makes a marketplace order priceable once its variants are chosen; (2) is
// what makes a listing published FROM our catalog price itself with no picking at all,
// because its variant SKU is already ours.
function matchProduct(idx, item) {
  const blank = String(item.blank || '').trim();
  if (blank) {
    const want = blank.toLowerCase();
    const hit = idx.rows.find((r) => {
      const d = r.data || {};
      return [d.name, r.sku, d.sku, r.id, d.id].some((v) => v != null && String(v).trim().toLowerCase() === want);
    });
    if (hit) return hit;
  }
  const s = String(item.sku || '').toUpperCase().trim();
  if (!s) return null;
  const exact = idx.exact.get(s);
  if (exact) return exact;
  // base ↔ variant prefix (TEE-WHT ↔ TEE-WHT-L), same rule as the image resolver.
  for (const row of idx.rows) {
    for (const c of candidateSkus(row)) {
      if (s.startsWith(c + '-') || c.startsWith(s + '-')) return row;
    }
  }
  return null;
}

/**
 * THE SKU STOCK IS HELD AGAINST, for one order line.
 *
 * `order_items.blank` stores the product's NAME — that is what the variant picker writes —
 * while `inventory` is keyed by SKU. Anything matching one against the other finds nothing:
 * 144 lines carried a blank and ZERO matched an inventory sku, which is why replenishment
 * was a silent no-op for every line where somebody had actually chosen a blank.
 *
 * matchProduct is the resolution the boards and pricing already use, so this cannot drift
 * from what the screen shows. Mirrors resolveProduct + stockSkuOf in
 * web/lib/variant-resolve.ts / web/lib/stock-status.ts — change all three together.
 *
 * Returns '' when nothing resolves, which the caller must treat as "unknown blank", never
 * as "not stocked": they need different fixes and only one of them is about stock.
 */
export function resolveStockSku(idx, item) {
  const row = matchProduct(idx, item);
  const sku = row ? (row.sku || (row.data && row.data.sku)) : null;
  return sku ? String(sku).trim() : '';
}

// Resolve the BLANK NAME a line should carry, from its SKU, when it doesn't already have a
// blank. Returns the catalog product's name (what the client's resolveProduct/VariantPicker
// key on), or null if there's nothing to fill or nothing matched. Used so an imported line
// with a SKU but no Blank column comes in production-ready instead of "not set up".
export function resolveBlankName(idx, item) {
  if (item.blank != null && String(item.blank).trim()) return null;   // already set — don't override
  if (!item.sku) return null;
  const row = matchProduct(idx, item);
  const name = row && row.data && row.data.name;
  return name ? String(name) : null;
}

// The canonical price tier for a size. Shape comes from npmCollectPriceTiers in
// eg-products.js: sizePrices is an ARRAY of {size, price, shipping} — NOT a keyed map.
// `shipping` may be null, meaning "no per-size override, use the product's fee".
function tierFor(d, size) {
  if (!Array.isArray(d.sizePrices) || !size) return null;
  const want = String(size).trim().toLowerCase();
  return d.sizePrices.find((t) => t && t.size != null && String(t.size).trim().toLowerCase() === want) || null;
}

// Per-unit cost = the size's base price (else the product's base) + the print method's
// add-on. Mirrors productUnitPrice in eg-design-tools.js, which is what the boards show
// the seller — if these two disagree, the quote lies about the price on screen.
function unitCostOf(row, item, fees) {
  const d = row.data || {};
  const markup = num(fees && fees.base_markup) || 0;
  // BASE COST is what the seller pays before the print-method surcharge. It comes from
  // the first of these that answers, most specific first:
  //
  //   1. the size's own base cost      — typed by hand, always wins
  //   2. the size's PRODUCT cost + markup — what we pay the supplier, plus our margin
  //   3. the product's base cost       — one price for every size
  //   4. the product's product cost + markup
  //
  // Steps 2 and 4 exist so a supplier sync (S&S/Otto) only has to fill in what the
  // blank costs us; the sell price follows from one number in settings instead of
  // someone retyping a price per size per product.
  const tier = tierFor(d, item.size);
  let base = null;
  if (tier && tier.price != null) { const p = num(tier.price); if (p != null && p > 0) base = p; }
  if (base == null && tier && tier.cost != null) { const c = num(tier.cost); if (c != null && c > 0) base = c + markup; }
  if (base == null) base = num(d.basePrice ?? d.base_price ?? row.base_price);
  if (base == null) { const c = num(d.productCost ?? d.product_cost); if (c != null && c > 0) base = c + markup; }
  if (base == null) return null;
  // The method surcharge sits ON TOP of the base cost, never inside it — so changing
  // the markup never silently changes what embroidery adds.
  return base + methodAddOn(d, item.print_type, fees);
}

// Print-method surcharge (EMB stitches cost more than DTG ink). Method aliases are
// normalised exactly as eg-design-tools.js does it.
function methodAddOn(d, printType, fees) {
  const tech = String(printType || '').toUpperCase();
  if (!tech) return 0;
  // Keep in step with normTech() in web/lib/print-method.ts — the picker offers these
  // labels, so every one of them must resolve to a key that has a surcharge.
  const k = /EMB/.test(tech) ? 'EMB' : /DTF/.test(tech) ? 'DTF' : /APL|APPLIQ/.test(tech) ? 'APL'
          : /LSR|LASER|ENGRAV/.test(tech) ? 'LSR' : /SCR|SCREEN/.test(tech) ? 'SCR'
          : /SUBLIM|\bDYE\b/.test(tech) ? 'SUB' : /VINYL|\bHTV\b|\bVNL\b/.test(tech) ? 'VNL'
          : /DTG|DIRECT/.test(tech) ? 'DTG' : tech;
  // A product may override the surcharge for its own method mix.
  if (d.methodPrices) {
    const mp = num(d.methodPrices[k] != null ? d.methodPrices[k] : d.methodPrices[tech]);
    if (mp != null && mp > 0) return mp;
  }
  // Otherwise the platform default (embroidery costs more than ink; plain print is free).
  const plat = fees ? num(fees[`method_${k.toLowerCase()}`]) : null;
  return plat != null && plat > 0 ? plat : 0;
}

// Per-unit shipping, most specific first: the size's own fee, then the product's fee,
// then the platform default.
function shipFeeOf(row, size, fees) {
  const d = row.data || {};
  const tier = tierFor(d, size);
  if (tier && tier.shipping != null) { const s = num(tier.shipping); if (s != null) return s; }
  const own = num(d.shippingFee ?? d.shipping_fee);
  if (own != null) return own;
  // No per-size and no per-product fee → the flat band for this garment class (caps ship
  // cheaper than hoodies), falling back to the platform's single default if unset.
  const band = num(fees[shippingBandOf(`${d.type || ''} ${d.name || ''}`)]);
  return band != null ? band : fees.ship_first;
}

// The extra-item fee for additional units. A product may set its own
// (additionalItemShipping) — a second hoodie adds more weight than a second sticker —
// otherwise the platform's ship_extra applies.
function extraFeeOf(row, fees) {
  const own = num((row.data || {}).additionalItemShipping);
  return own != null ? own : fees.ship_extra;
}

/**
 * Price a product SPEC (not an order) — what one unit of {blank, size, printType} costs
 * us to make and ship. This is what lets the publish dialog show a real margin before a
 * listing exists.
 *
 * Deliberately routed through the SAME matchProduct/unitCostOf/shipFeeOf helpers the
 * order quote uses. A second cost formula for "what shall I charge" would drift from the
 * one that actually bills, and the seller would price against a number we never charge.
 */
export async function quoteSpec({ blank, sku, size, printType }) {
  const [fees, idx] = await Promise.all([feeSettings(), catalogIndex()]);
  const item = { blank: blank || '', sku: sku || '', size: size || '', print_type: printType || '' };
  const row = matchProduct(idx, item);
  if (!row) return { matched: null, unitCost: null, shipping: null, total: null };
  const cost = unitCostOf(row, item, fees);
  const ship = shipFeeOf(row, item.size, fees);
  const d = row.data || {};
  return {
    matched: { id: row.id, sku: row.sku, name: d.name ?? null },
    unitCost: cost == null ? null : money(cost),
    shipping: money(ship ?? fees.ship_first),
    total: cost == null ? null : money(cost + (ship ?? fees.ship_first)),
  };
}

// Quote one order. Returns every line priced, the totals, and anything unpriceable.
// `unpriced` is the caller's cue to refuse: an item with no catalog match has no cost,
// and charging 0 for it would fulfil it for free — silently, forever.
export async function quoteOrder(orderId) {
  const [items, fees, idx] = await Promise.all([
    q('select id, sku, name, qty, size, blank, print_type, unit_cost, ship_fee from order_items where order_id=$1 order by id', [orderId]).then((r) => r.rows),
    feeSettings(),
    catalogIndex(),
  ]);
  const lines = [];
  const unpriced = [];
  for (const it of items) {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    // A frozen cost wins: once charged, an order's price is history and must not move
    // when someone edits the catalog.
    let cost = num(it.unit_cost), ship = num(it.ship_fee);
    let extra = fees.ship_extra;
    if (cost == null || ship == null) {
      const row = matchProduct(idx, it);
      // No product = no cost. The variants haven't been chosen yet (a marketplace order
      // arrives with none), so the caller must ask for them rather than invent a price.
      if (!row) { unpriced.push({ sku: it.sku || '(no sku)', name: it.name || '', reason: 'no-product' }); continue; }
      if (cost == null) cost = unitCostOf(row, it, fees);
      if (ship == null) ship = shipFeeOf(row, it.size, fees);
      extra = extraFeeOf(row, fees);
      if (cost == null) { unpriced.push({ sku: it.sku || '(no sku)', name: it.name || '', reason: 'no-cost' }); continue; }
    }
    lines.push({ id: it.id, sku: it.sku, name: it.name, qty, size: it.size, blank: it.blank,
                 unitCost: money(cost), shipFee: money(ship ?? fees.ship_first), extraFee: money(extra) });
  }
  return { lines, unpriced, fees, ...computeTotals(lines, fees) };
}

// The money formula, kept pure and exported so it can be tested without a database:
//   subtotal = Σ((base for its size + print-method add-on) × qty)
//   shipping = the FIRST unit's fee + that product's extra-item fee for every other UNIT
//   total    = subtotal + shipping
// Note "unit", not "line": 3× of one tee is 3 units in one parcel, so it pays one
// shipping fee and two extra-item fees — not one extra fee for being a single line.
// The first line sets both rates because it's one parcel and something has to define it.
export function computeTotals(lines, fees) {
  const subtotal = money(lines.reduce((s, l) => s + l.unitCost * l.qty, 0));
  const units = lines.reduce((s, l) => s + l.qty, 0);
  if (!units) return { subtotal, shipping: 0, units: 0, total: subtotal };
  const first = lines[0];
  const extra = first.extraFee != null ? first.extraFee : (fees.ship_extra || 0);
  const shipping = money(first.shipFee + extra * (units - 1));
  return { subtotal, shipping, units, total: money(subtotal + shipping) };
}

// Freeze the quoted prices onto the items, so the charge is reproducible and a later
// catalog edit can never rewrite what someone was already billed.
export async function freezeQuote(orderId, quote) {
  for (const l of quote.lines) {
    await q('update order_items set unit_cost=$1, ship_fee=$2 where id=$3', [l.unitCost, l.shipFee, l.id]).catch(() => {});
  }
}
