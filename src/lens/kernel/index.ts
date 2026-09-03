/**
 * PLACEHOLDER — the K track's surface, declared at L1 and built at L2/L3.
 *
 * Nothing here is implemented. It exists so the boundary tests of
 * `05-BUILD-ORDER.md` §(b) COMPILE against a real module path and FAIL AT
 * RUNTIME for want of an implementation, which is a strictly better signal
 * than a compile error: a compile error stops at the first file, and a runtime
 * failure names every assertion that is still owed.
 *
 * L2 fills `freeSetOf` / `partitionOf` / `diffPartitions` / the reservoir and
 * the sink; L3 fills `rankConditional` / `explainMoveset` and the reserve.
 * Signatures may move here — this file is NOT frozen. `../types.ts` is.
 */

import type {
  KernelInput,
  Posture,
  SearchContext,
  SearchCore,
  Substrate,
  UnitId,
} from '../../lobster/contracts';
import type {
  BasisKey,
  CellIndex,
  ClusterEvent,
  ClusterId,
  ClusterView,
  KernelLensPort,
  LensEvent,
  LensSink,
  Lock,
  LensRefusal,
  Moveset,
  MovesetBreakdown,
  MovesetKey,
  OperatorId,
  RankConditionalResult,
  UnitKey,
} from '../types';

const NOT_IMPLEMENTED = 'not implemented: L2/L4/L5';

/** A committed determination, with the operator who made it. */
export interface FixedUnit {
  readonly unit: UnitKey;
  readonly to: CellIndex;
  readonly by: OperatorId | null;
}

/**
 * Everything the partitioner reads. The vertex set is
 * `sub.commandable(asTeam)` minus reference-fixed, honourably-pinned and
 * committed units — and NOT minus `unreachablePins`, which are still searched
 * and are therefore still vertices (03 §1.2).
 */
export interface PartitionInput {
  readonly sub: Substrate;
  readonly asTeam: number;
  readonly epoch: number;
  readonly posture: Posture;
  readonly basis: BasisKey;
  readonly pins: ReadonlyArray<FixedUnit>;
  readonly committed: ReadonlyArray<FixedUnit>;
  readonly references: ReadonlyArray<FixedUnit>;
  /** A committed pin naming a cell the grammar cannot reach: a MEMBER, whose
   *  row says the operator asked for a cell this unit cannot reach. */
  readonly unreachablePins: ReadonlyArray<FixedUnit>;
  /** The previous partition, for `lineage` and the derived `ClusterEvent`s. */
  readonly previous?: ReadonlyArray<ClusterView>;
}

export function freeSetOf(_input: PartitionInput): ReadonlySet<UnitId> {
  throw new Error(NOT_IMPLEMENTED);
}

export function partitionOf(_input: PartitionInput): ReadonlyArray<ClusterView> {
  throw new Error(NOT_IMPLEMENTED);
}

/** DERIVED by diffing successive partitions, never asserted. */
export function diffPartitions(
  _before: ReadonlyArray<ClusterView>,
  _after: ReadonlyArray<ClusterView>
): ReadonlyArray<ClusterEvent> {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * One reservoir per `(clusterId, complementKey)`, `k = LENS_TOPK`, insertion-
 * ordered on the same key `better()` uses — `(lo, est, hi, tie)` — so the
 * reservoir's order and the search's order are the same order by construction
 * and cannot drift.
 */
export interface MovesetReservoir {
  /** `O(k)` comparisons, zero evaluations. Called at the `better()` call site. */
  offer(row: Moveset): void;
  /** The retained rows for one cluster, ranked. Never mixes complements. */
  rows(cluster: ClusterId, complementKey?: string): ReadonlyArray<Moveset>;
  all(): ReadonlyArray<Moveset>;
  /** Fills `dominance` on every retained row. Null before this; non-null after. */
  seal(complementKey: string): void;
  readonly size: number;
}

export function makeReservoir(_rowCap?: number): MovesetReservoir {
  throw new Error(NOT_IMPLEMENTED);
}

/** `max over retained rivals of (rᵢ.hi − leader.lo)` — the quantity
 *  `EmitRecord.slack` was always documented as carrying (04 §5.2 #12). */
export function slackFrom(_rows: ReadonlyArray<Moveset>): number {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * [CHANGE 3] at the seam. Returns the input with the `lens` sink attached —
 * the one place a caller declares that this decision is being watched. Absent
 * ⇒ the lens costs exactly nothing, which G-L2 (ii) makes falsifiable.
 */
export function attachLens(_input: KernelInput, _sink: LensSink): KernelInput {
  throw new Error(NOT_IMPLEMENTED);
}

/** The query port a RUNNING kernel exposes to its inspectors. */
export function lensPortOf(_kernel: unknown): KernelLensPort {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * `LENS_INSPECTION_MS` carved BEFORE `searchDeadline`, and by nothing else —
 * the reserve is DECLARED, not taken (G-L2 (i)).
 */
export function carveReserve(_deadlineMs: number, _nowMs: number): {
  readonly searchDeadlineMs: number;
  readonly reserveMs: number;
} {
  throw new Error(NOT_IMPLEMENTED);
}

/** [CHANGE 2]. On an epoch change, `retarget` promotes a matching speculative
 *  entry (`spec:[…]`) into the committed namespace (`pin:[…]`), carrying
 *  `incumbent`, `witnesses`, `cursor`, `citedUnits`, `stepCostMs` — and NOT
 *  `bounds`/`boundsBasis`, because a floor proved in the old epoch may not
 *  gate the new one. This is what makes Law B literally true. */
export function promotedContextKey(_speculativeKey: string): string {
  throw new Error(NOT_IMPLEMENTED);
}

export interface RankConditionalInput {
  /** The decision's own context — `rankConditional` is a pure function of
   *  `(substrate, basis, locks, cursor)` and never searches on the caller's
   *  thread. It schedules, and returns what is known. */
  readonly ctx: SearchContext;
  readonly search: SearchCore;
  readonly cluster: ClusterId;
  readonly generation: number;
  readonly locks: ReadonlyArray<Lock>;
  /** What is LEFT of `LENS_INSPECTION_MS`. Zero ⇒ a typed refusal, never
   *  silence and never a served row. */
  readonly reserveMs: number;
}

export function rankConditional(_req: RankConditionalInput): RankConditionalResult {
  throw new Error(NOT_IMPLEMENTED);
}

export function explainMoveset(
  _key: MovesetKey,
  _members?: ReadonlyArray<UnitKey>
): Promise<MovesetBreakdown | LensRefusal> {
  throw new Error(NOT_IMPLEMENTED);
}

// ------------------------------------------------------------ determinism

/** One fixture decision, run with the `lens` sink attached, under the node
 *  clock. G1 byte-compares two runs at the same seed and budget; G2 asserts a
 *  `2b`-work run's frames EXTEND the `b` run's. */
export interface LensRunSpec {
  readonly scenario: string;
  readonly seed: number;
  readonly nodes: number;
  readonly turns: number;
}

export function recordLensRun(_spec: LensRunSpec): Promise<ReadonlyArray<LensEvent>> {
  throw new Error(NOT_IMPLEMENTED);
}

/** The byte form G1 and G2 compare. Stable field order, no wall clock. */
export function serialiseLensEvent(_event: LensEvent): string {
  throw new Error(NOT_IMPLEMENTED);
}
