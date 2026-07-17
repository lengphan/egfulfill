// EGFULFILL API — Fastify entry point.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { signup, login, verify, isStaff, googleAuth } from './auth.js';
import { q } from './db.js';
import { ordersRoutes } from './routes/orders.js';
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
import { sandboxRoutes } from './routes/sandbox.js';
import { adminSecretsRoutes } from './routes/admin_secrets.js';
import { auditRoutes } from './audit.js';
import { supportAiRoutes } from './routes/support_ai.js';
import { factorySettingsRoutes } from './routes/factory_settings.js';
import { purchaseRoutes } from './routes/purchase.js';
import { spydeckRoutes } from './routes/spydeck.js';
import { notificationRoutes } from './routes/notifications.js';
import { addClient } from './events.js';

// Catalog products embed base64 image data URLs (mockups, color images), so the
// default 1MB body limit is far too small. Bounded by the browser's localStorage
// quota (~5-10MB total), so 25MB is plenty of headroom.
// 60MB body limit: full-resolution print files (e.g. 4000×5000 PNG ~10-25MB) are
// ~33% larger as base64, so 25MB could silently reject a legit design upload.
const app = Fastify({ logger: true, bodyLimit: 60 * 1024 * 1024 });
await app.register(cors, { origin: process.env.CORS_ORIGIN || '*' });

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
function requireAdmin(req, reply, done) {
  if (!req.user || req.user.role !== 'admin') { reply.code(403).send({ error: 'Admin only' }); return; }
  done();
}

app.get('/health', async () => ({ ok: true }));

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
  if (!sets.length) { reply.code(400); return { error: 'Nothing to update' }; }

  vals.push(req.user.sub);
  const r = await q(
    'update users set ' + sets.join(', ') + ' where id=$' + vals.length + ' returning id, email, role, name, avatar_emoji, avatar_color, notify_sound',
    vals
  );
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
  const remove = addClient(res);
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
inventoryRoutes(app, requireStaff);
designCardsRoutes(app, requireAuth, requireStaff, requireAdmin);
catalogRoutes(app, requireAuth, requireStaff);
etsyRoutes(app, requireAuth, requireStaff);
tiktokRoutes(app, requireAuth, requireStaff);   // TikTok Shop OAuth connect (seller + admin connect their own shop)
shopifyRoutes(app, requireAuth, requireStaff);  // Shopify per-store OAuth connect (seller + admin connect their own store)
ssRoutes(app, requireAuth, requireStaff, requireAdmin);  // S&S Activewear catalog + inventory sync (factory blanks → New In tab)
ottoCapRoutes(app, requireAuth, requireStaff, requireAdmin);  // Otto Cap headwear supplier (auth + inventory + sandbox PO placement)
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
walletRoutes(app, requireAuth);                        // SERVER-authoritative wallet balance + append-only ledger (seller/factory/designer), idempotent by ref
factoryListsRoutes(app, requireAuth);                  // shared factory queues (backorders + purchase orders) — staff-only, whole-array blobs
teamRoutes(app, requireAuth);                          // seller team members + per-member access surfaces (drives nav-hiding); auth/login untouched
sandboxRoutes(app, requireAuth);                       // seller API keys (/api/keys) + safe /api/test/* sandbox (simulated, no side effects) — isolated key-auth, global hook untouched
adminSecretsRoutes(app, requireStaff);                 // READ-ONLY masked last-4 of integration credentials (staff) — powers Settings › Integrations last-4 display; no plaintext/write
auditRoutes(app, requireAdmin);                        // admin-only Activity log read API (GET /api/audit) — the audit() writer is called inline from routes
supportAiRoutes(app, requireAuth, requireStaff);       // account-aware AI auto-reply for the seller Support chat + admin AI key/model config (Settings › Integrations)
factorySettingsRoutes(app, requireAuth, requireStaff); // platform factory settings — design fee, default shipping, emb file price (warehouse/admin)
purchaseRoutes(app, requireAuth, requireStaff);        // purchase orders — draft → placed (S&S/Otto) → received into inventory
spydeckRoutes(app, requireAuth);                       // SpyDeck saved/favorited research listings (server-authoritative, per-seller)
notificationRoutes(app, requireAuth);                  // per-user bell + read state, pushed over the existing SSE hub

const port = Number(process.env.PORT) || 3000;
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`EGFULFILL API listening on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
