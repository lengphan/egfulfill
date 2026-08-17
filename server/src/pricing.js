// What a seller pays the factory to produce an order.
//
//   charge = Σ(base cost × qty)  +  the DEAREST line's shipping  +  ship_extra × (every other unit)
//
// One order is one parcel, so shipping is charged ONCE and each additional unit only
// adds the extra-item fee. That's why `ship_extra` exists in factory settings; charging
// full shipping per unit would bill a 3-tee order as three shipments.
//
// TWO NUMBERS DECIDE A PARCEL, NOT THREE. A flat platform "first item" fee used to sit
// under the per-garment bands as a second fallback, and it was unreachable: shippingBandOf
// returns ship_garment for anything it doesn't recognise, and every band carries a default,
// so the band was ALWAYS a number and the flat fee never once priced an order. It was still
// editable on the Settings screen, in a different block from the bands, showing $5 — a
// figure an admin could change all day with no effect on any invoice. Removed rather than
// documented: a setting that does nothing is worse than no setting.
//
// NB this is NOT orders.total. total is REVENUE — for an Etsy order it's the buyer's
// grandtotal (etsy.js sets it from rc.grandtotal). The old app charged o.total flat
// (orders.html), which would have billed a seller their own gross on every synced
// order. Cost comes from the catalog's base_price, never from the order's revenue.
import { q } from './db.js';
import { shippingBandOf, SETTING_DEFAULTS } from './routes/factory_settings.js';
// `tierFor` is ALIASED. pricing.js already has a tierFor — the price tier for a SIZE —
// and importing volume's under the same name is a redeclaration: the module throws at
// IMPORT time, so Fastify never listens and every /api/* route 502s, not just this one.
// Two different questions must not share a name in one module.
import { tierFor as volumeTierFor, normalizeTiers, periodKey, previousPeriod, unitsForSeller } from './volume.js';

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The per-band shipping and per-method surcharge keys, so a settings change is a pricing
// change without a deploy. Defaults come from factory_settings so the admin screen and
// the billing path can't disagree about what "unset" means.
const FEE_KEYS = [
  'ship_extra',
  'ship_cap', 'ship_heavy', 'ship_garment',
  'method_dtg', 'method_dtf', 'method_emb', 'method_apl', 'method_lsr',
  'method_scr', 'method_sub', 'method_vnl',
  // Per ADDITIONAL printed face — see sideAddOn.
  'method_side',
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

/**
 * WHAT A UNIT COST IS MADE OF — the blank, and the technique — as two numbers.
 *
 * The ladder lives here and `unitCostOf` sums it, so the split a line SHOWS and the total
 * it is CHARGED can never come from two different rules. It was called from quoteOrder
 * without ever being written: a ReferenceError inside a function throws only when the
 * function runs, so the server booted clean and every single /quote 500'd instead. The
 * Summary card swallowed that and rendered as an order with no base cost, no shipping and
 * no fees — see the note on the quote fetch in web/app/(app)/orders/[id]/page.tsx.
 *
 * `base` is null when nothing in the ladder answers — the caller's cue that the line is
 * unpriceable, never a reason to bill 0.
 */
function costPartsOf(row, item, fees) {
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
  // No base, no surcharge to report: a method fee on a line we can't price is a number
  // with nothing to sit on top of.
  return { base, method: base == null ? 0 : methodAddOn(d, item.print_type, fees) };
}

/**
 * WHAT THE EXTRA SIDES ADD, per unit.
 *
 * Charged per ADDITIONAL side, not per side. The first one is what the base cost already
 * pays for — every blank in the catalogue was priced on the assumption of one print — so
 * billing per side would have raised the price of every single-side order on the platform
 * the moment this shipped, retroactively and for nothing that changed.
 *
 * `sides` is how many faces of this line actually carry artwork, counted from order_designs.
 * 0 or 1 adds nothing, which is also what a line with no artwork yet must cost: a seller
 * who has not placed a design has not asked for a second print.
 */
function sideAddOn(sides, fees) {
  const rate = num(fees && fees.method_side) || 0;
  const extra = Math.max(0, (Number(sides) || 0) - 1);
  return rate > 0 && extra > 0 ? rate * extra : 0;
}

// Per-unit cost = the size's base price (else the product's base) + the print method's
// add-on. Mirrors productUnitPrice in eg-design-tools.js, which is what the boards show
// the seller — if these two disagree, the quote lies about the price on screen.
function unitCostOf(row, item, fees, sides = 1) {
  // The method surcharge sits ON TOP of the base cost, never inside it — so changing
  // the markup never silently changes what embroidery adds. The per-side charge sits on
  // top of both, for the same reason.
  const { base, method } = costPartsOf(row, item, fees);
  return base == null ? null : base + method + sideAddOn(sides, fees);
}

/**
 * THE SELLER'S BASE COST FOR A WHOLE PRODUCT — the highest one across its sizes.
 *
 * Exported because the CATALOGUE needs it and must not re-derive it. The lookbook is a price
 * list that goes to partners, and it was being built on `productCost` — what we PAY S&S. A 5%
 * markup over that printed $2.27 beside a blank we buy at $2.16, so anyone holding the sheet
 * could divide by 1.05 and read our supplier invoice. That is §2.9 broken by arithmetic
 * rather than by a field name.
 *
 * Built on costPartsOf, so it is the same ladder a seller is actually charged on — supplier
 * cost only ever reaches it THROUGH base_markup, which puts the invoice two markups away from
 * anything printed instead of one. A product synced from a supplier is covered by that on its
 * own: it arrives carrying productCost and nothing else, and this turns it into a base before
 * any catalogue price can be derived.
 *
 * THE HIGHEST SIZE WINS, for the same reason the old supplier-cost version did: one catalogue
 * price stands for every size, and taking the cheapest would list the largest sizes below
 * what they cost to make.
 *
 * null when nothing in the ladder answers — the caller's cue to print nothing, never to fall
 * back to a number that is really a cost.
 */
export function sellerBaseCostOf(row, fees) {
  const d = (row && row.data) || {};
  const sizes = Array.isArray(d.sizePrices) ? d.sizePrices.map((t) => t && t.size).filter(Boolean) : [];
  const candidates = sizes.length ? sizes : [null];
  let best = null;
  for (const size of candidates) {
    const { base } = costPartsOf(row, { size }, fees);
    if (base != null && (best == null || base > best)) best = base;
  }
  return best;
}

/**
 * WHAT THE BLANK COSTS US — the supplier's price, not the seller's.
 *
 * Same ladder as unitCostOf's cost branches and no other: the size's own cost first, then
 * the product's. Deliberately NOT falling back to basePrice — that is the SELL price, and
 * quietly using it as a cost would report a margin of zero on every product priced by hand
 * rather than saying "we don't know what this blank costs".
 *
 * Never leaves the building on a seller's request: the quote route strips it, for the same
 * reason sellerSafe strips productCost — it names our margin and, read across products, our
 * supplier's price list.
 */
function supplierCostOf(row, item) {
  const d = row.data || {};
  const tier = tierFor(d, item.size);
  if (tier && tier.cost != null) { const c = num(tier.cost); if (c != null && c > 0) return c; }
  const c = num(d.productCost ?? d.product_cost);
  return c != null && c > 0 ? c : null;
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

/**
 * Per-unit shipping, MOST SPECIFIC FIRST. Three steps, and the last one always answers:
 *
 *   1. the size's own fee   — a 4XL ships dearer than an S, when someone has said so
 *   2. the product's fee    — what the product card carries, if it was filled in
 *   3. its garment band     — caps / heavy / everything else, from Settings
 *
 * Step 3 cannot fail: shippingBandOf falls through to `ship_garment` for anything it
 * doesn't recognise, and every band has a default in SETTING_DEFAULTS. That is what makes
 * a fourth fallback pointless — see the note at the top of this file.
 *
 * Exported because the public catalogue quotes the same number. A second "what does this
 * ship for" rule on the marketing page would drift from the one that bills.
 */
export function shipFeeOf(row, size, fees) {
  const d = row.data || {};
  const tier = tierFor(d, size);
  if (tier && tier.shipping != null) { const s = num(tier.shipping); if (s != null) return s; }
  const own = num(d.shippingFee ?? d.shipping_fee);
  if (own != null) return own;
  // No per-size and no per-product fee → the flat band for this garment class (caps ship
  // cheaper than hoodies). SETTING_DEFAULTS is the backstop rather than a separate setting,
  // so "unset" means the same number here as it does on the Settings screen.
  const key = shippingBandOf(`${d.type || ''} ${d.name || ''}`);
  const band = num(fees[key]);
  return band != null ? band : num(SETTING_DEFAULTS[key]) || 0;
}

// The extra-item fee for additional units. A product may set its own
// (additionalItemShipping) — a second hoodie adds more weight than a second sticker —
// otherwise the platform's ship_extra applies.
/** The EXTRA-item fee for a product: its own override, else the platform default.
 *  Exported so the lookbook's price table quotes the number that actually bills — a
 *  document handed to a wholesale buyer must not carry a second, parallel fee rule. */
export function extraFeeOf(row, fees) {
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
/**
 * THE SELLER'S VOLUME RATE FOR THIS ORDER — read once, then never re-derived.
 *
 * Two sources, and the order matters. A CHARGED order answers from `orders.volume_pct`,
 * stamped by freezeQuote at the moment money moved; anything else is computed from the
 * previous period's shipped units. That is the same rule freezeQuote already applies to
 * unit_cost: once someone has been billed, the price is history, and an admin editing the
 * ladder afterwards must not be able to rewrite what a seller was charged.
 *
 * EARNED LAST MONTH, SPENT THIS MONTH (volume.js). A live rolling count would move the
 * price between adding an item and submitting the order.
 *
 * FAILS TO ZERO, ALWAYS. No ladder configured, no settings table, an unreadable row, a
 * seller we can't resolve — every one of them returns 0%, which prices exactly as this
 * module did before volume existed. The failure mode of a discount engine has to be
 * "charge the list price", never "give it away".
 */
async function volumeRateFor(orderId) {
  const none = { pct: 0, units: 0, index: 0, frozen: false };
  try {
    const r = await q('select seller_id::text as seller_id, volume_pct from orders where id=$1', [orderId]);
    const row = r.rows[0];
    if (!row) return none;
    // Already charged: the stamped rate is the fact, whatever the ladder says today.
    const frozen = num(row.volume_pct);
    if (frozen != null) return { pct: Math.min(100, Math.max(0, frozen)), units: 0, index: 0, frozen: true };
    if (!row.seller_id) return none;
    const tiers = await q('select value from settings where key=$1', ['volume_tiers'])
      .then((s) => normalizeTiers(s.rows[0]?.value || []))
      .catch(() => []);
    if (!tiers.length) return none;              // programme off — do not query orders at all
    const units = await unitsForSeller(row.seller_id, previousPeriod(periodKey(new Date())));
    const t = volumeTierFor(units, tiers);
    return { pct: t.pct, units: t.units, index: t.index, frozen: false };
  } catch {
    return none;
  }
}

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
    shipping: money(ship),
    total: cost == null ? null : money(cost + ship),
  };
}

// Quote one order. Returns every line priced, the totals, and anything unpriceable.
// `unpriced` is the caller's cue to refuse: an item with no catalog match has no cost,
// and charging 0 for it would fulfil it for free — silently, forever.
export async function quoteOrder(orderId) {
  const [items, fees, idx, sideRows] = await Promise.all([
    q('select id, sku, name, qty, size, blank, print_type, unit_cost, ship_fee, line_id from order_items where order_id=$1 order by id', [orderId]).then((r) => r.rows),
    feeSettings(),
    catalogIndex(),
    /**
     * HOW MANY FACES EACH LINE PRINTS, counted from the artwork itself rather than from a
     * number somebody typed. A side exists when there is a design on it; nothing else can
     * make one true.
     *
     * Keyed exactly the way order_designs is — line first, sku only for rows written before
     * line_id existed — so a line and its same-sku sibling are counted apart. Best-effort:
     * a deployment that has not run the side migration yet answers nothing, and a missing
     * count must charge for ONE side, never for none and never for more.
     */
    q(`select coalesce('L:' || line_id, 'S:' || sku) as key, count(distinct coalesce(side,'front'))::int as sides
          from order_designs where order_id=$1 group by 1`, [orderId])
      .then((r) => r.rows).catch(() => []),
  ]);
  const sidesByKey = new Map(sideRows.map((r) => [r.key, r.sides]));
  const sidesOf = (it) => sidesByKey.get(it.line_id ? `L:${it.line_id}` : `S:${it.sku}`) ?? 1;
  const lines = [];
  const unpriced = [];
  for (const it of items) {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const sides = sidesOf(it);
    // A frozen cost wins: once charged, an order's price is history and must not move
    // when someone edits the catalog — which is also what stops artwork added to a second
    // side AFTER submit from silently re-pricing an order that has already been paid for.
    let cost = num(it.unit_cost), ship = num(it.ship_fee);
    let extra = fees.ship_extra;
    if (cost == null || ship == null) {
      const row = matchProduct(idx, it);
      // No product = no cost. The variants haven't been chosen yet (a marketplace order
      // arrives with none), so the caller must ask for them rather than invent a price.
      if (!row) { unpriced.push({ sku: it.sku || '(no sku)', name: it.name || '', reason: 'no-product' }); continue; }
      if (cost == null) cost = unitCostOf(row, it, fees, sides);
      if (ship == null) ship = shipFeeOf(row, it.size, fees);
      extra = extraFeeOf(row, fees);
      if (cost == null) { unpriced.push({ sku: it.sku || '(no sku)', name: it.name || '', reason: 'no-cost' }); continue; }
    }
    // The supplier's price for this blank, when the catalogue knows it. Read even for a
    // frozen line: the sell price is history once charged, but what we PAID is a fact
    // about the blank and is what any margin figure has to be measured against.
    const srow = matchProduct(idx, it);
    const supplier = srow ? supplierCostOf(srow, it) : null;
    // What the unit cost is MADE OF. Read from the catalogue even on a frozen line: the
    // split is a fact about the product and the technique, and showing it is the only way
    // a $13.50 blank quoting $18.50 stops looking like two different prices.
    const parts = srow ? costPartsOf(srow, it, fees) : { base: null, method: 0 };
    lines.push({ id: it.id, sku: it.sku, name: it.name, qty, size: it.size, blank: it.blank,
                 unitCost: money(cost), shipFee: money(ship), extraFee: money(extra),
                 baseCost: parts.base == null ? null : money(parts.base),
                 methodFee: money(parts.method || 0),
                 // What the line is PRINTED on, and what the extra faces added. Shown as its
                 // own number for the same reason methodFee is: a blank quoting more than
                 // its base cost has to be able to say which surcharge did it.
                 sides, sideFee: money(sideAddOn(sides, fees)),
                 supplierCost: supplier == null ? null : money(supplier) });
  }
  const volume = await volumeRateFor(orderId);
  const totals = computeTotals(lines, fees, volume.pct);
  // Null when NOTHING is known — "$0.00 of blanks" and "we don't know" are different
  // answers, and only one of them should be subtracted from anything.
  const known = lines.filter((l) => l.supplierCost != null);
  const supplierTotal = known.length ? money(known.reduce((s, l) => s + l.supplierCost * l.qty, 0)) : null;
  return {
    lines, unpriced, fees, supplierTotal, supplierKnown: known.length,
    // What EARNED the rate, so a seller reading a discount can see where it came from
    // rather than finding an unexplained deduction. Absent on a frozen quote, because the
    // stamped rate is all we know about a charge that already happened — reporting this
    // month's units beside last month's charged rate would invite the two to be read as
    // one statement.
    volumeUnits: volume.frozen ? null : volume.units,
    volumeTier: volume.frozen ? null : volume.index,
    volumeFrozen: volume.frozen,
    ...totals,
  };
}

// The money formula, kept pure and exported so it can be tested without a database:
//   subtotal = Σ((base for its size + print-method add-on) × qty)
//   shipping = the DEAREST line's fee + that product's extra-item fee for every other UNIT
//   discount = subtotal × the seller's volume rate
//   total    = subtotal + shipping − discount
// Note "unit", not "line": 3× of one tee is 3 units in one parcel, so it pays one
// shipping fee and two extra-item fees — not one extra fee for being a single line.
//
// THE DISCOUNT COMES OFF THE GOODS, NOT THE POSTAGE. Volume says a seller earned a better
// price on what we make; it says nothing about what a courier charges us to move it, and
// discounting shipping would quietly sell parcels below cost on exactly the accounts
// sending the most of them.
//
// It is also NEVER folded into unitCost. A per-line discount would be frozen onto the line
// by freezeQuote and then discounted AGAIN by the next quote that read it back — the
// compounding kind of bug that is invisible until someone reconciles a month. Lines carry
// the list price, the rate is stored once on the order, and the discount is derived.
export function computeTotals(lines, fees, volumePct = 0) {
  const subtotal = money(lines.reduce((s, l) => s + l.unitCost * l.qty, 0));
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const pct = Math.min(100, Math.max(0, Number(volumePct) || 0));
  const volumeDiscount = money(subtotal * (pct / 100));
  if (!units) return { subtotal, shipping: 0, units: 0, volumePct: pct, volumeDiscount: 0, total: subtotal };
  /**
   * THE DEAREST LINE SETS THE RATE, not the first one typed.
   *
   * This used to take lines[0], which is whichever line someone happened to add first. A
   * beanie and a hoodie in one box came to $7.99 of postage if the beanie was entered
   * first and $11.99 if the hoodie was — the same parcel, four dollars apart, decided by
   * typing order, with nothing on screen to explain it. Re-entering the same order the
   * other way round changed the price.
   *
   * The parcel is sized by the biggest thing in it, so the highest fee is both the more
   * accurate answer and the one that cannot under-charge us. It is also deterministic:
   * the same basket now always costs the same, whatever order it was built in.
   *
   * The extra-item rate comes from that same line, so the two halves of the shipping
   * figure describe one product rather than two — and a product carrying its own
   * additionalItemShipping still overrides the platform default, as before.
   */
  const first = lines.reduce((a, b) => (num(b.shipFee) > num(a.shipFee) ? b : a), lines[0]);
  const extra = first.extraFee != null ? first.extraFee : (fees.ship_extra || 0);
  const shipping = money(first.shipFee + extra * (units - 1));
  // Floored at zero. A 100% ladder rung is a real thing an admin can save, and a negative
  // total would be a CREDIT — moveFunds would pay the seller to place an order.
  const total = Math.max(0, money(subtotal + shipping - volumeDiscount));
  return { subtotal, shipping, units, volumePct: pct, volumeDiscount, total };
}

// Freeze the quoted prices onto the items, so the charge is reproducible and a later
// catalog edit can never rewrite what someone was already billed.
export async function freezeQuote(orderId, quote) {
  for (const l of quote.lines) {
    await q('update order_items set unit_cost=$1, ship_fee=$2 where id=$3', [l.unitCost, l.shipFee, l.id]).catch(() => {});
  }
  /**
   * The RATE, stamped beside the line prices, for the same reason they are: it is an input
   * to a charge that has now happened.
   *
   * Written even when it is 0, and that is the point — 0 is a real answer ("this seller
   * earned no discount"), and leaving the column null would make a re-quote go and ask the
   * ladder again. If someone adds a tier next week, that order would silently re-price
   * itself downward on the next read, and a refund computed from it would return more than
   * was ever taken.
   *
   * `where volume_pct is null` so a re-freeze cannot move a stamped rate.
   */
  await q('update orders set volume_pct=$1 where id=$2 and volume_pct is null',
          [money(quote.volumePct || 0), orderId]).catch(() => {});
}
