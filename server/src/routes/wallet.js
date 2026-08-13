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
import { isStaff, canMoveMoney } from '../auth.js';
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

export async function moveFunds({ from, to, amount, type = 'transfer', ref = null, note = null, by = null, partner = null }) {
  const amt = parseFloat(amount);
  if (!isFinite(amt) || amt === 0) throw new Error('amount must be a non-zero number');
  if (String(from) === String(to)) throw new Error('source and destination are the same wallet');
  const r = ref != null && ref !== '' ? String(ref) : null;
  const rows = [
    { account: String(from), delta: -amt, type: type + '-out' },
    { account: String(to), delta: amt, type: type + '-in' },
  ];
  const pt = partner ? String(partner) : null;

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
      `insert into wallet_ledger (account, delta, type, ref, note, created_by, partner)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
      [row.account, row.delta, row.type, r, note, by, pt]);
  }
  return { fromBalance: await balanceOf(from), toBalance: await balanceOf(to) };
}

export function walletRoutes(app, requireAuth) {
  // CHAINED, not fired in parallel. These were separate bare q() calls, and a bare q()
  // takes whatever pool connection is free — so the CREATE INDEX could reach the server
  // before the CREATE TABLE and fail with "relation does not exist", straight into a
  // .catch(() => {}). That is not theoretical: on a fresh database it lost, leaving the
  // table WITHOUT wallet_ledger_dedupe, which silently turned every `on conflict do
  // nothing` in the money paths into "always insert". Concurrent retries with the same
  // ref then double-credited. Awaiting each step in order is what makes idempotency real.
  const walletReady = q(`create table if not exists wallet_ledger (
       id bigserial primary key,
       account     text not null,
       delta       numeric(12,2) not null,
       type        text not null default 'adjust',
       ref         text,
       note        text,
       created_by  text,
       created_at  timestamptz not null default now()
     )`)
    // WHO the money is with, when it isn't us. Neither the dispatch partner nor the design
    // partner has a billing API we can charge or credit against — both settle by invoice —
    // so their costs only ever exist on OUR ledger. Without a column naming them you can
    // only guess from the `type` string, which makes "what do we owe byeastside this month"
    // a manual sift. Null for ordinary seller movements.
    .then(() => q('alter table wallet_ledger add column if not exists partner text'))
    // Which order a cost belongs to. costs.js exports ensureCostColumns() to add this and
    // nothing ever called it, so the column was absent everywhere — and order_refunds.js
    // sets order_id and refund_part in ONE statement, so the missing column threw and took
    // refund_part down with it. Every refund then read back as unattributed and was
    // re-spread top-down across parts, making per-part refund caps wrong.
    .then(() => q('alter table wallet_ledger add column if not exists order_id text'))
    .then(() => q('alter table wallet_ledger add column if not exists refund_part text'))
    .then(() => q('create index if not exists wallet_ledger_partner on wallet_ledger (partner, created_at desc)'))
    .then(() => q('create index if not exists wallet_ledger_order on wallet_ledger (order_id)'))
    // De-dupe key: same (account,type,ref) can only land once. Partial index so
    // many ref-less manual adjustments are still allowed.
    .then(() => q(`create unique index if not exists wallet_ledger_dedupe
       on wallet_ledger (account, type, ref) where ref is not null and ref <> ''`))
    .then(() => q(`create index if not exists wallet_ledger_account on wallet_ledger (account, created_at desc)`))
    .catch(() => {});
  // Exported on the app so money routes can await the schema rather than assume it.
  app.decorate('walletReady', walletReady);

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
  /**
   * Who may READ a wallet account.
   *
   * `isStaff(user) => true` was too wide: isStaff admits operator, warehouse AND designer,
   * so any staff account could read the FACTORY wallet (company revenue, COGS, postage) and
   * the full ledger of EVERY seller. Reading money is not needed to pick, print or ship.
   *
   * Now: admin sees everything; a designer keeps the shared 'designer' account because that
   * IS their earnings page (designer-earnings.tsx reads it); everyone else sees only their
   * own. Sellers are unaffected — they were already limited to their own id, plus the
   * owner-granted team opt-in handled by ownerWalletFor().
   */
  function canAccess(user, account) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'designer' && account === 'designer') return true;
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
    // P&L summary over the FULL ledger (not the 200-row window) so the cards total everything,
    // grouped by the real ledger `type` — revenue, deposits, refunds and each cost category are
    // distinct facts, not "everything positive vs everything negative". This is the honest
    // per-category total the sign-based row view can't give.
    const sumRows = (await q(
      `select type, coalesce(sum(delta),0)::float as total from wallet_ledger where account=$1 group by type`,
      [account])).rows;
    const byType = Object.fromEntries(sumRows.map((r) => [r.type, Number(r.total) || 0]));
    const pos = (t) => Math.max(0, byType[t] || 0);
    const absNeg = (t) => Math.abs(Math.min(0, byType[t] || 0));
    /**
     * A cost category, NET OF ITS CREDITS.
     *
     * recordCredit writes `<type>-credit` as a separate positive row — deliberately, so the
     * ledger keeps both facts. But a summary that reads only the debit reports money we got
     * back as still spent: a voided label, a supplier return, a cancelled sample. The
     * balance already nets them (it is SUM(delta) over everything), so the categories
     * disagreed with the total they are supposed to explain, and every cost read high.
     *
     * PARTNER_SQL below already had this right — it prefix-matches so a credit attributes
     * to the same partner as its debit, "because matching only the exact debit type dropped
     * every refund/void from the breakdown and overstated what we owed". Same bug, same
     * file, the other half of it.
     *
     * Not clamped at zero: credits exceeding spend means something is wrong upstream, and
     * a negative that shows is better than one that hides.
     */
    const costOf = (t) => absNeg(t) - pos(t + '-credit');
    const summary = {
      revenue: pos('order-charge-in'),      // factory: what sellers paid in
      paid: absNeg('order-charge-out'),     // seller: what they paid out
      deposits: pos('topup'),               // top-ups (card / VietQR / transfer)
      refundsIn: pos('order-refund-in'),    // seller: refunds received
      refundsOut: absNeg('order-refund-out'), // factory: refunds paid back
      payouts: absNeg('withdrawal'),        // withdrawals
      productCost: costOf('blanks-cost'),   // COGS — S&S/Otto POs, less supplier returns
      postage: costOf('label-cost'),        // Shippo/USPS labels, less voided ones
      design: costOf('design-partner-cost'), // Pink Design
      dispatch: costOf('expedite-cost'),    // byeastside pick fee
      // Sourcing samples. Named here for the reason this map exists at all: the balance is
      // SUM(delta), so a type nobody lists still LOWERS the total while appearing in no
      // line — money visibly gone and nowhere accounted for.
      samples: costOf('sample-cost'),
      // What the BANK took to move our money, kept out of productCost on purpose: "what
      // the supplier charged" and "what it cost us to pay them" are negotiated with
      // different people, and adding them together loses both answers.
      bankFees: costOf('bank-fee'),
    };

    /**
     * PER SUPPLIER, because "suppliers: $4,102" answers no question anyone actually has.
     *
     * The one before a negotiation is "what do we spend with Otto", and the one before
     * dropping a supplier is "how much of this is SanMar". Both need the money split by who
     * received it, which the cost TYPE can never do — blanks-cost is the same type whoever
     * was paid. Only the `partner` column can, which is why recordCost now writes it.
     *
     * Rows written before that still carry null, so they are grouped under 'unattributed'
     * rather than being silently dropped or, worse, assigned to whichever supplier happens
     * to be first. A total that quietly excludes the past is how a report becomes wrong in
     * a way nobody can see; a line named "unattributed" is one anybody can.
     */
    const supplierRows = await q(
      `select coalesce(nullif(partner,''), 'unattributed') as partner,
              sum(delta)::float as net,
              sum(case when delta < 0 then -delta else 0 end)::float as spend,
              sum(case when delta > 0 then delta else 0 end)::float as credited,
              count(*)::int as entries
         from wallet_ledger
        where account = 'factory'
          and (type like 'blanks-cost%' or type like 'sample-cost%' or type like 'bank-fee%')
        group by 1
        order by spend desc`).catch(() => ({ rows: [] }));
    const bySupplier = supplierRows.rows.map((r) => ({
      partner: r.partner,
      // Signed from OUR side everywhere else in this file, so signed here too: spend is what
      // went out, credited is what came back, net is what it actually cost.
      spend: r.spend || 0, credited: r.credited || 0, net: Math.abs(r.net || 0),
      entries: r.entries || 0,
    }));
    // Ship the warning threshold WITH the balance, so a client never has to decide for
    // itself what "low" means — two screens using different numbers is how one warns and
    // the other doesn't. House accounts are exempt: they may run negative by design.
    let lowBelow = null;
    if (!isHouseAccount(account)) {
      try {
        const { readAll } = await import('./factory_settings.js');
        const n = Number((await readAll()).low_balance_warn);
        lowBelow = Number.isFinite(n) && n > 0 ? n : null;
      } catch { lowBelow = null; }
    }
    return { account, balance: bal, ledger: led.rows, summary, bySupplier, lowBelow, low: lowBelow != null && bal < lowBelow };
  });

  // Append one ledger entry (idempotent by ref). Returns the new balance.
  // STAFF ONLY. This writes an arbitrary delta straight into the ledger, and canAccess
  // lets a non-staff caller pass for their OWN account — so any signed-in seller could
  // POST {delta: 10000} and credit themselves. Nothing in the app calls this: real money
  // moves through top-ups, refunds and transfers, which resolve their own accounts
  // server-side. Locked to staff, where an arbitrary adjustment is a legitimate tool.
  /**
   * Partner statement — every movement attributable to one partner, as JSON or CSV.
   *
   * Neither partner can be charged through an API: both settle by invoice, so this
   * ledger IS the record we reconcile their bill against. That makes two things
   * non-negotiable — the rows must be filterable by partner without pattern-matching a
   * note field, and exportable so the figures can sit next to their invoice.
   *
   * Staff only. Amounts are signed from OUR side: negative = we owe / paid out.
   */
  // Partner of a row. Prefers the explicit `partner` column, and falls back to the cost
  // TYPE — costs.js books one type per partner (expedite-cost = byeastside,
  // design-partner-cost = Pink Design), so every row already written is attributable
  // without backfilling anything. Kept in SQL so filtering and grouping use the same
  // rule the export prints.
  const PARTNER_SQL = `coalesce(partner, case
      -- Prefix match so each partner's DEBIT (…-cost) AND its CREDIT reversal (…-cost-credit,
      -- written by recordCredit) attribute to the SAME partner. Matching only the exact debit
      -- type dropped every refund/void from the breakdown and overstated what we owed.
      when type like 'expedite-%'           then 'byeastside'
      when type like 'design-partner-cost%' then 'pinkdesign'
      -- A design payout to one of OUR designers is a design cost too. Attribute only the
      -- house-DEBIT side (account='factory'): that's what we paid out, so it sums as a cost
      -- alongside Pink. The matching credit on the designer's own wallet is their earning,
      -- not a partner cost, so it's deliberately left unlabelled.
      when type = 'design-pay' and account = 'factory' then 'designer'
      when type like 'label-cost%'          then 'carrier'
      when type like 'blanks-cost%'         then 'suppliers'
      -- A sample is bought from a supplier too, so it belongs in the same statement we
      -- reconcile their invoices against. Left out, it would drop off the partner export
      -- while still sitting in the factory balance.
      when type like 'sample-cost%'         then 'suppliers'
      -- A bank fee paid to move money to a supplier belongs in that supplier's statement:
      -- it is part of what reaching them costs. Rows written by recordCost carry an explicit
      -- partner column, so this only catches anything booked without one. (No backticks in
      -- here: this whole block is a template literal, and one closes it mid-comment.)
      when type like 'bank-fee%'            then 'suppliers'
    end)`;

  app.get('/api/wallet/export', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    const qy = req.query || {};
    const where = [], args = [];
    // This is the PARTNER-COSTS ledger (what we owe vendors), NOT the account transaction
    // ledger — so it only ever lists rows that map to a partner. Without this, "All partners"
    // returned every row on the account, so top-ups and order charges (which are transactions,
    // not partner costs) leaked in. A specific partner filter already implies partner-not-null.
    if (qy.partner) { args.push(String(qy.partner)); where.push(`${PARTNER_SQL} = $${args.length}`); }
    else { where.push(`${PARTNER_SQL} is not null`); }
    if (qy.account) { args.push(String(qy.account)); where.push(`account = $${args.length}`); }
    if (qy.type) { args.push(String(qy.type)); where.push(`type = $${args.length}`); }
    // Dates are inclusive of the whole end day — a statement "to the 31st" that silently
    // stops at 00:00 on the 31st is off by a day's trading.
    if (qy.from) { args.push(String(qy.from)); where.push(`created_at >= $${args.length}::date`); }
    if (qy.to) { args.push(String(qy.to)); where.push(`created_at < ($${args.length}::date + interval '1 day')`); }
    const wc = where.length ? 'where ' + where.join(' and ') : '';

    const rows = (await q(
      `select id, created_at, account, ${PARTNER_SQL} as partner, type,
              delta::float as delta, ref, note
         from wallet_ledger ${wc} order by created_at desc limit 5000`, args
    ).catch(() => ({ rows: [] }))).rows;

    if (String(qy.format || '').toLowerCase() === 'csv') {
      // Quote everything and double internal quotes — a note containing a comma must not
      // shift every later column, which is exactly how a reconciliation goes wrong.
      const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const head = ['id', 'date', 'account', 'partner', 'type', 'amount', 'ref', 'note'];
      const body = rows.map((r) => [r.id, new Date(r.created_at).toISOString(), r.account,
        r.partner || '', r.type, Number(r.delta).toFixed(2), r.ref || '', r.note || ''].map(esc).join(','));
      const name = `ledger-${qy.partner || qy.account || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${name}"`);
      return [head.map(esc).join(','), ...body].join('\n');
    }

    const total = rows.reduce((a, r) => a + Number(r.delta), 0);
    return { count: rows.length, total: Math.round(total * 100) / 100, rows };
  });

  /** Which partners actually appear in the ledger — so the filter offers real values. */
  app.get('/api/wallet/partners', { preHandler: requireAuth }, async (req, reply) => {
    // Admin only, matching canAccess above — this is what we OWE partners, which is spend
    // data, not something the floor needs to fulfil an order.
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'admin only' }; }
    const r = await q(
      `select ${PARTNER_SQL} as partner, count(*)::int as entries, sum(delta)::float as total
         from wallet_ledger where ${PARTNER_SQL} is not null
         group by 1 order by 1`
    ).catch(() => ({ rows: [] }));
    return r.rows;
  });

  /**
   * The categories a HUMAN may book into, and what each one means.
   *
   * An allowlist because the route took `b.type || 'adjust'` verbatim: a typo produced a
   * category no report groups on, so the money left the balance and vanished from every
   * summary — present in the total, invisible in the breakdown, which is the worst of both.
   *
   * These sit alongside the automatic ones in costs.js (label-cost, expedite-cost,
   * design-partner-cost, blanks-cost) rather than duplicating them: a cost the system books
   * itself must not also be enterable by hand, or the same invoice lands twice under two
   * refs and nothing downstream can tell which is real.
   */
  const MANUAL_TYPES = {
    adjust: 'Balance correction',
    'manual-expense': 'Expense (no integration)',
    'manual-income': 'Income (no integration)',
    'partner-invoice': 'Partner invoice',
    'supplier-invoice': 'Supplier invoice',
    'shipping-other': 'Shipping paid outside the aggregator',
    // The bank's cut on OUR outgoing card spend — foreign transaction, FX margin, wire fee.
    // Enterable by hand because that is the only place the real number exists: it appears on
    // the card statement, days after the charge, and differs by card and by supplier.
    // Same type recordCost books automatically from a PO's fee field, so a fee typed here
    // and one carried on a PO land in the same line and the same supplier statement.
    'bank-fee': 'Bank or card fee',
    equipment: 'Equipment or materials',
    overheads: 'Rent, utilities, software',
    'refund-manual': 'Refund issued by hand',
    'goodwill-credit': 'Goodwill credit to a seller',
  };

  /** The categories, for a picker. Read from the same object the route validates against,
   *  so a menu can never offer something the server would reject. */
  app.get('/api/wallet/entry-types', { preHandler: requireAuth }, async (req, reply) => {
    if (!canMoveMoney(req.user)) { reply.code(403); return { error: 'Admin or warehouse only' }; }
    return { types: Object.entries(MANUAL_TYPES).map(([id, label]) => ({ id, label })) };
  });

  /**
   * THE FACTORY'S OWN P&L, from the append-only ledger.
   *
   * Not from `orders.total`. That column is what the BUYER paid on a seller's marketplace —
   * gross merchandise value flowing through the platform, not money that ever reaches us.
   * The dashboard has been calling it "Revenue", and subtracting our costs from someone
   * else's turnover would produce a number that means nothing.
   *
   * What we actually earn lands on the `factory` account as it is earned, and what we spend
   * lands there as it is incurred, so income minus cost over a window IS the P&L. Every row
   * is real: a label cost is booked when a label is bought, an order charge when a seller is
   * charged. Nothing here is modelled.
   *
   * Signs are already correct in the ledger (income positive, cost negative), so the split
   * is on the sign rather than on a list of type names — a new cost type starts counting the
   * day it is introduced instead of the day someone remembers to add it here.
   */
  app.get('/api/reports/pnl', { preHandler: requireAuth }, async (req, reply) => {
    if (!canMoveMoney(req.user)) { reply.code(403); return { error: 'Admin or warehouse only' }; }
    const days = Math.max(1, Math.min(365, parseInt(req.query?.days, 10) || 30));
    const r = await q(
      `select type,
              sum(delta) filter (where delta > 0) as income,
              sum(delta) filter (where delta < 0) as cost,
              count(*) as n
         from wallet_ledger
        where account = 'factory' and created_at >= now() - ($1 || ' days')::interval
        group by type`,
      [String(days)]
    ).catch(() => ({ rows: [] }));

    const num = (v) => Number(v || 0);
    let income = 0, cost = 0;
    const byType = r.rows.map((x) => {
      income += num(x.income);
      cost += num(x.cost);           // already negative
      return { type: x.type, income: num(x.income), cost: num(x.cost), n: Number(x.n) };
    }).sort((a, b) => (b.income - b.cost) - (a.income - a.cost));

    return {
      days,
      income: Math.round(income * 100) / 100,
      cost: Math.round(cost * 100) / 100,            // negative
      profit: Math.round((income + cost) * 100) / 100,
      // Whether there is anything to report at all. A window with no factory rows must read
      // as "nothing booked yet", never as a profit of zero.
      known: r.rows.length > 0,
      byType,
    };
  });

  app.post('/api/wallet/ledger', { preHandler: requireAuth }, async (req, reply) => {
    // canMoveMoney, not isStaff: isStaff admits operator and designer, so this route let
    // either write an arbitrary delta onto ANY account — the seller-credits-themselves
    // hole closed, reopened one role down. Every neighbouring money path already draws
    // the line here (order_refunds canRefund, design_files canPrice, the cancel/refund
    // stages in orders.js), and CLAUDE.md puts wallet-affecting writes at admin/warehouse.
    if (!canMoveMoney(req.user)) { reply.code(403); return { error: 'Admin or warehouse only' }; }
    const b = req.body || {};
    const account = b.account ? String(b.account) : req.user.sub;
    if (!canAccess(req.user, account)) { reply.code(403); return { error: 'forbidden' }; }
    const delta = parseFloat(b.delta);
    if (!isFinite(delta) || delta === 0) { reply.code(400); return { error: 'delta must be a non-zero number' }; }
    // Shared wallets (factory/designer) are staff-only to credit OR debit.
    if ((account === 'factory' || account === 'designer') && !isStaff(req.user)) {
      reply.code(403); return { error: 'staff only' };
    }
    // Reject an unknown category rather than storing it. See MANUAL_TYPES above.
    const entryType = String(b.type || 'adjust');
    if (!Object.prototype.hasOwnProperty.call(MANUAL_TYPES, entryType)) {
      reply.code(400);
      return { error: `Unknown category "${entryType}". Pick one of: ${Object.keys(MANUAL_TYPES).join(', ')}.` };
    }
    // A reason is not optional on a hand-written money row. The ledger is append-only, so
    // this note is the ONLY explanation that will ever exist for it — an entry nobody can
    // account for later is indistinguishable from a mistake.
    const entryNote = String(b.note || '').trim();
    if (entryNote.length < 3) { reply.code(400); return { error: 'Add a reason — this lands in the ledger permanently.' }; }
    const ref = (b.ref != null && b.ref !== '') ? String(b.ref) : null;
    // Idempotent insert: if (account,type,ref) already exists, do nothing and
    // just return the current balance (duplicate:true) — never double-charge.
    // VALIDATED values from here down, not the raw body. The de-dupe, the insert and the
    // audit each re-derived `b.type || 'adjust'` independently, so a category that failed
    // validation would still have been the one stored — and the de-dupe would have been
    // checking a different key from the one written.
    if (ref) {
      const dup = await q('select 1 from wallet_ledger where account=$1 and type=$2 and ref=$3',
        [account, entryType, ref]);
      if (dup.rowCount) { return { ok: true, duplicate: true, balance: await balanceOf(account) }; }
    }
    await q(
      `insert into wallet_ledger (account, delta, type, ref, note, created_by, partner)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict do nothing`,
      [account, delta, entryType, ref, entryNote, req.user.sub,
       b.partner ? String(b.partner) : null]);
    audit(req, 'wallet.ledger', { entityType: 'wallet', entityId: account, after: { delta, type: entryType, ref, note: entryNote } });
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
    // Same narrowing as /ledger above — this moves real money between accounts, including
    // out of `factory`, and an operator or designer has no business doing that.
    if (!canMoveMoney(req.user)) { reply.code(403); return { error: 'Admin or warehouse only' }; }
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
