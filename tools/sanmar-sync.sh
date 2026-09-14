#!/usr/bin/env bash
#
# SanMar catalogue sync — SFTP the bulk SDL, unzip it, import it.
#
# THIS FILE LIVES IN THE REPO, AND THAT IS THE POINT. Its predecessor lived only at
# /root/sanmar/sync.sh on the VPS, so when that box was deleted on 2026-08-26 the script went
# with it — no copy, no history, nothing to restore from. The catalogue data itself survived
# because it was inside the nightly pg_dump; the thing that REFRESHES it did not, and nothing
# noticed for three weeks. Host-only scripts are not backed up. Repo files are.
#
# WHY SFTP AND NOT SOAP. SanMar give two doors and their guide is explicit: the bulk SDL over
# SFTP for the catalogue, SOAP only for live inventory and pricing (CLAUDE.md §6). The file is
# ~7MB zipped and ~195MB unzipped — it can reach neither the browser (Vercel caps a proxied
# body at ~4.5MB) nor the JSON import route (60MB body limit). It has to land on disk.
#
# INSTALL
#   apt-get update && apt-get install -y sshpass unzip
#   cp tools/sanmar-sync.sh /root/sanmar-sync.sh && chmod +x /root/sanmar-sync.sh
#   # in /root/egfulfill/.env:
#   #   SANMAR_FTP_USER=...      SANMAR_FTP_PASS=...
#   # then, as a daily cron (03:15 UTC — before the 07:30 backup guard, after their nightly build):
#   (crontab -l 2>/dev/null; echo '15 3 * * * /root/sanmar-sync.sh >> /var/log/sanmar-sync.log 2>&1') | crontab -
#
# The FTP credentials are NOT the API credentials. SanMar issue them separately (the API pair
# goes in Settings › Integrations, where app_secrets keeps it inside the nightly dump). These
# two are only ever read by this script, so .env is the right home for them.
set -euo pipefail

REPO="${REPO:-/root/egfulfill}"
ENV_FILE="$REPO/.env"
[ -r "$ENV_FILE" ] || { echo "FATAL: no $ENV_FILE"; exit 1; }

# Read only what we need, and never `source` the file — it is full of values with $, & and
# quotes in them, and sourcing would execute anything that looked like a command.
val() { sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | sed 's/^"//; s/"$//'; }

FTP_HOST="$(val SANMAR_FTP_HOST)"; FTP_HOST="${FTP_HOST:-ftp.sanmar.com}"
FTP_PORT="$(val SANMAR_FTP_PORT)"; FTP_PORT="${FTP_PORT:-2200}"
FTP_USER="$(val SANMAR_FTP_USER)"
FTP_PASS="$(val SANMAR_FTP_PASS)"
FTP_DIR="$(val SANMAR_FTP_DIR)";   FTP_DIR="${FTP_DIR:-SanMarPDD}"
ZIP_NAME="$(val SANMAR_SDL_ZIP)";  ZIP_NAME="${ZIP_NAME:-SanMar_SDL_N.zip}"
CSV_NAME="$(val SANMAR_SDL_CSV)";  CSV_NAME="${CSV_NAME:-SanMar_SDL_N.csv}"
DEST="$(val SANMAR_HOST_DIR)";     DEST="${DEST:-/root/sanmar/sdl}"

[ -n "$FTP_USER" ] && [ -n "$FTP_PASS" ] || {
  echo "FATAL: SANMAR_FTP_USER / SANMAR_FTP_PASS are not in $ENV_FILE."
  echo "       They come from SanMar's one-time Bitwarden Send link, separately from the API pair."
  exit 1; }

# ONE AT A TIME. The unzip alone is ~195MB and a couple of minutes; two overlapping runs would
# write the same file while the importer streams it.
exec 9>/var/lock/sanmar-sync.lock
flock -n 9 || { echo "$(date -u +%FT%TZ) another sanmar-sync is running — skipping"; exit 0; }

