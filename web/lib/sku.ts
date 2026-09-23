import type { CatalogProduct } from "@/lib/api"

/**
 * OUR SKU — the one that leaves the building.
 *
 * A product carries two: `sku` is ours ("EG-1002") and `supplierSku` is the supplier's own
 * style number. Ours is what inventory is keyed on, what an order line resolves to, and
 * what publish writes onto the seller's listing — where the seller reads it as their
 * product's SKU. Theirs never leaves the factory (§2.8: a code that identifies the
 * supplier lets anyone buy the same blank without us), and the server strips it from a
 * seller's copy of the product.
 *
 * The shape is deliberately dull: EG- and a number. A SKU's job is to be unique, typed
 * without error, and read aloud down a phone — not to encode the product, which is what
 * the product row is for. Anything cleverer (colour codes, supplier initials, size
 * letters) has to be re-derived every time one of those facts changes, and the SKU is the
 * one field that must never change once a listing quotes it back at us.
 *
 * Variants extend the base rather than replacing it: EG-1002-BLK-L. That is what the
 * publish route builds from sku_base, and stripping a print-method suffix (-EMB, -DTG, …)
 * still lands on the base a stock row is held against.
 */
export const EG_SKU = /^EG-(\d+)$/i

/** The first number we hand out. Four digits so an early product and a thousandth sort
 *  and read alike, and so nothing collides with the two-digit ids used elsewhere. */
const FIRST = 1001

/**
 * The next free EG SKU for this catalogue.
 *
 * Highest existing + 1 rather than count + 1: a deleted product would otherwise hand its
 * number to the next one created, and that number may already be printed on a purchase
 * order, a barcode, or a live listing somewhere. Numbers are never reused.
 */
export function nextEgSku(products: CatalogProduct[]): string {
  let top = FIRST - 1
  for (const p of products ?? []) {
    const m = EG_SKU.exec(String(p?.sku ?? "").trim())
    if (!m) continue
    /* A STYLE-DERIVED SKU DOES NOT ADVANCE THE SEQUENCE (2026-09-23).
       `egSkuFromStyle` mints EG-19000 from Gildan 19000, and those numbers land wherever the
       supplier's catalogue happens to sit — five digits up from anything we have handed out.
       Counting them would push the next SEQUENTIAL product to EG-19001, which then looks like
       a style number it is not, and collides the day somebody adds style 19001. A product
       whose sku is exactly its own supplier style is recognisable, so it is skipped. */
    if (skuMatchesStyle(p)) continue
    top = Math.max(top, Number(m[1]) || 0)
  }
  return `EG-${top + 1}`
}

/** Is this product's sku the one `egSkuFromStyle` would have minted for it? */
function skuMatchesStyle(p: CatalogProduct): boolean {
  const style = styleDigits((p as { supplierSku?: string | null }).supplierSku)
  if (!style) return false
  const own = String(p?.sku ?? "").trim().toUpperCase()
  return own === `EG-${style}`
}

const styleDigits = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")

/**
 * OUR SKU, BUILT FROM THE SUPPLIER'S STYLE NUMBER (owner, 2026-09-23: "Gildan code is 19000
 * and our suggestion is 18712 — it should stay close, so EG-19000").
 *
 * THE COST OF THIS IS KNOWN AND WAS ACCEPTED. The note at the top of this file is still true:
 * our sku is what publish writes onto the seller's listing, so EG-19000 tells any buyer which
 * blank the garment is and where else to buy it. That is the §2.9 harm, chosen deliberately
 * for the recognisability — it is not an oversight, and it should not be "fixed" back without
 * asking.
 *
 * THE STYLE, NOT THE SUPPLIER'S ROW ID. Callers pass `styleNo`, which for S&S is `styleName`
 * — 16 is S&S's internal id for what everyone else calls 5000, and minting EG-16 would be
 * both wrong and meaningless (CLAUDE.md §5).
 *
 * A TAKEN NUMBER IS NOT A COLLISION TO PAPER OVER (owner, 2026-09-23). EG-19000 already
 * existing almost always means the SAME GARMENT is already in the catalogue — Gildan 19000
 * is Gildan 19000 whether S&S or SanMar ships it — so an `EG-19000-2` would mint a duplicate
 * product and split its stock and its history in half. The sequence is offered instead: the
 * operator sees a number that is plainly not the style and knows to look before adding.
 *
 * Ordering is S&S first in practice, so this is rare by construction. A product that really
 * should carry two sources needs a sourcing list on the row, which is a different change and
 * is not pretended at here.
 */
export function egSkuFromStyle(
  styleNo: string | null | undefined,
  taken: readonly string[] | undefined,
  products: CatalogProduct[],
): string {
  const style = styleDigits(styleNo)
  if (!style) return nextEgSku(products)
  const used = new Set((taken ?? []).map((x) => String(x ?? "").trim().toUpperCase()).filter(Boolean))
  const base = `EG-${style}`
  return used.has(base) ? nextEgSku(products) : base
}

/** Tidy what someone typed into a SKU without arguing with them: upper-cased, spaces
 *  collapsed to hyphens, and anything that isn't a letter, digit or hyphen dropped —
 *  because a SKU travels through barcodes, CSVs and marketplace fields that each have
 *  their own opinion about punctuation. */
export function cleanSku(raw: string): string {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "")
}
