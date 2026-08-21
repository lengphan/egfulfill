"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { MagnifyingGlass, CircleNotch, Warning, CheckCircle, LinkSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { assignDesignCard, getOrders, type DesignCard, type OrderRow, type OrderItem } from "@/lib/api"
import { numOf, variantOf } from "@/lib/order-format"

/**
 * Attach a manual card to an order line.
 *
 * A LINE, not an order. Two lines of the same SKU are different jobs — the same shirt with
 * two different personalisations — so an order-only picker would attach the artwork to
 * whichever of them the query happened to return first and silently flip the wrong one.
 * That is why the second step exists even when an order has only one line: the habit of
 * choosing is what makes the two-line case safe.
 *
 * Assigning writes the artwork into the order's designs server-side, so the order's design
 * tag lights up in the same action. Without that you get a card pointing at an order that
 * reports no artwork — two tables each honestly describing their own contents and
 * disagreeing about the world.
 */
export function AssignCardDialog({ card, open, onOpenChange, onDone }: {
 card: DesignCard | null
 open: boolean
 onOpenChange: (v: boolean) => void
 onDone?: () => void
}) {
 const [orders, setOrders] = useState<OrderRow[] | null>(null)
 const [q, setQ] = useState("")
 const [picked, setPicked] = useState<OrderRow | null>(null)
 const [line, setLine] = useState<OrderItem | null>(null)
 const [busy, setBusy] = useState(false)
 const [err, setErr] = useState<string | null>(null)
 const [done, setDone] = useState(false)

 const reset = useCallback(() => {
 setQ(""); setPicked(null); setLine(null); setErr(null); setDone(false)
  }, [])

 useEffect(() => {
 if (!open) return
 const t = setTimeout(() => {
 reset()
 getOrders().then((r) => setOrders(r ?? [])).catch(() => setOrders([]))
    }, 0)
 return () => clearTimeout(t)
  }, [open, reset])

  // Search covers the order number and the customer — the two things someone holding a
  // loose design actually knows about where it belongs.
 const matches = useMemo(() => {
 const term = q.trim().toLowerCase()
 if (!term) return []
 return (orders ?? [])
      .filter((o) => [numOf(o), o.customer?.name, o.store].some((f) => String(f ?? "").toLowerCase().includes(term)))
      .slice(0, 8)
  }, [orders, q])

 const submit = async () => {
 if (!card || !picked || !line) return
 const sku = String(line.sku ?? "").trim()
 if (!sku) { setErr("That line has no SKU, so there's nothing to key the design to."); return }
 setBusy(true); setErr(null)
 try {
 const r = await assignDesignCard(String(card.id), {
 orderId: String(picked.id), sku, lineId: line.line_id ? String(line.line_id) : undefined,
      })
 if (r.error) throw new Error(r.error)
 setDone(true)
 onDone?.()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

 return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkSimple size={17} weight="duotone" /> Assign to an order
          </DialogTitle>
          <DialogDescription>
            {card?.title ? `“${card.title}” ` : "This card "}
 joins the order&apos;s normal flow, and its artwork attaches to the line you pick.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0" />
            <span>
              Attached to <strong>{picked ? numOf(picked) : "the order"}</strong>. Its design tag
 will show the artwork — the card now moves with that order.
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="ac-q" className="mb-1 block text-xs font-medium">Find the order</label>
              <div className="relative">
                <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input id="ac-q" value={q}
 onChange={(e) => { setQ(e.target.value); setPicked(null); setLine(null) }}
 placeholder="Order number, customer or store…" className="h-9 pl-8" />
              </div>
            </div>

            {orders === null ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <CircleNotch size={14} className="animate-spin" /> Loading orders…
              </div>
            ) : picked ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                  <span className="tabular-nums text-xs">{numOf(picked)}</span>
                  <span className="truncate text-muted-foreground">{picked.customer?.name ?? "—"}</span>
                  <Button size="sm" variant="ghost" className="ml-auto"
 onClick={() => { setPicked(null); setLine(null) }}>Change</Button>
                </div>
                <div>
                  <span className="mb-1 block text-xs font-medium">Which line?</span>
                  {(picked.items ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">This order has no lines to attach to.</p>
                  ) : (
                    <div className="space-y-1">
                      {(picked.items ?? []).map((it, i) => {
 const on = line === it
 return (
                          <button
 key={String(it.line_id ?? it.sku ?? i)}
 onClick={() => setLine(it)}
 className={"flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors " +
                              (on ? "border-primary bg-primary/5" : "border-border hover:bg-accent")}
                          >
                            <span className="min-w-0 flex-1 truncate">{it.name ?? it.sku ?? "Line"}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{variantOf(it)}</span>
                            <span className="shrink-0 tabular-nums text-2xs text-muted-foreground">{it.sku}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : q.trim() === "" ? (
              <p className="py-3 text-xs text-muted-foreground">Type an order number or a customer name.</p>
            ) : matches.length === 0 ? (
              <p className="py-3 text-xs text-muted-foreground">Nothing matches “{q}”.</p>
            ) : (
              <div className="space-y-1">
                {matches.map((o) => (
                  <button key={o.id} onClick={() => setPicked(o)}
 className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent">
                    <span className="shrink-0 tabular-nums text-xs">{numOf(o)}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{o.customer?.name ?? "—"}</span>
                    <span className="shrink-0 text-2xs text-muted-foreground">{(o.items ?? []).length} lines</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-hold/30 bg-hold/10 px-3 py-2 text-xs text-hold">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{done ? "Done" : "Cancel"}</Button>
          {!done && (
            <Button onClick={submit} disabled={busy || !picked || !line}>
              {busy ? <CircleNotch size={14} className="animate-spin" /> : "Attach to this line"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
