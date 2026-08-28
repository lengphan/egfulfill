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

/**
 * ── PREVIEW: ONE RAIL HANGS ──────────────────────────────────────────────────────────────
 *
 * The Natural rail uses a HANGING photograph; the other two keep the folded flat-lays. Two
 * shot types on one page is not the design — it is there so the difference can be judged
 * side by side, which is the whole question. One of them comes out.
 *
 * WHY HANGING IS THE ONE THAT SAYS "RAIL". A folded garment rests ON something, so it is
 * padded to a fixed HEM and reads as stock on a shelf — which is why the folded version has
 * always looked like a conveyor. A hanging garment is suspended FROM something, so it is
 * padded to a fixed SHOULDER LINE, and that shared top edge is what the eye reads as a rail.
 *
 * THE HOOK AND THE BAR ARE DRAWN, NOT PHOTOGRAPHED. Background removal ate the real hook —
 * a thin bright wire against a pale ground is exactly what matting loses — and that turned
 * out to be the better answer. One hook, one height, identical on every garment, so the
 * rail's line is guaranteed by construction rather than by what the camera did that frame.
 * A photographed hook would be a different length and angle in every shot.
 */
/**
 * A hanging photograph per form, per story. A rail is a REAL rail only for the forms that
 * have one — the others are simply not on it, rather than a folded garment floating between
 * two hung ones, which reads as a mistake rather than as variety.
 *
 * The cap is deliberately absent and will stay absent: a cap does not go on a hanger. It
 * belongs on a peg or a clip, which is a different object and a different shot.
 */
const HANG_SRC: Partial<Record<StoryId, Partial<Record<FormId, string>>>> = {
  natural: {
    tee: "/frames/hang-tee-side.png",
    hoodie: "/frames/hang-hoodie-side.png",
  },
}

/** How long one full pass takes. Slower than it feels it should be: this is ambient. */
const DURATION: Record<StoryId, string> = { natural: "72s", charcoal: "88s", iris: "80s" }

