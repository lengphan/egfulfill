"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { SubmitOrderButton } from "@/components/app/submit-order-button"
import { orderNeedsSetup } from "@/lib/variant-resolve"
import { stockSkuOf } from "@/lib/stock-status"
import { useRouter } from "next/navigation"
import { MagnifyingGlass, Plus, Package, Sparkle, UploadSimple, CaretRight, Truck, MapPin, ArrowSquareOut, Storefront } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { ImportOrdersDialog } from "@/components/app/import-orders-dialog"
import { SellerStatusBadge } from "@/components/app/seller-status-badge"
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
import { getOrders, getCatalogProducts, getOrderDesigns, indexDesigns, designForLine, postOrderDesign, getMyAccess, type OrderRow, type OrderItem, type CatalogProduct, type OrderDesign } from "@/lib/api"
import { ItemAvatar } from "@/components/app/item-avatar"
import { PhotoStack } from "@/components/app/photo-stack"
import { DesignCanvasDialog } from "@/components/app/design-canvas"
import { getToken, getUser } from "@/lib/auth"
import { matchesFilter, SELLER_FILTERS, type SellerFilter } from "@/lib/order-status"
import { VariantStrip } from "@/components/app/variant-field"
import { VariantPicker } from "@/components/app/variant-picker"
import { usd, numOf, totalOf, customerOf, storeOf, itemsLabel, unitsOf, lineTotal, fmtDate, shipTo, trackUrl } from "@/lib/order-format"
import { usePaged, Pagination } from "@/components/app/pagination"
import { ORDER_COLS, loadColOrder, saveColOrder, loadHiddenCols, saveHiddenCols, DEFAULT_ORDER_COLS, type OrderColId } from "@/lib/order-columns"
import { DesignQuoteBanner } from "@/components/app/design-quote-banner"
import { OrderedVariant } from "@/components/app/ordered-variant"

// PhotoStack moved to components/app/photo-stack.tsx so the factory boards render the
// identical strip instead of growing a second copy (CLAUDE.md §5).

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
function renderCell(id: OrderColId, o: OrderRow, designs?: Record<string, OrderDesign>, catalog?: CatalogProduct[]): React.ReactNode {
  switch (id) {
    case "order": return <span className="font-mono text-xs font-medium">{numOf(o)}</span>
    case "store": return <span className="text-muted-foreground">{storeOf(o)}</span>
    case "customer": return <span className="font-medium">{customerOf(o)}</span>
    case "items": return (
      <div className="flex min-w-0 items-center gap-2.5">
        <PhotoStack items={o.items ?? []} designs={designs} catalog={catalog} />
        <div className="min-w-0">
          <div className="truncate text-sm">{itemsLabel(o)}</div>
          <div className="truncate text-xs text-muted-foreground">{unitsOf(o)} unit{unitsOf(o) === 1 ? "" : "s"}</div>
        </div>
      </div>
    )
    case "status": return <SellerStatusBadge order={o} />
    case "tracking": return o.tracking
      ? <span className="truncate text-xs tabular-nums text-muted-foreground">{o.tracking}</span>
      : <span className="text-xs text-muted-foreground/60">—</span>
    case "total": return <span className="font-medium tabular-nums">{usd(totalOf(o))}</span>
    case "date": return <span className="text-muted-foreground">{fmtDate(o.created_at)}</span>
  }
}

