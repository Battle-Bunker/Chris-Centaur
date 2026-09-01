/**
 * THE ENTRY REGISTRY — the core redesign's five sockets, as data.
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * A candidate strategy USED to be a dark code path behind a `CENTAUR_*` flag,
 * with the promotion ledger judging flags. The paradigm's costs are the ones
 * the owner named: the code paths accumulate, the off-arms rot, and every
 * strategy is a fork in the source rather than a value in a table. The flag
 * system was torn out on 2026-08-29; what a bot runs is now data all the way
 * down — `BotConfig` (`bot-config.ts`) for the choices that have not yet earned
 * an entry, and this table for the ones that have.
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
 *   · the DEFAULT bot dispatches through nothing here. `slate=legacy` names the
 *     entries that describe what already ships, so a decision taken under the
 *     defaults cannot take a different path than it took before this file
 *     existed — which is what the byte-identity gates assert.
 *
 * ── AND WHAT THE SECOND SLATE ADDS ─────────────────────────────────────────
 *
 * `SlateId` used to have exactly one member, so a non-legacy selection was
 * unrepresentable. The cost of that was measured rather than argued: four
 * potion-doctrine evaluator entries were merged, in no slate, and therefore
 * selectable by no `BotConfig` at all — every potions-on game the program has
 * played was played by a potion-unaware bot, and every potion arm in the
 * roster was unrunnable as specified.
 *
 * `SLATE_POTION_AWARE` is the second member, and it is the shipped evaluator
 * lineup plus those four terms. It changes no joint and no default: a member
 * added to a collection that already exists, selected by a config naming it
 * and in no other way. Every entry it adds is ADVISORY, so the lineup reaches
 * the decision through `est` (ordering and belief) and can move no bound — see
 * `evaluate/potion-lineup.ts` and `evaluate/bound.ts`'s `advisoryEst`.
 *
 * THERE IS NO ENV FLAG HERE, and there will not be one: entries are data and
 * the slate ids are internal constants a `BotConfig` names. That is the whole
 * point of the mandate — "no more flag-gated pseudo-dead code as the testing
 * paradigm".
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
// The four potion candidates, BY REFERENCE, for exactly the reason the legacy
// entries take their params by reference: the successor rows below inherit
// their predecessors' priors, cost models and primitives, and a retyped copy
// would drift away from the modules that own them. Value imports and not type
// imports, because the entries themselves are the data being inherited.
import { ATTACK_WINDOW_ENTRY, POTION_WINDOW_TURNS } from './evaluate/attack-window';
import { POTION_SEEK_ENTRY } from './evaluate/potion-seek';
import { POTION_CONTROL_ENTRY } from './evaluate/potion-control';
import { DODGE_DISCOUNT_ENTRY } from './evaluate/dodge-discount';
import { POTION_PICKUP_ENTRY } from './evaluate/potion-pickup';
import { POTION_DEFENSE_ENTRY } from './evaluate/potion-defense';

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
 * THE SHIPPED SLATE. An internal constant, not an environment flag and not a
 * knob: it is the byte-identity bridge, and every default bot resolves it.
 */
export const SLATE_LEGACY = 'legacy' as const;

/**
 * THE SECOND SLATE — the shipped evaluator lineup PLUS the four potion terms.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 *
 * `eval/attack-window`, `eval/potion-seek`, `eval/potion-control` and
 * `eval/dodge-discount` were merged as members of the evaluator collection and
 * named by no slate, so no `BotConfig` could seat a bot that reasons about
 * potions at all: every potions-on game this program has played was played by
 * a potion-unaware bot, and every potion arm in the roster was unrunnable as
 * specified. This slate is the selection half of that lane — a member added to
 * a collection that already exists, at a joint that already exists, which is a
 * normal commit under `docs/BRANCHING.md`.
 *
 * ── WHAT SELECTING IT CHANGES, AND WHAT IT CANNOT ──────────────────────────
 *
 * Every potion entry is ADVISORY, so the whole lineup reaches the decision
 * through `est` and nothing else: it reorders the plans a floor cannot
 * separate and it may not move a floor, a ceiling, a refusal or a safety
 * decision. `src/lobster/evaluate/potion-lineup.ts` is where that split is
 * made structural rather than promised, and `evaluate/bound.ts`'s
 * `advisoryEst` is the one function through which an advisory entry may speak.
 *
 * ── AND WHAT IT IS NOT ─────────────────────────────────────────────────────
 *
 * NOT A DEFAULT. `DEFAULT_BOT_CONFIG.slate` is `legacy` and the byte-identity
 * gates assert it. This slate is selected by a config file naming it, in the
 * arm that races it, and in no other way.
 */
