/**
 * LOBSTER cross-module contracts.
 *
 * The build's parallel modules (substrate/candidates/evaluate, bounds/search,
 * voc/kernel/postures, pins) depend on each other ONLY through this file plus
 * ../partial-engine/index. Amendments go through the integrator, never by a
 * module silently redefining a shape. Derived from the synthesis architecture
 * (scratchpad/synthesis-architect-report.md §B) and the deliberation delta;
 * amended once, coherently, at integration from the three builders' proposals
 * (B1 A1–A5, B2 A1–A7, B3's refiner + clock amendments).
 *
 * ── ONE INTERVAL, THREE DIALECTS ───────────────────────────────────────────
 *
 * Three interval types cross this file's seams, and they are three enrichment
 * stages of the SAME quantity, with `worst ≡ lo` and `best ≡ hi` everywhere:
 *
 *   engine ScoreBounds   {worst, best, gapBy, assumptions: AssumptionId[]}
 *                        the raw subject-frame fold the resolver computes, its
 *                        basis a list of NUMERIC engine assumption ids. Never
 *                        renamed — the engine is vendored.
 *   Bound                {lo, est, hi} — the evaluator's triple. lo = worst,
 *                        hi = best, plus the advisory `est` ordering channel
 *                        that exists nowhere below this layer.
 *   ScoreBounds (here)   {worst, best, ledger, assumptions, exact} — the bound
 *                        bank's pair, provenance-enriched: the same two ends
 *                        with a STRUCTURED ledger and named assumptions so
 *                        basis identity and the discharge theorem are typed.
 *
 * The mapping is total and direction-free: engine.worst → Bound.lo →
 * ScoreBounds.worst, engine.best → Bound.hi → ScoreBounds.best. `est` is
 * dropped, never translated, on the way down — it must never gate a decision
 * lo/hi make. No fourth vocabulary may be introduced.
 */

import type {
  Board as EngineBoard,
  Resolution,
  ScoreBounds as EngineScoreBounds,
  StateHandle,
} from "../partial-engine/index"

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

/**
 * The explicit "no order" destination for `Candidate.to`: the KIND's own
 * default action — a rule of the game, not a guess about an agent. Pinned by
 * test to equal the engine's own NO_ORDER sentinel. A default is a NARROWING
 * and must be named (non-negotiable 4): naming a unit with NO_ORDER_MOVE and
 * omitting it from a JointPlan are DIFFERENT statements — the omitted unit
 * becomes a held claim with its own observation turn.
 */
export const NO_ORDER_MOVE: CellIndex = -1

// ------------------------------------------------------------------- pruning

/** A move a unit could stage: destination plus the full path (prefix matters —
 * capture-stops and exhaustion halt mid-ray). */
export interface Candidate {
  readonly unitId: UnitId
  /** The cell the unit starts from. `to` is the staged ORDER, not occupancy —
   * a rotate's `to` is whichever destination encodes the turn — so `from` is
   * the only cell a path-less candidate can be gated on. */
  readonly from: CellIndex
  /** A cell index, or NO_ORDER_MOVE for the KIND's own default action. See
   * the sentinel's own doc for why omission from a plan is different. */
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
  /** Distinct legal ACTIONS as the engine's own enumerator counts them: two
   * staged cells with the same canonical effect are one option, and the
   * engine proves that rather than this layer asserting it. */
  readonly legalCount: number
}

// ---------------------------------------------------------- score accounting

/** Why a bound is not exact. `if_present` entries explain a depressed lo
 * (feared presence); `if_absent` entries explain an inflated hi.
 * Entries MUST name the responsible held unit: vacuity cause-tagging and the
 * pin-context cache's invalidation-on-catch-up both key on `unitId`, and an
 * empty ledger under fog silently reads as SIGHTED. */
