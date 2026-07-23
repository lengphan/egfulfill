"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { SquaresFour, Package, PenNib, Storefront, ShieldCheck, ArrowRight, CircleNotch, Tag, Warning, Tray, MagnifyingGlass, GearSix, Wrench, Truck } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { StageBadge } from "@/components/app/stage-badge"
import { ProductionLine } from "@/components/app/production-line"
import { getOrders, type OrderRow } from "@/lib/api"
import { numOf } from "@/lib/order-format"
import { getToken, getUser } from "@/lib/auth"
import { orderStage } from "@/lib/factory-status"

const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

type Quick = { label: string; href: string; icon: typeof Package; desc: string }

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
      attention: list.filter((o) => ["flagged", "on_hold", "backorder"].includes(orderStage(o.items ?? []))).length,
    }
  }, [orders])

  const shippedPct = stats.total ? Math.round((stats.shipped / stats.total) * 100) : 0
  const recent = useMemo(() => (orders ?? []).slice(0, 6), [orders])

  // Role-tuned KPI cards. `today` is shown only where it's a real, live delta.
  const cards = isAdmin
    ? [
      { label: "Orders", value: stats.total, sub: stats.createdToday ? `+${stats.createdToday} today` : "all time", icon: Package, pos: !!stats.createdToday },
      { label: "In production", value: stats.production, sub: "scan → pack", icon: GearSix },
      { label: "Working", value: stats.ready, sub: "being made", icon: Wrench, pos: true },
      { label: "Shipped", value: stats.shipped, sub: `${shippedPct}% of all`, icon: Truck, pos: true },
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

  const quick: Quick[] = [
    { label: "Orders", href: "/operator", icon: Package, desc: "Production queue + fulfillment" },
    { label: "Design board", href: "/designer", icon: PenNib, desc: "Artwork kanban" },
    { label: "Suppliers", href: "/suppliers", icon: Storefront, desc: "S&S + Otto blanks" },
    ...(isAdmin ? [
      { label: "Admin", href: "/admin", icon: ShieldCheck, desc: "Users, top-ups, activity" },
      { label: "Products", href: "/products", icon: Tag, desc: "Catalog + blanks" },
    ] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><SquaresFour size={18} weight="fill" /></span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{greeting}, {name}</h1>
          <p className="text-sm text-muted-foreground">
            {todayLabel}
            {stats.createdToday > 0 && <> · <span className="font-medium text-foreground">{stats.createdToday}</span> new today</>}
          </p>
        </div>
      </div>

      {loadErr && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-700">
          <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
          <span>Couldn&apos;t load orders, so these counts are unavailable — they are not zero. {loadErr}</span>
        </div>
      )}

      <StatGrid>
        {cards.map((c) => (
          // orders===null means "not read yet / failed", so show — rather than 0.
          <StatCard key={c.label} label={c.label} value={orders === null ? "—" : String(c.value)} sub={c.sub} icon={c.icon} tone={c.pos ? "pos" : c.neg && c.value ? "neg" : undefined} />
        ))}
      </StatGrid>

      <SectionCard
        title="Production line"
        description="Where the work is right now — every order by stage"
        actions={<Link href="/operator" className="eg-tap inline-flex items-center gap-1 text-sm text-primary hover:underline">Open queue <ArrowRight size={13} weight="bold" /></Link>}
        bodyClassName="divide-y divide-border"
      >
        {orders === null ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
        ) : (
          <>
            <ProductionLine orders={orders} />
            {stats.attention > 0 && (
              <Link href="/operator" className="flex items-center gap-2 bg-amber-50 px-5 py-2.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50">
                <Warning size={14} weight="fill" className="shrink-0" />
                <span>{stats.attention} order{stats.attention === 1 ? "" : "s"} need attention — flagged, on hold or backordered</span>
                <ArrowRight size={13} weight="bold" className="ml-auto shrink-0" />
              </Link>
            )}
          </>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-3">
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

        <SectionCard title="Jump to">
          <div className="divide-y divide-border">
            {quick.map((q) => {
              const Icon = q.icon
              return (
                <Link key={q.href} href={q.href} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon size={16} weight="duotone" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{q.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{q.desc}</span>
                  </span>
                  <ArrowRight size={14} className="ml-auto shrink-0 text-muted-foreground" />
                </Link>
              )
            })}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
