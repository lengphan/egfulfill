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
export const numOf = (o: OrderRow) => (o.seq ? `#${o.seq}` : String(o.id).replace(SOURCE_PREFIX, ""))
/** The platform an order came from, title-cased — "Etsy", "Shopify", or "Manual". */
export const platformOf = (o: OrderRow) => {
  const raw = String(o.source || (String(o.id).match(SOURCE_PREFIX)?.[1] ?? "") || "manual").toLowerCase()
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}
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

/** Where an order's address came from, so a board can say whether it synced or was
 *  filled in by hand. Etsy withholds buyer addresses from the API, so "how did we get
 *  this" is genuinely useful operational information, not trivia. */
export type AddressSource = "etsy" | "csv" | "email" | "manual" | "none"
export const addressSource = (o: OrderRow): AddressSource => {
  const a = (o.address ?? {}) as Record<string, string>
  const has = !!(a.street || a.first_line || a.line1 || a.address1)
  if (!has) return "none"
  if (a.source === "etsy-csv") return "csv"
  if (a.source === "etsy-email") return "email"
  // Came straight off the marketplace sync — the Etsy shape uses line1/first_line.
  if (a.first_line || a.line1) return "etsy"
  return "manual"
}

export const ADDRESS_SOURCE_LABEL: Record<AddressSource, string> = {
  etsy: "from Etsy",
  csv: "from CSV import",
  email: "from sale email",
  manual: "entered by hand",
  none: "no address yet",
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
  const addr = (o.address ?? {}) as Record<string, string>
  const hasAddr = !!((addr.street || addr.first_line || addr.line1 || addr.address1) && (addr.zip || addr.postal_code))
  return [
    { id: "address", label: "Address", met: hasAddr, blocked: "no address", detail: hasAddr ? addrLine(o) : "No address — can't ship" },
    { id: "artwork", label: "Artwork", met: opts?.missingArtwork === undefined ? null : !opts.missingArtwork, blocked: "needs artwork" },
    { id: "label", label: "Label", met: !!o.tracking, blocked: "needs a label", detail: o.tracking ?? "No label bought yet" },
    { id: "printed", label: "Printed", met: !!o.label_printed_at, blocked: "label not printed", detail: o.label_printed_at ? `Printed ${fmtDate(o.label_printed_at)}` : "Label not printed yet" },
    // The one genuinely stage-derived check: nothing else records that a scan happened.
    { id: "scanned", label: "Scanned", met: scanned, blocked: "awaiting scan", detail: scanned ? "Scanned" : "Waiting on the scan" },
  ]
}
