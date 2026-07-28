"use client"

import { useEffect, useMemo, useState } from "react"
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
  CSV_TEMPLATE,
  CSV_COLUMNS,
  TEMPLATE_HEADERS,
  type ImportRecord,
} from "@/lib/order-import"
import { createOrder, getOrders, getSheetsConfig, getSheetRows } from "@/lib/api"
import { nextOrderId, nextSellerSeq } from "@/lib/order-id"
import { orderTotal } from "@/lib/pricing"

// Build + download the .xlsx template. Lazy-imports the (already-installed) xlsx lib so it
// never weighs down the app's main bundle — only loads when someone clicks the button.
async function downloadXlsxTemplate() {
  const XLSX = await import("xlsx")
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS])
  ws["!cols"] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Orders")
  XLSX.writeFile(wb, "EGFULFILL Order Import.xlsx")
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
  const [sheetLoading, setSheetLoading] = useState(false)
  const [sheetsEnabled, setSheetsEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<{ imported: number } | null>(null)

  useEffect(() => {
    if (!open) return
    // Reset per open, and see whether Google Sheets is configured server-side.
    const id = setTimeout(() => {
      setRecords(null); setError(null); setPaste(""); setSheetUrl(""); setDone(null)
      getSheetsConfig().then((c) => setSheetsEnabled(!!c.enabled)).catch(() => setSheetsEnabled(false))
    }, 0)
    return () => clearTimeout(id)
  }, [open])

  const summary = useMemo(() => {
    const list = records ?? []
    const valid = list.filter((r) => r._valid).length
    return { total: list.length, valid, invalid: list.length - valid, orders: valid ? groupToOrders(list).length : 0 }
  }, [records])

  const ingest = (rows: string[][]) => {
    const { records, error } = rowsToRecords(rows)
    if (error) { setError(error); setRecords(null); return }
    setError(null)
    setRecords(records)
  }

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
   * Open a new Google Sheet pre-filled with our template.
   *
   * Google has no "create a sheet from this CSV" URL, so this uses the documented
   * create-and-import flow: a blank sheet opens and the template lands on the clipboard
   * for a single paste. Better than telling someone to build the columns themselves,
   * which is where most import failures start.
   */
  const makeSheetCopy = async () => {
    try { await navigator.clipboard?.writeText(CSV_TEMPLATE.replace(/,/g, "\t")) } catch { /* clipboard may be blocked */ }
    window.open("https://sheets.new", "_blank", "noopener")
    setError(null)
    setNotice("A blank Google Sheet is opening — the template is on your clipboard, so press ⌘V / Ctrl+V in cell A1.")
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
      const orders = groupToOrders(records)
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
            <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
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

            {/* Columns reference — REQUIRED are solid, OPTIONAL are highlighted amber so a filler
                sees at a glance what they can skip. Hover any chip for what it does. */}
            <details className="rounded-xl border border-border bg-muted/20">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
                Columns — <span className="text-muted-foreground">what’s required vs optional</span>
              </summary>
              <div className="space-y-2 px-3 pb-3">
                <div className="flex flex-wrap gap-1.5">
                  {CSV_COLUMNS.map((c) => (
                    <span
                      key={c.header}
                      title={c.help}
                      className={
                        "inline-flex cursor-help items-center gap-1 rounded-md border px-2 py-0.5 text-xs " +
                        (c.required
                          ? "border-border bg-foreground/5 font-medium text-foreground"
                          : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300")
                      }
                    >
                      {c.header}
                      {c.required && <span className="text-destructive">*</span>}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">Bold + <span className="text-destructive">*</span></span> = required.
                  <span className="ml-1 rounded bg-amber-50 px-1 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">Amber</span> = optional (safe to leave blank). Plus one of <b>Item SKU</b> or <b>Product Title</b>. Hover a chip for details.
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
                    <Button variant="outline" size="sm" onClick={makeSheetCopy}>
                      <Table size={13} weight="bold" /> Make a copy in Google Sheets
                    </Button>
                    <span className="text-[11px] text-muted-foreground">opens a copy already set up with the right columns</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Then share it as “anyone with the link can view” and paste the link above.
                  </p>
                </TabsContent>
              )}
            </Tabs>

            {notice && (
              <div className="mt-3 rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">{notice}</div>
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
                  <span className="inline-flex items-center gap-1.5 text-emerald-600"><CheckCircle size={14} weight="fill" /> {summary.valid} valid</span>
                  {summary.invalid > 0 && <span className="inline-flex items-center gap-1.5 text-amber-600"><WarningCircle size={14} weight="fill" /> {summary.invalid} skipped</span>}
                </div>
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
                          <td className="px-3 py-1.5 font-mono text-xs">{r.order_number || "—"}</td>
                          <td className="max-w-[140px] truncate px-3 py-1.5">{r.ship_name || "—"}</td>
                          <td className="max-w-[160px] truncate px-3 py-1.5 text-muted-foreground">{r.product_title || r.item_name || r.item_sku || "—"}</td>
                          <td className="px-3 py-1.5">
                            {r._valid ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle size={13} weight="fill" /> OK</span>
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
