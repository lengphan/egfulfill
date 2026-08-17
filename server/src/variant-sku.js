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

/** Sizes a product offers. Mirrors sizesOf in web/lib/variant-resolve.ts: the list plus any
 *  size that only appears as a price tier. */
export function sizesOf(d) {
  const out = new Set();
  for (const s of (Array.isArray(d?.sizes) ? d.sizes : [])) if (s) out.add(String(s));
  for (const t of (Array.isArray(d?.sizePrices) ? d.sizePrices : [])) if (t && t.size) out.add(String(t.size));
  return [...out];
}

/** Colourways a product offers. Mirrors colorsOf: the keys it was set up with, plus its main
 *  colour — a product with one colourway carries it there and nowhere else. */
export function colorsOf(d) {
  const out = new Set();
  if (d?.mainColor) out.add(String(d.mainColor));
  for (const c of Object.keys(d?.colorImages || {})) if (c) out.add(String(c));
  return [...out];
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
