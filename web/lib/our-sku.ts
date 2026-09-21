/**
 * OUR CODE, OR NOTHING — never the supplier's.
 *
 * `catalog_products.sku` is meant to hold the code WE assigned (`EG-1002`), with the
 * manufacturer's part number kept apart in `supplierSku`. On 8 of 30 live products it does
 * not: a supplier import wrote the vendor's own code straight into it — `10-271-016-SM`,
 * `100-632-120342`, `10892` — because nobody had assigned one yet. So everything that prints
 * a sku was printing OTTO's and S&S's part numbers: the blank dropdown a seller picks from,
 * the sheet they fill in, and every variant strip on every board.
 *
 * That is §2.9 in its quietest form. Not a field called `supplier` — just a number that can be
 * pasted into a distributor's search box. A sku is therefore shown only when it is ours, and a
 * product without one is named instead of coded.
 *
 * IT IS A DISPLAY RULE AND NOTHING ROUTES ON IT. Stock is still held against `p.sku`, the
 * resolvers still match on it, and a line already carrying "10892 - Adams Headwear LP104"
 * still resolves — both resolvers try the whole string and then each half, and the half that
 * is the NAME still matches.
 *
 * ITS OWN MODULE, so the app's boards and the catalogue helpers can both import it without
 * either owning it. MIRRORS ourSku() in server/src/pricing.js — the sheet's dropdown is built
 * server-side, and the two must agree about what "ours" means or one product would be offered
 * under two different strings. tools/check-blank-resolve.mjs runs both.
 */
/**
 * A BARE NUMBER IS OURS, AND IT IS PRINTED `EG-5000` (owner, 2026-09-21).
 *
 * `5000`, `10895`, `13124`, `108084` — four live products whose sku is nothing but digits.
 * They are not vendor part numbers in the sense the note above means: a part number has
 * shape (`100-632-120342`, `10-271-016-SM`), and a bare integer carries none. Withholding
 * them printed a NAME where every other row printed a code, which is the "organized" the
 * owner is after — a column that is a code on some rows and a sentence on others.
 *
 * PREFIXED, NOT REWRITTEN, and that distinction is the whole safety of this change. Nothing
 * on the backend moves: stock stays keyed on `5000`, publish still writes `p.sku`, and the
 * row in catalog_products is untouched. This is the display rule the file's own title claims
 * to be — the owner's words, "purely front end to make it more organized".
 *
 * WHAT IT COSTS, paid in blankCandidates: the import sheet's dropdown text IS the imported
 * cell, so a seller now picks `EG-5000` for a product whose sku is `5000`. Both resolvers
 * therefore strip a leading `EG-` as one of the candidates they try. tools/check-blank-resolve.mjs
 * runs both over that exact case.
 *
 * Anything with a hyphen or a letter still returns "" — those ARE the supplier's, and §2.9
 * has not moved.
 */
const BARE_NUMBER = /^\d+$/

export function ourSku(sku: string | null | undefined): string {
  const s = String(sku ?? "").trim()
  if (/^EG-/i.test(s)) return s
  return BARE_NUMBER.test(s) ? `EG-${s}` : ""
}

/**
 * THE CODE TO PRINT: ours if it has one, the supplier's if that is all there is.
 *
 * Preferring ours matters exactly where BOTH exist — a product carrying `EG-1005` and
 * `102-664-001` must be offered, filed and read as EG-1005. Showing the supplier's when ours
 * is missing beats showing nothing: a catalogue holds near-identical names, and the code is
 * the half that tells two cuts of the same shirt apart while somebody is picking one.
 *
 * A blank where a code should be is also the wrong lesson to teach. The real fix is that every
 * product HAS one of ours, which is why the editor now says so at the moment a product is
 * created rather than leaving it to be noticed on a dropdown months later.
 */
export function displaySku(p: { sku?: string | null; supplierSku?: string | null } | null | undefined): string {
  return ourSku(p?.sku) || String(p?.supplierSku ?? "").trim() || String(p?.sku ?? "").trim()
}
