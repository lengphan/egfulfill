// Seller Orders table column model — the React port of the old orders.html
// COL_ORDER array. Same idea: ONE ordered list of column ids drives the header and
// the row cells, so a column can be hidden or dragged without touching either.
// Persisted per browser, like the old app's localStorage-backed layout.

export type OrderColId = "order" | "store" | "customer" | "items" | "status" | "tracking" | "total" | "date"

export type OrderColDef = {
  id: OrderColId
  label: string
  /** Tailwind width class for the <col>/<th>; omitted = flexible. */
  width?: string
  align?: "left" | "right"
  /** Columns the seller may not hide — without these a row is unidentifiable. */
  locked?: boolean
}

// Widths are deliberately tight: the table is `table-fixed`, so every pixel spent
// here is taken from Items — the only flexible column, and the one carrying the
// photos + product name. Keep the fixed total low or item names truncate to "Hoodie ·…".
export const ORDER_COLS: Record<OrderColId, OrderColDef> = {
  order: { id: "order", label: "Order", width: "w-[76px]", locked: true },
  store: { id: "store", label: "Store", width: "w-[88px]" },
  customer: { id: "customer", label: "Customer", width: "w-[136px]" },
  items: { id: "items", label: "Items" },
  status: { id: "status", label: "Status", width: "w-[136px]" }, // fits "Order Received"
  tracking: { id: "tracking", label: "Tracking", width: "w-[128px]" },
  total: { id: "total", label: "Total", width: "w-[88px]", align: "right" },
  date: { id: "date", label: "Date", width: "w-[72px]", align: "right" },
}

export const DEFAULT_ORDER_COLS: OrderColId[] = ["order", "store", "customer", "items", "status", "tracking", "total", "date"]
const ALL_IDS = DEFAULT_ORDER_COLS

const ORDER_KEY = "eg_orders_col_order"
const HIDDEN_KEY = "eg_orders_col_hidden"

const isColId = (v: unknown): v is OrderColId => typeof v === "string" && (ALL_IDS as string[]).includes(v)

/** Read the saved order, healing it against the current column set: unknown ids are
 *  dropped and newly-added columns are appended, so shipping a new column never
 *  leaves someone with a stale layout that silently hides it. */
export function loadColOrder(): OrderColId[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    if (!raw) return [...DEFAULT_ORDER_COLS]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_ORDER_COLS]
    const saved = parsed.filter(isColId)
    const missing = DEFAULT_ORDER_COLS.filter((id) => !saved.includes(id))
    return [...saved, ...missing]
  } catch {
    return [...DEFAULT_ORDER_COLS]
  }
}
export function saveColOrder(ids: OrderColId[]) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)) } catch {}
}

export function loadHiddenCols(): OrderColId[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // A locked column can never be hidden, even if an old save says so.
    return parsed.filter(isColId).filter((id) => !ORDER_COLS[id].locked)
  } catch {
    return []
  }
}
export function saveHiddenCols(ids: OrderColId[]) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids)) } catch {}
}

/** Move `id` to sit at `toIndex` in the list (drag-to-reorder). */
export function reorderCols(ids: OrderColId[], id: OrderColId, toIndex: number): OrderColId[] {
  const from = ids.indexOf(id)
  if (from < 0 || toIndex < 0 || toIndex >= ids.length || from === toIndex) return ids
  const next = [...ids]
  next.splice(from, 1)
  next.splice(toIndex, 0, id)
  return next
}

// ── Factory queue columns ──────────────────────────────────────────────────────
// The staff hub renders the SAME orders as the seller table, so its columns live here
// beside them rather than in the component. One place to read what a column is called and
// how wide it is; the header and the cells are both driven from the ordered id list, so a
// column can't exist in one and not the other — which is how the hub drifted into a card
// list with no headers in the first place.
//
// `grid` (not a Tailwind width class) because this table is a CSS grid, not a <table>: an
// order row and its expanded detail have to share one row container, and a grid lets the
// detail sit as a full-width sibling instead of being forced into a colspan cell.
export type FactoryColId = "status" | "order" | "age" | "tracking" | "store" | "customer" | "items" | "ready" | "action"

export type FactoryColDef = { id: FactoryColId; label: string; grid: string; align?: "left" | "right" }

