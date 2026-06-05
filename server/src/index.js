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
designCardsRoutes(app, requireAuth, requireStaff);
catalogRoutes(app, requireAuth, requireStaff);
etsyRoutes(app, requireAuth, requireStaff);
usersRoutes(app, requireAdmin);
uspsRoutes(app, requireAuth, requireStaff);
templatesRoutes(app, requireAuth);
vietqrRoutes(app, requireAuth);   // /vqr/* are PUBLIC (VietQR server-to-server); /api/vietqr/* need auth
topupsRoutes(app, requireAuth);   // manual top-up reconciliation (pending → admin "Received")
paypalRoutes(app, requireAuth);   // PayPal card/balance wallet top-up (auto-capture)

const port = Number(process.env.PORT) || 3000;
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`EGFULFILL API listening on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
