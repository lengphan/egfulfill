"use client"

/**
 * HOMEPAGE DRAFT B — "SPINE". A LAB PAGE, not a route anyone is sent to. noindex.
 *
 * THE PROBLEM IT ANSWERS is the same one as draft A: six bands, 5149px at 1440, every one of
 * them the same rounded rectangle with a display heading at its top-left. The page has no
 * architecture — it has a stack.
 *
 * THE IDEA. The product IS a sequence: a sale arrives, it is made, it ships, the tracking
 * goes back. The page should be that sequence, not six essays about it. So the rule that
 * currently runs down ONE section becomes the spine of the whole page, and every block on it
 * is a STATION rather than a card:
 *
 *   01 CONNECT · 02 DESIGN · 03 PUBLISH · 04 SHIP · what it costs · start
 *
 * Two consequences worth stating, because they are the whole draft:
 *
 *   · THE EVIDENCE MOVES TO THE STATION IT BELONGS TO. The seven print methods are not a
 *     separate band about our machines — they are what DESIGN means, so they hang off station
 *     02. The marketplaces are what CONNECT means. A quote from a seller who stopped touching
 *     orders belongs at SHIP, which is the claim it backs. Nothing is a section any more.
 *   · STATIONS ALTERNATE SIDES of the rule, so the page has a left-right pulse instead of six
 *     identical left-aligned blocks, and the rule is what holds the two sides together.
 *
 * The spine TERMINATES in the button. The last thing the line does is arrive at the ask, which
 * is the one piece of narrative a marketing page actually needs.
 *
 * WHAT IT KEEPS. Every word is the stored content and the real plan tiers; the garment is the
 * existing cut-out. Nothing here invents a figure or a screenshot.
 */

import Image from "next/image"
import { DEFAULT_SITE_CONTENT as C } from "@/lib/site-content"
import { PLAN_TIERS } from "@/lib/plans"

/* A DRAFT COPY — see the same note in draft A. If this is adopted, export the real list from
   components/marketing/ploy/methods.tsx rather than keeping two. */
const METHODS = ["Embroidery", "DTG", "DTF", "Appliqué", "Laser", "Sublimation", "Screen print"]

/**
 * ONE STATION ON THE LINE.
 *
 * The rule is drawn by the PAGE, not by the station, so it is unbroken from the first to the
 * last — a rule redrawn per block is a dashed line with extra steps. The node sits on the
 * row's first baseline, which is what keeps the dot level with the word at any type size.
 */
function Station({
  n, word, line, side = "right", children,
}: {
  n: string; word: string; line: string; side?: "left" | "right"; children?: React.ReactNode
}) {
  const right = side === "right"
  return (
    <div className="relative grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-6 py-14 md:grid-cols-2 md:gap-x-24 md:py-20">
      {/* THE NODE sits ON the rule, at the page's centre line on md and in the left gutter
          below it — the same x the rule is drawn at, so it never needs an offset of its own. */}
      <span className="absolute left-[1.25rem] top-[3.9rem] z-10 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border-2 border-ploy-ink bg-ploy-ink text-[13px] font-semibold tabular-nums text-ploy-ground md:left-1/2 md:top-[5.4rem]">
        {n}
      </span>
      {/* An empty cell on the side the station is NOT on, so the grid does the alternating
          rather than a margin somebody has to keep in sync. */}
      {right && <div className="hidden md:block" />}
      <div className={"col-start-2 md:col-start-auto " + (right ? "md:pl-14" : "md:pr-14 md:text-right")}>
        <h2 className="ploy-display text-[clamp(2.5rem,6vw,5rem)] leading-[0.86]">{word}</h2>
        <p className={"mt-4 text-[clamp(1.05rem,1.5vw,1.35rem)] leading-snug text-ploy-ink/70 " + (right ? "max-w-[26rem]" : "ml-auto max-w-[26rem]")}>
          {line}
        </p>
        {children}
      </div>
    </div>
  )
}

