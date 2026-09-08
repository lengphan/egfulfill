"use client"

import { useEffect, useRef } from "react"
import { animate, motion, useInView, useMotionValue, useTransform } from "motion/react"

/**
 * A figure that counts up ONCE, the first time it scrolls into view.
 *
 * The digits live in a MotionValue and are rendered by a motion element, so no React state
 * is written from the effect and nothing re-renders per frame. That is also what keeps it
 * clear of §2.8: the effect depends on `inView` (which `once: true` latches) and on the
 * target, and it writes neither.
 *
 * Prefix and suffix are static, outside the animated span, so the width never jumps while
 * the digits move.
 */
export function Num({
  value,
  prefix = "",
  suffix = "",
  className = "",
}: {
  value: number
  prefix?: string
  suffix?: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "-40px" })
  const raw = useMotionValue(0)
  const text = useTransform(raw, (v) => String(Math.round(v)))

  useEffect(() => {
    if (!inView) return
    // Reduced motion gets the ANSWER, not a frozen zero — the figure is the content.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      raw.set(value)
      return
    }
    const controls = animate(raw, value, { duration: 1.4, ease: [0.22, 0.68, 0, 1] })
    return () => controls.stop()
  }, [inView, value, raw])

  return (
    <span ref={ref} className={"tabular-nums " + className}>
      {prefix}
      <motion.span>{text}</motion.span>
      {suffix}
    </span>
  )
}
