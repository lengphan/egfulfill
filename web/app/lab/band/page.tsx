"use client"

/**
 * BAND ARRANGEMENTS — every layout in LAYOUTS, drawn with the real `PageBand`, at true
 * height, in both themes. A crop check and a composition check, not a mockup. noindex.
 *
 * Sits beside /lab/decor, which does the same job for the band and tile pairing.
 */

import { useEffect, useState } from "react"
import { PageBand, LAYOUTS, SETS, MOTIONS, DEFAULT_LAYOUT } from "@/components/app/page-band"

/**
 * WHY THIS BANNER EXISTS: "no motion is showing" and "this machine has asked for no motion"
 * look exactly the same from the outside, and every one of these animations is switched off
 * by prefers-reduced-motion on purpose. So the lab says which of the two it is, out loud, and
 * offers the override — because being told the setting is on is not as convincing as watching
 * the objects start moving when you turn it off.
 */
function MotionState() {
  const [reduced, setReduced] = useState<boolean | null>(null)
  const [forced, setForced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const read = () => setReduced(mq.matches)
    const id = setTimeout(read, 0)
    mq.addEventListener("change", read)
    return () => { clearTimeout(id); mq.removeEventListener("change", read) }
  }, [])

  useEffect(() => {
    const el = document.documentElement
    if (forced) el.setAttribute("data-force-motion", "1")
    else el.removeAttribute("data-force-motion")
    return () => el.removeAttribute("data-force-motion")
  }, [forced])

  if (reduced === null) return null
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <span>
        This browser reports{" "}
        <span className="font-semibold">prefers-reduced-motion: {reduced ? "reduce" : "no-preference"}</span>
      </span>
      {reduced && (
        <>
          <span className="text-muted-foreground">
            — every animation below is switched off for it, which is the intended behaviour.
            macOS: System Settings › Accessibility › Display › Reduce motion.
          </span>
          <label className="flex cursor-pointer items-center gap-2 font-medium">
            <input type="checkbox" checked={forced} onChange={(e) => setForced(e.target.checked)} />
            Show me the motion anyway
          </label>
        </>
      )}
    </div>
  )
}

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
      <div className="space-y-3 px-6 py-4">
        <p className="text-sm font-semibold">Band motion, sets and arrangements — the real component, at real width</p>
        <MotionState />
      </div>
      <Column dark={false} />
      <Column dark />
    </div>
  )
}
