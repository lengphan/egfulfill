"use client"

/**
 * BAND ARRANGEMENTS — every layout in LAYOUTS, drawn with the real `PageBand`, at true
 * height, in both themes. A crop check and a composition check, not a mockup. noindex.
 *
 * Sits beside /lab/decor, which does the same job for the band and tile pairing.
 */

import { useEffect, useState } from "react"
import { PageBand, LAYOUTS, SETS, MOTIONS, FIGURES, DEFAULT_LAYOUT } from "@/components/app/page-band"

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
  /** What the first object's two animated elements are actually doing, sampled live. */
  const [probe, setProbe] = useState<{
    name: string; state: string; x: number; y: number; movedX: number; movedY: number
  } | null>(null)

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

  /*
   * THE PAGE MEASURES ITSELF, because "it is moving" and "it is not" is not a claim either of
   * us should be settling by staring. It reads the two transforms every 400ms and reports the
   * live offsets plus how far they have travelled since this panel mounted.
   *
   * A screenshot cannot answer this: capturing one RESETS css animations, so every still of
   * this band — including the ones in review — is frozen at t=0 and looks like proof that
   * nothing moves.
   */
  useEffect(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    const tick = () => {
      const layer = document.querySelector('[data-motion="swim"]')
      const span = layer?.querySelector<HTMLElement>(".eg-band-swim")
      const img = layer?.querySelector<HTMLElement>(".eg-band-float")
      if (!span || !img) return
      const at = (el: HTMLElement, i: number) => new DOMMatrixReadOnly(getComputedStyle(el).transform)[i === 0 ? "m41" : "m42"]
      const x = at(span, 0), y = at(img, 1)
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      const a = img.getAnimations()[0]
      setProbe({
        name: getComputedStyle(img).animationName,
        state: a?.playState ?? "none",
        x: Math.round(x), y: Math.round(y),
        movedX: Math.round(maxX - minX), movedY: Math.round(maxY - minY),
      })
    }
    const id = window.setInterval(tick, 400)
    return () => window.clearInterval(id)
  }, [])

  if (reduced === null) return null
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
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
      {probe && (
        <p className="tabular-nums text-muted-foreground">
          First object · <span className="font-medium text-foreground">{probe.name}</span> ·{" "}
          <span className="font-medium text-foreground">{probe.state}</span> · now at x{" "}
          <span className="font-medium text-foreground">{probe.x}px</span>, y{" "}
          <span className="font-medium text-foreground">{probe.y}px</span> · travelled{" "}
          <span className="font-medium text-foreground">{probe.movedX}px</span> across and{" "}
          <span className="font-medium text-foreground">{probe.movedY}px</span> down since this panel loaded.
          {probe.movedX + probe.movedY === 0 && " — if these stay at 0, the animation genuinely is not running."}
        </p>
      )}
    </div>
  )
}

const NOTES: Record<string, string> = {
  even: "one size, evenly spaced — the default",
  shelf: "one baseline, sizes vary",
  arc: "a curve lifting off the right edge",
  bunch: "one mass in the corner, overlapping",
  pairs: "a trio and a pair, with air between",
  hero: "one big object, three in orbit",
  scatter: "the first attempt, kept for comparison",
}

const FIGURE_NOTES: Record<string, string> = {
  field: "an array of soft modules, rim-lit, a wave passing through on the diagonal",
  pool: "liquid chrome and lime — one body, merging and pulling apart",
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
        <p className="pt-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Figures — what fills the empty half</p>
        {FIGURES.filter((f) => f !== "objects").map((f) => (
          <div key={f} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              <span className="font-semibold text-foreground">{f}</span> — {FIGURE_NOTES[f]}
            </p>
            <PageBand
              figure={f}
              title="Good afternoon, Linh"
              sub={<><span className="font-medium text-[var(--mk-acid)]">5</span> new today</>}
            />
          </div>
        ))}

        <p className="pt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Motion — same objects, same arrangement</p>
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
