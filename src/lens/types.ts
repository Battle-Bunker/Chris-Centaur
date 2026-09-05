/**
 * THE DECISION LENS — every name the three tracks share, and nothing else.
 *
 * `docs/design/decision-lens/05-BUILD-ORDER.md` §(b): this file lands ONCE, at
 * L1, before the fork into K (kernel, L2-L3), D (storage, L4) and U (UI, L5),
 * and is **frozen for the duration of the fork**. All three tracks name
 * `Moveset`, `ClusterView` and `TurnEvent`; a shared declaration landed before
 * the fork is the difference between three tracks and three merge conflicts. A
 * track that needs a change here opens it as a one-line commit every track
 * rebases onto — which happens once, or not at all if this file did its job.
 *
 * DECLARATIONS ONLY. No logic, no classes, no functions. The four manifest
 * constants are the sole runtime values, and they are data, not behaviour:
 * they are bot-manifest members, so changing one changes `botId` and every
 * stored row says which value produced it (04 §4.1).
 *
 * THE TWO NUMBERINGS, and the one place they meet (04 §2.2). `UnitId` is the
 * SUBSTRATE number — private to one decision, meaningless one turn later.
 * `UnitKey` is the WIRE id — stored, wired, displayed. `LensEvent` as the
 * kernel emits it carries `UnitId`; `TurnEvent` as stored carries `UnitKey`;
 * the `lens` sink translates at the kernel boundary, which is the one
 * translation point `pins.ts` already owns. A stored record carrying a
 * substrate number is a stored record that cannot be read one turn later.
 */

import type {
  Assumption,
  Bound,
  Candidate,
  CellIndex,
  EmitRecord,
  FeatureContribution,
  PinEvent,
  Posture,
  Turn,
  UnitId,
  VacuityCause,
  Witness,
} from '../lobster/contracts';
import type { BasisKey, LoudReading } from '../lobster/bounds';
import type { EmitRefusal } from '../lobster/kernel';
import type { ConfidenceOrder } from '../lobster/voc';
import type { BoardSnapshot } from '../types/battlesnake';

export type {
  Assumption,
  BasisKey,
  LoudReading,
  Bound,
  Candidate,
  CellIndex,
  ConfidenceOrder,
  EmitRecord,
  EmitRefusal,
  FeatureContribution,
  PinEvent,
  Posture,
  Turn,
  UnitId,
  VacuityCause,
  Witness,
};

// ---------------------------------------------------------------- constants

/**
 * Reservoir width, per `(clusterId, complementKey)` (01 §4.2, 03 §2.2).
 * Confirmed or changed against the O1 coverage curve at gate 9 (05 §d).
 */
export const LENS_TOPK = 5;

/** In-memory retained rows per decision, across every cluster (03 §2.2). */
export const LENS_ROW_CAP = 24;

/**
 * The per-team inspection reserve, carved BEFORE `searchDeadline` (04 §3 O5).
 * The search is unconditionally shorter by this much and inspection is
 * unconditionally affordable; no exchange rate between compute and attention
 * is ever computed. Sized at one `price()` — ~18 ms at 26 units — plus slack,
 * because a reserve smaller than one price serves nothing. Provisional until
 * the O1 run confirms it (05 §d, gate 9).
 */
export const LENS_INSPECTION_MS = 20;

/**
 * THE RANKING'S OWN CEILING — what a conditional ranking may spend BEYOND the
 * conform its own question needs, and the floor the ranking is guaranteed.
 *
 * MEASURED (07 §5). The first `conform` under a pin in a decision prices the
 * repair — 20 evaluator calls on `mixed`, which is `LENS_INSPECTION_MS`
 * exactly — and every conform after it is served by the bank's memo for
 * 0.02 work units and ZERO evaluations. So a reserve sized at one `price()`
 * is spent by the operator's question before the ranking of the rest of the
 * cluster has begun, and a ranking bounded by what the reserve has LEFT is a
 * ranking that never runs: the panel's list of one (10 §4 O1).
 *
 * One millisecond cannot buy a `price()` on any board this bot plays — 03
 * §3.1 measures one at ~18 ms at 26 units — so this floor cannot fund a
 * search; it funds the memo hits that turn one answer into a ranked table.
 * The inspection therefore spends at most `LENS_INSPECTION_MS + LENS_RANK_MS`,
 * declared before the turn starts exactly as the reserve is, and the search
 * deadline is not moved by a microsecond to pay for it.
 */
export const LENS_RANK_MS = 1;

/** `PlyStep`s retained per moveset — four alternations (06 §3.1). */
export const LENS_LINE_PLIES = 8;

// ----------------------------------------------------------------- identity

export type GameId = string;
/** The WIRE id of a unit. Stored, wired, displayed. Never a substrate number. */
export type UnitKey = string;
/** `planKey` of a whole joint plan, or of a cluster restriction (voc.ts). */
export type PlanKey = string;
/** `planKey` of a cluster restriction — the moves one `Moveset` row is about. */
export type MovesetKey = string;
/** NAME: the anchor, i.e. the smallest member's id. Survives a non-anchor
 *  member arriving or leaving. Names find; hashes validate (03 §1.5). */
export type ClusterId = number;
/** `${gameId}:${turn}:${seq}` (01 §5.2). */
export type EventId = string;
/** Correlates a `lens-conditional` / `lens-breakdown` ask with its answer. */
export type RequestId = string;
export type OperatorId = string;

/** The moment being inspected. Per CONNECTION, never per game (04 §3 O10). */
export interface Cursor {
  readonly gameId: GameId;
  readonly turn: Turn;
  readonly seq: number;
}

// ------------------------------------------------------------------ cluster

/** Why a unit is NOT a free variable this turn. Law F: a unit with any of
 *  these is drawn, is named in the basis, and is NOT a cluster member. */
export type FixityReason = 'pin' | 'commit' | 'reference' | 'pin-unreachable';

export interface BoundedUnit {
  readonly unit: UnitKey;
  readonly to: CellIndex;
  readonly why: FixityReason;
  /** Operator attribution (02 Rule E). Null when the server or the wire fixed it. */
  readonly by: OperatorId | null;
}

/**
 * A connected component of the occupancy-reach graph over `freeSet`
 * (04 §2.1). PLAIN component: there is no hub fiat, and no `hub` field — a
 * slider that genuinely couples two groups is already in one component with
 * both, and what the fiat adds over the geometry is coupling the geometry
 * says is not there.
 */
export interface ClusterView {
  readonly id: ClusterId;
  /** HASH: sorted members + basis. Validates a retained row; never a name. */
  readonly key: string;
  /** Bumps on ANY membership change (01 §2.2). One third of the fiber. */
  readonly generation: number;
  /** Ascending. The moveset's columns. */
  readonly members: ReadonlyArray<UnitKey>;
  /** Drawn, never varied. Law F. */
  readonly boundedBy: ReadonlyArray<BoundedUnit>;
  /** The cluster ids this one came from. Empty at the first partition. */
  readonly lineage: ReadonlyArray<ClusterId>;
  readonly epoch: number;
  readonly posture: Posture;
  readonly basis: BasisKey;
}

