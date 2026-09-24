# Public API — keys, guardrails, idempotency, MCP (rewritten 2026-09-24)

Four workstreams, in order. Each step is one session: read this file, do the step, run its
gate, push. **Nothing here is built yet.**

Start a session with: *"Read docs/MCP-AND-IDEMPOTENCY.md and do step K1."*

> **What changed in this rewrite.** The previous version had two parts (idempotency, MCP) and
> assumed the rest of the surface was sound. An audit of the real routes found three things
> ahead of both: every key the UI can mint is **full access**, an order pushed through the API
> **silently loses its artwork and personalisation**, and a team member's key resolves to a
> phantom account. Those are Parts K and G. They are not MCP work — they are why MCP would
> have been documented on top of a surface that cannot place a custom order.

---

## The audit, so it is not redone

| Claim | Where | Verified |
|---|---|---|
| Empty `scopes` array = **full access** | `sandbox.js:137` | deliberate, for legacy keys |
| `createApiKey` sends no scopes | `web/lib/api.ts:5460` | so **every** UI-minted key is full access |
| Marketing says keys carry only granted scopes | `ploy/integrations.tsx:83` | not true of any key today |
| `/api/keys` uses `req.user.sub`, not `effectiveSeller` | `sandbox.js:145,168,177` | team member → phantom seller |
| `priceLiveLines` rebuilds lines as an allow-list | `sandbox.js:314` | personalisation dropped here |
| `createRealOrder` inserts 9 columns | `sandbox.js:365` | no `personalization`, no `design_src` |
| `order_items.personalization` exists | added at `etsy.js:957` | every importer writes it; the API does not |
| `order_designs` is per-SIDE artwork | `orders.js:1309`, `side` added `:1479` | keyed `order_id, sku, line_id, side` |
| `missingArtwork()` gates SHIPPING on it | `orders.js:520` | so artwork is not cosmetic |
| `POST /api/design_files` is `requireAuth` | `design_files.js:768` | no API-key path to artwork at all |

**What is already sound, and must stay sound.** Supplier redaction on `/api/v1/products` is an
allow-list that withholds `catalog_products.id` because it names the supplier (§2.9), and never
spreads the `data` blob because it holds `productCost`. `/api/v1/stock` is gated by
`VISIBLE_TO_PARTNERS`. Every query is `where seller_id = $1`. `oops()` strips pg messages.
Cancel checks `CANCELLABLE_STAGES` **and** `approved_at` and reuses `refundForCancel`. Rate
limits are per key, tighter on order creation. **No step below may widen any of these.**

**Industry shape, checked against the specs (2026-09-24).** Printful v2 takes artwork as
`placements → layers: [{type:"file", url}]`; Printify's `print_areas` take a public URL or an
uploaded image id. Neither carries personalisation text on an order line — both expect the
merchant to render text into the print file. So **artwork-by-URL per placement is the grammar
an integrator already speaks**, and `personalization` is ours alone. Printful v2 also requires
an order to be created as a **draft** and confirmed separately, which is what our own
charge-on-submit already does internally.

---

## Part K — Keys carry scopes

Scopes are **seller-side**: a key is always a narrower view of that seller's own account, so a
scope is blast-radius control on a credential they hand to a partner or an assistant, not a
privilege admin defends. Admin gets one switch, over live keys.

**K1 — Scopes on creation (backend).** `POST /api/keys` already filters `req.body.scopes`
against `API_SCOPES` and 400s when none are recognised — it needs nothing. Leave
`keyAllows`'s empty-array rule alone: it is what keeps pre-scopes keys working, and it
shrinks to zero on its own once the UI stops minting empty ones.

**K2 — Scopes on creation (frontend).** `createApiKey(label, mode)` →
`createApiKey(label, mode, scopes: string[])` in `web/lib/api.ts:5460`. In `ApiKeysPanel`
(`settings-view.tsx:389`), a checkbox group over the six scopes, **all unticked by default is
refused** — the caller must choose. Suggest a preset pair: *Read-only* (`orders.read`,
`products.read`, `billing.read`) and *Full*. Render each key's granted scopes in the list.
Checkboxes are `.eg-control`, never button chrome (§4).

