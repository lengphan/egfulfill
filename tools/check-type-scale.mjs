#!/usr/bin/env node
/**
 * A VALUE IS NOT A CAPTION.
 *
 * The type scale (globals.css) is six steps — 11 · 12 · 14 · 18 · 24 · 36 — and the sizes
 * themselves are fine. What goes wrong is WHICH step a piece of text gets, and it goes wrong
 * in one direction only: a figure somebody has to READ ends up at the size of the word that
 * names it.
 *
 * The top-up dialog is the case that started this. It rendered
 *
 *     Account            1231255899
 *
 * with the label and the account number BOTH at `text-xs` — 12px. That number is transcribed
 * by hand into a banking app, digit by digit, and it was set at caption size. The only way to
 * read it was the zoom control, which magnifies the whole page including the header — so the
 * fix people reach for makes four other things wrong to fix one.
 *
 * THE RULE, which is what this file checks:
 *
 *   A VALUE  — something a person reads, copies or transcribes: an account number, a
 *              tracking number, a reference, a total, an order number, a SKU — is at least
 *              `text-sm` (14px). Never smaller.
 *   A LABEL  — the word that names a value — may be `text-xs` (12px). It is read once.
 *   A MARK   — a count badge, a chip, a timestamp beside a row — may be `text-2xs` (11px).
 *              It is recognised, not read.
 *
 * WHAT THIS CANNOT DO, stated plainly: it cannot tell a value from a label by looking at a
 * class name. It matches ELEMENTS THAT RENDER A VALUE-SHAPED EXPRESSION — a field named
 * `account`, `tracking`, `ref`, `total`, `sku`, `seq` and friends, or a `usd(...)` call —
 * and flags the ones sized at 11px or 12px. That leaves both kinds of mistake possible: a
 * variable innocently named `total` inside a caption is a false positive, and a value held
 * in a variable this list has never heard of is a miss. It is a net, not a proof — which is
 * why every hit is printed with its line rather than just counted.
 *
 * Run:  node tools/check-type-scale.mjs          (report)
 *       node tools/check-type-scale.mjs --strict (exit 1 if anything is flagged)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['web/app', 'web/components'];
/* Print surfaces size text in millimetres of paper and are deliberately outside the scale —
   globals.css says so where the steps are defined. A label sheet is not read on a screen. */
const SKIP = /(catalog-print|label-sheet|print-|\.next|node_modules)/;

const SMALL = /\btext-(2xs|xs)\b/;

/**
 * The shapes a VALUE takes in this codebase. Deliberately narrow: every entry here is
 * something a person is expected to read off the screen and act on, and the cost of a wider
 * list is a report nobody trusts.
 */
const VALUE = new RegExp([
  // money, and the helpers that format it
  /\busd\(/, /\bmoney\(/, /\bbalance\b/,
  // the identifiers people transcribe into another system
  /\.account\b/, /\bvaAccount\b/, /\.tracking\b/, /\.ref\b/, /\.seq\b/,
  /\.sku\b/, /\borderNum\b/, /\bnumOf\(/, /\.invoice\b/,
].map((r) => r.source).join('|'), 'i');

/*
 * `note`, `total`, `amount` and `price` were in that list and came straight back out.
 *
 * Every one of them is two words in this codebase. `note` is a reference on a top-up and
 * PROSE everywhere else ("Footer note (optional)"); `total` is an order's money and also the
 * denominator of "3 of 12"; `amount` and `price` name as many form labels as they do figures.
 * They produced more noise than signal, and a report with a third of its rows wrong is one
 * nobody reads twice — which is the same failure as having no report.
 *
 * The property-access forms (`.sku`, `.ref`, `.tracking`) are deliberate for the same reason:
 * `o.sku` is a value being rendered, while a bare `sku` is as likely to be a prop name, a
 * variable in a callback or a word in a sentence.
 */

/* A line that is plainly the LABEL half of a row, not the value. `dt` is the label element
   in a description list, and an uppercase-tracking caption is the house label treatment. */
const LABEL = /<dt\b|<label\b|uppercase|tracking-\[0\.1|tracking-widest|aria-label|placeholder=|title=/;

const files = [];
function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    if (SKIP.test(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.tsx$/.test(p)) files.push(p);
  }
}
ROOTS.forEach(walk);

/**
 * TWO TIERS, because only one of them is a rule.
 *
 * FLOOR (fails --strict): a value at `text-2xs`, the 11px step. 11px is for a MARK — a count
 * badge, a chip — something recognised at a glance rather than read. A tracking number there
 * is not small, it is illegible, and there is no screen on which that is the right answer.
 * This tier is at zero and the gate is what keeps it there.
 *
 * WATCH (reported, never fails): a value at `text-xs`, 12px. Whether that is wrong depends
 * on what the row is FOR — a SKU as the second line under a product name is a fine 12px, and
 * the same SKU as the only thing in a cell is not. A gate cannot see the difference, so it
 * counts them and says so rather than pretending to judge. If this number climbs, someone is
 * sizing values by where they sit instead of by what they are.
 */
const hits = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!SMALL.test(line)) return;
    if (!VALUE.test(line)) return;
    if (LABEL.test(line)) return;
    hits.push({
      file: f, line: i + 1, text: line.trim().slice(0, 120),
      floor: /\btext-2xs\b/.test(line),
    });
  });
}

const floor = hits.filter((h) => h.floor);
const watch = hits.filter((h) => !h.floor);

const report = (title, rows) => {
  const byFile = new Map();
  for (const h of rows) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
  console.log(`\n${title} — ${rows.length} in ${byFile.size} files`);
  if (!rows.length) { console.log('  (none)'); return; }
  console.log('');
  for (const [file, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${file}`);
  }
};

report('FLOOR · a value at 11px (text-2xs)', floor);
if (process.argv.includes('--list')) for (const h of floor) console.log(`     ${h.file}:${h.line}  ${h.text}`);
report('WATCH · a value at 12px (text-xs)', watch);
if (process.argv.includes('--list')) for (const h of watch) console.log(`     ${h.file}:${h.line}  ${h.text}`);
console.log('');

if (process.argv.includes('--strict') && floor.length) {
  console.log(`FAILED: ${floor.length} value(s) at the 11px step. Raise them, or make the case in a comment.\n`);
  process.exit(1);
}