/** DERIVED by diffing successive partitions, never asserted (03 §1.5). */
export type ClusterEvent =
  | { readonly kind: 'split'; readonly from: ClusterId; readonly to: ReadonlyArray<ClusterId> }
  | { readonly kind: 'merge'; readonly from: ReadonlyArray<ClusterId>; readonly to: ClusterId }
  | { readonly kind: 'narrowed'; readonly id: ClusterId; readonly lost: ReadonlyArray<UnitKey> }
  | { readonly kind: 'widened'; readonly id: ClusterId; readonly gained: ReadonlyArray<UnitKey> };

// ------------------------------------------------------------------ verdict

/** [CHANGE 1] — `better()`'s own answer, carrying the refusal branch so the
 *  reservoir can store a `DominanceCondition`. This must change no decision:
 *  the reason is derived from comparisons the function already performs, in
 *  the order it already performs them. Gated on G2 (03 §2.2). */
export type VerdictReason = 'witness' | 'basis' | 'floor' | 'est' | 'hi' | 'tie';

export type Verdict =
  | { readonly accept: true }
  | { readonly accept: false; readonly because: VerdictReason };

/** WHY a row is not rank 1 — the `better()` branch read backwards (03 §2.4).
 *  Every input is a value the comparison already produced. */
export type DominanceCondition =
  | { readonly kind: 'leader' }
  | { readonly kind: 'refuted-by-witness'; readonly witness: Witness }
  | { readonly kind: 'incomparable-basis'; readonly theirs: ReadonlyArray<Assumption> }
  | {
      readonly kind: 'contingent';
      readonly onUnits: ReadonlyArray<UnitKey>;
      readonly atStake: number;
    }
  /** Margin on `lo`: this cannot win under any resolution of what we do not know. */
  | { readonly kind: 'dominated'; readonly by: number }
  /** The proved floors are equal and the leader won on the channel that never
   *  adjudicates — the most important row in the table. */
  | { readonly kind: 'advisory-only'; readonly estMargin: number }
  | { readonly kind: 'indifferent' };

// -------------------------------------------------------------------- depth

/** One reading of a moveset at one horizon (06 §2.1). The two readings are
 *  the row's NUMBER, and a number without its premise is the failure this
 *  whole lens exists to prevent — so they never truncate. */
export interface Reading {
  /** Proved at. NOT `EmitRecord.horizon`, which is structurally always 1. */
  readonly horizon: number;
  readonly lo: number;
  readonly est: number;
  readonly hi: number;
  readonly exact: boolean;
  readonly ledgerSize: number;
  /** The coordinate depth moves (06 §1.5). */
  readonly basis: BasisKey;
  readonly citedUnits: ReadonlyArray<UnitKey>;
  /** Kernel clock from t0 — one timeline. */
  readonly atMs: number;
  /** Slices spent reaching THIS reading. */
  readonly quanta: number;
}

export interface PlyStep {
  readonly ply: number;
  readonly side: 'ours' | 'theirs';
  /** For `theirs` these are the ARGMIN claim's actions, not observed moves.
   *  The set is the truth and the arrow is our pick from it (06 §2.3). */
  readonly moves: ReadonlyArray<{ readonly unit: UnitKey; readonly to: CellIndex }>;
  readonly lo: number;
  readonly hi: number;
  /** `|Divergence|` at this layer. Must fall monotonically down the column
   *  when the reading is derived; if it rises, `derived` is false. */
  readonly ledgerSize: number;
  /** A `HeldUnit.options` narrowing licensed this layer. */
  readonly narrowed: boolean;
  readonly witnessSeq: number | null;
}

/** The three-way attribution of the depth delta (06 §0, §1.4, §2.1):
 *  `Δ = Δ_width + Δ_terminal + Δ_residual`. The residual is NAMED and ALWAYS
 *  drawn, zero included — Law A applied a second time, to the delta itself. */
export interface DepthAttribution {
  readonly width: number;
  /** Present only when the line's leaf carries a terminal verdict. */
  readonly terminal: number;
  readonly residual: number;
}

/** The four numbers and the verdict that come off the pair of readings. */
export interface DepthDelta {
  /** `deepest.lo − h1.lo` — proof gained on the floor. */
  readonly lo: number;
  /** `deepest.hi − h1.hi` — optimism removed. */
  readonly hi: number;
  /** `(deepest.hi − deepest.lo) − (h1.hi − h1.lo)`; ≤ 0 whenever derived. */
  readonly width: number;
  /** `rankAtH1 − rank` — did depth move this row? */
  readonly rank: number;
  readonly attribution: DepthAttribution;
  /** Struck through when the complement is stale: the delta is a difference of
   *  two numbers under a complement that no longer holds. The READINGS stay —
   *  each was a real bracket of a real plan (06 §3.3 rule 5). */
  readonly voided: boolean;
}

/** Added to every `Moveset` (06 §3.1). On today's build every row reads
 *  `h1 ·` — the honest display of a bot that does not look ahead — and the
 *  absence of depth is drawn, never omitted. */
export interface DepthColumn {
  /** ALWAYS present. Captured once, on the row's first price, and never
   *  re-derived: recomputing it later would compute it under a different
   *  complement and the delta would be a difference between two questions. */
  readonly h1: Reading;
  /** `=== h1` when nothing deepened. */
  readonly deepest: Reading;
  /** `deepest` was obtained BY BACKUP from `h1`. False ⇒ hull, not
   *  intersection, and the panel says `hull, not derived` (Law H′). */
  readonly derived: boolean;
  /** Root to leaf; `[]` at h1. */
  readonly line: ReadonlyArray<PlyStep>;
  /** The `LENS_LINE_PLIES` bit: the line truncates, the readings never do. */
  readonly lineTruncated: boolean;
  readonly rankAtH1: number;
  /** `compareConfidence` (voc.ts) over `(horizon, slack)`. `incomparable` is
   *  deeper-but-looser and gets a glyph, not a rank. */
  readonly confidence: ConfidenceOrder;
  /** `'cap'` is unreachable while F-7 stands. */
  readonly terminal: 'none' | 'elimination' | 'cap';
  readonly delta: DepthDelta;
}

// ------------------------------------------------------------------ moveset

export type MovesetRung = 'seed' | 'sweep' | 'pair' | 'polish' | 'restart' | 'conform';

/** Whether this row's complement is still the incumbent's. Rows from two
 *  generations of complement are never in one list (Law E). */
export type ComplementFreshness = 'live' | 'stale';

export interface MovesetMove {
  readonly unit: UnitKey;
  readonly to: CellIndex;
  readonly path: ReadonlyArray<CellIndex>;
}

/**
 * THE ROW. One assignment covering every member of one cluster, with the
 * WHOLE-BOARD proved bracket of the complete plan it was priced inside.
 *
 * Law A: `(lo, est, hi)` is never a sum and there is no cluster-local value.
 * The honest reading is *"if this cluster plays these moves and the rest of
 * the team plays what it is currently staged with, the team's proved floor is
 * `lo` and its ceiling is `hi`"* — which is why `complementKey` is a field
 * and not a nicety.
 */
