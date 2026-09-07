"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { motion, useMotionValueEvent, useReducedMotion, useTransform } from "motion/react"
import type { SiteContent } from "@/lib/site-content"
import {
  ClipReveal, CountUp, Display, Enter, Eyebrow, Figure, GRADE, GRADE_DARK,
  Marquee, ParallaxFigure, Stretch, useTrackProgress,
} from "@/components/marketing/brand/kit"
import { BrandNav, BrandFooter } from "@/components/marketing/brand/chrome"
import { HEROES, DEFAULT_HERO, type HeroKey } from "@/components/marketing/brand/heroes"

/**
 * ══ STYLE A · PRESS ═══════════════════════════════════════════════════════════════════
 *
 * The factory floor as the brand. Deep slate is the dominant ground, bone is the relief,
 * and violet is the one thing that shouts. Type is set CONDENSED and enormous and stamped
 * directly onto production photography — no scrim, no card, no frame.
 *
 * THE RHYTHM IS AN INVERSION, not a divider. With no shadows anywhere, a change of ground
 * is the only way one section separates from the next; a rule between two identical grounds
 * divides nothing. So the page alternates slate → bone → slate → violet → slate, and every
 * band gets a different composition on purpose.
 *
 * COLOUR RULES, and they are contrast measurements rather than taste:
 *   · violet #614EFA carries WHITE (5.28:1). It must never carry ink — 3.73:1 fails.
 *   · periwinkle #C0C4FF carries INK (11.79:1). It must never carry white — 1.67:1.
 * Two accents with opposite foreground rules is what stops them being used interchangeably.
 */

const INK = "#101318"      // deep slate — the dominant ground
const PAPER = "#F5F4F1"    // bone — the relief
const VIOLET = "#614EFA"   // the pop. carries white.
const PERI = "#C0C4FF"     // the light plate. carries ink.

/** The statement marquee. Short, declarative, no punctuation — it is a band, not a sentence. */
const CREED = ["PRINTED IN OUR OWN FACTORY", "SEVEN DECORATION METHODS", "NO MONTHLY FEE", "TRACKING PUSHED BACK", "ONE QUEUE FOR EVERY STORE"]

const METHODS = ["EMBROIDERY", "DTG", "DTF", "SUBLIMATION", "APPLIQUÉ", "SCREEN", "LASER"]

/**
 * THE TWELVE COLOURWAYS — and the reason this works is an accident of how they were shot.
 *
 * Every one of these frames is the SAME garment, on the same hanger, in the same light, at
 * 574×820. So cross-fading between them does not read as twelve photographs cycling; it
 * reads as ONE garment changing colour. That is a thing a rail of thumbnails can never say,
 * and it costs no new photography.
 */
const TEE = [
  ["natural", "Natural"], ["sand", "Sand"], ["ash", "Ash"], ["sport-grey", "Sport grey"],
  ["charcoal", "Charcoal"], ["black", "Black"], ["navy", "Navy"], ["royal", "Royal"],
  ["forest", "Forest"], ["maroon", "Maroon"], ["gold", "Gold"], ["light-pink", "Light pink"],
] as const

/** 03 — the three beats of the production story, told against one held photograph. */
const PROCESS = [
  { n: "01", t: "It arrives", b: "An order lands from Etsy, Shopify or TikTok Shop and joins one queue. Nobody exports a CSV. Nobody retypes an address." },
  { n: "02", t: "It is made", b: "Artwork is checked by a person before anything reaches a press. Then it is embroidered, printed or pressed on our own machines." },
  { n: "03", t: "It leaves", b: "Folded, bagged, labelled and scanned out — and the tracking number is pushed back to the storefront it came from." },
]

