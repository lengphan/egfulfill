# egful — Etsy address sync (Chrome)

Fills buyer addresses on orders egful already has, from the seller's own Etsy Shop
Manager page, while the Etsy API address entitlement is pending.

## The rule this extension exists under

**Never scrape. Fill in only what the API will not give us. The shop still has to be
connected.** (Owner, 2026-09-14.)

Orders arrive through Etsy's API, from a shop the seller connected. This extension adds
**one field** that the API refuses to hand over — the buyer's street and postcode, withheld
from apps on the restricted tier. It does not import orders, it cannot create one, and it
must never grow into something that does.

Making it read whole orders was costed and rejected: `line_id` is Etsy's own
`transaction_id` and an invented one has already caused duplicate orders; the customer's
uploaded artwork is a URL inside the transaction's variations, which is the actual job on a
print-on-demand order; `sku` is a listing field rather than page text; and tracking cannot
be pushed back without the connection's token. A scrape would also only be as current as the
last time somebody had the tab open.

## What it does, and what it deliberately does not

It **reads a page the seller opened themselves**. There is no `fetch` to Etsy anywhere in
this extension, no pagination, no crawl, no background worker and no timer — so it makes
**zero additional requests to Etsy**. `tools/check-extension-parse.mjs` asserts that, and
fails if `fetch`, `XMLHttpRequest`, `sendBeacon` or a dynamic `import` ever appears in the
reader.

It reads the page, then asks egful **"of these receipts I can see, which do you need?"**
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
2. Open the extension → **Connect to egful**
3. Go to **Etsy → Shop Manager → Orders & Shipping** (`etsy.com/your/orders/sold`)
4. Open the extension → it shows how many addresses on that page egful is missing
5. **Sync to egful** — press **Show the 5** first if you want to read what is about to go

No need to reload the Etsy tab after updating the extension — the reader is injected when
you open the popup, so it is always the current build. The footer prints that build (`v0.1.7`)
so "did my change load" is a question you can answer by looking.

Page through your orders and press **Sync to egful** again on each page. Nothing is sent
automatically.

**What is about to be sent** is one press away: *Show the 5* lists the name and address of
every row in the request. It is built from what is already in memory for that request, it
is never written anywhere, and it is gone when the popup closes.

## Reading the footer

The footer's resting state is just the build (`v0.1.7`) — the one thing the panel above
cannot say for itself, and the thing that answers "did my change load".

It only speaks up when there is something to act on:

| What you see | What it means |
|---|---|
| `v0.1.7` alone | Nothing to report. What is on the page, the panel above already said in words |
| `2 of 20 couldn't be read` | Found on the page but failed validation — non-US, or missing a street or city. Nothing is sent wrong |

**Hover it for the full reading**: `20 found on this page · 5 to send · read via json`. That
is where the counts live now. They used to be printed on the face of the panel — `1 seen ·
0 to send · address-block · v0.1.4` under a panel that had already said "Nothing to send
from this page", which restated in jargon what the two lines above said in words. And
`address-block` is the name of a parsing STRATEGY: it means something to whoever edits
`src/parse.js` and nothing to the person pressing Sync.

**Diagnosing a broken selector**: a page full of orders reading as empty is the failure to
watch for, and it looks identical to a genuinely empty page. The panel says "No orders found
here"; the hover says `0 found on this page`. If you see that on a page of sold orders,
`src/parse.js` needs new selectors.

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
  The footer hover is what makes that break visible: `0 found` with orders on screen means
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
  a display name, never an address. What was synced is read in egful, which is the system
  of record and the thing with an audit log.
- `/extension` is in the Caddyfile's `@hidden` list, so this source is not served from
  `egful.store`. Anything new at the repo root is public by default (CLAUDE.md §2.5) — if
  you ever want to offer a packaged `.zip` for download, that has to be a deliberate path.

## Putting it on the Chrome Web Store

Unpacked loading is fine for us and impossible for a seller: Chrome blocks a `.crx` installed
from anywhere but the store, so the store is the only way this reaches someone else's browser.

```bash
tools/pack-extension.sh          # -> dist/egful-extension-<version>.zip
```

`manifest.json` must sit at the ROOT of the zip. Finder's "Compress" puts it one level down
and the upload is refused with "manifest file is missing or unreadable", which reads like a
broken file rather than a wrong directory. The script also checks the manifest parses and that
every icon it promises is actually in the package. `dist/` is gitignored and in the Caddyfile's
`@hidden` — a zip at the repo root would otherwise be downloadable from egful.store (§2.5).

**Once, before the first upload:** register at
[chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole) and pay
the one-time $5 developer fee. A Google account you will still control in two years — the
listing cannot be moved between accounts afterwards.

**Distribution: UNLISTED.** Anyone with the link can install it; nobody can find it by
searching. Public puts "reads your Etsy orders page" in a searchable index next to our name,
which is a conversation with Etsy we have no reason to start. Private (trusted testers) is
tighter still but needs every seller's Google account listed by hand.

**The listing asks for, and this is most of the work:**

| Field | What to put |
|---|---|
| Name | egful — Etsy address sync |
| Summary (132 chars) | Fills buyer addresses onto the egful orders you already have, from your own Etsy Shop Manager page. |
| Category | Workflow & Planning |
| Icon | `extension/icons/icon-128.png` |
| Screenshot | `dist/store-screenshot-1280x800.png` (1280×800; at least one is required) |
| Privacy policy | `https://egful.store/privacy.html` — REQUIRED, because it handles personal data |

**The privacy tab is where a listing gets rejected.** Every permission needs a justification in
the reviewer's terms, and vague ones bounce:

- **storage** — keeps the seller's own egful session token so they connect once instead of on
  every page.
- **tabs** — reads the active tab's URL to tell whether it is the seller's Shop Manager orders
  page, and finds their already-open egful tab when connecting.
- **scripting** — injects the reader into that page, on demand, when the seller opens the popup
  and presses a button. It is injected rather than declared so nothing of ours is present on
  any page until asked.
- **host: www.etsy.com/your/orders/\*** — the seller's own sold-orders page, the only page read.
- **host: app.egful.store / api.egful.store** — our own app: reads the session the seller
  already holds, and posts the addresses.

Data disclosure: tick **personally identifiable information** (name, address) and
**authentication information**, then all three certifications — the data is not sold, is not
used for anything but the single purpose, and is not used for creditworthiness. Single purpose,
stated plainly: *fills buyer addresses onto the seller's existing egful orders, from the
seller's own Etsy Shop Manager page.*

No remote code — `parse.js` ships in the package and nothing is fetched and executed. Say so if
asked; it is the question that slows a review down most.

**Review** takes anything from a few hours to a few days, and a listing touching a third-party
site's pages gets read by a human. **The store refuses a version it has seen before**, so bump
`extension/manifest.json` on every upload — that number is also what the popup footer prints,
which is how you tell what a seller is actually running.

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
