"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Sparkle } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { RevenueChart } from "@/components/app/revenue-chart"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getOrders, type OrderRow } from "@/lib/api"
import { getToken } from "@/lib/auth"
import { revenueSeries, channelBreakdown, topProducts, orderTotalOf, orderTs } from "@/lib/analytics"
import { sellerStatus } from "@/lib/order-status"

const DAY = 864e5
const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: (Number(n) || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

const DEMO: OrderRow[] = [
  { id: "etsy-1", seq: 1, source: "etsy", factory_status: "shipped", total: 63.75, created_at: new Date(Date.now() - 2 * DAY).toISOString(), items: [{ name: "Heavyweight Hoodie", qty: 1, unit_price: 42 }] },
  { id: "etsy-2", seq: 2, source: "etsy", factory_status: "printing", total: 36, created_at: new Date(Date.now() - 4 * DAY).toISOString(), items: [{ name: "Classic Tee", qty: 2, unit_price: 18 }] },
  { id: "sh-3", seq: 3, source: "shopify", factory_status: "shipped", total: 24, created_at: new Date(Date.now() - 6 * DAY).toISOString(), items: [{ name: "Embroidered Cap", qty: 1, unit_price: 24 }] },
  { id: "ff-4", seq: 4, source: "manual", factory_status: "packed", total: 25.6, created_at: new Date(Date.now() - 9 * DAY).toISOString(), items: [{ name: "Ceramic Mug 15oz", qty: 2, unit_price: 12.8 }] },
  { id: "sh-5", seq: 5, source: "shopify", factory_status: "new", total: 42, created_at: new Date(Date.now() - 14 * DAY).toISOString(), items: [{ name: "Heavyweight Hoodie", qty: 1, unit_price: 42 }] },
]

export function ReportsView() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [now, setNow] = useState(0)

  const load = useCallback(() => {
    // Demo only when signed out; a signed-in account with no orders sees empty (real) charts.
    const signedIn = !!getToken()
    getOrders()
      .then((rows) => {
        if (rows && rows.length) { setOrders(rows); setIsDemo(false) }
        else { setOrders(signedIn ? [] : DEMO); setIsDemo(!signedIn) }
      })
      .catch(() => { setOrders(signedIn ? [] : DEMO); setIsDemo(!signedIn) })
  }, [])
  useEffect(() => {
    const id = setTimeout(() => { setNow(Date.now()); load() }, 0)
    return () => clearTimeout(id)
  }, [load])

  const list = useMemo(() => orders ?? [], [orders])

  const stats = useMemo(() => {
    const in30 = list.filter((o) => !isNaN(orderTs(o)) && now - orderTs(o) < 30 * DAY)
    const rev = in30.reduce((s, o) => s + orderTotalOf(o), 0)
    const shipped = list.filter((o) => sellerStatus(o).group === "shipped").length
    return {
      rev30: rev,
      orders30: in30.length,
      aov: in30.length ? rev / in30.length : 0,
      fulfillRate: list.length ? Math.round((shipped / list.length) * 100) : 0,
    }
  }, [list, now])

  const series = useMemo(() => revenueSeries(list, now), [list, now])
  const channels = useMemo(() => channelBreakdown(list), [list])
  const top = useMemo(() => topProducts(list), [list])

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Revenue (30d)" value={orders === null ? "—" : usd(stats.rev30)} sub="gross" tone="pos" />
        <StatCard label="Orders (30d)" value={orders === null ? "—" : String(stats.orders30)} sub="placed" />
        <StatCard label="Avg order value" value={orders === null ? "—" : usd(stats.aov)} sub="per order" />
        <StatCard label="Fulfillment rate" value={orders === null ? "—" : `${stats.fulfillRate}%`} sub="shipped / total" />
      </StatGrid>

      {isDemo && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-700">
          <Sparkle size={13} weight="fill" /> Showing sample analytics — sign in to load your live data.
        </div>
      )}

      <RevenueChart data={series} />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Revenue by channel" description="Across your stores" bodyClassName="space-y-4 p-5">
          {channels.length === 0 ? (
            <div className="text-sm text-muted-foreground">No revenue yet.</div>
          ) : (
            channels.map((c, i) => (
              <div key={c.name}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="font-medium">{c.name}</span>
                  <span className="tabular-nums text-muted-foreground">{usd(c.revenue)} · {c.pct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${c.pct}%`, backgroundColor: `var(--chart-${(i % 5) + 1})` }} />
                </div>
              </div>
            ))
          )}
        </SectionCard>

        <SectionCard title="Top products" description="By revenue">
          {top.length === 0 ? (
            <div className="p-5 text-sm text-muted-foreground">No product sales yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{p.units}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{usd(p.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
