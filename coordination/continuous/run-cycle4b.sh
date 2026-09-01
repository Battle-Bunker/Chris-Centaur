#!/usr/bin/env bash
# CONTINUOUS CYCLE 4b — hazard dose-response, rerun on bundle b5 (toll-fix tip).
# Waits for the box to clear of sibling run-sweep/run-pair processes first.
set -euo pipefail
SP=/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad
KIT=$SP/ppkit
export KIT

echo "[wait] for box to clear of sibling run-sweep/run-pair processes..."
while pgrep -f 'run-sweep\.js|run-pair\.js' >/dev/null 2>&1; do
  sleep 30
done
echo "[wait] box clear at $(date -u +%FT%TZ)"

cd "$KIT"
node "$SP/continuous/specs/mkdose.js" 24 200 21 80 4201 "$SP/continuous/specs/k4-hazdose.json"
node tools/simworker/bin/run-pair.js \
  --batch "$SP/continuous/k4" \
  --spec "$SP/continuous/specs/k4-hazdose.json" \
  --arm nullA="$SP/ppruns/b5" \
  --arm nullB="$SP/ppruns/b5" \
  --workers 2 \
  --note "continuous cycle 4 rerun (b5, cluster-lookahead@79b5f5e, toll fix): hazard dose-response. k1+k2 found potionOrder -0.145 [-0.258,-0.035] on the interior-hazard cell, null on two hazard-free cells; k5 (potion-value sweep) found the prize itself null at effectTurns 3/8/20 even with hazards off. This cell: damageRatio 0.05/0.15/0.30, everything else fixed. Monotone harm rising with damage confirms the chase-into-hazard mechanism; a flat profile kills it."
echo "[cycle4b] DONE"
