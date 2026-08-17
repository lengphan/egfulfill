"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { onLive } from "@/lib/live"
import { useRouter } from "next/navigation"
import { Package, Plus, UploadSimple, CircleNotch, Truck, Printer, Warning, ArrowSquareOut, SkipForward, PaperPlaneTilt, FileArrowDown, Barcode, DotsThree, CaretRight, TrayArrowDown, X, Check, BookmarkSimple } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { StageBadge } from "@/components/app/stage-badge"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/app/confirm-dialog"
import { pushToDispatch, getDispatchStatus, getOrders, postItemStatus, updateOrder, getDesignCards, saveDesignCards, buyUspsLabel, getDesignReuse, reuseDesignFile, getFactorySettings, setFactorySettings, getCatalogProducts, getOrderThreads, getOrderDesigns, indexDesigns, designForLine, postOrderDesign, getDesignFiles, getInventory, addInventoryItem, getPurchaseOrders, savePurchaseOrder, resolveSuppliers, setOrderRush, type OrderRow, type OrderItem, type DesignCard, type ShipAddress, type UspsLabelResult, type CatalogProduct, type OrderThreadRow, type DesignFileRow, type OrderDesign, type ReuseMatch, type PurchaseOrder } from "@/lib/api"
import { orderReadiness } from "@/lib/order-readiness"
import { orderStock, stockSkuOf } from "@/lib/stock-status"
import { getToken, getUser } from "@/lib/auth"
import { labelableOrders, buyLabelsFor, summarise, releaseLabelBlobs, DEFAULT_BULK_PARCEL } from "@/lib/bulk-labels"
import { packetHtml, printHtmlViaIframe } from "@/lib/label-packet"
import { VariantPicker } from "@/components/app/variant-picker"
import { resolveProduct, orderNeedsSetup } from "@/lib/variant-resolve"
import { isApprovable } from "@/components/app/approve-order-button"
import { VariantStrip } from "@/components/app/variant-field"
import { FACTORY_COLS, factoryGridTemplate, FACTORY_DATA_COLS, loadFactoryColOrder, saveFactoryColOrder, loadFactoryHiddenCols, saveFactoryHiddenCols, reorderFactoryCols, type FactoryColId } from "@/lib/order-columns"
import { useIsNarrow } from "@/lib/use-narrow"
import { FactoryColumnsMenu } from "@/components/app/factory-columns-menu"
import { FACTORY_STAGES, EXCEPTION_STAGES, normalizeStage, nextStage, orderStage, isException, isMoneyStage, stageOptionsFor, canSetStage, stageDenialReason, canWalk, stagePath, stageMeta, isFactoryOrder, lineProgress } from "@/lib/factory-status"
import { setInternalNote } from "@/lib/api"
import { printPackingSlips } from "@/lib/packing-slip"
import { OrderedVariant } from "@/components/app/ordered-variant"
import { numOf, platformOf, variantOf, itemsLabel, addrLine, fmtDate, trackUrl, decodeEntities } from "@/lib/order-format"
import { clickableProps } from "@/lib/a11y"
import { OrderFilterBar, OrderSearchInput, emptyOrdersMessage } from "@/components/app/order-filter-bar"
import { canFetchTiktokLabel, openTiktokLabelFor } from "@/lib/tiktok-label"
import { filterOrders, matchesStatus, isRush, isOverdue, DEFAULT_OVERDUE_DAYS, EMPTY_ORDER_QUERY, STATUS_PILLS, loadHiddenStatusPills, saveHiddenStatusPills, type OrderQuery } from "@/lib/order-filter"
import { usePaged, Pagination } from "@/components/app/pagination"
import { LabelSheet } from "@/components/app/label-sheet"
import { AddItemDialog } from "@/components/app/inventory-view"
import { ThreadBreakdown } from "@/components/app/thread-breakdown"
import { ReadinessStrip, CHIP_TONE } from "@/components/app/readiness-dots"
import { useT, useLabelT } from "@/lib/i18n"
import { ImportOrdersDialog } from "@/components/app/import-orders-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { ItemAvatar } from "@/components/app/item-avatar"
import { PhotoStack } from "@/components/app/photo-stack"
import { DesignCanvasDialog } from "@/components/app/design-canvas"
import { NewLabelDialog } from "@/components/app/new-label-dialog"

const nowId = () => Date.now()
// Not on the floor yet — the spec can still be set.
const NOT_STARTED = ["", "new", "draft", "in_review"]

/**
 * HOW MANY OF THIS BLANK WE HOLD — on the line, at every stage.
 *
 * The number existed and rendered in only one of the two branches below: the one shown
 * AFTER a blank is picked. So it was missing from the only stage where someone is deciding
 * which blank to use, which is precisely when "do we have any" decides the answer. Both
 * branches render this now.
 *
 * FACTORY ONLY. Stock is a fact about our shelves, not about the seller's order — and
 * /api/inventory is requireStaff, so a seller's `stock` map is empty and the pill silently
 * would not render. That is accidental safety, not a gate: one route change and a seller
 * reads "Short — 0 of 5" on their own order. The caller passes `show` explicitly.
 *
 * The three no-answer cases are NAMED rather than blank, because "we hold none" and "nobody
 * has told me which blank this is" are opposite instructions to the person reading it
 * (CLAUDE.md §4). Stock is held against the BLANK sku, so an unpicked line has no key to
 * look up — it is not a stock problem, it is a setup one.
 */
