// Which bench does this print method belong on?
// -----------------------------------------------------------------------------
// Our own designers are EMBROIDERY specialists. Digitising for stitch is a different
// craft from preparing a raster file for ink, and the people here do the former. So
// flat-print work (DTG/DTF and friends) goes to the design partner, and everything
// stitch-shaped stays in house.
//
// This lived nowhere before: cards were created with no vendor at all, which put a DTF
// job in the embroidery queue looking exactly like stitch work — claimable by a designer
// who then had to notice, by reading the method on the card, that it wasn't theirs.
//
// Mirrored in web/lib/print-route.ts. The method codes match methodAddOn() in pricing.js
// and normTech() in web/lib/print-method.ts — three places that must agree on what "DTF"
// means, since one disagreeing would price, route, or display the wrong thing.

/** Normalise a free-text print method to a stable code. Same rules as pricing.js. */
export function methodCode(printType) {
  const tech = String(printType || '').toUpperCase();
  if (!tech) return '';
  if (/EMB/.test(tech)) return 'EMB';
  if (/DTF/.test(tech)) return 'DTF';
  if (/APL|APPLIQ/.test(tech)) return 'APL';
  if (/LSR|LASER|ENGRAV/.test(tech)) return 'LSR';
  if (/SCR|SCREEN/.test(tech)) return 'SCR';
  if (/SUBLIM|\bDYE\b/.test(tech)) return 'SUB';
  if (/VINYL|\bHTV\b|\bVNL\b/.test(tech)) return 'VNL';
  if (/DTG|DIRECT/.test(tech)) return 'DTG';
  return tech;
}

/**
 * The words a PERSON reads for each code.
 *
 * The import sheet used to offer the codes themselves — DTG, EMB, APL — because that is
 * what the importer normalises against. But a seller filling in a spreadsheet has no reason
 * to know our shorthand, and "APL" in a dropdown is a guess rather than a choice. So the
 * sheet offers these and methodCode() above reads them back: it matches on /APPLIQ/,
 * /EMB/, /DIRECT/ and friends, so "Appliqué" and "APL" both resolve to APL and a sheet
 * downloaded before today keeps importing unchanged.
 *
 * Mirrors METHOD_TABLE's labels in web/lib/print-method.ts. That is the third hand-kept
 * copy the note at the top of this file already warns about — change them together.
 */
export const METHOD_LABELS = {
  DTF: 'DTF printing',
  DTG: 'DTG printing',
  EMB: 'Embroidery',
  APL: 'Appliqué',
  LSR: 'Laser',
  SCR: 'Screen print',
  SUB: 'Sublimation',
  VNL: 'Vinyl',
};

/** Code -> label, falling back to whatever came in so an unknown code still prints. */
export function methodLabel(code) {
  const k = String(code || '').toUpperCase();
  return METHOD_LABELS[k] || String(code || '');
}

/**
 * Methods that go OUT to the design partner.
 *
 * Deliberately a list of what leaves rather than what stays. A new method added to the
 * product editor should default to our own board — an unfamiliar job landing in front of
 * our designers is a question someone asks, whereas one silently posted to a paid partner
 * is an invoice nobody chose.
 */
const OUTSOURCED = new Set(['DTG', 'DTF']);

/**
 * Where a line's design work should go: 'partner' or 'internal'.
 * An item with NO print method needs no design work at all — it's a plain blank — and
 * callers should not be carding it in the first place; 'internal' is the safe answer.
 */
export function printRoute(printType) {
  return OUTSOURCED.has(methodCode(printType)) ? 'partner' : 'internal';
}
