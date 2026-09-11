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
 * There is ONE tone map now, and no hue in it. This paragraph used to say the two shapes
 * (a coloured word in a table, a pill beside a stage pill) carried "the same hue either
 * way, and these hues are the floor's reserved vocabulary — amber waiting, emerald done,
 * rose wrong". BOTH HALVES OF THAT WERE FALSE. The values were stock Tailwind shades, not
 * the reserved --status-* tokens, and measured against the app's own 0.150 OKLab floor they
 * sat 0.048 / 0.046 / 0.059 from `backorder`, `shipped` and `alert` — close enough to be
 * read as those meanings while saying something else. A claim in a comment is not a
 * measurement; this is the third time that sentence has been the moral in this repo.
 *
 * The pill half is gone (Delivery got its own column and a capsule beside a bare word read
 * as two kinds of fact), and the word half is weight now, like every other status.
 */
import { STATUS_TONE } from "@/lib/status-tone"

const WORD: Record<string, string> = {
  awaiting_pickup: "Preshipment",
  in_transit: "In transit",
  delivered: "Delivered",
  returned: "Returned",
  failed: "Delivery failed",
}

/** The status name alone. Unknown values pass through — the carrier's own word beats ours. */
export const deliveryWord = (s?: string | null): string | null => (s ? (WORD[s] ?? s) : null)

/**
 * WEIGHT, for a column of them — the same three registers as every other status in the app
 * (lib/status-tone.ts), applied here on 2026-09-11.
 *
 * These five were stock Tailwind shades, which is what made them worth converting first:
 * measured against the app's own 0.150 OKLab floor, amber-700 sat 0.048 from `backorder`,
 * emerald-700 0.046 from `shipped` and rose-700 0.059 from `alert`. They were borrowing
 * three reserved meanings from the factory floor to say something else entirely.
 *
 * The mapping is the carrier's fact, not ours: a parcel moving is LIVE, a delivered one is
 * SETTLED, and returned/failed are the two that need a person — which is exactly what the
 * underline is for.
 */
export const DELIVERY_TEXT_TONE: Record<string, string> = {
  awaiting_pickup: STATUS_TONE.live,
  in_transit: STATUS_TONE.live,
  delivered: STATUS_TONE.settled,
  returned: STATUS_TONE.attention,
  failed: STATUS_TONE.attention,
}

/* DELIVERY_PILL_TONE lived here and is GONE (2026-09-11). It dressed the carrier's status as
   a capsule, which StageBadge had already argued against for the stage beside it — "a pill has
   to carry meaning, and an order stage did, until every label in the app became one". Once
   Delivery got its own column the two sat adjacent, and a capsule beside a bare word read as
   two different kinds of fact. DELIVERY_TEXT_TONE below is what draws it now.

   Deleted rather than left unused: a colour table nothing renders is the shape check-skins.mjs
   was written about — PLATE_ACCENT sat at 2.10:1 for weeks with a comment claiming 6.53,
   because a dead export cannot look wrong. */
