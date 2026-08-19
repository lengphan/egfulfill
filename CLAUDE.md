# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

---

## 1. What this is

**EGFULFILL** — a print-on-demand fulfilment platform. Sellers connect a marketplace
(Etsy / Shopify / TikTok Shop), orders sync into one queue, a factory prints and ships
them, and tracking is pushed back.

Three parts, not two:

| Part | Path | Status |
|---|---|---|
| **React app** | [web/](web/) — Next.js 16 · React 19 · Tailwind 4 · Base UI | **The product.** All new front-end work goes here. |
| **API** | [server/](server/) — Fastify · Postgres · ES modules · Node 20 | **Stable.** The seam everything builds against. |
| **Legacy static HTML** | 44 `*.html` at the repo root + `eg-*.js` | **Frozen.** Still deployed and reachable. Read for reference; never extend, never delete. |

The static site is not dead code. Treat it as production until its React equivalent
exists. See [docs/MIGRATION-PLAN.md](docs/MIGRATION-PLAN.md).

**Retiring them was considered and declined (2026-08-05).** Leave them where they are and
work around them — don't propose deleting, redirecting or porting them again unless asked.
What the audit established, so it doesn't have to be redone:

- **`oauth-callback.html` is the only functionally load-bearing file.** `etsy.js:30` and
  `shopify.js:20` default `REDIRECT_URI` to `https://egful.store/oauth-callback.html`, and
  that URL is registered with Etsy, Shopify and TikTok. Every other `*.html` mention in
  `server/` and `web/` is a *comment* recording provenance ("ported from orders.html") —
  those are documentation, and they are worth keeping accurate.
- **`about` · `security` · `ip-policy` have no React equivalent.** An IP-policy URL is the
  kind of thing a marketplace app listing registers, so treat it as externally load-bearing
  until someone checks those dashboards.
- **Caddy has no `log` directive**, so there is no access log and "is anyone using these"
  is currently unmeasurable. Don't assert that they're unused.

**The one live coupling:** the legacy pages read `eg_token`/`eg_user` from `localStorage`
only. So a React session created WITHOUT "remember me" (sessionStorage — see `lib/auth.ts`)
does not reach them, and a login performed on the old site *is* picked up by the React app.
That is the whole surface between the two front-ends; nothing else crosses.

---

## 2. Rules that exist because something broke

Not style preferences. Each one cost real damage.

### 2.1 Boot-test the server before every push

One malformed route option makes Fastify throw **at startup**, so the process never
listens and **every** `/api/*` returns 502 — not just the broken route. This shipped;
the whole API was down until the user found it.

```bash
cd server && DATABASE_URL=postgres://x:x@127.0.0.1:1/x JWT_SECRET=test PORT=4123 node src/index.js &
sleep 8; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4123/health   # want 200
```

A bogus `DATABASE_URL` is fine — route registration happens before any query, which is
exactly the class of bug this catches.

- **Kill the port first** (`lsof -ti:PORT | xargs kill -9`). A stale process makes a broken build look healthy. This already invalidated one audit.
- **`/health` on the live domain proves nothing** — Caddy serves `index.html` for anything that isn't `/api/*`, so it returns 200 while the API is dead. Probe a real route: `curl https://egful.store/api/auth/google/client-id`.

### 2.2 Look for existing work before building "new" work

Grep before adding a component, pipeline, or helper. A dithered-hero component, its
source images, and a baked PNG all already existed and were rebuilt from scratch
anyway — and the pre-existing PNG was **overwritten and lost** (untracked, so
unrecoverable). Check `web/components/`, `web/lib/`, `web/public/`, and the static root.

**Never overwrite or delete a file you didn't create in this session without reading it
first.** If what's there contradicts the request, say so instead of proceeding.

### 2.3 Never `git add -A`

Other sessions commit here concurrently. `git add -A` sweeps their in-flight work into
your commit. Stage explicit paths. Check `git log --oneline -5` before committing; if
commits you didn't author appear, say so.

### 2.4 Commit and push, or the deploy ships stale code

