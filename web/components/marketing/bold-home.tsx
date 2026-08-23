"use client"

import { useRef } from "react"
import { motion, useReducedMotion } from "motion/react"
import type { SiteContent } from "@/lib/site-content"
import { ACCENT, INK, SURFACE, ACID, HAIRLINE, MaskedWords, TypedPhrase, Pill } from "@/components/marketing/bold-kit"
import { LabelRule, CutoutFigure, SpecStrip, NumberedCards } from "@/components/marketing/bold-figure"
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
  const heroRef = useRef<HTMLDivElement>(null)
  // The scroll-linked parallax went with the panel it moved. Nothing else in the hero
  // tracked scroll, so the spring was running a MotionValue nobody read.

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
      {/* ── HERO ───────────────────────────────────────────────────────────────── */}
      {/* NOT overflow-hidden. The product panel deliberately hangs past the plate's bottom
          edge — that overhang is the depth — and clipping the section amputated it to a strip
          of window chrome. The diagonal below does its own clipping via clip-path, so the
          section never needed to clip anything. */}
      {/* -mt-16 pt-16 pulls the plate UP behind the sticky 4rem header, so the colour starts
          at the top of the window instead of under a white bar. The header itself goes
          transparent on this route (site-header.tsx) — between them, the hero reads as one
          full-bleed plate with the nav sitting on it. */}
      {/* PAPER, not a plate. Measured: the full-bleed violet covered 76% of the viewport at
          chroma 0.272 — near the top of what sRGB can express at that hue — against 0.9% on
          the sign-in page, which nobody has ever called too bright. It was the AREA, not the
          hue, so re-picking the purple would only have produced a differently bright wall.
          The violet is unchanged; it now appears on the accent phrase, the button and the
          chart, which is what "ONE accent" in CLAUDE.md 4 has always meant.

          The diagonal went with it: it existed to return the page to paper below the plate,
          and there is no plate to return from. */}
      <section ref={heroRef} className="relative -mt-16 pt-16" style={{ background: SURFACE }}>
        {/* pb-32 is sized for the app PANEL, which hangs past the section on a negative
            margin. A figure sits in the flow, so the same padding is a hole between the
            buttons and the product it is meant to be introducing. */}
        {/* pb-32 was also panel clearance. The figure follows immediately now, and with no
            figure the strip of numbers does — either way there is something directly under
            the buttons, so the gap only has to separate them from it. */}
        <div className={"mx-auto max-w-6xl px-6 pt-14 sm:pt-20 " + (hero.image ? "pb-6" : "pb-10")}>
          {/* The rule the reference boards open on: who we are at one end, who this is for at
              the other, a hairline between. It gives the page a top edge without a box, and
              it says the second thing a visitor needs before the headline says the first. */}
          <LabelRule left={hero.ruleLeft} right={hero.ruleRight} className="mb-10" />
          <h1 className="max-w-5xl text-center font-display font-semibold leading-[0.92] tracking-[-0.032em] mx-auto"
              // Ink on paper — 17.40:1. The headline is the page; the colour is one phrase.
              style={{ color: INK }}
              >
            <span style={{ fontSize: "clamp(2.6rem, 7.2vw, 6.2rem)" }}>
            {editing
              ? <EditableText path="hero.headline">{hero.headline}</EditableText>
              : <MaskedWords text={hero.headline} />}{" "}
            {/* The one hot colour on the page, and now the ONLY place it appears at display
                size. Violet on paper is 5.33:1 — real type. Lime cannot be used here: on
                paper it is 1.05:1 and simply disappears. */}
            {editing
              ? <EditableText path="hero.accent">{hero.accent}</EditableText>
              : <TypedPhrase text={hero.accent} color={INK} lastWordColor={ACCENT} />}
            </span>
          </h1>

          <motion.p
            className="mx-auto mt-7 max-w-xl text-center text-[17px] leading-relaxed text-[var(--mk-ink)]/62"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <EditableText path="hero.subhead">{hero.subhead}</EditableText>
          </motion.p>

          <motion.div
            className="mt-9 flex flex-wrap items-center justify-center gap-3"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Violet fill + lime label is the primary everywhere now — the same pair as the
                app's default button. The secondary is an ink outline, because a light one
                only works over a dark plate and there isn't one. */}
            <Pill href="/signup" tone="accent">{hero.ctaPrimary}</Pill>
            <Pill href="/how-it-works" tone="ghost">{hero.ctaSecondary}</Pill>
          </motion.div>
        </div>

        {/*
          * THE PRODUCT — and nothing at all when there isn't one.
          *
          * THE FLOATING APP PANEL IS GONE. It was a drawn macOS window with a bar chart of
          * invented columns and three figures peeled off it as chips, and it had two problems
          * the reference boards make obvious. It showed our ADMIN SCREENS, which is not what a
          * seller buys — they buy a garment that arrives printed. And the chart underneath was
          * decoration shaped like data: twelve columns of no measurement, on a page whose own
          * stats section deliberately carries only numbers we can point at.
          *
          * So the object on this page is the product. It is uploaded in Settings › Site
          * content, from a render the Studio made and the browser cut out, which means the
          * garment on the homepage is one we actually print and changing it is an upload
          * rather than a deploy.
          *
          * With no picture the hero is TYPE and nothing else, which is the house style stated
          * plainly (§4: type does the work decoration usually does) and the one honest empty
          * state — the strip of real figures below follows immediately, so the fold is never
          * blank. A placeholder where a product should be would be worse than the space.
          */}
        {/* IN EDIT MODE AN EMPTY FIGURE STILL RENDERS, because otherwise there is nothing on
            the page to drop a picture onto — the one gesture this whole mode exists for would
            be the one gesture it cannot offer. A visitor still sees nothing. */}
        {(hero.image || editing) && (
          <div className="relative z-10 mx-auto max-w-6xl px-6">
            <EditableImage path="hero.image">
              <CutoutFigure
                src={hero.image}
                alt={hero.imageAlt}
                ghost={hero.ghostWord}
                callouts={hero.callouts}
              />
            </EditableImage>
          </div>
        )}
      </section>

      {/* ── The channel marquee ────────────────────────────────────────────────
          NO "WORKS WITH" label and no white band. The label named what the logos already
          say, and the white strip was a third colour wedged between the periwinkle plate and
          the paper page — the one thing breaking the run of colour down from the header. On
          paper with no borders, the hero's diagonal now lands straight into the page.

          The strip is masked to transparent at both ends rather than clipped by the section:
          a name sliced in half at the edge reads as broken layout, a name fading out reads as
          a band that carries on past the screen — which is what it is. */}
      {/* pt-36 — 144px — was clearance for the app mockup, which was absolutely positioned
          and hung well below the section above, so a short gap here put the channel names
          UNDER it. Nothing overhangs any more: the figure sits in the flow and the no-image
          hero is type. What was load-bearing became the single largest hole on the page. */}
      <section className="overflow-hidden pb-12 pt-10" style={{ background: SURFACE }}>
        <div
          className="relative flex overflow-hidden"
          style={{
            maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
            WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
          }}
        >
          {/* TWO IDENTICAL HALVES, and the animation travels exactly one of them (-50%), so
              the loop point lands on a frame identical to the start — that is what makes it
              seamless rather than snapping back.
              The half is padded out to at least ten names first: with only four channels the
              half was narrower than a wide screen, so the strip ran out and left a gap before
              it wrapped, which is the "cut off" you can see. */}
          <motion.div
            className="flex shrink-0 gap-12 pr-12"
            animate={reduce ? undefined : { x: ["0%", "-50%"] }}
            transition={{ duration: 28, ease: "linear", repeat: Infinity }}
          >
            {[...marqueeHalf, ...marqueeHalf].map((name, i) => (
              <span key={`${name}-${i}`} className="whitespace-nowrap text-2xl font-display font-semibold tracking-tight text-black/25">{name}</span>
            ))}
          </motion.div>
        </div>
      </section>

      {/*
        * ── THE STRIP OF FIGURES ──────────────────────────────────────────────────
        *
        * The stats, said the way a spec sheet says them: a value, what it measures, why it
        * matters, and a rule between each. No boxes — a number inside a card reads as a claim
        * somebody made, while a number in a band reads as a specification, which is the whole
        * reason the reference puts one directly under its hero.
        *
        * This briefly had its own `specs` field alongside `stats`, justified on the grounds
        * that the app panel used one and the strip used the other. The panel is gone, so that
        * justification is gone with it and there is one list again — the same figures the
        * Stats tab has always edited, now carrying a note.
        *
        * Skipped entirely when the list is empty, which is how an admin removes the section.
        */}
      {stats.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 pb-14 pt-4">
          <div className="border-t pt-10" style={{ borderColor: HAIRLINE }}>
            <SpecStrip items={stats} />
          </div>
        </section>
      )}

      {/* ── FEATURES ───────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
          {features.heading}
        </h2>
        <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-black/55">{features.subhead}</p>

        {/*
          * NUMBERED, AND ALTERNATING LIGHT AND DARK.
          *
          * Four identical bordered cards read as a list you skim and forget — and §4 has been
          * counting those: 490 outlined boxes across the app, which is what makes an outline
          * stop meaning anything. The reference checkers them instead, and the alternation is
          * doing real work: it gives the eye somewhere to rest and makes four things read as
          * four things.
          *
          * The hover-wipe accent went with the borders. It was motion that ran on a card that
          * does not do anything when you click it, which is a promise the card cannot keep.
          */}
        <NumberedCards items={features.cards} className="mt-14" />
      </section>

      {/* ── STEPS — numbers oversized, the way the style wants ──────────────────── */}
      <section className="bg-black/[0.03] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
            {steps.heading}
          </h2>
          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {steps.items.slice(0, 3).map((s, i) => (
              <motion.div
                key={s.title}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "0px 0px -12% 0px" }}
                transition={{ duration: 0.55, delay: i * 0.09, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="font-display font-semibold leading-none tracking-tighter text-black/[0.13]" style={{ fontSize: "clamp(3.5rem, 7vw, 5.5rem)" }}>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="mt-3 text-xl font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-black/55">{s.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ───────────────────────────────────────────────────────────
              Guarded on the list, not just mapped over it. An unattributable quote is a
              marketing claim a marketplace reviewer will read as invented, so the honest
              default is NO testimonials — and an unguarded section would then render a
              headline over an empty grid, which looks broken rather than empty. */}
      {testimonials.items.length > 0 && (
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
          {testimonials.heading}
        </h2>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {testimonials.items.slice(0, 3).map((t, i) => (
            <motion.figure
              key={t.name}
              className="rounded-2xl border border-black/[0.09] bg-white p-7"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "0px 0px -12% 0px" }}
              transition={{ duration: 0.55, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* The quote mark is set in the accent and oversized — the one piece of
                  ornament the style allows, because it's type doing it. */}
              <span aria-hidden className="block text-6xl font-display font-semibold leading-[0.6]" style={{ color: ACCENT }}>&ldquo;</span>
              <blockquote className="mt-3 text-[15px] leading-relaxed text-black/70">{t.quote}</blockquote>
              <figcaption className="mt-5 text-sm">
                <span className="font-bold">{t.name}</span>
                <span className="text-black/45"> · {t.role}</span>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </section>
      )}

      {/* ── FAQ — plain disclosure elements: keyboard and screen-reader behaviour for
              free, and no state to get wrong. ─────────────────────────────────────── */}
      <section className="bg-black/[0.03] py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
            {faq.heading}
          </h2>
          <div className="mt-12 divide-y divide-black/[0.09] border-y border-black/[0.09]">
            {faq.items.map((f, i) => (
              <details key={i} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-left text-lg font-bold tracking-tight [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden className="shrink-0 text-2xl font-display font-semibold transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-black/60">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────────── */}
      <section className="px-6 py-16">
        <motion.div
          className="mx-auto max-w-5xl overflow-hidden rounded-3xl px-8 py-14 text-center"
          style={{ background: ACCENT }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "0px 0px -10% 0px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* LIME on the violet, not ink. Measured 5.07:1, so it clears the 3:1 floor for
              large text with room to spare — this is real readable type, not a decorative
              ghost. The subhead stays paper so the band still has one clear hierarchy. */}
          <h2 className="mx-auto max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 5vw, 4rem)", color: ACID }}>
            {cta.heading}
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[17px] leading-relaxed" style={{ color: "rgba(250,248,243,0.75)" }}>{cta.subhead}</p>
          <div className="mt-9 flex justify-center">
            <Pill href="/signup" tone="ink">{cta.button}</Pill>
          </div>
        </motion.div>
      </section>
    </div>
  )
}
