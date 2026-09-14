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
# Usage:  scripts/gate.sh
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
export NEXT_DIST_DIR=.next-gate
PORT=3100

echo "== $(git branch --show-current 2>/dev/null || echo detached) @ $(git rev-parse --short HEAD)$([ -n "$(git status --porcelain)" ] && echo ' + uncommitted changes') =="
echo "== build (-> $NEXT_DIST_DIR) ==" && npm run build 2>&1 | tail -3
echo "== unit =="                      && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
echo "== e2e =="
fuser -k $PORT/tcp 2>/dev/null || true
sleep 2
(npm start -- -p $PORT >/tmp/gate-server.log 2>&1 &)
for _ in $(seq 1 40); do curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/analysis" && break; sleep 3; done
set +e; node e2e.cjs; RC=$?; set -e
fuser -k $PORT/tcp 2>/dev/null || true
exit $RC
