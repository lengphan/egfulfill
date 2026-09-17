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
 *   createdb egtest
 *   FEE_GATE_DATABASE_URL=postgres://you@127.0.0.1:5432/egtest node tools/check-face-fee-gate.mjs
 *
 * It creates and drops its own tables, so it refuses any database not named for testing.
 */
const url = process.env.FEE_GATE_DATABASE_URL;
if (!url) { console.error('Set FEE_GATE_DATABASE_URL to a THROWAWAY database.'); process.exit(2); }
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

for (const r of pass) console.log(`  PASS  ${r.label}  ($${r.got.toFixed(2)})`);
for (const r of fail) console.log(`  FAIL  ${r.label}\n        want $${r.want.toFixed(2)}  got $${r.got.toFixed(2)}`);
await q('drop table order_designs');
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
