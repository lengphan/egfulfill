// Order CSV / Sheets import — ported from the canonical logic in orders.html
// (_parseCSVText, COL_ALIASES, parseImportRows, doImportOrders). Kept as pure
// functions so the React import dialog reuses the exact parsing/validation/grouping
// the old front-end shipped: robust quoted-CSV, header aliasing (Shopify/Etsy
// exports work unrenamed), required-field validation, template-sample skipping,
// and grouping multiple line rows into one order by Order Number.

import { PRODUCT_METHODS } from "@/lib/print-method"

// Required columns — a row missing any of these is flagged invalid.
//
// `order_number` is deliberately NOT here. It is what groups lines into one order, so a
// blank one splits a 3-line order into 3 — but rejecting the row over it is too blunt: a
// single-line order genuinely doesn't need one, and a marketplace export that never had
// the column would fail wholesale. The rule instead is FILL IT OR WE ASSIGN ONE — the row
// imports, the order takes its platform-assigned FF- number, and rowsToRecords raises a
// WARNING so the split is stated up front rather than discovered afterwards.
export const REQUIRED_COLS = ["item_name", "ship_name", "ship_address_1", "ship_city", "ship_state", "ship_zip"] as const

// Per-column reference for the import dialog: which headers are required vs optional, and what
// each does. Drives the legend so a filler knows exactly what they can skip. `key` is the
// canonical field (see COL_ALIASES); headers in the template are these in order.
// `oneOf` marks a column that is required only as part of a set: leave EVERY member blank and
// the row is rejected, fill any one and it passes. Item SKU / Product Title are the case that
// exists today. Without this the two of them render as plain "optional", which is a promise the
// validator then breaks — the chip says safe to skip, the row comes back "No item (SKU or name)".
// `assigned` = fill it, or we mint one for you. Distinct from both required (blocks the
// row) and optional (nothing happens if you skip it): skipping this one is allowed but has
// a consequence worth stating, so it gets its own band rather than a footnote on another.
export type CsvColumn = { header: string; key: string; required: boolean; oneOf?: string; assigned?: boolean; section: CsvSection; help: string }

/** What the column is ABOUT. Bands group by this, not by obligation — see CSV_COLUMNS. */
export type CsvSection = "order" | "shipTo" | "product" | "extras"

