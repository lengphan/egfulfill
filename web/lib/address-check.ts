/**
 * "WE COULD NOT CHECK" IS NOT "THIS ADDRESS IS WRONG".
 *
 * Two surfaces validate a shipping address as it is typed — the new-order page and the
 * new-label dialog — and both collapsed those two outcomes, in opposite directions:
 *
 *   new order     every failure became an amber warning, so a missing credential told the
 *                 seller their street was bad
 *   new label     a thrown request became `idle`, so the badge vanished and the address
 *                 looked unchecked in the same way an empty box does
 *
 * They are opposite messages. One says the carrier looked and did not like it — there is
 * something to fix. The other says nobody looked at all, and the address may be perfect.
 * CLAUDE.md §4: if a thing cannot be READ versus does not EXIST, say which.
 *
 * So there are three end states, not two: validated, rejected, and NOT VALIDATED — the last
 * shown quietly in grey, because nothing about it is actionable and the order or label saves
 * the address exactly as typed either way.
 */

/**
 * Did this failure mean "nobody could check", rather than "the carrier rejected it"?
 *
 * A THROWN REQUEST IS ALWAYS THIS — nothing came back, so nothing has an opinion. An empty
 * message is the same case: an error we cannot read is not evidence against the address.
 *
 * Matched on the message because that is all either API gives us. Deliberately broad: the
 * cost of calling a genuine rejection "unchecked" is a seller shipping to an address the
 * carrier already doubted, which the label buy will catch anyway — while the cost of the
 * reverse is telling someone their correct address is wrong, which they cannot fix at all.
 */
export function cannotCheck(raw?: string | null): boolean {
  const s = String(raw ?? "").toLowerCase()
  return (
    !s ||
    s.includes("addresses api") ||
    s.includes("not authorized") ||
    s.includes("access control") ||
    s.includes("unavailable") ||
    s.includes("not configured") ||
    s.includes("no token") ||
    s.includes("failed to fetch") ||
    s.includes("network") ||
    s.includes("timeout") ||
    s.includes("502") ||
    s.includes("503") ||
    s.includes("504")
  )
}

/** What to say when the carrier DID answer and rejected it. Validation is optional on both
 *  surfaces — the address saves as entered — so this stays a calm note, never an alarm. */
export function friendlyValidationError(raw?: string | null): string {
  const s = String(raw ?? "").toLowerCase()
  if (s.includes("addresses api") || s.includes("not authorized") || s.includes("access control")) {
    return "Address check is unavailable right now — you can still save the address as entered."
  }
  return String(raw ?? "") || "Couldn't verify this address — you can still save it as entered."
}
