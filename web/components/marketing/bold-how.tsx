"use client"

import type { SiteContent } from "@/lib/site-content"
import { ACCENT, ACCENT_INK, HAIRLINE, HEADING, INK, SURFACE, Pill, PlateHero, Band, Rise, MediaBand } from "@/components/marketing/bold-kit"
import { CalloutList, NumberedCards } from "@/components/marketing/bold-figure"
import { EditableText, EditableImage, useEditableNum, useEditableSrc, useEditMode } from "@/components/marketing/edit-mode"

/**
 * How it works. Three steps, then the seller-facing status flow.
 *
 * BUILT ON THE FIGURE KIT (bold-figure.tsx), because this page is the one it was made for:
 * the reference board's annotated product panel IS a how-it-works diagram. Everything the
 * page said before it is still here, word for word — what changed is that the words now come
 * from stored site content instead of two arrays frozen into this file, so changing a step
 * is an admin edit rather than a deploy.
 *
 * The journey strip keeps the REAL status labels and their real tones (mirroring sellerStatus
 * in lib/order-status.ts) rather than restyling them into the marketing palette. A prospect
 * should recognise these words on their first order — a marketing page that invents a
 * prettier pipeline is a page that lies about the product.
 */

/**
 * THE TONE IS RESOLVED FROM THE LABEL, NEVER STORED.
 *
 * The obvious way to make the journey editable was to store `tone` beside `body`. That would
 * have handed an admin a Tailwind class to type by hand into a public page — a class that is
 * either a typo, or arbitrary CSS, or worst of all a WORKING colour that no longer matches
 * what the seller sees in the app. The status colours are reserved and carry meaning on the
 * floor (§4); this page borrows them, it does not get to pick them.
 *
 * So the label is the key. A label an admin invents that is not a real status falls back to
 * neutral rather than to nothing, because a strip that loses a row when someone fixes a typo
 * is worse than one that renders it quietly.
 */
/* The neutral fallback is mixed from the INK VARIABLE, not from `black`. A literal here is
   invisible to the runtime skin, so this one row would have stayed press-coloured while every
   real status beside it moved — a strip where one chip is off-palette reads as a bug in the
   product, not in the page. */
const NEUTRAL_CHIP = "bg-[color-mix(in_oklch,var(--mk-ink)_8%,transparent)] text-[color-mix(in_oklch,var(--mk-ink)_65%,transparent)]"

const JOURNEY_TONE: Record<string, string> = {
  draft: NEUTRAL_CHIP,
  pending: "bg-pending/12 text-pending",
  "in process": "bg-working/12 text-working",
  "in production": "bg-working/12 text-working",
  fulfilled: "bg-shipped/12 text-shipped",
  "on hold": "bg-hold/12 text-hold",
  cancelled: "bg-alert/12 text-alert",
  refunded: "bg-alert/12 text-alert",
}
const toneFor = (label: string) => JOURNEY_TONE[label.trim().toLowerCase()] ?? NEUTRAL_CHIP

