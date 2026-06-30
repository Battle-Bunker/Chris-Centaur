---
name: Trap / fatal-pocket survival
description: How the bot avoids driving into clearly-fatal dead-end pockets; trapped heuristic + veto invariants.
---

# Fatal-pocket survival

The bot must never step into a cell that is legal this turn but leaves no
survivable space next turn (e.g. onto an opponent's vacating tail that turns out
to be a sealed pocket). Two layers enforce this:

1. **`trapped` heuristic** (BoardEvaluator): 1 = fatal pocket, 0 = fine. Strongly
   negative weight (default -600, below the death penalty so it dominates every
   non-survival heuristic). Wired across HeuristicStats/Weights/WeightedScores,
   constructor default, dead-state (set to 0 — death is already captured by
   `deaths:1`, avoid double-penalizing), calculateWeightedScores,
   calculateTotalScore, decision-engine averageEvaluations, and all surfacing
   layers (game-config, voronoi-strategy extractWeights + breakdown log,
   decision-logger type, config.html UI/configKeys/range, board-renderer
   weightedSums + metric row).
2. **Candidate-level veto** (DecisionEngine.decide): after scoring, filter out
   candidates whose averaged `trapped >= 0.5` whenever a non-fatal alternative
   exists, THEN pick max score within that pool. This is the hard guarantee — it
   overrides even a high-scoring waypoint sitting inside the pocket. If every
   candidate is fatal, fall back to scoring all of them (least-bad death).

**Why both:** the weight handles cases where a veto can't apply; the veto is the
absolute guarantee. Don't collapse them into one.

## Survival-aware reachable region (the over-count fix)

`computeReachableRegion` floods from the head via the shared BoardGraph
`snakePassability` predicate and returns `{reachableCount, tailReachable,
parityBound}`. **parityBound = 2*min(white,black)+1** is a checkerboard upper
bound on the longest *simple* path (a snake alternates cell colors each step).

`spaceScoreFromRegion`: longestPathBound = min(reachableCount, parityBound).
- tailReachable → enough space if longestPathBound >= max(3, floor(L/2))
- else → enough space if longestPathBound >= L

**Why parity:** raw reachable-count over-counts a wide-but-unwalkable blob (e.g. a
plus/cross shape) as survivable. Using the parity bound stops a dead-end from
flipping to +3. `trapped` is derived from the SAME region:
`trapped = (tailReachable || longestPathBound >= L) ? 0 : 1`.

## Single source of truth for snake-relative passability

`BoardGraph.snakePassability(subject, allSnakes)` returns precomputed
`headKey/tailKey/ownBody/otherTails` + `passable(coord, arrivalTurn, {optimistic,
blockOtherTails})`. calculateSnakeSpace, computeReachableRegion, and
calculateTightSpaceMetrics all defer to it — do NOT re-derive ownBody/otherTails
sets inline. (Note: a couple of other helpers still build local ownBody sets;
migrate them here if you touch them.)

## tail-vacate-on-eat assumption (pinned)

"Just ate" is detected by **head-on-food** (`snakeJustAte`), NOT a duplicated tail
segment. A just-ate snake grows, so its tail does NOT vacate next turn — its tail
cell stays blocked in BOTH `grow-same-turn` and `grow-next-turn`, in
`isPassable` and `isPassableAtTurn`. Stepping onto a just-ate snake's tail is
always fatal. A normal (not-eating) snake's tail IS passable on arrival turn 1.
