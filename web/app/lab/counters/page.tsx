"use client"

/**
 * FIGURE MOTION — three treatments of the same numbers, side by side. LAB PAGE. noindex.
 *
 * WHAT IS ON THE PAGE TODAY: `Num` counts each figure up once, over 1.4s, the first time it
 * scrolls into view. It is fine and it is invisible — by the time your eye reaches the second
 * figure the first has finished, and scrolling back up does nothing at all.
 *
 * THE ASK: a flip-book / desk-calendar motion, driven by scroll, that rolls BACK when you
 * scroll back up. All three below are scroll-LINKED for that reason: the figure is a pure
 * function of how far the band has crossed the viewport, so up undoes down exactly.
 *
 * WHY NOT A METER, which was the first idea: a meter needs a denominator. "3 marketplaces",
 * "7 print methods", "48hrs" have none, and a bar filling toward nothing is decoration
 * pretending to be a measurement. A counter is the right instrument for a magnitude.
 *
 * THE ONE THING THAT MATTERS MORE THAN WHICH: whatever is chosen, it makes the figure the
 * loudest thing in its column. The live stored figures are "2.4M+ orders shipped" and "99.2%
 * on-time fulfillment" — the two that were taken OUT of the defaults because nothing measures
 * them, and that a marketplace reviewing us for API access reads as a policy problem. The set
 * shown here is the sourceable one from DEFAULT_SITE_CONTENT.
 */

import { useRef } from "react"
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react"
import { DEFAULT_SITE_CONTENT as C } from "@/lib/site-content"

/** "2.4M+" → ["", "2.4", "M+"]. The same split `Num` makes: only the digits move. */
function parts(v: string): [string, string, string] {
  const m = /^(\D*)([\d,.]+)(.*)$/.exec(v.trim())
  return m ? [m[1], m[2], m[3]] : ["", "", v]
}

/* ── 1 · ODOMETER. Each digit is a strip of 0-9 that slides. Continuous, so it is reversible
      by construction and never shows a half-formed glyph. The closest thing to a mileage
      counter, and the most legible of the three at speed. */
function Odometer({ text, p }: { text: string; p: MotionValue<number> }) {
  return (
    <span className="inline-flex tabular-nums">
      {text.split("").map((ch, i) =>
        /\d/.test(ch)
          ? <Reel key={i} to={Number(ch)} p={p} delay={i * 0.06} />
          : <span key={i}>{ch}</span>,
      )}
    </span>
  )
}

function Reel({ to, p, delay }: { to: number; p: MotionValue<number>; delay: number }) {
  /* Each digit starts a little after the one to its left, so the number settles left to right
     rather than snapping as a block — which is what a real reel does. */
  const t = useTransform(p, [delay, Math.min(1, delay + 0.55)], [0, 1], { clamp: true })
  const y = useTransform(t, (v) => `${-(v * to * 100) / 10}%`)
  return (
    <span className="inline-block h-[1em] overflow-hidden align-bottom" style={{ lineHeight: 1 }}>
      <motion.span className="flex flex-col" style={{ y }}>
        {Array.from({ length: 10 }, (_, d) => (
          <span key={d} className="h-[1em] leading-none">{d}</span>
        ))}
      </motion.span>
    </span>
  )
}

/* ── 2 · FLIP CALENDAR. The whole figure hinges at its middle and the top half falls forward,
      the way a desk calendar page does. One flap per figure rather than per digit: seven
      flapping digits is an airport board, which is a different, busier idea. */
function Flip({ text, p }: { text: string; p: MotionValue<number> }) {
  /* -100deg, not -180: past 90 the face is edge-on and the rest is a blank card turning. The
     number is readable for the whole first half and gone for the second, which is the flip. */
  const rx = useTransform(p, [0, 0.55], [-100, 0], { clamp: true })
  const o = useTransform(p, [0, 0.25, 0.55], [0, 0.4, 1], { clamp: true })
  return (
    <span className="inline-block [perspective:600px]">
      <motion.span className="inline-block origin-top tabular-nums" style={{ rotateX: rx, opacity: o }}>
        {text}
      </motion.span>
    </span>
  )
}

