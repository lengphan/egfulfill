/**
 * HOW A STATUS LOOKS — weight, not colour.
 *
 * The status chip used to be a tinted capsule per state, drawn from nine reserved hues. That
 * was measured and it did not hold: 16 of 36 pairs sat under the 0.150 OKLab separation
 * floor, with `packed` and `info` at 0.010 — the same colour twice. The nine shared three
 * lightness steps and four chroma steps, so only HUE separated them, which is why a column
 * of them read as one muddy family rather than as nine decisions.
 *
 * Re-stepping the hues was the wrong repair. §4's house style is ink on paper with ONE
 * bright thing, and type doing the work decoration usually does. A rainbow of capsules is
 * the generic SaaS status pill; it belongs to no design system and it made the app read as
 * assembled rather than designed.
 *
 * So a status is a WORD, set in one of three registers:
 *
 *   LIVE       something is happening, or someone is expected to act    heavy ink
 *   SETTLED    it is finished, cancelled or refunded — nothing to do    light, muted
 *   ATTENTION  it is stuck and a person is needed                       heavy ink + a rule
 *
 * The rule under ATTENTION is a SHAPE, so it survives a colourblind operator, a bad screen
 * on the factory floor, and a printed sheet — none of which a hue survives.
 *
 * ONE definition, imported by both tone maps. lib/factory-status.ts and lib/order-status.ts
 * each carried their own colour table and they had already drifted apart (six tones against
 * seven, `wait` against `review` for the same idea). A second copy disagrees the first time
 * one of them is edited.
 */
export const STATUS_TONE = {
  /** Working, in review, pending — the order is moving or waiting on us. */
  live: "font-semibold text-foreground",
  /** Shipped, cancelled, refunded, draft — settled, nothing to do. */
  settled: "font-normal text-muted-foreground",
  /** On hold, action needed — stuck, and a person has to move it. */
  attention: "font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px]",
} as const

export type StatusTone = keyof typeof STATUS_TONE
