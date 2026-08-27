"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Stickers } from "@/components/auth/stickers"
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
/**
 * THE IMAGE PANEL — one frame per auth page, from `public/frames`.
 *
 * THE PANEL CARRIES NO TYPE, AND THAT IS A MEASURED DECISION, NOT A TASTE ONE.
 *
 * The obvious version put the wordmark and a line of display copy on the picture in ink.
 * §4's imagery direction allows ink type on a frame but forbids a SCRIM, so the type is
 * only legible where the frame happens to be light. Measuring the actual region the type
 * occupies (36,28 → 336,198 over the real 684×950 panel) against ink #0A0A0A:
 *
 *     floor-conveyor        mean 16.86   worst  5.13   pass
 *     hero-conveyor-egful   mean 17.09   worst  4.27   weak
 *     c-volume              mean 13.98   worst  2.03   fail
 *     rail-colourways       mean 13.15   worst  1.06   fail
 *     b-exploded            mean 12.10   worst  1.07   fail
 *     close-face            mean  5.57   worst  1.05   fail
 *     mid-applique          mean  3.40   worst  1.04   fail
 *
 * Two of seven pass, and mean contrast is worthless here — b-exploded reads 12.1 and still
 * puts letterforms on a shadow. On signup the line landed across the model's hair and was
 * simply unreadable. Restricting every page to the two conveyor shots would make four
 * screens look like one, so the words moved to the white column instead, where they are
 * legible against a known ground on every frame.
 *
 * If a line is ever wanted back ON a frame, measure the worst pixel first — not the mean,
 * and not by eye.
 *
 * §4's imagery direction is locked: one periwinkle #C0C4FF seamless, ink type, and NO
 * SCRIM. So the type sits at the TOP-LEFT of every frame, which is where all four of these
 * are lightest — a scrim would be the easy way to make any placement work, and it is
 * exactly what the direction rules out.
 *
 * None of these frames identifies a supplier (§2.9): the mailers and the floor carry OUR
 * mark, and the garments are unbranded. That has to stay true of the filename and the URL
 * as well as the picture.
 */
const FRAMES: Record<string, { src: string; pos?: string }> = {
  "/login": { src: "/frames/auth-login.jpg", pos: "50% 50%" },
  "/signup": { src: "/frames/auth-signup.jpg", pos: "48% 50%" },
  "/forgot-password": { src: "/frames/auth-forgot.jpg", pos: "50% 50%" },
  "/reset-password": { src: "/frames/auth-reset.jpg", pos: "52% 50%" },
}

export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  const pathname = usePathname()
  const frame = FRAMES[pathname ?? ""] ?? FRAMES["/login"]

  return (
    <div className="flex min-h-svh" style={{ background: AUTH_GROUND }}>
        {/* Below lg the panel goes entirely rather than becoming a short band: a 120px strip
            of a photograph is a texture, not a picture, and it would push the form off a
            phone's first screen for nothing. */}
        <aside className="relative hidden lg:block lg:w-[46%] xl:w-[48%]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a full-bleed background
              frame, not content; next/image would add a layout wrapper for no benefit here. */}
          <img
            src={frame.src}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: frame.pos ?? "50% 50%" }}
          />
          <Stickers />
        </aside>

        <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-[400px]">
            {/* The panel carries the wordmark on desktop, so a second one over the form
                would be the same word twice on one screen. */}
            <Link
              href="/"
              className="mb-8 block w-fit text-lg font-semibold tracking-tight"
              style={{ color: INK }}
            >
              egful
            </Link>

            {/* NO CARD HERE. The card exists because a form alone on white has no shape; the
                panel gives the page its shape instead, so the rule around the form becomes a
                box drawn around something that is already held. */}
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: INK }}>
              {subtitle}
            </h1>
            <div
              className="mt-6 [&_[data-slot=input]]:border-(--auth-edge) [&_[data-slot=input]]:bg-(--auth-field)"
              style={
                {
                  color: INK,
                  "--auth-edge": AUTH_EDGE,
                  "--auth-field": AUTH_FIELD,
                  "--border": HAIRLINE,
                  "--muted-foreground": AUTH_MUTED,
                  "--foreground": INK,
                  "--card": AUTH_GROUND,
                  "--background": AUTH_GROUND,
                } as CSSProperties
              }
            >
              {children}
            </div>

            <Link
              href="/"
              className="mt-8 block w-fit text-xs transition-opacity hover:opacity-70"
              style={{ color: AUTH_MUTED }}
            >
              ← Back to egful
            </Link>
          </div>
        </main>
      </div>
    )

}
