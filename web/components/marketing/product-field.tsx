"use client"

import { useState } from "react"
import Link from "next/link"
import { swatchHex, readableOn } from "@/lib/color-swatch"
import type { PublicProduct } from "@/lib/api"
import { TabBar } from "@/components/app/tab-bar"
import { INK, SURFACE } from "@/components/marketing/bold-kit"

/**
 * ── THE RAIL — one style per rail, hung in its colour run ────────────────────────────────
 *
 * Three rails: a hoodie, a crewneck, a tee. Each one runs the colourways that style is
 * actually sold in. The track moves; putting the pointer on a rail stops that row; clicking a
 * garment opens it.
 *
 * THE AXIS WAS THE OTHER WAY ROUND AND IT WAS WRONG. Colour used to run down the page and
 * form across it, which needs MANY FORMS to fill a row — and there are three. Every version
 * of that field was padded with the same garment repeated, and it read as wallpaper because
 * that is what it was. Turned ninety degrees the problem disappears: a Gildan 18500 is sold
 * in 47 colours and an 18000 in 41, so a rail of one style in its colour run never runs out
 * and never repeats. It is also what a shop rail literally is — one style, hung in a size and
 * colour run, which is why the arrangement reads as a rack without having to be told.
 *
 * WHY IT MOVES. A static field has to be composed, and a composed field reads as a layout
 * with gaps in it. A moving one reads as STOCK: there is more of this, it is going past, you
 * are seeing a window onto it.
 *
 * WHY IT STOPS. A rail you cannot stop is a rail you cannot use. Hover pauses the whole ROW,
 * not the garment under the cursor — pausing one while its neighbours slid on would move the
 * thing you were reaching for, which is the opposite of aiming.
 *
 * NO JAVASCRIPT IN THE LOOP. A CSS transform animation: it never touches layout, never
 * repaints, never re-renders React. §2.8's runaway loader was an EFFECT fetching on a
 * condition its own fetch satisfied — state feeding itself. There is no state here, which is
 * exactly why this is CSS and not a rAF ticking a React value.
 *
 * THERE IS NO CARD. No border, no fill, no radius, no CSS shadow — a garment hangs on the
 * canvas rather than sitting in a box on it.
 *
 * A STYLE WITH NO PUBLISHED PRODUCT GETS NO RAIL — see FORM_SLUG.
 */

export type FormId = "hoodie" | "crew" | "tee"

/** The garment names as a visitor would say them — never the supplier's catalogue title. */
const FORM_LABEL: Record<FormId, string> = {
  hoodie: "Heavy blend hoodie",
  crew: "Heavy blend crewneck",
  tee: "Heavyweight cotton tee",
}

/**
 * THE PRODUCT EACH RAIL IS OF — checked against the live catalogue, not assumed.
 *
 * A slug that is not published resolves to nothing and its ENTIRE RAIL is dropped, which is
 * the correct failure: the page can go stale in only one direction, toward showing less than
 * we sell, never toward showing something we do not. The crewneck sits here and is not in the
 * catalogue, so its rail does not draw — deliberately, because sending someone who clicked a
 * crewneck to a hooded sweatshirt is the wrong product, not an approximation.
 */
const FORM_SLUG: Record<FormId, string> = {
  hoodie: "comfort-colors-ring-spun-hooded-sweatshirt-1567",
  crew: "gildan-heavy-blend-crewneck-sweatshirt-18000",
  tee: "gildan-unisex-heavy-cotton-t-shirt",
}

/**
 * THE COLOUR RUN. Real Gildan colourway names off the 18000 and 18500, dyed from one
 * photograph per style rather than generated per colour — see tools/dye-rail.py. Order is a
 * merchandiser's, not a data one: it ALTERNATES LIGHT AND DARK rather than running the
 * neutrals together. Sorted by value it put natural, sand, ash and sport grey side by side —
 * four near-whites that read as one washed-out stretch of rail before jumping to pink.
 * Alternating gives the row a rhythm, which is both how a rack is actually hung and what
 * stops a colour run reading as a paint chart.
 */
const COLOURWAYS = [
  { slug: "natural", name: "Natural" },
  { slug: "navy", name: "Navy" },
  { slug: "sand", name: "Sand" },
  { slug: "black", name: "Black" },
  { slug: "ash", name: "Ash" },
  { slug: "maroon", name: "Maroon" },
  { slug: "sport-grey", name: "Sport Grey" },
  { slug: "forest", name: "Forest" },
  { slug: "light-pink", name: "Light Pink" },
  { slug: "charcoal", name: "Charcoal" },
  { slug: "gold", name: "Gold" },
  { slug: "royal", name: "Royal" },
] as const

