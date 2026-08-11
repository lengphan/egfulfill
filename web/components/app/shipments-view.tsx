"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { MagnifyingGlass, CircleNotch, ArrowSquareOut, Package, ArrowClockwise, DownloadSimple, X, Plus, Truck } from "@phosphor-icons/react"
import { NewLabelDialog } from "@/components/app/new-label-dialog"
import { RateCheckerDialog } from "@/components/app/rate-checker-dialog"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getShipments, refreshTracking, voidLabel, type ShipmentRow } from "@/lib/api"
import { onLive } from "@/lib/live"
import { getUser } from "@/lib/auth"
import { useConfirm } from "@/components/app/confirm-dialog"

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

/**
 * The status filter, as the questions someone actually arrives with.
 *
 * Not one pill per DELIVERY key: "Returning" and "Failed" are the same job (a parcel that
 * needs a human) and splitting them makes you check two pills to ask one question. And
 * "Not checked" is a pill in its own right because a null delivery is NOT a state the
 * carrier reported — it's us never having asked, which is the difference between a quiet
 * parcel and an unmonitored one.
 *
 * Refunded is here rather than in its own control because it answers the same shape of
 * question — "which of these is in what state" — and it is the only one that is about
 * money rather than movement, which the amount column already shows.
 */
const FILTERS: { key: string; label: string; match: (s: ShipmentRow) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "in_transit", label: "In transit", match: (s) => s.delivery === "in_transit" },
  { key: "awaiting_pickup", label: "Not collected", match: (s) => s.delivery === "awaiting_pickup" },
  { key: "delivered", label: "Delivered", match: (s) => s.delivery === "delivered" },
  { key: "problem", label: "Needs a look", match: (s) => s.delivery === "returned" || s.delivery === "failed" },
  { key: "unchecked", label: "Not checked", match: (s) => !s.delivery },
  { key: "refunded", label: "Refunded", match: (s) => (s.refunded ?? 0) > 0 },
  { key: "test", label: "Test", match: (s) => s.test },
]

/**
 * Where a refund has actually got to, in our words — their word is printed beneath it.
 *
 * QUEUED and PENDING are both "asked for, not yet had": Shippo waits on carrier tracking
 * data to prove the label went unused, which takes up to 14 days. ERROR is the one that
 * matters — it means the carrier found the label HAD been used, so the money is not coming
 * and the parcel really shipped. Anything unrecognised is treated as pending, because
 * claiming a refund we can't confirm is the failure worth avoiding.
 */
