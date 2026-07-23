"use client"

import { useEffect, useState } from "react"
import { CircleNotch, ArrowSquareOut, CheckCircle, Warning } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseBlock } from "@/lib/address-paste"
import { createOrder, validateAddress, buyUspsLabel, getFactorySettings, setFactorySettings, type ShipAddress, type UspsLabelResult } from "@/lib/api"

const MAIL_CLASSES = [
  { id: "USPS_GROUND_ADVANTAGE", label: "Ground Advantage" },
  { id: "PRIORITY_MAIL", label: "Priority Mail" },
  { id: "PRIORITY_MAIL_EXPRESS", label: "Priority Express" },
]
const BLANK: ShipAddress = { name: "", street: "", street2: "", city: "", state: "", zip: "" }
const addrComplete = (a: ShipAddress) => !!(a.street && a.city && a.state && a.zip)
const FROM_STORE = "eg_ship_from"

/**
 * Buy a REAL shipping label through the aggregator (Shippo → USPS), shared by two callers:
 *
 *  - Shipments page — no `order`: creates a minimal staff-owned manual FF-order (re-ship,
 *    sample, replacement…) so the label is RECORDED in Shipments.
 *  - Order detail — with `order`: buys against that existing order, ship-to pre-filled from
 *    its address; nothing new is created.
 *
 * Ship-to is a single paste box (validated live); ship-from is the saved warehouse address
 * (Settings › Platform). Optional add-ons (signature, insurance) ride the same buy.
 */
