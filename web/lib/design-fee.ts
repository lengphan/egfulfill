import type { DesignTier } from "@/lib/api"

/**
 * THE DESIGN TIERS, in one place, because two surfaces now decide the same charge.
 *
 * They lived inside design-canvas.tsx while it was the only screen that could set a tier.
 * The charge has moved to the order's Summary — beside the total, where every other number
 * about money is — and a second copy of "what Complex means and what it costs" is exactly
 * the private-copy habit CLAUDE.md §5 records three files already growing.
 *
 * Mirrors the mapping in server/src/routes/orders.js (tier → fee), so the label a person
 * reads and the debit that lands cannot disagree.
 */
export const TIER_LABEL: Record<DesignTier, string> = {
  standard: "Standard",
  complex: "Complex",
  supplied: "Their file",
}

export const TIER_WHY: Record<DesignTier, string> = {
  standard: "We cut the machine file from their artwork — ordinary work",
  complex: "We cut it, but it's intricate. Quotes the seller and waits for them to accept",
  supplied: "They sent their own machine file — we only check it",
}

export type DesignFees = { standard: number; complex: number; check: number }

/** null while the settings are still loading, so a price never renders as a confident $0 —
 *  "we don't know yet" and "it's free" are different facts and only one of them is safe to
 *  show on a control that bills someone. */
export const feeFor = (t: DesignTier, fees: DesignFees | null) =>
  fees ? (t === "standard" ? fees.standard : t === "complex" ? fees.complex : fees.check) : null
