// EGFUL API — Fastify entry point.
import crypto from 'node:crypto';
import { limited } from './ratelimit.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { signup, login, verify, isStaff, googleAuth, normalizeUsername, ensureUsernameColumn, renewIfStale, EMAIL_RE } from './auth.js';
import { q } from './db.js';
import { ordersRoutes } from './routes/orders.js';
import { orderRefundRoutes } from './routes/order_refunds.js';
import { inventoryRoutes } from './routes/inventory.js';
import { designCardsRoutes } from './routes/design_cards.js';
import { designImagesRoutes } from './routes/design_images.js';
import { catalogRoutes } from './routes/catalog.js';
import { partnerTemplatesRoutes } from './routes/partner_templates.js';
import { etsyRoutes } from './routes/etsy.js';
import { tiktokRoutes } from './routes/tiktok.js';
import { shopifyRoutes } from './routes/shopify.js';
import { publishRoutes } from './routes/publish.js';
import { ssRoutes } from './routes/ss.js';
import { ottoCapRoutes } from './routes/ottocap.js';
import { sanmarRoutes } from './routes/sanmar.js';
import { usersRoutes } from './routes/users.js';
import { uspsRoutes } from './routes/usps.js';
import { templatesRoutes } from './routes/templates.js';
import { billingRoutes } from './routes/billing.js';
import { planRoutes } from './routes/plan.js';
import { consignmentRoutes } from './routes/consignment.js';
import { mailIngestRoutes } from './routes/mail_ingest.js';
import { vietqrRoutes } from './routes/vietqr.js';
import { topupsRoutes } from './routes/topups.js';
import { payoutsRoutes } from './routes/payouts.js';
import { paypalRoutes } from './routes/paypal.js';
import { stripeRoutes } from './routes/stripe.js';
import { passwordResetRoutes } from './routes/password-reset.js';
import { shippingRoutes } from './routes/shipping.js';
import { designLibraryRoutes } from './routes/design_library.js';
import { designFilesRoutes } from './routes/design_files.js';
import { sheetsRoutes } from './routes/sheets.js';
import { walletRoutes } from './routes/wallet.js';
import { cashAccountRoutes } from './routes/cash_accounts.js';
import { factoryListsRoutes } from './routes/factory_lists.js';
import { teamRoutes } from './routes/team.js';
import { sandboxRoutes, authKey, keyAllows } from './routes/sandbox.js';
import { webhookRoutes } from './webhooks.js';
import { adminSecretsRoutes } from './routes/admin_secrets.js';
import { brandingRoutes } from './routes/branding.js';
import { wilcomRoutes } from './routes/wilcom.js';
import { usageRoutes } from './routes/usage.js';
import { auditRoutes } from './audit.js';
import { publicSupportRoutes } from './routes/public_support.js';
import { supportAiRoutes } from './routes/support_ai.js';
import { factorySettingsRoutes } from './routes/factory_settings.js';
import { navVisibilityRoutes } from './routes/nav_visibility.js';
import { purchaseRoutes } from './routes/purchase.js';
import { spydeckRoutes } from './routes/spydeck.js';
import { notificationRoutes } from './routes/notifications.js';
import { adsRoutes } from './routes/ads.js';
import { broadcastsRoutes } from './routes/broadcasts.js';
import { siteContentRoutes } from './routes/site_content.js';
import { sendMail } from './mailer.js';
import { welcomeEmail } from './emails.js';
import { dispatchRoutes } from './routes/dispatch.js';
import { ssOrderStatus } from './routes/ss.js';
import { startSupplierPoll } from './supplier-poll.js';
import { manifestRoutes } from './routes/manifests.js';
import { manualSupplierRoutes } from './routes/manual_suppliers.js';
import { alibabaRoutes } from './routes/alibaba.js';
import { pinkDesignRoutes } from './routes/pinkdesign.js';
import { backupRoutes } from './routes/backup.js';
import { piiRetentionRoutes } from './routes/pii_retention.js';
import { addClient } from './events.js';
import { storageEnabled, putObject, deleteObject, presignGet, publicUrl, designUrlTtlDays } from './storage.js';