**K3 — Live keys stay open to every seller** (decided 2026-09-24). No grant, nothing to build.
A live key can do nothing its holder cannot already do signed in — every `/api/v1/*` query is
`where seller_id = $1` — so gating it would add a hurdle without removing an authority. The
guard is the one already there: the TEST/LIVE switch and the warning strip that says a live key
creates **real** orders. The tab's own visibility (`canUseKeys`, `settings-view.tsx:3967`) is
hide-only and stays that way — the server is the boundary.

The one live-key refusal is K4's: a team member, because that boundary is about the OWNER's
wallet, not about the seller's own.

**K4 — Team members: TEST KEYS ONLY** (decided 2026-09-24). `/api/keys` uses `req.user.sub`
and not `effectiveSeller`, so a team member's key points at a seller id that owns nothing.
Resolving it to `owner_id` instead would let a team member spend the owner's wallet through
`orders.write`, which the permission boundary forbids — so the id stays theirs, and **live-key
creation is refused**.

A **test** key then works fully with no special-casing, because almost nothing in test mode is
seller-scoped: `/products` reads `catalog_products` globally, `/stock` reads `inventory` behind
`VISIBLE_TO_PARTNERS` with no seller filter, and every test-mode order simulates. The quote
already forces `discount = 0` in test for everyone (`sandbox.js:722`), so the sandbox promise
— build against test, flip one key — still holds for them.

The single exception is `/api/v1/balance`, the only seller-scoped read: it would answer **0**,
which is neither theirs nor the owner's. So **`billing.read` is not offerable on a team
member's key** — the checkbox is disabled with the reason, which is the same boundary that
already hides the owner's balance from them. A 0 that is not true is exactly the broken-looking
empty state §4 forbids.

**K5 — Fix the claim.** `ploy/integrations.tsx:83` is true once K2 ships, not before. Check it
reads correctly then.

**Test K.** `npm run dev`, Settings → API keys: create a key with only `products.read`, then
`curl -H "X-API-Key: …" localhost:3000/api/v1/balance` → **403 `insufficient_scope`** naming
the required scope, and `/api/v1/products` → 200. Confirm an existing key still works
(empty scopes = full access). Sign in as a team member → the panel refuses.

---

## Part G — Guardrails: an order carries what it needs, or is refused

Today `POST /api/v1/orders` returns 200 and queues an order whose artwork and personalisation
were silently discarded. The factory cannot produce it and nothing says so.

**G1 — Placements (backend).** Per line, accept the industry shape:

```json
{ "product_id": "16468", "quantity": 2, "size": "L", "method": "DTG",
  "placements": [ { "side": "front", "url": "https://…/art.png" } ],
  "personalization": "Emma, est. 2019" }
```

- `side` is validated against **`offeredSides`** for that product — the one definition (§4).
  An unticked side is a 400 naming the sides the product does have, like `unavailable_size`.
- Each placement writes one `order_designs` row. **Artwork identity is
  `(order_id, line, kind, side)`** — the unique index `order_designs_line_side_key`
  (`orders.js:1499`) over `coalesce('L:'||line_id, 'S:'||sku)`. So one artwork per line per
  side, enforced in the database, and `placements` maps onto it 1:1.
- A placement may also carry `method`, because `order_designs.method` exists and **null means
  inherit the line's** — a garment embroidered on the front and printed on the back is one
  line with two placements, which one column on `order_items` cannot say.
- This is what `missingArtwork()` reads, so artwork pushed by API gates shipping exactly as
  artwork added in the app does. **Do not write `order_items.design_src` instead** — that is a
  third spelling of something the schema already says twice.

**PER LINE IS PER SURFACE, NOT PER UNIT — and that is the house rule, not a limitation of this
design.** A line is a SKU at a quantity; `side` is the surface. What `placements` cannot
express is two units of the SAME line wanting DIFFERENT artwork or different personalisation —
because `line_id` is line identity and two lines of the same SKU are already different jobs
(§5). Three shirts with three different names are **three lines of quantity 1**, which is what
every importer already produces. Say this in the docs explicitly: an integrator who collapses
by SKU to tidy their payload would otherwise print one name three times.
- `personalization` writes the `order_items` column every importer already writes.
- **Unknown per-line keys are a 400**, not ignored. Silently dropping a field is what this
  part exists to end; a new field must never become a new silent drop.
