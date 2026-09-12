#!/bin/bash
# Run the full gate WITHOUT touching the session folder.
#
# WHY THIS EXISTS. The session folder is served live by `next dev` on a stable
# port (see ../serve-3102.sh), and `next dev` and `next build` share .next/.
# Building in the session folder therefore fights the dev server — which is the
# same class of problem, differently shaped, as the one that broke the tailnet
# instance three times by deleting the chunks it was serving.
#
# So the gate runs in a sibling worktree pinned to this folder's current commit.
# Uncommitted work is NOT gated: commit first, or pass --dirty to copy the
# working tree across.
#
# Usage:  scripts/gate.sh [--dirty]
set -euo pipefail
SESSION="$(cd "$(dirname "$0")/.." && pwd)"
GATE="${SESSION}-gate"
PORT=3100

[ -d "$GATE" ] || { echo "no gate worktree at $GATE — create it with:"; \
  echo "  git worktree add --detach $GATE HEAD"; exit 1; }

cd "$SESSION"
if [ "${1:-}" = "--dirty" ]; then
  echo "== syncing working tree (including uncommitted changes) =="
  rsync -a --delete --exclude .git --exclude node_modules --exclude .next \
    --exclude server-analysis.log "$SESSION/" "$GATE/"
else
  [ -z "$(git status --porcelain)" ] || { echo "working tree is dirty; commit or use --dirty"; exit 1; }
  SHA="$(git rev-parse HEAD)"
  echo "== syncing gate worktree to $SHA =="
  git -C "$GATE" checkout -q --detach "$SHA"
fi

cd "$GATE"
[ -d node_modules ] || npm ci --no-audit --no-fund
[ -f .env.local ] || cp "$SESSION/.env.local" .env.local

echo "== build =="   && npm run build 2>&1 | tail -3
echo "== unit =="    && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
echo "== e2e =="
fuser -k $PORT/tcp 2>/dev/null || true
sleep 2
(npm start -- -p $PORT >/tmp/gate-server.log 2>&1 &)
for _ in $(seq 1 40); do curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/analysis" && break; sleep 3; done
node e2e.cjs; RC=$?
fuser -k $PORT/tcp 2>/dev/null || true
exit $RC
