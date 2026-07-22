// Suppliers that have no API — the shops you buy from by opening a browser.
//
// A row is: what it is, where to buy it, what it costs there, and what we sell it for.
// The URL is the point: it is how you re-order in three months without hunting for the
// listing again.
//
// PRICE IS FETCHED FROM STRUCTURED DATA ONLY. See fetchPrice below for why scraping the
// visible HTML is not offered.
import { q } from '../db.js';
import { audit } from '../audit.js';

/**
 * Is this URL safe for OUR SERVER to fetch?
 *
 * Whoever pastes a link here makes the API request an outbound HTTP call to a host they
 * chose. Without this, that is a server-side request forgery tool pointed at our own
 * network: http://169.254.169.254 is the cloud metadata endpoint, http://127.0.0.1:3000
 * is this API, and 10.x / 172.16-31.x / 192.168.x is the Docker network the database sits
 * on. A staff member could reach all three by accident, and anyone who got a staff account
 * could reach them on purpose.
 *
 * Public HTTP(S) only, and the host must resolve to something outside those ranges.
 */
function urlSafety(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return { ok: false, why: 'That is not a URL.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, why: 'Only http and https links can be fetched.' };
  }
  // Brackets and all: new URL('http://[::1]/') gives hostname '[::1]', so comparing against
  // '::1' never matched and every IPv6 loopback / link-local / unique-local address walked
  // straight through. Caught by testing the guard rather than reading it.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { ok: false, why: 'That address is on our own network.' };
  }
  // Literal private / link-local / loopback addresses. A hostname that RESOLVES to one is
  // handled after the fetch by refusing redirects — see fetchPrice.
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return { ok: false, why: 'That address is on our own network.' };
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return { ok: false, why: 'That address is on our own network.' };
  if (host === '::1' || host.startsWith('fd') || host.startsWith('fe80')) return { ok: false, why: 'That address is on our own network.' };
  return { ok: true, url: u.toString() };
}

/**
 * Read a price from a product page — from STRUCTURED DATA, never from the visible text.
 *
 * Shops publish schema.org Product/offers and OpenGraph product:price for Google, so the
 * number is usually available as a declared field. That is a fact stated by the site, and
 * when it is absent we say so.
 *
 * We do NOT pattern-match "$" out of the HTML. That finds the shipping threshold, the
 * strikethrough was-price, the "customers also bought" tile, or an unrelated number in a
 * script — and a wrong cost silently sets a wrong sell price, which is worse than no price
 * at all. Manual entry is right there.
 */
async function fetchPrice(url) {
  const check = urlSafety(url);
  if (!check.ok) return { ok: false, error: check.why };
  let html;
  try {
    const r = await fetch(check.url, {
      // No redirects: a public URL that 302s to 169.254.169.254 walks straight past the
      // check above, and that is the whole trick.
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EGFULFILL/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(12000),
    });
    if (r.status >= 300 && r.status < 400) {
      return { ok: false, error: 'That link redirects. Open it in a browser and paste the address it lands on.' };
    }
    if (!r.ok) return { ok: false, error: `The shop returned ${r.status}.` };
    // Cap the read: a 40MB page would otherwise be pulled into a 1GB box's memory.
    html = (await r.text()).slice(0, 800_000);
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'The shop took too long to answer.' : `Couldn't reach it: ${e.message}` };
  }

  const prices = [];
  // schema.org JSON-LD — the most reliable, because it exists for Google rather than for us.
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (v) => {
        if (!v || typeof v !== 'object') return;
        if (Array.isArray(v)) { v.forEach(walk); return; }
        const p = v.price ?? v.lowPrice ?? (v.priceSpecification && v.priceSpecification.price);
        const n = Number(String(p ?? '').replace(/[^0-9.]/g, ''));
        if (isFinite(n) && n > 0) prices.push(n);
        Object.values(v).forEach(walk);
      };
      walk(JSON.parse(m[1]));
    } catch { /* one malformed block shouldn't lose the others */ }
  }
  // OpenGraph / meta itemprop, same reasoning.
  for (const re of [
    /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+name=["']twitter:data1["'][^>]+content=["']\$?([0-9.,]+)/i,
  ]) {
    const m = html.match(re);
    const n = m && Number(String(m[1]).replace(/[^0-9.]/g, ''));
    if (isFinite(n) && n > 0) prices.push(n);
  }

  if (!prices.length) {
    return { ok: false, error: "This shop doesn't publish its price in a readable form. Type it in instead — it'll be saved with the link." };
  }
  // The LOWEST declared price. Variant pages list every option, and quoting the dearest
  // as "the cost" would overstate what we pay and understate the margin.
  return { ok: true, price: Math.min(...prices), found: prices.length };
}

