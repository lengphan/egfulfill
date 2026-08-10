/**
 * A partner's own workbook, read and written back filled in.
 *
 * Every print-on-demand partner onboards with a different spreadsheet, so nothing here
 * knows what Printify's columns are called. We READ their file to learn its shape, let a
 * human say which of our catalogue fields feeds each of their columns, and WRITE the same
 * shape back with our rows in it.
 *
 * WHAT WE REPRODUCE: sheet names, section titles, header text, column order and gaps.
 * WHAT WE DO NOT: cell fills, merged headings, fonts, column widths. SheetJS's community
 * build does not round-trip styling, and a sheet that looked right but had lost a merge
 * would be worse than one that plainly never had the colours. The partner is reading the
 * data, not the decoration — but say so rather than let them discover it.
 */
import * as XLSX from "xlsx"

/** One column of one block: where it sits, and what the partner calls it. */
export type TemplateColumn = { index: number; label: string }

/**
 * A BLOCK, not a sheet, is the unit a mapping attaches to.
 *
 * Printify's workbook puts "Shipping information" and "SKU list of Print Provider" on one
 * sheet, one above the other, each with its own header row. Treating a sheet as a single
 * table would have mapped the shipping headers onto product rows — so the header row is
 * what identifies a table here, and a sheet is just an ordered list of them.
 */
export type TemplateBlock = {
  id: string
  /** The lone-cell heading found above the header row, if there was one. */
  title: string
  /** 0-based index of the header row in the source sheet — the block's identity. */
  headerRow: number
  columns: TemplateColumn[]
}

export type TemplateSheet = { name: string; blocks: TemplateBlock[] }
export type TemplateLayout = { sheets: TemplateSheet[] }

/**
 * What fills one column.
 *
 * `const` is not a lesser option — it is how the fields our catalogue has never held get
 * into the sheet. A pallet size or a carton weight is one number that is true for every
 * row, so it is picked once here rather than stored per product.
 */
export type ColumnRule =
  | { kind: "blank" }
  | { kind: "field"; field: string }
  | { kind: "const"; value: string }

export type BlockMode = "rows" | "fixed" | "skip"

export type BlockMapping = {
  /**
   * `rows` repeats the block once per catalogue variant. `fixed` is for a block that is not
   * about products at all — a shipping rate card is a handful of lines someone types once
   * and every export carries unchanged. `skip` leaves the block's headers and no data.
   */
  mode: BlockMode
  /** column index → rule, for `rows`. */
  columns: Record<number, ColumnRule>
  /** literal rows for `fixed`, indexed to match `columns` order in the block. */
  fixed: string[][]
}

export type Mapping = Record<string, BlockMapping>

/** One flattened catalogue variant, as `GET /api/catalog/rows` returns it. */
export type CatalogRow = Record<string, string>

const cellText = (v: unknown) =>
  v == null ? "" : typeof v === "string" ? v.trim() : String(v).trim()

const filled = (row: unknown[]) => row.filter((c) => cellText(c) !== "").length

export const blockId = (sheet: string, headerRow: number) => `${sheet}#${headerRow}`

/**
 * Find the tables in a workbook.
 *
 * The heuristic is deliberately simple and deliberately correctable in the UI: a row with
 * one filled cell is a section heading, a row with two or more is a header row, and
 * everything after a header row until a blank line is the partner's own example data —
 * which we must NOT carry over, because their sample Gildan 64000 shipping to Europe would
 * otherwise go out as though it were ours.
 */
export function detectLayout(file: ArrayBuffer): TemplateLayout {
  const wb = XLSX.read(file, { type: "array" })
  const sheets: TemplateSheet[] = []

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: "" })
    const blocks: TemplateBlock[] = []
    let pendingTitle = ""
    let inBlock = false

    for (let r = 0; r < aoa.length; r++) {
      const row = Array.isArray(aoa[r]) ? aoa[r] : []
      const n = filled(row)

      if (n === 0) { inBlock = false; pendingTitle = ""; continue }
      if (n === 1) {
        // A lone cell is a heading — and it also ends whatever block was running, which is
        // what keeps "Shipping information" from being read as a row of the block above it.
        pendingTitle = cellText(row.find((c) => cellText(c) !== ""))
        inBlock = false
        continue
      }
      if (inBlock) continue // sample data under a header we already took

      const columns: TemplateColumn[] = []
      row.forEach((c, i) => {
        const label = cellText(c)
        if (label) columns.push({ index: i, label })
      })
      blocks.push({ id: blockId(name, r), title: pendingTitle, headerRow: r, columns })
      pendingTitle = ""
      inBlock = true
    }

    if (blocks.length) sheets.push({ name, blocks })
  }

  return { sheets }
}

/**
 * Synonyms, so the first mapping is mostly already right.
 *
 * A guess only ever pre-selects; nothing exports without a human having seen the preview.
 * Everything absent from this table — WEIGHT, PALLET SIZE, the whole shipping block — is
 * left unmapped ON PURPOSE. There is no field to guess from, and inventing a gram weight
 * is a shipping quote we would then be held to.
 */
const SYNONYMS: Record<string, string> = {
  sku: "sku", "sku code": "sku", "item number": "sku",
  model: "model", style: "model", "style number": "model", "style #": "model", "model number": "model",
  // NOTE: "vendor" and "supplier" map to NOTHING, deliberately. A partner asking who
  // supplies us gets an unfilled column and a human decision, not an automatic answer —
  // CLAUDE.md §2.8. The field was removed from the server's vocabulary too.
  brand: "brand", manufacturer: "brand",
  name: "product", "product name": "product", title: "product", product: "product", description: "description",
  color: "colour", colour: "colour", "color name": "colour", "colour name": "colour",
  size: "size", "size name": "size",
  price: "price", cost: "price", "cost (usd)": "price", "unit price": "price", "price (usd)": "price",
  currency: "currency",
  image: "image", "image url": "image", photo: "image", "product image": "image",
  "variant image": "variant_image", "color image": "variant_image",
}

