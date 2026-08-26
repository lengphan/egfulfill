# Disaster recovery

Written on **2026-08-26**, the day the VPS was deleted, from the commands that actually
worked. Every gotcha below cost real time that day — the point of this file is that it costs
minutes next time instead of an afternoon.

**The one-line summary:** the database came back because a nightly job happened to be working.
Nothing else was designed to survive. That is now fixed, and §5 says how.

---

## 1. What survives a server dying, and what does not

Know this before you touch anything — it decides whether you are restoring or rebuilding.

| Thing | Lives in | Survives? |
|---|---|---|
| All code | GitHub | ✅ — the VPS only ever *pulls* |
| Design files, card art, print files, site images | Cloudflare R2 | ✅ independent of the server |
| Database dumps | R2 `backups/db/` | ✅ nightly, last 14 kept |
| `.env`, encrypted | R2 `backups/env/` | ✅ since 2026-08-26 (§5) |
| Integration keys added **in the app UI** | Postgres `app_secrets` | ✅ they are inside the dump |
| Seller store connections + OAuth tokens | Postgres `platform_connections` | ✅ inside the dump |
| Brevo senders, DKIM, DMARC | Brevo | ✅ nothing to restore |
| Integration keys typed into **`.env`** | the server only | ❌ **gone** unless §5 ran |
| `JWT_SECRET`, `DB_PASSWORD` | the server only | ❌ regenerate — see §4.2 |
| Anything written since the last nightly | nowhere | ❌ up to 24h of writes |

**The asymmetry is the lesson.** On 2026-08-26, ten credentials came back on their own because
someone had entered them in Settings › Integrations; the twenty in `.env` all had to be
re-fetched by hand from ten different dashboards. **Prefer the UI for any key that has a
field.** See §6.

**`git` is safe but check anyway.** That day, one of the parallel worktrees
(`~/Downloads/claude-wt/wt2`) held **two unpushed commits** that existed only on the MacBook.

```bash
git log --oneline origin/main..HEAD          # the main checkout
for w in ~/Downloads/claude-wt/wt*; do
  echo "$w: $(git -C "$w" log --oneline origin/main..HEAD | wc -l) unpushed"
done
```

---

## 2. Triage — is it actually dead?

```bash
ping -c 3 <OLD_IP>                                    # 100% loss = box gone or off
dig +short A egful.store                              # where DNS still points
curl -s -o /dev/null -m 20 -w "%{http_code}\n" https://egful.store/api/auth/google/client-id
```

**`/health` on the live domain proves nothing** — Caddy serves `index.html` for anything that
is not `/api/*`, so it returns 200 while the API is dead. Always probe a real API route.

**Before rebuilding, check the old box is genuinely unrecoverable.** A stopped droplet can be
started; a destroyed one cannot. If it can be started, `pg_dump` it **before anything else** —
that beats any backup because it has no gap.

---

## 3. Getting the data back out of R2

### 3.1 The bucket is `egfulfill-files`

**With a hyphen.** Typing `egfulfill_files` costs a confusing detour: S3 rejects underscores,
and the error arrives as a 400 whose body — not its status — names the real problem.

```xml
<Error><Code>InvalidBucketName</Code><BucketName>egfulfill_files</BucketName></Error>
```

**Always read the body of a failed S3 call.** The status code alone is misleading.

### 3.2 Credentials

R2 credentials are **not recoverable** from the dead box — mint new ones. They are also not the
generic Cloudflare API token: that page gives a single bearer token and is the wrong screen.

> `https://dash.cloudflare.com/?to=/:account/r2/api-tokens`
> → **Object Read & Write**, scoped to the bucket

It returns three things together: **Access Key ID** (32 chars) → `SPACES_KEY`, **Secret Access
Key** (64 chars) → `SPACES_SECRET`, and the **S3 endpoint** → `SPACES_ENDPOINT`. If you are
looking at one lone "Token value", you are on the wrong page.

### 3.3 Use the app's own signer, not a hand-rolled one

