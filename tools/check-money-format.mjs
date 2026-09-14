#!/usr/bin/env node
/**
 * THE MONEY FORMAT GATE.
 *
 * `usd()` in web/lib/order-format.ts is the one place an amount becomes text, and it is read
 * on every surface that shows money: the order summary, the wallet ledger, the quote, the
 * boards. A formatting rule with nothing executing it is the kind that regresses quietly —
 * this one already did. It rendered a negative as `$-20.50` (symbol, then sign, then
 * digits), and it surfaced on Gross margin, the single row on an order that says whether the
 * job lost money. Every deduction above it read `−$39.00`, because those call sites prepend
 * the sign by hand to a positive amount, so the loss row was the only figure in the column
 * formatted unlike its neighbours.
 *
 * This EXECUTES the real exported function out of the real file rather than re-implementing
 * it — a copy of the formatter tested against itself would pass forever while the app
 * diverged, which is the false confidence CLAUDE.md §7 is about.
 *
 * Run: node tools/check-money-format.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = readFileSync(join(ROOT, "web/lib/order-format.ts"), "utf8")

/* Lift the real declaration out of the module. It is plain JS inside a .ts file — no types
   in the body — so it evaluates as written. If someone gives it a typed signature this
   throws, which is the correct failure: the gate must never silently test something else. */
const m = SRC.match(/export const usd = \(n: number\) => \{[\s\S]*?\n\}/)
if (!m) {
  console.error("FAIL  could not find `export const usd` in web/lib/order-format.ts")
  process.exit(1)
}
const usd = eval(`(${m[0].replace("export const usd = (n: number) =>", "(n) =>")})`)

let bad = 0
const check = (name, got, want) => {
  const ok = got === want
  if (!ok) bad++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name.padEnd(34)} ${got}${ok ? "" : `   want ${want}`}`)
}

console.log("THE SIGN GOES BEFORE THE SYMBOL")
check("usd(-20.5)", usd(-20.5), "−$20.50")
check("usd(-1234.5)", usd(-1234.5), "−$1,234.50")
check("usd(41.91)", usd(41.91), "$41.91")
check("usd(6.99)", usd(6.99), "$6.99")

console.log("\nA VALUE THAT ROUNDS TO ZERO CARRIES NO SIGN")
check("usd(0)", usd(0), "$0.00")
check("usd(-0.004)", usd(-0.004), "$0.00")
check("usd(-0)", usd(-0), "$0.00")

console.log("\nTHE GLYPH IS U+2212, NOT A HYPHEN")
{
  const neg = usd(-5)
  const ok = neg.startsWith("−") && !neg.includes("-")
  if (!ok) bad++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${"leading glyph".padEnd(34)} U+${neg.codePointAt(0).toString(16).toUpperCase()}`)
}

console.log("\nALWAYS TWO DECIMALS")
check("usd(7)", usd(7), "$7.00")
check("usd(0.5)", usd(0.5), "$0.50")

/* ---- the double-sign hazard ------------------------------------------------------------
 * Six call sites prepend a sign to a POSITIVE magnitude (`−{usd(cost)}`), which is correct
 * and readable. It only breaks if one of them is ever handed a negative, which would now
 * render `−−$5.00`. The formatter cannot defend against that, so the gate names the sites
 * instead: the count is the thing to notice when it changes.
 */
const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    if (e === "node_modules" || e === ".next" || e === "dist") continue
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}
const prepends = []
for (const p of walk(join(ROOT, "web/app")).concat(walk(join(ROOT, "web/components")))) {
  readFileSync(p, "utf8").split("\n").forEach((line, i) => {
    if (/["−+]\}?\{usd\(|−\{usd\(/.test(line)) prepends.push(`${p.slice(ROOT.length + 1)}:${i + 1}`)
  })
}
console.log(`\nCALL SITES THAT PREPEND THEIR OWN SIGN: ${prepends.length}`)
for (const p of prepends) console.log("  " + p)
console.log("  (each must pass a MAGNITUDE — a negative here would render as −−$5.00)")

console.log(bad ? `\n${bad} failure(s).` : "\nMoney formats correctly.")
process.exit(bad ? 1 : 0)
