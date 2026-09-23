/**
 * WHO IS STILL ASKING THE LINE WHAT THE FACE IS DOING.
 *
 * `order_items.print_type` kept its name and quietly changed meaning. It used to be THE
 * method; a garment can now be embroidered at the front and printed at the back, so it is
 * the line's own value — true of every face that never disagreed, and wrong about the ones
 * that did. There are ~155 references to it and not one of them fails loudly: printRoute
 * sends a half-embroidered garment to one bench, design_cards.is_emb marks it stitched or
 * not, publish writes one method onto a two-method listing.
 *
 * Renaming 155 sites is too blunt and a comment is a wish. This is the shape tools/
 * check-faces.mjs already established for the identical problem one question earlier:
 * EXECUTE the rule, then grep every surface that reads the column directly and require each
 * to be allow-listed WITH A STATED REASON. A blanket skip would make it decorative.
 *
 *   node tools/check-line-method.mjs
 *
 * Adding a reader is meant to be a deliberate act: put it in ALLOWED with a sentence saying
 * why the LINE is the right question there, or route it through the resolver.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── PART ONE: THE RULE, RUN ─────────────────────────────────────────────────────────────
 * A face that says nothing inherits the line; a face that speaks overrides it. Every reader
 * below is judged against this, so it is worth being sure it holds.
 */
const { billingMethodOf } = await import(join(ROOT, 'server/src/pricing.js'));
const fees = { method_emb: 6, method_dtf: 2, method_dtg: 0 };
const pass = [], fail = [];
const t = (label, got, want) => {
  (JSON.stringify(got) === JSON.stringify(want) ? pass : fail).push({ label, got, want });
};
const resolve = (line, faces) => faces.map((f) => (f && f.method) || line);
t('a silent face inherits the line',
  resolve('Embroidery', [{ method: '' }, { method: '' }]), ['Embroidery', 'Embroidery']);
t('a speaking face overrides it',
  resolve('Embroidery', [{ method: '' }, { method: 'DTG printing' }]), ['Embroidery', 'DTG printing']);
t('and the line is billed at the dearest of them',
  billingMethodOf(resolve('Embroidery', [{ method: '' }, { method: 'DTG printing' }]), {}, fees), 'Embroidery');
t('whichever order they arrive in',
  billingMethodOf(resolve('DTG printing', [{ method: 'Embroidery' }, { method: '' }]), {}, fees), 'Embroidery');

/* ── PART TWO: WHO READS THE LINE DIRECTLY ───────────────────────────────────────────────
 * Every entry names a file and says why the LINE is the right question there. "It is about
 * the whole garment" is a reason; "it has always done that" is not.
 */
