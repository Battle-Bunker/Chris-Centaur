/**
 * THE DILATION SHELLS — where a unit could be, turn by turn, out to a horizon.
 *
 * The territory sweep and the reach terms need one thing the settlement does
 * not carry: not "where could this unit be at each SUB-STEP of the turn being
 * settled" (that is `Claim.headPossible`, and the engine computes it), but
 * "where could it be in one turn, two, three, four" — the front at each
 * ABSOLUTE turn out to `REACH_HORIZON_TURNS`.
 *
 * ── THIS IS NOT A SECOND GRAMMAR, AND THE DISTINCTION IS THE WHOLE POINT ────
 *
 * Nothing here decides what a unit may do. Every step of every front comes
 * from `queries.legalTargets` + `queries.actionOf` — the same two calls
 * `claims.ts` makes, in the same order, against the same two board shapes:
 * the real board for the first unknown turn, and the PERMISSIVE board (every
 * cell a pawn target) for the turns after it, because after one unknown turn
 * nobody knows where the bodies are and over-approximating is the only
 * direction a reach may be wrong in. What this file adds is ITERATION and a
 * cache: it applies the engine's own step relation n times and remembers the
 * fronts.
 *
 * A file that decided for itself which cells a queen may reach would be the
 * grammar written twice, which is the one thing the vendored engine exists to
 * prevent. Read `queries`; this only calls it.
 *
 * ── WHY A TABLE, AND WHY IT IS DECISION-SCOPED ─────────────────────────────
 *
 * The dilation is a pure function of (kind, head cell, facing, span) against
 * one board, and one decision evaluates thousands of plans over the same
 * roster — so a unit's fronts are computed once and read tens of thousands of
 * times. The step relation underneath them is cached harder still: `(type,
 * cell, facing, phase)` is what `legalTargets` is actually keyed on, and it is
 * shared by every unit of that kind on the board.
 */

import { NEVER } from '../../engine-vendor/engine/claims';
import { ORTHOGONALS } from '../../engine-vendor/engine/moveGrammar';
import type { Orientation } from '../../engine-vendor/engine/moveGrammar';
import { actionOf, legalTargets, rotationTargets } from '../../engine-vendor/engine/queries';
import type { BoardShape, GrammarUnit } from '../../engine-vendor/engine/queries';
import type { PartialSettlement } from '../../engine-vendor/engine/settlePartial';
import type { UnitType } from '../../engine-vendor/shared/types/Game';
import { bbForEach, bbSet, bbTest, newBoard } from '../bits';
import type { Bitboard, Grid } from '../bits';
import type { EngineSubstrate } from '../substrate';
import type { UnitId } from '../contracts';
import { claimsById } from '../bounds/material';

export { NEVER };

/**
 * One unit's reach over a horizon: the arriving front at each absolute turn,
 * plus the stamped `earliest` grid on demand.
 */
export interface UnitShells {
  readonly unitId: UnitId;
  /** Absolute turn of `fronts[0]` — the turn this unit was last OBSERVED. */
  readonly fromTurn: number;
  /** `fronts[i]` is the head-possible board at absolute turn `fromTurn + i`. */
  readonly fronts: ReadonlyArray<Bitboard>;
  /** The absolute turn `fronts` currently reaches. */
  readonly horizonTurn: number;
  /** The front at an ABSOLUTE turn, or null when the horizon does not cover it. */
  frontAt(turn: number): Bitboard | null;
  /** True when this unit can be on `cell` at or before absolute turn `turn`. */
  reachesBy(cell: number, turn: number): boolean;
  /** `earliest[c]`: the first absolute turn the head could hold `c`, or NEVER. */
  earliest(): Int32Array;
}

/** What a shell is asked for: a unit, where it was, and when it was seen. */
export interface ShellRequest {
  readonly unitId: UnitId;
  readonly type: UnitType;
  /** Head first. Only the head drives the dilation. */
  readonly occupancy: ReadonlyArray<number>;
  readonly orientation: Orientation;
  /** The absolute turn this record was observed. */
  readonly fromTurn: number;
}

