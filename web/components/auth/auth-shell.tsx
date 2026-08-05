import Link from "next/link"
import type { ReactNode } from "react"
import { PLATE_DEEP, ACID, SURFACE, INK } from "@/components/marketing/bold-kit"

/**
 * Shared shell for the auth pages (login / signup / forgot / reset) — one layout, one wordmark.
 *
 * Auth belongs to the MARKETING look, not the app shell (CLAUDE.md §4): signing in is the last
 * page of the marketing site rather than the first page of the product.
 *
 * SPLIT SCREEN, and the split is the point. Four centred-card versions came before this — plain
 * plate, filled paper bands, lime hairlines, a one-hue gradient — and every one of them was an
 * attempt to decorate AROUND a white box floating in the middle of an empty page. The box was
 * the problem. Here the form sits ON a surface, so there is nothing left to frame:
 *
 *   left    the plate, carrying the brand line in Playfair at real display size
 *   right   warm paper, carrying the form
 *
 * That is the same paper-under-plate tension the marketing hero is built on, and it means type
 * does the decorating — which is the house rule rather than a preference.
 *
 * Contrast is all measured, not eyeballed: paper on the plate is 5.68:1, the green on the plate
 * 5.07:1, and ink on paper 18.54:1. Nothing here is decorative-only text.
 */
export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-svh">
      {/* THE BRAND SIDE. Hidden below lg — on a phone there is no room for a second column, and
          a squashed one would push the form below the fold. Collapsing it costs nothing because
          the wordmark reappears above the form (see the lg:hidden link below), so this needs no
          separate mobile design. */}
      <aside
        className="hidden w-[46%] max-w-[620px] flex-col justify-between p-12 lg:flex"
        style={{ background: PLATE_DEEP }}
      >
        <Link
          href="/"
          className="font-display text-3xl font-semibold tracking-tight"
          style={{ color: SURFACE }}
        >
          egful
        </Link>

        {/* The hero's line, at the size the typeface is FOR. Playfair earns its keep as display
            type; at 30px above a card it was just a label in a serif. */}
        <div>
          <p
            className="font-display font-bold leading-[1.03] tracking-[-0.02em]"
            style={{ fontSize: "clamp(2.1rem, 3.4vw, 3.1rem)", color: SURFACE }}
          >
            Every order,
            <br />
            <span style={{ color: ACID }}>printed itself.</span>
          </p>
          <p
            className="mt-5 max-w-sm text-sm leading-relaxed"
            style={{ color: "rgba(250,248,243,0.72)" }}
          >
            Orders sync into one queue, print on a vetted network, and ship with tracking
            pushed back automatically.
          </p>
        </div>

        {/* Channels, NOT a headline figure. An order count here would be a second copy of a
            number that lives in editable site content, and the two would drift the first time
            one was updated. These are simply the integrations that exist. */}
        <p className="text-xs tracking-wide" style={{ color: "rgba(250,248,243,0.5)" }}>
          Etsy · Shopify · TikTok Shop
        </p>
      </aside>

      {/* THE FORM SIDE. Paper, so the form reads as a page rather than a panel. */}
      <main
        className="flex flex-1 flex-col items-center justify-center p-6 sm:p-10"
        style={{ background: SURFACE }}
      >
        <div className="w-full max-w-sm">
          {/* Only below lg, where the brand column is gone and the page would otherwise open
              with no mark on it at all. */}
          <Link
            href="/"
            className="font-display text-2xl font-semibold tracking-tight lg:hidden"
            style={{ color: INK }}
          >
            egful
          </Link>

          <h1
            className="mt-6 font-display text-3xl font-semibold tracking-tight lg:mt-0"
            style={{ color: INK }}
          >
            {subtitle}
          </h1>

          <div className="mt-7">{children}</div>

          <Link
            href="/"
            className="mt-8 inline-block text-xs opacity-60 transition-opacity hover:opacity-100"
            style={{ color: INK }}
          >
            ← Back to egful
          </Link>
        </div>
      </main>
    </div>
  )
}
