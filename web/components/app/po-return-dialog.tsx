"use client"

import { useEffect, useState } from "react"
import { CircleNotch, ArrowUUpLeft, Warning } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { returnPoLines, type PurchaseOrder } from "@/lib/api"

const num = (v: unknown) => Number(v) || 0
const usd = (n: number) => "$" + (Number(n) || 0).toFixed(2)

/**
 * Return stock to a supplier.
 *
 * The PO equivalent of a refund, and deliberately NOT one click. Goods go back now; the
 * credit lands whenever the supplier decides it does, so this records what left and what
 * is expected, and the credit is confirmed separately when it actually arrives. Booking
 * it here would put money in the P&L that nobody has received — the same mistake as
 * marking an order Refunded without refunding it.
 *
 * The credit per line defaults to what was paid, because that's the honest starting
 * assumption; restocking fees and partial credits get typed over it.
 */
export function PoReturnDialog({
  po, onClose, onDone,
}: { po: PurchaseOrder | null; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState<Record<string, string>>({})
  const [credit, setCredit] = useState<Record<string, string>>({})
  const [rma, setRma] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setQty({}); setCredit({}); setRma(""); setNote(""); setErr(null) }, 0)
    return () => clearTimeout(t)
  }, [po?.num])

  if (!po) return null

  const picked = po.items
    .map((l) => ({ l, q: parseInt(qty[l.sku] ?? "", 10) || 0 }))
    .filter((x) => x.q > 0)
  const expected = picked.reduce((s, { l, q }) => {
    const typed = Number(credit[l.sku])
    return s + (isFinite(typed) && credit[l.sku] !== "" ? typed : num(l.price) * q)
  }, 0)

  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await returnPoLines(po.num, {
        lines: picked.map(({ l, q }) => {
          const typed = Number(credit[l.sku])
          return { sku: l.sku, qty: q, credit: isFinite(typed) && credit[l.sku] !== "" ? typed : num(l.price) * q }
        }),
        rma: rma.trim() || undefined,
        note: note.trim() || undefined,
      })
      if (r.error) { setErr(r.error); return }
      onDone()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't record that return.")
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={!!po} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Return to {po.supplier || "supplier"}</DialogTitle>
          <DialogDescription>
            Records what goes back and what&apos;s owed. Confirm the credit separately, when it actually lands.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-1 overflow-y-auto py-2">
          {po.items.map((l) => (
            <div key={l.sku} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{l.name || l.sku}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {l.variant || l.sku} · {num(l.qty)} received{num(l.price) ? ` · ${usd(num(l.price))} each` : ""}
                </div>
              </div>
              <Input
                value={qty[l.sku] ?? ""}
                onChange={(e) => setQty((p) => ({ ...p, [l.sku]: e.target.value.replace(/[^0-9]/g, "") }))}
                placeholder="0" inputMode="numeric" disabled={busy}
                className="h-8 w-16 text-center" aria-label={`Quantity of ${l.sku} to return`}
              />
              <Input
                value={credit[l.sku] ?? ""}
                onChange={(e) => setCredit((p) => ({ ...p, [l.sku]: e.target.value.replace(/[^0-9.]/g, "") }))}
                placeholder={usd(num(l.price) * (parseInt(qty[l.sku] ?? "", 10) || 0)).replace("$", "")}
                inputMode="decimal" disabled={busy || !(parseInt(qty[l.sku] ?? "", 10) > 0)}
                className="h-8 w-24 text-right tabular-nums" aria-label={`Expected credit for ${l.sku}`}
              />
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-2">
            <Input value={rma} onChange={(e) => setRma(e.target.value)} disabled={busy}
                   placeholder="RMA / reference" className="h-9" />
            <Input value={note} onChange={(e) => setNote(e.target.value)} disabled={busy}
                   placeholder="Reason" className="h-9" />
          </div>
          {/* Said plainly: this is our record, not a message to the supplier. */}
          <p className="text-xs text-muted-foreground">
            Stock comes off the shelf now. This does <strong>not</strong> notify {po.supplier || "the supplier"} —
            raise the return with them the usual way and put their reference above.
          </p>
          {err && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <Warning size={15} weight="fill" className="mt-0.5 shrink-0" /><span>{err}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={busy || !picked.length}>
            {busy ? <CircleNotch size={13} className="animate-spin" /> : <ArrowUUpLeft size={13} weight="bold" />}
            Return {picked.length || ""} line{picked.length === 1 ? "" : "s"}{expected > 0 ? ` · ${usd(expected)} expected` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
