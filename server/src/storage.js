// Object storage (S3 / DigitalOcean Spaces) — dependency-free SigV4-signed PUT/DELETE via built-in
// crypto + fetch. Large design/print blobs belong here (URLs in Postgres), not inline base64.
//
// Enable by setting in server/.env (S3-compatible; DO Spaces shown):
//   SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com   (or your S3 endpoint, no bucket)
//   SPACES_REGION=nyc3
//   SPACES_BUCKET=egfulfill-files
//   SPACES_KEY=...          SPACES_SECRET=...
//   SPACES_CDN=https://cdn.egful.store   (optional — public base for returned URLs; defaults to endpoint/bucket)
// When unset, storageEnabled() is false and callers keep the inline-base64 fallback (nothing breaks).
import crypto from 'crypto';

const EP     = (process.env.SPACES_ENDPOINT || '').replace(/\/+$/, '');
const REGION = process.env.SPACES_REGION || 'us-east-1';
const BUCKET = process.env.SPACES_BUCKET || '';
const KEY    = process.env.SPACES_KEY || '';
const SECRET = process.env.SPACES_SECRET || '';
const CDN    = (process.env.SPACES_CDN || '').replace(/\/+$/, '');
const SERVICE = 's3';

export function storageEnabled() { return !!(EP && BUCKET && KEY && SECRET); }

const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s, 'utf8').digest();
// Encode a path segment per S3 (keep "/", encode the rest incl. RFC3986 extras).
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// Build the SigV4 Authorization header for a request. Returns { authorization, amzDate, host }.
function signV4({ method, host, canonicalUri, query = '', payloadHash, headers, amzDate, dateStamp }) {
  const signedHeaderKeys = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderKeys.map((h) => h + ':' + String(headers[Object.keys(headers).find((k) => k.toLowerCase() === h)]).trim() + '\n').join('');
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalRequest = [method, canonicalUri, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + SECRET, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/**
 * How long a shared artwork link stays valid, in DAYS. Change with DESIGN_URL_TTL_DAYS
 * in server/.env (then `docker compose up -d`). 0 = never expires (objects must then be
 * public-read; see putObject's acl argument).
 *
 * Why this is a knob and not a constant: an outside design partner works asynchronously
 * — task → review → "need fix" → rework — and their designers re-open the SOURCE artwork
 * throughout. Too short and you break a revision mid-flight; too long and a leaked link
 * outlives its usefulness. 7 days covers a normal revision cycle.
 */
const URL_TTL_DAYS = (() => {
  const n = Number(process.env.DESIGN_URL_TTL_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : 7;
})();
export function designUrlTtlDays() { return URL_TTL_DAYS; }

/**
 * A time-limited GET link for a PRIVATE object — SigV4 in the QUERY STRING rather than a
 * header, because whoever follows the link (a partner's fetcher, a browser) can't set
 * headers. This is what makes expiry possible at all: a public-read object is reachable
 * forever by anyone holding the URL.
 *
 * S3 caps a presigned URL at 7 days; a longer TTL is clamped to that rather than silently
 * producing links the provider rejects.
 */
// The permanent public address for an object — only meaningful when it was written
// public-read (TTL 0). Prefers the CDN alias when one is configured.
export function publicUrl(key) {
  if (!storageEnabled()) return null;
  const { host, uri } = _hostAndUri(key);
  return CDN ? `${CDN}/${key}` : `https://${host}${uri}`;
}

export function presignGet(key, ttlSeconds) {
  if (!storageEnabled()) return null;
  const MAX = 7 * 24 * 3600;                       // S3/SigV4 hard limit
  const ttl = Math.min(Math.max(1, Math.floor(ttlSeconds || URL_TTL_DAYS * 24 * 3600)), MAX);
  const { host, uri } = _hostAndUri(key);
  const { amzDate, dateStamp } = _stamps();
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const qp = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${KEY}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(ttl),
    'X-Amz-SignedHeaders': 'host',
  });
  // S3 requires the canonical query sorted by key; URLSearchParams preserves insertion
  // order, so sort explicitly rather than relying on the order above.
  const canonicalQuery = [...qp.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
  const canonicalRequest = ['GET', uri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + SECRET, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, REGION), SERVICE), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  // NB signed against the ORIGIN host — a CDN alias isn't what was signed, so don't swap
  // in SPACES_CDN here the way putObject does for public URLs.
  return `https://${host}${uri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function _stamps() {
  const d = new Date();
  const amzDate = d.toISOString().replace(/[:-]|\.\d{3}/g, '');   // YYYYMMDDTHHMMSSZ
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}
function _hostAndUri(key) {
  // Virtual-host style: <bucket>.<endpoint-host>/<key>
  const epHost = EP.replace(/^https?:\/\//, '');
  return { host: `${BUCKET}.${epHost}`, uri: '/' + key.split('/').map(enc).join('/') };
}

// Upload bytes and return the public URL. contentType e.g. 'application/pdf'. acl 'public-read' by default.
export async function putObject(key, buffer, contentType = 'application/octet-stream', acl = 'public-read') {
  if (!storageEnabled()) throw new Error('object storage not configured');
  const { host, uri } = _hostAndUri(key);
  const { amzDate, dateStamp } = _stamps();
  const payloadHash = sha256hex(buffer);
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, 'x-amz-acl': acl, 'content-type': contentType };
  const authorization = signV4({ method: 'PUT', host, canonicalUri: uri, payloadHash, headers, amzDate, dateStamp });
  const res = await fetch(`https://${host}${uri}`, { method: 'PUT', headers: { ...headers, Authorization: authorization }, body: buffer });
  if (!res.ok) throw new Error('storage PUT failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return (CDN ? `${CDN}/${key}` : `https://${host}${uri}`);
}

export async function deleteObject(key) {
  if (!storageEnabled()) return;
  const { host, uri } = _hostAndUri(key);
  const { amzDate, dateStamp } = _stamps();
  const payloadHash = sha256hex('');
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const authorization = signV4({ method: 'DELETE', host, canonicalUri: uri, payloadHash, headers, amzDate, dateStamp });
  try { await fetch(`https://${host}${uri}`, { method: 'DELETE', headers: { ...headers, Authorization: authorization } }); } catch (e) {}
}

// Decode a data URL (data:<mime>;base64,<b64>) → { buffer, mime }. Passthrough for raw base64.
export function fromDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (m) return { mime: m[1] || 'application/octet-stream', buffer: Buffer.from(m[3], m[2] ? 'base64' : 'utf8') };
  return { mime: 'application/octet-stream', buffer: Buffer.from(String(dataUrl || ''), 'base64') };
}

// Expose the signer for a self-test against AWS's published SigV4 vectors.
export const _test = { signV4, sha256hex };
