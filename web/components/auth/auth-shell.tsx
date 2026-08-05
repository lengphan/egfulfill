import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import {
  ACID,
  SURFACE,
  PLATE_DEEP,
  BEIGE_GROUND,
  BEIGE_FIELD,
  BEIGE_EDGE,
} from "@/components/marketing/bold-kit"

/**
 * Shared shell for the auth pages (login / signup / forgot / reset) — one layout, one wordmark.
 *
 * Auth belongs to the MARKETING look, not the app shell (CLAUDE.md §4): signing in is the last
 * page of the marketing site rather than the first page of the product.
 *
 * THE PALETTE INVERTS HERE, and only here. Everywhere else the violet is the ground and the
 * lime is the accent sitting on it. On this page the ground is a warm dark beige, the lime
 * does the lettering, and the violet becomes the button — so the one saturated thing on the
 * screen is the control you are meant to press.
 *
 * There is no card, which is the point. Five earlier versions — flat plate, filled paper
 * bands, lime hairlines, a one-hue gradient, then a violet/paper split — were all attempts to
 * decorate around a white box floating in an empty page. The form sits directly on the ground
 * now, so there is nothing left to frame.
 *
 * Contrast is measured, not eyeballed (numbers live with the tokens in bold-kit):
 * lime lettering 11.59:1, paper labels 12.97:1, paper on a field 10.22:1, field edge 3.24:1,
 * and the button's paper label on violet 5.68:1.
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
          style={{ color: ACID }}
        >
          egful
        </Link>

        {/* The page's own heading, in the lime. Each auth page passes its own copy, so this
            one component covers sign-in, sign-up, forgot and reset without any of them
            needing to know what the shell looks like. */}
        <h1
          className="mt-7 font-display text-3xl font-semibold tracking-tight"
          style={{ color: ACID }}
        >
          {subtitle}
        </h1>

        {/* THE FORM RE-THEMES ITSELF, so none of the four auth pages had to change.
         *
         * The shadcn primitives read their colours from CSS variables, and a variable set on
         * an ancestor cascades — so overriding them here is what turns an app-coloured form
         * into a dark-ground one, rather than editing markup on login, signup, forgot and
         * reset and hoping the four stay in step.
         *
         * Two of these are load-bearing rather than cosmetic:
         *
         *   --brand   the default Button is `bg-brand`, and brand is the LIME. On this page
         *             the violet is the button, so brand is pointed at the plate colour and
         *             its label at paper — 5.68:1, real readable type.
         *   --input   Input ships `border-transparent` with `bg-input/50`. Over a dark ground
         *             a half-opacity fill lands ~1.1:1 and the field simply disappears, so the
         *             fill and a REAL border are set explicitly. BEIGE_EDGE is 3.24:1 against
         *             the ground, which is the floor for a control boundary.
         */}
        <div
          className="mt-7 [&_[data-slot=input]]:border-(--auth-edge) [&_[data-slot=input]]:bg-(--auth-field)"
          style={
            {
              color: SURFACE,
              "--auth-edge": BEIGE_EDGE,
              "--auth-field": BEIGE_FIELD,
              "--brand": PLATE_DEEP,
              "--brand-foreground": SURFACE,
              "--border": BEIGE_EDGE,
              "--muted-foreground": "rgba(250,248,243,0.65)",
              "--ring": ACID,
              // `text-foreground` sets colour EXPLICITLY, so inheriting from the wrapper
              // above does not reach it — "Create account" rendered near-black until this
              // was here.
              "--foreground": SURFACE,
              // The "or" divider punches through its rule with `bg-card`. Left at the app's
              // white, that is a white chip sitting on the dark ground.
              "--card": BEIGE_GROUND,
              "--background": BEIGE_GROUND,
            } as CSSProperties
          }
        >
          {children}
        </div>

        <Link
          href="/"
          className="mt-8 inline-block text-xs opacity-55 transition-opacity hover:opacity-100"
          style={{ color: SURFACE }}
        >
          ← Back to egful
        </Link>
      </div>
    </div>
  )
}
