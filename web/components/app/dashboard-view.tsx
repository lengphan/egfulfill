"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkle } from "@phosphor-icons/react"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { SectionCard } from "@/components/app/section-card"
import { StatusBadge } from "@/components/app/status-badge"
import { RevenueChart, type RevenuePoint } from "@/components/app/revenue-chart"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getOrders, getWallet, type OrderRow } from "@/lib/api"
import { clickableProps } from "@/lib/a11y"

const DAY = 864e5
const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
const totalOf = (o: OrderRow) => Number(o.total ?? 0) || 0
const tsOf = (o: OrderRow) => (o.created_at ? new Date(o.created_at).getTime() : NaN)

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
const CLOSED = new Set(["Shipped", "Cancelled"])

// Bucket revenue into `n` buckets of `daysPer` days each (current + previous window).
function bucketize(orders: OrderRow[], n: number, daysPer: number, now: number, label: (idx: number) => string): RevenuePoint[] {
  const span = daysPer * DAY
  const windowMs = n * span
  const cur = new Array(n).fill(0)
  const prev = new Array(n).fill(0)
  for (const o of orders) {
    const t = tsOf(o)
    if (isNaN(t)) continue
    const age = now - t
    const total = totalOf(o)
    if (age >= 0 && age < windowMs) cur[n - 1 - Math.floor(age / span)] += total
    else if (age >= windowMs && age < 2 * windowMs) prev[n - 1 - Math.floor((age - windowMs) / span)] += total
  }
  return cur.map((rev, idx) => ({ label: label(idx), revenue: Math.round(rev), prev: Math.round(prev[idx]) }))
}

const numOf = (o: OrderRow) => (o.seq ? `#${o.seq}` : o.id)
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

const DEMO: OrderRow[] = [
  { id: "etsy-4142", seq: 4142, source: "etsy", customer: { name: "A. Nguyen" }, factory_status: "printing", total: 63.75, created_at: new Date(Date.now() - 1 * DAY).toISOString(), items: [{ name: "Hoodie · black", qty: 1 }] },
  { id: "sh-4140", seq: 4140, source: "shopify", customer: { name: "M. Tran" }, factory_status: "shipped", total: 27, created_at: new Date(Date.now() - 2 * DAY).toISOString(), items: [{ name: "Tee", qty: 2 }] },
  { id: "etsy-4131", seq: 4131, source: "etsy", customer: { name: "J. Pham" }, factory_status: "qc", total: 31.5, created_at: new Date(Date.now() - 3 * DAY).toISOString(), items: [{ name: "Embroidered cap", qty: 1 }] },
  { id: "FF-4126", seq: 4126, source: "manual", customer: { name: "K. Le" }, factory_status: "packed", total: 44.2, created_at: new Date(Date.now() - 5 * DAY).toISOString(), items: [{ name: "Crewneck", qty: 1 }] },
  { id: "sh-4119", seq: 4119, source: "shopify", customer: { name: "T. Vo" }, factory_status: "new", total: 16.8, created_at: new Date(Date.now() - 9 * DAY).toISOString(), items: [{ name: "Tote", qty: 2 }] },
]

export function DashboardView() {
  const router = useRouter()
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [now, setNow] = useState(0)

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
    getWallet()
      .then((w) => setBalance(w.balance))
      .catch(() => setBalance(null))
  }, [])
  useEffect(() => {
    const id = setTimeout(() => {
      setNow(Date.now())
      load()
    }, 0)
    return () => clearTimeout(id)
  }, [load])

  const stats = useMemo(() => {
    const list = orders ?? []
    const in30 = list.filter((o) => !isNaN(tsOf(o)) && now - tsOf(o) < 30 * DAY)
    const rev30 = in30.reduce((s, o) => s + totalOf(o), 0)
    const open = list.filter((o) => !CLOSED.has(stageOf(o))).length
    return { count30: in30.length, rev30, open }
  }, [orders, now])

  const series = useMemo<Record<string, RevenuePoint[]>>(() => {
    const list = orders ?? []
    return {
      "7d": bucketize(list, 7, 1, now, (i) =>
        new Date(now - (6 - i) * DAY).toLocaleDateString("en-US", { weekday: "short" })
      ),
      "4w": bucketize(list, 4, 7, now, (i) => `W${i + 1}`),
      "3m": bucketize(list, 3, 30, now, (i) =>
        new Date(now - (2 - i) * 30 * DAY).toLocaleDateString("en-US", { month: "short" })
      ),
    }
  }, [orders, now])

  const recent = useMemo(
    () => [...(orders ?? [])].sort((a, b) => (tsOf(b) || 0) - (tsOf(a) || 0)).slice(0, 6),
    [orders]
  )

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Orders (30d)" value={orders === null ? "—" : String(stats.count30)} sub="last 30 days" />
        <StatCard label="Revenue (30d)" value={orders === null ? "—" : usd(stats.rev30)} sub="gross, last 30 days" tone="pos" />
        <StatCard label="Open orders" value={orders === null ? "—" : String(stats.open)} sub="in the pipeline" />
        <StatCard label="Wallet balance" value={balance === null ? "—" : usd(balance)} sub="available to fulfill" />
      </StatGrid>

      {isDemo && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-700">
          <Sparkle size={13} weight="fill" /> Showing sample data — sign in to load your live dashboard.
        </div>
      )}

      <RevenueChart data={series} />

      <SectionCard
        title="Recent orders"
        description="Latest activity across your stores"
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push("/orders")}>
            View all
          </Button>
        }
      >
        {orders === null ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[88px]">Order</TableHead>
                <TableHead className="w-[160px]">Customer</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[104px] text-right">Total</TableHead>
                <TableHead className="w-[84px] text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((o) => (
                <TableRow
                  key={o.id}
                  {...clickableProps(() => router.push(`/orders/${encodeURIComponent(o.id)}`), `Open order ${numOf(o)}`)}
                  className="cursor-pointer focus-visible:bg-accent focus-visible:outline-none"
                >
                  <TableCell className="truncate font-mono text-xs font-semibold">{numOf(o)}</TableCell>
                  <TableCell className="truncate font-medium">{o.customer?.name || "—"}</TableCell>
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
