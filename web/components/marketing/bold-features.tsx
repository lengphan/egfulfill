"use client"


import type { SiteContent } from "@/lib/site-content"
import { ACCENT, ACCENT_INK, ACID, HEADING, SURFACE, Pill, Rise, MediaBand } from "@/components/marketing/bold-kit"
import { CalloutList } from "@/components/marketing/bold-figure"
import { EditableText, EditableImage, useEditableNum, useEditableSrc, useEditMode } from "@/components/marketing/edit-mode"
import { PageBanner } from "@/components/marketing/page-banner"

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
/**
 * ── THE WALL'S SPANS, FOR ANY COUNT ─────────────────────────────────────────────────────
 *
 * This used to be `i < 3 ? [5, 4, 3][i] : 3` with a note saying "the spans resolve —
 * 5+4+3 then 3+3+3+3 fills both rows exactly". It did, for SEVEN items. The stored content
 * has six, so the second row came to 3+3+3 = 9 of 12 and the wall ended with a quarter-width
 * hole in the bottom right. That is precisely the "layout seems undone" failure: not spacing,
 * a grid that leaves a gap — and the comment claiming it resolved is what stopped anyone
 * looking, because it had been true when it was written.
 *
 * A hardcoded span list is a layout that is only correct at one count, on a page whose items
 * an admin can add to and delete from. So the rows are COMPUTED, and every row sums to 12 at
 * every count from one item upward.
 *
 * The first row keeps three tall tiles at 5+4+3 wherever there are enough items to fill a
 * second row, because that asymmetry is the design and the eye should land there. What
 * changes is only what follows it.
 */
const ROW_SPANS: Record<number, number[]> = {
  1: [12],
  2: [6, 6],
  3: [5, 4, 3],
  4: [3, 3, 3, 3],
}

/** How many tiles sit in each row, given a total. Never strands one tile on its own row. */
function wallRows(n: number): number[] {
  const rows: number[] = []
  let left = n
  // The signature row, whenever there is a second row for the rest to fill.
  if (n >= 5) { rows.push(3); left -= 3 }
  while (left > 0) {
    const take = left <= 4 ? left : left === 5 ? 3 : 4
    rows.push(take)
    left -= take
  }
  // A lone tile behind a full row would span the whole width and read as a mistake; borrow
  // one from the row above so the tail is a pair instead.
  if (rows.length > 1 && rows[rows.length - 1] === 1) {
    rows[rows.length - 2] -= 1
    rows[rows.length - 1] = 2
  }
  return rows
}

/** Per-item span and height, flattened from the rows above. */
function wallSpans(n: number): { span: number; tall: boolean }[] {
  const out: { span: number; tall: boolean }[] = []
  wallRows(n).forEach((count, row) => {
    ROW_SPANS[count].forEach((span) => out.push({ span, tall: row === 0 }))
  })
  return out
}

export function BoldFeatures({ content }: { content: SiteContent }) {
  const p = content.featuresPage
  const { on: editing } = useEditMode()
  /** The DRAFT's figure, so a generated or uploaded picture appears before Save. */
  const figureSrc = useEditableSrc("featuresPage.figure.image", p.figure.image)
  /* Same reason as the src above — the crop has to move while it is dragged, not on Save. */
  const figFx = useEditableNum("featuresPage.figure.imageFocusX", p.figure.imageFocusX)
  const figFy = useEditableNum("featuresPage.figure.imageFocusY", p.figure.imageFocusY)
  const figZoom = useEditableNum("featuresPage.figure.imageScale", p.figure.imageScale)

  /* Computed once for the whole wall rather than per tile: a span depends on how many items
     there are in total, which an individual tile cannot know. */
  const spans = wallSpans(p.items.length)

  return (
    <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
      <PageBanner head={p} pathPrefix="featuresPage" />

      {/* NO BAND OF FIGURES UNDER THE HERO — removed 2026-08-26, and on all three pages that
          carried one. It was the pitch-deck reference's opening move: four countable facts in
          a strip so the page states its size before it states what it does. The confirmed
          prototype does not have it, and the reason it does not is that the figures were the
          smallest claims on the page — 3 marketplaces and 7 print methods are facts the
          integrations row and the features wall already carry, said once each and in the place
          a reader is actually looking for them. Restating them as a spec sheet buys a band of
          scrolling and tells nobody anything new. Do not reinstate it as "social proof". */}

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
      {/* ── THE PAGE'S PICTURE, FULL BLEED ─────────────────────────────────────────
          Was a CutoutFigure on a soft wash inside a Band. The photography is now shot on a
          COLOURED SEAMLESS, and cutting a subject out of one carries the studio colour through
          the hair and shoulder edge — the subject arrives wearing a halo. So the frame stays
          whole and the studio ground becomes the band. On this page it is the violet ground — the one place that token is painted since the figures band went.

          Still replaceable where it sits, and still rendered empty in edit mode: with no
          picture there is nothing on the page to drop one ONTO, and the one gesture the mode
          exists for would be the one it could not offer. MediaBand's own guard means a visitor
          sees nothing rather than a grey box.

          The callouts survive the move and now sit ON the picture under the scrim — the
          annotated-figure device the reference boards use, which the cut-out was carrying
          before. `ink` tone is the LIGHT lettering, which is what a scrim needs. */}
      {(figureSrc || editing) && (
        <EditableImage path="featuresPage.figure.image" transform="bleed">
          <MediaBand media={figureSrc} alt={p.figure.imageAlt} focusX={figFx} focusY={figFy} scale={figZoom}>
            {p.figure.callouts.length > 0 && (
              <CalloutList
                items={p.figure.callouts}
                path="featuresPage.figure.callouts"
                tone="ink"
                className="flex-wrap gap-x-10 gap-y-5"
              />
            )}
          </MediaBand>
        </EditableImage>
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
            const { span, tall } = spans[i]
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

      {/* ── CTA — the same edge-to-edge plate every page now ends on. The rounded centred
          box, and the EGFULFILL rule that was holding its top edge, went with it: a band that
          stops short of both margins reads as an advert pasted onto the page. */}
      <section className="px-6 py-24 sm:px-10" style={{ background: ACCENT }}>
        <div className="mx-auto max-w-[88rem]">
          <h2 className="max-w-[48rem] font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ ...HEADING, color: ACCENT_INK }}>
            <EditableText path="featuresPage.cta.heading">{p.cta.heading}</EditableText>
          </h2>
          <div className="mt-10">
            <Pill href="/signup" tone="invert" ring><EditableText path="featuresPage.cta.button">{p.cta.button}</EditableText></Pill>
          </div>
        </div>
      </section>
    </div>
  )
}
