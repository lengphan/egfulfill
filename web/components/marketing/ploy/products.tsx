"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { HOVER, pop, reveal } from "./motion"
import { GUTTER, SECTION, TOP } from "./rhythm"
import type { PublicProduct } from "@/lib/api"
import { methodsAcross, methodsOf } from "./methods-of"

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

/** The blanks, as one row. */
const ALL = [...BLANKS, ...HEADWEAR]

/**
 * ONE FILTER, DRAWN AS A LIST. No pills, no band, no chrome — §4 calls a filter a FIELD, and
 * the least a field can wear is its own words. The live option is the only one that is ink;
 * everything else is muted, which is the whole active treatment.
 */
function FilterList({
  head,
  options,
  value,
  onChange,
  className = "",
}: {
  head: string
  options: string[]
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  return (
    <div className={className}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ploy-ink/40">{head}</p>
      <ul className="mt-4 flex flex-col gap-2.5">
        {options.map((o) => (
          <li key={o}>
            <button
              type="button"
              onClick={() => onChange(o)}
              aria-pressed={value === o}
              className={
                "text-left text-[15px] transition-colors " +
                (value === o ? "font-semibold text-ploy-ink" : "text-ploy-ink/55 hover:text-ploy-ink")
              }
            >
              {o}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PloyProducts({
  products,
  headline,
  accent,
  lead,
}: {
  /** null means the read FAILED. [] means the catalogue is genuinely empty. §4 — those are
   *  different facts and the block below says which. */
  products: PublicProduct[] | null
  headline: string
  accent: string
  lead: string
}) {
  const [cat, setCat] = useState("All")
  const [method, setMethod] = useState("All")

  /* Both lists are DERIVED from what the catalogue actually holds, so neither can offer an
     option that matches nothing. Methods are split and normalised first — see methods-of.ts. */
  const categories = useMemo(
    () => ["All", ...[...new Set((products ?? []).map((p) => p.category).filter((c): c is string => !!c))].sort()],
    [products],
  )
  const methodTabs = useMemo(() => ["All", ...methodsAcross(products ?? [])], [products])

  const visible = useMemo(
    () =>
      (products ?? []).filter(
        (p) =>
          (cat === "All" || p.category === cat) &&
          (method === "All" || methodsOf(p).includes(method)),
      ),
    [products, cat, method],
  )

  return (
    <div className="bg-ploy-ground text-ploy-ink">
      {/* ── THE OPENER: TYPE ON THE GROUND ────────────────────────────────
          It was a giant periwinkle card carrying one garment at full height. Two things were
          wrong with it: the rail directly below shows that same garment among seven others, so
          the card said nothing the next section did not say better — and every other page here
          (/pricing, /how-it-works, /integrations) opens with plain type on the page ground, so
          this was the one page whose opener was a different KIND of thing. Type, then the
          photography, then the products. */}
      <section className={`${GUTTER} ${TOP}`}>
        {/* NO OBJECT IN THIS HEADLINE. The chrome sits in the next heading, and the two are on
            screen together at the top of the page — one object twice in a viewport reads as a
            repeat rather than as a motif. The opener is type; the rail below is the picture. */}
        <h1 className="ploy-display text-[clamp(2.4rem,6vw,5rem)]">
          <motion.span {...reveal(0)} className="block">{headline}</motion.span>
          <motion.span {...reveal(0.1)} className="block">{accent}</motion.span>
        </h1>
        <motion.p {...reveal(0.2)} className="mt-6 max-w-xl text-[17px] leading-relaxed text-ploy-ink/70">
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
      </section>

      {/* ── THE SHOOT ──────────────────────────────────────────────────────── */}
      <section className={`${GUTTER} ${SECTION}`}>
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

        {/* A RAIL, NOT A SECOND GRID.
            This was a grid of cards with its own method filter, directly above the catalogue's
            grid of cards with ITS own method filter — two shops on one page, and a visitor
            asking "what can I get?" has no reason to care which is which. These are not
            products: they are the PHOTOGRAPHY, the house blanks shot one way. So they read as
            a filmstrip you scan, and the one grid and the one filter below belong to the
            things that actually have prices and pages. */}
        <div className="ploy-rail mt-10 flex gap-3 overflow-x-auto pb-2 md:gap-4">
          {ALL.map((b, i) => (
            <motion.figure key={b.img} {...reveal(0.04 * i)} className="w-[210px] shrink-0 md:w-[260px]">
              <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-ploy-sky">
                <Image
                  src={`/ploy/blank/${b.img}.webp`}
                  alt={`A blank ${b.name.toLowerCase()}`}
                  width={960}
                  height={1200}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
              <figcaption className="mt-3">
                <p className="text-[16px] font-semibold">{b.name}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ploy-ink/55">{b.methods.join(" · ")}</p>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </section>

      {/* ── THE CATALOGUE: A LIST TO FILTER BY, AND THE PRODUCTS ──────────────
          It was a periwinkle band with a row of tabs across it, and the tabs were built from
          the raw `methods` entries — which are COMPOUND strings in the live data, so it
          offered "DTG printing / Embroidery / Appliqué / Laser / DTF printing" as if that
          were one method, beside a separate tab reading "DTG". See methods-of.ts.

          The filter is a plain list in a column now: no band, no pills, no chrome. It is the
          shape a catalogue filter has everywhere because it is the one that works — you can
          see every option at once, the current one is legible, and it costs a click rather
          than a horizontal scroll. Two lists, ANDed, and a count in the heading so the
          filter's effect is visible without scrolling the grid. */}
      <section className={`${GUTTER} ${SECTION}`} id="catalogue">
        <h2 className="ploy-display text-[clamp(2rem,4.4vw,3.8rem)]">
          <motion.span {...reveal(0)} className="block">
            Products{products ? ` (${visible.length})` : ""}
          </motion.span>
        </h2>

        {products === null ? (
          <p className="mt-8 max-w-md text-[16px] leading-relaxed text-ploy-ink/70">
            The catalogue could not be loaded just now. This is our end, not yours — the
            products are still there.{" "}
            <Link href="/contact" className="underline underline-offset-4">Tell us</Link> if it stays this way.
          </p>
        ) : products.length === 0 ? (
          <p className="mt-8 max-w-md text-[16px] leading-relaxed text-ploy-ink/70">
            Nothing is published to the public catalogue yet. The blanks above are what the
            factory keeps — <Link href="/signup" className="underline underline-offset-4">start free</Link> and
            you can order any of them.
          </p>
        ) : (
          <div className="mt-10 grid gap-10 md:grid-cols-[190px_1fr] md:gap-12">
            {/* The list STICKS, so it is still there when you are six rows down — the whole
                point of a sidebar over a tab strip. `top-24` clears the fixed header. */}
            <aside className="md:sticky md:top-24 md:self-start">
              <FilterList
                head="Category"
                options={categories}
                value={cat}
                onChange={setCat}
              />
              <FilterList
                head="Print method"
                options={methodTabs}
                value={method}
                onChange={setMethod}
                className="mt-8 border-t border-ploy-ink/10 pt-8"
              />
            </aside>

            <div>
              {visible.length === 0 ? (
                <p className="text-[16px] leading-relaxed text-ploy-ink/70">
                  Nothing matches that pair yet. <button type="button" onClick={() => { setCat("All"); setMethod("All") }} className="underline underline-offset-4">Clear the filters</button>.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
                  {visible.map((p, i) => (
                    <motion.div key={p.slug} {...reveal(0.03 * Math.min(i, 8))} whileHover={{ y: -4 }} transition={HOVER}>
                      <Link href={`/catalog/${p.slug}`} className="block">
                        <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-ploy-paper">
                          {/* The image is served from OUR url — the public shape resolves the
                              supplier's address server-side, so it never reaches this markup
                              (§2.9). No image is an honest blank tile, never a placeholder. */}
                          {p.image ? (
                            <Image src={p.image} alt={p.name} width={600} height={750} loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full" />
                          )}
                        </div>
                        <p className="mt-3 truncate text-[15px] font-semibold">{p.name}</p>
                        <p className="mt-0.5 text-[13px] tabular-nums text-ploy-ink/55">
                          {p.priceVaries ? "from " : ""}${Number.isInteger(p.priceFrom ?? p.price) ? (p.priceFrom ?? p.price) : (p.priceFrom ?? p.price).toFixed(2)}
                        </p>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

    </div>
  )
}
