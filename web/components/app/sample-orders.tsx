"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Check, X, Package, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useConfirm } from "@/components/app/confirm-dialog"
import { getSampleOrders, placeSampleOrder, setSampleOrderStatus, type SampleOrder } from "@/lib/api"

const usd = (n?: number | null) =>
  n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const when = (iso?: string | null) => {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

const STATUS: Record<SampleOrder["status"], { label: string; pill: string }> = {
  placed: { label: "Placed", pill: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" },
  received: { label: "Received", pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  cancelled: { label: "Cancelled", pill: "bg-muted text-muted-foreground" },
}

/**
 * Record a sample order that has just been placed.
 *
 * A TYPING FORM, deliberately. Whether this could instead pick from our real Alibaba
 * orders is still open — it depends what their order API actually returns — and a form
 * that takes the same four facts works either way: a picker, when it exists, prefills
 * these fields rather than replacing them.
 */
export function SampleOrderDialog({
  open,
  onOpenChange,
  supplierId,
  supplierTitle,
  onPlaced,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  supplierId?: string
  supplierTitle?: string
  onPlaced?: () => void
}) {
  const [orderNo, setOrderNo] = useState("")
  const [amount, setAmount] = useState("")
  const [qty, setQty] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => { setOrderNo(""); setAmount(""); setQty(""); setNote(""); setErr(null) }, 0)
    return () => clearTimeout(id)
  }, [open])

  const save = async () => {
    const amt = Number(amount)
    if (!orderNo.trim()) { setErr("The supplier's own order number is what ties our record to theirs."); return }
    if (!Number.isFinite(amt) || amt <= 0) { setErr("What did it cost? This books to the factory wallet as it's placed."); return }
    setBusy(true); setErr(null)
    try {
      const r = await placeSampleOrder({
        supplierId, orderNo: orderNo.trim(), amount: amt,
        qty: Number(qty) > 0 ? Number(qty) : undefined,
        note: note.trim() || undefined,
      })
      if (r.error) throw new Error(r.error)
      // `booked` is reported, not assumed. The cost write is best-effort server-side, and a
      // sample recorded while its cost silently failed to book is the exact hole this closes.
      if (r.booked === false) setErr("Recorded — but the cost did NOT book to the wallet. Tell an admin before relying on the balance.")
      else onOpenChange(false)
      onPlaced?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't record that.")
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a sample order{supplierTitle ? ` — ${supplierTitle}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Supplier&apos;s order number</span>
            <Input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="ALI-88213-7" className="h-9 font-mono" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Cost (USD)</span>
              <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="42.50" inputMode="decimal" className="h-9" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Units</span>
              <Input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} placeholder="3" inputMode="numeric" className="h-9" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Note</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="two colourways, express freight" className="h-9" />
          </label>
          <p className="text-xs text-muted-foreground">
            The cost books to the <span className="font-medium text-foreground">factory</span> wallet now, not when the parcel
            lands — that&apos;s when the money actually leaves. Cancelling later adds a refund row rather than removing this one.
          </p>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? <CircleNotch size={14} className="animate-spin" /> : "Record + book cost"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Every sample placed, newest first, with the two things that can happen to one. */
export function SampleOrdersPanel({ reloadKey = 0 }: { reloadKey?: number }) {
  const confirm = useConfirm()
  const [items, setItems] = useState<SampleOrder[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    getSampleOrders().then((r) => setItems(r.items ?? [])).catch(() => setItems([]))
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load, reloadKey])

  const act = async (s: SampleOrder, action: "received" | "cancel") => {
    if (action === "cancel") {
      const ok = await confirm({
        title: "Cancel this sample?",
        body: `The ${usd(s.amount)} already charged stays on the ledger and a refund row is added alongside it — both facts are kept.`,
        confirmLabel: "Cancel sample",
      })
      if (!ok) return
    }
    setBusy(s.id)
    try {
      const r = await setSampleOrderStatus(s.id, action)
      setItems(r.items ?? items)
    } catch { load() } finally { setBusy(null) }
  }

  const total = (items ?? []).filter((s) => s.status !== "cancelled").reduce((n, s) => n + (s.amount ?? 0), 0)

  return (
    <SectionCard
      title="Sample orders"
      description={items?.length ? `${usd(total)} booked to the factory wallet` : undefined}
    >
      {items === null ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <Package size={22} />
          No samples recorded yet. Record one from a prospect&apos;s row and its cost books straight to the factory wallet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Order no.</th>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                <th className="px-4 py-2.5 text-right font-medium">Units</th>
                <th className="px-4 py-2.5 font-medium">Placed</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs">{s.orderNo || "—"}</td>
                  <td className="px-4 py-2">
                    <div className="max-w-[240px] truncate">{s.supplierTitle || "—"}</div>
                    {s.note && <div className="max-w-[240px] truncate text-xs text-muted-foreground">{s.note}</div>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{usd(s.amount)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{s.qty ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{when(s.placedAt)}</td>
                  <td className="px-4 py-2">
                    <span className={"whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium " + STATUS[s.status].pill}>
                      {STATUS[s.status].label}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      {s.status === "placed" && (
                        <>
                          <button onClick={() => act(s, "received")} disabled={busy === s.id} title="Mark arrived"
                                  className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
                            <Check size={13} weight="bold" /> Arrived
                          </button>
                          <button onClick={() => act(s, "cancel")} disabled={busy === s.id} title="Cancel and credit the cost back"
                                  className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-50">
                            <X size={13} weight="bold" /> Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-start gap-2 border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <Warning size={14} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
        Booked at place time, so a sample that never arrives still shows as spent — which it is.
        It appears in Finance under <span className="font-medium text-foreground">Sample</span>, and in the
        suppliers partner statement.
      </div>
    </SectionCard>
  )
}
