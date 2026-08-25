"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
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
const monthShort = (period: string) => {
  const [y, m] = period.split("-").map(Number)
  if (!y || !m) return period
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })
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
  const tl = useLabelT()
  const running = data.running
  const earned = data.earned
  const tiers = data.tiers
  const units = running?.units ?? 0
  const top = tiers[tiers.length - 1].minUnits
  // The rail runs to the top rung. Past it there is nothing left to earn, so the fill simply
  // completes rather than the scale stretching and making every marker drift.
  const pos = Math.min(100, (units / top) * 100)

  return (
    <>
      {!data.applied && (
        <div className="mb-4 inline-flex rounded-full bg-muted px-2.5 py-1 eg-label text-muted-foreground">
          {tl("volumeBoard", "Preview")}
        </div>
      )}

      {/* THE RAIL — the ladder and your place on it.
          The current position is marked explicitly rather than left to be inferred from
          where the fill stops. At zero units the fill has no width at all, so there was
          nothing on screen saying "you are here" — the one thing the rail exists to show. */}
      <div className="relative pt-7">
        <div
          className="absolute top-0 whitespace-nowrap text-xs font-semibold text-primary"
          style={{ left: `${pos}%`, transform: pos < 8 ? "translateX(0)" : pos > 92 ? "translateX(-100%)" : "translateX(-50%)" }}
        >
          {units.toLocaleString()} {units === 1 ? "unit" : "units"}
        </div>

        <div className="relative h-2 rounded-full bg-muted">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pos}%` }} />
          {tiers.map((t) => {
            const reached = units >= t.minUnits
            return (
              <span
                key={t.minUnits}
                className={"absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card " + (reached ? "bg-primary" : "bg-border")}
                style={{ left: `${Math.min(100, (t.minUnits / top) * 100)}%` }}
              />
            )
          })}
          {/* The marker for NOW — a bar rather than another dot, so it cannot be mistaken for
              a rung. Hidden at 0 where it would collide with the rail's own end cap. */}
          {pos > 0 && (
            <span
              className="absolute top-1/2 h-5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
              style={{ left: `${pos}%` }}
            />
          )}
        </div>

        {/* Percentage first and larger — it is the thing being earned; the threshold is the
            condition. The arrow between them was doing no work and read as clutter. */}
        <div className="relative mt-2.5 h-9">
          {tiers.map((t, i) => {
            const left = Math.min(100, (t.minUnits / top) * 100)
            const shift = i === 0 && left < 12 ? "0" : i === tiers.length - 1 ? "-100%" : "-50%"
            const reached = units >= t.minUnits
            return (
              <span
                key={t.minUnits}
                className="absolute whitespace-nowrap leading-tight"
                style={{ left: `${left}%`, transform: `translateX(${shift})` }}
              >
                <span className={"block text-sm font-semibold tabular-nums " + (reached ? "text-primary" : "text-muted-foreground")}>
                  {t.pct}%
                </span>
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {t.minUnits.toLocaleString()} units
                </span>
              </span>
            )
          })}
        </div>
      </div>

      {/* THE SENTENCE — the one thing this card exists to say. */}
      <p className="mt-5 text-sm leading-relaxed">
        You&apos;ve shipped <span className="font-semibold tabular-nums">{units.toLocaleString()}</span>{" "}
        {units === 1 ? "unit" : "units"} in {running ? monthShort(running.period) : tl("volumeBoard", "this month")}.{" "}
        {running?.next && running.unitsToNext != null ? (
          <>
            <span className="font-semibold tabular-nums">{running.unitsToNext.toLocaleString()}</span> more
            {" "}earns <span className="font-semibold">{running.next.pct}% off</span> in{" "}
            {monthShort(running.appliesTo)}.
          </>
        ) : running && running.pct > 0 ? (
          <>That&apos;s the top tier — <span className="font-semibold">{running.pct}% off</span> in {monthShort(running.appliesTo)}.</>
        ) : null}
      </p>

      {/* Last month, kept quiet. It is a receipt: true, occasionally useful, and nothing the
          reader can act on. */}
      {earned && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {monthShort(earned.period)}: {earned.units.toLocaleString()} units
          {earned.pct > 0
            ? <> — {earned.pct}% {data.applied ? "off" : tl("volumeBoard", "would apply")} this month.</>
            : <> {tl("volumeBoard", "— no tier reached.")}</>}
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
