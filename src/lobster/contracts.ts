/**
 * LOBSTER cross-module contracts.
 *
 * The build's parallel modules (substrate/candidates/evaluate, bounds/search,
 * voc/kernel/postures, pins) depend on each other ONLY through this file plus
 * the vendored engine. Amendments go through the integrator, never by a
 * module silently redefining a shape. Derived from the synthesis architecture
 * (scratchpad/synthesis-architect-report.md §B) and the deliberation delta;
 * amended once, coherently, at integration from the three builders' proposals
 * (B1 A1–A5, B2 A1–A7, B3's refiner + clock amendments).
 *
 * ── ONE INTERVAL, TWO DIALECTS ─────────────────────────────────────────────
 *
 * Two interval types cross this file's seams, and they are two enrichment
 * stages of the SAME quantity, with `worst ≡ lo` and `best ≡ hi` everywhere:
 *
 *   Bound                {lo, est, hi} — the evaluator's triple. lo = worst,
 *                        hi = best, plus the advisory `est` ordering channel
 *                        that exists nowhere below this layer.
 *   ScoreBounds (here)   {worst, best, ledger, assumptions, exact} — the bound
 *                        bank's pair, provenance-enriched: the same two ends
 *                        with a STRUCTURED ledger and named assumptions so
 *                        basis identity and the discharge theorem are typed.
 *
 * There used to be a third — the resolver's own subject-frame fold, which
 * arrived as a vendored type nobody here could rename. The fold is bot-side
 * now (`bounds/material.ts`), so `MaterialBounds` is the same two ends in the
 * same vocabulary and the dialect is gone. `est` is dropped, never translated,
 * on the way down — it must never gate a decision lo/hi make. No third
 * vocabulary may be introduced.
 */

import type { Claim, Divergence, Fate, PartialSettlement } from "../engine-vendor/engine/settlePartial"
import type { MaterialBounds } from "./bounds/material"
import type { LoudReading } from "./bounds/loud"
// THE ONE UPWARD REFERENCE, and it is type-only. `KernelInput.lens` names the
// lens's own sink type rather than re-declaring its shape here: two
// declarations of one function type is exactly the drift the lens exists to
// stop. `import type` is erased, so no runtime cycle exists.
import type { LensSink, MovesetRung, VerdictReason } from "../lens/types"

export type { Claim, Divergence, Fate, PartialSettlement, MaterialBounds }

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

// -------------------------------------------------------------- path verdicts

/**
 * WHY a cell got the grade it got — one entry per contact the fold read off
 * the settlement, so a human reading a refusal can see which unknown unit and
 * which rule produced it.
 */
export interface RiskCause {
  readonly role: "head" | "body" | "edge" | "pile" | "terrain" | "item"
  /** Which axis this cause moved. */
  readonly axis: "survival" | "defeat" | "halt"
  /** The unit whose unknown disposition creates the difference, when there is one. */
  readonly heldId: UnitId | null
  /** True when the cause is a LEDGERED possibility rather than a settled fact. */
  readonly contingent: boolean
  readonly note: string
}

/** What one cell of a staged ray does to the mover. */
export interface EncounterVerdict {
  /** Does the mover survive this cell? (quantified over every world) */
  readonly survival: Trit
  /** Does the mover defeat something here? */
  readonly defeat: Trit
  /** Does the mover's movement END here (capture-stop, block, or death)? */
  readonly halt: Trit
  readonly causes: ReadonlyArray<RiskCause>
  /** Where the mover could die from this encounter. */
  readonly deathCells: ReadonlyArray<CellIndex>
}

