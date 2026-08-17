/**
 * Multi-source BFS implementation for efficient board analysis.
 * Computes voronoi territories, distances, and food control in a single pass.
 * Processes cells level-by-level to properly detect ties.
 * Supports optimistic passability for body segments.
 *
 * Each source expands by ITS OWN unit adjacency (BoardGraph.fillUnitNeighbors),
 * so a distance level is one MOVE of that unit — a knight's territory grows in
 * L-jumps, a rook's along rays — and the ownership rules below apply to those
 * arrivals unchanged.
 *
 * OWNERSHIP RULE. A cell reached STRICTLY first by one source is that source's,
 * whatever its tier or weight — first arrival is uncontested. A cell reached by
 * several sources on the SAME level is a race that resolves into a collision,
 * so the engine's collision adjudication settles it: `stationaryContestWinner`
 * (piece-threats — tier FIRST, projected onto the arrival turn, then unique
 * heaviest weight among the top tier). The unique survivor OWNS the cell and
 * expands from it exactly like a first-arrival owner; when the contest has no
 * unique survivor — top tier shared, heaviest weight not unique — the cell is
 * OWNER_NEUTRAL and nobody expands through it. The rule is uniform: allied and
 * enemy sources are adjudicated alike, this engine having no friendly exemption
 * anywhere.
 *
 * The contest data travels on the sources (`weight`, `tierAtDistance`), never
 * as game-state objects: the BFS stays a graph algorithm over integers, and
 * the callers that own snakes/pieces supply their tier and weight (see
 * `unitContestData`). Sources without contest data carry weight 0 at tier 0,
 * so their same-level ties stay neutral.
 *
 * The BFS is integer-indexed typed arrays throughout (see BoardGraph):
 * ownership and distance live in flat Int16Arrays and per-level tie detection
 * uses 32-bit source masks. The per-snake territory coordinate lists (UI /
 * projections) are materialized in one O(cells) pass at the end — and only
 * when the caller actually wants them (collectCells). Chunked minimax
 * evaluation runs thousands of these per turn and reads only the aggregates
 * plus the raw owner array.
 */

import { Coord } from '../types/battlesnake';
import { BoardGraph } from './board-graph';
import { stationaryContestWinner } from './piece-threats';

export interface BFSSource {
  id: string;
  position: Coord;
  isTeam: boolean;
  startDelay?: number;
  /**
   * This source's contest WEIGHT (a unit's `length`: body length for snakes,
   * stack size for pieces), consulted only when sources arrive on the same
   * level. Omitted = 0, which makes such ties unresolvable and so neutral.
   */
  weight?: number;
  /**
   * This source's invulnerability tier PROJECTED onto the turn it arrives,
   * `distance` levels from the start of the search — the caller knows which
   * turn that is (see `unitContestData`). Consulted only for same-level
   * arrivals; omitted = tier 0.
   */
  tierAtDistance?: (distance: number) => number;
}

// Ownership sentinels for BFSResult.ownerIndex. Every consumer comparing
// against ownerIndex must use these names, never raw literals.
export const OWNER_UNREACHED = -2;  // no source reaches this cell
export const OWNER_NEUTRAL = -1;    // same-level arrival with no contest winner — nobody owns or expands from it

// A JSON-serializable snapshot of a Voronoi result for UI / log consumers:
// per-cell owner (index into `sources`, or OWNER_NEUTRAL / OWNER_UNREACHED)
// and BFS distance from the owner's head. Cell index = y * width + x. The
// client-side cell inspector mirrors the sentinel values.
export interface CellOwnership {
  width: number;
  height: number;
  sources: string[];
  owner: number[];
  distance: number[];
  // Physical vacate turn per cell (0 = already free): when the body segment
  // currently on the cell will have cleared under the shared turn-aware
  // clearance prediction. Lets the UI explain body cells owned as FUTURE
  // territory (owner arrives at distance >= vacate turn).
  vacatesAt: number[];
}

export interface BFSResult {
  // Territory counts per source
  territoryCounts: Map<string, number>;

  // Territory cells per source (actual coordinates; empty when collectCells: false)
  territoryCells: Map<string, Coord[]>;

  // Controlled food counts per source
  controlledFood: Map<string, number>;

