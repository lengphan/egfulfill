// Suppliers that have no API — the shops you buy from by opening a browser.
//
// A row is: what it is, where to buy it, what it costs there, and what we sell it for.
// The URL is the point: it is how you re-order in three months without hunting for the
// listing again.
//
// PRICE IS FETCHED FROM STRUCTURED DATA ONLY. See fetchPrice below for why scraping the
// visible HTML is not offered.
import crypto from 'node:crypto';
import { q } from '../db.js';
import { audit } from '../audit.js';
import { aiComplete } from './support_ai.js';
import { recordCost, recordCredit } from '../costs.js';

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
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EGFUL/1.0)', Accept: 'text/html' },
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
     )`)
  // CHAINED, not fired alongside. Two bare q() calls can land on DIFFERENT pool
  // connections and run out of order, so on a database where this table does not exist yet
  // every ALTER below raced the CREATE, failed with "relation does not exist", and the
  // .catch swallowed it — leaving manual_suppliers permanently missing moq, ship_total,
  // lead_days, stage and the rest until someone restarted the process. Invisible on a
  // long-lived deployment (the table is already there, so the ALTERs win), and a 500 on
  // every save on a fresh one. Found by running this against an empty database.
    .then(async () => {
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
        // Supplier pipeline. A product can have SEVERAL rows at 'prospect' at once — that is the
        // point: you shortlist a few, talk to two, and one graduates to 'rotation'. Stage lives on
        // the row (the product+supplier pair), not on the product.
        "stage text default 'prospect'",
        'archived boolean default false',
        // What was AGREED, as distinct from what was quoted on the listing. Unit cost, MOQ
        // and lead time are already columns above and stay the single source for those —
        // these are the terms that had nowhere to live and were being re-read out of the
        // chat every time.
        'sample_cost numeric(12,2)',      // what they said a sample would cost
        'payment_terms text',             // "30/70 T/T", "100% up front", …
        'terms_confirmed_at timestamptz', // when they last stood behind all of it
      ]) await q(`alter table manual_suppliers add column if not exists ${col}`).catch(() => {});
    })
    .catch(() => {});

  /**
   * SAMPLE ORDERS — the step between "we have a quote" and "we buy from these people".
   *
   * A row per sample actually placed, carrying the SUPPLIER'S OWN order number: that
   * number is what you quote back at them when it doesn't arrive, and it is the only
   * handle that ties our record to theirs.
   *
   * The money is NOT stored here. It books into wallet_ledger at place time like every
   * other external cost, and this table holds the paperwork around it — two sets of books
   * is how the balance and the report start disagreeing. `amount` is kept for display and
   * for the credit on cancel; the ledger stays the source of truth for what was spent.
   */
  q(`create table if not exists sample_orders (
       id bigserial primary key,
       supplier_id  bigint,
       order_no     text,
       amount       numeric(12,2) not null,
       qty          integer,
       note         text,
       status       text not null default 'placed',   -- placed | received | cancelled
       placed_at    timestamptz not null default now(),
       received_at  timestamptz,
       cancelled_at timestamptz,
       created_by   text
     )`)
    .then(() => q('create index if not exists sample_orders_supplier on sample_orders (supplier_id, placed_at desc)'))
    // Where it came from, when it came from Alibaba. `seller_eid` is the encrypted supplier
    // id off the order payload — the ONLY supplier identity Alibaba gives us (the product
    // search returns none), and the thing that makes a link straight to their chat possible.
    .then(() => q('alter table sample_orders add column if not exists alibaba_trade_id text'))
    .then(() => q('alter table sample_orders add column if not exists seller_eid text'))
    .then(() => q('alter table sample_orders add column if not exists seller_name text'))
    .then(() => q('alter table sample_orders add column if not exists source text'))
    .catch(() => {});

  /**
   * THE CONVERSATION, kept on our side.
   *
   * Alibaba's open API exposes no messages — probed 2026-08-10, and the product search
   * carries no seller identity at all (id, title, image, price, url and nothing else), so
   * we cannot read a thread or even link to the right one. What was agreed therefore has to
   * be recorded here or it stays in a chat window someone has to scroll.
   *
   * Plain pasted text with a date. NOT a parsed transcript: what gets pasted is whatever
   * shape the supplier typed it in, in whatever language, and a parser that guesses at a
   * price would be confidently wrong about the one number this exists to remember.
   */
  q(`create table if not exists supplier_messages (
       id bigserial primary key,
       supplier_id bigint not null,
       body       text not null,
       said_at    date,
       direction  text,                  -- them | us
       created_by text,
       created_at timestamptz default now()
     )`)
    .then(() => q('create index if not exists supplier_messages_supplier on supplier_messages (supplier_id, said_at desc, id desc)'))
    .catch(() => {});

  /**
   * THE STAGE IS DERIVED, NOT TYPED.
   *
   * It used to be a dropdown on every row, and every row sat at Prospect — because moving
   * it changed nothing. A label you set by hand that no other behaviour reads is a label
   * nobody maintains, and a pipeline where all five rows show the same stage is worse than
   * no pipeline: it looks like information.
   *
   * So it comes from what actually happened, which the database already knows:
   *
   *   goods received  → rotation   a sample arrived and was accepted; we buy from these people
   *   sample placed   → sampling   money is out, an answer is pending
   *   a message kept  → talking    there is a recorded exchange and no sample yet
   *   otherwise       → prospect   a quote and nothing more
   *
   * 'talking' reads supplier_messages rather than being dropped. It was the one stage with
   * no fact behind it, so its filter chip could only ever show 0 — a filter that can never
   * match anything is worse than no filter. Now the act that makes it true (recording what
   * they said) is the same act someone performs anyway.
   *
   * The stored column survives for ARCHIVED only, which is a decision rather than an event
   * and so genuinely has to be typed. Nothing else writes it now.
   */
  const stageSql = `
    case
      when exists (select 1 from sample_orders s
                    where s.supplier_id = m.id and s.status = 'received') then 'rotation'
      when exists (select 1 from sample_orders s
                    where s.supplier_id = m.id and s.status <> 'cancelled') then 'sampling'
      when exists (select 1 from supplier_messages g
                    where g.supplier_id = m.id) then 'talking'
      else 'prospect'
    end`;

  app.get('/api/manual-suppliers', { preHandler: requireAdmin }, async () => {
    // A LEFT JOIN would multiply the supplier row by its samples; these are correlated
    // EXISTS so one supplier stays one row however many samples it has.
    const r = await q(`select m.*, ${stageSql} as derived_stage
                         from manual_suppliers m
                        where coalesce(m.archived,false) = false
                          and coalesce(m.stage,'prospect') <> 'archived'
                        order by m.created_at desc limit 500`).catch(() => ({ rows: [] }));
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
        stage: x.derived_stage || 'prospect',
        decorationCost: x.decoration_cost == null ? null : Number(x.decoration_cost),
        // What was AGREED, as opposed to what the listing said. These columns have shipped
        // since the sourcing tab was built and nothing has ever read them, so the terms
        // people negotiated stayed in a chat window — which is the whole reason they get
        // re-asked. `termsConfirmedAt` is when the supplier last stood behind all of it:
        // a quote from March is not a quote.
        sampleCost: x.sample_cost == null ? null : Number(x.sample_cost),
        paymentTerms: x.payment_terms || null,
        termsConfirmedAt: x.terms_confirmed_at || null,
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
    // The pipeline stage is DERIVED from sample orders now (see stageSql), so only
    // 'archived' is still something a person decides and therefore still stored. Accepting
    // the others would let a dropdown overwrite a fact — a row marked 'prospect' by hand
    // while a sample sits received against it.
    const stage = String(b.stage || '') === 'archived' ? 'archived' : null;

    // Agreed terms. Distinct from the quote on the listing, and re-confirmed rather than
    // assumed: `terms_confirmed_at` moves only when someone says these were confirmed
    // TODAY, so a quote from March keeps showing its March date instead of looking fresh
    // because an unrelated field was edited.
    const sampleCost = num(b.sampleCost);
    const paymentTerms = b.paymentTerms ? String(b.paymentTerms).trim().slice(0, 200) : null;
    const confirmTerms = b.confirmTerms === true;

    if (b.id) {
      await q(`update manual_suppliers set title=$2, url=$3, shop=$4, cost=$5, markup_pct=$6,
                 sell_price=$7, product_id=$8, note=$9, moq=$10, ship_total=$11, lead_days=$12,
                 supplier_ref=$13, currency=$14, decoration_cost=$15, image=$16,
                 stage=coalesce($17, stage),
                 sample_cost=$18, payment_terms=$19,
                 terms_confirmed_at=case when $20 then now() else terms_confirmed_at end,
                 updated_at=now()
               where id=$1::bigint`,
        [String(b.id), title, b.url || null, shop, cost, pct, sell, b.productId || null, b.note || null,
         moq, shipTotal, leadDays, supplierRef, currency, decoration, image, stage,
         sampleCost, paymentTerms, confirmTerms]);
      audit(req, 'manual-supplier.updated', { entityType: 'manual_supplier', entityId: String(b.id), after: { title, cost, sell } });
      return { ok: true, id: String(b.id) };
    }
    const r = await q(
      `insert into manual_suppliers (title, url, shop, cost, markup_pct, sell_price, product_id, note,
                                     moq, ship_total, lead_days, supplier_ref, currency, decoration_cost,
                                     image, stage, sample_cost, payment_terms, terms_confirmed_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               case when $19 then now() else null end, $20) returning id`,
      [title, b.url || null, shop, cost, pct, sell, b.productId || null, b.note || null,
       moq, shipTotal, leadDays, supplierRef, currency, decoration, image, stage || 'prospect',
       sampleCost, paymentTerms, confirmTerms,
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
      text = await aiComplete({
        system: SUGGEST_SYSTEM, messages: [{ role: 'user', content }], maxTokens: 700,
        costRef: `aisupplier-${crypto.randomBytes(8).toString('hex')}`, costNote: 'Supplier suggestion',
      });
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

  // ── Sample orders ──────────────────────────────────────────────────────────
  const sampleRows = async (supplierId = null) => {
    const r = await q(
      `select s.*, m.title as supplier_title
         from sample_orders s
         left join manual_suppliers m on m.id = s.supplier_id
        where ($1::bigint is null or s.supplier_id = $1::bigint)
        order by s.placed_at desc limit 300`,
      [supplierId]).catch(() => ({ rows: [] }));
    return r.rows.map((x) => ({
      id: String(x.id),
      supplierId: x.supplier_id == null ? null : String(x.supplier_id),
      supplierTitle: x.supplier_title || null,
      orderNo: x.order_no || null,
      amount: x.amount == null ? null : Number(x.amount),
      qty: x.qty == null ? null : Number(x.qty),
      note: x.note || null,
      status: x.status || 'placed',
      source: x.source || 'manual',
      tradeId: x.alibaba_trade_id || null,
      sellerEid: x.seller_eid || null,
      sellerName: x.seller_name || null,
      placedAt: x.placed_at,
      receivedAt: x.received_at,
      cancelledAt: x.cancelled_at,
    }));
  };

  app.get('/api/sample-orders', { preHandler: requireAdmin }, async (req) => {
    const sid = req.query?.supplierId ? String(req.query.supplierId) : null;
    return { items: await sampleRows(sid && /^\d+$/.test(sid) ? sid : null) };
  });

  /**
   * Record a sample order that has just been PLACED — and book what it cost.
   *
   * Place time, not receive time: the money leaves when you pay for it, and a ledger that
   * waits for the parcel reports a balance we do not have. The trade-off is real and
   * deliberate — a sample that never turns up sits as a cost against nothing, which is
   * exactly what it was: money spent on an answer we did not get. Cancel books a credit
   * rather than deleting the debit, so both facts survive.
   *
   * The ledger ref is `sample-<id>` — one row, one sample, so a double-submit or a retry
   * lands once against the (account, type, ref) unique index.
   */
  app.post('/api/sample-orders', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      reply.code(400); return { error: 'What the sample cost is required — it books to the factory wallet as it is placed.' };
    }
    const orderNo = String(b.orderNo || '').trim();
    if (!orderNo) {
      reply.code(400); return { error: "The supplier's own order number is required — it is the only handle that ties our record to theirs." };
    }
    const supplierId = /^\d+$/.test(String(b.supplierId || '')) ? String(b.supplierId) : null;
    const qty = Number.isFinite(Number(b.qty)) && Number(b.qty) > 0 ? Math.round(Number(b.qty)) : null;

    // Imported from a real Alibaba order, or typed in by hand. An Alibaba import is
    // idempotent on the trade id: importing the same order twice must not charge twice.
    const tradeId = String(b.tradeId || '').trim() || null;
    if (tradeId) {
      const dup = await q('select id from sample_orders where alibaba_trade_id=$1 limit 1', [tradeId]).catch(() => ({ rows: [] }));
      if (dup.rows.length) {
        reply.code(409);
        return { error: `Alibaba order ${tradeId} is already recorded as a sample.`, id: String(dup.rows[0].id) };
      }
    }
    const ins = await q(
      `insert into sample_orders (supplier_id, order_no, amount, qty, note, created_by,
                                  alibaba_trade_id, seller_eid, seller_name, source)
       values ($1::bigint, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [supplierId, orderNo, Math.abs(amount), qty, String(b.note || '').trim() || null, req.user?.sub || null,
       tradeId, String(b.sellerEid || '').trim() || null, String(b.sellerName || '').trim() || null,
       tradeId ? 'alibaba' : 'manual']);
    const id = String(ins.rows[0].id);

    // Who it was bought from, so the Billing row reads as a sentence rather than a figure.
    const supplier = supplierId
      ? (await q('select title from manual_suppliers where id=$1::bigint', [supplierId]).catch(() => ({ rows: [] }))).rows[0]
      : null;
    const note = [`Sample ${orderNo}`, supplier?.title || String(b.sellerName || '').trim() || null,
                  qty ? `${qty} unit${qty === 1 ? '' : 's'}` : null, String(b.note || '').trim() || null]
      .filter(Boolean).join(' · ');
    const booked = await recordCost('sample', amount, `sample-${id}`, note);

    // A sample being placed IS the sampling stage — leaving the row on "talking" means the
    // board disagrees with the ledger about what is happening.
    if (supplierId) {
      await q(`update manual_suppliers set stage='sampling', updated_at=now()
                where id=$1::bigint and coalesce(stage,'prospect') in ('prospect','talking')`,
        [supplierId]).catch(() => {});
    }
    audit(req, 'sample-order.placed', { entityType: 'sample_order', entityId: id, after: { orderNo, amount, supplierId } });
    // `booked` is reported rather than assumed: recordCost is best-effort by design, and a
    // sample recorded with its cost silently unbooked is the failure this whole item is about.
    return { ok: true, id, booked: !!booked.ok, items: await sampleRows() };
  });

  /**
   * Mark a sample arrived, or cancel it.
   *
   * Cancel appends a CREDIT rather than removing the debit — "we spent $40 and got it
   * back" and "we never spent it" are different facts, and only the first survives an
   * audit. Receiving moves no money: the money already moved when it was placed.
   */
  app.post('/api/sample-orders/:id/:action', { preHandler: requireAdmin }, async (req, reply) => {
    const id = String(req.params.id || '');
    const action = String(req.params.action || '');
    if (!/^\d+$/.test(id)) { reply.code(404); return { error: 'Not found.' }; }
    if (!['received', 'cancel'].includes(action)) { reply.code(400); return { error: 'Unknown action.' }; }

    const cur = (await q('select * from sample_orders where id=$1::bigint', [id]).catch(() => ({ rows: [] }))).rows[0];
    if (!cur) { reply.code(404); return { error: 'Not found.' }; }
    if (cur.status === 'cancelled') { reply.code(409); return { error: 'That sample was already cancelled.' }; }

    if (action === 'received') {
      await q(`update sample_orders set status='received', received_at=now() where id=$1::bigint`, [id]);
      audit(req, 'sample-order.received', { entityType: 'sample_order', entityId: id });
      return { ok: true, items: await sampleRows() };
    }

    await q(`update sample_orders set status='cancelled', cancelled_at=now() where id=$1::bigint`, [id]);
    const credited = await recordCredit('sample', Number(cur.amount), `sample-cancel-${id}`,
      `Sample ${cur.order_no || id} cancelled — refunded`);
    audit(req, 'sample-order.cancelled', { entityType: 'sample_order', entityId: id, before: { status: cur.status } });
    return { ok: true, credited: !!credited.ok, items: await sampleRows() };
  });

  /**
   * WHAT THE SUPPLIER ACTUALLY SAID.
   *
   * The `supplier_messages` table has shipped since the sourcing tab was built and nothing
   * has ever read or written it, so every agreed price, MOQ and lead time lived in a chat
   * window someone had to scroll — and got re-asked, which is how a supplier learns you
   * aren't keeping track.
   *
   * PASTED TEXT, kept verbatim. Alibaba's open API exposes no messages at all (probed
   * 2026-08-10), so there is nothing to sync and this is the only copy. It is deliberately
   * not parsed: what gets pasted is whatever the supplier typed, in whatever language, and
   * a parser guessing at a price would be confidently wrong about the one number this
   * exists to remember.
   */
  app.get('/api/manual-suppliers/:id/messages', { preHandler: requireAdmin }, async (req, reply) => {
    const id = String(req.params.id || '');
    if (!/^\d+$/.test(id)) { reply.code(400); return { error: 'Not a supplier id.' }; }
    const r = await q(
      `select id, body, said_at, direction, created_at from supplier_messages
        where supplier_id=$1::bigint order by said_at desc nulls last, id desc limit 200`,
      [id]).catch(() => ({ rows: [] }));
    return {
      items: r.rows.map((x) => ({
        id: String(x.id), body: x.body,
        // A date, not a timestamp: what matters is which day it was agreed, and a pasted
        // log rarely carries a time anyone trusts.
        saidAt: x.said_at ? new Date(x.said_at).toISOString().slice(0, 10) : null,
        direction: x.direction === 'us' ? 'us' : 'them',
        createdAt: x.created_at,
      })),
    };
  });

  app.post('/api/manual-suppliers/:id/messages', { preHandler: requireAdmin }, async (req, reply) => {
    const id = String(req.params.id || '');
    if (!/^\d+$/.test(id)) { reply.code(400); return { error: 'Not a supplier id.' }; }
    const b = req.body || {};
    const body = String(b.body || '').trim();
    if (!body) { reply.code(400); return { error: 'Nothing to save — paste what they said.' }; }
    // A whole chat log, not a line. Generous, but bounded: this is a text column and an
    // accidental paste of a page's worth of markup should not become a row nobody can read.
    if (body.length > 20000) { reply.code(400); return { error: 'That is longer than 20,000 characters — paste the part that matters.' }; }
    const owner = await q('select id from manual_suppliers where id=$1::bigint', [id]).catch(() => ({ rows: [] }));
    if (!owner.rows.length) { reply.code(404); return { error: 'No such supplier.' }; }
    // Their date if given, today if not. Never silently today when a date WAS given and is
    // unparseable — that would date a March agreement to this morning.
    const said = b.saidAt ? String(b.saidAt).slice(0, 10) : null;
    if (said && !/^\d{4}-\d{2}-\d{2}$/.test(said)) { reply.code(400); return { error: 'The date should be YYYY-MM-DD.' }; }
    const r = await q(
      `insert into supplier_messages (supplier_id, body, said_at, direction, created_by)
       values ($1::bigint, $2, coalesce($3::date, current_date), $4, $5) returning id`,
      [id, body, said, b.direction === 'us' ? 'us' : 'them', String((req.user && req.user.sub) || '')]);
    audit(req, 'supplier-message.added', { entityType: 'manual_supplier', entityId: id });
    return { ok: true, id: String(r.rows[0].id) };
  });

  app.delete('/api/manual-suppliers/:id/messages/:msgId', { preHandler: requireAdmin }, async (req, reply) => {
    const id = String(req.params.id || '');
    const msgId = String(req.params.msgId || '');
    if (!/^\d+$/.test(id) || !/^\d+$/.test(msgId)) { reply.code(400); return { error: 'Not an id.' }; }
    // Scoped to the supplier as well as the message, so a guessed id from another
    // supplier's thread cannot be deleted through this route.
    const r = await q('delete from supplier_messages where id=$1::bigint and supplier_id=$2::bigint',
      [msgId, id]).catch(() => ({ rowCount: 0 }));
    if (!r.rowCount) { reply.code(404); return { error: 'No such message.' }; }
    audit(req, 'supplier-message.deleted', { entityType: 'manual_supplier', entityId: id });
    return { ok: true };
  });
}
