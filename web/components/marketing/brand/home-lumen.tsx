"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useMotionValueEvent, useReducedMotion } from "motion/react"
import type { SiteContent } from "@/lib/site-content"
import { ClipReveal, CountUp, Enter, useTrackProgress } from "@/components/marketing/brand/kit"
import { L, RADIUS, DISPLAY, DISPLAY_WEIGHT, DISPLAY_TRACKING, GROUNDS, DEFAULT_GROUND, type GroundKey } from "@/components/marketing/brand/lumen"

/**
 * ══ LUMEN ═════════════════════════════════════════════════════════════════════════════
 *
 * Light, violet-lettered, whisper-weight. The reference lock lives in lumen.ts.
 *
 * WHAT IS DELIBERATELY NOT BORROWED: Phantom's page is one card component restated a dozen
 * times, which is the thing that made it feel "one component". Every band below has its own
 * composition — a grid, a held frame, a scroll reveal, a list, a figure row — and none of
 * them share a wrapper.
 */

const F = "var(--font-archivo), system-ui, sans-serif"

/** Display type, one weight, three sizes. Nothing on this page is bold. */
function D({ children, size = DISPLAY.section, className = "", style, as: Tag = "div" }: {
  children: React.ReactNode; size?: string; className?: string
  style?: React.CSSProperties; as?: "h1" | "h2" | "h3" | "p" | "div"
}) {
  return (
    <Tag className={className} style={{
      fontFamily: F, fontWeight: DISPLAY_WEIGHT, fontSize: size,
      lineHeight: 0.98, letterSpacing: DISPLAY_TRACKING, textWrap: "balance", ...style,
    }}>{children}</Tag>
  )
}

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <span className="text-[12px] uppercase" style={{
    fontFamily: F, fontWeight: 500, letterSpacing: "0.16em", color: L.muted, ...style,
  }}>{children}</span>
}

function Pill({ href, children, tone = "primary" }: {
  href: string; children: React.ReactNode; tone?: "primary" | "ghost" | "dark"
}) {
  const s = tone === "primary"
    ? { background: L.mist, color: L.ink, boxShadow: `0 0 4px 0 ${L.mist}` }
    : tone === "dark" ? { background: L.char, color: L.paper }
    : { background: "transparent", color: L.ink, boxShadow: `inset 0 0 0 1px rgba(60,49,91,.16)` }
  return (
    <Link href={href}
      className="inline-flex items-center gap-2 whitespace-nowrap px-6 py-3.5 text-[15px] transition-transform duration-300 hover:-translate-y-0.5"
      style={{ ...s, borderRadius: RADIUS.button, fontFamily: F, fontWeight: 400 }}>
      {children}
    </Link>
  )
}

/**
 * ── THE LOOP ─────────────────────────────────────────────────────────────────────────
 * Phantom's actual mechanism, rebuilt: a short silent video that plays only while it is on
 * screen, over a poster frame. 26 videos against 2 images on their page, gated by 77
 * IntersectionObservers — no animation library anywhere.
 *
 * NO SOURCE IS A REAL STATE. With no `src` this renders the poster and nothing else, which
 * is the honest thing while the footage does not exist yet. It must never draw a fake play
 * button over a still and imply a demo we have not shot.
 */
function Loop({ src, poster, alt, ratio = "16 / 10", className = "" }: {
  src?: string; poster: string; alt: string; ratio?: string; className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || !src || reduce) return
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) el.play().catch(() => {}) ; else el.pause() },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [src, reduce])

  return (
    <div className={`relative overflow-hidden ${className}`}
      style={{ aspectRatio: ratio, borderRadius: RADIUS.block, background: "#F4F2F4" }}>
      {src ? (
        <video ref={ref} poster={poster} muted loop playsInline preload="metadata"
          className="h-full w-full object-cover object-left-top" aria-label={alt} />
      ) : (
        <Image src={poster} alt={alt} fill sizes="(max-width:1024px) 100vw, 50vw" className="object-cover object-left-top" />
      )}
    </div>
  )
}

/** The flatlay grid. Each garment on its own mist tile — the product IS the composition. */
const FLATLAY = [
  ["/frames/rail-tee-natural.webp", "Heavy cotton tee", "Natural"],
  ["/frames/rail-hoodie-charcoal.webp", "Fleece hoodie", "Charcoal"],
  ["/frames/rail-crew-sand.webp", "Crewneck", "Sand"],
  ["/frames/rail-tee-forest.webp", "Heavy cotton tee", "Forest"],
  ["/frames/rail-crew-ash.webp", "Crewneck", "Ash"],
  ["/frames/rail-tee-royal.webp", "Heavy cotton tee", "Royal"],
  ["/frames/rail-hoodie-navy.webp", "Fleece hoodie", "Navy"],
  ["/frames/rail-tee-light-pink.webp", "Heavy cotton tee", "Light pink"],
] as const

