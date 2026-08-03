// Searching and narrowing a list of orders. ONE implementation, imported by every board —
// the staff hub and the seller list both render the same OrderRow, so a private copy here is
// how "Etsy" ends up meaning two different things on two screens (the exact drift
// order-format.ts exists to prevent).
//
// Everything is client-side over the already-loaded list. The boards fetch the whole queue
// once and re-render from it, so a server round-trip per keystroke would be slower AND would
// make typing depend on the network.

import { type OrderRow, type OrderItem } from "@/lib/api"
import { numOf, platformOf, decodeEntities } from "@/lib/order-format"
import { normalizeMethods, PRODUCT_METHODS, type PrintMethod } from "@/lib/print-method"

export type OrderQuery = {
  /** Free text — order number, customer, tracking, store, SKU, item name. */
  text: string
  /** The platform as platformOf() writes it ("Etsy" / "TikTok" / "Manual"). "" = any.
   *  Stored as the DISPLAY name, not the raw source, so anything echoing the active filter
   *  back to the person spells the brand the way the rest of the app does. */
  platform: string
  /** Exact store/shop string as stored on the order. "" = any. */
  store: string
  /** Normalised print-method key from print-method.ts ("emb" / "dtf" / …). "" = any. */
  method: string
  /** How far back, in days. null = any time; 0 = today only. */
  days: number | null
}

export const EMPTY_ORDER_QUERY: OrderQuery = { text: "", platform: "", store: "", method: "", days: null }

/** Is anything actually narrowing the list? Drives whether a "Clear" affordance shows —
 *  and, more importantly, whether an empty result should read "no orders" or "no matches". */
export const isOrderQueryActive = (q: OrderQuery) =>
  !!(q.text.trim() || q.platform || q.store || q.method || q.days !== null)

export const activeFilterCount = (q: OrderQuery) =>
  (q.text.trim() ? 1 : 0) + (q.platform ? 1 : 0) + (q.store ? 1 : 0) + (q.method ? 1 : 0) + (q.days !== null ? 1 : 0)

export const DATE_RANGES: { label: string; days: number | null }[] = [
  { label: "Any time", days: null },
  { label: "Today", days: 0 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
]

export const dateRangeLabel = (days: number | null) =>
  DATE_RANGES.find((r) => r.days === days)?.label ?? "Any time"

// An order SKU carries a print-method suffix that the blank's own SKU doesn't
// (…-EMB / -DTG / -DTF / -APL / -LSR / -SUB / -SCR). It's the only method signal on lines
// imported from a marketplace, where print_type is usually unset — so a method filter that
// reads print_type alone silently misses every synced order.
const SKU_METHOD_SUFFIX = /-(EMB|DTG|DTF|APL|LSR|SUB|SCR)$/i
const skuMethod = (sku?: string | null) => String(sku || "").match(SKU_METHOD_SUFFIX)?.[1] ?? null

/** Every print method an order involves, normalised through the canonical vocabulary. */
export function methodsOfOrder(o: OrderRow): PrintMethod[] {
  return normalizeMethods((o.items ?? []).flatMap((it: OrderItem) => [it.print_type, skuMethod(it.sku)]))
}

/** The filter options actually present in THIS list.
 *
 *  Derived from the data, never a hardcoded roster: offering "Shopify" to a factory that has
 *  never had a Shopify order is a dropdown entry that can only ever return nothing, and an
 *  empty result the person can't distinguish from a broken filter. */
export function orderFacets(orders: OrderRow[]) {
  const platforms = new Set<string>()
  const stores = new Set<string>()
  const methods = new Map<string, string>()     // key → label

  for (const o of orders) {
    platforms.add(platformOf(o))
    const store = (o.store || "").trim()
    if (store) stores.add(store)
    // normTech labels a technique as a phrase ("DTF printing") because it's written into
    // sentences elsewhere; a filter wants the short name the picker uses ("DTF"), so prefer
    // the canonical roster's label and fall back to the phrase for anything not on it.
    for (const m of methodsOfOrder(o)) methods.set(m.key, PRODUCT_METHODS.find((p) => p.key === m.key)?.label ?? m.label)
  }
  return {
    platforms: [...platforms].sort((a, b) => a.localeCompare(b)),
    stores: [...stores].sort((a, b) => a.localeCompare(b)),
    methods: [...methods].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
  }
}

/** Everything a person might type to find this order, as one lowercase haystack.
 *
 *  Personalization is decoded first: it arrives HTML-escaped from Etsy, so searching for a
 *  name the buyer typed would otherwise miss the very orders that carry it. */
function haystack(o: OrderRow): string {
  return [
    numOf(o), o.id, String(o.seq ?? ""),
    o.customer?.name, o.customer?.email,
    o.store, o.source, o.tracking, o.carrier,
    ...(o.items ?? []).flatMap((it) => [it.sku, it.name, it.color, it.size, it.print_type, decodeEntities(it.personalization)]),
  ].filter(Boolean).join(" ").toLowerCase()
}

/** Oldest timestamp an order may carry to survive a `days` window. */
function cutoffFor(days: number): number {
  const d = new Date()
  if (days === 0) { d.setHours(0, 0, 0, 0); return d.getTime() }   // "Today" = since midnight, local
  return Date.now() - days * 86400_000
}

export function matchesOrderQuery(o: OrderRow, q: OrderQuery, cutoff?: number): boolean {
  if (q.platform && platformOf(o) !== q.platform) return false
  if (q.store && (o.store || "").trim() !== q.store) return false
  if (q.method && !methodsOfOrder(o).some((m) => m.key === q.method)) return false
  if (cutoff != null) {
    // An order with no date can't be shown to fall inside a window — dropping it is the
    // honest answer to "orders from the last 7 days", not a guess either way.
    const t = o.created_at ? new Date(o.created_at).getTime() : NaN
    if (!Number.isFinite(t) || t < cutoff) return false
  }
  const term = q.text.trim().toLowerCase()
  if (term) {
    // Built once, not once per word — every() over a rebuilt haystack walks every line item
    // again for each word typed. All words must hit, so "olvera hoodie" narrows rather than
    // widening the way a single substring match would.
    const hay = haystack(o)
    if (!term.split(/\s+/).every((word) => hay.includes(word))) return false
  }
  return true
}

/** Apply a query to a list. The date cutoff is computed ONCE per pass, not per order. */
export function filterOrders(orders: OrderRow[], q: OrderQuery): OrderRow[] {
  if (!isOrderQueryActive(q)) return orders
  const cutoff = q.days !== null ? cutoffFor(q.days) : undefined
  return orders.filter((o) => matchesOrderQuery(o, q, cutoff))
}
