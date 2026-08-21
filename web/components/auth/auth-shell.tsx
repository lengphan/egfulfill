import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import {
  INK,
  AUTH_GROUND,
  AUTH_FIELD,
  AUTH_EDGE,
  AUTH_MUTED,
  HAIRLINE,
} from "@/components/marketing/bold-kit"

/**
 * Shared shell for the auth pages (login / signup / forgot / reset) — one layout, one wordmark.
 *
 * Auth belongs to the MARKETING look, not the app shell (CLAUDE.md §4): signing in is the last
 * page of the marketing site rather than the first page of the product. Which is why dropping
 * the beige reached here too — every value below comes from the skin, so this page has no
 * palette of its own to keep in step.
 *
 * ── WHAT CHANGED, AND WHY A WHITE PAGE NEEDED MORE THAN A NEW COLOUR ─────────────────────
 *
 * The old ground was #F2F1EC, and it was doing structural work nobody had named: white fields
 * on warm paper had an edge for free, and the form had a shape because the paper stopped
 * where the browser began. Set the ground to white and all of that quietly goes — the
 * screenshot is a form floating in a void, with three enormous vertical gaps and no object
 * anywhere on the page. "Clean" and "unfinished" look identical from a distance.
 *
 * So the form gets a CARD: a hairline and a radius, holding one column at a readable measure.
 * It is white on white and the rule is the only thing drawing it, which is the point — the
 * page reads as a surface with one thing on it rather than as an empty document.
 *
 * THE HAIRLINE IS NOT THE FIELD BORDER. Two rules, two jobs, two values, and conflating them
 * is what makes a form look like a spreadsheet: --mk-auth-edge is a CONTROL boundary with a
 * 3:1 floor under it (a field you cannot find is a field you cannot fill), while
 * --mk-hairline separates two areas nobody interacts with and has no floor at all. At 3:1 a
 * card border becomes the loudest thing on a page whose entire job is one form.
 *
 * The type came down with it. The heading was `text-3xl font-semibold` — 30px of near-black
 * over a 14px form, which is poster proportion, not software. It is `text-xl` with tight
 * tracking now, and the wordmark went from 3xl to lg: a sign-in page is not a hero, and the
 * two of them stacked were competing for the same job.
 */
export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div
      className="flex min-h-svh flex-col items-center justify-center px-5 py-12"
      style={{ background: AUTH_GROUND }}
    >
      {/* 400px, not max-w-sm (384). A card has padding the bare form did not, and at 384 the
          measure inside it drops below where an email address stops wrapping. */}
      <div className="w-full max-w-[400px]">
        {/* CENTRED, and small. Left-aligned it sat above a centred card with nothing under
            its left edge, which reads as an alignment mistake rather than a decision. */}
        <Link
          href="/"
          className="mx-auto mb-7 block w-fit text-lg font-semibold tracking-tight"
          style={{ color: INK }}
        >
          egful
        </Link>

        <div
          className="rounded-2xl px-7 py-7"
          style={{ background: AUTH_FIELD, border: `1px solid ${HAIRLINE}` }}
        >
          {/* The page's own heading. Each auth page passes its own copy, so this one component
              covers sign-in, sign-up, forgot and reset without any of them knowing what the
              shell looks like. */}
          <h1
            className="text-xl font-semibold tracking-tight"
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
           * and a white field on a white card has no edge of its own, so without a real border
           * the controls are decoration rather than findable. AUTH_EDGE is the first step up the
           * ramp that clears the 3:1 boundary floor.
           *
           * --border is the CARD's rule, not the field's — it was set to AUTH_EDGE, which is why
           * the "or" divider and every separator inside the form drew at control weight. A
           * divider is not a control.
           */}
          <div
            className="mt-6 [&_[data-slot=input]]:border-(--auth-edge) [&_[data-slot=input]]:bg-(--auth-field)"
            style={
              {
                color: INK,
                "--auth-edge": AUTH_EDGE,
                "--auth-field": AUTH_FIELD,
                "--border": HAIRLINE,
                "--muted-foreground": AUTH_MUTED,
                // `text-foreground` sets colour EXPLICITLY, so inheriting from the wrapper above
                // does not reach it — "Create account" rendered at the app's foreground until
                // this was here.
                "--foreground": INK,
                // The "or" divider punches through its rule with `bg-card`. That has to be the
                // CARD's ground now, not the page's — they were the same colour when the page
                // was warm and the card did not exist.
                "--card": AUTH_FIELD,
                "--background": AUTH_FIELD,
              } as CSSProperties
            }
          >
            {children}
          </div>
        </div>

        <Link
          href="/"
          className="mx-auto mt-6 block w-fit text-xs transition-opacity hover:opacity-70"
          style={{ color: AUTH_MUTED }}
        >
          ← Back to egful
        </Link>
      </div>
    </div>
  )
}
