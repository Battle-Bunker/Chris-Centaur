/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/engine.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// The partial-evolution engine: live units in arena storage, frozen units as
// clouds, and a turn resolver that never guesses what a frozen unit did.
// DESIGN.md §3.6 and §4.
//
// WHAT A RESOLUTION RETURNS. Not "what happens" — one well-defined timeline
// (the OPTIMISTIC one: a cell a frozen unit MIGHT hold is treated as empty, and
// so is a cell the neck argument makes certain while its owner might still be
// dead — `certain` is CERTAIN-CONDITIONAL-ON-ALIVE, and a claim only occupies a
// cell in this timeline when nothing could have killed its owner) plus a
// complete LEDGER of every point at which that timeline could differ from the
// truth. An empty ledger is a proof of
// correctness for every possible behaviour of the frozen units (DESIGN.md §4.3,
// T2). A non-empty one tells the searcher exactly which unit to go back and
// simulate, and from which turn.
//
// ALLOCATION. Nothing on the fork or resolve path allocates a typed array larger
// than 64 bytes, because V8 stores larger ones in external backing stores and the
// amortized cost of that in a hot loop is ~100x (DESIGN.md §1.2). Live state
// lives in a growable arena and is forked with `copyWithin`; board-sized scratch
// is allocated once per engine and reused with generation stamping instead of
// being cleared.

import type { Board, Grid } from "./bitgrid.js";
import { bbIntersects, bbSet, bbTest, bbZero } from "./bitgrid.js";
import type { CloudPremise, FrozenRecord, StrengthBounds } from "./cloud.js";
import { CloudSource, DEFAULT_TIMELINE_CACHE, maxHealthFor } from "./cloud.js";
import type { CloudField, SlotMask } from "./field.js";
import { emptyField } from "./field.js";
import type { Terrain, UnitKind } from "./grammar.js";
import {
  ACTION_ILLEGAL,
  ACTION_ROTATE,
  defaultPath,
  pawnTargetsInto,
  planAction,
  planActionInto,
  profileOf,
} from "./grammar.js";

// ---------------------------------------------------------------------------
// Slab layout
// ---------------------------------------------------------------------------

const U_KIND = 0;
const U_TEAM = 1;
const U_TIER = 2;
const U_WEIGHT = 3;
const U_HEALTH = 4;
const U_ORIENT = 5;
const U_STATUS = 6;
const U_LEN = 7;
const U_ID = 8;
/** Turn at which the unit's tier effect expires (0x7fff = never/none). */
const U_TIEREXP = 9;
const U_FIELDS = 10;

/** Slot lifecycle in the slab. Within-turn statuses live in scratch, not here. */
export const Standing = { Empty: 0, Alive: 1, Gone: 2 } as const;
export type Standing = (typeof Standing)[keyof typeof Standing];

/** Within-turn status, per the rules' `active | stopped | exhausted | dead`. */
const S_ACTIVE = 0;
const S_STOPPED = 1;
const S_EXHAUSTED = 2;
const S_DEAD = 3;

export interface EngineConfig {
  /** Maximum LIVE units in one state. */
  readonly maxUnits: number;
  /** Maximum trail length (a piece is a trail of length 1). */
  readonly maxTrail: number;
  readonly hazardDamage: number;
  readonly maxHealth: number;
  /**
   * PER-KIND maximum health, indexed by `UnitKind` — the wire's
   * `maxHealthPerUnit`, which the game configures and the vendored resolver
   * reads as `input.maxHealth[type]`. `null`, or `undefined` at an index,
   * means `maxHealth`, so a flat configuration behaves exactly as before.
   *
   * Two things read it, and they are the two the game reads its own table
   * for: the food phase (a meal restores to the EATER'S kind's maximum) and
   * the claim's refuel budget (the arrival/cost grid's second relaxation, and
   * the ray cap of a unit that might have eaten). A consumer that flattens the
   * table to its maximum keeps sound ceilings and loses sound floors — its own
   * low-maximum units are then credited with a reach they do not have.
   */
  readonly maxHealthPerKind: ReadonlyArray<number> | null;
  /** Weight at which a promoting kind promotes (docs/chess-pieces.md; default 10). */
  readonly pawnPromotionWeight: number;
  /**
   * How many cloud sources (one per distinct item premise) the engine keeps.
   * A premise is derived from the state's own food/potion boards, so a game
   * that eats produces a fresh one every few turns and an unbounded map of
   * them is a leak in the NORMAL case. LRU: an eviction costs a re-dilation
   * and never a wrong answer.
   */
  readonly sourceCacheSize: number;
  /** Timelines each cloud source keeps by value; see `CloudSourceOptions`. */
  readonly timelineCacheSize: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  maxUnits: 16,
  maxTrail: 24,
  hazardDamage: 15,
  maxHealth: 100,
  maxHealthPerKind: null,
  pawnPromotionWeight: 10,
  sourceCacheSize: 8,
  timelineCacheSize: DEFAULT_TIMELINE_CACHE,
};

/** A search node. Immutable by convention; the engine mutates only through it. */
export interface StateHandle {
  /** Index into the engine's arena. */
  readonly slab: number;
  /** The frozen units' claims — shared by pointer with every sibling. */
  readonly field: CloudField;
  readonly turn: number;
  /**
   * Frozen units whose `certain` claim this BRANCH no longer trusts, because a
   * live unit contested it here. Shrinking certainty is always sound, and one
   * word of node-local state buys it. Slot numbers are stable across
   * freeze/unfreeze so this word never silently re-points. DESIGN.md §3.2.
   */
  readonly softFrozen: SlotMask;
}

/**
 * A prepared hold configuration: the interned cloud field for one set of
 * units held at one turn over one item premise. Build once with
 * `makeHoldSet`, apply to any sibling with `applyHoldSet`.
 */
export interface HoldSet {
  readonly field: CloudField;
  readonly turn: number;
  readonly premiseKey: string;
  readonly unitIds: ReadonlyArray<number>;
}

// ---------------------------------------------------------------------------
// Entanglement
// ---------------------------------------------------------------------------

export const Channel = {
  /** A live unit ended a sub-step where a frozen one might stand. */
  Contest: 0,
  /** A live unit entered a cell a frozen TRAIL might hold (not its arriving front). */
  BodyBlock: 1,
  /** A live unit crossed an edge a frozen unit might cross the other way. */
  Edge: 2,
  /** A slider's ray crossed the cell mid-path rather than ending on it. */
  Transit: 3,
  /** A live unit arrived where a frozen one might have DIED — a persistent pile. */
  Durable: 4,
  /** A live unit ate where a frozen one might have eaten first. */
  Item: 5,
  /** A contest was decided against a strength interval that straddles it. */
  Strength: 6,
} as const;
export type Channel = (typeof Channel)[keyof typeof Channel];

export const CHANNEL_NAMES = [
  "contest",
  "bodyBlock",
  "edge",
  "transit",
  "durable",
  "item",
  "strength",
] as const;

export interface Entanglement {
  readonly turn: number;
  readonly subStep: number;
  readonly cell: number;
  /** The live unit whose action touched the unknown. */
  readonly liveId: number;
  /** Which frozen units are implicated, as a slot mask. */
  readonly frozen: SlotMask;
  readonly channel: Channel;
  /**
   * How strong the claim on this cell is — a grading of the CLAIM, not of what
   * the timeline did with it.
   *
   * `false` — a mere maybe: the frozen unit has to have MOVED here for this to
   * bite.
   * `true` — the neck argument makes the cell certain, so the frozen unit is
   * here in every world where it is still alive; only its death makes that
   * wrong, which is much rarer. The optimistic timeline still steps around it
   * while that death is possible (certain-conditional-on-alive), so this flag
   * tells a consumer how likely the entry is to matter, not who won the cell.
   */
  readonly assumedPresent: boolean;
  /** Whether the frozen unit's strength interval permits it to beat this one. */
  readonly couldBeat: boolean;
}

export const Fate = {
  /** Alive, and no unknown could have changed that. */
  Alive: 0,
  /** Dead in the optimistic timeline, so dead however the unknowns fall. */
  Dead: 1,
  /** Alive optimistically; some recorded unknown could have killed it. */
  Contingent: 2,
} as const;
export type Fate = (typeof Fate)[keyof typeof Fate];

export interface UnitFate {
  readonly unitId: number;
  readonly fate: Fate;
}

/**
 * The rules' own event vocabulary, verbatim from the wire type
 * (`shared/types/Game.ts` `ClashKind`). Kept as the same strings so a consumer
 * can hand a Resolution's clashes to a renderer that was written against the
 * server's turn payload without a translation table.
 *
 * "regicide" is deliberately absent: it is a GAME-level rule applied after the
 * turn engine (a team losing its last king), not something a resolution of one
 * board can decide.
 */
export type ClashKind =
  | "contest"
  | "edge"
  | "bodyBlock"
  | "sever"
  | "hazard"
  | "exhaustion"
  | "wall"
  | "self";

/**
 * One adjudicated event at one cell — the vendor `Clash` record, with unit IDs
 * as the engine's numeric ids instead of the wire's strings. A single collision
 * spanning two cells (an edge-contest tie) emits one record per cell; a
 * non-fatal record (a sever, or an exhaustion halt that food may yet undo)
 * carries an empty `victimIDs`.
 */
export interface Clash {
  /** The cell. Named `index` to match the wire record field-for-field. */
  readonly index: number;
  readonly subStep: number;
  readonly kind: ClashKind;
  /** Every unit named by this record, survivors included. Ascending. */
  readonly playerIDs: ReadonlyArray<number>;
  /** The subset of `playerIDs` that died (or starved) here. Ascending. */
  readonly victimIDs: ReadonlyArray<number>;
  /** The unique unit left standing at this cell, when there is one. */
  readonly survivorID?: number;
  /** Display text only — never load-bearing. */
  readonly reason: string;
}

/** Where, when and how a unit was removed this turn. */
export interface DeathRecord {
  readonly unitId: number;
  readonly cell: number;
  readonly subStep: number;
  readonly cause: ClashKind;
}

export interface Resolution {
  readonly state: StateHandle;
  readonly ledger: ReadonlyArray<Entanglement>;
  readonly fates: ReadonlyArray<UnitFate>;
  /** The turn that was resolved. */
  readonly turn: number;
  /** Sub-steps the turn actually needed. */
  readonly subSteps: number;
  /**
   * Typed collision events, in the vendor's deterministic order
   * (sub-step, cell, kind, participants). Empty on a quiet turn.
   */
  readonly clashes: ReadonlyArray<Clash>;
  /**
   * Every unit removed this turn — collision deaths and settled exhaustions
   * alike — ordered by (sub-step, unit id). This is the authoritative registry;
   * `fates` says only whether a unit lived.
   */
  readonly deaths: ReadonlyArray<DeathRecord>;
  /**
   * Cells actually cut from each SURVIVING trail unit by a sever, deduplicated
   * and in trail order — the wire's `Turn.severedCells`, keyed by unit id.
   * A unit that was severed and then died does not appear: its whole body left
   * the board, so there is no partial loss to price.
   */
  readonly severedCells: ReadonlyMap<number, ReadonlyArray<number>>;
  /**
   * THE OTHER TWO HALVES OF `deathPossible` — frozen slots this turn's
   * MODELLED FOOTPRINT reached, plus frozen slots ANOTHER FROZEN CLAIM could
   * have killed. Either way: no consumer may price them certainly-alive.
   *
   * A `Cloud` is deliberately a pure function of (record, terrain, item set,
   * turns held, narrowing) and of nothing a sibling branch does — that purity
   * is what lets one timeline be shared by pointer across a whole search tree.
   * So `cloud.deathPossible` can only ever answer from the claim's own side of
   * the board: exhaustion, a hazard, a wall it was free to enter, its own body.
   * It cannot know that a unit somebody IS modelling walked through the cell
   * the held unit might be standing on, and it cannot know that ANOTHER CLAIM
   * could have taken it — the overlap is a property of the field, which the
   * cloud does not belong to.
   *
   * That gap is harmless in a FLOOR (which prices an enemy alive anyway) and a
   * FALSE PROOF in a CEILING: the subject's best world is the one where the
   * enemy dies, and a held unit reported certainly-alive forbids exactly that
   * world. A real resolution then scores ABOVE the "upper" bound. Where the two
   * claims are MUTUALLY fatal the false proof is worse than a loose bound: a
   * tie kills both, so the world in which a whole held side is gone is a real
   * one, and naming only one of the pair leaves that WIN outside a ceiling
   * that reads finite — which a searcher's `hi[m] <= lo[best]` then retires
   * for good.
   *
   * This mask is where both facts are published, on the object that has them
   * both to hand: the resolution knows its own footprint, and its field
   * computed the claim-versus-claim half once for every state that shares it
   * (`CloudField.contestedClaims`). Read it as
   *
   *     survival = cloud.certainlyGone ? "no"
   *              : cloud.deathPossible || (mayHaveDied & (1 << slot)) ? "maybe"
   *              : "yes"
   *
   * which is what `resolveBounded` does. Both halves are deliberately TARGETED
   * rather than blanket: the footprint half names only slots whose `possible`
   * intersects `touched`, and the claim half only slots another claim could
   * actually reach AND beat — a held unit nobody came near, or one that
   * strictly outranks every neighbour it can meet, keeps its tight ceiling.
   * Bit `slot`, not array index. Always 0 when nothing is frozen.
   */
  readonly mayHaveDied: SlotMask;
}

/** Display strings, verbatim from the vendored resolver's `REASON`. */
export const REASON = {
  tier: "Outranked: lower invulnerability tier",
  weight: "Outweighed",
  tie: "Deadlock: no unique survivor",
  bodyBlock: "Ran into a body",
  sever: "Body severed by a higher tier",
  wall: "Hit the wall",
  self: "Ran into its own body",
  hazard: "Drained by a hazard",
  exhaustion: "Ran out of health",
} as const;

/**
 * `resolve` was asked to run in STRICT mode and a live unit had no entry in
 * `orders`. A default is a NARROWING, so it must be named: silently applying
 * one is the single-world bias the partial-time design exists to remove.
 */
export class UnnamedUnitError extends Error {
  readonly code = "unnamed_unit" as const;
  constructor(
    readonly unitId: number,
    readonly slot: number,
  ) {
    super(
      `resolve(strict): live unit ${unitId} (slot ${slot}) has no entry in orders — pass NO_ORDER explicitly for the kind's own default`,
    );
    this.name = "UnnamedUnitError";
  }
}

/** Options for one resolution. Omitted entirely, the behaviour is unchanged. */
export interface ResolveOptions {
  /**
   * Refuse (throw `UnnamedUnitError`) rather than silently defaulting a live
   * unit the caller did not name. `NO_ORDER` still means "the kind's own
   * default", which is a rule of the game — this only catches SILENCE.
   */
  readonly strict?: boolean;
}

export const NO_TIER_EXPIRY = 0x7fff;

