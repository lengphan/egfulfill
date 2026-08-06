"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { onLive } from "@/lib/live"
import { useRouter } from "next/navigation"
import { Package, Plus, UploadSimple, CircleNotch, CheckCircle, Truck, Printer, Warning, MapPin, ArrowSquareOut, SkipForward, PaperPlaneTilt, FileArrowDown, Barcode, DotsThree, CaretRight, TrayArrowDown, X, Check, ArrowUUpLeft } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { SectionCard } from "@/components/app/section-card"
import { parseBlock } from "@/lib/address-paste"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { StageBadge } from "@/components/app/stage-badge"
import { PackagingHint } from "@/components/app/packaging-hint"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/app/confirm-dialog"
import { Input } from "@/components/ui/input"
import { getDispatchStatus, getOrders, postItemStatus, updateOrder, getDesignCards, saveDesignCards, buyUspsLabel, validateAddress, getDesignReuse, reuseDesignFile, getFactorySettings, setFactorySettings, getCatalogProducts, getOrderThreads, getOrderDesigns, indexDesigns, designForLine, postOrderDesign, getDesignFiles, getInventory, getPurchaseOrders, savePurchaseOrder, resolveSuppliers, type OrderRow, type OrderItem, type DesignCard, type ShipAddress, type UspsLabelResult, type CatalogProduct, type OrderThreadRow, type DesignFileRow, type OrderDesign, type ReuseMatch, type PurchaseOrder } from "@/lib/api"
import { orderReadiness } from "@/lib/order-readiness"
import { orderStock } from "@/lib/stock-status"
import { getToken, getUser } from "@/lib/auth"
import { VariantPicker } from "@/components/app/variant-picker"
import { resolveProduct, orderNeedsSetup } from "@/lib/variant-resolve"
import { VariantStrip } from "@/components/app/variant-field"
import { FACTORY_COLS, factoryGridTemplate, FACTORY_DATA_COLS, isFactoryColLocked, loadFactoryColOrder, saveFactoryColOrder, loadFactoryHiddenCols, saveFactoryHiddenCols, reorderFactoryCols, type FactoryColId } from "@/lib/order-columns"
import { FACTORY_STAGES, EXCEPTION_STAGES, normalizeStage, nextStage, orderStage, isException, stageOptionsFor, canSetStage, stageDenialReason, canWalk, stagePath, stageMeta } from "@/lib/factory-status"
import { numOf, platformOf, variantOf, itemsLabel, addrLine, fmtDate, trackUrl, addressSource, ADDRESS_SOURCE_LABEL, decodeEntities } from "@/lib/order-format"
import { OrderFilterBar, OrderSearchInput, emptyOrdersMessage } from "@/components/app/order-filter-bar"
import { canFetchTiktokLabel, openTiktokLabelFor } from "@/lib/tiktok-label"
import { filterOrders, matchesStatus, EMPTY_ORDER_QUERY, STATUS_PILLS, loadHiddenStatusPills, saveHiddenStatusPills, type OrderQuery } from "@/lib/order-filter"
import { usePaged, Pagination } from "@/components/app/pagination"
import { LabelSheet } from "@/components/app/label-sheet"
import { ThreadBreakdown } from "@/components/app/thread-breakdown"
import { ReadinessStrip } from "@/components/app/readiness-dots"
import { useLabelT } from "@/lib/i18n"
import { ImportOrdersDialog } from "@/components/app/import-orders-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { ItemAvatar } from "@/components/app/item-avatar"
import { PhotoStack } from "@/components/app/photo-stack"
import { DesignCanvasDialog } from "@/components/app/design-canvas"

const nowId = () => Date.now()
const CARRIERS = ["USPS", "UPS", "FedEx", "DHL", "Other"]

// Per-order blank-stock chip for the warehouse, shown beside the readiness strip: is the
// stock here (purple), short (amber → send to a PO), or untracked/unknown (grey)? Hovering
// breaks it down per line and shows any PO a short blank is already on. Module-scope (not
// defined inside the row render) to satisfy react-hooks/static-components.
function StockChip({ order, items, catalog, stock, canPO, sending, onSend }: {
  order: OrderRow
  items: OrderItem[]
  catalog: CatalogProduct[]
  stock: Record<string, number>
  canPO: boolean
  sending: boolean
  onSend: (o: OrderRow) => void
}) {
  const { state } = orderStock(items, catalog, stock)
  // Same solid-tinted pill as the Label/Scan/Design chips beside it (readiness-dots.tsx):
  // purple = ready/in-stock, amber = needs action/out, grey = unknown. The colour IS the
  // status, and it recomputes every render — so picking a blank on a line flips it live. The
  // per-line NUMBERS live in the expanded detail, not here, to keep the row a clean pill.
  const tone =
    state === "in" ? "bg-primary/10 text-primary hover:bg-primary/15"
    : state === "out" ? "bg-amber-100 text-amber-800 hover:bg-amber-200/70"
    : "bg-muted text-muted-foreground/70 hover:bg-muted/80"
  // Always "Stock" — it used to say "In stock" / "No stock" / "Stock", which broke the one
  // rule the three chips beside it keep (see readiness-dots.tsx): a chip whose text changes
  // row to row can't be compared down a column, and it was the widest thing in the cell for
  // a word the colour already carries. The state is in the tone and the hover.
  const label = "Stock"
  const clickable = state === "out" && canPO
  const title = state === "in" ? "Blank stock is on hand for every line"
    : state === "out" ? (canPO ? "Short on blank stock — click to add to a draft purchase order. Open the order for the per-line breakdown." : "Short on blank stock — open the order for the per-line breakdown")
    : "Blank stock not tracked, or no blank picked yet — open the order to check"
  return (
    <button
      type="button"
      disabled={!clickable || sending}
      onClick={clickable ? () => onSend(order) : undefined}
      title={title}
      className={"eg-tap inline-flex shrink-0 items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium transition-colors " + tone + (clickable ? " cursor-pointer" : " cursor-default")}
    >
      {sending ? "Sending…" : label}
    </button>
  )
}

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
// Render an address back into the paste-box text, so opening a prefilled order shows the
// block the way it was pasted in (and stays the single source of truth for the ship-to box).
const addrToText = (a: ShipAddress): string =>
  [a.name, a.street, a.street2, [[a.city, a.state].filter(Boolean).join(", "), a.zip].filter(Boolean).join(" ")]
    .map((s) => (s || "").trim()).filter(Boolean).join("\n")

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
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-3xs font-medium text-muted-foreground">
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

// The stage pills — the ONLY control over query.status. The filter bar deliberately carries
// no Status dropdown: a second control for the same field, one row apart, is two answers to
// one question.
//
// NB: "draft" and the first pipeline stage (in_review) are DIFFERENT states. Draft =
// arrived/created but nobody has started it (where factory-synced orders land, unpaid);
// in_review = Pending: the seller submitted + paid, awaiting factory approval.
// (The pill roster itself is STATUS_PILLS in lib/order-filter.ts, beside the matcher that
// reads it. Which of them a person keeps on their row is a per-browser preference — see
// loadHiddenStatusPills.)

