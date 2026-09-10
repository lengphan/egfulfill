"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { onLive } from "@/lib/live"
import { ManifestDialog } from "@/components/app/manifest-dialog"
import { SearchField } from "@/components/app/search-field"
import { manifestReadiness, manifestTooltip } from "@/lib/manifest-eligible"
import { Truck, CircleNotch, Printer, CheckCircle, Warning, ArrowSquareOut, ArrowUUpLeft, XCircle, Clock, Barcode, CaretDown, type Icon } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { ActionsPortal, useActionNode } from "@/components/app/console-shell"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/app/confirm-dialog"
import { fetchShipmentLabel } from "@/lib/api"
import { packetHtml, printHtmlViaIframe } from "@/lib/label-packet"
import { getOrders, cachedOrders, streamOrders, getOrderHistory, postItemStatus, updateOrder, markLabelPrinted, cancelDispatch, markScannedInHouse, pushToDispatch, getDispatchStatus, getDispatchUploads, deleteDispatchUpload, type OrderRow, type AuditRow, type ShipAddress, type DispatchUpload } from "@/lib/api"
import { NewLabelDialog } from "@/components/app/new-label-dialog"
import { StagedLabelRow, UploadLabelRow, useLabelPullBack, PageDropZone, isPdf, readStagedLabel, sendStagedLabel, stagedKeyOf, uploadKeyOf, type StagedLabel } from "@/components/app/external-labels"
import {
  DISPATCH_GRID, DISPATCH_HEAD, DISPATCH_COLS, DISPATCH_COL_ORDER, DISPATCH_HIDDEN_DEFAULT,
  dispatchTemplate, type DispatchColId,
} from "@/components/app/dispatch-grid"
import { ColumnsMenu } from "@/components/app/columns-menu"
import { loadColumnOrder, loadHiddenColumns, saveColumnIds } from "@/lib/table-columns"
import { getUser } from "@/lib/auth"
import { numOf, platformOf, customerOf, unitsOf, addrLine, shipAddressOf } from "@/lib/order-format"
import { OrderNumber } from "@/components/app/order-number"
import { printPackingSlips as printSlips } from "@/lib/packing-slip"
import { canSetStage, canWalk, stagePath, normalizeStage, isException, orderStage, isFactoryOrder } from "@/lib/factory-status"
import { TabBar } from "@/components/app/tab-bar"

/**
 * DISPATCH — every label that needs scanning.
 *
 * The production queue answers "what are we making?"; this answers "what's going out
 * today?", a different job done by a different person at a different time — which is why
 * the batch has to be printable and handable rather than only clickable.
 *
 * IT IS A QUESTION ABOUT LABELS, NOT A STAGE.
 *
 * This used to hold `factory_status === 'awaiting_scan'`, which made the dispatch queue a
 * position in the middle of the PRODUCTION line. A label's journey doesn't run through
 * production, it runs beside it: bought, queued, handed to the scan service, picked — all
 * while the thing is still on the machine. One column can hold one of those, so the label
 * kept winning and a cap being embroidered read "Awaiting scan".
 *
 * So the queue is now the fact it always was: a tracking number with no scan against it.
 * Buying a label puts an order here (or a TikTok order arriving with the platform's own
 * tracking number — same test, we don't care who issued it). Recording a scan takes it
 * away. Nothing about production is claimed either way.
 *
 * Deliberately NOT wired to the design board: pushing artwork and moving custody are
 * separate claims, and coupling them would re-push designs we already have.
 */
const needsScan = (o: OrderRow) => {
 const fs = normalizeStage(o.factory_status)
  // A shipped or stopped order is nobody's scan job — it has left, or it has been halted.
 return !!o.tracking && !o.label_scanned_at && fs !== "shipped" && !isException(fs)
}

// Ship-to for the inline label dialog. The spelling fallbacks live in the shared reader —
// this only renames its fields for the carrier payload.
const toShip = (o: OrderRow): ShipAddress => {
  const a = shipAddressOf(o)
  return {
    name: a.name, street: a.line1, street2: a.line2,
    city: a.city, state: a.state, zip: a.zip,
  }
}
// History = every order that ever had a label, and WHAT BECAME OF IT — so a label pulled
// off the board isn't lost track of. `disposition` reads current state into one outcome.
/** `attention` belongs to EXTERNAL labels only — their extractor read the file and found
 * no label on it. No order can be in that state, which is why it has its own key rather
 * than being folded into one that already means something else. */
type DispKey = "scanned" | "shipped" | "awaiting" | "production" | "removed" | "cancelled" | "attention"
function disposition(o: OrderRow): { key: DispKey; label: string } {
 const fs = normalizeStage(o.factory_status)
 if (fs === "cancelled" || fs === "refunded") return { key: "cancelled", label: fs === "refunded" ? "Refunded" : "Cancelled" }
 if (fs === "shipped") return { key: "shipped", label: "Shipped" }
 if (o.label_scanned_at) return { key: "scanned", label: "Scanned" }
  // Not scanned yet — so this row says WHERE ITS LABEL IS, which is the only thing this
  // page is about. What production is doing is a separate answer and has its own column.
 if (o.tracking) return { key: "awaiting", label: "Not scanned" }
 return { key: "removed", label: "No label" }
}
/**
 * Outcome as a MARK AND A WORD, not a filled pill.
 *
 * Every row carried a tinted capsule, so a screen of history was six different coloured
 * blocks stacked down the left — the loudest thing in each row was its background, and
 * because each row differed, nothing stood out. Colour that is everywhere ranks nothing.
 *
 * The status colours themselves are unchanged and still mean what they mean on the floor
 * (emerald done, violet in production, amber needs a look, red cancelled, grey waiting) —
 * they just live in a 13px glyph now, with the word beside it in ordinary ink. Same
 * information, read the same way, without the row shouting it.
 */
const DISP_MARK: Record<DispKey, { icon: Icon; cls: string; weight?: "fill" | "bold" }> = {
  // Barcode and Truck are STROKED: at 13px a filled barcode is a solid green block — the
  // gaps between the bars are the glyph. The round badges (XCircle, Warning) need the mass.
 scanned: { icon: Barcode, cls: "text-shipped", weight: "bold" },
 shipped: { icon: Truck, cls: "text-shipped", weight: "bold" },
 awaiting: { icon: Clock, cls: "text-muted-foreground", weight: "bold" },
 production: { icon: Printer, cls: "text-working", weight: "bold" },
 removed: { icon: ArrowUUpLeft, cls: "text-hold", weight: "bold" },
 cancelled: { icon: XCircle, cls: "text-alert", weight: "fill" },
 attention: { icon: Warning, cls: "text-hold", weight: "fill" },
}
/** Status as an icon plus a word. Module scope, not defined inside the board — a component
 * declared during render is remounted every frame and the lint rule that forbids it exists
 * because that has bitten this codebase before. */
function DispStatus({ k, label }: { k: DispKey; label: string }) {
  const tl = useLabelT()
  /**
   * THE WORD, IN THE STATUS COLOUR. No glyph beside it.
   *
   * The icon was carrying the colour and the word was in ordinary ink, so the pair said one
   * thing twice — and it said it differently from every other status in the app, some of
   * which were tinted capsules. A column of statuses only has to be readable down its own
   * length, and a 13px glyph repeated forty times is texture, not information.
   *
   * The hue stays: emerald done, violet in production, amber needs a look, red cancelled,
   * grey waiting. That vocabulary is the floor's and it is reserved. What goes is the
   * decoration around it.
   */
 const m = DISP_MARK[k]
  // NO SIZE OF ITS OWN, matching StageBadge and SellerStatusBadge: a status set 12px in a
  // 14px row is the second thing you scan, rendered smaller than the store name.
 return <span className={"block max-w-full truncate font-medium " + m.cls}>{tl("dispatch", label)}</span>
}

// Shared column template for the history table — the header and every row use it so the
// columns line up. Scrolls horizontally inside the card rather than cramming on narrow.
// The per-label timeline shows DISPATCH actions only — scans, hand-offs to byeastside,
// pull-backs, label prints/voids, manifests. Order-level noise (order saved/updated, design
// files, charges) belongs on the order page, not the scan floor.
/**
 * FILTERS FOR THE SCAN QUEUE, which had none — only a search box, which answers "where is
 * THIS parcel" and not "show me the ones I can act on".
 *
 * The distinctions are the ones that change what you do next, not a taxonomy: a label
 * waiting to be scanned here, a label already with byeastside (nothing to do but wait), a
 * file dropped in that has not been sent, and an order the platform gave a tracking number
 * to. Counts on every chip, because a filter that hides how much it is hiding makes an
 * empty list ambiguous between "nothing matches" and "nothing exists".
 */
