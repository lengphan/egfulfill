"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { UploadSimple, DownloadSimple, CheckCircle, WarningCircle, Table } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import {
  parseCSV,
  parsePasted,
  rowsToRecords,
  groupToOrders,
  applyTemplates,
  type ImportTemplate,
  type TemplatePos,
  CSV_COLUMNS,
  COLUMN_OPTIONS,
  GROUP_LABEL,
  DUTY_LABEL,
  DUTY_MARK,
  SECTION_FILL,
  type CsvSection,
  dutyOf,
  columnBands,
  type ImportRecord,
} from "@/lib/order-import"
import { createOrder, getOrders, getTemplates, getCatalogProducts, postOrderDesign, uploadDesignFile, resolveMachineFiles, attachMachineFile, type DesignPos, type MachineFile } from "@/lib/api"
import { productSizes, productColors } from "@/lib/variant-sku"
import { normalizeMethods } from "@/lib/print-method"
import { nextOrderId, nextSellerSeq } from "@/lib/order-id"
import { orderTotal } from "@/lib/pricing"

// Build + download the .xlsx template, with the SAME shape as the Google Sheet: a merged
// section banner, a header row coloured by obligation, frozen panes, and real dropdowns.
//
// Written with ExcelJS, not SheetJS. SheetJS's community build cannot write cell fills or
// data validation — it emits a plain sheet and does not throw, which is why this download
// silently had neither while the Google Sheet had both. ExcelJS writes real
// <dataValidation type="list"> entries. Reading an uploaded .xlsx stays on SheetJS: that
// path works and is battle-tested, and swapping it would risk the import to fix the export.
//
// Both libraries are lazy-imported, so neither reaches the main bundle.
async function downloadXlsxTemplate() {
  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Orders")
  const bands = columnBands()

  // Row 1 — section banner, one merged run per band.
  const banner = CSV_COLUMNS.map(() => "")
  bands.forEach((b) => { banner[b.start] = GROUP_LABEL[b.group] })
  ws.addRow(banner)
  bands.forEach((b) => {
    if (b.count > 1) ws.mergeCells(1, b.start + 1, 1, b.start + b.count)
    for (let i = b.start; i < b.start + b.count; i++) {
      const cell = ws.getCell(1, i + 1)
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL[b.group] } }
      cell.font = { bold: true, size: 10 }
      cell.alignment = { horizontal: "center" }
    }
  })

  // Row 2 — headers in their SECTION's colour, same as the banner above them. Obligation
  // is carried by the `*` and by the red it is set in, not by a second palette.
  ws.addRow(CSV_COLUMNS.map((c) => c.header + DUTY_MARK[dutyOf(c)]))
  const groupOf = new Map<number, CsvSection>()
  bands.forEach((b) => { for (let i = b.start; i < b.start + b.count; i++) groupOf.set(i, b.group) })
  CSV_COLUMNS.forEach((c, i) => {
    const duty = dutyOf(c)
    const cell = ws.getCell(2, i + 1)
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL[groupOf.get(i) ?? "extras"] } }
    // Required reads in red as well as being asterisked — colour alone fails a colour-blind
    // filler, and an asterisk alone is easy to miss across 21 columns.
    cell.font = { bold: true, color: { argb: duty === "required" ? "FF9E1721" : "FF1A1A1A" } }
  })

  ws.views = [{ state: "frozen", ySplit: 2 }]
  ws.columns.forEach((col, i) => { col.width = Math.min(28, Math.max(13, CSV_COLUMNS[i].header.length + 4)) })

  // Real dropdowns over the data rows. NOT strict (showErrorMessage false): a rejected paste
  // is worse than an odd value, and the importer normalises these anyway — the same call the
  // Google Sheet makes. Excel caps an inline list at 255 characters; every list here is well
  // under (US states, the longest, is ~152).
  const DATA_ROWS = 500

  /**
   * THE LIVE LISTS, ON A HIDDEN TAB — because an inline list cannot hold them.
   *
   * Excel caps an inline dropdown at 255 characters. Twenty-seven product names blow past
   * that on their own, so the catalogue cannot be written the way the fixed lists are: it
   * goes on a hidden sheet and the validation points at the range, which has no such cap.
   *
   * Read from the catalogue at DOWNLOAD time, not from a constant — the whole complaint
   * that started this was a template offering sizes a product doesn't come in and never
   * showing a blank added since the arrays were last edited.
   *
   * NOT DEPENDENT, and that is the honest difference from the Google copy. Excel can do it
   * (defined names plus INDIRECT) but ExcelJS's own xlsx is then rewritten by whatever
   * opens it, and Google's importer drops data validation on conversion entirely — see the
   * note on the format route. So the file gets every colour, size and method the catalogue
   * actually offers, and the Sheets master gets the per-product narrowing.
   */
  const live: Record<string, string[]> = {}
  try {
    const cat = await getCatalogProducts()
    const names = [...new Set((cat ?? []).map((p) => String(p.name || "").trim()).filter(Boolean))].sort()
    const colors = [...new Set((cat ?? []).flatMap((p) => productColors(p)))].sort()
    const sizes = [...new Set((cat ?? []).flatMap((p) => productSizes(p)))]
    /* THE WORDS, NOT THE KEYS — the same change COLUMN_OPTIONS took, and this is the copy
       that was missed. The .xlsx handed to a seller kept offering EMB / APL / DTF while the
       app had moved to Embroidery / Appliqué / DTF printing, which is a template disagreeing
       with the product it feeds. Third place this vocabulary is written; methodCode() reads
       every spelling back, so old sheets are unaffected. */
    const methods = [...new Set(normalizeMethods((cat ?? []).flatMap((p) => [p.method, ...(p.methods ?? [])]))
      .map((m) => m.label))]
    if (names.length) live.blank = names
    if (colors.length) live.item_color = colors
    if (sizes.length) live.item_size = sizes
    if (methods.length) live.print_type = methods
  } catch { /* no catalogue → the fixed lists below, exactly as before */ }

  const listCols = Object.entries(live)
  if (listCols.length) {
    const lists = wb.addWorksheet("Lists", { state: "veryHidden" })
    listCols.forEach(([key, values], i) => {
      lists.getCell(1, i + 1).value = key
      values.forEach((v, r) => { lists.getCell(r + 2, i + 1).value = v })
    })
  }

  // A live list wins over the fixed one for the same column — same precedence the Sheets
  // template uses, so the two never offer different things.
  Object.entries({ ...COLUMN_OPTIONS, ...live }).forEach(([key, values]) => {
    const idx = CSV_COLUMNS.findIndex((c) => c.key === key)
    if (idx < 0) return
    const letter = ws.getColumn(idx + 1).letter
    const liveAt = listCols.findIndex(([k]) => k === key)
    if (liveAt >= 0) {
      const col = String.fromCharCode(65 + liveAt)      // Lists has at most four columns
      const validations = (ws as unknown as {
        dataValidations: { add: (range: string, rule: Record<string, unknown>) => void }
      }).dataValidations
      validations.add(`${letter}3:${letter}${DATA_ROWS}`, {
        type: "list",
        allowBlank: true,
        formulae: [`Lists!$${col}$2:$${col}$${values.length + 1}`],
        showErrorMessage: false,
      })
      return
    }
    // The RANGE api, via a narrow cast — ExcelJS ships it but leaves it off the Worksheet
    // type. It is worth the cast: assigning per cell instead (the typed path) makes ExcelJS
    // emit the same rule twice under split, wrong ranges (C3:C500 *and* C10:C500) and a
    // larger file, where this writes exactly one correct <dataValidation sqref="C3:C500">.
    const validations = (ws as unknown as {
      dataValidations: { add: (range: string, rule: Record<string, unknown>) => void }
    }).dataValidations
    validations.add(`${letter}3:${letter}${DATA_ROWS}`, {
      type: "list",
      allowBlank: true,
      formulae: [`"${values.join(",")}"`],
      showErrorMessage: false,
    })
  })

  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
  const a = document.createElement("a")
  a.href = url
  a.download = "EGFUL Order Import.xlsx"
  a.click()
  URL.revokeObjectURL(url)
}

