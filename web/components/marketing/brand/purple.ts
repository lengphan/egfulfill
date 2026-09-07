/**
 * ── THE PURPLE SYSTEM ────────────────────────────────────────────────────────────────
 *
 * A plain module — nothing here carries "use client", because the route reads it on the
 * server to resolve `/lab/<variant>`. (The hero picker taught this the hard way: an object
 * exported from a client module arrives at the server as a client REFERENCE, so `key in map`
 * is silently false and every request falls through to the default.)
 *
 * ── THE ONE RULE THAT MAKES IT WORK ──────────────────────────────────────────────────
 * Every ground is the SAME HUE at a different value, and the value decides the lettering:
 *
 *     dark purples  (indigo, violet, bright)  →  BONE type
 *     light purples (lilac, periwinkle, pale) →  SLATE type
 *
 * Measured, not eyeballed:
 *     bone on indigo #2A1E7A .............. 12.2:1
 *     bone on violet #4B37D9 ...............  6.7:1
 *     bone on bright #614EFA ...............  4.8:1   ← the floor, still passes body text
 *     slate on lilac #8B7BFF ...............  5.7:1
 *     slate on periwinkle #C0C4FF .......... 11.3:1
 *     bone on lilac ........................  3.0:1   ✗ never
 *     bone on periwinkle ...................  1.7:1   ✗ never
 *     slate on bright violet ...............  3.6:1   ✗ small text never
 *
 * So slate is a SURFACE on the dark purples and a TYPE colour on the light ones. It is never
 * small type directly on bright violet. That single flip is what stops the palette being
 * used interchangeably.
 */

export const P = {
  indigo: "#2A1E7A",
  violet: "#4B37D9",
  bright: "#614EFA",
  lilac: "#8B7BFF",
  peri: "#C0C4FF",
  pale: "#E7E6FF",
  slate: "#14161C",
  bone: "#F5F4F1",
} as const

/** Which lettering a ground takes. Derived, so no call site can guess wrong. */
export function inkOn(ground: string): string {
  return ground === P.lilac || ground === P.peri || ground === P.pale || ground === P.bone
    ? P.slate
    : P.bone
}

export type BandGround = string

export type PurpleVariant = {
  key: string
  label: string
  blurb: string
  /** One ground per band, in page order: hero, creed, statement, make, floor, why, blanks, who, scale, close. */
  grounds: BandGround[]
  /** Whether dense content sits on a slate plate laid over the ground. */
  plates: boolean
  /** Whether each band's content sits on a tint card of its own. */
  tints: boolean
}

export const VARIANTS: Record<string, PurpleVariant> = {
  plates: {
    key: "plates",
    label: "Plates on purple",
    blurb: "One violet ground the whole way. Slate plates float on it and carry everything dense.",
    grounds: [P.violet, P.bright, P.violet, P.violet, P.violet, P.bright, P.violet, P.violet, P.violet, P.violet],
    plates: true,
    tints: false,
  },
  descend: {
    key: "descend",
    label: "One hue, descending",
    blurb: "The ground lightens as you scroll — indigo to periwinkle — and the lettering flips at the midpoint.",
    grounds: [P.indigo, P.bright, P.indigo, P.violet, P.violet, P.bright, P.lilac, P.lilac, P.peri, P.peri],
    plates: true,
    tints: false,
  },
  tints: {
    key: "tints",
    label: "The tint system",
    blurb: "Violet everywhere, and every block sits on a card of a different tint of the same hue.",
    grounds: [P.violet, P.bright, P.violet, P.violet, P.violet, P.violet, P.violet, P.violet, P.violet, P.violet],
    plates: false,
    tints: true,
  },
}

/** The tint cards, in the order the bands use them. Same hue, six values. */
export const TINT_CARDS = [P.indigo, P.peri, P.slate, P.lilac, P.pale, P.indigo, P.peri, P.slate] as const

export const DEFAULT_VARIANT = "descend"
