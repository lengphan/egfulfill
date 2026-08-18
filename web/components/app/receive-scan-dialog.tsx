"use client"

import { useEffect, useRef, useState } from "react"
import { CircleNotch, Barcode, Warning, CheckCircle, Package, Camera } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSsBox, getInventory, saveInventory, type SsBox, type InventoryItem } from "@/lib/api"
import { BarcodeCamera } from "@/components/app/barcode-camera"

const num = (v: unknown) => Number(v) || 0

/**
 * Receive a carton by scanning its label.
 *
 * The S&S shipping label carries invoice + box number, and their Orders API returns a
 * per-box line breakdown — so a scan answers "what am I holding" without anyone opening
 * the box and reading garment labels. Scan, check, put away.
 *
 * Two things it's built to catch, because both are silent otherwise:
 *
 *  • A SHORT line. qtyShipped and qtyOrdered differ when S&S couldn't fill something, and
 *    a box received on trust makes that discoverable weeks later when the stock isn't
 *    there. Any short line is called out before anything is added.
 *  • The wrong box. A barcode that doesn't resolve is refused rather than guessed at —
 *    receiving one carton's contents against another is worse than typing it by hand.
 */
export function ReceiveScanDialog({
  open, onOpenChange, onReceived,
}: { open: boolean; onOpenChange: (v: boolean) => void; onReceived?: () => void }) {
  const [code, setCode] = useState("")
  const [box, setBox] = useState<SsBox | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [cam, setCam] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setCode(""); setBox(null); setErr(null); setDone(null)
      // Focus the field: a hardware scanner types and presses Enter, so the cursor being
      // anywhere else means the first scan goes nowhere.
      inputRef.current?.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [open])

  const lookup = async (raw?: string) => {
    const barcode = (raw ?? code).trim()
    if (!barcode) return
    setBusy(true); setErr(null); setBox(null); setDone(null)
    try {
      const r = await getSsBox(barcode)
      if (r.error) { setErr(r.error); return }
      setBox(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't look that barcode up.")
    } finally { setBusy(false) }
  }

  /** Add this box's SHIPPED quantities into inventory, merging by sku. */
  const receive = async () => {
    if (!box) return
    setSaving(true); setErr(null)
    try {
      const inv = (await getInventory().catch(() => [])) ?? []
      const next: InventoryItem[] = inv.map((i) => ({ ...i }))
      for (const l of box.lines) {
        if (!l.qty) continue
        const hit = next.find((x) => x.sku === l.sku)
        if (hit) hit.in_stock = num(hit.in_stock) + l.qty
        else next.push({
          sku: l.sku,
          name: l.title || l.style || l.sku,
          variant: [l.color, l.size].filter(Boolean).join(" / ") || undefined,
          in_stock: l.qty, reorder_at: 25, supplier: "S&S Activewear",
        })
      }
      await saveInventory(next)
      setDone(`Box ${box.boxNumber} received — ${box.lines.reduce((s, l) => s + l.qty, 0)} units added to stock.`)
      setBox(null); setCode("")
      onReceived?.()
      // Straight back to the field: receiving is a run of boxes, not one.
      setTimeout(() => inputRef.current?.focus(), 0)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add these to inventory.")
    } finally { setSaving(false) }
  }

  const short = box?.lines.filter((l) => l.ordered > l.qty) ?? []
  const units = box?.lines.reduce((s, l) => s + l.qty, 0) ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receive a box</DialogTitle>
          <DialogDescription>
            Scan the barcode on an S&amp;S carton to see exactly what&apos;s inside it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <Barcode size={18} className="shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              // A scanner types the code then sends Enter, so this is the whole interaction.
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookup() } }}
              placeholder="Scan or type — e.g. 42592959.0011"
              className="h-10 font-mono"
              disabled={busy || saving}
            />
            {/* Phone camera, for a bench without a handheld scanner. */}
            <Button size="sm" variant="outline" onClick={() => setCam((v) => !v)} disabled={busy || saving}
              title="Scan with the camera">
              <Camera size={14} weight="bold" />
            </Button>
            <Button size="sm" onClick={() => lookup()} disabled={busy || saving || !code.trim()}>
              {busy ? <CircleNotch size={14} className="animate-spin" /> : "Look up"}
            </Button>
          </div>

          {cam && (
            <BarcodeCamera
              onClose={() => setCam(false)}
              // Straight through to the lookup — a scan that stops to be confirmed is
              // slower than typing, which defeats the point of scanning.
              onScan={(v) => { setCam(false); setCode(v); void lookup(v) }}
            />
          )}

          {err && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <Warning size={15} weight="fill" className="mt-0.5 shrink-0" /><span>{err}</span>
            </div>
          )}
          {done && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0" /><span>{done}</span>
            </div>
          )}

          {box && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border px-3 py-2 text-xs">
                <span className="inline-flex items-center gap-1 font-medium">
                  <Package size={13} weight="fill" /> Box {box.boxNumber}{box.boxCount ? ` of ${box.boxCount}` : ""}
                </span>
                <span className="text-muted-foreground">Order <span className="font-mono text-foreground">{box.orderNumber}</span></span>
                <span className="text-muted-foreground">Invoice <span className="font-mono text-foreground">{box.invoiceNumber}</span></span>
                {box.poNumber && <span className="text-muted-foreground">PO <span className="font-mono text-foreground">{box.poNumber}</span></span>}
                {box.warehouse && <span className="text-muted-foreground">from {box.warehouse}</span>}
                {box.tracking && <span className="text-muted-foreground">{box.carrier} <span className="tabular-nums text-foreground">{box.tracking}</span></span>}
              </div>

              {/* A short line is the reason to look before putting away. Called out here
                  rather than left for whoever counts the shelf next month. */}
              {short.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
                  <span>
                    {short.length} line{short.length === 1 ? " was" : "s were"} shipped short — only what actually arrived
                    will be added to stock.
                  </span>
                </div>
              )}

              <div className="max-h-[45vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {box.lines.map((l) => (
                  <div key={l.sku} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{l.title || l.sku}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[l.brand, l.style, l.color, l.size].filter(Boolean).join(" · ")}
                        <span className="ml-1.5 font-mono opacity-70">{l.sku}</span>
                      </div>
                    </div>
                    {l.ordered > l.qty ? (
                      <span className="shrink-0 whitespace-nowrap text-xs font-medium text-amber-700">
                        {l.qty} of {l.ordered}
                      </span>
                    ) : (
                      <span className="shrink-0 tabular-nums text-muted-foreground">×{l.qty}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            {box ? `${units} units in this box` : "Scan a carton label to begin"}
          </span>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Close</Button>
          <Button size="sm" onClick={receive} disabled={!box || saving || !units}>
            {saving ? <CircleNotch size={13} className="animate-spin" /> : null}
            Add to stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