export function ImportOrdersDialog({
  open,
  onOpenChange,
  onImported,
  initialRows,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onImported?: (count: number) => void
  /**
   * Rows handed over by the full-page sheet at /sheet, header row included.
   *
   * The sheet does NOT import anything itself. It edits, and then hands the rows to this
   * dialog, which owns the whole pipeline — templates, machine files, design rows, the
   * order id, the meta. Re-implementing that on the page would have been a second importer
   * that agrees with this one only until someone changes one of them.
   */
  initialRows?: string[][]
}) {
  const router = useRouter()
  const [records, setRecords] = useState<ImportRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [paste, setPaste] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  // Header row shown for manual copying when the clipboard write did not happen.
  const [copyFallback, setCopyFallback] = useState<string | null>(null)
  /**
   * THE GOOGLE SHEETS STATE IS GONE (2026-08-22), with the tab it served.
   *
   * "Sheet" now means OUR sheet, at /sheet — so the copy URL, the master link, the
   * admin-only Apps Script and manifest boxes, the template-link field and the
   * enabled/config-error pair all had nothing left to render. The SERVER routes are
   * untouched: sheets.js still serves the master, still re-formats it, and every sheet
   * already in a seller's Drive still imports through the File tab.
   */
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<{ imported: number; mfAttached: number; mfFailed: string[] } | null>(null)
  // The seller's saved templates, fetched ONLY when a parsed sheet actually names one.
  // Composites are base64 images, so this is not a payload to pull on the off-chance.
  const [templates, setTemplates] = useState<ImportTemplate[] | null>(null)
  const [templatesFailed, setTemplatesFailed] = useState(false)
  /** What each `MF-…` in the sheet resolves to — null for a reference that does not, which
   *  covers "no such file" and "not yours" identically and on purpose. */
  const [machineFiles, setMachineFiles] = useState<Record<string, MachineFile | null> | null>(null)
  const [machineLookupFailed, setMachineLookupFailed] = useState(false)


  useEffect(() => {
    if (!open) return
    // Reset per open, and see whether Google Sheets is configured server-side.
    const id = setTimeout(() => {
      setRecords(null); setError(null); setPaste(""); setDone(null)
      setNotice(null); setCopyFallback(null); setTemplates(null); setTemplatesFailed(false)
    }, 0)
    return () => clearTimeout(id)
  }, [open])

  const summary = useMemo(() => {
    const list = records ?? []
    const valid = list.filter((r) => r._valid).length
    // Rows that will import but split, because they carry no Order Number to group by.
    const ungrouped = list.filter((r) => r._valid && !r.order_number).length
    return { total: list.length, valid, invalid: list.length - valid, ungrouped, orders: valid ? groupToOrders(list).length : 0 }
  }, [records])

  const ingest = (rows: string[][]) => {
    const { records, error } = rowsToRecords(rows)
    if (error) { setError(error); setRecords(null); return }
    setError(null)
    setRecords(records)
    /**
     * AND THE MACHINE FILES THE SHEET NAMES — resolved HERE, not at import.
     *
     * "Recognise and read that file" has to happen while the sheet is still on screen. A
     * reference that does not resolve is a line that arrives with no stitch file, and an
     * embroidered line with no stitch file is a job the floor cannot start — discovering
     * that after the orders exist means going back through them by hand.
     *
     * Metadata only: the resolve returns names and sizes, never bytes. The bytes never
     * touch the browser on this path at all.
     */
    const refs = [...new Set(records.map((r) => String(r.machine_file_id || "").trim()).filter(Boolean))]
    if (refs.length) {
      resolveMachineFiles(refs)
        .then((m) => setMachineFiles(m ?? {}))
        // A LOOKUP THAT FAILED IS NOT A LOOKUP THAT FOUND NOTHING. Empty would render as
        // "none of these exist" and invite someone to fix ids that are perfectly good.
        .catch(() => { setMachineFiles(null); setMachineLookupFailed(true) })
    } else {
      setMachineFiles(null); setMachineLookupFailed(false)
    }
    // Only now do we know whether templates matter. Fetching them up front would pull
    // every composite (base64 images) for the majority of imports that name none.
    if (records.some((r) => String(r.template_id || "").trim())) {
      setTemplatesFailed(false)
      getTemplates()
        .then((rows) => setTemplates((rows ?? []).map((t) => {
          /**
           * THE PIECES, NOT THE PICTURE.
           *
           * `composite` is a flat render of the finished design and was all a Template ID
           * ever brought onto a line — so placement was lost every time, because a picture
           * has no position in it. The layers are where the artwork and its position live,
           * exactly as the design maker saved them.
           *
           * Two shapes, both read: a template saved before the layer stack has one artwork
           * (`designUrl` + `pos`); one saved after has `images[]`. Bottom layer first — on
           * every design made before the stack that is the only layer there is.
           */
          const l = (t.layers ?? {}) as {
            images?: { src?: string; pos?: TemplatePos; side?: string }[]
            designUrl?: string; pos?: TemplatePos
            machineFile?: { name?: string; data?: string } | null
          }
          const first = Array.isArray(l.images) ? l.images.find((im) => im?.src) : null
          const sides = (Array.isArray(l.images) ? l.images : [])
            .filter((im) => im?.src && im.side)
            .map((im) => ({ side: String(im.side), artwork: String(im.src), pos: im.pos ?? null }))
          const mf = l.machineFile
          return {
            id: String(t.id),
            seq: t.seq ?? null,
            name: t.name ?? null,
            blankSku: String((t.data as { blankSku?: string } | null)?.blankSku ?? ""),
            composite: t.composite ?? "",
            artwork: String(first?.src ?? l.designUrl ?? ""),
            pos: first?.pos ?? l.pos ?? null,
            sides,
            machineFile: mf?.name && mf?.data ? { name: String(mf.name), data: String(mf.data) } : null,
          }
        })))
        // Not silent. A template that can't be looked up means the blank and the artwork
        // it promised won't be applied, and the import would otherwise look complete.
        .catch(() => { setTemplates([]); setTemplatesFailed(true) })
    } else {
      setTemplates(null)
    }
  }

  /**
   * ROWS FROM THE FULL-PAGE SHEET (/sheet), header row included.
   *
   * A second effect rather than a line inside the reset above, because `ingest` is declared
   * between them — calling it from the earlier effect reads a binding that does not exist
   * yet, which react-hooks/immutability rejects and which would silently stop updating.
   * Declaration order settles the sequence: the reset runs, then this fills.
   */
  useEffect(() => {
    if (!open || !initialRows || initialRows.length < 2) return
    const id = setTimeout(() => ingest(initialRows), 0)
    return () => clearTimeout(id)
  }, [open, initialRows])

  /**
   * What the Template ID column will actually do, resolved for the preview.
   *
   * Computed BEFORE the import rather than reported after it: an unrecognised id means a
   * line arrives with no blank and no artwork, and the moment to fix a typo is while the
   * sheet is still open.
   */
  /**
   * WHAT THE MACHINE FILE ID COLUMN WILL DO — computed before the import, like the template
   * one above and for the same reason.
   *
   * THREE OUTCOMES, and the third is the one worth catching early: a reference that resolves
   * fine but names a row that is not embroidered. A stitch file has no machine to run on a
   * DTG line, so it would be a check fee raised for a file nothing can use (CLAUDE.md §4).
   * The server refuses it too — this is the half that refuses it while the typo is still
   * fixable.
   */
  const machineOutcome = useMemo(() => {
    if (!records) return null
    const rows = records.filter((r) => r._valid && String(r.machine_file_id || "").trim())
    if (!rows.length) return null
    const typed = rows.length
    if (machineLookupFailed || !machineFiles) return { typed, ok: 0, unknown: [] as string[], wrongMethod: [] as string[], failed: machineLookupFailed }
    const unknown = new Set<string>()
    const wrongMethod = new Set<string>()
    let ok = 0
    for (const r of rows) {
      const ref = String(r.machine_file_id || "").trim()
      if (!machineFiles[ref]) { unknown.add(ref); continue }
      // The row's own method. Blank is allowed through — the line has not said it ISN'T
      // embroidery, and the server makes the final call against the saved line.
      const m = String(r.print_type || "").toUpperCase()
      if (m && !/EMB|STITCH|EMBROID/.test(m)) { wrongMethod.add(ref); continue }
      ok++
    }
    return { typed, ok, unknown: [...unknown], wrongMethod: [...wrongMethod], failed: false }
  }, [records, machineFiles, machineLookupFailed])

  const templateOutcome = useMemo(() => {
    if (!records || !templates) return null
    const typed = records.filter((r) => r._valid && String(r.template_id || "").trim()).length
    if (!typed) return null
    const r = applyTemplates(groupToOrders(records), templates)
    return { typed, applied: r.applied, unmatched: r.unmatched, ambiguous: r.ambiguous }
  }, [records, templates])

  const takeFile = (file?: File | null) => {
    if (!file) return
    const isXlsx = /\.xlsx?$/i.test(file.name)
    if (!isXlsx && !/\.csv$/i.test(file.name)) { setError("Please upload a .csv or .xlsx file (or use Paste)."); return }
    // An empty or unreadable file used to do NOTHING — no preview, no error, no clue.
    // Silence is the worst outcome here: it's indistinguishable from the click not
    // registering, so people re-try the same broken file.
    if (!file.size) { setError(`"${file.name}" is empty — nothing to import.`); return }
    const reader = new FileReader()
    if (isXlsx) {
      // Read the first sheet into rows the same shape parseCSV produces. xlsx is lazy-imported.
      reader.onload = async () => {
        try {
          const XLSX = await import("xlsx")
          const wb = XLSX.read(reader.result, { type: "array" })
          const ws = wb.Sheets[wb.SheetNames[0]]
          if (!ws) { setError(`"${file.name}" has no sheets.`); return }
          const rows = (XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as unknown[][])
            .map((r) => r.map((c) => (c == null ? "" : String(c).trim())))
            .filter((r) => r.some((c) => c !== ""))
          ingest(rows)
        } catch { setError(`Couldn't read "${file.name}". Try re-saving it, or use Paste.`) }
      }
      reader.onerror = () => setError(`Couldn't read "${file.name}". Try re-saving it, or use Paste.`)
      reader.readAsArrayBuffer(file)
      return
    }
    reader.onload = () => {
      const text = String(reader.result || "")
      if (!text.trim()) { setError(`"${file.name}" has no readable text.`); return }
      ingest(parseCSV(text))
    }
    reader.onerror = () => setError(`Couldn't read "${file.name}". Try re-exporting it, or use Paste.`)
    reader.readAsText(file)
  }

  const ingestPaste = () => {
    if (!paste.trim()) return
    ingest(parsePasted(paste))
  }


  const confirm = async () => {
    if (!records) return
    setSaving(true); setError(null)
    try {
      // Templates fill the blank and the artwork the row left empty. Applied here, once,
      // on the same resolver the preview used — so what was shown is what is created.
      const orders = templates ? applyTemplates(groupToOrders(records), templates).orders : groupToOrders(records)
      const existing = await getOrders().catch(() => [])
      const baseSeq = nextSellerSeq(existing ?? [])
      /* One seed per RUN, so two imports of the same sheet cannot mint the same line ids —
         line_id is identity, and a collision would attach the second import's files to the
         first import's lines. Order index and line index make it unique within the run. */
      const newIdSeed = Date.now().toString(36)
      let imported = 0
      // What the stitch-file column actually did. Reported rather than assumed: an
      // embroidered line that arrives without its file is the one failure here that looks
      // exactly like success until the floor picks the job up.
      let mfAttached = 0
      const mfFailed: string[] = []
      for (let i = 0; i < orders.length; i++) {
        const o = orders[i]
        /**
         * WE MINT THE LINE IDS, exactly as we mint the order id two lines down and for the
         * same stated reason: "trusting the response to echo an id back is a dependency this
         * doesn't need — we minted it."
         *
         * Here it is not a convenience, it is the whole requirement. A machine file has to
         * land on the UNIT ROW that asked for it, and `createOrder` returns `{ ok, id }` —
         * no line ids at all. Without minting, the only handle on a line after import is its
         * SKU, and two lines of the same SKU are different jobs (§5): keying on sku alone
         * would put one row's file on its sibling. The server honours a supplied lineId and
         * mints its own only when there isn't one.
         */
        const lineIds = o.items.map((_, li) => `FFL-${newIdSeed}${i.toString(36)}-${li.toString(36)}`)
        const items = o.items.map((it, li) => ({
          lineId: lineIds[li],
          name: it.name, sku: it.sku || undefined, img: it.img || undefined,
          qty: it.qty, unitPrice: it.unitPrice, color: it.color || undefined,
          size: it.size || undefined, printType: it.printType || undefined,
          // The blank is what production and pricing key on — dropping it here was why an
          // imported line arrived reading "not set up for production yet" even when the
          // CSV named one.
          blank: it.blank || undefined,
          // Artwork URL from the sheet — was parsed but never sent, so "Design File URL" did
          // nothing. Persisted to the line's design_src.
          designSrc: it.designUrl || undefined,
        }))
        /**
         * THE SALE, not a fulfilment estimate. `.total` added OUR shipping fee ladder to
         * the buyer's money and stored the sum as the order's total — two pots in one
         * number. `.subtotal` is Σ(Item Price × qty), which is exactly what the template
         * says that column is: "what the BUYER paid per unit … it does NOT set the
         * fulfilment charge". What we charge is quoted at submit.
         */
        const total = orderTotal(items.map((it) => ({ qty: it.qty ?? 1, unitPrice: it.unitPrice ?? 0, size: it.size })), []).subtotal
        const hasAddress = !!(o.address.street || o.address.city)
        // Shipping Service + Internal Notes were also parsed but dropped — keep them on the
        // order's meta so they survive the import instead of vanishing.
        const meta: Record<string, unknown> = {}
        if (o.service) meta.shippingService = o.service
        if (o.notes) meta.notes = o.notes
        if (o.orderNumber) meta.sourceOrderNumber = o.orderNumber
        // The sheet CARRIED a sale price, so this order's total is a recorded fact rather
        // than something the importer added up — which is what lets the order page show it
        // as "Customer paid" instead of "not recorded". No Item Price column, no flag.
        if (total > 0) meta.retail_set = true
        // Held rather than inlined: the design rows below are keyed on it, and trusting the
        // response to echo an id back is a dependency this doesn't need — we minted it.
        const newId = nextOrderId()
        const r = await createOrder({
          id: newId,
          seq: baseSeq + i,
          source: "manual",
          status: "new",
          customer: o.customer,
          address: hasAddress ? { ...o.address, ref: o.orderNumber } : undefined,
          store: o.store || undefined,
          total,
          items,
          meta: Object.keys(meta).length ? meta : undefined,
        })
        if (!r.error) {
          imported++
          /**
           * THE DESIGN ROW, which is the only place a POSITION can live.
           *
           * `designSrc` on the line is a string, and the boards read placement from
           * order_designs — so a templated line used to arrive with its artwork centred by
           * default on a design somebody had positioned by hand. Written after the order
           * exists, per line, and only for lines that actually took a template's artwork.
           *
           * Best-effort per line: a design that fails to attach must not undo an order that
           * was created, and the line still carries designSrc, so nothing is lost silently
           * except the placement it was going to inherit.
           */
          const orderId = newId || r.id || undefined
          if (orderId) {
            for (let li = 0; li < o.items.length; li++) {
              const it = o.items[li]
              /**
               * THE SELLER'S OWN STITCH FILE, ON THIS LINE.
               *
               * By REFERENCE — the browser sends an id and a line id, never the bytes. One
               * .EMB across forty lines is one object and forty rows pointing at it; posting
               * the file per line would be 320MB across the wire against a 60MB body limit.
               *
               * `lineIds[li]`, never the sku. This is the whole point of minting them: the
               * file has to reach the unit row that named it, and a sheet can legitimately
               * carry two lines of one SKU with two different files.
               *
               * Best-effort per line, like the design rows below: a file that fails to
               * attach must not undo an order that was created. It is COUNTED, though —
               * silently importing an embroidered line with no stitch file is a job the
               * floor cannot start, and the count is what the summary reports.
               */
              const mfRef = String(it.machineFileId || "").trim()
              const mf = mfRef ? machineFiles?.[mfRef] : null
              if (mfRef) {
                if (!mf) {
                  mfFailed.push(`${mfRef} — no such file in your library`)
                } else {
                  const a = await attachMachineFile(mf.id, { orderId, lineId: lineIds[li] }).catch((e: unknown) => ({
                    error: e instanceof Error ? e.message : "attach failed",
                  }))
                  if (a?.error) mfFailed.push(`${mfRef} on ${it.name || it.sku || "a line"} — ${a.error}`)
                  else mfAttached++
                }
              }
              const faces = (it.templateSides?.length
                ? it.templateSides
                : it.designUrl && (it.templatePos || it.templateId)
                  ? [{ side: "front", artwork: it.designUrl, pos: it.templatePos ?? null }]
                  : [])
              for (const f of faces) {
                if (!f.artwork) continue
                await postOrderDesign(orderId, {
                  sku: it.sku || it.name,
                  side: f.side || "front",
                  data: f.artwork,
                  name: it.templateId ? `Template ${it.templateId}` : undefined,
                  pos: (f.pos ?? undefined) as DesignPos | undefined,
                }).catch(() => {})
              }
              // The stitch file the template carried, filed against the same line — an
              // embroidery import that arrives without one is a job the floor cannot start.
              if (it.templateMachineFile?.data) {
                await uploadDesignFile({
                  designId: `TPL-${it.templateId || "file"}-${(it.sku || it.name).replace(/[^a-z0-9]+/gi, "-").slice(0, 30)}`,
                  orderId, sku: it.sku || it.name,
                  name: it.templateMachineFile.name, data: it.templateMachineFile.data,
                }).catch(() => {})
              }
            }
          }
        }
      }
      setDone({ imported, mfAttached, mfFailed })
      onImported?.(imported)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import orders</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-success">
              <CheckCircle size={30} weight="fill" />
            </span>
            <div className="font-semibold">Imported {done.imported} {done.imported === 1 ? "order" : "orders"}</div>
            <div className="text-sm text-muted-foreground">They’re in your orders queue now.</div>
            {/* WHAT THE STITCH-FILE COLUMN DID, said here rather than left to be discovered.
                An embroidered line that arrives without its file is the one failure on this
                screen that looks exactly like success until the floor picks the job up. */}
            {done.mfAttached > 0 && (
              <div className="text-sm text-muted-foreground">
                {done.mfAttached} machine {done.mfAttached === 1 ? "file" : "files"} attached, each to its own line.
              </div>
            )}
            {done.mfFailed.length > 0 && (
              <div className="w-full space-y-1 rounded-lg border border-alert/30 bg-alert/5 p-2.5 text-left">
                <div className="text-sm font-medium text-alert">
                  {done.mfFailed.length} machine {done.mfFailed.length === 1 ? "file" : "files"} not attached
                </div>
                {/* The server's own sentence, per line — it says WHICH file and WHY (unknown
                    reference, wrong print method, no such line). Collapsing them to a count
                    would throw away the only part anyone can act on. */}
                {done.mfFailed.map((m, i) => <div key={i} className="text-xs text-muted-foreground">{m}</div>)}
                <div className="text-xs text-muted-foreground">The orders imported. Attach these from the line’s designer.</div>
              </div>
            )}
            <Button className="w-full" onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-muted-foreground">Upload a CSV/XLSX, paste rows, or pull a Google Sheet. Common Shopify/Etsy column names are recognized automatically.</p>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => void downloadXlsxTemplate()}>
                <DownloadSimple size={14} weight="bold" /> Template (.xlsx)
              </Button>
            </div>

            {/* Columns reference, GROUPED into the same three bands the sheet uses and in the
                same order. Previously this was one undifferentiated run of 21 chips where the
                required ones were scattered through the optional ones, so working out what you
                actually had to fill meant reading every chip and its colour. Now the answer is
                the first block, and the rest can be ignored. */}
            <details className="rounded-xl border border-border bg-muted/20" open>
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
                Columns — <span className="text-muted-foreground">grouped the way you fill them</span>
              </summary>
              <div className="space-y-2.5 px-3 pb-3">
                {/* Bands are SUBJECTS now, and obligation rides on each chip. Grouping by
                    required-vs-optional read well here and badly in the sheet: it pushed
                    Ship Address 2 four columns from the street it continues. */}
                {columnBands().map((band) => (
                  <div key={`${band.group}-${band.start}`} className="space-y-1">
                    <div className="eg-label text-muted-foreground">
                      {GROUP_LABEL[band.group]}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {CSV_COLUMNS.slice(band.start, band.start + band.count).map((c) => {
                        const duty = dutyOf(c)
                        return (
                          <span
                            key={c.header}
                            title={`${DUTY_LABEL[duty]} — ${c.help}`}
                            className={
                              "inline-flex cursor-help items-center gap-1 rounded-md border px-2 py-0.5 text-xs " +
                              (duty === "required"
                                ? "border-primary/40 bg-primary/10 font-medium text-primary"
                                // A softer form of the required treatment — dashed outline,
                                // no fill — rather than a new hue. The status palette
                                // (emerald shipped, amber hold, …) carries meaning on the
                                // floor and another band colour here would crowd it.
                                : duty === "assigned"
                                  ? "border-dashed border-primary/50 bg-transparent font-medium text-primary"
                                  : duty === "oneOf"
                                    ? "border-amber-300 bg-amber-50 font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                                    : "border-border bg-background text-muted-foreground")
                            }
                          >
                            {c.header}
                            {duty === "required" && <span className="text-destructive">*</span>}
                            {duty === "assigned" && <span className="opacity-70">~</span>}
                            {duty === "oneOf" && <span className="opacity-70">†</span>}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ))}
                <p className="text-2xs text-muted-foreground">
                  <span className="font-medium text-primary">Blue *</span> = required on every row.
                  <span className="ml-1 font-medium text-primary">Dashed</span> = fill it, or we assign one.
                  Everything else is optional and can be completed after import.{" "}
                  <b>Order Number</b> is what groups lines — give every line of one order the same
                  number, or each line imports as a separate order. Hover any column for what it does.
                </p>
              </div>
            </details>

            <Tabs defaultValue="grid">
              {/* THREE WAYS IN, and the first one is OURS. "Sheet" used to mean a Google
                  Sheet a seller copied, filled and re-uploaded; it now means the sheet in
                  this app. The Google tab is gone from here — its server routes are
                  untouched, so nothing already in someone's Drive stops working. */}
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="grid">Sheet</TabsTrigger>
                <TabsTrigger value="file">File</TabsTrigger>
                <TabsTrigger value="paste">Paste</TabsTrigger>
              </TabsList>

              <TabsContent value="grid" className="mt-3">
                {/* A DOOR, NOT THE ROOM. The sheet is 21 columns wide and this dialog shows
                    four of them, so editing here meant scrolling a viewport at a spreadsheet.
                    It opens as a full page instead, in its own tab, so the seller keeps this
                    one — and the orders behind it — where they were. */}
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  {/* SAME WINDOW. A new tab would make "Back" mean "close this", which is a
                      different promise from the one a seller who came from Orders expects —
                      and it strands the dialog open behind a tab they can no longer see. */}
                  <Button onClick={() => { onOpenChange(false); router.push("/sheet") }}>
                    Open Sheet
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="file" className="mt-3">
                <label
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); takeFile(e.dataTransfer.files?.[0]) }}
                  className={"flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center transition-colors " + (dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-accent")}
                >
                  <UploadSimple size={24} className="text-muted-foreground" />
                  <span className="text-sm font-medium">Drop a .csv, .xlsx or .xls — or <span className="text-primary">browse</span></span>
                  <span className="text-xs text-muted-foreground">All three work here · uses the egful template format</span>
                  <input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => takeFile(e.target.files?.[0])} />
                </label>
              </TabsContent>

              <TabsContent value="paste" className="mt-3 space-y-2">
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={6}
                  placeholder={"Paste rows copied from a spreadsheet (tab or comma separated), including the header row."}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 tabular-nums text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <Button variant="outline" size="sm" onClick={ingestPaste} disabled={!paste.trim()}>Preview rows</Button>
              </TabsContent>

            </Tabs>

            {notice && (
              <div className="mt-3 rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                {notice}
                {/* Manual escape hatch when the clipboard is unavailable — a dead end here means
                    building 22 columns by hand, which is where import failures start. */}
                {copyFallback && (
                  <textarea
                    readOnly
                    onFocus={(e) => e.currentTarget.select()}
                    value={copyFallback}
                    className="mt-2 h-16 w-full resize-none rounded-md border border-border bg-background p-2 tabular-nums text-2xs text-foreground"
                  />
                )}
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0" /> {error}
              </div>
            )}

            {records && (
              <div className="rounded-xl border border-border">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 text-sm">
                  <span className="inline-flex items-center gap-1.5"><Table size={14} className="text-muted-foreground" /> {summary.orders} {summary.orders === 1 ? "order" : "orders"}</span>
                  <span className="inline-flex items-center gap-1.5 text-success"><CheckCircle size={14} weight="fill" /> {summary.valid} valid</span>
                  {summary.invalid > 0 && <span className="inline-flex items-center gap-1.5 text-amber-600"><WarningCircle size={14} weight="fill" /> {summary.invalid} skipped</span>}
                </div>
                {/* Stated BEFORE the import, because afterwards the only fix is deleting
                    orders. A blank Order Number is allowed — it just can't be grouped, so
                    the lines can't be recognised as belonging together. */}
                {summary.ungrouped > 0 && (
                  <div className="flex items-start gap-2 border-b border-border bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                    <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
                    <span>
                      {summary.ungrouped} {summary.ungrouped === 1 ? "row has" : "rows have"} no Order Number — each imports as
                      its OWN order under a platform number (FF-…). If any of them are lines of the
                      same order, give them a shared Order Number first.
                    </span>
                  </div>
                )}
                {/* WHAT THE TEMPLATE COLUMN WILL DO. The column used to be parsed and
                    discarded, so the honest thing now is to say what it applied — and to
                    name anything it couldn't find while the sheet is still open and a typo
                    is one edit away. */}
                {templateOutcome && (
                  <div className={"flex items-start gap-2 border-b border-border px-4 py-2 text-xs "
                    + (templateOutcome.unmatched.length || templateOutcome.ambiguous.length || templatesFailed
                      ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                      : "text-muted-foreground")}>
                    {templateOutcome.unmatched.length || templateOutcome.ambiguous.length || templatesFailed
                      ? <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
                      : <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0 text-success" />}
                    <span>
                      {templatesFailed
                        ? "Your saved templates couldn't be loaded, so the Template ID column won't apply anything — the blank and artwork will be empty on those lines."
                        : <>
                            {templateOutcome.applied} of {templateOutcome.typed} {templateOutcome.typed === 1 ? "line" : "lines"} will take
                            their blank and artwork from a saved template.
                            {templateOutcome.unmatched.length > 0 && <> No template matches <span className="tabular-nums">{templateOutcome.unmatched.join(", ")}</span> — check the number on the template card.</>}
                            {templateOutcome.ambiguous.length > 0 && <> More than one template is called <span className="tabular-nums">{templateOutcome.ambiguous.join(", ")}</span>, so those lines were left alone — use the TPL- number instead.</>}
                          </>}
                    </span>
                  </div>
                )}
                {/* THE SAME BAR FOR THE STITCH FILES, and it earns its own row rather than
                    joining the template one: they resolve against different libraries and
                    fail for different reasons, and one sentence covering both would have to
                    be vague about which column to go and fix. */}
                {machineOutcome && (
                  <div className={"flex items-start gap-2 border-b border-border px-4 py-2 text-xs "
                    + (machineOutcome.unknown.length || machineOutcome.wrongMethod.length || machineOutcome.failed
                      ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                      : "text-muted-foreground")}>
                    {machineOutcome.unknown.length || machineOutcome.wrongMethod.length || machineOutcome.failed
                      ? <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
                      : <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0 text-success" />}
                    <span>
                      {machineOutcome.failed
                        ? "Your machine files couldn't be looked up, so the Machine File ID column won't attach anything — those lines will arrive without a stitch file."
                        : <>
                            {machineOutcome.ok} of {machineOutcome.typed} {machineOutcome.typed === 1 ? "line" : "lines"} will get
                            their stitch file, attached to that line only.
                            {machineOutcome.unknown.length > 0 && <> Nothing in your library matches <span className="tabular-nums">{machineOutcome.unknown.join(", ")}</span> — check the reference on the file&rsquo;s card in Design Lab.</>}
                            {/* Named separately from "unknown" because the fix is different:
                                the reference is right and the ROW is wrong. */}
                            {machineOutcome.wrongMethod.length > 0 && <> <span className="tabular-nums">{machineOutcome.wrongMethod.join(", ")}</span> {machineOutcome.wrongMethod.length === 1 ? "is on a line" : "are on lines"} that {machineOutcome.wrongMethod.length === 1 ? "isn&rsquo;t" : "aren&rsquo;t"} embroidered — a stitch file has no machine to run there, so it won&rsquo;t be attached.</>}
                          </>}
                    </span>
                  </div>
                )}
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-card border-b border-border text-left eg-label text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Order</th>
                        <th className="px-3 py-2">Ship to</th>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={r._rowNum} className="border-t border-border">
                          <td className="px-3 py-1.5 text-muted-foreground">{r._rowNum}</td>
                          {/* "assigned" rather than an em-dash: the row isn't missing
                              something, it's getting a platform number instead. */}
                          <td className="px-3 py-1.5 tabular-nums text-xs">
                            {r.order_number || <span className="not-italic text-muted-foreground">assigned</span>}
                          </td>
                          <td className="max-w-[140px] truncate px-3 py-1.5">{r.ship_name || "—"}</td>
                          <td className="max-w-[160px] truncate px-3 py-1.5 text-muted-foreground">{r.product_title || r.item_name || r.item_sku || "—"}</td>
                          <td className="px-3 py-1.5">
                            {r._valid ? (
                              <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle size={13} weight="fill" /> OK</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-600" title={r._errors}><WarningCircle size={13} weight="fill" /> {r._errors}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={confirm} disabled={saving || !summary.valid}>
                {saving ? "Importing…" : summary.valid ? `Import ${summary.orders} ${summary.orders === 1 ? "order" : "orders"}` : "Import"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
