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

Everything that leaves the browser leaves from the popup, behind a button. The reader is
INJECTED ON DEMAND rather than declared as a content script, so nothing of ours is present
on an Etsy page until the moment you open the popup and ask — and the code that runs is
always the code on disk, never a copy Chrome injected before the last reload.

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

No need to reload the Etsy tab after updating the extension — the reader is injected when
you open the popup, so it is always the current build. The footer prints that build (`v0.1.3`)
so "did my change load" is a question you can answer by looking.

Page through your orders and press Sync again on each page. Nothing is sent automatically.

## Reading the footer

A healthy page reads `20 seen · 5 to send · json · v0.1.3`, and it is the first thing to look
at when something seems wrong. Every part but `seen` and the build is conditional — a fact
appears only when it has something to say:

| What you see | What it means |
|---|---|
| `0 seen` on a page full of orders | Etsy changed their markup — `src/parse.js` needs new selectors |
| `20 seen · 0 to send` | EGFULFILL already has addresses for these orders |
| `20 seen · 0 to send · 20 unreadable` | Found, but failed validation (non-US, missing city) — nothing is sent wrong |
| `json` | Read from Etsy's own page data — the most reliable strategy |
| `text` | Read from rendered text — works, but more fragile |

`unreadable` is the gap between what was found and what validated, so it is absent on a page
with no gap. A bare `0` with no context is exactly the failure this reporting exists to
prevent: a broken selector and an empty page look identical otherwise.

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
  The footer stats are what make that break visible: `0 seen` with orders on screen means
  `src/parse.js` needs new selectors, and it reads as a bug report rather than a silent zero.
  Addresses are already in the DOM even though the Ship-to panel renders COLLAPSED — nothing
  needs expanding, and nothing is ever clicked.
- **US addresses only.** The text fallback anchors on a `City, ST ZIP` line, and the server
  rejects a non-two-letter state and a non-5-digit ZIP. An international order will show as
  found-but-unusable rather than being sent wrong.
- **Manual only.** No auto-sync, no alarm, no background worker — see *Terms* below. That is
  a deliberate starting point, not an oversight.
- **Nothing about a buyer is kept here.** The popup holds the rows it parsed in memory for as
  long as it is open and forgets them when it closes; `chrome.storage.local` holds a token and
  a display name, never an address. What was synced is read in EGFULFILL, which is the system
  of record and the thing with an audit log.
- `/extension` is in the Caddyfile's `@hidden` list, so this source is not served from
  `egful.store`. Anything new at the repo root is public by default (CLAUDE.md §2.5) — if
  you ever want to offer a packaged `.zip` for download, that has to be a deliberate path.

## Terms

Etsy's Terms of Use prohibit automated access to their web UI. This reads a page a human
navigated to and makes no requests of its own, which is a materially different thing from a
scraper, but it is not risk-free and the risk lands on the **seller's** shop, not on ours.
The sanctioned routes remain: the Etsy API entitlement (Preferred Partner), the manual CSV
upload, and the Shippo backfill. This is a bridge, not a destination.

**A timer is the line, and a daily one crosses it as surely as an hourly one** (asked
2026-09-14). The whole defence above is that a person navigated to a page and pressed a
button; a schedule replaces the person. What Etsy sees then is a session loading Shop Manager
at 03:00 with nobody at the keyboard, on a cadence — which is what automated access *looks
like* from their side, and frequency only changes how quickly it is noticed. It also takes
the seller out of it: they cannot see it run, cannot stop it, and it is their shop that is
suspended, which §2.6 puts above any feature of ours.

If unattended filling is the goal, it has to come from a door Etsy opened: the API
entitlement. The scheduled job then belongs on OUR server against OUR grant, not in a
browser wearing a seller's cookie.
