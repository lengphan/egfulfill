"use client"

import { useRef } from "react"
import Image from "next/image"
import Link from "next/link"
import { motion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react"
import { HOVER, pop, reveal, rise } from "./motion"
import { Straddle } from "./straddle"
import { displayWord } from "./step-word"
import { FACTORY_STAGES } from "@/lib/factory-status"
import type { Step } from "@/lib/site-content"

/**
 * HOW IT WORKS — the four steps told as a scroll, then what actually happens to one order.
 *
 * THE STAGES AT THE BOTTOM ARE THE FLOOR'S OWN. `FACTORY_STAGES` is the list the production
 * board writes and the order gate walks, mirrored from `PIPELINE` in
 * server/src/routes/orders.js. Retyping a friendlier version here would put a vocabulary on
 * the marketing site that nothing in the product uses — and the first time a stage is added
 * the two would disagree with nobody noticing. What a visitor sees named here is what a
 * seller will see on their own order.
 */

function StoryStep({
  i,
  total,
  step,
  progress,
}: {
  i: number
  total: number
  step: Step
  progress: MotionValue<number>
}) {
  const at = (i + 0.5) / total
  const lit = useTransform(progress, [at - 0.05, at], [0, 1])
  const bg = useTransform(lit, [0, 1], ["var(--color-ploy-ground)", "var(--color-ploy-ink)"])
  const fg = useTransform(lit, [0, 1], ["var(--color-ploy-ink)", "var(--color-ploy-ground)"])
  const opacity = useTransform(progress, [at - 0.2, at - 0.02], [0.3, 1])

  return (
    <motion.li style={{ opacity }} className="grid grid-cols-[44px_1fr] gap-x-5 py-10 md:gap-x-10 md:py-14">
      <motion.span
        style={{ backgroundColor: bg, color: fg }}
        className="relative z-10 flex h-11 w-11 items-center justify-center self-start rounded-full border-2 border-ploy-ink text-[13px] font-semibold tabular-nums"
      >
        {step.n || String(i + 1).padStart(2, "0")}
      </motion.span>
      <div>
        <h3 className="ploy-display text-[clamp(2rem,5vw,3.6rem)]">{displayWord(step)}</h3>
        <p className="mt-3 max-w-xl text-[19px] font-semibold leading-tight">{step.title}</p>
        <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-ploy-ink/65">{step.body}</p>
      </div>
    </motion.li>
  )
}

export function PloyHow({
  headline,
  accent,
  lead,
  steps,
}: {
  headline: string
  accent: string
  lead: string
  steps: Step[]
}) {
  const list = useRef<HTMLOListElement>(null)
  const { scrollYProgress } = useScroll({ target: list, offset: ["start 78%", "end 62%"] })
  /**
   * THE PIPE IS SPRUNG, and this is what the prototype was getting from Lenis.
   *
   * A native wheel or trackpad scroll arrives in DISCRETE JUMPS, so a MotionValue read
   * straight off `scrollYProgress` steps with them — the fill and the nodes lighting looked
   * punchy next to the prototype, which runs a smooth-scroll library that interpolates the
   * page's scroll position before anything reads it.
   *
   * Springing the VALUE gets the same smoothness without the library, and it is the better
   * trade here: Lenis takes over the page's scrolling for every visitor and every route,
   * fights Next's scroll restoration, and has to be undone for anyone who wants their own
   * scrolling back. This smooths one derived number and touches nothing else — the page still
   * scrolls exactly as the browser says it does.
   *
   * `restDelta` is small because the value's whole range is 0→1; the default would settle
   * visibly early and leave the last node unlit at the bottom of the block.
   */
  const progress = useSpring(scrollYProgress, { stiffness: 90, damping: 26, restDelta: 0.0005 })

  return (
    <div className="bg-ploy-ground text-ploy-ink">
      <section className="px-6 pt-24 md:px-8 md:pt-28">
        <h1 className="ploy-display text-[clamp(2.6rem,7vw,6rem)]">
          <motion.span {...reveal(0)} className="block">{headline}</motion.span>
          <motion.span {...reveal(0.1)} className="flex items-center gap-3">
            <span>{accent}</span>
            <motion.span {...pop(0.25)} className="inline-block">
              <Image src="/ploy/obj-star.webp" alt="" width={140} height={134} unoptimized className="h-[0.8em] w-auto" />
            </motion.span>
          </motion.span>
        </h1>
        <motion.p {...reveal(0.2)} className="mt-6 max-w-lg text-[17px] leading-relaxed text-ploy-ink/70">
          {lead}
        </motion.p>
      </section>

      {/* ── THE FOUR STEPS, TOLD AS A SCROLL ───────────────────────────────── */}
      <section className="relative px-6 pt-16 md:px-8 md:pt-20">
        <div className="relative">
          {/* The rule runs the height of the list and fills as it passes. Same device as the
              home page's pipe; here it is the page's spine rather than one block's. */}
          <div className="absolute bottom-0 left-[21px] top-0 w-0.5 bg-ploy-ink/12">
            <motion.div style={{ scaleY: progress }} className="h-full w-full origin-top bg-ploy-ink" />
          </div>
          <ol ref={list}>
            {steps.map((s, i) => (
              <StoryStep key={s.n || i} i={i} total={steps.length} step={s} progress={progress} />
            ))}
          </ol>
        </div>
      </section>

      {/* ── WHAT HAPPENS TO ONE ORDER ──────────────────────────────────────── */}
      <section className="relative px-6 pt-16 md:px-8 md:pt-24">
        <motion.div {...rise(0)} className="overflow-hidden rounded-[32px] bg-ploy-sky px-8 py-16 md:px-14 md:py-20">
          <h2 className="ploy-display max-w-[18ch] text-[clamp(2rem,5vw,4rem)]">
            <motion.span {...reveal(0)} className="block">Then one order moves.</motion.span>
          </h2>
          <motion.p {...reveal(0.1)} className="mt-5 max-w-xl text-[17px] leading-relaxed text-ploy-ink/70">
            These are the stages our factory actually writes — the same words a seller sees on
            their own order, not a friendlier set invented for this page.
          </motion.p>

          <ol className="mt-12 flex flex-wrap gap-2">
            {FACTORY_STAGES.map((s, i) => (
              <motion.li
                key={s.id}
                {...reveal(0.04 * i)}
                className="flex items-center gap-2 rounded-full bg-ploy-paper px-4 py-2 text-[14px] font-medium"
              >
                <span className="text-[12px] tabular-nums text-ploy-ink/40">{String(i + 1).padStart(2, "0")}</span>
                {s.label}
              </motion.li>
            ))}
          </ol>

          <motion.div {...reveal(0.2)} className="mt-10 flex flex-wrap items-center gap-3">
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link href="/signup" className="inline-block rounded-full bg-ploy-ink px-7 py-3 text-[15px] font-medium text-ploy-ground">
                Start free
              </Link>
            </motion.div>
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link href="/catalog" className="inline-block rounded-full border border-ploy-ink/30 px-7 py-3 text-[15px] font-medium text-ploy-ink">
                See what we make
              </Link>
            </motion.div>
          </motion.div>
        </motion.div>
        <Straddle src="/ploy/obj-chrome.webp" side="left" inset="8%" width="clamp(110px,10vw,160px)" drop={50} drift={[-10, 6]} dur={7.5} />
      </section>

      <div className="h-16 md:h-24" />
    </div>
  )
}
