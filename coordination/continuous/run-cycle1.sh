#!/usr/bin/env bash
# CONTINUOUS CYCLE 1 — the channel ladder (queue item 1).
# Builds bundle b4 from tmp/potionplay@7f89a74 (the pickup ordering slot),
# then runs plain / potionOrder / potionBoth, three in one game, two
# identical arms, 24 blocks, two snake cells.
set -euo pipefail
SP=/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad
KIT=$SP/ppkit
export KIT

cd "$KIT"
if [ ! -f "$SP/ppruns/b4/harness/build/bin/match-worker.js" ]; then
  echo "== building b4 from 7f89a74"
  tools/simworker/build-bot.sh 7f89a74 "$SP/ppruns/b4" --force
fi

echo "== writing spec"
node "$SP/continuous/specs/mkchannel.js" 24 200 21 80 4001 "$SP/continuous/specs/k1-channel.json"

echo "== launching pair"
node tools/simworker/bin/run-pair.js \
  --batch "$SP/continuous/k1" \
  --spec "$SP/continuous/specs/k1-channel.json" \
  --arm nullA="$SP/ppruns/b4" \
  --arm nullB="$SP/ppruns/b4" \
  --workers 2 \
  --note "continuous cycle 1: the CHANNEL ladder — the potion doctrine split into its advice (candidates.potionOrdering, zero evaluator cost) and its price (the potion-aware advisory lineup). Chosen by c1's mechanism row: the potion-aware bot evaluated 28-44% fewer plans per decision than plain inside the same budget."
