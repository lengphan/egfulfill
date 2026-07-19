"use client"

import { useEffect, useRef, useState } from "react"
import { UploadSimple, CircleNotch, CheckCircle, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { parseCSV } from "@/lib/order-import"
import { importEtsyAddresses, getAddressSheet, setAddressSheet, runAddressSheet } from "@/lib/api"

/**
 * Backfill buyer addresses from the seller's own Etsy CSV export.
 *
 * Etsy redacts the address from the API for apps not mapped to an approved category, but
 * the seller's own Shop Manager export still contains it. This is the stopgap that lets
 * parcels be labelled while that entitlement is pending — and it stays useful afterwards
 * for backfilling orders that synced during the gap.
 */

// Etsy's export has renamed these columns over the years, and sellers sometimes re-save
// through Excel. Match on a normalised header so we don't demand one exact spelling.
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "")
const pick = (headers: string[], ...candidates: string[]) => {
  const normed = headers.map(norm)
  for (const c of candidates) {
    const i = normed.indexOf(norm(c))
    if (i >= 0) return i
  }
  // Fall back to a contains-match ("shipaddress1" vs "shippingaddress1").
  for (const c of candidates) {
    const i = normed.findIndex((h) => h.includes(norm(c)))
    if (i >= 0) return i
  }
  return -1
}

type Result = { updated: number; skipped: number; notFound: number; alreadyHad: number; missing?: string[] }

export function EtsyAddressImport({ onImported }: { onImported?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [sheet, setSheet] = useState("")
  const [sheetBusy, setSheetBusy] = useState(false)
  const [sheetMsg, setSheetMsg] = useState<string | null>(null)

  useEffect(() => {
    const id = setTimeout(() => { getAddressSheet().then((r) => setSheet(r.url || "")).catch(() => {}) }, 0)
    return () => clearTimeout(id)
  }, [])

  const saveSheet = async () => {
    setSheetBusy(true); setSheetMsg(null)
    try {
      await setAddressSheet(sheet.trim())
      const r = await runAddressSheet()
      if (r.error) throw new Error(r.error)
      setSheetMsg(r.updated != null ? `Saved — filled ${r.updated} order${r.updated === 1 ? "" : "s"} just now.` : "Saved.")
      onImported?.()
    } catch (e) {
      setSheetMsg(e instanceof Error ? e.message : "Couldn't read that sheet.")
    } finally { setSheetBusy(false) }
  }
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const onFile = async (file?: File | null) => {
    if (!file) return
    setBusy(true); setErr(null); setResult(null)
    try {
      let rows: string[][]
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await import("xlsx")
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
        rows = (XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: "" }) as unknown[][])
          .map((r) => r.map((c) => String(c ?? "")))
      } else {
        rows = parseCSV(await file.text())
      }
      if (rows.length < 2) throw new Error("That file has no data rows.")

      const headers = rows[0]
      const iOrder = pick(headers, "Order ID", "Receipt ID", "orderid")
      const iStreet = pick(headers, "Ship Address1", "Shipping Address1", "Street 1", "address1")
      if (iOrder < 0) throw new Error("Couldn't find an 'Order ID' column — is this the Etsy orders export?")
      if (iStreet < 0) throw new Error("Couldn't find a 'Ship Address1' column. Use the Orders export, which includes addresses.")

      const iName = pick(headers, "Ship Name", "Full Name", "Buyer", "name")
      const iStreet2 = pick(headers, "Ship Address2", "Shipping Address2", "Street 2", "address2")
      const iCity = pick(headers, "Ship City", "Shipping City", "city")
      const iState = pick(headers, "Ship State", "Shipping State", "state", "province")
      const iZip = pick(headers, "Ship Zipcode", "Ship Zip", "Shipping Zip", "zip", "postalcode")
      const iCountry = pick(headers, "Ship Country", "Shipping Country", "country")

      const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "")
      const payload = rows.slice(1)
        .filter((r) => at(r, iOrder))
        .map((r) => ({
          order_id: at(r, iOrder), name: at(r, iName),
          street: at(r, iStreet), street2: at(r, iStreet2),
          city: at(r, iCity), state: at(r, iState), zip: at(r, iZip), country: at(r, iCountry),
        }))
      if (!payload.length) throw new Error("No rows with an Order ID were found.")

      const res = await importEtsyAddresses(payload)
      if (res.error) throw new Error(res.error)
      setResult(res as Result)
      onImported?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed.")
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <SectionCard
      title="Import addresses from Etsy"
      description="Etsy withholds buyer addresses from the API — their CSV export still has them"
    >
      <div className="space-y-3 p-5">
        <ol className="space-y-1 text-sm text-muted-foreground">
          <li>1. In Etsy Shop Manager go to <span className="font-medium text-foreground">Settings → Options → Download Data</span>.</li>
          <li>2. Download the <span className="font-medium text-foreground">Orders</span> CSV for the month you need.</li>
          <li>3. Upload it here — we match rows to synced orders by Etsy order number.</li>
        </ol>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <CircleNotch size={14} className="animate-spin" /> : <UploadSimple size={14} weight="bold" />}
            {busy ? "Importing…" : "Upload Etsy orders CSV"}
          </Button>
          <span className="text-xs text-muted-foreground">.csv or .xlsx</span>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => onFile(e.target.files?.[0])} />

        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <Warning size={15} weight="fill" className="mt-0.5 shrink-0" /> {err}
          </div>
        )}

        {/* Optional: automate the INGESTION (not the export). */}
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="text-sm font-medium">Or keep it topped up automatically</div>
          <p className="text-xs text-muted-foreground">
            Paste the Etsy export into a Google Sheet shared as &ldquo;Anyone with the link&rdquo;, and we&apos;ll
            re-read it every hour. We never touch your Etsy login — you still export from Etsy yourself.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={sheet}
              onChange={(e) => setSheet(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <Button size="sm" variant="outline" onClick={saveSheet} disabled={sheetBusy}>
              {sheetBusy ? <CircleNotch size={14} className="animate-spin" /> : "Save & run"}
            </Button>
          </div>
          {sheetMsg && <p className="text-xs text-muted-foreground">{sheetMsg}</p>}
        </div>

        {result && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <div className="flex items-center gap-1.5 font-medium text-emerald-700">
              <CheckCircle size={15} weight="fill" /> {result.updated} order{result.updated === 1 ? "" : "s"} now have an address
            </div>
            <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
              {result.alreadyHad > 0 && <li>{result.alreadyHad} already had one — left untouched so manual corrections aren&apos;t clobbered.</li>}
              {result.notFound > 0 && <li>{result.notFound} not matched to a synced order (sync first, then re-import).</li>}
              {result.skipped > 0 && <li>{result.skipped} skipped — no street address in the row.</li>}
            </ul>
          </div>
        )}
      </div>
    </SectionCard>
  )
}
