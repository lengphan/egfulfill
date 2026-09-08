"use client"

import Image from "next/image"
import { useRef } from "react"
import { motion, useInView, useReducedMotion } from "motion/react"

/**
 * THE PAGE ENDS BY PILING ITS OBJECTS UP EITHER SIDE OF THE SIGN-UP CARD.
 *
 * WHERE THEY GO. They were a strip along the bottom, which added height to a page that did
 * not need more and left the real empty space — the wide margins either side of a 590px form
 * — untouched. Two heaps flanking the card fill exactly that space and FRAME the one control
 * the page is asking a person to use, rather than sitting below it as a separate band.
 *
 * WHY THEY ARE DENSE. A few pieces spaced out reads as things placed next to each other. A
 * heap is a SILHOUETTE — a wide base of the heaviest pieces, a packed middle resting between
 * them, and something small on top — so `sit` climbs while `w` shrinks and `dx` narrows up
 * each list, and the pieces overlap hard rather than clearing each other.
 *
 * THEY NEVER TOUCH THE CARD. Each heap is anchored to its own side and capped in width, and
 * the CTA's content sits at `z-10` above this layer, so a piece can pass BEHIND the headline
 * on the way down but nothing rests on top of a word or the email field.
 *
 * BELOW md THEY ARE NOT DRAWN AT ALL. On a phone the form is the full width of the page and
 * there are no margins to fill; the heaps would be behind the thing they exist to frame.
 *
 * REDUCED MOTION GETS THE PILES, NOT THE FALL. They are this band's content, so they stay —
 * it is the stagger and the settle that would read as broken rather than absent.
 */

const CHROME = "/ploy/obj-chrome.webp"
const STAR = "/ploy/obj-star.webp"
const CLOUD = "/ploy/obj-cloud.webp"
const GREEN = "/ploy/obj-green.webp"

type Piece = { src: string; dx: number; w: number; sit: number; rot: number; delay: number; z: number }

/** Base lands first and the apex last, because that is the order a heap is built and the
 *  order gravity would deliver it. `z` rises with the stack so it reads toward the viewer. */
/**
 * THE MOUND FILLS ITS MARGIN. It used to sit in the outer corner about 250px wide, which left
 * a corridor of empty ground between the pile and the sign-up card — the exact space it was
 * put there to occupy. It now spans the full width of the margin and climbs in five courses,
 * so the heap reaches from the page edge to the card and from the floor to roughly the card's
 * own height.
 *
 * Five courses, narrowing as they rise — 5 / 4 / 3 / 2 / 1 — which is what gives a heap its
 * triangle. The base overlaps hard so the foot reads as solid rather than as a row of
 * separate objects, and every course lands before the one above it, because that is the order
 * gravity would deliver it.
 */
const LEFT: Piece[] = [
  // base
  { src: CHROME, dx: -14, w: 134, sit: 0, rot: -12, delay: 0, z: 1 },
  { src: CLOUD, dx: 66, w: 142, sit: 3, rot: 8, delay: 0.05, z: 1 },
  { src: GREEN, dx: 152, w: 124, sit: 0, rot: 15, delay: 0.1, z: 1 },
  { src: CHROME, dx: 232, w: 130, sit: 4, rot: -9, delay: 0.15, z: 1 },
  { src: STAR, dx: 312, w: 112, sit: 0, rot: 20, delay: 0.2, z: 1 },
  // second course
  { src: GREEN, dx: 26, w: 112, sit: 60, rot: 13, delay: 0.28, z: 2 },
  { src: CLOUD, dx: 110, w: 118, sit: 64, rot: -11, delay: 0.33, z: 2 },
  { src: CHROME, dx: 196, w: 106, sit: 58, rot: 16, delay: 0.38, z: 2 },
  { src: GREEN, dx: 274, w: 100, sit: 62, rot: -14, delay: 0.43, z: 2 },
  // third
  { src: STAR, dx: 70, w: 98, sit: 120, rot: -17, delay: 0.5, z: 3 },
  { src: CHROME, dx: 152, w: 104, sit: 124, rot: 10, delay: 0.55, z: 3 },
  { src: CLOUD, dx: 234, w: 92, sit: 118, rot: -8, delay: 0.6, z: 3 },
  // fourth
  { src: GREEN, dx: 110, w: 86, sit: 176, rot: 12, delay: 0.68, z: 4 },
  { src: STAR, dx: 186, w: 80, sit: 180, rot: -13, delay: 0.73, z: 4 },
  // apex
  { src: CHROME, dx: 150, w: 64, sit: 232, rot: 7, delay: 0.84, z: 5 },
]

const RIGHT: Piece[] = [
  { src: CLOUD, dx: -14, w: 130, sit: 0, rot: 11, delay: 0.03, z: 1 },
  { src: CHROME, dx: -70, w: 140, sit: 3, rot: -13, delay: 0.08, z: 1 },
  { src: GREEN, dx: -154, w: 122, sit: 0, rot: 14, delay: 0.13, z: 1 },
  { src: CLOUD, dx: -234, w: 128, sit: 4, rot: -7, delay: 0.18, z: 1 },
  { src: STAR, dx: -314, w: 110, sit: 0, rot: 18, delay: 0.23, z: 1 },
  { src: CHROME, dx: -30, w: 110, sit: 60, rot: -12, delay: 0.3, z: 2 },
  { src: GREEN, dx: -112, w: 116, sit: 64, rot: 14, delay: 0.35, z: 2 },
  { src: CLOUD, dx: -198, w: 104, sit: 58, rot: -15, delay: 0.4, z: 2 },
  { src: STAR, dx: -276, w: 98, sit: 62, rot: 9, delay: 0.45, z: 2 },
  { src: CHROME, dx: -72, w: 96, sit: 120, rot: 16, delay: 0.52, z: 3 },
  { src: GREEN, dx: -154, w: 102, sit: 124, rot: -10, delay: 0.57, z: 3 },
  { src: STAR, dx: -236, w: 90, sit: 118, rot: 13, delay: 0.62, z: 3 },
  { src: CLOUD, dx: -112, w: 84, sit: 176, rot: -11, delay: 0.7, z: 4 },
  { src: CHROME, dx: -188, w: 78, sit: 180, rot: 8, delay: 0.75, z: 4 },
  { src: GREEN, dx: -152, w: 62, sit: 232, rot: -6, delay: 0.86, z: 5 },
]

