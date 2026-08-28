"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { useLabelT } from "@/lib/i18n"

/**
 * WHERE THE ORDERS CAME FROM.
 *
 * This was a fan of one stroke per order, which read as a dark comb once a single channel
 * took most of the volume — and one channel taking most of the volume is the normal case
 * here. The ring says the same thing quietly: one arc per channel, the total in the middle.
 *
 * THE HARD PART IS THE SMALL CHANNELS, and no proportional form solves it. At 2 orders out
 * of 324 an arc is two degrees — a hairline you cannot point at. So the LEGEND is the
 * interactive surface, not the ring: every channel has a row you can hover or tab to, with
 * its own number, and the ring answers back. Nothing is ever only findable by aiming at it.
 *
 * Proportions are true. A minimum arc length would make 2 and 45 look closer than they are,
 * which is the lie a chart of this shape is most tempted into.
 *
 * Colour is the --chart ramp; each channel also carries a letter, because a ramp implies a
 * rank that channels do not have.
 */

export type ChannelSlice = { name: string; n: number }

const RAMP = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"]

const R = 74
const STROKE = 16
const C = 2 * Math.PI * R
/** Surface gap between touching arcs, in path units — never a stroke. Dropped when a slice
 *  is too small to give it away, or a 0.6% channel would vanish into its own spacing. */
const GAP = 3

export function ChannelRing({
  slices,
  total,
  caption,
  onDark,
  className,
}: {
  /** Biggest first is the caller's business — drawn in the order given, so a channel keeps
   *  its colour when a smaller one drops out of the window entirely. */
  slices: ChannelSlice[]
  total?: number
  caption?: string
  /** On a dark ground the ramp runs the other way: --chart-1 is the darkest step in light
   *  mode, so the biggest channel would be the one you cannot see. */
  onDark?: boolean
  className?: string
}) {
  const tl = useLabelT()
  const [hot, setHot] = useState<string | null>(null)
  const ramp = onDark ? [...RAMP].reverse() : RAMP

  const sum = slices.reduce((a, s) => a + s.n, 0)
  if (sum <= 0) return null
  const shown = total ?? sum

  // Offsets computed from the slices before each one rather than by accumulating into a
  // variable — react-hooks/immutability refuses a reassignment inside render, and with four
  // channels the repeated sum costs nothing.
  const arcs = slices.map((s, i) => ({
    ...s,
    len: (s.n / sum) * C,
    offset: (slices.slice(0, i).reduce((a, x) => a + x.n, 0) / sum) * C,
    colour: ramp[i % ramp.length],
  }))

  const hotSlice = hot ? slices.find((s) => s.name === hot) : null

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="relative">
        <svg viewBox="0 0 200 200" className="block w-full max-w-[184px]" role="img"
          aria-label={slices.map((s) => `${s.name} ${s.n}`).join(", ")}>
          <g transform="rotate(-90 100 100)">
            {arcs.map((a) => {
              // The gap is taken off the arc, not added between them — so the ring always
              // closes and the last slice cannot overrun the first.
              const draw = Math.max(1, a.len - (a.len > GAP * 2 ? GAP : 0))
              return (
                <circle
                  key={a.name}
                  cx={100} cy={100} r={R}
                  fill="none"
                  stroke={a.colour}
                  strokeWidth={STROKE}
                  strokeDasharray={`${draw} ${C - draw}`}
                  strokeDashoffset={-a.offset}
                  opacity={hot && hot !== a.name ? 0.18 : 1}
                  className="transition-opacity"
                />
              )
            })}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-semibold tabular-nums leading-none tracking-tight">
            {hotSlice ? hotSlice.n : shown}
          </div>
          <div className={cn("mt-1 text-2xs", onDark ? "text-sidebar-foreground/60" : "text-muted-foreground")}>
            {hotSlice ? tl("ui", hotSlice.name) : (caption ?? tl("kpi", "orders"))}
          </div>
        </div>
      </div>

      {/* THE LEGEND IS THE CONTROL. A two-degree arc is not a hover target, so every channel
          is reachable here by pointer and by keyboard, with its number always drawn. */}
      <div className="mt-3 grid w-full grid-cols-2 gap-x-3 gap-y-0.5">
        {arcs.map((a) => (
          <button
            key={a.name}
            type="button"
            onPointerEnter={() => setHot(a.name)}
            onPointerLeave={() => setHot(null)}
            onFocus={() => setHot(a.name)}
            onBlur={() => setHot(null)}
            className={cn(
              "eg-tap inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-2xs transition-colors",
              onDark ? "text-sidebar-foreground/60 hover:text-sidebar-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: a.colour }} />
            <span className={cn("font-medium", onDark ? "text-sidebar-foreground" : "text-foreground")}>
              {a.name.charAt(0).toUpperCase()}
            </span>
            <span className="truncate">{tl("ui", a.name)}</span>
            <span className="ml-auto shrink-0 tabular-nums">{a.n}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
