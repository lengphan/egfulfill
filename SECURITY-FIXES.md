# Security & data-integrity fixes — audit of 2026-07-21

Findings from a full-platform audit. Every item below was **reproduced against a real
Postgres** before being fixed, and the fix re-verified the same way. Where something was
inferred from reading code rather than executed, it says so.

## Why this file exists

The first batch of fixes was committed by a concurrent session that ran `git add -A`, so
it landed inside **`6f2115a` — "design partner: send from the item row, not the board
card"**, a commit whose message describes something else entirely. Nothing in that history
tells you a privilege-escalation fix shipped. This file is that record. The commit is
already pushed and other work sits on top of it, so it was deliberately **not** rewritten.

---

## In `6f2115a` (already deployed)

| # | Fix | How it was proven |
|---|---|---|
| 1 | **Privilege escalation: operator → admin.** `/api/auth/forgot` is public and opens a pending reset for *any* account; the reset-request routes were `requireStaff`, which includes operator and designer; `resolve` then set `password_hash` with no check on the target's role. Now gated on `canManageUsers` (admin/warehouse) with an admin-target block, matching `users.js`. | Took over the admin account and logged in as it. After: 403 at both steps; admin's own flow still 200. |
| 2 | **Empty POST wiped the shared catalog.** `POST /api/catalog_products` with `[]` deleted every product — and the client seeds that body from a localStorage cache the store clears under quota pressure. | 3 products → 0, response `{"ok":true}`. After: 400, all 3 preserved. |
| 3 | **Partial POST wiped inventory.** The whole-list upsert deleted every SKU absent from the body; the Purchase board builds that body from a GET whose `.catch()` yields `[]`. Pruning is now opt-in (`?prune=1`). | 5 SKUs → 1. After: all 5 kept; `?prune=1` still prunes. |
| 4 | **Operator *and* designer could credit any wallet.** `/api/wallet/ledger` and `/transfer` gated on `isStaff`, which admits both. Now `canMoveMoney` (admin/warehouse), consolidated in `auth.js` — `order_refunds.js` and `design_files.js` each kept a private copy of the same rule. | Balance driven 50 → 17,827. After: 403/403, admin 200. |
| 5 | **Ledger idempotency was racy.** `wallet_ledger_dedupe` never existed: the DDL calls were unchained, so `CREATE INDEX` raced `CREATE TABLE`, lost, and the error went into `.catch(() => {})`. Every `on conflict do nothing` in the money paths silently degraded to "always insert". | 10 concurrent posts, same ref → **2 rows, double credit**. After: 1 row. |
| 6 | **All carrier tracking was dead.** `shipping.js` calls `q()` but never imported it, so `refresh-tracking` and the Shippo webhook threw `ReferenceError`. Delivery status was never written by anything. | Live response `{"error":"q is not defined"}`. After: real business logic. The shadowing local `const q = req.query` was renamed. |
| 7 | **Operator could set any stock level.** `PATCH /api/inventory/:sku` was `requireStaff` while every sibling write is `requireWarehouse`. | Stock set to 9999. After: 403. |
| 8 | **Three cross-tenant reads.** Any seller could read `/api/vietqr/transactions` (other sellers' bank accounts, amounts, memos) and factory-wide `/api/dispatch/status`; `/api/vietqr/status` returned whole rows on an unanchored substring match; `/api/admin/secrets` leaked first-12 + last-8 of each key to operators/designers. | All confirmed 200, now 403 / masked to last-4 with a derived `mode` field. |
| 9 | **`wallet_ledger.order_id` never existed.** `ensureCostColumns()` adds it and was never called, so the refund attribution UPDATE always threw — taking `refund_part` with it. Refunds were re-spread top-down, making per-part caps wrong (total cap held). | Column absent on a fresh DB; now created in the chained DDL. |
| 10 | **Design saves 500'd on every fresh deploy.** Same unchained-DDL race: `order_designs` was created without `pos`/`art_hash`/`art_phash`/`storage_key`. Self-healed on second boot, which is why it was invisible. | Postgres `42703 — column "storage_key" does not exist`. After: complete on first boot. |
| 11 | **SpyDeck's day-cache never hit.** `settings.value` is `jsonb` (four route files declare it `text`, all no-ops once the table exists), so node-pg returns an object and `JSON.parse` threw. `/trending` silently rebuilt with 16 live Etsy searches *per request*; `/listing/:id/detail` 500'd every time. | `JSON.parse` → `SyntaxError: "[object Object]" is not valid JSON`. |
| 12 | **Scan audit trail recorded nobody.** `req.user.id` doesn't exist — the JWT signs `sub`. `scan_history.by_id` was always NULL and the drawer rendered blank. `ss_favorites.created_by` was also declared `integer` against a uuid; converted (lossless — it could never have held a value). | JWT payload inspected; column types checked. |

## In `c5207f9` — UI honesty

A failed read rendered as a confident zero in six places. The wallet page fell back to a
`ZERO` view, so a 502 or expired token showed **"Available balance $0.00"** under a green
"Ready for fulfillment" — identical to a new account. Dashboard, reports and the staff
dashboard moved state out of `null` into `[]`, defeating the `orders === null ? "—"` guard
already on every tile. Designer earnings reported "Total earned $0.00". SpyDeck discarded
the server's own 502 reason. `team/my-access` failed **open**, promoting a
permission-limited member to full nav on a DB error.

Verified with Puppeteer against a dead API — three rounds. The first pass still left a
revenue chart drawing a flat line at the axis, skeleton rows that could never resolve, and
"No revenue yet." / "No product sales yet." in the reports panels; all are claims about the
business, so each is now gated on having actually read the orders.

Also here: the dispatch board's "Open labels" showed to operators while
`markLabelPrinted` is warehouse/admin, and the 403 went into `.catch(() => {})` — printed
dots never filled in and nothing said why.

## In `a6b5b0b` — money & marketplace

- **Card and PayPal top-ups never credited the wallet.** `recordTopup` wrote only
  `topup_requests`; balance is `SUM(delta)` over `wallet_ledger`. Money was charged and
  never landed, and an admin couldn't repair it because `confirm` only matches `pending`.
- **VietQR credited the seller-declared amount.** Declaring $5,000 and wiring ~$0.39 with
  the right note credited $5,000. Now the received amount must cover the declared VND.
  **Behaviour change:** underpayments wait for manual approval instead of auto-crediting.
- **`JWT_SECRET` fell back to a value public in this repo.** Production now refuses to start.
- **Etsy publish wrote to the wrong shop** (oldest connection, not the caller's), and
  **fulfill** matched on a renameable `shop_name` with a silent `|| conns[0]` fallback —
  on a route that emails the buyer. It now refuses rather than guessing.
- **The Etsy webhook was public** and ran a full sync across every seller's token, so a
  loop against it could drain the platform-wide Etsy quota.

---

## Known-incomplete after this pass

Reported by the audit, **not yet fixed**, and not to be mistaken for verified-clean:

- `consignment.js reserveConsigned` holds stock against the raw listing SKU with no blank
  resolution or `-EMB`-style suffix strip, so a marketplace line reserves **zero** units.
  `replenish.js` does this correctly — two readers of one fact.
- `replaceItems` deletes and re-inserts `order_items` without `personalization`, so editing
  a marketplace order drops the buyer's text. Not recoverable: incremental sync never
  re-fetches an untouched receipt.
- Shopify's order upsert overwrites `address`/`customer` unconditionally; Etsy has a guard
  for exactly this and Shopify never got it. Also re-imports PII after `customers/redact`.
- Etsy full sync deletes historical shipped orders scoped by `seller_id` rather than
  `shop_id`, and the "one-time" guard runs on every manual full sync.
- Same-SKU sibling lines cross-contaminate on re-sync (`order_id + sku` matching, while
  `line_id` exists and is used correctly elsewhere).
- `web/` can never create a line with a `line_id`, so every manually created order has
  NULL line ids and the sku fallback flips all siblings together.
- `order-status.ts` is a third stage vocabulary that bypasses `normalizeStage`; `backorder`
  renders as "In Production" and never reaches the seller's "Needs attention" tab.
- `GET /api/design_files` has no order-ownership check and is a 403-vs-`[]` existence
  oracle across sellers; rows with a NULL `seller_id` are readable by any seller.
- Canvas work in `design-canvas.tsx`, `phash.ts` and `design-maker.tsx` bypasses
  `canvasReadableSrc()`, so the eyedropper and the perceptual hash silently do nothing on
  remote (object-storage) artwork.
- `GET /api/orders` has no LIMIT and the staff branch has no seller filter; every dashboard
  number is computed in the browser from the full all-time array.
- Integration keys are read at module scope in `etsy.js`, `shopify.js`, `tiktok.js`,
  `ss.js`, `ottocap.js`, `usps.js`, `ads.js`, `sheets.js` and partly `vietqr.js`, so keys
  saved in Settings don't apply until a restart while the UI reports success.
- Auto-replenish can double-order once a draft PO has been placed (idempotency key is
  per-PO-number); `purchase_orders.meta` is missing from `schema.sql` and `replenish.js`
  never calls the lazy `ensure()` that adds it.
- Dispatch: a failed expedite charge still reports `charged: true`, and cancelling a
  dispatch reverses neither side of the money.
- The only label-void button in production takes the USPS-direct path, which is what
  produces the EPS credit-card error; the aggregator equivalent exists but is dead code
  with no stored provider id to void against.
- OAuth `state` is never validated on Etsy/TikTok (warn-and-continue).
