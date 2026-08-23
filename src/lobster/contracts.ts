/**
 * LOBSTER cross-module contracts.
 *
 * The build's parallel modules (substrate/candidates/evaluate, bounds/search,
 * voc/kernel/postures, pins) depend on each other ONLY through this file plus
 * ../partial-engine/index. Amendments go through the integrator, never by a
 * module silently redefining a shape. Derived from the synthesis architecture
 * (scratchpad/synthesis-architect-report.md §B) and the deliberation delta.
 */

import type { Resolution, StateHandle } from "../partial-engine/index"

// ---------------------------------------------------------------- primitives

export type Trit = "yes" | "maybe" | "no"

/** Evaluation triple. `est` is advisory ordering only — it must never gate a
 * decision that lo/hi make (contract non-negotiable: est never adjudicates). */
export interface Bound {
  readonly lo: number
  readonly est: number
  readonly hi: number
}

export type UnitId = number
export type CellIndex = number
export type SubStep = number
export type Turn = number

// ------------------------------------------------------------------- pruning

/** A move a unit could stage: destination plus the full path (prefix matters —
 * capture-stops and exhaustion halt mid-ray). */
export interface Candidate {
  readonly unitId: UnitId
  readonly to: CellIndex
  readonly path: ReadonlyArray<CellIndex>
}

/** Completeness invariant: every legal staged move for the unit is either in
 * `candidates` or accounted for in `prunedLedger` with the prune that removed
 * it. Property-tested; a hard filter must never empty the option set. */
export interface CandidateSet {
  readonly unitId: UnitId
  readonly candidates: ReadonlyArray<Candidate> // ordered best-first, never filtered on the anytime path
  readonly prunedLedger: ReadonlyArray<{ candidate: Candidate; prune: string; exact: boolean }>
  readonly legalCount: number
}

// ---------------------------------------------------------- score accounting

/** Why a bound is not exact. `if_present` entries explain a depressed lo
 * (feared presence); `if_absent` entries explain an inflated hi. */
export interface LedgerEntry {
  readonly unitId: UnitId
  readonly cell: CellIndex
  readonly subStep: SubStep
  readonly polarity: "if_present" | "if_absent"
  readonly note: string
}

/** Named assumptions ride every score; scores with different assumption bases
 * refuse comparison (basis identity). Operator pins are assumptions. */
export type Assumption =
  | { readonly kind: "reference-action"; readonly unitId: UnitId; readonly to: CellIndex }
  | { readonly kind: "operator-pin"; readonly unitId: UnitId; readonly to: CellIndex }
  | { readonly kind: "narrowing"; readonly unitId: UnitId; readonly note: string }
  | { readonly kind: "posture"; readonly posture: Posture }

export interface ScoreBounds {
  readonly worst: number // sound lower bound on the true score
  readonly best: number // sound upper bound
  readonly ledger: ReadonlyArray<LedgerEntry>
  readonly assumptions: ReadonlyArray<Assumption>
  /** exact ⟺ ledger empty ∧ assumptions empty (discharge theorem). */
  readonly exact: boolean
}

/** A concrete enemy joint reply found to punish some plan. Sound upper-bound
 * certificate; survives restarts and pin-context switches. */
export interface Witness {
  readonly replies: ReadonlyMap<UnitId, Candidate>
  readonly note: string
}

// ------------------------------------------------------------------ planning

/** A complete legal joint assignment for every unit this decision stages.
 * The search holds one of these at all times (staged-set completeness). */
export type JointPlan = ReadonlyMap<UnitId, Candidate>

export interface PlanScore {
  readonly plan: JointPlan
  readonly bounds: ScoreBounds
  readonly witnesses: ReadonlyArray<Witness>
}

// ---------------------------------------------------------------- pins/epochs

export interface Pin {
  readonly unitId: UnitId
  readonly to: CellIndex
  /** tentative = UI hover/consideration; searched speculatively, never binding. */
  readonly tentative: boolean
}

/** Canonical pin context: committed pins only, sorted by unitId. */
export type PinSet = ReadonlyArray<Pin>

export type PinEvent =
  | { readonly kind: "pin"; readonly pin: Pin }
  | { readonly kind: "unpin"; readonly unitId: UnitId }
  | { readonly kind: "commit"; readonly unitId: UnitId } // human Submit — permanent for the turn

/** Proved price of an operator pin, offered as advice; never auto-applied. */
export interface PinAdvice {
  readonly pin: Pin
  readonly costLo: number // floor(best unconstrained) − floor(best conforming); ≥ 0
  readonly costHi: number
  readonly witness: Witness | null // the concrete punishing line, when known
  readonly alternative: Candidate | null
}