// GROUPED BY SUBJECT, NOT BY OBLIGATION.
//
// This list was once sorted required-first, optional-last. That reads well in a legend and
// badly in a spreadsheet: Ship Address 2 is optional while City/State/Zip are required, so
// sorting by obligation pushed the apartment line FOUR columns past the street it belongs
// to, with the city, state, postcode and a product column in between. Nobody writes an
// address that way, and no marketplace template asks them to.
//
// So the bands are subjects — ORDER, SHIP TO, PRODUCT, EXTRAS — and each column carries its
// own obligation, marked per column (a * and a tinted header) rather than by where it sits.
// Within SHIP TO the order is the order you'd write an envelope in.
//
// The order here is still the contract: the .xlsx, the Google Sheet and the dialog's chip
// guide all render from it, so moving a column moves it everywhere, in step.
export const CSV_COLUMNS: CsvColumn[] = [
  // ── ORDER ─────────────────────────────────────────────────────────────────
  { header: "Order Number", key: "order_number", required: false, assigned: true, section: "order", help: "The BUYER's order number. Leave it blank and the order still imports under the platform number we mint for it (FF-…) — but it is also what GROUPS rows, so a multi-line order MUST carry one. Without it, each line becomes its own separate order." },
  // ── SHIP TO — envelope order: name, street, unit, city, state, postcode ────
  { header: "Ship Name", key: "ship_name", required: true, section: "shipTo", help: "Recipient's full name." },
  { header: "Ship Address 1", key: "ship_address_1", required: true, section: "shipTo", help: "Street address." },
  { header: "Ship Address 2", key: "ship_address_2", required: false, section: "shipTo", help: "Apt / suite / unit. Sits directly after the street because that is where it belongs on an envelope — it is optional, not unrelated." },
  { header: "Ship City", key: "ship_city", required: true, section: "shipTo", help: "Destination city." },
  { header: "Ship State", key: "ship_state", required: true, section: "shipTo", help: "State / province. Two-letter code for US destinations." },
  { header: "Ship Zip", key: "ship_zip", required: true, section: "shipTo", help: "Postal code." },
  { header: "Ship Email", key: "ship_email", required: false, section: "shipTo", help: "Buyer email, kept for your records." },
  // ── PRODUCT ───────────────────────────────────────────────────────────────
  // The line's NAME, and the only product field a marketplace export always carries. It is
  // what the boards read, so a row without one arrives as the literal word "Item".
  { header: "Product Title", key: "item_name", required: true, section: "product", help: "What the line is called on the board — the listing's title. Everything else about the product (blank, colour, size, method) can be filled in afterwards." },
  // TWO different SKUs, and confusing them is the whole reason they are named this way.
  // "Listing SKU" belongs to the SELLER's marketplace listing; "Blank SKU" is OUR catalog
  // product, and it is the one production and pricing key on.
  { header: "Listing SKU", key: "item_sku", required: false, section: "product", help: "The SELLER's own SKU on their marketplace listing. Records only — it does not decide what we make. Safe to leave blank." },
  { header: "Blank SKU", key: "blank", required: false, section: "product", help: "OUR catalog product — the garment we print on. Needed to cost & barcode the line; without it the line reads “not set up for production” until someone sets it. Can be filled in after import." },
  { header: "Template ID", key: "template_id", required: false, section: "product", help: "A saved design template — type the number from its card (TPL-12), or its name if that name is unique. It fills in the blank and the artwork for the line. It does NOT set the print method; nothing in the template editor records one." },
  { header: "Item Quantity", key: "item_quantity", required: false, section: "product", help: "Defaults to 1 if blank." },
  { header: "Print Type", key: "print_type", required: false, section: "product", help: "DTG / DTF / EMB / … Defaults to DTG if blank." },
  { header: "Item Color", key: "item_color", required: false, section: "product", help: "Garment colour." },
  { header: "Item Size", key: "item_size", required: false, section: "product", help: "Garment size." },
  { header: "Item Price", key: "item_price", required: false, section: "product", help: "What the BUYER paid per unit (your sale price). Records only — it does NOT set the fulfilment charge, which comes from the blank's pricing at submit." },
  { header: "Image Link/ID", key: "hero_image", required: false, section: "product", help: "URL of the listing photo shown on the card." },
  // ── EXTRAS ────────────────────────────────────────────────────────────────
  { header: "Store Name", key: "store_name", required: false, section: "extras", help: "Which shop the order came from." },
  { header: "Shipping Service", key: "shipping_service", required: false, section: "extras", help: "Requested method (e.g. Standard). Saved with the order." },
  { header: "Internal Notes", key: "internal_notes", required: false, section: "extras", help: "Private note for your team. Saved with the order." },
]

// Bands group by SUBJECT. Obligation is a property of each column, shown on the column
// itself, because the two do not nest: Ship Address 2 is optional and belongs beside the
// street it continues, and no band that sorts by obligation can express both.
export type CsvGroup = CsvSection
export const groupOf = (c: CsvColumn): CsvGroup => c.section

export const GROUP_LABEL: Record<CsvGroup, string> = {
  order: "ORDER",
  shipTo: "SHIP TO",
  product: "PRODUCT",
  extras: "EXTRAS",
}

/** How a column is obliged, for the per-column marker. Derived, never stored twice. */
export type CsvDuty = "required" | "assigned" | "oneOf" | "optional"
export const dutyOf = (c: CsvColumn): CsvDuty =>
  c.required ? "required" : c.assigned ? "assigned" : c.oneOf ? "oneOf" : "optional"

/** Fills for the .xlsx template, ARGB. The Google Sheet builds its own from float RGB in
 *  sheets.js; these are the same intent in Excel's colour format. Section tints go on the
 *  banner row, duty fills on the header row — the two rows answer different questions. */
export const SECTION_FILL: Record<CsvSection, string> = {
  order: "FFE0F1E7", shipTo: "FFDBE6FF", product: "FFE8DEFF", extras: "FFF0F0F0",
}
export const DUTY_FILL: Record<CsvDuty, string> = {
  required: "FFC7D9FF", assigned: "FFE6EAEF", oneOf: "FFE6EAEF", optional: "FFE6EAEF",
}

