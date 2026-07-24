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
import { isStaff } from '../auth.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const VQ_USER = process.env.VIETQR_USERNAME || '';   // inbound: VietQR -> us
const VQ_PASS = process.env.VIETQR_PASSWORD || '';

// Outbound: us -> VietQR (Account API creds VietQR issued, for get-token/generate/test).
const VQ_API_BASE = (process.env.VIETQR_API_BASE || 'https://dev.vietqr.org').replace(/\/+$/, '');
const VQ_API_USER = process.env.VIETQR_API_USERNAME || '';
const VQ_API_PASS = process.env.VIETQR_API_PASSWORD || '';
async function vqOutboundToken() {
  if (!VQ_API_USER || !VQ_API_PASS) throw new Error('Server missing VIETQR_API_USERNAME / VIETQR_API_PASSWORD');
  const auth = Buffer.from(VQ_API_USER + ':' + VQ_API_PASS).toString('base64');
  const r = await fetch(VQ_API_BASE + '/vqr/api/token_generate', { method: 'POST', headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('VietQR get-token failed: ' + (d.message || ('HTTP ' + r.status)));
  return d.access_token;
}

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

      // Credit (money in): mark a matched order paid, AND auto-approve any pending
      // wallet top-up whose reference note is inside the transfer content. This is
      // what makes a real payment land → auto-confirm with no admin action.
      if (String(b.transType || 'C').toUpperCase() === 'C') {
        if (matched) await q('update orders set paid=true, paid_at=now() where id=$1', [matched]).catch(() => {});
        // Show the bank's reference number (what the payer sees on their bank
        // screen, e.g. 6156…) as the transaction id — fall back to VietQR's id.
        const bankRef = String(b.referencenumber || '').trim() || txid;
        // Auto-approve any pending top-up whose reference note is inside the transfer
        // content, AND credit that seller's wallet — a direct status flip alone left
        // the balance untouched (the credit only lived in the admin-confirm route),
        // so real VietQR payments were never recorded. Idempotent by (account,type,ref).
        // Auto-approval is now bounded by what the bank ACTUALLY sent.
        //
        // This used to be a blanket UPDATE that flipped every pending row whose ref was a
        // substring of the transfer content, then credited `rec.amount_usd` — the figure
        // the SELLER typed when creating the request. The received amount was stored and
        // never compared, so declaring a $5,000 top-up and wiring 10,000₫ (~$0.39) with
        // the right note credited the full $5,000 in spendable balance. Two more holes
        // rode along: a very short ref substring-matched a STRANGER's transfer, and
        // `returning *` over an unfiltered UPDATE let ONE transfer approve MANY pending
        // rows at once.
        //
        // Rules now: candidates are read first (not blind-updated), the ref must be a
        // meaningful length, the received amount must cover the declared amount, and at
        // most ONE request is settled per transaction — the closest match by amount.
        // Anything short, ambiguous, or unmatched stays pending for a human, which is the
        // same "suggest, a human confirms" line the rest of the system draws around money.
        const received = Number(b.amount) || 0;
        const cands = (await q(
          `select * from topup_requests
             where status='pending' and ref is not null and length(ref) >= 6
               and $1 ilike '%'||ref||'%'
             order by created_at asc`, [content]
        ).catch(() => ({ rows: [] }))).rows || [];
        // Tolerance for bank rounding / fees, not for underpayment: 1% or 2,000₫.
        const covers = (rec) => {
          const want = Number(rec.vnd) || 0;
          if (!want) return false;                       // no declared VND → cannot verify
          return received >= want - Math.max(2000, want * 0.01);
        };
        const eligible = cands.filter(covers);
        const rec = eligible.length
          ? eligible.reduce((best, r) =>
              Math.abs(received - Number(r.vnd)) < Math.abs(received - Number(best.vnd)) ? r : best)
          : null;
        if (rec) {
          const upd = await q(
            "update topup_requests set status='received', confirmed_at=now(), txn_id=$2 where id=$1 and status='pending' returning *",
            [rec.id, bankRef]
          ).catch(() => ({ rows: [] }));
          const row = (upd.rows || [])[0];
          if (row && row.seller_id) {
            await q(
              `insert into wallet_ledger (account, delta, type, ref, note, created_by)
               values ($1,$2,'topup',$3,$4,null) on conflict do nothing`,
              [row.seller_id, Number(row.amount_usd) || 0, String(row.id), (row.method ? row.method + ' top-up' : 'VietQR top-up')]
            ).catch(() => {});
          }
        } else if (cands.length) {
          // Matched a reference but the money doesn't cover it. Deliberately left pending
          // and logged rather than part-credited: a human decides whether it was a
          // partial payment, a fee, or someone probing.
          app.log.warn({ received, refs: cands.map((c) => c.ref), candidates: cands.length },
            'vietqr: transfer matched a pending top-up but did not cover the declared amount — left for manual review');
        }
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
    // A short ref substring-matches half the table, so this poll used to hand any seller
    // someone else's transfer (and its bank account) just by asking for ref=1. Refs are
    // EG + 6 digits; anything shorter cannot be a real one, so refuse rather than guess.
    if (ref.length < 6) return { paid: false };
    // Match an order (matched_order/order_id) OR a top-up reference embedded in the
    // transfer content (addInfo) — wallet top-ups carry a code, not an order id.
    const r = await q(
      "select * from vietqr_transactions where (matched_order=$1 or order_id=$1 or content ilike '%'||$1||'%') and upper(coalesce(trans_type,'C'))='C' order by created_at desc limit 1",
      [ref]
    );
    const t = r.rows[0];
    // Only the fields the poll actually needs. `select *` handed the caller the payer's
    // bank account number and reference number, which is nobody's business but the
    // account holder's and staff's — and the ref match is a substring, so a near-miss
    // could surface a stranger's row.
    return {
      paid: !!t,
      transaction: t ? { amount: t.amount, created_at: t.created_at, matched_order: t.matched_order } : null,
    };
  });
  // Recent transactions for an admin payments view. STAFF ONLY — this returns other
  // sellers' bank account numbers, amounts and transfer memos, and was reachable by any
  // signed-in seller despite the comment saying "admin".
  app.get('/api/vietqr/transactions', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    const r = await q('select transactionid, referencenumber, bankaccount, amount, trans_type, content, matched_order, created_at from vietqr_transactions order by created_at desc limit 100');
    return r.rows;
  });

  // ── Admin-set USD→VND exchange rate (shared across all sellers) ──────────────
  q(`create table if not exists settings (key text primary key, value text, updated_at timestamptz default now())`).catch(() => {});
  // Sensible starter tiers so bulk pricing SHOWS out of the box (each a small discount off
  // the base rate). Admin can edit or clear them; an explicit empty list is respected.
  const defaultTiers = (rate) => [
    { usd: 2000, rate: Math.max(1, rate - 500) },
    { usd: 5000, rate: Math.max(1, rate - 1000) },
    { usd: 10000, rate: Math.max(1, rate - 1500) },
  ];
  // Read the admin-set volume tiers ({usd, rate}[], a better VND/$1 the more you add).
  // Stored as a JSON string alongside the base rate; tolerant of a jsonb column too.
  // Returns null when NEVER configured (→ caller uses defaults) vs [] when set to empty.
  async function readTiers() {
    try {
      const tr = await q("select value from settings where key='vqr_tiers'");
      if (!tr.rows[0]) return null;
      let raw = tr.rows[0].value;
      if (typeof raw === 'string') raw = JSON.parse(raw);
      if (!Array.isArray(raw)) return [];
      return raw.map((t) => ({ usd: Number(t.usd) || 0, rate: Number(t.rate) || 0 })).filter((t) => t.usd > 0 && t.rate > 0).sort((a, c) => a.usd - c.usd);
    } catch { return null; }
  }
  // Effective tiers: what a seller/admin should see — stored ones, or defaults if untouched.
  async function effectiveTiers(rate) {
    const stored = await readTiers();
    return stored === null ? defaultTiers(rate) : stored;
  }
  app.get('/api/vietqr/rate', { preHandler: requireAuth }, async () => {
    const r = await q("select value from settings where key='vqr_rate'");
    const rate = r.rows[0] && Number(r.rows[0].value) > 0 ? Number(r.rows[0].value) : 25400;
    return { rate, tiers: await effectiveTiers(rate) };
  });
  app.put('/api/vietqr/rate', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'Admin only — only an admin can set the exchange rate' }; }
    const b = req.body || {};
    const rate = Math.round(Number(b.rate) || 0);
    if (!rate || rate <= 0) { reply.code(400); return { error: 'Invalid rate' }; }
    await q("insert into settings (key,value,updated_at) values ('vqr_rate',$1,now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [String(rate)]);
    if (Array.isArray(b.tiers)) {
      const clean = b.tiers.map((t) => ({ usd: Math.round(Number(t.usd) || 0), rate: Math.round(Number(t.rate) || 0) }))
        .filter((t) => t.usd > 0 && t.rate > 0).sort((a, c) => a.usd - c.usd);
      await q("insert into settings (key,value,updated_at) values ('vqr_tiers',$1,now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [JSON.stringify(clean)]);
    }
    return { ok: true, rate, tiers: await effectiveTiers(rate) };
  });

  // ── Mint a VA-backed payment QR (production-reliable callbacks) ──────────────
  //   Instead of a generic img.vietqr.io transfer QR, we ask VietQR to generate a
  //   QR tied to a virtual account it MONITORS. A payment to that VA is guaranteed
  //   to fire the transaction-sync callback → the wallet auto-credits. The receiving
  //   account is our linked bank account (env VIETQR_BANK_*). Returns the QR string
  //   (qrCode), an optional image link (qrLink), the VA, and the full content the
  //   poll should match on.  Body: { amount: <VND>, note: <our ref/addInfo> }
  app.post('/api/vietqr/create-payment', { preHandler: requireAuth }, async (req, reply) => {
    const body = req.body || {};
    const amount = Math.round(Number(body.amount) || 0);
    if (!amount || amount < 1000) { reply.code(400); return { error: 'Invalid amount (VND)' }; }
    // Human-readable reference WE control: EG + zero-padded sequential number
    // (e.g. EG000007). Alphanumeric so it survives the bank memo; this is the key
    // that links the seller's wallet, the admin ledger, and the bank transfer.
    let note;
    try {
      const seqRow = await q(
        "insert into settings (key,value,updated_at) values ('topup_seq','1',now()) " +
        "on conflict (key) do update set value=(settings.value::int + 1)::text, updated_at=now() returning value"
      );
      note = 'EG' + String(parseInt(seqRow.rows[0].value, 10)).padStart(6, '0');
    } catch (e) {
      note = String(body.note || ('EG' + Date.now().toString(36))).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 23);
    }
    const bankCode = process.env.VIETQR_BANK_CODE || 'BIDV';
    const account  = process.env.VIETQR_BANK_ACCOUNT || '1231255899';
    const name     = process.env.VIETQR_ACCOUNT_NAME || 'PHAN MY LINH';
    let token;
    try { token = await vqOutboundToken(); }
    catch (e) { reply.code(502); return { error: 'VietQR auth failed: ' + e.message }; }
    const orderId = ('EG' + Date.now().toString(36)).toUpperCase().slice(0, 13);
    try {
      const gr = await fetch(VQ_API_BASE + '/vqr/api/qr/generate-customer', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankCode, bankAccount: account, userBankName: name, content: note, amount, orderId, qrType: 0, transType: 'C' })
      });
      const gd = await gr.json().catch(() => ({}));
      if (!gr.ok) { reply.code(502); return { error: 'VietQR generate failed: ' + JSON.stringify(gd).slice(0, 300) }; }
      // ONLY record a pending top-up when there is a scannable code to pay. A missing QR
      // means the seller can't pay, so a pending row would just be an orphan the admin
      // has to reject — return the error instead and write nothing.
      if (!gd.qrCode && !gd.qrLink) { reply.code(502); return { error: 'VietQR returned no scannable code — nothing was recorded. Check the VietQR keys.' }; }
      // Record a PENDING top-up keyed by our ref (note) BEFORE the seller pays, so the
      // transaction-sync callback can match content→ref, flip it to received, and credit
      // the seller's wallet. Without this row a real VietQR payment lands untracked.
      let rate = 25400;
      try { const rr = await q("select value from settings where key='vqr_rate'"); const n = rr.rows[0] ? Number(rr.rows[0].value) : 0; if (n > 0) rate = n; } catch { /* default rate */ }
      // The credited USD is ALWAYS derived here from the VND that will be paid — never
      // trusted from the client — so nobody can pay a little VND and claim a big credit.
      // Volume tiers give a better (lower) VND/$1 the more you add: the applicable rate is
      // the highest tier whose cost the payment covers.
      const tiers = await effectiveTiers(rate);   // ascending by usd
      let applicable = rate;
      for (let i = tiers.length - 1; i >= 0; i--) { if (amount >= tiers[i].usd * tiers[i].rate) { applicable = tiers[i].rate; break; } }
      const amountUsd = Math.round((amount / applicable) * 100) / 100;
      try {
        await q(
          `insert into topup_requests (seller_id, seller_email, amount_usd, vnd, ref, method, status)
           values ($1,$2,$3,$4,$5,'VietQR','pending')`,
          [req.user.sub, req.user.email || null, amountUsd, amount, note]
        );
      } catch (e) { req.log?.warn?.({ err: String(e) }, 'vietqr pending topup insert failed'); }
      return {
        ok: true,
        amountUsd,                           // credited USD once paid (VND ÷ rate)
        content: gd.content || note,        // full addInfo (may carry VietQR's VA prefix)
        note,                                // our ref — what the wallet polls on
        qrCode: gd.qrCode || '',             // EMVCo QR string (render client-side)
        qrLink: gd.qrLink || gd.imgId || '', // optional ready-made image URL
        vaAccount: gd.vaAccount || account,
        bankCode, account, name, amount,
        transactionRefId: gd.transactionRefId || '',
        fields: Object.keys(gd)              // diagnostic: what VietQR actually returned
      };
    } catch (e) { reply.code(502); return { error: 'VietQR generate error: ' + e.message }; }
  });

  // ── Self-test: run VietQR's 3-step sandbox flow (get-token → generate QR →
  //    test-callback) and confirm the callback reached our transaction-sync. Staff only.
  //    Usage: /api/vietqr/selftest?bankCode=MB&account=0369053640&name=LE THI MAI HUONG&amount=10000
  app.get('/api/vietqr/selftest', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }
    const qy = req.query || {};
    const out = { base: VQ_API_BASE };
    let token;
    try { token = await vqOutboundToken(); out.step1_getToken = 'ok'; }
    catch (e) { out.step1_getToken = 'FAILED: ' + e.message; return out; }

    const bankCode = qy.bankCode, account = qy.account, name = qy.name || 'EGFULFILL';
    const amount = Number(qy.amount) || 10000;
    if (!bankCode || !account) { out.note = 'Pass ?bankCode=MB&account=0369053640&name=LE THI MAI HUONG&amount=10000'; return out; }

    const ts = Date.now().toString().slice(-8);
    const content = 'EGTEST' + ts;          // ≤23, alnum, no special chars
    const orderId = 'EG' + ts;              // ≤13
    let genContent = content;
    try {
      const gr = await fetch(VQ_API_BASE + '/vqr/api/qr/generate-customer', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankCode, bankAccount: account, userBankName: name, content, amount, orderId, qrType: 0, transType: 'C' })
      });
      const gd = await gr.json().catch(() => ({}));
      if (!gr.ok) { out.step2_generate = 'FAILED: ' + JSON.stringify(gd).slice(0, 300); return out; }
      genContent = gd.content || content;
      out.step2_generate = { ok: true, content: genContent, vaAccount: gd.vaAccount, transactionRefId: gd.transactionRefId };
    } catch (e) { out.step2_generate = 'FAILED: ' + e.message; return out; }

    try {
      const cr = await fetch(VQ_API_BASE + '/vqr/bank/api/test/transaction-callback', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccount: account, content: genContent, amount, bankCode, transType: 'C' })
      });
      const cd = await cr.json().catch(() => ({}));
      out.step3_testCallback = cr.ok ? Object.assign({ ok: true }, cd) : ('FAILED: ' + JSON.stringify(cd).slice(0, 300));
    } catch (e) { out.step3_testCallback = 'FAILED: ' + e.message; return out; }

    // VietQR posts to our transaction-sync asynchronously — wait, then check our DB.
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const rr = await q("select transactionid, amount, content, created_at from vietqr_transactions where content ilike '%'||$1||'%' order by created_at desc limit 1", [genContent]);
      out.recordedInOurDB = rr.rows[0] || 'NOT FOUND YET — VietQR accepted the callback but we have not received the transaction-sync POST. Check the connection is approved + our callback URL (https://egful.store/vqr) is registered.';
    } catch (e) { out.recordedInOurDB = 'check failed: ' + e.message; }
    return out;
  });
}