/** What one staged ray does to the mover, whole. */
export interface TraversalVerdict {
  /** One verdict per cell the mover actually enters, in path order. */
  readonly perCell: ReadonlyArray<EncounterVerdict>
  /** Whole-path survival. */
  readonly survival: Trit
  /** Does the mover complete its staged path? */
  readonly completesPath: Trit
  /**
   * Where the mover could come to rest. `certain` is set only when the landing
   * is one cell in every world; otherwise `cells` is the landing SET, and a
   * possible halt forbids truncating it.
   */
  readonly landing: { readonly certain: CellIndex | null; readonly cells: ReadonlyArray<CellIndex> }
  /** Energy spent, as an interval over the worlds (movement cost + hazards). */
  readonly energySpent: { readonly lo: number; readonly hi: number }
  /**
   * Upper bound on movement energy SAVED by a possible non-fatal truncation.
   * A mover stopped early is fuller than its staged path priced, and an
   * unaccounted saving is optimistic in the wrong direction for its opponents.
   */
  readonly savedByTruncation: number
  /** Would exhaustion prove FATAL? */
  readonly exhaustionFatal: Trit
  readonly deathCells: ReadonlyArray<CellIndex>
}

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
  /**
   * `ledgerKey(this)`, PRECOMPUTED — optional, and never load-bearing.
   *
   * It is exactly the string `bounds/score.ts` would build and cache against
   * this object (`unitId:cell:subStep:polarity`, the `note` deliberately
   * out), filled at construction by the translation that mints the entries the
   * hot path actually merges. An entry without it — a test fixture, a
   * hand-built residue — keys through the WeakMap exactly as before, so this
   * changes no key, no dedup and no order.
   */
  readonly canonicalKey?: string
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
  /**
   * THE HORIZON THIS PLAN'S READING WAS PROVED AT (06 F-2).
   *
   * A property of THIS plan's proof, not of the slice that produced it. The
   * kernel used to stamp the refinement view's horizon onto every plan it
   * absorbed in a slice, which attributes one plan's depth to every plan that
   * happened to be priced beside it — and `deepen` names ONE plan. Absent ⇒ 1:
   * a search that says nothing about depth searched one ply, which is the
   * honest default and the one every reading on this build actually has.
   */
  readonly horizon?: number
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
   * Milliseconds from the decision's own start (the kernel's `t0`) to the
   * moment this record was built, ON THE KERNEL'S CLOCK — the same clock
   * `BudgetHandle.now` reads, so a journal replayed against `KernelReport`'s
   * `elapsedMs`/`budgetMs` is on one scale and a fake-clock test is exact.
   *
   * Present on every record the kernel emits. Optional so a hand-built record
   * (a harness, a fixture) need not invent a time it never measured — the
   * emission journal reports "unknown" rather than zero for those.
   */
  readonly elapsedMs?: number
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
  /**
   * The settlement itself — the whole turn, with the plan's movers known and
   * everything else held. Its `ledger` names every point a concrete world
   * could differ from it, and an EMPTY ledger is a proof that the held set did
   * not matter.
   */
  readonly resolution: PartialSettlement
  /** Per-team [worst, best] in the subject's frame. */
  readonly perTeam: ReadonlyMap<number, { readonly worst: number; readonly best: number }>
  /** Subject-frame material bounds, with the narrowed claims as basis. */
  readonly bounds: MaterialBounds
  /**
   * The settlement's divergences in the contract's vocabulary — one entry per
   * implicated unknown, with the polarity that says which endpoint rides on
   * it. Translated at the seam, once, because the substrate is the only layer
   * that knows which wire id is which unit.
   */
  readonly ledger: ReadonlyArray<LedgerEntry>
}

/** B1 owns: the engine substrate. One place translates the wire board into
 * engine terms (weight stacks!), names every live unit on every settlement
 * (silence is a typed refusal upstream — NO_ORDER_MOVE is an explicit
 * statement), and exposes the claims the held units carry.
 *
 * THERE IS NO SLAB CONTRACT ANY MORE. Settlement allocates per call and owns
 * no arena, so a resolution is a plain value: hold it, drop it, keep it in a
 * memo. `release()` survives as "drop this decision's caches", and it is not
 * paired with anything.
 *
 * THE PLAN-DOMAIN RULE. The plan's domain IS the modelled set: everything not
 * named in a JointPlan is held with its own observation turn, so a partial
 * assignment is unreachable by construction. `withModelled` returns a sibling
 * over the SAME position in which every unit in `modelled` is expected LIVE —
 * a plan must name it, and may name it with an explicit action. Claims are
 * derived per call from the sibling's own modelled set, so a NARROWER sibling
 * is simply correct; the shared-claim-view refusal the arena version carried
 * has no subject left. */
