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
 * capacity modelling choice (MAX_FROZEN overflow names its nearest units).
 *
 * Two CLASSES live in this union, and `bounds/score.ts`'s `assumptionClassOf`
 * is the one place that says which is which. CONDITIONING assumptions
 * (`reference-action`, `operator-pin`, `narrowing`) narrow the GAME and defeat
 * discharge. FRAMING assumptions (`posture`, `cohort`) name the QUESTION: they
 * gate comparability and do NOT defeat discharge. */
export type Assumption =
  | { readonly kind: "reference-action"; readonly unitId: UnitId; readonly to: CellIndex }
  | { readonly kind: "operator-pin"; readonly unitId: UnitId; readonly to: CellIndex }
  | { readonly kind: "narrowing"; readonly unitId: UnitId; readonly note: string }
  | { readonly kind: "posture"; readonly posture: Posture }
  /**
   * WHICH OBJECTIVE THIS NUMBER MAXIMISES. `features` is the profile's
   * *invoked* key set, sorted — the set actually computed, not merely the set
   * with a non-zero weight, which is a different (and, before the S0a gate,
   * routinely wrong) claim. It rides for the reader: the id alone is enough
   * for comparability, and `assumptionKey` deliberately keys on the id only,
   * so a cohort's feature list may be corrected in the registry without
   * re-basing every historical bound that named it. */
  | { readonly kind: "cohort"; readonly id: CohortId; readonly features: readonly string[] }

