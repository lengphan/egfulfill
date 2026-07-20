// Entitlements — who may use a paid feature. Lives in its own module so route files
// can share the rule WITHOUT importing each other (etsy.js and spydeck.js each need
// it, and importing across them created a cycle).
//
// This is the SERVER check, and it's the one that counts. The gate used to be the
// client reading localStorage `eg_seller_plan`: the lock screen was decorative, the
// endpoints only checked requireAuth, and setting the key in a console unlocked a
// paid feature for free.
import { q } from './db.js';
import { resolveEntitlements } from './auth.js';

/** SpyDeck: staff always; a seller needs Pro/Enterprise or the standalone add-on. */
export async function entitled(user) {
  if (!user) return false;
  if (user.role && user.role !== 'seller') return true;
  try {
    const r = await q('select plan, spydeck_addon, email from users where id=$1', [user.sub]);
    const u = r.rows[0];
    if (!u) return false;
    // Resolve through the TEAM: a member's own row is always 'starter' because they
    // never buy anything — their leader does. Checking only their own columns 403'd a
    // teammate on a Pro account, which is why the page showed an upgrade prompt AND an
    // empty feed: the client paywall and the server gate were both wrong the same way.
    const ent = await resolveEntitlements({
      ...user, email: u.email || user.email, plan: u.plan, spydeck_addon: u.spydeck_addon,
    });
    return ent.plan === 'pro' || ent.plan === 'enterprise' || ent.spydeck_addon === true;
  } catch {
    return false;   // fail CLOSED: a lookup error must never hand out a paid feature
  }
}

/** Fastify preHandler form. */
export function requireSpydeck(req, reply, done) {
  entitled(req.user)
    .then((ok) => {
      if (!ok) { reply.code(403).send({ error: 'SpyDeck is a paid add-on — upgrade to Pro or add SpyDeck to your plan.', needsUpgrade: true }); return; }
      done();
    })
    .catch(() => reply.code(403).send({ error: 'SpyDeck is not available on your plan.', needsUpgrade: true }));
}
