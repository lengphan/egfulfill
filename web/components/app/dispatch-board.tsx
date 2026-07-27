"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { onLive } from "@/lib/live"
import { ManifestDialog } from "@/components/app/manifest-dialog"
import { manifestReadiness, manifestTooltip } from "@/lib/manifest-eligible"
import { Truck, CircleNotch, Printer, CheckCircle, Warning, ArrowSquareOut, ListChecks, ArrowUUpLeft, TrayArrowDown, X, Barcode, CaretDown, CaretRight, Package, Tag } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getOrders, getOrderHistory, postItemStatus, updateOrder, markLabelPrinted, cancelDispatch, markScannedInHouse, pushToDispatch, getDispatchStatus, type OrderRow, type AuditRow, type ShipAddress } from "@/lib/api"
import { NewLabelDialog } from "@/components/app/new-label-dialog"
import { getUser } from "@/lib/auth"
import { ActivityFeed } from "@/components/app/activity-feed"
import { numOf, platformOf, customerOf, unitsOf, addrLine } from "@/lib/order-format"
import { canSetStage, canWalk, stagePath, normalizeStage } from "@/lib/factory-status"

/**
 * DISPATCH — everything that has finished production and is waiting to leave.
 *
 * The production queue answers "what are we making?"; this answers "what's going out
 * today?", which is a different job done by a different person at a different time. Orders
 * land here at `awaiting_scan` and leave when their labels have been scanned — either by
 * us or by a third-party scan service, which is why the batch has to be printable and
 * handable rather than only clickable.
 *
 * Deliberately NOT wired to the design board: pushing artwork and moving custody are
 * separate claims, and coupling them would re-push designs we already have.
 */

const STAGE = "awaiting_scan"

