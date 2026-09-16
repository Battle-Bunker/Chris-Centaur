#!/bin/bash
# ---------------------------------------------------------------------------
# THE STANDING CORPUS, BOTH COLOURS — docs/design/SIDE-ASYMMETRY.md
#
# One arm of an A/B, or one audit's corpus, taken from BOTH roster slots and
# written as one JSON Lines file for scripts/ab-compare.js.
#
# Why it exists. The five baseline scenarios were written to exercise
# mechanics, not to be fair. In MIRROR self-play — the identical profile on
# every team, so no bot difference is possible — `mixed` and `potions` are won
# by slot 1 (blue) 8/8 with a mean lead of +29 while slot 0 (red) wins 0/8 at
# -35, because blue's roster carries the queen and red's carries a knight.
# `snakes` and `sparse` have mirror-image rosters but food that is not
# mirrored. So every counter taken at `--side=0` alone — which is every death
# and every meal in BEHAVIOUR-AUDIT.md, BEHAVIOUR-AUDIT-2.md, WEIGHT-SWEEP.md
# and docs/design/ab/ — reads the board's handicap together with the build's.
# The rule from here is: both colours, reported separately, never pooled.
#
#   scripts/both-sides-corpus.sh OUT.jsonl [LABEL] [TURNS] [SEEDS] [SCENARIOS]
#
# Then, in the other worktree, the same with its own OUT/LABEL, and:
#
#   node scripts/ab-compare.js A.jsonl B.jsonl --require-both-sides
#
# NOTE FOR A MERGED scripts/wide-corpus.sh: this rule is a flag, not a fork.
# Add `--side=both` to that script's runner invocations and its own corpus is
# both-colour too; `ab-compare.js --require-both-sides` is what enforces it.
# ---------------------------------------------------------------------------
set -euo pipefail

OUT="${1:?usage: both-sides-corpus.sh OUT.jsonl [LABEL] [TURNS] [SEEDS] [SCENARIOS]}"
LABEL="${2:-corpus}"
TURNS="${3:-60}"
SEEDS="${4:-8}"
# `all` is the five baseline classes, pinned. `mirrors` is the hand-symmetric
# control per class — the boards on which a side difference is a fact about the
# BUILD rather than about the roster. `everything` is both.
SCENARIOS="${5:-all}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# The deterministic budget is not optional here: a wall-clock-budgeted counter
# is a reading of the machine's load, and a two-colour corpus doubles the
# runtime over which that load can drift.
npx tsc
node dist/tests/local-game.js sum "$SCENARIOS" "$TURNS" "$SEEDS" \
  --nodes --side=both --label="$LABEL" --json="$OUT"

echo
echo "wrote $(wc -l < "$OUT") summaries to $OUT (both colours, ${SCENARIOS})"
echo "compare with: node scripts/ab-compare.js BEFORE.jsonl $OUT --require-both-sides"
