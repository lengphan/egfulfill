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
    /**
     * THE SIZE'S OWN WEIGHT WINS.
     *
     * A 3XL crewneck runs several ounces over an S, and USPS prices in bands (4 / 8 / 12 /
     * 15.999oz, then 1lb), so two sizes of one product can sit a band apart. The
     * product-level figure is the fallback for a size nobody has weighed — not a substitute
     * for one that has been.
     *
     * Matched case-insensitively on the size string, because a line carries what the
     * marketplace sent ("L", "l", "Large") and the tier carries what we typed.
     */
    const sizeKey = String(it.size ?? "").trim().toLowerCase()
    const tier = sizeKey
      ? (p?.sizePrices ?? []).find((t) => String(t?.size ?? "").trim().toLowerCase() === sizeKey)
      : undefined
    const w = num(tier?.weightOz) || num(p?.weightOz)
    const l = num(p?.boxL), bw = num(p?.boxW), h = num(p?.boxH)
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

/**
 * WHERE THE NUMBERS CAME FROM — and ONLY when that is a problem.
 *
 * This used to speak in every state, in two or three lines. The confirming one ("From the 2
 * products in this order. Adjust if the pack differs.") is prose under a control that has
 * nothing to report: the figures are right, they are already on screen, and the sentence
 * pushed the actual controls down a row on every label anyone bought. It is gone — silence
 * is what "we measured this" looks like.
 *
 * What survives is the two states that cost money, cut to one short line each. The detail
 * they used to carry — that the carrier re-weighs and bills the difference — belongs in the
 * field's own `title`, not under it (CLAUDE.md §4).
 *
 * `tone` stays so the caller can paint it, and is now always "warn": nothing else speaks.
 */
export function parcelBasisNote(g: ParcelGuess | null, itemCount = 0, shownOz = 0): { text: string; tone: "warn" | "info" } | null {
  if (!g) {
    if (!itemCount) return null
    /* IT NAMES THE FIGURE IT IS TALKING ABOUT. Opening with "nothing is weighed" while a
       weight sits in the field two lines above reads as contradicting the screen; the
       honest reading is that the number is the mailer's, not the parcel's. */
    return {
      tone: "warn",
      text: shownOz > 0 ? `${shownOz} oz is the stock mailer, not this order` : "Nothing on this order is weighed",
    }
  }
  if (g.unknown > 0) {
    return { tone: "warn", text: `Weighed from ${g.known} of ${g.known + g.unknown} items — under-declared` }
  }
  // Everything is known. Nothing to say.
  return null
}
