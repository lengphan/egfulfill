// Factory production pipeline — the canonical item lifecycle the boards drive, matching
// the old app's CURRENT status vocabulary (egfulfill-store.js SELLER_STATUS factory keys):
//
//   (new) → In review → Awaiting scan → Scanned → Printing → Packing → Shipped
//
// (Queued / QC / Packed were the OLDER model — kept only as normalize() aliases.) Plus
// off-pipeline EXCEPTION states an order can drop into: On hold, Flagged, Backorder,
// Cancelled, Refunded. An order's overall stage = its least-advanced item (only "Shipped"
// when every line is), unless any item is in an exception state.

export type FactoryTone = "new" | "review" | "neutral" | "prod" | "qc" | "packed" | "shipped" | "hold" | "alert" | "backorder" | "closed"
export type FactoryStage = { id: string; label: string; tone: FactoryTone }

// The linear production flow (in order) — the warehouse scan flow.
export const FACTORY_STAGES: FactoryStage[] = [
  { id: "in_review", label: "In review", tone: "review" },
  { id: "awaiting_scan", label: "Awaiting scan", tone: "neutral" },
  { id: "scanned", label: "Scanned", tone: "qc" },
  { id: "printing", label: "Printing", tone: "prod" },
  { id: "shipped", label: "Shipped", tone: "shipped" },
]
const ORDER = FACTORY_STAGES.map((s) => s.id)

// Off-pipeline exception states (set manually, not reached by advancing).
export const EXCEPTION_STAGES: FactoryStage[] = [
  { id: "on_hold", label: "On hold", tone: "hold" },
  { id: "flagged", label: "Flagged", tone: "alert" },
  { id: "backorder", label: "Backorder", tone: "backorder" },
  { id: "cancelled", label: "Cancelled", tone: "closed" },
  { id: "refunded", label: "Refunded", tone: "closed" },
]
const EXCEPTIONS = new Set(EXCEPTION_STAGES.map((s) => s.id))

// Everything a staff member can set (new = received / cleared).
export const ALL_STATUSES: FactoryStage[] = [{ id: "", label: "New (received)", tone: "new" }, ...FACTORY_STAGES, ...EXCEPTION_STAGES]

// Collapse the many raw factory_status values onto a canonical id. "" = not started.
export function normalizeStage(s?: string | null): string {
  const v = String(s || "").toLowerCase().trim()
  if (v === "new" || v === "draft" || v === "none" || v === "pending") return ""
  if (ORDER.includes(v) || EXCEPTIONS.has(v)) return v
  if (["approved", "ready_print", "in_queue", "queued", "prescan"].includes(v)) return "awaiting_scan"
  if (["qc", "production", "in_production", "in-prod", "printed", "prepress", "working"].includes(v)) return "printing"
  // `packing` was removed from the pipeline, but rows in the DB still carry it —
  // fold it (and its old aliases) onto printing. Without this it would fall through
  // to "" and every in-flight packing order would read as NEW.
  if (["packing", "packed", "label", "labelled", "labeled", "ready", "finished"].includes(v)) return "printing"
  if (["fulfilled", "delivered", "in_transit"].includes(v)) return "shipped"
  if (["escalated", "action"].includes(v)) return "flagged"
  if (["replacement"].includes(v)) return "backorder"
  return "" // unknown → treat as new
}

export function stageMeta(id: string): FactoryStage | null {
  return ALL_STATUSES.find((s) => s.id === id) ?? null
}
export function isException(id?: string | null): boolean {
  return EXCEPTIONS.has(normalizeStage(id))
}

// The next linear stage to advance an item to (null once shipped or in an exception).
export function nextStage(current?: string | null): string | null {
  const v = normalizeStage(current)
  if (EXCEPTIONS.has(v)) return null
  if (!v) return "in_review"
  const i = ORDER.indexOf(v)
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null
}

// An order's overall stage from its items: any exception wins; else the least-advanced
// line. Empty items → "".
export function orderStage(items: { factory_status?: string | null }[]): string {
  if (!items || !items.length) return ""
  const exc = items.map((it) => normalizeStage(it.factory_status)).find((v) => EXCEPTIONS.has(v))
  if (exc) return exc
  let minIdx = ORDER.length
  let anyUnstarted = false
  for (const it of items) {
    const v = normalizeStage(it.factory_status)
    if (!v) { anyUnstarted = true; continue }
    minIdx = Math.min(minIdx, ORDER.indexOf(v))
  }
  if (anyUnstarted) return ""
  return minIdx < ORDER.length ? ORDER[minIdx] : ""
}

export const TONE_CLASS: Record<FactoryTone, string> = {
  new: "bg-muted text-muted-foreground",
  review: "bg-indigo-100 text-indigo-700",
  neutral: "bg-slate-100 text-slate-700",
  prod: "bg-violet-100 text-violet-700",
  qc: "bg-amber-100 text-amber-700",
  packed: "bg-sky-100 text-sky-700",
  shipped: "bg-emerald-100 text-emerald-700",
  hold: "bg-amber-100 text-amber-800",
  alert: "bg-red-100 text-red-700",
  backorder: "bg-orange-100 text-orange-700",
  closed: "bg-muted text-muted-foreground line-through",
}
