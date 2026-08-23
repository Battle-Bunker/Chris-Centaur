#!/bin/sh
# Follow-up runs: the questions the first pass raised.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
OUT=${OUT:-/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad/v2-out}
mkdir -p "$OUT"
export DECISION_TELEMETRY_FILE="$OUT/telemetry.jsonl"
cd "$root"
B=".bench-dist/bench/prod"
say() { echo ""; echo "=== $1  ($(cat /proc/loadavg))"; echo ""; }

say "slice-size experiment: does a longer slice let the search progress?"
node $B/anytime.js --scenario big13 --budgets 10000 --seeds 201,202,203,204 --turn 8 \
  --sliceMs 2000 --out "$OUT/anytime-slice2000.json" > "$OUT/anytime-slice2000.txt" 2>&1
node $B/anytime.js --scenario big13 --budgets 10000 --seeds 201,202,203,204 --turn 8 \
  --sliceMs 500 --out "$OUT/anytime-slice500.json" > "$OUT/anytime-slice500.txt" 2>&1

say "write-throttle experiment: are the search's improvements throttled off the wire?"
node $B/anytime.js --scenario big13,mid11 --budgets 10000 --seeds 201,202,203 --turn 8 \
  --minWriteMs 2 --out "$OUT/anytime-write2.json" > "$OUT/anytime-write2.txt" 2>&1
node $B/anytime.js --scenario big13 --budgets 10000 --seeds 201,202,203 --turn 8 \
  --minWriteMs 2 --sliceMs 2000 --out "$OUT/anytime-write2-slice2000.json" > "$OUT/anytime-write2-slice2000.txt" 2>&1

say "does the CALIBRATED profile restore a climbing lo where it can afford slices?"
node $B/anytime.js --scenario mid11,duel11 --budgets 1000,10000 --seeds 201,202,203 --turn 8 \
  --evaluator reach --out "$OUT/anytime-reach-mid.json" > "$OUT/anytime-reach-mid.txt" 2>&1
node $B/anytime.js --scenario mid11 --budgets 10000 --seeds 201,202,203 --turn 8 \
  --evaluator reach --minWriteMs 2 --out "$OUT/anytime-reach-write2.json" > "$OUT/anytime-reach-write2.txt" 2>&1

say "bank hot spots"
node $B/profile-bank.js --scenario mid11 --seed 302 --turn 6 --plans 40 > "$OUT/profile-bank.txt" 2>&1
node $B/profile-bank.js --scenario big13 --seed 302 --turn 6 --plans 20 >> "$OUT/profile-bank.txt" 2>&1
rm -rf "$OUT/cpuprof" && mkdir -p "$OUT/cpuprof"
node --cpu-prof --cpu-prof-dir="$OUT/cpuprof" $B/profile-bank.js --scenario mid11 --seed 302 --turn 6 --plans 60 > /dev/null 2>&1
for f in "$OUT/cpuprof"/*.cpuprofile; do
  echo "## $f" >> "$OUT/profile-bank.txt"
  node bench/prod/read-cpuprofile.js "$f" 30 >> "$OUT/profile-bank.txt" 2>&1
done

say "h2h on SNAKES-ONLY boards (legacy speaks for every unit it owns)"
node $B/h2h.js --scenario snakes11 --budget 1000 --seeds 101,102,103,104,105 --maxTurns 30 \
  --out "$OUT/h2h-1s-snakes11.json" > "$OUT/h2h-1s-snakes11.txt" 2>&1
node $B/h2h.js --scenario snakes13 --budget 1000 --seeds 101,102,103 --maxTurns 24 \
  --out "$OUT/h2h-1s-snakes13.json" > "$OUT/h2h-1s-snakes13.txt" 2>&1
node $B/h2h.js --scenario snakes11 --budget 10000 --seeds 101,102,103 --maxTurns 10 \
  --out "$OUT/h2h-10s-snakes11.json" > "$OUT/h2h-10s-snakes11.txt" 2>&1

say "quality on snakes-only boards"
node $B/quality.js --scenario snakes11 --seeds 401,402,403,404 --startTurn 3 --turns 3 \
  --budgets 1000,10000 --out "$OUT/quality-snakes.json" > "$OUT/quality-snakes.txt" 2>&1

say "throughput re-measure (record the load average that came with it)"
node $B/throughput.js --scenario mid11,big13 --seeds 301,302,303 --turn 6 --iters 800 \
  --out "$OUT/throughput-2.json" > "$OUT/throughput-2.txt" 2>&1

say "FOLLOWUP DONE"
