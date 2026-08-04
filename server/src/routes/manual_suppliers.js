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
import { aiComplete } from './support_ai.js';

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

  // Title and image come out of the SAME html we already downloaded — no second request,
  // no new host to reach, so nothing to re-guard. Worth having even when the price is
  // unreadable: a row with the right name and picture is still far better than a bare link.
  const meta = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const unent = (v) => String(v || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").trim();

  let title = unent(
    meta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ||
    meta(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)/i) ||
    meta(/<title[^>]*>([^<]{1,300})<\/title>/i) || ''
  ).slice(0, 200) || null;

  let image = unent(
    meta(/<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)/i) ||
    meta(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) ||
    meta(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i) || ''
  ) || null;
  // JSON-LD carries the image as a string, an array, or an ImageObject; take the first
  // usable one rather than rendering "[object Object]" into an <img src>.
  if (!image) {
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const pick = (v) => {
          if (!v) return null;
          if (typeof v === 'string') return v;
          if (Array.isArray(v)) { for (const x of v) { const r = pick(x); if (r) return r; } return null; }
          if (typeof v === 'object') return pick(v.url || v.contentUrl || v.image);
          return null;
        };
        const found = pick(JSON.parse(m[1]).image);
        if (found) { image = found; break; }
      } catch { /* skip malformed blocks */ }
    }
  }
  // Only absolute http(s) images: a relative path or a data: URI would render broken, and
  // resolving relatives means trusting a host we deliberately do not follow redirects to.
  if (image && !/^https?:\/\//i.test(image)) image = null;

  if (!prices.length) {
    return {
      ok: false, title, image,
      error: "This shop doesn't publish its price in a readable form. Type it in — the name and picture were still read.",
    };
  }
  // The LOWEST declared price. Variant pages list every option, and quoting the dearest
  // as "the cost" would overstate what we pay and understate the margin.
  return { ok: true, price: Math.min(...prices), found: prices.length, title, image };
}

