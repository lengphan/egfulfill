"use client"

import { useEffect, useRef } from "react"
import Image from "next/image"
import { motion } from "motion/react"
import { HOVER, pop, reveal, rise } from "./motion"
import { Straddle } from "./straddle"
import { GUTTER, STACK } from "./rhythm"

/**
 * THE SEVEN DECORATIONS THE FLOOR RUNS — the same seven an order's SKU suffix carries
 * (-EMB -DTG -DTF -APL -LSR -SUB -SCR). Hardcoded rather than content-editable on purpose:
 * this is what the machines on the floor can do, not copy. It changes when a machine is
 * bought, and then it should be a code change someone reviews.
 */
const METHODS = [
  { name: "Embroidery", img: "emb", line: "Thread matched to your artwork in the Design Lab. Caps, hoodies, patches." },
  { name: "DTG", img: "dtg", line: "Full-colour ink straight into cotton. Photos, gradients, painterly work." },
  { name: "DTF", img: "dtf", line: "Transfer film for any fabric and any colour, with crisp edges." },
  { name: "Appliqué", img: "apl", line: "Layered twill and chenille, stitched down. The varsity look." },
  { name: "Laser", img: "lsr", line: "Etched patches and cut detail with a burnt, precise line." },
  { name: "Sublimation", img: "sub", line: "All-over print on polyester, edge to edge and into the seams." },
  { name: "Screen print", img: "scr", line: "Flat colour, thick ink, and the price that comes with a run." },
]

export function PloyMethods() {
  const rail = useRef<HTMLDivElement>(null)
  const paused = useRef(false)

  const go = (dir: 1 | -1) => {
    const el = rail.current
    if (!el) return
    const card = el.firstElementChild as HTMLElement | null
    const step = (card?.offsetWidth ?? 360) + 16
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8
    if (dir === 1 && atEnd) el.scrollTo({ left: 0, behavior: "smooth" })
    else el.scrollBy({ left: dir * step, behavior: "smooth" })
  }

  /**
   * The rail advances on its own every few seconds and wraps. It holds while a pointer is
   * over it or a finger is on it, and never runs under reduced motion.
   *
   * A TIMER, NOT AN EFFECT ON SCROLL STATE (§2.8). This effect depends on nothing — empty
   * deps, runs once, and the interval reads a ref rather than state. There is no condition
   * here that the scrolling can re-satisfy, which is the shape the runaway loader had.
   */
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const id = window.setInterval(() => {
      if (!paused.current) go(1)
    }, 3200)
    return () => window.clearInterval(id)
  }, [])

  return (
    <section id="methods" className={`relative ${GUTTER} ${STACK}`}>
      <motion.div {...rise(0)} className="overflow-hidden rounded-[32px] bg-ploy-sky py-16 md:py-20">
        <div className="px-8 md:px-14">
          <h2 className="ploy-display text-[clamp(2.5rem,6.5vw,5.5rem)]">
            <motion.span {...reveal(0)} className="block">
              Seven ways
            </motion.span>
            <motion.span {...reveal(0.1)} className="flex items-center gap-3">
              <span>to make</span>
              <motion.span {...pop(0.25)} className="inline-block">
                <Image src="/ploy/obj-chrome.webp" alt="" width={120} height={131} unoptimized className="h-[0.85em] w-auto" />
              </motion.span>
              <span>it.</span>
            </motion.span>
          </h2>

          <div className="mt-10 flex flex-col gap-6 md:ml-auto md:mt-4 md:max-w-xl">
            <motion.p {...reveal(0.2)} className="text-[17px] leading-relaxed text-ploy-ink/70">
              Every method runs in our own factory, so an order that mixes embroidery and DTG is still
              one order, one QC pass and one parcel.
            </motion.p>
            <motion.div {...reveal(0.3)} className="flex gap-2">
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous method"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-ploy-ink/25 text-ploy-ink/70 transition-colors hover:bg-ploy-paper"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next method"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-ploy-ink text-ploy-ground"
              >
                ›
              </button>
            </motion.div>
          </div>
        </div>

        <div
          ref={rail}
          onPointerEnter={() => (paused.current = true)}
          onPointerLeave={() => (paused.current = false)}
          onTouchStart={() => (paused.current = true)}
          onTouchEnd={() => (paused.current = false)}
          className="ploy-rail mt-12 flex gap-4 overflow-x-auto px-8 pb-2 md:px-14"
        >
          {METHODS.map((m, i) => (
            <motion.article
              key={m.name}
              {...reveal(0.1 + i * 0.05)}
              whileHover={{ y: -4 }}
              transition={HOVER}
              className="w-[300px] shrink-0 overflow-hidden rounded-2xl bg-ploy-paper sm:w-[360px]"
            >
              <div className="aspect-[4/3] overflow-hidden bg-ploy-sky/40">
                <Image
                  src={`/ploy/method-${m.img}.webp`}
                  alt={`${m.name} on a garment`}
                  width={1000}
                  height={1000}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="p-6">
                <p className="text-[24px] font-semibold">{m.name}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-ploy-ink/65">{m.line}</p>
              </div>
            </motion.article>
          ))}
        </div>
      </motion.div>
      {/* `drop` is 56, not 0: this block ends in a card rail rather than in padding, and at 0
          the upper half of the star reached back up onto the last card's copy. */}
      <Straddle src="/ploy/obj-star.webp" side="right" inset="8%" width="clamp(110px,10vw,160px)" drop={56} drift={[12, -8]} dur={6.5} />
    </section>
  )
}
