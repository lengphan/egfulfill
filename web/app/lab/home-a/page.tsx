"use client"

/**
 * HOMEPAGE DRAFT A — "SPREAD". A LAB PAGE, not a route anyone is sent to. noindex.
 *
 * THE PROBLEM IT ANSWERS. Measured on the live home at 1440: six bands, 5149px, and every
 * one of them is the same object — a rounded fill, a display heading at its top-left, content
 * under it. Six identical rectangles in a column. Nothing about the page's architecture tells
 * you which section is the argument, which is the evidence and which is the ask; they are
 * distinguished only by their fill colour, which is why more colour kept being the answer and
 * kept not working.
 *
 * THE IDEA. Variation comes from the CONTAINER, not the paint. The page alternates two kinds
 * of block and never two of a kind in a row:
 *
 *   PLATE   full-bleed, edge to edge, no radius. The loud thing: the hero, the proof, the
 *           close. It owns the viewport for as long as it lasts.
 *   SHEET   no fill at all. Type set straight on the page ground between hairlines, in real
 *           columns. The readable thing: the process, the seven methods.
 *
 * So the rhythm is PLATE · sheet · PLATE · sheet · cards · PLATE, and the one place cards
 * appear is the plans — where you are genuinely being asked to pick an object.
 *
 * WHAT IT KEEPS. Every word is the stored content (DEFAULT_SITE_CONTENT) and the real plan
 * tiers. The garment is the existing cut-out. Nothing here invents a figure or a screenshot.
 */

import Image from "next/image"
import { DEFAULT_SITE_CONTENT as C } from "@/lib/site-content"
import { PLAN_TIERS } from "@/lib/plans"

/* A DRAFT COPY of the seven, deliberately. The real list is a module const inside
   components/marketing/ploy/methods.tsx and exporting it would be a change to the live site
   to serve a lab page. If this draft is adopted, that export is the first thing to do — §5,
   a private copy is how two surfaces come to disagree. */
const METHODS: [string, string][] = [
  ["Embroidery", "Thread matched to your artwork in the Design Lab. Caps, hoodies, patches."],
  ["DTG", "Full-colour ink straight into cotton. Photos, gradients, painterly work."],
  ["DTF", "Transfer film for any fabric and any colour, with crisp edges."],
  ["Appliqué", "Layered twill and chenille, stitched down. The varsity look."],
  ["Laser", "Etched patches and cut detail with a burnt, precise line."],
  ["Sublimation", "All-over print on polyester, edge to edge and into the seams."],
  ["Screen print", "Flat colour, thick ink, and the price that comes with a run."],
]

/** Full-bleed. No radius, no gutter: the block IS the page for its height. */
function Plate({ bg, ink, children }: { bg: string; ink?: string; children: React.ReactNode }) {
  return (
    <section style={{ background: bg, color: ink }} className="w-full">
      <div className="mx-auto w-full max-w-[1480px] px-6 md:px-10">{children}</div>
    </section>
  )
}

/** No fill. Type on the page's own ground, between rules. */
function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-[1480px] px-6 py-24 md:px-10 md:py-32">{children}</section>
  )
}

