import type { CatalogProduct } from "@/lib/api"

/**
 * WHAT A PRODUCT'S STATUS MEANS, in one place.
 *
 * The ladder is the server's (server/src/routes/catalog.js, PUBLIC_STATUS / SELLER_STATUSES),
 * and this is the client's half of the same rule rather than a second opinion:
 *
 *   Active         public web + sellers + staff
 *   Sellers only   sellers + staff
 *   Draft          staff — unfinished
 *   Archived       staff — RETIRED, and the subject of this file
 *
 * Normalised the way the server normalises it, for the same reason: the editor is a <select>
 * so the casing is controlled, but an import or an API caller can write "active", and a
 * status that fails an exact match silently becomes invisible.
 */
export const statusOf = (p: Pick<CatalogProduct, "status">) =>
  String(p.status ?? "Active").trim().toLowerCase()

export const isArchived = (p: Pick<CatalogProduct, "status">) => statusOf(p) === "archived"

/**
 * MAY THIS BE PUT ON A NEW ORDER?
 *
 * Archiving is how a product is retired, and retiring one has to be safe — which means it
 * stops being OFFERED without ever becoming unresolvable. The distinction is the whole point:
 *
 *   NOT OFFERED    it is gone from the pickers, so nobody chooses it again.
 *   STILL RESOLVED every order that already names it keeps its name, its price and its
 *                  photo. quoteOrder prices from the catalogue, so a product that vanished
 *                  from the list would leave finished orders unpriceable — which is what
 *                  DELETING one used to do, and why the card no longer offers to.
 *
 * It also has to stay resolvable for orders still ARRIVING: a marketplace sync can bring in
 * an order for a listing whose blank we retired last week, and refusing that order would be
 * refusing a sale somebody already made (CLAUDE.md §2.6).
 *
 * Draft is deliberately NOT excluded here. A draft is a product being set up, and staff pick
 * them while setting them up; sellers never see one, because the server filters that.
 */
export const isOfferable = (p: Pick<CatalogProduct, "status">) => !isArchived(p)

/** The list a picker should show, in one call so no surface re-derives the rule. */
export const offerable = <T extends Pick<CatalogProduct, "status">>(rows: T[]) =>
  rows.filter(isOfferable)