The VPS deploys by `git pull`. Unpushed work does not exist. Push after each coherent
change, not at end of session.

### 2.5 Caddy's webroot is the whole repo

[Caddyfile](Caddyfile)'s `@hidden` is an **exclusion list**, so anything new at the repo
root is **public by default**. `/web/*` was missing once and `web/lib/api.ts` returned
200. Adding a top-level directory means adding it to `@hidden`. A private GitHub repo is
not a private deploy.

### 2.6 Never risk a connected account

Nothing may suspend a seller's shop or destroy synced data. Sync must not overwrite what
it didn't author. This outranks any feature.

### 2.7 Port before deleting

Never delete a static `.html` page until its React equivalent works in `web/`.

### 2.8 An effect must never fetch on a condition its own fetch can satisfy

This one took down a 16GB MacBook. Chrome, AnyDesk and ZaloCall all died, every app
froze on "run out of application memory", and it needed two hard shutdowns. **A runaway
loader is the only front-end bug that reaches past the browser and starves the whole
machine** — so it is not a UI defect, it is an outage on someone's desk.

`all-suppliers.tsx` auto-fetched the next chunk whenever `page >= pageCount`. But
`usePaged` **CLAMPS** `page` to `pageCount`, so that is true at *page 1 of 1* — it means
"there is one page", not "you reached the end". Under any filter the arriving rows stayed
outside `visible`, `pageCount` stayed 1, `loading` flipped false, and the effect re-ran on
the state its own fetch had written. 90 rows and a batch of image lookups per turn, aimed
at every style S&S, Otto and SanMar have, with nothing released.

- **Incremental loading is an EVENT** — a click on a page one past what is loaded. A click cannot recur on its own. Never an effect watching pagination or list length.
- If an effect must fetch, **its condition has to be one the fetch's own result cannot re-satisfy.** No guard bolted onto the other shape is trustworthy; the shape is the bug.
- **Run anything that loads in a loop before pushing it.** Open the page, apply a filter, and watch the network panel go quiet. This shipped with a comment claiming it "stops at the true end rather than asking forever" — the comment was confident and the code was not, because it was never run.
- Suspect anything unbounded: `while`/recursive fetchers, `IntersectionObserver` sentinels, retry-on-failure without a ceiling, and appending to a list that is never trimmed.

### 2.9 Never reveal who supplies us — including through a URL

Who makes our blanks is commercial information. Publishing it lets anyone price against our
supplier, and a buyer who can read "SanMar" off our product page can buy the same garment
without us. It is withheld from every unauthenticated surface, and **the rule covers URLs,
redirects and error messages, not just fields.**

This is easy to breach by accident, because the leak is rarely a field called `supplier`:

- **`/api/ss/img?u=https://cdn.ssactivewear.com/…`** — supplier images are stored as this
  proxy path. Whitelisting it on the public catalogue was the obvious fix for the missing
  photos and would have printed the supplier's domain in every card's `src`. The public shape
  emits `/api/public/products/<slug>/img` instead and resolves the real address server-side.
- **A 302 leaks in `Location`.** Redirecting to the origin defeats the point; proxied supplier
  images are re-dispatched internally. A plain `https` value is still redirected, which is a
  known remaining hole — see the note at that route.
- **A fallback can name them.** The SanMar import does `brand || 'SanMar'`, so publishing
  `brand` blind prints our supplier exactly when the real brand is missing. Publish it only
  when it is not the fallback.
- **Spec sheets and size charts** are supplier-branded PDFs on supplier domains. Proxy them
  or don't ship them.

`blank`/`sku` are withheld for the same reason — they map to supplier stock. The public
catalogue is an ALLOW-LIST for this: a redaction list would start publishing whatever gets
added upstream.

---

## 3. Deploy topology

```
app.egful.store   → Vercel          the Next.js app in web/
egful.store       → VPS · Caddy     ├── /api/*  → Fastify:3000
                                    └── else    → static HTML from the repo root
api.egful.store   → VPS · Caddy     → Fastify:3000 only
```