export const FACTORY_COLS: Record<FactoryColId, FactoryColDef> = {
  // Every fact gets a SLOT. Store and tracking were folded into sub-lines under the order
  // number and the item count, which made them truncate, unscannable down the page, and
  // invisible unless you were looking straight at that one row — the seller table gives
  // each its own column, which is most of why it reads more easily.
  status:   { id: "status",   label: "Status",   grid: "6rem" },
  order:    { id: "order",    label: "Order",    grid: "5.5rem" },
  // Wide enough for a FULL tracking number rather than an ellipsis. A truncated tracking
  // number cannot be read to a buyer on the phone, which is the only reason it is on the
  // row at all — so it is sized to the longest carrier format, not to the space left over.
  // HOW OLD THE ORDER IS, measured from the buyer's purchase (created_at is set from the
  // marketplace's own timestamp, not our sync time — see the insert in etsy.js), so it
  // answers "when did they pay?" rather than "when did we notice?".
  //
  // It exists because the board floats overdue-and-workable work to the top, and with a
  // backlog that runs back years the top of the list is permanently old — which reads as
  // "nothing new is arriving" when new orders are arriving fine, just below 600 rows of
  // history. An age you can see turns that from a mystery into a number.
  //
  // Narrow on purpose: "3d" is the whole content, and it sits beside Order where you are
  // already looking.
  age:      { id: "age",      label: "Age",      grid: "4rem", align: "right" },
  tracking: { id: "tracking", label: "Tracking", grid: "12rem" },
  store:    { id: "store",    label: "Store",    grid: "7rem" },
  // CAPPED, not flexible. As the only 1fr track it swallowed every spare pixel, so a board
  // with room ended up with a very wide Customer column holding "Philipp Bumb" and a lot of
  // white space, while the List chips next to it stayed cramped. A name needs about 11rem;
  // past that the extra width buys nothing, so the slack goes to List instead (below).
  customer: { id: "customer", label: "Customer", grid: "minmax(5rem,11rem)" },
  // The listing name lives here now, like the seller's Items column, and is deliberately
  // the first thing squeezed: an Etsy title runs 130 characters and truncates whatever
  // width it gets, so spending the table's flexible space on it starves everything that
  // WOULD have fitted whole.
  items:    { id: "items",    label: "Items",    grid: "minmax(0,1.2fr)" },
  // Four solid coloured pills — Label · Scan · Design + the Stock chip, all tinted by state.
  //
  // Titled "List". Earlier names each failed differently: "Ready" claimed a verdict four
  // mixed-state chips don't give and read as a rival to Status two columns over, "Checklist"
  // said the right thing at twice the width of any other header, and "Prep" was disliked.
  // "List" is the user's own word for it.
  //
  // The ID stays `ready` — it's the localStorage key for saved column layouts, so renaming
  // it would silently reset everyone's board.
  //
  // Fixed width (the header cell can't size it), sized to hold all four on ONE line now the
  // chips are px-2/12px and Stock no longer rewrites itself to "In stock" / "No stock".
  // The 4rem that frees goes back to the flexible Customer/Items columns.
  // Now the column that ABSORBS the slack. Floor stays 12rem — the width that holds all four
  // chips on one line — so the row's minimum is unchanged and nothing new overflows; above
  // that it takes whatever a wider window offers, which is where the extra pixels are worth
  // most: four chips read more easily with air between them than a name does with air after it.
  ready:    { id: "ready",    label: "List",     grid: "minmax(12rem,1fr)" },
  // 9.5rem, not 12: the widest button here is "Create label" at ~7rem, so 12 left 2.5rem of
  // permanent air in the one column whose width decided whether the row fitted at all.
  action:   { id: "action",   label: "",         grid: "9.5rem" },  // header stays blank: buttons need no title
}

/** NB: nothing reads this. The board's starting order comes from FACTORY_DATA_COLS via
 *  loadFactoryColOrder; the columns shown are that list minus loadFactoryHiddenCols. Kept
 *  because it documents the intended left-to-right order, but edit the two loaders below to
 *  change what a board actually opens with. */
export const DEFAULT_FACTORY_COLS: FactoryColId[] = ["status", "order", "age", "tracking", "store", "customer", "items", "ready", "action"]

