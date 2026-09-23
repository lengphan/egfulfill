/**
 * WHAT A PRODUCT COSTS BEFORE ANYONE ORDERS IT — one definition, for the two pages that
 * have no quote to read.
 *
 * Every other surface that states a per-face price reads the SERVER's answer: the order
 * summary takes `sideParts`, the designer's rail takes `sideParts` and `faceAddOns`. They
 * cannot drift because they do no arithmetic. The product detail page and the public product
 * page have no order and therefore no quote, so they must compute — and both did, separately,
 * each frozen at whatever the rule was on the day it was written:
 *
 *   server sideDetail     one placement, then each face's own method run   (current)
 *   product detail page   every face charged its placement rate            (18 Sep)
 *   public product page   flat rate × (N − 1), method ignored              (pre-18 Sep)
 *
 * Measured, by executing pricing.js against each: one embroidered hoodie printed front, back
 * and sleeve was quoted $30.00 on the public site and $33.00 on the product page against an
 * invoice of $39.00. The drift is not one-directional either — a second DTG face was
 * OVER-quoted, because the older rules charged a placement for a run the invoice gives away.
 *
 * So: one module, imported by both, and `tools/check-product-price.mjs` EXECUTES it against
 * the real `priceLines` over a matrix of products × methods × faces. A second implementation
 * that is gated is a different thing from a second implementation that is not — the rule has
 * moved three times in a week, and the gate is what makes the next move loud.
 *
 * NO IMPORTS, deliberately. The gate compiles this file where it stands (see
 * check-order-rules.mjs for the pattern) and a single import would drag the whole app's
 * module graph into a price check.
 */

/**
 * The order faces are charged in — mirrors PRICED_SIDES in server/src/routes/factory_settings.js.
 *
 * It decides WHICH face carries the line's one placement, so the same garment is charged the
 * same way whatever sequence somebody happened to tick the boxes in.
 */
export const PRICED_SIDES = ["front", "back", "left", "right", "sleeve", "hood", "inside", "wrap"]

/** Normalises a technique label to the key a surcharge is stored under.
 *  Mirrors `methodKey` in server/src/pricing.js — which itself is kept in step with
 *  `normTech` in web/lib/print-method.ts, because the picker offers those labels. */
export function priceMethodKey(printType?: string | null): string | null {
  const tech = String(printType ?? "").toUpperCase()
  if (!tech) return null
  return /EMB/.test(tech) ? "EMB" : /DTF/.test(tech) ? "DTF" : /APL|APPLIQ/.test(tech) ? "APL"
    : /LSR|LASER|ENGRAV/.test(tech) ? "LSR" : /SCR|SCREEN/.test(tech) ? "SCR"
    : /SUBLIM|\bDYE\b/.test(tech) ? "SUB" : /VINYL|\bHTV\b|\bVNL\b/.test(tech) ? "VNL"
    : /DTG|DIRECT/.test(tech) ? "DTG" : tech
}

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const money = (n: number) => Math.round(n * 100) / 100

/** A product's own pricing overrides, as the catalogue stores them. */
export type ProductPricing = {
  /** EITHER a flat number (every placement costs this) OR a map — per face, or per METHOD. */
  sidePrice?: unknown
  /** Per-technique surcharge for THIS blank, keyed EMB/DTG/… — beats the platform's. */
  methodPrices?: Record<string, number> | null
}

/** The platform's defaults, as `/api/design_fees` sends them. */
export type PlatformFees = {
  /** `method_side` — the flat placement rate, the last rung of the ladder. */
  sideFee?: number | null
  /** `side_<face>` — a sleeve is awkward whatever is put on it. */
  sideFees?: Record<string, number> | null
  /** `side_<method>` — every DTG placement. */
  sideMethodFees?: Record<string, number> | null
  /** `method_<key>` — what the technique adds, keyed lower-case. */
  methods?: Record<string, number> | null
} | null | undefined

/**
 * WHAT ONE PLACEMENT COSTS ON THIS BLANK — first answer wins.
 *
 * Mirrors `faceRate` in server/src/pricing.js rung for rung. FACE BEATS METHOD, because it is
 * the more specific statement about this garment. `> 0` at every rung for the reason the
 * server uses it: zero is an empty field, not a price, and a genuinely free placement is what
 * the flat rate at 0 is for.
 */