- Fetch nothing at request time. Store the URL; resolve it on the existing artwork path.

**G1a — WHAT A PLACEMENT ALREADY IS. The API invents nothing; it becomes a second caller
of the write the app already performs.** Traced 2026-09-24:

1. An order has lines. Each `order_items` row carries a `line_id` (`orders.js:1165`).
2. Saving artwork upserts ONE `order_designs` row on
   `(order_id, coalesce('L:'||line_id,'S:'||sku), kind, coalesce(side,'front'))`
   (`orders.js:4233`). A method-only save deliberately leaves the picture alone.
3. **If that side is NEW for the line, it is CHARGED.** `chargeOrderFee` books a per-extra-side
   surcharge noted `"<Side> placement · Item <n>"`, stamps `order_items.unit_cost` and
   `cost_parts`, and **402s with `needsFunds` when the seller cannot afford it — writing
   nothing** (`orders.js:4203-4230`). The `clientId` is `surface-<lineId>-<sideCount>`, so a
   retry of the same save reuses the ref and the next face gets its own.
4. `missingArtwork()` then gates SHIPPING on those rows (`orders.js:520`).

So `placements` is not a new concept — it is steps 2 and 3, reached from a key instead of from
a click. **The word is ours too:** the fee note the app writes is literally
`"Front placement · Item 2"`. Printful happening to use the same word is convenient, not the
reason.

**THEREFORE THE API MUST GO THROUGH THE SAME FEE PATH, NOT AROUND IT.**
`priceLines(items, idx, fees, sidesOf = () => ['front'])` (`pricing.js:1120`) takes a
`sidesOf` callback and **defaults to front only** — and `priceLiveLines` (`sandbox.js:314`)
calls `quoteSpec` without sides. So today an API order is priced front-only whatever it
carries. Add placements without wiring sides into the pricer and every extra face ships free,
while the same order built in the app is charged for it. That is the invention to avoid — not
a new field, a second price for the same work.

Consequences to honour rather than design around:
- `POST /api/v1/orders/quote` must price the placements it is sent, or the quote stops being
  the figure that bills (its own docstring promises it is).
- A live order whose placements overdraw the balance hits the existing **402**. That is the
  real argument for G2: a draft lets artwork and its fees settle before the order is queued.
- `kind` stays at its default; the API does not expose it. One more axis nobody asked for.

**G2 — Draft → confirm.** `confirm: false` creates the order unqueued so artwork can be
attached, `POST /api/v1/orders/:id/confirm` queues it. This matches Printful v2 and describes
what charge-on-submit already does. Default stays **confirm on create**, so nothing an existing
partner sends changes behaviour.

**G3 — File library.** `POST /api/v1/files` takes `{ url }`, returns an id usable in
`placements`. URL-only is where Printful is, so it is not a gap. Base64/presigned-R2 upload is
a later step and only if someone asks — `api.egful.store` exists for it.

**G4 — Docs.** Add `placements` and `personalization` to the create-order entry in
`web/lib/api-endpoints.ts`, sample body included. One sentence saying artwork goes by URL.

**Test G.** Against a **test** key first — it validates identically to live:
```bash
curl -X POST localhost:3000/api/v1/orders -H "X-API-Key: egk_test_…" \
  -H 'content-type: application/json' -d '{"items":[{"product_id":"16468","quantity":1,
  "size":"L","method":"DTG","placements":[{"side":"back","url":"https://x/a.png"}]}],
  "shipping_address":{"name":"A","street1":"1 St","city":"X","state":"MA","zip":"02719","country":"US"}}'
```
Expect a 400 if that product has no back. Send `{"colour":"red"}` on a line → 400 for the
unknown key. Then a live key on a dev DB, and read `order_designs` back:
`select order_id, line_id, side from order_designs where order_id = 'API-…'`. Open the order in
the app: the artwork must appear on the right side and the shipping gate must clear.