const AUDIENCES = [
  {
    k: "Brands",
    b: "Drop a collection without a warehouse, a minimum, or a pallet of stock you have to sell through.",
    note: "No stock held · no minimum",
    img: "/brand/who-brands.jpg",
    alt: "A dense rail of identical plain garments hanging in a dark studio",
  },
  {
    k: "Teams",
    b: "Kit out a company without a procurement project. One artwork, every size, shipped to individual addresses.",
    note: "One artwork · every size",
    img: "/brand/who-teams.jpg",
    alt: "Many folded garments arranged in an ordered grid on a dark steel surface",
  },
  {
    k: "Creators",
    b: "Sell the thing your audience already asks you for. You design it, we make it, nobody touches a box.",
    note: "You design · we make",
    img: "/brand/who-creators.jpg",
    alt: "Two hands holding up a finished plain garment by the shoulders in a dark room",
  },
]

export function HomePress({ content, hero: heroKey = DEFAULT_HERO }: { content: SiteContent; hero?: HeroKey }) {
  const heroShot = HEROES[heroKey] ?? HEROES[DEFAULT_HERO]
  const { hero, features, steps, stats, cta } = content
  const reduce = useReducedMotion()
  const track = useRef<HTMLDivElement>(null)
  const progress = useTrackProgress(track)
  /* The held photograph drifts a little as its captions pass. Small — a big move here reads
     as a broken layer rather than as depth. */
  const railY = useTransform(progress, [0, 1], ["0%", "-6%"])

  /* ── 05 · the colourway reveal ──────────────────────────────────────────────────
     The section is taller than the viewport and holds a sticky frame; scroll position
     picks which of the twelve is showing. Rounding rather than flooring means each colour
     owns an equal slice with the change landing at its centre, so the first and last get
     a full share instead of half of one. */
  const swatch = useRef<HTMLDivElement>(null)
  const swatchProgress = useTrackProgress(swatch)
  const [tee, setTee] = useState(0)
  useMotionValueEvent(swatchProgress, "change", (v) => {
    const i = Math.round(v * (TEE.length - 1))
    setTee(Math.min(TEE.length - 1, Math.max(0, i)))
  })

  /* ── 06 · who it is for ─────────────────────────────────────────────────────────
     Auto-advances until the first interaction and then stops for good. A panel that keeps
     moving after someone has chosen a row is arguing with them. */
  const [who, setWho] = useState(0)
  const [touched, setTouched] = useState(false)
  const pick = useCallback((i: number) => { setWho(i); setTouched(true) }, [])
  useEffect(() => {
    if (touched || reduce) return
    const t = setInterval(() => setWho((i) => (i + 1) % AUDIENCES.length), 4500)
    return () => clearInterval(t)
  }, [touched, reduce])

  return (
    <div style={{ background: INK, color: PAPER }}>
      <BrandNav tone="dark" ink={PAPER} accent={VIOLET} overlay />

      {/* ══ 00 · HERO ═════════════════════════════════════════════════════════════════
          Full-bleed machine head, type stamped straight onto it. No scrim: the photograph
          was graded dark on purpose so bone type sits on it at range, and a veil over an
          already-dark frame only turns it to mud.

          THE HEADLINE OPENS FROM CONDENSED. That gesture is the brand mark — a width axis
          animating is something a static typeface physically cannot do — and it happens
          exactly once on the page. */}
      <section className="relative min-h-[92svh] overflow-hidden">
        <div className="absolute inset-0">
          {/* THE GARMENT, NOT THE MACHINE. The first frame was a machine head — accurate,
              and quiet enough that the hero read as atmosphere rather than as a statement.
              This is the thing we actually sell, caught mid-air with a violet rim light, and
              the light IS the palette rather than a filter laid over it.

              The grade is lighter than the other dark frames: this photograph is already
              near-black, and GRADE_DARK on top of it crushed the cloth into the ground. */}
          <ParallaxFigure
            src={heroShot.src}
            alt={heroShot.alt}
            ratio="auto"
            distance={44}
            grade="saturate(0.9) contrast(1.08)"
            drift
            priority
            sizes="100vw"
            className="!aspect-auto h-full w-full"
          />
          {/* TWO GRADIENTS, NOT A SCRIM. A veil over the whole frame kills the photograph;
              these darken only the two strips that carry lettering and leave the middle — the
              part with the garment in it — completely untouched.

              The top one exists because the navigation is bone and this frame is bright
              exactly where "How it works" falls. A nav you cannot read is not a stylistic
              choice, and moving the crop only moves the problem to a different link. */}
          <div className="absolute inset-x-0 top-0 h-[22%]"
            style={{ background: `linear-gradient(to bottom, ${INK}D9, ${INK}73 46%, transparent)` }} />
          <div className="absolute inset-x-0 bottom-0 h-[72%]"
            style={{ background: `linear-gradient(to top, ${INK} 5%, ${INK}CC 30%, ${INK}5E 52%, transparent)` }} />
        </div>

        <div className="relative flex min-h-[92svh] flex-col justify-end px-6 pb-14 pt-32 sm:px-10">
          <div className="mx-auto w-full max-w-[92rem]">
            {/* ON A CHIP, not floating. The eyebrow crosses the brightest part of the cloth,
                and a 11px letterform is the first thing that stops being readable there. A
                violet plate carrying white measures 5.28:1 on any photograph underneath it —
                so it is readable by construction rather than by luck, and it puts the accent
                in the first screen where it was otherwise absent. */}
            <Enter from="none">
              <Eyebrow className="px-3 py-1.5" style={{ background: VIOLET, color: "#FFFFFF" }}>
                Print on demand, fulfilled in house
              </Eyebrow>
            </Enter>

            {/* SIZED TO THE FOLD, not to the widest number that still fitted the words.
                At 12.5vw the headline filled the screen on its own and pushed the subhead and
                both actions off the bottom — a hero whose call to action is below the fold is
                not a hero. The measure is capped in ch as well as vw so the line breaks are
                the same shape at every width. */}
            <Stretch
              size="clamp(2.5rem, 7.6vw, 7.4rem)"
              from={64}
              to={101}
              weight={700}
              leading={0.86}
              className="mt-6 max-w-[15ch] uppercase"
              style={{ color: PAPER }}
            >
              Make merch that feels like a brand.
            </Stretch>

            <div className="mt-10 flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
              <motion.p
                className="max-w-[38ch] text-[17px] leading-relaxed"
                style={{ color: PAPER, opacity: 0.72 }}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
                animate={{ opacity: 0.72, y: 0 }}
                transition={{ duration: 0.7, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
              >
                {hero.subhead}
              </motion.p>

              <motion.div
                className="flex items-center gap-8"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.68, ease: [0.16, 1, 0.3, 1] }}
              >
                <Link
                  href="/signup"
                  className="group inline-flex items-center gap-3 whitespace-nowrap px-8 py-4 text-[15px] font-medium transition-transform duration-300 hover:-translate-y-0.5"
                  style={{ background: VIOLET, color: "#FFFFFF" }}
                >
                  {hero.ctaPrimary}
                  <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                </Link>
                <Link href="/how-it-works" className="text-[15px] underline decoration-1 underline-offset-[6px] transition-opacity hover:opacity-60" style={{ color: PAPER }}>
                  {hero.ctaSecondary}
                </Link>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ THE CREED — a band of statements travelling, on the violet ════════════════
          The one place the accent runs edge to edge. White on violet measures 5.28:1, so it
          can carry real lettering; ink on it cannot, which is why nothing here is dark. */}
      <div style={{ background: VIOLET, color: "#FFFFFF" }}>
        <Marquee
          items={CREED}
          speed={42}
          className="py-4 text-[13px] uppercase"
          style={{ fontFamily: "var(--font-archivo)", fontVariationSettings: '"wdth" 112', letterSpacing: "0.16em", fontWeight: 500 }}
        />
      </div>

      {/* ══ 01 · BRAND STATEMENT ══════════════════════════════════════════════════════
          Bone, and almost empty. The statement is set at the page's largest size and given
          nothing to compete with — the quiet band exists so the loud ones read as loud. */}
      <section className="px-6 py-[clamp(6rem,15vw,13rem)] sm:px-10" style={{ background: PAPER, color: INK }}>
        <div className="mx-auto grid max-w-[92rem] gap-y-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-x-20">
          <ClipReveal
            as="h2"
            lines={["Anyone can print", "a logo on a shirt.", "Almost nobody", "makes it feel made."]}
            size="clamp(2.4rem, 6.2vw, 6.2rem)"
            width={82}
            weight={600}
            leading={0.92}
            tracking="-0.045em"
          />
          <div className="lg:pt-4">
            <Eyebrow style={{ color: VIOLET }}>01 — What we believe</Eyebrow>
            <p className="mt-6 text-[17px] leading-relaxed" style={{ opacity: 0.68 }}>
              The garment is the product, not the print file. So we buy blanks by hand, keep the
              machines in our own building, and put a person in front of the artwork before it
              reaches a press.
            </p>
            <p className="mt-4 text-[17px] leading-relaxed" style={{ opacity: 0.68 }}>
              It costs us more. It is the entire difference between merch and a brand.
            </p>
          </div>
        </div>
      </section>

      {/* ══ 02 · WHAT WE MAKE ═════════════════════════════════════════════════════════
          Split screen, hard edge down the middle, picture bleeding off the left. The methods
          run underneath as a second marquee travelling the OTHER way — two bands moving in
          opposite directions is what stops a page reading as one conveyor. */}
      <section className="overflow-hidden" style={{ background: PAPER, color: INK }}>
        <div className="grid items-stretch lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)]">
          <Figure
            src="/brand/press-hands.jpg"
            alt="Two hands folding a bone-coloured cotton garment on a steel table beside a blank label"
            ratio="4 / 5"
            sizes="(max-width: 1024px) 100vw, 46vw"
            className="h-full w-full"
          />
          <div className="flex flex-col justify-center px-6 py-16 sm:px-12 lg:py-24">
            <Eyebrow style={{ color: VIOLET }}>02 — What we make</Eyebrow>
            <ClipReveal
              as="h2"
              lines={["Garments first.", "Decoration second."]}
              size="clamp(2rem, 4.4vw, 3.9rem)"
              width={88}
              weight={600}
              leading={0.96}
              className="mt-7"
            />
            <p className="mt-7 max-w-[46ch] text-[17px] leading-relaxed" style={{ opacity: 0.68 }}>
              Heavyweight cotton, garment-dyed fleece, structured caps. Blanks chosen because they
              hang correctly after ten washes, not because they were the cheapest line on a
              distributor sheet.
            </p>
            <div className="mt-12 grid max-w-lg grid-cols-2 gap-y-8">
              {[["Blanks in stock", "40+"], ["Decoration methods", "7"], ["Colourways", "12"], ["Artwork check", "Every order"]].map(([k, v], i) => (
                <Enter key={k} from={i % 2 ? "right" : "left"} delay={i * 0.06}>
                  <Display size="clamp(1.6rem, 3vw, 2.4rem)" width={92} weight={600} leading={1}>{v}</Display>
                  <span className="mt-2 block text-[13px]" style={{ opacity: 0.55 }}>{k}</span>
                </Enter>
              ))}
            </div>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${INK}22`, borderBottom: `1px solid ${INK}22` }}>
          <Marquee
            items={METHODS}
            speed={30}
            reverse
            separator="·"
            className="py-6"
            style={{
              fontFamily: "var(--font-archivo)", fontVariationSettings: '"wdth" 74',
              fontWeight: 600, fontSize: "clamp(2rem, 5vw, 4.4rem)", letterSpacing: "-0.03em",
              color: INK, opacity: 0.16,
            }}
          />
        </div>
      </section>

      {/* ══ 03 · THE PRODUCTION EXPERIENCE ════════════════════════════════════════════
          A held photograph with the three beats scrolling past it. STICKY, NOT PINNED — the
          page never takes the wheel, so you can leave at any point. That is the whole
          difference between storytelling and being held hostage. */}
      <section ref={track} className="relative" style={{ background: INK }}>
        <div className="grid lg:grid-cols-2">
          <div className="relative hidden lg:block">
            <div className="sticky top-0 h-svh overflow-hidden">
              <motion.div className="h-[112%] w-full" style={reduce ? undefined : { y: railY }}>
                <Figure
                  src="/brand/press-rail.jpg"
                  alt="A long rail of plain garments in a dim production hall"
                  ratio="auto"
                  grade={GRADE_DARK}
                  sizes="50vw"
                  className="!aspect-auto h-full w-full"
                />
              </motion.div>
              <div className="absolute inset-x-0 bottom-0 h-40" style={{ background: `linear-gradient(to top, ${INK}, transparent)` }} />
            </div>
          </div>

          <div className="px-6 sm:px-10 lg:px-16">
            <div className="pt-16 lg:pt-[26vh]">
              <Eyebrow style={{ color: PERI }}>03 — Inside the building</Eyebrow>
              <ClipReveal
                as="h2"
                lines={["Every order", "is handled."]}
                size="clamp(2.2rem, 4.6vw, 4.2rem)"
                width={84}
                weight={600}
                leading={0.94}
                className="mt-6"
                style={{ color: PAPER }}
              />
            </div>

            {/* The mobile picture, once, rather than three sticky viewports nobody asked for. */}
            <div className="mt-10 lg:hidden">
              <Figure src="/brand/press-rail.jpg" alt="A long rail of plain garments in a dim production hall"
                ratio="3 / 2" grade={GRADE_DARK} sizes="100vw" />
            </div>

            {PROCESS.map((p, i) => (
              <Enter key={p.n} from="up" delay={0.04} className="border-t py-14 lg:py-[16vh]"
                style={{ borderColor: `${PAPER}1F` }}>
                <div className="flex items-baseline gap-6">
                  <Display size="clamp(2.4rem,5vw,4rem)" width={70} weight={700} leading={1} style={{ color: VIOLET }}>
                    {p.n}
                  </Display>
                  <Display as="h3" size="clamp(1.4rem,2.4vw,2rem)" width={96} weight={600} leading={1.05} style={{ color: PAPER }}>
                    {p.t}
                  </Display>
                </div>
                <p className="mt-5 max-w-[46ch] text-[16px] leading-relaxed" style={{ color: PAPER, opacity: 0.62 }}>
                  {p.b}
                </p>
                {i === 2 && (
                  <p className="mt-6 text-[13px]" style={{ color: PERI }}>
                    {steps.items[2]?.body ?? ""}
                  </p>
                )}
              </Enter>
            ))}
            <div className="h-16 lg:h-[18vh]" />
          </div>
        </div>
      </section>

      {/* ══ 04 · WHY IT IS DIFFERENT ══════════════════════════════════════════════════
          The violet band, and the loudest thing on the page. No cards — three statements
          separated by a rule, because the argument is the sentence and a box around it adds
          nothing but chrome. */}
      <section className="px-6 py-[clamp(5rem,12vw,10rem)] sm:px-10" style={{ background: VIOLET, color: "#FFFFFF" }}>
        <div className="mx-auto max-w-[92rem]">
          <Eyebrow style={{ color: "#FFFFFF", opacity: 0.7 }}>04 — Why it is different</Eyebrow>
          <ClipReveal
            as="h2"
            lines={["We are the factory,", "not the middle of one."]}
            size="clamp(2.2rem, 5.6vw, 5.4rem)"
            width={80}
            weight={600}
            leading={0.94}
            className="mt-8 max-w-[18ch]"
          />
          <div className="mt-16 grid gap-x-14 gap-y-12 md:grid-cols-3">
            {(features.cards.slice(0, 3)).map((c, i) => (
              <Enter key={c.title} from="up" delay={i * 0.08} className="border-t pt-7" style={{ borderColor: "#FFFFFF55" }}>
                <Display as="h3" size="clamp(1.15rem,1.6vw,1.4rem)" width={104} weight={600} leading={1.15}>
                  {c.title}
                </Display>
                <p className="mt-4 text-[15px] leading-relaxed" style={{ opacity: 0.82 }}>{c.body}</p>
              </Enter>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 05 · THE COLOURWAY ════════════════════════════════════════════════════════
          One garment, twelve colours, changed by the scroll. It replaces a horizontal rail
          of thumbnails, and the difference is the whole point: a rail says "we have twelve
          products", this says "this product comes in twelve colours" — which is the true
          statement and the more useful one.

          The frame is STICKY, never pinned. The page keeps moving at its normal rate; all
          that is bound to scroll position is which of twelve already-loaded frames is
          opaque. You can leave mid-colour and nothing snaps. */}
      <section ref={swatch} className="relative" style={{ height: "300svh", background: PAPER, color: INK }}>
        {/* ONE BLOCK, CENTRED AS A WHOLE. The first build put the heading top-left, the
            colour name mid-left, the index mid-right and the garment in the middle — four
            things on four different vertical positions, which reads as scattered rather than
            composed. Everything now sits in one three-column row and centres together. */}
        <div className="sticky top-0 flex h-svh items-center overflow-hidden px-6 sm:px-10">
          <div className="mx-auto grid w-full max-w-[92rem] items-center gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,21rem)_minmax(0,26rem)_minmax(0,1fr)]">
              <div className="order-2 lg:order-1">
                <Eyebrow style={{ color: VIOLET }}>05 — The blanks</Eyebrow>
                <Display as="h2" size="clamp(1.5rem,2.6vw,2.1rem)" width={92} weight={600} leading={1.02} className="mt-4">
                  Twelve colourways.<br />One standard.
                </Display>
                <div className="mt-10 flex items-baseline gap-4">
                  <Display size="clamp(2.2rem,4.6vw,3.8rem)" width={74} weight={700} leading={0.94}>
                    {TEE[tee][1]}
                  </Display>
                </div>
                <div className="mt-4 flex items-baseline gap-3 text-[13px]" style={{ opacity: 0.55 }}>
                  <span className="tabular-nums">{String(tee + 1).padStart(2, "0")} / {TEE.length}</span>
                  <span>Heavy cotton tee · 240gsm · garment-dyed</span>
                </div>
                {/* The progress rule doubles as the scrub position. */}
                <div className="mt-5 h-px w-full" style={{ background: `${INK}22` }}>
                  <div className="h-px transition-[width] duration-[260ms] ease-out"
                    style={{ width: `${((tee + 1) / TEE.length) * 100}%`, background: VIOLET }} />
                </div>
              </div>

              {/* THE GARMENT. All twelve are mounted and only opacity changes, so the swap
                  is a colour dissolve rather than a layout move — nothing reflows, nothing
                  pops, and no frame is ever fetched mid-scroll. */}
              <div className="relative order-1 mx-auto w-full lg:order-2" style={{ aspectRatio: "574 / 820", maxHeight: "64svh" }}>
                {TEE.map(([slug, name], i) => (
                  <Image
                    key={slug}
                    src={`/frames/rail-tee-${slug}.webp`}
                    alt={i === tee ? `Heavy cotton tee in ${name}` : ""}
                    fill
                    sizes="(max-width: 1024px) 70vw, 26rem"
                    priority={i === 0}
                    className="object-contain transition-opacity duration-[260ms] ease-out"
                    style={{ opacity: i === tee ? 1 : 0, filter: GRADE }}
                  />
                ))}
              </div>

              {/* The index. Every colour is listed, so the section states its own length
                  instead of making you scroll to find out how many there are. */}
              <div className="order-3 hidden lg:block">
                <ul>
                {TEE.map(([slug, name], i) => (
                  <li key={slug} className="flex items-center gap-4 py-[0.42rem]">
                    <span className="h-px transition-all duration-[260ms] ease-out"
                      style={{ width: i === tee ? 34 : 14, background: i === tee ? VIOLET : `${INK}33` }} />
                    <span
                      className="text-[13px] transition-opacity duration-[260ms]"
                      style={{
                        fontFamily: "var(--font-archivo)",
                        fontVariationSettings: `"wdth" ${i === tee ? 112 : 96}`,
                        fontWeight: i === tee ? 600 : 400,
                        opacity: i === tee ? 1 : 0.4,
                      }}
                    >
                      {name}
                    </span>
                  </li>
                ))}
                </ul>
                <Link href="/catalog"
                  className="mt-8 inline-block text-[15px] underline decoration-1 underline-offset-[6px] transition-opacity hover:opacity-60">
                  See the full catalogue
                </Link>
              </div>
          </div>
        </div>
      </section>

      {/* ══ 06 · WHO IT IS FOR ════════════════════════════════════════════════════════
          Was three columns dropped down the page in a stagger, which left two holes and
          made the reading order ambiguous — three headings on three different baselines is
          a diagonal the eye has to solve before it can read anything.

          Now it is a picture and a set of rows: one image panel that changes, three rows
          that select it. It advances on its own until you touch it, so it is alive on
          arrival and obedient afterwards — and because selection is a CLICK as well as a
          hover, it works on a phone, where the previous hover-only ideas were simply dead. */}
      <section className="px-6 py-[clamp(5rem,12vw,10rem)] sm:px-10" style={{ background: INK, color: PAPER }}>
        <div className="mx-auto max-w-[92rem]">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <Eyebrow style={{ color: PERI }}>06 — Who it is for</Eyebrow>
            <span className="text-[13px] tabular-nums" style={{ opacity: 0.4 }}>
              {String(who + 1).padStart(2, "0")} / {String(AUDIENCES.length).padStart(2, "0")}
            </span>
          </div>

          <div className="mt-12 grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,29rem)_minmax(0,1fr)]">
            <div className="relative w-full overflow-hidden" style={{ aspectRatio: "3 / 4" }}>
              {AUDIENCES.map((a, i) => (
                <Image
                  key={a.k}
                  src={a.img}
                  alt={i === who ? a.alt : ""}
                  fill
                  sizes="(max-width: 1024px) 100vw, 29rem"
                  className="object-cover transition-opacity duration-[600ms] ease-out"
                  style={{ opacity: i === who ? 1 : 0, filter: GRADE_DARK }}
                />
              ))}
              <span className="absolute bottom-0 left-0 px-3 py-2 text-[11px] uppercase tracking-[0.14em]"
                style={{ background: VIOLET, color: "#FFFFFF" }}>
                {AUDIENCES[who].note}
              </span>
            </div>

            <ul className="flex flex-col justify-center">
              {AUDIENCES.map((a, i) => {
                const on = i === who
                return (
                  <li key={a.k} style={{ borderTop: `1px solid ${on ? PERI : `${PAPER}26`}` }}>
                    <button
                      type="button"
                      onClick={() => pick(i)}
                      onMouseEnter={() => pick(i)}
                      onFocus={() => pick(i)}
                      aria-current={on}
                      className="w-full cursor-pointer px-0 py-8 text-left"
                    >
                      {/* TOP-ALIGNED. A 13px numeral on the baseline of a 3.4rem name hangs
                          level with the bottom of its cap height and reads as having slipped;
                          the number is a label ON the row, so it sits at the row's top. */}
                      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                        <span className="mt-1.5 text-[13px] tabular-nums" style={{ color: PERI, opacity: on ? 1 : 0.4 }}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {/* THE NAME WIDENS WHEN IT IS CHOSEN. The width axis is the one
                            interaction idiom that belongs to this brand and to no template —
                            the letterforms themselves open, rather than a colour changing. */}
                        <span
                          className="transition-all duration-500 ease-out"
                          style={{
                            fontFamily: "var(--font-archivo)",
                            fontVariationSettings: `"wdth" ${on ? 96 : 74}`,
                            fontWeight: 600,
                            fontSize: "clamp(1.9rem, 4.2vw, 3.4rem)",
                            lineHeight: 0.95,
                            letterSpacing: "-0.035em",
                            opacity: on ? 1 : 0.45,
                          }}
                        >
                          {a.k}
                        </span>
                      </div>
                      <p
                        className="mt-3 max-w-[46ch] text-[16px] leading-relaxed transition-opacity duration-500"
                        style={{ opacity: on ? 0.72 : 0.3 }}
                      >
                        {a.b}
                      </p>
                    </button>
                  </li>
                )
              })}
              <li style={{ borderTop: `1px solid ${PAPER}26` }} />
            </ul>
          </div>
        </div>
      </section>

      {/* ══ 07 · SCALE ════════════════════════════════════════════════════════════════
          Numbers as the composition. Every figure here is a count of something that exists —
          no rates, no totals, nothing unattributable — which is the same rule the product
          follows and the one a marketplace reviewer checks first. */}
      {/* BONE, NOT SLATE — changed after counting the bands. The page ran 06 dark, 07 dark,
          08 dark: three in a row at exactly the point a reader is deciding whether to act.
          This direction's whole rhythm is an inversion, and an inversion needs something to
          invert against; three identical grounds is not a rhythm, it is a hole. */}
      <section className="px-6 py-[clamp(5rem,12vw,10rem)] sm:px-10" style={{ background: PAPER, color: INK }}>
        <div className="mx-auto max-w-[92rem]">
          <Eyebrow style={{ color: VIOLET }}>07 — At a glance</Eyebrow>
          <div className="mt-14 grid gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
            {stats.slice(0, 4).map((s, i) => (
              <Enter key={s.label} from="up" delay={i * 0.07} className="border-t pt-7" style={{ borderColor: `${INK}26` }}>
                <Display size="clamp(3.4rem,7vw,6rem)" width={72} weight={700} leading={0.86} style={{ color: i === 0 ? VIOLET : INK }}>
                  <CountUp value={s.value} />
                </Display>
                <span className="mt-5 block text-[15px] font-medium">{s.label}</span>
                {s.note ? <span className="mt-1.5 block text-[13px]" style={{ opacity: 0.55 }}>{s.note}</span> : null}
              </Enter>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 08 · THE CLOSE ════════════════════════════════════════════════════════════
          A brand conclusion rather than one more sales band: the picture returns, the type
          is the largest on the page, and there is exactly one thing to do. */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <Figure src="/brand/press-rail.jpg" alt="" ratio="auto" grade={GRADE_DARK} sizes="100vw"
            className="!aspect-auto h-full w-full" position="60% 50%" />
          <div className="absolute inset-0" style={{ background: `linear-gradient(105deg, ${INK} 22%, ${INK}D9 52%, ${INK}55)` }} />
        </div>
        <div className="relative px-6 py-[clamp(6rem,16vw,13rem)] sm:px-10">
          <div className="mx-auto max-w-[92rem]">
            <ClipReveal
              as="h2"
              lines={["Send us the order.", "We will send back", "something worth", "opening."]}
              size="clamp(2.4rem, 7.4vw, 7rem)"
              width={76}
              weight={700}
              leading={0.9}
              className="max-w-[16ch] uppercase"
              style={{ color: PAPER }}
            />
            <Enter from="up" delay={0.2} className="mt-12 flex flex-wrap items-center gap-8">
              <Link href="/signup"
                className="group inline-flex items-center gap-3 whitespace-nowrap px-9 py-4 text-[15px] font-medium transition-transform duration-300 hover:-translate-y-0.5"
                style={{ background: PERI, color: INK }}>
                {cta.button}
                <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </Link>
              <p className="max-w-[30ch] text-[15px]" style={{ color: PAPER, opacity: 0.6 }}>{cta.subhead}</p>
            </Enter>
          </div>
        </div>
      </section>

      <BrandFooter tone="dark" ink={PAPER} ground={INK} accent={PERI} />
    </div>
  )
}
