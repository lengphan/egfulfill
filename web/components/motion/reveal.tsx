"use client"

import { motion, useReducedMotion } from "motion/react"
import type { ReactNode } from "react"

const EASE = [0.21, 0.5, 0.28, 1] as const

/**
 * Scroll-triggered entrance: fades + slides its children up the first time they
 * enter the viewport. Honors prefers-reduced-motion (fade only, no transform).
 * Pass `className` through so it can double as a grid item (e.g. md:col-span-2).
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 16,
}: {
  children: ReactNode
  className?: string
  delay?: number
  y?: number
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.55, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}
