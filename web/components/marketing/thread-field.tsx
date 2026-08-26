"use client"

import { useId } from "react"
import { useReducedMotion } from "motion/react"

/**
 * THE WOVEN THREAD FIELD — the one graphic in this brand that is not borrowed.
 *
 * WHAT IT IS. Three ribbons crossing, each woven from many fine parallel strands. Thread is
 * what you print with, and three strands converging into one path is literally three
 * storefronts arriving in one queue — so the mark says what the product does rather than
 * decorating around it.
 *
 * WHY THE STRANDS MATTER, and this is the whole design. The reference this comes from
 * (nebius.com) carries its hero on a flowing gradient ribbon, and a flowing gradient ribbon is
 * currently the single most common cliché on an AI infrastructure site — a soft blurred smear
 * that says "technology" and nothing else. Drawing the ribbon as MANY DISCRETE LINES instead
 * of one filled gradient is what turns it from that smear into cloth: you can see it is made
 * of something. A gradient is a mood; a weave is a material, and this company's material is
 * thread. That distinction is the difference between the idea working and it looking generic.
 *
 * HOW IT IS BUILT. Each ribbon is one cubic path, redrawn `STRANDS` times at increasing
 * vertical offsets. Because every strand shares the curve, the band reads as one moving thing;
 * because they are separate strokes with gaps, it reads as woven. Opacity falls off toward the
 * edges of each band so the ribbon has a soft selvedge rather than a hard cut.
 *
 * MOTION. Each ribbon drifts on its own duration — 19s, 23s, 29s, deliberately coprime so the
 * composition never visibly repeats. Only the GROUP transform animates; the paths themselves
 * are static, so this is one composited layer per ribbon and costs nothing on the main thread.
 * The page's rule holds: no element owns the same property from both an entrance animation and
 * this drift, because the drift lives on a wrapper that nothing else touches.
 *
 * REDUCED MOTION removes the animation and leaves the composition — the field is a picture
 * first and an animation second, which is the test for whether ambient motion is decoration.
 */

/** Lines per ribbon. Below ~7 it reads as stripes; above ~14 the gaps close and it is a gradient again. */
const STRANDS = 11
/** Vertical gap between strands, in viewBox units. */
const GAP = 3.4

type Ribbon = { d: string; color: string; opacity: number; dur: number; drift: number }

/**
 * The three paths. Hand-tuned rather than generated: they have to CROSS twice and end at
 * different heights, so the eye reads three separate threads converging rather than one
 * thick band. A random or procedural curve loses exactly that.
 */
const RIBBONS: Ribbon[] = [
  { d: "M-40 168C90 168 150 44 300 44S470 132 620 96", color: "var(--mk-ink)", opacity: 0.5, dur: 23, drift: 10 },
  { d: "M-40 196C110 196 168 76 316 88S470 176 620 140", color: "var(--mk-acid)", opacity: 1, dur: 19, drift: -14 },
  { d: "M-40 132C80 132 140 24 288 20S452 92 620 52", color: "var(--mk-violet)", opacity: 0.42, dur: 29, drift: 7 },
]

export function ThreadField({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion()
  // Ids must be unique per instance: two fields on one page would otherwise share a mask and
  // the second would inherit the first's fade.
  const uid = useId().replace(/[:]/g, "")

  return (
    /* NO POSITION CLASS OF ITS OWN. This root used to carry `relative`, which fought the
       `absolute` the caller passes: both are position utilities at equal specificity, so which
       one won came down to Tailwind's output order rather than to intent — and it lost, so the
       field sat in normal flow and added 417px of blank page above the hero.
       Positioning belongs to whoever places it. */
    <div className={`pointer-events-none overflow-hidden ${className}`} data-eg-thread aria-hidden>
      <svg viewBox="0 0 580 240" fill="none" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        <defs>
          {/* The field bleeds off every edge rather than stopping inside the box — a ribbon
              with visible ends reads as a shape someone drew, not as cloth passing through. */}
          <linearGradient id={`fade-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="white" stopOpacity="0" />
            <stop offset="0.18" stopColor="white" stopOpacity="1" />
            <stop offset="0.82" stopColor="white" stopOpacity="1" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={`mask-${uid}`}>
            <rect x="0" y="0" width="580" height="240" fill={`url(#fade-${uid})`} />
          </mask>
        </defs>

        <g mask={`url(#mask-${uid})`}>
          {RIBBONS.map((r, ri) => (
            <g
              key={ri}
              style={
                reduce
                  ? undefined
                  : {
                      animation: `eg-thread-drift-${ri % 3} ${r.dur}s ease-in-out infinite alternate`,
                      willChange: "transform",
                    }
              }
            >
              {Array.from({ length: STRANDS }, (_, i) => {
                // Fade toward both selvedges so the band has an edge rather than a cut.
                const t = i / (STRANDS - 1)
                const edge = 1 - Math.abs(t - 0.5) * 2
                return (
                  <path
                    key={i}
                    d={r.d}
                    transform={`translate(0 ${(i - (STRANDS - 1) / 2) * GAP})`}
                    stroke={r.color}
                    strokeWidth={0.9}
                    strokeLinecap="round"
                    opacity={r.opacity * (0.25 + edge * 0.75)}
                  />
                )
              })}
            </g>
          ))}
        </g>
      </svg>

      {/* Keyframes live here rather than in globals.css: they are meaningless outside this
          component, and three near-identical drifts in the global sheet is the kind of thing
          that gets copied into a fourth place. */}
      <style>{`
        @keyframes eg-thread-drift-0 { from { transform: translate3d(0,0,0) } to { transform: translate3d(-2%, 10px, 0) } }
        @keyframes eg-thread-drift-1 { from { transform: translate3d(0,0,0) } to { transform: translate3d(2%, -14px, 0) } }
        @keyframes eg-thread-drift-2 { from { transform: translate3d(0,0,0) } to { transform: translate3d(-1%, 7px, 0) } }
        @media (prefers-reduced-motion: reduce) { [data-eg-thread] * { animation: none !important } }
      `}</style>
    </div>
  )
}
