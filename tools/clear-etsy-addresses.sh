#!/usr/bin/env bash
#
# CLEAR THE BUYER ADDRESS OFF A FEW ETSY ORDERS, so the extension has something to fill.
#
#   tools/clear-etsy-addresses.sh                 # dry run: shows the 3 it would clear
#   tools/clear-etsy-addresses.sh --yes           # clear those 3
#   tools/clear-etsy-addresses.sh 5 --yes         # clear 5 (a bare number up to 3 digits
#                                                 #   is a count; longer is a receipt id)
#   tools/clear-etsy-addresses.sh 3456789012 --yes    # clear this receipt, by its number
#   tools/clear-etsy-addresses.sh --seller you@shop.com 3 --yes
#   tools/clear-etsy-addresses.sh --include-shippo 1 --yes  # one the sync will refill
#   tools/clear-etsy-addresses.sh --restore address-backup-2026-09-14T10-40-00Z.json
#
# WHY THIS EXISTS: `POST /api/etsy/import-addresses` NEVER overwrites an address that is
# already there (etsy.js:1679) — which is the rule that stops a sync clobbering a hand-typed
# fix, and it is also why you can only test the extension once per order. This puts orders
# back into the state the extension is looking for.
#
# IT BACKS UP FIRST, ALWAYS. This deletes a real buyer's address off a real order, and an
# Etsy address cannot always be fetched again (the API address entitlement is what we are
# waiting on). Every run writes the exact `address` jsonb it is about to change to a file,
# and `--restore` puts it back. Nothing is written without `--yes`.
#
# WHERE IT RUNS: on the VPS, where the database is — `ssh root@187.52.126.233`, then
# `cd /root/egfulfill && tools/clear-etsy-addresses.sh`. `docker compose exec db` is how
# psql is reached there (the db port is not published, by design). Set DATABASE_URL instead
# and it talks to that directly, which is what the local test does.
set -euo pipefail

N=3
APPLY=0
FULL=0
INCL_SHIPPO=0
SELLER=""
RESTORE=""
RECEIPTS=()
EG_DIR="${EG_DIR:-/root/egfulfill}"

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y)   APPLY=1 ;;
    --full)     FULL=1 ;;
    --include-shippo) INCL_SHIPPO=1 ;;
    --seller)   SELLER="${2:-}"; shift ;;
    --restore)  RESTORE="${2:-}"; shift ;;
    -h|--help)  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    [0-9]*)
      # A COUNT IS AT MOST THREE DIGITS; anything longer is a receipt id. Etsy receipts are
      # 9-10 digits, and nobody means "clear 4,004 orders" — so the ambiguous middle is
      # resolved towards the reading that cannot run away. A count over the cap below is
      # refused outright rather than interpreted.
      if [ "${#1}" -le 3 ]; then N="$1"; else RECEIPTS+=("$1"); fi ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# A cap, because this deletes buyer addresses and a typo in a count is silent. Name the
# receipts explicitly if you genuinely want more than this.
if [ "$N" -lt 1 ] || [ "$N" -gt 50 ]; then
  echo "Refusing a count of $N — pass 1-50, or name the receipt ids." >&2; exit 2
fi

