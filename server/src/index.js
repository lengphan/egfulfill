// EGFULFILL API — Fastify entry point.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { signup, login, verify, isStaff, googleAuth, normalizeUsername, ensureUsernameColumn } from './auth.js';
import { q } from './db.js';
import { ordersRoutes } from './routes/orders.js';
import { orderRefundRoutes } from './routes/order_refunds.js';
import { inventoryRoutes } from './routes/inventory.js';
import { designCardsRoutes } from './routes/design_cards.js';
import { catalogRoutes } from './routes/catalog.js';
import { etsyRoutes } from './routes/etsy.js';
import { tiktokRoutes } from './routes/tiktok.js';
import { shopifyRoutes } from './routes/shopify.js';
import { ssRoutes } from './routes/ss.js';
import { ottoCapRoutes } from './routes/ottocap.js';
import { usersRoutes } from './routes/users.js';
import { uspsRoutes } from './routes/usps.js';
import { templatesRoutes } from './routes/templates.js';
import { billingRoutes } from './routes/billing.js';
import { consignmentRoutes } from './routes/consignment.js';
import { mailIngestRoutes } from './routes/mail_ingest.js';
import { vietqrRoutes } from './routes/vietqr.js';
import { topupsRoutes } from './routes/topups.js';
import { paypalRoutes } from './routes/paypal.js';
import { stripeRoutes } from './routes/stripe.js';
import { passwordResetRoutes } from './routes/password-reset.js';
import { shippingRoutes } from './routes/shipping.js';
import { designLibraryRoutes } from './routes/design_library.js';
import { designFilesRoutes } from './routes/design_files.js';
import { sheetsRoutes } from './routes/sheets.js';
import { walletRoutes } from './routes/wallet.js';
import { factoryListsRoutes } from './routes/factory_lists.js';
import { teamRoutes } from './routes/team.js';
import { sandboxRoutes, authKey } from './routes/sandbox.js';
import { webhookRoutes } from './webhooks.js';
import { adminSecretsRoutes } from './routes/admin_secrets.js';
import { auditRoutes } from './audit.js';
import { supportAiRoutes } from './routes/support_ai.js';
import { factorySettingsRoutes } from './routes/factory_settings.js';
import { purchaseRoutes } from './routes/purchase.js';
import { spydeckRoutes } from './routes/spydeck.js';
import { notificationRoutes } from './routes/notifications.js';
import { adsRoutes } from './routes/ads.js';
import { dispatchRoutes } from './routes/dispatch.js';
import { pinkDesignRoutes } from './routes/pinkdesign.js';
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

