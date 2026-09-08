"use client"

import Image from "next/image"
import { motion } from "motion/react"
import { BACK } from "./motion"

/**
 * A STRADDLE: one object sitting across the edge between two sections.
 *
 * It is absolutely positioned off the BOTTOM of the section it lives in, so part of it hangs
 * over the block that follows — the join between two colours becomes the thing the eye lands
 * on. One per edge, alternating sides, NEVER over text.
 *
 * `drop` is how far below the section's bottom edge the object's centre sits, and it is not
 * decoration: a block that ends in PADDING can carry `drop={0}` and be centred on the join,
 * but a block that ends in a card rail cannot — at 0 the upper half of a 160px object reaches
 * back up onto the last card's copy. Check what the section ends in before choosing it.
 *
 * Desktop only. On a phone the sections stack too tightly for anything to straddle them
 * without landing on the words.
 */
export function Straddle({
  src,
  alt = "",
  side,
  inset,
  width,
  drop,
  drift = [10, 4],
  dur = 8,
}: {
  src: string
  alt?: string
  side: "left" | "right"
  /** distance from that side, as a CSS length like "6%" */
  inset: string
  /** a CSS width, usually a clamp() so it tracks the viewport */
  width: string
  /** how far the object's centre sits below the section's bottom edge, in px */
  drop: number
  drift?: [number, number]
  dur?: number
}) {
  return (
    <motion.div
      drag
      dragSnapToOrigin
      dragElastic={0.45}
      dragTransition={{ bounceStiffness: 280, bounceDamping: 18 }}
      whileDrag={{ scale: 1.05, cursor: "grabbing" }}
      whileHover={{ scale: 1.04 }}
      initial={{ opacity: 0, scale: 0.6, rotate: -10 }}
      whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.9, ease: BACK }}
      style={{ [side]: inset, width, bottom: -drop, transform: "translateY(50%)" }}
      className="absolute z-30 hidden cursor-grab touch-none select-none md:block"
    >
      {/* The float is on its OWN element. It was on the image together with the entrance
          scale, and §4's rule applies: one element must never own the same property from two
          animations — they fight, and the object simply never appears. */}
      <motion.div
        animate={{ y: [0, drift[0], 0], rotate: [0, drift[1], 0] }}
        transition={{ duration: dur, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none drop-shadow-[0_30px_40px_rgba(33,33,33,0.16)]"
      >
        <Image src={src} alt={alt} width={700} height={700} unoptimized draggable={false} className="h-auto w-full" />
      </motion.div>
    </motion.div>
  )
}
