"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkle, Warning } from "@phosphor-icons/react"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { SectionCard } from "@/components/app/section-card"
import { SellerStatusBadge } from "@/components/app/seller-status-badge"
import { RevenueChart } from "@/components/app/revenue-chart"
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
import { numOf } from "@/lib/order-format"
import { getToken } from "@/lib/auth"
import { clickableProps } from "@/lib/a11y"
import { sellerStatus } from "@/lib/order-status"
import { revenueSeries, orderTotalOf as totalOf, orderTs as tsOf } from "@/lib/analytics"

const DAY = 864e5
const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: (Number(n) || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

// "Open" = not yet shipped or closed (canonical seller groups).
const OPEN_GROUPS = new Set(["received", "production", "attention"])

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
  // "Couldn't read your orders" is not the same fact as "you have no orders", and every
  // tile below already renders "—" while orders is null. The catch used to move state out
  // of null into [], which defeated that guard and turned a 502 into a confident
  // "Revenue (30d) $0 · Open orders 0" for a seller with a full pipeline.
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [now, setNow] = useState(0)

  const load = useCallback(() => {
    // Signed in → always show real data (empty state if none). Demo is only the
    // signed-out marketing preview, never shown to a real account with 0 orders.
    const signedIn = !!getToken()
    getOrders()
      .then((rows) => {
        setLoadErr(null)
        if (rows && rows.length) {
          setOrders(rows)
          setIsDemo(false)
        } else {
          setOrders(signedIn ? [] : DEMO)
          setIsDemo(!signedIn)
        }
      })
      .catch((e) => {
        // Signed out, the demo preview is still the right thing to show. Signed in, leave
        // orders null so the tiles stay "—" and say why.
        if (!signedIn) { setOrders(DEMO); setIsDemo(true); return }
        setLoadErr(e instanceof Error ? e.message : "Couldn't reach the server.")
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
    const open = list.filter((o) => OPEN_GROUPS.has(sellerStatus(o).group)).length
    return { count30: in30.length, rev30, open }
  }, [orders, now])

  const series = useMemo(() => revenueSeries(orders ?? [], now), [orders, now])

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

      {loadErr && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-700">
          <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
          <span>Couldn&apos;t load your orders, so these figures are unavailable — they are not zero. {loadErr}</span>
        </div>
      )}

      {/* A chart of zeros is a claim about revenue. When the read failed we have no
          series to draw, so say that instead of rendering a flat line at the axis. */}
      {orders === null && loadErr ? (
        <SectionCard title="Revenue" description="Gross revenue across your stores">
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No revenue data to chart — your orders couldn&apos;t be loaded.
          </div>
        </SectionCard>
      ) : (
        <RevenueChart data={series} />
      )}

      <SectionCard
        title="Recent orders"
        description="Latest activity across your stores"
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push("/orders")}>
            View all
          </Button>
        }
      >
        {orders === null && loadErr ? (
          // Not skeletons: `orders` stays null after a failure, so a pulsing placeholder
          // would animate forever and read as "still loading" rather than "this failed".
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Couldn&apos;t load recent orders.
          </div>
        ) : orders === null ? (
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
                  <TableCell><SellerStatusBadge order={o} /></TableCell>
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
