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

/*
 * MIRRORS normalizeStage() and PIPELINE in server/src/routes/orders.js. Change both.
 *
 * This had DRIFTED: it folded `awaiting_scan` onto "packed" and passed every other unknown
 * value straight through, while the server folds the whole retired vocabulary onto
 * "working" and returns "" for anything it does not know. So the phone could name a stage
 * the server has never heard of — harmless while it only displayed them, and not harmless
 * now that it can ASK for one.
 */
export const PIPELINE = ["in_review", "approved", "working", "shipped"] as const
const EXCEPTIONS = ["on_hold", "cancelled", "refunded"]
const RETIRED_WORKING = [
  "ready_print", "in_queue", "queued", "prescan", "printed", "label", "labelled", "labeled",
  "awaiting_scan", "awaiting-scan", "scanned", "printing", "qc", "production", "in_production",
  "in-prod", "prepress", "packing", "packed", "ready", "finished",
]

export function normalizeStage(s?: string | null): string {
  const v = String(s ?? "").trim().toLowerCase()
  if (["new", "draft", "none", "pending", ""].includes(v)) return ""
  if ((PIPELINE as readonly string[]).includes(v) || EXCEPTIONS.includes(v)) return v
  if (RETIRED_WORKING.includes(v)) return "working"
  if (["fulfilled", "delivered", "in_transit"].includes(v)) return "shipped"
  if (["flagged", "escalated", "action", "backorder", "replacement"].includes(v)) return "on_hold"
  return ""
}

/** Human words for a stage. "" is an order nobody has started. */
export const STAGE_LABEL: Record<string, string> = {
  "": "New", in_review: "In review", approved: "Approved", working: "In production",
  shipped: "Shipped", on_hold: "On hold", cancelled: "Cancelled", refunded: "Refunded",
}

/**
 * The ONE stage this order may move to next, or null at the end of the line.
 *
 * One step, never a jump: the server refuses a skip for everyone including admin — it is
 * not a permission but what the pipeline means, since nobody can make an order have been
 * printed when it wasn't. Offering only the next step means the phone never asks for
 * something that will be refused.
 *
 * Exceptions (on hold, cancelled, refunded) have no next step here. Clearing a hold is a
 * decision with a reason attached, and that belongs on a screen with room for one.
 */
export function nextStage(o: Order): string | null {
  const at = normalizeStage(o.factory_status)
  if (EXCEPTIONS.includes(at)) return null
  const i = at === "" ? -1 : PIPELINE.indexOf(at as (typeof PIPELINE)[number])
  const next = PIPELINE[i + 1]
  return next ?? null
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