// Catalog products embed base64 image data URLs (mockups, color images), so the
// default 1MB body limit is far too small. Bounded by the browser's localStorage
// quota (~5-10MB total), so 25MB is plenty of headroom.
// 60MB body limit: full-resolution print files (e.g. 4000×5000 PNG ~10-25MB) are
// ~33% larger as base64, so 25MB could silently reject a legit design upload.
const app = Fastify({ logger: true, bodyLimit: 60 * 1024 * 1024 });
await app.register(cors, { origin: process.env.CORS_ORIGIN || '*' });

// Shopify webhooks HMAC-sign the EXACT request bytes, so those routes need the raw
// body — but Fastify's JSON parser discards it. Override the parser to stash the raw
// buffer ONLY when Shopify's signature header is present, so we don't hold a second
// copy of every 60MB design upload. Everything else parses exactly as before.
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  if (req.headers['x-shopify-hmac-sha256']) req.rawBody = body;
  if (!body || body.length === 0) { done(null, {}); return; }
  try { done(null, JSON.parse(body.toString('utf8'))); }
  catch (e) { e.statusCode = 400; done(e, undefined); }
});

// Form-encoded bodies. Nothing in the app posts one — this exists for RFC 8058 one-click
// unsubscribe: Gmail and Yahoo POST `List-Unsubscribe=One-Click` as x-www-form-urlencoded,
// and with no parser registered Fastify answers 415 before the route is ever reached. A
// bulk sender whose one-click endpoint 415s gets its mail throttled.
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
  try { done(null, Object.fromEntries(new URLSearchParams(body))); }
  catch (e) { e.statusCode = 400; done(e, undefined); }
});

// Attach req.user from the Bearer token on every request (null if not signed in).
//
// A still-valid token past half its life is reissued here and handed back on the response,
// so an ACTIVE session never reaches the 7-day wall. Without this every signed-in person was
// logged out a week after signing in, mid-task and without warning. An abandoned session
// still ages out normally: renewal only happens on a real request.
//
// The header must be named in Access-Control-Expose-Headers or a cross-origin caller
// (app.egful.store → api.egful.store) cannot read it, and the renewal would be invisible.
app.addHook('onRequest', async (req, reply) => {
  const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  req.user = m ? verify(m[1]) : null;
  if (req.user) {
    const fresh = renewIfStale(req.user);
    if (fresh) {
      reply.header('X-Session-Token', fresh);
      reply.header('Access-Control-Expose-Headers', 'X-Session-Token');
    }
  }
});
function requireAuth(req, reply, done) {
  if (!req.user) { reply.code(401).send({ error: 'Not signed in' }); return; }
  done();
}
function requireStaff(req, reply, done) {
  if (!isStaff(req.user)) { reply.code(403).send({ error: 'Staff only' }); return; }
  done();
}
/**
 * Warehouse or admin — CUSTODY + SPEND.
 *
 * requireStaff includes operator, and several routes that change physical stock or spend
 * money were sitting behind it while the UI merely hid the buttons: the Scan station
 * renders read-only for an operator, Dispatch renders view-only, and neither was enforced
 * server-side. An operator's zone ends at the scan (see stageDenial in routes/orders.js);
 * this makes that true off the order table too.
 *
 * Designer never reaches these — it isn't warehouse or admin.
 */
function requireWarehouse(req, reply, done) {
  const role = req.user && req.user.role;
  if (role !== 'admin' && role !== 'warehouse') {
    reply.code(403).send({ error: 'Warehouse or admin only' });
    return;
  }
  done();
}

/**
 * Design-side staff — operator, designer, admin. EXCLUDES WAREHOUSE.
 *
 * Sits between requireStaff and requireAdmin because the design tools are neither: they
 * aren't admin-only (a designer's whole job runs through them) but they aren't the floor's
 * either, and each Wilcom/Pink Design call bills. Warehouse still sees the ARTWORK on the
 * orders it fulfils — design_files and design_images are requireAuth and untouched — it just
 * can't spend money digitising or commissioning it.
 *
 * Designer never reaches requireWarehouse, and warehouse never reaches this: the two
 * mid-tier gates are deliberately disjoint rather than nested.
 */
function requireDesignStaff(req, reply, done) {
  const role = req.user && req.user.role;
  if (role !== 'admin' && role !== 'operator' && role !== 'designer') {
    reply.code(403).send({ error: 'Design staff only' });
    return;
  }
  done();
}

