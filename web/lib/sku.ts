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
    if (m) top = Math.max(top, Number(m[1]) || 0)
  }
  return `EG-${top + 1}`
}

/** Tidy what someone typed into a SKU without arguing with them: upper-cased, spaces
 *  collapsed to hyphens, and anything that isn't a letter, digit or hyphen dropped —
 *  because a SKU travels through barcodes, CSVs and marketplace fields that each have
 *  their own opinion about punctuation. */
export function cleanSku(raw: string): string {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "")
}
