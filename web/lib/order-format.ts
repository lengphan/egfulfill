// The ONE place order fields get formatted for display. The seller list
// (orders-list.tsx) and the staff hub (orders-hub.tsx) both render the same
// underlying order, so these must not be redefined per file — that private-copy
// habit is how the old app drifted (an order read "#4099" on one screen and
// "etsy-abc" on another). Add a formatter here, not in a component.

import { type OrderRow, type OrderItem } from "@/lib/api"

/**
 * MONEY, AND THE SIGN GOES BEFORE THE SYMBOL.
 *
 * This used to be `` `$${n.toLocaleString(...)}` ``, which renders a negative as `$-20.50`
 * — the dollar sign, then the minus, then the digits. No accounting surface writes it that
 * way, and it showed up on the single row it matters most on: Gross margin, the one figure
 * on an order that tells you whether the job lost money. Every deduction ABOVE it read
 * `−$39.00` correctly, because those call sites prepend the sign by hand to a positive
 * amount — so the loss row was the only one in the column formatted differently from its
 * neighbours, which is exactly where the eye is least forgiving.
 *
 * U+2212 MINUS SIGN, not a hyphen, matching the six call sites that already prepend one.
 * At `tabular-nums` a hyphen sits high and short against the digits; the minus is drawn to
 * the same width and height as the figures beside it, which is the whole reason a column of
 * money lines up.
 *
 * A VALUE THAT ROUNDS TO ZERO CARRIES NO SIGN. −0.004 formats as `0.00`, and `−$0.00` is a
 * number that does not exist — it reads as a rounding bug on a screen about money.
 */
