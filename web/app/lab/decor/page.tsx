"use client"

/**
 * DASHBOARD DECORATION — DRAFT OPTIONS, NOT A SHIPPED SURFACE.
 *
 * Two questions are being answered here, side by side in light and dark:
 *   1. what the greeting band's ground is, now that the light periwinkle reads washed-out
 *      on a dark page, and
 *   2. what sits at its right end, now that the balloon render is not the thing.
 *
 * Everything is drawn with the app's own tokens, so a variant that is picked moves into
 * dashboard-view.tsx / staff-dashboard.tsx unchanged. noindex — nobody approved this.
 */

import { Broadcast, Package, Printer, Storefront } from "@phosphor-icons/react"

const NAME = "uyen"
const GREET = "Good afternoon"

/** Fourteen days of GMV, scaled 0..1 — the same shape the money panel draws, at band size. */
const SPARK = [0.32, 0.41, 0.28, 0.55, 0.49, 0.62, 0.44, 0.71, 0.58, 0.83, 0.66, 0.91, 0.74, 1]

function Sparkline({ className = "", stroke = "currentColor" }: { className?: string; stroke?: string }) {
  const w = 132, h = 34
  const d = SPARK.map((v, i) => `${i ? "L" : "M"}${(i / (SPARK.length - 1)) * w},${h - v * h}`).join(" ")
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={"h-[34px] w-[132px] shrink-0 " + className} aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The greeting itself. Only the ground and the right-hand device change between variants. */
function Greeting({ subTone = "opacity-70", figureTone = "" }: { subTone?: string; figureTone?: string }) {
  return (
    <div className="min-w-0">
      <h1 className="font-title text-2xl font-semibold leading-tight tracking-tight">{GREET}, {NAME}</h1>
      <p className={"text-sm " + subTone}>
        <span className={"font-medium " + figureTone}>5</span> new today
      </p>
    </div>
  )
}

function Variant({ n, title, note, children }: { n: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="grid size-5 shrink-0 place-items-center rounded bg-foreground text-[11px] font-semibold text-background">{n}</span>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      {children}
    </section>
  )
}

function Bands() {
  return (
    <div className="space-y-6">
      {/* 1 — THE PLATE. The rail's own slate, so the band and the chrome are one surface.
          It is already dark, so dark mode moves it one step and nothing washes out. */}
      <Variant n="1" title="Plate" note="the rail's slate · lime figure · no object">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-sidebar px-5 py-4 text-sidebar-foreground">
          <Greeting subTone="text-sidebar-foreground/60" figureTone="text-[#D4F897]" />
          <span className="hidden text-right text-xs uppercase tracking-[0.18em] text-sidebar-foreground/45 sm:block">Mon 8 Sep</span>
        </div>
      </Variant>

      {/* 2 — TINTED CARD. The periwinkle stays, but as a WASH over the card rather than a
          fill: in dark it resolves against the dark card, so it can never read washed-out. */}
      <Variant n="2" title="Tinted card" note="brand at 18% over the card · ink stays the page's">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand/30 px-5 py-4"
             style={{ background: "color-mix(in oklch, var(--brand) 18%, var(--card))" }}>
          <Greeting subTone="text-muted-foreground" figureTone="text-foreground" />
          <Sparkline className="text-brand" />
        </div>
      </Variant>

      {/* 3 — NO GROUND. A rule and a marker. The quietest, and the only one that adds no
          colour to a page whose canvas rule is white. */}
      <Variant n="3" title="Rule" note="no fill · a brand marker under the name">
        <div className="flex items-end justify-between gap-3 border-b border-border pb-4">
          <div>
            <span className="mb-2 block h-1.5 w-10 rounded-full bg-brand" />
            <Greeting subTone="text-muted-foreground" figureTone="text-foreground" />
          </div>
          <div className="hidden text-right sm:block">
            <span className="block text-2xl font-semibold tabular-nums leading-none tracking-tight">$18,665</span>
            <span className="text-xs text-muted-foreground">last 30 days</span>
          </div>
        </div>
      </Variant>

      {/* 4 — THE DEVICE IS DATA. Same band, but the right end carries the run rather than a
          render — decoration that is true (§4: honesty in UI). */}
      <Variant n="4" title="Plate + the run" note="the object's slot carries 14 days of GMV">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-sidebar px-5 py-4 text-sidebar-foreground">
          <Greeting subTone="text-sidebar-foreground/60" figureTone="text-[#D4F897]" />
          <div className="hidden items-end gap-3 sm:flex">
            <Sparkline stroke="#D4F897" />
            <span className="pb-0.5 text-right">
              <span className="block text-lg font-semibold tabular-nums leading-none">$18,665</span>
              <span className="text-[11px] text-sidebar-foreground/50">30 days</span>
            </span>
          </div>
        </div>
      </Variant>

      {/* 5 — PHOTOGRAPH, NOT RENDER. The house identity is "we photograph"; the blank on the
          periwinkle seamless is the one image the marketing site already owns. */}
      <Variant n="5" title="Plate + photograph" note="a real blank, bleeding off the right edge">
        <div className="relative flex items-center overflow-hidden rounded-xl bg-sidebar px-5 py-4 text-sidebar-foreground">
          <Greeting subTone="text-sidebar-foreground/60" figureTone="text-[#D4F897]" />
          {/* eslint-disable-next-line @next/next/no-img-element -- draft */}
          <img src="/ploy/blank/tee.webp" alt="" aria-hidden
               className="pointer-events-none absolute -right-4 top-0 hidden h-full w-[210px] scale-[1.35] object-cover object-[50%_18%] sm:block"
               style={{ maskImage: "linear-gradient(to right, transparent, #000 46%, #000 88%, transparent)", WebkitMaskImage: "linear-gradient(to right, transparent, #000 46%, #000 88%, transparent)" }} />
        </div>
      </Variant>

      {/* 6 — THE LETTER. The wordmark's own E, oversized and cropped by the band. No image
          to source, no render, and it is unmistakably ours. */}
      <Variant n="6" title="Plate + letterform" note="the wordmark's E, cropped by the band">
        <div className="relative flex items-center overflow-hidden rounded-xl bg-sidebar px-5 py-4 text-sidebar-foreground">
          <Greeting subTone="text-sidebar-foreground/60" figureTone="text-[#D4F897]" />
          <span aria-hidden className="pointer-events-none absolute -right-2 -top-6 hidden select-none font-title text-[132px] font-semibold leading-none tracking-tighter text-[#D4F897]/25 sm:block">E</span>
        </div>
      </Variant>
    </div>
  )
}

/* ── THE SHORTCUT TILES ─────────────────────────────────────────────────────
 * Four bare 22px outlines is exactly the shape §4 names: a loose stroke floating in
 * whitespace is read past. Four identical violet chips was tried and rejected for the
 * opposite reason. These three are what is left between the two. */
const SHORTCUTS = [
  { icon: Package, label: "Board", desc: "Artwork board" },
  { icon: Broadcast, label: "Broadcasts", desc: "Seller email" },
  { icon: Printer, label: "Orders", desc: "Production queue" },
  { icon: Storefront, label: "Products", desc: "Catalog + blanks" },
]

const TILE = "group flex min-h-[96px] flex-col items-start justify-center gap-2.5 rounded-lg border border-border p-4 transition-colors hover:border-primary/40 hover:bg-accent"

function Tiles() {
  return (
    <div className="space-y-6">
      {/* A — the mark sits in a MONOCHROME tile, filled weight. The tile is what makes it an
          object rather than a stroke; monochrome is what stops four of them being four
          coloured squares. */}
      <Variant n="A" title="Glyph in a tile" note="filled weight, monochrome ground — the §4 mark">
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-4">
          {SHORTCUTS.map(({ icon: Icon, label, desc }) => (
            <div key={label} className={TILE}>
              <span className="grid size-8 place-items-center rounded-md bg-foreground/10 text-foreground/75 transition-colors group-hover:bg-foreground group-hover:text-background">
                <Icon size={17} weight="fill" />
              </span>
              <span><span className="block text-base font-semibold leading-tight tracking-tight">{label}</span>
                <span className="mt-1 block text-sm leading-snug text-muted-foreground">{desc}</span></span>
            </div>
          ))}
        </div>
      </Variant>

      {/* B — no mark at all. The label is the mark; a lime rule carries the tile instead. */}
      <Variant n="B" title="No icon, a rule" note="the word is the mark · brand rule on hover">
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-4">
          {SHORTCUTS.map(({ label, desc }) => (
            <div key={label} className={TILE}>
              <span className="h-1 w-6 rounded-full bg-border transition-colors group-hover:bg-brand" />
              <span><span className="block text-base font-semibold leading-tight tracking-tight">{label}</span>
                <span className="mt-1 block text-sm leading-snug text-muted-foreground">{desc}</span></span>
            </div>
          ))}
        </div>
      </Variant>

      {/* C — the mark is a FIGURE. What is waiting on that surface, which is the only thing a
          launcher tile could say that the label does not. */}
      <Variant n="C" title="The count is the mark" note="what is waiting there, not a picture of it">
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-4">
          {SHORTCUTS.map(({ icon: Icon, label, desc }, i) => (
            <div key={label} className={TILE}>
              <span className="flex w-full items-center justify-between">
                <Icon size={18} weight="regular" className="text-muted-foreground" />
                <span className="text-lg font-semibold tabular-nums leading-none">{[14, 0, 26, 6][i]}</span>
              </span>
              <span><span className="block text-base font-semibold leading-tight tracking-tight">{label}</span>
                <span className="mt-1 block text-sm leading-snug text-muted-foreground">{desc}</span></span>
            </div>
          ))}
        </div>
      </Variant>
    </div>
  )
}

function Column({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? "dark" : ""}>
      <div data-skin="balloon" className="min-h-full bg-background px-6 py-6 text-foreground">
        <p className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{dark ? "Dark" : "Light"}</p>
        <div className="space-y-10">
          <Bands />
          <Tiles />
        </div>
      </div>
    </div>
  )
}

export default function DecorLab() {
  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-base font-semibold tracking-tight">Dashboard decoration — options</h1>
        <p className="text-sm text-muted-foreground">Six grounds for the greeting band, three for the shortcut tiles. Light and dark, same page.</p>
      </div>
      <div className="grid md:grid-cols-2">
        <Column dark={false} />
        <Column dark />
      </div>
    </main>
  )
}
