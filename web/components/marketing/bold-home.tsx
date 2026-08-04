"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { motion, useInView, useReducedMotion, useScroll, useSpring, useTransform, animate } from "motion/react"
import { ArrowUpRight, PlugsConnected, Printer, Truck, Wallet } from "@phosphor-icons/react"
import type { SiteContent } from "@/lib/site-content"

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
/**
 * ONE accent, one value — #D4F897, chosen by eye against the real page.
 *
 * This replaces a two-step split (a lighter value for full-bleed fields, a deeper one for
 * small marks) that existed because a large field reads duller than a small mark of the same
 * colour. That effect is real, but it was solving for a deeper base; at this value the plate
 * already reads bright, so the split bought nothing except two things to keep in sync.
 *
 * Black on it is ~17:1, so it carries real type anywhere it appears.
 */
const ACCENT = "#D4F897"
const INK = "#0B0B0C"

/** Words rise out of a mask, one after another. The mask is what makes it read as
 *  typesetting rather than a fade — letters emerge from an edge instead of materialising. */
function MaskedWords({ text, className = "", delay = 0 }: { text: string; className?: string; delay?: number }) {
  const reduce = useReducedMotion()
  const words = text.split(" ").filter(Boolean)
  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <motion.span
            className="inline-block"
            initial={reduce ? { opacity: 0 } : { y: "110%" }}
            animate={reduce ? { opacity: 1 } : { y: "0%" }}
            transition={reduce ? { duration: 0.3, delay } : { duration: 0.75, delay: delay + i * 0.055, ease: [0.16, 1, 0.3, 1] }}
          >
            {w}
          </motion.span>
          {i < words.length - 1 && <span>&nbsp;</span>}
        </span>
      ))}
    </span>
  )
}

/**
 * The accent phrase in ONE highlight, not one per word.
 *
 * Boxing each word separately gave "printed" and "itself?" a block each — two competing
 * marks where the sentence has one idea, and the gap between them broke the phrase in half.
 * A single plate behind the whole phrase reads as one emphasis.
 *
 * The plate wipes open from the left before the words rise through it, so the highlight looks
 * drawn under the text rather than pasted behind it.
 */
function HighlightPhrase({ text, delay = 0 }: { text: string; delay?: number }) {
  const reduce = useReducedMotion()
  return (
    <span className="relative inline-block px-[0.18em] align-bottom">
      <motion.span
        aria-hidden
        className="absolute inset-0 origin-left"
        style={{ background: "#FFFFFF" }}
        initial={reduce ? { opacity: 0 } : { scaleX: 0 }}
        animate={reduce ? { opacity: 1 } : { scaleX: 1 }}
        transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      />
      <span className="relative" style={{ color: INK }}>
        <MaskedWords text={text} delay={delay + 0.18} />
      </span>
    </span>
  )
}

/** A number that counts to its value once, when it first arrives. Reads as the figure
 *  settling rather than a slot machine — no loop, no re-run on scroll-back. */
function CountUp({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" })
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(value)
  // Split the numeric core from whatever wraps it ("2,400+", "$1.2M", "99.9%") so the
  // prefix/suffix survive — animating the whole string would print nonsense mid-flight.
  const m = /^([^\d]*)([\d.,]+)(.*)$/.exec(value)
  useEffect(() => {
    if (!inView || reduce || !m) return
    const target = Number(m[2].replace(/,/g, ""))
    if (!Number.isFinite(target)) return
    const dp = (m[2].split(".")[1] ?? "").length
    const controls = animate(0, target, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(`${m[1]}${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}${m[3]}`),
    })
    return () => controls.stop()
  }, [inView, reduce, m])
  return <span ref={ref} className={className}>{m ? shown : value}</span>
}

/** Pill button. The arrow travels on hover — a 200ms cue that the thing goes somewhere,
 *  which is the whole reason the arrow is there. */
function Pill({ href, children, tone = "ink" }: { href: string; children: React.ReactNode; tone?: "ink" | "lime" | "ghost" }) {
  const base = "group inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-[15px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
  const tones = {
    ink: "bg-[#0B0B0C] text-white hover:bg-[#26262a] focus-visible:ring-[#0B0B0C]",
    lime: "text-[#0B0B0C] hover:brightness-95 focus-visible:ring-[#0B0B0C]",
    ghost: "border border-[#0B0B0C]/15 text-[#0B0B0C] hover:border-[#0B0B0C]/40 hover:bg-[#0B0B0C]/[0.03] focus-visible:ring-[#0B0B0C]",
  }
  return (
    <Link href={href} className={`${base} ${tones[tone]}`} style={tone === "lime" ? { background: ACCENT } : undefined}>
      {children}
      <ArrowUpRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </Link>
  )
}

const ICONS = [PlugsConnected, Printer, Wallet, Truck]