/** A live unit as a caller describes it. */
export interface UnitSpec {
  readonly unitId: number;
  readonly kind: UnitKind;
  readonly team: number;
  /**
   * Occupancy, head first. A piece supplies EXACTLY ONE cell.
   *
   * NOT THE WIRE'S ENCODING. `Turn.playerPieces` stores a piece's weight as
   * that many copies of its cell, so a weight-3 rook arrives as three
   * identical entries; `create` throws on that, because here a stack is one
   * cell plus an explicit `weight`. Feeding a turn payload in means
   * `cells: [occupancy[0]], weight: occupancy.length` for anything that does
   * not leave a trail, and `cells: occupancy` for anything that does.
   */
  readonly cells: ReadonlyArray<number>;
  readonly health: number;
  readonly tier?: number;
  /**
   * The turn at which the unit's tier effect expires (reverts toward 0).
   * Contests read tier at the ARRIVAL turn, so a consumer needs the expiry,
   * not just the current tier — without it every client rounds in one
   * direction or the other. Omit (or null) for "no expiry".
   */
  readonly tierExpiresAtTurn?: number | null;
  readonly weight?: number;
  readonly orientation?: number;
}

/** Read-back of one live unit. Cold path — tests, heuristics, reporting. */
export interface UnitView {
  readonly unitId: number;
  readonly kind: UnitKind;
  readonly team: number;
  readonly cells: number[];
  readonly health: number;
  readonly tier: number;
  readonly tierExpiresAtTurn: number | null;
  readonly weight: number;
  readonly orientation: number;
  readonly alive: boolean;
}

/** "Nothing staged" — the KIND's own default action applies. */
export const NO_ORDER = -1;

// ---------------------------------------------------------------------------

export class PartialEngine {
  readonly grid: Grid;
  readonly terrain: Terrain;
  readonly config: EngineConfig;
  /**
   * DEPRECATED as a hold path: the source built from the CONSTRUCTOR premise.
   * Holds derive their premise from the state itself (`sourceOf`); this one
   * remains only so external callers that built timelines against it keep
   * working, and it is correct exactly when the constructor premise equals
   * the state's boards.
   */
  readonly clouds: CloudSource;

  /** Instrumentation the benchmarks read. */
  forks = 0;
  resolutions = 0;

  /**
   * Cloud sources PER PREMISE, keyed by the state's own item boards. A
   * claim's premise (the food/potion set its health relaxation and strength
   * bounds read) is DERIVED FROM THE STATE at hold time, never a separate
   * constructor argument: an empty premise beside a stateful board silently
   * yields a weight ceiling that cannot grow — a bound that can only get
   * more pessimistic is not conservative, it is broken.
   *
   * LRU-BOUNDED (`config.sourceCacheSize`). The premise key changes whenever
   * an item leaves the board, so in a long-lived process this map grows once
   * per few turns forever, and each entry used to pin every timeline built
   * against it. Eviction is free of consequence: a source owns no state a
   * consumer holds — fields hold TIMELINES, not sources — so an evicted
   * premise costs the next hold a re-dilation and nothing more.
   */
  private readonly sources = new Map<string, CloudSource>();
  /**
   * Claim versions, OWNED BY THE ENGINE rather than by each source. A version
   * is documented as monotonically increasing per unit id; letting an eviction
   * take the counter with it would let a version go backwards, and a consumer
   * comparing versions would read a refinement as un-done.
   */
  private readonly claimVersions = new Map<number, number>();

  private readonly unitStride: number;
  private readonly boardStride: number;
  private unitArena: Int16Array;
  private boardArena: Uint32Array;
  private slabCount: number;
  private readonly freeSlabs: number[] = [];

  // Per-resolution scratch — allocated once, reused forever, generation-stamped
  // so no board-sized clear ever happens.
  private gen = 1;
  /**
   * (cell -> every LIVING unit whose head stands there this sub-step), as an
   * intrusive list. One structure for arrivals and incumbents together, so a
   * unit that both advanced and was reverted onto a cell is listed exactly
   * once: the vendor's participant set is a SET of units at the cell, and
   * counting an edge winner twice used to hand it its own tie.
   */
  private readonly occGen: Int32Array;
  private readonly occHead: Int32Array;
  private readonly occNext: Int32Array;
  private readonly bodyGen: Int32Array;
  private readonly bodyOwner: Int32Array;
  private readonly bodyIdx: Int32Array;
  /** How many living trail units cover this cell with their BODY this sub-step. */
  private readonly bodyCount: Int32Array;
  private pileGen = 1;
  private readonly pileStamp: Int32Array;
  /**
   * THE PERSISTENT PILE, as MEMBERSHIP rather than a running maximum. A cell
   * where something died holds the whole set of units that took part, and a
   * later arrival joins the CUMULATIVE contest against every one of them. A
   * member may still be ALIVE (a trail unit whose body sat where an arrival
   * died on it), and losing that contest kills it whole, wherever its head
   * happens to be — the wrestling rule. Collapsing the pile to (tier, weight)
   * lost exactly that: a live member cannot be a victim of a max.
   */
  private readonly pileMask: Int32Array;
  private readonly maskWords: number;
  private readonly uPath: Int32Array;
  private readonly uPathLen: Int32Array;
  /** Post-turn orientation for a unit whose action was a rotation, else -1. */
  private readonly uRotate: Int32Array;
  /**
   * Did the unit COMPLETE an entry this sub-step? Set by `advance`, cleared
   * for an edge-exchange loser (squashed against its own neck, it never
   * entered the far cell and is never charged for it). The health phase
   * reads THIS, never the unit's status: a capture-stop marks the unit
   * `stopped` in the batch BEFORE health runs, but the kill cell was still
   * ENTERED and the rules charge for cells actually entered — reading status
   * left every capturing unit one health too strong per capture (Bot B's
   * revalidation bug).
   */
  private readonly uAdvanced: Int32Array;
  /** Health per cell entered — the kind profile's costPerCell, cached per slot. */
  private readonly uCost: Int32Array;
  /** Cells holding food or any unit at turn start — pawn attack legality. */
  private readonly pawnTargets: Board;
  private readonly pawnFood: Board;
  private readonly uStatus: Int32Array;
  private readonly uTier: Int32Array;
  private readonly uWeight: Int32Array;
  private readonly uHealth: Int32Array;
  private readonly uPrevHead: Int32Array;
  private readonly uStartHead: Int32Array;
  private readonly uSever: Int32Array;
  /** Slots whose strength interval permits beating this unit. One turn's constant. */
  private readonly uBeatenBy: Int32Array;
  /**
   * Slots that can kill this unit ON THEIR OWN LIVING BODY and that `uBeatenBy`
   * does NOT already name — the difference between the two comparators, which
   * is all the per-cell loop ever needs. Non-zero only for trail claims at the
   * mover's own tier that it out-weighs, which is exactly the case the contest
   * comparator gets wrong (V2 BUG-1) and empty on most boards.
   */
  private readonly uBodyBeatenBy: Int32Array;
  private readonly pendKill: Int32Array;
  /** The ClashKind index (`CAUSE_NAMES`) a pending kill will be recorded under. */
  private readonly pendCause: Int32Array;
  private readonly pendStop: Int32Array;
  private readonly pendSever: Int32Array;
  private readonly edgeSettled: Int32Array;
  /**
   * Edge-exchange LOSERS: reverted onto their own necks, so they are not at
   * their destination and take no further part in this sub-step. Distinct from
   * `edgeSettled`, which also covers the WINNER — a winner is a perfectly
   * ordinary arrival for walls, bodies and any contest at the cell it took.
   */
  private readonly uBlocked: Int32Array;
  /**
   * The arrival tier's participant snapshot: living, uncondemned and unblocked
   * AS THE ARRIVAL TIER FOUND THE BOARD. Frozen before any arrival is judged,
   * so no cell's contest can read what a sibling cell's contest just decided.
   */
  private readonly uStanding: Int32Array;
  /**
   * The body tier's snapshot: living and uncondemned AS THE BODY TIER FOUND THE
   * BOARD. Taken after the arrival tier and never updated inside it, which is
   * what makes two trail units running into each OTHER's necks both die
   * whichever order the roster happens to list them in.
   */
  private readonly uBodyAlive: Int32Array;
  /** Participant scratch for one cell contest, with a generation stamp for dedupe. */
  private partGen = 1;
  private readonly partStamp: Int32Array;
  private readonly partBuf: Int32Array;
  /** Arrival cells this sub-step, adjudicated in ascending cell order. */
  private readonly cellBuf: Int32Array;
  private readonly contestStamp: Int32Array;
  /** Owner scratch for a multi-owner body cell (only reachable for multi-step trails). */
  private readonly ownerBuf: Int32Array;
  /** (cell -> live slots already reported there this turn), generation-stamped. */
  private readonly notedStamp: Int32Array;
  private readonly notedMask: Int32Array;
  /**
   * (live slot -> some entanglement of this turn said an unknown could beat it),
   * generation-stamped on the same counter. This is `Fate.Contingent`, decided
   * where the fact is discovered rather than reconstructed afterwards.
   *
   * Sharing `turnGen` with `notedStamp` means sharing its wrap, and the wrap is
   * worth stating because this column's failure mode is not the other's: a
   * stale stamp that happens to equal the counter reports a unit CONTINGENT
   * that is merely ALIVE. That is the widening direction — a consumer
   * re-searches a line it did not have to — and never the other way round.
   */
  private readonly threatStamp: Int32Array;
  /**
   * Slots this turn's adjudication has stopped trusting the certainty of —
   * folded into the resolution's `softFrozen`. Shrinking certainty is always
   * sound, and one word carries it.
   */
  private pendSoftFrozen = 0;
  private turnGen = 1;
  private readonly maxPath: number;
  /** Per-resolution event output; see `Resolution.clashes` / `.deaths`. */
  private clashes: Clash[] = [];
  private deaths: DeathRecord[] = [];
  private severed: Map<number, number[]> = new Map();
  /** Exhaustion halt records awaiting the end-of-turn verdict, by slot. */
  private haltRecord: Array<{ clash: MutableClash; cell: number; subStep: number } | null> = [];
  private currentSubStep = 1;
  /** Stage-1 planning scratch — hoisted off the per-resolve alloc path. */
  private readonly pathScratch: number[] = [];
  /** Every cell any live unit occupied or entered this turn. */
  readonly touched: Board;
  /**
   * Every cell a live unit occupies at turn start or COULD enter along its
   * planned path — a superset of `touched`, known before the first sub-step and
   * therefore usable by the adjudicator. `touched` is what actually happened;
   * this is what the modelled side could reach, which is the question a claim's
   * conditionality turns on.
   */
  private readonly planFootprint: Board;
  /**
   * Frozen slots whose claim this branch may read as PRESENT — the only slots
   * for which `certain` is a fact rather than a conditional. See
   * `markUnconditionalClaims`.
   */
  private unconditionalClaims: SlotMask = 0;
  private ledger: Entanglement[] = [];

  constructor(
    terrain: Terrain,
    premise: Pick<CloudPremise, "food" | "potions">,
    config: Partial<EngineConfig> = {},
  ) {
    this.terrain = terrain;
    this.grid = terrain.grid;
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.clouds = new CloudSource(
      {
        terrain,
        food: premise.food,
        potions: premise.potions,
        promotionWeight: this.config.pawnPromotionWeight,
        hazardDamage: this.config.hazardDamage,
        maxHealth: this.config.maxHealth,
        maxHealthPerKind: this.config.maxHealthPerKind,
      },
      { cacheSize: this.config.timelineCacheSize, versions: this.claimVersions },
    );

    const U = this.config.maxUnits;
    const B = this.grid.cells;
    this.maxPath = Math.max(this.grid.width, this.grid.height);
    this.unitStride = U * U_FIELDS + U * this.config.maxTrail;
    this.boardStride = 2 * this.grid.words;
    this.slabCount = 64;
    this.unitArena = new Int16Array(this.unitStride * this.slabCount);
    this.boardArena = new Uint32Array(this.boardStride * this.slabCount);
    for (let i = this.slabCount - 1; i >= 0; i--) this.freeSlabs.push(i);

    this.occGen = new Int32Array(B);
    this.occHead = new Int32Array(B);
    this.occNext = new Int32Array(U);
    this.bodyGen = new Int32Array(B);
    this.bodyOwner = new Int32Array(B);
    this.bodyIdx = new Int32Array(B);
    this.bodyCount = new Int32Array(B);
    this.pileStamp = new Int32Array(B);
    this.maskWords = ((U + 31) / 32) | 0;
    this.pileMask = new Int32Array(B * this.maskWords);
    this.partStamp = new Int32Array(U);
    this.partBuf = new Int32Array(U);
    this.cellBuf = new Int32Array(U);
    this.contestStamp = new Int32Array(B);
    this.ownerBuf = new Int32Array(U);
    this.uBlocked = new Int32Array(U);
    this.uStanding = new Int32Array(U);
    this.uBodyAlive = new Int32Array(U);
    this.pendCause = new Int32Array(U);
    this.haltRecord = new Array(U).fill(null);
    this.uPath = new Int32Array(U * this.maxPath);
    this.uPathLen = new Int32Array(U);
    this.uRotate = new Int32Array(U);
    this.uAdvanced = new Int32Array(U);
    this.uCost = new Int32Array(U);
    this.pawnTargets = new Uint32Array(this.grid.words);
    this.pawnFood = new Uint32Array(this.grid.words);
    this.uStatus = new Int32Array(U);
    this.uTier = new Int32Array(U);
    this.uWeight = new Int32Array(U);
    this.uHealth = new Int32Array(U);
    this.uPrevHead = new Int32Array(U);
    this.uStartHead = new Int32Array(U);
    this.uSever = new Int32Array(U);
    this.uBeatenBy = new Int32Array(U);
    this.uBodyBeatenBy = new Int32Array(U);
    this.pendKill = new Int32Array(U);
    this.pendStop = new Int32Array(U);
    this.pendSever = new Int32Array(U);
    this.edgeSettled = new Int32Array(U);
    this.notedStamp = new Int32Array(B);
    this.notedMask = new Int32Array(B);
    this.threatStamp = new Int32Array(U);
    this.touched = new Uint32Array(this.grid.words);
    this.planFootprint = new Uint32Array(this.grid.words);
  }

  // -------------------------------------------------------------------------
  // Slab management
  // -------------------------------------------------------------------------

  private allocSlab(): number {
    const free = this.freeSlabs.pop();
    if (free !== undefined) return free;
    const grown = this.slabCount * 2;
    const units = new Int16Array(this.unitStride * grown);
    units.set(this.unitArena);
    const boards = new Uint32Array(this.boardStride * grown);
    boards.set(this.boardArena);
    for (let i = grown - 1; i > this.slabCount; i--) this.freeSlabs.push(i);
    const next = this.slabCount;
    this.unitArena = units;
    this.boardArena = boards;
    this.slabCount = grown;
    return next;
  }

  /** Returns a state's storage to the pool. A search must release what it drops. */
  release(state: StateHandle): void {
    this.freeSlabs.push(state.slab);
  }

