// Subscription billing. Plan changes were disabled entirely after 'Upgrade to Pro'
// turned out to grant itself for free from localStorage; this is the real path.
//
// Money comes from the WALLET first — top-ups already work through Stripe/PayPal/VietQR,
// so the wallet is the one funded balance every seller already has. When it can't cover
// the charge we do NOT dead-end: the 402 names the shortfall and the methods that can
// fund it, so the client can send the seller to top up (or, later, pay a provider
// directly — see `method` below).
import { q } from '../db.js';
import { resolveEntitlements } from '../auth.js';
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
    `select id, plan, spydeck_addon, plan_past_due_since, plan_auto_renew, plan_trial_ends_at from users
      where plan_renews_at is not null
        and plan_renews_at <= now()
        and (plan <> 'starter' or spydeck_addon is true)`
  );
  for (const u of due.rows) {
    /**
     * A TRIAL ENDS. IT NEVER CHARGES.
     *
     * This branch is first on purpose — every path below it can move money, and a trial
     * must not reach any of them. The seller agreed to try the plan, not to buy it, so the
     * only correct action at expiry is to stop the access and ask.
     *
     * Nothing they made is touched: orders, designs and connected shops are untouched and
     * they simply lose the gated features. plan_trial_used_at is stamped here rather than
     * when the trial starts, so an admin who grants one and revokes it same-day has not
     * silently burned the seller's only trial.
     */
    if (u.plan_trial_ends_at && new Date(u.plan_trial_ends_at).getTime() <= Date.now()) {
      await q(
        `update users set plan='starter', spydeck_addon=false, plan_renews_at=null,
                plan_past_due_since=null, plan_paid_plan=null, plan_paid_addon=false,
                plan_trial_ends_at=null, plan_trial_used_at=coalesce(plan_trial_used_at, now())
          where id=$1`, [u.id]
      ).catch(() => {});
      notify({ userIds: [u.id], type: 'billing-trial-ended', title: 'Your free trial has ended',
        body: 'You are back on the Starter plan. Nothing you created was removed — upgrade any time to turn the paid features back on.',
        href: '/settings' });
      continue;
    }
    // Auto-renew OFF means the seller scheduled a downgrade (or cancelled): the paid month
    // they were keeping has now ended, so drop to Starter. Without this the plan never
    // actually lapsed — auto-renew-off rows were skipped entirely, so a plan stayed Pro
    // (with SpyDeck) for free forever after its paid-through date.
    if (u.plan_auto_renew === false) {
      await q("update users set plan='starter', spydeck_addon=false, plan_renews_at=null, plan_past_due_since=null, plan_paid_plan=null, plan_paid_addon=false where id=$1", [u.id]).catch(() => {});
      notify({ userIds: [u.id], type: 'billing-downgraded', title: 'Moved to the Starter plan',
        body: 'Your paid plan has ended as scheduled. You can upgrade again any time.', href: '/settings' });
      continue;
    }
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

export function billingRoutes(app, requireAuth, requireAdmin) {
  q('alter table users add column if not exists plan_renews_at timestamptz').catch(() => {});
  q('alter table users add column if not exists plan_auto_renew boolean not null default true').catch(() => {});
  q('alter table users add column if not exists plan_past_due_since timestamptz').catch(() => {});
  // What the CURRENT paid period actually covers — the highest tier/addon paid for before
  // plan_renews_at. Distinct from `plan` (what they're using right now): downgrading
  // mid-month drops the tier they use but does NOT un-pay the month. Without this, going
  // Pro → Starter → Pro inside one paid month charged for Pro twice.
  q('alter table users add column if not exists plan_paid_plan text').catch(() => {});
  q('alter table users add column if not exists plan_paid_addon boolean not null default false').catch(() => {});
  /**
   * TRIALS. Two columns, and both are load-bearing.
   *
   * plan_trial_ends_at marks the current paid-looking period as a TRIAL, which is what
   * stops runRenewals charging for it. Without this a trial is indistinguishable from a
   * subscription: the sweep sees plan='pro' with a renewal date, finds a funded wallet, and
   * silently takes the money from someone who never agreed to pay. That is a chargeback and
   * a broken promise, and it is the DEFAULT behaviour unless a trial is marked.
   *
   * plan_trial_used_at survives the downgrade, so a trial is once per account for ever.
   * Keyed on the user rather than the plan, or a seller cycles pro -> starter -> pro and
   * trials indefinitely.
   */
  q('alter table users add column if not exists plan_trial_ends_at timestamptz').catch(() => {});
  q('alter table users add column if not exists plan_trial_used_at timestamptz').catch(() => {});

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
    const r = await q('select plan, spydeck_addon, plan_renews_at, plan_auto_renew, plan_past_due_since, plan_paid_plan, plan_paid_addon, plan_trial_ends_at, plan_trial_used_at from users where id=$1', [req.user.sub]);
    const u = r.rows[0] || {};
    const active = u.plan_renews_at ? new Date(u.plan_renews_at).getTime() > Date.now() : false;
    // A team member inherits their leader's plan. Resolved here as well as at sign-in so
    // a leader upgrading unlocks it for the team immediately, rather than when each
    // member's 7-day token happens to be re-issued.
    //
    // NB only `plan`/`spydeck_addon` are inherited — renewal dates, auto-renew and the
    // paid-month fields stay the member's OWN, because those describe a subscription
    // they'd be managing and paying for. Inheriting access must not imply inheriting
    // billing control.
    const ent = await resolveEntitlements({ ...req.user, id: req.user.sub, plan: u.plan, spydeck_addon: u.spydeck_addon });
    return {
      plan: ent.plan,
      spydeck_addon: ent.spydeck_addon,
      /** Owner id when this access came from a team leader, else null. */
      inherited_from: ent.inherited_from,
      renews_at: u.plan_renews_at || null,
      auto_renew: u.plan_auto_renew !== false,
      past_due_since: u.plan_past_due_since || null,
      // What THIS paid month already covers, so the client can price a change the same
      // way the server does (and show $0 for a tier that's already bought).
      paid_plan: active ? (u.plan_paid_plan || u.plan || 'starter') : null,
      paid_addon: active ? u.plan_paid_addon === true : false,
      grace_days: GRACE_DAYS,
      // TRIAL STATE, so the UI can count down and say plainly that nothing will be charged.
      // `trial_ends_at` is the member's OWN row, never inherited — a team member is not on a
      // trial because their leader is, and showing them a countdown they cannot act on would
      // be worse than showing nothing.
      trial_ends_at: u.plan_trial_ends_at || null,
      on_trial: !!(u.plan_trial_ends_at && new Date(u.plan_trial_ends_at).getTime() > Date.now()),
      trial_used: !!u.plan_trial_used_at,
      balance: await balanceOf(req.user.sub),
      prices: { plans: PLAN_PRICES, spydeck_addon: SPYDECK_ADDON_PRICE },
    };
  });

  /**
   * ADMIN GRANTS A TRIAL. Deliberately not self-serve: this is a sales lever, and a
   * self-serve trial on an account that can already spend from a wallet is a free-plan
   * exploit waiting to be found.
   *
   * The three guards are the whole feature:
   *   - one per account, ever (plan_trial_used_at survives the downgrade)
   *   - never over an ACTIVE paid subscription, which would replace something they paid for
   *     with something free and shorter
   *   - auto_renew forced OFF, so that even if this row somehow reached the charging path,
   *     the fallback is "lapse to Starter" rather than "take their money"
   *
   * body: { userId, plan?, days? }
   */
  app.post('/api/billing/trial', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    const userId = String(b.userId || '');
    const plan = b.plan != null ? String(b.plan) : 'pro';
    const days = Math.min(90, Math.max(1, Math.floor(Number(b.days) || 14)));
    if (!userId) { reply.code(400); return { error: 'userId is required' }; }
    if (!PLANS.includes(plan) || plan === 'starter') { reply.code(400); return { error: 'Trial plan must be pro or enterprise' }; }

    const cur = (await q('select id, role, plan, plan_renews_at, plan_trial_used_at from users where id=$1', [userId])).rows[0];
    if (!cur) { reply.code(404); return { error: 'No such account' }; }
    if (cur.role && cur.role !== 'seller') { reply.code(400); return { error: 'Staff accounts do not have a subscription plan.' }; }
    if (cur.plan_trial_used_at) { reply.code(409); return { error: 'This account has already had a trial.' }; }
    if (cur.plan_renews_at && new Date(cur.plan_renews_at).getTime() > Date.now() && cur.plan !== 'starter') {
      reply.code(409); return { error: 'This account already has a paid plan running — a trial would replace it.' };
    }

    const ends = new Date(Date.now() + days * 86400000);
    await q(
      `update users set plan=$1, plan_trial_ends_at=$2, plan_renews_at=$2, plan_auto_renew=false,
              plan_past_due_since=null, plan_paid_plan=null, plan_paid_addon=false
        where id=$3`, [plan, ends, userId]
    );
    audit(req, 'billing.trial_granted', { entityType: 'user', entityId: userId, after: { plan, days, ends_at: ends } });
    notify({ userIds: [userId], type: 'billing-trial-started', title: `Your ${days}-day ${plan} trial has started`,
      body: 'Everything on the plan is unlocked. Nothing will be charged — when the trial ends you go back to Starter unless you upgrade.',
      href: '/settings' });
    return { ok: true, plan, days, trial_ends_at: ends };
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

    const cur = (await q('select plan, spydeck_addon, plan_renews_at, plan_paid_plan, plan_paid_addon from users where id=$1', [req.user.sub])).rows[0] || {};
    const curPlan = cur.plan || 'starter';
    const curAddon = cur.spydeck_addon === true;
    // Is the month they already paid for still running?
    const periodEnd = cur.plan_renews_at ? new Date(cur.plan_renews_at).getTime() : 0;
    const activePeriod = periodEnd > Date.now();
    const paidPlan = activePeriod ? (cur.plan_paid_plan || curPlan) : curPlan;
    const paidAddon = activePeriod ? cur.plan_paid_addon === true : false;

    const plan = b.plan != null ? String(b.plan) : curPlan;
    if (!PLANS.includes(plan)) { reply.code(400); return { error: 'Invalid plan' }; }
    if (plan === 'enterprise' && curPlan !== 'enterprise') {
      reply.code(400); return { error: 'Enterprise is set up with our team — contact sales.' };
    }
    const addon = typeof b.spydeckAddon === 'boolean' ? b.spydeckAddon : curAddon;

    // A DOWNGRADE (a cheaper target) while a paid month is still running is SCHEDULED, not
    // applied now: the seller keeps the tier + SpyDeck they already paid for until
    // plan_renews_at, then drops to Starter. Nothing is charged, and it's reversible before
    // the date — re-arming auto-renew ("Keep <plan>") cancels the scheduled drop. This is
    // the industry-standard deferred downgrade; applying it immediately would strip access
    // that's already been paid for. Mechanically it's exactly "auto-renew off": the plan
    // runs out the paid month, then runRenewals lapses it to Starter.
    const curMonthly = (PLAN_PRICES[curPlan] || 0) + (curAddon ? SPYDECK_ADDON_PRICE : 0);
    const tgtMonthly = (PLAN_PRICES[plan] || 0) + (addon ? SPYDECK_ADDON_PRICE : 0);
    if (tgtMonthly < curMonthly && activePeriod) {
      await q('update users set plan_auto_renew=false where id=$1', [req.user.sub]);
      audit(req, 'billing.subscribe', {
        entityType: 'user', entityId: req.user.sub,
        before: { plan: curPlan, spydeck_addon: curAddon, auto_renew: true },
        after: { scheduled_plan: plan, scheduled_addon: addon, auto_renew: false, charged: 0 },
      });
      return {
        ok: true, plan: curPlan, spydeck_addon: curAddon, charged: 0,
        auto_renew: false, renews_at: cur.plan_renews_at || null,
        scheduled: { plan, spydeck_addon: addon, at: cur.plan_renews_at || null },
        balance: await balanceOf(req.user.sub),
      };
    }

    // Charge only what's being ADDED this month, measured against the BEST tier this
    // period has already been paid for — not merely the tier in use. So Pro → Starter →
    // Pro inside one paid month is free the second time: that month's Pro is bought.
    // Upgrading past what's paid for still charges the difference.
    const baseline = PLAN_PRICES[paidPlan] >= PLAN_PRICES[curPlan] ? paidPlan : curPlan;
    const planCharge = PLAN_PRICES[plan] > PLAN_PRICES[baseline] ? PLAN_PRICES[plan] - PLAN_PRICES[baseline] : 0;
    const addonCharge = addon && !(curAddon || paidAddon) ? SPYDECK_ADDON_PRICE : 0;
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

    // Keep the existing paid-through date while that month is still running — changing
    // tier mid-period must NOT silently buy another month (an upgrade pays the delta for
    // the remainder, a downgrade keeps the days already bought). Only start a fresh month
    // when there's no live period. Nothing paid and nothing to run out ⇒ no renewal date.
    const renews = activePeriod
      ? new Date(periodEnd)
      : (plan === 'starter' && !addon ? null : monthFromNow());
    // What this period covers is the HIGH-WATER mark: dropping to Starter for a week
    // doesn't refund the month, so coming back to Pro within it is already paid for.
    const nextPaidPlan = PLAN_PRICES[plan] >= PLAN_PRICES[paidPlan] ? plan : paidPlan;
    const nextPaidAddon = addon || paidAddon;
    // Paying for a plan re-arms renewal and clears any past-due state — otherwise someone
    // who had lapsed would pay and then silently lapse again next month.
    await q(`update users set plan=$1, spydeck_addon=$2, plan_renews_at=$3, plan_auto_renew=true,
             plan_past_due_since=null, plan_paid_plan=$4, plan_paid_addon=$5 where id=$6`,
      [plan, addon, renews, renews ? nextPaidPlan : null, renews ? nextPaidAddon : false, req.user.sub]);

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