export const SLATE_POTION_AWARE = 'potion-aware' as const;

/**
 * THE THIRD SLATE — the potion-aware lineup PLUS the two terms that make it
 * decide something.
 *
 * `potion-aware` reasons about potions and, measured over 271 games on the
 * parent branch, changed almost nothing: its lineup engaged on 31.8% of
 * evaluations while `est` decided 1.2% of comparisons and 20% fell through to a
 * salted tie key. The reason is structural rather than a matter of weight. Its
 * four terms all price THE BOARD — the best pickup available, the window we
 * hold, the ground we own — and a board-level reading is very nearly the same
 * number on both sides of a comparison between two of our own plans, so the
 * comparator sees a tie and reaches for the coin.
 *
 * This slate adds the two readings that differ between plans:
 *
 *   `eval/potion-pickup@1` — DOES THIS PLAN TAKE A POTION. Zero on every plan
 *   that does not, non-zero on every plan that does, which is the one shape a
 *   term must have if it is to settle the comparison it exists for.
 *
 *   `eval/potion-defense@1` — WHAT THEIR POTION DOES TO US, and the
 *   counter-attack on their collector that collapses it. The half of the
 *   mechanism no seated term read at all: a bot on `potion-aware` plays a
 *   potion board as though only its own team could ever drink.
 *
 * Both are advisory and neither may move a bound, exactly as the other four.
 */
export const SLATE_POTION_INTEL = 'potion-intel' as const;

export type SlateId =
  | typeof SLATE_LEGACY
  | typeof SLATE_POTION_AWARE
  | typeof SLATE_POTION_INTEL;

/** Every slate id, in a value a validator can iterate. */
export const SLATE_IDS: ReadonlyArray<SlateId> = [
  SLATE_LEGACY,
  SLATE_POTION_AWARE,
  SLATE_POTION_INTEL,
];

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
    'the shipped invocation policy. The cohort-policy experiment measured ' +
      'LIVE-NULL against it and its code is gone; its predicates become ' +
      'socket-2 challengers carrying that record.',
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

// -------------------------------------------------- the potion-aware entries

/**
 * SOCKET 3, THE POTION ENTRIES — the four merged terms, at the weights a
 * lineup runs them at.
 *
 * ── WHY THESE ARE NEW IDS AND NOT THE ONES IN THE MODULES ──────────────────
 *
 * `ATTACK_WINDOW_ENTRY` (`@1`), `POTION_SEEK_ENTRY` (`@2`),
 * `POTION_CONTROL_ENTRY` (`@1`) and `DODGE_DISCOUNT_ENTRY` (`@1`) each carry
 * `weight: 0` in their params — the honest statement of a term that is in no
 * lineup and contributes nothing. Seating them means a non-zero weight, and
 * the params tree is part of an entry's fingerprint, so under the identity law
 * that is a NEW ENTRY and not an edit: every number ever recorded against the
 * older id still refers to the strategy that produced it. The modules keep
 * their own entries unchanged, and the retrodiction evidence attached to them
 * stays attached to them.
 *
 * `eval/attack-window@2` also moves `tierDelta` from `+1` to `0`, and that is
 * a substantive difference rather than bookkeeping: at `+1` the term prices the
 * ally side of a pickup, which is exactly `eval/potion-seek@3`'s gain and would
 * be counted twice in one lineup. At `0` it prices the window our team is
 * ALREADY holding, which nothing else in the lineup reads. See
 * `evaluate/potion-lineup.ts` for the composition argument in full.
 *
 * ── SOUNDNESS ──────────────────────────────────────────────────────────────
 *
 * All four are `advisory`, inherited from the modules' own declarations. The
 * evaluator socket is the one socket that CAN write lo/hi, and these four do
 * not: they reach `est` through `advisoryEst` and can move no bound. That is
 * why they owe no law-harness admission gate and why a slate may seat them
 * without one.
 */
