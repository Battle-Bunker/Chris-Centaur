/**
 * LOBSTER anytime kernel — the clock, the emit gates, and CONSTRAINT EPOCHS.
 *
 * Ported from the arena-validated anytime kernel (clock discipline, the five
 * emit gates, journal integrity) with three deliberate changes, each of which
 * is a bug class the arena proved:
 *
 *  1. EVERY COST ESTIMATOR IS PER-DECISION-CONTEXT STATE. The arena kernel
 *     kept `setupCostMs`/`stepCostMs` at module scope, ratcheting instantly up
 *     and decaying 20% per decision — and decaying only AFTER the affordability
 *     bail, so once the bail fired it never re-measured. One contention spike
 *     latched the bot into an immediate early return for the rest of the
 *     process: 95.6% optimal uncontended became 41.0% in the round robin, and
 *     the "needs a bigger budget" reading of the 10.9%→43.1% jump was the latch
 *     threshold being crossed, not a compute requirement. Here the estimator
 *     lives on the pin-context entry, which is created inside `decide()` and
 *     dies with it.
 *
 *  2. THE AFFORDABILITY GUARD IS FLOORED AT 0.2 × BUDGET. However large the
 *     estimate grows, work resumes whenever a fifth of the budget remains, and
 *     the first slice of any context is an UNCONDITIONAL PROBE that
 *     re-measures. A latch of the arena kind is therefore not merely absent,
 *     it is unreachable: there is no state that survives a decision and no
 *     threshold that can exceed a fifth of the budget.
 *
 *  3. THE RATCHET IS PER BASIS, and a basis is (epoch, posture). A floor
 *     proved under one pin set never gates another, and a floor proved while
 *     one channel led never gates the other channel. Cross-basis comparison is
 *     structurally impossible rather than merely avoided: the kernel holds
 *     exactly ONE `RatchetBasis` object, `newBasis()` replaces it, and no map
 *     from epoch (or posture) to floor exists anywhere in this file. The
 *     journal keeps the records, but a record is never fed back into a gate.
 *
 * CONSTRAINT EPOCHS. A committed pin event starts a new epoch. The kernel then
 * IMMEDIATELY re-stages a conforming plan — `SearchCore.conform`, which must be
 * cheap and must not search — before any further refinement runs, so the wire
 * never holds a set that contradicts the operator. The latency of that
 * re-stage is measured and reported. Tentative pins do NOT start an epoch:
 * they spawn speculative contexts that are searched at lower priority and
 * never reach the wire.
 */

import { transientDelay } from "../server/activity-controller"
import type {
  AdmissionStamp,
  Assumption,
  Bound,
  BudgetHandle,
  CohortId,
  CrossfadeVerdict,
  EmitRecord,
  JointPlan,
  Evaluator,
  Kernel,
  KernelInput,
  Pin,
  PinEvent,
  PinSet,
  PlanScore,
  Posture,
  SearchContext,
  UnitId,
  Witness,
} from "./contracts"
// THE COHORT REGISTRY, AND NOTHING ELSE FROM THE EVALUATOR. `calibration.ts`
// is a leaf: pure data, one type-only import of `contracts`, no engine, no
// features, no shells. The kernel needs to know which objectives EXIST (to
// refuse an unregistered one) and what each one's invoked key set is (to stamp
// it on the assumption); it must never learn how one is computed, and it does
// not — importing the barrel `./evaluate` instead would pull the whole
// partial-engine-backed evaluator into the loop's module graph for a string.
import {
  COHORTS,
  DEFAULT_COHORT_ID,
  cohortAssumptionOf,
  requireCohortRowIn,
  type CohortRow,
} from "./evaluate/calibration"
// THE ADMISSION POLICY. `admission.ts` is the other governor beside
// `postures.ts`, and like it, it is a pure classifier over measured board
// conditions plus a dwell. It costs the loop's module graph one leaf of the
// vendored grammar (`profileOf`, for the class-level slider and promotion
// predicates) and nothing else — no evaluator, no features, no shells. WHICH
// evaluator computes an admitted cohort is not the kernel's knowledge: it is
// handed one per cohort through `KernelInput.evaluators`.
import {
  admissionSubstrateOf,
  admitAtEntry,
  type AdmissionPolicy,
  type AdmissionState,
} from "./admission"
import {
  DEFAULT_DEAD_BELOW,
  PostureGovernor,
  channelPolicyFor,
  detectVacuity,
  type PostureConditions,
  type PostureFlip,
} from "./postures"
import {
  DEFAULT_SWITCH_MARGIN,
  StickyStager,
  VocOrchestrator,
  asRefiner,
  planKey,
  rootSlack,
  type CandidateView,
  type Lever,
  type LeverView,
  type Refiner,
  type StagingCandidate,
} from "./voc"

// ------------------------------------------------------------------- clock

const hasPerformance = typeof performance !== "undefined" && typeof performance.now === "function"

/** The default clock: monotonic, sub-millisecond, and never wall-clock. */
export function defaultNow(): number {
  return hasPerformance ? performance.now() : Date.now()
}

/**
 * ONE MACROTASK YIELD.
 *
 * A slice is synchronous JavaScript and an `async *` generator with no `await`
 * in it resolves every `yield` on the MICROTASK queue — so a decision that
 * only yields values never reaches the event loop's timer or I/O phase at all.
 * Everything the anytime design depends on lives out there: the Firestore
 * snapshot listener that delivers an operator's pin, the `setImmediate` the
 * manager coalesces staged writes through, the per-turn final-flush timer, and
 * the other games sharing this process. Without a real yield the mid-decision
 * constraint-epoch machinery is unreachable from the wire, every revision
 * collapses into one post-decision burst, and three concurrent games interleave
 * only at emission granularity.
 *
 * The legacy path yields on purpose for exactly these reasons
 * (`DecisionWorkerPool.submit` wraps each inline chunk in `setImmediate`);
 * this is parity with it, not a new feature.
 */
function yieldToEventLoop(): Promise<void> {
  if (typeof setImmediate === "function") {
    return new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
  }
  // No `setImmediate` (a browser-shaped host): the repo's sanctioned
  // auto-unref'd one-shot, never a bare timer.
  return transientDelay(0)
}

/**
 * Convert a wall-clock deadline (the wire's `endTime`, which is `Date.now()`
 * based) onto the kernel's monotonic clock. One conversion, one place — mixing
 * the two scales is a clock-skew bug that only shows up under load.
 */
export function deadlineFromWallClock(
  absoluteWallMs: number,
  now: () => number = defaultNow,
  wallNow: () => number = Date.now,
): number {
  return now() + (absoluteWallMs - wallNow())
}

/** A budget scoped to one slice, over the kernel's injected clock. */
class SliceBudget implements BudgetHandle {
  constructor(
    private readonly clock: () => number,
    private readonly start: number,
    private readonly end: number,
  ) {}
  now(): number {
    return this.clock()
  }
  elapsedMs(): number {
    return this.clock() - this.start
  }
  remainingMs(): number {
    return Math.max(0, this.end - this.clock())
  }
  shouldStop(): boolean {
    return this.clock() >= this.end
  }
}

// ---------------------------------------------------------- pin canonicalisation

/** Committed pins only, sorted by unitId — the canonical pin context. */
export function canonicalPins(pins: PinSet): Pin[] {
  return pins
    .filter((p) => !p.tentative)
    .slice()
    .sort((a, b) => a.unitId - b.unitId || a.to - b.to)
}

/** One pin's token inside a `pinContextKey` body. The ONLY legal way to ask
 * whether a key mentions a pin: `"1@5?"` is a substring of `"31@5?"`, and a
 * consumer matching by substring fabricates prices for the wrong unit
 * (V4 B3 — confirmed empirically). Compare tokens, never text. */
export function pinContextToken(pin: Pin): string {
  return `${pin.unitId}@${pin.to}${pin.tentative ? "?" : ""}`
}

/** The cache key of a pin context. Speculative contexts get their own namespace. */
export function pinContextKey(pins: ReadonlyArray<Pin>, speculative = false): string {
  const body = pins
    .slice()
    .sort((a, b) => a.unitId - b.unitId || a.to - b.to)
    .map(pinContextToken)
    .join(",")
  return `${speculative ? "spec" : "pin"}:[${body}]`
}

/**
 * The inverse of `pinContextKey`: the namespace plus the EXACT token list.
 * A key this function cannot parse yields no tokens rather than a guess, so a
 * malformed key matches nothing instead of matching everything.
 */
export function parsePinContextKey(key: string): {
  speculative: boolean
  tokens: ReadonlyArray<string>
} {
  const open = key.indexOf(":[")
  if (open < 0 || !key.endsWith("]")) return { speculative: false, tokens: [] }
  const speculative = key.slice(0, open) === "spec"
  const body = key.slice(open + 2, key.length - 1)
  return { speculative, tokens: body === "" ? [] : body.split(",") }
}

// ------------------------------------------------------------ pin-context cache

/**
 * The three tiers of the pin-context cache. Only tier 3 is implemented here;
 * tiers 1 and 2 are declared so the seams have names and the integrator's work
 * has somewhere to land.
 *
 *   1 GLOBAL     artifacts true under every pin context (terrain, grammar,
 *                arrival grids of units nobody pinned). Shared, never evicted
 *                per context.
 *   2 FOOTPRINT  evaluations transferable between contexts whose changed units'
 *                influence footprints are disjoint from the evaluation's own.
 *                Needs `Substrate.influenceOf` on both sides — integrator item.
 *   3 EXCLUSIVE  entries that belong to exactly one canonical PinSet:
 *                incumbent, bounds, cursor, epoch baseline. LRU, cleared per
 *                turn. THIS TIER.
 */
export const PIN_CACHE_TIER = { GLOBAL: 1, FOOTPRINT: 2, EXCLUSIVE: 3 } as const
export type PinCacheTier = (typeof PIN_CACHE_TIER)[keyof typeof PIN_CACHE_TIER]

export interface PinContextEntry {
  readonly key: string
  readonly tier: PinCacheTier
  readonly pins: PinSet
  readonly speculative: boolean
  /** The epoch this context was first created in — its baseline. */
  readonly epochBaseline: number
  incumbent: PlanScore | null
  bounds: { lo: number; hi: number } | null
  /** The basis `bounds` was proved under — the posture that led, the epoch
   * whose pin set it assumed, and the COHORT whose objective it maximises.
   * Carried so a consumer differencing this bracket against a record can prove
   * the two share a basis (V4 B7). All three must match: two brackets under
   * different objectives are not a price, they are a category error. */
  boundsBasis: { posture: Posture; epoch: number; cohort: CohortId } | null
  /** Witnesses survive restarts and pin-context switches; they are certificates. */
  witnesses: ReadonlyArray<Witness>
  /** Refinement slices already spent here. A resume starts above zero. */
  cursor: number
  /** Units this context's bounds depend on — a catch-up on any of them invalidates it. */
  citedUnits: Set<UnitId>
  /**
   * PER-DECISION-CONTEXT cost estimator. The single most important word in
   * this file is "per": at module scope this field is the arena latch.
   */
  stepCostMs: number
  lastUsed: number
}

export interface PinCacheStats {
  hits: number
  misses: number
  /** Hits that actually restored an incumbent (an exact-hit resume). */
  resumes: number
  invalidations: number
  evictions: number
  creates: number
}

