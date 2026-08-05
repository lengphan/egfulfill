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
 * The waves. Decoration, and deliberately the only decoration on the page.
 *
 * Three stacked bands in PAPER at 5–13% over the plate, plus one hairline in the green. They
 * are tints of colours already in the system rather than new hues, so the plate stays the one
 * violet and nothing here can drift when it moves.
 *
 * `preserveAspectRatio="none"` lets the SVG stretch to any width — the waves are a backdrop,
 * not a figure, so distorting them is correct and keeps a 380px phone and a 2560px monitor
 * both looking deliberate. `aria-hidden` + `pointer-events-none` keep it out of the
 * accessibility tree and out of the way of the form.
 *
 * Static on purpose: the house style is that motion is spatial and meaningful, and a
 * perpetually drifting background on a sign-in form is neither.
 */
function Waves() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[42svh] w-full select-none"
      viewBox="0 0 1440 320"
      preserveAspectRatio="none"
    >
      <path
        d="M0,160 C240,100 480,220 720,180 C960,140 1200,60 1440,120 L1440,320 L0,320 Z"
        fill={SURFACE}
        opacity="0.05"
      />
      <path
        d="M0,200 C260,150 520,260 780,210 C1040,160 1240,120 1440,170 L1440,320 L0,320 Z"
        fill={SURFACE}
        opacity="0.08"
      />
      <path
        d="M0,250 C300,200 600,290 900,250 C1140,218 1300,190 1440,225 L1440,320 L0,320 Z"
        fill={SURFACE}
        opacity="0.13"
      />
      {/* One green hairline riding the crest — the single accent, same role the acid plays
          everywhere else in the system. */}
      <path
        d="M0,150 C240,90 480,210 720,170 C960,130 1200,50 1440,110"
        fill="none"
        stroke={ACID}
        strokeWidth="2"
        opacity="0.5"
      />
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
