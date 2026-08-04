"use client"

import Link from "next/link"
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
export const ACCENT = "#D4F897"
export const INK = "#0B0B0C"

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
 * The accent phrase, underlined in white — a RULE, not a slab.
 *
 * A filled white block behind the phrase read as a sticker pasted over the plate: it fought
 * the type it was meant to serve and put a hard rectangle through a page whose whole idea is
 * open space. The rule keeps white as an accent and lets the headline read straight through.
 *
 * It draws left-to-right AFTER the words have risen, so it underlines a finished sentence
 * rather than sliding in alongside it.
 */
export function HighlightPhrase({ text, delay = 0 }: { text: string; delay?: number }) {
  const reduce = useReducedMotion()
  return (
    <span className="relative inline-block align-bottom">
      <span className="relative" style={{ color: INK }}>
        <MaskedWords text={text} delay={delay} />
      </span>
      <motion.span
        aria-hidden
        className="absolute -bottom-[0.06em] left-0 right-0 origin-left rounded-full"
        style={{ height: "0.11em", background: "#FFFFFF" }}
        initial={reduce ? { opacity: 0 } : { scaleX: 0 }}
        whileInView={reduce ? { opacity: 1 } : { scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: delay + 0.35, ease: EASE }}
      />
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
  return (
    <section className="relative -mt-16 pt-16" style={{ background: ACCENT }}>
      <div className="absolute inset-x-0 bottom-0 h-24 bg-white [clip-path:polygon(0_100%,100%_0,100%_100%)]" aria-hidden />
      <div className="mx-auto max-w-6xl px-6 pb-28 pt-20 sm:pt-28">
        <h1 className="mx-auto max-w-5xl text-center font-black leading-[0.92] tracking-[-0.04em] text-[#0B0B0C]" style={DISPLAY}>
          <MaskedWords text={title} />{accent ? <> <HighlightPhrase text={accent} delay={0.28} /></> : null}
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
