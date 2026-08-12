---
name: Goto/Near targets are weighted votes, not path overrides
description: Centaur click-targets bias the heuristic matrix through a [0,1] linear-ramp progress stat; goto is a target queue (which replaced the premove tool); both paths (optimal-from-head vs staged-conditioned) are derived per turn.
---

# Goto/Near are weighted votes in the heuristic matrix

A user click-target NEVER dictates the snake's move. It contributes a bounded
per-move stat to the same scoring matrix every other heuristic feeds, so
survival terms retain the power to outvote it. Goto (alt-click, green) and Near
(shift-click, blue) differ only in their stat function.

**The stat** (`src/logic/waypoint-pathing.ts`, the single shared module): a
PURE [0, 1] linear ramp over BFS shortest-path distances. With
`best = baseDist − 1` (the smallest distance any candidate could reach):

```
f(candDist) = clamp(2 − candDist / best, 0, 1)
```

The optimal next move scores exactly 1; the reward falls linearly to 0 at
DOUBLE the best path length. No floor, no negatives: a backward or
target-cutting move merely loses the bonus. Why this shape:
- **Self-scaling detour window** (= remaining distance): a slightly longer
  alternate route keeps most of the bonus when the target is far, letting
  other heuristics discover that a near-equal path is better on their
  dimensions; the same detour is decisive close in.
- **Legible marginal cost**: each extra step of route length costs exactly
  `weight / best` points, so pull sharpens as the snake approaches —
  "acceleration" shows up along the journey, not within a turn.
- Edge cases: adjacent target → only arrival scores 1; re-opening a
  currently-cut-off target scores 1; unreachable everywhere → 0 (no signal).

**Near** uses the same ramp anchored at the closest allowed approach
(`best = max(1, baseDist − 1)`) and **scores 0 for landing ON the target** —
Near means "minimise distance without ever arriving". With no negatives, the
never-arrive and keep-the-path-open behaviours are expressed purely as reward
for moves that preserve a short open route; the pull simply vanishes for
moves that arrive or sever the path.

**The weights** are config options `gotoProgress` / `nearProgress` (defaults
300 / 250). Because the optimal move's stat is exactly 1, **the weight IS the
bonus the preferred move receives**. Keep them above food/territory pulls but
below `deaths` (-500) and `trapped` (-600): that ordering is the whole safety
argument. Raising them past the death penalty re-creates the "snake dies for
the waypoint" behaviour this design removed. (The pre-redesign config keys
used a Manhattan-closeness stat with a ~1/boardSize per-step gradient, hence
their magnitudes in the thousands — never port those numbers onto this stat.)

**The stat is a property of the MOVE, not the board.** It is computed ONCE per
decision from the pre-move board (`computeWaypointProgressByMove`) and injected
into every evaluation of that candidate move — including the simulated
look-ahead states — via `EvaluationContext.waypointProgress`, the same pattern
as `h2hRisk`. Chunks are per-candidate-move, so each `ChunkJob` carries just its
own move's `{gotoProgress, nearProgress}` pair, which structured-clones into the
worker threads for free. Never re-derive the stat inside the evaluator from the
board it is scoring: that board is a simulated future, and the stat must measure
progress from where the snake actually is.

**One pathfinder, three consumers.** `waypointPath`/`waypointDistance` serve the
evaluator's stat, the server's staging re-bias, and the rendered green path. This
is deliberate: the number scored, the path drawn, and the move committed cannot
disagree. Do not add a second waypoint pathfinder.

# Staging re-derives the vote from the CURRENT target

The bot computes `moveEvaluations` once per decision (one per snake per turn,
fanned out across the worker pool), but a target can be set or moved mid-turn.
`getWaypointBiasedMove` re-scores this turn's stored evaluations: subtract the
waypoint contribution recorded at decision time
(`weighted.gotoProgressScore + weighted.nearProgressScore`), add
`weight × stat` for the target as it is NOW, then select with `pickBestMove`
— the shared trapped-veto + argmax exported from `decision-engine.ts` and used
by the engine itself. **Never reimplement the selection rule**; a second copy
drifts from the engine and the staged move stops matching what the bot would pick.