export interface Moveset {
  readonly cluster: ClusterId;
  readonly clusterKey: string;
  readonly generation: number;
  /** `planKey` of the CLUSTER RESTRICTION. */
  readonly key: MovesetKey;
  /** 1 = best in this table. */
  readonly rank: number;
  readonly moves: ReadonlyArray<MovesetMove>;

  // ---- THE FIBER (Law E). Three coordinates; all three must match to compare.
  readonly basis: BasisKey;
  /** `planKey` of everything OUTSIDE the cluster when this was priced. */
  readonly complementKey: string;
  readonly complement: ComplementFreshness;

  // ---- THE NUMBER. Never a sum.
  /** Law A's receipt: the plan the bracket is a bracket OF. */
  readonly witness: PlanKey;
  readonly lo: number;
  readonly est: number;
  readonly hi: number;
  /** Which channel adjudicates. `est` never does. */
  readonly channel: 'lo' | 'est';
  readonly exact: boolean;
  readonly ledgerSize: number;
  readonly citedUnits: ReadonlyArray<UnitKey>;
  readonly assumptions: ReadonlyArray<Assumption>;
  readonly vacuity: VacuityCause;
  /** Priced plans carrying this projection. */
  readonly seenIn: number;

  // ---- PROVENANCE.
  readonly rung: MovesetRung;
  /** Kernel clock, ms from this decision's t0 — the same origin
   *  `EmitRecord.elapsedMs` uses, so every frame is on one timeline. */
  readonly at: number;
  /** `planTieKey` — an indifferent order, reproducibly. */
  readonly tie: number;
  readonly staged: boolean;
  /**
   * TRUE where the row is an ASSIGNMENT WITH NO PRICE. `conform` returns a
   * plan, not a bound, so a conditional ranking's rows carry the moves a lock
   * would stage and no number at all — and a panel that drew `0.0` for them
   * would be printing a number nobody computed, which is the exact failure
   * this surface exists to prevent (Law A). The numeric columns draw `—`
   * instead, the reading F7 reserved for a number that is genuinely not
   * there. Absent ⇒ the row carries the reading its fields say it does.
   */
  readonly unpriced?: true;

  /** Null until the barrier. */
  readonly dominance: DominanceCondition | null;

  /** The two readings, the line and the three-way delta (06 §3.1). */
  readonly depth: DepthColumn;
}

// ---------------------------------------------------------------- breakdown

export interface FeatureDelta {
  readonly key: string;
  readonly delta: Bound;
}

/** A contrastive delta against a FIXED reference action (04 §2.8), never a
 *  share and never a next-best baseline: a fixed baseline makes the column
 *  comparable across rows, members and emissions. */
export interface MemberMarginal {
  readonly unit: UnitKey;
  readonly delta: Bound;
  readonly features: ReadonlyArray<FeatureDelta>;
  /** The reference action that was priced. Where `NO_ORDER_MOVE` is not legal
   *  for the unit, its worst-ranked legal candidate, named here. */
  readonly against: { readonly to: CellIndex };
}

/** `aggregate − Σ marginals`. MANDATORY, and drawn even at zero: omitting a
 *  zero residual and omitting a large one are the same rendering bug, and
 *  only "always draw the row" catches both (Law A). */
export interface JointResidual {
  readonly total: Bound;
  readonly features: ReadonlyArray<FeatureDelta>;
}

export interface MovesetAggregate {
  readonly profile: string;
  readonly bound: Bound;
  readonly features: ReadonlyArray<FeatureContribution>;
  readonly exact: boolean;
  readonly ledgerSize: number;
}

export interface MovesetBreakdown {
  readonly moveset: MovesetKey;
  readonly basis: BasisKey;
  /** LEVEL 1: one `explainPlan` on the witness plan. Null ⇒ the evaluator
   *  does not explain, which is not an error state: the panel says so in
   *  words rather than drawing zeros (03 §7.8). */
  readonly aggregate: MovesetAggregate | null;
  /** LEVEL 2: one `explainPlan` per named member. An absent entry means "not
   *  asked", never "zero". */
  readonly marginals: ReadonlyArray<MemberMarginal>;
  readonly residual: JointResidual;
}

// ------------------------------------------------------------- kernel sink

/** A lock the operator is considering or has issued. `rankConditional` is a
 *  pure function of `(substrate, basis, locks, cursor)`. */
export interface Lock {
  readonly unit: UnitKey;
  readonly to: CellIndex;
}

export type ConditionalSource = 'retained-filter' | 'speculative-context' | 'empty';

/**
 * THE ROWS THE RANKING DID NOT REACH, named on the same channel the rows
 * arrive on. A table that stops short and says nothing is indistinguishable
 * from a cluster with nothing else in it, and only one of those is true — the
 * same reason a refused inspection is a typed refusal rather than an empty
 * list (04 §4.5).
 */
export interface RankTruncation {
  /** `reserve-spent` — the reserve ran out mid-ranking, the typed refusal a
   *  request past it would have got. `row-cap` — the list is as long as a
   *  list is allowed to be (`LENS_TOPK`), which is a different sentence and
   *  not a refusal at all. */
  readonly why: 'reserve-spent' | 'row-cap';
  /** Assignments of the rest of the cluster left unranked. */
  readonly notRanked: number;
  readonly detail: string;
}

/**
 * Law B: this IS the speculative pin context for the lock, not a second
 * computation that agrees with it. Its head is `conform(ctx ⊕ pin, wirePlan)`
 * — what would actually be staged — never `improve`'s best-so-far.
 */
export interface ConditionalRanking {
  readonly cluster: ClusterId;
  readonly locks: ReadonlyArray<Lock>;
  /** Locking NARROWS: the locked units move to `boundedBy` (04 §3, 03 Q2). */
  readonly clusterAfter: ClusterView;
  readonly rows: ReadonlyArray<Moveset>;
  /** `'empty'` is reachable and renders as *searching*, never as a number. */
  readonly source: ConditionalSource;
  /** Slices spent — the confidence channel, and Q4's echo. */
  readonly cursor: number;
  readonly provisional: boolean;
  readonly degraded: boolean;
  /** `pinContextKey([...committed, lock], true)`. */
  readonly contextKey: string;
  /** Live is open at the head; replay is closed (01 §7.1). */
  readonly final: boolean;
  /** Null ⇒ the rest of the cluster was ranked to the end. */
  readonly truncated: RankTruncation | null;
}

/** Refused on the same channel, never with silence (04 §4.5). */
export type LensRefusalReason =
  | 'reserve-spent'
  | 'generation-superseded'
  | 'off-head'
  | 'unknown-cluster'
  | 'cancelled';

export interface LensRefusal {
  readonly ok: false;
  readonly refusal: LensRefusalReason;
  readonly detail: string;
}

/** The typed refusal is part of the return type, so a caller cannot read a
 *  refused request as a served one by forgetting to check. */
export type RankConditionalResult =
  | ({ readonly ok: true } & ConditionalRanking)
  | LensRefusal;

export interface LensReserve {
  readonly budgetMs: number;
  readonly spentMs: number;
  readonly queued: number;
}

