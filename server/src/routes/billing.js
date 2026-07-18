// Subscription billing. Plan changes were disabled entirely after 'Upgrade to Pro'
// turned out to grant itself for free from localStorage; this is the real path.
//
// Money comes from the WALLET first — top-ups already work through Stripe/PayPal/VietQR,
// so the wallet is the one funded balance every seller already has. When it can't cover
// the charge we do NOT dead-end: the 402 names the shortfall and the methods that can
// fund it, so the client can send the seller to top up (or, later, pay a provider
// directly — see `method` below).
import { q } from '../db.js';
import { balanceOf, moveFunds } from './wallet.js';
import { audit } from '../audit.js';
import { notify } from './notifications.js';

// SERVER-side prices. The client has its own copy in lib/plans.ts for display, but the
// amount charged must never come from the caller — that's the hole that made the old
// upgrade button free.
const PLAN_PRICES = { starter: 0, pro: 29, enterprise: 99 };
const SPYDECK_ADDON_PRICE = 9;
const PLANS = Object.keys(PLAN_PRICES);

// Where subscription revenue lands — the same house account order charges credit.
const HOUSE = 'factory';

// Billing period key (YYYY-MM). It's part of the idempotency ref so a double-click or a
// retry inside the same month can't charge twice, while next month legitimately can.
const periodKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthFromNow = () => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1); return d; };

// How long a seller keeps paid features after a failed renewal before dropping to
// Starter. A wallet is topped up by hand (bank transfer, VietQR), so same-day failure
// would punish people who simply hadn't got to it yet.
const GRACE_DAYS = 7;

/**
 * Charge every subscription that's due. Idempotent per (user, month): the ledger ref
 * carries the billing period, so running this twice in a month — a retry, an overlapping
 * tick, a restart — cannot double-charge.
 *
 * A failed charge does NOT cancel immediately. The seller is told what's missing and
 * keeps their plan through the grace window; only after that do they drop to Starter.
 */
export async function runRenewals() {
  const due = await q(
    `select id, plan, spydeck_addon, plan_past_due_since from users
      where plan_auto_renew is true
        and plan_renews_at is not null
        and plan_renews_at <= now()
        and (plan <> 'starter' or spydeck_addon is true)`
  );
  for (const u of due.rows) {
    const monthly = (PLAN_PRICES[u.plan] || 0) + (u.spydeck_addon === true ? SPYDECK_ADDON_PRICE : 0);
    if (monthly <= 0) {
      await q('update users set plan_renews_at=null where id=$1', [u.id]).catch(() => {});
      continue;
    }
    try {
      const balance = await balanceOf(u.id);
      if (balance >= monthly) {
        await moveFunds({
          from: u.id, to: HOUSE, amount: monthly, type: 'subscription',
          ref: `renew-${u.id}-${periodKey()}`,
          note: `${u.plan} plan renewal${u.spydeck_addon === true ? ' + SpyDeck' : ''}`, by: u.id,
        });
        await q('update users set plan_renews_at=$1, plan_past_due_since=null where id=$2', [monthFromNow(), u.id]);
        notify({ userIds: [u.id], type: 'billing-renewed', title: `Your ${u.plan} plan renewed`,
          body: `$${monthly.toFixed(2)} charged to your wallet.`, href: '/settings' });
        continue;
      }
      // Short balance → start (or continue) the grace window.
      const since = u.plan_past_due_since ? new Date(u.plan_past_due_since) : null;
      const overdueDays = since ? (Date.now() - since.getTime()) / 86400000 : 0;
      if (!since) {
        await q('update users set plan_past_due_since=now() where id=$1', [u.id]);
        notify({ userIds: [u.id], type: 'billing-past-due', title: 'Top up to keep your plan',
          body: `Renewal needs $${monthly.toFixed(2)} — your wallet has $${balance.toFixed(2)}. You have ${GRACE_DAYS} days.`,
          href: '/wallet' });
      } else if (overdueDays >= GRACE_DAYS) {
        await q("update users set plan='starter', spydeck_addon=false, plan_renews_at=null, plan_past_due_since=null where id=$1", [u.id]);
        notify({ userIds: [u.id], type: 'billing-downgraded', title: 'Moved to the Starter plan',
          body: 'We could not renew your subscription. Top up and upgrade any time.', href: '/settings' });
      }
    } catch (e) {
      // One seller's failure must not stop the rest of the run.
    }
  }
}