/** The ids the `potion-aware` slate names, and the one place they are spelled.
 * `evaluate/potion-lineup.ts` imports these rather than repeating them, so a
 * slate and the lineup that implements it cannot drift apart. */
export const EVAL_ATTACK_WINDOW_ID = 'eval/attack-window@2';
export const EVAL_POTION_SEEK_ID = 'eval/potion-seek@3';
export const EVAL_POTION_CONTROL_ID = 'eval/potion-control@2';
export const EVAL_DODGE_DISCOUNT_ID = 'eval/dodge-discount@2';
export const EVAL_POTION_PICKUP_ID = 'eval/potion-pickup@1';
export const EVAL_POTION_DEFENSE_ID = 'eval/potion-defense@1';

/**
 * THE ADVISORY WEIGHTS, as entry params — the scale each term speaks at.
 *
 * All three non-zero weights are an order of magnitude inside `material` (10,
 * the term the game is actually won with) and at or below `room` (3): an
 * advisory reading able to outweigh material would be ordering the
 * material-tie class from outside it, and the tie class is the whole of what
 * `est` may touch.
 *
 * NOTHING HERE IS FITTED, and the entries' `cost`/`priors` rows say so. These
 * are declared scales; the arm that races this slate is what earns them a
 * number with a measurement behind it, and a retune mints `@3`/`@4` by the
 * identity law.
 */
export const POTION_ADVISORY_WEIGHTS = {
  attackWindow: 0.5,
  potionSeek: 1,
  potionControl: 1,
  /** A modifier, not a summand — see `eval/dodge-discount@2` below. */
  dodgeDiscount: 0,
  /**
   * THE TWO PLAN-DISCRIMINATING TERMS, at a louder scale than the four
   * board-level ones and for a stated reason rather than a taste.
   *
   * A board-level reading is near-equal across the plans it is compared over,
   * so its scale barely matters: `advisoryEst` clamps the sum back inside the
   * proved interval, and a delta that is the same on both sides survives the
   * clamp only to change nothing. A plan-discriminating reading is the opposite
   * — it is zero on one side and not on the other — so its scale is exactly
   * what decides whether the clamp leaves anything of it. These two are the
   * terms whose weight is load-bearing, which is why they are the two the
   * config lets an arm move (`BotConfig.potionWeights`).
   *
   * Still an order of magnitude inside `material` (10): a potion window is
   * worth arranging and is never worth more than the material it is arranged
   * to take.
   */
  potionPickup: 3,
  potionDefense: 2,
} as const;

/** What a bot may retune without minting a new entry id: the scales, and
 *  nothing else. A partial — what is named overrides, what is not keeps. */
export type PotionAdvisoryWeights = Partial<
  Record<keyof typeof POTION_ADVISORY_WEIGHTS, number>
>;

const potionEntry = (
  id: EntryId,
  base: StrategyEntry,
  params: JsonValue,
  note: string
): StrategyEntry<'evaluator'> => ({
  id,
  slot: 'evaluator',
  primitive: base.primitive,
  // NEVER `sound-writing`. An advisory evaluator entry lands on `est` and is
  // clamped back inside the interval the sound features proved.
  soundness: 'advisory',
  params,
  priors: base.priors,
  cost: base.cost,
  record: {
    status: 'candidate',
    ledgerRows: [],
    note: `${note} Succeeds ${base.id}, whose params carried weight 0 because it was in no slate.`,
  },
});

const EVAL_ATTACK_WINDOW = potionEntry(
  EVAL_ATTACK_WINDOW_ID,
  ATTACK_WINDOW_ENTRY,
  {
    windowTurns: POTION_WINDOW_TURNS,
    /**
     * ZERO, NOT ONE — the window ALREADY OPEN rather than the ally side of a
     * pickup. A body cut needs a tier strictly above the owner's, so at 0 the
     * reading is identically zero unless one of our units carries a live buff.
     */
    tierDelta: 0,
    decay: 'body-shift',
    countHeads: false,
    /** Gate: nothing is read unless some unit of ours holds a live tier. */
    gate: 'team-has-live-window',
    /** Enemy weight enters at the share-metric rate, off the live board. */
    currency: 'our-weight-via-sever-exchange-rate',
    weight: POTION_ADVISORY_WEIGHTS.attackWindow,
  },
  'The standing-window half of the potion doctrine, seated in the potion-aware slate.'
);

