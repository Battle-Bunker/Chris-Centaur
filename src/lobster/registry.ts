/**
 * THE ENTRY REGISTRY — the core redesign's five sockets, as data.
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * Today a candidate strategy is a dark code path behind a `CENTAUR_*` flag and
 * the promotion ledger judges flags. The paradigm's costs are the ones the
 * owner named: the code paths accumulate, the off-arms rot, and every strategy
 * is a fork in the source rather than a value in a table.
 *
 * The replacement: the kernel exposes a small set of PRIMITIVES per socket
 * (mechanisms that exist and work — the conflict index, the edge-EV surrogate,
 * the cluster partition, the multi-start sampler, the bound bank, the feature
 * folds, the thread machinery). A strategy entry is a PARAMETERIZATION AND
 * COMPOSITION of primitives, expressed as data: identity, priors, a cost
 * model, and a hook to its empirical record. Adding a candidate touches this
 * file and its tests; it adds no flag and no dead code path, and an entry that
 * loses is a deleted row.
 *
 * ── WHAT THIS INCREMENT DOES, AND WHAT IT DELIBERATELY DOES NOT ────────────
 *
 * This is the redesign's FIRST increment: the registry and the per-branch
 * belief, with everything BYTE-IDENTICAL to what ships. So:
 *
 *   · the five sockets are declared as typed interfaces — the contract a later
 *     entry implements;
 *   · the registry is SEEDED WITH EXACTLY TODAY'S BEHAVIOURS as the `legacy`
 *     entries, which is the design's `slate=legacy` byte-identity bridge:
 *     every entry below DESCRIBES a code path that already ships, and names
 *     the primitive that runs it;
 *   · resolution happens once per decision and is STAMPED on the mechanism
 *     report;
 *   · nothing dispatches through it. No entry carries an implementation, so no
 *     decision can take a different path than it took before this file
 *     existed. Selection of a non-legacy entry is the NEXT increment's work,
 *     and `SlateId` has exactly one member so that a non-legacy selection is
 *     unrepresentable rather than merely unused.
 *
 * THERE IS NO ENV FLAG HERE, and there will not be one: entries are data and
 * `SLATE_LEGACY` is a single internal constant. That is the whole point of the
 * mandate — "no more flag-gated pseudo-dead code as the testing paradigm".
 *
 * ── THE IDENTITY LAW ───────────────────────────────────────────────────────
 *
 * An entry is IMMUTABLE ONCE MEASURED: changing params mints a new versioned
 * id (`@2`), so every number in every record refers to a bit-reproducible
 * strategy. Judgements must attach to fixed identities or they are not
 * judgements about anything.
 *
 * Enforcing that is not a review convention here. Every legacy entry's params
 * are taken BY REFERENCE from the live constants the shipped code actually
 * reads (`DEFAULT_KNOBS`, `DEFAULT_TUNING`, `TERRITORY_PROFILE`,
 * `DEFAULT_KERNEL_OPTIONS`, `LAT`, `DEFAULT_SCOUT_TUNING`) — never retyped, so
 * the registry cannot drift away from what runs — and `registry.test.ts` PINS
 * a structural fingerprint of every entry. Move a shipped constant without
 * minting a new entry id and that test fails, which is the identity law with
 * teeth.
 *
 * ── THE SEAM RULE ──────────────────────────────────────────────────────────
 *
 * The rule that decides what may become an entry at all, and it is the
 * redesign's: IF IT CAN CHANGE A SOUND BOUND, IT IS KERNEL behind the law
 * harness; IF IT CAN ONLY CHANGE ORDER OR SPEND, IT IS A SLOT ENTRY. So the
 * staging-safety refusals, the rules-certain fatality exclusions, the royal
 * margin and the never-empty candidate guard are NOT in this table — they are
 * the inviolate safety floor. `soundness: 'sound-writing'` marks the one
 * socket whose entries do write lo/hi (the evaluators), and an entry so marked
 * owes the law harness as its registry-admission gate.
 */

import { structuralIdentity } from './contracts';
import type { Bound, Candidate, JointPlan, SearchContext, UnitId } from './contracts';
import type { BranchPosterior, Observation } from './belief';
import { DEFAULT_KNOBS } from './candidates';
import { DEFAULT_TUNING } from './search/core';
import { LAT } from './search/edge-ev';
import { DEFAULT_SCOUT_TUNING } from './search/scout/schedule';
import { DEFAULT_KERNEL_OPTIONS } from './kernel';
import {
  MATERIAL_ONLY_PROFILE,
  TERRITORY_PROFILE,
  TERRITORY_SLIDER_PROFILE,
  TERRITORY_SLIDER_ROYAL_PROFILE,
} from './evaluate/calibration';

