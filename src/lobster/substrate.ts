/**
 * THE ENGINE SUBSTRATE — one translation from this repo's canonical board into
 * the possibility-cloud engine, and one place that resolves a turn.
 *
 * Everything above this file (candidates, evaluation, search, kernel) talks to
 * the engine only through `Substrate` in ./contracts. Nothing above it may
 * build a `UnitSpec`, stamp a `heldAtTurn`, or call `resolve` — three things
 * that are silent when they are wrong and expensive to find later.
 *
 * ── THE FIVE RULES THIS FILE EXISTS TO KEEP ────────────────────────────────
 *
 * 1. ONE TRANSLATION. The board arrives as the api-coordinate `Board` every
 *    other module in this repo reads, and goes through `marshalBoard` — the
 *    same marshalling the turn oracle uses — and then through
 *    `wire-adapter.toUnitSpec`. A `UnitSpec` is never hand-built here: the
 *    wire encodes a piece's WEIGHT as that many copies of its cell, and a
 *    hand-rolled spec is exactly where that gets dropped (silent on a board of
 *    weight-1 pieces, wrong the moment a rook eats).
 *
 * 2. A DEFAULT IS NAMED, NEVER SILENT. `resolveBounded` refuses a partial
 *    assignment. This substrate satisfies that by construction: the plan's
 *    domain IS the modelled set and everything else is HELD, so no live unit
 *    can go unnamed. A caller that wants a unit live but undirected names it
 *    with `NO_ORDER_MOVE` — the kind's own default action, which is a rule of
 *    the game, not a guess about an agent. Omitting a unit is a different
 *    statement: it becomes a claim, not a mover.
 *
 * 3. PESSIMISM SCOPE RIDES THE CALL. Worst case is worst FOR A DECLARED TEAM.
 *    `resolveBoundedFor(plan, asTeam)` is the only door; `evolveJoint` is
 *    never called from here, because adjudicating every participant at its own
 *    worst endpoint kills the enemy's movers too — our best case in worst
 *    case's clothing.
 *
 * 4. STALENESS IS `currentTurn − observedTurn`, AND IT IS APPLIED ONCE. The
 *    engine counts the other way (`turnsHeld`, from the freeze to the
 *    POST-ADVANCE field), and the two differ by exactly one. So the conversion
 *    is: stamp each held record's `heldAtTurn` with the turn the unit was
 *    OBSERVED, and add nothing. The repo's own head-start convention agrees —
 *    `board-evaluator.ts` gives a SIMULATED unit `startDelay: 1` and an
 *    unsimulated one `0`, i.e. the un-modelled unit's head start is already
 *    the one turn the post-advance field grants it. Adding a turn here would
 *    double it.
 *
 * 5. SLABS ARE BORROWED AND RETURNED. `fork`, `holdMany` and `resolve` each
 *    take a slab from a fixed-size arena. A leak does not look like a leak: it
 *    looks like the engine getting slower, because every later allocation pays
 *    to grow the arena. Every handle this file takes is tracked and returned;
 *    `resolutions()` and `outstanding()` are there so a test can assert it.
 *
 * ── THE ONE PERFORMANCE DISCIPLINE ─────────────────────────────────────────
 *
 * The hold set is INTERNED and built BEFORE the working fork is taken. A sweep
 * holds the same set across every candidate, and rebuilding the cloud field per
 * call pays for the frozen half thousands of times over. Order matters as well
 * as memoisation: `makeHoldSet` forks internally, so calling it while our own
 * fork is outstanding lets the two allocations interact.
 *
 * The field itself is rebuilt by hand rather than taken from `makeHoldSet`,
 * because `holdMany` stamps every record with ONE turn and a bot's roster is
 * observed at DIFFERENT turns. `makeHoldSet` still owns the slot lifecycle and
 * the premise key; only its field is replaced.
 */

import type { Board as ApiBoard } from '../types/battlesnake';
import { marshalBoard } from '../logic/turn-oracle';
import type { MarshalledBoard } from '../logic/turn-oracle';
import type { ResolveUnit } from '../engine-vendor/engine/resolveTurn';