/** Tier-3 context-exclusive store: LRU, keyed by canonical PinSet, per turn. */
export class PinContextCache {
  private readonly map = new Map<string, PinContextEntry>()
  private tick = 0
  readonly stats: PinCacheStats = {
    hits: 0,
    misses: 0,
    resumes: 0,
    invalidations: 0,
    evictions: 0,
    creates: 0,
  }

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.map.size
  }

  keys(): ReadonlyArray<string> {
    return [...this.map.keys()]
  }

  peek(key: string): PinContextEntry | null {
    return this.map.get(key) ?? null
  }

  /** Fetch or create the entry for a pin context. Reports whether it resumed. */
  obtain(
    key: string,
    pins: PinSet,
    speculative: boolean,
    epoch: number,
    initialStepCostMs: number,
  ): { entry: PinContextEntry; resumed: boolean } {
    const found = this.map.get(key)
    if (found !== undefined) {
      this.stats.hits++
      found.lastUsed = ++this.tick
      const resumed = found.incumbent !== null
      if (resumed) this.stats.resumes++
      return { entry: found, resumed }
    }
    this.stats.misses++
    this.stats.creates++
    const entry: PinContextEntry = {
      key,
      tier: PIN_CACHE_TIER.EXCLUSIVE,
      pins,
      speculative,
      epochBaseline: epoch,
      incumbent: null,
      bounds: null,
      boundsBasis: null,
      witnesses: [],
      cursor: 0,
      citedUnits: new Set<UnitId>(),
      stepCostMs: initialStepCostMs,
      lastUsed: ++this.tick,
    }
    this.map.set(key, entry)
    this.evict()
    return { entry, resumed: false }
  }

  /**
   * A catch-up consumes OBSERVATIONS: it replaces a premise rather than
   * refining it, so every cached evaluation that cited the unit is now about a
   * board that never existed. Drop them.
   */
  invalidateCitingUnit(unitId: UnitId, keep?: string): number {
    let dropped = 0
    for (const [key, entry] of this.map) {
      if (key === keep) continue
      if (!entry.citedUnits.has(unitId)) continue
      this.map.delete(key)
      dropped++
    }
    // The kept (active) context cannot be dropped mid-flight, but its cached
    // conclusions are just as stale: reset it to a cold start in place.
    if (keep !== undefined) {
      const active = this.map.get(keep)
      if (active !== undefined && active.citedUnits.has(unitId)) {
        active.incumbent = null
        active.bounds = null
        active.boundsBasis = null
        active.witnesses = []
        active.cursor = 0
        active.citedUnits = new Set<UnitId>()
        dropped++
      }
    }
    this.stats.invalidations += dropped
    return dropped
  }

  /** Cleared at turn end. `decide()` builds a fresh cache, so this is belt and braces. */
  clear(): void {
    this.map.clear()
  }

  private evict(): void {
    while (this.map.size > this.capacity) {
      let oldestKey: string | null = null
      let oldest = Number.POSITIVE_INFINITY
      for (const [key, entry] of this.map) {
        if (entry.lastUsed < oldest) {
          oldest = entry.lastUsed
          oldestKey = key
        }
      }
      if (oldestKey === null) return
      this.map.delete(oldestKey)
      this.stats.evictions++
    }
  }
}

// ------------------------------------------------------------------- options

export interface KernelOptions {
  /** Held back from search for the final flush. */
  readonly reserveMs: number
  /**
   * REAL-TIME interval between event-loop yields, in ms. `0` disables the
   * yield entirely (a synchronous decision; only for harnesses that need one).
   *
   * Gated on the REAL clock, never on the injected one, because what it is
   * rationing is real event-loop starvation: a suite driving a fake clock
   * yields as rarely as its wall time earns, and production yields on the
   * schedule production needs. The cost of the yield is charged to the
   * decision like any other elapsed time — the next slice's budget is read
   * after it.
   */
  readonly yieldIntervalMs: number
  /** MINIMUM duration of one refinement slice. Bounds deadline overshoot.
   * The actual slice grows with the measured cost — see `sliceCostFactor`. */
  readonly sliceMs: number
  /** How many measured slice-costs one slice is allowed to run for. A slice
   * must be long enough to contain the work it starts: below one `price()` the
   * anytime loop re-prices its seed and stops, every time. */
  readonly sliceCostFactor: number
  /**
   * The OPERATOR's bound on that growth. Queued events are drained between
   * slices, so a slice is also the longest an operator's pin can wait to be
   * seen. No slice may own more than this fraction of the turn, however
   * expensive one has been measured to be.
   */
  readonly maxSliceFraction: number
  /** Minimum wall gap between writes. The wire has no server-side rate limit; this is it. */
  readonly minWriteIntervalMs: number
  /** Fraction of the standing gap a re-emission of the SAME plan must remove. */
  readonly gapImprovementFraction: number
  /** `floor`: a plan change needs a strictly better proven floor. `dominance`: it must reach the old ceiling. */
  readonly switchRule: "floor" | "dominance"
  /**
   * `off` is correct while emission is joint-atomic (one whole plan per
   * record). Where the submitter chunks the team across batches, the wire is
   * no longer atomic and `teammate` mode certifies the delta.
   */
  readonly crossfade: "off" | "teammate"
  /** Tier-2 of the crossfade gate. Absent ⇒ overlapping writes pass UNCERTIFIED and are counted. */
  readonly teammateFloor?: (plan: JointPlan, excluding: ReadonlySet<UnitId>) => number
  /**
   * Tier-3 of the crossfade gate: THE WIRE'S OWN CHUNK PARTITION, in commit
   * order, in this substrate's unit numbering.
   *
   * The transport cuts a revision into chunks from a STABLE partition, so a
   * revision interrupted after chunk k leaves the server holding chunks 0..k
   * from the new revision and the rest from the old one — a union of whole
   * groups from two ADJACENT revisions. Those unions are the only torn states
   * that exist, and with the partition in hand the gate prices each of them
   * directly (`teammateFloor` over the WHOLE team on the mixed plan) instead
   * of comparing two coherent plans neither of which the wire can hold.
   *
   * Absent ⇒ the gate falls back to the delta comparison, which speaks only
   * for an ADJACENT-REVISION atomic pair; such a pass is counted
   * `uncertified`, never `certified` (V4 B4).
   */
  readonly crossfadeGroups?: (plan: JointPlan) => ReadonlyArray<ReadonlyArray<UnitId>>
  /** What one slice is assumed to cost before one has been measured. */
  readonly initialStepCostMs: number
  /** How much more than the estimate must remain before another slice starts. */
  readonly stepSafetyFactor: number
  /** THE ANTI-LATCH FLOOR: the guard may never demand more than this × budget. */
  readonly guardBudgetFraction: number
  /** No single slice may be BELIEVED to cost more than this × budget. */
  readonly estimateCapFraction: number
  /** One slice in N goes to a speculative (tentative-pin) context. */
  readonly speculativePeriod: number
  readonly pinCacheCapacity: number
  readonly switchMargin: number
  readonly deadBelow: number
  /** Stability floor for the horizon ration. */
  readonly epsilon: number
  readonly depthMax: number
  /**
   * THE COHORT REGISTRY THIS KERNEL WILL ANSWER FOR. Defaults to the shipped
   * table. Held per-kernel and not read off module scope, for the same reason
   * `stepCostMs` is held per-context: a registry a caller could add to would be
   * every concurrent decision's registry, and Stage 2's per-game cohort policy
   * has to be expressible without one game's configuration reaching another's.
   *
   * The table is a CATALOGUE and not a policy: registering a row admits
   * nothing. `admission` below is what chooses.
   */
  readonly cohorts: ReadonlyArray<CohortRow>
  /**
   * THE ADMISSION POLICY, OR `null` FOR OFF — and `null` is the default.
   *
   * `null` is genuinely off, not "the policy that always answers the default":
   * with it null the kernel measures no board conditions, classifies nothing,
   * stamps no `AdmissionStamp` on any record, and opens under
   * `KernelInput.cohort ?? DEFAULT_COHORT_ID` exactly as the stage before this
   * one did. That is what makes the flag-off replay identical rather than
   * merely equivalent, and it is why the field is nullable instead of carrying
   * an "off" row.
   *
   * Threaded per-kernel — per DECISION, since a kernel is built per decision —
   * and never read off the process environment down here. A process-wide flag
   * measures nothing: two arms of one experiment sharing a process would share
   * the flag, and the composition layer is the only place that knows which arm
   * a game is in.
   */
  readonly admission: AdmissionPolicy | null
}

export const DEFAULT_KERNEL_OPTIONS: KernelOptions = {
  reserveMs: 1,
  yieldIntervalMs: 5,
  sliceMs: 0.5,
  sliceCostFactor: 5,
  maxSliceFraction: 0.1,
  minWriteIntervalMs: 2,
  gapImprovementFraction: 0.15,
  switchRule: "floor",
  crossfade: "off",
  initialStepCostMs: 0,
  stepSafetyFactor: 1.6,
  guardBudgetFraction: 0.2,
  estimateCapFraction: 0.25,
  speculativePeriod: 4,
  pinCacheCapacity: 8,
  switchMargin: DEFAULT_SWITCH_MARGIN,
  deadBelow: DEFAULT_DEAD_BELOW,
  epsilon: 1.5,
  depthMax: 2,
  cohorts: COHORTS,
  admission: null,
}

// -------------------------------------------------------------------- report

export type EmitRefusal =
  | "ratchet-floor"
  | "ratchet-gap"
  | "switch-floor"
  | "switch-dominance"
  | "worth"
  | "rate"
  | "nonconforming"
  | "crossfade"
  | "sink"
  /** A committed pin names a destination the unit's grammar cannot reach.
   * Humans always win, but an unreachable order cannot be staged: the unit
   * keeps its existing choice, the refusal is counted here once per refused
   * pin, and every emitted record carries a named `narrowing` assumption in
   * place of the operator-pin it could not honour. Never auto-unpinned. */
  | "pin-unreachable"
  /** The bounds layer proved one of its own members unsound
   * (BoundsInversionError). The slice's result is discarded — refused, never
   * clamped — the violation is counted, and the decision continues on the
   * standing incumbent. */
  | "bounds-inversion"

export interface ConformanceSample {
  readonly epoch: number
  /**
   * Clock time from the operator event ARRIVING at `onPinEvent` to the
   * conforming record leaving the kernel — not from the moment the loop got
   * round to dequeuing it. A slice is synchronous JS, so a delivered event can
   * only be observed at a yield, and the queue wait is up to one slice: it is
   * part of the operator's latency and it is measured here (V4 R2). Events
   * that arrived before this decision's run began are measured from the
   * decision's own start, which is the earliest reading on this clock.
   */
  readonly latencyMs: number
  /** Refinement slices run between the event and the re-stage. MUST be 0. */
  readonly slicesBefore: number
  readonly conformCalls: number
  readonly resumedFromCache: boolean
}

export interface BasisSnapshot {
  readonly epoch: number
  readonly posture: Posture
  /** The evaluation cohort this basis ratcheted under — WHICH OBJECTIVE the
   * floor below is a floor on. Two floors under different cohorts are floors
   * on different quantities and were never comparable; the snapshot says so. */
  readonly cohort: CohortId
  /** The channel this basis ratcheted. Cross-channel comparison never happens. */
  readonly channel: "lo" | "est"
  readonly floorLo: number
  readonly emits: number
}

