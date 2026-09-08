"use client"

import { useEffect, useRef } from "react"
import { animate, motion, useInView, useMotionValue, useTransform, useReducedMotion } from "motion/react"

/**
 * A FIGURE THAT COUNTS UP ONCE, the first time it is on screen.
 *
 * IT TAKES THE FINISHED STRING, not a number, and that is what makes it droppable anywhere.
 * Every figure on these panels arrives already formatted — "$1,234.56", "2,000", "24h", "—" —
 * by a formatter that knows about currency and locale. Asking each call site for a raw number
 * plus its formatter would mean touching all of them and keeping two things in step; this
 * parses what it is given, animates the digits, and puts the prefix and suffix back.
 *
 * ANYTHING IT CANNOT PARSE IS RENDERED VERBATIM. "—" is the loading state, and a dash that
 * animates to zero would be the app claiming a number it does not have (§4 — unknown is not
 * zero). Same for "Unlimited" or any other word.
 *
 * The digits live in a MotionValue and are drawn by a motion element, so nothing re-renders
 * per frame. Reduced motion gets the ANSWER immediately: the figure is the content, and a
 * person who has asked for less movement still needs to read it.
 */
export function CountUp({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "-40px" })
  const reduced = useReducedMotion()

  // "$1,234.56" -> ["$", "1,234.56", ""]. Locale separators are kept so the output matches
  // exactly what the caller would have rendered.
  const m = /^([^\d-]*)(-?[\d.,]*\d)(.*)$/.exec(text.trim())
  const raw = m ? m[2] : ""
  const target = m ? Number(raw.replace(/,/g, "")) : NaN
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0
  const grouped = raw.includes(",")

  const mv = useMotionValue(0)
  const shown = useTransform(mv, (v) =>
    grouped || decimals
      ? v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : String(Math.round(v)),
  )
  /* NO `done` STATE, deliberately. An earlier version swapped back to the plain string once
     the animation finished, which meant calling setState from an effect — the exact thing
     `react-hooks/set-state-in-effect` forbids (CLAUDE.md §5). It bought nothing: the motion
     span's own text content IS the formatted figure once it has settled, so a copy, a
     screen reader and a screenshot all get the same characters either way. */
  useEffect(() => {
    if (!inView || !Number.isFinite(target)) return
    if (reduced) { mv.set(target); return }
    // Short. This is a figure settling, not a performance — anything longer and a person
    // waiting to read their own revenue is watching a slot machine.
    const controls = animate(mv, target, { duration: 0.9, ease: [0.22, 0.68, 0, 1] })
    return () => controls.stop()
  }, [inView, target, reduced, mv])

  if (!Number.isFinite(target)) return <span className={className}>{text}</span>

  return (
    <span ref={ref} className={className}>
      {m?.[1]}
      {/* Once it has landed, the plain string goes back in — so the DOM ends up holding
          exactly the text the caller passed, which is what a copy/paste or a screen reader
          should get. */}
      <motion.span>{shown}</motion.span>
      {m?.[3]}
    </span>
  )
}
