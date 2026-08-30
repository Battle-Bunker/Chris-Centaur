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
  Resolution,
  ScoreBounds as EngineScoreBounds,
  StateHandle,
} from "../partial-engine/index"

// ---------------------------------------------------------------- primitives

export type Trit = "yes" | "maybe" | "no"

// ------------------------------------------------------------------ identity

/**
 * A stable identity token for an arbitrary object, interned per process.
 *
 * Lives here because it is the seam's own machinery: the evaluate module needs
 * it to say what a criterion profile IS, and the bounds module needs it to say
 * what an evaluator is, and neither is allowed to import the other. It is the
 * conservative half of both answers — two distinct objects never collide, the
 * same object always matches.
 */
const identityTokens = new WeakMap<object, string>()
let nextIdentityToken = 0
export function objectIdentity(value: object): string {
  const hit = identityTokens.get(value)
  if (hit !== undefined) return hit
  const made = `#${++nextIdentityToken}`
  identityTokens.set(value, made)
  return made
}

/**
 * A canonical, order-free identity for a plain record of settings — a
 * criterion profile, a config object, anything whose CONTENT decides whether
 * two consumers of it are computing the same function.
 *
 * DELIBERATELY NOT A FIELD LIST. Anything that keys a cache on "which profile
 * is this" must keep working when the profile grows a field, because the
 * failure mode of forgetting to amend a hand-written key is a WRONG NUMBER
 * served at cache latency, not a slow one. So every own enumerable key is
 * walked in sorted order; primitives serialise; arrays and plain records
 * recurse; and anything else — a function, a class instance, a symbol — falls
 * back to `objectIdentity` rather than being dropped. Unrecognised is never
 * treated as absent.
 *
 * Not a hash and not stable across processes: it is an identity for caches
 * that live inside one decision, never a key that gets written down.
 */
export function structuralIdentity(value: unknown): string {
  if (value === null) return "null"
  switch (typeof value) {
    case "undefined":
      return "undef"
    case "number":
    case "boolean":
    case "bigint":
      return String(value)
    case "string":
      return JSON.stringify(value)
    case "symbol":
      return `sym${objectIdentity(Object(value) as object)}`
    case "function":
      return `fn${objectIdentity(value)}`
    default:
      break
  }
  const obj = value as object
  if (Array.isArray(obj)) return `[${obj.map(structuralIdentity).join(",")}]`
  const proto: unknown = Object.getPrototypeOf(obj)
  if (proto !== Object.prototype && proto !== null) return `obj${objectIdentity(obj)}`
  const record = obj as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${k}:${structuralIdentity(record[k])}`)
    .join(",")}}`
}

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
  /**
   * WHAT THE SET OF VERDICTS SAID ABOUT THE UNIT — the rung-0 fatality marks,
   * absent unless the classifier ran.
   *
   * `forced` collapses one dimension of the joint problem EXACTLY: the unit's
   * move is determined, so nothing above need spend a price on an alternative.
   * `sealed` is the unit dying whatever it does — a near-perfect one-turn
   * death oracle at zero marginal cost, and a WIDENING for everyone else,
   * because a corpse is a durable pile settled on weight where a living body
   * is settled on tier.
   *
   * `provenance` is not decoration. On the rules-only subset these are
   * theorems about frozen facts; with the ally arm in them they are policy,
   * and a consumer that treats a policy mark as a proof is the bug the field
   * exists to prevent. A silent restore hides a team-level fact, which is why
   * the mark is emitted rather than inferred from the ledger.
   */
  readonly marks?: {
    readonly forced: boolean
    readonly sealed: boolean
    readonly survivors: number
    readonly provenance: "rules-only" | "policy"
  }
  /**
   * THE RUNG-1/2 EDGE-EV PRIOR PER CANDIDATE, IN WEIGHT UNITS, positionally
   * aligned with `candidates` — absent unless the edge-EV pass ran.
   *
   * φ_u(a), the first order of the Möbius expansion around the incumbent: what
   * the cheap heuristics expect this option to be worth, denominated in the
   * material lattice itself, so a unit of weight `w` dying is exactly `−w` and
   * composing it with any other term in that currency is literally addition.
   *
   * ORDERING ONLY, and the placement law is why it can live on the set at all:
   * it is never on a `Bound`, a `ScoreBounds`, a `PlanScore` or an
   * `Assumption`, no consumer may fold it into `est`, and nothing that reads it
   * may remove a candidate. It is published because the generator already
   * computes it to sort by and a selection layer downstream cannot recompute it
   * — not because anything is licensed to adjudicate on it.
   *
   * Absent, not `undefined`-valued: a set built with the pass off must be
   * indistinguishable from the one the shipped build produced, and an own
   * property holding `undefined` is not.
   */
  readonly edgeEv?: ReadonlyArray<number>
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
 * THE PRICE IS AN INTERVAL, because both sides of the subtraction are. With
 * the unconstrained decision proved in [u.lo, u.hi] and the conforming one in
 * [c.lo, c.hi], the cost is proved in [u.lo − c.hi, u.hi − c.lo]: `costLo` is
 * the LEAST the pin can be costing, `costHi` the MOST, and the width is how
 * little the decision knows. Both clamped at zero: a pin that HELPS is free,
 * not negative. A `min`/`max` across the two same-channel deltas is NOT this —
 * it can publish the ceiling's delta as the floor's answer and brackets
 * nothing.
 *
 * Both deltas difference an incumbent's bracket against a speculative
 * context's, so both are subject to basis identity (non-negotiable 5): the
 * consumer that computes them must prove the two sides share a posture and a
 * constraint epoch, or mark the advice degraded and say so.
 */
