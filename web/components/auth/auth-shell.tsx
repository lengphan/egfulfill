import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import {
  INK,
  AUTH_GROUND,
  AUTH_FIELD,
  AUTH_EDGE,
  AUTH_MUTED,
} from "@/components/marketing/bold-kit"

/**
 * Shared shell for the auth pages (login / signup / forgot / reset) — one layout, one wordmark.
 *
 * Auth belongs to the MARKETING look, not the app shell (CLAUDE.md §4): signing in is the last
 * page of the marketing site rather than the first page of the product.
 *
 * A LIGHT NEUTRAL GROUND — the marketing pages' own section tint, #F2F1EC. Two earlier
 * versions were both too dark: an espresso brown that read as near-black, then a real beige
 * that still felt like its own theme. This is literally the same paper the site is printed on.
 *
 * The type is INK, at 17.40:1. The LIME cannot letter this page and never could — it is a
 * light colour, so it only gets worse as the ground lightens (1.25:1 on the old beige, 1.05:1
 * here). The violet reaches 5.33:1 and could carry type, but doesn't need to: ink is the
 * marketing rule, and colour belongs to the one control.
 *
 * The brand pair appears exactly once, as the button — the one saturated thing on screen is
 * what you are meant to press. It needs no override to do that: the app's default Button is
 * already violet fill + lime label, and violet is 5.33:1 against this ground, well past the
 * 3:1 a control shape needs. Not overriding it is what stops this page drifting from the
 * buttons in the product.
 *
 * There is no card, deliberately. The form sits directly on the ground, so there is no white
 * box floating in an empty page to have to decorate around.
 */
export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div
      className="flex min-h-svh flex-col items-center justify-center p-6 sm:p-10"
      style={{ background: AUTH_GROUND }}
    >
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="font-display text-3xl font-semibold tracking-tight"
          style={{ color: INK }}
        >
          egful
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
         * ancestor cascades — so overriding them here is what re-themes the form, rather than
         * editing markup on login, signup, forgot and reset and hoping the four stay in step.
         *
         * --input is the load-bearing one. Input ships `border-transparent` with `bg-input/50`,
         * and a white field on this ground is only 1.13:1 — it has no edge of its own, so
         * without a real border the controls are decoration rather than findable. AUTH_EDGE is
         * 3.26:1, the first step up the ramp that clears the boundary floor.
         *
         * --brand is deliberately NOT overridden. The default Button is already the violet/lime
         * action pair and has a shape here without help.
         */}
        <div
          className="mt-7 [&_[data-slot=input]]:border-(--auth-edge) [&_[data-slot=input]]:bg-(--auth-field)"
          style={
            {
              color: INK,
              "--auth-edge": AUTH_EDGE,
              "--auth-field": AUTH_FIELD,
              "--border": AUTH_EDGE,
              "--muted-foreground": AUTH_MUTED,
              // `text-foreground` sets colour EXPLICITLY, so inheriting from the wrapper above
              // does not reach it — "Create account" rendered at the app's foreground until
              // this was here.
              "--foreground": INK,
              // The "or" divider punches through its rule with `bg-card`. Left at the app's
              // white, that is a white chip sitting on the neutral.
              "--card": AUTH_GROUND,
              "--background": AUTH_GROUND,
            } as CSSProperties
          }
        >
          {children}
        </div>

        <Link
          href="/"
          className="mt-8 inline-block text-xs transition-opacity hover:opacity-100"
          style={{ color: AUTH_MUTED }}
        >
          ← Back to egful
        </Link>
      </div>
    </div>
  )
}
