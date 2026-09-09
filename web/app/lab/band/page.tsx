"use client"

/**
 * BAND ARRANGEMENTS — every layout in LAYOUTS, drawn with the real `PageBand`, at true
 * height, in both themes. A crop check and a composition check, not a mockup. noindex.
 *
 * Sits beside /lab/decor, which does the same job for the band and tile pairing.
 */

import { PageBand, LAYOUTS, SETS, MOTIONS, DEFAULT_LAYOUT } from "@/components/app/page-band"

const NOTES: Record<string, string> = {
  shelf: "one baseline, sizes vary",
  arc: "a curve lifting off the right edge",
  bunch: "one mass in the corner, overlapping",
  pairs: "a trio and a pair, with air between",
  hero: "one big object, three in orbit",
  scatter: "what shipped first",
}

const MOTION_NOTES: Record<string, string> = {
  swim: "two axes on unequal clocks — suspended in water, never repeats",
  bob: "one axis, in place, out of phase",
  orbit: "a true circle; the object counter-rotates so it never tips",
  sway: "a pendulum hung from the top edge, like a garment on a rail",
  breathe: "inflating and letting go — no travel at all",
}

const SET_NOTES: Record<string, string> = {
  shapes: "six abstract forms, nothing repeated",
  garments: "what we make, inflated — tee, cap, beanie, shorts, varsity, hoodie",
  mixed: "a garment and an abstract, alternating",
  blanks: "real blanks, photographed and cut off the seamless",
}

function Column({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-full space-y-5 bg-background px-6 py-6 text-foreground">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {dark ? "Dark" : "Light"}
        </p>
        <p className="pt-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Motion — same objects, same arrangement</p>
        {MOTIONS.map((m) => (
          <div key={m} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              <span className="font-semibold text-foreground">{m}</span> — {MOTION_NOTES[m]}
            </p>
            <PageBand
              motionStyle={m}
              title="Good afternoon, Linh"
              sub={<><span className="font-medium text-[var(--mk-acid)]">5</span> new today</>}
            />
          </div>
        ))}

        <p className="pt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Sets — in the default arrangement</p>
        {Object.keys(SETS).map((key) => (
          <div key={key} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              <span className="font-semibold text-foreground">{key}</span> — {SET_NOTES[key]}
            </p>
            <PageBand
              set={key}
              layout={DEFAULT_LAYOUT}
              title="Good afternoon, Linh"
              sub={<><span className="font-medium text-[var(--mk-acid)]">5</span> new today</>}
            />
          </div>
        ))}

        <p className="pt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Arrangements — with the default set</p>
        {Object.keys(LAYOUTS).map((key) => (
          <div key={key} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              <span className="font-semibold text-foreground">{key}</span> — {NOTES[key]}
            </p>
            <PageBand
              layout={key}
              title="Good afternoon, Linh"
              sub={<><span className="font-medium text-[var(--mk-acid)]">5</span> new today</>}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function BandLayoutLab() {
  return (
    <div className="min-h-svh">
      {/* ONE COLUMN, FULL WIDTH. Side-by-side themes halved the band, and the band's objects
          are sized off its HEIGHT while their positions are percentages of its WIDTH — so a
          628px band crowded them into each other and a 1150px one spread them out. Comparing
          a layout at the wrong width is comparing the wrong layout. */}
      <p className="px-6 py-4 text-sm font-semibold">Band motion, sets and arrangements — the real component, at real width</p>
      <Column dark={false} />
      <Column dark />
    </div>
  )
}
