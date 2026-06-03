// EGFULFILL API — Fastify entry point.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { signup, login, verify, isStaff } from './auth.js';
import { ordersRoutes } from './routes/orders.js';
import { inventoryRoutes } from './routes/inventory.js';
import { designCardsRoutes } from './routes/design_cards.js';
import { catalogRoutes } from './routes/catalog.js';
import { etsyRoutes } from './routes/etsy.js';
import { usersRoutes } from './routes/users.js';
import { uspsRoutes } from './routes/usps.js';

// Catalog products embed base64 image data URLs (mockups, color images), so the
// default 1MB body limit is far too small. Bounded by the browser's localStorage
// quota (~5-10MB total), so 25MB is plenty of headroom.
const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
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

// ── Data routes ──
ordersRoutes(app, requireAuth);
inventoryRoutes(app, requireStaff);
designCardsRoutes(app, requireAuth, requireStaff);
catalogRoutes(app, requireAuth, requireStaff);
etsyRoutes(app, requireAuth, requireStaff);
usersRoutes(app, requireAdmin);
uspsRoutes(app, requireAuth, requireStaff);

const port = Number(process.env.PORT) || 3000;
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`EGFULFILL API listening on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
