"use client"

import { useLabelT } from "@/lib/i18n"
import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { mayEditVariants } from "@/shared/order-rules"
import { GRANT_OPERATOR_EDIT_AFTER_APPROVAL, isGrantOn, useRoleGrants } from "@/lib/role-grants"
import { designSearchTerms } from "@/lib/design-id"
import { SubmitOrderButton } from "@/components/app/submit-order-button"
import { TabBar } from "@/components/app/tab-bar"
import { SearchField } from "@/components/app/search-field"
import { ApproveOrderButton } from "@/components/app/approve-order-button"
import { orderNeedsSetup } from "@/lib/variant-resolve"
import { stockSkuOf } from "@/lib/stock-status"
import { useRouter } from "next/navigation"
import { Plus, Package, Sparkle, UploadSimple, CaretRight, Truck, MapPin, ArrowSquareOut, Storefront } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { ImportOrdersDialog } from "@/components/app/import-orders-dialog"
import { consumeImportOpen } from "@/lib/sheet-return"
import { SellerStatusBadge } from "@/components/app/seller-status-badge"
import { ColumnsMenu } from "@/components/app/columns-menu"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cachedOrders, streamOrders, getCatalogProducts, getOrderDesigns, indexDesigns, designForLine, postOrderDesign, getMyAccess, type OrderRow, type OrderItem, type CatalogProduct, type OrderDesign, getOrderQuote, type OrderQuote } from "@/lib/api"
import { ItemAvatar } from "@/components/app/item-avatar"
import { DesignCanvasDialog } from "@/components/app/design-canvas"
import { getToken, getUser } from "@/lib/auth"
import { matchesFilter, SELLER_FILTERS, type SellerFilter } from "@/lib/order-status"
import { VariantStrip } from "@/components/app/variant-field"
import { VariantPicker } from "@/components/app/variant-picker"
import { usd, numOf, revenueOf, customerOf, storeOf, itemsLabel, unitsOf, lineTotal, fmtDate, shipTo, trackUrl, sideRatesFor, methodsLabelOf } from "@/lib/order-format"
import { usePaged, Pagination } from "@/components/app/pagination"
import { ORDER_COLS, loadColOrder, saveColOrder, loadHiddenCols, saveHiddenCols, DEFAULT_ORDER_COLS, type OrderColId } from "@/lib/order-columns"
import { DesignQuoteBanner } from "@/components/app/design-quote-banner"
import { OrderedVariant } from "@/components/app/ordered-variant"
import { EmptyState } from "@/components/app/empty-state"

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
/** The breakpoint classes for a column that falls away on a narrow window. Written out in
 *  full because Tailwind scans source for literal class names — a template string would
 *  compile to nothing and the column would simply never hide. */