function Heap({ pieces, side }: { pieces: Piece[]; side: "left" | "right" }) {
  const reduced = useReducedMotion()
  /**
   * THE HEAP WATCHES, NOT THE PIECES.
   *
   * Each piece used to carry its own `whileInView`, and none of them ever fired: a piece
   * starts 820px ABOVE where it lands, so its box at mount is off the top of the section and
   * the observer never saw it enter. They sat transparent and high, which is why the page
   * rendered nineteen objects and showed none. One observer on the container — which is where
   * it belongs anyway, because a heap should begin falling as a heap.
   */
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: "-80px" })
  return (
    <div
      ref={ref}
      aria-hidden
      className={
        "pointer-events-none absolute bottom-0 hidden h-full w-[clamp(300px,34vw,470px)] md:block " +
        (side === "left" ? "left-0" : "right-0")
      }
    >
      {pieces.map((p, i) => (
        <motion.div
          key={i}
          drag
          dragSnapToOrigin
          dragElastic={0.5}
          dragTransition={{ bounceStiffness: 260, bounceDamping: 20 }}
          whileHover={{ scale: 1.06 }}
          whileDrag={{ scale: 1.12, cursor: "grabbing", zIndex: 30 }}
          /* Starts above the fold so a piece ENTERS the page rather than appearing in it. */
          initial={reduced ? { opacity: 1, y: 0, rotate: p.rot } : { opacity: 0, y: -820, rotate: p.rot * 2 }}
          animate={inView || reduced ? { opacity: 1, y: 0, rotate: p.rot } : undefined}
          transition={
            reduced
              ? { duration: 0 }
              : /* Slow and soft. A stiff spring with low damping reads as things thrown at the
                   page; a weak one with real mass takes about twice as long and lands with one
                   small give. The long delays let a heap assemble course by course. */
                { type: "spring", stiffness: 30, damping: 14, mass: 1.8, delay: p.delay }
          }
          style={{ [side]: p.dx, width: p.w, bottom: p.sit, zIndex: p.z }}
          className="pointer-events-auto absolute cursor-grab touch-none select-none"
        >
          <Image
            src={p.src}
            alt=""
            width={700}
            height={700}
            unoptimized
            draggable={false}
            /* NO DROP-SHADOW. Eight overlapping in a heap stack into a grey smudge that reads
               as a box behind the pile; the renders already carry their own contact shadow. */
            className="h-auto w-full"
          />
        </motion.div>
      ))}
    </div>
  )
}

/**
 * FOUR LAYOUTS, so the arrangement can be judged rather than argued about. `mound` is the
 * shipped one; the rest exist for /preview/heaps and are cheap to delete once one is chosen.
 */
export type DropVariant = "mound" | "column" | "drift" | "arc"

/** A tall narrow stack hugging the outer edge — the pieces climb rather than spread. */
const COL_L: Piece[] = LEFT.map((p, i) => ({ ...p, dx: 20 + (i % 2) * 46, sit: i * 46, w: Math.round(p.w * 0.82) }))
const COL_R: Piece[] = RIGHT.map((p, i) => ({ ...p, dx: -(20 + (i % 2) * 46), sit: i * 46, w: Math.round(p.w * 0.82) }))

/** Low and wide — nothing stacks more than two deep, so it reads as scattered, not piled. */
const DRIFT_L: Piece[] = LEFT.map((p, i) => ({ ...p, dx: i * 34, sit: (i % 2) * 34, w: Math.round(p.w * 0.9) }))
const DRIFT_R: Piece[] = RIGHT.map((p, i) => ({ ...p, dx: -(i * 34), sit: (i % 2) * 34, w: Math.round(p.w * 0.9) }))

/** A shallow arc, highest at the outer edge and falling toward the card. */
const ARC_L: Piece[] = LEFT.map((p, i) => ({ ...p, dx: 10 + i * 30, sit: Math.round(150 - Math.pow(i - 0, 1.6) * 12), w: Math.round(p.w * 0.86) }))
const ARC_R: Piece[] = RIGHT.map((p, i) => ({ ...p, dx: -(10 + i * 30), sit: Math.round(150 - Math.pow(i - 0, 1.6) * 12), w: Math.round(p.w * 0.86) }))

const SETS: Record<DropVariant, [Piece[], Piece[]]> = {
  mound: [LEFT, RIGHT],
  column: [COL_L, COL_R],
  drift: [DRIFT_L, DRIFT_R],
  arc: [ARC_L, ARC_R],
}

export function PloyDrop({ variant = "mound" }: { variant?: DropVariant }) {
  const [left, right] = SETS[variant] ?? SETS.mound
  return (
    <>
      <Heap pieces={left} side="left" />
      <Heap pieces={right} side="right" />
    </>
  )
}