export interface PinAdvice {
  readonly pin: Pin
  /** floor(best unconstrained) − ceiling(best conforming); ≥ 0. */
  readonly costLo: number
  /** ceiling(best unconstrained) − floor(best conforming); ≥ 0. */
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
  /** What the crossfade gate could prove about THIS write. Always present on
   * a record the kernel emitted; optional so a hand-built record (a harness,
   * a fixture) need not assert a verdict it never computed. */
  readonly crossfade?: CrossfadeVerdict
  /**
   * CL4 — THE SEEDED LOTTERY'S AUDIT FIELD. Absent unless the sampler ran.
   *
   * OPERATOR-SIDE, NEVER ON THE WIRE. The emission path out of this record is
   * `TeamDecisionEngine.forwardPlan`, which reads `rec.plan`, turns each
   * candidate into a `CentaurMove` and calls `setBotRecommendation(gameId,
   * snakeId, move, turnData)`. Nothing else on the record is forwarded, and the
   * only other consumer — `publishAdvice` → `adviseFromReport` — reads
   * `lo/hi/est/posture/epoch` for the operator's own pin advice. So an opponent
   * sees the MOVE and never the seed, which is the whole shape the ruling
   * asks for: unpredictable to an adversary, replayable by the harness.
   *
   * Optional so a hand-built record (a harness, a fixture) need not carry a
   * seed it never drew, and so a flag-off record is structurally identical to
   * the one that shipped.
   */
  readonly selection?: import("./selection").SelectionReport
  /**
   * CL6 — DOOR A'S THREAD ACCOUNTING. Absent unless the scout ran.
   *
   * OPERATOR-SIDE, NEVER ON THE WIRE, and the argument is `selection`'s
   * verbatim: the emission path out of this record is
   * `TeamDecisionEngine.forwardPlan`, which reads `rec.plan`, turns each
   * candidate into a `CentaurMove`, and forwards nothing else. So an opponent
   * sees the MOVE and never the depth.
   *
   * It is also the only place a depth number is allowed to appear on this
   * record. `lo`, `est` and `hi` are ROOT quantities under a `V¹` frame
   * (la-outside L1: depth is provenance, never denomination), and `horizon`
   * is the one-ply search's own. A thread's per-ply values live inside the
   * scout and reach this record only as COUNTS.
   */
  readonly scout?: import("./search/scout").ScoutReport
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
  /**
   * TURNS OF PLAY THIS ROW'S VALUE CARRIES, measured. 1 when nothing deeper
   * than this turn spoke about it; 2 when a deepened line rooted at this plan
   * published a value; and so on.
   *
   * It used to be a constant every row shared, which made the two sticky-stager
   * guards that read it (`leader.horizon >= incumbent.horizon`) vacuously true
   * for the life of the build. They bind now.
   */
  readonly horizon: number
  readonly vacuity: VacuityCause
  /**
   * THE BRANCH'S BELIEF — the density's mean and precision inside (or, once a
   * deeper reading has spoken, outside) the sound interval.
   *
   * Optional so a caller that builds a row by hand need not assemble one; the
   * stager reads it only where `horizon > 1` on some row, i.e. only where
   * depth actually spoke, and orders by `lo`/`est` exactly as before elsewhere.
   */
  readonly mu?: number
  readonly prec?: number
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
  /**
   * Optional: refusals the core ABSORBED rather than propagating, since the
   * last call. Drained by the kernel, which owns the counters.
   *
   * `conform(ctx, ∅)` is rung 0 and there is no fallback behind it: a throw
   * there is a decision with nothing staged. The core therefore keeps its
   * legal seed and swallows a bounds inversion — but a swallowed refusal that
   * nobody counts is exactly the silence this build has a rule against, so it
   * is reported here instead.
   */
  drainRefusals?(): { boundsInversions: number }
  /**
   * Optional: drop every live session and return every slab cached in one.
   *
   * A core is allowed to keep its candidate sets, its bound bank and the
   * bank's resolution memo alive BETWEEN calls — rebuilding them per slice
   * makes an anytime loop idle, because at production team sizes one
   * `price()` is most of a slice and the first one is always the seed the
   * previous slice already priced. What it may not do is keep them across a
   * decision, so the kernel calls this when one ends. Between calls the slab
   * count is therefore `1 + what the memo caches`, bounded by its capacity;
   * after this it is back to the substrate's own baseline.
   */
  release?(): void
  /**
   * Optional: what the cluster layer did on the live sessions, for measurement.
   *
   * TELEMETRY AND NOTHING ELSE. Nothing in the decision path reads it, it
   * carries no bound and no plan, and it is absent unless
   * `CENTAUR_CLUSTER_ENUM` (or a caller's own answer) turned the layer on.
   * A layer whose cost and coverage cannot be read off is a layer nobody can
   * promote, and every stage of this program has had to pay that bill later.
   */
  clusterReport?(): ClusterReport | null
  /**
   * Optional: the seeded lottery's own ledger, for replay and for measurement.
   *
   * Null unless `CENTAUR_SAMPLED_CAP` (or a caller's own answer) turned the
   * sampler on. It carries the DECISION SEED, which is what makes the owner's
   * ruling auditable: a run is replayed bit-for-bit by handing the same
   * `matchSeed` back to the engine on the same board. The kernel stamps it onto
   * `EmitRecord.selection`, which is an OPERATOR-SIDE field —
   * `TeamDecisionEngine.forwardPlan` sends a `CentaurMove` and a `GameState`
   * view to the wire and nothing else, so no part of this ever reaches an
   * opponent. See `lobster/selection/rng.ts` on why that matters.
   */
  selectionReport?(): import("./selection").SelectionReport | null
  /**
   * Optional: which slot of the acceptance comparator decided, over this core's
   * life. Telemetry, never behaviour, and present whatever the flags say.
   *
   * The instrument for law L17, "optimism never promotes". The comparator's
   * third slot is an unproved CEILING breaking a floor-and-est tie — the O-P1
   * hole that round-fusion Stage 3a's T0/T1/T2 tier ladder closes, and which is
   * NOT closed on this branch. A change that made that slot busier would be
   * quietly widening the hole, so the number is published and every stage that
   * touches ordering owes a before/after on it.
   */
  adjudicationReport?(): AdjudicationReport
  /**
   * Optional: CL6's thread accounting for the last session opened, or null
   * when the scout never ran.
   *
   * Threads run, depths reached, contacts, parks, expansions, findings and the
   * door's refusals by reason — so a scout that silently refused every board
   * (a potion premise it may not run under, a cluster extinct at the new root)
   * is legible as a refusal rather than as a zero.
   */
  scoutReport?(): import("./search/scout").ScoutReport | null
  /**
   * Optional: WHAT DEPTH FOUND AND WHAT IT DID WITH IT — the consulted depth
   * surface.
   *
   * This is the channel `KernelOptions.depthMax` and the `?? 1` horizon
   * fallback were standing in for, and it is deliberately not the refinement
   * seam: it carries no lever, no rung and no view. It carries the VALUES a
   * deepened line produced, keyed by the ply-1 plan they are about, so the
   * kernel can fold them into that branch's belief and report an honest
   * horizon instead of a constant.
   *
   * Null when this core opens no depth layer at all.
   */
  depthReport?(): DepthReport | null
  /**
   * Optional: what the MULTI-START SEED did on the last slice that ran one, or
   * null when the layer never ran.
   *
   * Stage 0's attempts and whether one came back conflict-free, stage 1's
   * samples, climbs, evaluations and pool sizes, the slice asked for against
   * the time spent, and the objective of the random baseline against the
   * objective of the plan actually selected. That last pair is the layer's own
   * falsifier: a selection that never beats its own random baseline is a
   * selection that bought nothing.
   *
   * It also carries the DECISION SEED, which is what makes a weighted-random
   * selection auditable at all — hand the same private `matchSeed` back on the
   * same board and the seeding reproduces bit for bit. Operator-side, like
   * `selectionReport`: it never reaches the wire.
   */
  multistartReport?(): import("./search/multistart-seed").MultiStartReport | null
}

