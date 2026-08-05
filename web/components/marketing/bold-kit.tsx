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
// A step deeper than #C3D0FF, which read washed out at full-bleed size. Ink on it is
// 10.13:1, so the headline stays comfortable.
//
// NB: this plate cannot carry CREAM lettering. Measured across the ramp, cream only reaches
// 4.5:1 from about #4259D6 downward — at any "light periwinkle" value it sits near 1.6:1,
// i.e. invisible. Light plate + ink type, or deep plate + cream type; there is no light plate
// with cream type.
// COOLER, same lightness. #5C6CD6 sat at a violet hue that read warm at full-bleed size;
// this is the same brightness pulled toward true blue. Held at hue 229 so it is the SAME
// family as PLATE_DEEP (234) — an accent 17° off the plate reads as two unrelated blues on
// one page, which is what a mixed set of hand-picked hexes always looks like.
//
// Cream measures 5.10:1 here, so the CTA bands that use this as a fill carry cream lettering
// as real readable type, not as a ghost.
export const ACCENT = "#4560D4"        // blue — the plate/fill
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
export const ACCENT_INK = "#FAF8F3"
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

/**
 * PAPER LETTERING ON THE PLATE — a deliberate, decorative-only exception.
 *
 * Paper on #A5B7FF measures 1.83:1. That is far below the 3:1 floor for large text, so it is
 * NOT readable type: it reads as a soft ghost of the word, the way a watermark does. Used
 * knowingly for effect, that can be lovely; used for a word the reader actually needs, it is
 * simply text nobody can read.
 *
 * So the rule is: never the only place a fact appears, and never a word the page depends on.
 * If a phrase must be READ on the plate, it takes INK (10.13:1). If you want cream to carry
 * real words, the plate has to come down to about #4259D6, where cream reaches 5.45:1 — light
 * plate and readable cream cannot both be true.
 */
export const PLATE_GHOST = SURFACE

/**
 * The accent word on the plate — a DEEPER shade of the plate's own hue.
 *
 * The instinct on a bright background is a lighter accent, and it cannot work: #A5B7FF sits
 * at L* 75.5, so it IS the light colour. Cream measures 1.83:1 on it and pure white only
 * 1.94:1 — white is not the fix, because the problem is the plate's lightness, not which pale
 * tone sits on it. Bright plate takes dark type; light type needs a dark plate. Not both.
 *
 * #1E2A78 is 6.53:1 here — comfortably past the 4.5:1 body-text floor, so it is real readable
 * type rather than a decorative ghost. Same hue family as the plate, which is what makes it
 * read as a deliberate accent instead of an unrelated colour dropped in.
 *
 * A drop shadow was considered and rejected: it changes no measured contrast, and a blur
 * behind font-display font-bold display type reads as a smudge. If cream must be kept, the only version
 * that works is a HARD zero-blur ink offset — a deliberate letterpress style, not a patch.
 */
export const PLATE_ACCENT = '#1E2A78'

/**
 * THE DEEP PLATE — the home hero only.
 *
 * A bright plate can never carry light lettering: #A5B7FF is L* 75.5, so cream lands at
 * 1.83:1 and white at 1.94:1. Going deep is the only way to get white type, and it is what
 * every reference in this style actually does.
 *
 * COOLER than the first deep plate. #5B3FE8 sat at hue 250 — a violet, which at full-bleed
 * size reads warm and slightly dated. This is the same lightness and saturation rotated to
 * hue 234, a true blue-indigo: cream 5.31:1, white 5.63:1, acid 4.35:1. Every one of those
 * still clears the floor, so the type decisions below are unchanged by the rotation.
 *
 * Deliberately NOT a change to ACCENT. That token is used 21 times across the marketing
 * pages, several of them as a light band with INK text on top — swapping it wholesale would
 * silently invert those to dark-on-dark. ACCENT stays the pastel band; this is the hero
 * plate. Unifying the two is a per-page pass, not a token rename.
 */
export const PLATE_DEEP = '#4454EC'

/**
 * The one loud accent — acid green, the single hot colour in an otherwise two-tone page.
 *
 * 4.35:1 on the deep plate, so it reads as type rather than as a glow. As a FILL it only ever
 * takes ink: black on it is 15.19:1, white is 1.30:1 and fails outright — acid green is a
 * light colour, so the same light-plate/dark-type rule applies to it as to the pastel.
 */