/** The query port the RUNNING kernel exposes (04 §4.4). */
export interface KernelLensPort {
  partition(): ReadonlyArray<ClusterView>;
  movesets(cluster: ClusterId): ReadonlyArray<Moveset>;
  /** Never searches on the caller's thread; schedules and returns what is known. */
  rankConditional(cluster: ClusterId, locks: ReadonlyArray<Lock>): RankConditionalResult;
  /** Level 1 always; level 2 for the named members. Charged to the reserve. */
  explainMoveset(
    key: MovesetKey,
    members?: ReadonlyArray<UnitKey>
  ): Promise<MovesetBreakdown | LensRefusal>;
  readonly reserve: LensReserve;
}

/**
 * [CHANGE 3] — the second sink. Called BETWEEN slices only, never inside one,
 * wrapped in try/catch by the kernel: a lens consumer that throws must not be
 * able to take a decision down. Absent ⇒ the lens costs exactly nothing.
 *
 * The emission order within one epoch change is FIXED:
 * `operator` → `partition` → `emission` → `movesets`. A UI that folds them in
 * order is never in a state where a moveset names a cluster that does not
 * exist yet.
 *
 * These carry `UnitKey` already: the sink translates at the boundary (04 §2.2).
 */
export type LensEvent =
  | {
      readonly kind: 'partition';
      readonly at: number;
      readonly epoch: number;
      readonly posture: Posture;
      readonly clusters: ReadonlyArray<ClusterView>;
      readonly changes: ReadonlyArray<ClusterEvent>;
      readonly cause: PinEvent | 'decision-start' | 'posture-flip';
    }
  | {
      readonly kind: 'movesets';
      readonly at: number;
      readonly clusterId: ClusterId;
      readonly rows: ReadonlyArray<Moveset>;
      readonly complementKey: string;
      /** THE FRAME'S CONTEXT, not a row's: the loud product measured on the
       *  rank-1 row's own plan (08 §5 step 1). Null ⇒ never measured on this
       *  frame's leader — no gated enemy, or nothing modelled at all. */
      readonly loud: LoudReading | null;
    }
  /** The `EmitRecord` verbatim — one object, two consumers. */
  | { readonly kind: 'emission'; readonly at: number; readonly record: EmitRecord }
  | {
      readonly kind: 'operator';
      readonly at: number;
      /** `PendingEvent.at` — when the operator ACTED, not when the loop noticed. */
      readonly arrivedAt: number;
      readonly event: PinEvent;
      readonly epoch: number;
      readonly latencyMs: number;
      /** MUST be 0 on a conforming re-stage. */
      readonly slicesBefore: number;
      /** The operator `TurnEvent` this answers (01 ask (b)). */
      readonly answers: EventId | null;
    }
  | {
      readonly kind: 'posture';
      readonly at: number;
      readonly from: Posture;
      readonly to: Posture;
      readonly channel: 'lo' | 'est';
    }
  | { readonly kind: 'conditional'; readonly at: number; readonly ranking: ConditionalRanking }
  /**
   * THE DRILLED ROW, RECORDED. `explainMoveset` answered a question the
   * operator asked; the answer is a fact about this decision and is emitted
   * beside the `conditional` it sits next to, so the fold holds it and replay
   * shows the operator the row they drilled live rather than a permanent
   * *"[B] to price this row"* (09 §A6).
   */
  | {
      readonly kind: 'breakdown';
      readonly at: number;
      readonly moveset: MovesetKey;
      readonly breakdown: MovesetBreakdown;
    }
  | {
      readonly kind: 'refusal';
      readonly at: number;
      readonly refusal: EmitRefusal;
      readonly planKey: PlanKey;
    };

export type LensSink = (event: LensEvent) => void;

/**
 * WHAT A DECISION DECLARES ABOUT ITSELF when it opens the lens — the producer
 * side of the `decisions` row and of the `decision.begin` event.
 *
 * The storage track deliberately left `logDecisionRecord` with no caller
 * rather than fabricate a basis: a re-run seed assembled by the module that
 * stores it, out of whatever it could reach, is a seed that re-runs a
 * different decision. This is the decision layer saying what it actually
 * built, once, at the moment it built it.
 */
export interface LensDecision {
  /**
   * The audit seed, LESS `boardHash`. The board is the LOG's: the writer that
   * recorded `board.arrived` hashed the settlement it anchored the turn on,
   * and a second hash taken in the decision layer would be a second answer to
   * a question that has one.
   */
  readonly input: Omit<DecisionInput, 'boardHash'>;
  /** The engine and evaluator profile that RAN — the stamp, not the binding. */
  readonly engine: string;
  readonly profile: string;
  /**
   * SUBSTRATE number → WIRE id, the one translation the sink still owed.
   * `EmitRecord.plan` is keyed by substrate unit number, which is private to
   * one decision and meaningless one turn later (04 §2.2); without this the
   * emission's `moves` are honestly empty rather than a number nobody can
   * resolve.
   */
  unitKeyOf(unitId: number): UnitKey | null;
}

/** How a decision ENDED. `abandoned` is a newer turn arriving, not a failure;
 *  `stagedNothing` is the one outcome a reader must never have to infer from
 *  an absence, because an absence is also what a lost log looks like. */
export interface LensDecisionSummary {
  readonly abandoned: boolean;
  readonly stagedNothing: boolean;
  readonly counters: Readonly<Record<string, number>>;
}

/**
 * The lens, open on ONE decision. `frame` is what `KernelInput.lens` is given;
 * `end` is called exactly once, in the decision's `finally`, so a decision
 * that threw or was abandoned still closes its own record — those are the two
 * turns a replay would otherwise have nothing to say about.
 */
export interface LensDecisionPort {
  readonly frame: LensSink;
  /**
   * THE OPERATOR'S OWN GESTURE, written into the same order the kernel's
   * frames are, and its id handed back.
   *
   * `pin` / `unpin` / `commit` are in `TurnEventKind` and nothing in the
   * repository ever wrote one, so `frameAt`'s fixity map was permanently
   * empty: `UnitRow.fixity` / `owner` / `operator` were always `free` / null,
   * the timeline's operator ticks carried no verb and no colour, the widen
   * banner said "released red-A" with no author, every emission's `answers`
   * was null, and the client's ownership guard — which reads
   * `frame.units[].owner` — was a no-op.
   *
   * THE ORDER IS CAUSAL AND NOT A CONVENIENCE. The command is written FIRST
   * and the kernel is then told about it WITH the id it was written under, so
   * the emission that conforms to it can name the question it answers (01
   * §5.3). The writer refuses an answer whose question it has not written, so
   * the other order is not merely wrong, it throws.
   *
   * Null when there is nothing to write against — no board, no open turn, or
   * a unit this decision cannot name.
   */
  command(event: PinEvent, atWorkMs?: number | null): EventId | null;
  end(summary: LensDecisionSummary): void;
}

// ------------------------------------------------------------------- events

export type ActorKind = 'operator' | 'bot' | 'server' | 'wire';

