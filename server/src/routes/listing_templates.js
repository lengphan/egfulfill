/**
 * LISTING TEMPLATES — a saved publish form, minus the pictures.
 *
 * A seller publishing from SpyDeck retypes the same listing shape over and over: the same
 * description boilerplate, the same blank, the same colourways, the same per-size prices.
 * Only the title and the artwork really change. So this stores everything the publish form
 * holds EXCEPT the photos, and the picker on that page fills it back in.
 *
 * NOT `templates`. That table is the Design Lab's — composites and artwork layers, a shared
 * library with its own object-storage pipeline. The two share a word and nothing else, and
 * folding a per-seller text preset into a factory-wide image library would have made both
 * harder to reason about.
 *
 * PHOTOS ARE DELIBERATELY NOT HERE, and it is not an oversight to fix later. A listing built
 * from SpyDeck carries the competitor's shots as REFERENCE only — the publish page is careful
 * never to send them — and a template is exactly the mechanism that would launder them into a
 * publishable set on the next listing. Artwork is per-product besides: two listings sharing a
 * description do not share a print.
 *
 * PER SELLER, AND A TEAM SHARES THE OWNER'S. Same resolution as orders, design files and the
 * wallet (`effectiveSeller`), so a team member sees and edits the templates their owner does.
 * Staff are filed under their own id — they publish too, and they have no owner above them.
 */
import crypto from 'node:crypto';
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { effectiveSeller } from '../ai-pricing.js';

/**
 * WHAT A TEMPLATE MAY HOLD — an ALLOW-LIST, not the request body.
 *
 * The publish form's state is wide and gets wider; storing whatever it happens to send would
 * mean this table quietly acquires every field anybody adds, including the next one that
 * turns out to be a data: URL. Anything not named here is dropped on write, so a template
 * cannot grow into a second copy of the product record.
 */
const STRINGS = ['title', 'description', 'method', 'blank_sku', 'blank_id', 'blank_name'];
const LISTS = ['tags', 'colors', 'sizes'];
const NUMBERS = ['price', 'quantity'];

/** Bytes, after JSON. A template is words and numbers; anything near this is someone pasting
 *  an image into the description, and a row that size belongs in object storage or nowhere. */
const MAX_BYTES = 64 * 1024;
/** Per owner. Not a business rule — a ceiling, so a loop in a client cannot fill the table. */
const MAX_PER_OWNER = 200;

const str = (v, cap = 4000) => (typeof v === 'string' ? v.slice(0, cap) : '');
const list = (v, cap = 200) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.slice(0, 200)).slice(0, cap) : [];