  // Controlled fertile tile counts per source
  controlledFertile: Map<string, number>;

  // Nearest food distance per source
  nearestFoodDistance: Map<string, number>;

  // Team aggregates
  teamTerritory: number;
  teamControlledFood: number;
  enemyTerritory: number;

  // Raw integer core:
  // ownerIndex[cellIdx] = source index owning the cell, or OWNER_NEUTRAL /
  // OWNER_UNREACHED.
  ownerIndex: Int16Array;
  // distanceIndex[cellIdx] = BFS distance for reached cells (unspecified otherwise).
  distanceIndex: Int16Array;
  // Source id -> source index into ownerIndex values.
  sourceIndexOf: Map<string, number>;
}

export interface BFSOptions {
  optimistic: boolean;
  // Materialize the per-source territory coordinate lists (used by the UI and
  // projections). Defaults to true; the chunked evaluation path passes false
  // and reads only the aggregates + ownerIndex.
  collectCells?: boolean;
}


/** Territory cell lists as a plain JSON-serializable object (UI/log shape). */
export function territoryCellsToObject(result: BFSResult): { [snakeId: string]: Coord[] } {
  const obj: { [snakeId: string]: Coord[] } = {};
  for (const [snakeId, cells] of result.territoryCells) {
    obj[snakeId] = cells;
  }
  return obj;
}

/**
 * Build the serializable CellOwnership snapshot from a BFS result. The single
 * construction path for every ownership payload (current-board and projected),
 * so the wire shape and vacate-turn sourcing can never drift between them.
 */
export function toCellOwnership(result: BFSResult, sources: BFSSource[], graph: BoardGraph): CellOwnership {
  return {
    width: graph.boardWidth,
    height: graph.boardHeight,
    sources: sources.map(s => s.id),
    owner: Array.from(result.ownerIndex),
    distance: Array.from(result.distanceIndex),
    // Memoized per graph (all ownership snapshots for a turn share the same
    // graph); read-only by contract — consumers only serialize it.
    vacatesAt: graph.physicalVacateTurns(),
  };
}

export class MultiSourceBFS {
  private graph: BoardGraph;

  constructor(graph: BoardGraph) {
    this.graph = graph;
  }

