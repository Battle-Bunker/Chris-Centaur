/**
 * ROUTES — where a unit can get to, over how many of its own turns.
 *
 * Pathing is not a rule, and this module deliberately encodes none. What a
 * unit may do in ONE turn comes from the vendored grammar
 * (`planUnitAction`, via `logic/staging-legality.ts`), so a knight's routes
 * advance in L-jumps and a rook's along rays with no unit-type logic at any
 * call site. What this adds is the two things the grammar has no opinion
 * about: which cells are OPEN at the turn a search would arrive on them, and
 * how a multi-turn search walks a unit whose reachability depends on which way
 * it faces.
 *
 * It replaces `logic/board-graph.ts` for the two consumers that survived the
 * legacy rip — the goto/waypoint pathfinder and the territory view. The
 * 994-line graph answered four more questions than those need, and three of
 * them were rules it had re-derived: whether a body is severable (a tier
 * comparison), whether a piece square can be entered (the stationary contest),
 * and whether a hazard step is survivable (health arithmetic). None of them
 * are re-derived here. A body that has not receded is closed, a piece's square
 * is closed, and a hazard is closed — the conservative reading in every case,
 * which costs a route that would have gone THROUGH a unit it beats and never
 * plans one that would not have worked. Whether a move actually kills is
 * asked of the engine itself (`logic/turn-oracle.ts`), which settles the real
 * turn and reads the answer off the result.
 *
 * ── Coordinates ────────────────────────────────────────────────────────────
 * Cells here are API indices — `y * width + x` on the perimeter-stripped,
 * y-up board — because that is what the callers hold. The grammar is asked in
 * FULL-BOARD coordinates, so the adjacency walk converts at its own boundary
 * and nowhere else.
 */

import type { BoardSnapshot, Coord, Snake } from '../types/battlesnake';
import {
  Orientation,
  isInterior,
  isPieceUnit,
  legalOrientations,
  planUnitAction,
  toIndex,
} from './staging-legality';
import type { UnitType } from '@shared/types/Game';

const NO_UNIT = -1;

/**
 * Fill `out` with the in-bounds orthogonal neighbour cell indices of `idx` on
 * a W-wide grid of N cells, returning how many were written (2-4). Order
 * (+W, -W, -1, +1) is the historical enumeration order — BFS parent and
 * first-visit choices depend on it.
 */
export function fillNeighbors4(idx: number, W: number, N: number, out: Int32Array): number {
  let count = 0;
  const x = idx % W;
  const up = idx + W;
  const down = idx - W;
  if (up < N) out[count++] = up;
  if (down >= 0) out[count++] = down;
  if (x > 0) out[count++] = idx - 1;
  if (x < W - 1) out[count++] = idx + 1;
  return count;
}

/** What a search needs to know about the unit it is walking for. */
export interface RouteUnit {
  unitType?: string;
  orientation: Orientation;
}

/** The adjacency of an ordinary trail unit — orthogonal steps, facing unread. */
export const SNAKE_ROUTE_UNIT: RouteUnit = { unitType: 'snake', orientation: { dx: 0, dy: -1 } };

/**
 * Units whose edge set depends on which way they FACE, so "where can it get
 * to" is a property of (square, orientation) rather than of the square alone.
 *
 * Only the pawn: its single step is forward and a quarter turn costs a whole
 * turn, so a pawn facing the wrong way is one turn — not zero — from the
 * squares beside it. Every other kind's edges are the same whichever way it
 * faces, so its search collapses to one orientation state.
 */
export const isOrientationStateful = (unitType?: string): boolean =>
  (unitType ?? 'snake') === 'pawn';

const sameOrientation = (a: Orientation, b: Orientation): boolean => a.dx === b.dx && a.dy === b.dy;

// Negating a zero component yields -0, which compares equal to 0 but reads as
// "-0" everywhere an orientation is printed or diffed. Normalize it away.
const axis = (n: number): number => (n === 0 ? 0 : n);

/**
 * The two orientations one quarter turn away from `o` — the pawn's side
 * squares, which is exactly what staging a rotation encodes. Derived from the
 * perpendicular, never re-tabulated.
 */
export const quarterTurnsFrom = (o: Orientation): Orientation[] => [
  { dx: axis(-o.dy), dy: axis(o.dx) },
  { dx: axis(o.dy), dy: axis(-o.dx) },
];

/**
 * ONE unit's search space: the node set a multi-turn search over that unit's
 * own moves walks, and the single place a node's cell and orientation are
 * decoded. A node is a (cell, orientation-state) pair packed into one integer,
 * so searches keep flat typed-array visited/parent arrays and one loop.
 */