// ------------------------------------------------------------------- slots

/** The five joints. Named exactly as the mandate names them. */
export type SlotId =
  /** Cheap weighting of candidate moves, before anything is simulated. */
  | 'move-selector'
  /** Which evaluators to run on a board. */
  | 'evaluator-selector'
  /** The evaluators themselves. */
  | 'evaluator'
  /** How deeper-exploration information updates a branch's weight. */
  | 'aggregator'
  /** Turn partitioning — the decision loop's compute schedule. */
  | 'scheduler';

export const SLOT_IDS: ReadonlyArray<SlotId> = [
  'move-selector',
  'evaluator-selector',
  'evaluator',
  'aggregator',
  'scheduler',
];

/** `"agg/legacy-clamp@1"` — slot prefix, name, version. See the identity law. */
export type EntryId = string;

/** The kernel mechanism an entry's params are interpreted by. Names a real
 * code site, so an entry whose primitive nothing implements is legible. */
export type PrimitiveId = string;

/**
 * Whether an entry may write a sound bound. `sound-writing` entries owe the
 * law harness (soundness / monotonicity / collapse) as a REGISTRY ADMISSION
 * GATE: an entry that writes lo/hi and fails the laws cannot be registered.
 */
export type Soundness = 'advisory' | 'sound-writing';

/** The promotion ledger's vocabulary, unchanged — the unit of account moves
 * from flag to entry, the statuses do not. */
export type EntryStatus =
  | 'candidate'
  | 'probe-passed'
  | 'live-supported'
  | 'live-null'
  | 'live-failed'
  | 'default'
  | 'retired';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [k: string]: JsonValue };

/**
 * An entry's PRIOR OUTPUT DISTRIBUTION, per cheap board stratum (redesign
 * §2.1) — for an evaluator, the shadow it leaves when it does not run; for a
 * policy, its effect prior.
 *
 * `fitted: false` on every legacy entry, and that is a measurement statement,
 * not a placeholder: nothing has fitted a stratum-conditioned output
 * distribution for any of these yet. The learning loop fits them from the same
 * replay corpus that prices everything else — the empirical record and the
 * prior are the same data at two ages — and increment 2 is where they start
 * being read. Declaring the shape now is what lets a fitted prior arrive as a
 * data change.
 */
export interface EntryPriors {
  readonly fitted: boolean;
  /** Cheap board strata the prior would be conditioned on, once fitted. */
  readonly strata: ReadonlyArray<string>;
  readonly note: string;
}

/**
 * Measured cost by board-shape features, re-fitted by the learning loop.
 * `fitted: false` on the legacy entries for the same honest reason as the
 * priors: the VOI/cost economy (§2.3) is increment 2, and a cost model
 * invented here would be a number with no measurement behind it.
 */
export interface CostModel {
  readonly fitted: boolean;
  /** Board-shape features the fit would be over. */
  readonly features: ReadonlyArray<string>;
  readonly note: string;
}

/**
 * THE EMPIRICAL-RECORD HOOK — deliberately a hook and not a copy.
 *
 * The promotion ledger (`tools/learnloop/`) holds the measurements, the batch
 * ids, the CIs, the nulls and the engagement proofs, and it is not this
 * increment's to touch. So an entry names the ledger rows it is the successor
 * of, and the ledger stays the single source of measured truth. When the
 * ledger's schema gains its `slot`/`entryId` columns the join runs the other
 * way and this hook is what it joins on.
 */
export interface EmpiricalRecord {
  readonly status: EntryStatus;
  /** Ledger rows this entry inherits — flag names today, entry ids later. */
  readonly ledgerRows: ReadonlyArray<string>;
  readonly note: string;
}

/** A candidate strategy, as a peer data value receiving empirical judgement. */
export interface StrategyEntry<S extends SlotId = SlotId> {
  readonly id: EntryId;
  readonly slot: S;
  /** THE WHOLE CONFIGURATION — weights, thresholds, composition order. */
  readonly params: JsonValue;
  /** Which kernel primitive interprets `params`. */
  readonly primitive: PrimitiveId;
  readonly soundness: Soundness;
  readonly priors: EntryPriors;
  readonly cost: CostModel;
  readonly record: EmpiricalRecord;
}

