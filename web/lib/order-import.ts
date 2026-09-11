// Order CSV / Sheets import — ported from the canonical logic in orders.html
// (_parseCSVText, COL_ALIASES, parseImportRows, doImportOrders). Kept as pure
// functions so the React import dialog reuses the exact parsing/validation/grouping
// the old front-end shipped: robust quoted-CSV, header aliasing (Shopify/Etsy
// exports work unrenamed), required-field validation, template-sample skipping,
// and grouping multiple line rows into one order by Order Number.

import { PRODUCT_METHODS, normalizeMethods } from "@/lib/print-method"
import { ALL_SIDES } from "@/lib/variant-resolve"

// Required columns — a row missing any of these is flagged invalid.
//
// `order_number` is deliberately NOT here. It is what groups lines into one order, so a
// blank one splits a 3-line order into 3 — but rejecting the row over it is too blunt: a
// single-line order genuinely doesn't need one, and a marketplace export that never had
// the column would fail wholesale. The rule instead is FILL IT OR WE ASSIGN ONE — the row
// imports, the order takes its platform-assigned FF- number, and rowsToRecords raises a
// WARNING so the split is stated up front rather than discovered afterwards.
export const REQUIRED_COLS = ["blank", "ship_name", "ship_address_1", "ship_city", "ship_state", "ship_zip"] as const

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
  /**
   * THE TITLE IS NO LONGER THE REQUIRED ONE — THE BLANK IS.
   *
   * A title is what the buyer's listing was called; the blank is what we cut, print and
   * charge for. Requiring the first and not the second let a row through that was perfectly
   * named and impossible to make, and then asked somebody to open every line and pick the
   * garment by hand. Reversed: the row must say WHAT IT IS, and may leave what the seller
   * calls it to us — a line with no title takes the blank's own name (rowsToOrders), which
   * is a truer label for the floor than a marketplace keyword list anyway.
   */
  { header: "Product Title", key: "item_name", required: false, section: "product", help: "What the line is called on the board. Leave it blank and the line is named after the blank product instead." },
  // TWO different SKUs, and confusing them is the whole reason they are named this way.
  // "Listing SKU" belongs to the SELLER's marketplace listing; "Blank SKU" is OUR catalog
  // product, and it is the one production and pricing key on.
  { header: "Listing SKU", key: "item_sku", required: false, section: "product", help: "The SELLER's own SKU on their marketplace listing. Records only — it does not decide what we make. Safe to leave blank." },
  /**
   * THE BLANK, BY NAME — and the three columns after it narrow to what it offers.
   *
   * It was "Blank SKU": our catalog code, typed from memory against a frozen example. Once
   * a product, a colour and a size are on the row the sku is DERIVED (variantSku), so
   * asking a person to hand-type the one field the system can compute only ever produced
   * rows pointing at blanks we don't stock.
   *
   * The KEY is unchanged (`blank`), so every parser, alias and downstream reader keeps
   * working, and COL_ALIASES still accepts a "Blank SKU" header — a sheet downloaded before
   * today imports exactly as it did.
   */
  { header: "Blank Product", key: "blank", required: true, section: "product", help: "OUR catalog product — the garment we print on. Pick it and the Print Type, Colour and Size dropdowns narrow to what that product actually comes in. It is what costs, barcodes and produces the line, so a row without one cannot be made." },
  { header: "Template ID", key: "template_id", required: false, section: "product", help: "A SHORTCUT: a saved template already carries the blank, the placement and the artwork, so a row with one ignores Image ID and the variant columns. Leave it blank and the row is built from the columns instead. Type the number — type the number from its card (TPL-12) or its name if that name is unique. It fills in the blank and the artwork for the line. It does NOT set the print method; nothing in the template editor records one. An image reference (IMG-30) is not applied here yet — it names artwork in your library, which is a different thing from a template." },
  /**
   * THE STITCH FILE, BY REFERENCE — the third way of saying "here is the design", and the
   * only one that is not artwork.
   *
   * Template ID and Image ID both hand us a PICTURE we then cut a machine file from. This
   * hands us the machine file itself, which is what actually arrives: sellers send .EMB.
   * Their only route in was the designer, one line at a time, so forty units of one design
   * meant forty uploads of one file.
   *
   * It does NOT replace the artwork. A line still wants a picture — that is what the mockup
   * shows and what the floor checks the sewing against — so this sits alongside Template ID
   * rather than instead of it. What it replaces is the upload.
   */
  { header: "Machine File ID", key: "machine_file_id", required: false, section: "product", help: "YOUR OWN STITCH FILE, from Design Lab › Machine files. Type the reference off its card (MF-12). It is attached to THIS row’s unit, not to the whole order — so a two-line order can carry two different files. Embroidered lines only: there is no machine to run a stitch file on a DTG line, so a row that names one is rejected rather than charged for a file nothing can use." },
  /**
   * WHICH FACE — the one thing a sheet could never say about a design.
   *
   * A row is one unit, and until now every design a row named arrived on the FRONT: the
   * only placement in the pipeline came from a template, drawn by hand in the maker. So a
   * seller with a logo for the left sleeve and forty orders to raise had no route through
   * the sheet at all.
   *
   * ONE FACE PER ROW, deliberately. A row is one garment and it carries one Artwork ID, so
   * two faces on one unit is two artworks and a template is what holds those. The extra-side
   * charge is counted from order_designs (pricing.js), so a row that names a single face
   * prices exactly as a front-only line does today.
   */
  /**
   * FIVE PLACEMENTS, FIVE ARTWORKS — AND ONE ROW IS ONE GARMENT.
   *
   * This replaced a single Placement + Artwork pair plus a "Line" key column, where two rows
   * sharing a key meant one garment printed twice. That model was correct and nobody could
   * use it: the key had to be INVENTED, it meant nothing on its own, and the rows for one
   * garment sat apart in the sheet. The first real filler typed a template id into it.
   *
   * Pairs instead. A row is a garment; its faces are columns beside it, so "front and back"
   * is two cells on one line instead of two rows and a key you made up. Five because that is
   * more faces than anything we print carries in practice, and the unused pairs simply stay
   * empty — owner's call: "doesn't matter if they don't use all".
   *
   * PAIR 1 KEEPS THE OLD KEYS (`print_side` / `hero_image`) ON PURPOSE. Every sheet written
   * before today has a "Placement" and an "Artwork ID" column, and COL_ALIASES still points
   * both at pair 1 — so an old file imports unchanged and lands its single face exactly
   * where it used to. "Line" stays in the aliases for the same reason; it is gone from the
   * template, not from the parser.
   */
  { header: "1st placement", key: "print_side", required: false, section: "product", help: "WHERE ON THE GARMENT the artwork beside it goes — Front, Back, Left sleeve, Hood … Fill in the Blank Product first and the list narrows to the faces that garment actually has. Leave the whole row of placements blank and a template keeps the placement it was drawn with, and a bare 1st artwork goes on the front." },
  { header: "1st artwork", key: "hero_image", required: false, section: "product", help: "THE DESIGN that goes on the placement beside it — either the reference off your library card (IMG-30) or a URL. It does NOT conflict with a Template ID: a template brings its own artwork and placement, and an artwork typed here overrides both." },
  { header: "2nd placement", key: "print_side_2", required: false, section: "product", help: "WHERE ON THE GARMENT the artwork beside it goes — Front, Back, Left sleeve, Hood … Fill in the Blank Product first and the list narrows to the faces that garment actually has. Only needed when this garment is printed in two or more places — leave it blank otherwise." },
  { header: "2nd artwork", key: "artwork_2", required: false, section: "product", help: "THE DESIGN that goes on the placement beside it — either the reference off your library card (IMG-30) or a URL. Pairs with the placement immediately to its left; a placement with no artwork still books the face, and the picture can arrive later." },
  { header: "3rd placement", key: "print_side_3", required: false, section: "product", help: "WHERE ON THE GARMENT the artwork beside it goes — Front, Back, Left sleeve, Hood … Fill in the Blank Product first and the list narrows to the faces that garment actually has. Only needed when this garment is printed in three or more places — leave it blank otherwise." },
  { header: "3rd artwork", key: "artwork_3", required: false, section: "product", help: "THE DESIGN that goes on the placement beside it — either the reference off your library card (IMG-30) or a URL. Pairs with the placement immediately to its left; a placement with no artwork still books the face, and the picture can arrive later." },
  { header: "4th placement", key: "print_side_4", required: false, section: "product", help: "WHERE ON THE GARMENT the artwork beside it goes — Front, Back, Left sleeve, Hood … Fill in the Blank Product first and the list narrows to the faces that garment actually has. Only needed when this garment is printed in four or more places — leave it blank otherwise." },
  { header: "4th artwork", key: "artwork_4", required: false, section: "product", help: "THE DESIGN that goes on the placement beside it — either the reference off your library card (IMG-30) or a URL. Pairs with the placement immediately to its left; a placement with no artwork still books the face, and the picture can arrive later." },
  { header: "5th placement", key: "print_side_5", required: false, section: "product", help: "WHERE ON THE GARMENT the artwork beside it goes — Front, Back, Left sleeve, Hood … Fill in the Blank Product first and the list narrows to the faces that garment actually has. Only needed when this garment is printed in five or more places — leave it blank otherwise." },
  { header: "5th artwork", key: "artwork_5", required: false, section: "product", help: "THE DESIGN that goes on the placement beside it — either the reference off your library card (IMG-30) or a URL. Pairs with the placement immediately to its left; a placement with no artwork still books the face, and the picture can arrive later." },
  { header: "Quantity", key: "item_quantity", required: false, section: "product", help: "Defaults to 1 if blank." },
  { header: "Print Type", key: "print_type", required: false, section: "product", help: "Embroidery, DTG printing, Appliqué … Defaults to DTG printing if blank." },
  { header: "Color", key: "item_color", required: false, section: "product", help: "Garment colour." },
  { header: "Size", key: "item_size", required: false, section: "product", help: "Garment size." },
  // ── EXTRAS ────────────────────────────────────────────────────────────────
  { header: "Store Name", key: "store_name", required: false, section: "extras", help: "Which shop the order came from." },
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
/**
 * ONE COLOUR PER SECTION, carried by both header rows.
 *
 * The banner used to be tinted by section and the header row beneath it by obligation, so
 * a four-band sheet showed seven fills across two rows and neither reading was clear. The
 * obligation is already on the header itself — `*` means required, nothing means optional —
 * so the second palette was saying in colour what the text says in one character.
 */
