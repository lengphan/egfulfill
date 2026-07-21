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
import { audit } from '../audit.js';

// Balance of one account = SUM(delta) over the append-only ledger. Exported so every
// caller reads money the same way (never a cached column that can drift).
export async function balanceOf(account) {
  const r = await q('select coalesce(sum(delta),0) as bal from wallet_ledger where account=$1', [String(account)]);
  return parseFloat(r.rows[0].bal) || 0;
}

// The atomic two-sided move behind EVERY money movement: an order charge, a refund,
// an admin adjustment. Extracted from the /transfer route so orders.js charges through
// this same path — one mechanism, one idempotency rule. The HTTP route is staff-only,
// but an order charge is seller-initiated, so the authorisation check belongs to the
// CALLER; this helper only moves money.
//
// Two rows share one `ref` under distinct types ('<type>-out' debits from, '<type>-in'
// credits to) so each side de-dupes independently against the (account,type,ref) unique
// index. Re-charging the same order id is therefore a no-op, not a double charge.
/**
 * HOUSE accounts — ours, not a customer's. These MAY go negative, and that's the point:
 * the factory wallet going below zero is how a loss becomes visible (a partner cost
 * booked before the revenue lands, a refund issued before a top-up clears). A house
 * balance is a P&L line.
 *
 * A SELLER wallet is prepaid and must never go negative. There's no credit relationship,
 * no invoicing and no collections — a negative seller balance is just an unrecoverable
 * debt that looks like a number.
 */
const HOUSE_ACCOUNTS = new Set(['factory', 'designer']);
export const isHouseAccount = (a) => HOUSE_ACCOUNTS.has(String(a));

