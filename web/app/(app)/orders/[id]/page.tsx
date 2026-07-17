"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Image from "next/image"
import { ArrowLeft, Package, MapPin, Truck, Clock, PaperPlaneTilt, PenNib } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { SellerStatusBadge } from "@/components/app/seller-status-badge"
import { DesignCanvasDialog } from "@/components/app/design-canvas"
import { SellerDesignFiles } from "@/components/app/design-files-panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getOrders,
  getOrderDesigns,
  getOrderMessages,
  getOrderQuote,
  getCatalogProducts,
  postOrderMessage,
  updateOrder,
  ApiError,
  type OrderRow,
  type OrderItem,
  type OrderDesign,
  type ChatEntry,
  type OrderQuote,
  type CatalogProduct,
} from "@/lib/api"
import { VariantPicker } from "@/components/app/variant-picker"
import { designSrc, itemImage } from "@/lib/order-image"

const fmtMsgTime = (ts?: number) => {
  if (!ts) return ""
  const d = new Date(ts)
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const itemImg = (it: OrderItem) => itemImage(it)
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
  const [designs, setDesigns] = useState<Record<string, OrderDesign>>({})
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [msg, setMsg] = useState("")
  const [customize, setCustomize] = useState<OrderItem | null>(null)
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])

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
    setMessages((prev) => [...prev, { id: clientId, role: "seller", text, ts: Date.now() }])
    try {
      await postOrderMessage(id, text, { clientId })
      const r = await getOrderMessages(id)
      setMessages(Array.isArray(r) ? r : [])
    } catch {
      /* keep optimistic message */
    }
  }

  const order = useMemo(() => (orders ?? []).find((o) => o.id === id) ?? null, [orders, id])

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
        <Button variant="outline" size="sm" onClick={() => router.push("/orders")}>
          <ArrowLeft size={14} weight="bold" /> Back to orders
        </Button>
      </div>
    )
  }

  const items = order.items ?? []
  // Variants are editable only before submit — after that the cost is frozen and the
  // server rejects changes. new/draft/"" = not yet submitted.
  const preSubmit = ["", "new", "draft"].includes(String(order.factory_status || ""))
  const num = order.seq ? `#${order.seq}` : order.id
  const store = (order.store || order.source || "manual").toString()
  const addr = (order.address ?? {}) as Addr
  const cust = order.customer ?? {}
  const timeline = (Array.isArray(order.timeline) ? order.timeline : []) as TimelineEntry[]
  const itemsTotal = items.reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 1), 0)
  const total = Number(order.total ?? 0) || 0

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/orders")} className="text-muted-foreground">
            <ArrowLeft size={16} weight="bold" /> Orders
          </Button>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{num}</h1>
            <SellerStatusBadge order={order} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            {store.charAt(0).toUpperCase() + store.slice(1)} · {fmtDateTime(order.created_at)}
          </div>
          <SubmitOrderButton order={order} onDone={reload} />
          <CancelOrderButton order={order} onDone={reload} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* items + timeline */}
        <div className="space-y-5">
          <SectionCard title={`Items (${items.length})`}>
            {items.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No line items on this order.</div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((it, i) => {
                  const design = it.sku ? designs[it.sku] : undefined
                  const artwork = designSrc(design?.data)
                  const img = artwork || itemImg(it)
                  const qty = Number(it.qty) || 1
                  const unit = Number(it.unit_price) || 0
                  return (
                    <div key={i} className="flex items-center gap-4 px-5 py-4">
                      <div className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/40">
                        {img ? (
                          <Image src={img} alt={it.name ?? "Item"} fill unoptimized className="object-cover" />
                        ) : (
                          <div className="flex size-full items-center justify-center text-muted-foreground">
                            <Package size={18} weight="duotone" />
                          </div>
                        )}
                        {artwork && (
                          <span className="absolute bottom-0 right-0 flex size-4 items-center justify-center rounded-tl bg-primary text-primary-foreground" title={design?.name || "Design attached"}>
                            <PenNib size={9} weight="fill" />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{it.name || it.sku || "Item"}</div>
                        {preSubmit ? (
                          // Before submit: pick the blank + variants (marketplace orders
                          // arrive unset). Saving updates the quote the Submit button shows.
                          <VariantPicker orderId={String(id)} item={it} catalog={catalog} onSaved={reload} />
                        ) : (
                          <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                            {it.blank && <span className="rounded bg-muted px-1.5 py-0.5">{it.blank}</span>}
                            {it.color && <span className="rounded bg-muted px-1.5 py-0.5">{it.color}</span>}
                            {it.size && <span className="rounded bg-muted px-1.5 py-0.5">{it.size}</span>}
                            {it.print_type && <span className="rounded bg-muted px-1.5 py-0.5">{it.print_type}</span>}
                            {it.sku && <span className="font-mono">{it.sku}</span>}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 text-right text-sm">
                        <div className="font-medium tabular-nums">{usd(unit * qty)}</div>
                        <div className="text-xs text-muted-foreground">{qty} × {usd(unit)}</div>
                        {it.sku && (
                          <Button size="sm" variant="outline" onClick={() => setCustomize(it)}>
                            <PenNib size={13} weight="bold" /> {artwork ? "Edit design" : "Customize"}
                          </Button>
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

          <SectionCard title="Order activity" description="Messages & notes on this order">
            <div className="flex flex-col">
              <div className="max-h-72 min-h-[80px] flex-1 space-y-3 overflow-y-auto p-5">
                {messages.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">No messages yet — start the conversation.</div>
                ) : (
                  messages.map((m) => {
                    const mine = (m.role ?? "seller") === "seller"
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
        <div className="space-y-5">
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

          <SectionCard title="Summary">
            <dl className="space-y-2 p-5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Items</dt>
                <dd className="tabular-nums">{usd(itemsTotal)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{usd(total)}</dd>
              </div>
            </dl>
          </SectionCard>
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
// Submit to production — the CHARGE point. Nothing in the app pushed an order to the
// factory before this, so a seller could never actually buy production; the server rule
// existed with no caller. Shows the real quote first: people should see the price before
// the button that takes the money, not after.
function SubmitOrderButton({ order, onDone }: { order: OrderRow; onDone: () => void }) {
  const router = useRouter()
  const [quote, setQuote] = useState<OrderQuote | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [short, setShort] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const fs = String(order.factory_status || "")
  const submittable = ["", "new", "draft"].includes(fs)

  useEffect(() => {
    if (!submittable) return
    let live = true
    getOrderQuote(order.id).then((q) => { if (live) setQuote(q) }).catch(() => {})
    return () => { live = false }
  }, [order.id, submittable])

  if (!submittable) return null

  const submit = async () => {
    setBusy(true); setErr(null); setShort(false)
    try {
      await updateOrder(order.id, { factoryStatus: "in_review", status: "in_review" })
      setConfirm(false)
      onDone()
    } catch (e) {
      // 402 = the server refused on money grounds (short balance, or a line it can't
      // price). Its message already names the amounts, so show it verbatim.
      if (e instanceof ApiError && e.status === 402) setShort(true)
      setErr(e instanceof Error ? e.message : "Could not submit this order")
    } finally { setBusy(false) }
  }

  const money = (n: number) => `$${n.toFixed(2)}`
  const blocked = !!quote?.unpriced.length

  return (
    <div className="flex flex-col items-end gap-1.5">
      {quote && !blocked && (
        <div className="text-right text-xs text-muted-foreground">
          <span className="tabular-nums">
            {money(quote.subtotal)} production + {money(quote.shipping)} shipping
          </span>
          <span className="mx-1.5 text-border">·</span>
          <span className="font-semibold tabular-nums text-foreground">{money(quote.total)}</span>
        </div>
      )}
      {blocked && (
        <span className="text-right text-xs text-destructive">
          Not priced yet: {quote!.unpriced.map((u) => u.sku).join(", ")} — pick a catalog product first.
        </span>
      )}
      {err && <span className="max-w-xs text-right text-xs text-destructive">{err}</span>}
      <span className="flex items-center gap-2">
        {short && (
          <Button size="sm" variant="outline" onClick={() => router.push("/wallet")}>Top up</Button>
        )}
        {confirm ? (
          <>
            <span className="text-xs text-muted-foreground">
              Charge {quote ? money(quote.total) : "your wallet"}?
            </span>
            <Button size="sm" onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Yes, submit"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Not yet</Button>
          </>
        ) : (
          <Button size="sm" onClick={() => setConfirm(true)} disabled={busy || blocked}>
            <PaperPlaneTilt size={14} weight="bold" /> Submit to production
          </Button>
        )}
      </span>
    </div>
  )
}

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
