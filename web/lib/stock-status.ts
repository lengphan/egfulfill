// Per-ORDER blank-stock status for the warehouse: can we actually make this order from
// stock on hand, or does something need buying? Reuses resolveProduct (the one blank-SKU
// resolver — mirrors the server) so a line resolves here exactly as it does for pricing and
// the barcode. Stock is held against the BLANK sku, so that's what we look up.
import { resolveProduct } from "@/lib/variant-resolve"
import { variantSku } from "@/lib/variant-sku"
import type { CatalogProduct, OrderItem } from "@/lib/api"

/**
 * MIRRORS server/src/replenish.js — change both.
 *
 * An order line carries a print-method suffix that the shelf doesn't: the line is
 * "LA6-EMB", the stock row is "LA6". The server strips it before matching (stripMethod,
 * exported there for exactly this reason); this file did not, so a line would read
 * "not stocked" here while replenishment found plenty — the two halves of the same
 * question disagreeing, which is worse than either answer.
 */
const METHOD_SUFFIX = /-(EMB|DTG|DTF|APL|LSR|SUB|SCR)$/i
const stripMethod = (s: string) => s.trim().replace(METHOD_SUFFIX, "")

export type StockState = "in" | "out" | "unknown"

/**
 * WHY a line has no stock answer. Grey used to mean five different things at once, which
 * is how the chip sat unlit over 1,089 order lines without anyone being able to tell it
 * from "we simply don't stock that": every one of those lines fails at one of these three
 * links, and the chip could not say which.
 *
 *   "no-product"  nothing resolved this line to a catalog product — no blank picked, and
 *                 its marketplace sku matches no product's variant skus.
 *   "no-sku"      the product resolved, but it carries NO sku of its own, so there is no
 *                 key to hold stock against. This is a product-setup gap, not a stock one.
 *   "not-stocked" a real sku, absent from the inventory list — we don't track that blank.
 */
export type StockGap = "no-product" | "no-sku" | "not-stocked" | null

export type StockLine = {
  item: OrderItem
  sku: string
  name: string
  need: number
  have: number | null
  /** null once `have` is known — the line is answerable. */
  gap: StockGap
}
export type OrderStock = {
  state: StockState
  lines: StockLine[]
  shortLines: StockLine[]
  /** One sentence naming the FIRST thing that has to be fixed for this order to have an
   *  answer, or "" when it already does. Written for the person reading the chip. */
  why: string
}

/**
 * The SKU a line draws stock from — THE VARIANT first, the product only as a fallback.
 *
 * A shelf holds a size in a colour, not a product. This resolved to the product's own sku,
 * so a line for a 3XL in Forest Green was answered by one number covering every size and
 * colour the product has: "in stock" could be true of the product and false of the only
 * thing being made.
 *
 * `stock` is optional and is EVIDENCE, not decoration: the variant key wins only when the
 * map actually holds it. A product stocked the old way — one row, product sku — keeps being
 * read that way, so nothing has to be migrated for this to be safe, and a variant nobody
 * has counted yet falls back rather than reporting a confident zero.
 *
 * "" when nothing resolves — an unstocked or not-yet-assigned line, which reads as the grey
 * "unknown" state, not "out".
 */
/**
 * The keys a line's stock could be held under, most specific first.
 *
 * THREE, not two, because the product editor writes PER SIZE now (`EG-1001-L`) while stock
 * entered before that is per size AND colour (`EG-1001-L-BLK`), and older products are one
 * row for the whole style (`EG-1001`). A ladder that skipped the middle rung read a shelf
 * that had just been counted as untracked, and an order whose blanks were on hand showed no
 * answer at all — which also meant "add short blanks to a PO" skipped it, because only a
 * line with a known count can be called short.
 *
 * The map decides which rung applies; nothing is migrated for this to be safe.
 */
function stockKeys(productSku: string, size?: string | null, color?: string | null): string[] {
  const out: string[] = []
  const withColor = variantSku(productSku, size, color)
  const sizeOnly = variantSku(productSku, size, null)
  if (withColor) out.push(withColor)
  if (sizeOnly && sizeOnly !== withColor) out.push(sizeOnly)
  return out
}