// -------------------------------------------------- the five socket contracts

/**
 * What a socket implementation is handed. `SearchContext` is the decision's
 * own standing context (substrate, generator, evaluator, basis, budget) and is
 * already the one object every layer of the search agrees on, so the sockets
 * take it rather than minting a parallel vocabulary.
 */
export type DecisionCtx = SearchContext;

/** What a move-selector weights over: one unit, or one cluster's joint. */
export type SelectorScope =
  | { readonly kind: 'unit'; readonly unitId: UnitId }
  | { readonly kind: 'cluster'; readonly clusterId: number };

/**
 * SOCKET 1 — MOVE SELECTOR. Cheap weighting of candidate moves for
 * exploration, before anything is simulated.
 *
 * Logits over the COMPLETE candidate set. Additive composition: a slate's
 * selectors SUM their logits, each entry's params carrying its own scale.
 * NEVER a subset — the order-not-set law: a probability may choose the ORDER
 * of anything, never the SET a floor closes over. Sound exclusions
 * (rules-certain fatality, staging safety, royal-path refusal) are not in this
 * socket at all; they are the kernel safety floor.
 */
export interface MoveSelector {
  logits(
    ctx: DecisionCtx,
    scope: SelectorScope,
    candidates: ReadonlyArray<Candidate>
  ): Float64Array;
}

/** What one invocation of an evaluator on a board is estimated to be worth,
 * and what it is estimated to cost — the two halves of the VOI/cost ratio the
 * scheduler buys on (§2.3). */
export interface VoiEstimate {
  /** Expected sharePar loss avoided by collapsing this shadow here. */
  readonly value: number;
  /** Microseconds, from the entry's fitted cost model. */
  readonly costUs: number;
}

/**
 * SOCKET 2 — EVALUATOR SELECTOR. Which evaluators to run, per board state.
 *
 * Returns invocation VALUE estimates, not a fixed set: the scheduler buys the
 * best value-per-microsecond work item. The degenerate policies (always-all,
 * material-only) return +Infinity / 0 and are the bracketing baselines.
 */
export interface EvaluatorSelector {
  invocationValue(
    ctx: DecisionCtx,
    plan: JointPlan,
    evaluator: StrategyEntry<'evaluator'>
  ): VoiEstimate;
}

/** An evaluator's contribution to the frame value of a (plan, board): a sound
 * interval plus an advisory density. `density` optional — it defaults to the
 * entry's own prior. */
export interface FeatureContribution {
  readonly bound: Bound;
  readonly density?: { readonly mu: number; readonly prec: number };
}

/**
 * SOCKET 3 — BOARD EVALUATOR. The evaluators themselves.
 *
 * The sound half obeys the law harness as a REGISTRY ADMISSION GATE.
 * `spanCert` is the certified across-candidate span — the sound width of this
 * evaluator's SHADOW (§2.1) — and an entry without one may not have its shadow
 * used soundly.
 */
export interface BoardEvaluator {
  evaluate(ctx: DecisionCtx, plan: JointPlan): FeatureContribution;
  readonly spanCert?: (ctx: DecisionCtx) => number;
}

/**
 * SOCKET 4 — AGGREGATOR. How deeper-exploration information updates a branch's
 * weight, for BOTH further compute and final selection.
 *
 * Two read-outs, one object: the owner's "both further compute investment AND
 * eventual selection" is satisfied by construction, because allocation and
 * selection read the same posterior.
 */
export interface Aggregator {
  update(post: BranchPosterior, obs: Observation): BranchPosterior;
  /** §3.2 — the branch's share of the next unit of compute. */
  allocationWeight(post: BranchPosterior, pool: ReadonlyArray<BranchPosterior>): number;
  /** §3.5 — where the branch sits on the adjudication ladder's density rungs. */
  selectionKey(post: BranchPosterior): readonly [number, number];
}

/** What the scheduler may buy with the next unit of compute. */
export type WorkItem =
  | { readonly kind: 'invoke'; readonly evaluator: EntryId; readonly planKey: string }
  | { readonly kind: 'price'; readonly planKey: string }
  | { readonly kind: 'deepen'; readonly planKey: string }
  | { readonly kind: 'expand'; readonly clusterId: number; readonly unitId: UnitId }
  | { readonly kind: 'emit' };

