/**
 * MOTION FOR THE MARKETING HOME, matched to the prototype's measured curves.
 *
 *   reveal  0.7s  cubic-bezier(0.34, 1.56, 0.64, 1)  — the 1.56 overshoots, so everything
 *                                                      lands with a slight back-out bounce
 *   rise    0.9s  cubic-bezier(0.22, 0.68, 0, 1)     — long expo ease-out, for big panels
 *   hover   0.2s
 *
 * EVERYTHING IS SCROLL-TRIGGERED AND FIRES ONCE (`viewport: { once: true }`). Nothing here
 * is scroll-LINKED except the steps' pipe, which owns its own MotionValue in that component.
 * That distinction is the reason this page cannot develop the fault §2.8 describes: a
 * triggered reveal is an event, it cannot re-fire on state it wrote, and `once` means the
 * observer detaches after the first crossing.
 *
 * Reduced motion is handled by <MotionConfig reducedMotion="user"> in ploy-home.tsx rather
 * than by a check in each preset — one place to be right, and it covers hover and drag too.
 */
export const BACK = [0.34, 1.56, 0.64, 1] as const
export const EXPO = [0.22, 0.68, 0, 1] as const

export const reveal = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-90px" },
  transition: { duration: 0.7, delay, ease: BACK },
})

/** For large panels and media that travel further. */
export const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 56 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-90px" },
  transition: { duration: 0.9, delay, ease: EXPO },
})

/** An object pops in — scale from small, with the back-out overshoot. */
export const pop = (delay = 0) => ({
  initial: { opacity: 0, scale: 0.6, rotate: -8 },
  whileInView: { opacity: 1, scale: 1, rotate: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.9, delay, ease: BACK },
})

/** Display lines arrive one after another, not as a block. */
export const line = (index: number) => reveal(index * 0.08)

/**
 * Above the fold, animate on MOUNT rather than in view. A `whileInView` with a -90px margin
 * never fires for the last 90px of the viewport — which is exactly where the hero's CTAs sit,
 * so they stayed at opacity 0 until the first scroll.
 */
export const enter = (delay: number) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: BACK },
})

export const HOVER = { duration: 0.2 }
