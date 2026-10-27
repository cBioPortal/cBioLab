#!/bin/bash
# Run the full gate — build, unit tests, e2e — in THIS folder, without
# disturbing the `next dev` server that serves it.
#
# The constraint is a shared directory, not a shared folder: `next dev` owns
# `.next`, so the build here goes to `.next-gate` via NEXT_DIST_DIR and the two
# coexist. (Serving a production build from a directory that is also built in is
# what silently broke the tailnet instance three times — each build rewrote the
# chunk hashes and deleted the ones the running server still referenced.)
#
# This used to run in a sibling worktree, which cost 1.2G to solve the same
# problem a config value solves.
#
# PORT defaults to 3100 but is overridable via GATE_PORT — needed so two
# sessions gating around the same time don't kill each other's e2e server
# mid-suite (fuser -k below would otherwise hit whichever session's server got
# there first).
#
# Usage:  scripts/gate.sh   (or  GATE_PORT=4100 scripts/gate.sh)
#
# With no argument it runs every stage. CI runs it as parallel jobs, one lane each, and the lanes
# together are the whole gate:
#   scripts/gate.sh local       unit, Postgres, planted sharing bugs, the Python port (no warehouse)
#   scripts/gate.sh warehouse   the checks that query the warehouse and cbioportal.org from a script
#   scripts/gate.sh e2e         build, then the browser suite and federation against that build
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
export NEXT_DIST_DIR=.next-gate
PORT="${GATE_PORT:-3100}"
LANE="${1:-all}"
case "$LANE" in all|local|warehouse|e2e) ;; *) echo "usage: scripts/gate.sh [local|warehouse|e2e]"; exit 2 ;; esac
# Each stage prints a summary here; under CI (GitHub Actions sets CI=true) it prints its whole log,
# which is what a failed run needs to be diagnosed from.
summary() { if [ -n "${CI:-}" ]; then cat; else "$@"; fi; }
# every "== phase ==" line carries the wall clock and the seconds since the previous phase began
T0=$(date +%s); TP=$T0
phase() { local t; t=$(date +%s); echo "== $* == [$(date +%H:%M:%S) +$((t - TP))s, total $((t - T0))s]"; TP=$t; }

# the venv: lint runs ruff from it, and /oncoprint-lab/cli runs this interpreter and draws with
# matplotlib, so a venv without the plot extra would turn that page's "not present" note into a traceback
python_venv() {
  phase "python venv"
  [ -d python/.venv ] || python3 -m venv python/.venv
  python/.venv/bin/pip install -q -e 'python[plot,dev]'
}

build() {
  phase "build (-> $NEXT_DIST_DIR)" && npm run build 2>&1 | summary tail -3
  # A GET route that never reads the request is prerendered at build time under Cache Components, and
  # then answers every request with what the build saw (no LOGIN_PASSWORD, no warehouse). Only these
  # routes are static on purpose; any other prerendered API response is that bug.
  local STATIC_API="api/version api/campaign/format" prerendered unexpected
  prerendered=$(cd "$NEXT_DIST_DIR/server/app" && find api -name '*.body' | sed 's/\.body$//' | sort)
  unexpected=$(comm -23 <(echo "$prerendered") <(tr ' ' '\n' <<<"$STATIC_API" | sort))
  if [ -n "$unexpected" ]; then
    echo "FAIL API routes prerendered at build time (call connection() from next/server first):"; echo "$unexpected"; exit 1
  fi
}

local_checks() {
  phase "unit"                      && npm test 2>&1 | summary grep -E "^# (tests|pass|fail)"
  phase "postgres (stores, migrations, triggers)" && npm run test:db 2>&1 | summary grep -E "^# (tests|pass|fail)"
  phase "access (planted sharing bugs)" && npm run check:access-mutants 2>&1 | summary grep -E "SURVIVED|planted access bugs"
  phase "python conformance (lib/oncoprint-*.ts vs python/cohortlab)"
  python/.venv/bin/python -m unittest discover -s python/tests -v 2>&1 | summary tail -20
}

# asserts a wall-clock budget, so it never runs beside other stages of the same gate
splitby_cost() {
  phase "splitBy cost"              && npm run check:splitby-perf 2>&1 | summary grep -E "^FAIL|checks passed|FAILED"
}

