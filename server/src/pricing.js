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
import { shippingBandOf, SETTING_DEFAULTS, PRICED_SIDES, PLACEMENT_KEYS } from './routes/factory_settings.js';
// `tierFor` is ALIASED. pricing.js already has a tierFor — the price tier for a SIZE —
// and importing volume's under the same name is a redeclaration: the module throws at
// IMPORT time, so Fastify never listens and every /api/* route 502s, not just this one.
// Two different questions must not share a name in one module.
import { tierFor as volumeTierFor, normalizeTiers, periodKey, previousPeriod, unitsForSeller } from './volume.js';
import { bySize } from './routes/sanmar.js';   // the ONE size ladder — see offeredSizes below

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * EVERY FACE THAT CAN CARRY A PRICE — the same eight ALL_SIDES declares in
 * web/lib/variant-resolve.ts, and in the same order, because that order decides which face is
 * the INCLUDED one when a line prints several. A ninth added there needs one here; the two
 * lists are checked against each other by tools/check-faces.mjs.
 */
/* DEFINED WHERE THE WRITER IS, and re-exported here so every existing importer is unchanged.
   Two lists is what made the per-face grid dead: this file read `side_<face>` while
   factory_settings' KEYS never contained them, so Settings posted the values and the write
   loop skipped every one. A key that can be read is now writable by construction. */
export { PRICED_SIDES, METHOD_KEYS } from './routes/factory_settings.js';

