"use client"

import { useState } from "react"
import { useLabelT } from "@/lib/i18n"
import { CheckCircle, WarningCircle } from "@phosphor-icons/react"
import { Dropzone } from "@/components/app/dropzone"
import { parseCSV } from "@/lib/order-import"
import { importEtsyAddresses } from "@/lib/api"

/**
 * Map Etsy's own "Download Data" CSV export into the shape /api/etsy/import-addresses
 * expects. Mirrors mapAddressRows in server/src/routes/etsy.js (same header-matching
 * rules) — kept in sync by hand, since web and server run in different runtimes and
 * this one function isn't worth a shared package. Header matching is forgiving: Etsy
 * has renamed these columns over the years and sellers re-save through Excel.
 */
function mapAddressRows(rows: string[][]) {
  if (rows.length < 2) return []
  const norm = (h: string) => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "")
  const headers = rows[0].map(norm)
  const pick = (...cands: string[]) => {
    for (const c of cands) { const i = headers.indexOf(norm(c)); if (i >= 0) return i }
    for (const c of cands) { const i = headers.findIndex((h) => h.includes(norm(c))); if (i >= 0) return i }
    return -1
  }
  const iOrder = pick("Order ID", "Receipt ID", "orderid")
  const iStreet = pick("Ship Address1", "Shipping Address1", "Street 1", "address1")
  if (iOrder < 0 || iStreet < 0) return []
  const iName = pick("Ship Name", "Full Name", "Buyer", "name")
  const iStreet2 = pick("Ship Address2", "Shipping Address2", "Street 2", "address2")
  const iCity = pick("Ship City", "Shipping City", "city")
  const iState = pick("Ship State", "Shipping State", "state", "province")
  const iZip = pick("Ship Zipcode", "Ship Zip", "Shipping Zip", "zip", "postalcode")
  const iCountry = pick("Ship Country", "Shipping Country", "country")
  const at = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "")
  return rows.slice(1).filter((r) => at(r, iOrder)).map((r) => ({
    order_id: at(r, iOrder), name: at(r, iName), street: at(r, iStreet), street2: at(r, iStreet2),
    city: at(r, iCity), state: at(r, iState), zip: at(r, iZip), country: at(r, iCountry),
  }))
}

type Outcome =
  | { error: string }
  | { updated: number; skipped: number; notFound: number; alreadyHad: number; rejected?: { order_id: string; why: string }[] }

/**
 * THE ZERO-THIRD-PARTY PATH.
 *
 * Etsy withholds buyer addresses from the API for apps outside Commercial Access, and the
 * usual workaround is a shipping aggregator's own Etsy connection (Shippo, EasyPost) reading
 * them back — which means handing a third party ongoing OAuth access to the whole shop just
 * to recover four address fields. This needs none of that: the seller's own "Download Data"
 * export from their own Shop Manager session goes straight from their disk to our API. No
 * inbound-email provider, no spreadsheet host, no aggregator in the loop — see the other two
 * options (mail forwarding, the Google Sheet poll) for a lighter-touch but not zero-party
 * alternative when re-exporting by hand is too much friction.
 *
 * Fill-only and validated server-side (applyAddressRows in etsy.js) — a re-upload can only
 * complete a blank order, never overwrite a hand-typed or already-synced address.
 */
export function EtsyAddressRecovery() {
  const tl = useLabelT()
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [result, setResult] = useState<Outcome | null>(null)

  const takeFile = (files: FileList) => {
    const file = files[0]
    if (!file) return
    setResult(null)
    setFileName(file.name)
    if (!/\.csv$/i.test(file.name)) {
      setResult({ error: tl("stores", "That's not a .csv file — export from Etsy Shop Manager → Settings → Options → Download Data.") })
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      const rows = parseCSV(String(reader.result || ""))
      const mapped = mapAddressRows(rows)
      if (!mapped.length) {
        setResult({ error: tl("stores", "No Order ID + Ship Address1 columns found in that file — check it's the Orders export, not Items or Payments.") })
        return
      }
      setBusy(true)
      try {
        const res = await importEtsyAddresses(mapped)
        setResult(res.error ? { error: res.error } : res)
      } catch (e) {
        setResult({ error: e instanceof Error ? e.message : "Import failed." })
      } finally {
        setBusy(false)
      }
    }
    reader.onerror = () => setResult({ error: `Couldn't read "${file.name}".` })
    reader.readAsText(file)
  }

  const isError = !!result && "error" in result

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3.5 font-semibold">
        {tl("stores", "Recover addresses from your Etsy export")}
      </div>
      <div className="p-5">
        <Dropzone
          onFiles={takeFile}
          accept=".csv,text/csv"
          busy={busy ? tl("stores", "Importing…") : null}
          label={fileName ? tl("stores", "Import another export") : tl("stores", "Drop your Etsy “Download Data” CSV — or browse")}
          hint={tl("stores", "Shop Manager → Settings → Options → Download Data → Orders")}
        />
        {result && (
          <div
            className={
              "mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm " +
              (isError ? "border-alert/30 bg-alert/5 text-alert" : "border-shipped/30 bg-shipped/10 text-shipped")
            }
          >
            {isError
              ? <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0" />
              : <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0" />}
            <span>
              {isError
                ? result.error
                : `${result.updated} ${result.updated === 1 ? tl("stores", "address filled") : tl("stores", "addresses filled")}` +
                  (result.alreadyHad ? ` · ${result.alreadyHad} ${tl("stores", "already had one")}` : "") +
                  (result.notFound ? ` · ${result.notFound} ${result.notFound === 1 ? tl("stores", "order not found") : tl("stores", "orders not found")}` : "") +
                  (result.rejected?.length ? ` · ${result.rejected.length} ${tl("stores", "rejected (bad state/zip)")}` : "")}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
