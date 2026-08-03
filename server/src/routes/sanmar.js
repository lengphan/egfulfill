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

// ── Bulk catalog (SDL / EPDD flat file) ──────────────────────────────────────
// SanMar's browsable catalog does NOT come from the Web Service — getProductInfoByBrand/
// ByCategory are async FTP drops, and the style call needs a style you already know. The
// whole, searchable catalog is the SDL/EPDD comma-delimited file SanMar regenerates nightly
// on their FTP. We ingest that file into `sanmar_products` (same idea as otto_products) and
// serve browse/search from our DB. The file has a HEADER ROW, so we map by column NAME, not
// a fixed position — resilient to SanMar reordering or adding columns.

// Quote-aware CSV: handles "" escaped quotes and commas/newlines inside quoted fields.
function parseCsvRows(text) {
  const rows = []; let row = []; let field = ''; let inQ = false;
  const s = String(text || '').replace(/^﻿/, ''); // strip BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

// Column name → our field. Header is normalised to lowercase alphanumerics ("STYLE#" →
// "style", "PRODUCT_TITLE" → "producttitle"); first candidate that appears in the header wins.
const SANMAR_CSV_FIELDS = {
  uniqueKey:    ['uniquekey'],
  style:        ['style', 'stylenumber', 'stylenum'],
  title:        ['producttitle', 'title'],
  description:  ['productdescription', 'description'],
  brand:        ['brandname', 'brand', 'mill', 'millname'],
  category:     ['categoryname', 'category'],
  color:        ['colorname', 'color'],
  catalogColor: ['catalogcolor', 'mainframecolor', 'sanmarmainframecolor'],
  size:         ['size'],
  sizeIndex:    ['sizeindex'],
  inventoryKey: ['inventorykey'],
  status:       ['productstatus', 'status'],
  keywords:     ['keywords'],
  piecePrice:   ['pieceprice', 'myprice'],
  casePrice:    ['caseprice'],
  msrp:         ['msrp', 'piecepricemsrp'],
  qty:          ['qty', 'quantity', 'totalqty', 'inventory', 'totalinventory'],
  // Image columns are ordered "resolves to a real picture first", which is NOT the same as
  // "most specific first". SanMar mixes two conventions and only some of them are fetchable:
  //   FRONT_MODEL_IMAGE_URL          full https URL, colour-specific   -> 200  ✅
  //   PRODUCT_IMAGE  "29M.jpg"       bare, under /catalog/images/      -> 200  ✅
  //   THUMBNAIL_IMAGE "29MTN.jpg"    bare, under /catalog/images/      -> 200  ✅
  //   COLOR_SWATCH_IMAGE "29Msw.jpg" bare, under /catalog/images/      -> 200  ✅
  //   COLOR_PRODUCT_IMAGE, COLOR_PRODUCT_IMAGE_THUMBNAIL, COLOR_SQUARE_IMAGE
  //                                  bare, but live under a DATED imglib path we cannot
  //                                  reconstruct from the file          -> 302  ❌
  // The COLOR_* names are excluded for that reason. Beware when re-checking: a missing image
  // 302s to Image404ErrorHandler.jsp which SERVES A PLACEHOLDER JPEG, so `curl -L` reports
  // 200 for everything. Test without following redirects.
  image:        ['frontmodelimageurl', 'productimage', 'frontmodelimage'],
  swatch:       ['colorswatchimageurl', 'colorswatchimage', 'swatchimage'],
  thumbnail:    ['thumbnailimage', 'thumbnailimageurl'],
};
const normHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// SanMar's SDL mixes two conventions in the image columns: the *_URL ones carry a full
// https://cdnm.sanmar.com/... address, every other one carries a BARE FILENAME ("29M.jpg",
// "29Msw.jpg"). Storing the bare name renders a broken tile, so anything that isn't already
// absolute gets the catalog base prepended. Verified against the live CDN:
//   https://cdnm.sanmar.com/catalog/images/29M.jpg -> 200
const SANMAR_IMG_BASE = 'https://cdnm.sanmar.com/catalog/images/';
function absolutizeImg(v) {
  const s = String(v || '').trim();          // the raw file has trailing spaces on some URLs
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return SANMAR_IMG_BASE + s.replace(/^\/+/, '');
}

// Parse a SanMar SDL/EPDD CSV into normalized variant rows. Returns [] if there's no
// recognisable header (so a wrong file can't silently write junk).
function parseSanmarCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(normHeader);
  const idx = {};
  for (const [field, cands] of Object.entries(SANMAR_CSV_FIELDS)) {
    for (const cand of cands) { const i = header.indexOf(cand); if (i >= 0) { idx[field] = i; break; } }
  }
  // Need at least a style column to be a real product file.
  if (idx.style == null && idx.uniqueKey == null) return [];
  const num = (v) => { const n = parseFloat(String(v).replace(/[$,]/g, '')); return isFinite(n) ? n : null; };
  const cell = (r, f) => (idx[f] != null ? String(r[idx[f]] ?? '').trim() : '');
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const style = cell(r, 'style');
    let uniqueKey = cell(r, 'uniqueKey');
    const color = cell(r, 'color') || cell(r, 'catalogColor');
    const size = cell(r, 'size');
    if (!uniqueKey) uniqueKey = [style, color, size].filter(Boolean).join('_');
    if (!uniqueKey || (!style && !cell(r, 'title'))) continue;
    out.push({
      uniqueKey, style, title: cell(r, 'title'), description: cell(r, 'description'),
      brand: cell(r, 'brand'), category: cell(r, 'category'),
      color, catalogColor: cell(r, 'catalogColor'), size, sizeIndex: cell(r, 'sizeIndex'),
      inventoryKey: cell(r, 'inventoryKey'), status: cell(r, 'status'), keywords: cell(r, 'keywords'),
      piecePrice: num(cell(r, 'piecePrice')), casePrice: num(cell(r, 'casePrice')), msrp: num(cell(r, 'msrp')),
      qty: idx.qty != null ? (parseInt(cell(r, 'qty').replace(/[^0-9-]/g, ''), 10) || 0) : null,
      image: absolutizeImg(cell(r, 'image')), swatch: absolutizeImg(cell(r, 'swatch')),
      thumbnail: absolutizeImg(cell(r, 'thumbnail')),
    });
  }
  return out;
}

