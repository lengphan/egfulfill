"use client"

import { motion, useReducedMotion } from "motion/react"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

/**
 * Subtle per-route entrance for the app shell: content fades + rises a touch on
 * each navigation. Keyed on pathname so it re-fires when the route changes.
 * Honors prefers-reduced-motion (fade only). Kept short so pages feel fast.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion()
  const pathname = usePathname()
  return (
    <motion.div
      key={pathname}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.21, 0.5, 0.28, 1] }}
    >
      {children}
    </motion.div>
  )
}
