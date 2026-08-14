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
  // PRODUCT_IMAGE kept SEPARATELY, not just as a fallback for `image`. It is the same photo
  // at 300x450 and ~7KB where FRONT_MODEL_IMAGE_URL is 1200x1800 and ~230KB — measured on
  // the live CDN — and the browse grid draws it into a ~180px tile. Serving the big one
  // there was ~33x the bytes for pixels nobody sees: a 24-card page pulled about 5.5MB of
  // photography instead of 170KB.
  //
  // Taken from the column rather than derived from the style. It IS `<STYLE>.jpg` for 4,063
  // of the 4,071 styles in the file, but 8 are not (CP82b.jpg, DM1170L-2.jpg, F222red.jpg …)
  // and a wrong name does not 404 — it 302s to Image404ErrorHandler.jsp, which serves a
  // placeholder JPEG with a 200. Those eight would have silently shown "no image".
  cardImage:    ['productimage'],
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

// Header row -> {field: columnIndex}. Returns null when the file has no recognisable SDL
// header, so a wrong file can't silently write junk.
function buildSanmarIdx(headerRow) {
  const header = headerRow.map(normHeader);
  const idx = {};
  for (const [field, cands] of Object.entries(SANMAR_CSV_FIELDS)) {
    for (const cand of cands) { const i = header.indexOf(cand); if (i >= 0) { idx[field] = i; break; } }
  }
  return (idx.style != null || idx.uniqueKey != null) ? idx : null;
}

// One CSV record -> one normalized variant, or null if it isn't a usable product row.
function rowToVariant(r, idx) {
  const num = (v) => { const n = parseFloat(String(v).replace(/[$,]/g, '')); return isFinite(n) ? n : null; };
  const cell = (f) => (idx[f] != null ? String(r[idx[f]] ?? '').trim() : '');
  const style = cell('style');
  let uniqueKey = cell('uniqueKey');
  const color = cell('color') || cell('catalogColor');
  const size = cell('size');
  if (!uniqueKey) uniqueKey = [style, color, size].filter(Boolean).join('_');
  if (!uniqueKey || (!style && !cell('title'))) return null;
  return {
    uniqueKey, style, title: cell('title'), description: cell('description'),
    brand: cell('brand'), category: cell('category'),
    color, catalogColor: cell('catalogColor'), size, sizeIndex: cell('sizeIndex'),
    inventoryKey: cell('inventoryKey'), status: cell('status'), keywords: cell('keywords'),
    piecePrice: num(cell('piecePrice')), casePrice: num(cell('casePrice')), msrp: num(cell('msrp')),
    qty: idx.qty != null ? (parseInt(cell('qty').replace(/[^0-9-]/g, ''), 10) || 0) : null,
    image: absolutizeImg(cell('image')), cardImage: absolutizeImg(cell('cardImage')),
    swatch: absolutizeImg(cell('swatch')),
    thumbnail: absolutizeImg(cell('thumbnail')),
  };
}

// Parse a SanMar SDL/EPDD CSV into normalized variant rows. Whole-string; only safe for the
// small hand-made files the browser route accepts. The real 195MB SDL goes through
// streamSanmarStyles() instead — see the note there.
function parseSanmarCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const idx = buildSanmarIdx(rows[0]);
  if (!idx) return [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const v = rowToVariant(rows[i], idx);
    if (v) out.push(v);
  }
  return out;
}

// ── style-level aggregation ──────────────────────────────────────────────────
// The SDL is one row per style+colour+size: 161,304 rows for 4,081 styles. Almost all of
// that is REPEATED style text — the same title, description, brand and category copied onto
// every variant (descriptions alone are 61.9MB of the 187MB file). Stored raw it roughly
// DOUBLES the database and every nightly backup, to serve a browse grid that immediately
// collapses it back to one card per style with GROUP BY.
//
// So we fold it here: one row per style, style text stored once, and the genuinely
// per-variant fields kept as a compact JSONB array. Short keys (c/s/i/k/u/p) are deliberate
// — this array is repeated 161k times in aggregate, so the key names are a real cost.
// Nothing is lost: inventoryKey is SanMar's ordering handle and it survives, which is why
// this isn't simply "drop the variants".
// Canonical size order. SIZE_INDEX CANNOT be used for this: it restarts per price group, so
// in style 29M both S and 3XL carry index 2, and both M and 4XL carry 3 — sorting by it
// interleaves the ladder ("2XL,3XL,S,4XL,M,5XL,L,XL"). Built against the real file's 213
// distinct SIZE values: the letter ladder, tall (LT/2XLT), combos (S/M), toddler (2T, 5/6T),
// infant months (06M), and 4-digit waist+inseam (3230).
const SIZE_LADDER = ['XXXS', 'XXS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL',
  '5XL', '6XL', '7XL', '8XL', '9XL', '10XL'];