function Garment({ slot, story, price, hidden, hang, i }: {
  slot: Slot
  story: StoryId
  price: number
  /** A clone in the loop's second copy, or a repeat of a form already on this rail. */
  hidden: boolean
  /** The hanging photograph, when this rail is a real rail. */
  hang?: string
  /** Position along the track — drives the variation below. */
  i: number
}) {
  /*
   * ONE PHOTOGRAPH, MADE TO STOP LOOKING LIKE ONE.
   *
   * The first hanging rail put the same shirt at the same angle eleven times and it read as
   * wallpaper — a texture, not stock. A real rail is never uniform: garments face both ways
   * because people put them back however they came off, and they hang at slightly different
   * lengths because hangers sit at different depths on the bar.
   *
   * Mirroring is the move that does the most for nothing. A flipped garment is a DIFFERENT
   * silhouette to the eye — the sleeve is on the other side, the light falls the other way —
   * while remaining the same honest photograph of the same product. It is not a claim about
   * range; it is the same shirt, turned round, which is exactly what it would be on a rail.
   */
  const flip = hang ? i % 2 === 1 : false
  const lengthJitter = hang ? 1 - ((i * 37) % 11) / 90 : 1
  const name = STORIES.find((s) => s.id === story)!.name
  return (
    <Link
      href={`/catalog/${FORM_SLUG[slot.form]}`}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      aria-label={`${FORM_LABEL[slot.form]} in ${name}`}
      className="group relative block shrink-0 focus-visible:outline-none"
      style={hang
        /* SIZED BY HEIGHT, NOT WIDTH. Garments on a rail hang to a common length, and the
           turned shot is a 0.34 aspect — set by width it would be nearly three rail-heights
           tall. Width follows from the photograph, which is also what varies along a real
           rail as garments turn at different angles. */
        ? { height: `calc(var(--rail-h) * ${(0.94 + (slot.w - 1) * 0.06) * lengthJitter})`, width: "auto" }
        : { width: `calc(var(--rail-unit) * ${slot.w})`, transform: `translateY(${slot.dy}%)` }}
    >
      <span className={hang ? "eg-sway flex h-full flex-col items-center" : "contents"} style={hang ? { ["--sway-dur" as string]: `${5.2 + (slot.w * 2.3) % 2.6}s`, animationDelay: `-${(slot.w * 3.7) % 4}s` } : undefined}>
      {hang && (
        /* THE HOOK. A stroke, not an image — see HANGING above. `origin-top` on the garment
           below means the hover lift grows DOWN from the hook rather than around the
           garment's middle, so the hanging point stays welded to the bar while it scales.
           Scaling from the centre would lift the garment off its own hook. */
        <svg viewBox="0 0 24 26" className="mx-auto block h-[22px] w-[24px]" aria-hidden="true" fill="none">
          <path
            d="M12 26V9M12 9c0-3.2 2-5 4.2-5 1.9 0 3.3 1.4 3.3 3.1"
            stroke={INK}
            strokeOpacity="0.42"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={hang ?? srcOf(slot.form, story)}
        alt=""
        className={"block w-full transition-transform duration-500 ease-out " + (hang
          ? "origin-top motion-safe:group-hover:scale-[1.05] motion-safe:group-focus-visible:scale-[1.05]"
          : "origin-center motion-safe:group-hover:scale-[1.09] motion-safe:group-focus-visible:scale-[1.09]")}
        style={hang ? { height: "calc(100% - 22px)", width: "auto", transform: flip ? "scaleX(-1)" : undefined } : undefined}
      />
      </span>
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

function Rail({ story, reverse, priceOf, solo = false }: {
  story: StoryId
  reverse: boolean
  priceOf: (f: FormId) => number | null
  /** One story selected: this rail is the whole field, so it gets the height three shared. */
  solo?: boolean
}) {
  /* Declared BEFORE the filter that reads them. They were below it, and because the use sits
     inside a callback TypeScript cannot prove when it runs — so this compiled clean and threw
     a temporal-dead-zone error only at prerender, taking the whole build down. */
  const hangMap = HANG_SRC[story]
  const isHanging = !!hangMap && Object.keys(hangMap).length > 0
  const slots = RAILS[story].filter(
    (sl) => priceOf(sl.form) !== null && (!isHanging || !!hangMap?.[sl.form]),
  )
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
      style={{
        ["--rail-unit" as string]: "clamp(9rem, 17vw, 19rem)",
        /* THREE RAILS SHARE THE PAGE; ONE RAIL OWNS IT. The two views answer different
           questions — three is "what is the range", one is "show me this colour" — so the
           single rail gets the height the other two were using. It is also the view that
           survives a small range best: four large garments fill a screen where twelve small
           ones put every repeat on show. */
        /* 48vh, not 66. The page head is ~460px, so a 66vh rail totalled 1054px against a
           900px viewport and the garments were sliced by the FOLD — which reads as a bug,
           because a fold is not a frame edge the way the left and right margins are. */
        ["--rail-h" as string]: solo ? "clamp(22rem, 48vh, 34rem)" : "clamp(19rem, 42vh, 30rem)",
        ["--rail-dur" as string]: DURATION[story],
      }}
    >
      {isHanging && (
        /* THE BAR, behind everything and edge to edge. It runs past both margins because a
           rail does not end where the viewport does — that is the same reason objects cross
           the frame. One hairline: §4's weight for a rule, not a drawn pole. */
        <div
          className="pointer-events-none absolute left-0 right-0 z-0"
          /* The hook svg is 22px and sits at the very top of each item, which begins at the
             rail's own 1rem of padding. The bar crosses it 4px down so the hook reads as
             hanging OVER the bar rather than balanced on it. */
          /* NOT `HAIRLINE`. That token is a card's edge against white and measures barely
             1.02:1 on this ground — the bar was there and nobody could see it. A rail has to
             read as a physical thing the hooks hang over, so it takes a real value: still one
             pixel, still quiet, but actually present. */
          style={{ top: "calc(1rem + 4px)", height: 1, background: "color-mix(in oklch, var(--mk-ink) 22%, transparent)" }}
        />
      )}
      <div className={"eg-rail relative z-[1] flex w-max gap-[4vw] " + (isHanging ? "items-start" : "items-center") + (reverse ? " eg-rail-rev" : "")}>
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
            hang={hangMap?.[slot.form]}
            i={i}
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
          <Rail key={s.id} story={s.id} reverse={i % 2 === 1} priceOf={priceOf} solo={story !== "all"} />
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
