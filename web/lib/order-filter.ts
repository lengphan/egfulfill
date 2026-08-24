// Searching and narrowing a list of orders. ONE implementation, imported by every board —
// the staff hub and the seller list both render the same OrderRow, so a private copy here is
// how "Etsy" ends up meaning two different things on two screens (the exact drift
// order-format.ts exists to prevent).
//
// Everything is client-side over the already-loaded list. The boards fetch the whole queue
// once and re-render from it, so a server round-trip per keystroke would be slower AND would
// make typing depend on the network.

import { type OrderRow, type OrderItem, type CatalogProduct } from "@/lib/api"
import { designSearchTerms } from "@/lib/design-id"
import { numOf, platformOf, decodeEntities } from "@/lib/order-format"
import { normalizeMethods, methodByKey, type PrintMethod } from "@/lib/print-method"
import { ALL_STATUSES, FACTORY_STAGES, EXCEPTION_STAGES, orderStage, isException } from "@/lib/factory-status"
import { orderReadiness } from "@/lib/order-readiness"
import { orderStock } from "@/lib/stock-status"

export type OrderQuery = {
  /** Free text — order number, customer, tracking, store, SKU, item name. */
  text: string
  /** Production stage. "" = any · "open" = still live work (not shipped, not an exception) ·
   *  "draft" = arrived, not started · "issues" = any exception state · otherwise a canonical
   *  stage id from factory-status.ts.
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
  /** How far back, in days. null = any time; 0 = today only. One of the presets in
   *  DATE_RANGES — IGNORED while `from`/`to` carry a custom window, so the two can never
   *  quietly intersect into a third range nobody chose. */
  days: number | null
  /** A window the person typed, as LOCAL calendar dates ("YYYY-MM-DD"). "" = that end is
   *  open, so "since the 3rd" and "up to the 9th" are both sayable with one field.
   *  `to` includes the whole day it names. */
  from: string
  to: string
}

export const EMPTY_ORDER_QUERY: OrderQuery = { text: "", status: "", ready: "", platform: "", store: "", method: "", days: null, from: "", to: "" }

/** Is anything actually narrowing the list? Drives whether a "Clear" affordance shows —
 *  and, more importantly, whether an empty result should read "no orders" or "no matches". */
export const isOrderQueryActive = (q: OrderQuery) =>
  !!(q.text.trim() || q.status || q.ready || q.platform || q.store || q.method || hasDateFilter(q))

export const activeFilterCount = (q: OrderQuery) =>
  (q.text.trim() ? 1 : 0) + (q.status ? 1 : 0) + (q.ready ? 1 : 0) +
  // ONE, whether it is a preset or a typed window — a person who set two dates set one
  // date filter, and counting the halves would report a filter they cannot turn off twice.
  (q.platform ? 1 : 0) + (q.store ? 1 : 0) + (q.method ? 1 : 0) + (hasDateFilter(q) ? 1 : 0)

/** How a status value reads in a sentence. The two pseudo-values the pills add on top of the
 *  canonical stage ids come first; everything else is looked up in the pipeline itself, so a
 *  stage added to factory-status.ts is named here without being listed twice. */
export const statusLabel = (v: string) =>
  v === "open" ? "Open"
  : v === "overdue" ? "Overdue"
  : v === "rush" ? "Rush"
  : v === "draft" ? "Draft"
  : v === "issues" ? "Issues"
  : ALL_STATUSES.find((s) => s.id === v)?.label ?? v

/**
 * The stage pills, in row order. Derived from the canonical pipeline so a stage added to
 * factory-status.ts turns up here instead of quietly becoming unfilterable.
 *
 * "" (All) is not a status — it's the cleared state, and it's the one pill that can never be
 * hidden or toggled off.
 */
export const STATUS_PILLS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  // "Open" = there is still work to do on it. Not a stage — a stage answers "where is it",
  // this answers "is anyone still waiting on us", which is what the stat cards count and
  // what a floor means by "my queue".
  { value: "open", label: "Open" },
  // Late and flagged sit next to Open because they answer the same question — "what should
  // I be doing" — rather than "where is it", which is what every stage pill below answers.
  { value: "rush", label: "Rush" },
  { value: "overdue", label: "Overdue" },
  { value: "draft", label: "Draft" },
  ...FACTORY_STAGES.map((s) => ({ value: s.id, label: s.label })),
  { value: "issues", label: "Issues" },
  ...EXCEPTION_STAGES.map((s) => ({ value: s.id, label: s.label })),
]

// Which pills a person has taken OFF their row, persisted per browser — the same shape as the
// column prefs in order-columns.ts, and for the same reason: storing what's HIDDEN means a
// stage added later shows up by default rather than being invisible to everyone who ever
// customised the row.
//
// The three exception states start hidden. All ten pills at once was a wall of tabs, and
// most days a floor never filters by Refunded — but when it does, it wants a pill, not a
// dropdown. So they ship behind the "+" instead of being absent.
const PILLS_KEY = "eg_factory_status_pills_hidden"
// "Open" ships hidden too: the stat cards above the board are how most people reach it, and
// it would otherwise push the row wider for a pill many floors never click.
const DEFAULT_HIDDEN_PILLS: string[] = ["open", ...EXCEPTION_STAGES.map((s) => s.id)]
const PILL_VALUES = new Set(STATUS_PILLS.map((p) => p.value))

