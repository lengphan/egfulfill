"use client"

import { useId } from "react"
import { useReducedMotion } from "motion/react"
import { ACCENT, ACID, INK, SURFACE, HAIRLINE } from "@/components/marketing/bold-kit"

/**
 * ── THE STICKER SET — arrows, badges, tags, highlights ───────────────────────────────────
 *
 * WHY THESE ARE DRAWN AND NOT GENERATED. Every one of these is flat two-colour geometry, and
 * a bitmap of flat geometry is the worst of both: it cannot take a palette change, it goes
 * soft on a retina display, and it costs a request and a re-roll every time the accent moves.
 * The nine-object family already established the precedent — these are its interface-scale
 * cousins, and they read their colour from the same `--mk-*` tokens, so a skin change carries
 * them along with everything else.
 *
 * WHAT THEY ARE FOR. The page annotates its own photographs — an arrow pointing at the thing
 * worth looking at, a badge stamped in a corner, a tag hanging off a garment. That device is
 * honest here rather than decorative, because annotating, labelling and tracking a parcel is
 * literally what this company does to an order.
 *
 * THE DISCIPLINE, and it is the whole difference between annotation and clutter:
 *
 *   · ONE per section. Two arrows in a viewport is a doodle, not a direction.
 *   · An annotation points at something REAL. Never an arrow to empty space, never a badge
 *     on a section with nothing to claim.
 *   · They sit UNDER type and OVER photographs. A sticker across a headline is a defect.
 *   · Never inside the app. §4 reserves the app's chrome; these are marketing only.
 *
 * COLOUR. Periwinkle (`ACID`) is the sticker fill and ink is what sits on it — 11.22:1, so a
 * badge can carry real words. Never periwinkle lettering on the page: it measures 1.52:1 and
 * vanishes, which is exactly why it is a FILL token.
 */

/** Every sticker takes the same three, so a call site never has to learn a second shape. */
type StickerProps = {
  className?: string
  /** Degrees. Stickers are placed by hand and a stuck-on thing is never perfectly square. */
  rotate?: number
  /** Ink on the page, or the periwinkle fill. Defaults per component to whichever is right. */
  color?: string
}

/* ── ARROWS ──────────────────────────────────────────────────────────────────────────────
 * Four directions of the same gesture rather than one arrow rotated: a rotated arrow points
 * with the wrong hand — the curve leans the way it was drawn, and flipping it reads as a
 * mirrored copy of the one above it. Each path is drawn for its own direction.
 *
 * The stroke is deliberately not uniform in feel: round caps, a slightly loose curve, and an
 * arrowhead drawn as two separate strokes rather than a filled triangle, which is what keeps
 * it reading as MARKED rather than as an icon from a set.
 */
const ARROW_PATHS = {
  /** Sweeps down-left, head at the bottom. Points at something below and to the left. */
  downLeft: { d: "M78 8C74 34 62 56 40 68", head: "M52 62L38 69L44 55" },
  /** Sweeps down-right. */
  downRight: { d: "M14 8C18 34 30 56 52 68", head: "M40 62L54 69L48 55" },
  /** A long shallow sweep to the right — for pointing across a row. */
  right: { d: "M6 46C24 18 56 10 86 22", head: "M74 12L88 23L72 30" },
  /** A hook that turns back on itself, for pointing at the thing just above it. */
  hook: { d: "M20 74C12 48 26 22 54 18C74 15 82 26 78 38", head: "M86 32L77 41L69 33" },
} as const

export function Arrow({ dir = "downRight", className = "", rotate = 0, color = ACID }: StickerProps & {
  dir?: keyof typeof ARROW_PATHS
}) {
  const p = ARROW_PATHS[dir]
  return (
    <svg
      viewBox="0 0 92 80"
      aria-hidden
      className={className}
      style={{ transform: rotate ? `rotate(${rotate}deg)` : undefined, overflow: "visible" }}
    >
      <g fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round">
        <path d={p.d} />
        <path d={p.head} />
      </g>
    </svg>
  )
}

/* ── THE ROTARY BADGE ────────────────────────────────────────────────────────────────────
 * A stamped disc with its words running round the rim. The one piece here with motion, and
 * it turns slowly enough to read as a stamp rather than a spinner — a fast one reads as
 * "loading", which is the single wrong thing for a badge that is making a claim.
 *
 * THE SEPARATOR IS PART OF THE TEXT, not a decoration added around it. A ring of words with
 * no marks between them has no start, so the eye cannot find the beginning of the phrase.
 */
