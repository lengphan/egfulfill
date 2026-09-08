"use client"

import Image from "next/image"
import { motion, useReducedMotion } from "motion/react"

/**
 * THE PAGE ENDS BY DROPPING ITS OBJECTS ON THE FLOOR.
 *
 * WHY IT IS A PILE AND NOT A ROW. The first version put six objects at even intervals along
 * the bottom edge, and evenly spaced is the one arrangement that cannot read as fallen — it
 * reads as a shelf of ornaments, which is the "objects look random rather than placed"
 * problem in a different costume. Things that fall CLUSTER: they collect where they land,
 * they lean on each other, and the gaps between heaps are uneven. So these are four heaps at
 * uneven intervals, each with its own pieces overlapping at different heights and angles.
 *
 * THEY FALL FROM ABOVE THE FOLD, from behind the plan cards, so what a person sees is objects
 * entering the page rather than appearing in it. `-z-0` under the CTA's own `z-10` keeps them
 * BEHIND the headline on the way past: a chrome blob crossing "Stop touching orders" would be
 * the one moment the effect fought the sentence it is celebrating.
 *
 * THEY LAND ON A FLOOR, NEVER ON THE COPY. Every piece rests inside this strip, which sits
 * below the CTA and above the footer. Nothing is ever underneath one at rest.
 *
 * THEY STAY DRAGGABLE, which is the point of the whole device: an object you can pick up and
 * throw is the difference between a picture of a toy and a toy. `dragSnapToOrigin` returns
 * each to its heap, so one visitor cannot leave the pile dismantled for the next.
 *
 * REDUCED MOTION GETS THE PILE, NOT THE FALL. The objects are this band's content, so they
 * stay; it is the stagger and the bounce that would read as broken rather than absent.
 */

const CHROME = "/ploy/obj-chrome.webp"
const STAR = "/ploy/obj-star.webp"
const CLOUD = "/ploy/obj-cloud.webp"
const GREEN = "/ploy/obj-green.webp"

/**
 * Four heaps at UNEVEN intervals — 9 / 31 / 58 / 84 rather than quarters, because equal gaps
 * are what made the first attempt look measured out. Within a heap, `dx` overlaps the pieces,
 * `sit` stacks them at different heights, and `z` decides what leans in front of what.
 */
type Piece = { src: string; dx: number; w: number; sit: number; rot: number; delay: number; z: number }
const HEAPS: { at: number; pieces: Piece[] }[] = [
  {
    at: 9,
    pieces: [
      { src: CHROME, dx: -26, w: 118, sit: -4, rot: -16, delay: 0.02, z: 2 },
      { src: STAR, dx: 24, w: 72, sit: 6, rot: 24, delay: 0.16, z: 3 },
      { src: CLOUD, dx: 4, w: 96, sit: 34, rot: -6, delay: 0.3, z: 1 },
    ],
  },
  {
    at: 31,
    pieces: [
      { src: GREEN, dx: -18, w: 104, sit: -2, rot: 12, delay: 0.08, z: 2 },
      { src: CHROME, dx: 30, w: 66, sit: 10, rot: -22, delay: 0.24, z: 3 },
    ],
  },
  {
    at: 58,
    pieces: [
      { src: CLOUD, dx: -34, w: 132, sit: -6, rot: 7, delay: 0, z: 1 },
      { src: STAR, dx: 12, w: 88, sit: 4, rot: -18, delay: 0.19, z: 3 },
      { src: GREEN, dx: 44, w: 62, sit: 26, rot: 15, delay: 0.34, z: 2 },
    ],
  },
  {
    at: 84,
    pieces: [
      { src: CHROME, dx: -22, w: 92, sit: -3, rot: 19, delay: 0.11, z: 2 },
      { src: STAR, dx: 18, w: 58, sit: 14, rot: -11, delay: 0.27, z: 3 },
      { src: CLOUD, dx: 42, w: 74, sit: 30, rot: 9, delay: 0.4, z: 1 },
    ],
  },
]

export function PloyDrop() {
  const reduced = useReducedMotion()

  return (
    // The strip is decorative and must not swallow a click meant for the page; each piece
    // restores its own pointer events so it is still grabbable.
    <div
      aria-hidden
      className="pointer-events-none relative z-0 mt-6 h-[clamp(120px,15vw,210px)] w-full overflow-visible"
    >
      {HEAPS.flatMap((heap, hi) =>
        heap.pieces.map((p, pi) => (
          <motion.div
            key={`${hi}-${pi}`}
            drag
            dragSnapToOrigin
            dragElastic={0.5}
            dragTransition={{ bounceStiffness: 300, bounceDamping: 18 }}
            whileHover={{ scale: 1.06 }}
            whileDrag={{ scale: 1.12, cursor: "grabbing", zIndex: 30 }}
            /* -760 starts them above the plan cards, so they enter the page rather than
               appearing in it. */
            initial={reduced ? { opacity: 1, y: 0, rotate: p.rot } : { opacity: 0, y: -760, rotate: p.rot * 2.2 }}
            whileInView={{ opacity: 1, y: 0, rotate: p.rot }}
            viewport={{ once: true, margin: "-30px" }}
            transition={
              reduced
                ? { duration: 0 }
                : // A spring, because a fall is not an ease; low damping IS the bounce on
                  // landing, and the per-piece delay is what stops a heap arriving as a block.
                  { type: "spring", stiffness: 115, damping: 9.5, mass: 0.95, delay: p.delay }
            }
            style={{
              left: `calc(${heap.at}% + ${p.dx}px)`,
              width: p.w,
              bottom: p.sit,
              zIndex: p.z,
            }}
            className="pointer-events-auto absolute -translate-x-1/2 cursor-grab touch-none select-none"
          >
            <Image
              src={p.src}
              alt=""
              width={700}
              height={700}
              unoptimized
              draggable={false}
              className="h-auto w-full drop-shadow-[0_16px_24px_rgba(33,33,33,0.20)]"
            />
          </motion.div>
        )),
      )}
    </div>
  )
}
