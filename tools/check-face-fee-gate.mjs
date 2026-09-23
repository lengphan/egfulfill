/**
 * DOES THE MONEY MOVE WHEN THE ARTWORK DOES — executed against a real Postgres.
 *
 * A surface can be DECLARED before it is drawn ("the back is embroidered", artwork to
 * follow). That opened a row shape this table never had: one with a method and no bytes. The
 * charge must not follow the declaration, only the artwork — in BOTH directions, and on a
 * path where being wrong means a seller is billed for a print nobody made, or we print one
 * nobody paid for.
 *
 * Reading the SQL cannot settle that. This drives quoteOrder's real face query against real
 * rows, adding and removing artwork and a type in every order they can happen.
 *
 *   node tools/check-face-fee-gate.mjs                       (makes its own throwaway database)
 *   FEE_GATE_DATABASE_URL=postgres://you@host/egtest node …   (or point it at one)
 *
 * It creates and drops its own tables, so it refuses any database not named for testing.
 */
/**
 * SELF-PROVISIONING, so this runs in the suite instead of being permanently amber.
 *
 * It used to exit 2 unless someone had exported FEE_GATE_DATABASE_URL by hand, which meant
 * tools/run-gates.sh and CI carried it as "known-red — needs an env var" while the thing it
 * guards is money: a seller billed for a print nobody made, or a print nobody paid for. A
 * gate that only runs when a human remembers a variable is a gate for the days nothing is
 * wrong. It now creates its own throwaway database the way every other database-backed gate
 * here does, and still honours the variable when it is set.
 *
 * THE NAME GUARD BELOW IS UNCHANGED AND IS THE POINT — this file DROPS TABLES, so it refuses
 * any database not named for testing. The name it makes for itself ends in `_test` so it
 * passes its own check rather than being waved through as a special case.
 */