export interface LedgerEntry {
  readonly unitId: UnitId
  readonly cell: CellIndex
  readonly subStep: SubStep
  readonly polarity: "if_present" | "if_absent"
  readonly note: string
}

/** Named assumptions ride every score; scores with different assumption bases
 * refuse comparison (basis identity). Operator pins are assumptions.
 * A `reference-action` with `to: NO_ORDER_MOVE` fixes a unit that is not ours
 * to command to its KIND's own default — the declared form of the held-
 * capacity modelling choice (MAX_FROZEN overflow names its nearest units). */
export type Assumption =
  | { readonly kind: "reference-action"; readonly unitId: UnitId; readonly to: CellIndex }
  | { readonly kind: "operator-pin"; readonly unitId: UnitId; readonly to: CellIndex }
  | { readonly kind: "narrowing"; readonly unitId: UnitId; readonly note: string }
  | { readonly kind: "posture"; readonly posture: Posture }

export interface ScoreBounds {
  readonly worst: number // sound lower bound on the true score (≡ Bound.lo)
  readonly best: number // sound upper bound (≡ Bound.hi)
  readonly ledger: ReadonlyArray<LedgerEntry>
  readonly assumptions: ReadonlyArray<Assumption>
  /** exact ⟺ ledger empty ∧ assumptions empty (discharge theorem). NOTE: as
   * pinned, a PINNED decision can never report exact even when its restricted
   * game is fully resolved — consumers wanting "nothing left to learn" as a
   * stop condition should test `ledger.length === 0`, not `exact`. */
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

/**
 * Proved price of an operator pin, offered as advice; never auto-applied.
 *
 * THE TWO COSTS ARE ONE CHANNEL EACH, and they are never mixed. `costLo` is
 * the FLOOR channel's delta and `costHi` is the CEILING channel's; a `min`/
 * `max` across the pair would let the ceiling's delta be published as the
 * floor's, which is the one comparison this field's name promises not to make.
 * Both are clamped at zero: a pin that HELPS is free, not negative.
 *
 * Both deltas difference an incumbent's bracket against a speculative
 * context's, so both are subject to basis identity (non-negotiable 5): the
 * consumer that computes them must prove the two sides share a posture and a
 * constraint epoch, or mark the advice degraded and say so.
 */
export interface PinAdvice {
  readonly pin: Pin
  /** floor(best unconstrained) − floor(best conforming); ≥ 0. lo vs lo. */
  readonly costLo: number
  /** ceiling(best unconstrained) − ceiling(best conforming); ≥ 0. hi vs hi. */
  readonly costHi: number
  readonly witness: Witness | null // the concrete punishing line, when known
  readonly alternative: Candidate | null
}

// ------------------------------------------------------------------ postures

export type Posture = "SIGHTED" | "FOGGED-DISCRIMINATING" | "FOGGED-VACUOUS"

/**
 * Why a candidate's floor sits on the cliff (postures.ts derives it from the
 * bracket plus ledger polarity — see `detectVacuity`).
 *
 *   alive                 lo is above the cliff; nothing to explain.
 *   material-dead         dead in the optimistic reading too, or with nothing
 *                         in the pessimistic ledger to blame. A VERDICT.
 *   cloud-contingent-dead lo is DEAD only because feared presences were read
 *                         at their worst; hi survives. A DEMAND on the
 *                         refiner, never a verdict.
 */
export type VacuityCause = "alive" | "material-dead" | "cloud-contingent-dead"

// ------------------------------------------------------------------ emission

export type CrossfadeVerdict =
  /** The changed units cannot influence any cell an unchanged one can. */
  | "independent"
  /** Every interleaving the wire can produce was priced and passed. */
  | "certified"
  /** No certificate was available (no teammate floor, or no chunk partition):
   * the write passed on an adjacent-revision comparison only. */
  | "uncertified"
  /** A FORCED write (rung 0, or the conformance re-stage an operator is
   * waiting on) whose certificate would have refused. Forced paths are never
   * starved — humans always win — so the record ships and says so here. */
  | "forced-uncertified"
  /** The gate is off. */
  | "off"

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
  /** What the crossfade gate could prove about THIS write. */
  readonly crossfade: CrossfadeVerdict
}