import {
  MAX_FROZEN,
  PartialEngine,
  RiskAssessor,
  bbSet,
  bbTest,
  emptyField,
  enumerateActions,
  headSubStepLBOf,
  makeGrid,
  makeTerrain,
  newBoard,
  pawnTargetsInto,
  planAction,
  resolveBounded,
} from '../partial-engine/index';
import type {
  Board,
  Candidate as GrammarCandidate,
  CloudField,
  FieldSlot,
  FrozenRecord,
  Grid,
  HoldSet,
  Resolution,
  StateHandle,
  Terrain,
  UnitSpec,
  UnitView,
} from '../partial-engine/index';
import { toUnitSpec } from '../partial-engine/wire-adapter';

import { NO_ORDER_MOVE } from './contracts';
import type {
  BoundedResolution,
  Candidate,
  CellIndex,
  JointPlan,
  SubStep,
  Substrate,
  UnitId,
} from './contracts';

/**
 * The explicit "no order" destination — the contract's own sentinel, pinned by
 * test to the engine's NO_ORDER. Naming a unit with this asks for the KIND's
 * own default action (a trail unit continues straight, a piece holds).
 * Omitting the unit from a plan does something else entirely: it becomes a
 * held claim. Rule 4 of the build contract — a default is a narrowing and must
 * be named — lives on this constant.
 */
export { NO_ORDER_MOVE };

/** A `Candidate`-shaped explicit default for `unitId`. `from` may be omitted
 * when the caller cannot cheaply know the origin cell. */
export function noOrderCandidate(unitId: UnitId, from: CellIndex = NO_ORDER_MOVE): Candidate {
  return { unitId, from, to: NO_ORDER_MOVE, path: [] };
}

/**
 * What a bounded resolution actually produces — the contract's own shape.
 * `touched` is the ceiling widening: the claim layer answers "could this held
 * unit have died" from terrain and from the other CLAIMS — mobile units never
 * narrow a cloud — so a held unit that would walk straight into one of our
 * movers is still reported as certainly alive. That is sound for a floor and
 * NOT sound for a ceiling; a claim touching any cell a mover was on has a
 * world in which it dies. Snapshotted rather than read off `engine.touched`,
 * because the engine zeroes that at the start of the next resolve.
 */
export type BoundedResolve = BoundedResolution;

export interface SubstrateOptions {
  /** This repo's canonical board, in api coordinates. */
  readonly board: ApiBoard;
  /** The absolute turn number the board describes. */
  readonly turn: number;
  /**
   * unit id → the absolute turn on which that unit was last OBSERVED. Absent
   * entries mean "seen this turn" (staleness 0). Never `> turn`.
   */
  readonly observedTurns?: ReadonlyMap<string, number>;
  /**
   * The team this decision is for, as its wire id. Sets the default modelled
   * set (that team's units) and is what `teamNumber()` answers about.
   */
  readonly asTeam?: string;
  /**
   * Units whose moves this substrate's CLAIM VIEW treats as known. Defaults to
   * `asTeam`'s units; with neither, nothing is modelled and every unit carries
   * a claim. This governs `entangled` / `influenceOf` / `claimField` only —
   * `resolveBoundedFor` derives its own held set from the plan it is given.
   */
  readonly modeled?: Iterable<string>;
  /** Held units narrowed to a declared first-move set (an ASSUMPTION). */
  readonly narrowings?: ReadonlyMap<string, ReadonlyArray<number>>;
}

/** A unit as this substrate reads it back — the wire vocabulary, not the engine's. */
export interface SubstrateUnit {
  readonly unitId: UnitId;
  readonly wireId: string;
  readonly team: number;
  readonly teamId: string;
  readonly kind: number;
  readonly type: ResolveUnit['type'];
  readonly isKing: boolean;
  readonly cells: ReadonlyArray<CellIndex>;
  readonly weight: number;
  readonly health: number;
  readonly tier: number;
  readonly orientation: number;
  /** `turn − observedTurn`; this turn's unmade choice is NOT counted. */
  readonly staleness: number;
}

/** Thrown when more units would be held than the engine's field can carry. */
export class TooManyHeldError extends Error {
  readonly code = 'too_many_held' as const;
  constructor(readonly count: number) {
    super(
      `${count} units would be held at once; the cloud field carries at most ${MAX_FROZEN}. ` +
        'Model more units (name them in the plan), or split the decision.'
    );
    this.name = 'TooManyHeldError';
  }
}

/** Thrown when a plan names a unit this substrate does not have alive. */
export class UnknownUnitError extends Error {
  readonly code = 'unknown_unit' as const;
  constructor(readonly unitId: UnitId) {
    super(`plan names unit ${unitId}, which is not a live unit of this board`);
    this.name = 'UnknownUnitError';
  }
}

