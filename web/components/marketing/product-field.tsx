"use client"

import { useState } from "react"
import { TabBar } from "@/components/app/tab-bar"
import { CARD, INK, SURFACE } from "@/components/marketing/bold-kit"

/**
 * ── THE FIELD — racks of blanks on the page's own colour ─────────────────────────────────
 *
 * Twelve objects, full bleed, three racks. Each rack is one COLOUR STORY across every form we
 * make, and clicking any object ports the whole field to that story.
 *
 * WHY RACKS AND NOT A SCATTER OF FOUR. The first version put four objects on one field with
 * air between them and it read as unfinished — correctly, because four unrelated garments in
 * four unrelated colours are four one-offs, not a collection. The reference this is drawn
 * from is dense for a reason that is not spacing: it shows ONE glaze across MANY forms, so
 * every silhouette rhymes and the eye reads a set. Three racks is that idea with the axis
 * made explicit — down the page is colour, across it is form.
 *
 * THERE IS NO CARD. The tile is transparent — no border, no fill, no radius, no shadow — so
 * an object sits ON the canvas rather than inside a box on it. A card makes a grid of
 * thumbnails; the absence of one makes a table of objects.
 *
 * THE SHADOW IS IN THE PNG. §4 bans shadows on interface chrome; a shadow inside a photograph
 * is part of the photograph. Every object's shadow is synthesised from its own silhouette with
 * identical parameters, which is why they now share one light — and why the charcoal hoodie's
 * shadow can no longer be too short to clear a dark garment while the bone tee's is fine.
 *
 * SIZE IS DEPTH, NOT RANK. The scale differences read as near and far. A bigger object is not
 * a better seller, and using it that way would be an invented signal. It only means anything
 * because the source PNGs are normalised to one garment-to-canvas ratio per form — before
 * that, identical `w` values rendered at wildly different sizes and the field could not be
 * composed at all.
 *
 * POSITIONS ARE PLACED, NEVER RANDOM. Random overlaps the type, collides, and changes on every
 * render, so a layout could never be judged. Objects deliberately cross the left and right
 * edges: a crop implies more beyond the frame, which is what turns empty space into a margin.
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

const STORIES: { id: StoryId; name: string }[] = [
  { id: "natural", name: "Natural" },
  { id: "charcoal", name: "Charcoal" },
  { id: "iris", name: "Iris" },
]

type Placed = { form: FormId; x: number; y: number; w: number }

/**
 * ── TEMPORARY: FORMS REPEAT ──────────────────────────────────────────────────────────────
 *
 * Each rack currently lists EIGHT objects drawn from four forms, so every garment appears
 * twice at a different size. This is a PROBE, not the design. The open question is whether a
 * dense field actually reads better than a sparse one before committing ~250 credits to
 * shooting six more forms (cotton shirt, polo, quarter-zip, trucker, beanie, duffel — all of
 * which we genuinely publish). Repeating what we have answers that for nothing.
 *
 * It has to come out either way. A repeat is honest as a texture and dishonest as a
 * catalogue: the field implies a range, and eight objects that are really four overstate it.
 * When the new forms land, every duplicate entry below is replaced by a real one and this
 * note goes with them. If they do NOT land, the racks go back to four.
 *
 * The duplicate is hidden from assistive tech (see `dup` at the call site) — it is the same
 * product with the same action, and announcing it twice is noise, not access.
 */

/**
 * ONE RACK PER STORY, AND NO TWO RACKS ALIKE.
 *
 * The forms appear in a different order and at different heights in each rack. Three rows of
 * the same four positions is a table with its headers removed — the irregularity is what makes
 * it read as objects laid out rather than data rendered.
 */
const RACKS: Record<StoryId, Placed[]> = {
  natural: [
    { form: "cap", x: 1, y: 42, w: 14 },
    { form: "tee", x: 13, y: 64, w: 17 },
    { form: "crew", x: 26, y: 36, w: 20 },
    { form: "hoodie", x: 41, y: 64, w: 22 },
    { form: "tee", x: 56, y: 34, w: 15 },
    { form: "cap", x: 68, y: 60, w: 13 },
    { form: "crew", x: 82, y: 38, w: 20 },
    { form: "hoodie", x: 98, y: 62, w: 22 },
  ],
  charcoal: [
    { form: "hoodie", x: 2, y: 60, w: 21 },
    { form: "crew", x: 17, y: 35, w: 19 },
    { form: "cap", x: 30, y: 62, w: 13 },
    { form: "tee", x: 42, y: 36, w: 17 },
    { form: "hoodie", x: 57, y: 63, w: 22 },
    { form: "tee", x: 72, y: 34, w: 15 },
    { form: "crew", x: 85, y: 60, w: 20 },
    { form: "cap", x: 99, y: 38, w: 14 },
  ],
  iris: [
    { form: "crew", x: 0, y: 38, w: 20 },
    { form: "hoodie", x: 15, y: 62, w: 22 },
    { form: "tee", x: 31, y: 35, w: 16 },
    { form: "cap", x: 43, y: 60, w: 13 },
    { form: "crew", x: 56, y: 37, w: 19 },
    { form: "hoodie", x: 72, y: 63, w: 22 },
    { form: "cap", x: 87, y: 36, w: 14 },
    { form: "tee", x: 98, y: 60, w: 17 },
  ],
}

