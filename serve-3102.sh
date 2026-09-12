#!/bin/sh
# The DEV server for this session's folder, on the stable port behind
# https://vps-870e202d.tailf02841.ts.net:8446 (tailscale serve maps 8446 -> 3102).
#
# WHY `next dev` AND NOT `next start`. This used to run a production build from
# this same directory, and every `npm run build` rewrote the chunk hashes and
# deleted the old ones — so the running server's manifest pointed at files that
# no longer existed, the client JS never loaded, and the page silently fell back
# to a server render on every interaction. It broke three times that way.
# `next dev` compiles from the filesystem on demand, so the port always reflects
# whatever is in this folder. There is no build step to forget.
#
# COROLLARY: do NOT run `npm run build` in this directory. dev and build share
# .next/ and will fight. Gate builds belong in ../cBio-next-gate.
#
# Restarts on exit because this box sits near its memory ceiling and a
# long-lived server is a plausible OOM victim.
#
# Stop it with:  kill <this pid>   (find it with: ps -o pid,args -C sh | grep 3102)
cd "$(dirname "$0")" || exit 1
while true; do
  echo "[dev] starting $(date -Is)" >> server-analysis.log
  NODE_OPTIONS=--max-old-space-size=1024 npx next dev -p 3102 -H 127.0.0.1 >> server-analysis.log 2>&1
  echo "[dev] exited rc=$? at $(date -Is); restarting in 3s" >> server-analysis.log
  sleep 3
done
