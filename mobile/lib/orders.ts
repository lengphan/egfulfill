import type { Order } from "./api"
import {
  PIPELINE, STAGE_LABEL, normalizeStage, isOpenStage, isException,
  nextStage as nextStageOn, stageDenialReason, canSetStage, isFactoryOrder,
  isOverdueBy, DEFAULT_OVERDUE_DAYS, plainNum, platformFromId, unitsOfItems,
} from "@shared/order-rules"

/**
 * THE RULES — NOT A COPY OF THEM ANY MORE.
 *
 * This file used to port web/lib/factory-status.ts rule for rule, with a comment promising
 * the two would move into a package "the moment this stops being a spike". They have. The
 * ladder, the stage vocabulary and the role gate now live once, in shared/order-rules.ts,
 * and both front-ends import that file — metro.config.js watches it, so it hot-reloads here
 * like any local module.
 *
 * They are re-exported under the names this app already used, so every screen's import is
 * unchanged and there is exactly one definition behind them.
 *
 * What is still duplicated on purpose: stageDenial() in server/src/routes/orders.js. That is
 * the one that ENFORCES; this one exists so a control can be greyed with its reason instead
 * of being pressed and failing. tools/stage-gate-diff.mjs executes both over the whole
 * role × stage matrix and fails if they ever answer differently.
 */
export {
  PIPELINE, STAGE_LABEL, normalizeStage, isException, stageDenialReason, canSetStage,
  isFactoryOrder, plainNum,
}
/** The stage as a person reads it. Raw ids ("working", "in_review") were being printed
 *  straight onto rows, which is why the phone and the boards disagreed on wording. */
export const stageLabel = (o: Order) => STAGE_LABEL[normalizeStage(o.factory_status)] ?? ""

/* ── THE LADDER ───────────────────────────────────────────────
 *
 * SELLER_LINE / FACTORY_LINE / lineFor / posOf and the whole role gate moved to
 * shared/order-rules.ts. The phone is an extension of the web app, not a second opinion
 * about it — which is now structural rather than a promise in a comment.
 *
 * The wrappers below stay because the screens pass an Order, not (stage, isFactory). */

export function nextStage(o: Order): string | null {
  return nextStageOn(o.factory_status, isFactoryOrder(o))
}

export const isOpen = (o: Order) => isOpenStage(normalizeStage(o.factory_status))

/** Late against the PROMISE where there is one, and only then against age. Delegates to
 *  shared/order-rules.ts — this was a hand-kept copy that had drifted twice (it counted
 *  closed orders as late forever, so the phone's Late tally climbed over finished work). */
export const isOverdue = (o: Order, fallbackDays = DEFAULT_OVERDUE_DAYS) =>
  isOverdueBy(o, fallbackDays)

export const units = (o: Order) => unitsOfItems(o.items)

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
 * The prefix table and plainNum() live in shared/order-rules.ts now — this was the third
 * copy of them, and the comment that used to sit here said so and asked for exactly this.
 */
/**
 * A READABLE REF WHEN THERE IS NO SEQ — ported from web/lib/order-format.ts, not invented.
 *
 * Our own orders are minted client-side as `FF-<account tag>-<ms base36>-<random>` so two
 * sellers cannot collide without asking a server. That is a KEY, not a number: printed raw
 * it is two dozen characters of base36 matching nothing the reader has seen before. The web
 * shortens it to its last segment — the part that distinguishes it — and the phone was
 * printing the whole thing, which is why a manual order looked wrong next to an Etsy one.
 */
export const shortOrderRef = (id: string) => {
  const raw = String(id ?? "")
  if (!raw) return ""
  const plain = plainNum(raw)
  if (plain !== raw) return plain                   // etsy-4148231554 → 4148231554
  const m = raw.match(/^FF-.*-([A-Za-z0-9]+)$/)     // FF-ombao6-msyfrdqn-2mfrc → FF-2mfrc
  return m ? `FF-${m[1]}` : raw
}
/** Mirrors web/lib/order-format.ts numOf — same rule, same shape, so the phone and the
 *  packing slip never quote an order differently. The hash marks a NUMBER; our own
 *  FF-… references already read as references and do not take one. */
export const numOf = (o: Order) => {
  if (o.seq) return `#${o.seq}`
  const ref = shortOrderRef(String(o.id))
  return /^\d+$/.test(ref) ? `#${ref}` : ref
}
export const platformOf = (o: Order) => platformFromId(String(o.id ?? ""))

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

/**
 * Where this LINE goes next — the SAME ladder as the order.
 *
 * The floor moves lines, so a line climbs the line its order is on, and `order` has to be
 * passed because a line cannot tell on its own whether the order it belongs to is the
 * factory's.
 *
 * IT NO LONGER HAS RULES OF ITS OWN. It carried two, both of which made the phone refuse
 * work the web hands out:
 *
 *  • "a line never goes to Pending" — it remapped in_review to approved, which on a seller
 *    order steps over Pending and is exactly what the server calls a skip. So every
 *    untouched line on a seller order showed "Approve Item", and pressing it returned
 *    "That would skip Pending" for admin, warehouse and operator alike. A button nobody
 *    could ever succeed with.
 *
 *  • "a line is never shipped on its own" — the web's per-line control offers Shipped, and
 *    the server backs it with shipBlockers (a label must exist, and every decorated line
 *    must have artwork). Withholding it here meant the one surface someone uses while
 *    standing over the parcel was the one that could not record it.
 */
export function nextLineStage(
  it: { factory_status?: string | null },
  order?: { factory_order?: boolean | null } | null,
): string | null {
  return nextStageOn(it.factory_status, isFactoryOrder(order))
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