# ── talking to the database ──────────────────────────────────────────────────
db() {
  if [ -n "${DATABASE_URL:-}" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
  else
    (cd "$EG_DIR" && docker compose exec -T db psql -U egfulfill -d egfulfill -v ON_ERROR_STOP=1 "$@")
  fi
}

# ── restore ──────────────────────────────────────────────────────────────────
if [ -n "$RESTORE" ]; then
  [ -f "$RESTORE" ] || { echo "No such backup: $RESTORE" >&2; exit 1; }
  # Put back exactly what was taken, keyed by order id. `is not null` so a backup that
  # somehow recorded a null cannot blank a row that has since been filled in by hand.
  n=$(db -Atq -v js="$(cat "$RESTORE")" <<'SQL'
with b as (
  select x->>'id' as id, x->'address' as addr
    from jsonb_array_elements(:'js'::jsonb) x
)
update orders o set address = b.addr
  from b where o.id = b.id and b.addr is not null
returning o.id;
SQL
)
  echo "Restored $(printf '%s\n' "$n" | grep -c . || true) order(s) from $RESTORE"
  exit 0
fi

# ── which orders ─────────────────────────────────────────────────────────────
#
# The same predicates the API uses to decide an order is MISSING an address
# (missingAddressReceipts, server/src/routes/etsy.js) — read in reverse, so what this picks
# is exactly what the extension will offer to fill afterwards:
#
#   source='etsy'                  the extension only ever fills Etsy receipts
#   street is present              there is something here to clear
#   status is open                 a shipped order needs no address, and the API skips it,
#                                  so clearing one would make a row that never comes back
#
# The street is read under all four spellings `orders.address` is written with, because its
# writers disagree (web/shared/order-address.ts). Missing one of them would leave an order
# that looks cleared here and still reads as filled to the API.
STREET="coalesce(address->>'street', address->>'line1', address->>'first_line', address->>'address1', '')"
OPEN="coalesce(factory_status,'') not in ('shipped','cancelled','refunded')"

WHERE="source='etsy' and $OPEN and $STREET <> ''"
# ── AND NOT ONE SHIPPO CAN PUT STRAIGHT BACK ────────────────────────────
#
# The Etsy sync runs every five minutes and ENDS by calling fillBlankAddressesFromShippo
# (etsy.js, the last thing syncConnection does). Shippo’s Etsy app is not on the
# restricted tier, so any blank it can fill, it fills. Clear a Shippo-sourced address and
# it is back, byte for byte, before you have finished reloading Shop Manager.
#
# That is exactly what happened on 2026-09-14: three receipts cleared at 03:49, all three
# carrying "source": "shippo", all three refilled by the next sync — and the extension then
# correctly reported nothing to send, which read as the extension being broken.
#
# So the default is orders Shippo cannot supply, which are the ones the extension exists
# for in the first place. --include-shippo clears one anyway and warns what will happen.
SHIPPO_SRC="coalesce(address->>'source','') = 'shippo'"
if [ "$INCL_SHIPPO" != "1" ]; then WHERE="$WHERE and not ($SHIPPO_SRC)"; fi
if [ ${#RECEIPTS[@]} -gt 0 ]; then
  ids=$(printf "'etsy-%s'," "${RECEIPTS[@]}"); ids="${ids%,}"
  WHERE="$WHERE and id in ($ids)"
  LIMIT=""
else
  LIMIT="order by created_at desc limit $N"
fi
if [ -n "$SELLER" ]; then
  WHERE="$WHERE and seller_id = (select id from users where lower(email)=lower('$SELLER'))"
fi

ids=$(db -Atq -c "select id from orders where $WHERE $LIMIT")
if [ -z "$ids" ]; then
  echo "Nothing to clear — no open Etsy order matched (already blank, shipped, or wrong seller)."
  if [ "$INCL_SHIPPO" != "1" ]; then
    n=$(db -Atq -c "select count(*) from orders where source='etsy' and $OPEN and $STREET <> '' and $SHIPPO_SRC")
    [ "${n:-0}" -gt 0 ] && echo "($n carry a Shippo-sourced address, which the 5-minute sync would refill."
    [ "${n:-0}" -gt 0 ] && echo " --include-shippo clears one anyway.)"
  fi
  exit 0
fi
list=$(printf "'%s'," $ids); list="${list%,}"

echo "These orders will be cleared:"
db -c "select id,
              coalesce(address->>'name','—')                as buyer,
              coalesce($STREET,'—')                          as street,
              coalesce(address->>'city','—')                 as city,
              coalesce(factory_status,'—')                   as stage
         from orders where id in ($list) order by id"

if [ "$APPLY" != "1" ]; then
  echo
  echo "Dry run — nothing was changed. Add --yes to clear them."
  exit 0
fi

# ── back up, then clear ──────────────────────────────────────────────────────
stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
backup="${EG_BACKUP_DIR:-.}/address-backup-$stamp.json"
db -Atq -c "select coalesce(jsonb_agg(jsonb_build_object('id', id, 'address', address)), '[]'::jsonb)
              from orders where id in ($list)" > "$backup"
# An empty or unreadable backup means the restore path is already broken, and finding that
# out AFTER the delete is the whole problem. Check before writing anything.
[ -s "$backup" ] || { echo "Backup is empty — refusing to clear anything." >&2; exit 1; }
echo "Backed up to $backup"

# Asked before the UPDATE: --full nulls the column, and the provenance goes with it.
back=$(db -Atq -c "select count(*) from orders where id in ($list) and $SHIPPO_SRC" 2>/dev/null || echo 0)
if [ "$FULL" = "1" ]; then
  SET="address = null"
else
  # Only the street keys. Name, city, state and zip stay, so the row still reads like the
  # order it is — and the API's blank test is a street test, so this is precisely the state
  # the extension calls "missing". `--full` nulls the column outright.
  SET="address = address - 'street' - 'street2' - 'line1' - 'line2' - 'first_line' - 'address1' - 'address2'"
fi

cleared=$(db -Atq -c "update orders set $SET where id in ($list) returning id")
count=$(printf '%s\n' "$cleared" | grep -c . || true)

echo "Cleared $count order(s)."
if [ "${back:-0}" -gt 0 ]; then
  echo "WARNING: $back of these had a Shippo-sourced address. The Etsy sync refills those"
  echo "within five minutes — test the extension now, or it will look like it found nothing."
fi
echo "Receipts the extension should now offer:"
printf '%s\n' $cleared | sed 's/^etsy-//'
echo
echo "Put them back with:  tools/clear-etsy-addresses.sh --restore $backup"