/**
 * Thrown when two DIFFERENT units share a turn-start cell. Not a board the
 * rules can produce — and B2's soundness harness measured the cost of letting
 * one through: the additive per-enemy floor lemma fails outright on such a
 * board (a floor above the exhaustive truth), which looks exactly like a
 * soundness bug in the bank until you look at the board. The engine's own
 * `create` does not check it, so the one translation door does.
 */
export class OverlappingUnitsError extends Error {
  readonly code = 'overlapping_units' as const;
  constructor(
    readonly cell: CellIndex,
    readonly wireIds: readonly [string, string]
  ) {
    super(
      `units ${wireIds[0]} and ${wireIds[1]} both occupy cell ${cell} at turn start — ` +
        'not a reachable board, so nothing measured on it means anything'
    );
    this.name = 'OverlappingUnitsError';
  }
}

// ---------------------------------------------------------------------------
// Geometry cache
// ---------------------------------------------------------------------------

interface Geometry {
  readonly grid: Grid;
  readonly terrain: Terrain;
  readonly engine: PartialEngine;
}

/**
 * Grid shift masks and the engine's arena are functions of the BOARD, not of
 * the turn, and a match hands us a fresh board object every turn — so a
 * per-board-object cache misses every single time. Keyed by everything the
 * three of them read. Bounded, so a long-lived process cannot accumulate one
 * engine per food layout it ever saw.
 */
const GEOMETRIES = new Map<string, Geometry>();
const GEOMETRY_CACHE_LIMIT = 24;

function geometryFor(
  marshalled: MarshalledBoard,
  maxUnits: number,
  maxTrail: number,
  maxHealth: number,
  hazardDamage: number,
  promotionWeight: number
): Geometry {
  const { config, fullWidth, fullHeight } = marshalled;
  const key = [
    fullWidth,
    fullHeight,
    config.walls.join(','),
    config.hazards.join(','),
    hazardDamage,
    maxHealth,
    promotionWeight,
    maxUnits,
    maxTrail,
    // The cloud source's premise includes the food board, so a changed food
    // layout must not reuse an engine built around the old one.
    config.food.join(','),
  ].join('|');
  const hit = GEOMETRIES.get(key);
  if (hit !== undefined) return hit;

  const grid = makeGrid(fullWidth, fullHeight);
  const terrain = makeTerrain(grid, config.walls, config.hazards);
  const engine = new PartialEngine(
    terrain,
    { food: boardWith(grid, config.food), potions: boardWith(grid, []) },
    { maxUnits, maxTrail, hazardDamage, maxHealth, pawnPromotionWeight: promotionWeight }
  );
  const geometry: Geometry = { grid, terrain, engine };
  if (GEOMETRIES.size >= GEOMETRY_CACHE_LIMIT) GEOMETRIES.clear();
  GEOMETRIES.set(key, geometry);
  return geometry;
}

/** Test hook: drop every cached engine. Never called on the decision path. */
export function clearGeometryCache(): void {
  GEOMETRIES.clear();
}

function boardWith(grid: Grid, cells: Iterable<number>): Board {
  const board = newBoard(grid);
  for (const c of cells) bbSet(board, c);
  return board;
}

// ---------------------------------------------------------------------------
// The substrate
// ---------------------------------------------------------------------------

export class EngineSubstrate implements Substrate {
  readonly turn: number;
  readonly grid: Grid;
  readonly terrain: Terrain;
  readonly engine: PartialEngine;
  /** Base state: every unit LIVE. Forked per resolution, never resolved. */
  readonly state: StateHandle;
  /** The api board this was built from, for consumers that need coordinates. */
  readonly marshalled: MarshalledBoard;

  private readonly specs: ReadonlyArray<UnitSpec>;
  private readonly units: ReadonlyArray<SubstrateUnit>;
  private readonly byUnitId = new Map<UnitId, SubstrateUnit>();
  private readonly byWireId = new Map<string, SubstrateUnit>();
  private readonly teamNumbers = new Map<string, number>();
  private readonly teamLabels = new Map<number, string>();
  private readonly regicideTeams = new Set<number>();
  private readonly narrowings: ReadonlyMap<UnitId, ReadonlyArray<number>>;
  private readonly modeledIds: ReadonlySet<UnitId>;

