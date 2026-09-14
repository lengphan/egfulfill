"use client"

import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { HOVER, enter, line } from "./motion"

/**
 * ONE GARMENT, ONE WORD — and the garment is PHOTOGRAPHED.
 *
 * IT WAS A 3D RENDER: an inflated vinyl hoodie, hue-rotated from pink to the site's
 * periwinkle, dragged and drifting. Two things were wrong with it and only one was visual.
 *
 * THE VISUAL ONE. "Phantom renders, we photograph" is this site's identity — everything that
 * sells the factory sells it by showing the real thing, which is why the method cards are
 * close-ups of actual DTG and actual chenille and why /how-it-works is four photographs. A
 * glossy plastic balloon of a hoodie is the single loudest way to say the opposite, and it
 * was the FIRST thing on the page.
 *
 * THE MEASURED ONE. It hung past its own section by design (`xl:h-[178%]`) and landed on the
 * paragraph below. Measured against the steps section's opening paragraph, the render covered
 * 43% of it at 1440, 65% at 1280 and 77% at 1024 — the copy was simply unreadable at every
 * common laptop width, while the comment beside it said the type column "is clear ground
 * because the garment hangs right." It is clear ground only above about 1700px, which is
 * where it was looked at.
 *
 * SO THE OBJECT IS NOW HELD BY ITS SECTION. The photograph bleeds off the right edge and to
 * the bottom of the hero, and the hero CLIPS it — `overflow-clip` on both axes rather than
 * `overflow-x-clip`. That is the fix rather than a smaller height, because a height is a
 * number that has to be right at every width and a clip is right at all of them. Nothing
 * below this section can be reached by anything in it.
 *
 * NO DRAG AND NO FLOAT. Both were properties of an object that hovered; a photograph set into
 * the page is not hovering, and a rectangle that tilts 3 degrees reads as a mistake rather
 * than as life. The entrance stays.
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
    /* `overflow-clip` on BOTH axes. The photograph bleeds off the right edge and past the
       bottom of its own frame, and this is what stops the overhang reaching the section
       below — see the note at the top of this file for the measurements that made it
       necessary. `clip` rather than `hidden` because `hidden` on one axis forces the other to
       `auto`, which put a horizontal scrollbar on the whole page and shifted every section
       left. */
    <section className="relative z-10 overflow-clip">
      <div className="ploy-hero-card relative flex min-h-[100svh] flex-col justify-end md:min-h-[76svh]">
        {/* THE PHOTOGRAPH. It scales with the viewport in the same three steps the render
            did — the object walks in from the right as the room appears — but it is anchored
            to the BOTTOM of the card rather than the top, so the crop that goes off-screen is
            always the same crop (the model's legs) instead of the head at one width and the
            shoulders at another.

            ON A PHONE it fills the upper half: the card is `justify-end`, so the type is
            bottom-aligned and the space above it is the picture's. */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ opacity: { duration: 0.9 }, scale: { duration: 1.1, ease: [0.22, 0.68, 0, 1] } }}
          /* A SOFT LEFT EDGE, and it is the reason the headline can still be set across the
             picture. A photograph is a RECTANGLE where the render was a silhouette, so the
             panel's left edge arrived as a hard vertical seam — and at 1440 it fell through
             the middle of the word MAKE, with the M on the page ground and AKE on the
             photograph. A line of type crossing a soft edge reads as one line on a picture; a
             line crossing a hard one reads as two halves of a line that do not match.

             A mask rather than a gradient overlay, because an overlay would have to be the
             page's exact ground colour and this page's ground moves with the skin. */
          style={{
            maskImage: "linear-gradient(to right, transparent 0%, #000 22%)",
            WebkitMaskImage: "linear-gradient(to right, transparent 0%, #000 22%)",
          }}
          className="pointer-events-none absolute bottom-0 right-0 top-0 z-0 w-[104vw] select-none md:w-[62%] lg:w-[58%] xl:w-[54%]"
        >
          {/* NO `unoptimized` HERE. That flag was a QUALITY decision for the render — a
              smooth-gradient 3D cut-out is what webp handles worst, and next/image's q75
              default was a second lossy pass that banded it. A photograph is the opposite
              case: it tolerates the optimiser and it is the heavy asset, so it keeps it,
              exactly as the method cards do. */}
          <Image
            src="/ploy/blank/hoodie.webp"
            alt="A cream blank hoodie worn against a periwinkle backdrop"
            width={960}
            height={1200}
            priority
            draggable={false}
            className="h-full w-full object-cover object-[55%_28%]"
          />
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
