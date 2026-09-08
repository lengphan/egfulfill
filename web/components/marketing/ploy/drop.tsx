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
const LEFT: Piece[] = [
  // base — the heaviest pieces, overlapping hard so the foot of the pile is solid
  { src: CHROME, dx: 4, w: 128, sit: 0, rot: -12, delay: 0, z: 1 },
  { src: CLOUD, dx: 74, w: 134, sit: 2, rot: 8, delay: 0.06, z: 1 },
  { src: GREEN, dx: 146, w: 116, sit: 0, rot: 15, delay: 0.12, z: 1 },
  { src: CHROME, dx: 206, w: 104, sit: 4, rot: -9, delay: 0.18, z: 1 },
  // second course, sitting in the gaps of the first
  { src: STAR, dx: 42, w: 92, sit: 54, rot: 18, delay: 0.28, z: 2 },
  { src: GREEN, dx: 112, w: 98, sit: 58, rot: -14, delay: 0.35, z: 2 },
  { src: CLOUD, dx: 178, w: 86, sit: 52, rot: 10, delay: 0.42, z: 2 },
  // third
  { src: CHROME, dx: 76, w: 84, sit: 106, rot: -16, delay: 0.52, z: 3 },
  { src: STAR, dx: 140, w: 76, sit: 110, rot: 12, delay: 0.6, z: 3 },
  // apex
  { src: GREEN, dx: 106, w: 62, sit: 156, rot: -7, delay: 0.72, z: 4 },
]

const RIGHT: Piece[] = [
  { src: CLOUD, dx: -212, w: 122, sit: 0, rot: 10, delay: 0.04, z: 1 },
  { src: CHROME, dx: -142, w: 136, sit: 3, rot: -13, delay: 0.1, z: 1 },
  { src: GREEN, dx: -70, w: 114, sit: 0, rot: 14, delay: 0.16, z: 1 },
  { src: CLOUD, dx: -8, w: 100, sit: 4, rot: -8, delay: 0.22, z: 1 },
  { src: STAR, dx: -180, w: 90, sit: 56, rot: -19, delay: 0.3, z: 2 },
  { src: CHROME, dx: -110, w: 96, sit: 60, rot: 13, delay: 0.38, z: 2 },
  { src: GREEN, dx: -42, w: 84, sit: 54, rot: -11, delay: 0.45, z: 2 },
  { src: CLOUD, dx: -146, w: 80, sit: 108, rot: 9, delay: 0.55, z: 3 },
  { src: STAR, dx: -76, w: 74, sit: 112, rot: -15, delay: 0.63, z: 3 },
  { src: CHROME, dx: -112, w: 58, sit: 158, rot: 6, delay: 0.75, z: 4 },
]

function Heap({ pieces, side }: { pieces: Piece[]; side: "left" | "right" }) {
  const reduced = useReducedMotion()
  /**
   * THE HEAP WATCHES, NOT THE PIECES.
   *
   * Each piece used to carry its own `whileInView`, and none of them ever fired: a piece
   * starts 820px ABOVE where it lands, so its box at mount is off the top of the section and
   * the observer never saw it enter. They sat transparent and high, which is why the page
   * rendered nineteen objects and showed none.
   *
   * One observer on the container — which is where it belongs anyway, because a heap should
   * begin falling as a heap rather than each piece deciding for itself.
   */
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: "-80px" })
  return (
    <div
      ref={ref}
      aria-hidden
      className={
        "pointer-events-none absolute bottom-0 hidden h-full w-[clamp(300px,30vw,440px)] md:block " +
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
              : /**
                 * SLOW AND SOFT. It was stiffness 115 / damping 9.5 — a drop with a hard
                 * bounce, and sixteen of those read as things thrown at the page rather than
                 * settling onto it. A weak spring with real mass takes roughly twice as long
                 * and lands with one small give. The long delays let a heap assemble piece by
                 * piece while you watch, which is the part that reads as graceful.
                 */
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
            /* NO DROP-SHADOW ON THE PIECES. Each carried one, and eight overlapping in a heap
                stack into a grey smudge behind the pile — a rectangle of haze that reads as a
                box someone forgot to remove. The renders already carry their own lighting and
                contact shadow; a CSS shadow on top of a rendered object is a second light
                source from a different direction. */
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
