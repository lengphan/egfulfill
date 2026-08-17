// User management API — ADMIN ONLY. Backs the "Users" admin screen so you
// add/promote/reset/delete accounts from the app instead of editing the DB.
import { q } from '../db.js';
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
    const { role, password, name, active, plan, spydeck_addon, order_limit } = req.body || {};
    const isAdminCaller = req.user.role === 'admin';
    if (!isAdminCaller) {
      // Warehouse: no privilege changes, and hands off admin accounts entirely.
      if (role != null || plan != null || spydeck_addon != null) { reply.code(403); return { error: 'Only an admin can change roles or plans' }; }
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
    vals.push(req.params.id);
    await q(`update users set ${sets.join(',')} where id=$${n}`, vals);
    // Account changes are exactly what you want a trail of after the fact — especially a
    // password reset, which is indistinguishable from a takeover without one. The new
    // password is never recorded, only that one was set.
    audit(req, 'user.updated', {
      entityType: 'user', entityId: req.params.id,
      after: { role, name, active, plan, spydeck_addon, password: password ? 'reset' : undefined },
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

  app.delete('/api/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    if (req.params.id === req.user.sub) { reply.code(400); return { error: "You can't delete your own account" }; }
    await q('delete from users where id=$1', [req.params.id]);
    audit(req, 'user.deleted', { entityType: 'user', entityId: req.params.id });
    return { ok: true };
  });
}
