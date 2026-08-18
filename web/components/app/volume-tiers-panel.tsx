"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, Trash } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/app/section-card"
import {
  getVolumeTiers, saveVolumeTiers, getVolumeReport, getPlanUsage,
  type VolumeTier, type VolumeSeller, type PlanUsage,
} from "@/lib/api"
import { VolumeRail } from "@/components/app/volume-board"

/**
 * The volume ladder, and what it would do to real sellers.
 *
 * The report under the editor is the point of this screen. A tier table typed into empty
 * boxes is a guess; the same table next to "here is who would land on each rung this month"
 * is a decision. Setting thresholds without seeing the distribution is how a programme ends
 * up rewarding nobody, or everybody.
 *
 * NORMALISATION IS THE SERVER'S JOB. This form sends what was typed and renders what comes
 * back — sorting, de-duplicating and range-checking here as well would be a second rule that
 * quietly disagrees with the engine. `dropped` tells the admin the server discarded rows, so
 * a silently-ignored typo is impossible.
 */
const periodOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
const prevPeriod = (key: string) => {
  const [y, m] = key.split("-").map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`
}

/** One set of tracks for the ladder's header and rows, so From / To / Discount / Sellers stack
 *  as columns — a ladder is read vertically and the comparison is always between two rungs. */
const TIER_ROW = "grid grid-cols-[minmax(0,1fr)_6.5rem_5rem_5.5rem_4.5rem_2.25rem] items-center gap-x-3 px-5"

export function VolumeTiersPanel() {
  const [rows, setRows] = useState<VolumeTier[]>([])
  const [period, setPeriod] = useState(() => prevPeriod(periodOf(new Date())))
  const [sellers, setSellers] = useState<VolumeSeller[] | null>(null)
  // Which seller's card is being previewed, and their standing once it loads.
  const [preview, setPreview] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<PlanUsage | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      getVolumeTiers().then((r) => setRows(r.tiers ?? [])).catch((e: Error) => setErr(e.message))
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const loadReport = useCallback((p: string) => {
    setSellers(null)
    getVolumeReport(p).then((r) => setSellers(r.sellers ?? [])).catch((e: Error) => setErr(e.message))
  }, [])

  useEffect(() => { const t = setTimeout(() => loadReport(period), 0); return () => clearTimeout(t) }, [period, loadReport])

  /**
   * `name` is TEXT; the other two are numbers. Coercing every field through Number() turned a
   * typed name into NaN on the first keystroke — the empty-string-to-NaN rule exists so a
   * cleared NUMBER stays distinguishable from a zero, and it has no business near a label.
   */
  const setCell = (i: number, key: keyof VolumeTier, raw: string) => {
    setRows((r) => r.map((row, j) => (j === i
      ? { ...row, [key]: key === "name" ? raw : (raw === "" ? NaN : Number(raw)) }
      : row)))
  }

  /**
   * The rung's upper bound, read off the NEXT rung rather than stored.
   *
   * One threshold per tier is the model the engine uses — a seller earns the highest tier they
   * clear — so a second editable bound could only ever introduce a gap or an overlap that the
   * engine would then ignore. Sorted rather than assumed in order: the server normalises on
   * save, but this renders what is typed, and a row added at the bottom starts out unsorted.
   */
  const ordered = rows.filter((r) => Number.isFinite(r.minUnits)).map((r) => r.minUnits).sort((a, b) => a - b)
  const upperOf = (i: number) => {
    const min = rows[i]?.minUnits
    if (!Number.isFinite(min)) return "—"
    const next = ordered.find((v) => v > min)
    return next == null ? "and up" : (next - 1).toLocaleString()
  }

  /**
   * How many sellers in the reported period land on each rung, AS THE LADDER IS TYPED.
   *
   * Bucketed by units against the thresholds, not by the `pct` the report came back with: the
   * report was computed from the SAVED ladder, so reading it back would show the old shape
   * while you edit the new one — and two rungs can legitimately share a percentage, which
   * makes pct a lossy key regardless.
   *
   * A seller below every threshold lands on no rung and is counted in none, which is the same
   * thing the engine does with them.
   */
  const landing = (() => {
    const out: Record<number, number> = {}
    if (!sellers) return out
    for (const s of sellers) {
      let best = -1
      let bestMin = -1
      rows.forEach((t, i) => {
        if (Number.isFinite(t.minUnits) && s.units >= t.minUnits && t.minUnits > bestMin) { best = i; bestMin = t.minUnits }
      })
      if (best >= 0) out[best] = (out[best] ?? 0) + 1
    }
    return out
  })()

  const save = async () => {
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await saveVolumeTiers(rows)
      if (r.error) throw new Error(r.error)
      setRows(r.tiers ?? [])
      setNote(
        r.dropped
          ? `Saved ${r.tiers.length} tier${r.tiers.length === 1 ? "" : "s"}. ${r.dropped} row${r.dropped === 1 ? " was" : "s were"} discarded — a tier needs units above 0 and a percentage between 0 and 100, and duplicate thresholds collapse.`
          : `Saved ${r.tiers.length} tier${r.tiers.length === 1 ? "" : "s"}.`
      )
      loadReport(period)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <SectionCard
      title="Volume tiers"
      actions={
        <Button size="sm" onClick={save} disabled={busy}>
          Save ladder
        </Button>
      }
    >
      <div className="space-y-4 pb-5">

        {/**
          * A TABLE, not a sentence made of inputs.
          *
          * The row read "[Tier 1] [100] units or more → [3] % off 🗑" — three pill fields of
          * three different widths with prose between them, so nothing lined up down the
          * column and the eye had to re-parse each line to compare two rungs. A ladder is
          * read VERTICALLY: the question is always "what happens at 300 that did not at 100".
          *
          * Fixed grid tracks and a header row answer that. The units and the percent are
          * right-aligned and tabular so the digits stack; the arrow and the words "units or
          * more" become column headings, said once instead of once per rung.
          */}
        <div>
          {rows.length === 0 ? (
            <div className="mx-5 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No tiers. An empty ladder means the programme is off and every seller earns 0%.
            </div>
          ) : (
            /* FULL WIDTH, no box. A bordered table inset inside a bordered card drew two
               frames a few pixels apart — the card is the frame, and the rows belong in it the
               way every other list in the app sits in one. Same change as the packages table
               above it, because these two cards sit on one screen. */
            <div className="divide-y divide-border border-b border-border">
              <div className={TIER_ROW + " py-2 eg-label text-muted-foreground"}>
                <span>Name</span>
                <span className="text-right">From (units)</span>
                {/* The rung's upper bound. It was only ever implied by the NEXT row's
                    threshold, so reading "what does tier 2 cover" meant reading tier 3 — and
                    the top rung's "and up" was implied by nothing at all. */}
                <span className="text-right">To</span>
                <span className="text-right">Discount</span>
                <span className="text-right">Sellers</span>
                <span />
              </div>
              <div className="divide-y divide-border">
                {rows.map((t, i) => (
                  <div key={i} className={TIER_ROW + " py-2.5"}>
                    {/* Optional. Blank shows the position as a placeholder, which is what the
                        rung is called until somebody names it — and what every ladder saved
                        before names existed will keep showing. */}
                    <Input
                      value={t.name ?? ""}
                      onChange={(e) => setCell(i, "name", e.target.value)}
                      placeholder={`Tier ${i + 1}`}
                      aria-label={`Name for tier ${i + 1}`}
                      className="h-8 border-transparent bg-transparent px-2 font-medium shadow-none focus-visible:border-border focus-visible:bg-card"
                    />
                    <Input
                      value={Number.isFinite(t.minUnits) ? String(t.minUnits) : ""}
                      onChange={(e) => setCell(i, "minUnits", e.target.value.replace(/[^\d]/g, ""))}
                      placeholder="0"
                      inputMode="numeric"
                      aria-label={`Minimum units for tier ${i + 1}`}
                      className="h-8 px-2 text-right tabular-nums"
                    />
                    {/* Derived, never typed: one threshold per rung is the model, and a second
                        editable bound is a gap or an overlap waiting to be saved. */}
                    <span className="text-right text-sm tabular-nums text-muted-foreground">{upperOf(i)}</span>
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        value={Number.isFinite(t.pct) ? String(t.pct) : ""}
                        onChange={(e) => setCell(i, "pct", e.target.value.replace(/[^\d.]/g, ""))}
                        placeholder="0"
                        inputMode="decimal"
                        aria-label={`Discount percent for tier ${i + 1}`}
                        className="h-8 w-14 px-2 text-right tabular-nums"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                    {/* HOW MANY SELLERS THIS RUNG WOULD ACTUALLY HOLD, counted off the same
                        report below and against the ladder AS TYPED — so a threshold you are
                        still editing shows what it would do before it is saved, which is the
                        entire reason the report is on this screen. */}
                    <span className="text-right text-sm tabular-nums">
                      {sellers === null ? <span className="text-muted-foreground">—</span>
                        : landing[i] ? <span className="font-medium">{landing[i]}</span>
                          : <span className="text-muted-foreground">0</span>}
                    </span>
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove tier ${i + 1}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                      <Trash size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="px-5 pt-4">
            <Button size="sm" variant="outline" onClick={() => setRows((r) => [...r, { minUnits: NaN, pct: NaN, name: "" }])}>
              <Plus size={14} weight="bold" /> Add tier
            </Button>
          </div>
        </div>

        {note && <div className="mx-5 rounded-md bg-muted px-3 py-2 text-sm">{note}</div>}
        {err && <div className="mx-5 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}

        {/* WHO THIS WOULD ACTUALLY HIT. */}
        <div className="border-t border-border px-5 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eg-label text-muted-foreground">
              Who lands where
            </span>
            <Input
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="YYYY-MM"
              aria-label="Period to report on"
              className="h-7 w-28 tabular-nums"
            />
          </div>

          {sellers === null ? (
            <div className="mt-3 text-sm text-muted-foreground">Loading…</div>
          ) : sellers.length === 0 ? (
            <div className="mt-3 text-sm text-muted-foreground">
              No seller shipped anything in {period}. Volume counts orders with a shipped date — an
              order that synced but never shipped isn&apos;t volume.
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead>
                  <tr className="eg-label text-muted-foreground">
                    <th className="py-1.5 pr-3 text-left">Seller</th>
                    <th className="py-1.5 pr-3 text-right">Orders</th>
                    <th className="py-1.5 pr-3 text-right">Units</th>
                    {/* "Would earn" while the ladder priced nothing. It does now, and these
                        units are what set the rate being charged — a conditional heading over
                        a real number is the same overclaim in reverse. */}
                    <th className="py-1.5 text-right">Earns</th>
                  </tr>
                </thead>
                <tbody>
                  {sellers.map((s) => {
                    const open = preview === s.sellerId
                    return (
                      <tr
                        key={s.sellerId}
                        onClick={() => {
                          // Toggle, and clear the old standing first so a second seller can
                          // never be read against the previous one's numbers mid-fetch.
                          if (open) { setPreview(null); setPreviewData(null); return }
                          setPreview(s.sellerId); setPreviewData(null)
                          getPlanUsage(s.sellerId).then(setPreviewData).catch((e: Error) => setErr(e.message))
                        }}
                        className={"cursor-pointer border-t border-border transition-colors hover:bg-accent " + (open ? "bg-accent" : "")}
                      >
                        <td className="py-1.5 pr-3 font-mono text-2xs">{s.sellerId.slice(0, 8)}…</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{s.orders}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{s.units.toLocaleString()}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {s.pct > 0
                            ? <span className="font-semibold text-primary">{s.pct}%</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* WHAT THAT SELLER ACTUALLY SEES — rendered with the seller's own component, via
              the seller's own endpoint. Not a rendering of the same idea: the same code. An
              admin setting thresholds has to be able to look at the result, and a separate
              preview implementation would be free to disagree with the real thing. */}
          {preview && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 eg-label text-muted-foreground">
                Seller&apos;s view · <span className="font-mono normal-case">{preview.slice(0, 8)}…</span>
              </div>
              {previewData
                ? <VolumeRail data={previewData} />
                : <p className="text-sm text-muted-foreground">Loading…</p>}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
