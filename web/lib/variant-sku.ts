/**
 * THE SKU A SIZE-AND-COLOUR IS STOCKED AGAINST.
 *
 * `inventory` is keyed by sku, one row per sku, and until now an order line resolved to the
 * PRODUCT's sku — so a Gildan 5000 had one number covering 8 sizes and 62 colours. "Do we
 * have it?" could not be answered for the thing actually being made.
 *
 * A variant sku is the product's own sku with the size and colour appended. Deterministic,
 * so the editor, the board and a purchase order all compute the same string from the same
 * facts and nothing has to store a mapping to stay in step:
 *
 *   EG-1003  +  M  +  Sport Grey   ->  EG-1003-M-SPORT-GREY
 *
 * SHAPE RULES, each of which is load-bearing:
 *  · UPPER CASE, because every stock lookup already uppercases (stockSkuOf, replenish.js).
 *  · Punctuation collapses to a single dash — supplier colour names carry slashes, dots and
 *    parentheses ("Navy/ White", "Dk.Green", "016 - White"), and a sku is quoted on a
 *    purchase order and typed into a scanner.
 *  · SIZE BEFORE COLOUR, always the same order, or the same variant would key two ways.
 *  · The product sku is used VERBATIM. It is ours (EG-####) and already the stock key for
 *    every row written before this existed, which is what makes the fallback safe.
 */

const clean = (s: string) =>
  String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")     // any run of punctuation/space becomes one dash
    .replace(/^-+|-+$/g, "")          // no leading/trailing dashes

/**
 * The variant sku, or "" when there isn't one to build.
 *
 * Returns "" — never a partial key — when the product has no sku of its own, or when
 * neither a size nor a colour is known. A key built from half the facts would collide with
 * every other variant missing the same half, which is worse than having no key: it would
 * report one colour's shelf as another's.
 */
export function variantSku(productSku: string | null | undefined, size?: string | null, color?: string | null): string {
  const base = clean(productSku ?? "")
  if (!base) return ""
  const parts = [clean(size ?? ""), clean(color ?? "")].filter(Boolean)
  if (!parts.length) return ""
  return [base, ...parts].join("-")
}

/** How a variant reads to a person — "M · Sport Grey". Stored on the inventory row's
 *  `variant` column, which is what the Inventory table and the scanner display. */
export function variantLabel(size?: string | null, color?: string | null): string {
  return [String(size ?? "").trim(), String(color ?? "").trim()].filter(Boolean).join(" · ")
}

/** Every (size, colour) pair a product offers, in the order the editor lists them. Sizes
 *  outer, colours inner — the same order the stock grid renders, so a row of the grid is a
 *  contiguous run here. */
export function variantPairs(sizes: string[], colors: string[]): { size: string; color: string }[] {
  const out: { size: string; color: string }[] = []
  for (const size of sizes.length ? sizes : [""]) {
    for (const color of colors.length ? colors : [""]) {
      if (!size && !color) continue
      out.push({ size, color })
    }
  }
  return out
}