/** The marker that rides on the column header: `*` required, `~` we'll assign one. */
// The mark that rides on a header in the sheet. `assigned` carries NOTHING: a tilde beside
// "Order Number" read as part of the column name to everyone who saw it, and the dashed
// outline in the guide already says the same thing without putting a symbol in the header
// a seller then has to wonder about. Required keeps its asterisk — that one is a warning.
export const DUTY_MARK: Record<CsvDuty, string> = {
  required: "*", assigned: "", oneOf: "†", optional: "",
}
export const DUTY_LABEL: Record<CsvDuty, string> = {
  required: "Required on every row",
  assigned: "Fill it, or we assign one",
  oneOf: "Fill at least one of these",
  optional: "Optional",
}

/**
 * The contiguous run of columns per band, in CSV_COLUMNS order — what the sheet's top
 * banner row merges across and what the chip guide groups by.
 *
 * Computed by walking the list rather than by filtering per section, so it describes the
 * columns as they ACTUALLY sit. A filter would happily report one tidy block per section
 * even if the array had a SHIP TO column stranded among the product ones, and the banner
 * would then span cells whose contents contradict it.
 */
export function columnBands(): { group: CsvGroup; start: number; count: number }[] {
  const bands: { group: CsvGroup; start: number; count: number }[] = []
  CSV_COLUMNS.forEach((c, i) => {
    const g = groupOf(c)
    const last = bands[bands.length - 1]
    if (last && last.group === g) last.count++
    else bands.push({ group: g, start: i, count: 1 })
  })
  return bands
}

// Values offered as an in-sheet dropdown. Keyed by canonical column key; a key absent here
// is free text. Print Type comes from PRODUCT_METHODS — the single source the pickers,
// pricing and the detail page already share — so a method added there appears in the import
// template automatically instead of drifting into a private list.
export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
]
export const ITEM_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "One Size"]
/**
 * ONLY WHAT THE LABEL SCREEN CAN ACTUALLY BUY.
 *
 * This listed UPS Ground, UPS 2nd Day Air, FedEx Ground and FedEx 2Day, and none of them
 * could be honoured: the buy screen offers three USPS mail classes and nothing else, so a
 * seller who picked FedEx 2Day in the sheet got USPS Ground Advantage and no notice that
 * their choice had been overruled. A dropdown is a promise about what happens next.
 *
 * Checked against the live Shippo account (2026-08-10): usps and ups are connected,
 * FedEx is not connected at all. UPS is therefore buyable in principle but is not offered
 * by the label picker — add it to MAIL_CLASSES in orders-hub.tsx first, then here.
 *
 * Mirrored by T_OPTS.services in server/src/routes/sheets.js — change both.
 */
export const SHIPPING_SERVICES = [
  "USPS Ground Advantage", "USPS Priority Mail", "USPS Priority Mail Express",
]

export const COLUMN_OPTIONS: Record<string, string[]> = {
  print_type: PRODUCT_METHODS.map((m) => m.key.toUpperCase()),
  ship_state: US_STATES,
  item_size: ITEM_SIZES,
  shipping_service: SHIPPING_SERVICES,
}

// Template header row. Bands are carried by the sheet's banner row and by colour, so the
// header text is now just the column name — no " (optional)" suffix. canonHeader() still
// strips that suffix on the way in, so every template already in a seller's Drive keeps
// importing correctly.
export const TEMPLATE_HEADERS = CSV_COLUMNS.map((c) => c.header)

// The headers as TAB-separated text, which is what a spreadsheet paste actually wants.
// Used by the clipboard fallback when the server can't create a sheet for us.
export const TEMPLATE_TSV = TEMPLATE_HEADERS.join("\t")

