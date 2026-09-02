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
import { settleTurn } from '../engine-vendor/engine/settleTurn';
import type { UnitType } from '../engine-vendor/shared/types/Game';

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
import { kindOfWireType, toUnitSpec } from '../partial-engine/wire-adapter';

import { NO_ORDER_MOVE } from './contracts';
import { potionBoardEnabled, tierExpiryEnabled } from './tier-truth';
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
  /**
   * The game this substrate belongs to. Scopes the geometry (engine + arena)
   * cache, so concurrent games do not share a slab arena and a finished game's
   * engines can be dropped. Absent ⇒ a shared scope, which is the old
   * behaviour and is what tests and probes want.
   */
  readonly gameId?: string;
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
  /**
   * The first absolute turn at which `tier` no longer governs a contest, or
   * null when the wire carries no effect schedule for this unit. EXCLUSIVE:
   * the wire's `invulnerabilityExpiryTurn` is the LAST governing turn and the
   * +1 is applied once, in `marshalBoard`.
   */
  readonly tierExpiresAtTurn: number | null;
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
  readonly key: string;
  readonly grid: Grid;
  readonly terrain: Terrain;
  readonly engine: PartialEngine;
  /** Live substrates holding this engine. An engine with references is being
   * resolved against RIGHT NOW; dropping it would orphan a live arena. */
  refs: number;
  lastUsed: number;
  /** Marked for removal as soon as the last reference goes. */
  retire: boolean;
}

/**
 * Grid shift masks and the engine's arena are functions of the BOARD, not of
 * the turn, and a match hands us a fresh board object every turn — so a
 * per-board-object cache misses every single time. Keyed by everything the
 * three of them read.
 *
 * SCOPED PER GAME, AND REFERENCE-COUNTED. Two things forced both:
 *
 *  - An engine is a slab ARENA and a cloud-source cache, and two games with
 *    identical geometry are two decisions that overlap by design (a turn
 *    resolves early, so turn N+1's decision starts while N's is still
 *    running). Sharing one arena between them makes their pressure additive
 *    and their lifetimes entangled for no benefit — a decision reuses its own
 *    game's engine turn after turn, which is where the whole saving comes
 *    from. The game id is part of the key.
 *  - The engine's cloud-source cache grows for the life of the engine (an
 *    upstream demand: it wants a WeakMap or a per-decision source), so an
 *    engine that never dies is retained heap that never stops growing. A
 *    per-game scope gives it a LIFETIME: when the game ends its engines go,
 *    and the growth is bounded by one game rather than by the process. This
 *    is a mitigation, not the fix, and it does not fight the fix — an engine
 *    whose sources evict themselves simply retires cheaper.
 *
 * Eviction never CLEARS: an entry with live substrates is retired instead, and
 * leaves when its last reference does. Wholesale `clear()` at a size limit
 * orphaned engines that live resolutions were still borrowing slabs from.
 */
const GEOMETRIES = new Map<string, Geometry>();
const GEOMETRY_CACHE_LIMIT = 24;
let geometryTick = 0;

/** Census for the soak: what the shared-arena decision actually costs. */
export function geometryCacheStats(): {
  entries: number;
  live: number;
  retiring: number;
  scopes: number;
} {
  let live = 0;
  let retiring = 0;
  const scopes = new Set<string>();
  for (const g of GEOMETRIES.values()) {
    if (g.refs > 0) live++;
    if (g.retire) retiring++;
    scopes.add(g.key.slice(0, g.key.indexOf('\u0000')));
  }
  return { entries: GEOMETRIES.size, live, retiring, scopes: scopes.size };
}

/**
 * THE HEALTH TABLE THE ENGINE READS, indexed by `UnitKind`.
 *
 * The wire configures `maxHealthPerUnit` per unit TYPE and the vendored
 * resolver reads it as `input.maxHealth[type]`; the partial engine wants the
 * same table indexed by kind. Absent entries mean the flat `maxHealth`, so a
 * board that configures nothing behaves exactly as it always did.
 *
 * This used to be flattened to the maximum of the configured values, because
 * the engine carried one ceiling. That kept ceilings sound and LOST FLOORS:
 * our own low-maximum units were credited with a refuel budget — and so a
 * reach — they do not have, which is a floor above the truth as soon as
 * anything reads reach on its lo side. The engine takes the table now.
 */
function healthPerKind(
  maxHealth: number,
  table: Readonly<Record<string, number>> | undefined
): ReadonlyArray<number> | null {
  if (table === undefined) return null;
  const out: number[] = [];
  let diverges = false;
  for (const [type, value] of Object.entries(table)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    let kind: number;
    try {
      kind = kindOfWireType(type as UnitType);
    } catch {
      continue; // a type this engine has no kind for cannot be indexed
    }
    while (out.length <= kind) out.push(maxHealth);
    out[kind] = value;
    if (value !== maxHealth) diverges = true;
  }
  return diverges ? out : null;
}

