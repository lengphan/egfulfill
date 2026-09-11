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

/* DELIVERY_PILL_TONE lived here and is GONE (2026-09-11). It dressed the carrier's status as
   a capsule, which StageBadge had already argued against for the stage beside it — "a pill has
   to carry meaning, and an order stage did, until every label in the app became one". Once
   Delivery got its own column the two sat adjacent, and a capsule beside a bare word read as
   two different kinds of fact. DELIVERY_TEXT_TONE below is what draws it now.

   Deleted rather than left unused: a colour table nothing renders is the shape check-skins.mjs
   was written about — PLATE_ACCENT sat at 2.10:1 for weeks with a comment claiming 6.53,
   because a dead export cannot look wrong. */
