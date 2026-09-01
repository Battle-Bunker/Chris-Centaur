#!/usr/bin/env bash
# CONTINUOUS CYCLE 5 — the potion-value sweep (queue item 9).
set -euo pipefail
SP=/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad
KIT=$SP/ppkit
export KIT
cd "$KIT"
node "$SP/continuous/specs/mkpotval.js" 24 200 21 80 4301 "$SP/continuous/specs/k5-potvalue.json"
node tools/simworker/bin/run-pair.js \
  --batch "$SP/continuous/k5" \
  --spec "$SP/continuous/specs/k5-potvalue.json" \
  --arm nullA="$SP/ppruns/b4" \
  --arm nullB="$SP/ppruns/b4" \
  --workers 2 \
  --note "continuous cycle 5: the potion-value sweep. The collecting capability is built and working (potionOrdering collects 22-45% more potions at zero search cost) but the prize is too small to move sharePar. effectTurns 3/8/20, hazards OFF so the hazard interaction cannot confound it. Finds where collecting potions starts to pay, or shows that it never does."