export interface KernelReport {
  readonly elapsedMs: number
  readonly budgetMs: number
  readonly overshootMs: number
  readonly slices: number
  /** True when the turn resolved under the decision and it stopped early. */
  readonly abandoned: boolean
  /** Slices skipped because every unit this decision commands is pinned, so a
   * refinement slice could not have changed anything. */
  readonly idleSlices: number
  /** Event-loop yields taken. Zero over a whole decision means the process was
   * held for the whole turn — the shape V3-R2 named. */
  readonly yields: number
  readonly improveCalls: number
  readonly refineCalls: number
  readonly conformCalls: number
  readonly evaluateCalls: number
  readonly emits: number
  readonly refusals: Readonly<Record<EmitRefusal, number>>
  readonly boundViolations: number
  readonly probes: number
  readonly meanSliceCostMs: number
  readonly finalStepCostMs: number
  readonly epochs: number
  readonly conformance: ReadonlyArray<ConformanceSample>
  readonly cache: Readonly<PinCacheStats>
  readonly postureFlips: ReadonlyArray<PostureFlip>
  /**
   * WHAT THE ADMISSION POLICY DECIDED, or null when none ran. One value per
   * decision — the ladder is frozen at entry, so there is nothing to keep a
   * history of. The detectors ride with it because a refit corpus that has the
   * verdict without the evidence cannot revise the predicate that produced it.
   */
  readonly admission: AdmissionStamp | null
  /**
   * The governor state to hand this game's NEXT decision, so the dwell counts
   * across turns. A VALUE, not a shared governor: two decisions for one game
   * can overlap when a new turn abandons an old one, and a shared mutable
   * governor would let the abandoned one's measurement land after its
   * successor's. Null when no policy ran.
   */
  readonly admissionState: AdmissionState | null
  readonly basisHistory: ReadonlyArray<BasisSnapshot>
  readonly journal: ReadonlyArray<EmitRecord>
  readonly levers: ReadonlyArray<Lever>
  /**
   * The crossfade gate's own accounting.
   *
   *   independent  the changed units cannot influence any cell an unchanged
   *                staged unit can: no interleaving differs from either write.
   *   certified    a teammate floor was proved for every interleaving the WIRE
   *                can actually produce — which, when a chunk partition is
   *                supplied, means every "whole groups from two adjacent
   *                revisions" tear was priced (`tornPriced` counts those).
   *   uncertified  the write passed WITHOUT a certificate: no teammate-floor
   *                hook, or no chunk partition — in which case the delta
   *                comparison speaks only for an ADJACENT-REVISION atomic pair
   *                and is deliberately NOT reported as certified (V4 B4).
   *   blocked      some interleaving proved worse than the standing wire plan.
   */
  readonly crossfade: {
    independent: number
    certified: number
    uncertified: number
    blocked: number
    /** Certifications that priced at least one real torn interleaving. */
    tornPriced: number
    /** Forced writes (rung 0, conformance re-stage) whose certificate would
     * have refused. They ship anyway — never starved — and say so. */
    forcedUncertified: number
  }
  /** Every unit a human Submit froze this turn — the kernel's half of the
   * humans-always-win pair (the ledger owns the other half; the two must
   * agree, V4 R7a). */
  readonly committedUnits: ReadonlyArray<UnitId>
  /**
   * The speculative (tentative-pin) contexts, with the BASIS each bracket was
   * proved under. The advice layer may only difference a speculative bracket
   * against a record proved on the same posture and epoch — a cross-basis
   * comparison is the one thing the whole bounds layer exists to forbid — so
   * the basis travels with the numbers rather than being assumed (V4 B7).
   *
   * `cohort` is the third leg of that basis and is carried here for the same
   * reason. NOTE for Stage 2: `pins.ts`'s `adviseFromReport` currently tests
   * only posture and epoch when it sets `degraded`. That is complete today —
   * one decision has one cohort — and it will NOT be complete once a decision
   * can flip mid-turn. The field is here first, deliberately.
   */
  readonly speculative: ReadonlyArray<{
    key: string
    lo: number
    hi: number
    cursor: number
    posture: Posture | null
    epoch: number | null
    cohort: CohortId | null
  }>
  /** Every pin context this turn touched: the tier-3 store, as data. */
  readonly contexts: ReadonlyArray<{
    readonly key: string
    readonly speculative: boolean
    readonly cursor: number
    readonly epochBaseline: number
    readonly incumbentLo: number | null
    /** The context's best-known bracket and the basis it was proved under —
     * the same shape `speculative` carries, so an advice layer differences
     * two contexts rather than a context against a staged record. */
    readonly incumbentHi: number | null
    readonly posture: Posture | null
    readonly epoch: number | null
    readonly cohort: CohortId | null
    readonly witnesses: number
    readonly stepCostMs: number
  }>
  /** The context the wire's last record came from. */
  readonly activeContextKey: string
  /** True only if the kernel never put a plan on the wire. Must never happen. */
  readonly stagedNothing: boolean
  /** False when the SearchCore exposed no lever surface: the lever order was advisory. */
  readonly leverOrderBinding: boolean
}

// ------------------------------------------------------------------ internals

/**
 * The ratchet's basis. ONE of these exists at a time; `newBasis` replaces it.
 * There is no collection of them, which is what makes a cross-basis comparison
 * unrepresentable rather than merely unusual.
 */
interface RatchetBasis {
  readonly epoch: number
  readonly posture: Posture
  /**
   * The OBJECTIVE this basis ratchets. Without it, a cohort change that lowers
   * `lo` — which is expected, because a different feature set is a different
   * quantity and not a weaker proof of the same one — reaches Gate 1 as a
   * ratchet-floor refusal and is counted as a `boundViolation`: the kernel
   * would be calling the search unsound for answering the question it was
   * asked. Epoch, posture and cohort are the three things that make a floor a
   * floor on something; all three live here.
   */
  readonly cohort: CohortId
  /**
   * The channel this basis ratchets. Under FOGGED-VACUOUS every candidate's lo
   * sits on the cliff by construction, so a floor ratchet would freeze the
   * wire at whatever happened to be staged when the posture flipped — the
   * passivity the posture exists to escape. The LEADING channel is what
   * ratchets; lo keeps its own (basis-scoped) floor underneath, so ordering by
   * est can never lower the promise.
   */
  readonly channel: "lo" | "est"
  floorLo: number
  floorChannel: number
  stagedHi: number
  maxGap: number
  staged: EmitRecord | null
  stagedPlan: JointPlan | null
  emits: number
}

function newBasis(epoch: number, posture: Posture, cohort: CohortId): RatchetBasis {
  return {
    epoch,
    posture,
    cohort,
    channel: channelPolicyFor(posture).orderBy,
    floorLo: Number.NEGATIVE_INFINITY,
    floorChannel: Number.NEGATIVE_INFINITY,
    stagedHi: Number.NEGATIVE_INFINITY,
    maxGap: Number.POSITIVE_INFINITY,
    staged: null,
    stagedPlan: null,
    emits: 0,
  }
}

/**
 * One root plan and what this decision currently believes about it.
 *
 * `cohort` is what `bound` and `score` were proved under, and it is MUTABLE
 * for the same reason they are: a cohort flip re-measures the row and re-stamps
 * it, or drops it. A row whose stamp is not the active cohort is not a stale
 * estimate of the right quantity — it is an exact statement about a different
 * one — so `rows()` filters on it rather than ageing it out.
 */
interface PlanCandidate {
  readonly key: string
  readonly plan: JointPlan
  score: PlanScore | null
  bound: Bound
  horizon: number
  cohort: CohortId
}

/** Consecutive slices that charge nothing to the clock before the loop gives
 * up. See the rail's note in `drive`. */
const STALL_LIMIT = 1024

const EMPTY_PLAN: JointPlan = new Map()
const NO_UNITS: ReadonlySet<UnitId> = new Set<UnitId>()

/**
 * Every state the wire can actually hold while a chunked revision lands:
 * `groups 0..k−1` from the new plan, the rest still holding the old one, for
 * every cut k that separates two CHANGED units. A cut with no changed unit on
 * one side of it produces a plan identical to one of the two coherent ones, so
 * it is not a torn state and is not priced.
 */
function tornPlans(
  prevPlan: JointPlan,
  plan: JointPlan,
  groups: ReadonlyArray<ReadonlyArray<UnitId>>,
  changed: ReadonlySet<UnitId>,
): JointPlan[] {
  const out: JointPlan[] = []
  for (let k = 1; k < groups.length; k++) {
    let changedLanded = false
    let changedPending = false
    for (let i = 0; i < groups.length; i++) {
      for (const unitId of groups[i] as ReadonlyArray<UnitId>) {
        if (!changed.has(unitId)) continue
        if (i < k) changedLanded = true
        else changedPending = true
      }
    }
    if (!changedLanded || !changedPending) continue
    const mixed = new Map(plan)
    for (let i = k; i < groups.length; i++) {
      for (const unitId of groups[i] as ReadonlyArray<UnitId>) {
        const old = prevPlan.get(unitId)
        if (old !== undefined) mixed.set(unitId, old)
      }
    }
    out.push(mixed)
  }
  return out
}

interface Run {
  readonly input: KernelInput
  readonly now: () => number
  readonly t0: number
  readonly budgetMs: number
  readonly deadline: number
  readonly searchDeadline: number
  readonly cache: PinContextCache
  readonly governor: PostureGovernor
  readonly stager: StickyStager
  readonly voc: VocOrchestrator
  readonly refiner: Refiner | null
  readonly plans: Map<string, PlanCandidate>
  readonly journal: EmitRecord[]
  readonly conformance: ConformanceSample[]
  readonly basisHistory: BasisSnapshot[]
  pins: Pin[]
  tentative: Pin[]
  /**
   * The plan the WIRE currently holds — the last record a consumer actually
   * took. Distinct from `basis.stagedPlan`, which is ratchet state and is
   * dropped with its basis on every epoch and posture change: the wire does
   * not forget what it is holding just because the kernel re-based. The
   * conformance re-stage splices pins into THIS (so an epoch change repairs
   * the staged set instead of rebuilding it from the generator's first
   * candidates), the crossfade gate tears against THIS, and a human's commit
   * reads the unit's destination from THIS.
   */
  wirePlan: JointPlan | null
  committedUnits: Set<UnitId>
  /** Narrowings declared mid-decision by the consumer (`declare`): they ride
   * every record emitted from the moment they are learned. */
  declared: Assumption[]
  /** Committed pins whose destination the unit's grammar cannot reach, keyed
   * by unitId → the refused destination. See EmitRefusal "pin-unreachable". */
  refusedPins: Map<UnitId, number>
  epoch: number
  /**
   * THE ACTIVE COHORT — which objective this decision is currently proving
   * things about. Mutable because `governCohort` may replace it mid-decision;
   * constant for the whole of every Stage 1 production decision, because no
   * production caller flips it yet.
   */
  cohort: CohortId
  /**
   * THE EVALUATOR THIS DECISION IS PROVING WITH — the one that computes
   * `cohort`. It is `input.evaluate` unless an admission policy chose a
   * different cohort AND `input.evaluators` names an evaluator for it, and it
   * is resolved ONCE, at decision entry, beside the cohort itself. Two fields
   * that must agree are set in one place so they cannot disagree.
   */
  readonly evaluate: Evaluator
  /**
   * WHAT THE POLICY DECIDED, or null when no policy ran. Frozen at decision
   * entry: nothing in the loop writes it, which is the freeze rule expressed
   * as an absence of code rather than as a comment.
   */
  readonly admission: AdmissionStamp | null
  /** The governor state to hand the next decision on this game, so the dwell
   * counts across turns without two decisions sharing a mutable governor. */
  readonly admissionState: AdmissionState | null
  basis: RatchetBasis
  active: PinContextEntry
  lastView: LeverView | null
  seq: number
  lastWriteMs: number
  /** Real-clock reading of the last event-loop yield. */
  lastYieldWall: number
  yields: number
  aborted: boolean
  idleSlices: number
  slices: number
  probes: number
  improveCalls: number
  refineCalls: number
  conformCalls: number
  evaluateCalls: number
  sliceCostTotal: number
  boundViolations: number
  refusals: Record<EmitRefusal, number>
  crossfade: {
    independent: number
    certified: number
    uncertified: number
    blocked: number
    tornPriced: number
    forcedUncertified: number
  }
}

/**
 * A queued operator event with the clock reading at which it ARRIVED — never
 * the reading at which the loop got round to it (V4 R2). `at === null` marks
 * an event that arrived before this decision's run existed: there was no
 * injected clock to stamp it with, so it is measured from the decision's own
 * start, which is the earliest honest reading on the run's clock.
 */
interface PendingEvent {
  readonly ev: PinEvent
  readonly at: number | null
}

// -------------------------------------------------------------------- kernel

export class LobsterKernel implements Kernel {
  private readonly opts: KernelOptions
  /** Instance state, drained by `decide()`. Never module scope. */
  private pending: PendingEvent[] = []
  private run: Run | null = null
  private report: KernelReport | null = null

  constructor(options: Partial<KernelOptions> = {}) {
    this.opts = { ...DEFAULT_KERNEL_OPTIONS, ...options }
  }

  get lastReport(): KernelReport | null {
    return this.report
  }

  /**
   * Operator constraint events. Queued, applied at the top of the next loop
   * iteration — which is the next slice boundary, never mid-resolution.
   *
   * The arrival is STAMPED HERE (V4 R2) so the conformance latency the report
   * publishes is the operator's, not the loop's. And the queue is NOT cleared
   * when the loop first runs: `decide()` returns an async iterable whose body
   * does not execute until the consumer's first `next()`, and an event that
   * lands in that window is the operator's just as much as one that lands a
   * slice later (V4 R7b). It is cleared when a decision ENDS instead.
   */
  onPinEvent(ev: PinEvent): void {
    this.pending.push({ ev, at: this.run === null ? null : this.run.now() })
  }

