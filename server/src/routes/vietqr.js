// VietQR auto-reconciliation ("Nhận biến động số dư" / Transaction Sync).
//
// VietQR calls OUR server when money lands in the linked bank account:
//   1) POST /vqr/api/token_generate         — Basic Auth (the username/password we
//      registered on the VietQR portal) → we return a short-lived Bearer token.
//   2) POST /vqr/bank/api/transaction-sync  — VietQR posts each transaction with
//      that Bearer token; we record it, try to match an order, and ACK.
//
// Plus, for our own UI:
//   GET /api/vietqr/status?ref=<orderId>    — has a matching credit arrived? (poll)
//   GET /api/vietqr/transactions            — recent transactions (staff)
//
// .env:  VIETQR_USERNAME=...  VIETQR_PASSWORD=...   (the creds you type into the
// VietQR portal's "Username/Password khách hàng cung cấp" fields).
import jwt from 'jsonwebtoken';
import { q } from '../db.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const VQ_USER = process.env.VIETQR_USERNAME || '';
const VQ_PASS = process.env.VIETQR_PASSWORD || '';

function basicOk(req) {
  const m = (req.headers.authorization || '').match(/^Basic\s+(.+)$/i);
  if (!m || !VQ_USER || !VQ_PASS) return false;
  let dec = '';
  try { dec = Buffer.from(m[1], 'base64').toString('utf8'); } catch (e) { return false; }
  const i = dec.indexOf(':');
  return i > 0 && dec.slice(0, i) === VQ_USER && dec.slice(i + 1) === VQ_PASS;
}
function bearerOk(req) {
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  try { const d = jwt.verify(m[1], SECRET); return !!d && d.sub === 'vietqr'; } catch (e) { return false; }
}

export function vietqrRoutes(app, requireAuth) {
  // Record of every transaction VietQR pushes (idempotent by transactionid).
  q(`create table if not exists vietqr_transactions (
       transactionid   text primary key,
       referencenumber text,
       bankaccount     text,
       amount          bigint,
       trans_type      text,
       content         text,
       order_id        text,
       matched_order   text,
       raw             jsonb,
       created_at      timestamptz default now())`).catch(() => {});
  q('alter table orders add column if not exists paid boolean not null default false').catch(() => {});
  q('alter table orders add column if not exists paid_at timestamptz').catch(() => {});

  // 1) Get Token — VietQR authenticates with Basic Auth, we return a Bearer token.
  app.post('/vqr/api/token_generate', async (req, reply) => {
    if (!basicOk(req)) { reply.code(401); return { status: 401, message: 'Unauthorized' }; }
    const access_token = jwt.sign({ sub: 'vietqr' }, SECRET, { expiresIn: 300 });
    return { access_token, token_type: 'Bearer', expires_in: 300 };
  });

  // 2) Transaction Sync — VietQR posts each balance change here.
  async function handleSync(req, reply) {
    if (!bearerOk(req)) { reply.code(401); return { error: true, errorReason: '401', toastMessage: 'Invalid token', object: null }; }
    const b = req.body || {};
    const txid = String(b.transactionid || '').trim();
    if (!txid) { reply.code(400); return { error: true, errorReason: '400', toastMessage: 'Missing transactionid', object: null }; }
    try {
      // Idempotency — VietQR retries; never double-process a transaction id.
      const ex = await q('select transactionid from vietqr_transactions where transactionid=$1', [txid]);
      if (ex.rows.length) return { error: false, errorReason: null, toastMessage: 'Already processed', object: { reftransactionid: txid } };

      // Match an order: explicit orderId field first, else an order id found inside
      // the transfer content (addInfo). Longest id match wins to avoid false hits.
      const content = String(b.content || '');
      const cand = String(b.orderId || '').trim();
      let matched = null;
      if (cand) { const r = await q('select id from orders where id=$1', [cand]); if (r.rows.length) matched = cand; }
      if (!matched && content) {
        const r = await q("select id from orders where $1 ilike '%'||id||'%' order by length(id) desc limit 1", [content]);
        if (r.rows.length) matched = r.rows[0].id;
      }

      await q(
        `insert into vietqr_transactions (transactionid, referencenumber, bankaccount, amount, trans_type, content, order_id, matched_order, raw)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (transactionid) do nothing`,
        [txid, b.referencenumber || null, b.bankaccount || null, Number(b.amount) || 0, b.transType || null, content || null, cand || null, matched, JSON.stringify(b)]
      );

      // Credit (money in) + matched order → mark it paid.
      if (String(b.transType || 'C').toUpperCase() === 'C' && matched) {
        await q('update orders set paid=true, paid_at=now() where id=$1', [matched]).catch(() => {});
      }
      return { error: false, errorReason: null, toastMessage: 'OK', object: { reftransactionid: txid } };
    } catch (e) {
      reply.code(400); return { error: true, errorReason: '500', toastMessage: e.message, object: null };
    }
  }
  // Register the documented path plus common aliases (test env / "callback" naming).
  ['/vqr/bank/api/transaction-sync', '/vqr/bank/api/transaction-callback',
   '/vqr/bank/api/test/transaction-sync', '/vqr/bank/api/test/transaction-callback']
    .forEach((p) => app.post(p, handleSync));

  // ── Our UI ──────────────────────────────────────────────────────────────────
  // Poll: has a credit transaction matching this order/reference arrived?
  app.get('/api/vietqr/status', { preHandler: requireAuth }, async (req) => {
    const ref = String((req.query && req.query.ref) || '').trim();
    if (!ref) return { paid: false };
    // Match an order (matched_order/order_id) OR a top-up reference embedded in the
    // transfer content (addInfo) — wallet top-ups carry a code, not an order id.
    const r = await q(
      "select * from vietqr_transactions where (matched_order=$1 or order_id=$1 or content ilike '%'||$1||'%') and upper(coalesce(trans_type,'C'))='C' order by created_at desc limit 1",
      [ref]
    );
    const t = r.rows[0];
    return { paid: !!t, transaction: t || null };
  });
  // Recent transactions for an admin payments view.
  app.get('/api/vietqr/transactions', { preHandler: requireAuth }, async () => {
    const r = await q('select transactionid, referencenumber, bankaccount, amount, trans_type, content, matched_order, created_at from vietqr_transactions order by created_at desc limit 100');
    return r.rows;
  });

  // ── Admin-set USD→VND exchange rate (shared across all sellers) ──────────────
  q(`create table if not exists settings (key text primary key, value text, updated_at timestamptz default now())`).catch(() => {});
  app.get('/api/vietqr/rate', { preHandler: requireAuth }, async () => {
    const r = await q("select value from settings where key='vqr_rate'");
    const rate = r.rows[0] ? Number(r.rows[0].value) : 0;
    return { rate: rate > 0 ? rate : 25400 };
  });
  app.put('/api/vietqr/rate', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'Admin only — only an admin can set the exchange rate' }; }
    const rate = Math.round(Number((req.body || {}).rate) || 0);
    if (!rate || rate <= 0) { reply.code(400); return { error: 'Invalid rate' }; }
    await q("insert into settings (key,value,updated_at) values ('vqr_rate',$1,now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [String(rate)]);
    return { ok: true, rate };
  });
}