/**
 * SOCKET 5 — SCHEDULER. Turn partitioning, at per-board-state granularity.
 *
 * HARD CONSTRAINTS LIVE OUTSIDE THE ENTRY: the staged-move emission barrier,
 * the deadline, the safety floor and the sound-work reserve are kernel
 * parameters, not policy. A misallocated millisecond costs strength, never
 * correctness.
 */
export interface Scheduler {
  next(ctx: DecisionCtx, pool: ReadonlyArray<BranchPosterior>): WorkItem;
}

// ------------------------------------------------------------------- slates

/** What a match actually runs: one entry per socket, plus the composable
 * move-selector stack. */
export interface Slate {
  readonly id: SlateId;
  /** Socket 1 is composable — the entries' logits SUM. */
  readonly moveSelectors: ReadonlyArray<EntryId>;
  readonly evaluatorSelector: EntryId;
  /** Socket 3 is the FRAME: every bound published is a statement about the
   * weighted sum of exactly these. */
  readonly evaluators: ReadonlyArray<EntryId>;
  readonly aggregator: EntryId;
  readonly scheduler: EntryId;
}

/**
 * THE ONE SLATE THAT EXISTS. An internal constant, not an environment flag and
 * not a knob: this increment ships the bridge, and the bridge has exactly one
 * side. A second slate arrives with the first entry that actually decides, and
 * arrives as a data row plus its paired-arm spec.
 */
export const SLATE_LEGACY = 'legacy' as const;
export type SlateId = typeof SLATE_LEGACY;

// ------------------------------------------------------- the legacy entries

/**
 * Every legacy entry shares these: nothing is fitted, and the record points at
 * the shipped behaviour rather than at a promotion row, because what ships is
 * not a candidate — it is the baseline every candidate is measured against.
 */
const UNFITTED_PRIORS = (note: string, strata: ReadonlyArray<string> = []): EntryPriors => ({
  fitted: false,
  strata,
  note,
});

const UNFITTED_COST = (note: string, features: ReadonlyArray<string> = []): CostModel => ({
  fitted: false,
  features,
  note,
});

const SHIPPED = (note: string, ledgerRows: ReadonlyArray<string> = []): EmpiricalRecord => ({
  status: 'default',
  ledgerRows,
  note,
});

/**
 * SOCKET 1, THE LEGACY ENTRY — the orderings that ship.
 *
 * `dangerOrder` picks which unit a sweep re-optimises first, `orderKey` ranks a
 * unit's own options, and `topCandidates` takes a prefix of that ranking. None
 * of the three can change which plan is better — they are sweep order and
 * option order, and adjudication reads only the proved floor.
 *
 * The PRUNES are not here on purpose. A prune removes an option from the set,
 * and under the order-not-set law that makes it either a declared max-side
 * restriction (kernel, ledgered) or a safety-floor refusal (kernel,
 * inviolate). This socket weights; it never closes.
 */
const MOVE_LEGACY_ORDER: StrategyEntry<'move-selector'> = {
  id: 'move/legacy-order@1',
  slot: 'move-selector',
  primitive: 'search/order:danger+gain+prefix',
  soundness: 'advisory',
  params: {
    // BY REFERENCE from the shipped constants — see the identity law.
    candidateCap: DEFAULT_TUNING.candidateCap,
    maxSweeps: DEFAULT_TUNING.maxSweeps,
    polishUnits: DEFAULT_TUNING.polishUnits,
    polishPerUnit: DEFAULT_TUNING.polishPerUnit,
    pairRepairPerUnit: DEFAULT_TUNING.pairRepairPerUnit,
    restarts: DEFAULT_TUNING.restarts,
    ordering: {
      gainOrdering: DEFAULT_KNOBS.gainOrdering,
      escortShadowOrdering: DEFAULT_KNOBS.escortShadowOrdering,
      selfDebuffOrdering: DEFAULT_KNOBS.selfDebuffOrdering,
      keepQuiet: DEFAULT_KNOBS.keepQuiet,
    },
  },
  priors: UNFITTED_PRIORS(
    'no effect prior fitted: the ordering has never been measured as a ' +
      'distribution over its own displacement, only as a promoted flag.',
    ['roster mix', 'phase', 'contact structure']
  ),
  cost: UNFITTED_COST(
    'unfitted. The ordering is charged inside candidate generation and has ' +
      'never been timed separately from it.',
    ['units', 'options per unit', 'sliders']
  ),
  record: SHIPPED(
    'gainOrdering was PROMOTED at integ/round-a and ships on; the rest is the ' +
      'shipped sweep order. This entry is the baseline a slot-1 challenger ' +
      '(edge-EV surrogate logits, multi-start seed policy) must beat.',
    ['gainOrdering']
  ),
};