export default function HomeA() {
  return (
    <div data-skin="balloon" className="min-h-svh bg-ploy-ground text-ploy-ink">
      {/* ── 1 · PLATE: the hero. The garment bleeds off the right of the VIEWPORT, so this
             plate is the one block that is allowed past the 1480 cap. */}
      <section className="relative w-full overflow-x-clip bg-ploy-ground">
        <div className="mx-auto flex min-h-[92svh] w-full max-w-[1480px] flex-col justify-end px-6 pb-16 md:px-10 md:pb-24">
          {/* TWO LINES, AND CAPPED. As one string it wrapped wherever the box ended — at
              1440 that put "IT." alone on line two and ran the first line under the sleeve.
              The two stored fields already mean "the lead" and "the tail"; setting them as
              two lines is what they are for. */}
          <h1 className="ploy-display max-w-[9ch] text-[clamp(3.5rem,8vw,8rem)] leading-[0.82] md:max-w-[52%]">
            {C.hero.headline}<br />{C.hero.accent}
          </h1>
          <p className="mt-8 max-w-[34rem] text-[clamp(1rem,1.4vw,1.25rem)] leading-snug text-ploy-ink/70">
            {C.hero.subhead}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/signup" className="rounded-full bg-ploy-ink px-7 py-3.5 text-[15px] font-medium text-ploy-ground">{C.hero.ctaPrimary}</a>
            <a href="/how-it-works" className="rounded-full border border-ploy-ink/25 px-7 py-3.5 text-[15px] font-medium">{C.hero.ctaSecondary}</a>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[46vw] items-center md:flex">
          <Image src="/ploy/obj-hoodie.webp" alt="" width={900} height={1232} priority unoptimized
                 style={{ filter: "hue-rotate(-62deg) saturate(1.35) brightness(1.04)" }}
                 className="h-auto w-full translate-x-[12%]" />
        </div>
      </section>

      {/* ── 2 · SHEET: the process as a contents page.
             Four rows, full width, hairline between each. The number is a margin note, the
             word is the entry, the line is what it means. Nothing is centred and nothing is
             in a box: this is the part of the page you READ. */}
      <Sheet>
        <p className="max-w-[42rem] text-[clamp(1.4rem,2.4vw,2rem)] leading-[1.2] tracking-[-0.015em]">
          {C.steps.heading} Finding a printer you can trust is the hard part. We make everything
          ourselves, in one factory.
        </p>
        <ol className="mt-16 border-t border-ploy-ink/15">
          {C.steps.items.map((s, i) => (
            <li key={s.n || i} className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-6 border-b border-ploy-ink/15 py-8 md:grid-cols-[4rem_minmax(0,16rem)_minmax(0,1fr)] md:gap-x-8 md:py-10">
              <span className="text-[13px] font-semibold tabular-nums text-ploy-ink/50">{s.n}</span>
              <h3 className="ploy-display text-[clamp(2rem,4vw,3.25rem)] leading-[0.9]">{s.word}</h3>
              <p className="col-start-2 max-w-[30rem] text-[17px] leading-snug text-ploy-ink/70 md:col-start-3">{s.body}</p>
            </li>
          ))}
        </ol>
        {/* The figures are a SPEC ROW under the process, not a band of their own: they are
            what the four steps above amount to. `note` is what turns a row of digits into a
            spec sheet rather than four unexplained numbers. */}
        <div className="mt-16 grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-5">
          {C.stats.map((f) => (
            <div key={f.label}>
              <p className="ploy-display text-[clamp(2rem,3.5vw,3rem)] leading-[0.9]">{f.value}</p>
              <p className="mt-2 text-[14px] font-semibold">{f.label}</p>
              <p className="mt-1 max-w-[14rem] text-[13px] leading-snug text-ploy-ink/60">{f.note}</p>
            </div>
          ))}
        </div>
      </Sheet>

      {/* ── 3 · PLATE: the proof. ONE quote, set as large as the page ever goes.
             Three quotes in a row is a card grid; one quote at 64px is somebody talking. */}
      <Plate bg="var(--color-ploy-peri)">
        <div className="py-24 md:py-32">
          <p className="max-w-[22ch] text-[clamp(2rem,5.5vw,4.5rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
            “I went from spending three hours a day on orders to none.”
          </p>
          <p className="mt-10 text-[15px] font-semibold">A seller, three stores</p>
        </div>
      </Plate>

      {/* ── 4 · SHEET: the seven, as a table.
             It is a rail of seven auto-advancing cards today. A rail hides six of the seven
             at any moment and moves the one you were reading; the claim is "we run all seven
             ourselves", and a list is the only shape that makes seven look like seven. */}
      <Sheet>
        <h2 className="ploy-display max-w-[18ch] text-[clamp(2.5rem,6vw,5rem)] leading-[0.88]">Seven ways to make it.</h2>
        <div className="mt-14 border-t border-ploy-ink/15">
          {METHODS.map(([name, line]) => (
            <div key={name} className="grid grid-cols-1 gap-y-1 border-b border-ploy-ink/15 py-6 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-x-12 md:py-7">
              <h3 className="text-[clamp(1.25rem,2vw,1.6rem)] font-semibold tracking-[-0.02em]">{name}</h3>
              <p className="max-w-[38rem] text-[17px] leading-snug text-ploy-ink/70">{line}</p>
            </div>
          ))}
        </div>
      </Sheet>

      {/* ── 5 · CARDS, once. You are being asked to pick an object, so here the object is a
             card — and because it is the only card on the page, the shape means something. */}
      <section className="mx-auto w-full max-w-[1480px] px-6 pb-24 md:px-10 md:pb-32">
        <h2 className="ploy-display text-[clamp(2.5rem,6vw,5rem)] leading-[0.88]">Three plans.</h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PLAN_TIERS.map((t, i) => (
            <div key={t.id} className="rounded-[26px] p-8"
                 style={{ background: i === 1 ? "var(--color-ploy-acid)" : "var(--mk-card)" }}>
              <p className="text-[15px] font-semibold">{t.name}</p>
              <p className="ploy-display mt-6 text-[clamp(2.5rem,4vw,3.5rem)] leading-[0.9]">
                {t.monthlyPrice === 0 ? "$0" : `$${t.monthlyPrice}`}
              </p>
              <p className="mt-1 text-[13px] text-ploy-ink/60">per month</p>
              <ul className="mt-8 space-y-2 text-[15px] leading-snug">
                {t.features.map((f) => <li key={f} className="border-t border-ploy-ink/10 pt-2">{f}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── 6 · PLATE: the close. Full bleed acid, the headline at the page's largest, one
             field. Nothing else is on this screen. */}
      <Plate bg="var(--color-ploy-acid)">
        <div className="py-28 md:py-40">
          <h2 className="ploy-display max-w-[14ch] text-[clamp(3rem,9vw,8rem)] leading-[0.82]">{C.cta.heading}</h2>
          <p className="mt-8 max-w-[34rem] text-[17px] text-ploy-ink/70">{C.cta.subhead}</p>
          <form className="mt-10 flex max-w-[34rem] gap-3">
            <input placeholder="you@shop.com" className="h-14 flex-1 rounded-full border border-ploy-ink/25 bg-transparent px-6 text-[16px] outline-none placeholder:text-ploy-ink/40" />
            <button className="h-14 shrink-0 rounded-full bg-ploy-ink px-8 text-[15px] font-medium text-ploy-ground">{C.cta.button}</button>
          </form>
        </div>
      </Plate>
    </div>
  )
}
