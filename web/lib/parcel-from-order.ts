import { resolveProduct } from "@/lib/variant-resolve"
import type { CatalogProduct, OrderItem } from "@/lib/api"

/**
 * THE PARCEL, WORKED OUT FROM WHAT IS ACTUALLY IN THE ORDER.
 *
 * The label dialog opened on a fixed guess, so every buy was rated against dimensions and a
 * weight nobody had checked. Over-declaring is the expensive direction — the carrier bills
 * the greater of actual and dimensional weight, so a parcel entered larger or heavier than
 * it is gets charged for the difference on every single label, quietly and forever.
 *
 * The catalog already knows: `weightOz`, `boxL`, `boxW`, `boxH` are set per product in the
 * product editor. This resolves each line to its blank and adds them up.
 *
 * HOW MULTIPLES COMBINE, and why:
 *   - weight   SUMS with quantity. Two shirts weigh two shirts.
 *   - L and W  take the LARGEST of any line. Items sit side by side in one mailer; the pack
 *              is as long as its longest thing, not the sum of them.
 *   - H        SUMS with quantity. Stacking is the direction a soft pack actually grows.
 * That is deliberately conservative on height and generous on footprint, which matches how
 * a poly mailer fills up.
 *
 * `basis` is not decoration. A number the machine derived and a number someone typed must be
 * distinguishable, because "is this measured or assumed" decides whether it is worth
 * re-weighing before you buy — and a prefilled figure presented with no provenance is
 * indistinguishable from one a human checked.
 */
export type ParcelGuess = {
  weightOz: number
  length: number
  width: number
  height: number
  /** How many lines contributed real catalog dimensions. */
  known: number
  /** How many lines resolved to no product, or a product with nothing recorded. */
  unknown: number
}

const num = (v: unknown) => {
  const n = Number(v)
  return isFinite(n) && n > 0 ? n : 0
}

export function parcelFromOrder(items: OrderItem[] | undefined, catalog: CatalogProduct[] | undefined): ParcelGuess | null {
  if (!items?.length || !catalog?.length) return null
  let weightOz = 0, length = 0, width = 0, height = 0, known = 0, unknown = 0

  for (const it of items) {
    const qty = Math.max(1, Number(it.qty) || 1)
    const p = resolveProduct(it, catalog)
    const w = num(p?.weightOz), l = num(p?.boxL), bw = num(p?.boxW), h = num(p?.boxH)
    // A product with a weight but no box still helps — weight is the half that usually
    // decides the rate on a soft pack, so it is counted rather than discarded.
    if (!w && !l && !bw && !h) { unknown += 1; continue }
    known += 1
    weightOz += w * qty
    length = Math.max(length, l)
    width = Math.max(width, bw)
    height += h * qty
  }

  if (!known) return null
  return { weightOz, length, width, height, known, unknown }
}

/** One sentence saying where the numbers came from, or null when there is nothing to say. */
export function parcelBasisNote(g: ParcelGuess | null): string | null {
  if (!g) return null
  if (g.unknown > 0) {
    return `From ${g.known} of ${g.known + g.unknown} items — the rest have no size recorded, so check this before buying.`
  }
  return `From the ${g.known === 1 ? "product" : `${g.known} products`} in this order. Adjust if the pack differs.`
}
