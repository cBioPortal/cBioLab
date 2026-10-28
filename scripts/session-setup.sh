#!/bin/bash
# Set up a session: its own folder, its own branch, and a dev server on a stable
# port that always reflects the folder.
#
# THE ARRANGEMENT, and why it is this way:
#
#   <folder>   a git worktree — one per session, so two sessions never write
#              the same files
#   <branch>   checked out only in that worktree, so history stays separate
#   <port>     `next dev`, kept alive, serving THAT folder. Dev compiles from
#              the filesystem on demand, so the URL always shows what is in
#              the folder — no build to run, none to forget. Serving a
#              production build from a folder that is also built in is what
#              silently broke the tailnet instance three times: each build
#              rewrote the chunk hashes and deleted the ones the running
#              server still referenced.
#
# `npm run build` / the e2e gate run IN THIS SAME FOLDER via `scripts/gate.sh`,
# which sets NEXT_DIST_DIR=.next-gate so the build doesn't touch the `.next`
# the dev server owns — a separate "-gate" worktree used to exist for this and
# was removed as redundant (1.2G to solve what a config value solves). Do not
# recreate it. Run gate.sh manually before commit/push, not after every edit —
# it's a real build + the full ~110-check Playwright suite, too slow for a
# per-edit habit. While iterating: `next dev` (hot reload) + `npm test` (fast,
# no build).
#
# Folders live under ~/projects/cbio-next-<name>/ (the orchestrator convention
# in ~/projects/CLAUDE.md), not as siblings of ~/cBio-next, so a session's
# worktree and generated CLAUDE.md stay together and a project can be torn
# down as one unit.
#
# Tailnet exposure is separate and stable: `tailscale serve` maps 8446 -> 3102
# and 8447 -> 3107. Pick a port that already has a mapping, or add one with
#   tailscale serve --bg --https <ext> http://127.0.0.1:<port>
#
# Usage:  scripts/session-setup.sh <name> <port> [gate-port] [base-ref]
set -euo pipefail
NAME="${1:?usage: session-setup.sh <name> <port> [gate-port] [base-ref]}"
PORT="${2:?need a port, e.g. 3106}"
GATE_PORT="${3:-$((PORT + 1000))}"
BASE="${4:-origin/master}"
ROOT="$(cd "$(dirname "$0")/.." && git rev-parse --show-toplevel)"
PROJECT_DIR="$HOME/projects/cbio-next-$NAME"
DIR="$PROJECT_DIR/cohort-lab"
BRANCH="session/$NAME"

for p in "$PORT" "$GATE_PORT"; do
  if ss -ltn 2>/dev/null | grep -q ":$p "; then
    echo "port $p is already in use — pick a free one (check: ss -ltn | grep LISTEN)" >&2
    exit 1
  fi
done

mkdir -p "$PROJECT_DIR"
git -C "$ROOT" fetch -q origin || true
git -C "$ROOT" worktree add -b "$BRANCH" "$DIR" "$BASE"
cp "$ROOT/.env.local" "$DIR/.env.local"
( cd "$DIR" && npm ci --no-audit --no-fund )

sed "s/3102/$PORT/g" "$ROOT/serve-3102.sh" > "$DIR/serve-$PORT.sh"
# Federation for the dev server: set in its own script, not in .env.local, so a gate run in the same
# folder keeps its own address (lib/loopback-peer.ts calls PORT's /api/federation/v1).
if ! grep -q LOOPBACK_PEER "$DIR/serve-$PORT.sh"; then
  sed -i "/^cd \"\$(dirname \"\$0\")\"/r /dev/stdin" "$DIR/serve-$PORT.sh" <<FED
# Federation: the second database (CLICKHOUSE2_*) is served to this app as a simulated peer at
# its own /api/federation/v1 (lib/loopback-peer.ts), patient timelines and alterations disclosed to
# the app alone. Here rather than in .env.local, so a gate run in this folder keeps its own address.
export PORT=$PORT LOOPBACK_PEER=b FEDERATION_DISCLOSE_PATIENTS='*:timeline+alterations+oncoprint' FEDERATION_ACCEPT_PATIENT_LEVEL='*:timeline+alterations+oncoprint'
FED
  grep -q LOOPBACK_PEER "$DIR/serve-$PORT.sh" || echo "WARNING: serve-$PORT.sh has no 'cd \"\$(dirname \"\$0\")\"' line; its dev server does not federate" >&2
fi
chmod +x "$DIR/serve-$PORT.sh"
( cd "$DIR" && setsid "./serve-$PORT.sh" >/dev/null 2>&1 & )

cat > "$PROJECT_DIR/CLAUDE.md" <<EOF
# cbio-next session: $NAME

Base repo is \`~/cBio-next\` — **never edit it or \`~/cBio-next-master\`**, and never delete it
while worktrees exist. Read \`~/cBio-next/HANDOFF.local.md\` first, then this folder's own
\`cohort-lab/CLAUDE.md\` for architecture and invariants. Rebase \`$BRANCH\` on \`origin/master\`
regularly.

| | |
|---|---|
| folder | \`$DIR\` |
| branch | \`$BRANCH\` |
| dev server | \`http://127.0.0.1:$PORT\` — started by \`$DIR/serve-$PORT.sh\`, reflects this folder live |
| gate port | \`$GATE_PORT\` — this session's dedicated ephemeral port for \`scripts/gate.sh\`'s e2e run |

**Never run \`npm run build\` or \`npm start\` in \`$DIR\` directly** — this folder's \`next dev\`
owns \`.next\`, and a build here rewrites and deletes the content-hashed chunks the running dev
server references, silently breaking it (client JS 404s, page falls back to a server render,
nothing logs an error). Only run builds through \`scripts/gate.sh\`, which builds to \`.next-gate\`
instead so it can't touch the dev server's \`.next\`.

**E2E cadence — run it manually, not on every edit.** \`scripts/gate.sh\` builds + runs unit
tests + the full ~110-check Playwright e2e suite; it's slow (real build, real browser) and is a
pre-commit/pre-push gate, not a per-edit habit. While iterating: rely on \`next dev\`'s hot reload
for visual changes and \`npm test\` (fast, no build) for logic changes. Run it once, right before
you commit and push a finished piece of work:
\`\`\`
cd $DIR && GATE_PORT=$GATE_PORT scripts/gate.sh
\`\`\`
\`GATE_PORT\` matters when other cbio-next sessions might be gating at the same time — gate.sh
defaults to port 3100, and two concurrent gate runs on the same port will kill each other's
server mid-suite. This session's port ($GATE_PORT) is reserved for it; don't reuse it elsewhere.

Cleanup when this session ends:
\`\`\`
git -C ~/cBio-next worktree remove $DIR
rm -rf $PROJECT_DIR
\`\`\`
EOF

for _ in $(seq 1 40); do curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/analysis" && break; sleep 5; done
echo
echo "project  : $PROJECT_DIR"
echo "folder   : $DIR"
echo "branch   : $BRANCH"
echo "dev      : http://127.0.0.1:$PORT  — reflects $DIR live"
echo "status   : $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT/analysis")"
echo "gate cmd : cd $DIR && GATE_PORT=$GATE_PORT scripts/gate.sh   (run before commit/push only)"