/** Which slot of `better()` decided. See `SearchCore.adjudicationReport`. */
export interface AdjudicationReport {
  /**
   * THE BELIEF decided, among floor-undominated rivals, because a deepened
   * line had spoken about one of them. Zero on every board where depth
   * published nothing, and then the ladder below is the one that shipped.
   */
  readonly depthDecided: number
  /** The PROVED FLOOR decided. The only slot that is a proof. */
  readonly floorDecided: number
  /** `est` broke a floor tie. Ordering, never adjudication. */
  readonly estDecided: number
  /** The CEILING broke a floor-and-est tie — L17's "hi read count". */
  readonly ceilingDecided: number
  /** The salted plan key broke an exact three-way tie. */
  readonly tieKeyDecided: number
  /** A banked reply refuted the trial below the incumbent's proved floor. */
  readonly vetoed: number
  /** A basis mismatch: two plans that are not answers to the same question. */
  readonly refused: number
}

/**
 * WHAT A DEEPENED LINE IS WORTH, for the branch it started from.
 *
 * Three numbers and the plan they are about. Denominated in the same score
 * units as a ply-1 bank price, on a board `plies` turns of play ahead; `sigma`
 * is one standard deviation of the MODEL ERROR of the approximate simulation
 * that produced the value, so `1/sigma^2` is the precision it earned. Not a
 * bound, not a bound's endpoint, and not capped in either direction.
 */
