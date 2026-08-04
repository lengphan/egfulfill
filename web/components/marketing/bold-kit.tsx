"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { ArrowUpRight } from "@phosphor-icons/react"

/**
 * The marketing style kit — every primitive the bold pages share.
 *
 * It lives here rather than in whichever page happened to need it first, because the moment a
 * second page copies "the accent" or "the pill" the two start drifting: one gets a hover fix,
 * the other doesn't, and the site quietly stops being one design. See CLAUDE.md §4.
 *
 * "Exaggerated Minimalism": black and white carry the page, ONE accent, and type does the work
 * decoration usually does. Black on the accent is ~17:1, so it can hold real text anywhere.
 */
export const ACCENT = "#C3D0FF"        // periwinkle — the plate/fill
// The accent phrase is INK, like the rest of the headline — no second type colour.
//
// A dark purple on a light purple plate is a tint of the background wearing itself as
// foreground: it reads muddy and slightly dated, because the eye sees one hue at two
// strengths rather than a decision. Modern display typography in this style carries ONE ink
// colour and lets the plate be the colour — the headline stays a single confident voice and
// the periwinkle does the shouting.
//
// The typed phrase still reads as distinct because it MOVES: it types, holds and rewrites
// itself. Motion is the differentiator, which is a stronger one than a hue nobody can name.
export const ACCENT_INK = "#0B0B0C"
export const INK = "#0B0B0C"
// WARM PAPER, under a cool periwinkle banner. Chosen deliberately, not by default.
//
// It was briefly swapped to a cool off-white because a warm page under a cool accent puts two
// temperatures on one screen. That IS the tension — but it's the tension the look is built on:
// the banner reads modern, the page reads printed, and the contrast between them is the point
// rather than a mistake. The earlier version failed because the warm tone was carrying a
// purple hero as well; now the purple has its own plate and the paper is only ever the page.
//
// Both letterings clear it comfortably: ink 18.54:1, the accent purple 13.11:1.
export const SURFACE = "#FAF8F3"

/** The one type ramp. Sections use HEADING, heroes use DISPLAY — pages don't invent sizes. */
export const DISPLAY = { fontSize: "clamp(2.6rem, 7.2vw, 6.2rem)" } as const
export const HEADING = { fontSize: "clamp(2rem, 4.6vw, 3.6rem)" } as const
export const EASE = [0.16, 1, 0.3, 1] as const

/** Words rise out of a mask, one after another. The mask is what makes it read as typesetting
 *  rather than a fade — letters emerge from an edge instead of materialising. */
export function MaskedWords({ text, className = "", delay = 0 }: { text: string; className?: string; delay?: number }) {
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
            transition={reduce ? { duration: 0.3, delay } : { duration: 0.75, delay: delay + i * 0.055, ease: EASE }}
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
 * The accent phrase, TYPED — and coloured rather than underlined.
 *
 * Both earlier treatments (a white slab, then a white rule) existed for one reason: white on
 * this plate measures 1.52:1, so it could never carry the words itself and needed a shape to
 * sit on. Deep indigo on periwinkle is 9.13:1 — the phrase can simply BE a second colour, and
 * the device disappears.
 *
 * It types itself, holds, backspaces, and moves to the next phrase: the page reads as
 * thinking rather than decorating, and one headline gets to ask several questions.
 *
 * The phrases come from the SAME stored copy field, split on "|" — an admin writes
 * "printed itself?|shipped itself?|packed itself?" in Settings › Site content and gets a
 * rotation, with no schema change and no new field to explain. One phrase and it renders
 * statically.
 *
 * Under reduced-motion it prints the first phrase and stops — a caret blinking forever is
 * exactly the perpetual motion that setting exists to remove.
 */
export function TypedPhrase({ text }: { text: string }) {
  const reduce = useReducedMotion()
  const phrases = text.split("|").map((t) => t.trim()).filter(Boolean)
  const [shown, setShown] = useState(phrases[0] ?? "")
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<"type" | "hold" | "erase">("type")

  useEffect(() => {
    if (reduce || phrases.length < 2) return
    const full = phrases[idx % phrases.length]
    let t: ReturnType<typeof setTimeout>
    if (phase === "type") {
      t = shown.length < full.length
        ? setTimeout(() => setShown(full.slice(0, shown.length + 1)), 55)
        : setTimeout(() => setPhase("hold"), 0)
    } else if (phase === "hold") {
      t = setTimeout(() => setPhase("erase"), 1800)
    } else {
      t = shown.length > 0
        ? setTimeout(() => setShown(full.slice(0, shown.length - 1)), 28)
        : setTimeout(() => { setIdx((i) => i + 1); setPhase("type") }, 120)
    }
    return () => clearTimeout(t)
  }, [shown, phase, idx, reduce, phrases])

  // Reserve the LONGEST phrase's width so nothing below jumps as it types. A headline that
  // reflows on every keystroke drags the whole page with it.
  const longest = phrases.reduce((a, b) => (b.length > a.length ? b : a), "")
  return (
    <span className="relative inline-grid align-bottom">
      <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre">{longest}</span>
      <span className="col-start-1 row-start-1 whitespace-pre text-left" style={{ color: ACCENT_INK }}>
        {reduce || phrases.length < 2 ? phrases[0] : shown}
        {!reduce && phrases.length > 1 && (
          <motion.span
            aria-hidden
            className="ml-[0.06em] inline-block w-[0.055em] align-baseline"
            style={{ background: ACCENT_INK, height: "0.78em" }}
            animate={{ opacity: [1, 1, 0, 0] }}
            transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: "linear" }}
          />
        )}
      </span>
    </span>
  )
}