/** How many distinct kinds one decision's shell keys may pack. */
const TYPE_KEY_SPAN = 64;

/** A dilation state: where the head is, and which way it faces. */
interface State {
  readonly cell: number;
  readonly ori: number;
}

/**
 * The facing, as an index into `ORTHOGONALS` — by table rather than by scan.
 *
 * `ORTHOGONALS` entries already carry their components as -1/0/1, so the whole
 * predicate is a function of `(sign dx, sign dy)`, which has nine values. The
 * table is built once, first-match-wins so it answers exactly what
 * `findIndex` did, and the lookup replaces a closure allocation plus up to
 * four comparisons with two `Math.sign` calls and an index — on a function
 * called once per unit per shell request, i.e. once per unit per evaluation.
 */
const ORI_BY_SIGN = ((): Int8Array => {
  const table = new Int8Array(9).fill(-1);
  ORTHOGONALS.forEach((o, i) => {
    const slot = (Math.sign(o.dx) + 1) * 3 + (Math.sign(o.dy) + 1);
    if (table[slot] === -1) table[slot] = i;
  });
  return table;
})();

const oriIndex = (orientation: Orientation): number => {
  const slot = (Math.sign(orientation.dx) + 1) * 3 + (Math.sign(orientation.dy) + 1);
  const i = slot >= 0 && slot < 9 ? (ORI_BY_SIGN[slot] as number) : -1;
  return i === -1 ? 0 : i;
};

/**
 * The board the second and later unknown turns are asked against — the same
 * over-approximation `claims.ts` makes, for the same reason: a pawn's diagonal
 * is legal onto food or a body, and after one unknown turn nobody knows where
 * the bodies are.
 */
function permissiveShapeOf(shape: BoardShape): BoardShape {
  const cells = shape.boardWidth * shape.boardHeight;
  const food: number[] = [];
  for (let cell = 0; cell < cells; cell++) food.push(cell);
  return { ...shape, food };
}

class Shells implements UnitShells {
  readonly unitId: UnitId;
  readonly fromTurn: number;
  readonly fronts: Bitboard[] = [];
  horizonTurn: number;
  /** The frontier as STATES — only for a kind whose facing changes its
   *  legality, which is the one kind that needs more than a cell to step. */
  private states: Map<number, State> | null;
  private readonly type: UnitType;
  private readonly table: ShellTable;
  private readonly grid: Grid;
  private stamped: Int32Array | null = null;

  constructor(request: ShellRequest, table: ShellTable, grid: Grid) {
    this.unitId = request.unitId;
    this.type = request.type;
    this.fromTurn = request.fromTurn;
    this.table = table;
    this.grid = grid;
    const cell = request.occupancy[0] as number;
    const facing = table.facingMatters(request.type);
    const start: State = { cell, ori: facing ? oriIndex(request.orientation) : 0 };
    this.states = facing ? new Map([[start.cell * 4 + start.ori, start]]) : null;
    const front = newBoard(grid);
    bbSet(front, cell);
    this.fronts.push(front);
    this.horizonTurn = request.fromTurn;
  }

  /** Collect fronts out to an absolute turn. Idempotent and extending. */
  extendTo(horizonTurn: number): void {
    while (this.horizonTurn < horizonTurn) {
      const step = this.horizonTurn - this.fromTurn; // 0 for the first unknown turn
      const previous = this.fronts[this.fronts.length - 1] as Bitboard;
      const front = newBoard(this.grid);
      if (this.states === null) {
        // A kind that reads no facing: the whole step is a board union, which
        // is what makes a four-turn reach a handful of word ORs rather than a
        // walk over a set of states.
        const words = this.grid.words;
        bbForEach(previous, words, (cell) => {
          const reach = this.table.stepBoard(this.type, cell);
          for (let w = 0; w < words; w++) {
            front[w] = ((front[w] as number) | (reach[w] as number)) >>> 0;
          }
        });
      } else {
        const next = new Map<number, State>();
        for (const state of this.states.values()) {
          for (const to of this.table.stepsFrom(this.type, state, step === 0)) {
            next.set(to.cell * 4 + to.ori, to);
            bbSet(front, to.cell);
          }
        }
        this.states = next;
      }
      // A unit with nowhere legal to go stays where it is — which is also what
      // "it may simply have held" means.
      let any = 0;
      for (let w = 0; w < this.grid.words; w++) any |= front[w] as number;
      if (any === 0) {
        for (let w = 0; w < this.grid.words; w++) front[w] = previous[w] as number;
        if (this.states !== null && this.states.size === 0) this.states = null;
      }
      this.fronts.push(front);
      this.horizonTurn++;
      this.stamped = null;
    }
  }

