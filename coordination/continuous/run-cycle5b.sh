#!/usr/bin/env bash
# CONTINUOUS CYCLE 5b — potion-value sweep, bundle rebuilt from the toll-fix tip.
# Waits for (1) the b5 build to finish, (2) sibling run-sweep processes to
# clear the box, then launches the sweep. One process, one completion event.
set -euo pipefail
SP=/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad
KIT=$SP/ppkit
export KIT

echo "[wait] for b5 build to finish..."
until [ -f "$SP/ppruns/b5/bundle.json" ] || grep -q 'FATAL' "$SP/continuous/b5-build.log" 2>/dev/null; do
  sleep 15
done
if grep -q 'FATAL' "$SP/continuous/b5-build.log" 2>/dev/null; then
  echo "[wait] b5 build FAILED, see b5-build.log"; exit 1
fi
echo "[wait] b5 build done: $(cat $SP/ppruns/b5/bundle.json | tr -d '\n')"

echo "[wait] for box to clear of sibling run-sweep/run-pair processes..."
while pgrep -f 'run-sweep\.js|run-pair\.js' >/dev/null 2>&1; do
  sleep 30
done
echo "[wait] box clear at $(date -u +%FT%TZ)"

cd "$KIT"
node "$SP/continuous/specs/mkpotval.js" 24 200 21 80 4301 "$SP/continuous/specs/k5-potvalue.json"
node tools/simworker/bin/run-pair.js \
  --batch "$SP/continuous/k5" \
  --spec "$SP/continuous/specs/k5-potvalue.json" \
  --arm nullA="$SP/ppruns/b5" \
  --arm nullB="$SP/ppruns/b5" \
  --workers 2 \
  --note "continuous cycle 5: potion-value sweep, rebuilt from cluster-lookahead@79b5f5e (toll fix landed 02:38, first-plan toll gone). effectTurns 3/8/20, hazards OFF, potionOrder vs plain vs reflex. Finds where collecting potions starts to pay."
echo "[cycle5] DONE"