/** Pill button. The arrow travels on hover — a 200ms cue that the thing goes somewhere,
 *  which is the whole reason the arrow is there. */
export function Pill({ href, children, tone = "ink", className = "" }: {
  href: string; children: React.ReactNode; tone?: "ink" | "accent" | "ghost"; className?: string
}) {
  const base = "group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[15px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
  const tones = {
    ink: "bg-[#0B0B0C] text-white hover:bg-[#26262a] focus-visible:ring-[#0B0B0C]",
    accent: "text-[#0B0B0C] hover:brightness-95 focus-visible:ring-[#0B0B0C]",
    ghost: "border border-[#0B0B0C]/15 text-[#0B0B0C] hover:border-[#0B0B0C]/40 hover:bg-[#0B0B0C]/[0.03] focus-visible:ring-[#0B0B0C]",
  }
  return (
    <Link href={href} className={`${base} ${tones[tone]} ${className}`} style={tone === "accent" ? { background: ACCENT } : undefined}>
      {children}
      <ArrowUpRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </Link>
  )
}

/** Scroll-entrance for a block. One definition so every section on every page arrives the
 *  same way — and so "does it respect reduced motion" is answered once. */
export function Rise({ children, delay = 0, className = "", style }: {
  children: React.ReactNode; delay?: number; className?: string; style?: React.CSSProperties
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      style={style}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.55, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

/**
 * The full-bleed accent plate every bold page opens with.
 *
 * -mt-16 pt-16 pulls it up behind the sticky 4rem header so the colour starts at the top of
 * the window; the header goes transparent on these routes (site-header.tsx). Add the route to
 * PLATE_ROUTES there or the header will sit on a white bar above the plate.
 */
export function PlateHero({ title, accent, sub, children }: {
  title: string; accent?: string; sub?: string; children?: React.ReactNode
}) {
  const reduce = useReducedMotion()
  // SURFACE, not a colour plate. A periwinkle field with periwinkle lettering on it is
  // purple-on-purple: the accent has nothing to contrast against and stops being an accent.
  // Paper carries the page; the colour appears in the ONE phrase, the CTA band and the chart,
  // which is what makes those read as chosen.
  return (
    <section className="relative -mt-16 pt-16" style={{ background: SURFACE }}>
      <div className="mx-auto max-w-6xl px-6 pb-28 pt-20 sm:pt-28">
        <h1 className="mx-auto max-w-5xl text-center font-black leading-[0.92] tracking-[-0.04em] text-[#0B0B0C]" style={DISPLAY}>
          <MaskedWords text={title} />{accent ? <> <TypedPhrase text={accent} /></> : null}
        </h1>
        {sub && (
          <motion.p
            className="mx-auto mt-7 max-w-xl text-center text-[17px] leading-relaxed text-[#0B0B0C]/70"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35, ease: EASE }}
          >
            {sub}
          </motion.p>
        )}
        {children}
      </div>
    </section>
  )
}
