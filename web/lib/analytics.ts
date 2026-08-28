// Shared order analytics — one source of truth so Dashboard and Reports never
// disagree (same revenue math, same groupings). All derived from /api/orders.
import type { OrderRow } from "./api"

const DAY = 864e5
export const orderTotalOf = (o: OrderRow) => Number(o.total ?? 0) || 0
export const orderProfitOf = (o: OrderRow) => Number(o.profit ?? 0) || 0
export const orderTs = (o: OrderRow) => (o.created_at ? new Date(o.created_at).getTime() : NaN)

// ── Fulfilment speed ─────────────────────────────────────────────────────────
// Every duration is derived from REAL carrier + factory timestamps, never modelled.
const ts = (s?: string | null) => (s ? new Date(s).getTime() : NaN)

// When the parcel physically left us — the carrier's acceptance scan.
const shippedTs = (o: OrderRow) => ts(o.label_scanned_at)
// When it was delivered. Prefer the exact event time; fall back to the poll time for
// orders delivered before we started capturing it (approximate, but keeps history in).
const deliveredTs = (o: OrderRow) => {
  const exact = ts(o.delivered_at)
  if (!isNaN(exact)) return exact
  return o.delivery_status === "delivered" ? ts(o.delivery_checked_at) : NaN
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const daysBetween = (from: number, to: number) => (to - from) / DAY

export type SpeedStat = { days: number | null; n: number }
export type FulfillmentSpeed = {
  production: SpeedStat  // placed → carrier acceptance
  transit: SpeedStat     // carrier acceptance → delivered
  total: SpeedStat       // placed → delivered
  onTime: { pct: number | null; n: number } // delivered by the carrier's ETA
}

/** Median production / transit / total lead times + on-time rate, off real timestamps.
 *  A metric with no qualifying orders reports n:0 and a null value, so the card can say
 *  "no data yet" rather than a misleading 0. */
export function fulfillmentSpeed(orders: OrderRow[]): FulfillmentSpeed {
  const prod: number[] = [], trans: number[] = [], tot: number[] = []
  let onTimeHit = 0, onTimeN = 0
  for (const o of orders) {
    const placed = orderTs(o), ship = shippedTs(o), deliv = deliveredTs(o)
    if (!isNaN(placed) && !isNaN(ship) && ship >= placed) prod.push(daysBetween(placed, ship))
    if (!isNaN(ship) && !isNaN(deliv) && deliv >= ship) trans.push(daysBetween(ship, deliv))
    if (!isNaN(placed) && !isNaN(deliv) && deliv >= placed) tot.push(daysBetween(placed, deliv))
    const eta = ts(o.est_delivery)
    if (!isNaN(deliv) && !isNaN(eta)) { onTimeN++; if (deliv <= eta + DAY) onTimeHit++ } // grace to end of ETA day
  }
  const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10)
  return {
    production: { days: round1(median(prod)), n: prod.length },
    transit: { days: round1(median(trans)), n: trans.length },
    total: { days: round1(median(tot)), n: tot.length },
    onTime: { pct: onTimeN ? Math.round((onTimeHit / onTimeN) * 100) : null, n: onTimeN },
  }
}

export type RevPoint = { label: string; revenue: number; prev: number }

// Bucket revenue into n buckets of `daysPer` days each (current + previous window).
function bucketize(orders: OrderRow[], n: number, daysPer: number, now: number, label: (i: number) => string): RevPoint[] {
  const span = daysPer * DAY
  const windowMs = n * span
  const cur = new Array(n).fill(0)
  const prev = new Array(n).fill(0)
  for (const o of orders) {
    const t = orderTs(o)
    if (isNaN(t)) continue
    const age = now - t
    const total = orderTotalOf(o)
    if (age >= 0 && age < windowMs) cur[n - 1 - Math.floor(age / span)] += total
    else if (age >= windowMs && age < 2 * windowMs) prev[n - 1 - Math.floor((age - windowMs) / span)] += total
  }
  return cur.map((rev, i) => ({ label: label(i), revenue: Math.round(rev), prev: Math.round(prev[i]) }))
}

/**
 * The revenue chart's buckets. `tag` is a parameter for the same reason fmtDate's is: these
 * are axis LABELS — weekday and month names — and they were the last English on a Vietnamese
 * reports page. Non-React callers keep the old behaviour via the default.
 */
export function revenueSeries(orders: OrderRow[], now: number, tag: string = "en-US"): Record<string, RevPoint[]> {
  return {
    "7d": bucketize(orders, 7, 1, now, (i) => new Date(now - (6 - i) * DAY).toLocaleDateString(tag, { weekday: "short" })),
    "4w": bucketize(orders, 4, 7, now, (i) => `W${i + 1}`),
    "3m": bucketize(orders, 3, 30, now, (i) => new Date(now - (2 - i) * 30 * DAY).toLocaleDateString(tag, { month: "short" })),
  }
}

/**
 * A DAILY run over `days`, current window and the one before it.
 *
 * revenueSeries buckets into 7 / 4 / 3 points because an area chart with axis labels wants
 * few of them. A bar strip wants the opposite: at four buckets the bars render as slabs and
 * stop reading as a shape at all. So the range control changes the WINDOW here, not the
 * number of bars — 7d is seven bars, 4w is twenty-eight, 3m is ninety.
 */
export function dailyRevenue(orders: OrderRow[], days: number, now: number): RevPoint[] {
  return bucketize(orders, days, 1, now, (i) => String(i))
}

/**
 * Bucket revenue scaled 0..1 — the SHAPE of the run, which is all a bar strip draws.
 *
 * Mirrors what `Overview.gmvBars` hands the staff dashboard off the reports endpoint, so one
 * panel can draw either: staff get it computed server-side over every seller, a seller gets
 * it computed here over their own orders, and neither the panel nor this function has to know
 * which. Scaled against the tallest bar in the window, so an empty window is all zeros rather
 * than a divide by nothing.
 */
export function barsOf(points: RevPoint[], key: "revenue" | "prev" = "revenue"): number[] {
  const max = points.reduce((m, p) => Math.max(m, p[key]), 0)
  return max > 0 ? points.map((p) => p[key] / max) : points.map(() => 0)
}

export function channelBreakdown(orders: OrderRow[]): { name: string; revenue: number; pct: number }[] {
  const by: Record<string, number> = {}
  for (const o of orders) {
    const ch = String(o.store || o.source || "manual")
    const name = ch.charAt(0).toUpperCase() + ch.slice(1)
    by[name] = (by[name] || 0) + orderTotalOf(o)
  }
  const total = Object.values(by).reduce((a, b) => a + b, 0) || 1
  return Object.entries(by)
    .map(([name, revenue]) => ({ name, revenue, pct: Math.round((revenue / total) * 100) }))
    .sort((a, b) => b.revenue - a.revenue)
}

export function topProducts(orders: OrderRow[], limit = 6): { name: string; units: number; revenue: number; img?: string | null }[] {
  const by: Record<string, { units: number; revenue: number; img?: string | null }> = {}
  for (const o of orders) {
    for (const it of o.items ?? []) {
      const name = it.name || it.sku || "Item"
      const qty = Number(it.qty) || 1
      const rev = (Number(it.unit_price) || 0) * qty
      if (!by[name]) by[name] = { units: 0, revenue: 0 }
      by[name].units += qty
      by[name].revenue += rev
      // FIRST one wins, and it is never overwritten by a later blank: the same product can
      // appear on a line that carried a thumbnail and on one that did not.
      if (!by[name].img && it.img) by[name].img = it.img
    }
  }
  return Object.entries(by)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
}