Returns null when this turn's evaluations are unavailable (turn 0, error paths),
and `computeIntendedMove` then falls through to the bot recommendation labelled
truthfully as `'bot'`.

# Two paths, tracked separately

- **Optimal-from-current-head** — feeds the matrix (the stat above). Never rendered.
- **Staged-conditioned** — what renders. `ControlledSnake.gotoRoute` is a DERIVED
  cache (deliberately NOT in the intent) recomputed by `refreshGotoRoute`. Its
  FIRST leg carries the duality: while a move is staged for the current turn it
  starts `[stagedDestination, ...shortestPath(stagedDestination → targets[0])]`;
  with nothing staged for the turn it starts at the projected head. Under the
  Firebase write-through model something is staged for essentially every turn,
  so the first branch is the normal case — which is the point: the drawn path is
  the path the snake will actually walk.

`refreshGotoRoute` must run AFTER `controlled.staged` is final in `stageMove` —
the fatal-move gate can replace the staged direction, and the drawn path must
follow the move that will actually commit, not the one the target wanted.

# The route spans the WHOLE queue

The rendered path chains one leg per queued target —
head → `targets[0]` → `targets[1]` → … — because the trajectory BETWEEN
waypoints is the information a human needs to plan around a snake's default
course; numbered target squares with no path between them do not convey it.

Each leg's BFS starts at the turn the previous target is reached (`startTurn`
accumulates the legs' lengths). This matters because passability is turn-aware:
bodies recede as the clock advances, so a later leg legitimately sees more open
board than the same leg measured from turn 0. Optimistic clearance has NO
look-ahead ceiling — `optimisticDisappear` stores the true geometric vacate turn
— so accumulated turns stay meaningful arbitrarily far out. (The
`maxLookaheadTurns` cap lives only on `isPassableAtTurnIdx`, the physical layer
`waypointPath` does not use.)

An unreachable leg TRUNCATES the route at the last reachable target rather than
skipping the gap: a drawn path must always be a walkable line.

**Legs past the first are a PREDICTION in a way the first is not.** The first is
conditioned on the move actually staged this turn; the rest assume the snake
reaches each target and that other snakes' bodies only recede from where they
are now. Do not read the tail of the route as a commitment — and note that only
`targets[0]` is ever handed to the decision engine, so the later legs influence
nothing, they only inform the human.

# Goto is a QUEUE of targets (and REPLACED the premove queue)

`{kind:'goto', targets: Coord[]}` — `targets[0]` is active and the only one handed
to the decision engine. Shift+Alt+click appends (appending an already-queued cell
removes it). The arrival check in `updateGameState` (head or `body[1]` on
`targets[0]`) SHIFTS the queue; only an emptied queue reverts to `heuristic`.
Near is single-target and never auto-clears.

**The targets are the only durable state.** Paths and stats are always recomputed
from the live board — never persist a route.

The old cell-by-cell premove queue tool (Q-mode, `set-premove`, the `queue`
intent) was removed as superseded: a chain of goto targets expresses the same
multi-step plan more powerfully, because every individual step is still
arbitrated by the full heuristic matrix instead of walked blindly.

# Not gated by fatal-move consent

`source: 'waypoint'` is deliberately EXCLUDED from the consent gate in
`stageMove` (see [fatal-consent-and-neck-guards.md](fatal-consent-and-neck-guards.md)).
The direction is bot-chosen via the matrix, so the bot's own death-aversion
already arbitrates it; prompting would ask the human to confirm a move the bot
picked, and the fallback would swap one bot-chosen move for another. The
source-agnostic red fatal-move marker (`isStagedMoveFatal`) still flags it in the UI.

**Wire projection:** `waypoints[snakeId] = {type:'green'|'blue', cells: Coord[]}`
(green carries the whole queue in order); `activeIntentModes` values include
`'goto'` / `'near'`. Client mirrors live in `play-game.html`.
