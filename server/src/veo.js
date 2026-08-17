// veo.js — the ONE call path for Google video generation (Veo 3.1).
//
// Same shape as gemini.js on purpose: catalogue with prices, config read at CALL time,
// permanent-vs-transient error handling, and every generation metered. Two things differ,
// and both are structural rather than cosmetic:
//
//  1. Video is LONG-RUNNING. :predictLongRunning returns an operation name and the clip
//     lands a minute or three later. So nothing here holds an HTTP request open — the
//     caller starts a job and the finished video is posted into the thread afterwards,
//     exactly how an AI reply already arrives.
//  2. It is MUCH more expensive. One image is ~13c; one 8-second clip is 40c to $4.80.
//     A careless loop here is a real bill, so the poll is bounded in both attempts and
//     wall-clock, and a job that outlives its ceiling is abandoned with a reason rather
//     than retried.
import { q } from './db.js';
import { recordUsage } from './usage.js';
import { imageConfig } from './gemini.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'veo-3.1-fast-generate-preview';

/**
 * Veo 3.1 variants. Price is PER SECOND and varies by resolution, so cost is only knowable
 * once duration and resolution are both chosen — `usdFor()` below is the only place that
 * multiplication should happen.
 *
 * Audio is included on every variant; there is no cheaper silent tier to select.
 */
export const VIDEO_MODELS = [
  {
    id: 'veo-3.1-fast-generate-preview',
    label: 'Veo 3.1 Fast — best value',
    note: '1080p with audio at a tenth of Standard. The sensible default for TikTok and Reels product clips.',
    resolutions: ['720p', '1080p', '4K'],
    defaultResolution: '1080p',
    usdPerSec: { '720p': 0.10, '1080p': 0.12, '4K': 0.30 },
  },
  {
    id: 'veo-3.1-lite-generate-preview',
    label: 'Veo 3.1 Lite — cheapest',
    note: 'For trying a motion idea before paying for it. 720p is below what a paid ad placement wants.',
    resolutions: ['720p', '1080p'],
    defaultResolution: '720p',
    usdPerSec: { '720p': 0.05, '1080p': 0.08 },
  },
  {
    id: 'veo-3.1-generate-preview',
    label: 'Veo 3.1 Standard — best quality',
    note: 'Roughly 24 images per 8-second clip. Worth it for a hero or brand asset, not for everyday listings.',
    resolutions: ['720p', '1080p', '4K'],
    defaultResolution: '1080p',
    usdPerSec: { '720p': 0.40, '1080p': 0.40, '4K': 0.60 },
  },
];

// Veo's own supported framings. Narrower than the image model's ten — 9:16 is the one
// that matters here, since that is TikTok and Reels.
export const VIDEO_RATIOS = ['16:9', '9:16'];
export const VIDEO_RATIO_HINTS = {
  '9:16': 'TikTok / Reels / Shorts',
  '16:9': 'YouTube / website hero',
};
export const VIDEO_DURATIONS = [4, 6, 8];

const modelById = (id) => VIDEO_MODELS.find((m) => m.id === id) || null;

/** Total USD for a whole clip. The only place seconds x rate is computed. */
export function usdFor(modelId, resolution, seconds) {
  const m = modelById(modelId);
  if (!m) return 0;
  return (m.usdPerSec[resolution] || 0) * (Number(seconds) || 0);
}

/**
 * Video reuses the IMAGE credential — one Google key, one billing project, so asking an
 * admin to paste the same string twice would just be a second thing to keep in sync. Only
 * the model selection is separate.
 */