export async function moveFunds({ from, to, amount, type = 'transfer', ref = null, note = null, by = null }) {
  const amt = parseFloat(amount);
  if (!isFinite(amt) || amt === 0) throw new Error('amount must be a non-zero number');
  if (String(from) === String(to)) throw new Error('source and destination are the same wallet');
  const r = ref != null && ref !== '' ? String(ref) : null;
  const rows = [
    { account: String(from), delta: -amt, type: type + '-out' },
    { account: String(to), delta: amt, type: type + '-in' },
  ];

  // Already applied? Then this is a retry, and re-checking the balance would refuse a
  // move that has in fact already happened.
  if (r) {
    const applied = await q(
      'select count(*)::int as n from wallet_ledger where ref=$1 and type = any($2)',
      [r, rows.map((x) => x.type)]
    ).then((x) => x.rows[0]?.n || 0).catch(() => 0);
    if (applied >= rows.length) return { fromBalance: await balanceOf(from), toBalance: await balanceOf(to), duplicate: true };
  }

  // Overdraft guard, enforced HERE rather than in each caller — callers checking by
  // convention is how a new code path eventually forgets. `amount` may be signed (the
  // transfer route documents a negative as a reversal), so the payer is whichever side
  // actually loses money.
  const payer = amt > 0 ? String(from) : String(to);
  if (!isHouseAccount(payer)) {
    const need = Math.abs(amt);
    const bal = await balanceOf(payer);
    if (bal < need) {
      const err = new Error(`Not enough balance — this costs $${need.toFixed(2)} and the wallet holds $${bal.toFixed(2)}.`);
      err.code = 'INSUFFICIENT_FUNDS';
      err.balance = bal;
      err.required = need;
      err.shortfall = Math.round((need - bal) * 100) / 100;
      throw err;
    }
  }

  for (const row of rows) {
    if (r) {
      const dup = await q('select 1 from wallet_ledger where account=$1 and type=$2 and ref=$3', [row.account, row.type, r]);
      if (dup.rowCount) continue;
    }
    await q(
      `insert into wallet_ledger (account, delta, type, ref, note, created_by)
       values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
      [row.account, row.delta, row.type, r, note, by]);
  }
  return { fromBalance: await balanceOf(from), toBalance: await balanceOf(to) };
}

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

  // Withdrawal requests — a PENDING payout a seller/staff asks for. It does NOT
  // debit the wallet on create (mirrors the top-up flow: money only moves once an
  // admin approves). On approve we append ONE negative wallet_ledger row
  // (type='withdrawal', ref='WD-<id>') so the balance = SUM(delta) drops then, and
  // the ref keeps it idempotent — re-approving the same row can never double-debit.
  q(`create table if not exists withdrawals (
       id bigserial primary key,
       account     text not null,        -- seller user id, or 'factory'/'designer'
       amount      numeric(12,2) not null,
       method      text,                 -- vietqr | paypal | pingpong | bank …
       dest        text,                 -- free-text payout destination (acct / email)
       requester   text,                 -- user id who asked
       requester_email text,
       status      text not null default 'pending',   -- pending | approved | rejected
       note        text,
       created_at  timestamptz not null default now(),
       resolved_at timestamptz,
       resolved_by text
     )`).catch(() => {});
  q(`create index if not exists withdrawals_account on withdrawals (account, created_at desc)`).catch(() => {});

  // Which accounts may the caller touch?
  //  • a seller → only their OWN user id
  //  • staff    → any seller id, plus the shared 'factory' / 'designer' wallets
  function canAccess(user, account) {
    if (isStaff(user)) return true;
    return account === user.sub;
  }

  /**
   * A team member's view of the OWNER's wallet — off unless the owner grants it.
   *
   * canAccess compares against the member's own id, so a member never saw the owner's
   * balance by default, which is the safe default. This is the opt-IN: the owner adds
   * 'wallet' to that member's permissions and they can read it. Spending stays the
   * owner's alone either way — visibility and authority are separate questions.
   *
   * Returns the owner id when the member may look, else null.
   */
  async function ownerWalletFor(user) {
    if (!user || isStaff(user)) return null;
    try {
      const r = await q(
        "select owner_id, permissions from team_members where lower(email)=lower($1) and status='active' limit 1",
        [user.email || '']);
      const row = r.rows[0];
      if (!row || !row.owner_id) return null;
      const perms = Array.isArray(row.permissions) ? row.permissions : [];
      return perms.indexOf('wallet') >= 0 ? String(row.owner_id) : null;
    } catch { return null; }
  }


  // GET balance + recent ledger. Seller → own; staff may pass ?account=.
  app.get('/api/wallet', { preHandler: requireAuth }, async (req, reply) => {
    let account = (req.query && req.query.account) ? String(req.query.account) : req.user.sub;
    // A member with the 'wallet' permission reads the OWNER's wallet — theirs is empty
    // and meaningless. Without it they stay on their own and see nothing.
    const shared = await ownerWalletFor(req.user);
    if (shared && account === req.user.sub) account = shared;
    if (!canAccess(req.user, account) && account !== shared) { reply.code(403); return { error: 'forbidden' }; }
    const bal = await balanceOf(account);
    const led = await q(
      `select id, delta, type, ref, note, created_by, created_at
         from wallet_ledger where account=$1 order by created_at desc, id desc limit 200`, [account]);
    return { account, balance: bal, ledger: led.rows };
  });

  // Append one ledger entry (idempotent by ref). Returns the new balance.
  // STAFF ONLY. This writes an arbitrary delta straight into the ledger, and canAccess
  // lets a non-staff caller pass for their OWN account — so any signed-in seller could
  // POST {delta: 10000} and credit themselves. Nothing in the app calls this: real money
  // moves through top-ups, refunds and transfers, which resolve their own accounts
  // server-side. Locked to staff, where an arbitrary adjustment is a legitimate tool.
  app.post('/api/wallet/ledger', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
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
    audit(req, 'wallet.ledger', { entityType: 'wallet', entityId: account, after: { delta, type: b.type || 'adjust', ref, note: b.note || null } });
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
    const { fromBalance, toBalance } = await moveFunds({
      from, to, amount, type, ref, note: b.note || null, by: req.user.sub });
    audit(req, 'wallet.transfer', { entityType: 'wallet', entityId: to, after: { from, to, amount, type, ref, note: b.note || null } });
    return { ok: true, fromBalance, toBalance, toAccount: to };
  });

  // ── Withdrawals ────────────────────────────────────────────────────────────
  // Rules (enforced here AND client-side): the wallet must hold at least $50, a
  // single request is capped at $500, and never more than the current balance.
  const WD_MIN_BAL = 50;
  const WD_MAX_REQ = 500;

  // Create a PENDING withdrawal. Does NOT debit — an admin must approve first.
  app.post('/api/wallet/withdraw', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    const account = b.account ? String(b.account) : req.user.sub;
    if (!canAccess(req.user, account)) { reply.code(403); return { error: 'forbidden' }; }
    // Moving money OUT is the account owner's call. A team member acts under the owner
    // elsewhere, but spending and withdrawing are the leader's alone.
    if (!isStaff(req.user)) {
      const owner = await q("select owner_id from team_members where lower(email)=lower($1) and status='active' limit 1", [req.user.email || ''])
        .then((r) => r.rows[0] && r.rows[0].owner_id).catch(() => null);
      if (owner) { reply.code(403); return { error: 'Only the account owner can withdraw. Ask them to make the request.' }; }
    }
    // Shared wallets (factory/designer) are staff-only.
    if ((account === 'factory' || account === 'designer') && !isStaff(req.user)) {
      reply.code(403); return { error: 'staff only' };
    }
    const amount = parseFloat(b.amount);
    if (!isFinite(amount) || amount <= 0) { reply.code(400); return { error: 'amount must be a positive number' }; }
    const bal = await balanceOf(account);
    if (bal < WD_MIN_BAL) { reply.code(400); return { error: `A minimum balance of $${WD_MIN_BAL.toFixed(2)} is required to withdraw` }; }
    if (amount > WD_MAX_REQ) { reply.code(400); return { error: `The maximum per request is $${WD_MAX_REQ.toFixed(2)}` }; }
    if (amount > bal) { reply.code(400); return { error: `Amount exceeds the available balance ($${bal.toFixed(2)})` }; }
    const r = await q(
      `insert into withdrawals (account, amount, method, dest, requester, requester_email, note, status)
       values ($1,$2,$3,$4,$5,$6,$7,'pending') returning *`,
      [account, amount, b.method || null, b.dest || null, req.user.sub, req.user.email || null, b.note || null]);
    audit(req, 'wallet.withdraw', { entityType: 'withdrawal', entityId: String(r.rows[0].id), after: { account, amount, method: b.method || null } });
    return { ok: true, withdrawal: r.rows[0], balance: bal };
  });

  // List withdrawals: sellers see only their OWN account; staff see all
  // (optional ?status=pending, ?account=factory).
  app.get('/api/wallet/withdrawals', { preHandler: requireAuth }, async (req) => {
    const st = req.query && req.query.status ? String(req.query.status) : null;
    if (isStaff(req.user)) {
      const acc = req.query && req.query.account ? String(req.query.account) : null;
      const where = [], args = [];
      if (st)  { args.push(st);  where.push(`status=$${args.length}`); }
      if (acc) { args.push(acc); where.push(`account=$${args.length}`); }
      const sql = `select * from withdrawals ${where.length ? 'where ' + where.join(' and ') : ''} order by created_at desc limit 200`;
      const r = await q(sql, args);
      return r.rows;
    }
    // Seller → own account only.
    if (st) {
      const r = await q('select * from withdrawals where account=$1 and status=$2 order by created_at desc limit 100', [req.user.sub, st]);
      return r.rows;
    }
    const r = await q('select * from withdrawals where account=$1 order by created_at desc limit 100', [req.user.sub]);
    return r.rows;
  });

  // Approve (staff only) → debit the wallet via ONE negative ledger row, idempotent
  // by ref='WD-<id>', and flip the request to 'approved'. The debit and the status
  // flip are both no-ops on a second call, so a double-click never double-pays.
  app.post('/api/wallet/withdrawals/:id/approve', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    const r = await q("select * from withdrawals where id=$1", [req.params.id]);
    const rec = r.rows[0];
    if (!rec) { reply.code(404); return { error: 'not found' }; }
    if (rec.status !== 'pending') { reply.code(409); return { error: 'already ' + rec.status }; }
    const ref = 'WD-' + rec.id;
    // Guard the balance again at approval time (it may have moved since the request).
    const bal = await balanceOf(rec.account);
    const amount = Number(rec.amount) || 0;
    if (amount > bal) { reply.code(400); return { error: `Amount exceeds the available balance ($${bal.toFixed(2)})` }; }
    await q(
      `insert into wallet_ledger (account, delta, type, ref, note, created_by)
       values ($1,$2,'withdrawal',$3,$4,$5) on conflict do nothing`,
      [rec.account, -amount, ref, (rec.method ? rec.method + ' withdrawal' : 'Wallet withdrawal'), req.user.sub]);
    const upd = await q(
      "update withdrawals set status='approved', resolved_at=now(), resolved_by=$2 where id=$1 and status='pending' returning *",
      [rec.id, req.user.sub]);
    audit(req, 'wallet.withdraw.approve', { entityType: 'withdrawal', entityId: String(rec.id), after: { account: rec.account, amount, ref } });
    return { ok: true, withdrawal: upd.rows[0] || rec, balance: await balanceOf(rec.account) };
  });

  // Reject (staff only) → NO debit; just flip the status.
  app.post('/api/wallet/withdrawals/:id/reject', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    const r = await q(
      "update withdrawals set status='rejected', resolved_at=now(), resolved_by=$2 where id=$1 and status='pending' returning *",
      [req.params.id, req.user.sub]);
    if (!r.rows[0]) { reply.code(404); return { error: 'not found or already processed' }; }
    audit(req, 'wallet.withdraw.reject', { entityType: 'withdrawal', entityId: String(req.params.id), after: { status: 'rejected' } });
    return { ok: true, withdrawal: r.rows[0] };
  });
}
