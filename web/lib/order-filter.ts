// Searching and narrowing a list of orders. ONE implementation, imported by every board —
// the staff hub and the seller list both render the same OrderRow, so a private copy here is
// how "Etsy" ends up meaning two different things on two screens (the exact drift
// order-format.ts exists to prevent).
//
// Everything is client-side over the already-loaded list. The boards fetch the whole queue
// once and re-render from it, so a server round-trip per keystroke would be slower AND would
// make typing depend on the network.

import { type OrderRow, type OrderItem, type CatalogProduct } from "@/lib/api"
import { numOf, platformOf, decodeEntities } from "@/lib/order-format"
import { normalizeMethods, PRODUCT_METHODS, type PrintMethod } from "@/lib/print-method"
import { ALL_STATUSES, orderStage, isException } from "@/lib/factory-status"
import { orderReadiness } from "@/lib/order-readiness"
import { orderStock } from "@/lib/stock-status"

export type OrderQuery = {
  /** Free text — order number, customer, tracking, store, SKU, item name. */
  text: string
  /** Production stage. "" = any · "draft" = arrived, not started · "issues" = any exception
   *  state · otherwise a canonical stage id from factory-status.ts.
   *
   *  "draft" is spelled out rather than reusing the stage's own id, which is the empty
   *  string — "" already means "no filter" here, and one value can't mean both. */
  status: string
  /** One readiness chip in a given state, as `"<tag>:<state>"` — e.g. `"design:done"`.
   *  "" = any. Values come from READY_OPTIONS; nothing else parses. */
  ready: string
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

export const EMPTY_ORDER_QUERY: OrderQuery = { text: "", status: "", ready: "", platform: "", store: "", method: "", days: null }

/** Is anything actually narrowing the list? Drives whether a "Clear" affordance shows —
 *  and, more importantly, whether an empty result should read "no orders" or "no matches". */
export const isOrderQueryActive = (q: OrderQuery) =>
  !!(q.text.trim() || q.status || q.ready || q.platform || q.store || q.method || q.days !== null)

export const activeFilterCount = (q: OrderQuery) =>
  (q.text.trim() ? 1 : 0) + (q.status ? 1 : 0) + (q.ready ? 1 : 0) +
  (q.platform ? 1 : 0) + (q.store ? 1 : 0) + (q.method ? 1 : 0) + (q.days !== null ? 1 : 0)

/** How a status value reads in a sentence. The two pseudo-values the pills add on top of the
 *  canonical stage ids come first; everything else is looked up in the pipeline itself, so a
 *  stage added to factory-status.ts is named here without being listed twice. */
export const statusLabel = (v: string) =>
  v === "draft" ? "Draft"
  : v === "issues" ? "Issues"
  : ALL_STATUSES.find((s) => s.id === v)?.label ?? v

/** Does an order sit at this Status filter value? */
export function matchesStatus(o: OrderRow, value: string): boolean {
  if (!value) return true
  const stage = orderStage(o.items ?? [])
  if (value === "draft") return stage === ""
  if (value === "issues") return isException(stage)
  return stage === value
}

/** The Prep dropdown's roster.
 *
 *  The NOT-DONE half comes first: "which orders still need a label" is the question a floor
 *  actually asks, and burying it under its own inverse makes the control read as a report
 *  rather than a work list. Amber ("doing") counts as not-done — a design waiting on
 *  approval is not a design you can print.
 *
 *  Stock is only offered when the caller can actually evaluate it (see FilterContext) —
 *  an option that can only ever return nothing is worse than one that isn't there. */
export const READY_OPTIONS: { value: string; label: string; stock?: true }[] = [
  { value: "label:todo", label: "Needs a label" },
  { value: "scan:todo", label: "Not scanned" },
  { value: "design:todo", label: "Design not ready" },
  { value: "stock:out", label: "Short on stock", stock: true },
  { value: "label:done", label: "Label bought" },
  { value: "scan:done", label: "Scanned" },
  { value: "design:done", label: "Design approved" },
  { value: "stock:in", label: "In stock", stock: true },
]

export const readyLabel = (v: string) => READY_OPTIONS.find((o) => o.value === v)?.label ?? v

/** What the stock half of the Prep filter needs to answer at all: stock is held against the
 *  BLANK sku, so a line has to be resolved through the catalog before it can be looked up. */
export type FilterContext = { catalog?: CatalogProduct[]; stock?: Record<string, number> }

/**
 * Does an order match a Prep filter value?
 *
 * Readiness is read from `orderReadiness` with NO per-row designs/files — deliberately.
 * Those are fetched lazily for expanded rows only, so feeding them in would make a row
 * appear or vanish from the list the moment someone expanded a different one. The row-level
 * flags are exactly what a collapsed chip already shows.
 */
export function matchesReady(o: OrderRow, value: string, ctx: FilterContext = {}): boolean {
  if (!value) return true
  const [tag, want] = value.split(":")
  if (tag === "stock") {
    if (!ctx.catalog) return false          // can't be evaluated; the option isn't offered either
    const { state } = orderStock(o.items ?? [], ctx.catalog, ctx.stock ?? {})
    return state === want
  }
  const r = orderReadiness(o)
  const state = tag === "label" ? r.label.state : tag === "scan" ? r.scan.state : tag === "design" ? r.design.state : null
  if (!state) return false
  // "todo" in the filter means NOT DONE, which includes amber. A design waiting on approval
  // is still work; splitting it into a third option would be a truer model of the chip and a
  // worse control — nobody queues by "amber".
  return want === "done" ? state === "done" : state !== "done"
}

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

export function matchesOrderQuery(o: OrderRow, q: OrderQuery, cutoff?: number, ctx: FilterContext = {}): boolean {
  if (q.status && !matchesStatus(o, q.status)) return false
  if (q.ready && !matchesReady(o, q.ready, ctx)) return false
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
export function filterOrders(orders: OrderRow[], q: OrderQuery, ctx: FilterContext = {}): OrderRow[] {
  if (!isOrderQueryActive(q)) return orders
  const cutoff = q.days !== null ? cutoffFor(q.days) : undefined
  return orders.filter((o) => matchesOrderQuery(o, q, cutoff, ctx))
}