  /** How many slabs the arena currently holds — a benchmark/inspection hook. */
  get capacity(): number {
    return this.slabCount;
  }

  /**
   * The cloud source whose premise IS this state's item boards. Sibling
   * states holding the same items share one source, so interning and claim
   * versions still amortize across the whole tree.
   */
  sourceOf(state: StateHandle): CloudSource {
    const fb = this.foodBase(state.slab);
    const pb = this.potionBase(state.slab);
    const key = this.premiseKeyOf(state);
    const found = this.sources.get(key);
    if (found !== undefined) {
      // Touch, so the premise a search is actually working in is the last one
      // to be evicted.
      this.sources.delete(key);
      this.sources.set(key, found);
      return found;
    }
    const food = new Uint32Array(this.grid.words);
    const potions = new Uint32Array(this.grid.words);
    for (let i = 0; i < this.grid.words; i++) {
      food[i] = this.boardArena[fb + i] as number;
      potions[i] = this.boardArena[pb + i] as number;
    }
    const src = new CloudSource(
      {
        terrain: this.terrain,
        food,
        potions,
        promotionWeight: this.config.pawnPromotionWeight,
        hazardDamage: this.config.hazardDamage,
        maxHealth: this.config.maxHealth,
        maxHealthPerKind: this.config.maxHealthPerKind,
      },
      { cacheSize: this.config.timelineCacheSize, versions: this.claimVersions },
    );
    this.sources.set(key, src);
    while (this.sources.size > this.config.sourceCacheSize) {
      const oldest = this.sources.keys().next();
      if (oldest.done) break;
      this.sources.delete(oldest.value);
    }
    return src;
  }

  /**
   * The health a meal restores this kind to. Public because a consumer pricing
   * a plan needs the same number the resolver will use, and deriving it from
   * `config` a second time is how the two drift apart.
   */
  maxHealthOf(kind: UnitKind): number {
    return maxHealthFor(this.config.maxHealth, this.config.maxHealthPerKind, kind);
  }

  /** How many premises the engine is currently retaining sources for. */
  get sourceCount(): number {
    return this.sources.size;
  }

  /** Timelines retained across every live source, `clouds` included. */
  get retainedTimelines(): number {
    let n = this.clouds.retainedTimelines;
    for (const src of this.sources.values()) n += src.retainedTimelines;
    return n;
  }

  /**
   * Drop every per-premise cloud source, and everything the constructor-premise
   * source interned. The explicit half of the claim-cache lifecycle, for a
   * consumer that knows a decision is over: nothing a caller still holds points
   * at a source (fields hold timelines), so this frees the caches and leaves
   * every existing state, field and bound exactly as it was. Claim versions
   * survive — they record refinements that happened, and are not a cache.
   */
  clearSources(): void {
    this.sources.clear();
    this.clouds.clear();
  }

  private uBase(slab: number): number {
    return slab * this.unitStride;
  }

  private trailBase(slab: number, i: number): number {
    return slab * this.unitStride + this.config.maxUnits * U_FIELDS + i * this.config.maxTrail;
  }

  private foodBase(slab: number): number {
    return slab * this.boardStride;
  }

  private potionBase(slab: number): number {
    return slab * this.boardStride + this.grid.words;
  }

  // -------------------------------------------------------------------------
  // Construction, forking, reading back
  // -------------------------------------------------------------------------

  create(
    units: ReadonlyArray<UnitSpec>,
    food: Iterable<number> = [],
    potions: Iterable<number> = [],
    turn = 0,
  ): StateHandle {
    if (units.length > this.config.maxUnits) {
      throw new Error(`too many live units: ${units.length} > ${this.config.maxUnits}`);
    }
    const slab = this.allocSlab();
    const base = this.uBase(slab);
    const arena = this.unitArena;
    for (let i = 0; i < this.config.maxUnits; i++) {
      arena[base + i * U_FIELDS + U_STATUS] = Standing.Empty;
    }
    units.forEach((u, i) => {
      if (u.cells.length === 0) throw new Error(`unit ${u.unitId} has no cells`);
      if (u.cells.length > this.config.maxTrail) throw new Error(`unit ${u.unitId} trail too long`);
      if (!profileOf(u.kind).leavesTrail && u.cells.length !== 1) {
        throw new Error(`piece ${u.unitId} must occupy exactly one cell`);
      }
      const o = base + i * U_FIELDS;
      arena[o + U_KIND] = u.kind;
      arena[o + U_TEAM] = u.team;
      arena[o + U_TIER] = u.tier ?? 0;
      arena[o + U_TIEREXP] = Math.min(NO_TIER_EXPIRY, u.tierExpiresAtTurn ?? NO_TIER_EXPIRY);
      arena[o + U_WEIGHT] = u.weight ?? u.cells.length;
      arena[o + U_HEALTH] = u.health;
      arena[o + U_ORIENT] = u.orientation ?? 0;
      arena[o + U_STATUS] = Standing.Alive;
      arena[o + U_LEN] = u.cells.length;
      arena[o + U_ID] = u.unitId;
      const t = this.trailBase(slab, i);
      for (let j = 0; j < u.cells.length; j++) arena[t + j] = u.cells[j] as number;
    });
    const fb = this.foodBase(slab);
    const pb = this.potionBase(slab);
    for (let i = 0; i < this.grid.words; i++) {
      this.boardArena[fb + i] = 0;
      this.boardArena[pb + i] = 0;
    }
    for (const c of food)
      this.boardArena[fb + (c >>> 5)] =
        (this.boardArena[fb + (c >>> 5)] as number) | (1 << (c & 31));
    for (const c of potions)
      this.boardArena[pb + (c >>> 5)] =
        (this.boardArena[pb + (c >>> 5)] as number) | (1 << (c & 31));
    return { slab, field: emptyField(this.grid, turn), turn, softFrozen: 0 };
  }

  /**
   * A sibling state. Two `copyWithin` calls and a four-field object — the frozen
   * half costs nothing at all, because the cloud field is shared by pointer.
   */
  fork(state: StateHandle): StateHandle {
    this.forks++;
    const slab = this.allocSlab();
    const us = this.unitStride;
    const bs = this.boardStride;
    this.unitArena.copyWithin(slab * us, state.slab * us, state.slab * us + us);
    this.boardArena.copyWithin(slab * bs, state.slab * bs, state.slab * bs + bs);
    return { slab, field: state.field, turn: state.turn, softFrozen: state.softFrozen };
  }

  /** Live unit slots that hold a living unit, in slot order. */
  liveSlots(state: StateHandle): number[] {
    const base = this.uBase(state.slab);
    const out: number[] = [];
    for (let i = 0; i < this.config.maxUnits; i++) {
      if (this.unitArena[base + i * U_FIELDS + U_STATUS] === Standing.Alive) out.push(i);
    }
    return out;
  }

  slotOfUnit(state: StateHandle, unitId: number): number {
    const base = this.uBase(state.slab);
    for (let i = 0; i < this.config.maxUnits; i++) {
      const o = base + i * U_FIELDS;
      if (this.unitArena[o + U_STATUS] !== Standing.Empty && this.unitArena[o + U_ID] === unitId) {
        return i;
      }
    }
    return -1;
  }

  unitAt(state: StateHandle, slot: number): UnitView | null {
    const o = this.uBase(state.slab) + slot * U_FIELDS;
    const arena = this.unitArena;
    if (arena[o + U_STATUS] === Standing.Empty) return null;
    const len = arena[o + U_LEN] as number;
    const t = this.trailBase(state.slab, slot);
    const cells: number[] = [];
    for (let j = 0; j < len; j++) cells.push(arena[t + j] as number);
    return {
      unitId: arena[o + U_ID] as number,
      kind: arena[o + U_KIND] as UnitKind,
      team: arena[o + U_TEAM] as number,
      cells,
      health: arena[o + U_HEALTH] as number,
      tier: arena[o + U_TIER] as number,
      tierExpiresAtTurn:
        (arena[o + U_TIEREXP] as number) === NO_TIER_EXPIRY
          ? null
          : (arena[o + U_TIEREXP] as number),
      weight: arena[o + U_WEIGHT] as number,
      orientation: arena[o + U_ORIENT] as number,
      alive: arena[o + U_STATUS] === Standing.Alive,
    };
  }

  /** Every living unit, cheapest-to-read form. Cold path. */
  units(state: StateHandle): UnitView[] {
    const out: UnitView[] = [];
    for (let i = 0; i < this.config.maxUnits; i++) {
      const v = this.unitAt(state, i);
      if (v?.alive === true) out.push(v);
    }
    return out;
  }

  headOf(state: StateHandle, slot: number): number {
    return this.unitArena[this.trailBase(state.slab, slot)] as number;
  }

  foodBoard(state: StateHandle, dst: Board): void {
    const fb = this.foodBase(state.slab);
    for (let i = 0; i < this.grid.words; i++) dst[i] = this.boardArena[fb + i] as number;
  }

  potionBoard(state: StateHandle, dst: Board): void {
    const pb = this.potionBase(state.slab);
    for (let i = 0; i < this.grid.words; i++) dst[i] = this.boardArena[pb + i] as number;
  }

  /** The cells every living unit stands in, as a bitboard. The searcher's "focus". */
  occupancyInto(state: StateHandle, dst: Board): void {
    bbZero(dst, this.grid.words);
    const arena = this.unitArena;
    const base = this.uBase(state.slab);
    for (let i = 0; i < this.config.maxUnits; i++) {
      const o = base + i * U_FIELDS;
      if (arena[o + U_STATUS] !== Standing.Alive) continue;
      const t = this.trailBase(state.slab, i);
      const len = arena[o + U_LEN] as number;
      for (let j = 0; j < len; j++) bbSet(dst, arena[t + j] as number);
    }
  }

  // -------------------------------------------------------------------------
  // Freezing and unfreezing
  // -------------------------------------------------------------------------

  /**
   * Take a live unit off the board and stand its claim there instead. The unit's
   * record crystallizes — nothing ever changes it again — and its cloud is
   * computed by a timeline every sibling state shares.
   *
   * No default move is assumed. That is the whole point: the unit's slot is
   * emptied, and what replaces it is a claim covering every move it could make.
   *
   * MUTATES THE SLAB IN PLACE. The unit's slot is emptied in `state`'s own
   * storage, so any `UnitView` or slot index a caller is holding for that unit
   * goes stale the moment this returns, and so does the state handle's board
   * for that slot — `hold` and `unfreeze` both edit the arena the handle points
   * at rather than copying it. Fork FIRST if the pre-hold board must survive.
   *
   * `heldAtTurn` overrides WHEN the record was observed. It defaults to the
   * state's current turn, which is right for a searcher freezing a unit it can
   * see, and wrong for a bot told "this enemy was last seen three turns ago":
   * stamping now would claim a one-turn cloud for a four-turn-old observation,
   * which UNDER-approximates — the one direction this design may never err in.
   * Must not be in the future.
   */
  hold(
    state: StateHandle,
    slot: number,
    narrowedTo: ReadonlyArray<number> | null = null,
    heldAtTurn?: number,
  ): StateHandle {
    const view = this.unitAt(state, slot);
    if (view === null || !view.alive) throw new Error(`slot ${slot} holds no live unit`);
    const record: FrozenRecord = {
      unitId: view.unitId,
      kind: view.kind,
      team: view.team,
      occupancy: view.cells,
      heldAtTurn: observedAt(heldAtTurn, state.turn, view.unitId),
      health: view.health,
      tier: view.tier,
      tierExpiresAtTurn: view.tierExpiresAtTurn,
      weight: view.weight,
      orientation: view.orientation,
      narrowedTo,
    };
    this.unitArena[this.uBase(state.slab) + slot * U_FIELDS + U_STATUS] = Standing.Empty;
    return {
      slab: state.slab,
      field: state.field.withHeld(this.sourceOf(state), record, state.turn),
      turn: state.turn,
      softFrozen: state.softFrozen,
    };
  }

  /**
   * Freeze several units at once — the archetypal case, since a searcher decides
   * which SIDE to model rather than which unit. The cloud field is assembled once
   * instead of once per unit, which matters because assembling it is O(k) in the
   * units already frozen.
   *
   * Mutates the slab in place, exactly as `hold` does. `heldAtTurn` applies to
   * every unit in the call; for a roster observed at DIFFERENT turns — the
   * usual shape for a bot reconstructing an opponent's side from what it last
   * saw — build the field directly instead, one record per observation turn:
   *
   *     emptyField(engine.grid, turn).withHeldMany(engine.sourceOf(state), [
   *       { ...recordA, heldAtTurn: 7 },
   *       { ...recordB, heldAtTurn: 4 },
   *     ], turn)
   *
   * and put that field on the handle. That is the general recipe; this
   * parameter is the one-turn-for-all shorthand.
   */
  holdMany(
    state: StateHandle,
    slots: ReadonlyArray<number>,
    heldAtTurn?: number,
  ): StateHandle {
    if (slots.length === 0) return state;
    const records: FrozenRecord[] = [];
    for (const slot of slots) {
      const view = this.unitAt(state, slot);
      if (view === null || !view.alive) throw new Error(`slot ${slot} holds no live unit`);
      records.push({
        unitId: view.unitId,
        kind: view.kind,
        team: view.team,
        occupancy: view.cells,
        heldAtTurn: observedAt(heldAtTurn, state.turn, view.unitId),
        health: view.health,
        tier: view.tier,
        tierExpiresAtTurn: view.tierExpiresAtTurn,
        weight: view.weight,
        orientation: view.orientation,
        narrowedTo: null,
      });
      this.unitArena[this.uBase(state.slab) + slot * U_FIELDS + U_STATUS] = Standing.Empty;
    }
    return {
      slab: state.slab,
      field: state.field.withHeldMany(this.sourceOf(state), records, state.turn),
      turn: state.turn,
      softFrozen: state.softFrozen,
    };
  }