// ------------------------------------------------------------------ postures

export type Posture = "SIGHTED" | "FOGGED-DISCRIMINATING" | "FOGGED-VACUOUS"

// ------------------------------------------------------------------ emission

export interface EmitRecord {
  readonly plan: JointPlan
  readonly lo: number
  readonly est: number
  readonly hi: number
  readonly horizon: number
  readonly slack: number
  readonly posture: Posture
  readonly assumptions: ReadonlyArray<Assumption>
  readonly epoch: number
}

// ------------------------------------------------------- module interfaces

/** B1 owns: engine substrate. One place translates wire state to engine state
 * (weight stacks!), names every live unit on every resolve (silence is a typed
 * refusal upstream — NO_ORDER is an explicit statement), and exposes claims. */
export interface Substrate {
  readonly state: StateHandle
  resolveBoundedFor(plan: JointPlan, asTeam: number): Resolution
  /** Units whose claims intersect these path cells in sub-step time. */
  entangled(cells: ReadonlyArray<{ cell: CellIndex; subStep: SubStep }>): ReadonlyArray<UnitId>
  /** Interaction footprint: cells a unit's current options can influence this
   * turn — powers tier-2 transfer between pin contexts. */
  influenceOf(unitId: UnitId): ReadonlySet<CellIndex>
  release(): void
}

/** B1 owns: candidate generation (bot-pieces port). */
export interface CandidateGenerator {
  candidatesFor(sub: Substrate, unitId: UnitId): CandidateSet
}

/** B1 owns: evaluation (triple library). Must be monotone/separable per unit;
 * DEAD is a lattice bottom, never a scalar on the heuristic scale. */
export interface Evaluator {
  scorePlan(sub: Substrate, plan: JointPlan, asTeam: number): Bound
}

/** B2 owns: the bound bank + joint search. floorOf may be served by any mix of
 * B0 (hold-everything) / B1 (per-enemy enumeration) / B2 (witnesses) /
 * B3 (full product) — every min-side restriction is a declared assumption. */
export interface SearchCore {
  /** Improve the incumbent under the pins; returns the best conforming score
   * found so far. Must keep a complete legal JointPlan at every instant and
   * honor budget.shouldStop(). */
  improve(ctx: SearchContext): PlanScore
  /** Splice pins into a plan and repair legality/coherence — the epoch-change
   * conformance path; must be cheap (no full search). */
  conform(ctx: SearchContext, incumbent: JointPlan): JointPlan
}

export interface SearchContext {
  readonly sub: Substrate
  readonly gen: CandidateGenerator
  readonly evaluate: Evaluator
  readonly asTeam: number
  readonly pins: PinSet
  readonly incumbent: PlanScore | null
  readonly witnesses: ReadonlyArray<Witness>
  readonly budget: BudgetHandle
}

/** B3 owns: clock + emission. All cost estimators are per-decision state —
 * never module scope (the arena latch bug class); guards floor at 0.2×budget. */
export interface BudgetHandle {
  remainingMs(): number
  elapsedMs(): number
  shouldStop(): boolean
  /** The one clock. Every consumer times itself against THIS, never against
   * `performance.now()` directly: the kernel injects it, so a test drives the
   * whole system from a fake clock and no suite is wall-clock flaky. Values
   * are on the same scale as `KernelInput.deadlineMs`. */
  now(): number
}

/** B3 owns: the kernel loop. Ratchet is PER EPOCH: an emitted plan only ever
 * replaces the staged one within an epoch if its lo is provably ≥; epoch
 * changes re-stage a conforming plan immediately, then search resumes. */
export interface Kernel {
  decide(input: KernelInput): AsyncIterable<EmitRecord>
  onPinEvent(ev: PinEvent): void
}

export interface KernelInput {
  readonly sub: Substrate
  readonly gen: CandidateGenerator
  readonly evaluate: Evaluator
  readonly search: SearchCore
  readonly asTeam: number
  /** Absolute stop time ON THE SAME CLOCK AS `now`. The wire's deadline is
   * wall-clock; convert it once at the seam (kernel.ts exports a helper). */
  readonly deadlineMs: number
  readonly initialPins: PinSet
  /** Clock injection point. Defaults to a monotonic timer. Tests pass a fake
   * clock so the anytime suite is deterministic. */
  readonly now?: () => number
  /** Carried across turns: the previous turn's measured slice cost. The FIRST
   * slice of a turn is otherwise unmeasured, and at the bottom of the ladder
   * that one slice is the whole budget. Never module state. */
  readonly initialStepCostMs?: number
}
