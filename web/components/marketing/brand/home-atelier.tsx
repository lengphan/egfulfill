"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { motion, useReducedMotion, useTransform } from "motion/react"
import type { SiteContent } from "@/lib/site-content"
import {
  ClipReveal, CountUp, Display, Enter, Eyebrow, Figure, ParallaxFigure,
  Stretch, useTrackProgress,
} from "@/components/marketing/brand/kit"
import { BrandNav, BrandFooter } from "@/components/marketing/brand/chrome"

/**
 * ══ STYLE B · ATELIER ═════════════════════════════════════════════════════════════════
 *
 * The opposite bet to PRESS. Bone is the dominant ground and stays it; the page is quiet,
 * wide-margined and editorial, and the two accents arrive as PLATES rather than as pops —
 * whole bands of periwinkle carrying ink, with violet reserved for marks and rules.
 *
 * The type does the shouting instead of the colour, and it shouts with WIDTH: the same
 * family runs at wdth 62 for a headline and wdth 118 for a caption, which is a contrast a
 * static face cannot make and is the reason this reads as art direction rather than as a
 * large font size.
 *
 * Composition is asymmetric throughout. Nothing is centred except the one statement plate,
 * and that is centred precisely because everything around it is not.
 */

const INK = "#1A1D22"     // soft slate — warmer and lighter than PRESS's, because it sits on bone
const PAPER = "#F7F6F3"   // bone
const WHITE = "#FFFFFF"
const VIOLET = "#614EFA"  // marks and rules. carries white when filled.
const PERI = "#C0C4FF"    // the plate. carries ink.

const SPECS = ["EST. 2024", "IN-HOUSE PRODUCTION", "ETSY · SHOPIFY · TIKTOK SHOP"]

/** 03 — the horizontal strip. Four beats, travelled sideways. */
const BEATS = [
  { n: "01", t: "Sync", b: "Connect a storefront once. Orders arrive on their own, with the artwork, the size and the address already attached." },
  { n: "02", t: "Check", b: "A person opens every file before a machine does. Wrong resolution, wrong colour count, wrong placement — caught here, not on the garment." },
  { n: "03", t: "Make", b: "Embroidered, printed or pressed on our own machines, in our own building, by the people who will also pack it." },
  { n: "04", t: "Ship", b: "Folded, bagged, labelled, scanned. The tracking number goes back to the storefront before the buyer thinks to ask." },
]

const AUDIENCES = [
  { k: "For brands", b: "Drop a collection without a warehouse or a minimum.", img: "/frames/rail-tee-natural.webp" },
  { k: "For teams", b: "One artwork, every size, shipped to individual addresses.", img: "/frames/rail-crew-sand.webp" },
  { k: "For creators", b: "Sell the thing your audience already asks you for.", img: "/frames/rail-hoodie-charcoal.webp" },
]

const PRODUCTS = [
  ["/brand/atl-hanger.jpg", "Heavyweight tee", "Garment-dyed, 240gsm"],
  ["/frames/rail-hoodie-natural.webp", "Fleece hoodie", "Brushed back, 380gsm"],
  ["/frames/rail-crew-ash.webp", "Crewneck", "Cotton-rich, boxy fit"],
] as const

