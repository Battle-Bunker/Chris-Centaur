/**
 * THE ENGINE SUBSTRATE — one translation from this repo's canonical board into
 * the one engine, and one place that settles a turn.
 *
 * Everything above this file (candidates, evaluation, search, kernel) talks to
 * the rules only through `Substrate` in ./contracts, and everything behind
 * this file is `engine-vendor/`: `settleTurn` when every mover is known,
 * `settlePartial` when some are not, `computeClaims` for what the unknown
 * ones could be doing, and `queries` for the grammar asked questions. There is
 * no second engine any more, no arena, no slab, and no cloud of our own.
 *
 * ── THE FIVE RULES THIS FILE EXISTS TO KEEP ────────────────────────────────
 *
 * 1. ONE TRANSLATION. The board arrives as the api-coordinate `Board` every
 *    other module in this repo reads and goes through `marshalBoard` — the
 *    same marshalling the turn oracle uses. Nothing above this file builds an
 *    engine roster, and nothing below it sees an api coordinate.
 *
 * 2. A DEFAULT IS NAMED, NEVER SILENT. The plan's domain IS the modelled set:
 *    a unit the plan names is a mover, a unit it omits is HELD and carries a
 *    claim. A caller that wants a unit live but undirected names it with
 *    `NO_ORDER_MOVE`, which asks the kind for its own default action — a rule
 *    of the game, not a guess about an agent.
 *
 * 3. PESSIMISM SCOPE RIDES THE CALL. Worst case is worst FOR A DECLARED TEAM,
 *    so `resolveBoundedFor(plan, asTeam)` is the only door and the material
 *    fold behind it (`bounds/material.ts`) flips its endpoints per participant
 *    relative to that team.
 *
 * 4. STALENESS IS `turn − observedTurn`, AND IT IS APPLIED ONCE. A held unit's
 *    record carries the turn it was OBSERVED and the engine dilates from there
 *    to the turn being settled. Adding this turn's unmade choice here as well
 *    would double it.
 *
 * 5. CLAIMS ARE HOISTED, NEVER RECOMPUTED PER PLAN. `computeClaims` is a pure
 *    function of the held records and the board — of nothing any assignment
 *    does — so it is computed once per (held set, narrowing) and handed to
 *    `settlePartial` as its third argument. That is the one performance
 *    discipline this file keeps, and it replaces the whole arena the previous
 *    engine needed.
 */

import type { Board as ApiBoard } from '../types/battlesnake';
import { marshalBoard, settleInputBase } from '../logic/turn-oracle';
import type { MarshalledBoard } from '../logic/turn-oracle';
import type { ResolveUnit } from '../engine-vendor/engine/resolveTurn';
import type { UnitType } from '../engine-vendor/shared/types/Game';
import type { Orientation } from '../engine-vendor/engine/moveGrammar';
import type { BoardShape, GrammarUnit } from '../engine-vendor/engine/queries';
import { coverOf, legalTargets, pathOf as pathOfQuery } from '../engine-vendor/engine/queries';
import { settleTurn } from '../engine-vendor/engine/settleTurn';
import { NO_SPAWN } from '../engine-vendor/engine/spawn';
import { computeClaims, NEVER } from '../engine-vendor/engine/claims';
import type { Claim, HeldUnit, PartialSettleInput } from '../engine-vendor/engine/claims';
import { settlePartial } from '../engine-vendor/engine/settlePartial';
import type { PartialSettlement } from '../engine-vendor/engine/settlePartial';

import { makeGrid, makeTerrain, bbTest } from './bits';
import type { Grid, Terrain } from './bits';
import { materialOf } from './bounds/material';
import { planKey } from './bounds/plan';
import { ledgerOf } from './bounds/ledger';
import { assessPath } from './pathrisk';
import { NO_ORDER_MOVE } from './contracts';
import type {
  BoundedResolution,
  Candidate,
  CellIndex,
  JointPlan,
  SubStep,
  Substrate,
  TraversalVerdict,
  UnitId,
} from './contracts';

/**
 * The explicit "no order" destination — the contract's own sentinel. Naming a
 * unit with this asks for the KIND's own default action (a trail unit
 * continues straight, a piece holds). Omitting the unit from a plan does
 * something else entirely: it becomes a held claim.
 */
export { NO_ORDER_MOVE };

/** What one bounded settlement produces — the contract's own shape. */
export type BoundedResolve = BoundedResolution;

export interface SubstrateOptions {
  /** This repo's canonical board, in api coordinates. */
  readonly board?: ApiBoard;
  /**
   * The already-marshalled board, for a caller that HAS engine coordinates —
   * the test harness, and nothing on the decision path. Exactly one of `board`
   * and `marshalled` is given; `board` goes through `marshalBoard`, which is
   * the one translation.
   */
  readonly marshalled?: MarshalledBoard;
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
   * a claim. This governs `claimsOf` / `entangled` only — `resolveBoundedFor`
   * derives its own held set from the plan it is given.
   */
  readonly modeled?: Iterable<string>;
  /** Held units narrowed to a declared first-move set (an ASSUMPTION). */
  readonly narrowings?: ReadonlyMap<string, ReadonlyArray<number>>;
  /**
   * The game this substrate belongs to. Scopes the geometry cache, so a
   * finished game's boards can be dropped as a group.
   */
  readonly gameId?: string;
  /**
   * How a wire id becomes a unit id. Board order by default, which is what the
   * decision path wants — the numbering is private to one decision. A harness
   * that NAMES its units (fixtures that say "unit 3 kills unit 1") passes its
   * own, so the numbers in a failing assertion are the numbers in the board.
   */
  readonly identify?: (wireId: string, index: number) => UnitId;
}