// Header aliases → canonical key. Lets a generic marketplace export import as-is.
const COL_ALIASES: Record<string, string[]> = {
  order_number: ["order", "order_id", "order_no", "order_number", "order_num"],
  ship_name: ["ship_name", "name", "customer", "customer_name", "recipient", "recipient_name", "ship_to", "shipping_name", "deliver_to", "buyer", "buyer_name", "full_name"],
  ship_email: ["ship_email", "email", "customer_email", "buyer_email"],
  // "shipping_address1"/"shipping_province" (no separator before the digit, and Shopify's
  // word for state) are the literal headers in a Shopify order export — they were missing,
  // so a raw export dropped its street and state and every row failed validation.
  ship_address_1: ["ship_address_1", "address", "address1", "address_1", "street", "street_address", "shipping_address", "shipping_address_1", "shipping_address1", "ship_address", "address_line_1"],
  ship_address_2: ["ship_address_2", "address2", "address_2", "shipping_address_2", "shipping_address2", "apt", "suite", "unit", "address_line_2"],
  ship_city: ["ship_city", "city", "town", "shipping_city"],
  ship_state: ["ship_state", "state", "province", "region", "state_province", "shipping_state", "shipping_province", "shipping_province_name"],
  ship_zip: ["ship_zip", "zip", "zipcode", "zip_code", "postal", "postal_code", "postcode", "shipping_zip"],
  store_name: ["store_name", "store", "shop", "shop_name"],
  // "listing_sku" is this template's OWN header — without it the file we hand out would not
  // import itself, which is the worst possible bug in a template.
  item_sku: ["item_sku", "listing_sku", "sku", "lineitem_sku", "line_item_sku", "product_sku", "variant_sku"],
  // The BLANK we produce on. Without it an imported line can't be costed (pricing matches
  // on the blank), can't be barcoded (the barcode is the stock code), and lands on the
  // board reading "not set up for production yet".
  blank: ["blank", "blank_sku", "base_product", "base_sku", "catalog_sku", "product_blank"],
  // A saved template carries blank + artwork + placement + method in one reference, so a
  // row that names one needs almost nothing else — the remaining columns become overrides.
  template_id: ["template_id", "template", "tpl", "tpl_id", "design_template"],
  item_name: ["item_name", "item", "product", "product_name", "title", "lineitem_name", "item_title", "product_title", "description"],
  item_quantity: ["item_quantity", "quantity", "qty", "lineitem_quantity", "line_item_quantity", "item_qty"],
  item_price: ["item_price", "price", "unit_price", "lineitem_price", "line_item_price", "product_price"],
  print_type: ["print_type", "print", "method", "technique", "print_method", "decoration"],
  item_color: ["item_color", "color", "colour", "variant_color"],
  item_size: ["item_size", "size", "variant_size"],
  design_file_url: ["design_file_url", "design", "design_url", "artwork", "art_url", "design_file"],
  hero_image: ["hero_image", "image_link_id", "image_link", "image_id", "hero", "hero_img", "hero_url", "product_image", "product_img", "product_photo", "listing_image", "listing_img", "main_image", "image", "image_url", "img_url", "photo"],
  internal_notes: ["internal_notes", "notes", "note", "internal_note", "order_note"],
  shipping_service: ["shipping_service", "service", "ship_method", "shipping_method"],
  sales_channel: ["sales_channel", "channel", "source"],
}
const ALIAS_LOOKUP: Record<string, string> = {}
Object.keys(COL_ALIASES).forEach((canon) => COL_ALIASES[canon].forEach((v) => { ALIAS_LOOKUP[v] = canon }))

// ── Robust CSV parser — handles quoted fields with embedded commas/newlines and
//    "" escapes, plus CRLF. (Naive split(',') breaks on "123 Main St, Apt 4".)
export function parseCSV(text: string): string[][] {
  text = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const rows: string[][] = []
  let row: string[] = [], cur = "", inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else inQ = false }
      else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ",") { row.push(cur); cur = "" }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = "" }
    else cur += ch
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row) }
  return rows.map((r) => r.map((c) => String(c).trim())).filter((r) => r.some((c) => c !== ""))
}

// Pasted spreadsheet cells are usually TAB-separated; a pasted CSV is comma. Pick
// the delimiter by which the header line has more of, then reuse the CSV parser
// for comma or a simple tab split (tabs can't be quoted in a paste).
export function parsePasted(text: string): string[][] {
  const first = String(text || "").split("\n")[0] || ""
  const tabs = (first.match(/\t/g) || []).length
  const commas = (first.match(/,/g) || []).length
  if (tabs >= commas && tabs > 0) {
    return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
      .map((l) => l.split("\t").map((c) => c.trim()))
      .filter((r) => r.some((c) => c !== ""))
  }
  return parseCSV(text)
}

