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
export function ourSku(sku: string | null | undefined): string {
  const s = String(sku ?? "").trim()
  return /^EG-/i.test(s) ? s : ""
}
