// Unit economics for a sourcing decision — the one place that decides what a product
// actually earns. Nothing else in the app computes this today: `orders.profit` is a column
// the client writes and the server stores verbatim, so there was no formula to reuse.
//
// The whole point is the LANDED cost. A quote of "$3.10 a unit" is not $3.10 if the MOQ is
// 100 and freight is $85 — it's $3.95, and it arrives 25 days later than the domestic blank
// at $8.42 with no minimum. Comparing sticker prices is how you talk yourself into the
// wrong supplier, so every number here is per-unit-landed.

/** Marketplace take rates. Percent of the buyer's total, plus any flat per-order fee. */
export type FeeModel = {
  id: string
  label: string
  /** % of (item + shipping the buyer paid) */
  pct: number
  /** flat per-order, in dollars */
  flat: number
  note?: string
}

// Published rates as of 2026. These are DEFAULTS, not gospel — marketplaces change them,
// and a seller on a legacy plan may pay something else, so every field stays editable in
// the UI and the chosen numbers are what the calculation uses.
export const FEE_MODELS: FeeModel[] = [
  { id: "etsy", label: "Etsy", pct: 6.5, flat: 0.2, note: "6.5% transaction + $0.20 listing" },
  { id: "tiktok", label: "TikTok Shop", pct: 8, flat: 0, note: "referral fee; varies by category" },
  { id: "shopify", label: "Shopify (own store)", pct: 0, flat: 0, note: "no marketplace fee — payment processing only" },
  { id: "amazon", label: "Amazon", pct: 15, flat: 0, note: "referral fee; apparel is typically 17%" },
  { id: "none", label: "Direct / wholesale", pct: 0, flat: 0 },
]

/** Card processing, charged on top of the marketplace fee. */
export const PAYMENT_DEFAULT = { pct: 2.9, flat: 0.3 }

export type ProfitInput = {
  /** what the customer pays for the item */
  sellPrice: number
  /** what the customer pays for shipping (0 if you offer free shipping) */
  shippingCharged?: number
  /** supplier unit price, as quoted */
  unitCost: number
  /** print / embroidery / decoration per unit */
  decorationCost?: number
  /** inbound freight for the WHOLE order, not per unit */
  shipTotal?: number
  /** minimum order quantity the freight is spread across */
  moq?: number
  /** what it costs YOU to ship one to the customer */
  outboundShipping?: number
  feePct?: number
  feeFlat?: number
  paymentPct?: number
  paymentFlat?: number
}

export type ProfitResult = {
  /** unitCost + decoration + freight amortised over MOQ */
  landedUnitCost: number
  /** freight per unit alone — the number people forget */
  freightPerUnit: number
  /** what the buyer pays in total */
  revenue: number
  /** marketplace + payment fees */
  fees: number
  /** revenue − fees − landed cost − outbound shipping */
  profit: number
  /** profit as % of revenue. null when revenue is 0 (undefined, not "0%") */
  marginPct: number | null
  /** sell price at which profit hits exactly zero */
  breakEvenPrice: number | null
  /** profit × MOQ — what the whole buy earns if it all sells */
  profitAtMoq: number
  /** how many units must sell to cover the freight alone */
  unitsToCoverFreight: number | null
}

const n = (v: number | undefined | null, fallback = 0): number => {
  const x = typeof v === "number" ? v : Number(v)
  return Number.isFinite(x) ? x : fallback
}

export function computeProfit(input: ProfitInput): ProfitResult {
  const sellPrice = Math.max(0, n(input.sellPrice))
  const shippingCharged = Math.max(0, n(input.shippingCharged))
  const unitCost = Math.max(0, n(input.unitCost))
  const decoration = Math.max(0, n(input.decorationCost))
  const shipTotal = Math.max(0, n(input.shipTotal))
  // MOQ of 0 would divide freight by nothing; treat anything under 1 as "buy one".
  const moq = Math.max(1, Math.floor(n(input.moq, 1)))
  const outbound = Math.max(0, n(input.outboundShipping))
  const feePct = Math.max(0, n(input.feePct))
  const feeFlat = Math.max(0, n(input.feeFlat))
  const payPct = Math.max(0, n(input.paymentPct, PAYMENT_DEFAULT.pct))
  const payFlat = Math.max(0, n(input.paymentFlat, PAYMENT_DEFAULT.flat))

  const freightPerUnit = shipTotal / moq
  const landedUnitCost = unitCost + decoration + freightPerUnit

  const revenue = sellPrice + shippingCharged
  // Marketplaces charge their percentage on the full amount the buyer paid, shipping
  // included — not on the item price alone. Getting this wrong flatters every margin.
  const pctTotal = (feePct + payPct) / 100
  const flatTotal = feeFlat + payFlat
  const fees = revenue * pctTotal + flatTotal

  const profit = revenue - fees - landedUnitCost - outbound
  const marginPct = revenue > 0 ? (profit / revenue) * 100 : null

  // profit = 0  =>  (P + S)(1 − f) = flat + landed + outbound
  // A fee rate at or above 100% has no break-even at any price, so report null rather
  // than a negative price that looks like an answer.
  const breakEvenPrice =
    pctTotal >= 1 ? null : (flatTotal + landedUnitCost + outbound) / (1 - pctTotal) - shippingCharged

  const unitsToCoverFreight = profit > 0 && shipTotal > 0 ? Math.ceil(shipTotal / profit) : null

  return {
    landedUnitCost,
    freightPerUnit,
    revenue,
    fees,
    profit,
    marginPct,
    breakEvenPrice,
    profitAtMoq: profit * moq,
    unitsToCoverFreight,
  }
}

/** $1,234.56 — negative renders as −$3.10, not $-3.10. */
export function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—"
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${v < 0 ? "−" : ""}$${s}`
}

export function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`
}
