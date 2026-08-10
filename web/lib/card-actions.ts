import { buttonVariants } from "@/components/ui/button"

/**
 * The action row at the bottom of a product-ish card — SpyDeck results, uploaded products,
 * Alibaba discovery. One definition, because three of them had drifted apart:
 *
 *   SpyDeck      rounded-full + py-1.5 (no height), tinted violet | solid grey, both iconed
 *   Alibaba      h-7 rounded-full (Button) | h-7 rounded-MD hand-rolled anchor, no icons
 *
 * so the same pair of choices was a different height, a different corner and a different
 * weight depending on which card you were looking at. The Button primitive is already
 * `rounded-full`, so the pill was never the odd part — the hand-written classes were.
 *
 * These are just `buttonVariants` with the card metric (h-7, 12px) applied, so a card action
 * is literally the app's button and inherits its focus ring, disabled state and dark mode.
 * Add `flex-1` at the call site; the two halves are equal by default, which is what makes a
 * pair read as two choices rather than a button beside a decorated link.
 *
 * PRIMARY carries an icon, SECONDARY is text-only. That difference is doing work: it's what
 * separates "the thing this card is for" from "the other thing you can do", without needing
 * a second colour.
 */
export const CARD_ACTION_PRIMARY = buttonVariants({ size: "sm" }) + " text-xs font-semibold"

export const CARD_ACTION_SECONDARY = buttonVariants({ variant: "outline", size: "sm" }) + " text-xs font-medium"

/** An icon-only action in the same row (remove, archive) — square, same height. */
export const CARD_ACTION_ICON = buttonVariants({ variant: "outline", size: "sm" }) + " w-8 shrink-0 px-0"
