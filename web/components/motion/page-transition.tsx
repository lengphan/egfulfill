"use client"

import { motion, useReducedMotion } from "motion/react"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

/**
 * Subtle per-route entrance: a quick OPACITY-only fade on each navigation. Keyed on
 * pathname so it re-fires when the route changes. Deliberately no vertical shift and a
 * short duration — the old fade+rise (y:10, 0.32s) read as the page "jumping" on every
 * nav, especially while the page was still fetching, which felt like flicker/jank.
 * Honors prefers-reduced-motion (instant).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion()
  const pathname = usePathname()
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: reduce ? 1 : 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.14, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  )
}