function canonHeader(h: string): string {
  // Drop a trailing "(optional)" marker from our own template headers before matching.
  const cleaned = String(h).replace(/\(\s*optional\s*\)/gi, "").trim()
  const norm = cleaned.toLowerCase().trim().replace(/#/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
  return ALIAS_LOOKUP[norm] || norm
}

// Only the UNTOUCHED template sample is dropped — key off the throwaway instruction
// text a seller removes the moment they fill the row in (never on the order number).
function isSampleRow(obj: Record<string, string>): boolean {
  const nm = String(obj.ship_name || "").toLowerCase()
  return nm.includes("delete this row") || nm.includes("(example)")
}

export type ImportRecord = {
  [key: string]: string | number | boolean
  _rowNum: number
  _valid: boolean
  _errors: string
  /** Non-blocking: the row imports, but something about it is worth saying first.
   *  Kept separate from _errors so "will import differently than you expect" can never be
   *  mistaken for "will not import". */
  _warnings: string
}
// Read a data field as a plain string (index values are a union incl. the meta fields).
const S = (v: string | number | boolean | undefined): string => (v == null ? "" : String(v))

/**
 * Resolve the one header whose meaning depends on its NEIGHBOURS rather than its own text.
 *
 * A Shopify order export labels the order "Name" (#1002) and the recipient "Shipping Name".
 * Bare `name` is an alias for ship_name, so it was swallowed there and the order number was
 * lost — harmless while the column was optional, fatal now that it's required, and it would
 * have rejected every row of a raw Shopify export with "Missing: order number".
 *
 * Reassigned ONLY when both guards hold: no other column supplies an order number, and some
 * other column already supplies the recipient name. Either one failing means a bare "Name"
 * really is the recipient — which is what it means in most non-Shopify files — so the
 * ordinary case is untouched.
 */
function disambiguateHeaders(raw: string[], mapped: string[]): string[] {
  const out = [...mapped]
  const bare = raw.findIndex((h, i) => /^name$/i.test(String(h ?? "").trim()) && out[i] === "ship_name")
  if (bare < 0) return out
  const hasOrderNum = out.includes("order_number")
  const shipNameElsewhere = out.some((h, i) => h === "ship_name" && i !== bare)
  if (!hasOrderNum && shipNameElsewhere) out[bare] = "order_number"
  return out
}

// How many of a row's cells map to a column we know. The header row is whichever of the
// first few rows scores highest — see findHeaderRow.
function headerScore(row: string[]): number {
  const keys = new Set(CSV_COLUMNS.map((c) => c.key))
  return row.map(canonHeader).filter((h) => keys.has(h)).length
}

/**
 * Index of the real header row.
 *
 * The template now opens with a merged BANNER row ("REQUIRED — every row" / "OPTIONAL"),
 * so row 0 is no longer the headers. Rather than hardcode "skip one row" — which would
 * break every sheet already in a seller's Drive, and every raw Shopify/Etsy export — this
 * scores the first few rows and takes the best match. A banner row scores 0 (its words are
 * not column names); a header row scores near the column count.
 *
 * Capped at the first 5 rows so a large sheet doesn't get scanned end to end, and falls
 * back to row 0 when nothing scores, which keeps the old "unrecognised headers" error
 * message rather than inventing a new failure mode.
 */
function findHeaderRow(rows: string[][]): number {
  let best = 0, bestScore = 0
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const s = headerScore(rows[i])
    if (s > bestScore) { best = i; bestScore = s }
  }
  return bestScore > 0 ? best : 0
}

