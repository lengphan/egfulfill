# EGFULFILL — Etsy address sync (Chrome)

Fills buyer addresses on orders EGFULFILL already has, from the seller's own Etsy Shop
Manager page, while the Etsy API address entitlement is pending.

## What it does, and what it deliberately does not

It **reads a page the seller opened themselves**. There is no `fetch` to Etsy anywhere in
this extension, no pagination, no crawl, no background worker and no timer — so it makes
**zero additional requests to Etsy**. `tools/check-extension-parse.mjs` asserts that, and
fails if `fetch`, `XMLHttpRequest`, `sendBeacon` or a dynamic `import` ever appears in the
reader.

It reads the page, then asks EGFULFILL **"of these receipts I can see, which do you need?"**
and discards the rest. It sends what is needed and nothing else. The question is bounded by
what is already on screen, so it can never become a way to survey orders the seller is not
looking at — and there is no cap or ordering that could make "nothing to do" and "your
orders fell outside the window" look the same.

It **never asks for a password.** The seller signs in to `app.egful.store` normally; Connect
reads the token their own browser already holds, from our own origin, once.

Everything that leaves the browser leaves from the popup, behind a button. `content.js` has
no network access at all — it answers one question and volunteers nothing.

## Install (unpacked, for testing)

1. `chrome://extensions` → turn on **Developer mode** (top right)
2. **Load unpacked** → choose this `extension/` folder
3. Pin it to the toolbar

## Use it

1. Sign in at **app.egful.store** in the same browser
2. Open the extension → **Connect to EGFULFILL**
3. Go to **Etsy → Shop Manager → Orders & Shipping** (`etsy.com/your/orders/sold`)
4. Open the extension → it shows how many addresses on that page EGFULFILL is missing
5. **Sync addresses**

Page through your orders and press Sync again on each page. Nothing is sent automatically.

## Reading the footer

The footer always reports `N on page · M wanted · K usable · via <strategy>`, and it is the
first thing to look at when something seems wrong:

| What you see | What it means |
|---|---|
| `0 on page` on a page full of orders | Etsy changed their markup — `src/parse.js` needs new selectors |
| `20 on page · 0 wanted` | EGFULFILL already has addresses for these orders |
| `20 on page · 5 wanted · 0 usable` | The addresses were found but failed validation (non-US, missing city) |
| `via json` | Read from Etsy's own page data — the most reliable strategy |
| `via text` | Read from rendered text — works, but more fragile |

A bare `0` with no context is exactly the failure this reporting exists to prevent: a broken
selector and an empty page look identical otherwise.

## The server side

Nothing here is a new trust surface. The extension posts to `POST /api/etsy/import-addresses`,
which already existed for the manual CSV upload and already enforces every rule that matters:

- matches on **receipt ID only**, never buyer name (not unique, not stable)
- **never overwrites** an address that already exists, so it cannot clobber a hand-typed fix
- a seller may only fill **their own** orders — scoped on the read *and* the write
- validates state / ZIP / city and rejects anything malformed
- audited as `etsy.import_addresses`

`/api/etsy/addresses/missing` is the only addition. `POST` answers about a specific list of
receipts (max 300, the form the extension uses); `GET` surveys recent ones. Both return
receipt IDs and nothing else — no buyer name, no partial address, no money. A list of what
we are missing should not itself be a way to read what we have. Both are seller-scoped:
a seller is answered about their own orders, staff about all.

## Known limits

- **The selectors came from a live page (2026-09-13) and are tested against it**
  (`node tools/check-extension-parse.mjs`), but Etsy can change their markup without notice.
  The footer stats are what make that break visible: `0 on page` with orders on screen means
  `src/parse.js` needs new selectors, and it reads as a bug report rather than a silent zero.
  Addresses are already in the DOM even though the Ship-to panel renders COLLAPSED — nothing
  needs expanding, and nothing is ever clicked.
- **US addresses only.** The text fallback anchors on a `City, ST ZIP` line, and the server
  rejects a non-two-letter state and a non-5-digit ZIP. An international order will show as
  found-but-unusable rather than being sent wrong.
- **Manual only.** No auto-sync. That is a deliberate starting point, not an oversight.
- `/extension` is in the Caddyfile's `@hidden` list, so this source is not served from
  `egful.store`. Anything new at the repo root is public by default (CLAUDE.md §2.5) — if
  you ever want to offer a packaged `.zip` for download, that has to be a deliberate path.

## Terms

Etsy's Terms of Use prohibit automated access to their web UI. This reads a page a human
navigated to and makes no requests of its own, which is a materially different thing from a
scraper, but it is not risk-free and the risk lands on the **seller's** shop, not on ours.
The sanctioned routes remain: the Etsy API entitlement (Preferred Partner), the manual CSV
upload, and the Shippo backfill. This is a bridge, not a destination.
