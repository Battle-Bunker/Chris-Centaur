#!/usr/bin/env bash
# THE ROUND-3 CAMPAIGN, run the only way this CPU permits an honest answer.
#
# `03-LATENCY.md` §2 established the rule and it holds here: this box is shared
# and drifts over minutes, so a block of "before" followed by a block of
# "after" measures the machine as much as it measures the change. Every
# condition is therefore run ROUND-ROBIN — one run of each, then a second of
# each, then a third — and each run gets a FRESHLY STARTED server on its own
# port, because a game that has already been stepped ninety times is not the
# game the first run measured.
#
#   scripts/perf3-runs.sh <outdir> <reps> <name>=<args> [<name>=<args> ...]
#
# e.g.
#   scripts/perf3-runs.sh /tmp/p3 3 base= t4=--throttle=4 noalerts=--ablate=alerts.js
#
# Writes <outdir>/<name>.<PERF3_TAG><rep>.json, one per run. Set PERF3_TAG when a
# later invocation must not overwrite an earlier one's files.
set -u
OUT="$1"; shift
REPS="$1"; shift
CONDS=("$@")
mkdir -p "$OUT"
PORT_BASE="${PERF3_PORT_BASE:-5380}"
TAG="${PERF3_TAG:-r}"
i=0
for rep in $(seq 1 "$REPS"); do
  for cond in "${CONDS[@]}"; do
    name="${cond%%=*}"
    args="${cond#*=}"
    port=$((PORT_BASE + (i % 12)))
    i=$((i + 1))
    node scripts/ux-walk-server.js --port="$port" > "$OUT/server.$name.$TAG$rep.log" 2>&1 &
    srv=$!
    up=0
    for _ in $(seq 1 60); do
      if curl -sf -o /dev/null "http://127.0.0.1:$port/game/lens-walk"; then up=1; break; fi
      sleep 1
    done
    if [ "$up" != 1 ]; then echo "[perf3-runs] server on $port never answered" >&2; kill "$srv" 2>/dev/null; continue; fi
    echo "[perf3-runs] $name rep $rep on :$port  ($args)"
    # shellcheck disable=SC2086
    node scripts/lens-perf3.js --port="$port" --label="$name" --out="$OUT/$name.$TAG$rep.json" $args > /dev/null 2> "$OUT/$name.$TAG$rep.err"
    rc=$?
    [ "$rc" = 0 ] || echo "[perf3-runs] $name rep $rep FAILED rc=$rc" >&2
    kill "$srv" 2>/dev/null
    wait "$srv" 2>/dev/null
  done
done
echo "[perf3-runs] done → $OUT"