  /**
   * Put a frozen unit back on the board at a supplied occupancy — the "return to
   * simulate" step. The caller decides where it goes; the engine checks the
   * placement is inside the claim it made, so an unfreeze can never contradict a
   * bound the searcher already reasoned with.
   *
   * MUTATES THE SLAB IN PLACE, like `hold`: the unit is written into a free
   * slot of `state`'s own storage. Every handle sharing that slab — including
   * the one passed in — sees the unit appear. Fork first if that matters.
   */
  unfreeze(
    state: StateHandle,
    unitId: number,
    cells: ReadonlyArray<number>,
    health?: number,
  ): StateHandle {
    const slot = state.field.slotOf(unitId);
    if (slot === undefined) throw new Error(`unit ${unitId} is not frozen`);
    for (const c of cells) {
      if (!bbTest(slot.cloud.possible, c)) {
        throw new Error(`unfreezing unit ${unitId} at cell ${c}, which its own claim excludes`);
      }
    }
    const free = this.freeLiveSlot(state);
    const o = this.uBase(state.slab) + free * U_FIELDS;
    const arena = this.unitArena;
    arena[o + U_KIND] = slot.record.kind;
    arena[o + U_TEAM] = slot.record.team;
    arena[o + U_TIER] = slot.record.tier;
    arena[o + U_TIEREXP] = Math.min(
      NO_TIER_EXPIRY,
      slot.record.tierExpiresAtTurn ?? NO_TIER_EXPIRY,
    );
    arena[o + U_WEIGHT] = Math.max(slot.bounds.weightMin, cells.length);
    arena[o + U_HEALTH] = health ?? slot.record.health;
    arena[o + U_ORIENT] = slot.record.orientation;
    arena[o + U_STATUS] = Standing.Alive;
    arena[o + U_LEN] = cells.length;
    arena[o + U_ID] = unitId;
    const t = this.trailBase(state.slab, free);
    for (let j = 0; j < cells.length; j++) arena[t + j] = cells[j] as number;
    return {
      slab: state.slab,
      field: state.field.without(unitId),
      turn: state.turn,
      // Slot numbers are stable, so the branch's distrust word stays meaningful;
      // the departing unit's bit is simply never consulted again.
      softFrozen: state.softFrozen & ~(1 << slot.slot),
    };
  }

  /**
   * A REUSABLE HOLD CONFIGURATION (anytime-kernel demand): building a cloud
   * field costs O(K · words) plus the widening scan — measured an order of
   * magnitude over a resolve when rebuilt per call. `makeHoldSet` builds it
   * once; `applyHoldSet` re-applies it to any sibling state at the same turn
   * with the same item boards for O(slots) status writes and a pointer copy.
   */
  makeHoldSet(state: StateHandle, slots: ReadonlyArray<number>): HoldSet {
    const held = this.holdMany(this.fork(state), slots);
    const unitIds = held.field.slots.map((s) => s.record.unitId);
    const handle: HoldSet = {
      field: held.field,
      turn: state.turn,
      premiseKey: this.premiseKeyOf(state),
      unitIds,
    };
    this.release(held);
    return handle;
  }

  /** Apply a prepared hold set. Validates turn and item-board identity. */
  applyHoldSet(state: StateHandle, holds: HoldSet): StateHandle {
    if (holds.turn !== state.turn) {
      throw new Error(
        `hold set was prepared at turn ${holds.turn}, not ${state.turn} — a claim is a function of its freeze turn`,
      );
    }
    if (this.premiseKeyOf(state) !== holds.premiseKey) {
      throw new Error(
        "hold set was prepared against different item boards — its claims' premise would be a lie here",
      );
    }
    for (const unitId of holds.unitIds) {
      const slot = this.slotOfUnit(state, unitId);
      if (slot < 0) throw new Error(`hold set names unit ${unitId}, absent from this state`);
      // The status word, not a `UnitView`. `unitAt` builds a ten-field object
      // and copies the whole occupancy into a fresh array, and this call site
      // read one boolean off it — `view === null || !view.alive` is `status is
      // not Alive`, spelled out through an allocation. `applyHoldSet` runs once
      // per sibling state, so it was one object and one array per held unit per
      // node of the search.
      const o = this.uBase(state.slab) + slot * U_FIELDS;
      if (this.unitArena[o + U_STATUS] !== Standing.Alive) {
        throw new Error(`hold set names dead unit ${unitId}`);
      }
      this.unitArena[o + U_STATUS] = Standing.Empty;
    }
    return {
      slab: state.slab,
      field: holds.field,
      turn: state.turn,
      softFrozen: state.softFrozen,
    };
  }

  private premiseKeyOf(state: StateHandle): string {
    // FNV-1a over the item words — collisions would silently share a wrong
    // premise, so fold in a second, independently-seeded pass.
    const fb = this.foodBase(state.slab);
    const pb = this.potionBase(state.slab);
    let h1 = 0x811c9dc5;
    let h2 = 0xcbf29ce4;
    const mix = (h: number, v: number): number => {
      let x = h ^ (v & 0xffff);
      x = Math.imul(x, 0x01000193);
      x ^= v >>> 16;
      return Math.imul(x, 0x01000193);
    };
    for (let i = 0; i < this.grid.words; i++) {
      const f = this.boardArena[fb + i] as number;
      const p = this.boardArena[pb + i] as number;
      h1 = mix(mix(h1, f), p);
      h2 = mix(mix(h2, p ^ 0x9e3779b9), f ^ 0x85ebca6b);
    }
    return `${h1 >>> 0}:${h2 >>> 0}`;
  }

  /**
   * THE INFLUENCE FOOTPRINT of one candidate move (anytime-kernel demand):
   * the cells the move can affect — the mover's own occupancy (vacated or
   * dragged), every path cell it may enter, and the edge-adjacent origin —
   * plus the units and claims whose material or possibility those cells
   * touch. Consumers drive dirty-tracking and re-search scheduling off this
   * rather than re-deriving it from paths.
   */
  influenceOf(
    state: StateHandle,
    slot: number,
    dest: number,
  ): { cells: Board; liveUnits: number[]; frozenUnits: number[] } {
    const view = this.unitAt(state, slot);
    if (view === null) throw new Error(`slot ${slot} holds no unit`);
    const cells = new Uint32Array(this.grid.words);
    for (const c of view.cells) bbSet(cells, c);
    const act =
      dest === NO_ORDER
        ? null
        : planAction(
            this.terrain,
            view.kind,
            view.cells[0] as number,
            dest,
            view.orientation,
            null,
          );
    if (act !== null && act.kind === "move") {
      for (const c of act.path) bbSet(cells, c);
    } else if (act === null) {
      const scratch: number[] = [];
      const n = defaultPath(
        this.terrain,
        view.kind,
        view.cells[0] as number,
        view.orientation,
        scratch,
      );
      for (let i = 0; i < n; i++) bbSet(cells, scratch[i] as number);
    }
    const liveUnits: number[] = [];
    for (const u of this.units(state)) {
      if (u.unitId === view.unitId) continue;
      if (u.cells.some((c) => bbTest(cells, c))) liveUnits.push(u.unitId);
    }
    const frozenMask = state.field.intersectingEver(cells);
    const frozenUnits: number[] = [];
    for (const s of state.field.slots) {
      if ((frozenMask & (1 << s.slot)) !== 0) frozenUnits.push(s.record.unitId);
    }
    return { cells, liveUnits, frozenUnits };
  }