export function HomeAtelier({ content }: { content: SiteContent }) {
  const { hero, features, stats, cta } = content
  const reduce = useReducedMotion()
  const [hovered, setHovered] = useState<number | null>(null)

  /* The sideways strip. One viewport of vertical travel buys one strip of horizontal
     movement — deliberately short, so it never feels like the page has taken the wheel. */
  const strip = useRef<HTMLDivElement>(null)
  const progress = useTrackProgress(strip)
  const x = useTransform(progress, [0, 1], ["2%", "-62%"])

  return (
    <div style={{ background: PAPER, color: INK }}>
      <BrandNav tone="light" ink={INK} accent={VIOLET} />

      {/* ══ 00 · HERO ═════════════════════════════════════════════════════════════════
          NO full-bleed photograph, which is the whole difference from PRESS. The type owns
          the screen and the picture is a tall column beside it, deliberately pushed below
          the headline's baseline so the composition is asymmetric rather than a two-up.

          A specification rule runs along the top — the page announces what it is before it
          says anything else, the way a printed sheet carries its own colophon. */}
      <section className="px-6 pb-[clamp(3rem,7vw,6rem)] pt-6 sm:px-10">
        <div className="mx-auto max-w-[92rem]">
          <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-2 border-t pt-4"
            style={{ borderColor: `${INK}26` }}>
            {SPECS.map((s) => <Eyebrow key={s} style={{ color: INK, opacity: 0.45 }}>{s}</Eyebrow>)}
            <Eyebrow style={{ color: VIOLET }}>Accepting new stores</Eyebrow>
          </div>

          <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <div className="pt-[clamp(2.5rem,6vw,5rem)]">
              <Stretch
                size="clamp(2.9rem, 9.6vw, 9.5rem)"
                from={70}
                to={98}
                weight={600}
                leading={0.87}
                className="max-w-[13ch]"
                style={{ color: INK }}
              >
                Make merch that feels like a brand.
              </Stretch>

              <motion.div
                className="mt-12 flex flex-wrap items-end gap-x-14 gap-y-8"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.75, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <p className="max-w-[36ch] text-[17px] leading-relaxed" style={{ opacity: 0.66 }}>
                  {hero.subhead}
                </p>
                <div className="flex items-center gap-7">
                  <Link href="/signup"
                    className="group inline-flex items-center gap-3 whitespace-nowrap px-8 py-4 text-[15px] font-medium transition-transform duration-300 hover:-translate-y-0.5"
                    style={{ background: INK, color: PAPER }}>
                    {hero.ctaPrimary}
                    <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                  </Link>
                  <Link href="/how-it-works"
                    className="text-[15px] underline decoration-1 underline-offset-[6px] transition-opacity hover:opacity-60">
                    {hero.ctaSecondary}
                  </Link>
                </div>
              </motion.div>
            </div>

            {/* Pushed down and cropped tall. It is a column of the layout, not an illustration
                of the headline — which is why it carries its own caption. */}
            <motion.figure
              className="m-0 lg:mt-[7rem]"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 34 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.95, delay: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
            >
              <Figure
                src="/brand/atl-stack.jpg"
                alt="Three folded heavyweight cotton garments stacked on a bone seamless"
                ratio="4 / 5"
                sizes="(max-width: 1024px) 100vw, 34vw"
                priority
              />
              <figcaption className="mt-3 flex items-baseline justify-between text-[12px]" style={{ opacity: 0.5 }}>
                <span>Bone · Clay · Sage</span>
                <span>240gsm garment-dyed</span>
              </figcaption>
            </motion.figure>
          </div>
        </div>
      </section>

      {/* ══ 01 · THE STATEMENT PLATE ══════════════════════════════════════════════════
          The one centred thing on the page, and the one full band of colour. Ink on
          periwinkle measures 11.79:1, so the plate can carry real type at any size — which
          is exactly why the accent is a GROUND here and never lettering. */}
      <section className="px-6 py-[clamp(5rem,13vw,11rem)] sm:px-10" style={{ background: PERI, color: INK }}>
        <div className="mx-auto max-w-[62rem] text-center">
          <Eyebrow style={{ opacity: 0.55 }}>01 — What we believe</Eyebrow>
          <ClipReveal
            as="p"
            lines={["Anyone can print", "a logo on a shirt.", "Almost nobody", "makes it feel made."]}
            size="clamp(2.1rem, 5.6vw, 5rem)"
            width={76}
            weight={600}
            leading={0.95}
            className="mt-9"
          />
          <Enter from="up" delay={0.25}>
            <p className="mx-auto mt-10 max-w-[52ch] text-[16px] leading-relaxed" style={{ opacity: 0.7 }}>
              The garment is the product, not the print file. We buy blanks by hand, keep the
              machines in our own building, and put a person in front of every piece of artwork
              before it reaches a press.
            </p>
          </Enter>
        </div>
      </section>

      {/* ══ 02 · MATERIAL ═════════════════════════════════════════════════════════════
          Full-bleed texture with the caption block OVERLAPPING it. Text over imagery, with
          the overlap doing the work a frame usually does — nothing is boxed. */}
      <section className="relative">
        <ParallaxFigure
          src="/brand/atl-stitch.jpg"
          alt="Macro of tonal satin-stitch embroidery raised on heavyweight cotton"
          ratio="21 / 9"
          distance={54}
          sizes="100vw"
          className="w-full"
        />
        {/* RELATIVE + z-10, and both are load-bearing. The figure above establishes its own
            paint order, so a block pulled up by a negative margin with no stacking context of
            its own is painted UNDERNEATH it — which cut the first line of this headline in
            half and hid the eyebrow entirely. A negative margin moves layout, not z-order.

            The card is WHITE rather than the page's bone: this photograph is itself almost
            bone, and a card the same value as the picture behind it is not an overlap, it is
            a rectangle nobody can see. */}
        <div className="relative z-10 mx-auto -mt-[clamp(3rem,9vw,8rem)] max-w-[92rem] px-6 sm:px-10">
          <Enter from="up">
            <div className="max-w-[40rem] px-8 py-10 sm:px-12 sm:py-12" style={{ background: WHITE }}>
              <Eyebrow style={{ color: VIOLET }}>02 — Material</Eyebrow>
              <Display as="h2" size="clamp(1.7rem,3.4vw,2.9rem)" width={84} weight={600} leading={1} className="mt-5">
                Thread sits on top of the cloth. You can feel it.
              </Display>
              <p className="mt-6 text-[16px] leading-relaxed" style={{ opacity: 0.66 }}>
                Tonal satin stitch, digitised in house. Seven decoration methods under one roof,
                so the method is chosen for the garment rather than for whichever machine is free.
              </p>
            </div>
          </Enter>
        </div>
      </section>

      {/* ══ 03 · THE PROCESS, SIDEWAYS ════════════════════════════════════════════════
          A horizontal strip travelled by vertical scroll. Deliberately SHORT — one viewport
          buys the whole strip — because the failure mode of this device is a page that has
          taken the wheel and will not give it back. */}
      <section ref={strip} className="relative" style={{ height: "260svh", background: PAPER }}>
        <div className="sticky top-0 flex h-svh flex-col justify-center overflow-hidden">
          <div className="mx-auto mb-12 w-full max-w-[92rem] px-6 sm:px-10">
            <Eyebrow style={{ color: VIOLET }}>03 — The production experience</Eyebrow>
            <Display as="h2" size="clamp(1.9rem,4vw,3.4rem)" width={82} weight={600} leading={0.98} className="mt-5 max-w-[16ch]">
              Four things happen. You watch three of them.
            </Display>
          </div>

          <motion.div className="flex gap-6 pl-6 sm:gap-10 sm:pl-10" style={reduce ? undefined : { x }}>
            {BEATS.map((b) => (
              <article key={b.n} className="w-[78vw] shrink-0 border-t pt-7 sm:w-[46vw] lg:w-[30vw]"
                style={{ borderColor: `${INK}26` }}>
                <div className="flex items-baseline gap-5">
                  <Display size="clamp(2.6rem,4.6vw,3.6rem)" width={68} weight={700} leading={1} style={{ color: VIOLET }}>
                    {b.n}
                  </Display>
                  <Display as="h3" size="clamp(1.3rem,2.2vw,1.8rem)" width={98} weight={600} leading={1.05}>
                    {b.t}
                  </Display>
                </div>
                <p className="mt-5 text-[16px] leading-relaxed" style={{ opacity: 0.66 }}>{b.b}</p>
              </article>
            ))}
            <div className="w-[30vw] shrink-0" />
          </motion.div>
        </div>
      </section>

      {/* ══ 04 · WHY DIFFERENT ════════════════════════════════════════════════════════
          Two columns, wildly unequal. No cards: three claims separated by a violet rule,
          because the claim is the sentence and a box around it only adds chrome. */}
      <section className="px-6 py-[clamp(5rem,12vw,10rem)] sm:px-10" style={{ background: WHITE }}>
        <div className="mx-auto grid max-w-[92rem] gap-x-20 gap-y-14 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div>
            <Eyebrow style={{ color: VIOLET }}>04 — Why it is different</Eyebrow>
            <ClipReveal
              as="h2"
              lines={["We are the", "factory, not", "the middle", "of one."]}
              size="clamp(2.3rem, 5vw, 4.6rem)"
              width={72}
              weight={600}
              leading={0.92}
              className="mt-7"
            />
          </div>
          <div className="lg:pt-16">
            {features.cards.slice(0, 3).map((c, i) => (
              <Enter key={c.title} from="right" delay={i * 0.08} className="border-t py-8"
                style={{ borderColor: i === 0 ? VIOLET : `${INK}1F` }}>
                <div className="flex items-baseline gap-5">
                  <span className="text-[12px] tabular-nums" style={{ color: VIOLET }}>{String(i + 1).padStart(2, "0")}</span>
                  <Display as="h3" size="clamp(1.2rem,1.9vw,1.6rem)" width={100} weight={600} leading={1.15}>
                    {c.title}
                  </Display>
                </div>
                <p className="mt-4 max-w-[54ch] pl-9 text-[16px] leading-relaxed" style={{ opacity: 0.64 }}>{c.body}</p>
              </Enter>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 05 · PRODUCTS ═════════════════════════════════════════════════════════════
          Restrained on purpose — three garments, enormous margins, captions smaller than the
          copy anywhere else on the page. A shop grid here would make a fulfilment brand look
          like a shop. */}
      <section className="px-6 py-[clamp(5rem,12vw,10rem)] sm:px-10" style={{ background: PAPER }}>
        <div className="mx-auto max-w-[92rem]">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <Eyebrow style={{ color: VIOLET }}>05 — The blanks</Eyebrow>
              <Display as="h2" size="clamp(1.9rem,4vw,3.4rem)" width={84} weight={600} leading={0.98} className="mt-5">
                Chosen, not catalogued.
              </Display>
            </div>
            <Link href="/catalog" className="text-[15px] underline decoration-1 underline-offset-[6px] transition-opacity hover:opacity-60">
              See the full catalogue
            </Link>
          </div>

          <div className="mt-16 grid gap-x-10 gap-y-14 sm:grid-cols-3">
            {PRODUCTS.map(([src, name, spec], i) => (
              <Enter key={name} from="up" delay={i * 0.09} className={i === 1 ? "sm:mt-14" : ""}>
                <Figure src={src} alt={name} ratio="4 / 5" sizes="(max-width:640px) 100vw, 30vw"
                  className="transition-transform duration-[900ms] ease-[cubic-bezier(.16,1,.3,1)] hover:scale-[1.02]" />
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-[15px] font-medium">{name}</span>
                  <span className="text-[12px]" style={{ opacity: 0.5 }}>{spec}</span>
                </div>
              </Enter>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 06 · WHO IT IS FOR ════════════════════════════════════════════════════════
          A list, not a grid — and hovering a line brings its garment in behind the type. The
          picture is the reward for pointing at something, which is the page's one playful
          moment and costs nothing when nobody hovers. */}
      <section className="relative overflow-hidden px-6 py-[clamp(5rem,12vw,10rem)] sm:px-10" style={{ background: INK, color: PAPER }}>
        <div className="mx-auto max-w-[92rem]">
          <Eyebrow style={{ color: PERI }}>06 — Who it is for</Eyebrow>
          <ul className="mt-12">
            {AUDIENCES.map((a, i) => (
              <li
                key={a.k}
                className="relative border-t"
                style={{ borderColor: `${PAPER}22` }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-10 gap-y-3 py-9 transition-opacity duration-300"
                  style={{ opacity: hovered === null || hovered === i ? 1 : 0.35 }}>
                  <Display size="clamp(2rem,5vw,4.2rem)" width={74} weight={600} leading={0.95}>{a.k}</Display>
                  <p className="max-w-[38ch] text-[16px] leading-relaxed" style={{ opacity: 0.66 }}>{a.b}</p>
                </div>
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute right-[26%] top-1/2 hidden w-[16rem] -translate-y-1/2 lg:block"
                  initial={false}
                  animate={hovered === i && !reduce ? { opacity: 1, y: "-50%", scale: 1 } : { opacity: 0, y: "-46%", scale: 0.97 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Figure src={a.img} alt="" ratio="3 / 4" sizes="16rem" />
                </motion.div>
              </li>
            ))}
            <li className="border-t" style={{ borderColor: `${PAPER}22` }} />
          </ul>
        </div>
      </section>

      {/* ══ 07 · SCALE ════════════════════════════════════════════════════════════════
          Numbers as the composition, at the page's widest measure and its narrowest width
          axis. Every figure is a count of something that exists — no rates, no totals,
          nothing that cannot be pointed at. */}
      <section className="px-6 py-[clamp(5rem,12vw,10rem)] sm:px-10" style={{ background: PAPER }}>
        <div className="mx-auto max-w-[92rem]">
          <Eyebrow style={{ color: VIOLET }}>07 — At a glance</Eyebrow>
          <div className="mt-14 grid gap-x-12 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
            {stats.slice(0, 4).map((s, i) => (
              <Enter key={s.label} from="up" delay={i * 0.07} className="border-t pt-7" style={{ borderColor: `${INK}26` }}>
                <Display size="clamp(3.6rem,8vw,6.6rem)" width={66} weight={700} leading={0.84}>
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
          The plate returns, so the page ends where its argument began. One action, and the
          statement is the largest type on the site. */}
      <section className="px-6 py-[clamp(6rem,15vw,12rem)] sm:px-10" style={{ background: PERI, color: INK }}>
        <div className="mx-auto max-w-[92rem]">
          <ClipReveal
            as="h2"
            lines={["Send us the order.", "We will send back", "something worth opening."]}
            size="clamp(2.2rem, 6.4vw, 6.4rem)"
            width={74}
            weight={600}
            leading={0.92}
            className="max-w-[18ch]"
          />
          <Enter from="up" delay={0.2} className="mt-14 flex flex-wrap items-center gap-x-10 gap-y-6">
            <Link href="/signup"
              className="group inline-flex items-center gap-3 whitespace-nowrap px-9 py-4 text-[15px] font-medium transition-transform duration-300 hover:-translate-y-0.5"
              style={{ background: INK, color: PAPER }}>
              {cta.button}
              <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
            <p className="max-w-[32ch] text-[15px]" style={{ opacity: 0.65 }}>{cta.subhead}</p>
          </Enter>
        </div>
      </section>

      <BrandFooter tone="light" ink={INK} ground={PAPER} accent={VIOLET} />
    </div>
  )
}
