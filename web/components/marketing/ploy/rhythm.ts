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

/** The horizontal gutter every band shares, so a block edge never moves between pages. */
export const GUTTER = "px-6 md:px-8"
