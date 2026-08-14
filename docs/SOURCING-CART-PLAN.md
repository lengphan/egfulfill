# Sourcing cart — buying the blanks an order is short of

Status: **planned, not built.** Decisions below are settled; phases are not started.
Written 2026-08-14.

---

## The rule everything else serves

**Start never buys.** Pressing Start fills a cart. A human with the authority to see the
wallet balance decides what is actually purchased.

This is not a preference. A blank order costs real money against a balance that may not
cover it, and software committing that spend is the failure mode this whole design avoids.
`replenish.js` already says the same thing in its own words, and it is right:

> This used to open (or append to) a draft PO by itself. That put quantities on a document
> nobody had chosen to create, from orders nobody could see — and committed spend is not
> something software should decide. It also assumed the money was there.

---

## What already exists (do not rebuild)

| Piece | Where | State |
|---|---|---|
| Per-line blank stock, at every stage | `orders-hub.tsx` → `LineStock` | done 2026-08-14 |
| Order-level stock chip + gap reasons | `web/lib/stock-status.ts` | done |
| Start → parks shortfalls, never buys | `server/src/replenish.js`, called from `orders.js` on `working` | done |
| Shared **saved-for-later** list | `factory_lists` key `po_saved` | done — this IS "saved for later" |
| Draft POs grouped by supplier, `sources[]`, receiving | `server/src/routes/purchase.js` | done — this IS the cart |
| SKU → supplier + api | `POST /api/purchase/resolve-suppliers` | **knows only `ss` and `otto`** |
| No-API suppliers: URL, cost, re-order link | `server/src/routes/manual_suppliers.js` | done |
| Placing an order with a supplier | `ss.js` / `ottocap.js` / `sanmar.js` | **gated off, payloads never validated** |

The two halves of the model are already built — they are just wired in the opposite order.
Start currently writes to **saved**; the plan is that it writes to the **cart**.

---

## Measured reality (2026-08-14, live data)

The blocker fix is **done and deployed**. What it revealed is that the cart is gated on
catalogue setup, not on code:

```
unshipped lines           1151
  resolve to a SKU          54   (53 of those are stocked)
  resolve to nothing      1097

why they don't resolve:
  no blank picked at all  1008   ← marketplace orders arrive unset
  blank name not in the catalogue ~90
     "Unisex Heavy Cotton™ T-Shirt"  18
     "Gildan Unisex Cotton Shirt"    17
     "test product"                  16
```

`inventory` holds **4 SKUs** against ~1,100 committed units.

**So Start would fill an almost-empty cart today, no matter which quantity model is used.**
Two things move that number, and neither is this feature:

1. **Blanks get picked** on marketplace lines (1,008 of them) — or resolve automatically,
   by mapping listing SKUs (`LA6`, `LA3`, `LA10-POCKET`, `LA10-NOPOCKET` — the four biggest
   by volume) onto catalog products via `variantSkus`. That one mapping covers ~1,000 units.
2. **Blank names get reconciled** with the catalogue — three names carrying ~50 lines are
   near-misses for products that exist.

Building phases 1–4 before that lands means shipping a cart with nothing in it.

## Settled decisions

1. **Group the cart by the supplier we buy FROM** — S&S, Otto, SanMar, a named Alibaba
   seller, Amazon. One group is one checkout, because that is the unit actually paid.
2. **Quantity = this order's shortfall against what is FREE**, not a top-up to `reorder_at`
   and not measured against `in_stock`:

   ```
   available = in_stock − claimed by other unshipped orders
   buy       = need − available
   ```

   Measuring against `in_stock` under-orders every time, because stock reads high the
   moment an order is accepted — nothing has been picked off the shelf yet. The cart maps
   1:1 to orders you can see, which is what makes it checkable before spending.
   Consequence, accepted: no buffer is built, so the same blank is re-bought order after
   order until someone sets up a top-up job. **Implemented in `replenish.js` 2026-08-14.**
3. **Buy = build the order, do not send.** Check the wallet balance server-side, mark the
   lines `ordered`, store the built payload. Do **not** contact the supplier: the
   S&S/Otto/SanMar payloads have never been validated against a live account, and
   Alibaba's request signature is unverified pending app approval.
4. **Cost books to `wallet_ledger` on Buy, and is reversible.** Committed spend shows in
   reports; cancelling a PO writes the reversal rather than deleting the row.
   `wallet_ledger` is append-only, so a cancel is a compensating entry.

---

## Model

A draft purchase order **is** the cart. No new cart table.

- **`item.state`** on PO items: `cart` → `saved` → `ordered` → `received`.
  "Saved for later" and "add it back when needed" are one field moving both ways, which is
  why this is a state and not a delete.
- **`sourcing_routes`** (new): `sku → { supplier, kind: 'api'|'manual', api, url, unit_cost, priority }`.
  This is the only genuinely new structure, and it is what makes the split work: an `api`
  line gets a payload, a `manual` line gets a clickable listing to buy from.

---

## Phases

**1 — Cart states.** `state` on PO items; a Saved-for-later section in the Purchase view;
move lines both ways. Self-contained, ships alone, no server risk.

**2 — Sourcing routes.** Create the table, seed from `inventory.supplier` +
`manual_suppliers`, add SanMar to `apiFromName`, extend `resolve-suppliers` to return
`kind`. After this the cart groups correctly and a manual line carries its buy URL.

**3 — Start → cart.** Order-level and line-level Start append each short line's shortfall
to its supplier's draft with `state: 'cart'`. No wallet touch, no supplier contact.
Keep `replenish.js`'s idempotency (`sources[]` already dedupes by order id).

**4 — Buy.** `POST /api/purchase/:num/buy`, **admin only**:
check balance server-side → mark lines `ordered` → store payload in `meta` → book the
reversible cost. Never contacts the supplier while the gates are off.

---

## Known conflicts to resolve while building

- ~~`autoReplenish` is a top-up model and Start is becoming buy-to-order.~~ **Resolved
  2026-08-14** — `autoReplenish` now computes the shortfall directly, so there is one model
  and nothing to double-count. `reorder_at` is no longer read for the quantity.
- **`autoReplenish` runs once per LINE.** `startOrder` writes an item status per line, and
  the route calls `autoReplenish` on each. It merges by SKU and dedupes on order id, so it
  is probably safe — **this has not been verified** and should be before more is built on it.
- **`reserved` on `inventory` is not maintained.** `replenish.js` computes committed demand
  with a query instead. Anything new should use that query, not the column.

---

## Explicitly out of scope

- Flipping `SS_ORDER_LIVE` / `OTTOCAP_ORDER_LIVE` / `SANMAR_ORDER_LIVE`. Validating those
  payloads against a live account is its own piece of work.
- Alibaba placing orders through the buyer API — blocked on app approval, signature unverified.
- Auto-buying under any condition.