function geometryFor(
  marshalled: MarshalledBoard,
  scope: string,
  maxUnits: number,
  maxTrail: number,
  maxHealth: number,
  maxHealthPerKind: ReadonlyArray<number> | null,
  hazardDamage: number,
  promotionWeight: number,
  potions: ReadonlyArray<number>
): Geometry {
  const { config, fullWidth, fullHeight } = marshalled;
  const key = [
    // The game scope, first, so a game's entries are addressable as a group.
    scope,
    String(fullWidth),
    String(fullHeight),
    config.walls.join(','),
    config.hazards.join(','),
    String(hazardDamage),
    String(maxHealth),
    // The per-kind table is part of the engine's premise: two boards that
    // configure different ceilings are different engines.
    (maxHealthPerKind ?? []).join(','),
    String(promotionWeight),
    String(maxUnits),
    String(maxTrail),
    // The cloud source's premise includes the food board, so a changed food
    // layout must not reuse an engine built around the old one.
    config.food.join(','),
    // ...and the potion board, for exactly the same reason: `boundsAt` prices
    // a tier interval against `premise.potions`, so two boards with different
    // potion layouts are different engines even at identical terrain.
    potions.join(','),
  ].join('\u0000');
  const hit = GEOMETRIES.get(key);
  if (hit !== undefined && !hit.retire) {
    hit.refs++;
    hit.lastUsed = ++geometryTick;
    return hit;
  }

  const grid = makeGrid(fullWidth, fullHeight);
  const terrain = makeTerrain(grid, config.walls, config.hazards);
  const engine = new PartialEngine(
    terrain,
    { food: boardWith(grid, config.food), potions: boardWith(grid, potions) },
    {
      maxUnits,
      maxTrail,
      hazardDamage,
      maxHealth,
      maxHealthPerKind,
      pawnPromotionWeight: promotionWeight,
    }
  );
  const geometry: Geometry = {
    key,
    grid,
    terrain,
    engine,
    refs: 1,
    lastUsed: ++geometryTick,
    retire: false,
  };
  GEOMETRIES.set(key, geometry);
  evictGeometries();
  return geometry;
}

/** Make room, without ever orphaning an engine a live substrate is using. */
function evictGeometries(): void {
  while (GEOMETRIES.size > GEOMETRY_CACHE_LIMIT) {
    let victim: Geometry | null = null;
    for (const g of GEOMETRIES.values()) {
      if (g.refs > 0) continue;
      if (victim === null || g.lastUsed < victim.lastUsed) victim = g;
    }
    if (victim === null) {
      // Everything is live. Retire the oldest so it leaves the moment it can,
      // and stop — over the limit is better than a use-after-free.
      let oldest: Geometry | null = null;
      for (const g of GEOMETRIES.values()) {
        if (g.retire) continue;
        if (oldest === null || g.lastUsed < oldest.lastUsed) oldest = g;
      }
      if (oldest !== null) oldest.retire = true;
      return;
    }
    GEOMETRIES.delete(victim.key);
  }
}

function releaseGeometry(geometry: Geometry): void {
  geometry.refs = Math.max(0, geometry.refs - 1);
  if (geometry.refs === 0 && geometry.retire) GEOMETRIES.delete(geometry.key);
}

/**
 * A game is over: its engines have no future. Entries with no live substrate
 * go now; the rest are retired and leave with their last reference. This is
 * the geometry cache's LIFETIME — without it a long-lived process keeps one
 * growing cloud-source cache per board it has ever seen.
 */
export function releaseGeometriesFor(gameId: string): number {
  const prefix = `${gameId}\u0000`;
  let dropped = 0;
  for (const [key, g] of [...GEOMETRIES]) {
    if (!key.startsWith(prefix)) continue;
    if (g.refs > 0) {
      g.retire = true;
      continue;
    }
    GEOMETRIES.delete(key);
    dropped++;
  }
  return dropped;
}

/**
 * The questions a modelled sibling cannot answer for itself, because it shares
 * its parent's claim view. See `EngineSubstrate.withModelled`.
 */
const CLAIM_QUESTIONS: ReadonlySet<string> = new Set([
  'claimField',
  'entangled',
  'influenceOf',
  'modeled',
]);

/**
 * A claim question was asked of a modelled sibling whose modelled set is
 * NARROWER than its parent's, where the parent's shared claim view would
 * under-report entanglement — the unsound direction.
 */