export interface UnitSearchSpace {
  /** Nodes in the space: cells × orientation states. */
  readonly nodeCount: number;
  /** Upper bound on one `fillNeighbors` result. */
  readonly neighborCapacity: number;
  /** The node for a unit on `cell` facing the orientation the space started from. */
  startNode(cell: number): number;
  /** The board cell a node stands on. */
  cellOf(node: number): number;
  /** The orientation a node faces. */
  orientationOf(node: number): Orientation;
  /**
   * Fill `out` with the nodes reachable from `node` in ONE turn, returning how
   * many were written. `passable` is the caller's own layer, used to stop rays:
   * a ray extends through passable squares and ends AT the first impassable
   * one, which is still offered so the caller decides what entering it means.
   */
  fillNeighbors(node: number, passable: (cellIdx: number) => boolean, out: Int32Array): number;
}

/** Turn-aware passability, relative to the subject asking. */
export interface RoutePassability {
  /** -1 when the subject is unknown or dead. */
  headIdx: number;
  tailIdx: number;
  /** Can the subject occupy `idx`, arriving `arrivalTurn` turns from now? */
  passableIdx: (idx: number, arrivalTurn: number) => boolean;
}

export interface RoutePassabilityOptions {
  /**
   * Skip the hazard veto. Hazards damage on entry rather than killing (death
   * only at health <= 0), so a caller that models the survival itself — by
   * settling the turn — opts out here and layers that judgement on top of the
   * raw wall/body passability this then returns. Multi-turn pathing must NOT
   * set this: health varies along a path and per-entry damage compounds.
   */
  ignoreHazards?: boolean;
}

/**
 * The board a route is planned over: terrain, bodies, and when each body cell
 * frees.
 *
 * VACATE TIMING is pure tail geometry plus the one meal that can be confirmed:
 * a segment `i` cells from the tail frees in `i` turns, pushed out by one when
 * its owner has food one step away and could therefore still be growing. That
 * is the whole model. The graph this replaces carried two further projections
 * — a food-reachability BFS predicting every future meal, and a starvation
 * clock predicting when a snake dies of hunger and its whole body vanishes —
 * and both are guesses about other players' futures that a drawn route has no
 * business betting on.
 */
export class RouteBoard {
  readonly boardWidth: number;
  readonly boardHeight: number;
  readonly cellCount: number;
  private readonly currentTurn: number;

  private readonly hazard: Uint8Array;
  /** Owner index of the body segment on each cell, or NO_UNIT. */
  private readonly segOwner: Int32Array;
  private readonly segIsTail: Uint8Array;
  /** A tail that is stacked does not free on the next pop. */
  private readonly segStaticBlocked: Uint8Array;
  /** Turns until the segment on this cell frees. 0 on cells with no segment. */
  private readonly vacate: Int32Array;
  /** Owner index of the piece standing on each cell, or NO_UNIT. */
  private readonly pieceOwner: Int32Array;

  private readonly unitIds: string[] = [];
  private readonly unitIndexById = new Map<string, number>();
  private readonly unitHeadIdx: number[] = [];
  private readonly unitTailIdx: number[] = [];
  private readonly unitAdjacency: RouteUnit[] = [];

  constructor(state: BoardSnapshot) {
    const board = state.board;
    this.boardWidth = board.width;
    this.boardHeight = board.height;
    this.cellCount = board.width * board.height;
    this.currentTurn = state.turn;

    const N = this.cellCount;
    this.hazard = new Uint8Array(N);
    this.segOwner = new Int32Array(N).fill(NO_UNIT);
    this.segIsTail = new Uint8Array(N);
    this.segStaticBlocked = new Uint8Array(N);
    this.vacate = new Int32Array(N);
    this.pieceOwner = new Int32Array(N).fill(NO_UNIT);

    const living = (board.snakes ?? []).filter((s) => s.health > 0);
    living.forEach((snake) => {
      const idx = this.unitIds.length;
      this.unitIds.push(snake.id);
      this.unitIndexById.set(snake.id, idx);
      this.unitHeadIdx.push(this.cellIndexOf(snake.head));
      this.unitTailIdx.push(this.cellIndexOf(snake.body[snake.body.length - 1]));
      this.unitAdjacency.push({
        unitType: snake.unitType ?? 'snake',
        orientation: snake.orientation ?? SNAKE_ROUTE_UNIT.orientation,
      });
      // A piece's square is a wall in this layer: it stands still in lookahead
      // and the contest that would let somebody through it is the engine's to
      // adjudicate, not a routing layer's to predict.
      if (isPieceUnit(snake)) this.pieceOwner[this.cellIndexOf(snake.head)] = idx;
    });

    living.forEach((snake, ownerIdx) => this.addSegments(snake, ownerIdx, board.food ?? []));
    for (const h of board.hazards ?? []) this.hazard[this.cellIndexOf(h)] = 1;
  }