**The app is `app.egful.store`. Always look there, and never send anyone to `egful.store`
to check front-end work** — the apex serves the 44 legacy `*.html` files, a different and
older UI, so a React change will appear to have "not deployed" no matter how many times
it ships. This has cost real debugging time more than once.

The apex cannot simply be pointed at Vercel, and the bare `egful.store` references in the
code are not oversights. Each is load-bearing:

| Reference | What it is | If it moved to app.egful.store |
|---|---|---|
| `next.config.ts` `FALLBACK` | the API origin `/api/*` proxies to | the app would proxy to **itself** |
| `etsy.js` / `shopify.js` `REDIRECT_URI` | OAuth callbacks **registered with the provider** | connect breaks; sellers can't link a shop |
| `shopify.js` / `etsy.js` / `vietqr.js` callbacks | URLs registered in **their** systems | webhooks stop arriving, silently |
| `support@` · `no-reply@` · `fulfillment@` | mail addresses | unrelated to web hosts |

`oauth-callback.html` is one of the legacy static files, so Vercel does not serve it at
all — moving OAuth needs a React equivalent **and** re-registration with Etsy, Shopify and
TikTok, in that order. Until then the single origin is what keeps the popup, the app and
the `redirect_uri` on one host, which is exactly what the Caddyfile's www→non-www redirect
exists to protect.

`api.egful.store` exists so the browser can POST 60MB base64 print files **directly**,
bypassing Vercel's ~4.5MB proxy body limit. The apex `A` record → the VPS is load-bearing.

### The VPS is `82.25.92.217` (moved 2026-07-31)

The DigitalOcean droplet `68.183.113.72` was **destroyed 2026-08-03** — it could not be
downsized (DO cannot shrink a disk) and cost $48/mo. Any reference to that IP anywhere is
stale. Repo lives at `/root/egfulfill`; `ssh root@82.25.92.217` with the key already on
the MacBook.

```bash
# VPS — full stack; server/db/schema.sql loads on FIRST init only
cd /root/egfulfill && docker compose up -d --build

# Deploy a backend change
git pull && docker compose up -d --build

# Promote a staff account (public signup only ever creates sellers)
docker compose exec db psql -U egfulfill -d egfulfill \
  -c "update users set role='operator' where email='op@you.com';"
```

**`curl localhost:3000/health` from the host does NOT work here** and never did on this
box — the `api` container *exposes* 3000 but doesn't *publish* it, so only Caddy can reach
it. That's the safer configuration; don't "fix" it by publishing the port. Health-check on
the docker network instead, or hit a real route from outside:

```bash
docker compose exec -T caddy wget -qO- http://api:3000/health     # -> {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" https://egful.store/api/auth/google/client-id
```

**Never `git push` over SSH from the MacBook** — `~/.ssh/id_ed25519` was never registered
with GitHub and fails `Permission denied (publickey)`. Auth is the `gh` CLI over HTTPS
(`gh auth login` → web browser). A GitHub *password* never works for git. This silently
stalled the repo for three days: five commits sat unpushed while the VPS and Vercel kept
serving older code. `git fetch` also fails when auth is broken, so a stale `origin/main`
makes an unpushed branch look synced — check `git log --oneline origin/main..HEAD`.

Roles: `seller` · `operator` · `warehouse` · `designer` · `admin`. `isStaff` = any
non-seller. Root `.env` holds `DB_PASSWORD`, `JWT_SECRET`, `CORS_ORIGIN`, integration
keys.

**Read integration keys at call time, not module load.** A module-level
`const KEY = process.env.X` snapshots at boot, so keys saved in the UI never apply.

### Dev
```bash
cd web && npm run dev        # :3000
npx tsc --noEmit             # must be clean
npx eslint <changed files>   # must be clean

cd server && npm run dev     # node --watch, needs DATABASE_URL
```
No backend test suite. USPS smoke test: `node --env-file=.env check-usps.mjs`.

---

## 4. Design direction