export function billingRoutes(app, requireAuth) {
  q('alter table users add column if not exists plan_renews_at timestamptz').catch(() => {});
  q('alter table users add column if not exists plan_auto_renew boolean not null default true').catch(() => {});
  q('alter table users add column if not exists plan_past_due_since timestamptz').catch(() => {});

  // Hourly sweep. Same single-instance pattern as the Etsy auto-sync: a globalThis guard
  // so a hot reload can't stack timers, and unref() so it never holds the process open.
  if (!globalThis.__egBillingRenew) {
    globalThis.__egBillingRenew = setInterval(() => { runRenewals().catch(() => {}); }, 60 * 60 * 1000);
    if (globalThis.__egBillingRenew.unref) globalThis.__egBillingRenew.unref();
    // Catch anything that came due while the server was down.
    setTimeout(() => { runRenewals().catch(() => {}); }, 30 * 1000).unref?.();
  }

  // What the seller is on now + what things cost. Prices come from here, not the client,
  // so the confirm dialog can show the true amount.
  app.get('/api/billing/plan', { preHandler: requireAuth }, async (req) => {
    const r = await q('select plan, spydeck_addon, plan_renews_at, plan_auto_renew, plan_past_due_since from users where id=$1', [req.user.sub]);
    const u = r.rows[0] || {};
    return {
      plan: u.plan || 'starter',
      spydeck_addon: u.spydeck_addon === true,
      renews_at: u.plan_renews_at || null,
      auto_renew: u.plan_auto_renew !== false,
      past_due_since: u.plan_past_due_since || null,
      grace_days: GRACE_DAYS,
      balance: await balanceOf(req.user.sub),
      prices: { plans: PLAN_PRICES, spydeck_addon: SPYDECK_ADDON_PRICE },
    };
  });

  // Turn monthly renewal on/off. Off does NOT cancel now — the plan runs out the month
  // that's already paid for, then lapses to Starter instead of charging again.
  app.post('/api/billing/auto-renew', { preHandler: requireAuth }, async (req, reply) => {
    const on = !!(req.body || {}).on;
    const r = await q('update users set plan_auto_renew=$1 where id=$2 returning plan, plan_renews_at', [on, req.user.sub]);
    if (!r.rows[0]) { reply.code(404); return { error: 'No such account' }; }
    audit(req, 'billing.auto_renew', { entityType: 'user', entityId: req.user.sub, after: { auto_renew: on } });
    return { ok: true, auto_renew: on, renews_at: r.rows[0].plan_renews_at };
  });

  // Change plan and/or the SpyDeck add-on. Charges the difference for the current month.
  // body: { plan?, spydeckAddon?, method? }
  app.post('/api/billing/subscribe', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    // Staff don't carry seller plans — they bypass the paywall by role.
    if (req.user.role && req.user.role !== 'seller') { reply.code(400); return { error: 'Staff accounts do not have a subscription plan.' }; }

    const cur = (await q('select plan, spydeck_addon from users where id=$1', [req.user.sub])).rows[0] || {};
    const curPlan = cur.plan || 'starter';
    const curAddon = cur.spydeck_addon === true;

    const plan = b.plan != null ? String(b.plan) : curPlan;
    if (!PLANS.includes(plan)) { reply.code(400); return { error: 'Invalid plan' }; }
    if (plan === 'enterprise' && curPlan !== 'enterprise') {
      reply.code(400); return { error: 'Enterprise is set up with our team — contact sales.' };
    }
    const addon = typeof b.spydeckAddon === 'boolean' ? b.spydeckAddon : curAddon;

    // Charge only what's being ADDED this month. A downgrade or a removal costs nothing
    // now (and isn't refunded — it simply stops billing next cycle).
    const planCharge = PLAN_PRICES[plan] > PLAN_PRICES[curPlan] ? PLAN_PRICES[plan] - PLAN_PRICES[curPlan] : 0;
    const addonCharge = addon && !curAddon ? SPYDECK_ADDON_PRICE : 0;
    const amount = planCharge + addonCharge;

    const method = String(b.method || 'wallet');
    if (method !== 'wallet') {
      // Deliberately open-ended: a provider-direct path (Stripe/PayPal/VietQR charging
      // the card straight through) slots in here. Until it exists, say so plainly rather
      // than silently falling back to the wallet and charging a balance they didn't pick.
      reply.code(400);
      return { error: `Payment method '${method}' isn't available yet — top up your wallet and pay from the balance.`, methods: ['wallet'] };
    }

    if (amount > 0) {
      const balance = await balanceOf(req.user.sub);
      if (balance < amount) {
        // NOT a dead end — tell the client exactly what's missing and how it can be
        // funded, so it can offer a top-up for the shortfall.
        reply.code(402);
        return {
          error: `Your wallet balance is $${balance.toFixed(2)} — this costs $${amount.toFixed(2)}.`,
          amount, balance, shortfall: Number((amount - balance).toFixed(2)),
          topUpMethods: ['stripe', 'paypal', 'vietqr'],
        };
      }
      // Idempotent per (user, target state, month): a retry or double-submit is a no-op.
      await moveFunds({
        from: req.user.sub, to: HOUSE, amount, type: 'subscription',
        ref: `sub-${req.user.sub}-${plan}-${addon ? 'sd' : 'nosd'}-${periodKey()}`,
        note: `${plan} plan${addonCharge ? ' + SpyDeck' : ''}`, by: req.user.sub,
      });
    }

    const renews = plan === 'starter' && !addon ? null : monthFromNow();
    // Paying for a plan re-arms renewal and clears any past-due state — otherwise someone
    // who had lapsed would pay and then silently lapse again next month.
    await q('update users set plan=$1, spydeck_addon=$2, plan_renews_at=$3, plan_auto_renew=true, plan_past_due_since=null where id=$4',
      [plan, addon, renews, req.user.sub]);

    audit(req, 'billing.subscribe', {
      entityType: 'user', entityId: req.user.sub,
      before: { plan: curPlan, spydeck_addon: curAddon },
      after: { plan, spydeck_addon: addon, charged: amount },
    });

    return {
      ok: true, plan, spydeck_addon: addon, charged: amount,
      renews_at: renews, balance: await balanceOf(req.user.sub),
    };
  });
}