  /**
   * The body segments of one unit, with the turn each frees.
   *
   * The engine may stack several segments on one cell (a unit that ate last
   * turn carries a duplicated tail; spawns start fully stacked), so a run of
   * consecutive duplicates is ONE cell whose vacate turn counts from the run's
   * FIRST index — the cell only frees once its last copy pops. A run that also
   * covers the HEAD cell really starts at index 0: once the head moves, its
   * copy is just another copy the tail still has to pop through.
   */
  private addSegments(snake: Snake, ownerIdx: number, food: Coord[]): void {
    const body = snake.body ?? [];
    // The one meal that can be confirmed: food one step from the head. An eat
    // delays every segment vacating strictly after the turn it happens on,
    // which for a turn-1 eat is every segment but a bare tail.
    const head = snake.head ?? body[0];
    const eatsThisTurn =
      head !== undefined &&
      food.some((f) => Math.abs(f.x - head.x) + Math.abs(f.y - head.y) === 1)
        ? 1
        : 0;

    for (let i = 1; i < body.length; i++) {
      const idx = this.cellIndexOf(body[i]);
      let last = i;
      while (last + 1 < body.length && this.cellIndexOf(body[last + 1]) === idx) last++;
      const runStart = i === 1 && this.cellIndexOf(body[0]) === idx ? 0 : i;
      const isTail = last === body.length - 1;
      const stacked = last > runStart;
      const turnsFromTail = body.length - runStart;

      this.segOwner[idx] = ownerIdx;
      this.segIsTail[idx] = isTail ? 1 : 0;
      // The engine pops tails before resolving collisions, eating or not — so
      // a bare tail frees on the very next move; a stacked one leaves a copy.
      this.segStaticBlocked[idx] = (isTail ? stacked : true) ? 1 : 0;
      this.vacate[idx] = turnsFromTail > 1 ? turnsFromTail + eatsThisTurn : turnsFromTail;
      i = last;
    }
  }

  cellIndex(x: number, y: number): number {
    return y * this.boardWidth + x;
  }

  cellIndexOf(coord: Coord): number {
    return coord.y * this.boardWidth + coord.x;
  }

  isInBounds(coord: Coord): boolean {
    return (
      coord.x >= 0 && coord.x < this.boardWidth && coord.y >= 0 && coord.y < this.boardHeight
    );
  }

  /** The adjacency of a unit on this board, or a trail unit's when unknown. */
  unitFor(snakeId: string): RouteUnit {
    const idx = this.unitIndexById.get(snakeId);
    return idx === undefined ? SNAKE_ROUTE_UNIT : this.unitAdjacency[idx];
  }

  neighborCapacity(): number {
    return 8 * Math.max(this.boardWidth, this.boardHeight);
  }

  /** A scratch buffer large enough for any unit's neighbour list on this board. */
  neighborBuffer(): Int32Array {
    return new Int32Array(this.neighborCapacity() + 2);
  }

  /**
   * The turn each cell's body segment frees (0 = already free), for every
   * cell. Read-only: the same array is handed to every consumer of one board.
   */
  vacateTurns(): number[] {
    return Array.from(this.vacate);
  }

  /**
   * THE per-unit adjacency: fill `out` with the cells `unit` can reach from
   * `idx` in ONE move, returning how many were written.
   *
   * The geometry is not re-derived — each candidate square is validated by
   * `planUnitAction`, the vendored grammar itself, so an edge exists exactly
   * where staging that square would plan a MOVE. Consequences worth naming: a
   * knight and a king stop after one step in each of their orientations,
   * sliders extend along theirs, and a pawn contributes only its forward step,
   * because its side squares plan a ROTATE (a turn spent turning, not a
   * displacement) and its diagonals need a capture target on the square that a
   * multi-turn search cannot promise will still be there.
   */
  fillUnitNeighbors(
    unit: RouteUnit,
    idx: number,
    passable: (cellIdx: number) => boolean,
    out: Int32Array
  ): number {
    const type = unit.unitType ?? 'snake';
    if (type === 'snake') return fillNeighbors4(idx, this.boardWidth, this.cellCount, out);

    // Piece geometry is defined in FULL-BOARD coordinates (perimeter included,
    // y growing downward), so the walk runs there and each accepted square
    // converts back to an api cell index.
    const W = this.boardWidth;
    const H = this.boardHeight;
    const fullW = W + 2;
    const fullH = H + 2;
    const ox = (idx % W) + 1;
    const oy = H - Math.floor(idx / W);
    const origin = toIndex(ox, oy, fullW);

    let count = 0;
    for (const o of legalOrientations(type as UnitType)) {
      for (let step = 1; ; step++) {
        const fx = ox + o.dx * step;
        const fy = oy + o.dy * step;
        if (!isInterior(fx, fy, fullW, fullH)) break;
        const action = planUnitAction(
          type as UnitType,
          origin,
          toIndex(fx, fy, fullW),
          fullW,
          fullH,
          unit.orientation
        );
        if (!action || action.kind !== 'move') break;
        const cell = (H - fy) * W + (fx - 1);
        out[count++] = cell;
        if (!passable(cell)) break;
      }
    }
    return count;
  }