const RAILS: FormId[] = ["hoodie", "crew", "tee"]

/** One full pass. Slower than it feels it should be: this is ambient, not a carousel. */
const DURATION: Record<FormId, string> = { hoodie: "82s", crew: "94s", tee: "88s" }

/* WebP, not PNG: these are photographs WITH an alpha channel, which is the case PNG handles
   worst. Resized to 820px — twice the tallest height the rail ever renders — because a
   1050x1500 canvas is four times the pixels anyone can see, and 24 of them was 14MB a page. */
const srcOf = (form: FormId, colour: string) => `/frames/rail-${form}-${colour}.webp`

function Garment({ form, colour, name, price, i, cloned }: {
  form: FormId
  colour: string
  name: string
  price: number
  /** Position along the track — drives the variation below. */
  i: number
  /** In the loop's second copy: the same garment again, so it stays out of the a11y tree. */
  cloned: boolean
}) {
  /*
   * A RACK IS NEVER UNIFORM, and the absence of that is what made an early version read as
   * wallpaper. Two free moves fix it without touching the photograph:
   *
   * MIRRORING. A flipped garment is a different silhouette to the eye — the sleeve is on the
   * other side, the light falls the other way — while remaining the same honest picture of the
   * same product. It is not a claim about range; it is the same shirt turned round, which is
   * exactly what it would be on a rail where people put things back however they came off.
   *
   * LENGTH. Hangers sit at different depths on a bar, so garments hang a little unevenly. A
   * few percent is enough; more reads as a mistake rather than as a rack.
   */
  const flip = i % 2 === 1
  const lengthJitter = 1 - ((i * 37) % 11) / 90
  const tagBg = swatchHex(name) ?? INK
  return (
    <Link
      href={`/catalog/${FORM_SLUG[form]}`}
      aria-hidden={cloned || undefined}
      tabIndex={cloned ? -1 : undefined}
      aria-label={`${FORM_LABEL[form]} in ${name}`}
      className="group relative block shrink-0 focus-visible:outline-none"
      /* SIZED BY HEIGHT. Garments on a rail hang to a common length and differ in BULK — the
         hoodie comes out visibly broader than the tee because its photograph is, which is the
         difference a shopper actually sees. Width follows from the picture. */
      style={{ height: `calc(var(--rail-h) * ${lengthJitter})`, width: "auto" }}
    >
      <span
        className="eg-sway flex h-full flex-col items-center"
        style={{ ["--sway-dur" as string]: `${5.4 + ((i * 13) % 7) * 0.42}s`, animationDelay: `-${(i * 17) % 9}s` }}
      >
        {/* THE HOOK is a stroke, not an image. Matting eats a thin bright wire against a pale
            ground, and drawing it is better anyway: one hook at one height on every garment,
            so the rail's line is guaranteed by construction rather than by what the camera did
            that frame. `origin-top` on the garment means the hover lift grows DOWN from the
            hook — scaling from the centre would lift a shirt off its own hanger. */}
        <svg viewBox="0 0 24 26" className="mx-auto block h-[22px] w-[24px]" aria-hidden="true" fill="none">
          <path
            d="M12 26V9M12 9c0-3.2 2-5 4.2-5 1.9 0 3.3 1.4 3.3 3.1"
            stroke={INK}
            strokeOpacity="0.42"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={srcOf(form, colour)}
          alt=""
          className="block origin-top transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.05] motion-safe:group-focus-visible:scale-[1.05]"
          style={{ height: "calc(100% - 22px)", width: "auto", transform: flip ? "scaleX(-1)" : undefined }}
        />
      </span>
      {/*
        * THE TAG NAMES THE COLOUR AND THE PRICE — on this rail every garment is the same style,
        * so the colour is the only thing that differs and therefore the only thing worth
        * saying. It wears that colour: the hex is the real orderable value out of
        * lib/color-swatch, the same table the catalogue's chips read, so a tag and a chip can
        * never disagree. Text colour is computed from the background rather than fixed,
        * because Natural needs ink and Navy needs white.
        *
        * §4 reserves the pill for stage meaning and forbids it for tags; this is neither — it
        * is a hover readout of where the click leads, which is why it is `rounded-lg` like
        * every other control rather than `rounded-full`. Centred UNDER the garment, because on
        * a rail the neighbour is a few percent away and a label to the side lands on it.
        */}
      <span
        className="pointer-events-none absolute left-1/2 top-full z-10 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ background: tagBg, color: readableOn(tagBg) }}
      >
        {name} · from ${price.toFixed(2)}
      </span>
    </Link>
  )
}