function LineStock({ item, catalog, stock, pos, orderId, show, onTrack }: {
  item: OrderItem
  catalog: CatalogProduct[]
  stock: Record<string, number>
  /** Open POs, so a short line can name the one it is already on. */
  pos: PurchaseOrder[]
  orderId: string
  show: boolean
  /** Opens the inventory dialog for an untracked blank. Absent on surfaces that cannot add
   *  one (a seller's own view), where the chip stays a plain statement. */
  onTrack?: (sku: string) => void
}) {
  if (!show) return null
  /**
   * THE KEY THE SHELF IS ACTUALLY UNDER — stockSkuOf, not a private re-derivation.
   *
   * This read `resolveProduct(...).sku` alone: the PRODUCT's key, never the variant's. So a
   * line for a Red L/XL cap was answered by a lookup for the whole style, and a shelf
   * counted per colourway — which is how stock is held, and what an order line names — came
   * back undefined and printed "Not tracked" on a blank somebody had just added.
   *
   * stock-status.ts owns that ladder (colour+size, then size, then the style) and the boards
   * and the shortage queue already run on it. A second copy here is the exact failure §5
   * names: three private copies of one resolver, disagreeing the moment one is touched.
   */
  const blankSku = stockSkuOf(item, catalog, stock)
  // Nothing before a blank is chosen: it sits beside Qty now, and stock against no blank is
  // not a fact about stock.
  if (!blankSku) return null
  const have = stock[String(blankSku).toUpperCase()]
  if (have == null) {
    /**
     * NO ROW YET IS A SETUP STATE, SO IT IS THE WAY OUT OF ITSELF.
     *
     * It cannot print 0: we do not hold zero of this blank, we hold no OPINION about it —
     * nobody has put it on the inventory list, and "0" would send someone to reorder
     * something that may be sitting on a shelf. The two readings are opposite instructions.
     *
     * So it offers the fix: the same Add-to-inventory dialog the Inventory page uses, seeded
     * with this blank's sku. Once the row exists the chip becomes a real count — 0 if that is
     * what it is, which by then is a fact rather than a guess.
     *
     * THE FIX, NOT THE DIAGNOSIS. "Not tracked" named a state of our own setup and left the
     * reader to work out that it was theirs to fix — and it is a state that should not
     * survive being looked at, because the answer is one click: file the row.
     *
     * Nothing at all for anyone who cannot file it. A seller does not keep our shelf, so a
     * grey chip about our inventory list is a fact about us on a screen about their order.
     */
    return onTrack ? (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onTrack(blankSku) }}
        className="font-medium text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
        title={`${blankSku} has no inventory row yet — click to add it`}
      >
        Add to inventory
      </button>
    ) : null
  }
  const need = Number(item.qty) || 1
  const enough = have >= need
  // Only a SHORT line needs to name a purchase order — saying "on PO-X" beside a full shelf
  // is noise about a document nobody is waiting on.
  const skuU = String(blankSku).toUpperCase()
  const poNum = enough ? null : pos.find((p) => (p.items ?? []).some(
    (pi) => String(pi.sku).toUpperCase() === skuU && (pi.sources ?? []).some((s) => s.order === orderId)
  ))?.num ?? null
  /**
   * THREE READINGS, and the shortest wording each one can have.
   *
   * "Short — 0 of 1" spent eleven characters restating the quantity column beside it to say
   * one thing: none. An empty shelf is the only state that has to stop somebody, so it is
   * the only one that shouts — a red 0, no sentence. Everything else is a number you glance
   * at: "Stock: 4" reads the same whether the line needs one or three, and the tone carries
   * whether it is enough.
   *
   *   0            red     nothing on the shelf
   *   Stock: 4     amber   some, but fewer than this line needs
   *   Stock: 40    purple  enough
   */
  const none = have <= 0
  /**
   * A DETAIL, IN THE SAME SHAPE AS THE DETAILS BESIDE IT.
   *
   * This was a tinted pill sitting on a line that reads "Listing SKU: LA10-POCKET · Qty 1" —
   * a badge among labels, which made a number you glance at look like a status you have to
   * act on. It is "Stock: 0" now, label and value exactly like Qty, and only the VALUE
   * carries the colour: red at nothing, amber when there is some but not enough, plain when
   * the shelf covers the line. The tone is the alarm; the format is the row's.
   */
  return (
    <span
      title={none
        ? `None of ${blankSku} on the shelf — this line needs ${need}${poNum ? ` — on PO ${poNum}` : ""}`
        : enough
          ? `${have} of ${blankSku} on the shelf — this line needs ${need}`
          : `Only ${have} of ${blankSku} in stock, this line needs ${need}${poNum ? ` — on PO ${poNum}` : ""}`}
    >
      <span className="font-medium text-foreground/70">Stock:</span>{" "}
      <span className={none
        ? "font-semibold text-red-600 dark:text-red-400"
        : enough
          ? "text-foreground"
          : "font-semibold text-amber-700 dark:text-amber-400"}>
        {have}
      </span>
      {poNum ? <span className="text-muted-foreground"> · {poNum}</span> : null}
    </span>
  )
}

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
  const { state, why } = orderStock(items, catalog, stock)
  // Same solid-tinted pill as the Label/Scan/Design chips beside it (readiness-dots.tsx):
  // purple = ready/in-stock, amber = needs action/out, grey = unknown. The colour IS the
  // status, and it recomputes every render — so picking a blank on a line flips it live. The
  // per-line NUMBERS live in the expanded detail, not here, to keep the row a clean pill.
  // The literal same strings the three chips beside it use — imported, not re-typed, so a
  // tone can never drift between the fourth pill and the other three.
  const tone = state === "in" ? CHIP_TONE.done : state === "out" ? CHIP_TONE.doing : CHIP_TONE.todo
  // Always "Stock" — it used to say "In stock" / "No stock" / "Stock", which broke the one
  // rule the three chips beside it keep (see readiness-dots.tsx): a chip whose text changes
  // row to row can't be compared down a column, and it was the widest thing in the cell for
  // a word the colour already carries. The state is in the tone and the hover.
  const label = "Stock"
  const clickable = state === "out" && canPO
  const title = state === "in" ? "Blank stock is on hand for every line"
    : state === "out" ? (canPO ? "Short on blank stock — click to add to a draft purchase order. Open the order for the per-line breakdown." : "Short on blank stock — open the order for the per-line breakdown")
    // GREY NOW SAYS WHICH LINK IS MISSING. It used to read "not tracked, or no blank picked
    // yet — open the order to check", which is three guesses and an errand: the chip knows
    // exactly which of the three it is, and saying so is the difference between a dead pill
    // and one telling you what to fix.
    : (why || "Blank stock not tracked yet — open the order to check")
  return (
    <button
      type="button"
      disabled={!clickable || sending}
      onClick={clickable ? () => onSend(order) : undefined}
      title={title}
      // MATCHES THE THREE CHIPS BESIDE IT, exactly — text-2xs and px-1.5, not text-xs and
      // px-2 (see the Tag in readiness-dots.tsx). Sitting in the same row a size larger and
      // a notch wider, "Stock" read as a different KIND of thing from Label/Scan/Design
      // when it is the fourth of the same set.
      className={"eg-tap inline-flex shrink-0 items-center whitespace-nowrap rounded px-1.5 py-0.5 text-2xs font-medium transition-colors " + tone + (clickable ? " cursor-pointer" : " cursor-default")}
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
/** Identity of ONE line. Two lines of the same SKU on an order (same product, different
 *  personalisation) are different jobs, so the sku alone is not an identity — keying on it
 *  made "send to board" flip every sibling line to Sent at once. */
/** One prior deliverable. Fuzzy hits carry how far off they are, so "similar" is never
 *  presented with the same confidence as "identical". */
function MatchRow({ m, similar, onUse }: { m: ReuseMatch; similar?: boolean; onUse?: () => void }) {
  const t = useT()
  const tl = useLabelT()
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
          {m.distance === 0 ? tl("ui", "near-identical") : t("ui.bitsDifferent", { n: m.distance })}
        </span>
      )}
      {onUse && (
        <Button size="sm" variant="outline" className="shrink-0" onClick={onUse} title={tl("ui", "Copy this file onto this order")}>
          {tl("ui", "Use this file")}
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
/**
 * Age as ONE token — `0h`, `4h`, `3d`, `6w`, `1y` — because it sits in a 4rem column beside
 * the order number and is read by scanning DOWN, not across. Every value is therefore a
 * number and a unit, including the first hour: it used to read "new", which was the only
 * word in a column of measurements and broke the shape the eye is following. "This just
 * landed" is already said twice over on the row — by the status pill and by the order's
 * position in the sort — so the column can stay a ruler.
 *
 * Weeks, not months, between 14 and 60 days: a floor asks "how many weeks has this been
 * sitting?" and "2mo" rounds away the difference between 5 and 8 weeks, which is exactly
 * the range where someone has to decide whether to chase it.
 */
function ageOf(iso: string | null | undefined): string {
  if (!iso) return "—"
  const t = new Date(iso).getTime()
  if (isNaN(t)) return "—"
  const mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 60) return "0h"
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)}w`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  const yrs = (days / 365).toFixed(days < 730 ? 1 : 0)
  return `${yrs}y`
}


/**
 * The factory's private note on an order — staff to staff.
 *
 * Saves on blur rather than per keystroke: this is a scratchpad someone types a sentence
 * into while doing something else, and a PATCH per character would put the order's audit
 * trail under a paragraph of noise.
 *
 * The seed is a prop, and the field is keyed by order id at the call site, so switching
 * rows shows that row's note rather than the last one's.
 */
function InternalNote({ orderId, value }: { orderId: string; value: string }) {
  const [text, setText] = useState(value)
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const save = async () => {
    if (text === value && state !== "error") return
    setState("saving")
    try { await setInternalNote(orderId, text); setState("saved") }
    catch { setState("error") }
  }
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-2">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">Factory note</span>
        <span className="text-3xs text-muted-foreground">
          {state === "saving" ? "saving…" : state === "saved" ? "saved" : state === "error" ? "couldn't save" : "staff only"}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); if (state !== "idle") setState("idle") }}
        onBlur={save}
        rows={2}
        placeholder="e.g. re-hooping, waiting on navy thread…"
        className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs leading-relaxed"
      />
    </div>
  )
}

export function OrdersHub() {
  const router = useRouter()
  const t = useT()
  const tl = useLabelT()
  const role = getUser()?.role || ""
  const isAdmin = role === "admin"
  // Any non-seller. Mirrors isStaff() on the server, which is the boundary that actually
  // matters — this only decides whether the control is worth rendering.
  const isStaff = !!role && role !== "seller"
  const canFulfill = role === "warehouse" || isAdmin // receive (intake) + ship
  // Artwork review. NB: this no longer implies "set any status" — stage changes are
  // gated per-role by stageOptionsFor/canSetStage, and the server enforces it.
  const canDesign = role === "operator" || isAdmin // send to designer
  /**
   * WHO MAY CHANGE WHAT WE MAKE, AND UNTIL WHEN.
   *
   * A synced factory order arrives with nothing picked, and somebody has to pick it — that
   * is the operator's job, so locking them out left those orders unmakeable. What must not
   * happen is a spec changing under a job already being made.
   *
   * So: operator and admin while the order has not started; admin alone once it is working,
   * because by then the change is a correction someone has to own. Warehouse never — their
   * zone starts at the parcel.
   */
  const canPickVariants = isAdmin || role === "operator"
  // Only warehouse/admin may write purchase orders (mirrors requireWarehouse on the server),
  // so only they get the actionable amber "send to PO" — operators see the status read-only.
  const canPO = isAdmin || role === "warehouse"

  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  // ONE narrowing state: the stage pills, the search box and every dropdown all write into
  // it. They used to be two — a `filter` string for the pills and a query for the rest —
  // which meant "Shipped" and a Status dropdown could hold contradictory answers, and the
  // empty-state sentence could only ever name one of them.
  const [query, setQuery] = useState<OrderQuery>(EMPTY_ORDER_QUERY)
  const [overdueDays, setOverdueDays] = useState<number>(DEFAULT_OVERDUE_DAYS)
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
  // Per-order production detail the floor needs but the board never showed: matched
  // thread cones, machine files, and how much of the blank we actually have. Fetched
  // lazily per order (on expand) so a 50-order page doesn't make 150 requests.
  const [threads, setThreads] = useState<Record<string, OrderThreadRow[]>>({})
  const [dfiles, setDfiles] = useState<Record<string, DesignFileRow[]>>({})
  const [stock, setStock] = useState<Record<string, number>>({})
  /** The blank an order line wants put on the inventory list. Null = the dialog is closed. */
  const [trackSku, setTrackSku] = useState<string | null>(null)
  // Draft/placed POs, so the stock chip's hover can show "already on PO #x" and the
  // send-to-PO action can append to an existing draft rather than mint a new one each click.
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [poBusy, setPoBusy] = useState<string | null>(null)  // order id being sent to a PO
  /**
   * "Also put this on the other lines?" — offered AFTER a drop has landed on one line,
   * never before. Asking first would make every single-line drop answer a question it
   * doesn't have; offering after means the common case (this line only) costs nothing and
   * the bulk case is one click, with the artwork already visible so you can see what you
   * are about to copy.
   */
  const [applyAll, setApplyAll] = useState<{ order: OrderRow; item: OrderItem; data: string; siblings: OrderItem[] } | null>(null)
  const [applyAllBusy, setApplyAllBusy] = useState(false)
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

  // A push that would duplicate work already done. Held until a human decides, because
  // the alternative — silently reusing, or silently re-digitising — is wrong either way.
  const [reuse, setReuse] = useState<{ order: OrderRow; item: OrderItem; exact: ReuseMatch[]; similar: ReuseMatch[] } | null>(null)
  const threadsRef = useRef<Record<string, boolean>>({})
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const toggleCollapse = (id: string) =>
    setExpandedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })



  // ── Label buy (USPS-direct) ──
  const [labels, setLabels] = useState<Record<string, UspsLabelResult>>({})
  // Barcode labels for an order's blanks — only lines whose variant is actually
  // defined, since a label for an unchosen blank is a mislabelled box.
  const [barcodeOrder, setBarcodeOrder] = useState<OrderRow | null>(null)

  // A read that FAILED is not an empty board. Both used to end at setOrders([]), so a dead
  // API — or a deploy mid-flight — rendered as "Nothing here / no orders yet", which is the
  // one thing this codebase's own rule forbids: if a thing can't be READ versus doesn't
  // EXIST, say which. Someone then goes looking for their missing orders instead of for the
  // outage.
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const load = useCallback(() => {
    if (!getToken()) { setOrders([]); setLoadErr(null); return }
    getOrders()
      .then((rows) => { setOrders(rows ?? []); setLoadErr(null) })
      .catch((e) => { setOrders([]); setLoadErr(e instanceof Error ? e.message : "Couldn't reach the server.") })
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
  // Board settings. The warehouse ship-from used to be read here for the in-row label
  // form; the label dialog reads it itself now, so only the board's own setting is left.
  useEffect(() => {
    const id = setTimeout(() => {
      getFactorySettings().then((s) => {
        // Admin-set age threshold. Falls back to the shared default so a settings failure
        // shows a plausible Overdue count rather than none at all.
        const d = Number((s as { overdue_days?: number } | null)?.overdue_days)
        if (Number.isFinite(d) && d > 0) setOverdueDays(d)
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
    // line_id is line identity; the sku can be NULL on a marketplace line. Gating on sku
    // alone left exactly those lines unmovable by the control that exists to move them.
    if (!item.sku && !item.line_id) return
    const key = lineKey(order, item)
    setBusy(key)
    patchItem(order.id, item.sku ?? "", to, item.line_id)
    try {
      const r = await postItemStatus(order.id, item.sku ?? "", to, item.line_id)
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
  /**
   * START — the one move that puts an order into production, whoever it belongs to.
   *
   * This was three buttons wearing three names for the same act: "Start order" on a Draft
   * row, "Approve" on the order page, and "Next stage" on a Pending row (which advanced to
   * Awaiting scan — the same thing again, described as a position rather than a decision).
   * Nothing distinguished them but the stage the order happened to be sitting at.
   *
   * It writes the LINES and then the ORDER. Both are needed: nothing rolls item stages up
   * to `orders.factory_status` — that column has exactly one writer, this PATCH — so moving
   * only the lines left the order reading `new` while its rows read Awaiting scan. The hub
   * row looked right (it derives its stage from the items) and the Dispatch board, which
   * filters on the ORDER's column, never showed it.
   *
   * Keyed by line_id with `sku ?? ""`, not gated on the sku: a marketplace line can arrive
   * with a NULL one, and the old intake skipped exactly those lines — so an Etsy order
   * could be "started" with half of it left behind.
   */
  const startOrder = async (order: OrderRow) => {
    setBusy(`ord:${order.id}`)
    try {
      for (const it of order.items ?? []) {
        if (it.sku || it.line_id) await postItemStatus(order.id, it.sku ?? "", "working", it.line_id)
      }
      await updateOrder(order.id, { factoryStatus: "working" })
      setActionErr(null)
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : "Couldn't start that order.")
    } finally { setBusy(null); load() }
  }
  // Ship: mark every line shipped + record tracking/carrier on the order.
  // Open the fulfill panel for an order — prefill recipient from the order address.
  /** Open the label window on this order. Everything it needs — ship-to, the parcel,
   *  the rates — the dialog works out from the order itself. */
  const openFulfill = (o: OrderRow) => setShipOpen(o.id)
  // Buy a real label. Goes through the aggregator (Shippo/EasyPost) when one is
  // configured, falling back to USPS-direct only if none is. On success the server stores
  // tracking + the label URL and moves the order to AWAITING SCAN — buying a label is not
  // shipping it; the parcel still has to be scanned and made.
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
    const path = stagePath(order.factory_status ?? orderStage(order.items ?? []), to, isFactoryOrder(order))
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
        const r = await getDesignReuse(o.id, it.sku, it.line_id)
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
    const ctx = { overdueDays }
    const overdue = list.filter((o) => matchesStatus(o, "overdue", ctx))
    // Late-and-blocked is split out because it is a DIFFERENT PERSON'S problem. The floor
    // can't start an order with no blanks, so counting it in the number they act on trains
    // them to ignore the number. Purchasing is the audience that can move it.
    const blocked = catalog.length
      ? overdue.filter((o) => orderStock(o.items ?? [], catalog, stock).state === "out").length
      : 0
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
    return {
      // "New" = arrived, nothing started. The one number where a rise means work to pick up
      // rather than work going wrong.
      fresh: list.filter((o) => matchesStatus(o, "draft")).length,
      overdue: overdue.length,
      overdueBlocked: blocked,
      // TODAY, not ever. A lifetime shipped count is a number nobody acts on; today's is
      // throughput, and it resets, so it can be read as good or bad at a glance.
      //
      // Dated by shipped_at, falling back to updated_at. Neither is a true ship moment —
      // shipped_at has no writer in the status paths and is backfilled FROM updated_at — so
      // this is really "moved to shipped and not touched since". An order edited after it
      // shipped counts again today. Fine for throughput; don't build a KPI on it.
      shippedToday: list.filter((o) => {
        if (orderStage(o.items ?? []) !== "shipped") return false
        const raw = o.shipped_at ?? o.updated_at
        const t = raw ? new Date(raw).getTime() : NaN
        return Number.isFinite(t) && t >= midnight.getTime()
      }).length,
      // NULL, not 0, until the catalog is in: stock resolves through it, so before it loads
      // "0 short" would be a claim we can't back. The card says which.
      short: catalog.length
        ? open.filter((o) => orderStock(o.items ?? [], catalog, stock).state === "out").length
        : null,
    }
  }, [orders, catalog, stock, overdueDays])

  const rushCount = useMemo(() => (orders ?? []).filter(isRush).length, [orders])

  /**
   * Flag or clear a rush. Optimistic, because this is a queue hint rather than a state
   * change — waiting on a round trip to reorder a list makes people click twice, and the
   * server is idempotent so a double-click costs nothing. Reverted on failure so the row
   * never keeps a flag the server refused.
   */
  const toggleRush = async (o: OrderRow) => {
    const next = !isRush(o)
    setOrders((prev) => (prev ?? []).map((x) => (x.id === o.id ? { ...x, rush: next } : x)))
    try {
      const r = await setOrderRush(String(o.id), next)
      if (r.error) throw new Error(r.error)
      setNote(next ? `${numOf(o)} marked as rush.` : `Rush cleared on ${numOf(o)}.`)
    } catch (e) {
      setOrders((prev) => (prev ?? []).map((x) => (x.id === o.id ? { ...x, rush: !next } : x)))
      setActionErr(e instanceof Error ? e.message : "Couldn't change the rush flag.")
    }
  }

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
  const filterCtx = useMemo(() => ({ catalog, stock, overdueDays }), [catalog, stock, overdueDays])

  /**
   * WHAT ORDER THE QUEUE IS IN — newest first, and the exceptions live in their own pills.
   *
   * This used to float every overdue-and-workable order above everything else, on the
   * reasoning that late work waiting only on sequencing is the whole point of surfacing
   * overdue at all. That reasoning holds for a handful of late orders. It did not hold
   * here: 708 orders sat in `new` and only 61 were under a week old, so ~600 permanently
   * late rows owned the top of the list and today's work landed past row 600. The board
   * read as frozen while the sync was working perfectly — which is exactly what was
   * reported, and it took a database query to disprove.
   *
   * So:
   *   ALL, and every stage pill  — NEWEST FIRST. What arrived today is what you see.
   *   OVERDUE                    — MOST LATE FIRST, measured against the SHIP-BY DATE
   *                                where the marketplace gave us one and against age
   *                                where it didn't. Sorting an overdue list by age would
   *                                put a 30-day order promised for next week above a
   *                                3-day one that was due yesterday — the older row is
   *                                not the later one. That ordering is useful precisely
   *                                because nothing has been resolved.
   *
   * RUSH IS NOT PINNED EITHER, and it has its own pill. It was the last exception — kept
   * on the argument that a human asked for it one order at a time — but the argument for
   * newest-first does not have an exception in it: either the top of the list is what
   * arrived most recently or it is a place things get promoted to, and a list that is
   * sometimes one and sometimes the other cannot be read at a glance. A rushed order is
   * still marked on its row and still one click away on the Rush pill, which is how every
   * other platform handles a flag: a marker plus a view, never a sort override.
   */
  /**
   * Click-to-sort, on top of the default. Null means "the default order" — a real state,
   * not `age/desc` dressed up, so a third click on a column returns the list to how it
   * opened rather than stranding you in an order you have to undo by hand.
   */
  const [sort, setSort] = useState<{ key: FactoryColId; dir: "asc" | "desc" } | null>(null)
  const toggleSort = (id: FactoryColId) => setSort((s) =>
    s?.key !== id ? { key: id, dir: "asc" } : s.dir === "asc" ? { key: id, dir: "desc" } : null)

  const filtered = useMemo(() => {
    const list = filterOrders(orders ?? [], query, filterCtx)
    const at = (o: OrderRow) => String(o.created_at ?? "")
    const newestFirst = (a: OrderRow, b: OrderRow) => at(b).localeCompare(at(a))

    /**
     * NEWEST FIRST EVERYWHERE, including Overdue.
     *
     * Overdue used to sort most-late-first, on the reasoning that a list should be ordered
     * by the thing that put each row on it. That reasoning is sound and the result was
     * still wrong: the tab opened on five-year-old drafts. The oldest thing on an overdue
     * list is not the most urgent, it is the most abandoned — nothing is going to ship it
     * today — so the head of the list was permanently occupied by rows nobody would act on,
     * and the orders that just went late sat where no one looks.
     *
     * That ordering is not gone, it is now a click: Age ascending is oldest-first. Which is
     * the general rule here — the DEFAULT is the same on every tab so the top of the list
     * always means the same thing, and any other order is something you asked for.
     */
    const cmp: Partial<Record<FactoryColId, (a: OrderRow, b: OrderRow) => number>> = {
      // Age sorts on the timestamp, not the rendered token: `6w` and `1y` are strings, and
      // comparing them puts 1y before 6w. Ascending = youngest, matching the column's name.
      age: (a, b) => at(b).localeCompare(at(a)),
      order: (a, b) => String(numOf(a)).localeCompare(String(numOf(b)), undefined, { numeric: true }),
      status: (a, b) => orderStage(a.items ?? []).localeCompare(orderStage(b.items ?? [])),
      store: (a, b) => platformOf(a).localeCompare(platformOf(b)),
      customer: (a, b) => (a.customer?.name ?? "").localeCompare(b.customer?.name ?? ""),
      // Blank tracking sorts last in BOTH directions — "not shipped yet" is the absence of
      // a value, so letting it lead one direction would hand half the sorts an empty screen.
      tracking: (a, b) => {
        const x = a.tracking ?? "", y = b.tracking ?? ""
        if (!x !== !y) return x ? -1 : 1
        return x.localeCompare(y)
      },
      items: (a, b) => (a.items ?? []).reduce((n, it) => n + (Number(it.qty) || 1), 0)
                     - (b.items ?? []).reduce((n, it) => n + (Number(it.qty) || 1), 0),
      // The Items column sorts on the same figure it prints — biggest orders first, which
      // is how a floor picks what to batch.
      units: (a, b) => (a.items ?? []).reduce((n, it) => n + (Number(it.qty) || 1), 0)
                     - (b.items ?? []).reduce((n, it) => n + (Number(it.qty) || 1), 0),
    }

    const chosen = sort && cmp[sort.key]
    if (chosen) {
      const signed = sort.dir === "desc" ? (a: OrderRow, b: OrderRow) => -chosen(a, b) : chosen
      // Ties fall back to newest-first rather than to input order, so re-sorting on a column
      // most rows share (Status, Store) doesn't shuffle them differently every render.
      return [...list].sort((a, b) => signed(a, b) || newestFirst(a, b))
    }
    return [...list].sort(newestFirst)
  }, [orders, query, filterCtx, sort])

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
  // (Show/hide now lives in FactoryColumnsMenu on the toolbar, which owns the locked-column
  // rule and persistence via the onOrder/onHidden callbacks below.)

  /** One grid template for the header and every row. Lead tracks (caret, + checkbox when
   *  dispatch is on) precede the data columns; action is pinned last. */
  const gridTmpl = factoryGridTemplate(gridCols, dispatchOn ? 2 : 1)

  /*
   * PHONE LAYOUT. The desktop row is ten fixed tracks that demand 1224px, so on a 390px
   * screen you scrolled sideways three times to read one order — and the checkbox and the
   * actions sat at opposite ends of that journey.
   *
   * Same cells, same data, different shape: below md the row becomes a two-column card
   * (label, value) carrying only what identifies an order on a phone. Everything else stays
   * one tap away in the order itself, which is where you were going anyway.
   *
   * Driven from the SAME `cell` map as the table — a separate mobile renderer would be a
   * second place for "what does Status mean", and those drift.
   */
  const narrow = useIsNarrow()
  const NARROW_COLS: FactoryColId[] = ["order", "status", "age", "units"]
  const rowCols = useMemo(
    () => (narrow ? visibleData.filter((id) => NARROW_COLS.includes(id)) : visibleData),
    // NARROW_COLS is a module-level constant in spirit; listing it would only churn the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [narrow, visibleData],
  )
  const rowTmpl = narrow ? "auto auto minmax(0,1fr) auto" : gridTmpl
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

  // No minWidth on a phone: that figure is precisely what forces the sideways scroll, and a
  // stacked row has no need of it.
  const rowMinPx = narrow ? undefined : gridMinPx
  /**
   * SELECTION IS NEUTRAL; ACTIONS ARE OPINIONATED.
   *
   * The checkbox used to be enabled only on dispatchable rows, which made sense when Send to
   * dispatch was the only bulk action — and became a cage the moment there were others: an
   * order with no label could not be ticked, so it could never be given the very action that
   * buys it one.
   *
   * So anything can be selected, and each action filters what it can actually do and NAMES
   * what it skipped. That is the honest split: the checkbox does not know which button you
   * are about to press.
   */
  const selectableOnPage = paged.pageItems
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
  /**
   * BUY POSTAGE FOR EVERY SELECTED ORDER, then print the lot as one job.
   *
   * The selection can include drafts — a draft is an order nobody has started, not an order
   * that isn't real, and its parcel still has to go out. What decides eligibility is whether
   * we hold an address, which is checked BEFORE any money moves so the confirm can name what
   * will actually be bought rather than the number of ticked boxes.
   *
   * The parcel is uniform for the batch, which is what makes it a batch; anything unusual
   * goes through the label dialog on its own.
   */
  const [buying, setBuying] = useState<{ done: number; total: number } | null>(null)
  const doBulkLabels = async () => {
    const chosen = (orders ?? []).filter((o) => selected.has(o.id))
    const { ready, blocked } = labelableOrders(chosen)
    if (!ready.length) {
      setPushMsg({ tone: "err", text: blocked.length
        ? `Nothing to buy — ${blocked.length} skipped, first is ${blocked[0].reason}.`
        : "Nothing selected that needs a label." })
      return
    }
    // Naming the count and the money BEFORE spending it. A bulk button that quietly charges
    // a card is the one thing this flow must never be.
    const go = await confirm({
      title: `Buy ${ready.length} label${ready.length === 1 ? "" : "s"}?`,
      body: `This charges real postage for ${ready.length} parcel${ready.length === 1 ? "" : "s"}`
        + (blocked.length ? `, and skips ${blocked.length} with no address or an existing label` : "")
        + ". Labels and packing slips print together afterwards.",
      confirmLabel: `Buy ${ready.length}`,
      destructive: false,
    })
    if (!go) return

    setBuying({ done: 0, total: ready.length }); setPushMsg(null)
    try {
      /**
       * A PARCEL PER ORDER, not one guess for all of them.
       *
       * This shipped hardcoding 6oz in a 13x10x1 mailer for every order in the batch, while
       * the single-label dialog beside it derives weight and box from the catalog via
       * parcelFromOrder. So a batch containing a hoodie was declared as a tee — and USPS does
       * not refuse an under-declared parcel, it carries it and bills the difference
       * afterwards, against a batch already charged. Silent, and only visible on the invoice.
       *
       * The stock mailer stays the FALLBACK for a line whose product carries no weight or
       * box, which is what the dialog does too.
       */
      const results = await buyLabelsFor(ready, DEFAULT_BULK_PARCEL,
        (done: number, total: number) => setBuying({ done, total }), catalog)
      const printable = results.filter((r) => r.ok && r.labelBlobUrl)
        .map((r) => ({ labelBlobUrl: r.labelBlobUrl as string, order: r.order }))
      let msg = summarise(results, blocked)
      if (printable.length) {
        // Through an iframe, not a popup: by the time a batch of labels is bought the click
        // that started it is minutes old and window.open would be blocked silently.
        const { html, skipped } = await packetHtml(printable)
        await printHtmlViaIframe(html)
        if (skipped.length) msg += ` · ${skipped.length} couldn't be printed (${skipped.join(", ")})`
      }
      // The packet holds its own rendered copies now, so the source blobs are finished with.
      // Left un-revoked they pin one label PDF each until the tab closes.
      releaseLabelBlobs(results)
      setPushMsg({ tone: results.some((r) => !r.ok) || blocked.length ? "err" : "ok", text: msg })
      setSelected(new Set())
      load()
    } catch (e) {
      setPushMsg({ tone: "err", text: e instanceof Error ? e.message : "Couldn't buy those labels." })
    } finally { setBuying(null) }
  }

  /**
   * PACKING SLIPS FOR THE SELECTION. The safest bulk action there is — it reads what is
   * already on screen, spends nothing, changes nothing, and can be repeated. Open to any
   * staff role for that reason.
   */
  const doBulkSlips = () => {
    const chosen = (orders ?? []).filter((o) => selected.has(o.id))
    if (!chosen.length) return
    const msg = printPackingSlips(chosen)
    if (msg) setPushMsg({ tone: "err", text: msg })
  }

  /**
   * START EVERY SELECTED ORDER — the same move as pressing Start on one row, done to many.
   *
   * Gated by canSetStage per order, exactly like the single button, so this cannot advance
   * an order the role is not allowed to advance. Anything refused is COUNTED and named
   * rather than silently dropped: a bulk action that says "12 started" when it started nine
   * is worse than one that refuses outright.
   */
  const doBulkStart = async () => {
    const chosen = (orders ?? []).filter((o) => selected.has(o.id))
    const ready = chosen.filter((o) => canSetStage(role, normalizeStage(o.factory_status ?? orderStage(o.items ?? [])), "working", isFactoryOrder(o)))
    if (!ready.length) {
      setPushMsg({ tone: "err", text: "None of those can be started from where they are." })
      return
    }
    setPushing(true); setPushMsg(null)
    const results = await Promise.all(ready.map((o) =>
      updateOrder(o.id, { factoryStatus: "working" }).then(() => true).catch(() => false)))
    const ok = results.filter(Boolean).length
    const skipped = chosen.length - ready.length
    setPushMsg({
      tone: ok === chosen.length ? "ok" : "err",
      text: `${ok} started`
        + (ok < ready.length ? ` · ${ready.length - ok} failed` : "")
        + (skipped ? ` · ${skipped} skipped (not startable from their stage)` : ""),
    })
    setSelected(new Set()); setPushing(false); load()
  }

  /**
   * SEND THE SELECTED LABELS TO THE DISPATCH PARTNER.
   *
   * This used to set factory_status='working' and report "sent to the dispatch board",
   * which is not what it said: moving an order to Working is Start, and after Start was
   * added as its own bulk action the two buttons did the identical thing under different
   * names. Two controls with one behaviour is how somebody presses the wrong one.
   *
   * It now calls the push the dispatch board itself uses. That needs a bought label —
   * there is nothing for the partner to scan otherwise — and an order already pre-scanned
   * or already sent is excluded, because re-sending a label that is out does nothing and
   * the row gives no sign it went twice.
   */
  const doPush = async () => {
    const chosen = (orders ?? []).filter((o) => selected.has(o.id))
    const ready = chosen.filter(dispatchable)
    if (!ready.length) {
      setPushMsg({ tone: "err", text: "None of those can be dispatched — they need a bought label that hasn't been sent yet." })
      return
    }
    setPushing(true); setPushMsg(null)
    try {
      const r = await pushToDispatch(ready.map((o) => o.id))
      if (r.error) throw new Error(r.error)
      const failed = (r.results ?? []).filter((x: { ok?: boolean }) => !x.ok)
      const skipped = chosen.length - ready.length
      setPushMsg({
        tone: failed.length || skipped ? "err" : "ok",
        // Their words verbatim: byeastside don't document error codes, so what came back is
        // the only thing that helps.
        text: `${r.pushed ?? ready.length - failed.length} sent to the partner`
          + (failed.length ? ` · ${failed.length} failed — ${failed[0].error ?? "unknown error"}` : "")
          + (skipped ? ` · ${skipped} skipped (no label, or already sent)` : ""),
      })
      setSelected(new Set())
      load()
    } catch (e) {
      setPushMsg({ tone: "err", text: e instanceof Error ? e.message : "Couldn't send those to the partner." })
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

  const subtitle = tl("ui", isAdmin
    ? "Every order across the team — production to shipping."
    : canFulfill ? "Receive, pack, and ship orders out the door."
      : "Review artwork and drive orders through production.")

  return (
    <div className="space-y-4">
      {/* Mobile-only: the top bar names the page on desktop, so the hero would just
          duplicate it there. On mobile the top bar is hidden, so the hero IS the title. */}
      <div className="flex items-center gap-3 md:hidden">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Package size={18} weight="fill" /></span>
        <div>
          <h1 className="font-title text-2xl font-semibold tracking-tight">{tl("nav", "Orders")}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <StatGrid>
        <StatCard
          label={tl("stat", "New")} value={String(stats.fresh)}
          sub={tl("stat", stats.fresh ? "arrived, not started" : "nothing waiting to start")}
          onClick={() => jumpTo({ status: "draft" })} active={jumpedTo({ status: "draft" })}
        />
        {/* The only card whose number SHOULD be small. `sub` names how many of them are
            blocked on stock, because that share isn't the floor's to fix — pretending one
            number covers both audiences is how an overdue count gets ignored. */}
        <StatCard
          // Both of these interpolate, so they go through t() with a var — a template
          // literal can never match a useLabelT key, which is why this card's title and
          // its blocked-count caption were the two that stayed English.
          label={t("stat.overdueLabel", { days: overdueDays })} value={String(stats.overdue)}
          sub={stats.overdue
            ? (stats.overdueBlocked ? t("stat.waitingOnStock", { n: stats.overdueBlocked }) : tl("stat", "all workable now"))
            : tl("stat", "nothing late")}
          tone={stats.overdue ? "neg" : undefined}
          onClick={() => jumpTo({ status: "overdue" })} active={jumpedTo({ status: "overdue" })}
        />
        <StatCard
          label={tl("stat", "Shipped today")} value={String(stats.shippedToday)}
          sub={tl("stat", "since midnight")}
        />
        <StatCard
          // "—" while the catalog is still loading. A 0 here would read as "nothing is
          // short", which is a different claim from "we can't tell yet".
          label={tl("stat", "Out of stock")} value={stats.short === null ? "—" : String(stats.short)}
          sub={tl("stat", stats.short === null ? "stock not loaded" : stats.short ? "can't be made yet" : "blanks on hand")}
          tone={stats.short ? "neg" : undefined}
          onClick={stats.short === null ? undefined : () => jumpTo({ status: "open", ready: "stock:out" })}
          active={jumpedTo({ status: "open", ready: "stock:out" })}
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
          <button onClick={() => setNote(null)} className="shrink-0 font-medium text-muted-foreground underline underline-offset-2">{tl("ui", "Dismiss")}</button>
        </div>
      )}
      {actionErr && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <Warning size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span className="flex-1">{actionErr}</span>
          <button onClick={() => setActionErr(null)} className="shrink-0 font-medium underline underline-offset-2">{tl("ui", "Dismiss")}</button>
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
                  {/* A COUNT, so you know whether it's worth going in. Only on the two pills
                      where the number is the point — a badge on every pill is a row of
                      numbers nobody reads, and "Overdue 0" is as useful as "Overdue 12". */}
                  {(p.value === "overdue" || p.value === "rush") && (
                    <span className={"ml-1.5 rounded-full px-1.5 py-0.5 text-2xs font-semibold tabular-nums " + (
                      on ? "bg-primary-foreground/20"
                        : p.value === "overdue" && stats.overdue ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {p.value === "overdue" ? stats.overdue : rushCount}
                    </span>
                  )}
                </button>
              )
            })}

            {/* "+" — which stages get a pill, per browser. All ten at once was a wall of
                tabs; the ones a given floor never filters by shouldn't cost row space, but
                they also shouldn't be unreachable. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Choose which status pills to show"
                title={tl("ui", "Choose which status pills to show")}
                className="eg-tap flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Plus size={14} weight="bold" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44 p-1">
                {/* Label INSIDE the Group — Base UI's Menu.GroupLabel throws outside one,
                    which blanks the whole page rather than misrendering a heading. */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-2 py-1 text-2xs text-muted-foreground">{tl("ui", "Show these pills")}</DropdownMenuLabel>
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

          {/* The two controls that reshape the table, grouped and pushed right. Columns used
              to live in the table's own header row, in the pinned last cell — the word sat
              on the same line as ORDER / AGE / TRACKING in the same type, so it read as one
              more column name instead of a control. */}
          {!!orders?.length && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <OrderFilterBar
                orders={orders}
                query={query}
                onChange={setQuery}
                catalog={catalog}
              />
              <FactoryColumnsMenu
                order={dataColOrder}
                hidden={hiddenCols}
                onOrder={(ids) => { setDataColOrder(ids); saveFactoryColOrder(ids) }}
                onHidden={(ids) => { setHiddenCols(ids); saveFactoryHiddenCols(ids) }}
              />
            </div>
          )}
        </div>

        {orders === null ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : loadErr ? (
          /* Reported, never silently empty — and it says the count is UNKNOWN rather than
             zero, because the stat cards above are reading the same failed list. */
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Warning size={24} weight="fill" className="text-amber-500" />
            <div className="font-medium text-foreground">{tl("ui", "Couldn't load your orders")}</div>
            <div className="max-w-sm text-sm text-muted-foreground">
              This is a problem reaching the server, not an empty queue — the counts above are
              unknown rather than zero. {loadErr}
            </div>
            <button onClick={load} className="eg-tap mt-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
              {tl("ui", "Try again")}
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Package size={24} weight="duotone" />
            <div className="font-medium text-foreground">{tl("ui", "Nothing here")}</div>
            {/* Names what's actually narrowing the list — "no matches for OLVERA-TEES ·
                last 7 days" is recoverable, "Nothing here" over a filter you forgot you set
                is not. */}
            {/* Already translated inside — it composes a sentence from the active filters,
                so it takes the translators rather than returning a string to look up. */}
            <div className="text-sm">{emptyOrdersMessage(orders.length, query, filterCtx, t, tl)}</div>
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
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-5 py-2.5">
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
              <Button size="sm" variant="outline" onClick={doBulkSlips} disabled={pushing || !!buying}>
                Packing slips
              </Button>
              <Button size="sm" variant="outline" onClick={doBulkStart} disabled={pushing || !!buying}>
                Start
              </Button>
              <Button size="sm" onClick={doPush} disabled={pushing}>
                {pushing ? <CircleNotch size={13} className="animate-spin" /> : <TrayArrowDown size={13} weight="bold" />}
                {pushing ? "Sending…" : `Send ${selected.size} to dispatch board`}
              </Button>
              {/* SAME GATE AS BUYING ONE. The single-order ship button on these very rows is
                  canFulfill (warehouse/admin) because a label spends real money on the
                  company card — and this button spends it twenty times in a row. It shipped
                  without the check, and /api/usps/label is only requireStaff, so an operator
                  could have bought a whole batch. */}
              {canFulfill && (
              <Button size="sm" variant="outline" onClick={doBulkLabels} disabled={!!buying || pushing}>
                {buying ? <CircleNotch size={13} className="animate-spin" /> : <Printer size={13} weight="bold" />}
                {buying ? `Buying ${buying.done}/${buying.total}…` : `Buy labels (${selected.size})`}
              </Button>
              )}
              {/* Unlabelled ×: without it there's no way out of a selection except
                  unticking every row. */}
              <button onClick={() => setSelected(new Set())}
                className="text-muted-foreground hover:text-foreground" aria-label={tl("ui", "Clear selection")}>
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
            className={"items-center gap-x-3 border-b border-border bg-muted/30 px-5 py-2 text-xs font-semibold text-muted-foreground " + (narrow ? "hidden" : "grid")}
            style={{ gridTemplateColumns: rowTmpl, minWidth: rowMinPx }}
          >
            {dispatchOn && <span />}
            <span />
            {gridCols.map((id) =>
              id === "action" ? (
                // The pinned last column is now just the empty header over the row actions.
                // Its Columns button moved up to the toolbar beside Filters: sitting here it
                // was rendered in the header's own type, on the same line as ORDER and AGE,
                // and read as a column named "Columns".
                // Sticky like the cells below it — the header scrolls in the same container,
                // so without this a column title would slide underneath the pinned actions.
                // relative, for the tint overlay that matches the strip's own background.
                <span key={id} className="relative sticky right-0 z-10 -mr-5 bg-card pr-5 before:absolute before:inset-0 before:bg-muted/30" />
              ) : (
                // A header now does two jobs: DRAG reorders the column, CLICK sorts by it.
                // They coexist because a drag never ends in a click. `ready` (the List
                // chips) is the one data column with nothing to order by — it is a set of
                // flags, not a value — so it stays a plain draggable label.
                <span
                  key={id}
                  draggable
                  onDragStart={() => { dragCol.current = id }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onColDrop(id)}
                  {...(id === "ready" ? {} : clickableProps(() => toggleSort(id)))}
                  className={"flex select-none items-center gap-1 truncate " + (id === "ready" ? "cursor-grab" : "cursor-pointer hover:text-foreground ") + (sort?.key === id ? "text-foreground" : "")}
                  title={id === "ready" ? tl("ui", "Drag to reorder") : tl("ui", "Click to sort · drag to reorder")}
                >
                  <span className="truncate">{tl("col", FACTORY_COLS[id].label)}</span>
                  {/* The caret marks the sorted column only. Showing a faint one on every
                      header to advertise the affordance would put eight arrows in a row
                      and make the sorted one harder to find, which is the one fact the
                      header has to carry. */}
                  {sort?.key === id && (
                    <CaretRight size={10} weight="bold" className={sort.dir === "asc" ? "-rotate-90" : "rotate-90"} />
                  )}
                </span>
              )
            )}
          </div>
          <div className="divide-y divide-border" style={{ minWidth: rowMinPx }}>
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
                /**
                 * The badge, and — only when the lines disagree — how many are under way.
                 *
                 * An order's stage is its LEAST-ADVANCED line, so six stitched caps and one
                 * blank still on order read "Draft". That is the right answer for "can this
                 * ship" and a useless one for "what is happening"; the bar is the six.
                 * Hidden when every line is together, because then the badge already said it.
                 */
                status: (() => {
                  const p = lineProgress(o.items ?? [])
                  return (
                    <span className="flex min-w-0 flex-col items-start gap-1 justify-self-start">
                      <StageBadge status={stage} />
                      {p.mixed && (
                        <span className="flex items-center gap-1.5" title={`${p.started} of ${p.total} lines started — this order shows the least-advanced one`}>
                          <span className="block h-1 w-10 overflow-hidden rounded-full bg-muted">
                            <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round((p.started / p.total) * 100)}%` }} />
                          </span>
                          <span className="text-2xs tabular-nums text-muted-foreground">{p.started}/{p.total}</span>
                        </span>
                      )}
                    </span>
                  )
                })(),
                order: <div className="min-w-0 truncate font-mono text-sm font-semibold">{numOf(o)}</div>,
                /**
                 * HOW LONG THIS HAS BEEN WAITING, from the buyer's purchase.
                 *
                 * Plain ink until it passes the overdue threshold, then amber — the same
                 * threshold the Overdue pill counts on, so the column and the pill can
                 * never tell different stories. Everything else on the board is already
                 * coloured by state; an age that tinted every row by how old it was would
                 * just be another rainbow.
                 */
                age: (
                  <div
                    className={"tabular-nums text-xs " + (isOverdue(o, overdueDays) ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}
                    title={[
                      o.created_at ? `Ordered ${new Date(o.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : "No order date recorded",
                      // Say WHICH clock this row is judged by. Two rows can both read
                      // "late" on different authority — one against Etsy's promise to the
                      // buyer, one against our own age threshold — and a tooltip that
                      // hides that difference makes the weaker claim look like the strong
                      // one.
                      o.ship_by
                        ? `Ship by ${new Date(o.ship_by).toLocaleDateString("en-US", { dateStyle: "medium" })} (Etsy's promise to the buyer)`
                        : `No marketplace ship-by — counted late after ${overdueDays} days`,
                    ].join(" · ")}
                  >
                    {ageOf(o.created_at)}
                  </div>
                ),
                /**
                 * HOW BIG THE ORDER IS, in units.
                 *
                 * Set HEAVIER than its neighbours on purpose. Age is muted grey because it
                 * is context; this is the quantity someone is deciding capacity from, so it
                 * carries the row's own ink and a semibold weight — at 12px muted it read as
                 * another piece of metadata and the eye slid past it. Everything around it
                 * stays quiet, which is what lets one number be loud.
                 *
                 * Tabular figures so the column reads as a column: 1 over 12 over 8 has to
                 * line up on the right edge or scanning down it means re-reading each one.
                 */
                units: (
                  <div
                    className="text-sm font-semibold tabular-nums text-foreground"
                    title={`${items.length} line${items.length === 1 ? "" : "s"} · ${units} unit${units === 1 ? "" : "s"}`}
                  >
                    {units || "—"}
                  </div>
                ),
                tracking: (
                  <div className="flex min-w-0 items-center gap-1.5">
                    {track ? (
                      <a href={trackUrl(o.carrier || label?.carrier, track)} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 text-xs font-medium tabular-nums text-success hover:underline" title={`${o.carrier || label?.carrier || "USPS"} ${track}`}>
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
                        title={tl("ui", "Open the shipping label TikTok generated for this order")}
                        aria-label={tl("ui", "Open TikTok label")}
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
                <div key={o.id} className="relative p-5">
                  {/* A BOOKMARK CLIPPED OVER THE SEPARATOR. top-0 puts its top edge on the
                      row's dividing line so it hangs DOWN from it, the way a bookmark sits
                      over the edge of a page — floating it above the line reads as a stray
                      icon belonging to neither row. The -2.3px is MEASURED, not nudged:
                      Phosphor pads that much inside its viewBox, so top-0 put the SVG's box
                      on the line and left the painted glyph below it.

                      Absolutely positioned, so it costs no layout: an earlier version put
                      the glyph in the Order cell and pushed a flagged row's number out of
                      its column, misaligned with every number below it. A marker that moves
                      the data it marks is the wrong marker.

                      Solid fill, not a coloured chip — the status palette is spoken for
                      (violet is working, indigo is pending) and a purple badge here would
                      read as another stage. */}
                  {isRush(o) && (
                    <span
                      className="pointer-events-none absolute left-3 top-[-2.3px] text-primary"
                      title={o.rushed_at ? `Rush — flagged ${fmtDate(o.rushed_at)}` : "Rush"}
                      aria-label="Rush"
                    >
                      <BookmarkSimple size={18} weight="fill" />
                    </span>
                  )}
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
                  <div
                    className={"mb-3 grid gap-x-3 " + (narrow ? "w-full items-center gap-y-1" : "items-center gap-y-1")}
                    style={{ gridTemplateColumns: rowTmpl }}
                  >
                    {/* A box on EVERY row, disabled where it can't be used. Rendering it
                        only on dispatchable rows reads as a half-built feature: most orders
                        have no label yet, so most rows had no box, and a column that appears
                        on a minority of rows looks broken rather than selective. */}
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() => toggleOne(o.id)}
                      aria-label={`Select ${numOf(o)}`}
                      className="size-4 shrink-0 rounded border-input accent-primary"
                    />
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
                    {narrow ? (
                      /*
                       * A CARD, not a transposed table. The first attempt printed a label
                       * beside every value — STATUS / ORDER / AGE / ITEMS — which is what a
                       * table does when you turn it on its side: four uppercase words
                       * repeated on every row, saying the same thing each time, and the
                       * order number given no more weight than its own label.
                       *
                       * A phone row answers one question at a glance — which order, and
                       * what state is it in. So the number is the headline, the stage sits
                       * opposite it, and everything else is one quiet line underneath.
                       * Same `cell` renders as the table; only the arrangement differs.
                       */
                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate">{cell.order}</span>
                          <span className="shrink-0">{cell.status}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          {cell.age}
                          <span aria-hidden>·</span>
                          {cell.units}
                          {/* `units` is the summed QUANTITY, not the number of lines — the
                              column's own tooltip already draws that distinction ("1 line ·
                              2 units"), and pluralising on the line count printed "2 item". */}
                          <span>{units === 1 ? "unit" : "units"}</span>
                        </div>
                      </div>
                    ) : visibleData.map((id) => <Fragment key={id}>{cell[id]}</Fragment>)}

                    {/* One PRIMARY action for the current stage/role; everything rarer
                        (flag/status, labels, the non-primary of ship/advance) tucks into a
                        ⋯ menu so the row isn't a wall of buttons. */}
                    {/* Shipped orders keep the ⋯ menu (so admin can still Refund) — the old
                        "✓ Shipped" badge REPLACED the whole action cluster, hiding it. The
                        menu greys every stage except Refunded for a shipped order. */}
                    <span className={narrow ? "flex shrink-0 items-start" : "contents"}>
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
                      // The factory's own order runs a line with no Pending on it (see
                      // FACTORY_LINE) — every rule below has to read the same line the
                      // server will, or the menu offers moves the API refuses.
                      const fac = isFactoryOrder(o)
                      const withReason = (list: typeof FACTORY_STAGES) =>
                        list.map((s) => {
                          const deny = stageDenialReason(role, stage, s.id, fac)
                          // A skip this role could legally WALK isn't refused outright — it
                          // becomes a catch-up, behind a confirmation. Every other refusal
                          // stands: canWalk requires each intermediate hop to be permitted,
                          // so an operator can't reach Shipped by calling it a catch-up.
                          return { ...s, deny, walk: !!deny && canWalk(role, stage, s.id, fac) }
                        })
                      // The ONE exception to "list everything, disable what's refused": a
                      // factory order doesn't get Pending at all. Disabled means "you may
                      // not"; this is "this order can never be there", and showing the
                      // seller queue's stage on the floor's own order is what we're removing.
                      const prod = withReason([{ id: "", label: "Draft", tone: "new" as const },
                        ...FACTORY_STAGES.filter((s) => !(fac && s.id === "in_review"))])
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
                      const next = nextStage(stage, fac)
                      const canAdvance = !!next && canSetStage(role, stage, next, fac)
                      /**
                       * WAITING TO GO INTO PRODUCTION — which is Draft for the factory's
                       * own order and Pending for a seller's, because those are the two
                       * stages that mean "nobody has started this". Same button, same
                       * write, one word: isApprovable is the same test the order page's
                       * Start uses, so the row and the page can't disagree about whether an
                       * order is ready to begin.
                       *
                       * Still checked against the guard: the move must be one the API would
                       * accept from here, or the button would offer a 403.
                       */
                      /**
                       * START IS FOR AN ORDER NOBODY HAS TOUCHED.
                       *
                       * orderStage() returns "" while ANY line is unstarted, so an order with
                       * one item on the machine and one still waiting reads as unstarted and
                       * kept offering Start — a button that would set the whole order to
                       * Working, which it already effectively is. Pressing it said nothing
                       * true and overwrote per-line state with a blanket one.
                       *
                       * So the moment a single item moves, the ORDER-level button goes: the
                       * order is Working because its items are, and the remaining lines are
                       * started individually from their own rows.
                       */
                      const anyLineStarted = lineProgress(items).started > 0
                      const canStart = canFulfill && !stopped && !anyLineStarted && isApprovable(o) && canSetStage(role, stage, "working", fac)
                      const canLabels = canFulfill && items.some((it) => it.sku && variantOf(it))
                      /**
                       * Primary = the one obvious next move: start it, or ship it. There
                       * is no third.
                       *
                       * "Next stage" used to fill this slot for everything in between, and
                       * it was the source of the confusion: on a Pending row it WAS the
                       * approve button, wearing a name that described a position on a list
                       * rather than the decision being made. Mid-pipeline it named no
                       * destination at all — you pressed it to find out where it went.
                       * Moving a stage is now one thing in one place, the ⋯ menu, where
                       * every stage is listed by name with the reason it can't be used.
                       */
                      /**
                       * SHIP IS NOT THE FALLBACK FOR "CAN'T START".
                       *
                       * This read `canStart ? "start" : canShip ? "ship" : null`, so any
                       * order that merely FAILED the start test offered "Create new label"
                       * as its one obvious move — including an order sitting at `new` that
                       * nobody has made. A tiktok-* order hits this every time, because
                       * factory_order is derived from an `etsy-%` id and isApprovable holds
                       * seller orders at in_review, so it can neither start nor be approved
                       * and lands on ship by elimination.
                       *
                       * Buying a label for unstarted work is not harmless: it spends postage
                       * and puts a tracking number on a parcel that does not exist. The
                       * server refuses to mark such an order SHIPPED (artwork is checked),
                       * but nothing stops the purchase.
                       *
                       * So ship is offered only once the order is actually in production or
                       * past it. Anything earlier gets no primary — the ⋯ menu still lists
                       * every move by name, which is where an unusual one belongs.
                       */
                      const inProduction = ["working", "shipped"].includes(normalizeStage(stage))
                      /**
                       * START, or nothing. "ship" is gone as a primary: buying a label is a
                       * menu action now, so the one button on a row always means the same
                       * thing. A control that changes what it does depending on the row's
                       * state, in the position your hand already goes, is the shape of an
                       * expensive mis-click.
                       */
                      const primary: "start" | null = canStart ? "start" : null
                      const busyO = busy?.startsWith(o.id)
                      return (
                        /**
                          * PINNED TO THE RIGHT EDGE, so the row's action is reachable at any
                          * width.
                          *
                          * The row has a hard minimum of ~1196px (gridMinPx), so on anything
                          * narrower the board scrolls sideways — and this column is LAST, so
                          * the one control you came for was the one thing off screen. You
                          * scrolled right to press Start, then left to read who it was for.
                          *
                          * bg-inherit, not a fixed colour: the row paints hover and selected
                          * states, and a hardcoded background would leave a pale rectangle
                          * sitting over them. -mr-5/pr-5 lets it cover the row's own right
                          * gutter rather than stopping short of it and letting content show
                          * through the gap.
                          */
                        <div className="sticky right-0 z-10 -mr-5 flex items-center justify-end gap-2 bg-inherit pl-3 pr-5 sm:shrink-0">
                          {/* Buttons hug the RIGHT edge (justify-end), aligned with the
                              header's Columns control above — the action column is fixed, so
                              left-aligning left an awkward gap before the row padding.
                              Carrier delivery status was removed: tracking rides Shippo + the
                              pipeline stage, so a "No carrier update" chip on every row was
                              noise, not information. */}
                          {/* THE ACTION CELL HOLDS ACTIONS. It used to repeat the stage here
                              — an amber "⚠ Cancelled" beside a Cancelled chip in the status
                              column, and the same again for On hold and Refunded — which is
                              the same fact three columns apart. What survives is the one
                              thing that is a CONTROL rather than a label: taking an order
                              off hold. Cancelled and refunded rows show nothing, because
                              nothing is left to do from here; the ⋯ menu still has them. */}
                          {stopped && (() => {
                            const norm = normalizeStage(stage)
                            // On hold remembers the stage it interrupted (meta.hold_from), so
                            // it offers a one-click "Back to <that stage>" — clear how to come
                            // off hold. Without a stored prior (an old hold), fall back to ⋯.
                            const holdFrom = norm === "on_hold" ? (o.meta?.hold_from as string | undefined) : undefined
                            const backLabel = holdFrom != null ? (stageMeta(holdFrom)?.label || "Draft") : null
                            return (
                              <span className="inline-flex shrink-0 items-center gap-1.5">
                                {norm === "on_hold" && (backLabel != null ? (
                                  <Button
                                    size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
                                    disabled={busy === `ord:${o.id}`}
                                    onClick={() => setOrderStatus(o, holdFrom!)}
                                    title={`Take this order off hold and return it to ${backLabel}`}
                                  >
                                    Back to {backLabel}
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">resolve in ⋯</span>
                                ))}
                              </span>
                            )
                          })()}
                          {primary === "start" && (
                            <Button size="sm" onClick={() => startOrder(o)} disabled={busyO}
                              title={fac
                                ? "Put this into production — moves it to Awaiting scan"
                                : "Accept this seller's order into production — moves it to Awaiting scan"}>
                              {tl("ui", "Start")}
                            </Button>
                          )}
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
                              {/* The one-step advance lives HERE now, and only here — it is
                                  never the row's primary. Named with its destination, since
                                  in a list of stages "next" is the only one that doesn't say
                                  where it goes. */}
                              {canAdvance && next && (
                                <DropdownMenuItem onClick={() => advanceOrder(o)}>
                                  <SkipForward size={14} weight="fill" /> {tl("ui", "Move to")} {stageMeta(next)?.label ?? next}
                                </DropdownMenuItem>
                              )}
                              {/* THE ONLY WAY TO BUY A LABEL FROM A ROW, on purpose.
                                  It used to be promoted to a primary button whenever the
                                  order looked ready, which put it exactly where Start sits
                                  on every other row — one button changing identity by
                                  context, in the place your hand already goes. Buying
                                  postage is not something to hit by muscle memory.
                                  Dropped the `primary !== "ship"` guard with it: that was
                                  only there to avoid showing the item twice, and there is
                                  no longer a primary to collide with. */}
                              {canShip && <DropdownMenuItem onClick={() => openFulfill(o)}><Truck size={14} weight="bold" /> {tl("ui", "Create new label")}</DropdownMenuItem>}
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
                                    {/* RUSH sits above the hold states because it is the
                                        opposite action and the most reachable one: the person
                                        who notices a job is urgent is usually mid-task, and a
                                        flag two menus deep is a flag nobody sets. */}
                                    {/* Offered at every stage EXCEPT the ones where the
                                        order is finished. A rush is "move this up the
                                        queue", and a shipped or cancelled order has no
                                        queue left to move up. Clearing stays available on a
                                        shipped order only if one is somehow still flagged,
                                        so a stuck flag is never unremovable. */}
                                    {(stage !== "shipped" && stage !== "cancelled") || isRush(o) ? (
                                      <DropdownMenuItem onClick={() => toggleRush(o)}>
                                        {isRush(o) ? tl("ui", "Clear rush") : tl("ui", "Rush")}
                                      </DropdownMenuItem>
                                    ) : null}
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
                    </span>
                  </div>

                  {/* Fulfill panel (warehouse/admin): buy a USPS-direct label, or record tracking manually */}
                  {/* THE IN-ROW LABEL FORM IS GONE — see NewLabelDialog at the foot of this
                      component. It was a second, poorer implementation of the same job: one
                      carrier, no rate list, a parcel typed from scratch every time, and a
                      dim-weight lecture underneath objecting to numbers nobody had chosen.
                      The dialog rate-shops every enabled carrier, opens on the mailer this
                      factory actually stocks, and fills the parcel in from the blanks on the
                      order. Two places to buy a label is also two places for the rules about
                      buying one to drift apart. */}

                  {/* Order detail — the things a board needs but the header can't hold:
                      the full ship-to, the buyer's personalisation instructions, and any
                      note. Previously none of this was reachable from a factory board at
                      all, so staff had to open the seller's order page to read them. */}
                  {!isCollapsed && (() => {
                    const a = (o.address ?? {}) as Record<string, string>
                    const street = a.street || a.first_line || a.line1 || a.address1 || ""
                    // The server hides a marketplace buyer's street/ZIP/phone/email from the
                    // seller side and stamps `masked`. Without reading that flag this panel
                    // would say "Not available yet" — which is the OPPOSITE of true and the
                    // exact confusion Etsy's redacted addresses already caused once.
                    const masked = !!(o.address as { masked?: boolean } | null)?.masked
                    const notes = (o as { notes?: string | null }).notes
                    const personal = (o.items ?? []).map((it) => (it as { personalization?: string | null }).personalization).filter(Boolean)
                    if (!street && !masked && !notes && !personal.length) return null
                    return (
                      <div className="mb-3 grid gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-2">
                        <div>
                          <div className="mb-0.5 font-semibold uppercase tracking-wide text-muted-foreground">{tl("ui", "Ship to")}</div>
                          {masked ? (
                            // Say WHICH it is: the address exists and is being withheld, not
                            // missing. Region is kept so a seller can still recognise the
                            // order and answer "did it go to the right place?".
                            <div className="leading-relaxed">
                              {(o.customer?.name || a.name) && (
                                <div className="font-medium text-foreground">{o.customer?.name || a.name}</div>
                              )}
                              <div className="select-none tracking-widest text-muted-foreground">••••••••••</div>
                              <div>{[a.city, a.state].filter(Boolean).join(", ")}</div>
                              {a.country && <div>{a.country}</div>}
                              <div className="mt-1 text-3xs text-muted-foreground">
                                Street and postcode are held by the factory — ask support if an order needs checking.
                              </div>
                            </div>
                          ) : street ? (
                            <div className="leading-relaxed">
                              {o.customer?.name && <div className="font-medium text-foreground">{o.customer.name}</div>}
                              <div>{street}</div>
                              {(a.street2 || a.second_line || a.line2) && <div>{a.street2 || a.second_line || a.line2}</div>}
                              <div>{[a.city, a.state, a.zip || a.postal_code].filter(Boolean).join(", ")}</div>
                              {(a.country || a.country_iso) && <div>{a.country || a.country_iso}</div>}
                            </div>
                          ) : (
                            <div className="text-muted-foreground">{tl("ui", "Not available yet.")}</div>
                          )}
                        </div>
                        <div className="space-y-2">
                          {personal.length > 0 && (
                            <div>
                              <div className="mb-0.5 font-semibold uppercase tracking-wide text-muted-foreground">{tl("ui", "Personalisation")}</div>
                              {personal.map((p, i) => <div key={i} className="leading-relaxed">{decodeEntities(p)}</div>)}
                            </div>
                          )}
                          {/* OURS. Staff only — the server strips this field from every
                              seller-facing response and refuses the write from a seller, so
                              this box is not the thing keeping it private. */}
                          {isStaff && <InternalNote orderId={o.id} value={(o as { internal_note?: string | null }).internal_note ?? ""} />}
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
                            // Bigger while a blank is being chosen — that panel is denser on the
                            // right, and the thumbnails were leaving the left column half empty.
                            //
                            // 136 was sized against a right column carrying THREE stacked meta
                            // lines. Those are one wrapping line now (OrderedVariant), so the tall
                            // case is ~34px shorter and 136 would put the empty band back on the
                            // other side. This is the size of the PRINT card; the listing tucks
                            // behind it and adds PEEK, not another full tile.
                            size={canDesign && stage === "" ? 104 : 88}
                            onEdit={canDesign ? () => setEditing({ order: o, item: it }) : undefined}
                            /**
                             * A DROP LANDS ON THIS LINE, AND ONLY THIS LINE.
                             *
                             * It used to land on the SKU: two shirts of one sku shared a
                             * single design row, so artwork dropped on the second appeared
                             * on both and there was nowhere to put a different design. That
                             * is the wrong default for the common case — a customer ordering
                             * three colours who wants three different customisations.
                             *
                             * line_id is what makes it per-line, and every order line now
                             * carries one. The confirmation says WHICH line so the scope is
                             * visible at the moment it happens, and "apply to every line"
                             * is a deliberate second action rather than the default.
                             */
                            onDropImage={canDesign && it.sku ? (dataUrl) => {
                              const siblings = (o.items ?? []).filter((x) => x.line_id !== it.line_id)
                              postOrderDesign(o.id, { sku: it.sku!, line_id: it.line_id, data: dataUrl, name: it.name })
                                .then(() => {
                                  setNote(siblings.length
                                    ? `Artwork attached to this line only (${it.name || it.sku}) — ${siblings.length} other ${siblings.length === 1 ? "line" : "lines"} unchanged.`
                                    : `Artwork attached to ${it.name || it.sku}.`)
                                  if (siblings.length) setApplyAll({ order: o, item: it, data: dataUrl, siblings })
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
                            {/* What the BUYER chose, kept under the title through the whole
                                picking step — the pickers below decide what we make, and this
                                is the only thing on screen that says what they asked for. */}
                            {/* Stock sits with Qty: how many we need, how many we hold. */}
                            <OrderedVariant
                              item={it}
                              className="sm:pr-[15rem]"
                              after={
                                <>
                                  <LineStock item={it} catalog={catalog} stock={stock} pos={pos} orderId={o.id} show={isStaff} onTrack={isStaff ? setTrackSku : undefined} />
                                  {(() => {
                                    /**
                                     * THREADS ONLY ONCE A BLANK IS CHOSEN.
                                     *
                                     * The pill showed on a line with nothing picked: the lookup fell
                                     * through to the LISTING sku, matched a thread row saved against it,
                                     * and claimed a cone map for a garment nobody had selected. A thread
                                     * match is part of the make-spec — it cannot precede the thing being
                                     * made.
                                     *
                                     * The GATE is "is a blank chosen", the LOOKUP is unchanged. Those are
                                     * two different questions and conflating them was the trap here:
                                     * order_threads rows are keyed by the line's own sku (LA6,
                                     * LA10-POCKET in the live data), not by the blank's, so requiring the
                                     * resolved product's sku as the key would have hidden every real match
                                     * instead of the wrong ones.
                                     *
                                     * Beside Qty rather than under the pickers, with the stock pill: how
                                     * many we need, how many we hold, what it is stitched in — one line of
                                     * facts about the line, read together.
                                     */
                                    const product = resolveProduct(it, catalog)
                                    const blankChosen = !!product || !!String(it.blank || "").trim()
                                    if (!blankChosen) return null
                                    const key = String(product?.sku || it.blank || it.sku || "").toUpperCase()
                                    const cones = (threads[o.id] ?? []).find((t) => String(t.sku).toUpperCase() === key)?.threads ?? []
                                    if (!cones.length) return null
                                    return (
                                      <ThreadBreakdown artwork={artworkFor(o, it)}>
                                        <span
                                          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground hover:bg-muted/80"
                                          title={`${cones.length} thread colour${cones.length === 1 ? "" : "s"} matched — click for the cone map`}
                                        >
                                          <span className="flex items-center -space-x-0.5">
                                            {cones.slice(0, 8).map((c) => (
                                              <span key={c.code} className="size-2.5 rounded-full border border-black/10" style={{ background: c.hex }} />
                                            ))}
                                          </span>
                                          {cones.length} thread{cones.length === 1 ? "" : "s"}
                                        </span>
                                      </ThreadBreakdown>
                                    )
                                  })()}
                                </>
                              }
                            />
                            {/* Factory-owned marketplace orders arrive with no blank chosen;
                                artwork review (canDesign) picks it here while the order is
                                still unstarted. A pushed seller order is past "" (already
                                charged) so it shows the read-only variant instead — and the
                                server 409s any stray write to a charged order regardless. */}
                            {/**
                              * ONE RHYTHM, BOTH BRANCHES: the strip sits under the order
                              * details, and the make-spec pills sit under the strip.
                              *
                              * These were one wrapping row — read-only variant chips, the qty,
                              * stock, threads and the machine file all breaking together — on
                              * the argument that they are all facts about the same line. They
                              * are, but they answer different questions: the strip says WHAT we
                              * are making, the pills say what it takes to MAKE it. Merged, a
                              * long colourway pushed "25 in stock" onto a second row anyway, so
                              * the split happened at whatever width the browser chose rather
                              * than where the meaning changes.
                              *
                              * Qty is NOT repeated here. It moved into the order-details line
                              * above (OrderedVariant), so the "×1" that used to sit beside the
                              * strip was the same number printed twice on one line.
                              */}
                            {canPickVariants && NOT_STARTED.includes(stage) ? (
                              <VariantPicker orderId={o.id} item={it} catalog={catalog} onSaved={load} />
                            ) : (
                              // Locked, not chipped: the same four fields the editable strip
                              // shows, greyed. A row that changes shape by role reads as two
                              // different screens.
                              <div className="mt-1">
                                <VariantStrip
                                  blank={resolveProduct(it, catalog)?.name || it.blank || undefined}
                                  color={it.color} size={it.size} method={it.print_type}
                                  marketplace={it.variant} locked
                                />
                              </div>
                            )}

                            {/* What the floor needs to actually MAKE this line: how much blank
                                we hold, which cones to load, and the machine file. Stock leads
                                — it is the one that decides whether the line can start at all,
                                and it now shows at EVERY stage rather than only after a blank
                                is picked. */}
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:mt-0">
                              {(() => {
                                // The thread pill moved up beside Qty (see OrderedVariant's
                                // `after`). What is left here is the machine file — and it is
                                // keyed on the RESOLVED blank for the same reason: falling back
                                // to the listing sku attributed a file to a line whose garment
                                // nobody had picked.
                                // Same rule as the thread pill above: gated on a chosen blank,
                                // looked up on the key the rows were actually written with.
                                const product = resolveProduct(it, catalog)
                                if (!product && !String(it.blank || "").trim()) return null
                                const skuU = String(product?.sku || it.blank || it.sku || "").toUpperCase()
                                const file = (dfiles[o.id] ?? []).find((f) => String(f.sku ?? "").toUpperCase() === skuU)
                                if (!file) return null
                                // The same pill language as the Label/Scan/Design and Stock
                                // pills: rounded-md, px-2 py-0.5, neutral because a file id is
                                // information rather than status.
                                return (
                                  <span
                                    className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-2xs font-medium text-muted-foreground"
                                    title={`Machine file ${file.name ?? ""} · ${file.designId}`}
                                  >
                                    <FileArrowDown size={10} weight="bold" /> {file.designId}
                                  </span>
                                )
                              })()}
                            </div>
                          </div>
                          <div className="mt-2 flex w-full flex-wrap items-center gap-2 sm:absolute sm:right-2.5 sm:top-2.5 sm:z-10 sm:mt-0 sm:w-auto">
                          {/* The per-line "Board" button is GONE. Sending a card to the
                              designer is already reachable from the open order and from the
                              mini designer, and repeating it on every item row put a third
                              copy of one action next to two others that do different things
                              — so the row's most-used controls (Start, stage) were competing
                              with the one used least. sendToDesigner itself stays; the other
                              two entry points call it. */}
                          {/* START THIS ONE LINE.
                              The dropdown beside it can already set any stage, but a
                              dropdown is a "set a value" control — you have to know what
                              to pick. Not all lines start together: one blank is short, one
                              design isn't approved, and the rest can be on the machine
                              today. This is the same word the order carries, aimed at a
                              single line.
                              Shown only when the line's next move IS Working — so a
                              seller's order that nobody has accepted yet doesn't offer to
                              start a line (its next stage is Pending, an order-level
                              decision), and a line already under way doesn't offer it at
                              all. The dropdown stays for corrections and going back. */}
                          {(() => {
                            const fac = isFactoryOrder(o)
                            const to = nextStage(it.factory_status, fac)
                            if (to !== "working" || !canSetStage(role, it.factory_status, to, fac)) return null
                            return (
                              <Button
                                size="sm" variant="outline" className="h-8 shrink-0"
                                disabled={busy === key}
                                onClick={() => advanceItem(o, it, "working")}
                                title="Start making this line — the rest of the order is unaffected"
                              >
                                {tl("ui", "Start")}
                              </Button>
                            )
                          })()}
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
                            // Pending is absent from a factory order's options for the same
                            // reason it's absent from its ⋯ menu — the stage isn't on that
                            // order's line at all (see FACTORY_LINE).
                            const opts = stageOptionsFor(role, it.factory_status, isFactoryOrder(o))
                            const prod = opts.filter((s) => !EXCEPTION_STAGES.some((x) => x.id === s.id))
                            /**
                             * CANCEL AND REFUND ARE NOT OFFERED PER LINE — they are order
                             * moves, and this control could not keep the promise.
                             *
                             * Picking Cancelled here POSTs item-status, which writes
                             * order_items.factory_status and nothing else. No money comes
                             * back (the reversal hangs off the order's PATCH), the order's
                             * own column still says Working, and orderStage() lets any
                             * exception line win — so one line of five turned the whole row
                             * Cancelled while the seller was still charged for all five.
                             * The word said one thing and the ledger said another.
                             *
                             * Cancelling part of an order is a real need and this was not
                             * it; it belongs with the refund, which already splits by part.
                             * Until then the honest place is the whole order: the ⋯ menu and
                             * the order page's Cancel / Refund panel, both of which move the
                             * money. On hold stays here — it is a stop, not a settlement.
                             *
                             * A line already sitting at a money stage keeps its own option,
                             * or the select would show a blank box for a value it holds.
                             */
                            const here = normalizeStage(it.factory_status)
                            const exc = opts.filter((s) => EXCEPTION_STAGES.some((x) => x.id === s.id))
                              .filter((s) => !isMoneyStage(s.id) || s.id === here)
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
                                className={"eg-select h-8 shrink-0 rounded-lg border px-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 " + (isException(it.factory_status) ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300" : "border-border bg-card hover:border-primary/40")}
                                aria-label={`Status for ${it.name || it.sku}`}
                                title={tl("ui", "Set this item's status — forward or back")}
                              >
                                {/* A line sitting at a stage this role cannot set — a
                                    Cancelled line under a warehouse account, now that the
                                    money stages have left this control — still has to SHOW
                                    it: a select whose value matches no option renders
                                    blank, which reads as "no status at all". Disabled,
                                    because it is a fact here, not a move. */}
                                {![...prod, ...exc].some((s) => s.id === here) && (
                                  <option value={here} disabled>{tl("stage", stageMeta(here)?.label ?? here)}</option>
                                )}
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
          {/* AFTER a per-line drop: the offer to copy it across, never the default.
              Lists the lines it would touch by name so "all items" is a set you can see
              rather than a promise — the whole complaint was artwork silently landing on
              lines nobody chose. */}
          <Dialog open={!!applyAll} onOpenChange={(v) => { if (!v) setApplyAll(null) }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle>Put this on the other lines too?</DialogTitle></DialogHeader>
              <div className="space-y-3 px-1 pb-1">
                <p className="text-sm text-muted-foreground">
                  The artwork is on <strong className="text-foreground">{applyAll?.item.name || applyAll?.item.sku}</strong> only.
                  This order has {applyAll?.siblings.length} other {applyAll?.siblings.length === 1 ? "line" : "lines"} —
                  copy it to {applyAll?.siblings.length === 1 ? "it" : "them"} as well?
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-2 text-xs">
                  {(applyAll?.siblings ?? []).map((sib) => (
                    <li key={sib.line_id || sib.sku} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{sib.name || sib.sku}</span>
                      {(sib.color || sib.size) && (
                        <span className="shrink-0 text-muted-foreground">{[sib.color, sib.size].filter(Boolean).join(" · ")}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {/* Said plainly: a colourway usually wants its OWN artwork, which is the
                    reason this is a question rather than a default. */}
                <p className="text-xs text-muted-foreground">
                  Leave it if each line needs its own customisation — that&apos;s the usual case for a
                  multi-colour order.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setApplyAll(null)} disabled={applyAllBusy}>
                    This line only
                  </Button>
                  <Button
                    size="sm"
                    disabled={applyAllBusy}
                    onClick={async () => {
                      if (!applyAll) return
                      setApplyAllBusy(true)
                      const { order, data, siblings } = applyAll
                      // One at a time: each is its own row keyed on its own line, and a
                      // failure part-way through must leave the ones that landed alone.
                      let done = 0
                      for (const sib of siblings) {
                        if (!sib.sku) continue
                        const r = await postOrderDesign(order.id, { sku: sib.sku, line_id: sib.line_id, data, name: sib.name }).catch(() => null)
                        if (r && !r.error) done++
                      }
                      const fresh = await getOrderDesigns(order.id).catch(() => null)
                      if (fresh) {
                        const list = Array.isArray(fresh) ? fresh : (fresh?.designs ?? [])
                        const bySku: Record<string, OrderDesign> = {}
                        Object.assign(bySku, indexDesigns(list))
                        setDesigns((p) => ({ ...p, [order.id]: bySku }))
                      }
                      setApplyAllBusy(false)
                      setApplyAll(null)
                      setNote(done === siblings.length
                        ? `Artwork copied to ${done} more ${done === 1 ? "line" : "lines"}.`
                        : `Copied to ${done} of ${siblings.length} — the rest kept what they had.`)
                    }}
                  >
                    {applyAllBusy ? <><CircleNotch size={13} className="animate-spin" /> Copying…</> : `Apply to all ${(applyAll?.siblings.length ?? 0) + 1} lines`}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

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
                    <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{tl("ui", "Identical artwork")}</div>
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
                    <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{tl("ui", "Looks similar — confirm before reusing")}</div>
                    <div className="space-y-1.5">
                      {reuse.similar.map((m) => <MatchRow key={m.design_id} m={m} similar />)}
                    </div>
                  </div>
                ) : null}
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setReuse(null)}>{tl("ui", "Cancel")}</Button>
                <Button
                  size="sm"
                  onClick={() => { const r = reuse; setReuse(null); if (r) sendToDesigner(r.order, r.item, true) }}
                >
                  {tl("ui", "Send to the board anyway")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* ONE label window for the whole board, mounted once and pointed at whichever
              order asked for it — the same dialog the Shipments page uses.
              It brings what the in-row form could not: every enabled carrier's rates side by
              side rather than USPS alone, the mailer sizes this factory stocks, and a parcel
              worked out from the blanks on the order (weight summed, footprint from the
              largest line) instead of three numbers typed from memory. Ship-to comes from the
              order, so the common case is open → pick a rate → buy. */}
          {shipOpen && (() => {
            const o = (orders ?? []).find((x) => x.id === shipOpen)
            if (!o) return null
            return (
              <NewLabelDialog
                open
                onOpenChange={(v) => { if (!v) setShipOpen(null) }}
                order={{ id: o.id, num: numOf(o), to: toAddrOf(o), items: o.items ?? [] }}
                onCreated={() => {
                  /**
                   * DO NOT CLOSE ON SUCCESS.
                   *
                   * This used to call setShipOpen(null), which unmounted the dialog the
                   * instant the buy returned — so the success panel never rendered, the
                   * label bytes were never fetched, and the auto-print effect never ran at
                   * all. That is why buying a label silently produced no print dialog, and
                   * why fixes inside the dialog changed nothing: the component was gone
                   * before any of them could execute.
                   *
                   * The dialog closes itself now, on Done — after it has printed, and after
                   * you have had the chance to press Print again or buy Another. Refreshing
                   * the board underneath is still right, so load() stays.
                   */
                  load()
                }}
              />
            )
          })()}

          {/* One editor for the whole board — mounted once, pointed at whichever line was
              clicked. Reloads the order's designs on save so the row avatar rehydrates
              with the new placement immediately, without a full board refetch. */}
          {editing && (
            <DesignCanvasDialog
              open
              onOpenChange={(v) => { if (!v) setEditing(null) }}
              orderId={editing.order.id}
              item={editingLive?.item ?? editing.item}
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
      {/* THE SAME DIALOG THE INVENTORY PAGE USES, opened from an "Add to inventory" chip and seeded
          with that blank's sku. Adding the row here updates this screen's stock map straight
          away, so the chip it was opened from becomes a real count without a reload. */}
      <AddItemDialog
        open={!!trackSku}
        onOpenChange={(v) => { if (!v) setTrackSku(null) }}
        seedQuery={trackSku ?? ""}
        catalog={catalog}
        existing={Object.keys(stock)}
        onAdd={(batch) => {
          setTrackSku(null)
          setStock((prev) => {
            const next = { ...prev }
            for (const it of batch) next[String(it.sku).toUpperCase()] = Number(it.in_stock) || 0
            return next
          })
          // Fire-and-forget, same as the Inventory page: the row is the point, and a failure
          // surfaces there where the numbers live.
          Promise.all(batch.map((it) => addInventoryItem(it).catch(() => null)))
        }}
      />

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
            return { it, blank, stockSku }
          })
          .filter(({ stockSku }) => !!stockSku)
          .map(({ it, blank, stockSku }) => ({
            sku: stockSku,
            /**
             * THE BLANK'S NAME, not the listing's.
             *
             * `it.name` is the marketplace title — "Custom Apron with Embroidered Name, Heavy
             * Duty Cotton Canvas Apron with…" — which is what the buyer bought, not what the
             * picker takes off a shelf. On a 2×1 sticker it truncates to nothing useful and it
             * names a thing the warehouse does not stock. The code beneath it is already the
             * BLANK's sku, so the words above it were describing something else entirely.
             *
             * Falls back to the stock sku, never to the listing title: an unnamed blank is
             * still a blank, and a marketplace title on a stock label is the actual mistake.
             */
            name: blank?.name || stockSku,
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
            const path = stagePath(from, catchUp.to, isFactoryOrder(catchUp.order)) ?? []
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
            <Button variant="outline" onClick={() => setCatchUp(null)} disabled={catchingUp}>{tl("ui", "Cancel")}</Button>
            <Button onClick={() => void runCatchUp()} disabled={catchingUp}>
              {catchingUp ? <><CircleNotch size={14} className="animate-spin" /> {tl("ui", "Recording…")}</> : tl("ui", "Record all stages")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-center text-xs text-muted-foreground">{tl("ui", "Stages")}: {FACTORY_STAGES.map((s) => tl("stage", s.label)).join(" → ")}</p>

    </div>
  )
}
