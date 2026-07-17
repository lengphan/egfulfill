"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { MagnifyingGlass, Plus, Package, Sparkle, UploadSimple, CaretRight, Truck, MapPin, ArrowSquareOut } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { ImportOrdersDialog } from "@/components/app/import-orders-dialog"
import { SellerStatusBadge } from "@/components/app/seller-status-badge"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { ColumnsMenu } from "@/components/app/columns-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getOrders, type OrderRow, type OrderItem } from "@/lib/api"
import { getToken } from "@/lib/auth"
import { sellerStatus, matchesFilter, SELLER_FILTERS, type SellerFilter } from "@/lib/order-status"
import { itemImage } from "@/lib/order-image"
import { usd, numOf, totalOf, customerOf, storeOf, itemsLabel, variantOf, unitsOf, lineTotal, fmtDate, shipTo, trackUrl } from "@/lib/order-format"
import { usePaged, Pagination } from "@/components/app/pagination"
import { ORDER_COLS, loadColOrder, saveColOrder, loadHiddenCols, saveHiddenCols, DEFAULT_ORDER_COLS, type OrderColId } from "@/lib/order-columns"

/** Overlapping thumbnails of an order's items — the photos the flat table was missing. */
function PhotoStack({ items }: { items: OrderItem[] }) {
  const shown = items.slice(0, 3)
  const extra = items.length - shown.length
  return (
    <div className="flex shrink-0 items-center">
      {shown.map((it, i) => {
        const img = itemImage(it)
        return (
          <div
            key={it.sku ?? i}
            className={"relative size-8 overflow-hidden rounded-md border border-background bg-muted ring-1 ring-border " + (i ? "-ml-2.5" : "")}
            style={{ zIndex: shown.length - i }}
          >
            {img ? (
              <Image src={img} alt="" fill unoptimized sizes="32px" className="object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center text-muted-foreground/50"><Package size={12} weight="duotone" /></div>
            )}
          </div>
        )
      })}
      {extra > 0 && (
        <span className="-ml-2.5 flex size-8 items-center justify-center rounded-md border border-background bg-muted text-[10px] font-semibold text-muted-foreground ring-1 ring-border">
          +{extra}
        </span>
      )}
    </div>
  )
}

// Demo fallback (no session / standalone dev).
const DEMO: OrderRow[] = [
  { id: "etsy-4142", seq: 4142, source: "etsy", customer: { name: "A. Nguyen" }, factory_status: "printing", total: 63.75, created_at: "2026-04-12", items: [{ name: "Hoodie · black", qty: 1 }] },
  { id: "sh-4140", seq: 4140, source: "shopify", customer: { name: "M. Tran" }, factory_status: "shipped", total: 27, created_at: "2026-04-11", items: [{ name: "Tee", qty: 2 }] },
  { id: "etsy-4131", seq: 4131, source: "etsy", customer: { name: "J. Pham" }, factory_status: "qc", total: 31.5, created_at: "2026-04-11", items: [{ name: "Embroidered cap", qty: 1 }] },
  { id: "FF-4126", seq: 4126, source: "manual", customer: { name: "K. Le" }, factory_status: "packed", total: 44.2, created_at: "2026-04-10", items: [{ name: "Crewneck · sand", qty: 1 }] },
  { id: "sh-4119", seq: 4119, source: "shopify", customer: { name: "T. Vo" }, factory_status: "new", total: 16.8, created_at: "2026-04-09", items: [{ name: "Tote · natural", qty: 2 }] },
  { id: "etsy-4110", seq: 4110, source: "etsy", customer: { name: "H. Dang" }, factory_status: "queued", total: 38.4, created_at: "2026-04-08", items: [{ name: "Mug · 15oz", qty: 3 }] },
]

