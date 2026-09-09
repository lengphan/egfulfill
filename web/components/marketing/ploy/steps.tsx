"use client"

import { useMemo, useRef } from "react"
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react"
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


/**
 * ONE WORD AT A TIME.
 *
 * The whole block used to fade together, 40% ink to full, as it crossed the reading band —
 * which is a paragraph appearing, not a paragraph being read. Every word was already at its
 * final weight the instant the first one was, so there was nothing to follow: the effect
 * happened TO the passage rather than along it.
 *
 * Each word now owns a slice of the same scroll. They overlap by design — the bands are wider
 * than the step between them — so what travels down the sentence is a soft edge rather than a
 * cursor ticking word by word, which is the difference between reading and being read to.
 *
 * PALE IS STILL LEGIBLE. The floor is 18% ink on acid, not zero: nothing here is hidden, and a
 * reader who lands mid-section or never scrolls at all still has the whole paragraph. Motion
 * that withholds the words is a paragraph that does not work without JavaScript.
 */
function LeadWord({ word, progress, from, to }: { word: string; progress: MotionValue<number>; from: number; to: number }) {
  const opacity = useTransform(progress, [from, to], [0.18, 1])
  return (
    <>
      <motion.span style={{ opacity }}>{word}</motion.span>{" "}
    </>
  )
}

/**
 * THE LEAD IS THE SECTION — there is no display headline over it any more.
 *
 * A bold line then a paragraph made two things competing to be the first thing read, and the
 * headline won by weight every time (owner, 2026-09-09: "no bold — it's just a paragraph").
 * The stored heading is not lost; it opens the passage as its first sentence, which is what
 * it always was.
 *
 * Bigger, too. This is the argument the whole section makes and it is now the only type in
 * the column, so it carries at display scale instead of reading as an introduction to a list.
 */
function Lead({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const still = useReducedMotion()
  /* Across the WHOLE passage, not its top edge: `end` in the offset is what lets the last
     word finish later than the first. A start-to-start range would give every word the same
     window, which is the effect this replaces. */
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 55%"] })

  /* Numbered once, across every paragraph, so the sweep does not restart at each break — and
     numbered HERE rather than by a counter incremented during render, which is a write to a
     value the render depends on (react-hooks/immutability, and it is right: the same paragraph
     re-rendered twice would keep counting). */
  const paras = useMemo(() => {
    let n = 0
    return lines.map((l) => l.split(/\s+/).filter(Boolean).map((w) => ({ w, i: n++ })))
  }, [lines])
  const total = paras.reduce((n, p) => n + p.length, 0)
  return (
    <div ref={ref} className="mt-8 max-w-2xl md:mt-10 md:max-w-[46rem]">
      {paras.map((ws, i) => (
        <p
          key={i}
          className={(i === 0 ? "" : "mt-7 ") + "text-[clamp(1.7rem,3.5vw,2.7rem)] leading-[1.2] tracking-[-0.015em] text-ploy-ink"}
        >
          {ws.map(({ w, i: n }) => {
            /* A BAND WIDER THAN THE STEP. At 1/total each the words would light strictly one
               after another with a hard edge; at four times that they overlap, and the front
               of the sweep is soft. */
            const from = total > 1 ? (n / total) * 0.72 : 0
            return still
              ? <span key={n}>{w}{" "}</span>
              : <LeadWord key={n} word={w} progress={scrollYProgress} from={from} to={Math.min(1, from + 4 / total)} />
          })}
        </p>
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
        {/* NOT BOLD. The word beside it is already display-scale — CONNECT, DESIGN, PUBLISH —
            so a semibold line under it was a second thing shouting in a row that had already
            said which step this is. Weight was doing the work size and position already do. */}
        <p className="text-[22px] leading-tight">{step.title}</p>
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
        {/* NO MARQUEE HERE. A strip of marketplace names scrolling across the top of this
            block was the prototype's device for filling the band under the hero — but the
            names are already a claim the page makes in words, and a second, moving copy of
            them above the section's own headline competed with it. The block opens on its
            title now. */}

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
          {/* NO DISPLAY HEADLINE HERE (owner, 2026-09-09: "no bold — it's just a paragraph").
              A bold line above a paragraph is two openings competing, and weight wins every
              time: the eye took the headline and skipped the argument underneath it, which is
              the half that does the persuading. The stored heading still renders — as the
              paragraph's first sentence, in the same ink as the rest, which is where a section
              this short was always going to read best.
              The steps below are the loud thing now, and they have the whole block to be it. */}

          {/* The heading OPENS the paragraph rather than sitting over it, so the stored
              content still renders and the section still says what it is — in one voice. */}
          <Lead lines={[[...heading, lead[0]].filter(Boolean).join(" "), ...lead.slice(1)]} />

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
