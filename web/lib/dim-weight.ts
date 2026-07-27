// Dimensional-weight math for the packaging suggestion. Carriers bill the GREATER of a
// parcel's actual weight and its "dimensional weight" — a volume-based figure. USPS/Shippo
// (our shipping path, see server/pricing.js → Shippo) use the ÷166 divisor for cubic
// inches → pounds. So a light-but-large box gets billed as if it were heavy: the whole
// point of the suggestion is to keep the box small enough that ACTUAL weight always wins,
// and the carrier never reweighs/re-rates us up.
//
// No AI here — this is arithmetic. The only inputs are the parcel's own numbers.
export const DIM_DIVISOR = 166

const n = (v: unknown) => (v == null || v === "" ? NaN : Number(v))

/** Dimensional weight in pounds for a box measured in inches. */
export function dimWeightLb(l: number, w: number, h: number): number {
  return (l * w * h) / DIM_DIVISOR
}

/**
 * The largest box volume (cubic inches) whose dimensional weight still doesn't exceed the
 * actual weight — i.e. the ceiling to stay under so you're billed on weight, not size.
 */
export function breakEvenVolumeIn3(weightOz: number): number {
  return (weightOz / 16) * DIM_DIVISOR
}

export type PackagingHint = {
  actualLb: number
  dimLb: number | null
  /** true once dimensional weight has overtaken actual weight — the upcharge zone. */
  billedOnSize: boolean
  /** Volume ceiling (in³) to keep dim-weight ≤ actual weight. */
  maxVolumeIn3: number
  /** A roughly-cubic box at the ceiling, as an example the packer can aim under. */
  suggestedCube: number
}

/**
 * Everything the UI needs to explain the trade-off. Pass ounces + inches; any missing box
 * dimension leaves `dimLb`/`billedOnSize` unresolved (we can still show the ceiling from
 * weight alone). Returns null when there isn't even a weight to reason from.
 */
export function packagingHint(
  weightOz: unknown,
  l?: unknown,
  w?: unknown,
  h?: unknown,
): PackagingHint | null {
  const oz = n(weightOz)
  if (isNaN(oz) || oz <= 0) return null
  const actualLb = oz / 16
  const maxVolumeIn3 = breakEvenVolumeIn3(oz)
  const L = n(l), W = n(w), H = n(h)
  const haveBox = [L, W, H].every((x) => !isNaN(x) && x > 0)
  const dimLb = haveBox ? dimWeightLb(L, W, H) : null
  return {
    actualLb,
    dimLb,
    billedOnSize: dimLb != null && dimLb > actualLb,
    maxVolumeIn3,
    suggestedCube: Math.cbrt(maxVolumeIn3),
  }
}