export async function videoConfig() {
  const { key, fromEnv } = await imageConfig();
  let model = '';
  try {
    const r = await q(`select value from settings where key='video_ai_model'`);
    const v = r.rows[0] && r.rows[0].value;
    model = String(typeof v === 'string' ? v : (v ?? '')).trim();
  } catch { /* fresh DB — fall through to env */ }
  model = model || (process.env.VEO_MODEL || '').trim() || DEFAULT_MODEL;
  let staleModel = null;
  if (!modelById(model)) { staleModel = model; model = DEFAULT_MODEL; }
  return { key, model, fromEnv, staleModel };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Google's quota-of-zero 429 is a billing state, not a rate limit. Same rule as gemini.js. */
const isPermanent = (body) => /limit:\s*0|free_tier|billing/i.test(body || '');

function apiError(status, detail) {
  if (isPermanent(detail)) {
    const e = new Error('Video AI: this Google key has no billing enabled, and Veo has no free tier (the quota is 0). Link a billing account to the key\'s Google Cloud project, then try again.');
    e.status = 402; e.detail = detail; return e;
  }
  let reason = '';
  try { const j = JSON.parse(detail); reason = (j && j.error && (j.error.message || j.error.status)) || ''; } catch { /* non-JSON */ }
  const e = new Error(reason ? `Video AI: ${reason}` : `Video service error (HTTP ${status})`);
  e.status = 502; e.detail = detail; return e;
}

/**
 * START a generation. Returns { operation, model, resolution, seconds, usd } — it does NOT
 * wait for the clip. `image` (a Buffer + mime) turns this into image-to-video, where the
 * still becomes the first frame and the product stays consistent with what was rendered.
 */
export async function startVideo({ prompt, aspectRatio = '9:16', resolution, durationSeconds = 8, model: override, image } = {}) {
  const cfg = await videoConfig();
  const model = modelById(override) ? override : cfg.model;
  const spec = modelById(model);

  if (!cfg.key) {
    const e = new Error('Video generation is off — an admin can add the Google AI key in Settings › Integrations.');
    e.disabled = true; e.status = 503; throw e;
  }
  const text = String(prompt || '').trim();
  if (!text) { const e = new Error('A prompt is required.'); e.status = 400; throw e; }

  const ratio = VIDEO_RATIOS.includes(aspectRatio) ? aspectRatio : '9:16';
  // A resolution this variant doesn't offer is a 400 from Google with an unhelpful message
  // (Lite has no 4K), so fall back to the variant's own default instead.
  const res = spec.resolutions.includes(resolution) ? resolution : spec.defaultResolution;
  const secs = VIDEO_DURATIONS.includes(Number(durationSeconds)) ? Number(durationSeconds) : 8;

  const instance = { prompt: text };
  if (image && image.buffer && image.buffer.length) {
    instance.image = { inlineData: { mimeType: image.mime || 'image/jpeg', data: image.buffer.toString('base64') } };
  }
  const body = JSON.stringify({
    instances: [instance],
    // A NUMBER. The docs example quotes it ("8"), which is what I copied — and Google
    // rejects that outright: "The value type for `durationSeconds` needs to be a number."
    parameters: { aspectRatio: ratio, resolution: res, durationSeconds: secs },
  });

  const r = await fetch(`${BASE}/models/${model}:predictLongRunning`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
    body,
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    recordUsage('veo', { endpoint: `start ${model}`, costCents: 0, ok: false });
    throw apiError(r.status, detail);
  }
  const data = await r.json();
  const operation = data && data.name;
  if (!operation) {
    recordUsage('veo', { endpoint: `start ${model}`, costCents: 0, ok: false });
    const e = new Error('Video AI: no operation name came back, so there is nothing to wait on.');
    e.status = 502; throw e;
  }
  return { operation, model, resolution: res, aspectRatio: ratio, seconds: secs, usd: usdFor(model, res, secs) };
}

/**
 * Poll ONCE. Returns { done, video?, error? }.
 *
 * Deliberately a single check rather than a loop: the caller owns the schedule, so the
 * ceiling lives in one place and there is no function here capable of waiting forever.
 */
export async function checkVideo(operation) {
  const cfg = await videoConfig();
  if (!cfg.key) return { done: false };
  const r = await fetch(`${BASE}/${operation}`, { headers: { 'x-goog-api-key': cfg.key } });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    // A poll that 404s means the operation expired — terminal, not worth re-checking.
    if (r.status === 404) return { done: true, error: 'The video job expired before it finished.' };
    throw apiError(r.status, detail);
  }
  const data = await r.json();
  if (!data.done) return { done: false };
  if (data.error) return { done: true, error: String(data.error.message || 'Generation failed.') };
  const uri = findVideoUri(data);
  if (!uri) return { done: true, error: 'The job finished but carried no video.' };
  return { done: true, uri };
}

/**
 * Walk for the video address. Same tolerance as the image parser, and for the same reason:
 * the documented path is response.generateVideoResponse.generatedSamples[0].video.uri, but
 * this surface is in preview and has already moved once.
 */
function findVideoUri(data) {
  const seen = new Set();
  const walk = (n) => {
    if (!n || typeof n !== 'object' || seen.has(n)) return null;
    seen.add(n);
    for (const [k, v] of Object.entries(n)) {
      if ((k === 'uri' || k === 'url') && typeof v === 'string' && /^https?:\/\//.test(v)) return v;
      const hit = walk(v);
      if (hit) return hit;
    }
    return null;
  };
  return walk(data);
}

/** Download the finished clip. The URI needs the API key — it is not a public link. */
export async function fetchVideo(uri) {
  const cfg = await videoConfig();
  const r = await fetch(uri, { headers: { 'x-goog-api-key': cfg.key } });
  if (!r.ok) {
    const e = new Error(`Couldn't download the finished video (HTTP ${r.status}).`);
    e.status = 502; throw e;
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return { buffer: buf, mime: r.headers.get('content-type') || 'video/mp4' };
}

/** Book the spend once, when a clip actually arrives — Google doesn't charge for failures. */
export function meterVideo(model, resolution, seconds, ok) {
  recordUsage('veo', {
    endpoint: `video ${model} ${resolution} ${seconds}s`,
    costCents: ok ? Math.round(usdFor(model, resolution, seconds) * 100) : 0,
    ok,
  });
}

export const _test = { findVideoUri, isPermanent, modelById };
