"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, X, Package, Warning, ChatCircleDots, ArrowSquareOut, DownloadSimple } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useConfirm } from "@/components/app/confirm-dialog"
import { getSampleOrders, placeSampleOrder, setSampleOrderStatus, getAlibabaOrder,
 type SampleOrder } from "@/lib/api"

export const usd = (n?: number | null) =>
 n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const when = (iso?: string | null) => {
 if (!iso) return "—"
 const d = new Date(iso)
 return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

/**
 * PORTING OUT TO ALIBABA.
 *
 * In-site chat is not possible: their open API exposes no messages (probed 2026-08-10), so
 * the best we can do is land you on the right page in one click. Both URLs below were
 * checked against the live site — signed out they 302 to Alibaba's login, which is what a
 * real Alibaba route does; a wrong one 404s or 502s, and two candidates did exactly that.
 *
 * `sellerEid` is their encrypted supplier id and only ever comes from the ORDER payload —
 * the product search returns no seller at all — so a sample typed in by hand has no chat
 * link, and one imported from a real order does.
 */
export const chatUrl = (eid?: string | null) =>
 eid ? `https://message.alibaba.com/message/messenger.htm?to=${encodeURIComponent(eid)}` : null
export const orderUrl = (tradeId?: string | null) =>
 tradeId ? `https://biz.alibaba.com/ta/detail.htm?orderId=${encodeURIComponent(tradeId)}` : null

const STATUS: Record<SampleOrder["status"], { label: string; pill: string }> = {
 placed: { label: "Placed", pill: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" },
 received: { label: "Received", pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
 cancelled: { label: "Cancelled", pill: "bg-muted text-muted-foreground" },
}

/**
 * Record a sample order that has just been placed.
 *
 * Two ways in, and they want different things from this form:
 *
 *   - From an ALIBABA ORDER (`tradeId`) — the order is already on screen in the order
 * history, so this pulls its detail and prefills. It used to get there through a
 * dropdown listing every Alibaba order inside this dialog, which was a second, worse
 * copy of that list: no lines, no totals, no way to tell two same-day orders apart
 * beyond their number. Picking the order is the order history's job; this fills in
 * what was picked.
 *   - By HAND — a sample bought somewhere with no API behind it. Same four facts, typed.
 *
 * Prefilled fields stay editable either way: their total is what the supplier billed, and
 * what we consider the sample to have cost is occasionally not the same number.
 */
export function SampleOrderDialog({
 open,
 onOpenChange,
 supplierId,
 supplierTitle,
 tradeId,
 onPlaced,
}: {
 open: boolean
 onOpenChange: (v: boolean) => void
 supplierId?: string
 supplierTitle?: string
  /** An Alibaba order to prefill from. Omitted = the hand-typed form. */
 tradeId?: string
 onPlaced?: () => void
}) {
 const [orderNo, setOrderNo] = useState("")
 const [amount, setAmount] = useState("")
 const [qty, setQty] = useState("")
 const [note, setNote] = useState("")
 const [busy, setBusy] = useState(false)
 const [err, setErr] = useState<string | null>(null)
 const [picked, setPicked] = useState<string>("")
 const [pulling, setPulling] = useState(false)
 const [seller, setSeller] = useState<{ eid?: string | null; name?: string | null }>({})

  // Pull one order's detail and fill the form from it. Nothing is saved until you press
  // the button — this only ever writes into the fields you can still edit.
  // Declared ABOVE the effect that calls it: reading it earlier is a use-before-declare the
  // hooks lint refuses, and it is right to — the effect would close over the wrong one.
 const pull = useCallback(async (id: string) => {
 setPicked(id)
 if (!id) { setSeller({}); return }
 setPulling(true); setErr(null)
 try {
 const d = await getAlibabaOrder(id)
 if (d.error) throw new Error(d.error)
 setOrderNo(d.tradeId)
      // Their TOTAL, not the product subtotal: freight on a sample is part of what the
      // answer cost, and on a real one of these it is a third of the bill.
 if (d.total != null) setAmount(String(d.total))
 const units = (d.items ?? []).reduce((n, it) => n + (it.qty ?? 0), 0)
 if (units > 0) setQty(String(Math.round(units)))
 setNote([d.remark, (d.items ?? []).map((it) => it.name).filter(Boolean)[0]].filter(Boolean).join(" · ").slice(0, 200))
 setSeller({ eid: d.sellerEid, name: d.sellerName })
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't read that order from Alibaba.")
    } finally { setPulling(false) }
  }, [])

 useEffect(() => {
 if (!open) return
 const id = setTimeout(() => {
 setOrderNo(""); setAmount(""); setQty(""); setNote(""); setErr(null); setPicked(""); setSeller({})
 if (tradeId) void pull(tradeId)
    }, 0)
 return () => clearTimeout(id)
  }, [open, tradeId, pull])

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
 tradeId: picked || undefined,
 sellerEid: seller.eid || undefined,
 sellerName: seller.name || undefined,
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
          {/* Only when this was opened FROM an order — otherwise there is nothing being
 read and a status line about reading would be describing nothing. */}
          {tradeId && (
            <div className="rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">
              <DownloadSimple size={13} weight="bold" className="mr-1 inline" />
              {/* Supplier names routinely END in a full stop ("… Co., Ltd."), so a sentence
 joined straight on gives "Ltd.. Everything". Separated instead. */}
              {pulling ? `Reading Alibaba order ${tradeId}…`
 : seller.name ? `From Alibaba order ${tradeId} · ${seller.name} — everything below is prefilled, edit anything that's wrong.`
 : `From Alibaba order ${tradeId}.`}
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Supplier&apos;s order number</span>
            <Input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="ALI-88213-7" className="h-9 tabular-nums" />
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
            The cost books to the <span className="font-medium text-foreground">factory</span>{" "}wallet now, not when the parcel
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
          No samples recorded yet. Record one from a supplier&apos;s row and its cost books straight to the factory wallet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left eg-label text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Order no.</th>
                <th className="px-4 py-2.5">Supplier</th>
                <th className="px-4 py-2.5 text-right">Cost</th>
                <th className="px-4 py-2.5 text-right">Units</th>
                <th className="px-4 py-2.5">Placed</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <div className="tabular-nums text-xs">{s.orderNo || "—"}</div>
                    {(chatUrl(s.sellerEid) || orderUrl(s.tradeId)) && (
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        {chatUrl(s.sellerEid) && (
                          <a href={chatUrl(s.sellerEid)!} target="_blank" rel="noopener noreferrer"
 title={`Open the Alibaba chat with ${s.sellerName || "this supplier"} — you'll need to be signed in there`}
 className="inline-flex items-center gap-1 text-primary hover:underline">
                            <ChatCircleDots size={12} weight="bold" /> Chat
                          </a>
                        )}
                        {orderUrl(s.tradeId) && (
                          <a href={orderUrl(s.tradeId)!} target="_blank" rel="noopener noreferrer"
 title="Open this order on Alibaba — where you pay it"
 className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline">
                            <ArrowSquareOut size={12} /> Order
                          </a>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="max-w-[240px] truncate">{s.supplierTitle || s.sellerName || "—"}</div>
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
                            Arrived
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
      <div className="flex items-start gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        <Warning size={14} weight="fill" className="mt-0.5 shrink-0 text-hold" />
        Booked at place time, so a sample that never arrives still shows as spent — which it is.
        It appears in Finance under <span className="font-medium text-foreground">Sample</span>, and in the
 suppliers partner statement.
      </div>
    </SectionCard>
  )
}
