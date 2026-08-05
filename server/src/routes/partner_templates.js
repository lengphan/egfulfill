// Partner sheet templates — a print-on-demand partner (Printify first, then whoever else)
// hands us THEIR workbook and expects it back filled in. Every partner's sheet is a
// different shape, so nothing here hard-codes one: we store the layout their file was
// found to have, plus a mapping from our catalogue's field names onto their columns, and
// the browser fills it.
//
// WHY THE LAYOUT AND NOT THE FILE. A template is a few hundred KB of workbook that we
// would then have to hand back to the browser to re-parse on every edit. What the export
// actually needs is the shape — which sheets, which header rows, which columns, in which
// order — and that is a few KB of JSON that a mapping can be diffed against when they send
// a revised template. The trade is real and worth naming: we reproduce their COLUMNS, not
// their cell colours and merged headings.
//
// Staff-only throughout. These sheets carry the catalogue price, which is a trade price.
import { q } from '../db.js';
import { audit } from '../audit.js';

const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

export function partnerTemplatesRoutes(app, requireStaff) {
  q(`create table if not exists partner_templates (
       id bigserial primary key,
       name text not null,
       file_name text,
       layout jsonb not null default '{}'::jsonb,
       mapping jsonb not null default '{}'::jsonb,
       created_by text,
       created_at timestamptz not null default now(),
       updated_at timestamptz not null default now()
     )`).catch(() => {});

  const shape = (r) => ({
    id: String(r.id),
    name: r.name,
    fileName: r.file_name || null,
    layout: r.layout || { sheets: [] },
    mapping: r.mapping || {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  app.get('/api/partner/templates', { preHandler: requireStaff }, async () => {
    const r = await q(
      `select id, name, file_name, layout, mapping, created_at, updated_at
         from partner_templates order by updated_at desc limit 200`
    ).catch(() => ({ rows: [] }));
    return { templates: r.rows.map(shape) };
  });

  app.get('/api/partner/templates/:id', { preHandler: requireStaff }, async (req, reply) => {
    const r = await q(
      `select id, name, file_name, layout, mapping, created_at, updated_at
         from partner_templates where id = $1::bigint`,
      [str(req.params.id, 40)]
    ).catch(() => ({ rows: [] }));
    if (!r.rows[0]) { reply.code(404); return { error: 'No such template.' }; }
    return shape(r.rows[0]);
  });

  app.post('/api/partner/templates', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const name = str(b.name);
    if (!name) { reply.code(400); return { error: 'Name the partner — the list is unusable without it.' }; }
    const layout = (b.layout && typeof b.layout === 'object') ? b.layout : { sheets: [] };
    const mapping = (b.mapping && typeof b.mapping === 'object') ? b.mapping : {};
    const r = await q(
      `insert into partner_templates (name, file_name, layout, mapping, created_by)
       values ($1,$2,$3,$4,$5)
       returning id, name, file_name, layout, mapping, created_at, updated_at`,
      [name, str(b.fileName) || null, JSON.stringify(layout), JSON.stringify(mapping),
       str((req.user && req.user.sub) || '', 40)]
    );
    audit(req, 'partner_template.created', {
      entityType: 'partner_template', entityId: String(r.rows[0].id),
      after: { name, sheets: (layout.sheets || []).length },
    });
    return shape(r.rows[0]);
  });

  /**
   * Update name, layout or mapping — each only if present.
   *
   * Partial on purpose: the mapping editor saves a mapping and nothing else, and a PUT that
   * defaulted the missing fields would quietly wipe the layout the mapping refers to.
   */
  app.put('/api/partner/templates/:id', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const id = str(req.params.id, 40);
    const sets = [];
    const vals = [];
    if (b.name != null) {
      const name = str(b.name);
      if (!name) { reply.code(400); return { error: 'A template needs a name.' }; }
      vals.push(name); sets.push(`name = $${vals.length}`);
    }
    if (b.layout && typeof b.layout === 'object') {
      vals.push(JSON.stringify(b.layout)); sets.push(`layout = $${vals.length}::jsonb`);
    }
    if (b.mapping && typeof b.mapping === 'object') {
      vals.push(JSON.stringify(b.mapping)); sets.push(`mapping = $${vals.length}::jsonb`);
    }
    if (b.fileName != null) {
      vals.push(str(b.fileName) || null); sets.push(`file_name = $${vals.length}`);
    }
    if (!sets.length) { reply.code(400); return { error: 'Nothing to change.' }; }
    vals.push(id);
    const r = await q(
      `update partner_templates set ${sets.join(', ')}, updated_at = now()
        where id = $${vals.length}::bigint
        returning id, name, file_name, layout, mapping, created_at, updated_at`,
      vals
    ).catch(() => ({ rows: [] }));
    if (!r.rows[0]) { reply.code(404); return { error: 'No such template.' }; }
    audit(req, 'partner_template.updated', {
      entityType: 'partner_template', entityId: id, after: { fields: sets.length },
    });
    return shape(r.rows[0]);
  });

  app.delete('/api/partner/templates/:id', { preHandler: requireStaff }, async (req, reply) => {
    const id = str(req.params.id, 40);
    const r = await q('delete from partner_templates where id = $1::bigint returning name', [id])
      .catch(() => ({ rows: [] }));
    if (!r.rows[0]) { reply.code(404); return { error: 'No such template.' }; }
    audit(req, 'partner_template.deleted', {
      entityType: 'partner_template', entityId: id, before: { name: r.rows[0].name },
    });
    return { ok: true };
  });
}
