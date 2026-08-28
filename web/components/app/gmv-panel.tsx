"use client"

import { SectionCard } from "@/components/app/section-card"

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
  bars = [],
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
  className?: string
}) {
  return (
    <SectionCard
      className={className ?? "h-full"}
      title={title}
      bodyClassName="flex flex-1 flex-col gap-5 p-5"
    >
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="font-title text-4xl font-black leading-none tracking-tight tabular-nums sm:text-5xl">
            {headline}
          </div>
          <div className="mt-1.5 eg-label text-muted-foreground">{headlineSub}</div>
        </div>
        {/* NO CAPTION under these, the same rule the tiles follow: "we earned", "per order"
            explained figures their own labels already name. `sub` stays reachable as a title
            attribute and is not drawn. */}
        {side.map((c) => (
          <div key={c.label} title={c.sub}>
            <div className="text-xl font-bold tabular-nums">{c.value}</div>
            <div className="mt-1 eg-label text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>

      {bars.length > 0 && (
        <div className="mt-auto flex h-28 items-end gap-1" aria-hidden>
          {bars.map((h, i) => (
            <span
              key={i}
              /* --brand swaps by mode (violet on paper, lifted on the dark surface). 30% of
                 the dark value over a near-black card lands on a dull olive, so only the dark
                 step moves up — on paper 30% is a bar you read the shape of, and taking it up
                 would make the chart shout over the figures it exists to support. */
              className="flex-1 rounded-t-md bg-brand/30 dark:bg-brand/70"
              style={{ height: `${Math.max(3, h * 100)}%` }}
            />
          ))}
        </div>
      )}
    </SectionCard>
  )
}
