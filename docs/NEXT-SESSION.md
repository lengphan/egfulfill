# Where things stand — handoff

Written 2026-07-22 at the end of a long session. This is what is unfinished, what was
decided, and the things that would otherwise have to be rediscovered.

---

## 1. Others tab — backend done, UI not

Shops with no API: saved link, cost, markup, sell price. `manual_suppliers` table.

**Live endpoints** (`server/src/routes/manual_suppliers.js`):
- `GET /api/manual-suppliers` · `POST /api/manual-suppliers` (insert or update by `id`)
- `POST /api/manual-suppliers/price` `{url}` → tries to read the listing's price
- `DELETE /api/manual-suppliers/:id` (warehouse/admin)

**What's left:** an "Others" tab on the Suppliers page — a table of saved sources with
title, link, cost, markup %, sell price, and a "fetch price" button per row. Optionally
link a row to a catalogue product via `product_id`.

**Do not loosen these:**
- The URL guard blocks private ranges and refuses redirects. It is the only thing stopping
  this endpoint being an SSRF tool aimed at the Docker network and the cloud metadata
  endpoint. Three IPv6 holes were found by testing it — `new URL()` returns hostnames with
  brackets, so `host === '::1'` never matched.
- Price comes from **structured data only** (schema.org / OpenGraph). Pattern-matching `$`
  out of HTML finds the shipping threshold or a strikethrough price, and a wrong cost
  silently sets a wrong sell price.

## 2. SpyDeck — store listings (specced, not started)

**Ask:** let a SpyDeck subscriber look at any store's listings, see the store name on each
card, open that store's products, and save them.

**The gate already exists:** `users.spydeck_addon` (boolean) plus `plan <> 'starter'` —
see `server/src/routes/billing.js`. Bill it the same way; do not invent a second gate.

**Open questions, answer before building:**
- Which marketplaces? Etsy has an API; arbitrary Shopify stores mostly expose
  `/products.json`; anything else is scraping and will break.
- "Save for ourselves" — a manual-supplier row, a catalogue product, or a watchlist? These
  are three different tables.
- Rate limiting and caching. A subscriber browsing competitor stores will generate a lot of
  outbound requests from one IP.

**Reuse the SSRF guard from `manual_suppliers.js`.** Same class of feature, same risk.

## 3. Bulk email — unblocked, unbuilt

`mail.egful.store` is authenticated (DKIM, SPF, DMARC all verified — see
[EMAIL-SETUP.md](EMAIL-SETUP.md)). Transactional mail is confirmed delivering from
`egful.store`.

Build campaigns against the **subdomain**, with `MAIL_FROM_BULK` as a separate env var, so
a bad campaign cannot damage the reputation that password resets depend on.

**Required, not optional:** one-click unsubscribe (`List-Unsubscribe` header + public link),
honoured at send time rather than at list-build time. Legally required and enforced by
Gmail for bulk senders.

**Undecided:** all sellers or a filtered set; whether a send needs admin approval. Bulk mail
is the one action here that cannot be undone.

---

## Decisions made this session

- **`catalog_price` ≠ `base_price`.** `base_price` bills orders (`pricing.js` → `orders.js`).
  The catalogue is a shop window shown to buyers who are not our sellers. Never write
  `base_price` from a catalogue screen.
- **Picks are references, not copies.** `catalog_picks` stores (source, ref, price); names,
  images, colours and sizes are read live from `ss_products`. A re-sync updates the
  catalogue for free.
- **A tick means published**, on both catalogue tabs. It reflects server state, not a local
  selection — the older behaviour meant a published product came back unticked.
- **Design charges:** `design_fee_standard` when we digitise, `design_fee_complex` when
  intricate (quoted, and only charged on acceptance), `check_fee` when the seller supplies
  their own machine file. `designer_payout` is money OUT to a designer.
- **Factory-owned orders bill nobody.** Their `seller_id` is a staff account; charging one
  moves money from the factory to the factory and books revenue nobody earned.
- **Designs are keyed by line**, not SKU — `(order_id, coalesce('L:'||line_id, 'S:'||sku), kind)`.
  The prefixes are load-bearing: Etsy uses the same id shape for line ids and SKUs, and a
  plain coalesce collided.

## Still not verified against reality

- **No design charge, quote or refund has moved real money.** The whole pricing path is
  boot-tested only.
- **The USPS SCAN form** (`/api/manifests`) has never run against live Shippo.
- **Supplier ordering** (S&S / Otto) remains double-gated off and unvalidated.

## Housekeeping the user still owes

- ~~Set the five fee values~~ — **done 2026-07-22.** designer_payout 2.50 · design standard
  2 · design complex 15 · check 1 · emb_price 5 · emb_price_complex 30.
  Note: `emb_price` applies to files created AFTER it was set. Existing `design_file_data`
  rows keep the price they were stored with, which for everything produced before today is
  `0`. If those should be chargeable too, they need a one-off update.
- **Rotate exposed secrets** — account password, `SHOPIFY_API_SECRET`, `SMTP_PASS`,
  `GOOGLE_SHEETS_API_KEY`, and an admin JWT. All appeared in screenshots or shell history.
  Shopify first: it can act on a connected shop.
- **`etsy-4111943995`** lost one line's artwork to the old SKU-keying bug and needs
  re-uploading. It is the only confirmed casualty.
- **Run `Sync all styles`** if the catalogue should cover more than 21 styles.

## Gotchas worth not rediscovering

- `docker compose restart` does **not** reload `.env`. Use `up -d`.
- Vercel serves a **shared edge cache**; incognito does not bypass it. Check
  `x-vercel-cache` / `age` headers, not a private window.
- A `STAFF_TOOLS` nav entry needs its page in `app/(app)/`. In `(boards)` it renders in the
  sidebar and bounces on click, silently.
- App-shell pages render a spinner server-side, so grepping page text out of production
  HTML proves nothing about which build is live. Compare layout chunks.
- `.catch(() => {})` on a migration step means later steps are skipped in silence. That took
  artwork uploads down for a while today.