/** A unit as this substrate reads it back — the wire vocabulary, not the engine's. */
export interface SubstrateUnit {
  readonly unitId: UnitId;
  readonly wireId: string;
  readonly team: number;
  readonly teamId: string;
  /** The rules' own kind. Read for CLASS properties through the grammar. */
  readonly type: UnitType;
  readonly isKing: boolean;
  /** Distinct board cells, head first. A piece's weight is NOT repeated here. */
  readonly cells: ReadonlyArray<CellIndex>;
  /** Occupancy length — a piece's weight is its cell repeated that many times. */
  readonly weight: number;
  readonly energy: number;
  /** Invulnerability tier as it governs the ARRIVAL turn. */
  readonly tier: number;
  /**
   * The first absolute turn at which `tier` no longer governs a contest, or
   * null when the wire carries no effect schedule for this unit. EXCLUSIVE:
   * the wire's inclusive figure is converted once, in `marshalBoard`. The
   * engine lapses the schedule itself for the turn being settled; this is what
   * a reading over LATER turns has to work from.
   */
  readonly tierExpiresAtTurn: number | null;
  readonly orientation: Orientation;
  /** `turn − observedTurn`; this turn's unmade choice is NOT counted. */
  readonly staleness: number;
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
 * rules can produce — and the bound bank's soundness harness measured the cost
 * of letting one through: the additive per-enemy floor lemma fails outright on
 * such a board, which looks exactly like a soundness bug in the bank until you
 * look at the board.
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
  /**
   * The step relation the reach shells iterate, shared by every substrate over
   * the same board. Keyed `type|cell`; `evaluate/shells.ts` owns the entries
   * and asks the engine's own queries for each one. Only the kinds whose
   * legality reads no board contents are cached here — which is every kind but
   * the pawn — so an entry is as true on turn 40 as on turn 1.
   */
  readonly steps: Map<string, Uint32Array>;
  /**
   * The same relation for the kind that DOES read a facing, on the permissive
   * board — every cell a pawn target, which is what a reach past the first
   * unknown turn is asked against. Board-independent for the same reason, and
   * so shared for the same reason.
   */
  readonly orientedSteps: Map<string, ReadonlyArray<{ cell: number; ori: number }>>;
  lastUsed: number;
}

/**
 * Grid masks are a function of the BOARD, not of the turn, and a match hands
 * us a fresh board object every turn — so a per-board-object cache misses
 * every single time. Keyed by everything the geometry reads, scoped per game
 * so a finished game's entries can be dropped as a group.
 *
 * There is no arena behind this any more, so an entry is a few typed arrays
 * and a memo table; eviction is a plain LRU with nothing to orphan.
 */
const GEOMETRIES = new Map<string, Geometry>();
const GEOMETRY_CACHE_LIMIT = 24;
let geometryTick = 0;

export function geometryCacheStats(): { entries: number; scopes: number } {
  const scopes = new Set<string>();
  for (const g of GEOMETRIES.values()) scopes.add(g.key.slice(0, g.key.indexOf(' ')));
  return { entries: GEOMETRIES.size, scopes: scopes.size };
}

function geometryFor(marshalled: MarshalledBoard, scope: string): Geometry {
  const { config, fullWidth, fullHeight } = marshalled;
  const key = [
    scope,
    String(fullWidth),
    String(fullHeight),
    config.walls.join(','),
    config.hazards.join(','),
  ].join(' ');
  const hit = GEOMETRIES.get(key);
  if (hit !== undefined) {
    hit.lastUsed = ++geometryTick;
    return hit;
  }
  const grid = makeGrid(fullWidth, fullHeight);
  const geometry: Geometry = {
    key,
    grid,
    terrain: makeTerrain(grid, config.walls, config.hazards),
    steps: new Map(),
    orientedSteps: new Map(),
    lastUsed: ++geometryTick,
  };
  GEOMETRIES.set(key, geometry);
  while (GEOMETRIES.size > GEOMETRY_CACHE_LIMIT) {
    let victim: Geometry | null = null;
    for (const g of GEOMETRIES.values()) if (victim === null || g.lastUsed < victim.lastUsed) victim = g;
    if (victim === null) break;
    GEOMETRIES.delete(victim.key);
  }
  return geometry;
}

/** A game is over: its geometry has no future. */
export function releaseGeometriesFor(gameId: string): number {
  const prefix = `${gameId} `;
  let dropped = 0;
  for (const key of [...GEOMETRIES.keys()]) {
    if (!key.startsWith(prefix)) continue;
    GEOMETRIES.delete(key);
    dropped++;
  }
  return dropped;
}

/** Test hook: drop every cached geometry. Never called on the decision path. */
export function clearGeometryCache(): void {
  GEOMETRIES.clear();
}

// ---------------------------------------------------------------------------
// The substrate
// ---------------------------------------------------------------------------

export class EngineSubstrate implements Substrate {
  /** The turn the board describes. */
  readonly turn: number;
  /** The turn the staged moves resolve into — what every contest is adjudicated at. */
  readonly arrivalTurn: number;
  readonly grid: Grid;
  readonly terrain: Terrain;
  readonly marshalled: MarshalledBoard;
  readonly hazardDamage: number;
  readonly pawnPromotionWeight: number;
  readonly defaultMaxEnergy: number;

  private readonly units: ReadonlyArray<SubstrateUnit>;
  private readonly records = new Map<UnitId, ResolveUnit>();
  private readonly byUnitId = new Map<UnitId, SubstrateUnit>();
  private readonly byWireId = new Map<string, SubstrateUnit>();
  private readonly teamNumbers = new Map<string, number>();
  private readonly teamLabels = new Map<number, string>();
  private readonly regicideTeams = new Set<number>();
  private readonly narrowings: ReadonlyMap<UnitId, ReadonlyArray<number>>;
  private readonly modeledIds: ReadonlySet<UnitId>;
  private readonly geometry: Geometry;

  /**
   * THE FAMILY THIS SUBSTRATE BELONGS TO — itself, for a real substrate, and
   * the parent for every modelled sibling (`withModelled` builds siblings with
   * `Object.create`, so this own property resolves up the chain unchanged).
   *
   * It is the key for anything that is a function of the POSITION rather than
   * of which units a view holds live: the territory workspace and its shell
   * table are the first such things, and a per-sibling copy of them was both
   * a fresh set of slabs per view and a cold shell cache per view.
   */
  readonly family: EngineSubstrate;

