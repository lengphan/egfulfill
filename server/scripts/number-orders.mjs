/**
 * GIVE EVERY ORDER ITS `EGF-000123`, oldest first, then hand the sequence to the database.
 *
 * `ref_no` and `order_ref_seq` are created at route load (orders.js). The DEFAULT is set
 * HERE rather than there, and the ordering is the whole reason: a default in place before
 * this runs would hand EGF-000001 to the next NEW order while 1243 older ones sat unnumbered,
 * so the first number would not belong to the first order.
 *
 * ONE TRANSACTION, and the table is locked for it. Two things must be true together —
 * every existing row numbered in created_at order, and the sequence positioned above them —
 * and a row inserted between those two steps would take a number already used. At this size
 * the lock is held for well under a second.
 *
 * Re-runnable: it numbers only `ref_no is null`, so a second run is a no-op. An order created
 * between the deploy and this run is simply the newest and sorts last, which is correct.
 *
 *   docker compose exec -T api node scripts/number-orders.mjs          # report only
 *   docker compose exec -T api node scripts/number-orders.mjs --apply  # write
 */
import { q } from '../src/db.js'

const APPLY = process.argv.includes('--apply')

const before = (await q(`
  select count(*)::int as total,
         count(ref_no)::int as numbered,
         count(*) filter (where ref_no is null)::int as missing
    from orders`)).rows[0]
console.log(`orders ${before.total} · numbered ${before.numbered} · to number ${before.missing}`)

if (!APPLY) {
  const preview = (await q(`
    select id, created_at, row_number() over (order by created_at asc, id asc) as n
      from orders where ref_no is null order by created_at asc, id asc limit 3`)).rows
  for (const r of preview) console.log(`  EGF-${String(r.n).padStart(6, '0')}  ${r.id}  ${r.created_at.toISOString().slice(0, 10)}`)
  console.log('  …')
  console.log('\nreport only — pass --apply to write')
  process.exit(0)
}

await q('begin')
try {
  /* ACCESS EXCLUSIVE: nothing may insert while the numbers and the sequence are being put
     in step with each other. */
  await q('lock table orders in access exclusive mode')
  const base = Number((await q('select coalesce(max(ref_no), 0) as m from orders')).rows[0].m) || 0
  const r = await q(`
    with ordered as (
      select id, row_number() over (order by created_at asc, id asc) as n
        from orders where ref_no is null
    )
    update orders o set ref_no = $1 + ordered.n
      from ordered where o.id = ordered.id
    returning o.ref_no`, [base])
  const max = Number((await q('select coalesce(max(ref_no), 0) as m from orders')).rows[0].m) || 0
  await q(`select setval('order_ref_seq', $1, true)`, [String(max)])
  /* From here the database allocates it, so every insert path gets a number — the
     marketplace syncs included — without one line of code in any of them. */
  await q(`alter table orders alter column ref_no set default nextval('order_ref_seq')`)
  await q('commit')
  console.log(`numbered ${r.rowCount} · sequence now at ${max} · default set`)
} catch (e) {
  await q('rollback')
  console.error('rolled back:', e.message)
  process.exit(1)
}

const sample = (await q(`select ref_no, id, created_at from orders order by ref_no asc limit 3`)).rows
for (const s of sample) console.log(`  EGF-${String(s.ref_no).padStart(6, '0')}  ${s.id}  ${s.created_at.toISOString().slice(0, 10)}`)
process.exit(0)
