// support_ai.js — account-aware AI auto-reply for the seller Support chat.
//
// A seller posts to their support thread (order_messages under `support-<sellerId>`);
// the client then calls POST /api/support/ai-reply. We load the recent conversation
// plus that seller's REAL orders + wallet balance, ask Claude (Haiku) for a concise,
// grounded reply, and insert it back into the thread as role 'assistant'. The chat
// page polls, so the answer just appears. No side effects beyond one message row.
//
// Requires ANTHROPIC_API_KEY in the server env. If it's missing the route is a no-op
// ({ ok:false, disabled:true }) so nothing breaks — the human-support flow still works.

import crypto from 'node:crypto';
import { q } from '../db.js';

const KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.SUPPORT_AI_MODEL || 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';

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
    const bal = Number(b.rows[0]?.bal || 0);
    lines.push(`Wallet balance: $${bal.toFixed(2)}.`);
  } catch { /* wallet unavailable */ }
  return lines.join('\n');
}

// Map the stored thread into alternating Claude messages (seller=user, others=assistant),
// merging consecutive same-role turns so the API always sees clean alternation.
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
  // Claude requires the first message to be a user turn.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export function supportAiRoutes(app, requireAuth) {
  app.post('/api/support/ai-reply', { preHandler: requireAuth }, async (req, reply) => {
    if (!KEY) return { ok: false, disabled: true };
    const sellerId = req.user.sub;
    const threadId = 'support-' + sellerId;

    const hist = await q(
      `select sender_role, body from order_messages
         where order_id=$1 order by created_at asc, id asc limit 20`, [threadId]);
    const messages = toMessages(hist.rows);
    if (!messages.length) return { ok: false, empty: true };
    // Only answer when the seller spoke last (avoid double-replying to our own message).
    if (messages[messages.length - 1].role !== 'user') return { ok: true, skipped: true };

    let text = '';
    try {
      const ctx = await accountContext(sellerId);
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 600,
          system: SYSTEM + '\n\nACCOUNT DATA (for this seller only):\n' + ctx,
          messages,
        }),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        req.log?.warn?.({ status: r.status, detail }, 'support-ai upstream error');
        reply.code(502);
        return { ok: false, error: 'AI service error' };
      }
      const data = await r.json();
      text = (Array.isArray(data.content) ? data.content : [])
        .filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    } catch (e) {
      req.log?.warn?.({ err: String(e) }, 'support-ai request failed');
      reply.code(502);
      return { ok: false, error: 'AI service unavailable' };
    }
    if (!text) return { ok: false, empty: true };

    const clientId = 'ai-' + crypto.randomBytes(8).toString('hex');
    const meta = { by: 'EGFULFILL Assistant', ai: true, ts: Date.now() };
    await q(
      `insert into order_messages (order_id, sender_id, sender_role, body, meta, client_id)
       values ($1,$2,$3,$4,$5,$6) on conflict (client_id) where client_id is not null do nothing`,
      [threadId, 'assistant', 'assistant', text, JSON.stringify(meta), clientId]);
    return { ok: true, reply: text };
  });
}
