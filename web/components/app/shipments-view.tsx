"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { MagnifyingGlass, CircleNotch, ArrowSquareOut, Package, ArrowClockwise, DownloadSimple, X, Plus, Truck } from "@phosphor-icons/react"
import { NewLabelDialog } from "@/components/app/new-label-dialog"
import { RateCheckerDialog } from "@/components/app/rate-checker-dialog"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getShipments, refreshTracking, voidLabel, type ShipmentRow } from "@/lib/api"
import { onLive } from "@/lib/live"
import { getUser } from "@/lib/auth"

/**
 * Every parcel that has a tracking number, searchable, with its label.
 *
 * This is the LOOKUP surface, deliberately separate from the dispatch board. The board is
 * a work queue — what's left to scan today, changing hourly, read by the floor. This is an
 * archive: it answers "where is this one" and "give me that label again", and the person
 * asking is usually on the phone to a buyer holding nothing but a tracking number. Those
 * are different jobs at different tempos, and folding the archive into the queue would put
 * a growing list nobody is working through underneath the short list they are.
 *
 * Search covers tracking, order number, customer and carrier — all four are things someone
 * arrives holding, and which one they have is not something they chose.
 */

/** What the CARRIER says. Kept visually distinct from the factory stage, because the whole
 *  reason to open this page is usually that the two disagree. */
const DELIVERY: Record<string, { label: string; cls: string }> = {
  awaiting_pickup: { label: "Not collected", cls: "bg-amber-100 text-amber-800" },
  in_transit: { label: "In transit", cls: "bg-sky-100 text-sky-700" },
  delivered: { label: "Delivered", cls: "bg-emerald-100 text-emerald-700" },
  returned: { label: "Returning", cls: "bg-rose-100 text-rose-700" },
  failed: { label: "Failed", cls: "bg-rose-100 text-rose-700" },
}

const when = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null

/** Who recorded the scan. Worth naming rather than a bare tick: the three routes carry
 *  different weight, and only one of them is the carrier's own word. */
const VIA: Record<string, string> = {
  "in-house": "scanned here",
  partner: "scanned by byeastside",
  carrier: "accepted by the carrier",
}

