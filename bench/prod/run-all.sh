#!/bin/sh
# The full production-regime run, SERIAL on purpose.
#
# Every measurement here is a real-clock one, so two of them running at once
# would be measuring each other. Nothing in this script is parallel, and the
# load average is stamped into each output file's header.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
OUT=${OUT:-/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad/v2-out}
mkdir -p "$OUT"
export DECISION_TELEMETRY_FILE="$OUT/telemetry.jsonl"
cd "$root"
B=".bench-dist/bench/prod"

say() { echo ""; echo "=== $1  ($(cat /proc/loadavg))"; echo ""; }

say "throughput"
node $B/throughput.js --scenario tiny2,duel11,mid11,haz11,big13,three13,three15 \
  --seeds 301,302,303 --turn 6 --iters 600 --out "$OUT/throughput.json" > "$OUT/throughput.txt" 2>&1

say "anytime 1s/5s/10s on 26 units"
node $B/anytime.js --scenario big13 --budgets 1000,5000,10000 --seeds 201,202,203,204 \
  --turn 8 --out "$OUT/anytime-big13.json" > "$OUT/anytime-big13.txt" 2>&1

say "anytime 1s/5s/10s on 12 units"
node $B/anytime.js --scenario mid11,three13 --budgets 1000,5000,10000 --seeds 201,202,203 \
  --turn 8 --out "$OUT/anytime-mid.json" > "$OUT/anytime-mid.txt" 2>&1

say "anytime with the reach/king evaluator"
node $B/anytime.js --scenario big13 --budgets 1000,10000 --seeds 201,202,203 \
  --turn 8 --evaluator reach --out "$OUT/anytime-reach.json" > "$OUT/anytime-reach.txt" 2>&1

say "bank/evaluator soundness vs exhaustive truth"
node $B/repeated-tail.js > "$OUT/repeated-tail.txt" 2>&1
node $B/soundness.js --scenario tiny2 --seeds 1,2,3,4,5,6 --turns 8 --planCap 48 \
  --worldCap 512 --out "$OUT/soundness-tiny2.json" > "$OUT/soundness-tiny2.txt" 2>&1

say "decision quality vs exhaustive truth (small boards)"
node $B/quality.js --scenario tiny2 --seeds 401,402,403,404,405,406,407,408 \
  --startTurn 3 --turns 3 --budgets 1000,10000 --out "$OUT/quality.json" > "$OUT/quality.txt" 2>&1

say "h2h 1s"
node $B/h2h.js --scenario mid11 --budget 1000 --seeds 101,102,103,104,105 --maxTurns 30 \
  --out "$OUT/h2h-1s-mid11.json" > "$OUT/h2h-1s-mid11.txt" 2>&1
node $B/h2h.js --scenario big13 --budget 1000 --seeds 101,102,103 --maxTurns 24 \
  --out "$OUT/h2h-1s-big13.json" > "$OUT/h2h-1s-big13.txt" 2>&1
node $B/h2h.js --scenario three13 --budget 1000 --seeds 101,102,103 --maxTurns 24 \
  --out "$OUT/h2h-1s-three13.json" > "$OUT/h2h-1s-three13.txt" 2>&1
node $B/h2h.js --scenario duel11 --budget 1000 --seeds 101,102,103 --maxTurns 30 \
  --out "$OUT/h2h-1s-duel11.json" > "$OUT/h2h-1s-duel11.txt" 2>&1

say "h2h 5s"
node $B/h2h.js --scenario mid11 --budget 5000 --seeds 101,102,103 --maxTurns 14 \
  --out "$OUT/h2h-5s-mid11.json" > "$OUT/h2h-5s-mid11.txt" 2>&1

say "h2h 10s"
node $B/h2h.js --scenario mid11 --budget 10000 --seeds 101,102,103 --maxTurns 10 \
  --out "$OUT/h2h-10s-mid11.json" > "$OUT/h2h-10s-mid11.txt" 2>&1

say "evaluator head-to-head: reach/king vs material"
node $B/h2h.js --mode reach-vs-material --scenario mid11 --budget 1000 --seeds 101,102,103 \
  --maxTurns 24 --out "$OUT/eval-1s-mid11.json" > "$OUT/eval-1s-mid11.txt" 2>&1
node $B/h2h.js --mode reach-vs-material --scenario mid11 --budget 10000 --seeds 101,102 \
  --maxTurns 10 --out "$OUT/eval-10s-mid11.json" > "$OUT/eval-10s-mid11.txt" 2>&1

say "DONE"
