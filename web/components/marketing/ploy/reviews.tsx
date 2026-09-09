"use client"

import { useRef } from "react"
import Image from "next/image"
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react"
import { pop, reveal, rise } from "./motion"
import { GUTTER, SECTION } from "./rhythm"
import type { Testimonial } from "@/lib/site-content"

/**
 * REVIEWS — no photos, no star ratings, no scroll-pinning. Cards on a block.
 *
 * IT RENDERS NOTHING WHEN THERE ARE NO TESTIMONIALS, and that is deliberate rather than
 * defensive. The three that used to ship here were written, not collected; attributed quotes
 * from people who do not exist are the easiest thing for a marketplace reviewer to catch.
 * The stored list is empty, so this section is absent until a real seller gives us one — an
 * empty block with a heading over it would be worse than no block (§4).
 */
/**
 * ONE CARD, DRIFTING AT ITS OWN RATE.
 *
 * The cards arrived with a staggered fade and then stopped dead, which on this page is what
 * made them read as pasted on: everything around them is scroll-LINKED — the pipe fills, the
 * lead inks in word by word, the mound falls — so three rectangles that finish their animation
 * and never move again are the only static thing on the page.
 *
 * So each one travels a little as the section passes, and at a different rate: the row shears
 * gently rather than sliding as a block, which is what stops it reading as one image on a
 * conveyor. The amounts are small on purpose — 26px at the extremes. A card carrying a quote
 * is something you READ, and copy that moves while your eye is on it is copy you re-read.
 *
 * Linked, not played: scrolling back up returns them along the same path.
 */
function Card({ t, i, progress }: { t: Testimonial; i: number; progress: MotionValue<number> }) {
  const still = useReducedMotion() ?? false
  /* Alternating direction by index, so neighbours never travel together. */
  const dir = i % 2 === 0 ? 1 : -1
  const y = useTransform(progress, [0, 1], [26 * dir, -26 * dir])
  return (
    <motion.figure
      {...reveal(0.1 + i * 0.05)}
      style={still ? undefined : { y }}
      className="flex flex-col justify-between rounded-2xl bg-ploy-paper p-6"
    >
      <blockquote className="text-[16px] leading-relaxed text-ploy-ink/85">&ldquo;{t.quote}&rdquo;</blockquote>
      <figcaption className="mt-6 text-[14px]">
        <span className="font-semibold">{t.name}</span>
        <span className="text-ploy-ink/55"> · {t.role}</span>
      </figcaption>
    </motion.figure>
  )
}

export function PloyReviews({ heading, items }: { heading: string; items: Testimonial[] }) {
  const ref = useRef<HTMLElement>(null)
  /* The whole crossing, so the drift is spent by the time the block leaves. */
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] })
  /* Sprung for the same reason the mound is: a wheel arrives in jumps, and cards stepping with
     them stutter. Hooks run before the early return — a conditional hook is not a hook. */
  const progress = useSpring(scrollYProgress, { stiffness: 45, damping: 26, restDelta: 0.0005 })
  if (!items.length) return null

  return (
    <section ref={ref} className={`${GUTTER} ${SECTION}`}>
      <motion.div {...rise(0)} className="relative overflow-hidden rounded-[32px] bg-ploy-peri px-8 py-16 md:px-14 md:py-20">
        <div className="flex items-start justify-between gap-6">
          <h2 className="ploy-display max-w-[14ch] text-[clamp(2.25rem,5.5vw,4.5rem)] text-ploy-ink">
            <motion.span {...reveal(0)} className="block">
              {heading}
            </motion.span>
          </h2>
          <motion.span {...pop(0.2)} className="hidden shrink-0 md:block">
            <Image src="/ploy/obj-green.webp" alt="" width={200} height={204} unoptimized className="h-auto w-[clamp(90px,9vw,150px)]" />
          </motion.span>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((t, i) => (
            <Card key={t.quote} t={t} i={i} progress={progress} />
          ))}
        </div>
      </motion.div>
    </section>
  )
}
