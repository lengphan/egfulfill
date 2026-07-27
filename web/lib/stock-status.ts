// Per-ORDER blank-stock status for the warehouse: can we actually make this order from
// stock on hand, or does something need buying? Reuses resolveProduct (the one blank-SKU
// resolver — mirrors the server) so a line resolves here exactly as it does for pricing and
// the barcode. Stock is held against the BLANK sku, so that's what we look up.
import { resolveProduct } from "@/lib/variant-resolve"
import type { CatalogProduct, OrderItem } from "@/lib/api"

export type StockState = "in" | "out" | "unknown"
export type StockLine = { item: OrderItem; sku: string; name: string; need: number; have: number | null }
export type OrderStock = { state: StockState; lines: StockLine[]; shortLines: StockLine[] }

// The blank SKU a line draws stock from (picked blank wins, else the resolved catalog
// blank), uppercased to match the stock map. "" when nothing resolves — an unstocked or
// not-yet-assigned line, which reads as the grey "unknown" state, not "out".
export function stockSkuOf(item: OrderItem, catalog: CatalogProduct[]): string {
  return String(resolveProduct(item, catalog)?.sku || item.blank || "").toUpperCase()
}

/**
 * Roll an order's lines up into one status:
 *   • "out"     — a resolved line is short (have < need). Actionable: send to a PO.
 *   • "in"      — every line resolves to a known blank and all have enough. (purple)
 *   • "unknown" — nothing resolves, or a mix we can't fully account for. (grey)
 * `stock` maps an uppercased blank SKU → units on hand. A SKU absent from the map is
 * `have: null` (we don't stock it / can't tell) — deliberately NOT treated as zero, since
 * "we don't track this blank" is not the same claim as "we have none".
 */
export function orderStock(items: OrderItem[], catalog: CatalogProduct[], stock: Record<string, number>): OrderStock {
  const lines: StockLine[] = (items ?? []).map((it) => {
    const sku = stockSkuOf(it, catalog)
    const have = sku && Object.prototype.hasOwnProperty.call(stock, sku) ? stock[sku] : null
    return { item: it, sku, name: it.name || it.sku || "Item", need: Number(it.qty) || 1, have }
  })
  const resolved = lines.filter((l) => l.have != null)
  const shortLines = resolved.filter((l) => (l.have as number) < l.need)
  let state: StockState
  if (shortLines.length) state = "out"
  else if (resolved.length > 0 && resolved.length === lines.length) state = "in"
  else state = "unknown"
  return { state, lines, shortLines }
}
