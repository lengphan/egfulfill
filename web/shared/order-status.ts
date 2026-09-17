/**
 * THE SELLER'S ORDER VOCABULARY — shared with the phone, which is the whole point.
 *
 * This lived in `web/lib/order-status.ts`, so it was reachable from the browser and from
 * nowhere else. The phone therefore had only the FACTORY ladder, and a seller looking at
 * their own order on their own phone read "Working" and "Approved" — words the web
 * deliberately never shows them. That is not a styling difference; it is the phone telling
 * a seller something the product decided they are not told, which `web-is-canonical-mobile-
 * extends` exists to prevent. Moved here rather than copied: a second copy of a vocabulary
 * disagrees the first time either one is edited, and this file and `factory-status.ts` had
 * ALREADY drifted once before (`wait` against `review` for one idea).
 *
 * THE SELLER SEES COLLAPSED STAGES, and that is an established product decision ported
 * verbatim from egfulfill-store.js `SELLER_STATUS` — do NOT reinvent granular seller stages.
 * Every production sub-state (awaiting_scan / working / printing / qc / packed / …) reads as
 * one word: "In Process". The factory's steps belong to the factory's boards.
 *
 * WHAT THIS FILE WILL NOT DO IS PAINT. It returns a REGISTER — live, settled or attention —
 * and each front-end owns what that looks like: Tailwind classes on the web
 * (`lib/status-tone.ts`), a `fontFamily` and colour on the phone (`lib/theme.ts`
 * STATUS_REGISTER). The three registers are already identical on both sides, which is what
 * makes the split clean; the alternative is shipping Tailwind class names to React Native,
 * where they mean nothing.
 */

/** Where an order sits in the seller's own lifecycle — the thing filters group by. */
export type SellerGroup = "draft" | "pending" | "production" | "shipped" | "attention" | "closed"

/** Weight, never colour. Mirrors STATUS_TONE (web) and STATUS_REGISTER (phone). */
export type StatusRegister = "live" | "settled" | "attention"

export type SellerStatus = { label: string; register: StatusRegister; group: SellerGroup }

const P = (label: string, register: StatusRegister, group: SellerGroup): SellerStatus =>
  ({ label, register, group })

/**
 * The seller-facing lifecycle: Draft → Pending → In Process → Fulfilled, plus On Hold /
 * Cancelled / Refunded / Action Needed. Keyed on every raw value the backend emits, legacy
 * ids included, because a row written two years ago still has to render.
 */
const MAP: Record<string, SellerStatus> = {
  // Draft = created or synced, NOT submitted. The seller's next action is to submit it.
  // Same label whatever the origin.
  new: P("Draft", "settled", "draft"),
  draft: P("Draft", "settled", "draft"),
  // Pending = submitted and charged, awaiting the factory. STILL cancellable for a full
  // refund — the Cancel control appears alongside this.
  in_review: P("Pending", "live", "pending"),
  // In Process starts HERE, not at `working`. Approved means an operator confirmed the
  // blank — the factory accepting the job — and it is the moment the seller's cancel window
  // closes (SELLER_ZONE in orders.js stops at in_review). This reached "In Process" only
  // through the unknown-status fallback once, so the one stage where a seller loses a right
  // was the one stage nothing named.
  approved: P("In Process", "live", "production"),
  working: P("In Process", "live", "production"),
  shipped: P("Fulfilled", "settled", "shipped"),
  flagged: P("Action Needed", "attention", "attention"),
  cancelled: P("Cancelled", "settled", "closed"),
  refunded: P("Refunded", "settled", "closed"),
  on_hold: P("On Hold", "attention", "attention"),
  unfunded: P("Action Needed", "attention", "attention"),
  // Retired factory ids that all meant "accepted and being made". Legacy rows still carry
  // them; every one collapses to the single seller word.
  awaiting_scan: P("In Process", "live", "production"),
  printed: P("In Process", "live", "production"),
  scanned: P("In Process", "live", "production"),
  printing: P("In Process", "live", "production"),
  packing: P("In Process", "live", "production"),
  packed: P("In Process", "live", "production"),
  prescan: P("In Process", "live", "production"),
  ready_print: P("In Process", "live", "production"),
  in_queue: P("In Process", "live", "production"),
  queued: P("In Process", "live", "production"),
  production: P("In Process", "live", "production"),
  qc: P("In Process", "live", "production"),
  delivered: P("Fulfilled", "settled", "shipped"),
  fulfilled: P("Fulfilled", "settled", "shipped"),
}

/** An unknown non-empty status is mid-pipeline, which is the old app's default and the
 *  safe one: telling a seller their order is "In Process" when it is in some state we do
 *  not recognise is better than telling them it is finished. */
const FALLBACK = P("In Process", "live", "production")

export function sellerStatus(o: { factory_status?: string | null; status?: string | null }): SellerStatus {
  const raw = String(o?.factory_status || o?.status || "new").toLowerCase()
  return MAP[raw] ?? FALLBACK
}

/** Seller-facing filter tabs — grouped, never the granular factory stages. */
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
