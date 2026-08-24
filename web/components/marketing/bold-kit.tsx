"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { ArrowUpRight } from "@phosphor-icons/react"
import { entrance, type PresetName } from "@/lib/motion"
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
 * ── THE GROUNDS ──────────────────────────────────────────────────────────────
 *
 * A colour here is a FIELD that carries ink, not a letterform. That is the whole reversal:
 * the acid was previously allowed only as a word inside the black plate, which is why one
 * bright colour was on the page 14 times and never once as an area. Ink on each of these is
 * measured by tools/check-skins.mjs — lime 16.66:1, lilac 12.85:1, deep lilac 9.24:1,
 * panel 17.51:1 — so any of them can hold a heading, a paragraph or a caption.
 *
 * LIME is the same value as ACID and deliberately a second name: ACID is "the accent word
 * on the plate", LIME is "a panel on the page". Same hex, opposite jobs, and a call site
 * reads as one or the other.
 */
export const LIME = "var(--mk-acid)"
export const LILAC = "var(--mk-lilac)"
export const LILAC_DEEP = "var(--mk-lilac-deep)"
/** The neutral tile — a different SURFACE from the page, not white held apart by a rule. */
export const FIELD = "var(--mk-field)"

/**
 * THE GROUNDS A TILE MAY USE, in the order a bento should cycle them.
 *
 * Exported as a list rather than left to each call site to pick, because the thing that makes
 * a grid of mixed tiles read as designed is that the same few grounds recur in a rhythm —
 * and the thing that makes it read as noise is nine tiles each choosing for themselves.
 */
export const TILES = [FIELD, LIME, "var(--mk-surface)", LILAC, FIELD, "var(--mk-surface)"] as const

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
  accent: "#0A0A0A",
  ink: "#0A0A0A",
  acid: "#D4F897",
  surface: "#FFFFFF",
  paper: "#FFFFFF",
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
            initial={reduce ? { opacity: 0 } : { y: "140%" }}
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
export function Pill({ href, children, tone = "ink", ring = false, className = "" }: {
  href: string; children: React.ReactNode; tone?: "ink" | "accent" | "acid" | "ghost" | "ghostLight"
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
  const base = "group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[15px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
  const tones = {
    // ACID (#D4F897) lettering, not cream. The ink pill is the CTA on every marketing page,
    // and a black-on-violet box with cream type was the one place the accent went missing —
    // the green now carries the label and the arrow, tying the button to the plate it sits
    // on. 16.56:1 on the ink ground, so it is louder AND more readable than the cream was.
    ink: "bg-[var(--mk-ink)] text-[var(--mk-acid)] hover:bg-[color-mix(in_oklch,var(--mk-ink)_86%,white)] focus-visible:ring-[var(--mk-ink)]",
    // Violet fill, LIME label — the same action pair as the app's default button and the
    // selected nav item. It used to be violet with INK on it, which measures 2.75:1 and
    // fails outright; the tone was unused, so it shipped broken rather than being noticed.
    accent: "text-[var(--mk-acid)] hover:brightness-110 focus-visible:ring-[var(--mk-ink)]",
    // Ink on acid is 15.19:1. White on acid is 1.30:1 — never do that.
    acid: "text-[var(--mk-ink)] hover:brightness-95 focus-visible:ring-[var(--mk-ink)]",
    // The secondary on a LIGHT ground: an ink outline. This was a copy of ghostLight —
    // cream on cream — which is only ever right over a dark plate.
    ghost: "border border-[var(--mk-ink)]/25 text-[var(--mk-ink)] hover:border-[var(--mk-ink)]/60 hover:bg-[var(--mk-ink)]/[0.04] focus-visible:ring-[var(--mk-ink)]",
    // The ghost outline inverted, for use ON the deep plate where ink would disappear.
    ghostLight: "border border-[var(--mk-accent-ink)]/30 text-[var(--mk-accent-ink)] hover:border-[var(--mk-accent-ink)]/60 hover:bg-[var(--mk-accent-ink)]/10 focus-visible:ring-[var(--mk-accent-ink)]",
  }
  return (
    <Link href={href} className={`${base} ${tones[tone]} ${className}`} style={tone === "accent" ? { background: ACCENT } : tone === "acid" ? { background: ACID } : undefined}>
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
  return (
    <section className="relative -mt-16 pt-16" style={{ background: SURFACE }}>
      <div className="mx-auto max-w-6xl px-6 pb-20 pt-14 sm:pt-20">
        <h1 className="mx-auto max-w-5xl text-center font-display font-semibold leading-[0.92] tracking-[-0.032em]" style={{ ...DISPLAY, color: INK }}>
          {path && editing
            ? <EditableText path={`${path}.title`}>{title}</EditableText>
            : <MaskedWords text={title} />}
          {accent ? <> {path && editing
            ? <EditableText path={`${path}.accent`}>{accent}</EditableText>
            : <TypedPhrase text={accent} color={ACCENT} />}</> : null}
        </h1>
        {sub && (
          <motion.p
            className="mx-auto mt-7 max-w-xl text-center text-[17px] leading-relaxed"
            style={{ color: "rgba(11,11,12,0.62)" }}
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