function Rail({ form, reverse, price }: { form: FormId; reverse: boolean; price: number }) {
  /* THE TRACK IS THE COLOUR RUN TWICE, and the animation translates it -50%. At that point the
     second copy sits exactly where the first began, so the reset is invisible — which is the
     whole trick, and why the clone cannot be a different length or a different order. */
  const track = [...COLOURWAYS, ...COLOURWAYS]
  return (
    <div
      className="eg-rail-hold relative w-full overflow-hidden py-4"
      style={{
        ["--rail-h" as string]: "clamp(17rem, 34vh, 25rem)",
        ["--rail-dur" as string]: DURATION[form],
      }}
    >
      {/* THE BAR, behind everything and edge to edge — a rail does not end where the viewport
          does, which is the same reason garments cross the frame. NOT the HAIRLINE token:
          that is a card's edge against white and measures barely 1.02:1 on this ground, so
          the bar was drawn and invisible. Still one pixel, still quiet, actually present. */}
      <div
        className="pointer-events-none absolute left-0 right-0 z-0"
        style={{ top: "calc(1rem + 4px)", height: 1, background: "color-mix(in oklch, var(--mk-ink) 22%, transparent)" }}
      />
      <div className={"eg-rail relative z-[1] flex w-max items-start gap-[3.5vw]" + (reverse ? " eg-rail-rev" : "")}>
        {track.map((c, i) => (
          <Garment
            key={`${c.slug}-${i}`}
            form={form}
            colour={c.slug}
            name={c.name}
            price={price}
            i={i}
            cloned={i >= COLOURWAYS.length}
          />
        ))}
      </div>
    </div>
  )
}

export function ProductField({ products, className = "" }: {
  products: PublicProduct[] | null
  className?: string
}) {
  type ViewId = "rail" | "grid"
  const [view, setView] = useState<ViewId>("rail")

  /* Resolved against what is ACTUALLY published, every render. */
  const priceOf = (f: FormId): number | null => {
    const p = (products ?? []).find((x) => x.slug === FORM_SLUG[f])
    if (!p) return null
    const n = p.priceFrom ?? p.price
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const rails = RAILS.map((f) => ({ form: f, price: priceOf(f) })).filter(
    (r): r is { form: FormId; price: number } => r.price !== null,
  )

  /* THE COLOUR FILTER IS GONE. It asked a question this section does not answer: a rail IS
     the colour run, all of it, all the time — so filtering to one colour emptied the field to
     show a subset of a set already on screen. Colour is chosen on the product page, where
     there are 41 or 47 of them and a filter earns its place. What replaces it is the one
     control people did ask for: whether this is a field or a grid. */
  const views = [
    { id: "rail" as const, label: "Rail" },
    { id: "grid" as const, label: "Grid" },
  ]

  return (
    <section className={"relative w-full overflow-hidden pb-10 " + className} style={{ background: SURFACE }}>
      <div className="mx-auto max-w-[88rem] px-6 sm:px-10">
        <TabBar items={views} value={view} onChange={(v) => setView(v as ViewId)} ariaLabel="View" />
      </div>

      <div className={"mt-4 " + (view === "rail" ? "hidden lg:block" : "hidden")}>
        {rails.map((r, i) => (
          <Rail key={r.form} form={r.form} reverse={i % 2 === 1} price={r.price} />
        ))}
      </div>

      {/* Below lg this is the ONLY view, whatever the toggle says: a moving rail on a touch
          screen cannot be paused by hovering, so the motion would be decoration nobody can
          stop. Above lg it is a choice — the same garments and the same destinations,
          arranged rather than running, for anyone who would rather scan than watch. */}
      <div className={"grid grid-cols-2 gap-x-4 gap-y-8 px-6 py-10 sm:grid-cols-4 "
        + (view === "grid" ? "lg:grid lg:grid-cols-6" : "lg:hidden")}>
        {rails.flatMap((r) =>
          COLOURWAYS.map((c) => (
            <Link
              key={`${r.form}-${c.slug}`}
              href={`/catalog/${FORM_SLUG[r.form]}`}
              aria-label={`${FORM_LABEL[r.form]} in ${c.name}`}
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={srcOf(r.form, c.slug)} alt="" className="block w-full" />
            </Link>
          )),
        )}
      </div>
    </section>
  )
}