export interface Actor {
  readonly kind: ActorKind;
  readonly id: OperatorId | null;
  readonly name: string | null;
  /** The stable per-game colour the arrows already use. */
  readonly color: string | null;
}

/**
 * ONE type, TWO producers (04 §4.2).
 *
 * `operator.attention` (02 §2.1, 04 §3 Q9) is not a kind of its own: focus and
 * candidate hover ride `selection` with `hover: true`. They fund compute so
 * they must reach the kernel, they are numerous and low-grade so they are off
 * by default in the timeline lane, and they are dropped at the 30-day fold.
 */
export type TurnEventKind =
  // produced by the KERNEL, through `KernelInput.lens` (03 §4.3):
  | 'partition'
  | 'movesets'
  | 'emission'
  | 'operator'
  | 'posture'
  | 'conditional'
  | 'breakdown'
  | 'refusal'
  // produced by the GAME MANAGER (01 §5.2), all of which it already computes:
  | 'board.arrived'
  | 'stage.fastpass'
  | 'decision.begin'
  | 'decision.end'
  | 'operator.command'
  | 'pin'
  | 'unpin'
  | 'commit'
  | 'pin.refused'
  | 'stage.requested'
  | 'stage.confirmed'
  | 'stage.retry'
  | 'commit.observed'
  | 'advice'
  | 'selection'
  | 'turn.resolved';

export interface TurnEvent {
  readonly id: EventId;
  readonly gameId: GameId;
  /** BOARD turn. One turn domain, everywhere (01 §9.3). */
  readonly turn: Turn;
  /** Total order within the turn. The only sort key. Gapless and monotone,
   *  written by ONE writer per `(gameId, turn)` (04 §3 O6). */
  readonly seq: number;
  /** UTC ms — humans, and cross-turn ordering. */
  readonly atWall: number;
  /** The KERNEL's clock from t0. Null, never 0, when unmeasured (01 §5.1).
   *  This is the axis that replays; wall time does not. */
  readonly atWorkMs: number | null;
  readonly kind: TurnEventKind;
  readonly actor: Actor;
  readonly unit: UnitKey | null;
  /** What made this happen. */
  readonly causedBy: EventId | null;
  /** The operator event this RESPONDS to — distinct from `causedBy`: an
   *  emission is CAUSED by a slice boundary and ANSWERS a pin (01 §5.3). */
  readonly answers: EventId | null;
  readonly payload: unknown;
}

// ---- payloads, typed per kind. `TurnEvent.payload` stays `unknown` so the
// stored row and the wire row are one shape; `TurnEventOf<K>` is how a
// consumer that has checked the kind reads it without a cast at every site.

export interface PartitionPayload {
  readonly generation: number;
  readonly epoch: number;
  readonly posture: Posture;
  readonly clusters: ReadonlyArray<ClusterView>;
  readonly changes: ReadonlyArray<ClusterEvent>;
}

export interface MovesetsPayload {
  readonly cluster: ClusterId;
  readonly generation: number;
  readonly emissionSeq: number;
  readonly complementKey: string;
  readonly rows: ReadonlyArray<Moveset>;
  /** `Q` and `P` for this frame's leader — the measurement 08 §4.4 says is the
   *  one open empirical question, carried where the frame's other context is.
   *  Read by nothing that decides; absent from the `movesets` PROJECTION,
   *  which is a table of rows and this is a fact about a frame. */
  readonly loud: LoudReading | null;
}

export interface EmissionPayload {
  readonly planKey: PlanKey;
  readonly lo: number;
  readonly est: number;
  readonly hi: number;
  readonly slack: number;
  readonly horizon: number;
  readonly epoch: number;
  readonly posture: Posture;
  readonly assumptions: ReadonlyArray<Assumption>;
  readonly moves: ReadonlyArray<MovesetMove>;
}

export interface OperatorFramePayload {
  readonly verb: 'pin' | 'unpin' | 'commit';
  readonly arrivedAtWorkMs: number;
  readonly epoch: number;
  readonly latencyMs: number;
  readonly slicesBefore: number;
}

export interface PosturePayload {
  readonly from: Posture;
  readonly to: Posture;
  readonly channel: 'lo' | 'est';
}

export interface ConditionalPayload {
  readonly requestId: RequestId;
  readonly cluster: ClusterId;
  readonly generation: number;
  readonly locks: ReadonlyArray<Lock>;
  readonly rows: ReadonlyArray<Moveset>;
  readonly source: ConditionalSource;
  readonly cursor: number;
  readonly final: boolean;
  /** The rows the reserve did not reach, carried so a REPLAYED table says the
   *  same thing about its own shortness as the live one did. */
  readonly truncated: RankTruncation | null;
}

/**
 * THE BREAKDOWN AS IT IS STORED — the `MovesetBreakdown` field for field, and
 * a row of it holds what 01 §3.3 says it holds: the moveset it is about, the
 * basis it was taken on, LEVEL 1 (`aggregate`, one `explainPlan` on the
 * witness plan, null where the evaluator does not explain), LEVEL 2
 * (`marginals`, one contrastive delta per named member, against the reference
 * action it was priced against) and the NAMED `residual` — `aggregate − Σ
 * marginals`, mandatory and carried at zero, because a display that shows the
 * marginals without it shows a total that does not add up and hides the fact
 * (Law C2).
 */
export interface BreakdownPayload {
  readonly moveset: MovesetKey;
  readonly basis: BasisKey;
  readonly aggregate: MovesetAggregate | null;
  readonly marginals: ReadonlyArray<MemberMarginal>;
  readonly residual: JointResidual;
}

export interface RefusalPayload {
  readonly refusal: EmitRefusal;
  readonly planKey: PlanKey;
}

export interface BoardArrivedPayload {
  readonly boardHash: string;
  readonly deadlineMs: number;
  readonly turnExpiryTime: number;
  readonly roster: ReadonlyArray<UnitKey>;
  readonly alive: ReadonlyArray<UnitKey>;
}

export interface StagePayload {
  readonly unit: UnitKey;
  readonly to: CellIndex;
  readonly source: string;
}

export interface StageRetryPayload extends StagePayload {
  readonly why: string;
}

export interface StageConfirmedPayload extends StagePayload {
  readonly serverTs: number;
}

export interface DecisionBeginPayload {
  readonly decisionId: string;
  readonly input: DecisionInput;
}

export interface DecisionEndPayload {
  readonly decisionId: string;
  readonly abandoned: boolean;
  readonly stagedNothing: boolean;
  readonly summary: Readonly<Record<string, number>>;
}

