"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { SquaresFour, Package, ArrowRight, CircleNotch, Warning, Tray, MagnifyingGlass, GearSix, Wrench, Truck, CurrencyDollar, TrendUp, Receipt } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
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

      {/**
        * ONE MONEY PANEL, not five equal cards.
        *
        * Five twins in a row say nothing is more important than anything else — and a fifth
        * one simply wrapped, which is what a grid of equals does when it grows. So the money
        * becomes a single bounded block with a hierarchy inside it: GMV leads at display
        * size, the three figures that qualify it sit beside it at a third the weight.
        *
        * A TINT, not a fill. --brand is oklch(0.5305 0.2723 283.5) — a saturated violet,
        * not the #A5B7FF plate CLAUDE.md still describes; the token moved and the doc
        * didn't. At full strength it swamps the page and argues with the sidebar, which is
        * already carrying purple. At 7% over white it groups the money without competing,
        * which is the job — and ordinary foreground text stays legible on it, so nothing
        * needs a bespoke contrast pairing.
        *
        * It sits ABOVE the data, never behind it. The queue below stays on white paper,
        * which is the rule that matters — a tinted sheet under 700 rows is one you read
        * through all day.
        */}
      {isAdmin ? (
        <div className="rounded-2xl border border-brand/15 bg-brand/[0.07] p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
            <div>
              <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                GMV · {rangeMeta.sub}
              </div>
              <div className="mt-1 font-title text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">
                {orders === null ? "—" : usd(money.revenue)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                what buyers paid, through the platform
              </div>
              {/* The SHAPE, not the axis. Bars are the one form that reads at this size with
                  no labels at all, and it is the only chart the panel needs. */}
              {gmvBars.length > 0 && (
                <div className="mt-4 flex h-12 items-end gap-1" aria-hidden>
                  {gmvBars.map((h, i) => (
                    <span key={i} className="flex-1 rounded-sm bg-brand/35" style={{ height: `${Math.max(4, h * 100)}%` }} />
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4 self-center border-brand/20 lg:border-l lg:pl-10">
              {moneySide.map((c) => (
                <div key={c.label}>
                  <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{c.label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</div>
                  <div className="mt-0.5 text-2xs text-muted-foreground">{c.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <StatGrid>
          {cards.map((c) => (
            // orders===null means "not read yet / failed", so show — rather than 0.
            <StatCard key={c.label} label={c.label} value={orders === null ? "—" : String(c.value)} sub={c.sub} icon={c.icon} tone={c.pos ? "pos" : c.neg && c.value ? "neg" : undefined} />
          ))}
        </StatGrid>
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
            description={windowed ? `Orders from the ${rangeMeta.sub}, by current stage` : "Where the work is right now — every order by stage"}
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
  )
}