export function NewLabelDialog({ open, onOpenChange, onCreated, order }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void; order?: { id: string; num?: string; to?: ShipAddress } }) {
  const [pasteText, setPasteText] = useState("")
  const [to, setTo] = useState<ShipAddress>({ ...BLANK })
  const [from, setFrom] = useState<ShipAddress>({ ...BLANK })
  const [pkg, setPkg] = useState({ weightOz: 6, length: 10, width: 8, height: 1, mailClass: "USPS_GROUND_ADVANTAGE" })
  // Add-ons the carrier prices into the label: signature on delivery, declared insurance.
  const [svc, setSvc] = useState<{ signature: boolean; insurance: number }>({ signature: false, insurance: 0 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<UspsLabelResult | null>(null)

  // Load the saved warehouse 'from' when the dialog opens (deferred so no sync setState).
  // With an `order`, also seed ship-to from its address so the label is one click away.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      try { const raw = localStorage.getItem(FROM_STORE); if (raw) setFrom({ ...BLANK, ...JSON.parse(raw) }) } catch {}
      getFactorySettings().then((s) => {
        const sf = s?.ship_from as ShipAddress | undefined
        if (sf && sf.street) { const a = { ...BLANK, ...sf }; setFrom(a); try { localStorage.setItem(FROM_STORE, JSON.stringify(a)) } catch {} }
      }).catch(() => {})
      if (order?.to && order.to.street) {
        const a = { ...BLANK, ...order.to }
        setTo(a)
        setPasteText([a.name, a.street, a.street2, [a.city, a.state].filter(Boolean).join(", ") + (a.zip ? " " + a.zip : "")].filter((l) => l && l.trim()).join("\n"))
      }
    }, 0)
    return () => clearTimeout(t)
  }, [open, order?.id])

  // Live recipient validation — visible ✓/⚠ before spending. Debounced, warn-not-block.
  const [addrCheck, setAddrCheck] = useState<{ status: "idle" | "checking" | "valid" | "invalid"; msg?: string }>({ status: "idle" })
  useEffect(() => {
    const complete = addrComplete(to)
    let alive = true
    const t = setTimeout(() => {
      if (!alive) return
      if (!complete) { setAddrCheck({ status: "idle" }); return }
      setAddrCheck({ status: "checking" })
      validateAddress({ streetAddress: to.street || "", secondaryAddress: to.street2, city: to.city || "", state: to.state || "", ZIPCode: to.zip || "" })
        .then((v) => { if (alive) setAddrCheck(v && v.ok ? { status: "valid" } : { status: "invalid", msg: v?.error }) })
        .catch(() => { if (alive) setAddrCheck({ status: "idle" }) })
    }, 600)
    return () => { alive = false; clearTimeout(t) }
  }, [to.street, to.street2, to.city, to.state, to.zip])

  const reset = () => { setPasteText(""); setTo({ ...BLANK }); setSvc({ signature: false, insurance: 0 }); setResult(null); setErr(null); setAddrCheck({ status: "idle" }) }

  const buy = async () => {
    setErr(null)
    if (!addrComplete(to)) { setErr("Recipient needs a street, city, state and ZIP."); return }
    if (!addrComplete(from)) { setErr("No warehouse ‘From’ address saved — set it in Settings › Platform first."); return }
    setBusy(true)
    try {
      // Existing order → buy against it. No order → mint a manual FF-order so the label is
      // recorded in Shipments the same way marketplace labels are.
      let orderId = order?.id
      if (!orderId) {
        const id = `FF-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        const co = await createOrder({
          id, source: "manual", status: "new",
          customer: { name: to.name || "" },
          address: { name: to.name || "", street: to.street, street2: to.street2, city: to.city, state: to.state, zip: to.zip },
        })
        if (!co.ok) { setErr(co.error || "Couldn't create the order."); return }
        orderId = id
      }
      setFactorySettings({ ship_from: from }).catch(() => {})
      try {
        const v = await validateAddress({ streetAddress: to.street || "", secondaryAddress: to.street2, city: to.city || "", state: to.state || "", ZIPCode: to.zip || "" })
        if (v && !v.ok && v.error && !window.confirm(`Address check couldn't confirm this is deliverable:\n\n${v.error}\n\nBuy the label anyway?`)) return
      } catch { /* validation unavailable — proceed */ }
      const r = await buyUspsLabel({ to, from, orderId, weightOz: pkg.weightOz, length: pkg.length, width: pkg.width, height: pkg.height, mailClass: pkg.mailClass, signature: svc.signature, insurance: svc.insurance || undefined })
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
        <DialogHeader><DialogTitle>{order ? `New label · ${order.num || order.id}` : "New label"}</DialogTitle></DialogHeader>

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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ship to</div>
                {addrCheck.status === "checking" && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><CircleNotch size={12} className="animate-spin" /> Checking address…</span>}
                {addrCheck.status === "valid" && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><CheckCircle size={12} weight="fill" /> Address validated</span>}
                {addrCheck.status === "invalid" && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700" title={addrCheck.msg || undefined}><Warning size={12} weight="fill" /> {addrCheck.msg ? "Couldn't verify — check it" : "Address not found"}</span>}
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => {
                  setPasteText(e.target.value)
                  const { name, addr } = parseBlock(e.target.value)
                  setTo({ name: name || "", street: addr.street || "", street2: addr.street2 || "", city: addr.city || "", state: addr.state || "", zip: addr.zip || "" })
                }}
                rows={4}
                placeholder={"Sara Fetterhoff\n230 Trails End Rd\nBeach Lake, PA 18405"}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <p className="text-[10px] text-muted-foreground">Name, street, then City, ST ZIP — the label uses exactly this. Ship-from is your saved warehouse address (Settings › Platform).</p>

              <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Service &amp; parcel</div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Service</span>
                  <select value={pkg.mailClass} onChange={(e) => setPkg({ ...pkg, mailClass: e.target.value })} className="eg-select h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                    {MAIL_CLASSES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
                <label className="flex w-20 flex-col gap-1"><span className="text-[11px] text-muted-foreground">Weight oz</span><Input type="number" min={1} value={pkg.weightOz} onChange={(e) => setPkg({ ...pkg, weightOz: Number(e.target.value) })} className="h-9" /></label>
                <label className="flex w-14 flex-col gap-1"><span className="text-[11px] text-muted-foreground">L in</span><Input type="number" min={1} value={pkg.length} onChange={(e) => setPkg({ ...pkg, length: Number(e.target.value) })} className="h-9" /></label>
                <label className="flex w-14 flex-col gap-1"><span className="text-[11px] text-muted-foreground">W in</span><Input type="number" min={1} value={pkg.width} onChange={(e) => setPkg({ ...pkg, width: Number(e.target.value) })} className="h-9" /></label>
                <label className="flex w-14 flex-col gap-1"><span className="text-[11px] text-muted-foreground">H in</span><Input type="number" min={1} value={pkg.height} onChange={(e) => setPkg({ ...pkg, height: Number(e.target.value) })} className="h-9" /></label>
              </div>

              <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add-ons</div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={svc.signature} onChange={(e) => setSvc({ ...svc, signature: e.target.checked })} className="size-4 accent-[var(--primary)]" />
                  Signature on delivery
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">Insure $</span>
                  <Input type="number" min={0} step={1} value={svc.insurance || ""} placeholder="0" onChange={(e) => setSvc({ ...svc, insurance: Math.max(0, Number(e.target.value) || 0) })} className="h-9 w-24" />
                </label>
              </div>
              <p className="text-[10px] text-muted-foreground">Add-ons are priced into the label by the carrier. Leave insurance at 0 for none.</p>

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