/**
 * Who may write and send a seller broadcast: ADMIN or OPERATOR.
 *
 * Not requireStaff — that also admits designer and warehouse, neither of whom has any
 * reason to mail the customer base, and this is still the least reversible action in the
 * product: there is no unsend and the blast radius is every seller. Operators are included
 * because they are the people who actually send announcements (owner's call, 2026-08-10);
 * the confirm screen, which now lists every recipient and can be edited, is what makes that
 * safe rather than the role gate alone.
 */
function requireBroadcaster(req, reply, done) {
  const role = req.user && req.user.role;
  if (role !== 'admin' && role !== 'operator') { reply.code(403).send({ error: 'Admin or operator only' }); return; }
  done();
}

function requireAdmin(req, reply, done) {
  if (!req.user || req.user.role !== 'admin') { reply.code(403).send({ error: 'Admin only' }); return; }
  done();
}

app.get('/health', async () => ({ ok: true }));

/**
 * Object-storage self-test. Writes a tiny object, signs a link for it, fetches it back,
 * then deletes it — so a pass means credentials, signing AND retrieval all really work,
 * not just that some env vars are set.
 *
 * This exists because the failure mode is SILENT: if storage is misconfigured, design
 * uploads quietly fall back to inline base64 with nothing but a log line, and everything
 * looks fine until an outside partner needs a URL that was never created.
 */
/**
 * Mail self-test. Says which transport is live and, given ?to=, actually sends.
 *
 * This exists because "which SMTP or keys actually send forgot-password mail" has been
 * an open question in the docs, and it is unanswerable by reading code: sendMail()
 * deliberately never throws, so every caller treats a total mail outage as success. A
 * seller clicking "forgot password" gets the same reassuring message whether a mail went
 * out or nothing happened at all.
 *
 * ADMIN-only and send-on-request: this puts real mail on your sending reputation, so it
 * must not be something an operator can trigger by loading a page.
 */
app.get('/api/admin/mail-diag', { preHandler: requireAdmin }, async (req) => {
  const { mailConfigured, sendMail, lastMailError } = await import('./mailer.js');
  const transport = process.env.BREVO_API_KEY ? 'brevo-api'
    : (process.env.SMTP_HOST ? 'smtp' : null);
  const cfg = {
    configured: mailConfigured(),
    transport,
    from: process.env.SMTP_FROM || process.env.MAIL_FROM || null,
    // BROADCASTS SEND FROM A DIFFERENT ADDRESS. Bulk mail goes out as MAIL_FROM_BULK — a
    // marketing subdomain authenticated separately, so a campaign that trips a spam filter
    // can't drag down the domain password resets depend on. It is therefore verified
    // separately in Brevo too, which means this diag could pass on the transactional sender
    // while every broadcast was rejected for an unverified bulk one. Report both, and let
    // ?bulk=1 send the test AS the bulk sender so broadcasts can actually be diagnosed.
    from_bulk: process.env.MAIL_FROM_BULK || null,
    bulk_falls_back_to_transactional: !process.env.MAIL_FROM_BULK,
    smtp_host: process.env.SMTP_HOST || null,
    // What each feature does when mail is off, so the answer is actionable rather than
    // just a red cross.
    affects: {
      password_reset: 'Falls back to an admin-visible reset request; the seller is never emailed a link.',
      team_invites: 'Invite email silently not sent — the link must be passed on by hand.',
      topup_alerts: 'Admins are not emailed when a top-up needs review.',
      signup: 'The welcome email is not sent; the account is still created and usable.',
    },
  };
  if (!cfg.configured) {
    return { ...cfg, ok: false, error: 'No mail transport configured. Set BREVO_API_KEY (works on hosts that block SMTP ports) or SMTP_HOST.' };
  }
  const to = String((req.query || {}).to || '').trim();
  if (!to) return { ...cfg, ok: null, note: 'Configured. Add ?to=you@example.com to actually send a test message.' };
  // ?bulk=1 → send as the BROADCAST sender, which is the one to test when broadcasts fail.
  const bulk = String((req.query || {}).bulk || '') === '1';
  const asFrom = bulk ? (process.env.MAIL_FROM_BULK || undefined) : undefined;
  const which = bulk ? 'bulk' : 'transactional';
  const sent = await sendMail({
    to,
    from: asFrom,
    subject: `EGFUL mail test (${which})`,
    text: `If you are reading this, ${which} email is working.`,
    html: `<p>If you are reading this, ${which} email is working.</p>`,
  });
  return {
    ...cfg, ok: sent, sent_to: to, tested: which,
    sent_from: bulk ? (process.env.MAIL_FROM_BULK || cfg.from) : cfg.from,
    error: sent ? null : (lastMailError() || 'send failed for an unknown reason'),
  };
});

