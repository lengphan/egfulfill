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
      {/* THE SPACE THE GARMENT OCCUPIES, AS A FLOAT — the paragraph wraps around the hoodie
          instead of starting underneath it.

          The block used to clear the overhang with `pt-[26svh]` on the card: a quarter of the
          viewport of bare acid above the first word. The garment covers only the RIGHT of that
          band, so what it actually produced was a large empty rectangle on the left with an
          object floating beside it — which is the "tons of blank space" this section was
          reported for, and the third time the same answer had been tried (30rem, then 18rem,
          then the pad).

          Capping the whole column to the sleeve's x was the next wrong answer and is recorded
          so it is not retried: at 1280 the usable width is 541px, which turned two paragraphs
          into a seven-line wall with its own void beside the lower half. The column is only
          narrow where the garment IS — a float is the one thing in CSS that says exactly that,
          and it needs no measurement per width because the text finds its own edge.

          THE TWO NUMBERS. Width 13rem is taken from the WORST case, 1280, where the sleeve's
          left edge (629px) leaves 195px of this 736px column covered; at 1440 and 1920 it
          reserves a little more than the garment needs, which costs two words on three lines
          and cannot collide. Height is in svh because the overhang is: the hang is 28–32% of a
          hero card measured in svh, which measures 205px at 900 and 250px at 1080 — 23svh
          either way — less the 40px this block already sits below the card's top edge. A pixel
          height would clear at one window and land on the sleeve at the next.
          `md:` only: below it the garment is full-width and the hero does not overhang. */}
      <div aria-hidden className="float-right hidden h-[20svh] w-[13rem] md:block" />
      {paras.map((ws, i) => (
        <p
          key={i}
          /* SMALLER THAN IT WAS (was clamp(1.7rem,3.5vw,2.7rem), i.e. 43px at 1440). At that
             size two paragraphs filled a screen on their own and the steps below — the thing
             this section is actually for — started a scroll away. It is the section's lead,
             not a second hero. */
          className={(i === 0 ? "" : "mt-5 ") + "text-[clamp(1.35rem,2.5vw,2rem)] leading-[1.25] tracking-[-0.015em] text-ploy-ink"}
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

/**
 * ONE STEP: a numeral, the word, and ONE line.
 *
 * IT USED TO CARRY THREE PIECES OF TYPE — the word at 108px, a sentence title at 22px, and a
 * body at 16px — and the first two said the same thing ("CONNECT" / "Plug in the shop you
 * already run."). One of them had to go, and it is the title: the word is the step's name and
 * repeating it in a full sentence underneath is the section reading itself aloud. The title
 * still renders on /how-it-works, which has a whole band per step and room for it.
 *
 * BASELINE, NOT CENTRE, and this is the actual bug the row was reported for. The word, the
 * node and the text block were each `self-center`, so the row centred three boxes of
 * DIFFERENT heights against each other — and the moment one line wrapped, its block grew and
 * the 108px word beside it slid. Measured at 1440 the word sat 17px below its line on three
 * rows and 3px on the fourth, purely because SHIP's copy ran to two lines. A reader does not
 * see 14px as a wrap; they see a column that is crooked.
 *
 * `items-baseline` cannot do that. Every cell sits on ONE line, the numeral inside the node
 * puts the circle on it too, and a line that wraps grows DOWNWARD from a baseline that has
 * already been set. There is no number to tune and nothing to re-tune when the copy changes.
 */
function StepRow({ i, total, step, progress }: { i: number; total: number; step: Step; progress: MotionValue<number> }) {
  // The node sits on the row's first baseline now, so it lights when the fill reaches the
  // TOP of the row rather than its middle.
  const at = (i + 0.28) / total
  const lit = useTransform(progress, [at - 0.04, at], [0, 1])
  // Opaque when unlit, so the pipe never shows through the ring.
  const bg = useTransform(lit, [0, 1], ["var(--color-ploy-acid)", "var(--color-ploy-ink)"])
  const fg = useTransform(lit, [0, 1], ["var(--color-ploy-ink)", "var(--color-ploy-acid)"])
  const opacity = useTransform(progress, [at - 0.18, at - 0.02], [0.32, 1])

  return (
    <motion.li
      style={{ opacity }}
      className="grid grid-cols-[44px_minmax(0,1fr)] items-baseline gap-x-6 gap-y-3 border-b border-ploy-ink/12 py-6 last:border-b-0 md:grid-cols-[44px_auto_minmax(0,1fr)] md:gap-x-10 md:py-7"
    >
      {/* The numeral is what puts this circle on the row's baseline — `items-baseline` reads
          the text inside it, not the box, which is why the ring needs no offset of its own at
          any type size. */}
      <motion.span
        style={{ backgroundColor: bg, color: fg }}
        className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 border-ploy-ink text-[13px] font-semibold tabular-nums"
      >
        {step.n || String(i + 1).padStart(2, "0")}
      </motion.span>
      {/* SMALLER THAN IT WAS. At 108px against a 16px line the row jumped 6.75x with nothing
          between, which is what reads as "the font size is off" — the word was not big, the
          gap was. 64px to 18px is one step, and the word is still the loudest thing here. */}
      <h3 className="ploy-display text-[clamp(2.25rem,4.6vw,4rem)] leading-[0.85] text-ploy-ink">
        {displayWord(step)}
      </h3>
      {/* FLUSH RIGHT, AGAINST THE CARD'S EDGE — and this is what the row was reported for.
          The line used to be left-aligned in a `1fr` track under a `max-w-[32rem]` cap, and
          the copy is one clause: measured at 1440 it drew 512px of a 885px track and left
          373px — a third of the card — with no ink in it, on every row, top to bottom. That
          is the blank. Nothing was missing from the section; the section simply stopped a
          third of the way short of its own edge.
          Right-aligning it anchors the row to BOTH edges, so the space between the word and
          the line is a gap the eye crosses rather than a margin it falls off. The hairline
          under each row is the other half of it: a rule that runs the full width is what
          makes the space between two anchored things read as measured rather than as unused.
          The word track is `auto` now, not `minmax(8rem,15rem)` — a fixed track under a word
          whose length is editable content either clipped SHIP\'s neighbours or padded them. */}
      {/* `col-start-2` ON EVERY WIDTH, not `col-span-2`. Spanning both columns put the line
          under the NODE column too — and the pipe runs down that column, so on a phone the
          rule drew straight through the sentence. Starting it in the word's column instead
          means the pipe has the first 44px to itself at every width, which is the whole
          reason the node column is fixed. */}
      <p className="col-start-2 max-w-[32rem] text-[17px] leading-snug text-ploy-ink/70 md:col-start-3 md:ml-auto md:text-right md:text-[19px]">
        {step.body}
      </p>
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
      {/* THERE IS NO TOP PAD ANY MORE, and that is the point of this change.
          The garment hangs 28–32% of the hero card past its own bottom edge (owner: "keep the
          hoodie on top of the lime card as well"), and this block used to buy that clearance
          with `md:pt-[26svh]` — a quarter of the viewport of bare acid, so the first words
          started BELOW the hem. Measured at 1440 that was 274px of empty lime above the lead,
          and the hoodie covers only the RIGHT of it, so what a reader actually saw was a large
          empty rectangle on the left with an object floating beside it. Paying for an overlap
          with emptiness is what made this section read half-finished — twice before, at 30rem
          and at 18rem, and the pad is the third time the same answer was tried.
          The clearance is HORIZONTAL now: the garment hangs right, so the type is capped to
          stop where the sleeve starts and rises straight into the band beside it. The pairing
          with hero.tsx still exists, it is just on the other axis — the note on `Lead` carries
          the measured edges, and the note in hero.tsx points at it. Change the garment's width
          or its `top` and that cap is what has to move, not a pad down here. */}
      <motion.div {...rise(0)} className="ploy-acid-bloom relative overflow-hidden rounded-[32px] pb-16 pt-10 md:pb-16 md:pt-10">
        {/* NO MARQUEE HERE. A strip of marketplace names scrolling across the top of this
            block was the prototype's device for filling the band under the hero — but the
            names are already a claim the page makes in words, and a second, moving copy of
            them above the section's own headline competed with it. The block opens on its
            title now. */}

        <div className="px-8 md:px-14">
          {/* NO DISPLAY HEADLINE HERE (owner, 2026-09-09: "no bold — it's just a paragraph").
              A bold line above a paragraph is two openings competing, and weight wins every
              time: the eye took the headline and skipped the argument underneath it, which is
              the half that does the persuading. The stored heading still renders — as the
              paragraph's first sentence, in the same ink as the rest.
              The steps below are the loud thing, and they have the whole block to be it. */}

          {/* The heading OPENS the paragraph rather than sitting over it, so the stored
              content still renders and the section still says what it is — in one voice. */}
          <Lead lines={[[...heading, lead[0]].filter(Boolean).join(" "), ...lead.slice(1)]} />

          <div className="relative mt-12 md:mt-14">
            {/* THE PIPE. Base rule in pale ink; the fill scales down from the top with scroll.
                It sits in the node column, which is now the FIRST column at a flat 44px at
                every width — so this is `left-[21px]` and nothing else. It used to be
                `left-[calc((100%-44px-5rem)/2.1+2.5rem+21px)]`, a formula reconstructing the
                middle of a three-column grid from the outside; it had to be re-derived by
                hand every time a gap or a track changed, and 2.1 is not a number anyone can
                justify. Putting the node column first makes the rule a constant. */}
            <div className="absolute bottom-0 left-[21px] top-0 w-0.5 bg-ploy-ink/15">
              <motion.div style={{ scaleY: progress }} className="h-full w-full origin-top bg-ploy-ink" />
            </div>
            <ol ref={list}>
              {steps.map((s, i) => (
                <StepRow key={s.n || i} i={i} total={steps.length} step={s} progress={progress} />
              ))}
            </ol>
          </div>

          <motion.div {...reveal(0.3)} className="mt-12 grid grid-cols-2 gap-8 md:grid-cols-4">
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
