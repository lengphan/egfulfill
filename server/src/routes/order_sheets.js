// A seller's order sheet — the rows they type at /sheet, kept between visits.
//
// WHY THIS EXISTS AT ALL. The grid was browser state: close the tab and 200 typed rows were
// gone. Nobody fills a sheet in one sitting, so "it lives until you press Complete" is the
// same promise a spreadsheet already refuses to make.
//
// AND IT IS THE IMPORT HISTORY. A completed sheet is kept, not deleted — the rows exactly as
// they were submitted, whose they were, and when. Before this, an import was a file drop
// that left no trace: nothing could answer "what did they actually send us on the 14th".
// That question is the reason a Google Sheet in someone else's Drive could never be the
// record, no matter how well it worked as an editor.
//
// DRAFT -> COMPLETED, ONE WAY. A completed sheet is viewable and NOT editable. Once rows have
// become orders, editing them produces a record that disagrees with what was submitted, which
// is the "recorded history never changes silently" rule. Coming back to one is `duplicate`:
// a new draft carrying the same rows, which is also what a seller shipping the same 40 lines
// every week actually wants.
import { q } from '../db.js';

// Created here, not in schema.sql — that runs on FIRST DB INIT ONLY, so an existing
// deployment would never see it. Same idempotent-at-route-load pattern as order_designs,
// wallet_ledger and the rest (CLAUDE.md §6).
let _ready = null;
function ready() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists order_sheets (
    id           bigserial primary key,
    seller_id    text not null,
    name         text not null default '',
    -- The grid verbatim, in CSV_COLUMNS order, WITHOUT the header row. Header spellings are
    -- the client's business (TEMPLATE_HEADERS) and storing them would freeze today's column
    -- set into every saved sheet.
    rows         jsonb not null default '[]'::jsonb,
    status       text not null default 'draft',
    -- What Complete produced, so a finished sheet can say what became of it.
    order_ids    jsonb not null default '[]'::jsonb,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    completed_at timestamptz
  )`)
    .then(() => q('create index if not exists order_sheets_seller on order_sheets (seller_id, updated_at desc)'))
    .catch(() => {});
  return _ready;
}

const isStaff = (u) => !!u && u.role && u.role !== 'seller';

export function orderSheetsRoutes(app, requireAuth) {
  // A team member acts as the owner, so a sheet started by one is visible to the others —
  // the same rule the wallet and the design library already follow.
  async function owner(user) {
    if (!user) return null;
    try {
      const r = await q("select owner_id from team_members where lower(email)=lower($1) and status='active' limit 1", [user.email || '']);
      if (r.rows[0] && r.rows[0].owner_id) return r.rows[0].owner_id;
    } catch { /* no team_members yet */ }
    return user.sub;
  }

  // Staff may READ any sheet (support answering "what did they send us"), but the owner
  // filter still applies to writes below — a sheet is a seller's working document.
  async function load(id, user) {
    await ready();
    const r = await q('select * from order_sheets where id = $1', [String(id)]);
    const row = r.rows[0];
    if (!row) return null;
    if (isStaff(user)) return row;
    return row.seller_id === (await owner(user)) ? row : null;
  }

  const shape = (r, withRows) => ({
    id: String(r.id),
    name: r.name || '',
    status: r.status,
    rowCount: Array.isArray(r.rows) ? r.rows.filter((x) => Array.isArray(x) && x.some((c) => String(c ?? '').trim())).length : 0,
    orderIds: r.order_ids || [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    ...(withRows ? { rows: r.rows || [] } : {}),
  });

  app.get('/api/order_sheets', { preHandler: requireAuth }, async (req) => {
    await ready();
    const own = await owner(req.user);
    // Rows are NOT selected here. A list of twenty sheets at a few hundred rows each is
    // megabytes of cells nobody is going to look at — so the count is computed in SQL.
    //
    // COUNTING NON-EMPTY ROWS, not array length. A sheet opens with eight blank rows, so
    // jsonb_array_length reported "8 rows" for a sheet nobody had typed in — and disagreed
    // with the count the create and patch responses returned, which filter properly.
    // Non-empty rows only, counted in SQL. jsonb_array_length reported "8 rows" for a sheet
    // nobody had typed in, because the grid opens with eight blank ones — and it disagreed
    // with the count create/patch return, which filter properly.
    const LIST_SQL = `
      select id, seller_id, name, status, order_ids, created_at, updated_at, completed_at,
             (select count(*) from jsonb_array_elements(rows) e
               where exists (select 1 from jsonb_array_elements_text(e) v where btrim(v) <> '')) as n
        from order_sheets`;
    const r = isStaff(req.user)
      ? await q(`${LIST_SQL} order by updated_at desc limit 200`)
      : await q(`${LIST_SQL} where seller_id = $1 order by updated_at desc limit 200`, [own]);
    return { sheets: r.rows.map((x) => ({ ...shape(x, false), rowCount: Number(x.n) || 0 })) };
  });

  app.get('/api/order_sheets/:id', { preHandler: requireAuth }, async (req, reply) => {
    const row = await load(req.params.id, req.user);
    if (!row) { reply.code(404); return { error: 'not found' }; }
    return { sheet: shape(row, true) };
  });

  app.post('/api/order_sheets', { preHandler: requireAuth }, async (req) => {
    await ready();
    const b = req.body || {};
    const r = await q(
      'insert into order_sheets (seller_id, name, rows) values ($1, $2, $3::jsonb) returning *',
      [await owner(req.user), String(b.name || '').slice(0, 120), JSON.stringify(Array.isArray(b.rows) ? b.rows : [])]
    );
    return { sheet: shape(r.rows[0], true) };
  });

  // Autosave lands here. Name and rows are independent so renaming does not have to ship
  // the whole grid back.
  app.patch('/api/order_sheets/:id', { preHandler: requireAuth }, async (req, reply) => {
    const row = await load(req.params.id, req.user);
    if (!row) { reply.code(404); return { error: 'not found' }; }
    // A completed sheet is the record of what was submitted. Refusing the write here rather
    // than hiding the control is the point: the client is not the thing that guarantees it.
    if (row.status !== 'draft') { reply.code(409); return { error: 'This sheet is completed — duplicate it to make changes.' }; }
    const b = req.body || {};
    const sets = [];
    const vals = [];
    if (typeof b.name === 'string') { vals.push(b.name.slice(0, 120)); sets.push(`name = $${vals.length}`); }
    if (Array.isArray(b.rows)) { vals.push(JSON.stringify(b.rows)); sets.push(`rows = $${vals.length}::jsonb`); }
    if (!sets.length) return { sheet: shape(row, false) };
    vals.push(String(row.id));
    const r = await q(`update order_sheets set ${sets.join(', ')}, updated_at = now() where id = $${vals.length} returning *`, vals);
    return { sheet: shape(r.rows[0], false) };
  });

  /**
   * COPY AN OLD SHEET INTO A NEW DRAFT.
   *
   * Server-side rather than "read it, then post it back": one call, the copy cannot be a
   * partial one, and a 500-row sheet does not travel the wire twice to stand still.
   *
   * This is how a completed sheet is "edited" — it is not. You take its rows into something
   * new, and the record of what was actually sent stays exactly as it was.
   */
  app.post('/api/order_sheets/:id/duplicate', { preHandler: requireAuth }, async (req, reply) => {
    const row = await load(req.params.id, req.user);
    if (!row) { reply.code(404); return { error: 'not found' }; }
    const base = String(row.name || 'Sheet').replace(/^Copy of /, '');
    const r = await q(
      `insert into order_sheets (seller_id, name, rows)
       select $1, $2, rows from order_sheets where id = $3 returning *`,
      [await owner(req.user), `Copy of ${base}`.slice(0, 120), String(row.id)]
    );
    return { sheet: shape(r.rows[0], true) };
  });

  /**
   * The sheet became orders. Called by the client AFTER they exist, with their ids.
   *
   * Deliberately not the thing that creates them: orders are made by the import path that
   * already owns templates, machine files, design rows and the wallet's rules, and a second
   * creator here would agree with it only until one of them changed (CLAUDE.md §5).
   *
   * Idempotent — completing a completed sheet returns it unchanged rather than erroring, so
   * a retried request after a dropped response cannot turn a success into a failure.
   */
  app.post('/api/order_sheets/:id/complete', { preHandler: requireAuth }, async (req, reply) => {
    const row = await load(req.params.id, req.user);
    if (!row) { reply.code(404); return { error: 'not found' }; }
    if (row.status === 'completed') return { sheet: shape(row, false) };
    const ids = Array.isArray(req.body && req.body.orderIds) ? req.body.orderIds.map(String) : [];
    const r = await q(
      `update order_sheets set status = 'completed', order_ids = $1::jsonb, completed_at = now(), updated_at = now()
       where id = $2 returning *`,
      [JSON.stringify(ids), String(row.id)]
    );
    return { sheet: shape(r.rows[0], false) };
  });

  app.delete('/api/order_sheets/:id', { preHandler: requireAuth }, async (req, reply) => {
    const row = await load(req.params.id, req.user);
    if (!row) { reply.code(404); return { error: 'not found' }; }
    if (row.status === 'completed' && !isStaff(req.user)) {
      reply.code(409);
      return { error: 'A completed sheet is the record of what was submitted and cannot be deleted.' };
    }
    await q('delete from order_sheets where id = $1', [String(row.id)]);
    return { ok: true };
  });
}
