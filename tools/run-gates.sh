#!/usr/bin/env bash
# EVERY GATE, ONE COMMAND — for CI and for the person about to push.
#
# There are 31 files matching tools/check-*.mjs and nothing ran them together. A gate nobody
# runs is a comment with a shebang: the §2.9 leaks fixed on 2026-09-23 were all found by
# EXECUTING a check, and all three had been shipped by sessions that had read the rule.
#
# DISCOVERED, NOT LISTED. A registry of gates is one more thing to forget to update, and the
# gates are named by convention already. A new tools/check-*.mjs is picked up by existing it.
#
# KNOWN-RED IS NAMED WITH A REASON, never skipped quietly. A gate that fails today and is
# silently excluded is worse than no gate, because the exclusion outlives the reason. Anything
# in ALLOW_FAIL still RUNS and still prints; it just cannot fail the build — and it is listed
# at the end so the list itself stays uncomfortable.
#
#   ./tools/run-gates.sh            every gate
#   ./tools/run-gates.sh api        only gates whose name matches "api"
#   STRICT=1 ./tools/run-gates.sh   ALLOW_FAIL is ignored; everything must pass
set -uo pipefail
cd "$(dirname "$0")/.."

# Each entry is `name: why it is red`. Fix one → delete its line. That is the whole process.
ALLOW_FAIL_REASONS=$(cat <<'REASONS'
check-line-method: 4 pass / 2 fail — pre-existing, in the line-method area, not investigated here
check-order-rules: crashes on load — pre-existing, needs its own fix before it can gate anything
check-pop-presets: 1 of 2 presets misses the ink contrast floor — a palette decision, not a regression
check-face-fee-gate: needs FEE_GATE_DATABASE_URL pointed at a THROWAWAY database; exits 2 without it
REASONS
)
allowed() { echo "$ALLOW_FAIL_REASONS" | grep -q "^$1:"; }

# TWO GATES MUST NOT SHARE A PORT.
#
# Found the hard way on the first full run: check-public-api and check-listing-templates both
# used 4141, check-catalog-img-refs and check-surface-delta both used 4139. Alone each passed;
# in sequence a lingering listener made the next one fail to bind, so the FAILING GATE MOVED
# from run to run — the exact shape that teaches people a suite is flaky and can be ignored.
# Checked before anything runs, because a suite you cannot trust is worse than none.
# The VALUE only. `grep -oE "[0-9]+"` reads every number on the line, so a comment saying
# "was 4139" counted as a second claim on 4139 and this refused to run over nothing — caught
# on its own first execution.
dupes=$(sed -nE 's/^const PORT = ([0-9]+).*/\1/p' tools/check-*.mjs | sort | uniq -d)
if [ -n "$dupes" ]; then
  echo "REFUSING TO RUN — these ports are claimed by more than one gate:"
  for p in $dupes; do
    echo "  $p:"; grep -lE "^const PORT = $p([^0-9]|$)" tools/check-*.mjs | sed "s/^/    /"
  done
  echo "Give each gate its own port; they run back to back and a shared one fails whichever loses the race."
  exit 2
fi

FILTER="${1:-}"
PER_GATE_TIMEOUT="${PER_GATE_TIMEOUT:-300}"
pass=0; fail=0; softfail=0; failed=""
for f in tools/check-*.mjs; do
  name=$(basename "$f" .mjs)
  [ -n "$FILTER" ] && case "$name" in *"$FILTER"*) ;; *) continue ;; esac
  printf '\n\033[1m── %s\033[0m\n' "$name"
  # No `timeout` on macOS by default; perl's alarm is everywhere both CI and a laptop are.
  perl -e 'alarm shift; exec @ARGV' "$PER_GATE_TIMEOUT" node "$f"
  code=$?
  if [ $code -eq 0 ]; then
    pass=$((pass+1))
  elif [ -z "${STRICT:-}" ] && allowed "$name"; then
    softfail=$((softfail+1)); echo "   ^ known-red, not failing the build — see ALLOW_FAIL_REASONS in $0"
  else
    fail=$((fail+1)); failed="$failed $name"
  fi
done

echo
echo "───────────────────────────────────────────────"
echo "  green: $pass    known-red: $softfail    FAILED: $fail"
[ -n "$failed" ] && echo " failed:$failed"
if [ $softfail -gt 0 ]; then
  echo
  echo "  known-red, still running, still printing:"
  echo "$ALLOW_FAIL_REASONS" | sed 's/^/    /'
fi
[ $fail -eq 0 ] || exit 1
