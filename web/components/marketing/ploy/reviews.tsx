"use client"

import Image from "next/image"
import { motion } from "motion/react"
import { pop, reveal, rise } from "./motion"
import type { Testimonial } from "@/lib/site-content"

/**
 * REVIEWS — no photos, no star ratings, no scroll-pinning. Cards on a block.
 *
 * IT RENDERS NOTHING WHEN THERE ARE NO TESTIMONIALS, and that is deliberate rather than
 * defensive. The three that used to ship here were written, not collected; attributed quotes
 * from people who do not exist are the easiest thing for a marketplace reviewer to catch.
 * The stored list is empty, so this section is absent until a real seller gives us one — an
 * empty block with a heading over it would be worse than no block (§4).
 */
export function PloyReviews({ heading, items }: { heading: string; items: Testimonial[] }) {
  if (!items.length) return null

  return (
    <section className="px-6 pt-24 md:px-8 md:pt-32">
      <motion.div {...rise(0)} className="relative overflow-hidden rounded-[32px] bg-ploy-peri px-8 py-16 md:px-14 md:py-20">
        <div className="flex items-start justify-between gap-6">
          <h2 className="ploy-display max-w-[14ch] text-[clamp(2.25rem,5.5vw,4.5rem)] text-ploy-ink">
            <motion.span {...reveal(0)} className="block">
              {heading}
            </motion.span>
          </h2>
          <motion.span {...pop(0.2)} className="hidden shrink-0 md:block">
            <Image src="/ploy/obj-green.webp" alt="" width={200} height={204} className="h-auto w-[clamp(90px,9vw,150px)]" />
          </motion.span>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((t, i) => (
            <motion.figure
              key={t.quote}
              {...reveal(0.1 + i * 0.05)}
              className="flex flex-col justify-between rounded-2xl bg-ploy-paper p-6"
            >
              <blockquote className="text-[16px] leading-relaxed text-ploy-ink/85">“{t.quote}”</blockquote>
              <figcaption className="mt-6 text-[14px]">
                <span className="font-semibold">{t.name}</span>
                <span className="text-ploy-ink/55"> · {t.role}</span>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </motion.div>
    </section>
  )
}
