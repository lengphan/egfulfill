"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { UploadSimple, DownloadSimple, CheckCircle, WarningCircle, Table, CircleNotch } from "@phosphor-icons/react"
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
import { createOrder, getOrders, getSheetsConfig, setSheetTemplate, formatSheetTemplate, getTemplates } from "@/lib/api"
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
  const [notice, setNotice] = useState<string | null>(null)
  // Header row shown for manual copying when the clipboard write did not happen.
  const [copyFallback, setCopyFallback] = useState<string | null>(null)
  const [sheetsEnabled, setSheetsEnabled] = useState(false)
  // The config call FAILED, as opposed to answering "not configured". A two-second API
  // blip during a deploy used to hide the Sheet tab outright, which reads as the feature
  // having been deleted — CLAUDE.md's rule that a broken thing must never look identical
  // to an absent one. The tab stays, and says which it is.
  const [configErr, setConfigErr] = useState(false)
  // Google's force-a-copy URL for our master template, and (admins only) whether one has
  // been configured yet. Server-supplied: the master lives in a setting, not in the bundle.
  const [copyUrl, setCopyUrl] = useState("")
  const [needsTemplate, setNeedsTemplate] = useState(false)
  const [isTemplateAdmin, setIsTemplateAdmin] = useState(false)
  const [formatting, setFormatting] = useState(false)
  const [tplInput, setTplInput] = useState("")
  const [tplSaving, setTplSaving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<{ imported: number } | null>(null)
  // The seller's saved templates, fetched ONLY when a parsed sheet actually names one.
  // Composites are base64 images, so this is not a payload to pull on the off-chance.
  const [templates, setTemplates] = useState<ImportTemplate[] | null>(null)
  const [templatesFailed, setTemplatesFailed] = useState(false)

  const loadSheetsConfig = useCallback(() => {
    setConfigErr(false)
    return getSheetsConfig()
      .then((c) => {
        setSheetsEnabled(!!c.enabled)
        setCopyUrl(c.copyUrl || ""); setNeedsTemplate(!!c.needsTemplate); setIsTemplateAdmin(!!c.isTemplateAdmin)
      })
      .catch(() => { setSheetsEnabled(false); setCopyUrl(""); setNeedsTemplate(false); setIsTemplateAdmin(false); setConfigErr(true) })
  }, [])

  useEffect(() => {
    if (!open) return
    // Reset per open, and see whether Google Sheets is configured server-side.
    const id = setTimeout(() => {
      setRecords(null); setError(null); setPaste(""); setDone(null)
      setNotice(null); setCopyFallback(null); setTemplates(null); setTemplatesFailed(false)
      setTplInput("")
      loadSheetsConfig()
    }, 0)
    return () => clearTimeout(id)
  }, [open, loadSheetsConfig])

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
   * ONE MECHANISM NOW: Google's own /copy URL for our master template. It opens Google's
   * Make-a-copy dialog and the copy lands in the SELLER's Drive, owned by them, with every
   * colour band, frozen row and dropdown intact. Nothing is shared with us and no
   * permission is involved, which is what makes it work at all.
   *
   * The two paths this replaces both dead-ended:
   * - Server-side create via the service account. Verified against the live credential on
   *   2026-08-10: POST /v4/spreadsheets → 403 PERMISSION_DENIED, because a standalone
   *   service account has no Drive storage to create a file in. Not fixable in the Cloud
   *   Console; it needs domain-wide delegation this deployment doesn't have.
   * - Open sheets.new and paste the header row off the clipboard. It carries text and
   *   nothing else — no colours, no dropdowns — and silently gives you nothing at all
   *   wherever the clipboard is blocked. That is the "blank Google Sheet" report.
   *
   * With no master configured there is no third guess: the .xlsx download is offered
   * instead, which is a real formatted template and drops straight onto the File tab.
   */
  const makeSheetCopy = () => {
    if (!copyUrl) return
    setError(null); setCopyFallback(null)
    window.open(copyUrl, "_blank", "noopener")
    setNotice("Google is asking you to make your own copy — click Make a copy. Fill it in, then File → Download → .xlsx or .csv, and drop that file on the File tab here.")
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
                  <span className="ml-1 font-medium text-primary">Dashed</span> = fill it, or we assign one.
                  Everything else is optional and can be completed after import.{" "}
                  <b>Order Number</b> is what groups lines — give every line of one order the same
                  number, or each line imports as a separate order. Hover any column for what it does.
                </p>
              </div>
            </details>

            <Tabs defaultValue="file">
              <TabsList className={sheetsEnabled || configErr ? "grid w-full grid-cols-3" : "grid w-full grid-cols-2"}>
                <TabsTrigger value="file">File</TabsTrigger>
                <TabsTrigger value="paste">Paste</TabsTrigger>
                {(sheetsEnabled || configErr) && <TabsTrigger value="sheet">Sheet</TabsTrigger>}
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

              {(sheetsEnabled || configErr) && (
                <TabsContent value="sheet" className="mt-3 space-y-3">
                  {/* COPY → FILL → DOWNLOAD → DROP.
                      One path, and the seller's Google account does all the work Google will
                      only let an account do. They copy our master template, fill their copy,
                      export it, and drop the file on the File tab — the same drop zone that
                      already accepts .csv/.xlsx, so nothing new has to parse it.
                      There is deliberately no "paste your sheet's link" field any more: that
                      route needs the sheet shared with our service account, which is a step
                      no seller could complete and the source of the 403s. */}
                  {configErr ? (
                    /* Couldn't ask the server. Say so — and offer the retry — rather than
                       showing the not-configured copy, which would blame the setup for what
                       is actually a dropped request. */
                    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-4">
                      <div className="text-xs font-medium">Couldn&apos;t check the Google Sheets setup.</div>
                      <p className="text-xs text-muted-foreground">
                        The server didn&apos;t answer — usually a few seconds during a deploy. Nothing has
                        changed; try again, or use the File tab meanwhile.
                      </p>
                      <Button variant="outline" size="sm" onClick={() => loadSheetsConfig()}>Try again</Button>
                    </div>
                  ) : copyUrl ? (
                    <>
                      <div className="rounded-xl border border-border bg-muted/30 p-4">
                        <Button onClick={makeSheetCopy}>
                          <Table size={15} weight="bold" /> Make a copy in Google Sheets
                        </Button>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Opens your own copy in your Drive — every column already in place, required
                          ones blue, dropdowns filled in. It is yours; nothing is shared with us.
                        </p>
                      </div>
                      <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
                        <li>Click above, then <span className="font-medium text-foreground">Make a copy</span> in Google&apos;s dialog</li>
                        <li>Fill in your orders — one line per item, same Order Number groups them</li>
                        <li>In the sheet: <span className="font-medium text-foreground">File → Download → .xlsx</span> (or .csv)</li>
                        <li>Drop that file on the <span className="font-medium text-foreground">File</span> tab here</li>
                      </ol>
                    </>
                  ) : (
                    /* No master configured. Rather than a broken button, the seller gets the
                       .xlsx — a genuinely formatted template with the same columns, fills and
                       dropdowns, which lands on the File tab without a round trip. */
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <div className="text-xs font-medium">The Google Sheets template isn&apos;t set up yet.</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Use the <span className="font-medium text-foreground">Template (.xlsx)</span> button at the top — same
                        columns, same colours and dropdowns. Fill it in and drop it on the File tab.
                      </p>
                    </div>
                  )}

                  {/* ADMIN ONLY, and shown in the dialog rather than buried in Settings: this
                      is the screen where its absence is felt, and the master has to be made by
                      a real Google account — our service account gets 403 PERMISSION_DENIED
                      creating a spreadsheet, since it has no Drive of its own. */}
                  {/* ADMIN, master configured: re-apply our formatting to it.
                      Google's .xlsx conversion does not carry data validation across, so a
                      master made that way has the right columns and NO dropdowns. This
                      writes them (and the bands, widths and header rows) straight into the
                      sheet via the Sheets API — a batchUpdate on an existing file, which the
                      service account CAN do; only creating a file is refused. It is also how
                      the master picks up a column rename without being rebuilt. */}
                  {isTemplateAdmin && copyUrl && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
                      <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Admin</span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={formatting}
                        onClick={async () => {
                          setFormatting(true); setError(null); setNotice(null)
                          try {
                            const r = await formatSheetTemplate()
                            setNotice(`Master template formatted — dropdowns written on ${(r.dropdowns || []).join(", ") || "the option columns"}. New copies get them; copies already made don't.`)
                          } catch (e) {
                            setError(e instanceof Error && e.message ? e.message : "Couldn't format the master template.")
                          } finally { setFormatting(false) }
                        }}
                      >
                        {formatting ? <><CircleNotch size={13} className="animate-spin" /> Formatting…</> : "Apply colours + dropdowns to master"}
                      </Button>
                      <a href={copyUrl.replace(/\/copy$/, "/edit")} target="_blank" rel="noopener noreferrer" className="text-2xs text-primary hover:underline">
                        Open master
                      </a>
                    </div>
                  )}

                  {needsTemplate && (
                    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                      <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">Admin · one-time setup</div>
                      <ol className="list-inside list-decimal space-y-0.5 text-2xs text-amber-800/90 dark:text-amber-300/90">
                        <li>Download <span className="font-medium">Template (.xlsx)</span> above</li>
                        <li>Upload it to your Google Drive, open it, then <span className="font-medium">File → Save as Google Sheets</span></li>
                        <li>Share that sheet <span className="font-medium">anyone with the link → Viewer</span>, and paste its link here</li>
                      </ol>
                      <div className="flex gap-2">
                        <Input value={tplInput} onChange={(e) => setTplInput(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
                        <Button
                          variant="outline"
                          disabled={tplSaving || !tplInput.trim()}
                          onClick={async () => {
                            setTplSaving(true); setError(null)
                            try {
                              const r = await setSheetTemplate(tplInput.trim())
                              setCopyUrl(r.copyUrl || "")
                              setNeedsTemplate(!r.copyUrl)
                              setNotice("Template saved — sellers now get a Make a copy button here.")
                            } catch (e) {
                              setError(e instanceof Error && e.message ? e.message : "Couldn't save the template link.")
                            } finally { setTplSaving(false) }
                          }}
                        >
                          {tplSaving ? <CircleNotch size={15} className="animate-spin" /> : "Save"}
                        </Button>
                      </div>
                    </div>
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
