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
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
export NEXT_DIST_DIR=.next-gate
PORT="${GATE_PORT:-3100}"
# Each stage prints a summary here; under CI (GitHub Actions sets CI=true) it prints its whole log,
# which is what a failed run needs to be diagnosed from.
summary() { if [ -n "${CI:-}" ]; then cat; else "$@"; fi; }

echo "== $(git branch --show-current 2>/dev/null || echo detached) @ $(git rev-parse --short HEAD)$([ -n "$(git status --porcelain)" ] && echo ' + uncommitted changes') =="
# the venv first: lint runs ruff from it, and /oncoprint-lab/cli runs this interpreter and draws with
# matplotlib, so a venv without the plot extra would turn that page's "not present" note into a traceback
[ -d python/.venv ] || python3 -m venv python/.venv
python/.venv/bin/pip install -q -e 'python[plot,dev]'
# CI runs lint as a job of its own and sets GATE_SKIP_LINT
if [ -z "${GATE_SKIP_LINT:-}" ]; then echo "== lint (eslint, knip, ruff) ==" && npm run lint 2>&1 | summary tail -15; fi
echo "== build (-> $NEXT_DIST_DIR) ==" && npm run build 2>&1 | summary tail -3
# A GET route that never reads the request is prerendered at build time under Cache Components, and
# then answers every request with what the build saw (no LOGIN_PASSWORD, no warehouse). Only these
# routes are static on purpose; any other prerendered API response is that bug.
STATIC_API="api/version api/campaign/format"
prerendered=$(cd "$NEXT_DIST_DIR/server/app" && find api -name '*.body' | sed 's/\.body$//' | sort)
unexpected=$(comm -23 <(echo "$prerendered") <(tr ' ' '\n' <<<"$STATIC_API" | sort))
if [ -n "$unexpected" ]; then
  echo "FAIL API routes prerendered at build time (call connection() from next/server first):"; echo "$unexpected"; exit 1
fi
echo "== unit =="                      && npm test 2>&1 | summary grep -E "^# (tests|pass|fail)"
echo "== postgres (stores, migrations, triggers) ==" && npm run test:db 2>&1 | summary grep -E "^# (tests|pass|fail)"
echo "== counts against cBioPortal ==" && npm run check:portal 2>&1 | summary grep -E "^FAIL|comparisons"
echo "== cohort logic =="              && npm run check:cohorts 2>&1 | summary grep -E "^FAIL|cohort-logic checks"
echo "== method scripts =="            && npm run check:methods 2>&1 | summary grep -E "^FAIL|method records present|FAILED"
echo "== python conformance (lib/oncoprint-*.ts vs python/cohortlab) =="
python/.venv/bin/python -m unittest discover -s python/tests -v 2>&1 | summary tail -20
echo "== e2e =="
fuser -k $PORT/tcp 2>/dev/null || true
sleep 2
# a throwaway login for this run: saved cohorts and analyses need one (lib/auth.ts)
export LOGIN_PASSWORD="gate-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
# and no Postgres: saved cohorts and custom data go to the server's in-memory store, so a gate run
# never writes to the real Supabase tables. An empty value is kept by Next (it does not
# overwrite a variable that is already set from .env.local), and the stores treat it as unset.
(SUPABASE_DB_URL= npm start -- -p $PORT >/tmp/gate-server.log 2>&1 &)
for _ in $(seq 1 40); do curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/lab" && break; sleep 3; done
set +e; E2E_PORT=$PORT E2E_LOGIN_PASSWORD=$LOGIN_PASSWORD node e2e.cjs; RC=$?; set -e
fuser -k $PORT/tcp 2>/dev/null || true
exit $RC