  private freeLiveSlot(state: StateHandle): number {
    const base = this.uBase(state.slab);
    for (let i = 0; i < this.config.maxUnits; i++) {
      if (this.unitArena[base + i * U_FIELDS + U_STATUS] === Standing.Empty) return i;
    }
    throw new Error("no free live slot");
  }

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve one turn over a partial state.
   *
   * `orders[slot]` is a staged destination cell, or -1 for "nothing staged" — in
   * which case the KIND's own default action applies (a trail unit continues
   * straight; a piece holds). That is a rule of the game, not an assumption about
   * an agent: it is what the engine does with a live unit whose operator said
   * nothing, and it is never applied to a frozen unit, which has no slot at all.
   *
   * `options.strict` separates that rule from CALLER SILENCE: an `orders` entry
   * that is absent altogether becomes an `UnnamedUnitError` instead of a default.
   */
  resolve(
    state: StateHandle,
    orders: ArrayLike<number>,
    options?: ResolveOptions,
  ): Resolution {
    this.resolutions++;
    const arena = this.unitArena;
    const base = this.uBase(state.slab);
    const U = this.config.maxUnits;
    // THE CLAIM A RESOLUTION ADJUDICATES AGAINST IS THE POST-MOVE ONE. Contests
    // are decided between units at the positions they advanced INTO, and a frozen
    // unit advances during this turn exactly like a live one — so the cloud that
    // describes where it might be while the collisions happen is the one for the
    // turn this resolution produces, not the one it started from. Reading the
    // start-of-turn claim would silently under-state where an unmodelled unit
    // could be, which is the one direction this design may never err in.
    const startField = state.field;
    const field = startField.isEmpty ? startField : startField.advanceTo(state.turn + 1);
    const anyFrozen = !field.isEmpty;
    this.ledger = [];
    this.clashes = [];
    this.deaths = [];
    this.severed = new Map();
    this.currentTurn = state.turn;
    this.turnGen++;
    bbZero(this.touched, this.grid.words);
    this.unconditionalClaims = 0;
    this.pendSoftFrozen = 0;
    // THE FOOTPRINT IS ONLY EVER READ TO PROMOTE A CLAIM TO UNCONDITIONAL, and
    // a claim whose owner could have killed itself can never be promoted — so
    // one O(K) pass over a boolean decides whether any of the board work below
    // is worth doing at all. A held trail unit long enough to run into itself
    // has `deathPossible` from its first held turn, which is most of them, so
    // this skips the whole mechanism on the shape a search actually runs.
    const mayPromote = anyFrozen && field.unconditionalCandidates !== 0;
    if (mayPromote) bbZero(this.planFootprint, this.grid.words);
    const trailSlots = anyFrozen ? field.trailSlots : 0;
    this.pileGen++;
    let softFrozen = state.softFrozen;
    const strict = options?.strict === true;

    // ---- Stage 1: plan every live unit's path from the grammar ----
    // Pawn attack legality reads the cells holding food or ANY unit at the
    // start of the turn; built once, only when a live oriented kind exists.
    let anyOriented = false;
    for (let i = 0; i < U; i++) {
      const o = base + i * U_FIELDS;
      if (arena[o + U_STATUS] !== Standing.Alive) continue;
      if (profileOf(arena[o + U_KIND] as UnitKind).oriented) anyOriented = true;
    }
    if (anyOriented) {
      // THE ONE canonical construction (grammar.ts pawnTargetsInto): food ∪
      // every unit's turn-start occupancy. For frozen units only their
      // CERTAIN material counts here — the commit layer asserts nothing a
      // maybe could contradict; a maybe-target diagonal is the risk layer's
      // question, not a legality the mover may assume.
      const foodScratch = this.pawnFood;
      const fb = this.foodBase(state.slab);
      for (let i = 0; i < this.grid.words; i++) {
        foodScratch[i] = this.boardArena[fb + i] as number;
      }
      const occupancies: number[][] = [];
      for (let i = 0; i < U; i++) {
        const o = base + i * U_FIELDS;
        if (arena[o + U_STATUS] !== Standing.Alive) continue;
        const t = this.trailBase(state.slab, i);
        const len = arena[o + U_LEN] as number;
        const cells: number[] = [];
        for (let j = 0; j < len; j++) cells.push(arena[t + j] as number);
        occupancies.push(cells);
      }
      pawnTargetsInto(this.grid, this.pawnTargets, foodScratch, occupancies);
      if (anyFrozen) {
        for (let i = 0; i < this.grid.words; i++) {
          this.pawnTargets[i] =
            (this.pawnTargets[i] as number) | (startField.unionCertain[i] as number);
        }
        // A unit held THIS turn stands at its record at TURN START — "frozen"
        // means nobody modelled its choice, not that its start was lost — so
        // a staged capture onto it is legal (Bot B: holding the target must
        // not turn a staged capture into a stay). Staler records are genuine
        // maybes: the optimistic timeline treats them as empty, and the
        // divergence surfaces through the ledger like any other maybe.
        for (const slot of startField.slots) {
          if (slot.record.heldAtTurn !== state.turn) continue;
          for (const c of slot.record.occupancy) bbSet(this.pawnTargets, c);
        }
      }
    }

    let subSteps = 0;
    const pathScratch = this.pathScratch;
    for (let i = 0; i < U; i++) {
      this.uPathLen[i] = 0;
      this.uStatus[i] = S_DEAD;
      this.uSever[i] = -1;
      this.uRotate[i] = -1;
      this.haltRecord[i] = null;
      const o = base + i * U_FIELDS;
      if (arena[o + U_STATUS] !== Standing.Alive) continue;
      if (strict && orders[i] === undefined) {
        throw new UnnamedUnitError(arena[o + U_ID] as number, i);
      }
      const kind = arena[o + U_KIND] as UnitKind;
      const profile = profileOf(kind);
      const head = arena[this.trailBase(state.slab, i)] as number;
      // Frozen for the whole turn: every adjudication reads these, never a value
      // something else wrote this turn.
      this.uTier[i] = arena[o + U_TIER] as number;
      this.uWeight[i] = arena[o + U_WEIGHT] as number;
      this.uHealth[i] = arena[o + U_HEALTH] as number;
      this.uCost[i] = profile.costPerCell;
      this.uStatus[i] = S_ACTIVE;
      this.uPrevHead[i] = head;
      this.uStartHead[i] = head;
      if (anyFrozen) {
        this.beatMasksInto(
          field,
          i,
          this.uTier[i] as number,
          this.uWeight[i] as number,
          trailSlots,
        );
      } else {
        this.uBeatenBy[i] = 0;
        this.uBodyBeatenBy[i] = 0;
      }
      const staged = orders[i] ?? NO_ORDER;
      const orient = arena[o + U_ORIENT] as number;
      // The ENCODED form (`planActionInto`): the path lands straight in the
      // scratch this loop was going to copy it into anyway, and no action
      // object is built to be thrown away one line later.
      const code =
        staged === NO_ORDER
          ? ACTION_ILLEGAL
          : planActionInto(
              this.terrain,
              kind,
              head,
              staged,
              orient,
              profile.oriented ? this.pawnTargets : null,
              pathScratch,
            );
      let n = 0;
      if (code === ACTION_ILLEGAL) {
        n = defaultPath(this.terrain, kind, head, orient, pathScratch);
      } else if (code >= 0) {
        n = code; // a move (n cells already in pathScratch), or stay (0)
      } else {
        // A full-turn action: no movement, no movement cost, orientation set
        // at end of turn. The side cell is signalling, never entered.
        this.uRotate[i] = ACTION_ROTATE - code;
      }
      const pb = i * this.maxPath;
      for (let s = 0; s < n; s++) this.uPath[pb + s] = pathScratch[s] as number;
      this.uPathLen[i] = n;
      if (n > subSteps) subSteps = n;
      bbSet(this.touched, head);
      if (mayPromote) {
        // The modelled side's whole reach, known before any sub-step runs: its
        // turn-start occupancy (a trail unit's body kills what runs into it) and
        // every cell it may enter.
        const t = this.trailBase(state.slab, i);
        const len = arena[o + U_LEN] as number;
        for (let j = 0; j < len; j++) bbSet(this.planFootprint, arena[t + j] as number);
        for (let s = 0; s < n; s++) bbSet(this.planFootprint, pathScratch[s] as number);
      }
    }
    if (mayPromote) this.markUnconditionalClaims(field);

    // A unit that never moves still pays a stationary hazard dose at sub-step 1,
    // so all health accounting lives in one place.
    if (subSteps === 0) subSteps = 1;

    // ---- Stage 2: the sub-step loop ----
    for (let s = 1; s <= subSteps; s++) {
      this.currentSubStep = s;
      this.advance(state, s);
      // Edge exchanges decide who actually COMPLETED a crossing, so they settle
      // before anything else looks at the board: a loser's head is back on its
      // own neck by the time walls, bodies and arrivals are adjudicated.
      this.adjudicateEdges(state, s);
      this.indexBoard(state, s);
      this.adjudicate(state, s, field, startField, anyFrozen);
      softFrozen |= this.applyBatch(state, field, anyFrozen, s);
      this.healthPhase(state, s);
    }

    // ---- Stage 3: end of turn ----
    // Only COLLISION deaths withdraw a survivorID; the exhaustion deaths the
    // end-of-turn settlement adds are not a contest anybody lost, and a unit
    // that outlived a clash and then starved was still the one left standing.
    const collisionDeaths = this.deaths.length;
    this.endOfTurn(state, field, anyFrozen, subSteps);
    this.settleRecords(collisionDeaths);

    const nextTurn = state.turn + 1;
    const next: StateHandle = {
      slab: state.slab,
      field: field.isEmpty ? emptyField(this.grid, nextTurn) : field,
      turn: nextTurn,
      softFrozen,
    };
    // Which frozen claims this turn's movers actually reached. `touched` is
    // complete by now (stage 1 wrote every origin head, `advance` every
    // landing), and `field` is the POST-MOVE claim — the same turn — so the
    // intersection is between two boards describing the same instant.
    //
    // Then the claims' own half, which the field computed once and shares by
    // pointer with every sibling: two frozen claims that could have killed
    // each other. Both halves answer the same question — "no consumer may
    // price this slot certainly-alive" — so they are published as one mask
    // rather than as two a reader has to remember to OR.
    let mayHaveDied = 0;
    if (anyFrozen) {
      const w = this.grid.words;
      for (const slot of field.slots) {
        if (bbIntersects(slot.cloud.possible, this.touched, w)) mayHaveDied |= 1 << slot.slot;
      }
      mayHaveDied |= field.contestedClaims;
    }
    return {
      state: next,
      ledger: this.ledger,
      fates: this.fatesFrom(base),
      turn: state.turn,
      subSteps,
      clashes: this.clashes,
      deaths: this.deaths,
      severedCells: this.severed,
      mayHaveDied,
    };
  }

  /**
   * The two order-dependent finishing touches the rules specify, applied once
   * the whole turn is known.
   *
   * `survivorID` is decided from a sub-step's snapshot, but two units can
   * condemn each other in the SAME sub-step (two trail units running into each
   * other's necks) — nobody is left standing then, so the field is WITHDRAWN
   * rather than pointing at a unit that did not outlive its own record. That
   * withdrawal is what makes mutual annihilation legible to a consumer pairing
   * deaths up by cell.
   */
  private settleRecords(collisionDeaths: number): void {
    if (this.deaths.length > 0 && this.clashes.length > 0) {
      // A `Map<unitId, earliest subStep>` per resolution, to answer at most a
      // handful of questions about at most `maxUnits` deaths. Both lists are
      // bounded by the roster, so the linear scan is over tens of entries and
      // costs no allocation at all.
      for (const clash of this.clashes) {
        const survivor = clash.survivorID;
        if (survivor === undefined) continue;
        let died = -1;
        for (let i = 0; i < collisionDeaths; i++) {
          const d = this.deaths[i] as DeathRecord;
          if (d.unitId !== survivor) continue;
          if (died === -1 || d.subStep < died) died = d.subStep;
        }
        if (died !== -1 && died <= clash.subStep) {
          delete (clash as MutableClash).survivorID;
        }
      }
    }
    if (this.clashes.length > 1) sortSmall(this.clashes, byClashOrder);
    if (this.deaths.length > 1) sortSmall(this.deaths, byDeathOrder);
  }

  /** Push one typed event. IDs are sorted, exactly as the wire record wants them. */
  private clash(
    kind: ClashKind,
    cell: number,
    subStep: number,
    playerIDs: number[],
    victimIDs: number[],
    reason: string,
    survivorID?: number,
  ): MutableClash {
    sortIds(playerIDs);
    sortIds(victimIDs);
    const record: MutableClash = {
      index: cell,
      subStep,
      kind,
      playerIDs,
      victimIDs,
      ...(survivorID === undefined ? {} : { survivorID }),
      reason,
    };
    this.clashes.push(record);
    return record;
  }

  // ---- sub-step a: advance ----

  private advance(state: StateHandle, s: number): void {
    const arena = this.unitArena;
    const base = this.uBase(state.slab);
    const U = this.config.maxUnits;
    const T = this.config.maxTrail;
    this.gen++;
    for (let i = 0; i < U; i++) {
      this.uAdvanced[i] = 0;
      if (this.uStatus[i] !== S_ACTIVE) continue;
      if ((this.uPathLen[i] as number) < s) continue;
      this.uAdvanced[i] = 1;
      const o = base + i * U_FIELDS;
      const t = this.trailBase(state.slab, i);
      const head = this.uPath[i * this.maxPath + (s - 1)] as number;
      this.uPrevHead[i] = arena[t] as number;
      if (profileOf(arena[o + U_KIND] as UnitKind).leavesTrail) {
        // The tail pop is unconditional and precedes the head landing; nothing
        // later in the sub-step puts a tail back.
        const len = arena[o + U_LEN] as number;
        for (let j = Math.min(len, T - 1); j > 0; j--) arena[t + j] = arena[t + j - 1] as number;
        arena[t] = head;
        arena[o + U_LEN] = Math.min(len, T);
      } else {
        arena[t] = head;
      }
      bbSet(this.touched, head);
    }
  }

  /**
   * Head and body occupancy indexes for this sub-step, taken AFTER the edge tier
   * has put every loser back on its own neck — so the board this indexes is the
   * one every later tier adjudicates against.
   *
   * Every living unit is registered at its head cell, whether it advanced or
   * stood still: the rules' participant set at a cell is "the units whose head
   * is there", and splitting it into arrivals and incumbents is what let an edge
   * winner be counted twice in its own contest.
   */
  private indexBoard(state: StateHandle, _s: number): void {
    const arena = this.unitArena;
    const base = this.uBase(state.slab);
    const U = this.config.maxUnits;
    for (let i = 0; i < U; i++) {
      if (this.uStatus[i] === S_DEAD) continue;
      const o = base + i * U_FIELDS;
      if (arena[o + U_STATUS] !== Standing.Alive) continue;
      const t = this.trailBase(state.slab, i);
      const head = arena[t] as number;
      if (this.occGen[head] !== this.gen) {
        this.occGen[head] = this.gen;
        this.occHead[head] = -1;
      }
      this.occNext[i] = this.occHead[head] as number;
      this.occHead[head] = i;
      const len = arena[o + U_LEN] as number;
      for (let j = 1; j < len; j++) {
        const c = arena[t + j] as number;
        if (this.bodyGen[c] !== this.gen) {
          this.bodyGen[c] = this.gen;
          this.bodyOwner[c] = i;
          this.bodyIdx[c] = j;
          this.bodyCount[c] = 1;
        } else if (this.bodyOwner[c] !== i) {
          // Two living trails over one cell. Unreachable while every trail kind
          // takes exactly one step per turn; the slow path exists so a
          // multi-step trail kind registered later is judged against ALL its
          // owners, as the rules say, rather than the first one indexed.
          this.bodyCount[c] = (this.bodyCount[c] as number) + 1;
        }
      }
    }
  }

  // ---- sub-step b: adjudicate ----

  /**
   * TIER 1 — edge exchanges. Two heads crossing the same edge in opposite
   * directions in one sub-step. Uniform across every unit; the only exemption is
   * a jump, which crosses no edge at all.
   *
   * This runs before the board is indexed, because it decides who actually
   * completed a crossing. A loser is SQUASHED AGAINST ITS OWN NECK: only its
   * head reverts — the tail pop is unconditional and stands — and it is never
   * charged for the cell it did not enter. A winner is registered as the
   * SURVIVOR of the cell it completed into and is NOT re-adjudicated against the
   * pile it just made there; a later arrival contests it cumulatively, as usual.
   */
  private adjudicateEdges(state: StateHandle, s: number): void {
    const arena = this.unitArena;
    const base = this.uBase(state.slab);
    const U = this.config.maxUnits;
    for (let i = 0; i < U; i++) {
      this.pendKill[i] = -1;
      this.pendCause[i] = C_CONTEST;
      this.pendStop[i] = 0;
      this.pendSever[i] = -1;
      this.edgeSettled[i] = 0;
      this.uBlocked[i] = 0;
    }
    for (let i = 0; i < U; i++) {
      if (this.uStatus[i] !== S_ACTIVE || (this.uPathLen[i] as number) < s) continue;
      if (this.uBlocked[i] === 1) continue;
      if (!profileOf(arena[base + i * U_FIELDS + U_KIND] as UnitKind).traversesEdges) continue;
      const hi = arena[this.trailBase(state.slab, i)] as number;
      const pi = this.uPrevHead[i] as number;
      for (let j = i + 1; j < U; j++) {
        if (this.uStatus[j] !== S_ACTIVE || (this.uPathLen[j] as number) < s) continue;
        if (this.uBlocked[i] === 1 || this.uBlocked[j] === 1) continue;
        if (!profileOf(arena[base + j * U_FIELDS + U_KIND] as UnitKind).traversesEdges) continue;
        const hj = arena[this.trailBase(state.slab, j)] as number;
        const pj = this.uPrevHead[j] as number;
        if (hi !== pj || hj !== pi) continue;
        const cmp = this.compare(i, j);
        // Each clash OWNS its player list — `clash` sorts it in place — so every
        // record gets its own pair, written out. The pair used to be built once
        // and then spread into each record, which is one array per exchange
        // that exists only to be copied.
        const idI = this.idOf(base, i);
        const idJ = this.idOf(base, j);
        const reason =
          cmp === 0
            ? REASON.tie
            : (this.uTier[i] as number) === (this.uTier[j] as number)
              ? REASON.weight
              : REASON.tier;
        if (cmp === 0) {
          // Neither crosses; each is squashed at its own head cell, and each
          // cell gets its own record.
          this.squashAtNeck(state, j, pj);
          this.squashAtNeck(state, i, pi);
          this.clash("edge", pi, s, [idI, idJ], [idI], reason);
          this.clash("edge", pj, s, [idI, idJ], [idJ], reason);
          continue;
        }
        const winner = cmp > 0 ? i : j;
        const loser = cmp > 0 ? j : i;
        const cell = cmp > 0 ? pj : pi;
        this.squashAtNeck(state, loser, cell);
        this.settleEdgeWinner(winner, s);
        // The winner completes into the loser's head cell and capture-stops. It
        // is the SURVIVOR of that cell, not a fresh arrival at it, so the pile
        // it just made there is not re-adjudicated against it this sub-step.
        this.clash(
          "edge",
          cell,
          s,
          [idI, idJ],
          [cmp > 0 ? idJ : idI],
          reason,
          cmp > 0 ? idI : idJ,
        );
      }
    }
  }

  private squashAtNeck(state: StateHandle, i: number, neck: number): void {
    this.unitArena[this.trailBase(state.slab, i)] = neck;
    this.pendKill[i] = neck;
    this.pendCause[i] = C_EDGE;
    this.edgeSettled[i] = 1;
    this.uBlocked[i] = 1;
    // It never entered the far cell: not an arriver there, and never CHARGED
    // for it either (an edge-contest loser pays nothing for the cell it did
    // not enter).
    this.uAdvanced[i] = 0;
  }

  private settleEdgeWinner(i: number, s: number): void {
    this.edgeSettled[i] = 1;
    if ((this.uPathLen[i] as number) > s) this.pendStop[i] = 1;
  }

  private idOf(base: number, i: number): number {
    return this.unitArena[base + i * U_FIELDS + U_ID] as number;
  }

  private adjudicate(
    state: StateHandle,
    s: number,
    field: CloudField,
    startField: CloudField,
    anyFrozen: boolean,
  ): void {
    const arena = this.unitArena;
    const base = this.uBase(state.slab);
    const U = this.config.maxUnits;

    // TIER 2 — walls. Only a trail unit can stage one; a piece's destination is
    // grammar-validated to the interior.
    for (let i = 0; i < U; i++) {
      if (this.uStatus[i] !== S_ACTIVE || (this.uPathLen[i] as number) < s) continue;
      if (this.pendKill[i] !== -1 || this.uBlocked[i] === 1) continue;
      const head = arena[this.trailBase(state.slab, i)] as number;
      if (!bbTest(this.terrain.wall, head)) continue;
      this.pendKill[i] = head;
      this.pendCause[i] = C_WALL;
      const id = this.idOf(base, i);
      this.clash("wall", head, s, [id], [id], REASON.wall);
    }

    // TIER 3 — self-collision. Trail units only; a stack is all on one cell.
    for (let i = 0; i < U; i++) {
      if (this.uStatus[i] !== S_ACTIVE || (this.uPathLen[i] as number) < s) continue;
      if (this.pendKill[i] !== -1 || this.uBlocked[i] === 1) continue;
      const o = base + i * U_FIELDS;
      if (!profileOf(arena[o + U_KIND] as UnitKind).leavesTrail) continue;
      const t = this.trailBase(state.slab, i);
      const head = arena[t] as number;
      const len = arena[o + U_LEN] as number;
      for (let j = 1; j < len; j++) {
        if (arena[t + j] === head) {
          this.pendKill[i] = head;
          this.pendCause[i] = C_SELF;
          const id = this.idOf(base, i);
          this.clash("self", head, s, [id], [id], REASON.self);
          break;
        }
      }
    }

    // THE ARRIVAL TIER'S SNAPSHOT. Everything still standing once the edge,
    // wall and self tiers have had their say. Every cell contest below reads
    // THIS, never what a sibling cell's contest just decided, which is what
    // makes the whole sub-step independent of unit ordering.
    for (let i = 0; i < U; i++) {
      this.uStanding[i] =
        this.uStatus[i] !== S_DEAD &&
        arena[base + i * U_FIELDS + U_STATUS] === Standing.Alive &&
        this.pendKill[i] === -1 &&
        this.uBlocked[i] === 0
          ? 1
          : 0;
    }

    // TIER 4 — cell contests. Every unit whose head stands on a cell somebody
    // arrived at, plus everything that cell's persistent pile holds. Cells are
    // taken in ascending order so that a unit condemned at two of them (a live
    // pile member elsewhere) dies at the same one the rules' batch names.
    let cells = 0;
    for (let i = 0; i < U; i++) {
      if (this.uStatus[i] !== S_ACTIVE || (this.uPathLen[i] as number) < s) continue;
      if (this.pendKill[i] !== -1 || this.uBlocked[i] === 1) continue;
      const cell = arena[this.trailBase(state.slab, i)] as number;
      if (this.contestStamp[cell] === this.gen) continue;
      this.contestStamp[cell] = this.gen;
      this.cellBuf[cells++] = cell;
    }
    for (let a = 1; a < cells; a++) {
      const v = this.cellBuf[a] as number;
      let b = a - 1;
      while (b >= 0 && (this.cellBuf[b] as number) > v) {
        this.cellBuf[b + 1] = this.cellBuf[b] as number;
        b--;
      }
      this.cellBuf[b + 1] = v;
    }
    for (let a = 0; a < cells; a++) {
      this.contestCell(state, this.cellBuf[a] as number, s);
    }

    // TIER 5 — LIVING body / trail cells. An arrival at tier ≤ the owner's dies;
    // a strictly higher tier severs it and capture-stops.
    //
    // "Living owner" means living AS THIS TIER FOUND THE BOARD, and the snapshot
    // is taken ONCE, here. Two things ride on that, in opposite directions:
    //
    //   · an owner that died EARLIER in this same sub-step — to a wall, to its
    //     own body, to a lost edge exchange, to a contest — is not a living
    //     owner, and its body does not block. The material it leaves is a
    //     persistent pile, and the pile rule is scoped to arrivals at a LATER
    //     sub-step than the collision that formed it.
    //   · an owner condemned by THIS tier still blocks, because it was alive
    //     when the tier began. Two trail units that run into each other's necks
    //     both die, in either roster order.
    for (let i = 0; i < U; i++) {
      this.uBodyAlive[i] =
        this.uStatus[i] !== S_DEAD &&
        arena[base + i * U_FIELDS + U_STATUS] === Standing.Alive &&
        this.pendKill[i] === -1
          ? 1
          : 0;
    }
    for (let i = 0; i < U; i++) {
      if (this.uStatus[i] !== S_ACTIVE || (this.uPathLen[i] as number) < s) continue;
      if (this.uBodyAlive[i] !== 1 || this.uBlocked[i] === 1) continue;
      const cell = arena[this.trailBase(state.slab, i)] as number;
      if (this.bodyGen[cell] !== this.gen) continue;
      const owners = this.ownersAt(state, cell, i);
      if (owners === 0) continue;
      let maxTier = -0x7fff;
      for (let k = 0; k < owners; k++) {
        const o = this.ownerBuf[k] as number;
        const t = this.uTier[o] as number;
        if (t > maxTier) maxTier = t;
      }
      const id = this.idOf(base, i);
      if ((this.uTier[i] as number) <= maxTier) {
        this.pendKill[i] = cell;
        this.pendCause[i] = C_BODYBLOCK;
        const players = [id];
        // The cell now holds collision objects for the rest of the turn — the
        // dead arrival AND every owner whose body it died on. The owners are
        // ALIVE, and their membership is what makes a later arrival contest
        // them here rather than merely biting a piece off.
        this.pileAdd(cell, i);
        for (let k = 0; k < owners; k++) {
          const owner = this.ownerBuf[k] as number;
          players.push(this.idOf(base, owner));
          this.pileAdd(cell, owner);
        }
        this.clash(
          "bodyBlock",
          cell,
          s,
          players,
          [id],
          REASON.bodyBlock,
          owners === 1 ? this.idOf(base, this.ownerBuf[0] as number) : undefined,
        );
        continue;
      }
      // Severs are non-fatal: the owner is not a victim, the cut is registered
      // now and only applied once the collision phase is over.
      for (let k = 0; k < owners; k++) {
        const owner = this.ownerBuf[k] as number;
        const cut = this.cutIndexOf(state, owner, cell);
        if (cut < 1) continue;
        const prior = this.pendSever[owner] as number;
        if (prior === -1 || cut < prior) this.pendSever[owner] = cut;
        this.clash("sever", cell, s, [id, this.idOf(base, owner)], [], REASON.sever, id);
      }
      if ((this.uPathLen[i] as number) > s) this.pendStop[i] = 1;
    }

    // c5 AGAINST A FROZEN CLAIM — for the claims this branch may actually read
    // as present (`markUnconditionalClaims`). A certain cell in a resolution is
    // always a living trail unit's BODY segment: `certain` at turnsHeld n covers
    // freeze indices i ≤ k−1−n, which sit at body index i+n ≥ 1. So it is
    // answered by TIER ALONE, like every other living body, and never by the
    // cell contest that used to fold the claim in at `(tierMax, weightMax)`.
    //
    // The gate is the whole difference between this being right and being the
    // bug in a different coat: `deathPossible` alone says "the owner cannot kill
    // itself", which says nothing about the mover standing next to it.
    if (anyFrozen && this.unconditionalClaims !== 0) {
      for (let i = 0; i < U; i++) {
        if (this.uStatus[i] !== S_ACTIVE || (this.uPathLen[i] as number) < s) continue;
        if (this.uBodyAlive[i] !== 1 || this.uBlocked[i] === 1) continue;
        const cell = arena[this.trailBase(state.slab, i)] as number;
        if (!bbTest(field.unionCertain, cell)) continue;
        const fslot = field.certainAt(cell);
        if (fslot < 0 || (this.unconditionalClaims & (1 << fslot)) === 0) continue;
        const held = field.bySlot(fslot);
        if (held === undefined || !profileOf(held.record.kind).leavesTrail) continue;
        const id = this.idOf(base, i);
        const ownerId = held.record.unitId;
        if ((this.uTier[i] as number) <= held.bounds.tierMax) {
          if (this.pendKill[i] === -1) {
            this.pendKill[i] = cell;
            this.pendCause[i] = C_BODYBLOCK;
          }
          this.pileAdd(cell, i);
          this.clash("bodyBlock", cell, s, [id, ownerId], [id], REASON.bodyBlock, ownerId);
          continue;
        }
        // Strictly higher tier severs and capture-stops. The cut lands on a
        // claim rather than on arena storage, so what a resolution can do about
        // it is stop trusting that claim's certainty — which is what
        // `softFrozen` is for, and shrinking certainty is always sound.
        this.pendSoftFrozen |= 1 << fslot;
        this.clash("sever", cell, s, [id, ownerId], [], REASON.sever, id);
        if ((this.uPathLen[i] as number) > s) this.pendStop[i] = 1;
      }
    }
    // ---- The uncertainty overlay: one pass, one entry per (unit, cell) ----
    // Every ray cell IS a head cell at some sub-step, so recording the head cell
    // of every advancing unit covers arrival, transit, body contact and durable
    // piles alike (DESIGN.md §4.2 channels 1, 2, 4, 5).
    if (!anyFrozen) return;
    for (let i = 0; i < U; i++) {
      if (this.uStatus[i] !== S_ACTIVE || (this.uPathLen[i] as number) < s) continue;
      const cell = arena[this.trailBase(state.slab, i)] as number;
      const id = arena[base + i * U_FIELDS + U_ID] as number;
      const midRay = (this.uPathLen[i] as number) > s;
      this.noteCellUncertainty(id, i, cell, s, field, midRay ? Channel.Transit : Channel.Contest);
      if (profileOf(arena[base + i * U_FIELDS + U_KIND] as UnitKind).traversesEdges) {
        this.noteEdgeUncertainty(id, i, this.uPrevHead[i] as number, cell, s, field, startField);
      }
    }
    // A unit that stayed put is still an incumbent a frozen arrival could contest.
    for (let i = 0; i < U; i++) {
      if (this.uStatus[i] === S_DEAD) continue;
      if ((this.uPathLen[i] as number) >= s && this.uStatus[i] === S_ACTIVE) continue;
      const o = base + i * U_FIELDS;
      if (arena[o + U_STATUS] !== Standing.Alive) continue;
      const cell = arena[this.trailBase(state.slab, i)] as number;
      this.noteCellUncertainty(arena[o + U_ID] as number, i, cell, s, field, Channel.Contest);
    }
  }

  /**
   * THE WHOLE CUMULATIVE CONTEST AT ONE ARRIVAL CELL.
   *
   * Participants are the units whose heads stand here as the arrival tier found
   * the board, PLUS every unit the cell's persistent pile holds — deduplicated,
   * because a unit can be both. A pile member need not be standing here, or
   * anywhere near: from the moment something dies on a cell, everything that
   * took part there keeps wrestling for it, and a live participant that loses
   * the cumulative contest dies WHOLE, wherever its head happens to be.
   *
   * Survival is being the unique strict maximum of the entire pile — never a
   * pairwise comparison against the newest arrival.
   */
  private contestCell(state: StateHandle, cell: number, s: number): void {
    const base = this.uBase(state.slab);
    this.partGen++;
    let n = 0;
    let bestTier = -0x7fff;
    let bestWeight = -1;
    let bestCount = 0;
    let best = -1;

    // THE RUNNING MAXIMUM IS WRITTEN OUT AT BOTH SITES, not shared through a
    // local closure. `consider` used to be an arrow function here, and because
    // it ASSIGNS `bestTier`/`bestWeight`/`bestCount`/`best`, V8 has to box those
    // four locals in a context object and allocate a closure over it on every
    // call — on a per-contested-cell-per-sub-step path. Two copies of four
    // lines is the price of the loop staying allocation-free.

    for (let p = this.occHead[cell] as number; p !== -1; p = this.occNext[p] as number) {
      if (this.uStanding[p] !== 1) continue;
      this.partStamp[p] = this.partGen;
      this.partBuf[n++] = p;
      const tier = this.uTier[p] as number;
      const weight = this.uWeight[p] as number;
      if (tier > bestTier || (tier === bestTier && weight > bestWeight)) {
        bestTier = tier;
        bestWeight = weight;
        bestCount = 1;
        best = p;
      } else if (tier === bestTier && weight === bestWeight) {
        bestCount++;
      }
    }
    // The persistent pile: everything that has already taken part in a fatal
    // contest here, alive or dead.
    if (this.pileStamp[cell] === this.pileGen) {
      const w0 = cell * this.maskWords;
      for (let w = 0; w < this.maskWords; w++) {
        let bits = this.pileMask[w0 + w] as number;
        while (bits !== 0) {
          const b = bits & -bits;
          bits ^= b;
          const p = w * 32 + bitIndex(b);
          if (this.partStamp[p] === this.partGen) continue;
          this.partStamp[p] = this.partGen;
          this.partBuf[n++] = p;
          const tier = this.uTier[p] as number;
          const weight = this.uWeight[p] as number;
          if (tier > bestTier || (tier === bestTier && weight > bestWeight)) {
            bestTier = tier;
            bestWeight = weight;
            bestCount = 1;
            best = p;
          } else if (tier === bestTier && weight === bestWeight) {
            bestCount++;
          }
        }
      }
    }
    // A FROZEN CLAIM IS NOT A PARTICIPANT IN THIS CONTEST (V2 BUG-1, the other
    // half). This branch used to fold the neck argument's certain cell in as a
    // head-to-head contestant at `(tierMax, weightMax)`, and both parts of that
    // were wrong:
    //
    //   · WRONG RULE. A certain cell in a resolution is always a living trail
    //     unit's BODY segment — `certain` at turnsHeld n covers freeze indices
    //     i ≤ k−1−n, which sit at body index i+n ≥ 1 — and the rules answer a
    //     body encounter by TIER ONLY (c5), never by a cell contest. Deciding
    //     it on weight let a heavy mover WIN a cell the rules say kills it, and
    //     let a light one LOSE a cell the rules say kills it too. It is
    //     adjudicated in the body tier now, where c5 already lives.
    //
    //   · WRONG CERTAINTY. `certain` is CERTAIN-CONDITIONAL-ON-ALIVE, stated at
    //     cloud.ts's own field: while `deathPossible` holds, no verdict layer
    //     may read a certain cell as presence "yes". The ledger already obeyed
    //     that (it records the cell as a maybe); the adjudicator did not, so the
    //     two halves of one resolution disagreed about the same cell.
    //
    // Nobody to contest: an arriver alone on an empty cell neither stops nor dies.
    if (n < 2) return;

    const unique = bestCount === 1;
    const survivorStanding = unique && best >= 0 && this.uStanding[best] === 1;
    // Display text only: a contest with several units at the top tier was
    // settled on weight, one with a single unit there on tier.
    let atMaxTier = 0;
    for (let k = 0; k < n; k++) {
      if ((this.uTier[this.partBuf[k] as number] as number) === bestTier) atMaxTier++;
    }
    const reason = !unique ? REASON.tie : atMaxTier > 1 ? REASON.weight : REASON.tier;
    const players: number[] = [];
    const victims: number[] = [];
    for (let k = 0; k < n; k++) {
      const p = this.partBuf[k] as number;
      players.push(this.idOf(base, p));
      // Every participant keeps wrestling for this cell for the rest of the turn.
      this.pileAdd(cell, p);
      if (unique && p === best) {
        if ((this.uPathLen[p] as number) > s) this.pendStop[p] = 1; // capture-stop
        continue;
      }
      // Only a STANDING participant can be a victim. The pile's dead are
      // named as participants — they are what makes the contest cumulative —
      // but they have already died once and do not die again.
      if (this.uStanding[p] !== 1) continue;
      victims.push(this.idOf(base, p));
      if (this.pendKill[p] === -1) {
        this.pendKill[p] = cell;
        this.pendCause[p] = C_CONTEST;
      }
    }
    this.clash(
      "contest",
      cell,
      s,
      players,
      victims,
      reason,
      survivorStanding ? this.idOf(base, best) : undefined,
    );
  }

  /** Every LIVING trail owner whose body covers `cell`, excluding `self`. */
  private ownersAt(state: StateHandle, cell: number, self: number): number {
    const owner = this.bodyOwner[cell] as number;
    let n = 0;
    if ((this.bodyCount[cell] as number) <= 1) {
      if (owner === self || this.uBodyAlive[owner] !== 1) return 0;
      this.ownerBuf[0] = owner;
      return 1;
    }
    const arena = this.unitArena;
    const base = this.uBase(state.slab);
    for (let k = 0; k < this.config.maxUnits; k++) {
      if (k === self || this.uBodyAlive[k] !== 1) continue;
      const o = base + k * U_FIELDS;
      if (!profileOf(arena[o + U_KIND] as UnitKind).leavesTrail) continue;
      if (this.cutIndexOf(state, k, cell) >= 1) this.ownerBuf[n++] = k;
    }
    return n;
  }

  /** Where in a trail unit's body `cell` sits — the sever cut index, or -1. */
  private cutIndexOf(state: StateHandle, owner: number, cell: number): number {
    if ((this.bodyCount[cell] as number) <= 1 && this.bodyOwner[cell] === owner) {
      return this.bodyIdx[cell] as number;
    }
    const arena = this.unitArena;
    const t = this.trailBase(state.slab, owner);
    const len = arena[this.uBase(state.slab) + owner * U_FIELDS + U_LEN] as number;
    for (let j = 1; j < len; j++) {
      if (arena[t + j] === cell) return j;
    }
    return -1;
  }

  /** Register one unit as a permanent participant in a cell's contest. */
  private pileAdd(cell: number, slot: number): void {
    const w0 = cell * this.maskWords;
    if (this.pileStamp[cell] !== this.pileGen) {
      this.pileStamp[cell] = this.pileGen;
      for (let w = 0; w < this.maskWords; w++) this.pileMask[w0 + w] = 0;
    }
    this.pileMask[w0 + ((slot / 32) | 0)] =
      (this.pileMask[w0 + ((slot / 32) | 0)] as number) | (1 << (slot & 31));
  }

  /** Frozen-tier-then-frozen-weight, the game's one comparison. */
  private compare(i: number, j: number): number {
    const ti = this.uTier[i] as number;
    const tj = this.uTier[j] as number;
    if (ti !== tj) return ti < tj ? -1 : 1;
    const wi = this.uWeight[i] as number;
    const wj = this.uWeight[j] as number;
    if (wi !== wj) return wi < wj ? -1 : 1;
    return 0;
  }

  // ---- sub-step c: apply ----

  private applyBatch(
    state: StateHandle,
    field: CloudField,
    anyFrozen: boolean,
    s: number,
  ): SlotMask {
    const arena = this.unitArena;
    const base = this.uBase(state.slab);
    const U = this.config.maxUnits;
    let soft = 0;
    for (let i = 0; i < U; i++) {
      const cut = this.pendSever[i] as number;
      if (cut < 0) continue;
      // Severed segments REMAIN blocking for the rest of the collision phase; the
      // truncation applies at end of turn, and the LOWEST cut wins — deepest bite.
      const prior = this.uSever[i] as number;
      if (prior === -1 || cut < prior) this.uSever[i] = cut;
    }
    for (let i = 0; i < U; i++) {
      const cell = this.pendKill[i] as number;
      if (cell === -1 || this.uStatus[i] === S_DEAD) continue;
      // A death removes nothing from the board: the unit lies exactly where it
      // is, and its whole remaining occupancy — plus the cell it died on, which
      // for a wrestled cell need not be under its head at all — becomes durable
      // collision material for the rest of the turn.
      const t = this.trailBase(state.slab, i);
      const o = base + i * U_FIELDS;
      this.uStatus[i] = S_DEAD;
      this.deaths.push({
        unitId: arena[o + U_ID] as number,
        cell,
        subStep: s,
        cause: CAUSE_NAMES[this.pendCause[i] as number] as ClashKind,
      });
      this.pileAdd(cell, i);
      const len = arena[o + U_LEN] as number;
      for (let j = 0; j < len; j++) this.pileAdd(arena[t + j] as number, i);
      if (anyFrozen && bbTest(field.unionCertain, cell)) {
        // A live unit contested a cell the neck argument claims. This branch
        // stops trusting that claim from here on: shrinking certainty is safe.
        const fs = field.certainAt(cell);
        if (fs >= 0) soft |= 1 << fs;
      }
    }
    for (let i = 0; i < U; i++) {
      if (this.pendStop[i] === 1 && this.uStatus[i] === S_ACTIVE) this.uStatus[i] = S_STOPPED;
    }
    soft |= this.pendSoftFrozen;
    this.pendSoftFrozen = 0;
    return soft;
  }

  // ---- sub-step d: health ----

  private healthPhase(state: StateHandle, s: number): void {
    const arena = this.unitArena;
    const base = this.uBase(state.slab);
    const U = this.config.maxUnits;
    for (let i = 0; i < U; i++) {
      if (this.uStatus[i] === S_DEAD) continue;
      const o = base + i * U_FIELDS;
      if (arena[o + U_STATUS] !== Standing.Alive) continue;
      // ENTERED means the advance completed this sub-step — a capture-stop,
      // an edge win or a sever stop still entered the cell it halted on and
      // pays for it; only an edge LOSER (reverted, never arrived) and units
      // stopped in EARLIER sub-steps are exempt. Reading `uStatus` here was
      // the bug Bot B's revalidation found: the batch marks winners
      // `stopped` before health runs, leaving every capture one health
      // too strong.
      const entered = this.uAdvanced[i] === 1;
      const head = arena[this.trailBase(state.slab, i)] as number;
      // Per cell ENTERED, at the kind's own rate — the one number the mover
      // and the cloud's reach cap both read (grammar.ts costPerCell).
      let cost = entered ? (this.uCost[i] as number) : 0;
      // A unit that does not move at all still pays one stationary hazard dose,
      // at sub-step 1.
      const stationary = s === 1 && (this.uPathLen[i] as number) === 0;
      if ((entered || stationary) && bbTest(this.terrain.hazard, head)) {
        cost += this.config.hazardDamage;
      }
      if (cost === 0) continue;
      const next = (this.uHealth[i] as number) - cost;
      this.uHealth[i] = next;
      if (next <= 0 && this.uStatus[i] === S_ACTIVE) {
        // Exhaustion is provisional death: it halts movement and nothing else.
        // The unit stays a fully live collision incumbent for the rest of the
        // phase, and may recover in the food phase. The halt record goes out
        // now with an EMPTY victimIDs; end of turn fills it in only if the unit
        // is still at zero once food has been eaten.
        this.uStatus[i] = S_EXHAUSTED;
        const onHazard = bbTest(this.terrain.hazard, head);
        const clash = this.clash(
          onHazard ? "hazard" : "exhaustion",
          head,
          s,
          [arena[o + U_ID] as number],
          [],
          onHazard ? REASON.hazard : REASON.exhaustion,
        );
        this.haltRecord[i] = { clash, cell: head, subStep: s };
      }
    }
  }

  // ---- end of turn ----

  private endOfTurn(
    state: StateHandle,
    field: CloudField,
    anyFrozen: boolean,
    subSteps: number,
  ): void {
    const arena = this.unitArena;
    const base = this.uBase(state.slab);
    const U = this.config.maxUnits;
    const slab = state.slab;
    const fb = this.foodBase(slab);

    // 1. the collision dead leave the board; severs truncate the survivors.
    //    Only NOW does a sever cut anything: a severed segment blocked for the
    //    whole collision phase, and the cells it loses are reported so a
    //    consumer can price the partial loss.
    for (let i = 0; i < U; i++) {
      const o = base + i * U_FIELDS;
      if (arena[o + U_STATUS] !== Standing.Alive) continue;
      if (this.uStatus[i] === S_DEAD) {
        arena[o + U_STATUS] = Standing.Gone;
        continue;
      }
      const cut = this.uSever[i] as number;
      if (cut >= 0) {
        const t = this.trailBase(slab, i);
        const len = arena[o + U_LEN] as number;
        if (len > cut) {
          const removed: number[] = [];
          for (let j = cut; j < len; j++) {
            const c = arena[t + j] as number;
            if (!removed.includes(c)) removed.push(c);
          }
          this.severed.set(arena[o + U_ID] as number, removed);
        }
        arena[o + U_LEN] = cut;
        arena[o + U_WEIGHT] = cut;
        if (cut === 0) arena[o + U_STATUS] = Standing.Gone;
      }
    }

    // 2. food and growth, exhausted units included — the mechanism by which an
    //    exhausted unit recovers.
    for (let i = 0; i < U; i++) {
      const o = base + i * U_FIELDS;
      if (arena[o + U_STATUS] !== Standing.Alive) continue;
      const t = this.trailBase(slab, i);
      const head = arena[t] as number;
      const word = fb + (head >>> 5);
      const bit = 1 << (head & 31);
      if (((this.boardArena[word] as number) & bit) === 0) continue;
      this.boardArena[word] = (this.boardArena[word] as number) & ~bit;
      // A meal restores to the EATER'S kind's maximum, not to a game-wide one:
      // the game configures `maxHealthPerUnit` and the vendored resolver reads
      // `input.maxHealth[type]` here, so a flat number diverges from the rules
      // on the first bite a low-maximum unit takes.
      this.uHealth[i] = this.maxHealthOf(arena[o + U_KIND] as UnitKind);
      const len = arena[o + U_LEN] as number;
      if (profileOf(arena[o + U_KIND] as UnitKind).leavesTrail && len < this.config.maxTrail) {
        arena[t + len] = arena[t + len - 1] as number;
        arena[o + U_LEN] = len + 1;
      }
      arena[o + U_WEIGHT] = (arena[o + U_WEIGHT] as number) + 1;
      // Channel 6: a frozen unit whose claim reaches this cell might have eaten
      // here first, which changes what this unit is now worth.
      if (anyFrozen && bbTest(field.unionEver, head)) {
        this.record(
          0,
          head,
          arena[o + U_ID] as number,
          i,
          field.everAt(head),
          Channel.Item,
          false,
          false,
        );
      }
    }

    // 3. exhaustion settled: anything still at or below zero dies where it halted.
    // 4. orientation rewrite, for the survivors only.
    // 5. promotion: a promoting kind at or past the configured weight becomes
    //    its promoted kind, RESETTING to weight 1 and keeping its orientation
    //    (docs/chess-pieces.md end-of-turn order; adjudication only ever reads
    //    the post-promotion board next turn, because tier/weight are frozen).
    for (let i = 0; i < U; i++) {
      const o = base + i * U_FIELDS;
      if (arena[o + U_STATUS] !== Standing.Alive) continue;
      // The ceiling is an input sanitizer, not a rule of the turn: health only
      // ever falls during a turn, and only the food phase above raises it — to
      // exactly this number. It bites solely on a unit CREATED above its own
      // kind's maximum.
      arena[o + U_HEALTH] = Math.min(
        this.maxHealthOf(arena[o + U_KIND] as UnitKind),
        this.uHealth[i] as number,
      );
      if ((this.uHealth[i] as number) <= 0) {
        arena[o + U_STATUS] = Standing.Gone;
        // Exhaustion stops being provisional. The halt record it wrote gets its
        // victim now; a unit food brought back above zero leaves that record
        // empty, saying only why it stopped short.
        const halt = this.haltRecord[i];
        const id = arena[o + U_ID] as number;
        if (halt !== undefined && halt !== null) {
          halt.clash.victimIDs = [id];
          this.deaths.push({
            unitId: id,
            cell: halt.cell,
            subStep: halt.subStep,
            cause: halt.clash.kind,
          });
        } else {
          this.deaths.push({
            unitId: id,
            cell: arena[this.trailBase(slab, i)] as number,
            subStep: subSteps,
            cause: "exhaustion",
          });
        }
        continue;
      }
      if ((this.uPathLen[i] as number) > 0) {
        // A unit that moved faces the direction of its FIRST step; one that held
        // keeps the orientation it had — and a rotator faces where it turned to.
        arena[o + U_ORIENT] = orientationToward(
          this.grid,
          this.uStartHead[i] as number,
          this.uPath[i * this.maxPath] as number,
        );
      } else if ((this.uRotate[i] as number) >= 0) {
        arena[o + U_ORIENT] = this.uRotate[i] as number;
      }
      const profile = profileOf(arena[o + U_KIND] as UnitKind);
      if (
        profile.promotesTo !== null &&
        (arena[o + U_WEIGHT] as number) >= this.config.pawnPromotionWeight
      ) {
        arena[o + U_KIND] = profile.promotesTo;
        arena[o + U_WEIGHT] = 1;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Uncertainty overlay
  // -------------------------------------------------------------------------

  /**
   * A live unit touched cell `c`. If any frozen unit's claim reaches it, that is
   * an entanglement — the optimistic timeline treated the cell as empty (or, for
   * a certain claim, as occupied), and the truth may differ.
   *
   * The FAST PATH is the whole point: one bit test against the field's union.
   * Most cells a search touches are nowhere near a frozen unit, and those cost
   * 1.4 ns and produce nothing.
   */
  private noteCellUncertainty(
    id: number,
    i: number,
    cell: number,
    s: number,
    field: CloudField,
    channel: Channel,
  ): void {
    if (!bbTest(field.unionEver, cell)) return;
    // A cloud is a claim about a TURN, so the same unit standing on the same cell
    // at seven sub-steps of one ray is one fact, not seven. Deduplicating here
    // keeps the ledger a work list rather than a transcript.
    const bit = 1 << i;
    if (this.notedStamp[cell] !== this.turnGen) {
      this.notedStamp[cell] = this.turnGen;
      this.notedMask[cell] = 0;
    } else if (((this.notedMask[cell] as number) & bit) !== 0) {
      return;
    }
    this.notedMask[cell] = (this.notedMask[cell] as number) | bit;
    const maybe = field.maybeAt(cell);
    const ever = field.everAt(cell);
    const certainSlot = bbTest(field.unionCertain, cell) ? field.certainAt(cell) : -1;
    const certainBit = certainSlot >= 0 ? 1 << certainSlot : 0;

    // Split what MIGHT be here into "its arriving front could be here"
    // (a contest) and "only its trail could be here" (a body block) — and, in
    // the SAME pass, decide PER ROLE whether the frozen unit could beat this
    // mover at this cell.
    //
    // THE ROLES ARE ALTERNATIVES AND EACH HAS ITS OWN COMPARATOR (V2 BUG-1).
    // A head-to-head contest is tier-then-weight; a LIVING BODY is tier only
    // (the rules' c5: `mover.tier <= maxOwnerTier` condemns, weight never
    // enters). One cell can admit BOTH — a snake's front can reach the cell its
    // own neck occupies — and the verdict is then the meet over both, so
    // reading only the head comparator let a mover that out-weighed the owner
    // come back unthreatened and the FLOOR priced it alive.
    const headMask = this.uBeatenBy[i] as number;
    // The slots the BODY rule ADDS over the contest comparator: trail units at
    // the mover's own tier that it out-weighs. Empty on most boards, which is
    // what keeps the second bit test off the hot path entirely.
    const bodyOnly = this.uBodyBeatenBy[i] as number;
    let front = 0;
    let beat = 0;
    // THIS `for...of` IS NOT AN ALLOCATION, AND IT HAS BEEN MEASURED.
    //
    // A downstream profile put a quarter of the system's SURVIVING bytes on
    // this function and named the array iterator here as the suspect, on the
    // reasoning that V8 escape-analyses such an iterator only when it inlines
    // the loop. Rewritten as `for (let k = 0; k < slots.length; k++)` and A/B'd
    // over 20 000 resolutions of a 23×23 board with twelve frozen claims, the
    // engine allocated 35 751 bytes a resolution against 35 753 — no
    // difference at all, and none in the collection count either. Turbofan
    // does eliminate it. The surviving bytes the profile saw here are the
    // ENTANGLEMENT ENTRIES, which `record` allocates and which show up on this
    // frame whenever `record` is inlined into it.
    //
    // Left in the iterating form it reads best in. If you are here to make the
    // overlay cheaper, the ledger is the thing to attack, and its cost is its
    // published shape, not its loops.
    for (const slot of field.slots) {
      const bit = 1 << slot.slot;
      if ((maybe & bit) === 0) continue;
      if (bbTest(slot.cloud.headPossible, cell) && bit !== certainBit) front |= bit;
      // A corpse at this cell wrestles at frozen strength, so the contest
      // comparator is a live alternative wherever the claim reaches — no role
      // test needed for it.
      if ((headMask & bit) !== 0) {
        beat |= bit;
        continue;
      }
      if ((bodyOnly & bit) !== 0 && bbTest(slot.cloud.bodyPossible, cell)) beat |= bit;
    }
    const trailOnly = maybe & ~certainBit & ~front;
    if (front !== 0) this.record(s, cell, id, i, front, channel, false, (beat & front) !== 0);
    if (trailOnly !== 0) {
      this.record(s, cell, id, i, trailOnly, Channel.BodyBlock, false, (beat & trailOnly) !== 0);
    }
    // Cells a frozen unit might have died on keep fighting for the rest of the
    // turn even when it is certainly no longer standing there. That is the
    // WRESTLING rule and it contests at frozen strength — tier then weight —
    // so the pile keeps the head comparator.
    const corpses = ever & ~maybe & ~certainBit;
    if (corpses !== 0) {
      this.record(
        s,
        cell,
        id,
        i,
        corpses,
        Channel.Durable,
        false,
        this.couldBeat(field, corpses, i),
      );
    }
    if (certainBit !== 0) {
      const slot = field.bySlot(certainSlot);
      if (slot === undefined) return;
      // A certain cell in a RESOLUTION is always a living trail unit's body
      // segment — `certain` at turnsHeld n covers freeze indices i ≤ k−1−n,
      // which sit at body index i+n ≥ 1 — so `beat` has already read it through
      // the body comparator. The corpse alternative (the owner died here) is a
      // wrestle at frozen strength, hence the head comparator as well.
      const certainBeat = ((beat | headMask) & certainBit) !== 0;
      // ONE GATE, SHARED WITH THE ADJUDICATOR. It used to be the claim's own
      // `deathPossible`, which reads only one of the three ways an owner can
      // die (see `markUnconditionalClaims`) — so the adjudicator stood the
      // claim up while the ledger called the same cell a maybe, and one
      // resolution said two things about one cell. A slot the branch may read
      // as present needs no entry: the timeline placed it, and nothing could
      // have moved it. Everything else is a maybe, and is recorded.
      if ((this.unconditionalClaims & certainBit) === 0) {
        this.record(s, cell, id, i, certainBit, channel, true, certainBeat);
      }
      // Even a unit that is certainly here has an uncertain STRENGTH; a contest
      // its interval straddles was decided on a reading, not a fact.
      if (!decisive(slot.bounds, this.uTier[i] as number, this.uWeight[i] as number)) {
        this.record(s, cell, id, i, certainBit, Channel.Strength, true, true);
      }
    }
  }

  /**
   * WHICH CLAIMS THIS BRANCH MAY READ AS PRESENT.
   *
   * `certain` is CERTAIN-CONDITIONAL-ON-ALIVE (cloud.ts states it at the
   * field): the cells are occupied in every continuation where the owner is
   * still alive. Reading them as presence "yes" is therefore only legitimate
   * when the owner CANNOT have died — and that is three questions, not one:
   *
   *   1. could it kill itself? `cloud.deathPossible` — a wall, a hazard, its
   *      own body, running out of health. This is the only one the claim can
   *      answer, because a cloud is branch-independent by construction.
   *   2. could something MODELLED kill it? A trail unit dies by meeting a mover
   *      with its HEAD — a cell contest, an edge exchange, or running into a
   *      mover's body — so the question is whether this turn's modelled reach
   *      touches the claim's arriving front. It is emphatically NOT "does a
   *      mover stand on the claim": a mover that arrives on a living BODY dies
   *      to it (c5) and cannot kill its owner, which is exactly the case the
   *      neck argument was invented for.
   *   3. could another FROZEN unit kill it? Two overlapping claims can settle
   *      each other while nobody is watching. Backlog item 7 is the general
   *      form; here it is cheap to be conservative and simply refuse
   *      unconditional status to any claim whose front another claim reaches.
   *
   * A slot outside this mask is a maybe for the whole turn: the optimistic
   * timeline steps around its certain cells and the ledger carries them. That
   * is a widening, so it is always sound; the mask exists to keep the PRECISION
   * the neck argument buys where the argument actually holds.
   */
  private markUnconditionalClaims(field: CloudField): void {
    const w = this.grid.words;
    let mask = 0;
    for (const slot of field.slots) {
      if ((field.unconditionalCandidates & (1 << slot.slot)) === 0) continue;
      const cloud = slot.cloud;
      if (bbIntersects(cloud.headPossible, this.planFootprint, w)) continue;
      let met = false;
      for (const other of field.slots) {
        if (other.slot === slot.slot) continue;
        if (bbIntersects(other.cloud.everPossible, cloud.headPossible, w)) {
          met = true;
          break;
        }
      }
      if (!met) mask |= 1 << slot.slot;
    }
    this.unconditionalClaims = mask;
  }

  /** Channel 3: my head crossed a→b; could a frozen unit have crossed b→a? */
  private noteEdgeUncertainty(
    id: number,
    i: number,
    from: number,
    to: number,
    s: number,
    field: CloudField,
    startField: CloudField,
  ): void {
    // An exchange is a crossing IN THIS TURN: the frozen unit has to have been at
    // `to` when the turn began and at `from` when it ended. That needs both
    // clouds, which is the one place the start-of-turn claim is the right one —
    // and the timeline memoized both, so it is two bit tests, not a computation.
    if (from === to || !bbTest(startField.unionPossible, to)) return;
    const here = startField.maybeAt(to);
    if (here === 0) return;
    let mask = 0;
    for (const slot of field.slots) {
      const bit = 1 << slot.slot;
      if ((here & bit) === 0) continue;
      if (!profileOf(slot.record.kind).traversesEdges) continue;
      if (bbTest(slot.cloud.headPossible, from)) mask |= bit;
    }
    if (mask !== 0) {
      this.record(s, to, id, i, mask, Channel.Edge, false, this.couldBeat(field, mask, i));
    }
  }

  /**
   * Could any of these frozen units have beaten live unit `i`? Strength is frozen
   * for the whole turn on both sides, so the answer is a turn constant per unit,
   * computed once during planning and read here as one AND.
   */
  /**
   * THE TWO COMPARATORS A FROZEN CLAIM CAN BE MET WITH, in one pass over the
   * slots because both are turn constants for the unit and the pass is per
   * mover.
   *
   * `uBeatenBy` — a CELL CONTEST: head against head, or a wrestle against
   * durable pile material. Tier first, then weight, exactly as the resolver's
   * own comparator.
   *
   * `uBodyBeatenBy` — a LIVING BODY, AND WEIGHT DOES NOT ENTER IT. The rules'
   * body rule (the vendored resolver's c5) condemns an arrival on a living
   * trail unit's body segment when `mover.tier <= maxOwnerTier`; strictly
   * higher tier severs and capture-stops. There is no weight comparison
   * anywhere in it, so at tier parity — every board in production today —
   * stepping onto an enemy snake's body is unconditionally fatal for the
   * entrant, however heavy it is.
   *
   * Reading a body encounter through the contest comparator let a mover that
   * out-weighed the owner come back "could not be beaten", so it was never
   * marked Contingent and the FLOOR priced it alive — a floor above the truth
   * in precisely the situation a heavy unit is most tempted to enter, attacking
   * a lighter enemy (V2 BUG-1).
   *
   * The body mask is a SUPERSET of the contest one (`tierMax >= tier` is
   * implied by either of its disjuncts), restricted to the slots that have a
   * body at all. So using it where the body rule applies can only ever ADD
   * contingency: floors down, ceilings up, the sound direction on both sides.
   */
  private beatMasksInto(
    field: CloudField,
    i: number,
    tier: number,
    weight: number,
    trailSlots: SlotMask,
  ): void {
    let head = 0;
    let body = 0;
    for (const slot of field.slots) {
      const b = slot.bounds;
      const bit = 1 << slot.slot;
      if (b.tierMax > tier || (b.tierMax === tier && b.weightMax >= weight)) head |= bit;
      if (b.tierMax >= tier) body |= bit;
    }
    this.uBeatenBy[i] = head;
    // The DIFFERENCE, not the mask: the hot per-cell loop only ever asks which
    // slots the body rule ADDS, and this way it asks with one array read.
    this.uBodyBeatenBy[i] = body & trailSlots & ~head;
  }

  private couldBeat(_field: CloudField, mask: SlotMask, i: number): boolean {
    return (mask & (this.uBeatenBy[i] as number)) !== 0;
  }

  private currentTurn = 0;

  /**
   * `slot` is the live unit's SLOT, and it is not on the entry — it is here so
   * that "somebody could have beaten this unit" can be marked as it is
   * discovered, on a stamped column, instead of being re-derived by
   * `fatesFrom` walking the whole ledger into a `Set` keyed by unit id.
   * Slot and id are in bijection for the life of a resolution, so the two
   * formulations name the same set.
   */
  private record(
    subStep: number,
    cell: number,
    liveId: number,
    slot: number,
    frozen: SlotMask,
    channel: Channel,
    assumedPresent: boolean,
    couldBeat: boolean,
  ): void {
    if (couldBeat) this.threatStamp[slot] = this.turnGen;
    this.ledger.push({
      turn: this.currentTurn,
      subStep,
      cell,
      liveId,
      frozen,
      channel,
      assumedPresent,
      couldBeat,
    });
  }

  private fatesFrom(base: number): UnitFate[] {
    const arena = this.unitArena;
    const U = this.config.maxUnits;
    const out: UnitFate[] = [];
    // The threat set is accumulated by `record` on a generation-stamped column
    // (see there). It used to be rebuilt here by walking the whole ledger into
    // a `Set` — one pass over every entanglement of the turn, plus the Set's
    // own table growth, on every resolution. The empty-ledger fast path it was
    // written around is now simply the general case: nothing recorded, nothing
    // stamped, nothing to read.
    const gen = this.turnGen;
    for (let i = 0; i < U; i++) {
      const o = base + i * U_FIELDS;
      const standing = arena[o + U_STATUS];
      if (standing === Standing.Empty) continue;
      const id = arena[o + U_ID] as number;
      const fate =
        standing === Standing.Alive
          ? this.threatStamp[i] === gen
            ? Fate.Contingent
            : Fate.Alive
          : Fate.Dead;
      out.push({ unitId: id, fate });
    }
    return out;
  }
}

/** A clash while the resolver still owns it; `Clash` is the read-only view. */
interface MutableClash {
  index: number;
  subStep: number;
  kind: ClashKind;
  playerIDs: number[];
  victimIDs: number[];
  survivorID?: number;
  reason: string;
}

/** Cause codes, indexes into `CAUSE_NAMES`. Kept numeric for the scratch arrays. */
const C_CONTEST = 0;
const C_EDGE = 1;
const C_BODYBLOCK = 2;
const C_WALL = 3;
const C_SELF = 4;
const CAUSE_NAMES = ["contest", "edge", "bodyBlock", "wall", "self"] as const;

const ascending = (a: number, b: number): number => a - b;

/**
 * SORTING A HANDFUL WITHOUT `Array.prototype.sort`.
 *
 * V8's sort is TimSort, and TimSort allocates a work array on EVERY call
 * whatever the length. A clash carries one or two ids, and a turn's whole clash
 * list is usually under ten, so the library sort's fixed cost is paid thousands
 * of times a second to order two numbers. Measured on a 23×23 piece board, the
 * two `sort` calls inside `clash` alone were 14% of everything the resolver
 * allocated — more than the entanglement ledger.
 *
 * Insertion sort is STABLE, so for any total preorder it produces exactly the
 * order TimSort does, element for element; the swap is invisible to every
 * caller. It is also quadratic, so past a handful the library sort is the
 * better algorithm and its work array is amortised over real comparisons —
 * hence the cutoff rather than a wholesale replacement.
 */
const SMALL_SORT_MAX = 16;

/** Ascending ids, in place. Returns the same array, as `sort` does. */
function sortIds(a: number[]): number[] {
  const n = a.length;
  if (n < 2) return a;
  if (n > SMALL_SORT_MAX) return a.sort(ascending);
  for (let i = 1; i < n; i++) {
    const v = a[i] as number;
    let j = i - 1;
    while (j >= 0 && (a[j] as number) > v) {
      a[j + 1] = a[j] as number;
      j--;
    }
    a[j + 1] = v;
  }
  return a;
}

/** As `sortIds`, over a caller's comparator. Stable, like the sort it replaces. */
function sortSmall<T>(a: T[], cmp: (x: T, y: T) => number): void {
  const n = a.length;
  if (n < 2) return;
  if (n > SMALL_SORT_MAX) {
    a.sort(cmp);
    return;
  }
  for (let i = 1; i < n; i++) {
    const v = a[i] as T;
    let j = i - 1;
    while (j >= 0 && cmp(a[j] as T, v) > 0) {
      a[j + 1] = a[j] as T;
      j--;
    }
    a[j + 1] = v;
  }
}

// Hoisted out of `settleRecords`: a comparator written at the call site is a
// fresh closure on every resolution, and these two are pure.
const byClashOrder = (a: Clash, b: Clash): number =>
  a.subStep - b.subStep ||
  a.index - b.index ||
  (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
  cmpIds(a.playerIDs, b.playerIDs);

const byDeathOrder = (a: DeathRecord, b: DeathRecord): number =>
  a.subStep - b.subStep || a.unitId - b.unitId;

/**
 * The turn a hold's record was OBSERVED at. Defaults to now; a supplied value
 * must not be in the future, because a claim stamped later than the truth is a
 * narrower cloud than the facts support.
 */
function observedAt(supplied: number | undefined, now: number, unitId: number): number {
  if (supplied === undefined) return now;
  if (!Number.isInteger(supplied) || supplied > now) {
    throw new Error(
      `hold: heldAtTurn ${supplied} for unit ${unitId} is not a whole turn at or before the current turn ${now} — a claim cannot be fresher than the observation behind it`,
    );
  }
  return supplied;
}

/** Lexicographic over two ascending id lists — the clash sort's last tiebreak. */
function cmpIds(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  }
  return a.length - b.length;
}

/** log2 of a single set bit. */
function bitIndex(b: number): number {
  return 31 - Math.clz32(b);
}

/**
 * Whether a strength interval separates cleanly from a known strength: the
 * comparison must come out the same way against BOTH ends, and must not be a tie
 * at either. Anything else is a contest decided on a reading rather than a fact.
 */
function decisive(b: StrengthBounds, tier: number, weight: number): boolean {
  const lo = cmpPair(tier, weight, b.tierMin, b.weightMin);
  const hi = cmpPair(tier, weight, b.tierMax, b.weightMax);
  return lo === hi && lo !== 0;
}

function cmpPair(t1: number, w1: number, t2: number, w2: number): number {
  if (t1 !== t2) return t1 < t2 ? -1 : 1;
  if (w1 !== w2) return w1 < w2 ? -1 : 1;
  return 0;
}

/** The orientation a unit ends the turn facing: the direction of its first step. */
function orientationToward(grid: Grid, from: number, to: number): number {
  const dx = (to % grid.width) - (from % grid.width);
  const dy = ((to / grid.width) | 0) - ((from / grid.width) | 0);
  if (dx === 0 && dy < 0) return 0;
  if (dx > 0 && dy === 0) return 1;
  if (dx === 0 && dy > 0) return 2;
  if (dx < 0 && dy === 0) return 3;
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
}