  /**
   * Declare a narrowing the CONSUMER discovered while draining this decision —
   * a staged move the wire could not express, say. It rides every record
   * emitted from this point on, exactly as the kernel's own pin-unreachable
   * narrowing does: a default is a narrowing and must be named, and the module
   * that discovers one is not always the module that emits the record.
   *
   * Ignored (and reported as such) outside a live decision — there is nothing
   * for it to ride.
   */
  declare(assumption: Assumption): boolean {
    if (this.run === null) return false
    const key = JSON.stringify(assumption)
    if (this.run.declared.some((a) => JSON.stringify(a) === key)) return true
    this.run.declared.push(assumption)
    return true
  }

  async *decide(input: KernelInput): AsyncIterable<EmitRecord> {
    const now = input.now ?? defaultNow
    const t0 = now()
    const budgetMs = Math.max(0, input.deadlineMs - t0)
    const deadline = t0 + budgetMs
    const searchDeadline = deadline - this.opts.reserveMs
    const initialStepCostMs =
      input.initialStepCostMs ?? this.opts.initialStepCostMs ?? this.opts.sliceMs
    // THE COHORT IS FIXED FOR THE DECISION HERE, and refused here if the
    // registry does not know it. A bound stamped with an objective nobody can
    // look up is indistinguishable from a sound one until someone tries to
    // compare it, which is months later and in a refit corpus.
    //
    // ── ADMISSION, ONCE, HERE, AND NOWHERE ELSE ─────────────────────────────
    //
    // With a policy configured, the board — not the caller — names the
    // objective, and it names it exactly once. This is the freeze: the ladder
    // is an INPUT to the turn rather than state within it, and the way that is
    // enforced is that no other line in this file measures admission. A
    // catch-up cannot flip it because nothing re-measures; a slice cannot flip
    // it because nothing re-measures; an epoch cannot flip it because nothing
    // re-measures — and, separately, because every condition is a function of
    // the substrate's turn-start roster and claim field, which an epoch does
    // not touch, so a re-measurement would be provably identical anyway.
    //
    // A refinement-driven admission flip would put a non-monotone switch
    // inside the refinement lattice, which is outside what the monotonicity
    // law even speaks about. Excluded structurally, not dwell-guarded around.
    const admitted = this.admit(input)
    const cohort = admitted?.stamp.activeCohort ?? input.cohort ?? DEFAULT_COHORT_ID
    requireCohortRowIn(this.opts.cohorts, cohort)
    const evaluate = this.evaluatorFor(input, cohort, admitted !== null)
    const cache = new PinContextCache(this.opts.pinCacheCapacity)
    const pins = canonicalPins(input.initialPins)
    const seeded = cache.obtain(
      pinContextKey(pins),
      pins,
      false,
      0,
      initialStepCostMs || this.opts.sliceMs,
    )
    const run: Run = {
      input,
      now,
      t0,
      budgetMs,
      deadline,
      searchDeadline,
      cache,
      governor: new PostureGovernor("SIGHTED"),
      stager: new StickyStager(this.opts.switchMargin, this.opts.deadBelow),
      voc: new VocOrchestrator(this.opts.deadBelow),
      refiner: asRefiner(input.search),
      plans: new Map(),
      journal: [],
      conformance: [],
      basisHistory: [],
      pins,
      tentative: input.initialPins.filter((p) => p.tentative),
      wirePlan: null,
      committedUnits: new Set<UnitId>(),
      declared: [],
      refusedPins: new Map<UnitId, number>(),
      epoch: 0,
      cohort,
      evaluate,
      admission: admitted?.stamp ?? null,
      admissionState: admitted?.state ?? null,
      basis: newBasis(0, "SIGHTED", cohort),
      active: seeded.entry,
      lastView: null,
      seq: 0,
      lastWriteMs: Number.NEGATIVE_INFINITY,
      lastYieldWall: defaultNow(),
      yields: 0,
      aborted: false,
      idleSlices: 0,
      slices: 0,
      probes: 0,
      improveCalls: 0,
      refineCalls: 0,
      conformCalls: 0,
      evaluateCalls: 0,
      sliceCostTotal: 0,
      boundViolations: 0,
      refusals: {
        "ratchet-floor": 0,
        "ratchet-gap": 0,
        "switch-floor": 0,
        "switch-dominance": 0,
        worth: 0,
        rate: 0,
        nonconforming: 0,
        crossfade: 0,
        sink: 0,
        "pin-unreachable": 0,
        "bounds-inversion": 0,
      },
      crossfade: {
        independent: 0,
        certified: 0,
        uncertified: 0,
        blocked: 0,
        tornPriced: 0,
        forcedUncertified: 0,
      },
    }
    // NOT `this.pending = []`: events queued between `decide()` and the
    // consumer's first `next()` belong to THIS decision (V4 R7b). The queue is
    // cleared when the decision ends, below.
    this.run = run
    this.auditPins(run)
    try {
      yield* this.drive(run)
    } finally {
      run.basisHistory.push(basisSnapshot(run.basis))
      this.report = this.finish(run)
      // The core may keep a bank and a memo alive between slices; a decision
      // ending is where they must go back.
      try {
        run.input.search.release?.()
      } catch {
        /* a core that cannot close is not a reason to lose the report */
      }
      this.run = null
      this.pending = []
    }
  }

  // ------------------------------------------------------------- the loop

  private async *drive(run: Run): AsyncIterable<EmitRecord> {
    // ---- Rung 0: a conforming, legal joint plan on the wire before any
    // refinement runs. `conform(ctx, ∅)` is contractually a complete legal
    // plan: staging nothing is not an option this kernel has.
    const seed = this.conformNow(run, EMPTY_PLAN)
    run.stager.adopt(seed.key)
    const first = this.buildRecord(run, seed)
    yield* this.commit(run, first)

    // A slice that charges nothing to the clock cannot end the turn, so the
    // loop needs a stop the clock cannot provide. It is a bug rail, not a
    // policy: a search that never spends time has nothing to sell, and after
    // STALL_LIMIT consecutive free slices the honest conclusion is that this
    // decision is not going to buy anything with the rest of its budget.
    // Under any real clock `stalled` never accumulates at all.
    let iterations = 0
    let stalled = 0
    let lastTick = run.now()
    while (run.now() < run.searchDeadline) {
      if (++iterations > 1_000_000) break
      const tick = run.now()
      if (tick === lastTick) {
        if (++stalled > STALL_LIMIT) break
      } else {
        stalled = 0
        lastTick = tick
      }

      // 0. HAND THE PROCESS BACK. Everything the anytime design needs —
      //    the operator's pin arriving on a Firestore listener, the manager's
      //    coalesced staged write, the final-flush timer, the other games —
      //    lives on the macrotask queue, and a slice never touches it. The
      //    yield is taken BEFORE the pending check so an event delivered by it
      //    opens its epoch in this same iteration.
      if (this.opts.yieldIntervalMs > 0) {
        const wall = defaultNow()
        if (wall - run.lastYieldWall >= this.opts.yieldIntervalMs) {
          await yieldToEventLoop()
          run.lastYieldWall = defaultNow()
          run.yields++
          if (run.now() >= run.searchDeadline) break
        }
      }

      // 0½. THE TURN MAY ALREADY BE OVER. An early resolution (every alive
      //     player committed) ends the turn well before its endTime, and every
      //     further write is accepted and discarded. Stop here — before any
      //     emission, and without the final flush — so the budget and the wire
      //     go to the turn that is actually live.
      if (run.input.abandoned?.() === true) {
        run.aborted = true
        return
      }

      // 1. Constraint epochs come first: the wire must never hold a set that
      //    contradicts an operator, not even for one slice.
      if (this.pending.length > 0) {
        const at = this.earliestArrival(run)
        const slicesAtEvent = run.slices
        const changed = this.applyPinEvents(run)
        if (changed) {
          const conformCallsBefore = run.conformCalls
          const resumed = this.retarget(run)
          // Splice the new pins into what the WIRE is holding, not into the
          // freshly-emptied basis: an epoch change repairs the staged set, it
          // does not rebuild it from the generator's first candidates.
          const conformed = this.conformNow(run, run.wirePlan ?? EMPTY_PLAN)
          run.stager.adopt(conformed.key)
          const rec = this.buildRecord(run, conformed)
          yield* this.commit(run, rec)
          run.conformance.push({
            epoch: run.epoch,
            latencyMs: Math.max(0, run.now() - at),
            slicesBefore: run.slices - slicesAtEvent,
            conformCalls: run.conformCalls - conformCallsBefore,
            resumedFromCache: resumed,
          })
          continue
        }
      }

      // 1½. NOTHING COMMANDABLE IS FREE. With every unit this decision
      //     commands pinned, a refinement slice has nothing it is allowed to
      //     move: the sweep, the repair and the polish all skip pinned units,
      //     so `improve` can only re-price the incumbent and be refused on
      //     `worth`. Hand the time back instead of burning it (V1-OBS-3) —
      //     the operator can still unpin, and an event wakes the loop.
      if (run.tentative.length === 0 && this.everythingPinned(run)) {
        run.idleSlices++
        if (this.opts.yieldIntervalMs <= 0) break
        await yieldToEventLoop()
        run.lastYieldWall = defaultNow()
        run.yields++
        continue
      }

      // 2. Context: the committed one, or — one slice in N — a speculative one.
      let entry = this.pickContext(run)
      const remaining = run.searchDeadline - run.now()
      if (remaining <= 0) break

      // 3. The affordability guard, floored at 0.2 × budget, with an
      //    unconditional first probe. This is the anti-latch.
      const need = (e: PinContextEntry): number =>
        Math.min(
          e.stepCostMs * this.opts.stepSafetyFactor,
          run.budgetMs * this.opts.guardBudgetFraction,
        )
      // Speculation is what gets dropped when the budget tightens, never the
      // committed decision: an unaffordable speculative slice yields its turn
      // back rather than ending the turn.
      if (entry.speculative && remaining < need(entry)) entry = run.active
      const probe = entry.cursor === 0
      if (remaining < need(entry) && !probe) break
      if (probe && remaining < need(entry)) run.probes++

      // 4. One refinement slice.
      // ADAPTIVE SLICE LENGTH. A slice shorter than the work inside it is not
      // a slice, it is an interruption: at production team sizes one bank
      // `price()` is most of a 25 ms slice, so the loop spent every slice
      // pricing a seed and stopping before it swept a second unit — 370
      // slices over ten seconds produced the identical bracket to 18 over
      // one. The floor is the configured `sliceMs`; above it the slice is
      // sized to what a slice has actually been MEASURED to cost, and capped
      // so no single slice may believe it owns more than its share of the
      // so no single slice may own more than its share of the turn — which is
      // also the longest an operator's pin can wait to be drained, because
      // events are taken between slices and never inside one.
      const measured = entry.stepCostMs * this.opts.sliceCostFactor
      const cap = Math.max(run.budgetMs * this.opts.maxSliceFraction, this.opts.sliceMs)
      const sliceLength = Math.min(Math.max(this.opts.sliceMs, measured), cap)
      const sliceEnd = Math.min(run.searchDeadline, run.now() + sliceLength)
      const budget = new SliceBudget(run.now, run.t0, sliceEnd)
      const ctx = this.searchContext(run, entry, budget)
      const s0 = run.now()
      let score: PlanScore | null = null
      let lever: Lever | null = null
      try {
        if (run.refiner !== null) {
          const view = run.refiner.refinementView(ctx)
          if (!entry.speculative) run.lastView = view
          lever = run.voc.next(view, run.governor.policy)
          if (lever.kind === "stop") {
            score = run.input.search.improve(ctx)
            run.improveCalls++
          } else {
            score = run.refiner.refine(ctx, lever)
            run.refineCalls++
          }
        } else {
          score = run.input.search.improve(ctx)
          run.improveCalls++
        }
      } catch (err) {
        // A BoundsInversionError means some bounds-layer member is UNSOUND.
        // The bank throws it deliberately loudly; the kernel's job is to
        // refuse the slice's result — never to clamp it into a confident lie —
        // count the violation, and keep the decision alive on the standing
        // incumbent (B2 open item 5). Anything else still kills the decision.
        if ((err as { code?: string }).code !== "bounds_inversion") throw err
        // The counter says HOW MANY; the message says which two members
        // disagreed and by how much, which is the only thing that identifies
        // the unsound one. Inversions arrive in storms — every slice of a
        // handful of decisions — so printing them unconditionally would bury a
        // log, and printing none makes the counter unactionable. Env-gated:
        // CENTAUR_DEBUG_INVERSION=1 while reproducing.
        if (process.env.CENTAUR_DEBUG_INVERSION) {
          process.stderr.write(`INVERSION ${(err as Error).message}\n`)
        }
        run.boundViolations++
        run.refusals["bounds-inversion"]++
      }
      const s1 = run.now()
      run.slices++
      this.observeSliceCost(run, entry, s1 - s0)
      entry.cursor++
      if (score === null) continue
      this.absorb(run, entry, score)

      // A catch-up consumes observations, so every cached conclusion that
      // cited the unit is about a board that never existed.
      if (lever !== null && lever.kind === "catchup") {
        run.cache.invalidateCitingUnit(lever.unit, entry.key)
      }

      if (entry.speculative) continue

      // 4½. An event that arrived DURING this slice is already an operator
      //     constraint, and the emit gates below would happily put a set on
      //     the wire that contradicts it — one write, one slice late. The
      //     wire must never hold a set that contradicts an operator, not even
      //     for one slice, so the emission yields to the epoch (V1-BUG-3).
      if (this.pending.length > 0) continue

      // 5. Measure the board conditions and let the governor flip. A flip
      //    starts a new basis and RE-MEASURES the incumbent under the new
      //    channel before anything may replace it (the same-evaluator rule).
      this.governPosture(run, entry)

      // 6. The emit gates.
      const cand = run.plans.get(planKey(score.plan))
      if (cand === undefined) continue
      const rec = this.stageAndGate(run, /* forced */ false)
      if (rec !== null) yield* this.commit(run, rec)
    }

    // ---- Final flush. The improvement threshold and the rate limit are
    // waived; the ratchet and the crossfade certificate are not. A flush may
    // never stage something worse than what is already on the wire.
    const flush = this.stageAndGate(run, /* forced */ true)
    if (flush !== null) yield* this.commit(run, flush)
  }

