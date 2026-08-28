"use client"

import { useState } from "react"
import Link from "next/link"
import type { PublicProduct } from "@/lib/api"
import { TabBar } from "@/components/app/tab-bar"
import { CARD, INK, SURFACE } from "@/components/marketing/bold-kit"

/**
 * ── THE RAIL — stock running past, until you reach for one ───────────────────────────────
 *
 * Three rails, one per colour story, each a continuous horizontal track of blanks. The track
 * moves; putting the pointer on a rail stops it; clicking a garment opens that garment.
 *
 * WHY IT MOVES. A static field has to be composed, and a composed field of four objects reads
 * as a layout with gaps in it. A moving one reads as STOCK — there is more of this, it is
 * going past, you are seeing a window onto it. That is also honest about what a catalogue is,
 * and it means the field no longer has to pretend the range is exactly wide enough to fill a
 * screen.
 *
 * WHY IT STOPS. A rail you cannot stop is a rail you cannot use. Hovering pauses the whole
 * ROW rather than the object under the cursor: pausing one garment while its neighbours keep
 * sliding would move the thing you were about to reach for, which is the opposite of aiming.
 *
 * THE THREE RAILS RUN IN ALTERNATING DIRECTIONS. Three tracks moving the same way at the same
 * speed read as one big thing sliding — the parallax of a train window. Alternating makes each
 * row its own object and stops the eye locking onto a single vector.
 *
 * NO JAVASCRIPT IN THE LOOP. This is a CSS transform animation, so it never touches layout,
 * never repaints, and never re-renders React. CLAUDE.md §2.8's runaway loader was an EFFECT
 * fetching on a condition its own fetch satisfied — the danger is state feeding itself. There
 * is no state here at all, which is exactly why this is CSS and not a rAF ticking a value.
 *
 * THERE IS NO CARD. No border, no fill, no radius, no CSS shadow — an object sits ON the
 * canvas rather than in a box on it. The shadow is inside the PNG, synthesised from each
 * silhouette with identical parameters, so all of them share one light.
 *
 * CLICKING A BLANK OPENS THAT BLANK. It used to port the field to that colour, which was a
 * dead end wearing an interaction's clothes. Colour lives on the bar; an object is a product.
 *
 * A FORM WITH NO PUBLISHED PRODUCT IS NOT DRAWN — see FORM_SLUG.
 */

export type FormId = "tee" | "crew" | "hoodie" | "cap"
export type StoryId = "natural" | "charcoal" | "iris"

/** The garment names as a visitor would say them — never the supplier's catalogue title. */
const FORM_LABEL: Record<FormId, string> = {
  tee: "Heavyweight cotton tee",
  crew: "Ring-spun crewneck",
  hoodie: "Heavy blend hoodie",
  cap: "Six-panel cap",
}

/**
 * THE PRODUCT EACH PHOTOGRAPH IS OF — checked against the live catalogue, not assumed.
 *
 * A slug that is not published resolves to nothing and its object is not drawn, which is the
 * correct failure: the rail can go stale in only one direction, toward showing less than we
 * sell, never toward showing something we do not. The crewneck is in this table and not in
 * the catalogue, so it currently draws nothing — deliberately, because sending someone who
 * clicked a crewneck to a hooded sweatshirt is not an approximation, it is the wrong product.
 */
const FORM_SLUG: Record<FormId, string> = {
  tee: "gildan-unisex-heavy-cotton-t-shirt",
  crew: "ring-spun-crewneck-sweatshirt",
  hoodie: "comfort-colors-ring-spun-hooded-sweatshirt-1567",
  cap: "adams-headwear-icon-sandwich-cap",
}

const STORIES: { id: StoryId; name: string }[] = [
  { id: "natural", name: "Natural" },
  { id: "charcoal", name: "Charcoal" },
  { id: "iris", name: "Iris" },
]

/**
 * ── TEMPORARY: THE SEQUENCE REPEATS ──────────────────────────────────────────────────────
 *
 * Each rail lists more slots than we have forms, so garments recur along the track. On a
 * moving rail that is far less of a claim than it was on a static field — stock passing a
 * window genuinely does repeat — but it is still a range being padded, and it comes out when
 * the real forms land (cotton shirt, polo, quarter-zip, trucker, beanie, duffel, all of which
 * we publish). The order and sizes vary between rails so no two rows scan alike.
 */
type Slot = { form: FormId; w: number; dy: number }

const RAILS: Record<StoryId, Slot[]> = {
  natural: [
    { form: "tee", w: 1.0, dy: 6 },
    { form: "hoodie", w: 1.25, dy: -4 },
    { form: "cap", w: 0.72, dy: 10 },
    { form: "crew", w: 1.12, dy: 0 },
    { form: "tee", w: 0.86, dy: -8 },
    { form: "hoodie", w: 1.05, dy: 8 },
    { form: "cap", w: 0.8, dy: -6 },
  ],
  charcoal: [
    { form: "hoodie", w: 1.18, dy: 4 },
    { form: "cap", w: 0.76, dy: -8 },
    { form: "tee", w: 1.02, dy: 8 },
    { form: "crew", w: 1.22, dy: -3 },
    { form: "cap", w: 0.7, dy: 10 },
    { form: "tee", w: 0.9, dy: -6 },
    { form: "hoodie", w: 1.08, dy: 2 },
  ],
  iris: [
    { form: "crew", w: 1.15, dy: -5 },
    { form: "tee", w: 0.95, dy: 8 },
    { form: "hoodie", w: 1.28, dy: -2 },
    { form: "cap", w: 0.74, dy: 9 },
    { form: "tee", w: 1.05, dy: -7 },
    { form: "crew", w: 1.0, dy: 5 },
    { form: "cap", w: 0.78, dy: -4 },
  ],
}