// Ship-to for the inline label dialog, read from the order's address with the same loose
// fallbacks the boards use (marketplace payloads spell the fields a dozen ways).
const toShip = (o: OrderRow): ShipAddress => {
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
// Scanned parcels go to WORKING: once the scan service has scanned the label and it's been
// combined with the design, the item is production work with its tasks checked. "printed"
// sits between the two in the pipeline but describes the label step, which by this point
// has already happened.
const NEXT = "working"

// History = every order that ever had a label, and WHAT BECAME OF IT — so a label pulled
// off the board isn't lost track of. `disposition` reads current state into one outcome.
type DispKey = "scanned" | "shipped" | "awaiting" | "production" | "removed" | "cancelled"
function disposition(o: OrderRow): { key: DispKey; label: string } {
  const fs = normalizeStage(o.factory_status)
  if (fs === "cancelled" || fs === "refunded") return { key: "cancelled", label: fs === "refunded" ? "Refunded" : "Cancelled" }
  if (fs === "shipped") return { key: "shipped", label: "Shipped" }
  if (o.label_scanned_at) return { key: "scanned", label: "Scanned" }
  if (fs === "awaiting_scan") return { key: "awaiting", label: "Awaiting scan" }
  if (fs === "working" || fs === "printed") return { key: "production", label: "In production" }
  return { key: "removed", label: "Off the board" }   // has a label but sits before the board
}
// A small status DOT, not a colour-filled pill — the disposition sits next to a calm mono
// timeline, so the outcome is carried by a quiet coloured dot + neutral label rather than a
// second loud badge. Green = done, violet = in production, amber = stuck, red = cancelled.
const DISP_DOT: Record<DispKey, string> = {
  scanned: "bg-emerald-500",
  shipped: "bg-emerald-500",
  awaiting: "bg-muted-foreground/40",
  production: "bg-violet-500",
  removed: "bg-amber-500",
  cancelled: "bg-red-500",
}
// The per-label timeline shows DISPATCH actions only — scans, hand-offs to byeastside,
// pull-backs, label prints/voids, manifests. Order-level noise (order saved/updated, design
// files, charges) belongs on the order page, not the scan floor.
const DISPATCH_ACTIONS = /^order\.scan|^dispatch\.|^label\.|^order\.manifested|^order\.(shipped|tracking)/
const HIST_FILTERS: { key: "all" | DispKey; label: string }[] = [
  { key: "all", label: "All" }, { key: "scanned", label: "Scanned" }, { key: "awaiting", label: "Awaiting" },
  { key: "production", label: "In production" }, { key: "shipped", label: "Shipped" },
  { key: "removed", label: "Off board" }, { key: "cancelled", label: "Cancelled" },
]

export function DispatchBoard() {
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
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState("")
  // Two views of the same board: what's waiting to go out, and what already went. The
  // second is a read-only history — "did this order actually get scanned?" was a question
  // that could only be answered by leaving for the Shipments page, so the floor now has it
  // where the scan happens.
  const [view, setView] = useState<"queue" | "history">("queue")
  const [histFilter, setHistFilter] = useState<"all" | DispKey>("all")
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
  // The partner scans on their own schedule, so this board goes stale on its own — an
  // order byeastside scanned five minutes ago sits here looking unscanned until someone
  // reloads. The scan sync broadcasts, so listen rather than poll.
  useEffect(() => {
    const off = ["orders", "order-scanned"].map((t) => onLive(t, load))
    return () => { for (const f of off) f() }
  }, [load])

  const queue = useMemo(() => {
    const all = (orders ?? []).filter((o) => String(o.factory_status ?? "") === STAGE)
    const term = q.trim().toLowerCase()
    const matched = term
      ? all.filter((o) => [numOf(o), customerOf(o), o.store, o.tracking].some((f) => String(f ?? "").toLowerCase().includes(term)))
      : all
    // Newest first — a just-dispatched order belongs at the top of the queue, not wherever
    // the server happened to return it.
    return [...matched].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
  }, [orders, q])

  // History — EVERY order that ever had a label (bought → has tracking, or scanned),
  // whatever became of it. A label pulled off the board still shows here with its outcome,
  // so nothing vanishes. Searchable, and filterable by disposition.
  const history = useMemo(() => {
    const all = (orders ?? []).filter((o) => o.tracking || o.label_scanned_at)
    const term = q.trim().toLowerCase()
    let list = term
      ? all.filter((o) => [numOf(o), customerOf(o), o.store, o.tracking].some((f) => String(f ?? "").toLowerCase().includes(term)))
      : all
    if (histFilter !== "all") list = list.filter((o) => disposition(o).key === histFilter)
    // Most recent activity first — the scan time if there is one, else when it was created.
    return [...list].sort((a, b) => String(b.label_scanned_at || b.created_at || "").localeCompare(String(a.label_scanned_at || a.created_at || "")))
  }, [orders, q, histFilter])

  // A label is what makes an order dispatchable. Without one there is nothing to scan, so
  // these are surfaced separately rather than silently included in a batch.
  const withLabel = queue.filter((o) => !!o.tracking)
  const noLabel = queue.filter((o) => !o.tracking)

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
  const toggleAll = () =>
    setPicked((p) => (p.size === withLabel.length ? new Set() : new Set(withLabel.map((o) => o.id))))

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
    if (!chosenWithLabel.length) return
    setBusy(true); setErr(null)
    try {
      const r = await pushToDispatch(chosenWithLabel.map((o) => o.id))
      if (r.error) throw new Error(r.error)
      const failed = (r.results ?? []).filter((x) => !x.ok)
      setErr(failed.length
        // Their words: byeastside don't document error codes, so what they sent back is
        // the only thing that helps.
        ? `${r.pushed ?? 0} sent · ${failed.length} failed — ${failed[0].error ?? "unknown error"}`
        : null)
      setPicked(new Set())
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send those to byeastside.")
    } finally { setBusy(false) }
  }

  /**
   * Take orders back off the dispatch board.
   *
   * They return to in_review — the stage they were staged FROM — rather than being
   * cancelled or shipped: coming off this board means "not being scanned right now",
   * which is a scheduling decision, not a claim about the work or the money.
   *
   * This existed nowhere. An order with no label couldn't even be selected, so an order
   * staged here by mistake had nothing that could touch it and simply sat.
   */
  const removeFromBoard = async (ids: string[]) => {
    if (!ids.length) return
    setBusy(true); setErr(null)
    const failed: string[] = []
    for (const id of ids) {
      try { await updateOrder(id, { factoryStatus: "in_review" }) } catch { failed.push(id) }
    }
    setBusy(false)
    setPicked(new Set())
    if (failed.length) setErr(`Couldn't remove ${failed.length} order${failed.length === 1 ? "" : "s"} — your role may not be able to move them back.`)
    load()
  }

  const markScanned = async () => {
    if (!chosen.length) return
    setBusy(true); setErr(null)
    const failed: string[] = []
    // The pipeline is awaiting_scan → printed → working, so a scan advances TWO stages.
    // The server refuses a two-stage jump one hop at a time (skip guard), so record each
    // stage on the way — "printed" is the label-paperwork step, done by the time a parcel
    // is scanned. Falls back to a single move if the pipeline ever makes them adjacent.
    const path = stagePath(STAGE, NEXT) ?? [NEXT]
    for (const o of chosen) {
      try {
        // RECORD THE SCAN ITSELF, not just the stage move. These are two different facts
        // and only one of them was being written: label_scanned_at means "the buyer's
        // tracking is live", while factory_status means "where the work has got to". The
        // stage was advancing and the scan was never recorded, so the readiness pill —
        // which reads label_scanned_at, correctly — stayed dark on orders the floor had
        // just scanned.
        //
        // Best-effort: an order whose scan won't record must still advance, because the
        // parcel has physically been scanned either way.
        await markScannedInHouse(o.id).catch(() => {})
        // Walk the stages in order: every item to "printed", then every item to "working".
        // Each hop is validated against the item's CURRENT stage, so the second hop only
        // passes because the first already moved it — teleporting straight to working 403s.
        for (const stage of path) {
          for (const it of o.items ?? []) {
            if (it.sku || it.line_id) await postItemStatus(o.id, it.sku ?? "", stage, it.line_id)
          }
        }
        await updateOrder(o.id, { factoryStatus: NEXT })
      } catch { failed.push(numOf(o)) }
    }
    setBusy(false)
    setPicked(new Set())
    if (failed.length) setErr(`Couldn't advance ${failed.length} order${failed.length === 1 ? "" : "s"}: ${failed.join(", ")}`)
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
    if (!chosen.length) return
    setBusy(true); setErr(null)
    try {
      const r = await cancelDispatch(chosen.map((o) => o.id))
      if (r.error) throw new Error(r.error)
      const results = r.results ?? []
      const scanned = results.filter((x) => !x.ok && x.reason === "already-scanned").length
      const other = results.filter((x) => !x.ok && x.reason !== "already-scanned")
      const parts: string[] = []
      if (r.cancelled) parts.push(`Pulled ${r.cancelled} back`)
      if (scanned) parts.push(`${scanned} already picked and can't be recalled`)
      if (other.length) parts.push(`${other.length} failed (${other[0].reason})`)
      setErr(parts.length ? parts.join(" · ") : "Nothing to pull back.")
      // Keep the successfully pulled-back orders SELECTED — they stay on the board
      // (still awaiting_scan) and the usual next move is to scan them in-house right away,
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
  const printPackingSlips = () => {
    if (!chosen.length) return
    const esc = (v: unknown) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))
    const slips = chosen.map((o) => {
      const its = o.items ?? []
      const rows = its.length
        ? its.map((it) => `<tr><td>${esc(it.name || it.sku || "Item")}${it.sku && it.name ? `<div class="sku mono">${esc(it.sku)}</div>` : ""}</td><td class="qty">&times;${esc(it.qty ?? 1)}</td></tr>`).join("")
        : `<tr><td colspan="2" class="empty">No items recorded on this order</td></tr>`
      return `<section class="slip">
        <div class="hd"><div class="num mono">${esc(numOf(o))}</div><div class="plat">${esc(platformOf(o))}${o.store ? " &middot; " + esc(o.store) : ""}</div></div>
        <div class="cust">${esc(customerOf(o))}</div>
        ${addrLine(o) ? `<div class="addr">${esc(addrLine(o))}</div>` : ""}
        <table><tbody>${rows}</tbody></table>
        <div class="ft">${esc(unitsOf(o))} unit${unitsOf(o) === 1 ? "" : "s"}${o.tracking ? ` &middot; <span class="mono">${esc(o.tracking)}</span>` : ""}</div>
      </section>`
    }).join("")
    const w = window.open("", "_blank")
    if (!w) { setErr("Your popup blocker stopped the packing slips — allow popups for this site."); return }
    w.document.write(`<!doctype html><html><head><title>Packing slips</title><style>
      *{box-sizing:border-box}
      body{font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:0}
      .slip{width:4in;min-height:6in;padding:.25in;page-break-after:always;display:flex;flex-direction:column}
      .hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px;border-bottom:2px solid #111;padding-bottom:6px}
      .num{font-size:17px;font-weight:700}
      .plat{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.05em;text-align:right}
      .cust{font-size:14px;font-weight:600;margin-top:8px}
      .addr{font-size:11px;color:#555}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      td{padding:5px 2px;border-bottom:1px solid #eee;vertical-align:top;font-size:12px}
      .sku{font-size:10px;color:#666;margin-top:1px}
      .qty{text-align:right;font-weight:700;width:2.6rem;white-space:nowrap}
      .empty{color:#999;text-align:center}
      .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
      .ft{margin-top:auto;padding-top:8px;border-top:1px solid #ddd;font-size:9px;color:#888}
      @page{size:4in 6in;margin:0}
    </style></head><body>${slips}</body></html>`)
    w.document.close()
    w.focus()
    w.print()
  }

  // awaiting_scan → working is TWO steps in the pipeline ("printed" sits between), so it's a
  // skip, and stageDenial refuses a skip for EVERYONE — which greyed "Scanned here" out for
  // every role, always, however an order was selected. The scan doesn't teleport past
  // printed; it WALKS it (markScanned below), so the gate is "can this role walk there" —
  // true for warehouse/admin, still false for an operator whose zone ends at the scan.
  const canAdvance = canSetStage(role, STAGE, NEXT) || canWalk(role, STAGE, NEXT)
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
        <StatCard label="Ready to dispatch" value={String(withLabel.length)} sub="labelled, waiting to scan" tone="pos" />
        <StatCard label="Missing a label" value={String(noLabel.length)} sub="can&apos;t go out yet" tone="neg" />
      </StatGrid>

      <SectionCard
        title="Dispatch"
        description={canScanOut
          ? "Labelled and waiting to be scanned. Print the batch, scan it, then move it into production."
          : "Labelled and waiting to be scanned. You can print and pull labels back; warehouse and admin scan the batch out."}
        actions={view === "history" ? undefined : (
          <div className="flex flex-wrap items-center gap-2">
            {/* PRINT / documents — grouped: manifest, labels, and (when scanning out) the
                USPS SCAN form. All are "produce a document" actions, none touch the scan. */}
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <Printer size={14} weight="bold" /> Print <CaretDown size={12} weight="bold" className="text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52 p-1">
                <DropdownMenuItem disabled={!chosen.length} onClick={printPackingSlips}>
                  <Package size={14} weight="bold" /> Print packing slips
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!chosen.length} onClick={printManifest}>
                  <ListChecks size={14} weight="bold" /> Print manifest
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!chosenWithLabel.length} onClick={openLabels}>
                  <Printer size={14} weight="bold" /> Open labels
                </DropdownMenuItem>
                {canScanOut && (
                  <DropdownMenuItem disabled={!manifestable.length || busy} onClick={() => setManifestOpen(true)} title={manifestTooltip(chosen)}>
                    <Barcode size={14} weight="bold" /> Create SCAN form
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* PULL BACK / undo — grouped: take orders off the board, or cancel the batch at
                the partner. Both are "walk it back", kept out of the primary row. */}
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <ArrowUUpLeft size={14} weight="bold" /> Pull back <CaretDown size={12} weight="bold" className="text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 p-1">
                <DropdownMenuItem disabled={!chosen.length || busy} onClick={() => removeFromBoard(chosen.map((o) => o.id))} title="Send these back to review — off the board without being scanned">
                  <X size={14} weight="bold" /> Remove from board
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!chosen.length || busy} onClick={pullBack}>
                  <ArrowUUpLeft size={14} weight="bold" /> Cancel with byeastside
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* THE TWO ROUTES kept prominent — this is where the choice is made. Both start
                the buyer's tracking clock; they differ in who does it and what it costs. */}
            {dispatchOn && (
              <Button size="sm" variant="outline" disabled={!chosenWithLabel.length || busy} onClick={sendToPartner}
                title="Upload these labels to byeastside's pre-scan queue — charges the expedite fee per label">
                {busy ? <CircleNotch size={14} className="animate-spin" /> : <><TrayArrowDown size={14} weight="bold" /> Send to byeastside</>}
              </Button>
            )}
            {canScanOut && (
              <Button size="sm" disabled={!chosen.length || busy || !canAdvance} onClick={markScanned} title={canAdvance ? undefined : "Your role can't move orders past this stage"}>
                {busy ? <CircleNotch size={14} className="animate-spin" /> : <><CheckCircle size={14} weight="bold" /> Scanned here</>}
              </Button>
            )}
          </div>
        )}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          {/* Awaiting-scan vs. scanned history. Kept as a segmented toggle rather than a
              second page so the search box and stat cards above stay put. */}
          <div className="inline-flex shrink-0 rounded-lg border border-border p-0.5 text-sm">
            <button
              onClick={() => setView("queue")}
              className={"rounded-md px-3 py-1 font-medium transition-colors " + (view === "queue" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              Awaiting scan
            </button>
            <button
              onClick={() => setView("history")}
              className={"rounded-md px-3 py-1 font-medium transition-colors " + (view === "history" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              History{history.length ? ` · ${history.length}` : ""}
            </button>
          </div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, customer or tracking…" className="h-9 max-w-xs" />
          {view === "history" && (
            <div className="flex flex-wrap items-center gap-1">
              {HIST_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setHistFilter(f.key)}
                  className={"rounded-md px-2 py-1 text-xs font-medium transition-colors " + (histFilter === f.key ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {view === "queue" && chosen.length > 0 && <span className="text-xs text-muted-foreground">{chosen.length} in this batch</span>}
          {view === "queue" && (
            <Button size="sm" variant="outline" disabled={!withLabel.length} onClick={toggleAll}>
              {picked.size === withLabel.length && withLabel.length ? "Clear selection" : `Select all ${withLabel.length}`}
            </Button>
          )}
        </div>

        {err && (
          <div className="mx-5 mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err}
          </div>
        )}

        {view === "history" ? (
          history.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <ListChecks size={26} weight="duotone" className="opacity-50" />
              <div className="text-sm font-medium text-foreground">{q || histFilter !== "all" ? "Nothing matches" : "No label activity yet"}</div>
              <div className="text-xs">Every label and what became of it — scanned, shipped, pulled off the board — shows here.</div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {history.map((o) => {
                const d = disposition(o)
                const via = (o as { scanned_via?: string | null }).scanned_via
                const when = o.label_scanned_at
                  ? new Date(o.label_scanned_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
                  : ""
                const open = expanded.has(o.id)
                const events = auditByOrder[o.id]
                return (
                  <div key={o.id}>
                    {/* Row toggles the action timeline. Click the label-link separately. */}
                    <div onClick={() => toggleTimeline(o.id)} className="flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/40">
                      <CaretRight size={13} weight="bold" className={"shrink-0 text-muted-foreground transition-transform " + (open ? "rotate-90" : "")} />
                      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                        <span className={"size-1.5 rounded-full " + DISP_DOT[d.key]} />
                        {d.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{numOf(o)}</span>
                          <span className="truncate text-sm">{customerOf(o)}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                            {platformOf(o)}{o.store && o.store.toLowerCase() !== platformOf(o).toLowerCase() ? ` · ${o.store}` : ""}
                          </span>
                          {when
                            ? <span>Scanned {when}{via ? ` · ${via === "byeastside" ? "byeastside" : "in-house"}` : ""}</span>
                            : <span>Labelled{o.created_at ? " " + new Date(o.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : ""}</span>}
                        </div>
                      </div>
                      {o.tracking && (
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{o.tracking}</span>
                      )}
                      {o.tracking_label_url && (
                        <a
                          href={o.tracking_label_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          className="eg-tap shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label={`Open label for ${numOf(o)}`}
                        >
                          <ArrowSquareOut size={13} weight="bold" />
                        </a>
                      )}
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
                            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><CircleNotch size={14} className="animate-spin" /> Loading dispatch history…</div>
                          ) : !evs || evs.length === 0 ? (
                            <div className="py-2 text-sm text-muted-foreground">No dispatch actions recorded for this label yet.</div>
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
          )
        ) : queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <Truck size={26} weight="duotone" className="opacity-50" />
            <div className="text-sm font-medium text-foreground">Nothing waiting to go out</div>
            <div className="text-xs">Orders appear here once production marks them awaiting scan.</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Newest first (queue is already sorted by created/scan time), NOT grouped by
                label — a just-dispatched order should stay on top, not sink below older
                labelled ones. Whether it has a label yet is shown by a per-row tag, not by
                dimming the whole row (which read as "cancelled"). */}
            {queue.map((o) => {
              return (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/40"
                >
                  {/* Selectable whether or not it has a label. Only the label-dependent
                      ACTIONS need one; tying the checkbox itself to a label left an
                      unlabelled order impossible to select and therefore impossible to
                      remove — stuck on the board with nothing that could touch it. */}
                  <input
                    type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)}
                    className="size-4 shrink-0 accent-primary" aria-label={`Select ${numOf(o)}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{numOf(o)}</span>
                      <span className="truncate text-sm">{customerOf(o)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                        {platformOf(o)}{o.store && o.store.toLowerCase() !== platformOf(o).toLowerCase() ? ` · ${o.store}` : ""}
                      </span>
                      <span>{unitsOf(o)} unit{unitsOf(o) === 1 ? "" : "s"}</span>
                      {addrLine(o) && <span className="truncate">{addrLine(o)}</span>}
                      {/* The label's OWN status here — not the production readiness pills, which
                          belong on the make boards. "Sent to partner" is the byeastside hand-off
                          (pushed but not scanned back yet), so it's visible whether a parcel is
                          out for external scan or still waiting here. */}
                      {(() => {
                        const d = disposition(o)
                        const sentOut = !o.label_scanned_at && !!o.dispatch_pdf_id
                        const label = sentOut ? "Sent to partner" : d.label
                        const dot = sentOut ? "bg-amber-500" : DISP_DOT[d.key]
                        return (
                          <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                            <span className={"size-1.5 rounded-full " + dot} /> {label}
                          </span>
                        )
                      })()}
                    </div>
                  </div>
                  {o.tracking ? (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{o.tracking}</span>
                  ) : (
                    // No label yet → give the action right here rather than a dead gap. Buys
                    // the label for this order (stopPropagation: the row is a <label>).
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLabelFor(o) }}
                      className="eg-tap shrink-0 inline-flex items-center gap-1 rounded-lg border border-primary/40 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      <Tag size={12} weight="bold" /> Create label
                    </button>
                  )}
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
                  {/* Per-row remove as well as the bulk one: a single order staged by
                      mistake shouldn't need a selection first, and this row is exactly
                      where someone notices it doesn't belong. stopPropagation because the
                      row is a <label> — without it, clicking this toggles the checkbox. */}
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void removeFromBoard([o.id]) }}
                    disabled={busy}
                    className="eg-tap shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove ${numOf(o)} from the dispatch board`}
                    title="Remove from board — sends it back to review, unscanned"
                  >
                    <X size={13} weight="bold" />
                  </button>
                </label>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Keyed on the selection so reopening after a different pick can't show the
          previous batch's preview for a frame. */}
      <ManifestDialog
        key={manifestable.map((o) => o.id).join(",")}
        orderIds={manifestable.map((o) => o.id)}
        open={manifestOpen}
        onOpenChange={setManifestOpen}
        onDone={() => { setPicked(new Set()); load() }}
      />

      {/* Buy a label for a queue order that arrived without one — opened from the row's
          "Create label" button, seeded with that order's ship-to. */}
      <NewLabelDialog
        open={!!labelFor}
        onOpenChange={(v) => { if (!v) setLabelFor(null) }}
        onCreated={() => { setLabelFor(null); load() }}
        order={labelFor ? { id: String(labelFor.id), num: numOf(labelFor), to: toShip(labelFor) } : undefined}
      />
    </div>
  )
}
