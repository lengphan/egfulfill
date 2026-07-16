"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { Package, CircleNotch, ArrowRight, Truck, CheckCircle, DownloadSimple } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { StageBadge } from "@/components/app/stage-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getOrders, postItemStatus, updateOrder, type OrderRow, type OrderItem } from "@/lib/api"
import { getToken } from "@/lib/auth"
import { normalizeStage, nextStage, stageMeta, orderStage } from "@/lib/factory-status"

const numOf = (o: OrderRow) => (o.seq ? `#${o.seq}` : o.id)
const variantOf = (it: OrderItem) => [it.color, it.size, it.print_type].filter(Boolean).join(" · ")
const addrLine = (o: OrderRow) => {
  const a = (o.address ?? {}) as Record<string, string>
  return [a.city, a.state, a.zip].filter(Boolean).join(", ")
}

const CARRIERS = ["USPS", "UPS", "FedEx", "DHL", "Other"]

// Warehouse cares about the later stages: receive → pack → ship.
type Tab = "Intake" | "Queue" | "Ready to ship" | "Shipped"
const TABS: Tab[] = ["Intake", "Queue", "Ready to ship", "Shipped"]
const inTab = (o: OrderRow, tab: Tab) => {
  const s = orderStage(o.items ?? [])
  if (tab === "Intake") return s === ""
  if (tab === "Queue") return ["queued", "printing", "qc"].includes(s)
  if (tab === "Ready to ship") return s === "packed"
  return s === "shipped"
}