---

## Part A — Idempotency

An AI agent retries tool calls. Without this, a retried `create_order` is a second garment.
**A must be live before any MCP tool writes anything.**

**A1 — Hook + table (backend).** `server/src/idempotency.js`. `api_idempotency` created
idempotently at load (§6): `seller, mode, key, route, body_hash, status, response jsonb,
created_at`, `UNIQUE (seller, mode, key)`. Claim the key with `insert … on conflict do nothing`
**before** running the handler — that insert closes the concurrent-request race. A Fastify
`preHandler`/`onSend` pair, active only on `config: { idempotent: true }`. Order of checks:
auth → scope → rate limit → idempotency. No header → behave exactly as today.

Store 2xx and 4xx. **Never 5xx** (the retry must re-run), never 401/403/429. Expire 24h.
Same body → stored response + `Idempotent-Replayed: true`. Different body → `422
idempotency_key_reused`. First still running → `409 idempotency_in_progress`.

`external_id` stays — it is the partner's order number, the key is one HTTP call retried
within minutes. The ledger's `(account,type,ref)` stays — it guards the MONEY, the header
guards the REQUEST.

**A2 — Turn it on** for `POST /api/v1/orders`, `/orders/:id/cancel`, `/orders/:id/confirm`,
`POST /api/webhooks`. While in `sandbox.js`: wrap `createRealOrder` in a transaction — each
line insert currently has `.catch(() => {})`, so a failed line leaves a 200'd order with lines
missing (§2.6).

**A3 — Browser (frontend).** `useIdempotencyKey()` in `web/lib/`: minted when a dialog
**opens**, reused until success, replaced after success or close. A fresh key per call would
not stop a double-click — two clicks are two calls. `lib/api.ts` sends the header. First user:
manual order creation.

**A4 — Docs, and ONLY on the endpoints that accept it.** No rail section: retry-safety is
already answered where it is needed — create order de-dupes on `external_id` and returns the
first order with `idempotent: true`, cancel answers 200 twice, and both entries already say so.
A section beside Authentication would claim a partner must read it to integrate, and they need
not. Note the header on the three entries that accept it (`orders`, `cancel`, `webhooks`),
where the one real gap lives: retrying `POST /api/webhooks` today registers a second endpoint
and the signing secret is shown only once.

**The browser half is ours alone** and appears in no public doc — it protects our own forms
from a double-click.

**Test A.** Same key twice → same order id, second carries `Idempotent-Replayed`. Same key,
changed body → 422. Two concurrent requests with one key → **one** row in `orders`. Kill the
process mid-handler and retry → the call re-runs (no 5xx was stored).

---

## Part M — MCP server

**M1 — Route (backend).** `POST /api/mcp` in `server/src/routes/mcp.js`. Caddy already routes
`/api/*`, so no new host, container or top-level folder (§2.5). `@modelcontextprotocol/sdk`,
Streamable HTTP, stateless. In Fastify: `reply.hijack()` then
`transport.handleRequest(req.raw, reply.raw, req.body)` (`index.js:719` hijacks the same way).
Auth is the seller's API key via the existing `authKey()`; scopes and rate limits unchanged.

**Every tool calls the real route through `app.inject`** (as `catalog.js:746` does), forwarding
the key header — never the database. That is what makes the leak analysis transferable: a tool
gets the same validation, pricing, scopes, rate limit and supplier redaction as a partner's
call, and it **fails closed** (no key forwarded → 401). A second code path is how the two drift.

**M2 — Tools**, one per documented endpoint, derived from `api-endpoints.ts` via a new
optional field `mcp?: { tool, readOnly, hint }`:

| Tool | Route | |
|---|---|---|
| `list_products` · `check_stock` · `get_order` · `get_balance` | their GETs | read-only |
| `quote_order` | `POST /orders/quote` | read-only; description says quote before ordering |
| `create_order` | `POST /orders` | `destructiveHint`; confirm total, address **and any personalisation** with the user first |
| `cancel_order` | `POST /orders/:id/cancel` | `destructiveHint` |

