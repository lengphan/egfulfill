"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion, useInView, useReducedMotion, useScroll, useSpring, useTransform, animate } from "motion/react"
import type { SiteContent } from "@/lib/site-content"
import { ACCENT, INK, SURFACE, ACID, HAIRLINE, MaskedWords, TypedPhrase, Pill } from "@/components/marketing/bold-kit"
import { LabelRule, CutoutFigure, SpecStrip, NumberedCards } from "@/components/marketing/bold-figure"

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


/** A number that counts to its value once, when it first arrives. Reads as the figure
 *  settling rather than a slot machine — no loop, no re-run on scroll-back. */
function CountUp({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  /**
   * A small FIXED bite, not a percentage of the viewport.
   *
   * This was -15%, which on a 1000px window puts the trigger line at 850 — and the hero's
   * three stat cards sit at y=867. Plainly on screen, 17px under the line, so they showed a
   * static figure and only ever counted if you happened to scroll. A percentage scales the
   * dead zone with the display, so the taller the monitor the more visible content silently
   * refuses to animate. 40px means "not clipped at the very edge" at every size.
   */
  const inView = useInView(ref, { once: true, margin: "0px 0px -40px 0px" })
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(value)

  /**
   * Split the numeric core from whatever wraps it ("2,400+", "$1.2M", "99.9%") so the
   * prefix/suffix survive — animating the whole string would print nonsense mid-flight.
   *
   * MEMOISED, and that is the whole bug fix. This used to be a bare `regex.exec()` in the
   * render body, which returns a NEW array every render, and that array was in the effect's
   * dependency list. So: animate → onUpdate → setShown → re-render → new array → effect
   * tears the animation down and restarts it from zero. It never got more than a frame in.
   * Measured before the fix: three counters never moved off their final value at all, and
   * the fourth emitted 48hrs, 4hrs, 5hrs, 0hrs, 9hrs, 8hrs — scrambled, never ascending.
   */
  const parts = useMemo(() => {
    const m = /^([^\d]*)([\d.,]+)(.*)$/.exec(value)
    if (!m) return null
    const target = Number(m[2].replace(/,/g, ""))
    if (!Number.isFinite(target)) return null
    const dp = (m[2].split(".")[1] ?? "").length
    return {
      pre: m[1], post: m[3], target, dp,
      /**
       * Decimals to show WHILE counting, which is not the same as the decimals in the
       * figure. "2hrs" counting 0 → 2 as integers is three distinct frames in 1.1s and
       * reads as static — the second half of what was reported here. Small whole numbers
       * borrow a decimal place in flight and land back on the integer, so the motion is
       * legible at any magnitude. Big figures already have plenty of digits moving.
       */
      flightDp: dp === 0 && target < 100 ? 1 : dp,
    }
  }, [value])

  useEffect(() => {
    if (!inView || reduce || !parts) return
    const { pre, post, target, dp, flightDp } = parts
    const fmt = (v: number, d: number) =>
      `${pre}${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}${post}`
    const controls = animate(0, target, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(fmt(v, flightDp)),
      // Land on the ORIGINAL string, not a re-formatted float — "2.4M+" must not arrive
      // as "2.40M+" because the flight precision happened to be higher.
      onComplete: () => setShown(value),
    })
    return () => controls.stop()
  }, [inView, reduce, parts, value])

  return <span ref={ref} className={className}>{parts ? shown : value}</span>
}