export interface Substrate {
  /** Every live unit, ascending. */
  unitIds(): ReadonlyArray<UnitId>
  /** The unit a settlement's wire id names — the one direction of the map that
   * anything reading a settlement needs, and the only place it is done. */
  unitIdOf(wireId: string): UnitId | undefined
  /** Live units on `asTeam` this decision is entitled to move. */
  commandable(asTeam: number): ReadonlyArray<UnitId>
  resolveBoundedFor(plan: JointPlan, asTeam: number): BoundedResolution
  /** Settle, hand the settlement to `fn`, return what `fn` returns. */
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
  /** Drop this decision's caches. Not paired with anything. */
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

/** One feature's share of an evaluation, as a human reads it: the feature's
 * own unweighted reading, the profile weight applied to it, and the product
 * that actually entered the fold. `contribution` is `value × weight` on the
 * interval — weights are non-negative by contract, so the endpoints do not
 * swap and the three are consistent by construction. */
export interface FeatureContribution {
  readonly key: string
  /** The feature's own bound, BEFORE weighting (the fold's `parts` entry). */
  readonly value: Bound
  readonly weight: number
  /** `value × weight` — what this feature added to the total. */
  readonly contribution: Bound
}

/**
 * WHY a plan scored what it scored, per feature.
 *
 * THE EXPLAIN SURFACE IS NOT ON THE HOT PATH. Nothing in the search or the
 * kernel calls it: it exists so telemetry can report, once per unit after a
 * decision has already settled, which term carried the verdict. It costs one
 * ordinary evaluation plus a map over the fold's parts — no second scoring
 * pipeline, which the single-pipeline rule forbids.
 */
export interface PlanExplanation {
  /** The criterion profile's own name, so a stored row says which objective
   * produced it rather than leaving a reader to guess the build. */
  readonly profile: string
  readonly bound: Bound
  readonly features: ReadonlyArray<FeatureContribution>
  readonly exact: boolean
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
  /**
   * Optional: the same evaluation with the per-feature accounting attached.
   *
   * Optional because an evaluator that is not a weighted fold has no honest
   * answer — a stub, a memo wrapper, a scripted test double. A consumer that
   * cannot get one reports the bounds without the breakdown rather than
   * fabricating weights, so the absence is visible in the row.
   */
  explainPlan?(sub: Substrate, plan: JointPlan, asTeam: number): PlanExplanation
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

/**
 * ONE PRICED TRIAL, at the `better()` call site — the lens's whole input.
 *
 * The set-valued reduction is already computed and discarded at the first
 * comparison; this is where it is handed over instead. It costs the search
 * `O(k)` numeric comparisons per trial and ZERO evaluations, and it is
 * present only when a consumer asked for it: `SearchContext.trials` absent ⇒
 * the search does not build one of these at all.
 */
export interface TrialObservation {
  /** The whole plan that was priced. A trial is never a partial assignment. */
  readonly plan: JointPlan
  /** What it was compared AGAINST — the incumbent at that instant. */
  readonly incumbentPlan: JointPlan
  readonly bounds: ScoreBounds
  /** The ordering channel. Never adjudicates. */
  readonly est: number
  /** `planTieKey(plan, seed)` — an indifferent order, reproducibly. */
  readonly tie: number
  readonly rung: MovesetRung
  readonly accepted: boolean
  /** Which branch of `better()` refused it. Null until [CHANGE 1]. */
  readonly because: VerdictReason | null
  /** The certificate, when the branch that refused was the witness veto. */
  readonly witness: Witness | null
  /** The horizon THIS trial's reading was proved at (06 F-2). Absent ⇒ 1. The
   * lens's depth column reads it here — from the reading — and never from
   * `EmitRecord.horizon`, which is a property of an emission. */
  readonly horizon?: number
  /**
   * THE LOUD PRODUCT of this trial's own B3 preamble, or null where the
   * preamble did not run (`08-DEPTH-VERDICT` §5 step 1). An INSTRUMENT: it is
   * measured on option lists the bank already built, it settles nothing, and
   * no comparison on this path reads it.
   */
  readonly loud?: LoudReading | null
}

export type TrialSink = (trial: TrialObservation) => void

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
  /**
   * Optional: every priced trial, as it is compared. The retention seam.
   *
   * ABSENT ⇒ THE SEARCH BUILDS NOTHING. The core checks one null before each
   * comparison and does not compute a tie key, a plan key or an observation
   * object for a trial nobody is watching, which is what keeps 05 §(d) gate
   * 7(ii) — "the sink is free when absent" — a fact rather than a hope.
   */
  readonly trials?: TrialSink
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
  /**
   * [CHANGE 3] — THE LENS SINK, and why it is a second channel.
   *
   * The frames must not travel on `AsyncIterable<EmitRecord>`: that channel's
   * consumer is the wire, and a frame arriving there would be a staged plan.
   * So a separate, optional, SYNCHRONOUS sink, called BETWEEN slices only and
   * never inside one, wrapped in try/catch by the kernel — a lens consumer
   * that throws must not be able to take a decision down, which is the rule
   * telemetry already has.
   *
   * ABSENT ⇒ THE LENS COSTS EXACTLY NOTHING, and that is a gate rather than a
   * claim: with this undefined the decision's evaluator-call and node counts
   * are byte-identical to the pre-lens recording (05 §(d) gate 7(ii)).
   */
  readonly lens?: LensSink
}
