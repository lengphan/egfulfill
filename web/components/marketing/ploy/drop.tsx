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
function buildMountain(seed: number, courses = 24, baseCount = 26): Piece[] {
  const r = mulberry32(seed)
  const out: Piece[] = []
  for (let c = 0; c < courses; c++) {
    const t = c / (courses - 1)
    // How many in this course, and how wide it spreads: both taper toward the summit.
    /* The taper is GENTLE — `** 1.06` and a spread that only closes to 55% — because a
       steep one produces a narrow peak with empty ground either side of it, and the brief
       is to occupy the margin, not to draw a triangle in the middle of it. It still narrows,
       so the silhouette is a bank rather than a wall. */
    const n = Math.max(2, Math.round(baseCount * (1 - t) ** 1.06))
    const spread = 1 - t * 0.45
    for (let i = 0; i < n; i++) {
      const jitter = (r() - 0.5) * 0.16
      out.push({
        src: SRCS[Math.floor(r() * SRCS.length)],
        // 0..1 across the mountain's own width, centred and narrowing as it climbs
        x: Math.min(1, Math.max(0, 0.5 + ((i + 0.5) / n - 0.5) * spread + jitter)),
        y: c * 27 + (r() - 0.5) * 13,
        w: Math.round((112 - t * 52) * (0.76 + r() * 0.44)),
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
 * FOUR DEPTH BANDS, NOT 614 TRANSFORMS.
 *
 * The fall is scroll-LINKED now: dragging the page back up lifts the objects out again,
 * because their position is a function of where the section is rather than a one-shot
 * animation that has already finished. That is the difference between a thing that happened
 * and a thing you are doing.
 *
 * Doing it per piece would mean six hundred `useTransform` subscriptions recomputing on every
 * scroll frame. Instead the pieces are grouped into four bands by height, and each BAND gets
 * one transform — eight in total for both mountains. The bands travel at different rates, so
 * the pile also gains parallax: the base barely moves, the summit swings furthest, which is
 * what makes it read as depth rather than as one flat image sliding.
 *
 * The value is sprung for the same reason the steps' pipe is: a native wheel arrives in
 * discrete jumps, and a raw scroll value makes six hundred objects step with them.
 */
const BANDS = 4

function Mountain({ pieces, side, progress }: { pieces: Piece[]; side: "left" | "right"; progress: MotionValue<number> }) {
  const reduced = useReducedMotion()
  const maxZ = Math.max(...pieces.map((p) => p.z), 1)

  /* Deeper bands travel less. Hooks must not be called in a loop with a variable count, so
     the four are written out — BANDS is a constant and this stays honest about it. */
  const y0 = useTransform(progress, [0, 1], [-520, 0])
  const y1 = useTransform(progress, [0, 1], [-680, 0])
  const y2 = useTransform(progress, [0, 1], [-840, 0])
  const y3 = useTransform(progress, [0, 1], [-1000, 0])
  const o0 = useTransform(progress, [0, 0.25], [0, 1])
  const o1 = useTransform(progress, [0.05, 0.35], [0, 1])
  const o2 = useTransform(progress, [0.12, 0.45], [0, 1])
  const o3 = useTransform(progress, [0.2, 0.55], [0, 1])
  const ys = [y0, y1, y2, y3]
  const os = [o0, o1, o2, o3]

  return (
    <div
      aria-hidden
      className={
        /* `z-0` makes its own stacking context, so the per-piece z (0..23) is compared only
           inside this layer and can never beat the CTA content's z-10 — without it a piece
           painted straight over the headline. And it is narrower than the margin looks: at
           36vw the two mountains met the centred card and buried the first and last letters. */
        "pointer-events-none absolute bottom-0 z-0 hidden h-full w-[clamp(260px,27vw,400px)] overflow-visible md:block " +
        (side === "left" ? "left-0" : "right-0")
      }
    >
      {Array.from({ length: BANDS }).map((_, band) => (
        <motion.div
          key={band}
          className="absolute inset-0"
          style={reduced ? undefined : { y: ys[band], opacity: os[band] }}
        >
          {pieces
            .filter((p) => Math.min(BANDS - 1, Math.floor((p.z / (maxZ + 1)) * BANDS)) === band)
            .map((p, i) => (
              <div
                key={i}
                style={{
                  left: `${p.x * 100}%`,
                  bottom: p.y,
                  width: p.w,
                  marginLeft: -p.w / 2,
                  zIndex: p.z,
                  transform: `rotate(${p.rot}deg)`,
                }}
                className="absolute select-none"
              >
                {/* A plain <img>: six hundred next/image wrappers is six hundred components
                    for a decorative cut-out already encoded as webp and already sized. No
                    drop-shadow — at this density overlapping shadows stack into a grey
                    smudge behind the pile. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt="" draggable={false} className="h-auto w-full" loading="lazy" />
              </div>
            ))}
        </motion.div>
      ))}
    </div>
  )
}

export function PloyDrop() {
  const ref = useRef<HTMLDivElement>(null)
  /* Measured against the SECTION this sits in: the pile is fully down by the time the
     section's bottom reaches the bottom of the screen, and fully lifted before it enters. */
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] })
  const progress = useSpring(scrollYProgress, { stiffness: 60, damping: 22, restDelta: 0.001 })

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-0">
      <Mountain pieces={LEFT} side="left" progress={progress} />
      <Mountain pieces={RIGHT} side="right" progress={progress} />
    </div>
  )
}
