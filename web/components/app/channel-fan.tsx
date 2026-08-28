"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { useLabelT } from "@/lib/i18n"

/**
 * WHERE THE ORDERS CAME FROM — as a fan of strokes, not a donut.
 *
 * A donut draws four arcs for four numbers: a shape laid OVER the data. This draws one
 * stroke per order, so the arc length IS the share rather than a picture of it, and the
 * sweep across it is a gradient that means something. It is also the only place on these
 * pages where the chart ramp gets to be the largest thing on screen.
 *
 * THE STROKE COUNT IS CAPPED — see MAX_STROKES. Past it the strokes merge into a solid band,
 * which is a donut again, and this app has accounts with 989 orders sitting at Draft, so
 * "one stroke per order" would be a wall. Above the cap they are proportional rather than
 * literal and the caption says so, because a chart that quietly stops meaning what it
 * claimed is worse than one that admits its own limit.
 *
 * Colour comes from --chart-1..4, the slate→periwinkle ramp. A ramp implies an order that
 * channels do not have, so each one also carries a LETTER in the legend: the hue is a
 * grouping, never the identity.
 */

export type ChannelSlice = { name: string; n: number }

const RAMP = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"]
/* Few enough that a stroke still reads AS a stroke.
 *
 * At 140 in this width the arc is ~2 units between strokes against a 3-unit stroke, so they
 * overlap into a solid band — which is a donut, the thing this exists not to be. 72 keeps a
 * visible gap and loses nothing real: above the cap the strokes are proportional either way,
 * so the only thing a higher number bought was a false impression of being literal. */
const MAX_STROKES = 72

export function ChannelFan({
  slices,
  total,
  caption,
  className,
}: {
  /** Biggest first is the caller's business — this draws them in the order given, so a
   *  channel keeps its colour when another disappears from the data. */
  slices: ChannelSlice[]
  /** The figure in the middle. Defaults to the sum, but a caller reading a windowed count
   *  off the server should pass its own rather than let this re-add it. */
  total?: number
  caption?: string
  className?: string
}) {
  const tl = useLabelT()
  const [hot, setHot] = useState<string | null>(null)

  const sum = slices.reduce((a, s) => a + s.n, 0)
  const shown = total ?? sum
  const capped = sum > MAX_STROKES

  const strokes = useMemo(() => {
    if (sum <= 0) return []
    // Proportional above the cap, literal below it. Math.round can drift a stroke or two
    // off the total; that is fine for a shape and never restated as a count.
    const out: { name: string; i: number }[] = []
    const budget = Math.min(sum, MAX_STROKES)
    slices.forEach((s) => {
      const n = Math.max(s.n > 0 ? 1 : 0, Math.round((s.n / sum) * budget))
      for (let k = 0; k < n; k++) out.push({ name: s.name, i: out.length })
    })
    return out
  }, [slices, sum])

  if (sum <= 0) return null

  const CX = 150, CY = 138, R0 = 62, R1 = 116
  const colourOf = (name: string) => RAMP[slices.findIndex((s) => s.name === name) % RAMP.length]

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="relative">
        <svg viewBox="0 0 300 152" className="block w-full" role="img"
          aria-label={slices.map((s) => `${s.name} ${s.n}`).join(", ")}>
          {strokes.map((st, i) => {
            const t = (i + 0.5) / strokes.length
            const a = Math.PI - t * Math.PI
            const dim = hot !== null && hot !== st.name
            return (
              <line
                key={i}
                x1={(CX + Math.cos(a) * R0).toFixed(2)} y1={(CY - Math.sin(a) * R0).toFixed(2)}
                x2={(CX + Math.cos(a) * R1).toFixed(2)} y2={(CY - Math.sin(a) * R1).toFixed(2)}
                stroke={colourOf(st.name)} strokeWidth={3} strokeLinecap="round"
                opacity={dim ? 0.16 : 1}
                className="transition-opacity"
              />
            )
          })}
        </svg>
        {/* The figure sits in the arc's own well, so the fan reads as a gauge around it
            rather than as a decoration beside a number. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-1 text-center">
          <div className="text-3xl font-semibold tabular-nums leading-none tracking-tight">
            {hot ? (slices.find((s) => s.name === hot)?.n ?? shown) : shown}
          </div>
          <div className="mt-1 text-2xs text-muted-foreground">
            {hot ?? caption ?? tl("kpi", "orders")}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {slices.map((s, i) => (
          <button
            key={s.name}
            type="button"
            onPointerEnter={() => setHot(s.name)}
            onPointerLeave={() => setHot(null)}
            onFocus={() => setHot(s.name)}
            onBlur={() => setHot(null)}
            className="eg-tap inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: RAMP[i % RAMP.length] }} />
            {/* The letter, because a ramp on its own implies a rank channels do not have. */}
            <span className="font-medium tabular-nums text-foreground">{s.name.charAt(0).toUpperCase()}</span>
            {tl("ui", s.name)}
            <span className="tabular-nums">{s.n}</span>
          </button>
        ))}
      </div>

      {capped && (
        <p className="mt-1.5 text-2xs text-muted-foreground/70">
          {tl("kpi", "Shares, not one stroke per order")}
        </p>
      )}
    </div>
  )
}