  frontAt(turn: number): Bitboard | null {
    const i = turn - this.fromTurn;
    return i < 0 || i >= this.fronts.length ? null : (this.fronts[i] as Bitboard);
  }

  reachesBy(cell: number, turn: number): boolean {
    const last = Math.min(turn, this.horizonTurn);
    for (let t = this.fromTurn; t <= last; t++) {
      if (bbTest(this.fronts[t - this.fromTurn] as Bitboard, cell)) return true;
    }
    return false;
  }

  earliest(): Int32Array {
    if (this.stamped === null) {
      const out = new Int32Array(this.grid.cells).fill(NEVER);
      for (let i = 0; i < this.fronts.length; i++) {
        const stamp = this.fromTurn + i;
        bbForEach(this.fronts[i] as Bitboard, this.grid.words, (c) => {
          if ((out[c] as number) > stamp) out[c] = stamp;
        });
      }
      this.stamped = out;
    }
    return this.stamped;
  }
}

// ---------------------------------------------------------------------------
// The decision-scoped table
// ---------------------------------------------------------------------------

export class ShellTable {
  private readonly sub: EngineSubstrate;
  private readonly grid: Grid;
  private readonly map = new Map<number, Shells>();
  /** The engine's step relation, memoised per (type, cell, facing, phase). */
  private readonly steps = new Map<string, ReadonlyArray<State>>();
  /**
   * A FLAT INDEX IN FRONT OF THE TWO STRING-KEYED CACHES.
   *
   * `stepBoard` and `stepsFrom` are called once per set bit per horizon turn
   * per unit per evaluation — the innermost loop the reach shells have — and
   * both were paying, on EVERY call, for a template string, a `Map` hash of
   * it, and (for `stepBoard`) a `stepCache()` hop across the resolution memo's
   * proxy. Measured together at 4.0% of self time on `mixed 20 1 --nodes`.
   *
   * These are per-table arrays indexed by cell (and by facing), holding the
   * SAME objects the shared caches hold; the shared caches are still filled
   * exactly as before, so the geometry stays shared across decisions and its
   * statistics are unchanged. A table lives one decision and the board shape
   * cannot change inside one, so a local entry can never be stale.
   */
  private readonly localStepBoards = new Map<UnitType, Array<Bitboard | undefined>>();
  private readonly localSteps = new Map<UnitType, Array<ReadonlyArray<State> | undefined>>();
  private readonly oriented = new Map<UnitType, boolean>();
  private permissive: BoardShape | null = null;
  private readonly capacity: number;
  hits = 0;
  misses = 0;
  evictions = 0;

  constructor(sub: EngineSubstrate, capacity = 4096) {
    this.sub = sub;
    this.grid = sub.grid;
    this.capacity = Math.max(1, capacity);
  }

  get size(): number {
    return this.map.size;
  }

