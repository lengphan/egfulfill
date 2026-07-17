// The ONE place order fields get formatted for display. The seller list
// (orders-list.tsx) and the staff hub (orders-hub.tsx) both render the same
// underlying order, so these must not be redefined per file — that private-copy
// habit is how the old app drifted (an order read "#4099" on one screen and
// "etsy-abc" on another). Add a formatter here, not in a component.

import { type OrderRow, type OrderItem } from "@/lib/api"

export const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Display id. NB: o.id !== o.num for marketplace orders — sellers know the seq. */
export const numOf = (o: OrderRow) => (o.seq ? `#${o.seq}` : o.id)
export const totalOf = (o: OrderRow) => Number(o.total ?? 0) || 0
export const customerOf = (o: OrderRow) => o.customer?.name || "—"
export const storeOf = (o: OrderRow) => {
  const s = (o.store || o.source || "manual").toString()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const variantOf = (it: OrderItem) => [it.color, it.size, it.print_type].filter(Boolean).join(" · ")
export const unitsOf = (o: OrderRow) => (o.items ?? []).reduce((n, it) => n + (Number(it.qty) || 1), 0)
export const lineTotal = (it: OrderItem) => (Number(it.unit_price) || 0) * (Number(it.qty) || 1)

export const itemsLabel = (o: OrderRow) => {
  const items = o.items ?? []
  if (!items.length) return "—"
  const first = items[0]?.name || items[0]?.sku || "Item"
  return items.length > 1 ? `${first} +${items.length - 1}` : first
}

export const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// Address key shapes differ by source (Etsy sends first_line/second_line, manual
// sends street/street2), so every reader must accept both.
const addrOf = (o: OrderRow) => (o.address ?? {}) as Record<string, string>
/** Short "City, ST ZIP" for a row. */
export const addrLine = (o: OrderRow) => {
  const a = addrOf(o)
  return [a.city, a.state, a.zip || a.postal_code].filter(Boolean).join(", ")
}
/** Full street-level destination. */
export const shipTo = (o: OrderRow) => {
  const a = addrOf(o)
  return [a.street || a.first_line || a.line1 || a.address1, a.city, a.state, a.zip || a.postal_code].filter(Boolean).join(", ")
}

/** Public tracking page for a carrier + number, so a number is never a dead end. */
export const trackUrl = (carrier?: string | null, tracking?: string | null) => {
  if (!tracking) return ""
  const t = encodeURIComponent(tracking.replace(/\s+/g, ""))
  const c = (carrier || "").toLowerCase()
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${t}`
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${t}`
  if (c.includes("dhl")) return `https://www.dhl.com/en/express/tracking.html?AWB=${t}`
  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`
}