  /** Interned hold configurations, keyed by the sorted held-id list. */
  private readonly holdCache = new Map<string, HoldSet>();
  /** Slabs handed out and not yet returned. A leak shows up here first. */
  private readonly borrowed = new Set<number>();
  private claimView: {
    startField: CloudField;
    field: CloudField;
    assessor: RiskAssessor;
    food: Board;
  } | null = null;
  private targets: Board | null = null;
  private readonly influenceCache = new Map<UnitId, ReadonlySet<CellIndex>>();
  private resolveCount = 0;
  private released = false;

  constructor(options: SubstrateOptions) {
    const { board, turn } = options;
    this.turn = turn;
    const marshalled = marshalBoard(board, turn);
    this.marshalled = marshalled;

    const trailLengths = marshalled.units.map((u) => u.occupancy.length);
    const maxUnits = Math.max(4, marshalled.units.length);
    const maxTrail = Math.max(4, ...trailLengths, 1) + 2;
    // The partial engine carries ONE health ceiling; the board may configure
    // one per kind. The uncertainty layer may only err by claiming too much,
    // so the ceiling is the MAXIMUM of the configured values: a cloud grown
    // against it reaches at least as far as the truth.
    const maxHealth = Math.max(
      100,
      ...Object.values(marshalled.config.maxHealth ?? {}).filter(
        (v): v is number => typeof v === 'number'
      )
    );
    const promotionWeight = board.pawnPromotionWeight ?? 10;
    const geometry = geometryFor(
      marshalled,
      maxUnits,
      maxTrail,
      maxHealth,
      marshalled.config.hazardDamage,
      promotionWeight
    );
    this.grid = geometry.grid;
    this.terrain = geometry.terrain;
    this.engine = geometry.engine;

    // Team numbering: the deciding team is 0 by convention, so a subject-frame
    // question never has to hunt for it.
    const teamOrder: string[] = [];
    if (options.asTeam !== undefined) teamOrder.push(options.asTeam);
    for (const team of [...new Set(marshalled.units.map((u) => u.teamID))].sort()) {
      teamOrder.push(team);
    }
    for (const team of teamOrder) {
      if (this.teamNumbers.has(team)) continue;
      const n = this.teamNumbers.size;
      this.teamNumbers.set(team, n);
      this.teamLabels.set(n, team);
    }

    const observed = options.observedTurns;
    const specs: UnitSpec[] = [];
    const units: SubstrateUnit[] = [];
    marshalled.units.forEach((unit, index) => {
      const team = this.teamNumbers.get(unit.teamID) as number;
      const spec = toUnitSpec(unit, { unitId: index, team });
      specs.push(spec);
      const seen = observed?.get(unit.id);
      const staleness = seen === undefined ? 0 : Math.max(0, turn - seen);
      const record: SubstrateUnit = {
        unitId: index,
        wireId: unit.id,
        team,
        teamId: unit.teamID,
        kind: spec.kind,
        type: unit.type,
        isKing: unit.isKing === true,
        cells: spec.cells,
        weight: spec.weight ?? spec.cells.length,
        health: unit.health,
        tier: unit.tier,
        orientation: spec.orientation ?? 0,
        staleness,
      };
      units.push(record);
      this.byUnitId.set(index, record);
      this.byWireId.set(unit.id, record);
      if (unit.isKing === true) this.regicideTeams.add(team);
    });
    this.specs = specs;
    this.units = units;

    // The disjointness guard on the marshalling path: a piece's weight IS its
    // cell repeated, so only cells shared between DIFFERENT units are
    // impossible. See OverlappingUnitsError for what letting one through costs.
    const owner = new Map<number, string>();
    for (const spec of specs) {
      const wireId = units[spec.unitId as number]?.wireId ?? String(spec.unitId);
      for (const cell of new Set(spec.cells)) {
        const held = owner.get(cell);
        if (held !== undefined && held !== wireId) {
          throw new OverlappingUnitsError(cell, [held, wireId]);
        }
        owner.set(cell, wireId);
      }
    }

    const narrowings = new Map<UnitId, ReadonlyArray<number>>();
    for (const [wireId, options_] of options.narrowings ?? []) {
      const unit = this.byWireId.get(wireId);
      if (unit !== undefined) narrowings.set(unit.unitId, options_);
    }
    this.narrowings = narrowings;

    const modeled = new Set<UnitId>();
    if (options.modeled !== undefined) {
      for (const wireId of options.modeled) {
        const unit = this.byWireId.get(wireId);
        if (unit !== undefined) modeled.add(unit.unitId);
      }
    } else if (options.asTeam !== undefined) {
      const team = this.teamNumbers.get(options.asTeam);
      for (const unit of units) if (unit.team === team) modeled.add(unit.unitId);
    }
    this.modeledIds = modeled;

    this.state = this.engine.create(specs, marshalled.config.food, [], turn);
    this.borrowed.add(this.state.slab);
  }