A hand-written SigV4 `ListObjectsV2` returned **HTTP 400** and was not worth debugging.
`server/src/storage.js` already signs correctly — it is the code that *wrote* the backups.

```bash
# On the box. NOTE: restart api first if you just added SPACES_* to .env —
# the container snapshots env at boot, so it reports "storage not configured" otherwise.
docker compose up -d api && sleep 6

cat > /root/presign.mjs <<'JS'
import { storageEnabled, presignGet } from "/app/src/storage.js"
if (!storageEnabled()) { console.error("STORAGE NOT CONFIGURED"); process.exit(1) }
console.log(presignGet(process.argv[2], 3600))
JS

docker compose cp /root/presign.mjs api:/tmp/presign.mjs
URL=$(docker compose exec -T api node /tmp/presign.mjs \
  "backups/db/egfulfill-<STAMP>-auto.dump" | tr -d '\r' | tail -1)
curl -s -m 1200 -o /root/restore.dump "$URL"
```

**A presigned URL is signed for `GET`.** `curl -I` (HEAD) against it returns **403** — that is
correct behaviour, not a credentials problem. Do not chase it.

To find the newest key without a listing API, read the object list in the Cloudflare dashboard
(**R2 → bucket → `backups/db/`**), or query the index the backup route maintains:

```bash
docker compose exec -T db psql -U egfulfill -d egfulfill -tAc \
  "select r2_key from db_backups where status='done' order by created_at desc limit 1;"
```

### 3.4 Validate before trusting it

```bash
file /root/restore.dump          # -> PostgreSQL custom database dump - v1.15-0
docker compose cp /root/restore.dump api:/tmp/restore.dump
docker compose exec -T api pg_restore -l /tmp/restore.dump | head -4
```

A truncated download is still a file. `pg_restore -l` is what tells you it is an archive.

---

## 4. Standing up a new box

### 4.1 Docker

```bash
apt-get update -qq && apt-get install -y ca-certificates curl gnupg rsync
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq && apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

### 4.2 The repo and a minimal `.env`

Cloning needs GitHub auth the fresh box does not have. **`rsync` from the MacBook is faster
than setting up a deploy key**, and carrying `.git` means `git pull` deploys work later:

```bash
rsync -az --exclude node_modules --exclude .next --exclude screenshots \
  ./ root@<NEW_IP>:/root/egfulfill/
```

Only three values are needed to boot — everything else in `docker-compose.yml` has a safe
default:

```bash
cd /root/egfulfill
cat > .env <<EOF
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
CORS_ORIGIN=https://app.egful.store,https://egful.store
APP_URL=https://app.egful.store
EOF
chmod 600 .env
mkdir -p /root/sanmar/sdl          # the SanMar bind mount, or compose fails to start
docker compose up -d --build
```

**A new `JWT_SECRET` logs everyone out. That is fine** — accounts and passwords are in the
database. It is not worth trying to recover the old one.

**`docker compose up -d --build`, never plain `up`.** The API image carries
`postgresql16-client`; without a rebuild there is no `pg_dump`, and **every future backup fails
silently.** §5's guard now catches exactly this.

### 4.3 Restore

```bash
docker compose stop api                                  # release the connection pool
docker compose cp /root/restore.dump db:/tmp/restore.dump
docker compose exec -T db psql -U egfulfill -d postgres -c "drop database if exists egfulfill;"
docker compose exec -T db psql -U egfulfill -d postgres -c "create database egfulfill owner egfulfill;"
docker compose exec -T db pg_restore -U egfulfill -d egfulfill \
  --no-owner --no-privileges -j 2 /tmp/restore.dump
docker compose up -d api
```

`pg_restore` lives in the **db** container (`postgres:16-alpine`) as well as the api image —
useful, because api is stopped at that moment.

Verify with numbers, not vibes:

```bash
docker compose exec -T db psql -U egfulfill -d egfulfill -tAF' ' -c \
  "select relname, n_live_tup from pg_stat_user_tables where n_live_tup>0 order by n_live_tup desc limit 10;"