export const SECTION_FILL: Record<CsvSection, string> = {
  order: "FFE0F1E7", shipTo: "FFDBE6FF", product: "FFE8DEFF", extras: "FFF0F0F0",
}

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
 * ── WHERE ON THE GARMENT ──────────────────────────────────────────────────────
 *
 * The eight faces a design can be placed on. Mirrors ALL_SIDES in
 * server/src/routes/factory_settings.js, which is the list a product TYPE picks from — so
 * this is the CEILING, not what any one blank offers. The grid narrows it per product with
 * typeSidesOf(); the .xlsx and the Google Sheet cannot (Sheets will not evaluate a
 * dependent list — see the note in sheets.js), so those two offer all eight and the
 * narrowing happens here on the way in.
 */
/* THE SAME EIGHT, not a second list of them. This was written out again here and drifted
   from `ALL_SIDES` by nothing so far — but it is one edit away, and a face the sheet accepts
   that the app has never heard of is a placement nobody can print. */
export const PRINT_SIDES = ALL_SIDES

/**
 * THE WORD IN THE CELL, NOT THE KEY WE STORE.
 *
 * `left` and `right` are what order_designs holds and what the design maker's face tiles
 * say — beside a picture of the garment, which is what makes them readable. A spreadsheet
 * cell has no picture, and "Left" on its own is a question rather than a placement, so the
 * dropdown spells the sleeve out. Sheets data validation has no label-vs-value (the picked
 * text IS the cell), so the spelling offered is the spelling that has to import — which is
 * what normalizeSide is for.
 */
