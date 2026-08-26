"use client"


import type { SiteContent } from "@/lib/site-content"
import { ACCENT, ACCENT_INK, ACID, HAIRLINE, HEADING, SURFACE, Pill, PlateHero, Rise } from "@/components/marketing/bold-kit"
import { LabelRule, CutoutFigure, SpecStrip, CAPS } from "@/components/marketing/bold-figure"
import { EditableText, EditableImage, useEditableNum, useEditableSrc, useEditMode } from "@/components/marketing/edit-mode"

/**
 * Features, in the house style. The same six capabilities and the same copy — restated as a
 * numbered run rather than a grid of equal cards.
 *
 * A six-card grid says "here are six things" and gives no reading order, so the eye picks at
 * random and nothing lands. Numbered full-width rows say "here is what happens, in order",
 * which is also what the product actually is: a pipeline.
 *
 * WHY THIS PAGE DOES NOT USE NumberedCards. It is the one piece of the figure kit left on the
 * shelf here, and deliberately: that component checkers light and dark TWO UP, which is right
 * for four short problems (the reference board's own use) and wrong for six capabilities that
 * each carry a paragraph and a three-item spec column. Two-up would halve the measure and
 * turn a readable run into six dense tiles. The run's own oversized numerals already give the
 * reading order the cards would have supplied — that was the whole argument for the run.
 *
 * What the kit DOES bring: the rule across the top, the band of figures under the hero, and
 * the product itself. The copy moved to stored site content with it, so the six are an admin
 * edit now instead of an array frozen into this file.
 */
