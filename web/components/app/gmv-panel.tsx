"use client"

import { SectionCard } from "@/components/app/section-card"
import { cn } from "@/lib/utils"

/**
 * THE MONEY PANEL — one headline figure, the figures that qualify it, and the shape of the run.
 *
 * Lifted out of staff-dashboard.tsx unchanged, because the seller dashboard wants the same
 * block and copying it would have been the fifteenth hand-rolled version of something this
 * app already had. §4: a rule with no component is a wish.
 *
 * It takes VALUES, not state. The staff dashboard reads `Overview.gmvBars` off the reports
 * endpoint; a seller's series is computed client-side from their own orders. Neither of those
 * belongs in here — this draws what it is handed and knows nothing about where money comes
 * from, which is why one component can serve both.
 *
 * `bars` is scaled 0..1. It is the SHAPE, not the axis: bars are the one form that reads at
 * this size with no labels at all, and a chart that needs an axis to be read is the wrong
 * chart for a dashboard.
 */
export type GmvSide = { label: string; value: string; sub?: string }

export function GmvPanel({
  title,
  headline,
  headlineSub,
  side = [],
  foot = [],
  bars = [],
  barsPrev,
  controls,
  aside,
  tone = "card",
  className,
}: {
  title: string
  /** Already formatted, already localised. "—" when the read failed — never a zero. */
  headline: string
  headlineSub: string
  /** The figures that qualify the headline, at a third its weight. */
  side?: GmvSide[]
  /** Daily totals scaled 0..1. Empty renders no chart rather than a flat line at the axis. */
  bars?: number[]
  /** The same window, one period back. Drawn BEHIND at a third the strength, and only when
   *  the caller has a comparison to make — the panel never invents one. */
  barsPrev?: number[]
  /** A second, quieter row under the headline — the figures that qualify the qualifiers.
   *  Kept separate from `side` so the two tiers cannot silently merge into one long row. */
  foot?: GmvSide[]
  /** The caller's own range / compare controls, on the title row. The panel owns no state:
   *  which window it is looking at is the page's decision, not the chart's. */
  controls?: React.ReactNode
  /** A shape beside the figures — the channel fan on the owner's board. It shares the band
   *  rather than sitting in its own card, because "how much" and "where from" are one
   *  question asked twice. */
  aside?: React.ReactNode
  /** `slate` is the owner's band: the app's one dark surface, carrying the one set of
   *  figures nobody else on the floor is allowed to see. */
  tone?: "card" | "slate"
  className?: string
}) {
  const dark = tone === "slate"
  return (
    <SectionCard
      className={cn(className ?? "h-full", dark && "border-transparent bg-sidebar text-sidebar-foreground")}
      title={title}
      actions={controls}
      bodyClassName={cn("flex flex-1 gap-5 p-5", aside ? "flex-col lg:flex-row lg:items-center" : "flex-col")}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="font-title text-4xl font-black leading-none tracking-tight tabular-nums sm:text-5xl">
            {headline}
          </div>
          <div className={cn("mt-1.5 eg-label", dark ? "text-sidebar-foreground/60" : "text-muted-foreground")}>{headlineSub}</div>
        </div>
        {/* NO CAPTION under these, the same rule the tiles follow: "we earned", "per order"
            explained figures their own labels already name. `sub` stays reachable as a title
            attribute and is not drawn. */}
        {side.map((c) => (
          <div key={c.label} title={c.sub}>
            <div className="text-xl font-bold tabular-nums">{c.value}</div>
            <div className={cn("mt-1 eg-label", dark ? "text-sidebar-foreground/60" : "text-muted-foreground")}>{c.label}</div>
          </div>
        ))}
      </div>

      {foot.length > 0 && (
        <div className={cn("flex flex-wrap gap-x-7 gap-y-3 border-t pt-3.5",
          dark ? "border-sidebar-foreground/12" : "border-border")}>
          {foot.map((c) => (
            <div key={c.label} title={c.sub}>
              <div className="text-base font-semibold tabular-nums">{c.value}</div>
              <div className={cn("mt-0.5 eg-label", dark ? "text-sidebar-foreground/60" : "text-muted-foreground")}>{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {bars.length > 0 && (
        <div className="mt-auto flex h-28 items-stretch gap-1" aria-hidden>
          {bars.map((h, i) => (
            <span key={i} className="relative flex-1">
              {/* The comparison sits BEHIND, at a third the strength — a second full-strength
                  series would make the panel a chart to study rather than one to glance at. */}
              {barsPrev && barsPrev[i] !== undefined && (
                <span
                  className={cn("absolute inset-x-0 bottom-0 rounded-t-md",
                    dark ? "bg-brand/30" : "bg-brand/10 dark:bg-brand/25")}
                  style={{ height: `${Math.max(3, barsPrev[i] * 100)}%` }}
                />
              )}
              <span
                /* --brand swaps by mode (violet on paper, lifted on the dark surface). 30% of
                   the dark value over a near-black card lands on a dull olive, so only the dark
                   step moves up — on paper 30% is a bar you read the shape of, and taking it up
                   would make the chart shout over the figures it exists to support. */
                className={cn("absolute inset-x-0 bottom-0 rounded-t-md",
                  dark ? "bg-brand/80" : "bg-brand/30 dark:bg-brand/70")}
                style={{ height: `${Math.max(3, h * 100)}%` }}
              />
            </span>
          ))}
        </div>
      )}
      </div>

      {aside && <div className="w-full shrink-0 lg:w-[240px]">{aside}</div>}
    </SectionCard>
  )
}