const norm = (s: string) => s.toLowerCase().replace(/[_\-/]+/g, " ").replace(/\s+/g, " ").trim()

/** A first pass at the mapping, from the partner's own header text. */
export function guessMapping(layout: TemplateLayout, fields: string[]): Mapping {
  const known = new Set(fields)
  const out: Mapping = {}
  for (const sheet of layout.sheets) {
    for (const block of sheet.blocks) {
      const columns: Record<number, ColumnRule> = {}
      let hits = 0
      for (const col of block.columns) {
        const key = norm(col.label)
        const field = SYNONYMS[key] || (known.has(key) ? key : "")
        if (field && known.has(field)) { columns[col.index] = { kind: "field", field }; hits++ }
        else columns[col.index] = { kind: "blank" }
      }
      // A block none of whose headers name a product field is not a product table — a
      // shipping rate card is the case that matters — so it starts as `fixed`, where the
      // answer is typed once, rather than as rows nothing would fill.
      out[block.id] = { mode: hits > 0 ? "rows" : "fixed", columns, fixed: [] }
    }
  }
  return out
}

/** Blank mapping for a block the guesser never saw (a hand-added block). */
export const emptyBlockMapping = (block: TemplateBlock): BlockMapping => ({
  mode: "rows",
  columns: Object.fromEntries(block.columns.map((c) => [c.index, { kind: "blank" } as ColumnRule])),
  fixed: [],
})

const valueFor = (rule: ColumnRule | undefined, row: CatalogRow): string => {
  if (!rule) return ""
  if (rule.kind === "field") return row[rule.field] ?? ""
  if (rule.kind === "const") return rule.value
  return ""
}

/** The rows one block will contribute — the same array the preview shows and the file gets. */
export function blockRows(block: TemplateBlock, m: BlockMapping | undefined, rows: CatalogRow[]): string[][] {
  if (!m || m.mode === "skip") return []
  if (m.mode === "fixed") {
    return m.fixed.map((r) => block.columns.map((_, i) => r[i] ?? ""))
  }
  return rows.map((row) => block.columns.map((c) => valueFor(m.columns[c.index], row)))
}

/**
 * Write the partner's shape back out.
 *
 * Blocks are re-laid sequentially rather than pinned to their original row numbers: as soon
 * as one block gains 400 product rows, every row index below it in the source file is wrong
 * anyway. Titles, headers, column order and column gaps are preserved; the vertical
 * position is not.
 */
export function buildWorkbook(layout: TemplateLayout, mapping: Mapping, rows: CatalogRow[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()

  for (const sheet of layout.sheets) {
    const aoa: string[][] = []
    for (const block of sheet.blocks) {
      const m = mapping[block.id]
      if (block.title) aoa.push([block.title])

      // Write at the recorded index so a template with a gap column keeps its gap.
      const width = block.columns.length ? Math.max(...block.columns.map((c) => c.index)) + 1 : 0
      const header = new Array(width).fill("")
      block.columns.forEach((c) => { header[c.index] = c.label })
      aoa.push(header)

      for (const line of blockRows(block, m, rows)) {
        const out = new Array(width).fill("")
        block.columns.forEach((c, i) => { out[c.index] = line[i] ?? "" })
        aoa.push(out)
      }
      aoa.push([])
    }
    // Excel caps sheet names at 31 characters and rejects []:*?/\ — a partner's tab called
    // "SKU list / print provider" would otherwise throw on write with no useful message.
    const safe = sheet.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet1"
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), safe)
  }

  if (!wb.SheetNames.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "Sheet1")
  return wb
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`)
}

/** Which of our fields a mapping actually uses — drives the "nothing feeds this" warning. */
export function mappedFields(mapping: Mapping): Set<string> {
  const used = new Set<string>()
  for (const m of Object.values(mapping)) {
    if (m.mode !== "rows") continue
    for (const rule of Object.values(m.columns)) if (rule.kind === "field") used.add(rule.field)
  }
  return used
}

/**
 * Columns a partner asked for that nothing feeds yet — what the UI must not hide.
 *
 * `fields` is the server's CURRENT vocabulary, and passing it catches the case a saved
 * mapping creates: a rule naming a field that no longer exists resolves to `""` at build
 * time and exports as a blank cell that looks deliberate. `supplier` was withdrawn for
 * exactly that reason, so every template mapped before then has one — it must show up here
 * rather than quietly emptying a column someone believes is filled.
 */
export function unfilledColumns(
  layout: TemplateLayout, mapping: Mapping, fields?: string[],
): { block: string; label: string }[] {
  const known = fields && fields.length ? new Set(fields) : null
  const out: { block: string; label: string }[] = []
  for (const sheet of layout.sheets) {
    for (const block of sheet.blocks) {
      const m = mapping[block.id]
      if (!m || m.mode !== "rows") continue
      for (const c of block.columns) {
        const rule = m.columns[c.index]
        const dead = rule?.kind === "field" && known != null && !known.has(rule.field)
        if (!rule || rule.kind === "blank" || dead) {
          out.push({ block: block.title || sheet.name, label: c.label })
        }
      }
    }
  }
  return out
}
