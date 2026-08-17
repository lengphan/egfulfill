"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, Trash, FloppyDisk } from "@phosphor-icons/react"
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

  const setCell = (i: number, key: keyof VolumeTier, raw: string) => {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [key]: raw === "" ? NaN : Number(raw) } : row)))
  }

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
          <FloppyDisk size={14} weight="bold" /> Save ladder
        </Button>
      }
    >
      <div className="space-y-4 px-5 pb-5">
        {/* The "this changes no charge" notice that used to sit here is gone because it
            stopped being true: quoteOrder reads this ladder now. What replaces it is not
            reassurance but the one fact an admin needs before typing — a saved rung is
            money on the next order, and it applies from the next charge, not retroactively
            to orders already paid for. */}
        <p className="text-sm text-muted-foreground">
          A saved ladder prices the next order. Sellers earn a rate from what they ship in a
          month and spend it the month after, so editing these changes what future orders
          cost — never what an already-charged order was billed.
        </p>

        <div className="space-y-2">
          {rows.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No tiers. An empty ladder means the programme is off and every seller earns 0%.
            </div>
          )}
          {rows.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                value={Number.isFinite(t.minUnits) ? String(t.minUnits) : ""}
                onChange={(e) => setCell(i, "minUnits", e.target.value.replace(/[^\d]/g, ""))}
                placeholder="units"
                inputMode="numeric"
                aria-label={`Minimum units for tier ${i + 1}`}
                className="h-8 w-28 text-right tabular-nums"
              />
              <span className="text-sm text-muted-foreground">units or more →</span>
              <Input
                value={Number.isFinite(t.pct) ? String(t.pct) : ""}
                onChange={(e) => setCell(i, "pct", e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="%"
                inputMode="decimal"
                aria-label={`Discount percent for tier ${i + 1}`}
                className="h-8 w-20 text-right tabular-nums"
              />
              <span className="text-sm text-muted-foreground">% off</span>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove tier ${i + 1}`}
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                <Trash size={14} />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setRows((r) => [...r, { minUnits: NaN, pct: NaN }])}>
            <Plus size={14} weight="bold" /> Add tier
          </Button>
        </div>

        {note && <div className="rounded-md bg-muted px-3 py-2 text-sm">{note}</div>}
        {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}

        {/* WHO THIS WOULD ACTUALLY HIT. */}
        <div className="border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                  <tr className="text-2xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-1.5 pr-3 text-left font-semibold">Seller</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Orders</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Units</th>
                    {/* "Would earn" while the ladder priced nothing. It does now, and these
                        units are what set the rate being charged — a conditional heading over
                        a real number is the same overclaim in reverse. */}
                    <th className="py-1.5 text-right font-semibold">Earns</th>
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
              <div className="mb-3 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
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
