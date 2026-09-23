/**
 * SHRINKING A PICTURE ON THE WAY OUT — the one place that knows how.
 *
 * WHY THIS EXISTS. The public catalogue was measured on 2026-09-23: 4.45 MB of images for a
 * single page of 23 products, seven of them over 200 KB, and the worst a 684×684 PNG weighing
 * 1,060 KB drawn in a card about 300 CSS px wide. Nothing was wrong with the caching — the
 * routes already send `public, max-age=604800, immutable` and already keep a copy in R2 — the
 * bytes themselves were simply the original file, at original size, in the original format.
 *
 * So the fix is not another cache. It is to stop sending a megabyte where fifty kilobytes says
 * the same thing. Measured on the two worst rows, re-encoded at 600px:
 *
 *     hoodie                1060 KB -> 57 KB   (18x)
 *     unisex-cotton-shirt    748 KB -> 12 KB   (59x)
 *
 * WEBP, NOT JPEG, AND THAT IS NOT A PREFERENCE. Those product photos are RGBA cut-outs — the
 * garment on transparency. JPEG has no alpha, so converting would composite every cut-out onto
 * a flat black or white rectangle and the catalogue would fill with boxed garments. WebP keeps
 * the alpha channel, which is the only reason this conversion is safe to do blind.
 *
 * IT DEGRADES TO THE ORIGINAL, ALWAYS. sharp is a native module; a prebuilt binary that does
 * not match the host, a corrupt upload, an SVG, a format libvips will not decode — every one
 * of those returns the bytes that came in, untouched. The dependency is therefore not
 * load-bearing: the worst case of this whole module failing is the behaviour we already had.
 * That matters more than the saving, because an image route that throws is a page of broken
 * tiles and §2.1's lesson is that the expensive failures are the ones that take out more than
 * the thing that broke.
 *
 * AND IT ONLY REPLACES BYTES IT ACTUALLY IMPROVED. A small, already-optimised WebP re-encoded
 * can come out LARGER; when that happens the original is sent. "Optimised" is a measurement,
 * not a step in a pipeline.
 */

/** Sizes a caller may ask for. An allow-list rather than a free number: every distinct width
 *  is another object in the bucket and another entry in every cache in front of us, and a
 *  query string nobody controls would let a stranger mint unlimited ones. */
export const WIDTHS = [320, 640, 900, 1400];

/**
 * The default cap. A catalogue card draws about 300 CSS px, so 600 device pixels on a retina
 * screen; a product page draws bigger. 900 covers both without carrying a second variant, and
 * it is a CAP rather than a size — a picture already narrower than this is never upscaled,
 * because inventing pixels adds bytes and no detail.
 */
export const DEFAULT_WIDTH = 900;

/** Which width a request asked for, or the default. Anything not on the list is the default —
 *  never an error, because a bad `w` must not turn into a missing picture. */
export function widthFrom(query) {
  const n = Number((query && query.w) || 0);
  return WIDTHS.includes(n) ? n : DEFAULT_WIDTH;
}

/** Does this client take WebP? Every browser we target has for years, but a bare `fetch`, a
 *  partner's script and curl do not say so, and those get the original. */
export function wantsWebp(headers) {
  return /image\/webp/i.test(String((headers && headers.accept) || ''));
}

/** Formats worth touching. SVG is text and already small; GIF may be animated and sharp would
 *  flatten it to one frame, which is a silent content change rather than a compression. */
const RE_ENCODABLE = /^image\/(png|jpe?g|webp|tiff|avif)$/i;

let sharpMod;      // resolved once
let sharpBroken;   // ...or proven unavailable once, so a missing binary is not retried per request

async function loadSharp() {
  if (sharpMod) return sharpMod;
  if (sharpBroken) return null;
  try {
    sharpMod = (await import('sharp')).default;
    return sharpMod;
  } catch (e) {
    sharpBroken = true;
    console.error('[image] sharp unavailable, serving originals:', e && e.message);
    return null;
  }
}

/**
 * Re-encode for delivery. Returns `{ buf, type, optimised }` and NEVER throws.
 *
 * `type` is what to put in Content-Type — the caller must use it rather than the type it had,
 * or it will label a WebP as a PNG and the browser will refuse the picture it was just sent.
 */
export async function forDelivery(buf, contentType, { width = DEFAULT_WIDTH, webp = true } = {}) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const keep = { buf, type: contentType, optimised: false };
  if (!Buffer.isBuffer(buf) || !buf.length) return keep;
  if (!webp) return keep;
  if (!RE_ENCODABLE.test(type)) return keep;

  const sharp = await loadSharp();
  if (!sharp) return keep;

  try {
    const img = sharp(buf, { failOn: 'none' });
    const meta = await img.metadata();
    /* `withoutEnlargement` is the rule stated twice on purpose: a 320px thumbnail asked to be
       900 wide stays 320. */
    const out = await img
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 4, alphaQuality: 90 })
      .toBuffer();
    /* Only if it actually helped — see the note at the top. */
    if (out.length >= buf.length) return keep;
    return { buf: out, type: 'image/webp', optimised: true, from: meta.format, was: buf.length };
  } catch (e) {
    console.error('[image] re-encode failed, serving original:', e && e.message);
    return keep;
  }
}

/**
 * THE WHOLE RULE, IN ONE CALL — what every image route should end with.
 *
 * Shipping this as a function rather than as four lines of guidance is the point: §4 records
 * that a rule with no primitive regresses at the speed new files are created, and "set the
 * type sharp actually produced, and Vary on Accept" is exactly the kind of two-line rule that
 * gets half-copied. There are five image routes; there is one of these.
 *
 * VARY: ACCEPT IS NOT OPTIONAL. The body now depends on a request header, so a shared cache —
 * Cloudflare, Vercel, a corporate proxy — that stored the WebP would hand it to the next
 * client along whether or not it can read one. That is a broken picture for somebody else,
 * caused by us, and invisible from here.
 */
export async function sendImage(req, reply, buf, contentType, { maxAge = 604800 } = {}) {
  const r = await forDelivery(buf, contentType, {
    width: widthFrom(req && req.query),
    webp: wantsWebp(req && req.headers),
  });
  if (r.type) reply.header('Content-Type', r.type);
  /* The caller's own freshness, not a number this helper invented. `/api/order_items/:id/img`
     is addressed by a row id whose bytes never change, so it has always sent a year; taking
     that to a week because a shared helper had one opinion would be a regression smuggled in
     under a compression change. */
  reply.header('Cache-Control', `public, max-age=${maxAge}, immutable`);
  reply.header('Vary', 'Accept');
  return reply.send(r.buf);
}
