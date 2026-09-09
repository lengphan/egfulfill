"use client"

import { useRef } from "react"
import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { HOVER, enter, line } from "./motion"

/**
 * ONE OBJECT, ONE WORD.
 *
 * A single garment, enormous, cropped by the viewport, with the headline set across it.
 * Nothing else competes: one silhouette, one block of type. The garment drags and drifts.
 *
 * `overflow-x-clip`, NOT `overflow-hidden`. The garment is meant to bleed off the right edge
 * AND hang past the bottom into the block below. `overflow-hidden` on one axis forces the
 * other to `auto`, which put a horizontal scrollbar on the whole page — and a page you can
 * scroll sideways shifts every section left. `clip` cuts the sideways bleed without that, so
 * the vertical overhang survives.
 */
export function PloyHero({
  headline,
  accent,
  subhead,
  ctaPrimary,
  ctaSecondary,
}: {
  headline: string
  accent: string
  subhead: string
  ctaPrimary: string
  ctaSecondary: string
}) {
  const pen = useRef<HTMLDivElement>(null)
  const lines = [headline, accent].filter(Boolean)

  /**
   * THE TYPE SIZE COMES FROM THE COPY, because the copy is editable.
   *
   * The prototype was drawn around "Sell it. / We make it." — four and eleven characters —
   * and 11.5vw is right for that. The stored headline is "What if every order / printed
   * itself?", and at the same size it ran past the right edge of the page and straight
   * across the garment. Hard-coding a smaller size would then have wasted the page on a
   * short headline the day someone shortens it.
   *
   * So the ramp is chosen from the longest line. `whitespace-nowrap` stays deliberately:
   * each stored field is ONE line, and a headline that rewraps mid-phrase at some widths is
   * the thing the two fields exist to prevent.
   */
  const longest = Math.max(...lines.map((l) => l.length), 1)
  const size =
    longest <= 14 ? "clamp(3.25rem,11.5vw,11.5rem)"
    : longest <= 20 ? "clamp(2.5rem,7.6vw,7.5rem)"
    : longest <= 28 ? "clamp(2.1rem,5.6vw,5.6rem)"
    : "clamp(1.9rem,4.4vw,4.4rem)"

  return (
    <section className="relative z-10 overflow-x-clip">
      <div ref={pen} className="ploy-hero-card relative flex min-h-[100svh] flex-col justify-end md:min-h-[76svh]">
        {/* IT SCALES WITH THE VIEWPORT, IN STEPS. It used to go straight from a phone size to
            `md:h-[178%]`, so every width from 768px to about 1200px got the full desktop
            garment on a two-thirds-width page — sitting on the headline, the sub and both
            buttons at once. The height ramps 132 → 152 → 178 and the object walks in from the
            right edge as the room appears.

            ON A PHONE IT SITS AT THE TOP, not down the middle. The card is `justify-end`, so
            the type is bottom-aligned and the upper half is empty by design — the garment is
            what fills it. Lower down it did the opposite: left the top blank and sat behind
            the sub and both CTAs. */}
        <motion.div
          drag
          dragConstraints={pen}
          dragElastic={0.14}
          dragMomentum
          dragTransition={{ power: 0.5, timeConstant: 240, bounceStiffness: 220, bounceDamping: 24 }}
          whileDrag={{ scale: 1.02, cursor: "grabbing" }}
          initial={{ opacity: 0, scale: 0.86, y: 40 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ opacity: { duration: 0.9 }, scale: { duration: 1.1, ease: [0.22, 0.68, 0, 1] } }}
          className="absolute right-[-24%] top-[1%] z-0 w-[104vw] cursor-grab touch-none select-none md:right-[-6%] md:top-[6%] md:h-[132%] md:w-auto md:max-w-none lg:right-[-1%] lg:top-[4%] lg:h-[152%] xl:right-[2%] xl:top-[2%] xl:h-[178%]"
        >
          {/* The idle float is its OWN element, under the entrance. Two animations owning
              `scale` and `y` on one node fight and the object never appears (§4). */}
          <motion.div
            /**
             * A LIVELIER FLOAT (owner's call). It was 14px over 9 seconds, which on a garment
             * this size is about one percent of its height — slow enough that the eye reads
             * the hero as static and only notices the drift if it stares.
             *
             * 28px over 6.5s, and the tilt doubled to 3deg. Still eased at both ends, so it
             * is a drift rather than a bob: what makes an idle float look mechanical is a
             * constant speed and a hard turnaround, not the distance travelled.
             *
             * THE TWO TRACKS RUN ON DIFFERENT CLOCKS. Rotation takes 8.3s against the rise's
             * 6.5, so the pair only lines up every ~54 seconds instead of repeating a
             * recognisable loop every cycle — the same reasoning as the band objects in
             * globals.css, where a shared period was what made four objects look like one
             * mechanism.
             */
            animate={{ y: [0, -28, 0], rotate: [0, 3, 0] }}
            transition={{
              y: { duration: 6.5, repeat: Infinity, ease: "easeInOut", delay: 1 },
              rotate: { duration: 8.3, repeat: Infinity, ease: "easeInOut", delay: 1 },
            }}
            /* THE SOURCE RENDER IS PINK. The filter is what makes it the site's periwinkle,
               and it is here rather than baked into the file so the one asset can be
               re-tinted if the palette moves — the same reason no colour on this page is a
               literal. Measured against the render, not guessed: -62deg lands the hue on
               #C0C4FF, and the saturate/brightness pair keeps the vinyl highlights from
               going chalky once the hue moves. */
            style={{ filter: "hue-rotate(-62deg) saturate(1.35) brightness(1.04)" }}
            className="pointer-events-none h-full w-full drop-shadow-[0_60px_70px_rgba(33,33,33,0.22)]"
          >
            {/* `unoptimized` — and it is a QUALITY decision, not a performance one.
                These cut-outs are smooth-gradient 3D renders, the content webp handles worst.
                They are already encoded here at q93 and already sized for their largest slot,
                so letting next/image re-encode them at its q75 default was a SECOND lossy pass
                on top of the first, and the banding showed. Photographs (the method cards)
                keep the optimiser, because they tolerate it and they are the heavy ones. */}
            <Image
              src="/ploy/obj-hoodie.webp"
              alt="An inflated periwinkle hoodie"
              width={900}
              height={1232}
              priority
              unoptimized
              draggable={false}
              className="h-auto w-full md:h-full md:w-auto md:max-w-none"
            />
          </motion.div>
        </motion.div>

        {/* The type column is CAPPED, so it stops where the garment starts instead of running
            under it. Without a ceiling the sub and the buttons kept their own width while the
            hoodie grew toward them. */}
        <div className="pointer-events-none relative z-10 flex w-full max-w-[42rem] flex-col px-6 pb-8 pt-28 md:max-w-[46rem] md:px-[5.5rem] md:pb-14 md:pt-36 lg:max-w-[54rem] xl:max-w-none">
          <h1 className="ploy-display text-ploy-ink" style={{ fontSize: size }}>
            {lines.map((l, i) => (
              <motion.span key={l} {...line(i)} className="block whitespace-nowrap">
                {l}
              </motion.span>
            ))}
          </h1>
          {/* Sub and buttons stay in the type's column, LEFT — nothing sits on the garment
              at rest. */}
          <motion.p {...enter(0.35)} className="mt-8 max-w-md text-[17px] font-medium leading-relaxed text-ploy-ink/80">
            {subhead}
          </motion.p>
          <motion.div {...enter(0.45)} className="pointer-events-auto mt-7 flex flex-wrap items-center gap-3">
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link
                href="/signup"
                className="inline-block rounded-full bg-ploy-ink px-8 py-3.5 text-[15px] font-medium text-ploy-ground"
              >
                {ctaPrimary}
              </Link>
            </motion.div>
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link
                href="/catalog"
                className="inline-block rounded-full border border-ploy-ink/30 px-8 py-3.5 text-[15px] font-medium text-ploy-ink"
              >
                {ctaSecondary}
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
