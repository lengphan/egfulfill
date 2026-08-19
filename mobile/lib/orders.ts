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

/*
 * OPEN means the same thing here as on the boards: not shipped, and not parked in an
 * exception. This counted only shipped/cancelled/refunded as finished, so an ON HOLD order
 * stayed "open" on the phone while the web had already set it aside — the same floor,
 * counted two ways. web/lib/order-filter.ts: `!isException(stage) && stage !== "shipped"`.
 */
const CLOSED = new Set(["shipped", "cancelled", "refunded", "on_hold"])

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

/*
 * The FACTORY's own words for a stage — the exact labels in web/lib/factory-status.ts.
 *
 * These are not the seller's words: a seller sees collapsed stages, where approved and
 * working both read "In Process", because which internal step it is on is not their
 * business. The floor needs to know which. Two vocabularies on purpose — the mistake is
 * mixing them, or inventing a third here, which "In production" and "In review" were.
 */
export const STAGE_LABEL: Record<string, string> = {
  "": "New", in_review: "Pending", approved: "Approved", working: "Working",
  shipped: "Shipped", on_hold: "On hold", cancelled: "Cancelled", refunded: "Refunded",
}
/** The stage as a person reads it. Raw ids ("working", "in_review") were being printed
 *  straight onto rows, which is why the phone and the boards disagreed on wording. */
export const stageLabel = (o: Order) => STAGE_LABEL[normalizeStage(o.factory_status)] ?? ""

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
  /*
   * `in_review` IS NOT ON A FACTORY ORDER'S LINE — the phone was the only surface that
   * did not know this.
   *
   * The server keeps TWO lines (FACTORY_LINE in orders.js) and the web mirrors it with
   * nextStage(current, isFactory). "Pending" means the seller submitted and we took their
   * money; a factory-owned order has no seller, is never charged and approves itself, so
   * the stage cannot describe anything true about it. This file had one line, so the phone
   * offered "Move to Pending" on an order that can never legitimately be there — and a
   * legacy row already sitting at in_review had no way forward.
   */
  if (isFactoryOrder(o) && (at === "" || at === "in_review")) return "working"
  const i = at === "" ? -1 : PIPELINE.indexOf(at as (typeof PIPELINE)[number])
  const next = PIPELINE[i + 1]
  return next ?? null
}

export const isOpen = (o: Order) => !CLOSED.has(normalizeStage(o.factory_status))

/**
 * Mirrors isOverdue() in web/lib/order-filter.ts: the ship-by date decides when Etsy gave us
 * one, and age is only the fallback. Judging every order by age alone calls a young order
 * late and lets a genuinely late one through.
 */