# The checks that query the warehouse (and cbioportal.org) from a script, without a server.
warehouse_checks() {
  phase "counts against cBioPortal" && npm run check:portal 2>&1 | summary grep -E "^FAIL|comparisons"
  phase "cohort logic"              && npm run check:cohorts 2>&1 | summary grep -E "^FAIL|cohort-logic checks"
  phase "pooled paths, independent counts" && npm run check:pooled 2>&1 | summary grep -E "^FAIL|pooled checks"
  # every gallery example run once: they run, give their pinned counts (docs:check), and their method
  # scripts reproduce them (check:methods)
  phase "examples: docs, pinned counts, method scripts" && npm run check:examples 2>&1 | summary grep -E "^FAIL|method records present|FAILED"
  phase "denominators"              && npm run check:denominators 2>&1 | summary grep -E "^FAIL|checks passed|FAILED"
  phase "gene facets"               && npm run check:genefacets 2>&1 | summary grep -E "^FAIL|checks passed|FAILED"
  phase "value folding"             && npm run check:values 2>&1 | summary grep -E "^FAIL|checks passed|FAILED"
  phase "warehouse checks done"
}

# the browser suite against the build, then federation; sets RC rather than stopping at a failure
e2e() {
  phase "e2e"
  fuser -k $PORT/tcp >/dev/null 2>&1 || true
  sleep 2
  # the development sign-in for this run: saved cohorts and analyses need someone signed in (lib/auth.ts)
  export AUTH_DEV_LOGIN=1
  # and no Postgres: saved cohorts and custom data go to the server's own in-memory Postgres
  # (lib/db.ts), so a gate run starts empty and never writes to the real database. An empty value
  # is kept by Next (it does not overwrite a variable that is already set from .env.local), and
  # lib/db.ts treats it as unset.
  (DATABASE_URL= SUPABASE_DB_URL= npm start -- -p $PORT >/tmp/gate-server-$PORT.log 2>&1 &)
  for _ in $(seq 1 40); do curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/lab" && break; sleep 3; done
  set +e; E2E_PORT=$PORT E2E_LOGIN_EMAIL=e2e@gate.test node e2e.cjs; RC=$?; set -e
  fuser -k $PORT/tcp >/dev/null 2>&1 || true
  # Patient-level federation: the same build restarted with its second database served to itself as a
  # simulated peer through its own federation API (lib/loopback-peer.ts), both sides' rules allowing timelines and alterations.
  # Skipped, and said so, where no second database is configured.
  if [ -n "${CLICKHOUSE2_URL:-}" ] || grep -q '^CLICKHOUSE2_URL=.' .env.local 2>/dev/null; then
    phase "e2e: federation (simulated peer)"
    sleep 2
    (DATABASE_URL= SUPABASE_DB_URL= PORT=$PORT LOOPBACK_PEER=b FEDERATION_DISCLOSE_PATIENTS='*:timeline+alterations' FEDERATION_ACCEPT_PATIENT_LEVEL='*:timeline+alterations' \
      npm start -- -p $PORT >/tmp/gate-server-fed-$PORT.log 2>&1 &)
    for _ in $(seq 1 40); do curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/lab" && break; sleep 3; done
    set +e; E2E_PORT=$PORT node scripts/e2e-federation.cjs; FRC=$?; set -e
    fuser -k $PORT/tcp >/dev/null 2>&1 || true
    [ $RC -eq 0 ] && RC=$FRC
  else
    phase "e2e: federation (simulated peer)"; echo "SKIPPED: no second database (CLICKHOUSE2_*) configured"
  fi
  return 0
}

phase "$(git branch --show-current 2>/dev/null || echo detached) @ $(git rev-parse --short HEAD)$([ -n "$(git status --porcelain)" ] && echo ' + uncommitted changes') [$LANE]"
RC=0
case "$LANE" in
  local)     python_venv; local_checks ;;
  warehouse) splitby_cost; warehouse_checks ;;
  e2e)       python_venv; build; e2e ;;
  all)
    python_venv
    # CI runs lint as a job of its own
    if [ -z "${GATE_SKIP_LINT:-}" ]; then phase "lint (eslint, knip, ruff)" && npm run lint 2>&1 | summary tail -15; fi
    build
    local_checks
    splitby_cost
    # The warehouse checks mostly wait on the network, so by default they run beside e2e, which
    # mostly waits on the browser: several minutes less for a little more memory at peak. Their
    # ClickHouse concurrency is halved (lib/ch.ts) so the two together stay near what one process
    # alone may have in flight. GATE_SERIAL=1 runs them first instead, where the box has no room.
    if [ -n "${GATE_SERIAL:-}" ]; then
      warehouse_checks
      e2e
    else
      WLOG=/tmp/gate-warehouse-$PORT.log
      phase "warehouse checks: started beside e2e, reported after it (log: $WLOG)"
      (CLICKHOUSE_MAX_INFLIGHT=4 warehouse_checks >"$WLOG" 2>&1) & WPID=$!
      trap '{ pkill -P $WPID; kill $WPID; } 2>/dev/null || true' EXIT
      e2e
      phase "warehouse checks (ran beside e2e)"
      set +e; wait $WPID; WRC=$?; set -e
      cat "$WLOG"
      [ $RC -eq 0 ] && RC=$WRC
    fi
    ;;
esac
phase "done"
exit $RC
