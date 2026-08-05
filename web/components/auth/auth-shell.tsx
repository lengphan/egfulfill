import Link from "next/link"
import type { ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { PLATE_DEEP, ACID, SURFACE } from "@/components/marketing/bold-kit"

/**
 * Shared card shell for auth pages (login/signup/forgot/reset) — one wordmark, one layout.
 *
 * Auth belongs to the MARKETING look, not the app shell (CLAUDE.md §4): signing in is the
 * last page of the marketing site rather than the first page of the product. This sat on a
 * plain `bg-background` — a white card centred on a white page — so it was the one surface
 * the palette never reached, and it read as a different product to anyone arriving from
 * the site.
 *
 * The plate is the same PLATE_DEEP the hero and the header use, so there is exactly one
 * violet in the system and no second value here to drift when that one moves.
 */
/**
 * LINES, not bands. One plate colour and one accent — nothing else.
 *
 * The first version stacked filled paper bands over the plate, which read as several
 * different purples rather than one: each translucent fill made a new value, so the page
 * looked like it had a four-colour background instead of a violet one. Every fill is gone.
 * What is left is the green, drawn as line.
 *
 * The lines are grouped ABOVE and BELOW the form and never cross the middle band, so the card
 * sits in clear space rather than on top of a pattern. That is a real layout constraint, not
 * just a z-index: the card is opaque, so anything running under it would be hidden anyway —
 * the point is that nothing crowds the EDGES of the card either.
 *
 * `preserveAspectRatio="none"` stretches the curves to any viewport. They are a backdrop, not
 * a figure, so distorting them is correct. `aria-hidden` + `pointer-events-none` keep the
 * whole thing out of the accessibility tree and out of the form's way.
 *
 * Static on purpose: the house rule is that motion is spatial and meaningful, and a
 * perpetually drifting sign-in background is neither.
 */
function Waves() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full select-none"
      viewBox="0 0 1440 900"
      preserveAspectRatio="none"
    >
      {/* Paths run from -40 to 1480 rather than 0 to 1440 so no line ENDS on screen — a
          stroke that stops at the viewport edge reads as a broken graphic. */}
      <g fill="none" stroke={ACID} strokeLinecap="round">
        {/* Above the form. */}
        <path d="M-40,110 C260,30 520,180 780,110 C1020,46 1240,140 1480,80" strokeWidth="2" opacity="0.55" />
        <path d="M-40,185 C240,115 520,245 800,175 C1060,111 1260,200 1480,155" strokeWidth="1.5" opacity="0.28" />

        {/* Below it. Three, so the eye reads a current rather than a single stray rule. */}
        <path d="M-40,700 C260,620 520,780 780,700 C1040,626 1260,730 1480,660" strokeWidth="2" opacity="0.55" />
        <path d="M-40,772 C240,702 520,852 800,777 C1060,708 1280,802 1480,737" strokeWidth="1.5" opacity="0.34" />
        <path d="M-40,844 C280,784 540,912 820,847 C1080,788 1280,867 1480,812" strokeWidth="1.5" opacity="0.2" />
      </g>
    </svg>
  )
}

export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div
      className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden p-6"
      style={{ background: PLATE_DEEP }}
    >
      <Waves />
      {/* Everything above the waves. The stacking context is explicit rather than relying on
          source order, because the card carries a shadow that would otherwise land under the
          wave fills and read as a smudge. */}
      <div className="relative z-10 flex w-full flex-col items-center">
      {/* The wordmark sits ON the plate rather than inside the card. It belongs to the site,
          and lifting it out is what stops the card reading as a lone box floating in the
          middle of an empty page. Paper on the plate is 5.68:1, the green 5.07:1. */}
      <Link
        href="/"
        className="font-display text-3xl font-semibold tracking-tight"
        style={{ color: SURFACE }}
      >
        egful
      </Link>
      <p className="mt-2 text-sm" style={{ color: ACID }}>{subtitle}</p>

      <Card className="mt-7 w-full max-w-sm gap-0 p-6 shadow-xl">{children}</Card>

      <Link
        href="/"
        className="mt-6 text-xs opacity-70 transition-opacity hover:opacity-100"
        style={{ color: SURFACE }}
      >
        ← Back to egful
      </Link>
      </div>
    </div>
  )
}