export const sanmarEnabled = () => sanmarConfigured();

export function sanmarRoutes(app, requireAuth, requireStaff, requireAdmin, requireWarehouse) {
  // Shared favorites shortlist, mirroring ss_favorites / otto_favorites.
  q(`create table if not exists sanmar_favorites (
       style text primary key, name text, image text, price numeric,
       created_by uuid, created_at timestamptz default now())`).catch(() => {});

  // Bulk catalog — one row per style/color/size variant, ingested from the SDL/EPDD file.
  // This is what makes SanMar browsable/keyword-searchable in the supplier catalog, the same
  // way otto_products backs the Otto browse. Reference data only: spends nothing, touches no
  // inventory. Placing an actual PO stays gated + warehouse/admin.
  q(`create table if not exists sanmar_products (
       unique_key text primary key,
       style text, title text, description text,
       brand text, category text,
       color text, catalog_color text, size text, size_index text, inventory_key text,
       status text, keywords text,
       piece_price numeric(12,2), case_price numeric(12,2), msrp numeric(12,2), qty int,
       image text, swatch text, thumbnail text,
       data jsonb, synced_at timestamptz default now())`).catch(() => {});

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

  // ── Bulk catalog import + browse ───────────────────────────────────────────
  // One row of the upsert, as a parameter array. Shared by the batched writer below so the
  // column order can never drift between the single- and multi-row paths.
  const IMPORT_COLS = 21;
  const importParams = (r) => [
    String(r.uniqueKey || r.unique_key || '').trim(),
    r.style || null, r.title || null, r.description || null, r.brand || null,
    r.category || null, r.color || null, r.catalogColor || r.catalog_color || null, r.size || null,
    r.sizeIndex || r.size_index || null, r.inventoryKey || r.inventory_key || null, r.status || null,
    r.keywords || null,
    (r.piecePrice != null && isFinite(Number(r.piecePrice))) ? Number(r.piecePrice) : null,
    (r.casePrice != null && isFinite(Number(r.casePrice))) ? Number(r.casePrice) : null,
    (r.msrp != null && isFinite(Number(r.msrp))) ? Number(r.msrp) : null,
    (r.qty != null && isFinite(Number(r.qty))) ? Math.trunc(Number(r.qty)) : null,
    r.image || null, r.swatch || null, r.thumbnail || null, JSON.stringify(r.data || {}),
  ];

  // Upsert rows in MULTI-ROW batches. The original loop awaited one INSERT per row, which is
  // fine for a 500-row test file and hopeless for the real SDL: 161k rows x one round-trip
  // each ran far longer than any HTTP request survives. 500 rows/statement keeps us well
  // under Postgres' 65535-parameter cap (500 x 21 = 10,500) and turns 161k round-trips into
  // ~320. A failed batch is retried row-by-row so one bad record can't discard 499 good ones.
  async function upsertSanmarRows(rows, onProgress) {
    const SQL_HEAD = `insert into sanmar_products
           (unique_key, style, title, description, brand, category, color, catalog_color, size,
            size_index, inventory_key, status, keywords, piece_price, case_price, msrp, qty,
            image, swatch, thumbnail, data, synced_at)
         values `;
    const SQL_TAIL = `
         on conflict (unique_key) do update set
           style=excluded.style, title=excluded.title, description=excluded.description,
           brand=excluded.brand, category=excluded.category, color=excluded.color,
           catalog_color=excluded.catalog_color, size=excluded.size, size_index=excluded.size_index,
           inventory_key=excluded.inventory_key, status=excluded.status, keywords=excluded.keywords,
           piece_price=excluded.piece_price, case_price=excluded.case_price, msrp=excluded.msrp,
           qty=excluded.qty, image=excluded.image, swatch=excluded.swatch, thumbnail=excluded.thumbnail,
           data=excluded.data, synced_at=now()`;
    const BATCH = 500;
    // Last write wins inside a single statement, and Postgres rejects a batch that touches
    // the same conflict target twice ("cannot affect row a second time"). The SDL does repeat
    // a unique_key occasionally, so collapse duplicates before batching rather than losing
    // the whole batch to one repeat.
    const byKey = new Map();
    for (const r of rows) {
      const k = String(r.uniqueKey || r.unique_key || '').trim();
      if (k) byKey.set(k, r);
    }
    const deduped = [...byKey.values()];
    let n = 0;
    for (let i = 0; i < deduped.length; i += BATCH) {
      const chunk = deduped.slice(i, i + BATCH);
      const params = [];
      const tuples = chunk.map((r, j) => {
        params.push(...importParams(r));
        const base = j * IMPORT_COLS;
        const ph = Array.from({ length: IMPORT_COLS }, (_, k) => `$${base + k + 1}`).join(',');
        return `(${ph}, now())`;
      });
      try {
        await q(SQL_HEAD + tuples.join(',') + SQL_TAIL, params);
        n += chunk.length;
      } catch {
        // Fall back to one-at-a-time for this chunk so a single malformed row costs one row.
        for (const r of chunk) {
          const ph = Array.from({ length: IMPORT_COLS }, (_, k) => `$${k + 1}`).join(',');
          const ok = await q(SQL_HEAD + `(${ph}, now())` + SQL_TAIL, importParams(r))
            .then(() => true).catch(() => false);
          if (ok) n++;
        }
      }
      if (onProgress) onProgress(n, deduped.length);
    }
    return { imported: n, skipped: rows.length - deduped.length };
  }

  // Import the SDL/EPDD catalog into sanmar_products. Accepts EITHER the raw CSV text
  // ({ csv }) — parsed server-side by the documented column names — OR pre-parsed rows
  // ({ products: [...] }), mirroring /api/otto/import. Whole-batch upsert by unique_key.
  // NOTE: the real SanMar_SDL_N.csv is ~195MB, which exceeds both the 60MB body limit here
  // and Vercel's ~4.5MB proxy cap, so the browser can never carry it — use
  // POST /api/sanmar/import/local below for the real file. This route stays for small
  // hand-made files and for the pre-parsed shape. Staff-gated, like Otto: it's supplier
  // REFERENCE data, spends nothing, and adds nothing sellable on its own.
  app.post('/api/sanmar/import', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    let rows = Array.isArray(b.products) ? b.products
      : (typeof b.csv === 'string' ? parseSanmarCsv(b.csv) : []);
    if (!rows.length) {
      reply.code(400);
      return { error: 'No products found. Send { csv } (the SDL/EPDD file text, with its header row) or { products: [...] }.' };
    }
    const { imported: n } = await upsertSanmarRows(rows);
    const c = await q('select count(*)::int as n from sanmar_products').catch(() => ({ rows: [{ n: 0 }] }));
    return { ok: true, imported: n, total: c.rows[0]?.n || 0 };
  });

  // Import the SDL straight off local disk — the only route that can carry the real file.
  // The catalog is ~195MB unzipped, so it can reach neither the browser upload path (Vercel
  // caps a proxied body at ~4.5MB) nor the JSON route above (60MB). The host fetches the zip
  // over SFTP into SANMAR_DATA_DIR, and this reads it from a read-only bind mount.
  //
  // ADMIN-only, and the filename is confined to SANMAR_DATA_DIR by basename() — the path is
  // never allowed to escape via "../", so this cannot be turned into an arbitrary-file read.
  app.post('/api/sanmar/import/local', { preHandler: requireStaff }, async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'Admin only' }; }
    const dir = (process.env.SANMAR_DATA_DIR || '').trim();
    if (!dir) { reply.code(400); return { error: 'SANMAR_DATA_DIR is not set — no local catalog directory is mounted.' }; }
    const { readFile, readdir } = await import('node:fs/promises');
    const { join, basename } = await import('node:path');
    const wanted = basename(String((req.body && req.body.file) || 'SanMar_SDL_N.csv'));
    let text;
    try {
      text = await readFile(join(dir, wanted), 'utf8');
    } catch (e) {
      let available = [];
      try { available = (await readdir(dir)).filter((f) => /\.(csv|txt)$/i.test(f)); } catch { /* dir unreadable */ }
      reply.code(400);
      return { error: `Could not read ${wanted} from the catalog directory.`, detail: (e && e.message) || null, available };
    }
    const rows = parseSanmarCsv(text);
    text = null;                                    // 195MB — let it go before the upsert
    if (!rows.length) { reply.code(400); return { error: `${wanted} has no recognisable SDL header row.` }; }
    const { imported, skipped } = await upsertSanmarRows(rows);
    const c = await q('select count(*)::int as n from sanmar_products').catch(() => ({ rows: [{ n: 0 }] }));
    return { ok: true, file: wanted, parsed: rows.length, duplicateKeys: skipped, imported, total: c.rows[0]?.n || 0 };
  });

  // Catalog status — count + last import time (drives the "import the catalog" empty state).
  app.get('/api/sanmar/catalog/status', { preHandler: requireStaff }, async () => {
    try { const r = await q('select count(*)::int as n, max(synced_at) as last from sanmar_products'); return { count: r.rows[0]?.n || 0, last: r.rows[0]?.last || null }; }
    catch { return { count: 0, last: null }; }
  });

  // Browse the imported catalog, one card per style — the SanMar equivalent of
  // /api/otto/products, so it interleaves in the supplier browse the same way.
  app.get('/api/sanmar/catalog', { preHandler: requireStaff }, async (req, reply) => {
    const search = String(req.query?.search || req.query?.q || '').trim().toLowerCase();
    const limit = Math.min(120, Math.max(1, parseInt(req.query?.limit, 10) || 60));
    const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
    const where = search
      ? `where lower(coalesce(style,'') || ' ' || coalesce(title,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(category,'') || ' ' || coalesce(color,'') || ' ' || coalesce(keywords,'')) like $1`
      : '';
    const params = search ? ['%' + search + '%'] : [];
    try {
      const total = await q(`select count(*)::int as n from (select coalesce(style, unique_key) g from sanmar_products ${where} group by coalesce(style, unique_key)) t`, params);
      const r = await q(
        `select coalesce(style, unique_key) as style, min(brand) as brand, min(title) as name,
                min(description) as description, min(category) as category,
                min(piece_price) as price, max(piece_price) as price_max,
                (array_agg(coalesce(image, thumbnail, swatch)) filter (where coalesce(image, thumbnail, swatch) is not null))[1] as image,
                array_agg(distinct color) filter (where color is not null) as colors,
                array_agg(distinct size) filter (where size is not null) as sizes,
                coalesce(sum(qty), 0) as qty
           from sanmar_products ${where}
          group by coalesce(style, unique_key)
          order by style
          limit ${limit} offset ${offset}`, params);
      let favs = new Set();
      try { const fr = await q('select style from sanmar_favorites'); favs = new Set(fr.rows.map((x) => String(x.style))); } catch { /* no favorites table yet */ }
      const items = r.rows.map((row) => ({ ...row, image: sanmarImg(row.image), favorited: favs.has(String(row.style)) }));
      return { total: total.rows[0]?.n || 0, items };
    } catch (e) { reply.code(500); return { error: String((e && e.message) || e), total: 0, items: [] }; }
  });

  // One style's full detail from the imported catalog — every colour, size and variant key.
  // Mirrors /api/otto/style/:style so the "Add to catalog" + quick-order paths treat SanMar
  // exactly like Otto (no live SOAP call needed; all data is the ingested flat file).
  app.get('/api/sanmar/catalog/:style', { preHandler: requireStaff }, async (req, reply) => {
    const style = String(req.params?.style || '').trim();
    if (!style) { reply.code(400); return { error: 'style required' }; }
    try {
      const r = await q(
        `select unique_key, style, title, description, brand, category, color, catalog_color,
                size, size_index, inventory_key, piece_price, image, swatch, thumbnail
           from sanmar_products where style=$1 order by color, size`, [style]);
      if (!r.rows.length) { reply.code(404); return { error: 'Not in the imported catalog.' }; }
      const rows = r.rows;
      const colorImages = {};
      for (const v of rows) {
        const c = v.color || v.catalog_color;
        if (c && !colorImages[c]) colorImages[c] = sanmarImg(v.image || v.thumbnail || v.swatch);
      }
      const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
      const variants = rows.map((v) => ({
        color: v.color || v.catalog_color || null, size: v.size || null,
        // SanMar's canonical variant handle is the inventory key; fall back to unique_key.
        sku: v.inventory_key || v.unique_key, inventoryKey: v.inventory_key || null, sizeIndex: v.size_index || null,
        price: v.piece_price != null ? Number(v.piece_price) : null, image: sanmarImg(v.image || v.thumbnail),
      }));
      const first = rows[0];
      return {
        style, name: first.title || style, brand: first.brand || 'SanMar', category: first.category || null,
        description: first.description || null,
        price: first.piece_price != null ? Number(first.piece_price) : null,
        image: sanmarImg(first.image || first.thumbnail || first.swatch),
        colors: uniq(rows.map((v) => v.color || v.catalog_color)),
        sizes: uniq(rows.map((v) => v.size)),
        colorImages, variants, skus: variants.map((v) => v.sku),
      };
    } catch (e) { reply.code(500); return { error: String((e && e.message) || e) }; }
  });
}
