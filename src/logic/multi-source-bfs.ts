/**
 * Multi-source BFS implementation for efficient board analysis.
 * Computes voronoi territories, distances, and food control in a single pass.
 * Processes cells level-by-level to properly detect ties.
 * Supports optimistic passability for body segments.
 *
 * OWNERSHIP RULE — SNAKES HOLD GROUND, PIECES DISPLACE BY WEIGHT.
 *
 * Territory answers "how is the board divided among the units that can control
 * it", and only a snake can actually OCCUPY ground (it has a body; a chess
 * piece is a single square that stands and fights). So snakes divide the board
 * and set the clock, and pieces take squares off them by winning the fight:
 *
 *  1. SNAKE PLANE. The snakes alone run the classic level-by-level Voronoi over
 *     snake steps: a cell reached STRICTLY first by one snake is that snake's;
 *     a cell several snakes reach on the SAME level is a race that ends in a
 *     collision, so the engine's adjudication settles it — `stationaryContestWinner`
 *     (piece-threats: tier FIRST, projected onto the arrival turn, then unique
 *     heaviest weight among the top tier). The unique survivor owns the cell and
 *     expands from it; with no unique survivor the cell is a TIED CLAIM held by
 *     nobody, and — as since 9da1966 — no snake expands through it.
 *
 *  2. DECISIVE TURN. Each cell's claim fixes the turn its ownership is settled:
 *     D = the level at which the first snake could be standing there. Cells no
 *     snake reaches have no snake claim, and their D is instead the earliest
 *     level any PIECE reaches them. Every tier below is projected onto D, the
 *     turn the square is actually decided.
 *
 *  3. CHALLENGERS. A piece challenges a cell when it could be STANDING there by
 *     turn D — its own arrival distance is <= D — and it WINS the stationary
 *     contest against the claim (tier at D first, then strictly greater weight;
 *     `winsStationaryContest`). That is exactly "could this piece hold the cell
 *     against the first snake to reach it". A piece that needs longer than D is
 *     no challenger at all: the snake was standing on the ground first, which is
 *     what makes this snake-primary rather than "longest reach wins". Without
 *     that arrival gate a queen would own every square it can see.
 *
 *  4. DISPLACEMENT. Among the challengers, the EARLIEST to arrive takes the
 *     cell, and challengers arriving together are separated by the same
 *     stationary contest — the snake plane's own shape (arrival first, contest
 *     for the ties), one level up. The winner keeps the cell outright: later
 *     snakes never re-open the question.
 *
 *     Challengers that produce no unique survivor have displaced NOBODY, so the
 *     snake claim stands — a piece layer can change who holds ground, never
 *     vacate it. Two equally heavy rooks that would annihilate each other over a
 *     square simply fail to take it off the snake, which is the informative
 *     reading and keeps the snakes' partition legible instead of drowning the
 *     board in grey the moment a game fields matched pieces. OWNER_NEUTRAL
 *     therefore keeps its one long-standing meaning — a square two SNAKES would
 *     die on — with the single honest exception of a cell no snake can reach at
 *     all, where an inconclusive piece contest really does leave it held by
 *     nobody.
 *
 * WHY PIECE REACH IS COMPUTED INDEPENDENTLY. Each piece's arrival distances are
 * a plain single-source search over ITS OWN adjacency (BoardGraph.fillUnitNeighbors
 * — L-jumps for a knight, rays for a rook), expanding from every square it has
 * reached and consulting only PHYSICAL passability. It is deliberately NOT gated
 * on ownership. Gating expansion on ownership is what produced the "Unreached"
 * pathology this rule replaces: equal-weight sliders arrive at whole rows and
 * columns on the same level, every one of those arrivals tied into a
 * non-expanding neutral cell, and the resulting neutral lattice walled off
 * board interiors that every unit could plainly reach — reported to the user as
 * "no snake can get here". Reach is geometry; ownership is a projection over
 * hypothetical futures, and letting the projection veto the geometry is a
 * feedback loop, not a fact about the board.
 *
 * A unit always holds the square it stands on: a snake head is claimed at D = 0,
 * where no piece can be in time, and a piece's own square is a physical wall no
 * snake can reach, so its D is that piece's own 0.
 *
 * The contest data travels on the sources (`weight`, `tierAtDistance`), never
 * as game-state objects: the BFS stays a graph algorithm over integers, and
 * the callers that own snakes/pieces supply their tier and weight (see
 * `unitContestData`). Sources without contest data carry weight 0 at tier 0,
 * so their ties stay neutral. Whether a source is a snake or a piece is read
 * off the graph's own adjacency descriptor, so callers need say nothing.
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
import { BoardGraph, UnitAdjacency } from './board-graph';
import { stationaryContestWinner, winsStationaryContest } from './piece-threats';

export interface BFSSource {
  id: string;
  position: Coord;
  isTeam: boolean;
  startDelay?: number;
  /**
   * This source's contest WEIGHT (a unit's `length`: body length for snakes,
   * stack size for pieces), consulted whenever the source contests a cell.
   * Omitted = 0, which makes such contests unresolvable and so neutral.
   */
  weight?: number;
  /**
   * This source's invulnerability tier PROJECTED onto a turn `distance` levels
   * from the start of the search — the caller knows which turn that is (see
   * `unitContestData`). Read at the turn a cell's ownership is settled;
   * omitted = tier 0.
   */
  tierAtDistance?: (distance: number) => number;
}

