/**
 * Multi-source BFS implementation for efficient board analysis.
 * Computes voronoi territories, distances, and food control in a single pass.
 * Processes cells level-by-level to properly detect ties.
 * Supports optimistic passability for body segments.
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

export interface BFSSource {
  id: string;
  position: Coord;
  isTeam: boolean;
  startDelay?: number;
}

// Ownership sentinels for BFSResult.ownerIndex. Every consumer comparing
// against ownerIndex must use these names, never raw literals.
export const OWNER_UNREACHED = -2;  // no source reaches this cell
export const OWNER_NEUTRAL = -1;    // tied arrival — nobody owns or expands from it

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

    let currentDistance = 0;
    const touched: number[] = []; // cells whose per-level masks need resetting

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
          const srcIdx = 31 - Math.clz32(mask);
          owner[cell] = srcIdx;
          dist[cell] = currentDistance;
          territoryCount[srcIdx]++;
          if (foodMask[cell] === 1) {
            foodCount[srcIdx]++;
            updateNearestFood(srcIdx, currentDistance);
          }
          if (fertileMask[cell] === 1) fertileCount[srcIdx]++;
        } else {
          // Multiple sources tie — neutral cell; nobody expands from it, but
          // food here still counts toward every reaching source's nearest-food.
          owner[cell] = OWNER_NEUTRAL;
          dist[cell] = currentDistance;
          if (foodMask[cell] === 1) {
            let m = mask;
            while (m !== 0) {
              const srcIdx = 31 - Math.clz32(m);
              updateNearestFood(srcIdx, currentDistance);
              m &= ~(1 << srcIdx);
            }
          }
        }
      }

      // Third pass: expand next level from cells owned by the arriving source.
      // Dedup (neighbor, source) enqueues with per-level masks.
      const arrivalTurn = currentDistance + 1;
      const enqueueTouched: number[] = [];
      for (let q = 0; q < curCell.length; q++) {
        const cell = curCell[q];
        const srcIdx = curSrc[q];
        if (owner[cell] !== srcIdx) continue; // neutral or claimed by another source

        const x = cell % W;
        const n0 = cell + W < N ? cell + W : -1;
        const n1 = cell - W >= 0 ? cell - W : -1;
        const n2 = x > 0 ? cell - 1 : -1;
        const n3 = x < W - 1 ? cell + 1 : -1;
        for (let t = 0; t < 4; t++) {
          const n = t === 0 ? n0 : t === 1 ? n1 : t === 2 ? n2 : n3;
          if (n < 0) continue;
          if (owner[n] !== OWNER_UNREACHED) continue;
          const bit = 1 << srcIdx;
          if ((enqueuedMask[n] & bit) !== 0) continue;
          const passable = useOptimistic
            ? graph.isPassableAtTurnIdx(n, arrivalTurn)
            : graph.isPassableStaticIdx(n);
          if (!passable) continue;
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
