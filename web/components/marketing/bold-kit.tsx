"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { ArrowUpRight } from "@phosphor-icons/react"
import { entrance, type PresetName } from "@/lib/motion"
import { isVideoSrc } from "@/lib/media"
import { useMotionPreset } from "./motion-provider"
import { EditableText, useEditMode } from "@/components/marketing/edit-mode"

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
// ONE value with PLATE_DEEP, not a sibling of it. Every previous version kept the CTA bands
// a step off the hero plate, and every time the plate moved the two drifted into "two blues
// that are almost the same", which is the exact thing that reads as an unconsidered palette.
// The bands and the plate are now the same electric violet.
//
// Paper measures 5.68:1 on it, so the bands carry cream lettering as real readable type.
/**
 * ── EVERY COLOUR BELOW IS NOW A VARIABLE, NOT A VALUE ────────────────────────────────────
 *
 * They were thirteen hex literals in this file, imported by thirteen other files and written
 * into ~150 inline `style` objects. That is a good structure — §4's "import from the kit,
 * never re-declare a colour in a page" is exactly why changing the site's palette is a
 * one-file job rather than a sweep. But a hex compiled into JSX can only be changed by
 * editing and deploying, and the ask was for the palette to be movable NOW, on a running
 * site, without a code change reaching anywhere near live data.
 *
 * So each constant holds a `var()` reference instead of the digits. Nothing at a call site
 * changes — `style={{ background: SURFACE }}` is still valid, because a CSS variable is a
 * legal inline style value — and the VALUES move to globals.css under `[data-skin]`, beside
 * the app's own tokens, where an admin's choice can reach them.
 *
 * The measurements in the notes below belong to the PRESS skin, which is what these literals
 * used to be. Each skin carries its own, checked by `node tools/check-skins.mjs`.
 */
export const ACCENT = "var(--mk-accent)"        // the plate/fill
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
export const ACCENT_INK = "var(--mk-accent-ink)"
export const INK = "var(--mk-ink)"
// WARM PAPER, under a cool periwinkle banner. Chosen deliberately, not by default.
//
// It was briefly swapped to a cool off-white because a warm page under a cool accent puts two
// temperatures on one screen. That IS the tension — but it's the tension the look is built on:
// the banner reads modern, the page reads printed, and the contrast between them is the point
// rather than a mistake. The earlier version failed because the warm tone was carrying a
// purple hero as well; now the purple has its own plate and the paper is only ever the page.
//
// Both letterings clear it comfortably: ink 18.54:1, the accent purple 13.11:1.
export const SURFACE = "var(--mk-surface)"

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
 * The accent word on the plate.
 *
 * IT USED TO BE A DEEPER SHADE OF THE PLATE — #1E2A78, and the note here read "6.53:1,
 * comfortably past the 4.5:1 body-text floor". That was true against the LIGHT periwinkle
 * #A5B7FF this was chosen for. The plate then moved to electric violet and this did not move
 * with it, so the real figure was 2.10:1 — well under the floor, and the paragraph saying
 * otherwise stayed for as long as the value did.
 *
 * Nothing renders it, which is exactly why it survived: a dead export cannot look wrong.
 * `tools/check-skins.mjs` is what found it, and it is the argument for the gate — the
 * measurement in a comment is a claim, and only the tool is a check.
 *
 * A deeper tint of the ground only works while the GROUND IS LIGHT: on a dark plate the
 * accent word has to be lighter than the plate, so it is the site's one accent in both
 * skins. 16.66:1 on studio's near-black, 5.07:1 on press's violet.
 */
export const PLATE_ACCENT = "var(--mk-plate-accent)"

/**
 * THE DEEP PLATE — the home hero only.
 *
 * A bright plate can never carry light lettering: #A5B7FF is L* 75.5, so cream lands at
 * 1.83:1 and white at 1.94:1. Going deep is the only way to get white type, and it is what
 * every reference in this style actually does.
 *
 * ELECTRIC VIOLET, matching the reference directly — hue 283.5 at chroma 0.272, which is
 * near the top of the sRGB gamut for this hue and is what makes it read as lit rather than
 * printed. Paper 5.68:1, white 6.03:1, and the green accent 5.07:1: all real readable type,
 * none of it decorative-only.
 *
 * This is the DARK ground the palette was missing. A pastel page has nowhere for a bright
 * accent to fire — every accent has to be a mid-tone, and mid-tones are what "muted" means.
 * The green only ever appears here, never on paper, where it measures 1.12:1 and vanishes.
 */
/* THE SAME VALUE AS ACCENT, BY REFERENCE — not a second copy of the digits.
   Both were the literal '#6633FF'. Two names for one colour is fine; two literals for one
   colour is how a palette drifts, because moving the plate means remembering there is a
   second place that has to move with it. Bound to ACCENT, that cannot happen. */
export const PLATE_DEEP = ACCENT

/**
 * The one loud accent — a CREAM green, not an acid one.
 *
 * #C6F24E sat at chroma 0.191, which is sports-drink territory. This is chroma 0.129 at a
 * slightly higher lightness: the same energy on the violet with the neon sanded off, which
 * is the "bright cream green" that was asked for twice.
 *
 * 5.07:1 on the plate, so it is type rather than a glow. As a FILL it only ever takes ink —
 * black on it is 16.56:1, white fails outright. It is a LIGHT colour, so it needs the dark
 * ground; on paper it measures 1.12:1 and disappears entirely.
 */
export const ACID = "var(--mk-acid)"

/**
 * INK CARRYING ACID — the one dark-on-bright pair, as a class string.
 *
 * `bg-[var(--mk-ink)] text-[var(--mk-acid)]` was retyped in four places across three files: the support
 * bubble's send button and its own message bubbles, and a table header in bold-product.
 * §4 is explicit that a colour is imported from this kit and never re-declared in a page,
 * and Tailwind needs a STATIC string, so a constant that holds the class is the form that
 * rule takes for a utility class rather than a style object.
 *
 * Ink on ACID measures 16.56:1 — see the note above; this pair is always a fill carrying
 * ink, never type on paper.
 */
