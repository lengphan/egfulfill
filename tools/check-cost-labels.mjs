#!/usr/bin/env node
/**
 * EVERY COST TYPE HAS A WORD.
 *
 * `COST_TYPES` in server/src/costs.js is the list of things we spend money on. The order
 * Summary turns each one into a row, and `WORDS` in routes/orders.js supplies the English.
 *
 * Those were once the SAME object, which made the list and the labels one hand-kept mirror:
 * the costs query filtered on the label map's keys, so a cost type added to costs.js and not
 * mirrored was never selected at all. The money vanished from the order's costs and Gross
 * margin — the one row that says whether a job lost money — overstated by exactly that
 * amount, with nothing on screen to suggest a row was missing. The two lists happened to
 * agree, which is the worst state for a mirror to be in: it looks correct right up until
 * someone adds the eighth type.
 *
 * The query now reads COST_TYPES directly, so a new type is always counted. What this gate
 * protects is the second half: that it is also NAMED. An unnamed type falls back to its raw
 * string (`customs-cost`), which is visible and obviously unfinished rather than silently
 * absent — the right failure, but still a failure worth catching before a seller sees it.
 *
 * Run: node tools/check-cost-labels.mjs
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

const costsSrc = readFileSync(join(ROOT, "server/src/costs.js"), "utf8")
const ordersSrc = readFileSync(join(ROOT, "server/src/routes/orders.js"), "utf8")

/** Every value in the COST_TYPES object literal. */
const block = costsSrc.match(/export const COST_TYPES = \{[\s\S]*?\n\}/)
if (!block) { console.error("FAIL  COST_TYPES not found in server/src/costs.js"); process.exit(1) }
const types = [...block[0].matchAll(/^\s*[a-zA-Z]+:\s*'([^']+)'/gm)].map((m) => m[1])

/** Every key in the WORDS map the Summary labels rows with. */
const words = ordersSrc.match(/const WORDS = \{[\s\S]*?\n\s*\};/)
if (!words) { console.error("FAIL  WORDS map not found in server/src/routes/orders.js"); process.exit(1) }
const named = [...words[0].matchAll(/'([^']+)':\s*'/g)].map((m) => m[1])

let bad = 0
console.log(`COST_TYPES: ${types.length}   named: ${named.length}\n`)

for (const t of types) {
  const ok = named.includes(t)
  if (!ok) bad++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${t.padEnd(22)} ${ok ? "" : "has no word in WORDS — will render as its raw type"}`)
}

/** A word for a type that no longer exists is dead weight, and a hint someone renamed one. */
for (const n of named) {
  if (!types.includes(n)) {
    bad++
    console.log(`  FAIL ${n.padEnd(22)} named, but not in COST_TYPES — renamed or removed?`)
  }
}

/* The query must read the canonical list, not the label map. This is the defect itself, so
   it is asserted rather than left to a comment. */
const derives = /const types = Object\.values\(COST_TYPES\)/.test(ordersSrc)
if (!derives) bad++
console.log(`\n  ${derives ? "ok  " : "FAIL"} the costs query selects Object.values(COST_TYPES)`)
if (!derives) console.log("       a type missing from the filter is money missing from Gross margin")

console.log(bad ? `\n${bad} problem(s).` : "\nEvery cost type has a word, and the query reads the canonical list.")
process.exit(bad ? 1 : 0)