  private shapeCache: BoardShape | null = null;
  private readonly claimCache = new Map<string, ReadonlyArray<Claim>>();
  /** Settlements this family has already run, by `planKey` — see settleFor. */
  private readonly settleCache = new Map<string, SettleEntry>();
  private readonly heldCache = new Map<string, HeldUnit[]>();
  /**
   * THE STAGED RECORD FOR ONE (unit, destination), INTERNED.
   *
   * `entryFor` spread a fresh `ResolveUnit` per unit per settlement — eight
   * objects on every one of the tens of thousands of plans a decision prices,
   * and every one of them a copy of a record that never changes with a
   * destination drawn from a set the grammar already bounds at a few dozen.
   * `resolveTurn`'s own contract is that it mutates nothing it is given
   * ("mutating nothing it was given", and `occupancy` is "Never mutated"), so
   * the same object can be handed to every settlement that stages that unit
   * there. Per family, dropped by `release()`.
   */
  private readonly stagedRecords = new Map<UnitId, Map<CellIndex, ResolveUnit>>();
  private templateCache: Omit<PartialSettleInput, 'units' | 'held'> | null = null;
  /**
   * ONE SETTLEMENT INPUT OBJECT, REWRITTEN PER CALL. The template is fifteen
   * fields wide and was re-spread on every settlement; nothing downstream
   * keeps the object — `settlePartial` copies it (`{ ...input, units: live }`)
   * before handing it to `settleTurn` and reads the rest during the call — so
   * one scratch record serves them all. It is used only by the settlement
   * doors, never by the claims door, so no call can be inside another.
   */
  private settleScratch: PartialSettleInput | null = null;
  /** The roster and the held-id list one settlement is staged into — see
   *  `entryFor`. Reused per call; nothing downstream retains either. */
  private readonly unitScratch: ResolveUnit[] = [];
  private readonly heldScratch: UnitId[] = [];
  private perilCache: ReadonlySet<string> | null = null;
  private readonly pickupTiers = new Map<UnitId, ReadonlyMap<UnitId, number>>();
  private readonly influenceCache = new Map<UnitId, ReadonlySet<CellIndex>>();
  private readonly targetCache = new Map<UnitId, ReadonlyArray<Candidate>>();
  private readonly promotable = new Map<UnitType, boolean>();
  private settleCount = 0;
  private assessCount = 0;
  private released = false;

