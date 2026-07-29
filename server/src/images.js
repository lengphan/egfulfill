// Resolve a "publishable image source" to raw bytes, ready to POST to a marketplace.
//
// Two shapes reach the publish routes: a `data:` URL (a photo the seller uploaded
// locally) and a remote image URL (a SpyDeck listing's Etsy-CDN photo). Both Etsy's and
// TikTok's product-image uploads want the actual bytes, so this is the one place that
// turns either shape into { buf, mime, ext }.
//
// Remote fetches are ALLOWLISTED to Etsy's own CDN so a source string can never be used
// to make the server fetch an arbitrary internal host (SSRF). Anything else returns null
// and the caller skips it.

const REMOTE_IMAGE_HOST_OK = (host) => /(^|\.)etsystatic\.com$/i.test(host);

export async function imageBytesFrom(src) {
  const s = String(src || '');
  const m = /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(s);
  if (m) {
    const mime = m[1];
    return { buf: Buffer.from(m[2], 'base64'), mime, ext: (mime.split('/')[1] || 'png').replace('jpeg', 'jpg') };
  }
  if (/^https?:\/\//i.test(s)) {
    let host;
    try { host = new URL(s).hostname; } catch { return null; }
    if (!REMOTE_IMAGE_HOST_OK(host)) return null;   // never fetch an arbitrary host
    const r = await fetch(s);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const mime = r.headers.get('content-type') || 'image/jpeg';
    const ext = ((mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '')) || 'jpg';
    return { buf, mime, ext };
  }
  return null;
}