type QueueFilter = "all" | "here" | "partner" | "unsent" | "external"
const QUEUE_FILTERS: { key: QueueFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "here", label: "To scan here" },
  { key: "partner", label: "With byeastside" },
  { key: "unsent", label: "Not sent yet" },
  { key: "external", label: "External" },
]

/** `segmented` is GONE. It existed to give this strip one idiom instead of two — "All" a
 *  filled chip and the rest bare grey text — and the filter row is now the shared TabBar,
 *  which has exactly one idiom by construction. A prop whose whole job was to pick between
 *  two hand-rolled treatments has nothing left to pick between. */
export function DispatchBoard() {
  const tl = useLabelT()
 const role = getUser()?.role || ""
  /* Is a ConsoleShell above us? If so the page already has a title and an action band, and
     this card should not print a second of each. Outside one every branch below falls back
     to exactly what shipped. */
 const inShell = useActionNode() !== null
  /* Column layout, persisted per browser. Read in an effect: localStorage does not exist on
     the server, and a first paint that disagrees with the second is a flicker on every load. */
 const [colOrder, setColOrder] = useState<DispatchColId[]>(DISPATCH_COL_ORDER)
  /** The Add-label file input, clicked by its menu item — see the toolbar. */
 const pdfInput = useRef<HTMLInputElement>(null)
 const [hiddenCols, setHiddenCols] = useState<DispatchColId[]>(DISPATCH_HIDDEN_DEFAULT)
 useEffect(() => {
    const t = setTimeout(() => {
      const isId = (v: unknown): v is DispatchColId => typeof v === "string" && v in DISPATCH_COLS
      setColOrder(loadColumnOrder("eg_dispatch_cols", DISPATCH_COL_ORDER, isId))
      setHiddenCols(loadHiddenColumns("eg_dispatch_hidden", DISPATCH_HIDDEN_DEFAULT, isId))
    }, 0)
    return () => clearTimeout(t)
  }, [])
  /* Outside a ConsoleShell the board keeps all seven, so the template it draws is character
     for character the string this file used to hold — the mechanism changed, the layout did
     not. */
 const visibleCols = inShell ? colOrder.filter((id) => !hiddenCols.includes(id)) : DISPATCH_COL_ORDER
 const gridStyle = { gridTemplateColumns: dispatchTemplate(visibleCols) }
  /* CELL TYPE, MEASURED AGAINST THE ORDERS PAGE.
     /orders — the surface people point at as the readable one — sets its cell content at
     14px/500 (32 of its elements). This board set Channel, Units, Ship-to and Tracking at
     12px/400 muted (31 elements), two steps lighter and 2px smaller. A ship-to address and
     a 22-digit tracking number are the two things on the row someone reads against a
     physical parcel, and they were the smallest type on the page.
     Muted stays — that is real hierarchy. Only the SIZE was wrong. */
 const cell = inShell ? "text-sm" : "text-xs"
  // Operators work this board too — they are the ones who notice a label shouldn't go
  // out. What they cannot do is claim a parcel LEFT: "Mark scanned" asserts physical
  // custody and stays warehouse/admin (canSetStage refuses it server-side anyway).
  // Everything else here — printing, and pulling a label back — is theirs.
 const canScanOut = role !== "operator"
 const [orders, setOrders] = useState<OrderRow[] | null>(null)
  // The order whose label we're buying inline (a queue row with no label yet).
 const [labelFor, setLabelFor] = useState<OrderRow | null>(null)
 const [picked, setPicked] = useState<Set<string>>(new Set())
 const [busy, setBusy] = useState(false)
 const confirm = useConfirm()
 const [err, setErr] = useState<string | null>(null)
  // A thing that WORKED is not a warning. Both notices are transient and clear themselves,
  // but they can't share one box: "1 external label sent for pre-scan" in an amber panel
  // behind a ⚠ reads as a problem you have to go and check.
 const [sent, setSent] = useState<string | null>(null)
 const [q, setQ] = useState("")
  // Two views of the same board: what's waiting to go out, and what already went. The
  // second is a read-only history — "did this order actually get scanned?" was a question
  // that could only be answered by leaving for the Shipments page, so the floor now has it
  // where the scan happens.
 const [qFilter, setQFilter] = useState<QueueFilter>("all")
  // Expandable per-label action timeline (lazy-loaded from the audit log). undefined = not
  // fetched, null = loading, [] = fetched-empty.
 const [expanded, setExpanded] = useState<Set<string>>(new Set())
 const [auditByOrder, setAuditByOrder] = useState<Record<string, AuditRow[] | null>>({})
 const toggleTimeline = (id: string) => {
 const willOpen = !expanded.has(id)
 setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
 if (willOpen && auditByOrder[id] === undefined) {
 setAuditByOrder((p) => ({ ...p, [id]: null }))
 getOrderHistory(id).then((rows) => setAuditByOrder((p) => ({ ...p, [id]: rows ?? [] }))).catch(() => setAuditByOrder((p) => ({ ...p, [id]: [] })))
    }
  }

  /** A refresh after an action: the whole list in one request. */
  const load = useCallback(() => {
    if (!getUser()) { setOrders([]); return }
    getOrders().then((r) => setOrders(r ?? [])).catch(() => setOrders([]))
  }, [])
  /** First paint walks it a page at a time — 1.37MB whole against 0.16MB for the first 100.
   *  A reload after an action does not: the board is already on screen and nothing waits on
   *  a blank. In its own effect, not inside `load`, for the reason spelled out in orders-hub. */
  useEffect(() => {
    const ctl = new AbortController()
    const t = setTimeout(() => {
      if (!getUser()) { setOrders([]); return }
      const held = cachedOrders()
      if (held) { setOrders(held); return }
      streamOrders((rows) => setOrders(rows), { signal: ctl.signal })
        .catch(() => setOrders([]))
    }, 0)
    return () => { clearTimeout(t); ctl.abort() }
  }, [])
  // Auto-dismiss the status/notice line (e.g. "Pulled 1 back") — it's transient, not a
  // sticky error you must act on, so it clears itself after a few seconds.
 useEffect(() => {
 if (!err) return
 const t = setTimeout(() => setErr(null), 6000)
 return () => clearTimeout(t)
  }, [err])
 useEffect(() => {
 if (!sent) return
 const t = setTimeout(() => setSent(null), 6000)
 return () => clearTimeout(t)
  }, [sent])
  // The partner scans on their own schedule, so this board goes stale on its own — an
  // order byeastside scanned five minutes ago sits here looking unscanned until someone
  // reloads. The scan sync broadcasts, so listen rather than poll.
 useEffect(() => {
 const off = ["orders", "order-scanned"].map((t) => onLive(t, load))
 return () => { for (const f of off) f() }
  }, [load])

 const queue = useMemo(() => {
 const all = (orders ?? []).filter(needsScan)
 const term = q.trim().toLowerCase()
 const matched = term
      ? all.filter((o) => [numOf(o), customerOf(o), o.store, o.tracking].some((f) => String(f ?? "").toLowerCase().includes(term)))
 : all
    // Newest first — a just-dispatched order belongs at the top of the queue, not wherever
    // the server happened to return it.
 return [...matched].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
  }, [orders, q])

  // Orders still LINKED to the partner (dispatch_pdf_id) but no longer in the scan queue and
  // never scanned — i.e. a recall that failed (byeastside 500). They read amber forever with
  // no way to fix it from the queue, so surface them with an admin force-clear.
 const stuck = useMemo(() =>
    (orders ?? []).filter((o) => o.dispatch_pdf_id && !o.label_scanned_at && !needsScan(o)),
 [orders])

  // Admin escape hatch for a stuck link (partner refused the recall). Clears OUR dispatch_pdf_id
  // even on a partner error; the server records it. Use only after confirming the label is
  // actually removed on byeastside, since it may still be in their queue.
 const forceClear = async (ids: string[]) => {
 if (!ids.length) return
 setBusy(true); setErr(null)
 try {
 const r = await cancelDispatch(ids, true)
 const done = (r.results ?? []).filter((x) => x.ok).length
 setErr(done
        ? `Force-cleared ${done} — the byeastside link is removed and logged in history.`
 : (r.error || "Nothing to clear."))
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't force-clear.") }
 finally { setBusy(false); load() }
  }

  /**
   * External labels live HERE, not only in their own card.
   *
   * The board owns the fetch because GET /api/dispatch/uploads syncs from byeastside on
   * read — two components polling it would double the calls we make to a partner for one
   * screen's worth of information. ExternalLabels renders what it is handed.
   */
 const [uploads, setUploads] = useState<DispatchUpload[]>([])
 const loadUploads = useCallback(() => {
 getDispatchUploads().then((r) => setUploads(r.uploads ?? [])).catch(() => {})
  }, [])
 useEffect(() => {
 const t = setTimeout(loadUploads, 0)
 const id = setInterval(loadUploads, 30000)
 return () => { clearTimeout(t); clearInterval(id) }
  }, [loadUploads])

  /**
   * DROPPED, NOT SENT — and the selection that decides which of them go.
   *
   * A drop used to be an upload to an outside company, which made it the one irreversible
   * gesture on a screen where every other one is a tick box. Dropped files now wait in
   * `staged` on this machine, and leave only when "Send to byeastside" is pressed — the
   * same button, the same batch, as the orders above.
   *
   * The set holds BOTH kinds of external row (`s:` staged, `u:` already with the partner)
   * because the header's actions apply to both: Send takes the staged ones, Pull back
   * takes the sent ones, Remove discards the staged ones. Kept apart from `picked` (the
   * orders) so a mixed batch can't confuse one for the other.
   */
 const [staged, setStaged] = useState<StagedLabel[]>([])
 const [extPicked, setExtPicked] = useState<Set<string>>(new Set())
 const stageSeq = useRef(0)
  // Newly dropped files arrive TICKED. Dropping is already the statement of intent — the
  // box exists so you can change your mind, not so you have to say it twice.
 const stageFiles = useCallback((files: File[]) => {
    // `at` is what puts a just-dropped file at the TOP of the list rather than at the
    // bottom of the markup. Stamped here, on the drop, because that is the moment the row
    // came into existence — nothing else about the file records a time.
 const rows: StagedLabel[] = files.map((f) => ({
 key: String(++stageSeq.current), name: f.name, file: f, parse: null, at: Date.now(),
    }))
 setStaged((p) => [...p, ...rows])
 setExtPicked((p) => { const n = new Set(p); for (const r of rows) n.add(stagedKeyOf(r)); return n })
    // READ THE LABEL, in the background, one file at a time.
    //
    // The row appears immediately saying "Reading the label…" and fills in when the parse
    // lands, rather than the drop blocking on a PDF parse — a multi-page label takes long
    // enough to feel like the drop didn't register. Each result is merged by `key` so a
    // file discarded mid-parse doesn't come back from the dead.
 for (const r of rows) {
 void readStagedLabel(r).then((parse) =>
 setStaged((p) => p.map((s) => (s.key === r.key ? { ...s, parse } : s))))
    }
  }, [])
 const discardStaged = (k: string) => {
 setStaged((p) => p.filter((s) => stagedKeyOf(s) !== k))
 setExtPicked((p) => { const n = new Set(p); n.delete(k); return n })
  }
 const toggleExt = (k: string) =>
 setExtPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n })
 const stagedChosen = staged.filter((s) => extPicked.has(stagedKeyOf(s)))
 const uploadsChosen = uploads.filter((u) => extPicked.has(uploadKeyOf(u)))

  // The pull-back confirm + its failure message belong to the LIST, not to whichever row
  // was clicked — so one owner, here, shared by every upload row rendered below.
 const { pullBack: pullBackOne, pulling, err: pullErr } = useLabelPullBack(() => loadUploads())

  /**
   * ONE LIST, THREE KINDS, NEWEST FIRST.
   *
   * Orders, files waiting to be sent, and labels already with byeastside were rendered as
   * three blocks in that fixed order, so a file dropped ten seconds ago sat underneath an
   * order from yesterday. Nobody chose that ordering; it fell out of the markup. They are
   * all "a parcel going out", so they sort together on the one thing they all have — when
   * they arrived.
   *
   * Timestamps are ISO strings on every kind (a staged file stamps `at` when it is dropped),
   * which is why a string compare is a date compare here.
   */
 type QueueRow =
    | { kind: "order"; key: string; ts: string; o: OrderRow }
    | { kind: "staged"; key: string; ts: string; s: StagedLabel }
    | { kind: "upload"; key: string; ts: string; u: DispatchUpload }

 const allRows = useMemo<QueueRow[]>(() => {
 const term = q.trim().toLowerCase()
    // `queue` has already applied the search to orders; the label rows have their own
    // fields to match on, and a search that skipped them would hide the very parcel
    // someone typed a tracking number to find.
 const hit = (...f: (string | null | undefined)[]) =>
      !term || f.some((x) => String(x ?? "").toLowerCase().includes(term))
 const rows: QueueRow[] = queue.map((o) => ({ kind: "order", key: `o:${o.id}`, ts: String(o.created_at || ""), o }))
 for (const s of staged) {
 if (hit(s.name, s.parse?.name, s.parse?.shipTo, s.parse?.tracking)) {
 rows.push({ kind: "staged", key: stagedKeyOf(s), ts: new Date(s.at).toISOString(), s })
      }
    }
 for (const u of uploads) {
 if (hit(u.file_name, u.recipient, u.ship_to, u.tracking)) {
 rows.push({ kind: "upload", key: uploadKeyOf(u), ts: String(u.created_at || ""), u })
      }
    }
 return rows.sort((a, b) => b.ts.localeCompare(a.ts))
  }, [queue, staged, uploads, q])

  /** What each filter keeps. Written once so the chip counts and the list can never
   * disagree about what a filter means. */
 const matchesFilter = useCallback((r: QueueRow, f: QueueFilter) => {
 switch (f) {
 case "all": return true
      // Ours to scan: here on our floor, not handed to anyone.
 case "here": return r.kind === "order" && !r.o.dispatch_pdf_id
      // Waiting on someone else's floor — theirs to pick, ours to watch.
 case "partner": return (r.kind === "order" && !!r.o.dispatch_pdf_id) || r.kind === "upload"
      // Still on this machine. The only rows where "Send" does anything.
 case "unsent": return r.kind === "staged"
 case "external": return r.kind !== "order"
    }
  }, [])

 const rows = useMemo(() => allRows.filter((r) => matchesFilter(r, qFilter)), [allRows, qFilter, matchesFilter])
 const filterCounts = useMemo(() => {
 const out = {} as Record<QueueFilter, number>
 for (const f of QUEUE_FILTERS) out[f.key] = allRows.filter((r) => matchesFilter(r, f.key)).length
 return out
  }, [allRows, matchesFilter])



  // A label is what makes an order dispatchable. Without one there is nothing to scan, so
  // these are surfaced separately rather than silently included in a batch.
  // Everything in the queue has a label — that is the definition of being in it. What
  // varies is who is holding it: still on our bench, or already with the partner.
 const withPartner = queue.filter((o) => !!o.dispatch_pdf_id)

  // Is byeastside configured? Offering a route that can't work is worse than offering
  // one route, because the failure only shows after the click.
 /**
  * THREE STATES, NOT TWO — "off" and "couldn't ask" are different facts and §4 forbids
  * rendering them the same.
  *
  * This was a boolean seeded false with a `.catch(() => {})`. So any failure of
  * /api/dispatch/status — a 500, an expired token, a dropped connection — left it false
  * forever, and the page's PRIMARY route silently disappeared with nothing said. The
  * partner being genuinely unconfigured looked exactly the same, which is why "we lost the
  * Send button" is the shape this reaches a person in.
  */
 const [dispatchStatus, setDispatchStatus] = useState<"on" | "off" | "unknown">("off")
 useEffect(() => {
 const t = setTimeout(() => {
 getDispatchStatus()
      .then((d) => setDispatchStatus(d.configured ? "on" : "off"))
      .catch(() => setDispatchStatus("unknown"))
    }, 0)
 return () => clearTimeout(t)
  }, [])
 const dispatchOn = dispatchStatus === "on"

 const chosen = queue.filter((o) => picked.has(o.id))
 const chosenWithLabel = chosen.filter((o) => !!o.tracking)

 /* ONE CONDITION for the button and for the sentence that names it. Kept visible while a
    file is staged even if the partner reads unconfigured, so a staged file can never
    become unsendable — and visible on "unknown", because a route we merely failed to ASK
    about should be offered and refused by the server, not deleted from the page. */
 const canSendToPartner = dispatchOn || staged.length > 0 || dispatchStatus === "unknown"

 const toggle = (id: string) =>
 setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  /**
   * SELECT ALL means everything you can currently SEE.
   *
   * It used to mean every selectable row on the board, which was right when the board had
   * no filter and wrong the moment it got one: filtering to External and pressing "Select
   * all 5" put two orders you weren't looking at into the batch, and the next button you
   * pressed acted on them. A selection you cannot see is a selection you cannot check.
   *
   * Orders keep the "has a label" rule — an order with nothing to scan cannot join a batch.
   * External rows have no such rule: each one can either be sent or pulled back.
   */
 const visibleOrderIds = useMemo(
    () => rows.filter((r) => r.kind === "order" && !!r.o.tracking).map((r) => (r as { o: OrderRow }).o.id),
 [rows])
 const visibleExtKeys = useMemo(() => rows.filter((r) => r.kind !== "order").map((r) => r.key), [rows])
 const selectableAll = visibleOrderIds.length + visibleExtKeys.length
 const allSelected = selectableAll > 0
    && visibleOrderIds.every((id) => picked.has(id))
    && visibleExtKeys.every((k) => extPicked.has(k))
 const toggleAllRows = () => {
 const clear = allSelected
 setPicked(clear ? new Set() : new Set(visibleOrderIds))
 setExtPicked(clear ? new Set() : new Set(visibleExtKeys))
  }

  /** Advance a whole batch once it's been scanned. Per-order so one failure can't strand the rest. */
  /**
   * Hand these labels to byeastside for pre-scanning.
   *
   * The other half of the choice this board exists to offer. It does NOT advance the
   * stage: the partner scans on their own schedule and their sync writes
   * label_scanned_at when they actually do — claiming the work moved because we asked
   * them to would be asserting a fact about someone else's warehouse.
   */
 const sendToPartner = async () => {
 if (!chosenWithLabel.length && !stagedChosen.length) return
 setBusy(true); setErr(null); setSent(null)
 const notes: string[] = []
 try {
 if (chosenWithLabel.length) {
 const r = await pushToDispatch(chosenWithLabel.map((o) => o.id))
 if (r.error) throw new Error(r.error)
 const failed = (r.results ?? []).filter((x) => !x.ok)
        // Their words: byeastside don't document error codes, so what they sent back is
        // the only thing that helps.
 if (failed.length) notes.push(`${r.pushed ?? 0} order label${r.pushed === 1 ? "" : "s"} sent · ${failed.length} failed — ${failed[0].error ?? "unknown error"}`)
 setPicked(new Set())
      }
      // The dropped files, uploaded one at a time so a bad page names itself rather than
      // failing the batch anonymously. Each one that lands leaves `staged` immediately —
      // a retry after a mid-batch failure must not re-send what already went.
 if (stagedChosen.length) {
 let ok = 0
 for (const s of stagedChosen) {
 try {
 await sendStagedLabel(s)
 ok++
 discardStaged(stagedKeyOf(s))
          } catch (e) {
 notes.push(`${s.name}: ${e instanceof Error ? e.message : "couldn't be sent"}`)
 break
          }
        }
 if (ok) setSent(`${ok} external label${ok === 1 ? "" : "s"} sent for pre-scan.`)
 loadUploads()
      }
 setErr(notes.length ? notes.join(" · ") : null)
 load()
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't send those to byeastside.")
    } finally { setBusy(false) }
  }

  /**
   * NO "REMOVE FROM BOARD".
   *
   * It used to send the order back to Pending — rewinding PRODUCTION to take a label out of
   * the scan queue, because the queue was a production stage. A dispatch decision must never
   * say the cap stopped being made.
   *
   * There is also nothing left to remove: an order is listed here because it carries a
   * tracking number nobody has scanned. It leaves by being scanned, or by the label being
   * voided. Which parcels go in today's handover is what the tick-boxes are for, and
   * "Cancel with byeastside" still recalls anything already handed over.
   */

  /**
   * We scanned these ourselves. RECORD THE SCAN — and nothing else.
   *
   * It used to also walk the order two stages up the pipeline, because the scan WAS a stage.
   * That is the claim this change removes: scanning a label says the buyer's tracking is
   * live, not that the cap has been embroidered. An order can be scanned on Monday and
   * finished on Wednesday — that is the whole point of pre-scanning — and the stage must go
   * on saying what production is doing while that happens.
   *
   * So the only write is `label_scanned_at`, which is what the Scan chip has always read.
   * The order leaves this queue because it has been scanned, not because it moved.
   */
 const markScanned = async () => {
 if (!chosen.length) return
 setBusy(true); setErr(null)
 const failed: string[] = []
 for (const o of chosen) {
 try { await markScannedInHouse(o.id) } catch { failed.push(numOf(o)) }
    }
 setBusy(false)
 setPicked(new Set())
 if (failed.length) setErr(`Couldn't record the scan on ${failed.length} order${failed.length === 1 ? "" : "s"}: ${failed.join(", ")}`)
 load()
  }

  /**
   * Pull the chosen labels back out of the partner's pre-scan queue.
   *
   * Reported per order rather than as one pass/fail: the whole point is the mixed case —
   * push 5, one gets picked, recall the other 4. Anything already picked is refused by
   * the partner (409) because the buyer's tracking clock has started, and that refusal
   * is correct, so it's shown as a fact rather than an error to retry.
   */
 const pullBack = async () => {
 if (!chosen.length && !uploadsChosen.length) return
 setBusy(true); setErr(null)
 try {
 const parts: string[] = []
      // Selected EXTERNAL labels come back the same way, through their own endpoint —
      // they have no order, so cancelDispatch has nothing to key them on. Anything with a
      // picked label is left alone rather than sent to collect a certain 409: their DELETE
      // refuses the whole PDF once ANY label on it has gone out.
 if (uploadsChosen.length) {
 const recallable = uploadsChosen.filter((u) => u.scanned_labels === 0)
 const committed = uploadsChosen.length - recallable.length
 let done = 0
 for (const u of recallable) {
 try {
 const r = await deleteDispatchUpload(u.id)
 if (r.error) throw new Error(r.error)
 done++
 setExtPicked((p) => { const n = new Set(p); n.delete(uploadKeyOf(u)); return n })
          } catch (e) { parts.push(`${u.file_name || "a label"}: ${e instanceof Error ? e.message : "couldn't be pulled back"}`) }
        }
 if (done) parts.push(`Pulled ${done} external label${done === 1 ? "" : "s"} back`)
 if (committed) parts.push(`${committed} external already picked and can't be recalled`)
 loadUploads()
      }
 if (!chosen.length) {
 setErr(parts.length ? parts.join(" · ") : "Nothing to pull back.")
 return
      }
 const r = await cancelDispatch(chosen.map((o) => o.id))
 if (r.error) throw new Error(r.error)
 const results = r.results ?? []
 const scanned = results.filter((x) => !x.ok && x.reason === "already-scanned").length
 const other = results.filter((x) => !x.ok && x.reason !== "already-scanned")
 if (r.cancelled) parts.push(`Pulled ${r.cancelled} back`)
 if (scanned) parts.push(`${scanned} already picked and can't be recalled`)
 if (other.length) parts.push(`${other.length} failed (${other[0].reason})`)
 setErr(parts.length ? parts.join(" · ") : "Nothing to pull back.")
      // Keep the successfully pulled-back orders SELECTED — they stay on the board
      // (still unscanned) and the usual next move is to scan them in-house right away,
      // so "Scanned here" should be live without re-ticking every box. Already-picked ones
      // (couldn't recall) drop out of the selection.
 setPicked(new Set(results.filter((x) => x.ok).map((x) => String(x.id))))
 load()
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't pull those labels back.")
    } finally { setBusy(false) }
  }

  /**
   * Open each label for printing. Popup blockers stop the second window onward, so say so.
   *
   * Opening is available to operators — they print the batch. STAMPING it as printed is
   * not: POST /api/orders/:id/label-printed is warehouse/admin, because the stamp asserts
   * a label is on a parcel, which is a custody claim. So the stamp is only attempted by a
   * role the server will accept, and any real failure is reported rather than swallowed.
   * Previously every operator stamp 403'd into a .catch(() => {}), the Printed dots never
   * filled in, and nothing on screen explained why.
   */
 const canStampPrinted = role === "admin" || role === "warehouse"

  /**
   * REPRINT — every selected label in ONE document.
   *
   * `openLabels` below opens each label in its own browser tab, so a batch of eight arrives
   * as eight popups and the blocker stops seven of them. Selecting several and seeing one
   * label is that, not a lost label.
   *
   * So: fetch each stored PDF through our own same-origin route, render them into a single
   * packet, and print it in a hidden iframe. No popups to block, one print dialog, and the
   * pages come out in the order they were selected.
   *
   * Stamps them printed for the same reason the tab version does — the Printed dots are how
   * the floor knows a label is already on paper and does not need pulling again.
   */
 const [reprinting, setReprinting] = useState(false)
 const reprintLabels = async () => {
 const withLabel = chosen.filter((o) => !!o.tracking_label_url)
 if (!withLabel.length) {
 setErr("None of the selected orders have a stored label file to reprint.")
 return
    }
 setReprinting(true)
 const blobs: string[] = []
 try {
 const items: { labelBlobUrl: string; order: typeof withLabel[number] }[] = []
 const unreadable: string[] = []
 for (const o of withLabel) {
 try {
 const url = URL.createObjectURL(await fetchShipmentLabel(String(o.id)))
 blobs.push(url)
 items.push({ labelBlobUrl: url, order: o })
        } catch {
 unreadable.push(numOf(o))
        }
      }
 if (!items.length) { setErr("Couldn't read any of those label files."); return }

 const { html, skipped } = await packetHtml(items)
 await printHtmlViaIframe(html)

 const notes: string[] = []
 if (unreadable.length) notes.push(`${unreadable.length} label file${unreadable.length === 1 ? "" : "s"} couldn't be read (${unreadable.join(", ")}).`)
 if (skipped.length) notes.push(`${skipped.length} couldn't be rendered (${skipped.join(", ")}).`)

 if (canStampPrinted) {
 const results = await Promise.allSettled(items.map((i) => markLabelPrinted(String(i.order.id))))
 const failed = results.filter((r) => r.status === "rejected").length
 if (failed) notes.push(`${failed} couldn't be marked as printed — they still printed.`)
      } else {
 notes.push("Marking them printed is a warehouse/admin step, so the Printed dots won't fill in from here.")
      }
 setErr(notes.length ? notes.join(" · ") : null)
 load()
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't build the reprint packet.")
    } finally {
      // Blob URLs live until revoked; a batch a day would leak the whole PDF set.
 for (const b of blobs) { try { URL.revokeObjectURL(b) } catch { /* already gone */ } }
 setReprinting(false)
    }
  }
 const openLabels = async () => {
 const urls = chosenWithLabel.map((o) => o.tracking_label_url).filter(Boolean) as string[]
 if (!urls.length) { setErr("None of the selected orders have a stored label file."); return }
 let blocked = 0
 const opened: string[] = []
 for (const o of chosenWithLabel) {
 if (!o.tracking_label_url) continue
 if (window.open(o.tracking_label_url, "_blank", "noopener")) opened.push(o.id)
 else blocked++
    }
 const notes: string[] = []
 if (blocked) notes.push(`${blocked} label${blocked === 1 ? "" : "s"} blocked by your popup blocker — allow popups to print a whole batch at once.`)
 if (opened.length && canStampPrinted) {
 const results = await Promise.allSettled(opened.map((id) => markLabelPrinted(id)))
 const failed = results.filter((r) => r.status === "rejected").length
 if (failed) notes.push(`${failed} couldn't be marked as printed — the labels still opened.`)
    } else if (opened.length) {
 notes.push("Opened for printing. Marking them printed is a warehouse/admin step, so the Printed dots won't fill in from here.")
    }
 setErr(notes.length ? notes.join(" · ") : null)
 load()   // refresh so the Printed dots fill in
  }

  /**
   * A printable manifest of the batch. This is the piece a scan service actually needs —
   * one A4 page listing what's in the handover, with tracking numbers to check against.
   * Rendered into its own window so page styles can't leak in and break the print.
   */
 const printManifest = () => {
 if (!chosen.length) return
 const esc = (v: unknown) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))
 const rows = chosen.map((o, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="mono">${esc(numOf(o))}</td>
        <td>${esc(platformOf(o))}${o.store ? " · " + esc(o.store) : ""}</td>
        <td>${esc(customerOf(o))}</td>
        <td>${esc(unitsOf(o))}</td>
        <td class="mono">${esc(o.tracking || "—")}</td>
        <td class="tick"></td>
      </tr>`).join("")
 const w = window.open("", "_blank")
 if (!w) { setErr("Your popup blocker stopped the manifest — allow popups for this site."); return }
 w.document.write(`<!doctype html><html><head><title>Dispatch manifest</title><style>
      *{box-sizing:border-box}
 body{font:12px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:24px}
 h1{font-size:18px;margin:0 0 2px}
      .sub{color:#666;font-size:11px;margin-bottom:16px}
 table{width:100%;border-collapse:collapse}
 th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
 th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#666;border-bottom:1.5px solid #111}
      .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
      .tick{width:34px;border-left:1px solid #ddd}
 tfoot td{border:0;padding-top:14px;color:#666;font-size:11px}
      @page{size:A4;margin:14mm}
    </style></head><body>
      <h1>Dispatch manifest</h1>
      <div class="sub">${chosen.length} parcel${chosen.length === 1 ? "" : "s"} · prepared ${esc(new Date().toLocaleString("en-US"))}</div>
      <table>
        <thead><tr><th>#</th><th>Order</th><th>Channel</th><th>Customer</th><th>Units</th><th>Tracking</th><th>Scanned</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="7">Received by ______________________  Date ____________  Signature ______________________</td></tr></tfoot>
      </table>
    </body></html>`)
 w.document.close()
 w.focus()
 w.print()
  }

  // Packing slips — one per selected order, sized for a thermal 4x6 so the warehouse can
  // print them WITH the labels or on their own, and pick by SKU x qty. A separate slip
  // (never overlaid on the postage) so the USPS barcode is never at risk.
 const printPackingSlips = () => { const msg = printSlips(chosen); if (msg) setErr(msg) }

  // One click for the two documents a packer needs TOGETHER — the shipping label(s) and the
  // packing slip(s). Opens the labels (stamping them printed for warehouse/admin) then the
  // slips; each sub-action already reports its own popup-blocker note.
 const labelAndSlip = async () => {
 if (!chosenWithLabel.length) { setErr("None of the selected orders have a stored label file to print."); return }
 await openLabels()
 printPackingSlips()
  }

  // Finish All — the batch is done: scanned, made, and out the door. Walks every item all the
  // way to Shipped (one hop at a time so the skip guard passes), then sets the order Shipped,
  // so the seller sees Fulfilled. The server ship guard STILL applies per order — anything not
  // actually ready (a line unmade, no label) is skipped and reported, never force-shipped.
  //
  // The walk starts from EACH ORDER'S OWN stage, not from a fixed one. This queue is a
  // question about labels now, so the orders in it can be anywhere in production — one
  // pre-scanned on Monday and still on the machine, another finished and boxed.
 const finishAll = async () => {
 if (!chosen.length) return
 if (!(await confirm({ title: `Finish ${chosen.length} order${chosen.length === 1 ? "" : "s"}?`, body: `This marks ${chosen.length === 1 ? "it" : "them"} Shipped — Fulfilled to the seller — and closes ${chosen.length === 1 ? "it" : "them"} out.`, confirmLabel: "Finish", destructive: false }))) return
 setBusy(true); setErr(null)
 const failed: string[] = []
 for (const o of chosen) {
 try {
 await markScannedInHouse(o.id).catch(() => {})
 const from = o.factory_status ?? orderStage(o.items ?? [])
 for (const stage of stagePath(from, "shipped", isFactoryOrder(o)) ?? ["shipped"]) {
 for (const it of o.items ?? []) {
 if (it.sku || it.line_id) await postItemStatus(o.id, it.sku ?? "", stage, it.line_id)
          }
        }
 await updateOrder(o.id, { factoryStatus: "shipped", status: "shipped" })
      } catch { failed.push(numOf(o)) }
    }
 setBusy(false); setPicked(new Set())
 if (failed.length) setErr(`Couldn't finish ${failed.length} order${failed.length === 1 ? "" : "s"}: ${failed.join(", ")} — every item must be made and labelled first.`)
 load()
  }

  // "Scanned here" needs no stage permission at all now — it records a scan, and a scan is
  // not a claim about production. The role gate that remains is the one that always
  // mattered: `canScanOut`, since asserting physical custody stays warehouse/admin.
  // Finishing DOES move the stage, all the way to Shipped, so it keeps its walk test —
  // asked of each selected order's own stage, because they can be anywhere in production.
 const canFinish = chosen.every((o) => {
 const from = o.factory_status ?? orderStage(o.items ?? [])
 const fac = isFactoryOrder(o)
 return canWalk(role, from, "shipped", fac) || canSetStage(role, from, "shipped", fac)
  })
 const [manifestOpen, setManifestOpen] = useState(false)
  // Mirrors the server's eligibility rules (lib/manifest-eligible.ts) so the button can
  // say why before the click rather than after.
 const manifestable = manifestReadiness(chosen).eligible

 if (orders === null) {
 return <div className="flex items-center justify-center py-20 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
  }

  /* THE CARD'S ACTION ROW, lifted out of the JSX so it goes to exactly one place.
     Left as `actions={...}` on SectionCard it drew a header strip the portal then emptied —
     a 35px band of nothing above the queue, because SectionCard renders its header whenever
     `actions` is truthy and a portal element still is. Inside a shell the card gets nothing
     and the row is portaled into the page band; outside one it is the card's header exactly
     as before. */
  const searchEl = (
    <SearchField
      value={q}
      onChange={setQ}
      width="sm"
      placeholder={tl("dispatch", "Search the queue")}
          hotkey
    />
  )
  const headActions = (
          <div className="flex flex-wrap items-center gap-2">
            {/* PRINT / documents — grouped: manifest, labels, and (when scanning out) the
                USPS SCAN form. All are "produce a document" actions, none touch the scan. */}
            <DropdownMenu>
              <DropdownMenuTrigger className="eg-control">
                {tl("dispatch", "Print")} <CaretDown size={12} weight="bold" className="text-muted-foreground" />
              </DropdownMenuTrigger>
              {/**
                * WORDS, NOT ICONS — the rule the purchase board already follows.
                *
                * Five items each carried a glyph and TWO CARRIED THE SAME ONE — a printer, on
                * Open labels and on Reprint labels — so the mark that had to tell two actions
                * apart told you nothing, while the rest needed decoding before the word beside
                * them was read.
                *
                * And the menu is called Print, so "Print manifest" says Print twice. What
                * survives is the noun; the menu supplies the verb.
                */}
              <DropdownMenuContent align="start" className="w-44 p-1">
                <DropdownMenuItem disabled={!chosen.length} onClick={printPackingSlips}>
                  {tl("dispatch", "Packing slips")}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!chosen.length} onClick={printManifest}>
                  {tl("dispatch", "Manifest")}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!chosenWithLabel.length} onClick={openLabels}>
                  {tl("dispatch", "Labels")}
                </DropdownMenuItem>
                {/* REPRINT sits beside the SCAN form: both produce paper, neither spends
 money. Deliberately a separate item from anything that BUYS a label —
 one button that both buys and reprints is how a reprint becomes a
 second purchase. */}
                <DropdownMenuItem
 disabled={!chosen.some((o) => o.tracking_label_url) || reprinting || busy}
 onClick={reprintLabels}
                >
                  {tl("dispatch", "Reprint labels")}
                </DropdownMenuItem>
                {canScanOut && (
                  <DropdownMenuItem disabled={!chosen.length || busy} onClick={() => setManifestOpen(true)} title={manifestTooltip(chosen)}>
                    {tl("dispatch", "SCAN form")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Dropping a file anywhere on this page is the primary gesture (PageDropZone);
                this is the same thing for a mouse. It is an INPUT rather than a button now,
                because the visible control moved into the Actions menu and a menu item cannot
                wrap a file input — so the item clicks this instead. Same accept, same PDF
                test, one upload path. */}
            <input
              ref={pdfInput}
              type="file" multiple className="sr-only" accept="application/pdf"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? [])
                e.target.value = ""
                if (!list.length) return
                // Caught before anything leaves, so picking a photo by accident answers
                // instantly. The server checks the bytes too — this one is about the wait.
                const bad = list.filter((f) => !isPdf(f))
                const good = list.filter(isPdf)
                setErr(bad.length ? `${bad.map((f) => f.name).join(", ")} — only PDFs can be pre-scanned, that's what carriers issue.` : null)
                if (good.length) stageFiles(good)
              }}
            />

            {/**
             * ONE ACTIONS MENU (owner, 2026-09-10).
             *
             * The row carried six controls: Print, Add label PDF, More, Send to byeastside,
             * Scanned here, Finish All. Three of them were the same KIND of thing — a batch
             * verb applied to whatever is ticked — sitting loose beside a menu that already
             * held two more of exactly that kind. So "what can I do with these?" was answered
             * in two places, and which place depended on how often we guessed you would want
             * it. Three controls now: print, add, act.
             *
             * THE TRIGGER IS THE FILLED ONE. §4 wants one primary per screen — the thing the
             * screen is FOR — and with every verb behind this menu, this is it. Leaving it as
             * a plain control would give the toolbar no primary at all, which is the failure
             * the variants exist to prevent.
             *
             * ORDERED AS A SHIFT RUNS, not alphabetically or by how dangerous they are: send
             * it out, record the scan, finish it. Then the occasional paperwork. Then the two
             * that walk something back, last and behind a rule, because undo belongs where a
             * hand does not land by accident.
             *
             * THE PARTNER IS NOT NAMED ANY MORE. "Send to byeastside" and "Cancel with
             * byeastside" told the floor which company handles a pre-scan, on a screen where
             * the only thing that matters is whether the parcel is scanned there or here.
             * "Send To Scan" and "Cancel Scan" say the job. §2.9 is about not naming who
             * supplies us; this is the same instinct one step in.
             */}
            <DropdownMenu>
              <DropdownMenuTrigger className="eg-tap inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50">
                {tl("dispatch", "Actions")} <CaretDown size={12} weight="bold" className="opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 p-1">
                {canSendToPartner && (
                  <DropdownMenuItem
                    disabled={(!chosenWithLabel.length && !stagedChosen.length) || busy}
                    onClick={sendToPartner}
                    title={stagedChosen.length
                      ? `Upload ${chosenWithLabel.length ? tl("dispatch", "these labels and ") : ""}${stagedChosen.length} dropped file${stagedChosen.length === 1 ? "" : "s"} to the pre-scan queue`
                      : tl("dispatch", "Upload these labels to the pre-scan queue — charges the expedite fee per label")}
                  >
                    {tl("dispatch", "Send To Scan")}
                  </DropdownMenuItem>
                )}
                {canScanOut && (
                  <DropdownMenuItem
                    disabled={!chosen.length || busy}
                    onClick={markScanned}
                    title={tl("dispatch", "Record that we scanned these ourselves — starts the buyer's tracking. Doesn't change what production is doing.")}
                  >
                    {tl("dispatch", "Scan Here")}
                  </DropdownMenuItem>
                )}
                {canScanOut && (
                  <DropdownMenuItem
                    disabled={!chosen.length || busy || !canFinish}
                    onClick={finishAll}
                    title={canFinish ? tl("dispatch", "Mark the selected orders Shipped & Fulfilled") : tl("dispatch", "Your role can't ship orders out")}
                  >
                    {tl("dispatch", "Finish All")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!chosenWithLabel.length || busy} onClick={labelAndSlip}>
                  {tl("dispatch", "Label & Slip")}
                </DropdownMenuItem>
                {/* Never disabled: adding a label is the one action here that does not act on
                    a selection, so it is available whether anything is ticked or not. */}
                <DropdownMenuItem onClick={() => pdfInput.current?.click()}
                  title={tl("dispatch", "Choose label PDFs — or just drop them anywhere on this page")}>
                  {tl("dispatch", "Add label PDF")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={(!chosen.length && !uploadsChosen.length) || busy} onClick={pullBack}>
                  {tl("dispatch", "Cancel Scan")}
                </DropdownMenuItem>
                {/* Discards any selected file that was dropped but never sent. Only staged
                    files — an ORDER has nothing to discard, it is listed because it has an
                    unscanned label. */}
                <DropdownMenuItem
                  disabled={!stagedChosen.length || busy}
                  onClick={() => { for (const s of stagedChosen) discardStaged(stagedKeyOf(s)) }}
                  title={tl("dispatch", "Discard the dropped files that haven't been sent anywhere")}
                >
                  {tl("dispatch", "Discard dropped files")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
  )

 return (
    <div className="space-y-4">
      {inShell && (
        <ActionsPortal>
          {/* Search first, then the actions — the reading order of /orders' header line. */}
          {searchEl}
          {headActions}
        </ActionsPortal>
      )}
      <StatGrid>
        <StatCard label={tl("dispatch", "To scan")} value={String(queue.length)} sub={tl("dispatch", "labelled, not scanned yet")} tone="pos" />
        <StatCard label={tl("dispatch", "With byeastside")} value={String(withPartner.length)} sub={tl("dispatch", "in their queue, not picked yet")} tone={withPartner.length ? "neg" : "mut"} />
      </StatGrid>

      {/* Stuck with the partner: still linked (dispatch_pdf_id) but off the board and unscanned,
 because the recall failed. Admin-only force-clear — the ONE way to un-stick the amber
          Scan tag when byeastside won't take the label back. */}
      {role === "admin" && stuck.length > 0 && (
        <div className="rounded-xl border border-hold/30 bg-hold/10 p-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-hold">
            <Warning size={15} weight="fill" />
            {stuck.length} order{stuck.length === 1 ? "" : "s"} still linked to byeastside but off the board
          </div>
          <p className="mt-1 text-xs text-hold">
            {tl("dispatch", "Their recall failed, so the Scan tag stays amber.")} <b>{tl("dispatch", "Only after you’ve confirmed the label is removed on byeastside")}</b>{tl("dispatch", ", force-clear our link — it may still be in their queue otherwise.")}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {stuck.map((o) => (
              <button
 key={o.id} type="button" disabled={busy} onClick={() => void forceClear([o.id])}
 className="eg-tap inline-flex items-center gap-1 rounded-lg border border-hold/40 bg-white px-2 py-1 text-xs font-medium text-hold transition-colors hover:bg-hold/15 disabled:opacity-50"
 title={`Force-clear ${numOf(o)}'s byeastside link`}
              >
                <span className="tabular-nums">{numOf(o)}</span> {tl("dispatch", "· Force-clear")}
              </button>
            ))}
            {stuck.length > 1 && (
              <button
 type="button" disabled={busy} onClick={() => void forceClear(stuck.map((o) => o.id))}
 className="eg-tap inline-flex items-center gap-1 rounded-lg bg-hold px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-hold disabled:opacity-50"
              >
                Force-clear all {stuck.length}
              </button>
            )}
          </div>
        </div>
      )}

      {/* The one thing someone could reasonably assume wrong, said once, next to the rows
 it describes. Sharing a table with orders makes "this is not an order" MORE worth
 saying, not less — and it only appears once such a row exists. */}
      {/* PROSE ABOVE THE WORK (§4). Two lines explaining one filter, printed above a queue
          people read all day and read first every time. Inside the console shell it is gone
          and the sentence lives on the External chip's own title, where it is asked for
          rather than served. Outside the shell nothing changes. */}
      {!inShell && (staged.length > 0 || uploads.length > 0) && (
        <p className="px-1 text-xs text-muted-foreground">
          {/* The explicit spaces are load-bearing: the compiler drops the one after a
 closing tag mid-line, which shipped as "Externalare labels from outside". */}
          Rows tagged <b>{tl("dispatch", "External")}</b>{" "}
 are labels from outside — they&apos;re not attached to an
          EGFUL order and nothing is charged for them.{" "}
          {/* NAMING A BUTTON THAT IS NOT THERE. This sentence was gated on
              `staged.length > 0 || uploads.length > 0` while the button it names was gated
              on `dispatchOn || staged.length > 0` — so with uploads present, nothing staged
              and the partner reading unconfigured, the page instructed someone to press a
              control it had hidden. Both now read `canSendToPartner`, and when the route is
              unavailable the sentence says why instead. A refusal carries its reason. */}
          {/* No "couldn't be reached" branch: an unknown status KEEPS the button, so the
              only way to reach this else is a partner that really is not connected. */}
          {canSendToPartner ? (
            <>Tick one and press <b>{tl("dispatch", "Send to byeastside")}</b> to put it in their pre-scan queue.</>
          ) : (
            <>{tl("dispatch", "byeastside isn't connected, so they can't be sent — add its keys in Settings › Integrations.")}</>
          )}
        </p>
      )}

      <SectionCard
 /* The page's tab already reads "Dispatch" and the top bar already reads "Shipping".
    A third naming is the duplicate-title defect one level down. */
 title={inShell ? undefined : tl("dispatch", "Dispatch")}
 actions={inShell ? undefined : headActions}
      >
        {/**
         * TWO LEVELS, TWO ROWS (owner, 2026-09-10: "2 sets of filters? … not sure of
         * hierarchy").
         *
         * These were one strip of seven controls at one size, and they are not peers.
         * "To scan / History" swaps the WHOLE TABLE for a different query; "All / To scan
         * here / With byeastside / …" narrows whichever table that produced. Side by side
         * and identically weighted, History read as a sixth filter — and it is the one
         * control on the row that changes what the other five are filtering.
         *
         * Making them the SAME SHAPE was a deliberate earlier decision, taken to stop the row
         * looking like two kinds of control jammed together. It solved the wrong half: they
         * genuinely ARE two kinds, and the mess was that nothing said which governed which.
         * A line break says it — the top row decides the list, the row under it narrows it —
         * which is what Mercury does with its status tabs above a separate filter bar.
         */}
        {/* Back to even padding. The asymmetric pb-2/pt-3 was there to tuck the filter row
            up under the view switcher above it; with one row it just reads as off-centre. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          {/* SEARCH SITS WITH THE ACTIONS, NOT UNDER THE FILTERS.
              Splitting the strip in two put the filters on row one and pushed search onto row
              two, so the thing you reach for most moved DOWN every time a filter row grew.
              /orders does not do that: its search is in the header line beside Import and New
              order, and only the filters take a row of their own. Inside a shell this goes to
              the page's action band; outside one it stays exactly where it was. */}
          {!inShell && (
            <SearchField
              value={q}
              onChange={setQ}
              width="sm"
              placeholder={tl("dispatch", "Search the queue")}
          hotkey
            />
          )}
          {/* TWO ROWS, THE WAY /orders DOES IT — filters on their own line, then search and
              the selection utilities. One line held the view tabs, the search, five counted
              filters and Select-all: thirteen controls in ~150px, which is the "messy" of it.
              Done with flex `order` and a full-basis break rather than by restructuring the
              JSX, so nothing here changes owner and every control keeps its handler. */}
          {(
            <TabBar
              spacing="none"
              /* NO `basis-full` ANY MORE. It was added to force a line break between the view
                 switcher and these filters, back when "To scan / History" sat above them and
                 the two levels needed separating. History is gone, so there is one level —
                 and the forced break was leaving a band of empty card between the filters and
                 the table, with Columns and Select all stranded far right on a row of their
                 own. One level, one row; it still wraps on its own when there is no room. */
              className={"border-b-0" + (inShell ? " order-2" : "")}
              size="sm"
              ariaLabel={tl("dispatch", "Filter the queue")}
              value={qFilter}
              onChange={setQFilter}
              items={QUEUE_FILTERS.map((f) => ({
                id: f.key,
                label: tl("dispatch", f.label),
                /* THE TWO THAT ARE WORK. "With byeastside" and "External" are states a
                   parcel is in, not a queue anybody is being asked to clear, and "All" is the
                   list itself — none of them is news at a glance. To scan here and Not sent
                   yet are. See the note on TabBarItem.count. */
                count: f.key === "here" || f.key === "unsent" ? filterCounts[f.key] || 0 : undefined,
                disabled: f.key !== "all" && !filterCounts[f.key],
                /* The sentence that used to sit above the whole queue, on the one control it
                   was ever about. */
                title: f.key === "external"
                  ? tl("dispatch", "Labels from outside — not attached to an EGFUL order, and nothing is charged for them. Tick one and press Send to byeastside to put it in their pre-scan queue.")
                  : undefined,
              }))}
            />
          )}
          {/* ml-auto: with the filter chips added, the batch count and Select all were being
 wrapped to a second line one at a time and reading as stray controls. Pinned
 right, they wrap together as the pair they are. */}
          {/* THE COUNT IS ALREADY ON THE CHIP. This printed the same number twice, 400px
              apart: the live filter always carries its own count ("All · 14", "External ·
              2"), and `rows.length` IS that filter's result — so "14 rows" restated the
              chip the eye had just read. It also cost the row exactly the width it did not
              have: 977px of space against ~987px of controls, which pushed Select-all onto
              a line of its own and made one utility row read as two. That wrap is most of
              what "cluttered" was here.
              /orders keeps its "962 orders" because /orders has no counted filter chips. */}
          {chosen.length + extPicked.size > 0 && (
            <span className={"text-muted-foreground " + (inShell ? "order-5 ml-auto text-sm" : "ml-auto text-xs")}>{chosen.length + extPicked.size} in this batch</span>
          )}
          {/* ONE select-all for one table. It used to be two — this one for orders, another
 in the external card's header — which meant "select all" never selected all of
 what was on screen, and the count in each button was a count of half the list. */}
          {/* Columns sits on the utility line beside the count and Select-all — the band whose
              job is reshaping the table, not acting on it. Same place /orders puts it. */}
          {inShell && (
            <ColumnsMenu
              /* ml-auto lives on whichever right-hand element comes first: the batch count
                 only exists while something is ticked, so without it here the pair would
                 drift back to the middle the moment a selection is cleared. */
              className="order-6 [&:first-of-type]:ml-auto"
              cols={DISPATCH_COLS}
              order={colOrder}
              hidden={hiddenCols}
              isLocked={(id) => !!DISPATCH_COLS[id].locked}
              defaults={{ order: [...DISPATCH_COL_ORDER], hidden: [...DISPATCH_HIDDEN_DEFAULT] }}
              labelNs="dispatch"
              onOrder={(ids) => { setColOrder(ids); saveColumnIds("eg_dispatch_cols", ids) }}
              onHidden={(ids) => { setHiddenCols(ids); saveColumnIds("eg_dispatch_hidden", ids) }}
            />
          )}
          {(
            <Button size="sm" variant="outline" disabled={!selectableAll} onClick={toggleAllRows}
              className={inShell ? "order-7" : undefined}>
              {allSelected ? tl("dispatch", "Clear selection") : `Select all ${selectableAll}`}
            </Button>
          )}
        </div>

        {/* A pull-back that byeastside refused reads the same as any other board failure —
 it is the board's message, not the row's, which is why the hook is owned here. */}
        {(err || pullErr) && (
          <div className="mx-5 mt-3 flex items-start gap-2 rounded-lg border border-hold/30 bg-hold/10 p-2.5 text-xs text-hold">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err || pullErr}
          </div>
        )}
        {sent && (
          <div className="mx-5 mt-3 flex items-start gap-2 text-xs text-shipped">
            <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0" /> {sent}
          </div>
        )}

        {/* NO HISTORY VIEW. It was a second table behind a view switch on this card,
            and its two halves have better homes: an order that has been labelled or
            scanned is a row on Shipments, and WHO did it and when is the Activity feed,
            which already filters to label and dispatch actions. A board for work waiting
            to be done should not also be the archive of work that is finished.
            See the commit for the one thing this does lose. */}
          {/* ONE COLUMN PER FACT — the same nine the external-label list uses, so the two
              cards read as one screen (see dispatch-grid.ts). Channel, units, address and
              status used to share a single wrapping line under the order number, which made
              the address the thing that moved every row&apos;s status somewhere different. */}
          <div className="overflow-x-auto">
            <div className={DISPATCH_GRID + " " + DISPATCH_HEAD} style={gridStyle}>
              <span />
              {/* FROM THE REGISTRY, so the header, the tracks and the Columns control can
                  never disagree — and a column turned off leaves all three together. */}
              {visibleCols.map((id) => <span key={id}>{tl("dispatch", DISPATCH_COLS[id].label)}</span>)}
              <span />
            </div>
            <div className="divide-y divide-border">
            {/* Newest first (queue is already sorted by created/scan time), NOT grouped by
 label — a just-dispatched order should stay on top, not sink below older
 labelled ones. Whether it has a label yet is shown by a per-row tag, not by
 dimming the whole row (which read as "cancelled"). */}
            {rows.map((r) => {
              // The two label kinds render themselves; an order row is the long one, so it
              // stays inline rather than becoming a component that would have to be handed
              // eight callbacks.
 if (r.kind === "staged") {
 return (
                  <StagedLabelRow
 key={r.key} s={r.s}
 picked={extPicked.has(r.key)} onToggle={toggleExt} onDiscard={discardStaged}
                    template={gridStyle.gridTemplateColumns}
                    cols={visibleCols}
                  />
                )
              }
 if (r.kind === "upload") {
 return (
                  <UploadLabelRow
 key={r.key} u={r.u}
 picked={extPicked.has(r.key)} onToggle={toggleExt}
 busy={busy} pulling={pulling} onPullBack={(u) => void pullBackOne(u)}
                    template={gridStyle.gridTemplateColumns}
                    cols={visibleCols}
                  />
                )
              }
 const o = r.o
 const d = disposition(o)
              // Handed over but not yet picked — an order state the disposition vocabulary
              // has no word for, because it is about custody rather than outcome.
 const sentOut = !o.label_scanned_at && !!o.dispatch_pdf_id
 return (
                <label
 key={r.key}
 className={DISPATCH_GRID + " cursor-pointer py-3 transition-colors hover:bg-accent/40"} style={gridStyle}
                >
                  {/* Selectable whether or not it has a label. Only the label-dependent
                      ACTIONS need one; tying the checkbox itself to a label left an
 unlabelled order impossible to select and therefore impossible to
 remove — stuck on the board with nothing that could touch it. */}
                  <input
 type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)}
 className="size-4 shrink-0 accent-primary" aria-label={`Select ${numOf(o)}`}
                  />
                  {/* ONE MAP, from the same visible list the header uses — seven hand-written
                      spans could not stay aligned with a header that can hide a column. */}
                  {visibleCols.map((id) => {
                    if (id === "order") return (
                      <span key={id} className="truncate">
                        <OrderNumber order={o} />
                      </span>
                    )
                    if (id === "customer") return <span key={id} className="truncate text-sm">{customerOf(o)}</span>
                    if (id === "channel") return (
                      <span key={id} className={"truncate text-muted-foreground " + cell} title={o.store || undefined}>
                        {platformOf(o)}{o.store && o.store.toLowerCase() !== platformOf(o).toLowerCase() ? ` · ${o.store}` : ""}
                      </span>
                    )
                    if (id === "units") return <span key={id} className={"text-muted-foreground " + cell}>{unitsOf(o)}</span>
                    if (id === "shipto") return <span key={id} className={"truncate text-muted-foreground " + cell} title={addrLine(o) || undefined}>{addrLine(o) || "—"}</span>
                    /* The label's OWN status — not the production readiness pills, which belong
                       on the make boards. "Sent to partner" is the byeastside hand-off (pushed
                       but not scanned back yet), so it is visible whether a parcel is out for
                       external scan or still waiting here. */
                    if (id === "status") return (
                      <span key={id} className="min-w-0">
                        {sentOut ? <DispStatus k="removed" label={tl("dispatch", "Sent to partner")} /> : <DispStatus k={d.key} label={d.label} />}
                      </span>
                    )
                    return o.tracking ? (
                      <span key={id} className={"truncate tabular-nums text-muted-foreground " + cell} title={o.tracking}>{o.tracking}</span>
                    ) : (
                      // No label yet → give the action right here rather than a dead gap. Buys
                      // the label for this order (stopPropagation: the row is a <label>).
                      <button
                        key={id}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLabelFor(o) }}
                        className="eg-tap inline-flex w-fit items-center gap-1 rounded-lg border border-primary/40 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                      >
                        {tl("dispatch", "Create label")}
                      </button>
                    )
                  })}
                  <span className="flex justify-end gap-1">
                    {o.tracking_label_url && (
                      <a
 href={o.tracking_label_url} target="_blank" rel="noopener noreferrer"
 onClick={(e) => e.stopPropagation()}
 className="eg-tap shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
 aria-label={`Open label for ${numOf(o)}`}
                      >
                        <ArrowSquareOut size={13} weight="bold" />
                      </a>
                    )}
                  </span>
                </label>
              )
            })}
            </div>
          </div>
      </SectionCard>

      {/* Drag a file anywhere over this screen and the target is the whole window. Rendered
 last and fixed-position, so it sits over everything without any layout of its own. */}
      <PageDropZone onStage={stageFiles} />

      {/* Keyed on the selection so reopening after a different pick can't show the
 previous batch's preview for a frame. */}
      <ManifestDialog
        /* THE WHOLE SELECTION, not just the eligible part.
           Passing only eligible orders meant the dialog could not mention the rest: pick
 ten, have nine filtered out here, and it opened talking about one — or, when
 none qualified, the item was disabled and clicking it did nothing at all, which
 is indistinguishable from a broken button. The preview already returns a reason
 per skipped order; it just was never given them to explain. */
 key={chosen.map((o) => o.id).join(",")}
 orderIds={chosen.map((o) => o.id)}
 open={manifestOpen}
 onOpenChange={setManifestOpen}
 onDone={() => { setPicked(new Set()); load() }}
      />

      {/* Buy a label for a queue order that arrived without one — opened from the row's
          "Create label" button, seeded with that order's ship-to. */}
      <NewLabelDialog
 open={!!labelFor}
 onOpenChange={(v) => { if (!v) setLabelFor(null) }}
 onCreated={() => {
          // Same reason as the orders hub: closing here unmounts the dialog before it can
          // fetch the label and print. It closes itself on Done.
 load()
        }}
 order={labelFor ? { id: String(labelFor.id), num: numOf(labelFor), to: toShip(labelFor) } : undefined}
      />
    </div>
  )
}