const EVAL_POTION_SEEK = potionEntry(
  EVAL_POTION_SEEK_ID,
  POTION_SEEK_ENTRY,
  {
    windowTurns: POTION_WINDOW_TURNS,
    maxTravelTurns: POTION_WINDOW_TURNS,
    countHeads: false,
    countDenial: false,
    /**
     * DECIDED BY THE LINEUP, not by this row: with `eval/dodge-discount@2`
     * seated the near endpoint is charged with the collector's escape fan
     * priced, and without it the undiscounted window endpoint is — which is
     * the worst case the module ships and the reading its retrodiction used.
     */
    exposure: 'window, or near dodge-discounted when eval/dodge-discount@2 is seated',
    weight: POTION_ADVISORY_WEIGHTS.potionSeek,
  },
  'The prospective-pickup half of the potion doctrine, seated in the potion-aware slate.'
);

const EVAL_POTION_CONTROL = potionEntry(
  EVAL_POTION_CONTROL_ID,
  POTION_CONTROL_ENTRY,
  {
    windowTurns: POTION_WINDOW_TURNS,
    horizonTurns: POTION_WINDOW_TURNS,
    tieOwner: 'nobody',
    currency: 'our-weight-via-sever-exchange-rate',
    weight: POTION_ADVISORY_WEIGHTS.potionControl,
  },
  'The ground-division half of the potion doctrine, seated in the potion-aware slate.'
);

const EVAL_DODGE_DISCOUNT = potionEntry(
  EVAL_DODGE_DISCOUNT_ID,
  DODGE_DISCOUNT_ENTRY,
  {
    enemyResponse: 'cover-proportional-to-our-uniform',
    reading: 'mean',
    attackerJoin: 'independent',
    windowChainTurns: 1,
    support: 'legal-minus-rules-certain-fatal',
    /** Terrain is the substrate's own, never rebuilt per call. */
    terrain: 'borrowed-from-substrate',
    /**
     * A MODIFIER, NOT A SUMMAND. Weight zero on purpose: everything this entry
     * does happens by being present, which switches `eval/potion-seek@3`'s
     * exposure endpoint. A term that also summed its own multiplier would be
     * double-charging the exposure it exists to discount.
     */
    role: 'exposure-modifier of eval/potion-seek@3',
    weight: POTION_ADVISORY_WEIGHTS.dodgeDiscount,
  },
  'The collector-exposure discount, seated in the potion-aware slate as a modifier.'
);

const EVAL_POTION_PICKUP = potionEntry(
  EVAL_POTION_PICKUP_ID,
  POTION_PICKUP_ENTRY,
  {
    windowTurns: POTION_WINDOW_TURNS,
    subject: 'realised-pickup',
    window: 'begins on the resolved turn',
    /** Heads we already win are not a reason to drink; heads the TIER flips
     *  are the whole of what a snake team buys — `evaluate/potion-pickup.ts`
     *  `ShieldValue`, and the measurement that says why. */
    countHeads: 'tier-flipped only',
    channels: ['ally-body-window', 'contest-shield', 'collector-exposure'],
    countDenial: false,
    exposure: 'near, dodge-discounted when eval/dodge-discount@2 is seated',
    currency: 'gain at sever-exchange-rate, exposure in our weight',
    weight: POTION_ADVISORY_WEIGHTS.potionPickup,
  },
  'The pickup THIS PLAN makes, seated in the potion-intel slate.'
);

