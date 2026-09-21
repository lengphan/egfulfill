"use client"

import { useLabelT, useDateFormat } from "@/lib/i18n"
import { useEffect, useState, useCallback } from "react"
import { SectionCard } from "@/components/app/section-card"
import { getPlanUsage, type PlanUsage } from "@/lib/api"

/**
 * A seller's volume standing, as ONE rail.
 *
 * The first version was two stat cards plus a pill list of tiers, and it made the reader do
 * the work: find their number in one card, find the matching rung in the list, and hold both
 * to see how far off they were. A ladder with a position on it is a single object — where
 * you are and what is next are the same glance.
 *
 * The rail is also why the numbers stay small. This card answers one question — "what do I
 * do to pay less" — so the sentence under the rail is the payload and everything else is
 * context. A 3xl "0" was giving the most visual weight to the least useful fact.
 *
 * WHILE `applied` IS FALSE NOTHING HERE MAY IMPLY A LIVE DISCOUNT. That was a boxed warning
 * row, which read as an error and explained nothing; it now sits in the description where a
 * reader is already looking for what the card is, plus a chip for scanning. Same promise,
 * stated where it is actually read.
 */
function useMonthShort() {
  const fmtDate = useDateFormat()
  return useCallback((period: string) => {
  const [y, m] = period.split("-").map(Number)
  if (!y || !m) return period
  return fmtDate(new Date(Date.UTC(y, m - 1, 1)), { month: "long", timeZone: "UTC" })
}, [fmtDate])
}

function Shell({ children, note }: { children: React.ReactNode; note?: string }) {
  const tl = useLabelT()
  return (
    <SectionCard
      title={tl("volumeBoard", "Volume discount")}
    >
      {/* pt-5, not pt-0: the first element is a pill, and it was landing directly on
          the header rule with nothing between them. */}
      <div className="px-5 pb-5 pt-5">{children}</div>
    </SectionCard>
  )
}

/**
 * The rail, the sentence and the receipt — everything the seller actually reads.
 *
 * Exported so the admin's ladder editor can preview a chosen seller with THIS component
 * rather than its own rendering of the same idea. An admin who sets thresholds needs to see
 * what a seller sees from them; a second implementation would let the two drift, which is
 * how the mis-aligned tier labels survived until they were spotted by eye.
 */