export function placementRate(
  face: string,
  product: ProductPricing | null | undefined,
  fees: PlatformFees,
  methodKey?: string | null,
): number {
  const own = product?.sidePrice
  const ownMap = own && typeof own === "object" ? (own as Record<string, unknown>) : null
  const ownFlat = typeof own === "number" ? own : num(own)
  const flat = (ownFlat != null && ownFlat > 0 ? ownFlat : num(fees?.sideFee)) || 0
  const mkey = methodKey ?? null

  const perProduct = ownMap ? num(ownMap[face]) : null
  if (perProduct != null && perProduct > 0) return perProduct
  /* Both spellings: methodPrices is keyed EMB/DTG and a hand-typed sidePrice map is as
     likely to carry a lower-case `dtg` beside a `back`. */
  const ownMethod = ownMap && mkey ? (num(ownMap[mkey]) ?? num(ownMap[mkey.toLowerCase()])) : null
  if (ownMethod != null && ownMethod > 0) return ownMethod
  const perPlatform = num(fees?.sideFees?.[face])
  if (perPlatform != null && perPlatform > 0) return perPlatform
  const platMethod = mkey ? num(fees?.sideMethodFees?.[mkey.toLowerCase()]) : null
  if (platMethod != null && platMethod > 0) return platMethod
  return flat
}

/**
 * WHAT THE TECHNIQUE ADDS — the product's own figure, else the platform's, else nothing.
 * Mirrors `methodAddOn` in server/src/pricing.js.
 *
 * ZERO WHEN UNKNOWN, never a guess: a method the table has no entry for adds nothing, which
 * is exactly what the charge does. A second DTG face genuinely is free.
 */
export function methodRate(
  printType: string | null | undefined,
  product: ProductPricing | null | undefined,
  fees: PlatformFees,
): number {
  const tech = String(printType ?? "").toUpperCase()
  if (!tech) return 0
  const k = priceMethodKey(printType)
  if (k && product?.methodPrices) {
    const mp = num(product.methodPrices[k] ?? product.methodPrices[tech])
    if (mp != null && mp > 0) return mp
  }
  const plat = k ? num(fees?.methods?.[k.toLowerCase()]) : null
  return plat != null && plat > 0 ? plat : 0
}

/**
 * WHAT EACH PRINTED FACE ADDS, face by face — the SAME loop as `sideDetail`.
 *
 * Written as the loop rather than as the closed form `placement + method × N`, because the
 * two are not equal: `charged` only flips once a face's rate is ABOVE zero, so on a blank
 * whose first face is free the SECOND face carries the placement. The closed form gets that
 * case wrong, and it is the same trap that made `kind` necessary on the server's own parts.
 */
export function facePartsFor(
  faces: string[],
  printType: string | null | undefined,
  product: ProductPricing | null | undefined,
  fees: PlatformFees,
): { face: string; amount: number; kind: "placement" | "run" }[] {
  const mkey = priceMethodKey(printType)
  const uniq = [...new Set(faces.map((f) => String(f ?? "").trim().toLowerCase()).filter(Boolean))]
  const ordered = uniq.slice().sort((a, b) => {
    const ia = PRICED_SIDES.indexOf(a); const ib = PRICED_SIDES.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const out: { face: string; amount: number; kind: "placement" | "run" }[] = []
  let charged = false
  for (const face of ordered) {
    const rate = placementRate(face, product, fees, mkey)
    out.push({
      face,
      amount: money(charged ? methodRate(printType, product, fees) : rate),
      kind: charged ? "run" : "placement",
    })
    if (rate > 0) charged = true
  }
  return out
}

/**
 * THE UNIT PRICE OF A CONFIGURED PRODUCT.
 *
 *     blank  +  the technique, once  +  Σ per face ( the first one's placement, then runs )
 *
 * Mirrors `unitCostOf` — base + method + sideAddOn — with the one thing the product pages
 * cannot know folded in: every face here shares the selected technique, because a page
 * pricing a product has one method picked, not a per-face map read off order_designs.
 *
 * A BLANK IS THE GARMENT AND NOTHING ELSE. No faces and no technique means no placement and
 * no surcharge, which is what "Blank Only" prices to — and it needs no special case, because
 * an empty face list produces no parts.
 */
export function productUnitPrice(input: {
  /** The garment's own price for the chosen size. */
  blank: number
  /** The technique picked on the page. Null/empty = undecorated. */
  printType?: string | null
  /** The faces being printed. Empty = a bare garment. */
  faces?: string[]
  product?: ProductPricing | null
  fees?: PlatformFees
}): number {
  const faces = input.faces ?? []
  const tech = String(input.printType ?? "").trim()
  const parts = tech ? facePartsFor(faces, tech, input.product, input.fees) : []
  const sides = parts.reduce((n, p) => n + p.amount, 0)
  return money((Number(input.blank) || 0) + methodRate(tech, input.product, input.fees) + sides)
}
