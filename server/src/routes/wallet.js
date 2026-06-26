// Wallet / balance — SERVER source of truth. Balances used to live only in the
// browser's localStorage (eg_balance, eg_factory_balance, eg_designer_balance),
// so a refresh or a different device showed a stale / reset number. Now every
// money movement is an append-only ledger row; the balance is SUM(delta) per
// account. localStorage stays as an optimistic cache that reconciles from here
// on every page load.
//
//   account = a seller's user id  → that seller's wallet
//   account = 'factory'           → shared factory wallet (admin + warehouse)
//   account = 'designer'          → designer payable wallet
//
// Idempotency: (account, type, ref) is unique when ref is non-empty, so
// re-pushing the same charge / top-up / refund (retry, double-click, two boards)
// never double-counts.
import { q } from '../db.js';
import { isStaff } from '../auth.js';

export function walletRoutes(app, requireAuth) {
  q(`create table if not exists wallet_ledger (
       id bigserial primary key,
       account     text not null,
       delta       numeric(12,2) not null,
       type        text not null default 'adjust',
       ref         text,
       note        text,
       created_by  text,
       created_at  timestamptz not null default now()
     )`).catch(() => {});
  // De-dupe key: same (account,type,ref) can only land once. Partial index so
  // many ref-less manual adjustments are still allowed.
  q(`create unique index if not exists wallet_ledger_dedupe
       on wallet_ledger (account, type, ref) where ref is not null and ref <> ''`).catch(() => {});
  q(`create index if not exists wallet_ledger_account on wallet_ledger (account, created_at desc)`).catch(() => {});

  // Which accounts may the caller touch?
  //  • a seller → only their OWN user id
  //  • staff    → any seller id, plus the shared 'factory' / 'designer' wallets
  function canAccess(user, account) {
    if (isStaff(user)) return true;
    return account === user.sub;
  }

  async function balanceOf(account) {
    const r = await q('select coalesce(sum(delta),0) as bal from wallet_ledger where account=$1', [account]);
    return parseFloat(r.rows[0].bal) || 0;
  }

  // GET balance + recent ledger. Seller → own; staff may pass ?account=.
  app.get('/api/wallet', { preHandler: requireAuth }, async (req, reply) => {
    const account = (req.query && req.query.account) ? String(req.query.account) : req.user.sub;
    if (!canAccess(req.user, account)) { reply.code(403); return { error: 'forbidden' }; }
    const bal = await balanceOf(account);
    const led = await q(
      `select id, delta, type, ref, note, created_by, created_at
         from wallet_ledger where account=$1 order by created_at desc, id desc limit 200`, [account]);
    return { account, balance: bal, ledger: led.rows };
  });

  // Append one ledger entry (idempotent by ref). Returns the new balance.
  app.post('/api/wallet/ledger', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    const account = b.account ? String(b.account) : req.user.sub;
    if (!canAccess(req.user, account)) { reply.code(403); return { error: 'forbidden' }; }
    const delta = parseFloat(b.delta);
    if (!isFinite(delta) || delta === 0) { reply.code(400); return { error: 'delta must be a non-zero number' }; }
    // Shared wallets (factory/designer) are staff-only to credit OR debit.
    if ((account === 'factory' || account === 'designer') && !isStaff(req.user)) {
      reply.code(403); return { error: 'staff only' };
    }
    const ref = (b.ref != null && b.ref !== '') ? String(b.ref) : null;
    // Idempotent insert: if (account,type,ref) already exists, do nothing and
    // just return the current balance (duplicate:true) — never double-charge.
    if (ref) {
      const dup = await q('select 1 from wallet_ledger where account=$1 and type=$2 and ref=$3',
        [account, b.type || 'adjust', ref]);
      if (dup.rowCount) { return { ok: true, duplicate: true, balance: await balanceOf(account) }; }
    }
    await q(
      `insert into wallet_ledger (account, delta, type, ref, note, created_by)
       values ($1,$2,$3,$4,$5,$6)
       on conflict do nothing`,
      [account, delta, b.type || 'adjust', ref, b.note || null, req.user.sub]);
    return { ok: true, balance: await balanceOf(account) };
  });

  // STAFF transfer between two wallets — the atomic two-sided move behind a
  // refund (factory → seller) or an admin balance adjustment. The seller side is
  // resolved SERVER-side (the client only knows a store name), so the credit
  // always lands on the right account:
  //   toOrderId → that order's seller_id   |   toEmail → that user's id   |   toAccount → as given
  // `amount` may be signed: +ve moves from→to, −ve reverses (debits the seller).
  // Idempotent by `ref` (same ref + same pair = one move, never doubled).
  app.post('/api/wallet/transfer', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    const b = req.body || {};
    const amount = parseFloat(b.amount);
    if (!isFinite(amount) || amount === 0) { reply.code(400); return { error: 'amount must be a non-zero number' }; }
    const from = b.fromAccount ? String(b.fromAccount) : 'factory';
    let to = b.toAccount ? String(b.toAccount) : null;
    if (!to && b.toOrderId) {
      const r = await q('select seller_id from orders where id=$1', [String(b.toOrderId)]);
      if (r.rows[0]) to = r.rows[0].seller_id;
    }
    if (!to && b.toEmail) {
      const r = await q('select id from users where lower(email)=lower($1)', [String(b.toEmail)]);
      if (r.rows[0]) to = r.rows[0].id;
    }
    if (!to) { reply.code(404); return { error: 'could not resolve the destination wallet (seller not found)' }; }
    if (to === from) { reply.code(400); return { error: 'source and destination are the same wallet' }; }
    const ref = (b.ref != null && b.ref !== '') ? String(b.ref) : null;
    const type = b.type || 'transfer';
    // Two idempotent rows tagged with the SAME ref but distinct types so the pair
    // is independently de-duped: '<type>-out' debits `from`, '<type>-in' credits `to`.
    const rows = [
      { account: from, delta: -amount, type: type + '-out' },
      { account: to,   delta:  amount, type: type + '-in'  },
    ];
    for (const row of rows) {
      if (ref) {
        const dup = await q('select 1 from wallet_ledger where account=$1 and type=$2 and ref=$3', [row.account, row.type, ref]);
        if (dup.rowCount) continue;
      }
      await q(
        `insert into wallet_ledger (account, delta, type, ref, note, created_by)
         values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
        [row.account, row.delta, row.type, ref, b.note || null, req.user.sub]);
    }
    return { ok: true, fromBalance: await balanceOf(from), toBalance: await balanceOf(to), toAccount: to };
  });
}
