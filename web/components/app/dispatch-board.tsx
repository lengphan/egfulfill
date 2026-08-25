"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { onLive } from "@/lib/live"
import { ManifestDialog } from "@/components/app/manifest-dialog"
import { manifestReadiness, manifestTooltip } from "@/lib/manifest-eligible"
import { Truck, CircleNotch, Printer, CheckCircle, Warning, ArrowSquareOut, ListChecks, ArrowUUpLeft, TrayArrowDown, UploadSimple, X, XCircle, Clock, FilePdf, Barcode, CaretDown, CaretRight, Package, type Icon } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/app/confirm-dialog"
import { Input } from "@/components/ui/input"
import { fetchShipmentLabel } from "@/lib/api"
import { packetHtml, printHtmlViaIframe } from "@/lib/label-packet"
import { getOrders, getOrderHistory, postItemStatus, updateOrder, markLabelPrinted, cancelDispatch, markScannedInHouse, pushToDispatch, getDispatchStatus, getDispatchUploads, deleteDispatchUpload, type OrderRow, type AuditRow, type ShipAddress, type DispatchUpload } from "@/lib/api"
import { NewLabelDialog } from "@/components/app/new-label-dialog"
import { StagedLabelRow, UploadLabelRow, useLabelPullBack, AddLabelButton, PageDropZone, readStagedLabel, sendStagedLabel, stagedKeyOf, uploadKeyOf, type StagedLabel } from "@/components/app/external-labels"
import { DISPATCH_GRID, DISPATCH_HEAD } from "@/components/app/dispatch-grid"
import { getUser } from "@/lib/auth"
import { ActivityFeed } from "@/components/app/activity-feed"
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
/**
 * WHAT A DROPPED LABEL BECAME, in the same vocabulary as an order's.
 *
 * `total_labels` null and 0 are different facts and stay different here: null is "their
 * extractor hasn't read it yet", 0 is "it read it and there was no label on the page". The
 * first is a wait, the second is a file to re-send.
 *
 * The scanned/total ratio is deliberately NOT shown — one PDF is one parcel, so it only
 * ever read "0 of 1" or "1 of 1". See progressOf in external-labels.tsx.
 */
function extDisposition(u: DispatchUpload): { key: DispKey; label: string } {
 if (u.total_labels == null) return { key: "awaiting", label: "Reading the file" }
 if (u.total_labels === 0) return { key: "attention", label: "No label found" }
 if (u.scanned_labels >= u.total_labels) return { key: "scanned", label: "Picked" }
 return { key: "awaiting", label: "Waiting to be picked" }
}

/**
 * History holds two kinds of thing that are NOT the same shape: our orders, and labels
 * dropped in that belong to no order. They are interleaved rather than given separate
 * tabs, because the question the floor asks is "what went to byeastside and what came
 * back", and splitting the answer in two makes it unanswerable in one glance. Each row
 * still says plainly which kind it is.
 */
type HistRow =
  | { kind: "order"; id: string; at: string; disp: { key: DispKey; label: string }; o: OrderRow }
  | { kind: "external"; id: string; at: string; disp: { key: DispKey; label: string }; u: DispatchUpload }

/**
 * How this label reached the dispatch queue. Four answers, and they are mutually exclusive:
 *
 *   Drop zone     — dropped in as an external label; belongs to no order.
 * byeastside    — pushed to the partner from the queue (or picked by them).
 *   Scanned here  — someone scanned it on our own bench.
 *   Carrier       — the carrier's acceptance scan came back through tracking. The only one
 * of the four nobody here asserted, which is exactly why it is named.
 *
 * A label bought but not yet moved has no method yet, and says so with a dash rather than
 * guessing at one.
 */
function methodOf(o: OrderRow): { label: string; icon: Icon } | null {
 const via = (o as { scanned_via?: string | null }).scanned_via
 if (via === "partner" || o.dispatch_pdf_id) return { label: "byeastside", icon: TrayArrowDown }
 if (via === "in-house") return { label: "Scanned here", icon: Barcode }
 if (via === "carrier") return { label: "Carrier", icon: Truck }
 return null
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
 return <span className={"block max-w-full truncate text-xs font-medium " + m.cls}>{tl("dispatch", label)}</span>
}

