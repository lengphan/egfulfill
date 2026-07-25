"use client"

import { useState } from "react"
import { CircleNotch, Truck } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getShippingRates, type ShippingRate } from "@/lib/api"

const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`
const CARRIERS = ["usps", "ups"]

/**
 * A quick USPS/UPS rate preview — enter From/To ZIP + parcel, see every rate. No order is
 * created and nothing is bought; it's the "what would this cost" tool. Rates are zone-based
 * on the ZIP, so a placeholder street is enough to price them.
 */
export function RateCheckerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [fromZip, setFromZip] = useState("")
  const [toZip, setToZip] = useState("")
  const [pkg, setPkg] = useState({ weightOz: 8, length: 10, width: 8, height: 2 })
  const [rates, setRates] = useState<ShippingRate[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const check = async () => {
    setErr(null)
    if (!/^\d{5}$/.test(fromZip) || !/^\d{5}$/.test(toZip)) { setErr("Enter a 5-digit From and To ZIP."); return }
    setLoading(true); setRates(null)
    try {
      const r = await getShippingRates({
        from: { street: "1 Main St", city: "", state: "", zip: fromZip },
        to: { street: "1 Main St", city: "", state: "", zip: toZip },
        parcel: { weightOz: pkg.weightOz, length: pkg.length, width: pkg.width, height: pkg.height },
      })
      if (r.error) { setErr(r.error); return }
      const shown = (r.rates || []).filter((rt) => CARRIERS.some((c) => (rt.carrier || "").toLowerCase().includes(c))).sort((a, b) => a.amount - b.amount)
      setRates(shown)
      if (!shown.length) setErr(r.errors?.join(" · ") || "No USPS or UPS rates for this parcel.")
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't fetch rates.")
    } finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Rate checker</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Compare USPS &amp; UPS rates for a parcel — no order created, nothing bought.</p>
        <div className="space-y-3 py-1">
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1"><span className="text-[11px] text-muted-foreground">From ZIP</span><Input value={fromZip} onChange={(e) => setFromZip(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="75201" className="h-9" /></label>
            <label className="flex flex-1 flex-col gap-1"><span className="text-[11px] text-muted-foreground">To ZIP</span><Input value={toZip} onChange={(e) => setToZip(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="18405" className="h-9" /></label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex w-20 flex-col gap-1"><span className="text-[11px] text-muted-foreground">Weight oz</span><Input type="number" min={1} value={pkg.weightOz} onChange={(e) => setPkg({ ...pkg, weightOz: Number(e.target.value) })} className="h-9" /></label>
            <label className="flex w-14 flex-col gap-1"><span className="text-[11px] text-muted-foreground">L in</span><Input type="number" min={1} value={pkg.length} onChange={(e) => setPkg({ ...pkg, length: Number(e.target.value) })} className="h-9" /></label>
            <label className="flex w-14 flex-col gap-1"><span className="text-[11px] text-muted-foreground">W in</span><Input type="number" min={1} value={pkg.width} onChange={(e) => setPkg({ ...pkg, width: Number(e.target.value) })} className="h-9" /></label>
            <label className="flex w-14 flex-col gap-1"><span className="text-[11px] text-muted-foreground">H in</span><Input type="number" min={1} value={pkg.height} onChange={(e) => setPkg({ ...pkg, height: Number(e.target.value) })} className="h-9" /></label>
          </div>
          <Button className="w-full" onClick={check} disabled={loading}>{loading ? <><CircleNotch size={14} className="animate-spin" /> Checking…</> : <><Truck size={14} weight="bold" /> Check rates</>}</Button>
          {err && <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">{err}</div>}
          {rates && rates.length > 0 && (
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {rates.map((r) => (
                <div key={r.token} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{r.carrier}{r.service ? ` · ${r.service}` : ""}</div>
                    <div className="text-[11px] text-muted-foreground">{r.days != null ? `${r.days} day${r.days === 1 ? "" : "s"}` : "delivery est. n/a"}</div>
                  </div>
                  <div className="shrink-0 font-semibold tabular-nums">{usd(r.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