  // --------------------------------------------------------------- epochs

  /**
   * When the earliest still-queued operator event actually arrived. Clamped
   * into `[t0, now]`: an event stamped on another clock (one queued before the
   * run existed) must never produce a negative or fabricated latency.
   */
  private earliestArrival(run: Run): number {
    const now = run.now()
    let earliest = Number.POSITIVE_INFINITY
    for (const p of this.pending) {
      const at = p.at ?? run.t0
      if (at < earliest) earliest = at
    }
    if (!Number.isFinite(earliest)) return now
    return Math.min(Math.max(earliest, run.t0), now)
  }

  /** Apply queued events. Returns true iff a new constraint epoch started. */
  private applyPinEvents(run: Run): boolean {
    let epochChanged = false
    const events = this.pending.map((p) => p.ev)
    this.pending = []
    for (const ev of events) {
      switch (ev.kind) {
        case "pin": {
          if (ev.pin.tentative) {
            // Not binding: a speculative context, never an epoch.
            run.tentative = run.tentative
              .filter((p) => p.unitId !== ev.pin.unitId)
              .concat(ev.pin)
            break
          }
          if (run.committedUnits.has(ev.pin.unitId)) break // permanent for the turn
          run.pins = canonicalPins(
            run.pins.filter((p) => p.unitId !== ev.pin.unitId).concat(ev.pin),
          )
          epochChanged = true
          break
        }
        case "unpin": {
          const hadTentative = run.tentative.some((p) => p.unitId === ev.unitId)
          if (hadTentative) run.tentative = run.tentative.filter((p) => p.unitId !== ev.unitId)
          if (run.committedUnits.has(ev.unitId)) break // the bot never un-commits a human
          const hadCommitted = run.pins.some((p) => p.unitId === ev.unitId)
          if (hadCommitted) {
            run.pins = run.pins.filter((p) => p.unitId !== ev.unitId)
            epochChanged = true
          }
          break
        }
        case "commit": {
          // A human Submit: the unit is permanent for the turn.
          //
          // THE FREEZE IS LEARNED UNCONDITIONALLY (V4 R7a). There are two
          // humans-always-win gates — this `committedUnits` set and the wire
          // ledger's own committed set — and they must agree about who is
          // frozen. A unit with neither a staged move nor a standing pin has
          // no destination for the kernel to pin it AT, but the freeze is a
          // fact about the operator, not about whether this kernel happens to
          // know where the unit went: record it first, then pin it if there is
          // somewhere to pin it to.
          run.committedUnits.add(ev.unitId)
          run.tentative = run.tentative.filter((p) => p.unitId !== ev.unitId)
          const staged = run.wirePlan?.get(ev.unitId)
          const to = staged?.to ?? run.pins.find((p) => p.unitId === ev.unitId)?.to
          if (to === undefined) break // frozen, with no destination to claim
          run.pins = canonicalPins(
            run.pins
              .filter((p) => p.unitId !== ev.unitId)
              .concat({ unitId: ev.unitId, to, tentative: false }),
          )
          epochChanged = true
          break
        }
      }
    }
    if (!epochChanged) return false
    this.auditPins(run)
    run.basisHistory.push(basisSnapshot(run.basis))
    run.epoch++
    // A NEW basis object. The old one is dropped on the floor: no map from
    // epoch to floor exists, so nothing in the new epoch can be compared with
    // anything proved in the old one.
    run.basis = newBasis(run.epoch, run.governor.current, run.cohort)
    // Plans proved under the old pins are not comparable under the new ones —
    // and neither is the refinement view that ranked them.
    run.plans.clear()
    run.lastView = null
    return true
  }

  /**
   * Which committed pins the substrate's grammar cannot honour. HUMANS ALWAYS
   * WIN — but an unreachable order cannot be staged, and pretending otherwise
   * would freeze the wire behind a conformance gate no plan can pass. The
   * ruling (integrator decision, B2 open item 6): the unit keeps its existing
   * choice; each refusal is counted ONCE (per pin destination) on the
   * "pin-unreachable" channel; every emitted record substitutes a named
   * `narrowing` assumption for the operator-pin it could not honour; and the
   * pin itself is NEVER dropped — the operator sees the refusal, and only the
   * operator unpins.
   *
   * Reachability is asked of the substrate's own grammar (`pathOf`), the same
   * oracle the staged wire order would be interpreted by. A substrate that
   * cannot answer (a stub without a live board) refuses no pins.
   */
  private auditPins(run: Run): void {
    const next = new Map<UnitId, number>()
    for (const pin of run.pins) {
      let reachable = true
      try {
        reachable = run.input.sub.pathOf(pin.unitId, pin.to) !== null
      } catch {
        reachable = true // an unanswerable substrate refuses nothing
      }
      if (reachable) continue
      next.set(pin.unitId, pin.to)
      if (run.refusedPins.get(pin.unitId) !== pin.to) {
        run.refusals["pin-unreachable"]++
      }
    }
    run.refusedPins = next
  }

  /** Every committed pin this run can actually honour. */
  private honorablePins(run: Run): Pin[] {
    return run.pins.filter((p) => run.refusedPins.get(p.unitId) !== p.to)
  }

  /** Point the active context at the new pin set; report an exact-hit resume. */
  private retarget(run: Run): boolean {
    const key = pinContextKey(run.pins)
    const { entry, resumed } = run.cache.obtain(
      key,
      run.pins,
      false,
      run.epoch,
      run.active.stepCostMs,
    )
    run.active = entry
    return resumed
  }

  // -------------------------------------------------------------- contexts

  private pickContext(run: Run): PinContextEntry {
    if (run.tentative.length === 0) return run.active
    if (run.slices === 0) return run.active // the committed context is served first
    if (run.slices % this.opts.speculativePeriod !== 0) return run.active
    const which = run.tentative[
      Math.floor(run.slices / this.opts.speculativePeriod) % run.tentative.length
    ] as Pin
    const committed = canonicalPins(run.pins).filter((p) => p.unitId !== which.unitId)
    // THE KEY NAMES IT TENTATIVE; THE CONTEXT SEARCHES IT AS BINDING.
    //
    // A speculative context exists to answer "what would this pin cost?", and
    // the search honours a pin only when it is not flagged tentative — so
    // handing it the tentative flag made every speculative slice re-search the
    // UNCONSTRAINED problem under a name claiming otherwise, and the advice
    // layer then differenced two searches of the same question and reported
    // the pin as free (V1-BUG-4: 0 of 289 speculative slices honoured the pin
    // they were named for; costly pins bracketed 11/34 instead of 33/34). The
    // key keeps the `?` marker because that is the advice layer's handle on
    // this context; the pin set inside it is binding.
    const key = pinContextKey([...committed, which], true)
    const pins: Pin[] = [...committed, { ...which, tentative: false }]
    return run.cache.obtain(key, pins, true, run.epoch, run.active.stepCostMs).entry
  }

  private searchContext(run: Run, entry: PinContextEntry, budget: BudgetHandle): SearchContext {
    // A REFUSED PIN IS NOT AN OPERATOR-PIN CLAIM (V1-BUG-2). The pin stands —
    // the bot never unpins — but the search cannot honour a destination the
    // grammar cannot reach, and handing it to the basis made every score in
    // the context assert an `operator-pin` the plan visibly contradicts, so a
    // record carried both the refusal narrowing and the claim it refutes. The
    // refusal rides as the narrowing it is, and nothing else.
    const refused = run.pins.filter((p) => run.refusedPins.get(p.unitId) === p.to)
    return {
      sub: run.input.sub,
      gen: run.input.gen,
      evaluate: run.evaluate,
      asTeam: run.input.asTeam,
      pins: entry.pins.filter((p) => run.refusedPins.get(p.unitId) !== p.to),
      // The decision's standing basis (reference actions, held-capacity
      // narrowings) plus the two FRAMING assumptions — the current posture and
      // the active cohort. Both name the question rather than restricting the
      // game, so every plan a context prices shares one basis, and a flip of
      // either re-bases rather than compares. Same line, same idiom: an
      // evaluator's identity never travels as a flag (anti-spaghetti rule 1).
      assumptions: [
        ...(run.input.assumptions ?? []),
        ...refused.map(
          (p): Assumption => ({
            kind: "narrowing",
            unitId: p.unitId,
            note: `operator-pin-unreachable@${p.to}: unit keeps its own choice`,
          }),
        ),
        { kind: "posture", posture: run.governor.current },
        this.cohortAssumption(run.cohort),
      ],
      incumbent: entry.incumbent,
      witnesses: entry.witnesses,
      budget,
    }
  }

  /** Fold a returned score into the context and the candidate table. */
  private absorb(run: Run, entry: PinContextEntry, score: PlanScore): void {
    entry.incumbent = score
    entry.bounds = { lo: score.bounds.worst, hi: score.bounds.best }
    // The basis this bracket was proved under travels with it: an advice layer
    // differencing it against a record must be able to prove the two agree.
    entry.boundsBasis = { posture: run.governor.current, epoch: run.epoch, cohort: run.cohort }
    if (score.witnesses.length > 0) {
      const seen = new Set(entry.witnesses.map(witnessKey))
      const merged = entry.witnesses.slice()
      for (const w of score.witnesses) {
        const k = witnessKey(w)
        if (!seen.has(k)) {
          seen.add(k)
          merged.push(w)
        }
      }
      entry.witnesses = merged
    }
    for (const e of score.bounds.ledger) entry.citedUnits.add(e.unitId)
    if (entry.speculative) return
    const key = planKey(score.plan)
    const bound = this.evaluateBound(run, score.plan)
    const horizon = run.lastView?.horizon ?? 1
    const existing = run.plans.get(key)
    if (existing === undefined) {
      run.plans.set(key, { key, plan: score.plan, score, bound, horizon, cohort: run.cohort })
    } else {
      existing.score = score
      existing.bound = bound
      existing.horizon = horizon
      existing.cohort = run.cohort
    }
  }

  /**
   * Map a staging row back to a plan. With a lever surface the rows include
   * RIVALS the kernel has never scored itself — root slack is a rival
   * quantity, not a bound gap — so a rival row is materialised from the view
   * (no extra evaluation: the view already carries the triple).
   */
  private candidateFor(run: Run, row: StagingCandidate): PlanCandidate | null {
    const existing = run.plans.get(row.key)
    if (existing !== undefined) return existing
    const c = run.lastView?.candidates.find((x) => x.key === row.key)
    if (c === undefined) return null
    const cand: PlanCandidate = {
      key: c.key,
      plan: c.plan,
      score: null,
      bound: { lo: c.lo, est: c.est, hi: c.hi },
      horizon: c.horizon,
      // The row the view handed us carries its own stamp; `rows()` has already
      // refused any row whose stamp is not the active cohort, so this is the
      // active one — taken from the row rather than from `run` so the two can
      // never silently disagree.
      cohort: c.cohort,
    }
    run.plans.set(c.key, cand)
    return cand
  }

