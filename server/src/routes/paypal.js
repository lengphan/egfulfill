// PayPal wallet top-up (Orders API v2). Fully automatic: the buyer approves in the
// PayPal Buttons, we capture server-side, and on COMPLETED the seller's wallet is
// credited + recorded. Works with sandbox keys for testing, live keys in prod.
//
// .env:  PAYPAL_CLIENT_ID=...  PAYPAL_SECRET=...  PAYPAL_ENV=sandbox|live
// Credentials are read at CALL time: Settings › Integrations writes them to the DB and
// into process.env live, but a boot-time `const` would pin the old value until a redeploy.
import { notify } from './notifications.js';
import { nextTopupRef } from '../topup-ref.js';
import { q } from '../db.js';
import { recordUsage } from '../usage.js';

const cidKey = () => (process.env.PAYPAL_CLIENT_ID || '').trim();
const secKey = () => (process.env.PAYPAL_SECRET || '').trim();
const ENV = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase();
const BASE = ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

async function ppToken() {
  if (!cidKey() || !secKey()) throw new Error('Server missing PAYPAL_CLIENT_ID / PAYPAL_SECRET');
  const auth = Buffer.from(cidKey() + ':' + secKey()).toString('base64');
  const r = await fetch(BASE + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('PayPal OAuth failed: ' + (d.error_description || d.error || ('HTTP ' + r.status)));
  return d.access_token;
}

export function paypalRoutes(app, requireAuth) {
  // Designer payout destinations (PayPal account + linked local banks) and the
  // request log. Idempotent so fresh + existing DBs both converge.
  q(`create table if not exists payout_accounts (
       id          serial primary key,
       seller_id   uuid references users(id) on delete cascade,
       provider    text not null,                 -- 'paypal' | 'bank'
       handle      text,                           -- paypal email OR bank account number
       label       text,                           -- bank name (banks)
       meta        jsonb default '{}',             -- { name, last4 }
       is_default  boolean not null default false,
       created_at  timestamptz default now())`).catch(() => {});
  q('create index if not exists payout_accounts_seller_idx on payout_accounts(seller_id)').catch(() => {});
  q(`create table if not exists payout_requests (
       id          serial primary key,
       seller_id   uuid references users(id) on delete cascade,
       amount_usd  numeric not null,
       destination text,                           -- 'paypal' | 'bank:<id>'
       status      text not null default 'pending',
       created_at  timestamptz default now())`).catch(() => {});

  /** The admin-set top-up floor, shared with every other method. Same key vietqr.js writes. */
  async function belowMin(amt) {
    try {
      const mr = await q("select value from settings where key='vqr_min_usd'");
      const floor = mr.rows[0] != null && mr.rows[0].value != null && mr.rows[0].value !== ''
        ? Math.max(0, Math.round(Number(mr.rows[0].value) || 0)) : 200;
      return (Number(amt) || 0) < floor ? floor : null;
    } catch { return null; }
  }

  /**
   * WHAT PAYPAL COSTS US, AND WHO PAYS IT.
   *
   * Identical in shape to stripe.js, deliberately — the two are one decision wearing two
   * processor names, and a top-up that grosses up on the Card tab but not the PayPal tab is
   * a hole a seller can simply pick from a dropdown. PayPal keeps a cut of every capture
   * (3.49% + 49c on a US commercial transaction), so a $200 top-up landed $192.53 with us and
   * $200 in the seller's wallet. The fee is added ON TOP: the seller is charged more, the
   * wallet is credited exactly what they asked for, and all three figures are on screen
   * before they press anything.
   *
   * IT IS A GROSS-UP, NOT A SURCHARGE. Adding 3.49% of $200 leaves us short, because PayPal
   * takes its percentage of the LARGER total it actually processes.
   *
   * THE RATE HERE IS THE WALLET RATE, and that is why the SDK button disables card funding
   * (see paypal-button.tsx). PayPal charges a different, lower rate for a guest card payment
   * than for a PayPal balance, so allowing both would mean quoting one number and collecting
   * against another — over-charging the seller on exactly the path we told them the price of.
   *
   * Both numbers are settings, not constants: the rate differs by country and by account, and
   * a rate typed into code is one nobody can correct when it changes.
   */
  async function feeCfg() {
    const def = { pct: 3.49, fixed: 0.49 };
    try {
      const r = await q("select key, value from settings where key in ('paypal_fee_pct','paypal_fee_fixed')");
      const by = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
      const pct = Number(by.paypal_fee_pct);
      const fixed = Number(by.paypal_fee_fixed);
      return {
        // A rate at or above 100% would divide by zero or go negative below.
        pct: Number.isFinite(pct) && pct >= 0 && pct < 50 ? pct : def.pct,
        fixed: Number.isFinite(fixed) && fixed >= 0 ? fixed : def.fixed,
      };
    } catch { return def; }
  }
  /** Rounded UP to the cent: rounding down leaves us paying the last cent of every top-up. */
  const grossUp = (want, cfg) => Math.ceil(((want + cfg.fixed) / (1 - cfg.pct / 100)) * 100) / 100;

  /**
   * A SAVED PAYPAL ACCOUNT — the vault, and why the first payment still opens PayPal.
   *
   * PayPal will never let us collect somebody's PayPal login on our own page, and we must
   * never build anything that looks like it does. What Vault gives instead is CONSENT ONCE:
   * the first top-up goes through PayPal's window as normal and, with `attributes.vault` on
   * the order, PayPal hands back a token for the account on success. Every later top-up is
   * created and captured server-side against that token — no popup, no second login, a
   * button on our own page. Exactly the shape stripe.js already has for saved cards.
   *
   * WE STORE A TOKEN, NEVER A FUNDING SOURCE. The card list the buyer sees inside PayPal
   * (their VIB card, their Standard Chartered debit) is theirs and stays there; we hold an
   * opaque id and a label to show. That is the entire point of a vault — the details we do
   * not have cannot leak from us.
   *
   * `customer_id` is ours to mint and must be STABLE per seller: PayPal keys the vault to
   * it, so a regenerated one orphans every token that seller has saved.
   */
  q(`create table if not exists paypal_vault (
       id          serial primary key,
       seller_id   uuid references users(id) on delete cascade,
       customer_id text not null,
       token_id    text not null unique,
       label       text,
       created_at  timestamptz default now())`).catch(() => {});
  q('create index if not exists paypal_vault_seller_idx on paypal_vault(seller_id)').catch(() => {});

  /** The seller's PayPal customer id — minted once, then read forever. */
  async function customerFor(user) {
    const ex = await q('select customer_id from paypal_vault where seller_id=$1 limit 1', [user.sub])
      .then((r) => r.rows[0]).catch(() => null);
    if (ex && ex.customer_id) return ex.customer_id;
    /* Derived from the user id rather than random, so a seller whose only vault row was
       deleted comes back to the SAME customer at PayPal instead of a second one. */
    return 'eg-' + String(user.sub).replace(/-/g, '').slice(0, 22);
  }

  // The client-id is public (it goes in the PayPal JS SDK URL); the frontend fetches it.
  // `fee` rides along so the dialog can price the top-up before it creates an order.
  app.get('/api/paypal/config', { preHandler: requireAuth }, async () => ({ clientId: cidKey(), env: ENV, enabled: !!(cidKey() && secKey()), fee: await feeCfg() }));

  app.get('/api/paypal/test', { preHandler: requireAuth }, async () => {
    try { await ppToken(); return { ok: true, env: ENV }; } catch (e) { return { ok: false, error: e.message }; }
  });

  // 1) Create an order for the entered amount (USD).
  app.post('/api/paypal/create-order', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const body = req.body || {};
      const amt = Number(body.amount) || 0;
      if (amt <= 0) { reply.code(400); return { error: 'Invalid amount' }; }
      // The floor applies here too. It did not, so PayPal was the one funding route that
      // took $5 while every other tab refused anything under the admin-set minimum.
      const floor = await belowMin(amt); if (floor != null) { reply.code(400); return { error: `Minimum top-up is $${floor}.` }; }
      const cfg = await feeCfg();
      /**
       * THE CALLER MUST HAVE SHOWN THE FEE. `withFee` is opt-in, and the default is off.
       *
       * This route has a second caller: the legacy static wallet page (eg-addfunds.js:635),
       * which is still deployed and still reachable, and which shows the seller a plain
       * amount and no breakdown. Grossing up by default would have it bill $207.75 against
       * a screen reading $200 — a surprise on a statement, which is how a fee becomes a
       * dispute, on a page nobody is allowed to edit.
       *
       * So the flag says "I have already put the three figures in front of them". Defaulting
       * OFF means a caller that forgets it makes US absorb the fee, which is a cost; the
       * other default over-charges a seller who was never told, which is a breach. Between
       * those the direction to fail in is not a close call.
       */
      const withFee = (req.body || {}).withFee === true;
      const charge = withFee ? grossUp(amt, cfg) : amt;
      const tok = await ppToken();
      // For the full-page redirect flow the client passes its own return/cancel URLs
      // (same-origin wallet page). PayPal sends the buyer there with ?token=<orderId>
      // appended after they approve, where we capture. application_context is optional;
      // without it the SDK popup flow still works, so only attach it when URLs are given.
      /**
       * SAVE IT ON SUCCESS, if the seller asked. `usage_type: MERCHANT` is what makes the
       * token chargeable later WITHOUT the buyer present — the difference between "remember
       * this for when I come back" and "you may bill me". PayPal shows the consent inside
       * its own window, which is the only place that consent can honestly be given.
       *
       * Opt-in per order, because saving a payment method is a decision, not a side effect
       * of paying once.
       */
      const remember = body.remember === true;
      const customerId = remember ? await customerFor(req.user) : null;

      const order = {
        intent: 'CAPTURE',
        purchase_units: [{
          // PayPal is billed the GROSSED-UP total; the wallet is credited `amt`.
          amount: { currency_code: 'USD', value: charge.toFixed(2) },
          description: 'EGFUL wallet top-up',
          // WHAT TO CREDIT, decided here and read back on capture — never inferred from the
          // amount received, which on a grossed-up order includes the processor's cut.
          // `custom_id` is Orders v2's metadata field and it is echoed on the capture object.
          custom_id: 'credit:' + amt.toFixed(2)
        }]
      };
      if (remember) {
        order.payment_source = {
          paypal: {
            attributes: {
              customer: { id: customerId },
              vault: { store_in_vault: 'ON_SUCCESS', usage_type: 'MERCHANT', permit_multiple_payment_tokens: false },
            },
          },
        };
      }
      if (body.returnUrl && body.cancelUrl) {
        order.application_context = {
          brand_name: 'EGFUL', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING',
          return_url: String(body.returnUrl), cancel_url: String(body.cancelUrl)
        };
      }
      const r = await fetch(BASE + '/v2/checkout/orders', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify(order)
      });
      const d = await r.json().catch(() => ({}));
      recordUsage('paypal', { endpoint: 'create-order', ok: r.ok });
      if (!r.ok || !d.id) { reply.code(400); return { error: 'PayPal create failed: ' + JSON.stringify(d).slice(0, 300) }; }
      const approve = (d.links || []).find(l => l.rel === 'approve' || l.rel === 'payer-action');
      // The three figures the dialog shows before the button. The client must never compute
      // a charge it is about to make somebody agree to.
      return { id: d.id, approveUrl: approve ? approve.href : null, credit: amt, charge, fee: Number((charge - amt).toFixed(2)), feeCfg: cfg, withFee };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // 2) Capture the approved order → returns the captured amount on success.
  app.post('/api/paypal/capture-order', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const id = (req.body || {}).orderID;
      if (!id) { reply.code(400); return { error: 'orderID required' }; }
      const tok = await ppToken();
      const r = await fetch(BASE + '/v2/checkout/orders/' + encodeURIComponent(id) + '/capture', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
      });
      const d = await r.json().catch(() => ({}));
      const cap = d && d.purchase_units && d.purchase_units[0] && d.purchase_units[0].payments
        && d.purchase_units[0].payments.captures && d.purchase_units[0].payments.captures[0];
      const ok = r.ok && d.status === 'COMPLETED' && cap && cap.status === 'COMPLETED';
      recordUsage('paypal', { endpoint: 'capture-order', ok: r.ok });
      if (!ok) { reply.code(400); return { error: 'Capture not completed: ' + JSON.stringify(d).slice(0, 300) }; }
      /* WHAT WAS TAKEN vs WHAT IS CREDITED. `received` is the grossed-up total PayPal actually
         captured; `amount` is what the seller asked for, and the difference is the processor's
         cut, which they pay and we never hold. Read back from the `custom_id` set at creation,
         capped at what actually arrived so a forged value cannot mint balance. An order with
         no custom_id predates the fee — there `received` IS the credit, which is exactly the
         behaviour this route had before, so nothing already in flight changes meaning. */
      const received = Number(cap.amount && cap.amount.value) || 0;
      const tag = String(cap.custom_id || (d.purchase_units[0] && d.purchase_units[0].custom_id) || '');
      const intended = tag.startsWith('credit:') ? Number(tag.slice(7)) : NaN;
      const amount = Number.isFinite(intended) && intended > 0 ? Math.min(intended, received) : received;

      /* WHAT PAYPAL REALLY TOOK, not what we estimated. The capture carries the true figures
         in `seller_receivable_breakdown`, so the row records the fee that was actually
         charged rather than the rate we grossed up by — which is the only way anyone can
         tell later whether the configured rate still matches reality. Currency-guarded: a
         cross-border capture reports its fee in the payee's currency, and a number in the
         wrong currency written into a USD column is worse than a null. */
      const brk = (cap.seller_receivable_breakdown) || {};
      const usdOf = (m) => (m && m.currency_code === 'USD' ? Number(m.value) : NaN);
      const feeUsd = usdOf(brk.paypal_fee);
      const netUsd = usdOf(brk.net_amount);
      const payerEmail = (d.payer && d.payer.email_address) || null;

      /**
       * THE TOKEN, IF PAYPAL VAULTED THE ACCOUNT. Present only when the order asked for it
       * AND the account is enabled for Vault — so its absence is the honest signal that
       * saving did not happen, and the caller is told rather than shown a saved card that
       * is not there. Best-effort: a capture that succeeded must never fail because the
       * bookkeeping for a convenience feature did.
       */
      let savedLabel = null;
      try {
        const vaulted = d.payment_source && d.payment_source.paypal && d.payment_source.paypal.attributes
          && d.payment_source.paypal.attributes.vault;
        const custId = d.payment_source && d.payment_source.paypal && d.payment_source.paypal.attributes
          && d.payment_source.paypal.attributes.customer && d.payment_source.paypal.attributes.customer.id;
        if (vaulted && vaulted.id && String(vaulted.status || '').toUpperCase() === 'VAULTED') {
          savedLabel = payerEmail || 'PayPal account';
          await q(
            `insert into paypal_vault (seller_id, customer_id, token_id, label)
             values ($1,$2,$3,$4) on conflict (token_id) do nothing`,
            [req.user.sub, custId || await customerFor(req.user), vaulted.id, savedLabel]
          );
        }
      } catch (e) { app.log.error('paypal vault record failed: ' + e.message); }

      // Real money in → record it like any top-up so the factory (admin+warehouse) is
      // credited via the same reconcile path. Idempotent per capture: clean sequential
      // EG reference + the PayPal capture id as the transaction id.
      let ref = null;
      try {
        const ex = await q('select ref from topup_requests where txn_id=$1 limit 1', [cap.id]);
        if (ex.rows[0]) { ref = ex.rows[0].ref; }
        else {
          ref = await nextTopupRef();
          const ins = await q(
            `insert into topup_requests
               (seller_id, seller_email, amount_usd, charged_usd, fee_usd, net_usd, payer_email,
                ref, note, status, method, txn_id, confirmed_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,'PayPal top-up','received','PayPal',$9, now())
             returning id`,
            [req.user.sub, req.user.email || null, amount, received,
             Number.isFinite(feeUsd) ? feeUsd : null, Number.isFinite(netUsd) ? netUsd : null,
             payerEmail, ref, cap.id]
          );
          // Credit the wallet — same omission and same fix as stripe.js recordTopup. The
          // capture succeeded, so the money is real; without this row the balance never
          // moves, because balance is SUM(delta) over wallet_ledger and nothing here
          // wrote to it. Idempotent by (account,type,ref) with ref = the topup id.
          const topupId = ins.rows[0] && ins.rows[0].id;
          if (topupId && req.user.sub) {
            await q(
              `insert into wallet_ledger (account, delta, type, ref, note, created_by)
               values ($1,$2,'topup',$3,'PayPal top-up',$4) on conflict do nothing`,
              [req.user.sub, Number(amount) || 0, String(topupId), req.user.sub]
            );
          }
          /* Same as stripe.js: a self-crediting top-up left nothing on an admin's screen to
             say money had arrived. Inside the `else`, so only a NEW capture rings. */
          notify({
            roles: ['admin'],
            type: 'topup-received',
            title: `Top-up received — $${(Number(amount) || 0).toFixed(2)}`,
            body: `${req.user.email || 'A seller'} topped up via PayPal. The wallet is credited.`,
            href: '/wallet',
            entityId: ref,
            excludeUserId: req.user.sub,
          });
        }
      } catch (e) { app.log.error('paypal topup record failed: ' + e.message); }
      return {
        ok: true, amount, charged: received,
        fee: Number.isFinite(feeUsd) ? feeUsd : Number((received - amount).toFixed(2)),
        captureId: cap.id, status: d.status, ref, txnId: cap.id,
        // Null when nothing was saved — which the dialog must not report as "saved".
        saved: savedLabel,
      };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  /**
   * WHAT A TOP-UP WOULD COST, without creating an order.
   *
   * The interactive path gets its three figures from create-order, because it has to create
   * one anyway. The saved-account path must not: creating an order to find out the price
   * leaves an abandoned order at PayPal every time somebody opens the tab and changes their
   * mind. But the figures still have to be on screen before the button — that rule does not
   * soften because the payment is one click — and the client must never compute a charge it
   * is about to make somebody agree to. So the server answers the question directly.
   */
  app.get('/api/paypal/quote', { preHandler: requireAuth }, async (req, reply) => {
    const amt = Number((req.query || {}).amount) || 0;
    if (amt <= 0) { reply.code(400); return { error: 'Invalid amount' }; }
    const floor = await belowMin(amt); if (floor != null) { reply.code(400); return { error: `Minimum top-up is $${floor}.` }; }
    const cfg = await feeCfg();
    const charge = grossUp(amt, cfg);
    return { credit: amt, charge, fee: Number((charge - amt).toFixed(2)), feeCfg: cfg };
  });

  // ── Saved PayPal accounts — the popup happens once, then this ───────────────

  /** The seller's saved accounts. Ours is the label; PayPal holds everything that matters. */
  app.get('/api/paypal/saved', { preHandler: requireAuth }, async (req) => {
    const r = await q('select id, token_id, label, created_at from paypal_vault where seller_id=$1 order by created_at desc', [req.user.sub])
      .catch(() => ({ rows: [] }));
    return r.rows;
  });

  /**
   * Forget an account. PayPal first, our row second — the other order can leave a token
   * live at PayPal that nothing here can see, and an un-deletable billing agreement is a
   * worse thing to leave behind than an orphaned row.
   */
  app.delete('/api/paypal/saved/:id', { preHandler: requireAuth }, async (req, reply) => {
    const row = await q('select token_id from paypal_vault where id=$1 and seller_id=$2', [parseInt(req.params.id, 10) || -1, req.user.sub])
      .then((r) => r.rows[0]).catch(() => null);
    if (!row) { reply.code(404); return { error: 'Not found' }; }
    try {
      const tok = await ppToken();
      const r = await fetch(BASE + '/v3/vault/payment-tokens/' + encodeURIComponent(row.token_id), {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + tok },
      });
      recordUsage('paypal', { endpoint: 'vault-delete', ok: r.ok });
      // 404 means PayPal has already forgotten it, which is the state we were after.
      if (!r.ok && r.status !== 404) { reply.code(400); return { error: 'PayPal would not remove it (HTTP ' + r.status + ')' }; }
    } catch (e) { reply.code(400); return { error: e.message }; }
    await q('delete from paypal_vault where id=$1 and seller_id=$2', [parseInt(req.params.id, 10) || -1, req.user.sub]).catch(() => {});
    return { ok: true };
  });

  /**
   * TOP UP FROM A SAVED ACCOUNT — created and captured here, with no window at all.
   *
   * This is the whole point of the vault: the buyer consented once, in PayPal's own UI, and
   * a merchant-initiated order against that token completes server-side. The fee is grossed
   * up exactly as on the interactive path — the seller has seen the three figures on our own
   * page before pressing, which is what `withFee` asserts everywhere else.
   *
   * ONE CALL, TWO STEPS, AND THE SECOND CAN FAIL. Creating the order is not taking the
   * money; the capture is. So a create that succeeds and a capture that does not must not
   * credit anything — the wallet moves inside the same capture bookkeeping the interactive
   * path uses, keyed on the capture id, so a retry cannot double-credit.
   */
  app.post('/api/paypal/charge-saved', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const b = req.body || {};
      const amt = Number(b.amount) || 0;
      if (amt <= 0) { reply.code(400); return { error: 'Invalid amount' }; }
      const floor = await belowMin(amt); if (floor != null) { reply.code(400); return { error: `Minimum top-up is $${floor}.` }; }
      const row = await q('select token_id, customer_id, label from paypal_vault where id=$1 and seller_id=$2',
        [parseInt(b.savedId, 10) || -1, req.user.sub]).then((r) => r.rows[0]).catch(() => null);
      if (!row) { reply.code(400); return { error: 'That saved PayPal account is not on your account.' }; }

      const cfg = await feeCfg();
      const charge = grossUp(amt, cfg);
      const tok = await ppToken();
      const create = await fetch(BASE + '/v2/checkout/orders', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            amount: { currency_code: 'USD', value: charge.toFixed(2) },
            description: 'EGFUL wallet top-up',
            custom_id: 'credit:' + amt.toFixed(2),
          }],
          payment_source: { paypal: { vault_id: row.token_id } },
        }),
      });
      const cd = await create.json().catch(() => ({}));
      recordUsage('paypal', { endpoint: 'charge-saved-create', ok: create.ok });
      if (!create.ok || !cd.id) { reply.code(400); return { error: 'PayPal refused the saved-account payment: ' + JSON.stringify(cd).slice(0, 300) }; }

      /* Hand the order id back to the same capture route the interactive path uses, rather
         than a second copy of the crediting, the fee reading and the notification. One
         capture path means one place a bug in it can live. */
      return { ok: true, orderID: cd.id, credit: amt, charge, fee: Number((charge - amt).toFixed(2)), label: row.label };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // ── Designer payout accounts (connect PayPal + linked local banks) ───────────
  // List this designer's payout destinations.
  app.get('/api/paypal/payout-account', { preHandler: requireAuth }, async (req) => {
    const r = await q('select id, provider, handle, label, meta, is_default from payout_accounts where seller_id=$1 order by created_at asc', [req.user.sub]);
    return r.rows;
  });

  // Link a PayPal account (one per designer, replaced on re-connect) or add a bank.
  // makeDefault (or first-ever account) becomes the default destination.
  app.post('/api/paypal/payout-account', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    const provider = b.provider === 'bank' ? 'bank' : 'paypal';
    if (provider === 'paypal' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.handle || ''))) { reply.code(400); return { error: 'valid PayPal email required' }; }
    const had = await q('select count(*)::int as n from payout_accounts where seller_id=$1', [req.user.sub]);
    const first = (had.rows[0] && had.rows[0].n) === 0;
    let id;
    if (provider === 'paypal') {
      await q("delete from payout_accounts where seller_id=$1 and provider='paypal'", [req.user.sub]);
      const ins = await q('insert into payout_accounts (seller_id, provider, handle) values ($1,$2,$3) returning id', [req.user.sub, 'paypal', b.handle]);
      id = ins.rows[0].id;
    } else {
      const meta = (b.meta && typeof b.meta === 'object') ? b.meta : {};
      const ins = await q('insert into payout_accounts (seller_id, provider, handle, label, meta) values ($1,$2,$3,$4,$5) returning id', [req.user.sub, 'bank', b.handle || '', b.label || 'Bank', meta]);
      id = ins.rows[0].id;
    }
    if (b.makeDefault || first) {
      await q('update payout_accounts set is_default=false where seller_id=$1', [req.user.sub]);
      await q('update payout_accounts set is_default=true where seller_id=$1 and id=$2', [req.user.sub, id]);
    }
    return { ok: true, id, provider };
  });

  // Choose which destination is the default payout target.
  app.post('/api/paypal/payout-account/default', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    await q('update payout_accounts set is_default=false where seller_id=$1', [req.user.sub]);
    if (b.provider === 'paypal') await q("update payout_accounts set is_default=true where seller_id=$1 and provider='paypal'", [req.user.sub]);
    else await q('update payout_accounts set is_default=true where seller_id=$1 and id=$2', [req.user.sub, parseInt(b.id, 10) || -1]);
    return { ok: true };
  });

  // Remove a destination. ':id' = 'paypal' drops the PayPal link; a number drops a bank.
  app.delete('/api/paypal/payout-account/:id', { preHandler: requireAuth }, async (req) => {
    const id = req.params.id;
    if (id === 'paypal') await q("delete from payout_accounts where seller_id=$1 and provider='paypal'", [req.user.sub]);
    else await q('delete from payout_accounts where seller_id=$1 and id=$2', [req.user.sub, parseInt(id, 10) || -1]);
    return { ok: true };
  });

  // Record a payout REQUEST. Intentionally does NOT move money — it logs a pending
  // request that an admin releases through the existing payout flow, so there's no
  // unguarded self-service money path. (The PayPal Payouts API call belongs on that
  // admin release step.)
  app.post('/api/paypal/payout', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    const amt = Number(b.amount) || 0;
    if (amt <= 0) { reply.code(400); return { error: 'invalid amount' }; }
    const acct = await q('select count(*)::int as n from payout_accounts where seller_id=$1', [req.user.sub]);
    if (!(acct.rows[0] && acct.rows[0].n)) { reply.code(400); return { error: 'no payout account linked' }; }
    const r = await q('insert into payout_requests (seller_id, amount_usd, destination, status) values ($1,$2,$3,$4) returning id, created_at',
      [req.user.sub, amt, String(b.account || ''), 'pending']);
    return { ok: true, id: r.rows[0].id, status: 'pending', requestedAt: r.rows[0].created_at };
  });
}