export const SIDE_LABEL: Record<string, string> = {
  front: "Front", back: "Back", left: "Left sleeve", right: "Right sleeve",
  sleeve: "Sleeve", hood: "Hood", inside: "Inside", wrap: "Wrap",
}
export const SIDE_OPTIONS: string[] = PRINT_SIDES.map((s) => SIDE_LABEL[s])

/**
 * Every spelling that should reach a face, EXACT rather than by substring.
 *
 * Substring matching is the trap here: "left chest" is a front placement in every POD
 * vocabulary there is, and it contains "left", so a contains() check would quietly send a
 * chest print to the sleeve. Anything not in this table resolves to "" and the row carries
 * a warning naming what was typed — an unreadable placement must say so, never guess.
 */
const SIDE_ALIASES: Record<string, string> = {
  front: "front", frontside: "front", fullfront: "front", chest: "front",
  /* LEFT CHEST AND RIGHT CHEST ARE FRONT PLACEMENTS, which the note above this table already
     says outright — "left chest is a front placement in every POD" — and which the table then
     did not carry, so the two most common terms on a POD order form warned and fell back
     instead of resolving. They go in as WHOLE keys, not by substring: matching "left chest"
     on a contained "left" is the exact trap that note is warning about, and would print a
     chest logo on the sleeve. */
  leftchest: "front", rightchest: "front",
  back: "back", backside: "back", rear: "back", fullback: "back",
  left: "left", leftsleeve: "left", sleeveleft: "left", leftarm: "left", leftside: "left",
  right: "right", rightsleeve: "right", sleeveright: "right", rightarm: "right", rightside: "right",
  sleeve: "sleeve", sleeves: "sleeve", arm: "sleeve",
  hood: "hood", hoodie: "hood",
  inside: "inside", insidelabel: "inside", innerlabel: "inside", necklabel: "inside", label: "inside", tag: "inside",
  wrap: "wrap", wraparound: "wrap", allover: "wrap",
}

/** A typed or picked placement → the face key order_designs stores. "" when unreadable. */
export function normalizeSide(v: string): string {
  const k = String(v ?? "").toLowerCase().replace(/[^a-z]/g, "")
  return SIDE_ALIASES[k] ?? ""
}
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
/**
 * KEPT THOUGH THE COLUMN IS GONE (2026-08-21). Shipping Service was dropped from the
 * template — the label screen picks the class at buy time against the live Shippo account,
 * so a value typed into a sheet days earlier was never consulted.
 *
 * The KEY, its aliases and the read at rowsToRecords all stay, because every sheet already
 * in a seller's Drive still carries the column: dropping the alias would turn a working
 * file into an unknown-column error at exactly the moment they re-import.
 */
