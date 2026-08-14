// cash_accounts.js — WHERE THE MONEY ACTUALLY IS.
//
// wallet_ledger answers "what has moved through the platform". It cannot answer "how much is
// in PingPong" or "what is on the card Shippo charges", because it has no idea those places
// exist — a seller top-up and a postage charge are both just numbers on the factory account.
// So the same $400 that arrived yesterday is invisible as $200 sitting in VietQR and $200
// sitting in PingPong, and answering that means opening three websites.
//
// This adds the missing half: named real-world accounts, and a column on the ledger saying
// which one each movement passed through.
//
// DERIVED, THEN RECONCILED. A balance is opening + everything attributed to it, so it stays
// current without anyone maintaining it. It will still drift — VietQR takes a fee, a card
// gets used outside the platform — so Reconcile records the DIFFERENCE as its own visible
// entry rather than overwriting the history that produced it. The gap is the useful part:
// it is the money that moved without the platform knowing.
//
// UNASSIGNED IS A PLACE. A movement with no account is not hidden or guessed at — it is
// counted in its own line, so what still needs attributing is obvious rather than quietly
// folded into a total that looks complete.

import { q } from '../db.js';
import { audit } from '../audit.js';

/**
 * The payment rails a top-up can arrive on, mapped to the account that receives it.
 *
 * topup_requests.method already records the rail on every request, so attribution is mostly
 * free — this is the lookup that turns "PingPong" into the PingPong account. Lowercased and
 * matched loosely because the method string comes from the client and has varied ("Card",
 * "card", "CARD").
 */
export const RAIL_TO_ACCOUNT = {
  pingpong: 'pingpong',
  lianlian: 'lianlian',
  paypal: 'paypal',
  vietqr: 'vietqr',
  card: 'card',
  stripe: 'card',
};

/** The account a rail lands in, or null when we can't tell — which is a legitimate answer
 *  and lands the money in Unassigned rather than in whichever account is first. */
export function accountForRail(method) {
  const k = String(method || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return RAIL_TO_ACCOUNT[k] || null;
}

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = (async () => {
    await q(`create table if not exists cash_accounts (
      id          text primary key,
      name        text not null,
      -- rail: money arrives here from sellers · bank: it sits here · card: it is spent here.
      -- Only used to group and sort the list; nothing branches on it.
      kind        text not null default 'bank',
      opening     numeric(12,2) not null default 0,
      -- The card Shippo charges, so postage can be attributed without anyone choosing it
      -- every time. At most one account should carry this.
      is_postage  boolean not null default false,
      archived    boolean not null default false,
      note        text,
      created_at  timestamptz not null default now()
    )`).catch(() => {});
    // WHICH REAL ACCOUNT A LEDGER ROW PASSED THROUGH. Null = unassigned, deliberately: a
    // guess here would be indistinguishable from a fact, and this column exists to make
    // money traceable.
    await q('alter table wallet_ledger add column if not exists cash_account text').catch(() => {});
    await q('create index if not exists wallet_ledger_cash_idx on wallet_ledger(cash_account)').catch(() => {});
  })();
  return _ready;
}

/**
 * Attribute a ledger row to an account, best-effort.
 *
 * Called from the paths that already know where money went — a credited top-up knows its
 * rail, a bought label knows it was the postage card. Never throws and never overwrites an
 * attribution already made by a person: an automatic guess must not silently replace
 * someone's correction.
 */
export async function attributeLedger(ref, type, accountId) {
  if (!ref || !accountId) return;
  await ensure();
  await q(`update wallet_ledger set cash_account = $3
            where ref = $1 and type = $2 and cash_account is null`, [String(ref), String(type), String(accountId)])
    .catch(() => {});
}

/** The account postage is charged to, if one is marked. */
export async function postageAccountId() {
  await ensure();
  const r = await q('select id from cash_accounts where is_postage and not archived limit 1').catch(() => ({ rows: [] }));
  return r.rows[0] ? r.rows[0].id : null;
}