/** The stored shape, built field by field from the request rather than spread from it. */
function cleanData(body) {
  const src = (body && typeof body.data === 'object' && body.data) || {};
  const out = {};
  for (const k of STRINGS) if (src[k] != null) out[k] = str(src[k], k === 'description' ? 20000 : 500);
  for (const k of LISTS) out[k] = list(src[k]);
  for (const k of NUMBERS) {
    const n = Number(src[k]);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  /* PER-SIZE PRICES: a plain {size: number} map, rebuilt rather than trusted — the values
     arrive from text inputs, so a non-number here would be stored and then read back as a
     price. A size that cannot be parsed is simply absent, which the form treats as "use the
     single retail price", the same as never having set one. */
  const sp = src.size_prices;
  if (sp && typeof sp === 'object' && !Array.isArray(sp)) {
    const m = {};
    for (const [k, v] of Object.entries(sp).slice(0, 100)) {
      const n = Number(v);
      if (k && Number.isFinite(n) && n > 0) m[String(k).slice(0, 200)] = n;
    }
    if (Object.keys(m).length) out.size_prices = m;
  }
  return out;
}

export function listingTemplatesRoutes(app, requireAuth) {
  q(`create table if not exists listing_templates (
       id text primary key,
       owner_id uuid not null,
       name text not null,
       data jsonb not null default '{}',
       created_at timestamptz not null default now(),
       updated_at timestamptz not null default now()
     )`).catch(() => {});
  /* Every read is "this owner's templates, newest first", so that is the index. */
  q('create index if not exists listing_templates_owner_idx on listing_templates (owner_id, updated_at desc)')
    .catch(() => {});

  /** Who these belong to. A team member resolves to the OWNER; staff are their own. */
  const ownerOf = async (user) =>
    (isStaff(user) ? null : await effectiveSeller(user)) || String(user?.sub || '');

  app.get('/api/listing_templates', { preHandler: requireAuth }, async (req) => {
    const owner = await ownerOf(req.user);
    if (!owner) return [];
    const r = await q(
      `select id, name, data, updated_at from listing_templates
        where owner_id = $1::uuid order by updated_at desc limit $2`,
      [owner, MAX_PER_OWNER],
    ).catch(() => ({ rows: [] }));
    return r.rows;
  });

  /**
   * SAVE ONE — create, or replace the one whose id is sent.
   *
   * An id in the body means "update that one", and it is matched against the OWNER as well,
   * so a guessed id cannot overwrite somebody else's template. No id means a new row.
   */
  app.post('/api/listing_templates', { preHandler: requireAuth }, async (req, reply) => {
    const owner = await ownerOf(req.user);
    if (!owner) { reply.code(403); return { error: 'No account to file this against.' }; }

    const name = str(req.body?.name, 120).trim();
    if (!name) { reply.code(400); return { error: 'A template needs a name.' }; }

    const data = cleanData(req.body);
    const bytes = Buffer.byteLength(JSON.stringify(data));
    if (bytes > MAX_BYTES) {
      reply.code(413);
      return { error: 'That description is too long to save as a template.' };
    }

    const id = str(req.body?.id, 64).trim();
    if (id) {
      const r = await q(
        `update listing_templates set name = $3, data = $4::jsonb, updated_at = now()
          where id = $1 and owner_id = $2::uuid
          returning id, name, data, updated_at`,
        [id, owner, name, JSON.stringify(data)],
      ).catch(() => ({ rows: [] }));
      if (r.rows[0]) return r.rows[0];
      /* Not found, or not theirs. Falling through to an INSERT would hand back a NEW
         template wearing the id they asked to update, which reads as a successful save and
         silently leaves the original untouched. */
      reply.code(404);
      return { error: 'That template no longer exists.' };
    }

    /* THE CEILING IS CHECKED ON CREATE ONLY — an update replaces a row and cannot grow the
       table, so refusing one would only stop someone fixing a typo at the limit. */
    const n = await q('select count(*)::int as n from listing_templates where owner_id = $1::uuid', [owner])
      .then((r) => r.rows[0]?.n ?? 0).catch(() => 0);
    if (n >= MAX_PER_OWNER) {
      reply.code(400);
      return { error: `You can keep ${MAX_PER_OWNER} templates — delete one to save another.` };
    }

    const fresh = `lt-${crypto.randomUUID()}`;
    const r = await q(
      `insert into listing_templates (id, owner_id, name, data)
       values ($1, $2::uuid, $3, $4::jsonb)
       returning id, name, data, updated_at`,
      [fresh, owner, name, JSON.stringify(data)],
    );
    return r.rows[0];
  });

  app.delete('/api/listing_templates/:id', { preHandler: requireAuth }, async (req, reply) => {
    const owner = await ownerOf(req.user);
    if (!owner) { reply.code(403); return { error: 'forbidden' }; }
    /* Scoped to the owner in the WHERE, so this can only ever delete one of theirs — the
       route never needs to decide whether they may, because the query cannot reach further. */
    const r = await q('delete from listing_templates where id = $1 and owner_id = $2::uuid', [
      String(req.params.id || ''), owner,
    ]).catch(() => ({ rowCount: 0 }));
    if (!r.rowCount) { reply.code(404); return { error: 'That template no longer exists.' }; }
    return { ok: true };
  });
}