// ONE renderer per column id, so the header, the cells and the Columns menu all
// stay in step off the same array — the old app's bug was adding a column in the
// markup but forgetting COL_ORDER, which silently jumped it to the front.
const cellClass = (id: OrderColId) => {
  const c = ORDER_COLS[id]
  const base = id === "items" ? "" : "truncate"
  return [base, c.align === "right" ? "text-right" : ""].filter(Boolean).join(" ")
}
function renderCell(id: OrderColId, o: OrderRow): React.ReactNode {
  switch (id) {
    case "order": return <span className="font-mono text-xs font-medium">{numOf(o)}</span>
    case "store": return <span className="text-muted-foreground">{storeOf(o)}</span>
    case "customer": return <span className="font-medium">{customerOf(o)}</span>
    case "items": return (
      <div className="flex min-w-0 items-center gap-2.5">
        <PhotoStack items={o.items ?? []} />
        <div className="min-w-0">
          <div className="truncate text-sm">{itemsLabel(o)}</div>
          <div className="truncate text-xs text-muted-foreground">{unitsOf(o)} unit{unitsOf(o) === 1 ? "" : "s"}</div>
        </div>
      </div>
    )
    case "status": return <SellerStatusBadge order={o} />
    case "tracking": return o.tracking
      ? <span className="truncate font-mono text-xs text-muted-foreground">{o.tracking}</span>
      : <span className="text-xs text-muted-foreground/60">—</span>
    case "total": return <span className="font-medium tabular-nums">{usd(totalOf(o))}</span>
    case "date": return <span className="text-muted-foreground">{fmtDate(o.created_at)}</span>
  }
}

