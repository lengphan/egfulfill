"use client"

import { useRef, type ReactNode } from "react"
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react"

/**
 * THE TRANSITION EVERY FILL BAND SHARES — a deck of cards passing the viewport.
 *
 * WHAT IT REPLACES. Every band entered with `rise(0)`: fade up 56px, `once: true`, done. That
 * is an ARRIVAL, not a transition — it happens to a band on its way in and nothing happens on
 * its way out, so the page had five identical entrances and no relationship between one band
 * and the next. Scroll back up and nothing returns, because `once` detaches the observer
 * after the first crossing (owner: "scroll down to reveal, scroll back up to roll back").
 *
 * WHAT IT IS. The page is a stack of rounded fills on a ground, so the honest transition is
 * the one that grammar already implies: a card comes UP out of the ground, settles flush, and
 * recedes as the next one rises over it. Fully scroll-LINKED, so it is symmetric — every
 * pixel of scroll up undoes exactly the pixel of scroll down that made it.
 *
 * THIS DOES NOT CONTRADICT THE PAGE'S TRIGGERED DEFAULT (2026-09-04: reveals, not scrubbing).
 * That preference is about VIDEO — a decoder in the render loop stalls, and a scrubbed frame
 * is only correct at one offset, so prose can be missed entirely. The caveat stated with it
 * is this exact case: scroll-linked is fine when it drives CSS only, because nothing can
 * stall. Nothing here withholds a word — the type inside the band is always at full opacity
 * and always readable, at any scroll position, including the two extremes.
 *
 * WHAT IT DELIBERATELY DOES NOT ANIMATE: opacity. These bands are saturated fills, and a fill
 * at 60% over the page ground is not a dimmer version of itself — it is a different colour. It
 * reads as a rendering fault rather than as depth. Scale and radius carry the recede instead.
 *
 * ONE ELEMENT, ONE OWNER. This REPLACES `rise(0)` on the band it wraps; it never sits beside
 * it. An entrance animation and a scroll MotionValue writing the same property fight, and the
 * element simply never appears — §4 records that, and it is the one way to get this wrong.
 */

/** Where the band sits in its own crossing: 0 = about to enter, 1 = fully gone. */
const ENTER = 0.16
const EXIT = 0.84

export function Band({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const still = useReducedMotion() ?? false

  /* THE WHOLE CROSSING, bottom edge entering to top edge leaving — so the rest position in
     the middle is genuinely still, and a band taller than the viewport is at rest for most
     of the time it is being read. */
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] })

  /**
   * SPRUNG, for the same reason the steps' pipe is: a wheel or trackpad delivers scroll in
   * discrete jumps, so a transform read straight off the progress steps with them. Springing
   * the derived number smooths it without taking the page's scrolling away from the browser.
   * `restDelta` is small because the whole range is 0→1.
   */
  const p = useSpring(scrollYProgress, { stiffness: 80, damping: 26, restDelta: 0.0005 })

  /* COMES UP OUT OF THE GROUND, settles, and recedes as the next one rises over it. The exit
     travels less than the entrance: a band leaving is context, a band arriving is the subject. */
  const y = useTransform(p, [0, ENTER, EXIT, 1], [56, 0, 0, -28])
  /* SMALL. 0.955 is about 60px of width on a 1400px band — enough to read as depth, little
     enough that the type inside is never noticeably resampled, and it is exactly 1 at rest so
     what you read is never a scaled bitmap. */
  const scale = useTransform(p, [0, ENTER, EXIT, 1], [0.955, 1, 1, 0.972])
  /* THE RADIUS OPENS AND CLOSES WITH IT. A card further away is a rounder card; it is the
     cheapest depth cue on the page and it costs no legibility at all. 32px is the resting
     value every band already had. */
  const radius = useTransform(p, [0, ENTER, EXIT, 1], [56, 32, 32, 44])

  return (
    <motion.div
      ref={ref}
      /* `will-change` is deliberately NOT set. On a 1400×950 saturated fill it promotes a
         ~5MB layer per band and five of them are resident at once; the transform is cheap and
         the compositor handles it without the hint. */
      style={still ? undefined : { y, scale, borderRadius: radius }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