export function WarehouseBoard() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [tab, setTab] = useState<Tab>("Intake")
  const [busy, setBusy] = useState<string | null>(null)
  const [shipOpen, setShipOpen] = useState<string | null>(null)
  const [carrier, setCarrier] = useState("USPS")
  const [tracking, setTracking] = useState("")

  const load = useCallback(() => {
    if (!getToken()) { setOrders([]); return }
    getOrders().then((rows) => setOrders(rows ?? [])).catch(() => setOrders([]))
  }, [])
  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [load])

  const patchItem = (orderId: string, sku: string, to: string) =>
    setOrders((prev) => (prev ?? []).map((o) => (o.id !== orderId ? o : { ...o, items: (o.items ?? []).map((it) => (it.sku === sku ? { ...it, factory_status: to } : it)) })))

  const advanceItem = async (order: OrderRow, item: OrderItem, to: string) => {
    if (!item.sku) return
    const key = `${order.id}:${item.sku}`
    setBusy(key)
    patchItem(order.id, item.sku, to)
    try { await postItemStatus(order.id, item.sku, to) } catch { load() } finally { setBusy(null) }
  }

  // Receive an intake order → move every item into the print queue.
  const receiveOrder = async (order: OrderRow) => {
    for (const it of order.items ?? []) if (it.sku && !normalizeStage(it.factory_status)) await advanceItem(order, it, "queued")
  }
  const advanceOrder = async (order: OrderRow) => {
    for (const it of order.items ?? []) {
      const to = nextStage(it.factory_status)
      if (to && to !== "shipped") await advanceItem(order, it, to)
    }
  }

  // Ship: mark every line shipped + record tracking/carrier on the order.
  const shipOrder = async (order: OrderRow) => {
    setBusy(`ship:${order.id}`)
    try {
      for (const it of order.items ?? []) if (it.sku) { patchItem(order.id, it.sku, "shipped"); await postItemStatus(order.id, it.sku, "shipped") }
      await updateOrder(order.id, { tracking: tracking.trim() || undefined, carrier, factoryStatus: "shipped", status: "shipped" })
      setShipOpen(null); setTracking("")
      load()
    } catch {
      load()
    } finally {
      setBusy(null)
    }
  }

  const stats = useMemo(() => {
    const list = orders ?? []
    const c = (tb: Tab) => list.filter((o) => inTab(o, tb)).length
    return { intake: c("Intake"), queue: c("Queue"), ship: c("Ready to ship"), shipped: c("Shipped") }
  }, [orders])

  const filtered = useMemo(() => (orders ?? []).filter((o) => inTab(o, tab)), [orders, tab])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Package size={18} weight="fill" /></span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Warehouse</h1>
          <p className="text-sm text-muted-foreground">Intake, pack, and ship orders out the door.</p>
        </div>
      </div>

      <StatGrid>
        <StatCard label="To receive" value={String(stats.intake)} sub="new intake" tone={stats.intake ? "neg" : undefined} />
        <StatCard label="In queue" value={String(stats.queue)} sub="printing / QC" />
        <StatCard label="Ready to ship" value={String(stats.ship)} sub="packed" tone={stats.ship ? "pos" : undefined} />
        <StatCard label="Shipped" value={String(stats.shipped)} sub="out the door" />
      </StatGrid>

      <SectionCard title="Fulfillment">
        <div className="flex flex-wrap gap-1.5 border-b border-border px-5 py-3">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={"rounded-full px-3 py-1 text-sm font-medium transition-colors " + (tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t}
            </button>
          ))}
        </div>

        {orders === null ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Package size={24} weight="duotone" />
            <div className="font-medium text-foreground">Nothing here</div>
            <div className="text-sm">No orders in “{tab}”.</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((o) => {
              const items = o.items ?? []
              return (
                <div key={o.id} className="p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{numOf(o)}</span>
                      <StageBadge status={orderStage(items)} />
                      <span className="text-sm text-muted-foreground">{o.customer?.name || "—"}</span>
                      {addrLine(o) && <span className="text-xs text-muted-foreground">· {addrLine(o)}</span>}
                    </div>
                    {tab === "Intake" && (
                      <Button size="sm" onClick={() => receiveOrder(o)} disabled={busy?.startsWith(o.id)}>
                        Receive <ArrowRight size={13} weight="bold" />
                      </Button>
                    )}
                    {tab === "Queue" && (
                      <Button size="sm" variant="outline" onClick={() => advanceOrder(o)}>Advance all <ArrowRight size={13} weight="bold" /></Button>
                    )}
                    {tab === "Ready to ship" && shipOpen !== o.id && (
                      <Button size="sm" onClick={() => { setShipOpen(o.id); setCarrier("USPS"); setTracking("") }}>
                        <Truck size={14} weight="bold" /> Ship
                      </Button>
                    )}
                    {tab === "Shipped" && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                        <CheckCircle size={14} weight="fill" /> {o.carrier || "Shipped"}{o.tracking ? ` · ${o.tracking}` : ""}
                      </span>
                    )}
                  </div>

                  {/* Ship form */}
                  {tab === "Ready to ship" && shipOpen === o.id && (
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
                      const to = tab === "Ready to ship" ? null : nextStage(it.factory_status)
                      const toMeta = to && to !== "shipped" ? stageMeta(to) : null
                      const key = `${o.id}:${it.sku}`
                      return (
                        <div key={it.sku ?? i} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                          <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                            {it.img ? <Image src={it.img} alt="" fill unoptimized sizes="48px" className="object-cover" /> : <div className="flex size-full items-center justify-center text-muted-foreground/50"><Package size={16} weight="duotone" /></div>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{it.name || it.sku || "Item"}</div>
                            <div className="truncate text-xs text-muted-foreground">{variantOf(it) || "—"}{it.qty ? ` · ×${it.qty}` : ""}</div>
                          </div>
                          <StageBadge status={it.factory_status} />
                          {tab === "Queue" && toMeta && (
                            <Button size="sm" disabled={busy === key} onClick={() => advanceItem(o, it, to!)} className="shrink-0">
                              {busy === key ? <CircleNotch size={13} className="animate-spin" /> : <>→ {toMeta.label}</>}
                            </Button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <DownloadSimple size={12} /> Label buying via EasyPost/USPS can be wired here next — for now enter the tracking number when you ship.
      </p>
    </div>
  )
}
