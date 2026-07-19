"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { SquaresFour, Package, PenNib, Storefront, ShieldCheck, ArrowRight, CircleNotch, Tag } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { StageBadge } from "@/components/app/stage-badge"
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

// The staff home — role-meaningful KPIs off the shared order feed, a recent-orders
// snapshot, and quick links into the surfaces that role actually uses.
export function StaffDashboard() {
  const role = getUser()?.role || ""
  const name = getUser()?.name || "there"
  const isAdmin = role === "admin"
  const isWarehouse = role === "warehouse"
  const [orders, setOrders] = useState<OrderRow[] | null>(null)

  const load = useCallback(() => {
    if (!getToken()) { setOrders([]); return }
    getOrders().then((r) => setOrders(r ?? [])).catch(() => setOrders([]))
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  const stats = useMemo(() => {
    const list = orders ?? []
    const by = (id: string) => list.filter((o) => orderStage(o.items ?? []) === id).length
    const inProd = ["awaiting_scan", "printed", "working"]
    return {
      total: list.length,
      newCount: by(""),
      review: by("in_review"),
      production: list.filter((o) => inProd.includes(orderStage(o.items ?? []))).length,
      ready: by("working"),
      shipped: by("shipped"),
    }
  }, [orders])

  const recent = useMemo(() => (orders ?? []).slice(0, 6), [orders])

  // Role-tuned KPI cards.
  const cards = isAdmin
    ? [
      { label: "Orders", value: stats.total, sub: "all time" },
      { label: "In production", value: stats.production, sub: "scan → pack" },
      { label: "Working", value: stats.ready, sub: "being made", pos: true },
      { label: "Shipped", value: stats.shipped, sub: "complete", pos: true },
    ]
    : isWarehouse
      ? [
        { label: "To receive", value: stats.newCount, sub: "new intake", neg: true },
        { label: "In production", value: stats.production, sub: "scan → pack" },
        { label: "Working", value: stats.ready, sub: "being made", pos: true },
        { label: "Shipped", value: stats.shipped, sub: "out the door" },
      ]
      : [
        { label: "New", value: stats.newCount, sub: "awaiting start", neg: true },
        { label: "In review", value: stats.review, sub: "artwork check" },
        { label: "In production", value: stats.production, sub: "scan → pack" },
        { label: "Shipped", value: stats.shipped, sub: "complete", pos: true },
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
          <h1 className="font-display text-2xl font-semibold tracking-tight">Welcome back, {name}</h1>
          <p className="text-sm text-muted-foreground capitalize">{role || "staff"} dashboard</p>
        </div>
      </div>

      <StatGrid>
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={String(c.value)} sub={c.sub} tone={c.pos ? "pos" : c.neg && c.value ? "neg" : undefined} />
        ))}
      </StatGrid>

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
