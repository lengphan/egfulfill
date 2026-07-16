"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { Package, CircleNotch, ArrowRight, CheckCircle, PenNib, Truck } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { StageBadge } from "@/components/app/stage-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getOrders, postItemStatus, updateOrder, getDesignCards, saveDesignCards, type OrderRow, type OrderItem, type DesignCard } from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"
import { FACTORY_STAGES, EXCEPTION_STAGES, ALL_STATUSES, normalizeStage, nextStage, stageMeta, orderStage, isException } from "@/lib/factory-status"
import { itemImage } from "@/lib/order-image"
import { usePaged, Pagination } from "@/components/app/pagination"

const numOf = (o: OrderRow) => (o.seq ? `#${o.seq}` : o.id)
const variantOf = (it: OrderItem) => [it.color, it.size, it.print_type].filter(Boolean).join(" · ")
const addrLine = (o: OrderRow) => {
  const a = (o.address ?? {}) as Record<string, string>
  return [a.city, a.state, a.zip].filter(Boolean).join(", ")
}
const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
const nowId = () => Date.now()
const CARRIERS = ["USPS", "UPS", "FedEx", "DHL", "Other"]

// Filters derive from the canonical pipeline so they always match the status model.
const FILTERS: { label: string; id: string }[] = [
  { label: "All", id: "all" },
  { label: "New", id: "" },
  ...FACTORY_STAGES.map((s) => ({ label: s.label, id: s.id })),
  { label: "Issues", id: "issues" },
]