// Shared column template for the history table — the header and every row use it so the
// columns line up. Scrolls horizontally inside the card rather than cramming on narrow.
/**
 * HOW THE LABEL GOT HERE — a column, because the row could not say it.
 *
 * "Channel" answers where the ORDER came from (Etsy, Shopify, Manual). It cannot answer
 * how the LABEL reached the queue, and those are different questions with the same-shaped
 * answer, which is why one column could not carry both: an order pushed to byeastside and
 * one scanned on our own bench were indistinguishable on the row, and the only place the
 * difference existed was inside the expanded timeline.
 *
 * Widths come out of `when` (10rem -> 9rem — a date needs less than it had) and the
 * customer floor (7rem -> 6rem), so the row's minimum grows by ~1.5rem rather than 7.5.
 */
const HIST_GRID = "grid items-center gap-3 px-5 grid-cols-[1rem_9.5rem_12rem_minmax(6rem,1fr)_8rem_7.5rem_9rem_2rem]"
// The per-label timeline shows DISPATCH actions only — scans, hand-offs to byeastside,
// pull-backs, label prints/voids, manifests. Order-level noise (order saved/updated, design
// files, charges) belongs on the order page, not the scan floor.
const DISPATCH_ACTIONS = /^order\.scan|^dispatch\.|^label\.|^order\.manifested|^order\.(shipped|tracking)/
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

const HIST_FILTERS: { key: "all" | DispKey; label: string }[] = [
  { key: "all", label: "All" }, { key: "scanned", label: "Scanned" }, { key: "awaiting", label: "To scan" },
  { key: "production", label: "In production" }, { key: "shipped", label: "Shipped" },
  { key: "removed", label: "Off board" }, { key: "cancelled", label: "Cancelled" },
  { key: "attention", label: "Needs a look" },
]