export function cashAccountRoutes(app, requireAuth, requireAdmin) {
  ensure();

  /**
   * Every account with its balance, plus what has not been attributed yet.
   *
   * The balance is opening + the sum of ledger rows pointing at it. Test-marked rows are
   * excluded for the same reason they are excluded from the wallet: they are not money.
   */
  app.get('/api/cash-accounts', { preHandler: requireAdmin }, async () => {
    await ensure();
    const accounts = (await q(
      `select a.id, a.name, a.kind, a.opening::float, a.is_postage, a.note,
              (a.opening + coalesce(sum(w.delta) filter (where coalesce(w.is_test,false) = false), 0))::float as balance,
              count(w.id) filter (where coalesce(w.is_test,false) = false)::int as movements
         from cash_accounts a
         left join wallet_ledger w on w.cash_account = a.id
        where not a.archived
        group by a.id
        order by a.kind, a.name`)).rows;

    // Money the platform has seen but nobody has placed. Shown as its own line rather than
    // spread across accounts or left out of the total — an unattributed dollar is a real
    // dollar, and pretending otherwise makes the total wrong in the direction that looks fine.
    const un = (await q(
      `select coalesce(sum(delta),0)::float as amount, count(*)::int as entries
         from wallet_ledger
        where account = 'factory' and cash_account is null and coalesce(is_test,false) = false`)).rows[0];

    return {
      accounts,
      unassigned: { amount: un ? un.amount : 0, entries: un ? un.entries : 0 },
      total: accounts.reduce((n, a) => n + (Number(a.balance) || 0), 0),
    };
  });

  /** Create one. The id is a slug the rails map onto (see RAIL_TO_ACCOUNT), so a PingPong
   *  account must be id 'pingpong' for top-ups to attribute themselves. */
  app.post('/api/cash-accounts', { preHandler: requireAdmin }, async (req, reply) => {
    await ensure();
    const b = req.body || {};
    const id = String(b.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const name = String(b.name || '').trim();
    if (!id || !name) { reply.code(400); return { error: 'An id and a name are both required.' }; }
    await q(
      `insert into cash_accounts (id, name, kind, opening, is_postage, note)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set name = excluded.name, kind = excluded.kind,
             opening = excluded.opening, is_postage = excluded.is_postage, note = excluded.note,
             archived = false`,
      [id, name, String(b.kind || 'bank'), Number(b.opening) || 0, !!b.isPostage, b.note || null]);
    // At most one postage card, or attribution would have to pick between them.
    if (b.isPostage) await q('update cash_accounts set is_postage = false where id <> $1', [id]).catch(() => {});
    audit(req, 'cash_account.save', { entityType: 'cash_account', entityId: id, after: { name, kind: b.kind, opening: b.opening } });
    return { ok: true, id };
  });

  app.delete('/api/cash-accounts/:id', { preHandler: requireAdmin }, async (req) => {
    await ensure();
    // ARCHIVED, not deleted: ledger rows point at this id, and removing it would orphan
    // every movement ever attributed to it.
    await q('update cash_accounts set archived = true where id = $1', [String(req.params.id)]);
    audit(req, 'cash_account.archive', { entityType: 'cash_account', entityId: String(req.params.id) });
    return { ok: true };
  });

  /**
   * RECONCILE — say what the account really holds.
   *
   * Records the difference as its own ledger entry rather than editing history. The gap is
   * the informative part: it is money that moved without the platform seeing it (a fee, an
   * FX margin, a card used elsewhere), and a reconcile that silently rewrote the balance
   * would destroy exactly that signal.
   */
  app.post('/api/cash-accounts/:id/reconcile', { preHandler: requireAdmin }, async (req, reply) => {
    await ensure();
    const id = String(req.params.id);
    const actual = Number((req.body || {}).actual);
    if (!isFinite(actual)) { reply.code(400); return { error: 'A real balance is required.' }; }
    const r = await q(
      `select (a.opening + coalesce(sum(w.delta) filter (where coalesce(w.is_test,false) = false), 0))::float as balance
         from cash_accounts a left join wallet_ledger w on w.cash_account = a.id
        where a.id = $1 group by a.id`, [id]);
    if (!r.rows.length) { reply.code(404); return { error: 'No such account.' }; }
    const diff = +(actual - (Number(r.rows[0].balance) || 0)).toFixed(2);
    if (!diff) return { ok: true, unchanged: true, balance: actual };
    await q(
      `insert into wallet_ledger (account, delta, type, ref, note, created_by, cash_account)
       values ('factory', $1, 'reconcile', $2, $3, $4, $5)`,
      [diff, `recon-${id}-${Date.now()}`,
       `Reconciled ${id} to ${actual.toFixed(2)} — ${diff > 0 ? 'found' : 'missing'} ${Math.abs(diff).toFixed(2)}`,
       req.user && req.user.email, id]);
    audit(req, 'cash_account.reconcile', {
      entityType: 'cash_account', entityId: id,
      before: { balance: r.rows[0].balance }, after: { balance: actual },
      note: `Adjusted by ${diff.toFixed(2)}`,
    });
    return { ok: true, balance: actual, adjustment: diff };
  });

  /**
   * RECORD A PAYMENT — the factory's own money in or out.
   *
   * This is what the factory side needed instead of "Add funds", which is the SELLER's
   * top-up flow and reads as nonsense from this side ("send your PingPong payment to
   * helennguyen958@gmail.com" — to yourself). A bank transfer, a card payment, money that
   * arrived outside the platform: amount, direction, account, note.
   */
  app.post('/api/cash-accounts/:id/payment', { preHandler: requireAdmin }, async (req, reply) => {
    await ensure();
    const id = String(req.params.id);
    const b = req.body || {};
    const amount = Math.abs(Number(b.amount) || 0);
    if (!amount) { reply.code(400); return { error: 'An amount is required.' }; }
    const out = b.direction === 'out';
    const delta = out ? -amount : amount;
    const exists = await q('select 1 from cash_accounts where id = $1 and not archived', [id]);
    if (!exists.rows.length) { reply.code(404); return { error: 'No such account.' }; }
    await q(
      `insert into wallet_ledger (account, delta, type, ref, note, created_by, cash_account)
       values ('factory', $1, $2, $3, $4, $5, $6)`,
      [delta, out ? 'manual-adjust-out' : 'manual-adjust-in',
       `pay-${id}-${Date.now()}`, String(b.note || '').slice(0, 300) || (out ? 'Payment out' : 'Payment in'),
       req.user && req.user.email, id]);
    audit(req, 'cash_account.payment', {
      entityType: 'cash_account', entityId: id,
      after: { delta, note: b.note || null },
      note: `${out ? 'Paid out' : 'Received'} ${amount.toFixed(2)} on ${id}`,
    });
    return { ok: true };
  });

  /**
   * BACKFILL POSTAGE onto the card that pays for it.
   *
   * Label costs place themselves — but only from the moment a card is marked, and there were
   * 73 of them before that. Attributing seventy-three rows through a per-row picker is a
   * chore nobody finishes, so this does the pass in one action.
   *
   * ONLY ROWS WITH NO ACCOUNT. Anything already attributed — by hand or otherwise — is left
   * exactly as it is: a bulk action that overwrites someone's deliberate correction is worse
   * than one that does nothing.
   *
   * Reversible like any other attribution: each row can be moved again from its picker.
   */
  app.post('/api/cash-accounts/backfill-postage', { preHandler: requireAdmin }, async (req, reply) => {
    await ensure();
    const id = await postageAccountId();
    if (!id) { reply.code(400); return { error: 'No postage card is marked yet — mark one on an account first.' }; }
    const r = await q(
      `update wallet_ledger set cash_account = $1
        where type = 'label-cost' and cash_account is null and coalesce(is_test,false) = false
        returning id`, [id]);
    audit(req, 'cash_account.backfill_postage', {
      entityType: 'cash_account', entityId: id,
      after: { attributed: r.rowCount },
      note: `Attributed ${r.rowCount} past label cost${r.rowCount === 1 ? '' : 's'} to ${id}`,
    });
    return { ok: true, attributed: r.rowCount, account: id };
  });

  /** Move an existing ledger entry to an account — how Unassigned gets emptied. */
  app.patch('/api/cash-accounts/attribute/:ledgerId', { preHandler: requireAdmin }, async (req, reply) => {
    await ensure();
    const to = (req.body || {}).account;
    const id = String(req.params.ledgerId);
    if (to) {
      const ok = await q('select 1 from cash_accounts where id = $1 and not archived', [String(to)]);
      if (!ok.rows.length) { reply.code(400); return { error: 'No such account.' }; }
    }
    const before = (await q('select cash_account, delta, note from wallet_ledger where id = $1::bigint', [id])).rows[0];
    if (!before) { reply.code(404); return { error: 'No such entry.' }; }
    await q('update wallet_ledger set cash_account = $2 where id = $1::bigint', [id, to ? String(to) : null]);
    audit(req, 'cash_account.attribute', {
      entityType: 'wallet_ledger', entityId: id,
      before: { cash_account: before.cash_account }, after: { cash_account: to || null },
      note: `${before.delta} — ${before.note || 'entry'}`,
    });
    return { ok: true };
  });
}