// ONE order page for the whole factory team. The queue + item controls are shared; the
// action set adapts to the role: operators review artwork + drive production, warehouse
// receives + ships, admin does everything.
export function OrdersHub() {
  const role = getUser()?.role || ""
  const isAdmin = role === "admin"
  const canFulfill = role === "warehouse" || isAdmin // receive (intake) + ship
  const canDesign = role === "operator" || isAdmin // send to designer + set arbitrary status

  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [filter, setFilter] = useState("all")
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState<Set<string>>(new Set())
  const [shipOpen, setShipOpen] = useState<string | null>(null)
  const [carrier, setCarrier] = useState("USPS")
  const [tracking, setTracking] = useState("")

  const load = useCallback(() => {
    if (!getToken()) { setOrders([]); return }
    getOrders().then((rows) => setOrders(rows ?? [])).catch(() => setOrders([]))
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  const patchItem = (orderId: string, sku: string, to: string) =>
    setOrders((prev) => (prev ?? []).map((o) => (o.id !== orderId ? o : { ...o, items: (o.items ?? []).map((it) => (it.sku === sku ? { ...it, factory_status: to } : it)) })))

  const advanceItem = async (order: OrderRow, item: OrderItem, to: string) => {
    if (!item.sku) return
    const key = `${order.id}:${item.sku}`
    setBusy(key)
    patchItem(order.id, item.sku, to)
    try { await postItemStatus(order.id, item.sku, to) } catch { load() } finally { setBusy(null) }
  }
  const advanceOrder = async (order: OrderRow) => {
    for (const it of order.items ?? []) {
      const to = nextStage(it.factory_status)
      if (to && to !== "shipped") await advanceItem(order, it, to)
    }
  }
  // Warehouse intake: move every unstarted item into the scan flow.
  const receiveOrder = async (order: OrderRow) => {
    for (const it of order.items ?? []) if (it.sku && !normalizeStage(it.factory_status)) await advanceItem(order, it, "awaiting_scan")
  }
  // Ship: mark every line shipped + record tracking/carrier on the order.
  const shipOrder = async (order: OrderRow) => {
    setBusy(`ship:${order.id}`)
    try {
      for (const it of order.items ?? []) if (it.sku) { patchItem(order.id, it.sku, "shipped"); await postItemStatus(order.id, it.sku, "shipped") }
      await updateOrder(order.id, { tracking: tracking.trim() || undefined, carrier, factoryStatus: "shipped", status: "shipped" })
      setShipOpen(null); setTracking(""); load()
    } catch { load() } finally { setBusy(null) }
  }
  // Send a line item to the Designer board as a new card (whole-board upsert).
  const sendToDesigner = async (o: OrderRow, it: OrderItem) => {
    const key = `${o.id}:${it.sku}`
    setBusy(`dsn:${key}`)
    try {
      const cards = await getDesignCards().catch(() => [])
      const dup = (cards ?? []).some((c) => c.order_id === o.id && c.sku === it.sku)
      if (!dup) {
        const card: DesignCard = {
          id: nowId(), order_id: o.id, sku: it.sku || undefined,
          title: it.name || it.sku || "Design", product: variantOf(it),
          type: it.print_type || undefined, thumb: itemImage(it) || null,
          col: "incoming", pay_status: "pending", payment: 0,
          customer: o.customer?.name ?? null, is_emb: /emb/i.test(it.print_type || ""),
        }
        await saveDesignCards([...(cards ?? []), card])
      }
      setSent((prev) => new Set(prev).add(key))
    } catch { /* ignore */ } finally { setBusy(null) }
  }

  const stats = useMemo(() => {
    const list = orders ?? []
    const by = (id: string) => list.filter((o) => orderStage(o.items ?? []) === id).length
    const inProd = ["awaiting_scan", "scanned", "printing", "packing"]
    return {
      newCount: by(""),
      production: list.filter((o) => inProd.includes(orderStage(o.items ?? []))).length,
      ready: by("packing"),
      shipped: by("shipped"),
    }
  }, [orders])

  const filtered = useMemo(() => {
    const list = orders ?? []
    if (filter === "all") return list
    if (filter === "issues") return list.filter((o) => isException(orderStage(o.items ?? [])))
    return list.filter((o) => orderStage(o.items ?? []) === filter)
  }, [orders, filter])

  const paged = usePaged(filtered, 25)

  const subtitle = isAdmin
    ? "Every order across the team — production to shipping."
    : canFulfill ? "Receive, pack, and ship orders out the door."
      : "Review artwork and drive orders through production."

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Package size={18} weight="fill" /></span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <StatGrid>
        <StatCard label="New" value={String(stats.newCount)} sub="awaiting start" tone={stats.newCount ? "neg" : undefined} />
        <StatCard label="In production" value={String(stats.production)} sub="scan → pack" />
        <StatCard label="Ready to ship" value={String(stats.ready)} sub="packed" tone={stats.ready ? "pos" : undefined} />
        <StatCard label="Shipped" value={String(stats.shipped)} sub="complete" tone="pos" />
      </StatGrid>

      <SectionCard title="Production queue">
        <div className="flex flex-wrap gap-1.5 border-b border-border px-5 py-3">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={"rounded-full px-3 py-1 text-sm font-medium transition-colors " + (filter === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {f.label}
            </button>
          ))}
        </div>

        {orders === null ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Package size={24} weight="duotone" />
            <div className="font-medium text-foreground">Nothing here</div>
            <div className="text-sm">{(orders.length ?? 0) === 0 ? "No orders are in production yet." : "No orders match this filter."}</div>
          </div>
        ) : (
          <>
          <div className="divide-y divide-border">
            {paged.pageItems.map((o) => {
              const items = o.items ?? []
              const stage = orderStage(items)
              const allShipped = items.length > 0 && items.every((it) => normalizeStage(it.factory_status) === "shipped")
              return (
                <div key={o.id} className="p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{numOf(o)}</span>
                      <StageBadge status={stage} />
                      <span className="text-sm text-muted-foreground">{o.customer?.name || "—"}</span>
                      <span className="text-xs text-muted-foreground">· {(o.store || o.source || "manual")} · {fmtDate(o.created_at)}{addrLine(o) ? ` · ${addrLine(o)}` : ""}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {canFulfill && stage === "" && (
                        <Button size="sm" onClick={() => receiveOrder(o)} disabled={busy?.startsWith(o.id)}>Receive <ArrowRight size={13} weight="bold" /></Button>
                      )}
                      {allShipped ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle size={14} weight="fill" /> {o.carrier || "Shipped"}{o.tracking ? ` · ${o.tracking}` : ""}</span>
                      ) : (
                        <>
                          {canFulfill && stage === "packing" && shipOpen !== o.id && (
                            <Button size="sm" onClick={() => { setShipOpen(o.id); setCarrier("USPS"); setTracking("") }}><Truck size={14} weight="bold" /> Ship</Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => advanceOrder(o)}>Advance all <ArrowRight size={13} weight="bold" /></Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Ship form (warehouse/admin) */}
                  {canFulfill && shipOpen === o.id && (
                    <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/30 p-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">Carrier</span>
                        <select value={carrier} onChange={(e) => setCarrier(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                          {CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-1 flex-col gap-1">
                        <span className="text-xs text-muted-foreground">Tracking number (optional)</span>
                        <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="e.g. 9400 1000 0000 0000 0000 00" className="h-9" />
                      </label>
                      <Button size="sm" onClick={() => shipOrder(o)} disabled={busy === `ship:${o.id}`}>
                        {busy === `ship:${o.id}` ? <CircleNotch size={14} className="animate-spin" /> : <><Truck size={14} weight="bold" /> Mark shipped</>}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setShipOpen(null)}>Cancel</Button>
                    </div>
                  )}

                  <div className="space-y-2">
                    {items.map((it, i) => {
                      const to = nextStage(it.factory_status)
                      const toMeta = to ? stageMeta(to) : null
                      const key = `${o.id}:${it.sku}`
                      const img = itemImage(it)
                      return (
                        <div key={it.sku ?? i} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2.5">
                          <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                            {img ? <Image src={img} alt="" fill unoptimized sizes="48px" className="object-cover" /> : <div className="flex size-full items-center justify-center text-muted-foreground/50"><Package size={16} weight="duotone" /></div>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{it.name || it.sku || "Item"}</div>
                            <div className="truncate text-xs text-muted-foreground">{variantOf(it) || "—"}{it.qty ? ` · ×${it.qty}` : ""}</div>
                          </div>
                          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                          {canDesign && (
                            <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-primary" title="Send to designer board" disabled={busy === `dsn:${key}` || sent.has(key)} onClick={() => sendToDesigner(o, it)}>
                              {busy === `dsn:${key}` ? <CircleNotch size={13} className="animate-spin" /> : sent.has(key) ? <CheckCircle size={14} weight="fill" className="text-emerald-600" /> : <PenNib size={14} weight="bold" />}
                            </Button>
                          )}
                          <StageBadge status={it.factory_status} />
                          {canDesign && (
                            <select value={normalizeStage(it.factory_status)} onChange={(e) => advanceItem(o, it, e.target.value)} disabled={busy === key} className="h-8 shrink-0 rounded-md border border-input bg-transparent px-1.5 text-xs" aria-label="Set status" title="Set status">
                              <optgroup label="Production">
                                {ALL_STATUSES.filter((s) => !EXCEPTION_STAGES.some((x) => x.id === s.id)).map((s) => <option key={s.id || "new"} value={s.id}>{s.label}</option>)}
                              </optgroup>
                              <optgroup label="Exceptions">
                                {EXCEPTION_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                              </optgroup>
                            </select>
                          )}
                          {to ? (
                            <Button size="sm" disabled={busy === key} onClick={() => advanceItem(o, it, to)} className="shrink-0">
                              {busy === key ? <CircleNotch size={13} className="animate-spin" /> : <>{toMeta?.label}</>}
                            </Button>
                          ) : (
                            <span className="inline-flex shrink-0 items-center gap-1 px-2 text-xs font-medium text-emerald-600"><CheckCircle size={14} weight="fill" /> {isException(it.factory_status) ? stageMeta(normalizeStage(it.factory_status))?.label : "Done"}</span>
                          )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <Pagination page={paged.page} pageCount={paged.pageCount} perPage={paged.perPage} total={paged.total} start={paged.start} onPage={paged.setPage} onPerPage={paged.setPerPage} perPageOptions={[25, 50, 100]} />
          </>
        )}
      </SectionCard>

      <p className="text-center text-xs text-muted-foreground">Stages: {FACTORY_STAGES.map((s) => s.label).join(" → ")}</p>
    </div>
  )
}