say() { echo "$(date -u +%FT%TZ) $*"; }
say "start"

# STAGE IN A TEMP DIR, SWAP ON SUCCESS. $DEST is bind-mounted read-only into the api
# container and the importer streams the CSV off it — downloading straight there would let a
# half-transferred file be imported as if it were the whole catalogue, which is worse than
# not syncing at all: prices would silently change for the styles that made it and not the
# rest, and nothing downstream could tell.
TMP="$(mktemp -d /tmp/sanmar-sync.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

say "fetching $FTP_DIR/$ZIP_NAME from $FTP_HOST:$FTP_PORT"
# -oBatchMode=no is required: sshpass feeds the password on the tty, and batch mode refuses
# password auth outright. StrictHostKeyChecking=accept-new pins their key on the first run and
# then fails if it ever changes, rather than trusting a new one silently every night.
sshpass -p "$FTP_PASS" sftp \
  -oPort="$FTP_PORT" -oBatchMode=no -oStrictHostKeyChecking=accept-new \
  -oUserKnownHostsFile=/root/.ssh/known_hosts_sanmar \
  "$FTP_USER@$FTP_HOST" <<EOF
cd $FTP_DIR
get $ZIP_NAME $TMP/$ZIP_NAME
bye
EOF

[ -s "$TMP/$ZIP_NAME" ] || { say "FATAL: $ZIP_NAME did not arrive, or is empty"; exit 1; }
say "got $(du -h "$TMP/$ZIP_NAME" | cut -f1)"

say "unzipping"
unzip -o -q "$TMP/$ZIP_NAME" -d "$TMP/x"
SRC="$(find "$TMP/x" -maxdepth 2 -type f \( -iname '*.csv' -o -iname '*.txt' \) -print -quit)"
[ -n "$SRC" ] || { say "FATAL: no CSV inside $ZIP_NAME"; exit 1; }

# A catalogue that suddenly collapses is far more likely to be a truncated transfer than
# SanMar dropping 90% of their range overnight. Refuse it and keep yesterday's.
LINES="$(wc -l < "$SRC")"
say "parsed $LINES rows from $(basename "$SRC")"
[ "$LINES" -gt 50000 ] || { say "FATAL: only $LINES rows — refusing to replace the catalogue with a short file"; exit 1; }

mkdir -p "$DEST"
mv -f "$SRC" "$DEST/$CSV_NAME"
say "staged $DEST/$CSV_NAME"

# IMPORT FROM INSIDE THE api CONTAINER.
#
# Two reasons it is not a curl from the host. `curl localhost:3000` has never worked on this
# box — the api container EXPOSES 3000 without PUBLISHing it, so only the docker network can
# reach it (CLAUDE.md §3), and that is the safer configuration to keep. And the route is
# admin-only while sessions expire after 7 days (auth.js), so a static token in a cron job
# would die every week and the sync would fail silently a fortnight after anyone set it up.
#
# So the container signs its OWN five-minute token with the JWT_SECRET it already holds. No
# password is stored anywhere, no long-lived credential exists to leak, and `sub` says
# sanmar-sync rather than impersonating a person in any audit trail.
say "importing"
RESULT="$(cd "$REPO" && docker compose exec -T -e SDL_CSV="$CSV_NAME" api node --input-type=module -e '
import jwt from "jsonwebtoken";
const file = process.env.SDL_CSV;
const t = jwt.sign({ sub: "sanmar-sync", role: "admin", email: "sanmar-sync@egful.store" },
                   process.env.JWT_SECRET, { expiresIn: "5m" });
const r = await fetch("http://127.0.0.1:3000/api/sanmar/import/local", {
  method: "POST",
  headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
  body: JSON.stringify({ file }),
});
const body = await r.text();
if (!r.ok) { console.error("HTTP " + r.status + " " + body); process.exit(1); }
console.log(body);
' 2>&1)" || { say "FATAL: import failed — $RESULT"; exit 1; }

say "done: $RESULT"
