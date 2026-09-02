/**
 * Shared waypoint pathing + progress stats for the centaur goto/near commands.
 *
 * This module is the SINGLE source of truth for everything waypoint-shaped:
 *  - `waypointRoute` — the one BFS pathfinder (turn-aware optimistic
 *    passability, identical rules for every caller), used for the rendered
 *    green route, the evaluator's progress stats, and the server's staging
 *    re-bias. One pathfinder means the path the user sees, the stat the
 *    matrix scores, and the move the snake stages can never disagree. It walks
 *    the unit's own SEARCH SPACE, so one BFS plans a rook's rays, a
 *    knight's jumps and a pawn's turn-then-step sequences without knowing
 *    which is which; `waypointPath` is its cells-only projection.
 *  - `gotoProgressStat` / `nearProgressStat` — pure functions mapping
 *    (distance-from-head, distance-from-candidate) to the bounded per-move
 *    stat the heuristic matrix weighs. The optimal next move along a shortest
 *    path gets the maximum stat; survival heuristics stay free to outvote it
 *    because the stat (and therefore weight × stat) is bounded.
 *  - `computeWaypointProgressByMove` — the per-move stat table, computed ONCE
 *    per decision from the pre-move board. It is a plain serializable object,
 *    so one BFS per decision serves every consumer of the stat instead of
 *    each of them re-running it.
 *
 * The waypoint TARGET is the durable intent state; paths and stats are
 * derived data, recomputed from the live board every time they're needed.
 */

import { GameState, Coord, Direction } from '../types/battlesnake';
import { RouteBoard } from './route';
import { Orientation } from './staging-legality';

// The active waypoint target handed to the decision engine: the current goto
// target (head of the goto queue) or the near target.
export interface WaypointContext {
  kind: 'goto' | 'near';
  target: Coord;
}

/**
 * One TURN of a planned route: the square the unit stands on once the turn is
 * spent, plus the orientation it now faces when the turn was spent TURNING
 * (the square is then unchanged — a pawn's quarter turn is a whole move).
 *
 * Route length is therefore turns, not squares, which is exactly what the
 * progress stat wants to measure and what the display wants to draw.
 */
export interface RouteStep {
  cell: Coord;
  rotation?: Orientation;
}

/**
 * A search START state: the square, and — for units whose reachability depends
 * on which way they face — the orientation they face there. Omitting the
 * orientation means "however the unit faces right now".
 */
