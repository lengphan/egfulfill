# MCP server + idempotency keys — build guide (2026-09-24)

Audit and agreed design from a cloud session, written so any session (VS Code included) can
pick it up. **Nothing here is built yet.** Build Part A before Part B: an AI agent retries tool
calls, and without idempotency an MCP `create_order` retry is a second garment.

Start a session with: *"Read docs/MCP-AND-IDEMPOTENCY.md and do step A1."* One step per
session keeps each one small and cheap.

---

## Part A — Idempotency keys

### What it is

The API key says WHO is calling. The `Idempotency-Key` header says WHICH ATTEMPT this is:

```
POST /api/v1/orders
X-API-Key: egk_live_…
Idempotency-Key: 7c1e9a52-…     ← one UUID per action, reused on every retry of it
```

Same key + same body → the stored response comes back, nothing new is created, charged or
webhooked. It works for API-key callers AND signed-in site users — one mechanism instead of the
six hand-rolled ones (`ref` on fund moves, `clientId` on chat/refunds, `cancel-${id}`, …).

### Rules

- Order of checks: auth (401) → scope (403) → rate limit (replays count) → idempotency lookup.
  A replay never skips auth — a revoked key cannot fetch a stored order.
- Stored per **seller** (key rotation mid-retry still replays; team members resolve to the
  owner, like the wallet) and per **mode** (a test response never answers a live call).
- New key → run, store. Same body → stored response + `Idempotent-Replayed: true`.
  Different body or route → `422 idempotency_key_reused`. First still running →
  `409 idempotency_in_progress`.
- Store 2xx and 4xx. **Never store 5xx** (the retry must re-run) and never 401/403/429.
- Expire after 24h.
- `external_id` stays: it is the partner's order number (same store order days later). The
  key is one HTTP call retried within minutes. Both are needed.
- The ledger's `(account,type,ref)` and refund refs stay: they guard the MONEY, the header
  guards the REQUEST.

### Steps