Webhooks stay out — plumbing, not something to ask an assistant for.

**Two rules the gate enforces.** A tool may not name a route `api-endpoints.ts` does not
document (the list is the promise, §6). And **no MCP tool response may carry buyer-authored
free text** — personalisation and buyer notes are attacker-influenced, and tool output is model
input. `get_order` returns no items today; that is the state to preserve deliberately.

**M3 — Frontend.** Nothing new to build: `/docs` gains a **Connect MCP** section placed after
Authentication (the connect command **is** the API key, so it cannot precede it), with the
derived tool table and the connect snippet. A two-card chooser under the hero — *Write code* /
*Connect an assistant*. Recommend a **test** key and a read-only scope set, which K2 finally
makes possible.

**M4 — Unite the two doc surfaces.** They stay separate pages — different palettes, `/docs` is
indexed and `/developers` is `Disallow` in `robots.ts` — but link both ways:
`/docs#<id>` ⟷ `/developers?endpoint=<id>` (the second half already works,
`endpoint-card.tsx:147`). Add a per-endpoint **Reference** link in the playground, and fix the
four `help.ts` entries (`:329 :338 :347 :365`) — "Read the API docs" must go to `/docs`, not to
the playground behind a login.

**M5 (later)** — OAuth, for claude.ai / ChatGPT connectors. API-key headers cover Claude Code,
Cursor and most desktop clients first.

**Test M.** `npx @modelcontextprotocol/inspector` → Streamable HTTP →
`http://127.0.0.1:4123/api/mcp` with an `X-API-Key` header. Run every tool on a **test** key
and confirm `orders` stays empty. Then in Claude Code:
```bash
claude mcp add --transport http egful http://127.0.0.1:4123/api/mcp \
  --header "X-API-Key: egk_test_…"
```
Ask it *"what blanks can you print on"* and *"quote 40 black tees in L"*. A key scoped
`products.read` only must make `get_balance` fail with 403, not with a generic error.

---

## Also found in the audit (fix alongside)

- `GET /api/v1/orders/:id` live returns `total` as a STRING — pass it through `money()`.
- Docs promise `code` on every error; missing on 401, 404s, cancel 409s, stock/balance 500s.
- Ping says "Checks your test key" — it accepts live keys too.
- Legacy `api-playground.html` still calls the removed `/api/test/*`. Frozen — don't delete,
  don't link to it.

---

## How to test, generally

Local Postgres is required by the API gates and they **skip cleanly without one**, which means
a silent skip can look like a pass — check the output says PASS, not SKIP.

```bash
node tools/check-public-api.mjs      # boots real Fastify + throwaway PG, mints a real key,
                                     # executes every path in api-endpoints.ts
bash tools/run-gates.sh              # everything, before a push

cd server && npm run dev             # :3000, needs DATABASE_URL
cd web && npm run dev                # :3000 — app at /developers, docs at /docs
npx tsc --noEmit && npx eslint <changed files> && node tools/check-tdz.mjs
```

**Extend the gate per part**, or it only proves what it already proved:
K — a scoped key is refused the scope it lacks, and an empty-scope key still works.
G — a placement on an unoffered side is refused; an accepted one produces an `order_designs`
row; an unknown per-line key is a 400.
A — replay returns the same id, a changed body 422s, two concurrent requests make one order.
M — every tool runs on a test key with `orders` still empty, and no tool names an undocumented
route.

**Before every push.** Boot-test the server (§2.1) — one malformed route option 502s the whole
API. Pushing a branch does not deploy: production is `main`, the VPS pulls it for `server/` and
Vercel builds it for `web/`.

---

## Order, and why

| | | Blocks |
|---|---|---|
| **K1–K5** | keys carry scopes | every honest sentence about connecting an assistant |
| **G1–G4** | orders carry artwork | MCP's `create_order` being worth having at all |
| **A1–A4** | idempotency | any MCP tool that writes |
| **M1–M5** | MCP + united docs | — |

M4 (the doc cross-links) and the audit fixes above depend on none of it and can go first, any
time, in a single small session.