const DROP_CLASS: Record<string, string> = {
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
}
const cellClass = (id: OrderColId) => {
 const c = ORDER_COLS[id]
 const base = id === "items" ? "" : "truncate"
 return [base, c.align === "right" ? "text-right" : "", c.drop ? DROP_CLASS[c.drop] : ""].filter(Boolean).join(" ")
}
function renderCell(id: OrderColId, o: OrderRow): React.ReactNode {
 switch (id) {
      /* THE ROW'S IDENTITY, and it was the SMALLEST thing on the row — text-xs against
         the table's text-sm, so the number you scan for was set below the customer name,
         the store and the cost. Matches the factory board, which has always rendered it
         text-sm font-semibold; this table was the outlier. */
 case "order": return <span className="tabular-nums text-sm font-semibold">{numOf(o)}</span>
 case "store": return <span className="text-muted-foreground">{storeOf(o)}</span>
      /* NOT font-medium. The buyer's name is the one column nobody scans a queue by, and
         weighting it put it above the order number and the status — the two that are. */
 case "customer": return <span>{customerOf(o)}</span>
      /**
       * THE COUNT, AND ONLY THE COUNT (owner, 2026-09-21: "remove the item name here no
       * need — just show the item number… since the name is clipped and there's no way to
       * see / no need to see").
       *
       * The cell used to lead with the product name over a units line, and at this
       * column's 64px neither survived: a marketplace title came out as "Ga…" and even
       * "100 units" clipped to "100 u…". Two truncated strings where one number fits — and
       * an ellipsis is not a shorter name, it is no name, so the space was being spent on
       * nothing. The full list, named, is one click down in the expanded row.
       *
       * Weighted like the factory board's own units column, which asks and answers exactly
       * this question: text-sm font-medium, one step up from the muted metadata either
       * side so a quantity someone is judging capacity from is not read past — and one
       * step only, because semibold here would put it level with the order number and a
       * live status (see that column's note; it made semibold mean three things at once).
       *
       * No tabular-nums: §4 — the column is right-aligned and globals.css already gives
       * every text-right cell tabular figures, which is what makes 1 over 12 over 100 line
       * up without a second opinion per cell.
       */
 case "items": {
 const units = unitsOf(o)
 const lines = (o.items ?? []).length
 return (
        <span
 className="text-sm font-medium text-foreground"
          /* The line/unit distinction leaves the cell but not the row: two lines of one
             each and one line of two are both "2", and the tooltip is where that lives now
             — the same split the factory column already draws. */
 title={`${lines} line${lines === 1 ? "" : "s"} · ${units} unit${units === 1 ? "" : "s"}`}
        >
          {units || "—"}
        </span>
      )
    }
 case "status": return <SellerStatusBadge order={o} />
 case "tracking": return o.tracking
      ? <span className="truncate text-sm tabular-nums text-muted-foreground">{o.tracking}</span>
 : <span className="text-xs text-muted-foreground/60">—</span>
 case "cost": {
      /* WHAT IT COSTS YOU. Two different claims share this cell and they must not read the
         same: a CHARGE is money that moved, an estimate is arithmetic on today's catalogue.
         Weight says which — the charge is inked and medium, the estimate is muted — and the
         title carries the sentence, because a column is not the place for one.
         No tabular-nums: the column is right-aligned and globals.css already gives every
         right-aligned cell tabular figures (CLAUDE.md §4). */
 const c = o.cost == null ? null : Number(o.cost)
 if (c == null) {
 return (
        <span className="text-muted-foreground/60"
 title={o.cost_unpriced ? `${o.cost_unpriced} line${o.cost_unpriced === 1 ? "" : "s"} can't be priced yet — pick a blank on them` : "Not priced yet"}>
          —
        </span>
      )
    }
 return (
      <span className={o.cost_estimated ? "text-muted-foreground" : "font-medium"}
 title={o.cost_estimated ? "Estimated from today's prices — this order hasn't been charged yet" : "Charged to your wallet"}>
        {usd(c)}
      </span>
    )
  }
  /**
   * WHAT THIS ORDER COSTS YOU — not what the buyer paid.
   *
   * This read `revenueOf`, the RETAIL price, and the manual order form stopped asking for one
   * a while ago — so every manual order printed a dash in the column a seller reads to find
   * out what they are about to be billed. The number they actually want was already on the
   * row: attachCost puts it there, the LEDGER's figure once the order is charged and the live
   * ladder before that.
   *
   * The estimate says it is one. Money that moved and a price nobody has paid are different
   * claims, and a column that renders them identically is one you cannot trust either half of.
   * Retail stays as the fallback for a marketplace order, which does carry a sale price.
   */
 case "total": {
 const c = o.cost == null ? null : Number(o.cost)
 if (c == null || !isFinite(c)) {
 const r = revenueOf(o)
 return r == null
        ? <span className="text-muted-foreground/60" title="Not priced yet — pick a blank on every line">—</span>
        : <span className="font-medium">{usd(r)}</span>
    }
 return (
      /* ESTIMATED IS SAID IN WEIGHT, NOT IN A WORD — the way `cost` two cases above already
         says it, and for a measured reason.
         The word rode after the figure, so an estimated row's digits sat a marker's width to
         the left of a charged row's and the column never lined up; and inside this `truncate`
         cell the ellipsis ate the VALUE ("$44.99…"), which §4 forbids — a total is read, not
         recognised. Leading the marker fixed the alignment and moved the clipping onto the
         word itself, which then rendered as a bare "e…": a mark that is neither read nor
         recognised is just noise.
         There is no width for both. 100px holds "$1,204.50" and nothing else, and the pixels
         to hold a word as well come off `items`, which is already truncating listing titles.
         So the distinction keeps its meaning and costs nothing: muted = a price nobody has
         paid, inked = money that moved. The sentence is still on the `title`. */
      <span className={o.cost_estimated ? "text-muted-foreground" : "font-medium"}
            title={o.cost_estimated ? "Estimated from today's prices — charged when you submit" : "Charged to your wallet"}>
        {usd(c)}
      </span>
    )
  }
 case "date": return <span className="text-muted-foreground">{fmtDate(o.created_at)}</span>
  }
}

