"use client"

import { useEffect, useMemo, useState } from "react"
import { UploadSimple, CircleNotch } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { SellerStatusBadge } from "@/components/app/seller-status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Pagination, usePaged } from "@/components/app/pagination"
import { getOrders, type OrderRow } from "@/lib/api"
import { numOf, platformOf, itemsLabel, unitsOf } from "@/lib/order-format"

// A seller's record of what THEY uploaded, newest first — so they can track their own
// orders without pinging us. It shows ONLY the seller-facing status (Pending / In
// Production / Shipped …) via SellerStatusBadge; the factory's internal pipeline stages are
// deliberately never surfaced here. Same collapse the rest of the seller surfaces use.
const fmtWhen = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

export function SellerUploadHistory() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  useEffect(() => {
    const t = setTimeout(() => { getOrders().then((r) => setOrders(r ?? [])).catch(() => setOrders([])) }, 0)
    return () => clearTimeout(t)
  }, [])

  // Newest upload first. created_at is when the order landed in our system — for a seller
  // that IS "when I uploaded it".
  const rows = useMemo(
    () => [...(orders ?? [])].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))),
    [orders],
  )
  const today = useMemo(() => rows.filter((o) => new Date(o.created_at || 0).getTime() >= startOfToday()).length, [rows])
  const paged = usePaged(rows, 25)

  return (
    <SectionCard
      title="Upload history"
      description="Everything you've uploaded, newest first — track where each order is at a glance."
    >
      <div className="flex items-center gap-4 border-b border-border px-5 py-2.5 text-xs text-muted-foreground">
        <span><span className="font-semibold text-foreground tabular-nums">{today}</span> uploaded today</span>
        <span><span className="font-semibold text-foreground tabular-nums">{rows.length}</span> total</span>
      </div>

      {orders === null ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
          <UploadSimple size={26} weight="duotone" className="opacity-50" />
          <div className="text-sm font-medium text-foreground">Nothing uploaded yet</div>
          <div className="text-xs">Orders you import or create will show up here.</div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Uploaded</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.pageItems.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtWhen(o.created_at)}</TableCell>
                  <TableCell>
                    <div className="font-mono text-sm font-medium">{numOf(o)}</div>
                    <div className="text-xs text-muted-foreground">{o.store || platformOf(o)}</div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[22rem] truncate text-sm">{itemsLabel(o)}</div>
                    <div className="text-xs text-muted-foreground">{unitsOf(o)} unit{unitsOf(o) === 1 ? "" : "s"}</div>
                  </TableCell>
                  <TableCell><SellerStatusBadge order={o} /></TableCell>
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
