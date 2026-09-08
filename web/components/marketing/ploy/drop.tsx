"use client"

import Image from "next/image"
import { motion, useReducedMotion } from "motion/react"

/**
 * THE LAST THING THE PAGE DOES — a handful of objects fall in and land on the floor.
 *
 * WHY THIS REPLACED A STRADDLE. The plans block ended with one cloud centred on its bottom
 * edge, and two things were wrong with it: it kept finding its way onto the "Start free"
 * button underneath (a straddle must never sit on text, and that edge has a control on it),
 * and one object hovering over a join reads as decoration that got stuck there. Objects that
 * ARRIVE — that fall, bounce and settle — read as the page finishing rather than as a sticker.
 *
 * THEY LAND ON A FLOOR, NOT ON THE COPY. Every one is positioned along the section's bottom
 * edge and drops to it, so the CTA and its form are never underneath one at rest. The pile is
 * the page's last line, and there is nothing after it to cover.
 *
 * THEY STAY DRAGGABLE once landed, and that is the point of the whole device: an object you
 * can pick up and throw is the difference between a picture of a toy and a toy. `dragSnapToOrigin`
 * returns each to its place, so the pile cannot be dismantled into a mess by one visitor.
 *
 * REDUCED MOTION GETS THE PILE, NOT THE FALL. The objects are the content of this band, so
 * they are still there — they simply do not travel. MotionConfig's `reducedMotion="user"`
 * would already suppress the transform, but the STAGGER and the bounce are the parts that
 * would read as broken rather than absent, so this opts out explicitly.
 */

/** Position is a percentage from the left, size a clamp, so the pile reflows with the page.
 *  Ordered by landing time — the heavy things first, which is the order that reads as gravity
 *  rather than as a list animating in.
 *
 *  `sit` is a few pixels of vertical variance. Six objects resting on one exact line read as a
 *  shelf of ornaments; a dozen pixels of difference between them reads as things that fell. */
const PIECES = [
  { src: "/ploy/obj-chrome.webp", left: "8%", w: "clamp(84px,9vw,132px)", delay: 0, spin: -14, sit: -6 },
  { src: "/ploy/obj-cloud.webp", left: "23%", w: "clamp(96px,11vw,168px)", delay: 0.12, spin: 9, sit: 4 },
  { src: "/ploy/obj-star.webp", left: "41%", w: "clamp(70px,7.5vw,112px)", delay: 0.05, spin: 22, sit: -12 },
  { src: "/ploy/obj-green.webp", left: "59%", w: "clamp(80px,8.5vw,124px)", delay: 0.2, spin: -11, sit: 2 },
  { src: "/ploy/obj-chrome.webp", left: "75%", w: "clamp(58px,6vw,88px)", delay: 0.16, spin: 17, sit: -9 },
  { src: "/ploy/obj-star.webp", left: "88%", w: "clamp(52px,5.5vw,80px)", delay: 0.28, spin: -20, sit: 6 },
]

export function PloyDrop() {
  const reduced = useReducedMotion()

  return (
    // `pointer-events-none` on the strip, restored per object: the band is decorative and
    // must not swallow a click meant for the page, but each object is still grabbable.
    <div aria-hidden className="pointer-events-none relative h-[clamp(90px,12vw,170px)] w-full overflow-visible">
      {PIECES.map((p, i) => (
        <motion.div
          key={i}
          drag
          dragSnapToOrigin
          dragElastic={0.5}
          dragTransition={{ bounceStiffness: 300, bounceDamping: 18 }}
          whileHover={{ scale: 1.05 }}
          whileDrag={{ scale: 1.1, cursor: "grabbing", zIndex: 20 }}
          initial={reduced ? { opacity: 1, y: 0, rotate: 0 } : { opacity: 0, y: -420, rotate: p.spin * 2 }}
          whileInView={{ opacity: 1, y: 0, rotate: p.spin }}
          viewport={{ once: true, margin: "-40px" }}
          transition={
            reduced
              ? { duration: 0 }
              : // A SPRING, because a fall is not an ease. Low damping is the bounce when it
                // lands; the delay is what stops six objects arriving as one block.
                { type: "spring", stiffness: 120, damping: 9, mass: 0.9, delay: p.delay }
          }
          style={{ left: p.left, width: p.w, bottom: p.sit }}
          className="pointer-events-auto absolute bottom-0 -translate-x-1/2 cursor-grab touch-none select-none"
        >
          <Image
            src={p.src}
            alt=""
            width={700}
            height={700}
            unoptimized
            draggable={false}
            className="h-auto w-full drop-shadow-[0_18px_26px_rgba(33,33,33,0.18)]"
          />
        </motion.div>
      ))}
    </div>
  )
}
