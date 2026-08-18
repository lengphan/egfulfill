// support_ai.js — account-aware AI auto-reply for the seller Support chat, plus an
// admin-editable AI config (key + model) surfaced in Settings › Integrations.
//
// A seller posts to their support thread (order_messages under `support-<sellerId>`);
// the client calls POST /api/support/ai-reply. We load the recent conversation plus
// that seller's REAL orders + wallet balance, ask Claude for a concise grounded reply,
// and insert it back as role 'assistant'. The chat page polls, so it just appears.
//
// The Anthropic key + model are read from the `settings` table (admin-writable via
// PUT /api/admin/ai-config), falling back to ANTHROPIC_API_KEY / SUPPORT_AI_MODEL in
// the env. With no key configured either way the route is a graceful no-op.

import crypto from 'node:crypto';
import { q } from '../db.js';
import { egBroadcast } from '../events.js';
import { putObject, getObject, storageEnabled } from '../storage.js';
import { generateImage, imageConfig, priceUsd, IMAGE_MODELS, ASPECT_RATIOS, RATIO_HINTS } from '../gemini.js';
import { readPricing, quoteFor, chargeForGeneration, refundGeneration } from '../ai-pricing.js';
import {
  startVideo, checkVideo, fetchVideo, meterVideo, videoConfig, usdFor,
  VIDEO_MODELS, VIDEO_RATIOS, VIDEO_RATIO_HINTS, VIDEO_DURATIONS,
} from '../veo.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// Selectable models for the admin dropdown (id must be a valid Anthropic model id).
const AI_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fast & low cost (recommended)' },
  { id: 'claude-sonnet-5',          label: 'Claude Sonnet 5 — balanced' },
  { id: 'claude-opus-4-8',          label: 'Claude Opus 4.8 — most capable' },
];

// ── Support office hours ─────────────────────────────────────────────────────
// When a seller asks for a human, what we PROMISE them depends on whether the team is
// around. This is a small, single-timezone team, so it's a simple weekly window — not
// per-agent presence. Read at CALL time (env, not module load) so a change applies without
// a restart. ICT (UTC+7), Mon–Fri 09:00–18:00 by default; override via SUPPORT_* env.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmtHour = (hh) => { const H = Math.floor(hh); const M = Math.round((hh - H) * 60); return `${H}:${String(M).padStart(2, '0')}`; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * The effective support-hours config: a saved `support_config` row (admin-edited from the
 * chat page) overrides env, which overrides the defaults. Read at CALL time so an edit
 * applies immediately, no restart. `ooo` is a manual holiday closure — an ISO date we're
 * out UNTIL, with an optional custom message — which overrides the weekly window.
 */
export async function supportConfig() {
  let saved = {};
  try {
    await ensureSettings();
    const r = await q("select value from settings where key='support_config'");
    const v = r.rows[0] && r.rows[0].value;
    saved = (typeof v === 'string' ? JSON.parse(v) : v) || {};
  } catch { saved = {}; }
  const pick = (a, b, d) => { for (const x of [a, b]) { const y = Number(x); if (Number.isFinite(y)) return y; } return d; };
  const tzLabel = (typeof saved.tzLabel === 'string' && saved.tzLabel.trim()) ? saved.tzLabel.trim() : (process.env.SUPPORT_TZ_LABEL || 'ICT');
  const startH = pick(saved.startH, process.env.SUPPORT_HOURS_START, 9);
  const endH = pick(saved.endH, process.env.SUPPORT_HOURS_END, 18);
  const tzOffset = pick(saved.tzOffset, process.env.SUPPORT_TZ_OFFSET, 7);
  const days = Array.isArray(saved.days) && saved.days.length ? saved.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [1, 2, 3, 4, 5];
  const label = (typeof saved.label === 'string' && saved.label.trim()) ? saved.label.trim()
    : (process.env.SUPPORT_HOURS_LABEL || `${fmtHour(startH)}–${fmtHour(endH)} ${tzLabel}, Mon–Fri`);
  const o = (saved.ooo && typeof saved.ooo === 'object') ? saved.ooo : {};
  const ooo = { until: (typeof o.until === 'string' && o.until) ? o.until : null, message: (typeof o.message === 'string') ? o.message.slice(0, 300) : '' };
  return { startH, endH, tzOffset, tzLabel, days, label, ooo };
}

export async function supportAvailability() {
  const h = await supportConfig();
  // A manual holiday closure wins over the weekly window while its date is still ahead.
  const oooUntil = h.ooo.until ? new Date(h.ooo.until).getTime() : 0;
  const oooActive = oooUntil > Date.now();
  // Shift UTC into the office timezone, then read the wall-clock there. Fixed offset, no tz
  // library — good enough for a business-hours gate and dependency-free.
  const local = new Date(Date.now() + h.tzOffset * 3600 * 1000);
  const dow = local.getUTCDay();                       // 0 Sun … 6 Sat, in office tz
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  const open = !oooActive && h.days.includes(dow) && hour >= h.startH && hour < h.endH;
  // When closed, a CONCRETE return time beats a vague "soon".
  let resumesLabel = '';
  if (oooActive) {
    const u = new Date(oooUntil + h.tzOffset * 3600 * 1000);
    resumesLabel = `${MONTHS[u.getUTCMonth()]} ${u.getUTCDate()}`;
  } else if (!open) {
    for (let i = 0; i <= 7; i++) {
      const d = (dow + i) % 7;
      if (!h.days.includes(d)) continue;
      if (i === 0 && hour >= h.startH) continue;       // today's window already ended
      const when = i === 0 ? 'today' : i === 1 ? 'tomorrow' : DAY_NAMES[d];
      resumesLabel = `${when} at ${fmtHour(h.startH)} ${h.tzLabel}`;
      break;
    }
  }
  return { open, hoursLabel: h.label, resumesLabel, oooMessage: oooActive ? h.ooo.message : '' };
}

/**
 * No-response safety net. A seller who asked for a human and heard nothing is the exact
 * failure this handoff exists to prevent. This finds escalations a HUMAN still hasn't
 * answered past a grace window and posts ONE acknowledgment into the thread — guarded by a
 * `waitAck` marker so it never repeats and never spams. It does NOT resume the bot (posted
 * as a system note), and it does NOT count as a human reply, so the "needs a human" flag
 * stays raised for staff. The copy depends on whether the team is currently around.
 */
async function runSupportNudges() {
  const graceMin = Number(process.env.SUPPORT_NUDGE_MINUTES) || 60;
  let rows;
  try {
    rows = await q(
      `select e.order_id
         from order_messages e
        where e.order_id like 'support-%'
          and coalesce((e.meta->>'escalated')::boolean, false)
          and e.created_at < now() - ($1 * interval '1 minute')
          and not exists (
            select 1 from order_messages s
             where s.order_id = e.order_id
               and s.sender_role not in ('seller', 'assistant')
               and s.created_at > e.created_at)
          and not exists (
            select 1 from order_messages a
             where a.order_id = e.order_id
               and coalesce((a.meta->>'waitAck')::boolean, false)
               and a.created_at > e.created_at)
        group by e.order_id
        limit 25`, [graceMin]);
  } catch { return; }
  if (!rows.rows.length) return;
  const avail = await supportAvailability();
  const body = avail.open
    ? 'Thanks for your patience — your request is still in our queue and a teammate will reply here as soon as they can.'
    : `Our team is out of office right now${avail.resumesLabel ? ` — back ${avail.resumesLabel}` : ''} (${avail.hoursLabel}). Your request is logged; a teammate will reply right here, and email you, when we're back.`;
  for (const r of rows.rows) {
    try {
      await q(
        `insert into order_messages (order_id, sender_id, sender_role, body, meta)
         values ($1, null, 'assistant', $2, $3)`,
        [r.order_id, body, JSON.stringify({ by: 'EGFUL Support', system: true, waitAck: true, ts: Date.now() })]);
    } catch { /* one thread failing must not stop the rest */ }
  }
}

