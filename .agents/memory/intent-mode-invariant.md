---
name: Active intent mode invariant (centaur play)
description: How the single-active next-move source is enforced per controlled snake in centaur play mode.
---

# Active intent mode invariant

Each controlled snake in centaur play has exactly ONE active next-move source at a time: `activeIntentMode` ∈ `heuristic | manual | queue | waypoint` (on `ControlledSnake` in `src/server/active-game-manager.ts`).

**Rule:** all mode changes must go through the single helper `transitionIntentMode(controlled, mode)`. It only CLEARS the other three sources' state (premoveQueue, waypoint+gotoRoute, this-turn manual selection); callers populate the new mode's own state around the call. Never set `activeIntentMode` directly elsewhere.

**Route/queue anchoring:** the goto route and the premove queue must both anchor at the *projected head* (the cell the snake occupies after any move already committed this turn — `getProjectedHead`), not the live head. After committing a move, recompute the goto route from the projected head and re-broadcast it (e.g. on the move-committed message), or the rendered path and its first step start at the stale head. When nothing is committed, projected head == live head, so the same code path serves the not-yet-committed case.

**`computeIntendedMove` is the single move-decision chokepoint** — every commit path (unselected auto-pilot, end-of-turn safety timer, previous-turn cleanup) reads from it. Priority: manual → queue → goto-route-head → bot → fallback. Each non-bot mode must HARD-OVERRIDE the move (return its own direction), not merely relabel the bot's recommendation's `source`. A past bug: the waypoint branch returned `botRecommendation` tagged `'waypoint'`, so the snake never followed the green route it displayed — visual and move were two different mechanisms. Fix: `getGotoRouteDirection` returns `directionFromTo(head, gotoRoute[0])` and that drives the move.

**Why:** without one mutation point, multiple sources (queue + waypoint + manual) could be populated simultaneously and the #14 source-priority resolver would pick inconsistently with what the UI shows.

**How to apply / edge cases:**
- Manual is a SINGLE-turn intent — it auto-reverts to `heuristic` on each new turn in `setBotRecommendation`'s board-updated loop (pendingMove is recreated null each turn). Queue and waypoint PERSIST across turns.
- A queue auto-commit must submit with source `'queue'` (not `'manual'`), or it would clear the queue it's draining. `submitUserMove(…, source)` only calls `transitionIntentMode('manual')` when `source==='manual'`. The client `submitMove(source)` auto-commit timer passes `'queue'`; Space/button default to `'manual'`.
- Green ("goto") waypoint auto-clear in `updateGameState` must also clear `gotoRoute` and transition back to `heuristic`.
- `gotoRoute` (live green path) is recomputed every `/move` via `BoardEvaluator.computeWaypointRoute` (BFS, only for green waypoints) and stored on the snake in `setBotRecommendation`. It arrives `[]` when no reachable green waypoint, so it self-clears.
- It's ALSO computed synchronously in `setWaypoint` (via `computeGotoRouteNow`) so the path renders the instant the user alt-clicks, not only after the next `/move`. When computing off the shared `game.boardState`, build a `{...boardState, you: targetSnake}` because BoardGraph keys invulnerability/severability off `gameState.you`, and `boardState.you` is whichever snake last sent `/move`.
- Both green and blue waypoints map to `waypoint` mode; only green produces a rendered route.