import { execFileSync as _exec } from 'node:child_process';
const _sh = (cmd, args) => _exec(cmd, args, { encoding: 'utf8', stdio: 'pipe' });
const OWN_DB = 'egfulfill_face_fee_test';
let url = process.env.FEE_GATE_DATABASE_URL;
if (!url) {
  try { _sh('pg_isready', []); } catch {
    console.log('SKIP  no local Postgres accepting connections — start one to run this gate.');
    process.exit(0);
  }
  try { _sh('dropdb', ['--if-exists', '--force', OWN_DB]); }
  catch { try { _sh('dropdb', ['--if-exists', OWN_DB]); } catch { /* nothing to drop */ } }
  _sh('createdb', [OWN_DB]);
  url = `postgres://localhost:5432/${OWN_DB}`;
  process.on('exit', () => {
    try { _sh('dropdb', ['--if-exists', '--force', OWN_DB]); } catch { /* the next run drops it */ }
  });
}
const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
if (!/(^|[_-])test$|^egtest$/.test(dbName)) {
  console.error(`Refusing to run against "${dbName}" — name it egtest or *_test.`);
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'fee-gate';

const { q } = await import('../server/src/db.js');
const { priceLines } = await import('../server/src/pricing.js');

await q(`drop table if exists order_designs`);
await q(`create table order_designs (
  order_id text not null, sku text, line_id text, kind text not null default 'raster',
  side text, data text, storage_key text, method text, name text, pos jsonb,
  art_hash text, art_phash text, template_id text, updated_at timestamptz default now())`);

const row = { id: 1, sku: 'EG-1001', base_price: 18, data: { name: 'Hoodie', sku: 'EG-1001', basePrice: 18 } };
const idx = { exact: new Map([['EG-1001', row]]), rows: [row] };
const fees = { method_emb: 6, method_dtg: 0, method_side: 3, side_back: 4.5, ship_garment: 0, ship_extra: 0 };

/** quoteOrder's own face read, verbatim — including the filter that IS the fee gate. */
async function facesOf(orderId) {
  const rows = await q(`select coalesce('L:' || line_id, 'S:' || sku) as key,
                               lower(coalesce(side,'front')) as side, method
                          from order_designs
                         where order_id=$1 and (data is not null or storage_key is not null)`,
    [orderId]).then((r) => r.rows);
  const byKey = new Map();
  for (const r of rows) {
    let list = byKey.get(r.key);
    if (!list) byKey.set(r.key, (list = []));
    const hit = list.find((f) => f.side === r.side);
    if (hit) { if (!hit.method && r.method) hit.method = String(r.method).trim(); continue; }
    list.push({ side: r.side, method: String(r.method || '').trim() });
  }
  return byKey;
}
const ORDER = 'FF-9001', LINE = 'L1';
const item = { id: 1, sku: 'EG-1001', qty: 1, line_id: LINE, print_type: 'DTG printing' };
async function unit() {
  const byKey = await facesOf(ORDER);
  const sidesOf = (it) => byKey.get(`L:${it.line_id}`) ?? ['front'];
  return priceLines([item], idx, fees, sidesOf).lines[0].unitCost;
}
const put = (side, { data = null, method = null } = {}) =>
  q(`insert into order_designs (order_id, line_id, sku, side, data, method) values ($1,$2,'EG-1001',$3,$4,$5)`,
    [ORDER, LINE, side, data, method]);
/** The real DELETE's behaviour: a row that remembers a method is emptied, not removed. */
const removeArt = (side) => q(
  `update order_designs set data=null, storage_key=null, art_hash=null, pos=null
     where order_id=$1 and line_id=$2 and coalesce(side,'front')=$3 and method is not null
       and (data is not null or storage_key is not null)`, [ORDER, LINE, side])
  .then(() => q(`delete from order_designs where order_id=$1 and line_id=$2 and coalesce(side,'front')=$3 and method is null`,
    [ORDER, LINE, side]));

const pass = [], fail = [];
const t = async (label, got, want) => {
  const v = await got;
  (Math.abs(v - want) < 0.005 ? pass : fail).push({ label, got: v, want });
};

// The line alone: DTG front, nothing placed. Base only.
await t('no artwork at all', unit(), 18.00);

// IN: a declared surface is free until it is drawn.
await put('front', { data: 'art-front' });
await t('artwork on the front', unit(), 18.00);                 // DTG adds nothing
await put('back', { method: 'Embroidery' });                     // declared, not drawn
await t('a DECLARED back is free', unit(), 18.00);               // no side fee, no EMB
await q(`update order_designs set data='art-back' where order_id=$1 and side='back'`, [ORDER]);
await t('drawing it starts the charge', unit(), 28.50);          // +EMB 6 +back 4.50

// OUT: the money comes off the moment the artwork does, and the decision survives.
await removeArt('back');
await t('removing the artwork removes the fee', unit(), 18.00);
await t('and the surface still remembers its method',
  q(`select method from order_designs where order_id=$1 and side='back'`, [ORDER]).then((r) => r.rows[0]?.method === 'Embroidery' ? 1 : 0), 1);
await q(`update order_designs set data='art-back-2' where order_id=$1 and side='back'`, [ORDER]);
await t('putting artwork back re-charges it', unit(), 28.50);

// A face stored in object storage counts exactly the same as one stored inline.
await q(`update order_designs set data=null, storage_key='r2/key' where order_id=$1 and side='back'`, [ORDER]);
await t('storage_key is artwork too', unit(), 28.50);

// A stitch file beside the raster is ONE face, not two — and the method is taken from
// whichever row carries it.
await q(`insert into order_designs (order_id, line_id, sku, side, kind, data, method)
         values ($1,$2,'EG-1001','back','pes','stitches',null)`, [ORDER, LINE]);
await t('two rows on one side are one face', unit(), 28.50);

// Removing the front leaves the back as the only face — which is then the INCLUDED one,
// so the side fee goes even though the embroidery surcharge stays.
await removeArt('front');
await t('one face left is the included one', unit(), 24.00);

/* ── THE ROUTE ITSELF ─────────────────────────────────────────────────────────────────────
 *
 * Everything above drives the SQL. The bug that actually shipped was one layer up and
 * invisible to it: a declaration carries no bytes, `String(data)` turned undefined into the
 * literal string "undefined", and that is a non-null value — so the row walked through the
 * gate above and charged for a print of the word undefined. Reading the handler did not
 * show it; POSTing to it did, immediately.
 *
 * So the route is driven here too. Skipped, loudly, if the server cannot be started — a
 * check that silently does nothing is worse than one that is not there.
 */
const { spawn } = await import('node:child_process');
const { fileURLToPath } = await import('node:url');
const { dirname, join } = await import('node:path');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FEE_GATE_PORT || 4127);
await q(`create table if not exists orders (id text primary key, seller_id text, factory_order boolean default true, created_at timestamptz default now(), status text default 'new')`);
await q(`create table if not exists order_items (id bigserial primary key, order_id text, sku text, line_id text, name text, qty int default 1, print_type text)`);
await q(`insert into orders (id) values ('FF-GATE') on conflict do nothing`);
await q(`delete from order_items where order_id='FF-GATE'`);
await q(`insert into order_items (order_id, sku, line_id, name, print_type) values ('FF-GATE','EG-1001','LG','Hoodie','DTG printing')`);
const srv = spawn(process.execPath, ['src/index.js'], {
  cwd: join(ROOT, 'server'), stdio: 'ignore',
  env: { ...process.env, DATABASE_URL: url, JWT_SECRET: 'fee-gate', PORT: String(PORT) },
});
const base = `http://127.0.0.1:${PORT}`;
const up = await (async () => {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return true; } catch { /* still booting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
})();
if (!up) {
  console.log('  SKIP  the route checks — the server would not start on port ' + PORT);
  fail.push({ label: 'server did not start', got: 0, want: 1 });
} else {
  const { default: jwt } = await import(join(ROOT, 'server/node_modules/jsonwebtoken/index.js'));
  const token = jwt.sign({ sub: 'gate', role: 'admin', email: 'g@x.com' }, 'fee-gate', { expiresIn: '1h' });
  const post = (body) => fetch(`${base}/api/orders/FF-GATE/designs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const face = (side) => q(
    `select method, (data is not null or storage_key is not null) as art, name
       from order_designs where order_id='FF-GATE' and coalesce(side,'front')=$1`, [side])
    .then((r) => r.rows[0] ?? null);

  const ART = 'data:image/png;base64,iVBORw0KGgo=';
  await post({ sku: 'EG-1001', line_id: 'LG', side: 'front', data: ART, name: 'crest.png' });
  const declared = await post({ sku: 'EG-1001', line_id: 'LG', side: 'back', method: 'Embroidery' });
  const back = await face('back');
  await t('a declaration stores NO artwork', back?.art ? 1 : 0, 0);
  await t('and mints no design number', declared?.design_no == null ? 1 : 0, 1);
  await t('and records the method', back?.method === 'Embroidery' ? 1 : 0, 1);

  await post({ sku: 'EG-1001', line_id: 'LG', side: 'front', method: 'Embroidery' });
  const front = await face('front');
  await t('a method-only save leaves the picture alone', front?.art ? 1 : 0, 1);
  await t('and its name', front?.name === 'crest.png' ? 1 : 0, 1);
  await t('while setting the method', front?.method === 'Embroidery' ? 1 : 0, 1);

  await post({ sku: 'EG-1001', line_id: 'LG', side: 'front', method: null });
  await t('null clears it back to inheriting', (await face('front'))?.method == null ? 1 : 0, 1);

  await post({ sku: 'EG-1001', line_id: 'LG', side: 'front', data: ART, name: 'crest.png' });
  await t('a save that says nothing leaves other faces alone', (await face('back'))?.method === 'Embroidery' ? 1 : 0, 1);

  const refused = await post({ sku: 'EG-1001', line_id: 'LG', side: 'left' });
  await t('neither bytes nor method is still refused', refused?.error ? 1 : 0, 1);
  srv.kill('SIGKILL');
  await q(`delete from order_items where order_id='FF-GATE'`);
  await q(`delete from orders where id='FF-GATE'`);
}

for (const r of pass) console.log(`  PASS  ${r.label}  ($${r.got.toFixed(2)})`);
for (const r of fail) console.log(`  FAIL  ${r.label}\n        want $${r.want.toFixed(2)}  got $${r.got.toFixed(2)}`);
await q('drop table order_designs');
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
