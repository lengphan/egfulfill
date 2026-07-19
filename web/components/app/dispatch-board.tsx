"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Truck, CircleNotch, Printer, CheckCircle, Warning, ArrowSquareOut, ListChecks } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getOrders, postItemStatus, updateOrder, markLabelPrinted, type OrderRow } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { numOf, platformOf, customerOf, unitsOf, addrLine } from "@/lib/order-format"
import { canSetStage } from "@/lib/factory-status"
import { ReadinessStrip } from "@/components/app/readiness-dots"

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
// Scanned parcels go to WORKING: once the scan service has scanned the label and it's been
// combined with the design, the item is production work with its tasks checked. "printed"
// sits between the two in the pipeline but describes the label step, which by this point
// has already happened.
const NEXT = "working"

export function DispatchBoard() {
  const role = getUser()?.role || ""
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState("")

  const load = useCallback(() => {
    if (!getUser()) { setOrders([]); return }
    getOrders().then((r) => setOrders(r ?? [])).catch(() => setOrders([]))
  }, [])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  const queue = useMemo(() => {
    const all = (orders ?? []).filter((o) => String(o.factory_status ?? "") === STAGE)
    const term = q.trim().toLowerCase()
    if (!term) return all
    return all.filter((o) =>
      [numOf(o), customerOf(o), o.store, o.tracking].some((f) => String(f ?? "").toLowerCase().includes(term)))
  }, [orders, q])

  // A label is what makes an order dispatchable. Without one there is nothing to scan, so
  // these are surfaced separately rather than silently included in a batch.
  const withLabel = queue.filter((o) => !!o.tracking)
  const noLabel = queue.filter((o) => !o.tracking)

  const chosen = queue.filter((o) => picked.has(o.id))
  const chosenWithLabel = chosen.filter((o) => !!o.tracking)

  const toggle = (id: string) =>
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleAll = () =>
    setPicked((p) => (p.size === withLabel.length ? new Set() : new Set(withLabel.map((o) => o.id))))

  /** Advance a whole batch once it's been scanned. Per-order so one failure can't strand the rest. */
  const markScanned = async () => {
    if (!chosen.length) return
    setBusy(true); setErr(null)
    const failed: string[] = []
    for (const o of chosen) {
      try {
        for (const it of o.items ?? []) {
          if (it.sku || it.line_id) await postItemStatus(o.id, it.sku ?? "", NEXT, it.line_id)
        }
        await updateOrder(o.id, { factoryStatus: NEXT })
      } catch { failed.push(numOf(o)) }
    }
    setBusy(false)
    setPicked(new Set())
    if (failed.length) setErr(`Couldn't advance ${failed.length} order${failed.length === 1 ? "" : "s"}: ${failed.join(", ")}`)
    load()
  }

  /** Open each label for printing. Popup blockers stop the second window onward, so say so. */
  const openLabels = () => {
    const urls = chosenWithLabel.map((o) => o.tracking_label_url).filter(Boolean) as string[]
    if (!urls.length) { setErr("None of the selected orders have a stored label file."); return }
    let blocked = 0
    for (const o of chosenWithLabel) {
      if (!o.tracking_label_url) continue
      if (window.open(o.tracking_label_url, "_blank", "noopener")) {
        // Stamp it as printed here rather than asking anyone to tick a box — opening the
        // label for print IS the event, and a box nobody ticks makes the dot lie.
        markLabelPrinted(o.id).catch(() => {})
      } else blocked++
    }
    if (blocked) setErr(`${blocked} label${blocked === 1 ? "" : "s"} were blocked by your popup blocker — allow popups for this site to print a whole batch at once.`)
    else load()   // refresh so the Printed dots fill in
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

  const canAdvance = canSetStage(role, STAGE, NEXT)

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
        description="Labelled and waiting to be scanned. Print the batch, scan it, then move it into production."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={!chosen.length} onClick={printManifest}>
              <ListChecks size={14} weight="bold" /> Print manifest
            </Button>
            <Button size="sm" variant="outline" disabled={!chosenWithLabel.length} onClick={openLabels}>
              <Printer size={14} weight="bold" /> Open labels
            </Button>
            <Button size="sm" disabled={!chosen.length || busy || !canAdvance} onClick={markScanned} title={canAdvance ? undefined : "Your role can't move orders past this stage"}>
              {busy ? <CircleNotch size={14} className="animate-spin" /> : <><CheckCircle size={14} weight="bold" /> Mark scanned</>}
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, customer or tracking…" className="h-9 max-w-xs" />
          {chosen.length > 0 && <span className="text-xs text-muted-foreground">{chosen.length} in this batch</span>}
          <Button size="sm" variant="outline" disabled={!withLabel.length} onClick={toggleAll}>
            {picked.size === withLabel.length && withLabel.length ? "Clear selection" : `Select all ${withLabel.length}`}
          </Button>
        </div>

        {err && (
          <div className="mx-5 mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err}
          </div>
        )}

        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <Truck size={26} weight="duotone" className="opacity-50" />
            <div className="text-sm font-medium text-foreground">Nothing waiting to go out</div>
            <div className="text-xs">Orders appear here once production marks them awaiting scan.</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {[...withLabel, ...noLabel].map((o) => {
              const ready = !!o.tracking
              return (
                <label
                  key={o.id}
                  className={"flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/40 " + (ready ? "" : "opacity-70")}
                >
                  <input
                    type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)}
                    className="size-4 shrink-0 accent-primary" aria-label={`Select ${numOf(o)}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{numOf(o)}</span>
                      <span className="truncate text-sm">{customerOf(o)}</span>
                      {!ready && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">No label yet</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                        {platformOf(o)}{o.store && o.store.toLowerCase() !== platformOf(o).toLowerCase() ? ` · ${o.store}` : ""}
                      </span>
                      <span>{unitsOf(o)} unit{unitsOf(o) === 1 ? "" : "s"}</span>
                      {addrLine(o) && <span className="truncate">{addrLine(o)}</span>}
                      <ReadinessStrip order={o} />
                    </div>
                  </div>
                  {o.tracking && (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{o.tracking}</span>
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
                </label>
              )
            })}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