**This is the house style. Match it; don't invent alongside it.**

### Marketing + auth (`web/app/(marketing)/`, `/login`, `/signup`)

**Exaggerated Minimalism.** Ink and paper carry the page, type does the work decoration
usually does, and there is ONE accent. Kit: [web/components/marketing/bold-kit.tsx](web/components/marketing/bold-kit.tsx)
— import from it, never re-declare a colour or a primitive in a page.

| Token | Value | Use |
|---|---|---|
| `ACCENT` | `#A5B7FF` | the hero plate, the header bar, CTA bands, chart bars |
| `ACCENT_INK` | `#0B0B0C` | the typed accent phrase — ink, not a second hue |
| `INK` | `#0B0B0C` | all display and body type |
| `SURFACE` | `#FAF8F3` | the page below the plate |

- **The banner is the colour; the page is paper.** A cool plate over a warm page is the whole
  look. The tension is deliberate — it failed once only because the warm tone was also
  carrying a coloured hero.
- **ONE ink colour in a headline.** A dark tint of the plate used as foreground reads muddy —
  the eye sees one hue at two strengths rather than a decision. Colour lives in the plate.
- **CONTRAST IS MEASURED, NOT EYEBALLED.** Cream on `#A5B7FF` is 1.83:1 — a ghost, never type
  a reader needs (`PLATE_GHOST` documents that exception). Ink on it is 10.13:1. If cream must
  carry words the plate has to come down to ~`#4259D6` (5.45:1). Light plate and readable cream
  cannot both be true; every time the plate moved this session the lettering had to be re-measured.
- **The header has ONE appearance** at every scroll position (`site-header.tsx`, `PLATE_ROUTES`).
  A header that swaps background, links and buttons at 24px of scroll reads as a glitch.
- **Motion is spatial and always opt-out.** Words rise from a mask; the accent phrase types
  itself (phrases split on `|` from the stored copy field); panels parallax through a spring;
  figures count up once. All skipped under `prefers-reduced-motion` — so "the animation is
  broken" usually means that setting is on.
  One element must never own the same property from both an entrance animation and a scroll
  MotionValue: they fight, and it simply never appears.
- Pages: home, `/pricing`, `/features`, `/how-it-works`, `/catalog` are converted.
  **`/catalog` reads the live published catalogue** via `GET /api/public/products` — the only
  unauthenticated route in the API, and an ALLOW-LIST of four fields rather than a redaction,
  so nothing added to `catalog_products` upstream can leak onto the public web.

**Dither is retired.** `dither-image.tsx` is referenced by nothing; don't build on it.

### App + boards (`web/app/(app)/`, `web/app/(boards)/`)
shadcn tokens in [web/app/globals.css](web/app/globals.css). The palette is periwinkle now,
not violet, and it is split by JOB:

- `--primary` — the deep step (`#4046C2` light / `#8A9CFC` dark). It inks ~247 pieces of TEXT
  as well as filling buttons, so it can never be a light value.
- `--brand` — `#A5B7FF`, the marketing plate. Large FILLS only (filled buttons via
  `bg-brand`), never text.
- Canvas is **white**; cards are white and separated by the border. The sidebar carries the
  colour — one bounded block that is never underneath the data. A tinted canvas behind a
  700-row queue is a sheet you read *through* all day.
- **Sidebars must use the `--sidebar-*` tokens**, not the global ones. They were painted
  `bg-card` with `text-primary`/`bg-accent` items, which is why theming the panel changed
  nothing and its lettering was unreadable on colour.
- **Status colours are reserved and untouched**: emerald shipped, amber warning/hold, red
  alert, orange backorder, violet working, indigo pending, sky packed, slate draft. They carry
  meaning on the floor; a brand hue must not crowd them.
- Dark mode is **selected**, not flipped — its own steps against the dark surface.

**Chrome is reserved, not decorative (2026-08-19).** The app was counted and it carried 118
hand-rolled pills, 490 outlined boxes and 390 filled buttons. When every label is a capsule,
the capsule stops meaning anything — including on the status chips, which are the one place
it has to.