const LADDER_RANK = new Map(SIZE_LADDER.map((s, i) => [s, i]));
// Same garment, two spellings — keep them adjacent instead of sorting XXL far from 2XL.
LADDER_RANK.set('XXL', LADDER_RANK.get('2XL'));
LADDER_RANK.set('XXXL', LADDER_RANK.get('3XL'));
LADDER_RANK.set('XXXXL', LADDER_RANK.get('4XL'));

// [group, value, text] — compared left to right, so families stay together and only sort
// within themselves. Unknown sizes land in a trailing group alphabetically rather than
// scrambling the known ones.
function sizeRank(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return [99, 0, ''];
  if (s === 'OSFA' || s === 'OS' || s === 'ONE SIZE') return [0, 0, s];
  let m;
  if ((m = s.match(/^0*(\d+)M$/))) return [10, parseInt(m[1], 10), s];             // 06M, 24M
  // 2T, 5/6T. A range sorts just after the exact size it starts at, so 5T precedes 5/6T.
  if ((m = s.match(/^(\d+)(?:\/\d+)?T$/))) return [20, parseInt(m[1], 10) + (s.includes('/') ? 0.5 : 0), s];
  if ((m = s.match(/^(.+?)T$/)) && LADDER_RANK.has(m[1])) return [40, LADDER_RANK.get(m[1]), s]; // LT, 2XLT
  // SR/MR/LR are "regular" lengths — same ladder, nudged after the plain size.
  if ((m = s.match(/^(.+?)R$/)) && LADDER_RANK.has(m[1])) return [30, LADDER_RANK.get(m[1]) + 0.5, s];
  if (LADDER_RANK.has(s)) return [30, LADDER_RANK.get(s), s];
  if ((m = s.match(/^([A-Z0-9]+)\/[A-Z0-9]+$/)) && LADDER_RANK.has(m[1])) {        // S/M, L/XL
    return [30, LADDER_RANK.get(m[1]) + 0.25, s];
  }
  if (/^\d+$/.test(s)) return [50, parseInt(s, 10), s];                            // 3230 waist+inseam
  return [90, 0, s];
}
const bySize = (a, b) => {
  const x = sizeRank(a), y = sizeRank(b);
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
};

