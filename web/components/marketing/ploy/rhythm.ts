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

/** One idea continued. */
export const STACK = "pt-4"

/** A new argument. */
export const SECTION = "pt-24 md:pt-32"

/** The first section on a page — clears the fixed header (h-16) plus a breath. */
export const TOP = "pt-24 md:pt-28"

/** The last section before the footer. */
export const END = "pb-24 md:pb-32"

/** The horizontal gutter every band shares, so a block edge never moves between pages. */
export const GUTTER = "px-6 md:px-8"
