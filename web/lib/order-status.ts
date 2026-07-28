// Canonical seller-facing order status — ported VERBATIM from egfulfill-store.js
// `SELLER_STATUS`. The seller deliberately sees COLLAPSED stages: every production
// sub-state (awaiting_scan/scanned/printing/qc/packed/…) shows as "In
// Production". This is an established product decision in the original app — do NOT
// reinvent granular seller stages here. The granular factory stages belong to the
// factory boards, not the seller surfaces.
export type SellerStatusInfo = { label: string; tone: string; group: SellerGroup }
export type SellerGroup = "draft" | "pending" | "production" | "shipped" | "attention" | "closed"

// Design-token tones (grey neutral, violet accent, indigo wait, green ship, amber hold, red alert).
const TONE = {
  neutral: "bg-muted text-muted-foreground",
  wait: "bg-indigo-100 text-indigo-700",
  prod: "bg-violet-100 text-violet-700",
  shipped: "bg-emerald-100 text-emerald-700",
  hold: "bg-amber-100 text-amber-800",
  alert: "bg-red-100 text-red-700",
}

const P = (label: string, tone: string, group: SellerGroup): SellerStatusInfo => ({ label, tone, group })

// The seller-facing lifecycle: Draft -> Pending -> In Process -> Fulfilled (+ On Hold /
// Cancelled / Refunded). Mirrors factory ids; keys cover every raw value the backend emits.
const MAP: Record<string, SellerStatusInfo> = {
  // Draft = created/synced, NOT submitted. The seller's next action is to submit it. Same
  // label whatever the origin (synced or manual).
  new: P("Draft", TONE.neutral, "draft"),
  draft: P("Draft", TONE.neutral, "draft"),
  // Pending = submitted + charged, awaiting the factory to approve it. STILL cancellable
  // (full refund) — the Cancel button appears alongside this, driven by factory_status.
  in_review: P("Pending", TONE.wait, "pending"),
  // In Process = the factory approved it and is making it. Every internal make-stage
  // (awaiting_scan / working, + legacy) collapses to this one label — the factory's steps
  // are not the seller's business.
  awaiting_scan: P("In Process", TONE.prod, "production"),
  printed: P("In Process", TONE.prod, "production"),     // retired id; legacy rows
  working: P("In Process", TONE.prod, "production"),
  scanned: P("In Process", TONE.prod, "production"),     // retired id; legacy rows
  printing: P("In Process", TONE.prod, "production"),    // retired id; legacy rows
  packing: P("In Process", TONE.prod, "production"),     // retired stage; legacy rows still carry it
  shipped: P("Fulfilled", TONE.shipped, "shipped"),
  flagged: P("Action Needed", TONE.alert, "attention"),
  cancelled: P("Cancelled", TONE.neutral, "closed"),
  refunded: P("Refunded", TONE.neutral, "closed"),
  // legacy aliases
  prescan: P("In Process", TONE.prod, "production"),
  ready_print: P("In Process", TONE.prod, "production"),
  in_queue: P("In Process", TONE.prod, "production"),
  production: P("In Process", TONE.prod, "production"),
  qc: P("In Process", TONE.prod, "production"),
  packed: P("In Process", TONE.prod, "production"),
  queued: P("In Process", TONE.prod, "production"),
  delivered: P("Fulfilled", TONE.shipped, "shipped"),
  fulfilled: P("Fulfilled", TONE.shipped, "shipped"),
  on_hold: P("On Hold", TONE.hold, "attention"),
  unfunded: P("Action Needed", TONE.alert, "attention"),
}
// Unknown/missing non-empty status → treat as mid-pipeline (In Process), the old default.
const FALLBACK = P("In Process", TONE.prod, "production")

export function sellerStatus(o: { factory_status?: string | null; status?: string | null }): SellerStatusInfo {
  const raw = String(o?.factory_status || o?.status || "new").toLowerCase()
  return MAP[raw] ?? FALLBACK
}

// Seller-facing filter tabs (grouped, not the granular factory stages).
export const SELLER_FILTERS = ["All", "Draft", "Pending", "In Process", "Fulfilled", "Needs attention"] as const
export type SellerFilter = (typeof SELLER_FILTERS)[number]

export function matchesFilter(o: { factory_status?: string | null; status?: string | null }, f: SellerFilter): boolean {
  if (f === "All") return true
  const g = sellerStatus(o).group
  if (f === "Draft") return g === "draft"
  if (f === "Pending") return g === "pending"
  if (f === "In Process") return g === "production"
  if (f === "Fulfilled") return g === "shipped"
  if (f === "Needs attention") return g === "attention"
  return true
}
