#!/usr/bin/env bash
# CONTINUOUS CYCLE 2 — the same channel ladder at HALF the concurrency.
#
# Two readings from one run:
#   (a) 24 more blocks on the channel ladder, on seeds disjoint from cycle 1;
#   (b) the floor comparison. Cycle 1 ran --workers 2 (4 concurrent games on
#       4 cores, no headroom). This runs --workers 1 (2 concurrent games).
#       Same field, same cells, same block count, so the two A/A floors are
#       directly comparable and the question "is the floor the box or the
#       board?" gets a number instead of an argument.
#
# Power goes as blocks / floor^2, so a floor that halves is worth four times
# the blocks. If --workers 1 costs less than 4x the wall clock per block and
# halves the floor, every later cycle should run at --workers 1.
set -euo pipefail
SP=/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad
KIT=$SP/ppkit
export KIT
cd "$KIT"

# seedBase 4041 shifts the arithmetic sequence 40 clear of cycle 1's 98201-98224.
node "$SP/continuous/specs/mkchannel.js" 24 200 21 80 4041 "$SP/continuous/specs/k2-channel.json"

node tools/simworker/bin/run-pair.js \
  --batch "$SP/continuous/k2" \
  --spec "$SP/continuous/specs/k2-channel.json" \
  --arm nullA="$SP/ppruns/b4" \
  --arm nullB="$SP/ppruns/b4" \
  --workers 2 \
  --note "continuous cycle 2: the channel ladder again, identical settings, seeds disjoint from cycle 1 so the blocks add toward the 32-block verdict target. The workers-1 floor comparison was dropped: the box is shared with sibling test suites, so it would have measured the siblings rather than the concurrency."
