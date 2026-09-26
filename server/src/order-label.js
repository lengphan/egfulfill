// What a human calls an order — mirrors numOf() in web/lib/order-format.ts.
import { q } from './db.js';

/**
 * THE NUMBER, NEVER THE KEY.
 *
 * `orders.id` is `FF-jc92mr-mtqqrbdq-9ngy8` for one of ours and `etsy-4162283361` for a
 * marketplace order. Neither is a number: nothing else in the product ever shows them,
 * because every other surface holds the row and prints `#seq`. A notification that says
 * "$3.00 charged on order FF-jc92mr-mtqqrbdq-9ngy8" is asking a seller to translate a
 * database key before they can tell which of their orders it is about.
 *
 * Ours is `#64`. A marketplace order keeps the receipt number the buyer and the marketplace
 * both quote, with the routing prefix taken off and a hash in front — Etsy prints its own
 * receipts that way too. The raw id is the LAST resort, for a row with neither.
 *
 * MIRRORS numOf in web/lib/order-format.ts. Same string on both sides of the wire, so a
 * notification and the page it opens cannot disagree about what the order is called.
 */
const SOURCE_PREFIX = /^(etsy|shopify|amazon|ebay|tiktok|woo|walmart)-/i;

export function orderLabel(id, seq, label) {
  /* A custom order ID someone chose ("T01") wins — it is what they will search for. */
  if (label != null && String(label).trim()) return String(label).trim();
  if (seq != null && Number(seq) > 0) return `#${Number(seq)}`;
  const plain = String(id ?? '').replace(SOURCE_PREFIX, '');
  return /^\d+$/.test(plain) ? `#${plain}` : String(id ?? '');
}

/** The same, when only the id is in hand. Reads `seq` and falls back to the id — a lookup
 *  that fails must not stop whatever was being announced. */
export async function orderLabelOf(id) {
  try {
    const r = await q('select seq, ref_label from orders where id=$1', [String(id)]);
    return orderLabel(id, r.rows[0]?.seq, r.rows[0]?.ref_label);
  } catch { return orderLabel(id, null); }
}