// Ownership sentinels for BFSResult.ownerIndex. Every consumer comparing
// against ownerIndex must use these names, never raw literals.
export const OWNER_UNREACHED = -2;  // no unit reaches this cell
export const OWNER_NEUTRAL = -1;    // contested with no survivor — nobody holds it

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
  // distanceIndex[cellIdx] = the owner's own arrival distance for owned cells,
  // the decisive turn for neutral ones (unspecified for unreached cells).
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

// A cell whose ownership no unit has scheduled a contest for yet.
const NO_DECISIVE_TURN = 0x7fffffff;

/**
 * The snake-only half of the division: who reaches each cell first, and — for
 * the contest that settles it — at what turn and against what (tier, weight).
 */
interface SnakePlane {
  owner: Int16Array;        // source index, OWNER_NEUTRAL (tied claim), OWNER_UNREACHED
  dist: Int16Array;         // arrival level of the claim
  claimTier: Int32Array;    // the claim's tier, projected onto its own arrival level
  claimWeight: Float64Array;// the claim's weight (the top weight of a tied group)
  claimMask: Uint32Array;   // snakes credited with the claim (food attribution)
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
   * Divide the board among all sources in two passes — the snake plane, then
   * piece displacement — as documented in the module header.
   *
   * @param sources - BFS starting points (unit heads/squares)
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

    const nSources = sources.length;
    const sourceIndexOf = new Map<string, number>();
    for (let i = 0; i < nSources; i++) sourceIndexOf.set(sources[i].id, i);

    // Which unit each source moves as — and therefore which half of the rule it
    // plays under. The graph is the authority on unit type, so no caller has to
    // label its sources.
    const unitOf = sources.map(s => graph.unitAdjacencyFor(s.id));
    const snakeIdx: number[] = [];
    const pieceIdx: number[] = [];
    for (let i = 0; i < nSources; i++) {
      ((unitOf[i].unitType ?? 'snake') === 'snake' ? snakeIdx : pieceIdx).push(i);
    }

    // Physical passability at a given arrival turn. Subject-agnostic: territory
    // is a fact about the board, not about whose eyes we look through.
    const passableAtTurn = (cell: number, turn: number): boolean => useOptimistic
      ? graph.isPassableAtTurnIdx(cell, turn)
      : graph.isPassableStaticIdx(cell);

