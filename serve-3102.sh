#!/bin/sh
# Keep the tailnet-facing app (https://…:8446 -> 127.0.0.1:3102) alive.
#
# This box runs several heavy dev servers and sits near its memory ceiling, so a
# long-lived idle next-server is a plausible OOM victim — and a gate run (build +
# Playwright + node --test) is exactly the kind of spike that triggers one. It is
# also killed deliberately by `fuser -k 3102/tcp` during rebuilds. Either way the
# fix is the same: come straight back.
#
# Stop it with:  pkill -f serve-3102.sh   (then fuser -k 3102/tcp)
cd "$(dirname "$0")" || exit 1
while true; do
  echo "[keepalive] starting $(date -Is)" >> server-analysis.log
  NODE_OPTIONS=--max-old-space-size=640 npx next start -p 3102 -H 127.0.0.1 >> server-analysis.log 2>&1
  echo "[keepalive] exited rc=$? at $(date -Is); restarting in 3s" >> server-analysis.log
  sleep 3
done
