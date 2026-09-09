"use client"

import { useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { HOVER, reveal } from "./motion"
import { GUTTER, SECTION, TOP } from "./rhythm"
import type { PublicProduct } from "@/lib/api"
/* THE CANONICAL SPLITTER, not a second one. `normalizeMethods` already splits a combined
   value ("DTG printing / Embroidery") and de-dupes by normalised key — I had re-derived that
   here as methods-of.ts, which is exactly the private copy §5 warns about. */
import { normalizeMethods } from "@/lib/print-method"
import { sizeRangeLabel } from "@/lib/size-order"
/* The canonical swatch resolver — the same one the catalogue grid and the app product page
   read, so one colour name cannot render three ways across the product (§5). */
import { swatchChipStyle } from "@/lib/color-swatch"

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

/**
 * THE CATEGORIES THE LIVE CATALOGUE ACTUALLY USES, each with a photograph of its own.
 *
 * `key` is matched against `PublicProduct.category` verbatim — these are not labels invented
 * for the page, they are the four values the published products carry. A category with no
 * products simply does not draw, so this list going stale shows as an absence rather than as
 * a tile that filters to nothing.
 *
 * The photographs are ours, shot to one direction (periwinkle seamless, one soft key). They
 * are illustrative of the CATEGORY, not of any product in it — which is why a tile carries a
 * count and never a price.
 */
const CATEGORIES: { key: string; img: string }[] = [
  { key: "Apparel", img: "hoodie" },
  { key: "Headwear", img: "cap" },
  { key: "Bags", img: "bag" },
  { key: "Other", img: "other" },
]

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
  const railRef = useRef<HTMLDivElement>(null)
  /* One card plus its gap, read off the DOM rather than assumed — the tile width changes at
     md and a hardcoded step would overshoot on one of the two. */
  const nudgeRail = (dir: 1 | -1) => {
    const el = railRef.current
    if (!el) return
    const card = el.firstElementChild as HTMLElement | null
    el.scrollBy({ left: dir * ((card?.offsetWidth ?? 240) + 16), behavior: "smooth" })
  }

  const [cat, setCat] = useState("All")
  const [method, setMethod] = useState("All")

  /* Both lists are DERIVED from what the catalogue actually holds, so neither can offer an
     option that matches nothing. Methods are split and normalised first — see methods-of.ts. */
  const categories = useMemo(
    () => ["All", ...[...new Set((products ?? []).map((p) => p.category).filter((c): c is string => !!c))].sort()],
    [products],
  )
  const methodTabs = useMemo(
    () => ["All", ...normalizeMethods((products ?? []).flatMap((p) => p.methods ?? [])).map((m) => m.label)],
    [products],
  )

  const visible = useMemo(
    () =>
      (products ?? []).filter(
        (p) =>
          (cat === "All" || p.category === cat) &&
          (method === "All" || normalizeMethods(p.methods ?? []).some((m) => m.label === method)),
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

      {/* ── THE CATEGORIES ────────────────────────────────────────────────────
          It was a rail of eight garments under an eyebrow reading "the blanks we keep". Two
          problems: the eyebrow was a caption nobody needed, and the row was a scroll with no
          control on it — the last tile was clipped with no way to reach it. These are the
          catalogue's OWN four categories now, each a button that sets the filter below, with
          arrows so the row is navigable rather than merely scrollable. */}
      <section className={`${GUTTER} ${SECTION}`}>
        <div className="mb-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => nudgeRail(-1)}
            aria-label="Previous categories"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-ploy-ink/25 text-ploy-ink/70 transition-colors hover:bg-ploy-paper"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => nudgeRail(1)}
            aria-label="Next categories"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-ploy-ink text-ploy-ground"
          >
            ›
          </button>
        </div>

        <div ref={railRef} className="ploy-rail flex gap-3 overflow-x-auto pb-2 md:gap-4">
          {CATEGORIES.map((c, i) => {
            const n = (products ?? []).filter((p) => p.category === c.key).length
            if (products && n === 0) return null
            const live = cat === c.key
            return (
              <motion.button
                key={c.key}
                type="button"
                {...reveal(0.05 * i)}
                onClick={() => { setCat(live ? "All" : c.key); document.getElementById("catalogue")?.scrollIntoView({ behavior: "smooth", block: "start" }) }}
                aria-pressed={live}
                className="w-[210px] shrink-0 text-left md:w-[260px]"
              >
                <div className={"aspect-[4/5] overflow-hidden rounded-2xl bg-ploy-sky ring-2 transition-all " + (live ? "ring-ploy-ink" : "ring-transparent")}>
                  <Image
                    src={`/ploy/blank/${c.img}.webp`}
                    alt={`${c.key} we print on`}
                    width={960}
                    height={1200}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                <p className="mt-3 text-[16px] font-semibold">{c.key}</p>
                <p className="mt-0.5 text-[13px] text-ploy-ink/55">
                  {products === null ? "—" : `${n} ${n === 1 ? "product" : "products"}`}
                </p>
              </motion.button>
            )
          })}
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
                <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
                  {visible.map((p, i) => (
                    <motion.div key={p.slug} {...reveal(0.03 * Math.min(i, 8))} whileHover={{ y: -4 }} transition={HOVER}>
                      <Link href={`/catalog/${p.slug}`} className="block">
                        {/* SQUARE, NOT 4:5. Three tall frames on a wide screen made one product
                            fill the fold, so scanning the catalogue meant scrolling it. Four
                            square ones show a row at a glance, which is what a grid is for. */}
                        <div className="aspect-square overflow-hidden rounded-2xl bg-ploy-paper">
                          {/* The image is served from OUR url — the public shape resolves the
                              supplier's address server-side, so it never reaches this markup
                              (§2.9). No image is an honest blank tile, never a placeholder. */}
                          {p.image ? (
                            <Image src={p.image} alt={p.name} width={600} height={600} loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full" />
                          )}
                        </div>
                        {/* THE COLOURWAYS, DIRECTLY UNDER THE PHOTO (owner's call, 2026-09-09).
                            The line below already said "10 colours", which is a COUNT — it
                            tells you how many there are and nothing about which, so a buyer
                            deciding between two garments had to open both. The swatches are
                            the same object the app's product page uses (swatchChipStyle),
                            at the size that reads without becoming a second control: this is
                            a card, not a picker, so nothing here is clickable and the whole
                            card stays one link.
                            EIGHT, then a count. A supplier style carries forty-plus, and a
                            wall of dots under every tile is the grid's shape gone. */}
                        {p.colors?.length ? (
                          <div className="mt-3 flex items-center gap-1.5">
                            {p.colors.slice(0, 8).map((c) => (
                              <span
                                key={c.name}
                                title={c.name}
                                aria-hidden
                                className="size-3.5 shrink-0 rounded-full border border-ploy-ink/15"
                                style={swatchChipStyle(c.name, c.image)}
                              />
                            ))}
                            {p.colors.length > 8 && (
                              <span className="text-[12px] font-medium tabular-nums text-ploy-ink/45">+{p.colors.length - 8}</span>
                            )}
                          </div>
                        ) : null}
                        <p className="mt-3 truncate text-[15px] font-semibold">{p.name}</p>
                        {/* WHAT YOU NEED TO TELL TWO PRODUCTS APART: how many colourways, what
                            sizes, and the price. `sizeRangeLabel` is the shared ladder — the
                            stored order is arbitrary ("S, M, XL, 3XL, 4XL, 2XL" on a live row),
                            so printing it raw would read as noise.

                            NO SKU, and that is not an omission: a blank's sku maps to supplier
                            stock, so §2.9 withholds it from every unauthenticated surface. The
                            public API does not publish it and this page could not show it. */}
                        {/* THE COUNT WENT WITH THE SWATCHES ARRIVING. "10 colours" above a
                            row of ten dots is the same fact twice, and the overflow chip
                            already says how many did not fit. Sizes stay: there is no
                            swatch for a size range. */}
                        <p className="mt-1 text-[13px] text-ploy-ink/55">{sizeRangeLabel(p.sizes)}</p>
                        <p className="mt-0.5 text-[14px] font-medium tabular-nums text-ploy-ink">
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
