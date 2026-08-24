// The ONE place order fields get formatted for display. The seller list
// (orders-list.tsx) and the staff hub (orders-hub.tsx) both render the same
// underlying order, so these must not be redefined per file — that private-copy
// habit is how the old app drifted (an order read "#4099" on one screen and
// "etsy-abc" on another). Add a formatter here, not in a component.

import { type OrderRow, type OrderItem } from "@/lib/api"

export const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Un-escape marketplace text so a HUMAN reads what the BUYER typed.
 *
 * Etsy returns buyer-entered strings HTML-escaped, so a personalization of
 *   "MRS. AUSTIN "
 * arrives and is stored as
 *   &quot;MRS. AUSTIN &quot;
 * React escapes on render (correctly — that's what stops the injection), so the ampersand
 * survives and the floor reads the entity verbatim.
 *
 * This is not cosmetic. Personalization is an INSTRUCTION: it is the text that gets
 * embroidered or printed. A line that reads &quot;MRS. AUSTIN &quot; is a line someone
 * can stitch onto an apron exactly as written, and it ships.
 *
 * Decoded on DISPLAY, never written back to the row — sync owns that column, and rewriting
 * what an integration authored is the one thing sync must never do. It also means existing
 * orders read correctly immediately, with no backfill.
 *
 * A fixed table, not `innerHTML` — that trick executes markup, runs only in the browser
 * (this module is imported during the prerender), and would turn buyer-controlled text into
 * a script vector. Etsy emits this handful and nothing else. `&amp;` is decoded LAST so
 * "&amp;quot;" resolves to the literal "&quot;" rather than a stray double-quote.
 */
const ENTITIES: [RegExp, string][] = [
  [/&quot;/g, '"'], [/&#0?39;/g, "'"], [/&apos;/g, "'"],
  [/&lt;/g, "<"], [/&gt;/g, ">"], [/&nbsp;/g, " "], [/&amp;/g, "&"],
]
export const decodeEntities = (s: string | null | undefined) =>
  s ? ENTITIES.reduce((out, [re, ch]) => out.replace(re, ch), s) : ""

/**
 * Display id. NB: o.id !== o.num for marketplace orders — sellers know the seq.
 *
 * Marketplace ids are stored prefixed (`etsy-4119530158`) because the prefix is
 * load-bearing for filtering. It is NOT load-bearing for reading: the trailing number is
 * the real Etsy receipt number, which is what the buyer quotes and what the seller's Etsy
 * dashboard shows. Stripping the prefix makes the number matchable against the source
 * instead of being an internal-looking string, and the platform is shown next to the shop
 * on the row's second line, where it belongs.
 */
const SOURCE_PREFIX = /^(etsy|shopify|amazon|ebay|tiktok|woo|walmart)-/i
/** The id with its routing prefix taken off — what the buyer and the marketplace both call
 *  this order. Takes a bare id, so screens that hold something narrower than an OrderRow
 *  (Shipments holds a parcel, not an order) can read it without a private copy of the regex. */
export const plainNum = (id: string) => String(id ?? "").replace(SOURCE_PREFIX, "")
/**
 * THE NUMBER, WITH ONE SHAPE.
 *
 * This read `#52` for one of ours and a bare `4149084185` for an Etsy order, side by side
 * in the same column — two things that are the same KIND of fact wearing two formats, which
 * makes a list look like it is showing you two different columns. The hash is what says
 * "this is the order number", and it is as true of a marketplace receipt as of our own
 * sequence; Etsy prints its own receipts as `#4149084185` too.
 *
 * Only for a number. Our own ids are `FF-<tag>-<time>-<rand>` and a hash in front of that
 * says nothing — it is already unmistakably a reference.
 */
export const numOf = (o: OrderRow) => {
  if (o.seq) return `#${o.seq}`
  const p = plainNum(String(o.id))
  return /^\d+$/.test(p) ? `#${p}` : p
}

/**
 * A readable ref when ALL you hold is the id — no seq, no row to read it from.
 *
 * Our own orders are minted client-side as `FF-<account tag>-<ms base36>-<random>`
 * (lib/order-id.ts) so two sellers can never collide without asking a server. That is a
 * KEY, not a number: nothing else in the product ever shows it, because everywhere else
 * has the row and shows `#seq`. Printed raw it is 24 characters of base36 that match
 * nothing the reader has seen before or will see again.
 *
 * Where the row IS available, use numOf. This is for the places that stored a bare id
 * months ago — a purchase-order line's `sources`, for one — and it does the only two
 * honest things left: take the routing prefix off a marketplace id, which leaves the
 * number the buyer and the marketplace both use; and shorten one of ours to its last
 * segment, which is the part that distinguishes it. The full id belongs in a title
 * attribute beside it, never as the label.
 */
export const shortOrderRef = (id: string) => {
  const raw = String(id ?? "")
  if (!raw) return ""
  const plain = plainNum(raw)
  if (plain !== raw) return plain                       // etsy-4148231554 → 4148231554
  const m = raw.match(/^FF-.*-([A-Za-z0-9]+)$/)         // FF-ombao6-msyfrdqn-2mfrc → FF-2mfrc
  return m ? `FF-${m[1]}` : raw
}
// Marketplaces capitalise their own names, and title-casing the raw source got two of them
// wrong on every row and in every filter — "Tiktok" and "Ebay" are not how those brands are
// written. Anything unlisted still falls back to title case, so a new source needs no entry.
const PLATFORM_NAMES: Record<string, string> = {
  etsy: "Etsy", shopify: "Shopify", tiktok: "TikTok", amazon: "Amazon",
  ebay: "eBay", woo: "WooCommerce", walmart: "Walmart", manual: "Manual",
}
/** The platform an id came from, read off the prefix alone. Same fallback as platformOf:
 *  anything without one is ours, which is "Manual". */
export const platformFromId = (id: string) => {
  const raw = (String(id ?? "").match(SOURCE_PREFIX)?.[1] ?? "manual").toLowerCase()
  return PLATFORM_NAMES[raw] ?? (raw.charAt(0).toUpperCase() + raw.slice(1))
}
/**
 * Re-exported, not re-written. It reads an id and nothing else, so it belongs beside the
 * prefix table in shared/order-rules.ts where the phone can import it too — this file is
 * where the WEB looks for a formatter, which is why the name still resolves here.
 */
export { orderRefLabel, recordedRevenue } from "@/shared/order-rules"
import { recordedRevenue } from "@/shared/order-rules"

/** The platform an order came from, as the platform writes it — "Etsy", "TikTok", "Manual". */
export const platformOf = (o: OrderRow) => {
  const raw = String(o.source || "").toLowerCase()
  return raw ? (PLATFORM_NAMES[raw] ?? (raw.charAt(0).toUpperCase() + raw.slice(1))) : platformFromId(String(o.id))
}
export const totalOf = (o: OrderRow) => Number(o.total ?? 0) || 0

/**
 * THE BUYER'S MONEY, OR NOTHING — never 0 standing in for "nobody recorded it".
 *
 * The rule itself lives in shared/order-rules.ts, where the phone can import it too: this is
 * asked by the queue, by the order page and by the mobile detail screen, and it had already
 * been answered differently in two of them — the queue printed "$0.00" for a manual order
 * while the detail page, three clicks away, said "not recorded" about the same row.
 */
export const revenueOf = (o: OrderRow): number | null =>
  recordedRevenue(o as { id?: string | null; total?: number | string | null; meta?: { retail_set?: boolean } | null })
export const customerOf = (o: OrderRow) => o.customer?.name || "—"
export const storeOf = (o: OrderRow) => {
  const s = (o.store || o.source || "manual").toString()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const variantOf = (it: OrderItem) => [it.color, it.size, it.print_type].filter(Boolean).join(" · ")

/**
 * WHAT A LINE IS, when the line itself is what you're identifying — blank first.
 *
 * `variantOf` above answers "which variant of this product", so it starts at colour and
 * takes the blank as read. This answers "which item is this", which is a different
 * question and needs the garment named: a file being attached to "Sport Grey · L" tells
 * you nothing on an order whose lines are all Sport Grey L.
 *
 * Returns "" when nothing is set, and that is a REAL state, not a failure — marketplace
 * orders arrive with variants unset and only the factory's own picks pre-fill them. A
 * caller must say so rather than render the empty string as a blank line.
 */
export const lineFactsOf = (it: OrderItem) =>
  [it.blank, it.color, it.print_type, it.size].filter(Boolean).join(" · ")
export const unitsOf = (o: OrderRow) => (o.items ?? []).reduce((n, it) => n + (Number(it.qty) || 1), 0)
export const lineTotal = (it: OrderItem) => (Number(it.unit_price) || 0) * (Number(it.qty) || 1)

/** The two PARTS of that label, for a cell that must not let the count be truncated away.
 *  Same rule, one implementation — `itemsLabel` is this joined up. */
export const itemsParts = (o: OrderRow): { first: string; extra: number } => {
  const items = o.items ?? []
  if (!items.length) return { first: "—", extra: 0 }
  return { first: items[0]?.name || items[0]?.sku || "Item", extra: items.length - 1 }
}

export const itemsLabel = (o: OrderRow) => {
  const { first, extra } = itemsParts(o)
  return extra > 0 ? `${first} +${extra}` : first
}

export const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/**
 * THE SHIP-TO — one reader, and it is NOT in this file any more.
 *
 * It moved to web/shared/order-address.ts on 2026-08-24, because "every screen" turned out
 * to mean the web screens only: mobile's addressLines() read `street1 || street` and so
 * showed no street on every Etsy, Shopify and TikTok order — the majority of the table.
 * A reader that only the web imports is still a private copy, it just has a longer leash.
 *
 * Re-exported here so no web call site changes and there is exactly one definition behind
 * the name. Add a spelling THERE, never here.
 */
import { shipAddressOf } from "@/shared/order-address"
export type { ShipTo, StoredAddress } from "@/shared/order-address"
export { shipAddressOf, hasStreet, isShippable, addressLines } from "@/shared/order-address"

/** Short "City, ST ZIP" for a row. */
export const addrLine = (o: OrderRow) => {
  const a = shipAddressOf(o)
  return [a.city, a.state, a.zip].filter(Boolean).join(", ")
}
/** Full street-level destination. */
export const shipTo = (o: OrderRow) => {
  const a = shipAddressOf(o)
  return [a.line1, a.city, a.state, a.zip].filter(Boolean).join(", ")
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

/** Where an order's address came from, so a board can say whether it synced or was
 *  filled in by hand. Etsy withholds buyer addresses from the API, so "how did we get
 *  this" is genuinely useful operational information, not trivia. */
export type AddressSource = "sync" | "csv" | "email" | "label" | "shippo" | "manual" | "none"
/*
 * THE ONE DELIBERATE EXCEPTION to reading through shipAddressOf().
 *
 * Everywhere else the spelling of the street is noise to be normalised away. Here it is
 * the SIGNAL — `first_line`/`line1` is what a marketplace sync writes, and that is how
 * this function knows the address synced rather than being typed. Normalising first would
 * throw away the only evidence it has, and every order would read "entered by hand".
 *
 * So it reads the raw column ON PURPOSE. Don't route it through the shared reader.
 */
export const addressSource = (o: OrderRow): AddressSource => {
  const a = (o.address ?? {}) as Record<string, string>
  const has = !!(a.street || a.first_line || a.line1 || a.address1)
  if (!has) return "none"
  if (a.source === "etsy-csv") return "csv"
  if (a.source === "etsy-email") return "email"
  // Backfilled from the label we actually bought (usps.js recordLabel). Distinct from
  // "manual": nobody typed it onto the ORDER — it is where the parcel was really sent,
  // which is worth saying, and it only exists because the order had no address at all.
  if (a.source === "label") return "label"
  // RECOVERED FROM SHIPPO. Etsy withholds buyer addresses from our app tier, so these
  // arrived through Shippo's Etsy connection instead — which is neither a sync of ours nor
  // anything a person typed. Without this case they fell through to "manual" and every one
  // announced itself as "entered by hand", which is a confident statement of the opposite
  // of the truth on the one field whose entire job is saying where an address came from.
  if (a.source === "shippo") return "shippo"
  // Came straight off a marketplace sync. This USED TO RETURN "etsy" and the label read
  // "from Etsy", because when it was written Etsy was the only marketplace and line1 was
  // its shape. Shopify and TikTok write line1 too, so every order from either announced
  // itself as an Etsy order — on the one field whose whole job is saying where the address
  // came from. WHICH marketplace is a property of the ORDER, never of the address shape.
  if (a.first_line || a.line1) return "sync"
  return "manual"
}

const STATIC_SOURCE_LABEL: Record<Exclude<AddressSource, "sync">, string> = {
  csv: "from CSV import",
  email: "from sale email",
  label: "from the label",
  shippo: "from Shippo",
  manual: "entered by hand",
  none: "no address yet",
}

/** What to print under a shipping address. Takes the ORDER because the synced case has to
 *  name the marketplace the order actually came from. */
export const addressSourceLabel = (o: OrderRow): string => {
  const s = addressSource(o)
  if (s !== "sync") return STATIC_SOURCE_LABEL[s]
  // platformOf falls back to "Manual" for anything without a marketplace prefix; a
  // hand-typed line1 is not "from Manual".
  const platform = platformOf(o)
  return platform && platform !== "Manual" ? `from ${platform}` : STATIC_SOURCE_LABEL.manual
}


/**
 * The concrete criteria for "can this order go out?", each answered from a FACT rather
 * than inferred from the pipeline stage.
 *
 * Stage says whose turn it is; these say what's actually true. Every shipping bug we hit
 * came from confusing the two — a label buy assuming "shipped", a queue assuming a stage
 * meant outbound. Anything checkable is checked here, and stage is used only for the one
 * step that isn't independently knowable (whether the scan has happened).
 *
 * `met: null` means "not applicable to this order" (e.g. artwork on an undecorated blank),
 * which reads differently from "not done yet" and shouldn't show as a gap.
 */
export type Check = {
  id: string; label: string; met: boolean | null; detail?: string
  /** How to say "this is what's missing" in a sentence — "needs Scanned" doesn't read. */
  blocked?: string
}

export function orderReadiness(o: OrderRow, opts?: { missingArtwork?: boolean }): Check[] {
  const stage = String(o.factory_status ?? "").toLowerCase()
  const scanned = ["working", "shipped", "printed"].includes(stage)
  const addr = shipAddressOf(o)
  const hasAddr = !!(addr.line1 && addr.zip)
  return [
    { id: "address", label: "Address", met: hasAddr, blocked: "no address", detail: hasAddr ? addrLine(o) : "No address — can't ship" },
    { id: "artwork", label: "Artwork", met: opts?.missingArtwork === undefined ? null : !opts.missingArtwork, blocked: "needs artwork" },
    { id: "label", label: "Label", met: !!o.tracking, blocked: "needs a label", detail: o.tracking ?? "No label bought yet" },
    { id: "printed", label: "Printed", met: !!o.label_printed_at, blocked: "label not printed", detail: o.label_printed_at ? `Printed ${fmtDate(o.label_printed_at)}` : "Label not printed yet" },
    // The one genuinely stage-derived check: nothing else records that a scan happened.
    { id: "scanned", label: "Scanned", met: scanned, blocked: "awaiting scan", detail: scanned ? "Scanned" : "Waiting on the scan" },
  ]
}
