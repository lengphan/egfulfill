"use client"

import { useEffect, useMemo, useState } from "react"
import { UploadSimple, CircleNotch, MagnifyingGlass, ArrowSquareOut } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { SellerStatusBadge } from "@/components/app/seller-status-badge"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Pagination, usePaged } from "@/components/app/pagination"
import { getOrders, type OrderRow } from "@/lib/api"
import { numOf, platformOf, itemsLabel, unitsOf, customerOf, totalOf, usd, trackUrl } from "@/lib/order-format"
import { matchesFilter, SELLER_FILTERS, type SellerFilter } from "@/lib/order-status"

// A seller's record of what THEY uploaded, newest first — so they can track their own
// orders without pinging us. Shows ONLY the seller-facing status (Pending / In Production /
// Shipped …) via SellerStatusBadge; the factory's internal pipeline is never surfaced here.
const fmtWhen = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
// Short "City, ST" from the loose address blob — the buyer's own destination, so seller-safe.
const destOf = (o: OrderRow) => {
  const a = (o.address ?? {}) as Record<string, string>
  return [a.city, a.state || a.province].filter(Boolean).join(", ")
}

export function SellerUploadHistory() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<SellerFilter>("All")
  useEffect(() => {
    const t = setTimeout(() => { getOrders().then((r) => setOrders(r ?? [])).catch(() => setOrders([])) }, 0)
    return () => clearTimeout(t)
  }, [])

  // Newest upload first. created_at is when the order landed — for a seller that IS "when I
  // uploaded it". Then narrow by the status filter and the search box.
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return [...(orders ?? [])]
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .filter((o) => matchesFilter(o, filter))
      .filter((o) => !term || [numOf(o), customerOf(o), o.store, o.tracking, itemsLabel(o)].some((f) => String(f ?? "").toLowerCase().includes(term)))
  }, [orders, q, filter])
  const today = useMemo(() => (orders ?? []).filter((o) => new Date(o.created_at || 0).getTime() >= startOfToday()).length, [orders])
  const paged = usePaged(rows, 25)

  return (
    <SectionCard
      title="Upload history"
      description="Everything you've uploaded, newest first — track where each order is at a glance."
    >
      <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {SELLER_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={"eg-tap rounded-full px-2.5 py-1 text-xs font-medium transition-colors " + (filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline"><span className="font-semibold text-foreground tabular-nums">{today}</span> today · <span className="font-semibold text-foreground tabular-nums">{orders?.length ?? 0}</span> total</span>
          <div className="relative w-full sm:w-56">
            <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, customer, tracking…" className="h-9 pl-8" />
          </div>
        </div>
      </div>

      {orders === null ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
          <UploadSimple size={26} weight="duotone" className="opacity-50" />
          <div className="text-sm font-medium text-foreground">{orders.length ? "Nothing matches that" : "Nothing uploaded yet"}</div>
          <div className="text-xs">{orders.length ? "Try a different filter or search." : "Orders you import or create will show up here."}</div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Uploaded</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Charged</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.pageItems.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtWhen(o.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-sm font-medium">{numOf(o)}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">{platformOf(o)}</span>
                    </div>
                    {o.store && <div className="truncate text-xs text-muted-foreground">{o.store}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[18rem] truncate text-sm">{itemsLabel(o)}</div>
                    <div className="text-xs text-muted-foreground">{unitsOf(o)} unit{unitsOf(o) === 1 ? "" : "s"}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="truncate">{customerOf(o)}</div>
                    {destOf(o) && <div className="truncate text-xs text-muted-foreground">{destOf(o)}</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                    {totalOf(o) > 0 ? usd(totalOf(o)) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <SellerStatusBadge order={o} />
                    {o.tracking && (
                      <a
                        href={trackUrl(o.carrier, o.tracking)} target="_blank" rel="noopener noreferrer"
                        className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-emerald-600 hover:underline"
                        title={`Track ${o.tracking}`}
                      >
                        {o.tracking}<ArrowSquareOut size={9} weight="bold" className="shrink-0" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {orders !== null && rows.length > 0 && (
        <Pagination
          page={paged.page} pageCount={paged.pageCount} perPage={paged.perPage}
          total={paged.total} start={paged.start}
          onPage={paged.setPage} onPerPage={paged.setPerPage} perPageOptions={[25, 50, 100]}
        />
      )}
    </SectionCard>
  )
}
