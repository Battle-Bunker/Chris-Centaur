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
  Assumption,
  Bound,
  BudgetHandle,
  CrossfadeVerdict,
  EmitRecord,
  FeatureContribution,
  JointPlan,
  Kernel,
  KernelInput,
  Pin,
  PinEvent,
  PinSet,
  PlanExplanation,
  PlanScore,
  Posture,
  SearchContext,
  TrialObservation,
  UnitId,
  Witness,
} from "./contracts"
import {
  DEFAULT_DEAD_BELOW,
  PostureGovernor,
  channelPolicyFor,
  detectVacuity,
  type PostureConditions,
} from "./postures"
import {
  DEFAULT_SWITCH_MARGIN,
  StickyStager,
  VocOrchestrator,
  asRefiner,
  planKey,
  rootSlack,
  type Lever,
  type LeverView,
  type Refiner,
  type StagingCandidate,
} from "./voc"
// THE LENS, imported LEAF-WISE and never through the barrel: the barrel also
// carries the recorded-run driver, which reaches back into the local runner,
// which imports this file. Naming the three leaves keeps the module graph a
// tree.
import { diffPartitions, partitionOf, type FixedUnit } from "../lens/kernel/partition"
import { makeReservoir, slackFrom, type MovesetReservoir } from "../lens/kernel/reservoir"
import { unitKeyOf } from "../lens/kernel/keys"
import { rankConditional as rankConditionalPure } from "../lens/kernel/conditional"
import { carveReserve } from "../lens/kernel/reserve"
import { basisKeyOf } from "./bounds"
import { basisOf } from "./search/basis"
import { LENS_ROW_CAP } from "../lens/types"
import type {
  BasisKey,
  ClusterId,
  ClusterView,
  ConditionalRanking,
  EventId,
  KernelLensPort,
  LensEvent,
  JointResidual,
  LensRefusal,
  LensReserve,
  LensSink,
  LoudReading,
  Lock,
  MemberMarginal,
  Moveset,
  MovesetBreakdown,
  MovesetKey,
  MovesetMove,
  FeatureDelta,
  RankConditionalResult,
  UnitKey,
} from "../lens/types"

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
  /** The basis `bounds` was proved under — the posture that led and the epoch
   * whose pin set it assumed. Carried so a consumer differencing this bracket
   * against a record can prove the two share a basis (V4 B7). */
  boundsBasis: { posture: Posture; epoch: number } | null
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
  /**
   * [CHANGE 2]'s OWN MEASUREMENT, shipped with the change it defends (04 §3.3
   * Q6). `promotionAttempts` counts epoch changes that went looking for a
   * speculative entry to promote; `promotions` counts the ones that found one.
   * The ratio is the frequency with which an operator commits a pin they
   * hovered first — and if it is near zero the promotion is still CORRECT
   * (Law B needs it) but its latency value is on a path nobody walks, which is
   * a thing to learn from a counter rather than from an argument.
   */
  promotionAttempts: number
  promotions: number
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
    promotionAttempts: 0,
    promotions: 0,
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
   * [CHANGE 2] — PROMOTE A SPECULATIVE ENTRY INTO THE COMMITTED NAMESPACE.
   *
   * Without this the operator's hover is searched for four slices, the
   * operator commits it, and the kernel starts from an entry with
   * `incumbent: null`: `pickContext` writes into `spec:[…]` and `retarget`
   * obtains `pin:[…]`, and those are different keys by construction. The
   * promotion is what makes the staged moveset the INSPECTED moveset — the
   * same object in the same cache entry, rather than two rankings that
   * happened to agree.
   *
   * WHAT IT CARRIES, and what it refuses to:
   *
   *   incumbent    a plan is not a promise; `improve` resumes from it and
   *                re-prices it, which is where the new basis's floor comes
   *                from.
   *   witnesses    certificates. They survive restarts and pin-context
   *                switches by contract.
   *   cursor, citedUnits, stepCostMs   accounting, not adjudication.
   *
   *   NOT bounds / boundsBasis. A floor proved in the old epoch may not gate
   *   the new one, and the whole ratchet exists to make that unrepresentable.
   *   The new basis establishes its own floor from its own first emission.
   */
  promote(from: string, to: string, epoch: number, pins: PinSet): boolean {
    this.stats.promotionAttempts++
    const source = this.map.get(from)
    if (source === undefined) return false
    this.map.delete(from)
    const existing = this.map.get(to)
    const carried = {
      incumbent: source.incumbent,
      witnesses: source.witnesses,
      cursor: source.cursor,
      citedUnits: new Set(source.citedUnits),
      stepCostMs: source.stepCostMs,
    }
    if (existing !== undefined) {
      // An entry under the committed key already exists — a previous epoch's.
      // The plan and the certificates are still worth having; the bracket is
      // not, and is not taken.
      existing.incumbent = carried.incumbent ?? existing.incumbent
      existing.witnesses = carried.witnesses.length > 0 ? carried.witnesses : existing.witnesses
      existing.cursor = Math.max(existing.cursor, carried.cursor)
      for (const unitId of carried.citedUnits) existing.citedUnits.add(unitId)
      existing.bounds = null
      existing.boundsBasis = null
      existing.lastUsed = ++this.tick
    } else {
      this.map.set(to, {
        key: to,
        tier: PIN_CACHE_TIER.EXCLUSIVE,
        pins,
        speculative: false,
        epochBaseline: epoch,
        incumbent: carried.incumbent,
        bounds: null,
        boundsBasis: null,
        witnesses: carried.witnesses,
        cursor: carried.cursor,
        citedUnits: carried.citedUnits,
        stepCostMs: carried.stepCostMs,
        lastUsed: ++this.tick,
      })
      this.evict()
    }
    this.stats.promotions++
    return true
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
  /** The channel this basis ratcheted. Cross-channel comparison never happens. */
  readonly channel: "lo" | "est"
  readonly floorLo: number
  readonly emits: number
}

/**
 * WHAT THIS REPORT NO LONGER CARRIES, and why (04 §5.2 #11, 03 §6.2).
 *
 * `postureFlips`, `basisHistory`, `meanSliceCostMs`, `probes`, `levers` and
 * `leverOrderBinding` had zero non-test consumers between them, and each was a
 * SEQUENCE OF MOMENTS WEARING AN ARRAY'S CLOTHES. They are `LensEvent`s now: a
 * flip changes which channel adjudicates, which is a timeline fact and not a
 * summary statistic, and an epoch is a `partition` frame with the pin that
 * caused it. Keeping both would be two orderings of one sequence.
 *
 * `levers` and `leverOrderBinding` go for a stronger reason: they were
 * STRUCTURALLY CONSTANT. `makeSearchCore` returns no `refinementView`, so
 * `asRefiner` yields null, `run.lastView` is always null, `levers` is always
 * `[]` and `leverOrderBinding` always false. Do not ship a surface that
 * renders a field which is always the same value. `probes` stays as an
 * internal counter — the anti-latch gate it guards is tested directly.
 *
 * KEPT, explicitly: `contexts`, `speculative` and `activeContextKey` (the only
 * inputs to `pins.adviseFromReport`, and after [CHANGE 2] the surface
 * `rankConditional` reads), `crossfade`, `refusals`, `committedUnits`,
 * `conformance` and `journal`. The last two are 04's additions to 03's counted
 * list and they still have live non-test consumers — `pins.ts` reads the
 * journal's last record and the operator suites read the conformance samples —
 * so they die with the event log at L4, not here.
 */
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
  readonly finalStepCostMs: number
  readonly epochs: number
  readonly conformance: ReadonlyArray<ConformanceSample>
  readonly cache: Readonly<PinCacheStats>
  readonly journal: ReadonlyArray<EmitRecord>
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
   */
  readonly speculative: ReadonlyArray<{
    key: string
    lo: number
    hi: number
    cursor: number
    posture: Posture | null
    epoch: number | null
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
   * The channel this basis ratchets. Under FOGGED-VACUOUS every candidate's lo
   * sits on the cliff by construction, so a floor ratchet would freeze the
   * wire at whatever happened to be staged when the posture flipped — the
   * passivity the posture exists to escape. The LEADING channel is what
   * ratchets; lo keeps its own (basis-scoped) floor underneath, so ordering by
   * est can never lower the promise.
   */
  readonly channel: "lo" | "est"
  /**
   * THE HORIZON COORDINATE OF THE RATCHETED CHANNEL (06 F-8).
   *
   * Inert under `lo` and load-bearing under `est`, for the reason the whole of
   * F-4 turns on: a floor is a claim about a horizon-independent quantity, so
   * two floors proved at two depths ratchet against each other unharmed, while
   * an `est` is a summary AT a horizon and two of them are two answers to two
   * questions. Under FOGGED-VACUOUS the ratcheted `value` IS the clamped est,
   * so without this coordinate a deeper reading's est would be read as a
   * retraction of a shallower one — or, worse, as a promise kept. The basis
   * ENDS where its coordinate changes, which is the same thing a posture flip
   * does and for the same reason: the quantity being ratcheted stopped being
   * the same quantity.
   */
  readonly horizon: number
  floorLo: number
  floorChannel: number
  stagedHi: number
  maxGap: number
  staged: EmitRecord | null
  stagedPlan: JointPlan | null
  emits: number
}