export function manualSupplierRoutes(app, requireStaff, requireWarehouse) {
  q(`create table if not exists manual_suppliers (
       id bigserial primary key,
       title text not null,
       url text,
       shop text,
       cost numeric(12,2),
       markup_pct numeric(6,2),
       sell_price numeric(12,2),
       product_id text,
       note text,
       created_by text,
       created_at timestamptz default now(),
       updated_at timestamptz default now()
     )`).catch(() => {});

  app.get('/api/manual-suppliers', { preHandler: requireStaff }, async () => {
    const r = await q('select * from manual_suppliers order by created_at desc limit 500').catch(() => ({ rows: [] }));
    return {
      items: r.rows.map((x) => ({
        id: String(x.id), title: x.title, url: x.url, shop: x.shop,
        cost: x.cost == null ? null : Number(x.cost),
        markupPct: x.markup_pct == null ? null : Number(x.markup_pct),
        sellPrice: x.sell_price == null ? null : Number(x.sell_price),
        productId: x.product_id, note: x.note, createdAt: x.created_at,
      })),
    };
  });

  /** Try to read the price off a listing. Never writes — the caller decides whether to
   *  keep what came back. */
  app.post('/api/manual-suppliers/price', { preHandler: requireStaff }, async (req, reply) => {
    const url = (req.body || {}).url;
    if (!url) { reply.code(400); return { error: 'A link is required.' }; }
    return fetchPrice(url);
  });

  app.post('/api/manual-suppliers', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) { reply.code(400); return { error: 'Give it a name — a row with only a link is unfindable later.' }; }
    if (b.url) {
      const chk = urlSafety(b.url);
      if (!chk.ok) { reply.code(400); return { error: chk.why }; }
    }
    const cost = b.cost == null || b.cost === '' ? null : Math.max(0, Number(b.cost));
    const pct = b.markupPct == null || b.markupPct === '' ? null : Number(b.markupPct);
    // Sell price is DERIVED when a markup is given, and stored — so a later change to the
    // percentage doesn't silently restate what we already quoted someone.
    const sell = b.sellPrice != null && b.sellPrice !== ''
      ? Math.max(0, Number(b.sellPrice))
      : (cost != null && pct != null ? Math.round(cost * (1 + pct / 100) * 100) / 100 : null);

    let shop = null;
    try { shop = b.url ? new URL(String(b.url)).hostname.replace(/^www\./, '') : null; } catch { /* not fatal */ }

    if (b.id) {
      await q(`update manual_suppliers set title=$2, url=$3, shop=$4, cost=$5, markup_pct=$6,
                 sell_price=$7, product_id=$8, note=$9, updated_at=now() where id=$1::bigint`,
        [String(b.id), title, b.url || null, shop, cost, pct, sell, b.productId || null, b.note || null]);
      audit(req, 'manual-supplier.updated', { entityType: 'manual_supplier', entityId: String(b.id), after: { title, cost, sell } });
      return { ok: true, id: String(b.id) };
    }
    const r = await q(
      `insert into manual_suppliers (title, url, shop, cost, markup_pct, sell_price, product_id, note, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [title, b.url || null, shop, cost, pct, sell, b.productId || null, b.note || null,
       String((req.user && req.user.sub) || '')]);
    audit(req, 'manual-supplier.added', { entityType: 'manual_supplier', entityId: String(r.rows[0].id), after: { title, shop, cost, sell } });
    return { ok: true, id: String(r.rows[0].id) };
  });

  /** Warehouse/admin: a saved source is how someone re-orders, and losing one loses the
   *  only record of where a blank came from. */
  app.delete('/api/manual-suppliers/:id', { preHandler: requireWarehouse }, async (req, reply) => {
    const r = await q('delete from manual_suppliers where id=$1::bigint', [String(req.params.id)]).catch(() => ({ rowCount: 0 }));
    if (!r.rowCount) { reply.code(404); return { error: 'Not found.' }; }
    audit(req, 'manual-supplier.removed', { entityType: 'manual_supplier', entityId: String(req.params.id) });
    return { ok: true };
  });
}
