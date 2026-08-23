/**
 * Minimal, faithful stubs for the B3 suites (voc / kernel / postures).
 *
 * Faithful means: every stub honours the part of the contract the module under
 * test actually depends on, and REFUSES the parts it must never touch. The
 * substrate's `resolveBoundedFor` throws, because a kernel that resolves a
 * board has stopped being a kernel; the candidate generator throws for the
 * same reason.
 *
 * The clock is fake and injected, so nothing here is wall-clock flaky: a
 * "contention spike" is a scripted number of milliseconds, reproducible on any
 * machine and under any load.
 */

import type {
  Assumption,
  Bound,
  Candidate,
  CandidateGenerator,
  CandidateSet,
  Evaluator,
  JointPlan,
  LedgerEntry,
  PinSet,
  PlanScore,
  ScoreBounds,
  SearchContext,
  SearchCore,
  Substrate,
  UnitId,
  Witness,
} from "../lobster/contracts"
import type { Resolution, StateHandle } from "../partial-engine/index"
import { planKey, type Lever, type LeverView, type Refiner } from "../lobster/voc"

// ------------------------------------------------------------------- clock

export class FakeClock {
  private t: number
  constructor(start = 1_000) {
    this.t = start
  }
  /** Bound on purpose: it is passed as a bare function into the kernel. */
  readonly now = (): number => this.t
  advance(ms: number): void {
    this.t += ms
  }
  get value(): number {
    return this.t
  }
}

// -------------------------------------------------------------- constructors

export function cand(unitId: number, to: number, path?: ReadonlyArray<number>): Candidate {
  // `from: -1` (NO_ORDER_MOVE): these are abstract plan tokens, not board
  // moves — nothing in the kernel suites gates on a candidate's origin cell.
  return { unitId, from: -1, to, path: path ?? [to] }
}

export function plan(...entries: ReadonlyArray<readonly [number, number]>): JointPlan {
  const m = new Map<UnitId, Candidate>()
  for (const [unitId, to] of entries) m.set(unitId, cand(unitId, to))
  return m
}

export function ledgerEntry(
  unitId: number,
  polarity: LedgerEntry["polarity"] = "if_present",
  cell = 0,
): LedgerEntry {
  return { unitId, cell, subStep: 0, polarity, note: "stub" }
}

export function bounds(
  worst: number,
  best: number,
  opts: {
    ledger?: ReadonlyArray<LedgerEntry>
    assumptions?: ReadonlyArray<Assumption>
  } = {},
): ScoreBounds {
  const ledger = opts.ledger ?? []
  const assumptions = opts.assumptions ?? []
  return {
    worst,
    best,
    ledger,
    assumptions,
    exact: ledger.length === 0 && assumptions.length === 0,
  }
}

export function score(
  p: JointPlan,
  worst: number,
  best: number,
  opts: {
    ledger?: ReadonlyArray<LedgerEntry>
    assumptions?: ReadonlyArray<Assumption>
    witnesses?: ReadonlyArray<Witness>
  } = {},
): PlanScore {
  return {
    plan: p,
    bounds: bounds(worst, best, opts),
    witnesses: opts.witnesses ?? [],
  }
}

export function witness(note: string, replies: ReadonlyArray<readonly [number, number]>): Witness {
  const m = new Map<UnitId, Candidate>()
  for (const [unitId, to] of replies) m.set(unitId, cand(unitId, to))
  return { replies: m, note }
}

// ----------------------------------------------------------------- substrate

export class StubSubstrate implements Substrate {
  readonly state = {} as StateHandle
  resolveCalls = 0
  entangledCalls = 0

  constructor(
    private readonly influence: ReadonlyMap<UnitId, ReadonlySet<number>> = new Map(),
    /** Destinations `pathOf` treats as reachable, per unit. Empty map =
     * everything is reachable (the stub cannot judge, and refuses nothing —
     * the same posture the kernel takes toward an unanswerable substrate). */
    private readonly reachable: ReadonlyMap<UnitId, ReadonlySet<number>> = new Map(),
  ) {}

  resolveBoundedFor(_plan: JointPlan, _asTeam: number): never {
    this.resolveCalls++
    throw new Error("StubSubstrate: the kernel must never resolve a board")
  }

  releaseResolution(_resolution: Resolution): void {
    /* nothing is ever resolved here */
  }

  withResolution<T>(_plan: JointPlan, _asTeam: number, _fn: (r: never) => T): never {
    this.resolveCalls++
    throw new Error("StubSubstrate: the kernel must never resolve a board")
  }

  unitIds(): ReadonlyArray<UnitId> {
    return []
  }

  commandable(_asTeam: number): ReadonlyArray<UnitId> {
    return []
  }

  actionsOf(_unitId: UnitId): never {
    throw new Error("StubSubstrate: the kernel must never enumerate a grammar")
  }

  pathOf(unitId: UnitId, to: number): ReadonlyArray<number> | null {
    const allowed = this.reachable.get(unitId)
    if (allowed === undefined) return []
    return allowed.has(to) ? [] : null
  }

  withModelled(_modelled: ReadonlyArray<UnitId>): Substrate {
    return this
  }

  entangled(
    _cells: ReadonlyArray<{ cell: number; fromSubStep: number; toSubStep: number }>,
  ): ReadonlyArray<UnitId> {
    this.entangledCalls++
    return []
  }

  influenceOf(unitId: UnitId): ReadonlySet<number> {
    return this.influence.get(unitId) ?? new Set<number>()
  }

  outstanding(): number {
    return 0
  }

  release(): void {
    /* no slab to return */
  }
}