export function OrdersList() {
  const tl = useLabelT()
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
  // See orders-hub: OFF until the grants load, which is the shipped rule.
 useRoleGrants()
 const editAfterApproval = isGrantOn(GRANT_OPERATOR_EDIT_AFTER_APPROVAL)
 useEffect(() => {
 const t = setTimeout(() => setRole(getUser()?.role || ""), 0)
 return () => clearTimeout(t)
  }, [])
  // The shared predicate now, not a role list. See mayEditVariants in shared/order-rules.ts:
  // this board answered "no" for an operator that the staff hub and the SERVER both answered
  // "yes" for, on the same order.
 const [orders, setOrders] = useState<OrderRow[] | null>(null)
  /** A refused stage change says why. The board had no error surface at all, so an Approve
   *  the server declined would have looked like a button that does nothing. */
 const [actionErr, setActionErr] = useState("")
 const [isDemo, setIsDemo] = useState(false)
 const [query, setQuery] = useState("")
 const [filter, setFilter] = useState<SellerFilter>("All")
 const [importOpen, setImportOpen] = useState(false)

  /**
   * REOPEN IMPORT when a sheet sent you back here. Without this "Back to import" lands on the
   * board with the dialog shut, which is the same screen as pressing nothing — the button
   * would look like it did nothing at all.
   *
   * Deferred by a tick and read-once: consumeImportOpen clears the flag as it reads it, so
   * the dialog cannot reappear on every later visit to this board in the same tab.
   */
  useEffect(() => {
    const id = setTimeout(() => { if (consumeImportOpen()) setImportOpen(true) }, 0)
    return () => clearTimeout(id)
  }, [])
  /**
   * A SET, SO A ROW STAYS OPEN UNTIL ITS OWN ARROW CLOSES IT.
   *
   * This held ONE id, so opening a second order closed the first — an accordion, on a board
   * whose whole use is comparing rows. Nothing asked for that behaviour; it is what a single
   * id does. Every other board here already keeps a Set (orders-hub, dispatch-board,
   * purchase-view, inbound-panel, alibaba-orders); this was the last one that did not.
   */
 const [expanded, setExpanded] = useState<Set<string>>(new Set())
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
  * THE RATES FOR THE LINE BEING DESIGNED.
  *
  * The designer's face rail prices each face before anyone prints there, and it was fed
  * rates on the order page only -- so the same window quoted +$4.00 a face when opened
  * from an order and nothing at all when opened from here. One fetch, when the dialog
  * opens, rather than a quote per row: this list draws hundreds of orders and only ever
  * designs one at a time.
  *
  * The condition is a CLICK (`editing`), and the fetch writes different state, so this is
  * not the shape CLAUDE.md 2.8 warns about -- it cannot re-satisfy itself.
  */
 const [editQuote, setEditQuote] = useState<OrderQuote | null>(null)
 useEffect(() => {
   let alive = true
   /* DEFERRED, because react-hooks/set-state-in-effect forbids a synchronous setState
      here and CLAUDE.md 5 names setTimeout(fn, 0) as the pattern the app pages use. */
   const t = setTimeout(() => {
     if (!alive) return
     if (!editing) { setEditQuote(null); return }
     getOrderQuote(editing.order.id)
       .then((q) => { if (alive) setEditQuote(q) })
       /* No rates is a rail with no prices on it, which is what it did before. A quote
          that will not load must not stop somebody placing artwork. */
       .catch(() => { if (alive) setEditQuote(null) })
   }, 0)
   return () => { alive = false; clearTimeout(t) }
 }, [editing])
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
  /**
   * OPENING A ROW IS AN EVENT, so the artwork is fetched on the CLICK — CLAUDE.md §2.8.
   *
   * It was an effect keyed on `[expanded, designs]` that wrote `designs`, i.e. re-running on
   * the state its own fetch produced. It settled, because the `designs[expanded]` guard went
   * true after the write — but that is the shape §2.8 is about, and it only stayed safe
   * while exactly one id could be open. Widening it to a Set means the guard becomes "which
   * of these are missing", which is a condition the fetch's own result edits — the precise
   * thing that rule forbids relying on.
   *
   * A click cannot recur on its own, so there is nothing to bound. Fetched only when the row
   * OPENS and only when we do not already hold it: pulling designs for every row on load
   * would be a request per order for imagery most sellers never expand.
   */
 const toggleExpanded = useCallback((id: string) => {
 const opening = !expanded.has(id)
 setExpanded((prev) => {
 const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
 if (opening && !designs[id]) reloadDesigns(id)
  }, [expanded, designs, reloadDesigns])
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

  /**
   * THE FIRST SCREEN DOES NOT WAIT FOR THE LAST ORDER.
   *
   * Measured through the live route as an admin: 971 orders, 1.37MB, 267ms — and all of it
   * had to arrive before anything drew. The query was never the cost (the SQL is ~110ms of
   * that); the megabytes crossing from Jakarta were. So the first 100 orders paint at
   * 0.16MB and the rest streams in behind them — same total bytes, a screen that is usable
   * long before them.
   *
   * `complete` is not cosmetic. Until the walk finishes, "nothing matches that filter" is a
   * claim this component cannot honestly make (§4, Honesty in UI).
   */
  const [complete, setComplete] = useState(false)
  const load = useCallback(() => {
    // Signed in → show real data (empty state if none). Only fall back to samples
    // when there's no session at all (standalone/marketing preview).
    const signedIn = !!getToken()
    const settle = (rows: OrderRow[], done: boolean) => {
      if (rows.length) { setOrders(rows); setIsDemo(false) }
      else if (done) { setOrders(signedIn ? [] : DEMO); setIsDemo(!signedIn) }
      if (done) setComplete(true)
    }
    // Another board may already hold the whole list — reuse it rather than walk it again.
    const held = cachedOrders()
    if (held) { settle(held, true); return undefined }
    setComplete(false)
    const ctl = new AbortController()
    streamOrders(settle, { signal: ctl.signal })
      .catch(() => { setOrders(signedIn ? [] : DEMO); setIsDemo(!signedIn); setComplete(true) })
    return () => ctl.abort()
  }, [])
  useEffect(() => {
    let stop: (() => void) | undefined
    const id = setTimeout(() => { stop = load() }, 0)
    return () => { clearTimeout(id); stop?.() }
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
        .flatMap((it) => [it.design_name || "", designSearchTerms(it.design_no)])
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
              {tl("ordersList", "You’re working in their shop, so anything you create here belongs to them — your own orders stay separate and private.")}
            </span>
          </span>
        </div>
      )}
      <SectionCard
 title={tl("ordersList", "Orders")}
 actions={
          <div className="flex items-center gap-2">
            <ColumnsMenu
                cols={ORDER_COLS}
                order={colOrder}
                hidden={hidden}
                isLocked={(id) => !!ORDER_COLS[id].locked}
                defaults={{ order: [...DEFAULT_ORDER_COLS], hidden: [] }}
                onOrder={setOrderCols}
                onHidden={setHiddenCols}
              />
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <UploadSimple size={14} weight="bold" /> {tl("ordersList", "Import")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => router.push("/orders/new")}>
              <Plus size={14} weight="bold" /> {tl("ordersList", "New order")}
            </Button>
          </div>
        }
      >
        {/* A refusal carries its reason — the one sentence this board is allowed. */}
        {actionErr && (
          <div className="border-b border-border bg-destructive/10 px-5 py-2 text-sm text-destructive">{actionErr}</div>
        )}
        {/* toolbar */}
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          {/* THE LABEL IS TRANSLATED, THE ID IS NOT. `f` is both the filter's value and its
              English word, and passing it straight through as the label left the one row of
              controls on this page in English while everything around it turned. matchesFilter
              still compares the ID, so the vocabulary itself is untouched. */}
          <TabBar
            look="segmented"
            spacing="none"
            ariaLabel={tl("ordersList", "Filter orders")}
            items={SELLER_FILTERS.map((f) => ({ id: f, label: tl("ordersList", f) }))}
            value={filter}
            onChange={setFilter}
          />
          <SearchField
            value={query}
            onChange={setQuery}
            width="sm"
            placeholder={tl("ordersList", "Search orders…")}
          />
        </div>

        {isDemo && (
          <div className="flex items-center gap-2 border-b border-border bg-hold/10 px-5 py-2 text-xs font-medium text-hold">
            <Sparkle size={13} weight="fill" /> {tl("ordersList", "Showing sample orders — sign in to load your live queue.")}
          </div>
        )}

        {orders === null ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          /* TWO DIFFERENT EMPTIES, and they must not read alike: "you have no orders" and
             "your filter matched none of them" call for different next moves. The first
             offers the two ways to get one; the second offers nothing, because the way out
             is the filter you can already see. */
          (orders?.length ?? 0) === 0 ? (
            <EmptyState
              icon={Package}
              title={tl("ordersList", "No orders yet")}
              note={tl("ordersList", "Orders appear here once you create one, or connect a store to sync.")}
              action={
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => router.push("/orders/new")}>
                    <Plus size={14} weight="bold" /> {tl("ordersList", "New order")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => router.push("/stores")}>
                    {tl("ordersList", "Connect a store")}
                  </Button>
                </div>
              }
            />
          ) : !complete ? (
            /* Still walking the list — "nothing matches" is not yet a true statement. */
            <EmptyState icon={Package} title={tl("ordersList", "No match yet — still loading orders")} />
          ) : (
            <EmptyState icon={Package} title={tl("ordersList", "No orders here")} note={tl("ordersList", "Nothing matches that filter or search.")} />
          )
        ) : (
          <div className="overflow-x-auto">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36px]" />
                {visibleCols.map((id) => {
 const c = ORDER_COLS[id]
      /* The header takes the same drop class as its cells, or the two lists come apart at a
         breakpoint and every value lands a column left — which is exactly the shift the size
         table had this week from hiding a header without its cell. */
 return <TableHead key={id} className={[c.width, c.align === "right" ? "text-right" : "", c.drop ? DROP_CLASS[c.drop] : ""].filter(Boolean).join(" ")}>{c.label}</TableHead>
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.pageItems.map((o) => {
 const items = o.items ?? []
 const open = expanded.has(o.id)
 return (
                  <Fragment key={o.id}>
                    <TableRow
 onClick={() => toggleExpanded(o.id)}
 className={"cursor-pointer focus-visible:bg-accent focus-visible:outline-none " + (open ? "bg-accent/40" : "")}
                    >
                      <TableCell className="pr-0">
                        <button
 onClick={(e) => { e.stopPropagation(); toggleExpanded(o.id) }}
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
                                <div className="text-sm text-muted-foreground">{tl("ordersList", "No line items on this order.")}</div>
                              ) : items.map((it, i) => {
 return (
                                  <div key={it.line_id ?? it.sku ?? i} className="flex items-start gap-3 rounded-xl border border-border bg-card p-2.5">
                                    <ItemAvatar
 item={it}
 designs={designs[o.id]}
 catalog={catalog}
                                      // WIDTH, not height, now: `stretch` gives the tile the
                                      // row's own height. At 76 the picture stopped three
                                      // lines short of the text — the colour chip and part of
                                      // the quantity sat under it, so the card had two bottom
                                      // edges. Raising the number instead only re-dates it:
                                      // this strip has already been re-measured by hand every
                                      // time the meta line changed shape.
 size={76}
 stretch
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
                                          {it.name || it.sku || tl("ordersList", "Item")}
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
                                      {mayEditVariants(role, o.factory_status, { editAfterApproval }) ? (
                                        <VariantPicker orderId={o.id} item={it} catalog={catalog} onSaved={load} />
                                      ) : (
                                        <VariantStrip color={it.color} size={it.size} method={methodsLabelOf(it)} marketplace={it.variant} locked className="mt-1.5" />
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
                                <span className="inline-flex items-center gap-1"><Truck size={12} weight="fill" /> {tl("ordersList", "No tracking yet")}</span>
                              )}
                              {/* Actions live together in the expanded row. Submit was
 briefly stacked under the Status badge, which put a
 column of primary buttons down the table — status is a
                                  STATE, submit is an ACTION, and six of them read as six
 alarms rather than one thing to do. */}
                              <span className="ml-auto flex items-center gap-2">
                                <SubmitOrderButton order={o} onDone={load} label={tl("ordersList", "Submit to production")} incomplete={orderNeedsSetup(o.items, catalog)} />
                                {/* THE FACTORY'S OWN ORDERS HAD NO ACTION IN THIS LIST.
                                    Submit is the seller's paid act and returns null on a
                                    factory order — one synced from OUR marketplace
                                    connections has no seller to charge — so a draft that
                                    arrived from Etsy or TikTok on the factory's own shop
                                    sat in the list with nothing to press, and the only way
                                    to start it was to open it. Approve is that order's
                                    equivalent step: it confirms the blank on every line and
                                    moves the order (and its lines) to Approved, which is
                                    where the warehouse picks work up. Same component the
                                    order page uses, so the two cannot drift; it renders
                                    nothing when the order isn't approvable or this role
                                    can't set the stage. */}
                                {role && role !== "seller" && (
                                  <ApproveOrderButton order={o} catalog={catalog} onDone={load} onError={setActionErr} />
                                )}
                                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); router.push(`/orders/${encodeURIComponent(o.id)}`) }}>
                                  {tl("ordersList", "Open order")} <CaretRight size={12} weight="bold" />
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
 orderLabel={numOf(editing.order)}
              sideFees={sideRatesFor(editQuote, editing.item)}
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
