"use client"

import { useRef } from "react"
import type { MotionValue } from "motion/react"
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react"

/**
 * THE PAGE ENDS UNDER A MOUNTAIN OF OBJECTS, either side of the sign-up card.
 *
 * THE PIECES ARE GENERATED, NOT LISTED. Fifteen hand-placed objects a side was a heap you
 * could count; a mountain needs hundreds, and hundreds cannot be written out by hand without
 * the list becoming the thing that is maintained. A seeded generator builds the pile from a
 * shape — courses that narrow and shrink as they rise — so the density is one number to turn.
 *
 * THE SEED IS FIXED, AND THAT IS LOAD-BEARING. This is a client component whose module body
 * runs on the server too, so `Math.random()` would place every piece differently in the HTML
 * than in the hydrated tree — a mismatch React reports and repaints. mulberry32 with a
 * constant seed gives the same pile in both.
 *
 * NOTHING HERE IS DRAGGABLE, deliberately. At fifteen pieces a drag handler each was the
 * point — an object you can throw is a toy. At three hundred it is three hundred gesture
 * recognisers and pointer listeners on a page that is otherwise finished, for an interaction
 * nobody will find in a pile that dense. The objects went from being toys to being terrain,
 * and terrain does not need handles.
 *
 * THEY NEVER TOUCH THE CARD. Each mountain is anchored to its own side and capped at the
 * width of the margin, and the CTA's content sits at `z-10` above this layer, so pieces pass
 * BEHIND the headline on the way down and nothing rests on a word or the email field.
 *
 * BELOW md THEY ARE NOT DRAWN. On a phone the form is full width, there are no margins to
 * fill, and three hundred elements is a real cost on the device least able to pay it.
 */

const SRCS = ["/ploy/obj-chrome.webp", "/ploy/obj-star.webp", "/ploy/obj-cloud.webp", "/ploy/obj-green.webp"]

/** Deterministic PRNG — see the note above on why this must not be Math.random. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Piece = { src: string; x: number; y: number; w: number; rot: number; delay: number; z: number }

/**
 * ONE MOUNTAIN.
 *
 * `courses` stack upward; each is narrower and smaller than the one below, which is the whole
 * of what makes a pile read as a pile rather than a wall. Pieces are jittered within their
 * course so the courses themselves never show as stripes.
 *
 * Delay rises with height so the mountain BUILDS from the ground — the base is already down
 * before anything lands on it, which is the order gravity would deliver and the reason it
 * reads as settling rather than as a swarm arriving.
 */
function buildMountain(seed: number, courses = 9, baseCount = 13): Piece[] {
  const r = mulberry32(seed)
  const out: Piece[] = []
  for (let c = 0; c < courses; c++) {
    const t = c / (courses - 1)
    // How many in this course, and how wide it spreads: both taper toward the summit.
    /* ENOUGH TO READ, NOT ENOUGH TO BECOME TEXTURE — and forty a side was under the line,
       not over it. Six hundred pieces made a moving surface nobody could watch a single
       object fall through; forty made a pile you could see THROUGH, holes of page ground
       between the shapes, and a heap with daylight in it does not read as settled matter.
       Around seventy is where the pieces still arrive one at a time and still touch.

       The taper is what actually closes the gaps. At `** 0.9` the count collapsed almost
       linearly — the upper courses were down to two pieces spread across most of the width,
       which is the row of isolated objects at the summit. `** 0.55` keeps a course's worth of
       overlap much further up, so the mound narrows by getting NARROWER rather than by
       getting sparser, which is how a real pile does it. */
    const n = Math.max(2, Math.round(baseCount * (1 - t) ** 0.55))
    const spread = 1 - t * 0.52
    for (let i = 0; i < n; i++) {
      const jitter = (r() - 0.5) * 0.16
      out.push({
        src: SRCS[Math.floor(r() * SRCS.length)],
        // 0..1 across the mountain's own width, centred and narrowing as it climbs
        /* Held to 0.2..0.8, in from 0.12..0.88. The bound is meant to keep a piece's HALF
           WIDTH inside the container, and it never did: at 0.12 of a 400px column a 150px
           piece hangs 28px past the edge, which on the outer side of each mound is the
           viewport edge — so the heap ended in a straight vertical cut down the side of the
           screen. A pile with a razor edge is not a pile. Denser courses only made more
           pieces land on it. */
        x: Math.min(0.8, Math.max(0.2, 0.5 + ((i + 0.5) / n - 0.5) * spread + jitter)),
        /* 42, not 52. The courses are shorter than the pieces are tall, so each one beds
           into the one below instead of resting on its shoulders — the vertical half of the
           same gap problem. */
        y: c * 42 + (r() - 0.5) * 14,
        w: Math.round((132 - t * 46) * (0.8 + r() * 0.36)),
        rot: Math.round((r() - 0.5) * 54),
        delay: t * 0.9 + r() * 0.22,
        z: c,
      })
    }
  }
  return out
}