export interface ScoreBounds {
  readonly worst: number // sound lower bound on the true score (≡ Bound.lo)
  readonly best: number // sound upper bound (≡ Bound.hi)
  readonly ledger: ReadonlyArray<LedgerEntry>
  readonly assumptions: ReadonlyArray<Assumption>
  /** exact ⟺ ledger empty ∧ no CONDITIONING assumption present (discharge
   * theorem). NOTE: as pinned, a PINNED decision can never report exact even
   * when its restricted game is fully resolved — an operator pin is a
   * conditioning assumption, and consumers wanting "nothing left to learn" as a
   * stop condition should test `ledger.length === 0`, not `exact`. A FRAMING
   * assumption (`posture`, `cohort`) does not defeat exactness: it says which
   * question was asked, not that the answer is incomplete. */
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

// ------------------------------------------------------------------- cohorts

/**
 * WHICH EVALUATION COHORT A NUMBER WAS PROVED UNDER.
 *
 * A cohort names one criterion profile's *invoked* feature set — the question
 * the score answers. It is a stable string because the registry that owns the
 * ids is a data table (`evaluate/calibration.ts`'s `COHORTS`), not a class
 * hierarchy: adding a cohort is a row, and the id is what a refit corpus and
 * an operator audit read months later. Never derive it from a profile's
 * `name`, never mint one at a call site — `COHORTS` is the authority, and
 * `cohortRow` is the only lookup.
 *
 * Cohort is to the OBJECTIVE what posture is to the CHANNEL: both are framing
 * assumptions (`bounds/score.ts`'s `assumptionClassOf`), both gate
 * comparability, neither defeats discharge.
 */
export type CohortId = string

/**
 * THE ADMITTED LADDER — the objectives this turn is allowed to spend on, in
 * ascending order of cost, cheapest (the always-admitted base) first.
 *
 * A ladder is never empty: the base cohort is the safety floor and is admitted
 * on every board under every policy (anti-spaghetti rule 6). The LAST rung is
 * the richest admitted objective, and — for as long as there is one frame per
 * turn — it is the objective the decision is actually conducted under.
 *
 * What the ladder deliberately does NOT say is how the rungs interact. Whether
 * a richer rung may only break the cheaper one's ties, or may overturn it
 * inside a certified envelope, is a later stage's question; Stage 2 emits an
 * ordered list and the detector facts that produced it, and nothing here bakes
 * in an answer.
 */
export type CohortLadder = ReadonlyArray<CohortId>

/**
 * EVERYTHING THE ADMISSION GOVERNOR IS ALLOWED TO LOOK AT.
 *
 * Note what is absent: budget, deadline, elapsed time, slices spent, work
 * counters, plan counts. Adding any of them here is the design error this type
 * exists to prevent — it is `PostureConditions`' doctrine (`postures.ts:87`)
 * applied one layer up, and for the same reason: a policy keyed on the clock
 * measures the machine it runs on rather than the board it plays on, and the
 * measured evidence is that ten times the budget and forty times the plans
 * leave the deficit this policy addresses unmoved.
 *
 * It lives in `contracts.ts` rather than in `admission.ts` because it is WIRE
 * SURFACE: `EmitRecord.admission` carries it, so a refit corpus can be read
 * without holding the governor. `admission.ts` owns the doctrine and the
 * measurement and re-exports the type, exactly as `postures.ts` owns vacuity
 * and re-exports `VacuityCause`.
 *
 * Every field is a pure function of TURN-START board state (the substrate's
 * roster and its claim field), which is what makes the freeze at decision entry
 * a statement about the design rather than about the implementation: nothing a
 * refinement, an epoch or a slice can do changes any of these four numbers.
 */
export interface AdmissionConditions {
  /**
   * OWN-TEAM slider possibility: could a unit OF THE DECIDING TEAM be a slider
   * right now? PESSIMISTIC under fog (owner ruling Q2): a held unit counts if
   * ANY kind its claim's `kindSet` still admits is a slider, so a pawn held
   * long enough that it might have promoted counts as a slider until an
   * observation clears it. The team is read off the frozen claim record, which
   * is exact — a unit never changes team — so the pessimism is over KIND only.
   *
   * THIS IS THE BIT THE PREDICATE IS KEYED ON, and E1 is why. See
   * `ADMISSION_LADDERS`' first row for the numbers and the caveat.
   */
  readonly ownSliderPossible: boolean
  /**
   * BOARD-LEVEL (any-team) slider possibility, same pessimism, no team test.
   *
   * NOT what the predicate keys on. It is emitted because the compute census
   * and M4 are stated in terms of board-level presence, and a refit corpus
   * that carried only the own-team bit could not be read against either of
   * them — nor could it re-derive what the arch/s2 predicate would have
   * decided, which is exactly the comparison E1 is an answer to.
   */
  readonly sliderPossible: boolean
  /** The subject's own live trail units, off the turn-start roster. */
  readonly ownTrailCount: number
  /** Every other team's live trail units, off the same roster. */
  readonly theirTrailCount: number
  /**
   * The pre-arm, OWN-TEAM. True when a unit of the deciding team is one meal
   * from promoting — for a live unit `weight + 1 ≥ pawnPromotionWeight`, and
   * for a HELD one the pessimistic `record.weight + holdDepth + 1 ≥
   * pawnPromotionWeight`, since a unit we have not seen for `holdDepth` turns
   * could have eaten every one of them. Promotion is the only way a slider
   * ever appears on a slider-free board, and it is a plan-space event the
   * material-denominated evaluator never sees coming — so it is armed one turn
   * EARLY and the transition happens between turns, never inside one.
   *
   * Scoped own-team for the same reason `ownSliderPossible` is: the pre-arm
   * exists to treat an imminent promotion AS slider presence, so it has to be
   * scoped the way slider presence is or the two halves of one rule disagree.
   */
  readonly ownPromotionImminent: boolean
  /** The same pre-arm with no team test, emitted for the same reason
   * `sliderPossible` is. Not what the predicate keys on. */
  readonly promotionImminent: boolean
}

/**
 * WHAT THE POLICY DECIDED, ON THE WIRE.
 *
 * Without this the refit corpus is uninterpretable and the centaur operator
 * cannot audit the bot choosing its own evaluator (A3 §4.2 item 5,
 * anti-spaghetti rule 14). It rides on every emitted record, and it is
 * `undefined` — not a default-valued object — when no policy ran, because
 * "the policy was off" and "the policy chose the default" are different facts
 * and a corpus that cannot tell them apart is a corpus that cannot be refit.
 */
export interface AdmissionStamp {
  /** The admitted rungs, cheapest first. Never empty. */
  readonly ladder: CohortLadder
  /** The rung the decision was actually conducted under: the ladder's last. */
  readonly activeCohort: CohortId
  /** The measured board facts the ladder was classified from. */
  readonly detectors: AdmissionConditions
}

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
   * What the admission policy decided for this decision, and on what evidence.
   * Present exactly when a policy ran — absent when the policy is off, which
   * is the default and is a different fact from "the policy chose the
   * default". See `AdmissionStamp`.
   */
  readonly admission?: AdmissionStamp
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

/** What the sticky stager compares. One row per root candidate.
 *
 * THE COHORT STAMP IS NOT DECORATION. Every number on this row — `lo`, `est`,
 * `hi`, and the `vacuity` derived from them — is a statement under ONE
 * objective, and two rows from different objectives are not two answers to one
 * question but one answer each to two. The stamp is REQUIRED so that mixing
 * them is a type error at the row's construction site rather than a silent
 * `max` two layers down (A1 §1.3.2). `rows()` filters to the active cohort;
 * this field is what it filters on. */
export interface StagingCandidate {
  readonly key: string
  readonly lo: number
  readonly est: number
  readonly hi: number
  /** Horizon this candidate's value was proved at. */
  readonly horizon: number
  readonly vacuity: VacuityCause
  /** The evaluation cohort these numbers were proved under. */
  readonly cohort: CohortId
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
  /**
   * THE COHORT SEAM. Which evaluation cohort this decision opens under.
   * Defaults to the registry's default row.
   *
   * It is an INPUT and not a governor because Stage 1 hard-wires one cohort:
   * the caller names the objective once, the kernel proves everything under
   * it, and every number the decision produces carries that name. Stage 2's
   * admission governor sits exactly where `PostureGovernor` sits — it will
   * choose the OPENING cohort here and drive later flips through
   * `governCohort`, which already exists and is already tested. Nothing about
   * the basis machinery changes when it lands.
   *
   * An unregistered id is refused at `decide()` rather than discovered as a
   * bound stamped with a cohort nobody can look up.
   */
  readonly cohort?: CohortId
  /**
   * ONE EVALUATOR PER COHORT THE ADMISSION POLICY MAY CHOOSE.
   *
   * A cohort names an objective; an `Evaluator` is a thing that computes one.
   * WHICH evaluator computes which cohort is a composition question — the same
   * question `evaluate` above already answers for the single-cohort case — and
   * it is answered here rather than inside the kernel so that the loop never
   * learns how an objective is computed, only that objectives exist.
   *
   * Consulted ONLY when a policy chose the cohort. `evaluate` remains the
   * default and is what a decision with no policy uses, unchanged. A policy
   * that admits a cohort this map cannot serve is a configuration error and is
   * refused at `decide()`, loudly and at the seam that could have fixed it —
   * quietly falling back to `evaluate` would mean a decision proving numbers
   * under one objective while stamping them with another.
   */
  readonly evaluators?: ReadonlyMap<CohortId, Evaluator>
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
