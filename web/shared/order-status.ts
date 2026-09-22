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

/**
 * ONCE A PARCEL EXISTS, THE CARRIER IS THE ANSWER (owner, 2026-09-22).
 *
 * A seller's question is always "where is it". Before it ships that is our pipeline; after
 * it ships it is the carrier's, and there is no moment where both matter at once — so this
 * stays ONE column and the carrier takes it over rather than earning a second one.
 *
 * WHAT IT FIXES. `sellerStatus` read `factory_status || status` and nothing else, so the
 * carrier's answer was thrown away at the point of display. Measured on the live database:
 * 120 orders read as **"Draft"** to a seller while their parcel had shipped — 65 of them
 * already DELIVERED, 21 belonging to a real seller. Not merely "one status": the worst
 * available wrong one, because Draft means *you never submitted this*.
 *
 * Those are marketplace orders the seller fulfilled themselves. They never entered our
 * production ladder, so factory_status stayed `new` while tracking and delivery arrived from
 * the carrier sync — the two facts diverged exactly as they should, and the display collapsed
 * them into the one that had not moved.
 *
 * THE VOCABULARY IS THE ONE WE ALREADY STORE — DELIVERY_MAP in routes/shipping.js, which maps
 * Shippo's states to ours. It is not re-derived here; these keys ARE those values, and a
 * state that file stops emitting simply stops appearing.
 *
 * `returned` and `failed` are mapped there and have NEVER fired in production, so they are
 * the two a seller will meet first with no history behind them. Both read as attention
 * rather than as an outcome: neither is "delivered" and both need a person.
 */
const CARRIER: Record<string, SellerStatus> = {
  awaiting_pickup: P("Awaiting pickup", "live", "shipped"),
  in_transit: P("In transit", "live", "shipped"),
  delivered: P("Delivered", "settled", "shipped"),
  returned: P("Returned", "attention", "attention"),
  failed: P("Delivery failed", "attention", "attention"),
}

/**
 * OUR WORD WINS OVER THE CARRIER'S for these, and only these.
 *
 * A refunded order is refunded wherever the parcel went, and a cancelled one cannot be
 * "In transit" — those are facts about the AGREEMENT, not about the box. Everything else
 * yields: a shipped parcel's whereabouts is the more useful answer than our own ladder
 * repeating that we finished with it.
 */
const OURS_WINS = new Set(["cancelled", "refunded", "on_hold", "flagged", "unfunded"])

/** An unknown non-empty status is mid-pipeline, which is the old app's default and the
 *  safe one: telling a seller their order is "In Process" when it is in some state we do
 *  not recognise is better than telling them it is finished. */
const FALLBACK = P("In Process", "live", "production")

export function sellerStatus(
  o: { factory_status?: string | null; status?: string | null; delivery_status?: string | null },
): SellerStatus {
  const raw = String(o?.factory_status || o?.status || "new").toLowerCase()
  if (OURS_WINS.has(raw)) return MAP[raw] ?? FALLBACK
  const carrier = String(o?.delivery_status || "").toLowerCase()
  if (carrier && CARRIER[carrier]) return CARRIER[carrier]
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
