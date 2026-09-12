#!/bin/bash
# Set up a session: its own folder, its own branch, and a dev server on a stable
# port that always reflects the folder.
#
# THE ARRANGEMENT, and why it is this way:
#
#   <folder>        a git worktree — one per session, so two sessions never
#                   write the same files
#   <branch>        checked out only in that worktree, so history stays separate
#   <port>          `next dev`, kept alive, serving THAT folder. Dev compiles
#                   from the filesystem on demand, so the URL always shows what
#                   is in the folder — no build to run, none to forget. Serving
#                   a production build from a folder that is also built in is
#                   what silently broke the tailnet instance three times: each
#                   build rewrote the chunk hashes and deleted the ones the
#                   running server still referenced.
#   <folder>-gate   a sibling worktree for `npm run build` + e2e, because dev
#                   and build share .next/ and must not share a directory.
#                   See scripts/gate.sh.
#
# Tailnet exposure is separate and stable: `tailscale serve` maps 8446 -> 3102
# and 8447 -> 3107. Pick a port that already has a mapping, or add one with
#   tailscale serve --bg --https <ext> http://127.0.0.1:<port>
#
# Usage:  scripts/session-setup.sh <name> <port> [base-ref]
set -euo pipefail
NAME="${1:?usage: session-setup.sh <name> <port> [base-ref]}"
PORT="${2:?need a port, e.g. 3102}"
BASE="${3:-origin/master}"
ROOT="$(cd "$(dirname "$0")/.." && git rev-parse --show-toplevel)"
DIR="$(dirname "$ROOT")/cBio-next-$NAME"
BRANCH="session/$NAME"

git -C "$ROOT" fetch -q origin || true
git -C "$ROOT" worktree add -b "$BRANCH" "$DIR" "$BASE"
git -C "$ROOT" worktree add --detach "$DIR-gate" "$BASE"
cp "$ROOT/.env.local" "$DIR/.env.local"
cp "$ROOT/.env.local" "$DIR-gate/.env.local"
( cd "$DIR" && npm ci --no-audit --no-fund )

sed "s/3102/$PORT/g" "$ROOT/serve-3102.sh" > "$DIR/serve-$PORT.sh"
chmod +x "$DIR/serve-$PORT.sh"
( cd "$DIR" && setsid "./serve-$PORT.sh" >/dev/null 2>&1 & )

for _ in $(seq 1 40); do curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/analysis" && break; sleep 5; done
echo
echo "folder : $DIR"
echo "branch : $BRANCH"
echo "gate   : $DIR-gate   (scripts/gate.sh)"
echo "dev    : http://127.0.0.1:$PORT  — reflects $DIR live"
echo "status : $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT/analysis")"
