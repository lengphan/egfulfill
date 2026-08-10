"use client"

import { useCallback, useEffect, useMemo, useState, type ElementType } from "react"
import Link from "next/link"
import { SquaresFour, Package, ArrowRight, CircleNotch, Warning, Tray, MagnifyingGlass, GearSix, Wrench, Truck, CurrencyDollar, TrendUp, Receipt } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StageBadge } from "@/components/app/stage-badge"
import { ProductionLine } from "@/components/app/production-line"
import { FulfillmentSpeed } from "@/components/app/fulfillment-speed"
import { ShortcutsCard, type ShortcutItem } from "@/components/app/shortcuts-card"
import { getOrders, getFactoryPnl, type OrderRow, type FactoryPnl } from "@/lib/api"
import { numOf } from "@/lib/order-format"
import { getToken, getUser } from "@/lib/auth"
import { staffNav, staffTools } from "@/lib/staff-nav"
import { orderStage } from "@/lib/factory-status"
import { orderTotalOf, orderTs } from "@/lib/analytics"

// Whole-dollar KPI money — cents are noise at this size.
const usd = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`

// Time windows the money KPIs can be read over. `since` is a cutoff timestamp; "all" = 0.
const DAY = 864e5
const RANGES = [
  { id: "today", label: "Today", sub: "today", since: () => new Date(new Date().toDateString()).getTime() },
  { id: "7d", label: "7 days", sub: "last 7 days", since: () => Date.now() - 7 * DAY },
  { id: "30d", label: "30 days", sub: "last 30 days", since: () => Date.now() - 30 * DAY },
  { id: "all", label: "All", sub: "all time", since: () => 0 },
] as const
type RangeId = (typeof RANGES)[number]["id"]

const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// Short blurbs for the shortcut tiles. Nav items don't carry descriptions; anything not
// listed just shows its label, which is self-explanatory for a launcher.
const SHORTCUT_DESC: Record<string, string> = {
  "/operator": "Production queue",
  "/designer": "Artwork board",
  "/shipping": "Dispatch + shipments",
  "/inventory": "Stock levels + scan",
  "/purchasing": "Browse, cart + orders",
  "/finance": "Wallet + costs",
  "/broadcasts": "Seller email",
  "/sourcing": "Supplier costing",
  "/campaigns": "Ad spend",
  "/earnings": "Payouts",
  "/digitizer": "Machine files",
  "/spydeck": "Competitor research",
  "/products": "Catalog + blanks",
  "/published-catalog": "Trade shop window",
  "/design": "Design lab",
  "/stores": "Seller stores",
  "/reports": "Analytics",
  "/developers": "API keys",
}

/**
 * A compact KPI tile — icon chip, figure, label.
 *
 * Local to this page rather than a variant of the shared `StatCard`, which is deliberately
 * chipless: a row of tinted chips reads as stickers before it reads as data, and that rule
 * still holds on the pages that use it. This dashboard is the exception on purpose, so the
 * exception lives here and can't leak onto the queue boards.
 */
function MiniStat({
  label, value, icon: Icon,
}: {
  label: string
  value: string
  icon: ElementType
  tone?: "pos" | "neg"
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-primary">
          <Icon size={16} weight="bold" />
        </span>
        <div className="min-w-0">
          <div className="text-2xl font-black leading-none tracking-tight tabular-nums">{value}</div>
          <div className="mt-2 truncate text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
          {/* NO CAPTION. These read as explanations of the figure above them ("we earned",
              "after $73 costs", "per order") and the owner's call is that the figure and its
              label carry it. Dropped here rather than at each call site so nothing can
              reintroduce one by passing `sub`. */}
        </div>
      </div>
    </div>
  )
}

/**
 * A ring gauge. `pct` null means NOT READ — the ring stays empty and the centre says "—",
 * because a 0% ring and a failed fetch must never look the same on a floor dashboard.
 */
function Gauge({ pct, caption }: { pct: number | null; caption: string }) {
  const R = 54
  const C = 2 * Math.PI * R
  return (
    <div className="relative grid place-items-center">
      <svg viewBox="0 0 140 140" className="size-36 -rotate-90">
        <circle cx="70" cy="70" r={R} fill="none" strokeWidth="13" className="stroke-brand/15" />
        <circle
          cx="70" cy="70" r={R} fill="none" strokeWidth="13" strokeLinecap="round"
          className="stroke-brand transition-[stroke-dashoffset] duration-700"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - (pct ?? 0) / 100)}
        />
      </svg>
      <div className="absolute grid place-items-center text-center">
        <div className="text-3xl font-black leading-none tracking-tight tabular-nums">{pct === null ? "—" : `${pct}%`}</div>
        <div className="mt-1 text-2xs font-medium text-muted-foreground">{caption}</div>
      </div>
    </div>
  )
}

// The staff home — role-meaningful KPIs off the shared order feed, a live production-line
// snapshot, a recent-orders list, and quick links into the surfaces that role actually uses.
export function StaffDashboard() {
  const role = getUser()?.role || ""
  const name = getUser()?.name || "there"
  const isAdmin = role === "admin"
  const isWarehouse = role === "warehouse"
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  // Leaving orders null on failure keeps every tile at "—" instead of asserting a factory
  // with nothing in it. A staff dashboard reading all-zeros during an outage is how a
  // backlog gets missed.
  const [loadErr, setLoadErr] = useState<string | null>(null)
  // The window the money KPIs are read over. Admin-only surface, so seller-facing roles
  // never see it. Default to 30 days — a useful horizon without being all-time noise.
  const [range, setRange] = useState<RangeId>("30d")

  const load = useCallback(() => {
    if (!getToken()) { setLoadErr("You're signed out."); return }
    getOrders()
      .then((r) => { setOrders(r ?? []); setLoadErr(null) })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Couldn't reach the server."))
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  // Time-of-day greeting + today's date. Client component, so `new Date()` is the browser's
  // local clock — the reader's own morning, not the server's.
  const now = new Date()
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening"
  const todayLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
  const nowMs = now.getTime()

  const stats = useMemo(() => {
    const list = orders ?? []
    const by = (id: string) => list.filter((o) => orderStage(o.items ?? []) === id).length
    const inProd = ["awaiting_scan", "printed", "working"]
    const todayStr = new Date().toDateString()
    return {
      total: list.length,
      newCount: by(""),
      review: by("in_review"),
      production: list.filter((o) => inProd.includes(orderStage(o.items ?? []))).length,
      ready: by("working"),
      shipped: by("shipped"),
      // Real counts, not modelled: orders created today, and orders sitting in a STOP state.
      createdToday: list.filter((o) => o.created_at && new Date(o.created_at).toDateString() === todayStr).length,
      // Flagged + Backorder were retired and collapse to on_hold, so that one stop is the
      // whole "needs attention" set now.
      attention: list.filter((o) => orderStage(o.items ?? []) === "on_hold").length,
    }
  }, [orders])

  const shippedPct = stats.total ? Math.round((stats.shipped / stats.total) * 100) : 0

  // Money read over the chosen window — revenue, platform profit, order volume and the
  // average order. All live off total/profit/created_at; nothing modelled. An order with
  // no created_at (orderTs → NaN) falls out of every window rather than landing in "today".
  const rangeMeta = RANGES.find((r) => r.id === range) ?? RANGES[2]

  /**
   * Real profit, from the ledger — not orders.total minus anything.
   *
   * `orders.total` is GMV: what a buyer paid a seller on their own marketplace. Our income
   * and our costs both land on the `factory` account as they happen, so that account IS the
   * P&L. Admin/warehouse only server-side; anyone else simply gets no card.
   */
  const [pnl, setPnl] = useState<FactoryPnl | null>(null)
  useEffect(() => {
    if (!isAdmin) return
    const days = rangeMeta.id === "today" ? 1 : rangeMeta.id === "7d" ? 7 : rangeMeta.id === "all" ? 365 : 30
    const t = setTimeout(() => { getFactoryPnl(days).then(setPnl).catch(() => setPnl(null)) }, 0)
    return () => clearTimeout(t)
  }, [isAdmin, rangeMeta])
  const money = useMemo(() => {
    const since = rangeMeta.since()
    const inRange = (orders ?? []).filter((o) => orderTs(o) >= since)
    const revenue = inRange.reduce((s, o) => s + orderTotalOf(o), 0)
    const count = inRange.length
    return { revenue, count, aov: count ? revenue / count : 0 }
  }, [orders, rangeMeta])

  /**
   * The three figures that QUALIFY the headline, at a third its weight. Hierarchy is the
   * whole point of the panel: GMV is the number you glance at, these are what it means.
   */
  const moneySide = useMemo(() => ([
    { label: "Our revenue", value: pnl ? usd(pnl.income) : "—", sub: pnl?.known ? "we earned" : "nothing booked" },
    { label: "Profit", value: pnl?.known ? usd(pnl.profit) : "—", sub: pnl?.known ? `after ${usd(Math.abs(pnl.cost))} costs` : "nothing booked" },
    { label: "Avg order", value: orders === null ? "—" : usd(money.aov), sub: "per order" },
  ]), [pnl, orders, money.aov])

  /**
   * GMV per day across the window, scaled 0..1 — the shape of the run, nothing more.
   * Built here rather than reusing revenueSeries because that returns labelled buckets with
   * a previous-period series for the full chart, and this needs neither.
   */
  const gmvBars = useMemo(() => {
    const list = orders ?? []
    if (!list.length) return [] as number[]
    // `now` is captured once (repo lint: no impure calls during render), so the buckets
    // can't shift under a re-render mid-interaction.
    const since = rangeMeta.since() || nowMs - 30 * DAY
    const span = Math.max(1, Math.min(30, Math.ceil((nowMs - since) / DAY)))
    const buckets = new Array(span).fill(0)
    for (const o of list) {
      const t = orderTs(o)
      if (isNaN(t) || t < since) continue
      const i = span - 1 - Math.floor((nowMs - t) / DAY)
      if (i >= 0 && i < span) buckets[i] += orderTotalOf(o)
    }
    const max = Math.max(...buckets, 1)
    return buckets.map((v) => v / max)
  }, [orders, rangeMeta, nowMs])

  const recent = useMemo(() => (orders ?? []).slice(0, 8), [orders])

  // The production line honours the same window the money cards use — but only where the
  // control is actually shown (admin). For roles without the toggle it stays a full,
  // unfiltered snapshot so nothing is silently hidden behind a filter they can't see.
  // "All" means the live floor; a bounded window means "orders from this window, by their
  // current stage" — which is what makes the toggle useful (e.g. where did today's intake go).
  const windowed = isAdmin && range !== "all"
  const lineOrders = useMemo(() => {
    if (!windowed) return orders ?? []
    const since = rangeMeta.since()
    return (orders ?? []).filter((o) => orderTs(o) >= since)
  }, [orders, windowed, rangeMeta])

  // Role-tuned KPI cards. `today` is shown only where it's a real, live delta.
  // Admin gets the money view — revenue, profit, volume, average — read over the chosen
  // window; the production counts it used to show now live in the Production line chart
  // below. Warehouse/operator keep the production tiles (a bit less than admin).
  const cards: { label: string; value: string | number; sub: string; icon: typeof Package; pos?: boolean; neg?: boolean }[] = isAdmin
    ? [
      // GMV, NOT REVENUE. This is orders.total — what buyers paid SELLERS on their own
      // marketplaces. It flows through the platform; it is not money we receive, and
      // calling it revenue is what made a $0 profit beside it look like a catastrophe
      // rather than a missing calculation.
      { label: "GMV", value: usd(money.revenue), sub: `${rangeMeta.sub} · through the platform`, icon: CurrencyDollar, pos: true },
      // OUR income, from the ledger — order charges and subscriptions booked to `factory`.
      { label: "Our revenue", value: pnl ? usd(pnl.income) : "—",
        sub: pnl ? (pnl.known ? rangeMeta.sub : "nothing booked yet") : "loading", icon: Receipt, pos: true },
      // Income minus cost over the same window. Both sides are real ledger rows: a label
      // cost is booked when a label is bought, an order charge when a seller is charged.
      { label: "Profit", value: pnl && pnl.known ? usd(pnl.profit) : "—",
        sub: pnl && pnl.known ? `after ${usd(Math.abs(pnl.cost))} costs` : "nothing booked yet",
        icon: TrendUp, pos: !!(pnl && pnl.profit > 0), neg: !!(pnl && pnl.profit < 0) },
      { label: "Orders", value: money.count, sub: rangeMeta.sub, icon: Package },
      { label: "Avg order", value: usd(money.aov), sub: "per order", icon: Receipt },
    ]
    : isWarehouse
      ? [
        { label: "To receive", value: stats.newCount, sub: "new intake", icon: Tray, neg: true },
        { label: "In production", value: stats.production, sub: "scan → pack", icon: GearSix },
        { label: "Working", value: stats.ready, sub: "being made", icon: Wrench, pos: true },
        { label: "Shipped", value: stats.shipped, sub: `${shippedPct}% of all`, icon: Truck, pos: true },
      ]
      : [
        { label: "New", value: stats.newCount, sub: "awaiting start", icon: Tray, neg: true },
        { label: "In review", value: stats.review, sub: "artwork check", icon: MagnifyingGlass },
        { label: "In production", value: stats.production, sub: "scan → pack", icon: GearSix },
        { label: "Shipped", value: stats.shipped, sub: `${shippedPct}% of all`, icon: Truck, pos: true },
      ]

  // Shortcut catalog = every page this role can actually reach (nav boards + tools), so the
  // launcher never offers a link that would just bounce. /overview is this page, so it's
  // dropped. The user picks and reorders from here; the choice persists per user.
  const catalog: ShortcutItem[] = useMemo(() => {
    const seen = new Set<string>()
    return [...staffNav(role), ...staffTools(role)]
      .filter((i) => i.href !== "/overview" && !seen.has(i.href) && seen.add(i.href))
      .map((i) => ({ label: i.label, href: i.href, icon: i.icon, desc: SHORTCUT_DESC[i.href] }))
  }, [role])
  // Sensible starting set before the user customises — the first handful of their catalog.
  const shortcutDefaults = useMemo(() => catalog.slice(0, 6).map((c) => c.href), [catalog])

  return (
    /**
     * FULL-BLEED HEADER, white ground.
     *
     * This carried a tinted wash on the argument that the house white-canvas rule was
     * written for long queues and this page is only cards and a chart. That argument was
     * wrong in practice: colour behind the figures competed with the reserved status hues
     * that carry meaning elsewhere, and it made the dashboard look like a different
     * application from every page it links to. Removed 2026-08-10.
     *
     * The bleed stays. The negative margins match `eg-content`'s gutter so the header can
     * reach the shell edges without touching the shared layout, and no other board inherits
     * it — that part was never the problem.
     */
    <div
      className="-mx-4 -mt-5 -mb-5 px-4 pt-5 pb-10 md:-mx-8 md:-mt-6 md:-mb-6 md:px-8 md:pt-6"
      // NO TINTED WASH. Two radial gradients used to sit behind this header — a violet
      // bleeding into pink across the full bleed of the page. It broke the rule the rest of
      // the app follows: the canvas is white, cards are white and separated by their border,
      // and the sidebar is the one bounded block that carries colour. Colour behind the
      // numbers competes with the reserved status hues (emerald shipped, amber hold, red
      // alert) that carry meaning on the floor, and a page you read all day should not be a
      // sheet you read THROUGH. The negative margins stay: they are what lets the header sit
      // flush to the shell edges, and that was never the part doing the damage.
    >
      <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><SquaresFour size={18} weight="fill" /></span>
          <div>
            <h1 className="font-title text-2xl font-semibold tracking-tight">{greeting}, {name}</h1>
            <p className="text-sm text-muted-foreground">
              {todayLabel}
              {stats.createdToday > 0 && <> · <span className="font-medium text-foreground">{stats.createdToday}</span> new today</>}
            </p>
          </div>
        </div>
        {/* Money window — admin only, since the money cards are. */}
        {isAdmin && (
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                aria-pressed={range === r.id}
                className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (range === r.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {loadErr && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-700">
          <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
          <span>Couldn&apos;t load orders, so these counts are unavailable — they are not zero. {loadErr}</span>
        </div>
      )}

      {/* THE FIGURE ROW. Compact tiles rather than the single money panel that was here —
          same numbers, same source, read across instead of down. `cards` is already
          role-tuned, so warehouse and operator get their production counts in the same
          shape admin gets money in.
          orders===null means NOT READ, so every tile shows — rather than 0. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        {cards.map((c) => (
          <MiniStat
            key={c.label}
            label={c.label}
            value={orders === null ? "—" : String(c.value)}
            icon={c.icon}
          />
        ))}
      </div>

      {/* Money chart + the one rate worth a gauge. Admin only, like the money itself. */}
      {isAdmin && (
        <div className="grid items-stretch gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SectionCard
              className="h-full"
              title="GMV"
              bodyClassName="flex flex-1 flex-col gap-5 p-5"
            >
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <div className="font-title text-4xl font-black leading-none tracking-tight tabular-nums sm:text-5xl">
                    {orders === null ? "—" : usd(money.revenue)}
                  </div>
                  <div className="mt-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{rangeMeta.sub}</div>
                </div>
                {/* The figures that QUALIFY the headline, at a third its weight — the
                    hierarchy the old panel was built for, kept. */}
                {moneySide.map((c) => (
                  <div key={c.label}>
                    <div className="text-xl font-bold tabular-nums">{c.value}</div>
                    <div className="mt-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{c.label}</div>
                    <div className="text-2xs text-muted-foreground">{c.sub}</div>
                  </div>
                ))}
              </div>

              {/* The SHAPE, not the axis. Bars are the one form that reads at this size with
                  no labels at all, and it is the only chart the panel needs. */}
              {gmvBars.length > 0 && (
                <div className="mt-auto flex h-28 items-end gap-1" aria-hidden>
                  {gmvBars.map((h, i) => (
                    <span key={i} className="flex-1 rounded-t-md bg-brand/30" style={{ height: `${Math.max(3, h * 100)}%` }} />
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard
            className="h-full"
            title="Shipped"
            bodyClassName="flex h-full flex-col items-center justify-center gap-5 p-5"
          >
            <Gauge pct={orders === null ? null : shippedPct} caption="of all orders" />
            <div className="grid w-full grid-cols-2 gap-3 text-center">
              <div className="rounded-xl bg-muted/50 py-2.5">
                <div className="text-lg font-bold tabular-nums">{orders === null ? "—" : stats.shipped}</div>
                <div className="text-2xs font-medium text-muted-foreground">shipped</div>
              </div>
              <div className="rounded-xl bg-muted/50 py-2.5">
                <div className="text-lg font-bold tabular-nums">{orders === null ? "—" : stats.total}</div>
                <div className="text-2xs font-medium text-muted-foreground">all orders</div>
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* Production line narrowed to two thirds so the fulfilment-speed card fills the
          space it was wasting — the chart is only a handful of bars wide. */}
      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <FulfillmentSpeed orders={lineOrders} loading={orders === null} />
        </div>
        <div className="lg:col-span-2">
          <SectionCard
            className="h-full"
            title="Production line"
            actions={<Link href="/operator" className="eg-tap inline-flex items-center gap-1 text-sm text-primary hover:underline">Open queue <ArrowRight size={13} weight="bold" /></Link>}
            /* flex-1 so the body actually receives the card's stretched height — without it
               the chart sized to its content and left a third of the card empty. */
            bodyClassName="flex flex-1 flex-col divide-y divide-border"
          >
            {orders === null ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
            ) : (
              <>
                <ProductionLine orders={lineOrders} />
                {stats.attention > 0 && (
                  <Link href="/operator" className="flex items-center gap-2 bg-amber-50 px-5 py-2.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50">
                    <Warning size={14} weight="fill" className="shrink-0" />
                    <span>{stats.attention} order{stats.attention === 1 ? "" : "s"} on hold — need attention</span>
                    <ArrowRight size={13} weight="bold" className="ml-auto shrink-0" />
                  </Link>
                )}
              </>
            )}
          </SectionCard>
        </div>
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard title="Recent orders" actions={<Link href="/operator" className="eg-tap inline-flex items-center gap-1 text-sm text-primary hover:underline">Open queue <ArrowRight size={13} weight="bold" /></Link>}>
            {orders === null ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
            ) : recent.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No orders yet.</div>
            ) : (
              <div className="divide-y divide-border">
                {recent.map((o) => (
                  <div key={o.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="font-mono text-sm font-semibold">{numOf(o)}</span>
                    <StageBadge status={orderStage(o.items ?? [])} />
                    <span className="truncate text-sm text-muted-foreground">{o.customer?.name || "—"}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{o.store || o.source || "manual"} · {fmtDate(o.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <ShortcutsCard catalog={catalog} defaults={shortcutDefaults} storageKey="eg_shortcuts_overview" />
      </div>
      </div>
    </div>
  )
}
