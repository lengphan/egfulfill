"use client"

import { motion, useReducedMotion } from "motion/react"
import type { SiteContent } from "@/lib/site-content"
import { ACCENT, ACCENT_INK, CARD, INK, SURFACE, ACID, HAIRLINE, EASE, MaskedWords, TypedPhrase, Pill } from "@/components/marketing/bold-kit"
import { Slide, CutoutFigure, SpecStrip, NumberedCards } from "@/components/marketing/bold-figure"
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
  // The scroll-linked parallax went with the panel it moved, and the ref that anchored it
  // went with the hero becoming a Slide — nothing in this page tracks scroll any more.

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

  /*
   * THE DECK.
   *
   * Every section of this page is now a PANEL on the ground rather than a band of page, which
   * is the structural half of the reference boards — the half that no amount of borrowed
   * ornament could supply. See the Slide comment in bold-figure.tsx.
   *
   * The list is built before the render because the position marker at the foot of each panel
   * counts against it: a section that is conditionally absent has to be absent from the count
   * too, or every marker after it points at a panel nobody can scroll to. Adding a section
   * means adding a name here, and every marker below it moves on its own.
   */
  const panels = [
    "hero",
    stats.length > 0 && "stats",
    "features",
    "steps",
    testimonials.items.length > 0 && "testimonials",
    "faq",
    "cta",
  ].filter(Boolean) as string[]
  const TOTAL = panels.length
  const at = (name: string) => panels.indexOf(name)
  /* The brand at one end, who this is for at the other — repeated at the top of every panel.
     The repetition IS the device: one rule is a flourish, seven is a deck. */
  const rule = { label: hero.ruleLeft, labelRight: hero.ruleRight }

  return (
    <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
      {/* The gap between panels is the ground showing through, so it is the only spacing that
          matters here — the panels own their internal padding. */}
      <div className="mx-auto max-w-6xl space-y-4 px-4 pb-16 pt-4 sm:px-6">

        {/* ── HERO ─────────────────────────────────────────────────────────────── */}
        <Slide {...rule} index={at("hero")} total={TOTAL}>
          {/*
            * LEFT, NOT CENTRED.
            *
            * Centred type on an unbounded page is the arrangement that had this hero reading
            * as a poster. Inside a panel the left edge is a real edge — the label rule starts
            * on it, the headline starts on it, the buttons start on it — and three things
            * sharing one edge is what makes a panel read as composed rather than as content
            * that happened to be placed in the middle.
            */}
          <div className="max-w-4xl pt-12 sm:pt-16">
            <h1 className="font-display font-semibold leading-[0.92] tracking-[-0.032em]"
                style={{ color: INK }}>
              <span style={{ fontSize: "clamp(2.6rem, 7.2vw, 6.2rem)" }}>
                {editing
                  ? <EditableText path="hero.headline">{hero.headline}</EditableText>
                  : <MaskedWords text={hero.headline} />}{" "}
                {/* The accent phrase. On `signal` there is no hot colour to reach for — the
                    palette is monochrome by design — so the phrase is set in the accent, which
                    is the ink itself, and the TYPING is what marks it. On `studio` and `press`
                    the same call still resolves to their accent. */}
                {editing
                  ? <EditableText path="hero.accent">{hero.accent}</EditableText>
                  : <TypedPhrase text={hero.accent} color={INK} lastWordColor={ACCENT} />}
              </span>
            </h1>

            <motion.p
              className="mt-7 max-w-xl text-[17px] leading-relaxed text-[var(--mk-ink)]/62"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
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
              {/* Filled, then outlined with the ring — the board's own pair. Two buttons of
                  identical shape read as one control repeated; the ring is what separates
                  "the thing to do" from "the thing to read first". */}
              <Pill href="/signup" tone="accent">{hero.ctaPrimary}</Pill>
              <Pill href="/how-it-works" tone="ghost" ring>{hero.ctaSecondary}</Pill>
            </motion.div>
          </div>

          {/*
            * THE PRODUCT — and nothing at all when there isn't one.
            *
            * The floating app panel is long gone; the object on this page is the garment,
            * uploaded in Settings › Site content from a render the Studio made and the browser
            * cut out. With no picture the panel is TYPE and nothing else, which is the house
            * style stated plainly and the one honest empty state.
            *
            * IN EDIT MODE AN EMPTY FIGURE STILL RENDERS, because otherwise there is nothing on
            * the page to drop a picture onto. A visitor still sees nothing.
            */}
          {(hero.image || editing) && (
            <div className="relative z-10 mt-14">
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
        </Slide>

        {/* ── THE CHANNEL MARQUEE — on the ground, between two panels ─────────────
            NOT a panel, and deliberately. It is the one thing on the page that runs past both
            edges, so putting it in a rounded box would stop it doing the only thing it does.
            On the ground between two slides it reads as the seam between them.

            Masked to transparent at both ends rather than clipped: a name sliced in half reads
            as broken layout, a name fading out reads as a band that carries on past the
            screen — which is what it is. */}
        <div
          className="relative flex overflow-hidden py-6"
          style={{
            maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
            WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
          }}
        >
          {/* TWO IDENTICAL HALVES, and the animation travels exactly one of them (-50%), so
              the loop point lands on a frame identical to the start — that is what makes it
              seamless rather than snapping back. The half is padded out to at least ten names
              first: with only four channels the half was narrower than a wide screen, so the
              strip ran out and left a gap before it wrapped. */}
          <motion.div
            className="flex shrink-0 gap-12 pr-12"
            animate={reduce ? undefined : { x: ["0%", "-50%"] }}
            transition={{ duration: 28, ease: "linear", repeat: Infinity }}
          >
            {[...marqueeHalf, ...marqueeHalf].map((name, i) => (
              <span key={`${name}-${i}`} className="whitespace-nowrap text-2xl font-display font-semibold tracking-tight" style={{ color: INK, opacity: 0.22 }}>{name}</span>
            ))}
          </motion.div>
        </div>

        {/*
          * ── THE STRIP OF FIGURES ────────────────────────────────────────────────
          *
          * The stats, said the way a spec sheet says them: a value, what it measures, why it
          * matters, and a rule between each.
          *
          * INSIDE ONE OUTLINED BOX, which is the board's results slide exactly — the figures
          * are divided from each other but enclosed together, so they read as one measurement
          * of one thing rather than as five unrelated claims. That is also why they are not
          * five separate cards: a number inside its own card reads as something somebody
          * asserted, a number in a divided band reads as a specification.
          *
          * Skipped entirely when the list is empty, which is how an admin removes the section.
          */}
        {stats.length > 0 && (
          <Slide {...rule} index={at("stats")} total={TOTAL}>
            <div className="mt-10 rounded-[22px] border p-8 sm:p-10" style={{ borderColor: HAIRLINE }}>
              <SpecStrip items={stats} />
            </div>
          </Slide>
        )}

        {/* ── FEATURES ───────────────────────────────────────────────────────────── */}
        <Slide {...rule} index={at("features")} total={TOTAL}>
          <div className="pt-10">
            <h2 className="max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
              {features.heading}
            </h2>
            <p className="mt-4 max-w-xl text-[17px] leading-relaxed" style={{ color: INK, opacity: 0.55 }}>{features.subhead}</p>

            {/*
              * NUMBERED, ALTERNATING LIGHT AND DARK, ONE CORNER CUT.
              *
              * Four identical bordered cards read as a list you skim and forget — and §4 has
              * been counting those: 490 outlined boxes across the app, which is what makes an
              * outline stop meaning anything. The board checkers them instead, and the
              * alternation does real work: it gives the eye somewhere to rest and makes four
              * things read as four things.
              */}
            <NumberedCards items={features.cards} className="mt-12" />
          </div>
        </Slide>

        {/* ── STEPS — numbers oversized, the way the style wants ──────────────────── */}
        <Slide {...rule} index={at("steps")} total={TOTAL}>
          <div className="pt-10">
            <h2 className="font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
              {steps.heading}
            </h2>
            <div className="mt-12 grid gap-10 md:grid-cols-3">
              {steps.items.slice(0, 3).map((s, i) => (
                <motion.div
                  key={s.title}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "0px 0px -12% 0px" }}
                  transition={{ duration: 0.55, delay: i * 0.09, ease: EASE }}
                >
                  <div className="font-display font-semibold leading-none tracking-tighter" style={{ fontSize: "clamp(3.5rem, 7vw, 5.5rem)", color: INK, opacity: 0.14 }}>
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <h3 className="mt-3 text-xl font-bold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed" style={{ color: INK, opacity: 0.55 }}>{s.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </Slide>

        {/* ── TESTIMONIALS ─────────────────────────────────────────────────────────
                Guarded on the list, not just mapped over it. An unattributable quote is a
                marketing claim a marketplace reviewer will read as invented, so the honest
                default is NO testimonials — and an unguarded section would then render a
                headline over an empty grid, which looks broken rather than empty. */}
        {testimonials.items.length > 0 && (
          <Slide {...rule} index={at("testimonials")} total={TOTAL}>
            <div className="pt-10">
              <h2 className="max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
                {testimonials.heading}
              </h2>
              <div className="mt-12 grid gap-4 md:grid-cols-3">
                {testimonials.items.slice(0, 3).map((t, i) => (
                  <motion.figure
                    key={t.name}
                    /* Same cut corner as the numbered cards, and the same lift off the panel —
                       one card shape on the page, not two. */
                    className="rounded-[22px] rounded-tr-[4px] p-7"
                    style={{ background: `color-mix(in oklch, ${CARD} 55%, white)`, border: `1px solid ${HAIRLINE}` }}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "0px 0px -12% 0px" }}
                    transition={{ duration: 0.55, delay: i * 0.08, ease: EASE }}
                  >
                    {/* The quote mark is oversized — the one piece of ornament the style
                        allows, because it's type doing it. */}
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
          </Slide>
        )}

        {/* ── FAQ — plain disclosure elements: keyboard and screen-reader behaviour for
                free, and no state to get wrong. ─────────────────────────────────────── */}
        <Slide {...rule} index={at("faq")} total={TOTAL}>
          <div className="mx-auto max-w-3xl pt-10">
            <h2 className="font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
              {faq.heading}
            </h2>
            <div className="mt-10 border-y" style={{ borderColor: HAIRLINE }}>
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
        </Slide>

        {/* ── CTA — the one dark panel, so the deck closes on a block ─────────────── */}
        <Slide {...rule} index={at("cta")} total={TOTAL} tone="ink">
          <div className="px-2 py-14 text-center sm:px-6">
            {/* ACID on the accent — 12.35:1 on `signal`, 16.66 on `studio`, 5.07 on `press`.
                Measured on every skin by tools/check-skins.mjs, which is the only reason this
                line can be written at all. */}
            <h2 className="mx-auto max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 5vw, 4rem)", color: ACID }}>
              {cta.heading}
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-[17px] leading-relaxed" style={{ color: ACCENT_INK, opacity: 0.72 }}>{cta.subhead}</p>
            <div className="mt-9 flex justify-center">
              <Pill href="/signup" tone="acid" ring>{cta.button}</Pill>
            </div>
          </div>
        </Slide>
      </div>
    </div>
  )
}
