"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { onLive } from "@/lib/live"
import { useRouter } from "next/navigation"
import { Package, Plus, UploadSimple, CircleNotch, CheckCircle, Truck, Printer, Warning, Flag, MapPin, ArrowSquareOut, SkipForward, PaperPlaneTilt, FileArrowDown, Barcode, DotsThree, CaretRight, TrayArrowDown, X } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { SectionCard } from "@/components/app/section-card"
import { parseBlock } from "@/lib/address-paste"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { StageBadge } from "@/components/app/stage-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getDispatchStatus, getOrders, postItemStatus, updateOrder, getDesignCards, saveDesignCards, buyUspsLabel, getDesignReuse, reuseDesignFile, getFactorySettings, setFactorySettings, getCatalogProducts, getOrderThreads, getOrderDesigns, indexDesigns, designForLine, postOrderDesign, getDesignFiles, getInventory, type OrderRow, type OrderItem, type DesignCard, type ShipAddress, type UspsLabelResult, type CatalogProduct, type OrderThreadRow, type DesignFileRow, type OrderDesign, type ReuseMatch } from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"
import { VariantPicker } from "@/components/app/variant-picker"
import { resolveProduct } from "@/lib/variant-resolve"
import { VariantStrip } from "@/components/app/variant-field"
import { FACTORY_STAGES, EXCEPTION_STAGES, normalizeStage, nextStage, orderStage, isException, stageOptionsFor, canSetStage } from "@/lib/factory-status"
import { numOf, platformOf, variantOf, addrLine, fmtDate, trackUrl, addressSource, ADDRESS_SOURCE_LABEL, decodeEntities } from "@/lib/order-format"
import { usePaged, Pagination } from "@/components/app/pagination"
import { LabelSheet } from "@/components/app/label-sheet"
import { ThreadBreakdown } from "@/components/app/thread-breakdown"
import { ReadinessStrip } from "@/components/app/readiness-dots"
import { DeliveryBadge } from "@/components/app/delivery-badge"
import { ImportOrdersDialog } from "@/components/app/import-orders-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { ItemAvatar } from "@/components/app/item-avatar"
import { PhotoStack } from "@/components/app/photo-stack"
import { DesignCanvasDialog } from "@/components/app/design-canvas"

const nowId = () => Date.now()
const CARRIERS = ["USPS", "UPS", "FedEx", "DHL", "Other"]

// USPS mail classes offered for a direct label buy (Labels 3.0 values).
const MAIL_CLASSES: { id: string; label: string }[] = [
  { id: "USPS_GROUND_ADVANTAGE", label: "Ground Advantage" },
  { id: "PRIORITY_MAIL", label: "Priority Mail" },
  { id: "PRIORITY_MAIL_EXPRESS", label: "Priority Express" },
]

// Warehouse return address — set once for the whole team and stored on the server
// (settings.ship_from). It used to be localStorage-only, so it silently didn't exist for
// anyone else and vanished on a different machine. localStorage is now just a warm cache
// so the field isn't empty on first paint.
const FROM_STORE = "eg_ship_from"
const BLANK_ADDR: ShipAddress = { name: "", street: "", street2: "", city: "", state: "", zip: "" }

// Pull a shippable recipient out of an order's stored address (handles Etsy + manual key shapes).
const toAddrOf = (o: OrderRow): ShipAddress => {
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
const addrComplete = (a: ShipAddress) => !!(a.street && a.city && a.state && a.zip)

/** Identity of ONE line. Two lines of the same SKU on an order (same product, different
 *  personalisation) are different jobs, so the sku alone is not an identity — keying on it
 *  made "send to board" flip every sibling line to Sent at once. */
/** One prior deliverable. Fuzzy hits carry how far off they are, so "similar" is never
 *  presented with the same confidence as "identical". */
function MatchRow({ m, similar, onUse }: { m: ReuseMatch; similar?: boolean; onUse?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <div className="min-w-0">
        <div className="truncate font-mono text-xs font-medium">{m.design_id}</div>
        <div className="truncate text-xs text-muted-foreground">
          {m.file_name || m.kind} · order {m.order_id} · {m.seller}
        </div>
      </div>
      {similar && m.distance != null && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {m.distance === 0 ? "near-identical" : `${m.distance}/64 different`}
        </span>
      )}
      {onUse && (
        <Button size="sm" variant="outline" className="shrink-0" onClick={onUse} title="Copy this file onto this order">
          Use this file
        </Button>
      )}
    </div>
  )
}

const lineKey = (o: { id: string }, it: OrderItem) => `${o.id}:${it.line_id ?? it.sku ?? ""}`

// Open a bought label in a new tab, whatever shape it came back as (URL / base64 / mock HTML).
const openLabel = (r: UspsLabelResult) => {
  if (r.labelUrl) { window.open(r.labelUrl, "_blank"); return }
  const w = window.open("", "_blank")
  if (!w) return
  if (r.labelHtml) { w.document.write(r.labelHtml); w.document.close(); return }
  if (r.labelImage) {
    const mime = (r.imageType || "").toUpperCase() === "PDF" ? "application/pdf" : "image/png"
    const src = r.labelImage.startsWith("data:") ? r.labelImage : `data:${mime};base64,${r.labelImage}`
    if (mime === "application/pdf") w.location.href = src
    else { w.document.write(`<img src="${src}" style="max-width:100%"/>`); w.document.close() }
  }
}

// Filters derive from the canonical pipeline so they always match the status model.
// NB: id "" and the first pipeline stage (in_review) are DIFFERENT states that both used
// to read "New" — a duplicate tab. "" = arrived but nobody has started it (where
// factory-synced orders land); in_review = submitted into the queue, the first
// production step. Labelled "Received" vs "New" so they're distinguishable. "Received"
// matches ALL_STATUSES's own label for "" ("New (received)").
const FILTERS: { label: string; id: string }[] = [
  { label: "All", id: "all" },
  { label: "Received", id: "" },
  ...FACTORY_STAGES.map((s) => ({ label: s.label, id: s.id })),
  { label: "Issues", id: "issues" },
]

