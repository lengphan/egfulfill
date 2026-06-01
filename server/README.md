# EGFULFILL — self-hosted backend (Node + Fastify + PostgreSQL + Caddy)

One VPS runs **everything**: the Postgres database, the API, and your static
frontend — all via Docker Compose. Total cost ≈ one ~€4/month VPS.

```
browser ──HTTPS──> Caddy ──/api/*──> Fastify (Node) ──> PostgreSQL
                     └────────────> static HTML/JS (this repo)
```

## What you need (one-time)
1. A **VPS** — recommended **Hetzner CX22** (~€4/mo, 4 GB) or a DigitalOcean $6 droplet. OS: **Ubuntu 24.04**.
2. (Optional but recommended) a **domain name**, with an **A record** pointing at the VPS IP. Without one you can still test over plain HTTP using the server IP.
3. Nothing to install on your own laptop — everything runs on the VPS.

## Deploy (run these on the VPS, once)
```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh

# 2. Get the code
git clone https://github.com/lengphan/egfulfill.git
cd egfulfill

# 3. Configure secrets
cp .env.example .env
nano .env            # set DB_PASSWORD, JWT_SECRET (long random strings), CORS_ORIGIN

# 4. (If using a domain) put it in the Caddyfile
nano Caddyfile       # replace your-domain.com  — or use :80 to test without HTTPS

# 5. Launch (builds + starts db, api, caddy). The schema loads automatically.
docker compose up -d --build

# 6. Watch logs / check health
docker compose logs -f api
curl localhost:3000/health        # -> {"ok":true}
```

Your site is now live at your domain (or http://VPS_IP).

## Create a staff (operator/admin/warehouse/designer) user
Public signup only ever makes **sellers**. To make a staff account:
```bash
docker compose exec db psql -U egfulfill -d egfulfill \
  -c "update users set role='operator' where email='op@you.com';"
```
(First sign that email up through the app, then run the line above.)

## Everyday updates
```bash
git pull
docker compose up -d --build     # rebuilds the API; DB data persists
```

## Backups (your responsibility now)
```bash
docker compose exec db pg_dump -U egfulfill egfulfill > backup_$(date +%F).sql
```
Add that to a cron job and copy it off the box.

## API surface (so the frontend can talk to it)
| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/signup` | public (creates a seller) |
| POST | `/api/auth/login` | public → returns `{ user, token }` |
| GET  | `/api/me` | signed-in |
| GET  | `/api/orders` | seller=own, staff=all |
| POST | `/api/orders` | signed-in (upsert) |
| PATCH| `/api/orders/:id` | owner or staff |

Send the token as `Authorization: Bearer <token>` on protected calls.
Add inventory/design-card/etc. routes by copying `src/routes/orders.js`.