export function VolumeRail({ data }: { data: PlanUsage }) {
  const monthShort = useMonthShort()
  const tl = useLabelT()
  const running = data.running
  const earned = data.earned
  const units = running?.units ?? 0
  /* `tiers`, `top` and `pos` went with the rail. The ladder's last rung only ever existed to
     scale a bar across every tier, and scaling to a rung nobody reaches this month is the
     fault that made two thirds of it dead space. The live distance is to the NEXT rung, which
     the server already computes. */

  return (
    <>
      {!data.applied && (
        <div className="mb-4 inline-flex rounded-lg bg-muted px-2.5 py-1 eg-label text-muted-foreground">
          {tl("volumeBoard", "Preview")}
        </div>
      )}

      {/**
        * ONE NUMBER, ONE TARGET, ONE HAIRLINE (owner's pick, 2026-09-21).
        *
        * The rail it replaces drew a CONTINUOUS bar for a STEPPED reward — the rate jumps at
        * 100 and again at 300, so a sliding fill claimed a rate that grows with every unit
        * when 99 units earns exactly what 0 does. Three more faults followed from that one:
        * the scale ran to the TOP rung, so the distance actually being travelled was squeezed
        * into the first third and the rest was territory nobody crosses; at zero the fill had
        * no width and the position marker was hidden to avoid the end cap, so the state a new
        * seller is in LONGEST was the one it could not draw; and a fill, a dot per rung, a
        * position bar and two rows of labels made four devices out of an 8px line.
        *
        * This measures the only distance that is live: to the NEXT rung. The figure is the
        * count, the target is beside it, and the meter is the same quantity in a shape you can
        * see at arm's length — no ladder to mis-scale, and zero is a real reading rather than
        * an empty bar.
        *
        * WHAT IT GIVES UP, deliberately: the rungs beyond the next one are no longer on
        * screen, so 6% is not visible from a standing start. The trade was made with that
        * named — see the options sheet — and the sentence still says what is being earned and
        * when it lands, which is the part nothing else on the page can say.
        */}
      <div>
        {running?.next && running.unitsToNext != null ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              {/* The count, at the size of a figure somebody reads across a desk. §4: a VALUE,
                  not a caption. */}
              <span className="text-3xl font-bold leading-none tracking-tight tabular-nums">
                {units.toLocaleString()}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {tl("volumeBoard", "of")} {running.next.minUnits.toLocaleString()}{" "}
                {tl("volumeBoard", "units shipped")} · {tl("volumeBoard", "next rate")}{" "}
                <span className="font-semibold text-foreground">{running.next.pct}%</span>
              </span>
            </div>
            {/* A HAIRLINE, not a rail. It carries one quantity — how far to the next rung —
                so it needs no rungs, no marker and no scale to misread. */}
            <div className="mt-3.5 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${Math.min(100, (units / running.next.minUnits) * 100)}%` }}
              />
            </div>
          </>
        ) : (
          /* TOP RUNG. There is no next target, so there is no distance to draw — the meter
             would be a full bar measuring nothing. The figure and the rate are the whole fact. */
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-3xl font-bold leading-none tracking-tight tabular-nums">
              {units.toLocaleString()}
            </span>
            <span className="text-sm text-muted-foreground">
              {tl("volumeBoard", "units shipped")} ·{" "}
              <span className="font-semibold text-foreground">{running?.pct ?? 0}% {tl("volumeBoard", "off")}</span>
            </span>
          </div>
        )}
      </div>

      {/* WHEN IT LANDS — the one thing the figures above cannot say, and the single fact about
          this scheme people get wrong: it is earned in one month and applied in the next. */}
      {running?.appliesTo && (
        <p className="mt-3 text-sm text-muted-foreground">
          {tl("volumeBoard", "Earned this month, applied")}{" "}
          <span className="font-semibold text-foreground">{monthShort(running.appliesTo)}</span>.
        </p>
      )}

      {/* LAST MONTH ONLY WHEN IT EARNED SOMETHING. "August: 0 units — no tier reached" is a
          receipt for nothing happening, under a card that has already said where you are: a
          third line of type to tell somebody a thing did not occur. A month that DID earn a
          tier is different — it is the discount running on this month's orders, which is
          money and belongs on screen. */}
      {earned && earned.pct > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {monthShort(earned.period)}: {earned.units.toLocaleString()} units — {earned.pct}%{" "}
          {data.applied ? "off" : tl("volumeBoard", "would apply")} this month.
        </p>
      )}
    </>
  )
}

/** The seller's own card: fetches their standing and wraps the rail in the section chrome. */
export function VolumeBoard() {
  const tl = useLabelT()
  const [data, setData] = useState<PlanUsage | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { getPlanUsage().then(setData).catch((e: Error) => setErr(e.message)) }, 0)
    return () => clearTimeout(t)
  }, [])

  // Unreadable and empty are different facts and must never look alike — a seller shown
  // "0 units" when the request failed would believe it.
  if (err) return <Shell><p className="text-sm text-muted-foreground">{tl("volumeBoard", "We couldn’t load your volume — that’s a problem on our side, not a zero.")}</p></Shell>
  if (!data) return <Shell><p className="text-sm text-muted-foreground">{tl("volumeBoard", "Loading…")}</p></Shell>
  if (!data.tiers.length) return <Shell><p className="text-sm text-muted-foreground">{tl("volumeBoard", "There’s no volume programme running right now.")}</p></Shell>

  return (
    <Shell note={
      data.applied
        ? tl("volumeBoard", "Ship more in a month, pay less the next.")
        : tl("volumeBoard", "Ship more in a month, pay less the next. We're tracking this now — it isn't discounting orders yet.")
    }>
      <VolumeRail data={data} />
    </Shell>
  )
}