const TEE = [
  ["natural", "Natural"], ["sand", "Sand"], ["ash", "Ash"], ["sport-grey", "Sport grey"],
  ["charcoal", "Charcoal"], ["black", "Black"], ["navy", "Navy"], ["royal", "Royal"],
  ["forest", "Forest"], ["maroon", "Maroon"], ["gold", "Gold"], ["light-pink", "Light pink"],
] as const

const AUDIENCES = [
  ["Brands", "Drop a collection without a warehouse, a minimum, or a pallet of stock."],
  ["Teams", "One artwork, every size, shipped to individual addresses."],
  ["Creators", "Sell the thing your audience already asks you for."],
] as const

export function HomeLumen({ content, ground: groundKey = DEFAULT_GROUND }: { content: SiteContent; ground?: GroundKey }) {
  const { hero, features, stats, cta } = content
  const G = GROUNDS[groundKey] ?? GROUNDS[DEFAULT_GROUND]

  const swatch = useRef<HTMLDivElement>(null)
  const progress = useTrackProgress(swatch)
  const [tee, setTee] = useState(0)
  useMotionValueEvent(progress, "change", (v) => {
    setTee(Math.min(TEE.length - 1, Math.max(0, Math.round(v * (TEE.length - 1)))))
  })

  return (
    <div style={{ background: G.page, color: L.ink, fontFamily: F }}>

      {/* ── NAV ─────────────────────────────────────────────────────────────────────── */}
      <header className="relative z-40">
        <div className="mx-auto flex max-w-[86rem] items-center justify-between px-6 py-6 sm:px-10">
          <Link href="/" className="text-[19px]" style={{ fontWeight: 500, letterSpacing: "-0.02em" }}>EGFUL</Link>
          <nav className="hidden items-center gap-9 md:flex">
            {[["Products", "/catalog"], ["How it works", "/how-it-works"], ["Pricing", "/pricing"], ["Contact", "/contact"]].map(([l, h]) => (
              <Link key={h} href={h} className="text-[15px] transition-opacity hover:opacity-60">{l}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hidden text-[15px] transition-opacity hover:opacity-60 sm:block">Log in</Link>
            <Pill href="/signup">Start free</Pill>
          </div>
        </div>
      </header>

      {/* ══ 00 · HERO — BLOWN OUT, LIGHT, NO PHOTOGRAPH ══════════════════════════════
          The type is the hero. At weight 300 and 10.5vw it can be enormous without being
          loud, which is the whole trick — and it is why nothing else is needed here. */}
      <section className="px-6 pb-10 pt-[clamp(2rem,6vw,5rem)] sm:px-10">
        <div className="mx-auto max-w-[86rem]">
          <Enter from="none">
            <Label>Print on demand, fulfilled in house</Label>
          </Enter>
          <D as="h1" size={DISPLAY.hero} className="mt-6 max-w-[15ch]" style={{ lineHeight: 0.94 }}>
            Make merch that feels like a brand.
          </D>
          <div className="mt-10 flex flex-wrap items-end justify-between gap-x-12 gap-y-7">
            <p className="max-w-[42ch] text-[17px] leading-relaxed" style={{ color: L.muted }}>{hero.subhead}</p>
            <div className="flex items-center gap-3">
              <Pill href="/signup" tone="dark">{hero.ctaPrimary}</Pill>
              <Pill href="/how-it-works" tone="ghost">{hero.ctaSecondary}</Pill>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 01 · THE LOOP — Phantom's real mechanism ════════════════════════════════════
          A mist block holding one short silent loop. No source yet, so it renders its
          poster and says nothing it cannot back up. */}
      <section className="px-6 sm:px-10">
        <div className="mx-auto max-w-[86rem] p-6 sm:p-10" style={{ background: L.mist, borderRadius: RADIUS.block }}>
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div>
              <Label style={{ color: L.ink, opacity: 0.55 }}>01 — One queue</Label>
              <D as="h2" size={DISPLAY.block} className="mt-4 max-w-[16ch]">
                Every store’s orders arrive in one place.
              </D>
              <p className="mt-5 max-w-[40ch] text-[16px] leading-relaxed" style={{ color: L.ink, opacity: 0.66 }}>
                Etsy, Shopify and TikTok Shop sync on their own — artwork, size and address already attached.
              </p>
            </div>
            <Loop poster="/frames/shot-orders.webp" alt="The order queue, with orders from three marketplaces in one list" />
          </div>
        </div>
      </section>

      {/* ══ 02 · THE FLATLAY GRID ══════════════════════════════════════════════════════
          Eight garments, each on its own tile. The grid is the composition — no headline
          competing with it, and the captions are smaller than anything else on the page. */}
      <section className="px-6 py-[clamp(4rem,9vw,8rem)] sm:px-10">
        <div className="mx-auto max-w-[86rem]">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <Label>02 — The blanks</Label>
              <D as="h2" className="mt-4 max-w-[14ch]">Chosen, not catalogued.</D>
            </div>
            <Link href="/catalog" className="text-[15px] underline decoration-1 underline-offset-[6px] transition-opacity hover:opacity-60">
              See the full catalogue
            </Link>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {FLATLAY.map(([src, name, colour], i) => (
              <Enter key={src} from="up" delay={i * 0.04}>
                <div className="group overflow-hidden p-4" style={{ background: G.card, borderRadius: RADIUS.block }}>
                  <div className="relative w-full" style={{ aspectRatio: "3 / 4" }}>
                    <Image src={src} alt={`${name} in ${colour}`} fill sizes="(max-width:768px) 45vw, 21vw"
                      className="object-contain transition-transform duration-[800ms] ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-[1.04]" />
                  </div>
                  <div className="mt-3 flex items-baseline justify-between">
                    <span className="text-[13px]">{name}</span>
                    <span className="text-[12px]" style={{ color: L.muted }}>{colour}</span>
                  </div>
                </div>
              </Enter>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 03 · THE SCROLL REVEAL ═════════════════════════════════════════════════════
          One garment, twelve colours, changed by scroll position. Sticky, never pinned. */}
      <section ref={swatch} className="relative" style={{ height: "280svh" }}>
        <div className="sticky top-0 flex h-svh items-center overflow-hidden px-6 sm:px-10">
          <div className="mx-auto grid w-full max-w-[86rem] items-center gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,19rem)_minmax(0,24rem)_minmax(0,1fr)]">
            <div className="order-2 lg:order-1">
              <Label>03 — Twelve colourways</Label>
              <D as="h2" size={DISPLAY.block} className="mt-4">One standard.</D>
              <D size="clamp(2.4rem,5vw,4rem)" className="mt-8">{TEE[tee][1]}</D>
              <p className="mt-3 text-[13px] tabular-nums" style={{ color: L.muted }}>
                {String(tee + 1).padStart(2, "0")} / {TEE.length} · 240gsm garment-dyed
              </p>
              <div className="mt-5 h-[3px] w-full overflow-hidden" style={{ background: G.edge, borderRadius: 99 }}>
                <div className="h-full transition-[width] duration-[260ms] ease-out"
                  style={{ width: `${((tee + 1) / TEE.length) * 100}%`, background: L.grape }} />
              </div>
            </div>
            <div className="relative order-1 mx-auto w-full lg:order-2"
              style={{ aspectRatio: "574 / 820", maxHeight: "60svh" }}>
              {TEE.map(([slug, name], i) => (
                <Image key={slug} src={`/frames/rail-tee-${slug}.webp`} alt={i === tee ? `Tee in ${name}` : ""}
                  fill sizes="(max-width:1024px) 70vw, 24rem" priority={i === 0}
                  className="object-contain transition-opacity duration-[260ms] ease-out"
                  style={{ opacity: i === tee ? 1 : 0 }} />
              ))}
            </div>
            <ul className="order-3 hidden lg:block">
              {TEE.map(([slug, name], i) => (
                <li key={slug} className="flex items-center gap-3 py-[0.35rem]">
                  <span className="h-[2px] transition-all duration-[260ms] ease-out"
                    style={{ width: i === tee ? 28 : 12, background: i === tee ? L.grape : G.edge, borderRadius: 99 }} />
                  <span className="text-[13px] transition-opacity duration-[260ms]"
                    style={{ opacity: i === tee ? 1 : 0.4 }}>{name}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ══ 04 · THE FULL-BLEED WORD — the one Bōjka moment ════════════════════════════
          Grape, edge to edge, and the type gets bigger than anywhere else on the page. */}
      <section className="px-6 sm:px-10">
        <div className="mx-auto max-w-[86rem] px-6 py-[clamp(4rem,10vw,8rem)] sm:px-12"
          style={{ background: L.grape, borderRadius: RADIUS.block }}>
          <ClipReveal as="h2" lines={["We are the factory,", "not the middle of one."]}
            size={DISPLAY.section} width={92} weight={DISPLAY_WEIGHT} leading={0.98}
            tracking={DISPLAY_TRACKING} className="max-w-[16ch]" style={{ color: L.ink }} />
          <div className="mt-12 grid gap-x-10 gap-y-8 md:grid-cols-3">
            {features.cards.slice(0, 3).map((c, i) => (
              <Enter key={c.title} from="up" delay={i * 0.07}>
                <span className="text-[13px] tabular-nums" style={{ color: L.ink, opacity: 0.5 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <D as="h3" size="1.15rem" className="mt-2" style={{ fontWeight: 400, lineHeight: 1.2 }}>{c.title}</D>
                <p className="mt-2.5 text-[15px] leading-relaxed" style={{ color: L.ink, opacity: 0.7 }}>{c.body}</p>
              </Enter>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 05 · WHO IT IS FOR — the one inverted card ═════════════════════════════════ */}
      <section className="px-6 py-[clamp(4rem,9vw,8rem)] sm:px-10">
        <div className="mx-auto max-w-[86rem] p-6 sm:p-12" style={{ background: L.char, borderRadius: RADIUS.block }}>
          <Label style={{ color: L.paper, opacity: 0.5 }}>05 — Who it is for</Label>
          <div className="mt-10 grid gap-x-10 gap-y-10 md:grid-cols-3">
            {AUDIENCES.map(([k, b], i) => (
              <Enter key={k} from="up" delay={i * 0.08}>
                <D as="h3" size="clamp(1.8rem,3.4vw,2.6rem)" style={{ color: L.paper }}>{k}</D>
                <p className="mt-4 max-w-[34ch] text-[15px] leading-relaxed" style={{ color: L.paper, opacity: 0.62 }}>{b}</p>
              </Enter>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 06 · THE FIGURES ══════════════════════════════════════════════════════════ */}
      <section className="px-6 pb-[clamp(4rem,9vw,8rem)] sm:px-10">
        <div className="mx-auto grid max-w-[86rem] gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {stats.slice(0, 4).map((s, i) => (
            <Enter key={s.label} from="up" delay={i * 0.06} className="pt-6"
              style={{ borderTop: `1px solid ${G.edge}` }}>
              <D size="clamp(3rem,6vw,5rem)" style={{ color: i === 0 ? L.grape : L.ink }}>
                <CountUp value={s.value} />
              </D>
              <span className="mt-4 block text-[15px]">{s.label}</span>
              {s.note ? <span className="mt-1 block text-[13px]" style={{ color: L.muted }}>{s.note}</span> : null}
            </Enter>
          ))}
        </div>
      </section>

      {/* ══ 07 · THE CLOSE — the single dark band ══════════════════════════════════════ */}
      <section className="px-6 pb-10 sm:px-10">
        <div className="mx-auto max-w-[86rem] px-6 py-[clamp(4rem,11vw,9rem)] text-center sm:px-12"
          style={{ background: L.deep, borderRadius: RADIUS.block }}>
          <D as="h2" size={DISPLAY.section} className="mx-auto max-w-[18ch]" style={{ color: L.paper }}>
            {cta.heading}
          </D>
          <p className="mx-auto mt-6 max-w-[40ch] text-[16px] leading-relaxed" style={{ color: L.paper, opacity: 0.6 }}>
            {cta.subhead}
          </p>
          <div className="mt-10 flex justify-center">
            <Pill href="/signup">{cta.button}</Pill>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────────────────── */}
      <footer className="px-6 pb-14 pt-6 sm:px-10">
        <div className="mx-auto flex max-w-[86rem] flex-wrap items-center justify-between gap-4 pt-6 text-[13px]"
          style={{ borderTop: `1px solid ${G.edge}`, color: L.muted }}>
          <span>© {new Date().getFullYear()} EGFUL</span>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            {[["Catalogue", "/catalog"], ["Pricing", "/pricing"], ["API", "/docs"], ["Contact", "/contact"], ["Privacy", "/privacy"]].map(([l, h]) => (
              <Link key={h} href={h} className="transition-opacity hover:opacity-60">{l}</Link>
            ))}
          </nav>
          <span>Made, not sourced.</span>
        </div>
      </footer>
    </div>
  )
}