/**
 * HIDDEN on a board nobody has customised — `items`, and only `items`. One click in the
 * Columns menu brings it back.
 *
 * Two flexible columns can't both survive at a laptop width. The row's minimum is the sum of
 * its fixed tracks plus a 5rem floor for EACH flexible one; measured, that came to 1192px
 * against the 1057px a 1440px screen actually offers. So the table always opened mid-scroll
 * with the row's primary action off the right edge — you had to scroll sideways to reach the
 * button you came for. Dropping one flexible column, plus 2.5rem of slack from `action`,
 * brings the minimum under the container.
 *
 * `items` is the one to drop because it is the one that can't be read at any width it would
 * realistically get: an Etsy title runs ~130 characters and truncates to "Heavy…" whether it
 * has 40px or 140px, while a customer name FITS as soon as it stops sharing. That only makes
 * explicit what this file already said — items is "deliberately the first thing squeezed" —
 * rather than shipping a column permanently squeezed past legibility.
 */
export const DEFAULT_HIDDEN_FACTORY_COLS: FactoryColId[] = ["items"]

export function factoryGridTemplate(ids: FactoryColId[], lead: number): string {
  // Lead tracks are fixed for the same reason: the header renders empty spacers there.
  // 1.25rem is the checkbox, 1.5rem the caret — declared widest-first to match the row.
  const leads = lead === 2 ? ["1.25rem", "1.5rem"] : ["1.5rem"]
  return [...leads, ...ids.map((id) => FACTORY_COLS[id].grid)].join(" ")
}

// ── Factory column layout: user-reorderable + hide/show, persisted per browser ──────
// Only the DATA columns reorder/hide. `action` (the buttons) is pinned last and always
// shown, and `order` (the identifier) can never be hidden — a row must stay identifiable
// and actionable. Same localStorage-backed model as the seller table above.
export const FACTORY_DATA_COLS: FactoryColId[] = ["status", "order", "age", "tracking", "store", "customer", "items", "ready"]
const FACTORY_LOCKED: FactoryColId[] = ["order"]
export const isFactoryColLocked = (id: FactoryColId) => FACTORY_LOCKED.includes(id)
const isFactoryDataId = (v: unknown): v is FactoryColId => typeof v === "string" && (FACTORY_DATA_COLS as string[]).includes(v)

const FACTORY_ORDER_KEY = "eg_factory_col_order"
const FACTORY_HIDDEN_KEY = "eg_factory_col_hidden"

export function loadFactoryColOrder(): FactoryColId[] {
  try {
    const raw = localStorage.getItem(FACTORY_ORDER_KEY)
    if (!raw) return [...FACTORY_DATA_COLS]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...FACTORY_DATA_COLS]
    const saved = parsed.filter(isFactoryDataId)
    const missing = FACTORY_DATA_COLS.filter((id) => !saved.includes(id))
    return [...saved, ...missing]   // heal: new columns append rather than vanish
  } catch { return [...FACTORY_DATA_COLS] }
}
export function saveFactoryColOrder(ids: FactoryColId[]) { try { localStorage.setItem(FACTORY_ORDER_KEY, JSON.stringify(ids)) } catch {} }

export function loadFactoryHiddenCols(): FactoryColId[] {
  try {
    const raw = localStorage.getItem(FACTORY_HIDDEN_KEY)
    // No saved preference → the default hidden set, NOT "nothing hidden". Anyone who has
    // already chosen their columns keeps exactly what they chose, including items.
    if (!raw) return [...DEFAULT_HIDDEN_FACTORY_COLS]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_HIDDEN_FACTORY_COLS]
    return parsed.filter(isFactoryDataId).filter((id) => !FACTORY_LOCKED.includes(id))
  } catch { return [...DEFAULT_HIDDEN_FACTORY_COLS] }
}
export function saveFactoryHiddenCols(ids: FactoryColId[]) { try { localStorage.setItem(FACTORY_HIDDEN_KEY, JSON.stringify(ids)) } catch {} }

/** Move `id` to sit at `toIndex` (drag-to-reorder). Shared shape with reorderCols above. */
export function reorderFactoryCols(ids: FactoryColId[], id: FactoryColId, toIndex: number): FactoryColId[] {
  const from = ids.indexOf(id)
  if (from < 0 || toIndex < 0 || toIndex >= ids.length || from === toIndex) return ids
  const next = [...ids]
  next.splice(from, 1)
  next.splice(toIndex, 0, id)
  return next
}