  constructor(options: SubstrateOptions) {
    const { turn } = options;
    this.family = this;
    this.turn = turn;
    const marshalled =
      options.marshalled ??
      marshalBoard(options.board as ApiBoard, turn);
    this.marshalled = marshalled;
    this.arrivalTurn = marshalled.arrivalTurn;
    this.hazardDamage = marshalled.config.hazardDamage;
    this.pawnPromotionWeight = marshalled.pawnPromotionWeight;
    this.defaultMaxEnergy = marshalled.config.defaultMaxEnergy ?? 100;

    const geometry = geometryFor(marshalled, options.gameId ?? '');
    this.geometry = geometry;
    this.grid = geometry.grid;
    this.terrain = geometry.terrain;

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
    const identify = options.identify ?? ((_wireId: string, index: number): UnitId => index);
    const units: SubstrateUnit[] = [];
    marshalled.units.forEach((unit, index) => {
      const team = this.teamNumbers.get(unit.teamID) as number;
      const unitId = identify(unit.id, index);
      const seen = observed?.get(unit.id);
      const staleness = seen === undefined ? 0 : Math.max(0, turn - seen);
      const record: SubstrateUnit = {
        unitId,
        wireId: unit.id,
        team,
        teamId: unit.teamID,
        type: unit.type,
        isKing: unit.isKing === true,
        // A piece's weight IS its cell repeated; the distinct cells are what
        // every geometric consumer wants, and the repeat count is `weight`.
        cells: [...new Set(unit.occupancy)],
        weight: unit.occupancy.length,
        energy: unit.energy,
        tier: unit.tier,
        tierExpiresAtTurn: marshalled.tierExpiry[index] ?? null,
        orientation: unit.orientation,
        staleness,
      };
      units.push(record);
      this.byUnitId.set(unitId, record);
      this.byWireId.set(unit.id, record);
      this.records.set(unitId, unit);
      if (record.isKing) this.regicideTeams.add(team);
    });
    this.units = units;

    // The disjointness guard on the one translation door: only cells shared
    // between DIFFERENT units are impossible.
    const owner = new Map<number, string>();
    for (const unit of units) {
      for (const cell of unit.cells) {
        const held = owner.get(cell);
        if (held !== undefined && held !== unit.wireId) {
          throw new OverlappingUnitsError(cell, [held, unit.wireId]);
        }
        owner.set(cell, unit.wireId);
      }
    }

    const narrowings = new Map<UnitId, ReadonlyArray<number>>();
    for (const [wireId, cells] of options.narrowings ?? []) {
      const unit = this.byWireId.get(wireId);
      if (unit !== undefined) narrowings.set(unit.unitId, cells);
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
  }

  // --- roster ---------------------------------------------------------------

  /** Every live unit, in board order. */
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

  /** The unit a settlement's wire id names. */
  unitIdOf(wireId: string): UnitId | undefined {
    return this.byWireId.get(wireId)?.unitId;
  }

  /** The engine record for a unit — the roster entry settlement is handed. */
  recordOf(unitId: UnitId): ResolveUnit | undefined {
    return this.records.get(unitId);
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

  /** Live units on `asTeam` this decision is entitled to move. */
  commandable(asTeam: number): ReadonlyArray<UnitId> {
    return this.units.filter((u) => u.team === asTeam).map((u) => u.unitId);
  }

  /**
   * How many PLAN settlements this substrate has run — the currency the
   * search's budget is denominated in. One per priced plan.
   */
  settlements(): number {
    return this.settleCount;
  }

  /**
   * How many ONE-MOVER settlements the candidate layer has run: one per ray,
   * per unit, per decision. Counted apart from `settlements()` because they
   * are a different budget — the option set is built once and priced many
   * times, and mixing the two hides which of them a slice spent itself on.
   */
  assessments(): number {
    return this.assessCount;
  }

  /** The step relation cache the reach shells iterate. Shared per board. */
  stepCache(): Map<string, Uint32Array> {
    return this.geometry.steps;
  }

  /** The facing-sensitive step relation on the permissive board. Shared. */
  orientedStepCache(): Map<string, ReadonlyArray<{ cell: number; ori: number }>> {
    return this.geometry.orientedSteps;
  }

  // --- terrain and items ----------------------------------------------------

  isWall(cell: CellIndex): boolean {
    return bbTest(this.terrain.wall, cell);
  }

  hazardAt(cell: CellIndex): boolean {
    return bbTest(this.terrain.hazard, cell);
  }

  /** Did this cell hold food at the start of the turn? */
  foodAt(cell: CellIndex): boolean {
    return this.marshalled.config.food.includes(cell);
  }

  /** Does this cell hold an invulnerability potion? */
  potionAt(cell: CellIndex): boolean {
    return this.marshalled.potions.includes(cell);
  }

  /** Are potions live at all? Off, and a potion cell is inert scenery. */
  potionsEnabled(): boolean {
    return this.marshalled.potionsEnabled;
  }

  /** The energy ceiling for a kind — what a full tank is worth to it. */
  maxEnergyOf(type: UnitType): number {
    return this.marshalled.config.maxEnergy?.[type] ?? this.defaultMaxEnergy;
  }

  // --- the grammar, asked ---------------------------------------------------

  /** The board every query is asked against: terrain, bodies and food. */
  shape(): BoardShape {
    if (this.shapeCache !== null) return this.shapeCache;
    const config = this.marshalled.config;
    this.shapeCache = {
      boardWidth: this.marshalled.fullWidth,
      boardHeight: this.marshalled.fullHeight,
      walls: config.walls,
      hazards: config.hazards,
      occupancy: this.marshalled.units.map((u) => ({ id: u.id, cells: u.occupancy })),
      food: config.food,
    };
    return this.shapeCache;
  }

  private grammarUnitOf(unitId: UnitId): GrammarUnit {
    const record = this.records.get(unitId);
    if (record === undefined) throw new UnknownUnitError(unitId);
    return { type: record.type, occupancy: record.occupancy, orientation: record.orientation };
  }

  /** Every distinct action this unit's own grammar admits — the engine's set. */
  actionsOf(unitId: UnitId): ReadonlyArray<Candidate> {
    const hit = this.targetCache.get(unitId);
    if (hit !== undefined) return hit;
    const unit = this.grammarUnitOf(unitId);
    const from = unit.occupancy[0] as CellIndex;
    const shape = this.shape();
    const out = legalTargets(unit, shape).map((to) => ({
      unitId,
      from,
      to,
      path: (pathOfQuery(unit, to, shape) ?? []) as ReadonlyArray<CellIndex>,
    }));
    this.targetCache.set(unitId, out);
    return out;
  }

  /** The cells a staged destination enters, or null when it is not legal. */
  pathOf(unitId: UnitId, to: CellIndex): ReadonlyArray<CellIndex> | null {
    if (to === NO_ORDER_MOVE) return [];
    return pathOfQuery(this.grammarUnitOf(unitId), to, this.shape());
  }

  /** The name this repo has always used for `pathOf`. */
  pathFor(unitId: UnitId, to: CellIndex): ReadonlyArray<CellIndex> | null {
    return this.pathOf(unitId, to);
  }

  /**
   * Could this unit still become another kind? Promotion is a RULE and the
   * only kind change in the game, so it is asked of settlement rather than
   * read off a name: the probe stands the unit still at the promotion weight
   * and reads back the kind the turn closed with. Memoised per kind.
   */
  canPromote(unitId: UnitId): boolean {
    const record = this.records.get(unitId);
    if (record === undefined) throw new UnknownUnitError(unitId);
    const hit = this.promotable.get(record.type);
    if (hit !== undefined) return hit;
    const m = this.marshalled;
    const cell = record.occupancy[0] as number;
    const settled = settleTurn(
      {
        ...m.config,
        food: [],
        units: [
          {
            ...record,
            occupancy: new Array<number>(Math.max(1, m.pawnPromotionWeight)).fill(cell),
            energy: Number.MAX_SAFE_INTEGER,
            path: [],
          },
        ],
        turn: m.arrivalTurn,
        teamOf: Object.fromEntries(m.teamOf),
        effects: [],
        potions: [],
        potionsEnabled: false,
        potionWindowTurns: m.potionWindowTurns,
        pawnPromotionWeight: m.pawnPromotionWeight,
        maxTurns: m.maxTurns,
        regicideTeamIDs: [],
      },
      NO_SPAWN
    );
    const promotes = (settled.unitTypes[record.id] ?? record.type) !== record.type;
    this.promotable.set(record.type, promotes);
    return promotes;
  }

  /** Does this unit's grammar walk rays — more than one cell in a step? */
  slides(unitId: UnitId): boolean {
    return this.actionsOf(unitId).some((c) => c.path.length > 1);
  }

  /**
   * Does this unit have a RAY in this direction? Asked of the grammar: the
   * cell two steps away is reachable, through the cell one step away. A jump
   * enters no intermediate cell and so answers no, which is the whole point of
   * the question (a knight casts no shadow).
   */
  slidesToward(unitId: UnitId, dx: number, dy: number): boolean {
    const record = this.records.get(unitId);
    if (record === undefined) throw new UnknownUnitError(unitId);
    const step = dy * this.marshalled.fullWidth + dx;
    const from = record.occupancy[0] as number;
    const path = this.pathOf(unitId, from + 2 * step);
    return path !== null && path.length === 2 && path[0] === from + step;
  }

  /** The cells this unit could contest next turn — the engine's own cover. */
  coverOf(unitId: UnitId): ReadonlyArray<CellIndex> {
    return coverOf(this.grammarUnitOf(unitId), this.shape());
  }

  /**
   * INTERACTION FOOTPRINT — the cells this unit's options can influence this
   * turn: its own occupancy (vacated or dragged) plus every cell any legal
   * action of its own grammar enters.
   *
   * OVER-APPROXIMATION, AND ITS DIRECTION. This is the union over the whole
   * option set, not the footprint of one chosen move. A footprint that is too
   * big makes a cache transfer fail to apply (work repeated, never a wrong
   * answer); one too small would silently keep an invalidated evaluation.
   */
  influenceOf(unitId: UnitId): ReadonlySet<CellIndex> {
    const cached = this.influenceCache.get(unitId);
    if (cached !== undefined) return cached;
    const unit = this.byUnitId.get(unitId);
    if (unit === undefined) throw new UnknownUnitError(unitId);
    const cells = new Set<CellIndex>(unit.cells);
    for (const candidate of this.actionsOf(unitId)) for (const cell of candidate.path) cells.add(cell);
    const frozen: ReadonlySet<CellIndex> = cells;
    this.influenceCache.set(unitId, frozen);
    return frozen;
  }

  // --- claims ---------------------------------------------------------------

  /**
   * The claims for the MODELLED set: every unmodelled unit held at its own
   * observation turn. Hoisted, because a claim is a pure function of the held
   * records and the board and a decision prices thousands of plans against
   * one held set.
   */
  claimsOf(): ReadonlyArray<Claim> {
    return this.claimsFor(this.heldOutside(this.modeledIds));
  }

  /**
   * The held units that could be gone by the end of this turn WITHOUT US —
   * on terrain, on their own energy, or at each other's hands.
   *
   * `Claim.deathPossible` folds three sources together: what the unit could do
   * to itself, what another unknown could do to it, and what the units we
   * COMMAND could do to it. The third is a function of our whole option set
   * rather than of any one plan — claims are hoisted, which is what makes them
   * affordable — so read on its own it says "this enemy might die" about every
   * enemy any of our units could conceivably reach, in every plan alike. That
   * is sound and it is useless: a plan that TAKES a piece then scores exactly
   * like one that ignores it, and the search loses its reason to capture.
   *
   * So the third source is separated from the other two here, by asking the
   * same question of a board WE ARE NOT ON: the claims of the held roster
   * alone. What comes back is peril the plan cannot change. What the plan CAN
   * change is read per settlement, off the movers' own traversal
   * (`material.ts`), and the two are unioned there.
   *
   * Over-approximate in the safe direction: with our units off the board the
   * remaining ones have MORE room, so a peril this reports is at worst a
   * peril that is not quite there, and a claim's survival stays bracketed.
   */
  perilOf(): ReadonlySet<string> {
    if (this.perilCache !== null) return this.perilCache;
    const held = this.heldOutside(this.modeledIds);
    const ids = new Set(held.map((id) => this.byUnitId.get(id)?.wireId));
    const units = this.marshalled.units.filter((u) => ids.has(u.id));
    const out = new Set<string>();
    if (units.length > 0) {
      const claims = computeClaims({
        ...this.inputTemplate(),
        units,
        held: this.heldUnitsFor(held),
      });
      for (const claim of claims) if (claim.deathPossible) out.add(claim.id);
    }
    this.perilCache = out;
    return out;
  }

  claimOf(unitId: UnitId): Claim | undefined {
    const wireId = this.byUnitId.get(unitId)?.wireId;
    return this.claimsOf().find((c) => c.id === wireId);
  }

  /** The unit a claim belongs to. */
  unitOfClaim(claim: Claim): SubstrateUnit | undefined {
    return this.byWireId.get(claim.id);
  }

  private heldOutside(modeled: ReadonlySet<UnitId>): ReadonlyArray<UnitId> {
    const out: UnitId[] = [];
    for (const unit of this.units) if (!modeled.has(unit.unitId)) out.push(unit.unitId);
    return out;
  }

  /** The held roster for a set, interned: a decision holds the same set of
   *  units for every plan it prices. */
  private heldUnitsFor(held: ReadonlyArray<UnitId>, heldKey?: string): HeldUnit[] {
    const key = heldKey ?? keyOf(held);
    const hit = this.heldCache.get(key);
    if (hit !== undefined) return hit;
    const out: HeldUnit[] = [];
    for (const unitId of held) {
      const unit = this.byUnitId.get(unitId);
      if (unit === undefined) continue;
      const options = this.narrowings.get(unitId);
      out.push({
        id: unit.wireId,
        // RULE 4, and the whole of it: the record is stamped with the turn the
        // unit was OBSERVED, and the engine dilates from there to the turn it
        // is settling. Adding this turn's unmade choice here doubles it.
        observedTurn: this.turn - unit.staleness,
        ...(options === undefined ? {} : { options }),
      });
    }
    this.heldCache.set(key, out);
    return out;
  }

  private claimsFor(held: ReadonlyArray<UnitId>, heldKey?: string): ReadonlyArray<Claim> {
    if (held.length === 0) return [];
    const key = heldKey ?? keyOf(held);
    const hit = this.claimCache.get(key);
    if (hit !== undefined) return hit;
    const input = this.settleInputFor(this.marshalled.units, this.heldUnitsFor(held));
    const made = computeClaims(input);
    this.claimCache.set(key, made);
    return made;
  }

  // --- settlement -----------------------------------------------------------

  /**
   * The settlement input, minus the two fields that change per call.
   *
   * Built ONCE. A decision settles tens of thousands of plans against one
   * board, and every field but `units` and `held` is the same in all of them —
   * rebuilding the team map and re-spreading the config per settlement is a
   * whole object allocation on the hottest path in the system.
   */
  private inputTemplate(): Omit<PartialSettleInput, 'units' | 'held'> {
    if (this.templateCache !== null) return this.templateCache;
    this.templateCache = settleInputBase(this.marshalled);
    return this.templateCache;
  }

  private settleInputFor(units: ReadonlyArray<ResolveUnit>, held: HeldUnit[]): PartialSettleInput {
    return { ...this.inputTemplate(), units: units as ResolveUnit[], held };
  }

  /** The scratch settlement input, re-pointed at this call's roster and hold. */
  private settleScratchFor(units: ReadonlyArray<ResolveUnit>, held: HeldUnit[]): PartialSettleInput {
    let scratch = this.settleScratch;
    if (scratch === null) {
      scratch = this.settleInputFor(units, held);
      this.settleScratch = scratch;
      return scratch;
    }
    const writable = scratch as unknown as { units: ResolveUnit[]; held: ReadonlyArray<HeldUnit> };
    writable.units = units as ResolveUnit[];
    writable.held = held;
    return scratch;
  }

  /**
   * This unit's record with `to` staged — interned, see `stagedRecords`.
   *
   * STAGE THE ACTION AND NOTHING ELSE. `resolveTurn` re-reads a staged cell
   * through the movement grammar, and one rule in the grammar reads occupancy
   * rather than the mover: a pawn's diagonal step is legal only onto a cell
   * holding food or a body as the turn opens (`queries.ts::pawnTargetsOf`).
   * `settlePartial` used to hand that re-reading a board with every held unit
   * REMOVED, which could turn a staged capture into an illegal action and
   * silently substitute the kind's default (a piece HOLDS) with nothing
   * ledgered — the bug `f4b4a81` worked around by staging the walked path
   * directly, bypassing the grammar's re-read.
   *
   * The engine now reads staging legality against `presence`: held units at
   * their OBSERVED cells, visible to the grammar and invisible to the
   * collision phase (`ResolveTurnInput.presence`, set by `settlePartial`
   * itself off `input.held`). A capture onto a held body is legal again, and
   * where a held unit's presence there is actually in doubt — observed on an
   * earlier board it may since have left — the engine ledgers that itself as
   * a `grammar` divergence (`settlePartial.ts::grammarDivergences`), keyed to
   * the claim whose whereabouts decide it. `stagedMove` alone is what the
   * plan named; the path workaround is gone.
   */
  private stagedRecordFor(unitId: UnitId, record: ResolveUnit, to: CellIndex): ResolveUnit {
    let byTo = this.stagedRecords.get(unitId);
    if (byTo === undefined) {
      byTo = new Map<CellIndex, ResolveUnit>();
      this.stagedRecords.set(unitId, byTo);
    }
    const hit = byTo.get(to);
    if (hit !== undefined) return hit;
    const made =
      to === NO_ORDER_MOVE ? { ...record, stagedMove: undefined } : { ...record, stagedMove: to };
    byTo.set(to, made);
    return made;
  }

  /**
   * Settle one turn with `plan` modelled and everything else held.
   *
   * The plan's domain IS the modelled set, so the engine never sees a partial
   * assignment: a unit the plan names carries its staged cell (or the kind's
   * own default, for `NO_ORDER_MOVE`), and a unit it omits is handed to
   * `settlePartial` as a `HeldUnit` with its own observation turn.
   */
  settleFor(plan: JointPlan): PartialSettlement {
    if (this.released) throw new Error('substrate: settle after release()');
    // RULE 5's SECOND HALF: a settlement is a function of the PLAN, and of
    // nothing a VIEW does.
    //
    // `settleFor` derives its held set from the plan's complement and reads
    // nothing else that a modelled sibling overrides — `units`, `records`,
    // `narrowings`, `marshalled` and the held/claim caches all live on the
    // family and a sibling only re-points `modeledIds`, `claimsOf`, `modeled`
    // and `release`. So the same plan under two hold configurations is the
    // same settlement, and the bank prices exactly that: it resolves a plan at
    // B0 and again under each enemy it enumerates, and the resolution memo
    // namespaces its entries PER VIEW, so it cannot see the repeat. Measured
    // on `mixed 20 1 --nodes`: 73 649 settlements, of which 27 707 (37.6%)
    // repeat a plan the family had already settled.
    //
    // The cache is on the family (siblings share it through the prototype),
    // keyed by the same path-sensitive `planKey` every memo above uses, and
    // bounded and evicted oldest-first exactly like the resolution memo — a
    // settlement is not small and a decision prices tens of thousands of
    // plans. It is per DECISION, dropped by `release()`, never module scope.
    return this.entryFor(plan).settlement;
  }

  /** The cache slot for one plan: its settlement, and the folds off it. */
  private entryFor(plan: JointPlan): SettleEntry {
    // The refusal lives HERE and not only on `settleFor`, because every door
    // that settles — `settleFor`, `resolveBoundedFor`, `withResolution` —
    // comes through this one, and a released substrate must refuse at all of
    // them (soak: "release drops the decision caches and closes the door").
    if (this.released) throw new Error('substrate: settle after release()');
    const key = planKey(plan);
    const cached = this.settleCache.get(key);
    // A hit is proof the plan named only known units: the key names every
    // unit id in the plan, so an unknown one could never have filled an entry.
    if (cached !== undefined) return cached;
    const roster = this.units;
    const records = this.records;
    // TWO POOLED ARRAYS, for the same reason `settleScratch` is one: neither
    // outlives the call. `settlePartial` copies the roster it is handed
    // (`input.units.filter`, `new Map(input.units.map(...))`) and reads the
    // held ids only while it runs, and `heldUnitsFor`/`claimsFor` key on the
    // string and store their own arrays — so nothing downstream keeps either.
    // Per family, dropped by `release()`.
    const held = this.heldScratch;
    held.length = 0;
    let named = 0;
    const units = this.unitScratch;
    units.length = roster.length;
    for (let i = 0; i < roster.length; i++) {
      const unitId = (roster[i] as SubstrateUnit).unitId;
      const record = records.get(unitId) as ResolveUnit;
      const candidate = plan.get(unitId);
      if (candidate === undefined) {
        held.push(unitId);
        units[i] = record;
        continue;
      }
      named++;
      units[i] = this.stagedRecordFor(unitId, record, candidate.to);
    }
    // The unknown-unit refusal, unchanged in effect: every unit the plan names
    // is on the roster exactly when the plan named as many units as the walk
    // above matched. Only the losing case pays for the search.
    if (named !== plan.size) {
      for (const unitId of plan.keys()) {
        if (!this.byUnitId.has(unitId)) throw new UnknownUnitError(unitId);
      }
    }
    // One held-set key, not two: `heldUnitsFor` and `claimsFor` are both keyed
    // on it and both used to compute it themselves.
    const heldKey = keyOf(held);
    this.settleCount++;
    // The claims come FIRST: `claimsFor` builds its own settlement input, and
    // the scratch below may not be live while it does.
    const claims = this.claimsFor(held, heldKey);
    const settled = settlePartial(
      this.settleScratchFor(units, this.heldUnitsFor(held, heldKey)),
      NO_SPAWN,
      claims
    );
    const entry: SettleEntry = { settlement: settled, bounded: null };
    this.settleCache.set(key, entry);
    while (this.settleCache.size > SETTLE_CACHE_CAPACITY) {
      const oldest = this.settleCache.keys().next();
      if (oldest.done) break;
      this.settleCache.delete(oldest.value);
    }
    return entry;
  }

  /**
   * The same settlement, with the material fold the contract carries: the
   * per-team intervals and the subject-frame bounds. One settlement, one fold
   * — recomputing either above this file would be a second scoring pipeline.
   */
  resolveBoundedFor(plan: JointPlan, asTeam: number): BoundedResolve {
    const entry = this.entryFor(plan);
    const settlement = entry.settlement;
    // THE FOLD, ONCE PER (settlement, frame, peril).
    //
    // `materialOf` reads the settlement, the frame, the family's roster — and
    // `perilOf()`, which is the ONE thing a modelled sibling can answer
    // differently from its parent. `ledgerOf` reads the settlement and the
    // family's wire-id index. So the whole bounded resolve is determined by
    // those three, and the peril SET's own identity is the exact witness for
    // the third: `perilOf` memoises, so two views that agree return the same
    // object and two that might not return different ones — a conservative
    // miss, never a wrong reuse. Keyed off the settlement, which is per
    // family, so no two decisions can meet in here.
    const peril = this.perilOf();
    let byTeam = entry.bounded;
    if (byTeam === null) {
      byTeam = new Map();
      entry.bounded = byTeam;
    }
    const hit = byTeam.get(asTeam);
    if (hit !== undefined && hit.peril === peril) return hit.value;
    const { perTeam, bounds } = materialOf(this, settlement, asTeam);
    const value: BoundedResolve = {
      resolution: settlement,
      perTeam,
      bounds,
      ledger: ledgerOf(this, settlement),
    };
    byTeam.set(asTeam, { peril, value });
    return value;
  }

  /** Scoped settlement: resolve, hand it to `fn`, return what `fn` returns. */
  withResolution<T>(plan: JointPlan, asTeam: number, fn: (r: BoundedResolve) => T): T {
    return fn(this.resolveBoundedFor(plan, asTeam));
  }

  /**
   * A ONE-MOVER settlement: this unit walks `path` and every other unit on the
   * board is held. The `pathrisk` fold reads it, and it is the only place a
   * caller may hand settlement a path rather than a staged cell — the path is
   * the ray being assessed, prefix by prefix, and asking for its staged cell
   * back would round it to a legal destination.
   */
  settleMover(unitId: UnitId, path: ReadonlyArray<CellIndex>): PartialSettlement {
    if (this.released) throw new Error('substrate: settle after release()');
    if (!this.byUnitId.has(unitId)) throw new UnknownUnitError(unitId);
    const held: UnitId[] = [];
    const units = this.units.map((unit) => {
      const record = this.records.get(unit.unitId) as ResolveUnit;
      if (unit.unitId === unitId) return { ...record, path: [...path] };
      held.push(unit.unitId);
      return record;
    });
    this.assessCount++;
    return settlePartial(
      this.settleInputFor(units, this.heldUnitsFor(held)),
      NO_SPAWN,
      this.claimsFor(held)
    );
  }

  /** What one staged ray costs and risks — the `pathrisk` fold. */
  assess(unitId: UnitId, path: ReadonlyArray<CellIndex>): TraversalVerdict {
    const unit = this.byUnitId.get(unitId);
    if (unit === undefined) throw new UnknownUnitError(unitId);
    return assessPath(this, unit, path);
  }

  /**
   * THE TIERS A PICKUP BY `unitId` LEAVES BEHIND — asked of the rules, not
   * asserted here.
   *
   * The pickup is inverted and it has TWO halves: the collector takes a level
   * off and every one of its LIVING allies takes one on, both lapsing one
   * window later. So the question goes to `settleTurn`, which is where both
   * halves are written, and what comes back is the tier vector the turn AFTER
   * the pickup opens at — expiry included.
   *
   * THE PROBE IS A HELD BOARD. Every unit stands where it stands with an empty
   * path and an energy no turn can spend, and the one potion offered is the
   * collector's own head cell. Nothing moves, so nothing contests, so nothing
   * dies. Memoised per unit.
   */
  tiersAfterPickupBy(unitId: UnitId): ReadonlyMap<UnitId, number> {
    const hit = this.pickupTiers.get(unitId);
    if (hit !== undefined) return hit;
    const collector = this.byUnitId.get(unitId);
    if (collector === undefined) throw new UnknownUnitError(unitId);

    const m = this.marshalled;
    const settled = settleTurn(
      {
        ...m.config,
        units: m.units.map((u) => ({ ...u, path: [], energy: Number.MAX_SAFE_INTEGER })),
        turn: m.arrivalTurn,
        teamOf: Object.fromEntries(m.teamOf),
        effects: m.effects,
        potions: [collector.cells[0] as number],
        potionsEnabled: m.potionsEnabled,
        potionWindowTurns: m.potionWindowTurns,
        pawnPromotionWeight: m.pawnPromotionWeight,
        maxTurns: m.maxTurns,
      },
      NO_SPAWN
    );

    const out = new Map<UnitId, number>();
    for (const [wireId, tier] of Object.entries(settled.tiers)) {
      const unit = this.byWireId.get(wireId);
      if (unit !== undefined) out.set(unit.unitId, tier);
    }
    this.pickupTiers.set(unitId, out);
    return out;
  }

  /**
   * Which held units' claims touch these cells in sub-step time.
   *
   * Each probe carries the occupancy WINDOW `[fromSubStep, toSubStep]`: a cell
   * merely passed through has both ends at its own path index, and a cell come
   * to rest on takes `toSubStep: Number.MAX_SAFE_INTEGER`, because a rested
   * unit stands there for the rest of the turn and meets everything. Body
   * material is not gated in time — it is already standing there when the turn
   * opens; a head arrival is, through the claim's own `earliestSubStep`.
   *
   * Everything ABSENT from the answer is proved irrelevant to those cells, so
   * its bound is tight rather than merely sound.
   *
   * THE `NEVER` SENTINEL IS NOT A SUB-STEP. `Claim.earliestSubStep` is a DENSE
   * `Int32Array` over every cell of the board, and a cell no world's head ever
   * reaches carries `NEVER = 0x7fffffff` rather than being absent. The
   * arithmetic test alone therefore admits it: `NEVER <= Number.MAX_SAFE_INTEGER`
   * is true, so a rest cell — every plan has one per unit — matched EVERY claim
   * on the board and the gate degenerated to "every uncontrolled unit". Measured
   * on `snakes`: 99.6% of admissions were the sentinel and nothing else, the gate
   * equalled the held set on 100% of prices, and B3 then swept a 4^4 product on
   * every plan the search touched. Excluding the sentinel removes only units the
   * claim itself proves cannot reach the cell in ANY world, so the answer stays a
   * superset of the truth.
   */
  entangled(
    cells: ReadonlyArray<{ cell: CellIndex; fromSubStep: SubStep; toSubStep: SubStep }>
  ): ReadonlyArray<UnitId> {
    const out = new Set<UnitId>();
    for (const claim of this.claimsOf()) {
      const unit = this.byWireId.get(claim.id);
      if (unit === undefined) continue;
      const bodies = claim.bodyPossible[claim.bodyPossible.length - 1] ?? [];
      for (const probe of cells) {
        if (bodies.includes(probe.cell)) {
          out.add(unit.unitId);
          break;
        }
        const earliest = claim.earliestSubStep[probe.cell];
        if (earliest !== undefined && earliest < NEVER && earliest <= probe.toSubStep) {
          out.add(unit.unitId);
          break;
        }
      }
    }
    return [...out].sort((a, b) => a - b);
  }

  /**
   * A sibling substrate over the SAME position in which every unit in
   * `modelled` is expected LIVE.
   *
   * It is a plain object sharing this one's caches. It needs no guard: claims
   * are derived per call from the plan's complement (and, for the claim view,
   * from the sibling's OWN modelled set), so a narrower sibling is simply
   * correct rather than answering its parent's question. The `SharedClaimView`
   * refusal the arena version carried existed because the claim field was
   * cached on the parent from the parent's modelled set; there is no such
   * field any more.
   */
  withModelled(modelled: ReadonlyArray<UnitId>): Substrate {
    const parent = this;
    const requested = new Set<UnitId>(modelled);
    const sibling: EngineSubstrate = Object.create(parent) as EngineSubstrate;
    // Writable and configurable, every one of them: a sibling may be wrapped
    // again — the bank's resolution memo is a Proxy — and a proxy over an
    // object with a non-configurable own property may not report anything but
    // that property's own value.
    const own = (value: unknown): PropertyDescriptor => ({
      value,
      writable: true,
      configurable: true,
    });
    Object.defineProperties(sibling, {
      modeledIds: own(requested),
      // Releasing a sibling must never disturb the parent.
      release: own(() => undefined),
      modeled: own(() => requested),
      withModelled: own((m: ReadonlyArray<UnitId>) => parent.withModelled([...requested, ...m])),
      claimsOf: own(() => parent.claimsFor(parent.heldOutside(requested))),
    });
    return sibling as unknown as Substrate;
  }

  /** Drop this substrate's per-decision caches. The geometry outlives it. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.settleCache.clear();
    this.claimCache.clear();
    this.heldCache.clear();
    this.stagedRecords.clear();
    this.settleScratch = null;
    this.unitScratch.length = 0;
    this.heldScratch.length = 0;
    this.perilCache = null;
    this.influenceCache.clear();
    this.targetCache.clear();
    this.pickupTiers.clear();
  }
}

/**
 * The settlement cache's ceiling — the resolution memo's own capacity, and
 * for the same reason: a settlement is not small and a decision at 26 units
 * prices tens of thousands of plans.
 */
const SETTLE_CACHE_CAPACITY = 4096;

/**
 * ONE CACHE SLOT PER PLAN: the settlement, and the material folds taken off it
 * per frame. Both live on the family's `settleCache`, so a resolve is one
 * string key and one `Map` probe rather than a probe per layer.
 */
interface SettleEntry {
  readonly settlement: PartialSettlement;
  bounded: Map<number, { peril: ReadonlySet<string>; value: BoundedResolve }> | null;
}

/**
 * A held set's identity: sorted ids, which is what every cache here keys on.
 *
 * The copy and the sort are skipped when the ids ALREADY ascend, which is the
 * only case `entryFor` produces — it walks the roster in order and the roster
 * is built in ascending unit id — so the common path is a `join` over the
 * array it was handed. The general path is unchanged for any other caller, and
 * the STRING is identical either way.
 */
const keyOf = (ids: ReadonlyArray<UnitId>): string => {
  if (ids.length === 0) return '';
  for (let i = 1; i < ids.length; i++) {
    if ((ids[i] as number) < (ids[i - 1] as number)) {
      return [...ids].sort((a, b) => a - b).join(',');
    }
  }
  return ids.join(',');
};

/** The one construction door. */
export function makeSubstrate(options: SubstrateOptions): EngineSubstrate {
  return new EngineSubstrate(options);
}
