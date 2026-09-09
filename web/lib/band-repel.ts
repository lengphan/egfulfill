"use client"

import { useEffect, type RefObject } from "react"

/**
 * PUSH THINGS AWAY FROM THE POINTER.
 *
 * The band's figures loop forever whether or not anyone is looking, which is decoration by
 * definition. This is the opposite: nothing happens until a hand arrives, and then the whole
 * field answers it. It is the one motion here that is FEEDBACK rather than ornament.
 *
 * NO REACT STATE, and that is not an optimisation — it is the difference between working and
 * melting the machine. A 120Hz trackpad fires pointermove ~120 times a second; routing that
 * through setState re-renders the band and everything under it at 120fps. So the handler
 * writes two custom properties straight onto each element and React never hears about it.
 * globals.css already does exactly this for the marketing press effect, for the same reason.
 *
 * THE FALLOFF IS SQUARED, not linear. Linear makes the whole field lean toward the pointer
 * like a hillside; squared keeps distant elements still and gives the ones nearby a sharp
 * shove, which is what "repulsion" looks like rather than "tilt".
 *
 * THE RETURN IS A CSS TRANSITION on the element, not a spring in JS. Ending the gesture just
 * stops writing values; the transition carries everything home on its own, so there is no
 * animation loop left running when the pointer has gone.
 */
export function useBandRepel(
  container: RefObject<HTMLElement | null>,
  {
    selector = ".eg-repel",
    /** How far the shove reaches, in pixels. */
    radius = 190,
    /** How far the nearest element is pushed sideways, in pixels. */
    strength = 54,
    /**
     * The vertical share of that push. The band is ~90px tall and the figures fill it, so a
     * shove with equal authority on both axes does not part the field — it throws it out of
     * the frame, and you are left hovering over an empty stripe. Sideways is where the room
     * is. (Same reason the swim's vertical amplitude is a fraction of its horizontal one.)
     */
    verticalRatio = 0.28,
  }: { selector?: string; radius?: number; strength?: number; verticalRatio?: number } = {},
) {
  useEffect(() => {
    const el = container.current
    if (!el) return
    // Coarse pointers have no hover, so there is nothing to answer and no reason to listen.
    if (!window.matchMedia("(hover: hover)").matches) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    let raf = 0
    let px = 0
    let py = 0

    const apply = () => {
      raf = 0
      const nodes = el.querySelectorAll<HTMLElement>(selector)
      for (const n of nodes) {
        const r = n.getBoundingClientRect()
        const dx = r.x + r.width / 2 - px
        const dy = r.y + r.height / 2 - py
        const d = Math.hypot(dx, dy)
        if (d > radius || d === 0) {
          n.style.setProperty("--rx", "0px")
          n.style.setProperty("--ry", "0px")
          continue
        }
        const f = (1 - d / radius) ** 2 * strength
        n.style.setProperty("--rx", `${(dx / d) * f}px`)
        n.style.setProperty("--ry", `${(dy / d) * f * verticalRatio}px`)
      }
    }

    /* One rAF at a time: pointermove can fire several times per frame and each pass reads
       layout for every element, which is the shape that turns a nice effect into jank. */
    const onMove = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      if (!raf) raf = requestAnimationFrame(apply)
    }
    const onLeave = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      for (const n of el.querySelectorAll<HTMLElement>(selector)) {
        n.style.setProperty("--rx", "0px")
        n.style.setProperty("--ry", "0px")
      }
    }

    el.addEventListener("pointermove", onMove)
    el.addEventListener("pointerleave", onLeave)
    return () => {
      el.removeEventListener("pointermove", onMove)
      el.removeEventListener("pointerleave", onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [container, selector, radius, strength, verticalRatio])
}
