"use client"

import { useRef } from "react"
import { motion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react"
import { reveal, rise } from "./motion"
import { Num } from "./num"
import { GUTTER, STACK } from "./rhythm"
import { displayWord } from "./step-word"
import type { Stat, Step } from "@/lib/site-content"

/**
 * THE BLOCK UNDER THE HERO — the four steps on acid, with the hero's garment hanging in from
 * above as its only picture, and a PIPE down the middle.
 *
 * The pipe is the page's one scroll-LINKED effect: a rule runs down the gutter between each
 * step's word and its description, and fills from the top as the block travels up the screen.
 * Each numbered node lights the moment the fill reaches it, and its step brightens with it,
 * so the sequence reads as a sequence rather than as four paragraphs.
 */

/** The marketplaces orders arrive from. NOT customers — we do not print names we have not
 *  been given, and these are a claim the product can stand behind. */
const CHANNELS = ["Etsy", "Shopify", "TikTok Shop"]

function LogoWall() {
  // Three names would leave the track short of the viewport, so the set is repeated enough
  // times that half the track is always wider than the screen — which is what makes the
  // 50% translate seamless.
  const list = Array.from({ length: 8 }, () => CHANNELS).flat()
  return (
    <div className="overflow-hidden">
      <div className="flex w-max">
        <div className="ploy-marquee flex items-center">
          {list.map((name, i) => (
            <span key={i} className="flex items-center">
              <span className="ploy-display whitespace-nowrap px-10 py-3 text-[36px] text-ploy-ink/45">{name}</span>
              <span className="h-1.5 w-1.5 rounded-full bg-ploy-ink/25" />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The lead paragraph, developing from pale to full ink as it crosses the viewport. */
function Lead({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  /* Measured on the element itself: pale when its top is still low on the screen, full by the
     time it has risen into the reading band. `end` before `start` would run it backwards. */
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 90%", "start 45%"] })
  const opacity = useTransform(scrollYProgress, [0, 1], [0.4, 1])

  return (
    <div ref={ref} className="mt-8 max-w-xl md:mt-10 md:max-w-[38rem]">
      {lines.map((p, i) => (
        <motion.p
          key={i}
          style={{ opacity }}
          className={(i === 0 ? "" : "mt-5 ") + "text-[17px] leading-relaxed text-ploy-ink md:text-[19px]"}
        >
          {p}
        </motion.p>
      ))}
    </div>
  )
}

function StepRow({ i, total, step, progress }: { i: number; total: number; step: Step; progress: MotionValue<number> }) {
  // The node sits at the row's vertical centre, so it lights when the fill passes
  // (i + 0.5) / total of the pipe.
  const at = (i + 0.5) / total
  const lit = useTransform(progress, [at - 0.04, at], [0, 1])
  // Opaque when unlit, so the pipe never shows through the ring.
  const bg = useTransform(lit, [0, 1], ["var(--color-ploy-acid)", "var(--color-ploy-ink)"])
  const fg = useTransform(lit, [0, 1], ["var(--color-ploy-ink)", "var(--color-ploy-acid)"])
  const opacity = useTransform(progress, [at - 0.18, at - 0.02], [0.32, 1])

  return (
    <motion.li
      style={{ opacity }}
      className="grid grid-cols-[44px_1fr] gap-x-5 gap-y-3 py-7 md:grid-cols-[1fr_44px_1.1fr] md:gap-x-10 md:py-9"
    >
      <motion.span
        style={{ backgroundColor: bg, color: fg }}
        className="relative z-10 flex h-11 w-11 items-center justify-center self-center rounded-full border-2 border-ploy-ink text-[13px] font-semibold tabular-nums md:order-2"
      >
        {step.n || String(i + 1).padStart(2, "0")}
      </motion.span>
      <h3 className="ploy-display self-center text-[clamp(3rem,8vw,6.75rem)] text-ploy-ink md:order-1">
        {displayWord(step)}
      </h3>
      <div className="col-span-2 max-w-[34rem] md:order-3 md:col-span-1 md:self-center">
        <p className="text-[22px] font-semibold leading-tight">{step.title}</p>
        <p className="mt-3 text-[16px] leading-relaxed text-ploy-ink/65">{step.body}</p>
      </div>
    </motion.li>
  )
}

export function PloySteps({ heading, lead, steps, stats }: { heading: string[]; lead: string[]; steps: Step[]; stats: Stat[] }) {
  const list = useRef<HTMLOListElement>(null)
  const { scrollYProgress } = useScroll({ target: list, offset: ["start 72%", "end 58%"] })
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
    <section id="steps" className={`relative ${GUTTER} ${STACK}`}>
      <motion.div {...rise(0)} className="ploy-acid-bloom relative overflow-hidden rounded-[32px] pb-20 pt-10 md:pb-24 md:pt-14">
        {/* The marketplaces run along the top of the block; the hero's garment crosses them,
            so the band under the fold is never empty. */}
        <LogoWall />

        <div className="px-8 md:px-14">
          {/* THE HEADLINE SITS DIRECTLY UNDER THE MARQUEE.
              It opened with 30rem of empty acid, then 18rem, both there for one reason: the
              hero's garment hangs past its own section and would otherwise land on the first
              step. Clearing an object by pushing everything below it down is what made the
              block read half-empty — so the margin is now only the gap the strip needs, and
              the LEAD is what carries the section past the sleeve instead. The type is all in
              the left column, which is clear ground because the garment hangs right.

              The size came down with it. At 6.5vw this ran the full width of the block and
              crowded the strip above; smaller, it reads as the section's title rather than
              as a second hero, and it leaves the steps below room to be the loud thing. */}
          <h2 className="ploy-display mt-10 text-[clamp(2.1rem,4.9vw,4.1rem)] md:mt-14">
            {heading.map((l, i) => (
              <motion.span key={l} {...reveal(i * 0.1)} className="block">
                {l}
              </motion.span>
            ))}
          </h2>

          {/* SCROLL BRINGS IT UP TO FULL INK, not hover.
              It was a pointer transition, which meant the sentence only ever resolved for
              someone who happened to put a cursor on it — and never at all on a phone. The
              steps below already darken as the pipe reaches them; this now does the same
              thing off its own position, so reading down the page IS what develops it.
              It is a colour, so nothing is ever hidden: at 40% ink it still reads, it just
              stops competing with the display line above it. */}
          <Lead lines={lead} />

          <div className="relative mt-14 md:mt-16">
            {/* THE PIPE. Base rule in pale ink; the fill scales down from the top with scroll.
                It sits in the node column: 22px in on phones, in the middle gutter from md. */}
            <div className="absolute bottom-0 left-[21px] top-0 w-0.5 bg-ploy-ink/15 md:left-[calc((100%-44px-5rem)/2.1+2.5rem+21px)]">
              <motion.div style={{ scaleY: progress }} className="h-full w-full origin-top bg-ploy-ink" />
            </div>
            <ol ref={list}>
              {steps.map((s, i) => (
                <StepRow key={s.n || i} i={i} total={steps.length} step={s} progress={progress} />
              ))}
            </ol>
          </div>

          <motion.div {...reveal(0.3)} className="mt-14 grid grid-cols-2 gap-8 md:grid-cols-4">
            {stats.map((f) => {
              /* `value` is stored as free TEXT — "$0", "24h", "3", "99.4%" — because an admin
                 types it in Settings › Site content. So the figure is split rather than
                 assumed: whatever sits before and after the digits is drawn statically and
                 only the digits count up. A value with no digits at all ("Same day") simply
                 renders as itself, which is why this cannot break on content it did not
                 expect. */
              const m = /^(\D*)(\d[\d,.]*)(.*)$/.exec(f.value.trim())
              return (
                <div key={f.label}>
                  <p className="ploy-display text-[clamp(2.5rem,5vw,4.5rem)] leading-[0.9]">
                    {m ? (
                      <Num value={Number(m[2].replace(/,/g, ""))} prefix={m[1]} suffix={m[3]} />
                    ) : (
                      f.value
                    )}
                  </p>
                  <p className="mt-2 text-[14px] font-semibold text-ploy-ink/70">{f.label}</p>
                </div>
              )
            })}
          </motion.div>
        </div>
      </motion.div>
      {/* NO OBJECT ON THIS EDGE.
          Five bands each carried one hovering at a corner, all doing the same thing, none of
          them tied to anything — which is what makes an object read as random rather than
          placed. An object earns its place here in exactly two ways, and both are still on
          the page: set INTO a line of type, where it is part of the sentence, and the pile
          that falls at the very end, where it is the page finishing. Everything between is
          the work, and the work does not need ornament. */}
    </section>
  )
}