const ALLOWED = new Map(Object.entries({
  // ── the column's own home ──
  'server/src/routes/orders.js': 'Writes and reads the column itself, and resolves faces against it.',
  'server/src/pricing.js': 'Owns the rule: costPartsOf falls back to the line when a caller has no faces, and billingMethodOf picks among them.',
  'web/lib/order-format.ts': 'methodsLabelOf IS the resolver for display, and falls back to the line by design.',
  'web/lib/api.ts': 'Type declarations and the fetchers that carry the column.',

  // ── genuinely about the whole garment ──
  'server/src/routes/etsy.js': 'Publishing a listing: a marketplace listing has one method field, and the line\'s is the honest one to send.',
  'server/src/routes/shopify.js': 'Same as etsy.js — one listing, one method field.',
  'server/src/routes/tiktok.js': 'Same as etsy.js — one listing, one method field.',
  'web/components/app/publish-product-page.tsx': 'Builds a listing, which has one method whatever the garment does.',
  'server/src/routes/catalog.js': 'A catalogue PRODUCT\'s methods, not an order line\'s.',
  'server/src/routes/spydeck.js': 'Competitor listings and our published ones — a listing field, not a face.',
  'server/src/routes/sandbox.js': 'The partner API\'s own line shape, which has never had faces.',
  'web/lib/order-import.ts': 'Parses the sheet, where the row-level column is the documented fallback for a placement that names no Type.',
  'web/components/app/import-orders-dialog.tsx': 'Import preview; falls back to the row when a position names no Type.',

  // ── reads the line to decide something about the line ──
  'web/lib/order-filter.ts': 'Filtering orders by method — a filter is about the line, and a mixed line matching both is the correct answer.',
  'web/lib/variant-resolve.ts': 'isEmbroidery() is the predicate everything else calls; it takes whatever string it is given.',
  'server/src/print-route.js': 'methodCode/printRoute take a method as an argument — they never read a line.',
  'server/src/routes/machine_files.js': 'Gates a stitch file. The per-position check is in the sheet and the grid; this is the line-level backstop.',
  'server/src/routes/pinkdesign.js': 'The partner brief takes one method — the partner has no concept of faces.',
  'web/components/app/design-canvas.tsx': 'The dialog resolves faceMethod ?? the line, which is the rule.',
  'web/components/app/variant-picker.tsx': 'Edits the LINE\'s own method, which is what it is for.',
  'web/components/app/push-to-partner-dialog.tsx': 'Sends to the partner, who takes one method.',
  'web/components/app/send-to-board-dialog.tsx': 'Board card label.',
  'web/components/app/item-design-actions.tsx': 'Row actions gated on the line being stitched at all.',
  'web/components/app/spydeck-view.tsx': 'Competitor listings.',
  'web/app/(app)/orders/[id]/page.tsx': 'The order page; its strip goes through methodsLabelOf and its summary through billedMethod.',
  // ── caught by this gate on its first run, and each one looked at ──
  'server/src/routes/reader.js': 'The extension reader INFERS a method from a receipt\'s wording ("embroidered", "monogram"). There are no faces on a page it is reading; the line is all it can say.',
  'web/app/(app)/orders/new/page.tsx': 'Creating a line. The line\'s method is what a new order carries; faces arrive with artwork, afterwards.',
  'web/components/app/activity-meta.tsx': 'A field-name lookup for the audit trail — it labels the column, it does not judge a garment.',
  'web/components/app/design-files-panel.tsx': 'The ORDER page\'s file panel: it picks which LINES a stitch file may attach to. Per-line is the right grain there — the per-FACE question is asked inside the dialog.',
  'web/components/app/designer-board.tsx': 'Reads the CARD\'s own method (card.type), which the card was stamped with when it was sent.',
  'web/lib/order-readiness.ts': '"Is this order ready" counts DECORATED lines — a line with any method at all. A face cannot make a line undecorated.',

  // ── added 2026-09-23, each judged rather than blessed ──
  'server/src/routes/design_files.js': 'THE FALLBACK ITSELF, in SQL: a design row with no method of its own inherits the line\'s (coalesce(d.method,\'\') = \'\' and i.print_type ~* \'emb\'). That is the rule this file tests, written as a query.',
  'web/lib/product-price.ts': 'productUnitPrice/priceMethodKey take a method as an ARGUMENT and never read a line — the same standing as print-route.js above.',
  'web/app/(app)/products/[id]/page.tsx': 'A catalogue PRODUCT\'s selected method, passed to the pricer. A product has no faces to disagree with.',
  'web/components/marketing/bold-product.tsx': 'Same as the product page — a marketing product view pricing one chosen method.',
  'web/lib/design-board.ts': 'Stamps a designer card with the line\'s method as the card is created, which is the same line-level snapshot designer-board.tsx reads back. A card is per LINE, and "does this job touch embroidery" is a routing question about the whole job.',
}));

const SCAN = ['server/src', 'web/lib', 'web/components', 'web/app', 'web/shared'];
const SKIP = new Set(['node_modules', '.next', '.git', 'dist', 'build']);
const RE = /\bprint_type\b|\bprintType\b/;
/* A MENTION IN PROSE IS NOT A READ. web/lib/print-method.ts was reported as an unlisted
   reader on the strength of the words "a line stores `print_type = Blank`" inside a comment
   explaining the vocabulary. Allow-listing a file for something it does not do is how a list
   of deliberate exceptions fills with noise and stops being read. Comments are stripped
   before matching — crudely, but a false positive here costs more than a missed string in an
   edge case the next line of real code would catch anyway. */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const found = new Set();
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(e)) continue;
    if (RE.test(codeOnly(readFileSync(full, 'utf8')))) found.add(relative(ROOT, full));
  }
};
for (const d of SCAN) { try { walk(join(ROOT, d)); } catch { /* not in this checkout */ } }

const unlisted = [...found].filter((f) => !ALLOWED.has(f)).sort();
const stale = [...ALLOWED.keys()].filter((f) => !found.has(f)).sort();
t(`every reader of the line's method is allow-listed with a reason (${found.size} files)`, unlisted, []);
/* A stale entry is a reason nobody is relying on any more, and leaving it makes the list a
   description of the past rather than a gate. */
t('and the list carries no entries for files that no longer read it', stale, []);

for (const r of pass) console.log(`  PASS  ${r.label}`);
for (const r of fail) {
  console.log(`  FAIL  ${r.label}`);
  if (Array.isArray(r.got) && r.got.length) for (const f of r.got) console.log(`        ${f}`);
  else console.log(`        want ${JSON.stringify(r.want)}\n        got  ${JSON.stringify(r.got)}`);
}
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
