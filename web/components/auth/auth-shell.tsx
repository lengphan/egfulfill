import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import {
  INK,
  BEIGE_GROUND,
  BEIGE_FIELD,
  BEIGE_EDGE,
  BEIGE_MUTED,
} from "@/components/marketing/bold-kit"

/**
 * Shared shell for the auth pages (login / signup / forgot / reset) — one layout, one wordmark.
 *
 * Auth belongs to the MARKETING look, not the app shell (CLAUDE.md §4): signing in is the last
 * page of the marketing site rather than the first page of the product.
 *
 * A LIGHT DARK-BEIGE GROUND, and the type is INK. The previous version put lime lettering on
 * an espresso ground; the ground is now an actual beige, and that single change decides
 * everything else on the page. Measured against BEIGE_GROUND: the lime is 1.25:1 and the
 * violet 4.06:1, so neither brand colour can carry type here — ink is 13.26:1 and does.
 *
 * The brand pair still appears exactly once, as the button, which is what the dark version was
 * reaching for: the one saturated thing on the screen is the control you are meant to press.
 * It needs no override to do that — the app's default Button is already violet fill + lime
 * label, so this page simply lets it be itself, and it can never drift from the buttons in the
 * product.
 *
 * There is no card, deliberately. The form sits directly on the ground, so there is no white
 * box floating in an empty page to have to decorate around.
 */
export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div
      className="flex min-h-svh flex-col items-center justify-center p-6 sm:p-10"
      style={{ background: BEIGE_GROUND }}
    >
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="font-display text-3xl font-semibold tracking-tight"
          style={{ color: INK }}
        >
          egfulfill
        </Link>

        {/* The page's own heading. Each auth page passes its own copy, so this one component
            covers sign-in, sign-up, forgot and reset without any of them knowing what the
            shell looks like. */}
        <h1
          className="mt-7 font-display text-3xl font-semibold tracking-tight"
          style={{ color: INK }}
        >
          {subtitle}
        </h1>

        {/* THE FORM RE-THEMES ITSELF, so none of the four auth pages had to change.
         *
         * The shadcn primitives read their colours from CSS variables, and a variable set on an
         * ancestor cascades — so overriding them here is what turns an app-coloured form into a
         * beige-ground one, rather than editing markup on login, signup, forgot and reset and
         * hoping the four stay in step.
         *
         * --input is the load-bearing one. Input ships `border-transparent` with `bg-input/50`,
         * and a white field on this ground is only 1.48:1 — it has no edge of its own, so
         * without a real border the controls are decoration rather than findable. BEIGE_EDGE is
         * 3.35:1, the first step that clears the boundary floor.
         *
         * --brand is deliberately NOT overridden here. The default Button is already the
         * violet/lime action pair, and violet is 4.06:1 against this ground, so it has a shape
         * without help. Overriding it is what would let this page drift from the product.
         */}
        <div
          className="mt-7 [&_[data-slot=input]]:border-(--auth-edge) [&_[data-slot=input]]:bg-(--auth-field)"
          style={
            {
              color: INK,
              "--auth-edge": BEIGE_EDGE,
              "--auth-field": BEIGE_FIELD,
              "--border": BEIGE_EDGE,
              "--muted-foreground": BEIGE_MUTED,
              // `text-foreground` sets colour EXPLICITLY, so inheriting from the wrapper above
              // does not reach it — "Create account" rendered at the app's foreground until
              // this was here.
              "--foreground": INK,
              // The "or" divider punches through its rule with `bg-card`. Left at the app's
              // white, that is a white chip sitting on the beige.
              "--card": BEIGE_GROUND,
              "--background": BEIGE_GROUND,
            } as CSSProperties
          }
        >
          {children}
        </div>

        <Link
          href="/"
          className="mt-8 inline-block text-xs transition-opacity hover:opacity-100"
          style={{ color: BEIGE_MUTED }}
        >
          ← Back to egfulfill
        </Link>
      </div>
    </div>
  )
}
