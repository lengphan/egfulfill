// Order pricing — ported VERBATIM from orders.html (_resolveItemUnitPrice,
// _resolveOrderShipping, _recomputeOrderTotal). This logic lives in the FRONTEND
// (the backend trusts the client's `total`), so it must be reproduced faithfully:
// base garment/size price + per-method surcharge, and first-item + additional-item
// shipping resolved from the catalog product. Do NOT simplify to a naive sum.
import { blankCandidates } from "@/lib/variant-resolve"
import type { CatalogProduct } from "./api"

// Global shipping fallbacks (orders.html ODM_SHIP_FIRST / ODM_SHIP_ADDL).
export const SHIP_FIRST = 6.5
export const SHIP_ADDL = 2.5

type PricingItem = {
  sku?: string | null
  size?: string | null
  tech?: string | null
  blank?: string | null
  qty?: number | string | null
  shipping?: number | null
}
// CatalogProduct is permissive; these are the extra pricing fields the old catalog carries.
type PricedProduct = CatalogProduct & {
  variantSkus?: Array<{ sku?: string }>
  sizePrices?: Array<{ size?: string | number; sizes?: string; price?: number | string; upcharge?: number | string; shipping?: number | string }>
  methodPrices?: Record<string, number | string>
  shippingFee?: number | string
  additionalItemShipping?: number | string
  price?: number | string
  basePrice?: number | string
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v))
  return isNaN(n) ? NaN : n
}

/**
 * THE THIRD COPY OF "WHICH BLANK IS THIS LINE", and the one the split was never applied to.
 *
 * `p.name === item.blank` is an exact match against the NAME, and the blank cell has held
 * `EG-1001 - Classic Tee` since the grid and the import sheet started offering it — so an
 * imported order estimated at $0 while the same line priced correctly on the server, which
 * reads as the importer losing the prices. blankCandidates is the same splitter
 * resolveProduct and matchProduct use: whole string first, then each half.
 */
function findProduct(item: PricingItem, catalog: PricedProduct[]): PricedProduct | undefined {
  const base = String(item.sku || "").split("-")[0]
  const cands = item.blank ? blankCandidates(String(item.blank).trim().toLowerCase()) : []
  return catalog.find(
    (p) =>
      (Array.isArray(p.variantSkus) && p.variantSkus.some((v) => v && (typeof v === "string" ? v : v.sku) === item.sku)) ||
      (p.sku && base && String(p.sku).toUpperCase() === base.toUpperCase()) ||
      (cands.length > 0 && [p.name, p.sku].some((v) => v != null && cands.includes(String(v).trim().toLowerCase())))
  )
}

/** Base (garment/size) price + per-method surcharge. Placeholder rows → 0. */
export function resolveItemUnitPrice(item: PricingItem, catalog: PricedProduct[]): number {
  if (!item) return 0
  const isPlaceholder = !item.blank && (!item.sku || String(item.sku).startsWith("NEW-"))
  if (isPlaceholder) return 0
  const product = findProduct(item, catalog)
  if (!product) return 0

  const itemSize = String(item.size || "").trim().toLowerCase()
  let base: number | null = null
  if (Array.isArray(product.sizePrices) && product.sizePrices.length) {
    for (const row of product.sizePrices) {
      if (row.size != null) {
        if (itemSize && String(row.size).toLowerCase() === itemSize) {
          const ap = num(row.price)
          if (!isNaN(ap) && ap > 0) { base = ap; break }
        }
      } else if (row.sizes) {
        const sizes = String(row.sizes).toLowerCase().split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
        if (itemSize && sizes.includes(itemSize)) {
          const basePrice = num(product.price) || 0
          const u = row.upcharge != null ? num(row.upcharge) : row.price != null ? Math.max(0, num(row.price) - basePrice) : 0
          base = basePrice + (!isNaN(u) && u > 0 ? u : 0)
          break
        }
      }
    }
  }
  if (base == null) {
    const bp = num(product.basePrice)
    if (!isNaN(bp) && bp > 0) base = bp
    else { const alt = num(product.price); if (!isNaN(alt) && alt > 0) base = alt }
  }

  let methodAddOn = 0
  if (item.tech && product.methodPrices && typeof product.methodPrices === "object") {
    const t = String(item.tech).toUpperCase()
    const key = /EMB/.test(t) ? "EMB" : /DTF/.test(t) ? "DTF" : /APL|APPLIQ/.test(t) ? "APL" : /LSR|LASER/.test(t) ? "LSR" : /DTG|DIRECT/.test(t) ? "DTG" : t
    const mp = num(product.methodPrices[key] != null ? product.methodPrices[key] : product.methodPrices[String(item.tech)])
    if (!isNaN(mp) && mp > 0) methodAddOn = mp
  }
  if (base != null) return base + methodAddOn
  if (methodAddOn > 0) return methodAddOn
  return 0
}

/** First unit pays the first-item fee; every other unit pays the additional fee. */
export function resolveOrderShipping(items: PricingItem[], catalog: PricedProduct[] = []): number {
  const units: Array<{ base: number; addl: number }> = []
  for (const it of items || []) {
    if (!it) continue
    const qty = parseInt(String(it.qty), 10) || 1
    const product = findProduct(it, catalog)
    let baseFee: number
    let addlFee: number
    if (product) {
      baseFee = NaN
      const itemSize = String(it.size || "").trim().toLowerCase()
      if (itemSize && Array.isArray(product.sizePrices)) {
        const row = product.sizePrices.find((r) => r.size != null && String(r.size).toLowerCase() === itemSize)
        if (row && row.shipping != null) { const rs = num(row.shipping); if (!isNaN(rs) && rs >= 0) baseFee = rs }
      }
      if (isNaN(baseFee) && product.shippingFee != null) { const sf = num(product.shippingFee); if (!isNaN(sf) && sf >= 0) baseFee = sf }
      if (isNaN(baseFee)) baseFee = SHIP_FIRST
      addlFee = product.additionalItemShipping != null && String(product.additionalItemShipping) !== "" && !isNaN(num(product.additionalItemShipping)) ? num(product.additionalItemShipping) : SHIP_ADDL
    } else {
      baseFee = typeof it.shipping === "number" ? it.shipping : SHIP_FIRST
      addlFee = SHIP_ADDL
    }
    for (let u = 0; u < qty; u++) units.push({ base: baseFee, addl: addlFee })
  }
  if (!units.length) return 0
  let total = units[0].base
  for (let k = 1; k < units.length; k++) total += units[k].addl
  return Math.round(total * 100) / 100
}

/** Σ(unit × qty) + order shipping. For manual orders, pass unitPrice per line. */
export function orderTotal(
  items: Array<PricingItem & { unitPrice?: number | string }>,
  catalog: PricedProduct[] = []
): { subtotal: number; shipping: number; total: number } {
  let subtotal = 0
  for (const it of items || []) {
    const qty = parseInt(String(it.qty), 10) || 1
    const unit = it.unitPrice != null ? num(it.unitPrice) || 0 : resolveItemUnitPrice(it, catalog)
    subtotal += unit * qty
  }
  subtotal = Math.round(subtotal * 100) / 100
  const shipping = resolveOrderShipping(items, catalog)
  return { subtotal, shipping, total: Math.round((subtotal + shipping) * 100) / 100 }
}