/* ── 3 · ROLL. The figure arrives from underneath its own line, as if a card were being dealt
      into the slot. No perspective and no per-digit work: the cheapest of the three, and the
      one that survives a small screen best. */
function Roll({ text, p }: { text: string; p: MotionValue<number> }) {
  const y = useTransform(p, [0, 0.6], ["100%", "0%"], { clamp: true })
  const o = useTransform(p, [0, 0.3], [0, 1], { clamp: true })
  return (
    <span className="inline-block overflow-hidden align-bottom" style={{ lineHeight: 1 }}>
      <motion.span className="inline-block tabular-nums" style={{ y, opacity: o }}>{text}</motion.span>
    </span>
  )
}

function Row({ title, note, kind }: { title: string; note: string; kind: "odo" | "flip" | "roll" }) {
  const ref = useRef<HTMLDivElement>(null)
  const still = useReducedMotion() ?? false
  /* THE BAND'S OWN CROSSING drives it. `start end` → the figures are at zero before the row
     is on screen; `center center` → they are complete by the time the row is the thing you
     are looking at, rather than finishing as it leaves. */
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] })
  const p = useSpring(scrollYProgress, { stiffness: 70, damping: 24, restDelta: 0.0005 })

  return (
    <div ref={ref} className="border-t border-ploy-ink/15 py-16">
      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ploy-ink/50">{title}</p>
      <p className="mt-2 max-w-[42rem] text-[15px] text-ploy-ink/60">{note}</p>
      <div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-5">
        {C.stats.map((f) => {
          const [pre, digits, suf] = parts(f.value)
          return (
            <div key={f.label}>
              <p className="ploy-display text-[clamp(2.2rem,4vw,3.5rem)] leading-[0.9]">
                {pre}
                {still || !digits ? <span className="tabular-nums">{digits || f.value}</span>
                  : kind === "odo" ? <Odometer text={digits} p={p} />
                  : kind === "flip" ? <Flip text={digits} p={p} />
                  : <Roll text={digits} p={p} />}
                {suf}
              </p>
              <p className="mt-2 text-[14px] font-semibold">{f.label}</p>
              {/* THE NOTE, which the live section drops. It is stored, it is written, and it
                  is what turns a row of digits into a spec sheet rather than five
                  unexplained numbers — the reason the field exists. */}
              <p className="mt-1 max-w-[14rem] text-[13px] leading-snug text-ploy-ink/60">{f.note}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Counters() {
  return (
    <div data-skin="balloon" className="min-h-svh bg-ploy-ground text-ploy-ink">
      <div className="mx-auto w-full max-w-[1480px] px-6 py-24 md:px-10">
        <h1 className="ploy-display max-w-[16ch] text-[clamp(2.5rem,6vw,5rem)] leading-[0.88]">Figure motion.</h1>
        <p className="mt-6 max-w-[40rem] text-[17px] leading-snug text-ploy-ink/70">
          Scroll down to run each one, and back up to roll it back. All three are scroll-linked,
          so up undoes down exactly. Turn on reduced motion and every figure is simply its answer.
        </p>
        {/* A screen of ground before the first row, so nothing has started when the page loads
            and the first scroll is what runs it. */}
        <div className="h-[70svh]" />
        <Row kind="odo" title="1 · Odometer"
             note="Each digit is a reel of 0-9 that slides, starting a little after the one to its left. Continuous, so it can never show a half-formed glyph, and the most legible of the three when someone scrolls fast." />
        <div className="h-[50svh]" />
        <Row kind="flip" title="2 · Flip calendar"
             note="The figure hinges at its top edge and falls into place, the way a desk calendar page does. One flap per figure rather than per digit — seven flapping digits is an airport board, which is a busier idea than this page wants." />
        <div className="h-[50svh]" />
        <Row kind="roll" title="3 · Roll"
             note="The figure arrives from under its own line, as if dealt into the slot. No perspective and no per-digit work: the cheapest of the three and the one that survives a phone best." />
        <div className="h-[70svh]" />
      </div>
    </div>
  )
}