let _settingsReady = null;
/*
 * Video jobs. Created idempotently at route load like the other late-added tables — see
 * CLAUDE.md: schema.sql only runs on a FIRST database init, so an existing deployment
 * would never get this.
 *
 * A row exists because a Veo clip outlives its HTTP request. It is also what stops a job
 * being lost to a container restart: the sweeper picks up anything still pending, so a
 * deploy mid-generation costs a delay rather than the money already spent at Google.
 */
let _videoJobsReady = null;
function ensureVideoJobs() {
  if (_videoJobsReady) return _videoJobsReady;
  _videoJobsReady = q(`create table if not exists video_jobs (
      id text primary key,
      thread_id text not null,
      user_id uuid,
      operation text not null,
      model text, resolution text, aspect text,
      seconds integer, prompt text,
      from_image boolean not null default false,
      status text not null default 'pending',
      error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`)
    .then(() => q(`create index if not exists video_jobs_pending on video_jobs (status, created_at)`))
    .catch((e) => { _videoJobsReady = null; throw e; });
  return _videoJobsReady;
}

// How long a clip may take before we stop asking. Veo lands in one to three minutes; twelve
// is generous. A job past this is ABANDONED with a reason rather than polled forever — an
// unbounded waiter against a paid API is the shape that costs real money.
const VIDEO_MAX_MIN = 12;

async function finishVideoJob(job, uri) {
  const vid = await fetchVideo(uri);
  const ext = /webm/.test(vid.mime) ? 'webm' : 'mp4';
  const name = `vid-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await putObject(`chat/${name}`, vid.buffer, vid.mime, 'private');
  const base = (process.env.PUBLIC_API_ORIGIN || 'https://egful.store').replace(/\/+$/, '');
  const attachment = { url: `${base}/api/support/asset/${name}`, name: String(job.prompt || 'video').slice(0, 80), mime: vid.mime, size: vid.buffer.length };
  const meta = {
    by: 'EGFUL Assistant', ai: true, video: true, ts: Date.now(),
    model: job.model, resolution: job.resolution, seconds: job.seconds,
    usd: usdFor(job.model, job.resolution, job.seconds), fromImage: !!job.from_image,
  };
  await q(
    `insert into order_messages (order_id, sender_id, sender_role, body, attachment, meta, client_id)
     values ($1,$2,$3,$4,$5,$6,$7) on conflict (client_id) where client_id is not null do nothing`,
    [job.thread_id, null, 'assistant', job.prompt || '', attachment, JSON.stringify(meta), job.id]);
  meterVideo(job.model, job.resolution, job.seconds, true);
  egBroadcast({ type: 'order-message' });
}

/** Say why, in the thread. A clip that silently never arrives is the worst outcome here. */
async function failVideoJob(job, why) {
  await q(`update video_jobs set status='failed', error=$2, updated_at=now() where id=$1`, [job.id, String(why).slice(0, 400)]);
  meterVideo(job.model, job.resolution, job.seconds, false);
  await q(
    `insert into order_messages (order_id, sender_id, sender_role, body, meta, client_id)
     values ($1,$2,$3,$4,$5,$6) on conflict (client_id) where client_id is not null do nothing`,
    [job.thread_id, null, 'assistant', `The video didn't finish — ${why}`,
     JSON.stringify({ by: 'EGFUL Assistant', ai: true, system: true, ts: Date.now() }), job.id + '-err']);
  egBroadcast({ type: 'order-message' });
}

async function sweepVideoJobs() {
  let rows;
  try {
    await ensureVideoJobs();
    rows = await q(`select * from video_jobs where status='pending' order by created_at asc limit 10`);
  } catch { return; }
  for (const job of rows.rows) {
    const ageMin = (Date.now() - new Date(job.created_at).getTime()) / 60000;
    try {
      const st = await checkVideo(job.operation);
      if (!st.done) {
        if (ageMin > VIDEO_MAX_MIN) await failVideoJob(job, `it was still not ready after ${VIDEO_MAX_MIN} minutes, so we stopped waiting.`);
        continue;
      }
      if (st.error) { await failVideoJob(job, st.error); continue; }
      await finishVideoJob(job, st.uri);
      await q(`update video_jobs set status='done', updated_at=now() where id=$1`, [job.id]);
    } catch (e) {
      // A transient poll failure must not burn the job — only age it out. But a terminal
      // one (billing, a rejected prompt) has a status and should stop now rather than
      // re-ask for twelve minutes.
      if (e && (e.status === 402 || e.status === 400)) { await failVideoJob(job, e.message).catch(() => {}); continue; }
      if (ageMin > VIDEO_MAX_MIN) await failVideoJob(job, 'we lost contact with the video service.').catch(() => {});
    }
  }
}

function ensureSettings() {
  if (_settingsReady) return _settingsReady;
  // value is JSONB, matching schema.sql. It said `text` here, which disagreed with the
  // schema — harmless on any database schema.sql created (create-if-not-exists is a no-op on
  // an existing table, so jsonb won), but a landmine on one where it didn't: writes go
  // through to_jsonb(), so against a TEXT column the stored value keeps its JSON quotes and
  // reads back as `"claude-haiku-4-5"` — a model id that 404s, and an API key that 401s,
  // with nothing in either message hinting at the quotes.
  _settingsReady = q(`create table if not exists settings (key text primary key, value jsonb, updated_at timestamptz default now())`)
    .catch((e) => { _settingsReady = null; throw e; });
  return _settingsReady;
}

// Resolve the effective AI config: DB settings first, then env, then defaults.
async function aiConfig() {
  let key = '', model = '';
  /*
   * DID THE READ FAIL, OR IS THERE GENUINELY NO KEY? These are opposite problems and this
   * function used to report both as "no key". ANTHROPIC_API_KEY is not forwarded in
   * docker-compose.yml, so the env fallback below is always empty in production — meaning a
   * momentary database failure resolved to no key at all, and the UI told the operator "the
   * assistant is off, an admin can add the AI key", pointing them at a setting that was
   * fine. It happens exactly during `docker compose up -d --build`, when the API is up
   * before the database is ready, so it lands right when someone is watching a deploy.
   */
  let unavailable = false;
  try {
    await ensureSettings();
    const r = await q("select key, value from settings where key in ('support_ai_key','support_ai_model')");
    for (const row of r.rows) {
      // settings.value is jsonb (schema.sql) — pg returns a JS string for a JSON string.
      if (row.key === 'support_ai_key') key = String(row.value ?? '').trim();
      if (row.key === 'support_ai_model') model = String(row.value ?? '').trim();
    }
  } catch { unavailable = true; /* settings unreadable → env fallback, and SAY SO */ }
  key = key || (process.env.ANTHROPIC_API_KEY || '').trim();
  model = model || (process.env.SUPPORT_AI_MODEL || '').trim() || DEFAULT_MODEL;
  const fromEnv = !!(process.env.ANTHROPIC_API_KEY || '').trim();

  /**
   * A SAVED model is validated when written and never again — but AI_MODELS changes.
   *
   * Anthropic retires model ids on a published schedule, and this list has been updated at
   * least once (it now offers Haiku 4.5 / Sonnet 5 / Opus 4.8). A model chosen under an older
   * list stays in `settings` forever and keeps being sent, so the day that id retires every
   * AI call starts coming back 404 `not_found_error` — which presents as "the assistant
   * stopped responding", with nothing in the UI pointing at the model.
   *
   * So: re-check on READ. An unknown id falls back to the default rather than failing, and
   * `staleModel` carries the dead id so the admin screen can say what happened instead of
   * silently swapping it. Only a SAVED id is corrected — an operator who deliberately pins
   * something via SUPPORT_AI_MODEL is left alone, since env is a deliberate override and may
   * legitimately name a model that isn't in the dropdown.
   */
  let staleModel = null;
  const known = AI_MODELS.some((m) => m.id === model);
  const pinnedByEnv = model === (process.env.SUPPORT_AI_MODEL || '').trim();
  if (!known && !pinnedByEnv) { staleModel = model; model = DEFAULT_MODEL; }
  return { key, model, fromEnv, staleModel, unavailable };
}

