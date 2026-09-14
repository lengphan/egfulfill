/**
 * THE VERTICAL RHYTHM, and why it is four values instead of a judgement per section.
 *
 * Every section on the marketing site is a rounded FILL sitting on the page ground. That
 * makes the gap between two of them a SEPARATOR rather than padding — it is the only thing
 * on the page saying how related two blocks are. A gap that varies at random therefore says
 * something at random, and the pages had grown six different top gaps (pt-4, 16, 20, 24, 28,
 * 32) and four different bottoms across five files. Nobody chose that; it is what happens
 * when the rule lives in someone's head instead of in a file (§4 — a rule with no component
 * is a wish).
 *
 * So there are two gaps, and each one means something:
 *
 *   STACK   — these two blocks are ONE idea continued. Consecutive step bands, a rail that
 *             belongs to the hero above it. A hairline of ground, so they read as a stack.
 *   SECTION — a new argument starts here.
 *
 * And two page edges: TOP clears the fixed header, END closes the page before the footer.
 *
 * If a section seems to need a gap that is not one of these, the question to ask is which of
 * the two relationships it has — not what number looks right.
 */

/** One idea continued. 8px — a seam, not a gap. */
export const STACK = "pt-2"

/** A new argument.
 *
 * 20px, down from 128 → 80 → 48. Every band here is a rounded fill on the page ground, so
 * this gap is the GUTTER BETWEEN TWO CARDS, not the air above a heading — and a card gutter
 * is small. Each step down was the same note from the owner and 48 still got it: "section
 * gaps feel very disconnected". The reason 48 still read as a corridor is that these bands
 * are ENORMOUS — 700px and more of saturated colour — and a gap reads relative to what it
 * separates, not in absolute pixels. Against a band that size, 48px of pale ground is a
 * stripe you notice; 20px is a seam you do not.
 *
 * It still has to be unmistakably larger than STACK, which is why STACK moved to 8px with it.
 * The two are a RATIO, not two numbers: 2.5× apart before and 2.5× apart now. Shrinking one
 * without the other is what would actually break the distinction. */
export const SECTION = "pt-5 md:pt-6"

/** The first section on a page — clears the fixed header (h-16) plus a breath. */
export const TOP = "pt-20 md:pt-24"

/* THERE IS NO `END` HERE ANY MORE. The clearance above the footer belongs to the marketing
   LAYOUT's <main>, because it has to hold on every route — including /features, /docs and the
   product detail page, which are not built from these components and would never have picked
   up a token defined here. Measured before the move: -28px to 192px across twelve routes. */

/**
 * The horizontal gutter every band shares, so a block edge never moves between pages — AND
 * the page's one width cap.
 *
 * IT WAS `px-6 md:px-8` AND NOTHING ELSE, so there was no container on this site at all: 27
 * section sites, every one of them growing with the window forever. On a 2560px monitor that
 * puts a 600px column of type at the far LEFT edge of a 2560px band with 1,900px of empty
 * ground beside it — which is what "a lot of pages are full width, very difficult to read"
 * is. The paragraphs were never the problem; most of them carry their own `max-w-*` and
 * measured 56–102 characters a line even at 2560. The BAND around them was the problem.
 *
 * 1480px, because the whole design was drawn at 1440. Below that the cap never binds and
 * nothing moves; at and above it every band settles at 1416px of content — within a few
 * pixels of what 1440 already gives — so a wide monitor sees the design it was composed at,
 * centred, rather than a stretched copy of it.
 *
 * THE HERO IS NOT IN HERE, deliberately. It does not use GUTTER: the garment is meant to
 * bleed off the right edge of the VIEWPORT, so capping it would strand it mid-page.
 */
export const GUTTER = "mx-auto w-full max-w-[1480px] px-6 md:px-8"