export function loadHiddenStatusPills(): string[] {
  try {
    const raw = localStorage.getItem(PILLS_KEY)
    if (raw === null) return [...DEFAULT_HIDDEN_PILLS]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_HIDDEN_PILLS]
    // "" can never be hidden, even if an old save says so — a row with no way back to
    // unfiltered is a trap.
    return parsed.filter((v): v is string => typeof v === "string" && v !== "" && PILL_VALUES.has(v))
  } catch { return [...DEFAULT_HIDDEN_PILLS] }
}
export function saveHiddenStatusPills(ids: string[]) {
  try { localStorage.setItem(PILLS_KEY, JSON.stringify(ids)) } catch {}
}

/** Does an order sit at this Status filter value? */
export function matchesStatus(o: OrderRow, value: string, ctx: FilterContext = {}): boolean {
  if (!value) return true
  // These two sit OUTSIDE the pipeline: an order is late, or flagged, at whatever stage it
  // happens to be in. Handled before orderStage so they never collide with a stage id.
  if (value === "overdue") return isOverdue(o, ctx.overdueDays)
  if (value === "rush") return isRush(o)
  const stage = orderStage(o.items ?? [])
  if (value === "open") return !isException(stage) && stage !== "shipped"
  if (value === "draft") return stage === ""
  if (value === "issues") return isException(stage)
  return stage === value
}

/** The List dropdown's roster.
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

/** What the stock half of the List filter needs to answer at all: stock is held against the
 *  BLANK sku, so a line has to be resolved through the catalog before it can be looked up. */
export type FilterContext = {
  catalog?: CatalogProduct[]
  stock?: Record<string, number>
  /** Age in days past which an OPEN order with NO marketplace promise counts as overdue —
   *  factory_settings.overdue_days, set by an admin. The FALLBACK, not the rule: an order
   *  carrying Etsy's own ship-by date is judged against that instead (see isOverdue). */
  overdueDays?: number
}

/** Default when settings haven't loaded. Matches SETTING_DEFAULTS.overdue_days on the server. */
export const DEFAULT_OVERDUE_DAYS = 10

/**
 * The date this order was PROMISED to ship, if the marketplace gave us one.
 *
 * Etsy does, per line, and we keep the earliest (see the sync in etsy.js). Nothing else
 * does yet, so this is null for manual orders and for TikTok/Shopify.
 */
export const shipByOf = (o: OrderRow): number | null => {
  const t = o.ship_by ? new Date(o.ship_by).getTime() : NaN
  return Number.isFinite(t) ? t : null
}

/**
 * Is this order late?
 *
 * AGAINST THE PROMISE WHERE THERE IS ONE. An age threshold is a guess about a promise, and
 * it is wrong in both directions: a 2-day blank tee and a digitised embroidery order are
 * not equally late on day 10. Etsy tells us the date it showed the buyer, and it is the
 * same date Etsy measures the shop's late-shipment rate against — so where we have it, it
 * decides, and `days` is not consulted at all.
 *
 * The age threshold remains the fallback for everything with no promise attached (manual
 * orders, and any channel we haven't captured one from). That is a real difference in
 * confidence between two rows in the same list, which is why `overdueReason` exists — a
 * screen that says "late" should be able to say on what authority.
 *
 * Late-and-workable versus late-and-blocked stays a separate question, answered by the
 * caller: pinning unstartable work above the print queue only teaches a floor to scroll
 * past overdue orders, which costs you the ones they COULD have started.
 */
export function isOverdue(o: OrderRow, days = DEFAULT_OVERDUE_DAYS): boolean {
  if (!matchesStatus(o, "open")) return false          // shipped or excepted is not late
  const promised = shipByOf(o)
  if (promised != null) return Date.now() > promised
  const created = o.created_at ? new Date(o.created_at).getTime() : NaN
  if (!Number.isFinite(created)) return false          // no date is not evidence of lateness
  return Date.now() - created > days * 86400_000
}

/** WHY we call it late, so a screen can say so. "promise" is Etsy's own ship-by date;
 *  "age" is our threshold standing in for one. */
export const overdueReason = (o: OrderRow): "promise" | "age" =>
  shipByOf(o) != null ? "promise" : "age"

/** A rush is a DECISION someone made; overdue is a fact about the clock. Both jump the
 *  queue, but only one of them can be argued with. */
export const isRush = (o: OrderRow): boolean => !!(o as { rush?: boolean }).rush

/**
 * Does an order match a List filter value?
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

/** The value the Date picker carries while a typed window is in force. Not a `days` number:
 *  a custom range is a different KIND of answer, and giving it a fake day count is how the
 *  two end up intersecting. */
