"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import { ordersHomeFor } from "@/lib/staff-nav"
import { numOf } from "@/lib/order-format"
import { getUser } from "@/lib/auth"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Package, MapPin, Truck, Clock, PaperPlaneTilt, PenNib } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { getOrderDesignStatus, type OrderDesignStatus } from "@/lib/api"
import { OrderRefundPanel } from "@/components/app/order-refund-panel"
import { ItemDesignActions } from "@/components/app/item-design-actions"
import { SellerStatusBadge } from "@/components/app/seller-status-badge"
import { DesignCanvasDialog } from "@/components/app/design-canvas"
import { ItemAvatar } from "@/components/app/item-avatar"
import { OrderHistory } from "@/components/app/order-history"
import { SubmitOrderButton } from "@/components/app/submit-order-button"
import { SellerDesignFiles } from "@/components/app/design-files-panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getOrders,
  getOrder,
  getOrderDesigns,
  getOrderMessages,
  getOrderQuote,
  getCatalogProducts,
  postOrderMessage,
  updateOrder,
  type OrderRow,
  type OrderItem,
  type OrderDesign,
  type ChatEntry,
  type OrderQuote,
  type CatalogProduct,
} from "@/lib/api"
import { VariantPicker } from "@/components/app/variant-picker"
import { VariantStrip } from "@/components/app/variant-field"
import { designSrc } from "@/lib/order-image"

const fmtMsgTime = (ts?: number) => {
  if (!ts) return ""
  const d = new Date(ts)
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

// Coerce rather than trust: a manual order legitimately has no total until it's priced,
// and a quote field can be absent — either one used to take the whole page down with
// "cannot read properties of undefined".
const usd = (n: number | string | null | undefined) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDateTime = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}