// Canonicalize headers, apply sensible defaults, validate, and drop the sample row.
export function rowsToRecords(rows: string[][]): { records: ImportRecord[]; error?: string } {
  if (!rows || rows.length < 2) return { records: [], error: "File must have a header row and at least one data row." }
  const hdrIdx = findHeaderRow(rows)
  // Everything above the header row is decoration (the banner) — drop it, then treat the
  // sheet exactly as before so the rest of the pipeline is unchanged.
  if (hdrIdx > 0) rows = rows.slice(hdrIdx)
  if (rows.length < 2) return { records: [], error: "That sheet has a header row but no order rows under it." }
  const headers = disambiguateHeaders(rows[0], rows[0].map(canonHeader))
  const records = rows.slice(1).map((row, i) => {
    // +hdrIdx so a rejected row is reported at its number in the SHEET the seller is looking
    // at, not its offset within the slice — off-by-one here sends them to edit the wrong row.
    const rec: ImportRecord = { _rowNum: i + 2 + hdrIdx, _valid: false, _errors: "", _warnings: "" }
    headers.forEach((h, j) => { if (h && rec[h] === undefined) rec[h] = row[j] != null ? String(row[j]).trim() : "" })
    if (!rec.item_quantity) rec.item_quantity = "1"
    if (!rec.print_type) rec.print_type = "DTG"
    // NO derived SKU. This used to slug the title into item_sku, which manufactured a value
    // that is neither a real listing SKU nor a catalog blank — it matches nothing in the
    // catalog, and it makes a field that was meant to be completed later look already filled.
    // Line addressability does not depend on it: orders.js mints line_id centrally.
    const missing = REQUIRED_COLS.filter((c) => !rec[c])
    const errs: string[] = []
    // item_name reads as "item name" from the key; say the column's own header instead, or the
    // error names a field the seller cannot find in their sheet.
    if (missing.length) errs.push("Missing: " + missing.map((m) => (m === "item_name" ? "product title" : m.replace(/_/g, " "))).join(", "))
    rec._valid = !errs.length
    rec._errors = errs.join("; ")
    // Blank order number imports fine — it just can't be grouped, so it becomes its own
    // order under the platform number. Said here so the preview can state it BEFORE the
    // import, which is the only point at which it is still cheap to fix.
    if (rec._valid && !rec.order_number) rec._warnings = "No Order Number — imports as its own order under a platform number"
    return rec
  }).filter((r) => !isSampleRow(r as unknown as Record<string, string>))
  if (!records.length) return { records: [], error: "No order rows found — only a header (and maybe the sample row)." }
  return { records }
}

export type ImportItem = { name: string; sku: string; img: string; qty: number; unitPrice: number; color: string; size: string; printType: string; designUrl: string; blank: string; templateId: string; notes: string }
export type ImportOrder = {
  orderNumber: string
  customer: { name: string; email: string }
  address: { name: string; street: string; street2: string; city: string; state: string; zip: string }
  store: string
  salesChannel: string
  service: string
  notes: string
  items: ImportItem[]
}

// Prefix for a grouping key we invented because the row had no Order Number. Internal only —
// see the orderNumber field below for why it must never reach the saved order.
const AUTO_KEY = " AUTO-"

