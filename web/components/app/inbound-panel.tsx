"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleNotch, CaretRight, Check, Warning, Truck } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ProductThumb } from "@/components/app/product-thumb"
import {
  getPurchaseOrders, savePurchaseOrder, getInventory, addInventoryItem, patchInventoryItem,
  type PurchaseOrder, type InventoryItem,
} from "@/lib/api"
import { getToken } from "@/lib/auth"
import { EmptyState } from "@/components/app/empty-state"

const num = (v: unknown) => Number(v) || 0

/**
 * WHAT IS ON ITS WAY HERE — and the one button that puts it on the shelf.
 *
 * A placed purchase order is stock we have paid for and do not yet hold. It lived only on
 * the Purchasing board, which is where you go to BUY; the person who signs for the carton
 * is standing at the Inventory screen, and nothing there said a delivery was expected. So
 * goods arrived, someone typed the counts into the stock table by hand, and the PO sat
 * "placed" forever — the cost never booked, because purchase.js books on receipt.
 *
 * Alibaba orders are here too, with no special case: the Alibaba import writes a real PO at
 * status `placed` (see alibaba-receive-dialog) precisely so there is ONE receiving path.
 * Anything placed by hand for any supplier appears the same way.
 *
 * QUANTITIES ARE EDITABLE, because a short shipment is normal and the alternative is
 * receiving a number nobody counted. They default to what was ordered, so the plain case is
 * still one click.
 *
 * PER-LINE WRITES, never the whole-list upsert. POST /api/inventory replaces the table and
 * deletes any sku missing from the payload — on a floor where a scan gun is writing to the
 * same rows, receiving a carton that way can erase a morning's counts.
 */
