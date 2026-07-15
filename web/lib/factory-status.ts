// Factory production flow — the canonical item lifecycle the boards drive:
//   (new/in_review) → queued → printing → qc → packed → shipped
// An order's overall stage = its least-advanced item (it's only "shipped" when every
// line is). Mirrors the old factory/operator boards (ORDER_DATA statuses).

export type FactoryTone = "neutral" | "prod" | "qc" | "packed" | "shipped" | "new"
export type FactoryStage = { id: string; label: string; tone: FactoryTone }

export const FACTORY_STAGES: FactoryStage[] = [
  { id: "queued", label: "Queued", tone: "neutral" },
  { id: "printing", label: "Printing", tone: "prod" },
  { id: "qc", label: "QC", tone: "qc" },
  { id: "packed", label: "Packed", tone: "packed" },
  { id: "shipped", label: "Shipped", tone: "shipped" },
]
const ORDER = FACTORY_STAGES.map((s) => s.id)

// Collapse the many raw factory_status values onto a canonical stage id. "" = not
// started (a fresh order awaiting the operator).
export function normalizeStage(s?: string | null): string {
  const v = String(s || "").toLowerCase().trim()
  if (ORDER.includes(v)) return v
  if (["production", "in_production", "printed", "prepress", "printing"].includes(v)) return "printing"
  if (["label", "labelled", "labeled", "ready"].includes(v)) return "packed"
  if (["fulfilled", "delivered", "shipped"].includes(v)) return "shipped"
  return "" // new / draft / in_review / unknown
}

export function stageMeta(id: string): FactoryStage | null {
  return FACTORY_STAGES.find((s) => s.id === id) ?? null
}

// The next stage to advance an item to (null once shipped). Unstarted → "queued".
export function nextStage(current?: string | null): string | null {
  const v = normalizeStage(current)
  if (!v) return "queued"
  const i = ORDER.indexOf(v)
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null
}

// An order's overall stage from its items: the LEAST-advanced line. Empty items → "".
export function orderStage(items: { factory_status?: string | null }[]): string {
  if (!items || !items.length) return ""
  let minIdx = ORDER.length // higher than any real index
  let anyUnstarted = false
  for (const it of items) {
    const v = normalizeStage(it.factory_status)
    if (!v) { anyUnstarted = true; continue }
    minIdx = Math.min(minIdx, ORDER.indexOf(v))
  }
  if (anyUnstarted) return "" // not fully into production yet
  return minIdx < ORDER.length ? ORDER[minIdx] : ""
}

export const TONE_CLASS: Record<FactoryTone, string> = {
  new: "bg-muted text-muted-foreground",
  neutral: "bg-slate-100 text-slate-700",
  prod: "bg-violet-100 text-violet-700",
  qc: "bg-amber-100 text-amber-700",
  packed: "bg-sky-100 text-sky-700",
  shipped: "bg-emerald-100 text-emerald-700",
}