// Group valid rows by Order Number into orders with aggregated line items.
//
// The key is what decides how many ORDERS come out of N rows. Rows sharing an Order Number
// become one order with several lines; a row without one can only ever be its own order,
// because there is nothing to group it by. That is why a multi-line order must carry the
// number even though the column is otherwise skippable.
export function groupToOrders(records: ImportRecord[]): ImportOrder[] {
  const valid = records.filter((r) => r._valid)
  const groups: Record<string, ImportRecord[]> = {}
  const order: string[] = []
  valid.forEach((r, i) => {
    const key = S(r.order_number) || `${AUTO_KEY}${i}`
    if (!groups[key]) { groups[key] = []; order.push(key) }
    groups[key].push(r)
  })
  return order.map((key) => {
    const rows = groups[key]
    const head = rows[0]
    const items: ImportItem[] = rows.map((r) => {
      const hero = S(r.hero_image)
      return {
        sku: S(r.item_sku),
        name: S(r.product_title) || S(r.item_name) || S(r.item_sku) || "Item",
        img: /^https?:\/\//i.test(hero) ? hero : "",
        qty: Math.max(1, parseInt(S(r.item_quantity)) || 1),
        unitPrice: Number(S(r.item_price).replace(/[^0-9.]/g, "")) || 0,
        printType: S(r.print_type).toUpperCase(),
        color: S(r.item_color),
        size: S(r.item_size),
        designUrl: S(r.design_file_url),
        // Carried through so the board can resolve production. `blank` is what we make on;
        // `templateId` names a saved design to apply, which fills the rest.
        blank: S(r.blank),
        templateId: S(r.template_id),
        notes: S(r.internal_notes),
      }
    })
    // Parent row shows the first item's hero — borrow a later line's if the first has none.
    if (items.length && !items[0].img) {
      const withHero = items.find((it) => it.img)
      if (withHero) items[0].img = withHero.img
    }
    return {
      // A synthesized key groups the row and then stops. It must NOT survive as the order's
      // number: the dialog persists this to meta.sourceOrderNumber and address.ref, which are
      // "the buyer's own reference" — writing "AUTO-3" there records a placeholder as if it
      // were the customer's real order number. Blank in, blank out.
      orderNumber: key.startsWith(AUTO_KEY) ? "" : String(key).replace(/^#/, ""),
      customer: { name: S(head.ship_name) || "Customer", email: S(head.ship_email) },
      address: {
        name: S(head.ship_name),
        street: S(head.ship_address_1),
        street2: S(head.ship_address_2),
        city: S(head.ship_city),
        state: S(head.ship_state),
        zip: S(head.ship_zip),
      },
      store: S(head.store_name),
      salesChannel: S(head.sales_channel),
      service: S(head.shipping_service),
      notes: S(head.internal_notes),
      items,
    }
  })
}

// ── Template ID ───────────────────────────────────────────────────────────────
//
// The column existed, was parsed, and was then dropped on the floor: `templateId` reached
// ImportItem and nothing ever read it. So the sheet advertised a field that did nothing,
// which is worse than not offering it — the filler believes the blank and the artwork are
// handled and finds out on the board that they aren't.
//
// What a template can actually supply is TWO things: the blank it was drawn on, and the
// composed artwork. It does NOT carry a print method — nothing in the template editor
// records one — so the help text no longer claims it does.

/** The parts of a saved template an import can apply. Deliberately narrow: this module
 *  must not depend on the full ProductTemplate shape from lib/api. */
export type ImportTemplate = {
  id: string
  /** The short readable number on the card — what a person actually types. */
  seq: number | null
  name: string | null
  /** The catalog SKU the template was drawn on, from `data.blankSku`. */
  blankSku: string
  /** The composed preview, used as the line's artwork when the row names none. */
  composite: string
}

/** Lowercase, alphanumerics only — so `TPL-12`, `tpl 12`, `Tpl12` and `12` all meet. */
const tkey = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")

/**
 * Every string that should find this template. The seq is offered both bare and prefixed
 * because the card shows `TPL-12` and people type both halves of that.
 */
export function templateKeys(t: ImportTemplate): string[] {
  const keys = [tkey(t.id)]
  if (t.seq != null) { keys.push(tkey(`TPL-${t.seq}`)); keys.push(tkey(String(t.seq))) }
  if (t.name) keys.push(tkey(t.name))
  return keys.filter(Boolean)
}

/**
 * Resolve what each row typed into a template, and report what didn't match.
 *
 * A NAME THAT IS NOT UNIQUE MATCHES NOTHING. Two templates called "Christmas" cannot be
 * told apart by a person reading the sheet either, so guessing one would silently apply
 * the wrong artwork to a real order — the one outcome worth failing loudly for. Ids and
 * numbers are unique by construction and always win.
 */
export function templateIndex(templates: ImportTemplate[]): Map<string, ImportTemplate | null> {
  const idx = new Map<string, ImportTemplate | null>()
  const ambiguous = new Set<string>()
  for (const t of templates) {
    for (const k of templateKeys(t)) {
      if (idx.has(k) && idx.get(k) !== t) ambiguous.add(k)
      else idx.set(k, t)
    }
  }
  // null, not deleted: a key that is ambiguous must not fall through to "no such template",
  // because the fix is different — pick a different name, rather than fix a typo.
  for (const k of ambiguous) idx.set(k, null)
  return idx
}

/**
 * Fill each line's blank and artwork from its template, and name every id that matched
 * nothing so the dialog can say so BEFORE anything is created.
 *
 * THE ROW ALWAYS WINS. A template is a default for the fields the row left empty; if
 * someone typed a Blank SKU next to a Template ID they meant the one they typed, and
 * quietly overwriting it would make the sheet's most explicit column its least reliable.
 */
export function applyTemplates(
  orders: ImportOrder[],
  templates: ImportTemplate[],
): { orders: ImportOrder[]; unmatched: string[]; ambiguous: string[]; applied: number } {
  const idx = templateIndex(templates)
  const unmatched = new Set<string>()
  const ambiguous = new Set<string>()
  let applied = 0
  const out = orders.map((o) => ({
    ...o,
    items: o.items.map((it) => {
      const typed = String(it.templateId || "").trim()
      if (!typed) return it
      const key = tkey(typed)
      if (!idx.has(key)) { unmatched.add(typed); return it }
      const t = idx.get(key)
      if (!t) { ambiguous.add(typed); return it }
      applied++
      return {
        ...it,
        blank: it.blank || t.blankSku || "",
        designUrl: it.designUrl || t.composite || "",
      }
    }),
  }))
  return { orders: out, unmatched: [...unmatched], ambiguous: [...ambiguous], applied }
}
