// Resolve a "publishable image source" to raw bytes, ready to POST to a marketplace.
//
// Three shapes reach the publish routes: a `data:` URL (a photo the seller uploaded
// locally), a remote image URL (a SpyDeck listing's Etsy-CDN photo), and one of OUR OWN
// stored chat assets (an AI render from the listing photo studio). Both Etsy's and
// TikTok's product-image uploads want the actual bytes, so this is the one place that
// turns any of those shapes into { buf, mime, ext }.
//
// Remote fetches are ALLOWLISTED to Etsy's own CDN so a source string can never be used
// to make the server fetch an arbitrary internal host (SSRF). Anything else returns null
// and the caller skips it.
import { getObject, storageEnabled } from './storage.js';

const REMOTE_IMAGE_HOST_OK = (host) => /(^|\.)etsystatic\.com$/i.test(host);

/**
 * OUR OWN ASSET, READ FROM STORAGE — never fetched over HTTP.
 *
 * A generated listing photo is stored private under `chat/<name>` and handed to the client
 * as `/api/support/asset/<name>`, so that string is what ends up in the publish payload.
 * Resolving it by fetching our own origin would mean allowlisting our host, and an
 * allowlisted host plus a path parameter is an SSRF hole with extra steps. So the path is
 * matched and the object read straight out of storage — no request leaves the box.
 *
 * The bare-filename check is the SAME one the asset route uses. It is what hard-scopes this
 * to the chat/ prefix: no slashes, no `..`, no reaching any other object in the bucket.
 */
const ASSET_PATH = /(?:^|\/)api\/support\/asset\/([A-Za-z0-9._-]+)$/;

const extFor = (mime) => ((String(mime).split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '')) || 'jpg';

export async function imageBytesFrom(src) {
  const s = String(src || '');
  const m = /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(s);
  if (m) {
    const mime = m[1];
    return { buf: Buffer.from(m[2], 'base64'), mime, ext: (mime.split('/')[1] || 'png').replace('jpeg', 'jpg') };
  }

  // Checked BEFORE the http branch, and against the path alone, so it matches whether the
  // client stored an absolute URL or a bare path — and so our own origin never has to be
  // added to the fetch allowlist above.
  const asset = ASSET_PATH.exec(s.split('?')[0]);
  if (asset && storageEnabled()) {
    try {
      const obj = await getObject(`chat/${asset[1]}`);
      if (!obj || !obj.body || !obj.body.length) return null;
      const mime = obj.contentType || 'image/jpeg';
      return { buf: obj.body, mime, ext: extFor(mime) };
    } catch { return null; }
  }

  if (/^https?:\/\//i.test(s)) {
    let host;
    try { host = new URL(s).hostname; } catch { return null; }
    if (!REMOTE_IMAGE_HOST_OK(host)) return null;   // never fetch an arbitrary host
    const r = await fetch(s);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const mime = r.headers.get('content-type') || 'image/jpeg';
    return { buf, mime, ext: extFor(mime) };
  }
  return null;
}