export const INK_ON_ACID = "bg-[var(--mk-ink)] text-[var(--mk-acid)]"

/**
 * THE AUTH GROUND — login, signup, forgot, reset.
 *
 * The marketing pages' own section tint: SURFACE under rgba(0,0,0,0.03), which computes to
 * #F2F1EC. Using the same value rather than a near-miss is the point — auth is the last page
 * of the marketing site, so it should be the same paper, not a colour that merely resembles it.
 *
 * This replaced two earlier grounds that were both too dark: #332C23 (an espresso brown that
 * read as near-black) and #DED3BC (a real beige, but heavy enough to feel like its own theme).
 *
 * Measured against AUTH_GROUND, and the constraint survives every lightening:
 *
 *   INK   17.40:1   text        VIOLET  5.33:1   text and shape
 *   LIME   1.05:1   invisible   WHITE   1.13:1   no edge of its own
 *
 * LIME CAN NEVER LETTER THIS PAGE. It is a light colour, so the lighter the ground gets the
 * worse it does — 1.25:1 on the old beige, 1.05:1 here. The brand pair appears once, as the
 * button, and that is the only place it can appear on a light ground.
 *
 * AUTH_EDGE is load-bearing, not decoration. A white field on this ground is 1.13:1, so the
 * border is the ONLY thing marking the control. #8A8577 is the first step up the ramp clearing
 * the 3:1 boundary floor, at 3.26:1; the softer #9C9789 measures 2.58:1 and fails. Do not
 * lighten it to calm the page down — the fields stop being findable.
 */
export const AUTH_GROUND = SURFACE
export const AUTH_FIELD = "var(--mk-auth-field)"
export const AUTH_EDGE = "var(--mk-auth-edge)"
/** Secondary type on AUTH_GROUND — real text rather than a hint, in both skins. */
export const AUTH_MUTED = "var(--mk-auth-muted)"
/** The rule around a CARD, not around a control. See the note beside the token: an edge has
 *  a 3:1 floor because a field you cannot find is a field you cannot fill; a hairline
 *  separates two areas nobody interacts with, and at 3:1 it becomes the loudest thing on a
 *  page whose whole job is one form. */
export const HAIRLINE = "var(--mk-hairline)"

/**
 * A CARD'S FILL — the ground a numbered card or a quote is drawn on, as distinct from the page.
 *
 * On `studio` it is white and on `press` the warm paper, so on both it equals SURFACE and the
 * card's hairline does the separating. It exists as its own token so a skin that wants a card
 * to sit at a different value from the page can say so in ONE place rather than in every
 * component that draws one. Measured against `--mk-ink` by tools/check-skins.mjs on every
 * skin, because card text is text.
 */
export const CARD = "var(--mk-card)"

/**
 * THE LITERAL DIGITS — for the places a `var()` legally cannot go.
 *
 * There are exactly two kinds and both are real:
 *
 *   1. `<input type="color">`. Its value must parse as a colour; handed "var(--mk-accent)"
 *      it silently falls back to #000000, and a `placeholder` prints the words.
 *   2. A colour that gets PERSISTED. The lookbook stores a seller's brand accent per
 *      seller, and writing a variable name into the database means the row means whatever
 *      the theme happened to be when it was saved — and nothing at all outside a browser.
 *
 * Kept in step with the DEFAULT skin's declaration in globals.css by tools/check-skins.mjs,
 * which fails if they disagree. It is still one source of truth; this is the escape hatch
 * from it, and it is narrow on purpose — a colour that is merely PAINTED never belongs here.
 */
export const HEX = {
  accent: "#33373C",
  ink: "#121212",
  acid: "#C0C4FF",
  surface: "#F3F4F5",
  paper: "#F3F4F5",
} as const

/** The one type ramp. Sections use HEADING, heroes use DISPLAY — pages don't invent sizes. */
export const DISPLAY = { fontSize: "clamp(2.6rem, 7.2vw, 6.2rem)" } as const
export const HEADING = { fontSize: "clamp(2rem, 4.6vw, 3.6rem)" } as const
export const EASE = [0.16, 1, 0.3, 1] as const

/** Words rise out of a mask, one after another. The mask is what makes it read as typesetting
 *  rather than a fade — letters emerge from an edge instead of materialising.
 *
 *  THE MASK HAS TO BE TALLER THAN THE LINE BOX, or it crops the typeface. The original
 *  `pb-[0.08em]` was a descender allowance sized for a sans. Playfair has far longer
 *  descenders and taller ascenders, and these headings run at leading 0.92–0.95, so the line
 *  box is SHORTER than the glyphs — overflow-hidden then cut the tops off caps and sliced the
 *  tails off every g, y and p.
 *
 *  The padding below grows the clip box; the matching negative margins take that growth back
 *  out of the layout, so line spacing is unchanged and only the crop moves. The initial offset
 *  goes to 140% to match: the word starts below the mask, the mask's floor just moved down by
 *  0.3em, and at the old 110% the top sliver of each word would peek into that new padding
 *  before its own animation began. */
