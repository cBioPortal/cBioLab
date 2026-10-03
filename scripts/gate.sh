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

echo "== $(git branch --show-current 2>/dev/null || echo detached) @ $(git rev-parse --short HEAD)$([ -n "$(git status --porcelain)" ] && echo ' + uncommitted changes') =="
echo "== build (-> $NEXT_DIST_DIR) ==" && npm run build 2>&1 | tail -3
echo "== unit =="                      && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
echo "== e2e =="
fuser -k $PORT/tcp 2>/dev/null || true
sleep 2
# a throwaway login for this run: saved cohorts and analyses need one (lib/auth.ts)
export LOGIN_PASSWORD="gate-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
# and no Postgres: saved cohorts and custom data go to the server's in-memory store, so a gate run
# never writes to the real Supabase tables. An empty value is kept by Next (it does not
# overwrite a variable that is already set from .env.local), and the stores treat it as unset.
(SUPABASE_DB_URL= npm start -- -p $PORT >/tmp/gate-server.log 2>&1 &)
for _ in $(seq 1 40); do curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/analysis" && break; sleep 3; done
set +e; E2E_PORT=$PORT E2E_LOGIN_PASSWORD=$LOGIN_PASSWORD node e2e.cjs; RC=$?; set -e
fuser -k $PORT/tcp 2>/dev/null || true
exit $RC