/**
 * Strip emoji from a generated reply.
 *
 * The prompts ask for none, but an instruction is a request rather than a guarantee, and one
 * "Chào bạn! 👋" is all it takes for the assistant to read as a chatbot. Applies ONLY to text
 * the model produced — a seller's own emoji in their message is theirs and stays.
 *
 * Extended_Pictographic covers the pictographs; the range and joiners beside it catch skin
 * tones, variation selectors and ZWJ sequences, which would otherwise leave orphaned marks
 * behind when the base character is removed.
 */
function stripEmoji(text) {
  return String(text || '')
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]+/gu, '')
    .replace(/[ \t]{2,}/g, ' ')        // the gap the emoji left behind
    .replace(/ +([,.!?;:])/g, '$1')     // "hello !" once the emoji between them is gone
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Seller-friendly status label from the factory status (mirrors the front-end SELLER_STATUS:
// Draft -> Pending -> In Process -> Fulfilled, plus On Hold / Cancelled / Refunded).
function sellerStatus(o) {
  const s = String(o.factory_status || o.status || 'new').toLowerCase();
  if (['shipped', 'fulfilled', 'delivered'].includes(s)) return 'Fulfilled';
  if (s === 'in_review') return 'Pending';   // submitted, awaiting factory approval
  if (['awaiting_scan', 'working', 'printed', 'scanned', 'label', 'labelled', 'labeled', 'packed',
       'ready', 'queued', 'printing', 'production', 'in_production', 'prepress', 'qc',
       'ready_print', 'in_queue', 'prescan'].includes(s)) return 'In Process';
  if (['cancelled', 'canceled'].includes(s)) return 'Cancelled';
  if (s === 'refunded') return 'Refunded';
  if (['on_hold', 'hold', 'issue', 'attention', 'exception', 'flagged', 'unfunded'].includes(s)) return 'On Hold';
  return 'Draft';   // new / draft / '' — created, not submitted
}

const SYSTEM = `You are the EGFUL support assistant. EGFUL is a print-on-demand fulfillment platform for online sellers (Etsy/Shopify/etc.). You help sellers with orders, fulfillment status, shipping, billing/wallet top-ups (VietQR, card, or manual transfer), store connections, plans (Starter/Pro/Enterprise + SpyDeck research add-on), and the developer API sandbox.

Rules:
- Reply in the SAME language the seller wrote in. Our sellers write in English or Vietnamese: answer Vietnamese messages in natural Vietnamese, English messages in English. If a message mixes both or is ambiguous, mirror the seller's most recent message. Status labels in ACCOUNT DATA are English — translate them to match your reply.
- Be concise, warm, and practical. 1–3 short paragraphs, no filler.
- NO EMOJI. Not in greetings, not as decoration, not to soften a message. Warmth comes from the words.
- Use ONLY the ACCOUNT DATA provided for anything about a specific order, status, tracking, or balance. Never invent order numbers, tracking codes, dates, or amounts.
- If the answer needs info you don't have, say you've flagged it for a human teammate who will follow up here.
- Be SPECIFIC about orders — the ACCOUNT DATA includes each recent order's items, placed date, status and tracking. When answering, name the actual item(s) and cite the status, the placed date, and the tracking when present, rather than giving a generic reply. If the seller doesn't say which order, use the most recent (or briefly list them if it's ambiguous).
- For "where is my order?" give the status label in plain terms (e.g. what "In production" means), the tracking if present, and — if not shipped yet — that tracking appears once it ships.
- Don't claim to have taken actions (refunds, cancellations, shipping changes) — you can explain how, or say you've passed it to the team.`;

// Build a compact ACCOUNT DATA block for the system prompt.
async function accountContext(sellerId) {
  const lines = [];
  try {
    // Include the LINE ITEMS + placed date, not just a status label — a seller asking "where's
    // my hat" or "what did I order" gets a vague answer if all the model sees is "#4099:
    // In production". Items come back as a small JSON array, formatted below.
    const o = await q(
      `select o.id, o.seq, o.factory_status, o.status, o.total, o.tracking, o.carrier, o.created_at,
              (select json_agg(json_build_object(
                        'name', coalesce(nullif(i.name,''), i.sku, 'item'),
                        'qty', coalesce(i.qty, 1),
                        'variant', coalesce(nullif(i.variant,''), nullif(btrim(coalesce(i.color,'') || ' ' || coalesce(i.size,'')), ''))
                      ) order by i.created_at)
                 from order_items i where i.order_id = o.id) as items
         from orders o where o.seller_id=$1 order by o.created_at desc limit 10`, [sellerId]);
    if (o.rows.length) {
      lines.push('Recent orders (newest first):');
      for (const r of o.rows) {
        const num = r.seq ? `#${r.seq}` : r.id;
        const date = r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        const total = r.total != null ? ` · $${Number(r.total).toFixed(2)}` : '';
        lines.push(`- ${num}${date ? ` (placed ${date})` : ''}: ${sellerStatus(r)}${total}`);
        const items = Array.isArray(r.items) ? r.items : [];
        if (items.length) {
          lines.push('    Items: ' + items.map((it) => `${it.qty || 1}× ${it.name}${it.variant ? ` (${it.variant})` : ''}`).join('; '));
        }
        if (r.tracking) lines.push(`    Tracking: ${`${r.carrier || ''} ${r.tracking}`.replace(/\s+/g, ' ').trim()}`);
      }
    } else {
      lines.push('This seller has no orders yet.');
    }
  } catch { /* orders unavailable */ }
  try {
    const b = await q(`select coalesce(sum(delta),0) as bal from wallet_ledger where account=$1`, [String(sellerId)]);
    lines.push(`Wallet balance: $${Number(b.rows[0]?.bal || 0).toFixed(2)}.`);
  } catch { /* wallet unavailable */ }
  return lines.join('\n');
}

// Map the stored thread into alternating Claude messages (seller=user, others=assistant).
function toMessages(rows) {
  const out = [];
  for (const m of rows) {
    let text = String(m.body || '').trim();
    if (!text) continue;
    const role = (m.sender_role === 'seller') ? 'user' : 'assistant';
    /*
     * A GENERATED IMAGE is stored as an assistant row whose body is the PROMPT — that is
     * what the thread should show under the picture. But fed to the text model raw, the
     * prompt reads as something the assistant itself said ("A folded heather-grey tee on
     * warm oak…"), which is both false and confusing: the model then answers as though it
     * had been describing a tee. Label it instead, so the transcript says what happened.
     */
    if (m.meta && m.meta.image) text = `(generated an image: ${text})`;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += '\n' + text;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// Ask Claude for a reply given a seller's thread. Returns the text; throws with
// .status on failure so the caller maps the HTTP code. Reused by auto-reply + draft.
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ONE Anthropic call path: retry/backoff + error surfacing live here so every AI
// feature behaves the same. 529 (overloaded) / 429 (rate limit) are transient.
async function postAnthropic(key, body) {
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  let r, detail = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await fetch(API_URL, { method: 'POST', headers, body });
    if (r.ok) {
      const data = await r.json();
      return (Array.isArray(data.content) ? data.content : []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    }
    detail = await r.text().catch(() => '');
    if ((r.status === 529 || r.status === 429) && attempt < 2) { await sleep(700 * (attempt + 1)); continue; }
    break;
  }
  // Surface the real Anthropic reason (authentication_error, credit balance, model not_found, overloaded…).
  let reason = '';
  try { const j = JSON.parse(detail); reason = (j && j.error && (j.error.message || j.error.type)) || ''; } catch { /* non-JSON */ }
  const e = new Error(reason ? `AI: ${reason}` : `AI service error (HTTP ${r.status})`);
  e.status = 502; e.detail = detail; throw e;
}

/**
 * Run a one-shot prompt through the admin-configured key + model.
 * Throws { disabled: true } when no key is set, so callers can say so precisely
 * instead of reporting a generic failure.
 */
export async function aiComplete({ system, messages, maxTokens = 900, keepEmoji = false }) {
  const cfg = await aiConfig();
  const { key, model } = cfg;
  if (!key) { const e = new Error('The assistant is off — an admin can add the AI key in Settings › Integrations.'); e.disabled = true; e.status = 503; throw e; }
  const out = await postAnthropic(key, JSON.stringify({ model, max_tokens: maxTokens, system, messages }));
  /*
   * Stripped HERE, not at each call site, so a feature added later is emoji-free without
   * anyone having to remember. The chat assistant was only the visible half — order briefs,
   * SpyDeck advice and supplier suggestions all come through this function and are all read
   * by a person.
   *
   * `keepEmoji` is for copy destined somewhere OTHER than our own UI — a marketplace listing,
   * where an emoji may be a deliberate part of the writing rather than a chatbot tic.
   */
  return keepEmoji ? out : stripEmoji(out);
}

/*
 * A staffer's own "My EG" runs through this same seller-facing prompt, which says nothing
 * about pictures — so when a staffer asked for one the model improvised a denial and sent
 * them to DALL-E, Midjourney or Canva, with our own image button sitting inches away in the
 * same composer. An assistant that denies a capability the screen is offering is worse than
 * one that stays quiet, so the staff case gets told what is actually on their screen.
 *
 * Sellers must NOT get this block: image generation is staff-only, and telling a seller
 * about a button they don't have is the same failure pointing the other way.
 */
const STAFF_EXTRA = `

THIS THREAD IS A STAFF MEMBER'S OWN WORKSPACE — not a seller's support thread.
- Image generation IS available to them here. There is a picture button in the message box (left of the paperclip) that renders product images and posts them into this thread.
- So never say you can't do images, and never point them at DALL-E, Midjourney or Canva. If they ask for a picture, tell them to use that button — and help by writing the prompt they should paste, plus which shape to pick (1:1 for an Etsy/Shopify listing, 4:5 Instagram, 9:16 Reels).
- A good prompt names the subject, the fabric or material, the surface it sits on, and the light. Keep lettering out of it unless they ask — text is the hardest thing for it to render.
- They are staff, so internal detail is fine; the seller-facing caution about naming suppliers still applies to anything they might publish.`;

async function generateReply(key, model, sellerId, messages, isStaffOwn = false) {
  const ctx = await accountContext(sellerId);
  const system = SYSTEM + (isStaffOwn ? STAFF_EXTRA : '') + '\n\nACCOUNT DATA (for this seller only):\n' + ctx;
  const body = JSON.stringify({ model, max_tokens: 600, system, messages });
  return postAnthropic(key, body);
}

// Workbench = the user's PRIVATE personal assistant (desk-<uid>). Only they can read it, so
// it's a scratch space: ask things, keep notes. No live order/wallet data here (that's
// Support) — it works over the conversation plus the user's own saved notes.
const DESK_SYSTEM = `You are Workbench, a private personal assistant for one EGFUL user. This space is theirs alone — no one else can read it. Help them think, answer questions, and remember what they've saved.

Rules:
- Reply in the same language the user writes in (English or Vietnamese).
- Be concise and practical. Use markdown (**bold**, lists) when it helps.
- NO EMOJI, anywhere, for any reason.
- When SAVED NOTES are provided, treat them as facts the user asked you to remember, and cite them when relevant ("from your notes, …").
- You don't have live order, wallet, or shipping data here — if they need that, point them to EGFUL Support or the relevant board.
- Never claim to have taken actions in the system.`;

export function supportAiRoutes(app, requireAuth, requireStaff) {
  // Break silence on stuck escalations. Same single-instance pattern as the other sweeps:
  // a globalThis guard so a hot reload can't stack timers, unref() so it never holds the
  // process open, and a delayed first run to catch anything already overdue at boot.
  if (!globalThis.__egSupportNudge) {
    globalThis.__egSupportNudge = setInterval(() => { runSupportNudges().catch(() => {}); }, 15 * 60 * 1000);
    if (globalThis.__egSupportNudge.unref) globalThis.__egSupportNudge.unref();
  }
  // Same single-instance pattern for the video sweeper: a globalThis guard so a hot reload
  // can't stack pollers against a paid API, unref so it never holds the process open, and a
  // delayed first run to pick up anything left pending by a restart.
  if (!globalThis.__egVideoSweep) {
    globalThis.__egVideoSweep = setInterval(() => { sweepVideoJobs().catch(() => {}); }, 20 * 1000);
    if (globalThis.__egVideoSweep.unref) globalThis.__egVideoSweep.unref();
    setTimeout(() => { sweepVideoJobs().catch(() => {}); }, 30 * 1000).unref?.();
    setTimeout(() => { runSupportNudges().catch(() => {}); }, 45 * 1000).unref?.();
  }

  // ── Is the support team around right now? Drives the handoff copy the seller sees. ──
  app.get('/api/support/availability', { preHandler: requireAuth }, async () => await supportAvailability());

  // ── Staff: read the editable hours config + live status (shown in the chat editor). ──
  app.get('/api/support/hours-config', { preHandler: requireStaff }, async () => {
    const cfg = await supportConfig();
    return {
      config: { startH: cfg.startH, endH: cfg.endH, tzOffset: cfg.tzOffset, tzLabel: cfg.tzLabel, days: cfg.days, ooo: cfg.ooo },
      availability: await supportAvailability(),
    };
  });
  // ── ADMIN: save the hours config + manual holiday closure. ──
  app.put('/api/support/hours-config', { preHandler: requireStaff }, async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'Admin only' }; }
    await ensureSettings();
    const b = req.body || {};
    const cur = await supportConfig();
    const clampH = (v, d) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x <= 24 ? x : d; };
    const cfg = {
      startH: clampH(b.startH, cur.startH),
      endH: clampH(b.endH, cur.endH),
      tzOffset: Number.isFinite(Number(b.tzOffset)) ? Number(b.tzOffset) : cur.tzOffset,
      tzLabel: (typeof b.tzLabel === 'string' && b.tzLabel.trim()) ? b.tzLabel.trim().slice(0, 8) : cur.tzLabel,
      days: Array.isArray(b.days) ? b.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : cur.days,
      ooo: {
        // A blank/absent until clears the holiday closure. Stored as-is (ISO date string).
        until: (b.ooo && typeof b.ooo.until === 'string' && b.ooo.until.trim()) ? b.ooo.until.trim() : null,
        message: (b.ooo && typeof b.ooo.message === 'string') ? b.ooo.message.slice(0, 300) : '',
      },
    };
    await q(
      `insert into settings (key, value, updated_at) values ('support_config', $1::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [JSON.stringify(cfg)]);
    return { ok: true, config: cfg, availability: await supportAvailability() };
  });

  // ── Staff: DRAFT a reply for a seller's support thread (does NOT post it) ─────
  app.post('/api/support/ai-draft', { preHandler: requireStaff }, async (req, reply) => {
    const cfg = await aiConfig();
    const { key, model } = cfg;
    if (!key) return cfg.unavailable
      ? { ok: false, unavailable: true, error: 'The assistant is briefly unavailable — the server could not read its settings. Try again in a moment.' }
      : { ok: false, disabled: true };
    const threadId = String((req.body && req.body.threadId) || '');
    if (threadId.indexOf('support-') !== 0) { reply.code(400); return { error: 'threadId must be a support-* thread' }; }
    const sellerId = threadId.slice('support-'.length);
    // NEWEST 20, re-ordered oldest-first for the model. `order by created_at asc limit 20`
    // takes the OLDEST 20 — see the note on the auto-reply query below.
    const hist = await q(
      `select sender_role, body, meta from (
         select sender_role, body, meta, created_at, id from order_messages
          where order_id=$1
          order by created_at desc, id desc limit 20
       ) t order by t.created_at asc, t.id asc`, [threadId]);
    const messages = toMessages(hist.rows);
    if (!messages.length) return { ok: false, empty: true };
    try {
      const draft = await generateReply(key, model, sellerId, messages);
      if (!draft) return { ok: false, empty: true };
      return { ok: true, draft: stripEmoji(draft) };
    } catch (e) {
      // Return 200 with the reason so the UI can show it (a failed AI call isn't an API error).
      req.log?.warn?.({ err: String(e), detail: e.detail }, 'support-ai draft failed');
      return { ok: false, error: e.message || 'AI unavailable' };
    }
  });

  // ── Staff: live "does the key actually work?" test (pings Anthropic once) ─────
  // Tests the key POSTed in the body (so you can verify BEFORE saving); if none is
  // sent, tests the currently-saved key.
  app.post('/api/admin/ai-test', { preHandler: requireStaff }, async (req) => {
    const cfg = await aiConfig();
    const typed = (req.body && typeof req.body.key === 'string') ? req.body.key.trim() : '';
    const key = typed || cfg.key;
    const model = cfg.model;
    if (!key) return { ok: false, error: 'No API key to test — paste one or save it first.' };
    const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    const body = JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] });
    try {
      let r, detail = '';
      // Retry transient overload/rate-limit so a capacity blip doesn't read as a key failure.
      for (let attempt = 0; attempt < 3; attempt++) {
        r = await fetch(API_URL, { method: 'POST', headers, body });
        if (r.ok) return { ok: true, model };
        detail = await r.text().catch(() => '');
        if ((r.status === 529 || r.status === 429) && attempt < 2) { await sleep(700 * (attempt + 1)); continue; }
        break;
      }
      let reason = '';
      try { const j = JSON.parse(detail); reason = (j && j.error && (j.error.message || j.error.type)) || ''; } catch { /* non-JSON */ }
      const overloaded = r.status === 529 || /overloaded/i.test(reason);
      return {
        ok: false, model, status: r.status,
        error: overloaded ? 'Anthropic is busy right now (overloaded) — your key is valid; try again in a moment.' : (reason || `HTTP ${r.status}`),
      };
    } catch (e) {
      return { ok: false, model, error: (e && e.message) || 'Request failed' };
    }
  });

  // ── Admin config (Settings › Integrations): key status + model selector ──────
  // Admins get a head…tail preview of the key; other staff last-4 only (same rule as
  // admin_secrets). Reads role off the request.
  const maskKey = (k, full) => !k ? null : (full && k.length >= 10 ? `${k.slice(0, 4)}${'•'.repeat(8)}${k.slice(-4)}` : `${'•'.repeat(8)}${k.slice(-4)}`);
  app.get('/api/admin/ai-config', { preHandler: requireStaff }, async (req) => {
    const cfg = await aiConfig();
    return {
      keySet: !!cfg.key,
      last4: cfg.key ? cfg.key.slice(-4) : null,
      masked: maskKey(cfg.key, req.user?.role === 'admin'),
      fromEnv: cfg.fromEnv,        // true if the active key comes from the env (can't be cleared here)
      model: cfg.model,
      // The saved model was retired or removed from the roster; `model` above is the default
      // we fell back to. Surfaced so the screen can say so rather than quietly disagreeing
      // with what the admin last picked.
      staleModel: cfg.staleModel || null,
      models: AI_MODELS,
    };
  });

  app.put('/api/admin/ai-config', { preHandler: requireStaff }, async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'Admin only' }; }
    const b = req.body || {};
    await ensureSettings();
    if (b.clearKey) {
      await q("delete from settings where key='support_ai_key'");
    } else if (typeof b.key === 'string' && b.key.trim()) {
      await q("insert into settings (key,value,updated_at) values ('support_ai_key', to_jsonb($1::text), now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [b.key.trim()]);
    }
    if (typeof b.model === 'string' && b.model.trim()) {
      const valid = AI_MODELS.some((m) => m.id === b.model.trim());
      if (!valid) { reply.code(400); return { error: 'Unknown model' }; }
      await q("insert into settings (key,value,updated_at) values ('support_ai_model', to_jsonb($1::text), now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [b.model.trim()]);
    }
    const cfg = await aiConfig();
    return { ok: true, keySet: !!cfg.key, last4: cfg.key ? cfg.key.slice(-4) : null, masked: maskKey(cfg.key, true), fromEnv: cfg.fromEnv, model: cfg.model };
  });

  /**
   * THE SELLER-FACING AUTO-REPLY — OFF.
   *
   * A product decision, not a technical one: nobody who writes to support wants to talk to
   * a machine first, and everything below this line — the handoff suppression, the "don't
   * talk over the queue" rule, the escalation-flag bookkeeping — exists to manage a bot
   * that should not have been in the conversation at all.
   *
   * AI still helps US: POST /api/support/ai-draft (staff-only) drafts a reply for a person
   * to read, edit and send. That is the version where a model's mistake is caught by the
   * human whose name goes on the answer.
   *
   * The route stays and answers `{ ok:true, disabled:true }` — the shape callers already
   * handle for "no key configured" — so any client still calling it degrades to silence
   * rather than an error, and the whole implementation below stays readable for whoever
   * revisits this decision.
   */
  const SELLER_AUTO_REPLY = false;

  app.post('/api/support/ai-reply', { preHandler: requireAuth }, async (req, reply) => {
    /*
     * The switch above is about SELLERS — nobody writing to support wants a machine first.
     * A staffer's own "My EG" runs through this same route and is not that: there is no
     * seller in it, no human queue behind it, and it is the personal assistant they use to
     * work. Gating it here turned that off too, and because the client renders `disabled`
     * as "an admin can add the AI key in Settings", it read as a broken credential — so the
     * one place to look was the one place that was already correct.
     *
     * The same carve-out is already made further down for handoff suppression, and for the
     * same reason; this just applies it one step earlier.
     */
    const isStaffOwn = String(req.user.role || 'seller') !== 'seller';
    if (!SELLER_AUTO_REPLY && !isStaffOwn) return { ok: true, disabled: true, reason: 'seller-auto-reply-off' };
    const cfg = await aiConfig();
    const { key, model } = cfg;
    if (!key) {
      // `unavailable` = the settings read itself failed (database still coming up during a
      // deploy, most often). Reporting that as "add a key" sends an operator to a screen
      // where everything is already correct.
      if (cfg.unavailable) { req.log?.warn?.('support-ai: settings unreadable — reporting as temporary'); return { ok: false, unavailable: true, error: 'The assistant is briefly unavailable — the server could not read its settings. Try again in a moment.' }; }
      req.log?.warn?.('support-ai: no AI key configured (Settings › Integrations)');
      return { ok: false, disabled: true };
    }
    const sellerId = req.user.sub;
    const threadId = 'support-' + sellerId;
    // A staffer's own "My EG" is a PERSONAL AI thread — there is no human queue behind it,
    // so the handoff suppression below (which goes silent until a teammate replies) must
    // never gate it, or one stray escalated flag would mute their assistant permanently.
    // (`isStaffOwn` is decided at the top of the route now, for the auto-reply switch.)

    // HUMAN HANDOFF: once a seller asks for a human, the AI stays OUT until a real teammate
    // replies. Two reasons — it must not talk over the queue, and its own reply (role
    // 'assistant') would otherwise count as "answered" and clear the escalation flag,
    // burying the request no one saw. An open handoff = an escalation message with no reply
    // from a human after it; the seller's own follow-ups and the AI's posts don't count.
    // This is the industry-standard behaviour (Intercom/Zendesk/etc. suppress the bot on
    // handoff). The bot may resume only once a human has actually replied.
    try {
      const open = await q(
        `select 1 from order_messages e
           where e.order_id = $1
             and coalesce((e.meta->>'escalated')::boolean, false)
             and not exists (
               select 1 from order_messages s
                where s.order_id = e.order_id
                  and s.sender_role not in ('seller', 'assistant')
                  and s.created_at > e.created_at)
           limit 1`, [threadId]);
      if (open.rows.length && !isStaffOwn) { req.log?.info?.({ threadId }, 'support-ai: suppressed on open human handoff'); return { ok: true, escalated: true, office: await supportAvailability() }; }
    } catch { /* if the check fails, fall through — a missed suppression is better than a hang */ }

    // Exclude INTERNAL rows (staff order briefs, internal notes). They share this
    // channel but must never reach the seller — and this reply is auto-posted with no
    // human in the loop, so a brief in the model's context could bleed factory-internal
    // state into a seller-facing answer. Mirrors the seller read filter in orders.js.
    // (ai-draft deliberately does NOT filter: a human reviews that draft before sending.)
    // THE NEWEST 20, NOT THE OLDEST. `order by created_at asc ... limit 20` takes the first
    // 20 rows the thread ever had — so once a conversation passed 20 messages the model's
    // view froze on its opening, and the newest turn it could see was whatever was said 20
    // messages ago. When that turn was one of OUR replies, the last-turn-must-be-user check
    // below skipped every request from then on: the assistant went silent permanently and
    // nothing said why. Order desc to take the recent window, then restore chronological
    // order, because toMessages() builds the transcript in sequence.
    const hist = await q(
      `select sender_role, body, meta from (
         select sender_role, body, meta, created_at, id from order_messages
          where order_id=$1
            and not coalesce((meta->>'internal')::boolean, false)
          order by created_at desc, id desc limit 20
       ) t order by t.created_at asc, t.id asc`, [threadId]);
    const messages = toMessages(hist.rows);
    // SAY WHY. Both of these are deliberate no-ops, and both used to return a bare flag the
    // client rendered as nothing — so "the assistant declined to answer" and "the assistant is
    // broken" looked identical on screen, which is exactly how this became undiagnosable.
    // `reason` is for a human: toMessages() drops bodiless rows, so an image posted with no
    // caption disappears from the model's view and the last turn it can see is our own reply.
    if (!messages.length) return { ok: false, empty: true, reason: 'no readable messages in this thread yet' };
    if (messages[messages.length - 1].role !== 'user') {
      return { ok: true, skipped: true, reason: 'the last thing in this thread is my own reply — attachments without a caption are not readable, so add a line of text' };
    }

    let text = '';
    try {
      text = stripEmoji(await generateReply(key, model, sellerId, messages, isStaffOwn));
    } catch (e) {
      // Return 200 with the reason (not a 5xx) so the client shows WHY instead of throwing.
      req.log?.warn?.({ err: String(e), detail: e.detail }, 'support-ai request failed');
      return { ok: false, error: e.message || 'AI service unavailable' };
    }
    if (!text) return { ok: false, empty: true };

    const clientId = 'ai-' + crypto.randomBytes(8).toString('hex');
    const meta = { by: 'EGFUL Assistant', ai: true, ts: Date.now() };
    await q(
      `insert into order_messages (order_id, sender_id, sender_role, body, meta, client_id)
       values ($1,$2,$3,$4,$5,$6) on conflict (client_id) where client_id is not null do nothing`,
      // sender_id is uuid references users(id) — the assistant is not a user row, so NULL (role/meta carry identity).
      [threadId, null, 'assistant', text, JSON.stringify(meta), clientId]);
    return { ok: true, reply: text };
  });

  // ── Private Workbench: personal AI over the user's OWN notes + chat ────────────
  // Reads only desk-<caller's own id>, so one user can never reach another's Workbench.
  app.post('/api/desk/ai-reply', { preHandler: requireAuth }, async (req, reply) => {
    const cfg = await aiConfig();
    const { key, model } = cfg;
    if (!key) return cfg.unavailable
      ? { ok: false, unavailable: true, error: 'The assistant is briefly unavailable — the server could not read its settings. Try again in a moment.' }
      : { ok: false, disabled: true };
    const threadId = 'desk-' + req.user.sub;
    // Pinned notes (meta.note) become durable context; everything else is recent chat.
    const noteRows = await q(
      `select body from (
         select body, created_at, id from order_messages
          where order_id=$1 and coalesce((meta->>'note')::boolean, false)
          order by created_at desc, id desc limit 50
       ) t order by t.created_at asc, t.id asc`, [threadId]);
    const hist = await q(
      `select sender_role, body, meta from (
         select sender_role, body, meta, created_at, id from order_messages
          where order_id=$1 and not coalesce((meta->>'note')::boolean, false)
          order by created_at desc, id desc limit 20
       ) t order by t.created_at asc, t.id asc`, [threadId]);
    const messages = toMessages(hist.rows);
    // SAY WHY. Both of these are deliberate no-ops, and both used to return a bare flag the
    // client rendered as nothing — so "the assistant declined to answer" and "the assistant is
    // broken" looked identical on screen, which is exactly how this became undiagnosable.
    // `reason` is for a human: toMessages() drops bodiless rows, so an image posted with no
    // caption disappears from the model's view and the last turn it can see is our own reply.
    if (!messages.length) return { ok: false, empty: true, reason: 'no readable messages in this thread yet' };
    if (messages[messages.length - 1].role !== 'user') {
      return { ok: true, skipped: true, reason: 'the last thing in this thread is my own reply — attachments without a caption are not readable, so add a line of text' };
    }
    const notes = noteRows.rows.map((r) => String(r.body || '').trim()).filter(Boolean);
    const system = DESK_SYSTEM + (notes.length
      ? '\n\nSAVED NOTES (the user pinned these):\n' + notes.map((n) => '- ' + n).join('\n')
      : '\n\n(No saved notes yet.)');
    let text = '';
    try {
      text = stripEmoji(await postAnthropic(key, JSON.stringify({ model, max_tokens: 700, system, messages })));
    } catch (e) {
      req.log?.warn?.({ err: String(e), detail: e.detail }, 'desk-ai request failed');
      return { ok: false, error: e.message || 'AI service unavailable' };
    }
    if (!text) return { ok: false, empty: true };
    const clientId = 'ai-' + crypto.randomBytes(8).toString('hex');
    const meta = { by: 'Workbench', ai: true, ts: Date.now() };
    await q(
      `insert into order_messages (order_id, sender_id, sender_role, body, meta, client_id)
       values ($1,$2,$3,$4,$5,$6) on conflict (client_id) where client_id is not null do nothing`,
      [threadId, null, 'assistant', text, JSON.stringify(meta), clientId]);
    return { ok: true, reply: text };
  });

  /*
   * GENERATION IS ADMIN-ONLY — image and video alike.
   *
   * Not a permissions nicety: every press spends real money at Google (~13c an image, 40c
   * to $4.80 a clip), and requireStaff means operator, warehouse and designer too. A tool
   * that bills on click does not belong on the floor, where it would be indistinguishable
   * from any other button.
   *
   * Enforced on the SERVER, not by hiding the control — the client hides it as well, but
   * that is convenience, and this is the boundary.
   */
  /*
   * IMAGES ARE THE EXCEPTION, and only for sellers who pay for them.
   *
   * A seller spends their OWN wallet, so the money argument above does not apply to them —
   * it applies to the other staff roles, who spend ours. Hence three outcomes rather than
   * two: admin generates free, a seller generates if an admin has switched it on and their
   * balance covers it, and operator/warehouse/designer are still refused.
   *
   * Video stays admin-only regardless. A clip costs up to fifteen images and is a marketing
   * asset rather than something that becomes a listing.
   */
  const imageGate = async (req, reply) => {
    const role = String(req.user?.role || 'seller');
    if (role === 'admin') return null;
    if (role !== 'seller') {
      reply.code(403);
      return { error: 'Generating images is limited to admins and sellers.' };
    }
    const pricing = await readPricing();
    if (!pricing.sellersEnabled) {
      reply.code(403);
      return { error: 'AI generation is not switched on for your account yet.' };
    }
    return null;
  };

  const adminOnly = (req, reply) => {
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'Generating images and video is admin-only.' }; }
    return null;
  };

  // ── Image generation, ADMIN ONLY, in the staffer's own "My EG" assistant channel ──
  //
  // Factory-only on purpose. Every render is real money at Google (~7–13c), so this is not
  // a seller-facing feature that could be looped by anyone with an account — it is a tool on
  // the factory's own desk, gated by requireStaff and hard-scoped to the CALLER'S OWN thread.
  //
  // The thread id is derived from the JWT and never accepted from the body: there is no
  // parameter here that could aim a billable call at somebody else's channel.

  // What the composer needs to draw its picker — and whether the feature is on at all.
  app.get('/api/desk/image/config', { preHandler: requireAuth }, async (req, reply) => {
    const denied = await imageGate(req, reply); if (denied) return denied;
    const cfg = await imageConfig();
    return {
      // What THIS caller pays and what they have left, so the composer can price the button
      // and say "3 free left this month" rather than making someone find out by pressing it.
      quote: await quoteFor(req.user),
      enabled: !!cfg.key && storageEnabled(),
      // Told apart so the UI can say WHICH half is missing rather than "unavailable".
      keySet: !!cfg.key,
      storageReady: storageEnabled(),
      model: cfg.model,
      models: IMAGE_MODELS,
      ratios: ASPECT_RATIOS,
      ratioHints: RATIO_HINTS,
    };
  });

  app.post('/api/desk/image', { preHandler: requireAuth }, async (req, reply) => {
    const denied = await imageGate(req, reply); if (denied) return denied;
    if (!storageEnabled()) { reply.code(503); return { error: 'File storage is not configured, so a generated image could not be kept.' }; }
    const b = req.body || {};
    const prompt = String(b.prompt || '').trim();
    if (!prompt) { reply.code(400); return { error: 'Describe the image you want.' }; }
    if (prompt.length > 4000) { reply.code(400); return { error: 'That prompt is too long (max 4000 characters).' }; }

    // The caller's OWN assistant channel — same thread "My EG" already reads.
    const threadId = 'support-' + req.user.sub;

    /*
     * REFERENCE PHOTOS. Bare asset NAMES, never URLs — a URL here would be a fetcher aimed
     * at anything the server can reach, and these are read straight off our own storage.
     * Same hard bare-name check the asset route uses, so nothing outside chat/ is readable.
     *
     * A missing one is skipped rather than fatal: a reference that has aged out of storage
     * should not throw away a prompt the person already typed.
     */
    const refs = [];
    for (const raw of (Array.isArray(b.imageNames) ? b.imageNames : []).slice(0, 14)) {
      const name = String(raw || '');
      if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
      try {
        const obj = await getObject(`chat/${name}`);
        if (obj && obj.body && obj.body.length) refs.push({ buffer: obj.body, mime: obj.contentType || 'image/jpeg' });
      } catch { /* unreadable reference — carry on without it */ }
    }

    /*
     * TAKE THE MONEY FIRST. moveFunds refuses to overdraw a seller wallet, so charging here
     * is what stops an unfunded render BEFORE Google bills us for it. Doing this after would
     * mean paying for images we cannot charge for.
     *
     * Staff come back { usd: 0, staff: true } and nothing moves.
     */
    let charge;
    try {
      charge = await chargeForGeneration(req.user, 'image');
    } catch (e) {
      reply.code(e.status || 400);
      return { error: e.message || 'Could not start this generation.', shortfall: e.shortfall };
    }

    let img;
    try {
      img = await generateImage({ prompt, aspectRatio: b.aspectRatio, imageSize: b.imageSize, model: b.model, images: refs });
    } catch (e) {
      // 200 with a reason, not a 5xx — the chat client renders `error`, and a throw here
      // showed up as a dead spinner with nothing said, which is how the assistant's other
      // no-op paths became undiagnosable.
      req.log?.warn?.({ err: String(e), detail: e.detail }, 'desk-image generation failed');
      // Nothing was rendered, so nothing is owed. The refund also releases the daily-cap
      // slot and any free allowance the attempt consumed.
      await refundGeneration(charge, 'image generation failed');
      // `overloaded` = this MODEL is out of capacity, not the account or the request. The
      // client offers a switch to a less contended model rather than just "try later".
      return { ok: false, disabled: !!e.disabled, overloaded: !!e.overloaded, refunded: Number(charge.usd) > 0, error: e.message || 'Image generation failed' };
    }

    // Store PRIVATE and hand back a same-origin proxy URL, exactly like a chat upload:
    // it loads in an <img> without a public bucket, and it is only reachable via the
    // unguessable key it is posted into the thread with.
    const ext = img.mime === 'image/jpeg' ? 'jpg' : img.mime === 'image/webp' ? 'webp' : 'png';
    const name = `img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    try {
      await putObject(`chat/${name}`, img.buffer, img.mime, 'private');
    } catch (e) {
      req.log?.error?.({ err: String(e) }, 'desk-image storage failed');
      // Google billed US for this one and there is no getting that back — but the seller has
      // nothing they can use, and the failure is ours, so they are not the ones who pay for it.
      await refundGeneration(charge, 'image could not be saved');
      // The money was already spent at Google — say so plainly rather than implying a retry is free.
      return { ok: false, refunded: Number(charge.usd) > 0, error: 'The image was generated but could not be saved: ' + ((e && e.message) || 'storage error') };
    }
    const base = (process.env.PUBLIC_API_ORIGIN || 'https://egful.store').replace(/\/+$/, '');
    const attachment = { url: `${base}/api/support/asset/${name}`, name: prompt.slice(0, 80), mime: img.mime, size: img.buffer.length };

    const clientId = 'img-' + crypto.randomBytes(8).toString('hex');
    const meta = { by: 'EGFUL Assistant', ai: true, image: true, ts: Date.now(), model: img.model, size: img.size, aspect: img.aspectRatio, usd: img.usd, refs: img.refsUsed || 0 };
    await q(
      `insert into order_messages (order_id, sender_id, sender_role, body, attachment, meta, client_id)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (client_id) where client_id is not null do nothing`,
      [threadId, null, 'assistant', prompt, attachment, JSON.stringify(meta), clientId]);
    egBroadcast({ type: 'order-message' });

    // `usd` is what GOOGLE cost us and is staff-only reading; `charged` is what the seller
    // actually paid. Keeping them separate is what stops our cost being shown as their price.
    return {
      ok: true, attachment, model: img.model, size: img.size, aspectRatio: img.aspectRatio,
      usd: charge.staff ? img.usd : undefined,
      charged: charge.usd, free: charge.free,
      quote: await quoteFor(req.user),
      refsUsed: img.refsUsed || 0,
    };
  });

  // ── Video generation (Veo), same gate and same channel as images ─────────────
  //
  // A clip takes one to three minutes, which no HTTP request should be held open for —
  // through Caddy, Vercel or a phone on mobile data, that connection dies long before the
  // video does. So POST only STARTS a job; a bounded sweeper below posts the finished clip
  // into the thread, which the chat page is already polling. Same arrival as an AI reply.

  app.get('/api/desk/video/config', { preHandler: requireStaff }, async (req, reply) => {
    const denied = adminOnly(req, reply); if (denied) return denied;
    const cfg = await videoConfig();
    return {
      enabled: !!cfg.key && storageEnabled(),
      keySet: !!cfg.key,
      storageReady: storageEnabled(),
      model: cfg.model,
      models: VIDEO_MODELS,
      ratios: VIDEO_RATIOS,
      ratioHints: VIDEO_RATIO_HINTS,
      durations: VIDEO_DURATIONS,
    };
  });

  app.post('/api/desk/video', { preHandler: requireStaff }, async (req, reply) => {
    const denied = adminOnly(req, reply); if (denied) return denied;
    if (!storageEnabled()) { reply.code(503); return { error: 'File storage is not configured, so a generated video could not be kept.' }; }
    const b = req.body || {};
    const prompt = String(b.prompt || '').trim();
    if (!prompt) { reply.code(400); return { error: 'Describe the video you want.' }; }
    if (prompt.length > 4000) { reply.code(400); return { error: 'That prompt is too long (max 4000 characters).' }; }

    // ANIMATE AN EXISTING STILL. The client passes the bare asset filename, never a URL —
    // a URL parameter here would be a fetcher pointed at anything the server can reach.
    // Same hard bare-name check the asset route uses, so it can only read chat/<name>.
    let image = null;
    if (b.imageName) {
      const name = String(b.imageName);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) { reply.code(400); return { error: 'bad image reference' }; }
      try {
        const obj = await getObject(`chat/${name}`);
        if (!obj) { reply.code(404); return { error: "That image is no longer stored, so it can't be animated." }; }
        image = { buffer: obj.body, mime: obj.contentType || 'image/jpeg' };
      } catch {
        reply.code(502); return { error: "Couldn't read that image back to animate it." };
      }
    }

    const threadId = 'support-' + req.user.sub;
    let job;
    try {
      job = await startVideo({
        prompt, aspectRatio: b.aspectRatio, resolution: b.resolution,
        durationSeconds: b.durationSeconds, model: b.model, image,
      });
    } catch (e) {
      req.log?.warn?.({ err: String(e), detail: e.detail }, 'desk-video start failed');
      return { ok: false, disabled: !!e.disabled, error: e.message || 'Video generation failed to start' };
    }

    const id = 'vid-' + crypto.randomBytes(8).toString('hex');
    await ensureVideoJobs();
    await q(
      `insert into video_jobs (id, thread_id, user_id, operation, model, resolution, aspect, seconds, prompt, from_image, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')`,
      [id, threadId, req.user.sub, job.operation, job.model, job.resolution, job.aspectRatio, job.seconds, prompt, !!image]);

    // Kick the sweeper rather than waiting a full interval for the first check.
    setTimeout(() => { sweepVideoJobs().catch(() => {}); }, 12_000).unref?.();
    return { ok: true, started: true, jobId: id, usd: job.usd, seconds: job.seconds, model: job.model, resolution: job.resolution };
  });

  // Has my clip landed yet? The thread itself carries the result; this is only so the
  // composer can keep a spinner honest instead of guessing how long to show one.
  app.get('/api/desk/video/:id', { preHandler: requireStaff }, async (req, reply) => {
    const denied = adminOnly(req, reply); if (denied) return denied;
    await ensureVideoJobs();
    const r = await q(
      `select id, status, error, seconds, model, resolution, created_at from video_jobs where id=$1 and user_id=$2`,
      [String(req.params.id || ''), req.user.sub]);
    if (!r.rows.length) { reply.code(404); return { error: 'not found' }; }
    return r.rows[0];
  });

  // ── Admin config for the image key (Settings › Integrations), mirroring ai-config ──
  app.get('/api/admin/image-ai-config', { preHandler: requireStaff }, async (req) => {
    const cfg = await imageConfig();
    return {
      keySet: !!cfg.key,
      last4: cfg.key ? cfg.key.slice(-4) : null,
      masked: maskKey(cfg.key, req.user?.role === 'admin'),
      fromEnv: cfg.fromEnv,
      model: cfg.model,
      staleModel: cfg.staleModel || null,
      models: IMAGE_MODELS,
      storageReady: storageEnabled(),
    };
  });

  app.put('/api/admin/image-ai-config', { preHandler: requireStaff }, async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'Admin only' }; }
    const b = req.body || {};
    await ensureSettings();
    if (b.clearKey) {
      await q("delete from settings where key='image_ai_key'");
    } else if (typeof b.key === 'string' && b.key.trim()) {
      await q("insert into settings (key,value,updated_at) values ('image_ai_key', to_jsonb($1::text), now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [b.key.trim()]);
    }
    if (typeof b.model === 'string' && b.model.trim()) {
      if (!IMAGE_MODELS.some((m) => m.id === b.model.trim())) { reply.code(400); return { error: 'Unknown model' }; }
      await q("insert into settings (key,value,updated_at) values ('image_ai_model', to_jsonb($1::text), now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [b.model.trim()]);
    }
    const cfg = await imageConfig();
    return { ok: true, keySet: !!cfg.key, last4: cfg.key ? cfg.key.slice(-4) : null, masked: maskKey(cfg.key, true), fromEnv: cfg.fromEnv, model: cfg.model };
  });

  // Verify a key BEFORE saving it — one real 1K render on the cheapest model, so the test
  // costs ~3c rather than a Pro-tier 13c. There is no free ping on an image endpoint.
  app.post('/api/admin/image-ai-test', { preHandler: requireStaff }, async (req) => {
    const typed = (req.body && typeof req.body.key === 'string') ? req.body.key.trim() : '';
    const cfg = await imageConfig();
    if (!typed && !cfg.key) return { ok: false, error: 'No API key to test — paste one or save it first.' };
    // A typed key isn't saved yet, so put it on the env for the duration of this one call.
    const prev = process.env.GEMINI_API_KEY;
    if (typed) process.env.GEMINI_API_KEY = typed;
    try {
      const probe = 'gemini-3.1-flash-lite-image';
      const img = await generateImage({ prompt: 'A plain grey cotton t-shirt on a white background, product photo.', aspectRatio: '1:1', imageSize: '1K', model: probe });
      return { ok: true, model: img.model, bytes: img.buffer.length, mime: img.mime, usd: img.usd, costNote: `This test cost about $${priceUsd(probe, '1K').toFixed(4)}.` };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'Request failed' };
    } finally {
      // Restore exactly — including the "was unset" case, which assigning '' would not.
      if (typed) { if (prev === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prev; }
    }
  });
}
