"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import { ordersHomeFor } from "@/lib/staff-nav"
import { numOf, platformOf } from "@/lib/order-format"
import { getUser } from "@/lib/auth"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Package, MapPin, Truck, Clock, PaperPlaneTilt, PenNib, FileArrowDown, CircleNotch } from "@phosphor-icons/react"
import { canFetchTiktokLabel, openTiktokLabelFor, tiktokShippingOf } from "@/lib/tiktok-label"
import { SectionCard } from "@/components/app/section-card"
import { getOrderDesignStatus, getOrderDesignCards, cardForLine, type OrderDesignStatus, type OrderDesignCard } from "@/lib/api"
import { OrderRefundPanel } from "@/components/app/order-refund-panel"
import { ItemDesignActions } from "@/components/app/item-design-actions"
import { SellerStatusBadge } from "@/components/app/seller-status-badge"
import { DesignCanvasDialog } from "@/components/app/design-canvas"
import { ItemAvatar } from "@/components/app/item-avatar"
import { OrderHistory } from "@/components/app/order-history"
import { SubmitOrderButton } from "@/components/app/submit-order-button"
import { ApproveOrderButton } from "@/components/app/approve-order-button"
import { orderNeedsSetup } from "@/lib/variant-resolve"
import { SellerDesignFiles } from "@/components/app/design-files-panel"
import { Markdown, hasMarkdown } from "@/components/app/markdown"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getOrders,
  getOrder,
  indexDesigns,
  designForLine,
  getOrderDesigns,
  getOrderMessages,
  getOrderQuote,
  getOrderCharges,
  getCatalogProducts,
  postOrderMessage,
  updateOrder,
  type OrderRow,
  type OrderItem,
  type OrderDesign,
  type ChatEntry,
  type OrderQuote,
  type OrderCharges,
  type CatalogProduct,
  type ShipAddress,
} from "@/lib/api"
import { VariantPicker } from "@/components/app/variant-picker"
import { VariantStrip } from "@/components/app/variant-field"
import { OrderStageMenu } from "@/components/app/order-stage-menu"
import { LabelActionButton } from "@/components/app/label-action-button"
import { NewLabelDialog } from "@/components/app/new-label-dialog"
import { designSrc } from "@/lib/order-image"
import { OrderedVariant } from "@/components/app/ordered-variant"