  // --- roster ---------------------------------------------------------------

  /** Every live unit, in board order. Order IS the engine's slot order. */
  roster(): ReadonlyArray<SubstrateUnit> {
    return this.units;
  }

  unitIds(): ReadonlyArray<UnitId> {
    return this.units.map((u) => u.unitId);
  }

  unitOf(unitId: UnitId): SubstrateUnit | undefined {
    return this.byUnitId.get(unitId);
  }

  unitOfWireId(wireId: string): SubstrateUnit | undefined {
    return this.byWireId.get(wireId);
  }

  /** The engine-side number for a wire team id. Throws on an unknown team. */
  teamNumber(teamId: string): number {
    const n = this.teamNumbers.get(teamId);
    if (n === undefined) throw new Error(`substrate: unknown team ${JSON.stringify(teamId)}`);
    return n;
  }

  teamLabel(team: number): string | undefined {
    return this.teamLabels.get(team);
  }

  /** Teams that play under regicide — i.e. that field a living king. */
  regicideTeamNumbers(): ReadonlySet<number> {
    return this.regicideTeams;
  }

  /** Units this substrate's claim view treats as known movers. */
  modeled(): ReadonlySet<UnitId> {
    return this.modeledIds;
  }

  /** A live engine view of a unit on the base state. */
  viewOf(unitId: UnitId): UnitView | null {
    const slot = this.engine.slotOfUnit(this.state, unitId);
    if (slot < 0) return null;
    return this.engine.unitAt(this.state, slot);
  }

  /** How many resolutions this substrate has run. A budget/telemetry hook. */
  resolutions(): number {
    return this.resolveCount;
  }

  /** Slabs borrowed and not yet returned (the base state included). */
  outstanding(): number {
    return this.borrowed.size;
  }

  // --- grammar --------------------------------------------------------------

  /**
   * The pawn-attack target board: food ∪ every unit's turn-start occupancy.
   * THE canonical construction, taken from the engine's own vocabulary — a
   * pawn's diagonal is legal onto a cell that held food or ANY unit, with no
   * friendly exemption.
   */
  targetsBoard(): Board {
    if (this.targets !== null) return this.targets;
    const food = newBoard(this.grid);
    this.engine.foodBoard(this.state, food);
    this.targets = pawnTargetsInto(
      this.grid,
      newBoard(this.grid),
      food,
      this.specs.map((s) => s.cells)
    );
    return this.targets;
  }

  /** Is this cell a hazard? Terrain, so a fact — no claim is involved. */
  hazardAt(cell: CellIndex): boolean {
    return bbTest(this.terrain.hazard, cell);
  }

  /** Did this cell hold food at the start of the turn? */
  foodAt(cell: CellIndex): boolean {
    return bbTest(this.claims().food, cell);
  }

  /** Every distinct action this unit could take, from the engine's enumerator. */
  enumerate(unitId: UnitId): GrammarCandidate[] {
    const unit = this.byUnitId.get(unitId);
    if (unit === undefined) throw new UnknownUnitError(unitId);
    return enumerateActions(
      this.terrain,
      unit.kind,
      unit.cells[0] as number,
      unit.orientation,
      this.targetsBoard()
    );
  }

  /** The contract face of `enumerate`: the same options as `Candidate`s. */
  actionsOf(unitId: UnitId): ReadonlyArray<Candidate> {
    const unit = this.byUnitId.get(unitId);
    if (unit === undefined) throw new UnknownUnitError(unitId);
    const from = unit.cells[0] as CellIndex;
    return this.enumerate(unitId).map((a) => ({
      unitId,
      from,
      to: a.dest,
      path: a.action.kind === 'move' ? [...a.action.path] : [],
    }));
  }

  /** Live units on `asTeam` this decision is entitled to move. */
  commandable(asTeam: number): ReadonlyArray<UnitId> {
    return this.units.filter((u) => u.team === asTeam).map((u) => u.unitId);
  }

  /** The contract name for `pathFor`. */
  pathOf(unitId: UnitId, to: CellIndex): ReadonlyArray<CellIndex> | null {
    return this.pathFor(unitId, to);
  }