export interface DepthNote {
  readonly plan: JointPlan
  readonly value: number
  readonly sigma: number
  readonly plies: number
}

/** The depth layer's per-decision accounting. See `SearchCore.depthReport`. */
export interface DepthReport {
  /**
   * TURNS OF PLAY ACTUALLY SIMULATED, max over lines. 1 means nothing deeper
   * than this turn ran. MEASURED — never a configured ceiling, and never the
   * fallback constant the kernel used to report as a horizon.
   */
  readonly plies: number
  /** Comparisons the belief decided that the floor ladder would not have. */
  readonly decided: number
  /**
   * Would this core have returned a DIFFERENT plan with the deep channel
   * silent? Maintained as a shadow incumbent under the legacy ladder over the
   * same trial stream, so it costs one comparison per trial and no pricing.
   *
   * APPROXIMATE IN ONE STATED WAY: without depth the trial SEQUENCE itself
   * would differ slightly, because the incumbent steers the sweep. What this
   * is exact about is the argmax under the legacy ladder over the candidate
   * stream this decision actually generated.
   */
  readonly changedPlan: boolean
  /** The values, one per ply-1 plan a line was rooted at. */
  readonly notes: ReadonlyArray<DepthNote>
}

/** The cluster layer's per-decision accounting. See `SearchCore.clusterReport`. */
export interface ClusterReport {
  /** Components of the non-slider interaction graph, after any merge. */
  readonly clusters: number
  /** Our live sliders — shared variables, one joint per branch. */
  readonly sliders: number
  /** Largest non-slider component on this board. */
  readonly maxComponent: number
  /** Joint-space size actually enumerated. */
  readonly jointsEnumerated: number
  /** Joint-space size before the FORCED/fatal domain shrink. */
  readonly jointsBeforeShrink: number
  /** Clusters that fell to rung 2 (threshold) and rung 5 (ICM). */
  readonly rungThreshold: number
  readonly rungIcm: number
  /** Did the terminal guard refuse independent composition? */
  readonly merged: boolean
  /** Composed joints produced, and how many the coordinator priced. */
  readonly proposals: number
  readonly proposalsPriced: number
  /**
   * Proposals the one-move filter declined to pay for: a plan within
   * `minHamming` of the incumbent is a plan the sweep is about to try anyway.
   */
  readonly proposalsNear: number
  /** Proposals the surrogate gate declined: they did not beat the incumbent. */
  readonly proposalsFlat: number
  /**
   * Composed joints whose Ṽ did not beat the ICM fixpoint's — exact inference
   * finding nothing coordinate ascent on the same surrogate would not.
   */
  readonly noExactGain: number
  /** Wall time the enumeration itself cost, in ms. */
  readonly enumMs: number
  /** Unit-sweeps the dirty set skipped, and the ones it let through. */
  readonly sweepsSkipped: number
  readonly sweepsRun: number
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
  /**
   * CL4 — the share of the DECISION's budget still unspent, in [0, 1], or
   * `undefined` when this handle does not model a decision-level clock.
   *
   * `remainingMs()` is the SLICE's remainder and is the wrong quantity for a
   * schedule that is supposed to cool as the TURN runs down: it resets every
   * slice. This is the turn-scale one, and it exists for exactly one consumer —
   * the selection temperature (`lobster/selection/sample.ts`), which is
   * SCHEDULER state and never board-belief state. Nothing that reaches a
   * `Bound`, a `ScoreBounds` or `better()` may read it; contract rule 17's grep
   * is what keeps that true.
   *
   * OPTIONAL ON PURPOSE. A harness budget (the deterministic `countingBudget`
   * every probe in this program runs on) does not model a turn, and a probe
   * whose temperature cooled with a wall clock would be a probe whose numbers
   * are a property of the box. Absent, the schedule holds its opening
   * temperature for every round: the lottery is on and does not cool.
   */
  decisionFraction?(): number
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