export function isOverdue(o: Order, fallbackDays = 10): boolean {
  /*
   * A CLOSED ORDER IS NEVER LATE — the check web/lib/order-filter.ts makes first, and this
   * did not. Shipped, cancelled and refunded orders kept counting against their ship-by
   * date forever, so the phone's "Late" tally rose every day and included work that was
   * finished. Today happened to filter to open orders before counting and looked right;
   * the Orders list did not, so the two disagreed about the same floor.
   */
  if (!isOpen(o)) return false
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

/* ── LINES ────────────────────────────────────────────────────────────────────
 * A line is the unit of work. The order is the unit of shipping. Everything below keeps
 * those two apart, because conflating them is what makes a three-line order look like one
 * job on a small screen.
 */

/**
 * HOW A LINE IS ADDRESSED — mirrors the server's DESIGN_KEY,
 * `coalesce('L:' || line_id, 'S:' || sku)` in orders.js.
 *
 * The prefixes are load-bearing there and here: plain coalesce(line_id, sku) mixes two
 * identifier namespaces, and Etsy hands out the same id shape for both, so one row's
 * line_id has genuinely equalled another's sku.
 */
export const lineKey = (x: { line_id?: string | null; sku?: string | null }) =>
  x.line_id ? `L:${x.line_id}` : x.sku ? `S:${x.sku}` : ""

/**
 * The files belonging to THIS line, and no other.
 *
 * Matched on line_id first and sku only as the fallback, which is the same order the
 * server writes them in. Matching on sku alone is what makes an order with two identical
 * blanks show one line's artwork against the other's — the exact question "which item is
 * showing which file" is asking.
 */
export function designsFor<T extends { line_id?: string | null; sku?: string | null }>(
  item: { line_id?: string | null; sku?: string | null },
  designs: T[],
): T[] {
  const byLine = item.line_id ? designs.filter((d) => d.line_id && String(d.line_id) === String(item.line_id)) : []
  if (byLine.length) return byLine
  // Only rows that carry NO line_id may fall back to sku. A row that has one has already
  // been matched (or belongs to a sibling), and letting it match by sku here is how a
  // sibling's file reappears under the wrong line.
  if (!item.sku) return []
  return designs.filter((d) => !d.line_id && d.sku && String(d.sku) === String(item.sku))
}

/** Human words for a file. 'raster' is the artwork; the rest are machine files. */
export const KIND_LABEL: Record<string, string> = {
  raster: "Artwork", print: "Print file", pes: "PES", emb: "EMB", dst: "DST", exp: "EXP", jef: "JEF",
}
export const isArtwork = (kind?: string | null) => {
  const k = String(kind || "raster").toLowerCase()
  return k === "raster" || k === "print" || k === "image"
}

/** The picture to put beside a line: its OWN artwork first, the listing photo only if
 *  there is none. A listing photo tells the floor nothing about what to print. */
/**
 * THE ARTWORK, AND ONLY THE ARTWORK.
 *
 * This fell through to `img_ref || img`, and those are the marketplace LISTING photo —
 * etsy.js sets `img` from listingImage() and puts the buyer's upload in `design_src`. So a
 * line with nothing to print rendered a photo of finished aprons on a rack, immediately
 * above its own sentence "No artwork on this line yet": two claims on one card, disagreeing.
 *
 * orders.js says the same thing about its card thumb, in as many words — "Never the
 * marketplace listing photo: a designer opening a card needs to see what they're
 * digitising, and a photo of the finished product tells them nothing about the file." The
 * fallback contradicted the rule it was written under.
 *
 * Returns null when there is no artwork, which is a REAL state — a plain blank has nothing
 * to print — and the caller must show it as one rather than borrowing a picture.
 */
export function lineArt(
  item: { design_src?: string | null },
  designs: { kind?: string | null; data?: string | null; url?: string | null }[],
): string | null {
  const art = designs.find((d) => isArtwork(d.kind))
  return art?.url || art?.data || item.design_src || null
}

/** The marketplace's photo of the finished product. NOT artwork — it is what the buyer saw
 *  on the listing, which is worth having beside the file but never in place of it. */
export const lineListing = (item: { img?: string | null; img_ref?: string | null }): string | null =>
  item.img_ref || item.img || null

/**
 * The line's product name.
 *
 * The BLANK is the floor's name for a thing — stock, purchasing and the supplier all key
 * off it — but it is a code, and a code alone is not a name a person recognises across a
 * table. So the marketplace title leads when there is one and the blank rides underneath
 * as the identifier it is, rather than both being stacked as if they were equals.
 */
export const lineTitle = (it: { name?: string | null; blank?: string | null; sku?: string | null }) =>
  it.name || it.blank || it.sku || "Untitled line"

/** Colour · size · method, already filtered — an empty variant must not print " ·  · ". */
export const lineFacts = (it: { color?: string | null; size?: string | null; print_type?: string | null }) =>
  [it.color, it.size, it.print_type].map((v) => (v ? String(v).trim() : "")).filter(Boolean)

/** The factory's OWN order rather than a seller's. Mirrors isFactoryOrder in
 *  web/lib/factory-status.ts, which reads the same column. */
export const isFactoryOrder = (o?: { factory_order?: boolean | null } | null) => !!o?.factory_order

/** Where this LINE goes next. Same pipeline as the order — the floor moves lines — and
 *  the same two-line rule, so `order` has to be passed: a line cannot tell on its own
 *  whether the order it belongs to is the factory's. */
export function nextLineStage(
  it: { factory_status?: string | null },
  order?: { factory_order?: boolean | null } | null,
): string | null {
  const at = normalizeStage(it.factory_status)
  if (EXCEPTIONS.includes(at)) return null
  if (isFactoryOrder(order) && (at === "" || at === "in_review")) return "working"
  const i = at === "" ? -1 : PIPELINE.indexOf(at as (typeof PIPELINE)[number])
  const next = PIPELINE[i + 1] ?? null
  /**
   * A LINE IS NEVER SHIPPED ON ITS OWN — the parcel is the order.
   *
   * The line ladder was the order ladder, so a line sitting at Working offered "Ship this
   * line", and pressing it on a three-line order claimed one item had gone while two sat
   * on the bench. There is one parcel, one label and one tracking number for the whole
   * order, so there is one shipping event, and it belongs to the order.
   *
   * Making is per line and stops at Working, which is the real boundary: after that the
   * work is packing, and packing is not something you do to one item of three. Confirm
   * shipment on the order is the step that follows, and the server independently refuses
   * a ship it cannot back (no label, or a decorated line with no artwork) — this only
   * stops the phone OFFERING a move that would be wrong.
   */
  return next === "shipped" ? null : next
}

/**
 * THE BUTTON'S WORDS, in one place, because there are two buttons.
 *
 * They were built inline at both call sites and repeated the stage twice over: the order
 * button read "Move to Pending" above "Moves the whole order to Pending", and the line
 * button read "Move to Pending this line", which is not a sentence. The verb carries it
 * where there is one; the fallback names the stage ONCE.
 */
export const stageAction = (to: string) =>
  STAGE_VERB[to] ? `${STAGE_VERB[to]} Order` : `Move Order to ${STAGE_LABEL[to] ?? to}`
/** "Start Item", not "Start this line". The card IS the item, so "this line" was a pointer
 *  to the thing the button already sits on — and "line" is our word for it, not anyone
 *  else's. Same shape as the order button, one word apart, so the pair reads as a pair. */
export const stageActionLine = (to: string) =>
  STAGE_VERB[to] ? `${STAGE_VERB[to]} Item` : `Move Item to ${STAGE_LABEL[to] ?? to}`

/**
 * The word on the button that starts the work, rather than the name of a state. Someone
 * looking for where to press is looking for a verb.
 *
 * These are VERBS FOR THE STAGES ABOVE, not a second set of names for them — anything
 * without an entry falls back to "Move to <STAGE_LABEL>", which is why in_review has none.
 * "Send to review" would have been a third vocabulary for a stage the floor calls Pending.
 */
export const STAGE_VERB: Record<string, string> = {
  approved: "Approve", working: "Start", shipped: "Ship",
}


/**
 * THE DELIVERY ADDRESS AS LINES, in the order an envelope is read.
 *
 * Returned as an array rather than a joined string because a phone renders it as an
 * address block, and joining with commas here would force the caller to split it again.
 * Empty array means nothing usable — which is a real state on an Etsy order, where the
 * buyer's address is withheld behind Etsy's app-tier PII gate and is NOT our bug.
 */
export function addressLines(a?: {
  name?: string | null; street1?: string | null; street?: string | null; street2?: string | null
  city?: string | null; state?: string | null; zip?: string | null; country?: string | null
} | null): string[] {
  if (!a) return []
  const cityLine = [a.city, a.state].filter(Boolean).join(", ")
  return [
    a.name,
    a.street1 || a.street,
    a.street2,
    [cityLine, a.zip].filter(Boolean).join(" "),
    a.country,
  ].map((v) => String(v ?? "").trim()).filter(Boolean)
}