export function MaskedWords({ text, className = "", delay = 0 }: { text: string; className?: string; delay?: number }) {
  const reduce = useReducedMotion()
  const words = text.split(" ").filter(Boolean)
  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} className="inline-block overflow-hidden pt-[0.18em] pb-[0.3em] -mt-[0.18em] -mb-[0.3em] align-bottom">
          <motion.span
            className="inline-block"
            /* THE REDUCED-MOTION BRANCH MUST RESET `y`, AND THIS IS WHY.
             *
             * `useReducedMotion()` is a client hook: during hydration it returns FALSE, so the
             * motion branch runs and every word is translated to y:140% — below its own
             * `overflow-hidden` mask. A moment later the hook flips TRUE, and the reduced
             * branch animates only `opacity`. Nothing ever puts `y` back.
             *
             * The result was a headline at opacity 1, correctly in the DOM, sitting 82px below
             * a clipping container: readable to a crawler, invisible to a reader. Anyone
             * browsing with reduced motion — a setting people turn on for migraine or
             * vestibular reasons — saw half the hero missing and no error anywhere.
             *
             * Setting y in BOTH branches is the fix: whichever way the hook resolves, and
             * however late it changes its mind, the word ends at y:0. */
            initial={reduce ? { opacity: 0, y: "0%" } : { y: "140%" }}
            animate={reduce ? { opacity: 1, y: "0%" } : { y: "0%" }}
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
export function Pill({ href, children, tone = "primary", ring = false, className = "" }: {
  href: string; children: React.ReactNode; tone?: "primary" | "accent" | "invert" | "ghost" | "ghostLight"
  /**
   * THE ARROW IN A RING — the board's third pill.
   *
   * A row of buttons that are all the same shape reads as one control repeated, so the
   * reference gives the LAST one a circled arrow: same pill, same weight, one extra mark that
   * says "and there is more this way". It is a variant of this button and not a second
   * component, so it cannot drift from the pill it sits beside.
   */
  ring?: boolean
  className?: string
}) {
  const base = "group inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3.5 text-[15px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
  const tones = {
    /* THE PRIMARY CTA — lime ground, ink label, ink border. Inverted 2026-08-26.
     *
     * This tone was `ink`: an ink fill carrying an acid label, chosen when the page was white
     * and a lime fill would have had no shape against it. The page is parchment now and the
     * button carries a 1px ink border, so the shape comes from the border and the fill is free
     * to be the loud one.
     *
     * The direction's rule is that lime is a GROUND CARRYING INK and is never lettering. Ink
     * on lime is 15.49:1, so this is both louder as a control and more readable as a label.
     * The KEY was renamed with the value — a tone called `ink` that renders lime is the kind
     * of quiet lie the palette gate exists to catch. */
    /* THE PRIMARY IS A LIME FILL CARRYING INK.
     *
     * This control has now been ink → lime → ink → lime across one day, and the round trip
     * is the record of a real mistake rather than indecision. Lime was pulled because the
     * page looked wrong; the page looked wrong because it was BEIGE, and buddy.works runs
     * essentially this same chartreuse (#BFFF5A to our #E0FF4F) on a cool near-white where
     * it reads as confident. I changed the accent when the neutrals were the fault.
     *
     * Lime is a light colour, so the rule that governs it is fixed: it can only ever be a
     * GROUND CARRYING INK — never lettering, where it measures 1.03:1 on the page and
     * disappears. Ink on lime is 12.99:1. */
    primary: "border border-[var(--mk-ink)] text-[var(--mk-ink)] hover:brightness-95 focus-visible:ring-[var(--mk-ink)]",
    // Violet fill, LIME label — the same action pair as the app's default button and the
    // selected nav item. It used to be violet with INK on it, which measures 2.75:1 and
    // fails outright; the tone was unused, so it shipped broken rather than being noticed.
    accent: "text-[var(--mk-accent-ink)] hover:brightness-125 focus-visible:ring-[var(--mk-ink)]",
    /* `invert` — the primary as it appears ON the dark band. Parchment fill, ink label.
     *
     * This tone used to be `acid`: a fill of the accent itself. That works while the accent
     * is a light colour you can put ink on, and stops working the moment the accent is a
     * brand mark rather than a surface. Inverting against the block needs no accent at all
     * and measures 16.84:1, which is the loudest thing available without inventing a fourth
     * colour to solve one button. */
    invert: "text-[var(--mk-ink)] hover:brightness-95 focus-visible:ring-[var(--mk-accent-ink)]",
    // The secondary on a LIGHT ground: an ink outline. This was a copy of ghostLight —
    // cream on cream — which is only ever right over a dark plate.
    ghost: "border border-[var(--mk-ink)]/25 text-[var(--mk-ink)] hover:border-[var(--mk-ink)]/60 hover:bg-[var(--mk-ink)]/[0.04] focus-visible:ring-[var(--mk-ink)]",
    // The ghost outline inverted, for use ON the deep plate where ink would disappear.
    ghostLight: "border border-[var(--mk-accent-ink)]/30 text-[var(--mk-accent-ink)] hover:border-[var(--mk-accent-ink)]/60 hover:bg-[var(--mk-accent-ink)]/10 focus-visible:ring-[var(--mk-accent-ink)]",
  }
  return (
    <Link href={href} className={`${base} ${tones[tone]} ${className}`} style={tone === "primary" ? { background: ACID } : tone === "accent" ? { background: ACCENT } : tone === "invert" ? { background: ACCENT_INK } : undefined}>
      {children}
      {ring ? (
        /* -mr-2.5 pulls the ring back into the pill's own padding: a 28px circle inside a
           56px pill would otherwise sit a full step further from the label than a bare arrow
           does, and the two buttons in a row would no longer end on the same rhythm. */
        <span aria-hidden className="-mr-2.5 grid size-7 shrink-0 place-items-center rounded-full border border-current/40 transition-colors duration-200 group-hover:border-current">
          <ArrowUpRight size={13} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </span>
      ) : (
        <ArrowUpRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      )}
    </Link>
  )
}

/**
 * Scroll-entrance for a block. One definition, so "does it respect reduced motion" is answered
 * once — but no longer ONE ANIMATION.
 *
 * It used to hardcode a 22px fade-up, which meant every section of every page arrived exactly
 * alike; five of the six marketing pages had nothing else, so the site's entire motion design
 * was that one gesture repeated forty times. `preset` picks from the vocabulary in
 * lib/motion.ts and defaults to `rise`, which IS the old 22px fade-up — so an un-migrated call
 * site is unchanged, and a page becomes more considered one prop at a time.
 *
 * `index` is how a group staggers. Passing it beats hand-computing `delay={i * 0.06}` at the
 * call site: the spacing then comes from the preset and is editable in Settings with
 * everything else, instead of being a number frozen into whichever page was written first.
 */