export default function HomeB() {
  return (
    <div data-skin="balloon" className="min-h-svh bg-ploy-ground text-ploy-ink">
      {/* ── THE HEAD. No rule yet: the line starts where the process does. */}
      <section className="relative w-full overflow-x-clip">
        <div className="mx-auto flex min-h-[88svh] w-full max-w-[1480px] flex-col justify-end px-6 pb-20 md:px-10 md:pb-28">
          <h1 className="ploy-display max-w-[9ch] text-[clamp(3.5rem,8vw,8rem)] leading-[0.82] md:max-w-[50%]">
            {C.hero.headline}<br />{C.hero.accent}
          </h1>
          <p className="mt-8 max-w-[32rem] text-[clamp(1rem,1.4vw,1.25rem)] leading-snug text-ploy-ink/70">{C.hero.subhead}</p>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[44vw] items-center md:flex">
          <Image src="/ploy/obj-hoodie.webp" alt="" width={900} height={1232} priority unoptimized
                 style={{ filter: "hue-rotate(-62deg) saturate(1.35) brightness(1.04)" }}
                 className="h-auto w-full translate-x-[14%]" />
        </div>
      </section>

      {/* ── THE LINE. One rule, drawn once, running the whole height of everything below. */}
      <div className="relative mx-auto w-full max-w-[1480px] px-6 md:px-10">
        <div className="pointer-events-none absolute bottom-0 left-[2.75rem] top-0 w-px bg-ploy-ink/20 md:left-1/2" />

        <Station n="01" word={C.steps.items[0].word ?? "Connect"} line={C.steps.items[0].body} side="right">
          {/* WHAT CONNECT MEANS, at the station rather than in a band about integrations. */}
          <ul className="mt-6 flex flex-wrap gap-2">
            {C.hero.integrations.map((m) => (
              <li key={m} className="rounded-full border border-ploy-ink/25 px-4 py-1.5 text-[14px] font-medium">{m}</li>
            ))}
          </ul>
        </Station>

        <Station n="02" word={C.steps.items[1].word ?? "Design"} line={C.steps.items[1].body} side="left">
          {/* THE SEVEN LIVE HERE. They are not a section about our machines; they are what
              "design" means on this platform, and at the station they are read as the range
              of one step rather than as a second argument. */}
          <ul className="mt-6 flex flex-wrap justify-end gap-x-5 gap-y-1 text-[15px] text-ploy-ink/70">
            {METHODS.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </Station>

        <Station n="03" word={C.steps.items[2].word ?? "Publish"} line={C.steps.items[2].body} side="right" />

        <Station n="04" word={C.steps.items[3].word ?? "Ship"} line={C.steps.items[3].body} side="left">
          {/* THE QUOTE IS EVIDENCE FOR THIS STEP, so it sits on it. On the live page it is a
              band of three cards halfway down, backing nothing in particular. */}
          <blockquote className="ml-auto mt-8 max-w-[26rem] border-t border-ploy-ink/20 pt-6 text-[clamp(1.1rem,1.7vw,1.5rem)] font-semibold leading-snug">
            “I went from spending three hours a day on orders to none.”
            <footer className="mt-3 text-[14px] font-normal text-ploy-ink/60">A seller, three stores</footer>
          </blockquote>
        </Station>

        {/* ── A STATION WITHOUT A NUMBER: the line keeps going, but this is not a step. The
               figures sit across the rule rather than to one side, which is how the page says
               "this describes all four of the above". */}
        <div className="relative py-16 md:py-24">
          <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-5">
            {C.stats.map((f) => (
              <div key={f.label} className="bg-ploy-ground pr-4">
                <p className="ploy-display text-[clamp(1.8rem,3vw,2.75rem)] leading-[0.9]">{f.value}</p>
                <p className="mt-2 text-[14px] font-semibold">{f.label}</p>
                <p className="mt-1 text-[13px] leading-snug text-ploy-ink/60">{f.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── WHAT IT COSTS, still on the line. Three plans, but as rows across it rather than
               as a tray of cards: the question here is "which one", and the answer is easier
               to read as a comparison than as three boxes. */}
        <div className="relative py-16 md:py-24">
          <h2 className="ploy-display text-[clamp(2rem,4vw,3.25rem)] leading-[0.9] md:text-center">What it costs.</h2>
          <div className="mt-12 border-t border-ploy-ink/15">
            {PLAN_TIERS.map((t) => (
              <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 border-b border-ploy-ink/15 bg-ploy-ground py-6 md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] md:gap-x-12">
                <h3 className="text-[clamp(1.25rem,2vw,1.6rem)] font-semibold tracking-[-0.02em]">{t.name}</h3>
                <p className="col-span-2 text-[15px] leading-snug text-ploy-ink/70 md:col-span-1">{t.tagline}</p>
                <p className="ploy-display text-[clamp(1.75rem,2.6vw,2.25rem)] leading-none">
                  {t.monthlyPrice === 0 ? "$0" : `$${t.monthlyPrice}`}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* ── THE END OF THE LINE, and the page's ONE plate.
               Drawn with no fills anywhere, this page is grey from top to bottom — which reads
               as austere rather than as restraint, and gives the eye nothing to travel toward.
               So the last station is a full-bleed acid plate that the rule runs INTO: the
               colour is the destination, not decoration, and it appears exactly once so it
               still means something when it does. `w-screen` + the negative margin is how a
               block inside the 1480 container bleeds past it. */}
        <div className="relative left-1/2 flex w-screen -translate-x-1/2 flex-col items-center bg-ploy-acid px-6 py-24 text-center md:py-32">
          <span className="-mt-[5.5rem] mb-12 h-11 w-11 rounded-full border-2 border-ploy-ink bg-ploy-acid" />
          <h2 className="ploy-display max-w-[14ch] text-[clamp(3rem,8vw,7rem)] leading-[0.84]">{C.cta.heading}</h2>
          <p className="mt-6 max-w-[32rem] text-[17px] text-ploy-ink/70">{C.cta.subhead}</p>
          <form className="mt-10 flex w-full max-w-[32rem] gap-3">
            <input placeholder="you@shop.com" className="h-14 flex-1 rounded-full border border-ploy-ink/25 bg-transparent px-6 text-[16px] outline-none placeholder:text-ploy-ink/40" />
            <button className="h-14 shrink-0 rounded-full bg-ploy-ink px-8 text-[15px] font-medium text-ploy-ground">{C.cta.button}</button>
          </form>
        </div>
      </div>
    </div>
  )
}
