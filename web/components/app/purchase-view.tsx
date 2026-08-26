"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cartChanged } from "@/lib/cart-events"
import { ShoppingCart, CircleNotch, CheckCircle, Trash, CaretRight, ArrowClockwise, ArrowSquareOut, FileText } from "@phosphor-icons/react"
import { usePaged, Pagination } from "@/components/app/pagination"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { useConfirm, usePrompt } from "@/components/app/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
 getInventory, patchInventoryItem, addInventoryItem, getPurchaseOrders, savePurchaseOrder, deletePurchaseOrder, receivePurchaseOrder,
 getFactoryList, saveFactoryList, creditPoReturn, getSsTracking, cancelSsOrder, getSsOrder, getSsInventory, getSsDaysInTransit, getOttoInventory, type PoReturn, type SsShipment,
 ssOrder, resolveSuppliers, getSupplierOptions, setFactorySettings, type InventoryItem, type PurchaseOrder, type POLine, type SavedPOLine, type PaymentProfile,
} from "@/lib/api"
import { POAddItems } from "@/components/app/po-add-items"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SupplierOrderingDialog } from "@/components/app/supplier-ordering-dialog"
import { PoReturnDialog } from "@/components/app/po-return-dialog"
import { StockSplitWarning } from "@/components/app/stock-split-warning"
import { warehouseEta, fmtEta } from "@/lib/warehouse-eta"
import { shortOrderRef } from "@/lib/order-format"
import { ReceiveScanDialog } from "@/components/app/receive-scan-dialog"
import { CardEntryDialog } from "@/components/app/card-entry-dialog"
import { usableCard, type CardDetails } from "@/lib/otto-card"
import { getToken } from "@/lib/auth"
import { EmptyState } from "@/components/app/empty-state"

const num = (v: unknown) => Number(v) || 0
const isLow = (it: InventoryItem) => num(it.in_stock) <= (it.reorder_at ?? 25)
const suggestQty = (it: InventoryItem) => Math.max(1, (it.reorder_at ?? 25) * 2 - num(it.in_stock))
const supKey = (s?: string | null) => (s || "Unassigned")
const nextNum = () => "PO-" + Date.now().toString(36).toUpperCase()
// A stand-in for the picker to attach to. There is no draft PO any more: items picked
// from a catalogue go into the to-order pool, and a purchase order only comes into
// existence at the moment one is placed.
const POOL: PurchaseOrder = { num: "__pool__", supplier: null, items: [], status: "pool" }
// NOTE: there is deliberately no supplier-name matcher here any more. Guessing an API
// from a typed name is what sent every "Unassigned" PO to S&S ("unassigned" contains
// "ss"). The supplier is a property of the PRODUCT, resolved server-side from the synced
// catalogs — see resolveSuppliers / place().

/**
 * Which orders drove a purchase-order line.
 *
 * Shown wherever a line appears: on a draft about to be placed, and on a parked one being
 * weighed up. "×150" alone is a number nobody can defend when the invoice lands, and the
 * whole point of parking something is returning to it later — by which time "why did I
 * save this" is exactly the question.
 *
 * Module scope, not inside the view: a component declared during render is a new type on
 * every render, so React remounts it and any state inside it is lost.
 */
/**
 * The product's picture on a line.
 *
 * Supplier names differ by a single word — "Unisex DryBlend Crewneck" against "Unisex
 * Heavy Blend Crewneck" — so a name alone doesn't confirm you picked the right sku. The
 * picture is what makes a wrong pick obvious before it's ordered instead of when the box
 * arrives. A dashed square means "no picture", never "still loading".
 */
function LineThumb({ src, onZoom, label }: { src?: string | null; onZoom?: (src: string, label: string) => void; label?: string }) {
  const tl = useLabelT()
 if (!src) return <span className="size-11 shrink-0 rounded border border-dashed border-border" aria-hidden />
 return (
    <button type="button" onClick={() => onZoom?.(src, label ?? "")}
 title={tl("purchase", "Click to enlarge")} aria-label={`Enlarge ${label || tl("purchase", "product image")}`}
 className="shrink-0 rounded border border-border bg-white transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" className="size-11 rounded object-contain" />
    </button>
  )
}

/**
 * Enlarged product image.
 *
 * A 44px thumbnail is enough to tell two garments apart; it is not enough to tell two
 * COLOURWAYS apart, and picking the wrong shade of navy is a whole order reprinted. S&S
 * publish a large variant by filename suffix, so the zoom asks for that rather than
 * scaling the thumbnail up into mush.
 */
