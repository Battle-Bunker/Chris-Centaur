#!/usr/bin/env bash
# CONTINUOUS CYCLE 4 — the hazard dose-response for the potion-ordering harm.
set -euo pipefail
SP=/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad
KIT=$SP/ppkit
export KIT
cd "$KIT"
node "$SP/continuous/specs/mkdose.js" 24 200 21 80 4201 "$SP/continuous/specs/k4-hazdose.json"
node tools/simworker/bin/run-pair.js \
  --batch "$SP/continuous/k4" \
  --spec "$SP/continuous/specs/k4-hazdose.json" \
  --arm nullA="$SP/ppruns/b4" \
  --arm nullB="$SP/ppruns/b4" \
  --workers 2 \
  --note "continuous cycle 4: hazard dose-response. k1+k2 found potionOrder -0.145 [-0.258,-0.035] against plain on the interior-hazard cell and nothing on two hazard-free cells; the proposed mechanism is that sorting a pickup as a gain walks units across hazard cells. Same cell at damageRatio 0.00 / 0.15 / 0.30, everything else fixed. Monotone harm rising with damage confirms it; a flat profile kills it."
