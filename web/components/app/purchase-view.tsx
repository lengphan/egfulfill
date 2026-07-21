"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ShoppingCart, CircleNotch, Plus, Truck, CheckCircle, Trash, PaperPlaneTilt, BookmarkSimple, ArrowUUpLeft, CaretRight, ArrowClockwise, Barcode } from "@phosphor-icons/react"
import { usePaged, Pagination } from "@/components/app/pagination"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  getInventory, saveInventory, getPurchaseOrders, savePurchaseOrder, deletePurchaseOrder,
  getFactoryList, saveFactoryList, creditPoReturn, getSsTracking, cancelSsOrder, type PoReturn, type SsShipment,
  ssOrder, ottoOrder, resolveSuppliers, getSupplierOptions, type InventoryItem, type PurchaseOrder, type POLine, type SavedPOLine,
} from "@/lib/api"
import { POAddItems } from "@/components/app/po-add-items"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SupplierOrderingDialog } from "@/components/app/supplier-ordering-dialog"
import { PoReturnDialog } from "@/components/app/po-return-dialog"
import { ReceiveScanDialog } from "@/components/app/receive-scan-dialog"
import { getToken } from "@/lib/auth"

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
  if (!src) return <span className="size-11 shrink-0 rounded border border-dashed border-border" aria-hidden />
  return (
    <button type="button" onClick={() => onZoom?.(src, label ?? "")}
      title="Click to enlarge" aria-label={`Enlarge ${label || "product image"}`}
      className="shrink-0 rounded border border-border bg-white transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
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
  if (!img) return null
  const big = img.src.replace(/_(fs|fm)(\.[a-z]+)/i, "_fl$2")
  return (
    <Dialog open onOpenChange={(o: boolean) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate text-base">{img.label || "Product image"}</DialogTitle>
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
  const src = Array.isArray(line.sources) ? line.sources : []
  if (!src.length) return null
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1">
      {src.slice(0, 4).map((s, i) => (
        <span key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              title={`${s.qty} of these are for order ${s.order}`}>
          #{s.order} ×{s.qty}
        </span>
      ))}
      {src.length > 4 && <span className="text-[10px] text-muted-foreground">+{src.length - 4} more</span>}
    </span>
  )
}

export function PurchaseView() {
  const [inv, setInv] = useState<InventoryItem[] | null>(null)
  const [pos, setPos] = useState<PurchaseOrder[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tone?: "warn" } | null>(null)

  // Lines pulled out of a draft but kept for a later order. Factory-global (staff
  // share one list), so it survives the browser that removed the line.
  const [saved, setSaved] = useState<SavedPOLine[]>([])
  const [addTo, setAddTo] = useState<PurchaseOrder | null>(null)
  // Which history rows are expanded. A set, not a single id — comparing two past POs
  // side by side is the normal reason to open them.
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [supplierCfg, setSupplierCfg] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
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
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  // Low-stock items grouped by supplier → reorder suggestions.
  const suggestions = useMemo(() => {
    const low = (inv ?? []).filter(isLow)
    const g: Record<string, InventoryItem[]> = {}
    for (const it of low) (g[supKey(it.supplier)] ??= []).push(it)
    return g
  }, [inv])

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

  // Persist the shared saved-for-later list. Optimistic: the UI moves immediately,
  // the blob is replaced wholesale (that's the factory_lists contract).
  const putSaved = (next: SavedPOLine[]) => {
    setSaved(next)
    saveFactoryList("po_saved", next).catch(() => {})
  }
  /** Pull a line OUT of the draft but keep it — the common "not this order, next one" case. */
  const saveForLater = (po: PurchaseOrder, l: POLine) => {
    removeLine(po, l.sku)
    if (saved.some((s) => s.sku === l.sku)) return          // already parked
    putSaved([...saved, { ...l, supplier: po.supplier ?? null, savedAt: new Date().toISOString() }])
  }
  /** Put a parked line back on a draft, merging the qty if the sku is already there. */
  const restore = (l: SavedPOLine) => {
    const target = drafts.find((p) => supKey(p.supplier) === supKey(l.supplier)) ?? drafts[0]
    if (!target) { setMsg({ ok: false, text: "No draft PO open — create one first, then restore into it." }); return }
    const hit = target.items.find((x) => x.sku === l.sku)
    patchPO(target, hit
      ? target.items.map((x) => (x.sku === l.sku ? { ...x, qty: num(x.qty) + num(l.qty) } : x))
      : [...target.items, { sku: l.sku, name: l.name, variant: l.variant, qty: num(l.qty) || 1, price: l.price }])
    putSaved(saved.filter((s) => s.sku !== l.sku))
  }
  /** Merge lines into an existing set, combining quantities on a repeated sku. Pure, so
   *  the "add items" path and the reorder path can't drift apart. */
  const mergeLines = (existing: POLine[], add: POLine[]): POLine[] => {
    const next = existing.map((l) => ({ ...l }))
    for (const l of add) {
      const hit = next.find((x) => x.sku === l.sku)
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
            const r = await ottoOrder(payload, {
              shipping_address: opts.shipTo,
              shipping_method: opts.defaults.otto_shipping_method || undefined,
              payment_method: opts.defaults.otto_payment_method || undefined,
              customer_po: po.num,
            })
            if (r.error) throw new Error(r.error); resp = r
          } else if (g.api === "ss") {
            const r = await ssOrder(payload, {
              shippingAddress: opts.shipTo,
              shippingMethod: opts.defaults.ss_shipping_method || undefined,
              email: opts.defaults.ss_order_email || opts.defaults.order_email || undefined,
              poNumber: po.num,
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
          items: g.lines,
          status: placedOk && g.api ? "placed" : placedOk ? "placed" : "draft",
          meta: { ...(po.meta || {}), response: resp, placedAt, api: g.api, splitFrom: parts.length > 1 ? po.num : undefined },
        })
        results.push(
          !placedOk ? `${g.supplier ?? "Unassigned"}: failed — ${(resp as { error?: string }).error}`
            : g.api ? `${g.supplier}: sent (test/dry-run — set live keys to place for real)`
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
      const bySku = new Map((inv ?? []).map((it) => [it.sku, it]))
      const next = [...(inv ?? [])]
      for (const l of po.items) {
        const existing = bySku.get(l.sku)
        if (existing) { const i = next.findIndex((x) => x.sku === l.sku); next[i] = { ...existing, in_stock: num(existing.in_stock) + num(l.qty) } }
        else next.push({ sku: l.sku, name: l.name, variant: l.variant, in_stock: num(l.qty), reorder_at: 25, supplier: po.supplier })
      }
      await saveInventory(next)
      await savePurchaseOrder({ ...po, status: "received", meta: { ...(po.meta || {}), receivedAt: new Date().toISOString() } })
      setInv(next); setMsg({ ok: true, text: "Received into inventory." }); load()
    } catch { setMsg({ ok: false, text: "Couldn't receive." }) } finally { setBusy(null) }
  }

  /** The supplier's own order number, dug out of whatever shape their response took. */
  const supplierOrderNo = (po: PurchaseOrder): string | null => {
    const m = (po.meta || {}) as Record<string, unknown>
    const r = (m.response ?? {}) as Record<string, unknown>
    const nested = ((r.ssResponse ?? r.ottoResponse ?? {}) as Record<string, unknown>)
    const pick = (o: Record<string, unknown>) =>
      o.orderNumber ?? o.order_number ?? o.orderNo ?? o.salesOrderNumber ?? o.id
    const v = pick(nested) ?? pick(r)
    return v == null ? null : String(v)
  }
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
    if (wasPlaced && sent && !window.confirm(
      `Cancel ${po.num}?\n\nThis marks OUR record cancelled. It does NOT cancel the order with ${po.supplier || "the supplier"} — contact them directly if the goods haven't shipped.`
    )) return
    setBusy(po.num); setMsg(null)
    try {
      // Ask the SUPPLIER first, where we can. Marking our record cancelled while their
      // order stands is the failure that costs money — stock arrives against an order the
      // system says doesn't exist.
      let supplierMsg = ""
      const orderNo = supplierOrderNo(po)
      const isSs = /s&s|activewear/i.test(po.supplier || "")
      if (sent && isSs && orderNo) {
        const c = await cancelSsOrder(orderNo).catch((e) => ({ error: e instanceof Error ? e.message : "failed" }))
        if ("error" in c && c.error) {
          // Their refusal is the whole answer — stop rather than record a cancellation
          // that only exists here.
          setMsg({ ok: false, text: `S&S wouldn't cancel ${orderNo}: ${c.error}` })
          return
        }
        supplierMsg = ` S&S confirmed it cancelled (${(c as { orderStatus?: string }).orderStatus ?? "Cancelled"}).`
      }

      const r = await savePurchaseOrder({
        ...po, status: "cancelled",
        meta: { ...(po.meta || {}), cancelledAt: new Date().toISOString(), supplierCancelled: !!supplierMsg },
      })
      if (r?.error) throw new Error(r.error)
      setMsg({ ok: true, text: !wasPlaced || !sent
        ? `${po.num} cancelled. It was never sent to ${po.supplier || "the supplier"}, so there is nothing to cancel with them.`
        : supplierMsg
          ? `${po.num} cancelled.${supplierMsg}`
          // Otto document no cancel endpoint, so theirs is still a phone call.
          : `${po.num} marked cancelled here — ${po.supplier || "the supplier"} has no cancel API, so contact them directly to stop the actual order.` })
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
  const [supByS, setSupByS] = useState<Record<string, { api: "ss" | "otto" | null; supplier: string | null; image?: string | null; variant?: string | null }>>({})
  useEffect(() => {
    const skus = saved.map((l) => l.sku).filter(Boolean)
    if (!skus.length) return
    const t = setTimeout(() => {
      resolveSuppliers(skus).then((r) => setSupByS(r.bySku ?? {})).catch(() => {})
    }, 0)
    return () => clearTimeout(t)
  }, [saved])

  const toOrderGroups = useMemo(() => {
    const g = new Map<string, { key: string; api: "ss" | "otto" | null; supplier: string | null; lines: SavedPOLine[]; total: number }>()
    for (const l of saved) {
      const r = supByS[l.sku] ?? { api: null, supplier: l.supplier ?? null }
      const key = r.api ?? `manual:${r.supplier ?? l.supplier ?? "unassigned"}`
      if (!g.has(key)) g.set(key, { key, api: r.api, supplier: r.supplier ?? l.supplier ?? null, lines: [], total: 0 })
      const grp = g.get(key)!
      grp.lines.push(l)
      grp.total += num(l.price) * num(l.qty)
    }
    return [...g.values()]
  }, [saved, supByS])
  const toOrderTotal = toOrderGroups.reduce((s, g) => s + g.total, 0)
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
  const placeAllGroups = async () => {
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
    const needsOtto = toOrderGroups.some((g) => g.api === "otto")
    if (needsOtto && !(opts.defaults.otto_customer && opts.defaults.otto_contact)) {
      setMsg({ ok: false, text: "Otto require a customer and contact on every order. Set them in Order settings › Payment — they come from your Otto account." })
      return
    }

    setBusy("place-all"); setMsg(null)
    const results: string[] = []
    const placedSkus = new Set<string>()
    try {
      for (const g of toOrderGroups) {
        const poNum = nextNum()
        const payload = g.lines.map((l) => ({ sku: l.sku, qty: num(l.qty) })).filter((l) => l.qty > 0)
        if (!payload.length) continue
        let resp: unknown = { manual: true }
        let ok = true
        try {
          if (g.api === "otto") {
            const r = await ottoOrder(payload, {
              shipping_address: opts.shipTo,
              // Otto require billing too, and it's the same warehouse.
              billing_address: opts.shipTo,
              shipping_method: opts.defaults.otto_shipping_method || undefined,
              payment_method: opts.defaults.otto_payment_method || undefined,
              customer: opts.defaults.otto_customer || undefined,
              contact: opts.defaults.otto_contact || undefined,
              customer_po: poNum,
            })
            if (r.error) throw new Error(r.error); resp = r
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
          num: poNum, supplier: g.supplier ?? null, items: g.lines, status: ok ? "placed" : "draft",
          meta: { response: resp, placedAt: new Date().toISOString(), api: g.api },
        }).catch(() => {})
        if (ok) g.lines.forEach((l) => placedSkus.add(l.sku))
        results.push(ok
          ? `${g.supplier ?? "Unassigned"}: ${g.api ? "sent (test/dry-run)" : "recorded — order it by hand"}`
          : `${g.supplier ?? "Unassigned"}: failed — ${(resp as { error?: string }).error}`)
      }
      if (placedSkus.size) putSaved(saved.filter((l) => !placedSkus.has(l.sku)))
      const anyFailed = results.some((r) => r.includes("failed"))
      setMsg({ ok: !anyFailed, tone: anyFailed && placedSkus.size ? "warn" : undefined,
               text: (anyFailed && placedSkus.size ? "Partly placed. " : "") + results.join(" · ") })
      load()
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
    const typed = window.prompt(`How much did ${po.supplier || "the supplier"} actually credit?`, String(r.credit || ""))
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
   *  confuse when only one was ever shown, and only one of them is money. */
  const poMoney = (po: PurchaseOrder) => po.items.reduce((s, l) => s + num(l.price) * num(l.qty), 0)
  const usd = (n: number) => "$" + (Number(n) || 0).toFixed(2)
  /** True when nothing on the PO carries a price. Lines drafted from low stock have no
   *  price until someone fills one in, and a confident "$0.00" would read as free. */
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
        // Await it: this used to fire and forget, so a failed merge reported success and
        // the line silently wasn't on the draft anyone was about to place.
        const merged = mergeLines(target.items, lines)
        await savePurchaseOrder({ ...target, items: merged })
        setPos((prev) => (prev ?? []).map((p) => (p.num === target.num ? { ...p, items: merged } : p)))
        setMsg({ ok: true, text: `Added ${lines.length} line${lines.length === 1 ? "" : "s"} to the open draft ${target.num} — review the quantities before placing.` })
      } else {
        const draft: PurchaseOrder = { num: nextNum(), supplier: po.supplier ?? null, items: lines, status: "draft" }
        const r = await savePurchaseOrder(draft)
        // savePurchaseOrder resolves with {error} for some refusals rather than throwing,
        // so checking only for a thrown error reported a failure as a success.
        if (r?.error) throw new Error(r.error)
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
                      <span className="font-mono text-sm font-medium">{po.num}</span>
                      <span className="truncate text-sm text-muted-foreground">
                        {supKey(po.supplier)} · {poTotal(po)} units · {unpriced(po) ? "unpriced" : usd(poMoney(po))}
                        {poDate(po) ? " · " + poDate(po) : ""}
                      </span>
                    </button>
                    {po.status === "placed" && !reallySent(po)
                      ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                              title="Built and recorded, but never transmitted — the supplier's live-order gate is off">
                          Not sent
                        </span>
                      : po.status === "placed" ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">Placed</span>
                      : po.status === "cancelled" ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Cancelled</span>
                        : <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle size={11} weight="fill" /> Received</span>}
                    <Button size="sm" variant="outline" onClick={() => reorder(po)} disabled={busy === po.num} title="Copy these items onto a new draft PO">
                      <ArrowClockwise size={13} weight="bold" /> Reorder
                    </Button>
                    {po.status === "received" && (
                      <Button size="sm" variant="outline" onClick={() => setReturning(po)} disabled={busy === po.num}>
                        <ArrowUUpLeft size={13} weight="bold" /> Return
                      </Button>
                    )}
                    {po.status === "placed" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => receive(po)} disabled={busy === po.num}>
                          {busy === po.num ? <CircleNotch size={13} className="animate-spin" /> : <Truck size={13} weight="bold" />} Receive into stock
                        </Button>
                        {(() => {
                          const mins = minutesSincePlaced(po)
                          const ss = /s&s|activewear/i.test(po.supplier || "")
                          // Past ten minutes S&S will refuse, so say so on the button
                          // rather than letting someone press it and read a rejection.
                          const tooLate = ss && reallySent(po) && mins != null && mins >= 10
                          return (
                            <button onClick={() => cancelPO(po)} disabled={busy === po.num}
                              className="text-xs font-medium text-muted-foreground hover:text-red-600"
                              title={tooLate
                                ? "Past S&S's 10-minute cancellation window — this will only cancel our record"
                                : ss && reallySent(po)
                                  ? `Cancels with S&S too — ${Math.max(0, 10 - (mins ?? 0))} min left of their window`
                                  : "Cancel our record of this order"}>
                              Cancel{tooLate ? " (our record only)" : ""}
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
                            <span className="font-mono text-foreground">{supplierOrderNo(po) ?? "—"}</span>
                          </span>
                          {/* S&S know their own tracking, so ask them rather than making
                              someone copy it across. Manual entry stays for suppliers with
                              no API — an Otto or hand-placed order still needs a box
                              chased. */}
                          {supplierOrderNo(po) && /s&s|activewear/i.test(po.supplier || "") ? (
                            <button onClick={() => fetchTracking(po)} disabled={tracking[po.num] === "loading"}
                              className="font-medium text-primary hover:underline disabled:opacity-60">
                              {tracking[po.num] === "loading" ? "Checking S&S…" : "Get tracking from S&S"}
                            </button>
                          ) : (
                            <label className="flex items-center gap-1.5 text-muted-foreground">
                              Tracking
                              <Input
                                defaultValue={trackingOf(po)}
                                onBlur={(e) => { if (e.target.value !== trackingOf(po)) setTracking(po, e.target.value) }}
                                placeholder="paste carrier number"
                                className="h-7 w-48 font-mono text-xs"
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
                              <span className="font-mono text-foreground">{t.tracking}</span>
                              {/* A box number only appears on split shipments — which is
                                  exactly when you need to know there's more than one. */}
                              {t.box && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">box {t.box}</span>}
                              {t.deliveredAt
                                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
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
                          S&amp;S have no tracking for this order yet — it hasn&apos;t shipped.
                        </div>
                      )}
                      {returnsOf(po).length > 0 && (
                        <div className="border-b border-border py-2.5">
                          <div className="mb-1 text-xs font-medium text-muted-foreground">Returns</div>
                          {returnsOf(po).map((r) => (
                            <div key={r.id} className="flex flex-wrap items-center gap-2 py-1 text-xs">
                              <span className="text-muted-foreground">
                                {r.lines.reduce((a, l) => a + num(l.qty), 0)} units
                                {r.rma ? ` · RMA ${r.rma}` : ""}
                                {r.note ? ` · ${r.note}` : ""}
                              </span>
                              {r.status === "credited" ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                                  <CheckCircle size={10} weight="fill" /> {usd(r.credit)} credited
                                </span>
                              ) : (
                                <>
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                                    {usd(r.credit)} expected
                                  </span>
                                  {/* Confirmed separately, because a credit lands when the
                                      supplier says so — not when the box went back. */}
                                  <button onClick={() => confirmCredit(po, r)} disabled={busy === po.num}
                                    className="font-medium text-primary hover:underline">
                                    Credit received
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {po.items.length === 0 ? (
                        <div className="py-3 text-sm text-muted-foreground">No lines on this PO.</div>
                      ) : po.items.map((l) => (
                        <div key={l.sku} className="flex items-center gap-3 py-2 text-sm">
                          <LineThumb src={l.image ?? poImgs[l.sku]} onZoom={(src, label) => setZoom({ src, label })}
                            label={[l.name || l.sku, l.variant].filter(Boolean).join(" · ")} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{l.name || l.sku}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {l.variant || l.sku}
                              <span className="ml-1.5 font-mono opacity-70">{l.sku}</span>
                            </div>
                            <SourceTags line={l} />
                          </div>
                          {/* A single line can be re-ordered on its own — restocking one
                              short blank shouldn't drag the whole past PO along with it. */}
                          <span className="text-muted-foreground">×{num(l.qty)}</span>
                          <span className="w-20 text-right tabular-nums text-muted-foreground">
                            {num(l.price) ? usd(num(l.price) * num(l.qty)) : "—"}
                          </span>
                          <button onClick={() => reorder(po, l)} className="text-muted-foreground hover:text-foreground" title="Reorder just this line">
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
      <div className="flex items-center gap-3 md:hidden">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShoppingCart size={18} weight="fill" /></span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Purchase</h1>
          <p className="truncate text-sm text-muted-foreground">Restock low inventory — draft POs per supplier, place via S&amp;S / Otto, receive into stock.</p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {/* Receiving is its own job, done at the bench with a scanner — not something
            you reach through a purchase order. */}
        <Button size="sm" variant="outline" onClick={() => setScanOpen(true)}>
          <Barcode size={13} weight="bold" /> Receive a box
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSupplierCfg(true)}>
          <Truck size={13} weight="bold" /> Order settings
        </Button>
        <Button size="sm" onClick={startBlankDraft} disabled={busy === "new"}>
          {busy === "new" ? <CircleNotch size={13} className="animate-spin" /> : <Plus size={13} weight="bold" />}
          New purchase order
        </Button>
      </div>

      <StatGrid>
        <StatCard label="Low stock" value={String((inv ?? []).filter(isLow).length)} sub="need reorder" tone={(inv ?? []).some(isLow) ? "neg" : undefined} />
        <StatCard label="To order" value={String(saved.length)} sub="waiting to be placed" />
        <StatCard label="Placed" value={String((pos ?? []).filter((p) => p.status === "placed").length)} sub="sent to suppliers" />
        <StatCard label="Received" value={String((pos ?? []).filter((p) => p.status === "received").length)} sub="into inventory" tone="pos" />
      </StatGrid>

      {msg && (
        <div className={"rounded-lg border px-4 py-2 text-sm " + (
          msg.tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800"
            : msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-destructive/30 bg-destructive/10 text-destructive")}>{msg.text}</div>
      )}

      {/* Reorder suggestions */}
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active{activeCount ? ` (${activeCount})` : ""}</TabsTrigger>
          {/* No count on History. It only grows — hundreds of POs eventually — and a
              number that always climbs and never needs acting on is decoration. */}
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ACTIVE — everything still owed something: a draft to finish, or an order to
            arrive. Split from history because these are the ones that need doing, and a
            working set buried under every PO ever received stops being read. */}
        <TabsContent value="active" className="mt-4 space-y-4">

        {/* ── TO ORDER ─────────────────────────────────────────────────────────
            One panel, always open. This is the working surface, and something you're
            mid-way through deciding shouldn't sit behind a click.

            Grouped by the supplier each line ACTUALLY comes from, so the split is
            visible BEFORE placing rather than being a surprise after. Nothing here is
            a "draft PO": no purchase order exists until you place one. Until then this
            is a list of what's short, which is the only honest description of it. */}
        <SectionCard
          title="To order"
          description="Everything short or set aside, grouped by the supplier it comes from"
          actions={
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {saved.reduce((s, l) => s + num(l.qty), 0)} units{toOrderTotal > 0 ? ` · ${usd(toOrderTotal)}` : ""}
              </span>
              <Button size="sm" variant="outline" onClick={() => setAddTo(POOL)}>
                <Plus size={13} weight="bold" /> Add items
              </Button>
              <Button size="sm" onClick={placeAllGroups} disabled={!saved.length || busy === "place-all"}>
                {busy === "place-all" ? <CircleNotch size={14} className="animate-spin" /> : <PaperPlaneTilt size={14} weight="bold" />}
                {toOrderGroups.length > 1 ? `Place ${toOrderGroups.length} orders` : "Place order"}
              </Button>
            </div>
          }
        >
          {saved.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Nothing waiting to be ordered. Items land here when an order runs stock short,
              or add them yourself with <strong>Add items</strong>.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {toOrderGroups.map((g) => (
                <div key={g.key}>
                  <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-5 py-2">
                    <span className="text-sm font-semibold">{g.supplier ?? "Unassigned"}</span>
                    {/* Only the exception is worth a chip. "Orders via API" was on the
                        majority of rows saying nothing actionable; "order by hand" is the
                        one that changes what you do next. */}
                    {!g.api && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">order by hand</span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {g.lines.length} line{g.lines.length === 1 ? "" : "s"} · {g.lines.reduce((s, l) => s + num(l.qty), 0)} units
                      {g.total > 0 ? ` · ${usd(g.total)}` : ""}
                    </span>
                  </div>
                  {g.lines.map((l) => (
                    <div key={l.sku} className="flex items-center gap-3 px-5 py-2.5">
                      <LineThumb src={l.image ?? supByS[l.sku]?.image} onZoom={(src, label) => setZoom({ src, label })}
                        label={[l.name || l.sku, l.variant].filter(Boolean).join(" · ")} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{l.name || l.sku}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {l.variant || supByS[l.sku]?.variant || l.sku}
                          <span className="ml-1.5 font-mono opacity-70">{l.sku}</span>
                        </div>
                        <SourceTags line={l} />
                      </div>
                      <Input
                        value={String(num(l.qty))}
                        onChange={(e) => setSavedQty(l.sku, Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
                        inputMode="numeric" className="h-8 w-20 text-center"
                        aria-label={`Quantity of ${l.sku}`}
                      />
                      <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">
                        {num(l.price) ? usd(num(l.price) * num(l.qty)) : "—"}
                      </span>
                      <button onClick={() => putSaved(saved.filter((s) => s.sku !== l.sku))}
                        className="text-muted-foreground hover:text-red-600" title="Drop — not ordering this">
                        <Trash size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

          {placed.length > 0 && (
            <SectionCard title="On order" description="Placed and waiting on the supplier — open one for its tracking, lines and invoice">
              <div className="divide-y divide-border">{placed.map(poRow)}</div>
            </SectionCard>
          )}
          {pos !== null && drafts.length === 0 && placed.length === 0 && (
            <SectionCard title="Nothing on order">
              <div className="py-10 text-center text-sm text-muted-foreground">
                No drafts, nothing in flight. Start one with <strong>New purchase order</strong>, or from a reorder suggestion above.
              </div>
            </SectionCard>
          )}
        </TabsContent>

        {/* HISTORY — settled: received or cancelled. Nothing further is expected. */}
        <TabsContent value="history" className="mt-4 space-y-4">
          <SectionCard title="Purchase history" description="Received and cancelled POs — open one to see its items, or reorder it onto a new draft">
            {pos === null ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
            ) : history.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Nothing received or cancelled yet.</div>
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

      <SupplierOrderingDialog open={supplierCfg} onOpenChange={setSupplierCfg} />

      <PoReturnDialog po={returning} onClose={() => setReturning(null)} onDone={load} />

      <POAddItems
        key={addTo?.num ?? "none"}
        po={addTo}
        onClose={() => setAddTo(null)}
        inventory={inv ?? []}
        // Picked items go into the POOL, merged by sku — the same merge the shortage
        // path uses, so something both short and hand-picked doesn't appear twice.
        onAdd={(lines) => {
          const next = saved.map((l) => ({ ...l }))
          for (const l of lines) {
            const hit = next.find((x) => x.sku === l.sku)
            if (hit) hit.qty = num(hit.qty) + (num(l.qty) || 1)
            else next.push({ ...l, qty: num(l.qty) || 1, savedAt: new Date().toISOString() })
          }
          putSaved(next)
        }}
      />
    </div>
  )
}
