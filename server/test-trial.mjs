/**
 * Trials must never charge — checked against a REAL database, not a mock.
 *
 * The seeded fixture IS the bug this feature exists to prevent: a seller whose trial
 * expired yesterday, holding a $500 wallet balance. Before the trial branch, runRenewals
 * saw plan='pro' with a due renewal date and a funded wallet, and took the money from
 * someone who never agreed to pay.
 *
 * The paying subscriber alongside them is the control. Proving the trial ISN'T charged is
 * only half the claim — the other half is that real billing still works in the same run.
 *
 *   createdb egtrial && psql -q -d egtrial -f test-trial.sql
 *   DATABASE_URL=postgres://localhost/egtrial JWT_SECRET=test node test-trial.mjs
 */
import { runRenewals } from './src/routes/billing.js'
import { q } from './src/db.js'

const TRIAL = '11111111-1111-1111-1111-111111111111'
const PAYER = '22222222-2222-2222-2222-222222222222'
const bal = async (id) => Number((await q('select coalesce(sum(delta),0) b from wallet_ledger where account=$1',[id])).rows[0].b)
const usr = async (id) => (await q('select plan, plan_trial_ends_at, plan_trial_used_at, plan_renews_at from users where id=$1',[id])).rows[0]

let pass=0, fail=0
const ok=(n,g,w)=>{ const a=JSON.stringify(g),b=JSON.stringify(w)
  if(a===b){pass++;console.log(`  PASS  ${n}`)} else {fail++;console.log(`  FAIL  ${n}\n        got ${a}\n        want ${b}`)} }

console.log('\nbefore: trial balance', await bal(TRIAL), '| payer balance', await bal(PAYER))
await runRenewals()

console.log('\n— the trap: an expired TRIAL with a funded wallet —')
const t = await usr(TRIAL)
ok('wallet UNTOUCHED — not charged', await bal(TRIAL), 500)
ok('dropped to starter',             t.plan, 'starter')
ok('trial marker cleared',           t.plan_trial_ends_at, null)
ok('trial recorded as used',         !!t.plan_trial_used_at, true)
ok('no renewal scheduled',           t.plan_renews_at, null)
const charged = (await q("select count(*)::int c from wallet_ledger where account=$1 and type='subscription'",[TRIAL])).rows[0].c
ok('no subscription ledger entry',   charged, 0)

console.log('\n— the control: a real subscriber, same run —')
ok('payer WAS charged $29',          await bal(PAYER), 471)
ok('payer stays on pro',             (await usr(PAYER)).plan, 'pro')
ok('payer renewal moved FORWARD',    (await usr(PAYER)).plan_renews_at > new Date(), true)

console.log('\n— idempotency: run the sweep again —')
await runRenewals()
ok('trial still untouched',          await bal(TRIAL), 500)
ok('payer not double-charged',       await bal(PAYER), 471)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
