"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleNotch, CaretRight, Package, ArrowSquareOut, Warning, CheckCircle } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { SampleOrderDialog, chatUrl, orderUrl, usd, when } from "@/components/app/sample-orders"
import { AlibabaReceiveDialog } from "@/components/app/alibaba-receive-dialog"
import { getAlibabaOrders, getAlibabaOrder,
         type AlibabaOrderSummary, type AlibabaOrderDetail } from "@/lib/api"

/**
 * OUR buyer orders on Alibaba.
 *
 * Alibaba's list call is deliberately thin — a trade id, a status and two dates, and that
 * is everything they return for a list. What was actually bought lives one call away, per
 * order, so a row EXPANDS rather than the table carrying columns it cannot fill: a "Total"
 * column that reads "—" on every unopened row is a table pretending to know something.
 *
 * Detail is fetched once per order and kept. These are settled purchase records; re-reading
 * one on every toggle spends a signed API call to be told the same thing.
 */

/** Their status vocabulary, grouped into the three answers a buyer actually wants. The
 *  server already maps trade_status → a label; this is only about which ones sit together
 *  behind one filter, and it matches on the LABEL so an unmapped raw status still lands
 *  somewhere rather than vanishing from every filter at once. */
const OPEN_STATUS = /waiting|processing|shipped|paid|confirm|progress|produc/i
const DONE_STATUS = /success|complete|finish|received/i
type Filter = "all" | "open" | "done" | "closed"

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "In progress" },
  { id: "done", label: "Completed" },
  // "Closed", not "Cancelled". It is Alibaba's own word for trade_closed, and it is the
  // bucket anything UNMAPPED falls into — a status they add later would otherwise be
  // filed under a claim we have no basis for. Driven against their six live statuses:
  // unpay / wait_seller_send / wait_confirm_receipt land in progress, trade_success
  // completed, trade_closed and cancel here.
  { id: "closed", label: "Closed" },
]

const bucketOf = (o: AlibabaOrderSummary): Exclude<Filter, "all"> => {
  const s = `${o.statusLabel ?? ""} ${o.status ?? ""}`
  if (DONE_STATUS.test(s)) return "done"
  if (OPEN_STATUS.test(s)) return "open"
  return "closed"
}

const PILL: Record<Exclude<Filter, "all">, string> = {
  open: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  closed: "bg-muted text-muted-foreground",
}

/** `refreshKey` — bumped by the tab shell when this view is re-shown, since it stays
 *  mounted between visits. Alibaba's own statuses move on their side, so re-reading on
 *  each visit is what the remount used to do; the list is replaced in place. */