// -------------------------------------------------------- refinement levers

/** How refined one uncontrolled unit's claim currently is. */
export type RefinementRung = "free" | "narrowed" | "advanced"

export type Lever =
  | { readonly kind: "catchup"; readonly unit: UnitId }
  | { readonly kind: "narrow"; readonly unit: UnitId }
  | { readonly kind: "advance"; readonly unit: UnitId }
  | { readonly kind: "deepen"; readonly planKey: string; readonly reason: "preview" | "ration" }
  | { readonly kind: "stop" }

/** One uncontrolled unit as the VOC orchestrator sees it. */
export interface HeldUnitView {
  readonly unitId: UnitId
  readonly rung: RefinementRung
  /** currentTurn − observedTurn; this turn's unmade choice not counted. */
  readonly staleness: number
  readonly cloudSize: number
  /** Meeting time with our staged paths; Infinity when it cannot contact us. */
  readonly meet: number
  /** Can this unit be refined at all (false = stale-unrefinable)? */
  readonly refinable: boolean
}

/** What the sticky stager compares. One row per root candidate. */
export interface StagingCandidate {
  readonly key: string
  readonly lo: number
  readonly est: number
  readonly hi: number
  /** Horizon this candidate's value was proved at. */
  readonly horizon: number
  readonly vacuity: VacuityCause
}

export interface CandidateView extends StagingCandidate {
  /** The joint plan this row scores. Carried so the stager's choice of a RIVAL
   * row is stageable: a leader the kernel cannot map back to a plan is a
   * silently dropped emission. */
  readonly plan: JointPlan
  readonly loCite: ReadonlySet<UnitId>
  readonly hiCite: ReadonlySet<UnitId>
  readonly refuted: boolean
}

/** Everything a lever choice may read. */
export interface LeverView {
  readonly candidates: ReadonlyArray<CandidateView>
  readonly leaderIdx: number
  readonly slack: number
  readonly horizon: number
  readonly depthMax: number
  readonly units: ReadonlyArray<HeldUnitView>
  readonly interiorCells: number
  /** Stability threshold floor for the horizon ration. */
  readonly epsilon: number
  readonly round: number
}

// ------------------------------------------------------- module interfaces

/**
 * What one bounded resolution produces. The engine computes all of it in one
 * pass; recomputing any part above the substrate would be a second scoring
 * pipeline, which the single-pipeline rule forbids.
 */
export interface BoundedResolution {
  /** The engine's resolution. Its `state` is a BORROWED slab — see the slab
   * contract on `Substrate`. */
  readonly resolution: Resolution
  /** Per-team [worst, best] in the subject's frame. */
  readonly perTeam: ReadonlyMap<number, { readonly worst: number; readonly best: number }>
  /** Subject-frame material bounds, with the field's assumptions as basis. */
  readonly bounds: EngineScoreBounds
  /** Every cell a MOVER occupied or entered this turn, snapshotted — the
   * ceiling widening a held unit's claim layer cannot compute for itself. */
  readonly touched: EngineBoard
}