  /**
   * THE search space of a unit: `fillUnitNeighbors` lifted to (cell,
   * orientation) nodes so a multi-turn search can plan through TURNING as well
   * as through moving.
   *
   * Orientation-invariant kinds get a one-state space whose nodes ARE their
   * cell indices. A pawn gets one node layer per orientation, ordered with its
   * CURRENT orientation first (so `startNode` is the plain cell index there
   * too), and two extra edges per node: the quarter turns, which cost one turn
   * each and land on the same square.
   */
  searchSpaceFor(unit: RouteUnit): UnitSearchSpace {
    const cells = this.cellCount;
    const type = unit.unitType ?? 'snake';
    if (!isOrientationStateful(type)) {
      const orientation = unit.orientation;
      return {
        nodeCount: cells,
        neighborCapacity: this.neighborCapacity(),
        startNode: (cell) => cell,
        cellOf: (node) => node,
        orientationOf: () => orientation,
        fillNeighbors: (node, passable, out) => this.fillUnitNeighbors(unit, node, passable, out),
      };
    }

    // Current orientation first, so state 0 is always where the unit stands.
    const states: Orientation[] = [
      unit.orientation,
      ...legalOrientations(type as UnitType).filter((o) => !sameOrientation(o, unit.orientation)),
    ];
    const stateOf = (o: Orientation): number => states.findIndex((s) => sameOrientation(s, o));
    const layers: RouteUnit[] = states.map((orientation) => ({ unitType: type, orientation }));
    const turns: number[][] = states.map((o) => quarterTurnsFrom(o).map(stateOf).filter((s) => s >= 0));

    return {
      nodeCount: cells * states.length,
      neighborCapacity: this.neighborCapacity() + 2,
      startNode: (cell) => cell,
      cellOf: (node) => node % cells,
      orientationOf: (node) => states[Math.floor(node / cells)],
      fillNeighbors: (node, passable, out) => {
        const cell = node % cells;
        const state = Math.floor(node / cells);
        // Moves first, turns after: among plans of equal length the one that
        // starts by actually going somewhere is the one BFS keeps.
        let count = this.fillUnitNeighbors(layers[state], cell, passable, out);
        const base = state * cells;
        for (let i = 0; i < count; i++) out[i] += base;
        for (const turned of turns[state]) out[count++] = turned * cells + cell;
        return count;
      },
    };
  }

  /**
   * Turn-aware passability from `subjectId`'s point of view.
   *
   * Closed: a hazard (it costs health and this layer is health-blind), the
   * subject's own head (an origin, never a destination), the square of any
   * OTHER unit that is a piece, and any body segment that has not yet receded
   * by the arrival turn. The subject's own body is closed throughout except
   * for its tail, which follows the vacate rule — a unit cannot count on its
   * own body clearing ahead of its head.
   */
  passabilityFor(subjectId: string, opts?: RoutePassabilityOptions): RoutePassability {
    const subjectIdx = this.unitIndexById.get(subjectId) ?? NO_UNIT;
    const headIdx = subjectIdx >= 0 ? this.unitHeadIdx[subjectIdx] : -1;
    const tailIdx = subjectIdx >= 0 ? this.unitTailIdx[subjectIdx] : -1;
    const ignoreHazards = opts?.ignoreHazards ?? false;

    const passableIdx = (idx: number, arrivalTurn: number): boolean => {
      if (!ignoreHazards && this.hazard[idx] === 1) return false;
      if (idx === headIdx) return false;

      const pieceIdx = this.pieceOwner[idx];
      if (pieceIdx !== NO_UNIT && pieceIdx !== subjectIdx) return false;

      const owner = this.segOwner[idx];
      if (owner === NO_UNIT) return true; // empty (other units' heads included)

      const receded = this.vacate[idx] <= arrivalTurn;
      if (owner === subjectIdx) {
        if (this.segIsTail[idx] === 0) return false;
        return receded;
      }
      return receded;
    };

    return { headIdx, tailIdx, passableIdx };
  }

  /** Every living unit on this board, in board order, with its head cell. */
  sources(): ReadonlyArray<{ id: string; headIdx: number; unit: RouteUnit }> {
    return this.unitIds.map((id, i) => ({
      id,
      headIdx: this.unitHeadIdx[i],
      unit: this.unitAdjacency[i],
    }));
  }

  /** The absolute game turn this board is a snapshot of. */
  get turn(): number {
    return this.currentTurn;
  }
}
