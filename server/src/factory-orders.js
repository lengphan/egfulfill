import { q } from './db.js';

/**
 * WHOSE WORK IS THIS — the one derivation, in one place.
 *
 * `orders.factory_order` answers "does this order belong to a seller who pays us", and it is
 * derived from the OWNER'S ROLE and nothing else. A staff account's orders are the factory's
 * own; a seller's are the seller's. Every reader of the flag — the staff queue, the seller's
 * dashboard, the design-fee exemption — is asking that one question.
 *
 * IT IS DERIVED, SO IT GOES STALE. Promote a seller to staff and every order they already own
 * is suddenly misfiled: still flagged as a seller's, so the factory queue will not show it and
 * nobody is told. That is exactly what happened — an Etsy shop connected by an account that
 * public signup had made a seller (it always does), the account promoted four days later, and
 * 581 orders that no board would display. The statement to fix it already existed and ran at
 * route load; it had `.catch(() => {})` on it, so when it did not run, nothing said so, and
 * the answer took a day of looking.
 *
 * So it lives here, it reports what it did, and it is called at the two moments that matter:
 * when the API starts, and when a role actually CHANGES. A role change is an EVENT — it cannot
 * happen on its own, and it is the only thing that can invalidate this — so it is the right
 * trigger, rather than a timer sweeping a table on the chance somebody edited a row (§2.8: a
 * condition, not a poll).
 *
 * Idempotent by construction: the where clause touches only rows whose flag disagrees, so a
 * second run is `UPDATE 0`.
 */
const RULE = "exists (select 1 from users u where u.id = orders.seller_id and u.role <> 'seller')";

/**
 * Bring every order's `factory_order` back in step with its owner's role.
 *
 * @param {string} why  what prompted it, for the log line
 * @returns {Promise<number|null>} rows corrected, or null if it could not run
 */
export async function reclassifyFactoryOrders(why = 'startup') {
  try {
    const r = await q(`update orders set factory_order = ${RULE} where factory_order is distinct from ${RULE}`);
    const n = r.rowCount || 0;
    /* SILENT ONLY WHEN THERE IS NOTHING TO SAY. A correction is news — it means orders moved
       between the factory's books and a seller's — so it is logged every time it happens, and
       a clean run says nothing rather than adding a line per boot to the noise. */
    if (n > 0) console.log(`[factory_order] reclassified ${n} order(s) after ${why}`);
    return n;
  } catch (e) {
    /* NOT SWALLOWED. The whole reason this took a day to find is that the previous version
       could fail without anyone hearing. It still must not stop the API from starting — the
       flag being stale is a display problem, a server that will not boot is an outage (§2.1). */
    console.error(`[factory_order] reclassify after ${why} FAILED:`, e.message);
    return null;
  }
}
