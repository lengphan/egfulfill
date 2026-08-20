/**
 * THE CARRIER'S WORD ABOUT A PARCEL — one vocabulary, in one place.
 *
 * This is NOT a pipeline stage and must never become one. `shipped` is our claim: we
 * handed the parcel over, and that stays true whatever happens next. This is a different
 * party's claim about the same parcel, and the two are kept apart on purpose — so a
 * webhook can never move an order behind the floor's back, and every stage rule still
 * only has to reason about states a human set.
 *
 * It lived in three copies (the shipments table, the shipment window, the order badge)
 * which had already drifted into three vocabularies for five states: "Not collected" /
 * "Not scanned yet" / "Preshipment" for the same fact, "Returning" beside "Returned".
 * A reader crossing two screens met different words for one parcel. See CLAUDE.md §5.
 *
 * The TONE is split rather than the words: a table colours the word itself, because a
 * column of filled capsules is a column of stickers, while a badge beside a stage pill has
 * to be a pill or the pair reads as one control and one caption. Same hue either way, and
 * these hues are the floor's reserved vocabulary — amber waiting, emerald done, rose wrong.
 */

const WORD: Record<string, string> = {
  awaiting_pickup: "Preshipment",
  in_transit: "In transit",
  delivered: "Delivered",
  returned: "Returned",
  failed: "Delivery failed",
}

/** The status name alone. Unknown values pass through — the carrier's own word beats ours. */
export const deliveryWord = (s?: string | null): string | null => (s ? (WORD[s] ?? s) : null)

/** Coloured type, for a column of them. */
export const DELIVERY_TEXT_TONE: Record<string, string> = {
  awaiting_pickup: "text-amber-700 dark:text-amber-400",
  in_transit: "text-blue-700 dark:text-blue-400",
  delivered: "text-emerald-700 dark:text-emerald-400",
  returned: "text-rose-700 dark:text-rose-400",
  failed: "text-rose-700 dark:text-rose-400",
}

/** A pill, for standing beside a stage pill. */
export const DELIVERY_PILL_TONE: Record<string, string> = {
  awaiting_pickup: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  in_transit: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  delivered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  returned: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  failed: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
}