const refundState = (s: ShipmentRow): "settled" | "pending" | "refused" => {
  const w = String(s.refundStatus || "").toUpperCase()
  if (w === "SUCCESS") return "settled"
  if (w === "ERROR") return "refused"
  return "pending"
}
const REFUND_LABEL: Record<string, string> = {
  settled: "Refunded",
  pending: "Refund pending",
  refused: "Refund refused",
}
const REFUND_TONE: Record<string, string> = {
  settled: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  refused: "bg-red-600 text-white",
}

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
  const [refunded, setRefunded] = useState(0)
  const [testSpend, setTestSpend] = useState(0)
  // All-time totals off the ledger, kept apart from `rows` on purpose: the list is capped
  // at 200 and narrowed by the search box, so summing what's on screen would quietly report
  // a different number depending on what you last typed.
  const [tally, setTally] = useState({ bought: 0, voided: 0, test: 0 })
  const [status, setStatus] = useState("all")
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const role = getUser()?.role ?? ""

  const load = useCallback((search?: string) => {
    if (!getUser()) { setRows([]); return }
    setBusy(true)
    getShipments({ search: search?.trim() || undefined, limit: 300 })
      .then((r) => {
        setRows(r.shipments ?? [])
        setSpend(r.labelSpend ?? 0); setRefunded(r.labelRefunded ?? 0); setTestSpend(r.labelSpendTest ?? 0)
        setTally({ bought: r.labelsBought ?? 0, voided: r.labelsVoided ?? 0, test: r.labelsTest ?? 0 })
        setErr(null)
      })
      .catch((e: Error) => { setErr(e.message); setRows([]) })
      .finally(() => setBusy(false))
  }, [])

  // Client-side CSV of what's on screen — reconciles against the label-cost ledger in Billing.
  // WHAT'S ON SCREEN means the filtered list: exporting all 200 rows from under a "Needs a
  // look: 3" pill hands back a file that answers a question nobody asked. Refunded is a
  // column of its own so the sheet can net out without re-deriving it from the void log.
  const exportCsv = () => {
    const r = shown
    if (!r.length) return
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const head = ["Order", "Customer", "State", "Tracking", "Carrier", "Method", "Price", "Refunded", "Stage", "Delivery", "Scanned at"]
    const lines = [head.join(","), ...r.map((s) => [s.num, s.customer, s.state, s.tracking, s.carrier, s.method, s.price != null ? s.price.toFixed(2) : "", (s.refunded ?? 0) > 0 ? (s.refunded ?? 0).toFixed(2) : "", s.stage, s.delivery, s.scannedAt].map(esc).join(","))]
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
  const confirm = useConfirm()
  const doVoid = async (s: ShipmentRow) => {
    // Says what it costs as well as what it does — the tracking number going away is the
    // surprising half, and the reason is that the buyer must not be left holding a dead one.
    if (!(await confirm({
      title: `Refund the label for ${s.num}?`,
      body: `The carrier cancels the label and credits ${s.price != null ? `$${s.price.toFixed(2)}` : "the postage"} back. The tracking number is removed from this order, so nothing shows the buyer a number that will never move. Carriers settle the credit over a few days.`,
      confirmLabel: "Refund the label",
    }))) return
    setVoiding(s.id)
    try {
      const r = await voidLabel(s.id)
      // Says where it went, because the row it came from is about to change shape — the
      // tracking number disappears and the Refunded tile moves. Without that sentence the
      // list looks like it lost something.
      if (r.ok) { setErr(`Refunded${r.refunded ? ` — $${r.refunded.toFixed(2)} credited back` : ""}. The row stays here with its tracking removed.`); load(q) }
      else setErr(r.error || "The carrier refused the refund.")
    } catch (e) { setErr((e as Error).message) }
    finally { setVoiding(null) }
  }

  // Filtered in the browser, not refetched. The list is already capped at 200 rows and the
  // search box is what narrows the SET; these pills narrow the VIEW of it, so making them a
  // round trip would put a spinner between a question and an answer that is already here.
  // Plain, not useMemo: the React Compiler refuses to optimize a component whose manual
  // memoization it can't preserve, and it can't preserve a memo that closes over a function
  // looked up out of a table. Filtering 200 rows costs nothing; losing compiler
  // optimization on the whole component to protect that cost is the bad trade.
  const shown = (rows ?? []).filter((FILTERS.find((x) => x.key === status) ?? FILTERS[0]).match)

  const counts = useMemo(() => {
    const r = rows ?? []
    return {
      total: r.length,
      moving: r.filter((x) => x.delivery === "in_transit").length,
      stuck: r.filter((x) => x.delivery === "awaiting_pickup").length,
      problem: r.filter((x) => x.delivery === "returned" || x.delivery === "failed").length,
    }
  }, [rows])

  const money = (n: number) => `$${n.toFixed(2)}`
  // Real spend is gross minus the test slice. The subtraction happens HERE rather than in
  // the ledger query, so the number on the tile can be the one you actually paid while the
  // ledger keeps saying what it has always said. Both stay true; neither is edited.
  const realSpend = Math.max(0, spend - testSpend)

  return (
    <>
    {/* The tiles that used to be a parenthetical. Bought and refunded are the pair someone
        checks — a spend figure with no volume behind it can't be sanity-checked, and a
        refund total with no count doesn't say whether it was one void or ten. Each tile
        that names a slice of the table below it filters to that slice when clicked. */}
    <StatGrid>
      <StatCard
        label="Labels bought"
        value={String(tally.bought)}
        sub={tally.bought ? `${money(spend)} recorded` : "none recorded yet"}
      />
      <StatCard
        label="Label spend"
        value={money(realSpend)}
        sub={testSpend > 0 ? `plus ${money(testSpend)} on a test key` : "actually charged"}
      />
      <StatCard
        label="Refunded"
        value={money(refunded)}
        sub={tally.voided ? `${tally.voided} label${tally.voided === 1 ? "" : "s"} refunded` : "nothing refunded"}
        tone={refunded > 0 ? "pos" : "mut"}
        onClick={tally.voided ? () => setStatus("refunded") : undefined}
        active={status === "refunded"}
      />
      <StatCard
        label="Test labels"
        value={String(tally.test)}
        sub={tally.test ? `${money(testSpend)}, never charged` : "none — all live"}
        onClick={tally.test ? () => setStatus("test") : undefined}
        active={status === "test"}
      />
    </StatGrid>

    <SectionCard
      title="Shipments"
      actions={
        <div className="flex items-center gap-3">
          {busy && <CircleNotch size={14} className="animate-spin text-muted-foreground" />}
          <span className="text-xs text-muted-foreground">
            {/* Says which number it is. "12 shown" under an active filter, next to a total
                of 200, otherwise reads as the whole list having shrunk. */}
            {err ? "count unknown" : status === "all" ? `${counts.total} shown` : `${shown.length} of ${counts.total}`}
            {/* Only surfaced when non-zero. A row of zeroes reads as a dashboard; these are
                here to be acted on, and "0 need attention" is noise. */}
            {counts.stuck > 0 && ` · ${counts.stuck} not collected`}
            {counts.problem > 0 && ` · ${counts.problem} need attention`}
          </span>
          {/* The money was crammed in here as a parenthetical beside the row count, which is
              how a figure someone checks daily ended up smaller than the search placeholder.
              It has its own tiles above the table now. */}
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
        {/* Each pill carries its own count, so the answer to "is anything stuck?" is on
            screen before you click anything. A pill with nothing behind it is disabled
            rather than hidden — a filter that appears and disappears as data changes is a
            moving target, and "Needs a look: 0" is the good news worth being able to read. */}
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const n = f.key === "all" ? (rows ?? []).length : (rows ?? []).filter(f.match).length
            const on = status === f.key
            return (
              <button
                key={f.key}
                onClick={() => setStatus(f.key)}
                disabled={!on && n === 0 && f.key !== "all"}
                className={
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 " +
                  (on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground")
                }
              >
                {f.label}
                <span className={"ml-1.5 tabular-nums " + (on ? "opacity-80" : "opacity-60")}>{n}</span>
              </button>
            )
          })}
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
      ) : shown.length === 0 ? (
        // FOUR different nothings, and they must not look alike: the read failed, the search
        // matched nothing, the status filter matched nothing, or there genuinely are no
        // parcels. The failure case was printing "No parcel has a tracking number yet"
        // underneath its own error banner — asserting a fact about the data while saying we
        // couldn't read the data. The filter case is new and is the one most likely to be
        // misread as "nothing shipped": there ARE rows, just none in this state.
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
          <Package size={26} weight="duotone" className="opacity-50" />
          <p className="text-sm">
            {err
              ? "Couldn't read shipments, so this list isn't empty — it's unknown."
              : rows.length > 0
                ? `None of the ${rows.length} shipments here are ${(FILTERS.find((f) => f.key === status)?.label ?? "").toLowerCase()}.`
                : q ? `Nothing matches “${q}”.`
                  : "No parcel has a tracking number yet."}
          </p>
          {err
            ? <Button size="sm" variant="outline" onClick={() => load(q)}>Try again</Button>
            : rows.length > 0 ? <Button size="sm" variant="outline" onClick={() => setStatus("all")}>Show all statuses</Button>
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
                {/* "Carrier says" was written to keep it distinct from the floor's own
                    stage — a real distinction, but the column header is the wrong place to
                    argue it, and it read as a sentence fragment. The badge below already
                    says whose claim it is by being the carrier's vocabulary. */}
                <th className="whitespace-nowrap px-4 py-2 font-medium">Delivery status</th>
                <th className="whitespace-nowrap px-4 py-2 font-medium">Pre-scan</th>
                <th className="px-3 py-2 text-right font-medium">Label</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const d = s.delivery ? DELIVERY[s.delivery] : null
                return (
                  <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                    {/* An order number is the thing you read first and read most, so it gets
                        the body font at body size. Mono at text-xs was two handicaps at once:
                        a narrower face AND the smallest step on the page. tabular-nums keeps
                        the digits in a column, which is the only part mono was earning. */}
                    <td className="whitespace-nowrap px-5 py-2.5 text-sm font-semibold tabular-nums">{s.num}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex max-w-[14rem] items-center gap-1.5">
                        <span className="truncate">{s.customer ?? "—"}</span>
                        {/* On the row, not just in a filter. A test label has real-shaped
                            tracking and a real-looking price, so without saying so on the
                            row itself there is nothing to tell it from a parcel that is
                            actually going somewhere. */}
                        {s.test && (
                          <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-2xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">TEST</span>
                        )}
                      </div>
                      {s.state && <div className="text-2xs text-muted-foreground">{s.state}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      {s.tracking ? (
                        <>
                          <div className="text-sm tabular-nums">{s.tracking}</div>
                          {s.carrier && <div className="text-2xs text-muted-foreground">{s.carrier}</div>}
                        </>
                      ) : s.voidedTracking ? (
                        // STRUCK THROUGH, NOT REMOVED. The parcel this named no longer
                        // exists — which is why `tracking` itself is cleared, since that
                        // field is what asserts the order shipped — but the digits are still
                        // the answer to "what was that number", which is what a buyer
                        // holding it will ask. The line through it IS the status; it needs
                        // no sentence underneath repeating what the strike already says.
                        <div className="text-sm tabular-nums text-muted-foreground line-through decoration-destructive/70">
                          {s.voidedTracking}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    {/* nowrap: "Ground Advantage" was breaking across two lines in a narrow
                        cell, which set the height of every row that had a service name and
                        made the whole table look ragged. The table already scrolls
                        horizontally, so width here is cheaper than height on every row. */}
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs">{s.method || <span className="text-muted-foreground">—</span>}</td>
                    {/* Struck through when it came back, rather than carrying a "refunded
                        $6.24" line underneath. The amount was the same number twice, and the
                        row already says refunded twice over — the crossed-out tracking above
                        and the crossed-out price here. A third statement of it is noise, and
                        the totals live in the tile where they can be read at a glance. */}
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums">
                      {s.price != null ? (
                        <span className={(s.refunded ?? 0) > 0 ? "text-muted-foreground line-through decoration-destructive/70" : ""}>
                          ${s.price.toFixed(2)}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    {/* BOTH COLUMNS WERE ENTIRELY text-2xs — the smallest step on the page,
                        used for the value AND its caption, so nothing separated them and the
                        pair read as one grey clump. The value moves up to text-xs and the
                        caption stays small, which is what makes it a caption. px-4 and a
                        nowrap date do the rest; the date was wrapping inside its cell. */}
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {/* REFUNDED IS THE STATUS. It outranks whatever the carrier last said,
                          because there is no longer a parcel to say anything about — and
                          "Not checked" on a refunded label is actively wrong: it reads as
                          "we might check later and find something", when nothing will ever
                          move. The strike-through on the row says it happened; this says
                          what the row IS. */}
                      {(s.refunded ?? 0) > 0 ? (
                        // THE PROVIDER'S STATE, not a flat "Refunded". Shippo accepts the
                        // request immediately and settles up to 14 days later, and can still
                        // come back ERROR ("the shipment was found to be used"). Saying
                        // "Refunded" the moment it's accepted claims money that hasn't
                        // arrived — so a pending one says so, and their own word sits
                        // underneath where it can be matched against their dashboard.
                        <>
                          <span className={"inline-block rounded px-2 py-1 text-xs font-medium " + (REFUND_TONE[refundState(s)] ?? REFUND_TONE.pending)}>
                            {REFUND_LABEL[refundState(s)] ?? "Refund pending"}
                          </span>
                          {s.refundStatus && (
                            <div className="mt-1 text-2xs uppercase tracking-wide text-muted-foreground opacity-70">{s.refundStatus}</div>
                          )}
                        </>
                      ) : d ? (
                        <span className={"inline-block rounded px-2 py-1 text-xs font-medium " + d.cls}>{d.label}</span>
                      ) : (
                        // Never blank. "Not checked" and "checked, nothing yet" are
                        // different facts and the difference decides whether to chase.
                        <span className="text-xs text-muted-foreground">Not checked</span>
                      )}
                      {s.deliveryCheckedAt && (s.refunded ?? 0) === 0 && (
                        <div className="mt-1 text-2xs text-muted-foreground">checked {when(s.deliveryCheckedAt)}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {s.scannedAt ? (
                        <>
                          <div className="text-xs">{when(s.scannedAt)}</div>
                          <div className="mt-0.5 text-2xs text-muted-foreground">{VIA[s.scannedVia ?? ""] ?? "scanned"}</div>
                        </>
                      ) : (
                        // Same reasoning as the status beside it: a refund clears the scan
                        // (the parcel it claimed to hand over is gone), so "Not scanned"
                        // would read as work still pending on something that ended.
                        <span className="text-xs text-muted-foreground">{(s.refunded ?? 0) > 0 ? "—" : "Not scanned"}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      {/* WORDS, NOT THREE ANONYMOUS GLYPHS. A circular arrow, a box-with-arrow
                          and an X sat in a row at 13px, and telling "re-check the carrier"
                          from "open the PDF" from "refund $6.24" meant hovering each one to
                          read a tooltip. Two of the three are harmless and the third moves
                          money, which is the worst possible thing to leave to a guess. */}
                      <div className="inline-flex items-center gap-1.5">
                        {/* Re-asking the carrier costs an API call and can move money
                            nowhere, so it's open to any staffer — unlike anything that
                            asserts a scan. */}
                        <button
                          onClick={() => recheck(s.id)}
                          disabled={checking === s.id}
                          className="eg-tap inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                          title="Ask the carrier for the latest status"
                          aria-label={`Re-check tracking for ${s.num}`}
                        >
                          {checking === s.id
                            ? <CircleNotch size={12} className="animate-spin" />
                            : <ArrowClockwise size={12} weight="bold" />}
                          Check
                        </button>
                        {s.labelUrl ? (
                          <a
                            href={s.labelUrl} target="_blank" rel="noopener noreferrer"
                            className="eg-tap inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            title="Open the label PDF"
                            aria-label={`Open label for ${s.num}`}
                          >
                            <ArrowSquareOut size={12} weight="bold" />
                            Label
                          </a>
                        ) : (
                          // The label was bought but its file wasn't stored — which is a
                          // real gap on older orders, not "no label". Saying so stops
                          // someone hunting for a button that was never going to be there.
                          <span className="px-1.5 text-2xs text-muted-foreground" title="This label predates storing the PDF">
                            not stored
                          </span>
                        )}
                        {/* "Refund", not "Void". Void is the carrier's word for cancelling
                            the label; what the person pressing it wants is the postage back,
                            and that is also what the row shows afterwards. One word for one
                            outcome. Hidden once it HAS been refunded — a second press can
                            only ever collect the carrier's refusal. */}
                        {canVoid && s.labelUrl && (s.refunded ?? 0) === 0 && (
                          <button
                            onClick={() => doVoid(s)}
                            disabled={voiding === s.id}
                            className="eg-tap inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                            title="Cancel the label and get the postage credited back"
                            aria-label={`Refund the label for ${s.num}`}
                          >
                            {voiding === s.id ? <CircleNotch size={12} className="animate-spin" /> : <X size={12} weight="bold" />}
                            Refund
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