export const ACID = '#C6F24E'

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
/** `color` overrides the ink. The hero sets it to the paper tone so the phrase reads as
 *  cut OUT of the periwinkle plate rather than printed on top of it. */
export function TypedPhrase({ text, color = ACCENT_INK, lastWordColor }: { text: string; color?: string; lastWordColor?: string }) {
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
      <span className="col-start-1 row-start-1 whitespace-pre text-left" style={{ color }}>
        {/* The split point comes from the FULL phrase, not from what has been typed so far.
            Taken from the typed text, "printed" would render in the tail colour until the
            space arrived and then snap to ink — a visible flicker on every loop. */}
        {(() => {
          const rendered = reduce || phrases.length < 2 ? (phrases[0] ?? "") : shown
          if (!lastWordColor) return rendered
          const full = phrases[idx % phrases.length] ?? phrases[0] ?? ""
          const cut = full.lastIndexOf(" ")
          const splitAt = cut >= 0 ? cut + 1 : 0
          return (
            <>
              {rendered.slice(0, Math.min(rendered.length, splitAt))}
              {rendered.length > splitAt && (
                <span style={{ color: lastWordColor }}>{rendered.slice(splitAt)}</span>
              )}
            </>
          )
        })()}
        {!reduce && phrases.length > 1 && (
          <motion.span
            aria-hidden
            className="ml-[0.06em] inline-block w-[0.055em] align-baseline"
            style={{ background: color, height: "0.78em" }}
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
  href: string; children: React.ReactNode; tone?: "ink" | "accent" | "acid" | "ghost" | "ghostLight"; className?: string
}) {
  const base = "group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[15px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
  const tones = {
    ink: "bg-[#0B0B0C] text-[#FAF8F3] hover:bg-[#26262a] focus-visible:ring-[#0B0B0C]",
    accent: "text-[#0B0B0C] hover:brightness-95 focus-visible:ring-[#0B0B0C]",
    // Ink on acid is 15.19:1. White on acid is 1.30:1 — never do that.
    acid: "text-[#0B0B0C] hover:brightness-95 focus-visible:ring-[#0B0B0C]",
    ghost: "border border-[#FAF8F3]/35 text-[#FAF8F3] hover:border-[#FAF8F3]/70 hover:bg-[#FAF8F3]/10 focus-visible:ring-[#FAF8F3]",
    // The ghost outline inverted, for use ON the deep plate where ink would disappear.
    ghostLight: "border border-[#FAF8F3]/30 text-[#FAF8F3] hover:border-[#FAF8F3]/60 hover:bg-[#FAF8F3]/10 focus-visible:ring-[#FAF8F3]",
  }
  return (
    <Link href={href} className={`${base} ${tones[tone]} ${className}`} style={tone === "accent" ? { background: ACCENT } : tone === "acid" ? { background: ACID } : undefined}>
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
  // THE DEEP PLATE, carrying cream lettering — the same banner the home hero uses, so an
  // interior page reads as the same site rather than a different one.
  //
  // This previously set the section background to SURFACE while leaving the h1 at
  // `color: SURFACE`, i.e. cream lettering on cream paper. Every interior hero rendered as a
  // ~380px band of nothing — not a subtle contrast failure but literally invisible type, and
  // the reason all four pages looked like they had blank space at the top. A colour pair is
  // only safe when both halves move together; changing one is what produced this.
  //
  // Cream on #4454EC is 5.31:1 and the acid accent is 4.35:1 — both real readable type.
  return (
    <section className="relative -mt-16 pt-16" style={{ background: PLATE_DEEP }}>
      <div className="mx-auto max-w-6xl px-6 pb-20 pt-14 sm:pt-20">
        <h1 className="mx-auto max-w-5xl text-center font-display font-bold leading-[0.92] tracking-[-0.04em]" style={{ ...DISPLAY, color: SURFACE }}>
          <MaskedWords text={title} />{accent ? <> <TypedPhrase text={accent} color={ACID} /></> : null}
        </h1>
        {sub && (
          <motion.p
            className="mx-auto mt-7 max-w-xl text-center text-[17px] leading-relaxed"
            style={{ color: "rgba(250,248,243,0.8)" }}
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
