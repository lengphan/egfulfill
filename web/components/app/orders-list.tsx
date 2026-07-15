"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { MagnifyingGlass, Plus, Package, Sparkle } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatusBadge } from "@/components/app/status-badge"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getOrders, type OrderRow } from "@/lib/api"

// factory_status/status → a shared stage word StatusBadge knows (keeps colours consistent).
function stageOf(o: OrderRow): string {
  const s = String(o.factory_status || o.status || "new").toLowerCase()
  if (["new", "draft"].includes(s)) return "New"
  if (["queued", "in_queue", "prescan", "ready_print", "awaiting_scan", "scanned"].includes(s)) return "Queued"
  if (["printing", "production"].includes(s)) return "Production"
  if (s === "qc") return "QC"
  if (["packing", "packed"].includes(s)) return "Packed"
  if (["shipped", "fulfilled", "delivered"].includes(s)) return "Shipped"
  if (["hold", "on_hold", "unfunded"].includes(s)) return "On hold"
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const IN_PROD = new Set(["Queued", "Production", "QC", "Packed"])

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const totalOf = (o: OrderRow) => Number(o.total ?? 0) || 0
const numOf = (o: OrderRow) => (o.seq ? `#${o.seq}` : o.id)
const storeOf = (o: OrderRow) => {
  const s = (o.store || o.source || "manual").toString()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const customerOf = (o: OrderRow) => o.customer?.name || "—"
const itemsLabel = (o: OrderRow) => {
  const items = o.items ?? []
  if (!items.length) return "—"
  const first = items[0]?.name || items[0]?.sku || "Item"
  return items.length > 1 ? `${first} +${items.length - 1}` : first
}
const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

const FILTERS = ["All", "New", "Production", "Shipped"] as const
type Filter = (typeof FILTERS)[number]

// Demo fallback (no session / standalone dev).
const DEMO: OrderRow[] = [
  { id: "etsy-4142", seq: 4142, source: "etsy", customer: { name: "A. Nguyen" }, factory_status: "printing", total: 63.75, created_at: "2026-04-12", items: [{ name: "Hoodie · black", qty: 1 }] },
  { id: "sh-4140", seq: 4140, source: "shopify", customer: { name: "M. Tran" }, factory_status: "shipped", total: 27, created_at: "2026-04-11", items: [{ name: "Tee", qty: 2 }] },
  { id: "etsy-4131", seq: 4131, source: "etsy", customer: { name: "J. Pham" }, factory_status: "qc", total: 31.5, created_at: "2026-04-11", items: [{ name: "Embroidered cap", qty: 1 }] },
  { id: "FF-4126", seq: 4126, source: "manual", customer: { name: "K. Le" }, factory_status: "packed", total: 44.2, created_at: "2026-04-10", items: [{ name: "Crewneck · sand", qty: 1 }] },
  { id: "sh-4119", seq: 4119, source: "shopify", customer: { name: "T. Vo" }, factory_status: "new", total: 16.8, created_at: "2026-04-09", items: [{ name: "Tote · natural", qty: 2 }] },
  { id: "etsy-4110", seq: 4110, source: "etsy", customer: { name: "H. Dang" }, factory_status: "queued", total: 38.4, created_at: "2026-04-08", items: [{ name: "Mug · 15oz", qty: 3 }] },
]

export function OrdersList() {
  const router = useRouter()
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("All")

  const load = useCallback(() => {
    getOrders()
      .then((rows) => {
        if (rows && rows.length) {
          setOrders(rows)
          setIsDemo(false)
        } else {
          setOrders(DEMO)
          setIsDemo(true)
        }
      })
      .catch(() => {
        setOrders(DEMO)
        setIsDemo(true)
      })
  }, [])
  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [load])

  const stats = useMemo(() => {
    const list = orders ?? []
    const by = (pred: (o: OrderRow) => boolean) => list.filter(pred).length
    return {
      neu: by((o) => stageOf(o) === "New"),
      prod: by((o) => IN_PROD.has(stageOf(o))),
      shipped: by((o) => stageOf(o) === "Shipped"),
      hold: by((o) => stageOf(o) === "On hold"),
    }
  }, [orders])

  const filtered = useMemo(() => {
    return (orders ?? []).filter((o) => {
      const stage = stageOf(o)
      if (filter === "New" && stage !== "New") return false
      if (filter === "Production" && !IN_PROD.has(stage)) return false
      if (filter === "Shipped" && stage !== "Shipped") return false
      if (!query) return true
      const hay = `${numOf(o)} ${customerOf(o)} ${itemsLabel(o)} ${storeOf(o)}`.toLowerCase()
      return hay.includes(query.toLowerCase())
    })
  }, [orders, filter, query])

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="New" value={String(stats.neu)} sub="awaiting review" />
        <StatCard label="In production" value={String(stats.prod)} sub="on the floor" />
        <StatCard label="Shipped" value={String(stats.shipped)} sub="fulfilled" tone="pos" />
        <StatCard label="Needs attention" value={String(stats.hold)} sub="unfunded / on hold" tone={stats.hold ? "neg" : undefined} />
      </StatGrid>

      <SectionCard
        title="Orders"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => router.push("/orders/new")}>
              <Plus size={14} weight="bold" /> New order
            </Button>
          </div>
        }
      >
        {/* toolbar */}
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  "rounded-full px-3 py-1 text-sm font-medium transition-colors " +
                  (filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
                }
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative max-w-xs flex-1">
            <MagnifyingGlass size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search orders…"
              className="h-9 pl-8"
            />
          </div>
        </div>

        {isDemo && (
          <div className="flex items-center gap-2 border-b border-border bg-amber-50 px-5 py-2 text-xs font-medium text-amber-700">
            <Sparkle size={13} weight="fill" /> Showing sample orders — sign in to load your live queue.
          </div>
        )}

        {orders === null ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Package size={22} weight="duotone" />
            </span>
            <div className="font-medium">No orders here</div>
            <div className="text-sm text-muted-foreground">Nothing matches that filter or search.</div>
          </div>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[88px]">Order</TableHead>
                <TableHead className="w-[104px]">Store</TableHead>
                <TableHead className="w-[168px]">Customer</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[104px] text-right">Total</TableHead>
                <TableHead className="w-[84px] text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow
                  key={o.id}
                  onClick={() => router.push(`/orders/${encodeURIComponent(o.id)}`)}
                  className="cursor-pointer"
                >
                  <TableCell className="truncate font-mono text-xs font-medium">{numOf(o)}</TableCell>
                  <TableCell className="truncate text-muted-foreground">{storeOf(o)}</TableCell>
                  <TableCell className="truncate font-medium">{customerOf(o)}</TableCell>
                  <TableCell className="truncate text-muted-foreground">{itemsLabel(o)}</TableCell>
                  <TableCell><StatusBadge status={stageOf(o)} /></TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{usd(totalOf(o))}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmtDate(o.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  )
}