export const SHIPPING_SERVICES = [
  "USPS Ground Advantage", "USPS Priority Mail", "USPS Priority Mail Express",
]

export const COLUMN_OPTIONS: Record<string, string[]> = {
  /**
   * THE WORDS, NOT THE KEYS. This was `m.key.toUpperCase()` — DTG, EMB, APL — which is what
   * the importer normalises against, so it was correct and unreadable: nobody filling in a
   * spreadsheet knows that APL is Appliqué. `label` is the same row of the same table, and
   * methodCode() on the server matches it back by regex, so both spellings import.
   */
  print_type: PRODUCT_METHODS.map((m) => m.label),
  print_side: SIDE_OPTIONS,
  /* The other four placements offer the SAME list — a face is a face whichever slot it
     sits in, and a second opinion about the vocabulary is exactly what §4's faces rule
     forbids. Narrowed per blank by the grid, same as the first. */
  print_side_2: SIDE_OPTIONS,
  print_side_3: SIDE_OPTIONS,
  print_side_4: SIDE_OPTIONS,
  print_side_5: SIDE_OPTIONS,
  ship_state: US_STATES,
  /**
   * HEADER SPELLINGS, not size values — this was `ITEM_SIZES`, so the aliases for the size
   * COLUMN were "XS", "S", "M"… A header reading "Item Size" still worked, but only by
   * falling through to the canonical key when no alias matched; a column headed plainly
   * "Size" matched nothing and was dropped without a word. Found while shortening the
   * headers, which would have made that the normal case.
   */
  item_size: ["item_size", "size", "variant_size", "lineitem_size", "line_item_size", "item_sizes"],
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
  /* NORMALISED forms only — canonHeader has already lowercased, stripped `#` and collapsed
     punctuation to `_` by the time these are consulted, so an alias containing a `#` can
     never match anything. And NOT "item": item_name claims it, and a column read as the
     wrong one is worse than a column not read at all. */
  item_key: ["item_key", "line", "line_no", "line_number", "item_no", "item_group", "line_id"],
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
  // "blank_product" is the header the template ships today; "blank_sku" is what it said
  // before, and every sheet already downloaded still carries it. Both land on `blank`.
  blank: ["blank", "blank_product", "blank_sku", "base_product", "base_sku", "catalog_sku", "product_blank"],
  // A saved template carries blank + artwork + placement + method in one reference, so a
  // row that names one needs almost nothing else — the remaining columns become overrides.
  template_id: ["template_id", "template", "tpl", "tpl_id", "design_template", "template_design_id", "design_template_id"],
  item_name: ["item_name", "item", "product", "product_name", "title", "lineitem_name", "item_title", "product_title", "description"],
  item_quantity: ["item_quantity", "quantity", "qty", "lineitem_quantity", "line_item_quantity", "item_qty"],
  /* NO LONGER A COLUMN IN THE SHEET, still read from an uploaded FILE.
     The grid dropped it because it was the one money column on a screen full of production
     facts, and it was read as ours: it is the BUYER's price, records only, and what we
     charge is quoted from the blank at submit and shown on the order. A Shopify or Etsy
     export carries a price whether we ask for it or not, so parsing it still costs nothing
     and still lands the sale on the order — dropping it from the parser would throw away
     data the file already contains. `shipping_service` and `sales_channel` below have been
     column-less aliases for the same reason for as long as this file has existed. */
  item_price: ["item_price", "price", "unit_price", "lineitem_price", "line_item_price", "product_price"],
  print_type: ["print_type", "print", "method", "technique", "print_method", "decoration"],
  item_color: ["item_color", "color", "colour", "variant_color"],
  item_size: ["item_size", "size", "variant_size"],
  /** The same thing as Artwork ID, under the spellings a seller's own export uses. It has
   *  no column of its own and never has; when both are filled this one wins, because it is
   *  the more explicit of the two. "artwork" moved to `hero_image` — that IS our column. */
  design_file_url: ["design_file_url", "design", "design_url", "art_url", "design_file"],
  // Every spelling somebody might already have in a sheet. "emb"/"emb_file" are here
  // because .EMB is what actually arrives and it is what people call the column.
  machine_file_id: ["machine_file_id", "machine_file", "machine", "mf", "mf_id", "stitch_file",
    "stitch_file_id", "emb", "emb_file", "emb_id", "dst", "pes", "machine_file_ref"],
  /**
   * THE DESIGN — and the photo-ish spellings are NOT here any more.
   *
   * This key used to swallow "image", "photo", "product_image", "listing_image" and
   * "main_image" as well, which was harmless while the column only ever set a picture. It
   * stops being harmless now the column PRINTS: a raw marketplace export whose "Image"
   * column holds the listing photo would have arrived as forty units with a product
   * photograph filed as their artwork, and the shape of that mistake is a box of shirts.
   *
   * So the spellings that mean "a picture of the thing" moved to `listing_image` below,
   * which still only ever sets the line's picture. What is left here is our own column and
   * the spellings that can only mean the design.
   */
  /* "1st artwork" normalises to "1st_artwork"; the bare spellings stay so every sheet
     written before the five pairs still lands its design on pair 1. */
  hero_image: ["hero_image", "artwork_id", "artwork", "art", "image_link_id", "image_link", "image_id", "hero", "hero_img", "hero_url", "1st_artwork", "artwork_1", "first_artwork"],
  artwork_2: ["artwork_2", "2nd_artwork", "artwork2", "design_2"],
  artwork_3: ["artwork_3", "3rd_artwork", "artwork3", "design_3"],
  artwork_4: ["artwork_4", "4th_artwork", "artwork4", "design_4"],
  artwork_5: ["artwork_5", "5th_artwork", "artwork5", "design_5"],
  /** A PICTURE OF THE LINE, never printed — the spellings a marketplace export uses. */
  listing_image: ["listing_image", "listing_img", "product_image", "product_img", "product_photo", "main_image", "image", "image_url", "image_src", "img_url", "photo"],
  /** WHICH FACE the row's design lands on. Free text in, a face key out — normalizeSide. */
  print_side: ["print_side", "placement", "side", "surface", "print_location", "print_placement", "design_side", "design_placement", "print_area", "1st_placement", "placement_1", "first_placement"],
  print_side_2: ["print_side_2", "2nd_placement", "placement_2", "side_2"],
  print_side_3: ["print_side_3", "3rd_placement", "placement_3", "side_3"],
  print_side_4: ["print_side_4", "4th_placement", "placement_4", "side_4"],
  print_side_5: ["print_side_5", "5th_placement", "placement_5", "side_5"],
  internal_notes: ["internal_notes", "notes", "note", "internal_note", "order_note"],
  shipping_service: ["shipping_service", "service", "ship_method", "shipping_method"],
  sales_channel: ["sales_channel", "channel", "source"],
  // "Template ID" is headed "Template/Design ID" now. BOTH SPELLINGS RESOLVE — a header is
  // normalised to a key, so renaming the column without aliasing the new spelling would
  // quietly stop it resolving on every sheet already downloaded, and the next import would
  // arrive with no artwork and no explanation. Old sheets keep working; that is the deal
  // with anything people hold a copy of.
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
/**
 * `IMG-30` IS AN ARTWORK REFERENCE, and until now the sheet dropped it on the floor.
 *
 * Artwork ID was the odd one out of the three ID columns: Template ID takes `TPL-12` and
 * Machine File ID takes `MF-12`, but this wanted a raw URL — so the reference a seller reads
 * off their own library card, the thing the column is NAMED after, was silently discarded
 * for not looking like an address. Two of the three columns spoke references and the third
 * quietly did not, which is a difference nobody can see until an order arrives blank.
 *
 * A URL still works and always will: an artwork that lives somewhere else has no reference.
 */
const ARTWORK_REF = /^IMG-([A-Za-z0-9_-]+)$/i

/** Maps `IMG-30` to the image's address. Supplied by whoever holds the seller's library. */
export type ArtworkResolver = (ref: string) => string

/** The row's artwork as an ADDRESS: a URL as-is, a reference through the resolver, else "". */
/** An address the browser can load: an absolute http(s) one, or one of OUR routes.
 *
 *  The root-relative form is what a resolved library reference now answers with
 *  (`/api/design_library/art/<hash>`), and it is deliberately narrow — `/api/` only, so a
 *  stray cell containing "/etc/passwd" or a bare word is still nothing. A `data:` URL is
 *  NOT addressable by this definition even though a browser would render it: it would ride
 *  on `order_items.img` into every /api/orders response, which is the bloat this route
 *  exists to avoid. */
const ADDRESSABLE = /^(https?:\/\/|\/api\/)/i

export function artworkUrl(v: string, resolve?: ArtworkResolver): string {
  const s = String(v ?? "").trim()
  if (!s) return ""
  if (ADDRESSABLE.test(s)) return s
  const m = s.match(ARTWORK_REF)
  if (m && resolve) {
    const hit = resolve(s)
    return ADDRESSABLE.test(hit) ? hit : ""
  }
  return ""
}

/** Is this at least SHAPED like something that could name a design? Used by validation,
 *  which runs without a library and must not warn "no design" at a well-formed reference. */
export const looksLikeArtwork = (v: string): boolean => {
  const s = String(v ?? "").trim()
  return /^https?:\/\//i.test(s) || ARTWORK_REF.test(s)
}

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
    // Say the column's own HEADER. `blank` and `item_name` both read as something the seller
    // cannot find in their sheet — one is a word for "empty", the other is our field name.
    const HEADER_OF: Record<string, string> = { blank: "Blank Product", item_name: "Product Title" }
    if (missing.length) errs.push("Missing: " + missing.map((m) => HEADER_OF[m] || m.replace(/_/g, " ")).join(", "))
    rec._valid = !errs.length
    rec._errors = errs.join("; ")
    // Blank order number imports fine — it just can't be grouped, so it becomes its own
    // order under the platform number. Said here so the preview can state it BEFORE the
    // import, which is the only point at which it is still cheap to fix.
    const warn: string[] = []
    if (rec._valid && !rec.order_number) warn.push("No Order Number — imports as its own order under a platform number")
    /**
     * A PLACEMENT THAT DOES NOTHING, SAID OUT LOUD.
     *
     * Both halves of this are warnings rather than errors, because both rows still make a
     * garment and refusing them would be the harsher mistake. But both are silent failures
     * otherwise: a misspelt face falls back to the front, and a face named on a row that
     * carries no design has nothing to place — and in each case the seller finds out from
     * a finished shirt rather than from this screen.
     */
    /* ALL FIVE PAIRS, AND THE WARNING NAMES WHICH ONE. Checking only the first would have
       been the quiet half of this feature: four more columns a seller can misspell, each
       falling back to the front without a word. The ordinal is in the message because "a
       placement isn't a face we print" is useless on a row with five of them. */
    const PAIRS = [
      { label: "1st", side: S(rec.print_side), art: S(rec.design_file_url) || S(rec.hero_image) },
      { label: "2nd", side: S(rec.print_side_2), art: S(rec.artwork_2) },
      { label: "3rd", side: S(rec.print_side_3), art: S(rec.artwork_3) },
      { label: "4th", side: S(rec.print_side_4), art: S(rec.artwork_4) },
      { label: "5th", side: S(rec.print_side_5), art: S(rec.artwork_5) },
    ]
    if (rec._valid) {
      const faces: string[] = []
      for (const pr of PAIRS) {
        if (!pr.side) {
          // An artwork with no placement beside it is not an error — it lands on the front,
          // which is what a bare design has always done. Worth saying once, not five times.
          if (pr.label !== "1st" && looksLikeArtwork(pr.art)) {
            warn.push(`${pr.label} artwork has no placement beside it — it goes on the front`)
          }
          continue
        }
        const face = normalizeSide(pr.side)
        if (!face) { warn.push(`${pr.label} placement “${pr.side}” isn’t a face we print — the design goes on the front`); continue }
        // TWO SLOTS NAMING ONE FACE is a sheet mistake that silently loses a design: the
        // grouping keeps the first and drops the second, so the artwork beside it prints
        // nowhere. It was impossible to express before — one row had one placement.
        if (faces.includes(face)) { warn.push(`${pr.label} placement repeats ${face} — only the first of the two is printed`); continue }
        faces.push(face)
        // The SAME test groupToOrders applies. Reading these for mere emptiness said a row
        // was fine when it carried `IMG-30` in an artwork column — a value the parser drops
        // for not being an address, so nothing would have been placed and nothing said.
        if (!looksLikeArtwork(pr.art) && !S(rec.template_id)) {
          warn.push(`${pr.label} placement has no design beside it — nothing to place there`)
        }
      }
    }
    rec._warnings = warn.join("; ")
    return rec
  }).filter((r) => !isSampleRow(r as unknown as Record<string, string>))
  if (!records.length) return { records: [], error: "No order rows found — only a header (and maybe the sample row)." }
  return { records }
}

