// SanMar connector — apparel/blanks supplier (SanMar Web Services, SOAP/XML v24.5).
// -----------------------------------------------------------------------------
// Unlike S&S and Otto (REST/JSON), SanMar is SOAP: we hand-build the request envelope
// and pull fields out of the XML response with a small tag extractor (no XML dependency —
// the responses are flat element trees). Product / Inventory / Pricing are read-only and
// LIVE once the account is onboarded. Ordering (submitPO) is DRY-RUN until
// SANMAR_ORDER_LIVE='1'; getPreSubmitInfo is a safe inventory pre-check (no order placed).
// All routes are STAFF-gated.
//
// ACTIVATION (real-world, not code): SanMar does NOT whitelist IPs (that restriction was
// removed in 2018). The gate is: email sanmarintegrations@sanmar.com + Customer Number →
// sign the Integration Agreement → SanMar enables FTP/Web-Services access → then your
// sanmar.com username + password authenticate the production APIs. PURCHASE-ORDER
// integration is a SEPARATE, later onboarding: SanMar first sets up a TEST environment
// with its OWN credentials (point SANMAR_API_BASE at test-ws.sanmar.com to use them),
// requires a multi-line test PO, then configures production ordering.
//
// Env (also settable in Settings → integration secrets): SANMAR_CUSTOMER_NUMBER,
//   SANMAR_USERNAME, SANMAR_PASSWORD, SANMAR_API_BASE (prod default; test-ws for the PO
//   test environment), SANMAR_ORDER_LIVE (order gate). Read at CALL TIME so UI-saved keys
//   apply without a restart, matching the _LIVE gate pattern used by the other suppliers.

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
// The non-production host is now test-ws.sanmar.com ("Edev"/"stage" were renamed "Test").
const isStage = () => /(test|stage)-ws\.sanmar/i.test(cfg().base);

// SOAP endpoints (the WSDL URL without ?wsdl) + the operation namespace each one uses.
// ProductInfo/Pricing live under impl.*; Inventory + PO live under webservice.* (the PO
// service is SanMarPOServicePort — a separate WSDL from the read services).
const SVC = {
  product:   { path: '/SanMarWebService/SanMarProductInfoServicePort', ns: 'http://impl.webservice.integration.sanmar.com/' },
  pricing:   { path: '/SanMarWebService/SanMarPricingServicePort',     ns: 'http://impl.webservice.integration.sanmar.com/' },
  inventory: { path: '/SanMarWebService/SanMarWebServicePort',         ns: 'http://webservice.integration.sanmar.com/' },
  po:        { path: '/SanMarWebService/SanMarPOServicePort',          ns: 'http://webservice.integration.sanmar.com/' },
};
// For a style+color+size query the inventory response is a flat quantity per warehouse in
// THIS fixed order (no whse number is returned — guide v24.5 p.52). #12 is Arizona (virtual
// whses 8-11 roll into it); #31 (Richmond VA) was added July 2024 and, when present, is the
// last value — a shorter list just means the trailing warehouses returned nothing.
const WHSE_ORDER = [
  { no: 1, city: 'Seattle', state: 'WA' }, { no: 2, city: 'Cincinnati', state: 'OH' },
  { no: 3, city: 'Dallas', state: 'TX' }, { no: 4, city: 'Reno', state: 'NV' },
  { no: 5, city: 'Robbinsville', state: 'NJ' }, { no: 6, city: 'Jacksonville', state: 'FL' },
  { no: 7, city: 'Minneapolis', state: 'MN' }, { no: 12, city: 'Phoenix', state: 'AZ' },
  { no: 31, city: 'Richmond', state: 'VA' },
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
// opts.tolerateError: don't throw on errorOccurred=true (getPreSubmitInfo reports an
// out-of-stock line THAT way — a valid answer, not a transport failure).
async function soapCall(service, bodyInner, opts = {}) {
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
    // A timeout here usually means the account isn't onboarded yet (agreement not signed),
    // or our own outbound firewall is blocking port 8080 — NOT an IP whitelist (SanMar
    // dropped IP restrictions in 2018).
    recordUsage('sanmar', { endpoint: service, ok: false });
    throw new Error(`Couldn't reach SanMar (${String(e && e.message || e)}). If this is a timeout, confirm the account is onboarded and that outbound port 8080 is open.`);
  }
  recordUsage('sanmar', { endpoint: service, ok: r.ok });
  if (!r.ok) throw new Error(`SanMar ${service} HTTP ${r.status}: ${String(text).slice(0, 300)}`);
  const fault = tag(text, 'faultstring');
  if (fault) throw new Error('SanMar fault: ' + fault);
  // The guide spells the flag BOTH ways in different responses ("errorOccured" in product,
  // "errorOccurred" in pricing) — check both so a real error is never read as success.
  const err = (tag(text, 'errorOccurred') || tag(text, 'errorOccured') || '').toLowerCase();
  if (err === 'true' && !opts.tolerateError) throw new Error(tag(text, 'message') || 'SanMar returned an error.');
  return text;
}