// The per-band shipping and per-method surcharge keys, so a settings change is a pricing
// change without a deploy. Defaults come from factory_settings so the admin screen and
// the billing path can't disagree about what "unset" means.
const FEE_KEYS = [
  'ship_extra',
  'ship_cap', 'ship_heavy', 'ship_garment',
  'method_dtg', 'method_dtf', 'method_emb', 'method_apl', 'method_lsr',
  'method_scr', 'method_sub', 'method_vnl',
  // Per ADDITIONAL printed face — the FLAT rate, and now the fallback for any face with no
  // rate of its own. See sideAddOn.
  'method_side',
  /**
   * PER FACE, because a sleeve is not a back.
   *
   * sideAddOn charged one rate for every additional face, and its own note said why: faces
   * reached pricing as a COUNT, aggregated long before it, so charging them apart would mean
   * threading the names through. They are threaded now.
   *
   * UNSET FALLS BACK TO method_side, which is what makes this safe to ship: a floor that has
   * never opened the new grid prices exactly as it did yesterday, and no existing order moves
   * by a cent. A face only costs its own rate once somebody sets one.
   */
  ...PLACEMENT_KEYS,
  /**
   * PER TECHNIQUE, because a printed back is not an embroidered back.
   *
   * A placement billed one flat figure however the face was decorated, so a second DTG pass
   * on a garment already loaded cost the same as a fresh hooping — which is what made "front
   * and back" on a printed tee read as far too expensive (owner, 2026-09-21).
   *
   * UNSET FALLS THROUGH to the per-face rate and then to method_side, exactly as the per-face
   * grid does, so a floor that never opens these boxes prices as it did yesterday.
   */
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

/**
 * THE PRICING INDEX, AND WHY IT CAN LEAVE THE PICTURES BEHIND.
 *
 * `data` carries the product's images as base64 `data:` URLs. Measured on the live box:
 * 6.98MB across 35 rows, 65ms to read and parse — and that was being paid on EVERY
 * /api/orders, because attachCost() prices each line against this index. Nothing in this
 * file reads an image; the index is skus, prices and names.
 *
 * `withImages: false` drops those keys in SQL, so the bytes never reach node at all:
 * 65ms -> 13ms. Opt-IN, because the replenishment cart genuinely reads them to put a
 * colourway photo on a parked line (replenish.js), and a default that quietly emptied
 * `img` would blank those tiles with nothing to say why.
 */
export async function catalogIndex({ withImages = true } = {}) {
  let rows = [];
  const dataCol = withImages ? 'data' : "(data - 'img' - 'images' - 'side_mockups') as data";
  try { rows = (await q(`select id, sku, base_price, ${dataCol} from catalog_products`)).rows; } catch { return { exact: new Map(), rows: [] }; }
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
/** Exported so replenishment can put the product's NAME and its colourway PHOTO on a parked
 *  line. A cart row that reads "EG-1009-2XL-BLACK" with an empty tile is a sku, not a thing
 *  somebody can recognise before spending money on it. */
/**
 * THE BLANK CELL ARRIVES AS "SKU - NAME", AND THIS IS WHY NOTHING COULD BE PRICED.
 *
 * The order grid and the import sheet both offer `5000 - Gildan Unisex Heavy Cotton™ T-Shirt`
 * as one string, deliberately: a catalogue holds near-identical names and the sku is the half
 * that tells them apart while you are picking, and Google Sheets validation has no
 * label-vs-value at all — the cell holds the option text. So that is what reaches
 * `order_items.blank`, and those lines carry NO sku of their own.
 *
 * web/lib/variant-resolve.ts learned to split it. This did not. The line therefore resolved
 * for DISPLAY — right picture, right name, right variant strip — and matched nothing here, so
 * quoteOrder filed it under `unpriced: no-product` and every figure downstream went missing at
 * once: "Not priced · pick a blank first" on the row, "not charged yet" in the Summary, $0.00
 * in the queue, and no stock sku for replenishment. Measured on production: three of the four
 * most recent manual orders carry a composite blank and a null unit_cost, while the older rows
 * with a bare name and a sku price normally.
 *
 * THE WHOLE STRING IS TRIED FIRST and the split is only a fallback, which is what keeps a
 * product whose NAME contains " - " resolving as it always did — splitting first would turn
 * "Adidas - Performance Polo" into a search for a product called "Adidas".
 *
 * MIRRORS blankCandidates in web/lib/variant-resolve.ts. tools/check-blank-resolve.mjs runs
 * both against the same fixtures, because this pair has now drifted once and reading them
 * side by side is exactly what missed it.
 */
function blankCandidates(cell) {
  const out = [cell];
  const at = cell.indexOf(' - ');
  if (at > 0) { out.push(cell.slice(0, at).trim(), cell.slice(at + 3).trim()); }
  /* THE `EG-` MAY BE PAINT — see the same block in web/lib/variant-resolve.ts. ourSku()
     prints a bare-numeric sku as `EG-5000`, and the sheet's dropdown text is the cell that
     comes back, so the number on its own has to be a candidate too. */
  for (const c of [...out]) {
    const m = /^EG-(\d+)$/i.exec(c);
    if (m) out.push(m[1]);
  }
  return out.filter(Boolean);
}

/**
 * OUR CODE, OR NOTHING — never the supplier's. MIRRORS ourSku() in web/lib/variant-resolve.ts.
 *
 * `catalog_products.sku` is meant to hold the code WE assigned (`EG-1002`), with the vendor's
 * part number kept apart in `supplierSku`. On 8 of 30 live products it does not — a supplier
 * import wrote the vendor's own code into it, so everything printing a sku was printing
 * OTTO's and S&S's part numbers: the sheet's Blank Product dropdown, the grid, every variant
 * strip. §2.9 in its quietest form — not a field called `supplier`, just a number that pastes
 * into a distributor's search box.
 *
 * DISPLAY ONLY. Nothing routes on it: stock is still held against `sku`, matchProduct still
 * matches on it, and a line already carrying "10892 - Adams Headwear LP104" still resolves,
 * because both resolvers try the whole string and then each half.
 */
/* A BARE NUMBER IS OURS, PRINTED `EG-5000` (owner, 2026-09-21). MIRRORS ourSku() in
   web/lib/our-sku.ts, where the reasoning is written out. Prefixed for DISPLAY only —
   nothing on this side moves: stock stays keyed on `5000` and the catalog row is untouched.
   A part number has shape (100-632-120342, 10-271-016-SM); a bare integer has none, so the
   two are told apart by that and §2.9 still withholds the former. */
const BARE_NUMBER = /^\d+$/;

export function ourSku(sku) {
  const s = String(sku == null ? '' : sku).trim();
  if (/^EG-/i.test(s)) return s;
  return BARE_NUMBER.test(s) ? `EG-${s}` : '';
}

export function matchProduct(idx, item) {
  const blank = String(item.blank || '').trim();
  if (blank) {
    for (const cand of blankCandidates(blank.toLowerCase())) {
      const hit = idx.rows.find((r) => {
        const d = r.data || {};
        /*
         * THE SUPPLIER'S CODE AND THE FORMER NAMES, because the client matches both and a
         * line that resolves on the screen must resolve here or it prices at zero.
         *
         *   supplierSku — the web resolver has always matched it and this did not, so a
         *                 blank naming the supplier's style number resolved for DISPLAY and
         *                 not for PRICE. Same class of bug as the composite blank above.
         *   nameAliases — what the product used to be called. A rename (the brand split runs
         *                 one in bulk) otherwise strands every line placed before it.
         *
         * MIRRORS resolveProduct in web/lib/variant-resolve.ts — tools/check-blank-resolve.mjs
         * runs both implementations over the same fixtures for exactly this reason.
         */
        return [d.name, r.sku, d.sku, r.id, d.id, r.supplier_sku, d.supplierSku, ...(Array.isArray(d.nameAliases) ? d.nameAliases : [])]
          .some((v) => v != null && String(v).trim().toLowerCase() === cand);
      });
      if (hit) return hit;
    }
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
function costPartsOf(row, item, fees, faces = null) {
  const d = row.data || {};
  /* THE METHODS ACTUALLY ON THIS GARMENT, the line's own as the floor. A face says nothing
     when it agrees with its line (order_designs.method is null), so the line's value is what
     every face resolves to until one disagrees. */
  const faceMethods = (Array.isArray(faces) ? faces : [])
    .map((f) => (f && typeof f === 'object' ? String(f.method || '').trim() : ''))
    .filter(Boolean);
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
  /**
   * A BLANK IS ITS OWN PRICE, when someone has set one.
   *
   * Sometimes an order is just the garment — no print — and charging the printed base for
   * it overcharges the seller for work nobody did. The number lives on the size tier
   * (`blank`), beside the base cost, because a blank is the same garment in the same size
   * with nothing done to it: a column, not a second variant dimension.
   *
   * TWO GUARDS, and both matter. It applies only when the line names NO print method — a
   * line that says DTG is not a blank whatever else is true — and only when the tier holds
   * a real positive number. Products with no blank price behave exactly as they did, which
   * is what keeps this from silently repricing the whole catalogue the day it ships.
   */
  /**
   * A BLANK IS SAID, NOT INFERRED (owner, 2026-09-18).
   *
   * This read an EMPTY method as "no print wanted", which conflated two states that are not
   * the same and price differently:
   *
   *   · nobody has decided yet  — every marketplace line arrives like this (§5: only the
   *                               factory's own picks pre-fill), and it WILL be printed
   *   · this is a bare garment  — a real product we sell, at the size's own `blank` price
   *
   * So an imported Etsy hoodie destined for embroidery quoted the BARE GARMENT price on any
   * product that had one — an under-charge that grew more likely the moment Blank became a
   * first-class option and people started filling those columns in.
   *
   * `print_type = 'BLANK'` is now the only way to say it, and nothing else in the pipeline
   * has to learn the word: methodAddOn finds no surcharge key for it and returns 0,
   * isEmbroidery does not match it, and normalizeMethods leaves it alone. An undecided line
   * falls through to the base cost, which is the safe direction to be wrong in.
   *
   * THE FACE CHECK STAYS. A line's own column can be empty while a FACE names a method — an
   * import where every Type sits in a placement block — and a line whose back says Embroidery
   * is not a blank whatever its own column says.
   */
  /**
   * THE GARMENT'S OWN PRICE IS THE BASE, for every line (owner, 2026-09-18).
   *
   * The model is three separate numbers now and nothing is bundled into another:
   *
   *     price = blank  +  Σ per face ( placement + that face's method )
   *
   * `blank` is the garment. `sidePrice` is what printing a face is worth. `methodPrices` is
   * what the technique adds. Base cost used to carry the garment AND one print AND the print's
   * whole margin in one figure, which is why nobody could read margin off a line without
   * knowing which face had been free — the thing this set out to fix.
   *
   * A BLANK LINE NEEDS NO SPECIAL CASE ANY MORE, which is how you can tell the model is right:
   * it is simply a line with no printed face and no technique, so it lands on `blank` and stops
   * there. `isBlankLine` existed only because base cost included a print that a bare garment
   * had to be rescued from.
   *
   * MEASURED BEFORE SHIPPING, because this reprices real products: of 28 catalogue rows, 5
   * carry a blank price and 3 already carry a placement charge. The other 23 have no blank
   * price and fall straight through to the ladder below, priced exactly as they were — so the
   * change can only reach products somebody has deliberately begun pricing this way.
   */
  if (tier && tier.blank != null) { const bl = num(tier.blank); if (bl != null && bl > 0) base = bl; }
  /* LEGACY, and the only reason base cost is still read at all: a product nobody has given a
     blank price to has no other statement of what the garment costs. It errs HIGH — it still
     contains a print — which is the safe direction while the catalogue is migrated. */
  if (base == null && tier && tier.price != null) { const p = num(tier.price); if (p != null && p > 0) base = p; }
  if (base == null && tier && tier.cost != null) { const c = num(tier.cost); if (c != null && c > 0) base = c + markup; }
  /**
   * ZERO IS NOT A PRICE — it is an empty field, and this rung was the one place that forgot.
   *
   * Every other rung in this ladder already requires `> 0`; this one took whatever `base_price`
   * held. A supplier sync writes the row with `productCost` filled in and `base_price` left at
   * 0 until somebody prices it, so 0 came through as a real base of zero, the productCost rung
   * underneath it never ran, and the line quoted — and would have CHARGED — $0.00 for a garment
   * we pay $6.08 for.
   *
   * Measured on production 2026-08-24: 6 of 30 catalogue products sit at base_price 0 with a
   * real productCost, and every one of them quoted zero. Nothing had been billed at zero yet
   * only because those lines could not be quoted at all until the blank-resolution fix earlier
   * today — which means this was armed, not dormant, the moment that shipped.
   *
   * With 0 treated as unset, the ladder falls through to productCost + base_markup, which is
   * exactly what that rung exists for. A product with NOTHING priced still ends at base = null,
   * so the line lands in `unpriced` and the submit button refuses it — a visible "price this
   * blank first" instead of a silent free order.
   */
  if (base == null) { const b = num(d.basePrice ?? d.base_price ?? row.base_price); if (b != null && b > 0) base = b; }
  if (base == null) { const c = num(d.productCost ?? d.product_cost); if (c != null && c > 0) base = c + markup; }
  // No base, no surcharge to report: a method fee on a line we can't price is a number
  // with nothing to sit on top of.
  /* The dearest face's method, falling back to the line's own for a caller that has no faces
     (the order list prices hundreds of lines and does not read artwork) and for every line
     written before faces could carry one. */
  const billed = billingMethodOf(faceMethods, d, fees) || item.print_type;
  return { base, method: base == null ? 0 : methodAddOn(d, billed, fees), billedMethod: billed || null };
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
/**
 * A PRODUCT MAY SET ITS OWN RATE, exactly as it may for a print method.
 *
 * `method_side` is one platform number for every blank, and a second print is not the same
 * job on a cap as it is on a hoodie — a back panel and a crown are different setups on
 * different machines. `methodPrices` already lets a product override what its METHOD costs;
 * this is the same escape hatch for its extra faces, and it was the only half missing.
 *
 * Same precedence and the same test as methodAddOn: the product's figure when it is a real
 * number above zero, else the platform's. A stored 0 therefore falls through rather than
 * meaning "free" — deliberate, because `methodPrices` behaves that way and one of the two
 * reading zero differently is worse than neither supporting it.
 *
 * PER FACE, AND IT HAS BEEN SINCE THE FACE NAMES WERE THREADED THROUGH.
 *
 * This paragraph used to say the opposite — "ONE RATE PER PRODUCT, not one per face… `sides`
 * reaches here as a COUNT… Worth doing if it is asked for; not something to fake" — and it
 * was true when written and false by the time anyone read it. `priceLines` hands sideAddOn
 * NAMES now (it still tolerates a count), so all three tiers below are live:
 *
 *   d.sidePrice as a MAP   per product, per face      highest precedence
 *   fees.side_<face>       per platform, per face     e.g. side_back, side_sleeve
 *   d.sidePrice as a NUMBER / fees.method_side        the flat "each additional side"
 *
 * Measured against a real database: base $10 + embroidery $5, with side_back $3.50 and
 * side_sleeve $1.50 — front alone $15.00, front+back $18.50, front+sleeve $16.50,
 * front+back+sleeve $20.00, and a face with no override falling to the $2.00 flat at $17.00.
 *
 * ALL THREE TIERS HAVE AN EDITOR, and this comment used to say the opposite. It read "what
 * is actually missing is the editor… the per-face rates can only be set by writing fee keys
 * directly", which was true when written and has not been for a while:
 *
 *   Settings › Pricing   "Each additional side" writes method_side, and the grid of eight
 *                        faces beneath it writes side_<face>. Each face box shows the flat
 *                        figure as a greyed placeholder, so an empty one reads as "this rate".
 *   Product › Placement  the per-face boxes on the blank itself write d.sidePrice.
 *
 * It cost real time: the stale line was quoted back twice as "you can only do this in SQL",
 * and an owner set a rate by hand that the UI had a field for. A comment describing what is
 * MISSING is the kind that rots silently — nothing fails when the gap is filled — so if a
 * tier ever does lose its editor, say which and date it.
 */
/**
 * WHAT ONE FACE COSTS — the three tiers, in one place.
 *
 * Lifted out because the DESIGNER needs it too. Its face rail prints "+$4.00" on a tile
 * before anyone commits to printing there, and it was reading `fees.side_<face>` and
 * `fees.method_side` only — so a product carrying its own per-face map showed the platform
 * flat rate on every face while the charge used the map. The rail's own note forbids exactly
 * that: telling a seller +$3.00 on a face that actually adds $5.00 is worse than telling
 * them nothing, because they are quoted a price and then meet a different one.
 */
/**
 * A PLACEMENT'S PRICE DEPENDS ON HOW THE FACE IS DECORATED (owner, 2026-09-21).
 *
 * One flat figure billed an embroidered back and a DTG-printed back the same, and they are
 * not the same work: the printed one is a second pass on a garment already loaded, the
 * embroidered one is a fresh hooping with somebody standing there. So "front and back" on a
 * printed tee was charged at embroidery money, which is what the owner reported as the
 * pricing feeling far too high on extra faces.
 *
 * COUNTING DID NOT CHANGE — every face still bills once. Only what each one costs does.
 *
 * The ladder, first answer wins:
 *
 *   ownMap[face]        this PRODUCT, this FACE      a hoodie's back
 *   ownMap[METHOD]      this PRODUCT, this TECHNIQUE embroidery on this blank
 *   fees.side_<face>    platform, this FACE          a sleeve everywhere
 *   fees.side_<method>  platform, this TECHNIQUE     every DTG placement
 *   flat                method_side                  what everything did before
 *
 * FACE BEATS METHOD, because it is the more specific statement about this garment — a sleeve
 * is awkward whatever is put on it. And an UNSET rate still falls through to the flat one, so
 * a floor that never opens the new boxes prices exactly as it did yesterday and no existing
 * order moves by a cent.
 *
 * `> 0` at every rung for the same reason the rest of this file uses it: zero is an empty
 * field, not a price. A genuinely free placement is what the flat rate at 0 is for.
 */
function faceRate(face, ownMap, flat, fees, mkey) {
  const perProduct = ownMap ? num(ownMap[face]) : null;
  if (perProduct != null && perProduct > 0) return perProduct;
  /* Both spellings: methodPrices is keyed EMB/DTG and a sidePrice map is hand-typed, so a
     lower-case `dtg` beside a `back` is the likelier thing for somebody to write. */
  const ownMethod = ownMap && mkey ? (num(ownMap[mkey]) ?? num(ownMap[String(mkey).toLowerCase()])) : null;
  if (ownMethod != null && ownMethod > 0) return ownMethod;
  const perPlatform = num(fees && fees[`side_${face}`]);
  if (perPlatform != null && perPlatform > 0) return perPlatform;
  const platMethod = mkey ? num(fees && fees[`side_${String(mkey).toLowerCase()}`]) : null;
  if (platMethod != null && platMethod > 0) return platMethod;
  return flat;
}

/**
 * EVERY FACE'S RATE for one product, whether or not it is printed yet.
 *
 * sideBreakdown answers about the faces a line HAS; this answers about the faces it COULD
 * have, which is what a picker has to show. Same resolver, so the number on the tile is the
 * number on the invoice.
 */
export function sideRates(fees, d, lineMethod = null) {
  const own = d ? d.sidePrice : null;
  const ownMap = own && typeof own === 'object' ? own : null;
  const ownFlat = num(own);
  const flat = (ownFlat != null && ownFlat > 0 ? ownFlat : num(fees && fees.method_side)) || 0;
  /* THE LINE'S TECHNIQUE, because that is what an unplaced face would be decorated with. The
     rail must quote the number the invoice will charge, and a placement's price now depends
     on the method — quoting the flat rate on a DTG tile and billing embroidery is exactly the
     mismatch this function's own note forbids. */
  const mkey = methodKey(lineMethod);
  const out = {};
  for (const face of PRICED_SIDES) {
    const r = faceRate(face, ownMap, flat, fees, mkey);
    if (r > 0) out[face] = money(r);
  }
  return out;
}

function sideDetail(faces, fees, d, lineMethod = null) {
  /**
   * EVERY FACE IS CHARGED (owner, 2026-09-18). One used to be inside the blank's price.
   *
   * The exception was defensible and it cost more than it saved: the summary had to name a
   * face at zero and then explain WHY — a pricing rule nobody can infer from a list of the
   * others — and margin on a line could not be read off its own rows without knowing which
   * surface was the free one. One rule reconciles against the order page and against profit
   * without a footnote.
   *
   * WHAT THIS CHANGES: a one-face line now carries a surface charge where it carried none.
   * Charged orders are untouched — unit_cost and cost_parts are stamped at submit and this
   * never re-reads them — so history keeps the price it was billed at, which is the only
   * behaviour §"recorded history never changes silently" allows.
   *
   * PRICED_SIDES order still decides the ORDER of the parts, so a breakdown lists faces the
   * same way every time rather than in order_designs insertion order — which is when somebody
   * happened to upload, not a fact about the garment.
   *
   * A per-product `sidePrice` still overrides everything, and a MAP overrides per face — the
   * number stays valid and means "every face", which is what every product carries today.
   */
  /* FACES ARRIVE AS NAMES OR AS {side, method} — priceLines hands objects, the lookbook and
     quoteSpec hand names (see unitCostOf's note). The METHOD is kept here now, because the
     summary has to say which surface of which item cost what, and a face's technique is half
     of that sentence. Names-only callers get an empty method and the old behaviour exactly. */
  const pairs = (Array.isArray(faces) ? faces : [])
    .map((f) => (f && typeof f === 'object'
      ? { side: String(f.side || '').toLowerCase(), method: String(f.method || '').trim() }
      : { side: String(f || '').toLowerCase(), method: '' }))
    .filter((f) => f.side);
  const methodOf = new Map();
  for (const f of pairs) if (f.method && !methodOf.has(f.side)) methodOf.set(f.side, f.method);
  const list = pairs.map((f) => f.side);
  const uniq = [...new Set(list)];
  if (!uniq.length) return null;
  const ordered = uniq.slice().sort((a, b) => {
    const ia = PRICED_SIDES.indexOf(a); const ib = PRICED_SIDES.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const own = d ? d.sidePrice : null;
  const ownFlat = num(own);
  const ownMap = own && typeof own === 'object' ? own : null;
  const flat = (ownFlat != null && ownFlat > 0 ? ownFlat : num(fees && fees.method_side)) || 0;
  /**
   * ONE PLACEMENT PER LINE, NOT ONE PER FACE (owner, 2026-09-21, reversing the 2026-09-18
   * rule that every face is charged).
   *
   *   first face      blank + placement + its design fee
   *   every face after                    its design fee only
   *
   * The owner's words: "only one face should be charged with face fees on top of blank and
   * design fees. then second face onwards should only be design fee for that face, not more
   * face fees."
   *
   * WHY THE REVERSAL IS COHERENT. What a second face really costs is the WORK of digitising
   * or preparing another picture, and the design fee already bills exactly that — per design,
   * once, whatever the quantity. Charging a placement on top billed the same additional
   * artwork twice under two names, and on a one-unit order the two were the same size, which
   * is what made it read as a double charge.
   *
   * THE FIRST FACE IN PRICED_SIDES ORDER carries it, not the dearest and not the first
   * uploaded: `ordered` is already sorted, so the same garment is charged the same way
   * whatever sequence somebody happened to place the artwork in. A line printed only on the
   * sleeve pays the sleeve's rate, because it is that line's first face.
   *
   * THE FREE FACES ARE STILL LISTED, at zero. Dropping them would hide from the summary that
   * the garment prints on three surfaces, and §4's "a zero is an answer" is the whole point
   * here — the row says the face exists AND that it added nothing.
   *
   * CHARGED ORDERS DO NOT MOVE. unit_cost and cost_parts are stamped at submit and this never
   * re-reads them, so an order billed under the old rule keeps the price it was billed at.
   */
  /**
   * AN EXTRA FACE PAYS FOR ITS OWN MACHINE RUN (owner, today: "per added design on another
   * face, we will charge the method fees… for my previous models the extra design per face
   * will be based on the methods, so it was easier to calculate").
   *
   * The third statement of this rule, and it lands back on the model costPartsOf has
   * described all along — `price = blank + Σ per face ( placement + that face's method )` —
   * with the one amendment 2026-09-21 made and this keeps: the PLACEMENT is paid once.
   *
   *   first face       placement + its method
   *   every face after              its method
   *
   * WHY THE METHOD AND NOT THE PLACEMENT. They are different purchases. A placement is the
   * setup — hooping, aligning, one act per garment however many surfaces it ends up with —
   * so charging it per face billed one act several times, which is what read as a double
   * charge in September. The METHOD is the run: a second embroidered face is a second pass
   * through the machine, and it costs what the first one did.
   *
   * WHICH IS ALSO WHY IT IS EASY TO READ. Every face after the first is its technique's
   * price, the same number on every one of them, and a garment printed three times shows
   * three figures a person can add up without knowing which face was free.
   *
   * THE FIRST FACE'S METHOD IS NOT HERE. costPartsOf charges it once as `method`, and
   * unitCostOf is base + method + sideAddOn — so adding it again on face one would bill the
   * first run twice. The client attaches that figure to the billed face, which is why the
   * front reads placement + method while the rest read method alone.
   *
   * CHARGED ORDERS DO NOT MOVE: unit_cost and cost_parts are stamped at submit and nothing
   * here re-reads them.
   */
  const parts = [];
  let charged = false;
  for (const face of ordered) {
    /* THE FACE'S OWN TECHNIQUE, else the LINE's. A face that says nothing is decorated the
       way the line is, which is the same inheritance every other reader of this column uses —
       and getting it wrong here is a wrong PRICE now that the rate follows the method. */
    const tech = methodOf.get(face) || lineMethod;
    const rate = faceRate(face, ownMap, flat, fees, methodKey(tech));
    /* The face's own technique when it has one, else null — NOT the line's. A face that says
       nothing inherits, and the caller already knows the line's method; filling it in here
       would make an inherited face indistinguishable from one somebody chose. */
    const amount = charged ? money(methodAddOn(d, tech, fees)) : money(rate);
    /**
     * WHICH KIND OF MONEY THIS IS, said rather than inferred (owner, 2026-09-23: the summary
     * should read "Front $2.00" with "DTG $3.00" under it, not one folded "Front · DTG $5.00").
     *
     * The two amounts above are different purchases that happen to be numbers in one list: the
     * first face's is a PLACEMENT — the setup, one per line — and every other is a RUN, a pass
     * through the machine for that face's technique. A client can only tell them apart by
     * assuming parts[0] is the placement, and that assumption is WRONG exactly when the first
     * face's rate is 0: `charged` does not flip, so the SECOND face is handed the placement
     * instead. A breakdown that mislabels which charge is which is the §5 defect in its
     * display form, so the producer names it.
     */
    parts.push({ face, amount, method: methodOf.get(face) || null, kind: charged ? 'run' : 'placement' });
    if (rate > 0) charged = true;
  }
  /* NO INCLUDED FACE ANY MORE, so none is named. `included` stays absent rather than null-ed
     out of habit: a CHARGED order's stamp still carries the face it had, and the summary reads
     the stamp for those — what somebody was billed does not change because the rule did. */
  return { parts, total: money(parts.reduce((n, p) => n + p.amount, 0)) };
}

/** The total, which is what a PRICE needs. Unchanged shape for every existing caller. */
export function sideAddOn(faces, fees, d, lineMethod = null) {
  const r = sideDetail(faces, fees, d, lineMethod);
  return r ? r.total : 0;
}

/**
 * WHICH FACE COST WHAT — the same computation, as a breakdown.
 *
 * `sideAddOn` returns the total because that is what a price needs; every caller that wants
 * to EXPLAIN the price needs the parts, and computing them a second time on the client is
 * how a breakdown and a charge come to disagree about one line (CLAUDE.md §5). One function
 * decides; this is the other shape of its answer.
 */
export function sideBreakdown(faces, fees, d, lineMethod = null) {
  const r = sideDetail(faces, fees, d, lineMethod);
  /* `included` is UNDEFINED on a live breakdown now — no face is. It is still a field on the
     shape because a CHARGED line's stamp carries the face it had when it was billed, and the
     summary renders that one from the stamp; a live quote simply never sets it. */
  return r ? { included: r.included ?? null, includedMethod: r.includedMethod ?? null, parts: r.parts }
           : { included: null, includedMethod: null, parts: [] };
}

// Per-unit cost = the size's base price (else the product's base) + the print method's
// add-on. Mirrors productUnitPrice in eg-design-tools.js, which is what the boards show
// the seller — if these two disagree, the quote lies about the price on screen.
function unitCostOf(row, item, fees, faces = ['front']) {
  /* THE METHODS TRAVEL WITH THE FACES NOW, and this used to strip them.
     The old note said sideAddOn "needs the face NAMES and nothing else" and mapped the
     objects down to strings — true when a placement cost one flat figure, and wrong the
     moment its rate began depending on the technique: every face would have resolved with no
     method and fallen to the flat rate, so the TOTAL charged the flat one while the
     breakdown beside it charged per method. A total that disagrees with its own parts is the
     defect §5 is about. sideDetail normalises names and pairs alike, so handing it whatever
     the caller has is safe — and callers with names only (the lookbook, quoteSpec) still
     resolve through the line's own method below. */
  // The method surcharge sits ON TOP of the base cost, never inside it — so changing
  // the markup never silently changes what embroidery adds. The per-side charge sits on
  // top of both, for the same reason.
  const { base, method } = costPartsOf(row, item, fees, faces);
  return base == null ? null : base + method + sideAddOn(faces, fees, (row && row.data) || null, item && item.print_type);
}

/**
 * WHAT ONE COSTS BY TECHNIQUE — base + that method's surcharge, or null.
 *
 * The lookbook quoted ONE unit price per style, which is the base plus whatever surcharge the
 * product's first method happens to carry. A blank offered in both DTG and embroidery has two
 * real prices and they are not close: stitches cost more than ink, which is the whole reason
 * method_emb exists. Quoting one of them and calling it "unit" understates half the sheet.
 *
 * NULL when the product does not offer that technique — the caller prints N/A. A price for a
 * method we cannot run is worse than a gap: it is a number a partner can order against.
 *
 * Exported so the catalogue does not re-derive it. methodAddOn already handles a product's own
 * override (methodPrices) before falling back to the platform rate, and a second copy of that
 * ladder is how the sheet and the invoice come to disagree.
 *
 * THE TRADE RATE IS THE BASE WHEN THERE IS ONE, and this is what it got wrong.
 *
 * This built on sellerBaseCostOf alone, while the lookbook's headline preferred catalog_price
 * — the rate a partner is quoted, set by hand or by the markup run on the Catalogue page. So
 * the two halves of one document were computed off different bases and drifted by whatever
 * the markup was. Measured on a product costing $3 with a trade rate of $7.59: the page said
 * $7.59 and the price list said $4.40 for printing, i.e. the headline was HIGHER than the
 * decorated price. Take the trade rate away and both read $4.40 — they agreed only on the
 * styles nobody had priced.
 *
 * `row.catalog_price` is that rate. The seller cost stays as the fallback, so a style with no
 * trade price is quoted exactly as it was.
 */
export function priceByMethodOf(row, fees, methods) {
  const trade = num(row && row.catalog_price);
  const base = (trade != null && trade > 0) ? trade : sellerBaseCostOf(row, fees);
  if (base == null) return { print: null, embroidery: null };
  const list = (Array.isArray(methods) ? methods : []).map((m) => String(m || '').toUpperCase());
  const has = (re) => list.some((m) => re.test(m));
  const d = (row && row.data) || {};
  // "Printing" is any ink technique the product lists — DTG first, because it is the default
  // and the cheapest, and a style offering both DTG and DTF is quoted at the one it will
  // actually be run on.
  const printTech = has(/DTG|DIRECT/) ? 'DTG' : has(/DTF/) ? 'DTF' : has(/SCR|SCREEN/) ? 'SCR'
    : has(/SUBLIM|\bDYE\b/) ? 'SUB' : has(/VINYL|HTV|VNL/) ? 'VNL' : null;
  return {
    print: printTech ? money(base + methodAddOn(d, printTech, fees)) : null,
    embroidery: has(/EMB/) ? money(base + methodAddOn(d, 'EMB', fees)) : null,
  };
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
/**
 * WHICH SIZES A PRODUCT OFFERS — the one server-side answer to that question.
 *
 * MIRRORS `sizesOf` in web/lib/variant-resolve.ts: the UNION of `data.sizes` and
 * `data.sizePrices[].size`, ordered by the one ladder (`bySize`, routes/sanmar.js, which
 * web/lib/size-order.ts mirrors in turn). Alphabetical is not an ordering here — it gives
 * "2XL, 3XL, L, M, S, XL", a scrambled list rather than a range.
 *
 * THE UNION IS THE POINT, and it is where the existing readers disagree. catalog.js takes
 * `d.sizes` ELSE sizePrices, so a product carrying both publishes only the first; the line
 * in sellerBaseCostOf below reads sizePrices ONLY. Three answers to one question is the
 * shape §4 keeps warning about — this is the definition the partner API is built on, and
 * the other two are noted rather than moved because one of them decides money and changing
 * it silently reprices the catalogue.
 *
 * An empty array means WE HAVE NOT BEEN TOLD, never "one size" — the caller decides what
 * that means, exactly as offeredSides does for faces.
 */
export function offeredSizes(row) {
  const d = (row && row.data) || {};
  const out = new Set();
  for (const s of (Array.isArray(d.sizes) ? d.sizes : [])) if (s != null && String(s).trim()) out.add(String(s).trim());
  for (const t of (Array.isArray(d.sizePrices) ? d.sizePrices : [])) if (t && t.size != null && String(t.size).trim()) out.add(String(t.size).trim());
  return [...out].sort(bySize);
}

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
/** One name per technique key methodAddOnsFor recognises — for asking about all of them. */
const ALL_TECHNIQUES = ['DTG', 'DTF', 'Embroidery', 'Applique', 'Laser', 'Screen', 'Sublimation', 'Vinyl'];

/**
 * THE SURCHARGE FOR EVERY METHOD A PRODUCT OFFERS, keyed the way the client keys them.
 *
 * The public product page quoted one price for a garment whatever technique was picked, so an
 * embroidered item under-quoted by exactly this figure — the charge applies the surcharge, the
 * page did not. This exposes it per method so the page can add it, rather than publishing a
 * size-by-method matrix that would double the payload to say the same thing.
 *
 * LOWER-CASE KEYS, deliberately: they are the same keys `normTech` produces in
 * web/lib/print-method.ts, so the page can look one up with the value it already has in hand.
 * Publishing a surcharge is safe under CLAUDE.md 2.9 — it is what a SELLER pays extra, never
 * what the blank costs us.
 */
export function methodAddOnsFor(row, fees, methods) {
  const d = (row && row.data) || {};
  const out = {};
  for (const raw of Array.isArray(methods) ? methods : []) {
    // A stored value can be a combination — "DTG printing / Embroidery" — so it is split the
    // same way the client splits it before each part is normalised.
    for (const part of String(raw || '').split(/[/,·|+]+/)) {
      const tech = part.trim();
      if (!tech) continue;
      const key = /emb/i.test(tech) ? 'emb' : /dtf/i.test(tech) ? 'dtf' : /appliqu|\bapl\b/i.test(tech) ? 'apl'
                : /laser|\blsr\b|engrav/i.test(tech) ? 'lsr' : /screen|\bscr\b/i.test(tech) ? 'scr'
                : /sublim|\bdye\b|\bsub\b/i.test(tech) ? 'sub' : /vinyl|htv|\bvnl\b/i.test(tech) ? 'vnl'
                : /dtg|direct to garment/i.test(tech) ? 'dtg' : null;
      if (!key || out[key] != null) continue;
      out[key] = money(methodAddOn(d, key.toUpperCase(), fees)) || 0;
    }
  }
  return out;
}

/**
 * WHICH METHOD A MIXED LINE IS BILLED AT — the DEAREST of its faces.
 *
 * A garment can be embroidered on the front and printed on the back, and the surcharge has
 * always been charged ONCE per line. So with two methods on one line, one of them is the one
 * the base already pays for, and "which" has to be decided by a rule or the same garment
 * prices two ways.
 *
 * CHEAPEST-INCLUDED (owner's call): the cheaper method is the one absorbed, so the line is
 * billed at the dearer. Two properties earn it:
 *
 *   · ORDER-INDEPENDENT. A max does not care which face was uploaded first, so front-EMB /
 *     back-DTG and front-DTG / back-EMB cost the same, which they must — it is one garment
 *     with the same work done to it. The alternative, "the first face recorded", is
 *     order_designs insertion order: when somebody happened to upload, not a fact about the
 *     garment. That is the bug the shipping rate had when it took lines[0].
 *   · NOTHING ALREADY BILLED MOVES. A max over one distinct value IS that value, so every
 *     single-method line — which is every line in the database today — prices to the cent it
 *     prices at now. Measured: EMB front $24.00, EMB front+back $28.50, DTG front $18.00,
 *     DTG front+back $22.50, all unchanged.
 *
 * DEAREST BY THE RESOLVER, never by a hardcoded ranking of techniques. A product's own
 * `methodPrices` can make DTG dearer than embroidery on that blank, and a table of "EMB beats
 * DTG" written here would quietly bill the cheaper one. Ties keep the first, so the answer is
 * stable rather than merely correct.
 *
 * A TRANSITION RULE, AND IT SHOULD BE SAID: it inherits an under-charge. Three embroidered
 * faces pay ONE embroidery surcharge, because that surcharge has always been per line. Mixed
 * methods make that visible as a choice rather than an accident. Charging per face is a price
 * RISE on orders people are already placing, so it is a decision and not a refactor.
 */
export function billingMethodOf(methods, d, fees) {
  let best = null, bestRate = -1;
  for (const m of methods) {
    const v = String(m || '').trim();
    if (!v) continue;
    const rate = methodAddOn(d || {}, v, fees) || 0;
    if (rate > bestRate) { bestRate = rate; best = v; }
  }
  return best;
}

/**
 * THE SURCHARGE KEY FOR A TECHNIQUE LABEL — "Embroidery" → EMB, "DTG printing" → DTG.
 *
 * Lifted out of methodAddOn because the PLACEMENT price needs the same answer now: what a
 * face costs to decorate depends on how it is decorated, and a second copy of this ladder is
 * how one of them quietly stops recognising a label the picker offers.
 *
 * Keep in step with normTech() in web/lib/print-method.ts — the picker offers these labels,
 * so every one of them must resolve to a key that has a surcharge.
 */
export function methodKey(printType) {
  const tech = String(printType || '').toUpperCase();
  if (!tech) return null;
  return /EMB/.test(tech) ? 'EMB' : /DTF/.test(tech) ? 'DTF' : /APL|APPLIQ/.test(tech) ? 'APL'
       : /LSR|LASER|ENGRAV/.test(tech) ? 'LSR' : /SCR|SCREEN/.test(tech) ? 'SCR'
       : /SUBLIM|\bDYE\b/.test(tech) ? 'SUB' : /VINYL|\bHTV\b|\bVNL\b/.test(tech) ? 'VNL'
       : /DTG|DIRECT/.test(tech) ? 'DTG' : tech;
}

function methodAddOn(d, printType, fees) {
  const tech = String(printType || '').toUpperCase();
  if (!tech) return 0;
  const k = methodKey(printType);
  /* `d` MAY BE NULL. Every caller until now reached this through costPartsOf, which is
     handed `row.data || {}`; sideDetail is handed `(row && row.data) || null` and passes it
     straight down, so a line whose product has no data row threw here the moment an extra
     face started asking for its method. A product we know nothing about has no override —
     which is the platform default, not a crash. */
  if (d && d.methodPrices) {
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
/**
 * THE SELLER'S PLAN RATE — the discount the pricing page has been SELLING.
 *
 * "20% off all blanks" is printed on the Pro card and nothing implemented it: this module
 * has never read `plan`, as the note on effectiveDiscountPct says in as many words. A seller
 * paying $29 a month for a discount that does not exist is the one pricing bug that cannot
 * be argued with, so this is the switch that note was written for.
 *
 * THE RATES ARE SETTINGS, defaulting to what we publish. A percentage typed into code is one
 * nobody can correct when the offer changes, and the offer is on a marketing page that an
 * admin already edits.
 *
 * FAILS TO ZERO, exactly like volumeRateFor: no plan, no row, an unreadable settings table
 * — all of them price at the list price. The failure mode of a discount engine is "charge
 * full", never "give it away".
 *
 * FROZEN THE SAME WAY. A charged order answers from the stamped rate (see volumeRateFor);
 * this is only ever consulted for an order nobody has paid for yet.
 */
const PLAN_DISCOUNT_DEFAULT = { starter: 0, pro: 20, enterprise: 25 };
async function planRateFor(sellerId) {
  if (!sellerId) return 0;
  try {
    const r = await q('select coalesce(plan, \'starter\') as plan from users where id=$1', [sellerId]);
    const plan = String(r.rows[0]?.plan || 'starter').toLowerCase().trim();
    if (!plan || plan === 'starter') return 0;
    const st = await q("select value from settings where key=$1", [`plan_discount_${plan}`])
      .then((x) => x.rows[0]?.value).catch(() => null);
    const set = Number(st);
    const pct = Number.isFinite(set) && set >= 0 ? set : (PLAN_DISCOUNT_DEFAULT[plan] ?? 0);
    return Math.min(100, Math.max(0, pct));
  } catch { return 0; }
}

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
/**
 * THE LADDER, WITH NO QUERIES OF ITS OWN — one implementation, two callers.
 *
 * `quoteOrder` wraps this with the two per-order reads it needs (how many sides each line
 * prints, and the volume rate). The ORDER LIST cannot afford either: it prices hundreds of
 * orders in one request, so it loads the catalogue and the fee table ONCE and calls this
 * directly with one side per line and no volume discount — which makes its figure an estimate
 * that can only ever be equal or slightly high, never low, and it is labelled as one.
 *
 * Extracted rather than copied. A third hand-written copy of this ladder is exactly how the
 * $0.00 base price and the unsplit blank survived — see tools/check-price-floor.mjs.
 *
 * @param items   order_items rows (or the list aggregate's projection of them)
 * @param idx     catalogIndex()
 * @param fees    feeSettings()
 * @param sidesOf how many faces a line prints; defaults to one
 */
export function priceLines(items, idx, fees, sidesOf = () => ['front']) {
  const lines = [];
  const unpriced = [];
  for (const it of items) {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    /* NAMES now, not a count — a sleeve and a back can cost differently. Tolerates a caller
       still handing back a number (an older embedder, or a test): it becomes that many
       unnamed faces, which prices exactly as the flat rate did. */
    const raw = sidesOf(it);
    /* THREE SHAPES, ONE NORMALISATION, AND IT HAPPENS HERE SO NOWHERE ELSE HAS TO GUESS.
       A caller may hand back {side, method} objects (quoteOrder, which reads the artwork),
       bare names (the order list, which cannot afford to), or a count (an older embedder or
       a test). `faces` stays NAMES for the side maths — sideAddOn and sideBreakdown are
       about which surface, not what is on it — and `withMethods` carries the pair for the
       one question that needs both. */
    /**
     * A BLANK ONLY LINE PRINTS NOTHING, whatever artwork is sitting on it.
     *
     * `raw` comes from order_designs — the pictures placed on the garment — so a line switched
     * to Blank Only went on being charged a placement for every face that still held one. The
     * method said undecorated and the money said printed, and the two were read off different
     * columns.
     *
     * The ARTWORK IS NOT TOUCHED. Emptying the list here prices the line as the bare garment
     * and leaves every picture exactly where it is, so switching back to DTG restores the
     * placements and their charges with nothing to redo — which is the behaviour asked for,
     * reached by not charging rather than by moving somebody's work around.
     */
    const blankOnly = /^\s*(blank(\s*only)?|no[\s-]*print)\s*$/i.test(String(it.print_type || ''));
    const rawList = blankOnly ? []
      : Array.isArray(raw) ? raw
      : Array.from({ length: Math.max(1, Number(raw) || 1) }, (_, i) => (i === 0 ? 'front' : `face-${i}`));
    const withMethods = rawList.map((f) => (f && typeof f === 'object'
      ? { side: String(f.side || 'front'), method: String(f.method || '').trim() || String(it.print_type || '').trim() }
      : { side: String(f || 'front'), method: String(it.print_type || '').trim() }));
    const faces = withMethods.map((f) => f.side);
    const sides = faces.length;
    // A frozen cost wins: once charged, an order's price is history and must not move
    // when someone edits the catalog — which is also what stops artwork added to a second
    // side AFTER submit from silently re-pricing an order that has already been paid for.
    let cost = num(it.unit_cost), ship = num(it.ship_fee);
    let extra = fees.ship_extra;
    if (cost == null || ship == null) {
      const row = matchProduct(idx, it);
      /*
       * TWO REASONS, AND THEY ASK THE READER FOR DIFFERENT THINGS.
       *
       *   no-blank      nothing named at all — a marketplace order arrives with no variants,
       *                 so there is nothing to price yet. The seller picks one.
       *   unknown-blank a blank IS named and catalog_products has no row for it. Typing a
       *                 supplier's style into an import sheet does exactly this. OURS to fix:
       *                 the blank has to exist in our catalogue before it can carry a price.
       *   no-cost       the blank resolves and its row carries no cost. Also ours.
       *
       * Two of the three are ours, and all three said "pick a blank first" — a screen sending
       * the one person who cannot fix it back to a field they had already filled.
       *
       * The line id rides along so a row can find its own reason. Keying on sku alone would
       * put one line's reason on its same-sku sibling, which is the identity rule §5 states.
       */
      if (!row) {
        /* NO BLANK AT ALL and A BLANK WE DO NOT STOCK are different failures with different
           owners, and they were one reason. A line whose blank was typed into an import sheet
           — an OTTO or SanMar style we have never added to catalog_products — arrives here
           with `blank` FILLED and no catalogue row, and the order page told its owner to
           "pick a blank first". They had. matchProduct only ever searches catalog_products;
           a supplier's own catalogue is not the same table. */
        const named = String(it.blank || '').trim() || String(it.sku || '').trim();
        unpriced.push({ id: it.id, line_id: it.line_id, sku: it.sku || '(no sku)', name: it.name || '',
                        blank: it.blank || null, reason: named ? 'unknown-blank' : 'no-blank' });
        continue;
      }
      if (cost == null) cost = unitCostOf(row, it, fees, withMethods);
      if (ship == null) ship = shipFeeOf(row, it.size, fees);
      extra = extraFeeOf(row, fees);
      if (cost == null) { unpriced.push({ id: it.id, line_id: it.line_id, sku: it.sku || '(no sku)', name: it.name || '', blank: it.blank || null, reason: 'no-cost' }); continue; }
    }
    // The supplier's price for this blank, when the catalogue knows it. Read even for a
    // frozen line: the sell price is history once charged, but what we PAID is a fact
    // about the blank and is what any margin figure has to be measured against.
    const srow = matchProduct(idx, it);
    const supplier = srow ? supplierCostOf(srow, it) : null;
    // What the unit cost is MADE OF. Read from the catalogue even on a frozen line: the
    // split is a fact about the product and the technique, and showing it is the only way
    // a $13.50 blank quoting $18.50 stops looking like two different prices.
    const parts = srow ? costPartsOf(srow, it, fees, withMethods) : { base: null, method: 0 };
    /* Written by freezeQuote at the moment of charge; absent on a quote and on any line
       charged before the column existed. node-pg gives jsonb back already parsed. */
    const stamp = it.cost_parts && typeof it.cost_parts === 'object' ? it.cost_parts : null;
    /* LINE IDENTITY, not the row id. `id` is the order_items primary key and the CLIENT's
       OrderItem does not carry it, so a caller matching a quote line back to the item on
       screen had only `sku` to go on — which is null on a manual line, and shared by
       identical-SKU siblings, which CLAUDE.md §5 names as the bug: "two lines of the same
       SKU are different jobs; keying on sku alone flips every sibling at once". */
    lines.push({ id: it.id, line_id: it.line_id ?? null, sku: it.sku, name: it.name, qty, size: it.size, blank: it.blank,
                 unitCost: money(cost), shipFee: money(ship), extraFee: money(extra),
                 baseCost: stamp && stamp.base != null ? money(stamp.base)
                           : parts.base == null ? null : money(parts.base),
                 methodFee: money((stamp ? stamp.method : parts.method) || 0),
                 // What the line is PRINTED on, and what the extra faces added. Shown as its
                 // own number for the same reason methodFee is: a blank quoting more than
                 // its base cost has to be able to say which surcharge did it.
                 /* THE PRODUCT'S OWN RATE HERE TOO. Computed without `srow.data` this
                    reported the platform figure while unitCostOf charged the override — the
                    breakdown and the charge disagreeing about the same line, which is the one
                    thing a breakdown must never do. */
                 /* The COUNT stays on the line for every reader that has one, and the NAMES
                    ride beside it so a breakdown can say which face cost what. */
                 sides, faces,
                 /* WHICH METHOD THIS LINE IS BILLED AT, and the set that is actually on the
                    garment. The summary printed the line's own print_type as the surcharge's
                    label, which on a mixed line names one face and describes the other
                    wrongly; `billedMethod` is the one the money belongs to and `methods` is
                    what the strip has to say. Stamped on a charged line for the same reason
                    the faces are — what was billed is history. */
                 billedMethod: (stamp && stamp.billedMethod) || parts.billedMethod || it.print_type || null,
                 methods: stamp && Array.isArray(stamp.methods) ? stamp.methods
                          : [...new Set(withMethods.map((f) => f.method).filter(Boolean))],
                 /* THE STAMP WINS ON A CHARGED LINE. `faces` above is what is on the garment
                    NOW; the stamp is what was BILLED, and after a charge those are allowed to
                    differ (a face added post-submit must not re-price a paid order). Reading
                    the stamp here means the charged summary and the quote emit one shape and
                    the client never has to know which it is looking at. A line frozen before
                    this column existed has no stamp and falls through to the live computation,
                    which is exactly what it did before. */
                 sideFee: stamp ? money((stamp.sides || []).reduce((n, p) => n + (Number(p.amount) || 0), 0))
                                /* withMethods, NOT `faces`: the names alone lose each face's
                                   technique, and the rate now depends on it — the total would
                                   price at the flat rate while sideParts below priced per
                                   method, and the two would disagree on the same line. */
                                : money(sideAddOn(withMethods, fees, (srow && srow.data) || null, it.print_type)),
                 /**
                  * WHAT THE ARTWORK ON THE GARMENT WOULD COST TODAY — always live, never the stamp.
                  *
                  * The note above says a charged line's `sideFee` and what is on the garment now
                  * "are allowed to differ", and the summary has a row built to say so when they
                  * do. It could never fire. `sideFee` READS the stamp once one exists, and
                  * `sideFeeCharged` is derived from the same frozen cost — so the client was
                  * comparing a number against itself and finding it equal, every time, forever.
                  *
                  * Measured on FF-ombao6-muayb8d6-1in74r: billed for three faces at 9, a fourth
                  * placement attached afterwards, artwork now worth 12 — and the order page said
                  * nothing at all, which is what the owner reported.
                  *
                  * ADDITIVE AND CHARGES NOTHING. The money still comes from the stamp: a face
                  * added after submit must not re-price a paid order, and that has not changed.
                  * This is the other half of the sentence — what it WOULD cost — so the two can
                  * finally be compared and the difference named.
                  */
                 sideFeeNow: money(sideAddOn(withMethods, fees, (srow && srow.data) || null, it.print_type)),
                 /**
                  * WHAT THE EXTRA FACES ACTUALLY CONTRIBUTED TO THE PRICE THIS LINE CARRIES,
                  * as against what they would cost if it were quoted today.
                  *
                  * `sideFee` above is computed from the artwork that is on the garment NOW.
                  * On a FROZEN line that is not necessarily what was billed: `cost` came from
                  * the stored unit_cost, and the note at the top of this loop is explicit that
                  * a face added after submit must not re-price a paid order. So the two can
                  * legitimately disagree, and a summary reading `sideFee` after the charge
                  * would name a face the seller was never charged for.
                  *
                  * unitCostOf is base + method + sides, so whatever the frozen cost carries
                  * over base+method IS the side money, exactly. Null when the catalogue cannot
                  * give us a base — "we cannot tell" is not "nothing", and §4 forbids drawing
                  * them the same.
                  */
                 sideFeeCharged: parts.base == null ? null : money(cost - parts.base - (parts.method || 0)),
                 /* WHICH face cost what, so the summary can name them instead of saying
                    "2 sides" and leaving the reader to guess which one carried the money. */
                 sideParts: stamp ? { included: stamp.included ?? null,
                                     /* A line stamped before this existed has no method on its
                                        faces; null means "not recorded", and the summary falls
                                        back to the billed method rather than inventing one. */
                                     includedMethod: stamp.includedMethod ?? null,
                                     parts: stamp.sides || [] }
                                  : sideBreakdown(withMethods, fees, (srow && srow.data) || null, it.print_type),
                 /* WHAT EVERY face would cost on this blank, for the designer's rail — which
                    must quote the same number the charge will use. */
                 /* THE LINE'S OWN METHOD, not the billed one. This answers "what would a
                    face cost if I put artwork there", and a new face inherits the line — so
                    the dearest face already on the garment is the wrong quote for an empty
                    one. */
                 sideRates: sideRates(fees, (srow && srow.data) || null, it.print_type),
                 /**
                  * WHAT A FACE AFTER THE FIRST COSTS, by technique — the OTHER half of the
                  * rail's question, and the half it has never been sent.
                  *
                  * `sideRates` above is the PLACEMENT table, and since 2026-09-21 only one
                  * face per line ever carries a placement. Every face after it buys its
                  * technique's RUN instead, which is this. The rail was left quoting the
                  * placement to faces that will never pay one — and when that was noticed it
                  * printed the words "+ design fee" instead, which named a different charge
                  * entirely: a design fee is per DESIGN, decided and quoted by a person.
                  *
                  * A MAP BY METHOD, NOT ONE FIGURE. A face may declare its own technique
                  * (order_designs.method) and differ from its line — an embroidered front
                  * with a DTG back — so one number would be wrong on exactly the face that
                  * bothered to say what it was. The line's own method is included so a face
                  * that says nothing can still be answered.
                  *
                  * KNOWABLE BEFORE ANY ARTWORK, which is the whole point: the run is priced
                  * from the technique, not from the picture. A seller can be told what a
                  * second face costs before committing to one, rather than after.
                  *
                  * Same resolver as the charge (methodAddOn, via methodAddOnsFor), so the
                  * tile cannot quote a figure the invoice will not use.
                  */
                 faceAddOns: methodAddOnsFor(srow, fees, [
                   it.print_type,
                   ...withMethods.map((f) => f.method),
                   /* AND EVERY TECHNIQUE THE BLANK OFFERS, not only the ones already on it.
                      A seller declares a method on an EMPTY face — "the back is embroidered,
                      artwork to follow" — and the tile has to price that the moment it is
                      chosen, which is before any face carries it. Reading only what is on
                      the garment would answer every method except the one just picked. */
                   ...(Array.isArray(srow && srow.data && srow.data.methods) ? srow.data.methods : []),
                   /* AND EVERY TECHNIQUE THERE IS. A face's method is picked in the designer
                      BEFORE it is saved, so neither list above has heard of it yet — and a
                      product may carry a single `method` rather than `methods`. Asking only
                      for what was named left the map EMPTY on an embroidered front, and the
                      tile had nothing to print. Passed here, not built into methodAddOnsFor:
                      its other callers read "only the methods I asked about" from its keys. */
                   ...ALL_TECHNIQUES,
                 ]),
                 supplierCost: supplier == null ? null : money(supplier) });
  }
  return { lines, unpriced };
}

/**
 * WHAT A CHARGED LINE WOULD COST WITH THE ARTWORK THAT IS ON IT NOW, AND WHAT THAT LEAVES
 * OWING (owner, 2026-09-21).
 *
 * A face added after submit deliberately does not re-price a paid order — that rule stands and
 * is what `unit_cost`/`cost_parts` are stamped for. What did not exist was any way to bill the
 * difference, so artwork attached after the charge was simply produced for nothing. Measured on
 * FF-ombao6-muayb8d6-1in74r: billed for three faces at $9, a fourth placement attached fifteen
 * minutes later, artwork worth $12, and $3 that nothing could ever collect.
 *
 * IT RE-RUNS THE LADDER; IT IS NOT A SECOND PRICE LIST. A "surface fee" charger would be a
 * second opinion about what a line costs, and §5 has the receipts on what private copies of a
 * pricing rule do. `priceLines` is called with the real catalogue, the real fees and the faces
 * that are on the garment now — so a face whose technique is DEARER than anything the line
 * carried moves the line's method fee too, which is per line at the dearest and which no
 * per-face rule could ever have reached. On that order's other line — DTF and DTG, method $0 —
 * an embroidered face is $3 of placement and $4 of method, ×2 units: $14, not $6.
 *
 * THE STAMP IS A FLOOR AND ONLY EVER GROWS.
 *
 *   base          frozen. The garment's price does not move because a face was added.
 *   stamped faces frozen at what they were billed, so a rate changed in Settings since the
 *                 charge cannot reach backwards. A face whose artwork has since been REMOVED
 *                 keeps its amount too: the seller paid for it, and recorded history does not
 *                 change silently.
 *   new faces     priced today — there is no stamped rate to honour, and today's is the only
 *                 honest answer.
 *   method        max(stamped, today). Never down: removing the dearest face does not refund
 *                 the setup it already paid for.
 *
 * ONE-WAY BY CONSTRUCTION. Every term is a max or a frozen value, so the figure it returns is
 * never negative and this can only ever charge. Refunds stay a human act on a named row —
 * which is the shape the owner chose.
 *
 * IT MOVES NO MONEY AND WRITES NOTHING. It answers a question; the caller decides whether to
 * bill it, and restamps with `parts` so the NEXT change is measured from what was just paid.
 *
 * @param pending  a face about to be written — {side, method} — so the price can be known, and
 *                 refused, BEFORE the artwork lands. Null asks about the garment as it stands.
 */
export async function repriceDelta(orderId, lineId, pending = null) {
  if (!orderId || !lineId) return { delta: 0, reason: 'no-line' };
  const item = await q(
    `select id, sku, name, qty, size, blank, print_type, unit_cost, ship_fee, line_id, cost_parts
       from order_items where order_id=$1 and line_id=$2 limit 1`, [orderId, lineId])
    .then((r) => r.rows[0]).catch(() => null);
  if (!item) return { delta: 0, reason: 'no-line' };
  /* NOT CHARGED YET. The quote re-prices from the artwork on every read, so there is nothing
     frozen to differ from — the seller sees the new face in their total before they submit,
     which is the whole of the pre-charge behaviour and must not be billed twice. */
  if (item.unit_cost == null) return { delta: 0, reason: 'not-charged' };
  const stamp = item.cost_parts && typeof item.cost_parts === 'object' ? item.cost_parts : null;
  /* A line frozen before cost_parts existed cannot say WHICH faces its money paid for, so
     nothing here can tell an already-billed face from a new one. Charging on a guess is the
     one outcome worse than not charging: it bills a seller twice for the same surface. */
  if (!stamp || stamp.base == null) return { delta: 0, reason: 'no-stamp' };

  const [fees, idx, rows] = await Promise.all([
    /* WITHOUT IMAGES. This runs on the ARTWORK SAVE path — every time somebody places a
       design on a charged order — and the full index carries every product's img, images and
       side_mockups: measured at 71% of the catalogue payload, ~1MB for 34 products, none of
       which pricing reads. It made saving a design visibly slow (owner, 2026-09-22: "saving
       is very very slow, keeps loading"). The columns are stripped in SQL, so the bytes never
       reach node. */
    feeSettings(), catalogIndex({ withImages: false }),
    q(`select lower(coalesce(side,'front')) as side, method from order_designs
        where order_id=$1 and line_id=$2 and (data is not null or storage_key is not null)`,
      [orderId, lineId]).then((r) => r.rows).catch(() => []),
  ]);

  /* ONE ENTRY PER FACE, first method wins — the same fold quoteOrder does, because two rows
     can share a side (a raster and its stitch file) and only one may carry a method. */
  const faces = [];
  for (const r of [...rows, ...(pending ? [pending] : [])]) {
    const side = String((r && r.side) || 'front').trim().toLowerCase();
    if (!side) continue;
    const method = String((r && r.method) || '').trim();
    const hit = faces.find((f) => f.side === side);
    if (hit) { if (!hit.method && method) hit.method = method; continue; }
    faces.push({ side, method });
  }
  if (!faces.length) return { delta: 0, reason: 'no-faces' };

  /* THE LADDER, LIVE. unit_cost and cost_parts nulled so nothing frozen short-circuits it —
     this is deliberately the same function that priced the order in the first place. */
  const fresh = priceLines([{ ...item, unit_cost: null, ship_fee: null, cost_parts: null }],
                           idx, fees, () => faces);
  const line = fresh.lines && fresh.lines[0];
  if (!line || line.baseCost == null) return { delta: 0, reason: 'unpriceable' };

  const stampSides = Array.isArray(stamp.sides) ? stamp.sides : [];
  const billed = new Set(stampSides.map((p) => String(p.face || '').toLowerCase()));
  const liveParts = (line.sideParts && line.sideParts.parts) || [];
  /* Every face that was billed, at the amount it was billed — then every face that was not,
     at today's rate. The order follows the live breakdown for the new ones, which is
     PRICED_SIDES order, so a restamped line lists its faces the same way every time. */
  const added = liveParts.filter((p) => !billed.has(String(p.face || '').toLowerCase()));
  const sides = [...stampSides, ...added];
  const method = Math.max(Number(stamp.method) || 0, Number(line.methodFee) || 0);
  const base = Number(stamp.base) || 0;
  const newUnit = money(base + method + sides.reduce((n, p) => n + (Number(p.amount) || 0), 0));
  const qty = Math.max(1, parseInt(item.qty, 10) || 1);
  const delta = money((newUnit - (Number(item.unit_cost) || 0)) * qty);
  if (!(delta > 0.005)) return { delta: 0, reason: 'no-change', newUnit, qty };

  /* The method may have moved, so what the line is BILLED at moves with it — and `methods` is
     the set actually on the garment, which is what the summary's strip reads. A method that
     did not rise keeps the stamp's word for it: that is what the money paid for. */
  const rose = (Number(line.methodFee) || 0) > (Number(stamp.method) || 0);
  return {
    delta, newUnit, qty, added,
    parts: {
      ...stamp,
      method,
      sides,
      billedMethod: rose ? (line.billedMethod || stamp.billedMethod || null) : (stamp.billedMethod || null),
      methods: [...new Set([...(Array.isArray(stamp.methods) ? stamp.methods : []),
                            ...(Array.isArray(line.methods) ? line.methods : [])].filter(Boolean))],
    },
  };
}

/**
 * THE RATE THIS SELLER WOULD GET ON A NEW ORDER — for a quote, before one exists.
 *
 * quoteOrder reads the discount off an ORDER (frozen if charged, else the ladder). A quote
 * has no order, and a partner pricing a basket needs the same number the charge will use or
 * the quote is decoration. Best-of the volume ladder and the plan rate, exactly as
 * quoteOrder combines them — one function, so the two cannot disagree.
 *
 * Fails to zero like everything else here: no seller, no tiers, an unreadable settings row
 * all quote the list price. A quote that promises a discount the charge does not honour is
 * worse than one that does not mention it.
 */
export async function sellerDiscountPct(sellerId) {
  if (!sellerId) return 0;
  try {
    const tiers = await q('select value from settings where key=$1', ['volume_tiers'])
      .then((s) => normalizeTiers(s.rows[0]?.value || [])).catch(() => []);
    let volumePct = 0;
    if (tiers.length) {
      const units = await unitsForSeller(String(sellerId), previousPeriod(periodKey(new Date())));
      volumePct = volumeTierFor(units, tiers).pct || 0;
    }
    const planPct = await planRateFor(sellerId).catch(() => 0);
    return effectiveDiscountPct([volumePct, planPct]);
  } catch { return 0; }
}

export async function quoteOrder(orderId) {
  const [items, fees, idx, sideRows] = await Promise.all([
    q('select id, sku, name, qty, size, blank, print_type, unit_cost, ship_fee, line_id, cost_parts from order_items where order_id=$1 order by id', [orderId]).then((r) => r.rows),
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
    /* THE NAMES, not the count. This aggregated to count(distinct side) and that number was
       everything pricing ever knew about the faces — which is exactly why a back and a sleeve
       could not be charged apart. array_agg keeps them, and the count is derived from the
       array on the other side, so the two can never disagree. */
    /* THE METHOD TRAVELS WITH THE FACE. This aggregated side names only, so a garment
       embroidered at the front and printed at the back reached pricing as two anonymous
       faces and was billed at whatever single value sat on the line. Rows rather than an
       aggregate because two rows can share a side (a raster and its stitch file) and only
       one of them may carry a method — that is a dedupe with a preference, which is a
       sentence of JavaScript and an unreadable jsonb expression. */
    /**
     * A FACE IS CHARGED WHEN IT CARRIES ARTWORK — nothing else can make one true.
     *
     * That has always been the rule ("a seller who has not placed a design has not asked for
     * a second print"), and it was enforced by accident: the POST refused a save with no
     * bytes, so every row in this table had some. A surface can now be DECLARED before it is
     * drawn — "the back is embroidered", artwork to follow — and without this filter each of
     * those would have walked straight into the side charge and, worse, into the billing
     * method: mark a back as embroidery on a DTG line and the whole line would bill at
     * embroidery for work nobody has placed.
     *
     * So the filter is the fee gate, in both directions. Adding a Type costs nothing; adding
     * ARTWORK starts the charge; removing the artwork stops it on the very next quote,
     * because the row stops matching here even though it still remembers its method.
     *
     * It is also a NO-OP on every row that exists today, which is what makes it safe to add
     * to a live pricing path: `data` was required until now, so nothing already stored can
     * fail it.
     */
    /**
     * AN EMPTY `side` IS THE FRONT, the same as a null one (2026-09-23).
     *
     * `coalesce(side,'front')` catches NULL and NOT ''. Live rows exist with an empty side —
     * FF-12jtbd4-mquer51p-15fq31 carries two — and the client has always read
     * `String(d.side || "front")`, which catches both.
     *
     * DEFENSIVE, NOT A FIX: priceLines already normalises `f.side || 'front'` one step
     * later, so no face is lost today. Asserted — reverting this line leaves the gate green,
     * which is exactly how it was found not to be the cause of anything. It stays because
     * two readers of one column disagreeing about what '' means is a bug waiting for its
     * third reader, and the SQL is where the column is read first.
     */
    q(`select coalesce('L:' || line_id, 'S:' || sku) as key,
              lower(coalesce(nullif(btrim(side), ''), 'front')) as side, method
         from order_designs
        where order_id=$1 and (data is not null or storage_key is not null)`, [orderId])
      .then((r) => r.rows).catch(() => []),
  ]);
  /* ONE ENTRY PER FACE, first method wins. A second row on the same side that says nothing
     must not blank one that does — absent means inherit, never "no". */
  const sidesByKey = new Map();
  for (const r of sideRows) {
    let list = sidesByKey.get(r.key);
    if (!list) sidesByKey.set(r.key, (list = []));
    const hit = list.find((f) => f.side === r.side);
    if (hit) { if (!hit.method && r.method) hit.method = String(r.method).trim(); continue; }
    list.push({ side: r.side, method: String(r.method || '').trim() });
  }
  /* A line with no artwork prices as ONE face, which is what "there is no count" meant before
     and must keep meaning: a missing row charges for one side, never none and never more. */
  /**
   * A LINE'S FACES — ITS OWN ROWS, ELSE WHATEVER IS FILED UNDER ITS SKU.
   *
   * THE SKU FALLBACK WAS MISSING HERE AND NOWHERE ELSE. `sidesForLine`, `designForLine`,
   * `faceChargesFor`, `sideRatesFor` and `faceSurfacesFor` all do their own `line_id`, then
   * `sku` — CLAUDE.md §5: "sku stays as the fallback for rows written before line_id
   * existed". This one went straight to `L:` and stopped, so a line whose artwork predates
   * line_id was DRAWN everywhere and PRICED as a bare front.
   *
   * ONE BUCKET OR THE OTHER, never merged — exactly what sidesForLine does. Merging would
   * let a sku-keyed row from a sibling line of the same SKU attach itself to this one, which
   * is the sibling bug §5 is about, one question earlier.
   *
   * WHAT MOVES: unsubmitted quotes on orders holding such rows go UP, because a face that
   * was being printed for free starts being charged. Charged orders do not move at all —
   * `sideParts` reads the frozen stamp for those and this never runs.
   */
  const sidesOf = (it) => {
    const own = it.line_id ? sidesByKey.get(`L:${it.line_id}`) : undefined;
    if (own && own.length) return own;
    const bySku = it.sku ? sidesByKey.get(`S:${it.sku}`) : undefined;
    return bySku && bySku.length ? bySku : ['front'];
  };
  const { lines, unpriced } = priceLines(items, idx, fees, sidesOf);
  const volume = await volumeRateFor(orderId);
  /* BEST-OF, never the sum — see effectiveDiscountPct. A frozen (already charged) order
     carries its stamped rate and must not gain a second one afterwards: the plan rate is
     consulted only while the price is still a quote. */
  const sellerId = await q('select seller_id::text as seller_id from orders where id=$1', [orderId])
    .then((r) => r.rows[0]?.seller_id || null).catch(() => null);
  const planPct = volume.frozen ? 0 : await planRateFor(sellerId).catch(() => 0);
  const totals = computeTotals(lines, fees, effectiveDiscountPct([volume.pct, planPct]));
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
    /* WHICH RATE WON, so a seller reading a deduction is told where it came from. Best-of
       means at most one applies, and an unnamed discount is one nobody trusts. */
    planPct,
    discountFrom: effectiveDiscountPct([volume.pct, planPct]) === 0 ? null
      : (planPct >= volume.pct ? 'plan' : 'volume'),
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
/**
 * ONE RATE OUT OF HOWEVER MANY GO IN — and the rule is a decision, not an accident.
 *
 * There is exactly ONE discount in the charge path today: the volume tier. A subscription
 * discount does not exist (pricing.js never reads `plan`; entitlements.js gates FEATURES),
 * so nothing stacks and nothing can. This exists so that stays true by construction when a
 * second rate is added, rather than by whoever writes it remembering to check.
 *
 * BEST-OF IS THE DEFAULT, and deliberately not the sum. 15% + 10% is 25% off goods that
 * were priced with one discount in mind, and the failure is silent: every order still books,
 * every total still looks plausible, and the margin is gone a month before anyone reconciles
 * it. Best-of cannot produce a rate nobody chose, and it is the rule a seller can predict —
 * "you get your best rate" is explainable at a support desk in one sentence.
 *
 * `mode` is a setting the moment there is a second input worth combining. It is NOT exposed
 * on the Settings screen yet, on purpose: a switch that governs a combination which cannot
 * occur is a control that does nothing, which this file has been burned by before — see the
 * flat first-item shipping fee at the top, editable for months and never once used to price
 * an order. When a plan or seasonal rate lands, pass it here and turn the switch on.
 *
 * Seasonal rates are exactly the case this shape is for: a peak-season rate is another
 * percentage arriving from somewhere else, and it must not silently add to what a seller
 * already earned by shipping.
 */
export function effectiveDiscountPct(parts, mode = 'best') {
  const vals = (Array.isArray(parts) ? parts : [parts])
    .map((p) => Number(p) || 0)
    .filter((p) => p > 0);
  if (!vals.length) return 0;
  const raw = mode === 'stack' ? vals.reduce((a, b) => a + b, 0) : Math.max(...vals);
  // Clamped whichever mode is in force: stacking three rates must not be able to reach a
  // total that turns an order into a credit.
  return Math.min(100, Math.max(0, raw));
}

export function computeTotals(lines, fees, volumePct = 0) {
  const subtotal = money(lines.reduce((s, l) => s + l.unitCost * l.qty, 0));
  const units = lines.reduce((s, l) => s + l.qty, 0);
  // Through the combiner even with one input, so the single-rate path and the eventual
  // multi-rate path are the same code and the clamp lives in one place.
  const pct = effectiveDiscountPct([volumePct]);
  /**
   * THE DISCOUNT COMES OFF THE BLANK, AND ONLY THE BLANK (owner, 2026-09-21).
   *
   * It was `subtotal × pct`, and `subtotal` is Σ(unitCost × qty) — the garment PLUS the print
   * method's surcharge PLUS every printed face. So a volume rate earned on garments was also
   * taking a cut off embroidery and off each placement, which are work we do rather than
   * stock we buy cheaper by the dozen. Shipping was already excluded for exactly that reason
   * ("a courier's price and not ours to discount"); the method and the faces are the same
   * argument and were simply never separated out.
   *
   * `baseCost` is the blank's own price — `parts.base`, held apart from `methodFee` and
   * `sideFee` — so the base is a field, not a subtraction. The fallback derives it the way
   * the summary's own Blank row does, so a line the catalogue could not price contributes
   * what the screen says it does rather than silently nothing.
   *
   * CHARGED LINES ARE UNAFFECTED: a frozen line's `unitCost` and `baseCost` come from its
   * stamp, so what was billed still recomputes to what was billed.
   */
  const blankOf = (l) => {
    const base = num(l.baseCost);
    if (base != null && base > 0) return base;
    const derived = num(l.unitCost) - (num(l.methodFee) || 0) - (num(l.sideFee) || 0);
    return derived > 0 ? derived : 0;
  };
  const discountBase = money(lines.reduce((s, l) => s + blankOf(l) * l.qty, 0));
  const volumeDiscount = money(discountBase * (pct / 100));
  if (!units) return { subtotal, discountBase: 0, shipping: 0, units: 0, volumePct: pct, volumeDiscount: 0, total: subtotal };
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
  /* `discountBase` rides along so the summary splits the deduction across rows against the
     SAME number the charge used. Deriving it again on the client is how a breakdown and a
     charge come to disagree about one line. */
  return { subtotal, discountBase, shipping, units, volumePct: pct, volumeDiscount, total };
}

// Freeze the quoted prices onto the items, so the charge is reproducible and a later
// catalog edit can never rewrite what someone was already billed.
export async function freezeQuote(orderId, quote) {
  for (const l of quote.lines) {
    /**
     * THE SPLIT IS STAMPED WITH THE PRICE, because the price alone cannot be read back.
     *
     * unit_cost is base + method + one row per extra face summed into one number. Afterwards
     * the only honest thing a charged summary could say about a two-sided line was "extra
     * faces $3.00" — it knew the total and not which face paid it, because the artwork on the
     * garment can change after submit and deliberately does not re-price the order. Stamping
     * the parts beside the figure they add up to is what lets the charged view name them as
     * precisely as the quote does.
     *
     * `where cost_parts is null` for the same reason the volume rate below carries that
     * guard: a re-freeze must never move a stamped record of something that already happened.
     */
    await q('update order_items set unit_cost=$1, ship_fee=$2 where id=$3', [l.unitCost, l.shipFee, l.id]).catch(() => {});
    await q('update order_items set cost_parts=$1 where id=$2 and cost_parts is null', [
      JSON.stringify({
        base: l.baseCost ?? null,
        method: money(l.methodFee || 0),
        included: l.sideParts?.included ?? null,
        includedMethod: l.sideParts?.includedMethod ?? null,
        sides: l.sideParts?.parts ?? [],
        /* WHICH METHOD THE MONEY WAS FOR, stamped for exactly the reason the faces are. One
           surcharge is charged per line and a mixed line has more than one candidate, so
           without this a charged summary could only print the line's own column — which is
           true of one face and wrong about the other. `methods` is what was on the garment
           when it was billed; artwork added later does not re-price a paid order, so the two
           are allowed to differ afterwards and only the stamp can say what happened. */
        billedMethod: l.billedMethod ?? null,
        methods: Array.isArray(l.methods) ? l.methods : [],
      }),
      l.id,
    ]).catch(() => {});
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
