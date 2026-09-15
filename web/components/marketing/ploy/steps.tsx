"use client"

import { useMemo, useRef } from "react"
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react"
import { reveal } from "./motion"
import { Num } from "./num"
import { Band } from "./band"
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
    /* THE SLEEVE, AS A FLOAT — the paragraph is narrow only where the garment is.
       This column is the left half of the block and the hoodie hangs over the right half, so
       it looked as though there was nothing to clear. There is, at the NARROW end: the two
       columns divide at 50% of the band, and the sleeve's left edge is a fraction of the
       VIEWPORT, and at 1280 that fraction is 38% — the garment reaches 108px INTO this
       column. It eases off as the window grows (17px of clearance at 1440, 71px at 1600 and
       above, where the band's cap holds the card still while the garment keeps moving out).
       MEASURED OVER A FULL CYCLE, not at one instant, and that is the part worth keeping:
       the render drifts 28px and rotates 3° on two loops of different length, so its left
       edge travels ~25px and a reading taken at one moment is a reading of one frame. Sampled
       every 200ms for twelve seconds, the worst overlap is the 108px above.
       9rem covers it with room, and only for the height of the overhang — 20svh, because the
       hang is 28–32% of a hero card measured in svh and a pixel height clears it at one
       window and lands on the sleeve at the next. Below `md` the hero does not overhang. */
    <div ref={ref} className="mt-8 max-w-2xl md:mt-0 md:max-w-none">
      <div aria-hidden className="float-right hidden h-[20svh] w-[9rem] md:block" />
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
      className="grid grid-cols-[44px_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 border-b border-ploy-ink/12 py-6 last:border-b-0 md:gap-x-8 md:py-7"
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
      {/* UNDER THE WORD, and the same at every width.
          It was flush RIGHT against the card edge for one revision, to put ink on both ends
          of a row that was leaving a third of the card empty. That fixed the emptiness and
          bought a worse one: a word at the far left and a clause at the far right are two
          things at the extremes of 1400px with nothing between them, and the eye reads the
          span rather than the pair — "very scattered, feels unfinished". A rule under each
          row cannot hold together what the copy itself has stopped doing.
          The row is a PAIR now: the step's name and the sentence that explains it, stacked in
          one column, which is what it already was on a phone. The width is solved where it
          actually lives — see the note on the two columns below.*/}
      {/* `col-start-2` ON EVERY WIDTH, not `col-span-2`. Spanning both columns put the line
          under the NODE column too — and the pipe runs down that column, so on a phone the
          rule drew straight through the sentence. Starting it in the word's column instead
          means the pipe has the first 44px to itself at every width, which is the whole
          reason the node column is fixed. */}
      <p className="col-start-2 max-w-[32rem] text-[17px] leading-snug text-ploy-ink/70 md:text-[18px]">
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
      <Band className="ploy-acid-bloom relative overflow-hidden rounded-[32px] pb-16 pt-10 md:pb-16 md:pt-10">
        {/* NO MARQUEE HERE. A strip of marketplace names scrolling across the top of this
            block was the prototype's device for filling the band under the hero — but the
            names are already a claim the page makes in words, and a second, moving copy of
            them above the section's own headline competed with it. The block opens on its
            title now. */}

        {/* TWO COLUMNS, and this is what finally uses the width.
            A ladder of four one-word steps cannot fill a 1416px band. It was tried flush left
            (a third of the card empty) and then anchored to both edges (scattered), and both
            are the same mistake: asking four short rows to span a page. Nothing was wrong
            with the rows — they were in a column three times too wide for them.
            So the block holds TWO things side by side. The argument reads down the left, the
            ladder down the right, each about 600px: a measure a paragraph wants, and one a
            step row is full at. The card gets shorter for it too.
            It also retires the float that cleared the garment. The hoodie hangs RIGHT, which
            is the ladder's column now, so the clearance is a pad on that column alone and the
            paragraph starts at the top of the card, where nothing was ever in its way. */}
        <div className="px-8 md:grid md:grid-cols-2 md:gap-x-16 md:px-14">
          {/* NO DISPLAY HEADLINE HERE (owner, 2026-09-09: "no bold — it's just a paragraph").
              A bold line above a paragraph is two openings competing, and weight wins every
              time: the eye took the headline and skipped the argument underneath it, which is
              the half that does the persuading. The stored heading still renders — as the
              paragraph's first sentence, in the same ink as the rest.
              The steps below are the loud thing, and they have the whole block to be it. */}

          {/* The heading OPENS the paragraph rather than sitting over it, so the stored
              content still renders and the section still says what it is — in one voice. */}
          {/* THE SPACE GOES BETWEEN THE TWO BLOCKS, NOT AFTER THEM.
              The left column holds less than the right — a paragraph and four figures against
              four steps — so `items-start` left it ending a third of the way up the card with
              the rest of its height empty, which is the same trailing hole in a narrower
              shape. Stretched to the row and pushed apart, the argument sits at the top and
              its proof at the bottom, level with the last step: the gap is now interior,
              bounded by ink at both ends, which is a composition rather than a remainder. */}
          <div className="flex flex-col">
          <Lead lines={[[...heading, lead[0]].filter(Boolean).join(" "), ...lead.slice(1)]} />

          {/* THE PROOF SITS UNDER THE ARGUMENT, not in a band at the foot of the card.
              Four figures across the bottom were a third row in a two-column block, and they
              left the left column empty from the end of the paragraph to the end of the
              section — which is the same hole this layout was built to close, moved one
              column over. Here they give the left column its full height and they read as
              what they are: the evidence for the sentence directly above them.
              TWO UP, not four. Four figures in a 600px column is 150px each, and "99.4%" at
              72px does not fit in 150px — it is a 2×2 in half the width, which is also how
              they are drawn on a phone. */}
          <motion.div {...reveal(0.3)} className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10 md:mt-auto md:pt-14">
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
                  {/* THE NOTE, which this section dropped.
                      It is a stored field, already written, and site-content.ts says what it
                      is for: "`note` says what the figure MEANS, which is what turns a row of
                      numbers into a spec sheet rather than four unexplained digits". Five bare
                      numerals under five bare labels is exactly the row it warns about — and
                      the left column had space under them, which is the other half of why
                      this is the right thing to put there. */}
                  {f.note && (
                    <p className="mt-1 max-w-[16rem] text-[13px] leading-snug text-ploy-ink/55">{f.note}</p>
                  )}
                </div>
              )
            })}
          </motion.div>
          </div>

          {/* THE CLEARANCE LIVES HERE NOW — this column is the one the hoodie hangs into.
              In svh because the overhang is: 28–32% of a hero card measured in svh, which is
              205px at a 900px window and 250px at 1080. A pixel pad clears it at one window
              and lands on the first step at the next. */}
          <div className="relative mt-12 md:mt-0 md:pt-[22svh]">
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

        </div>
      </Band>
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