export function OrdersList() {
  const router = useRouter()
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<SellerFilter>("All")
  const [importOpen, setImportOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  // Column layout is per-device; read after mount so prerender and hydration agree.
  const [colOrder, setColOrder] = useState<OrderColId[]>(DEFAULT_ORDER_COLS)
  const [hidden, setHidden] = useState<OrderColId[]>([])
  useEffect(() => {
    const id = setTimeout(() => { setColOrder(loadColOrder()); setHidden(loadHiddenCols()) }, 0)
    return () => clearTimeout(id)
  }, [])
  const setOrderCols = (ids: OrderColId[]) => { setColOrder(ids); saveColOrder(ids) }
  const setHiddenCols = (ids: OrderColId[]) => { setHidden(ids); saveHiddenCols(ids) }
  const visibleCols = useMemo(() => colOrder.filter((id) => !hidden.includes(id)), [colOrder, hidden])

  const load = useCallback(() => {
    // Signed in → show real data (empty state if none). Only fall back to samples
    // when there's no session at all (standalone/marketing preview).
    const signedIn = !!getToken()
    getOrders()
      .then((rows) => {
        if (rows && rows.length) {
          setOrders(rows)
          setIsDemo(false)
        } else {
          setOrders(signedIn ? [] : DEMO)
          setIsDemo(!signedIn)
        }
      })
      .catch(() => {
        setOrders(signedIn ? [] : DEMO)
        setIsDemo(!signedIn)
      })
  }, [])
  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [load])

  const stats = useMemo(() => {
    const list = orders ?? []
    const byGroup = (g: string) => list.filter((o) => sellerStatus(o).group === g).length
    return {
      received: byGroup("received"),
      prod: byGroup("production"),
      shipped: byGroup("shipped"),
      attention: byGroup("attention"),
    }
  }, [orders])

  const filtered = useMemo(() => {
    return (orders ?? []).filter((o) => {
      if (!matchesFilter(o, filter)) return false
      if (!query) return true
      const hay = `${numOf(o)} ${customerOf(o)} ${itemsLabel(o)} ${storeOf(o)}`.toLowerCase()
      return hay.includes(query.toLowerCase())
    })
  }, [orders, filter, query])

  const paged = usePaged(filtered, 25)

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Received" value={String(stats.received)} sub="new orders" />
        <StatCard label="In production" value={String(stats.prod)} sub="being fulfilled" />
        <StatCard label="Shipped" value={String(stats.shipped)} sub="fulfilled" tone="pos" />
        <StatCard label="Needs attention" value={String(stats.attention)} sub="action needed" tone={stats.attention ? "neg" : undefined} />
      </StatGrid>

      <SectionCard
        title="Orders"
        actions={
          <div className="flex items-center gap-2">
            <ColumnsMenu order={colOrder} hidden={hidden} onOrder={setOrderCols} onHidden={setHiddenCols} />
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <UploadSimple size={14} weight="bold" /> Import
            </Button>
            <Button size="sm" variant="outline" onClick={() => router.push("/orders/new")}>
              <Plus size={14} weight="bold" /> New order
            </Button>
          </div>
        }
      >
        {/* toolbar */}
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {SELLER_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  "rounded-full px-3 py-1 text-sm font-medium transition-colors " +
                  (filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
                }
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative max-w-xs flex-1">
            <MagnifyingGlass size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search orders…"
              className="h-9 pl-8"
            />
          </div>
        </div>

        {isDemo && (
          <div className="flex items-center gap-2 border-b border-border bg-amber-50 px-5 py-2 text-xs font-medium text-amber-700">
            <Sparkle size={13} weight="fill" /> Showing sample orders — sign in to load your live queue.
          </div>
        )}

        {orders === null ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Package size={22} weight="duotone" />
            </span>
            {(orders?.length ?? 0) === 0 ? (
              <>
                <div className="font-medium">No orders yet</div>
                <div className="max-w-xs text-sm text-muted-foreground">
                  Orders will appear here once you create one or connect a store to sync.
                </div>
                <div className="mt-1 flex gap-2">
                  <Button size="sm" onClick={() => router.push("/orders/new")}>
                    <Plus size={14} weight="bold" /> New order
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => router.push("/stores")}>
                    Connect a store
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="font-medium">No orders here</div>
                <div className="text-sm text-muted-foreground">Nothing matches that filter or search.</div>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36px]" />
                {visibleCols.map((id) => {
                  const c = ORDER_COLS[id]
                  return <TableHead key={id} className={[c.width, c.align === "right" ? "text-right" : ""].filter(Boolean).join(" ")}>{c.label}</TableHead>
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.pageItems.map((o) => {
                const items = o.items ?? []
                const open = expanded === o.id
                return (
                  <Fragment key={o.id}>
                    <TableRow
                      onClick={() => setExpanded(open ? null : o.id)}
                      className={"cursor-pointer focus-visible:bg-accent focus-visible:outline-none " + (open ? "bg-accent/40" : "")}
                    >
                      <TableCell className="pr-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpanded(open ? null : o.id) }}
                          aria-label={open ? `Collapse order ${numOf(o)}` : `Expand order ${numOf(o)}`}
                          aria-expanded={open}
                          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <CaretRight size={12} weight="bold" className={"transition-transform " + (open ? "rotate-90" : "")} />
                        </button>
                      </TableCell>
                      {visibleCols.map((id) => (
                        <TableCell key={id} className={cellClass(id)}>{renderCell(id, o)}</TableCell>
                      ))}
                    </TableRow>

                    {/* Expanded detail — the photos, variants, destination and tracking
                        the flat row can't hold, without leaving the list. */}
                    {open && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={visibleCols.length + 1} className="bg-muted/30 p-0">
                          <div className="space-y-3 px-5 py-4">
                            <div className="space-y-2">
                              {items.length === 0 ? (
                                <div className="text-sm text-muted-foreground">No line items on this order.</div>
                              ) : items.map((it, i) => {
                                const img = itemImage(it)
                                return (
                                  <div key={it.sku ?? i} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
                                    <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                                      {img ? <Image src={img} alt="" fill unoptimized sizes="48px" className="object-cover" />
                                        : <div className="flex size-full items-center justify-center text-muted-foreground/50"><Package size={16} weight="duotone" /></div>}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-sm font-medium">{it.name || it.sku || "Item"}</div>
                                      <div className="truncate text-xs text-muted-foreground">{variantOf(it) || "—"}</div>
                                    </div>
                                    <span className="shrink-0 text-xs text-muted-foreground">×{Number(it.qty) || 1}</span>
                                    <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">{lineTotal(it) ? usd(lineTotal(it)) : "—"}</span>
                                  </div>
                                )
                              })}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                              {shipTo(o) && <span className="inline-flex items-center gap-1"><MapPin size={12} weight="fill" /> {shipTo(o)}</span>}
                              {o.tracking ? (
                                <a
                                  href={trackUrl(o.carrier, o.tracking)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 font-medium text-emerald-600 hover:underline"
                                >
                                  <Truck size={12} weight="fill" /> {o.carrier || "USPS"} {o.tracking} <ArrowSquareOut size={10} weight="bold" />
                                </a>
                              ) : (
                                <span className="inline-flex items-center gap-1"><Truck size={12} weight="fill" /> No tracking yet</span>
                              )}
                              <span className="ml-auto">
                                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); router.push(`/orders/${encodeURIComponent(o.id)}`) }}>
                                  Open order <CaretRight size={12} weight="bold" />
                                </Button>
                              </span>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
          </div>
        )}
        {orders !== null && filtered.length > 0 && (
          <Pagination page={paged.page} pageCount={paged.pageCount} perPage={paged.perPage} total={paged.total} start={paged.start} onPage={paged.setPage} onPerPage={paged.setPerPage} perPageOptions={[25, 50, 100]} />
        )}
      </SectionCard>

      <ImportOrdersDialog open={importOpen} onOpenChange={setImportOpen} onImported={() => load()} />
    </div>
  )
}