// ONE order page for the whole factory team. The queue + item controls are shared; the
// action set adapts to the role: operators review artwork + drive production, warehouse
// receives + ships, admin does everything.
export function OrdersHub() {
  const router = useRouter()
  const tl = useLabelT()
  const role = getUser()?.role || ""
  const isAdmin = role === "admin"
  const canFulfill = role === "warehouse" || isAdmin // receive (intake) + ship
  // Artwork review. NB: this no longer implies "set any status" — stage changes are
  // gated per-role by stageOptionsFor/canSetStage, and the server enforces it.
  const canDesign = role === "operator" || isAdmin // send to designer
  // Only warehouse/admin may write purchase orders (mirrors requireWarehouse on the server),
  // so only they get the actionable amber "send to PO" — operators see the status read-only.
  const canPO = isAdmin || role === "warehouse"

  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  // ONE narrowing state: the stage pills, the search box and every dropdown all write into
  // it. They used to be two — a `filter` string for the pills and a query for the rest —
  // which meant "Shipped" and a Status dropdown could hold contradictory answers, and the
  // empty-state sentence could only ever name one of them.
  const [query, setQuery] = useState<OrderQuery>(EMPTY_ORDER_QUERY)
  // Which stage pills this browser keeps on the row. Read after mount (localStorage), so the
  // first paint is the default set rather than a flash of everything.
  const [hiddenPills, setHiddenPills] = useState<string[]>([])
  useEffect(() => {
    const t = setTimeout(() => setHiddenPills(loadHiddenStatusPills()), 0)
    return () => clearTimeout(t)
  }, [])
  const togglePill = (id: string) => {
    const next = hiddenPills.includes(id) ? hiddenPills.filter((x) => x !== id) : [...hiddenPills, id]
    setHiddenPills(next); saveHiddenStatusPills(next)
  }
  // Fetching the TikTok-made label for a platform-shipped order. Per-order id so the row
  // that was clicked is the one that shows as busy.
  const [ttLabel, setTtLabel] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const confirm = useConfirm()
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
  // (pasteOpen removed — Ship-to is now a single, always-visible paste box.)
  const [pasteText, setPasteText] = useState("")
  // Per-order production detail the floor needs but the board never showed: matched
  // thread cones, machine files, and how much of the blank we actually have. Fetched
  // lazily per order (on expand) so a 50-order page doesn't make 150 requests.
  const [threads, setThreads] = useState<Record<string, OrderThreadRow[]>>({})
  const [dfiles, setDfiles] = useState<Record<string, DesignFileRow[]>>({})
  const [stock, setStock] = useState<Record<string, number>>({})
  // Draft/placed POs, so the stock chip's hover can show "already on PO #x" and the
  // send-to-PO action can append to an existing draft rather than mint a new one each click.
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [poBusy, setPoBusy] = useState<string | null>(null)  // order id being sent to a PO
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
  // Live recipient-address check for the ship panel — a visible ✓/⚠ before spending on a
  // label. Debounced; warn-not-block (validation can be down or the USPS Addresses API may
  // still be pending). All setState is inside the deferred timeout, never synchronous.
  const [addrCheck, setAddrCheck] = useState<{ status: "idle" | "checking" | "valid" | "invalid"; msg?: string }>({ status: "idle" })
  useEffect(() => {
    const complete = !!(to.street && to.city && to.state && to.zip)
    let alive = true
    const t = setTimeout(() => {
      if (!alive) return
      if (!complete) { setAddrCheck({ status: "idle" }); return }
      setAddrCheck({ status: "checking" })
      validateAddress({ streetAddress: to.street || "", secondaryAddress: to.street2, city: to.city || "", state: to.state || "", ZIPCode: to.zip || "" })
        .then((v) => { if (alive) setAddrCheck(v && v.ok ? { status: "valid" } : { status: "invalid", msg: v?.error }) })
        .catch(() => { if (alive) setAddrCheck({ status: "idle" }) })
    }, 600)
    return () => { alive = false; clearTimeout(t) }
  }, [to.street, to.street2, to.city, to.state, to.zip])
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
  // POs, only for warehouse/admin (who can act on them). Used by the stock chip.
  const loadPOs = useCallback(() => {
    if (!canPO) return
    getPurchaseOrders().then((p) => setPos(p ?? [])).catch(() => {})
  }, [canPO])
  useEffect(() => { loadPOs() }, [loadPOs])

  // Send an order's SHORT blanks to a purchase order — appends to an existing draft for the
  // supplier (or opens a new draft), tagging each line's `sources` with this order id so the
  // PO stays traceable back to what drove it. Idempotent: a blank already on a PO for THIS
  // order is skipped, so a second click never double-counts. Stays a DRAFT — placing an
  // order with a supplier is a separate, deliberately-gated step, and no cost books until
  // a PO is marked received.
  const sendToPO = async (o: OrderRow) => {
    const { shortLines } = orderStock(o.items ?? [], catalog, stock)
    if (!shortLines.length || !canPO) return
    setPoBusy(o.id); setNote(null)
    try {
      const skus = [...new Set(shortLines.map((l) => l.sku))]
      const supMap = await resolveSuppliers(skus).then((r) => r.bySku).catch(() => ({} as Record<string, { supplier: string | null }>))
      const bySupplier = new Map<string, typeof shortLines>()
      for (const l of shortLines) {
        const sup = supMap[l.sku]?.supplier || "Unassigned"
        const arr = bySupplier.get(sup) ?? []; arr.push(l); bySupplier.set(sup, arr)
      }
      const fresh = await getPurchaseOrders().catch(() => pos)
      const touched: string[] = []
      let added = 0
      for (const [supplier, ls] of bySupplier) {
        let po = fresh.find((p) => p.status === "draft" && (p.supplier || "Unassigned") === supplier)
        const isNew = !po
        if (!po) po = { num: "PO-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 5).toUpperCase(), supplier, items: [], status: "draft" }
        const nextItems = [...(po.items ?? [])]
        for (const l of ls) {
          const short = Math.max(1, l.need - (l.have ?? 0))
          const existing = nextItems.find((it) => String(it.sku).toUpperCase() === l.sku)
          if (existing) {
            const srcs = existing.sources ?? []
            if (srcs.some((s) => s.order === o.id)) continue   // already on this PO for this order → skip
            srcs.push({ order: o.id, qty: short })
            existing.sources = srcs
            existing.qty = (Number(existing.qty) || 0) + short
            existing.auto = true
            added++
          } else {
            nextItems.push({ sku: l.sku, name: l.name, qty: short, auto: true, sources: [{ order: o.id, qty: short }] })
            added++
          }
        }
        const saved = { ...po, items: nextItems }
        await savePurchaseOrder(saved)
        touched.push(saved.num)
        if (isNew) fresh.push(saved); else Object.assign(po, saved)
      }
      setPos(await getPurchaseOrders().catch(() => fresh))
      setNote(added ? `Added ${added} short blank${added === 1 ? "" : "s"} to draft PO ${touched.join(", ")}.` : `Already on ${touched.join(", ")} — nothing new to add.`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't add to a purchase order.")
    } finally {
      setPoBusy(null)
    }
  }
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
    const a = toAddrOf(o)
    setTo(a); setPasteText(addrToText(a))   // seed the single ship-to box from the order
  }
  // Buy a real label. Goes through the aggregator (Shippo/EasyPost) when one is
  // configured, falling back to USPS-direct only if none is. On success the server stores
  // tracking + the label URL and moves the order to AWAITING SCAN — buying a label is not
  // shipping it; the parcel still has to be scanned and made.
  const buyLabel = async (o: OrderRow) => {
    setLabelErr(null)
    if (orderNeedsSetup(o.items, catalog) > 0) { setLabelErr("Finish item setup (blank, colour, size, method) on every line before buying a label — we can't ship what isn't made."); return }
    if (!addrComplete(to)) { setLabelErr("Recipient needs a street, city, state and ZIP."); return }
    if (!addrComplete(from)) { setLabelErr("No warehouse 'From' address saved — set it in Settings › Platform, then try again."); return }
    setBusy(`label:${o.id}`)
    try {
      try { localStorage.setItem(FROM_STORE, JSON.stringify(from)) } catch {}
      // Persist for the whole team, not just this browser. Best-effort: a failed save
      // must not block a label that's otherwise ready to buy.
      setFactorySettings({ ship_from: from }).catch(() => {})
      // Validate the recipient before spending — a bad address is a wasted label. A failure
      // is a WARNING the user can override (validation can be down, or the USPS Addresses API
      // may still be pending approval), never a hard block.
      try {
        const v = await validateAddress({ streetAddress: to.street || "", secondaryAddress: to.street2, city: to.city || "", state: to.state || "", ZIPCode: to.zip || "" })
        if (v && !v.ok && v.error && !(await confirm({ title: "Address couldn't be verified", body: `${v.error} — buy the label anyway?`, confirmLabel: "Buy anyway" }))) return
      } catch { /* validation unavailable — proceed with the buy */ }
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
  /** The catch-up awaiting confirmation. Held rather than run, because skipping the
   *  pipeline is the one stage change nobody should make by a single click. */
  const [catchUp, setCatchUp] = useState<{ order: OrderRow; to: string; label: string } | null>(null)
  const [catchingUp, setCatchingUp] = useState(false)

  /**
   * Walk an order forward, WRITING EVERY STAGE on the way rather than jumping.
   *
   * This is the sanctioned fast path for the case the no-skip rule would otherwise make
   * painful: work that really did happen while the system wasn't watching — a backfill
   * after downtime, a same-day job that was boxed on arrival, an order a partner shipped.
   * The record still says what happened to the goods; only the click cost changes.
   *
   * Sequential ON PURPOSE. Each hop is an ordinary, individually-legal move, so the server
   * rule stays strict and needs no exemption for this path, and audit_log gets a row per
   * stage instead of one entry that says "shipped" and loses the rest. Firing them in
   * parallel would race the per-item writes inside setOrderStatus and could leave the
   * order at whichever finished last.
   */
  const runCatchUp = async () => {
    if (!catchUp) return
    const { order, to } = catchUp
    const path = stagePath(order.factory_status ?? orderStage(order.items ?? []), to)
    if (!path) { setCatchUp(null); return }
    setCatchingUp(true)
    try {
      for (const s of path) await setOrderStatus(order, s)
      setNote(`${numOf(order)} caught up to ${catchUp.label} — ${path.length} stages recorded.`)
      setCatchUp(null)
      load()
    } catch (e) {
      // Partial progress is REAL progress: the stages already written stand, and the order
      // sits wherever it got to. Say so rather than implying the whole walk rolled back.
      setActionErr(`Catch-up stopped partway: ${e instanceof Error ? e.message : "unknown error"}. The order is at whichever stage it reached.`)
    } finally { setCatchingUp(false) }
  }

  const setOrderStatus = async (o: OrderRow, to: string) => {
    setBusy(`ord:${o.id}`)
    try {
      // A hold overwrites the stage it interrupts (factory_status is one field), so before
      // holding, remember what it WAS — that's what "Resume" restores. Clear it again when
      // leaving the hold. meta is merged (the server replaces the column wholesale), so this
      // never clobbers source/note/etc.
      const prev = normalizeStage(o.factory_status ?? orderStage(o.items ?? []))
      let metaPatch: Record<string, unknown> | undefined
      if (to === "on_hold" && prev && prev !== "on_hold") {
        metaPatch = { ...(o.meta ?? {}), hold_from: prev }
      } else if (prev === "on_hold" && to !== "on_hold" && o.meta && "hold_from" in o.meta) {
        const m = { ...o.meta }; delete m.hold_from; metaPatch = m
      }
      for (const it of o.items ?? []) if (it.sku || it.line_id) { patchItem(o.id, it.sku ?? "", to, it.line_id); await postItemStatus(o.id, it.sku ?? "", to, it.line_id) }
      await updateOrder(o.id, metaPatch ? { factoryStatus: to, meta: metaPatch } : { factoryStatus: to })
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

  /**
   * Open the label TIKTOK generated for a platform-shipped order.
   *
   * Distinct from "Reopen label", which reopens a label WE bought. This one exists only in
   * TikTok's system, so it's a fetch, not a stored file. UNVERIFIED — no TikTok order has
   * synced yet, so the failure path matters more than the success path here: every error is
   * surfaced verbatim rather than collapsed to "couldn't fetch", because the first real
   * order is what tells us whether the response shape matches.
   */
  const openTiktokLabel = async (o: OrderRow) => {
    setTtLabel(o.id); setActionErr(null)
    const err = await openTiktokLabelFor(o)
    if (err) setActionErr(`Couldn't fetch the TikTok label: ${err}`)
    setTtLabel(null)
  }

  /**
   * FOUR THINGS WAITING ON THIS FLOOR — not four ways of counting the same pile.
   *
   * The old set was New / In production / Working / Shipped, and it didn't help: "New" was
   * the whole unstarted backlog (688 on a real board — a number nobody acts on), Working was
   * a SUBSET of In production so two cards moved together, and Shipped counted every order
   * ever shipped, so it only ever went up.
   *
   * Each of these is instead a queue somebody has to clear, they don't overlap, and each one
   * is exactly one filter — so the card is a button that shows you the rows it counted.
   * Everything closed (cancelled/refunded/on hold) and everything already shipped is out:
   * a cancelled order needs nothing from anyone.
   */
  const stats = useMemo(() => {
    const list = orders ?? []
    // matchesStatus, not a local predicate — the card's NUMBER and the list you land on after
    // clicking it have to be the same set. Counting "open orders needing design" while the
    // click filtered on "any order needing design" is how a card says 4 and shows you 8.
    const open = list.filter((o) => matchesStatus(o, "open"))
    return {
      pending: list.filter((o) => matchesStatus(o, "in_review")).length,
      design: open.filter((o) => orderReadiness(o).design.state !== "done").length,
      // NULL, not 0, until the catalog is in: stock resolves through it, so before it loads
      // "0 short" would be a claim we can't back. The card says which.
      short: catalog.length
        ? open.filter((o) => orderStock(o.items ?? [], catalog, stock).state === "out").length
        : null,
      scan: list.filter((o) => matchesStatus(o, "awaiting_scan")).length,
    }
  }, [orders, catalog, stock])

  /** Jump the list to what a stat card counted — and clicking the lit one clears it, the
   *  same toggle the pills use. Replaces the whole query rather than merging: a stat means
   *  "show me these", and leaving an unrelated search on would show a subset of them. */
  const jumpTo = (patch: Partial<OrderQuery>) => {
    const isOn = Object.entries(patch).every(([k, v]) => query[k as keyof OrderQuery] === v)
    setQuery(isOn ? { ...EMPTY_ORDER_QUERY } : { ...EMPTY_ORDER_QUERY, ...patch })
  }
  const jumpedTo = (patch: Partial<OrderQuery>) =>
    Object.entries(patch).every(([k, v]) => query[k as keyof OrderQuery] === v)

  // The catalog + stock map are what let the Ready filter answer its stock half: stock is
  // held against the resolved BLANK sku, not the listing's. Both are page-level (loaded for
  // every order, not per row), so filtering on them can't make rows appear as you scroll.
  const filterCtx = useMemo(() => ({ catalog, stock }), [catalog, stock])

  const filtered = useMemo(
    () => filterOrders(orders ?? [], query, filterCtx),
    [orders, query, filterCtx],
  )

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
  // Dispatchable = has a label, not yet pre-scanned, AND not already sent to the partner.
  // The last clause is the lock: an order already pushed (dispatch_pdf_id set) must not be
  // re-selectable, or you keep re-sending a label that's already out — the server skips the
  // re-push, but the row gave no sign it was already gone.
  const dispatchable = (o: OrderRow) => !!o.tracking && !o.label_scanned_at && !o.dispatch_pdf_id

  // User-reorderable / hideable DATA columns (persisted per browser). `action` is pinned
  // last and always shown; `order` can't be hidden. Read after mount (localStorage).
  const [dataColOrder, setDataColOrder] = useState<FactoryColId[]>(FACTORY_DATA_COLS)
  const [hiddenCols, setHiddenCols] = useState<FactoryColId[]>([])
  const [colsMenuOpen, setColsMenuOpen] = useState(false)
  const dragCol = useRef<FactoryColId | null>(null)
  useEffect(() => {
    const id = setTimeout(() => { setDataColOrder(loadFactoryColOrder()); setHiddenCols(loadFactoryHiddenCols()) }, 0)
    return () => clearTimeout(id)
  }, [])
  const visibleData = useMemo(() => dataColOrder.filter((id) => !hiddenCols.includes(id)), [dataColOrder, hiddenCols])
  // The full ordered column set for the grid/header: visible data columns, then the pinned action.
  const gridCols = useMemo<FactoryColId[]>(() => [...visibleData, "action"], [visibleData])

  const onColDrop = (target: FactoryColId) => {
    const src = dragCol.current
    dragCol.current = null
    if (!src || src === target) return
    const next = reorderFactoryCols(dataColOrder, src, dataColOrder.indexOf(target))
    setDataColOrder(next); saveFactoryColOrder(next)
  }
  const toggleCol = (id: FactoryColId) => {
    if (isFactoryColLocked(id)) return
    const next = hiddenCols.includes(id) ? hiddenCols.filter((x) => x !== id) : [...hiddenCols, id]
    setHiddenCols(next); saveFactoryHiddenCols(next)
  }

  /** One grid template for the header and every row. Lead tracks (caret, + checkbox when
   *  dispatch is on) precede the data columns; action is pinned last. */
  const gridTmpl = factoryGridTemplate(gridCols, dispatchOn ? 2 : 1)
  /**
   * The width this table actually WANTS, so it can scroll instead of bursting its card.
   *
   * The columns are fixed rem tracks (order-columns.ts) plus two flexible ones, and their
   * fixed part alone outgrows the card somewhere under ~1250px — the row then overflowed the
   * card's rounded edge with Customer, Items and the actions sliced off, unreachable. Page
   * zoom makes that worse in a way media queries CANNOT catch: `zoom` doesn't change the
   * viewport width the breakpoints read, so at 125% the layout still believes it has 1600px.
   *
   * So the table gets its own horizontal scroller and a min-width equal to the sum of its
   * fixed tracks (+1fr each for the two flexible ones, which is their floor). Nothing is ever
   * clipped; a narrow screen or a zoomed one scrolls sideways, which is what every dense
   * table does.
   */
  const gridMinPx = useMemo(() => {
    const lead = dispatchOn ? 1.25 + 1.5 : 1.5
    const fixed = gridCols.reduce((n, id) => {
      const g = FACTORY_COLS[id].grid
      // A plain `Nrem` track, or the FLOOR of a `minmax(Nrem, …)` one. Reading the minmax
      // floor matters: List is minmax(12rem,1fr), and treating it as the generic 5rem
      // fallback would under-report the row's real minimum by 7rem and reintroduce exactly
      // the silent horizontal overflow this figure exists to prevent.
      const rem = /^([0-9.]+)rem$/.exec(g) ?? /^minmax\(\s*([0-9.]+)rem/.exec(g)
      // minmax(0,Nfr) tracks have no intrinsic width. 5rem is a FLOOR, not a target: above it
      // Customer and Items keep absorbing the slack and truncating, which is the documented
      // trade (see order-columns.ts) and keeps a 1600px desktop scroll-free. Below it they'd
      // be unreadable, so that is where sideways scrolling takes over from squeezing — and,
      // crucially, from the silent clipping that came before.
      return n + (rem ? Number(rem[1]) : 5)
    }, lead)
    // gap-x-3 is 0.75rem between every track, and px-5 is 1.25rem of gutter each side.
    return Math.round((fixed + gridCols.length * 0.75 + 2.5) * 16)
  }, [gridCols, dispatchOn])
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

  // A machine file dropped ANYWHERE — the designer's folder, the order page, the canvas
  // dialog — pings "design-file" carrying its order id. Re-fetch that order's shared file
  // list so the Design readiness tag flips colour live, without a manual reload. The
  // board-level "orders"/"item-status" pings reload rows, not files, so they can't do
  // this on their own — which is exactly why a drop into the folder looked like it did
  // nothing. The orderId is used only to pick which order to re-query; the fetch itself
  // still goes through the access-controlled endpoint.
  useEffect(() => onLive("design-file", (e) => {
    const oid = String((e as { orderId?: string }).orderId || "")
    if (oid) loadFiles(oid, true)
  }), [loadFiles])

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
          <h1 className="font-title text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <StatGrid>
        <StatCard
          label={tl("stat", "To approve")} value={String(stats.pending)}
          sub={tl("stat", stats.pending ? "seller paid, waiting on you" : "nothing waiting")}
          tone={stats.pending ? "neg" : undefined}
          onClick={() => jumpTo({ status: "in_review" })} active={jumpedTo({ status: "in_review" })}
        />
        <StatCard
          label={tl("stat", "Need design")} value={String(stats.design)}
          sub={tl("stat", stats.design ? "no approved file yet" : "all designs approved")}
          tone={stats.design ? "neg" : undefined}
          onClick={() => jumpTo({ status: "open", ready: "design:todo" })} active={jumpedTo({ status: "open", ready: "design:todo" })}
        />
        <StatCard
          // "—" while the catalog is still loading. A 0 here would read as "nothing is
          // short", which is a different claim from "we can't tell yet".
          label={tl("stat", "Short on stock")} value={stats.short === null ? "—" : String(stats.short)}
          sub={tl("stat", stats.short === null ? "stock not loaded" : stats.short ? "can't be made yet" : "blanks on hand")}
          tone={stats.short ? "neg" : undefined}
          onClick={stats.short === null ? undefined : () => jumpTo({ status: "open", ready: "stock:out" })}
          active={jumpedTo({ status: "open", ready: "stock:out" })}
        />
        <StatCard
          label={tl("stat", "Awaiting scan")} value={String(stats.scan)}
          sub={tl("stat", stats.scan ? "labels made, not scanned" : "scan queue clear")}
          onClick={() => jumpTo({ status: "awaiting_scan" })} active={jumpedTo({ status: "awaiting_scan" })}
        />
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
        title={tl("ui", "Production queue")}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Search sits UP HERE, not in the filter row. Sharing that row with the pills
                and five dropdowns squeezed it to a stub against the right edge and made the
                whole strip read as jammed — and "find me this one order" is a header job on
                every other screen in the app anyway.
                Only once there's something to search: a search box over an empty board is a
                control that cannot do anything, and it makes "no orders yet" look like a
                failed query. */}
            {!!orders?.length && <OrderSearchInput query={query} onChange={setQuery} className="w-full sm:w-72 lg:w-80" />}
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <UploadSimple size={14} weight="bold" /> {tl("ui", "Import")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => router.push("/orders/new")}>
              <Plus size={14} weight="bold" /> {tl("ui", "New order")}
            </Button>
          </div>
        }
      >
        {/* ONE toolbar row: stage pills left, narrowing dropdowns right. Search is up in the
            card header — three kinds of control on one line is what made this read as jammed.
            Everything here is the same h-7 / text-xs metric as the chips in the rows below,
            so the toolbar reads as part of the table.
            The pills keep line one and the dropdowns take whatever is left of it. `basis` is
            the hinge: while at least ~18rem remains beside the pills the group stays on the
            row (a bar that jumps to its own row the moment it's snug puts the blank space
            straight back where it started); below that it drops to a full-width row of its
            own and reads left-to-right, rather than stacking into a narrow column hugging
            the right edge. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-2">
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {STATUS_PILLS.map((p) => {
              // A hidden pill still renders while it's the ACTIVE filter. Hiding the thing
              // that's narrowing the list leaves a board that's plainly filtered with nothing
              // on screen saying so — the exact trap the empty-state sentence exists to avoid.
              if (p.value && hiddenPills.includes(p.value) && query.status !== p.value) return null
              const on = query.status === p.value
              return (
                <button
                  key={p.value}
                  // Clicking the LIT pill clears it. A tab strip you can enter but not leave
                  // except by finding "All" is the same trap as a dropdown with no "any" row.
                  onClick={() => setQuery({ ...query, status: on ? "" : p.value })}
                  aria-pressed={on}
                  title={on && p.value ? `Showing ${p.label} only — click to clear` : undefined}
                  className={"eg-tap h-8 rounded-md px-2.5 text-sm font-medium transition-colors " + (on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                >
                  {tl("stage", p.label)}
                </button>
              )
            })}

            {/* "+" — which stages get a pill, per browser. All ten at once was a wall of
                tabs; the ones a given floor never filters by shouldn't cost row space, but
                they also shouldn't be unreachable. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Choose which status pills to show"
                title="Choose which status pills to show"
                className="eg-tap flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Plus size={14} weight="bold" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44 p-1">
                {/* Label INSIDE the Group — Base UI's Menu.GroupLabel throws outside one,
                    which blanks the whole page rather than misrendering a heading. */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-2 py-1 text-2xs text-muted-foreground">Show these pills</DropdownMenuLabel>
                  {STATUS_PILLS.filter((p) => p.value).map((p) => {
                    const shown = !hiddenPills.includes(p.value)
                    return (
                      <DropdownMenuItem
                        key={p.value}
                        // The menu closes on each pick. Re-opening between toggles is the
                        // lesser evil versus hand-rolling a popover to keep it open.
                        onClick={() => togglePill(p.value)}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Check size={12} weight="bold" className={shown ? "text-primary" : "opacity-0"} />
                        <span className="truncate">{tl("stage", p.label)}</span>
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {!!orders?.length && (
            <OrderFilterBar
              orders={orders}
              query={query}
              onChange={setQuery}
              catalog={catalog}
              className="ml-auto"
            />
          )}
        </div>

        {orders === null ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Package size={24} weight="duotone" />
            <div className="font-medium text-foreground">{tl("ui", "Nothing here")}</div>
            {/* Names what's actually narrowing the list — "no matches for OLVERA-TEES ·
                last 7 days" is recoverable, "Nothing here" over a filter you forgot you set
                is not. */}
            <div className="text-sm">{tl("ui", emptyOrdersMessage(orders.length, query, filterCtx))}</div>
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
                <span className={"text-xs font-medium " + (pushMsg.tone === "ok" ? "text-success" : "text-destructive")}>
                  {pushMsg.text}
                </span>
              )}
            </div>
          )}
          {/* THE HEADER. What the card list never had, and the reason it read as
              clutter: columns with no titles are just text at different x-positions.
              Same template as every row below, from the same list of ids. */}
          {/* ONE scroller around the header AND the rows. Two separate ones would let the
              titles drift out of line with the columns they name. */}
          <div className="overflow-x-auto">
          <div
            /* Sentence case, NOT uppercase+tracking. Same family as the stage pills a few
               pixels above (both Inter) — but 13px/medium sentence case over 11px/semibold
               UPPERCASE with letter-spacing read as two different typefaces stacked on each
               other. Uppercase plus tracking is what does that; drop the two and the row
               reads as the same face, one step quieter. The tinted bar, the muted colour and
               the smaller size are already enough to mark it as a header.
               (Deliberately NOT an app-wide sweep: `uppercase tracking-wide` is the idiom for
               section labels, the sidebar's TOOLS/ACCOUNT and the stat cards. This is the one
               place two type treatments collide inside a single control strip.) */
            className="grid items-center gap-x-3 border-b border-border bg-muted/30 px-5 py-2 text-xs font-semibold text-muted-foreground"
            style={{ gridTemplateColumns: gridTmpl, minWidth: gridMinPx }}
          >
            {dispatchOn && <span />}
            <span />
            {gridCols.map((id) =>
              id === "action" ? (
                // The pinned last column carries the Columns settings (reorder is by drag on
                // the header labels; this menu toggles which columns show).
                <div key={id} className="relative flex justify-end normal-case tracking-normal">
                  <button type="button" onClick={() => setColsMenuOpen((v) => !v)} className="rounded px-2 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="Show/hide columns">
                    Columns
                  </button>
                  {colsMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setColsMenuOpen(false)} />
                      <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-border bg-card p-1.5 shadow-lg">
                        <div className="px-2 py-1 text-2xs font-semibold text-muted-foreground">Show columns</div>
                        {FACTORY_DATA_COLS.map((cid) => {
                          const locked = isFactoryColLocked(cid)
                          const shown = !hiddenCols.includes(cid)
                          return (
                            <button key={cid} type="button" disabled={locked} onClick={() => toggleCol(cid)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs normal-case tracking-normal text-foreground transition-colors hover:bg-accent disabled:opacity-40">
                              <span className={"flex size-4 items-center justify-center rounded border " + (shown ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{shown && <Check size={11} weight="bold" />}</span>
                              {tl("col", FACTORY_COLS[cid].label)}{locked && <span className="ml-auto text-3xs text-muted-foreground">locked</span>}
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <span
                  key={id}
                  draggable
                  onDragStart={() => { dragCol.current = id }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onColDrop(id)}
                  className="cursor-grab select-none truncate"
                  title="Drag to reorder"
                >
                  {tl("col", FACTORY_COLS[id].label)}
                </span>
              )
            )}
          </div>
          <div className="divide-y divide-border" style={{ minWidth: gridMinPx }}>
            {paged.pageItems.map((o) => {
              const items = o.items ?? []
              const stage = orderStage(items)
              const allShipped = items.length > 0 && items.every((it) => normalizeStage(it.factory_status) === "shipped")
              const units = items.reduce((n, it) => n + (Number(it.qty) || 1), 0)
              const label = labels[o.id]
              const track = label?.trackingNumber || o.tracking
              const isCollapsed = !expandedIds.has(o.id)
              // Data cells keyed by column id, so the row can render them in the user's saved
              // order. JSX is IDENTICAL to before — only relocated here. `action` stays inline
              // below (pinned last), so its large action logic is untouched.
              const cell: Record<FactoryColId, ReactNode> = {
                status: <span className="justify-self-start"><StageBadge status={stage} /></span>,
                order: <div className="min-w-0 truncate font-mono text-sm font-semibold">{numOf(o)}</div>,
                tracking: (
                  <div className="flex min-w-0 items-center gap-1.5">
                    {track ? (
                      <a href={trackUrl(o.carrier || label?.carrier, track)} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 font-mono text-xs font-medium text-success hover:underline" title={`${o.carrier || label?.carrier || "USPS"} ${track}`}>
                        <span className="truncate">{track}</span><ArrowSquareOut size={9} weight="bold" className="shrink-0" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    )}
                    {/* The parcel came from TikTok, so its LABEL did too — and this is where
                        someone looks for it. Fetched on demand (it lives in TikTok's system,
                        not ours), which is also why it's an icon beside the number rather
                        than a link: there is no URL until it's asked for. */}
                    {canFetchTiktokLabel(o) && (
                      <button
                        type="button"
                        onClick={() => openTiktokLabel(o)}
                        disabled={ttLabel === o.id}
                        title="Open the shipping label TikTok generated for this order"
                        aria-label="Open TikTok label"
                        className="eg-tap shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                      >
                        {ttLabel === o.id
                          ? <CircleNotch size={12} className="animate-spin" />
                          : <FileArrowDown size={12} weight="bold" />}
                      </button>
                    )}
                  </div>
                ),
                store: (
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{o.store || platformOf(o)}</div>
                    <div className="truncate text-xs text-muted-foreground">{platformOf(o)} · {fmtDate(o.created_at)}</div>
                  </div>
                ),
                customer: <div className="min-w-0 truncate text-sm font-medium">{o.customer?.name || "—"}</div>,
                items: (
                  <div className="flex min-w-0 items-center gap-2.5">
                    {items.length > 0 && <PhotoStack items={items} designs={designs[o.id]} catalog={catalog} max={3} overlap />}
                    <div className="min-w-0">
                      <div className="truncate text-sm">{itemsLabel(o)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {items.length} item{items.length === 1 ? "" : "s"} · {units} unit{units === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                ),
                ready: (
                  <div className="flex flex-wrap items-center gap-1">
                    <ReadinessStrip order={o} designs={designs[o.id]} files={dfiles[o.id]} />
                    <StockChip order={o} items={items} catalog={catalog} stock={stock} canPO={canPO} sending={poBusy === o.id} onSend={sendToPO} />
                  </div>
                ),
                action: null, // rendered inline below, pinned last
              }
              return (
                <div key={o.id} className="p-5">
                  {/* Growing the identity block to fill the row was the first fix for the
                      dead middle, and it is not enough on a wide screen: justify-between
                      still spends every spare pixel BETWEEN the two children, so at 1920 the
                      identity ended at x≈654 and the actions began at x≈1454 — 800px of
                      nothing between an order and the buttons that act on it.

                      So: no justify-between, and the identity sizes to its content under a
                      ceiling rather than filling the row. The actions sit immediately after
                      it, and the leftover space collects at the END of the row, where it
                      separates nothing. The ceiling is the width the identity already took
                      at 1440 (where this always read fine), so narrower screens are
                      unchanged and only the surplus on a wide screen is reclaimed.

                      The identity line is a grid, not a wrap: order number, customer and
                      the rest land on the same x-position in every row, so the eye can run
                      down a column instead of re-reading each row. Wide things (photos,
                      address, tracking) stay in the full-width strip below, where they have
                      room — which is why this isn't a strict table. */}
                  {/* THE ROW, as columns. One grid template, shared with the header above
                      the list (factoryGridTemplate), so a cell cannot exist in the header
                      and not the row or land under the wrong title.

                      This was a card: identity stacked over a wrapped meta line, with the
                      actions flung to the far side. Three passes tried to make that read as
                      a table — clustering, then a grid on the identity line alone, then
                      flex-1 — and each was a refinement of the wrong shape. The seller
                      table has been a real table all along; this is the same idea, driven
                      from the same lib/order-columns.ts. */}
                  <div className="mb-3 grid items-center gap-x-3 gap-y-1" style={{ gridTemplateColumns: gridTmpl }}>
                    {/* A box on EVERY row, disabled where it can't be used. Rendering it
                        only on dispatchable rows reads as a half-built feature: most orders
                        have no label yet, so most rows had no box, and a column that appears
                        on a minority of rows looks broken rather than selective. */}
                    {dispatchOn && (
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        disabled={!dispatchable(o)}
                        onChange={() => toggleOne(o.id)}
                        aria-label={dispatchable(o)
                          ? `Select ${numOf(o)} for dispatch`
                          : `${numOf(o)} can't be dispatched — ${o.label_scanned_at ? "already pre-scanned" : o.dispatch_pdf_id ? "already sent to the partner" : "no label bought yet"}`}
                        title={dispatchable(o) ? undefined
                          : o.label_scanned_at
                            ? "Already pre-scanned — its tracking is live."
                            : o.dispatch_pdf_id
                              ? "Already sent to the dispatch partner — waiting on their scan. Re-sending does nothing."
                              : "No label bought yet, so there's nothing for the partner to scan."}
                        className="size-4 shrink-0 rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    )}
                    <button
                      onClick={() => toggleCollapse(o.id)}
                      aria-expanded={!isCollapsed}
                      aria-label={isCollapsed ? `Expand ${numOf(o)}` : `Collapse ${numOf(o)}`}
                      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <CaretRight size={13} weight="bold" className={"transition-transform " + (isCollapsed ? "" : "rotate-90")} />
                    </button>

                    {/* DATA COLUMNS — rendered in the user's saved order (drag/hide via the
                        header). Cells are defined above; the action cluster stays pinned
                        immediately after this, always last. */}
                    {visibleData.map((id) => <Fragment key={id}>{cell[id]}</Fragment>)}

                    {/* One PRIMARY action for the current stage/role; everything rarer
                        (flag/status, labels, the non-primary of ship/advance) tucks into a
                        ⋯ menu so the row isn't a wall of buttons. */}
                    {/* Shipped orders keep the ⋯ menu (so admin can still Refund) — the old
                        "✓ Shipped" badge REPLACED the whole action cluster, hiding it. The
                        menu greys every stage except Refunded for a shipped order. */}
                    {(() => {
                      /**
                       * EVERY stage is listed; the ones this role can't use from here are
                       * disabled and carry the reason.
                       *
                       * Filtering them out made the rule unlearnable — an option that is
                       * simply absent looks the same as one that doesn't exist, so nobody
                       * could tell "you may not" from "there is no such thing", and the
                       * menu's length changed per row for no visible cause. The refusal
                       * text is the SERVER's own sentence (stageDenialReason mirrors
                       * stageDenial), so what the tooltip says is what the API would say.
                       */
                      const withReason = (list: typeof FACTORY_STAGES) =>
                        list.map((s) => {
                          const deny = stageDenialReason(role, stage, s.id)
                          // A skip this role could legally WALK isn't refused outright — it
                          // becomes a catch-up, behind a confirmation. Every other refusal
                          // stands: canWalk requires each intermediate hop to be permitted,
                          // so an operator can't reach Shipped by calling it a catch-up.
                          return { ...s, deny, walk: !!deny && canWalk(role, stage, s.id) }
                        })
                      const prod = withReason([{ id: "", label: "Draft", tone: "new" as const }, ...FACTORY_STAGES])
                      const exc = withReason(EXCEPTION_STAGES)
                      /**
                       * A STOPPED order has no obvious next move — that is what stopping it
                       * meant.
                       *
                       * flagged/on_hold is the andon cord: someone pulled it deliberately
                       * because this order must not proceed until a human decides. But the
                       * primary action never consulted the stage — canShip asked only
                       * "is this role allowed to fulfil, and is the ship panel closed?" —
                       * so a flagged order presented "Create new label" as the obvious next
                       * step, in primary colour, exactly where every moving order shows its
                       * go-button. The stop was visible in the badge and contradicted by
                       * the loudest control on the row.
                       *
                       * The server does NOT gate this: /api/shipping/label takes an address
                       * and a parcel and never looks at factory_status, so buying that
                       * label would have SUCCEEDED. Nothing here is defence-in-depth; it is
                       * the only thing standing between a stopped order and a bought label.
                       *
                       * Nothing is taken away. Every stage remains in the ⋯ menu, so the way
                       * forward is the honest one: resolve the stop, then ship.
                       */
                      const stopped = isException(stage)
                      // A fully-shipped order offers no ship/advance — the only move is Refund,
                      // via the stage list below. So no "Create new label" primary or menu item.
                      const canShip = canFulfill && shipOpen !== o.id && !stopped && !allShipped
                      /**
                       * No next stage means no Next-stage button.
                       *
                       * `nextStage()` returns null once an order is shipped OR stopped —
                       * there genuinely is no linear step from an exception, which is the
                       * point of one. The `?? ""` fallback here quietly turned that null
                       * into "advance to Received", so a flagged order offered "Next stage"
                       * and warehouse/admin passed the permission check (moving to "" is
                       * not a money stage). It only surfaced once the ship button stood
                       * down and the primary fell through to advance.
                       *
                       * Asking canSetStage about a target that does not exist can only
                       * produce a wrong answer, so the existence of the step is checked
                       * first and the permission second.
                       */
                      const next = nextStage(stage)
                      const canAdvance = !!next && canSetStage(role, stage, next)
                      const canStart = canFulfill && stage === "" && !stopped
                      const canLabels = canFulfill && items.some((it) => it.sku && variantOf(it))
                      // Primary = the one obvious next move. Intake → Start; ready → ship;
                      // otherwise advance a stage.
                      const primary: "start" | "ship" | "advance" | null =
                        canStart ? "start" : canShip ? "ship" : canAdvance ? "advance" : null
                      const busyO = busy?.startsWith(o.id)
                      return (
                        <div className="flex items-center justify-end gap-2 sm:shrink-0">
                          {/* Buttons hug the RIGHT edge (justify-end), aligned with the
                              header's Columns control above — the action column is fixed, so
                              left-aligning left an awkward gap before the row padding.
                              Carrier delivery status was removed: tracking rides Shippo + the
                              pipeline stage, so a "No carrier update" chip on every row was
                              noise, not information. */}
                          {/* SAYS the row is stopped, rather than just going blank where
                              every other row has a button. A missing control and a broken
                              one look identical; this names which it is, and points at the
                              ⋯ menu that resolves it. Muted, not primary — it is a state,
                              not something to click. */}
                          {stopped && (() => {
                            const norm = normalizeStage(stage)
                            const stLabel = stageMeta(norm)?.label || "On hold"
                            // On hold remembers the stage it interrupted (meta.hold_from), so
                            // it offers a one-click "Back to <that stage>" — clear how to come
                            // off hold. Without a stored prior (an old hold), fall back to ⋯.
                            const holdFrom = norm === "on_hold" ? (o.meta?.hold_from as string | undefined) : undefined
                            const backLabel = holdFrom != null ? (stageMeta(holdFrom)?.label || "Draft") : null
                            return (
                              <span className="inline-flex shrink-0 items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                                  <Warning size={13} weight="fill" /> {stLabel}
                                </span>
                                {norm === "on_hold" && (backLabel != null ? (
                                  <Button
                                    size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
                                    disabled={busy === `ord:${o.id}`}
                                    onClick={() => setOrderStatus(o, holdFrom!)}
                                    title={`Take this order off hold and return it to ${backLabel}`}
                                  >
                                    <ArrowUUpLeft size={12} weight="bold" /> Back to {backLabel}
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">resolve in ⋯</span>
                                ))}
                              </span>
                            )
                          })()}
                          {primary === "start" && <Button size="sm" onClick={() => receiveOrder(o)} disabled={busyO}>{tl("ui", "Start order")}</Button>}
                          {primary === "ship" && <Button size="sm" onClick={() => openFulfill(o)}>{tl("ui", "Create new label")}</Button>}
                          {primary === "advance" && <Button size="sm" onClick={() => advanceOrder(o)} title="Move every item one step further.">{tl("ui", "Next stage")}</Button>}
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label={tl("ui", "More actions")}
                              disabled={busy === `ord:${o.id}`}
                              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-card px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                            >
                              <DotsThree size={18} weight="bold" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              {/* the non-primary pipeline actions */}
                              <DropdownMenuItem onClick={() => router.push(`/orders/${encodeURIComponent(o.id)}`)}><ArrowSquareOut size={14} weight="bold" /> {tl("ui", "Open order")}</DropdownMenuItem>
                              {primary !== "advance" && canAdvance && <DropdownMenuItem onClick={() => advanceOrder(o)}><SkipForward size={14} weight="fill" /> {tl("ui", "Next stage")}</DropdownMenuItem>}
                              {primary !== "ship" && canShip && <DropdownMenuItem onClick={() => openFulfill(o)}><Truck size={14} weight="bold" /> {tl("ui", "Create new label")}</DropdownMenuItem>}
                              {label && <DropdownMenuItem onClick={() => openLabel(label)}><Printer size={14} weight="bold" /> {tl("ui", "Reopen label")}</DropdownMenuItem>}
                              {/* TikTok orders can be shipped on TIKTOK'S label, which lives
                                  only in Seller Center — so it's fetched on demand, not a
                                  file we hold. Shown for any TikTok order rather than gated
                                  on the shipping type: orders synced before that field was
                                  recorded have no type stored, and the server answers with
                                  the actual reason ("no package on TikTok yet") which is
                                  more use than a hidden menu item. */}
                              {canFetchTiktokLabel(o) && (
                                <DropdownMenuItem disabled={ttLabel === o.id} onClick={() => openTiktokLabel(o)}>
                                  {ttLabel === o.id
                                    ? <CircleNotch size={14} className="animate-spin" />
                                    : <FileArrowDown size={14} weight="bold" />}
                                  {ttLabel === o.id ? tl("ui", "Fetching…") : tl("ui", "TikTok label")}
                                </DropdownMenuItem>
                              )}
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
                                    <Barcode size={14} weight="bold" /> {tl("ui", "Print blank labels")}
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
                                    <DropdownMenuLabel>{tl("ui", "Set all items to")}</DropdownMenuLabel>
                                    {prod.map((s) => (
                                      <DropdownMenuItem
                                        key={s.id || "new"}
                                        disabled={(!!s.deny && !s.walk) || normalizeStage(stage) === s.id}
                                        title={s.walk
                                          ? `Records every stage up to ${s.label} — asks first`
                                          : s.deny ?? (normalizeStage(stage) === s.id ? "Already at this stage" : undefined)}
                                        onClick={() => {
                                          if (s.walk) { setCatchUp({ order: o, to: s.id, label: s.label }); return }
                                          if (!s.deny) setOrderStatus(o, s.id)
                                        }}
                                      >
                                        {tl("stage", s.label)}
                                        {/* Marked, so a catch-up is never mistaken for an
                                            ordinary one-step move before it's clicked. */}
                                        {s.walk && <span className="ml-auto text-3xs text-muted-foreground">{tl("ui", "catch up")}</span>}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuGroup>
                                </>
                              )}
                              {exc.length > 0 && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuGroup>
                                    <DropdownMenuLabel>{tl("ui", "Flag / hold")}</DropdownMenuLabel>
                                    {exc.map((s) => (
                                      <DropdownMenuItem
                                        key={s.id}
                                        disabled={!!s.deny}
                                        title={s.deny ?? undefined}
                                        onClick={() => { if (!s.deny) setOrderStatus(o, s.id) }}
                                      >
                                        {tl("stage", s.label)}
                                      </DropdownMenuItem>
                                    ))}
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
                      <div>
                        {/* Ship to — ONE paste box that parses itself. Ship-from is the saved
                            warehouse address (Settings › Platform), so it isn't shown or edited
                            here. The address is validated live — see the badge by the header. */}
                        <div className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ship to</div>
                          {/* Live validation status sits INSIDE the box, bottom-right. */}
                          <div className="relative">
                            <textarea
                              value={pasteText}
                              onChange={(e) => {
                                setPasteText(e.target.value)
                                const { name, addr } = parseBlock(e.target.value)
                                setTo({ name: name || "", street: addr.street || "", street2: addr.street2 || "", city: addr.city || "", state: addr.state || "", zip: addr.zip || "" })
                              }}
                              rows={4}
                              placeholder={"Sara Fetterhoff\n230 Trails End Rd\nBeach Lake, PA 18405"}
                              className="w-full rounded-lg border border-border bg-card px-3 pb-8 pt-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                            />
                            <div className="pointer-events-none absolute bottom-2 right-2.5">
                              {addrCheck.status === "checking" && <span className="inline-flex items-center gap-1 rounded-full bg-card/90 px-1.5 py-0.5 text-2xs text-muted-foreground"><CircleNotch size={12} className="animate-spin" /> Checking…</span>}
                              {addrCheck.status === "valid" && <span className="inline-flex items-center gap-1 rounded-full bg-card/90 px-1.5 py-0.5 text-2xs font-medium text-success"><CheckCircle size={12} weight="fill" /> Validated</span>}
                              {addrCheck.status === "invalid" && <span className="inline-flex items-center gap-1 rounded-full bg-card/90 px-1.5 py-0.5 text-2xs font-medium text-amber-700" title={addrCheck.msg || undefined}><Warning size={12} weight="fill" /> {addrCheck.msg ? "Couldn't verify" : "Not found"}</span>}
                            </div>
                          </div>
                          <p className="text-3xs text-muted-foreground">Name, street, then City, ST ZIP — the label uses exactly this. Ship-from is your saved warehouse address (Settings › Platform).</p>
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
                        {/* No ml-auto. This button buys a label FROM the five fields to its
                            left, so flinging it to the far edge (x≈1655, 846px past the
                            last field at 1920) separated it from its own inputs. It reads
                            as the end of the form now, because it is. */}
                        {(() => {
                          // Can't ship what can't be made: block the label while any line still
                          // needs its blank / colour / size / method picked.
                          const unset = orderNeedsSetup(o.items, catalog)
                          return (
                            <Button size="sm" onClick={() => buyLabel(o)} disabled={busy === `label:${o.id}` || unset > 0}
                              title={unset > 0 ? `${unset} item${unset === 1 ? "" : "s"} still ${unset === 1 ? "needs" : "need"} setup — pick every variant before buying a label.` : undefined}>
                              {busy === `label:${o.id}` ? <CircleNotch size={14} className="animate-spin" /> : <><Printer size={14} weight="bold" /> Buy USPS label</>}
                            </Button>
                          )
                        })()}
                      </div>

                      {(() => {
                        const unset = orderNeedsSetup(o.items, catalog)
                        return unset > 0 ? (
                          <div className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-2xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                            <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
                            <span>{unset} item{unset === 1 ? "" : "s"} still {unset === 1 ? "needs" : "need"} a blank, colour, size &amp; method — finish setup before shipping.</span>
                          </div>
                        ) : null
                      })()}

                      {/* Dim-weight packaging suggestion for this parcel (÷166) — the box guidance,
                          shown right under the dimensions it reasons about. */}
                      <PackagingHint weightOz={pkg.weightOz} length={pkg.length} width={pkg.width} height={pkg.height} />

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
                              <div className="mt-1 text-3xs text-muted-foreground">{ADDRESS_SOURCE_LABEL[addressSource(o)]}</div>
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
                      // wrap on mobile (the actions drop to their own full-width line),
                      // NOWRAP from sm up. With flex-wrap a content-sized identity WRAPS
                      // rather than shrinks, so at 1440 a long line name pushed the actions
                      // onto a second row. nowrap makes the identity give up width instead,
                      // which is what truncate is already there for.
                      return (
                        <div key={it.line_id ?? it.sku ?? i} className="relative flex flex-wrap items-start gap-x-4 gap-y-2 rounded-xl border border-border p-2.5 sm:flex-nowrap">
                          {/* Shows the blank with its artwork placed — what actually gets
                              made — not the marketplace listing photo. Editing is offered
                              only to the roles whose job it is; warehouse gets the zoom.

                              The zoom control used to sit HERE as its own button, ahead of
                              the image — it took layout space in front of the thing it
                              describes and pushed the artwork off its position. It now
                              overlays the image corner on hover (below), so it costs no
                              space and stays where the image already is. */}
                          <div className="group/art relative shrink-0 self-start">
                          {/* size: tall enough to span the whole identity block when the
                              variant picker is open — title, the BLANK/COLOUR/SIZE/METHOD
                              strip and its hint — instead of a small square floating beside
                              three rows of text. Rows WITHOUT the picker are only a title and
                              a chip strip, so they keep 64: sizing those to the tall case
                              would add back the empty band this is meant to remove. */}
                          <ItemAvatar
                            item={it}
                            designs={designs[o.id]}
                            catalog={catalog}
                            size={canDesign && stage === "" ? 104 : 64}
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
                          {/* FILLS the row, like the seller's item row does — and for the
                              reason that row already documents: putting the secondary
                              controls above the variants "frees the whole width for the
                              variant strip, which was being squeezed into whatever the
                              price left over."

                              This column was content-sized with a floor and a ceiling, to
                              stop the actions drifting away from short line names. It did
                              that, but it also stopped the BLANK/COLOUR/SIZE/METHOD strip
                              ever reaching full length: the fields bunched left and left
                              ~540px of nothing before the Board button, so the row read as
                              two unrelated halves. Alignment is now the row's job — it is
                              items-start, so the actions sit level with the TITLE and the
                              strip runs the full width underneath them. */}
                          <div className="min-w-0 flex-1">
                            {/* Title reserves height + right room on desktop for the controls,
                                which are lifted to the top-right corner (position: absolute)
                                so the variant strip below can run the FULL width of the row. */}
                            <div className="truncate text-sm font-medium sm:min-h-8 sm:pr-[15rem]">{it.name || it.sku || "Item"}</div>
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
                                <VariantStrip sku={resolveProduct(it, catalog)?.sku || it.blank || undefined} color={it.color} size={it.size} method={it.print_type} marketplace={it.variant} />
                                {it.qty ? <span className="text-2xs text-muted-foreground">×{it.qty}</span> : null}
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
                                // The full stock number lives HERE in the detail (the row just
                                // carries the coloured status pill). When a line is short and
                                // already on a purchase order, name that PO so the warehouse can
                                // see it's handled without leaving the row.
                                const onPO = have != null && have < need
                                  ? pos.find((p) => (p.items ?? []).some((pi) => String(pi.sku).toUpperCase() === skuU && (pi.sources ?? []).some((s) => s.order === o.id)))
                                  : null
                                const cones = (threads[o.id] ?? []).find((t) => String(t.sku).toUpperCase() === skuU)?.threads ?? []
                                const file = (dfiles[o.id] ?? []).find((f) => String(f.sku ?? "").toUpperCase() === skuU)
                                if (have == null && !cones.length && !file) return null
                                // One uniform pill language for the line's make-spec, matching
                                // the Label/Scan/Design + Stock pills above: same rounded-md
                                // px-2 py-0.5 shape, tinted by meaning. Stock is purple when
                                // there's enough, amber when short (with the PO it's on); the
                                // thread + file pills are neutral info, not status.
                                const pill = "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-medium"
                                return (
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                    {have != null && (
                                      <span
                                        className={pill + " " + (have >= need ? "bg-primary/10 text-primary" : "bg-amber-100 text-amber-800")}
                                        title={have >= need ? "Enough blank stock for this line" : `Only ${have} in stock, this line needs ${need}${onPO ? ` — on PO ${onPO.num}` : ""}`}
                                      >
                                        {have >= need ? `${have} in stock` : `Short — ${have} of ${need}`}{onPO ? ` · ${onPO.num}` : ""}
                                      </span>
                                    )}
                                    {cones.length > 0 && (
                                      // Mini-swatches + count in a neutral pill; click opens the
                                      // map of which cone covers which part of the artwork.
                                      <ThreadBreakdown artwork={artworkFor(o, it)}>
                                        <span className={pill + " bg-muted text-muted-foreground hover:bg-muted/80"} title={`${cones.length} thread colour${cones.length === 1 ? "" : "s"} matched — click for the cone map`}>
                                          <span className="flex items-center -space-x-0.5">
                                            {cones.slice(0, 8).map((c) => (
                                              <span key={c.code} className="size-2.5 rounded-full border border-black/10" style={{ background: c.hex }} />
                                            ))}
                                          </span>
                                          {cones.length} thread{cones.length === 1 ? "" : "s"}
                                        </span>
                                      </ThreadBreakdown>
                                    )}
                                    {file && (
                                      <span className={pill + " bg-muted font-mono text-muted-foreground"} title={`Machine file ${file.name ?? ""} · ${file.designId}`}>
                                        <FileArrowDown size={10} weight="bold" /> {file.designId}
                                      </span>
                                    )}
                                  </div>
                                )
                              })()}
                              </>
                            )}
                          </div>
                          <div className="mt-2 flex w-full flex-wrap items-center gap-2 sm:absolute sm:right-2.5 sm:top-2.5 sm:z-10 sm:mt-0 sm:w-auto">
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
                                : sent.has(key) ? <><CheckCircle size={13} weight="fill" className="text-success" /> {tl("ui", "Sent")}</>
                                : <><PaperPlaneTilt size={13} weight="bold" /> {tl("ui", "Board")}</>}
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
                            //
                            // This inherits the no-skipping rule for free, because
                            // stageOptionsFor now asks stageDenialReason: a stage more than
                            // one step ahead simply isn't offered, so the per-item control
                            // can't be used to jump the pipeline that the ⋯ menu refuses.
                            // It keeps FILTERING rather than greying, unlike that menu — a
                            // native <option> has nowhere to put the reason, and a greyed
                            // line you can't interrogate is worse than a shorter list.
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
                                  className="eg-select h-8 shrink-0 rounded-lg border border-border bg-card px-1.5 text-xs font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                  aria-label={`Flag ${it.name || it.sku}`}
                                  title="The warehouse has this item. You can still stop it if the artwork is wrong."
                                >
                                  <option value="">{tl("ui", "Flag…")}</option>
                                  {exc.map((s) => <option key={s.id} value={s.id}>{tl("stage", s.label)}</option>)}
                                </select>
                              </>
                            )
                            return (
                              <select
                                value={normalizeStage(it.factory_status)}
                                onChange={(e) => advanceItem(o, it, e.target.value)}
                                disabled={busy === key}
                                className={"eg-select h-8 shrink-0 rounded-lg border px-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 " + (isException(it.factory_status) ? "border-red-300 bg-red-50 text-red-700" : "border-border bg-card hover:border-primary/40")}
                                aria-label={`Status for ${it.name || it.sku}`}
                                title="Set this item's status — forward or back"
                              >
                                <optgroup label={tl("ui", "Production")}>
                                  {prod.map((s) => <option key={s.id || "new"} value={s.id}>{tl("stage", s.label)}</option>)}
                                </optgroup>
                                {exc.length > 0 && (
                                  <optgroup label={tl("ui", "Exceptions")}>
                                    {exc.map((s) => <option key={s.id} value={s.id}>{tl("stage", s.label)}</option>)}
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
          </div>{/* /overflow-x-auto */}
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

      {/* THE CONFIRMATION. Skipping the pipeline is the one status change that should
          never happen on a single click, so it names the order, the destination and every
          stage about to be written — and says plainly that this records the work as done
          rather than merely moving a label. */}
      <Dialog open={!!catchUp} onOpenChange={(v) => { if (!v && !catchingUp) setCatchUp(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Catch up to {catchUp?.label}?</DialogTitle>
          </DialogHeader>
          {catchUp && (() => {
            const from = catchUp.order.factory_status ?? orderStage(catchUp.order.items ?? [])
            const path = stagePath(from, catchUp.to) ?? []
            return (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  {numOf(catchUp.order)} is at <span className="font-medium text-foreground">{stageMeta(normalizeStage(from))?.label ?? "Draft"}</span>.
                  {" "}This records <span className="font-medium text-foreground">{path.length} stages</span>, in order:
                </p>
                <ol className="space-y-1 rounded-lg border border-border bg-muted/30 p-3">
                  {path.map((s, i) => (
                    <li key={s || "new"} className="flex items-center gap-2 text-sm">
                      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-primary/10 text-3xs font-medium text-primary">{i + 1}</span>
                      {stageMeta(s)?.label ?? s}
                    </li>
                  ))}
                </ol>
                {/* The honest warning. Every stage here is a claim about what physically
                    happened to the goods, and this writes all of them at once. */}
                <p className="text-xs text-amber-700">
                  Each stage is a record that the work was done. Only catch up when it really was —
                  the floor and the seller both read this as what happened.
                </p>
              </div>
            )
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatchUp(null)} disabled={catchingUp}>Cancel</Button>
            <Button onClick={() => void runCatchUp()} disabled={catchingUp}>
              {catchingUp ? <><CircleNotch size={14} className="animate-spin" /> Recording…</> : `Record all stages`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-center text-xs text-muted-foreground">Stages: {FACTORY_STAGES.map((s) => s.label).join(" → ")}</p>

    </div>
  )
}
