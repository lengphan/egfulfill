"use client"

import { useEffect, useState } from "react"
import { TrendUp, Info } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { getPlanUsage, type PlanUsage, type VolumeStanding } from "@/lib/api"

/**
 * A seller's own volume standing — what they shipped, and what it earns.
 *
 * TWO PERIODS, because they answer different questions and only one of them is still
 * winnable. `earned` is last month's units, which set this month's rate and are already
 * decided; `running` is this month so far, which sets next month's. The second is the whole
 * point of showing this at all — a number you can still change is motivating, a number you
 * can't is a receipt.
 *
 * WHILE `applied` IS FALSE THIS PAGE MUST NOT IMPLY A DISCOUNT. Tiers are measured before
 * they are charged, so every rate here is explicitly labelled as what it *would* earn. A
 * seller told they are getting 6% off who then reads a full-price invoice has been lied to
 * by a dashboard, which is worse than not having the dashboard.
 */
const monthName = (period: string) => {
  const [y, m] = period.split("-").map(Number)
  if (!y || !m) return period
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
}

function Standing({ s, applied, tone }: { s: VolumeStanding; applied: boolean; tone: "settled" | "live" }) {
  const pctLabel = s.pct > 0 ? `${s.pct}%` : "—"
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {tone === "settled" ? `Earned in ${monthName(s.period)}` : `Running — ${monthName(s.period)} so far`}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-extrabold tabular-nums tracking-tight">{s.units.toLocaleString()}</span>
        <span className="text-sm text-muted-foreground">units shipped</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary tabular-nums">
          {pctLabel}
        </span>
        <span className="text-muted-foreground">
          {applied ? "applies to" : "would apply to"} {monthName(s.appliesTo)}
          {s.index > 0 ? ` · Tier ${s.index}` : " · no tier yet"}
        </span>
      </div>
      {/* The distance to the next rung, and a bar for it. Only meaningful while the period is
          still open — on a settled month it is a fact about the past, so it isn't shown. */}
      {tone === "live" && s.next && s.unitsToNext != null && (
        <div className="mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${Math.min(100, Math.round((s.units / s.next.minUnits) * 100))}%` }}
            />
          </div>
          <div className="mt-2 text-[13px] text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{s.unitsToNext.toLocaleString()}</span>
            {" "}more units this month reaches{" "}
            <span className="font-semibold text-foreground">{s.next.pct}%</span> for {monthName(s.appliesTo)}.
          </div>
        </div>
      )}
      {tone === "live" && !s.next && s.index > 0 && (
        <div className="mt-4 text-[13px] text-muted-foreground">Top tier — nothing above this one.</div>
      )}
    </div>
  )
}

export function VolumeBoard() {
  const [data, setData] = useState<PlanUsage | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      getPlanUsage().then(setData).catch((e: Error) => setErr(e.message))
    }, 0)
    return () => clearTimeout(t)
  }, [])

  // An unreadable board and an empty one are different facts, and neither may impersonate
  // the other — a seller seeing "0 units" when the request failed would believe it.
  if (err) {
    return (
      <SectionCard title="Volume discount" description="What you shipped, and what it earns.">
        <div className="px-5 pb-5 text-sm text-muted-foreground">
          We couldn&apos;t load your volume just now — this is a problem on our side, not a zero. {err}
        </div>
      </SectionCard>
    )
  }
  if (!data) {
    return (
      <SectionCard title="Volume discount" description="What you shipped, and what it earns.">
        <div className="px-5 pb-5 text-sm text-muted-foreground">Loading…</div>
      </SectionCard>
    )
  }

  // No ladder configured is not an error and not a zero — the programme simply isn't running.
  if (!data.tiers.length) {
    return (
      <SectionCard title="Volume discount" description="What you shipped, and what it earns.">
        <div className="px-5 pb-5 text-sm text-muted-foreground">
          There&apos;s no volume programme running at the moment. Nothing is hidden — there are no
          tiers set up yet.
        </div>
      </SectionCard>
    )
  }

  return (
    <SectionCard
      title="Volume discount"
      description="Earned by what you ship. Volume in one month sets your rate for the next."
    >
      <div className="px-5 pb-5">
        {/* The honesty line. While tiers are being measured rather than charged, this is the
            single most important sentence on the page. */}
        {!data.applied && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
            <Info size={15} weight="fill" className="mt-0.5 shrink-0" />
            <span>
              We&apos;re tracking volume now, but discounts aren&apos;t being applied to orders yet.
              These are the rates your shipping <em>would</em> earn.
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {data.earned && <Standing s={data.earned} applied={data.applied} tone="settled" />}
          {data.running && <Standing s={data.running} applied={data.applied} tone="live" />}
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            <TrendUp size={13} weight="bold" /> The ladder
          </div>
          <div className="flex flex-wrap gap-2">
            {data.tiers.map((t) => {
              const reached = (data.running?.units ?? 0) >= t.minUnits
              return (
                <span
                  key={t.minUnits}
                  className={
                    "rounded-lg border px-2.5 py-1 text-[13px] tabular-nums " +
                    (reached
                      ? "border-primary/30 bg-primary/10 font-semibold text-primary"
                      : "border-border text-muted-foreground")
                  }
                >
                  {t.minUnits.toLocaleString()}+ units → {t.pct}%
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