export function ShipmentsView() {
  const [rows, setRows] = useState<ShipmentRow[] | null>(null)
  const [spend, setSpend] = useState(0)
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const role = getUser()?.role ?? ""

  const load = useCallback((search?: string) => {
    if (!getUser()) { setRows([]); return }
    setBusy(true)
    getShipments({ search: search?.trim() || undefined, limit: 300 })
      .then((r) => { setRows(r.shipments ?? []); setSpend(r.labelSpend ?? 0); setErr(null) })
      .catch((e: Error) => { setErr(e.message); setRows([]) })
      .finally(() => setBusy(false))
  }, [])

  // Client-side CSV of what's on screen — reconciles against the label-cost ledger in Billing.
  const exportCsv = () => {
    const r = rows ?? []
    if (!r.length) return
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const head = ["Order", "Customer", "State", "Tracking", "Carrier", "Method", "Price", "Stage", "Delivery", "Scanned at"]
    const lines = [head.join(","), ...r.map((s) => [s.num, s.customer, s.state, s.tracking, s.carrier, s.method, s.price != null ? s.price.toFixed(2) : "", s.stage, s.delivery, s.scannedAt].map(esc).join(","))]
    const blob = new Blob([lines.join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `shipments-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => { const t = setTimeout(() => load(), 0); return () => clearTimeout(t) }, [load])
  // The search runs on the SERVER, so it reaches past the 300 rows loaded here. Debounced
  // rather than per-keystroke: a tracking number is 22 characters and nobody wants 22
  // queries for it.
  useEffect(() => {
    const t = setTimeout(() => load(q), 300)
    return () => clearTimeout(t)
  }, [q, load])
  useEffect(() => onLive("orders", () => load(q)), [load, q])

  /** Ask the carrier again, for one parcel. The page otherwise shows whatever the last
   *  webhook or poll recorded, which can be hours old on a quiet parcel. */
  const recheck = async (id: string) => {
    setChecking(id)
    try { await refreshTracking(id); load(q) }
    catch (e) { setErr((e as Error).message) }
    finally { setChecking(null) }
  }

  // Void a label: refund the postage with the carrier + credit the cost back in the ledger
  // (so it shows in Billing). Warehouse/admin only — the server enforces it too.
  const [voiding, setVoiding] = useState<string | null>(null)
  const [newLabelOpen, setNewLabelOpen] = useState(false)
  const [rateCheckOpen, setRateCheckOpen] = useState(false)
  const canVoid = role === "warehouse" || role === "admin"
  const doVoid = async (s: ShipmentRow) => {
    if (!window.confirm(`Void the label for ${s.num}? This refunds the postage with the carrier and credits it back.`)) return
    setVoiding(s.id)
    try {
      const r = await voidLabel(s.id)
      if (r.ok) { setErr(`Label voided${r.refunded ? ` — $${r.refunded.toFixed(2)} credited back` : ""}.`); load(q) }
      else setErr(r.error || "Void failed.")
    } catch (e) { setErr((e as Error).message) }
    finally { setVoiding(null) }
  }

  const counts = useMemo(() => {
    const r = rows ?? []
    return {
      total: r.length,
      moving: r.filter((x) => x.delivery === "in_transit").length,
      stuck: r.filter((x) => x.delivery === "awaiting_pickup").length,
      problem: r.filter((x) => x.delivery === "returned" || x.delivery === "failed").length,
    }
  }, [rows])

  return (
    <>
    <SectionCard
      title="Shipments"
      description="Every parcel with a tracking number. Search by tracking, order, customer or carrier."
      actions={
        <div className="flex items-center gap-3">
          {busy && <CircleNotch size={14} className="animate-spin text-muted-foreground" />}
          <span className="text-xs text-muted-foreground">
            {err ? "count unknown" : `${counts.total} shown`}
            {/* Only surfaced when non-zero. A row of zeroes reads as a dashboard; these are
                here to be acted on, and "0 need attention" is noise. */}
            {counts.stuck > 0 && ` · ${counts.stuck} not collected`}
            {counts.problem > 0 && ` · ${counts.problem} need attention`}
          </span>
          {spend > 0 && (
            <span className="text-xs"><span className="text-muted-foreground">Label spend </span><span className="font-semibold tabular-nums">${spend.toFixed(2)}</span></span>
          )}
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows || rows.length === 0}>
            <DownloadSimple size={14} weight="bold" /> Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRateCheckOpen(true)}>
            <Truck size={14} weight="bold" /> Rate check
          </Button>
          {canVoid && (
            <Button size="sm" onClick={() => setNewLabelOpen(true)}>
              <Plus size={14} weight="bold" /> New label
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <div className="relative">
          <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tracking, order, customer or carrier…"
            className="h-9 w-80 pl-8"
          />
        </div>
        {q && <Button size="sm" variant="ghost" onClick={() => setQ("")}>Clear</Button>}
      </div>

      {err && (
        <div className="mx-5 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{err}</div>
      )}

      {rows === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <CircleNotch size={16} className="animate-spin" /> Loading shipments…
        </div>
      ) : rows.length === 0 ? (
        // THREE different nothings, and they must not look alike: the read failed, the
        // search matched nothing, or there genuinely are no parcels. The failure case was
        // printing "No parcel has a tracking number yet" underneath its own error banner —
        // asserting a fact about the data while saying we couldn't read the data.
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
          <Package size={26} weight="duotone" className="opacity-50" />
          <p className="text-sm">
            {err
              ? "Couldn't read shipments, so this list isn't empty — it's unknown."
              : q ? `Nothing matches “${q}”.`
                : "No parcel has a tracking number yet."}
          </p>
          {err
            ? <Button size="sm" variant="outline" onClick={() => load(q)}>Try again</Button>
            : q ? <Button size="sm" variant="outline" onClick={() => setQ("")}>Show all</Button>
              : null}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-2 font-medium">Order</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Tracking</th>
                <th className="px-3 py-2 font-medium">Method</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 font-medium">Carrier says</th>
                <th className="px-3 py-2 font-medium">Scan</th>
                <th className="px-3 py-2 text-right font-medium">Label</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const d = s.delivery ? DELIVERY[s.delivery] : null
                return (
                  <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                    <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs">{s.num}</td>
                    <td className="px-3 py-2.5">
                      <div className="max-w-[14rem] truncate">{s.customer ?? "—"}</div>
                      {s.state && <div className="text-[11px] text-muted-foreground">{s.state}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-xs">{s.tracking}</div>
                      {s.carrier && <div className="text-[11px] text-muted-foreground">{s.carrier}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{s.method || <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums">{s.price != null ? `$${s.price.toFixed(2)}` : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2.5">
                      {d ? (
                        <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + d.cls}>{d.label}</span>
                      ) : (
                        // Never blank. "Not checked" and "checked, nothing yet" are
                        // different facts and the difference decides whether to chase.
                        <span className="text-[11px] text-muted-foreground">Not checked</span>
                      )}
                      {s.deliveryCheckedAt && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{when(s.deliveryCheckedAt)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {s.scannedAt ? (
                        <>
                          <div className="text-[11px]">{when(s.scannedAt)}</div>
                          <div className="text-[11px] text-muted-foreground">{VIA[s.scannedVia ?? ""] ?? "scanned"}</div>
                        </>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Not scanned</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        {/* Re-asking the carrier costs an API call and can move money
                            nowhere, so it's open to any staffer — unlike anything that
                            asserts a scan. */}
                        <button
                          onClick={() => recheck(s.id)}
                          disabled={checking === s.id}
                          className="eg-tap rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                          title="Ask the carrier for the latest status"
                          aria-label={`Re-check tracking for ${s.num}`}
                        >
                          {checking === s.id
                            ? <CircleNotch size={13} className="animate-spin" />
                            : <ArrowClockwise size={13} weight="bold" />}
                        </button>
                        {s.labelUrl ? (
                          <a
                            href={s.labelUrl} target="_blank" rel="noopener noreferrer"
                            className="eg-tap rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            title="Open the label PDF"
                            aria-label={`Open label for ${s.num}`}
                          >
                            <ArrowSquareOut size={13} weight="bold" />
                          </a>
                        ) : (
                          // The label was bought but its file wasn't stored — which is a
                          // real gap on older orders, not "no label". Saying so stops
                          // someone hunting for a button that was never going to be there.
                          <span className="px-1.5 text-[11px] text-muted-foreground" title="This label predates storing the PDF">
                            not stored
                          </span>
                        )}
                        {canVoid && s.labelUrl && (
                          <button
                            onClick={() => doVoid(s)}
                            disabled={voiding === s.id}
                            className="eg-tap rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                            title="Void label — refunds the postage with the carrier"
                            aria-label={`Void label for ${s.num}`}
                          >
                            {voiding === s.id ? <CircleNotch size={13} className="animate-spin" /> : <X size={13} weight="bold" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length >= 300 && (
        // Never silently truncate. Search reaches the whole table server-side, so the fix
        // is to search — but only if you know you're looking at a window.
        <div className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
          Showing the 300 most recent. Search to reach older parcels — it queries all of them, not just these.
        </div>
      )}
      {role === "operator" && (
        <div className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
          Read-only for operators: re-checking a carrier status is fine, but nothing here changes a scan.
        </div>
      )}
    </SectionCard>
    <NewLabelDialog open={newLabelOpen} onOpenChange={setNewLabelOpen} onCreated={() => load(q)} />
    <RateCheckerDialog open={rateCheckOpen} onOpenChange={setRateCheckOpen} />
    </>
  )
}
