/**
 * Shared waypoint pathing + progress stats for the centaur goto/near commands.
 *
 * This module is the SINGLE source of truth for everything waypoint-shaped:
 *  - `waypointPath` — the one BFS pathfinder (turn-aware optimistic
 *    passability, identical rules for every caller), used for the rendered
 *    green route, the evaluator's progress stats, and the server's staging
 *    re-bias. One pathfinder means the path the user sees, the stat the
 *    matrix scores, and the move the snake stages can never disagree.
 *  - `gotoProgressStat` / `nearProgressStat` — pure functions mapping
 *    (distance-from-head, distance-from-candidate) to the bounded per-move
 *    stat the heuristic matrix weighs. The optimal next move along a shortest
 *    path gets the maximum stat; survival heuristics stay free to outvote it
 *    because the stat (and therefore weight × stat) is bounded.
 *  - `computeWaypointProgressByMove` — the per-move stat table, computed ONCE
 *    per decision from the pre-move board. It is a plain serializable object,
 *    so the same table crosses the structured clone into decision worker
 *    threads (see decision-chunk.ts) instead of every chunk re-running BFS.
 *
 * The waypoint TARGET is the durable intent state; paths and stats are
 * derived data, recomputed from the live board every time they're needed.
 */

import { GameState, Coord, Direction } from '../types/battlesnake';
import { BoardGraph } from './board-graph';

// The active waypoint target handed to the decision engine: the current goto
// target (head of the goto queue) or the near target.
export interface WaypointContext {
  kind: 'goto' | 'near';
  target: Coord;
}

// Per-move waypoint stats, computed once per candidate move in the decision
// engine and injected into the evaluator via EvaluationContext (same pattern
// as h2hRisk). Exactly one of the two is non-zero for a given intent.
export interface WaypointProgress {
  gotoProgress: number;
  nearProgress: number;
}

// Serializable per-move stat table (a plain object, not a Map, so it survives
// the worker-thread structured clone unchanged).
export type WaypointProgressByMove = { [move in Direction]?: WaypointProgress };

const ALL_MOVES: Direction[] = ['up', 'down', 'left', 'right'];

export function destinationOf(head: Coord, move: Direction): Coord {
  switch (move) {
    case 'up': return { x: head.x, y: head.y + 1 };
    case 'down': return { x: head.x, y: head.y - 1 };
    case 'left': return { x: head.x - 1, y: head.y };
    case 'right': return { x: head.x + 1, y: head.y };
  }
}

/**
 * Shortest legal path from `from` to `target` (EXCLUDING `from`), or null when
 * the target is unreachable. Distance = path.length; from === target → [].
 *
 * Passability: our own body blocks, our tail and other snakes' bodies recede
 * under optimistic turn-aware passability — the same rules the space/trapped
 * heuristics use. `startTurn` shifts the arrival-turn clock for callers whose
 * start cell is itself one move in the future (candidate-move probes).
 *
 * `occupied` layers ADDITIONAL, caller-supplied blocking on top of that: cells
 * the subject will occupy in the future because of movement the board does not
 * know about yet. The graph models our body RECEDING as the tail advances, but
 * it has no idea our head is going to walk somewhere — so a caller chaining
 * several path legs must tell it, or later legs happily route back through the
 * cells the earlier legs just filled (most visibly, straight back into the neck
 * the snake would have created by arriving).
 *
 * Runs on the graph's flat cell indices (the board is a typed-array grid since
 * the perf rework); a caller that already built a BoardGraph for this turn
 * should pass it rather than paying for a rebuild.
 */
export function waypointPath(
  gameState: GameState,
  ourSnakeId: string,
  from: Coord,
  target: Coord,
  opts?: {
    graph?: BoardGraph;
    startTurn?: number;
    /**
     * Extra "our own future body" test: given a cell index and the turn we
     * would ARRIVE there, is it still occupied? Consulted in addition to the
     * graph's own passability, never instead of it.
     */
    occupied?: (cellIdx: number, arrivalTurn: number) => boolean;
  }
): Coord[] | null {
  const board = gameState.board;
  if (!board) return null;
  if (target.x < 0 || target.x >= board.width || target.y < 0 || target.y >= board.height) {
    return null;
  }
  if (from.x < 0 || from.x >= board.width || from.y < 0 || from.y >= board.height) {
    return null;
  }
  if (from.x === target.x && from.y === target.y) return [];
  const ourSnake = board.snakes.find(s => s.id === ourSnakeId);
  if (!ourSnake) return null;

  const graph = opts?.graph ?? new BoardGraph(gameState);
  const occupied = opts?.occupied;
  const pass = graph.passabilityIdxFor(ourSnakeId, { clearance: 'optimistic' });
  const W = graph.boardWidth;
  const N = graph.cellCount;

  const targetIdx = graph.cellIndexOf(target);
  const startIdx = graph.cellIndexOf(from);
  const parent = new Int32Array(N).fill(-1);
  const visited = new Uint8Array(N);
  visited[startIdx] = 1;
  const queue = new Int32Array(N);
  queue[0] = startIdx;
  let levelStart = 0;
  let levelEnd = 1;
  let turn = opts?.startTurn ?? 0;
  let found = false;

  while (levelStart < levelEnd && !found) {
    let nextEnd = levelEnd;
    turn++;
    for (let q = levelStart; q < levelEnd && !found; q++) {
      const cur = queue[q];
      const x = cur % W;
      const n0 = cur + W < N ? cur + W : -1;
      const n1 = cur - W >= 0 ? cur - W : -1;
      const n2 = x > 0 ? cur - 1 : -1;
      const n3 = x < W - 1 ? cur + 1 : -1;
      for (let t = 0; t < 4; t++) {
        const n = t === 0 ? n0 : t === 1 ? n1 : t === 2 ? n2 : n3;
        if (n < 0 || visited[n] === 1) continue;
        // The target cell itself is never passability-tested: arriving on it is
        // the goal, and `near` deliberately measures the distance to a cell it
        // will not enter.
        if (n === targetIdx) {
          parent[n] = cur;
          found = true;
          break;
        }
        if (!pass.passableIdx(n, turn)) continue;
        if (occupied && occupied(n, turn)) continue;
        visited[n] = 1;
        parent[n] = cur;
        queue[nextEnd++] = n;
      }
    }
    levelStart = levelEnd;
    levelEnd = nextEnd;
  }

  if (!found) return null;

  // Reconstruct from → target, then drop `from` (callers anchor at it).
  const path: Coord[] = [];
  for (let cur = targetIdx; cur !== startIdx && cur !== -1; cur = parent[cur]) {
    path.push({ x: cur % W, y: Math.floor(cur / W) });
  }
  path.reverse();
  return path;
}

