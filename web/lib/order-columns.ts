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
export type FactoryColId = "status" | "order" | "tracking" | "store" | "customer" | "items" | "ready" | "action"

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
  tracking: { id: "tracking", label: "Tracking", grid: "12rem" },
  store:    { id: "store",    label: "Store",    grid: "7rem" },
  customer: { id: "customer", label: "Customer", grid: "minmax(0,1fr)" },
  // The listing name lives here now, like the seller's Items column, and is deliberately
  // the first thing squeezed: an Etsy title runs 130 characters and truncates whatever
  // width it gets, so spending the table's flexible space on it starves everything that
  // WOULD have fitted whole.
  items:    { id: "items",    label: "Items",    grid: "minmax(0,1.2fr)" },
  // Dots, not worded pills — the heading already says what they are, so three words per
  // row restated it fifty times for 176px. Fixed, because the header cell can't size it.
  ready:    { id: "ready",    label: "Ready",    grid: "5rem" },
  action:   { id: "action",   label: "",         grid: "12rem" },  // header stays blank: buttons need no title
}

export const DEFAULT_FACTORY_COLS: FactoryColId[] = ["status", "order", "tracking", "store", "customer", "items", "ready", "action"]

export function factoryGridTemplate(ids: FactoryColId[], lead: number): string {
  // Lead tracks are fixed for the same reason: the header renders empty spacers there.
  // 1.25rem is the checkbox, 1.5rem the caret — declared widest-first to match the row.
  const leads = lead === 2 ? ["1.25rem", "1.5rem"] : ["1.5rem"]
  return [...leads, ...ids.map((id) => FACTORY_COLS[id].grid)].join(" ")
}
