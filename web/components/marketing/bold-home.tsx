"use client"

import { motion, useReducedMotion } from "motion/react"
import type { SiteContent } from "@/lib/site-content"
import { ACCENT, ACCENT_INK, CARD, INK, SURFACE, ACID, HAIRLINE, EASE, MaskedWords, TypedPhrase, Pill } from "@/components/marketing/bold-kit"
import { LabelRule, CalloutList, CutoutFigure, SpecStrip, NumberedCards } from "@/components/marketing/bold-figure"
import { EditableImage, EditableText, useEditMode } from "@/components/marketing/edit-mode"

/**
 * "Exaggerated Minimalism" — black and white carrying the page, ONE vibrant accent, type
 * doing the work that decoration usually does. Chosen against the reference the user gave
 * (bold flat, not frosted) rather than the glassmorphism the style search first offered.
 *
 * The rules that keep it from becoming noise:
 *   · one accent, and it never appears twice in a viewport competing with itself
 *   · type scales with the viewport (clamp) instead of breaking at arbitrary widths
 *   · motion is spatial — things arrive from where they belong and settle. Nothing loops,
 *     nothing bounces for attention, and every effect is skipped under reduced-motion
 *   · black on lime is ~16:1, well past AA, so the accent can hold real text
 */


export function BoldHome({ content }: { content: SiteContent }) {
  // Edit mode swaps the ANIMATED text for an editable one. MaskedWords and TypedPhrase
  // own the DOM they animate, so a contentEditable inside either would be re-mounted mid-
  // keystroke; the plain string is the honest thing to edit and the animation is what a
  // visitor sees.
  const { on: editing } = useEditMode()
  const { hero, stats, features, steps, testimonials, faq, cta } = content
  const reduce = useReducedMotion()
  // The scroll-linked parallax went with the app panel it moved. Nothing on this page
  // tracks scroll any more.

  /** One half of the marquee, repeated until it is long enough to span a wide screen on its
   *  own. Both halves must be identical for the -50% loop to be seamless, so the padding
   *  happens HERE rather than in the render. */
  const marqueeHalf = (() => {
    const src = hero.integrations ?? []
    if (!src.length) return []
    const out: string[] = []
    while (out.length < 10) out.push(...src)
    return out
  })()

  return (
    <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
      {/* ── HERO ─────────────────────────────────────────────────────────────────
          FULL WIDTH, NO CONTAINER. The reference this page borrows from is a PITCH DECK —
          its "cards" are slides, and a slide is a light panel on a ground because that is
          what a slide IS. A website has no slides, so a panel here is a box drawn around
          content for no reason: it narrows every line, adds a second inset inside the page's
          own, and puts an edge between sections that the eye then has to cross. The devices
          worth taking off those boards — the label rule, the ghost word, the numbered
          checker, the ring pill — all work at full width, which is where they are now. */}
      <section className="mx-auto max-w-[88rem] px-6 pt-10 sm:px-10 sm:pt-14">
        {/* The brand at one end, who this is for at the other, a hairline between. ONCE, at
            the top of the page — the boards repeat it because each slide is a fresh sheet,
            and repeating it down one continuous page is just the same line four times. */}
        <LabelRule left={hero.ruleLeft} right={hero.ruleRight} className="mb-12" />

        {/*
          * TWO COLUMNS — PICTURE LEFT, WORDS RIGHT.
          *
          * The single-column version put a 7rem headline across the full 88rem and orphaned
          * the picture underneath it, which produced the two things that actually looked
          * wrong: an empty right half beside the headline, and a figure centred under copy
          * that was hard left, so nothing on the page shared an edge with anything else.
          *
          * Side by side, the width is USED, and the headline no longer has to be enormous to
          * fill a line — it drops from 7rem to 3.9rem, which is what lets the subhead, the
          * buttons and three facts about the product all sit above the fold together. That
          * density is most of what separates the reference from a page of big type.
          *
          * The picture is FIRST in the DOM and first on the page, which is the same order —
          * so a screen reader meets the product before the pitch, and nothing needs `order-`
          * to disagree with the markup.
          */}
        <div className="grid items-center gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,44%)_minmax(0,1fr)]">
          {/* IN EDIT MODE AN EMPTY FIGURE STILL RENDERS, because otherwise there is nothing on
              the page to drop a picture onto — the one gesture that mode exists for would be
              the one it cannot offer. A visitor still sees nothing, and with no picture the
              grid collapses to the copy alone rather than leaving a hole where it would be. */}
          {(hero.image || editing) && (
            <EditableImage path="hero.image">
              <CutoutFigure src={hero.image} alt={hero.imageAlt} ghost={hero.ghostWord} tall />
            </EditableImage>
          )}

          <div>
            <h1 className="font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ color: INK }}>
              <span style={{ fontSize: "clamp(2.4rem, 4.4vw, 3.9rem)" }}>
                {editing
                  ? <EditableText path="hero.headline">{hero.headline}</EditableText>
                  : <MaskedWords text={hero.headline} />}{" "}
                {editing
                  ? <EditableText path="hero.accent">{hero.accent}</EditableText>
                  : <TypedPhrase text={hero.accent} color={INK} lastWordColor={ACCENT} />}
              </span>
            </h1>

            <motion.p
              className="mt-6 max-w-lg text-[17px] leading-relaxed text-[var(--mk-ink)]/62"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35, ease: EASE }}
            >
              <EditableText path="hero.subhead">{hero.subhead}</EditableText>
            </motion.p>

            <motion.div
              className="mt-8 flex flex-wrap items-center gap-3"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.45, ease: EASE }}
            >
              {/* Filled, then outlined with the ring. Two buttons of identical shape read as
                  one control repeated; the ring separates "the thing to do" from "the thing
                  to read first". */}
              <Pill href="/signup" tone="accent">{hero.ctaPrimary}</Pill>
              <Pill href="/how-it-works" tone="ghost" ring>{hero.ctaSecondary}</Pill>
            </motion.div>

            {/* UNDER THE COPY, not beside the picture — see the CalloutList note. Three facts
                in a row across the text column, so the fold carries a claim, a subhead, two
                routes on and the evidence, which is four things instead of one big line. */}
            {hero.callouts.length > 0 && (
              <div className="mt-12 border-t pt-8" style={{ borderColor: HAIRLINE }}>
                <CalloutList items={hero.callouts} className="flex-col gap-6 sm:flex-row sm:gap-8" />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── THE CHANNEL MARQUEE ──────────────────────────────────────────────────
          Edge to edge, and masked to transparent at both ends rather than clipped: a name
          sliced in half reads as broken layout, a name fading out reads as a band that
          carries on past the screen — which is what it is. */}
      <div
        className="relative flex overflow-hidden py-14"
        style={{
          maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
          WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
        }}
      >
        {/* TWO IDENTICAL HALVES, and the animation travels exactly one of them (-50%), so the
            loop point lands on a frame identical to the start — that is what makes it seamless
            rather than snapping back. The half is padded out to at least ten names first: with
            only four channels the half was narrower than a wide screen, so the strip ran out
            and left a gap before it wrapped. */}
        <motion.div
          className="flex shrink-0 gap-14 pr-14"
          animate={reduce ? undefined : { x: ["0%", "-50%"] }}
          transition={{ duration: 28, ease: "linear", repeat: Infinity }}
        >
          {[...marqueeHalf, ...marqueeHalf].map((name, i) => (
            <span key={`${name}-${i}`} className="whitespace-nowrap text-2xl font-display font-semibold tracking-tight" style={{ color: INK, opacity: 0.2 }}>{name}</span>
          ))}
        </motion.div>
      </div>

      {/*
        * ── THE STRIP OF FIGURES ────────────────────────────────────────────────
        *
        * The stats, said the way a spec sheet says them: a value, what it measures, why it
        * matters, and a rule between each. No box around them — a figure inside a card reads
        * as a claim somebody made, while a figure in a band divided by rules reads as a
        * specification, which is the whole reason the reference puts one under its hero.
        *
        * Skipped entirely when the list is empty, which is how an admin removes the section.
        */}
      {stats.length > 0 && (
        <section className="mx-auto max-w-[88rem] px-6 sm:px-10">
          <div className="border-t pt-12" style={{ borderColor: HAIRLINE }}>
            <SpecStrip items={stats} />
          </div>
        </section>
      )}

      {/* ── FEATURES ───────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[88rem] px-6 pt-24 sm:px-10">
        <h2 className="max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
          {features.heading}
        </h2>
        <p className="mt-4 max-w-xl text-[17px] leading-relaxed" style={{ color: INK, opacity: 0.55 }}>{features.subhead}</p>

        {/*
          * NUMBERED, ALTERNATING LIGHT AND DARK, ONE CORNER CUT.
          *
          * These ARE cards, and they are the one place on the page that should be: they are
          * four discrete things you compare, not a container drawn round a section. Four
          * identical bordered boxes read as a list you skim and forget — §4 has been counting
          * those, 490 outlined boxes across the app — so the board's checker does real work
          * here: it makes four things read as four things.
          */}
        <NumberedCards items={features.cards} className="mt-14" />
      </section>

      {/* ── STEPS — numbers oversized, the way the style wants ────────────────────
          Divided from what is above by a RULE, not by a tinted band. The 3%-black band this
          used to sit in was a second, muddier ground laid over the page's own, and it is the
          thing that made a full-width section look like a mistake. */}
      <section className="mx-auto max-w-[88rem] px-6 pt-24 sm:px-10">
        <div className="border-t pt-16" style={{ borderColor: HAIRLINE }}>
          <h2 className="font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
            {steps.heading}
          </h2>
          <div className="mt-14 grid gap-12 md:grid-cols-3">
            {steps.items.slice(0, 3).map((s, i) => (
              <motion.div
                key={s.title}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "0px 0px -12% 0px" }}
                transition={{ duration: 0.55, delay: i * 0.09, ease: EASE }}
              >
                <div className="font-display font-semibold leading-none tracking-tighter" style={{ fontSize: "clamp(3.5rem, 7vw, 5.5rem)", color: INK, opacity: 0.13 }}>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="mt-3 text-xl font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: INK, opacity: 0.55 }}>{s.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ─────────────────────────────────────────────────────────
              Guarded on the list, not just mapped over it. An unattributable quote is a
              marketing claim a marketplace reviewer will read as invented, so the honest
              default is NO testimonials — and an unguarded section would then render a
              headline over an empty grid, which looks broken rather than empty. */}
      {testimonials.items.length > 0 && (
        <section className="mx-auto max-w-[88rem] px-6 pt-24 sm:px-10">
          <div className="border-t pt-16" style={{ borderColor: HAIRLINE }}>
            <h2 className="max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
              {testimonials.heading}
            </h2>
            <div className="mt-14 grid gap-4 md:grid-cols-3">
              {testimonials.items.slice(0, 3).map((t, i) => (
                <motion.figure
                  key={t.name}
                  /* Same cut corner as the numbered cards — one card shape on the page. */
                  className="rounded-[22px] rounded-tr-[4px] p-7"
                  style={{ background: CARD, border: `1px solid ${HAIRLINE}` }}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "0px 0px -12% 0px" }}
                  transition={{ duration: 0.55, delay: i * 0.08, ease: EASE }}
                >
                  {/* The quote mark is oversized — the one piece of ornament the style allows,
                      because it's type doing it. */}
                  <span aria-hidden className="block text-6xl font-display font-semibold leading-[0.6]" style={{ color: ACCENT }}>&ldquo;</span>
                  <blockquote className="mt-3 text-[15px] leading-relaxed" style={{ color: INK, opacity: 0.7 }}>{t.quote}</blockquote>
                  <figcaption className="mt-5 text-sm">
                    <span className="font-bold">{t.name}</span>
                    <span style={{ color: INK, opacity: 0.45 }}> · {t.role}</span>
                  </figcaption>
                </motion.figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── FAQ — plain disclosure elements: keyboard and screen-reader behaviour for free,
              and no state to get wrong. ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[88rem] px-6 pb-24 pt-24 sm:px-10">
        <div className="border-t pt-16" style={{ borderColor: HAIRLINE }}>
          <h2 className="font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
            {faq.heading}
          </h2>
          {/* The answers are a reading column even though the section is full width: a line of
              body copy 1,400px long cannot be read, and full-bleed applies to the SECTION, not
              to every line inside it. */}
          <div className="mt-12 max-w-3xl">
            {faq.items.map((f, i) => (
              <details key={i} className={`group py-5 ${i > 0 ? "border-t" : ""}`} style={i > 0 ? { borderColor: HAIRLINE } : undefined}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-left text-lg font-bold tracking-tight [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden className="shrink-0 text-2xl font-display font-semibold transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed" style={{ color: INK, opacity: 0.6 }}>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA — EDGE TO EDGE, and the only full-bleed colour on the page ────────
          It used to be a rounded box inside a max-w-5xl, which is a card again: a band that
          stops short of both margins reads as an advert someone pasted onto the page rather
          than as the page ending. */}
      <motion.section
        className="px-6 py-24 sm:px-10"
        style={{ background: ACCENT }}
        initial={reduce ? { opacity: 0 } : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "0px 0px -10% 0px" }}
        transition={{ duration: 0.7, ease: EASE }}
      >
        <div className="mx-auto max-w-[88rem]">
          <LabelRule left={hero.ruleLeft} right={hero.ruleRight} tone="light" className="mb-16" />
          {/* ACID on the accent — 16.66:1 on `studio`, 5.07 on `press`. Measured on every skin
              by tools/check-skins.mjs, which is the only reason this line can be written. */}
          <h2 className="max-w-[48rem] font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 5.4vw, 4.4rem)", color: ACID }}>
            {cta.heading}
          </h2>
          <p className="mt-5 max-w-lg text-[17px] leading-relaxed" style={{ color: ACCENT_INK, opacity: 0.72 }}>{cta.subhead}</p>
          <div className="mt-10">
            <Pill href="/signup" tone="acid" ring>{cta.button}</Pill>
          </div>
        </div>
      </motion.section>
    </div>
  )
}
