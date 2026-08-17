// gemini.js — the ONE call path for Google image generation (Nano Banana).
//
// Mirrors postAnthropic() in routes/support_ai.js deliberately: retry/backoff, real
// reason surfacing, and config read at CALL time live here so every image feature
// behaves the same and a key saved in the UI applies without a restart.
//
// Cost is REAL money per call — ~$0.067–$0.134 an image, not a rounding error like most
// integration traffic — so every generation is metered through recordUsage('gemini') and
// the caller is told what it cost.
import { q } from './db.js';
import { recordUsage } from './usage.js';

// Google's newer image surface. The 3.x image models are driven through /interactions
// with a `response_format`, NOT the older generateContent + generationConfig shape.
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const DEFAULT_MODEL = 'gemini-3-pro-image';

/**
 * Selectable models, with per-image USD at the STANDARD tier.
 *
 * Read the Pro row carefully: 1K and 2K cost the SAME, because Google bills the output
 * token count and both land in the same bucket. So asking Pro for 1K is strictly worse
 * than asking it for 2K — same price, fewer pixels. `defaultSize` encodes that; don't
 * "optimise" it back down to 1K.
 *
 * 1K is ~1024px, which is UNDER Etsy's recommended 2000px for a listing image. That is
 * why lite is marked drafts-only rather than presented as the cheap default.
 */
export const IMAGE_MODELS = [
  {
    id: 'gemini-3-pro-image',
    label: 'Nano Banana Pro — best quality',
    note: 'Best product consistency and legible text. 1K and 2K cost the same, so 2K is the default.',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '2K',
    usd: { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
  },
  {
    id: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2 — faster, cheaper',
    note: 'Good for iterating on a look before committing to a Pro render.',
    sizes: ['0.5K', '1K', '2K', '4K'],
    defaultSize: '1K',
    usd: { '0.5K': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151 },
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Nano Banana 2 Lite — drafts only',
    note: 'Cheapest, but capped at 1K (~1024px) — below the size marketplaces want for a listing image.',
    sizes: ['1K'],
    defaultSize: '1K',
    usd: { '1K': 0.0336 },
  },
];

export const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

// What each ratio is actually FOR here, so the picker isn't a bare list of fractions.
export const RATIO_HINTS = {
  '1:1': 'Etsy / Shopify / Amazon listing',
  '4:5': 'Instagram feed',
  '3:4': 'TikTok Shop',
  '9:16': 'Reels / TikTok video',
  '16:9': 'Banner / hero',
};

const modelById = (id) => IMAGE_MODELS.find((m) => m.id === id) || null;

/** Per-image USD for a (model, size) pair. Unknown pairs cost 0 rather than guessing. */
export function priceUsd(modelId, size) {
  const m = modelById(modelId);
  return (m && m.usd[size]) || 0;
}

/**
 * Effective config: DB settings first, then env, then defaults — resolved at CALL time.
 * A module-level `const KEY = process.env.X` would snapshot at boot, so a key saved in
 * Settings would never apply until someone restarted the container.
 */
export async function imageConfig() {
  let key = '';
  let model = '';
  // Two rows, one value each — the same shape support_ai.js uses for the Anthropic key.
  try {
    const r = await q(`select key, value from settings where key in ('image_ai_key','image_ai_model')`);
    for (const row of r.rows) {
      const v = typeof row.value === 'string' ? row.value : String(row.value ?? '');
      if (row.key === 'image_ai_key') key = v.trim();
      if (row.key === 'image_ai_model') model = v.trim();
    }
  } catch { /* settings absent on a fresh DB — fall through to env */ }

  const envKey = (process.env.GEMINI_API_KEY || '').trim();
  const fromEnv = !key && !!envKey;
  key = key || envKey;
  model = model || (process.env.GEMINI_IMAGE_MODEL || '').trim() || DEFAULT_MODEL;

  // A saved model is validated when written, but IMAGE_MODELS changes underneath it. An
  // unknown id would 404 at Google with an opaque message, so fall back — and report what
  // was dropped, so the screen can say so rather than quietly disagreeing with the admin.
  let staleModel = null;
  if (!modelById(model)) { staleModel = model; model = DEFAULT_MODEL; }
  return { key, model, fromEnv, staleModel };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Pull the image bytes out of a response.
 *
 * Deliberately shape-tolerant. Google's image surface moved to /interactions +
 * `output_image` recently, the older path returned `candidates[].content.parts[].inlineData`,
 * and the REST JSON has used both camelCase and snake_case for the blob fields. Rather than
 * bet the feature on one spelling, walk the payload for the first base64 blob that claims an
 * image mime. Returns null when there is genuinely no image (a safety block, for instance),
 * which the caller reports as a real reason rather than a crash.
 */
function extractImage(data) {
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    const b64 = node.data ?? node.bytesBase64Encoded ?? null;
    const mime = node.mime_type ?? node.mimeType ?? null;
    if (typeof b64 === 'string' && b64.length > 64 && typeof mime === 'string' && mime.startsWith('image/')) {
      return { b64, mime };
    }
    for (const v of Array.isArray(node) ? node : Object.values(node)) {
      const hit = walk(v);
      if (hit) return hit;
    }
    return null;
  };
  return walk(data);
}

/** Why did a response carry no image? Prefer Google's own words over a generic failure. */
function refusalReason(data) {
  const bits = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && /reason|message|blocked|finish/i.test(k) && v.length < 300) bits.push(v);
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(data, 0);
  return bits.length ? bits.join(' — ').slice(0, 300) : '';
}

