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
// The pipeline every submitted order follows.
//
// NB on ids vs labels: the submitted-but-untouched stage is LABELLED "New" but its id
// stays `in_review`. The id `new` already means "not started / draft" in
// normalizeStage — reusing it would make a seller's unsubmitted draft and a submitted
// order indistinguishable in the DB. Labels are what people read; ids are data.
export const FACTORY_STAGES: FactoryStage[] = [
  { id: "in_review", label: "Submitted", tone: "review" },  // seller pushed it + paid; cancellable by them
  { id: "awaiting_scan", label: "Awaiting scan", tone: "neutral" }, // label bought; waiting on the scan
  { id: "printed", label: "Printed", tone: "qc" },          // label printed (pre-scan paperwork)
  { id: "working", label: "Working", tone: "prod" },        // scanned + combined with the design; being made
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
// "" and in_review are DIFFERENT states that both used to read "New": "" is an order
// that arrived and nobody has started (a marketplace sync lands here, unpaid); in_review
// is one the seller has submitted AND been charged for. Confusing them is how a paid
// order gets treated as untouched — so they're named for what they are.
export const ALL_STATUSES: FactoryStage[] = [{ id: "", label: "Received", tone: "new" }, ...FACTORY_STAGES, ...EXCEPTION_STAGES]

// Collapse the many raw factory_status values onto a canonical id. "" = not started.
export function normalizeStage(s?: string | null): string {
  const v = String(s || "").toLowerCase().trim()
  if (v === "new" || v === "draft" || v === "none" || v === "pending") return ""
  if (ORDER.includes(v) || EXCEPTIONS.has(v)) return v
  if (["approved", "ready_print", "in_queue", "queued", "prescan"].includes(v)) return "awaiting_scan"
  // Retired ids still living in the DB. Without these they'd fall through to "" and
  // every in-flight order would read as not-started.
  //   scanned  -> printed  (the label step)
  //   printing -> working  (the make step)
  //   packing/packed/... -> working (packing was removed earlier)
  if (["scanned", "label", "labelled", "labeled"].includes(v)) return "printed"
  if (["printing", "qc", "production", "in_production", "in-prod", "prepress",
       "packing", "packed", "ready", "finished"].includes(v)) return "working"
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

// ── Who may set which stage ────────────────────────────────────────────────────
// MIRRORS stageDenial() in server/src/routes/orders.js — keep the two in sync. The
// server is what enforces this; these helpers exist only so a user isn't offered an
// option that would come back 403.
//
// The operator's zone ends at the scan: a stage is a claim about PHYSICAL CUSTODY, and
// once the warehouse holds the goods only they (or admin) can report where it is.
// Carve-outs: flagged/on_hold are a STOP signal rather than a custody claim, so artwork
// review can pull the andon cord at any stage; cancelled/refunded are admin money calls
// and backorder is a warehouse/admin stock call.
const OP_ZONE = new Set(["", "in_review", "awaiting_scan"])
const OP_STOPS = new Set(["flagged", "on_hold"])
const MONEY_STAGES = new Set(["cancelled", "refunded"])

export function canSetStage(role: string, current: string | null | undefined, target: string): boolean {
  if (role === "admin") return true
  const at = normalizeStage(current)
  const to = normalizeStage(target)
  if (role === "warehouse") return !MONEY_STAGES.has(to)
  if (role === "operator") {
    if (MONEY_STAGES.has(to) || to === "backorder") return false
    if (OP_STOPS.has(to)) return true
    // Sending a SUBMITTED order back un-does something the seller paid for: the charge
    // is idempotent so nothing double-bills, but the order reads as untouched while the
    // money stays taken. Warehouse or admin only. (Server enforces the same.)
    if (at === "in_review" && (to === "" || to === "new" || to === "draft")) return false
    return OP_ZONE.has(at) && OP_ZONE.has(to)
  }
  return false
}

// Does this role get a status CONTROL for an item at this stage, or a read-only badge?
// An operator past Awaiting scan keeps only the stop options, never the pipeline.
export function stageOptionsFor(role: string, current: string | null | undefined): FactoryStage[] {
  return ALL_STATUSES.filter((s) => canSetStage(role, current, s.id))
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