const LEFT = buildMountain(20260908)
const RIGHT = buildMountain(77712345)

/**
 * ONE PIECE, ONE TRANSFORM — so they arrive one at a time.
 *
 * This was four depth bands sharing four transforms, which was the right trade at six hundred
 * pieces and the wrong one at eighty: everything in a band moved together, so the pile landed
 * in four slabs rather than piece by piece. Eighty subscriptions is a cost worth paying for
 * the thing the effect is actually for.
 *
 * EACH PIECE OWNS A SLICE OF THE SCROLL. `from` is where it starts moving and `to` where it
 * lands, and the slices overlap — so at any moment several are in the air and none of them
 * began together. Base first, summit last, because that is the order a pile is built and the
 * order gravity would deliver it.
 *
 * IT IS LINKED, NOT PLAYED: scrolling down brings a piece in, scrolling up takes the same
 * piece back out along the same path. Nothing here fires once.
 */
function Falling({ p, progress, reduced }: { p: Piece; progress: MotionValue<number>; reduced: boolean }) {
  // The window this piece travels in. `delay` already rises with height, so the sequence is
  // the pile's own build order; 0.52 leaves room for the last one to still finish inside 1.
  const from = Math.min(0.52, p.delay * 0.52)
  const to = Math.min(1, from + 0.46)
  /* -430, not -780. With clipping removed a piece travelling the full height of the section
     rose over the plan cards above and sat on their copy for the middle of the fall — the one
     thing an object must not do. Starting lower keeps every piece inside this section's own
     air, so it still enters from off-screen without ever crossing another block's text. */
  const y = useTransform(progress, [from, to], [-430, 0])
  const opacity = useTransform(progress, [from, Math.min(1, from + 0.1)], [0, 1])

  return (
    <motion.div
      style={{
        left: `${p.x * 100}%`,
        bottom: p.y,
        width: p.w,
        marginLeft: -p.w / 2,
        zIndex: p.z,
        rotate: p.rot,
        ...(reduced ? {} : { y, opacity }),
      }}
      className="absolute select-none"
    >
      {/* A plain <img>: eighty next/image wrappers for a decorative cut-out that is already
          webp and already sized buys nothing. No drop-shadow — overlapping shadows in a pile
          stack into a grey smudge behind it, and the renders carry their own contact shadow. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.src} alt="" draggable={false} className="h-auto w-full" loading="lazy" />
    </motion.div>
  )
}

function Mountain({ pieces, side, progress }: { pieces: Piece[]; side: "left" | "right"; progress: MotionValue<number> }) {
  const reduced = useReducedMotion() ?? false
  return (
    <div
      aria-hidden
      className={
        /* `z-0` makes its own stacking context, so the per-piece z is compared only inside
           this layer and can never beat the CTA content's z-10 — without it a piece painted
           straight over the headline. Narrower than the margin looks, so the two mountains
           never meet the centred card and bury the heading's first and last letters. */
        /* IT RESTS ON THE FOOTER, not 56px above it. The mound's base course sits at this
           layer's bottom, and this layer used to stop where the CTA section stops — while the
           marketing layout's <main> carries `pb-14 md:pb-20` underneath, so the whole pile
           floated a clear band of page ground above the footer's top edge and read as
           suspended rather than settled.
           These two values ARE that padding, negated. If the layout's bottom padding moves,
           this moves with it — they are a pair, and grepping either number finds both. */
        "pointer-events-none absolute -bottom-14 z-0 hidden h-full w-[clamp(260px,27vw,400px)] md:-bottom-20 md:block " +
        (side === "left" ? "left-0" : "right-0")
      }
    >
      {pieces.map((p, i) => (
        <Falling key={i} p={p} progress={progress} reduced={reduced} />
      ))}
    </div>
  )
}

export function PloyDrop() {
  const ref = useRef<HTMLDivElement>(null)
  /* Measured against the SECTION this sits in: the pile is fully down by the time the
     section's bottom reaches the bottom of the screen, and fully lifted before it enters. */
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] })
  /* Sprung, and softly: a native wheel arrives in discrete jumps, and eighty pieces stepping
     with them is the difference between settling and stuttering. */
  const progress = useSpring(scrollYProgress, { stiffness: 42, damping: 24, restDelta: 0.0005 })

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-0">
      <Mountain pieces={LEFT} side="left" progress={progress} />
      <Mountain pieces={RIGHT} side="right" progress={progress} />
    </div>
  )
}