const EVAL_POTION_DEFENSE = potionEntry(
  EVAL_POTION_DEFENSE_ID,
  POTION_DEFENSE_ENTRY,
  {
    windowTurns: POTION_WINDOW_TURNS,
    attackerGate: 'live-tier > 0',
    targetGate: 'live-tier < 0',
    victims: 'subject-team only',
    countHeads: true,
    /** The head channel is the plan-discriminating one — see
     *  `evaluate/potion-defense.ts` `HeadExposure`. */
    channels: ['their-body-window', 'our-head-exposure', 'collector-counter'],
    cancellation: 'vulnerable-collision buff expiry',
    currency: 'kill at sever-exchange-rate, threat and cancellation in our weight',
    weight: POTION_ADVISORY_WEIGHTS.potionDefense,
  },
  'The defensive half of the potion doctrine, seated in the potion-intel slate.'
);

/** The potion terms, as registered entries. A losing entry is a deleted
 * row here exactly as in `LEGACY_ENTRIES`. */
export const POTION_ENTRIES: ReadonlyArray<StrategyEntry> = [
  EVAL_ATTACK_WINDOW,
  EVAL_POTION_SEEK,
  EVAL_POTION_CONTROL,
  EVAL_DODGE_DISCOUNT,
  EVAL_POTION_PICKUP,
  EVAL_POTION_DEFENSE,
];

/**
 * THE `potion-aware` SLATE — the default lineup PLUS the four potion terms.
 *
 * Four sockets are the legacy entries unchanged, which is deliberate: the
 * question this slate asks is about the evaluator frame and nothing else, so a
 * result from it attributes to the potion terms rather than to a second
 * simultaneous change. The evaluator list leads with the production profile —
 * the only `sound-writing` member, and the one that still proves every bound —
 * and the advisory four follow it.
 */
export const POTION_AWARE_SLATE: Slate = {
  id: SLATE_POTION_AWARE,
  moveSelectors: [MOVE_LEGACY_ORDER.id],
  evaluatorSelector: EVSEL_LEGACY_ALWAYS.id,
  evaluators: [
    EVAL_LEGACY_TERRITORY.id,
    EVAL_ATTACK_WINDOW.id,
    EVAL_POTION_SEEK.id,
    EVAL_POTION_CONTROL.id,
    EVAL_DODGE_DISCOUNT.id,
  ],
  aggregator: AGG_LEGACY_CLAMP.id,
  scheduler: SCHED_LEGACY_SLICE.id,
};

/**
 * THE `potion-intel` SLATE — everything `potion-aware` names, plus the two
 * plan-discriminating terms. Same four non-evaluator sockets, again, so a
 * result from it attributes to the evaluator frame and to nothing else.
 */
export const POTION_INTEL_SLATE: Slate = {
  id: SLATE_POTION_INTEL,
  moveSelectors: [MOVE_LEGACY_ORDER.id],
  evaluatorSelector: EVSEL_LEGACY_ALWAYS.id,
  evaluators: [
    EVAL_LEGACY_TERRITORY.id,
    EVAL_ATTACK_WINDOW.id,
    EVAL_POTION_SEEK.id,
    EVAL_POTION_CONTROL.id,
    EVAL_DODGE_DISCOUNT.id,
    EVAL_POTION_PICKUP.id,
    EVAL_POTION_DEFENSE.id,
  ],
  aggregator: AGG_LEGACY_CLAMP.id,
  scheduler: SCHED_LEGACY_SLICE.id,
};

/** Every entry the registry holds. `LEGACY_ENTRIES` stays the shipped bot's
 * own set so the identity pins that name it keep naming exactly it. */
export const ALL_ENTRIES: ReadonlyArray<StrategyEntry> = [
  ...LEGACY_ENTRIES,
  ...POTION_ENTRIES,
];

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
export const REGISTRY = new StrategyRegistry(ALL_ENTRIES);

/**
 * The slate a decision runs, by id.
 *
 * TOTAL AND LOUD, exactly as `StrategyRegistry.resolve` is: a name this
 * function does not hold is a throw and never a fallback to the default,
 * because a measurement attributed to a slate that never ran is the failure
 * the identity law exists to prevent.
 */
export function slateFor(id: SlateId = SLATE_LEGACY): Slate {
  if (id === SLATE_LEGACY) return LEGACY_SLATE;
  if (id === SLATE_POTION_AWARE) return POTION_AWARE_SLATE;
  if (id === SLATE_POTION_INTEL) return POTION_INTEL_SLATE;
  throw new Error(`unknown slate ${String(id)}`);
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