function makeStyleAggregator() {
  const byStyle = new Map();
  const best = (a, b) => (a && String(a).trim() ? a : b);   // first non-empty wins
  return {
    add(v) {
      const key = v.style || v.uniqueKey;
      if (!key) return;
      let s = byStyle.get(key);
      if (!s) {
        s = { style: key, title: '', description: '', brand: '', category: '',
              priceMin: null, priceMax: null, msrp: null,
              image: null, cardImage: null, swatch: null, thumbnail: null,
              colors: new Set(), sizes: new Set(), statuses: new Set(), variants: [] };
        byStyle.set(key, s);
      }
      s.title = best(s.title, v.title); s.description = best(s.description, v.description);
      s.brand = best(s.brand, v.brand); s.category = best(s.category, v.category);
      s.image = s.image || v.image || v.thumbnail || v.swatch;
      // The small grid photo. Falls back to the big one so a style whose row has no
      // PRODUCT_IMAGE still renders — heavier, but never blank.
      s.cardImage = s.cardImage || v.cardImage;
      s.swatch = s.swatch || v.swatch; s.thumbnail = s.thumbnail || v.thumbnail;
      if (v.piecePrice != null) {
        s.priceMin = s.priceMin == null ? v.piecePrice : Math.min(s.priceMin, v.piecePrice);
        s.priceMax = s.priceMax == null ? v.piecePrice : Math.max(s.priceMax, v.piecePrice);
      }
      if (v.msrp != null && s.msrp == null) s.msrp = v.msrp;
      if (v.color) s.colors.add(v.color);
      if (v.size) s.sizes.add(v.size);
      if (v.status) s.statuses.add(v.status);
      s.variants.push({
        c: v.color || null, s: v.size || null, i: v.sizeIndex || null,
        k: v.inventoryKey || null, u: v.uniqueKey, p: v.piecePrice,
      });
    },
    styles() {
      return [...byStyle.values()].map((s) => ({
        style: s.style, title: s.title || s.style, description: s.description || null,
        brand: s.brand || 'SanMar', category: s.category || null,
        priceMin: s.priceMin, priceMax: s.priceMax, msrp: s.msrp,
        image: s.image, cardImage: s.cardImage, swatch: s.swatch, thumbnail: s.thumbnail,
        colors: [...s.colors].sort(),
        sizes: [...s.sizes].sort(bySize),
        // A style counts as discontinued only when EVERY variant is. A style whose 2XL was
        // dropped but whose S-XL still sell is very much orderable, and hiding it would be
        // wrong. 833 of the 4,081 styles are discontinued outright.
        discontinued: s.statuses.size > 0 && [...s.statuses].every((x) => /discontinu/i.test(x)),
        status: [...s.statuses].sort().join(', ') || null,
        variantCount: s.variants.length,
        // Variants in the same order the UI lists them: colour, then the size ladder.
        variants: s.variants.sort((a, b) =>
          String(a.c || '').localeCompare(String(b.c || '')) || bySize(a.s, b.s)),
      }));
    },
  };
}

// Fold a whole-string parse into styles (used by the browser/JSON import route).
function stylesFromVariants(rows) {
  const agg = makeStyleAggregator();
  for (const v of rows) agg.add(v);
  return agg.styles();
}