export interface OperatorCommandPayload {
  readonly verb: string;
  readonly target: UnitKey | null;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface PinPayload {
  readonly unit: UnitKey;
  readonly to: CellIndex;
  readonly tentative: boolean;
}

export interface PinRefusedPayload {
  readonly unit: UnitKey;
  readonly to: CellIndex;
  readonly reason: EmitRefusal;
}

export interface CommitObservedPayload {
  readonly unit: UnitKey;
}

export interface AdvicePayload {
  readonly unit: UnitKey;
  readonly costLo: number;
  readonly costHi: number;
  readonly degraded: boolean;
  readonly basis: BasisKey;
}

/** The UI's inspection focus, and the attention channel that funds compute. */
export interface SelectionPayload {
  readonly cluster: ClusterId | null;
  readonly unit: UnitKey | null;
  readonly candidate: CellIndex | null;
  /** True for a hover / focus tick: numerous, low-grade, dropped at the fold. */
  readonly hover: boolean;
}

export interface TurnResolvedPayload {
  readonly moves: ReadonlyArray<{ readonly unit: UnitKey; readonly to: CellIndex }>;
  readonly deaths: ReadonlyArray<UnitKey>;
  readonly winners: ReadonlyArray<string>;
}

export interface TurnEventPayloads {
  readonly partition: PartitionPayload;
  readonly movesets: MovesetsPayload;
  readonly emission: EmissionPayload;
  readonly operator: OperatorFramePayload;
  readonly posture: PosturePayload;
  readonly conditional: ConditionalPayload;
  readonly breakdown: BreakdownPayload;
  readonly refusal: RefusalPayload;
  readonly 'board.arrived': BoardArrivedPayload;
  readonly 'stage.fastpass': StagePayload;
  readonly 'decision.begin': DecisionBeginPayload;
  readonly 'decision.end': DecisionEndPayload;
  readonly 'operator.command': OperatorCommandPayload;
  readonly pin: PinPayload;
  readonly unpin: PinPayload;
  readonly commit: PinPayload;
  readonly 'pin.refused': PinRefusedPayload;
  readonly 'stage.requested': StagePayload;
  readonly 'stage.confirmed': StageConfirmedPayload;
  readonly 'stage.retry': StageRetryPayload;
  readonly 'commit.observed': CommitObservedPayload;
  readonly advice: AdvicePayload;
  readonly selection: SelectionPayload;
  readonly 'turn.resolved': TurnResolvedPayload;
}

export type TurnEventOf<K extends TurnEventKind> = Omit<TurnEvent, 'kind' | 'payload'> & {
  readonly kind: K;
  readonly payload: TurnEventPayloads[K];
};

// -------------------------------------------------------------------- frame

export type LensMode = 'live-head' | 'live-scrub' | 'replay';

export interface LensAt {
  readonly gameId: GameId;
  readonly turn: Turn;
  readonly seq: number;
  /** ms since `board.arrived` — what the timeline lays out spatially. */
  readonly tMono: number;
  readonly tWall: number;
  readonly mode: LensMode;
  /** Determinations are legal IFF this is true. */
  readonly isHead: boolean;
}

export type Fixity = 'free' | 'pinned' | 'held' | 'committed' | 'dead' | 'foreign';

export interface UnitRow {
  readonly unit: UnitKey;
  readonly kind: string;
  readonly letter: string;
  readonly weight: number;
  readonly health: number;
  readonly orientation: { readonly dx: number; readonly dy: number };
  readonly fixity: Fixity;
  readonly owner: OperatorId | null;
  readonly operator: string | null;
}

export interface CandidateRow {
  readonly key: string;
  readonly to: CellIndex;
  readonly path: ReadonlyArray<CellIndex>;
  readonly legal: boolean;
  /** `null` renders as `·` — unpriced. NEVER a bare number (04 §3 D-c). */
  readonly conditionalBest: { readonly aggregate: number; readonly grade: 'exact' | 'provisional' } | null;
  readonly disposition: string | null;
}

/** UNCHANGED shapes, owned by `active-game-manager.ts`. Rewriting a working
 *  dual-source contract to prove a point would be the junk this exercise is
 *  supposed to throw away (02 §2.3). The lens carries them; it does not
 *  re-declare their interiors. */
export type StagedMoveView = Readonly<Record<string, unknown>>;
export type RouteView = Readonly<Record<string, unknown>>;
export type WaypointView = Readonly<Record<string, unknown>>;
export type AdviceItem = Readonly<Record<string, unknown>>;

/** Mandatory on every frame: a number without its `evalVersion` /
 *  `guidanceId` is a cross-fiber comparison waiting to happen. */
export interface FrameProvenance {
  readonly botId: string;
  readonly behaviourId: string;
  readonly evalVersion: string;
  readonly guidanceId: string | null;
  readonly emissionSeq: number;
  readonly quantaSpent: number;
  readonly premise: string | null;
  /** Observed, or re-derived by another build. CONTENT, rendered as a badge,
   *  never a branch (Law C). */
  readonly kind: 'observed' | 'rerun';
}

/**
 * The renderer consumes THIS and nothing else. No component reaches for a
 * websocket message, a database row, or a live-vs-replay flag.
 *
 * Every frame is WHOLE, never a delta against something the consumer had to
 * have seen: a delta folds correctly live, where the consumer saw the
 * predecessor, and wrongly in replay (03 §5.1).
 */
export interface LensFrame {
  readonly at: LensAt;
  readonly board: BoardSnapshot;
  readonly units: ReadonlyArray<UnitRow>;
  readonly partition: ReadonlyArray<ClusterView>;
  readonly candidates: Readonly<Record<UnitKey, ReadonlyArray<CandidateRow>>>;
  /** Keyed `${clusterId}|${unitKey}|${to}` — one list per conditional. */
  readonly movesets: Readonly<Record<string, ReadonlyArray<Moveset>>>;
  /**
   * WHERE A CONDITIONAL LIST STOPPED SHORT, under the same key its rows are
   * under. A ranking the reserve cut off and a cluster with nothing else in it
   * are the same table unless the frame carries the difference — the same
   * distinction a typed refusal draws for a request nobody could serve
   * (04 §4.5, 10 §4 O1). Absent ⇒ nothing was cut off.
   */
  readonly movesetTruncation?: Readonly<Record<string, RankTruncation>>;
  readonly breakdown: Readonly<Record<MovesetKey, MovesetBreakdown>>;
  /**
   * `Q` and `P` as the bank measured them on each cluster's leader, keyed by
   * `String(clusterId)` — the frame's own context, carried on every `movesets`
   * frame and, until now, folded away unread. It is what the depth cell says
   * INSTEAD of a bare `h1 ·`: the absence of a ply, drawn with its reason
   * (08 §4.5, gate G-D6). Absent on a frame nobody measured.
   */
  readonly loud?: Readonly<Record<string, LoudReading>>;
  readonly staged: Readonly<Record<UnitKey, StagedMoveView>>;
  readonly routes: Readonly<Record<UnitKey, RouteView>>;
  readonly waypoints: Readonly<Record<UnitKey, WaypointView>>;
  readonly advice: ReadonlyArray<AdviceItem>;
  /** This turn, `seq ≤ at.seq`. In the frame, not beside it: the timeline is
   *  a view of the frame, so scrubbing is a pure function of one object. */
  readonly events: ReadonlyArray<TurnEvent>;
  readonly provenance: FrameProvenance;
}

// ------------------------------------------------------- reducer and source

/** The fold's INPUT. `anchor` is the turn's `board.arrived` event — the t0 the
 *  fold begins at. A turn's fold never crosses a turn boundary, so there is
 *  nothing to seek past and no game-length fold to avoid (04 §2.7). */
export interface FrameStore {
  readonly turn: Turn;
  readonly anchor: TurnEvent;
  readonly events: ReadonlyArray<TurnEvent>;
}

export type ApplyEvent = (store: FrameStore, e: TurnEvent) => FrameStore;
export type FrameAt = (store: FrameStore, seq: number) => LensFrame;

/** Every derived number says where it came from. `matchesRecorded` is
 *  deliberately absent: the runtime refusal is deleted (04 §2.6) and the
 *  re-run is a CI audit, so provenance is a badge and never a refusal. */
export interface Provenanced<T> {
  readonly value: T;
  readonly basis: BasisKey;
  readonly provenance:
    | { readonly kind: 'observed'; readonly at: Cursor }
    | {
        readonly kind: 'rerun';
        readonly behaviourId: string;
        readonly recordedBehaviourId: string;
      };
}

export interface ConditionalRequest {
  readonly cluster: ClusterId;
  readonly clusterGeneration: number;
  readonly lock: Lock;
}

export interface ConditionalHandle {
  readonly requestId: RequestId;
  /** Anytime: rank 1 first, then refinements. */
  readonly ranking: ReadonlyArray<Moveset>;
  readonly cursor: number;
  readonly final: boolean;
  cancel(): void;
}

export type SourceDelta =
  | { readonly kind: 'event'; readonly event: TurnEvent }
  | {
      readonly kind: 'clusters';
      readonly generation: number;
      readonly clusters: ReadonlyArray<ClusterView>;
      readonly supersedes: ReadonlyArray<ClusterId>;
    }
  | {
      readonly kind: 'movesets';
      readonly cluster: ClusterId;
      readonly generation: number;
      readonly emissionSeq: number;
      readonly rows: ReadonlyArray<Moveset>;
    }
  | {
      readonly kind: 'conditional';
      readonly requestId: RequestId;
      readonly ranking: ReadonlyArray<Moveset>;
      readonly cursor: number;
      readonly final: boolean;
    }
  | { readonly kind: 'cursor'; readonly at: Cursor };

/** Which side of the seam handed the events over. The ONE legitimate
 *  difference between the two implementations, and it is content. */
export type DecisionSourceKind = 'live' | 'replay';

/**
 * Two implementations, one type. `LiveDecisionSource` maps websocket messages
 * to `TurnEvent`s and calls `applyEvent`; `ReplayDecisionSource` reads
 * `turn_events` and calls THE SAME `applyEvent` with the same objects.
 *
 * Law C4: the UI has one code path. A display that needs to know which source
 * it has is a defect in this interface, not a case to special-case.
 */
export interface DecisionSource {
  readonly kind: DecisionSourceKind;
  /** Per CONNECTION (04 §3 O10): the fold is pure and the event array shared,
   *  so a per-connection source is a cursor, not a copy. */
  readonly at: Cursor;
  seek(to: Cursor): void;
  frame(): LensFrame;
  timeline(): ReadonlyArray<TurnEvent>;
  breakdown(moveset: MovesetKey): Promise<Provenanced<MovesetBreakdown> | LensRefusal>;
  conditional(req: ConditionalRequest): Promise<ConditionalHandle | LensRefusal>;
  subscribe(fn: (d: SourceDelta) => void): () => void;
}

// ------------------------------------------------------------- cursor (UI)

/** `cluster` is REMOVED: clusters partition, so the unit determines its
 *  cluster (04 §3 Q3), and T5's `\` cycle is deleted with it. */
export interface LensCursor {
  readonly unit: UnitKey | null;
  readonly candidate: CellIndex | null;
  readonly moveset: MovesetKey | null;
  readonly drill: UnitKey | null;
  readonly foil: 'off' | 'peek' | 'latched';
  /** Per level, whether the operator CHOSE it — Law D: defaults cascade,
   *  choices pin, and re-resolution needs to know which is which. */
  readonly explicit: {
    readonly candidate: boolean;
    readonly moveset: boolean;
    readonly drill: boolean;
  };
}

export type LensCursorState = 'NONE' | 'UNIT' | 'CANDIDATE' | 'MOVESET' | 'BREAKDOWN';

/** T1–T17 of 02 §1.3, minus the deleted T5. */
export type CursorEvent =
  | { readonly t: 'focus'; readonly unit: UnitKey }
  | { readonly t: 'blur' }
  | { readonly t: 'candidate'; readonly to: CellIndex | null }
  | { readonly t: 'candidate.hover'; readonly to: CellIndex }
  | { readonly t: 'moveset'; readonly key: MovesetKey }
  | { readonly t: 'drill'; readonly unit: UnitKey }
  | { readonly t: 'foil'; readonly mode: 'off' | 'peek' | 'latched' }
  | { readonly t: 'lock' }
  | { readonly t: 'lock.moveset' }
  | { readonly t: 'release'; readonly unit: UnitKey }
  | { readonly t: 'clear'; readonly unit: UnitKey }
  | { readonly t: 'seek'; readonly seq: number }
  | { readonly t: 'now' }
  | { readonly t: 'emission'; readonly seq: number }
  | { readonly t: 'partition-change'; readonly generation: number }
  | { readonly t: 'turn-boundary'; readonly turn: Turn };

/** What a lock would stage. `P* = {u} ∪ {v ∈ members : K(v) ≠ staged(v)}` —
 *  EXACT, computed client-side from the frame, with no kernel query and no
 *  `≤`: `minimalPinSet` is refused (04 §2.4). */
export interface LockPlan {
  readonly moveset: MovesetKey;
  readonly pins: ReadonlyArray<Lock>;
  /** `|P*|`, rendered before the press. Never an upper bound. */
  readonly count: number;
  readonly members: number;
  /** Units in `P*` another operator owns: lock is refused at the client with
   *  the three offers, never issued as a cross-owner determination. */
  readonly blockedBy: ReadonlyArray<{ readonly unit: UnitKey; readonly owner: OperatorId }>;
  /** Recorded before the press; compared against the next emission's
   *  incumbent for `C ∖ P*`. This is what makes Law B falsifiable. */
  readonly expected: ReadonlyArray<MovesetMove>;
  readonly emissionSeq: number;
}

export interface DivergenceReport {
  readonly moveset: MovesetKey;
  readonly differing: ReadonlyArray<{
    readonly unit: UnitKey;
    readonly expected: CellIndex;
    readonly actual: CellIndex;
    readonly why: string;
  }>;
}

// ----------------------------------------------------------- reactive (UI)

/** Additive uncertainty is STAGED. The old list is struck through and headed
 *  `stale @ seq n` — never blanked (02 §1.6). */
export interface WidenNotice {
  readonly cluster: ClusterId;
  readonly fromGeneration: number;
  readonly toGeneration: number;
  readonly gained: ReadonlyArray<UnitKey>;
  readonly by: OperatorId | null;
  /** The cluster's size BEFORE the widen. The banner reads
   *  `gained + members` — one sentence whose arithmetic the reader can check.
   *  Without it the banner said "cluster is now 1 units" (09 §A4). */
  readonly members: number;
  /** `min(6s, 0.25 × (turnExpiryTime − now))` (04 §3 Q8). */
  readonly autoAcceptMs: number;
  /** Suspended while the drill panel is open; queued behind an in-flight lock. */
  readonly suspended: boolean;
  readonly queuedBehindLock: boolean;
  readonly staleAtSeq: number;
}

/** Subtractive certainty is APPLIED: at once, with a footer note, no banner. */
export interface NarrowNote {
  readonly cluster: ClusterId;
  readonly lost: ReadonlyArray<UnitKey>;
  /** A fixity when somebody fixed it, `'gone'` when the unit simply left the
   *  board. Only a fixity has an author, and calling a death a pin would
   *  attribute a determination nobody made. */
  readonly why: FixityReason | 'gone';
  readonly by: OperatorId | null;
}

/** `#3 ▲was #1`. Decays after two emissions. */
export interface RowTrail {
  readonly moveset: MovesetKey;
  readonly wasRank: number;
  readonly rank: number;
  readonly emissionsAgo: number;
  /** No new row contains the old assignment: selection falls to rank 1 and
   *  the row carries the displaced badge (02 §1.6 step 4). */
  readonly displaced: boolean;
}

/** The renderer's output, captured for comparison. Live and replay must
 *  produce identical transcripts; no renderer function may branch on mode. */
export interface DrawCall {
  readonly op: string;
  readonly args: ReadonlyArray<unknown>;
}

export type DrawTranscript = ReadonlyArray<DrawCall>;

// ------------------------------------------------------------------ storage

export interface StoredPin {
  readonly unit: UnitKey;
  readonly to: CellIndex;
}

export type StoredAssumption =
  | { readonly kind: 'reference-action'; readonly unit: UnitKey; readonly to: CellIndex }
  | { readonly kind: 'operator-pin'; readonly unit: UnitKey; readonly to: CellIndex }
  | { readonly kind: 'narrowing'; readonly unit: UnitKey; readonly note: string }
  | { readonly kind: 'posture'; readonly posture: Posture };

export type KernelOptionsDigest = Readonly<Record<string, number | string | boolean>>;

/** The audit seed and the lazy-derivation seed (01 §8.2). Every field is
 *  already computed and already thrown away except `kernelOptions`. The
 *  re-run is under the NODE clock; `liveBudgetMs` is context, never an input. */
export interface DecisionInput {
  readonly boardHash: string;
  readonly asTeam: number;
  readonly seed: number;
  readonly assumptions: ReadonlyArray<StoredAssumption>;
  readonly initialPins: ReadonlyArray<StoredPin>;
  readonly modelled: ReadonlyArray<UnitKey>;
  readonly botId: string;
  readonly behaviourId: string;
  readonly nodeBudget: number;
  readonly liveBudgetMs: number;
  readonly kernelOptions: KernelOptionsDigest;
}

/** `turn_boards` — the re-run input AND the fold's t0 anchor. Forever. */
export interface TurnBoardRow {
  readonly gameId: GameId;
  readonly turn: Turn;
  readonly settlement: unknown;
  readonly boardHash: string;
  readonly deadlineMs: number;
  readonly roster: ReadonlyArray<UnitKey>;
}

/** `turn_events` — `payload` is the `TurnEvent` VERBATIM, so live and replay
 *  fold identical bytes. `seq` and `atWorkMs` are columns because they are
 *  indexed, not because they are different data. */
export interface TurnEventRow {
  readonly gameId: GameId;
  readonly turn: Turn;
  readonly seq: number;
  readonly kind: TurnEventKind;
  readonly atWall: number;
  readonly atWorkMs: number | null;
  readonly actorKind: ActorKind;
  readonly actorId: OperatorId | null;
  readonly actorName: string | null;
  readonly actorColor: string | null;
  readonly unitKey: UnitKey | null;
  readonly causedBy: EventId | null;
  readonly answers: EventId | null;
  readonly payload: TurnEvent;
}

export interface DecisionRow {
  readonly id: string;
  readonly gameId: GameId;
  readonly turn: Turn;
  readonly botId: string;
  readonly behaviourId: string;
  readonly engine: string;
  readonly profile: string;
  readonly input: DecisionInput;
  readonly summary: Readonly<Record<string, number>>;
  readonly startedAt: number;
  readonly endedAt: number | null;
}

/**
 * `movesets` — a MATERIALISED PROJECTION of the `movesets` frames, existing
 * for the index `(decision_id, cluster_id, rank)` and not for its content. It
 * is legitimate only because a boundary test asserts the fold reproduces it
 * and a rebuild command regenerates it; that is the rule `command_turn_states`
 * failed (04 §2.7).
 */
export interface MovesetProjectionRow {
  readonly decisionId: string;
  readonly emissionSeq: number;
  readonly clusterId: ClusterId;
  readonly clusterKey: string;
  readonly clusterGen: number;
  readonly rank: number;
  readonly movesetKey: MovesetKey;
  readonly moves: ReadonlyArray<MovesetMove>;
  readonly witnessPlanKey: PlanKey;
  readonly seenIn: number;
  readonly lo: number;
  readonly est: number;
  readonly hi: number;
  readonly channel: 'lo' | 'est';
  readonly exact: boolean;
  readonly ledgerSize: number;
  readonly vacuity: VacuityCause;
  readonly complementKey: string;
  readonly complementStale: boolean;
  readonly cited: ReadonlyArray<UnitKey>;
  readonly basisKey: BasisKey;
  readonly staged: boolean;
  readonly dominanceKind: DominanceCondition['kind'] | null;
  readonly dominance: DominanceCondition | null;
  // ---- depth (06 §3.3 rule 4): the delta always, the line for `staged` only.
  readonly h1Lo: number;
  readonly h1Hi: number;
  readonly deepHorizon: number;
  readonly deepLo: number;
  readonly deepHi: number;
  readonly derived: boolean;
  readonly line: ReadonlyArray<PlyStep> | null;
}

/** Replaces `decision_logs`' back-filled move columns without the blob. */
export interface UnitOutcomeRow {
  readonly gameId: GameId;
  readonly turn: Turn;
  readonly unitKey: UnitKey;
  readonly unitName: string | null;
  readonly clusterId: ClusterId | null;
  readonly stagedMove: CellIndex | null;
  readonly stagedSource: string | null;
  readonly confirmedMove: CellIndex | null;
  readonly committed: boolean;
  readonly resolvedMove: CellIndex | null;
  readonly fatalConsent: boolean | null;
  readonly operatorId: OperatorId | null;
}

/** The 30-day fold (04 §4.3). A folded turn is STILL INSPECTABLE: the board
 *  and the basis survive and the re-derivation path is unchanged, so
 *  retention is a latency decision rather than a loss. */
export interface RetentionFold {
  readonly gameId: GameId;
  readonly turn: Turn;
  /** Operator commands, pins, staging outcomes, decision begin/end. */
  readonly kept: ReadonlyArray<TurnEvent>;
  /** Refusals, non-staging emissions, every attention tick. */
  readonly dropped: number;
  /** The final staged frame's rows only. */
  readonly stagedRows: ReadonlyArray<MovesetProjectionRow>;
}
