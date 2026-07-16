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

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// Selectable models for the admin dropdown (id must be a valid Anthropic model id).
const AI_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fast & low cost (recommended)' },
  { id: 'claude-sonnet-5',          label: 'Claude Sonnet 5 — balanced' },
  { id: 'claude-opus-4-8',          label: 'Claude Opus 4.8 — most capable' },
];

let _settingsReady = null;
function ensureSettings() {
  if (_settingsReady) return _settingsReady;
  _settingsReady = q(`create table if not exists settings (key text primary key, value text, updated_at timestamptz default now())`)
    .catch((e) => { _settingsReady = null; throw e; });
  return _settingsReady;
}

// Resolve the effective AI config: DB settings first, then env, then defaults.
async function aiConfig() {
  let key = '', model = '';
  try {
    await ensureSettings();
    const r = await q("select key, value from settings where key in ('support_ai_key','support_ai_model')");
    for (const row of r.rows) {
      // settings.value is jsonb (schema.sql) — pg returns a JS string for a JSON string.
      if (row.key === 'support_ai_key') key = String(row.value ?? '').trim();
      if (row.key === 'support_ai_model') model = String(row.value ?? '').trim();
    }
  } catch { /* settings unavailable → env fallback */ }
  key = key || (process.env.ANTHROPIC_API_KEY || '').trim();
  model = model || (process.env.SUPPORT_AI_MODEL || '').trim() || DEFAULT_MODEL;
  const fromEnv = !!(process.env.ANTHROPIC_API_KEY || '').trim();
  return { key, model, fromEnv };
}

// Seller-friendly status label from the factory status (mirrors the front-end SELLER_STATUS).
function sellerStatus(o) {
  const s = String(o.factory_status || o.status || 'new').toLowerCase();
  if (['shipped', 'fulfilled', 'delivered'].includes(s)) return 'Shipped';
  if (['packed', 'label', 'labelled', 'ready'].includes(s)) return 'Packed';
  if (['queued', 'printing', 'production', 'in_production', 'prepress', 'qc', 'printed'].includes(s)) return 'In production';
  if (['cancelled', 'canceled', 'refunded'].includes(s)) return 'Cancelled';
  if (['hold', 'issue', 'attention', 'exception'].includes(s)) return 'Needs attention';
  return 'Received';
}

const SYSTEM = `You are the EGFULFILL support assistant. EGFULFILL is a print-on-demand fulfillment platform for online sellers (Etsy/Shopify/etc.). You help sellers with orders, fulfillment status, shipping, billing/wallet top-ups (VietQR, card, or manual transfer), store connections, plans (Starter/Pro/Enterprise + SpyDeck research add-on), and the developer API sandbox.

Rules:
- Be concise, warm, and practical. 1–3 short paragraphs, no filler.
- Use ONLY the ACCOUNT DATA provided for anything about a specific order, status, tracking, or balance. Never invent order numbers, tracking codes, dates, or amounts.
- If the answer needs info you don't have, say you've flagged it for a human teammate who will follow up here.
- For "where is my order?" cite the order's status label and tracking if present.
- Don't claim to have taken actions (refunds, cancellations, shipping changes) — you can explain how, or say you've passed it to the team.`;

