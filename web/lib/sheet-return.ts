/**
 * THE WAY BACK OUT OF A SHEET.
 *
 * Import is a DIALOG on the orders board, not a page, so "go back to import" has no URL to
 * push — closing the sheet lands you on a board with the dialog shut, which is the same
 * screen you would have got by pressing nothing. The dialog's own note says it opens the
 * sheet in the SAME window precisely so that Back keeps meaning "back", and then there was
 * nothing carrying where back was.
 *
 * So the origin rides in sessionStorage rather than in the URL. Two reasons it is not a query
 * param: `useSearchParams` in a client component needs a Suspense boundary above it or the
 * build fails, and orders-hub — a 2,800-line component — reads no params today; and a sheet's
 * address is a thing people paste to each other, where `?from=import` would be a lie the
 * moment it is opened by anyone else.
 *
 * sessionStorage, not localStorage: this is true of one tab for one journey. A stale "you came
 * from import" surviving a browser restart would reopen a dialog nobody asked for.
 *
 * ONE MODULE so the three files that speak this protocol cannot disagree about the key. Two
 * of them are the sheet pages and the third is the board; a private copy of a string literal
 * in each is how the handoff silently stops working when one is edited.
 */

const FROM_KEY = "eg_sheet_from"
const OPEN_KEY = "eg_open_import"

const store = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    // Safari in private mode throws on access rather than returning null.
    return null
  }
}

/** Called as import hands off to a sheet: remember that this journey started there. */
export function markCameFromImport() {
  store()?.setItem(FROM_KEY, "import")
}

/** Did this sheet get opened from the import flow? Drives the Back button's label AND target,
 *  so a sheet reached from the Sheets list still goes back to the Sheets list. */
export function cameFromImport(): boolean {
  return store()?.getItem(FROM_KEY) === "import"
}

/** Leaving the sheet for anywhere other than import ends the journey. Without this the flag
 *  outlives it, and a sheet opened from the list an hour later still claims an import origin. */
export function clearCameFromImport() {
  store()?.removeItem(FROM_KEY)
}

/** Ask the orders board to open the import dialog as soon as it mounts. */
export function requestImportOpen() {
  store()?.setItem(OPEN_KEY, "1")
}

/** Read-and-clear: the board consumes this once. Leaving it set would reopen the dialog on
 *  every subsequent visit to the board in this tab. */
export function consumeImportOpen(): boolean {
  const s = store()
  if (!s || s.getItem(OPEN_KEY) !== "1") return false
  s.removeItem(OPEN_KEY)
  return true
}
