// SanMar connector — apparel/blanks supplier (SanMar Web Services, SOAP/XML v16.10).
// -----------------------------------------------------------------------------
// Unlike S&S and Otto (REST/JSON), SanMar is SOAP: we hand-build the request envelope
// and pull fields out of the XML response with a small tag extractor (no XML dependency —
// the responses are flat element trees). Product / Inventory / Pricing are read-only and
// LIVE once activated; order placement is DRY-RUN until SANMAR_ORDER_LIVE='1' AND the PO
// payload is finalised against SanMar's separate Purchase Order Submission Guide (this
// integration guide doesn't specify it). All routes are STAFF-gated.
//
// ACTIVATION (real-world, not code): SanMar requires the calling server's external static
// IP to be whitelisted and a signed integration agreement on file. Until then every call
// times out — that's their gate, not a bug. Our VPS apex A-record IP is what to give them.
//
// Env (also settable in Settings → integration secrets): SANMAR_CUSTOMER_NUMBER,
//   SANMAR_USERNAME, SANMAR_PASSWORD, SANMAR_API_BASE (prod default; stage-ws for testing),
//   SANMAR_ORDER_LIVE (order gate). Read at CALL TIME so UI-saved keys apply without a
//   restart, matching the _LIVE gate pattern used by the other suppliers.

import { q } from '../db.js';
import { recordUsage } from '../usage.js';

// Read credentials fresh on every call (not a module-load snapshot) so a key saved in the
// UI takes effect immediately.
function cfg() {
  return {
    cust: (process.env.SANMAR_CUSTOMER_NUMBER || '').trim(),
    user: (process.env.SANMAR_USERNAME || '').trim(),
    pass: (process.env.SANMAR_PASSWORD || '').trim(),
    base: (process.env.SANMAR_API_BASE || 'https://ws.sanmar.com:8080').trim().replace(/\/+$/, ''),
  };
}
function sanmarConfigured() { const c = cfg(); return !!(c.cust && c.user && c.pass); }
const isStage = () => /stage-ws/i.test(cfg().base);

// SOAP endpoints (the WSDL URL without ?wsdl) + the operation namespace each one uses.
// ProductInfo/Pricing live under impl.*; Inventory lives under webservice.* (positional args).
const SVC = {
  product:   { path: '/SanMarWebService/SanMarProductInfoServicePort', ns: 'http://impl.webservice.integration.sanmar.com/' },
  pricing:   { path: '/SanMarWebService/SanMarPricingServicePort',     ns: 'http://impl.webservice.integration.sanmar.com/' },
  inventory: { path: '/SanMarWebService/SanMarWebServicePort',         ns: 'http://webservice.integration.sanmar.com/' },
};
// The list response is a flat quantity per warehouse, in THIS fixed order (no whse number
// is returned — see guide p.22). #12 is Arizona (virtual whses 8-11 roll into it).
const WHSE_ORDER = [
  { no: 1, city: 'Seattle', state: 'WA' }, { no: 2, city: 'Cincinnati', state: 'OH' },
  { no: 3, city: 'Dallas', state: 'TX' }, { no: 4, city: 'Reno', state: 'NV' },
  { no: 5, city: 'Robbinsville', state: 'NJ' }, { no: 6, city: 'Jacksonville', state: 'FL' },
  { no: 7, city: 'Minneapolis', state: 'MN' }, { no: 12, city: 'Phoenix', state: 'AZ' },
];

// ── Tiny XML helpers ─────────────────────────────────────────────────────────
// Namespace-prefix agnostic: matches <name>, <ns2:name>, etc. Non-greedy so leaf scalars
// come out even when nested inside a parent block.
const xmlEsc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function xmlDecode(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();
}
function tag(xml, name) {
  const m = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(xml || '');
  return m ? xmlDecode(m[1]) : '';
}
function tagAll(xml, name) {
  const re = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'gi');
  const out = []; let m;
  while ((m = re.exec(xml || ''))) out.push(m[1]);
  return out;
}
const numOr = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };

// ── SOAP transport ───────────────────────────────────────────────────────────
async function soapCall(service, bodyInner) {
  if (!sanmarConfigured()) throw new Error('SanMar not configured (SANMAR_CUSTOMER_NUMBER / SANMAR_USERNAME / SANMAR_PASSWORD).');
  const svc = SVC[service];
  const url = cfg().base + svc.path;
  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="${svc.ns}">` +
    `<soapenv:Header/><soapenv:Body>${bodyInner}</soapenv:Body></soapenv:Envelope>`;
  let r, text;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' }, body: envelope });
    text = await r.text();
  } catch (e) {
    // A network timeout here is almost always the IP-whitelist gate, not our code.
    recordUsage('sanmar', { endpoint: service, ok: false });
    throw new Error(`Couldn't reach SanMar (${String(e && e.message || e)}). If this is a timeout, confirm this server's IP is whitelisted with SanMar.`);
  }
  recordUsage('sanmar', { endpoint: service, ok: r.ok });
  if (!r.ok) throw new Error(`SanMar ${service} HTTP ${r.status}: ${String(text).slice(0, 300)}`);
  const fault = tag(text, 'faultstring');
  if (fault) throw new Error('SanMar fault: ' + fault);
  // The guide spells the flag BOTH ways in different responses ("errorOccured" in product,
  // "errorOccurred" in pricing) — check both so a real error is never read as success.
  const err = (tag(text, 'errorOccurred') || tag(text, 'errorOccured') || '').toLowerCase();
  if (err === 'true') throw new Error(tag(text, 'message') || 'SanMar returned an error.');
  return text;
}

const authBlock = () => {
  const c = cfg();
  return `<sanMarCustomerNumber>${xmlEsc(c.cust)}</sanMarCustomerNumber>` +
    `<sanMarUserName>${xmlEsc(c.user)}</sanMarUserName>` +
    `<sanMarUserPassword>${xmlEsc(c.pass)}</sanMarUserPassword>`;
};

// ── Response → normalized shapes ─────────────────────────────────────────────
// One flattened product-variant row from a product-info response. Fields mirror the
// SsStyle/OttoStyle vocabulary so the frontend can badge and render them the same way.
function mapProducts(xml) {
  const basics = tagAll(xml, 'productBasicInfo');
  const images = tagAll(xml, 'productImageInfo');
  const prices = tagAll(xml, 'productPriceInfo');
  return basics.map((b, i) => {
    const im = images[i] || '';
    const pr = prices[i] || '';
    return {
      style: tag(b, 'style'),
      title: tag(b, 'productTitle'),
      brand: tag(b, 'brandName'),
      description: tag(b, 'productDescription'),
      status: tag(b, 'productStatus'),
      color: tag(b, 'color'),
      catalogColor: tag(b, 'catalogColor'),
      size: tag(b, 'size'),
      sizeIndex: tag(b, 'sizeIndex'),
      availableSizes: tag(b, 'availableSizes'),
      keywords: tag(b, 'keywords'),
      inventoryKey: tag(b, 'inventoryKey'),
      uniqueKey: tag(b, 'uniqueKey'),
      caseSize: numOr(tag(b, 'caseSize')),
      pieceWeight: numOr(tag(b, 'pieceWeight')),
      image: tag(im, 'productImage') || tag(im, 'colorProductImage') || tag(im, 'frontModel') || null,
      colorProductImage: tag(im, 'colorProductImage') || null,
      colorSquareImage: tag(im, 'colorSquareImage') || null,
      colorSwatchImage: tag(im, 'colorSwatchImage') || null,
      thumbnailImage: tag(im, 'thumbnailImage') || null,
      brandLogoImage: tag(im, 'brandLogoImage') || null,
      specSheet: tag(im, 'specSheet') || null,
      piecePrice: numOr(tag(pr, 'piecePrice')),
      dozenPrice: numOr(tag(pr, 'dozenPrice')),
      casePrice: numOr(tag(pr, 'casePrice')),
      salePrice: numOr(tag(pr, 'salePrice')),
      priceText: tag(pr, 'priceText'),
    };
  });
}

// Route SanMar's http cdn images through our origin so the browser (on https) doesn't
// block them as mixed content — the same fix S&S/Otto need for their supplier images.
function sanmarImg(u) {
  if (!u || !/^https?:\/\//i.test(u)) return u || null;
  return '/api/sanmar/img-proxy?url=' + encodeURIComponent(u);
}
function proxyImages(p) {
  return {
    ...p,
    image: sanmarImg(p.image), colorProductImage: sanmarImg(p.colorProductImage),
    colorSquareImage: sanmarImg(p.colorSquareImage), colorSwatchImage: sanmarImg(p.colorSwatchImage),
    thumbnailImage: sanmarImg(p.thumbnailImage), brandLogoImage: sanmarImg(p.brandLogoImage),
  };
}

export const sanmarEnabled = () => sanmarConfigured();

export function sanmarRoutes(app, requireAuth, requireStaff, requireAdmin, requireWarehouse) {
  // Shared favorites shortlist, mirroring ss_favorites / otto_favorites.
  q(`create table if not exists sanmar_favorites (
       style text primary key, name text, image text, price numeric,
       created_by uuid, created_at timestamptz default now())`).catch(() => {});

  app.get('/api/sanmar/status', { preHandler: requireStaff }, async () => ({
    configured: sanmarConfigured(), stage: isStage(), base: cfg().base,
  }));

  // Connectivity test — one signed call (pricing for a known style) proves auth + that the
  // IP is whitelisted, before trusting a browse. Mirrors the Otto/Wilcom "verify one call".
  app.get('/api/sanmar/test', { preHandler: requireStaff }, async (req, reply) => {
    if (!sanmarConfigured()) { reply.code(400); return { error: 'SanMar not configured.' }; }
    try {
      const style = String((req.query && req.query.style) || 'PC61');
      const xml = await soapCall('pricing',
        `<m:getPricing><arg0><style>${xmlEsc(style)}</style></arg0><arg1>${authBlock()}</arg1></m:getPricing>`);
      const rows = tagAll(xml, 'listResponse');
      return { ok: true, stage: isStage(), style, priced_variants: rows.length, message: tag(xml, 'message') || 'OK' };
    } catch (e) { reply.code(400); return { error: String(e && e.message || e) }; }
  });

  // Image proxy — allowlisted to SanMar's CDN so it can't be pointed at an internal host.
  app.get('/api/sanmar/img-proxy', { preHandler: requireStaff }, async (req, reply) => {
    const url = req.query && req.query.url;
    if (!url) { reply.code(400); return { error: 'url required' }; }
    let host; try { host = new URL(url).hostname; } catch { reply.code(400); return { error: 'bad url' }; }
    if (!/(^|\.)sanmar\.com$/i.test(host)) { reply.code(403); return { error: 'host not allowed' }; }
    try {
      const r = await fetch(url);
      if (!r.ok) { reply.code(502); return { error: 'upstream ' + r.status }; }
      const buf = Buffer.from(await r.arrayBuffer());
      reply.header('Content-Type', r.headers.get('content-type') || 'image/jpeg');
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(buf);
    } catch (e) { reply.code(502); return { error: String(e && e.message || e) }; }
  });

  // Product search — by style (+ optional color/size), or by brand, or by category.
  // Returns normalized rows badged the same way as the other suppliers' cards.
  app.get('/api/sanmar/products', { preHandler: requireStaff }, async (req, reply) => {
    if (!sanmarConfigured()) { reply.code(400); return { error: 'SanMar not configured.' }; }
    const qy = req.query || {};
    try {
      let xml;
      if (qy.style) {
        const parts = [`<style>${xmlEsc(String(qy.style))}</style>`];
        if (qy.color) parts.push(`<color>${xmlEsc(String(qy.color))}</color>`);
        if (qy.size) parts.push(`<size>${xmlEsc(String(qy.size))}</size>`);
        xml = await soapCall('product',
          `<m:getProductInfoByStyleColorSize><arg0>${parts.join('')}</arg0><arg1>${authBlock()}</arg1></m:getProductInfoByStyleColorSize>`);
      } else if (qy.brand) {
        xml = await soapCall('product',
          `<m:getProductInfoByBrand><arg0><brandName>${xmlEsc(String(qy.brand))}</brandName></arg0><arg1>${authBlock()}</arg1></m:getProductInfoByBrand>`);
      } else if (qy.category) {
        xml = await soapCall('product',
          `<m:getProductInfoByCategory><arg0><category>${xmlEsc(String(qy.category))}</category></arg0><arg1>${authBlock()}</arg1></m:getProductInfoByCategory>`);
      } else {
        reply.code(400); return { error: 'Provide a style, brand or category.' };
      }
      let favs = new Set();
      try { const fr = await q('select style from sanmar_favorites'); favs = new Set(fr.rows.map((x) => String(x.style))); } catch { /* table may not exist yet */ }
      const items = mapProducts(xml).map(proxyImages).map((p) => ({ ...p, favorited: favs.has(String(p.style)) }));
      return { total: items.length, items };
    } catch (e) { reply.code(502); return { error: String(e && e.message || e) }; }
  });

  // Per-warehouse inventory for one style/color/size (guide p.23). Each list value maps to
  // WHSE_ORDER by position; also returns the total across warehouses.
  app.get('/api/sanmar/inventory', { preHandler: requireStaff }, async (req, reply) => {
    if (!sanmarConfigured()) { reply.code(400); return { error: 'SanMar not configured.' }; }
    const qy = req.query || {};
    if (!qy.style || !qy.color || !qy.size) { reply.code(400); return { error: 'style, color and size are all required.' }; }
    const c = cfg();
    try {
      const xml = await soapCall('inventory',
        `<m:getInventoryQtyForStyleColorSize>` +
        `<arg0>${xmlEsc(c.cust)}</arg0><arg1>${xmlEsc(c.user)}</arg1><arg2>${xmlEsc(c.pass)}</arg2>` +
        `<arg3>${xmlEsc(String(qy.style))}</arg3><arg4>${xmlEsc(String(qy.color))}</arg4><arg5>${xmlEsc(String(qy.size))}</arg5>` +
        `</m:getInventoryQtyForStyleColorSize>`);
      const qtys = tagAll(xml, 'listResponse').map((v) => parseInt(xmlDecode(v), 10) || 0);
      const warehouses = WHSE_ORDER.map((w, i) => ({ ...w, qty: qtys[i] ?? 0 }));
      return { style: qy.style, color: qy.color, size: qy.size, total: qtys.reduce((a, b) => a + b, 0), warehouses };
    } catch (e) { reply.code(502); return { error: String(e && e.message || e) }; }
  });

  // Pricing for a style (+ optional color/size) — piece/dozen/case/sale/my price per variant.
  app.get('/api/sanmar/pricing', { preHandler: requireStaff }, async (req, reply) => {
    if (!sanmarConfigured()) { reply.code(400); return { error: 'SanMar not configured.' }; }
    const qy = req.query || {};
    if (!qy.style) { reply.code(400); return { error: 'style is required.' }; }
    const parts = [`<style>${xmlEsc(String(qy.style))}</style>`];
    if (qy.color) parts.push(`<color>${xmlEsc(String(qy.color))}</color>`);
    if (qy.size) parts.push(`<size>${xmlEsc(String(qy.size))}</size>`);
    try {
      const xml = await soapCall('pricing',
        `<m:getPricing><arg0>${parts.join('')}</arg0><arg1>${authBlock()}</arg1></m:getPricing>`);
      const rows = tagAll(xml, 'listResponse').map((r) => ({
        style: tag(r, 'style'), color: tag(r, 'color'), size: tag(r, 'size'),
        inventoryKey: tag(r, 'inventoryKey'), sizeIndex: tag(r, 'sizeIndex'),
        piecePrice: numOr(tag(r, 'piecePrice')), dozenPrice: numOr(tag(r, 'dozenPrice')),
        casePrice: numOr(tag(r, 'casePrice')), salePrice: numOr(tag(r, 'salePrice')), myPrice: numOr(tag(r, 'myPrice')),
      }));
      return { style: qy.style, items: rows, message: tag(xml, 'message') };
    } catch (e) { reply.code(502); return { error: String(e && e.message || e) }; }
  });

  // Favorites — GET list, POST toggle (on:false removes). Same shape as otto_favorites.
  app.get('/api/sanmar/favorites', { preHandler: requireStaff }, async () => {
    try {
      const r = await q('select style, name, image, price from sanmar_favorites order by created_at desc');
      return { favorites: r.rows.map((x) => ({ ...x, image: x.image })) };
    } catch { return { favorites: [] }; }
  });
  app.post('/api/sanmar/favorites', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const style = String(b.style || '').trim();
    if (!style) { reply.code(400); return { error: 'style required' }; }
    if (b.on === false) { await q('delete from sanmar_favorites where style=$1', [style]).catch(() => {}); return { ok: true, favorited: false }; }
    await q(`insert into sanmar_favorites (style, name, image, price, created_by) values ($1,$2,$3,$4,$5)
             on conflict (style) do update set name=excluded.name, image=excluded.image, price=excluded.price`,
      [style, b.name || null, b.image || null, b.price != null ? Number(b.price) : null, req.user && req.user.sub || null]).catch(() => {});
    return { ok: true, favorited: true };
  });

  // Place a purchase order. SAFETY: dry-run unless SANMAR_ORDER_LIVE='1'. Even live, the
  // real PO envelope is NOT sent yet — its format lives in SanMar's separate Purchase Order
  // Submission Guide, which this integration guide doesn't specify. So we assemble and
  // return the normalized lines for review; wiring the live SOAP PO waits on that guide.
  app.post('/api/sanmar/order', { preHandler: requireStaff }, async (req, reply) => {
    if (!sanmarConfigured()) { reply.code(400); return { error: 'SanMar not configured.' }; }
    const b = req.body || {};
    const lines = (Array.isArray(b.lines) ? b.lines : [])
      .map((l) => ({ style: String(l.style || '').trim(), color: String(l.color || '').trim(), size: String(l.size || '').trim(), qty: Math.max(1, Number(l.qty) || 1) }))
      .filter((l) => l.style);
    if (!lines.length) { reply.code(400); return { error: 'At least one line (style + qty) is required.' }; }
    const payload = { customerNo: cfg().cust, poNumber: b.poNumber || ('EG-' + (b.orderRef || 'PO')), lines };

    if (String(process.env.SANMAR_ORDER_LIVE || '') !== '1') {
      return { dryRun: true, stage: isStage(), note: 'SANMAR_ORDER_LIVE!=1 → NOT sent to SanMar. Review the lines; the live PO submission is wired once the SanMar Purchase Order Submission Guide payload is confirmed.', payload };
    }
    reply.code(501);
    return { error: 'Live SanMar ordering is not wired yet — the PO envelope format comes from SanMar\'s Purchase Order Submission Guide (not in the integration guide). Leave SANMAR_ORDER_LIVE unset to use the dry run.', payload };
  });
}