export function AlibabaOrders({ refreshKey = 0 }: { refreshKey?: number }) {
  const [orders, setOrders] = useState<AlibabaOrderSummary[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  // Which rows are open, and what we've read for them. A Set rather than one id — comparing
  // two orders from the same supplier is the normal reason to open them.
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<Record<string, AlibabaOrderDetail | "loading" | { error: string }>>({})
  // Which order the sample dialog is recording. Held as the trade id, so the dialog can be
  // remounted per order (key=) rather than reset by an effect that renders stale values.
  const [sampling, setSampling] = useState<string | null>(null)
  // Which order is being brought into stock. The DETAIL, not the id — the import needs the
  // lines and the totals, and those only exist once the row has been opened.
  const [receiving, setReceiving] = useState<AlibabaOrderDetail | null>(null)
  // Trade ids already turned into a purchase order this session, so the button can say so
  // instead of inviting a second PO for the same goods.
  const [imported, setImported] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    setErr(null)
    getAlibabaOrders()
      .then((r) => { if (r.error) { setErr(r.error); setOrders([]) } else setOrders(r.orders ?? []) })
      .catch((e) => { setErr(e instanceof Error ? e.message : "Couldn't reach Alibaba."); setOrders([]) })
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load, refreshKey])

  const toggle = (tradeId: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(tradeId)) next.delete(tradeId)
      else next.add(tradeId)
      return next
    })
    // Read it once, the first time it's opened. Closing and reopening costs nothing.
    if (detail[tradeId] === undefined) {
      setDetail((p) => ({ ...p, [tradeId]: "loading" }))
      getAlibabaOrder(tradeId)
        .then((d) => setDetail((p) => ({ ...p, [tradeId]: d.error ? { error: d.error } : d })))
        .catch((e) => setDetail((p) => ({ ...p, [tradeId]: { error: e instanceof Error ? e.message : "Couldn't read that order." } })))
    }
  }

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, open: 0, done: 0, closed: 0 }
    for (const o of orders ?? []) { c.all++; c[bucketOf(o)]++ }
    return c
  }, [orders])

  const rows = (orders ?? []).filter((o) => filter === "all" || bucketOf(o) === filter)

  return (
    // No description: the count it carried is already on the "All 4" pill directly below
    // it, so it restated the next line down and cost the header its calm.
    <SectionCard title="Alibaba orders">
      {orders === null ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
      ) : err ? (
        // An unconnected or expired Alibaba is not an empty order list, and must not look
        // like one — "you have no orders" would be a claim about their account we can't make.
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm">
          <Warning size={22} className="text-amber-500" />
          <p className="max-w-md text-muted-foreground">
            Couldn&apos;t read your Alibaba orders — {err}
          </p>
          <Button size="sm" variant="outline" onClick={load}>Try again</Button>
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <Package size={22} />
          No orders on the connected Alibaba account yet.
        </div>
      ) : (
        <>
          {/* pt-3 matches pb-3: the row had no top padding, so it sat flush against the
              header's rule and the pills read as touching it. */}
          <div className="flex flex-wrap gap-1.5 px-4 pt-3 pb-3">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={"eg-tap rounded-full px-3 py-1 text-xs font-medium transition-colors "
                  + (filter === f.id ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground")}
              >
                {f.label} <span className="opacity-70">{counts[f.id]}</span>
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No orders with that status.</div>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((o) => {
                const isOpen = open.has(o.tradeId)
                const d = detail[o.tradeId]
                const loaded = d && d !== "loading" && !("error" in d) ? d : null
                const bucket = bucketOf(o)
                return (
                  <div key={o.tradeId}>
                    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                      <button onClick={() => toggle(o.tradeId)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <CaretRight size={13} weight="bold" className={"shrink-0 text-muted-foreground transition-transform " + (isOpen ? "rotate-90" : "")} />
                        <span className="font-mono text-sm font-medium">{o.tradeId}</span>
                        <span className="truncate text-sm text-muted-foreground">
                          {when(o.createdAt)}
                          {/* Only once it's known. Before the detail call we have no total
                              and no supplier, and inventing a dash for both in the summary
                              line reads as "this order has none". */}
                          {loaded?.sellerName ? ` · ${loaded.sellerName}` : ""}
                          {loaded?.total != null ? ` · ${usd(loaded.total)}` : ""}
                        </span>
                      </button>
                      <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + PILL[bucket]}>
                        {o.statusLabel || o.status || "Unknown"}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {/* Chat needs the supplier's encrypted id, and that only arrives with
                            the detail — so it appears once the row has been opened rather
                            than sitting there dead. */}
                        {loaded?.sellerEid && (
                          <a href={chatUrl(loaded.sellerEid) ?? "#"} target="_blank" rel="noopener noreferrer"
                             title={`Message ${loaded.sellerName ?? "this supplier"} on Alibaba`}>
                            <Button size="sm" variant="outline">Chat</Button>
                          </a>
                        )}
                        <a href={orderUrl(o.tradeId) ?? "#"} target="_blank" rel="noopener noreferrer"
                           title="Open this order on Alibaba, where payment happens">
                          <Button size="sm" variant="outline"><ArrowSquareOut size={13} weight="bold" /> Pay on Alibaba</Button>
                        </a>
                        <Button size="sm" variant="outline" onClick={() => setSampling(o.tradeId)}
                                title="Record this as a sourcing sample and book its cost to the factory wallet">
                          Record as sample
                        </Button>
                        {/* Bringing it into stock needs the LINES, and those arrive with the
                            detail — so like Chat, this appears once the row is open rather
                            than as a button that would have to ask you to open it first. */}
                        {imported[o.tradeId] ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                title={`Purchase order ${imported[o.tradeId]} created — receive it from the Orders tab`}>
                            <CheckCircle size={11} weight="fill" /> {imported[o.tradeId]}
                          </span>
                        ) : loaded && (
                          <Button size="sm" variant="outline" onClick={() => setReceiving(loaded)}
                                  title="Create a purchase order from this, so the goods can be received into inventory">
                            Into stock
                          </Button>
                        )}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-border bg-muted/20 px-4 py-3">
                        {d === "loading" || d === undefined ? (
                          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                            <CircleNotch size={15} className="animate-spin" /> Reading the order from Alibaba…
                          </div>
                        ) : "error" in d ? (
                          <div className="flex items-center gap-2 py-3 text-sm text-destructive">
                            <Warning size={15} weight="fill" /> {d.error}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead className="border-b border-border text-left eg-label text-muted-foreground">
                                  <tr>
                                    <th className="py-1.5 pr-3">Item</th>
                                    <th className="py-1.5 pr-3">Variant</th>
                                    <th className="py-1.5 pr-3 text-right">Qty</th>
                                    <th className="py-1.5 text-right">Unit</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {d.items.length === 0 ? (
                                    <tr><td colSpan={4} className="py-3 text-muted-foreground">Alibaba returned no lines for this order.</td></tr>
                                  ) : d.items.map((it, i) => (
                                    <tr key={`${it.productId ?? "x"}-${it.skuId ?? i}`}>
                                      <td className="py-1.5 pr-3">
                                        <span className="flex items-center gap-2">
                                          {it.image && (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={it.image} alt="" className="size-8 shrink-0 rounded-lg object-cover" />
                                          )}
                                          <span className="line-clamp-2 min-w-0">{it.name ?? "—"}</span>
                                        </span>
                                      </td>
                                      <td className="py-1.5 pr-3 text-muted-foreground">{it.variant ?? "—"}</td>
                                      <td className="py-1.5 pr-3 text-right tabular-nums">{it.qty ?? "—"}</td>
                                      <td className="py-1.5 text-right tabular-nums">{usd(it.unitPrice)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {/* Goods and freight kept apart, because they are the two numbers
                                a sourcing decision turns on: a $2 cap with $18 of shipping is
                                a different supplier from a $6 cap delivered. */}
                            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                              <span>Goods <span className="font-medium text-foreground">{usd(d.productTotal)}</span></span>
                              <span>Freight <span className="font-medium text-foreground">{usd(d.shipmentFee)}</span></span>
                              <span>Total <span className="font-medium text-foreground">{usd(d.total)}</span></span>
                              {d.tradeTerm && <span>Terms <span className="font-medium text-foreground">{d.tradeTerm}</span></span>}
                              {d.remark && <span>Note <span className="font-medium text-foreground">{d.remark}</span></span>}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Remounted per order (key), so a second "Record as sample" never opens showing the
          first order's figures for a frame. */}
      {sampling && (
        <SampleOrderDialog
          key={sampling}
          open
          onOpenChange={(v) => { if (!v) setSampling(null) }}
          tradeId={sampling}
          onPlaced={() => setSampling(null)}
        />
      )}

      <AlibabaReceiveDialog
        key={receiving?.tradeId ?? "none"}
        order={receiving}
        onClose={() => setReceiving(null)}
        onImported={(poNum) => setImported((p) => ({ ...p, [receiving!.tradeId]: poNum }))}
      />
    </SectionCard>
  )
}