/**
 * SOCKET 2, THE LEGACY ENTRY — there is no selection today, and saying so
 * precisely is the point of this row.
 *
 * `BoundEvaluator.evaluatePlan` folds `FEATURES` on every evaluation of every
 * plan. `fold()` calls `evaluateFeature` for EVERY feature and only skips the
 * ADDITION when the weight is zero (`evaluate/bound.ts`), so a zero-weighted
 * feature is still paid for in full. That is `always-all` exactly, and it is
 * the degenerate policy the redesign keeps as one of the two bracketing
 * baselines the VOI rule has to beat.
 */
const EVSEL_LEGACY_ALWAYS: StrategyEntry<'evaluator-selector'> = {
  id: 'evsel/legacy-always@1',
  slot: 'evaluator-selector',
  primitive: 'evaluate/bound:fold',
  soundness: 'advisory',
  params: {
    policy: 'always-all',
    /** Every feature in the profile's list runs on every board. */
    perBoardSelection: false,
    /** A zero WEIGHT still pays for the feature's evaluation. */
    zeroWeightStillEvaluated: true,
  },
  priors: UNFITTED_PRIORS(
    'degenerate: an always-run policy has no invocation-value distribution to fit.'
  ),
  cost: UNFITTED_COST(
    'the policy itself is free; what it buys is the whole feature list, whose ' +
      'cost belongs to the socket-3 entries.'
  ),
  record: SHIPPED(
    'the shipped invocation policy. CENTAUR_COHORT_POLICY measured LIVE-NULL ' +
      'against it; its predicates become socket-2 challengers carrying that record.',
    ['CENTAUR_COHORT_POLICY']
  ),
};

/**
 * SOCKET 3, THE LEGACY ENTRIES — the profiles, as they ship.
 *
 * THE PROFILE IS THE ENTRY, at the bridge. The redesign retires
 * `CriterionProfile` as the unit of evaluator configuration — "profiles were
 * pre-registry slates; the slate is the profile now" — and decomposes it into
 * one entry per FEATURE with its weight in the entry's params. That
 * decomposition changes what a weight belongs to, so it is not byte-identical
 * bookkeeping and it is not this increment's. Here the profile is one
 * sound-writing entry, and the slate's `evaluators` list has one member, which
 * is the same statement the bridge is allowed to make today.
 *
 * The per-feature decomposition is CHEAP when it comes: `fold()` already
 * computes every feature's own `Bound` and publishes them as
 * `PlanEvaluation.parts`. What is missing is retention — see the note on the
 * fold path in `registry.test.ts`.
 */
const evaluatorEntry = (
  id: EntryId,
  profile: unknown,
  record: EmpiricalRecord
): StrategyEntry<'evaluator'> => ({
  id,
  slot: 'evaluator',
  primitive: 'evaluate/index:BoundEvaluator',
  // The one socket whose entries write lo/hi. The law harness
  // (evaluate/laws.ts: soundness / monotonicity / collapse) is its admission gate.
  soundness: 'sound-writing',
  params: profile as JsonValue,
  priors: UNFITTED_PRIORS(
    'no per-stratum output distribution fitted: the shadow machinery is ' +
      'increment 2. A span certificate is owed per feature before any shadow ' +
      'of this entry may be read soundly.',
    ['roster mix', 'phase', 'contact structure']
  ),
  cost: UNFITTED_COST(
    'measured only in aggregate: the evaluator is 45-64% of a decision\'s self ' +
      'time, per the evaluation-memo measurement. Not decomposed per feature.',
    ['units', 'interior cells', 'sliders']
  ),
  record,
});

const EVAL_LEGACY_TERRITORY = evaluatorEntry(
  'eval/legacy-territory@1',
  TERRITORY_PROFILE,
  SHIPPED(
    'THE PRODUCTION PROFILE. Its three named prerequisites (shell interning, ' +
      'per-kind maxHealth, a production-regime bench rerun) are all met; see ' +
      'evaluate/calibration.ts for the measurement that moved this default.'
  )
);