- **Tabs and filter rows are a rule under the live word.** `tabsListVariants` defaults to
  `line`; the underline is the ONLY active treatment, so the two link-based bars
  (`design-lab-tabs.tsx`, `api-playground.tsx`) match the real ones. They are a `<nav>`, not a
  `Tabs` root, so a `group-data-*`-scoped rule never reaches them — position the indicator
  horizontally by default and override for vertical, or they silently drift.
- **`Button` is `rounded-lg`, not `rounded-full`.** Shape says "control", fill says "primary".
  Fully-round is reserved for things that are genuinely round: count badges and avatars.
- **A pill must carry meaning** — order stage, HTTP method, RUSH/LATE. Never a role, a count,
  a tag or a toggle.
- **Mono is for CODE only** — a payload, an endpoint, a key. It had spread to SKUs, tracking
  numbers and counts ("17 SKUs"); those are `tabular-nums` Inter now, which is what actually
  makes a column line up. 23 uses remain, all on developer surfaces.
- The 490 outlined cards are **not yet done** — the canvas/border rule above still describes
  the web app as it stands.

### Mobile (`mobile/` — Expo · React Native)

Its own theme (`mobile/lib/theme.ts`), because RN has neither CSS variables nor oklch. Same
palette, converted once. **It does NOT follow the white-card rule above** — that was reversed
here on 2026-08-19 and the two front-ends genuinely differ.

- **There is no global font default in React Native.** A bare `fontWeight` renders the OS
  face, which is why the app shipped for months in system sans at weight 800 with no
  `useFonts` call and an empty `assets/fonts` — the look people call "AI-generated". Every
  piece of type comes through `F` in the theme; a `fontWeight` without a `fontFamily` is a bug.
- **Playfair Display for display, Inter for everything else** — the same pair the web loads.
  Playfair earns its place at 30pt+ and is mud at 13, so it takes screen titles and nothing
  else. Body is `F.body` (400). The app previously had 25 declarations at weight 900 and
  exactly one at 400, which is why no line ever looked more important than another.
- **Paper all the way down.** Warm paper, sections divided by a hairline rule via `SECTION` —
  never a white card. White-on-warm is two near-identical surfaces held apart by a border,
  and it reads as stuck-on. Cards also nest: the queue had four different left margins in one
  screen (title, card inset, card padding, thumbnail) which is what "nothing is aligned" is.
- **The dark hero block is the exception** and the only place a filled chip belongs.
- **Seed a pushed screen from what the list already holds** (`lib/order-cache.ts`, wired
  inside `getOrders`/`getOrder` so no screen can forget). `/api/orders` aggregates full
  `order_items`, so the detail screen can draw everything immediately. Sliding into a spinner
  is what reads as "the whole page flashes"; the native stack animation was never the problem.

### Honesty in UI
No placeholder avatars beside invented numbers. No empty state that looks identical to a
broken feature — if a thing can't be read versus doesn't exist, **say which**.

---

## 5. Front-end architecture (`web/`)

```
app/(marketing)/   public site          app/(app)/       seller shell
app/(boards)/      staff-only           components/app/  shared app UI
components/ui/     Base UI primitives   lib/             API client + pure logic
```

- **Base UI, not Radix.** No `asChild`. `Menu.GroupLabel` must sit inside `Menu.Group`.
- **`lib/api.ts` is the only place that talks to the server.** Types live beside their fetchers.
- **Lint rules that bite:** `react-hooks/set-state-in-effect` (defer with `setTimeout(fn, 0)` — the pattern used across app pages) and `react-hooks/static-components` (never define a component inside render).
- **Reset by remounting** (`key={thing.id}`), not by a reset effect that renders stale state for a frame.

### Shared logic that must not be re-derived
`lib/order-format.ts` (`numOf`, `platformOf`, `variantOf`) · `lib/factory-status.ts`
(stage vocabulary — **mirrors `PIPELINE`/`normalizeStage` in `server/src/routes/orders.js`; change both**) ·
`lib/variant-resolve.ts` (`resolveProduct`) · `lib/thread-match.ts`.

