"use client"

import { motion, useReducedMotion } from "motion/react"
import type { SiteContent } from "@/lib/site-content"
import { ACCENT, ACCENT_INK, INK, SURFACE, ACID, HAIRLINE, EASE, MaskedWords, TypedPhrase, Pill, Band, ProofBlocks, Window, ObjectTile, MediaHero } from "@/components/marketing/bold-kit"
import { ThreadCone, Printhead, ShippingBox, HangTag } from "@/components/marketing/objects"

/** One object per feature section, in factory order: make → print → pack → label. */
const FEATURE_OBJECTS = [ThreadCone, Printhead, ShippingBox, HangTag] as const
import { CalloutList } from "@/components/marketing/bold-figure"
import { EditableText, useEditMode } from "@/components/marketing/edit-mode"

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
      {/* ── HERO — FULL-BLEED MEDIA, DIRECTION A (locked 2026-08-26) ─────────────
          The first screen is the THING WE MAKE. This company sells a factory and the software
          that runs it, and almost every reference sells one or the other — which is why no
          borrowed hero shape ever fitted. The resolution: imagery carries the factory, and the
          software gets one reserved panel further down rather than five screenshots up here.

          THE THREAD FIELD IS GONE FROM THE HERO. It was the ground the type stood on while
          there was no picture; a photograph of the actual floor outargues a generative field,
          and running both would be two backgrounds fighting for the same job.

          NO MEDIA IS A REAL ANSWER — MediaHero draws the ink plate and the headline alone.
          A fake app panel was deleted from this page once, deliberately, and must not return
          as a stand-in for an image nobody has uploaded yet. */}
      <MediaHero media={hero.image} alt={hero.imageAlt}>
        {/* Capped in rem, not ch. A ch cap on display type measures the "0" glyph of whatever
            face has actually loaded, so it collapsed to about a third of its intended width and
            broke a five-word headline onto five lines — which then pushed the buttons off the
            first screen. A rem cap cannot drift with the font. */}
        <h1 className="font-display max-w-[54rem] font-semibold leading-[0.95] tracking-[-0.03em]" style={{ color: ACCENT_INK }}>
          <span style={{ fontSize: "clamp(2.6rem, 6.4vw, 5.2rem)" }}>
            {editing
              ? <EditableText path="hero.headline">{hero.headline}</EditableText>
              : <MaskedWords text={hero.headline} />}{" "}
            {editing
              ? <EditableText path="hero.accent">{hero.accent}</EditableText>
              : <TypedPhrase text={hero.accent} color={ACCENT_INK} lastWordColor={ACID} />}
          </span>
        </h1>

        <motion.p
          className="mt-7 max-w-xl text-[18px] leading-relaxed"
          style={{ color: ACCENT_INK, opacity: 0.78 }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 0.78, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35, ease: EASE }}
        >
          <EditableText path="hero.subhead">{hero.subhead}</EditableText>
        </motion.p>

        <motion.div
          className="mt-9 flex flex-wrap items-center gap-3"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.45, ease: EASE }}
        >
          <Pill href="/signup" tone="primary"><EditableText path="hero.ctaPrimary">{hero.ctaPrimary}</EditableText></Pill>
          <Pill href="/how-it-works" tone="ghostLight" ring><EditableText path="hero.ctaSecondary">{hero.ctaSecondary}</EditableText></Pill>
        </motion.div>
      </MediaHero>

      {/* THE THREE FACTS move out of the hero and onto the page beneath it. On the plate they
          were light type over a photograph at 13px, which is the first thing that stops being
          readable when someone uploads a busy image. */}
      <section className="mx-auto max-w-[88rem] px-6 pt-10 sm:px-10">
        <CalloutList items={hero.callouts} path="hero.callouts" className="flex-wrap gap-x-10 gap-y-6" />
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
      {/* The figures get the WHITE band — the first change of ground on the page, and the
          moment the reader learns this site has more than one surface. A hairline over
          parchment said "another paragraph"; a surface says "another kind of thing". */}
      {/* THE FIGURES BECOME VIOLET BLOCKS.
          They were a plain strip on a white band, which is a caption under the hero. A figure
          in a saturated block reads as a SPECIFICATION; the same figure in a bordered card
          reads as a claim someone typed. This is the one place the palette's violet is used,
          and the only place it is allowed — see the fence on --mk-violet. */}
      {stats.length > 0 && (
        <Band tone="card">
          <ProofBlocks items={stats} />
        </Band>
      )}

      {/* ── FEATURES — ALTERNATING TEXT AND WINDOW ────────────────────────────────
          Was a four-card grid of prose: four boxes of similar length that the eye skims and
          forgets, and which say nothing a competitor could not also write. This is the most
          repeated structure in the reference study — customer.io, webflow, openphone and
          cakeequity all run it — because the screenshot does the arguing and the copy only
          has to name what is being shown.

          Grounds alternate under it, so the sections divide by surface rather than by rule,
          and the window flips side each time so the page has a left-right rhythm instead of
          four identical rows. */}
      <Band tone="paper">
        <h2 className="max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
          <EditableText path="features.heading">{features.heading}</EditableText>
        </h2>
        <p className="mt-4 max-w-xl text-[17px] leading-relaxed" style={{ color: INK, opacity: 0.6 }}>
          <EditableText path="features.subhead">{features.subhead}</EditableText>
        </p>
      </Band>

      {features.cards.slice(0, 4).map((c, i) => {
        const Obj = FEATURE_OBJECTS[i % FEATURE_OBJECTS.length]
        const flip = i % 2 === 1
        return (
          <Band key={`${c.title}-${i}`} tone={flip ? "card" : "paper"}>
            <div className="grid items-center gap-x-14 gap-y-8 lg:grid-cols-2">
              <div className={flip ? "lg:order-2" : undefined}>
                <ObjectTile size={52}><Obj className="h-full w-full" /></ObjectTile>
                <h3 className="mt-6 font-display text-[clamp(1.5rem,2.6vw,2.1rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
                  <EditableText path={`features.cards.${i}.title`}>{c.title}</EditableText>
                </h3>
                <p className="mt-3 max-w-md text-[16px] leading-relaxed" style={{ color: INK, opacity: 0.62 }}>
                  <EditableText path={`features.cards.${i}.body`}>{c.body}</EditableText>
                </p>
              </div>
              {/* No `src` yet — the frame draws a wireframe rather than a fake screenshot.
                  Swap in a real capture per card once the boards are reskinned. */}
              <Window tilt={flip ? -2 : 2} caption={c.title} className={flip ? "lg:order-1" : undefined} />
            </div>
          </Band>
        )
      })}

      {/* ── STEPS — THE DARK BLOCK ────────────────────────────────────────────────
          This section used to sit on the page's own ground behind a hairline rule, and the
          note here argued against a band because the 3%-black one it replaced was "a second,
          muddier ground laid over the page's own". That was right about a TINT and is wrong
          about a SURFACE, and the difference is the whole point of the direction: 3% black
          over parchment is neither one thing nor the other, which is exactly what reads as a
          mistake. #14140F is not a tint of the page — it is the third surface in a system of
          three, and the light/dark alternation between them IS the page's rhythm.

          It also earns its keep structurally: with no shadows anywhere, a change of ground is
          the only way one section can separate from the next, so a rule between two identical
          grounds was never dividing anything. */}
      <Band tone="dark">
        <div>
          <h2 className="font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
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
                {/* ACID, not ink at 13%. On the dark block a faint ink numeral is simply
                    invisible; on this ground the accent is the one thing that can carry a
                    figure this large without competing with the heading. */}
                <div className="font-display font-semibold leading-none tracking-tighter" style={{ fontSize: "clamp(3.5rem, 7vw, 5.5rem)", color: ACID }}>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="mt-3 text-xl font-bold tracking-tight"><EditableText path={`steps.items.${i}.title`}>{s.title}</EditableText></h3>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: ACCENT_INK, opacity: 0.7 }}><EditableText path={`steps.items.${i}.body`}>{s.body}</EditableText></p>
              </motion.div>
            ))}
          </div>
        </div>
      </Band>

      {/* ── TESTIMONIALS ─────────────────────────────────────────────────────────
              Guarded on the list, not just mapped over it. An unattributable quote is a
              marketing claim a marketplace reviewer will read as invented, so the honest
              default is NO testimonials — and an unguarded section would then render a
              headline over an empty grid, which looks broken rather than empty. */}
      {testimonials.items.length > 0 && (
        <Band tone="card">
          <div>
            <h2 className="max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
              <EditableText path="testimonials.heading">{testimonials.heading}</EditableText>
            </h2>
            <div className="mt-14 grid gap-4 md:grid-cols-3">
              {testimonials.items.slice(0, 3).map((t, i) => (
                <motion.figure
                  key={t.name}
                  /* Same cut corner as the numbered cards — one card shape on the page. */
                  /* PARCHMENT, not CARD — this sits INSIDE the white band, and a white card
                     on a white ground is not a card, it is a border drawn for nothing. The
                     surfaces invert: on parchment a card is white, on white a card is
                     parchment. One radius, 26px, and no shadow either way. */
                  className="rounded-[26px] p-7"
                  style={{ background: SURFACE }}
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
        </Band>
      )}

      {/* ── FAQ — plain disclosure elements: keyboard and screen-reader behaviour for free,
              and no state to get wrong. ─────────────────────────────────────────────── */}
      <Band tone="paper">
        <div>
          <h2 className="font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
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
      </Band>

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
          {/* THE HEADING IS PAPER, NOT ACID — changed 2026-08-26.
            *
            * Acid on the plate is legitimate type and always was: check-skins measures it at
            * 15.49:1 on this ground, which is why the old note could be written at all. The
            * problem was never contrast, it was COUNT. A lime headline above a lime button
            * puts two lime things in one viewport, and the direction allows one — so the
            * button, which is the whole purpose of the band, stopped being the loud thing.
            *
            * Paper lettering, lime button. The accent fires once and it fires on the action. */}
          <h2 className="max-w-[48rem] font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 5.4vw, 4.4rem)", color: ACCENT_INK }}>
            <EditableText path="cta.heading">{cta.heading}</EditableText>
          </h2>
          <p className="mt-5 max-w-lg text-[17px] leading-relaxed" style={{ color: ACCENT_INK, opacity: 0.72 }}><EditableText path="cta.subhead">{cta.subhead}</EditableText></p>
          <div className="mt-10">
            <Pill href="/signup" tone="invert" ring><EditableText path="cta.button">{cta.button}</EditableText></Pill>
          </div>
        </div>
      </motion.section>
    </div>
  )
}
