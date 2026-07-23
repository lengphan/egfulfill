# VPS migration runbook (e.g. DigitalOcean 1GB → Hostinger)

Moving the backend VPS to a bigger host. The **domain stays `egful.store`**, so OAuth
callbacks, webhooks, and the Vercel `/api` proxy are all domain-based and **do not change** —
only the server's **IP** changes. This is what makes the migration low-risk.

> Private doc — `docs/` and `/*.md` are in the Caddyfile `@hidden` list, so this is not
> served publicly. Do **not** paste real secrets (DB password, JWT secret, API keys) in here.

---

## When to do it

**Soon, and as its OWN dedicated cutover** — not interleaved with feature work.

- The migration is decoupled from the app: code deploys identically (`git pull` +
  `docker compose`) on any VPS, and the domain doesn't move.
- 1GB RAM is the current bottleneck (OOM risk + sluggish pages). More RAM helps immediately,
  and every feature after benefits — so there's no reason to wait for "everything done".
- Pick a **low-traffic window you can watch**. The only real risk is the DB dump/restore at
  cutover. Keep the **old droplet running as fallback** for a few days.
- **Freeze pushes during the final dump + DNS flip** — the VPS deploys by `git pull`, so a
  deploy mid-cutover muddies the state.

---

## What actually has to move

| Thing | Where it lives | Migration |
|---|---|---|
| **Postgres data** (orders, wallet, connections, saves) | Docker volume `dbdata` | **`pg_dump` → restore.** The critical step. |
| Uploaded design/print files | S3-compatible object storage (`SPACES_*` set) **or** inline base64 in Postgres | If on Spaces/S3/R2 → external, keep the same `SPACES_*` creds, **nothing to move**. If inline → carried by the DB dump. |
| TLS certs | Caddy | Auto re-issued on the new host (needs ports 80/443 open + DNS pointed). |
| App code | git | `git clone` on the new host. |
| Secrets | root `.env` | Copy it. **Keep `JWT_SECRET` identical** (sessions stay valid), plus `DB_PASSWORD`, `SPACES_*`, all integration keys. |

---

## Steps

### 1. Prep (a day ahead)
- Provision the Hostinger VPS (Ubuntu), install Docker + Docker Compose.
- Open firewall ports **80** and **443** (DB port stays internal to Docker).
- **Lower the DNS TTL** for `egful.store` and `api.egful.store` to ~300s so the cutover
  propagates fast.

### 2. Stand up the new host (parallel to the old one)
```bash
git clone <repo> egfulfill && cd egfulfill
cp /path/to/.env .env          # keep JWT_SECRET, DB_PASSWORD, SPACES_*, integration keys
docker compose up -d --build
curl localhost:3000/health     # -> {"ok":true}
```

### 3. Migrate the database
On the **old** droplet:
```bash
docker compose exec db pg_dump -U egfulfill egfulfill > egfulfill.sql
```
Copy `egfulfill.sql` to the new host, then restore:
```bash
docker compose exec -T db psql -U egfulfill egfulfill < egfulfill.sql
```
`schema.sql` only runs on first DB init; the restore plus the idempotent route-load tables
(order_designs, wallet_ledger, spydeck_*, nav_visibility, …) cover the rest.

### 4. Verify on the new host BEFORE touching DNS
```bash
curl localhost:3000/health
# hit a real data route through the container to confirm the DB is populated
docker compose exec db psql -U egfulfill -d egfulfill -c "select count(*) from orders;"
```

### 5. Cutover
- **Final dump/restore** right before flipping (or a brief maintenance window) so last-minute
  orders/wallet rows aren't lost.
- Point the **A records** to the new IP:
  - `egful.store`      → new IP  (was `68.183.113.72`)
  - `api.egful.store`  → new IP  (this is the 60MB-print-upload path — it must move too)
- Caddy on the new host auto-provisions Let's Encrypt certs once DNS resolves.

### 6. Post-cutover checks
- `curl https://egful.store/api/auth/google/client-id` (a real route, not `/health` — the apex
  serves `index.html` for non-`/api` paths, so `/health` there proves nothing).
- Connect an Etsy/Shopify/TikTok shop (OAuth round-trip) — should work unchanged (same domain).
- Confirm an order sync + a wallet read.
- Watch RAM: `docker stats` — should have real headroom now.

### 7. Keep the old droplet as fallback
Leave it running (DNS un-pointed) for a few days. If anything's wrong, revert the A records.

---

## Why the upgrade (1GB downsides)

1GB shared across Postgres + Node/Fastify + Caddy + file processing is under-spec:

- **OOM kills** — the kernel can kill Postgres or Node under load → the "every `/api` 502s"
  outage. No headroom for order-sync bursts or several sellers at once.
- **60MB base64 print uploads** — decoding/buffering in Node is heavy; two at once can OOM.
- **`docker compose up --build`** often OOMs on 1GB during the npm build (needs swap).
- **Tiny Postgres cache** → more disk reads → slower queries (part of why pages feel sluggish).
- **Image/label/PDF/thread work** is memory-hungry.

4–8GB removes the OOM risk, gives Postgres a real cache (faster queries), makes builds safe,
and leaves headroom for the big uploads and image work.