function newBasis(epoch: number, posture: Posture, horizon = 1): RatchetBasis {
  return {
    epoch,
    posture,
    horizon,
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

interface PlanCandidate {
  readonly key: string
  readonly plan: JointPlan
  score: PlanScore | null
  bound: Bound
  horizon: number
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
  /** THE LENS SINK, or null. Null ⇒ every line below that mentions the lens
   * is one null check and nothing else. */
  readonly lens: LensSink | null
  /** The retained rows. Built only when the lens is watching: the reservoir
   * is the rival set, and a decision nobody is watching has no consumer for
   * one. */
  readonly reservoir: MovesetReservoir | null
  /** The partition as it stands, at this basis. */
  clusters: ReadonlyArray<ClusterView>
  /** The reading every frame and every retained row is stamped with — the
   * current slice's own start. NEVER a fresh `now()` per row: under the node
   * clock a read is work, and a lens that read the clock would change the
   * decision it is watching. */
  stamp: number
  /** The basis key of the context the current slice is searching. */
  basisKey: BasisKey
  /** Per cluster, the last `movesets` frame's content — so an unchanged
   * reservoir does not re-emit a frame every barrier. */
  readonly framed: Map<number, string>
  /**
   * The refusal reasons already framed SINCE THE LAST EMISSION (gate 9).
   *
   * A refused write is a thing that happened at a time and the timeline should
   * say so — but `refuse` is called on every rejected candidate inside the hot
   * loop, and the O1 run measured what that costs: 18,586 refusal frames over
   * twenty `snakes` turns, 98% of every event written, and 542 KB per turn
   * against a design that says a turn's events are kilobytes and travel whole
   * on the wire. The count was never the point — `KernelReport.refusals`
   * already carries it exactly — the MOMENT was. So one moment per reason is
   * kept between emissions and the repeats are dropped. Cleared at each
   * emission barrier, which is the timeline lane's own unit.
   */
  readonly refusalsFramed: Set<string>
  /**
   * THE INSPECTION RESERVE, carved BEFORE `searchDeadline` and by nothing else
   * (05 §(d) gate 7(i)). The search is unconditionally shorter by a fixed,
   * DECLARED amount; inspection is unconditionally affordable; and no exchange
   * rate between compute and operator attention is ever computed, because a
   * rate would let the scheduler spend the human.
   */
  readonly reserveMs: number
  reserveSpent: number
  /** True while a refinement slice is running. The sink is called BETWEEN
   * slices only, so a request that arrives inside one is queued rather than
   * served — a rule made structural instead of conventional. */
  inSlice: boolean
  readonly queued: Array<{ cluster: ClusterId; locks: ReadonlyArray<Lock> }>
  /** The plan behind a retained row, for `explainMoveset`. Bounded: an
   * explanation is a question about a row the operator can see, and there are
   * at most `LENS_ROW_CAP` of those. */
  readonly plansByMoveset: Map<string, JointPlan>
  /** THE LOUD READING behind a retained row (08 §5 step 1). Bounded exactly as
   * `plansByMoveset` is, and for the same reason: it is a fact about a row the
   * operator can see. Never read by anything that decides. */
  readonly loudByMoveset: Map<string, LoudReading>
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
  /**
   * THE OPERATOR EVENT THIS CAME FROM (01 ask (b)).
   *
   * The kernel already measures the latency and already knows the pairing;
   * only the id was missing. With it, "the operator pinned and then something
   * was staged" becomes "this write is the answer to THAT pin, 18 ms later,
   * 0 slices in between" — which is the whole difference between a log and an
   * account. Null when the caller had no id to give.
   */
  readonly id: EventId | null
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
  onPinEvent(ev: PinEvent, id: EventId | null = null): void {
    this.pending.push({ ev, at: this.run === null ? null : this.run.now(), id })
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
    // THE RESERVE IS DECLARED, NOT TAKEN. `reserveMs` is the wire's final
    // flush; `LENS_INSPECTION_MS` is the operator's, carved on top of it and
    // ONLY when someone is watching — a decision nobody inspects must be
    // exactly as long as it was before the lens existed (gate 7(ii)).
    const carved =
      input.lens === undefined
        ? { searchDeadlineMs: deadline - this.opts.reserveMs, reserveMs: 0 }
        : carveReserve(deadline - this.opts.reserveMs, t0)
    const searchDeadline = carved.searchDeadlineMs
    const initialStepCostMs =
      input.initialStepCostMs ?? this.opts.initialStepCostMs ?? this.opts.sliceMs
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
      lens: input.lens ?? null,
      reservoir: input.lens === undefined ? null : makeReservoir(),
      clusters: [],
      reserveMs: carved.reserveMs,
      reserveSpent: 0,
      inSlice: false,
      queued: [],
      plansByMoveset: new Map<string, JointPlan>(),
      loudByMoveset: new Map<string, LoudReading>(),
      stamp: 0,
      basisKey: "",
      framed: new Map<number, string>(),
      refusalsFramed: new Set<string>(),
      pins,
      tentative: input.initialPins.filter((p) => p.tentative),
      wirePlan: null,
      committedUnits: new Set<UnitId>(),
      declared: [],
      refusedPins: new Map<UnitId, number>(),
      epoch: 0,
      basis: newBasis(0, "SIGHTED"),
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

  /**
   * One macrotask hop, charged to the decision like any other elapsed time.
   * An `AsyncIterable` that emits nothing, so a caller splices it in with
   * `yield*` exactly where a boundary is and the loop's own yield stays where
   * it is. Inert when the kernel is configured synchronous (`yieldIntervalMs`
   * of 0), which is the harness setting.
   */
  private async *handBack(run: Run): AsyncIterable<EmitRecord> {
    if (this.opts.yieldIntervalMs <= 0) return
    await yieldToEventLoop()
    run.lastYieldWall = defaultNow()
    run.yields++
  }

  private async *drive(run: Run): AsyncIterable<EmitRecord> {
    // ---- THE PROCESS IS HANDED BACK AT BOTH ENDS OF RUNG 0.
    //
    // The loop below yields at the TOP of each iteration, which is after rung
    // 0 — and rung 0 is the one part of a decision whose cost no slice bounds.
    // It generates and assesses every unit's candidate set and pays for the
    // first evaluation of this board, which on the FIRST decision of a game is
    // also the whole grammar warm-up the reach shells memoise per game (585
    // step relations, 84 000 grammar queries, measured on a 12x12 twelve-unit
    // board: 45% of a cold rung 0 and none of a warm one). Until the loop's
    // first yield the process could not reach its timer or check phase for the
    // whole of that — and when rung 0 outruns the search deadline the loop is
    // never entered, so it could not reach them AT ALL. That is precisely what
    // the yield exists to prevent: the Firestore listener that carries an
    // operator's pin, the manager's coalesced staged write, the per-turn
    // final-flush timer and the other games sharing the process all live out
    // there.
    //
    // BOTH ENDS, and not one: `setImmediate` resolves in the CHECK phase, so a
    // single hop taken from inside poll can service the check queue without
    // the loop ever passing through timers. Two hops cross a phase boundary,
    // which is the difference between "a pin listener could have run" and "a
    // pin listener has run". The one after rung 0 is also the boundary that
    // matters to an operator: the wire is holding a legal set by then, so a
    // pin delivered while rung 0 was working is drained BEFORE the first
    // refinement slice rather than after it.
    yield* this.handBack(run)

    // ---- Rung 0: a conforming, legal joint plan on the wire before any
    // refinement runs. `conform(ctx, ∅)` is contractually a complete legal
    // plan: staging nothing is not an option this kernel has.
    // THE PARTITION COMES FIRST, at t0, so a consumer folding the frames in
    // order is never in a state where a moveset names a cluster that does not
    // exist yet — and so rung 0's own trials have clusters to be cut into.
    this.repartition(run, "decision-start")
    const seed = this.conformNow(run, EMPTY_PLAN)
    run.stager.adopt(seed.key)
    const first = this.buildRecord(run, seed)
    yield* this.commit(run, first)
    yield* this.handBack(run)

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

      // 0¾. INSPECTIONS QUEUED DURING THE LAST SLICE. Between slices is the
      //     only place the sink is called, so a request that arrived inside
      //     one waits here — at most one slice, which is the same bound an
      //     operator's pin waits under.
      this.drainInspections(run)

      // 1. Constraint epochs come first: the wire must never hold a set that
      //    contradicts an operator, not even for one slice.
      if (this.pending.length > 0) {
        const at = this.earliestArrival(run)
        const slicesAtEvent = run.slices
        // Captured BEFORE the drain: the frames name the operator's own
        // events, with the stamps they arrived carrying.
        const drained = this.pending.slice()
        const changed = this.applyPinEvents(run)
        if (changed) {
          this.frameOperators(run, drained, slicesAtEvent)
          const conformCallsBefore = run.conformCalls
          const resumed = this.retarget(run)
          this.repartition(run, drained[0]?.ev ?? "decision-start")
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
      run.inSlice = true
      // EVERY ROW THIS SLICE RETAINS IS STAMPED HERE, with a reading the loop
      // has already taken. A row that read the clock for itself would be work
      // the decision spent on being watched.
      run.stamp = s0 - run.t0
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
      run.inSlice = false
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

    // ---- THE LAST EPOCH. An operator event delivered by the loop's final
    // yield — or queued while its last slice ran — used to be dropped: the
    // loop exits on the search deadline, `decide`'s `finally` empties the
    // queue, and the flush below then put a set on the wire that contradicts
    // a pin this kernel had already accepted. "The wire must never hold a set
    // that contradicts an operator, not even for one slice" is the rule the
    // epoch step inside the loop enforces, and it does not stop being the rule
    // because the search budget ran out. It is also the cheap direction: the
    // epoch path is the conform FAST path (splice, repair only what the splice
    // disturbed, one pair pass) and every one of its loops watches a budget
    // that is already spent, so what runs is the splice and nothing else.
    // `reserveMs` is what pays for it — the same reserve the flush spends.
    if (this.pending.length > 0) {
      const at = this.earliestArrival(run)
      const slicesAtEvent = run.slices
      const conformCallsBefore = run.conformCalls
      const drained = this.pending.slice()
      if (this.applyPinEvents(run)) {
        this.frameOperators(run, drained, slicesAtEvent)
        const resumed = this.retarget(run)
        this.repartition(run, drained[0]?.ev ?? "decision-start")
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
      }
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
    run.epoch++
    // A NEW basis object. The old one is dropped on the floor: no map from
    // epoch to floor exists, so nothing in the new epoch can be compared with
    // anything proved in the old one.
    run.basis = newBasis(run.epoch, run.governor.current, run.basis.horizon)
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
        // The operator asked for a cell this unit cannot reach. It is counted
        // once per refused destination, and it is a MOMENT: the operator is
        // owed the time their order was refused, not a total at the end.
        if (run.lens !== null) this.refuse(run, "pin-unreachable", `${pin.unitId}>${pin.to}`)
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
    // [CHANGE 2]. The speculative form of THESE pins is the one the operator
    // was hovering, and it differs from the committed form in exactly one
    // token's `?`. Which pin they hovered is not recorded, so each is tried in
    // turn: at most `|pins|` map lookups, and the first hit is the entry four
    // slices of search already went into.
    for (const pin of run.pins) {
      const speculative = pinContextKey(
        run.pins.map((p) => (p.unitId === pin.unitId ? { ...p, tentative: true } : p)),
        true,
      )
      if (run.cache.promote(speculative, key, run.epoch, run.pins)) break
    }
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
      evaluate: run.input.evaluate,
      asTeam: run.input.asTeam,
      pins: entry.pins.filter((p) => run.refusedPins.get(p.unitId) !== p.to),
      // The decision's standing basis (reference actions, held-capacity
      // narrowings) plus the CURRENT posture — so every plan a context prices
      // shares one basis, and a posture flip re-bases rather than compares.
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
      ],
      incumbent: entry.incumbent,
      witnesses: entry.witnesses,
      budget,
      // THE RETENTION SEAM, and only for the COMMITTED context: a speculative
      // context is a different basis (its pin is binding inside it), and Law E
      // forbids sorting two bases into one table. L3's `rankConditional` is
      // where the speculative rows are read, out of the context that already
      // holds them.
      ...(run.lens === null || entry.speculative
        ? {}
        : { trials: (trial: TrialObservation): void => this.retain(run, entry, trial) }),
    }
  }

  /** Fold a returned score into the context and the candidate table. */
  private absorb(run: Run, entry: PinContextEntry, score: PlanScore): void {
    entry.incumbent = score
    entry.bounds = { lo: score.bounds.worst, hi: score.bounds.best }
    // The basis this bracket was proved under travels with it: an advice layer
    // differencing it against a record must be able to prove the two agree.
    entry.boundsBasis = { posture: run.governor.current, epoch: run.epoch }
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
    // THE PLAN'S HORIZON, NOT THE SLICE'S (06 F-2). This used to read
    // `run.lastView?.horizon` — the view's, i.e. whatever depth the slice's
    // LEADER had reached — and wrote it onto every plan the slice absorbed.
    // But `deepen` names ONE plan (`voc.ts`: `{ kind: "deepen", planKey }`), so
    // attributing that plan's depth to its neighbours is attributing a proof to
    // something it was never run on. The reading carries its own horizon now,
    // and absent it the honest default is 1.
    const horizon = score.horizon ?? 1
    const existing = run.plans.get(key)
    if (existing === undefined) {
      run.plans.set(key, { key, plan: score.plan, score, bound, horizon })
    } else {
      existing.score = score
      existing.bound = bound
      existing.horizon = horizon
    }
  }

  /**
   * Map a staging row back to a plan. Every row comes from `run.plans` (see
   * `rows`), so every row maps back; the null is the impossible case said out
   * loud rather than asserted away.
   */
  private candidateFor(run: Run, row: StagingCandidate): PlanCandidate | null {
    return run.plans.get(row.key) ?? null
  }

  /**
   * The slack that goes on the wire: the true root slack `max_R(R.hi − L.lo)`
   * whenever a rival exists, and the incumbent's own bound gap only when one
   * does not.
   *
   * THE RIVAL SET WAS NEVER MISSING (06 F-9). The guard used to be
   * `run.lastView !== null` — a lever surface with no producer — so the field
   * degraded to the incumbent's bound gap on every decision this bot has ever
   * taken, which is a DIFFERENT QUANTITY wearing the same name: a bound gap
   * says how unsure we are of the leader, root slack says how much of the
   * decision is still open. `rows()` has always built its table from
   * `run.plans`, the per-decision map holding every plan `absorb` saw, so the
   * rivals were in hand the whole time and only the guard refused them. The
   * guard now asks the honest question — is there a rival at all — and the
   * degraded answer is reserved for the case that has none.
   */
  private slackFor(
    run: Run,
    rows: ReadonlyArray<StagingCandidate>,
    idx: number,
    row: StagingCandidate,
    plan: JointPlan,
  ): number {
    // THE RIVAL SET THE FIELD ALWAYS WANTED (04 §5.2 #12). `rootSlack` is
    // `max_R(R.hi − L.lo)` over RIVALS, and this kernel has never had a rival
    // set: the lever surface has no producer, so the field degraded to the
    // incumbent's own bound gap — a different quantity wearing the same name.
    // The reservoir IS a rival set, per cluster and per complement, and the
    // widest gap over the fibers that answer THIS record's question is the
    // root slack, computable for the first time.
    const retained = this.lensSlack(run, plan)
    if (retained !== null) return retained
    // Clamped at zero exactly as `lensSlack` clamps its own: a negative root
    // slack means every rival's ceiling already sits below the leader's floor,
    // which is a decision with nothing left open, not a negative amount of
    // openness.
    if (idx >= 0 && rows.length > 1) return Math.max(0, rootSlack(rows, idx))
    return Math.max(0, row.hi - row.lo)
  }

  /** `max over retained rivals of (rᵢ.hi − leader.lo)`, over the fibers whose
   *  complement is the one this plan actually puts on the board. Null when no
   *  rival was retained: without a rival set the honest answer is the degraded
   *  one, said plainly, exactly as `leverOrderBinding` used to say it. */
  private lensSlack(run: Run, plan: JointPlan): number | null {
    const reservoir = run.reservoir
    if (reservoir === null || run.clusters.length === 0) return null
    try {
      const cut = this.cutPlan(run, plan)
      let slack: number | null = null
      for (const cluster of run.clusters) {
        const per = cut.per.get(cluster.id)
        if (per === undefined) continue
        const rows = reservoir.rows(cluster.id, per.complementKey)
        if (rows.length <= 1) continue
        slack = Math.max(slack ?? 0, slackFrom(rows))
      }
      return slack === null ? null : Math.max(0, slack)
    } catch {
      return null
    }
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
    return run.input.evaluate.scorePlan(run.input.sub, plan, run.input.asTeam)
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
    //
    // IT IS ALSO A TIMELINE FACT, not a summary statistic: which channel
    // adjudicates just changed underneath the operator, and they are entitled
    // to see the moment it happened rather than a count at the end.
    this.emitLens(run, (at) => ({
      kind: "posture",
      at,
      from: flip.from,
      to: flip.to,
      channel: channelPolicyFor(flip.to).orderBy,
    }))
    const carried = run.basis.staged
    const carriedPlan = run.basis.stagedPlan
    run.basis = newBasis(run.epoch, flip.to, run.basis.horizon)
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
    // A cluster carries its basis, and the basis just changed: the partition
    // is re-emitted so no consumer holds a `ClusterView` whose posture is a
    // posture the kernel has stopped adjudicating under.
    this.repartition(run, "posture-flip")
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
    // AN UNANSWERED QUESTION IS NOT A VERDICT. A view with no held-unit surface
    // — the production search core offers none, because a claim narrowing is a
    // marshalling-time input and entanglement gating decides `advanced` for
    // itself — cannot say whether the residue is dischargeable, and reading its
    // silence as "no" would flip the governor into FOGGED-VACUOUS on a question
    // nobody asked. Same posture the kernel takes toward an unanswerable
    // substrate everywhere else.
    const dischargeable =
      view === null || view.units.length === 0
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
   * THE STAGING TABLE HAS ONE SOURCE, AND IT IS `run.plans`.
   *
   * It used to prefer the refinement view's candidate list whenever one
   * existed. Two lists, and they are not two views of one thing: the view's
   * `est` is the bank's — B0's advisory scalar, clamped — while `run.plans`
   * carries the kernel's OWN `evaluateBound`, which is the number `gate()`
   * ratchets and `record()` publishes. Ranking on one and ratcheting on the
   * other puts two answers to one question in one sorted list, and it would do
   * so only on the builds where a refiner happens to exist, which is the worst
   * possible way to acquire a difference. The view is the SEARCH's lever
   * surface; the candidate table is the KERNEL's rival set (06 F-9), and each
   * stays what it is.
   */
  private rows(run: Run): StagingCandidate[] {
    const out: StagingCandidate[] = []
    for (const cand of run.plans.values()) {
      const bounds = cand.score?.bounds
      const lo = bounds?.worst ?? cand.bound.lo
      const hi = bounds?.best ?? cand.bound.hi
      const vacuity = bounds
        ? detectVacuity(bounds, this.opts.deadBelow).cause
        : lo <= this.opts.deadBelow
          ? "material-dead"
          : "alive"
      out.push({ key: cand.key, lo, est: cand.bound.est, hi, horizon: cand.horizon, vacuity })
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
    const slack = this.slackFor(run, rows, idx, decision.staged, cand.plan)
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
          }
    const verdict = this.crossfade(run, cand.plan)
    if (verdict === "blocked") run.crossfade.forcedUncertified++
    return this.record(
      run,
      cand,
      row,
      this.slackFor(run, rows, idx, row, cand.plan),
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
    // THE BASIS ENDS WHERE ITS COORDINATE CHANGES (06 F-8). Under `lo` the
    // horizon is inert and this never fires; under `est` — the FOGGED-VACUOUS
    // channel, where the ratcheted value IS the clamped est — a reading proved
    // at another depth is not a stronger or weaker version of this basis's
    // promise, it is a promise about a different question. So the basis is
    // replaced rather than compared across, exactly as a posture flip replaces
    // it, and the staged record carries over because the WIRE did not change.
    if (run.basis.channel === "est" && row.horizon !== run.basis.horizon) {
      const carried = run.basis.staged
      const carriedPlan = run.basis.stagedPlan
      run.basis = newBasis(run.epoch, run.governor.current, row.horizon)
      run.basis.staged = carried
      run.basis.stagedPlan = carriedPlan
    }
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
        return this.refuse(run, "ratchet-floor", cand.key)
      }
      if (gap > basis.maxGap) {
        run.boundViolations++
        run.refusals["ratchet-gap"]++
        return this.refuse(run, "ratchet-gap", cand.key)
      }
      const changed = cand.key !== planKey(prev.plan)
      if (changed) {
        // Defence in depth behind the sticky stager, whose switch margin is
        // strictly stronger: a plan change needs a strictly better proven
        // value on the leading channel, whatever proposed it.
        if (value <= basis.floorChannel) {
          run.refusals["switch-floor"]++
          return this.refuse(run, "switch-floor", cand.key)
        }
        if (this.opts.switchRule === "dominance" && value < basis.stagedHi) {
          run.refusals["switch-dominance"]++
          return this.refuse(run, "switch-dominance", cand.key)
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
          return this.refuse(run, "worth", cand.key)
        }
      }
      // Gate 3 — RATE. There is no server-side throttle; this is the throttle.
      // It lives on the RUN, not the basis: it protects the wire, and the wire
      // does not care which epoch or posture the record came from.
      if (!forced && run.now() - run.lastWriteMs < this.opts.minWriteIntervalMs) {
        run.refusals.rate++
        return this.refuse(run, "rate", cand.key)
      }
    }

    // Gate 3½ — CONFORMANCE. Humans always win: a plan that contradicts a
    // committed pin never reaches the wire, whatever the search believes about
    // its value. A conforming search should make this unreachable; it is here
    // because "should" is not a guarantee and the operator is not negotiable.
    if (!this.conformsToPins(run, cand.plan)) {
      run.refusals.nonconforming++
      return this.refuse(run, "nonconforming", cand.key)
    }

    // Gate 4 — CROSSFADE.
    const verdict = this.crossfade(run, cand.plan)
    if (verdict === "blocked") {
      run.crossfade.blocked++
      run.refusals.crossfade++
      return this.refuse(run, "crossfade", cand.key)
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
      // ON THE KERNEL'S OWN CLOCK, measured from this decision's t0 — the same
      // origin `KernelReport.elapsedMs` is measured from, so a journal and the
      // report summary are one timeline and a fake-clock test is exact.
      elapsedMs: run.now() - run.t0,
    }
  }

  private assumptions(run: Run, cand: PlanCandidate): ReadonlyArray<Assumption> {
    const out: Assumption[] = [{ kind: "posture", posture: run.governor.current }]
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
      if (run.lens !== null) this.refuse(run, "sink", planKey(rec.plan))
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
    // THE BARRIER. The collapse belongs here and not at the first comparison,
    // so the order a consumer sees is: the write, then the rows that explain
    // it — sealed, so every row carries the branch that refused it.
    this.sealAt(run, rec.plan)
    this.emitLens(run, (at) => ({ kind: "emission", at, record: rec }))
    // A NEW BARRIER IS A NEW MOMENT. The reasons framed before this emission
    // are about the search that produced it; the next stretch gets its own
    // tick per reason. Clearing here rather than per slice is what makes the
    // cadence match the timeline's own: the lane's unit is the emission.
    run.refusalsFramed.clear()
    this.frameMovesets(run, rec.plan)
  }


  // ----------------------------------------------------------------- lens

  /**
   * ONE FRAME, on the kernel's own clock.
   *
   * The event is built by a THUNK so that a decision nobody is watching pays
   * one null check: no object, and — the part that matters under `--nodes` —
   * no clock read, because a read is work and work is the clock.
   *
   * Wrapped in try/catch, which is the rule telemetry already has: a lens
   * consumer that throws must not be able to take a decision down.
   */
  private emitLens(run: Run, build: (at: number) => LensEvent): void {
    if (run.lens === null) return
    try {
      run.lens(build(run.now() - run.t0))
    } catch {
      /* a consumer that cannot look is not a reason to stop deciding */
    }
  }


  /**
   * ONE FRAME PER OPERATOR EVENT, stamped at ARRIVAL.
   *
   * `arrivedAt` is the `PendingEvent` stamp, never the dequeue reading (V4 R2
   * extended from the conformance sample to the timeline): the operator's
   * timeline must show when THEY acted, not when the loop noticed. And
   * `answers` carries the id the caller queued the event with, which is what
   * turns "the operator pinned and then something was staged" into "this
   * write is the answer to that pin".
   */
  private frameOperators(
    run: Run,
    drained: ReadonlyArray<PendingEvent>,
    slicesAtEvent: number
  ): void {
    if (run.lens === null) return
    for (const p of drained) {
      const arrived = Math.min(Math.max(p.at ?? run.t0, run.t0), run.now())
      this.emitLens(run, (at) => ({
        kind: "operator",
        at,
        arrivedAt: arrived - run.t0,
        event: p.ev,
        epoch: run.epoch,
        latencyMs: Math.max(0, at - (arrived - run.t0)),
        slicesBefore: run.slices - slicesAtEvent,
        answers: p.id,
      }))
    }
  }

  /** The fixity context the partitioner reads, in the WIRE's numbering. */
  private fixitiesOf(run: Run): {
    pins: FixedUnit[]
    committed: FixedUnit[]
    references: FixedUnit[]
    unreachablePins: FixedUnit[]
  } {
    const sub = run.input.sub
    const key = (unitId: UnitId): UnitKey => unitKeyOf(sub, unitId)
    const committed: FixedUnit[] = []
    for (const unitId of run.committedUnits) {
      const to = run.pins.find((p) => p.unitId === unitId)?.to ?? run.wirePlan?.get(unitId)?.to ?? -1
      committed.push({ unit: key(unitId), to, by: null })
    }
    const pins: FixedUnit[] = this.honorablePins(run).map((p) => ({
      unit: key(p.unitId),
      to: p.to,
      by: null,
    }))
    const references: FixedUnit[] = (run.input.assumptions ?? [])
      .filter((a) => a.kind === "reference-action")
      .map((a) => ({ unit: key(a.unitId as UnitId), to: (a as { to: number }).to, by: null }))
    const unreachablePins: FixedUnit[] = [...run.refusedPins].map(([unitId, to]) => ({
      unit: key(unitId),
      to,
      by: null,
    }))
    return { pins, committed, references, unreachablePins }
  }

  /**
   * Re-partition and say so. Once at t0, then once per constraint epoch and
   * once per posture flip — the vertex set moves only on a basis change, and
   * the edges are a function of the board, which does not move within a turn.
   *
   * NEVER CACHED ACROSS A DETERMINATION (03 §7.7): a catch-up replaces a
   * premise rather than refining it, and the whole partition is recomputed
   * from the substrate every time this runs.
   */
  private repartition(run: Run, cause: PinEvent | "decision-start" | "posture-flip"): void {
    if (run.lens === null) return
    try {
      // The basis the partition sits at, in the bounds layer's own words. A
      // cluster's content key names it, so a consumer validating a retained
      // row against a cluster is validating the fiber and not just the shape.
      run.basisKey = basisKeyOf(
        basisOf(this.searchContext(run, run.active, new SliceBudget(run.now, run.t0, run.t0)))
      )
      const before = run.clusters
      const after = partitionOf({
        sub: run.input.sub,
        asTeam: run.input.asTeam,
        epoch: run.epoch,
        posture: run.governor.current,
        basis: run.basisKey,
        previous: before.length > 0 ? before : undefined,
        ...this.fixitiesOf(run),
      })
      run.clusters = after
      const changes = diffPartitions(before, after)
      this.emitLens(run, (at) => ({
        kind: "partition",
        at,
        epoch: run.epoch,
        posture: run.governor.current,
        clusters: after,
        changes,
        cause,
      }))
    } catch {
      /* a partition that cannot be computed is not a reason to stop deciding */
    }
  }

  /**
   * THE PLAN, CUT INTO ONE RESTRICTION PER CLUSTER.
   *
   * `planKey` sorts its parts, so building every part once and splitting the
   * SORTED list per cluster produces exactly `planKey(restriction)` and
   * `planKey(complement)` — the two halves of Law E's third coordinate — for
   * every cluster in one pass, with no second sort and no second traversal.
   */
  private cutPlan(
    run: Run,
    plan: JointPlan
  ): { whole: string; per: Map<number, { key: string; complementKey: string }> } {
    const parts: Array<{ unitId: UnitId; part: string }> = []
    for (const [unitId, c] of plan) parts.push({ unitId, part: `${unitId}>${c.to}:${c.path.join(".")}` })
    parts.sort((a, b) => (a.part < b.part ? -1 : a.part > b.part ? 1 : 0))
    const per = new Map<number, { key: string; complementKey: string }>()
    for (const cluster of run.clusters) {
      const members = new Set<UnitId>()
      for (const m of cluster.members) {
        const id = run.input.sub.unitIdOf(m)
        if (id !== undefined) members.add(id)
      }
      const inside: string[] = []
      const outside: string[] = []
      for (const p of parts) (members.has(p.unitId) ? inside : outside).push(p.part)
      per.set(cluster.id, { key: inside.join("|"), complementKey: outside.join("|") })
    }
    return { whole: parts.map((p) => p.part).join("|"), per }
  }

  /** One retained row, materialised. Only ever called for a trial the
   *  reservoir has already said it would keep. */
  private rowOf(
    run: Run,
    cluster: ClusterView,
    cut: { key: string; complementKey: string },
    whole: string,
    trial: TrialObservation,
    quanta: number
  ): Moveset {
    const sub = run.input.sub
    const lo = trial.bounds.worst
    const hi = trial.bounds.best
    const moves: MovesetMove[] = []
    for (const m of cluster.members) {
      const unitId = sub.unitIdOf(m)
      if (unitId === undefined) continue
      const c = trial.plan.get(unitId)
      if (c === undefined) continue
      moves.push({ unit: m, to: c.to, path: [...c.path] })
    }
    const cited = new Set<UnitKey>()
    for (const e of trial.bounds.ledger) cited.add(unitKeyOf(sub, e.unitId))
    const reading = {
      // THE READING'S OWN HORIZON (06 F-2), never `EmitRecord.horizon`, which
      // is a property of an emission rather than of a proof.
      horizon: trial.horizon ?? 1,
      lo,
      est: trial.est,
      hi,
      exact: trial.bounds.exact,
      ledgerSize: trial.bounds.ledger.length,
      basis: run.basisKey,
      citedUnits: [...cited],
      atMs: run.stamp,
      quanta,
    }
    return {
      cluster: cluster.id,
      clusterKey: cluster.key,
      generation: cluster.generation,
      key: cut.key,
      rank: 0,
      moves,
      basis: run.basisKey,
      complementKey: cut.complementKey,
      complement: "live",
      witness: whole,
      lo,
      est: trial.est,
      hi,
      channel: run.basis.channel,
      exact: trial.bounds.exact,
      ledgerSize: trial.bounds.ledger.length,
      citedUnits: [...cited],
      assumptions: trial.bounds.assumptions,
      vacuity: detectVacuity(trial.bounds, this.opts.deadBelow).cause,
      seenIn: 1,
      rung: trial.rung,
      at: run.stamp,
      tie: trial.tie,
      staged: false,
      dominance: null,
      // HORIZON 1 IS THE ONLY READING THIS BUILD HAS (06 F-2). The column is
      // carried as DATA now — two readings, a line and a three-way delta —
      // so that depth, when it lands, fills fields rather than adding them:
      // `deepest === h1`, the line is empty, and every delta is zero, which
      // is the truth about a search that has not deepened.
      depth: {
        h1: reading,
        deepest: reading,
        derived: true,
        line: [],
        lineTruncated: false,
        rankAtH1: 0,
        confidence: "equal",
        terminal: "none",
        delta: {
          lo: 0,
          hi: 0,
          width: 0,
          rank: 0,
          attribution: { width: 0, terminal: 0, residual: 0 },
          voided: false,
        },
      },
    }
  }

  /**
   * THE RETENTION, at the `better()` call site.
   *
   * `admits` first, and it is four numeric comparisons: a trial that would not
   * be kept costs the search nothing but those. Only a trial that WILL be kept
   * is cut into restrictions and materialised.
   */
  private retain(run: Run, entry: PinContextEntry, trial: TrialObservation): void {
    const reservoir = run.reservoir
    if (reservoir === null || run.clusters.length === 0) return
    try {
      const order = { lo: trial.bounds.worst, est: trial.est, hi: trial.bounds.best, tie: trial.tie }
      let cut: ReturnType<LobsterKernel["cutPlan"]> | null = null
      for (const cluster of run.clusters) {
        if (cut === null) cut = this.cutPlan(run, trial.plan)
        const per = cut.per.get(cluster.id)
        if (per === undefined) continue
        if (!reservoir.admits(cluster.id, per.complementKey, order)) continue
        if (run.plansByMoveset.size < LENS_ROW_CAP * 4) run.plansByMoveset.set(per.key, trial.plan)
        if (trial.loud != null && run.loudByMoveset.size < LENS_ROW_CAP * 4) {
          run.loudByMoveset.set(per.key, trial.loud)
        }
        reservoir.offer(
          this.rowOf(run, cluster, per, cut.whole, trial, entry.cursor),
          trial.because === null ? null : { because: trial.because, ...(trial.witness === null ? {} : { witness: trial.witness }) }
        )
      }
    } catch {
      /* a row that cannot be built is not a reason to stop deciding */
    }
  }

  /**
   * THE BARRIER. The collapse belongs here — not at the first comparison —
   * so this is where `dominance` is filled, where a row whose complement is
   * no longer the incumbent's is struck, and where the staged plan takes rank
   * 1 of its own fiber.
   */
  private sealAt(run: Run, plan: JointPlan): void {
    const reservoir = run.reservoir
    if (reservoir === null || run.clusters.length === 0) return
    try {
      const cut = this.cutPlan(run, plan)
      const live = new Map<number, string>()
      for (const cluster of run.clusters) {
        const per = cut.per.get(cluster.id)
        if (per === undefined) continue
        live.set(cluster.id, per.complementKey)
      }
      reservoir.seal(live)
      for (const cluster of run.clusters) {
        const per = cut.per.get(cluster.id)
        if (per === undefined) continue
        reservoir.stageRow(cluster.id, per.complementKey, per.key)
      }
    } catch {
      /* as above: the decision outlives the lens, never the other way round */
    }
  }

  /** The `movesets` frames, one per cluster whose retained rows changed. */
  private frameMovesets(run: Run, plan: JointPlan): void {
    const reservoir = run.reservoir
    if (run.lens === null || reservoir === null) return
    try {
      const cut = this.cutPlan(run, plan)
      for (const cluster of run.clusters) {
        const per = cut.per.get(cluster.id)
        if (per === undefined) continue
        const rows = reservoir.rows(cluster.id, per.complementKey)
        if (rows.length === 0) continue
        const fingerprint = rows.map((r) => `${r.key}#${r.lo}/${r.est}/${r.hi}/${r.rank}`).join(";")
        if (run.framed.get(cluster.id) === fingerprint) continue
        run.framed.set(cluster.id, fingerprint)
        // THE FRAME'S OWN CONTEXT: `Q` and `P` as measured on the LEADER's
        // plan. One reading per frame rather than one per row, because the
        // question step 1 asks — would a ceiling ply have been affordable on
        // the decision this frame is about — is a question about the row the
        // decision is standing on.
        const loud = run.loudByMoveset.get((rows[0] as Moveset).key) ?? null
        this.emitLens(run, (at) => ({
          kind: "movesets",
          at,
          clusterId: cluster.id,
          rows,
          complementKey: per.complementKey,
          loud,
        }))
      }
    } catch {
      /* as above */
    }
  }

  /**
   * A refused write is a thing that HAPPENED at a TIME, and the timeline
   * should say so — today these are only counters on the report.
   *
   * ONCE PER REASON PER EMISSION BARRIER. `Run.refusalsFramed` explains why,
   * and the number that decided it is in `07-MEASURED.md`: unthrottled, the
   * refusal frame was 98% of every row written and put a turn's event log two
   * orders of magnitude over the budget the wire envelope is designed around.
   * The counters stay exact on the report; what the lens adds is the MOMENT,
   * and a moment repeated three hundred times between two emissions is one
   * moment. The barrier is the cadence because the barrier is the timeline
   * lane's own unit — a tick the operator can actually land the playhead on.
   */
  private refuse(run: Run, refusal: EmitRefusal, key: string): null {
    if (run.lens === null) return null
    if (run.refusalsFramed.has(refusal)) return null
    run.refusalsFramed.add(refusal)
    this.emitLens(run, (at) => ({ kind: "refusal", at, refusal, planKey: key }))
    return null
  }


  /**
   * THE QUERY PORT a running kernel exposes to its inspectors (04 §4.4).
   *
   * Reads the LIVE run — `lastReport` only exists once a decision has ended,
   * which is when the turn is about to resolve and the operator has stopped
   * looking. Every method answers about the decision that is happening now, or
   * refuses in a way a display can render.
   */
  lensPort(): KernelLensPort {
    // `this` inside the returned literal is the LITERAL. The kernel is
    // captured, once, so the port reads the live run rather than nothing.
    const kernel = this
    const off: LensRefusal = {
      ok: false,
      refusal: "off-head",
      detail: "no decision is running: an inspection is a question about a live search",
    }
    return {
      partition: (): ReadonlyArray<ClusterView> => this.run?.clusters ?? [],
      movesets: (cluster: ClusterId): ReadonlyArray<Moveset> => {
        const run = this.run
        if (run === null || run.reservoir === null) return []
        const plan = run.wirePlan
        if (plan === null) return run.reservoir.rows(cluster)
        return run.reservoir.rows(cluster, this.cutPlan(run, plan).per.get(cluster)?.complementKey)
      },
      rankConditional: (cluster: ClusterId, locks: ReadonlyArray<Lock>): RankConditionalResult => {
        const run = this.run
        if (run === null) return off
        const left = run.reserveMs - run.reserveSpent
        // PAST THE RESERVE, THE ANSWER IS A TYPED REFUSAL AND NEVER A ROW.
        // An inspection that cannot be afforded must say so: a served row
        // would be the decision paying for the operator's attention, which is
        // the one trade the whole reserve exists to forbid.
        if (!(left > 0)) {
          return {
            ok: false,
            refusal: "reserve-spent",
            detail: `the inspection reserve is spent: ${run.reserveSpent.toFixed(3)} of ${run.reserveMs}`,
          }
        }
        // INSIDE A SLICE the sink is not called. The request is queued for the
        // next boundary and the operator gets the FIRST PAINT now, which is a
        // read of rows the decision already priced and costs it nothing.
        if (run.inSlice) {
          run.queued.push({ cluster, locks })
          return this.firstPaint(run, cluster, locks)
        }
        return this.inspect(run, cluster, locks)
      },
      explainMoveset: (
        key: MovesetKey,
        members?: ReadonlyArray<UnitKey>,
      ): Promise<MovesetBreakdown | LensRefusal> => {
        const run = this.run
        if (run === null) return Promise.resolve(off)
        return Promise.resolve(this.explainMovesetNow(run, key, members))
      },
      get reserve(): LensReserve {
        const run = kernel.run
        return {
          budgetMs: run?.reserveMs ?? 0,
          spentMs: run?.reserveSpent ?? 0,
          queued: run?.queued.length ?? 0,
        }
      },
    }
  }


  /** Serve every inspection that arrived while a slice was running. */
  private drainInspections(run: Run): void {
    if (run.queued.length === 0) return
    const waiting = run.queued.splice(0, run.queued.length)
    for (const request of waiting) {
      if (!(run.reserveMs - run.reserveSpent > 0)) break
      this.inspect(run, request.cluster, request.locks)
    }
  }

  /**
   * PHASE 2 — the speculative context, charged to the reserve.
   *
   * The head is `conform(ctx ⊕ pin, wirePlan)`: the same object a lock stages,
   * because [CHANGE 2] promotes the entry rather than starting a new one. What
   * it costs is measured on the kernel's own clock and taken off the reserve,
   * so an operator who hovers all turn shortens the search by exactly the
   * amount that was declared before the turn began — and no more.
   */
  private inspect(
    run: Run,
    cluster: ClusterId,
    locks: ReadonlyArray<Lock>,
  ): RankConditionalResult {
    const view = run.clusters.find((c) => c.id === cluster)
    if (view === undefined) {
      return { ok: false, refusal: "unknown-cluster", detail: `no cluster ${cluster} at this basis` }
    }
    const before = run.now()
    const left = run.reserveMs - run.reserveSpent
    const budget = new SliceBudget(run.now, run.t0, before + left)
    const ctx = { ...this.searchContext(run, run.active, budget), trials: undefined }
    let answer: RankConditionalResult
    try {
      answer = rankConditionalPure({
        ctx,
        search: run.input.search,
        cluster,
        generation: view.generation,
        locks,
        reserveMs: left,
        ...(run.wirePlan === null ? {} : { wirePlan: run.wirePlan }),
        retained: run.reservoir?.rows(cluster) ?? [],
        cursor: run.active.cursor,
        // THE KERNEL'S OWN CLOCK. The ranking of the rest of the cluster is
        // bounded by what it SPENDS, measured here, and not by an assumption
        // about what a conform costs.
        now: run.now,
      })
    } catch {
      answer = {
        ok: false,
        refusal: "off-head",
        detail: "the conditional context could not be built on this basis",
      }
    }
    run.reserveSpent += Math.max(0, run.now() - before)
    if (answer.ok) {
      const ranking: ConditionalRanking = answer
      this.emitLens(run, (at) => ({ kind: "conditional", at, ranking }))
    }
    return answer
  }

  /**
   * LEVEL 1 ALWAYS, LEVEL 2 FOR THE NAMED MEMBERS (04 §4.4).
   *
   *  · the AGGREGATE is one `explainPlan` on the row's own plan — the joint
   *    fold, whole-board, which is the only kind of number Law A permits;
   *  · a MARGINAL is a CONTRASTIVE DELTA, not a share: the same explanation
   *    with one member swapped to its next-best option, differenced. A
   *    difference of two joint explanations is legitimate exactly where a sum
   *    is not, and it is the question the operator is asking — "what does this
   *    unit's move buy?" — rather than a fabricated attribution;
   *  · the RESIDUAL is `aggregate − Σ marginals`, NAMED and always present,
   *    zero included. A display that shows the deltas without it is showing a
   *    total that does not add up and hiding the fact.
   *
   * An evaluator that does not explain gets `aggregate: null` and no
   * marginals. That is not an error state — it is the state every non-
   * production evaluator produces, and the panel says "this evaluator does not
   * explain" rather than drawing zeros.
   */
  private explainMovesetNow(
    run: Run,
    key: MovesetKey,
    members?: ReadonlyArray<UnitKey>,
  ): MovesetBreakdown | LensRefusal {
    const left = run.reserveMs - run.reserveSpent
    if (!(left > 0)) {
      return { ok: false, refusal: "reserve-spent", detail: "the inspection reserve is spent" }
    }
    const plan = run.plansByMoveset.get(key)
    if (plan === undefined) {
      return { ok: false, refusal: "unknown-cluster", detail: `no retained row keyed ${key}` }
    }
    const before = run.now()
    try {
      const sub = run.input.sub
      const evaluate = run.input.evaluate
      const explain = evaluate.explainPlan?.bind(evaluate)
      const empty: JointResidual = { total: { lo: 0, est: 0, hi: 0 }, features: [] }
      if (explain === undefined) {
        return this.framedBreakdown(run, {
          moveset: key,
          basis: run.basisKey,
          aggregate: null,
          marginals: [],
          residual: empty,
        })
      }
      const whole = explain(sub, plan, run.input.asTeam)
      const wanted = new Set(members ?? [])
      const marginals: MemberMarginal[] = []
      for (const [unitId, chosen] of plan) {
        const unit = unitKeyOf(sub, unitId)
        if (members !== undefined && !wanted.has(unit)) continue
        // THE FOIL: this unit's next-best option, with every other unit held
        // exactly where it is. The plan's domain is unchanged, so the two
        // explanations share a basis and their difference is legal.
        const foil = run.input.gen
          .candidatesFor(sub, unitId)
          .candidates.find((c) => c.to !== chosen.to)
        if (foil === undefined) continue
        const swapped = new Map(plan)
        swapped.set(unitId, foil)
        const against = explain(sub, swapped, run.input.asTeam)
        marginals.push({
          unit,
          delta: minus(whole.bound, against.bound),
          features: deltaFeatures(whole.features, against.features),
          against: { to: foil.to },
        })
      }
      return this.framedBreakdown(run, {
        moveset: key,
        basis: run.basisKey,
        aggregate: {
          profile: whole.profile,
          bound: whole.bound,
          features: whole.features,
          exact: whole.exact,
          ledgerSize: whole.ledgerSize,
        },
        marginals,
        residual: residualOf(whole, marginals),
      })
    } catch {
      return { ok: false, refusal: "off-head", detail: "the explanation could not be built" }
    } finally {
      run.reserveSpent += Math.max(0, run.now() - before)
    }
  }

  /**
   * THE ANSWER IS ALSO A FRAME. An explanation the operator asked for is a
   * fact about this decision exactly as a conditional ranking is, so it is
   * emitted beside it — one event, the breakdown verbatim — and the fold
   * holds it. Without this the socket got the numbers, the log got nothing,
   * and a replayed turn showed the drilled row as "[B] to price this row"
   * forever (09 §A6). It is the ONE line that changes here: what the kernel
   * decides, and every reading it takes, are untouched.
   */
  private framedBreakdown(run: Run, breakdown: MovesetBreakdown): MovesetBreakdown {
    this.emitLens(run, (at) => ({ kind: "breakdown", at, moveset: breakdown.moveset, breakdown }))
    return breakdown
  }

  /** Phase 1 alone: the retained rows, filtered by the lock, marked
   *  provisional. Zero evaluations, zero clock. */
  private firstPaint(
    run: Run,
    cluster: ClusterId,
    locks: ReadonlyArray<Lock>,
  ): RankConditionalResult {
    return this.rankConditionalNow(run, cluster, locks)
  }

  /**
   * PHASE 1 — THE FIRST PAINT, in the same frame as the click.
   *
   * The retained reservoir, filtered by the lock. Rows out immediately, marked
   * `provisional`, and when the filter is empty the answer is `source:
   * 'empty'` — which a display renders as SEARCHING and never as NOTHING. The
   * two are indistinguishable to a reader and only one of them is true: the
   * reservoir holds a cluster's top-k, and an operator asking about a unit's
   * fifth candidate is asking about a row nobody priced.
   *
   * Phase 2 — the speculative context, which makes the head `conform(ctx ⊕
   * pin)` rather than an approximation of it — is L3's, with the reserve it is
   * charged to and the typed refusal past it.
   */
  private rankConditionalNow(
    run: Run,
    cluster: ClusterId,
    locks: ReadonlyArray<Lock>,
  ): RankConditionalResult {
    const view = run.clusters.find((c) => c.id === cluster)
    if (view === undefined) {
      return { ok: false, refusal: "unknown-cluster", detail: `no cluster ${cluster} at this basis` }
    }
    const held = new Map<UnitKey, number>()
    for (const lock of locks) held.set(lock.unit, lock.to)
    const complementKey =
      run.wirePlan === null ? undefined : this.cutPlan(run, run.wirePlan).per.get(cluster)?.complementKey
    const rows = (run.reservoir?.rows(cluster, complementKey) ?? []).filter((row) =>
      row.moves.every((m) => {
        const to = held.get(m.unit)
        return to === undefined || to === m.to
      }),
    )
    // LOCKING NARROWS (04 §3, Q2). The locked unit leaves `members` for the
    // `boundedBy` strip, and by T1 that can only narrow or split — never widen.
    const locked: FixedUnit[] = locks.map((l) => ({ unit: l.unit, to: l.to, by: null }))
    const fixities = this.fixitiesOf(run)
    const after = partitionOf({
      sub: run.input.sub,
      asTeam: run.input.asTeam,
      epoch: run.epoch,
      posture: run.governor.current,
      basis: run.basisKey,
      ...fixities,
      pins: [...fixities.pins, ...locked],
    })
    const members = new Set(view.members)
    const clusterAfter =
      after.find((c) => c.members.some((m) => members.has(m))) ??
      ({ ...view, members: [], boundedBy: [...view.boundedBy, ...locked.map((l) => ({ ...l, why: "pin" as const }))] })
    const ranking: ConditionalRanking = {
      cluster,
      locks,
      clusterAfter,
      rows,
      source: rows.length === 0 ? "empty" : "retained-filter",
      cursor: run.active.cursor,
      provisional: true,
      degraded: false,
      contextKey: pinContextKey(
        [...canonicalPins(run.pins), ...locks.map((l) => ({
          unitId: run.input.sub.unitIdOf(l.unit) ?? -1,
          to: l.to,
          tentative: true,
        }))],
        true,
      ),
      final: false,
      // THE FIRST PAINT RANKS NOTHING, so there is nothing it cut short: the
      // rows are the ones the search already priced, and phase 2 is where the
      // rest of the cluster is ranked and where the reserve can stop it.
      truncated: null,
    }
    this.emitLens(run, (at) => ({ kind: "conditional", at, ranking }))
    return { ok: true, ...ranking }
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
      finalStepCostMs: run.active.stepCostMs,
      epochs: run.epoch + 1,
      conformance: run.conformance,
      cache: { ...run.cache.stats },
      journal: run.journal,
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
    }
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
    channel: b.channel,
    floorLo: b.floorLo,
    emits: b.emits,
  }
}

/** Interval arithmetic for a CONTRASTIVE DELTA. Not a share of a total: the
 *  fold is over one joint resolution, and a per-unit quantity may order work
 *  and may never compose into a value. */
function minus(a: Bound, b: Bound): Bound {
  return { lo: gap(a.lo, b.lo), est: gap(a.est, b.est), hi: gap(a.hi, b.hi) }
}

/**
 * `a − b`, with the lattice bottom handled rather than propagated.
 *
 * DEAD is `−∞`, and `−∞ − (−∞)` is `NaN` — a number that would travel down
 * into a stored row and out onto a display as a blank. Two plans that are both
 * dead differ by NOTHING on that endpoint, which is exactly what this member's
 * move bought there, so the equal case is 0. A MIXED case stays infinite,
 * because "swapping this unit turns a living plan into a dead one" is not a
 * large delta, it is an unbounded one, and rounding it into a number would be
 * the lie the cliff exists to prevent.
 */
function gap(a: number, b: number): number {
  return a === b ? 0 : a - b
}

function deltaFeatures(
  whole: ReadonlyArray<FeatureContribution>,
  against: ReadonlyArray<FeatureContribution>,
): FeatureDelta[] {
  const other = new Map(against.map((f) => [f.key, f.contribution]))
  return whole.map((f) => ({
    key: f.key,
    delta: minus(f.contribution, other.get(f.key) ?? { lo: 0, est: 0, hi: 0 }),
  }))
}

/**
 * THE NAMED JOINT RESIDUAL — `aggregate − Σ marginals`, always drawn, zero
 * included (Law A). A zero residual is itself a finding: it says the members'
 * contributions happen to account for the whole this time. Omitting a zero one
 * and omitting a large one are the same rendering bug, and only "always draw
 * it" catches both.
 */
function residualOf(
  whole: PlanExplanation,
  marginals: ReadonlyArray<MemberMarginal>,
): JointResidual {
  let total: Bound = whole.bound
  for (const m of marginals) total = minus(total, m.delta)
  const perFeature = new Map<string, Bound>()
  for (const f of whole.features) perFeature.set(f.key, f.contribution)
  for (const m of marginals) {
    for (const f of m.features) {
      perFeature.set(f.key, minus(perFeature.get(f.key) ?? { lo: 0, est: 0, hi: 0 }, f.delta))
    }
  }
  return { total, features: [...perFeature].map(([key, delta]) => ({ key, delta })) }
}

function witnessKey(w: Witness): string {
  const parts: string[] = []
  for (const [unitId, c] of w.replies) parts.push(`${unitId}>${c.to}`)
  parts.sort()
  return `${parts.join(",")}|${w.note}`
}
