import type { CatalogProduct, OrderItem } from "@/lib/api"

// Client mirror of pricing.js matchProduct / eg-design-tools.js chosenProduct: resolve an
// order line to its catalog product. Picked blank (it.blank) wins; then the SKU matched
// against the product's base + variant SKUs (exact, then base↔variant prefix). Keep in
// step with the server — a line that resolves here but not there would price at zero.
export function variantSkusOf(p: CatalogProduct): string[] {
  const out: string[] = []
  const push = (s?: string | null) => { if (s) out.push(String(s).toUpperCase().trim()) }
  push(p.sku)
  for (const v of p.variantSkus ?? []) push(typeof v === "string" ? v : (v.sku ?? v.SKU))
  return out.filter(Boolean)
}

export function resolveProduct(item: OrderItem, catalog: CatalogProduct[]): CatalogProduct | null {
  const blank = String(item.blank || "").trim().toLowerCase()
  if (blank) {
    const hit = catalog.find((p) =>
      [p.name, p.sku, p.id].some((v) => v != null && String(v).trim().toLowerCase() === blank))
    if (hit) return hit
  }
  const s = String(item.sku || "").toUpperCase().trim()
  if (!s) return null
  for (const p of catalog) if (variantSkusOf(p).includes(s)) return p
  for (const p of catalog) {
    for (const c of variantSkusOf(p)) {
      if (s.startsWith(c + "-") || c.startsWith(s + "-")) return p
    }
  }
  return null
}

// Colours a product offers — the keys it was set up with (colorImages), plus its main
// colour. Empty ⇒ the picker falls back to free choice of the item's current value.
export function colorsOf(p: CatalogProduct | null): string[] {
  if (!p) return []
  const set = new Set<string>()
  if (p.mainColor) set.add(p.mainColor)
  for (const c of Object.keys(p.colorImages ?? {})) if (c) set.add(c)
  return [...set]
}

export function methodsOf(p: CatalogProduct | null): string[] {
  if (!p) return []
  const set = new Set<string>()
  for (const m of Object.keys(p.methodPrices ?? {})) if (m) set.add(m)
  if (p.method) set.add(p.method)
  return [...set]
}