app.get('/api/admin/storage-diag', { preHandler: requireStaff }, async () => {
  const cfg = {
    configured: storageEnabled(),
    bucket: process.env.SPACES_BUCKET || null,
    endpoint: process.env.SPACES_ENDPOINT || null,
    region: process.env.SPACES_REGION || null,
    linkTtlDays: designUrlTtlDays(),
    mode: designUrlTtlDays() > 0 ? 'private + signed links' : 'public-read + permanent links',
  };
  if (!cfg.configured) {
    return { ...cfg, ok: false, error: 'Not configured — design uploads stay inline base64. Set SPACES_ENDPOINT / SPACES_BUCKET / SPACES_KEY / SPACES_SECRET.' };
  }
  const key = `_diag/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  const probe = 'egfulfill storage check';
  try {
    await putObject(key, Buffer.from(probe), 'text/plain', cfg.linkTtlDays > 0 ? 'private' : 'public-read');
    const url = cfg.linkTtlDays > 0 ? presignGet(key, 300) : publicUrl(key);
    const res = await fetch(url);
    const body = res.ok ? (await res.text()).trim() : null;
    await deleteObject(key).catch(() => {});
    if (!res.ok) return { ...cfg, ok: false, wrote: true, readStatus: res.status, error: `Upload worked but the link returned ${res.status} — check the token has Object Read as well as Write.` };
    if (body !== probe) return { ...cfg, ok: false, wrote: true, error: 'Fetched object did not match what was written.' };
    return { ...cfg, ok: true, wrote: true, read: true, note: 'Uploads now go to object storage; Postgres keeps only the key.' };
  } catch (e) {
    await deleteObject(key).catch(() => {});
    return { ...cfg, ok: false, error: e.message };
  }
});

// ── Auth ──
app.post('/api/auth/signup', async (req, reply) => {
  try {
    const res = await signup(req.body || {});
    // Best-effort welcome email. Fire-and-forget AFTER the account exists: a mail hiccup
    // must never fail a signup, and the user already has their session from `res`. sendMail
    // never throws and is a no-op when mail is off.
    if (res && res.user && res.user.email) {
      const { subject, text, html } = welcomeEmail(res.user.name);
      sendMail({ to: res.user.email, subject, text, html }).catch(() => {});
    }
    return res;
  } catch (e) { reply.code(400); return { error: e.message }; }
});

/**
 * BRUTE-FORCE GUARD on the credential routes.
 *
 * ratelimit.js existed but its own header says what it is for: "per-API-key rate limiting
 * for the public API". It is keyed to partner keys and wired into sandbox.js, so nothing
 * throttled login at all — verified against production: eight rapid attempts, no delay.
 *
 * That matters more here than usual because sign-in accepts an EMAIL OR A USERNAME, so an
 * attacker does not need to know an address to spray.
 *
 * TWO counters, because they stop different attacks and either alone leaves a hole:
 *   per IP       one host trying many accounts (spray / enumeration)
 *   per identity many hosts trying one account (distributed guess at a known user)
 * The identity is lower-cased so casing cannot mint a fresh budget, and hashed so an
 * in-memory key never holds a plaintext address.
 *
 * Counted on EVERY attempt rather than only on failures. Counting failures lets someone
 * interleave a known-good login to keep their budget topped up, and a legitimate person
 * does not sign in ten times a minute.
 *
 * Honest limits: in-process and per-container, so these reset on deploy — the same caveat
 * ratelimit.js already documents. It raises the cost of a spray by orders of magnitude; it
 * is not a substitute for a real WAF if this ever runs behind one.
 */
const AUTH_IP_MAX = 20;        // per IP, per 10 min
const AUTH_ID_MAX = 8;         // per account, per 10 min
const AUTH_WINDOW = 10 * 60 * 1000;
function authThrottled(req, reply, identity) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown';
  const byIp = limited(reply, `auth-ip:${ip}`, AUTH_IP_MAX, AUTH_WINDOW);
  if (byIp) return byIp;
  const id = String(identity || '').trim().toLowerCase();
  if (!id) return null;
  const key = crypto.createHash('sha256').update(id).digest('hex').slice(0, 24);
  return limited(reply, `auth-id:${key}`, AUTH_ID_MAX, AUTH_WINDOW);
}

app.post('/api/auth/login', async (req, reply) => {
  const b = req.body || {};
  const stop = authThrottled(req, reply, b.username || b.email);
  if (stop) return stop;
  try { return await login(b); }
  catch (e) { reply.code(400); return { error: e.message }; }
});
app.get('/api/me', { preHandler: requireAuth }, async (req) => req.user);

// Update the signed-in user's own profile (currently just the display name). The JWT
// carries sub/role/email (not name), so a name change needs no re-issue — the client
// just refreshes its cached user.
app.patch('/api/me', { preHandler: requireAuth }, async (req, reply) => {
  const b = req.body || {};
  const sets = [], vals = [];
  const put = (col, val) => { vals.push(val); sets.push(col + '=$' + vals.length); };

  if (typeof b.name === 'string') put('name', b.name.trim().slice(0, 120));
  // Avatar is cosmetic: an emoji + a hex colour, or null to clear back to the
  // name's initial. Both are validated — this string is rendered on every page,
  // so only ever store an actual emoji / #rrggbb, never arbitrary user text.
  if (b.avatar_emoji !== undefined) {
    const e = b.avatar_emoji === null ? null : String(b.avatar_emoji).trim();
    if (e && [...e].length > 2) { reply.code(400); return { error: 'Avatar must be a single emoji' }; }
    put('avatar_emoji', e || null);
  }
  if (b.avatar_color !== undefined) {
    const c = b.avatar_color === null ? null : String(b.avatar_color).trim();
    if (c && !/^#[0-9a-f]{6}$/i.test(c)) { reply.code(400); return { error: 'Avatar colour must be a #rrggbb hex' }; }
    put('avatar_color', c || null);
  }
  if (b.notify_sound !== undefined) put('notify_sound', !!b.notify_sound);
  // Username — a second way to sign in, so it carries the same 12-character floor as the
  // password. null/'' clears it back to email-only.
  if (b.username !== undefined) {
    await ensureUsernameColumn().catch(() => {});
    // ONE exemption, and it isn't a choice: an account whose stored "email" is really a
    // username (see the repair below) submits that identifier here, and it may predate the
    // floor. Holding it to 12 characters wouldn't strengthen anything — the string already
    // exists and is what they sign in with — it would just refuse to save the repair. Any
    // other value, including a different short one, is a NEW username and is held to it.
    const cur = (await q('select email, username from users where id=$1', [req.user.sub])).rows[0] || {};
    const own = !EMAIL_RE.test(String(cur.email || '')) && String(cur.email || '').toLowerCase();
    const moving = !!own && String(b.username || '').trim().toLowerCase() === own;
    try { put('username', b.username === null || b.username === '' ? null : normalizeUsername(b.username, { grandfather: moving })); }
    catch (e) { reply.code(400); return { error: e.message }; }
  }
  /**
   * EMAIL: A REPAIR, NOT AN EDIT.
   *
   * Signup used to accept any string in the email column — the form said "Email/Username" —
   * so accounts exist whose email IS a username ("haianhseller"). Those people cannot reset
   * a password, because nothing can be sent anywhere, and the app shows a username under a
   * field labelled Email. Signup validates now, but the rows already written don't fix
   * themselves.
   *
   * So this accepts an email ONLY when the stored one is not an address. A working email is
   * the recovery route for the whole account, and letting it be changed from a live session
   * turns a borrowed browser into a permanent takeover — that stays a support action.
   *
   * The old identifier is not thrown away: it moves into `username`, which is what they have
   * been signing in with. Losing it here would lock them out while "fixing" their account.
   */
  if (typeof b.email === 'string') {
    const cur = (await q('select email, username from users where id=$1', [req.user.sub])).rows[0] || {};
    if (EMAIL_RE.test(String(cur.email || ''))) {
      reply.code(403);
      return { error: 'Your email is already set. Ask support to change it.' };
    }
    const next = String(b.email).trim().toLowerCase();
    if (!EMAIL_RE.test(next)) { reply.code(400); return { error: 'Enter a real email address.' }; }
    put('email', next);
    // Only when the caller isn't setting one itself — two puts of the same column would
    // write it twice in one statement.
    if (b.username === undefined && !cur.username && cur.email) {
      await ensureUsernameColumn().catch(() => {});
      // grandfather: this identifier already exists and is only MOVING columns. Holding it
      // to the 12-character floor would silently drop the string they sign in with, which
      // is the lock-out this whole branch exists to avoid.
      try { put('username', normalizeUsername(cur.email, { grandfather: true })); } catch { /* not a legal username; let it go */ }
    }
  }
  if (!sets.length) { reply.code(400); return { error: 'Nothing to update' }; }

  vals.push(req.user.sub);
  let r;
  try {
    r = await q(
      'update users set ' + sets.join(', ') + ' where id=$' + vals.length + ' returning id, email, username, role, name, avatar_emoji, avatar_color, notify_sound',
      vals
    );
  } catch (e) {
    /**
     * TWO UNIQUE CONSTRAINTS, AND THIS BLAMED ONE OF THEM FOR BOTH.
     *
     * `users_email_key` and `users_username_lower_idx` both raise 23505, and every one of
     * them came back as "That username is already taken" — so repairing a placeholder
     * email to an address another account already holds produced a USERNAME error under a
     * field labelled Email, about a field this form doesn't even show. The person is left
     * to guess which of the two things they typed was wrong, when neither was: the address
     * simply belongs to somebody else.
     *
     * Same test signup() has used since usernames existed (auth.js) — Postgres names the
     * index it tripped, so there is nothing to infer.
     */
    if (e.code === '23505') {
      reply.code(409);
      return { error: String(e.detail || e.constraint || '').includes('username')
        ? 'That username is already taken'
        : 'That email is already registered to another account.' };
    }
    throw e;
  }
  if (!r.rows.length) { reply.code(404); return { error: 'User not found' }; }
  return r.rows[0];
});

// ── Realtime (SSE) — one-way push so boards + mobile update the instant something
// changes, instead of waiting for the poll. EventSource can't send headers, so the
// JWT comes in ?token=. A heartbeat keeps proxies (Caddy) from closing the stream.
app.get('/api/events', (req, reply) => {
  const tok = (req.query && req.query.token) || '';
  const user = tok ? verify(tok) : null;
  if (!user) { reply.code(401).send({ error: 'Not signed in' }); return; }
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*'
  });
  res.write('retry: 3000\n\n:ok\n\n');
  const remove = addClient(res, user);   // bind the socket to WHO it belongs to
  const hb = setInterval(() => { try { res.write(':hb\n\n'); } catch (e) {} }, 25000);
  req.raw.on('close', () => { clearInterval(hb); remove(); });
});

// ── Google Sign-In ──
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
// Frontend fetches the public client-id to init the Google button.
app.get('/api/auth/google/client-id', async () => ({ clientId: GOOGLE_CLIENT_ID }));
app.post('/api/auth/google', async (req, reply) => {
  try {
    const cred = (req.body || {}).credential;
    if (!cred) { reply.code(400); return { error: 'Missing Google credential' }; }
    if (!GOOGLE_CLIENT_ID) { reply.code(500); return { error: 'Google login not configured on the server' }; }
    // Verify the ID token with Google (validates signature + expiry), then we check
    // the audience is our app and the email is verified.
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred));
    const c = await r.json().catch(() => ({}));
    if (!r.ok || !c.email) { reply.code(401); return { error: 'Invalid Google token' }; }
    if (c.aud !== GOOGLE_CLIENT_ID) { reply.code(401); return { error: 'Google token audience mismatch' }; }
    if (!(c.email_verified === true || c.email_verified === 'true')) { reply.code(401); return { error: 'Google email not verified' }; }
    return await googleAuth({ email: c.email, name: c.name || '' });
  } catch (e) { reply.code(400); return { error: e.message }; }
});

// ── Data routes ──
ordersRoutes(app, requireAuth);
orderRefundRoutes(app, requireAuth);                    // itemised per-order charges + partial refunds back to the seller's wallet (admin/warehouse only)
inventoryRoutes(app, requireStaff, requireWarehouse);
designCardsRoutes(app, requireAuth, requireStaff, requireAdmin, requireWarehouse);
designImagesRoutes(app, requireAuth);                   // seller's reusable Images library for the design maker (own uploads + buyer order art)
catalogRoutes(app, requireAuth, requireStaff, requireWarehouse);
partnerTemplatesRoutes(app, requireStaff);              // a POD partner's own workbook, stored as layout + field mapping so their sheet can be filled from our catalogue
etsyRoutes(app, requireAuth, requireStaff);
tiktokRoutes(app, requireAuth, requireStaff);   // TikTok Shop OAuth connect (seller + admin connect their own shop)
shopifyRoutes(app, requireAuth, requireStaff);  // Shopify per-store OAuth connect (seller + admin connect their own store)
publishRoutes(app, requireAuth);                // where a product CAN be published — one row per connected shop, not one per platform
ssRoutes(app, requireAuth, requireStaff, requireAdmin, requireWarehouse);  // S&S Activewear catalog + inventory sync (factory blanks → New In tab)
ottoCapRoutes(app, requireAuth, requireStaff, requireAdmin, requireWarehouse);  // Otto Cap headwear supplier (auth + inventory + sandbox PO placement)
sanmarRoutes(app, requireAuth, requireStaff, requireAdmin, requireWarehouse);  // SanMar apparel supplier (SOAP: product/inventory/pricing live; ordering gated)
usersRoutes(app, requireAdmin, requireAuth);   // admin user management + staff-readable GET /api/sellers (seller-adjust panel)
uspsRoutes(app, requireAuth, requireStaff);
templatesRoutes(app, requireAuth);
vietqrRoutes(app, requireAuth);   // /vqr/* are PUBLIC (VietQR server-to-server); /api/vietqr/* need auth
topupsRoutes(app, requireAuth);   // manual top-up reconciliation (pending → admin "Received")
payoutsRoutes(app, requireAuth);  // manual seller payouts (saved payout details → request → admin/warehouse pay = wallet debit)
paypalRoutes(app, requireAuth);   // PayPal card/balance wallet top-up (auto-capture)
stripeRoutes(app, requireAuth);   // Stripe card wallet top-up (Payment Element)
passwordResetRoutes(app, requireAuth, requireStaff);   // forgot/reset (admin-mediated + email link)
shippingRoutes(app, requireAuth, requireStaff);        // EasyPost + Shippo rate-shop + labels
designLibraryRoutes(app, requireAuth, requireStaff);   // per-seller "my uploads" design gallery + cross-seller duplicate detection (staff-only)
designFilesRoutes(app, requireAuth);                   // machine deliverable files (.pes/.emb) stored server-side, access-controlled (staff any; seller own)
sheetsRoutes(app, requireAuth, requireAdmin);          // Google Sheets order import; admin sets the master template a seller copies
billingRoutes(app, requireAuth, requireAdmin);                       // subscription plan + SpyDeck add-on, charged from the wallet (402 names the shortfall so the client can offer a top-up)
planRoutes(app, requireAuth, requireStaff, requireAdmin);  // volume tiers: the admin ladder + a seller's own meter. PRICES ORDERS — pricing.js reads the same ladder; an empty ladder is the off switch
consignmentRoutes(app, requireAuth, requireStaff);     // inventory services: seller-owned stock (ASN -> count -> internal SKU + bin); kept OUT of `inventory`, which has no owner column
mailIngestRoutes(app, requireAuth);                                // inbound Etsy sale emails -> order addresses (shared-secret URL; sender must be a known account)
walletRoutes(app, requireAuth, requireAdmin);
cashAccountRoutes(app, requireAuth, requireAdmin);      // WHERE the money is — named real accounts + attribution of every ledger movement                        // SERVER-authoritative wallet balance + append-only ledger (seller/factory/designer), idempotent by ref
factoryListsRoutes(app, requireAuth);                  // shared factory queues (backorders + purchase orders) — staff-only, whole-array blobs
teamRoutes(app, requireAuth);                          // seller team members + per-member access surfaces (drives nav-hiding); auth/login untouched
sandboxRoutes(app, requireAuth);                       // seller API keys (/api/keys) + safe /api/test/* sandbox (simulated, no side effects) — isolated key-auth, global hook untouched
webhookRoutes(app, requireAuth, authKey, keyAllows);              // outbound webhooks (/api/webhooks) — what makes the public API push instead of poll-only; JWT *or* X-API-Key, since registering one is a partner action
adminSecretsRoutes(app, requireAdmin);                 // ADMIN: masked last-4 of integration credentials — even masked it maps which integrations are worth attacking
brandingRoutes(app, requireAuth, requireAdmin);        // favicon / logo / app name — editable without a deploy; the PALETTE deliberately stays in code
wilcomRoutes(app, requireDesignStaff);                  // Wilcom EWA digitising — operator/designer/admin, NOT warehouse: every call bills
usageRoutes(app, requireAdmin, requireAdmin);          // ADMIN: what the integrations COST us per platform + threshold config — not needed to pick, print or ship
auditRoutes(app, requireAdmin, requireAuth);                        // admin-only Activity log read API (GET /api/audit) — the audit() writer is called inline from routes
supportAiRoutes(app, requireAuth, requireStaff);
publicSupportRoutes(app);                              // UNAUTHENTICATED marketing-site chat bubble — rate-limited and identity-gated because every message is a paid model call       // account-aware AI auto-reply for the seller Support chat + admin AI key/model config (Settings › Integrations)
factorySettingsRoutes(app, requireAuth, requireStaff, requireAdmin); // staff READ the fee/shipping (the factory needs it); ADMIN writes them — they are pricing levers
navVisibilityRoutes(app, requireAuth);                 // role → hidden nav pages/tabs (admin-editable, HIDE-only; never grants access)
purchaseRoutes(app, requireAuth, requireAdmin, requireAdmin);            // ADMIN: purchase orders — commits company money + exposes unit cost across every blank. Receiving stock stays warehouse (inventory.js)
spydeckRoutes(app, requireAuth);                       // SpyDeck saved/favorited research listings (server-authoritative, per-seller)
notificationRoutes(app, requireAuth);                  // per-user bell + read state, pushed over the existing SSE hub
adsRoutes(app, requireAdmin);                          // ADMIN: Meta + Google Ads — these CREATE and PAUSE campaigns, i.e. they move money
broadcastsRoutes(app, requireBroadcaster, requireBroadcaster);  // ADMIN or OPERATOR: seller email broadcasts. Drafting reaches the whole seller list, so it is gated the same as sending; PUBLIC unsubscribe at /api/broadcasts/unsubscribe
siteContentRoutes(app, requireAdmin);                  // editable marketing-home copy — PUBLIC GET (homepage reads it), ADMIN PUT (Settings › Site content)
dispatchRoutes(app, requireAuth, requireWarehouse);    // byeastside: push labels for pre-scan, poll PICKED
manifestRoutes(app, requireWarehouse);                  // USPS SCAN forms via Shippo manifests
manualSupplierRoutes(app, requireAdmin);               // Sourcing — saved supplier links, costs, MOQ, margins. ADMIN-ONLY: these rows are what we pay and what we make
alibabaRoutes(app, requireAdmin);                      // ADMIN: Alibaba.com BUYER APIs (sourcing) — signed IOP gateway, OAuth token, product search

/**
 * Ask S&S whether our open orders are still open.
 *
 * They have no webhook — no receiver here, nothing registered there — so an order they
 * cancelled stayed "Placed" on our board indefinitely. Not a missed callback: nothing was
 * ever listening.
 *
 * Deliberately small: 8 orders every 5 minutes, spaced 1.5s apart, which is well under one
 * request a minute against their 60/min ceiling. A poller that eats the budget breaks rate
 * shopping and label buying, which people are actually waiting on.
 */
startSupplierPoll({
  enabled: () => !!(process.env.SS_ACCOUNT_NUMBER && process.env.SS_API_KEY),
  ssOrderStatus,
});
pinkDesignRoutes(app, requireAuth, requireDesignStaff); // Pink Design outsourced artwork — operator/designer/admin, NOT warehouse: commissioning spends money
backupRoutes(app, requireAdmin);                       // admin-only Postgres backups → R2 (on-demand + nightly), download + prune
piiRetentionRoutes(app, requireAdmin);                 // buyer-PII retention purge — SHIPS DISABLED; admin opts in (Amazon DPP: delete within 30d of shipment)

const port = Number(process.env.PORT) || 3000;
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`EGFUL API listening on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
