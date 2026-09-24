# Idempotency keys + public API audit (2026-09-24)

Written at the end of a cloud session so the work can continue elsewhere. Nothing below is
built yet — this is the audit and the agreed design.

## Why

An MCP server for sellers is planned. An AI agent retries tool calls, and on
`POST /api/v1/orders` a retry is a second garment. The site also hand-rolls duplicate
protection in six different spellings (`ref` on fund moves, `clientId` on chat/refunds,
`(account,type,ref)` on the ledger, `cancel-${id}`, `external_id`, Stripe ids). One
mechanism should replace re-deriving it per route.

## Audit findings — `server/src/routes/sandbox.js`, `web/lib/api-endpoints.ts`

Duplicate protection today is `external_id` only (`findByExternalId`), and:

1. Optional — no `external_id`, no protection.
2. Live only — a test key retried twice gets two ids and two `order.received` webhooks, so
   the sandbox no longer reaches live's verdict.
3. Ignores the body — same `external_id`, different items → the first order, silently.
4. Replay shape differs — no `items`, no `shipping_address` on the idempotent path.
5. Races — the index is deliberately non-unique, so two concurrent requests can both insert.

Other defects found:

- `createRealOrder` inserts the order, then each line with `.catch(() => {})` and no
  transaction — a failed line leaves a 200'd order with lines missing (§2.6).
- `POST /api/webhooks` retried after a timeout answers 409 "already registered", and the
  signing secret (shown once) is lost — partner must delete and recreate.
- `GET /api/v1/orders/:id` live returns `total` as a STRING (numeric, not `money()`'d); docs
  show a number.
- Docs promise `code` on every error; missing on 401, 404s, cancel 409s, stock/balance 500s,
  and all webhook 400/409s.
- Ping description says "Checks your test key" — it works with live keys too.
- Cancel is already retry-safe (`refundForCancel` → `clientId: cancel-${id}`). Quote writes
  nothing and needs no key.

## Two docs pages — one source, not linked together

`/docs` (public reference) and `/developers` (signed-in playground) both render
`API_ENDPOINTS`. They look like two docs because:

- the playground has no link to the reference (the reference already has "Try it" links to it);
- `web/lib/help.ts:329` and `:365` say "Read the API docs" but go to `/developers`;
- legacy `api-playground.html` still calls the removed `/api/test/*` (frozen — don't delete, don't link).

Fix: help links → `/docs`; add a "Reference" link in the playground → `/docs#<id>`; fix Ping wording.

## Design

`Idempotency-Key` header, Stripe-shaped, as ONE Fastify hook enabled per route with
`config: { idempotent: true }` — for API-key AND session (JWT) callers.

- Table `api_idempotency`: key, seller, mode, route, body hash, status, response, created_at.
  UNIQUE (seller, mode, key) — new table, so a unique index is safe. 24h expiry.
- Scope: per **seller** (key rotation mid-retry must still replay; team members resolve to
  owner like the wallet) and per **mode** (a test response never answers a live call).
- Order: auth (401) → scope (403) → rate limit (replays count) → lookup.
- New → run and store. Same body → stored response + `Idempotent-Replayed: true`.
  Different body/route → `422 idempotency_key_reused`. In flight → `409 idempotency_in_progress`.
- Store 2xx/4xx. Never store 5xx (a retry must re-run) and never 401/403/429.
- `external_id` stays — it is business-level (same store order days later); the key is
  transport-level (one call retried).
- Ledger `(account,type,ref)` and refund refs STAY — they guard the money, the header guards
  the request. Migrate the six hand-rolled versions gradually, not all at once.
- Browser: `useIdempotencyKey()` — minted when the dialog/form opens, reused until success,
  replaced after success or close (a fresh key per call would not stop a double-click).
  `lib/api.ts` sends the header.
- MCP server: one key per tool call, reused on its own retries; pass `external_id` where one
  exists, because a model re-calling a tool is a new call.

## Build order

1. Hook + table (server).
2. Enable on `POST /api/v1/orders`, `POST /api/v1/orders/:id/cancel`, `POST /api/webhooks`.
   Wrap `createRealOrder` in a transaction.
3. `useIdempotencyKey()` + first use on manual order creation.
4. Gate: extend `tools/check-public-api.mjs` (replay, body mismatch, concurrent) and add a
   check that order-creating / money-moving POST routes carry `idempotent: true`.
5. Docs fixes above; add a CLAUDE.md line once the hook exists.
6. Later: MCP server with tools generated from `web/lib/api-endpoints.ts`.

Boot-test the server (CLAUDE.md §2.1) before every push.