export function BoldHome({ content }: { content: SiteContent }) {
  const { hero, specs, stats, features, steps, testimonials, faq, cta } = content
  const reduce = useReducedMotion()
  const heroRef = useRef<HTMLDivElement>(null)

  // Scroll-linked parallax on the product panel. Spring-smoothed so it trails the scroll
  // slightly instead of tracking it rigidly — that lag is what reads as depth.
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] })
  const smooth = useSpring(scrollYProgress, { stiffness: 90, damping: 26, mass: 0.4 })
  const panelY = useTransform(smooth, [0, 1], [0, -70])
  const panelScale = useTransform(smooth, [0, 1], [1, 0.94])

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
        <div className={"mx-auto max-w-6xl px-6 pt-16 sm:pt-24 " + (hero.image ? "pb-10" : "pb-32")}>
          {/* The rule the reference boards open on: who we are at one end, who this is for at
              the other, a hairline between. It gives the page a top edge without a box, and
              it says the second thing a visitor needs before the headline says the first. */}
          <LabelRule left={hero.ruleLeft} right={hero.ruleRight} className="mb-14" />
          <h1 className="max-w-5xl text-center font-display font-semibold leading-[0.92] tracking-[-0.032em] mx-auto"
              // Ink on paper — 17.40:1. The headline is the page; the colour is one phrase.
              style={{ color: INK }}
              >
            <span style={{ fontSize: "clamp(2.6rem, 7.2vw, 6.2rem)" }}>
            <MaskedWords text={hero.headline} />{" "}
            {/* The one hot colour on the page, and now the ONLY place it appears at display
                size. Violet on paper is 5.33:1 — real type. Lime cannot be used here: on
                paper it is 1.05:1 and simply disappears. */}
            <TypedPhrase text={hero.accent} color={INK} lastWordColor={ACCENT} />
            </span>
          </h1>

          <motion.p
            className="mx-auto mt-7 max-w-xl text-center text-[17px] leading-relaxed text-[var(--mk-ink)]/62"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            {hero.subhead}
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
          * THE PRODUCT, WHEN THERE IS ONE — otherwise the app panel below.
          *
          * Every reference board is built on a subject cut out and floated on a soft ground,
          * and until now the only object on this page was a drawing of our own software. That
          * tells a seller what our admin screens look like and nothing at all about the thing
          * that arrives in their buyer's hands.
          *
          * The picture is not shipped with the code — it is uploaded in Settings › Site
          * content, from a render the Studio made and the browser cut out. So the page shows
          * a garment we actually print, chosen by the person who prints it, and replacing it
          * is an upload rather than a deploy.
          *
          * AND THE PANEL STAYS AS THE FALLBACK. An unset image must not read as a broken one
          * (§4), and the panel is a real, finished, animated section — deleting it to leave a
          * hole until someone gets round to uploading a PNG would ship a worse page today for
          * a better one later.
          */}
        {hero.image ? (
          <div className="relative z-10 mx-auto max-w-6xl px-6 pb-14">
            <CutoutFigure
              src={hero.image}
              alt={hero.imageAlt}
              ghost={hero.ghostWord}
              callouts={hero.callouts}
            />
          </div>
        ) : (
        <>
        {/* Floating product panel — the reference's strongest device: a real screen, held
            slightly off the page, with live figures peeled off it as chips. */}
        {/* TWO elements, not one. The entrance animates `y`, and the parallax drives `y` from
            a scroll MotionValue — one element can't own the same property twice, and when it
            tried, the panel never became visible at all. Outer does the arrival, inner does
            the scroll. */}
        <motion.div
          className="relative z-10 mx-auto -mb-24 max-w-4xl px-6"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            className="relative rounded-2xl border border-black/10 bg-white p-4 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.45)]"
            style={reduce ? undefined : { y: panelY, scale: panelScale }}
          >
            <div className="flex items-center gap-1.5 pb-3">
              {["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} className="size-2.5 rounded-full" style={{ background: c }} />)}
            </div>
            {/* The chart from the reference: columns that GROW from the baseline as the panel
                arrives, left to right. Height is the only thing animated (via scaleY off a
                bottom origin), which the compositor can do on the GPU — animating the actual
                height would relayout the panel on every frame. */}
            <div className="mb-3 rounded-xl border border-black/[0.07] bg-black/[0.03] p-4">
              <div className="flex items-end justify-between gap-1.5" style={{ height: 92 }}>
                {[38, 55, 30, 72, 48, 90, 64, 78, 44, 84, 58, 96].map((h, i) => (
                  <motion.span
                    key={i}
                    className="flex-1 rounded-t-[3px]"
                    style={{ background: i % 3 === 2 ? INK : ACCENT, transformOrigin: "bottom", height: `${h}%` }}
                    initial={reduce ? { opacity: 0 } : { scaleY: 0 }}
                    whileInView={reduce ? { opacity: 1 } : { scaleY: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.7 + i * 0.045, ease: [0.16, 1, 0.3, 1] }}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {stats.slice(0, 3).map((s, i) => (
                <motion.div
                  key={s.label}
                  className="rounded-xl border border-black/[0.07] bg-black/[0.03] p-4"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.65 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-black/45">{s.label}</div>
                  {/* font-TITLE, not font-display: this panel is a picture OF THE APP, and the
                      app's face is the sans. A serif figure here would advertise a product that
                      doesn't look like this. */}
                  <CountUp value={s.value} className="mt-1.5 block text-2xl font-title font-semibold tracking-tight" />
                </motion.div>
              ))}
            </div>

            {/* Figures peeled OFF the panel and floated beside it — the reference's clearest
                device. They drift in late and from opposite sides, so they read as lifted off
                the screen rather than drawn on it. Hidden below lg, where they'd overlap the
                panel they're meant to annotate. */}
            {stats[3] && (
              <motion.div
                className="absolute -left-24 top-1/3 hidden rounded-2xl border border-black/10 bg-white p-4 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.35)] lg:block"
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24, y: 10 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ duration: 0.7, delay: 1.05, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="text-[10px] font-semibold uppercase tracking-widest text-black/45">{stats[3].label}</div>
                {/* Peeled off the mockup, so it stays on the mockup's face — see above. */}
                <CountUp value={stats[3].value} className="mt-1 block text-xl font-title font-semibold tracking-tight" />
              </motion.div>
            )}
            {stats[0] && (
              <motion.div
                className="absolute -right-20 top-16 hidden rounded-full border border-black/10 bg-white px-4 py-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.35)] lg:block"
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: -24, y: -10 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ duration: 0.7, delay: 1.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className="text-sm font-bold tracking-tight">{stats[0].value}</span>
                <span className="ml-1.5 text-xs text-black/50">{stats[0].label}</span>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
        </>
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
      {/* The top padding is load-bearing, not taste: the hero's app mockup is absolutely
          positioned and hangs well below the plate's diagonal, so a short gap here puts the
          names UNDER it. This clears the overhang. */}
      <section className="overflow-hidden pb-14 pt-36" style={{ background: SURFACE }}>
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
        * ── THE SPEC STRIP ────────────────────────────────────────────────────────
        *
        * The same figures the app panel carries, said the way a spec sheet says them: a value,
        * what it measures, a rule between each, and no boxes. A number inside a card reads as
        * a claim somebody made; a number in a band reads as a specification — which is the
        * whole reason the reference puts one directly under its hero.
        *
        * Skipped entirely when the list is empty, which is how an admin removes the section.
        */}
      {specs.items.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 py-16">
          {specs.heading && (
            <h2 className="mb-10 max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
              {specs.heading}
            </h2>
          )}
          <div className="border-t pt-10" style={{ borderColor: HAIRLINE }}>
            <SpecStrip items={specs.items} />
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