**A1 — Server hook + table.** New `server/src/idempotency.js`:
- `api_idempotency` created idempotently at load (the repo's pattern — see CLAUDE.md §6):
  `seller, mode, key, route, body_hash, status, response jsonb, created_at`,
  `UNIQUE (seller, mode, key)`. New and empty, so a unique index is safe here (it is not on
  `orders`, which is why `external_id` has a race).
- Claim the key with `insert … on conflict do nothing` BEFORE running the handler — that
  insert is what closes the concurrent-request race.
- A Fastify `preHandler` + `onSend` pair, active only on routes with
  `config: { idempotent: true }`. Seller = `req.user` (session) or the API key's `seller_id`.
- No `Idempotency-Key` header → behave exactly as today (existing partners must not break).

**A2 — Turn it on** for `POST /api/v1/orders`, `POST /api/v1/orders/:id/cancel`,
`POST /api/webhooks` (fixes the lost signing secret on a retried registration). While in
`sandbox.js`: wrap `createRealOrder` in a transaction — today each line insert has
`.catch(() => {})`, so a failed line leaves a 200'd order with lines missing (§2.6). Test keys
get idempotency too, so the sandbox keeps matching live.

**A3 — Browser.** `useIdempotencyKey()` in `web/lib/`: minted when a dialog/form OPENS, reused
until success, replaced after success or close. A fresh key per call would not stop a
double-click — two clicks are two calls. `lib/api.ts` sends the header. First user: manual
order creation.

**A4 — Gate.** Extend `tools/check-public-api.mjs` (real Postgres): replay returns the same
id; different body → 422; two concurrent requests → one order. Add a check that
order-creating / money-moving POST routes carry `idempotent: true`, with an allow-list that
states a reason per exception.

**A5 — Docs + CLAUDE.md.** Add the header to `/docs` (a section beside Rate limits) and to the
create/cancel/webhook entries in `web/lib/api-endpoints.ts`. Add one CLAUDE.md line: *routes
that create or charge use `config: { idempotent: true }`.*

---

## Part B — MCP server

### What it is

Lets a seller's own AI assistant use EGFULFILL: "reorder last week's 40 black tees", "which of
my orders are stuck?". The assistant calls tools; the tools call our API with the seller's key.

### Design

- **Lives inside the API**, at `POST /api/mcp` in `server/src/routes/mcp.js`. Caddy already
  routes `/api/*`, so there is no new host, container or deploy. Do NOT add a new top-level
  folder (§2.5 — anything new at the repo root is public unless added to `@hidden`).
- **Package:** `@modelcontextprotocol/sdk`, Streamable HTTP transport, stateless mode. In
  Fastify: `reply.hijack()` then `transport.handleRequest(req.raw, reply.raw, req.body)`
  (index.js:719 already uses `hijack` the same way).
- **Auth:** the seller's API key (`X-API-Key` or `Authorization: Bearer egk_…`), resolved with
  the existing `authKey()`. Scopes and rate limits apply unchanged.
- **Every tool calls the real route through `app.inject`** (catalog.js already does this),
  never the database directly. So an MCP call gets exactly the same validation, pricing,
  scopes, rate limit, idempotency and supplier redaction (§2.9) as a partner's call. A second
  code path is how the two drift.
- **Idempotency:** the tool handler mints one `Idempotency-Key` per tool call and reuses it on
  its own retries. A model re-calling the tool is a NEW call, so `create_order` also accepts
  and passes `external_id`.

### Tools (one per documented endpoint)

| Tool | Route | Notes |
|---|---|---|
| `list_products` | `GET /api/v1/products` | read-only |
| `check_stock` | `GET /api/v1/stock` | read-only |
| `quote_order` | `POST /api/v1/orders/quote` | read-only; the description tells the model to quote first |
| `create_order` | `POST /api/v1/orders` | `destructiveHint`; description: confirm total and address with the user first |
| `get_order` | `GET /api/v1/orders/:id` | read-only |
| `cancel_order` | `POST /api/v1/orders/:id/cancel` | `destructiveHint` |
| `get_balance` | `GET /api/v1/balance` | read-only |

Webhooks stay out — they are integration plumbing, not something to ask an assistant for.
Tool descriptions come from the same text as `web/lib/api-endpoints.ts`; a gate should fail if
a tool names a route that list does not document (the list is the promise — CLAUDE.md §6).

### Steps

**B1** — `mcp.js` with `list_products` and `get_order` only. Test with MCP Inspector:
`npx @modelcontextprotocol/inspector` → Streamable HTTP → `http://127.0.0.1:4123/api/mcp`
+ a test key header.
**B2** — the remaining tools, after Part A is live.
**B3** — gate: boot the app, run each tool on a test key, assert `orders` stays empty (same
harness as `check-public-api.mjs`).
**B4** — a "Use with AI assistants" section on `/docs` with the setup below.
**B5 (later)** — OAuth. claude.ai / ChatGPT connectors expect OAuth rather than a pasted key;
API-key headers cover Claude Code, Cursor and most desktop clients first.

### How a seller connects (for the docs page)

Claude Code:
```bash
claude mcp add --transport http egful https://api.egful.store/api/mcp \
  --header "X-API-Key: egk_test_…"
```
Recommend a **test key first** and a key with only the scopes they need (e.g. `orders.read`
and `products.read` for a read-only assistant).

---

## Also found in the audit (fix alongside)

- `GET /api/v1/orders/:id` live returns `total` as a STRING — pass it through `money()`.
- Docs promise `code` on every error; missing on 401, 404s, cancel 409s, stock/balance 500s,
  and webhook 400/409s.
- Ping says "Checks your test key" — it accepts live keys too.
- `/docs` and `/developers` share `API_ENDPOINTS` but do not link to each other:
  `web/lib/help.ts:329` and `:365` say "Read the API docs" and go to `/developers` → point at
  `/docs`; add a "Reference" link in the playground → `/docs#<id>`.
- Legacy `api-playground.html` still calls the removed `/api/test/*`. Frozen — don't delete,
  don't link to it.

## Before every push

Boot-test the server (CLAUDE.md §2.1). For web changes: `npx tsc --noEmit`, `npx eslint
<files>`, `node tools/check-tdz.mjs`. Pushing a branch does not deploy: production is `main` —
the VPS pulls it for `server/`, Vercel builds it for `web/`.
