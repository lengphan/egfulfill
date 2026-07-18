// USD conversion for prices that arrive in someone else's currency.
//
// Etsy returns each listing in the SHOP's currency, so research results mixed "$39.00"
// with "MYR 111.00" and couldn't be compared or sorted meaningfully. We show one
// currency (USD) — but converting needs a real rate, because relabelling MYR 111 as
// $111 would overstate it by ~4x.
//
// Rates are fetched from a free endpoint and cached in memory. If it's unreachable we
// return null and the caller keeps the ORIGINAL currency rather than inventing a number.

const TTL_MS = 12 * 60 * 60 * 1000; // rates move slowly; twice a day is plenty
let cache = { at: 0, rates: null };
let inflight = null;

async function fetchRates() {
  const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  if (!d || d.result !== 'success' || !d.rates) throw new Error('bad rates payload');
  return d.rates; // units of <code> per 1 USD
}

/** Cached USD rate table, or null when unavailable. Concurrent callers share one fetch. */
export async function usdRates() {
  if (cache.rates && Date.now() - cache.at < TTL_MS) return cache.rates;
  if (!inflight) {
    inflight = fetchRates()
      .then((rates) => { cache = { at: Date.now(), rates }; return rates; })
      .catch(() => cache.rates)   // keep serving a stale table over failing outright
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * Convert to USD. Returns { usd, rate, converted } — `converted:false` means it was
 * already USD; `usd:null` means we had no rate and the caller must keep the original.
 */
export async function toUsd(amount, currency) {
  const n = Number(amount);
  const code = String(currency || 'USD').toUpperCase();
  if (!isFinite(n)) return { usd: null, rate: null, converted: false };
  if (code === 'USD') return { usd: n, rate: 1, converted: false };
  const rates = await usdRates();
  const rate = rates && Number(rates[code]);
  if (!rate || !isFinite(rate) || rate <= 0) return { usd: null, rate: null, converted: false };
  return { usd: Math.round((n / rate) * 100) / 100, rate, converted: true };
}