export function InboundPanel() {
  const [pos, setPos] = useState<PurchaseOrder[] | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  /** Received-quantity overrides, keyed `${po}|${sku}`. Absent = take the ordered qty. */
  const [qty, setQty] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(() => {
    if (!getToken()) { setPos([]); return }
    getPurchaseOrders().then((r) => setPos(r ?? [])).catch(() => setPos([]))
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  // Placed only. A draft has not been sent to anyone, so nothing is coming; received is
  // already on the shelf.
  const inbound = useMemo(() => (pos ?? []).filter((p) => String(p.status || "") === "placed"), [pos])

  /**
   * One entry per SKU, because that is what the shelf is keyed on.
   *
   * A PO can carry two lines of one sku in different variants. Inventory holds one row per
   * sku, so receiving them as two writes would make the second overwrite-add against a row
   * the first had just moved — they are summed here instead, once, before anything is sent.
   */
  const linesOf = (po: PurchaseOrder) => {
    // `image` rides along with the rest: the rows are folded by sku here, so anything the
    // row wants to SHOW has to survive the fold or it is not available downstream.
    const by = new Map<string, { sku: string; name?: string; variant?: string; qty: number; image?: string | null }>()
    for (const l of po.items ?? []) {
      const k = String(l.sku ?? "").trim().toUpperCase()
      if (!k) continue
      const at = by.get(k)
      if (at) at.qty += num(l.qty)
      else by.set(k, { sku: String(l.sku), name: l.name, variant: l.variant, qty: num(l.qty), image: l.image })
    }
    return [...by.values()]
  }

  const receive = async (po: PurchaseOrder) => {
    setBusy(po.num); setMsg(null)
    try {
      const lines = linesOf(po).map((l) => {
        const typed = qty[`${po.num}|${l.sku}`]
        return { ...l, take: typed === undefined || typed === "" ? l.qty : num(typed) }
      }).filter((l) => l.take > 0)
      if (!lines.length) { setMsg({ ok: false, text: "Nothing to receive — every line is zero." }); setBusy(null); return }

      // Read the shelf as it is NOW, not as it was when this panel loaded: a count typed on
      // the Stock tab, or a scan on the floor, has to be added to rather than replaced.
      const inv: InventoryItem[] = (await getInventory()) ?? []
      const bySku = new Map(inv.map((it) => [String(it.sku).toUpperCase(), it]))
      for (const l of lines) {
        const ex = bySku.get(l.sku.toUpperCase())
        if (ex) await patchInventoryItem(ex.sku, { in_stock: num(ex.in_stock) + l.take })
        else await addInventoryItem({
          sku: l.sku, name: l.name || undefined, variant: l.variant || undefined,
          in_stock: l.take, reorder_at: 25, supplier: po.supplier || undefined,
          // Arriving stock is FACTORY ONLY. Receiving a carton is not a decision to sell it
          // — the same rule the Add-item dialog follows.
          visibility: "factory",
        })
      }
      // Marks the cost as spent: purchase.js books `po-<num>` to the ledger on receipt, once.
      await savePurchaseOrder({ ...po, status: "received", meta: { ...(po.meta || {}), receivedAt: new Date().toISOString() } })
      setMsg({ ok: true, text: `PO ${po.num} received — ${lines.reduce((n, l) => n + l.take, 0)} units added to stock.` })
      load()
    } catch {
      setMsg({ ok: false, text: "Couldn't receive that order. Nothing was marked received." })
    } finally { setBusy(null) }
  }

  const when = (s?: string) => {
    if (!s) return ""
    const d = new Date(s)
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  return (
    <SectionCard title="On its way">
      {msg && (
        <div className={"flex items-center gap-2 border-b border-border px-5 py-2.5 text-sm " + (msg.ok ? "text-success" : "text-destructive")}>
          {msg.ok ? <Check size={14} weight="bold" /> : <Warning size={14} weight="fill" />} {msg.text}
        </div>
      )}
      {pos === null ? (
        <div className="flex justify-center py-10 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
      ) : inbound.length === 0 ? (
        <EmptyState
          icon={Truck}
          size="sm"
          title="Nothing on order"
          note="Purchase orders you place — including Alibaba orders imported from Purchasing — wait here until the goods arrive."
        />
      ) : (
        <div className="divide-y divide-border">
          {inbound.map((po) => {
            const lines = linesOf(po)
            const units = lines.reduce((n, l) => n + l.qty, 0)
            const isOpen = open.has(po.num)
            return (
              <div key={po.num}>
                <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <button
                    type="button"
                    onClick={() => setOpen((p) => { const n = new Set(p); if (n.has(po.num)) n.delete(po.num); else n.add(po.num); return n })}
                    aria-expanded={isOpen}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <CaretRight size={13} weight="bold" className={"shrink-0 text-muted-foreground transition-transform " + (isOpen ? "rotate-90" : "")} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{po.supplier || "Unassigned supplier"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="tabular-nums">{po.num}</span>
                        {" · "}{lines.length} sku{lines.length === 1 ? "" : "s"}{" · "}{units} unit{units === 1 ? "" : "s"}
                        {when(po.created_at) ? ` · placed ${when(po.created_at)}` : ""}
                      </span>
                    </span>
                  </button>
                  <Button size="sm" onClick={() => receive(po)} disabled={busy === po.num}>
                    {busy === po.num ? <CircleNotch size={13} className="animate-spin" /> : null} Receive into stock
                  </Button>
                </div>
                {isOpen && (
                  <div className="border-t border-border bg-muted/20 px-5 py-2">
                    {lines.map((l) => (
                      <div key={l.sku} className="flex items-center gap-3 py-1.5 text-sm">
                        {/* THE PICTURE, because this is the screen where somebody standing at
                            a pallet decides whether the box in their hands is this line. A sku
                            and a supplier title are not how you recognise a garment — the cart
                            and the purchase order both show the thumbnail already, and only
                            the receiving screen, the one that is used with the goods in front
                            of you, did not. POLine has carried `image` all along. */}
                        <ProductThumb src={l.image ?? ""} alt={l.name || l.sku} className="size-10 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{l.name || l.sku}</span>
                          <span className="block truncate tabular-nums text-2xs text-muted-foreground">{l.sku}{l.variant ? ` · ${l.variant}` : ""}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">ordered {l.qty}</span>
                        {/* What actually turned up. Blank means "as ordered" rather than
                            zero — a cleared box must not silently receive nothing. */}
                        <Input
                          value={qty[`${po.num}|${l.sku}`] ?? String(l.qty)}
                          onChange={(e) => setQty((p) => ({ ...p, [`${po.num}|${l.sku}`]: e.target.value.replace(/[^0-9]/g, "") }))}
                          inputMode="numeric"
                          aria-label={`Received quantity for ${l.sku}`}
                          className="h-8 w-16 shrink-0 text-center"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}