    const plane = this.computeSnakePlane(sources, snakeIdx, unitOf, passableAtTurn, N);

    // ── Piece displacement ────────────────────────────────────────────────
    // A piece-free board (the ordinary snake game, and the hot minimax path)
    // IS the snake plane: skip the challenger machinery entirely rather than
    // allocate and sweep it thousands of times per turn for nothing.
    let owner = plane.owner;
    let dist = plane.dist;
    // Who is credited with a cell for nearest-food purposes when nobody holds it.
    let creditMask = plane.claimMask;

    if (pieceIdx.length > 0) {
      // The best challenge mounted against each cell's snake claim so far:
      // earliest arrival first, and among equal arrivals the best (tier, weight)
      // with chCount recording how many share it — `stationaryContestWinner`
      // read incrementally, so a count of 1 is a survivor and anything more a
      // mutual kill.
      const chDist = new Int16Array(N);
      const chTier = new Int32Array(N);
      const chWeight = new Float64Array(N);
      const chCount = new Int32Array(N);
      const chSrc = new Int32Array(N).fill(-1);
      const chMask = new Uint32Array(N);
      const decisive = new Int32Array(N).fill(NO_DECISIVE_TURN);
      for (let cell = 0; cell < N; cell++) {
        if (plane.owner[cell] !== OWNER_UNREACHED) decisive[cell] = plane.dist[cell];
      }

      // Offer a piece's arrival as a challenger for `cell`. Late arrivals are
      // turned away at the door, pieces that cannot beat the claim never get in,
      // and the first arrival on a snake-free cell schedules that cell's contest
      // for its own turn. Arrivals reach us in nondecreasing distance order (all
      // pieces share one level counter), so the first challenger accepted is the
      // earliest and the rest either tie with it or are too late.
      const offer = (cell: number, srcIdx: number, arrivedAt: number): void => {
        let turn = decisive[cell];
        if (turn === NO_DECISIVE_TURN) {
          turn = arrivedAt;
          decisive[cell] = arrivedAt;
        } else if (arrivedAt > turn) {
          return;
        }
        const source = sources[srcIdx];
        const tier = source.tierAtDistance?.(turn) ?? 0;
        const weight = source.weight ?? 0;
        // Could it hold the cell against the snakes that claimed it?
        if (plane.owner[cell] !== OWNER_UNREACHED &&
            !winsStationaryContest(tier, weight, plane.claimTier[cell], plane.claimWeight[cell])) {
          return;
        }
        const bit = 1 << srcIdx;
        if (chCount[cell] === 0 || arrivedAt < chDist[cell]) {
          chDist[cell] = arrivedAt;
          chTier[cell] = tier;
          chWeight[cell] = weight;
          chCount[cell] = 1;
          chSrc[cell] = srcIdx;
          chMask[cell] = bit;
        } else if (arrivedAt === chDist[cell]) {
          if (winsStationaryContest(tier, weight, chTier[cell], chWeight[cell])) {
            chTier[cell] = tier;
            chWeight[cell] = weight;
            chCount[cell] = 1;
            chSrc[cell] = srcIdx;
            chMask[cell] = bit;
          } else if (!winsStationaryContest(chTier[cell], chWeight[cell], tier, weight)) {
            // Neither outranks the other: the square kills them both.
            chCount[cell]++;
            chMask[cell] |= bit;
          }
        }
      };

      this.expandPieceReach(sources, pieceIdx, unitOf, passableAtTurn, N, offer);

      // Settle every cell. A lone surviving challenger displaces the claim;
      // challengers that kill each other displace nothing, so the claim stands
      // — unless there was no claim, where an inconclusive piece contest does
      // leave the cell held by nobody.
      owner = new Int16Array(N);
      dist = new Int16Array(N);
      creditMask = chMask;
      for (let cell = 0; cell < N; cell++) {
        if (chCount[cell] === 1) {
          owner[cell] = chSrc[cell];
          dist[cell] = chDist[cell];
          continue;
        }
        if (chCount[cell] > 1 && plane.owner[cell] === OWNER_UNREACHED) {
          owner[cell] = OWNER_NEUTRAL;
          dist[cell] = chDist[cell];
          continue;
        }
        owner[cell] = plane.owner[cell];
        dist[cell] = plane.dist[cell];
        chMask[cell] = plane.claimMask[cell];
      }
    }

