"use client"

import { motion, useReducedMotion } from "motion/react"
import type { SiteContent } from "@/lib/site-content"
import { ACCENT, ACCENT_INK, CARD, INK, SURFACE, ACID, FIELD, HAIRLINE, EASE, MaskedWords, Pill } from "@/components/marketing/bold-kit"
import { LabelRule, CalloutList, Chip, ObjectSlot, StatOrbs, Bento } from "@/components/marketing/bold-figure"
import { EditableImage, EditableText, useEditMode, useEditableNum, useEditableSrc } from "@/components/marketing/edit-mode"

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
  /** The hero figure as the DRAFT has it, so a replacement shows up before Save. */
  const heroImage = useEditableSrc("hero.image", hero.image)
  /** How it sits, from the draft, so the rotate and resize buttons move the figure now. */
  const heroScale = useEditableNum("hero.imageScale", hero.imageScale)
  const heroRotate = useEditableNum("hero.imageRotate", hero.imageRotate)
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
        {/* A CHIP AND A MARK, on one line above the word.
            Every reference opens with these two before the display element — a named chip on
            a colour ground at the left, an arrow mark at the right. They give the page a top
            edge that is not a heading, and they are the first colour a visitor meets.

            THE LabelRule THAT USED TO SIT HERE IS GONE. It named the brand at the left and
            what we do at the right — and directly beneath it the word says the brand at 184px
            while this chip says what we do. Three lines, two facts. The rule is the one that
            loses: a hairline with the same words on it is the weakest of the three. */}
        {/* THE MARK THAT USED TO SIT AT THE RIGHT IS GONE TOO, for the reason its own second
            line went: it repeated something already on screen. It carried `hero.ctaSecondary`
            — the identical words to the "See how it works" button 500px below it — so the
            hero asked twice, in two different shapes, for one thing.

            It was also the collision. The object below is absolutely positioned and pulled up
            past this row's baseline, so the garment landed squarely on the badge and left a
            fragment of the label sticking out from behind a sleeve. Measured: the badge at
            x=1267 under an image spanning x=818–1454. Removing the duplicate removes the
            overlap; nothing has to be nudged. */}
        <div className="flex flex-wrap items-center gap-6">
          <Chip path="hero.ruleRight">{hero.ruleRight}</Chip>
        </div>

        {/*
          * ── THE WORD ────────────────────────────────────────────────────────────────
          *
          * ONE WORD, AT POSTER SCALE, WITH THE OBJECT CROSSING IT.
          *
          * This replaces a two-column hero whose left half was a cut-out garment and whose
          * right half was a 3.9rem sentence. Three things were wrong with that and all three
          * are structural rather than cosmetic:
          *
          *   · a SENTENCE cannot be large — a clause needs two lines and a subhead under it,
          *     which caps the type at about 4rem, which is not a display size on a 1400px page
          *   · the figure sat in its OWN grid column, so it touched nothing; the references
          *     all put the object ACROSS the type, and that overlap is the only depth on the
          *     page
          *   · the brand appeared as a pale ghost watermark BEHIND the figure — decoration
          *     standing in for a display element. It is the display element now.
          *
          * The stack is deliberate: word at the back, object over it, and nothing else inside
          * this block. Anything more and the object has no clear ground to cross.
          */}
        <div className="relative mt-6 sm:mt-8">
          <h1
            className="font-display font-bold leading-[0.82] tracking-[-0.045em]"
            style={{ fontSize: "clamp(3.2rem, 13vw, 11.5rem)", color: INK }}
          >
            {editing
              ? <EditableText path="hero.word">{hero.word || hero.headline}</EditableText>
              : <MaskedWords text={hero.word || hero.headline} />}
          </h1>

          {/* THE OBJECT, when there is one — see ObjectSlot. Sized and placed HERE rather
              than inside the component, because where a shape should cross the word is a
              decision about this layout, not about every layout. Right of centre and pulled
              up over the word's cap height, which is where all four references sit theirs.

              IN EDIT MODE THE BOX RENDERS EVEN WHEN EMPTY, because it is the drop target —
              the one gesture that mode exists for would otherwise have nothing to land on.
              A visitor with no object set sees nothing at all: §4, an empty state must never
              be mistakable for a broken one, and a dashed rectangle in a hero is worse than
              no object. */}
          {(heroImage || editing) && (
            <div className="absolute right-[4%] top-1/2 h-[clamp(13rem,26vw,24rem)] w-[clamp(13rem,26vw,24rem)] -translate-y-[58%]">
              <EditableImage path="hero.image">
                <ObjectSlot src={heroImage} alt={hero.imageAlt} scale={heroScale} rotate={heroRotate} />
              </EditableImage>
            </div>
          )}
        </div>

        {/*
          * ── WHAT THE WORD DOESN'T SAY ───────────────────────────────────────────────
          *
          * The proposition, the routes on, and the evidence — in a band under the word rather
          * than beside it. Two columns, and the facts are RIGHT-aligned to the page edge so
          * the band has an outer edge on both sides instead of trailing off.
          */}
        <div className="mt-10 grid gap-x-14 gap-y-10 border-t pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" style={{ borderColor: HAIRLINE }}>
          <div>
            <h2
              className="max-w-[20ch] font-display font-semibold leading-[1.02] tracking-[-0.03em]"
              style={{ fontSize: "clamp(1.75rem, 3.4vw, 2.9rem)", color: INK }}
            >
              <EditableText path="hero.headline">{hero.headline}</EditableText>{" "}
              <EditableText path="hero.accent">{hero.accent}</EditableText>
            </h2>

            <motion.p
              className="mt-5 max-w-xl text-[17px] leading-relaxed text-[var(--mk-ink)]/62"
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
              <Pill href="/signup" tone="accent"><EditableText path="hero.ctaPrimary">{hero.ctaPrimary}</EditableText></Pill>
              <Pill href="/how-it-works" tone="ghost" ring><EditableText path="hero.ctaSecondary">{hero.ctaSecondary}</EditableText></Pill>
            </motion.div>
          </div>

          {/* The evidence, stacked in its own column on a panel — a different SURFACE from
              the page, which is what separates it without drawing a box round it. */}
          {hero.callouts.length > 0 && (
            <div className="rounded-[26px] p-7" style={{ background: FIELD }}>
              <CalloutList items={hero.callouts} path="hero.callouts" className="flex-col gap-6" />
            </div>
          )}
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
          {/* DISCS, NOT A SPEC BAND. The same four figures under rules read as a footnote to
              the hero — a row of small numbers you skim. Sized discs on the palette's grounds
              are OBJECTS, so they hold the page the way the hero object does, and they are the
              second place colour lands as an area. SpecStrip is still the right device on the
              product and how-it-works pages, where the figures ARE specifications. */}
          <div className="border-t pt-14" style={{ borderColor: HAIRLINE }}>
            <StatOrbs items={stats} path="stats" />
          </div>
        </section>
      )}

      {/* ── FEATURES ───────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[88rem] px-6 pt-24 sm:px-10">
        <Chip>What it does</Chip>
        <h2 className="mt-5 max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
          <EditableText path="features.heading">{features.heading}</EditableText>
        </h2>
        <p className="mt-4 max-w-xl text-[17px] leading-relaxed" style={{ color: INK, opacity: 0.55 }}><EditableText path="features.subhead">{features.subhead}</EditableText></p>

        {/*
          * TILES ON MIXED GROUNDS, not four numbered boxes.
          *
          * The numbered checker alternated light and dark, which is one variation applied
          * uniformly — four cards still read as four of the same thing. The bento cycles four
          * grounds and promotes one tile to double width, so the grid has a rhythm. It also
          * carries no border on any coloured tile: a different SURFACE separates harder than a
          * 1px rule, and §4 has been counting the 490 outlined boxes this product already has.
          */}
        <Bento
          items={features.cards.map((c, i) => ({ ...c, wide: i === 0 }))}
          path="features.cards"
          className="mt-12"
        />
      </section>

      {/* ── STEPS — numbers oversized, the way the style wants ────────────────────
          Divided from what is above by a RULE, not by a tinted band. The 3%-black band this
          used to sit in was a second, muddier ground laid over the page's own, and it is the
          thing that made a full-width section look like a mistake. */}
      <section className="mx-auto max-w-[88rem] px-6 pt-24 sm:px-10">
        <div className="border-t pt-16" style={{ borderColor: HAIRLINE }}>
          <Chip tone="field">How it runs</Chip>
          <h2 className="mt-5 font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
            <EditableText path="steps.heading">{steps.heading}</EditableText>
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
                <h3 className="mt-3 text-xl font-bold tracking-tight"><EditableText path={`steps.items.${i}.title`}>{s.title}</EditableText></h3>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: INK, opacity: 0.55 }}><EditableText path={`steps.items.${i}.body`}>{s.body}</EditableText></p>
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
              <EditableText path="testimonials.heading">{testimonials.heading}</EditableText>
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
                  <blockquote className="mt-3 text-[15px] leading-relaxed" style={{ color: INK, opacity: 0.7 }}><EditableText path={`testimonials.items.${i}.quote`}>{t.quote}</EditableText></blockquote>
                  <figcaption className="mt-5 text-sm">
                    <span className="font-bold"><EditableText path={`testimonials.items.${i}.name`}>{t.name}</EditableText></span>
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
          <Chip tone="field">Questions</Chip>
          <h2 className="mt-5 font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
            <EditableText path="faq.heading">{faq.heading}</EditableText>
          </h2>
          {/* The answers are a reading column even though the section is full width: a line of
              body copy 1,400px long cannot be read, and full-bleed applies to the SECTION, not
              to every line inside it. */}
          <div className="mt-12 max-w-3xl">
            {faq.items.map((f, i) => (
              <details key={i} className={`group py-5 ${i > 0 ? "border-t" : ""}`} style={i > 0 ? { borderColor: HAIRLINE } : undefined}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-left text-lg font-bold tracking-tight [&::-webkit-details-marker]:hidden">
                  <EditableText path={`faq.items.${i}.q`}>{f.q}</EditableText>
                  <span aria-hidden className="shrink-0 text-2xl font-display font-semibold transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed" style={{ color: INK, opacity: 0.6 }}><EditableText path={`faq.items.${i}.a`}>{f.a}</EditableText></p>
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
          <LabelRule left={hero.ruleLeft} right={hero.ruleRight} leftPath="hero.ruleLeft" rightPath="hero.ruleRight" tone="light" className="mb-16" />
          {/* ACID on the accent — 16.66:1 on `studio`, 5.07 on `press`. Measured on every skin
              by tools/check-skins.mjs, which is the only reason this line can be written. */}
          <h2 className="max-w-[48rem] font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 5.4vw, 4.4rem)", color: ACID }}>
            <EditableText path="cta.heading">{cta.heading}</EditableText>
          </h2>
          <p className="mt-5 max-w-lg text-[17px] leading-relaxed" style={{ color: ACCENT_INK, opacity: 0.72 }}><EditableText path="cta.subhead">{cta.subhead}</EditableText></p>
          <div className="mt-10">
            <Pill href="/signup" tone="acid" ring><EditableText path="cta.button">{cta.button}</EditableText></Pill>
          </div>
        </div>
      </motion.section>
    </div>
  )
}
