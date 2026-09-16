#!/bin/bash
# N clean profiler runs + the median table. See docs/design/ux/03-LATENCY.md §1.
# N clean profiler runs, each against a freshly started walkthrough server:
# an operator that has already held a selection is still holding it on the
# next connection, so a stale server makes the roster unfocusable.
set -u
LABEL="$1"; N="${2:-3}"; OUTDIR="$3"; PORT="${4:-5155}"
SP=/tmp/claude-0/-home-user/a18b7986-c57c-575f-b43a-7d659ae5fe7d/scratchpad
cd /home/user/Chris-Centaur/.claude/worktrees/ux-latency
mkdir -p "$OUTDIR"
for i in $(seq 1 "$N"); do
  pgrep -f "ts-node.*lens-walkthrough-server.*port=$PORT" | xargs -r kill 2>/dev/null
  sleep 2
  : > "$SP/wt.log"
  nohup npx ts-node --transpile-only src/tests/lens-walkthrough-server.ts --port=$PORT > "$SP/wt.log" 2>&1 &
  for w in $(seq 1 60); do grep -q "ready" "$SP/wt.log" && break; sleep 3; done
  node scripts/lens-latency-profile.js --port=$PORT --turns=8 --label="$LABEL-$i" --out="$OUTDIR/$LABEL-$i.json" > "$SP/prof-$LABEL-$i.log" 2>&1 || echo "  RUN $i FAILED"
  echo "run $i done"
done
pgrep -f "ts-node.*lens-walkthrough-server.*port=$PORT" | xargs -r kill 2>/dev/null