type Addr = { name?: string; line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string }
type TimelineEntry = { status?: string; at?: string }

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = decodeURIComponent(String(params?.id ?? ""))
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [one, setOne] = useState<OrderRow | null>(null)
  const [designs, setDesigns] = useState<Record<string, OrderDesign>>({})
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [msg, setMsg] = useState("")
  const [customize, setCustomize] = useState<OrderItem | null>(null)
  // Design-partner state per line. Read separately from the order so a failure costs the
  // chip, not the page — and it 403s for sellers, which is exactly the intended result:
  // null means "no partner UI here", not "broken".
  const [designStatus, setDesignStatus] = useState<OrderDesignStatus | null>(null)
  const loadDesignStatus = useCallback(() => {
    if (!id) return
    getOrderDesignStatus(id).then(setDesignStatus).catch(() => setDesignStatus(null))
  }, [id])
  useEffect(() => { const t = setTimeout(loadDesignStatus, 0); return () => clearTimeout(t) }, [loadDesignStatus])
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [quote, setQuote] = useState<OrderQuote | null>(null)

  // Re-pull orders after an action that changes this one (submit, cancel) so the badge
  // and the action bar reflect the new status without a manual refresh.
  const reload = () => { getOrders().then((rows) => setOrders(rows ?? [])).catch(() => {}) }

  const reloadDesigns = () => {
    getOrderDesigns(id)
      .then((r) => {
        const list = Array.isArray(r) ? r : (r?.designs ?? [])
        const by: Record<string, OrderDesign> = {}
        for (const d of list) if (d.sku && d.data && !by[d.sku]) by[d.sku] = d
        setDesigns(by)
      })
      .catch(() => {})
  }

  useEffect(() => {
    let alive = true
    // Fetch THIS order directly. Scanning getOrders() meant an order the list filters out
    // — a freshly created factory order, say — rendered as "Order not found" despite
    // existing. The list is still loaded for neighbouring context, but it no longer
    // decides whether the order exists.
    if (id) {
      getOrder(String(id))
        .then((o) => { if (alive && o && !o.error) setOne(o) })
        .catch(() => {})
    }
    getOrders()
      .then((rows) => alive && setOrders(rows ?? []))
      .catch(() => alive && setOrders([]))
    // Catalog powers the variant picker's blank/colour/size/method options.
    getCatalogProducts().then((c) => alive && setCatalog(c ?? [])).catch(() => {})
    if (id) {
      getOrderDesigns(id)
        .then((r) => {
          const list = Array.isArray(r) ? r : (r?.designs ?? [])
          const by: Record<string, OrderDesign> = {}
          for (const d of list) if (d.sku && d.data && !by[d.sku]) by[d.sku] = d
          if (alive) setDesigns(by)
        })
        .catch(() => {})
      getOrderMessages(id)
        .then((r) => alive && setMessages(Array.isArray(r) ? r : []))
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [id])

  const sendMsg = async () => {
    const text = msg.trim()
    if (!text) return
    setMsg("")
    const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // Attribute the optimistic bubble to whoever is actually typing. It was hardcoded to
    // "seller", so a warehouse message showed as coming from the seller — on the one
    // surface where who-said-what is the whole point.
    const myRole = getUser()?.role || "seller"
    setMessages((prev) => [...prev, { id: clientId, role: myRole, text, ts: Date.now() }])
    try {
      await postOrderMessage(id, text, { clientId })
      const r = await getOrderMessages(id)
      setMessages(Array.isArray(r) ? r : [])
    } catch {
      /* keep optimistic message */
    }
  }

  // The directly-fetched order wins; the list is a fallback for anything already loaded.
  const order = useMemo(() => one ?? (orders ?? []).find((o) => o.id === id) ?? null, [one, orders, id])

  // The quote is fetched HERE rather than inside the submit button because two places
  // render it: the Summary card (the breakdown) and the confirm dialog (the amount).
  // It used to live in the button, which is why the price floated loose in the header.
  const submittable = !!order && ["", "new", "draft"].includes(String(order.factory_status || ""))
  useEffect(() => {
    let live = true
    // Deferred rather than set synchronously — this codebase's lint rule (and React's
    // guidance) rejects a straight setState in an effect body; it cascades a render.
    const id = setTimeout(() => {
      if (!live) return
      if (!order || !submittable) { setQuote(null); return }
      getOrderQuote(order.id).then((q) => { if (live) setQuote(q) }).catch(() => {})
    }, 0)
    return () => { live = false; clearTimeout(id) }
  }, [order, submittable])

  if (orders === null) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Package size={26} weight="duotone" />
        </span>
        <div className="font-medium">Order not found</div>
        <div className="text-sm text-muted-foreground">It may have been removed, or the link is stale.</div>
        {/* Role-aware: staff belong on their production board, not the seller list. */}
        <Button variant="outline" size="sm" onClick={() => router.push(ordersHomeFor(getUser()?.role))}>
          <ArrowLeft size={14} weight="bold" /> Back to orders
        </Button>
      </div>
    )
  }

  const items = order.items ?? []
  // Variants are editable only before submit — after that the cost is frozen and the
  // server rejects changes. new/draft/"" = not yet submitted.
  const preSubmit = ["", "new", "draft"].includes(String(order.factory_status || ""))
  // Was a private copy of numOf, so the detail page still showed the raw "etsy-4120118148"
  // after the boards were stripping the source prefix. Use the shared formatter.
  const num = numOf(order)
  const store = (order.store || order.source || "manual").toString()
  const addr = (order.address ?? {}) as Addr
  const cust = order.customer ?? {}
  const timeline = (Array.isArray(order.timeline) ? order.timeline : []) as TimelineEntry[]
  const itemsTotal = items.reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 1), 0)
  const total = Number(order.total ?? 0) || 0

  return (
    <div className="space-y-5">
      {/* Header. Identity + metadata on the left, actions on the right — one baseline
          each. The quote breakdown that used to float here now lives in Summary, next
          to the Total it was duplicating. */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/orders")} className="-ml-2 mb-1 h-7 text-muted-foreground">
          <ArrowLeft size={16} weight="bold" /> Orders
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="font-display text-2xl font-semibold tracking-tight">{num}</h1>
              <SellerStatusBadge order={order} />
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {store.charAt(0).toUpperCase() + store.slice(1)} · {fmtDateTime(order.created_at)}
            </div>
          </div>
          {/* Secondary first, primary last — the destructive action shouldn't lead. */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <CancelOrderButton order={order} onDone={reload} />
            <SubmitOrderButton order={order} quote={quote} onDone={reload} />
          </div>
        </div>
      </div>

      {/* min-w-0 on both tracks: a grid item's automatic minimum size is its MIN-CONTENT
          width, so a long unbroken order/SKU string holds the 1.6fr track open and pushes
          the whole grid past its container — the page then scrolls sideways. There was
          slack to absorb it at 1600px; at the reading width there isn't. */}
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* items + timeline */}
        <div className="min-w-0 space-y-5">
          <SectionCard title={`Items (${items.length})`}>
            {items.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No line items on this order.</div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((it, i) => {
                  const design = it.sku ? designs[it.sku] : undefined
                  const artwork = designSrc(design?.data)
                  const qty = Number(it.qty) || 1
                  const unit = Number(it.unit_price) || 0
                  return (
                    <div key={i} className="flex items-start gap-4 px-5 py-4">
                      {/* The blank with its artwork placed — the seller sees the same
                          composite the floor will produce from. */}
                      <div className="relative shrink-0">
                        <ItemAvatar
                          item={it}
                          designs={designs}
                          catalog={catalog}
                          size={56}
                          onEdit={() => setCustomize(it)}
                        />
                        {artwork && (
                          <span className="pointer-events-none absolute bottom-0 right-0 flex size-4 items-center justify-center rounded-tl bg-primary text-primary-foreground" title={design?.name || "Design attached"}>
                            <PenNib size={9} weight="fill" />
                          </span>
                        )}
                      </div>
                      {/* One column holding three stacked zones — identity+price, then
                          the variant fields, then the design action. Previously the
                          action shared a cramped right rail with the price, which buried
                          the item's primary control under secondary text. */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{it.name || it.sku || "Item"}</div>
                            {it.sku && <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{it.sku}</div>}
                          </div>
                          <div className="shrink-0 text-right text-sm">
                            <div className="font-medium tabular-nums">{usd(unit * qty)}</div>
                            <div className="text-xs tabular-nums text-muted-foreground">{qty} × {usd(unit)}</div>
                          </div>
                        </div>

                        {preSubmit ? (
                          // Before submit: pick the blank + variants (marketplace orders
                          // arrive unset). Saving updates the quote in Summary.
                          <VariantPicker orderId={String(id)} item={it} catalog={catalog} onSaved={reload} />
                        ) : (
                          <VariantStrip blank={it.blank} color={it.color} size={it.size} method={it.print_type} marketplace={it.variant} locked className="mt-2" />
                        )}

                        {it.sku && (
                          <div className="mt-3 flex items-center justify-end gap-2">
                            {/* Partner chip + the tucked-away send action. Staff only —
                                it renders nothing when design-status can't be read, which
                                is what a seller gets. */}
                            {designStatus && (
                              <ItemDesignActions
                                orderId={id}
                                sku={String(it.sku)}
                                itemName={it.name}
                                qty={qty}
                                printType={it.print_type}
                                artworkUrl={artwork}
                                state={designStatus.bySku[String(it.sku)]}
                                onChanged={loadDesignStatus}
                              />
                            )}
                            <Button size="sm" variant="outline" onClick={() => setCustomize(it)}>
                              <PenNib size={13} weight="bold" /> {artwork ? "Edit design" : "Customize"}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>

          {/* Design deliverables — the seller's .pes files. Factory .emb/mockups are
              filtered out server-side and the bytes are paywalled there too, so this
              renders nothing when there's nothing they can buy. */}
          <SectionCard title="Design files" description="Machine files for this order — download once purchased">
            <div className="p-5"><SellerDesignFiles orderId={String(id)} /></div>
          </SectionCard>

          {timeline.length > 0 && (
            <SectionCard title="Timeline">
              <ol className="space-y-3 p-5">
                {timeline.map((t, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Clock size={13} weight="bold" />
                    </span>
                    <div>
                      <div className="text-sm font-medium capitalize">{(t.status || "").replace(/_/g, " ")}</div>
                      <div className="text-xs text-muted-foreground">{fmtDateTime(t.at)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </SectionCard>
          )}

          {/* The RECORD, distinct from the conversation below it. */}
          <OrderHistory orderId={String(id)} />

          <SectionCard title="Order activity" description="Messages & notes on this order">
            <div className="flex flex-col">
              <div className="max-h-72 min-h-[80px] flex-1 space-y-3 overflow-y-auto p-5">
                {messages.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">No messages yet — start the conversation.</div>
                ) : (
                  messages.map((m) => {
                    // "Mine" is whoever is READING, not always the seller. On a staff
                    // board every message rendered as if it came from the other side.
                    const myRole = getUser()?.role || "seller"
                    const mine = (m.role ?? "seller") === myRole
                    return (
                      <div key={String(m.id)} className={"flex flex-col " + (mine ? "items-end" : "items-start")}>
                        <div className={"max-w-[80%] rounded-2xl px-3.5 py-2 text-sm " + (mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                          {m.text}
                        </div>
                        <span className="mt-0.5 text-[10px] text-muted-foreground">
                          {m.by ? `${m.by} · ` : m.role && m.role !== "seller" ? `${m.role} · ` : ""}
                          {fmtMsgTime(m.ts)}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
              <div className="flex items-center gap-2 border-t border-border p-3">
                <Input
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      sendMsg()
                    }
                  }}
                  placeholder="Add a message or note…"
                  className="h-10"
                />
                <Button size="icon" className="size-10" onClick={sendMsg} disabled={!msg.trim()}>
                  <PaperPlaneTilt size={16} weight="fill" />
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* summary */}
        <div className="min-w-0 space-y-5">
          <SectionCard title="Customer">
            <div className="space-y-3 p-5 text-sm">
              <div>
                <div className="font-medium">{cust.name || "—"}</div>
                {cust.email && <div className="text-muted-foreground">{cust.email}</div>}
              </div>
              {(addr.line1 || addr.city) && (
                <div className="flex items-start gap-2 border-t border-border pt-3 text-muted-foreground">
                  <MapPin size={15} className="mt-0.5 shrink-0" />
                  <div>
                    {addr.name && <div>{addr.name}</div>}
                    {addr.line1 && <div>{addr.line1}</div>}
                    {addr.line2 && <div>{addr.line2}</div>}
                    <div>{[addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</div>
                    {addr.country && <div>{addr.country}</div>}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          {(order.tracking || order.carrier) && (
            <SectionCard title="Shipping">
              <div className="flex items-start gap-2 p-5 text-sm">
                <Truck size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  {order.carrier && <div className="font-medium">{order.carrier}</div>}
                  {order.tracking && <div className="font-mono text-xs text-muted-foreground">{order.tracking}</div>}
                </div>
              </div>
            </SectionCard>
          )}

          {/* Summary owns every number on this page. Pre-submit it shows the QUOTE (what
              we'll charge to produce this); once submitted the price is frozen and it
              falls back to the order's own totals. */}
          <SectionCard title="Summary">
            <dl className="space-y-2 p-5 text-sm">
              {quote && !quote.unpriced?.length ? (
                <>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Production</dt>
                    <dd className="tabular-nums">{usd(quote.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Shipping</dt>
                    <dd className="tabular-nums">{usd(quote.shipping)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2 font-semibold">
                    <dt>Total</dt>
                    <dd className="tabular-nums">{usd(quote.total)}</dd>
                  </div>
                  <p className="pt-1 text-xs text-muted-foreground">Charged when you submit to production.</p>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Items</dt>
                    <dd className="tabular-nums">{usd(itemsTotal)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2 font-semibold">
                    <dt>Total</dt>
                    <dd className="tabular-nums">{usd(total)}</dd>
                  </div>
                </>
              )}
              {quote?.unpriced?.length ? (
                <p className="border-t border-border pt-2 text-xs text-destructive">
                  Not priced yet: {quote.unpriced.map((u) => u.sku).join(", ")} — pick a blank on those lines first.
                </p>
              ) : null}
            </dl>
          </SectionCard>

          {/* Sits under Summary: what was charged, then what can be sent back. Renders
              nothing for sellers and for staff without the permission. */}
          <OrderRefundPanel orderId={id} />
        </div>
      </div>

      {customize && (
        <DesignCanvasDialog
          open={!!customize}
          onOpenChange={(v) => !v && setCustomize(null)}
          orderId={id}
          item={customize}
          initialDesign={designSrc(designs[customize.sku ?? ""]?.data)}
          initialPos={designs[customize.sku ?? ""]?.pos}
          siblings={items.filter((it) => (it.line_id ?? it.sku) !== (customize.line_id ?? customize.sku))}
          designs={designs}
          onSaved={reloadDesigns}
          catalog={catalog}
        />
      )}
    </div>
  )
}

/**
 * Cancel — only while the factory hasn't started. `started` mirrors the SERVER rule
 * (factory_status not in new/draft/''), which is what actually enforces this: hiding
 * the button is courtesy, the 403 is the gate.
 */

function CancelOrderButton({ order, onDone }: { order: OrderRow; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  // Mirrors the SERVER rule: in_review is still cancellable (submitted + charged,
  // but the floor hasn't started). Past that it's a refund request.
  const fs = String(order.factory_status || "")
  const started = !["", "new", "draft", "in_review"].includes(fs)
  const done = fs === "cancelled" || fs === "refunded"
  if (done) return <span className="text-xs font-medium text-muted-foreground">Order {fs}</span>

  const cancel = async () => {
    setBusy(true); setErr(null)
    try {
      await updateOrder(order.id, { factoryStatus: "cancelled", status: "cancelled" })
      setConfirm(false)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not cancel this order")
    } finally { setBusy(false) }
  }

  if (started) {
    return (
      <span className="text-xs text-muted-foreground" title="Cancelling is only possible before the factory starts">
        In production — message support to cancel
      </span>
    )
  }
  return (
    <span className="flex items-center gap-2">
      {err && <span className="text-xs text-destructive">{err}</span>}
      {confirm ? (
        <>
          <span className="text-xs text-muted-foreground">Cancel this order?</span>
          <Button size="sm" variant="destructive" onClick={cancel} disabled={busy}>{busy ? "Cancelling…" : "Yes, cancel"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>Cancel order</Button>
      )}
    </span>
  )
}