// ONE order page for the whole factory team. The queue + item controls are shared; the
// action set adapts to the role: operators review artwork + drive production, warehouse
// receives + ships, admin does everything.
export function OrdersHub() {
  const router = useRouter()
  const role = getUser()?.role || ""
  const isAdmin = role === "admin"
  const canFulfill = role === "warehouse" || isAdmin // receive (intake) + ship
  // Artwork review. NB: this no longer implies "set any status" — stage changes are
  // gated per-role by stageOptionsFor/canSetStage, and the server enforces it.
  const canDesign = role === "operator" || isAdmin // send to designer

  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [filter, setFilter] = useState("all")
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState<Set<string>>(new Set())
  const [shipOpen, setShipOpen] = useState<string | null>(null)
  // EXPANDED order ids — the inverse of what this used to track. Rows now start closed:
  // an Etsy order with five lines of personalisation is a screenful on its own, so a board
  // that opens everything is unreadable and reads as "all my orders are open". Nothing is
  // persisted across navigation, so coming back gives a clean, closed board.
  const [actionErr, setActionErr] = useState<string | null>(null)
  // Non-error feedback from an action (what the auto-push did), cleared on the next one.
  const [note, setNote] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState("")
  // Per-order production detail the floor needs but the board never showed: matched
  // thread cones, machine files, and how much of the blank we actually have. Fetched
  // lazily per order (on expand) so a 50-order page doesn't make 150 requests.
  const [threads, setThreads] = useState<Record<string, OrderThreadRow[]>>({})
  const [dfiles, setDfiles] = useState<Record<string, DesignFileRow[]>>({})
  const [stock, setStock] = useState<Record<string, number>>({})
  // Placed artwork per order, keyed by sku — what the row avatars composite onto the blank.
  const [designs, setDesigns] = useState<Record<string, Record<string, OrderDesign>>>({})
  /**
   * The artwork on a line, from either legitimate source: placed/uploaded on our side
   * (order_designs), or synced in with a marketplace order (the buyer's own upload).
   * Anything without one of these has nothing to print and nothing to digitise.
   */
  const artworkFor = useCallback((o: OrderRow, it: OrderItem): string => {
    // Line first, sku as fallback — two lines of the same sku are different jobs.
    const placed = designForLine(designs[o.id], it)?.data
    if (placed) return placed
    // design_src is whatever the marketplace put in an upload-looking variation, and
    // Etsy's match is loose enough to catch the LISTING photo (see etsy.js — any http
    // URL under a variation named /upload|logo|file|image|photo|art|design/). A product
    // shot is not artwork: there is nothing in it to digitise, and pushing one creates a
    // designer card that looks ready but has no file behind it.
    const src = it.design_src || ""
    return src && src !== (it.img || "") ? src : ""
  }, [designs])

  // The line whose artwork is open in the editor. Operator/admin only — warehouse verifies.
  const [editing, setEditing] = useState<{ order: OrderRow; item: OrderItem } | null>(null)
  // A push that would duplicate work already done. Held until a human decides, because
  // the alternative — silently reusing, or silently re-digitising — is wrong either way.
  const [reuse, setReuse] = useState<{ order: OrderRow; item: OrderItem; exact: ReuseMatch[]; similar: ReuseMatch[] } | null>(null)
  const threadsRef = useRef<Record<string, boolean>>({})
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const toggleCollapse = (id: string) =>
    setExpandedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })


  const [carrier, setCarrier] = useState("USPS")
  const [tracking, setTracking] = useState("")

  // ── Label buy (USPS-direct) ──
  const [from, setFrom] = useState<ShipAddress>(BLANK_ADDR)
  const [to, setTo] = useState<ShipAddress>(BLANK_ADDR)
  const [pkg, setPkg] = useState({ weightOz: 6, length: 10, width: 8, height: 1, mailClass: "USPS_GROUND_ADVANTAGE" })
  const [labelErr, setLabelErr] = useState<string | null>(null)
  const [labels, setLabels] = useState<Record<string, UspsLabelResult>>({})
  // Barcode labels for an order's blanks — only lines whose variant is actually
  // defined, since a label for an unchosen blank is a mislabelled box.
  const [barcodeOrder, setBarcodeOrder] = useState<OrderRow | null>(null)

  const load = useCallback(() => {
    if (!getToken()) { setOrders([]); return }
    getOrders().then((rows) => setOrders(rows ?? [])).catch(() => setOrders([]))
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])
  // Live refresh. Without this the readiness tags read whatever the page loaded with, so
  // an order scanned on the floor kept an amber "not scanned yet" tag next to a history
  // panel — fetched fresh on open — that already said "Scanned here". Two answers to the
  // same question, in the same popover.
  //
  // Every one of these is a cache-invalidation ping carrying no data; the refetch goes
  // through getOrders() as usual, so nothing here widens what this page can see.
  useEffect(() => {
    const off = ["orders", "order-scanned", "item-status"].map((t) => onLive(t, load))
    return () => { for (const f of off) f() }
  }, [load])
  // Catalog powers the variant picker on factory-owned marketplace orders (which arrive
  // with no blank chosen). Loaded once.
  // The line whose artwork is open at full size. Null = shut.
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  useEffect(() => { getCatalogProducts().then((c) => setCatalog(c ?? [])).catch(() => {}) }, [])
  // Blank stock, once for the board — so each line can say whether we can actually make it.
  useEffect(() => {
    getInventory().then((rows) => {
      const m: Record<string, number> = {}
      for (const r of rows ?? []) if (r.sku) m[String(r.sku).toUpperCase()] = Number(r.in_stock) || 0
      setStock(m)
    }).catch(() => {})
  }, [])
  // Restore the saved warehouse "from" address.
  useEffect(() => {
    const id = setTimeout(() => {
      try { const raw = localStorage.getItem(FROM_STORE); if (raw) setFrom({ ...BLANK_ADDR, ...JSON.parse(raw) }) } catch {}
      // Server wins over the local cache — it's what the label routes will actually use.
      getFactorySettings().then((s) => {
        if (s?.ship_from && s.ship_from.street) {
          const a = { ...BLANK_ADDR, ...s.ship_from } as ShipAddress
          setFrom(a)
          try { localStorage.setItem(FROM_STORE, JSON.stringify(a)) } catch {}
        }
      }).catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [])

  /** Optimistically move ONE line. Matches on line_id when the line has one — matching on
   *  sku alone moved every same-SKU sibling, so advancing one of three identical shirts
   *  appeared to advance all three. */
  const patchItem = (orderId: string, sku: string, to: string, lineId?: string) =>
    setOrders((prev) => (prev ?? []).map((o) => (o.id !== orderId ? o : {
      ...o,
      items: (o.items ?? []).map((it) => {
        const hit = lineId ? it.line_id === lineId : (!it.line_id && it.sku === sku)
        return hit ? { ...it, factory_status: to } : it
      }),
    })))

  const advanceItem = async (order: OrderRow, item: OrderItem, to: string) => {
    if (!item.sku) return
    const key = lineKey(order, item)
    setBusy(key)
    patchItem(order.id, item.sku, to, item.line_id)
    try {
      const r = await postItemStatus(order.id, item.sku, to, item.line_id)
      // Say what the auto-push did. Held-back is the interesting case: without a word,
      // "we already have that file" is indistinguishable from "nothing happened".
      const d = r?.design
      if (d?.pushed) setNote(`Sent ${item.name || item.sku || "the item"} to the Designer board.`)
      else if (d?.reason === "file-exists") setNote(`Not sent — we already have a file for this artwork (${d.designId}). Reuse it instead of re-cutting.`)
      else if (d?.reason === "no-artwork") setNote(`Not sent — no artwork on this line yet.`)
      else if (d?.reason === "already-on-board") setNote(`Already on the Designer board.`)
      setActionErr(null)
    } catch (e) {
      // A 409 here is the ship gate explaining itself (missing artwork / no label).
      // Swallowing it made the status silently snap back with no reason shown.
      setActionErr(e instanceof Error ? e.message : "Couldn't change that item's status.")
      load()
    } finally { setBusy(null) }
  }
  const advanceOrder = async (order: OrderRow) => {
    for (const it of order.items ?? []) {
      const to = nextStage(it.factory_status)
      if (to && to !== "shipped") await advanceItem(order, it, to)
    }
  }
  // Warehouse intake: move every unstarted item into the scan flow.
  const receiveOrder = async (order: OrderRow) => {
    for (const it of order.items ?? []) if (it.sku && !normalizeStage(it.factory_status)) await advanceItem(order, it, "awaiting_scan")
  }
  // Ship: mark every line shipped + record tracking/carrier on the order.
  const shipOrder = async (order: OrderRow) => {
    setBusy(`ship:${order.id}`)
    try {
      for (const it of order.items ?? []) if (it.sku || it.line_id) { patchItem(order.id, it.sku ?? "", "shipped"); await postItemStatus(order.id, it.sku ?? "", "shipped", it.line_id) }
      await updateOrder(order.id, { tracking: tracking.trim() || undefined, carrier, factoryStatus: "shipped", status: "shipped" })
      setShipOpen(null); setTracking(""); load()
    } catch { load() } finally { setBusy(null) }
  }
  // Open the fulfill panel for an order — prefill recipient from the order address.
  const openFulfill = (o: OrderRow) => {
    setShipOpen(o.id); setLabelErr(null); setCarrier("USPS"); setTracking("")
    setPasteOpen(false); setPasteText("")
    setTo(toAddrOf(o))
  }
  // Buy a real label. Goes through the aggregator (Shippo/EasyPost) when one is
  // configured, falling back to USPS-direct only if none is. On success the server stores
  // tracking + the label URL and moves the order to AWAITING SCAN — buying a label is not
  // shipping it; the parcel still has to be scanned and made.
  const buyLabel = async (o: OrderRow) => {
    setLabelErr(null)
    if (!addrComplete(to)) { setLabelErr("Recipient needs a street, city, state and ZIP."); return }
    if (!addrComplete(from)) { setLabelErr("Set your warehouse 'From' address (street, city, state, ZIP)."); return }
    setBusy(`label:${o.id}`)
    try {
      try { localStorage.setItem(FROM_STORE, JSON.stringify(from)) } catch {}
      // Persist for the whole team, not just this browser. Best-effort: a failed save
      // must not block a label that's otherwise ready to buy.
      setFactorySettings({ ship_from: from }).catch(() => {})
      const r = await buyUspsLabel({ to, from, orderId: o.id, ...pkg })
      if (!r.ok) { setLabelErr(r.error || "USPS couldn't create the label."); return }
      setLabels((prev) => ({ ...prev, [o.id]: r }))
      // A bought label means "ready to be scanned", NOT "gone". The parcel still has to be
      // scanned and made; marking the lines shipped here claimed work that hadn't happened
      // and skipped the order past the scan queue entirely. The server sets the stage; we
      // just reload rather than guessing at it.
      openLabel(r)
      setShipOpen(null); load()
    } catch (e) {
      setLabelErr(e instanceof Error ? e.message : "Label request failed.")
    } finally { setBusy(null) }
  }
  // Order-level status: flag / hold / advance every line at once.
  const setOrderStatus = async (o: OrderRow, to: string) => {
    setBusy(`ord:${o.id}`)
    try {
      for (const it of o.items ?? []) if (it.sku || it.line_id) { patchItem(o.id, it.sku ?? "", to, it.line_id); await postItemStatus(o.id, it.sku ?? "", to, it.line_id) }
      await updateOrder(o.id, { factoryStatus: to })
      setActionErr(null)
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : "Couldn't change that order's status.")
      load()
    } finally { setBusy(null) }
  }
  // Send a line item to the Designer board as a new card (whole-board upsert).
  const sendToDesigner = async (o: OrderRow, it: OrderItem, force = false, artOverride?: string) => {
    const key = lineKey(o, it)
    // A designer card with no artwork is an empty job — there is nothing to digitise and
    // no way to tell what it should become.
    //
    // `artOverride` is the designer window handing over the artwork it just saved: this
    // component's `designs` map can still be a beat behind that write, and reading only
    // from it is how a push landed on the guard below and did nothing.
    //
    // And it now SAYS SO. This used to be a bare `return` — the commonest way to reach it
    // was a real push with a real file, and the operator got no card, no error and no
    // reason, which is indistinguishable from the board being broken.
    const art = artOverride || artworkFor(o, it)
    if (!art) {
      setActionErr("That line has no saved artwork yet, so there's nothing to digitise. Add artwork and save it first.")
      return
    }
    setBusy(`dsn:${key}`)
    // Before spending a designer on this, ask whether we've already made the file. An
    // exact hit means identical artwork; a fuzzy hit only means it looks alike, so both
    // are shown to a human rather than acted on. `force` is the human saying "push anyway".
    if (!force && it.sku) {
      try {
        const r = await getDesignReuse(o.id, it.sku)
        if (r && (r.exact.length || r.similar.length)) {
          setReuse({ order: o, item: it, exact: r.exact, similar: r.similar })
          setBusy(null)
          return
        }
      } catch { /* lookup is an optimisation — never block the push on it */ }
    }
    try {
      const cards = await getDesignCards().catch(() => [])
      const dup = (cards ?? []).some((c) =>
        c.order_id === o.id && (it.line_id ? c.line_id === it.line_id : !c.line_id && c.sku === it.sku))
      if (!dup) {
        const card: DesignCard = {
          id: nowId(), order_id: o.id, sku: it.sku || undefined, line_id: it.line_id,
          title: it.name || it.sku || "Design", product: variantOf(it),
          // The ARTWORK, not the listing photo — a designer needs to see the file
          // they're digitising, not a product shot.
          // `art`, not a second artworkFor call — that would re-read the possibly-stale map
          // and hand the designer a card with no thumbnail on the very push that needed the
          // override.
          type: it.print_type || undefined, thumb: art || null,
          col: "incoming", pay_status: "pending", payment: 0,
          customer: o.customer?.name ?? null, is_emb: /emb/i.test(it.print_type || ""),
        }
        // The RESULT is checked. This is a POST of the ENTIRE board and every card carries
        // a base64 thumb, so the payload grows with the board and is exactly the shape that
        // gets rejected once it's big enough — the same hazard deleteDesignCard was split
        // out to avoid. `api` resolves with {error} rather than throwing on a handled
        // failure, so awaiting without looking swallowed it.
        const r = await saveDesignCards([...(cards ?? []), card])
        if (r?.error) throw new Error(r.error)
      }
      setSent((prev) => new Set(prev).add(key))
      setNote(dup ? "That line is already on the designer board." : "Sent to the designer board.")
    } catch (e) {
      // Was `catch { /* ignore */ }`. A push that failed looked identical to one that
      // worked: no card, no message, and an operator with no reason to think anything
      // went wrong until they opened the board and found it empty.
      setActionErr(`Couldn't send that line to a designer: ${e instanceof Error ? e.message : "unknown error"}`)
    } finally { setBusy(null) }
  }

  const stats = useMemo(() => {
    const list = orders ?? []
    const by = (id: string) => list.filter((o) => orderStage(o.items ?? []) === id).length
    const inProd = ["awaiting_scan", "printed", "working"]
    return {
      newCount: by(""),
      production: list.filter((o) => inProd.includes(orderStage(o.items ?? []))).length,
      ready: by("working"),
      shipped: by("shipped"),
    }
  }, [orders])

  const filtered = useMemo(() => {
    const list = orders ?? []
    if (filter === "all") return list
    if (filter === "issues") return list.filter((o) => isException(orderStage(o.items ?? [])))
    return list.filter((o) => orderStage(o.items ?? []) === filter)
  }, [orders, filter])

  const paged = usePaged(filtered, 25)

  // Batch dispatch selection. Kept as a Set of order ids rather than a flag on the rows so
  // it survives re-fetches and filter changes without having to reconcile anything.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null)
  const [dispatchOn, setDispatchOn] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => { getDispatchStatus().then((d) => setDispatchOn(!!d.configured)).catch(() => {}) }, 0)
    return () => clearTimeout(t)
  }, [])

  // Only orders with a bought label can be dispatched — there's nothing to scan otherwise.
  const dispatchable = (o: OrderRow) => !!o.tracking && !o.label_scanned_at
  const selectableOnPage = paged.pageItems.filter(dispatchable)
  const allOnPageSelected = selectableOnPage.length > 0 && selectableOnPage.every((o) => selected.has(o.id))

  const toggleOne = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const togglePage = () =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (allOnPageSelected) selectableOnPage.forEach((o) => n.delete(o.id))
      else selectableOnPage.forEach((o) => n.add(o.id))
      return n
    })
  // "All matching this filter" — not just the page, since a warehouse thinks in runs.
  const selectAllFiltered = () => setSelected(new Set(filtered.filter(dispatchable).map((o) => o.id)))

  // NOTE: the in-house scan (POST /api/orders/:id/scanned) is live on the server and has
  // no button here on purpose — this bar is deliberately just "what's selected" and "the
  // action". It wants a home that isn't a bulk toolbar; the Scan readiness chip on each
  // row is the obvious one, since that's where the fact is already displayed.
  /**
   * Stage the selection on the DISPATCH BOARD. Doesn't send it anywhere yet.
   *
   * This used to push straight to byeastside — a paid, external action taken from a list
   * you might only have been browsing, with no step in between. The board is where the two
   * routes are chosen (partner or in-house), so the decision belongs there, beside the
   * queue, rather than here beside a filter.
   */
  const doPush = async () => {
    if (!selected.size) return
    setPushing(true); setPushMsg(null)
    try {
      const ids = [...selected]
      const results = await Promise.all(ids.map((id) =>
        updateOrder(id, { factoryStatus: "awaiting_scan" })
          .then(() => ({ ok: true, error: "" }))
          .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : "failed" }))))
      const failed = results.filter((x) => !x.ok)
      setPushMsg(failed.length
        ? { tone: "err", text: `${ids.length - failed.length} sent · ${failed.length} failed — ${failed[0].error}` }
        : { tone: "ok", text: `${ids.length} sent to the dispatch board — pick the scan route there.` })
      setSelected(new Set())
      load()
    } catch (e) {
      setPushMsg({ tone: "err", text: e instanceof Error ? e.message : "Couldn't send those to the board." })
    } finally { setPushing(false) }
  }

  // Artwork for EVERY row on the page, not only the open ones — the collapsed row now
  // carries a photo strip, and a strip of bare blanks on a production board is a picture
  // of the wrong thing (a plain hoodie where the job is a printed hoodie).
  //
  // Deliberately narrower than the expansion fetch below: designs ONLY, not threads or
  // machine files, so this is one request per order rather than the three that scoping to
  // expansion was avoiding. Deduped in its own ref and keyed by the page's ids, so paging
  // back and forth is free and the expansion effect skips whatever this already loaded.
  const pageIds = paged.pageItems.map((o) => o.id).join(",")
  const designsRef = useRef<Record<string, boolean>>({})
  const loadDesigns = useCallback((oid: string) => {
    if (designsRef.current[oid]) return
    designsRef.current[oid] = true
    getOrderDesigns(oid).then((r) => {
      const list = Array.isArray(r) ? r : (r?.designs ?? [])
      const bySku: Record<string, OrderDesign> = {}
      Object.assign(bySku, indexDesigns(list))
      setDesigns((p) => ({ ...p, [oid]: bySku }))
    }).catch(() => {})
  }, [])
  useEffect(() => {
    const id = setTimeout(() => {
      for (const oid of pageIds ? pageIds.split(",") : []) loadDesigns(oid)
    }, 0)
    return () => clearTimeout(id)
  }, [pageIds, loadDesigns])

  // Threads and machine files for the orders actually OPEN. Still scoped to expansion:
  // these are the heavy two, and nobody is looking at them on a closed row.
  // Separate from threadsRef: an upload must be able to refresh FILES without dragging
  // the thread history along with it.
  const filesRef = useRef<Record<string, boolean>>({})
  const visibleIds = paged.pageItems.filter((o) => expandedIds.has(o.id)).map((o) => o.id).join(",")
  /**
   * ONE design-file list per order, shared by everything that shows one.
   *
   * The readiness tag, the expanded order details and the artwork panel all read this
   * same `dfiles` map — none of them fetch their own copy, so they cannot disagree about
   * whether a machine file exists, and one upload refreshes all three.
   *
   * `force` exists because the fetch is deduped by a ref that is set once and never
   * cleared. That is right for scrolling (don't refetch on every expand) and wrong after
   * an upload: the .emb landed, the list still said none, and the tag kept reporting
   * "no machine file" until a full reload.
   */
  const loadFiles = useCallback((oid: string, force = false) => {
    if (!oid) return
    if (!force && filesRef.current[oid]) return
    filesRef.current[oid] = true
    getDesignFiles(oid).then((r) => setDfiles((p) => ({ ...p, [oid]: r ?? [] }))).catch(() => {})
  }, [])

  useEffect(() => {
    const id = setTimeout(() => {
      for (const oid of visibleIds ? visibleIds.split(",") : []) {
        loadFiles(oid)
        if (threadsRef.current[oid]) continue
        threadsRef.current[oid] = true
        getOrderThreads(oid).then((r) => setThreads((p) => ({ ...p, [oid]: r ?? [] }))).catch(() => {})
        // Designs are fetched by the page-level effect above and deduped in its own ref,
        // so expanding a row no longer re-requests them.
        loadDesigns(oid)
      }
    }, 0)
    return () => clearTimeout(id)
  }, [visibleIds, loadDesigns, loadFiles])

  const subtitle = isAdmin
    ? "Every order across the team — production to shipping."
    : canFulfill ? "Receive, pack, and ship orders out the door."
      : "Review artwork and drive orders through production."

  return (
    <div className="space-y-4">
      {/* Mobile-only: the top bar names the page on desktop, so the hero would just
          duplicate it there. On mobile the top bar is hidden, so the hero IS the title. */}
      <div className="flex items-center gap-3 md:hidden">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Package size={18} weight="fill" /></span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <StatGrid>
        <StatCard label="New" value={String(stats.newCount)} sub="awaiting start" tone={stats.newCount ? "neg" : undefined} />
        <StatCard label="In production" value={String(stats.production)} sub="scan → pack" />
        <StatCard label="Working" value={String(stats.ready)} sub="being made" tone={stats.ready ? "pos" : undefined} />
        <StatCard label="Shipped" value={String(stats.shipped)} sub="complete" tone="pos" />
      </StatGrid>

      {/* Why an action was refused — the ship gate's reasons land here rather than the
          status silently snapping back. */}
      {/* Opened from the header, so it must mount regardless of whether the list has
          rows — inside the list branch it was dead on an empty board. */}
      <ImportOrdersDialog open={importOpen} onOpenChange={setImportOpen} onImported={load} />

      {note && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm">
          <PaperPlaneTilt size={16} weight="bold" className="mt-0.5 shrink-0 text-muted-foreground" />
          <span className="flex-1">{note}</span>
          <button onClick={() => setNote(null)} className="shrink-0 font-medium text-muted-foreground underline underline-offset-2">Dismiss</button>
        </div>
      )}
      {actionErr && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <Warning size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span className="flex-1">{actionErr}</span>
          <button onClick={() => setActionErr(null)} className="shrink-0 font-medium underline underline-offset-2">Dismiss</button>
        </div>
      )}

      <SectionCard
        title="Production queue"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <UploadSimple size={14} weight="bold" /> Import
            </Button>
            <Button size="sm" variant="outline" onClick={() => router.push("/orders/new")}>
              <Plus size={14} weight="bold" /> New order
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-1.5 border-b border-border px-5 py-3">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={"eg-tap rounded-full px-3 py-1 text-sm font-medium transition-colors " + (filter === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {f.label}
            </button>
          ))}
        </div>

        {orders === null ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Package size={24} weight="duotone" />
            <div className="font-medium text-foreground">Nothing here</div>
            <div className="text-sm">{(orders.length ?? 0) === 0 ? "No orders are in production yet." : "No orders match this filter."}</div>
          </div>
        ) : (
          <>
          {/* Batch dispatch bar. Two conditions, both necessary:
              • the partner is configured — an action that can't work shouldn't occupy
                the header
              • something is actually SELECTED — it used to appear whenever anything was
                selectable, so a board with nothing ticked still showed "Select page (1)"
                and "Select all 7 in this filter", which reads as a selection you didn't
                make. Rows carry their own checkbox, so this is not the only way in. */}
          {/* Stripped to the two things that matter: what's selected, and the action.
              It previously carried five controls — a page checkbox, "select page (2)",
              "select all 8 in this filter", the in-house scan and Clear — which is a
              paragraph of options above a list you were already looking at. Rows carry
              their own checkbox, so bulk selection was never the only way in. */}
          {dispatchOn && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-5 py-2.5">
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
              <Button size="sm" onClick={doPush} disabled={pushing}>
                {pushing ? <CircleNotch size={13} className="animate-spin" /> : <TrayArrowDown size={13} weight="bold" />}
                {pushing ? "Sending…" : `Send ${selected.size} to dispatch board`}
              </Button>
              {/* Unlabelled ×: without it there's no way out of a selection except
                  unticking every row. */}
              <button onClick={() => setSelected(new Set())}
                className="text-muted-foreground hover:text-foreground" aria-label="Clear selection">
                <X size={14} weight="bold" />
              </button>
              {pushMsg && (
                <span className={"text-xs font-medium " + (pushMsg.tone === "ok" ? "text-emerald-600" : "text-destructive")}>
                  {pushMsg.text}
                </span>
              )}
            </div>
          )}
          <div className="divide-y divide-border">
            {paged.pageItems.map((o) => {
              const items = o.items ?? []
              const stage = orderStage(items)
              const allShipped = items.length > 0 && items.every((it) => normalizeStage(it.factory_status) === "shipped")
              const units = items.reduce((n, it) => n + (Number(it.qty) || 1), 0)
              const label = labels[o.id]
              const track = label?.trackingNumber || o.tracking
              const isCollapsed = !expandedIds.has(o.id)
              return (
                <div key={o.id} className="p-5">
                  {/* justify-between with exactly two children pushed them to opposite
                      edges and left the middle empty — the dead space in the middle of
                      every row. The identity block now GROWS to fill it, so the actions sit
                      against content instead of against the far wall.

                      The identity line is a grid, not a wrap: order number, customer and
                      the rest land on the same x-position in every row, so the eye can run
                      down a column instead of re-reading each row. Wide things (photos,
                      address, tracking) stay in the full-width strip below, where they have
                      room — which is why this isn't a strict table. */}
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="grid grid-cols-[auto_auto_minmax(7rem,auto)_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
                        {/* A box on EVERY row, disabled where it can't be used.
                            Rendering it only on dispatchable rows was tried, and reads as
                            a half-built feature: most orders have no label yet, so most
                            rows had no box, and a column that appears on a minority of
                            rows looks broken rather than selective. Disabled-with-a-reason
                            says "not this one, and here's why"; absent says nothing. */}
                        {dispatchOn && (
                          <input
                            type="checkbox"
                            checked={selected.has(o.id)}
                            disabled={!dispatchable(o)}
                            onChange={() => toggleOne(o.id)}
                            aria-label={dispatchable(o)
                              ? `Select ${numOf(o)} for dispatch`
                              : `${numOf(o)} can't be dispatched — ${o.label_scanned_at ? "already pre-scanned" : "no label bought yet"}`}
                            title={dispatchable(o) ? undefined
                              : o.label_scanned_at
                                ? "Already pre-scanned — its tracking is live."
                                : "No label bought yet, so there's nothing for the partner to scan."}
                            className="size-4 shrink-0 rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                          />
                        )}
                        <button
                          onClick={() => toggleCollapse(o.id)}
                          aria-expanded={!isCollapsed}
                          aria-label={isCollapsed ? `Expand ${numOf(o)}` : `Collapse ${numOf(o)}`}
                          className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <CaretRight size={13} weight="bold" className={"transition-transform " + (isCollapsed ? "" : "rotate-90")} />
                        </button>
                        <span className="font-mono text-sm font-semibold">{numOf(o)}</span>
                        <StageBadge status={stage} />
                        <span className="truncate text-sm font-medium">{o.customer?.name || "—"}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        {/* Platform fused with the shop, not a separate flag on the row
                            above: they're one fact ("CustomBabeUSA, on Etsy"), and a
                            per-row brand logo would put 50 colour spots in competition
                            with the status badges, which are what should stand out. */}
                        <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                          <span className="text-muted-foreground">{platformOf(o)}</span>
                          {o.store && o.store.toLowerCase() !== platformOf(o).toLowerCase() && (
                            <> · <span className="capitalize">{o.store}</span></>
                          )}
                        </span>
                        <span>{fmtDate(o.created_at)}</span>
                        <span>· {items.length} item{items.length === 1 ? "" : "s"} · {units} unit{units === 1 ? "" : "s"}</span>
                        {/* Address + how we got it. The MISSING case is no longer flagged
                            here — the readiness strip already names it, and saying it twice
                            on one row is noise. This shows provenance when there IS one. */}
                        {addrLine(o) && (
                          <span className="inline-flex items-center gap-0.5" title={`Address ${ADDRESS_SOURCE_LABEL[addressSource(o)]}`}>
                            <MapPin size={11} weight="fill" /> {addrLine(o)}
                            <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                              {ADDRESS_SOURCE_LABEL[addressSource(o)]}
                            </span>
                          </span>
                        )}
                        {track && (
                          <a
                            href={trackUrl(o.carrier || label?.carrier, track)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 font-medium text-emerald-600 hover:underline"
                          >
                            <Truck size={11} weight="fill" /> {o.carrier || label?.carrier || "USPS"} {track} <ArrowSquareOut size={9} weight="bold" />
                          </a>
                        )}
                      </div>

                      {/* Photos on the COLLAPSED row only. Expanding already shows a
                          64px avatar per line, so rendering the strip there too would say
                          the same thing twice; collapsed, the row was text-only and you
                          had to open an order to see what was in it.
                          Same PhotoStack the seller table uses, so the two surfaces can't
                          drift. Thumbs lead with the listing photo (it reads better at
                          32px than a composite does) and clicking one opens the detail
                          window on the attached design. */}
                      {isCollapsed && items.length > 0 && (
                        <div className="mt-2">
                          <PhotoStack items={items} designs={designs[o.id]} catalog={catalog} size={56} max={4} overlap={false} />
                        </div>
                      )}
                    </div>
                    {/* One PRIMARY action for the current stage/role; everything rarer
                        (flag/status, labels, the non-primary of ship/advance) tucks into a
                        ⋯ menu so the row isn't a wall of buttons. */}
                    {allShipped ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle size={14} weight="fill" /> Shipped</span>
                    ) : (() => {
                      const opts = stageOptionsFor(role, stage)
                      const prod = opts.filter((s) => !EXCEPTION_STAGES.some((x) => x.id === s.id))
                      const exc = opts.filter((s) => EXCEPTION_STAGES.some((x) => x.id === s.id))
                      const canShip = canFulfill && shipOpen !== o.id
                      const canAdvance = canSetStage(role, stage, nextStage(stage) ?? "")
                      const canStart = canFulfill && stage === ""
                      const canLabels = canFulfill && items.some((it) => it.sku && variantOf(it))
                      // Primary = the one obvious next move. Intake → Start; ready → ship;
                      // otherwise advance a stage.
                      const primary: "start" | "ship" | "advance" | null =
                        canStart ? "start" : canShip ? "ship" : canAdvance ? "advance" : null
                      const busyO = busy?.startsWith(o.id)
                      return (
                        <div className="flex items-center gap-2">
                          {/* Readiness sits with the actions, not in the metadata line: the
                              left of a row is identity, the right is state and what to do
                              about it. Sharing a line with store/date/address made five
                              dots read as more clutter rather than a summary. */}
                          {/* Ours ends at shipped; the carrier's status carries on from there. */}
                        <DeliveryBadge order={o} onRefreshed={load} className="mr-1" />
                        <ReadinessStrip order={o} designs={designs[o.id]} files={dfiles[o.id]} className="mr-1" />
                          {primary === "start" && <Button size="sm" onClick={() => receiveOrder(o)} disabled={busyO}>Start order</Button>}
                          {primary === "ship" && <Button size="sm" onClick={() => openFulfill(o)}>Create new label</Button>}
                          {primary === "advance" && <Button size="sm" onClick={() => advanceOrder(o)} title="Move every item one step further.">Next stage</Button>}
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label="More actions"
                              disabled={busy === `ord:${o.id}`}
                              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-card px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                            >
                              <DotsThree size={18} weight="bold" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              {/* the non-primary pipeline actions */}
                              <DropdownMenuItem onClick={() => router.push(`/orders/${encodeURIComponent(o.id)}`)}><ArrowSquareOut size={14} weight="bold" /> Open order</DropdownMenuItem>
                              {primary !== "advance" && canAdvance && <DropdownMenuItem onClick={() => advanceOrder(o)}><SkipForward size={14} weight="fill" /> Next stage</DropdownMenuItem>}
                              {primary !== "ship" && canShip && <DropdownMenuItem onClick={() => openFulfill(o)}><Truck size={14} weight="bold" /> Create new label</DropdownMenuItem>}
                              {label && <DropdownMenuItem onClick={() => openLabel(label)}><Printer size={14} weight="bold" /> Reopen label</DropdownMenuItem>}
                              {/* Only printable once a blank is chosen — the barcode is the
                                  STOCK code, so a line without a blank has nothing to
                                  encode. Disabled with the reason rather than hidden, so
                                  it's clear what's missing. */}
                              {canLabels && (() => {
                                const printable = (o.items ?? []).some((it) => resolveProduct(it, catalog)?.sku || it.blank)
                                return (
                                  <DropdownMenuItem
                                    disabled={!printable}
                                    onClick={() => printable && setBarcodeOrder(o)}
                                    title={printable ? undefined : "Pick a blank on at least one line first — the barcode is the stock code"}
                                  >
                                    <Barcode size={14} weight="bold" /> Print blank labels
                                  </DropdownMenuItem>
                                )
                              })()}
                              {prod.length > 0 && (
                                <>
                                  <DropdownMenuSeparator />
                                  {/* Base UI requires a GroupLabel to sit inside a Group —
                                      a bare label throws "MenuGroupContext is missing" as
                                      the popup mounts, which killed the whole menu. */}
                                  <DropdownMenuGroup>
                                    <DropdownMenuLabel>Set all items to</DropdownMenuLabel>
                                    {prod.map((s) => <DropdownMenuItem key={s.id || "new"} onClick={() => setOrderStatus(o, s.id)}>{s.label}</DropdownMenuItem>)}
                                  </DropdownMenuGroup>
                                </>
                              )}
                              {exc.length > 0 && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuGroup>
                                    <DropdownMenuLabel>Flag / hold</DropdownMenuLabel>
                                    {exc.map((s) => <DropdownMenuItem key={s.id} onClick={() => setOrderStatus(o, s.id)}><Flag size={13} weight="fill" /> {s.label}</DropdownMenuItem>)}
                                  </DropdownMenuGroup>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )
                    })()}
                  </div>

                  {/* Fulfill panel (warehouse/admin): buy a USPS-direct label, or record tracking manually */}
                  {canFulfill && shipOpen === o.id && (
                    <div className="mb-3 space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        {/* Ship to — prefilled from the order */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ship to</div>
                            <button
                              onClick={() => setPasteOpen((v) => !v)}
                              className="text-[11px] font-medium text-primary hover:underline"
                            >
                              {pasteOpen ? "Hide paste box" : "Paste an address"}
                            </button>
                          </div>

                          {/* The fastest way in while Etsy withholds buyer addresses:
                              paste the block from anywhere and let it split itself. Same
                              parser the manual-order form uses. */}
                          {pasteOpen && (
                            <div className="space-y-1.5 rounded-lg border border-dashed border-border p-2">
                              <textarea
                                value={pasteText}
                                onChange={(e) => {
                                  setPasteText(e.target.value)
                                  const { name, addr } = parseBlock(e.target.value)
                                  // Only overwrite what we actually parsed — a half-typed
                                  // paste shouldn't wipe fields already filled in.
                                  setTo((prev) => ({
                                    ...prev,
                                    name: name || prev.name,
                                    street: addr.street || prev.street,
                                    street2: addr.street2 || prev.street2,
                                    city: addr.city || prev.city,
                                    state: addr.state || prev.state,
                                    zip: addr.zip || prev.zip,
                                  }))
                                }}
                                rows={4}
                                placeholder={"Jyoti Reddy\n881 Bergen Ave\nApt 4R\nBrooklyn, NY 11238"}
                                className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                              />
                              <p className="text-[10px] text-muted-foreground">
                                Name on the first line, then the street, then City, ST ZIP. Fields below fill as you paste.
                              </p>
                            </div>
                          )}

                          <Input value={to.name ?? ""} onChange={(e) => setTo({ ...to, name: e.target.value })} placeholder="Recipient name" className="h-9" />
                          <Input value={to.street ?? ""} onChange={(e) => setTo({ ...to, street: e.target.value })} placeholder="Street address" className="h-9" />
                          <Input value={to.street2 ?? ""} onChange={(e) => setTo({ ...to, street2: e.target.value })} placeholder="Apt, suite (optional)" className="h-9" />
                          <div className="grid grid-cols-[1fr_4rem_5rem] gap-2">
                            <Input value={to.city ?? ""} onChange={(e) => setTo({ ...to, city: e.target.value })} placeholder="City" className="h-9" />
                            <Input value={to.state ?? ""} onChange={(e) => setTo({ ...to, state: e.target.value })} placeholder="ST" className="h-9" />
                            <Input value={to.zip ?? ""} onChange={(e) => setTo({ ...to, zip: e.target.value })} placeholder="ZIP" className="h-9" />
                          </div>
                        </div>
                        {/* Ship from — your warehouse, saved for next time */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ship from</span>
                            <span className="text-[10px] text-muted-foreground">saved for next time</span>
                          </div>
                          <Input value={from.name ?? ""} onChange={(e) => setFrom({ ...from, name: e.target.value })} placeholder="Warehouse / sender name" className="h-9" />
                          <Input value={from.street ?? ""} onChange={(e) => setFrom({ ...from, street: e.target.value })} placeholder="Street address" className="h-9" />
                          <Input value={from.street2 ?? ""} onChange={(e) => setFrom({ ...from, street2: e.target.value })} placeholder="Suite (optional)" className="h-9" />
                          <div className="grid grid-cols-[1fr_4rem_5rem] gap-2">
                            <Input value={from.city ?? ""} onChange={(e) => setFrom({ ...from, city: e.target.value })} placeholder="City" className="h-9" />
                            <Input value={from.state ?? ""} onChange={(e) => setFrom({ ...from, state: e.target.value })} placeholder="ST" className="h-9" />
                            <Input value={from.zip ?? ""} onChange={(e) => setFrom({ ...from, zip: e.target.value })} placeholder="ZIP" className="h-9" />
                          </div>
                        </div>
                      </div>

                      {/* Package + service */}
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Service</span>
                          <select value={pkg.mailClass} onChange={(e) => setPkg({ ...pkg, mailClass: e.target.value })} className="eg-select h-9 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                            {MAIL_CLASSES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                          </select>
                        </label>
                        <label className="flex w-20 flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Weight oz</span>
                          <Input type="number" min={1} value={pkg.weightOz} onChange={(e) => setPkg({ ...pkg, weightOz: Number(e.target.value) })} className="h-9" />
                        </label>
                        <label className="flex w-16 flex-col gap-1">
                          <span className="text-xs text-muted-foreground">L in</span>
                          <Input type="number" min={1} value={pkg.length} onChange={(e) => setPkg({ ...pkg, length: Number(e.target.value) })} className="h-9" />
                        </label>
                        <label className="flex w-16 flex-col gap-1">
                          <span className="text-xs text-muted-foreground">W in</span>
                          <Input type="number" min={1} value={pkg.width} onChange={(e) => setPkg({ ...pkg, width: Number(e.target.value) })} className="h-9" />
                        </label>
                        <label className="flex w-16 flex-col gap-1">
                          <span className="text-xs text-muted-foreground">H in</span>
                          <Input type="number" min={1} value={pkg.height} onChange={(e) => setPkg({ ...pkg, height: Number(e.target.value) })} className="h-9" />
                        </label>
                        <Button size="sm" onClick={() => buyLabel(o)} disabled={busy === `label:${o.id}`} className="ml-auto">
                          {busy === `label:${o.id}` ? <CircleNotch size={14} className="animate-spin" /> : <><Printer size={14} weight="bold" /> Buy USPS label</>}
                        </Button>
                      </div>

                      {labelErr && <div className="flex items-center gap-1.5 text-sm text-destructive"><Warning size={14} weight="fill" /> {labelErr}</div>}

                      {/* Manual fallback — record a label bought elsewhere */}
                      <details className="rounded-lg border border-border bg-card">
                        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground">Already have a label? Record tracking manually</summary>
                        <div className="flex flex-wrap items-end gap-2 border-t border-border p-3">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Carrier</span>
                            <select value={carrier} onChange={(e) => setCarrier(e.target.value)} className="eg-select h-9 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                              {CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </label>
                          <label className="flex flex-1 flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Tracking number</span>
                            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="e.g. 9400 1000 0000 0000 0000 00" className="h-9" />
                          </label>
                          <Button size="sm" variant="outline" onClick={() => shipOrder(o)} disabled={busy === `ship:${o.id}`}>
                            {busy === `ship:${o.id}` ? <CircleNotch size={14} className="animate-spin" /> : <><Truck size={14} weight="bold" /> Mark shipped</>}
                          </Button>
                        </div>
                      </details>

                      <div className="flex justify-end">
                        <Button size="sm" variant="ghost" onClick={() => setShipOpen(null)}>Close</Button>
                      </div>
                    </div>
                  )}

                  {/* Order detail — the things a board needs but the header can't hold:
                      the full ship-to, the buyer's personalisation instructions, and any
                      note. Previously none of this was reachable from a factory board at
                      all, so staff had to open the seller's order page to read them. */}
                  {!isCollapsed && (() => {
                    const a = (o.address ?? {}) as Record<string, string>
                    const street = a.street || a.first_line || a.line1 || a.address1 || ""
                    const notes = (o as { notes?: string | null }).notes
                    const personal = (o.items ?? []).map((it) => (it as { personalization?: string | null }).personalization).filter(Boolean)
                    if (!street && !notes && !personal.length) return null
                    return (
                      <div className="mb-3 grid gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-2">
                        <div>
                          <div className="mb-0.5 font-semibold uppercase tracking-wide text-muted-foreground">Ship to</div>
                          {street ? (
                            <div className="leading-relaxed">
                              {o.customer?.name && <div className="font-medium text-foreground">{o.customer.name}</div>}
                              <div>{street}</div>
                              {(a.street2 || a.second_line || a.line2) && <div>{a.street2 || a.second_line || a.line2}</div>}
                              <div>{[a.city, a.state, a.zip || a.postal_code].filter(Boolean).join(", ")}</div>
                              {(a.country || a.country_iso) && <div>{a.country || a.country_iso}</div>}
                              <div className="mt-1 text-[10px] text-muted-foreground">{ADDRESS_SOURCE_LABEL[addressSource(o)]}</div>
                            </div>
                          ) : (
                            <div className="text-muted-foreground">Not available yet.</div>
                          )}
                        </div>
                        <div className="space-y-2">
                          {personal.length > 0 && (
                            <div>
                              <div className="mb-0.5 font-semibold uppercase tracking-wide text-muted-foreground">Personalisation</div>
                              {personal.map((p, i) => <div key={i} className="leading-relaxed">{decodeEntities(p)}</div>)}
                            </div>
                          )}
                          {notes && (
                            <div>
                              <div className="mb-0.5 font-semibold uppercase tracking-wide text-muted-foreground">Note</div>
                              <div className="leading-relaxed">{notes}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}

                  <div className={"space-y-2 " + (isCollapsed ? "hidden" : "")}>
                    {items.map((it, i) => {
                      const key = lineKey(o, it)
                      const art = artworkFor(o, it)
                      return (
                        <div key={it.line_id ?? it.sku ?? i} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2.5">
                          {/* Shows the blank with its artwork placed — what actually gets
                              made — not the marketplace listing photo. Editing is offered
                              only to the roles whose job it is; warehouse gets the zoom.

                              The zoom control used to sit HERE as its own button, ahead of
                              the image — it took layout space in front of the thing it
                              describes and pushed the artwork off its position. It now
                              overlays the image corner on hover (below), so it costs no
                              space and stays where the image already is. */}
                          <div className="group/art relative self-start">
                          <ItemAvatar
                            item={it}
                            designs={designs[o.id]}
                            catalog={catalog}
                            size={64}
                            onEdit={canDesign ? () => setEditing({ order: o, item: it }) : undefined}
                            onDropImage={canDesign && it.sku ? (dataUrl) => {
                              postOrderDesign(o.id, { sku: it.sku!, line_id: it.line_id, data: dataUrl, name: it.name })
                                .then(() => {
                                  setNote(`Artwork attached to ${it.name || it.sku}.`)
                                  return getOrderDesigns(o.id)
                                })
                                .then((r) => {
                                  const list = Array.isArray(r) ? r : (r?.designs ?? [])
                                  const bySku: Record<string, OrderDesign> = {}
                                  Object.assign(bySku, indexDesigns(list))
                                  setDesigns((p) => ({ ...p, [o.id]: bySku }))
                                })
                                .catch(() => setActionErr("Couldn't attach that artwork."))
                            } : undefined}
                          />
                          {/* The magnifier that used to sit here opened a SECOND window —
                              a separate "artwork panel" holding the download, the machine
                              file and the design charge, while clicking the avatar opened
                              the designer. One line, two windows, and only one of them
                              reachable by a seller: the designer's own error message used
                              to send sellers to a panel that doesn't exist for them.
                              Both are now the same window, so the avatar is the only door
                              and the tile carries one control instead of two stacked on the
                              same 24px. */}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{it.name || it.sku || "Item"}</div>
                            {/* Factory-owned marketplace orders arrive with no blank chosen;
                                artwork review (canDesign) picks it here while the order is
                                still unstarted. A pushed seller order is past "" (already
                                charged) so it shows the read-only variant instead — and the
                                server 409s any stray write to a charged order regardless. */}
                            {canDesign && stage === "" ? (
                              <VariantPicker orderId={o.id} item={it} catalog={catalog} onSaved={load} />
                            ) : (
                              <>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <VariantStrip color={it.color} size={it.size} method={it.print_type} marketplace={it.variant} />
                                {it.qty ? <span className="text-[11px] text-muted-foreground">×{it.qty}</span> : null}
                              </div>

                              {/* What the floor needs to actually MAKE this line: how much
                                  blank we hold, which cones to load, and the machine file.
                                  All three were stored already and shown nowhere. */}
                              {(() => {
                                // Stock is held against the BLANK we shelve, not the
                                // marketplace listing SKU — same resolution the barcode
                                // does. Keying on it.sku meant every Etsy line (which
                                // arrives with no blank chosen) silently showed no stock
                                // at all rather than "no blank picked yet".
                                const stockSku = resolveProduct(it, catalog)?.sku || it.blank || ""
                                const skuU = String(stockSku || it.sku || "").toUpperCase()
                                const have = stockSku ? stock[skuU] : undefined
                                const need = Number(it.qty) || 1
                                const cones = (threads[o.id] ?? []).find((t) => String(t.sku).toUpperCase() === skuU)?.threads ?? []
                                const file = (dfiles[o.id] ?? []).find((f) => String(f.sku ?? "").toUpperCase() === skuU)
                                if (have == null && !cones.length && !file) return null
                                return (
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                                    {have != null && (
                                      <span
                                        className={"inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium " + (have >= need ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-800")}
                                        title={have >= need ? "Enough blank stock for this line" : `Only ${have} in stock, this line needs ${need}`}
                                      >
                                        {have >= need ? `${have} in stock` : `Short — ${have} of ${need}`}
                                      </span>
                                    )}
                                    {cones.length > 0 && (
                                      // The chip said WHICH cones; it now opens the map of
                                      // which cone covers which part of the artwork — the
                                      // half a digitiser was previously guessing at.
                                      <ThreadBreakdown artwork={artworkFor(o, it)}>
                                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                                          {cones.map((c) => (
                                            <span key={c.code} className="size-3 rounded-full border border-black/10" style={{ background: c.hex }} />
                                          ))}
                                          <span>{cones.length} cone{cones.length === 1 ? "" : "s"}</span>
                                        </span>
                                      </ThreadBreakdown>
                                    )}
                                    {file && (
                                      <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" title={`Machine file ${file.name ?? ""} · ${file.designId}`}>
                                        <FileArrowDown size={10} weight="bold" /> {file.designId}
                                      </span>
                                    )}
                                  </div>
                                )
                              })()}
                              </>
                            )}
                          </div>
                          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                          {/* Own icon + a visible word. The pen-nib is the sidebar's
                              Board/Design Lab glyph — reusing it here made one symbol
                              mean three different things. */}
                          {canDesign && (
                            <Button
                              size="sm" variant="outline" className="shrink-0"
                              title={art
                                ? "Create a card for this item on the Designer board"
                                : "No artwork on this line yet — it has to be synced from the marketplace or uploaded before a designer has anything to work from"}
                              disabled={!art || busy === `dsn:${key}` || sent.has(key)}
                              onClick={() => sendToDesigner(o, it)}
                            >
                              {busy === `dsn:${key}` ? <CircleNotch size={13} className="animate-spin" />
                                : sent.has(key) ? <><CheckCircle size={13} weight="fill" className="text-emerald-600" /> Sent</>
                                : <><PaperPlaneTilt size={13} weight="bold" /> Board</>}
                            </Button>
                          )}
                          {/* ONE control per item. This row used to carry THREE things
                              that all showed/set the same field — a badge, this select,
                              and a next-stage button. The select already shows the
                              current status and can move it forward OR back, which is
                              what "fix this line" actually needs. */}
                          {(() => {
                            // Options are role-gated (see stageOptionsFor). An operator
                            // past Awaiting scan keeps NO pipeline options — the stage is
                            // the warehouse's to report — but still gets the stop options,
                            // so they read as a badge + a Flag control rather than a select.
                            const opts = stageOptionsFor(role, it.factory_status)
                            const prod = opts.filter((s) => !EXCEPTION_STAGES.some((x) => x.id === s.id))
                            const exc = opts.filter((s) => EXCEPTION_STAGES.some((x) => x.id === s.id))
                            if (!opts.length) return <StageBadge status={it.factory_status} />
                            if (!prod.length) return (
                              <>
                                <StageBadge status={it.factory_status} />
                                <select
                                  value=""
                                  onChange={(e) => { if (e.target.value) advanceItem(o, it, e.target.value) }}
                                  disabled={busy === key}
                                  className="eg-select h-8 shrink-0 rounded-2xl border border-border bg-card px-1.5 text-xs font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                  aria-label={`Flag ${it.name || it.sku}`}
                                  title="The warehouse has this item. You can still stop it if the artwork is wrong."
                                >
                                  <option value="">Flag…</option>
                                  {exc.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                                </select>
                              </>
                            )
                            return (
                              <select
                                value={normalizeStage(it.factory_status)}
                                onChange={(e) => advanceItem(o, it, e.target.value)}
                                disabled={busy === key}
                                className={"eg-select h-8 shrink-0 rounded-2xl border px-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 " + (isException(it.factory_status) ? "border-red-300 bg-red-50 text-red-700" : "border-border bg-card hover:border-primary/40")}
                                aria-label={`Status for ${it.name || it.sku}`}
                                title="Set this item's status — forward or back"
                              >
                                <optgroup label="Production">
                                  {prod.map((s) => <option key={s.id || "new"} value={s.id}>{s.label}</option>)}
                                </optgroup>
                                {exc.length > 0 && (
                                  <optgroup label="Exceptions">
                                    {exc.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                                  </optgroup>
                                )}
                              </select>
                            )
                          })()}
                          {busy === key && <CircleNotch size={13} className="shrink-0 animate-spin text-muted-foreground" />}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          {/* "We may already have made this." Exact and similar are kept visually
              separate on purpose: identical artwork is a safe reuse, whereas a
              lookalike is a lead to check. Attaching a fuzzy match automatically
              would eventually print the wrong artwork on a real order. */}
          <Dialog open={!!reuse} onOpenChange={(v) => { if (!v) setReuse(null) }}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{reuse?.exact.length ? "This design already exists" : "Similar designs found"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 px-1 pb-1">
                <p className="text-sm text-muted-foreground">
                  {reuse?.exact.length
                    ? "The same artwork has already been digitised. Reuse that file instead of sending this to a designer again — the seller sees a normal deliverable on their own order and nothing about where it came from."
                    : "Nothing matches exactly, but these look similar. Check one before paying for the same work twice."}
                </p>

                {reuse?.exact.length ? (
                  <div>
                    <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Identical artwork</div>
                    <div className="space-y-1.5">
                      {reuse.exact.map((m) => (
                    <MatchRow
                      key={m.design_id}
                      m={m}
                      onUse={async () => {
                        const r = reuse
                        if (!r?.item.sku) return
                        setReuse(null)
                        try {
                          const res = await reuseDesignFile(m.design_id, { orderId: r.order.id, sku: r.item.sku })
                          if (res?.error) throw new Error(res.error)
                          setNote(`Reused an existing file for ${r.item.name || r.item.sku} — nothing sent to the board.`)
                          getDesignFiles(r.order.id).then((f) => setDfiles((p) => ({ ...p, [r.order.id]: f ?? [] }))).catch(() => {})
                        } catch (e) {
                          setActionErr(e instanceof Error ? e.message : "Couldn't reuse that file.")
                        }
                      }}
                    />
                  ))}
                    </div>
                  </div>
                ) : null}

                {reuse?.similar.length ? (
                  <div>
                    <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Looks similar — confirm before reusing</div>
                    <div className="space-y-1.5">
                      {reuse.similar.map((m) => <MatchRow key={m.design_id} m={m} similar />)}
                    </div>
                  </div>
                ) : null}
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setReuse(null)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={() => { const r = reuse; setReuse(null); if (r) sendToDesigner(r.order, r.item, true) }}
                >
                  Send to the board anyway
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* One editor for the whole board — mounted once, pointed at whichever line was
              clicked. Reloads the order's designs on save so the row avatar rehydrates
              with the new placement immediately, without a full board refetch. */}
          {editing && (
            <DesignCanvasDialog
              open
              onOpenChange={(v) => { if (!v) setEditing(null) }}
              orderId={editing.order.id}
              item={editing.item}
              initialDesign={designForLine(designs[editing.order.id], editing.item)?.data}
              initialPos={designForLine(designs[editing.order.id], editing.item)?.pos}
              catalog={catalog}
              // The order's OTHER lines, so "use on every line" exists here rather than in
              // a second window — and the designs map so it can say how many it would
              // overwrite. Same map the readiness tag reads; no second copy.
              siblings={(editing.order.items ?? []).filter((it) =>
                (it.line_id ?? it.sku) !== (editing.item.line_id ?? editing.item.sku))}
              designs={designs[editing.order.id]}
              // The dialog SAVES before calling this, so the artwork is on the server — but
              // `designs` in this component is still the copy from before that save, and
              // artworkFor reads it. Refetch first, then push, or the card is built from a
              // map that doesn't know about the file yet.
              onSendToDesigner={canDesign ? () => {
                const e = editing; setEditing(null)
                if (!e) return
                void getOrderDesigns(e.order.id)
                  .then((r) => {
                    const list = Array.isArray(r) ? r : (r?.designs ?? [])
                    const bySku = indexDesigns(list)
                    setDesigns((p) => ({ ...p, [e.order.id]: bySku }))
                    return sendToDesigner(e.order, e.item, false, designForLine(bySku, e.item)?.data || undefined)
                  })
                  .catch(() => setActionErr("Couldn't send that line to a designer."))
              } : undefined}
              onSaved={() => {
                const oid = editing.order.id
                // Refresh the SHARED file list too — this is what makes a machine file
                // filed in the designer show up in the readiness tag and the order details
                // without a page reload.
                loadFiles(oid, true)
                getOrderDesigns(oid).then((r) => {
                  const list = Array.isArray(r) ? r : (r?.designs ?? [])
                  const bySku: Record<string, OrderDesign> = {}
                  Object.assign(bySku, indexDesigns(list))
                  setDesigns((p) => ({ ...p, [oid]: bySku }))
                }).catch(() => {})
                getOrderThreads(oid).then((r) => setThreads((p) => ({ ...p, [oid]: r ?? [] }))).catch(() => {})
              }}
            />
          )}

          <Pagination page={paged.page} pageCount={paged.pageCount} perPage={paged.perPage} total={paged.total} start={paged.start} onPage={paged.setPage} onPerPage={paged.setPerPage} perPageOptions={[25, 50, 100]} />
          </>
        )}
      </SectionCard>

      {/* One sticker per UNIT (qty), so a x3 line prints 3 — that's what goes on the
          boxes. Lines with no chosen variant are skipped: labelling an undecided
          blank is worse than not labelling it. */}
      <LabelSheet
        open={!!barcodeOrder}
        onClose={() => setBarcodeOrder(null)}
        title={barcodeOrder ? `labels · ${numOf(barcodeOrder)}` : "labels"}
        /* The barcode is an INVENTORY code, so it must encode the BLANK we stock — not the
           marketplace listing SKU. Scanning "LA6" off an Etsy line tells the warehouse
           nothing: it isn't a thing on a shelf, and it can't drive a reorder. Lines with
           no blank chosen are excluded rather than printed with a meaningless code. */
        labels={(barcodeOrder?.items ?? [])
          .map((it) => {
            const blank = resolveProduct(it, catalog)
            const stockSku = blank?.sku || it.blank || ""
            return { it, stockSku }
          })
          .filter(({ stockSku }) => !!stockSku)
          .map(({ it, stockSku }) => ({
            sku: stockSku,
            name: it.name || stockSku,
            variant: variantOf(it),
            copies: Number(it.qty) || 1,
          }))}
      />

      <p className="text-center text-xs text-muted-foreground">Stages: {FACTORY_STAGES.map((s) => s.label).join(" → ")}</p>

    </div>
  )
}
