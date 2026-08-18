import type { Order } from "./api"

/**
 * THE RULES, and they must never disagree with the web.
 *
 * Ported from web/lib/factory-status.ts and web/lib/order-filter.ts rather than reinvented.
 * For the spike they are duplicated here so the app can run standalone; the moment this
 * stops being a spike they move to a package both surfaces import, because a second copy of
 * "what does Working mean" is exactly how one screen starts telling a different story about
 * a real order. CLAUDE.md records three files that already grew private copies of these.
 */

const DONE = new Set(["shipped", "cancelled", "refunded"])

/** Mirrors normalizeStage() in web/lib/factory-status.ts and the server's PIPELINE. */
export function normalizeStage(s?: string | null): string {
  const v = String(s ?? "").trim().toLowerCase()
  if (!v) return ""
  if (v === "in_production" || v === "in production") return "working"
  if (v === "awaiting_scan" || v === "awaiting scan") return "packed"
  return v.replace(/\s+/g, "_")
}

export const isOpen = (o: Order) => !DONE.has(normalizeStage(o.factory_status))

/**
 * Mirrors isOverdue() in web/lib/order-filter.ts: the ship-by date decides when Etsy gave us
 * one, and age is only the fallback. Judging every order by age alone calls a young order
 * late and lets a genuinely late one through.
 */
export function isOverdue(o: Order, fallbackDays = 10): boolean {
  if (o.ship_by) return new Date(o.ship_by).getTime() < Date.now()
  if (!o.created_at) return false
  const days = (Date.now() - new Date(o.created_at).getTime()) / 86_400_000
  return days > fallbackDays
}

export const units = (o: Order) => (o.items ?? []).reduce((n, it) => n + (Number(it.qty) || 1), 0)

export function ageLabel(o: Order): string {
  if (!o.created_at) return "—"
  const h = (Date.now() - new Date(o.created_at).getTime()) / 3_600_000
  return h < 24 ? `${Math.max(1, Math.round(h))}h` : `${Math.round(h / 24)}d`
}

/*
 * HOW AN ORDER IS NAMED — mirrors web/lib/order-format.ts.
 *
 * `etsy-4148231554` is a ROUTING id, not a number anyone reads. The buyer, the marketplace
 * and the packing slip all say 4148231554; the `etsy-` is ours. Our own orders carry a seq
 * and are written `#1234`.
 *
 * The platform belongs on the row's second line, not welded to the front of the number.
 *
 * DUPLICATED, and it should not be: this file already mirrors the stage vocabulary in
 * server/src/routes/orders.js, and this makes a third copy of rules the web also holds.
 * The fix is a shared package both apps import; until then, changing either side means
 * changing both.
 */
const SOURCE_PREFIX = /^(etsy|shopify|amazon|ebay|tiktok|woo|walmart)-/i
const PLATFORM_NAMES: Record<string, string> = {
  etsy: "Etsy", shopify: "Shopify", tiktok: "TikTok", amazon: "Amazon",
  ebay: "eBay", woo: "WooCommerce", walmart: "Walmart", manual: "Manual",
}
export const plainNum = (id: string) => String(id ?? "").replace(SOURCE_PREFIX, "")
export const numOf = (o: Order) => (o.seq ? `#${o.seq}` : plainNum(String(o.id)))
export const platformOf = (o: Order) => {
  const raw = (String(o.id ?? "").match(SOURCE_PREFIX)?.[1] ?? "manual").toLowerCase()
  return PLATFORM_NAMES[raw] ?? (raw.charAt(0).toUpperCase() + raw.slice(1))
}
