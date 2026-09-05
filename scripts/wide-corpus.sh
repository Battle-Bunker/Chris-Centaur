#!/usr/bin/env bash
#
# THE WIDE CORPUS — every scenario x seeds 1..N, mirrored and against
# `material-only`, recorded to one directory as JSON summaries and traces.
#
# WHY IT IS A SCRIPT AND NOT A SUBCOMMAND. `local-game.js sum` already loops
# over seeds, but it prints no trace, and the first two behaviour audits were
# written by READING games — every death, every reckless pickup, every long
# park — not by reading counters. So the corpus is recorded one process per
# (scenario, seed, arm): the JSON summary that `ab-compare.js` subtracts, and
# beside it the full per-unit-per-turn trace that the audit quotes. One process
# per run is also what makes the recording parallel and resumable.
#
# RESUMABLE, because it is long. A run whose summary already exists is skipped,
# and each run writes to a temporary name and is moved into place only when the
# process exits 0 — the summary is moved LAST, so a summary on disk always has a
# complete trace beside it. Interrupt this at any point and run it again.
#
# Usage:
#   scripts/wide-corpus.sh [outdir] [seeds] [jobs]
#     outdir  where to record         (default docs/design/wide)
#     seeds   N (meaning 1..N) or A-B (default 20)
#     jobs    parallel processes      (default 4)
#
#   CLASSES="wide dense" scripts/wide-corpus.sh docs/design/wide 1-5 6
#     Records a SLICE. `CLASSES` overrides the scenario list and the seed range
#     takes an explicit start, so a whole corpus can be recorded as a series of
#     bounded pieces — which is how it is actually recorded, because one process
#     per game over eleven classes and twenty seeds is hours of wall clock.
#     Slices compose: the table at the end always describes everything on disk.
#
#   scripts/wide-corpus.sh --table [outdir]     re-print the summary table only
#
# Everything is deterministic (`--nodes`), so a run's numbers are a function of
# (build, scenario, seed, arm) and nothing else, and re-recording a corpus on
# the same build reproduces it byte for byte.

set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "${1:-}" = "--table" ]; then
  node scripts/wide-corpus.js table "${2:-docs/design/wide}"
  exit $?
fi

OUT="${1:-docs/design/wide}"
SEEDS="${2:-20}"
JOBS="${3:-4}"
case "$SEEDS" in
  *-*) SEED_FROM="${SEEDS%%-*}"; SEED_TO="${SEEDS##*-}" ;;
  *)   SEED_FROM=1;             SEED_TO="$SEEDS" ;;
esac

# THE CORPUS'S SHAPE, in one place: every scenario the runner defines, at the
# turn cap that scenario is for. `long` is the only one that is not 60 — it is
# `mixed` run to 120, so its first sixty turns are byte-identical to `mixed`'s
# and everything that differs is the second sixty.
SCENARIOS="${CLASSES:-snakes mixed sparse sparse-lean potions wide dense asym potion-rich hazards long}"
turns_for() { case "$1" in long) echo 120 ;; *) echo 60 ;; esac; }

# The two arms. `mirror` is every team on the default profile — the state the
# byte-identity gate measures — and `material-only` puts every team but team 0
# on `MATERIAL_ONLY_PROFILE`, so team 0's deaths are OURS and the rest are the
# opponent's blunders (BEHAVIOUR-AUDIT-2.md §4.1).
ARMS="mirror material-only"

mkdir -p "$OUT/json" "$OUT/logs" "$OUT/tmp"

if [ ! -f dist/tests/local-game.js ]; then
  echo "wide-corpus: dist/tests/local-game.js missing — run npx tsc -p . first" >&2
  exit 1
fi

# One run. Skips itself when its summary is already on disk.
run_one() {
  local scen="$1" seed="$2" arm="$3" out="$4"
  local turns name json log
  name="$scen-$seed-$arm"
  json="$out/json/$name.jsonl"
  log="$out/logs/$name.log"
  [ -s "$json" ] && return 0
  turns=$(turns_for "$scen")
  local opp=()
  [ "$arm" = "mirror" ] || opp=(--opponent="$arm")
  if node dist/tests/local-game.js "$scen" "$turns" "$seed" --nodes \
      --label="$arm" "${opp[@]}" --json="$out/tmp/$name.jsonl" > "$out/tmp/$name.log" 2>&1; then
    mv "$out/tmp/$name.log" "$log"
    mv "$out/tmp/$name.jsonl" "$json"
    echo "ok   $name"
  else
    echo "FAIL $name" >&2
    rm -f "$out/tmp/$name.jsonl"
    return 1
  fi
}
export -f run_one turns_for

# The task list, then a fixed-width pool over it. Ordered scenario-major so a
# partial recording is a whole class rather than a slice of every class.
for scen in $SCENARIOS; do
  for arm in $ARMS; do
    for seed in $(seq "$SEED_FROM" "$SEED_TO"); do
      printf '%s %s %s\n' "$scen" "$seed" "$arm"
    done
  done
done | xargs -P "$JOBS" -L 1 bash -c 'run_one "$0" "$1" "$2" "'"$OUT"'"'

# The arms, concatenated into the two files `ab-compare.js` reads, and the
# table. Both are regenerated from scratch every time, so they always describe
# what is actually on disk.
cat "$OUT"/json/*-mirror.jsonl > "$OUT/wide-mirror.jsonl" 2>/dev/null || true
cat "$OUT"/json/*-material-only.jsonl > "$OUT/wide-material-only.jsonl" 2>/dev/null || true
node scripts/wide-corpus.js table "$OUT" | tee "$OUT/TABLE.md"