// Same fallbacks as the boards' toAddrOf — marketplace payloads spell the address a dozen
// ways, so the ship-to a label uses must read them all. Kept identical on purpose.
const toShipAddress = (o: OrderRow): ShipAddress => {
  const a = (o.address ?? {}) as Record<string, string>
  return {
    name: o.customer?.name || a.name || "",
    street: a.street || a.first_line || a.line1 || a.address1 || "",
    street2: a.street2 || a.second_line || a.line2 || a.address2 || "",
    city: a.city || "",
    state: a.state || a.province || "",
    zip: a.zip || a.postal_code || a.postcode || "",
  }
}

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
  // Fetching TikTok's own label for this order. Kept local to the Shipping card — it's a
  // read, not a state change on the order, so it has no business in the page-level banner.
  const [ttLabelBusy, setTtLabelBusy] = useState(false)
  const [ttLabelErr, setTtLabelErr] = useState<string | null>(null)
  const [designs, setDesigns] = useState<Record<string, OrderDesign>>({})
  // What the buyer paid, when nothing recorded it — a manual order has no marketplace to
  // ask, so it is typed here or it is never known.
  const [editRetail, setEditRetail] = useState(false)
  const [retailDraft, setRetailDraft] = useState("")
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
  const [charges, setCharges] = useState<OrderCharges | null>(null)

  // Staff processing controls (stage moves + labels). Gated exactly like the boards:
  // canFulfill = warehouse/admin; the ⋯ menu itself is per-stage/role-gated inside.
  const role = getUser()?.role || "seller"
  const isStaff = role !== "seller"
  /** Board cards for this order, one per line that has been sent to design. Staff only —
   *  the route is gated, so a seller just gets nothing rather than a factory lane name. */
  const [boardCards, setBoardCards] = useState<OrderDesignCard[]>([])
  useEffect(() => {
    if (!isStaff || !id) return
    const t = setTimeout(() => {
      getOrderDesignCards(String(id)).then((r) => setBoardCards(r ?? [])).catch(() => setBoardCards([]))
    }, 0)
    return () => clearTimeout(t)
  }, [isStaff, id])
  const canFulfill = role === "warehouse" || role === "admin"
  const [labelOpen, setLabelOpen] = useState(false)
  const [actionErr, setActionErr] = useState<string | null>(null)

  // Re-pull orders after an action that changes this one (submit, cancel) so the badge
  // and the action bar reflect the new status without a manual refresh.
  const reload = () => { getOrders().then((rows) => setOrders(rows ?? [])).catch(() => {}) }
  // `one` (the direct fetch) wins over the list, so a stage change must refresh IT too or
  // the badge and menu would show stale state after a move.
  const reloadAll = () => { getOrder(String(id)).then((o) => { if (o && !o.error) setOne(o) }).catch(() => {}); reload() }

  /**
   * Refresh THIS ORDER only — for the variant pickers, which fire on every colour/size click.
   *
   * They used to call `reload`, which re-fetches /api/orders: the WHOLE list, every order
   * with every line, measured at ~1.5MB on a real board. So one click on "Navy" cost a POST,
   * then a megabyte-and-a-half download, then a re-render of the entire page — and the
   * Summary's price could not update until all of that had landed, because the quote effect
   * keys off `order`, which only changes when the list does.
   *
   * `one` is what `order` resolves from first, so refreshing it alone moves the quote (and
   * therefore the Summary) as soon as the single-order fetch returns.
   */
  const reloadOne = useCallback(() => {
    getOrder(String(id)).then((o) => { if (o && !o.error) setOne(o) }).catch(() => {})
  }, [id])

  const reloadDesigns = () => {
    getOrderDesigns(id)
      .then((r) => {
        setDesigns(indexDesigns(Array.isArray(r) ? r : (r?.designs ?? [])))
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
          const by = indexDesigns(Array.isArray(r) ? r : (r?.designs ?? []))
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

  // What was ACTUALLY charged, from the ledger — the only complete source. The quote
  // above covers production + shipping and is the right thing to show BEFORE submit
  // (it's a forecast). After submit it is the wrong shape twice over: it can't see
  // expedited shipping, express, or design files, and the page's old fallback read
  // `order.total`, which is the BUYER's grandtotal on a marketplace order, not the
  // factory charge. Sellers were shown their own revenue labelled as costs.
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      if (!live || !order) return
      getOrderCharges(order.id).then((c) => { if (live) setCharges(c) }).catch(() => { if (live) setCharges(null) })
    }, 0)
    return () => { live = false; clearTimeout(t) }
  }, [order])

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
  // Admin can still correct a line after submit — the price is frozen either way — until
  // the blanks go to a supplier. Everyone else is locked at submit.
  const canEditVariants = preSubmit || (role === "admin" && !(order as { blanks_ordered?: boolean }).blanks_ordered)
  // Was a private copy of numOf, so the detail page still showed the raw "etsy-4120118148"
  // after the boards were stripping the source prefix. Use the shared formatter.
  const num = numOf(order)
  const store = (order.store || order.source || "manual").toString()
  const addr = (order.address ?? {}) as Addr
  const cust = order.customer ?? {}
  const timeline = (Array.isArray(order.timeline) ? order.timeline : []) as TimelineEntry[]
  // (itemsTotal / total were removed with the old Summary fallback. Both were REVENUE —
  // unit_price is the seller's listing price and orders.total the buyer's grandtotal —
  // and the card presented them as production costs. `revenue` below is the same figure,
  // now labelled as what it is.)
  // Design/check fees shown in the Summary. Complex fees under review are `amount: null`
  // ("To Be Determined") and are NOT added to the number, only listed.
  const designFees = quote?.designFees
  const dfTotal = designFees?.total ?? 0

  // ── Cost, revenue, and the gap between them ──────────────────────────────────
  // Three numbers that must never be conflated, which is exactly what the page used to
  // do. Each has a different origin, so each is derived separately here.
  //
  // REVENUE is the buyer's money and reaches us only from a marketplace: etsy.js sets
  // orders.total from the receipt grandtotal. A MANUAL order (FF-*) has no buyer of ours,
  // so `total` is 0 or whatever someone typed — hence `hasRevenue` rather than treating
  // 0 as "sold for nothing". An order with no retail price recorded and one genuinely
  // sold at $0 look identical in the column and mean opposite things.
  /**
   * ON A MANUAL ORDER, `total` IS NOT THE BUYER'S MONEY.
   *
   * The new-order form computes it as Σ(price you typed × qty) PLUS our shipping fees, so
   * an order created with the price column left at 0 still carries a total — the postage.
   * Read as revenue it says the customer paid $9.00 for two beanies that cost $44.99 to
   * make, and the card reported a $35.99 loss in red. The loss is arithmetic on a number
   * that was never a retail price.
   *
   * So a manual order's revenue comes from the LINES, which is where a seller actually
   * records what the buyer paid. Nothing there means nothing recorded — stated as such,
   * with no profit figure, which is the existing honest path for this case. A marketplace
   * order is unaffected: etsy.js sets `total` from the receipt grandtotal, and that IS the
   * buyer's money.
   */
  const lineRevenue = (order.items ?? []).reduce(
    (s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 1), 0)
  const fromMarketplace = platformOf(order) !== "Manual"
  const retailSet = !!(order.meta as { retail_set?: boolean } | undefined)?.retail_set
  const saveRetail = async () => {
    const v = Number(retailDraft)
    if (!isFinite(v) || v < 0) { setEditRetail(false); return }
    setEditRetail(false)
    // `retail_set` is what makes `total` authoritative: without it a manual order's total
    // is the create form's subtotal + shipping, which is not the buyer's money.
    await updateOrder(String(id), { total: v, meta: { ...(order.meta ?? {}), retail_set: true } })
      .catch(() => {})
    reloadOne()
  }
  const revenue = fromMarketplace || retailSet ? (Number(order.total ?? 0) || 0) || lineRevenue : lineRevenue
  const hasRevenue = revenue > 0
  // COST is what the seller paid US, read off the ledger — every part, including the ones
  // the quote can't see. Falls back to the quote before submit, when nothing is charged yet.
  const feesGated = !!charges?.gated
  const chargedParts = charges?.parts ?? []
  const cost = charges && charges.charged > 0 ? charges.charged : null
  const refundedTotal = charges?.refunded ?? 0
  // What they actually bear once refunds are returned — refunding $9 of shipping makes the
  // order cost $9 less, and a margin computed off the gross charge would understate it.
  const netCost = cost != null ? Math.max(0, cost - refundedTotal) : null
  // ESTIMATED PROFIT, and estimated is the operative word: marketplace fees (Etsy's
  // transaction + listing + payment processing, ~10% all in) are taken before the money
  // ever reaches us, so they cannot appear here. Named and hinted accordingly rather than
  // presented as take-home.
  const estProfit = hasRevenue && netCost != null ? revenue - netCost : null
  // OUR margin, not the seller's: what they paid us, less what the goods and the parcel
  // cost us. Null until they have actually been charged — subtracting real costs from a
  // quote nobody has paid reports a loss that hasn't happened.
  const labelCost = Number(order.label_cost ?? 0) || 0
  const factoryMargin = netCost != null && quote?.supplierTotal != null
    ? netCost - quote.supplierTotal - labelCost
    : null

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
              <h1 className="font-title text-2xl font-semibold tracking-tight">{num}</h1>
              <SellerStatusBadge order={order} />
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {store.charAt(0).toUpperCase() + store.slice(1)} · {fmtDateTime(order.created_at)}
            </div>
          </div>
          {/* Secondary first, primary last — the destructive action shouldn't lead.
              Staff also get the factory move set here: the board row is the quick option,
              but the detail page is where an order is actually worked. */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/* Label control sits next to Cancel; it shows "Create label" until one is bought,
                then a "Download label" split (download / create another / refund). The ⋯ stage
                menu moves to the END of the row. */}
            {isStaff && canFulfill && (
              <LabelActionButton
                order={order}
                onOpenLabel={() => setLabelOpen(true)}
                onChanged={reloadAll}
                onError={setActionErr}
              />
            )}
            <CancelOrderButton order={order} onDone={reload} />
            <SubmitOrderButton order={order} quote={quote} onDone={reload} incomplete={orderNeedsSetup(order.items, catalog)} />
            {isStaff && <ApproveOrderButton order={order} catalog={catalog} onDone={reloadAll} onError={setActionErr} />}
            {isStaff && (
              <OrderStageMenu
                order={order}
                role={role}
                canFulfill={canFulfill}
                onNewLabel={() => setLabelOpen(true)}
                onChanged={reloadAll}
                onError={setActionErr}
              />
            )}
          </div>
        </div>
        {isStaff && actionErr && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{actionErr}</div>
        )}
      </div>

      {isStaff && (
        <NewLabelDialog
          open={labelOpen}
          onOpenChange={setLabelOpen}
          // items ride along so the parcel is worked out from the blanks being shipped
          // rather than guessed — over-declaring is billed on every label.
          order={{ id: order.id, num, to: toShipAddress(order), items: order.items }}
          onCreated={reloadAll}
        />
      )}

      {/* min-w-0 on both tracks: a grid item's automatic minimum size is its MIN-CONTENT
          width, so a long unbroken order/SKU string holds the 1.6fr track open and pushes
          the whole grid past its container — the page then scrolls sideways. There was
          slack to absorb it at 1600px; at the reading width there isn't. */}
      <div className="grid gap-5 lg:grid-cols-[2.1fr_1fr]">
        {/* items + timeline */}
        <div className="min-w-0 space-y-5">
          <SectionCard title={`Items (${items.length})`}>
            {items.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No line items on this order.</div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((it, i) => {
                  // Per LINE, not per order: the order-level readiness chip said "on the
                  // board" for every item the moment one of them was sent.
                  const card = isStaff ? cardForLine(boardCards, { line_id: it.line_id, sku: it.sku }) : undefined
                  const design = designForLine(designs, it)
                  const artwork = designSrc(design?.data)
                  const qty = Number(it.qty) || 1
                  /**
                   * WHAT THIS LINE COSTS, from the quote — not unit_price.
                   *
                   * unit_price is the SELLER'S LISTING PRICE, what their buyer paid on a
                   * marketplace. A factory order has no listing, so it is 0 and always will
                   * be — which is why every line on a submitted manual order read $0.00
                   * while the seller had actually been charged $18.50 each.
                   *
                   * The quote is the same computation the CHARGE uses (pricing.js), so the
                   * number on the row is the number taken from the wallet. Matched on the
                   * line's own id rather than position: an unpriced line is absent from
                   * quote.lines, so index alignment silently shifts every row after it onto
                   * the wrong price.
                   */
                  const qLine = quote?.lines?.find(
                    (l) => String(l.id) === String((it as { id?: string | number }).id ?? ""))
                  // THREE SOURCES, most authoritative first: the live quote while the order
                  // can still change, the cost FROZEN on the line once it is charged, and
                  // the buyer's retail price as a last resort. A submitted order stops
                  // quoting, which is why these rows read "—" beside a Summary that had the
                  // total all along — the frozen number was on the line, unread.
                  const unit = qLine ? Number(qLine.unitCost) || 0
                    : Number(it.unit_cost ?? 0) || Number(it.unit_price) || 0
                  return (
                    <div key={i} className="relative flex items-start gap-4 px-5 py-4">
                      {/* The line's number, where the eye lands last — same number the drop
                          zone's targets carry. */}
                      <span className="absolute bottom-3 right-4 flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold tabular-nums text-primary-foreground" title={`Item ${i + 1}`}>
                        {i + 1}
                      </span>
                      {/* The blank with its artwork placed — the seller sees the same
                          composite the floor will produce from. */}
                      <div className="relative shrink-0">
                        <ItemAvatar
                          item={it}
                          designs={designs}
                          catalog={catalog}
                          // Tall enough to run from the item name down through the variant
                          // strip. At 56 it read as a bullet beside the text rather than as
                          // the thing being ordered — the smallest element in its own row,
                          // next to a two-line title, a SKU and a set of variant fields,
                          // when it is the one thing you actually check the order against.
                          // At 144 the composite (blank + placed artwork) is legible without
                          // opening the preview.
                          size={144}
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
                            <div className="flex items-center gap-2">
                              <div className="truncate font-medium">{it.name || it.sku || "Item"}</div>
                            </div>
                            {/* Same line as the production queue: what the buyer chose, next
                                to what we are choosing. */}
                            <OrderedVariant item={it} />
                            {/* THIS LINE's board state, with the lane named. "Sent to design"
                                and "Approved" are different answers, and until now the only
                                signal was an order-wide chip that lit for every item the
                                moment one of them was sent. */}
                            {/* THE LANE IS THE NEWS, "on design board" is the preamble.
                                A filled violet chip carrying both, at the same weight, sat
                                louder than the item's own name and said the obvious part
                                first. Now: a dot for the state, one quiet word for where it
                                is, and the lane in ink — the only part that changes as the
                                job moves. */}
                            {card && (
                              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-2xs text-muted-foreground">
                                <span className="size-1.5 rounded-full bg-violet-500" />
                                Design
                                <span className="font-medium text-foreground">{card.lane_label || card.col || "Incoming"}</span>
                              </span>
                            )}
                            {it.sku && <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{it.sku}</div>}
                          </div>
                          {/* "$0.00 · 1 × $0.00" IS NOT A PRICE, it is the absence of one.
                              A line whose blank doesn't resolve is missing from the quote
                              entirely — no product, no cost — and the buyer's retail price
                              is 0 on anything imported without an Item Price column. Both
                              printed as free goods on a row about to be produced, which is
                              the empty-state-that-looks-like-a-feature this house rule
                              exists to stop. Say which is missing, and where to fix it. */}
                          <div className="shrink-0 text-right text-sm">
                            {unit > 0 ? (
                              <>
                                {/* ONE LINE: the unit price and how many of it. It was two —
                                    the extended total above, "1 × $18.50" beneath — which on
                                    a quantity of one printed the same figure twice, and even
                                    at four is one multiplication shown as two rows. The
                                    total is the sum at the foot of the order; what a row has
                                    to say is what this item costs and how many there are. */}
                                <div className="font-medium tabular-nums">
                                  {usd(unit)} <span className="text-muted-foreground">× {qty}</span>
                                </div>
                                {/* WHERE THE NUMBER COMES FROM. The catalogue says $13.50
                                    and the order says $18.50, and until this line existed
                                    those looked like two prices for one product. They are
                                    the blank and the technique. Shown only when the
                                    technique actually adds something. */}
                                {qLine?.baseCost != null && (qLine.methodFee ?? 0) > 0 && (
                                  <div className="text-2xs tabular-nums text-muted-foreground/80">
                                    {usd(qLine.baseCost)} blank + {usd(qLine.methodFee ?? 0)} {it.print_type || "print"}
                                  </div>
                                )}
                              </>
                            ) : quote === null ? (
                              // STILL LOADING. The quote arrives a moment after the rows, and
                              // asserting "Not priced · pick a blank first" in that gap is a
                              // confident answer to a question nobody has finished asking —
                              // it appeared on lines that were correctly priced all along.
                              <div className="text-muted-foreground">—</div>
                            ) : (
                              <>
                                <div className="font-medium text-muted-foreground">Not priced</div>
                                <div className="text-xs text-muted-foreground">
                                  {qLine ? "no cost on this blank" : "pick a blank first"}
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {canEditVariants ? (
                          <VariantPicker orderId={String(id)} item={it} catalog={catalog} onSaved={reloadOne} />
                        ) : (
                          <VariantStrip blank={it.blank} color={it.color} size={it.size} method={it.print_type} marketplace={it.variant} locked className="mt-2" />
                        )}

                        {(it.sku || it.line_id) && (
                          <>
                            <div className="mt-3 flex items-center justify-end gap-2">
                              {/* Partner chip + the tucked-away send action. Staff only —
                                  it renders nothing when design-status can't be read, which
                                  is what a seller gets. */}
                              {designStatus && it.sku && (
                                <ItemDesignActions
                                  orderId={id}
                                  sku={String(it.sku)}
                                  itemName={it.name}
                                  qty={qty}
                                  printType={it.print_type}
                                  artworkUrl={artwork}
                                  lineImage={it.img ?? undefined}
                                  state={designStatus.bySku[String(it.sku)]}
                                  onChanged={loadDesignStatus}
                                />
                              )}
                            </div>
                          </>
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
          <SectionCard title="Design files">
            <div className="p-5"><SellerDesignFiles orderId={String(id)} items={items} onAttached={reloadDesigns} /></div>
          </SectionCard>

          {/* FACTORY ONLY. A seller's order page shows them what they need to act on; the
              blow-by-blow of who moved it where is internal, and the chat is where anything
              they should know gets said. */}
          {isStaff && timeline.length > 0 && (
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
          <OrderHistory orderId={String(id)} items={items} />

          <SectionCard title="Order activity">
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
                          {/* AI briefs/replies arrive as markdown (**bold**, lists). Render it —
                              keyed off content — so a brief bolds instead of showing literal **;
                              a plain human message stays verbatim with its line breaks. */}
                          {m.text ? (hasMarkdown(m.text) ? <Markdown>{m.text}</Markdown> : <span className="whitespace-pre-wrap">{m.text}</span>) : null}
                        </div>
                        <span className="mt-0.5 text-3xs text-muted-foreground">
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

          {/* Also shown for a TikTok platform-shipped order that has no tracking yet — the
              label exists on TikTok's side before the number reaches us, and a Shipping card
              that isn't there reads as "nothing has shipped". */}
          {(order.tracking || order.carrier || canFetchTiktokLabel(order)) && (
            <SectionCard title="Shipping">
              <div className="flex items-start gap-2 p-5 text-sm">
                <Truck size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  {/* WHO owes the label. On TikTok shipping it already exists and is fetched;
                      on seller shipping nothing exists until we buy one — and a floor that
                      confuses the two either waits forever or buys a second label. Stated
                      before the carrier and tracking because it decides what those mean. */}
                  {(() => {
                    const ship = tiktokShippingOf(order)
                    if (!ship) return null
                    const tone =
                      ship.key === "tiktok" ? "bg-primary/10 text-primary"
                      : ship.key === "seller" ? "bg-muted text-foreground"
                      : "bg-amber-100 text-amber-800"
                    return (
                      <div className="mb-1.5">
                        <span className={"inline-flex items-center rounded-md px-1.5 py-0.5 text-2xs font-semibold " + tone}>
                          {ship.label}
                        </span>
                        <div className="mt-1 text-xs text-muted-foreground">{ship.hint}</div>
                      </div>
                    )
                  })()}
                  {order.carrier && <div className="font-medium">{order.carrier}</div>}
                  {order.tracking && <div className="text-xs tabular-nums text-muted-foreground">{order.tracking}</div>}
                  {canFetchTiktokLabel(order) && (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          setTtLabelBusy(true); setTtLabelErr(null)
                          const err = await openTiktokLabelFor(order)
                          setTtLabelErr(err); setTtLabelBusy(false)
                        }}
                        disabled={ttLabelBusy}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
                      >
                        {ttLabelBusy
                          ? <CircleNotch size={12} className="animate-spin" />
                          : <FileArrowDown size={12} weight="bold" />}
                        {ttLabelBusy ? "Fetching…" : "TikTok label"}
                      </button>
                      {/* TikTok's own wording, not a generic failure — the reason is usually
                          actionable ("no package on TikTok yet"). */}
                      {ttLabelErr && <div className="mt-1.5 text-xs text-amber-700">{ttLabelErr}</div>}
                    </>
                  )}
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
                  {/* BASE COST, the same word the product editor uses for this number —
                      what the seller is charged for the blank, as against "product cost",
                      which is what the blank costs US. Two names for two numbers, and this
                      screen had been using the supplier's one for the seller's money. */}
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Base cost</dt>
                    <dd className="tabular-nums">{usd(quote.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      Shipping
                      {quote.units > 1 && <span className="opacity-70"> · {quote.units} items</span>}
                    </dt>
                    <dd className="tabular-nums">{usd(quote.shipping)}</dd>
                  </div>
                  {designFees?.items?.map((f, i) => (
                    <div key={i} className="flex justify-between">
                      <dt className="text-muted-foreground">{f.label}{f.name ? <span className="opacity-70"> · {f.name}</span> : null}</dt>
                      <dd className="tabular-nums">{f.amount == null ? <span className="italic text-muted-foreground">To Be Determined</span> : usd(f.amount)}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-border pt-2 font-semibold">
                    <dt>Total</dt>
                    <dd className="tabular-nums">{usd(quote.total + dfTotal)}</dd>
                  </div>
                  <p className="pt-1 text-xs text-muted-foreground">Charged when you submit to production. Design &amp; check fees are listed above; a design still under review shows “To Be Determined” until we confirm it.</p>
                </>
              ) : feesGated ? (
                /* A team member whose leader hasn't shared order fees. The server sent no
                   amounts at all, so there is nothing here to hide — and this says which,
                   rather than rendering an empty card that reads as a broken page. */
                <p className="text-xs text-muted-foreground">
                  Order costs aren&apos;t shared with you. Your team leader can turn this on
                  under Settings › Team.
                </p>
              ) : (
                <>
                  {/* Submitted → the price is frozen and the LEDGER is the record of it.
                      Every part it charged, itemised: production, shipping, and the fees
                      the quote can't see (expedited shipping, express, design, files). */}
                  {chargedParts.map((p) => (
                    <div key={p.key} className="flex justify-between">
                      <dt className="text-muted-foreground">{p.label}</dt>
                      <dd className="tabular-nums">{usd(p.charged)}</dd>
                    </div>
                  ))}
                  {refundedTotal > 0.005 && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Refunded</dt>
                      <dd className="tabular-nums text-success">−{usd(refundedTotal)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-border pt-2 font-semibold">
                    <dt>You paid</dt>
                    {/* "$0.00" would claim this order was produced free. Nothing has been
                        charged because it hasn't been submitted — a different fact, and the
                        one the seller needs before they read a profit figure below. */}
                    <dd className="tabular-nums">
                      {netCost != null ? usd(netCost)
                        : <span className="font-normal italic text-muted-foreground">not charged yet</span>}
                    </dd>
                  </div>

                  {/* The buyer's side, kept visually apart from ours. Two different pots of
                      money on one card is only safe if the reader can never mistake one
                      for the other — which is the bug this replaced. */}
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-muted-foreground">Customer paid</dt>
                      <dd className="tabular-nums">
                        {editRetail ? (
                          <span className="flex items-center gap-1">
                            <Input
                              autoFocus value={retailDraft} inputMode="decimal"
                              onChange={(e) => setRetailDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") void saveRetail(); if (e.key === "Escape") setEditRetail(false) }}
                              className="h-7 w-24 text-right text-sm"
                            />
                            <Button size="sm" variant="ghost" onClick={() => void saveRetail()}>Save</Button>
                          </span>
                        ) : (
                          <button
                            onClick={() => { setRetailDraft(revenue ? String(revenue) : ""); setEditRetail(true) }}
                            className="underline-offset-2 hover:underline"
                          >
                            {hasRevenue ? usd(revenue) : <span className="italic text-muted-foreground">not recorded</span>}
                          </button>
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <dt>Estimated profit</dt>
                      <dd className={"tabular-nums " + (estProfit != null && estProfit < 0 ? "text-destructive" : "")}>
                        {estProfit != null ? usd(estProfit) : <span className="font-normal italic text-muted-foreground">—</span>}
                      </dd>
                    </div>
                  </div>

                  {/* OUR SIDE OF THE SAME ORDER — staff only, and physically separated
                      from the seller's block above because the two are different pots of
                      money. What the blanks cost us is the number a margin is measured
                      against; the server strips it from a seller's quote entirely, so this
                      renders nothing for them even if the markup were wrong. */}
                  {isStaff && quote?.supplierTotal != null && (
                    <div className="mt-3 space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                      <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Factory · not shown to the seller</div>
                      <div className="flex justify-between text-sm">
                        <dt className="text-muted-foreground">
                          Product cost
                          {/* A partial figure says so rather than reading as the total. */}
                          {quote.supplierKnown != null && quote.lines && quote.supplierKnown < quote.lines.length && (
                            <span className="text-muted-foreground/70"> · {quote.supplierKnown} of {quote.lines.length} lines</span>
                          )}
                        </dt>
                        <dd className="tabular-nums">{usd(quote.supplierTotal)}</dd>
                      </div>
                      {labelCost > 0 && (
                        <div className="flex justify-between text-sm">
                          <dt className="text-muted-foreground">Postage we bought</dt>
                          <dd className="tabular-nums">{usd(labelCost)}</dd>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-border pt-2 text-sm font-semibold">
                        <dt>Factory margin</dt>
                        <dd className={"tabular-nums " + (factoryMargin != null && factoryMargin < 0 ? "text-destructive" : "")}>
                          {factoryMargin != null ? usd(factoryMargin)
                            : <span className="font-normal italic text-muted-foreground">not charged yet</span>}
                        </dd>
                      </div>
                    </div>
                  )}

                  {/* Only when there is nothing to work out. A profit figure needs no essay
                      beside it; a missing one needs a reason. */}
                  {!hasRevenue && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      No retail price recorded, so profit can&apos;t be worked out.
                    </p>
                  )}
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
          initialDesign={designSrc(designForLine(designs, customize)?.data)}
          initialPos={designForLine(designs, customize)?.pos}
          // OPPOSITE SIDES OF THE SAME MOMENT. Before submit the order is the seller's
          // draft and the factory has no business swapping their file; after it, the job is
          // ours and the seller asks in chat instead. Whoever is locked sees the buttons
          // disabled with the reason, not a "forbidden" after the click.
          filesLocked={isStaff ? preSubmit : !preSubmit}
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

  // Once the factory has started there's no cancel to offer, and the order's own status
  // already says it's in production — so this control simply steps aside rather than
  // repeating that in words.
  if (started) return null
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