/**
 * The readable half of a Blank Product cell.
 *
 * The sheet's dropdown offers "SKU - Name" — the sku is there so two near-identical garments
 * can be told apart while picking, and it is noise once picked. Split on the FIRST " - " so a
 * sku that contains a dash (PC-54) survives; a cell with no separator is already the name.
 */
export function blankName(cell: string): string {
  const v = String(cell || "").trim()
  const at = v.indexOf(" - ")
  return at > 0 ? v.slice(at + 3).trim() : v
}

export type ImportItem = {
  name: string; sku: string; img: string; qty: number; unitPrice: number
  color: string; size: string; printType: string; designUrl: string; blank: string
  templateId: string; notes: string
  /**
   * WHICH FACE this line's design goes on — "" when the row didn't say.
   *
   * A face key (front/back/left/…), never the word the sheet offered: normalizeSide has
   * already run, so "Left sleeve" and "left" are the same value by the time anything reads
   * this. Blank means "the row expressed no opinion", which is NOT the same as front — a
   * template still keeps the placement it was drawn with.
   */
  printSide: string
  /** The seller's own stitch file, by library reference (`MF-12`). Resolved and attached
   *  AFTER the order exists, against this line's own id — see the import dialog. */
  machineFileId: string
  /** Every face this line prints, when two or more rows shared an Item #. Undefined on a
   *  single-row line, which keeps the one-face path exactly as it was. Each entry is a face
   *  the sheet ASKED for; `artwork` may be empty, because a declared face with no picture is
   *  still a face — the same rule the designer follows. */
  sides?: { side: string; artwork: string }[]
  /**
   * Filled by applyTemplates, read by the order write — placement, and the other faces.
   *
   * They exist because `designUrl` is a string and a string cannot hold a position. The
   * import used to stop at that string, so a templated line arrived with artwork centred by
   * default on a design somebody had placed by hand. Absent on a row that named its own
   * artwork: the sheet wins, and its artwork has no template placement to inherit.
   */
  templatePos?: TemplatePos | null
  templateSides?: { side: string; artwork: string; pos: TemplatePos | null }[]
  templateMachineFile?: { name: string; data: string } | null
}
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
export function groupToOrders(records: ImportRecord[], resolveArtwork?: ArtworkResolver): ImportOrder[] {
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
    /**
     * ROWS → LINES, the second grouping level.
     *
     * Order Number decided how many ORDERS came out of N rows; Item # decides how many LINES
     * come out of an order's rows. Two rows sharing one become a single garment carrying both
     * faces, which is the only way to ask a sheet for a front AND a back without a template.
     *
     * A row with no Item # is its OWN line, keyed on its index — the same trick the order key
     * uses one level up, and what makes this change invisible to every sheet written before
     * it: no Item # anywhere means every row keys uniquely and the grouping collapses to
     * one-row-per-line, exactly as it was.
     */
    const lineKeyOf = (r: ImportRecord, i: number) => S(r.item_key) || `${AUTO_KEY}L${i}`
    const lineGroups: Record<string, ImportRecord[]> = {}
    const lineOrder: string[] = []
    rows.forEach((r, i) => {
      const lk = lineKeyOf(r, i)
      if (!lineGroups[lk]) { lineGroups[lk] = []; lineOrder.push(lk) }
      lineGroups[lk].push(r)
    })
    const items: ImportItem[] = lineOrder.map((lk) => {
      const lineRows = lineGroups[lk]
      /* THE FIRST ROW DESCRIBES THE GARMENT. Blank, colour, size, method, quantity and sku are
         properties of the ITEM, so a second row repeating them is confirming, not adding —
         and a second row DISAGREEING is a sheet mistake we must not average away. First wins,
         which is also the only reading that is stable under re-sorting. */
      const r = lineRows[0]
      const hero = S(r.hero_image)
      const url = (v: string) => artworkUrl(v, resolveArtwork)
      // The row's own design, most explicit spelling first. Both are the artwork now — see
      // COL_ALIASES. A URL passes through, an `IMG-30` is looked up in the seller's library,
      // and anything that resolves to neither is dropped rather than filed as an address.
      const artwork = url(S(r.design_file_url)) || url(hero)
      return {
        sku: S(r.item_sku),
        // THE BLANK IS THE FALLBACK NAME, and it sits ahead of the listing SKU because it is
        // a thing a person can read. The cell arrives as "G5000 - Gildan 5000 Heavy Cotton
        // Tee"; the name is the half after the dash, so the board shows the garment rather
        // than a code. "Item" is what is left when a row has nothing at all, which the
        // required Blank Product now makes unreachable through the template.
        name: S(r.product_title) || S(r.item_name) || blankName(S(r.blank)) || S(r.item_sku) || "Item",
        // The picture, which is the artwork unless the row supplied a separate listing photo.
        img: url(S(r.listing_image)) || artwork,
        qty: Math.max(1, parseInt(S(r.item_quantity)) || 1),
        unitPrice: Number(S(r.item_price).replace(/[^0-9.]/g, "")) || 0,
        /**
         * THE CANONICAL LABEL, not an upper-cased one.
         *
         * This was `.toUpperCase()`, so the sheet's own dropdown value "DTG printing" was
         * stored as "DTG PRINTING" — a string that matches no option anywhere else, because
         * every other surface reads methods through normalizeMethods and gets the label.
         * The line's variant picker then showed the technique TWICE: its canonical option,
         * plus the imported spelling prepended as an unknown value it must not lose.
         *
         * normTech matches on a pattern (/dtg|direct to garment/), so it reads the sheet's
         * label, a bare code, a supplier's phrasing and any casing of them, and answers with
         * the one spelling the catalogue uses. Anything it cannot place is kept verbatim
         * rather than dropped — an uncatalogued technique still has to be sayable.
         */
        printType: normalizeMethods([S(r.print_type)])[0]?.label ?? S(r.print_type),
        color: S(r.item_color),
        size: S(r.item_size),
        /* THE PRINTABLE ARTWORK, and it is NOT `img` even though one cell usually fills
           both. `img` is borrowed between lines a few lines below — a parent row with no
           picture takes a later line's — and doing that to a design would print line 2's
           artwork on line 1. */
        designUrl: artwork,
        // Already a face key, so nothing downstream has to know the sheet's spelling.
        printSide: normalizeSide(S(r.print_side)),
        // Carried through so the board can resolve production. `blank` is what we make on;
        // `templateId` names a saved design to apply, which fills the rest.
        blank: S(r.blank),
        templateId: S(r.template_id),
        machineFileId: S(r.machine_file_id),
        notes: S(r.internal_notes),
        /**
         * EVERY FACE THIS LINE PRINTS, one per row that named one.
         *
         * Only set when the rows actually merged — a single-row line leaves it undefined and
         * takes the existing designUrl/printSide path, so nothing about a one-face import
         * changes shape. A row that named a placement but no artwork still contributes: the
         * face is real and the picture can arrive later, which is the same rule the designer
         * follows (§ "A declared face with no photo borrows the front's; it is never dropped").
         */
        sides: (() => {
          /**
           * THE FACES, FROM TWO SHAPES OF SHEET.
           *
           * NEW (the template since the five pairs): every face is on THIS row — 1st..5th
           * placement, each with the artwork in the column beside it. One row is one garment.
           *
           * OLD (any sheet written before it): one face per row, with a "Line" key joining
           * the rows of one garment. Still parsed, because a file somebody filled last week
           * has to keep importing — the column is gone from the template, not from here.
           *
           * The pairs win when the row uses them, and the two can't fight: a sheet built the
           * new way has no Line column at all, so `lineRows` is always length 1 there.
           */
          const seen = new Set<string>()
          const out: { side: string; artwork: string }[] = []
          const add = (rawSide: string, rawArt: string) => {
            const side = normalizeSide(rawSide) || (rawArt ? "front" : "")
            // A pair with NOTHING in it is an unused slot, not a face. This is the whole
            // reason five columns can sit on every row without polluting a one-face order.
            if (!side && !rawArt) return
            const key = side || "front"
            if (seen.has(key)) return          // first wins, as it does for the garment itself
            seen.add(key)
            out.push({ side: key, artwork: url(rawArt) })
          }
          // Pair 1 keeps the original keys, so an old "Placement"/"Artwork ID" row lands here.
          add(S(r.print_side), S(r.design_file_url) || S(r.hero_image))
          add(S(r.print_side_2), S(r.artwork_2))
          add(S(r.print_side_3), S(r.artwork_3))
          add(S(r.print_side_4), S(r.artwork_4))
          add(S(r.print_side_5), S(r.artwork_5))
          // The legacy shape: extra ROWS joined by a Line key, each carrying one face.
          for (const row of lineRows.slice(1)) {
            add(S(row.print_side), S(row.design_file_url) || S(row.hero_image))
          }
          /* ONE face is not a multi-face line — leave it undefined so a plain order keeps the
             existing designUrl/printSide path and nothing about a one-face import changes
             shape. That was true of the old grouping too and is worth keeping true. */
          return out.length > 1 ? out : undefined
        })(),
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
  /**
   * THE DESIGN AND WHERE IT SITS — the only two things a Template ID is for on a sheet.
   *
   * This carried `composite` alone: a flat picture of the finished thing, with no placement
   * in it. So a row that named a template got an image and no idea where on the garment it
   * belonged, and the floor saw artwork centred by default on a design somebody had
   * positioned deliberately.
   *
   * Colour, size and method are NOT here on purpose. Those are variant choices the sheet
   * makes per row, and a template that overwrote them would discard what somebody typed.
   * The design maker's job is upload + blank + variants for publishing; the template's job
   * here is the artwork and its position.
   */
  artwork: string
  pos: TemplatePos | null
  /** Every face the template placed artwork on, when it has more than one. */
  sides: { side: string; artwork: string; pos: TemplatePos | null }[]
  /** The stitch file saved with the template, so an embroidery line arrives ready. */
  machineFile: { name: string; data: string } | null
}

/** Placement, as design-maker and the boards store it: percentages of the print area. */
export type TemplatePos = { x?: number; y?: number; scale?: number; rot?: number }

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
      /**
       * THE SHEET WINS, field by field.
       *
       * A template fills what the row left blank and never overwrites what somebody typed:
       * a row that names its own artwork, or its own blank, meant that. The alternative —
       * template wins — silently discards a typed value, and the way you find out is a
       * wrong garment in a box.
       */
      return {
        ...it,
        blank: it.blank || t.blankSku || "",
        designUrl: it.designUrl || t.artwork || t.composite || "",
        // Carried through to the order write, which turns them into a real design row per
        // line. A `designUrl` string cannot hold placement, which is why placement was lost.
        templatePos: it.designUrl ? null : t.pos,
        templateSides: it.designUrl ? [] : t.sides,
        templateMachineFile: t.machineFile,
      }
    }),
  }))
  return { orders: out, unmatched: [...unmatched], ambiguous: [...ambiguous], applied }
}