    // ── Aggregates in one pass over the settled board ────────────────────
    const foodMask = new Uint8Array(N);
    const fertileMask = new Uint8Array(N);
    for (const f of foodPositions) foodMask[graph.cellIndexOf(f)] = 1;
    for (const f of fertilePositions || []) fertileMask[graph.cellIndexOf(f)] = 1;

    const territoryCount = new Int32Array(nSources);
    const foodCount = new Int32Array(nSources);
    const fertileCount = new Int32Array(nSources);
    const nearestFood = new Int32Array(nSources).fill(-1); // -1 = none found

    const updateNearestFood = (srcIdx: number, d: number): void => {
      if (nearestFood[srcIdx] === -1 || d < nearestFood[srcIdx]) nearestFood[srcIdx] = d;
    };

    const territoryCells = new Map<string, Coord[]>();
    for (const source of sources) territoryCells.set(source.id, []);

    for (let cell = 0; cell < N; cell++) {
      const o = owner[cell];
      if (o === OWNER_UNREACHED) continue;
      if (o >= 0) {
        territoryCount[o]++;
        if (foodMask[cell] === 1) {
          foodCount[o]++;
          updateNearestFood(o, dist[cell]);
        }
        if (fertileMask[cell] === 1) fertileCount[o]++;
        if (collectCells) {
          territoryCells.get(sources[o].id)!.push({ x: cell % W, y: Math.floor(cell / W) });
        }
      } else if (foodMask[cell] === 1) {
        // Nobody holds the cell, but every unit that contested it can still
        // reach the food standing on it.
        let m = creditMask[cell];
        while (m !== 0) {
          const srcIdx = 31 - Math.clz32(m);
          updateNearestFood(srcIdx, dist[cell]);
          m &= ~(1 << srcIdx);
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

  /**
   * Step 1 of the rule: the snakes divide the board among themselves, level by
   * level, first arrival winning and same-level arrivals adjudicated by the
   * engine's stationary contest. A cell with no unique survivor is a tied claim
   * that nobody expands through — the long-standing rule, kept intact because
   * a snake really cannot walk over a square two snakes are dying on.
   *
   * Records, alongside owner and distance, what any later challenger has to
   * beat: the claim's (tier, weight) as of its own arrival turn.
   */
  private computeSnakePlane(
    sources: BFSSource[],
    snakeIdx: number[],
    unitOf: UnitAdjacency[],
    passableAtTurn: (cell: number, turn: number) => boolean,
    N: number,
  ): SnakePlane {
    const graph = this.graph;
    const plane: SnakePlane = {
      owner: new Int16Array(N).fill(OWNER_UNREACHED),
      dist: new Int16Array(N),
      claimTier: new Int32Array(N),
      claimWeight: new Float64Array(N),
      claimMask: new Uint32Array(N),
    };
    if (snakeIdx.length === 0) return plane;

    const reachedMask = new Uint32Array(N);   // per-level: bitmask of snakes arriving
    const enqueuedMask = new Uint32Array(N);  // per-level: dedup of (cell, snake) enqueues

    // Frontier as parallel arrays of (cellIdx, sourceIdx).
    let curCell: number[] = [];
    let curSrc: number[] = [];
    let nextCell: number[] = [];
    let nextSrc: number[] = [];

    // Separate sources by startDelay.
    const delayed = new Map<number, number[]>(); // delay -> source indices
    let pendingDelayed = 0;
    for (const i of snakeIdx) {
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

    // A snake takes a cell it reached at `d` — alone or as the survivor of the
    // race for it. One bookkeeping path, so a contested claim carries exactly
    // the same challenge data as an uncontested one.
    const claimCell = (cell: number, srcIdx: number, d: number): void => {
      plane.owner[cell] = srcIdx;
      plane.dist[cell] = d;
      plane.claimTier[cell] = sources[srcIdx].tierAtDistance?.(d) ?? 0;
      plane.claimWeight[cell] = sources[srcIdx].weight ?? 0;
      plane.claimMask[cell] = 1 << srcIdx;
    };

    // Contest scratch, reused across contested cells (at most 32 sources).
    const contestSrc = new Int32Array(32);
    const contestTier = new Int32Array(32);
    const contestWeight = new Float64Array(32);

    let currentDistance = 0;
    const touched: number[] = []; // cells whose per-level masks need resetting
    const nbuf = graph.neighborBuffer(); // fillUnitNeighbors scratch

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

      // First pass: collect which snakes reach each cell at this distance.
      touched.length = 0;
      for (let q = 0; q < curCell.length; q++) {
        const cell = curCell[q];
        if (plane.owner[cell] !== OWNER_UNREACHED) continue; // already claimed at a nearer level
        if (reachedMask[cell] === 0) touched.push(cell);
        reachedMask[cell] |= (1 << curSrc[q]);
      }

      // Second pass: assign ownership or mark the claim tied, for cells at this distance.
      for (const cell of touched) {
        const mask = reachedMask[cell];
        if (mask === 0) continue;
        if ((mask & (mask - 1)) === 0) {
          // Exactly one snake reaches this cell — it owns it.
          claimCell(cell, 31 - Math.clz32(mask), currentDistance);
          continue;
        }
        // Several snakes arrive together: the race ends in a collision, so the
        // engine's contest rule adjudicates it on tiers projected to THIS
        // arrival level and on weights.
        let n = 0;
        let m = mask;
        let topTier = -1;
        let topWeight = 0;
        while (m !== 0) {
          const srcIdx = 31 - Math.clz32(m);
          const source = sources[srcIdx];
          const tier = source.tierAtDistance?.(currentDistance) ?? 0;
          const weight = source.weight ?? 0;
          contestSrc[n] = srcIdx;
          contestTier[n] = tier;
          contestWeight[n] = weight;
          if (tier > topTier || (tier === topTier && weight > topWeight)) {
            topTier = tier;
            topWeight = weight;
          }
          n++;
          m &= ~(1 << srcIdx);
        }
        const winner = stationaryContestWinner(contestTier, contestWeight, n);
        if (winner >= 0) {
          // The survivor holds the cell and expands from it (third pass), the
          // losers gaining nothing there — same as arriving a level late.
          claimCell(cell, contestSrc[winner], currentDistance);
        } else {
          // Nobody survives the collision. The cell is claimed by the group at
          // its shared top (tier, weight): a piece still has to beat that to
          // take it, and no snake expands through it.
          plane.owner[cell] = OWNER_NEUTRAL;
          plane.dist[cell] = currentDistance;
          plane.claimTier[cell] = topTier;
          plane.claimWeight[cell] = topWeight;
          plane.claimMask[cell] = mask;
        }
      }

      // Third pass: expand next level from cells owned by the arriving snake.
      // Dedup (neighbor, source) enqueues with per-level masks.
      const arrivalTurn = currentDistance + 1;
      const open = (cell: number): boolean => passableAtTurn(cell, arrivalTurn);
      const enqueueTouched: number[] = [];
      for (let q = 0; q < curCell.length; q++) {
        const cell = curCell[q];
        const srcIdx = curSrc[q];
        if (plane.owner[cell] !== srcIdx) continue; // tied claim, or claimed by another snake

        const nCount = graph.fillUnitNeighbors(unitOf[srcIdx], cell, open, nbuf);
        for (let t = 0; t < nCount; t++) {
          const n = nbuf[t];
          if (plane.owner[n] !== OWNER_UNREACHED) continue;
          const bit = 1 << srcIdx;
          if ((enqueuedMask[n] & bit) !== 0) continue;
          if (!open(n)) continue;
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

    return plane;
  }

  /**
   * Step 3 of the rule: every piece's arrival distance to every square it can
   * get to, offered to that square's contest as it is discovered.
   *
   * All pieces walk one shared level counter (so arrivals are offered in
   * increasing distance order, which is what lets a snake-free cell schedule
   * its contest on the first arrival), but they do NOT interact: each keeps its
   * own visited bit and expands from every square IT has reached, never from
   * "squares it owns". Only physical passability constrains it — walls, bodies
   * on turn-aware clearance, and other pieces' squares (which stop a slider's
   * ray exactly as they stop the piece). See the module header for why making
   * this ownership-aware is the bug, not the feature.
   */
  private expandPieceReach(
    sources: BFSSource[],
    pieceIdx: number[],
    unitOf: UnitAdjacency[],
    passableAtTurn: (cell: number, turn: number) => boolean,
    N: number,
    offer: (cell: number, srcIdx: number, arrivedAt: number) => void,
  ): void {
    if (pieceIdx.length === 0) return;
    const graph = this.graph;

    const seenMask = new Uint32Array(N);      // cumulative: this piece has arrived here
    const enqueuedMask = new Uint32Array(N);  // per-level: dedup of (cell, piece) enqueues

    let curCell: number[] = [];
    let curSrc: number[] = [];
    let nextCell: number[] = [];
    let nextSrc: number[] = [];

    const delayed = new Map<number, number[]>();
    let pendingDelayed = 0;
    for (const i of pieceIdx) {
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

    let currentDistance = 0;
    const nbuf = graph.neighborBuffer();
    const arrivedCell: number[] = [];
    const arrivedSrc: number[] = [];

    while (curCell.length > 0 || pendingDelayed > 0) {
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

      // First arrivals at this level, per piece.
      arrivedCell.length = 0;
      arrivedSrc.length = 0;
      for (let q = 0; q < curCell.length; q++) {
        const cell = curCell[q];
        const srcIdx = curSrc[q];
        const bit = 1 << srcIdx;
        if ((seenMask[cell] & bit) !== 0) continue;
        seenMask[cell] |= bit;
        offer(cell, srcIdx, currentDistance);
        arrivedCell.push(cell);
        arrivedSrc.push(srcIdx);
      }

      // Expand each piece from everywhere it first stood this level.
      const arrivalTurn = currentDistance + 1;
      const open = (cell: number): boolean => passableAtTurn(cell, arrivalTurn);
      const enqueueTouched: number[] = [];
      for (let q = 0; q < arrivedCell.length; q++) {
        const cell = arrivedCell[q];
        const srcIdx = arrivedSrc[q];
        const bit = 1 << srcIdx;
        const nCount = graph.fillUnitNeighbors(unitOf[srcIdx], cell, open, nbuf);
        for (let t = 0; t < nCount; t++) {
          const n = nbuf[t];
          if ((seenMask[n] & bit) !== 0) continue;
          if ((enqueuedMask[n] & bit) !== 0) continue;
          if (!open(n)) continue;
          if (enqueuedMask[n] === 0) enqueueTouched.push(n);
          enqueuedMask[n] |= bit;
          nextCell.push(n);
          nextSrc.push(srcIdx);
        }
      }

      for (const cell of enqueueTouched) enqueuedMask[cell] = 0;

      const tmpCell = curCell, tmpSrc = curSrc;
      curCell = nextCell; curSrc = nextSrc;
      nextCell = tmpCell; nextSrc = tmpSrc;
      nextCell.length = 0; nextSrc.length = 0;
      currentDistance++;
    }
  }
}
