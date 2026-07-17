// Canonical seller-facing order status — ported VERBATIM from egfulfill-store.js
// `SELLER_STATUS`. The seller deliberately sees COLLAPSED stages: every production
// sub-state (awaiting_scan/scanned/printing/qc/packed/…) shows as "In
// Production". This is an established product decision in the original app — do NOT
// reinvent granular seller stages here. The granular factory stages belong to the
// factory boards, not the seller surfaces.
export type SellerStatusInfo = { label: string; tone: string; group: SellerGroup }
export type SellerGroup = "received" | "production" | "shipped" | "attention" | "closed"

// Design-token tones matching the canonical SELLER_STATUS colours
// (#6b7280 grey, #6366f1 indigo→violet, #16a34a green, #dc2626 red).
const TONE = {
  neutral: "bg-muted text-muted-foreground",
  prod: "bg-violet-100 text-violet-700",
  shipped: "bg-emerald-100 text-emerald-700",
  alert: "bg-red-100 text-red-700",
}

const P = (label: string, tone: string, group: SellerGroup): SellerStatusInfo => ({ label, tone, group })

// Keys mirror SELLER_STATUS (+ its legacy aliases) exactly.
const MAP: Record<string, SellerStatusInfo> = {
  // Same label whatever the origin (synced or manual): the seller's next action is
  // identical either way — submit it. "Order Received" implied we already had it and
  // were acting on it, when in fact nothing is charged or started until they submit.
  new: P("Not submitted", TONE.neutral, "received"),
  draft: P("Not submitted", TONE.neutral, "received"),
  // Submitted = "In Production" to the seller. Every internal stage (in_review /
  // awaiting_scan / printed / working) collapses to this one label — the factory's
  // steps are not the seller's business. NB: still cancellable at in_review, so the
  // Cancel button can appear alongside this label; that's driven by factory_status,
  // not by what the badge says.
  in_review: P("In Production", TONE.prod, "production"),
  awaiting_scan: P("In Production", TONE.prod, "production"),
  printed: P("In Production", TONE.prod, "production"),
  working: P("In Production", TONE.prod, "production"),
  scanned: P("In Production", TONE.prod, "production"),   // retired id; legacy rows
  printing: P("In Production", TONE.prod, "production"),  // retired id; legacy rows
  packing: P("In Production", TONE.prod, "production"),   // retired stage; legacy rows still carry it
  shipped: P("Shipped", TONE.shipped, "shipped"),
  flagged: P("Action Needed", TONE.alert, "attention"),
  cancelled: P("Cancelled", TONE.neutral, "closed"),
  refunded: P("Refunded", TONE.neutral, "closed"),
  // legacy aliases (verbatim from SELLER_STATUS)
  prescan: P("In Production", TONE.prod, "production"),
  ready_print: P("In Production", TONE.prod, "production"),
  in_queue: P("In Production", TONE.prod, "production"),
  production: P("In Production", TONE.prod, "production"),
  qc: P("In Production", TONE.prod, "production"),
  packed: P("In Production", TONE.prod, "production"),
  // extra raw values the backend can emit, mapped to the same seller intent
  queued: P("In Production", TONE.prod, "production"),
  delivered: P("Shipped", TONE.shipped, "shipped"),
  fulfilled: P("Shipped", TONE.shipped, "shipped"),
  on_hold: P("Action Needed", TONE.alert, "attention"),
  unfunded: P("Action Needed", TONE.alert, "attention"),
}
// Unknown/missing → the old app's effective default was "In Production".
const FALLBACK = P("In Production", TONE.prod, "production")

export function sellerStatus(o: { factory_status?: string | null; status?: string | null }): SellerStatusInfo {
  const raw = String(o?.factory_status || o?.status || "new").toLowerCase()
  return MAP[raw] ?? FALLBACK
}

// Seller-facing filter tabs (grouped, not the granular factory stages).
export const SELLER_FILTERS = ["All", "New", "In Production", "Shipped", "Needs attention"] as const
export type SellerFilter = (typeof SELLER_FILTERS)[number]

export function matchesFilter(o: { factory_status?: string | null; status?: string | null }, f: SellerFilter): boolean {
  if (f === "All") return true
  const g = sellerStatus(o).group
  if (f === "New") return g === "received"   // group id kept: not submitted + in review
  if (f === "In Production") return g === "production"
  if (f === "Shipped") return g === "shipped"
  if (f === "Needs attention") return g === "attention"
  return true
}
