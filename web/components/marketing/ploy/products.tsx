"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { HOVER, pop, reveal, rise } from "./motion"

/**
 * THE PRODUCTS PAGE — one garment shot large, then every other one shot identically.
 *
 * THE BLANKS ARE OUR OWN PHOTOGRAPHY, and they are not product listings. Each is a garment
 * TYPE with the methods it can take, and it carries no price, no sku and no buy button —
 * because inventing those is exactly the fake-catalogue §4 forbids. The real products, with
 * real prices, come from the API below and link to their own pages.
 *
 * ONE SHOOT, AND THAT IS THE DESIGN. Every blank is framed from the collarbone down, front
 * facing, same distance, same grey trousers, same periwinkle seamless, same light. The
 * uniformity is the point: twelve garments shot twelve ways read as twelve stock photos,
 * and the same twelve shot once read as a catalogue. The generated frames were cropped to a
 * common scale afterwards rather than trusted — the camera distance varied between them.
 */

/** The garments we keep as blanks. `methods` are the floor's own suffixes (§5). */
const BLANKS = [
  { img: "hoodie", name: "Heavyweight hoodie", methods: ["Embroidery", "DTG", "DTF"] },
  { img: "tee", name: "Classic tee", methods: ["DTG", "DTF", "Screen print"] },
  { img: "crew", name: "Crewneck sweatshirt", methods: ["Embroidery", "DTG", "Appliqué"] },
  { img: "longsleeve", name: "Long-sleeve tee", methods: ["DTG", "DTF"] },
  { img: "zip", name: "Zip hoodie", methods: ["Embroidery", "DTF"] },
  { img: "varsity", name: "Varsity jacket", methods: ["Appliqué", "Embroidery"] },
]
const HEADWEAR = [
  { img: "cap", name: "Six-panel cap", methods: ["Embroidery", "Laser"] },
  { img: "beanie", name: "Cuffed beanie", methods: ["Embroidery"] },
]

/** Every method any blank takes, in the floor's own order — derived from BLANKS/HEADWEAR so
 *  a tab can never be offered that matches nothing. */
const ALL = [...BLANKS, ...HEADWEAR]