function ImageZoom({ img, onClose }: { img: { src: string; label: string } | null; onClose: () => void }) {
  const tl = useLabelT()
 if (!img) return null
 const big = img.src.replace(/_(fs|fm)(\.[a-z]+)/i, "_fl$2")
 return (
    <Dialog open onOpenChange={(o: boolean) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate text-base">{img.label || tl("purchase", "Product image")}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center rounded-lg border border-border bg-white p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={big} alt={img.label}
            // Fall back to the size we already have if the large variant doesn't exist —
            // a smaller picture beats a broken one.
 onError={(e) => { const t = e.currentTarget; if (t.src !== img.src) t.src = img.src }}
 className="max-h-[65vh] w-auto object-contain" />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SourceTags({ line }: { line: POLine }) {
  const tl = useLabelT()
 const src = Array.isArray(line.sources) ? line.sources : []
 if (!src.length && !line.auto) return null
 return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1">
      {/* WHY THIS ROW IS HERE. An auto line was not picked by anyone — the shelf read zero
          when an order was approved and the server filed it (autoReplenish). Beside a row
          somebody chose deliberately it looked identical, so the buyer had no way to tell
          "I put this here" from "production is waiting on this". It carries meaning, which
          is the only thing a pill may do. */}
      {line.auto && (
        <span className="rounded bg-alert/10 px-1.5 py-0.5 text-2xs font-medium text-alert" title={tl("purchase", "The shelf was empty when an order needed this, so it was added for you.")}>
          {tl("purchase", "Out of stock")}
        </span>
      )}
      {src.slice(0, 4).map((s, i) => {
        // THE NUMBER, not the internal id. A marketplace order's id is "etsy-3311908445"
        // and its number is "#4099" — the number is what is on the packing slip, the
        // buyer's email and the shop's dashboard, so a chip showing the id asks a buyer to
        // go and translate it before they know what they are buying for.
        //
        // Lines parked before `num` was recorded fall back to shortOrderRef, NOT to the raw
        // id with a '#' bolted on. "#FF-ombao6-msyfrdqn-2mfrc" is not a number — the hash
        // made a 24-character key look like one, and that format appears nowhere else in the
        // product, because everywhere else holds the order row and shows its #seq. The full
        // id stays in the title for anyone who needs to match it against the database.
 const label = s.num || shortOrderRef(s.order)
 return (
          <span key={i} className="rounded bg-muted px-1.5 py-0.5 tabular-nums text-2xs text-muted-foreground"
 title={`${s.qty} of these are for order ${label}${s.num ? ` (${s.order})` : ""}`}>
            {label} ×{s.qty}
          </span>
        )
      })}
      {src.length > 4 && <span className="text-2xs text-muted-foreground">+{src.length - 4} more</span>}
    </span>
  )
}

/**
 * Pull a quantity out of Otto's inventory response.
 *
 * Their route is a passthrough and the payload has never been seen against a live account,
 * so this tries the names a stock field plausibly has and returns null when none of them
 * hold a number. Null renders as "stock unknown", never as 0 — a fabricated zero reads as
 * "don't order this", which is the opposite of what an unreadable response means.
 *
 * Once one real response has been seen, replace this with the actual field.
 */
/**
 * OTTO IS NEVER PLACED FROM HERE.
 *
 * The connector exists and is double-gated off server-side (OTTOCAP_ORDER_LIVE), and its
 * payload has never been validated against a live account. An order that reaches a supplier
 * wrong is not a bug you roll back: somebody ships blanks, or does not, against a purchase
 * nobody can find. So the button does not offer it and the placing loops step over it.
 *
 * A MIXED CART STILL GOES. The Otto group is held back and every other supplier is placed —
 * the only behaviour that does not punish a whole cart for containing one Otto line. The
 * held-back group is reported by name, never silently dropped.
 */
const NO_AUTO_ORDER: ReadonlySet<string> = new Set(["otto"])
const placeable = (api: string | null | undefined) => !!api && !NO_AUTO_ORDER.has(api)
const HELD_BACK = "Otto is ordered by hand — those lines were left in the cart."

/**
 * Otto's own minimum: 24 pieces an order. A smaller one is refused after somebody has keyed
 * it in, which is when it is most annoying to learn. WARNED, not blocked — the minimum is
 * theirs and negotiable per account, and a rule we enforce is one we have to keep in step
 * with a rule we do not control.
 */
const OTTO_MIN_UNITS = 24

function ottoQty(r: unknown): number | null {
 const seen = new Set<unknown>()
 const walk = (v: unknown, depth: number): number | null => {
 if (v == null || depth > 4 || typeof v !== "object" || seen.has(v)) return null
 seen.add(v)
 if (Array.isArray(v)) {
      // A list of variants: sum what we can read, but only if we read at least one.
 let total = 0, found = false
 for (const item of v) { const n = walk(item, depth + 1); if (n != null) { total += n; found = true } }
 return found ? total : null
    }
 const o = v as Record<string, unknown>
 for (const k of ["quantity", "qty", "available", "availableQuantity", "stock", "inventory", "onHand", "on_hand"]) {
 const n = Number(o[k])
 if (o[k] != null && isFinite(n)) return n
    }
 for (const val of Object.values(o)) { const n = walk(val, depth + 1); if (n != null) return n }
 return null
  }
 return walk(r, 0)
}

// `embedded` hides the mobile hero when this sits inside the Purchasing tab shell.
/** `refreshKey` — bumped by the Purchasing tab shell when this view is re-shown. It stays
 * mounted between tab switches, so this is what picks up a blank added to the cart from
 * the All-suppliers tab. `load` overwrites the lists in place, never blanking them, so
 * the refresh never flashes a spinner over a cart you're reading. */
export function PurchaseView({ embedded = false, refreshKey = 0 }: { embedded?: boolean; refreshKey?: number }) {
  const tl = useLabelT()
 const prompt = usePrompt()
 const confirm = useConfirm()
 const [inv, setInv] = useState<InventoryItem[] | null>(null)
 const [pos, setPos] = useState<PurchaseOrder[] | null>(null)
 const [busy, setBusy] = useState<string | null>(null)
  /**
   * `lines` is the per-supplier outcome, kept APART from `text`.
   *
   * Placing four orders used to join four sentences with " · " into one paragraph — each
   * carrying the supplier's own error verbatim, which for a refused card is itself two
   * sentences — so the banner became a wall nobody reads to the end of. One short line per
   * supplier is scannable; the provider's exact words sit behind Details, where they matter
   * only once you have decided which supplier to look at.
   *
   * `cardRetry` is set when a failure was about PAYMENT rather than the order — the one
   * failure with an obvious next action, so it gets a button instead of a paragraph.
   */
 const [msg, setMsg] = useState<{
 ok: boolean; text: string; tone?: "warn"
 lines?: { supplier: string; ok: boolean; short: string; detail?: string }[]
 cardRetry?: boolean
  } | null>(null)
  // Set when S&S declines the saved card, so we can offer a "Change payment" shortcut
  // instead of sending the buyer off to Settings.
 const [declineFix, setDeclineFix] = useState<{ profiles: PaymentProfile[]; current: string; email: string } | null>(null)
 const [pickerOpen, setPickerOpen] = useState(false)
 const [pickCard, setPickCard] = useState("")
 const [pickSaving, setPickSaving] = useState(false)
 const saveCardPick = async () => {
 setPickSaving(true)
 try {
 const r = await setFactorySettings({ ss_payment_profile: pickCard })
 if (r.error) { setMsg({ ok: false, text: r.error }); return }
 setPickerOpen(false)
      // THE STRIP GOES, it doesn't turn green. It described a decline that is no longer the
      // state, and the "place the order again" it would have said was already said by the
      // dialog you just used. Leaving a banner behind makes a finished repair look like it
      // still needs reading. `declineFix` goes with it so the Change payment shortcut it
      // powers doesn't outlive the failure that raised it.
 setMsg(null); setDeclineFix(null)
    } catch (e) {
 setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't update the payment." })
    } finally { setPickSaving(false) }
  }
  // Every action's outcome lands in ONE banner near the top of the view. But actions are
  // taken far down the list too — cancelling or receiving a placed PO — so when the banner
  // changes, scroll it into view. Otherwise the result appears off-screen and the click
  // reads as "nothing happened", which is exactly what a cancel refusal looked like.
 const msgRef = useRef<HTMLDivElement | null>(null)
 useEffect(() => {
 if (!msg) return
 const t = setTimeout(() => msgRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0)
 return () => clearTimeout(t)
  }, [msg])

  // Lines pulled out of a draft but kept for a later order. Factory-global (staff
  // share one list), so it survives the browser that removed the line.
 const [saved, setSaved] = useState<SavedPOLine[]>([])
 const [addTo, setAddTo] = useState<PurchaseOrder | null>(null)
  // Which history rows are expanded. A set, not a single id — comparing two past POs
  // side by side is the normal reason to open them.
 const [open, setOpen] = useState<Set<string>>(new Set())
 const [supplierCfg, setSupplierCfg] = useState(false)
 const [scanOpen, setScanOpen] = useState(false)
  // Otto have no saved cards, so a card order carries one. It normally comes from the card
  // on file in this browser (Order settings › Payment) and nothing opens; this is only for
  // the case where there isn't a usable one to send.
 const [needCard, setNeedCard] = useState(false)
 const [returning, setReturning] = useState<PurchaseOrder | null>(null)
  // S&S tracking, keyed by PO number. Fetched on demand rather than stored: a shipment in
  // transit changes, and a number cached at receipt time would stop being true the moment
  // it moved.
 const [tracking, setTrackingData] = useState<Record<string, SsShipment[] | "loading" | "none">>({})

  /** Pull tracking from S&S for a PO, using the order number they gave us back. */
 const fetchTracking = async (po: PurchaseOrder) => {
 const orderNo = supplierOrderNo(po)
 if (!orderNo) return
 setTrackingData((p) => ({ ...p, [po.num]: "loading" }))
 try {
 const r = await getSsTracking({ orderNumbers: [orderNo] })
 setTrackingData((p) => ({ ...p, [po.num]: r.shipments?.length ? r.shipments : "none" }))
    } catch {
 setTrackingData((p) => ({ ...p, [po.num]: "none" }))
    }
  }

 const load = useCallback(() => {
 if (!getToken()) { setInv([]); setPos([]); return }
 getInventory().then((r) => setInv(r ?? [])).catch(() => setInv([]))
 getPurchaseOrders().then((r) => setPos(r ?? [])).catch(() => setPos([]))
 getFactoryList<SavedPOLine[]>("po_saved").then((r) => setSaved(Array.isArray(r) ? r : [])).catch(() => {})
  }, [])
 useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load, refreshKey])

  // Low-stock items grouped by supplier → reorder suggestions.
 const suggestions = useMemo(() => {
 const low = (inv ?? []).filter(isLow)
 const g: Record<string, InventoryItem[]> = {}
 for (const it of low) (g[supKey(it.supplier)] ??= []).push(it)
 return g
  }, [inv])

 const [tab, setTab] = useState("cart")  // controlled so reorder can jump to what it changed
 const drafts = (pos ?? []).filter((p) => p.status === "draft")
  // In flight: placed and waiting on the supplier. These belong with the drafts, not in
  // history — an order you're still expecting is something to act on, and burying it
  // under every PO ever received is how a late delivery goes unnoticed.
 const placed = (pos ?? []).filter((p) => p.status === "placed")
  // History grows forever — every PO ever placed — so it pages. Drafts are the working
  // set and stay whole; there are never many, and hiding one behind a page would mean
  // missing something you're mid-way through.
  // Settled: received or cancelled. Nothing further is expected from these.
 const history = (pos ?? []).filter((p) => p.status === "received" || p.status === "cancelled")
 const pagedHistory = usePaged(history, 20)

  /**
   * MOVE A PO TO HISTORY WITHOUT TOUCHING THE SUPPLIER.
   *
   * Not the same action as Cancel, and the difference is the whole point. Cancel calls the
   * supplier and asks them to stop — the right thing for an order that is genuinely in
   * flight. This is for orders that are simply OVER: placed months ago, already delivered
   * or abandoned, sitting on the active board because nothing ever moved them off it. For
   * those, calling S&S to cancel a fulfilled order is at best refused and at worst
   * confusing to them.
   *
   * So it marks ours settled and says plainly that the supplier was not told. `cancelled`
   * rather than `received` because receiving ADDS STOCK, and inventing stock for a parcel
   * nobody can confirm arrived is the one outcome worse than a stale row.
   */
 const archive = async (list: PurchaseOrder[]) => {
 if (!list.length) return
 const many = list.length > 1
 if (!(await confirm({
 title: many ? `Move ${list.length} orders to history?` : `Move ${list[0].num} to history?`,
 body: "This only clears our board — the supplier is NOT contacted and nothing is cancelled with them. Nothing is received into stock either. Use it for orders that are already over.",
 confirmLabel: many ? `Move ${list.length} to history` : "Move to history",
    }))) return
 setBusy("archive"); setMsg(null)
 try {
 for (const po of list) {
 await savePurchaseOrder({
          ...po, status: "cancelled",
 meta: { ...(po.meta || {}), archivedAt: new Date().toISOString(),
 archivedNote: "Moved to history from the board — the supplier was not contacted." },
        })
      }
 setMsg({ ok: true, text: `Moved ${list.length} order${many ? "s" : ""} to history. The supplier wasn't contacted.` })
 load()
    } catch (e) {
 setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't move those to history." })
    } finally { setBusy(null) }
  }

  /**
   * Start an empty PO and open the picker on it.
   *
   * Drafts could previously only be born from a low-stock suggestion, so with nothing
   * below its reorder point there was no draft, and with no draft there was no "Add
   * items" button — the supplier catalogs were unreachable even though the picker
   * searches them. Restocking ahead of a season, or buying a blank never stocked before,
   * had no entry point at all.
   */
 const startBlankDraft = async () => {
 setBusy("new"); setMsg(null)
 const po: PurchaseOrder = { num: nextNum(), supplier: null, items: [], status: "draft" }
 try {
 const r = await savePurchaseOrder(po)
 if (r?.error) throw new Error(r.error)
 setPos((prev) => [po, ...(prev ?? [])])
 setAddTo(po)          // straight into the picker — an empty PO is not the goal
    } catch (e) {
 setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't start a new purchase order." })
    } finally { setBusy(null) }
  }

 const createDraft = async (supplier: string, items: InventoryItem[]) => {
 setBusy("new"); setMsg(null)
 const lines: POLine[] = items.map((it) => ({ sku: it.sku, name: it.name || undefined, variant: it.variant || undefined, qty: suggestQty(it), price: 0 }))
 const po: PurchaseOrder = { num: nextNum(), supplier, items: lines, status: "draft" }
 try { await savePurchaseOrder(po); load() } catch { /* ignore */ } finally { setBusy(null) }
  }

 const patchPO = (po: PurchaseOrder, items: POLine[]) => {
 setPos((prev) => (prev ?? []).map((p) => (p.num === po.num ? { ...p, items } : p)))
 savePurchaseOrder({ ...po, items }).catch(() => {})
  }
 const setLineQty = (po: PurchaseOrder, sku: string, qty: number) =>
 patchPO(po, po.items.map((l) => (l.sku === sku ? { ...l, qty } : l)))
 const removeLine = (po: PurchaseOrder, sku: string) =>
 patchPO(po, po.items.filter((l) => l.sku !== sku))

  /** What a line is still waiting on, in the unit it was ORDERED in. */
 const owedOn = (l: POLine) => Math.max(0, (Number(l.qty) || 0) - (Number(l.received) || 0))

  /**
   * BOOK THE WHOLE DELIVERY IN.
   *
   * Blanks are bought as singles here — a purchase order is commonly a dozen lines of one
   * or two pieces, raised because those variants ran out. Pressing a button per line to
   * book in one box is the work software is for.
   *
   * Every line still owed goes in one call; the server clamps each to its own outstanding,
   * so a line somebody already booked is skipped and SAID, never doubled.
   */
 const receiveAll = async (po: PurchaseOrder) => {
 const owed = po.items.map((l) => ({ sku: l.sku, qty: owedOn(l) })).filter((l) => l.qty > 0)
 if (!owed.length) return
 setBusy(`recv:${po.num}`)
 try {
 const r = await receivePurchaseOrder(po.num, owed)
 if (r?.error) throw new Error(r.error)
 const n = r.received?.length ?? 0
 const pieces = (r.received ?? []).reduce((t, g) => t + (Number(g.eaches) || 0), 0)
 setMsg(r.problems?.length
        ? { ok: false, text: r.problems.join("; ") }
 : { ok: true, text: `${n} line${n === 1 ? "" : "s"} received — ${pieces} onto the shelf.` })
 load()
    } catch (e) {
 setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't receive this delivery." })
    } finally { setBusy(null) }
  }

  /** One line, for a part delivery — the rest of the box turns up later. */
 const receiveLine = async (po: PurchaseOrder, l: POLine) => {
 const owed = owedOn(l)
 if (owed <= 0) return
 setBusy(`recv:${po.num}:${l.sku}`)
 try {
 const r = await receivePurchaseOrder(po.num, [{ sku: l.sku, qty: owed }])
 if (r?.error) throw new Error(r.error)
 const g = r.received?.[0]
      // Ordered units and shelf pieces are the same for singles and differ when a line has
      // a pack — saying only one is how "I received 2" becomes "why does it say 48".
 setMsg(r.problems?.length
        ? { ok: false, text: r.problems.join("; ") }
 : { ok: true, text: g
            ? `${g.qty} × ${l.sku}${(g.pack ?? 1) > 1 ? ` (${g.pack} per pack = ${g.eaches})` : ""} received — ${g.inStock} on the shelf.`
 : `Received ${owed} × ${l.sku}.` })
 load()
    } catch (e) {
 setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't receive that line." })
    } finally { setBusy(null) }
  }

  // Persist the shared saved-for-later list. Optimistic: the UI moves immediately,
  // the blob is replaced wholesale (that's the factory_lists contract).
  //
  // RETURNS THE WRITE, so a caller that is about to reload can wait for it. `load()`
  // re-GETs this same list, and an un-awaited PUT races that GET: the stale read lands
  // last, the lines that were just ordered reappear in the pool, and the obvious next
  // click sends them to the supplier a SECOND time. A duplicate purchase order is the
  // one mistake here that costs real money, so the ordering is not optional.
 const putSaved = (next: SavedPOLine[]) => {
 setSaved(next)
 return saveFactoryList("po_saved", next).then(cartChanged).catch(() => {})
  }
  /** Pull a line OUT of the draft but keep it — the common "not this order, next one" case. */
 const saveForLater = (po: PurchaseOrder, l: POLine) => {
 removeLine(po, l.sku)
 if (saved.some((s) => lineKey(s) === lineKey(l))) return   // already parked, same sku AND variant
 putSaved([...saved, { ...l, supplier: po.supplier ?? null, savedAt: new Date().toISOString() }])
  }
  /** Put a parked line back on a draft, merging the qty if the sku is already there. */
 const restore = (l: SavedPOLine) => {
 const target = drafts.find((p) => supKey(p.supplier) === supKey(l.supplier)) ?? drafts[0]
 if (!target) { setMsg({ ok: false, text: "No draft PO open — create one first, then restore into it." }); return }
 const hit = target.items.find((x) => lineKey(x) === lineKey(l))
 patchPO(target, hit
      ? target.items.map((x) => (lineKey(x) === lineKey(l) ? { ...x, qty: num(x.qty) + num(l.qty) } : x))
 : [...target.items, { sku: l.sku, name: l.name, variant: l.variant, qty: num(l.qty) || 1, price: l.price }])
 putSaved(saved.filter((s) => s.sku !== l.sku))
  }
  /** Merge lines into an existing set, combining quantities on a repeated sku. Pure, so
   * the "add items" path and the reorder path can't drift apart. */
  /**
   * WHAT MAKES TWO LINES THE SAME LINE — sku AND variant, never sku alone.
   *
   * Everything here used to match on sku only, and a supplier sku is frequently a STYLE
   * ("EG-1003", "G500"), not a colour and size. So 10 White / XL and 2 Black / 2XL of the
   * same style collapsed into a single 12-unit line wearing whichever variant happened to
   * be first — and that line is what gets ordered. You would receive twelve of one thing
   * and none of the other, and nothing on screen would ever have said so.
   *
   * The same key governs the cart, the draft merge, the reorder, and which lines a
   * successful placement removes from the pool. Any one of them keyed on sku alone
   * reintroduces the fault from a different direction: placing White / XL would clear
   * Black / 2XL out of the cart unordered.
   *
   * Trimmed and case-folded because "Black / 2XL" and "black / 2xl" are one variant typed
   * by two people, and treating them as two would split a line that should merge.
   */
 const lineKey = (l: { sku?: string | null; variant?: string | null }) =>
    `${String(l.sku ?? "").trim().toUpperCase()}|${String(l.variant ?? "").trim().toLowerCase()}`

 const mergeLines = (existing: POLine[], add: POLine[]): POLine[] => {
 const next = existing.map((l) => ({ ...l }))
 for (const l of add) {
 const hit = next.find((x) => lineKey(x) === lineKey(l))
 if (hit) hit.qty = num(hit.qty) + (num(l.qty) || 1)
 else next.push({ ...l, qty: num(l.qty) || 1 })
    }
 return next
  }
  /** Add picked supplier-catalog / inventory lines onto a draft, merging by sku. */
 const addLines = (po: PurchaseOrder, lines: POLine[]) => patchPO(po, mergeLines(po.items, lines))

  /**
   * Place a PO — split by the SUPPLIER EACH LINE ACTUALLY COMES FROM.
   *
   * A draft is assembled from whatever was low, so one PO routinely holds blanks from
   * two suppliers. Sending it as a single order meant everything went to whichever
   * supplier the PO's NAME matched — the other supplier's lines included, ordered from a
   * company that doesn't stock them.
   *
   * So: resolve every line's supplier from the catalogs (server-side — the sku is either
   * in S&S's catalog or it isn't, which beats matching a typed name), group the lines,
   * and place one order per supplier. Each group becomes its own PO so what was ordered
   * from whom is recorded separately — a single receipt covering two suppliers can't
   * later answer "what did S&S actually send us".
   *
   * Lines whose supplier can't be resolved are NOT sent anywhere. They stay behind on a
   * draft to be handled by hand, because the failure mode of guessing here is a real
   * order placed with the wrong company.
   */
 const place = async (po: PurchaseOrder) => {
 const lines = po.items.filter((l) => num(l.qty) > 0)
 if (!lines.length) { setMsg({ ok: false, text: "Add at least one item with a quantity." }); return }
 setBusy(po.num); setMsg(null)
 try {
 const [{ bySku }, opts] = await Promise.all([
 resolveSuppliers(lines.map((l) => l.sku)),
 getSupplierOptions(),
      ])

      // No delivery address means the supplier has nowhere to send the blanks. Refuse
      // rather than place an order that arrives nowhere — this is the one field a
      // purchase order genuinely cannot be completed without.
 if (!opts.shipToComplete) {
 setMsg({ ok: false, text: "Your warehouse address is incomplete, so there's nowhere for the blanks to be delivered. Set it in Settings › Ship-from address, or via Order settings." })
 return
      }

      // Group by the API that can place it; unresolved lines are kept aside, not sent.
 const groups = new Map<string, { api: "ss" | "otto" | null; supplier: string | null; lines: POLine[] }>()
 for (const l of lines) {
 const r = bySku[l.sku] ?? { api: null, supplier: null, source: "unknown" }
        // Key on the API when there is one, else on the supplier name, so two hand-ordered
        // suppliers don't collapse into one pile.
 const key = r.api ?? `manual:${r.supplier ?? "unassigned"}`
 if (!groups.has(key)) groups.set(key, { api: r.api, supplier: r.supplier, lines: [] })
 groups.get(key)!.lines.push(l)
      }

 const parts = [...groups.values()]
 const placedAt = new Date().toISOString()
 const results: string[] = []

 for (const [i, g] of parts.entries()) {
 const payload = g.lines.map((l) => ({ sku: l.sku, qty: num(l.qty) }))
 let resp: unknown = { manual: true }
 let placedOk = true
 try {
          // The rest of what a purchase order needs: where it goes, how it ships, how it
          // pays, and a PO number that ties their confirmation back to this row.
 if (g.api === "otto") {
            // HELD BACK, not sent — see NO_AUTO_ORDER. Thrown so this group lands in
            // the same "did not place" path a failure uses, which already reports the
            // supplier by name and leaves its lines in the cart.
 throw new Error(HELD_BACK)
          } else if (g.api === "ss") {
 const r = await ssOrder(payload, {
 shippingAddress: opts.shipTo,
 shippingMethod: opts.defaults.ss_shipping_method || undefined,
 email: opts.defaults.ss_order_email || opts.defaults.order_email || undefined,
 poNumber: po.num,
              // Same as the place-all path: send the selected saved card, else account terms.
 paymentProfileId: opts.defaults.ss_payment_profile || undefined,
 paymentProfileEmail: opts.defaults.ss_order_email || opts.defaults.order_email || undefined,
            })
 if (r.error) throw new Error(r.error); resp = r
          }
        } catch (e) {
 placedOk = false
 resp = { error: e instanceof Error ? e.message : "failed" }
        }

        // One PO per supplier. The original keeps its number when there's only one group,
        // so the common single-supplier case doesn't gain a confusing suffix.
 const numFor = parts.length === 1 ? po.num : `${po.num}-${(g.supplier || "MANUAL").replace(/[^A-Za-z0-9]+/g, "").slice(0, 6).toUpperCase() || String(i + 1)}`
 await savePurchaseOrder({
          ...po,
 num: numFor,
 supplier: g.supplier ?? po.supplier ?? null,
          // Priced as they go out — see freezeLines.
 items: freezeLines(g.lines),
 status: placedOk && g.api ? "placed" : placedOk ? "placed" : "draft",
 meta: { ...(po.meta || {}), response: resp, placedAt, api: g.api, splitFrom: parts.length > 1 ? po.num : undefined },
        })
        // Say what ACTUALLY happened, not a blanket "test/dry-run": a real dry run (live
        // keys off) never reached the supplier, while a live placement returns an order
        // number worth surfacing. The old hardcoded line made a placed order look like a
        // dry run and vice-versa — the exact confusion behind "why can't I cancel this".
 const rr = resp as Record<string, unknown>
 const dry = rr.dryRun === true
 const ssNo = (() => {
 const os = rr.orders
 if (Array.isArray(os)) for (const o of os) { const n = (o as { orderNumber?: unknown })?.orderNumber; if (n) return String(n) }
 return null
        })()
 results.push(
          !placedOk ? `${g.supplier ?? "Unassigned"}: failed — ${(resp as { error?: string }).error}`
 : g.api ? (dry
                ? `${g.supplier}: DRY RUN — not sent to ${g.api === "ss" ? "S&S" : "Otto"} (live keys off). Set SS_ORDER_LIVE=1 to place for real.`
 : `${g.supplier}: placed${ssNo ? ` — ${g.api === "ss" ? "S&S" : "Otto"} order #${ssNo}` : " — but no order number came back; check for line errors"}`)
 : `${g.supplier ?? "Unassigned"}: marked placed, order it manually (no supplier API for these SKUs)`
        )
      }

      // The original is superseded by its parts; leaving it would double-count the spend.
 if (parts.length > 1) await deletePurchaseOrder(po.num).catch(() => {})

      // A mixed result is neither. Reporting "S&S sent, Otto failed" in red reads as
      // nothing having happened — and the S&S half really was placed, so acting on that
      // belief means placing it twice.
 const anyFailed = results.some((r) => r.includes("failed"))
 const anySent = results.some((r) => !r.includes("failed"))
 setMsg({
 ok: !anyFailed,
 tone: anyFailed && anySent ? "warn" : undefined,
 text: (anyFailed && anySent ? "Partly placed. " : "") + results.join(" · "),
      })
 load()
    } catch (e) {
 setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't place the order." })
    } finally { setBusy(null) }
  }

  // Receive: add each line's qty into inventory, mark the PO received.
 const receive = async (po: PurchaseOrder) => {
 setBusy(po.num); setMsg(null)
 try {
      /**
       * PER LINE, NEVER THE WHOLE LIST.
       *
       * This built the entire inventory array and POSTed it. That endpoint REPLACES the
       * table: every sku missing from the payload is deleted, and every row's value is
       * written from this page's snapshot. On a floor where a scan gun is writing to the
       * same rows, receiving one carton that way erases whatever was counted while this
       * page sat open — and deletes any sku added since it loaded. The Incoming-stock panel
       * already writes per line; this one is where the risk actually lived, because
       * Purchasing is where cartons are received.
       *
       * The shelf is re-read HERE rather than trusted from state, for the same reason: the
       * count to add to is the one in the database now, not the one this page fetched.
       *
       * Matched on sku, which is what inventory is keyed by. The old sku+variant key could
       * find nothing and push a duplicate row for a sku that already existed — two rows for
       * one shelf, which the whole-list write would then persist.
       */
 const live = (await getInventory()) ?? []
 const bySku = new Map(live.map((it) => [String(it.sku).toUpperCase(), it]))
 for (const l of po.items) {
 const key = String(l.sku || "").trim().toUpperCase()
 if (!key) continue
 const existing = bySku.get(key)
 if (existing) await patchInventoryItem(existing.sku, { in_stock: num(existing.in_stock) + num(l.qty) })
 else await addInventoryItem({
 sku: l.sku, name: l.name, variant: l.variant, in_stock: num(l.qty),
 reorder_at: 25, supplier: po.supplier ?? undefined, visibility: "factory",
        })
      }
 await savePurchaseOrder({ ...po, status: "received", meta: { ...(po.meta || {}), receivedAt: new Date().toISOString() } })
      // Re-read rather than setting a locally-built array: the shelf just changed under
      // several writes, and the truth is the server's.
 getInventory().then((r) => setInv(r ?? [])).catch(() => {})
 setMsg({ ok: true, text: "Received into inventory." }); load()
    } catch { setMsg({ ok: false, text: "Couldn't receive." }) } finally { setBusy(null) }
  }

  /** The supplier's own order number, dug out of whatever shape their response took. */
  /**
   * The supplier's own order number, out of whatever shape their response took.
   *
   * This missed the successful case entirely. A placed S&S order comes back as
   * `{ orders: [{ orderNumber }], ssResponse: [...] }` — the number is one level down
   * inside an ARRAY, and reading only the top level returned null. Cancel then skipped
   * the supplier call without a word and cancelled our record alone, which is exactly
   * the failure the warning text was trying to prevent.
   */
  /** The same read, against a response we are HOLDING rather than one already stored on a
   *  PO — so the message shown at placement can name the order number the supplier just
   * gave us, without waiting for the reload that persists it. */
 const supplierOrderNoOf = (resp: unknown): string | null => {
 const r = (resp ?? {}) as Record<string, unknown>
 const pick = (o: unknown): string | null => {
 if (!o || typeof o !== "object") return null
      // Their responses are arrays as often as objects — one entry per warehouse.
 if (Array.isArray(o)) { for (const x of o) { const v = pick(x); if (v) return v } return null }
 const rec = o as Record<string, unknown>
 const v = rec.orderNumber ?? rec.order_number ?? rec.orderNo ?? rec.salesOrderNumber
 return v == null || v === "" ? null : String(v)
    }
 return pick(r.orders) ?? pick(r.ssResponse) ?? pick(r.ottoResponse) ?? pick(r)
  }
 const supplierOrderNo = (po: PurchaseOrder): string | null =>
 supplierOrderNoOf(((po.meta || {}) as Record<string, unknown>).response)
 const trackingOf = (po: PurchaseOrder): string =>
    String(((po.meta || {}) as Record<string, string>).tracking ?? "")

  /** Record a carrier tracking number against a PO, so an inbound box can be chased. */
 const setTracking = async (po: PurchaseOrder, tracking: string) => {
 const meta = { ...(po.meta || {}), tracking: tracking.trim() || undefined }
 setPos((prev) => (prev ?? []).map((p) => (p.num === po.num ? { ...p, meta } : p)))
 await savePurchaseOrder({ ...po, meta }).catch(() => {})
  }

  /**
   * Cancel a PO.
   *
   * This cancels OUR record. It does NOT reach the supplier: neither S&S's nor Otto's
   * cancel endpoint has been wired or verified, and quietly marking a live order
   * cancelled while the goods are still on a truck is the worst outcome available —
   * stock arrives that nothing expects, against an order the system says never existed.
   *
   * So a placed PO says so plainly and asks for confirmation. A draft was never sent
   * anywhere, so it just goes.
   */
 const cancelPO = async (po: PurchaseOrder) => {
 const wasPlaced = po.status === "placed"
 const sent = reallySent(po)
    // Only warn about phoning the supplier when there IS an order at the supplier.
    // Telling someone to chase a dry run sends them looking for something that was never
    // there — which is exactly what happened.
    // The warning has to match what the code below actually does, which it did not: it
    // said "does NOT cancel the order with the supplier" while cancelPO asks S&S FIRST
    // and refuses to touch our record if they decline. Someone read that, believed the
    // order was still live, and phoned a supplier who had already cancelled it.
 const isSsPo = /s&s|activewear/i.test(po.supplier || "")
 if (wasPlaced && sent && !(await confirm(
 isSsPo
        ? { title: `Cancel ${po.num} with S&S?`, confirmLabel: "Cancel order" }
 : { title: `Cancel ${po.num}?`, body: `${po.supplier || "This supplier"} has no cancel API — you'll need to contact them directly to stop the actual order.`, confirmLabel: "Cancel order" }
    ))) return
 setBusy(po.num); setMsg(null)
 try {
      // Ask the SUPPLIER first, where we can. Marking our record cancelled while their
      // order stands is the failure that costs money — stock arrives against an order the
      // system says doesn't exist. But an order the operator has ALREADY cancelled with S&S
      // directly must still be clearable here, or it's stuck as "placed" forever — so when
      // the API can't confirm, we fall back to an explicit, warned attestation rather than
      // a dead-end.
 let supplierCancelled = false   // S&S themselves confirmed (API or status reconcile)
 let manualCancel = false        // operator attested they cancelled it out-of-band
 let reconciled = false          // S&S already had it cancelled — we just caught our record up
 const orderNo = supplierOrderNo(po)
 const isSs = /s&s|activewear/i.test(po.supplier || "")
      // No order number means we CAN'T ask S&S — so we can't verify, but we also can't
      // leave it stuck. Let the operator attest they've already cancelled it directly.
 if (sent && isSs && !orderNo) {
        // No S&S number was recorded at placement. RESOLVE it from OUR po number — we sent
        // it as the poNumber, and S&S's /orders/{reference} accepts it — so cancellation is
        // automatic and nobody has to hunt for their number. If it still can't be found,
        // fall back to pasting it; blank = attest it was already stopped directly.
 const ref = String((po.meta as { splitFrom?: string } | undefined)?.splitFrom || po.num)
 const looked = await getSsOrder(ref).catch(() => null)
 let numToCancel: string | null = (looked?.orders?.find((o) => o.orderNumber)?.orderNumber) || null
 if (!numToCancel) {
 const entered = await prompt({
 title: `Cancel ${po.num} with S&S`,
 body: `No S&S order number is saved and we couldn't find one by PO number. Paste it (from the portal or confirmation email) to cancel via their API — or leave blank if you've already cancelled it with S&S directly.`,
 placeholder: tl("purchase", "S&S order number"),
 required: false,
 confirmLabel: "Cancel order",
 cancelLabel: "Back",
          })
 if (entered === null) { setMsg({ ok: false, text: `${po.num} left as-is.` }); return }
 numToCancel = entered.trim() || null
        }
 if (numToCancel) {
 const c = await cancelSsOrder(numToCancel).catch((e) => ({ error: e instanceof Error ? e.message : "failed" }))
 if ("error" in c && c.error) {
 if (!(await confirm({
 title: `S&S wouldn't cancel ${numToCancel}`,
 body: `${c.error}. If you've already cancelled it with S&S directly, mark it cancelled here — but only if S&S has actually stopped it, or the blanks will still ship.`,
 confirmLabel: "Mark cancelled",
            }))) { setMsg({ ok: false, text: `S&S wouldn't cancel ${numToCancel}: ${c.error}` }); return }
 manualCancel = true
          } else {
 reconciled = (c as { reconciled?: boolean }).reconciled === true
 supplierCancelled = true
          }
        } else {
 if (!(await confirm({
 title: `Mark ${po.num} cancelled without an order number?`,
 body: `Only do this if S&S has actually stopped it — otherwise the blanks will still ship.`,
 confirmLabel: "Mark cancelled",
          }))) { setMsg({ ok: false, text: `${po.num} left as-is. Cancel it in the S&S portal, then use Cancel again to clear it here.` }); return }
 manualCancel = true
        }
      } else if (sent && isSs && orderNo) {
 const c = await cancelSsOrder(orderNo).catch((e) => ({ error: e instanceof Error ? e.message : "failed" }))
 if ("error" in c && c.error) {
          // S&S declined via the API (almost always past their 10-minute window). Don't
          // dead-end: show their reason and let the operator attest they cancelled it in
          // the portal — otherwise a genuinely-cancelled order can never be cleared.
 if (!(await confirm({
 title: `S&S wouldn't cancel ${orderNo}`,
 body: `${c.error}. If you've already cancelled it with S&S directly, mark it cancelled here — but only if S&S has actually stopped it, or the blanks will still ship.`,
 confirmLabel: "Mark cancelled",
          }))) { setMsg({ ok: false, text: `S&S wouldn't cancel ${orderNo}: ${c.error}` }); return }
 manualCancel = true
        } else {
          // Reconciled = the API cancel was too late, but S&S already had it cancelled, so
          // this is catching our stale record up rather than stopping a live order.
 reconciled = (c as { reconciled?: boolean }).reconciled === true
 supplierCancelled = true
        }
      }

 const r = await savePurchaseOrder({
        ...po, status: "cancelled",
 meta: { ...(po.meta || {}), cancelledAt: new Date().toISOString(), supplierCancelled, manualCancel: manualCancel || undefined },
      })
 if (r?.error) throw new Error(r.error)
 setMsg({ ok: true, text: !wasPlaced || !sent
        ? `${po.num} cancelled.`
 : supplierCancelled
          ? `${po.num} cancelled successfully.${reconciled ? " (S&S already had it cancelled.)" : ""}`
 : manualCancel
            ? `${po.num} cancelled — you confirmed it was already stopped with ${po.supplier || "the supplier"} directly.`
            // Otto document no cancel endpoint, so theirs is still a phone call.
 : `${po.num} cancelled here — ${po.supplier || "the supplier"} has no cancel API, so contact them to stop the actual order.` })
 load()
    } catch (e) {
 setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't cancel that purchase order." })
    } finally { setBusy(null) }
  }

  // ── The "to order" pool, split by supplier ─────────────────────────────────
  // Suppliers are resolved SERVER-side from the synced catalogues — a sku is either in
  // S&S's or it isn't — never guessed from a typed name. That guess is what once sent
  // every "Unassigned" PO to S&S, because "unassigned" contains "ss".
  // Images for lines inside an opened purchase order. Historic POs predate line images,
  // so they're resolved by sku when a row is expanded — not on load, since most rows are
  // never opened and a lookup per PO would cost a query for nothing.
 const [poImgs, setPoImgs] = useState<Record<string, string>>({})
 const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null)
  // A ticking clock, so the S&S 10-minute cancellation window counts down on screen
  // instead of freezing at whatever it was when the page rendered.
 const [now, setNow] = useState(0)
 useEffect(() => {
    // Deferred, not synchronous: setting state directly in an effect body cascades a
    // second render immediately. The pattern used across the app pages here.
 const first = setTimeout(() => setNow(Date.now()), 0)
 const id = setInterval(() => setNow(Date.now()), 30000)
 return () => { clearTimeout(first); clearInterval(id) }
  }, [])
  // Per-warehouse stock for the lines about to be ordered, and how long each warehouse
  // takes to reach us. Together they answer what the blank space was leaving unsaid: not
  // "is there stock" but WHERE, and whether pulling from there costs a day.
 const [stock, setStock] = useState<Record<string, { total: number; warehouses: { abbr: string; qty: number }[] }>>({})
  // Per-warehouse quantities, keyed "sku:ABBR". Empty everywhere = today's behaviour:
  // autoselectWarehouse stays on and S&S split the line themselves. The server refuses the
  // contradiction of picks WITH autoselect on, so this drives that flag too.
 const [split, setSplit] = useState<Record<string, string>>({})
 const [transit, setTransit] = useState<Record<string, { days: number | null; cutOff: string }>>({})

  /* `price` is the supplier catalogue's last synced per-unit figure — see unitPrice, and
 the note on resolveSuppliers for why it is a reference and not a quote. */
 const [supByS, setSupByS] = useState<Record<string, { api: "ss" | "otto" | null; supplier: string | null; image?: string | null; variant?: string | null; price?: number | null }>>({})
 useEffect(() => {
 const skus = saved.map((l) => l.sku).filter(Boolean)
 if (!skus.length) return
 const t = setTimeout(() => {
 resolveSuppliers(skus).then((r) => setSupByS(r.bySku ?? {})).catch(() => {})
    }, 0)
 return () => clearTimeout(t)
  }, [saved])

  // Stock + transit for the S&S lines in the pool. S&S only: Otto's inventory endpoint
  // takes one sku per call, which would be a request per line.
 useEffect(() => {
 const ssSkus = saved.filter((l) => supByS[l.sku]?.api === "ss").map((l) => l.sku)
 if (!ssSkus.length) return
 const t = setTimeout(() => {
 getSsInventory(ssSkus)
        .then((r) => setStock(Object.fromEntries((r.items ?? []).map((i) => [i.sku, { total: i.total, warehouses: i.warehouses }]))))
        .catch(() => {})
 getSsDaysInTransit()
        .then((r) => setTransit(Object.fromEntries((r.warehouses ?? []).map((w) => [w.warehouse, { days: w.days, cutOff: w.cutOff }]))))
        .catch(() => {})
    }, 0)
 return () => clearTimeout(t)
  }, [saved, supByS])

  /**
   * Otto stock, one call per sku — their endpoint takes a single sku, so this is capped
   * rather than run over an unbounded pool.
   *
   * `null` means WE COULD NOT READ IT, and that is deliberately not 0. Otto's route is a
   * raw passthrough typed `unknown`; the field holding the count has never been seen
   * against a live account, so ottoQty below tries the plausible names and gives up
   * honestly rather than reporting a zero it invented. "Out of stock" and "we don't know"
   * lead to opposite decisions, and only one of them is ours to guess at.
   */
 const [ottoStock, setOttoStock] = useState<Record<string, number | null>>({})
 useEffect(() => {
 const skus = saved.filter((l) => supByS[l.sku]?.api === "otto").map((l) => l.sku).slice(0, 20)
 if (!skus.length) return
 const t = setTimeout(() => {
 for (const sku of skus) {
 getOttoInventory(sku)
          .then((r) => setOttoStock((p) => ({ ...p, [sku]: ottoQty(r) })))
          .catch(() => setOttoStock((p) => ({ ...p, [sku]: null })))
      }
    }, 0)
 return () => clearTimeout(t)
  }, [saved, supByS])

  /**
   * WHAT ONE UNIT COSTS, and where the figure came from.
   *
   * A line's own `price` is what someone put on it — a browse row carries the price it was
   * added at, and a hand-typed line carries what was typed. Lines drafted from a low-stock
   * check or auto-added from an order shortfall carry NONE, so the cart showed "—" on real
   * goods and the order total counted them as zero. The supplier catalogue has had a price
   * per sku the whole time, and the cart already asks that catalogue about every sku on it.
   *
   * `from` is not decoration. "catalog" is the LAST SYNCED figure, not a quote — both
   * suppliers price the order when it is placed — so it is shown in muted ink with the
   * source in the title, and a total built on it says so. Reporting it as a firm price is
   * how a $4.85 estimate becomes a complaint about a $5.40 invoice.
   */
 const unitPrice = useCallback((l: { sku: string; price?: number | null }) => {
 const own = num(l.price)
 if (own) return { unit: own, from: "line" as const }
 const cat = supByS[l.sku]?.price
 return cat != null && isFinite(Number(cat)) && Number(cat) > 0
      ? { unit: Number(cat), from: "catalog" as const }
 : { unit: 0, from: "none" as const }
  }, [supByS])

  /**
   * FREEZE WHAT THE LINES COST, at the moment of placing.
   *
   * A placed PO is a record of a purchase, and what a past order cost is a fact — it must
   * not be re-estimated from a catalogue that has since been re-synced, and it must not
   * read as free because the line was drafted without a price. So the figure the cart was
   * showing is written ONTO the line as it is placed, marked `priceSource: "catalog"` so it
   * is never mistaken for a supplier confirmation.
   *
   * Only where there is something to freeze: a line with its own price keeps it untouched,
   * and a line with no price anywhere stays unpriced rather than being stamped 0 — an
   * invented zero would read as free, permanently, on a document nobody revisits.
   */
 const freezeLines = useCallback(<T extends { sku: string; price?: number | null }>(lines: T[]) =>
 lines.map((l) => {
 const { unit, from } = unitPrice(l)
 return from === "catalog" && unit > 0 ? { ...l, price: unit, priceSource: "catalog" as const } : l
    }), [unitPrice])

 const toOrderGroups = useMemo(() => {
 const g = new Map<string, { key: string; api: "ss" | "otto" | null; supplier: string | null; lines: SavedPOLine[]; total: number }>()
 for (const l of saved) {
 const r = supByS[l.sku] ?? { api: null, supplier: l.supplier ?? null }
 const key = r.api ?? `manual:${r.supplier ?? l.supplier ?? "unassigned"}`
 if (!g.has(key)) g.set(key, { key, api: r.api, supplier: r.supplier ?? l.supplier ?? null, lines: [], total: 0 })
 const grp = g.get(key)!
 grp.lines.push(l)
      // The same figure the LINE shows. A total that silently counts an unpriced line as
      // zero disagrees with the rows above it, and the row is the one people check.
 grp.total += unitPrice(l).unit * num(l.qty)
    }
 return [...g.values()]
  }, [saved, supByS, unitPrice])
 const toOrderTotal = toOrderGroups.reduce((s, g) => s + g.total, 0)
  /** Split by what this screen can actually send. Otto is in `handGroups` by rule, not by
   * accident — see NO_AUTO_ORDER. */
 const autoGroups = toOrderGroups.filter((g) => placeable(g.api))
 const handGroups = toOrderGroups.filter((g) => !placeable(g.api))

  /**
   * WHAT FREIGHT ACTUALLY COST LAST TIME, per supplier.
   *
   * It cannot be quoted before placing. Otto expose no rate endpoint (nine candidate paths
   * probed against their live API — none), and S&S bill it on the invoice; both only tell
   * us the number in the ORDER RESPONSE, which is why grand_total is read from there.
   *
   * So the cart shows history, labelled as history, rather than an estimate dressed as a
   * quote. On a $1.50 cap that arrived billed at $18.91 the freight is the whole decision,
   * and "we don't know yet" with last month's real figure beside it is far more use than a
   * confident number nobody can stand behind.
   */
 const lastFreightBySupplier = useMemo(() => {
 const out: Record<string, { freight: number; goods: number; at: string }> = {}
 for (const po of pos ?? []) {
 const r = (po.meta as { response?: { ottoResponse?: { sub_total?: string; shipping_total?: string }[] }; placedAt?: string } | null)?.response
 const o = r?.ottoResponse?.[0]
 const freight = Number(o?.shipping_total)
 const goods = Number(o?.sub_total)
 if (!Number.isFinite(freight) || freight <= 0) continue
 const key = (po.supplier || "").trim()
 const at = String((po.meta as { placedAt?: string } | null)?.placedAt || po.created_at || "")
      // Most recent wins — an older freight figure is a worse guide than a newer one.
 if (!out[key] || at > out[key].at) out[key] = { freight, goods: Number.isFinite(goods) ? goods : 0, at }
    }
 return out
  }, [pos])
  // What the Active tab actually shows: lines waiting to be ordered, plus orders in
  // flight. Counting anything else makes the badge a claim you can't verify on screen.
 const activeCount = saved.length + placed.length

 const setSavedQty = (sku: string, qty: number) =>
 putSaved(saved.map((l) => (l.sku === sku ? { ...l, qty } : l)))

  /**
   * Place every group — one purchase order per supplier, in one action.
   *
   * The split is already on screen, so this holds no surprises: what you saw grouped is
   * what gets sent, as separate orders, because one receipt covering two suppliers can't
   * later answer "what did S&S actually send us".
   *
   * Lines that go out leave the pool; anything that FAILED stays, so a retry re-sends
   * only what didn't make it rather than duplicating what did.
   */
 const placeAllGroups = async (card?: CardDetails) => {
 if (!saved.length) return
 const opts = await getSupplierOptions().catch(() => null)
 if (!opts?.shipToComplete) {
 setMsg({ ok: false, text: "Your warehouse address is incomplete, so there's nowhere for the blanks to be delivered. Set it in Order settings." })
 return
    }
    // Check what each supplier REQUIRES before sending. Their rejections are accurate but
    // name their own fields, and arrive one round trip later — "shipping_address.state:
    // California is not a valid choice" is a better message than nothing, but a refusal
    // that names the setting to change is better still.
    // OTTO NEED THE CARD ON THE REQUEST. This was set to false on the belief that a card
    // order with no card_details makes Otto bill the card already on the account — and Otto
    // themselves say otherwise. Their live reply, on a sandbox order placed 2026-08-10:
    //
    //   "Otto reject a credit-card order with no card on it — they do not bill a card held
    // on your account."
    //
    // So every Otto card order failed, and it failed for a reason nothing on this page
    // asked about, because the dialog that collects the number had been removed. The belief
    // and the removal pointed the same wrong way, which is why it never recovered.
    //
    // Only for a CARD order: an account on terms sends no card and needs none, and asking
    // for a PAN it will not use is the thing the previous change was right to object to.
    // The card is sent with that ONE request — the server strips it from anything it echoes
    // back, so it never reaches purchase_orders.meta and never lands in a nightly pg_dump.
    // Nothing on OUR side stores a card.
    //
    // WHERE IT COMES FROM has changed: it's entered once at Order settings › Payment and
    // kept in this browser (lib/otto-card.ts), so the dialog no longer opens on every
    // purchase. `card` is the dialog's answer and wins when present; otherwise the card on
    // file is used, and only when there is no usable one — none saved, or the saved one has
    // expired — does anything get asked.
    //
    // NB the server also refuses a typed card unless OTTO_CARD_ORDERS=1, so that env must
    // be set or the card is stripped and Otto reject the order for the same reason again.
 const ottoCard = card ?? usableCard() ?? undefined
 const ottoNeedsCard = /credit\s*card/i.test(String(opts.defaults.otto_payment_method || "")) && !ottoCard
 const ottoMissingParty = !(opts.defaults.otto_customer && opts.defaults.otto_contact)

 setBusy("place-all"); setMsg(null)
 const outcomes: { supplier: string; ok: boolean; short: string; detail?: string }[] = []
 const results: string[] = []
 const placedKeys = new Set<string>()
    // The Otto lines held back for a card — the SKUs themselves, not a flag. A flag can
    // only say "something was deferred"; what has to be true before re-opening the card
    // dialog is that those particular lines are still unplaced.
 const deferredForCard = new Set<string>()
 try {
 for (const g of toOrderGroups) {
        // Otto's blockers are Otto's alone — skip the Otto group (leave it in the pool) but
        // never stop S&S/manual from going out.
 if (g.api === "otto" && ottoNeedsCard) {
          // Only lines that would ACTUALLY be ordered. A group sitting entirely at qty 0
          // places nothing, and asking for a card number to pay for nothing is how the
          // dialog kept re-appearing with no order behind it.
 for (const l of g.lines) if (num(l.qty) > 0) deferredForCard.add(lineKey(l))
 continue
        }
 if (g.api === "otto" && ottoMissingParty) {
 results.push(`${g.supplier ?? "Otto"}: needs a customer + contact (Order settings › Payment) — left in the pool`)
 continue
        }
 const poNum = nextNum()
 const payload = g.lines.map((l) => ({ sku: l.sku, qty: num(l.qty) })).filter((l) => l.qty > 0)
 if (!payload.length) continue
 let resp: unknown = { manual: true }
 let ok = true
 try {
 if (g.api === "otto") {
            // HELD BACK, not sent — see NO_AUTO_ORDER. Thrown so this group lands in
            // the same "did not place" path a failure uses, which already reports the
            // supplier by name and leaves its lines in the cart.
 throw new Error(HELD_BACK)
          } else if (g.api === "ss") {
 const r = await ssOrder(payload, {
 shippingAddress: opts.shipTo, shippingMethod: opts.defaults.ss_shipping_method || undefined,
              // S&S's OWN registered address — the accounts use different emails, and
              // the payment profile is looked up against this one.
 email: opts.defaults.ss_order_email || opts.defaults.order_email || undefined,
 poNumber: poNum,
              // Which saved card pays. Omitted entirely when unset, so the account's own
              // terms apply rather than an empty profile being sent.
 paymentProfileId: opts.defaults.ss_payment_profile || undefined,
 paymentProfileEmail: opts.defaults.ss_order_email || opts.defaults.order_email || undefined,
            })
 if (r.error) throw new Error(r.error); resp = r
          }
        } catch (e) {
 ok = false
 resp = { error: e instanceof Error ? e.message : "failed" }
        }
        // The PO record is created HERE, at the moment of placing — never before. That
        // document existing beforehand is exactly what "draft PO" was.
 await savePurchaseOrder({
          // Priced as they go out — see freezeLines.
 num: poNum, supplier: g.supplier ?? null, items: freezeLines(g.lines), status: ok ? "placed" : "draft",
 meta: { response: resp, placedAt: new Date().toISOString(), api: g.api },
        }).catch(() => {})
 if (ok) g.lines.forEach((l) => placedKeys.add(lineKey(l)))
 const failMsg = (resp as { error?: string }).error || "failed"
        // A card decline on an S&S order is S&S's OWN saved payment profile (Order settings ›
        // Payment) — never the card typed for Otto, which S&S never receives. Spell that out,
        // because otherwise it reads as "the card I just entered doesn't work". A bank/
        // processor decline also needs a next step, not just a "which card" — the fix is with
        // the card itself, not our code.
 const isBankDecline = g.api === "ss" && /processor_declined|issuing bank|declined/i.test(failMsg)
        // Surface a "Change payment" shortcut with the account's saved cards, so a decline
        // is fixable in place rather than a trip to Order settings.
 if (isBankDecline) setDeclineFix({
 profiles: opts.suppliers.ss.paymentProfiles?.profiles ?? [],
 current: opts.defaults.ss_payment_profile || "",
 email: opts.defaults.ss_order_email || opts.defaults.order_email || "",
        })
 const clarified = isBankDecline
          ? `${failMsg} — S&S's own saved card (Order settings › Payment), not the Otto card. The bank declined it: check it isn't expired or over its limit, update it with S&S, or pick another saved card.`
 : g.api === "ss" && /card|payment/i.test(failMsg)
            ? `${failMsg} — this is S&S's saved payment (Order settings › Payment), not the Otto card`
 : failMsg
        // Say what ACTUALLY happened. A real placement returns an order number → "placed
        // successfully"; a dry run (live ordering off) never reached S&S and must NOT read
        // as placed, or blanks look ordered when they aren't.
 const rr = resp as Record<string, unknown>
 const dry = rr.dryRun === true
 const ssNo = (() => {
 const os = rr.orders
 if (Array.isArray(os)) for (const o of os) { const n = (o as { orderNumber?: unknown })?.orderNumber; if (n) return String(n) }
 return null
        })()
 const ottoNo = supplierOrderNoOf(resp)
        // A SANDBOX order is a real order — placed, numbered, answerable — against Otto's
        // test environment. It will never appear in the live account, so "order placed
        // successfully" on its own sends someone looking for it in a portal that has never
        // heard of it. Named here for the same reason a dry run is.
 const sandbox = rr.sandbox === true
        // The service was substituted because the saved one isn't one Otto will run. Said
        // here, on the placement, because it changes the freight and the arrival date.
 const fb = rr.shippingFallback as { used?: string; why?: string } | null | undefined
 const shipNote = fb?.used ? ` · shipping on ${fb.used}${fb.why ? ` — ${fb.why}` : ""}` : ""
        // The short line is what goes on screen; `clarified` is the supplier's own wording
        // and goes behind Details. A refused card is singled out because it is the one
        // failure with an obvious next step.
        // OTTO ONLY. S&S pay by stored payment PROFILE — their order payload has a
        // profileID field and no field for a card number — so typing a card cannot fix an
        // S&S decline, and offering it would send someone to enter a PAN that never
        // reaches S&S at all. Their fix is "Change payment": pick a different saved
        // profile, which the decline handler above already surfaces.
 const isCardFail = !ok && g.api === "otto" && /card|payment|declin|cvv|expir/i.test(String(clarified))
 outcomes.push({
 supplier: g.supplier ?? "Unassigned",
 ok,
 short: ok
            ? (g.api
                ? (dry ? "dry run — not sent" : sandbox ? `placed in SANDBOX${ottoNo ? ` · ${ottoNo}` : ""}` : `placed${ssNo || ottoNo ? ` · #${ssNo ?? ottoNo}` : ""}`)
 : "recorded — order it by hand")
 : /declin|payment|card/i.test(String(clarified)) ? "payment refused" : "failed",
 detail: ok ? (shipNote ? shipNote.replace(/^ · /, "") : undefined) : String(clarified),
        })
 results.push(ok
          ? (g.api
              ? (dry
                  ? `${g.supplier}: dry run — not sent to ${g.api === "ss" ? "S&S" : "Otto"} (live ordering off)${shipNote}`
 : sandbox
                    ? `${g.supplier}: placed in Otto's SANDBOX${ottoNo ? ` — test order ${ottoNo}` : ""} — it will not appear in your live Otto account${shipNote}`
 : `${g.supplier}: order placed successfully${ssNo || ottoNo ? ` — order #${ssNo ?? ottoNo}` : ""}${shipNote}`)
 : `${g.supplier ?? "Unassigned"}: recorded — order it by hand`)
 : `${g.supplier ?? "Unassigned"}: failed — ${clarified}`)
      }
      // AWAITED, and before load(). See putSaved: the reload re-reads this list, so an
      // un-awaited write here can be overtaken and put the ordered lines back in the pool.
 if (placedKeys.size) await putSaved(saved.filter((l) => !placedKeys.has(lineKey(l))))
 const anyFailed = outcomes.some((o) => !o.ok)
 if (outcomes.length) {
 const done = outcomes.filter((o) => o.ok).length
 setMsg({
 ok: !anyFailed,
 tone: anyFailed && placedKeys.size ? "warn" : undefined,
          // A one-line summary; the per-supplier detail is the list below it.
 text: anyFailed
            ? (done ? `${done} of ${outcomes.length} placed.` : "Nothing was placed.")
 : outcomes.length > 1 ? `All ${outcomes.length} orders placed.` : "Order placed.",
 lines: outcomes,
 cardRetry: outcomes.some((o) => !o.ok && o.short === "payment refused"),
        })
      }
 load()
      // Everything that could place now has. If the only thing left to do is enter Otto's
      // card, open that dialog — the S&S/manual orders already went without waiting on it.
      //
      // Asked line by line rather than on a flag: the dialog may only re-open for lines
      // that are STILL unplaced. Re-opening after an order that went through reads as
      // "that failed, pay again", and the honest response to that is a second Otto order.
 if ([...deferredForCard].some((k) => !placedKeys.has(k))) setNeedCard(true)
    } catch (e) {
 setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't place these orders." })
    } finally { setBusy(null) }
  }

  /**
   * Did this order actually REACH the supplier?
   *
   * With the live gate off, placing builds the payload and returns it without sending —
   * so the PO reads "Placed" while nothing exists at the supplier. That's the same order
   * of mistake as marking an order Refunded without refunding it: a status asserting
   * something that never happened.
   */
  /**
   * Minutes since an order was actually sent. S&S only accept a cancellation within TEN
   * MINUTES — after that their API refuses and it becomes a phone call. Knowing which
   * side of that line you're on changes whether Cancel is worth pressing at all.
   */
 const minutesSincePlaced = (po: PurchaseOrder) => {
 const at = ((po.meta || {}) as { placedAt?: string }).placedAt
 if (!at) return null
    // `now` is state, refreshed on a timer — reading the clock during render is impure,
    // and a countdown computed that way updates only when something else happens to
    // re-render, which is exactly when it would be wrong.
 const ms = now - new Date(at).getTime()
 return isFinite(ms) ? Math.floor(ms / 60000) : null
  }

  /**
   * Placed against the supplier's SANDBOX rather than the live account.
   *
   * Distinct from `reallySent` on purpose: this DID leave the building, Otto answered it,
   * and it carries a real order number — so treating it as "not sent" would be wrong in
   * the other direction. What is untrue about it is only that the goods are coming.
   *
   * Two gates gate a real Otto order and only one of them is OTTOCAP_ORDER_LIVE; the
   * other is OTTOCAP_API_BASE still pointing at sandbox-api.ottocap.com. Opening the first
   * without the second is what produced an order nobody could find in their account.
   */
 const isSandboxOrder = (po: PurchaseOrder) => {
 const r = (((po.meta || {}) as Record<string, unknown>).response ?? {}) as Record<string, unknown>
 return r.sandbox === true && r.dryRun !== true && !r.error
  }

 const reallySent = (po: PurchaseOrder) => {
 const m = (po.meta || {}) as Record<string, unknown>
 const r = (m.response ?? {}) as Record<string, unknown>
 if (r.dryRun === true) return false
 if (r.manual === true) return false          // no supplier API — recorded, never sent
 if (r.error) return false
 return !!m.api                                // an api was involved and it didn't dry-run
  }

 const returnsOf = (po: PurchaseOrder): PoReturn[] => {
 const r = ((po.meta || {}) as { returns?: PoReturn[] }).returns
 return Array.isArray(r) ? r : []
  }

  /**
   * Confirm a supplier credit landed. Asks for the amount rather than assuming the
   * estimate: restocking fees and partial credits mean what arrives is often not what
   * was expected, and a booked figure that was never received is worse than none.
   */
 const confirmCredit = async (po: PurchaseOrder, r: PoReturn) => {
 const typed = await prompt({
 title: tl("purchase", "How much was credited?"),
 body: `The amount ${po.supplier || "the supplier"} actually credited back.`,
 defaultValue: String(r.credit || ""),
 placeholder: "0.00",
 confirmLabel: "Record credit",
    })
 if (typed == null) return
 const amount = Number(typed)
 if (!isFinite(amount) || amount <= 0) { setMsg({ ok: false, text: "A credit needs an amount greater than zero." }); return }
 setBusy(po.num); setMsg(null)
 try {
 const res = await creditPoReturn(po.num, r.id, amount)
 if (res.error) throw new Error(res.error)
 setMsg({ ok: true, text: `${usd(amount)} credit recorded against ${po.num}.` })
 load()
    } catch (e) {
 setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't record that credit." })
    } finally { setBusy(null) }
  }

 const del = async (po: PurchaseOrder) => { setBusy(po.num); try { await deletePurchaseOrder(po.num); load() } catch { /* ignore */ } finally { setBusy(null) } }

 const poTotal = (po: PurchaseOrder) => po.items.reduce((s, l) => s + num(l.qty), 0)
  /** What this PO COSTS. Distinct from poTotal, which counts units — the two were easy to
   * confuse when only one was ever shown, and only one of them is money. */
 const poMoney = (po: PurchaseOrder) => po.items.reduce((s, l) => s + num(l.price) * num(l.qty), 0)
 const usd = (n: number) => "$" + (Number(n) || 0).toFixed(2)
  /** True when nothing on the PO carries a price. Lines drafted from low stock have no
   * price until someone fills one in, and a confident "$0.00" would read as free. */
 const unpriced = (po: PurchaseOrder) => po.items.length > 0 && po.items.every((l) => !num(l.price))

  /** When a past PO actually happened — received beats placed, both beat the row's birth. */
 const poDate = (po: PurchaseOrder) => {
 const m = (po.meta || {}) as Record<string, unknown>
 const raw = (m.receivedAt || m.placedAt || po.created_at) as string | undefined
 if (!raw) return ""
 const d = new Date(raw)
 return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  }

 const toggle = (n: string) => {
 const opening = !open.has(n)
 setOpen((prev) => {
 const next = new Set(prev)
 if (!next.delete(n)) next.add(n)
 return next
    })
 if (!opening) return

    // Fetch OUTSIDE the state updater. An updater must be pure — React may call it more
    // than once, or not when you expect — so a network call in there is unreliable as
    // well as wrong, which is why these thumbnails never appeared.
 const po = (pos ?? []).find((p) => p.num === n)
 const want = [...new Set((po?.items ?? []).map((l) => l.sku).filter((sku) => sku && !poImgs[sku]))]
 if (!want.length) return
 resolveSuppliers(want)
      .then((r) => setPoImgs((m) => {
 const add: Record<string, string> = {}
 for (const [sku, v] of Object.entries(r.bySku ?? {})) if (v.image) add[sku] = v.image
 return Object.keys(add).length ? { ...m, ...add } : m
      }))
      .catch(() => { /* a missing thumbnail is not worth an error banner */ })
  }

  /**
   * Buy a past PO again — the whole thing, or one line of it.
   *
   * Merges into the supplier's existing draft when there is one rather than opening a
   * second: two drafts for the same supplier get placed as two orders, which splits a
   * shipment and forfeits whatever break the combined quantity would have earned.
   * Quantities are copied as they were, since "the same order again" is the request —
   * the draft is editable before it goes anywhere.
   */
 const reorder = async (po: PurchaseOrder, only?: POLine) => {
 const src = (only ? [only] : po.items).filter((l) => num(l.qty) > 0)
 if (!src.length) { setMsg({ ok: false, text: "Nothing on that order to reorder." }); return }
 const lines: POLine[] = src.map((l) => ({ sku: l.sku, name: l.name, variant: l.variant, qty: num(l.qty), price: l.price }))

 const target = drafts.find((p) => supKey(p.supplier) === supKey(po.supplier))
 setBusy(po.num); setMsg(null)
 try {
 if (target) {
        // Await it AND check the result: this once fire-and-forgot, then only awaited, so a
        // server-REFUSED merge still reported success and updated local state alone — the
        // line then vanished on the next load. Check r.error like the new-draft path does.
 const merged = mergeLines(target.items, lines)
 const r = await savePurchaseOrder({ ...target, items: merged })
 if (r?.error) throw new Error(r.error)
 setPos((prev) => (prev ?? []).map((p) => (p.num === target.num ? { ...p, items: merged } : p)))
 setTab("ongoing")   // a draft is an order in progress — that is the Ongoing tab now
 setMsg({ ok: true, text: `Added ${lines.length} line${lines.length === 1 ? "" : "s"} to the open draft ${target.num} — review the quantities before placing.` })
      } else {
 const draft: PurchaseOrder = { num: nextNum(), supplier: po.supplier ?? null, items: lines, status: "draft" }
 const r = await savePurchaseOrder(draft)
        // savePurchaseOrder resolves with {error} for some refusals rather than throwing,
        // so checking only for a thrown error reported a failure as a success.
 if (r?.error) throw new Error(r.error)
 setTab("ongoing")   // show the new draft where orders in progress live
 setMsg({ ok: true, text: `Drafted ${draft.num} from ${po.num} — review the quantities before placing.` })
 load()
      }
    } catch (e) {
      // Say what actually went wrong. The generic message here hid the server's reason,
      // which is the only thing that makes this fixable rather than mysterious.
 setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't create the reorder draft." })
    } finally { setBusy(null) }
  }

  /**
   * One collapsible PO row. Shared by both tabs — an in-flight order and a settled one
   * want the same summary and the same expanded detail, and two copies would drift the
   * moment either gained a field.
   */
 const poRow = (po: PurchaseOrder) => {
 const isOpen = open.has(po.num)
 return (
                <div key={po.num}>
                  <div className="flex flex-wrap items-center gap-2 px-5 py-3">
                    {/* The whole summary toggles — a caret-sized hit target on a row this
 wide is a miss waiting to happen. */}
                    <button onClick={() => toggle(po.num)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen}>
                      <CaretRight size={13} weight="bold" className={"shrink-0 text-muted-foreground transition-transform " + (isOpen ? "rotate-90" : "")} />
                      <span className="tabular-nums text-sm font-medium">{po.num}</span>
                      <span className="truncate text-sm text-muted-foreground">
                        {supKey(po.supplier)} · {poTotal(po)} units · {unpriced(po) ? "unpriced" : usd(poMoney(po))}
                        {poDate(po) ? " · " + poDate(po) : ""}
                      </span>
                    </button>
                    {po.status === "placed" && !reallySent(po)
                      ? <span className="whitespace-nowrap text-xs font-medium text-hold"
 title={tl("purchase", "Built and recorded, but never transmitted — the supplier's live-order gate is off")}>
                          {tl("purchase", "Not sent")}
                        </span>
                      // A SANDBOX order really was placed — it has an order number and Otto
                      // answered for it — but against their TEST environment, so it will
                      // never appear in the live account and no blanks are coming. Reading
                      // "Placed" for that is the same lie as reading it for a dry run, and
                      // costs someone a search through a portal that has never seen it.
 : po.status === "placed" && isSandboxOrder(po)
                      ? <span className="whitespace-nowrap text-xs font-medium text-working"
 title={tl("purchase", "Placed against the supplier's SANDBOX environment, not the live account. No blanks are on their way — switch OTTOCAP_API_BASE to Otto's production host to order for real.")}>
                          {tl("purchase", "Sandbox")}
                        </span>
 : po.status === "placed" ? <span className="whitespace-nowrap text-xs font-medium text-packed">{tl("purchase", "Placed")}</span>
 : po.status === "cancelled" ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{tl("purchase", "Cancelled")}</span>
 : <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-shipped"><CheckCircle size={11} weight="fill" /> {tl("purchase", "Received")}</span>}
                    {/**
              * RECEIVE THE WHOLE DELIVERY, at the top where a box gets opened.
              *
              * Blanks are bought as singles here — a purchase order is a dozen lines of one
              * or two pieces, raised because those variants ran out — so a button per line
              * is a dozen presses for one carton. Each line keeps its own Receive for the
              * part delivery; this is the ordinary case.
              *
              * Hidden once nothing is owed, and the server clamps every line to its own
              * outstanding regardless, so pressing it twice books nothing the second time.
              */}
            {po.items.some((l) => owedOn(l) > 0) && (
              <Button size="sm" variant="outline" onClick={() => void receiveAll(po)}
 disabled={busy === `recv:${po.num}` || busy === po.num}
 title={tl("purchase", "Book in everything this order is still waiting on and add it to the shelf")}>
                {busy === `recv:${po.num}` ? tl("purchase", "Receiving…") : tl("purchase", "Receive all")}
              </Button>
            )}
                        <Button size="sm" variant="outline" onClick={() => reorder(po)} disabled={busy === po.num} title={tl("purchase", "Copy these items onto a new draft PO")}>
                      {tl("purchase", "Reorder")}
                    </Button>
                    {/* Only where it makes sense: an order already settled is IN history. */}
                    {(po.status === "draft" || po.status === "placed") && (
                      <Button size="sm" variant="outline" onClick={() => archive([po])} disabled={busy === "archive"}
 title={tl("purchase", "Clear it off the board — the supplier is not contacted")}>
                        {tl("purchase", "To history")}
                      </Button>
                    )}
                    {po.status === "received" && (
                      <Button size="sm" variant="outline" onClick={() => setReturning(po)} disabled={busy === po.num}>
                        {tl("purchase", "Return")}
                      </Button>
                    )}
                    {po.status === "placed" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => receive(po)} disabled={busy === po.num}>
                          {busy === po.num ? <CircleNotch size={13} className="animate-spin" /> : null} Receive into stock
                        </Button>
                        {(() => {
 const mins = minutesSincePlaced(po)
 const ss = /s&s|activewear/i.test(po.supplier || "")
 const sentSs = ss && reallySent(po)
                          // Past their documented 10 minutes S&S USUALLY refuse — but only
                          // usually. Labelling it "(our record only)" stated an outcome we
                          // had not asked for, and S&S then cancelled for real, so the app
                          // said one thing and the supplier did another. The button no
                          // longer predicts: it asks, and reports whatever comes back.
 const past = sentSs && mins != null && mins >= 10
 return (
                            <button onClick={() => cancelPO(po)} disabled={busy === po.num}
 className="text-xs font-medium text-muted-foreground hover:text-alert"
 title={past
                                ? tl("purchase", "Past S&S's usual 10-minute window — we'll still ask them, and tell you what they say")
 : sentSs
                                  ? `Cancels with S&S too — about ${Math.max(0, 10 - (mins ?? 0))} min left of their window`
 : tl("purchase", "Cancel our record of this order")}>
                              {tl("purchase", "Cancel")}
                            </button>
                          )
                        })()}
                      </>
                    )}
                  </div>
                  {isOpen && (
                    <div className="border-t border-border bg-muted/30 px-5 py-1">
                      {/* How to chase this order: their reference, and the carrier number
 for the box coming back. Kept on the PO because "where are my
 blanks" is asked of the PO, not of a shipment record elsewhere. */}
                      {po.status !== "cancelled" && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border py-2.5 text-xs">
                          <span className="text-muted-foreground">
                            Supplier order{" "}
                            <span className="tabular-nums text-foreground">{supplierOrderNo(po) ?? "—"}</span>
                          </span>
                          {/* S&S know their own tracking, so ask them rather than making
 someone copy it across. Manual entry stays for suppliers with
 no API — an Otto or hand-placed order still needs a box
 chased. */}
                          {supplierOrderNo(po) && /s&s|activewear/i.test(po.supplier || "") ? (
                            <button onClick={() => fetchTracking(po)} disabled={tracking[po.num] === "loading"}
 className="font-medium text-primary hover:underline disabled:opacity-60">
                              {tracking[po.num] === "loading" ? tl("purchase", "Checking S&S…") : tl("purchase", "Get tracking from S&S")}
                            </button>
                          ) : (
                            <label className="flex items-center gap-1.5 text-muted-foreground">
                              {tl("purchase", "Tracking")}
                              <Input
 defaultValue={trackingOf(po)}
 onBlur={(e) => { if (e.target.value !== trackingOf(po)) setTracking(po, e.target.value) }}
 placeholder={tl("purchase", "paste carrier number")}
 className="h-7 w-48 tabular-nums text-xs"
                              />
                            </label>
                          )}
                        </div>
                      )}
                      {Array.isArray(tracking[po.num]) && (
                        <div className="border-b border-border py-2 text-xs">
                          {(tracking[po.num] as SsShipment[]).map((t, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 py-1">
                              <span className="font-medium">{t.carrier}</span>
                              <span className="tabular-nums text-foreground">{t.tracking}</span>
                              {/* A box number only appears on split shipments — which is
 exactly when you need to know there's more than one. */}
                              {t.box && <span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">box {t.box}</span>}
                              {t.deliveredAt
                                ? <span className="inline-flex items-center gap-1 rounded-full bg-shipped/12 px-2 py-0.5 font-medium text-shipped">
                                    <CheckCircle size={10} weight="fill" /> delivered
                                  </span>
 : t.lastUpdate?.status
                                  ? <span className="truncate text-muted-foreground">{t.lastUpdate.status}</span>
 : null}
                            </div>
                          ))}
                        </div>
                      )}
                      {tracking[po.num] === "none" && (
                        <div className="border-b border-border py-2 text-xs text-muted-foreground">
                          {tl("purchase", "S&S have no tracking for this order yet — it hasn’t shipped.")}
                        </div>
                      )}
                      {returnsOf(po).length > 0 && (
                        <div className="border-b border-border py-2.5">
                          <div className="mb-1 text-xs font-medium text-muted-foreground">{tl("purchase", "Returns")}</div>
                          {returnsOf(po).map((r) => (
                            <div key={r.id} className="flex flex-wrap items-center gap-2 py-1 text-xs">
                              <span className="text-muted-foreground">
                                {r.lines.reduce((a, l) => a + num(l.qty), 0)} units
                                {r.rma ? ` · RMA ${r.rma}` : ""}
                                {r.note ? ` · ${r.note}` : ""}
                              </span>
                              {r.status === "credited" ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-shipped/12 px-2 py-0.5 font-medium text-shipped">
                                  <CheckCircle size={10} weight="fill" /> {usd(r.credit)} credited
                                </span>
                              ) : (
                                <>
                                  <span className="rounded-full bg-hold/15 px-2 py-0.5 font-medium text-hold">
                                    {usd(r.credit)} expected
                                  </span>
                                  {/* Confirmed separately, because a credit lands when the
 supplier says so — not when the box went back. */}
                                  <button onClick={() => confirmCredit(po, r)} disabled={busy === po.num}
 className="font-medium text-primary hover:underline">
                                    {tl("purchase", "Credit received")}
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {po.items.length === 0 ? (
                        <div className="py-3 text-sm text-muted-foreground">{tl("purchase", "No lines on this PO.")}</div>
                      ) : po.items.map((l) => (
                        <div key={l.sku} className="flex items-center gap-3 py-2 text-sm">
                          <LineThumb src={l.image ?? poImgs[l.sku]} onZoom={(src, label) => setZoom({ src, label })}
 label={[l.name || l.sku, l.variant].filter(Boolean).join(" · ")} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{l.name || l.sku}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {l.variant || l.sku}
                              <span className="ml-1.5 tabular-nums opacity-70">{l.sku}</span>
                            </div>
                            <SourceTags line={l} />
                          </div>
                          {/* WHAT HAS LANDED, when any has. A bare ×12 cannot tell a line
 nobody has touched from one that is fully in — which is the
 question this panel exists to answer. */}
                          {num(l.received) > 0 ? (
                            <span className={"shrink-0 tabular-nums " + (owedOn(l) === 0 ? "text-success" : "text-hold")}
 title={`${num(l.received)} of ${num(l.qty)} received`}>
                              {num(l.received)}/{num(l.qty)}
                            </span>
                          ) : (
                            <span className="shrink-0 text-muted-foreground">×{num(l.qty)}</span>
                          )}
                          {/* Only while something is owed. A button that receives nothing is
 a way to double-count a delivery. */}
                          {owedOn(l) > 0 && (
                            <Button
 size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs"
 disabled={busy === `recv:${po.num}:${l.sku}` || busy === `recv:${po.num}`}
 onClick={() => void receiveLine(po, l)}
 title={`Book in the ${owedOn(l)} still owed and add them to the shelf`}
                            >
                              {busy === `recv:${po.num}:${l.sku}` ? "…" : tl("purchase", "Receive")}
                            </Button>
                          )}
                          {/* THE RECORDED PRICE, and only that. A placed PO is not re-costed
 from today's catalogue — what it cost is a fact. The title says
 when the figure was our own catalogue snapshot rather than a
 price the supplier confirmed, because the invoice can differ
 and the two must not read as the same claim. */}
                          <span
 className="w-20 text-right tabular-nums text-muted-foreground"
 title={num(l.price)
                              ? `${usd(num(l.price))} each${l.priceSource === "catalog" ? tl("purchase", " — our catalogue price when this was placed, not a supplier confirmation") : ""}`
 : tl("purchase", "No price was recorded on this line")}
                          >
                            {num(l.price) ? usd(num(l.price) * num(l.qty)) : "—"}
                          </span>
                          <button onClick={() => reorder(po, l)} className="text-muted-foreground hover:text-foreground" title={tl("purchase", "Reorder just this line")}>
                            <ArrowClockwise size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
  }

 return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex items-center gap-3 md:hidden">
          <ShoppingCart size={18} weight="regular" className="shrink-0 text-primary" />
          <div className="min-w-0">
            <h1 className="font-title text-2xl font-semibold tracking-tight">{tl("purchase", "Purchase")}</h1>
            <p className="truncate text-sm text-muted-foreground">{tl("purchase", "Restock low inventory — draft POs per supplier, place via S&S / Otto, receive into stock.")}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {/* WORDS, NOT ICONS. A barcode, a truck and a plus sat in a row above the board and
 each needed decoding before its label was read — three small pictures competing
 with three short phrases that already said it. The spinner stays on the one
 button that waits for something, because that is state rather than decoration.

            Receiving a BOX is its own job, done at the bench with a scanner — that is for
 goods already carrying our own label, which means consigned stock, where we
 printed the barcode. A supplier's carton never does, so those are received
 against the PO line instead (the Receive button on each line), where the mapping
 to our sku was already made when the order was raised. */}
        <Button size="sm" variant="outline" onClick={() => setScanOpen(true)}>
          {tl("purchase", "Receive a box")}
        </Button>
        {/* "Settings", not "Order settings": it sits on the purchasing board, where there is
 nothing else it could be the settings for, and the extra word was the longest
 thing in the row. */}
        <Button size="sm" variant="outline" onClick={() => setSupplierCfg(true)}>
          {tl("purchase", "Settings")}
        </Button>
        <Button size="sm" onClick={startBlankDraft} disabled={busy === "new"}>
          {busy === "new" && <CircleNotch size={13} className="animate-spin" />}
          New purchase order
        </Button>
      </div>

      <StatGrid>
        <StatCard label={tl("purchase", "Low stock")} value={String((inv ?? []).filter(isLow).length)} sub={tl("purchase", "need reorder")} tone={(inv ?? []).some(isLow) ? "neg" : undefined} />
        <StatCard label={tl("purchase", "To order")} value={String(saved.length)} sub={tl("purchase", "waiting to be placed")} />
        {/* Counts only what REALLY went. status === "placed" also covers a manual supplier
 recorded for hand-ordering and a dry run that never left the building — both
 already carry a "Not sent" badge in the list, so a tile reading "sent to
 suppliers" while counting them contradicted the rows underneath it. The unsent
 ones get their own tile rather than disappearing: they are the pile someone still
 has to act on. */}
        <StatCard label={tl("purchase", "Placed")} value={String((pos ?? []).filter((p) => p.status === "placed" && reallySent(p)).length)} sub={tl("purchase", "sent to suppliers")} />
        {(() => {
 const unsent = (pos ?? []).filter((p) => p.status === "placed" && !reallySent(p)).length
 return unsent ? <StatCard label={tl("purchase", "Not sent")} value={String(unsent)} sub={tl("purchase", "order these by hand")} tone="neg" /> : null
        })()}
        <StatCard label={tl("purchase", "Received")} value={String((pos ?? []).filter((p) => p.status === "received").length)} sub={tl("purchase", "into inventory")} tone="pos" />
      </StatGrid>

      {msg && (
        <div ref={msgRef} className={"rounded-lg border px-4 py-2 text-sm " + (
 msg.tone === "warn" ? "border-hold/20 bg-hold/10 text-hold"
 : msg.ok ? "border-shipped/30 bg-shipped/12 text-shipped"
 : "border-destructive/30 bg-destructive/10 text-destructive")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 font-medium">{msg.text}</span>
            <span className="flex shrink-0 gap-2">
              {/* THE ONE FAILURE WITH AN OBVIOUS NEXT STEP gets a button rather than a
 paragraph. Re-opening the card window puts the saved card in front of you
 with the option to type a different one, and placing again only retries
 what is STILL in the pool — the orders that went through were removed from
 it, so a retry cannot double-order them. */}
              {msg.cardRetry && (
                <Button size="sm" variant="outline" onClick={() => setNeedCard(true)}>{tl("purchase", "Enter card & retry")}</Button>
              )}
              {declineFix && !msg.ok && (
                <Button size="sm" variant="outline" onClick={() => { setPickCard(declineFix.current); setPickerOpen(true) }}>{tl("purchase", "Change payment")}</Button>
              )}
            </span>
          </div>
          {/* ONE LINE PER SUPPLIER. Four outcomes joined into a paragraph — each carrying a
 supplier's verbatim error — was a wall nobody read to the end of. The exact
 wording is still here, one <details> away, which is where it belongs: it only
 matters after you have decided which supplier to look at. */}
          {msg.lines && msg.lines.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {msg.lines.map((l, i) => (
                <li key={i} className="text-xs">
                  <span className="font-medium">{l.supplier}</span>
                  <span className="opacity-70"> — {l.short}</span>
                  {l.detail && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer select-none opacity-60 hover:opacity-100">{tl("purchase", "Details")}</summary>
                      <p className="mt-0.5 whitespace-pre-wrap opacity-80">{l.detail}</p>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Change S&S payment — pick a different saved card after a bank decline, in place. */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{tl("purchase", "Change S&S payment")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">The bank declined the saved card. Pick a different card on S&amp;S&apos;s account{declineFix?.email ? ` (${declineFix.email})` : ""}, then place the order again.</p>
          {declineFix && declineFix.profiles.length > 0 ? (
            <select value={pickCard} onChange={(e) => setPickCard(e.target.value)} className="eg-select h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              <option value="">{tl("purchase", "Account terms (no card)")}</option>
              {declineFix.profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name || tl("purchase", "Saved card")}{p.type ? ` · ${p.type}` : ""}</option>
              ))}
            </select>
          ) : (
            <div className="rounded-lg border border-hold/20 bg-hold/10 px-3 py-2 text-xs text-hold">
              No other saved cards on this S&amp;S account{declineFix?.email ? ` (${declineFix.email})` : ""}. Add or update the card with S&amp;S, then retry.
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setPickerOpen(false)}>{tl("purchase", "Cancel")}</Button>
            <Button onClick={saveCardPick} disabled={pickSaving || !(declineFix && declineFix.profiles.length > 0)}>{pickSaving ? <><CircleNotch size={14} className="animate-spin" /> {tl("purchase", "Saving…")}</> : tl("purchase", "Save card")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reorder suggestions */}
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        {/* THREE TABS, because they are three different jobs.
            Cart is what you are ABOUT to buy — a list you edit. Ongoing is money already
 committed and goods you are waiting for — a list you chase. History is settled.
            Cart and Ongoing shared one "Active" tab, so the thing you were mid-way through
 deciding sat directly above orders that only needed watching, and neither read
 cleanly. */}
        <TabsList>
          <TabsTrigger value="cart">Cart{saved.length ? ` (${saved.length})` : ""}</TabsTrigger>
          <TabsTrigger value="ongoing">Ongoing{placed.length ? ` (${placed.length})` : ""}</TabsTrigger>
          {/* No count on History. It only grows — hundreds of POs eventually — and a
 number that always climbs and never needs acting on is decoration. */}
          <TabsTrigger value="history">{tl("purchase", "History")}</TabsTrigger>
        </TabsList>

        {/* CART — what is short and about to be bought. Nothing here is a purchase order:
 none exists until you place one.

            Two columns: the lines on the left, the money on the right. The totals used to
 be a single "N units · $X" caption in the card header, which is the wrong place
 for the figure that decides whether you place the order at all. */}
        <TabsContent value="cart" className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">

        {/* ── TO ORDER ─────────────────────────────────────────────────────────
            One panel, always open. This is the working surface, and something you're
 mid-way through deciding shouldn't sit behind a click.

            Grouped by the supplier each line ACTUALLY comes from, so the split is
 visible BEFORE placing rather than being a surprise after. Nothing here is
 a "draft PO": no purchase order exists until you place one. Until then this
 is a list of what's short, which is the only honest description of it. */}
        <SectionCard
 title={tl("purchase", "To order")}
 actions={
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {saved.reduce((s, l) => s + num(l.qty), 0)} units{toOrderTotal > 0 ? ` · ${usd(toOrderTotal)}` : ""}
              </span>
              <Button size="sm" variant="outline" onClick={() => setAddTo(POOL)}>
                {tl("purchase", "Add items")}
              </Button>
              {/* COUNTS WHAT WILL ACTUALLY GO. The label said "Place 2 orders" over a cart
 whose second supplier is ordered by hand, and the button stayed live on a
 cart that was ALL Otto — a press that could only fail. Disabled with the
 reason on the tooltip when there is nothing this button can send. */}
              <Button
 size="sm"
 onClick={() => void placeAllGroups()}
 disabled={!autoGroups.length || busy === "place-all"}
 title={autoGroups.length
                  ? undefined
 : (handGroups.length ? tl("purchase", "Every supplier in this cart is ordered by hand.") : tl("purchase", "Nothing to place."))}
              >
                {busy === "place-all" && <CircleNotch size={14} className="animate-spin" />}
                {autoGroups.length > 1 ? `Place ${autoGroups.length} orders` : tl("purchase", "Place order")}
              </Button>
            </div>
          }
        >
          {saved.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              size="sm"
              title={tl("purchase", "Nothing waiting to be ordered")}
              note={tl("purchase", "Items land here when an order runs stock short — or add them yourself with Add items.")}
            />
          ) : (
            <div className="divide-y divide-border">
              {toOrderGroups.map((g) => (
                <div key={g.key}>
                  <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-5 py-2">
                    <span className="text-sm font-semibold">{g.supplier ?? tl("purchase", "Unassigned")}</span>
                    {/* Only the exception is worth a chip. "Orders via API" was on the
 majority of rows saying nothing actionable; "order by hand" is the
 one that changes what you do next. */}
                    {!placeable(g.api) && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{tl("purchase", "order by hand")}</span>
                    )}
                    {/* THEIR MINIMUM, said before it is keyed in rather than after they refuse
 it. Amber, not an error: this cart is legal, it just cannot be sent yet,
 and only Otto imposes it. */}
                    {g.api === "otto" && g.lines.reduce((n, l) => n + num(l.qty), 0) < OTTO_MIN_UNITS && (
                      <span className="whitespace-nowrap text-2xs font-medium text-hold">
 under Otto&apos;s {OTTO_MIN_UNITS}-piece minimum
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{g.lines.length} line{g.lines.length === 1 ? "" : "s"} · {g.lines.reduce((s, l) => s + num(l.qty), 0)} units</span>
                      {g.total > 0 && <span className="text-sm font-semibold tabular-nums text-foreground">{usd(g.total)}</span>}
                    </span>
                  </div>
                  {g.lines.map((l) => (
                    <div key={l.sku} className="px-5 py-3">
                     <div className="flex items-start gap-4">
                      <LineThumb src={l.image ?? supByS[l.sku]?.image} onZoom={(src, label) => setZoom({ src, label })}
 label={[l.name || l.sku, l.variant].filter(Boolean).join(" · ")} />
                      {/* Product identity — a FIXED-ish column (doesn't grow) so the qty pills
 get the whole middle band to spread across, rather than being shoved
 against the price by a title that ate all the slack. */}
                      <div className="min-w-0 basis-56">
                        <div className="truncate text-sm font-medium">{l.name || l.sku}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {l.variant || supByS[l.sku]?.variant || l.sku}
                          <span className="ml-1.5 tabular-nums opacity-70">{l.sku}</span>
                        </div>
                        <SourceTags line={l} />
                        {/* ONE CLICK TO THE PAGE IT IS BOUGHT ON. A hand-ordered line used
 to carry a supplier's name and nothing else, so "order by hand"
 meant "go and remember where this came from". Typed once on the
 product; every shortage of it arrives with the link. */}
                        {(l as { supplierUrl?: string | null }).supplierUrl && (
                          <a
 href={String((l as { supplierUrl?: string | null }).supplierUrl)}
 target="_blank" rel="noopener noreferrer"
 onClick={(e) => e.stopPropagation()}
 className="mt-0.5 inline-flex items-center gap-1 text-2xs font-medium text-primary hover:underline"
                          >
                            <ArrowSquareOut size={11} weight="bold" /> {tl("purchase", "Where to buy")}
                          </a>
                        )}
                      </div>
                      {/* QTY SLOTS — flex-1 so they occupy the band BETWEEN the product and
 the price, but kept as a TIGHT cluster (fixed small gap) centred in
 that band rather than stretched edge-to-edge — justify-between fanned
 them too far apart on a wide row. Wraps when the row is narrow. Each box
                          STACKS four facts — how many to take, the warehouse code, its stock,
 and the arrival date — because in a row they'd read as one run-on line.
                            • S&S  → one box per warehouse, nearest first (blank = let S&S
 split it; typing turns the line into a manual split, and
 the line qty follows the sum of the boxes).
                            • Otto → a single box (their inventory is per-sku, no warehouse).
                            • else → one plain box (a manual line, or S&S before stock loads),
 the sole quantity control in that case. */}
                      <div className="flex flex-1 flex-wrap items-start justify-center gap-2 sm:gap-2.5">
                        {g.api === "ss" && stock[l.sku] ? (
 stock[l.sku].warehouses.filter((w) => w.qty > 0).length === 0 ? (
                            <span className="self-center text-2xs font-medium text-destructive">{tl("purchase", "No stock in any warehouse")}</span>
                          ) : (
 stock[l.sku].warehouses
                              .filter((w) => w.qty > 0)
                              .sort((a, b) => (transit[a.abbr]?.days ?? 99) - (transit[b.abbr]?.days ?? 99))
                              .slice(0, 5)
                              .map((w) => {
 const t = transit[w.abbr]
 const eta = warehouseEta(t?.days ?? null, t?.cutOff ?? null, new Date(now || Date.now()))
 const covers = w.qty >= num(l.qty)
 const key = `${l.sku}:${w.abbr}`
 const taken = split[key] ?? ""
 return (
                                  <label key={w.abbr}
 title={`${w.qty} in ${w.abbr}${t?.cutOff ? ` · order by ${t.cutOff}` : ""}${covers ? "" : tl("purchase", " — not enough for this line on its own")}`}
 className="flex w-[5.5rem] shrink-0 cursor-text flex-col items-center gap-1">
                                    {/* Shared Input primitive — pill shape + violet focus ring
 come from the theme, so they can't drift. Capped at the
 warehouse's stock; over-asking is a rejection S&S only
 find later. */}
                                    <Input
 value={taken}
 onChange={(e) => {
 const v = e.target.value.replace(/[^0-9]/g, "")
 const capped = v === "" ? "" : String(Math.min(Number(v), w.qty))
 const next = { ...split, [key]: capped }
 setSplit(next)
 const sum = stock[l.sku].warehouses
                                          .reduce((a, x) => a + Number(next[`${l.sku}:${x.abbr}`] || 0), 0)
 if (sum > 0) setSavedQty(l.sku, sum)
                                      }}
 placeholder="0"
 inputMode="numeric"
 aria-label={`Quantity to take from ${w.abbr}`}
 className="h-8 w-full px-1 text-center text-sm tabular-nums"
                                    />
                                    <span className="flex items-baseline gap-1 text-2xs leading-none">
                                      <span className={covers ? "font-semibold text-foreground" : "font-medium text-muted-foreground"}>{w.abbr}</span>
                                      <span className="tabular-nums text-muted-foreground">{w.qty}</span>
                                    </span>
                                    <span className="text-2xs leading-none text-muted-foreground">
                                      {eta.deliveryAt ? fmtEta(eta.deliveryAt) : tl("purchase", "no ETA")}
                                    </span>
                                  </label>
                                )
                              })
                          )
                        ) : g.api === "otto" ? (
                          <label
 title={ottoStock[l.sku] == null
                              ? tl("purchase", "Otto didn't return a stock figure we could read")
 : `${ottoStock[l.sku]} available from Otto`}
 className="flex w-[5.5rem] shrink-0 cursor-text flex-col items-center gap-1">
                            <Input
 value={String(num(l.qty) || "")}
 onChange={(e) => setSavedQty(l.sku, Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
 placeholder="0"
 inputMode="numeric"
 aria-label={`Quantity to order from Otto for ${l.sku}`}
 className="h-8 w-full px-1 text-center text-sm tabular-nums"
                            />
                            <span className="text-2xs font-medium leading-none">{tl("purchase", "Otto")}</span>
                            <span className="text-2xs leading-none text-muted-foreground">
                              {ottoStock[l.sku] == null ? tl("purchase", "stock unknown") : `${ottoStock[l.sku]} avail`}
                            </span>
                          </label>
                        ) : (
                          <Input
 value={String(num(l.qty))}
 onChange={(e) => setSavedQty(l.sku, Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
 inputMode="numeric" className="h-8 w-20 text-center text-sm tabular-nums"
 aria-label={`Quantity of ${l.sku}`}
                          />
                        )}
                      </div>
                      {/* Line total — foreground weight so the money reads at a glance rather
 than hiding as muted micro-text.

                          A catalogue price is shown, and shown AS ONE: muted, with "catalog"
 under it and the per-unit figure and its source in the title. It is
 the last synced number rather than a quote, and the two must not
 look alike — but "—" on a line of real goods, with the order total
 counting it as zero, was the worse of the two lies. */}
                      {(() => {
 const { unit, from } = unitPrice(l)
 if (!unit) return <span className="w-24 shrink-0 self-center text-right text-sm text-muted-foreground">—</span>
 return (
                          <span
 title={from === "catalog"
                              ? `${usd(unit)} each — last synced ${supByS[l.sku]?.supplier ?? "supplier"} catalogue price, not a quote`
 : `${usd(unit)} each`}
 className={"w-24 shrink-0 self-center text-right text-sm tabular-nums " +
                              (from === "catalog" ? "font-normal text-muted-foreground" : "font-semibold")}
                          >
                            {usd(unit * num(l.qty))}
                            {from === "catalog" && <span className="block text-2xs leading-none">catalog</span>}
                          </span>
                        )
                      })()}
                      <button onClick={() => putSaved(saved.filter((s) => s.sku !== l.sku))}
 className="self-center text-muted-foreground hover:text-alert" title={tl("purchase", "Drop — not ordering this")}>
                        <Trash size={14} />
                      </button>
                     </div>
                     {/* Split warning spans the full row width BELOW it — it's about the whole
 line and needs room to breathe, not a squeeze into a column. */}
                     {g.api === "ss" && stock[l.sku] && (
                       <StockSplitWarning
 qty={num(l.qty)} stock={stock[l.sku]} transit={transit} now={now || Date.now()}
 onReduce={(q) => setSavedQty(l.sku, q)}
 onSaveForLater={() => putSaved(saved.filter((x) => x.sku !== l.sku))}
                       />
                     )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
          </div>

          {/* ── WHAT IT COSTS ────────────────────────────────────────────────────
              Goods are known now. Freight is NOT: no supplier here quotes it before the
 order exists, so the panel says so and shows what it actually came to last
 time rather than an invented estimate. */}
          <aside className="space-y-4 xl:sticky xl:top-20">
            <SectionCard title={tl("purchase", "Order total")} bodyClassName="space-y-3 p-4 text-sm">
              {toOrderGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground">{tl("purchase", "Nothing in the cart yet.")}</p>
              ) : (
                <>
                  <dl className="space-y-1.5">
                    {toOrderGroups.map((g) => {
 const units = g.lines.reduce((n, l) => n + num(l.qty), 0)
 return (
                        <div key={g.key} className="flex items-baseline justify-between gap-3">
                          <dt className="min-w-0 truncate text-muted-foreground">
                            {g.supplier ?? tl("purchase", "Unassigned")}
                            <span className="ml-1 text-2xs">· {units} {units === 1 ? "unit" : "units"}</span>
                          </dt>
                          <dd className="shrink-0 tabular-nums">{usd(g.total)}</dd>
                        </div>
                      )
                    })}
                  </dl>

                  <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 font-medium">
                    <dt>{tl("purchase", "Goods")}</dt>
                    <dd className="tabular-nums">{usd(toOrderTotal)}</dd>
                  </div>

                  {/* ONE LINE, like every other line in this column. The panel is a column of
 figures and this was three paragraphs of prose in the middle of it.
                      A DASH, NOT "FREE" and not a number: no supplier here quotes freight
 before the order exists, so we do not have the figure — and "Free" is the
 one word that would be a lie about a cost that regularly dwarfs the goods.
                      The note under the total already says freight is added at placement, so
 nothing true was lost with the paragraphs. */}
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-xs font-medium">{tl("purchase", "Shipping")}</dt>
                    <dd className="text-xs tabular-nums text-muted-foreground">—</dd>
                  </div>

                  <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
                    <dt>{tl("purchase", "Total so far")}</dt>
                    <dd className="tabular-nums">{usd(toOrderTotal)}</dd>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    {tl("purchase", "Goods only. Freight and any tax are added by the supplier at placement.")}
                  </p>
                </>
              )}
            </SectionCard>
          </aside>
        </TabsContent>

        {/* ONGOING — placed and in flight, plus any draft still to finish. Money is already
 committed here; the job is chasing, not deciding. */}
        <TabsContent value="ongoing" className="mt-4 space-y-4">
          {placed.length > 0 && (
            <SectionCard
 title={tl("purchase", "On order")}
              // The bulk form of the same action, because a board that has drifted has
              // drifted by more than one row — clearing them one at a time is how it got
              // like this. Same confirm, same "the supplier is not contacted".
 actions={placed.length > 1 ? (
                <Button size="sm" variant="outline" onClick={() => archive(placed)} disabled={busy === "archive"}>
                  {busy === "archive" ? <CircleNotch size={13} className="animate-spin" /> : null}
                  Move all {placed.length} to history
                </Button>
              ) : undefined}
            >
              <div className="divide-y divide-border">{placed.map(poRow)}</div>
            </SectionCard>
          )}
          {pos !== null && drafts.length === 0 && placed.length === 0 && (
            <SectionCard title={tl("purchase", "Nothing on order")}>
              <EmptyState
                icon={FileText}
                size="sm"
                title={tl("purchase", "No drafts, nothing in flight")}
                note={tl("purchase", "Start one with New purchase order, or from a reorder suggestion above.")}
              />
            </SectionCard>
          )}
        </TabsContent>

        {/* HISTORY — settled: received or cancelled. Nothing further is expected. */}
        <TabsContent value="history" className="mt-4 space-y-4">
          <SectionCard title={tl("purchase", "Purchase history")}>
            {pos === null ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
            ) : history.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">{tl("purchase", "Nothing received or cancelled yet.")}</div>
            ) : (
              <div className="divide-y divide-border">{pagedHistory.pageItems.map(poRow)}</div>
            )}
            {history.length > 20 && (
              <Pagination page={pagedHistory.page} pageCount={pagedHistory.pageCount} perPage={pagedHistory.perPage}
 total={pagedHistory.total} start={pagedHistory.start}
 onPage={pagedHistory.setPage} onPerPage={pagedHistory.setPerPage} perPageOptions={[20, 50, 100]} />
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      <ImageZoom img={zoom} onClose={() => setZoom(null)} />

      <ReceiveScanDialog open={scanOpen} onOpenChange={setScanOpen} onReceived={load} />

      <CardEntryDialog
 open={needCard}
 onOpenChange={setNeedCard}
 amount={toOrderGroups.filter((g) => g.api === "otto").reduce((s2, g) => s2 + g.total, 0)}
        // Straight on to placing with the card in hand. It exists only for this call.
        // Clear the failure banner on the way through: placeAllGroups does it too, but only
        // after a round trip for the ship-from settings, so the strip that sent you here
        // would sit there through the retry it was asking for.
 onSubmit={(c) => { setNeedCard(false); setMsg(null); setDeclineFix(null); void placeAllGroups(c) }}
      />

      <SupplierOrderingDialog open={supplierCfg} onOpenChange={setSupplierCfg} />

      <PoReturnDialog po={returning} onClose={() => setReturning(null)} onDone={load} />

      <POAddItems
 key={addTo?.num ?? "none"}
 po={addTo}
 onClose={() => setAddTo(null)}
 inventory={inv ?? []}
        // Picked items go into the POOL, merged by sku AND VARIANT — the same key the
        // shortage path uses, so something both short and hand-picked doesn't appear twice
        // while two colours of one style still stay two lines.
 onAdd={(lines) => {
 const next = saved.map((l) => ({ ...l }))
 for (const l of lines) {
 const hit = next.find((x) => lineKey(x) === lineKey(l))
 if (hit) hit.qty = num(hit.qty) + (num(l.qty) || 1)
 else next.push({ ...l, qty: num(l.qty) || 1, savedAt: new Date().toISOString() })
          }
 putSaved(next)
        }}
      />
    </div>
  )
}
