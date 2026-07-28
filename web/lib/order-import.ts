// Order CSV / Sheets import — ported from the canonical logic in orders.html
// (_parseCSVText, COL_ALIASES, parseImportRows, doImportOrders). Kept as pure
// functions so the React import dialog reuses the exact parsing/validation/grouping
// the old front-end shipped: robust quoted-CSV, header aliasing (Shopify/Etsy
// exports work unrenamed), required-field validation, template-sample skipping,
// and grouping multiple line rows into one order by Order Number.

// ── Canonical template headers (the downloadable .csv) ──────────────────────
export const CSV_HEADERS = [
  "Order Number", "Ship Name", "Ship Email",
  "Ship Address 1", "Ship Address 2", "Ship City", "Ship State", "Ship Zip",
  "Store Name",
  "Product Title", "Image Link/ID", "Item SKU", "Blank", "Template ID",
  "Item Quantity", "Print Type",
  "Item Color", "Item Size", "Item Price",
  "Shipping Service", "Internal Notes",
]

// Headers only (no throwaway sample row) — the Columns legend in the dialog is the guide now.
// Still used by "Make a copy in Google Sheets" to shape a fresh sheet with the right columns.
export const CSV_TEMPLATE = CSV_HEADERS.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")

// Required columns — a row missing any of these is flagged invalid.
export const REQUIRED_COLS = ["ship_name", "ship_address_1", "ship_city", "ship_state", "ship_zip"] as const

// Per-column reference for the import dialog: which headers are required vs optional, and what
// each does. Drives the legend so a filler knows exactly what they can skip. `key` is the
// canonical field (see COL_ALIASES); headers in the template are these in order.
export type CsvColumn = { header: string; key: string; required: boolean; help: string }
export const CSV_COLUMNS: CsvColumn[] = [
  { header: "Order Number", key: "order_number", required: false, help: "Groups multiple item rows into one order. Auto-generated if left blank." },
  { header: "Ship Name", key: "ship_name", required: true, help: "Recipient's full name." },
  { header: "Ship Email", key: "ship_email", required: false, help: "Buyer email, kept for your records." },
  { header: "Ship Address 1", key: "ship_address_1", required: true, help: "Street address." },
  { header: "Ship Address 2", key: "ship_address_2", required: false, help: "Apt / suite / unit." },
  { header: "Ship City", key: "ship_city", required: true, help: "Destination city." },
  { header: "Ship State", key: "ship_state", required: true, help: "State / province." },
  { header: "Ship Zip", key: "ship_zip", required: true, help: "Postal code." },
  { header: "Store Name", key: "store_name", required: false, help: "Which shop the order came from." },
  { header: "Product Title", key: "item_name", required: false, help: "Item name on the board. Either this or Item SKU is required." },
  { header: "Image Link/ID", key: "hero_image", required: false, help: "URL of the listing photo shown on the card." },
  { header: "Item SKU", key: "item_sku", required: false, help: "Your listing SKU. Either this or Product Title is required." },
  { header: "Blank", key: "blank", required: false, help: "The catalog blank you produce on — needed to cost & barcode the line; without it it reads “not set up for production”." },
  { header: "Template ID", key: "template_id", required: false, help: "A saved design template to apply (fills blank + artwork + placement + method)." },
  { header: "Item Quantity", key: "item_quantity", required: false, help: "Defaults to 1 if blank." },
  { header: "Print Type", key: "print_type", required: false, help: "DTG / DTF / EMB / … Defaults to DTG if blank." },
  { header: "Item Color", key: "item_color", required: false, help: "Garment colour." },
  { header: "Item Size", key: "item_size", required: false, help: "Garment size." },
  { header: "Item Price", key: "item_price", required: false, help: "What the BUYER paid per unit (your sale price). Records only — it does NOT set the fulfilment charge, which comes from the blank's pricing at submit." },
  { header: "Shipping Service", key: "shipping_service", required: false, help: "Requested method (e.g. Standard). Saved with the order." },
  { header: "Internal Notes", key: "internal_notes", required: false, help: "Private note for your team. Saved with the order." },
]

// Header aliases → canonical key. Lets a generic marketplace export import as-is.
const COL_ALIASES: Record<string, string[]> = {
  order_number: ["order", "order_id", "order_no", "order_number", "order_num"],
  ship_name: ["ship_name", "name", "customer", "customer_name", "recipient", "recipient_name", "ship_to", "shipping_name", "deliver_to", "buyer", "buyer_name", "full_name"],
  ship_email: ["ship_email", "email", "customer_email", "buyer_email"],
  ship_address_1: ["ship_address_1", "address", "address1", "address_1", "street", "street_address", "shipping_address", "shipping_address_1", "ship_address", "address_line_1"],
  ship_address_2: ["ship_address_2", "address2", "address_2", "apt", "suite", "unit", "address_line_2"],
  ship_city: ["ship_city", "city", "town", "shipping_city"],
  ship_state: ["ship_state", "state", "province", "region", "state_province", "shipping_state"],
  ship_zip: ["ship_zip", "zip", "zipcode", "zip_code", "postal", "postal_code", "postcode", "shipping_zip"],
  store_name: ["store_name", "store", "shop", "shop_name"],
  item_sku: ["item_sku", "sku", "lineitem_sku", "line_item_sku", "product_sku", "variant_sku"],
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
  const norm = String(h).toLowerCase().trim().replace(/#/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
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
}
// Read a data field as a plain string (index values are a union incl. the meta fields).
const S = (v: string | number | boolean | undefined): string => (v == null ? "" : String(v))

// Canonicalize headers, apply sensible defaults, validate, and drop the sample row.
export function rowsToRecords(rows: string[][]): { records: ImportRecord[]; error?: string } {
  if (!rows || rows.length < 2) return { records: [], error: "File must have a header row and at least one data row." }
  const headers = rows[0].map(canonHeader)
  const records = rows.slice(1).map((row, i) => {
    const rec: ImportRecord = { _rowNum: i + 2, _valid: false, _errors: "" }
    headers.forEach((h, j) => { if (h && rec[h] === undefined) rec[h] = row[j] != null ? String(row[j]).trim() : "" })
    if (!rec.item_quantity) rec.item_quantity = "1"
    if (!rec.print_type) rec.print_type = "DTG"
    if (!rec.item_sku && rec.item_name) rec.item_sku = S(rec.item_name).replace(/\s+/g, "-").toUpperCase().slice(0, 40)
    const missing = REQUIRED_COLS.filter((c) => !rec[c])
    const noItem = !rec.item_sku && !rec.item_name
    const errs: string[] = []
    if (missing.length) errs.push("Missing: " + missing.map((m) => m.replace(/_/g, " ")).join(", "))
    if (noItem) errs.push("No item (SKU or name)")
    rec._valid = !errs.length
    rec._errors = errs.join("; ")
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

// Group valid rows by Order Number into orders with aggregated line items.
export function groupToOrders(records: ImportRecord[]): ImportOrder[] {
  const valid = records.filter((r) => r._valid)
  const groups: Record<string, ImportRecord[]> = {}
  const order: string[] = []
  valid.forEach((r, i) => {
    const key = S(r.order_number) || `AUTO-${i}`
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
      orderNumber: String(key).replace(/^#/, ""),
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
