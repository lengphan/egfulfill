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
 * THE GRADIENT IS ONE HUE. This is the whole point of it.
 *
 * Two decorated versions came before this and both were wrong in the same way — they added
 * VALUES. Filled paper bands read as four different purples; lime waves put a second colour
 * across the page as ornament. The depth here comes from lightening and darkening the ONE
 * violet instead: lit at the top, sinking at the bottom, no second hue anywhere.
 *
 * The stops are derived from PLATE_DEEP with color-mix rather than written as their own hex
 * values, so they cannot drift. Move the plate and the gradient moves with it — the same
 * reason the plate is a single exported constant in the first place.
 *
 * `background` is set FIRST as a flat colour and the gradient rides on `backgroundImage`.
 * That is the fallback: a browser without color-mix throws the whole gradient out as invalid
 * and lands on the flat plate, which is the previous design rather than a broken page.
 *
 * Frosted glass was considered and rejected for this screen specifically. A translucent panel
 * makes label and input contrast depend on whatever sits behind it — measured around 3:1 and
 * varying across the card, under the 4.5:1 floor — and the blur only reads at all against
 * foreign hues, so it would have cost the palette as well. The card here stays opaque, which
 * is what keeps every contrast on it a fixed, checkable number.
 */
const PLATE_GRADIENT =
  `radial-gradient(125% 95% at 50% 0%,` +
  ` color-mix(in oklab, ${PLATE_DEEP}, white 20%) 0%,` +
  ` ${PLATE_DEEP} 46%,` +
  ` color-mix(in oklab, ${PLATE_DEEP}, black 26%) 100%)`

export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div
      className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden p-6"
      style={{ background: PLATE_DEEP, backgroundImage: PLATE_GRADIENT }}
    >
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

      {/* A LONG, SOFT, LOW-OPACITY shadow rather than shadow-xl. Tailwind's step is tuned for
          a card on a light page; over a saturated plate it reads as a hard grey rim. This one
          is offset far down and blurred wide, so the card looks lifted off the gradient
          instead of stuck to it — which is the entire effect being asked for. */}
      <Card className="mt-7 w-full max-w-sm gap-0 p-6 shadow-[0_26px_60px_-20px_rgba(0,0,0,0.5)]">{children}</Card>

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