export function BoldHow({ content }: { content: SiteContent }) {
  const p = content.howPage
  const { on: editing } = useEditMode()
  /** The DRAFT's figure, so a generated or uploaded picture appears before Save. */
  const figureSrc = useEditableSrc("howPage.figure.image", p.figure.image)
  /* Same reason as the src above — the crop has to move while it is dragged, not on Save. */
  const figFx = useEditableNum("howPage.figure.imageFocusX", p.figure.imageFocusX)
  const figFy = useEditableNum("howPage.figure.imageFocusY", p.figure.imageFocusY)
  const figZoom = useEditableNum("howPage.figure.imageScale", p.figure.imageScale)

  return (
    <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
      <PlateHero title={p.title} accent={p.accent} sub={p.sub} path="howPage" />

      {/* NO BAND OF FIGURES UNDER THE HERO — removed 2026-08-26 from all three pages that
          carried one. See the note on /features. On THIS page it was the weakest of the three:
          "4 statuses" is the journey strip at the bottom of this very page, counted, and "2
          min" is the connect step the copy immediately below describes in words. A figure that
          summarises the section under it makes the reader read the same thing twice. */}

      {/*
        * ── THE DIAGRAM ────────────────────────────────────────────────────────────
        *
        * The product, cut out, on the dark plate, with the three things that happen to it
        * labelled around it. This is the annotated panel from the reference board, and on
        * THIS page it is not decoration: "your artwork → our press → their doorstep" is the
        * entire product said in one picture, above the three steps that spell it out.
        *
        * The whole section is guarded on the image, not just the figure. With no picture
        * uploaded, CutoutFigure renders nothing — and a heading and a rule sitting over the
        * space where a diagram should be is precisely the empty-state-that-looks-broken §4
        * forbids. No picture means no section, and the steps follow the figures directly.
        */}
      {/* ── THE PAGE'S PICTURE, FULL BLEED ─────────────────────────────────────────
          Was a CutoutFigure on a soft wash inside a Band. The photography is now shot on a
          COLOURED SEAMLESS, and cutting a subject out of one carries the studio colour through
          the hair and shoulder edge — the subject arrives wearing a halo. So the frame stays
          whole and the studio ground becomes the band. On this page the picture is shot on the near-black ground, which is the plate the cut-out used to sit on drawn as a photograph instead.

          Still replaceable where it sits, and still rendered empty in edit mode: with no
          picture there is nothing on the page to drop one ONTO, and the one gesture the mode
          exists for would be the one it could not offer. MediaBand's own guard means a visitor
          sees nothing rather than a grey box.

          The callouts survive the move and now sit ON the picture under the scrim — the
          annotated-figure device the reference boards use, which the cut-out was carrying
          before. `ink` tone is the LIGHT lettering, which is what a scrim needs. */}
      {(figureSrc || editing) && (
        <EditableImage path="howPage.figure.image" transform="bleed">
          <MediaBand media={figureSrc} alt={p.figure.imageAlt} focusX={figFx} focusY={figFy} scale={figZoom}>
            {p.figure.callouts.length > 0 && (
              <CalloutList
                items={p.figure.callouts}
                path="howPage.figure.callouts"
                tone="ink"
                className="flex-wrap gap-x-10 gap-y-5"
              />
            )}
          </MediaBand>
        </EditableImage>
      )}

      {/*
        * ── THE THREE STEPS ────────────────────────────────────────────────────────
        *
        * Was three bordered white cards with a pale numeral on each. NumberedCards is the same
        * idea with the alternation the reference uses — and it removes three more outlined
        * boxes from a page that had seven of them, which is the count §4 keeps making.
        *
        * The "— No CSV exports" run under each step survived: it moved onto NumberedItem so
        * the card draws it, rather than being lost or hand-rolled beside the component.
        */}
      {/* The steps keep the PAPER ground: NumberedCards draws its light cards in CARD white,
          and a white card on a white band is a border drawn for nothing. The surfaces invert —
          on paper a card is white, on white a card is paper. */}
      <Band tone="paper">
        <NumberedCards items={p.steps} path="howPage.steps" />
      </Band>

      {/* The real status flow. Tones are the product's own, deliberately not re-tinted. */}
      {p.journey.length > 0 && (
        /* A SURFACE, NOT A RULE — reversed 2026-08-26, and the note it replaces was right
           about the wrong thing. It argued against "a second, muddier ground laid over the
           page's own", and that is a fair description of a 3% BLACK TINT: neither one ground
           nor another, which is exactly what reads as a mistake. It is not a description of a
           SURFACE. White is the second of three real grounds here, and with no shadows in the
           system a change of value is the only way one section can separate from the next. */
        <Band tone="card">
          {/* HEADING LEFT, ROWS RIGHT — the same two-track reading grid as the document pages
              and the pricing lists. It was `max-w-4xl` inside an 88rem band, which left the
              right half of every row empty: the heading, the note and four status rows all
              stopped at 60% of the page and the band read as unfinished rather than as a
              column. A measure is for PROSE; a section does not inherit it. */}
          <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
            <div>
              <h2 className="font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={HEADING}>
                <EditableText path="howPage.journeyHeading">{p.journeyHeading}</EditableText>
              </h2>
              <p className="mt-5 max-w-sm text-[16px] leading-relaxed" style={{ color: INK, opacity: 0.62 }}>
                <EditableText path="howPage.journeyNote">{p.journeyNote}</EditableText>
              </p>
            </div>

            {/*
              * A DIVIDED BAND, NOT FOUR CARDS.
              *
              * Same reasoning as SpecStrip, and the same §4 count: four white boxes on a grey
              * ground made this read as four unrelated announcements, when it is one sequence.
              * Rules between them say "these are in order" for free.
              *
              * A GRID, because the badge is a different width per row (§4: a variable-width
              * element followed by anything else belongs in a grid). The old flex row pinned
              * it with sm:w-28, which worked — a grid track says the same thing once, at the
              * container, instead of on every child.
              */}
            <div className="divide-y lg:mt-2" style={{ borderColor: HAIRLINE, borderTopWidth: 1, borderBottomWidth: 1 }}>
              {p.journey.map((j, i) => (
                <Rise
                  key={`${j.label}-${i}`}
                  preset="cut"
                  index={i}
                  className="grid gap-2 py-5 sm:grid-cols-[7rem_1fr] sm:items-baseline sm:gap-6"
                >
                  <span className={"inline-flex w-fit rounded-lg px-3 py-1 text-[13px] font-semibold " + toneFor(j.label)}>
                    <EditableText path={`howPage.journey.${i}.label`}>{j.label}</EditableText>
                  </span>
                  <span className="text-[15px] leading-relaxed" style={{ color: INK, opacity: 0.68 }}><EditableText path={`howPage.journey.${i}.body`}>{j.body}</EditableText></span>
                </Rise>
              ))}
            </div>
          </div>
        </Band>
      )}

      {/* ── CTA — EDGE TO EDGE ───────────────────────────────────────────────────
          It was a rounded box inside a max-w-5xl, centred. Two things were wrong with that
          and only one of them is shape: a band that stops short of both margins reads as an
          advert pasted onto the page rather than as the page ending, and a CENTRED closing
          block on a site whose every other section is left-aligned is a third alignment
          appearing once, at the bottom, for no reason. The home page settled this already —
          this is the same band, and the two pages now end the same way.

          The EGFULFILL rule goes with the centring. It was there to give a narrow centred
          box something to hold its top edge; a full-bleed plate needs nothing holding it. */}
      <section className="px-6 py-24 sm:px-10" style={{ background: ACCENT }}>
        <div className="mx-auto max-w-[88rem]">
          <h2 className="max-w-[48rem] font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ ...HEADING, color: ACCENT_INK }}>
            <EditableText path="howPage.cta.heading">{p.cta.heading}</EditableText>
          </h2>
          <div className="mt-10">
            <Pill href="/signup" tone="invert" ring><EditableText path="howPage.cta.button">{p.cta.button}</EditableText></Pill>
          </div>
        </div>
      </section>
    </div>
  )
}