  /** The cells a staged destination actually enters, or null when illegal. */
  pathFor(unitId: UnitId, dest: CellIndex): ReadonlyArray<CellIndex> | null {
    const unit = this.byUnitId.get(unitId);
    if (unit === undefined) throw new UnknownUnitError(unitId);
    const action = planAction(
      this.terrain,
      unit.kind,
      unit.cells[0] as number,
      dest,
      unit.orientation,
      this.targetsBoard()
    );
    if (action === null) return null;
    return action.kind === 'move' ? action.path : [];
  }

  // --- claims ---------------------------------------------------------------

  /**
   * The claim field for the MODELLED set: every unmodelled unit held at its own
   * observation turn, advanced to the turn a resolution adjudicates against.
   * `entangled` and the tier-2 footprint questions read this.
   */
  claimField(): CloudField {
    return this.claims().field;
  }

  /** The engine's risk layer over the claim field. */
  assessor(): RiskAssessor {
    return this.claims().assessor;
  }

  /**
   * A risk layer over the SAME claim field with an empty overlay.
   *
   * `assessPath` accretes maybe-durable material into the assessor it runs
   * through — by design, so that within ONE joint assignment a possible kill at
   * sub-step j is material for another mover crossing at j' > j. Running two
   * ALTERNATIVE candidates of the same unit through one assessor is a different
   * thing entirely: the first candidate's possible kill would be cited against
   * the second, which is sound but loose and makes the answer depend on
   * enumeration order. Independent candidates each get their own.
   */
  freshAssessor(): RiskAssessor {
    const view = this.claims();
    return new RiskAssessor({
      field: view.field,
      startField: view.startField,
      terrain: this.terrain,
      hazardDamage: this.engine.config.hazardDamage,
      maxHealth: this.engine.config.maxHealth,
      food: view.food,
    });
  }

  private claims(): {
    startField: CloudField;
    field: CloudField;
    assessor: RiskAssessor;
    food: Board;
  } {
    if (this.claimView !== null) return this.claimView;
    const startField = this.fieldHolding(this.heldIdsOutside(this.modeledIds));
    const field = startField.isEmpty ? startField : startField.advanceTo(this.turn + 1);
    const food = newBoard(this.grid);
    this.engine.foodBoard(this.state, food);
    const assessor = new RiskAssessor({
      field,
      startField,
      terrain: this.terrain,
      hazardDamage: this.engine.config.hazardDamage,
      maxHealth: this.engine.config.maxHealth,
      food,
    });
    this.claimView = { startField, field, assessor, food };
    return this.claimView;
  }

  // --- Substrate ------------------------------------------------------------

  /**
   * Resolve one turn with `plan` modelled and everything else held, in
   * `asTeam`'s frame.
   *
   * THE RETURNED RESOLUTION OWNS A SLAB. Hand it to `releaseResolution`, or
   * use `withResolution`, which cannot forget. `release()` reclaims anything
   * still outstanding, so a forgotten release costs arena pressure inside one
   * decision rather than a leak across turns — but the assertion a test should
   * make is `outstanding() === 1` (the base state) between decisions.
   */
  resolveBoundedFor(plan: JointPlan, asTeam: number): BoundedResolve {
    return this.resolveBoundedFull(plan, asTeam);
  }

  /**
   * The same resolution, with the two things `resolveBoundedFor`'s return type
   * cannot carry: the per-team intervals and the subject-frame material bounds.
   * The engine computes all three in one pass; recomputing the fold above this
   * file would be a second scoring pipeline, which is the thing the single-
   * pipeline rule exists to forbid.
   */
  resolveBoundedFull(plan: JointPlan, asTeam: number): BoundedResolve {
    if (this.released) throw new Error('substrate: resolve after release()');
    const assignment = new Map<number, number>();
    for (const [unitId, candidate] of plan) {
      if (!this.byUnitId.has(unitId)) throw new UnknownUnitError(unitId);
      assignment.set(unitId, candidate.to);
    }

    const held = this.heldIdsOutside(new Set(assignment.keys()));
    // Order matters: the hold set is built off the IMMUTABLE base state before
    // the working fork is taken. `makeHoldSet` forks internally, and calling it
    // with our own fork outstanding lets the two allocations interact — the
    // symptom is "hold set names unit N, absent from this state" on the next
    // call with a different held set.
    const holds = held.length === 0 ? null : this.holdSetFor(held);

    let working = this.engine.fork(this.state);
    this.borrowed.add(working.slab);
    if (holds !== null) working = this.engine.applyHoldSet(working, holds);

    this.resolveCount++;
    const out = resolveBounded(this.engine, working, assignment, asTeam);
    const touched = newBoard(this.grid);
    touched.set(this.engine.touched.subarray(0, this.grid.words));
    this.borrowed.add(out.resolution.state.slab);
    // `resolveBounded` forks again internally, so the working handle is spent
    // the moment it returns.
    this.releaseHandle(working);
    return { ...out, touched };
  }