// ADMIN-only, all of it. These rows carry what we pay and what we make on it — margin is
// not something an operator, warehouse picker or designer needs to do their job, and the
// nav permission matrix is HIDE-only so it can never be the boundary. The gate is here.
export function manualSupplierRoutes(app, requireAdmin) {
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
  // Added for the Sourcing tab. A unit price on its own can't be compared across suppliers:
  // $3.10 at MOQ 100 with $85 freight is really $3.95 a unit, and 25 days later than the
  // $8.42 domestic blank with no minimum. These are what make the comparison honest.
  for (const col of [
    'moq integer',                    // minimum order quantity (1 = buy one)
    'ship_total numeric(12,2)',       // inbound freight for the whole MOQ, not per unit
    'lead_days integer',              // quoted production + transit
    'supplier_ref text',              // internal supplier style, e.g. "sanmar:PC61" — price re-reads on catalog sync
    'currency text',                  // as quoted; converted at display time, never stored converted
    'decoration_cost numeric(12,2)',  // print/embroidery per unit, if not our own factory
    'image text',
    'archived boolean default false',
  ]) q(`alter table manual_suppliers add column if not exists ${col}`).catch(() => {});

  app.get('/api/manual-suppliers', { preHandler: requireAdmin }, async () => {
    const r = await q('select * from manual_suppliers where coalesce(archived,false) = false order by created_at desc limit 500').catch(() => ({ rows: [] }));
    return {
      items: r.rows.map((x) => ({
        id: String(x.id), title: x.title, url: x.url, shop: x.shop,
        cost: x.cost == null ? null : Number(x.cost),
        markupPct: x.markup_pct == null ? null : Number(x.markup_pct),
        sellPrice: x.sell_price == null ? null : Number(x.sell_price),
        productId: x.product_id, note: x.note, createdAt: x.created_at,
        moq: x.moq == null ? null : Number(x.moq),
        shipTotal: x.ship_total == null ? null : Number(x.ship_total),
        leadDays: x.lead_days == null ? null : Number(x.lead_days),
        supplierRef: x.supplier_ref || null,
        currency: x.currency || 'USD',
        image: x.image || null,
        decorationCost: x.decoration_cost == null ? null : Number(x.decoration_cost),
        archived: !!x.archived,
      })),
    };
  });

  /** Try to read the price off a listing. Never writes — the caller decides whether to
   *  keep what came back. */
  app.post('/api/manual-suppliers/price', { preHandler: requireAdmin }, async (req, reply) => {
    const url = (req.body || {}).url;
    if (!url) { reply.code(400); return { error: 'A link is required.' }; }
    return fetchPrice(url);
  });

  app.post('/api/manual-suppliers', { preHandler: requireAdmin }, async (req, reply) => {
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

    // Blank string means "cleared", not zero — a 0 MOQ would silently divide freight by
    // nothing later. num() keeps null null.
    const num = (v, { int = false, min = 0 } = {}) => {
      if (v == null || v === '') return null;
      const n = int ? parseInt(v, 10) : Number(v);
      return isFinite(n) ? Math.max(min, n) : null;
    };
    const moq = num(b.moq, { int: true, min: 1 });
    const shipTotal = num(b.shipTotal);
    const leadDays = num(b.leadDays, { int: true });
    const decoration = num(b.decorationCost);
    const supplierRef = b.supplierRef ? String(b.supplierRef).trim().slice(0, 120) : null;
    const currency = b.currency ? String(b.currency).trim().toUpperCase().slice(0, 3) : 'USD';
    // Only absolute http(s) — this string goes straight into an <img src>, so a
    // javascript: or data: value must never survive the round trip.
    const image = b.image && /^https?:\/\//i.test(String(b.image)) ? String(b.image).slice(0, 1000) : null;

    if (b.id) {
      await q(`update manual_suppliers set title=$2, url=$3, shop=$4, cost=$5, markup_pct=$6,
                 sell_price=$7, product_id=$8, note=$9, moq=$10, ship_total=$11, lead_days=$12,
                 supplier_ref=$13, currency=$14, decoration_cost=$15, image=$16, updated_at=now()
               where id=$1::bigint`,
        [String(b.id), title, b.url || null, shop, cost, pct, sell, b.productId || null, b.note || null,
         moq, shipTotal, leadDays, supplierRef, currency, decoration, image]);
      audit(req, 'manual-supplier.updated', { entityType: 'manual_supplier', entityId: String(b.id), after: { title, cost, sell } });
      return { ok: true, id: String(b.id) };
    }
    const r = await q(
      `insert into manual_suppliers (title, url, shop, cost, markup_pct, sell_price, product_id, note,
                                     moq, ship_total, lead_days, supplier_ref, currency, decoration_cost,
                                     image, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
      [title, b.url || null, shop, cost, pct, sell, b.productId || null, b.note || null,
       moq, shipTotal, leadDays, supplierRef, currency, decoration, image,
       String((req.user && req.user.sub) || '')]);
    audit(req, 'manual-supplier.added', { entityType: 'manual_supplier', entityId: String(r.rows[0].id), after: { title, shop, cost, sell } });
    return { ok: true, id: String(r.rows[0].id) };
  });

  // ── Supplier suggestions ───────────────────────────────────────────────────
  // Cached forever against the SpyDeck listing id. The cache is the point: this is the only
  // part of Sourcing that costs money, so a product you looked at last month costs nothing
  // to look at again, and a product you never click costs nothing at all.
  q(`create table if not exists sourcing_suggestions (
       listing_id text primary key,
       payload jsonb,
       model text,
       created_at timestamptz default now()
     )`).catch(() => {});

  // Turn a MARKETING title into SOURCING queries. That translation is the entire feature:
  // "Cute Cat Mom Sweatshirt Gift For Her" is unsearchable on a B2B marketplace, while
  // "unisex pullover hoodie 320gsm cotton fleece" is what a supplier actually lists under.
  const SUGGEST_SYSTEM = `You turn a retail product listing into sourcing intelligence for a print-on-demand company.

Return ONLY a JSON object, no prose and no code fence:
{
  "productType": "plain noun phrase for what this physically is",
  "material": "likely material/construction, or null if not inferable",
  "attributes": ["3-6 short spec phrases a supplier would list"],
  "queries": ["3 B2B search queries, most specific first"],
  "podBlank": true|false,
  "note": "one sentence of sourcing advice"
}

Rules:
- queries are for a B2B wholesale marketplace. Use trade vocabulary (gsm, panel count, fabric blend, closure type), never marketing words (cute, gift, personalized, custom, mom, funny).
- podBlank is TRUE when this is a decorated blank garment or accessory the company should buy from its existing US blanks suppliers (SanMar, S&S, Otto Cap) rather than import. T-shirts, hoodies, sweatshirts, caps and totes are almost always podBlank:true.
- podBlank is FALSE for finished goods those suppliers do not carry: jewellery, enamel pins, drinkware, candles, stationery, packaging, keychains, home decor.
- When podBlank is true, say so plainly in note - importing a blank at MOQ 100 is usually the wrong call when the domestic one ships in 2 days with no minimum.`;

  app.post('/api/manual-suppliers/suggest', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    const listingId = String(b.listingId || '').trim();
    const title = String(b.title || '').trim().slice(0, 300);
    if (!title) { reply.code(400); return { error: 'A product title is required.' }; }

    if (listingId) {
      const hit = await q('select payload, model, created_at from sourcing_suggestions where listing_id=$1', [listingId])
        .catch(() => ({ rows: [] }));
      if (hit.rows.length) {
        return { ...hit.rows[0].payload, cached: true, model: hit.rows[0].model, at: hit.rows[0].created_at };
      }
    }

    // The image goes as a URL block, not base64 — the listing image already sits on a public
    // CDN, so re-uploading the bytes would cost bandwidth and tokens for nothing.
    const content = [];
    const img = String(b.image || '').trim();
    if (/^https:\/\//i.test(img)) content.push({ type: 'image', source: { type: 'url', url: img } });
    content.push({ type: 'text', text: `Listing title: ${title}` });

    let text;
    try {
      text = await aiComplete({ system: SUGGEST_SYSTEM, messages: [{ role: 'user', content }], maxTokens: 700 });
    } catch (e) {
      reply.code(e && e.status === 503 ? 503 : 502);
      return { error: (e && e.message) || 'Could not reach the AI service.' };
    }

    let parsed;
    // The model is told to return bare JSON; a stray code fence is the classic slip, so strip
    // it rather than failing the request over formatting.
    try { parsed = JSON.parse(String(text).replace(/^```(?:json)?|```$/gm, '').trim()); }
    catch { reply.code(502); return { error: 'The AI reply was not usable JSON.', raw: String(text).slice(0, 400) }; }

    const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, 6) : []);
    const out = {
      productType: parsed.productType ? String(parsed.productType).slice(0, 120) : null,
      material: parsed.material ? String(parsed.material).slice(0, 120) : null,
      attributes: arr(parsed.attributes),
      queries: arr(parsed.queries).slice(0, 3),
      podBlank: !!parsed.podBlank,
      note: parsed.note ? String(parsed.note).slice(0, 400) : null,
    };
    if (!out.queries.length) { reply.code(502); return { error: 'The AI returned no usable search queries.' }; }

    if (listingId) {
      await q(`insert into sourcing_suggestions (listing_id, payload, model) values ($1,$2,$3)
               on conflict (listing_id) do update set payload=excluded.payload, model=excluded.model, created_at=now()`,
        [listingId, JSON.stringify(out), '']).catch(() => {});
    }
    audit(req, 'sourcing.suggested', { entityType: 'spydeck_listing', entityId: listingId || null, after: { title, podBlank: out.podBlank } });
    return { ...out, cached: false };
  });

  /** A saved source is how someone re-orders, and losing one loses the only record of
   *  where a blank came from — so this is admin-only like the rest, and the UI archives
   *  by default rather than deleting. */
  app.delete('/api/manual-suppliers/:id', { preHandler: requireAdmin }, async (req, reply) => {
    // Archive, don't destroy: a source is the only record of where a blank came from, and
    // an order placed months ago may still point at it. ?hard=1 really deletes.
    const hard = /^(1|true)$/i.test(String(req.query?.hard || ''));
    const r = hard
      ? await q('delete from manual_suppliers where id=$1::bigint', [String(req.params.id)]).catch(() => ({ rowCount: 0 }))
      : await q('update manual_suppliers set archived=true, updated_at=now() where id=$1::bigint', [String(req.params.id)]).catch(() => ({ rowCount: 0 }));
    if (!r.rowCount) { reply.code(404); return { error: 'Not found.' }; }
    audit(req, 'manual-supplier.removed', { entityType: 'manual_supplier', entityId: String(req.params.id) });
    return { ok: true };
  });
}