```

### 4.4 Restore `.env` from the encrypted copy

```bash
# Passphrase is in the owner's password manager — deliberately NOT on the server.
docker compose exec -T api node -e "
import('/app/src/storage.js').then(async m => {
  const r = await m.getObject('backups/env/env-<STAMP>.enc')
  require('fs').writeFileSync('/tmp/back.enc', r.body)
})"
docker compose cp api:/tmp/back.enc /root/back.enc
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in /root/back.enc -out /root/restored.env -pass pass:'<PASSPHRASE>'
```

Merge it in, but **keep the newly generated `DB_PASSWORD`** — the restored one belongs to a
database that no longer exists.

### 4.5 DNS, and the two things that then go wrong

Point `@`, `api`, `www` at the new IP. Leave `app` alone — it is a Vercel CNAME.

DNS lives at **Namecheap** (`dns1.registrar-servers.com`): Domain List → Manage → **Advanced
DNS**. **Editing a row is not saving it** — you must click the green ✓ at the end of each row,
past the TTL column and often off-screen. Confirm against the authoritative server, which
updates instantly on a real save:

```bash
dig +short A egful.store @dns1.registrar-servers.com
```

**Then two symptoms appear, both temporary and neither a fault:**

1. **Caddy has no certificate.** Let's Encrypt resolves your domain to the *old* IP and the
   HTTP-01 challenge times out. It retries every 10 minutes; `docker compose restart caddy`
   after DNS lands to skip the backoff. Until then HTTPS legitimately does not answer.
2. **Vercel returns `{"code":"502","message":"An error occurred with this application."}`** —
   *that message is Vercel's, not ours.* `web/next.config.ts` rewrites `/api/*` to
   `https://egful.store`, and Vercel's edge nodes cache DNS independently. Expect roughly
   **half** of requests to fail while it propagates — the dashboard half-loads, some cards
   spin forever. It self-heals within the TTL; force it with an empty commit if impatient:

```bash
git commit --allow-empty -m "chore: force vercel rebuild" && git push
```

### 4.6 Email — the failure that is completely silent

- The code calls `https://api.brevo.com/v3/smtp/email`. It needs the key starting
  **`xkeysib-`**. An **`xsmtpsib-`** key is the SMTP relay key and **will not work** — the host
  blocks outbound SMTP ports, which is why the HTTP transport exists at all.
- `SMTP_FROM` must be a **verified sender**. The verified address is
  `No Reply <no-reply@mail.egful.store>` — note the `mail.` subdomain. `.env.example` documents
  it without, and Brevo rejects sends from an unverified sender.
- **Brevo → Security → Authorised IPs.** If enabled, the old server's IP is in it and the new
  one is not. This killed all mail after the 2026-07-31 move and nearly again on 2026-08-26.

Prove it rather than assume it:

```bash
docker compose exec -T api node -e "
import('/app/src/mailer.js').then(async m => {
  console.log('configured:', m.mailConfigured())
  console.log(await m.sendMail({ to:'you@example.com', subject:'test', text:'test' }))
})"
```

---

## 5. What now prevents a repeat

Added 2026-08-26. All on the box, all verified working the day they were written.

| Guard | What it does |
|---|---|
| `/root/env-backup.sh` | AES-256 encrypts `.env` → R2 `backups/env/`. Passphrase in `/root/.env-backup-pass` **and the owner's password manager** — a key stored beside its backup is not a key. |
| `/root/backup-guard.sh` | Daily **07:30 UTC** via cron. |

The guard asks the three questions a backup has to answer, and **emails only on failure**:

1. **Is there a recent dump?** Under 36h, status `done`.
2. **Is it actually restorable?** It *downloads* it and runs `pg_restore -l`. Existence is not
   integrity — a half-finished upload is a file of the right name and no use whatsoever.
3. **Is `pg_dump` still in the api image?** The specific silent death from §4.2.

It also refreshes the encrypted `.env` copy, so the off-site secret set never drifts from what
is running.

**A guard that mails every night trains you to ignore it.** Silence means healthy.

### Still worth doing

- **Provider snapshots.** The Hostinger panel showed `0` on 2026-08-26. One would have made
  that day a ten-minute rollback.
- **A second home for the dumps.** They are all in one Cloudflare account, alongside the
  encrypted `.env`. One closed or compromised account still loses both.
- **A quarterly full restore drill** into a scratch database. §3.4 proves the file parses;
  only a real restore proves the data.

---

## 6. Where a credential should live

**If the app has a field for it, use the field.** Those go to `app_secrets` in Postgres and are
inside every nightly dump. This is the single highest-value habit in this document.

> Settings › Integrations covers: `ETSY_*` · `SHOPIFY_*` · `TIKTOK_APP_KEY`/`SECRET` · `SS_*` ·
> `OTTOCAP_*` · `SANMAR_*` · `META_*` · `GOOGLE_ADS_*` · `GOOGLE_SHEETS_API_KEY` ·
> `VIETQR_API_*` · `STRIPE_SECRET_KEY` · `SHIPPO_API_TOKEN` · `EASYPOST_API_KEY`

`.env` is only for keys with no UI: `BREVO_API_KEY`, `GOOGLE_CLIENT_ID`,
`STRIPE_PUBLISHABLE_KEY`, `PAYPAL_*`, `GEMINI_API_KEY`, `WILCOM_*`, `PINKDESIGN_*`,
`BYEASTSIDE_*`, `SPACES_*`, `USPS_*`, `TIKTOK_SERVICE_ID`, and the infrastructure values.

**Seller connections vs our app credentials are different things**, and the distinction has a
deadline. `platform_connections` holds each seller's OAuth token and survives in the dump — so
orders keep syncing after a rebuild. But those tokens **expire**, and refreshing one requires
*our* app credentials. Re-add Etsy/Shopify/TikTok app keys promptly after any rebuild, or the
connection dies quietly at renewal with nothing in the logs to explain it.

---

## 7. Small traps, each of which cost time on the day

- **`while read` drops a final line with no trailing newline.** An env file saved by a GUI
  editor often has none, so the last key silently vanishes from any check. Use `awk 'NF'`.
- **A stale `docker compose ps` looks healthy.** Kill the port first; a leftover process makes
  a broken build look fine, and has already invalidated one audit.
- **`curl localhost:3000/health` from the host does not work and never did** — the api
  container *exposes* 3000 but does not *publish* it. Use
  `docker compose exec -T caddy wget -qO- http://api:3000/health`. Do not "fix" this by
  publishing the port; the current setup is the safer one.
- **The api container snapshots env at boot.** Adding `SPACES_*` to `.env` does nothing until
  `docker compose up -d api`. The symptom is `storage not configured` with the keys visibly
  present in the file.
- **`docker-compose.yml` forwards env by NAME.** A line in `.env` that is not also listed in
  the compose file **never reaches the container**. This has silently broken Otto, Wilcom and
  the TikTok region flag before.
- **`images/*.jpg` and `*.png` at the repo root are PUBLIC.** Caddy's `@hidden` is an exclusion
  list covering only `.pdf`/`.pes`/`.dst`/`.emb` and two named logos. Verified live on
  2026-08-26: `https://egful.store/images/121397_f_fm.jpg` → **200**. Never put supplier
  reference photos there.

---

## 8. The numbers from 2026-08-26, as a sanity check

If a future restore lands near these, it worked. If it is wildly off, stop and investigate.

| | |
|---|---|
| Dump size | ~197–206 MB |
| Tables | 92 |
| Orders | 1,006 |
| Order items | 1,344 |
| Wallet ledger | 203 |
| Users / admins | 40 / 7 |
| S&S products | 195,801 |
| SanMar styles | 4,083 |
| Data lost | ~27h (last dump 2026-08-25 12:55 UTC) |
