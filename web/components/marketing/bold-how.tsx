"use client"

import type { SiteContent } from "@/lib/site-content"
import { ACCENT, ACID, HAIRLINE, HEADING, SURFACE, Pill, PlateHero, Rise } from "@/components/marketing/bold-kit"
import { LabelRule, CutoutFigure, SpecStrip, NumberedCards, CAPS } from "@/components/marketing/bold-figure"
import { EditableText, EditableImage, useEditableSrc, useEditMode } from "@/components/marketing/edit-mode"

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
const JOURNEY_TONE: Record<string, string> = {
  draft: "bg-black/[0.06] text-black/60",
  pending: "bg-pending/12 text-pending",
  "in process": "bg-working/12 text-working",
  "in production": "bg-working/12 text-working",
  fulfilled: "bg-shipped/12 text-shipped",
  "on hold": "bg-hold/12 text-hold",
  cancelled: "bg-alert/12 text-alert",
  refunded: "bg-alert/12 text-alert",
}
const toneFor = (label: string) => JOURNEY_TONE[label.trim().toLowerCase()] ?? "bg-black/[0.06] text-black/60"

export function BoldHow({ content }: { content: SiteContent }) {
  const p = content.howPage
  const { on: editing } = useEditMode()
  /** The DRAFT's figure, so a generated or uploaded picture appears before Save. */
  const figureSrc = useEditableSrc("howPage.figure.image", p.figure.image)

  return (
    <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
      <PlateHero title={p.title} accent={p.accent} sub={p.sub} path="howPage" />

      {/*
        * ── THE BAND OF FIGURES ────────────────────────────────────────────────────
        *
        * Directly under the hero, exactly where the reference puts it, and for the reason
        * given on SpecStrip: a number in a band reads as a specification, a number in a card
        * reads as a claim somebody made. Every figure here is one we can point at — "2 min"
        * is the OAuth round trip the copy below describes, "4" is the four statuses the strip
        * at the bottom of this very page enumerates.
        *
        * Emptied in the editor, the whole section goes — same as the homepage.
        */}
      {p.stats.length > 0 && (
        <section className="mx-auto max-w-[88rem] px-6 sm:px-10 pb-4">
          <LabelRule left={p.ruleLeft} right={p.ruleRight} leftPath="howPage.ruleLeft" rightPath="howPage.ruleRight" className="mb-10" />
          <div className="border-t pt-10" style={{ borderColor: HAIRLINE }}>
            <SpecStrip items={p.stats} path="howPage.stats" />
          </div>
        </section>
      )}

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
      {/* REPLACEABLE WHERE IT SITS — the same overlay the homepage hero has. In edit mode the
          section renders with no picture too, because otherwise there is nothing to drop one
          ONTO; a visitor still sees nothing. */}
      {(figureSrc || editing) && (
        <section className="mx-auto max-w-[88rem] px-6 sm:px-10 py-14">
          <EditableImage path="howPage.figure.image">
            <CutoutFigure
              tone="ink"
              src={figureSrc}
              alt={p.figure.imageAlt}
              ghost={p.figure.ghostWord}
              ghostPath="howPage.figure.ghostWord"
              callouts={p.figure.callouts}
              calloutsPath="howPage.figure.callouts"
            />
          </EditableImage>
        </section>
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
      <section className="mx-auto max-w-[88rem] px-6 sm:px-10 py-14">
        <NumberedCards items={p.steps} path="howPage.steps" />
      </section>

      {/* The real status flow. Tones are the product's own, deliberately not re-tinted. */}
      {p.journey.length > 0 && (
        <section className="mx-auto max-w-[88rem] px-6 py-16 sm:px-10">
          {/* A RULE, NOT A TINTED BAND. This section sat in 3% black, which is a second
              ground laid over the page's own — two near-identical off-whites held apart by
              nothing, which is what makes a full-width section read as a mistake rather than
              as a section. The divider does the same job and adds no colour. */}
          <div className="max-w-4xl border-t pt-16" style={{ borderColor: HAIRLINE }}>
            <h2 className="font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={HEADING}>
              <EditableText path="howPage.journeyHeading">{p.journeyHeading}</EditableText>
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-black/55">
              <EditableText path="howPage.journeyNote">{p.journeyNote}</EditableText>
            </p>

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
            <div className="mt-10 divide-y" style={{ borderColor: HAIRLINE, borderTopWidth: 1, borderBottomWidth: 1 }}>
              {p.journey.map((j, i) => (
                <Rise
                  key={`${j.label}-${i}`}
                  preset="cut"
                  index={i}
                  className="grid gap-2 py-5 sm:grid-cols-[7rem_1fr] sm:items-baseline sm:gap-6"
                >
                  <span className={"inline-flex w-fit rounded-full px-3 py-1 text-[13px] font-semibold " + toneFor(j.label)}>
                    <EditableText path={`howPage.journey.${i}.label`}>{j.label}</EditableText>
                  </span>
                  <span className="text-[15px] leading-relaxed text-black/65"><EditableText path={`howPage.journey.${i}.body`}>{j.body}</EditableText></span>
                </Rise>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="px-6 py-16">
        <Rise preset="settle" className="mx-auto max-w-5xl rounded-3xl px-8 py-14 text-center" style={{ background: ACCENT }}>
          {/* The closing band gets the rule too, in the plate's own foreground — it is the one
              device that ties the bottom of the page to the top. */}
          <div className="mx-auto mb-8 flex max-w-sm items-center gap-4 opacity-70">
            <span className="h-px flex-1" style={{ background: "color-mix(in oklch, var(--mk-accent-ink) 40%, transparent)" }} />
            <span className={CAPS} style={{ color: ACID }}>EGFULFILL</span>
            <span className="h-px flex-1" style={{ background: "color-mix(in oklch, var(--mk-accent-ink) 40%, transparent)" }} />
          </div>
          <h2 className="mx-auto max-w-2xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ ...HEADING, color: SURFACE }}>
            <EditableText path="howPage.cta.heading">{p.cta.heading}</EditableText>
          </h2>
          <div className="mt-8 flex justify-center">
            <Pill href="/signup" tone="ink"><EditableText path="howPage.cta.button">{p.cta.button}</EditableText></Pill>
          </div>
        </Rise>
      </section>
    </div>
  )
}