  /** Scoped resolution: the leak-proof door. */
  withResolution<T>(plan: JointPlan, asTeam: number, fn: (r: BoundedResolve) => T): T {
    const out = this.resolveBoundedFull(plan, asTeam);
    try {
      return fn(out);
    } finally {
      this.releaseResolution(out.resolution);
    }
  }

  /** Return a resolution's slab. Idempotent. */
  releaseResolution(resolution: Resolution): void {
    this.releaseHandle(resolution.state);
  }

  private releaseHandle(handle: StateHandle): void {
    if (handle.slab === this.state.slab) return;
    if (!this.borrowed.delete(handle.slab)) return;
    this.engine.release(handle);
  }

  /**
   * Which held units' claims touch these cells in sub-step time.
   *
   * Each probe carries the occupancy WINDOW `[fromSubStep, toSubStep]`: a cell
   * merely passed through has both ends at its own path index, and a cell come
   * to rest on takes `toSubStep: Number.MAX_SAFE_INTEGER`, because a rested
   * unit stands there for the rest of the turn and meets everything. The gate
   * below reads `toSubStep` — the conservative end for a head arrival —
   * and `fromSubStep` is carried for the tightening a later version may take
   * (a claim that can only arrive after the window closes cannot contest it).
   *
   * Everything ABSENT from the answer is proved irrelevant to those cells, so
   * its bound is tight rather than merely sound. That is what makes the worst
   * case affordable enough to be the default.
   */
  entangled(
    cells: ReadonlyArray<{ cell: CellIndex; fromSubStep: SubStep; toSubStep: SubStep }>
  ): ReadonlyArray<UnitId> {
    const out = new Set<UnitId>();
    for (const slot of this.claimField().slots) {
      const lb = headSubStepLBOf(slot.cloud, this.grid);
      for (const probe of cells) {
        const inBody = bbTest(slot.cloud.bodyPossible, probe.cell);
        if (inBody) {
          out.add(slot.record.unitId);
          break;
        }
        if (!bbTest(slot.cloud.headPossible, probe.cell)) continue;
        // A head arrival is gated in time: a unit that cannot get there before
        // the window closes cannot contest it. Body material is not — it is
        // already standing there when the turn opens.
        if (Math.max(0, (lb[probe.cell] as number) - 1) <= probe.toSubStep) {
          out.add(slot.record.unitId);
          break;
        }
      }
    }
    return [...out].sort((a, b) => a - b);
  }

