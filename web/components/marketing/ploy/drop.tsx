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
  { src: CHROME, dx: 10, w: 132, sit: 0, rot: -12, delay: 0, z: 1 },
  { src: CLOUD, dx: 96, w: 140, sit: 4, rot: 7, delay: 0.08, z: 1 },
  { src: GREEN, dx: 176, w: 118, sit: 0, rot: 16, delay: 0.16, z: 1 },
  { src: STAR, dx: 54, w: 96, sit: 62, rot: 19, delay: 0.3, z: 2 },
  { src: CHROME, dx: 140, w: 104, sit: 70, rot: -17, delay: 0.4, z: 2 },
  { src: CLOUD, dx: 8, w: 88, sit: 96, rot: 11, delay: 0.5, z: 2 },
  { src: GREEN, dx: 104, w: 78, sit: 132, rot: -9, delay: 0.62, z: 3 },
  { src: STAR, dx: 58, w: 60, sit: 178, rot: 14, delay: 0.76, z: 3 },
]

const RIGHT: Piece[] = [
  { src: CLOUD, dx: -186, w: 126, sit: 0, rot: 9, delay: 0.05, z: 1 },
  { src: CHROME, dx: -100, w: 144, sit: 2, rot: -14, delay: 0.13, z: 1 },
  { src: GREEN, dx: -16, w: 112, sit: 0, rot: 12, delay: 0.21, z: 1 },
  { src: STAR, dx: -142, w: 92, sit: 64, rot: -21, delay: 0.34, z: 2 },
  { src: CLOUD, dx: -54, w: 100, sit: 72, rot: 15, delay: 0.45, z: 2 },
  { src: CHROME, dx: -118, w: 82, sit: 120, rot: 8, delay: 0.58, z: 3 },
  { src: STAR, dx: -34, w: 74, sit: 128, rot: -11, delay: 0.68, z: 3 },
  { src: GREEN, dx: -84, w: 58, sit: 176, rot: 17, delay: 0.82, z: 3 },
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
            className="h-auto w-full drop-shadow-[0_14px_22px_rgba(33,33,33,0.20)]"
          />
        </motion.div>
      ))}
    </div>
  )
}

export function PloyDrop() {
  return (
    <>
      <Heap pieces={LEFT} side="left" />
      <Heap pieces={RIGHT} side="right" />
    </>
  )
}
