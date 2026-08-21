"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkle, Warning, House, Receipt, CurrencyDollar, Package, Wallet } from "@phosphor-icons/react"
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
import { useT, useLabelT } from "@/lib/i18n"
import { numOf } from "@/lib/order-format"
import { getToken, getUser } from "@/lib/auth"
import { clickableProps } from "@/lib/a11y"
import { sellerStatus } from "@/lib/order-status"
import { revenueSeries, orderTotalOf as totalOf, orderTs as tsOf } from "@/lib/analytics"

const DAY = 864e5
// USD, en-US, IN EVERY LOCALE — deliberately not localised. Sellers here list on
// international marketplaces and price in dollars, so the figure is the same number in
// the same currency whatever language the labels are in. The only place money is
// genuinely converted is the VietQR top-up, which formats its own VND.
const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: (Number(n) || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

// "Open" = not yet shipped or closed (canonical seller groups).
const OPEN_GROUPS = new Set(["draft", "pending", "production", "attention"])

const itemsLabel = (o: OrderRow, fallback: string) => {
 const items = o.items ?? []
 if (!items.length) return "—"
 const first = items[0]?.name || items[0]?.sku || fallback
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
 const t = useT()
 const cl = useLabelT()
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
 setLoadErr(e instanceof Error ? e.message : t("dash.errServer"))
      })
 getWallet()
      .then((w) => setBalance(w.balance))
      .catch(() => setBalance(null))
  }, [t])
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
 const startOfToday = new Date(new Date().toDateString()).getTime()
 const newToday = list.filter((o) => tsOf(o) >= startOfToday).length
 return { count30: in30.length, rev30, open, newToday }
  }, [orders, now])

  // Time-of-day greeting — client component, so this is the seller's own local clock.
 const greetDate = new Date()
 const greeting = t(greetDate.getHours() < 12 ? "dash.goodMorning" : greetDate.getHours() < 18 ? "dash.goodAfternoon" : "dash.goodEvening")
 const todayLabel = greetDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
 const name = getUser()?.name || t("dash.there")

 const series = useMemo(() => revenueSeries(orders ?? [], now), [orders, now])

 const recent = useMemo(
    () => [...(orders ?? [])].sort((a, b) => (tsOf(b) || 0) - (tsOf(a) || 0)).slice(0, 6),
 [orders]
  )

 return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <House size={18} weight="regular" className="shrink-0 text-primary" />
        <div>
          <h1 className="font-title text-2xl font-semibold tracking-tight">{greeting}, {name}</h1>
          <p className="text-sm text-muted-foreground">
            {todayLabel}
            {orders !== null && stats.newToday > 0 && <> · <span className="font-medium text-foreground">{stats.newToday}</span> {t("dash.newToday")}</>}
          </p>
        </div>
      </div>

      {/* Labels and captions translate; the VALUES stay USD in every locale (see `usd`). */}
      <StatGrid>
        <StatCard label={cl("kpi", "Orders (30d)")} value={orders === null ? "—" : String(stats.count30)} sub={cl("kpisub", "last 30 days")} icon={Receipt} />
        <StatCard label={cl("kpi", "Revenue (30d)")} value={orders === null ? "—" : usd(stats.rev30)} sub={cl("kpisub", "gross, last 30 days")} tone="pos" icon={CurrencyDollar} />
        <StatCard label={cl("kpi", "Open orders")} value={orders === null ? "—" : String(stats.open)} sub={cl("kpisub", "in the pipeline")} icon={Package} />
        <StatCard label={cl("kpi", "Wallet balance")} value={balance === null ? "—" : usd(balance)} sub={cl("kpisub", "available to fulfill")} icon={Wallet} />
      </StatGrid>

      {isDemo && (
        <div className="flex items-center gap-2 rounded-lg border border-hold/20 bg-hold/10 px-3.5 py-2 text-xs font-medium text-hold">
          <Sparkle size={13} weight="fill" /> {t("dash.demo")}
        </div>
      )}

      {loadErr && (
        <div className="flex items-start gap-2 rounded-lg border border-hold/20 bg-hold/10 px-3.5 py-2 text-xs font-medium text-hold">
          <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
          {/* The server's own message is appended untranslated — the API is English-only. */}
          <span>{t("dash.errFigures")} {loadErr}</span>
        </div>
      )}

      {/* A chart of zeros is a claim about revenue. When the read failed we have no
 series to draw, so say that instead of rendering a flat line at the axis. */}
      {orders === null && loadErr ? (
        <SectionCard title={t("dash.revenue")}>
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            {t("dash.noChart")}
          </div>
        </SectionCard>
      ) : (
        <RevenueChart data={series} />
      )}

      <SectionCard
 title={t("dash.recentOrders")}
 actions={
          <Button variant="outline" size="sm" onClick={() => router.push("/orders")}>
            {t("dash.viewAll")}
          </Button>
        }
      >
        {orders === null && loadErr ? (
          // Not skeletons: `orders` stays null after a failure, so a pulsing placeholder
          // would animate forever and read as "still loading" rather than "this failed".
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            {t("dash.errRecent")}
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
                <TableHead className="w-[88px]">{cl("col", "Order")}</TableHead>
                <TableHead className="w-[160px]">{cl("col", "Customer")}</TableHead>
                <TableHead>{cl("col", "Items")}</TableHead>
                <TableHead className="w-[120px]">{cl("col", "Status")}</TableHead>
                <TableHead className="w-[104px] text-right">{cl("col", "Total")}</TableHead>
                <TableHead className="w-[84px] text-right">{cl("col", "Date")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((o) => (
                <TableRow
 key={o.id}
                  {...clickableProps(() => router.push(`/orders/${encodeURIComponent(o.id)}`), t("dash.openOrder", { num: numOf(o) }))}
 className="cursor-pointer focus-visible:bg-accent focus-visible:outline-none"
                >
                  <TableCell className="truncate tabular-nums text-xs font-semibold">{numOf(o)}</TableCell>
                  <TableCell className="truncate font-medium">{o.customer?.name || "—"}</TableCell>
                  <TableCell className="truncate text-muted-foreground">{itemsLabel(o, t("dash.item"))}</TableCell>
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
