/**
 * The approval gate, exercised against the REAL exported decision.
 *
 * Approved is described in orders.js as "the stage where a human has confirmed the blank on
 * every line" — and until 2026-08-21 nothing verified it, so an order with no blank, colour,
 * size or artwork walked Pending -> Approved -> Working in silence. These cases are the ones
 * that hole allowed; case 1 is the order that was reported.
 */
import { approvalBlockersFor } from '../server/src/routes/orders.js'

const TEE = new Map([['EG-TEE', { colors: true, sizes: true }]])
const PATCH = new Map([['EG-PATCH', { colors: false, sizes: false }]])

const cases = [
  { name: 'the reported order — nothing picked, EMB declared',
    items: [{ sku: 'LA6', name: 'Custom Apron', blank: '', color: '', size: '', print_type: 'EMB' }],
    missing: ['Custom Apron'], axes: new Map(), expect: true },
  { name: 'blank set, colour and size still empty on a blank that offers both',
    items: [{ sku: 'A', name: 'Tee', blank: 'EG-TEE', color: '', size: '', print_type: '' }],
    missing: [], axes: TEE, expect: true },
  { name: 'a patch — catalog offers no colour or size, so neither is demanded',
    items: [{ sku: 'P', name: 'Patch', blank: 'EG-PATCH', color: '', size: '', print_type: '' }],
    missing: [], axes: PATCH, expect: false },
  { name: 'decorated line WITH artwork and full variants',
    items: [{ sku: 'A', name: 'Tee', blank: 'EG-TEE', color: 'Black', size: 'L', print_type: 'DTG' }],
    missing: [], axes: TEE, expect: false },
  { name: 'plain blank, no print method, no artwork needed',
    items: [{ sku: 'B', name: 'Blank tee', blank: 'EG-TEE', color: 'White', size: 'M', print_type: '' }],
    missing: [], axes: TEE, expect: false },
  { name: 'an order with no lines',
    items: [], missing: [], axes: new Map(), expect: true },
]

let bad = 0
for (const c of cases) {
  const out = approvalBlockersFor(c.items, c.missing, c.axes)
  const blocked = out.length > 0
  const ok = blocked === c.expect
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name}`)
  if (out.length) console.log(`        -> ${out.join('; and ')}`)
}
console.log(bad ? `\n${bad} case(s) wrong` : '\napproval gate agrees with every case')
process.exit(bad ? 1 : 0)