const authBlock = () => {
  const c = cfg();
  return `<sanMarCustomerNumber>${xmlEsc(c.cust)}</sanMarCustomerNumber>` +
    `<sanMarUserName>${xmlEsc(c.user)}</sanMarUserName>` +
    `<sanMarUserPassword>${xmlEsc(c.pass)}</sanMarUserPassword>`;
};

// Normalise the order body into { poNumber, ship{...}, lines[] } used by both the dry-run
// echo and the live submitPO/getPreSubmitInfo calls. Each line prefers inventoryKey+sizeIndex
// (least error-prone per the guide); otherwise style + color + size, where COLOR MUST be the
// SANMAR_MAINFRAME_COLOR (catalog colour), not the display name. NO commas in any field —
// SanMar's flat-file layer is comma-delimited and a stray comma corrupts the order.
function normalizeOrder(b) {
  const noComma = (v) => String(v == null ? '' : v).replace(/,/g, ' ').trim();
  const s = b.shipTo || {};
  const ship = {
    company: noComma(s.company || s.name), attention: noComma(s.attention || b.attention),
    address1: noComma(s.address1 || s.street), address2: noComma(s.address2 || s.street2),
    city: noComma(s.city), state: noComma(s.state), zip: noComma(s.zip || s.postalCode),
    email: noComma(s.email), method: noComma(s.method || s.shipMethod) || 'UPS',
    residence: /^y/i.test(String(s.residence || '')) ? 'Y' : 'N',
  };
  const lines = (Array.isArray(b.lines) ? b.lines : []).map((l) => ({
    inventoryKey: noComma(l.inventoryKey), sizeIndex: noComma(l.sizeIndex),
    style: noComma(l.style), color: noComma(l.color), size: noComma(l.size),
    qty: Math.max(1, Number(l.qty) || 1),
  })).filter((l) => l.style || l.inventoryKey);
  return { poNumber: noComma(b.poNumber || ('EG-' + (b.orderRef || 'PO'))).slice(0, 28), ship, lines };
}
// Build the shared <arg0> for submitPO / getPreSubmitInfo from a normalized order.
function poArg0(o) {
  const details = o.lines.map((l) =>
    `<webServicePoDetailList>` +
    `<inventoryKey>${xmlEsc(l.inventoryKey)}</inventoryKey>` +
    `<sizeIndex>${xmlEsc(l.sizeIndex)}</sizeIndex>` +
    `<style>${xmlEsc(l.style)}</style>` +
    `<color>${xmlEsc(l.color)}</color>` +
    `<size>${xmlEsc(l.size)}</size>` +
    `<quantity>${xmlEsc(l.qty)}</quantity>` +
    `<whseNo></whseNo>` +
    `</webServicePoDetailList>`).join('');
  return `<arg0>` +
    `<attention>${xmlEsc(o.ship.attention)}</attention>` +
    `<notes></notes>` +
    `<poNum>${xmlEsc(o.poNumber)}</poNum>` +
    `<residence>${xmlEsc(o.ship.residence)}</residence>` +
    `<department></department>` +
    `<shipTo>${xmlEsc(o.ship.company)}</shipTo>` +
    `<shipAddress1>${xmlEsc(o.ship.address1)}</shipAddress1>` +
    `<shipAddress2>${xmlEsc(o.ship.address2)}</shipAddress2>` +
    `<shipCity>${xmlEsc(o.ship.city)}</shipCity>` +
    `<shipState>${xmlEsc(o.ship.state)}</shipState>` +
    `<shipZip>${xmlEsc(o.ship.zip)}</shipZip>` +
    `<shipMethod>${xmlEsc(o.ship.method)}</shipMethod>` +
    `<shipEmail>${xmlEsc(o.ship.email)}</shipEmail>` +
    details +
    `</arg0>`;
}
// The four ship fields SanMar rejects a PO without.
function missingShip(o) {
  return ['address1', 'city', 'state', 'zip'].filter((k) => !o.ship[k]);
}

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

  // Connectivity test — one signed call (pricing for a known style) proves the credentials
  // authenticate and the account is onboarded, before trusting a browse. Mirrors the
  // Otto/Wilcom "verify one call".
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

  // Product search by STYLE (+ optional colour/size) — the only product-info call that still
  // returns rows inline (guide v24.5). getProductInfoByBrand / getProductInfoByCategory are
  // now ASYNCHRONOUS: they drop a CSV on SanMar's FTP server and return only an ack, so we
  // don't offer them as an inline browse — a caller wanting a whole brand/category should
  // pull the SDL/EPDD bulk file over FTP instead.
  app.get('/api/sanmar/products', { preHandler: requireStaff }, async (req, reply) => {
    if (!sanmarConfigured()) { reply.code(400); return { error: 'SanMar not configured.' }; }
    const qy = req.query || {};
    if (qy.brand || qy.category) {
      reply.code(400);
      return { error: 'SanMar returns brand/category catalogs as an async FTP file, not inline. Search by style here, or pull the SDL/EPDD bulk file over FTP for a whole brand or category.' };
    }
    if (!qy.style) { reply.code(400); return { error: 'Provide a style (colour and size optional).' }; }
    try {
      const parts = [`<style>${xmlEsc(String(qy.style))}</style>`];
      if (qy.color) parts.push(`<color>${xmlEsc(String(qy.color))}</color>`);
      if (qy.size) parts.push(`<size>${xmlEsc(String(qy.size))}</size>`);
      const xml = await soapCall('product',
        `<m:getProductInfoByStyleColorSize><arg0>${parts.join('')}</arg0><arg1>${authBlock()}</arg1></m:getProductInfoByStyleColorSize>`);
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

  // Inventory pre-check (getPreSubmitInfo) — confirms the closest warehouse can fill each
  // line WITHOUT placing an order, so it's safe to run live (no SANMAR_ORDER_LIVE gate). Use
  // it before submitPO. Still needs the account onboarded for PO integration.
  app.post('/api/sanmar/presubmit', { preHandler: requireStaff }, async (req, reply) => {
    if (!sanmarConfigured()) { reply.code(400); return { error: 'SanMar not configured.' }; }
    const o = normalizeOrder(req.body || {});
    if (!o.lines.length) { reply.code(400); return { error: 'At least one line (style + qty, or inventoryKey) is required.' }; }
    const miss = missingShip(o);
    if (miss.length) { reply.code(400); return { error: 'Ship-to needs: ' + miss.join(', ') + '.' }; }
    try {
      const xml = await soapCall('po', `<m:getPreSubmitInfo>${poArg0(o)}<arg1>${authBlock()}</arg1></m:getPreSubmitInfo>`, { tolerateError: true });
      // Each detail carries its own availability message + the whse that would fill it.
      const lines = tagAll(xml, 'webServicePoDetailList').map((d) => ({
        style: tag(d, 'style'), color: tag(d, 'color'), size: tag(d, 'size'),
        inventoryKey: tag(d, 'inventoryKey'), quantity: numOr(tag(d, 'quantity')),
        whseNo: tag(d, 'whseNo') || null, available: /confirmed and available/i.test(tag(d, 'message')),
        message: tag(d, 'message'),
      }));
      return { ok: true, allAvailable: lines.length > 0 && lines.every((l) => l.available), message: tag(xml, 'message'), lines };
    } catch (e) { reply.code(502); return { error: String(e && e.message || e) }; }
  });

  // Place a purchase order (submitPO). SAFETY: dry-run unless SANMAR_ORDER_LIVE='1' — even
  // with a confirmed-good payload it isn't sent until the flag is set, the same posture as
  // the S&S/Otto order paths. Payment (NET terms or a card on file) and the shipping option
  // are account config at SanMar, NOT part of this call.
  app.post('/api/sanmar/order', { preHandler: requireStaff }, async (req, reply) => {
    if (!sanmarConfigured()) { reply.code(400); return { error: 'SanMar not configured.' }; }
    const o = normalizeOrder(req.body || {});
    if (!o.lines.length) { reply.code(400); return { error: 'At least one line (style + qty, or inventoryKey) is required.' }; }

    if (String(process.env.SANMAR_ORDER_LIVE || '') !== '1') {
      return {
        dryRun: true, stage: isStage(),
        note: 'SANMAR_ORDER_LIVE!=1 → NOT sent to SanMar. Review the payload; set SANMAR_ORDER_LIVE=1 (after PO onboarding + a passing test PO) to place it for real.',
        missing: missingShip(o),
        payload: o,
      };
    }
    const miss = missingShip(o);
    if (miss.length) { reply.code(400); return { error: 'SanMar needs a ship-to ' + miss.join(', ') + ' to place the order.' }; }
    try {
      const xml = await soapCall('po', `<m:submitPO>${poArg0(o)}<arg1>${authBlock()}</arg1></m:submitPO>`);
      // soapCall already threw on errorOccurred=true; a clean response is "PO Submission successful".
      return { ok: true, stage: isStage(), poNumber: o.poNumber, message: tag(xml, 'message') || 'PO Submission successful' };
    } catch (e) { reply.code(502); return { error: String(e && e.message || e) }; }
  });
}