export class SharedClaimViewError extends Error {
  readonly code = 'shared_claim_view' as const;
  constructor(
    readonly question: string,
    readonly siblingModelled: ReadonlyArray<UnitId>,
    readonly parentModelled: ReadonlyArray<UnitId>
  ) {
    super(
      `substrate: ${question}() on a modelled sibling that expects ` +
        `[${siblingModelled.join(',')}] live while its parent models ` +
        `[${parentModelled.join(',')}]. The sibling shares the parent's claim view, so the ` +
        'answer would be about the parent — and for a narrower sibling that UNDER-reports ' +
        'entanglement, which is the direction a floor may not be built on. A consumer that ' +
        'needs per-sibling claims needs a sibling with its own claim field.'
    );
    this.name = 'SharedClaimViewError';
  }
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
  /** The turn-start potion board, materialised on first ask. */
  private potions: Board | null = null;
  /** `tiersAfterPickupBy`, memoised. One settlement per collector per decision. */
  private readonly pickupTiers = new Map<UnitId, ReadonlyMap<UnitId, number>>();
  private readonly influenceCache = new Map<UnitId, ReadonlySet<CellIndex>>();
  private resolveCount = 0;
  private released = false;
  private readonly geometry: Geometry;

  constructor(options: SubstrateOptions) {
    const { board, turn } = options;
    this.turn = turn;
    const marshalled = marshalBoard(board, turn);
    this.marshalled = marshalled;

    const trailLengths = marshalled.units.map((u) => u.occupancy.length);
    const maxUnits = Math.max(4, marshalled.units.length);
    const maxTrail = Math.max(4, ...trailLengths, 1) + 2;
    // The flat ceiling is the DEFAULT for kinds the board does not configure,
    // and the per-kind table carries the ones it does. It used to be the
    // maximum over the table with the table thrown away — sound ceilings,
    // unsound floors (see `healthPerKind`).
    const configured = marshalled.config.maxHealth ?? {};
    const maxHealth = Math.max(
      100,
      ...Object.values(configured).filter((v): v is number => typeof v === 'number')
    );
    const maxHealthPerKind = healthPerKind(maxHealth, configured);
    const promotionWeight = board.pawnPromotionWeight ?? 10;
    // THE POTION BOARD, which used to be built empty here. It is the premise
    // `CloudSource.boundsAt` prices a frozen unit's tier interval against; with
    // no cells in it `reachablePotions` is identically zero and the whole
    // tier-ceiling arithmetic collapses to the observed tier. See tier-truth.ts.
    const potions = potionBoardEnabled() ? marshalled.potions : [];
    const geometry = geometryFor(
      marshalled,
      options.gameId ?? '',
      maxUnits,
      maxTrail,
      maxHealth,
      maxHealthPerKind,
      marshalled.config.hazardDamage,
      promotionWeight,
      potions
    );
    this.geometry = geometry;
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
    const expiries = marshalled.tierExpiry;
    const useExpiry = tierExpiryEnabled();
    marshalled.units.forEach((unit, index) => {
      const team = this.teamNumbers.get(unit.teamID) as number;
      // A tier is a WINDOW. `MarshalledBoard.tierExpiry` carries the first turn
      // at which it no longer governs (exclusive — the conversion from the
      // wire's inclusive figure is done once, in marshalBoard). Passing null
      // here is what made the search price a three-turn buff as permanent.
      const tierExpiresAtTurn = useExpiry ? (expiries[index] ?? null) : null;
      const spec = toUnitSpec(unit, { unitId: index, team, tierExpiresAtTurn });
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
        tierExpiresAtTurn,
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

    this.state = this.engine.create(specs, marshalled.config.food, potions, turn);
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

  /**
   * Does this cell hold an invulnerability potion?
   *
   * Item spawning is gated off while anything is frozen, so the turn-start
   * board is the whole answer for the turn being decided. Read off the
   * MARSHALLED board rather than off the engine state, deliberately: the
   * engine's copy is what the cloud premise prices tier intervals against and
   * is gated by the tier-truth seam, while this predicate answers a question
   * about the rules ("would ending here collect a potion, and therefore take a
   * −1") that is true whatever the search is allowed to model.
   */
  potionAt(cell: CellIndex): boolean {
    if (this.potions === null) this.potions = boardWith(this.grid, this.marshalled.potions);
    return bbTest(this.potions, cell);
  }

  /** Are potions live at all? Off, and a potion cell is inert scenery. */
  potionsEnabled(): boolean {
    return this.marshalled.potionsEnabled;
  }

  /**
   * THE TIERS A PICKUP BY `unitId` LEAVES BEHIND — asked of the rules, not
   * asserted here.
   *
   * The pickup is inverted and it has TWO halves: the collector takes a level
   * off and every one of its LIVING allies takes one on, both lapsing one
   * window later. A reading that models only the first half prices a pickup as
   * pure loss; a reading that hardcodes either polarity is a second encoding of
   * a rule that has already moved once. So the question goes to `settleTurn`,
   * which is where both halves are written, and what comes back is the tier
   * vector the turn AFTER the pickup opens at — expiry included, so a window
   * that lapses on the same turn is netted off for free.
   *
   * THE PROBE IS A HELD BOARD. Every unit stands where it stands with an empty
   * path and a health no turn can spend, and the one potion offered is the
   * collector's own head cell. Nothing moves, so nothing contests, so nothing
   * dies and no death can drop a unit out of the answer; the only phase with
   * anything to do is the one being asked about. Memoised per unit: a decision
   * asks this once per unit of ours that can reach a potion, and never at all
   * on the potion-free boards that are most of them.
   */
  tiersAfterPickupBy(unitId: UnitId): ReadonlyMap<UnitId, number> {
    const hit = this.pickupTiers.get(unitId);
    if (hit !== undefined) return hit;
    const collector = this.byUnitId.get(unitId);
    if (collector === undefined) throw new UnknownUnitError(unitId);

    const m = this.marshalled;
    const settled = settleTurn({
      ...m.config,
      units: m.units.map((u) => ({ ...u, path: [], health: Number.MAX_SAFE_INTEGER })),
      turn: m.arrivalTurn,
      teamOf: Object.fromEntries(m.teamOf),
      effects: m.effects,
      potions: [collector.cells[0] as number],
      potionsEnabled: m.potionsEnabled,
      potionWindowTurns: m.potionWindowTurns,
    });

    const out = new Map<UnitId, number>();
    for (const [wireId, tier] of Object.entries(settled.tiers)) {
      const unit = this.byWireId.get(wireId);
      if (unit !== undefined) out.set(unit.unitId, tier);
    }
    this.pickupTiers.set(unitId, out);
    return out;
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
    this.borrowed.add(out.resolution.state.slab);
    // `resolveBounded` forks again internally, so the working handle is spent
    // the moment it returns.
    this.releaseHandle(working);
    return out;
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
   * live, so a sibling needs no new engine state for RESOLUTION, only
   * independent release semantics. The proxy shares every slab and cache with
   * its parent and its `release()` is a no-op, so releasing a sibling can
   * never disturb the parent (nor return a slab the parent still owns).
   *
   * THE LIMITATION, STATED. A sibling shares the parent's CLAIM VIEW, which is
   * built from the PARENT's modelled set. Resolution is unaffected — a
   * resolve derives its held set from the plan it is given, not from this
   * field — but a CLAIM question (`claimField`, `entangled`, `influenceOf`,
   * `modeled`) asked of a sibling is answered about the parent. For a sibling
   * whose modelled set is a SUPERSET of the parent's that is a sound
   * over-approximation: more units carry claims than the sibling says are
   * held, and an over-reported claim only loosens a bound. For a NARROWER
   * sibling it is the unsound direction — units the sibling expects to be
   * claims are answered as modelled, so entanglement is UNDER-reported and a
   * floor built on it would be too high.
   *
   * So a narrower sibling refuses claim questions outright. Resolution,
   * enumeration and the plan-domain machinery all work exactly as before; only
   * the questions whose answer would be wrong throw. Fail loud, never wrong.
   * (The bank's views are narrower than the parent — they name the references
   * plus one enemy, not our own units — and they ask no claim questions, which
   * is why this is a guard rather than a rewrite. A consumer that needs real
   * per-sibling claims, such as the deferred tier-2 footprint transfer, needs
   * a sibling with its own claim field and its own slab lifecycle: that is the
   * fix, and this is the tripwire that will demand it.)
   */
  withModelled(modelled: ReadonlyArray<UnitId>): Substrate {
    const parent = this;
    const requested = new Set(modelled);
    const narrower = [...parent.modeledIds].some((id) => !requested.has(id));
    return new Proxy(parent, {
      get(target, prop, receiver): unknown {
        if (prop === 'release') return () => undefined;
        if (prop === 'withModelled') {
          return (m: ReadonlyArray<UnitId>) =>
            parent.withModelled([...requested, ...m]);
        }
        if (narrower && typeof prop === 'string' && CLAIM_QUESTIONS.has(prop)) {
          return () => {
            throw new SharedClaimViewError(prop, [...requested], [...parent.modeledIds]);
          };
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
    // The engine outlives this substrate by design (that is the cache), but
    // only while something is still using it.
    releaseGeometry(this.geometry);
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
        tierExpiresAtTurn: unit.tierExpiresAtTurn,
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