/** The single-story view: the same four objects with the room three racks were sharing. */
const SOLO: Placed[] = [
  { form: "cap", x: 2, y: 44, w: 16 },
  { form: "tee", x: 15, y: 66, w: 20 },
  { form: "crew", x: 32, y: 38, w: 23 },
  { form: "hoodie", x: 50, y: 66, w: 25 },
  { form: "tee", x: 67, y: 36, w: 18 },
  { form: "cap", x: 79, y: 62, w: 15 },
  { form: "crew", x: 93, y: 40, w: 23 },
]

const srcOf = (form: FormId, story: StoryId) => `/frames/obj-${form}-${story}.png`

function Rack({ items, story, solo, onPort }: {
  items: Placed[]
  story: StoryId
  solo: boolean
  onPort: (s: StoryId) => void
}) {
  const name = STORIES.find((s) => s.id === story)!.name
  return (
    <div
      className="relative w-full"
      style={{ minHeight: solo ? "clamp(24rem, 56vh, 37rem)" : "clamp(18rem, 38vh, 25rem)" }}
    >
      {items.map((it, i) => {
        /* The FIRST appearance of a form is the real one; later ones are the temporary
           repeats above. Same click, same target — so they stay pressable with a mouse and
           stay out of the tab order and the accessibility tree. */
        const dup = items.findIndex((o) => o.form === it.form) !== i
        return (
        <button
          key={`${it.form}-${i}`}
          aria-hidden={dup || undefined}
          tabIndex={dup ? -1 : undefined}
          type="button"
          onClick={() => onPort(story)}
          /* THE ACCESSIBLE NAME CARRIES BOTH FACTS, because the visible label only appears on
             hover and a pointer is not the only way here. "Heavy blend hoodie in Charcoal" is
             also what the click DOES — it ports the field to that story. */
          aria-label={`${FORM_LABEL[it.form]} in ${name}`}
          className="group absolute block cursor-pointer focus-visible:outline-none"
          style={{ left: `${it.x}%`, top: `${it.y}%`, width: `${it.w}%`, transform: "translate(-50%, -50%)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={srcOf(it.form, story)}
            alt=""
            className="block w-full origin-center transition-transform duration-500 ease-out will-change-transform motion-safe:group-hover:scale-[1.06] motion-safe:group-focus-visible:scale-[1.06]"
          />
          {/*
            * THE LABEL IS AN AFFORDANCE, NOT A STATUS CHIP.
            *
            * §4 reserves the pill for things carrying stage meaning — an order stage, an HTTP
            * method, RUSH/LATE — and forbids it for tags and toggles. This is neither: it is a
            * hover readout naming the object under the cursor and what clicking it will do,
            * which is why it is `rounded-lg` like every other control rather than
            * `rounded-full`, and why it is absent until the pointer is on the object.
            *
            * The leading + is the verb. It says the click ADDS a filter rather than opening the
            * product, which is the one thing a visitor could otherwise reasonably expect.
            */}
          <span
            className="pointer-events-none absolute left-full top-1/2 z-10 ml-1 hidden -translate-y-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 lg:block"
            style={{ background: INK, color: CARD }}
          >
            + {name}
          </span>
        </button>
        )
      })}
    </div>
  )
}

export function ProductField({ className = "" }: { className?: string }) {
  const [story, setStory] = useState<StoryId | "all">("all")

  const tabs = [
    { id: "all" as const, label: "All" },
    ...STORIES.map((s) => ({ id: s.id, label: s.name })),
  ]

  return (
    /* overflow-hidden is what lets an object cross the frame without giving the PAGE a
       horizontal scrollbar — so it stays, and the padding below is what stops it also
       slicing the bottom off the last rack. Measured: objects ran 29px past the section and
       the iris hoodie met the CTA band with a flat cut edge. A rack places objects by
       PERCENT of its own height, so the lowest of them always hangs past it; the section has
       to carry that overhang itself. */
    <section className={"relative w-full overflow-hidden pb-16 " + className} style={{ background: SURFACE }}>
      {/* THE RULE UNDER THE LIVE WORD — components/app/tab-bar.tsx, not a fresh row of
          capsules. §4's own worked example: this bar was hand-rolled fourteen times before the
          primitive existed, and every new one was written because there was nothing to import.
          There is now. */}
      <div className="mx-auto max-w-[88rem] px-6 sm:px-10">
        <TabBar items={tabs} value={story} onChange={setStory} ariaLabel="Colour" />
      </div>

      <div className="hidden lg:block">
        {story === "all"
          ? STORIES.map((s) => (
              <Rack key={s.id} items={RACKS[s.id]} story={s.id} solo={false} onPort={setStory} />
            ))
          : <Rack items={SOLO} story={story} solo onPort={() => setStory("all")} />}
      </div>

      {/* Below lg the racks become a grid. A field needs room a phone does not have; the same
          objects and the same click, arranged rather than placed. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 px-6 py-10 sm:grid-cols-3 lg:hidden">
        {(story === "all" ? STORIES : STORIES.filter((s) => s.id === story)).flatMap((s) =>
          RACKS[s.id].map((it) => (
            <button
              key={`${s.id}-${it.form}`}
              type="button"
              onClick={() => setStory(story === "all" ? s.id : "all")}
              aria-label={`${FORM_LABEL[it.form]} in ${s.name}`}
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={srcOf(it.form, s.id)} alt="" className="block w-full" />
            </button>
          )),
        )}
      </div>
    </section>
  )
}