export function stockSkuOf(item: OrderItem, catalog: CatalogProduct[], stock?: Record<string, number>): string {
  const product = resolveProduct(item, catalog)
  /**
   * SAME BASE RULE AS orderStock BELOW — fall back to the line's own blank ONLY when no
   * product resolved.
   *
   * This read `product?.sku || item.blank`, so a line that resolved to a product carrying no
   * sku of its own fell through to `blank` — which holds a product NAME on most real lines.
   * The name then became the stock key, and the two halves of one question gave opposite
   * instructions about the same order: the List column's chip said "the product behind Tee
   * has no SKU, give it one in Products" while the line under it offered an Add-to-inventory
   * button seeded with "UNISEX COTTON SHIRT".
   *
   * orderStock was fixed for exactly this and this was not — the divergence §5 names, in the
   * one file that exists to prevent it. Verified by driving both on the same line.
   */
  const productSku = stripMethod(String(product?.sku || "")).toUpperCase()
  const base = productSku || (product ? "" : stripMethod(String(item.blank || "")).toUpperCase())
  if (!base) return ""
  const keys = stockKeys(product?.sku || "", item.size, item.color)
  // No map to consult (a caller that only wants the key it WOULD read) → the most specific.
  if (!stock) return keys[0] || base
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(stock, k)) return k
  return base
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
    const product = resolveProduct(it, catalog)
    const productSku = stripMethod(String(product?.sku || "")).toUpperCase()
    /**
     * FALL BACK TO THE LINE'S OWN BLANK ONLY WHEN NO PRODUCT RESOLVED.
     *
     * `blank` holds a product NAME on most real lines ("Unisex Cotton Shirt"), and
     * resolveProduct matches on name — so a line can resolve to a product that carries no
     * sku of its own. Falling through to the blank there turns a NAME into a stock key and
     * the chip then advises adding "UNISEX COTTON SHIRT" to Inventory, which is nonsense
     * dressed as instruction. When a product resolved, its sku is the only valid key; when
     * none did, the blank may genuinely be one (a line carrying EG-5000).
     */
    const base = productSku || (product ? "" : stripMethod(String(it.blank || "")).toUpperCase())
    /**
     * THE VARIANT'S OWN ROW WINS — when there is one.
     *
     * Same rule as stockSkuOf above, and it has to be applied HERE too because this walks
     * the lines itself: a chip built on the product row answers "have we got the product",
     * and the floor is asking "have we got the 3XL in Forest Green". The map decides — a
     * variant nobody has counted falls back to the product row rather than reporting a
     * confident zero for a shelf that was never split.
     */
    const sku = stockKeys(product?.sku || "", it.size, it.color).find((k) => Object.prototype.hasOwnProperty.call(stock, k)) ?? base
    const have = sku && Object.prototype.hasOwnProperty.call(stock, sku) ? stock[sku] : null
    // Which link broke, in the order the chain runs. A product that resolved but carries no
    // sku is the interesting one: it looks set up from every other screen, and is the exact
    // shape of the two catalogue rows that made this chip unlit everywhere.
    const gap: StockGap = have != null ? null
      : product && !productSku ? "no-sku"
      : !sku ? "no-product"
      : "not-stocked"
    return { item: it, sku, name: it.name || it.sku || "Item", need: Number(it.qty) || 1, have, gap }
  })
  const resolved = lines.filter((l) => l.have != null)
  const shortLines = resolved.filter((l) => (l.have as number) < l.need)
  let state: StockState
  if (shortLines.length) state = "out"
  else if (resolved.length > 0 && resolved.length === lines.length) state = "in"
  else state = "unknown"

  // Name the FIRST unanswerable line's gap rather than counting them. One fix at a time is
  // what the reader can act on, and the count is visible in the order anyway.
  const firstGap = lines.find((l) => l.gap)
  const why = !firstGap ? "" :
    firstGap.gap === "no-product"
      ? `“${firstGap.name}” isn't linked to a product yet — pick a blank on the order and stock can be counted.`
      : firstGap.gap === "no-sku"
        ? `The product behind “${firstGap.name}” has no SKU, so there's nothing to hold stock against. Give it one in Products.`
        : `${firstGap.sku} isn't in the stock list — add it in Inventory to track it.`
  return { state, lines, shortLines, why }
}