Private copies of these have been found in three separate files. Import, don't
re-implement.

### Load-bearing data facts
- **`o.id` ≠ `o.num` for marketplace orders** (`etsy-abc` vs `#4099…`). Manual orders are `FF-*` and `id === num`. Anything keyed by order must handle both.
- **`line_id` is line identity.** Two lines of the same SKU are different jobs; keying on `sku` alone flips every sibling at once.
- **Stock is held against the BLANK sku**, not the marketplace listing SKU — resolve with `resolveProduct(it, catalog)`. Order SKUs also carry a print-method suffix (`-EMB`, `-DTG`, `-DTF`, `-APL`, `-LSR`, `-SUB`, `-SCR`) that inventory rows don't; strip it.
- **Marketplace orders arrive with variants UNSET.** Only the factory's own picks pre-fill.
- **node-pg returns `bigint` as a string.** Cast: `id <> all($1::bigint[])`.
- **Canvas colour work needs a same-origin image.** Remote artwork taints the canvas and `getImageData` throws; route it through `canvasReadableSrc()` → the img proxy.

---

## 6. Backend (`server/`)

[server/src/index.js](server/src/index.js): an `onRequest` hook attaches `req.user` from
the Bearer JWT; route groups gate with `requireAuth` / `requireStaff` / `requireAdmin`.
One pool in [server/src/db.js](server/src/db.js) exports `q(text, params)`. Body limit
60MB. Add a route by copying `orders.js` and wiring it in `index.js`.

**Many tables are created idempotently at route load**, not in `schema.sql` —
`order_designs`/`order_threads` (orders.js), `wallet_ledger` (wallet.js),
`factory_lists` (factory_lists.js), `audit_log` (audit.js), `purchase_orders`
(purchase.js), `ss_favorites`/`otto_favorites`, the `users.username` column (auth.js),
`broadcasts` + the `users.marketing_opt_out` columns (broadcasts.js),
`partner_templates` (partner_templates.js).
**Grep the route, not just schema.sql.** `schema.sql` runs on first DB init only, so an
existing deployment never sees later additions.

### Money
`wallet_ledger` is **append-only**; balance = `SUM(delta)`. Idempotent by
`(account, type, ref)` so retries never double-count. Charge on submit, refund on cancel.
`POST /api/wallet/ledger` is **staff-only** — a seller crediting themselves was a real
hole. Team members resolve to `owner_id` via `effectiveSeller`.

### Permission boundaries (product decisions, not incidental)
- Team members cannot purchase design files, cannot change wallet balance, and cannot see the owner's balance unless the owner unhides it.
- Sellers must **never** learn their design was used by another seller. Cross-seller duplicate detection is factory-only.
- Perceptual (fuzzy) artwork matches **suggest**; a human confirms. Never auto-attach.
- An operator's zone ends at scan. Wallet-affecting reverts are admin/warehouse.