export const CUSTOM_RANGE = "custom"

export const hasDateFilter = (q: OrderQuery) => q.days !== null || !!q.from || !!q.to
export const hasCustomRange = (q: OrderQuery) => !!q.from || !!q.to

/** A "YYYY-MM-DD" field value as LOCAL midnight.
 *
 *  `new Date("2026-08-03")` is parsed as UTC, so on a US floor it lands at 5pm on the 2nd —
 *  the window would open half a day early and a whole day's orders would sort into the
 *  wrong end of it. Built from parts instead, which is local by definition. */
function localDay(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || "").trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(d.getTime()) ? d.getTime() : null
}

/** A Date as the "YYYY-MM-DD" an `<input type="date">` reads, in LOCAL time. `toISOString`
 *  is UTC, so after 5pm in New York it writes tomorrow — the same half-day slip as above,
 *  in the other direction. */
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** Formats one edge of a window for a sentence — "3 Aug". */
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" })

export type DateWindow = { from?: number; to?: number }

/**
 * The window a query asks for, in epoch ms, or null for "any time".
 *
 * A typed window WINS over the preset — the preset is what the picker falls back to, and an
 * order that satisfies both is not the same list as an order that satisfies the tighter one.
 *
 * `to` runs to the LAST MILLISECOND of the day it names: someone picking 9 Aug means
 * everything that arrived on the 9th, not everything up to midnight as it began.
 * A backwards range is swapped rather than returning nothing — an empty table is
 * indistinguishable from a broken filter, and two dates in the other order is plainly one
 * range typed the other way round.
 */
export function dateWindow(q: OrderQuery): DateWindow | null {
  let from = localDay(q.from)
  let to = localDay(q.to)
  if (from != null || to != null) {
    if (from != null && to != null && from > to) [from, to] = [to, from]
    return { from: from ?? undefined, to: to == null ? undefined : to + 86400_000 - 1 }
  }
  if (q.days !== null) return { from: cutoffFor(q.days) }
  return null
}

/** How the active date filter reads in a sentence, or null when none is set. Presets return
 *  their catalogue label (so a caller can translate it); a typed window returns dates, which
 *  no catalogue can hold. */
export function dateFilterLabel(q: OrderQuery): string | null {
  const win = dateWindow(q)
  if (!win) return null
  if (!hasCustomRange(q)) return dateRangeLabel(q.days)
  const from = localDay(q.from)
  const to = localDay(q.to)
  if (from != null && to != null) return from > to ? `${fmtDay(to)} – ${fmtDay(from)}` : `${fmtDay(from)} – ${fmtDay(to)}`
  return from != null ? `from ${fmtDay(from)}` : `up to ${fmtDay(to as number)}`
}

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
    // Whatever the ORDERS actually carry, named properly — including techniques we have
    // stopped offering. This read the offered list, so a retired method fell back to
    // normTech's own label rather than the table's.
    for (const m of methodsOfOrder(o)) methods.set(m.key, methodByKey(m.key)?.label ?? m.label)
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
    // The ARTWORK, by name and by number. Typing "dsn-1042" or a design's name finds every
    // order printing it, which is how similar work gets batched — the reason this was
    // asked for. Both forms of the number are indexed ("dsn-1042" and "1042") so neither
    // spelling misses.
    ...(o.items ?? []).flatMap((it) => [
      it.sku, it.name, it.color, it.size, it.print_type,
      it.design_name,
      designSearchTerms(it.design_no),
      decodeEntities(it.personalization),
    ]),
  ].filter(Boolean).join(" ").toLowerCase()
}

/** Oldest timestamp an order may carry to survive a `days` window. */
function cutoffFor(days: number): number {
  const d = new Date()
  if (days === 0) { d.setHours(0, 0, 0, 0); return d.getTime() }   // "Today" = since midnight, local
  return Date.now() - days * 86400_000
}

export function matchesOrderQuery(o: OrderRow, q: OrderQuery, win?: DateWindow | null, ctx: FilterContext = {}): boolean {
  if (q.status && !matchesStatus(o, q.status, ctx)) return false
  if (q.ready && !matchesReady(o, q.ready, ctx)) return false
  if (q.platform && platformOf(o) !== q.platform) return false
  if (q.store && (o.store || "").trim() !== q.store) return false
  if (q.method && !methodsOfOrder(o).some((m) => m.key === q.method)) return false
  if (win) {
    // An order with no date can't be shown to fall inside a window — dropping it is the
    // honest answer to "orders from the last 7 days", not a guess either way.
    const t = o.created_at ? new Date(o.created_at).getTime() : NaN
    if (!Number.isFinite(t)) return false
    if (win.from != null && t < win.from) return false
    if (win.to != null && t > win.to) return false
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
  const win = dateWindow(q)
  return orders.filter((o) => matchesOrderQuery(o, q, win, ctx))
}