export function BoldHome({ content }: { content: SiteContent }) {
  const { hero, stats, features, steps, cta } = content
  const reduce = useReducedMotion()
  const heroRef = useRef<HTMLDivElement>(null)

  // Scroll-linked parallax on the product panel. Spring-smoothed so it trails the scroll
  // slightly instead of tracking it rigidly — that lag is what reads as depth.
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] })
  const smooth = useSpring(scrollYProgress, { stiffness: 90, damping: 26, mass: 0.4 })
  const panelY = useTransform(smooth, [0, 1], [0, -70])
  const panelScale = useTransform(smooth, [0, 1], [1, 0.94])

  return (
    <div className="bg-white text-[#0B0B0C]">
      {/* ── HERO ───────────────────────────────────────────────────────────────── */}
      {/* NOT overflow-hidden. The product panel deliberately hangs past the plate's bottom
          edge — that overhang is the depth — and clipping the section amputated it to a strip
          of window chrome. The diagonal below does its own clipping via clip-path, so the
          section never needed to clip anything. */}
      {/* -mt-16 pt-16 pulls the plate UP behind the sticky 4rem header, so the colour starts
          at the top of the window instead of under a white bar. The header itself goes
          transparent on this route (site-header.tsx) — between them, the hero reads as one
          full-bleed plate with the nav sitting on it. */}
      <section ref={heroRef} className="relative -mt-16 pt-16" style={{ background: ACCENT }}>
        {/* The plate is cut on a diagonal rather than a straight edge — one shape doing the
            job a whole illustration usually does. */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-white [clip-path:polygon(0_100%,100%_0,100%_100%)]" aria-hidden />

        <div className="mx-auto max-w-6xl px-6 pb-40 pt-24 sm:pt-32">
          <h1 className="max-w-5xl text-center font-black leading-[0.92] tracking-[-0.04em] text-[#0B0B0C] mx-auto"
              style={{ fontSize: "clamp(2.6rem, 7.2vw, 6.2rem)" }}>
            <MaskedWords text={hero.headline} />{" "}
            <HighlightPhrase text={hero.accent} delay={0.28} />
          </h1>

          <motion.p
            className="mx-auto mt-7 max-w-xl text-center text-[17px] leading-relaxed text-[#0B0B0C]/70"
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
            <Pill href="/signup" tone="ink">{hero.ctaPrimary}</Pill>
            <Pill href="/how-it-works" tone="ghost">{hero.ctaSecondary}</Pill>
          </motion.div>
        </div>

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
            <div className="mb-3 rounded-xl border border-black/[0.07] bg-[#FAFAF9] p-4">
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
                  className="rounded-xl border border-black/[0.07] bg-[#FAFAF9] p-4"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.65 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-black/45">{s.label}</div>
                  <CountUp value={s.value} className="mt-1.5 block text-2xl font-black tracking-tight" />
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
                <CountUp value={stats[3].value} className="mt-1 block text-xl font-black tracking-tight" />
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
      </section>

      {/* ── WORKS WITH — a marquee, paused for reduced-motion ──────────────────── */}
      <section className="overflow-hidden border-y border-black/[0.07] bg-white py-6 pt-36">
        <div className="mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-black/40">{hero.worksWithLabel}</div>
        <div className="relative flex overflow-hidden">
          <motion.div
            className="flex shrink-0 gap-12 pr-12"
            animate={reduce ? undefined : { x: ["0%", "-50%"] }}
            transition={{ duration: 22, ease: "linear", repeat: Infinity }}
          >
            {[...hero.integrations, ...hero.integrations].map((name, i) => (
              <span key={`${name}-${i}`} className="whitespace-nowrap text-2xl font-black tracking-tight text-black/25">{name}</span>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-28">
        <h2 className="max-w-3xl font-black leading-[0.95] tracking-[-0.035em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
          {features.heading}
        </h2>
        <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-black/55">{features.subhead}</p>

        <div className="mt-14 grid gap-4 md:grid-cols-2">
          {features.cards.slice(0, 4).map((c, i) => {
            const Icon = ICONS[i % ICONS.length]
            return (
              <motion.div
                key={c.title}
                className="group relative overflow-hidden rounded-2xl border border-black/[0.09] bg-white p-8 transition-colors duration-200 hover:border-black/25"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "0px 0px -12% 0px" }}
                transition={{ duration: 0.55, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* The accent arrives on hover as a wipe from the corner — motion that
                    tells you the card is interactive, not decoration that always runs. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
                  style={{ background: ACCENT }}
                />
                <Icon size={26} weight="duotone" className="relative text-[#0B0B0C]" />
                <h3 className="relative mt-6 text-xl font-bold tracking-tight">{c.title}</h3>
                <p className="relative mt-2 text-[15px] leading-relaxed text-black/55">{c.body}</p>
              </motion.div>
            )
          })}
        </div>
      </section>

      {/* ── STEPS — numbers oversized, the way the style wants ──────────────────── */}
      <section className="border-y border-black/[0.07] bg-[#FAFAF9] py-28">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="font-black leading-[0.95] tracking-[-0.035em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
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
                <div className="font-black leading-none tracking-tighter text-black/[0.13]" style={{ fontSize: "clamp(3.5rem, 7vw, 5.5rem)" }}>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="mt-3 text-xl font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-black/55">{s.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────────── */}
      <section className="px-6 py-24">
        <motion.div
          className="mx-auto max-w-5xl overflow-hidden rounded-3xl px-8 py-20 text-center"
          style={{ background: ACCENT }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "0px 0px -10% 0px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="mx-auto max-w-3xl font-black leading-[0.95] tracking-[-0.035em] text-[#0B0B0C]" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
            {cta.heading}
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[17px] leading-relaxed text-[#0B0B0C]/65">{cta.subhead}</p>
          <div className="mt-9 flex justify-center">
            <Pill href="/signup" tone="ink">{cta.button}</Pill>
          </div>
        </motion.div>
      </section>
    </div>
  )
}
