#!/usr/bin/env bash
# CONTINUOUS CYCLE 3 — the piece-cell floor, characterized (queue item 3).
# 48 blocks on ONE knight cell so the floor can be plotted against block count
# instead of assumed. Two identical arms; the channel-ladder contenders ride
# along, so the games also add a piece-cell rung to item 1 if the floor proves
# sound. See specs/mkknight.js for the three hypotheses this separates.
set -euo pipefail
SP=/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad
KIT=$SP/ppkit
export KIT
cd "$KIT"
node "$SP/continuous/specs/mkknight.js" 48 200 21 80 4101 "$SP/continuous/specs/k3-piecefloor.json"
node tools/simworker/bin/run-pair.js \
  --batch "$SP/continuous/k3" \
  --spec "$SP/continuous/specs/k3-piecefloor.json" \
  --arm nullA="$SP/ppruns/b4" \
  --arm nullB="$SP/ppruns/b4" \
  --workers 2 \
  --note "continuous cycle 3: the piece-cell floor. 48 blocks on one knight cell, two identical arms, so floorscale.js can plot the A/A floor against block count and armservice.js can test the CPU-service explanation. Three runs have produced piece cells whose A/A interval excludes zero; this separates board width from a heavy tail from unequal service."
