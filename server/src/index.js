// EGFULFILL API — Fastify entry point.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { signup, login, verify, isStaff, googleAuth } from './auth.js';
import { ordersRoutes } from './routes/orders.js';
import { inventoryRoutes } from './routes/inventory.js';
import { designCardsRoutes } from './routes/design_cards.js';
import { catalogRoutes } from './routes/catalog.js';
import { etsyRoutes } from './routes/etsy.js';
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
import { sheetsRoutes } from './routes/sheets.js';
import { walletRoutes } from './routes/wallet.js';
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
usersRoutes(app, requireAdmin);
uspsRoutes(app, requireAuth, requireStaff);
templatesRoutes(app, requireAuth);
vietqrRoutes(app, requireAuth);   // /vqr/* are PUBLIC (VietQR server-to-server); /api/vietqr/* need auth
topupsRoutes(app, requireAuth);   // manual top-up reconciliation (pending → admin "Received")
paypalRoutes(app, requireAuth);   // PayPal card/balance wallet top-up (auto-capture)
stripeRoutes(app, requireAuth);   // Stripe card wallet top-up (Payment Element)
passwordResetRoutes(app, requireAuth, requireStaff);   // forgot/reset (admin-mediated + email link)
shippingRoutes(app, requireAuth, requireStaff);        // EasyPost + Shippo rate-shop + labels
designLibraryRoutes(app, requireAuth, requireStaff);   // per-seller "my uploads" design gallery + cross-seller duplicate detection (staff-only)
sheetsRoutes(app, requireAuth);                        // Google Sheets order import (link-shared sheet → existing import pipeline)
walletRoutes(app, requireAuth);                        // SERVER-authoritative wallet balance + append-only ledger (seller/factory/designer), idempotent by ref

const port = Number(process.env.PORT) || 3000;
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`EGFULFILL API listening on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
