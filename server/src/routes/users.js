// User management API — ADMIN ONLY. Backs the "Users" admin screen so you
// add/promote/reset/delete accounts from the app instead of editing the DB.
import { q, withLock } from '../db.js';
import { moveFunds } from './wallet.js';
import { hashPassword, passwordProblem, isStaff, canManageUsers } from '../auth.js';
import { audit } from '../audit.js';
import { readAll } from './factory_settings.js';

const ROLES = ['seller', 'operator', 'admin', 'warehouse', 'designer'];
const PLANS = ['starter', 'pro', 'enterprise'];

export function usersRoutes(app, requireAdmin, requireAuth) {
  // Warehouse shares the day-to-day account chores (someone forgot a password, someone
  // left) but must NOT be able to escalate: it cannot change roles or plans, and cannot
  // touch an admin account at all. Otherwise a warehouse login could set an admin's
  // password and take the whole system. Deleting stays admin-only — it's irreversible.
  // canManageUsers lives in auth.js so password-reset.js gates on the SAME predicate —
  // it used to carry requireStaff, which was a second door into password_hash around
  // every check in this file.
  const requireUserManager = async (req, reply) => {
    if (!canManageUsers(req.user)) { reply.code(403); return reply.send({ error: 'Admin only' }); }
  };
  // Cosmetic profile avatar (emoji + colour). Added at route-load, not just in
  // schema.sql, because that file only runs on FIRST db init — an existing
  // deployment would never get the columns. Both nullable: no avatar set → the
  // UI falls back to the name's initial, exactly as before.
  q('alter table users add column if not exists avatar_emoji text').catch(() => {});
  q('alter table users add column if not exists avatar_color text').catch(() => {});
  // Per-user notification sound toggle (default on).
  q('alter table users add column if not exists notify_sound boolean default true').catch(() => {});
  // Subscription plan — SERVER truth. It used to live only in the browser
  // (localStorage eg_seller_plan), so 'Upgrade to Pro' granted itself for free and
  // any console could set 'enterprise'. Admin-set for now; billing can drive it later.
  q("alter table users add column if not exists plan text not null default 'starter'").catch(() => {});
  q('alter table users add column if not exists spydeck_addon boolean not null default false').catch(() => {});
  // Lighter, STAFF-readable seller directory (any non-seller role). Backs the
  // seller-adjust panel on the factory boards (warehouse/admin) so a balance
  // adjustment resolves to a real account. Minimal fields only — no password,
  // no cross-seller PII beyond what staff already see on orders.
  if (requireAuth) {
    app.get('/api/sellers', { preHandler: requireAuth }, async (req, reply) => {
      if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
      const r = await q(
        `select id, name, store_name, email, active from users
          where role='seller' order by coalesce(store_name, name, email) asc`);
      return r.rows;
    });
  }

  // Soft-disable flag. Deactivating keeps the user row (so seller_id stays on all
  // their orders — nothing is orphaned), but blocks login. schema.sql sets this on
  // fresh installs; this alter covers existing databases.
  q('alter table users add column if not exists active boolean not null default true').catch(() => {});
  // Peak-season per-seller DAILY order limit. NULL = use the platform default
  // (order_limit_default). Crossing it never blocks a submit — it only surfaces the editable
  // delay notice, and only AFTER the limit is actually crossed (no premature warning).
  q('alter table users add column if not exists order_limit int').catch(() => {});

  app.get('/api/users', { preHandler: requireUserManager }, async () => {
    // Include the TEAM relationship so the admin screen can group members under their
    // leader. Without it a list of "Owner" and "Member" rows says nothing about which
    // member belongs to whom — the one thing you need before changing anything.
    const r = await q(`
      select u.id, u.email, u.name, u.role, u.store_name, u.active, u.plan, u.spydeck_addon, u.created_at,
             -- Cosmetic identity, so the directory shows the SAME avatar the person set on
             -- their own profile (topbar/sidebar) rather than a bare initial.
             u.avatar_emoji, u.avatar_color, u.username,
             u.order_limit,
             -- Orders this seller has created today — so the admin sees usage against the
             -- limit without opening each account.
             (select count(*)::int from orders o2 where o2.seller_id = u.id and o2.created_at >= current_date) as orders_today,
             -- Trailing 14-day volume — the "busiest first" sort key, and the same signal the
             -- limit suggester weights by, so the review lines up with what it distributed.
             (select count(*)::int from orders o3 where o3.seller_id = u.id and o3.created_at >= now() - interval '14 days') as orders_14d,
             -- Lifetime orders + when the last one landed — answers "is this account active or
             -- dormant?" at a glance, which is the first thing you check before editing one.
             (select count(*)::int from orders o5 where o5.seller_id = u.id) as orders_total,
             (select max(o4.created_at) from orders o4 where o4.seller_id = u.id) as last_order_at,
             tm.owner_id,
             coalesce(o.store_name, o.name, o.email) as owner_label,
             tm.permissions as team_permissions,
             (select count(*)::int from team_members t2 where t2.owner_id = u.id::text and t2.status = 'active') as team_size,
             -- Wallet balance, so an admin can see who's out of funds without opening
             -- each account. One aggregate over the ledger rather than a request per row.
             (select coalesce(sum(w.delta), 0)::float from wallet_ledger w where w.account = u.id::text) as balance,
             /*
              * WHAT THEY HAVE ACTUALLY MOVED, for the row's detail panel.
              *
              * UNITS, not orders: orders_total already counts orders, and a seller with four
              * orders of fifty pieces is not the same seller as one with fifty orders of
              * four. The two answer different questions, so the panel shows both.
              *
              * WAITING excludes cancelled and refunded on the same reasoning volume.js uses:
              * an order somebody killed is not work in front of us, and counting it makes an
              * idle account look busy.
              *
              * Computed in the LIST rather than behind a per-row fetch: two aggregates over
              * one seller's own orders, on a bounded staff-and-sellers table, against a
              * spinner every time somebody opens a row.
              */
             (select coalesce(sum(i1.qty), 0)::int
                from orders os join order_items i1 on i1.order_id = os.id
               where os.seller_id = u.id and os.shipped_at is not null) as items_shipped,
             (select coalesce(sum(i2.qty), 0)::int
                from orders ow join order_items i2 on i2.order_id = ow.id
               where ow.seller_id = u.id and ow.shipped_at is null
                 and lower(coalesce(ow.factory_status, '')) not in ('cancelled', 'refunded')
                 and lower(coalesce(ow.status, '')) not in ('cancelled', 'refunded')) as items_waiting,
             /* UNITS SHIPPED LAST MONTH — the number the volume ladder actually reads
              * (volume.js: last month earns, this month spends). Shown so an admin can see
              * WHY a seller is on the rung they are on, rather than only that they are. */
             (select coalesce(sum(i3.qty), 0)::int
                from orders om join order_items i3 on i3.order_id = om.id
               where om.seller_id = u.id and om.shipped_at is not null
                 and to_char(om.shipped_at at time zone 'UTC', 'YYYY-MM')
                     = to_char((now() at time zone 'UTC') - interval '1 month', 'YYYY-MM')
                 and lower(coalesce(om.factory_status, '')) not in ('cancelled', 'refunded')
                 and lower(coalesce(om.status, '')) not in ('cancelled', 'refunded')) as units_last_month,
             /* The members themselves, not just how many. email is the only identity this
              * table is guaranteed to hold — user_id is filled on acceptance, name never. */
             (select array_agg(t3.email order by t3.email)
                from team_members t3
               where t3.owner_id = u.id::text and t3.status = 'active') as team_emails
        from users u
        left join team_members tm on lower(tm.email) = lower(u.email) and tm.status = 'active'
        left join users o on o.id::text = tm.owner_id
       order by u.created_at desc`);
    return r.rows;   // never returns password_hash
  });

  /**
   * A first profile name, derived from the address.
   *
   * An account created here had a blank `name`, so every screen that shows a person fell
   * back to its own placeholder — the account read as "Unknown" from the moment it was
   * made. The address is the one thing we always have, so it seeds the name: local part,
   * separators to spaces, each word capitalised. `linh.phan@egful.store` -> `Linh Phan`.
   *
   * It is a STARTING value, not a derived one — stored in the column like any other name,
   * so the moment the person edits their profile theirs wins and this never reappears.
   */
  const nameFromEmail = (email) =>
    String(email).split('@')[0]
      .replace(/[._+-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

  app.post('/api/users', { preHandler: requireAdmin }, async (req, reply) => {
    const { email, password, role = 'seller', name = '' } = req.body || {};
    if (!email || !password) { reply.code(400); return { error: 'Email and password are required' }; }
    // An ADDRESS, not a username. Sign-in accepts either, but an account made here has to
    // be reachable: it gets a password someone must be told, and it lands in the broadcast
    // audience — a username there is a message that can never be delivered. Usernames are
    // still chosen by the person themselves in their own profile.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      reply.code(400);
      return { error: 'Enter an email address — a username can’t receive the password or any mail we send' };
    }
    const weak = passwordProblem(password, { email, name });
    if (weak) { reply.code(400); return { error: weak }; }
    if (!ROLES.includes(role)) { reply.code(400); return { error: 'Invalid role' }; }
    try {
      const hash = await hashPassword(password);
      const addr = String(email).trim().toLowerCase();
      const r = await q(
        'insert into users (email, password_hash, role, name) values ($1,$2,$3,$4) returning id, email, name, role, created_at',
        [addr, hash, role, String(name).trim() || nameFromEmail(addr)]
      );
      return r.rows[0];
    } catch (e) {
      reply.code(400);
      return { error: e.code === '23505' ? 'That email already exists' : e.message };
    }
  });

  app.patch('/api/users/:id', { preHandler: requireUserManager }, async (req, reply) => {
    const { role, password, name, active, plan, spydeck_addon, order_limit, email } = req.body || {};
    const isAdminCaller = req.user.role === 'admin';
    if (!isAdminCaller) {
      // Warehouse: no privilege changes, and hands off admin accounts entirely.
      if (role != null || plan != null || spydeck_addon != null) { reply.code(403); return { error: 'Only an admin can change roles or plans' }; }
      // The address IS the identity — it signs in, it receives the password reset, and it is
      // what every marketplace and payment record names. Changing it is an admin act.
      if (email != null) { reply.code(403); return { error: 'Only an admin can change an account\'s email' }; }
      const target = await q('select role from users where id=$1', [req.params.id]).then((r) => r.rows[0]);
      if (target && target.role === 'admin') { reply.code(403); return { error: 'Only an admin can change an admin account' }; }
    }
    const sets = [], vals = []; let n = 1;
    if (plan != null) {
      if (!PLANS.includes(plan)) { reply.code(400); return { error: 'Invalid plan' }; }
      sets.push(`plan=$${n++}`); vals.push(plan);
    }
    if (typeof spydeck_addon === 'boolean') { sets.push(`spydeck_addon=$${n++}`); vals.push(spydeck_addon); }
    if (role) { if (!ROLES.includes(role)) { reply.code(400); return { error: 'Invalid role' }; } sets.push(`role=$${n++}`); vals.push(role); }
    if (name != null) { sets.push(`name=$${n++}`); vals.push(name); }
    /**
     * CHANGING THE ADDRESS, rather than moving everything out of the account.
     *
     * This is the move most platforms reach for first, and it was the one thing the admin
     * screen could not do — so "this should be under a different login" had no answer short
     * of transferring every order and the balance one at a time. Changing the address keeps
     * the account id, which means orders, wallet, connections, team and audit all stay
     * exactly where they are. Nothing moves, so nothing can be stranded.
     *
     * Same shape check signup enforces, for the same reason it enforces it: an identifier
     * with no '@' lands in the email column and login routes it to the USERNAME column, so
     * the account becomes unreachable from both directions at once.
     */
    if (email != null) {
      const addr = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
        reply.code(400); return { error: "Enter a real email address — it's how they sign in and reset their password." };
      }
      const taken = await q('select 1 from users where lower(email)=$1 and id<>$2', [addr, req.params.id]);
      if (taken.rowCount) { reply.code(409); return { error: 'Another account already uses that email.' }; }
      sets.push(`email=$${n++}`); vals.push(addr);
    }
    if (typeof active === 'boolean') {
      if (!active && req.params.id === req.user.sub) { reply.code(400); return { error: "You can't deactivate your own account" }; }
      sets.push(`active=$${n++}`); vals.push(active);
    }
    if (password) {
      // The target's own identity, not the caller's — the rule is "must not contain YOUR
      // name", and an admin setting someone else's password would otherwise be checked
      // against the wrong person.
      const target = await q('select email, name from users where id=$1', [req.params.id]).then((r) => r.rows[0] || {});
      const weak = passwordProblem(password, { email: target.email, name: name ?? target.name });
      if (weak) { reply.code(400); return { error: weak }; }
      sets.push(`password_hash=$${n++}`); vals.push(await hashPassword(password));
    }
    // Per-seller order limit — a capacity/operations setting, so a user-manager (admin or
    // warehouse) may set it, not just an admin. Empty/null clears it back to the platform
    // default; a number floors at 0.
    if (order_limit !== undefined) {
      const lim = (order_limit === null || order_limit === '') ? null : Math.max(0, parseInt(order_limit, 10) || 0);
      sets.push(`order_limit=$${n++}`); vals.push(lim);
    }
    if (!sets.length) return { ok: true };
    const prevEmail = email != null
      ? await q('select email from users where id=$1', [req.params.id]).then((r) => r.rows[0]?.email || null)
      : null;
    vals.push(req.params.id);
    await q(`update users set ${sets.join(',')} where id=$${n}`, vals);
    // Account changes are exactly what you want a trail of after the fact — especially a
    // password reset, which is indistinguishable from a takeover without one. The new
    // password is never recorded, only that one was set.
    audit(req, 'user.updated', {
      entityType: 'user', entityId: req.params.id,
      // The OLD address is carried too. For every other field here the new value is enough,
      // but an identity change that records only what it became cannot be read backwards —
      // and "who was this account before" is the whole question afterwards.
      before: email != null ? { email: prevEmail } : undefined,
      after: { role, name, active, plan, spydeck_addon, email: email != null ? String(email).trim().toLowerCase() : undefined, password: password ? 'reset' : undefined },
    });
    return { ok: true };
  });

  /**
   * Suggest per-seller limits by distributing the FACTORY daily cap across active sellers,
   * WEIGHTED by each seller's trailing 14-day average daily upload volume — so a busy seller
   * gets a bigger slice than a quiet one, rather than a naive even split. A seller with no
   * history still gets a small floor share (never capped at zero). Applies the numbers (you
   * then adjust any by hand) and returns what it set. A distribution aid, not a hard gate.
   *
   * The factory's OWN synced shop (factory_order) consumes the same capacity, so its recent
   * daily load is RESERVED off the top and only the remainder is split across sellers —
   * otherwise the full cap would go to sellers while the factory's orders ran on top of it,
   * blowing past the very cap this is meant to respect.
   */
  app.post('/api/users/suggest-order-limits', { preHandler: requireUserManager }, async (req, reply) => {
    const cfg = await readAll().catch(() => ({}));
    const cap = Number(cfg.factory_daily_limit || 0);
    if (!isFinite(cap) || cap <= 0) {
      reply.code(400);
      return { error: 'Set a Factory daily limit first — that\'s the total being distributed across sellers.' };
    }
    // Reserve the factory shop's own recent daily volume (14-day avg of its synced orders)
    // before splitting the rest. If it already meets/exceeds the cap, sellers fall to the
    // floor of 1 — the limits never block a submit, so that just signals the crunch.
    const reserved = await q(
      `select count(*)::float / 14.0 as n from orders
         where factory_order = true and created_at >= now() - interval '14 days'`
    ).then((r) => Math.round(Number(r.rows[0]?.n) || 0)).catch(() => 0);
    const distributable = Math.max(0, cap - reserved);
    const rows = (await q(`
      select u.id, coalesce(u.store_name, u.name, u.email) as label,
             (select count(*)::float from orders o
                where o.seller_id = u.id and o.created_at >= now() - interval '14 days') / 14.0 as avg_daily
        from users u
       where u.role = 'seller' and u.active = true`).catch(() => ({ rows: [] }))).rows;
    if (!rows.length) return { ok: true, applied: 0, cap, reserved, distributable, assignments: [] };
    // Floor each weight at 0.5 so a new/quiet seller still gets a nonzero share.
    const weights = rows.map((r) => Math.max(0.5, Number(r.avg_daily) || 0));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const assignments = rows.map((r, i) => ({
      id: r.id, label: r.label,
      avgDaily: Math.round((Number(r.avg_daily) || 0) * 10) / 10,
      limit: Math.max(1, Math.round((weights[i] / total) * distributable)),
    }));
    for (const a of assignments) {
      await q('update users set order_limit=$2 where id=$1', [a.id, a.limit]).catch(() => {});
    }
    audit(req, 'capacity.limits_suggested', { entityType: 'settings', entityId: 'order_limits',
      after: { cap, reserved, distributable, sellers: assignments.length } });
    return { ok: true, applied: assignments.length, cap, reserved, distributable, assignments };
  });

  /**
   * MOVE AN ACCOUNT'S BALANCE AND ORDERS TO ANOTHER ACCOUNT.
   *
   * The case this is for: a seller wants a fresh account and wants what they already paid
   * for to come with them. Before this the only routes were an admin deducting on one side
   * and topping up on the other — two independent writes, so a crash between them lost or
   * doubled real money — or nothing at all for the orders.
   *
   * WHY THIS IS SAFE ALONGSIDE A MARKETPLACE, which is the part worth stating because it is
   * the part that looks dangerous and is not. Verified in the three sync modules, not assumed:
   *
   *   platform_connections is `unique (platform, shop_id)` and every connect does
   *   `connected_by = excluded.connected_by` on conflict (etsy.js, shopify.js, tiktok.js).
   *   So a shop is connected to exactly ONE account at a time, and reconnecting it to the new
   *   account MOVES it. Two accounts can never sync the same shop, and there is no race to
   *   decide who owns an incoming order.
   *
   *   None of the three syncs list seller_id in their `on conflict (id) do update set`. A
   *   re-sync therefore rewrites total, customer and address but NEVER ownership. So orders
   *   moved by this route stay moved, even when the old connection pulls the same receipts
   *   again — and equally, orders left behind are never dragged across by the new one.
   *
   * The one thing that does NOT follow automatically is the connection itself: the seller has
   * to reconnect each shop on the new account. That is a consent screen at the marketplace,
   * which is exactly where it belongs and not something we may do on their behalf. The
   * response therefore NAMES the shops still attached to the old account, because "you must
   * reconnect these three" is the half of this job the admin cannot see from anywhere else.
   *
   * UNDER withLock ON THE SOURCE, because "move what is left" reads the balance and then
   * spends it, and two of those landing together both read the same figure — the exact
   * read-then-write shape db.js documents that lock for.
   */
  app.post('/api/users/:id/transfer', { preHandler: requireAdmin }, async (req, reply) => {
    const from = String(req.params.id);
    const b = req.body || {};
    if (from === req.user.sub) { reply.code(400); return { error: "You can't transfer out of your own account" }; }

    const src = (await q('select id, email, role from users where id=$1', [from])).rows[0];
    if (!src) { reply.code(404); return { error: 'That account no longer exists.' }; }

    let dst = null;
    if (b.toAccount) dst = (await q('select id, email, role, active from users where id=$1', [String(b.toAccount)])).rows[0] || null;
    else if (b.toEmail) dst = (await q('select id, email, role, active from users where lower(email)=lower($1)', [String(b.toEmail)])).rows[0] || null;
    if (!dst) { reply.code(404); return { error: "No account with that email — the destination has to exist and be signed up already." }; }
    if (dst.id === from) { reply.code(400); return { error: 'Source and destination are the same account.' }; }
    if (dst.active === false) { reply.code(400); return { error: 'That destination account is deactivated. Reactivate it first, or pick another.' }; }

    // A ref supplied by the CLIENT is what makes a retry idempotent without making a second,
    // deliberate transfer impossible: the dialog mints one when it opens, so pressing the
    // button twice is one move and opening it again tomorrow is a new one. moveFunds keys
    // its duplicate check on it.
    const ref = (b.ref != null && b.ref !== '') ? String(b.ref) : `acct-move:${from}:${dst.id}:${Date.now()}`;
    const wantOrders = b.orders === true;
    const wantBalance = b.balance !== false && b.balance !== 0;

    let movedAmount = 0;
    let movedOrders = 0;
    let fromBalance = null;
    let toBalance = null;
    try {
      await withLock(`wallet:${from}`, async () => {
        if (wantBalance) {
          const bal = (await q('select coalesce(sum(delta),0)::float as n from wallet_ledger where account=$1', [from])).rows[0].n;
          // A NUMBER means "move this much"; `true` means "move whatever is left". Never more
          // than is there — the overdraft guard would throw anyway, but refusing the whole
          // transfer because a stale figure was a cent high is not what was asked for.
          const want = typeof b.balance === 'number' ? Math.abs(b.balance) : bal;
          movedAmount = Math.round(Math.min(want, bal) * 100) / 100;
          if (movedAmount > 0) {
            const r = await moveFunds({
              from, to: dst.id, amount: movedAmount, type: 'account-move', ref,
              note: b.note || `Moved from ${src.email} to ${dst.email}`, by: req.user.sub });
            fromBalance = r.fromBalance; toBalance = r.toBalance;
          }
        }
        if (wantOrders) {
          // factory_order is derived from the OWNER'S ROLE and recomputed at every boot
          // (orders.js). Setting it here rather than leaving it means the row does not
          // silently reclassify at the next restart — the same reason POST /api/orders
          // writes it at creation instead of waiting for the sweep.
          const isFactory = dst.role !== 'seller';
          const r = await q(
            'update orders set seller_id=$2, factory_order=$3, updated_at=now() where seller_id=$1',
            [from, dst.id, isFactory]);
          movedOrders = r.rowCount;
        }
      });
    } catch (e) {
      if (e.code === 'INSUFFICIENT_FUNDS') { reply.code(400); return { error: e.message }; }
      req.log.error({ err: e.message, from, to: dst.id }, 'account transfer failed');
      reply.code(500);
      return { error: `The transfer did not complete: ${e.message}` };
    }

    // WHAT THE ADMIN STILL HAS TO DO. A connection cannot be handed over from here — it needs
    // the seller's consent at the marketplace — so the shops still pointing at the old account
    // are named rather than left to be discovered when orders stop arriving.
    const connections = (await q(
      `select platform, shop_name, shop_id from platform_connections where connected_by=$1
        order by platform`, [from]).catch(() => ({ rows: [] }))).rows;

    audit(req, 'user.transferred', {
      entityType: 'user', entityId: from,
      before: { account: src.email, balance: fromBalance != null ? fromBalance + movedAmount : null },
      after: { to: dst.email, movedAmount, movedOrders, ref, connectionsLeftBehind: connections.length },
    });
    return { ok: true, movedAmount, movedOrders, fromBalance, toBalance, to: dst.email, connections };
  });

  /**
   * A HARD DELETE IS FOR AN ACCOUNT THAT NEVER TRADED — and nothing enforced that.
   *
   * Measured end to end against a real database before this guard existed: a seller with one
   * live order and a $500 wallet balance was deleted, and BOTH survived, unreachable.
   *
   *   orders.seller_id       `on delete set null` — the row stays, the owner goes. Every
   *                          seller-facing list is `where seller_id = $1`, so the order is
   *                          invisible to all of them forever, and the staff board renders
   *                          the seller line by simply not printing it. Not "deleted" —
   *                          ABSENT, which is the one thing §4 says a UI may never do.
   *   wallet_ledger.account  a bare `text` column with NO foreign key at all, so the money
   *                          is not even nulled. $500 still sums into every account-wide
   *                          total while belonging to nobody.
   *
   * And it does not come back. Re-registering the same address mints a NEW uuid, and the
   * wallet is keyed by uuid — correctly, since an email can change hands — so the balance
   * and the orders stay stranded on an id no login will ever hold again.
   *
   * So the row may only go when there is nothing to orphan. For everyone else the answer is
   * `active = false`, which the schema has carried all along: it blocks sign-in, keeps the
   * history attached to a real name, and the boards now read that name back annotated
   * "(deactivated)" rather than silently dropping it.
   */
  app.delete('/api/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    if (req.params.id === req.user.sub) { reply.code(400); return { error: "You can't delete your own account" }; }
    let orders = 0;
    let ledger = 0;
    try {
      orders = (await q('select count(*)::int as n from orders where seller_id=$1', [req.params.id])).rows[0].n;
      // wallet_ledger is created at wallet.js ROUTE LOAD, not in schema.sql, so a DB that has
      // genuinely never registered that module has no such table and no entries to strand.
      // to_regclass asks that question directly — the alternative, catching the error, cannot
      // tell "no table" from "the count failed", and one of those must not permit a delete.
      const has = (await q("select to_regclass('public.wallet_ledger') is not null as ok")).rows[0].ok;
      if (has) ledger = (await q('select count(*)::int as n from wallet_ledger where account=$1', [req.params.id])).rows[0].n;
    } catch (e) {
      // FAIL CLOSED. An unreadable history is not an empty one, and this is the branch that
      // decides whether money can be orphaned.
      req.log.warn({ err: e.message, user: req.params.id }, 'could not check account history before delete');
      reply.code(503);
      return { error: "Couldn't check this account's orders and wallet, so nothing was deleted. Try again." };
    }
    if (orders || ledger) {
      const held = [
        orders ? `${orders} order${orders === 1 ? '' : 's'}` : null,
        ledger ? `${ledger} wallet ${ledger === 1 ? 'entry' : 'entries'}` : null,
      ].filter(Boolean).join(' and ');
      reply.code(409);
      return {
        error: `This account has ${held}, which deleting it would leave with no owner. Deactivate it instead — that blocks sign-in and keeps the history attached to a real name.`,
        orders, ledger, deactivateInstead: true,
      };
    }
    await q('delete from users where id=$1', [req.params.id]);
    audit(req, 'user.deleted', { entityType: 'user', entityId: req.params.id });
    return { ok: true };
  });
}
