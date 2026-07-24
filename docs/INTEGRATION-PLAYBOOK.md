# Integration Playbook

**How to add a new external service (a marketplace, a supplier, a design/label partner, a
payment or shipping provider) to EGFULFILL — without drafting a new plan every time.**

This is the repeatable path. Every integration already in the repo (Etsy, Shopify, TikTok,
Pink Design, S&S, Otto, Stripe, PayPal, Shippo, Google Sheets) is built this exact way, so a
new one is *copy-a-template-and-adapt*, not a from-scratch build. Copy the checklist at the
bottom into the PR/notes for each new site.

---

## The one rule that removes the confusion

**The API contract is the seam.** The "contract" is just *the shape of what the API sends
back*. In this repo the contract lives in one file — [`web/lib/api.ts`](../web/lib/api.ts):
every fetcher and its TypeScript type sit together, and it is the **only** place the frontend
talks to the server.

So the order of work follows from *who defines the contract*:

| What you're building | Who defines the shape | Build order |
|---|---|---|
| **An external integration** (a new site's API) | **Them** — you must discover it | **Backend-first.** Connect, see their real response, *then* build UI to match. |
| New UI on data we already have | Already in `lib/api.ts` | Frontend-first or parallel. |
| A new feature needing both sides | You decide it | Agree the response shape first (even a stub), then build both sides to it. |

For a **new site you don't control, always go backend-first** — you can't design a screen for
data you haven't seen. That is the case this playbook is written for.

You also **never rebuild the whole app.** Each integration is its own backend route file and
each screen is its own component, so you touch only the files for the one thing you're adding.
See *Isolation* at the end.

---

## Step 0 — Get the credentials (from THEIR settings)

Keys/secrets live in the vendor's own dashboard (Settings → API / Developer / Webhooks).
Collect, and write down which is which — the direction matters:

- **Our credential → them** (an API key / client id + secret / service id / OAuth app).
- **Their credential → us**, if they call back (a *webhook secret*, separate from the above —
  conflating the two silently breaks one when you rotate the other; see `PINKDESIGN_API_KEY`
  vs `PINKDESIGN_WEBHOOK_SECRET`).
- Note the **auth style**: static bearer key, client-id+secret exchange, or OAuth redirect.
- Note whether they have a **sandbox/test** base URL — use it until proven.

> **Never put a real secret in the repo, in chat, or in the frontend.** Secrets live only in
> the VPS root `.env`. This is not negotiable.

---

## Step 1 — Explore their API before writing app code (throwaway)

Learn their real shapes and error codes with a scratch script first, so you build the adapter
against reality, not their docs' happy path. Put it in the scratchpad, read the key from ENV:

```bash
# scratch probe — never committed
API_KEY=xxxx node -e '
  const r = await fetch("https://sandbox.vendor.com/api/whoami", {
    headers: { Authorization: "Bearer " + process.env.API_KEY }
  });
  console.log(r.status, await r.text());
'
```

You're answering: *does the key work, what does a success look like, what does an error look
like (status code + body)?* Two minutes here saves a day of guessing.

---

## Step 2 — Build the adapter (copy an existing one)

Templates, closest first:

- Simple bearer key + read + webhook back → [`server/src/routes/pinkdesign.js`](../server/src/routes/pinkdesign.js)
- Client-id/secret token exchange + dry-run order placement → [`server/src/routes/ottocap.js`](../server/src/routes/ottocap.js), [`server/src/routes/ss.js`](../server/src/routes/ss.js)
- OAuth redirect connect flow → [`server/src/routes/etsy.js`](../server/src/routes/etsy.js), [`server/src/routes/tiktok.js`](../server/src/routes/tiktok.js)

Copy one, rename, and keep these four properties — they are why the pattern is reliable:

1. **Read keys at CALL time, never at module load.**
   ```js
   const apiKey = () => (process.env.VENDOR_API_KEY || '').trim();   // ✅ picks up a key saved later
   // const KEY = process.env.VENDOR_API_KEY;                         // ❌ snapshots at boot; a saved key never applies
   ```
2. **One fetch wrapper** — auth header, a timeout, JSON parse, uniform `{ ok, status, data }`
   (see `pink()` / `ss()`), so every call handles failure the same way.
3. **A `/config` endpoint** → `{ configured: !!apiKey() }`. Cheap "is the key even set?".
4. **A `/status` (or `/diag`) endpoint** that does a **real, side-effect-free round-trip** to
   the vendor and returns their raw response — this is your in-app "test the connection". Gate
   it `requireStaff`. (See `/api/pinkdesign/status`, `/api/ss/status`, `/api/sheets/diag`, and
   `/api/admin/storage-diag` which does a full write→read→delete.)

Wire the route into [`server/src/index.js`](../server/src/index.js) the same way the others
are (copy an existing `xxxRoutes(app, ...)` line).

> **Boot-test before you push** — a single malformed route option makes Fastify throw *at
> startup*, so **every** `/api/*` returns 502, not just the broken route. See Step 7.

---

## Step 3 — Configure on the VPS

Put the keys in the **root `.env`** on the droplet and redeploy the backend:

```bash
# on the VPS
nano .env                              # add VENDOR_API_KEY=..., VENDOR_WEBHOOK_SECRET=..., etc.
git pull && docker compose up -d --build
```

A module that snapshots keys at boot (Step 2.1) is exactly the bug this order can hide, so read
at call time and this Just Works after the rebuild.

---

## Step 4 — Verify the connection (read the RAW response)

Hit **our own** `/status` — this proves the round-trip to the vendor works and shows you the
real shape you'll build the UI against:

```bash
curl -s https://api.egful.store/api/vendor/status -H "Authorization: Bearer <staff-JWT>" | jq
```

If it returns their boards/products/whoami — connected. If it returns a 401/403 *from the
vendor*, the key exists but their account may not be API-activated yet (a support request to
them, not a code bug — this is a real, common gate).

---

## Step 5 — Build the frontend to match the real response

Only now, with the actual shape in hand:

1. Add the fetcher + its type to [`web/lib/api.ts`](../web/lib/api.ts) — types next to
   fetchers, and this is the **only** file that talks to the server.
2. Build the screen/component against that type. Match the app's design tokens; don't invent a
   parallel style. (See [CLAUDE.md](../CLAUDE.md) §4.)
3. `npx tsc --noEmit` and `npx eslint <changed files>` must both be clean.

Because you built to the *observed* contract, the UI can't disagree with what the server
actually returns.

---

## Step 6 — Gate anything that WRITES behind a dry-run flag

Reads are safe. Anything that **places an order, charges, or mutates the vendor's side** must
be **dry-run by default** — return the payload *without sending* until a flag is flipped, and
against the **sandbox** base first:

```js
if (String(process.env.VENDOR_ORDER_LIVE || '') !== '1') {
  return { dryRun: true, note: 'Set VENDOR_ORDER_LIVE=1 to place a real order.', payload: safePayload(payload) };
}
```

This is how `SS_ORDER_LIVE` / `OTTOCAP_ORDER_LIVE` work: you see exactly what *would* be sent,
with zero risk, until you deliberately turn it on. **Never risk a connected account** — sync
must not overwrite what it didn't author, and nothing may suspend a seller's shop.

---

## Step 7 — Ship it

```bash
# 1. Boot-test the server locally FIRST (a bad route 502s the whole API)
cd server && lsof -ti:4123 | xargs kill -9 2>/dev/null
DATABASE_URL=postgres://x:x@127.0.0.1:1/x JWT_SECRET=test PORT=4123 node src/index.js &
sleep 8; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4123/health   # want 200
lsof -ti:4123 | xargs kill -9

# 2. Stage EXPLICIT paths (never `git add -A` — other sessions commit here), commit, push
git add server/src/routes/vendor.js web/lib/api.ts web/components/app/vendor-thing.tsx
git commit -m "vendor: ..." && git push origin main

# 3. Frontend auto-deploys (Vercel). For the BACKEND, redeploy on the VPS:
#    git pull && docker compose up -d --build

# 4. Confirm the new route actually shipped — 403 = deployed, 404 = still old build:
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.egful.store/api/vendor/status
```

The 403-vs-404 check works because a *real-but-auth-gated* route returns **403** to a tokenless
call while a *nonexistent* route returns **404**. It sends nothing real to the vendor — it only
asks "does this route exist yet?".

---

## The safety rails (non-negotiable — each cost real damage once)

- **Keys in `.env` only.** Never in the repo, the frontend, or a chat. The repo is the Caddy
  webroot — a private GitHub repo is *not* a private deploy.
- **Read keys at call time**, not module load.
- **Boot-test before every push.** One bad route = every `/api/*` down.
- **Writes are dry-run until proven**, sandbox first.
- **Never risk a connected account** — this outranks any feature.
- **Stage explicit paths**, never `git add -A`.
- **Prefer a real check over a mock.** Mocks have produced false confidence here; run the
  actual `/status` round-trip.

---

## Isolation — you only touch the files for THIS integration

You are never rebuilding the app. A new integration adds/edits, at most:

```
server/src/routes/vendor.js      ← the adapter (new file)
server/src/index.js              ← one line wiring it in
web/lib/api.ts                   ← the fetcher(s) + type(s)
web/components/app/…             ← the screen(s) that use it
.env  (on the VPS)               ← the keys
```

Nothing else moves. Fixing one page later = editing that one component. Adding one endpoint =
one fetcher + one route. That is the normal mode, not a special case.

---

## Copy-me checklist (one per new integration)

```
[ ] Credentials collected from vendor settings; auth style + sandbox base noted
[ ] Our-key vs their-webhook-secret kept separate
[ ] Explored their API with a throwaway probe (real shapes + error codes)
[ ] Adapter route added (keys read at CALL time; fetch wrapper; /config + /status)
[ ] Route wired into server/src/index.js
[ ] Keys added to VPS .env; backend redeployed
[ ] /status curl returns their live response (connected)
[ ] Frontend fetcher + type added to lib/api.ts; UI built to the OBSERVED shape
[ ] tsc + eslint clean
[ ] Any write path gated dry-run (VENDOR_ORDER_LIVE), sandbox first
[ ] Boot-tested locally (health 200) before push
[ ] Committed explicit paths + pushed; backend redeployed on VPS
[ ] 403-vs-404 check confirms the route is live
[ ] Nothing can suspend/overwrite a connected account
```

---

*Related: [MIGRATION-PLAN.md](MIGRATION-PLAN.md) (the static→React migration this app is mid-way
through), and [CLAUDE.md](../CLAUDE.md) §3 (deploy topology) and §6 (backend conventions).*
