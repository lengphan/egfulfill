// variant-sku.js — the sku a size-and-colour is stocked against.
//
// MIRRORS web/lib/variant-sku.ts — change both. The web editor, the order board and this
// file all have to compute the same string from the same facts, because nothing stores a
// mapping: a shelf keyed one way and looked up another is a garment the floor cannot find.
//
// EG-1003 + M + Sport Grey  ->  EG-1003-M-SPORT-GREY
//
// Shape rules, each load-bearing:
//  · UPPER CASE — every stock lookup already uppercases.
//  · Punctuation collapses to one dash. Supplier colour names carry slashes, dots and
//    parentheses ("Navy/ White", "Dk.Green"), and a sku gets quoted on a purchase order and
//    typed into a scanner.
//  · SIZE BEFORE COLOUR, always, or one variant keys two ways.
//  · The product sku is used VERBATIM — it is ours, and it is already the key for every row
//    written before variants existed.
const clean = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** "" — never a partial key — when there is no product sku, or neither a size nor a colour.
 *  A half-built key collides with every other variant missing the same half, which reports
 *  one colourway's shelf as another's. */
export function variantSku(productSku, size, color) {
  const base = clean(productSku ?? '');
  if (!base) return '';
  const parts = [clean(size ?? ''), clean(color ?? '')].filter(Boolean);
  if (!parts.length) return '';
  return [base, ...parts].join('-');
}

/** How a variant reads to a person — "M · Sport Grey". Stored on the inventory row. */
export function variantLabel(size, color) {
  return [String(size ?? '').trim(), String(color ?? '').trim()].filter(Boolean).join(' · ');
}

/**
 * THE VARIANTS THE PRODUCT WAS CREATED WITH — not everything the supplier offers.
 *
 * A style arrives from S&S or Otto with sixty colourways and we keep seven; the seven are
 * what the editor saved, and they are the only ones a shelf should have rows for. Filing the
 * supplier's whole run would put fifty-three garments on the inventory page that nobody has
 * ever decided to sell, and each one would read as a real "we have none of that".
 *
 * So these mirror what web/components/app/product-editor-dialog.tsx LOADS, exactly:
 *   sizes  = p.sizes
 *   colours = keys of colorImages, or [mainColor] as a FALLBACK when there are none
 *
 * Deliberately NOT sizesOf/colorsOf from web/lib/variant-resolve.ts. Those UNION in
 * sizePrices sizes and mainColor, which is right where they are used — an order line's
 * picker must keep offering whatever that line already holds — and wrong here, where a
 * leftover price tier or a mainColor pointing at a colourway somebody removed would file a
 * row for a variant the product does not offer.
 */
export function productSizes(d) {
  const out = [];
  for (const s of (Array.isArray(d?.sizes) ? d.sizes : [])) if (s) out.push(String(s));
  return out;
}

export function productColors(d) {
  const keys = Object.keys(d?.colorImages || {}).filter(Boolean);
  if (keys.length) return keys.map(String);
  return d?.mainColor ? [String(d.mainColor)] : [];
}

/** Every (size, colour) a product offers, sizes outer — the order the editor renders. */
export function variantPairs(sizes, colors) {
  const out = [];
  for (const size of (sizes.length ? sizes : [''])) {
    for (const color of (colors.length ? colors : [''])) {
      if (!size && !color) continue;
      out.push({ size, color });
    }
  }
  return out;
}
