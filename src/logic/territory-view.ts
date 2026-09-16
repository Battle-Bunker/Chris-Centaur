/**
 * TERRITORY VIEW — the board-wide partition the interface draws.
 *
 * The Alt-click cell inspector asks one question of every square: whose is it,
 * and how far away is its owner? The overlay asks the same question of the
 * whole grid at once. Both used to be answered by a by-product of the legacy
 * decision path — `voronoi-strategy` handed `multi-source-bfs`'s ownership
 * planes to the UI on the way past — so the moment the shipped decision path
 * stopped being that one, the overlay went dark and nothing said so. This
 * module answers the question directly, from the board, for its own sake.
 *
 * WHAT A PARTITION MEANS HERE. One BFS level is one TURN, and a unit advances
 * through its own moves — so a knight's territory grows in L-jumps and a
 * rook's along its rays, from the same loop, because the frontier walks
 * `route.ts`'s per-unit search space and that space is the vendored grammar.
 * The nearest unit owns a cell; units that arrive on the same turn own
 * nothing there (`OWNER_NEUTRAL`), because a square two units reach together
 * is a square neither of them controls. Nothing here adjudicates what would
 * HAPPEN if they both went — that is a contest, the engine owns it, and a map
 * has no business predicting it.
 *
 * The partition is deliberately not the one the search scores with
 * (`lobster/evaluate/territory.ts`): that one is computed inside a decision,
 * over a plan, and exists to be differenced against alternatives. This one is
 * a property of the board on screen, computed once per turn for everybody
 * looking at it.
 */

import type { BoardSnapshot, Coord } from '../types/battlesnake';
import { RouteBoard } from './route';

/** No unit reaches this cell. */
export const OWNER_UNREACHED = -2;
/** Reached by two or more units on the same turn — nobody holds it. */
export const OWNER_NEUTRAL = -1;

/**
 * The serializable partition, one entry per board cell in api index order
 * (`y * width + x`, y up).
 */
export interface CellOwnership {
  width: number;
  height: number;
  /** Unit ids, in board order. `owner` indexes into this. */
  sources: string[];
  /** Source index owning each cell, or OWNER_NEUTRAL / OWNER_UNREACHED. */
  owner: number[];
  /** Turns for the owner to arrive; 0 on a unit's own head, -1 when unreached. */
  distance: number[];
  /**
   * Turns until the body segment on each cell clears (0 = already free). Lets
   * the interface explain a body cell owned as FUTURE territory — the owner
   * arrives at a distance at or beyond the vacate turn.
   */
  vacatesAt: number[];
}

const UNREACHED_DISTANCE = -1;

/**
 * The partition of the whole board for one turn.
 *
 * Every living unit is a source, whatever its kind: holding the grid per BOARD
 * rather than per unit is what lets a piece's selection show the same overlay
 * a snake's does.
 */
export function computeTerritoryView(state: BoardSnapshot): CellOwnership {
  const board = new RouteBoard(state);
  const N = board.cellCount;
  const units = board.sources();

  const owner = new Array<number>(N).fill(OWNER_UNREACHED);
  const distance = new Array<number>(N).fill(UNREACHED_DISTANCE);

  if (units.length === 0) {
    return {
      width: board.boardWidth,
      height: board.boardHeight,
      sources: [],
      owner,
      distance,
      vacatesAt: board.vacateTurns(),
    };
  }

  // Per-source machinery: its own search space (so a pawn plans through its
  // facing), its own passability (so it is not blocked by its own receding
  // tail), and its own visited set over that space's nodes.
  const spaces = units.map((u) => board.searchSpaceFor(u.unit));
  const passable = units.map((u) => board.passabilityFor(u.id));
  const visited = spaces.map((space) => new Uint8Array(space.nodeCount));
  let frontier: number[][] = units.map((u, i) => {
    const start = spaces[i].startNode(u.headIdx);
    visited[i][start] = 1;
    return [start];
  });

  // A unit's own square is its own, at distance 0. Two units cannot share one,
  // so no contest arises here.
  units.forEach((u, i) => {
    owner[u.headIdx] = i;
    distance[u.headIdx] = 0;
  });

  const nbuf = board.neighborBuffer();
  // Claims raised at the current level, cell -> the single claimant, or
  // OWNER_NEUTRAL once a second one appears.
  const claims = new Map<number, number>();

  for (let turn = 1; frontier.some((f) => f.length > 0); turn++) {
    claims.clear();
    const next: number[][] = units.map(() => []);

    for (let i = 0; i < units.length; i++) {
      const space = spaces[i];
      const open = (cell: number): boolean => passable[i].passableIdx(cell, turn);
      for (const node of frontier[i]) {
        const count = space.fillNeighbors(node, open, nbuf);
        for (let t = 0; t < count; t++) {
          const n = nbuf[t];
          if (visited[i][n] === 1) continue;
          const cell = space.cellOf(n);
          // A cell already settled by somebody else is a wall to us: the
          // partition is nearest-owner, and expanding through another unit's
          // territory would make distance mean something other than turns.
          if (owner[cell] !== OWNER_UNREACHED && owner[cell] !== i) continue;
          // A turn spent turning enters no square, so it is never
          // passability-tested; a step that changes cells is.
          if (cell !== space.cellOf(node) && !open(cell)) continue;
          visited[i][n] = 1;
          next[i].push(n);
          if (owner[cell] === i) continue; // already ours (a rotation, or a nearer node)
          const claimant = claims.get(cell);
          if (claimant === undefined) claims.set(cell, i);
          else if (claimant !== i) claims.set(cell, OWNER_NEUTRAL);
        }
      }
    }

    for (const [cell, claimant] of claims) {
      if (owner[cell] !== OWNER_UNREACHED) continue;
      owner[cell] = claimant;
      distance[cell] = turn;
    }

    frontier = next;
  }

  return {
    width: board.boardWidth,
    height: board.boardHeight,
    sources: units.map((u) => u.id),
    owner,
    distance,
    vacatesAt: board.vacateTurns(),
  };
}

/**
 * The same partition as per-unit cell lists — the shape the territory overlay
 * paints from. Neutral and unreached cells belong to nobody and appear in no
 * list.
 */
export function territoryCellsOf(ownership: CellOwnership): { [unitId: string]: Coord[] } {
  const cells: { [unitId: string]: Coord[] } = {};
  for (const id of ownership.sources) cells[id] = [];
  ownership.owner.forEach((o, idx) => {
    if (o < 0) return;
    const id = ownership.sources[o];
    if (id === undefined) return;
    cells[id].push({ x: idx % ownership.width, y: Math.floor(idx / ownership.width) });
  });
  return cells;
}