// Attach req.user from the Bearer token on every request (null if not signed in).
app.addHook('onRequest', async (req) => {
  const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  req.user = m ? verify(m[1]) : null;
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
  try { return await signup(req.body || {}); }
  catch (e) { reply.code(400); return { error: e.message }; }
});
app.post('/api/auth/login', async (req, reply) => {
  try { return await login(req.body || {}); }
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
  // Username — a second way to sign in. null/'' clears it back to email-only.
  if (b.username !== undefined) {
    await ensureUsernameColumn().catch(() => {});
    try { put('username', b.username === null || b.username === '' ? null : normalizeUsername(b.username)); }
    catch (e) { reply.code(400); return { error: e.message }; }
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
    if (e.code === '23505') { reply.code(409); return { error: 'That username is already taken' }; }
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
designCardsRoutes(app, requireAuth, requireStaff, requireAdmin);
catalogRoutes(app, requireAuth, requireStaff);
etsyRoutes(app, requireAuth, requireStaff);
tiktokRoutes(app, requireAuth, requireStaff);   // TikTok Shop OAuth connect (seller + admin connect their own shop)
shopifyRoutes(app, requireAuth, requireStaff);  // Shopify per-store OAuth connect (seller + admin connect their own store)
ssRoutes(app, requireAuth, requireStaff, requireAdmin, requireWarehouse);  // S&S Activewear catalog + inventory sync (factory blanks → New In tab)
ottoCapRoutes(app, requireAuth, requireStaff, requireAdmin, requireWarehouse);  // Otto Cap headwear supplier (auth + inventory + sandbox PO placement)
usersRoutes(app, requireAdmin, requireAuth);   // admin user management + staff-readable GET /api/sellers (seller-adjust panel)
uspsRoutes(app, requireAuth, requireStaff);
templatesRoutes(app, requireAuth);
vietqrRoutes(app, requireAuth);   // /vqr/* are PUBLIC (VietQR server-to-server); /api/vietqr/* need auth
topupsRoutes(app, requireAuth);   // manual top-up reconciliation (pending → admin "Received")
paypalRoutes(app, requireAuth);   // PayPal card/balance wallet top-up (auto-capture)
stripeRoutes(app, requireAuth);   // Stripe card wallet top-up (Payment Element)
passwordResetRoutes(app, requireAuth, requireStaff);   // forgot/reset (admin-mediated + email link)
shippingRoutes(app, requireAuth, requireStaff);        // EasyPost + Shippo rate-shop + labels
designLibraryRoutes(app, requireAuth, requireStaff);   // per-seller "my uploads" design gallery + cross-seller duplicate detection (staff-only)
designFilesRoutes(app, requireAuth);                   // machine deliverable files (.pes/.emb) stored server-side, access-controlled (staff any; seller own)
sheetsRoutes(app, requireAuth);                        // Google Sheets order import (link-shared sheet → existing import pipeline)
billingRoutes(app, requireAuth);                       // subscription plan + SpyDeck add-on, charged from the wallet (402 names the shortfall so the client can offer a top-up)
consignmentRoutes(app, requireAuth, requireStaff);     // inventory services: seller-owned stock (ASN -> count -> internal SKU + bin); kept OUT of `inventory`, which has no owner column
mailIngestRoutes(app, requireAuth);                                // inbound Etsy sale emails -> order addresses (shared-secret URL; sender must be a known account)
walletRoutes(app, requireAuth);                        // SERVER-authoritative wallet balance + append-only ledger (seller/factory/designer), idempotent by ref
factoryListsRoutes(app, requireAuth);                  // shared factory queues (backorders + purchase orders) — staff-only, whole-array blobs
teamRoutes(app, requireAuth);                          // seller team members + per-member access surfaces (drives nav-hiding); auth/login untouched
sandboxRoutes(app, requireAuth);                       // seller API keys (/api/keys) + safe /api/test/* sandbox (simulated, no side effects) — isolated key-auth, global hook untouched
webhookRoutes(app, requireAuth, authKey);              // outbound webhooks (/api/webhooks) — what makes the public API push instead of poll-only; JWT *or* X-API-Key, since registering one is a partner action
adminSecretsRoutes(app, requireStaff);                 // READ-ONLY masked last-4 of integration credentials (staff) — powers Settings › Integrations last-4 display; no plaintext/write
auditRoutes(app, requireAdmin, requireAuth);                        // admin-only Activity log read API (GET /api/audit) — the audit() writer is called inline from routes
supportAiRoutes(app, requireAuth, requireStaff);       // account-aware AI auto-reply for the seller Support chat + admin AI key/model config (Settings › Integrations)
factorySettingsRoutes(app, requireAuth, requireStaff); // platform factory settings — design fee, default shipping, emb file price (warehouse/admin)
purchaseRoutes(app, requireAuth, requireStaff, requireWarehouse);        // purchase orders — draft → placed (S&S/Otto) → received into inventory
spydeckRoutes(app, requireAuth);                       // SpyDeck saved/favorited research listings (server-authoritative, per-seller)
notificationRoutes(app, requireAuth);                  // per-user bell + read state, pushed over the existing SSE hub
adsRoutes(app, requireStaff);                          // Meta + Google Ads: connect, read spend/ROAS, create + pause campaigns
dispatchRoutes(app, requireAuth, requireWarehouse);    // byeastside: push labels for pre-scan, poll PICKED
pinkDesignRoutes(app, requireAuth, requireStaff);      // Pink Design: outsourced DTG/DTF artwork

const port = Number(process.env.PORT) || 3000;
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`EGFULFILL API listening on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