export function Rise({ children, preset = "rise", index = 0, delay = 0, className = "", style }: {
  children: React.ReactNode
  preset?: PresetName
  index?: number
  delay?: number
  className?: string
  style?: React.CSSProperties
}) {
  const reduce = useReducedMotion()
  const p = useMotionPreset(preset)
  const { initial, animate, transition } = entrance(p, { index, delay, reduce: !!reduce })
  return (
    <motion.div
      className={className}
      style={style}
      initial={initial}
      // whileInView, not animate — this is a SCROLL entrance and the element is usually below
      // the fold. `animate` would run it while nobody is looking and reveal a finished block.
      whileInView={animate}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={transition}
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
export function PlateHero({ title, accent, sub, children, path }: {
  title: string; accent?: string; sub?: string; children?: React.ReactNode
  /**
   * Where these three strings live in the content blob ("featuresPage", "howPage"), so the
   * page's own headline is editable where it is read. Without it the hero renders exactly as
   * before — which is every page whose copy is not stored yet.
   *
   * The ANIMATED forms are swapped for plain editable ones while editing, the same trade the
   * home page's headline makes: MaskedWords and TypedPhrase own the DOM they animate, so a
   * contentEditable inside either is re-mounted mid-keystroke.
   */
  path?: string
}) {
  const reduce = useReducedMotion()
  const { on: editing } = useEditMode()
  // PAPER, not a plate. The full-bleed violet was 76% of the viewport at chroma 0.272 —
  // near the maximum sRGB can express at that hue — which is why it read as "too bright"
  // whichever bright colour it was. The login page uses the SAME violet at 0.9% coverage and
  // reads as calm, so the fix is area, not hue.
  //
  // This is a return to the documented style rather than a new direction: ink and paper carry
  // the page, type does the work decoration usually does, and there is ONE accent
  // (CLAUDE.md 4). The full-bleed plate was the drift.
  //
  // Measured on this ground: ink 17.40:1, the violet accent phrase 5.33:1.
  /**
   * ── LEFT, NOT CENTRED (2026-08-26) ──────────────────────────────────────────────────
   *
   * This hero was `text-center` inside a max-w-6xl while every band beneath it — and the home
   * page's own hero — is left-aligned in an 88rem container. So each interior page opened on
   * one alignment and one measure, then switched to another and never went back. §4 makes the
   * point about `items-center` being the house default for CROSS-AXIS alignment; it is not an
   * argument for centring a display headline over left-aligned prose.
   *
   * Centred display type also costs the thing this direction is built on: a 90px line set flush
   * left has an edge the eye can track down the page, and the bands below inherit it for free.
   * Centred, the reader re-finds the left margin at every section.
   *
   * The container widens to 88rem with it, because the two have to agree — a 72rem centred
   * block inside an 88rem page is a fifth margin. The HEADLINE keeps its own cap in rem: the
   * container is the page's, the measure is the type's, and they are not the same number.
   */
  return (
    <section className="relative -mt-16 pt-16" style={{ background: SURFACE }}>
      <div className="mx-auto max-w-[88rem] px-6 pb-20 pt-14 sm:px-10 sm:pt-20">
        <h1 className="max-w-[20ch] font-display font-semibold leading-[0.92] tracking-[-0.032em]" style={{ ...DISPLAY, color: INK }}>
          {path && editing
            ? <EditableText path={`${path}.title`}>{title}</EditableText>
            : <MaskedWords text={title} />}
          {accent ? <> {path && editing
            ? <EditableText path={`${path}.accent`}>{accent}</EditableText>
            : <TypedPhrase text={accent} color={ACCENT} />}</> : null}
        </h1>
        {sub && (
          <motion.p
            className="mt-7 max-w-xl text-[17px] leading-relaxed"
            /* THE SUB READS THE INK VARIABLE. It was a literal rgba of the press ink, so on
               every other skin this one paragraph stayed the old colour — the same class of
               bug as the journey chip, and invisible for exactly as long. */
            style={{ color: INK, opacity: 0.62 }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35, ease: EASE }}
          >
            {path ? <EditableText path={`${path}.sub`}>{sub}</EditableText> : sub}
          </motion.p>
        )}
        {children}
      </div>
    </section>
  )
}

/**
 * ── BAND — the page's rhythm, as a component ────────────────────────────────────────────
 *
 * THE PROBLEM IT SOLVES. Every section of the marketing site was `<section class="mx-auto
 * max-w-[88rem] px-6 pt-24">` on the same ground, divided by hairline rules. That is a
 * single flat sheet with lines drawn across it, and it is why the page reads as one long
 * undifferentiated scroll no matter how good the type is. A rule between two identical
 * grounds does not make two sections; it makes one section with a line in it.
 *
 * The direction's answer is not a divider, it is a CHANGE OF GROUND. Sections alternate
 * parchment → white → dark, edge to edge, with no rule between them at all. The value change
 * IS the division, and it is also the entire depth model — there are no shadows anywhere in
 * this system, so a surface separates from its neighbour by being a different surface.
 *
 * WHY A COMPONENT AND NOT A CONVENTION. The last four rules written as prose were violated
 * across a dozen files each, because there was nothing to import and every new section was
 * fresh Tailwind. A band that is a component cannot drift: the padding, the container width
 * and the icon variables are decided once, here.
 *
 * IT CARRIES THE ICON VARIABLES, which is the part worth knowing. The object family reads
 * --eg-icon-ink and --eg-icon-void, so an object dropped into a dark band inverts on its own
 * and one SVG serves every ground. Put an object inside a Band and it is simply correct;
 * that is the whole reason those two variables exist.
 *
 * THE RULES A BAND CANNOT ENFORCE FOR YOU:
 *   · Never two dark bands adjacent. The alternation is the rhythm; two in a row is a hole.
 *   · `lime` is at most ONCE per page, and never next to the lime CTA.
 */
export function Band({
  tone = "paper",
  children,
  className = "",
  full = false,
  id,
}: {
  tone?: "paper" | "card" | "dark" | "accent"
  children: React.ReactNode
  className?: string
  /** Skip the inner container — for a band whose content is itself edge-to-edge (a marquee). */
  full?: boolean
  id?: string
}) {
  const tones = {
    paper: { background: SURFACE, color: INK, "--eg-icon-ink": INK, "--eg-icon-void": SURFACE, "--eg-icon-fill": ACID },
    card: { background: CARD, color: INK, "--eg-icon-ink": INK, "--eg-icon-void": CARD, "--eg-icon-fill": ACID },
    dark: { background: ACCENT, color: ACCENT_INK, "--eg-icon-ink": ACCENT_INK, "--eg-icon-void": ACCENT, "--eg-icon-fill": ACID },
    accent: { background: ACID, color: INK, "--eg-icon-ink": INK, "--eg-icon-void": ACID, "--eg-icon-fill": CARD },
  } as const
  return (
    <section id={id} style={tones[tone] as React.CSSProperties} className={`w-full ${className}`}>
      {full ? children : (
        <div className="mx-auto max-w-[88rem] px-6 py-[clamp(3.5rem,7vw,6rem)] sm:px-10">{children}</div>
      )}
    </section>
  )
}

/**
 * An object from the family, drawn straight onto whatever it sits on.
 *
 * IT USED TO HAVE A TILE — a lime square behind it — on the argument that a loose glyph in
 * whitespace is decoration the eye reads past while the same glyph on a filled square is an
 * object it lands on. That argument is sound for an EMPTY STATE's mark, and it is wrong here,
 * for two reasons found by putting it on a real page.
 *
 * First, the reference does not do it: Gumroad floats its objects directly on the canvas with
 * nothing behind them, and the object reads perfectly well because it has its own fill and a
 * heavy outline. A tile is what you need when the mark is a thin monochrome stroke.
 *
 * Second, and more usefully, the tile CREATED the bug it was hiding. A pink tile with a pink
 * object on it is invisible, so the tile forced the object's fill to be a different colour
 * from the accent — which is exactly how nine objects ended up rendering lime after the
 * accent had already moved to pink.
 *
 * Nothing behind it, then. The object carries the accent as its own fill and reads its
 * outline from the band. The tiled version survives as `ObjectMark` for empty states, where
 * the original argument still holds.
 */
export function ObjectTile({
  children,
  size = 56,
  className = "",
  style,
}: {
  children: React.ReactNode
  size?: number
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      {children}
    </span>
  )
}

/**
 * ── WINDOW — a screenshot presented as an interface, not as a picture ────────────────────
 *
 * Direction E's whole device, and the most-repeated pattern in the reference study: a dark
 * shell holding a light UI. customer.io, webflow.com, openphone.com and cakeequity.com all
 * do the same thing, because it solves the same problem — a bare screenshot dropped onto a
 * page reads as a document someone attached, while the same screenshot inside a frame reads
 * as software running.
 *
 * The shell is the brand's, the contents are the product's. That separation is the point:
 * nothing about the screenshot is restyled to match the page, so what a visitor sees is what
 * they get after signing up. A marketing site that prettifies its own screenshots is lying in
 * a way that is discovered on day one.
 *
 * THE TRAFFIC LIGHTS ARE NOT MACOS. One accent dot and two neutral ones — enough to say
 * "window" without pretending to be an operating system we do not ship on.
 *
 * NO IMAGE, NO FAKE. If `src` is missing the frame renders EMPTY with its caption, and that
 * is deliberate: the previous version of this site had a drawn mock of our own app in the
 * hero and it was deleted on purpose. An invented screenshot is the one asset that damages
 * trust rather than merely failing to build it — a visitor compares it to the real thing.
 */
export function Window({
  src,
  alt = "",
  caption,
  tilt = 0,
  className = "",
}: {
  src?: string
  alt?: string
  /** Small label under the frame — what this screen is. Not a sentence. */
  caption?: string
  /** Degrees of perspective. The references use 2–4; past about 5 it reads as a stock mockup. */
  tilt?: number
  className?: string
}) {
  return (
    <figure className={`m-0 ${className}`}>
      <div
        className="overflow-hidden rounded-[26px] p-2.5"
        style={{
          background: ACCENT,
          transform: tilt ? `perspective(1400px) rotateY(${tilt}deg)` : undefined,
          transformStyle: tilt ? "preserve-3d" : undefined,
        }}
      >
        <div className="flex items-center gap-1.5 px-2 pb-2.5 pt-1">
          <span className="size-2 rounded-full" style={{ background: ACID }} />
          <span className="size-2 rounded-full" style={{ background: ACCENT_INK, opacity: 0.28 }} />
          <span className="size-2 rounded-full" style={{ background: ACCENT_INK, opacity: 0.28 }} />
        </div>
        <div className="overflow-hidden rounded-[18px]" style={{ background: CARD }}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={alt} className="block h-auto w-full" loading="lazy" />
          ) : (
            /* No capture yet — a wireframe, never a drawing of the app. See WindowSkeleton. */
            <WindowSkeleton />
          )}
        </div>
      </div>
      {caption && (
        <figcaption
          className="mt-3 text-[11px] font-medium uppercase tracking-[0.1em]"
          style={{ color: INK, opacity: 0.5 }}
        >
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

/* PROOF BLOCKS ARE GONE — deleted 2026-08-26 with the band of figures they drew.
 *
 * They were four saturated violet panels under the homepage hero, and before that the same
 * four numbers as a plain strip. Two treatments for one band is what a section looks like
 * when the problem is the section: every figure in it was already stated elsewhere on the
 * page, so no amount of colour made it new information.
 *
 * --mk-violet was painted here and nowhere else. The token and its fence survive in
 * globals.css; nothing renders it. If a real specification ever needs a coloured block,
 * write it against a page that has facts of its own — do not restore this one. */

/**
 * ── WINDOW SKELETON — a placeholder that is visibly a placeholder ────────────────────────
 *
 * WHAT THIS IS FOR. The boards are being reskinned, so a real capture would be out of date
 * the day it was taken. This stands in so the LAYOUT can be judged now — column rhythm, how
 * much room a window needs beside its copy, whether the alternating sections breathe.
 *
 * WHY IT IS ABSTRACT AND NOT A DRAWING OF THE APP. There is a real difference between a
 * placeholder and a fake, and it is whether a visitor could mistake it for the product. Bars
 * and blocks cannot be mistaken for anything: no invented order numbers, no made-up revenue,
 * no customer names, no percentages. The previous version of this site carried a drawn mock
 * of our own app in the hero and it was deleted deliberately — an invented screenshot is
 * discovered the week after signup and costs more trust than an empty frame ever would.
 *
 * The ONE piece of real information is the shape: a toolbar, a filter row, a table of rows
 * with a status chip on the right. That is what the queue genuinely looks like, and it is the
 * thing the layout has to accommodate.
 *
 * REPLACE IT with `<Window src="…" />` the moment a board is worth photographing. This
 * component should end up unused, and if it is still here in a month that is the signal.
 */
export function WindowSkeleton({ rows = 5 }: { rows?: number }) {
  const bar = (w: string, o = 0.14) => (
    <span className="block h-2.5 rounded-full" style={{ width: w, background: INK, opacity: o }} />
  )
  return (
    <div className="p-5" style={{ background: CARD }}>
      <div className="flex items-center gap-3 pb-4">
        {bar("92px", 0.5)}
        <span className="ml-auto block h-6 w-[84px] rounded-full" style={{ background: INK, opacity: 0.07 }} />
        <span className="block h-6 w-[64px] rounded-full" style={{ background: ACID }} />
      </div>
      <div className="flex items-center gap-2 border-t pb-3 pt-3" style={{ borderColor: HAIRLINE }}>
        {bar("46px", 0.28)}{bar("38px")}{bar("52px")}{bar("34px")}
      </div>
      <div className="flex flex-col">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-t py-3.5" style={{ borderColor: HAIRLINE }}>
            <span className="block size-8 shrink-0 rounded-[9px]" style={{ background: INK, opacity: 0.08 }} />
            <span className="flex min-w-0 flex-col gap-1.5">
              {bar(["104px", "88px", "116px", "96px", "108px"][i % 5], 0.34)}
              {bar(["148px", "132px", "170px", "140px", "156px"][i % 5], 0.13)}
            </span>
            {/* The one coloured element — a status chip, because that is the thing the eye
                actually goes to in the real queue and the layout has to leave room for it. */}
            <span
              className="ml-auto block h-5 w-[62px] shrink-0 rounded-[8px]"
              style={{ background: i % 3 === 0 ? ACID : INK, opacity: i % 3 === 0 ? 1 : 0.08 }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * ── BLEED MEDIA — the picture layer every full-bleed band shares ─────────────────────────
 *
 * ONE IMPLEMENTATION, because there are now two bands that bleed and the video rules are the
 * fiddly kind that rot when copied: muted and playsInline are the CONDITIONS a browser
 * autoplays under rather than preferences, and without playsInline iOS takes the whole screen
 * the moment playback starts. A second copy works on the day it is written and drifts the
 * first time one of them is fixed.
 *
 * REDUCED MOTION PAUSES IT, like everything else on these pages (§4). A paused <video> paints
 * its poster, or its first frame once metadata has loaded, so the still is a real frame of the
 * film rather than a blank rectangle and the type still has something to stand on.
 *
 * aria-hidden, and the alt text does NOT move here: a loop behind a heading is decoration, the
 * words carry the meaning, and a screen reader describing the wallpaper before them is noise.
 * That is the difference from the <img> branch, where the picture may be the only content.
 *
 * See lib/media.ts for why the image/video decision is made on the extension.
 */
/**
 * The picture inside a full-bleed block, and WHICH PART of it survives the crop.
 *
 * `object-cover` alone takes the middle. Our photography is shot 16:9 and these blocks are
 * half again as wide, so the middle is a torso: the head and the feet — the half that reads
 * as a photograph rather than a texture — are exactly what a centred crop discards. `focusX`
 * / `focusY` move the crop; `scale` pushes in past cover for a frame that wants to be tighter
 * than the one that was shot.
 *
 * TRANSFORM-ORIGIN TRACKS THE FOCAL POINT, and it has to. Scaling about the centre while the
 * crop is taken from the top slides the subject out of frame as you zoom, so the control
 * would fight itself — you would drag to find the head and then lose it again on the next
 * press of +. Anchoring both to the same point makes zoom mean "closer on THIS", which is the
 * only thing it can usefully mean here.
 *
 * The defaults are the identity: 50/50/1 renders exactly what a bare object-cover did.
 */
function BleedMedia({ media, alt, focusX = 50, focusY = 50, scale = 1 }: {
  media: string
  alt?: string
  focusX?: number
  focusY?: number
  scale?: number
}) {
  const reduce = useReducedMotion()
  const cls = "absolute inset-0 -z-10 h-full w-full object-cover"
  const fit: React.CSSProperties = {
    objectPosition: `${focusX}% ${focusY}%`,
    ...(scale !== 1 ? { transform: `scale(${scale})`, transformOrigin: `${focusX}% ${focusY}%` } : null),
  }
  if (isVideoSrc(media)) {
    return <video src={media} className={cls} style={fit} autoPlay={!reduce} muted loop playsInline preload="metadata" aria-hidden />
  }
  // An admin-supplied absolute URL from Settings › Site content; next/image would need every
  // host allow-listed.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={media} alt={alt || ""} className={cls} style={fit} />
}

/**
 * ── MEDIA BAND — a full-bleed picture as a SECTION, not as a hero ────────────────────────
 *
 * WHY THIS EXISTS RATHER THAN CutoutFigure. The two page figures were cut-outs floating on a
 * soft radial wash, which is a good device and the wrong one for photography shot on a
 * COLOURED seamless: cutting a subject out of a chartreuse studio takes that colour with it
 * through the hair and the shoulder edge, so it lands on the page wearing a green halo.
 *
 * The resolution is to stop cutting the picture out and let the studio ground BE the band.
 * That is also what makes the three pages read as one campaign instead of three good
 * photographs — each is a whole frame in the palette (chartreuse, violet, near-black) rather
 * than a subject borrowed out of one.
 *
 * NO MEDIA RENDERS NOTHING. Never a grey box where a photograph should be — that is the
 * empty-state-that-looks-broken §4 forbids, and the guard belongs here rather than at each
 * call site so a new page cannot forget it.
 *
 * THE SCRIM IS CONDITIONAL, exactly as on MediaHero: a band with nothing over it is a
 * photograph, and darkening it for a caption that does not exist is damage.
 *
 * SHORTER THAN THE HERO by design. This sits mid-page with copy above and below; at the
 * hero's height it stops being a section and becomes a second first screen.
 */
export function MediaBand({ media, alt, children, minH = "clamp(22rem, 48vh, 34rem)", focusX, focusY, scale, tone = "light" }: {
  media?: string
  alt?: string
  children?: React.ReactNode
  minH?: string
  /** Which part of the picture survives the crop — see BleedMedia. */
  focusX?: number
  focusY?: number
  scale?: number
  /** Which way the lettering runs, and therefore which veil. Same contract as MediaHero —
   *  `light` is the safe default for any upload, `ink` is for a band whose ground is pinned
   *  bright. A high-key photograph under light type is the one case the black scrim cannot
   *  rescue: it only weights the bottom, and a headline sitting anywhere else has nothing
   *  behind it. */
  tone?: "light" | "ink"
}) {
  if (!media) return null
  return (
    /* FLEX COLUMN, and the inner block grows. `justify-end` on a child with `h-full` inside a
       section that only carries `min-height` resolves against an auto height, so it did
       nothing at all and the content floated wherever the top padding left it — which on a
       tall band is the middle of the picture. The intent was always bottom-aligned; this is
       what actually does it. */
    <section className="relative isolate flex w-full flex-col overflow-hidden" style={{ minHeight: minH, background: ACCENT }}>
      <BleedMedia media={media} alt={alt} focusX={focusX} focusY={focusY} scale={scale} />
      {children && (
        <>
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background: tone === "ink"
                ? `linear-gradient(to top, color-mix(in srgb, ${SURFACE} 58%, transparent) 0%, color-mix(in srgb, ${SURFACE} 28%, transparent) 40%, transparent 76%)`
                : "linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,.42) 34%, rgba(0,0,0,.10) 68%, rgba(0,0,0,0) 100%)",
            }}
          />
          <div className="relative mx-auto flex w-full max-w-[88rem] flex-1 flex-col justify-end px-6 pb-[clamp(2rem,4vw,3.5rem)] pt-[clamp(3rem,8vw,6rem)] sm:px-10">
            {children}
          </div>
        </>
      )}
    </section>
  )
}

/**
 * THE FULL-BLEED MEDIA HERO — direction A, locked 2026-08-26.
 *
 * WHAT IT IS. One edge-to-edge block of media with the headline standing on it. The page's
 * first screen is the thing we make, not a diagram of it, because this company sells a
 * FACTORY and the software that runs it — and the factory is the half a visitor can see and
 * believe in one glance. The software gets a reserved panel further down.
 *
 * WHY IT DOES NOT SIT UNDER THE HEADER, unlike `PlateHero`. The header is deliberately ONE
 * appearance at every scroll position — the transparent-over-plate variant was removed
 * because it drifted from what the pages actually rendered and read as a glitch. Putting the
 * nav back on top of a photograph would reverse that decision AND make the header's legibility
 * depend on how dark someone's uploaded image happens to be at the top. So the block starts
 * below the bar and bleeds horizontally only. Same composition, no new failure mode.
 *
 * THE EMPTY STATE IS NOT A PLACEHOLDER. With no media it renders the ink plate and the
 * headline alone, which is a real design rather than a gap — the hero object was deleted once
 * on purpose and a fake app panel must never come back in its place. A scrim only appears when
 * there is something to scrim.
 */
/**
 * ── THE PRESS — the page keeps its own headline's promise ────────────────────────────────
 *
 * The hero asks "What if every order printed itself?" and then showed a picture of a finished
 * cap sitting still: the page made a claim and did not demonstrate it. Here the garment is
 * BLANK, and wherever the pointer goes the decorated version shows through a soft circle that
 * follows it — as though the press were under your hand. Move away and it is blank again.
 *
 * TWO LAYERS, ONE MASK, NO STATE. The pointer writes CSS custom properties straight onto the
 * element through a ref. React never re-renders, so a 120Hz trackpad cannot trigger a render
 * loop — which is the same reason the product rail is CSS and not a rAF ticking a React value
 * (§2.8: the danger is state feeding itself).
 *
 * THE TWO IMAGES MUST BE THE SAME PHOTOGRAPH. The blank is the original with only the
 * stitching patched out — measured at 0.43/255 difference outside the patch and 0.59 across
 * the face. A generative "remove the mark" pass on its own drifted 7.3% of the frame including
 * the face, and a face that subtly changes under the cursor is far worse than no effect.
 *
 * WITHOUT A POINTER IT IS SIMPLY DECORATED. A touch screen has nowhere to put the circle, and
 * reduced motion asks for no chasing element — both get the finished garment, whole and still,
 * which is an honest resting state rather than a broken one.
 */
function PressReveal({ media, alt, focusX, focusY, scale, innerRef }: {
  media: string
  alt?: string
  focusX?: number
  focusY?: number
  scale?: number
  innerRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div ref={innerRef} aria-hidden className="eg-press absolute inset-0 -z-10">
      <BleedMedia media={media} alt={alt} focusX={focusX} focusY={focusY} scale={scale} />
    </div>
  )
}

export function MediaHero({ media, reveal, alt, children, minH = "clamp(30rem, 62vh, 44rem)", focusX, focusY, scale, tone = "light", bleed = false, atTop = true }: {
  /** A public image OR video URL. Empty is a legitimate answer — see above. */
  media?: string
  /** The DECORATED twin of `media`, revealed under the pointer — see PressReveal. Both must
   *  be the same photograph or the reveal reads as two pictures crossfading. */
  reveal?: string
  alt?: string
  children: React.ReactNode
  minH?: string
  /** Which part of the picture survives the crop — see BleedMedia. This block is the widest
   *  on the site relative to what is shot for it, so it is the one that needs them most. */
  focusX?: number
  focusY?: number
  scale?: number
  /**
   * WHICH WAY THE TYPE RUNS, and therefore which veil the picture gets.
   *
   * `light` is the general case and the safe default: light lettering over a black-weighted
   * scrim, which is legible over ANY upload including a bright one. It stays the default
   * precisely because an admin can put anything here.
   *
   * `ink` is for a ground the art direction PINS. Our photography is shot on a pale periwinkle
   * seamless, and a black scrim over a pale saturated ground does not darken it, it DULLS it —
   * the ground arrives as mud and the picture stops being the reason the block exists. So the
   * veil inverts: a soft lift in the page's own colour, and the lettering goes to ink. Ink on
   * #C0C4FF is 11.22:1, which is why this direction can afford almost no veil at all.
   *
   * NOT AUTOMATIC FROM THE IMAGE. Sampling an upload to pick a tone would make the headline's
   * colour depend on a photograph nobody has looked at yet, and get it wrong silently on the
   * first dark one. The page that pins its ground says so.
   */
  tone?: "light" | "ink"
  /**
   * DISSOLVE THE BOTTOM EDGE INTO THE PAGE instead of ending on a rule.
   *
   * It works here for a reason that is not general: the photography is shot on a ground that
   * IS the page colour — a pale periwinkle seamless, or a polished floor at ~#F3F4F5 — so the
   * two surfaces genuinely meet. Fading a picture whose base is a different colour just makes
   * a grey smear where the edge used to be, which is worse than an honest edge.
   *
   * A MASK, NOT AN OVERLAY. A gradient of the page colour laid on top would work on the page
   * and break the moment the section sits on any other ground; masking to transparent lets
   * whatever is behind show through, so it is correct on all of them.
   */
  bleed?: boolean
  /**
   * WHETHER THIS BLOCK IS THE FIRST THING ON THE PAGE.
   *
   * The header is transparent and 64px tall, so a hero that opens a page pulls up by exactly
   * that and pads it back — which is how the picture reaches the top of the viewport with the
   * nav standing on it. PlateHero has always done the same.
   *
   * A PROP rather than a constant because the home page stopped being that case: its headline
   * moved into a band of its own above the picture, so the picture is no longer first, and an
   * unconditional -mt-16 pulled it up over the CTA buttons instead of over the header. A
   * negative margin is only ever correct against the thing it was measured from.
   */
  atTop?: boolean
}) {
  const hasMedia = !!media
  /*
   * THE POINTER IS READ ON THE SECTION, NOT ON THE REVEAL LAYER.
   *
   * The layer sits at -z-10 behind the headline, and the content wrapper fills the whole
   * block — so listeners on the layer itself never fired: every pointer event was intercepted
   * by the type standing in front of it. The section is the only element that actually
   * receives the pointer everywhere the picture is visible.
   *
   * Coordinates are still resolved against the section's own box, which is the same box the
   * layer fills, so the circle lands exactly under the cursor.
   */
  const pressRef = useRef<HTMLDivElement>(null)
  const setPress = (x: string, y: string, r: string) => {
    const el = pressRef.current
    if (!el) return
    el.style.setProperty("--px", x)
    el.style.setProperty("--py", y)
    el.style.setProperty("--pr", r)
  }
  return (
    /* -mt-16 pt-16 — the same trick PlateHero uses to sit UNDER the header. The bar is 64px
       and transparent, so pulling up by it and padding back puts the picture behind the nav
       without moving the content that stands on it. This is what "full bleed" actually needs:
       edge to edge horizontally was never the missing half. */
    <section
      className={"relative isolate w-full overflow-hidden" + (atTop ? " -mt-16 pt-16" : "")}
      onPointerMove={reveal ? (e) => {
        if (e.pointerType === "touch") return
        const b = e.currentTarget.getBoundingClientRect()
        setPress(
          `${((e.clientX - b.left) / b.width) * 100}%`,
          `${((e.clientY - b.top) / b.height) * 100}%`,
          "clamp(9rem, 17vw, 15rem)",
        )
      } : undefined}
      onPointerLeave={reveal ? () => setPress("50%", "50%", "0px") : undefined}
      style={{
        minHeight: minH,
        background: ACCENT,
        ...(bleed && hasMedia ? {
          maskImage: "linear-gradient(to bottom, #000 0%, #000 62%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 62%, transparent 100%)",
        } : null),
      }}
    >
      {hasMedia && (
        <>
          <BleedMedia media={media!} alt={alt} focusX={focusX} focusY={focusY} scale={scale} />
          {reveal && <PressReveal media={reveal} alt={alt} focusX={focusX} focusY={focusY} scale={scale} innerRef={pressRef} />}
          {/* THE VEIL EXISTS SO THE TYPE IS LEGIBLE ON ANY UPLOAD, not for mood. Weighted to
              the bottom because that is where the headline stands; the top stays open so the
              picture is still a picture.

              The ink veil is a fraction of the weight of the light one, and that is the whole
              point: light type has to fight whatever is underneath it, while ink on the pinned
              periwinkle ground already measures 11.22:1 and needs almost nothing. It is not
              zero only because a figure can move through a frame and a shadow is darker than
              the seamless it falls on. */}
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background: tone === "ink"
                ? `linear-gradient(to top, color-mix(in srgb, ${SURFACE} 55%, transparent) 0%, color-mix(in srgb, ${SURFACE} 26%, transparent) 34%, transparent 68%)`
                : "linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,.45) 38%, rgba(0,0,0,.12) 72%, rgba(0,0,0,0) 100%)",
            }}
          />
        </>
      )}
      <div className="relative mx-auto flex h-full max-w-[88rem] flex-col justify-end px-6 pb-[clamp(2.5rem,5vw,4.5rem)] pt-[clamp(4rem,10vw,8rem)] sm:px-10">
        {children}
      </div>
    </section>
  )
}
