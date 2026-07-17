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