export const usd = (n: number) => {
  const v = Number(n) || 0
  const digits = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${v < 0 && digits !== "0.00" ? "\u2212" : ""}$${digits}`
}

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
/**
 * THE PLATFORM'S OWN NUMBER FOR AN ORDER — `EGF-000123`.
 *
 * An order id is minted client-side as `FF-<account tag>-<ms base36>-<random>` so two sellers
 * can never collide without asking a server. That is a KEY, and shortOrderRef below says what
 * printing one as a label costs: 24 characters of base36 that match nothing the reader has
 * seen before or will see again.
 *
 * WHY NOT `#seq`, WHICH ALREADY EXISTS. It is minted PER SELLER, so it is not a platform
 * reference: measured on the live database, 1243 orders carry 78 distinct seq values and seq
 * 21 belongs to 7 orders across 2 sellers. "#2" names six different orders on the factory
 * ledger. `ref_no` comes from one Postgres sequence, so it is unique for the life of the
 * platform.
 *
 * WHY NOT `EG-`. That prefix is already the blank SKU's — EG-18009, EG-VC600 — and the two
 * appear inches apart on an order page. `EGF-` follows `MF-<n>`, which the machine-file
 * library already uses.
 *
 * SIX DIGITS, ZERO-PADDED, so a column of them is the same width and lines up under the
 * `tabular-nums` every right-aligned cell already gets. A million orders before it grows.
 *
 * IT DOES NOT REPLACE A MARKETPLACE'S NUMBER. 4170484420 is what the buyer and Etsy both use
 * to find the order; this is what WE call it, and both belong on screen.
 */
export const egfRef = (refNo?: number | string | null) => {
  const n = Number(refNo)
  return Number.isFinite(n) && n > 0 ? `EGF-${String(Math.trunc(n)).padStart(6, "0")}` : ""
}

export const numOf = (o: OrderRow) => {
  /**
   * THE PLATFORM NUMBER FIRST, and this is the bug it fixes rather than a tidy-up.
   *
   * `seq` is minted PER SELLER — max(seq)+1 where seller_id=$1 — so two sellers reach the
   * same number independently. Measured on the live database: seq 125266 belongs to two
   * different orders from two different sellers, 125265 to two more, and one seller's #53
   * sits in the middle of another's 125xxx run. The staff list mixes every seller together,
   * so it printed #125266 · #125265 · #125264 · #53 · #125263 — the same numbers coming round
   * again, which is why a genuinely new order looked like one already seen (owner: "why there
   * seems to be no new order?").
   *
   * `ref_no` comes from one sequence for the whole platform, so it can never do that. `seq`
   * stays as the fallback for anything read before the column was backfilled.
   */
  const ref = egfRef(o.ref_no)
  if (ref) return ref
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

/**
 * THE SELLER LINE, INCLUDING WHEN THE ACCOUNT BEHIND IT NO LONGER WORKS.
 *
 * Both staff surfaces did `(o.seller_name || "").trim()` and rendered the ` · name` suffix
 * only when that came back non-empty — so a deactivated seller read EXACTLY like a live one,
 * and an order whose account had been deleted read like an order with no seller at all. The
 * board could not answer "why is this shop not replying" from the screen where it is asked,
 * which is the §4 rule about an unreadable thing never looking like an absent one.
 *
 * FOUR STATES, and the two blank-looking ones are the point:
 *   factory_order          "EG" — ours, and the staff account that keyed it in is not news.
 *   no seller_id           the account row is GONE. Only possible for an order orphaned
 *                          before users.js started refusing to delete an owner, since that
 *                          delete is now blocked outright — but those rows are still out
 *                          there and must say what they are.
 *   seller_active === false  deactivated: still their order, still their name, annotated.
 *   no seller_name         the READER is a seller, whose own copy has the name stripped by
 *                          stripStaffOnly and who would only be reading themselves back.
 *                          seller_id survives that stripping, which is what separates this
 *                          case from the deleted one above — they are indistinguishable on
 *                          the name alone, and getting that backwards would print
 *                          "(deleted account)" on every order a seller owns.
 *
 * The annotation words are passed IN rather than looked up here: this module is pure and is
 * imported during the prerender, and the two call sites already hold a translator.
 */
export const sellerLabelOf = (
  o: Pick<OrderRow, "factory_order" | "seller_id" | "seller_name" | "seller_active">,
  labels?: { deactivated?: string; deleted?: string },
) => {
  if (o.factory_order) return "EG"
  if (!o.seller_id) return `(${labels?.deleted ?? "deleted account"})`
  const name = (o.seller_name || "").trim()
  if (!name) return ""
  return o.seller_active === false ? `${name} (${labels?.deactivated ?? "deactivated"})` : name
}

/**
 * HOW A LINE'S METHOD READS WHEN IT HAS MORE THAN ONE.
 *
 * `print_type` is the line's own, and on a garment embroidered at the front and printed at
 * the back it is true of one face and wrong about the other. `methods` is what is actually
 * on the garment — the resolved set, a face that says nothing having already inherited the
 * line. The line's own value LEADS when it is among them, which is both stable and the
 * least surprising: the word that was there before is still the first word.
 *
 * Not "dearest first", which is what the billing rule uses. That would be the better lead
 * and this cannot know it — the rate comes from the fee table and a product's own overrides,
 * neither of which a list row carries. Sorting by a guess at cost would be a second pricing
 * opinion on a label, which is exactly the drift §4 keeps warning about.
 *
 * CAPPED AT TWO, and then a count. Three spelled-out methods wrap the chip row on the order
 * list, and a row that reflows is worse than one that summarises. Two is also the realistic
 * ceiling: a garment with three techniques on it is rare enough that "+2 more" costs nobody
 * anything.
 *
 * A SINGLE-METHOD LINE IS UNTOUCHED, which is every line in the database today: one distinct
 * value renders exactly the string `print_type` rendered. That is the same non-regression
 * property the pricing rule has, and it is deliberate — this is a label, and a label that
 * changes on orders nobody edited is a bug report waiting to be filed.
 */
export const methodsLabelOf = (it: OrderItem): string => {
  const all = (Array.isArray(it.methods) ? it.methods : [])
    .map((m) => String(m ?? "").trim()).filter(Boolean)
  const seen = new Set<string>()
  const uniq = all.filter((m) => { const k = m.toLowerCase(); return seen.has(k) ? false : (seen.add(k), true) })
  if (uniq.length < 2) return String(it.print_type ?? "").trim() || uniq[0] || ""
  const own = String(it.print_type ?? "").trim().toLowerCase()
  const led = own ? [...uniq].sort((a, b) => Number(b.toLowerCase() === own) - Number(a.toLowerCase() === own)) : uniq
  return led.length === 2 ? led.join(" + ") : `${led[0]} + ${led.length - 1} more`
}
export const variantOf = (it: OrderItem) => [it.color, it.size, methodsLabelOf(it)].filter(Boolean).join(" · ")

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
  [it.blank, it.color, methodsLabelOf(it), it.size].filter(Boolean).join(" · ")
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

/**
 * "MMM d" for a date column.
 *
 * The locale is a PARAMETER, not a constant, because this is the app's most-used date and it
 * was rendering "Aug 25" on a page with no other English on it. It is not a hook — this
 * module is imported by non-React code too — so React callers go through useOrderDate() in
 * lib/i18n, which supplies the tag. The default keeps every non-React caller as it was.
 */
export const fmtDate = (s?: string | null, tag: string = "en-US", opts?: Intl.DateTimeFormatOptions) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(tag, opts ?? { month: "short", day: "numeric" })
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
/* `Check` and a SECOND `orderReadiness` lived here and were imported by nothing: both real
   callers (readiness-dots, order-filter) read the one in lib/order-readiness.ts, which has a
   different vocabulary — label/scan/design rather than address/artwork/label/printed/scanned.
   Two exported functions sharing a name, one of them dead, is exactly how a private copy
   gets picked up by mistake, so the dead one is gone rather than left as a trap. */

/**
 * THE PER-FACE RATES FOR ONE LINE of a quote.
 *
 * The designer's face rail prints "+$4.00" on a tile before anyone commits to printing
 * there, and it is opened from THREE places — the order page, the staff hub and the seller
 * list. Only the first was passing rates, so the same window quoted prices on one route and
 * nothing on the other two.
 *
 * Matched by `line_id`, which is line identity: two lines of one order can be two different
 * blanks with two different rates, and `sku` is null on a manual line and shared by
 * identical-SKU siblings (CLAUDE.md §5). sku stays as the fallback for rows written before
 * line_id existed.
 *
 * The rates themselves are resolved server-side by the same function that computes the
 * charge (sideRates in server/src/pricing.js), so the tile cannot quote a price the invoice
 * will not use.
 */
/**
 * WHAT EACH FACE OF ONE LINE ACTUALLY COSTS — the placement it carries plus the design work
 * on it, per face.
 *
 * THE RAIL WAS QUOTING A FEE THAT NO LONGER EXISTS (owner, today: "it is showing $3 while
 * charging $2"). `sideRatesFor` below is the PLACEMENT rate table, and it was the right
 * answer under the 2026-09-18 rule that every face is charged. ba6dbe91 reversed that — one
 * placement per LINE, every face after it paying only its own design fee — and the rate
 * table never learned. So a beanie with artwork front and back showed "+$3.00" on Back while
 * the summary beside it said `Back · Embroidery $0.00` and the ledger charged $2.00 of design
 * work. Three surfaces, three numbers, one face.
 *
 * Read from the quote, never recomputed: `sideParts.parts` is the placement the charge
 * actually used, and `perSide` is the server's own split of a design fee across the faces it
 * covers. Deriving either on the client is how a breakdown and a charge come to disagree
 * about one line (§5).
 *
 * A fee still under review has `amount: null` — it contributes nothing rather than a guess,
 * and the caller can tell a face with no fee from one whose fee is not yet known.
 */
export function faceChargesFor(
  quote: {
    lines?: { line_id?: string | null; sku?: string | null
              sideParts?: { parts?: { side?: string | null; amount?: number | null }[] } | null }[]
    designFees?: { items?: { line_id?: string | null; sku?: string | null
                             amount?: number | null; sides?: string[] | null
                             perSide?: Record<string, number> | null }[] } | null
  } | null | undefined,
  item: { line_id?: string | null; sku?: string | null },
): Record<string, number> {
  const mine = (l: { line_id?: string | null; sku?: string | null }) =>
    (l.line_id && l.line_id === (item.line_id ?? null))
    || (!l.line_id && !!l.sku && l.sku === item.sku)
  const out: Record<string, number> = {}
  const add = (side: string | null | undefined, amount: number | null | undefined) => {
    const k = String(side ?? "").trim().toLowerCase()
    if (!k || amount == null || !isFinite(Number(amount))) return
    out[k] = Math.round(((out[k] ?? 0) + Number(amount)) * 100) / 100
  }
  const line = (quote?.lines ?? []).find(mine)
  for (const p of line?.sideParts?.parts ?? []) add(p.side, p.amount)
  for (const f of (quote?.designFees?.items ?? []).filter(mine)) {
    const sides = f.sides ?? []
    if (!sides.length || f.amount == null) continue
    for (const sd of sides) {
      const own = f.perSide ? f.perSide[sd] : null
      /* EVEN SHARES WITH THE LAST FACE ABSORBING THE ROUNDING — the server's own rule, and
         the one the summary already falls back to when a quote predates `perSide`. */
      if (own != null && isFinite(Number(own))) { add(sd, Number(own)); continue }
      const each = Math.round((f.amount / sides.length) * 100) / 100
      add(sd, sides.indexOf(sd) === sides.length - 1
        ? Math.round((f.amount - each * (sides.length - 1)) * 100) / 100
        : each)
    }
  }
  return out
}

export function sideRatesFor(
  quote: { lines?: { line_id?: string | null; sku?: string | null; sideRates?: Record<string, number> }[] } | null | undefined,
  item: { line_id?: string | null; sku?: string | null },
): Record<string, number> {
  const hit = (quote?.lines ?? []).find((l) =>
    (l.line_id && l.line_id === (item.line_id ?? null))
    || (!l.line_id && !!l.sku && l.sku === item.sku))
  return hit?.sideRates ?? {}
}
