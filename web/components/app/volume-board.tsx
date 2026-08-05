"use client"

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
  return (
    <SectionCard
      title="Volume discount"
      description={note ?? "Ship more in a month, pay less the next."}
    >
      <div className="px-5 pb-5">{children}</div>
    </SectionCard>
  )
}

export function VolumeBoard() {
  const [data, setData] = useState<PlanUsage | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { getPlanUsage().then(setData).catch((e: Error) => setErr(e.message)) }, 0)
    return () => clearTimeout(t)
  }, [])

  // Unreadable and empty are different facts and must never look alike — a seller shown
  // "0 units" when the request failed would believe it.
  if (err) return <Shell><p className="text-sm text-muted-foreground">We couldn&apos;t load your volume — that&apos;s a problem on our side, not a zero.</p></Shell>
  if (!data) return <Shell><p className="text-sm text-muted-foreground">Loading…</p></Shell>
  if (!data.tiers.length) return <Shell><p className="text-sm text-muted-foreground">There&apos;s no volume programme running right now.</p></Shell>

  const running = data.running
  const earned = data.earned
  const tiers = data.tiers
  const units = running?.units ?? 0
  const top = tiers[tiers.length - 1].minUnits
  // The rail runs to the top rung. Past it there is nothing left to earn, so the fill simply
  // completes rather than the scale stretching and making every marker drift.
  const pos = Math.min(100, (units / top) * 100)

  return (
    <Shell note={
      data.applied
        ? "Ship more in a month, pay less the next."
        : "Ship more in a month, pay less the next. We're tracking this now — it isn't discounting orders yet."
    }>
      {!data.applied && (
        <div className="mb-4 inline-flex rounded-full bg-muted px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Preview
        </div>
      )}

      {/* THE RAIL — the ladder and your place on it, in one object. */}
      <div className="pt-1">
        <div className="relative h-1.5 rounded-full bg-muted">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pos}%` }} />
          {tiers.map((t) => {
            const reached = units >= t.minUnits
            return (
              <span
                key={t.minUnits}
                className={"absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card " + (reached ? "bg-primary" : "bg-border")}
                style={{ left: `${Math.min(100, (t.minUnits / top) * 100)}%` }}
              />
            )
          })}
        </div>
        {/* Each label is anchored to ITS OWN marker. A justify-between row was tried first
            and was quietly wrong: it pinned the first label to the far left while its dot sat
            at 13% of the rail, so the ladder read as though the first rung were at zero.
            Centring is clamped at both ends — translate -50% would push the first label off
            the left edge and the last (always at 100%) off the right. */}
        <div className="relative mt-2 h-4 text-2xs tabular-nums">
          {tiers.map((t, i) => {
            const left = Math.min(100, (t.minUnits / top) * 100)
            const shift = i === 0 && left < 12 ? "0" : i === tiers.length - 1 ? "-100%" : "-50%"
            return (
              <span
                key={t.minUnits}
                className={"absolute whitespace-nowrap " + (units >= t.minUnits ? "font-semibold text-primary" : "text-muted-foreground")}
                style={{ left: `${left}%`, transform: `translateX(${shift})` }}
              >
                {t.minUnits.toLocaleString()} → {t.pct}%
              </span>
            )
          })}
        </div>
      </div>

      {/* THE SENTENCE — the one thing this card exists to say. */}
      <p className="mt-5 text-sm leading-relaxed">
        You&apos;ve shipped <span className="font-semibold tabular-nums">{units.toLocaleString()}</span>{" "}
        {units === 1 ? "unit" : "units"} in {running ? monthShort(running.period) : "this month"}.{" "}
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
            ? <> — {earned.pct}% {data.applied ? "off" : "would apply"} this month.</>
            : <> — no tier reached.</>}
        </p>
      )}
    </Shell>
  )
}
