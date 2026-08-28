import type { SVGProps } from "react"
import {
  WORDMARK_VIEWBOX, WORDMARK_PATH, MARK_E_VIEWBOX, MARK_E_PATH,
} from "@/shared/wordmark-art"

/**
 * ── THE WORDMARK ─────────────────────────────────────────────────────────────────────────
 *
 * INLINE, NOT AN <img>. The mark has to sit on the pale marketing header, the slate app
 * sidebar and a periwinkle band, and an <img> cannot inherit the colour of the thing it is
 * standing on. Inlined, the single path takes `currentColor` and every surface gets the right
 * mark from one file — no light copy and dark copy to keep in step.
 *
 * THE OUTLINES LIVE IN shared/wordmark-art.ts, not here. The phone draws this same mark
 * through react-native-svg, and 6,478 characters of path data copied into a second file is a
 * copy nobody would ever diff — a redraw on one side would silently never reach the other.
 * What stays here is how the WEB paints it; the shape is shared.
 *
 * Sized by HEIGHT and never by width — `w-auto` keeps the 2.28:1 aspect, so a wrapper that
 * squeezes it cannot distort the letterforms.
 */
export function Wordmark({ className = "h-[22px] w-auto", ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox={WORDMARK_VIEWBOX}
      fill="none"
      role="img"
      aria-label="EGFUL"
      className={className}
      {...rest}
    >
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d={WORDMARK_PATH} />
    </svg>
  )
}

/**
 * THE SINGLE-GLYPH MARK — the `e`, for square slots.
 *
 * THE e's OWN PATHS, not the wordmark cropped. Cropping the viewBox was the obvious version
 * and it does not work: this is a script face, so the g overlaps the e — its outline starts
 * at x 408 while the e runs to x 484 — and any frame wide enough to hold the e catches a
 * slice of the g with it. Visible immediately at favicon size as a stray dark sliver.
 *
 * So this carries the e's outline and its bowl, merged even-odd exactly as the full mark is.
 * Both are extracted from the same source artwork, so they still cannot disagree.
 *
 * Where it goes: a collapsed sidebar rail and the favicon. A 2.28:1 wordmark inside a 32px
 * square is four illegible pixels of lettering — the mark has to become one letter or the
 * slot has to stop pretending it can hold a wordmark.
 *
 * The frame is measured, not eyeballed: the `e` occupies x 14–484 and y 239–721 of the
 * 2048x899 artwork, so a 498-square centred on that holds it with even margins.
 */
export function WordmarkE({ className = "h-5 w-5", ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox={MARK_E_VIEWBOX} fill="none" role="img" aria-label="EGFUL" className={className} {...rest}>
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d={MARK_E_PATH} />
    </svg>
  )
}