  /**
   * One legal step of the engine's own grammar, from a state.
   *
   * `start` picks the board shape: the real one for the first unknown turn,
   * the permissive one after it.
   *
   * TWO CACHES, AND THE SPLIT IS A PROPERTY OF THE GRAMMAR RATHER THAN AN
   * OPTIMISATION. `planUnitAction` reads the board's CONTENTS for exactly one
   * kind — a pawn, whose diagonal is legal only onto food or a body — so for
   * every other kind the answer at a cell is a function of the board's SHAPE
   * alone: the same on turn 1 and turn 40, on the real board and on the
   * permissive one. Those entries live in the geometry cache and are shared by
   * every decision of the game; the pawn's live in this table and die with the
   * decision. Which kinds are which is asked of the grammar (`rotationTargets`
   * is non-empty exactly for the kind that has a facing to change), never
   * asserted by name.
   */
  stepsFrom(type: UnitType, state: State, start: boolean): ReadonlyArray<State> {
    // The permissive board is every cell a pawn target, which is a function of
    // the board's shape alone — so those entries are shared with every other
    // decision of the game. Only the FIRST unknown turn reads this board's
    // contents, and only those entries are decision-scoped.
    // The local index is keyed on the same triple, laid flat: `start` picks
    // one of two lanes per (cell, facing) slot, so no two phases collide.
    let local = this.localSteps.get(type);
    if (local === undefined) {
      local = [];
      this.localSteps.set(type, local);
    }
    const slot = (state.cell * 4 + state.ori) * 2 + (start ? 0 : 1);
    const known = local[slot];
    if (known !== undefined) return known;
    const cache = start ? this.steps : this.sub.orientedStepCache();
    const key = `${type}|${state.cell}|${state.ori}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      local[slot] = hit as ReadonlyArray<State>;
      return hit as ReadonlyArray<State>;
    }
    const made = this.orientedStepsOf(
      type,
      state,
      start ? this.sub.shape() : this.permissiveShape()
    );
    cache.set(key, made);
    local[slot] = made;
    return made;
  }

  /**
   * Where a kind whose legality reads no board contents can step from a cell,
   * as a board.
   *
   * Every legal target IS a destination for such a kind, because the one
   * action that is not a move is a rotation and only the kind with a facing
   * has one. Holding is in the set for the kind that may hold, which is what
   * makes its front grow rather than march.
   *
   * Cached in the GEOMETRY: it is a function of the board's shape alone, so it
   * is as true on turn 40 as on turn 1 and is shared by every decision of the
   * game. This is the difference between a four-turn reach costing a handful
   * of word ORs and costing a grammar query per cell per plan.
   */
  stepBoard(type: UnitType, cell: number): Bitboard {
    let local = this.localStepBoards.get(type);
    if (local === undefined) {
      local = [];
      this.localStepBoards.set(type, local);
    }
    const known = local[cell];
    if (known !== undefined) return known;
    const key = `${type}|${cell}`;
    const shared = this.sub.stepCache();
    const hit = shared.get(key);
    if (hit !== undefined) {
      local[cell] = hit;
      return hit;
    }
    const unit: GrammarUnit = {
      type,
      occupancy: [cell],
      orientation: ORTHOGONALS[0] as Orientation,
    };
    const board = newBoard(this.grid);
    for (const to of legalTargets(unit, this.sub.shape())) bbSet(board, to);
    shared.set(key, board);
    local[cell] = board;
    return board;
  }

  /** The step set of a kind that has a facing: every action, asked in full. */
  private orientedStepsOf(type: UnitType, state: State, shape: BoardShape): ReadonlyArray<State> {
    const unit: GrammarUnit = {
      type,
      occupancy: [state.cell],
      orientation: ORTHOGONALS[state.ori] as Orientation,
    };
    const out: State[] = [];
    const seen = new Set<number>();
    for (const target of legalTargets(unit, shape)) {
      const action = actionOf(unit, target, shape);
      if (action === null) continue;
      let next: State;
      if (action.kind === 'move') {
        next = { cell: action.path[action.path.length - 1] as number, ori: state.ori };
      } else if (action.kind === 'rotate') {
        next = { cell: state.cell, ori: oriIndex(action.orientation) };
      } else {
        next = state;
      }
      const id = next.cell * 4 + next.ori;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(next);
    }
    return out;
  }

  /**
   * Does this kind's legality depend on which way it is facing? Asked of the
   * grammar: a rotation is an action only a kind with a facing to change has,
   * and it has one wherever it stands.
   */
  private permissiveShape(): BoardShape {
    if (this.permissive === null) this.permissive = permissiveShapeOf(this.sub.shape());
    return this.permissive;
  }

  facingMatters(type: UnitType): boolean {
    return this.orientationSensitive(type);
  }

  private orientationSensitive(type: UnitType): boolean {
    const hit = this.oriented.get(type);
    if (hit !== undefined) return hit;
    const shape = this.sub.shape();
    const probe = Math.floor(shape.boardWidth * shape.boardHeight / 2);
    const unit: GrammarUnit = {
      type,
      occupancy: [probe],
      orientation: ORTHOGONALS[0] as Orientation,
    };
    const sensitive = rotationTargets(unit, shape).length > 0;
    this.oriented.set(type, sensitive);
    return sensitive;
  }

  /** Kind → a small dense index, so the intern key below can be a number. */
  private readonly typeIndex = new Map<UnitType, number>();

  /** Shells for one record, interned by value and extended on demand. */
  forUnit(request: ShellRequest, horizonTurn: number): UnitShells {
    // A NUMBER, NOT A TEMPLATE STRING. The tuple is (unit, kind, head cell,
    // facing, observation turn) either way — the kind is interned to a dense
    // index so the five fields pack into one integer — and the map keeps its
    // insertion order, so the oldest-first eviction is byte-for-byte the
    // policy it was. This runs once per unit per evaluation and was building
    // and hashing a five-part string every time.
    let kind = this.typeIndex.get(request.type);
    if (kind === undefined) {
      kind = this.typeIndex.size;
      this.typeIndex.set(request.type, kind);
    }
    const key =
      ((request.fromTurn * TYPE_KEY_SPAN + kind) * this.grid.cells +
        (request.occupancy[0] as number)) *
        4 +
      oriIndex(request.orientation);
    let entry = this.map.get(key);
    if (entry === undefined) {
      this.misses++;
      entry = new Shells(request, this, this.grid);
      this.map.set(key, entry);
      if (this.map.size > this.capacity) {
        const oldest = this.map.keys().next();
        if (!oldest.done) {
          this.map.delete(oldest.value);
          this.evictions++;
        }
      }
    } else {
      this.hits++;
    }
    entry.extendTo(horizonTurn);
    return entry;
  }
}

/**
 * Shells for every unit on a SETTLED board.
 *
 * A mover is dilated from where the settlement left it, at the arrival turn:
 * the reach terms are about the position the plan produces, which is the whole
 * reason two plans score differently. A HELD unit has no settled position by
 * construction, so it is dilated from where it was OBSERVED, at the turn it
 * was observed — its head start rides in as a seed rather than as an
 * inexpressible negative delay. Anything the settlement killed has no reach at
 * all and is absent from the map.
 */
export function buildShells(
  sub: EngineSubstrate,
  settlement: PartialSettlement,
  horizonTurns: number,
  table: ShellTable,
  into: Map<UnitId, UnitShells> = new Map()
): Map<UnitId, UnitShells> {
  into.clear();
  if (horizonTurns <= 0) return into;
  const horizon = sub.arrivalTurn + horizonTurns;
  // The claim index this settlement already carries, rather than a fresh Set
  // of its ids per evaluation — same membership, one object less per call.
  const held = claimsById(settlement);
  for (const unit of sub.roster()) {
    const record = sub.recordOf(unit.unitId);
    if (record === undefined) continue;
    if (held.has(unit.wireId)) {
      into.set(
        unit.unitId,
        table.forUnit(
          {
            unitId: unit.unitId,
            type: unit.type,
            occupancy: record.occupancy,
            orientation: unit.orientation,
            fromTurn: sub.turn - unit.staleness,
          },
          horizon
        )
      );
      continue;
    }
    const settled = settlement.board[unit.wireId];
    if (settled === undefined) continue; // it died; a corpse has no reach
    into.set(
      unit.unitId,
      table.forUnit(
        {
          unitId: unit.unitId,
          type: settlement.unitTypes[unit.wireId] ?? unit.type,
          occupancy: settled.occupancy,
          orientation: settlement.orientation[unit.wireId] ?? unit.orientation,
          fromTurn: sub.arrivalTurn,
        },
        horizon
      )
    );
  }
  return into;
}

/** The stamped arrival grid for one request — the shells, read once. */
export function earliestShells(
  table: ShellTable,
  request: ShellRequest,
  horizonTurn: number
): Int32Array {
  return table.forUnit(request, horizonTurn).earliest();
}