// STREAM the SDL off disk and aggregate as we go. The whole-string path cannot be used for
// the real file: reading 195MB into a string and building 161k objects was enough memory
// pressure to restart the API container mid-import. Here peak memory is the ~4,081 style
// accumulators, not the file.
//
// Records are assembled by QUOTE PARITY rather than by line, because a CSV field may legally
// contain a newline inside quotes; splitting on \n alone would shear those records in half.
// Escaped quotes ("") count as two, so parity still holds.
async function streamSanmarStyles(filePath) {
  const { createReadStream } = await import('node:fs');
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity,
  });
  const agg = makeStyleAggregator();
  let idx = null, pending = '', variants = 0, skipped = 0;
  try {
    for await (const line of rl) {
      pending = pending === '' ? line : pending + '\n' + line;
      let quotes = 0;
      for (let i = 0; i < pending.length; i++) if (pending[i] === '"') quotes++;
      if (quotes % 2 !== 0) continue;                 // record continues on the next line
      const rec = parseCsvRows(pending)[0];
      pending = '';
      if (!rec) continue;
      if (!idx) {                                     // first record is the header
        idx = buildSanmarIdx(rec);
        if (!idx) throw new Error('No recognisable SDL header row.');
        continue;
      }
      const v = rowToVariant(rec, idx);
      if (v) { agg.add(v); variants++; } else skipped++;
    }
  } finally { rl.close(); }
  if (!idx) throw new Error('File was empty — no header row.');
  return { styles: agg.styles(), variants, skipped };
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

  // The catalog as the app actually reads it: ONE ROW PER STYLE (~4k), with the per-variant
  // fields folded into `variants` jsonb. See makeStyleAggregator() for why — storing the raw
  // 161k SDL rows doubles the database and every nightly backup to render the same grid.
  q(`create table if not exists sanmar_styles (
       style text primary key,
       title text, description text, brand text, category text,
       price_min numeric(12,2), price_max numeric(12,2), msrp numeric(12,2),
       image text, swatch text, thumbnail text,
       colors text[], sizes text[], status text, discontinued boolean default false,
       variant_count integer, variants jsonb,
       synced_at timestamptz default now())`).catch(() => {});
  q(`alter table sanmar_styles add column if not exists status text`).catch(() => {});
  q(`alter table sanmar_styles add column if not exists card_image text`).catch(() => {});
  q(`alter table sanmar_styles add column if not exists discontinued boolean default false`).catch(() => {});
  q(`create index if not exists sanmar_styles_search
       on sanmar_styles using gin (to_tsvector('simple',
         coalesce(style,'') || ' ' || coalesce(title,'') || ' ' ||
         coalesce(brand,'') || ' ' || coalesce(category,'')))`).catch(() => {});

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
  /**
   * DELIBERATELY NOT AUTH-GATED, and that is the fix rather than an oversight.
   *
   * Every catalog image is rewritten to this route by sanmarImg(), and the browser loads it
   * with <img src="...">. An img tag cannot send an Authorization header — the JWT lives in
   * localStorage and is attached by fetch(), not by the image loader — so a requireStaff
   * gate here meant every request arrived unauthenticated, 403'd, and rendered a broken
   * image. Titles and prices looked fine because those come from the authenticated JSON
   * call, which made it read like a SanMar CDN problem rather than an auth one.
   *
   * What actually protects this endpoint is the HOST ALLOWLIST, not the session: it can only
   * ever fetch *.sanmar.com, so it cannot be pointed at 169.254.169.254, at this API, or at
   * the Docker network. The images it returns are already public on SanMar's CDN, so nothing
   * is exposed that wasn't. The response is additionally restricted to image content types,
   * so it can't be used to relay SanMar HTML pages, and given a timeout so a hanging upstream
   * can't pin a connection open.
   */
  app.get('/api/sanmar/img-proxy', async (req, reply) => {
    const url = req.query && req.query.url;
    if (!url) { reply.code(400); return { error: 'url required' }; }
    let host; try { host = new URL(url).hostname; } catch { reply.code(400); return { error: 'bad url' }; }
    if (!/(^|\.)sanmar\.com$/i.test(host)) { reply.code(403); return { error: 'host not allowed' }; }
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) { reply.code(502); return { error: 'upstream ' + r.status }; }
      const type = r.headers.get('content-type') || '';
      if (!/^image\//i.test(type)) { reply.code(415); return { error: 'not an image' }; }
      const buf = Buffer.from(await r.arrayBuffer());
      reply.header('Content-Type', type);
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
  // One STYLE row of the upsert, as a parameter array.
  const STYLE_COLS = 17;
  const styleParams = (s) => [
    s.style, s.title || null, s.description || null, s.brand || null, s.category || null,
    s.priceMin != null ? Number(s.priceMin) : null,
    s.priceMax != null ? Number(s.priceMax) : null,
    s.msrp != null ? Number(s.msrp) : null,
    s.image || null, s.cardImage || null, s.swatch || null, s.thumbnail || null,
    s.colors || [], s.sizes || [], s.status || null, !!s.discontinued,
    JSON.stringify(s.variants || []),
  ];

  // ── Price / availability change log ────────────────────────────────────────
  // A nightly sync that silently overwrites is WORSE than no sync for accounting: the cost
  // moves, every margin quietly recalculates against the new number, and nobody is told. So
  // the import diffs against what was there and records what moved. This table is the answer
  // to "how would I know" — the sync keeps you current, this tells you what changed.
  q(`create table if not exists supplier_changes (
       id bigserial primary key,
       source text not null,
       style text not null,
       title text,
       field text not null,
       old_value text,
       new_value text,
       detected_at timestamptz default now()
     )`).catch(() => {});
  q(`create index if not exists supplier_changes_detected
       on supplier_changes (detected_at desc)`).catch(() => {});

  /**
   * Diff incoming styles against what's stored and log what moved. Runs BEFORE the upsert,
   * because afterwards the old values are gone.
   *
   * Only price and discontinued are tracked: those are the two that change an order or an
   * account. Title and description churn constantly on a supplier feed and would bury the
   * signal in noise.
   */
  async function logSanmarChanges(styles) {
    if (!styles.length) return 0;
    const ids = styles.map((s2) => String(s2.style));
    const prev = await q(
      'select style, price_min, price_max, discontinued from sanmar_styles where style = any($1::text[])',
      [ids]).catch(() => ({ rows: [] }));
    const before = new Map(prev.rows.map((r) => [String(r.style), r]));

    const rows = [];
    const money = (v) => (v == null ? null : Number(v).toFixed(2));
    for (const s2 of styles) {
      const b = before.get(String(s2.style));
      if (!b) continue;                       // brand new style — an addition, not a change
      const oldMin = money(b.price_min), newMin = money(s2.priceMin);
      if (oldMin !== newMin && (oldMin || newMin)) {
        rows.push([ 'sanmar', s2.style, s2.title || null, 'price_min', oldMin, newMin ]);
      }
      const oldMax = money(b.price_max), newMax = money(s2.priceMax);
      if (oldMax !== newMax && (oldMax || newMax)) {
        rows.push([ 'sanmar', s2.style, s2.title || null, 'price_max', oldMax, newMax ]);
      }
      const wasGone = !!b.discontinued, isGone = !!s2.discontinued;
      if (wasGone !== isGone) {
        rows.push([ 'sanmar', s2.style, s2.title || null, 'discontinued', String(wasGone), String(isGone) ]);
      }
    }
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const params = [];
      const tuples = chunk.map((r, j) => {
        params.push(...r);
        const b0 = j * 6;
        return `($${b0 + 1},$${b0 + 2},$${b0 + 3},$${b0 + 4},$${b0 + 5},$${b0 + 6})`;
      });
      await q(`insert into supplier_changes (source, style, title, field, old_value, new_value)
               values ${tuples.join(',')}`, params).catch(() => {});
    }
    return rows.length;
  }

  // Upsert STYLE rows in multi-row batches. ~4k rows means this is quick either way, but the
  // batching matters because `variants` is a sizeable jsonb per row — 200/statement keeps the
  // parameter count (200 x 14 = 2,800) and the payload per round-trip both comfortable.
  // A failed batch retries row-by-row so one bad style can't discard 199 good ones.
  async function upsertSanmarStyles(styles) {
    const SQL_HEAD = `insert into sanmar_styles
           (style, title, description, brand, category, price_min, price_max, msrp,
            image, card_image, swatch, thumbnail, colors, sizes, status, discontinued,
            variants, variant_count, synced_at)
         values `;
    const SQL_TAIL = `
         on conflict (style) do update set
           title=excluded.title, description=excluded.description, brand=excluded.brand,
           category=excluded.category, price_min=excluded.price_min, price_max=excluded.price_max,
           msrp=excluded.msrp, image=excluded.image, card_image=excluded.card_image, swatch=excluded.swatch,
           thumbnail=excluded.thumbnail, colors=excluded.colors, sizes=excluded.sizes,
           status=excluded.status, discontinued=excluded.discontinued,
           variants=excluded.variants, variant_count=excluded.variant_count, synced_at=now()`;
    const BATCH = 200;
    // Postgres rejects a statement that hits the same conflict target twice, so collapse any
    // repeated style before batching rather than losing the whole batch to one repeat.
    const byStyle = new Map();
    for (const s of styles) if (s && s.style) byStyle.set(String(s.style), s);
    const deduped = [...byStyle.values()];
    const tuple = (j) => {
      const base = j * STYLE_COLS;
      const ph = Array.from({ length: STYLE_COLS }, (_, k) => `$${base + k + 1}`).join(',');
      // variant_count is derived in SQL from the jsonb we just passed — it can never disagree.
      return `(${ph}, jsonb_array_length($${base + STYLE_COLS}::jsonb), now())`;
    };
    let n = 0;
    for (let i = 0; i < deduped.length; i += BATCH) {
      const chunk = deduped.slice(i, i + BATCH);
      const params = [];
      const tuples = chunk.map((s, j) => { params.push(...styleParams(s)); return tuple(j); });
      try {
        await q(SQL_HEAD + tuples.join(',') + SQL_TAIL, params);
        n += chunk.length;
      } catch {
        for (const s of chunk) {
          const ok = await q(SQL_HEAD + tuple(0) + SQL_TAIL, styleParams(s))
            .then(() => true).catch(() => false);
          if (ok) n++;
        }
      }
    }
    return { imported: n, duplicateStyles: styles.length - deduped.length };
  }

  // Import a SMALL SDL/EPDD file sent as text ({ csv }) or pre-parsed rows ({ products: [...] }),
  // mirroring /api/otto/import. Variant rows are folded to styles before writing.
  // NOTE: the real SanMar_SDL_N.csv is ~195MB — over the 60MB body limit here and far over
  // Vercel's ~4.5MB proxy cap, so the browser can never carry it. Use
  // POST /api/sanmar/import/local for the real file. Staff-gated, like Otto: it's supplier
  // REFERENCE data, spends nothing, and adds nothing sellable on its own.
  app.post('/api/sanmar/import', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const rows = Array.isArray(b.products) ? b.products
      : (typeof b.csv === 'string' ? parseSanmarCsv(b.csv) : []);
    if (!rows.length) {
      reply.code(400);
      return { error: 'No products found. Send { csv } (the SDL/EPDD file text, with its header row) or { products: [...] }.' };
    }
    const styles = stylesFromVariants(rows);
    const { imported } = await upsertSanmarStyles(styles);
    const c = await q('select count(*)::int as n from sanmar_styles').catch(() => ({ rows: [{ n: 0 }] }));
    return { ok: true, variants: rows.length, styles: styles.length, imported, total: c.rows[0]?.n || 0 };
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
    const { access, readdir } = await import('node:fs/promises');
    const { join, basename } = await import('node:path');
    const wanted = basename(String((req.body && req.body.file) || 'SanMar_SDL_N.csv'));
    const path = join(dir, wanted);
    try {
      await access(path);
    } catch (e) {
      let available = [];
      try { available = (await readdir(dir)).filter((f) => /\.(csv|txt)$/i.test(f)); } catch { /* dir unreadable */ }
      reply.code(400);
      return { error: `Could not read ${wanted} from the catalog directory.`, detail: (e && e.message) || null, available };
    }
    const t0 = Date.now();
    let parsed;
    try {
      parsed = await streamSanmarStyles(path);       // streams; never holds the file in memory
    } catch (e) {
      reply.code(400);
      return { error: `Could not parse ${wanted}.`, detail: (e && e.message) || null };
    }
    // Diff BEFORE writing — afterwards the previous prices no longer exist.
    const changes = await logSanmarChanges(parsed.styles);
    const { imported, duplicateStyles } = await upsertSanmarStyles(parsed.styles);
    const c = await q('select count(*)::int as n from sanmar_styles').catch(() => ({ rows: [{ n: 0 }] }));
    return {
      ok: true, file: wanted, variantRows: parsed.variants, unusableRows: parsed.skipped,
      styles: parsed.styles.length, duplicateStyles, imported, changes,
      total: c.rows[0]?.n || 0, seconds: Math.round((Date.now() - t0) / 100) / 10,
    };
  });

  // Catalog status — count + last import time (drives the "import the catalog" empty state).
  app.get('/api/sanmar/catalog/status', { preHandler: requireStaff }, async () => {
    try {
      const r = await q(`select count(*)::int as n, max(synced_at) as last,
                                coalesce(sum(variant_count),0)::int as variants
                           from sanmar_styles`);
      return { count: r.rows[0]?.n || 0, last: r.rows[0]?.last || null, variants: r.rows[0]?.variants || 0 };
    }
    catch { return { count: 0, last: null, variants: 0 }; }
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
    // 833 of the 4,081 styles are discontinued outright — a fifth of the catalog you cannot
    // order. Hidden by default so the blank picker only offers buyable product; ?discontinued=1
    // brings them back for looking up an old order.
    const showGone = /^(1|true|yes)$/i.test(String(req.query?.discontinued || ''));
    const clauses = [];
    if (search) clauses.push(`lower(coalesce(style,'') || ' ' || coalesce(title,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(category,'') || ' ' || array_to_string(coalesce(colors,'{}'), ' ')) like $1`);
    if (!showGone) clauses.push(`coalesce(discontinued,false) = false`);
    const filter = clauses.length ? 'where ' + clauses.join(' and ') : '';
    try {
      const total = await q(`select count(*)::int as n from sanmar_styles ${filter}`, params);
      const r = await q(
        `select style, brand, title as name, description, category,
                price_min as price, price_max, image, card_image, colors, sizes,
                status, discontinued, variant_count, 0 as qty
           from sanmar_styles ${filter}
          order by style
          limit ${limit} offset ${offset}`, params);
      let favs = new Set();
      try { const fr = await q('select style from sanmar_favorites'); favs = new Set(fr.rows.map((x) => String(x.style))); } catch { /* no favorites table yet */ }
      // BROWSE SERVES THE SMALL PHOTO. The grid draws a ~180px tile; card_image is the
      // same shot at 300x450 / ~7KB against image's 1200x1800 / ~230KB. `image` still rides
      // along for the detail and quick-order views, which want the big one.
      const items = r.rows.map((row) => ({
        ...row,
        image: sanmarImg(row.card_image || row.image),
        fullImage: sanmarImg(row.image),
        favorited: favs.has(String(row.style)),
      }));
      return { total: total.rows[0]?.n || 0, items };
    } catch (e) { reply.code(500); return { error: String((e && e.message) || e), total: 0, items: [] }; }
  });

  // One style's full detail from the imported catalog — every colour, size and variant key.
  // Mirrors /api/otto/style/:style so the "Add to catalog" + quick-order paths treat SanMar
  // exactly like Otto. Variants come out of the folded jsonb, so inventoryKey — SanMar's
  // ordering handle — is still present per colour+size without storing 161k rows.
  //
  // Live stock is NOT here and never was: the SDL has no quantity column at all. Inventory
  // comes from GET /api/sanmar/inventory (SOAP), which is what SanMar's guide asks you to use
  // web services for.
  app.get('/api/sanmar/catalog/:style', { preHandler: requireStaff }, async (req, reply) => {
    const style = String(req.params?.style || '').trim();
    if (!style) { reply.code(400); return { error: 'style required' }; }
    try {
      const r = await q(
        `select style, title, description, brand, category, price_min, price_max,
                image, swatch, thumbnail, colors, sizes, variants, variant_count
           from sanmar_styles where style=$1`, [style]);
      if (!r.rows.length) { reply.code(404); return { error: 'Not in the imported catalog.' }; }
      const s = r.rows[0];
      const raw = Array.isArray(s.variants) ? s.variants : [];
      const styleImage = sanmarImg(s.image || s.thumbnail || s.swatch);
      const variants = raw.map((v) => ({
        color: v.c || null, size: v.s || null,
        // SanMar's canonical variant handle is the inventory key; fall back to unique_key.
        sku: v.k || v.u, inventoryKey: v.k || null, sizeIndex: v.i || null,
        price: v.p != null ? Number(v.p) : null,
        // Per-colour photos are not kept: those columns are bare names under a dated imglib
        // path the file gives no way to rebuild (they 302). The style image stands in.
        image: styleImage,
      }));
      /**
       * THE KEYS, WITHOUT INVENTING THE PICTURES.
       *
       * This filled every colour with the STYLE image, so a 17-colour cap drew seventeen
       * identical photographs of the black one and each was captioned as a different
       * colourway. That is not a missing picture, it is a wrong one: the swatch says "this
       * is what Ash looks like" while showing Black, and somebody picks from it.
       *
       * We genuinely do not have per-colour photos for SanMar — those columns are bare names
       * under a dated imglib path the flat file gives no way to rebuild, and they 302 to a
       * placeholder. So the honest shape is the colour NAME with no image, which every
       * consumer already handles: an empty value falls through to the swatchHex dot in the
       * detail dialog and on the product card. The keys stay, because the colour LIST is
       * real and is what colorsOf() is derived from — dropping them would lose the colours
       * as well as the photos.
       */
      const colorImages = {};
      for (const v of variants) if (v.color && !(v.color in colorImages)) colorImages[v.color] = '';
      return {
        style: s.style, name: s.title || s.style, brand: s.brand || 'SanMar', category: s.category || null,
        description: s.description || null,
        price: s.price_min != null ? Number(s.price_min) : null,
        priceMax: s.price_max != null ? Number(s.price_max) : null,
        image: styleImage,
        colors: s.colors || [], sizes: s.sizes || [],
        colorImages, variants, skus: variants.map((v) => v.sku),
      };
    } catch (e) { reply.code(500); return { error: String((e && e.message) || e) }; }
  });
}