export function DispatchBoard() {
  const tl = useLabelT()
 const role = getUser()?.role || ""
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
 const [view, setView] = useState<"queue" | "history">("queue")
 const [histFilter, setHistFilter] = useState<"all" | DispKey>("all")
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

 const load = useCallback(() => {
 if (!getUser()) { setOrders([]); return }
 getOrders().then((r) => setOrders(r ?? [])).catch(() => setOrders([]))
  }, [])
 useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])
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


  // History — EVERY order that ever had a label (bought → has tracking, or scanned),
  // whatever became of it, PLUS every label dropped in that belongs to no order. A label
  // pulled off the board still shows here with its outcome, so nothing vanishes.
  // Searchable, and filterable by disposition.
 const history = useMemo<HistRow[]>(() => {
 const term = q.trim().toLowerCase()

 const orderRows: HistRow[] = (orders ?? [])
      .filter((o) => o.tracking || o.label_scanned_at)
      .filter((o) => !term || [numOf(o), customerOf(o), o.store, o.tracking].some((f) => String(f ?? "").toLowerCase().includes(term)))
      .map((o) => ({ kind: "order", id: o.id, at: String(o.label_scanned_at || o.created_at || ""), disp: disposition(o), o }))

 const extRows: HistRow[] = uploads
      // Searchable by the same terms that make sense for them: the file, and any tracking
      // number their extractor pulled off it.
      .filter((u) => !term || [u.file_name, ...(u.labels ?? []).map((l) => l.trackingNumber)]
        .some((f) => String(f ?? "").toLowerCase().includes(term)))
      .map((u) => ({ kind: "external", id: `ext-${u.id}`, at: String(u.created_at || ""), disp: extDisposition(u), u }))

 const all = [...orderRows, ...extRows]
 const list = histFilter === "all" ? all : all.filter((r) => r.disp.key === histFilter)
    // Most recent activity first — the scan time if there is one, else when it landed.
 return list.sort((a, b) => b.at.localeCompare(a.at))
  }, [orders, uploads, q, histFilter])

  // A label is what makes an order dispatchable. Without one there is nothing to scan, so
  // these are surfaced separately rather than silently included in a batch.
  // Everything in the queue has a label — that is the definition of being in it. What
  // varies is who is holding it: still on our bench, or already with the partner.
 const withPartner = queue.filter((o) => !!o.dispatch_pdf_id)

  // Is byeastside configured? Offering a route that can't work is worse than offering
  // one route, because the failure only shows after the click.
 const [dispatchOn, setDispatchOn] = useState(false)
 useEffect(() => {
 const t = setTimeout(() => { getDispatchStatus().then((d) => setDispatchOn(!!d.configured)).catch(() => {}) }, 0)
 return () => clearTimeout(t)
  }, [])

 const chosen = queue.filter((o) => picked.has(o.id))
 const chosenWithLabel = chosen.filter((o) => !!o.tracking)

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

 return (
    <div className="space-y-4">
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
      {view !== "history" && (staged.length > 0 || uploads.length > 0) && (
        <p className="px-1 text-xs text-muted-foreground">
          {/* The explicit spaces are load-bearing: the compiler drops the one after a
 closing tag mid-line, which shipped as "Externalare labels from outside". */}
          Rows tagged <b>{tl("dispatch", "External")}</b>{" "}
 are labels from outside — they&apos;re not attached to an
          EGFUL order and nothing is charged for them. Tick one and press{" "}
          <b>{tl("dispatch", "Send to byeastside")}</b> to put it in their pre-scan queue.
        </p>
      )}

      <SectionCard
 title={tl("dispatch", "Dispatch")}
 actions={view === "history" ? undefined : (
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
 this is the same thing for a mouse, at the weight it deserves — one control
 among the others rather than a band above them. */}
            <AddLabelButton onStage={stageFiles} onError={setErr} />

            {/* SEVEN BUTTONS IN A ROW IS A SEARCH, NOT A TOOLBAR.
                Label & Slip and the two walk-it-back actions move behind one More menu, so
 the row carries only what a shift actually presses: print, send, scan, finish.
                The rule: at most a handful of actions in the row, one of them filled, and
 everything occasional behind a menu — including the things that spend most of
 their life disabled, which were taking prime space to do nothing. */}
            <DropdownMenu>
              <DropdownMenuTrigger className="eg-control">
                {tl("dispatch", "More")} <CaretDown size={12} weight="bold" className="text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 p-1">
                <DropdownMenuItem disabled={!chosenWithLabel.length || busy} onClick={labelAndSlip}>
                  {tl("dispatch", "Label & Slip")}
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
                <DropdownMenuItem disabled={(!chosen.length && !uploadsChosen.length) || busy} onClick={pullBack}>
                  {tl("dispatch", "Cancel with byeastside")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* THE TWO ROUTES kept prominent — this is where the choice is made. Both start
 the buyer's tracking clock; they differ in who does it and what it costs. */}
            {/* Also the send button for external labels dropped below — a dropped file now
 waits to be sent rather than sending itself, and this is what sends it. Kept
 visible while any file is waiting even if the partner reads as unconfigured,
 so a staged file can never become unsendable. */}
            {(dispatchOn || staged.length > 0) && (
              <Button size="sm" variant="outline" disabled={(!chosenWithLabel.length && !stagedChosen.length) || busy} onClick={sendToPartner}
 title={stagedChosen.length
                  ? `Upload ${chosenWithLabel.length ? tl("dispatch", "these labels and ") : ""}${stagedChosen.length} dropped file${stagedChosen.length === 1 ? "" : "s"} to byeastside's pre-scan queue`
 : tl("dispatch", "Upload these labels to byeastside's pre-scan queue — charges the expedite fee per label")}>
                {busy ? <CircleNotch size={14} className="animate-spin" /> : tl("dispatch", "Send to byeastside")}
              </Button>
            )}
            {canScanOut && (
              <Button size="sm" variant="outline" disabled={!chosen.length || busy} onClick={markScanned}
 title={tl("dispatch", "Record that we scanned these ourselves — starts the buyer's tracking. Doesn't change what production is doing.")}>
                {busy ? <CircleNotch size={14} className="animate-spin" /> : tl("dispatch", "Scanned here")}
              </Button>
            )}
            {canScanOut && (
              <Button size="sm" disabled={!chosen.length || busy || !canFinish} onClick={finishAll}
 title={canFinish ? tl("dispatch", "Mark the selected orders Shipped & Fulfilled") : tl("dispatch", "Your role can't ship orders out")}>
                {busy ? <CircleNotch size={14} className="animate-spin" /> : tl("dispatch", "Finish All")}
              </Button>
            )}
          </div>
        )}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          {/* Waiting-to-scan vs. history: two VIEWS of this card, kept here rather than on a
              second page so the search box and stat cards above stay put. It was a boxed
              segmented control whose active half went solid `bg-primary` — the same fill as
              the Finish All button four inches to its right, so the row had two black
              rectangles meaning completely different things. A rule under the live word. */}
          <TabBar
            size="sm"
            ariaLabel="Dispatch view"
            className="shrink-0 border-b-0"
            items={[
              { id: "queue" as const, label: tl("dispatch", "To scan") },
              { id: "history" as const, label: tl("dispatch", "History"), count: history.length || undefined },
            ]}
            value={view}
            onChange={setView}
          />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tl("dispatch", "Search order, customer or tracking…")} className="h-9 max-w-xs" />
          {view === "history" && (
            <div className="flex flex-wrap items-center gap-1">
              {HIST_FILTERS.map((f) => (
                <button
 key={f.key}
 onClick={() => setHistFilter(f.key)}
 className={"rounded-md px-2 py-1 text-xs font-medium transition-colors " + (histFilter === f.key ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                >
                  {tl("dispatch", f.label)}
                </button>
              ))}
            </div>
          )}
          {/* Filter chips, the same shape History already uses — one screen, one idiom.
              Counted, so an empty list is never ambiguous between "nothing matches this
 filter" and "nothing is here at all". */}
          {view === "queue" && (
            <div className="flex flex-wrap items-center gap-1">
              {QUEUE_FILTERS.map((f) => (
                <button
 key={f.key}
 onClick={() => setQFilter(f.key)}
 disabled={f.key !== "all" && !filterCounts[f.key]}
 className={"rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 " +
                    (qFilter === f.key ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                >
                  {tl("dispatch", f.label)}{filterCounts[f.key] ? ` · ${filterCounts[f.key]}` : ""}
                </button>
              ))}
            </div>
          )}
          {/* ml-auto: with the filter chips added, the batch count and Select all were being
 wrapped to a second line one at a time and reading as stray controls. Pinned
 right, they wrap together as the pair they are. */}
          {view === "queue" && chosen.length + extPicked.size > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">{chosen.length + extPicked.size} in this batch</span>
          )}
          {/* ONE select-all for one table. It used to be two — this one for orders, another
 in the external card's header — which meant "select all" never selected all of
 what was on screen, and the count in each button was a count of half the list. */}
          {view === "queue" && (
            <Button size="sm" variant="outline" disabled={!selectableAll} onClick={toggleAllRows}>
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

        {view === "history" ? (
 history.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <ListChecks size={26} weight="duotone" className="opacity-50" />
              <div className="text-sm font-medium text-foreground">{q || histFilter !== "all" ? tl("dispatch", "Nothing matches") : tl("dispatch", "No label activity yet")}</div>
              <div className="text-xs">{tl("dispatch", "Every label and what became of it — scanned, shipped, pulled off the board, or dropped in from outside — shows here.")}</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className={HIST_GRID + " border-b border-border py-2 eg-label text-muted-foreground"}>
                <span />
                <span>{tl("dispatch", "Status")}</span>
                <span>{tl("dispatch", "Order / file")}</span>
                <span>{tl("dispatch", "Customer")}</span>
                <span>{tl("dispatch", "Channel")}</span>
                <span>{tl("dispatch", "Method")}</span>
                <span>{tl("dispatch", "When")}</span>
                <span />
              </div>
              <div className="divide-y divide-border">
              {history.map((row) => {
 const open = expanded.has(row.id)
 const when = row.at
                  ? new Date(row.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
 : "—"

                /* ── A LABEL THAT BELONGS TO NO ORDER ──────────────────────────────
                   Same columns, filled with what it actually has. It does NOT borrow an
 order number or invent a customer: the file IS the identity, and the
 channel column says plainly where it came from. Expanding shows the
 tracking numbers their extractor pulled off it, which is this row's
 equivalent of an order's dispatch timeline. */
 if (row.kind === "external") {
 const u = row.u
 const tracked = (u.labels ?? []).map((l) => l.trackingNumber).filter(Boolean) as string[]
 return (
                    <div key={row.id}>
                      <div onClick={() => toggleTimeline(row.id)} className={HIST_GRID + " cursor-pointer py-3 transition-colors hover:bg-accent/40"}>
                        <CaretRight size={13} weight="bold" className={"shrink-0 text-muted-foreground transition-transform " + (open ? "rotate-90" : "")} />
                        <DispStatus k={row.disp.key} label={row.disp.label} />
                        <span className="flex min-w-0 items-center gap-1.5">
                          <FilePdf size={13} className="shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm" title={u.file_name || undefined}>{u.file_name || "label.pdf"}</span>
                        </span>
                        {/* No customer, and it says so rather than borrowing one. The page
 count goes here because it is the closest thing this row has to
                            "what's in it". */}
                        <span className="truncate text-sm text-muted-foreground">
                          {u.total_pages ? `${u.total_pages} page${u.total_pages === 1 ? "" : "s"}` : "—"}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">{tl("dispatch", "External label")}</span>
                        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                          <UploadSimple size={12} className="shrink-0 opacity-70" />
                          <span className="truncate">{tl("dispatch", "Drop zone")}</span>
                        </span>
                        <span className="truncate text-xs text-muted-foreground" title={u.created_by ? `Sent by ${u.created_by}` : undefined}>{when}</span>
                        {u.public_url ? (
                          <a
 href={u.public_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
 className="eg-tap shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
 aria-label={`Open ${u.file_name || "label"}`}
                          >
                            <ArrowSquareOut size={13} weight="bold" />
                          </a>
                        ) : <span />}
                      </div>
                      {open && (
                        <div className="space-y-1 border-t border-border bg-muted/20 py-2.5 pl-11 pr-5 text-sm">
                          {tracked.length ? tracked.map((t) => {
 const picked = (u.labels ?? []).find((l) => l.trackingNumber === t)?.status === "PICKED"
 return (
                              <div key={t} className="flex items-center gap-2 text-xs">
                                <Barcode size={12} className={"shrink-0 " + (picked ? "text-shipped" : "text-muted-foreground")} />
                                <span className="tabular-nums">{t}</span>
                                <span className="text-muted-foreground">{picked ? "picked" : "waiting"}</span>
                              </div>
                            )
                          }) : (
                            <div className="text-xs text-muted-foreground">
                              {u.total_labels === 0
                                ? tl("dispatch", "byeastside read the file and found no tracking label on it — re-send a clearer copy.")
 : tl("dispatch", "No tracking numbers read off this file yet.")}
                            </div>
                          )}
                          <div className="pt-1 text-2xs text-muted-foreground">
                            Not attached to an EGFUL order{u.created_by ? ` · sent by ${u.created_by}` : ""}.
                          </div>
                        </div>
                      )}
                    </div>
                  )
                }

 const o = row.o
 const d = row.disp
 const events = auditByOrder[o.id]
 return (
                  <div key={row.id}>
                    {/* Row toggles the action timeline. Click the label-link separately. */}
                    <div onClick={() => toggleTimeline(o.id)} className={HIST_GRID + " cursor-pointer py-3 transition-colors hover:bg-accent/40"}>
                      <CaretRight size={13} weight="bold" className={"shrink-0 text-muted-foreground transition-transform " + (open ? "rotate-90" : "")} />
                      <DispStatus k={d.key} label={d.label} />
                      <span className="truncate tabular-nums text-sm font-semibold">
                        <OrderNumber order={o} editable onSaved={() => load()} />
                      </span>
                      <span className="truncate text-sm">{customerOf(o)}</span>
                      <span className="truncate text-xs text-muted-foreground">{platformOf(o)}{o.store && o.store.toLowerCase() !== platformOf(o).toLowerCase() ? ` · ${o.store}` : ""}</span>
                      {(() => {
 const m = methodOf(o)
 if (!m) return <span className="text-xs text-muted-foreground">—</span>
 const I = m.icon
 return (
                          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                            <I size={12} className="shrink-0 opacity-70" />
                            <span className="truncate">{tl("dispatch", m.label)}</span>
                          </span>
                        )
                      })()}
                      <span className="truncate text-xs text-muted-foreground" title={o.label_scanned_at ? tl("dispatch", "Scanned") : tl("dispatch", "Labelled")}>
                        {when}
                      </span>
                      {o.tracking_label_url ? (
                        <a
 href={o.tracking_label_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
 className="eg-tap shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
 aria-label={`Open label for ${numOf(o)}`}
                        >
                          <ArrowSquareOut size={13} weight="bold" />
                        </a>
                      ) : <span />}
                    </div>
                    {/* Timestamped DISPATCH timeline — scans, hand-offs, pull-backs, labels.
                        Not the full order history (order edits, design files) — that's the
 order page. Oldest → newest so it reads as the label's story. */}
                    {open && (() => {
 const evs = Array.isArray(events)
                        ? events.filter((ev) => DISPATCH_ACTIONS.test(ev.action)).sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
 : null
 return (
                        <div className="border-t border-border bg-muted/20 py-2 pl-11 pr-5">
                          {events === null || events === undefined ? (
                            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><CircleNotch size={14} className="animate-spin" /> {tl("dispatch", "Loading dispatch history…")}</div>
                          ) : !evs || evs.length === 0 ? (
                            <div className="py-2 text-sm text-muted-foreground">{tl("dispatch", "No dispatch actions recorded for this label yet.")}</div>
                          ) : (
                            <ActivityFeed rows={evs} variant="bare" note />
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
              </div>
            </div>
          )
        ) : queue.length === 0 && !staged.length && !uploads.length ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <Truck size={26} weight="duotone" className="opacity-50" />
            <div className="text-sm font-medium text-foreground">{tl("dispatch", "Nothing waiting to go out")}</div>
            <div className="text-xs">{tl("dispatch", "An order appears here the moment it has a label nobody has scanned — or drop a label PDF anywhere on this page.")}</div>
          </div>
        ) : (
          /* ONE COLUMN PER FACT — the same nine the external-label list uses, so the two
 cards read as one screen (see dispatch-grid.ts). Channel, units, address and
 status used to share a single wrapping line under the order number, which made
 the address the thing that moved every row's status somewhere different. */
          <div className="overflow-x-auto">
            <div className={DISPATCH_GRID + " " + DISPATCH_HEAD}>
              <span />
              <span>{tl("dispatch", "Order")}</span>
              <span>{tl("dispatch", "Customer")}</span>
              <span>{tl("dispatch", "Channel")}</span>
              <span>{tl("dispatch", "Units")}</span>
              <span>{tl("dispatch", "Ship to")}</span>
              <span>{tl("dispatch", "Status")}</span>
              <span>{tl("dispatch", "Tracking")}</span>
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
                  />
                )
              }
 if (r.kind === "upload") {
 return (
                  <UploadLabelRow
 key={r.key} u={r.u}
 picked={extPicked.has(r.key)} onToggle={toggleExt}
 busy={busy} pulling={pulling} onPullBack={(u) => void pullBackOne(u)}
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
 className={DISPATCH_GRID + " cursor-pointer py-3 transition-colors hover:bg-accent/40"}
                >
                  {/* Selectable whether or not it has a label. Only the label-dependent
                      ACTIONS need one; tying the checkbox itself to a label left an
 unlabelled order impossible to select and therefore impossible to
 remove — stuck on the board with nothing that could touch it. */}
                  <input
 type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)}
 className="size-4 shrink-0 accent-primary" aria-label={`Select ${numOf(o)}`}
                  />
                  <span className="truncate tabular-nums text-sm font-semibold">
                    <OrderNumber order={o} editable onSaved={() => load()} />
                  </span>
                  <span className="truncate text-sm">{customerOf(o)}</span>
                  <span className="truncate text-xs text-muted-foreground" title={o.store || undefined}>
                    {platformOf(o)}{o.store && o.store.toLowerCase() !== platformOf(o).toLowerCase() ? ` · ${o.store}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">{unitsOf(o)}</span>
                  <span className="truncate text-xs text-muted-foreground" title={addrLine(o) || undefined}>{addrLine(o) || "—"}</span>
                  {/* The label's OWN status — not the production readiness pills, which belong
 on the make boards. "Sent to partner" is the byeastside hand-off (pushed
 but not scanned back yet), so it's visible whether a parcel is out for
 external scan or still waiting here. */}
                  <span className="min-w-0">
                    {sentOut ? <DispStatus k="removed" label={tl("dispatch", "Sent to partner")} /> : <DispStatus k={d.key} label={d.label} />}
                  </span>
                  {o.tracking ? (
                    <span className="truncate text-xs tabular-nums text-muted-foreground" title={o.tracking}>{o.tracking}</span>
                  ) : (
                    // No label yet → give the action right here rather than a dead gap. Buys
                    // the label for this order (stopPropagation: the row is a <label>).
                    <button
 onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLabelFor(o) }}
 className="eg-tap inline-flex w-fit items-center gap-1 rounded-lg border border-primary/40 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      {tl("dispatch", "Create label")}
                    </button>
                  )}
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
        )}
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