export interface WaypointProbe {
  cell: Coord;
  orientation?: Orientation;
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

export interface WaypointPathOptions {
  board?: RouteBoard;
  startTurn?: number;
  /**
   * Extra "our own future body" test: given a cell index and the turn we
   * would ARRIVE there, is it still occupied? Consulted in addition to the
   * route board's own passability, never instead of it.
   */
  occupied?: (cellIdx: number, arrivalTurn: number) => boolean;
  /**
   * The orientation the unit faces AT `from`, when that is not the one it
   * faces on the live board — a chained route leg continuing from a planned
   * turn, or a candidate probe asking "what if it had turned that way". Read
   * only by units whose reachability depends on facing (pawns).
   */
  orientation?: Orientation;
}

/**
 * Shortest legal PLAN from `from` to `target` (EXCLUDING `from`), one entry per
 * turn spent, or null when the target is unreachable. Distance = route.length;
 * from === target → [].
 *
 * One BFS level is one of the unit's own turns, taken over the unit's own
 * search space — so a knight's route is L-hops, a rook's is ray landings, and a
 * pawn's interleaves quarter turns with forward steps, all from this one loop.
 * A turn spent TURNING carries `rotation` and repeats the square it was spent
 * on; it enters nothing, so it is never passability-tested.
 *
 * Passability: our own body blocks, our tail and other snakes' bodies recede
 * under optimistic turn-aware passability — the same rules the space/trapped
 * heuristics use. `startTurn` shifts the arrival-turn clock for callers whose
 * start cell is itself one move in the future (candidate-move probes).
 *
 * `occupied` layers ADDITIONAL, caller-supplied blocking on top of that: cells
 * the subject will occupy in the future because of movement the board does not
 * know about yet. The route board models our body RECEDING as the tail advances, but
 * it has no idea our head is going to walk somewhere — so a caller chaining
 * several path legs must tell it, or later legs happily route back through the
 * cells the earlier legs just filled (most visibly, straight back into the neck
 * the snake would have created by arriving).
 *
 * Runs on flat node indices over a typed-array grid; a caller that already
 * built a RouteBoard for this turn should pass it rather than paying for a
 * rebuild.
 */
export function waypointRoute(
  gameState: GameState,
  ourSnakeId: string,
  from: Coord,
  target: Coord,
  opts?: WaypointPathOptions
): RouteStep[] | null {
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

  const routeBoard = opts?.board ?? new RouteBoard(gameState);
  const occupied = opts?.occupied;
  const pass = routeBoard.passabilityFor(ourSnakeId);
  // The subject's own search space: one BFS level is one of ITS turns, and the
  // space decides whether facing is part of a node. Nothing here knows which
  // unit it is walking for.
  const unit = routeBoard.unitFor(ourSnakeId);
  const space = routeBoard.searchSpaceFor(
    opts?.orientation ? { ...unit, orientation: opts.orientation } : unit
  );
  const W = routeBoard.boardWidth;
  const N = space.nodeCount;

  const targetIdx = routeBoard.cellIndexOf(target);
  const startIdx = routeBoard.cellIndexOf(from);
  const startNode = space.startNode(startIdx);
  const parent = new Int32Array(N).fill(-1);
  const visited = new Uint8Array(N);
  visited[startNode] = 1;
  const queue = new Int32Array(N);
  queue[0] = startNode;
  let levelStart = 0;
  let levelEnd = 1;
  let turn = opts?.startTurn ?? 0;
  let found = -1;
  const nbuf = new Int32Array(space.neighborCapacity);
  const rayOpen = (cell: number): boolean => pass.passableIdx(cell, turn);

  while (levelStart < levelEnd && found < 0) {
    let nextEnd = levelEnd;
    turn++;
    for (let q = levelStart; q < levelEnd && found < 0; q++) {
      const cur = queue[q];
      const curCell = space.cellOf(cur);
      const nCount = space.fillNeighbors(cur, rayOpen, nbuf);
      for (let t = 0; t < nCount; t++) {
        const n = nbuf[t];
        if (visited[n] === 1) continue;
        const cell = space.cellOf(n);
        // The target cell itself is never passability-tested: arriving on it is
        // the goal, and `near` deliberately measures the distance to a cell it
        // will not enter.
        if (cell === targetIdx) {
          parent[n] = cur;
          found = n;
          break;
        }
        // A turn spent turning stays put, so it enters no square: only a step
        // that actually changes cells is tested for passability/occupancy.
        if (cell !== curCell) {
          if (!pass.passableIdx(cell, turn)) continue;
          if (occupied && occupied(cell, turn)) continue;
        }
        visited[n] = 1;
        parent[n] = cur;
        queue[nextEnd++] = n;
      }
    }
    levelStart = levelEnd;
    levelEnd = nextEnd;
  }

  if (found < 0) return null;

  // Reconstruct from → target, then drop `from` (callers anchor at it).
  const route: RouteStep[] = [];
  for (let cur = found; cur !== startNode && cur !== -1; cur = parent[cur]) {
    const cell = space.cellOf(cur);
    const step: RouteStep = { cell: { x: cell % W, y: Math.floor(cell / W) } };
    // Same square as the turn before it → the turn was spent turning, and the
    // node's own orientation is what the unit now faces.
    if (space.cellOf(parent[cur]) === cell) step.rotation = space.orientationOf(cur);
    route.push(step);
  }
  route.reverse();
  return route;
}

/**
 * The cells-only projection of `waypointRoute`: one Coord per turn, with a turn
 * spent turning repeating the square it was spent on. Distance = path.length.
 */
export function waypointPath(
  gameState: GameState,
  ourSnakeId: string,
  from: Coord,
  target: Coord,
  opts?: WaypointPathOptions
): Coord[] | null {
  const route = waypointRoute(gameState, ourSnakeId, from, target, opts);
  return route === null ? null : route.map(step => step.cell);
}

/** Shortest-plan distance in TURNS from `from` to `target`, or null if unreachable. */
export function waypointDistance(
  gameState: GameState,
  ourSnakeId: string,
  from: Coord,
  target: Coord,
  opts?: WaypointPathOptions
): number | null {
  const route = waypointRoute(gameState, ourSnakeId, from, target, opts);
  return route === null ? null : route.length;
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

// One candidate's measured progress toward the active waypoint: the BFS
// distance still to run from it (null = unreachable) and the bounded stat the
// weight multiplies.
export interface WaypointCandidateProgress {
  dist: number | null;
  stat: number;
}

/**
 * Waypoint progress for arbitrary candidate STATES, index-aligned with
 * `probes`: the baseline distance from `from` (the head unless a caller anchors
 * elsewhere) and one search per candidate with startTurn 1 (the probe state is
 * one move in the future), mapped through the pure progress-stat functions
 * above.
 *
 * Probe-keyed because a candidate is where the turn LEAVES the unit: a snake's
 * four steps and a piece's ray/jump destinations are squares, and a pawn's
 * quarter turn is the same square facing a new way. All three are measured by
 * exactly this code, over the unit's own search space, so no caller
 * re-derives what "one turn closer" means for its unit type.
 */
export function waypointProgressByDestination(
  gameState: GameState,
  ourSnakeId: string,
  waypoint: WaypointContext,
  probes: WaypointProbe[],
  opts?: { board?: RouteBoard; from?: Coord }
): WaypointCandidateProgress[] {
  const routeBoard = opts?.board ?? new RouteBoard(gameState);
  const from = opts?.from ?? gameState.you.head;
  const target = waypoint.target;
  const baseDist = waypointDistance(gameState, ourSnakeId, from, target, { board: routeBoard });
  const statOf = waypoint.kind === 'goto' ? gotoProgressStat : nearProgressStat;

  return probes.map(probe => {
    const dist = waypointDistance(gameState, ourSnakeId, probe.cell, target, {
      board: routeBoard,
      startTurn: 1,
      orientation: probe.orientation,
    });
    return { dist, stat: statOf(baseDist, dist) };
  });
}

/**
 * The per-move waypoint progress table for the active goto/near target: the
 * destination-keyed measurement above, taken at the four step destinations.
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
  opts?: { board?: RouteBoard }
): WaypointProgressByMove | null {
  if (!waypoint) return null;
  const head = gameState.you.head;
  const progress = waypointProgressByDestination(
    gameState,
    gameState.you.id,
    waypoint,
    ALL_MOVES.map(move => ({ cell: destinationOf(head, move) })),
    opts
  );

  const result: WaypointProgressByMove = {};
  ALL_MOVES.forEach((move, i) => {
    result[move] = {
      gotoProgress: waypoint.kind === 'goto' ? progress[i].stat : 0,
      nearProgress: waypoint.kind === 'near' ? progress[i].stat : 0,
    };
  });
  return result;
}
