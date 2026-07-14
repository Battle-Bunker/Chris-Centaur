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
 *
 * The waypoint TARGET is the durable intent state; paths and stats are
 * derived data, recomputed from the live board every time they're needed.
 */

import { GameState, Coord } from '../types/battlesnake';
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

// Bounds for the progress stats. Progress toward the target caps at +1 (one
// step of a shortest path per turn is the best possible), regressions cap at
// -2 so a single move that trades a short route for a long detour can't dwarf
// the death penalty once weighted.
export const PROGRESS_MAX = 1;
export const PROGRESS_MIN = -2;

/**
 * Shortest legal path from `from` to `target` (EXCLUDING `from`), or null when
 * the target is unreachable. Distance = path.length; from === target → [].
 *
 * Passability: our own body blocks, our tail and other snakes' bodies recede
 * under optimistic turn-aware passability — the same rules the space/trapped
 * heuristics use. `startTurn` shifts the arrival-turn clock for callers whose
 * start cell is itself one move in the future (candidate-move probes).
 */
export function waypointPath(
  gameState: GameState,
  ourSnakeId: string,
  from: Coord,
  target: Coord,
  opts?: { graph?: BoardGraph; startTurn?: number }
): Coord[] | null {
  const board = gameState.board;
  if (!board) return null;
  if (target.x < 0 || target.x >= board.width || target.y < 0 || target.y >= board.height) {
    return null;
  }
  if (from.x === target.x && from.y === target.y) return [];
  const ourSnake = board.snakes.find(s => s.id === ourSnakeId);
  if (!ourSnake) return null;

  const graph = opts?.graph ?? new BoardGraph(gameState);
  const pass = graph.passabilityFor(ourSnakeId, { clearance: 'optimistic' });
  const targetKey = graph.coordToKey(target);
  const startKey = graph.coordToKey(from);

  const parent = new Map<string, Coord>();
  const visited = new Set<string>([startKey]);
  let level: Coord[] = [from];
  let turn = opts?.startTurn ?? 0;
  const maxCells = 400; // board is at most ~19x19 → 361 cells

  let found = false;
  while (level.length > 0 && visited.size < maxCells && !found) {
    const next: Coord[] = [];
    turn++;
    for (const cur of level) {
      const neighbors: Coord[] = [
        { x: cur.x, y: cur.y + 1 },
        { x: cur.x, y: cur.y - 1 },
        { x: cur.x - 1, y: cur.y },
        { x: cur.x + 1, y: cur.y },
      ];
      for (const n of neighbors) {
        if (!graph.isInBounds(n)) continue;
        const k = graph.coordToKey(n);
        if (visited.has(k)) continue;
        if (k === targetKey) {
          parent.set(k, cur);
          found = true;
          break;
        }
        if (!pass.passable(n, turn)) continue;
        visited.add(k);
        parent.set(k, cur);
        next.push(n);
      }
      if (found) break;
    }
    level = next;
  }

  if (!found) return null;

  const path: Coord[] = [];
  let cur: Coord | undefined = { x: target.x, y: target.y };
  while (cur && !(cur.x === from.x && cur.y === from.y)) {
    path.push(cur);
    cur = parent.get(graph.coordToKey(cur));
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

function clampProgress(v: number): number {
  return Math.max(PROGRESS_MIN, Math.min(PROGRESS_MAX, v));
}

/**
 * Goto progress stat for one candidate move.
 *  - +1  the move is the first step of some shortest path to the target
 *  -  0  sideways (path distance unchanged)
 *  - -1  backward (path distance grew; clamped at -2 for large detours)
 *  - -2  the move cuts the target off entirely (was reachable, now isn't)
 * When the target is unreachable from the current head too, a move that
 * re-opens a path scores +1 and everything else is neutral (no signal).
 */
export function gotoProgressStat(baseDist: number | null, candDist: number | null): number {
  if (candDist === null) return baseDist === null ? 0 : PROGRESS_MIN;
  if (baseDist === null) return PROGRESS_MAX; // re-opened a cut-off target
  return clampProgress(baseDist - candDist);
}

/**
 * Near progress stat for one candidate move. Near means "minimise the distance
 * to the target WITHOUT ever reaching it, and never cut off the shortest path
 * to it":
 *  - candidate lands ON the target → -2 (reaching it is forbidden)
 *  - target unreachable from candidate → -2 (cut off), unless it was already
 *    unreachable (no signal → 0)
 *  - otherwise progress toward it, clamped, with distance 1 the ideal: from an
 *    adjacent head the best available stat is 0 (hold the orbit), so the near
 *    pull never pushes the snake onto the cell.
 */
export function nearProgressStat(baseDist: number | null, candDist: number | null): number {
  if (candDist === 0) return PROGRESS_MIN;
  if (candDist === null) return baseDist === null ? 0 : PROGRESS_MIN;
  if (baseDist === null) return PROGRESS_MAX;
  return clampProgress(baseDist - candDist);
}
