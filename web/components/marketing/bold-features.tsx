"use client"

import { Check } from "@phosphor-icons/react"
import type { SiteContent } from "@/lib/site-content"
import { ACCENT, ACID, HAIRLINE, HEADING, SURFACE, Pill, PlateHero, Rise } from "@/components/marketing/bold-kit"
import { LabelRule, CutoutFigure, SpecStrip, CAPS } from "@/components/marketing/bold-figure"

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

  return (
    <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
      <PlateHero title={p.title} accent={p.accent} sub={p.sub} />

      {/* The band of figures, where the reference puts it: directly under the hero, divided by
          rules rather than boxed. Every value is a countable fact — see the note in
          lib/site-content.ts on why none of them is a rate or a total. */}
      {p.stats.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 pb-4">
          <LabelRule left={p.ruleLeft} right={p.ruleRight} className="mb-10" />
          <div className="border-t pt-10" style={{ borderColor: HAIRLINE }}>
            <SpecStrip items={p.stats} />
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
      {p.figure.image && (
        <section className="mx-auto max-w-6xl px-6 py-12">
          <CutoutFigure
            src={p.figure.image}
            alt={p.figure.imageAlt}
            ghost={p.figure.ghostWord}
            callouts={p.figure.callouts}
          />
        </section>
      )}

      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="divide-y" style={{ borderColor: HAIRLINE }}>
          {p.items.map((f, i) => (
            /*
              * A FIXED TRACK FOR THE NUMERAL, because every row is its own grid.
              *
              * This was `auto`, which sizes to the widest thing in THAT row — and each row is
              * a separate Rise with a separate grid, so "01" resolved narrower than "04" and
              * the six headings started at 328, 340, 341, 342… px. Six near-misses read as a
              * column that isn't straight, which is exactly the defect people then chase cell
              * by cell. One track at the container fixes all six at once, and tabular-nums
              * keeps the digits themselves from shifting.
              */
            <Rise key={`${f.title}-${i}`} preset="drift" index={i} className="grid gap-6 py-12 md:grid-cols-[5.5rem_1fr_auto] md:gap-10">
              {/* The number is the ordering cue a card grid can't give. Set big and quiet —
                  it's a position, not a value, so it shouldn't compete with the heading. */}
              <div className="font-display font-semibold leading-none tracking-tighter tabular-nums text-black/[0.13]" style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)" }}>
                {String(i + 1).padStart(2, "0")}
              </div>

              <div className="min-w-0">
                {/* No icon plate. The big number to the left is already the ordering cue, so a
                    filled accent tile beside the heading said nothing the row wasn't saying —
                    it just put a second coloured object in front of the words. The heading is
                    the thing to read. */}
                <h2 className="text-2xl font-bold tracking-tight">{f.title}</h2>
                {f.body && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-black/60">{f.body}</p>}
              </div>

              {f.points && f.points.length > 0 && (
                <ul className="space-y-2 md:w-56">
                  {f.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2 text-[13px] text-black/70">
                      <Check size={13} weight="bold" className="mt-0.5 shrink-0" />
                      {pt}
                    </li>
                  ))}
                </ul>
              )}
            </Rise>
          ))}
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
            {p.cta.heading}
          </h2>
          <div className="mt-8 flex justify-center">
            <Pill href="/signup" tone="ink">{p.cta.button}</Pill>
          </div>
        </Rise>
      </section>
    </div>
  )
}