/** B1 owns: engine substrate. One place translates wire state to engine state
 * (weight stacks!), names every live unit on every resolve (silence is a typed
 * refusal upstream — NO_ORDER_MOVE is an explicit statement), and exposes
 * claims.
 *
 * THE SLAB CONTRACT. `resolveBoundedFor`'s resolution OWNS an arena slab.
 * Hand it to `releaseResolution` (idempotent), or use `withResolution`, which
 * cannot forget. `release()` reclaims anything a caller forgot. The invariant
 * a test asserts: `outstanding() === 1` (the base state) between decisions,
 * `0` after `release()`. A SearchCore that ignores this exhausts the arena
 * inside one sweep, and it looks like the engine being slow.
 *
 * THE PLAN-DOMAIN RULE. The plan's domain IS the modelled set: everything not
 * named in a JointPlan is held with its own observation turn, so the engine's
 * partial-assignment refusal is unreachable by construction. `withModelled`
 * returns a sibling over the SAME position in which every unit in `modelled`
 * is expected LIVE — a plan must name it, and may name it with an explicit
 * action. The sibling's `release()` must not disturb the parent; a substrate
 * whose plan domain already is the modelled set may return a shared-state
 * sibling. */
export interface Substrate {
  readonly state: StateHandle
  /** Every live unit, ascending. */
  unitIds(): ReadonlyArray<UnitId>
  /** Live units on `asTeam` this decision is entitled to move. */
  commandable(asTeam: number): ReadonlyArray<UnitId>
  resolveBoundedFor(plan: JointPlan, asTeam: number): BoundedResolution
  /** Return a resolution's slab. Idempotent. */
  releaseResolution(resolution: Resolution): void
  /** The scoped, leak-proof door most callers should use instead. */
  withResolution<T>(plan: JointPlan, asTeam: number, fn: (r: BoundedResolution) => T): T
  /** Every distinct action this unit's own grammar admits. */
  actionsOf(unitId: UnitId): ReadonlyArray<Candidate>
  /** The cells a staged destination enters, or null when it is not legal. */
  pathOf(unitId: UnitId, to: CellIndex): ReadonlyArray<CellIndex> | null
  /** A sibling substrate expecting `modelled` live — see the plan-domain rule. */
  withModelled(modelled: ReadonlyArray<UnitId>): Substrate
  /** Units whose claims intersect these path cells in sub-step time. A cell
   * merely passed through has `fromSubStep === toSubStep === its path index`;
   * a cell come to rest on takes `toSubStep: Number.MAX_SAFE_INTEGER`, because
   * a rested unit stands there for the rest of the turn and meets everything.
   * Callers that under-state the window under-report entanglement. */
  entangled(
    cells: ReadonlyArray<{ cell: CellIndex; fromSubStep: SubStep; toSubStep: SubStep }>
  ): ReadonlyArray<UnitId>
  /** Interaction footprint: cells a unit's current options can influence this
   * turn — powers tier-2 transfer between pin contexts. Over-approximate is
   * safe (work repeated); under-approximate keeps stale evaluations. */
  influenceOf(unitId: UnitId): ReadonlySet<CellIndex>
  /** Slabs borrowed and not yet returned (the base state included). */
  outstanding(): number
  release(): void
}

/** B1 owns: candidate generation (bot-pieces port). */
export interface CandidateGenerator {
  /** `purpose: "adversary"` MUST return the complete legal option list.
   * Pruning an enemy's replies is a WHICH-truncation, and it is the bank —
   * not the generator — that is allowed to declare one. Default: "ours". */
  candidatesFor(sub: Substrate, unitId: UnitId, purpose?: "ours" | "adversary"): CandidateSet
}

/** Everything one evaluation produces, not just the triple. */
export interface PlanEvaluation {
  readonly bound: Bound
  /** Per-feature contributions, before weighting. */
  readonly parts: Readonly<Record<string, Bound>>
  /** exact ⟺ collapsed interval ∧ empty ledger ∧ empty basis. */
  readonly exact: boolean
  /** Unit ids whose caller-declared narrowings this value is conditional on. */
  readonly basis: ReadonlyArray<UnitId>
  readonly ledgerSize: number
}

/** B1 owns: evaluation (triple library). Must be monotone/separable per unit;
 * DEAD is a lattice bottom (−∞), never a scalar on the heuristic scale. The
 * evaluate module exports the canonical DEAD; postures.ts defaults its cliff
 * to the same value — the agreement is pinned by test. */