  /**
   * A modelled sibling — the contract's `withModelled`, under the PLAN-DOMAIN
   * RULE this substrate already lives by: naming a unit in a plan makes it
   * live, so a sibling needs no new engine state, only independent release
   * semantics. The proxy shares every slab and cache with its parent and its
   * `release()` is a no-op, so releasing a sibling can never disturb the
   * parent (nor return a slab the parent still owns).
   */
  withModelled(_modelled: ReadonlyArray<UnitId>): Substrate {
    const parent = this;
    return new Proxy(parent, {
      get(target, prop, receiver): unknown {
        if (prop === 'release') return () => undefined;
        if (prop === 'withModelled') {
          return (m: ReadonlyArray<UnitId>) => parent.withModelled(m);
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...a: never[]) => unknown).bind(target)
          : value;
      },
    }) as unknown as Substrate;
  }

  /**
   * INTERACTION FOOTPRINT — the cells this unit's options can influence this
   * turn: its own occupancy (vacated or dragged) plus every cell any legal
   * action of its own grammar enters.
   *
   * OVER-APPROXIMATION, AND ITS DIRECTION. This is the UNION over the unit's
   * whole option set, not the footprint of one chosen move, and it is one
   * turn's grammar reach rather than a transitive closure. So it is a SUPERSET
   * of the influence of any single move, and that is the safe direction for
   * both consumers: a footprint that is too big makes a tier-2 cache transfer
   * fail to apply (work repeated, never a wrong answer), and makes a dirty-set
   * re-search too eager (time spent, never a stale bound kept). A footprint too
   * SMALL would silently keep an invalidated evaluation, which is why the
   * transitive tightening is deliberately not attempted in v1.
   */
  influenceOf(unitId: UnitId): ReadonlySet<CellIndex> {
    const cached = this.influenceCache.get(unitId);
    if (cached !== undefined) return cached;
    const unit = this.byUnitId.get(unitId);
    if (unit === undefined) throw new UnknownUnitError(unitId);
    const cells = new Set<CellIndex>(unit.cells);
    for (const candidate of this.enumerate(unitId)) {
      if (candidate.action.kind !== 'move') continue;
      for (const c of candidate.action.path) cells.add(c);
    }
    const frozen: ReadonlySet<CellIndex> = cells;
    this.influenceCache.set(unitId, frozen);
    return frozen;
  }

  /** Return every slab. After this the substrate refuses further work. */
  release(): void {
    if (this.released) return;
    this.released = true;
    for (const slab of [...this.borrowed]) {
      if (slab === this.state.slab) continue;
      this.borrowed.delete(slab);
      this.engine.release({ ...this.state, slab });
    }
    this.borrowed.delete(this.state.slab);
    this.engine.release(this.state);
    this.holdCache.clear();
    this.claimView = null;
    this.influenceCache.clear();
  }

  // --- holds ----------------------------------------------------------------

  private heldIdsOutside(modeled: ReadonlySet<UnitId>): UnitId[] {
    const out: UnitId[] = [];
    for (const unit of this.units) if (!modeled.has(unit.unitId)) out.push(unit.unitId);
    return out;
  }

  /**
   * The interned hold configuration for a held set.
   *
   * `makeHoldSet` owns the slot lifecycle and the premise key (which is
   * private to the engine and must match, or `applyHoldSet` refuses). Its
   * FIELD is replaced, because `holdMany` stamps one `heldAtTurn` for the whole
   * call and this roster is observed at different turns — and a unit last seen
   * three turns ago, stamped "held now", would claim a one-turn cloud for a
   * four-turn-old observation. That is an under-approximation, which is the one
   * direction this design may never err in.
   */
  private holdSetFor(held: ReadonlyArray<UnitId>): HoldSet {
    if (held.length > MAX_FROZEN) throw new TooManyHeldError(held.length);
    const key = [...held].sort((a, b) => a - b).join(',');
    const hit = this.holdCache.get(key);
    if (hit !== undefined) return hit;

    const slots: number[] = [];
    for (const unitId of held) {
      const slot = this.engine.slotOfUnit(this.state, unitId);
      if (slot >= 0) slots.push(slot);
    }
    const made = this.engine.makeHoldSet(this.state, slots);
    const holds: HoldSet = { ...made, field: this.fieldHolding(held) };
    this.holdCache.set(key, holds);
    return holds;
  }

  /** A cloud field over `held`, one record per unit at ITS observation turn. */
  private fieldHolding(held: ReadonlyArray<UnitId>): CloudField {
    if (held.length === 0) return emptyField(this.grid, this.turn);
    if (held.length > MAX_FROZEN) throw new TooManyHeldError(held.length);
    const records: FrozenRecord[] = [];
    for (const unitId of held) {
      const unit = this.byUnitId.get(unitId);
      if (unit === undefined) continue;
      records.push({
        unitId,
        kind: unit.kind,
        team: unit.team,
        occupancy: unit.cells,
        // RULE 4, and the whole of it: the record is stamped with the turn the
        // unit was OBSERVED. The post-advance field the resolver reads supplies
        // this turn's unmade choice by itself; adding one here doubles it.
        heldAtTurn: this.turn - unit.staleness,
        health: unit.health,
        tier: unit.tier,
        tierExpiresAtTurn: null,
        weight: unit.weight,
        orientation: unit.orientation,
        narrowedTo: this.narrowings.get(unitId) ?? null,
      });
    }
    return emptyField(this.grid, this.turn).withHeldMany(
      this.engine.sourceOf(this.state),
      records,
      this.turn
    );
  }
}

/** The one construction door. */
export function makeSubstrate(options: SubstrateOptions): EngineSubstrate {
  return new EngineSubstrate(options);
}

/** A claim slot by unit id, for consumers reading a held unit's interval. */
export function claimSlotOf(sub: EngineSubstrate, unitId: UnitId): FieldSlot | undefined {
  return sub.claimField().slotOf(unitId);
}
