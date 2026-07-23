"use client"

import { useEffect, useState } from "react"
import { CircleNotch, ArrowSquareOut } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createOrder, validateAddress, buyUspsLabel, getFactorySettings, setFactorySettings, type ShipAddress, type UspsLabelResult } from "@/lib/api"

const BLANK: ShipAddress = { name: "", street: "", street2: "", city: "", state: "", zip: "" }
const addrComplete = (a: ShipAddress) => !!(a.street && a.city && a.state && a.zip)
const FROM_STORE = "eg_ship_from"

/**
 * Create a one-off shipping label for a MANUAL order (re-ship, sample, replacement…). It
 * creates a minimal manual order (source 'manual', staff-owned) so the label is RECORDED in
 * Shipments like any other — then validates the address and buys the label. Reuses the exact
 * buy + validate flow the order ship panel uses.
 */
export function NewLabelDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [to, setTo] = useState<ShipAddress>({ ...BLANK })
  const [from, setFrom] = useState<ShipAddress>({ ...BLANK })
  const [pkg, setPkg] = useState({ weightOz: 6, length: 10, width: 8, height: 1 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<UspsLabelResult | null>(null)

  useEffect(() => {
    if (!open) return
    // Deferred (setTimeout 0) so the initial read isn't a synchronous setState in the effect.
    const t = setTimeout(() => {
      try { const raw = localStorage.getItem(FROM_STORE); if (raw) setFrom({ ...BLANK, ...JSON.parse(raw) }) } catch {}
      getFactorySettings().then((s) => {
        const sf = s?.ship_from as ShipAddress | undefined
        if (sf && sf.street) {
          const a = { ...BLANK, ...sf }
          setFrom(a)
          try { localStorage.setItem(FROM_STORE, JSON.stringify(a)) } catch {}
        }
      }).catch(() => {})
    }, 0)
    return () => clearTimeout(t)
  }, [open])

  const set = (k: keyof ShipAddress, v: string) => setTo((t) => ({ ...t, [k]: v }))

  const reset = () => { setTo({ ...BLANK }); setResult(null); setErr(null) }

  const buy = async () => {
    setErr(null)
    if (!addrComplete(to)) { setErr("Recipient needs a street, city, state and ZIP."); return }
    if (!addrComplete(from)) { setErr("No warehouse ‘From’ address saved — set it in Settings first."); return }
    setBusy(true)
    try {
      const id = `FF-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const co = await createOrder({
        id, source: "manual", status: "new",
        customer: { name: to.name || "" },
        address: { name: to.name || "", street: to.street, street2: to.street2, city: to.city, state: to.state, zip: to.zip },
      })
      if (!co.ok) { setErr(co.error || "Couldn't create the order."); return }
      setFactorySettings({ ship_from: from }).catch(() => {})
      // Validate (warn, don't block) — a bad address is a wasted label.
      try {
        const v = await validateAddress({ streetAddress: to.street || "", secondaryAddress: to.street2, city: to.city || "", state: to.state || "", ZIPCode: to.zip || "" })
        if (v && !v.ok && v.error && !window.confirm(`Address check couldn't confirm this is deliverable:\n\n${v.error}\n\nBuy the label anyway?`)) return
      } catch { /* validation unavailable — proceed */ }
      const r = await buyUspsLabel({ to, from, orderId: id, ...pkg })
      if (!r.ok) { setErr(r.error || "Couldn't buy the label."); return }
      setResult(r)
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create the label.")
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New label</DialogTitle></DialogHeader>

        {result ? (
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
              Label bought — <span className="font-mono">{result.trackingNumber}</span>
              {result.service ? ` · ${result.service}` : ""}{result.cost != null ? ` · $${result.cost.toFixed(2)}` : ""}
            </div>
            <div className="flex flex-wrap gap-2">
              {result.labelUrl && (
                <a href={result.labelUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
                  <ArrowSquareOut size={14} weight="bold" /> Open label
                </a>
              )}
              <Button variant="outline" onClick={reset}>Another</Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3 py-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ship to</div>
              <Input placeholder="Name" value={to.name || ""} onChange={(e) => set("name", e.target.value)} />
              <Input placeholder="Street" value={to.street || ""} onChange={(e) => set("street", e.target.value)} />
              <Input placeholder="Apt / unit (optional)" value={to.street2 || ""} onChange={(e) => set("street2", e.target.value)} />
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="City" value={to.city || ""} onChange={(e) => set("city", e.target.value)} />
                <Input placeholder="State" value={to.state || ""} onChange={(e) => set("state", e.target.value)} />
                <Input placeholder="ZIP" value={to.zip || ""} onChange={(e) => set("zip", e.target.value)} />
              </div>
              <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parcel</div>
              <div className="grid grid-cols-4 gap-2">
                <label className="text-xs text-muted-foreground">Weight oz<Input type="number" min={1} value={pkg.weightOz} onChange={(e) => setPkg({ ...pkg, weightOz: Number(e.target.value) })} className="mt-1" /></label>
                <label className="text-xs text-muted-foreground">L in<Input type="number" min={1} value={pkg.length} onChange={(e) => setPkg({ ...pkg, length: Number(e.target.value) })} className="mt-1" /></label>
                <label className="text-xs text-muted-foreground">W in<Input type="number" min={1} value={pkg.width} onChange={(e) => setPkg({ ...pkg, width: Number(e.target.value) })} className="mt-1" /></label>
                <label className="text-xs text-muted-foreground">H in<Input type="number" min={1} value={pkg.height} onChange={(e) => setPkg({ ...pkg, height: Number(e.target.value) })} className="mt-1" /></label>
              </div>
              {!addrComplete(from) && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                  No warehouse ‘From’ address saved — set it in Settings › Platform before buying.
                </div>
              )}
              {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={buy} disabled={busy}>{busy ? <><CircleNotch size={14} className="animate-spin" /> Buying…</> : "Buy label"}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
