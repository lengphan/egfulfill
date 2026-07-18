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

export function billingRoutes(app, requireAuth) {
  q('alter table users add column if not exists plan_renews_at timestamptz').catch(() => {});

  // What the seller is on now + what things cost. Prices come from here, not the client,
  // so the confirm dialog can show the true amount.
  app.get('/api/billing/plan', { preHandler: requireAuth }, async (req) => {
    const r = await q('select plan, spydeck_addon, plan_renews_at from users where id=$1', [req.user.sub]);
    const u = r.rows[0] || {};
    return {
      plan: u.plan || 'starter',
      spydeck_addon: u.spydeck_addon === true,
      renews_at: u.plan_renews_at || null,
      balance: await balanceOf(req.user.sub),
      prices: { plans: PLAN_PRICES, spydeck_addon: SPYDECK_ADDON_PRICE },
    };
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
    await q('update users set plan=$1, spydeck_addon=$2, plan_renews_at=$3 where id=$4',
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
