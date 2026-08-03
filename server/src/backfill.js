// The connect-time import window — "how far back should the FIRST import reach".
//
// One module because Etsy, Shopify and TikTok each carried a byte-identical private copy of
// clampDays, and the window's MEANING (what 0 is, whether it may shrink) now has to be the
// same on all three or the chooser means something different per channel.

/** Sanitize a chosen window → whole days in [0,365], or null when nothing was chosen
 *  (a connection made before the chooser existed). 0 = today only. */
export function clampDays(v) {
  if (v == null || v === '') return null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(365, n));
}

/**
 * The window may only ever WIDEN.
 *
 * A seller who imported 30 days and then reconnects at 7 is asking a question the system
 * can't answer honestly: the 30 days are already here, and no sync path deletes an order, so
 * "past 7 days" would neither remove the other 23 nor describe what's on screen. Narrowing
 * would therefore be a setting that silently does nothing — or, if it ever did do something,
 * it would do the one thing that must never happen (destroy synced data, CLAUDE.md §2.6).
 *
 * So the window ratchets. The UI offers only the wider options; this is the enforcement,
 * because the UI is a suggestion and the request body is whatever the client sends.
 *
 * null on either side means "no preference": an unchosen request keeps the stored window,
 * and a first choice on a connection that never had one is taken as-is.
 */
export function widenDays(existing, requested) {
  const a = clampDays(existing), b = clampDays(requested);
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

/** Unix seconds at the start of today, UTC.
 *
 *  UTC rather than a shop-local midnight: we don't reliably know the shop's timezone, and
 *  erring EARLIER is the safe direction — a slightly wider window imports an extra order,
 *  a narrower one silently misses one. For a seller west of UTC this reaches back a few
 *  hours into "yesterday", which is the mistake worth making. */
export function startOfTodaySec() {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
}

/**
 * The earliest create-time an import should reach, in unix SECONDS.
 *
 *   days > 0  → that many days back from now
 *   days === 0 → "Today": since midnight UTC. NOT since the moment of connecting — a shop
 *                connected at 4pm would otherwise miss everything sold that morning, which
 *                is not what "Today" says. This is the one case where the label and the
 *                behaviour had drifted.
 *   days null  → no choice recorded: fall back to when the shop was connected, which is the
 *                behaviour every pre-chooser connection has always had.
 */
export function windowStartSec(days, connectedSec) {
  const n = clampDays(days);
  if (n == null) return connectedSec || 0;
  if (n > 0) return Math.floor(Date.now() / 1000) - n * 86400;
  return startOfTodaySec();
}
