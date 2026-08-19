import type { CatalogProduct } from "@/lib/api"

/**
 * SUPPLIER VARIANT SKU → OURS.
 *
 * A supplier's catalogue is keyed by THEIR variant code — S&S's `B49795660` is one colour
 * in one size of one style. Ours is `EG-CAP-ORNSTN-ADJ`, built by variantSku(). Nothing
 * mapped the two, so adding a blank to the purchase cart straight from an S&S style put
 * their code on the line; receiving then credited a shelf row keyed by a string no order
 * line can ever resolve to, and the stock sat in the building with the chip still amber.
 *
 * `catalog_products.data.supplierSkus` records the pairing per variant — OURS as the key,
 * because that is the identity everything else in the system runs on and a variant may be
 * bought from more than one supplier over its life.
 *
 * `supplier_sku` on the product is NOT this. That is the style-level code (the whole
 * garment at the vendor), which cannot say which colour and size arrived in the box.
 */
export type SupplierSkuMap = Record<string, string>

/** The map a product carries, normalised — upper-cased on both sides so a hand-typed code
 *  matches a synced one. */
export function supplierSkusOf(p: CatalogProduct | null | undefined): SupplierSkuMap {
  const raw = (p as { supplierSkus?: unknown } | null | undefined)?.supplierSkus
  if (!raw || typeof raw !== "object") return {}
  const out: SupplierSkuMap = {}
  for (const [ours, theirs] of Object.entries(raw as Record<string, unknown>)) {
    const a = String(ours || "").trim().toUpperCase()
    const b = String(theirs || "").trim().toUpperCase()
    if (a && b) out[a] = b
  }
  return out
}

/** What we call the thing a supplier calls `supplierSku`, or null when nobody has said. */
export function ourSkuFor(catalog: CatalogProduct[], supplierSku: string): { sku: string; product: CatalogProduct } | null {
  const want = String(supplierSku || "").trim().toUpperCase()
  if (!want) return null
  for (const p of catalog) {
    for (const [ours, theirs] of Object.entries(supplierSkusOf(p))) {
      if (theirs === want) return { sku: ours, product: p }
    }
  }
  return null
}

/**
 * Everything a caller needs to explain a REFUSAL — which is most of this file's job.
 *
 * A cart that silently accepts an unmapped variant is how the island gets created, and a
 * cart that refuses without saying which product to open is a dead end. So the answer
 * carries the style match when there is one: we usually DO hold the garment, and only this
 * colour/size pairing is unrecorded.
 */
export function mappingGap(catalog: CatalogProduct[], opts: { supplierSku: string; styleSupplierSku?: string | null; name?: string | null }):
  { mapped: { sku: string; product: CatalogProduct } | null; styleMatch: CatalogProduct | null } {
  const mapped = ourSkuFor(catalog, opts.supplierSku)
  if (mapped) return { mapped, styleMatch: null }
  // The STYLE may still be one of ours even when this variant is not recorded — matched on
  // the product-level supplier_sku first, then on an exact name, which is what a person
  // would do by eye.
  const style = String(opts.styleSupplierSku || "").trim().toUpperCase()
  const name = String(opts.name || "").trim().toLowerCase()
  const styleMatch = catalog.find((p) => {
    const ps = String((p as { supplierSku?: string; supplier_sku?: string }).supplierSku
      ?? (p as { supplier_sku?: string }).supplier_sku ?? "").trim().toUpperCase()
    return (style && ps && ps === style) || (!!name && String(p.name ?? "").trim().toLowerCase() === name)
  }) ?? null
  return { mapped: null, styleMatch }
}