  /**
   * The slack that goes on the wire. With a lever surface this is the true
   * root slack `max_R(R.hi − L.lo)`. Without one the kernel sees a single
   * incumbent and cannot know the rivals, so it reports the incumbent's own
   * bound gap and the report says the lever order was advisory. Integrator
   * item: the real SearchCore should supply the pair.
   */
  private slackFor(
    run: Run,
    rows: ReadonlyArray<StagingCandidate>,
    idx: number,
    row: StagingCandidate,
  ): number {
    if (run.lastView !== null && idx >= 0) return rootSlack(rows, idx)
    return Math.max(0, row.hi - row.lo)
  }

  /** Fold in whatever the core absorbed on our behalf. A refusal it swallowed
   * to keep a legal plan on the wire is still a refusal, and it is counted on
   * the same channel a slice's would be. */
  private drainCoreRefusals(run: Run): void {
    const drained = run.input.search.drainRefusals?.()
    if (drained === undefined || drained.boundsInversions <= 0) return
    run.boundViolations += drained.boundsInversions
    run.refusals["bounds-inversion"] += drained.boundsInversions
  }

  private evaluateBound(run: Run, plan: JointPlan): Bound {
    run.evaluateCalls++
    return run.evaluate.scorePlan(run.input.sub, plan, run.input.asTeam)
  }

  private conformNow(run: Run, from: JointPlan): PlanCandidate {
    const budget = new SliceBudget(run.now, run.t0, run.searchDeadline)
    const ctx = this.searchContext(run, run.active, budget)
    run.conformCalls++
    const plan = run.input.search.conform(ctx, from)
    this.drainCoreRefusals(run)
    const key = planKey(plan)
    const bound = this.evaluateBound(run, plan)
    const existing = run.plans.get(key)
    if (existing !== undefined) {
      existing.bound = bound
      // `bound` was just measured under the ACTIVE evaluator, so the row is
      // now a statement about the active cohort whatever it was before.
      if (existing.cohort !== run.cohort) {
        existing.cohort = run.cohort
        existing.score = null
      }
      return existing
    }
    const cand: PlanCandidate = {
      key,
      plan,
      score: run.active.incumbent !== null && planKey(run.active.incumbent.plan) === key
        ? run.active.incumbent
        : null,
      bound,
      horizon: 1,
      cohort: run.cohort,
    }
    run.plans.set(key, cand)
    return cand
  }

  // ---------------------------------------------------------------- clock

  /**
   * EWMA on slice cost: rises taken whole, falls taken slowly, and the whole
   * thing capped at a quarter of the budget so no single slice may be BELIEVED
   * to cost more than that. Per-context — the field lives on the entry.
   */
  private observeSliceCost(run: Run, entry: PinContextEntry, observed: number): void {
    run.sliceCostTotal += observed
    const cap = Math.max(run.budgetMs * this.opts.estimateCapFraction, 0.05)
    const blended =
      observed > entry.stepCostMs ? observed : entry.stepCostMs * 0.8 + observed * 0.2
    entry.stepCostMs = Math.min(blended, cap)
  }

  // -------------------------------------------------------------- postures

  private governPosture(run: Run, entry: PinContextEntry): void {
    if (entry.incumbent === null) return
    const conditions = this.measure(run, entry)
    const flip = run.governor.observe(conditions, run.now() - run.t0)
    if (flip === null) return
    // A flip changes the leading channel, so the ratchet must not compare
    // across it. New basis — and the incumbent is RE-MEASURED under the new
    // channel before it may be replaced (the same-evaluator rule).
    run.basisHistory.push(basisSnapshot(run.basis))
    const carried = run.basis.staged
    const carriedPlan = run.basis.stagedPlan
    run.basis = newBasis(run.epoch, flip.to, run.cohort)
    if (carried !== null && carriedPlan !== null) {
      // The SAME-EVALUATOR RULE: a tier re-measures the incumbent under its own
      // evaluator before it may be replaced. Here the "tier" is the channel the
      // new posture leads with, so the incumbent's triple is recomputed and the
      // candidate table updated with it.
      const bound = this.evaluateBound(run, carriedPlan)
      const cand = run.plans.get(planKey(carriedPlan))
      if (cand !== undefined) cand.bound = bound
      // The incumbent carries over as the STAGED record — the wire did not
      // change — but its FLOOR does not: it was proved while a different
      // channel led, and comparing across the flip is the thing this basis
      // exists to make impossible. The new basis establishes its own floor
      // from its own first emission.
      run.basis.staged = carried
      run.basis.stagedPlan = carriedPlan
    }
  }

  // --------------------------------------------------------------- cohorts

  /** The stamp one cohort rides as, resolved through THIS kernel's registry. */
  private cohortAssumption(id: CohortId): Assumption {
    return cohortAssumptionOf(requireCohortRowIn(this.opts.cohorts, id))
  }

  // ------------------------------------------------------------- admission

  /**
   * THE ONLY ADMISSION CALL SITE IN THE KERNEL. Runs at decision entry, before
   * rung 0, before any evaluation, and never again.
   *
   * Returns null when no policy is configured, which is the default and is the
   * whole of the off state: no measurement is taken, no stamp is produced, and
   * nothing downstream can tell that this file grew an admission path.
   *
   * A configured policy needs a substrate that can answer three questions (its
   * roster, its claim field, its promotion threshold). One that cannot is a
   * composition error and says so — being silently inert here would mean a
   * measured A/B arm quietly running the control.
   */
  private admit(input: KernelInput): {
    stamp: AdmissionStamp
    state: AdmissionState
  } | null {
    const policy = this.opts.admission
    if (policy === null) return null
    const sub = admissionSubstrateOf(input.sub)
    if (sub === null) {
      throw new TypeError(
        "the admission policy needs the engine substrate: the roster, the claim field " +
          "and the promotion threshold are not on the Substrate interface",
      )
    }
    const { stamp, state } = admitAtEntry(
      sub,
      input.asTeam,
      policy,
      this.opts.cohorts,
      input.now?.() ?? defaultNow(),
    )
    return { stamp, state }
  }

  /**
   * The evaluator that computes the decision's cohort.
   *
   * With no policy this is `input.evaluate`, unchanged and unconditionally —
   * the caller named one objective and supplied the thing that computes it.
   *
   * With a policy, the BOARD named the objective, so the caller's single
   * evaluator is no longer known to compute it. `input.evaluators` is where
   * the composition layer says which evaluator serves which cohort. A policy
   * that admits a cohort the map cannot serve is refused here rather than
   * papered over with `input.evaluate`: falling back would mean proving
   * numbers under one objective and stamping them with another, which is the
   * exact silent mixing the cohort stamp exists to prevent.
   */
  private evaluatorFor(input: KernelInput, cohort: CohortId, governed: boolean): Evaluator {
    if (!governed) return input.evaluate
    const chosen = input.evaluators?.get(cohort)
    if (chosen !== undefined) return chosen
    throw new Error(
      `the admission policy admitted cohort ${JSON.stringify(cohort)} but no evaluator ` +
        "was supplied for it: pass KernelInput.evaluators covering every cohort the " +
        "policy's ladders can name",
    )
  }

  /**
   * THE COHORT FLIP. `governPosture`'s control flow with one addition and one
   * subtraction, and the asymmetry between the two is the whole point.
   *
   * A POSTURE flip carries a VALID number under a new channel: the same
   * evaluator computed it, so the incumbent's triple is still a true statement
   * about the incumbent and re-measuring it is a courtesy the same-evaluator
   * rule pays. A COHORT flip carries an INVALID one: a different feature set
   * is a different quantity, so every scalar in flight is now an exact
   * statement about a question nobody is asking. Re-measure is therefore
   * UNCONDITIONAL here and optional there, and the rows this kernel cannot
   * afford to re-measure are DROPPED rather than aged.
   *
   *   push basisSnapshot(old)
   *   basis := newBasis(epoch, posture, newCohort)
   *   carry staged record + stagedPlan     the wire did not change; it never
   *                                        goes empty because of a re-basing
   *   DO NOT carry floorLo/floorChannel    proved under another objective
   *   re-measure the incumbent             unconditionally, before anything
   *                                        may replace it
   *   re-measure or DROP every other row   governPosture does NOT do this, and
   *                                        that omission is the silent-mixing
   *                                        hazard (A1 §1.3.2)
   *
   * WHAT SURVIVES, and why it is not a judgement call: everything the ENGINE
   * produced. Witnesses are score-free enemy-reply certificates; resolutions,
   * candidate sets, prune ledgers and `citedUnits` are engine-derived; the pin
   * set, the epoch, `committedUnits` and the refinement cursor are facts about
   * the operator and the board. None of them mention a weight. What dies is
   * every `Bound`/`ScoreBounds` scalar, the ratchet floors, and the lever view
   * that ranked plans under the old objective (§2.5's invariance inventory).
   * That is why an escalation is cheap: the expensive half — resolving — is
   * cohort-invariant and stays in the memo.
   *
   * Returns true iff the cohort actually changed.
   */
  private governCohort(run: Run, to: CohortId): boolean {
    if (to === run.cohort) return false
    requireCohortRowIn(this.opts.cohorts, to)
    run.basisHistory.push(basisSnapshot(run.basis))
    const carried = run.basis.staged
    const carriedPlan = run.basis.stagedPlan
    const from = run.cohort
    run.cohort = to
    run.basis = newBasis(run.epoch, run.governor.current, to)
    // The lever view ranked candidates under the OLD objective, so its order,
    // its slack and its leader are all statements about the wrong question.
    // Dropped whole, exactly as an epoch change drops it.
    run.lastView = null
    // Every cached bracket is now a number about the old objective. The
    // CONTEXTS keep what the engine gave them — witnesses, cursor, citations,
    // pins — and lose what the evaluator gave them.
    for (const key of run.cache.keys()) {
      const e = run.cache.peek(key)
      if (e === null) continue
      e.incumbent = null
      e.bounds = null
      e.boundsBasis = null
    }
    this.refoldPlans(run, carriedPlan, from)
    if (carried !== null && carriedPlan !== null) {
      // The wire did not change, so the staged RECORD carries — but its floor
      // does not. The new basis establishes its own from its own first
      // emission, which is the difference between "this promise still stands"
      // and "this promise was about something else".
      run.basis.staged = carried
      run.basis.stagedPlan = carriedPlan
    }
    return true
  }

  /**
   * Re-measure the candidate table under the new evaluator, or drop it.
   *
   * The incumbent is MANDATORY: staged-set completeness is what makes the
   * filter in `rows()` safe, and it is bought here by re-measuring the plan
   * the wire is holding before any budget is consulted. Everything else is
   * re-folded while the search deadline allows and dropped when it does not —
   * a dropped row costs breadth, and a kept-but-stale one would cost
   * soundness.
   *
   * `score` is cleared on every re-folded row: a `PlanScore`'s `ScoreBounds`
   * were proved by the search under the old basis, and `rows()` prefers them
   * to the evaluator's own triple. Keeping them would put the old objective's
   * numbers back in front of the stager through the one door the filter does
   * not watch.
   */
  private refoldPlans(run: Run, incumbentPlan: JointPlan | null, from: CohortId): void {
    const mandatory = new Set<string>()
    if (incumbentPlan !== null) mandatory.add(planKey(incumbentPlan))
    if (run.wirePlan !== null) mandatory.add(planKey(run.wirePlan))
    const stale = [...run.plans.values()].filter((c) => c.cohort === from)
    // Mandatory rows first, so an exhausted budget can never cost the wire its
    // own row.
    stale.sort((a, b) => Number(mandatory.has(b.key)) - Number(mandatory.has(a.key)))
    let refolded = 0
    for (const cand of stale) {
      const required = mandatory.has(cand.key)
      // At least one row always survives a flip: with no mandatory row (a flip
      // before the first emission) the first candidate stands in for it, so
      // the stager is never handed an empty table by a re-basing.
      const affordable = required || refolded === 0 || run.now() < run.searchDeadline
      if (!affordable) {
        run.plans.delete(cand.key)
        continue
      }
      cand.bound = this.evaluateBound(run, cand.plan)
      cand.score = null
      cand.cohort = run.cohort
      refolded++
    }
  }

