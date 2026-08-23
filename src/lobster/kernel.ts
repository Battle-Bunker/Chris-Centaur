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

import type {
  Assumption,
  Bound,
  BudgetHandle,
  EmitRecord,
  JointPlan,
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

/** The cache key of a pin context. Speculative contexts get their own namespace. */
export function pinContextKey(pins: ReadonlyArray<Pin>, speculative = false): string {
  const body = pins
    .slice()
    .sort((a, b) => a.unitId - b.unitId || a.to - b.to)
    .map((p) => `${p.unitId}@${p.to}${p.tentative ? "?" : ""}`)
    .join(",")
  return `${speculative ? "spec" : "pin"}:[${body}]`
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
  /** Target duration of one refinement slice. Bounds deadline overshoot. */
  readonly sliceMs: number
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
  sliceMs: 0.5,
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
  /** Clock time from applying the pin event to the conforming record leaving the kernel. */
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

export interface KernelReport {
  readonly elapsedMs: number
  readonly budgetMs: number
  readonly overshootMs: number
  readonly slices: number
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
  readonly basisHistory: ReadonlyArray<BasisSnapshot>
  readonly journal: ReadonlyArray<EmitRecord>
  readonly levers: ReadonlyArray<Lever>
  readonly crossfade: { independent: number; certified: number; uncertified: number; blocked: number }
  readonly speculative: ReadonlyArray<{ key: string; lo: number; hi: number; cursor: number }>
  /** Every pin context this turn touched: the tier-3 store, as data. */
  readonly contexts: ReadonlyArray<{
    readonly key: string
    readonly speculative: boolean
    readonly cursor: number
    readonly epochBaseline: number
    readonly incumbentLo: number | null
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
  floorLo: number
  floorChannel: number
  stagedHi: number
  maxGap: number
  staged: EmitRecord | null
  stagedPlan: JointPlan | null
  emits: number
}

function newBasis(epoch: number, posture: Posture): RatchetBasis {
  return {
    epoch,
    posture,
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

const EMPTY_PLAN: JointPlan = new Map()

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
  committedUnits: Set<UnitId>
  /** Committed pins whose destination the unit's grammar cannot reach, keyed
   * by unitId → the refused destination. See EmitRefusal "pin-unreachable". */
  refusedPins: Map<UnitId, number>
  epoch: number
  basis: RatchetBasis
  active: PinContextEntry
  lastView: LeverView | null
  seq: number
  lastWriteMs: number
  slices: number
  probes: number
  improveCalls: number
  refineCalls: number
  conformCalls: number
  evaluateCalls: number
  sliceCostTotal: number
  boundViolations: number
  refusals: Record<EmitRefusal, number>
  crossfade: { independent: number; certified: number; uncertified: number; blocked: number }
}

// -------------------------------------------------------------------- kernel

export class LobsterKernel implements Kernel {
  private readonly opts: KernelOptions
  /** Instance state, drained by `decide()`. Never module scope. */
  private pending: PinEvent[] = []
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
   */
  onPinEvent(ev: PinEvent): void {
    this.pending.push(ev)
  }

  async *decide(input: KernelInput): AsyncIterable<EmitRecord> {
    const now = input.now ?? defaultNow
    const t0 = now()
    const budgetMs = Math.max(0, input.deadlineMs - t0)
    const deadline = t0 + budgetMs
    const searchDeadline = deadline - this.opts.reserveMs
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
      basisHistory: [],
      pins,
      tentative: input.initialPins.filter((p) => p.tentative),
      committedUnits: new Set<UnitId>(),
      refusedPins: new Map<UnitId, number>(),
      epoch: 0,
      basis: newBasis(0, "SIGHTED"),
      active: seeded.entry,
      lastView: null,
      seq: 0,
      lastWriteMs: Number.NEGATIVE_INFINITY,
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
      crossfade: { independent: 0, certified: 0, uncertified: 0, blocked: 0 },
    }
    this.pending = []
    this.run = run
    this.auditPins(run)
    try {
      yield* this.drive(run)
    } finally {
      run.basisHistory.push(basisSnapshot(run.basis))
      this.report = this.finish(run)
      this.run = null
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
    // loop needs a counted stop as well as a timed one. It is a bug rail, not
    // a policy: a search that never spends time has nothing to sell.
    let iterations = 0
    while (run.now() < run.searchDeadline) {
      if (++iterations > 1_000_000) break
      // 1. Constraint epochs come first: the wire must never hold a set that
      //    contradicts an operator, not even for one slice.
      if (this.pending.length > 0) {
        const at = run.now()
        const slicesAtEvent = run.slices
        const changed = this.applyPinEvents(run)
        if (changed) {
          const conformCallsBefore = run.conformCalls
          const resumed = this.retarget(run)
          const conformed = this.conformNow(run, run.basis.stagedPlan ?? EMPTY_PLAN)
          run.stager.adopt(conformed.key)
          const rec = this.buildRecord(run, conformed)
          yield* this.commit(run, rec)
          run.conformance.push({
            epoch: run.epoch,
            latencyMs: run.now() - at,
            slicesBefore: run.slices - slicesAtEvent,
            conformCalls: run.conformCalls - conformCallsBefore,
            resumedFromCache: resumed,
          })
          continue
        }
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
      const sliceEnd = Math.min(run.searchDeadline, run.now() + this.opts.sliceMs)
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

  /** Apply queued events. Returns true iff a new constraint epoch started. */
  private applyPinEvents(run: Run): boolean {
    let epochChanged = false
    const events = this.pending
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
          // A human Submit: the unit's staged move is permanent for the turn.
          // Pin it where it currently stands and refuse every later change.
          const staged = run.basis.stagedPlan?.get(ev.unitId)
          const to = staged?.to ?? run.pins.find((p) => p.unitId === ev.unitId)?.to
          if (to === undefined) break
          run.committedUnits.add(ev.unitId)
          run.pins = canonicalPins(
            run.pins
              .filter((p) => p.unitId !== ev.unitId)
              .concat({ unitId: ev.unitId, to, tentative: false }),
          )
          run.tentative = run.tentative.filter((p) => p.unitId !== ev.unitId)
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
    run.basis = newBasis(run.epoch, run.governor.current)
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
    const which = run.tentative[Math.floor(run.slices / this.opts.speculativePeriod) % run.tentative.length]
    const pins: Pin[] = canonicalPins(run.pins)
      .filter((p) => p.unitId !== which.unitId)
      .concat(which)
    const key = pinContextKey(pins, true)
    return run.cache.obtain(key, pins, true, run.epoch, run.active.stepCostMs).entry
  }

  private searchContext(run: Run, entry: PinContextEntry, budget: BudgetHandle): SearchContext {
    return {
      sub: run.input.sub,
      gen: run.input.gen,
      evaluate: run.input.evaluate,
      asTeam: run.input.asTeam,
      pins: entry.pins,
      // The decision's standing basis (reference actions, held-capacity
      // narrowings) plus the CURRENT posture — so every plan a context prices
      // shares one basis, and a posture flip re-bases rather than compares.
      assumptions: [
        ...(run.input.assumptions ?? []),
        { kind: "posture", posture: run.governor.current },
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
      run.plans.set(key, { key, plan: score.plan, score, bound, horizon })
    } else {
      existing.score = score
      existing.bound = bound
      existing.horizon = horizon
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

  private evaluateBound(run: Run, plan: JointPlan): Bound {
    run.evaluateCalls++
    return run.input.evaluate.scorePlan(run.input.sub, plan, run.input.asTeam)
  }

  private conformNow(run: Run, from: JointPlan): PlanCandidate {
    const budget = new SliceBudget(run.now, run.t0, run.searchDeadline)
    const ctx = this.searchContext(run, run.active, budget)
    run.conformCalls++
    const plan = run.input.search.conform(ctx, from)
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
    run.basisHistory.push(basisSnapshot(run.basis))
    const carried = run.basis.staged
    const carriedPlan = run.basis.stagedPlan
    run.basis = newBasis(run.epoch, flip.to)
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

  private rows(run: Run): StagingCandidate[] {
    const view = run.lastView
    if (view !== null && view.candidates.length > 0) {
      return view.candidates.map((c: CandidateView) => ({
        key: c.key,
        lo: c.lo,
        est: c.est,
        hi: c.hi,
        horizon: c.horizon,
        vacuity: c.vacuity,
      }))
    }
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
    const slack = this.slackFor(run, rows, idx, decision.staged)
    return this.gate(run, cand, decision.staged, slack, decision.horizon, forced)
  }

  /**
   * The forced path: an already-chosen plan (rung 0, or the epoch-change
   * conformance re-stage). Gates 1–3 are waived because the constraint set
   * changed underneath them; the crossfade certificate is not, because the
   * wire's atomicity did not change.
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
    return this.record(run, cand, row, this.slackFor(run, rows, idx, row), row.horizon)
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
    if (!this.crossfade(run, cand.plan)) {
      run.refusals.crossfade++
      return null
    }

    return this.record(run, cand, row, slack, horizon)
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
   * Gate 4. Tier 1 is the independence test: if the units this record CHANGES
   * cannot influence any cell the unchanged staged units can, no interleaving
   * of the two writes differs from either and there is nothing to certify.
   * Tier 2 needs a teammate floor, which the contract does not yet expose; in
   * its absence overlapping writes pass and are counted as uncertified.
   */
  private crossfade(run: Run, plan: JointPlan): boolean {
    if (this.opts.crossfade === "off") return true
    const prevPlan = run.basis.stagedPlan
    if (prevPlan === null) return true
    const changed = new Set<UnitId>()
    for (const [unitId, c] of plan) {
      const before = prevPlan.get(unitId)
      if (before === undefined || before.to !== c.to || before.path.join(".") !== c.path.join("."))
        changed.add(unitId)
    }
    if (changed.size === 0) return true
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
    if (!overlaps) {
      run.crossfade.independent++
      return true
    }
    const hook = this.opts.teammateFloor
    if (hook === undefined) {
      run.crossfade.uncertified++
      return true
    }
    const before = hook(prevPlan, changed)
    const after = hook(plan, changed)
    if (after < before) {
      run.crossfade.blocked++
      return false
    }
    run.crossfade.certified++
    return true
  }

  private record(
    run: Run,
    cand: PlanCandidate,
    row: StagingCandidate,
    slack: number,
    horizon: number,
  ): EmitRecord {
    return {
      plan: cand.plan,
      lo: row.lo,
      est: cand.bound.est,
      hi: Math.max(row.hi, row.lo),
      horizon,
      slack,
      posture: run.governor.current,
      assumptions: this.assumptions(run, cand),
      epoch: run.epoch,
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
    const speculative: Array<{ key: string; lo: number; hi: number; cursor: number }> = []
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
        witnesses: e.witnesses.length,
        stepCostMs: e.stepCostMs,
      })
      if (!e.speculative || e.bounds === null) continue
      speculative.push({ key: e.key, lo: e.bounds.lo, hi: e.bounds.hi, cursor: e.cursor })
    }
    return {
      elapsedMs: end - run.t0,
      budgetMs: run.budgetMs,
      overshootMs: Math.max(0, end - run.deadline),
      slices: run.slices,
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
      basisHistory: run.basisHistory,
      journal: run.journal,
      levers: run.voc.levers,
      crossfade: { ...run.crossfade },
      speculative,
      contexts,
      activeContextKey: run.active.key,
      stagedNothing: run.journal.length === 0,
      leverOrderBinding: run.refiner !== null,
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

function witnessKey(w: Witness): string {
  const parts: string[] = []
  for (const [unitId, c] of w.replies) parts.push(`${unitId}>${c.to}`)
  parts.sort()
  return `${parts.join(",")}|${w.note}`
}
