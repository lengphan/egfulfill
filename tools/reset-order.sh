#!/usr/bin/env bash
#
# RESET ONE ORDER, so the browser extension can be watched importing it again.
#
# WHY THIS EXISTS AS A SCRIPT rather than a psql line in a chat log: the obvious version is
# `delete from orders where id='…'`, and that is wrong in three ways on this database.
#
#   1. `order_designs` and `order_threads` have NO foreign key to orders (they are created at
#      route load, not in schema.sql — CLAUDE.md §6). A plain delete leaves both orphaned, and
#      the next order that happens to reuse the id inherits somebody else's artwork.
#   2. `wallet_ledger` is APPEND-ONLY and its `ref` is the order id. Deleting a charged order
#      leaves a debit pointing at nothing — the seller stays charged and the row can never be
#      explained. This refuses to touch such an order unless you say so out loud.
#   3. There is no undo. Nothing here is recoverable from the app.
#
# It is therefore a DRY RUN by default. It prints exactly what it would remove and changes
# nothing until you pass --yes.
#
# USAGE (run on the VPS, from /root/egfulfill)
#
#   tools/reset-order.sh etsy-4172259915                  # show me what this would do
#   tools/reset-order.sh etsy-4172259915 --address --yes  # blank the address only
#   tools/reset-order.sh etsy-4172259915 --items   --yes  # drop the lines, keep the order
#   tools/reset-order.sh etsy-4172259915 --all     --yes  # remove the order entirely
#
# WHICH MODE TO USE FOR WHAT YOU ARE TESTING
#
#   --address   the order stays, its address is blanked  -> the panel offers "1 address"
#   --items     the order stays, its lines go            -> tests nothing useful on its own;
#                                                           the reader only ADDS lines to an
#                                                           order it can see, so use --all
#   --all       the order is gone                        -> the panel offers "1 order", and
#                                                           pressing Sync recreates it whole
#
# Locally instead of on the VPS: set PSQL to your own connection, e.g.
#   PSQL="psql -d egfulfill" tools/reset-order.sh etsy-123 --all --yes
set -euo pipefail

ID="${1:-}"
MODE=""
GO="no"
for a in "${@:2}"; do
  case "$a" in
    --address) MODE="address" ;;
    --items)   MODE="items" ;;
    --all)     MODE="all" ;;
    --yes)     GO="yes" ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

if [ -z "$ID" ]; then
  sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

# ONE CONCRETE ORDER. No wildcard, no pattern, no list — every way this becomes a mass
# delete goes through a character that is not in this class.
if ! printf '%s' "$ID" | grep -Eq '^[A-Za-z0-9_-]+$'; then
  echo "refusing: '$ID' is not a single plain order id" >&2
  exit 2
fi

# Default to talking to the api container's database the way everything else on the box does.
# `docker compose exec -T` because this script is not a terminal.
PSQL="${PSQL:-docker compose exec -T db psql -U egfulfill -d egfulfill}"
psql_q() { $PSQL -v ON_ERROR_STOP=1 -qtA -c "$1"; }

exists=$(psql_q "select count(*) from orders where id = '$ID'")
if [ "$exists" = "0" ]; then
  echo "No order '$ID'. Nothing to do."
  exit 0
fi

echo "── $ID ────────────────────────────────────────────"
$PSQL -c "select id, seller_id, store, source, status, factory_status, total, tracking,
                 (address->>'street') as street, meta->>'reader' as reader
            from orders where id = '$ID'"
# COLUMNS THAT EXIST IN schema.sql ONLY. `line_id` is added at ROUTE LOAD, not in the base
# schema (CLAUDE.md §6), so naming it here makes this script fail on any database that has
# not had the API booted against it — including a fresh one you spun up to test with. It is
# shown when it is there, via to_jsonb, which cannot fail on a missing column.
$PSQL -c "select sku, name, qty, variant, to_jsonb(t) ->> 'line_id' as line_id
            from order_items t where order_id = '$ID' order by sku"

# THE TWO FACTS THAT MAKE A DELETE UNSAFE, checked before anything is offered.
charged=$(psql_q "select coalesce(count(*),0) from wallet_ledger where ref = '$ID'")
shipped=$(psql_q "select count(*) from orders where id = '$ID' and (tracking is not null or factory_status = 'shipped')")

if [ "$charged" != "0" ]; then
  echo
  echo "!! $charged wallet_ledger row(s) reference this order."
  echo "!! That ledger is APPEND-ONLY. Deleting the order leaves a charge nobody can explain,"
  echo "!! and the seller stays charged. Pick a different order to test with."
fi
if [ "$shipped" != "0" ]; then
  echo
  echo "!! This order has tracking or is shipped. It is a real parcel; leave it alone."
fi

echo
case "$MODE" in
  address) echo "WOULD: blank orders.address" ;;
  items)   echo "WOULD: delete order_items, order_designs, order_threads for this order" ;;
  all)     echo "WOULD: delete the order AND its items, designs and threads" ;;
  *)       echo "No mode given. Pass --address, --items or --all to see what each would do."; exit 0 ;;
esac

if [ "$GO" != "yes" ]; then
  echo "Dry run — nothing changed. Add --yes to actually do it."
  exit 0
fi
if { [ "$charged" != "0" ] || [ "$shipped" != "0" ]; } && [ "$MODE" = "all" ]; then
  echo "Refusing --all on a charged or shipped order. Use --address on it, or pick another." >&2
  exit 1
fi

case "$MODE" in
  address)
    psql_q "update orders set address = '{}'::jsonb, updated_at = now() where id = '$ID'" >/dev/null
    echo "Address blanked. The extension should now offer 1 address on that page."
    ;;
  items|all)
    # One transaction: a half-removed order is worse than either end state.
    $PSQL -v ON_ERROR_STOP=1 -q <<EOF
begin;
delete from order_items   where order_id = '$ID';
delete from order_designs where order_id = '$ID';
delete from order_threads where order_id = '$ID';
$( [ "$MODE" = "all" ] && echo "delete from orders where id = '$ID';" )
commit;
EOF
    if [ "$MODE" = "all" ]; then
      echo "Order removed. The extension should now offer 1 order on that page."
    else
      echo "Lines removed, order kept."
    fi
    ;;
esac
