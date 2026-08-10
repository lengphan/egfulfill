"use client"

import { useEffect, useMemo, useState } from "react"
import { UploadSimple, DownloadSimple, CheckCircle, WarningCircle, Table, CircleNotch, Copy } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  parseCSV,
  parsePasted,
  rowsToRecords,
  groupToOrders,
  applyTemplates,
  type ImportTemplate,
  CSV_COLUMNS,
  TEMPLATE_TSV,
  COLUMN_OPTIONS,
  GROUP_LABEL,
  DUTY_LABEL,
  DUTY_MARK,
  SECTION_FILL,
  DUTY_FILL,
  dutyOf,
  columnBands,
  type ImportRecord,
} from "@/lib/order-import"
import { createOrder, getOrders, getSheetsConfig, getSheetRows, createSheet, getTemplates } from "@/lib/api"
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

  // Row 2 — headers carrying their obligation mark, filled by obligation.
  ws.addRow(CSV_COLUMNS.map((c) => c.header + DUTY_MARK[dutyOf(c)]))
  CSV_COLUMNS.forEach((c, i) => {
    const duty = dutyOf(c)
    const cell = ws.getCell(2, i + 1)
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DUTY_FILL[duty] } }
    // Required reads in red as well as being filled and asterisked — colour alone fails a
    // colour-blind filler, and an asterisk alone is easy to miss across 21 columns.
    cell.font = { bold: true, color: { argb: duty === "required" ? "FF9E1721" : "FF1A1A1A" } }
  })

  ws.views = [{ state: "frozen", ySplit: 2 }]
  ws.columns.forEach((col, i) => { col.width = Math.min(28, Math.max(13, CSV_COLUMNS[i].header.length + 4)) })

  // Real dropdowns over the data rows. NOT strict (showErrorMessage false): a rejected paste
  // is worse than an odd value, and the importer normalises these anyway — the same call the
  // Google Sheet makes. Excel caps an inline list at 255 characters; every list here is well
  // under (US states, the longest, is ~152).
  const DATA_ROWS = 500
  Object.entries(COLUMN_OPTIONS).forEach(([key, values]) => {
    const idx = CSV_COLUMNS.findIndex((c) => c.key === key)
    if (idx < 0) return
    const letter = ws.getColumn(idx + 1).letter
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
  a.download = "EGFULFILL Order Import.xlsx"
  a.click()
  URL.revokeObjectURL(url)
}

export function ImportOrdersDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onImported?: (count: number) => void
}) {
  const [records, setRecords] = useState<ImportRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [paste, setPaste] = useState("")
  const [sheetUrl, setSheetUrl] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  // Header row shown for manual copying when the clipboard write did not happen.
  const [copyFallback, setCopyFallback] = useState<string | null>(null)
  const [sheetLoading, setSheetLoading] = useState(false)
  const [sheetsEnabled, setSheetsEnabled] = useState(false)
  // Whether the server can build a formatted sheet for us (service account present), vs
  // only being able to READ one — which decides which of the two button flows we offer.
  const [sheetsCanCreate, setSheetsCanCreate] = useState(false)
  // The service-account address a seller must share their OWN sheet with. Server-supplied
  // (it lives in an env var), so the dialog can print the thing to paste instead of naming
  // a config key nobody outside the server can read.
  const [shareWith, setShareWith] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<{ imported: number } | null>(null)
  // The seller's saved templates, fetched ONLY when a parsed sheet actually names one.
  // Composites are base64 images, so this is not a payload to pull on the off-chance.
  const [templates, setTemplates] = useState<ImportTemplate[] | null>(null)
  const [templatesFailed, setTemplatesFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    // Reset per open, and see whether Google Sheets is configured server-side.
    const id = setTimeout(() => {
      setRecords(null); setError(null); setPaste(""); setSheetUrl(""); setDone(null)
      setNotice(null); setCopyFallback(null); setTemplates(null); setTemplatesFailed(false)
      setShareCopied(false)
      getSheetsConfig()
        .then((c) => { setSheetsEnabled(!!c.enabled); setSheetsCanCreate(!!c.canCreate); setShareWith(c.shareWith || null) })
        .catch(() => { setSheetsEnabled(false); setSheetsCanCreate(false); setShareWith(null) })
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
    // Only now do we know whether templates matter. Fetching them up front would pull
    // every composite (base64 images) for the majority of imports that name none.
    if (records.some((r) => String(r.template_id || "").trim())) {
      setTemplatesFailed(false)
      getTemplates()
        .then((rows) => setTemplates((rows ?? []).map((t) => ({
          id: String(t.id),
          seq: t.seq ?? null,
          name: t.name ?? null,
          blankSku: String((t.data as { blankSku?: string } | null)?.blankSku ?? ""),
          composite: t.composite ?? "",
        }))))
        // Not silent. A template that can't be looked up means the blank and the artwork
        // it promised won't be applied, and the import would otherwise look complete.
        .catch(() => { setTemplates([]); setTemplatesFailed(true) })
    } else {
      setTemplates(null)
    }
  }

  /**
   * What the Template ID column will actually do, resolved for the preview.
   *
   * Computed BEFORE the import rather than reported after it: an unrecognised id means a
   * line arrives with no blank and no artwork, and the moment to fix a typo is while the
   * sheet is still open.
   */
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

  /**
   * Get the seller a Google Sheet with our template already in it.
   *
   * PREFERRED: the server builds a real sheet — banded header, colours, frozen rows,
   * dropdowns — and shares it link-editable. That is the only path that can carry
   * formatting and data validation, since Google has no "create a sheet from this CSV" URL
   * and a clipboard paste carries text and nothing else.
   *
   * FALLBACK (no service account configured): the old open-blank-and-paste flow. It gives
   * plain headers in the right order, which still imports correctly — just without the
   * colour bands and dropdowns.
   */
  const makeSheetCopy = async () => {
    setError(null); setCopyFallback(null)
    if (sheetsCanCreate) {
      setCreating(true)
      try {
        const r = await createSheet()
        if (r.url) {
          window.open(r.url, "_blank", "noopener")
          setSheetUrl(r.url)
          // The sheet is created by one call and FORMATTED by a second. The second can fail
          // on its own — leaving a real, usable sheet with no colours, merges or dropdowns.
          // Saying "coloured, with dropdowns" regardless is how "my dropdowns are missing"
          // became unanswerable: the app asserted a state it hadn't checked.
          if (r.formattingError) {
            setNotice(null)
            setError(`Sheet created, but Google rejected the formatting — ${r.formattingError}. The columns are correct and it will still import; the colours and dropdowns are missing.`)
          } else {
            setNotice("Your sheet is open in a new tab — required columns are blue, optional grey, with dropdowns where we know the options. Fill it in, then press Load.")
          }
          return
        }
        // Fall through to the clipboard path rather than dead-ending: a sheet they can
        // paste into beats an error message.
        setError(r.error || "Couldn't create the sheet — falling back to a blank one.")
      } catch (e) {
        // SURFACE THE REAL REASON. api() THROWS on any non-2xx, with `message` set to the
        // server's own `error` field — so a 502 carrying "Could not create sheet: Google
        // Drive API has not been used in project …" arrived here and was thrown away,
        // reported as "couldn't reach the server". That is the wrong diagnosis and an
        // unactionable one: the server was reached, Google refused, and the fix is one
        // click in the Cloud Console. Only a genuine transport failure has no message.
        const msg = e instanceof Error ? e.message.trim() : ""
        setError(msg
          ? `Couldn't create the sheet — ${msg}. Falling back to a blank one.`
          : "Couldn't reach the server to create a sheet — falling back to a blank one.")
      } finally {
        setCreating(false)
      }
    }
    // Whether the copy ACTUALLY happened decides what we tell them. navigator.clipboard is
    // undefined outside a secure context, and `await undefined` resolves happily — so the old
    // optional-chained call could no-op without throwing, and we would still promise the
    // template was on their clipboard. They then opened a blank sheet with nothing to paste,
    // which is exactly the "Google Sheet import is blank" report.
    let copied = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(TEMPLATE_TSV)
        copied = true
      }
    } catch { copied = false }
    setCopyFallback(copied ? null : TEMPLATE_TSV)
    window.open("https://sheets.new", "_blank", "noopener")
    setNotice(
      copied
        ? "A blank Google Sheet is opening — the header row is on your clipboard. Click cell A1 and press ⌘V / Ctrl+V."
        : "A blank Google Sheet is opening, but this browser blocked the clipboard. Copy the header row below and paste it into cell A1."
    )
  }

  const loadSheet = async () => {
    if (!sheetUrl.trim()) return
    setSheetLoading(true); setError(null)
    try {
      const r = await getSheetRows(sheetUrl.trim())
      if (r.error) throw new Error(r.error)
      if (!r.rows || r.rows.length < 2) throw new Error("That tab has no order rows — needs a header plus at least one order.")
      ingest(r.rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that sheet.")
    } finally {
      setSheetLoading(false)
    }
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
      let imported = 0
      for (let i = 0; i < orders.length; i++) {
        const o = orders[i]
        const items = o.items.map((it) => ({
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
        const total = orderTotal(items.map((it) => ({ qty: it.qty ?? 1, unitPrice: it.unitPrice ?? 0, size: it.size })), []).total
        const hasAddress = !!(o.address.street || o.address.city)
        // Shipping Service + Internal Notes were also parsed but dropped — keep them on the
        // order's meta so they survive the import instead of vanishing.
        const meta: Record<string, unknown> = {}
        if (o.service) meta.shippingService = o.service
        if (o.notes) meta.notes = o.notes
        if (o.orderNumber) meta.sourceOrderNumber = o.orderNumber
        const r = await createOrder({
          id: nextOrderId(),
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
        if (!r.error) imported++
      }
      setDone({ imported })
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
                    <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                  <span className="ml-1 font-medium text-primary">Dashed ~</span> = fill it, or we assign one.
                  Everything else is optional and can be completed after import.{" "}
                  <b>Order Number</b> is what groups lines — give every line of one order the same
                  number, or each line imports as a separate order. Hover any column for what it does.
                </p>
              </div>
            </details>

            <Tabs defaultValue="file">
              <TabsList className={sheetsEnabled ? "grid w-full grid-cols-3" : "grid w-full grid-cols-2"}>
                <TabsTrigger value="file">File</TabsTrigger>
                <TabsTrigger value="paste">Paste</TabsTrigger>
                {sheetsEnabled && <TabsTrigger value="sheet">Sheet</TabsTrigger>}
              </TabsList>

              <TabsContent value="file" className="mt-3">
                <label
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); takeFile(e.dataTransfer.files?.[0]) }}
                  className={"flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center transition-colors " + (dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-accent")}
                >
                  <UploadSimple size={24} className="text-muted-foreground" />
                  <span className="text-sm font-medium">Drop a .csv, .xlsx or .xls — or <span className="text-primary">browse</span></span>
                  <span className="text-xs text-muted-foreground">All three work here · uses the egfulfill template format</span>
                  <input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => takeFile(e.target.files?.[0])} />
                </label>
              </TabsContent>

              <TabsContent value="paste" className="mt-3 space-y-2">
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={6}
                  placeholder={"Paste rows copied from a spreadsheet (tab or comma separated), including the header row."}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <Button variant="outline" size="sm" onClick={ingestPaste} disabled={!paste.trim()}>Preview rows</Button>
              </TabsContent>

              {sheetsEnabled && (
                <TabsContent value="sheet" className="mt-3 space-y-2">
                  <div className="flex gap-2">
                    <Input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
                    <Button variant="outline" onClick={loadSheet} disabled={sheetLoading || !sheetUrl.trim()}>
                      {sheetLoading ? <CircleNotch size={15} className="animate-spin" /> : "Load"}
                    </Button>
                  </div>
                  {/* Start from a correctly-shaped sheet rather than describing the shape.
                      "Make a copy" hands them a Google Sheet with our exact headers, which
                      removes the whole class of import failures that begin with a column
                      named something we don't recognise. */}
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
                    <span className="text-xs text-muted-foreground">No sheet yet?</span>
                    <Button variant="outline" size="sm" onClick={makeSheetCopy} disabled={creating}>
                      {creating
                        ? <><CircleNotch size={13} className="animate-spin" /> Building your sheet…</>
                        : <><Table size={13} weight="bold" /> {sheetsCanCreate ? "Create my order sheet" : "Make a copy in Google Sheets"}</>}
                    </Button>
                    <span className="text-2xs text-muted-foreground">
                      {sheetsCanCreate
                        ? "opens a formatted sheet — required columns blue, optional grey, dropdowns filled in"
                        : "opens a blank sheet with the header row on your clipboard"}
                    </span>
                  </div>
                  {sheetsCanCreate && (
                    <p className="text-xs text-muted-foreground">
                      A sheet we make for you is already shared and its link is filled in above — fill it in, then press Load.
                    </p>
                  )}

                  {/* BRINGING YOUR OWN SHEET.
                      A sheet we create is already shared with us; one the seller made is not,
                      and Google answers that with a 403 that says nothing about what to do.
                      The instruction used to be "share it as anyone-with-the-link" — which is
                      both the wrong path now (the server reads as the service account) and the
                      one that publishes buyer names and home addresses to anyone holding the
                      URL. So: the actual address, one click to copy it, and the two settings
                      that trip people up. */}
                  {shareWith && (
                    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2.5">
                      <div className="text-xs font-medium">Using a sheet you already have? Share it with us first.</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-2xs" title={shareWith}>
                          {shareWith}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard?.writeText(shareWith)
                              .then(() => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2000) })
                              // A browser that blocks the clipboard must not leave a dead
                              // button — the address is on screen and selectable either way.
                              .catch(() => setShareCopied(false))
                          }}
                        >
                          {shareCopied ? <><CheckCircle size={13} weight="fill" /> Copied</> : <><Copy size={13} weight="bold" /> Copy</>}
                        </Button>
                      </div>
                      <ol className="list-inside list-decimal space-y-0.5 text-2xs text-muted-foreground">
                        <li>In your sheet: <span className="font-medium text-foreground">Share</span> → paste that address</li>
                        <li>Leave it on <span className="font-medium text-foreground">Viewer</span>, and untick <span className="font-medium text-foreground">Notify people</span> — nobody reads that inbox</li>
                        <li>Paste the sheet link above and press Load</li>
                      </ol>
                      <p className="text-2xs text-muted-foreground">
                        Your sheet stays private — only this address gains access, so buyer names and
                        addresses are never exposed to anyone holding the link.
                      </p>
                    </div>
                  )}
                  {/* The link-shared fallback, and ONLY when there is no service account to
                      share with — it is the path that exposes buyer addresses to anyone
                      holding the URL, so it must never be the advice while the private one
                      is available. */}
                  {!shareWith && !sheetsCanCreate && (
                    <p className="text-xs text-muted-foreground">
                      Then share it as “anyone with the link can view” and paste the link above.
                    </p>
                  )}
                </TabsContent>
              )}
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
                    className="mt-2 h-16 w-full resize-none rounded-md border border-border bg-background p-2 font-mono text-2xs text-foreground"
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
                            {templateOutcome.unmatched.length > 0 && <> No template matches <span className="font-mono">{templateOutcome.unmatched.join(", ")}</span> — check the number on the template card.</>}
                            {templateOutcome.ambiguous.length > 0 && <> More than one template is called <span className="font-mono">{templateOutcome.ambiguous.join(", ")}</span>, so those lines were left alone — use the TPL- number instead.</>}
                          </>}
                    </span>
                  </div>
                )}
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Order</th>
                        <th className="px-3 py-2 font-medium">Ship to</th>
                        <th className="px-3 py-2 font-medium">Item</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={r._rowNum} className="border-t border-border">
                          <td className="px-3 py-1.5 text-muted-foreground">{r._rowNum}</td>
                          {/* "assigned" rather than an em-dash: the row isn't missing
                              something, it's getting a platform number instead. */}
                          <td className="px-3 py-1.5 font-mono text-xs">
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