export class StubGenerator implements CandidateGenerator {
  candidatesFor(_sub: Substrate, _unitId: UnitId): CandidateSet {
    throw new Error("StubGenerator: the kernel must never generate candidates")
  }
}

export class StubEvaluator implements Evaluator {
  calls = 0
  readonly seen: string[] = []

  constructor(private readonly of: (p: JointPlan) => Bound = () => ({ lo: 0, est: 0, hi: 0 })) {}

  scorePlan(_sub: Substrate, p: JointPlan, _asTeam: number): Bound {
    this.calls++
    this.seen.push(planKey(p))
    return this.of(p)
  }

  evaluatePlan(sub: Substrate, p: JointPlan, asTeam: number): import("../lobster/contracts").PlanEvaluation {
    const bound = this.scorePlan(sub, p, asTeam)
    return { bound, parts: {}, exact: bound.lo === bound.hi, basis: [], ledgerSize: 0 }
  }
}

// ------------------------------------------------------------- scripted core

export interface ScriptStep {
  readonly plan: JointPlan
  readonly worst: number
  readonly best: number
  /** Milliseconds this slice charges to the fake clock. A spike is a big number. */
  readonly costMs: number
  readonly ledger?: ReadonlyArray<LedgerEntry>
  readonly assumptions?: ReadonlyArray<Assumption>
  readonly witnesses?: ReadonlyArray<Witness>
}

export interface CallSnapshot {
  readonly pins: PinSet
  readonly incumbentLo: number | null
  readonly incumbentKey: string | null
  readonly witnesses: number
  readonly at: number
  readonly remainingMs: number
}

/**
 * A SearchCore whose `improve()` yields a deterministic sequence of
 * PlanScores, charging a scripted cost to the fake clock on each call. When
 * the script runs out the last step repeats, so a long budget degrades into
 * "nothing new to say" rather than into an exception.
 */
export class ScriptedSearchCore implements SearchCore {
  cursor = 0
  readonly improveLog: CallSnapshot[] = []
  readonly conformLog: CallSnapshot[] = []
  /** Interleaved call order, so "conformed BEFORE it resumed" is checkable. */
  readonly callOrder: Array<"improve" | "conform"> = []

  constructor(
    private readonly clock: FakeClock,
    private readonly script: ReadonlyArray<ScriptStep>,
    private readonly opts: {
      readonly conformCostMs?: number
      readonly baseline?: JointPlan
    } = {},
  ) {}

  reset(): void {
    this.cursor = 0
  }

  improve(ctx: SearchContext): PlanScore {
    this.improveLog.push(snapshot(ctx, this.clock))
    this.callOrder.push("improve")
    const i = Math.min(this.cursor, this.script.length - 1)
    const step = this.script[i]
    this.cursor++
    this.clock.advance(step.costMs)
    // "the best CONFORMING score": a real core never returns a plan that
    // contradicts the pins, so neither does the stub.
    const out = new Map<UnitId, Candidate>(step.plan)
    for (const pin of ctx.pins) out.set(pin.unitId, cand(pin.unitId, pin.to))
    return score(out, step.worst, step.best, {
      ledger: step.ledger,
      assumptions: step.assumptions,
      witnesses: step.witnesses,
    })
  }

  /** Splice the pins into the incumbent and repair completeness. No search. */
  conform(ctx: SearchContext, incumbent: JointPlan): JointPlan {
    this.conformLog.push(snapshot(ctx, this.clock))
    this.callOrder.push("conform")
    this.clock.advance(this.opts.conformCostMs ?? 0.05)
    const out = new Map<UnitId, Candidate>(this.opts.baseline ?? new Map())
    for (const [unitId, c] of incumbent) out.set(unitId, c)
    for (const pin of ctx.pins) out.set(pin.unitId, cand(pin.unitId, pin.to))
    return out
  }
}

/** The same core plus the proposed lever surface, so the lever order binds. */
export class ScriptedRefinerCore extends ScriptedSearchCore implements Refiner {
  readonly leverLog: Lever[] = []

  constructor(
    clock: FakeClock,
    script: ReadonlyArray<ScriptStep>,
    private readonly viewOf: (call: number) => LeverView,
    opts: { readonly conformCostMs?: number; readonly baseline?: JointPlan } = {},
  ) {
    super(clock, script, opts)
  }

  refinementView(_ctx: SearchContext): LeverView {
    return this.viewOf(this.cursor)
  }

  refine(ctx: SearchContext, lever: Lever): PlanScore {
    this.leverLog.push(lever)
    return this.improve(ctx)
  }
}

function snapshot(ctx: SearchContext, clock: FakeClock): CallSnapshot {
  return {
    pins: ctx.pins.slice(),
    incumbentLo: ctx.incumbent === null ? null : ctx.incumbent.bounds.worst,
    incumbentKey: ctx.incumbent === null ? null : planKey(ctx.incumbent.plan),
    witnesses: ctx.witnesses.length,
    at: clock.value,
    remainingMs: ctx.budget.remainingMs(),
  }
}

// ------------------------------------------------------------------ drivers

/** Drain a kernel decision into an array, optionally poking it between records. */
export async function collect(
  stream: AsyncIterable<import("../lobster/contracts").EmitRecord>,
  between?: (rec: import("../lobster/contracts").EmitRecord, i: number) => void,
): Promise<Array<import("../lobster/contracts").EmitRecord>> {
  const out: Array<import("../lobster/contracts").EmitRecord> = []
  let i = 0
  for await (const rec of stream) {
    out.push(rec)
    between?.(rec, i++)
  }
  return out
}