const srcOf = (form: FormId, story: StoryId) => `/frames/obj-${form}-${story}.png`

/** How long one full pass takes. Slower than it feels it should be: this is ambient. */
const DURATION: Record<StoryId, string> = { natural: "72s", charcoal: "88s", iris: "80s" }

function Garment({ slot, story, price, hidden }: {
  slot: Slot
  story: StoryId
  price: number
  /** A clone in the loop's second copy, or a repeat of a form already on this rail. */
  hidden: boolean
}) {
  const name = STORIES.find((s) => s.id === story)!.name
  return (
    <Link
      href={`/catalog/${FORM_SLUG[slot.form]}`}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      aria-label={`${FORM_LABEL[slot.form]} in ${name}`}
      className="group relative block shrink-0 focus-visible:outline-none"
      style={{
        width: `calc(var(--rail-unit) * ${slot.w})`,
        transform: `translateY(${slot.dy}%)`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={srcOf(slot.form, story)}
        alt=""
        className="block w-full origin-center transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.09] motion-safe:group-focus-visible:scale-[1.09]"
      />
      {/*
        * THE LABEL NAMES THE GARMENT AND ITS REAL PRICE — the two things that decide whether
        * the click is worth making. §4 reserves the pill for stage meaning and forbids it for
        * tags; this is neither, it is a hover readout of where the click leads, which is why
        * it is `rounded-lg` like every other control rather than `rounded-full`.
        *
        * CENTRED UNDER THE GARMENT rather than beside it, because on a rail the neighbour is
        * only a few percent away and a label hanging to the right would sit on top of it.
        */}
      <span
        className="pointer-events-none absolute left-1/2 top-full z-10 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ background: INK, color: CARD }}
      >
        {FORM_LABEL[slot.form]} · from ${price.toFixed(2)}
      </span>
    </Link>
  )
}

function Rail({ story, reverse, priceOf }: {
  story: StoryId
  reverse: boolean
  priceOf: (f: FormId) => number | null
}) {
  const slots = RAILS[story].filter((s) => priceOf(s.form) !== null)
  if (!slots.length) return null

  /* THE TRACK IS THE SEQUENCE TWICE, and the animation translates it -50%. At that point the
     second copy sits exactly where the first began, so the reset is invisible — which is the
     entire trick, and why the clone cannot be a different length or a different order. */
  const track = [...slots, ...slots]

  return (
    <div
      className="eg-rail-hold relative w-full overflow-hidden py-4"
      /* --rail-unit is the base object width; every slot scales off it, so one value tunes
         the whole rail's density and the depth differences survive. */
      style={{ ["--rail-unit" as string]: "clamp(9rem, 17vw, 19rem)", ["--rail-dur" as string]: DURATION[story] }}
    >
      <div className={"eg-rail flex w-max items-center gap-[2.5vw]" + (reverse ? " eg-rail-rev" : "")}>
        {track.map((slot, i) => (
          <Garment
            key={`${slot.form}-${i}`}
            slot={slot}
            story={story}
            price={priceOf(slot.form)!}
            /* The second copy is the loop's clone, and within the first copy a form that has
               already appeared is one of the temporary repeats. Both are the same product with
               the same destination, so they stay clickable and stay out of the a11y tree. */
            hidden={i >= slots.length || slots.findIndex((o) => o.form === slot.form) !== i}
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
  const [story, setStory] = useState<StoryId | "all">("all")

  /* Resolved against what is ACTUALLY published, every render. */
  const priceOf = (f: FormId): number | null => {
    const p = (products ?? []).find((x) => x.slug === FORM_SLUG[f])
    if (!p) return null
    const n = p.priceFrom ?? p.price
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const shown = story === "all" ? STORIES : STORIES.filter((s) => s.id === story)

  const tabs = [
    { id: "all" as const, label: "All" },
    ...STORIES.map((s) => ({ id: s.id, label: s.name })),
  ]

  return (
    <section className={"relative w-full overflow-hidden pb-10 " + className} style={{ background: SURFACE }}>
      {/* THE RULE UNDER THE LIVE WORD — components/app/tab-bar.tsx, not a fresh row of
          capsules. Colour lives HERE, and only here: an object opens its product. */}
      <div className="mx-auto max-w-[88rem] px-6 sm:px-10">
        <TabBar items={tabs} value={story} onChange={setStory} ariaLabel="Colour" />
      </div>

      <div className="mt-4 hidden lg:block">
        {shown.map((s, i) => (
          <Rail key={s.id} story={s.id} reverse={i % 2 === 1} priceOf={priceOf} />
        ))}
      </div>

      {/* Below lg the rails become a grid. A moving rail on a touch screen cannot be paused by
          hovering, so there is nothing to hover and the motion would be decoration you cannot
          stop — the same objects and the same destination, arranged rather than running. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 px-6 py-10 sm:grid-cols-3 lg:hidden">
        {shown.flatMap((s) =>
          RAILS[s.id]
            .filter((it, i, a) => a.findIndex((o) => o.form === it.form) === i && priceOf(it.form) !== null)
            .map((it) => (
              <Link
                key={`${s.id}-${it.form}`}
                href={`/catalog/${FORM_SLUG[it.form]}`}
                aria-label={`${FORM_LABEL[it.form]} in ${s.name}`}
                className="block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={srcOf(it.form, s.id)} alt="" className="block w-full" />
              </Link>
            )),
        )}
      </div>
    </section>
  )
}