const EVAL_LEGACY_MATERIAL = evaluatorEntry(
  'eval/legacy-material@1',
  MATERIAL_ONLY_PROFILE,
  SHIPPED(
    'the reflex rung and the explicit fallback. Kept as the material-only ' +
      'bracket the redesign names as one of socket 2\'s two baselines.'
  )
);

const EVAL_LEGACY_SLIDER = evaluatorEntry(
  'eval/legacy-territory-slider@1',
  TERRITORY_SLIDER_PROFILE,
  SHIPPED(
    'the slider repair. TERRITORY_SLIDER_PROFILE is SUPPORTED in the ledger; ' +
      'the redesign dissolves it into per-feature weights, which is why it is a ' +
      'peer row here rather than a mode of the profile above.',
    ['TERRITORY_SLIDER_PROFILE']
  )
);

const EVAL_LEGACY_SLIDER_ROYAL = evaluatorEntry(
  'eval/legacy-territory-slider-royal@1',
  TERRITORY_SLIDER_ROYAL_PROFILE,
  SHIPPED(
    'the ablation arm: the repair with the royal exclusion lifted. Never a ' +
      'production default; kept because the argument survived and the ' +
      'measurement did not settle it.',
    ['TERRITORY_SLIDER_PROFILE']
  )
);

/**
 * SOCKET 4, THE LEGACY ENTRY — `clampToLat`, RELABELLED AND OTHERWISE
 * UNTOUCHED.
 *
 * This is the entry the redesign names by name: "a `legacy-clamp` entry
 * reproducing today's one-step cap, kept exactly long enough to be the
 * paired-arm baseline that the merge rule must beat". It survives as the
 * BASELINE ENTRY. Nothing about its behaviour changes in this increment —
 * `clampToLat` is byte-for-byte the function it was, at the one call site it
 * had, in the one channel it was ever allowed to speak on.
 *
 * WHAT THE CAP ACTUALLY IS, measured rather than assumed: the depth diagnosis
 * instrumented 258 findings and NOT ONE exceeded the cap (median 3-4, max 8,
 * against LAT = 10). On real boards it is the identity function. The half of
 * the defence doing the work is the loser-only polarity — a finding may only
 * ever penalise. Both facts belong on this row, because the increment that
 * challenges it must know which half it is challenging.
 */
const AGG_LEGACY_CLAMP: StrategyEntry<'aggregator'> = {
  id: 'agg/legacy-clamp@1',
  slot: 'aggregator',
  primitive: 'search/scout/scout:clampToLat',
  soundness: 'advisory',
  params: {
    /** One material lattice step, in score units, from the shipped weights. */
    lat: LAT,
    /** A thread finding may only ever PENALISE a candidate, never reward one. */
    polarity: 'loser-only',
    /** The single channel out of the layer: CL3's UnaryLookup ordering seam. */
    channel: 'candidate-ordering-surrogate',
    /** It reaches no bound: depth is provenance, never denomination. */
    writesBound: false,
  },
  priors: UNFITTED_PRIORS(
    'the thread-value-spread prior that would derive a finding\'s earned ' +
      'precision is exactly what the depth diagnosis is to supply; unfitted here.',
    ['thread depth', 'held-cloud width', 'saturation fraction']
  ),
  cost: UNFITTED_COST('free: one Math.min on an already-computed delta.'),
  record: SHIPPED(
    'MEASURED INERT: 258 instrumented findings, zero above the cap (median 3-4, ' +
      'max 8, cap 10). The working half of the defence is the loser-only ' +
      'polarity, not the magnitude cap. This row is the baseline the ' +
      'precision-weighted merge must beat on the record, and the reason the ' +
      'comparison is worth running is that the cap binds exactly the ' +
      'discoveries depth exists to make.',
    ['CENTAUR_SCOUT']
  ),
};

/**
 * SOCKET 5, THE LEGACY ENTRY — the slice loop that ships.
 *
 * The kernel's anytime schedule: fixed-shape slices whose length grows with
 * measured cost, capped at a fraction of the turn so an operator's pin never
 * waits longer than one slice; one slice in N to a speculative context; and the
 * scout's tithe under a hard reserve for the ply-1 search that actually stages.
 * The redesign's `slice-rounds` baseline is this row, and the emergent
 * greedy-VOI schedule has to beat it on the record before the old machinery is
 * deleted.
 *
 * The HARD CONSTRAINTS are not params: the deadline, the emission barrier, the
 * safety floor and the sound-work reserve are kernel, by the socket's own
 * contract. What is here is the policy shape.
 */
