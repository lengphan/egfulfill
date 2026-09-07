"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkle, Warning, House } from "@phosphor-icons/react"
import { GetStarted } from "@/components/app/get-started"
import { SectionCard } from "@/components/app/section-card"
import { SellerStatusBadge } from "@/components/app/seller-status-badge"
import { GmvPanel } from "@/components/app/gmv-panel"
import { StageBracket } from "@/components/app/stage-bracket"
import { Thumb } from "@/components/app/thumb"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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
import { useT, useLabelT, useDateFormat } from "@/lib/i18n"
import { numOf, platformOf } from "@/lib/order-format"
import { OrderNumber } from "@/components/app/order-number"
import { getToken, getUser } from "@/lib/auth"
import { clickableProps } from "@/lib/a11y"
import { sellerStatus } from "@/lib/order-status"
import { resolvedOrderStage } from "@/lib/factory-status"
import { dailyRevenue, barsOf, topProducts, orderTotalOf as totalOf, orderTs as tsOf } from "@/lib/analytics"

const DAY = 864e5
// What each range means as a number of DAILY bars.
const PERIOD_DAYS: Record<string, number> = { "7d": 7, "4w": 28, "3m": 90 }
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
  const fmtOn = useDateFormat()
  // Short "MMM d" for a row of dates. Was a module-scope helper pinned to en-US.
  const fmtDate = (v?: string | null) => (v ? fmtOn(v, { month: "short", day: "numeric" }) : "—")
 const cl = useLabelT()
 const [orders, setOrders] = useState<OrderRow[] | null>(null)
  // The two controls the revenue chart used to own. They came ACROSS rather than being
  // dropped: the block changed shape, the functions did not.
 const [period, setPeriod] = useState<string>("4w")
 const [compare, setCompare] = useState(false)
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
 const todayLabel = fmtOn(greetDate, { weekday: "long", month: "short", day: "numeric" })
 const name = getUser()?.name || t("dash.there")


  /* A chart of zeros is a claim about revenue, so when the read failed there is nothing to
   * scale and `barsOf` returns an empty array — the panel then draws no chart at all rather
   * than a flat row at the axis. Same contract the old block had, one level down. */
 /* WHERE the open work is, not just how much of it there is.
  *
  * `resolvedOrderStage` is the one answer to "what stage is this order at" — an order-level
  * exception wins, everything else comes from the least-advanced line. Reading `status` here
  * instead would disagree with the queue on exactly the orders that matter: a cancelled one,
  * or one whose lines moved on the board. */
 const ladder = useMemo(() => {
   const counts: Record<string, number> = {}
   const mix: Record<string, Record<string, number>> = {}
   for (const o of orders ?? []) {
     const st = resolvedOrderStage(o)
     counts[st] = (counts[st] ?? 0) + 1
     const ch = platformOf(o)
     mix[st] = mix[st] ?? {}
     mix[st][ch] = (mix[st][ch] ?? 0) + 1
   }
   return { counts, mix }
 }, [orders])

 // The range control changes the WINDOW, not the bar count: four weekly buckets render as
 // slabs rather than as the shape of a run. 7d/4w/3m are 7/28/90 daily bars.
 const points = useMemo(
   () => (orders === null ? [] : dailyRevenue(orders, PERIOD_DAYS[period] ?? 28, now)),
   [orders, period, now]
 )
 const bars = useMemo(() => (orders === null ? [] : barsOf(points)), [orders, points])
 const barsPrev = useMemo(() => (orders === null ? [] : barsOf(points, "prev")), [orders, points])

 /* WHAT IS ACTUALLY SELLING, with the picture off the line it was picked from.
  * `topProducts` carries `img` now — the field the row avatars and the design canvas
  * already read, resolved from `img_ref` at the API boundary. A product that has never
  * carried a thumbnail falls back to Thumb's marked tile rather than a broken image. */
 const blanks = useMemo(() => topProducts(orders ?? [], 4), [orders])

 /* WHAT IS WAITING ON THE SELLER, and only then what is recent.
  *
  * The table under all this was "Recent orders", and by the time it renders the page has
  * already said the same thing twice: the bracket counts every stage, and the six newest
  * orders are the six newest marks the rest of the page is built from. What none of it says
  * is which ones are stuck on THEM.
  *
  * Two situations qualify, and both are the seller's move:
  *  - on_hold — the factory has stopped and is asking a question
  *  - Draft   — never submitted, so nothing was charged and nothing is being made
  *
  * When neither exists the card falls back to the recent list rather than showing an empty
  * state, because "nothing needs you" is good news and an empty table does not read that
  * way. The title says which of the two it is. */
 const needsYou = useMemo(
    () =>
      [...(orders ?? [])]
        .filter((o) => {
 const st = resolvedOrderStage(o)
 return st === "on_hold" || st === ""
        })
        .sort((a, b) => (tsOf(a) || 0) - (tsOf(b) || 0)),
 [orders]
  )

 const recentList = useMemo(
    () => [...(orders ?? [])].sort((a, b) => (tsOf(b) || 0) - (tsOf(a) || 0)).slice(0, 6),
 [orders]
  )

  // Oldest first when it is a to-do list — the one that has been waiting longest is the one
  // that needs answering. Newest first when it is just the recent list.
 const showingNeeds = needsYou.length > 0
 const recent = showingNeeds ? needsYou.slice(0, 6) : recentList

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

      <GetStarted orders={orders === null ? null : orders.length} balance={balance} />

      {/* ONE money block, where there were four tiles and a chart under them.
       *
       * The four figures are all still here — revenue is the headline, the other three
       * qualify it — and the chart's own two controls came with it rather than being
       * dropped: `period` still picks the window and `compare` still draws the one before.
       * Labels and captions translate; the VALUES stay USD in every locale (see `usd`). */}
      <GmvPanel
        title={cl("kpi", "Revenue")}
        headline={orders === null ? "—" : usd(stats.rev30)}
        headlineSub={cl("kpisub", "last 30 days")}
        side={[
          { label: cl("kpi", "Orders (30d)"), value: orders === null ? "—" : String(stats.count30) },
          { label: cl("kpi", "Open orders"), value: orders === null ? "—" : String(stats.open) },
          { label: cl("kpi", "Wallet balance"), value: balance === null ? "—" : usd(balance) },
        ]}
        bars={bars}
        barOrders={points.map((p) => p.orders)}
        barValue={points.map((p) => p.revenue)}
        barLabels={points.map((p) => p.label)}
        barsPrev={compare ? barsPrev : undefined}
        controls={
          <div className="flex items-center gap-2">
            <ToggleGroup value={[period]} onValueChange={(v) => v[0] && setPeriod(v[0])} variant="outline" size="sm">
              <ToggleGroupItem value="7d">{t("dash.7d")}</ToggleGroupItem>
              <ToggleGroupItem value="4w">{t("dash.4weeks")}</ToggleGroupItem>
              <ToggleGroupItem value="3m">{t("dash.3months")}</ToggleGroupItem>
            </ToggleGroup>
            <Button
              variant={compare ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setCompare((v) => !v)}
              aria-pressed={compare}
            >
              {t("dash.previous")}
            </Button>
          </div>
        }
      />

      {/* One number called "Open orders" was four different situations. The panel still
          carries the total; this says which of them it is. */}
      {orders !== null && orders.length > 0 && (
        <div>
          <p className="eg-label mb-2 text-muted-foreground">{cl("kpi", "Where the work is")}</p>
          <StageBracket
            role="seller"
            counts={ladder.counts}
            mix={ladder.mix}
            onPick={(stage) => router.push(`/orders?stage=${encodeURIComponent(stage)}`)}
          />
        </div>
      )}

      {blanks.length > 0 && (
        <div>
          <p className="eg-label mb-2 text-muted-foreground">{cl("kpi", "What is selling")}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {blanks.map((b) => (
              <button
 key={b.name}
 type="button"
 onClick={() => router.push(`/products?q=${encodeURIComponent(b.name)}`)}
                className="eg-tap overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary/40"
              >
                <Thumb src={b.img} alt={b.name} fit="contain" className="aspect-[4/3] w-full bg-muted/40" />
                <div className="border-t border-border px-3 py-2.5">
                  <div className="truncate text-sm font-medium leading-tight">{b.name}</div>
                  <div className="mt-1 text-2xs tabular-nums text-muted-foreground">
                    {b.units === 1 ? t("dash.oneUnit") : t("dash.nUnits", { n: b.units })} · {usd(b.revenue)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

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



      <SectionCard
 title={showingNeeds ? t("dash.needsYou") : t("dash.recentOrders")}
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
                  <TableCell className="truncate">
                    <OrderNumber order={o} />
                  </TableCell>
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