// Build a compact ACCOUNT DATA block for the system prompt.
async function accountContext(sellerId) {
  const lines = [];
  try {
    const o = await q(
      `select id, seq, factory_status, status, total, tracking, carrier, created_at
         from orders where seller_id=$1 order by created_at desc limit 15`, [sellerId]);
    if (o.rows.length) {
      lines.push('Recent orders (newest first):');
      for (const r of o.rows) {
        const num = r.seq ? `#${r.seq}` : r.id;
        const track = r.tracking ? `, tracking ${r.carrier || ''} ${r.tracking}`.trim() : '';
        const total = r.total != null ? `, $${Number(r.total).toFixed(2)}` : '';
        lines.push(`- ${num}: ${sellerStatus(r)}${total}${track}`);
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
    const text = String(m.body || '').trim();
    if (!text) continue;
    const role = (m.sender_role === 'seller') ? 'user' : 'assistant';
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

async function generateReply(key, model, sellerId, messages) {
  const ctx = await accountContext(sellerId);
  const body = JSON.stringify({ model, max_tokens: 600, system: SYSTEM + '\n\nACCOUNT DATA (for this seller only):\n' + ctx, messages });
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };

  let r, detail = '';
  // Anthropic 529 (overloaded) / 429 (rate limit) are transient — retry a few times with backoff.
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

export function supportAiRoutes(app, requireAuth, requireStaff) {
  // ── Staff: DRAFT a reply for a seller's support thread (does NOT post it) ─────
  app.post('/api/support/ai-draft', { preHandler: requireStaff }, async (req, reply) => {
    const { key, model } = await aiConfig();
    if (!key) return { ok: false, disabled: true };
    const threadId = String((req.body && req.body.threadId) || '');
    if (threadId.indexOf('support-') !== 0) { reply.code(400); return { error: 'threadId must be a support-* thread' }; }
    const sellerId = threadId.slice('support-'.length);
    const hist = await q(`select sender_role, body from order_messages where order_id=$1 order by created_at asc, id asc limit 20`, [threadId]);
    const messages = toMessages(hist.rows);
    if (!messages.length) return { ok: false, empty: true };
    try {
      const draft = await generateReply(key, model, sellerId, messages);
      if (!draft) return { ok: false, empty: true };
      return { ok: true, draft };
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
  app.get('/api/admin/ai-config', { preHandler: requireStaff }, async () => {
    const cfg = await aiConfig();
    return {
      keySet: !!cfg.key,
      last4: cfg.key ? cfg.key.slice(-4) : null,
      fromEnv: cfg.fromEnv,        // true if the active key comes from the env (can't be cleared here)
      model: cfg.model,
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
    return { ok: true, keySet: !!cfg.key, last4: cfg.key ? cfg.key.slice(-4) : null, fromEnv: cfg.fromEnv, model: cfg.model };
  });

  // ── The seller-facing auto-reply ─────────────────────────────────────────────
  app.post('/api/support/ai-reply', { preHandler: requireAuth }, async (req, reply) => {
    const { key, model } = await aiConfig();
    if (!key) return { ok: false, disabled: true };
    const sellerId = req.user.sub;
    const threadId = 'support-' + sellerId;

    const hist = await q(
      `select sender_role, body from order_messages
         where order_id=$1 order by created_at asc, id asc limit 20`, [threadId]);
    const messages = toMessages(hist.rows);
    if (!messages.length) return { ok: false, empty: true };
    if (messages[messages.length - 1].role !== 'user') return { ok: true, skipped: true };

    let text = '';
    try {
      text = await generateReply(key, model, sellerId, messages);
    } catch (e) {
      // Return 200 with the reason (not a 5xx) so the client shows WHY instead of throwing.
      req.log?.warn?.({ err: String(e), detail: e.detail }, 'support-ai request failed');
      return { ok: false, error: e.message || 'AI service unavailable' };
    }
    if (!text) return { ok: false, empty: true };

    const clientId = 'ai-' + crypto.randomBytes(8).toString('hex');
    const meta = { by: 'EGFULFILL Assistant', ai: true, ts: Date.now() };
    await q(
      `insert into order_messages (order_id, sender_id, sender_role, body, meta, client_id)
       values ($1,$2,$3,$4,$5,$6) on conflict (client_id) where client_id is not null do nothing`,
      // sender_id is uuid references users(id) — the assistant is not a user row, so NULL (role/meta carry identity).
      [threadId, null, 'assistant', text, JSON.stringify(meta), clientId]);
    return { ok: true, reply: text };
  });
}