const SCHED_LEGACY_SLICE: StrategyEntry<'scheduler'> = {
  id: 'sched/legacy-slice@1',
  slot: 'scheduler',
  primitive: 'kernel:slice-loop',
  soundness: 'advisory',
  params: {
    sliceMs: DEFAULT_KERNEL_OPTIONS.sliceMs,
    sliceCostFactor: DEFAULT_KERNEL_OPTIONS.sliceCostFactor,
    maxSliceFraction: DEFAULT_KERNEL_OPTIONS.maxSliceFraction,
    stepSafetyFactor: DEFAULT_KERNEL_OPTIONS.stepSafetyFactor,
    guardBudgetFraction: DEFAULT_KERNEL_OPTIONS.guardBudgetFraction,
    estimateCapFraction: DEFAULT_KERNEL_OPTIONS.estimateCapFraction,
    speculativePeriod: DEFAULT_KERNEL_OPTIONS.speculativePeriod,
    yieldIntervalMs: DEFAULT_KERNEL_OPTIONS.yieldIntervalMs,
    deepening: {
      /** Share of the decision the scout may spend, and the ply-1 reserve
       * that is a CEILING on it (the owner's Q3 answer). */
      tithe: DEFAULT_SCOUT_TUNING.tithe,
      reserve: DEFAULT_SCOUT_TUNING.reserve,
      soundShare: DEFAULT_SCOUT_TUNING.soundShare,
    },
  },
  priors: UNFITTED_PRIORS(
    'no distribution over what a slice buys has been fitted; the schedule has ' +
      'only ever been judged end-to-end.',
    ['budget', 'roster size']
  ),
  cost: UNFITTED_COST(
    'the loop measures its OWN slice cost per decision (the EWMA on the pin ' +
      'context) but that is state, not a fitted model.',
    ['budget', 'units']
  ),
  record: SHIPPED(
    'the shipped anytime schedule, and the `slice-rounds` baseline the ' +
      'greedy VOI/cost scheduler must beat before the round machinery is deleted.'
  ),
};

/** Every entry that exists. A losing entry is a DELETED ROW, not a dark flag. */
export const LEGACY_ENTRIES: ReadonlyArray<StrategyEntry> = [
  MOVE_LEGACY_ORDER,
  EVSEL_LEGACY_ALWAYS,
  EVAL_LEGACY_TERRITORY,
  EVAL_LEGACY_MATERIAL,
  EVAL_LEGACY_SLIDER,
  EVAL_LEGACY_SLIDER_ROYAL,
  AGG_LEGACY_CLAMP,
  SCHED_LEGACY_SLICE,
];

/** The `slate=legacy` bridge: exactly what ships, named as entries. */
export const LEGACY_SLATE: Slate = {
  id: SLATE_LEGACY,
  moveSelectors: [MOVE_LEGACY_ORDER.id],
  evaluatorSelector: EVSEL_LEGACY_ALWAYS.id,
  evaluators: [EVAL_LEGACY_TERRITORY.id],
  aggregator: AGG_LEGACY_CLAMP.id,
  scheduler: SCHED_LEGACY_SLICE.id,
};

// ---------------------------------------------------------------- registry

/** One entry per socket, materialised for one decision. */
export interface ResolvedSlate {
  readonly slateId: SlateId;
  readonly moveSelectors: ReadonlyArray<StrategyEntry<'move-selector'>>;
  readonly evaluatorSelector: StrategyEntry<'evaluator-selector'>;
  readonly evaluators: ReadonlyArray<StrategyEntry<'evaluator'>>;
  readonly aggregator: StrategyEntry<'aggregator'>;
  readonly scheduler: StrategyEntry<'scheduler'>;
}

/** The resolved slate as IDS — what the mechanism report carries, so an
 * ingest can key a measurement on the entry that produced it. */
export interface SlateStamp {
  readonly slate: SlateId;
  readonly moveSelectors: ReadonlyArray<EntryId>;
  readonly evaluatorSelector: EntryId;
  readonly evaluators: ReadonlyArray<EntryId>;
  readonly aggregator: EntryId;
  readonly scheduler: EntryId;
}