export function BoldFeatures({ content }: { content: SiteContent }) {
  const p = content.featuresPage
  const { on: editing } = useEditMode()
  /** The DRAFT's figure, so a generated or uploaded picture appears before Save. */
  const figureSrc = useEditableSrc("featuresPage.figure.image", p.figure.image)
  const figureScale = useEditableNum("featuresPage.figure.imageScale", p.figure.imageScale)
  const figureRotate = useEditableNum("featuresPage.figure.imageRotate", p.figure.imageRotate)

  return (
    <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
      <PlateHero title={p.title} accent={p.accent} sub={p.sub} path="featuresPage" />

      {/* The band of figures, where the reference puts it: directly under the hero, divided by
          rules rather than boxed. Every value is a countable fact — see the note in
          lib/site-content.ts on why none of them is a rate or a total. */}
      {p.stats.length > 0 && (
        <section className="mx-auto max-w-[88rem] px-6 sm:px-10 pb-4">
          <LabelRule left={p.ruleLeft} right={p.ruleRight} leftPath="featuresPage.ruleLeft" rightPath="featuresPage.ruleRight" className="mb-10" />
          <div className="border-t pt-10" style={{ borderColor: HAIRLINE }}>
            <SpecStrip items={p.stats} path="featuresPage.stats" />
          </div>
        </section>
      )}

      {/*
        * THE PRODUCT.
        *
        * Paper tone, not the plate: on this page the figure INTRODUCES the run below it, while
        * how-it-works uses the dark panel because there the figure is the subject of its own
        * section. Same component, and the tone is the whole difference.
        *
        * Guarded on the image for the same reason as everywhere else — no picture renders no
        * section at all, never a grey box where a garment should be.
        */}
      {/* THE PAGE'S FIGURE, REPLACEABLE WHERE IT SITS — same overlay the homepage hero has:
          generate a picture from a prompt, or drop a file on it. In edit mode it renders even
          when empty, because otherwise there is nothing on the page to drop a picture ONTO —
          the one gesture the mode exists for would be the one it could not offer. */}
      {(figureSrc || editing) && (
        <section className="mx-auto max-w-[88rem] px-6 sm:px-10 py-12">
          <EditableImage path="featuresPage.figure.image">
            <CutoutFigure
              src={figureSrc}
              alt={p.figure.imageAlt}
              ghost={p.figure.ghostWord}
              ghostPath="featuresPage.figure.ghostWord"
              scale={figureScale}
              rotate={figureRotate}
              callouts={p.figure.callouts}
              calloutsPath="featuresPage.figure.callouts"
            />
          </EditableImage>
        </section>
      )}

      {/* ── THE WALL ──────────────────────────────────────────────────────────────
          Was a numbered divide-y list, and before that a card grid. Both threw away the only
          interesting thing about these methods: they leave physically DIFFERENT SURFACES.
          Embroidery is raised and directional; DTG has no hand at all. A numeral and a
          paragraph say none of that, and an icon in a rounded box says less.

          So: an irregular mosaic of full-bleed tiles, no card chrome, 3px seams. The first
          three run tall because embroidery is the signature and the eye should land there.

          NO COMPARISON TABLE YET, deliberately. The design calls for one — best on, colour
          range, minimum, feel — and not one of those facts exists in the content model.
          Inventing them would be fabricating product claims on a public page, so the table
          waits until the fields do. The wall is the half that can be built truthfully today.

          A tile has no image because there is no per-item image field. It renders as the ink
          plate with its name on it, which is a real design rather than a gap — the same call
          the hero makes when nobody has uploaded a picture. */}
      <section className="py-12">
        <div className="grid grid-cols-12 gap-[3px] px-[3px]">
          {p.items.map((f, i) => {
            /* Spans that RESOLVE. Seven items in a four-up grid orphans the last three, and
               widening them mid-grid produces two card widths in one row — which reads as
               broken. 5+4+3 then 3+3+3+3 fills both rows exactly. */
            const span = i < 3 ? [5, 4, 3][i] : 3
            const tall = i < 3
            return (
              <Rise
                key={`${f.title}-${i}`}
                preset="drift"
                index={i}
                className="relative flex items-end p-5 sm:p-6"
                style={{ background: ACCENT, gridColumn: `span ${span} / span ${span}`, minHeight: tall ? "clamp(15rem,22vw,20rem)" : "clamp(11rem,15vw,13.5rem)" }}
              >
                <div className="relative z-10 min-w-0">
                  <h2 className="font-display text-[clamp(1.15rem,1.7vw,1.55rem)] font-semibold leading-tight tracking-[-0.02em]" style={{ color: ACCENT_INK }}>
                    <EditableText path={`featuresPage.items.${i}.title`}>{f.title}</EditableText>
                  </h2>
                  {f.body && (
                    <p className="mt-2 max-w-[34ch] text-[13px] leading-relaxed" style={{ color: ACCENT_INK, opacity: 0.66 }}>
                      <EditableText path={`featuresPage.items.${i}.body`}>{f.body}</EditableText>
                    </p>
                  )}
                  {f.points && f.points.length > 0 && (
                    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
                      {f.points.map((pt, j) => (
                        <li key={pt} className="text-[11.5px]" style={{ color: ACID }}>
                          <EditableText path={`featuresPage.items.${i}.points.${j}`}>{pt}</EditableText>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Rise>
            )
          })}
        </div>
      </section>

      <section className="px-6 pb-16">
        <Rise preset="settle" className="mx-auto max-w-5xl rounded-3xl px-8 py-14 text-center" style={{ background: ACCENT }}>
          {/* The rule closes the page the way it opened it — the one device that ties the
              bottom back to the top, set in the plate's own foreground. */}
          <div className="mx-auto mb-8 flex max-w-sm items-center gap-4 opacity-70">
            <span className="h-px flex-1" style={{ background: "color-mix(in oklch, var(--mk-accent-ink) 40%, transparent)" }} />
            <span className={CAPS} style={{ color: ACID }}>EGFULFILL</span>
            <span className="h-px flex-1" style={{ background: "color-mix(in oklch, var(--mk-accent-ink) 40%, transparent)" }} />
          </div>
          <h2 className="mx-auto max-w-2xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ ...HEADING, color: SURFACE }}>
            <EditableText path="featuresPage.cta.heading">{p.cta.heading}</EditableText>
          </h2>
          <div className="mt-8 flex justify-center">
            <Pill href="/signup" tone="primary"><EditableText path="featuresPage.cta.button">{p.cta.button}</EditableText></Pill>
          </div>
        </Rise>
      </section>
    </div>
  )
}