// Exported for tests — the response walker is the part most likely to break when Google
// moves the shape again, so it has to be drivable without a key. Same convention as storage.js.
export const _test = { extractImage, refusalReason, modelById };

/**
 * Generate ONE image. Returns { buffer, mime, model, size, aspectRatio, usd }.
 *
 * Throws with .status set, and with .disabled = true when no key is configured, so a
 * caller can say "an admin hasn't switched this on" instead of reporting a broken API.
 */
export async function generateImage({ prompt, aspectRatio = '1:1', imageSize, model: modelOverride } = {}) {
  const cfg = await imageConfig();
  const model = modelById(modelOverride) ? modelOverride : cfg.model;
  const spec = modelById(model);

  if (!cfg.key) {
    const e = new Error('Image generation is off — an admin can add the Google AI key in Settings › Integrations.');
    e.disabled = true; e.status = 503; throw e;
  }
  const text = String(prompt || '').trim();
  if (!text) { const e = new Error('A prompt is required.'); e.status = 400; throw e; }

  const ratio = ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1';
  // Size must be one this model actually offers — asking lite for 4K is a 400 from Google
  // with a message no operator would understand. Fall back to the model's own default.
  const size = spec.sizes.includes(imageSize) ? imageSize : spec.defaultSize;

  const body = JSON.stringify({
    model,
    input: [{ type: 'text', text }],
    // Capital K is required — '2k' is rejected.
    response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: ratio, image_size: size },
  });
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': cfg.key };

  let r, detail = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await fetch(API_URL, { method: 'POST', headers, body });
    if (r.ok) break;
    detail = await r.text().catch(() => '');
    // 429 rate limit / 503 overloaded / 500 are transient; 4xx auth or quota are not.
    if ((r.status === 429 || r.status === 503 || r.status === 500) && attempt < 2) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    break;
  }

  const usd = priceUsd(model, size);
  // cost_cents is an integer column, so a $0.134 render meters as 13c — the meter reads
  // ~3% light on Pro. It is an ESTIMATE panel; the exact figure rides on the return value.
  const meter = (ok) => recordUsage('gemini', { endpoint: `image ${model} ${size}`, costCents: ok ? Math.round(usd * 100) : 0, ok });

  if (!r.ok) {
    meter(false);
    let reason = '';
    try { const j = JSON.parse(detail); reason = (j && j.error && (j.error.message || j.error.status)) || ''; } catch { /* non-JSON */ }
    const e = new Error(reason ? `Image AI: ${reason}` : `Image service error (HTTP ${r.status})`);
    e.status = 502; e.detail = detail; throw e;
  }

  const data = await r.json();
  const hit = extractImage(data);
  if (!hit) {
    // A 200 with no image is a refusal or a safety block, NOT a transport failure — and it
    // still consumed nothing billable, so meter it as a zero-cost call rather than a spend.
    recordUsage('gemini', { endpoint: `image ${model} ${size} (no image)`, costCents: 0, ok: false });
    const why = refusalReason(data);
    const e = new Error(why ? `No image came back: ${why}` : 'No image came back — the prompt may have been blocked.');
    e.status = 502; throw e;
  }
  meter(true);
  return {
    buffer: Buffer.from(hit.b64, 'base64'),
    mime: hit.mime,
    model, size, aspectRatio: ratio, usd,
  };
}