  /**
   * Run multi-source BFS from all snake heads in a single pass.
   * O(W×H) complexity - each cell visited at most once.
   * Processes level-by-level to properly handle ties.
   *
   * @param sources - BFS starting points (snake heads)
   * @param foodPositions - Food locations on the board
   * @param options - BFS options including optimistic passability
   */
  compute(sources: BFSSource[], foodPositions: Coord[], options?: BFSOptions, fertilePositions?: Coord[]): BFSResult {
    const useOptimistic = options?.optimistic ?? false;
    const collectCells = options?.collectCells ?? true;
    const graph = this.graph;
    const W = graph.boardWidth;
    const N = graph.cellCount;

    if (sources.length > 32) {
      throw new Error(`MultiSourceBFS supports at most 32 sources (got ${sources.length})`);
    }

    // Integer core state.
    const owner = new Int16Array(N).fill(OWNER_UNREACHED);
    const dist = new Int16Array(N);
    const reachedMask = new Uint32Array(N);   // per-level: bitmask of sources arriving
    const enqueuedMask = new Uint32Array(N);  // per-level: dedup of (cell, source) enqueues
    const foodMask = new Uint8Array(N);
    const fertileMask = new Uint8Array(N);
    for (const f of foodPositions) foodMask[graph.cellIndexOf(f)] = 1;
    for (const f of fertilePositions || []) fertileMask[graph.cellIndexOf(f)] = 1;

    // Per-source aggregates (indexed by source position in `sources`).
    const nSources = sources.length;
    const territoryCount = new Int32Array(nSources);
    const foodCount = new Int32Array(nSources);
    const fertileCount = new Int32Array(nSources);
    const nearestFood = new Int32Array(nSources).fill(-1); // -1 = none found

    const sourceIndexOf = new Map<string, number>();
    for (let i = 0; i < nSources; i++) sourceIndexOf.set(sources[i].id, i);

    // Each source claims territory by ITS OWN movement: the graph's per-unit
    // adjacency expands a knight in L-jumps and a rook along rays, while a
    // snake still steps one cell. Only the expansion metric is per-unit — the
    // level-by-level arrival, tie and contest semantics below are untouched.
    const unitOf = sources.map(s => graph.unitAdjacencyFor(s.id));

    // Frontier as parallel arrays of (cellIdx, sourceIdx).
    let curCell: number[] = [];
    let curSrc: number[] = [];
    let nextCell: number[] = [];
    let nextSrc: number[] = [];

    // Separate sources by startDelay.
    const delayed = new Map<number, number[]>(); // delay -> source indices
    let pendingDelayed = 0;
    for (let i = 0; i < nSources; i++) {
      const delay = sources[i].startDelay ?? 0;
      if (delay === 0) {
        curCell.push(graph.cellIndexOf(sources[i].position));
        curSrc.push(i);
      } else {
        if (!delayed.has(delay)) delayed.set(delay, []);
        delayed.get(delay)!.push(i);
        pendingDelayed++;
      }
    }

    const updateNearestFood = (srcIdx: number, d: number): void => {
      if (nearestFood[srcIdx] === -1 || d < nearestFood[srcIdx]) nearestFood[srcIdx] = d;
    };

    // A source takes a cell it reached at `d` — whether it got there alone or
    // won the contest for it. One bookkeeping path, so a contested cell counts
    // toward territory and food exactly like an uncontested one.
    const claimCell = (cell: number, srcIdx: number, d: number): void => {
      owner[cell] = srcIdx;
      dist[cell] = d;
      territoryCount[srcIdx]++;
      if (foodMask[cell] === 1) {
        foodCount[srcIdx]++;
        updateNearestFood(srcIdx, d);
      }
      if (fertileMask[cell] === 1) fertileCount[srcIdx]++;
    };

    // Contest scratch, reused across contested cells (at most 32 sources).
    const contestSrc = new Int32Array(32);
    const contestTier = new Int32Array(32);
    const contestWeight = new Float64Array(32);

    let currentDistance = 0;
    const touched: number[] = []; // cells whose per-level masks need resetting
    const nbuf = graph.neighborBuffer(); // fillUnitNeighbors scratch
    // Arrival turn of the level being expanded, read by the passability test
    // below and by the ray-stop test inside the adjacency enumeration.
    let arrivalTurn = 1;
    const passableAt = (cell: number): boolean => useOptimistic
      ? graph.isPassableAtTurnIdx(cell, arrivalTurn)
      : graph.isPassableStaticIdx(cell);

    while (curCell.length > 0 || pendingDelayed > 0) {
      // Inject delayed sources that start at this distance level.
      const inject = delayed.get(currentDistance);
      if (inject) {
        for (const srcIdx of inject) {
          curCell.push(graph.cellIndexOf(sources[srcIdx].position));
          curSrc.push(srcIdx);
        }
        pendingDelayed -= inject.length;
        delayed.delete(currentDistance);
      }

      if (curCell.length === 0) {
        currentDistance++;
        continue;
      }

      // First pass: collect which sources reach each cell at this distance.
      // Distance 0 items are source heads — unique per source, assigned directly.
      touched.length = 0;
      for (let q = 0; q < curCell.length; q++) {
        const cell = curCell[q];
        const srcIdx = curSrc[q];
        if (currentDistance === 0) {
          owner[cell] = srcIdx;
          dist[cell] = 0;
          territoryCount[srcIdx] = 1;
          if (foodMask[cell] === 1) { foodCount[srcIdx]++; nearestFood[srcIdx] = 0; }
          if (fertileMask[cell] === 1) fertileCount[srcIdx]++;
        } else {
          if (owner[cell] !== OWNER_UNREACHED) continue; // already claimed at a nearer level
          if (reachedMask[cell] === 0) touched.push(cell);
          reachedMask[cell] |= (1 << srcIdx);
        }
      }

      // Second pass: assign ownership or mark neutral for cells at this distance.
      for (const cell of touched) {
        const mask = reachedMask[cell];
        if (mask === 0) continue;
        if ((mask & (mask - 1)) === 0) {
          // Exactly one source reaches this cell — it owns it.
          claimCell(cell, 31 - Math.clz32(mask), currentDistance);
        } else {
          // Several sources arrive together: the race ends in a collision, so
          // the engine's contest rule adjudicates it on tiers projected to THIS
          // arrival level and on weights.
          let n = 0;
          let m = mask;
          while (m !== 0) {
            const srcIdx = 31 - Math.clz32(m);
            const source = sources[srcIdx];
            contestSrc[n] = srcIdx;
            contestTier[n] = source.tierAtDistance?.(currentDistance) ?? 0;
            contestWeight[n] = source.weight ?? 0;
            n++;
            m &= ~(1 << srcIdx);
          }
          const winner = stationaryContestWinner(contestTier, contestWeight, n);
          if (winner >= 0) {
            // The survivor holds the cell and expands from it (third pass), the
            // losers gaining nothing there — same as arriving a level late.
            claimCell(cell, contestSrc[winner], currentDistance);
          } else {
            // Nobody survives the collision — neutral cell; nobody expands from
            // it, but food here still counts toward every arriving source's
            // nearest-food.
            owner[cell] = OWNER_NEUTRAL;
            dist[cell] = currentDistance;
            if (foodMask[cell] === 1) {
              for (let i = 0; i < n; i++) updateNearestFood(contestSrc[i], currentDistance);
            }
          }
        }
      }

      // Third pass: expand next level from cells owned by the arriving source.
      // Dedup (neighbor, source) enqueues with per-level masks.
      arrivalTurn = currentDistance + 1;
      const enqueueTouched: number[] = [];
      for (let q = 0; q < curCell.length; q++) {
        const cell = curCell[q];
        const srcIdx = curSrc[q];
        if (owner[cell] !== srcIdx) continue; // neutral or claimed by another source

        const nCount = graph.fillUnitNeighbors(unitOf[srcIdx], cell, passableAt, nbuf);
        for (let t = 0; t < nCount; t++) {
          const n = nbuf[t];
          if (owner[n] !== OWNER_UNREACHED) continue;
          const bit = 1 << srcIdx;
          if ((enqueuedMask[n] & bit) !== 0) continue;
          if (!passableAt(n)) continue;
          if (enqueuedMask[n] === 0) enqueueTouched.push(n);
          enqueuedMask[n] |= bit;
          nextCell.push(n);
          nextSrc.push(srcIdx);
        }
      }

      // Reset per-level masks (only the touched cells).
      for (const cell of touched) reachedMask[cell] = 0;
      for (const cell of enqueueTouched) enqueuedMask[cell] = 0;

      // Advance to the next level.
      const tmpCell = curCell, tmpSrc = curSrc;
      curCell = nextCell; curSrc = nextSrc;
      nextCell = tmpCell; nextSrc = tmpSrc;
      nextCell.length = 0; nextSrc.length = 0;
      currentDistance++;
    }

    // Materialize per-source territory coordinate lists (only when wanted).
    const territoryCells = new Map<string, Coord[]>();
    for (const source of sources) territoryCells.set(source.id, []);
    if (collectCells) {
      for (let idx = 0; idx < N; idx++) {
        const o = owner[idx];
        if (o >= 0) {
          territoryCells.get(sources[o].id)!.push({ x: idx % W, y: Math.floor(idx / W) });
        }
      }
    }

    // Per-source result maps + team aggregates.
    const territoryCounts = new Map<string, number>();
    const controlledFood = new Map<string, number>();
    const controlledFertile = new Map<string, number>();
    const nearestFoodDistance = new Map<string, number>();
    let teamTerritory = 0, teamControlledFood = 0, enemyTerritory = 0;

    for (let i = 0; i < nSources; i++) {
      const source = sources[i];
      territoryCounts.set(source.id, territoryCount[i]);
      controlledFood.set(source.id, foodCount[i]);
      controlledFertile.set(source.id, fertileCount[i]);
      nearestFoodDistance.set(source.id, nearestFood[i] === -1 ? 1000 : nearestFood[i]);
      if (source.isTeam) {
        teamTerritory += territoryCount[i];
        teamControlledFood += foodCount[i];
      } else {
        enemyTerritory += territoryCount[i];
      }
    }

    return {
      territoryCounts,
      territoryCells,
      controlledFood,
      controlledFertile,
      nearestFoodDistance,
      teamTerritory,
      teamControlledFood,
      enemyTerritory,
      ownerIndex: owner,
      distanceIndex: dist,
      sourceIndexOf
    };
  }
}