  private measure(run: Run, entry: PinContextEntry): PostureConditions {
    const rows = this.rows(run)
    const score = entry.incumbent
    const holdsPresent = score === null ? true : score.bounds.ledger.length > 0
    const living = rows.filter((r) => r.vacuity !== "material-dead")
    const distinctLo = new Set(living.map((r) => r.lo))
    const view = run.lastView
    const saturated =
      view === null
        ? false
        : view.units.length > 0 &&
          view.units
            .filter((u) => u.rung !== "advanced")
            .every((u) => u.cloudSize >= Math.max(1, view.interiorCells))
    const cited = score === null ? new Set<UnitId>() : detectVacuity(score.bounds, this.opts.deadBelow).citedUnits
    const dischargeable =
      view === null
        ? true
        : cited.size === 0
          ? true
          : view.units.some((u) => cited.has(u.unitId) && u.refinable)
    return {
      holdsPresent,
      floorSeparates: distinctLo.size > 1,
      claimsSaturated: saturated,
      residueDischargeable: dischargeable,
      allCandidatesCloudContingentDead:
        rows.length > 0 && rows.every((r) => r.vacuity === "cloud-contingent-dead"),
    }
  }

  // ---------------------------------------------------------- staging + gates

  /**
   * The rows the stager compares — FILTERED TO THE ACTIVE COHORT, from either
   * source.
   *
   * This is the whole of A1 §1.3.2's silent-mixing hazard, closed. Two rows
   * proved under different objectives are not two answers to one question:
   * `max` over them picks the row whose objective happens to produce bigger
   * numbers, which is arithmetic, not a decision. So the filter is not an
   * optimisation and not a staleness policy — it is the difference between a
   * comparison and a category error.
   *
   * `governCohort` has already re-measured or dropped every row in
   * `run.plans` by the time a flip returns, and it drops `lastView` outright,
   * so in a correct kernel this filter removes nothing. It is here as the
   * standing invariant rather than as a cleanup: any future path that puts a
   * foreign row in front of the stager fails closed, by dropping the row,
   * instead of quietly winning with it.
   */
  private rows(run: Run): StagingCandidate[] {
    const view = run.lastView
    if (view !== null && view.candidates.length > 0) {
      const rows: StagingCandidate[] = []
      for (const c of view.candidates as ReadonlyArray<CandidateView>) {
        if (c.cohort !== run.cohort) continue
        rows.push({
          key: c.key,
          lo: c.lo,
          est: c.est,
          hi: c.hi,
          horizon: c.horizon,
          vacuity: c.vacuity,
          cohort: c.cohort,
        })
      }
      if (rows.length > 0) return rows
    }
    const out: StagingCandidate[] = []
    for (const cand of run.plans.values()) {
      if (cand.cohort !== run.cohort) continue
      const bounds = cand.score?.bounds
      const lo = bounds?.worst ?? cand.bound.lo
      const hi = bounds?.best ?? cand.bound.hi
      const vacuity = bounds
        ? detectVacuity(bounds, this.opts.deadBelow).cause
        : lo <= this.opts.deadBelow
          ? "material-dead"
          : "alive"
      out.push({
        key: cand.key,
        lo,
        est: cand.bound.est,
        hi,
        horizon: cand.horizon,
        vacuity,
        cohort: cand.cohort,
      })
    }
    return out
  }

  /** Run the sticky stager, then the five gates. Returns a record or null. */
  private stageAndGate(run: Run, forced: boolean): EmitRecord | null {
    const rows = this.rows(run)
    if (rows.length === 0) return null
    const decision = run.stager.stage(rows, run.governor.policy)
    const cand = this.candidateFor(run, decision.staged)
    if (cand === null) return null
    const idx = rows.findIndex((r) => r.key === decision.staged.key)
    const slack = this.slackFor(run, rows, idx, decision.staged)
    return this.gate(run, cand, decision.staged, slack, decision.horizon, forced)
  }

  /**
   * The forced path: an already-chosen plan (rung 0, or the epoch-change
   * conformance re-stage).
   *
   * GATES 1–3 ARE WAIVED because the constraint set changed underneath them.
   * SO IS GATE 4, DELIBERATELY: a forced write is either the first staged set
   * of the turn or the answer to an operator's pin, and an adversarial
   * teammate floor that refused every consultation must not be able to starve
   * either of them. Humans always win, structurally — this is a stated
   * guarantee now, not an accident of where `gate()` is called (V3-R5 proved
   * the behaviour is the right one, and that the comment that used to sit here
   * claimed the opposite of what the code did).
   *
   * The certificate is still CONSULTED, because the wire's atomicity did not
   * change and a torn re-stage on a >10-unit team is exactly the write most
   * likely to tear. A refusal is recorded on the record itself as
   * `forced-uncertified` and counted, so an operator's re-stage that shipped
   * without a certificate is visible rather than invisible.
   */
  private buildRecord(run: Run, cand: PlanCandidate): EmitRecord {
    const rows = this.rows(run)
    const idx = rows.findIndex((r) => r.key === cand.key)
    const row: StagingCandidate =
      idx >= 0
        ? rows[idx]
        : {
            key: cand.key,
            lo: cand.score?.bounds.worst ?? cand.bound.lo,
            est: cand.bound.est,
            hi: cand.score?.bounds.best ?? cand.bound.hi,
            horizon: cand.horizon,
            vacuity: "alive",
            cohort: cand.cohort,
          }
    const verdict = this.crossfade(run, cand.plan)
    if (verdict === "blocked") run.crossfade.forcedUncertified++
    return this.record(
      run,
      cand,
      row,
      this.slackFor(run, rows, idx, row),
      row.horizon,
      verdict === "blocked" ? "forced-uncertified" : verdict,
    )
  }

  private gate(
    run: Run,
    cand: PlanCandidate,
    row: StagingCandidate,
    slack: number,
    horizon: number,
    forced: boolean,
  ): EmitRecord | null {
    const basis = run.basis
    const lo = row.lo
    const hi = Math.max(row.hi, row.lo)
    // The quantity this basis ratchets. Every comparison below reads the
    // BASIS's own numbers — never a record from another epoch or posture —
    // which is what makes a cross-basis comparison unrepresentable rather
    // than merely avoided.
    const value = basis.channel === "est" ? Math.min(Math.max(row.est, lo), hi) : lo
    const gap = Math.max(0, hi - value)
    const prev = basis.staged

    if (prev !== null) {
      // Gate 1 — the RATCHET, within this basis and no other. A search that
      // hands back a weaker promise has broken the refinement lattice. The
      // kernel refuses and counts; it never clamps, because clamping turns an
      // unsound bound into a confident lie.
      if (lo < basis.floorLo || value < basis.floorChannel) {
        run.boundViolations++
        run.refusals["ratchet-floor"]++
        return null
      }
      if (gap > basis.maxGap) {
        run.boundViolations++
        run.refusals["ratchet-gap"]++
        return null
      }
      const changed = cand.key !== planKey(prev.plan)
      if (changed) {
        // Defence in depth behind the sticky stager, whose switch margin is
        // strictly stronger: a plan change needs a strictly better proven
        // value on the leading channel, whatever proposed it.
        if (value <= basis.floorChannel) {
          run.refusals["switch-floor"]++
          return null
        }
        if (this.opts.switchRule === "dominance" && value < basis.stagedHi) {
          run.refusals["switch-dominance"]++
          return null
        }
      } else {
        // Gate 2 — WORTH. Nothing new to say costs nothing to say. The final
        // flush waives the THRESHOLD (it must be able to put a small last
        // improvement on the wire) but not the requirement that there BE an
        // improvement: a byte-identical re-write is not a flush, it is noise.
        // `!(removed > 0)` rather than `removed <= 0`: with an infinite cliff
        // (DEAD = −∞) two identical infinite gaps subtract to NaN, and NaN
        // must read as "no improvement demonstrated", not as a free pass.
        const removed = basis.maxGap - gap
        const need = forced ? 0 : this.opts.gapImprovementFraction * Math.max(basis.maxGap, 1e-9)
        if (!(removed > 0) || removed < need) {
          run.refusals.worth++
          return null
        }
      }
      // Gate 3 — RATE. There is no server-side throttle; this is the throttle.
      // It lives on the RUN, not the basis: it protects the wire, and the wire
      // does not care which epoch or posture the record came from.
      if (!forced && run.now() - run.lastWriteMs < this.opts.minWriteIntervalMs) {
        run.refusals.rate++
        return null
      }
    }

    // Gate 3½ — CONFORMANCE. Humans always win: a plan that contradicts a
    // committed pin never reaches the wire, whatever the search believes about
    // its value. A conforming search should make this unreachable; it is here
    // because "should" is not a guarantee and the operator is not negotiable.
    if (!this.conformsToPins(run, cand.plan)) {
      run.refusals.nonconforming++
      return null
    }

    // Gate 4 — CROSSFADE.
    const verdict = this.crossfade(run, cand.plan)
    if (verdict === "blocked") {
      run.crossfade.blocked++
      run.refusals.crossfade++
      return null
    }

    return this.record(run, cand, row, slack, horizon, verdict)
  }

  /**
   * True when every unit this decision commands is held by an honourable pin —
   * the search has no free variable left.
   */
  private everythingPinned(run: Run): boolean {
    const sub = run.input.sub
    if (typeof sub.commandable !== "function") return false
    let roster: ReadonlyArray<UnitId>
    try {
      roster = sub.commandable(run.input.asTeam)
    } catch {
      return false
    }
    if (roster.length === 0) return false
    const pinned = new Set(this.honorablePins(run).map((p) => p.unitId))
    return roster.every((id) => pinned.has(id))
  }

  /** Every HONOURABLE committed pin's unit stands exactly where the operator
   * put it. A refused (unreachable) pin is excluded — no plan can pass it,
   * and it is surfaced through the assumption channel instead. */
  private conformsToPins(run: Run, p: JointPlan): boolean {
    for (const pin of this.honorablePins(run)) {
      if (p.get(pin.unitId)?.to !== pin.to) return false
    }
    return true
  }