/** BFS shortest-path distance from `from` to `target`, or null if unreachable. */
export function waypointDistance(
  gameState: GameState,
  ourSnakeId: string,
  from: Coord,
  target: Coord,
  opts?: { graph?: BoardGraph; startTurn?: number }
): number | null {
  const path = waypointPath(gameState, ourSnakeId, from, target, opts);
  return path === null ? null : path.length;
}

/**
 * Goto progress stat for one candidate move: a PURE linear ramp in [0, 1].
 *
 * With best = baseDist − 1 (the smallest distance any candidate could have):
 *
 *   f(candDist) = clamp(2 − candDist / best, 0, 1)
 *
 * so the optimal next move scores exactly 1 (the config weight IS its bonus),
 * and the reward falls linearly to 0 at DOUBLE the best path length. There is
 * deliberately no floor and no negative range:
 *  - the detour tolerance is self-scaling (window = remaining distance): a
 *    2-step-longer route near-costs nothing when the target is far, and the
 *    same detour is decisive close in — letting other heuristics discover a
 *    slightly longer route that is better on their dimensions;
 *  - the per-extra-step cost is weight/best, so pull sharpens as the snake
 *    approaches (acceleration shows up along the journey, not within a turn);
 *  - a backward or target-cutting move merely loses the bonus (0), bounding
 *    goto's total influence on any decision to exactly the config weight.
 *
 * Edge cases: adjacent to the target (best = 0) only arrival scores 1; a
 * candidate that re-opens a currently-unreachable target scores 1; no signal
 * (0 everywhere) when the target is unreachable from every candidate.
 */
export function gotoProgressStat(baseDist: number | null, candDist: number | null): number {
  if (candDist === null) return 0;
  if (baseDist === null) return 1; // re-opened a cut-off target
  const best = baseDist - 1;
  if (best <= 0) return candDist === 0 ? 1 : 0;
  return Math.max(0, Math.min(1, 2 - candDist / best));
}

/**
 * Near progress stat: the same pure [0, 1] ramp, anchored at the closest
 * allowed approach — distance 1, never the target itself:
 *
 *   best = max(1, baseDist − 1);  f(candDist) = clamp(2 − candDist / best, 0, 1)
 *
 * Arrival (candDist = 0) scores 0, never rewarded: near means "minimise the
 * distance WITHOUT ever reaching it". With no negative range, landing on or
 * cutting off the target costs the full bonus rather than dipping below
 * neutral — keeping the path open is worth up to the config weight, expressed
 * entirely as reward for moves that preserve a short open route.
 */
export function nearProgressStat(baseDist: number | null, candDist: number | null): number {
  if (candDist === null || candDist === 0) return 0;
  if (baseDist === null) return 1; // re-opened a cut-off target
  const best = Math.max(1, baseDist - 1);
  return Math.max(0, Math.min(1, 2 - candDist / best));
}

/**
 * The per-move waypoint progress table for the active goto/near target: BFS
 * shortest-path distance from the current head (baseline) and from each
 * candidate destination cell (startTurn 1 — the probe cell is one move in the
 * future), mapped through the pure progress-stat functions above.
 *
 * Computed ONCE per decision from the PRE-move board, then injected into every
 * evaluation of that candidate move — including the simulated look-ahead
 * states, which is why the value is a property of the move rather than of the
 * evaluated board. Returns null when no waypoint is active, so callers can
 * skip the context field entirely.
 */
export function computeWaypointProgressByMove(
  gameState: GameState,
  waypoint: WaypointContext | null | undefined,
  opts?: { graph?: BoardGraph }
): WaypointProgressByMove | null {
  if (!waypoint) return null;
  const youId = gameState.you.id;
  const head = gameState.you.head;
  const target = waypoint.target;
  const graph = opts?.graph ?? new BoardGraph(gameState);
  const baseDist = waypointDistance(gameState, youId, head, target, { graph });

  const result: WaypointProgressByMove = {};
  for (const move of ALL_MOVES) {
    const dest = destinationOf(head, move);
    const candDist = waypointDistance(gameState, youId, dest, target, { graph, startTurn: 1 });
    const stat = waypoint.kind === 'goto'
      ? gotoProgressStat(baseDist, candDist)
      : nearProgressStat(baseDist, candDist);
    result[move] = {
      gotoProgress: waypoint.kind === 'goto' ? stat : 0,
      nearProgress: waypoint.kind === 'near' ? stat : 0,
    };
  }
  return result;
}