### Integrations
- **Shipping — always via the aggregator (Shippo).** A USPS EPS credit-card error means the request wrongly took the USPS-direct path. `shipping.js` rate-shops; `usps.js` also does USPS-direct (`USPS_MOCK=1` for samples).
- **Suppliers** — `ss.js` (S&S), `ottocap.js`, `sanmar.js`. Order placement is **gated off**: all return a dry run unless `SS_ORDER_LIVE=1` / `OTTOCAP_ORDER_LIVE=1` / `SANMAR_ORDER_LIVE=1`, and the payloads have never been validated against a live account.
- **SanMar catalog is a FILE, not an API call.** SanMar gives you two doors and the guide is explicit about which to use: the bulk SDL over SFTP (`ftp.sanmar.com:2200`, folder `SanMarPDD`) for the catalog, and SOAP only for live inventory/pricing. Never walk the catalog through SOAP.
  - `/root/sanmar/sync.sh` (host cron) fetches `SanMar_SDL_N.zip` (~7MB → 195MB CSV), unzips to `/root/sanmar/sdl`, then calls `POST /api/sanmar/import/local`, which reads it off a read-only bind mount (`SANMAR_DATA_DIR`). **The browser can never carry this file** — 195MB against a 60MB body limit and Vercel's ~4.5MB proxy cap.
  - Stored **one row per style** in `sanmar_styles` (4,081 rows, 8MB) with the per-variant fields folded into `variants` jsonb. The raw 161,304 SDL rows are ~300MB and would double the DB and every nightly backup, to feed a grid that groups by style anyway. `inventoryKey` survives the fold — it's SanMar's ordering handle.
  - **`SIZE_INDEX` is not a size order** — it restarts per price group, so `S` and `3XL` both carry index 2. Use the `sizeRank` ladder in `sanmar.js`.
  - **Image columns are bare filenames**, not URLs (`29M.jpg`). Prefix `https://cdnm.sanmar.com/catalog/images/`. The `COLOR_*` image columns live under a dated path the file can't rebuild — they 302. When checking an image URL, **don't follow redirects**: a missing image 302s to `Image404ErrorHandler.jsp`, which serves a *placeholder JPEG*, so `curl -L` reports 200 for broken URLs.
  - 833–896 of the 4,081 styles are discontinued; browse hides them unless `?discontinued=1`.
- **Payments** — `stripe.js`, `paypal.js`, `vietqr.js`, `topups.js`. **VietQR:** the top-up modal must render the **virtual-account `qrCode`** from `POST /api/vietqr/create-payment`. A locally built EMVCo QR is never synced back, so the poll never matches and money lands untracked. There is exactly one QR.
- **Channels** — `etsy.js` (OAuth PKCE), `shopify.js`, `tiktok.js`, Google Sign-In. Null Etsy buyer addresses are Etsy's app-tier PII gate, **not** our bug.

### Auth
Sign-in accepts an **email or a username**. Usernames exclude `@`, which is what keeps
the namespaces from overlapping — the identifier's shape decides which column is matched,
so one can never be used to probe for the other.

---

## 7. Verification

**Mocked tests have repeatedly produced false confidence here.** A mock that returned
data regardless of the query hid a `SELECT` naming a column that didn't exist; it would
have 500'd in production.

- Prefer a **real** check: run the actual module, on real input, and assert the output. Compiling a lib to plain JS and driving it in a headless browser has caught bugs that reading the code did not.
- Say plainly what was **not** verified. "Boot-tested; not verified against a database" is a useful sentence.
- Screenshot UI work with Puppeteer and **read the image back**. Minimum two rounds: compare to the reference citing observed-vs-expected values, fix every mismatch, re-shoot.

```js
// Auth guard: most app pages redirect to /login without a session.
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('eg_token','devtoken')
  localStorage.setItem('eg_user', JSON.stringify({ name:'Dev', role:'admin' }))
})
```
Screenshots go in `screenshots/` (gitignored, and `@hidden` in Caddy).

---

## 8. Known-incomplete

State these plainly rather than implying otherwise:

- **Supplier ordering** (S&S / Otto) — wired end to end, double-gated off, payloads unvalidated, and the UI sends only `{sku, qty}` (no address, PO number, shipping or payment method).
- **Design library `.pes` bytes** — `eg_design_files` is localStorage-only in the legacy app. Order-attached files *are* persisted via `POST /api/design_files`; the library upload path isn't wired to it.
- **Thread palette** — `DEFAULT_THREAD_PALETTE` ships 16 colours. Matching is now perceptually correct (OKLab, lightness weighted 0.5 because hue is a thread's identity and lightness is a shade choice), but 16 cones can't represent real artwork; a light blue still resolves to Grey. The stock list is the bottleneck, not the matcher.
- **Not yet built** — revert-from-Activity with correct wallet response; announcements; per-team peak-season order limits; subscription discounts; A4 multi-up label sheets.
- **Unconfirmed** — which SMTP or keys actually send forgot-password / signup email.