export function PloyProducts({
  headline,
  accent,
  lead,
}: {
  headline: string
  accent: string
  lead: string
}) {
  const [method, setMethod] = useState("All")
  const methods = useMemo(() => {
    const set = new Set<string>()
    for (const b of ALL) for (const m of b.methods) set.add(m)
    return ["All", ...[...set].sort()]
  }, [])
  const blanks = BLANKS.filter((b) => method === "All" || b.methods.includes(method))
  const headwear = HEADWEAR.filter((b) => method === "All" || b.methods.includes(method))
  return (
    <div className="bg-ploy-ground text-ploy-ink">
      {/* ── ONE GARMENT, LARGE ─────────────────────────────────────────────── */}
      <section className="relative px-6 pt-24 md:px-8 md:pt-28">
        <motion.div
          {...rise(0)}
          className="relative overflow-hidden rounded-[32px] bg-ploy-peri px-8 pt-14 md:px-14 md:pt-16"
        >
          <div className="grid items-end gap-8 md:grid-cols-[1.05fr_0.95fr]">
            <div className="pb-10 md:pb-16 md:pt-4">
              <h1 className="ploy-display text-[clamp(2rem,4.4vw,3.8rem)]">
                <motion.span {...reveal(0)} className="block">{headline}</motion.span>
                <motion.span {...reveal(0.1)} className="block">{accent}</motion.span>
              </h1>
              <motion.p {...reveal(0.2)} className="mt-6 max-w-md text-[17px] leading-relaxed text-ploy-ink/70">
                {lead}
              </motion.p>
              <motion.div {...reveal(0.3)} className="mt-8 flex flex-wrap items-center gap-3">
                <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
                  <Link href="/signup" className="inline-block rounded-full bg-ploy-ink px-7 py-3 text-[15px] font-medium text-ploy-ground">
                    Start free
                  </Link>
                </motion.div>
                <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
                  <Link href="/pricing" className="inline-block rounded-full border border-ploy-ink/30 px-7 py-3 text-[15px] font-medium text-ploy-ink">
                    See pricing
                  </Link>
                </motion.div>
              </motion.div>
            </div>

            {/* A FRAMED INSET THAT BLEEDS OFF THE BOTTOM, not a bare image on the fill.
                The photograph carries its own periwinkle seamless, and it is not the same
                periwinkle as this block — dropped straight onto the fill it read as a pasted
                rectangle with a seam down two sides. Rounding the top corners and running it
                off the bottom edge makes that boundary a deliberate frame instead of a
                mismatch, which is the section grammar the rest of the site already uses.
                Height is capped and the crop is `top`, so the garment keeps its scale
                whatever the viewport does rather than driving the band's height. */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.22, 0.68, 0, 1] }}
              className="relative -mb-px h-[clamp(300px,40vw,520px)] self-end overflow-hidden rounded-t-2xl"
            >
              <Image
                src="/ploy/blank/hoodie.webp"
                alt="A model wearing a blank heavyweight hoodie, framed from the collarbone down"
                width={900}
                height={1200}
                priority
                className="h-full w-full object-cover object-top"
              />
            </motion.div>
          </div>
        </motion.div>
        {/* NO STRADDLE ON THIS EDGE. It sat bottom-left, which is where the two CTAs are, and
            an object on a button is the one thing a straddle must never be. The band already
            has a photograph doing the work an object would; the page's object is the chrome
            in the heading below. */}
      </section>

      {/* ── EVERY OTHER ONE, SHOT IDENTICALLY ──────────────────────────────── */}
      <section className="px-6 pt-24 md:px-8 md:pt-32">
        <h2 className="ploy-display text-[clamp(2.2rem,5.4vw,4.4rem)]">
          <motion.span {...reveal(0)} className="block">Every blank,</motion.span>
          <motion.span {...reveal(0.08)} className="flex items-center gap-3">
            <span>shot the same</span>
            <motion.span {...pop(0.2)} className="inline-block">
              <Image src="/ploy/obj-chrome.webp" alt="" width={120} height={131} unoptimized className="h-[0.85em] w-auto" />
            </motion.span>
            <span>way.</span>
          </motion.span>
        </h2>
        <motion.p {...reveal(0.15)} className="mt-5 max-w-lg text-[17px] leading-relaxed text-ploy-ink/70">
          Same crop, same light, same seamless. What changes between these frames is the garment
          and nothing else.
        </motion.p>

        {/* A RULE UNDER THE LIVE WORD, never a row of capsules (§4). This is a FIELD — you
            set it — so it wears no fill and no button chrome, and the underline is the only
            active treatment. It filters by what each garment can actually be decorated with,
            which is the only question worth asking of a blank. */}
        <motion.div {...reveal(0.2)} className="mt-10 -mb-px flex gap-6 overflow-x-auto border-b border-ploy-ink/15">
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              aria-pressed={method === m}
              className={
                "-mb-px shrink-0 border-b-2 pb-3 text-[15px] transition-colors " +
                (method === m
                  ? "border-ploy-ink font-medium text-ploy-ink"
                  : "border-transparent text-ploy-ink/55 hover:text-ploy-ink")
              }
            >
              {m}
            </button>
          ))}
        </motion.div>

        <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
          {blanks.map((b, i) => (
            <motion.article
              key={b.img}
              {...reveal(0.05 * i)}
              whileHover={{ y: -4 }}
              transition={HOVER}
              className="overflow-hidden rounded-2xl bg-ploy-paper"
            >
              <div className="aspect-[4/5] overflow-hidden bg-ploy-sky">
                <Image
                  src={`/ploy/blank/${b.img}.webp`}
                  alt={`A model wearing a blank ${b.name.toLowerCase()}, framed from the collarbone down`}
                  width={960}
                  height={1200}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="p-4 md:p-5">
                <p className="text-[17px] font-semibold md:text-[19px]">{b.name}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ploy-ink/55">{b.methods.join(" · ")}</p>
              </div>
            </motion.article>
          ))}
        </div>

        {/* Headwear cannot be shot from the collarbone down, so it is its own pair rather
            than two odd frames in a grid that is uniform by definition. */}
        <div className="mt-3 grid grid-cols-2 gap-3 md:mt-4 md:gap-4">
          {headwear.map((b, i) => (
            <motion.article
              key={b.img}
              {...reveal(0.05 * i)}
              whileHover={{ y: -4 }}
              transition={HOVER}
              className="flex items-center gap-4 overflow-hidden rounded-2xl bg-ploy-paper p-3 md:gap-6 md:p-5"
            >
              <div className="aspect-square w-[38%] shrink-0 overflow-hidden rounded-xl bg-ploy-sky">
                <Image src={`/ploy/blank/${b.img}.webp`} alt={`A blank ${b.name.toLowerCase()}`} width={900} height={900} loading="lazy" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0">
                <p className="text-[17px] font-semibold md:text-[19px]">{b.name}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ploy-ink/55">{b.methods.join(" · ")}</p>
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      {/* THE LIVE CATALOGUE GRID WAS REMOVED HERE (owner's call, 2026-09-08).
          It listed the published products straight from /api/public/products, and it worked —
          but its rows are supplier stock photography on white, next to an art-directed shoot
          on periwinkle, and the seam between the two halves was the loudest thing on the page.

          WHAT THIS COSTS, so it is not rediscovered: /catalog no longer links to any
          /catalog/[slug] page, so those detail pages are reachable only from the sitemap and
          have no internal links pointing at them. The route, the fetch and the allow-list are
          all untouched and the grid is about twenty lines to restore — the right moment is
          when the catalogue has photography that belongs beside the blanks above. */}
    </div>
  )
}
