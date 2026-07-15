// Shared order analytics — one source of truth so Dashboard and Reports never
// disagree (same revenue math, same groupings). All derived from /api/orders.
import type { OrderRow } from "./api"

const DAY = 864e5
export const orderTotalOf = (o: OrderRow) => Number(o.total ?? 0) || 0
export const orderTs = (o: OrderRow) => (o.created_at ? new Date(o.created_at).getTime() : NaN)

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

export function revenueSeries(orders: OrderRow[], now: number): Record<string, RevPoint[]> {
  return {
    "7d": bucketize(orders, 7, 1, now, (i) => new Date(now - (6 - i) * DAY).toLocaleDateString("en-US", { weekday: "short" })),
    "4w": bucketize(orders, 4, 7, now, (i) => `W${i + 1}`),
    "3m": bucketize(orders, 3, 30, now, (i) => new Date(now - (2 - i) * 30 * DAY).toLocaleDateString("en-US", { month: "short" })),
  }
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

export function topProducts(orders: OrderRow[], limit = 6): { name: string; units: number; revenue: number }[] {
  const by: Record<string, { units: number; revenue: number }> = {}
  for (const o of orders) {
    for (const it of o.items ?? []) {
      const name = it.name || it.sku || "Item"
      const qty = Number(it.qty) || 1
      const rev = (Number(it.unit_price) || 0) * qty
      if (!by[name]) by[name] = { units: 0, revenue: 0 }
      by[name].units += qty
      by[name].revenue += rev
    }
  }
  return Object.entries(by)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
}