export function OrdersList() {
  const router = useRouter()
  /**
   * WHO MAY CHANGE WHAT WE MAKE — the same rule the order hub applies, which this board did
   * not apply at all.
   *
   * The picker here was gated purely on factory_status, so ANY signed-in viewer of an
   * unstarted order got the editable strip: an operator or a warehouse hand opening this
   * page could change a colourway behind the seller's back. The hub locked that down
   * (canEditVariants = isAdmin) precisely because the floor executes the spec, it does not
   * set it.
   *
   * The seller keeps it, because this is their own board and their own order — they are the
   * one whose choice it is. Admin keeps it to correct. Operator and warehouse read it.
   *
   * NB the SERVER is looser than this by design: item-setup allows anyone who can see the
   * order until it is charged. This is a UI policy mirroring the hub, not the security
   * boundary — and it should not be mistaken for one.
   */
  const [role, setRole] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setRole(getUser()?.role || ""), 0)
    return () => clearTimeout(t)
  }, [])
  const canEditVariants = role === "seller" || role === "admin"
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<SellerFilter>("All")
  const [importOpen, setImportOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  // Placed artwork per order. Fetched only when a row is opened: pulling designs for
  // every row on load would be a request per order for imagery most sellers never expand.
  const [designs, setDesigns] = useState<Record<string, Record<string, OrderDesign>>>({})
  // No artwork-panel entry point here on purpose. A seller edits and uploads in the
  // mini designer (DesignCanvasDialog), which now takes a drop anywhere in it — adding a
  // second window alongside it was the thing that made this confusing.
  // The mini designer, opened from an item row — same surface the factory boards use, so
  // a seller edits artwork where the item is rather than navigating to the order first.
  const [editing, setEditing] = useState<{ order: OrderRow; item: OrderItem } | null>(null)
  /**
   * THE LINE AS IT IS NOW. `editing` is a snapshot taken on click, and the design window now
   * carries the variant picker — so picking a blank inside it saved, refreshed the board, and
   * then re-rendered the picker from the same stale object, which reads as a control that
   * does nothing. Re-found by line identity against the live orders.
   */
  const editingLive = useMemo(() => {
    if (!editing) return null
    const o = (orders ?? []).find((x) => x.id === editing.order.id) ?? editing.order
    const key = editing.item.line_id ?? editing.item.sku
    const it = (o.items ?? []).find((x) => (x.line_id ?? x.sku) === key) ?? editing.item
    return { order: o, item: it }
  }, [editing, orders])

  const reloadDesigns = useCallback((oid: string) => {
    getOrderDesigns(oid).then((r) => {
      const list = Array.isArray(r) ? r : (r?.designs ?? [])
      const bySku: Record<string, OrderDesign> = {}
      Object.assign(bySku, indexDesigns(list))
      setDesigns((p) => ({ ...p, [oid]: bySku }))
    }).catch(() => {})
  }, [])
  useEffect(() => {
    if (!expanded || designs[expanded]) return
    const oid = expanded
    const t = setTimeout(() => {
      getOrderDesigns(oid).then((r) => {
        const list = Array.isArray(r) ? r : (r?.designs ?? [])
        const bySku: Record<string, OrderDesign> = {}
        Object.assign(bySku, indexDesigns(list))
        setDesigns((p) => ({ ...p, [oid]: bySku }))
      }).catch(() => {})
    }, 0)
    return () => clearTimeout(t)
  }, [expanded, designs])
  // Column layout is per-device; read after mount so prerender and hydration agree.
  // Powers the inline variant pickers below — an unsubmitted line can be set up right in
  // the row instead of opening the order first.
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [colOrder, setColOrder] = useState<OrderColId[]>(DEFAULT_ORDER_COLS)
  const [hidden, setHidden] = useState<OrderColId[]>([])
  useEffect(() => {
    const id = setTimeout(() => {
      setColOrder(loadColOrder()); setHidden(loadHiddenCols())
      getCatalogProducts().then((c) => setCatalog(c ?? [])).catch(() => {})
    }, 0)
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

  // Whose orders am I looking at? A team member works IN their leader's shop — these are
  // the leader's orders, not theirs — and without saying so the list is confusing in both
  // directions ("where did my orders go?" / "why can they see these?"). Owners get null
  // and no banner.
  const [actingFor, setActingFor] = useState<string | null>(null)
  useEffect(() => {
    if (!getToken()) return
    let live = true
    const id = setTimeout(() => {
      getMyAccess()
        .then((a) => { if (live) setActingFor(a.member ? (a.ownerName ?? "your team") : null) })
        .catch(() => {})
    }, 0)
    return () => { live = false; clearTimeout(id) }
  }, [])

  const filtered = useMemo(() => {
    return (orders ?? []).filter((o) => {
      if (!matchesFilter(o, filter)) return false
      if (!query) return true
      // The ARTWORK counts as searchable text here too, by name and by its automatic
      // number — a seller looking for "the octopus one" or DSN-1042 is doing the same job
      // the factory does, and this list was matching on order number and buyer alone.
      const art = (o.items ?? [])
        .flatMap((it) => [it.design_name || "", it.design_no != null ? `DSN-${it.design_no} ${it.design_no}` : ""])
        .filter(Boolean).join(" ")
      const hay = `${numOf(o)} ${customerOf(o)} ${itemsLabel(o)} ${storeOf(o)} ${art}`.toLowerCase()
      return hay.includes(query.toLowerCase())
    })
  }, [orders, filter, query])

  const paged = usePaged(filtered, 25)

  return (
    <div className="space-y-4">
      {actingFor && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-2 text-sm">
          <Storefront size={15} weight="fill" className="shrink-0 text-primary" />
          <span>
            <span className="font-medium">Viewing {actingFor}&apos;s orders.</span>{" "}
            <span className="text-muted-foreground">
              You&apos;re working in their shop, so anything you create here belongs to them — your own orders stay separate and private.
            </span>
          </span>
        </div>
      )}
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
            <Package size={18} weight="regular"  className="shrink-0 text-muted-foreground" />
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
                        <TableCell key={id} className={cellClass(id)}>{renderCell(id, o, designs[o.id], catalog)}</TableCell>
                      ))}
                    </TableRow>

                    {/* Expanded detail — the photos, variants, destination and tracking
                        the flat row can't hold, without leaving the list. */}
                    {open && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={visibleCols.length + 1} className="bg-muted/30 p-0">
                          <div className="space-y-3 px-5 py-4">
                            {/* Quotes FIRST, above the lines. A pending quote is the only
                                thing on this order the seller has to act on, and burying it
                                beside the line it belongs to means it reads as a label
                                rather than a question. */}
                            {items.filter((it) => it.design_quote_status === "pending").map((it, i) => (
                              <DesignQuoteBanner
                                key={`q-${it.line_id ?? it.sku ?? i}`}
                                order={o} item={it}
                                onAnswered={() => load()}
                              />
                            ))}
                            <div className="space-y-2">
                              {items.length === 0 ? (
                                <div className="text-sm text-muted-foreground">No line items on this order.</div>
                              ) : items.map((it, i) => {
                                return (
                                  <div key={it.line_id ?? it.sku ?? i} className="flex items-start gap-3 rounded-xl border border-border bg-card p-2.5">
                                    <ItemAvatar
                                      item={it}
                                      designs={designs[o.id]}
                                      catalog={catalog}
                                      size={76}
                                      onEdit={() => setEditing({ order: o, item: it })}
                                      onDropImage={(dataUrl) => {
                                        if (!it.sku) return
                                        postOrderDesign(o.id, { sku: it.sku, line_id: it.line_id, data: dataUrl, name: it.name })
                                          .then(() => reloadDesigns(o.id))
                                          .catch(() => {})
                                      }}
                                    />
                                    {/* TITLE ROW then VARIANT ROW, rather than one row with the
                                        quantity and price tacked on the end.
                                        Quantity belongs to the title — "Tee ×2" is one fact, and
                                        splitting it across the width made the reader carry the
                                        name to the far edge to find out how many.
                                        The price sits above the variants and right-aligned so it
                                        lines up with the order total in the column behind it;
                                        that frees the whole width for the variant strip, which
                                        was being squeezed into whatever the price left over. */}
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-baseline gap-2">
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                          {it.name || it.sku || "Item"}
                                          <span className="ml-1.5 font-normal text-muted-foreground">×{Number(it.qty) || 1}</span>
                                        </span>
                                        <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">
                                          {lineTotal(it) ? usd(lineTotal(it)) : "—"}
                                        </span>
                                      </div>
                                      {/* The seller's own view of what their buyer picked. */}
                                      <OrderedVariant
                                        item={it}
                                        // Same three facts on the seller's own list: a
                                        // manual line has no listing variant, so without
                                        // this the row had nothing but a name.
                                        blankSku={stockSkuOf(it, catalog) || undefined}
                                      />
                                      {canEditVariants && ["", "new", "draft"].includes(String(o.factory_status || "")) ? (
                                        <VariantPicker orderId={o.id} item={it} catalog={catalog} onSaved={load} />
                                      ) : (
                                        <VariantStrip color={it.color} size={it.size} method={it.print_type} marketplace={it.variant} locked className="mt-1.5" />
                                      )}
                                    </div>
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
                                  className="inline-flex items-center gap-1 font-medium text-success hover:underline"
                                >
                                  <Truck size={12} weight="fill" /> {o.carrier || "USPS"} {o.tracking} <ArrowSquareOut size={10} weight="bold" />
                                </a>
                              ) : (
                                <span className="inline-flex items-center gap-1"><Truck size={12} weight="fill" /> No tracking yet</span>
                              )}
                              {/* Actions live together in the expanded row. Submit was
                                  briefly stacked under the Status badge, which put a
                                  column of primary buttons down the table — status is a
                                  STATE, submit is an ACTION, and six of them read as six
                                  alarms rather than one thing to do. */}
                              <span className="ml-auto flex items-center gap-2">
                                <SubmitOrderButton order={o} onDone={load} label="Submit to production" incomplete={orderNeedsSetup(o.items, catalog)} />
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

      {/* One editor for the list, pointed at whichever row was clicked. Reloads that
          order's designs on save so the row thumb rehydrates immediately. */}
      {editing && (
        <DesignCanvasDialog
          open
          onOpenChange={(v) => { if (!v) setEditing(null) }}
          orderId={editing.order.id}
          item={editingLive?.item ?? editing.item}
          initialDesign={designForLine(designs[editing.order.id], editing.item)?.data}
          initialPos={designForLine(designs[editing.order.id], editing.item)?.pos}
          catalog={catalog}
          // Sellers get "use on every line" too — ten shirts from one file is their case
          // more than the factory's. No onSendToDesigner: that spends factory time and
          // opens a payable card, so it stays staff-only and the prop is simply absent.
          siblings={(editing.order.items ?? []).filter((it) =>
            (it.line_id ?? it.sku) !== (editing.item.line_id ?? editing.item.sku))}
          designs={designs[editing.order.id]}
          onSaved={() => reloadDesigns(editing.order.id)}
        />
      )}
    </div>
  )
}
