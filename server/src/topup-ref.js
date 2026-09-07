// The human reference a top-up is reconciled by — EG000123, minted once, in one place.
import { q } from './db.js';

/**
 * WHY THIS IS A FILE AND NOT THREE COPIES OF A QUERY.
 *
 * vietqr.js, stripe.js and paypal.js each carried the same statement:
 *
 *   insert into settings (key,value,updated_at) values ('topup_seq','1',now())
 *   on conflict (key) do update set value = (settings.value::int + 1)::text
 *
 * and `settings.value` is JSONB. `::int` off a jsonb SCALAR works — until the stored value
 * is not a number, at which point every increment throws for good. Each caller wrapped it in
 * a try, so nothing surfaced: VietQR quietly fell back to `EG` + a base-36 timestamp, which
 * is the `EGMTQRTKU9` printed on a seller's transfer instead of `EG000123`; and the card
 * paths took their catch, which skips the topup_requests row AND the wallet credit.
 *
 * IT CANNOT THROW ON ANY CONTENT NOW. `value #>> '{}'` reads the scalar as text whether it
 * is stored as a JSON number or a JSON string, the digits are pulled out of whatever is
 * there, and a value with none at all restarts from zero rather than failing forever. A
 * counter that heals is worth more than one that is right only while nobody has touched it.
 */
export async function nextTopupRef() {
  try {
    const r = await q(
      `insert into settings (key, value, updated_at) values ('topup_seq', to_jsonb(1), now())
       on conflict (key) do update set
         value = to_jsonb(coalesce(nullif(regexp_replace(settings.value #>> '{}', '\\D', '', 'g'), '')::bigint, 0) + 1),
         updated_at = now()
       returning value`);
    const n = parseInt(String(r.rows[0]?.value ?? ''), 10);
    if (Number.isFinite(n) && n > 0) return 'EG' + String(n).padStart(6, '0');
  } catch { /* fall through — a reference is better than a refusal */ }
  /* Last resort only. Still EG + digits, so it reads like every other reference a seller has
     seen, rather than the base-36 string this used to produce. */
  return 'EG' + String(Date.now() % 1000000).padStart(6, '0');
}

/**
 * WHAT THE PAYER READS ON THEIR BANK SCREEN.
 *
 * The reference alone is a code. "TOPUP EG000123" is a code with a noun in front of it, and
 * that noun costs nothing: VietQR wraps whatever we send in its own virtual-account prefix
 * either way, so the line was never going to be short — it may as well start with a word.
 *
 * The REFERENCE stays exactly `EG000123`: it is what reconciliation matches on, and adding
 * the word to the stored ref would widen that match to the word.
 */
export const topupContent = (ref) => `TOPUP ${ref}`;
