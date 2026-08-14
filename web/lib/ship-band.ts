import type { ShipBands } from "@/lib/api"

/**
 * WHICH FLAT SHIPPING BAND A PRODUCT FALLS IN.
 *
 * MIRRORS `shippingBandOf` IN `server/src/routes/factory_settings.js` — CHANGE BOTH.
 * The server's copy is the one that bills; this one exists so a screen can show the fee a
 * product will actually be charged instead of a platform average. Matched on substrings
 * because catalog types are loose ("Beanie", "Knit Cap", "cap - cuffed").
 *
 * It was already duplicated inside product-editor-dialog.tsx. A second copy appearing for
 * the product page would have made three, and three copies of a rule that decides money is
 * how a cap starts quoting hoodie postage on one screen and not the other.
 *
 * There is no "unknown" answer: anything unrecognised is a garment. That is deliberate and
 * it is what makes the band a floor rather than a guess — see pricing.js.
 */
export function shipBandKey(typeOrName: string): "ship_cap" | "ship_heavy" | "ship_garment" {
  const t = String(typeOrName || "").toLowerCase()
  if (/cap|hat|beanie|visor|headwear|trucker/.test(t)) return "ship_cap"
  if (/hoodie|hooded|sweatshirt|sweater|crewneck|jacket|coat|pullover|fleece/.test(t)) return "ship_heavy"
  return "ship_garment"
}

/**
 * What one unit of this product ships for as the FIRST item in a parcel.
 *
 * Same order of preference as `shipFeeOf` in pricing.js: the product's own fee when it has
 * one, otherwise its band. Per-SIZE fees are not resolved here — a page showing one number
 * for a product with a size picker would have to pick a size to be right, and the quote at
 * submit is what settles it.
 */
export function shipFirstFee(
  product: { type?: string | null; name?: string | null; shippingFee?: number | string | null; shipping_fee?: number | string | null },
  bands?: ShipBands | null,
): number {
  const own = Number(product.shippingFee ?? product.shipping_fee)
  if (isFinite(own) && own > 0) return own
  if (!bands) return 0
  const key = shipBandKey(`${product.type ?? ""} ${product.name ?? ""}`)
  return key === "ship_cap" ? bands.cap : key === "ship_heavy" ? bands.heavy : bands.garment
}