export class UnknownEntryError extends Error {
  readonly code = 'unknown_entry' as const;
  constructor(readonly entryId: EntryId, readonly slot: SlotId | null) {
    super(
      slot === null
        ? `no registry entry ${entryId}`
        : `no registry entry ${entryId} in slot ${slot}: a slate may only name ` +
          `entries that exist, because an entry id is what a measurement attaches to`
    );
    this.name = 'UnknownEntryError';
  }
}

/**
 * The registry: the single source of truth for what candidates exist.
 *
 * Resolution is TOTAL and CHECKED — a slate naming an entry that does not
 * exist, or one that exists in a different socket, is a throw and not a
 * fallback. A silent fallback would let a measurement be attributed to an
 * entry that never ran, which is the one thing the identity law exists to
 * prevent.
 */
export class StrategyRegistry {
  private readonly byId = new Map<EntryId, StrategyEntry>();

  constructor(entries: ReadonlyArray<StrategyEntry> = LEGACY_ENTRIES) {
    for (const e of entries) {
      if (this.byId.has(e.id)) throw new Error(`duplicate registry entry id ${e.id}`);
      this.byId.set(e.id, e);
    }
  }

  /** Every entry, or every entry in one socket. Insertion order — stable. */
  entries(slot?: SlotId): ReadonlyArray<StrategyEntry> {
    const all = [...this.byId.values()];
    return slot === undefined ? all : all.filter((e) => e.slot === slot);
  }

  /** One entry by id, checked against the socket it is being read for. */
  get<S extends SlotId>(id: EntryId, slot: S): StrategyEntry<S> {
    const hit = this.byId.get(id);
    if (hit === undefined || hit.slot !== slot) throw new UnknownEntryError(id, slot);
    return hit as StrategyEntry<S>;
  }

  /** ONE ENTRY PER SOCKET PER DECISION. */
  resolve(slate: Slate = LEGACY_SLATE): ResolvedSlate {
    if (slate.moveSelectors.length === 0) {
      throw new Error('a slate must name at least one move selector');
    }
    if (slate.evaluators.length === 0) {
      throw new Error('a slate must name at least one evaluator: the frame is the slate');
    }
    return {
      slateId: slate.id,
      moveSelectors: slate.moveSelectors.map((id) => this.get(id, 'move-selector')),
      evaluatorSelector: this.get(slate.evaluatorSelector, 'evaluator-selector'),
      evaluators: slate.evaluators.map((id) => this.get(id, 'evaluator')),
      aggregator: this.get(slate.aggregator, 'aggregator'),
      scheduler: this.get(slate.scheduler, 'scheduler'),
    };
  }
}

/** The process's registry. Immutable data, so one instance is one table — not
 * per-decision state, and nothing writes to it. */
export const REGISTRY = new StrategyRegistry();

/** The slate a decision runs. One member today, by construction. */
export function slateFor(id: SlateId = SLATE_LEGACY): Slate {
  if (id !== SLATE_LEGACY) throw new Error(`unknown slate ${String(id)}`);
  return LEGACY_SLATE;
}

/** The resolved slate, as ids, for the mechanism report. */
export function slateStampOf(resolved: ResolvedSlate): SlateStamp {
  return {
    slate: resolved.slateId,
    moveSelectors: resolved.moveSelectors.map((e) => e.id),
    evaluatorSelector: resolved.evaluatorSelector.id,
    evaluators: resolved.evaluators.map((e) => e.id),
    aggregator: resolved.aggregator.id,
    scheduler: resolved.scheduler.id,
  };
}

/**
 * AN ENTRY'S STRUCTURAL FINGERPRINT — the identity law's instrument.
 *
 * Every field that decides what the entry IS: its slot, its primitive, its
 * soundness class and its whole params tree. Deliberately NOT a field list:
 * `structuralIdentity` walks every own key in sorted order, so an entry that
 * grows a param is a changed fingerprint whether or not anyone remembered to
 * amend this function. The prose fields (priors/cost notes, record notes) are
 * excluded — a clarified comment is not a new strategy.
 */
export function entryFingerprint(entry: StrategyEntry): string {
  return structuralIdentity({
    id: entry.id,
    slot: entry.slot,
    primitive: entry.primitive,
    soundness: entry.soundness,
    params: entry.params,
  });
}