  /**
   * Gate 4 — THE CROSSFADE CERTIFICATE.
   *
   * Tier 1, independence: if the units this record CHANGES cannot influence
   * any cell the unchanged staged units can, no interleaving of the two writes
   * differs from either and there is nothing to certify.
   *
   * Tier 2, THE TORN INTERLEAVING ITSELF (V4 B4). The wire cuts a revision
   * into chunks from a stable partition, so the states it can actually hold
   * mid-write are `chunks 0..k from the new revision ∪ chunks k+1.. from the
   * old` — MIXED plans, which neither coherent plan represents. Comparing
   * `hook(prevPlan, changed)` with `hook(plan, changed)` prices two coherent
   * worlds and, worse, EXCLUDES every changed unit from both sums: the
   * coordinated pair that pair-repair produces (A into the cell B is vacating)
   * is invisible to it precisely because both units changed. With the wire's
   * partition in hand the gate builds each reachable mixed plan and prices it
   * whole, against the floor the wire is already guaranteeing.
   *
   * Without a partition the delta comparison is all there is, and it speaks
   * only for an ADJACENT-REVISION atomic pair: it still BLOCKS a regression,
   * but a pass is counted `uncertified` rather than claiming a certificate the
   * torn state never got.
   */
  private crossfade(run: Run, plan: JointPlan): CrossfadeVerdict | "blocked" {
    if (this.opts.crossfade === "off") return "off"
    // What the WIRE holds, not what this basis remembers staging: a basis is
    // dropped on every epoch and posture change, and the torn write is against
    // whatever is actually out there.
    const prevPlan = run.wirePlan
    if (prevPlan === null) return "independent"
    const changed = new Set<UnitId>()
    for (const [unitId, c] of plan) {
      const before = prevPlan.get(unitId)
      if (before === undefined || before.to !== c.to || before.path.join(".") !== c.path.join("."))
        changed.add(unitId)
    }
    if (changed.size === 0) return "independent"
    const movedCells = new Set<number>()
    for (const unitId of changed) for (const c of run.input.sub.influenceOf(unitId)) movedCells.add(c)
    let overlaps = false
    for (const [unitId] of prevPlan) {
      if (changed.has(unitId)) continue
      for (const c of run.input.sub.influenceOf(unitId)) {
        if (movedCells.has(c)) {
          overlaps = true
          break
        }
      }
      if (overlaps) break
    }
    // TIER 1½ — CHANGED UNITS CAN TEAR AGAINST EACH OTHER. The unchanged-unit
    // test above misses the case the whole gate exists for: a coordinated pair
    // whose members land in different chunks. Both are "changed", so the
    // independence test finds no unchanged unit to worry about and passes a
    // write whose torn state is precisely the collision between them. If the
    // delta spans more than one chunk, the write is tearable.
    const groups = this.opts.crossfadeGroups?.(plan)
    const spansGroups =
      groups !== undefined &&
      groups.filter((g) => g.some((unitId) => changed.has(unitId))).length > 1
    if (!overlaps && !spansGroups) {
      run.crossfade.independent++
      return "independent"
    }
    const hook = this.opts.teammateFloor
    if (hook === undefined) {
      run.crossfade.uncertified++
      return "uncertified"
    }
    if (groups === undefined) {
      // Adjacent-revision only. Still a veto, never a certificate.
      const before = hook(prevPlan, changed)
      const after = hook(plan, changed)
      if (after < before) return "blocked"
      run.crossfade.uncertified++
      return "uncertified"
    }
    const tears = tornPlans(prevPlan, plan, groups, changed)
    if (tears.length === 0) {
      // One chunk, or the change sits wholly inside one: the write IS atomic,
      // so the only states the wire can hold are the two coherent plans.
      run.crossfade.certified++
      return "certified"
    }
    const baseline = hook(prevPlan, NO_UNITS)
    for (const mixed of tears) {
      if (hook(mixed, NO_UNITS) < baseline) return "blocked"
    }
    run.crossfade.tornPriced++
    run.crossfade.certified++
    return "certified"
  }

  private record(
    run: Run,
    cand: PlanCandidate,
    row: StagingCandidate,
    slack: number,
    horizon: number,
    crossfade: CrossfadeVerdict,
  ): EmitRecord {
    const lo = row.lo
    const hi = Math.max(row.hi, row.lo)
    return {
      plan: cand.plan,
      // THE RECORD CARRIES THE est THE GATE USED (V4 R6). `gate` ratchets on
      // `row.est` — which comes from the lever view whenever the core exposes
      // one, and from the kernel's own evaluation otherwise — so writing
      // `cand.bound.est` here would publish a number the gate never approved,
      // and `commit` would then seed `basis.floorChannel` from it. Clamped
      // into the record's own bracket at record time, once, so nothing
      // downstream can read `est > hi` as a promise.
      est: Math.min(Math.max(row.est, lo), hi),
      lo,
      hi,
      horizon,
      slack,
      posture: run.governor.current,
      assumptions: this.assumptions(run, cand),
      epoch: run.epoch,
      crossfade,
      // THE POLICY ON THE WIRE. Present exactly when a policy ran, absent when
      // it did not — "the policy was off" and "the policy chose the default"
      // are different facts, and a corpus that cannot separate them cannot be
      // refit. Spread conditionally rather than written as `?? undefined` so a
      // flag-off record has no `admission` KEY at all and a byte comparison
      // against the stage before this one has nothing to strip.
      ...(run.admission === null ? {} : { admission: run.admission }),
    }
  }

  private assumptions(run: Run, cand: PlanCandidate): ReadonlyArray<Assumption> {
    // THE SECOND POSTURE CALL SITE. `searchContext` puts the framing pair on
    // every context the search prices under; this one puts it on the RECORD
    // that leaves the kernel, which is what a refit corpus and an operator
    // audit actually read. They are appended together, in the same order, in
    // both places, so a record's basis and its search's basis are the same
    // set — and `cand.cohort`, not `run.cohort`, because the record must name
    // the objective this candidate's numbers were proved under. `rows()`
    // guarantees those agree; saying so twice would be a way for them to
    // disagree.
    const out: Assumption[] = [
      { kind: "posture", posture: run.governor.current },
      this.cohortAssumption(cand.cohort),
    ]
    for (const p of run.pins) {
      if (run.refusedPins.get(p.unitId) === p.to) {
        // The pin stands (the bot never unpins) but the plan does not honour
        // it — say so on the record, in place of an operator-pin claim the
        // staged set would contradict.
        out.push({
          kind: "narrowing",
          unitId: p.unitId,
          note: `operator-pin-unreachable@${p.to}: unit keeps its own choice`,
        })
        continue
      }
      out.push({ kind: "operator-pin", unitId: p.unitId, to: p.to })
    }
    for (const a of run.input.assumptions ?? []) out.push(a)
    // Narrowings the consumer discovered while draining this decision — see
    // `declare`. A default is a narrowing and must be named, whichever module
    // found it out.
    for (const a of run.declared) out.push(a)
    if (cand.score !== null) for (const a of cand.score.bounds.assumptions) out.push(a)
    const seen = new Set<string>()
    return out.filter((a) => {
      const k = JSON.stringify(a)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }

  /**
   * Gate 5 — the SINK. A record counts as staged only once the consumer has
   * taken it. A throw leaves every kernel-side ratchet untouched, so the unit
   * still holds its news and the next pass retries with it.
   */
  private async *commit(run: Run, rec: EmitRecord): AsyncIterable<EmitRecord> {
    try {
      yield rec
    } catch {
      run.refusals.sink++
      return
    }
    // The consumer took it: THIS is now what the wire holds, whatever happens
    // to the ratchet basis afterwards.
    run.wirePlan = rec.plan
    const basis = run.basis
    const value = basis.channel === "est" ? Math.min(Math.max(rec.est, rec.lo), rec.hi) : rec.lo
    basis.staged = rec
    basis.stagedPlan = rec.plan
    basis.floorLo = rec.lo
    basis.floorChannel = value
    basis.stagedHi = rec.hi
    basis.maxGap = Math.max(0, rec.hi - value)
    run.lastWriteMs = run.now()
    basis.emits++
    run.seq++
    run.journal.push(rec)
  }

  // --------------------------------------------------------------- report

  private finish(run: Run): KernelReport {
    const end = run.now()
    const speculative: Array<KernelReport["speculative"][number]> = []
    const contexts: Array<KernelReport["contexts"][number]> = []
    for (const key of run.cache.keys()) {
      const e = run.cache.peek(key)
      if (e === null) continue
      contexts.push({
        key: e.key,
        speculative: e.speculative,
        cursor: e.cursor,
        epochBaseline: e.epochBaseline,
        incumbentLo: e.incumbent === null ? null : e.incumbent.bounds.worst,
        incumbentHi: e.incumbent === null ? null : e.incumbent.bounds.best,
        posture: e.boundsBasis?.posture ?? null,
        epoch: e.boundsBasis?.epoch ?? null,
        cohort: e.boundsBasis?.cohort ?? null,
        witnesses: e.witnesses.length,
        stepCostMs: e.stepCostMs,
      })
      if (!e.speculative || e.bounds === null) continue
      speculative.push({
        key: e.key,
        lo: e.bounds.lo,
        hi: e.bounds.hi,
        cursor: e.cursor,
        posture: e.boundsBasis?.posture ?? null,
        epoch: e.boundsBasis?.epoch ?? null,
        cohort: e.boundsBasis?.cohort ?? null,
      })
    }
    return {
      elapsedMs: end - run.t0,
      budgetMs: run.budgetMs,
      overshootMs: Math.max(0, end - run.deadline),
      slices: run.slices,
      abandoned: run.aborted,
      idleSlices: run.idleSlices,
      yields: run.yields,
      improveCalls: run.improveCalls,
      refineCalls: run.refineCalls,
      conformCalls: run.conformCalls,
      evaluateCalls: run.evaluateCalls,
      emits: run.journal.length,
      refusals: { ...run.refusals },
      boundViolations: run.boundViolations,
      probes: run.probes,
      meanSliceCostMs: run.slices > 0 ? run.sliceCostTotal / run.slices : 0,
      finalStepCostMs: run.active.stepCostMs,
      epochs: run.epoch + 1,
      conformance: run.conformance,
      cache: { ...run.cache.stats },
      postureFlips: run.governor.flips,
      admission: run.admission,
      admissionState: run.admissionState,
      basisHistory: run.basisHistory,
      journal: run.journal,
      levers: run.voc.levers,
      crossfade: { ...run.crossfade },
      committedUnits: [...run.committedUnits].sort((a, b) => a - b),
      speculative,
      contexts,
      activeContextKey: run.active.key,
      stagedNothing: run.journal.length === 0,
      leverOrderBinding: run.refiner !== null,
    }
  }

  /**
   * The speculative contexts AS THEY STAND, mid-decision.
   *
   * `lastReport` only exists once a decision has ended, so an advice layer
   * built on it can only price a hovered pin at the deadline — which is when
   * the turn is about to resolve and the operator has stopped hovering. This
   * is the same data the report will carry, read live. Empty outside a run.
   */
  speculativeNow(): KernelReport["speculative"] {
    const run = this.run
    if (run === null) return []
    const out: Array<KernelReport["speculative"][number]> = []
    for (const key of run.cache.keys()) {
      const e = run.cache.peek(key)
      if (e === null || !e.speculative || e.bounds === null) continue
      out.push({
        key: e.key,
        lo: e.bounds.lo,
        hi: e.bounds.hi,
        cursor: e.cursor,
        posture: e.boundsBasis?.posture ?? null,
        epoch: e.boundsBasis?.epoch ?? null,
        cohort: e.boundsBasis?.cohort ?? null,
      })
    }
    return out
  }

  /**
   * The COMMITTED context's best-known bracket as it stands, mid-decision —
   * the unconstrained side of a pin price. Null before the first score lands.
   */
  unconstrainedNow(): {
    key: string
    lo: number
    hi: number
    posture: Posture | null
    epoch: number | null
    cohort: CohortId | null
  } | null {
    const run = this.run
    if (run === null) return null
    const e = run.active
    if (e.bounds === null) return null
    return {
      key: e.key,
      lo: e.bounds.lo,
      hi: e.bounds.hi,
      posture: e.boundsBasis?.posture ?? null,
      epoch: e.boundsBasis?.epoch ?? null,
      cohort: e.boundsBasis?.cohort ?? null,
    }
  }

  /**
   * THE COHORT SEAM — flip the live decision's objective.
   *
   * Stage 1 ships one registered cohort, so nothing in production calls this:
   * the control flow behind it is built and tested now because the cost of
   * getting a re-basing wrong is a silently mixed comparison, and that is not
   * a thing to discover while also introducing a second objective.
   *
   * Stage 2's admission governor is the intended caller, from beside
   * `governPosture` in the loop. Until then the contract is: call it at a
   * SLICE BOUNDARY (between records, or from a core hook), never mid-price.
   * Returns false — changing nothing — outside a live decision or when the
   * cohort is already active; throws only for an id the registry does not
   * know, which is a programming error and not a runtime condition.
   *
   * Deliberately NOT on the `Kernel` contract interface. Which module is
   * allowed to choose an objective is Stage 2's decision to make, and putting
   * it on the interface now would make it every consumer's.
   */
  flipCohort(to: CohortId): boolean {
    if (this.run === null) return false
    return this.governCohort(this.run, to)
  }

  /** The live decision's active cohort. Null outside a decision. */
  activeCohort(): CohortId | null {
    return this.run === null ? null : this.run.cohort
  }

  /** Test/integrator seam: the live basis, with no way to reach a previous one. */
  basisSnapshot(): BasisSnapshot | null {
    return this.run === null ? null : basisSnapshot(this.run.basis)
  }
}

function basisSnapshot(b: RatchetBasis): BasisSnapshot {
  return {
    epoch: b.epoch,
    posture: b.posture,
    cohort: b.cohort,
    channel: b.channel,
    floorLo: b.floorLo,
    emits: b.emits,
  }
}

function witnessKey(w: Witness): string {
  const parts: string[] = []
  for (const [unitId, c] of w.replies) parts.push(`${unitId}>${c.to}`)
  parts.sort()
  return `${parts.join(",")}|${w.note}`
}
