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
export type CsvColumn = { header: string; key: string; required: boolean; oneOf?: string; assigned?: boolean; help: string }

// ORDER IS THE CONTRACT. Columns are listed required → fill-one-of → optional, and the
// template, the .xlsx, the Google Sheet and the dialog's chip guide all render in this
// order. That is the whole point: a filler works left to right and can stop at the first
// grey column, instead of hunting a legend to find which of 21 scattered columns matter.
// Moving a column between groups here moves it everywhere, in step.
export const CSV_COLUMNS: CsvColumn[] = [
  // ── FILL, OR WE ASSIGN ONE ────────────────────────────────────────────────
  { header: "Order Number", key: "order_number", required: false, assigned: true, help: "The BUYER's order number. Leave it blank and the order still imports under the platform number we mint for it (FF-…) — but it is also what GROUPS rows, so a multi-line order MUST carry one. Without it, each line becomes its own separate order." },
  // ── REQUIRED ──────────────────────────────────────────────────────────────
  { header: "Ship Name", key: "ship_name", required: true, help: "Recipient's full name." },
  { header: "Ship Address 1", key: "ship_address_1", required: true, help: "Street address." },
  { header: "Ship City", key: "ship_city", required: true, help: "Destination city." },
  { header: "Ship State", key: "ship_state", required: true, help: "State / province. Two-letter code for US destinations." },
  { header: "Ship Zip", key: "ship_zip", required: true, help: "Postal code." },
  // The line's NAME, and the only product field a marketplace export always carries. It is
  // what the boards read, so a row without one arrives as the literal word "Item".
  { header: "Product Title", key: "item_name", required: true, help: "What the line is called on the board — the listing's title. Everything else about the product (blank, colour, size, method) can be filled in afterwards." },
  // ── OPTIONAL ──────────────────────────────────────────────────────────────
  { header: "Ship Address 2", key: "ship_address_2", required: false, help: "Apt / suite / unit." },
  { header: "Ship Email", key: "ship_email", required: false, help: "Buyer email, kept for your records." },
  { header: "Store Name", key: "store_name", required: false, help: "Which shop the order came from." },
  // TWO different SKUs, and confusing them is the whole reason they are named this way.
  // "Listing SKU" belongs to the SELLER's marketplace listing; "Blank SKU" is OUR catalog
  // product, and it is the one production and pricing key on. They were "Item SKU" and
  // "Blank", which read as the same thing said twice.
  { header: "Listing SKU", key: "item_sku", required: false, help: "The SELLER's own SKU on their marketplace listing. Records only — it does not decide what we make. Safe to leave blank." },
  { header: "Blank SKU", key: "blank", required: false, help: "OUR catalog product — the garment we print on. Needed to cost & barcode the line; without it the line reads “not set up for production” until someone sets it. Can be filled in after import." },
  { header: "Template ID", key: "template_id", required: false, help: "A saved design template to apply (fills blank + artwork + placement + method)." },
  { header: "Item Quantity", key: "item_quantity", required: false, help: "Defaults to 1 if blank." },
  { header: "Print Type", key: "print_type", required: false, help: "DTG / DTF / EMB / … Defaults to DTG if blank." },
  { header: "Item Color", key: "item_color", required: false, help: "Garment colour." },
  { header: "Item Size", key: "item_size", required: false, help: "Garment size." },
  { header: "Item Price", key: "item_price", required: false, help: "What the BUYER paid per unit (your sale price). Records only — it does NOT set the fulfilment charge, which comes from the blank's pricing at submit." },
  { header: "Image Link/ID", key: "hero_image", required: false, help: "URL of the listing photo shown on the card." },
  { header: "Shipping Service", key: "shipping_service", required: false, help: "Requested method (e.g. Standard). Saved with the order." },
  { header: "Internal Notes", key: "internal_notes", required: false, help: "Private note for your team. Saved with the order." },
]

// Which band a column sits in. Derived rather than stored so `required`/`oneOf` stay the
// single fact and a column can never claim one band while validating as another.
export type CsvGroup = "assigned" | "required" | "oneOf" | "optional"
export const groupOf = (c: CsvColumn): CsvGroup =>
  c.required ? "required" : c.assigned ? "assigned" : c.oneOf ? "oneOf" : "optional"

export const GROUP_LABEL: Record<CsvGroup, string> = {
  assigned: "FILL, OR WE ASSIGN ONE",
  required: "REQUIRED — every row",
  oneOf: "FILL ONE OF THESE",
  optional: "OPTIONAL",
}

/**
 * The contiguous run of columns per band, in CSV_COLUMNS order — what the sheet's top
 * banner row merges across and what the chip guide groups by.
 *
 * Computed by walking the list rather than by filtering per band, so it describes the
 * columns as they ACTUALLY sit. A filter would happily report one tidy block per band even
 * if the array had a required column stranded among the optional ones, and the banner would
 * then span cells whose contents contradict it.
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
export const SHIPPING_SERVICES = [
  "USPS Ground Advantage", "USPS Priority Mail", "USPS Priority Mail Express",
  "UPS Ground", "UPS 2nd Day Air", "FedEx Ground", "FedEx 2Day",
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