export function RotaryBadge({
  text = "START FREE",
  className = "",
  fill = ACID,
  ink = INK,
  spin = true,
}: {
  /** Short. It is set round a circle, so it runs out of rim fast. */
  text?: string
  className?: string
  fill?: string
  ink?: string
  spin?: boolean
}) {
  const id = useId()
  const reduce = useReducedMotion()
  const turning = spin && !reduce
  /* Repeated to FIT the rim, not a fixed number of times. A fixed three passes is right for
     "START FREE" and laps itself on anything longer — the words then overlap their own tail
     and the badge reads as a rendering fault. ~46 characters is what this rim holds at this
     size and tracking, so the count comes from the text. */
  const unit = `${text} • `
  /* FLOOR, and 40 not 46. Rounding up overruns the rim and the phrase collides with its own
     first letters, which is worse than a gap — a gap reads as spacing, an overlap reads as
     broken. Measured on this rim at this size: "START FREE • " fits three times at 39
     characters, so 40 is the ceiling and anything longer simply gets fewer passes. */
  const reps = Math.max(1, Math.floor(40 / unit.length))
  const ring = unit.repeat(reps)
  return (
    <svg viewBox="0 0 120 120" aria-hidden className={className} style={{ overflow: "visible" }}>
      <circle cx="60" cy="60" r="58" fill={fill} />
      <defs>
        {/* Inset from the disc edge by the cap height, or the letters sit half off the rim. */}
        <path id={`${id}-rim`} d="M60 14a46 46 0 1 1 0 92a46 46 0 1 1 0-92" fill="none" />
      </defs>
      <g style={turning ? { transformOrigin: "60px 60px", animation: "eg-badge-spin 22s linear infinite" } : undefined}>
        <text
          fill={ink}
          fontSize="11.5"
          fontWeight={600}
          letterSpacing="1.6"
          style={{ fontFamily: "var(--font-sans, inherit)" }}
        >
          <textPath href={`#${id}-rim`}>{ring}</textPath>
        </text>
      </g>
      {/* The mark in the middle. A badge with an empty centre reads as a ring, not a stamp. */}
      <circle cx="60" cy="60" r="7" fill={ink} />
      <style>{"@keyframes eg-badge-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}"}</style>
    </svg>
  )
}

/* ── THE SWING TAG ───────────────────────────────────────────────────────────────────────
 * The thing that hangs off a garment, and the most literal object this company owns: every
 * order leaves here with one. Carries a short label — a size, a method, a price.
 */
export function SwingTag({ label, className = "", rotate = -6, color = ACID }: StickerProps & {
  label: string
}) {
  return (
    <span
      className={"inline-flex items-center gap-2 rounded-[3px] py-1.5 pl-2.5 pr-3 text-[11px] font-medium tracking-[0.08em] " + className}
      style={{
        background: color,
        color: INK,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        textTransform: "uppercase",
      }}
    >
      {/* The punched eyelet. Without it this is a chip; with it, it is a tag. */}
      <span
        aria-hidden
        className="block h-2 w-2 shrink-0 rounded-full"
        style={{ background: SURFACE, boxShadow: `inset 0 0 0 1px ${INK}` }}
      />
      {label}
    </span>
  )
}

/* ── THE MARKER HIGHLIGHT ────────────────────────────────────────────────────────────────
 * One word in a sentence, struck through with a marker. Uneven top and bottom edges and a
 * slight rotation, because a perfectly rectangular highlight reads as a `<mark>` element and
 * not as something a person did.
 *
 * IT SITS BEHIND THE TEXT, never over it — a translucent overlay knocks the type back and
 * the highlighted word ends up the LEAST readable one in the line, which inverts the point.
 */
export function Highlight({ children, color = ACID }: { children: React.ReactNode; color?: string }) {
  /* `isolation: isolate` is load-bearing. The bar was `-z-10`, which does not put it behind
     the WORD — it puts it behind the nearest stacking context, i.e. the page, where it is
     invisible. A local stacking context plus an explicit order is the fix: bar at 0, word
     above it. This rendered as nothing at all until it was actually looked at. */
  return (
    <span className="relative inline-block" style={{ isolation: "isolate" }}>
      <span
        aria-hidden
        className="absolute inset-x-[-0.18em] top-[0.14em] bottom-[0.06em] -rotate-[0.8deg]"
        style={{ background: color, borderRadius: "0.28em 0.42em 0.3em 0.36em", zIndex: 0 }}
      />
      <span className="relative" style={{ zIndex: 1 }}>{children}</span>
    </span>
  )
}

/* ── THE SNAPSHOT FRAME ──────────────────────────────────────────────────────────────────
 * A photograph pinned to the page with a caption written under it. The wide bottom margin is
 * the whole device — an even border is a picture frame, and the heavy bottom is what says
 * "snapshot". Use it for a detail crop beside a full-bleed band, never for the band itself.
 */
export function Snapshot({ children, caption, className = "", rotate = -2 }: {
  children: React.ReactNode
  /** Handwritten in tone, short. It is a note on a photo, not a paragraph. */
  caption?: string
  className?: string
  rotate?: number
}) {
  return (
    <figure
      className={"inline-block p-2.5 pb-0 " + className}
      style={{
        background: SURFACE,
        border: `1px solid ${HAIRLINE}`,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
      }}
    >
      <div className="overflow-hidden">{children}</div>
      <figcaption
        className="px-0.5 py-2.5 text-center text-[11px] tracking-[0.04em]"
        style={{ color: ACCENT }}
      >
        {caption}
      </figcaption>
    </figure>
  )
}
