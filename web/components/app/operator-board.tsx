"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { Printer, Package, CircleNotch, ArrowRight, CheckCircle } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { getOrders, postItemStatus, type OrderRow, type OrderItem } from "@/lib/api"
import { getToken } from "@/lib/auth"
import { FACTORY_STAGES, TONE_CLASS, normalizeStage, nextStage, stageMeta, orderStage } from "@/lib/factory-status"

const numOf = (o: OrderRow) => (o.seq ? `#${o.seq}` : o.id)
const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
const variantOf = (it: OrderItem) => [it.color, it.size, it.print_type].filter(Boolean).join(" · ")

type Filter = "All" | "New" | "Queued" | "Printing" | "QC" | "Packed" | "Shipped"
const FILTERS: Filter[] = ["All", "New", "Queued", "Printing", "QC", "Packed", "Shipped"]
const filterId = (f: Filter) => (f === "New" ? "" : f.toLowerCase())

function StageBadge({ status }: { status?: string | null }) {
  const id = normalizeStage(status)
  if (!id) return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">New</span>
  const m = stageMeta(id)
  return <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + (m ? TONE_CLASS[m.tone] : "bg-muted")}>{m?.label ?? id}</span>
}

export function OperatorBoard() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [filter, setFilter] = useState<Filter>("All")
  const [busy, setBusy] = useState<string | null>(null) // `${id}:${sku}` in flight

  const load = useCallback(() => {
    if (!getToken()) { setOrders([]); return }
    getOrders().then((rows) => setOrders(rows ?? [])).catch(() => setOrders([]))
  }, [])
  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [load])

  // Patch one item's factory_status locally (optimistic), then persist.
  const advanceItem = async (order: OrderRow, item: OrderItem, to: string) => {
    if (!item.sku) return
    const key = `${order.id}:${item.sku}`
    setBusy(key)
    setOrders((prev) =>
      (prev ?? []).map((o) =>
        o.id !== order.id ? o : { ...o, items: (o.items ?? []).map((it) => (it.sku === item.sku ? { ...it, factory_status: to } : it)) }
      )
    )
    try {
      await postItemStatus(order.id, item.sku, to)
    } catch {
      load() // revert to server truth
    } finally {
      setBusy(null)
    }
  }

  // Advance every not-yet-shipped item in an order one step.
  const advanceOrder = async (order: OrderRow) => {
    for (const it of order.items ?? []) {
      const to = nextStage(it.factory_status)
      if (to) await advanceItem(order, it, to)
    }
  }

  const stats = useMemo(() => {
    const list = orders ?? []
    const by = (id: string) => list.filter((o) => orderStage(o.items ?? []) === id).length
    return {
      newCount: by(""),
      printing: list.filter((o) => ["queued", "printing"].includes(orderStage(o.items ?? []))).length,
      qc: by("qc"),
      shipped: by("shipped"),
    }
  }, [orders])

  const filtered = useMemo(() => {
    const list = orders ?? []
    if (filter === "All") return list
    return list.filter((o) => orderStage(o.items ?? []) === filterId(filter))
  }, [orders, filter])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Printer size={18} weight="fill" /></span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Operator</h1>
          <p className="text-sm text-muted-foreground">Review artwork and drive orders through production.</p>
        </div>
      </div>

      <StatGrid>
        <StatCard label="New" value={String(stats.newCount)} sub="awaiting start" tone={stats.newCount ? "neg" : undefined} />
        <StatCard label="In production" value={String(stats.printing)} sub="queued / printing" />
        <StatCard label="In QC" value={String(stats.qc)} sub="quality check" />
        <StatCard label="Shipped" value={String(stats.shipped)} sub="complete" tone="pos" />
      </StatGrid>

      <SectionCard title="Production queue">
        <div className="flex flex-wrap gap-1.5 border-b border-border px-5 py-3">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={"rounded-full px-3 py-1 text-sm font-medium transition-colors " + (filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {f}
            </button>
          ))}
        </div>

        {orders === null ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Package size={24} weight="duotone" />
            <div className="font-medium text-foreground">Nothing here</div>
            <div className="text-sm">{(orders.length ?? 0) === 0 ? "No orders are in production yet." : "No orders match this filter."}</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((o) => {
              const items = o.items ?? []
              const allShipped = items.length > 0 && items.every((it) => normalizeStage(it.factory_status) === "shipped")
              return (
                <div key={o.id} className="p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{numOf(o)}</span>
                      <StageBadge status={orderStage(items)} />
                      <span className="text-sm text-muted-foreground">{o.customer?.name || "—"}</span>
                      <span className="text-xs text-muted-foreground">· {(o.store || o.source || "manual")} · {fmtDate(o.created_at)}</span>
                    </div>
                    {!allShipped && (
                      <Button size="sm" variant="outline" onClick={() => advanceOrder(o)}>
                        Advance all <ArrowRight size={13} weight="bold" />
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    {items.map((it, i) => {
                      const to = nextStage(it.factory_status)
                      const toMeta = to ? stageMeta(to) : null
                      const key = `${o.id}:${it.sku}`
                      return (
                        <div key={it.sku ?? i} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                          <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                            {it.img ? (
                              <Image src={it.img} alt="" fill unoptimized sizes="48px" className="object-cover" />
                            ) : (
                              <div className="flex size-full items-center justify-center text-muted-foreground/50"><Package size={16} weight="duotone" /></div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{it.name || it.sku || "Item"}</div>
                            <div className="truncate text-xs text-muted-foreground">{variantOf(it) || "—"}{it.qty ? ` · ×${it.qty}` : ""}</div>
                          </div>
                          <StageBadge status={it.factory_status} />
                          {to ? (
                            <Button size="sm" disabled={busy === key} onClick={() => advanceItem(o, it, to)} className="shrink-0">
                              {busy === key ? <CircleNotch size={13} className="animate-spin" /> : <>→ {toMeta?.label}</>}
                            </Button>
                          ) : (
                            <span className="inline-flex shrink-0 items-center gap-1 px-2 text-xs font-medium text-emerald-600"><CheckCircle size={14} weight="fill" /> Done</span>
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

      <p className="text-center text-xs text-muted-foreground">Stages: {FACTORY_STAGES.map((s) => s.label).join(" → ")}</p>
    </div>
  )
}