export interface Evaluator {
  scorePlan(sub: Substrate, plan: JointPlan, asTeam: number): Bound
  /** The same evaluation with discharge status — exactness, basis, ledger
   * size — so the bound bank never needs a second call to learn them. */
  evaluatePlan(sub: Substrate, plan: JointPlan, asTeam: number): PlanEvaluation
}

/** B2 owns: the bound bank + joint search. floorOf may be served by any mix of
 * B0 (hold-everything) / B1 (per-enemy enumeration) / B2 (witnesses) /
 * B3 (full product) — every min-side restriction is a declared assumption.
 *
 * GUARANTEES the kernel rides on (each pinned by an integration test):
 *  - `conform(ctx, ∅)` returns a COMPLETE legal joint plan — it is rung 0,
 *    the only source of a first staged set;
 *  - `conform` is cheap and never searches (its cost tracks how much the pin
 *    disturbed, not the roster);
 *  - `improve` returns pin-conforming plans, honors budget.shouldStop()
 *    within the slice, and RESUMES from ctx.incumbent + ctx.witnesses rather
 *    than restarting;
 *  - bounds obey the refinement lattice within an epoch (the kernel refuses
 *    and counts a retraction, never clamps). */
export interface SearchCore {
  /** Improve the incumbent under the pins; returns the best conforming score
   * found so far. Must keep a complete legal JointPlan at every instant. */
  improve(ctx: SearchContext): PlanScore
  /** Splice pins into a plan and repair legality/coherence — the epoch-change
   * conformance path; must be cheap (no full search). */
  conform(ctx: SearchContext, incumbent: JointPlan): JointPlan
  /** Optional: the refinement view VOC orders levers over. Without it the
   * kernel reports a degraded slack and `leverOrderBinding: false`. */
  refinementView?(ctx: SearchContext): LeverView
  /** Optional: apply one lever. Catch-up invalidates the pin-context cache. */
  refine?(ctx: SearchContext, lever: Lever): PlanScore
}

export interface SearchContext {
  readonly sub: Substrate
  readonly gen: CandidateGenerator
  readonly evaluate: Evaluator
  readonly asTeam: number
  readonly pins: PinSet
  /** Assumptions the whole decision rides on — reference actions for units
   * not ours to command (held-capacity modelling included) and the posture.
   * Derived from the CONTEXT, never from a plan, which is what makes two
   * plans priced here comparable. */
  readonly assumptions: ReadonlyArray<Assumption>
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

/** B3 owns: the kernel loop. Ratchet is PER (epoch, posture) basis: an emitted
 * plan only ever replaces the staged one within a basis if its leading-channel
 * value is provably ≥; epoch changes re-stage a conforming plan immediately,
 * then search resumes. */
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
  /** The decision's standing basis: reference actions for units not ours to
   * command and every held-capacity modelling narrowing. Threaded into every
   * SearchContext.assumptions this decision creates. */
  readonly assumptions?: ReadonlyArray<Assumption>
  /** Clock injection point. Defaults to a monotonic timer. Tests pass a fake
   * clock so the anytime suite is deterministic. */
  readonly now?: () => number
  /** Carried across turns: the previous turn's measured slice cost. The FIRST
   * slice of a turn is otherwise unmeasured, and at the bottom of the ladder
   * that one slice is the whole budget. Never module state. */
  readonly initialStepCostMs?: number
  /**
   * "This turn is over — stop." Asked once per slice boundary.
   *
   * A turn can resolve the instant every alive player commits (T1 fact 5), and
   * the server then discards every later write for it. Without this the
   * decision searches on to its own deadline for a board that no longer
   * exists, spending the budget the NEXT turn needs and putting documents on
   * the wire the resolution transaction will read and throw away. On abandon
   * the kernel stops at the next slice boundary and emits nothing further —
   * not even the final flush.
   */
  readonly abandoned?: () => boolean
}
