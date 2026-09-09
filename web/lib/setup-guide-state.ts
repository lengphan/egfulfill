/**
 * THE ONE PIECE OF THE SETUP GUIDE THAT SOMETHING ELSE HAS TO TOUCH.
 *
 * The guide remembers whether it was minimised, and the sign-in path has to clear that —
 * the checklist opens on every login, not only on the first visit a browser ever makes
 * (owner's call, 2026-09-09). Somebody who put it away on Tuesday and comes back on Friday
 * with two steps still open should be shown them, not a 12px circle.
 *
 * IT LIVES HERE RATHER THAN IN THE COMPONENT because lib/auth.ts is imported by every page
 * in the app, and importing setup-guide.tsx would drag React, motion and seven API fetchers
 * into the module that answers "am I signed in". A key and a one-line writer have no
 * dependencies at all, and one definition is what stops the two sides spelling it
 * differently — which is a bug that shows up as "the guide just never opens".
 */

/** Where the guide stores "the person minimised me". "0" = minimised; anything else = open. */
export const SETUP_OPEN_KEY = "eg_setup_open"

/**
 * Put the guide back to OPEN for the next render. Called on sign-in.
 *
 * Deliberately a REMOVE rather than a write of "1": absent is already the value the guide
 * reads as open, so this leaves the storage in the same state a brand-new browser is in
 * rather than inventing a second spelling for it.
 */
export function openSetupGuideOnNextLoad() {
  try {
    localStorage.removeItem(SETUP_OPEN_KEY)
  } catch {
    /* private mode — the guide falls back to open anyway, which is the behaviour we want */
  }
}
