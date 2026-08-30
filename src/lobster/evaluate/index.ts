/**
 * THE EVALUATOR — one joint plan in, one {lo, est, hi} triple out.
 *
 * The whole layer is three moves:
 *
 *   1. RESOLVE ONCE. The engine's own subject-frame fold comes back with the
 *      resolution, so material (with the cliff inside it) costs nothing extra
 *      and cannot disagree with the position it is scoring.
 *   2. FOLD the non-negatively weighted features. A weighted sum of
 *      monotone-bounded features is itself monotone-bounded, so R1–R3 lift to
 *      the total for free.
 *   3. CLAMP, ORDERED. Terminal outcomes are lattice elements, applied by
 *      replacement and not by addition, with our own elimination checked before
 *      anyone else's.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 *
 * It is not a per-unit score that a search may sum. Every evaluation is of the
 * FULL joint move set, resolved as one turn; per-unit quantities may order work
 * and may never compose into a value. Summed per-unit values fail to cover
 * joint value in both directions — measured, repeatedly, by more than one
 * workspace.
 *
 * It is also not a comparator. `est` orders moves among floor ties and never
 * decides anything; a floor comparison reads `lo`, a ceiling reads `hi`, and
 * two bounds built over different assumption sets are not comparable at all —
 * that refusal is the bound bank's to enforce, and `basis` below is what it
 * enforces it with.
 */

import { structuralIdentity } from '../contracts';
import type {
  Bound,
  Evaluator,
  JointPlan,
  PlanEvaluation as ContractPlanEvaluation,
} from '../contracts';
import { EngineSubstrate } from '../substrate';
import type { Substrate } from '../contracts';
import { DEAD, WIN, advisoryEst, clampEst, clampTo, fold } from './bound';
import type { AdvisoryTerm, Evaluation, Feature, Weights } from './bound';
import {
  CLIFF_MATERIAL_WEIGHT,
  DEFAULT_PROFILE,
  MATERIAL_ONLY_PROFILE,
  TERRITORY_SLIDER_PROFILE,
  TERRITORY_SLIDER_ROYAL_PROFILE,
} from './calibration';
import type { CriterionProfile } from './calibration';
import { FEATURES, makeContext, terminalVerdicts } from './features';
import type { EvalContext } from './features';
import { mutualWipeAwardFor, mutualWipeCountersFor } from './mutual-wipe';

export * from './bound';
export * from './calibration';
export {
  ADMISSION,
  FEATURES,
  budgetShare,
  buildArrivals,
  commandFeature,
  healthEconomyFeature,
  kingMarginFeature,
  makeContext,
  materialBounds,
  materialFeature,
  pieceScaleOf,
  reachFeature,
  roomFeature,
  standingOf,
  terminalVerdicts,
  trailScaleOf,
} from './features';
export type { EvalContext, Standing, UnitShells } from './features';
export { ShellTable, buildShells, earliestShells, recordOfView } from './shells';
export { partitionOf, tierAtTurn, workspaceFor } from './territory';
export type { Admission, Partition, TrailRoom } from './territory';
export {
  DEFAULT_TERRITORY_REFINE,
  SHIELD_TURNS_MAX,
  buildShield,
  meetIntervals,
  refineReportOf,
  refineScopeOf,
  setRefineScope,
} from './refine';
export type { RefineReport, RefineScope, Shield } from './refine';
export {
  MutualWipeCounters,
  mutualWipeAwardFor,
  mutualWipeCountersFor,
  mutualWipeReportOf,
  mutualWipeVerdict,
} from './mutual-wipe';
export type { MutualWipeAward, MutualWipeReport, MutualWipeVerdict } from './mutual-wipe';
export { checkCollapse, checkMonotone, checkSoundness, worldsOf } from './laws';
export type { LawCase, LawResult } from './laws';

/** Everything a consumer might want from one evaluation — the contract's
 * `PlanEvaluation` plus this evaluator's own terminal telemetry. */
export interface PlanEvaluation extends ContractPlanEvaluation {
  /** Whether the two terminal readings fired, and which way. */
  readonly terminal: { readonly loClamped: boolean; readonly hiClamped: boolean };
}

export class BoundEvaluator implements Evaluator {
  readonly profile: CriterionProfile;
  /**
   * The features this evaluator folds. `FEATURES` by default, so nothing that
   * does not ask for more pays for more: an additive feature carried in a
   * separate list costs a caller that never names it exactly nothing, whereas a
   * zero WEIGHT on a feature in the shipped list still pays for the evaluation.
   * That difference is the only reason the seam exists.
   */
  readonly features: ReadonlyArray<Feature<EvalContext>>;
  /**
   * THE ADVISORY LINEUP — registry `evaluator` entries marked `advisory`,
   * which may move `est` and may not touch a bound. Empty by default, and
   * empty is a path with no arithmetic in it: `advisoryEst` returns its input
   * identically, so a bot that names no advisory term evaluates byte for byte
   * what shipped. See `./bound.ts` for the contract and
   * `./potion-lineup.ts` for the lineup the `potion-aware` slate resolves to.
   */
  readonly advisory: ReadonlyArray<AdvisoryTerm<EvalContext>>;
  private readonly weights: Weights;

  constructor(
    profile: CriterionProfile = DEFAULT_PROFILE,
    features: ReadonlyArray<Feature<EvalContext>> = FEATURES,
    advisory: ReadonlyArray<AdvisoryTerm<EvalContext>> = NO_ADVISORY
  ) {
    this.profile = profile;
    this.features = features;
    this.advisory = advisory;
    this.weights = profile.weights;
  }

  /**
   * WHAT THIS EVALUATOR IS, for anything that caches an evaluation.
   *
   * An evaluation is NOT evaluator-independent the way a resolution is: two
   * profiles score the same resolved world differently, and so does one
   * profile at a different reach horizon. So the bound bank's evaluation memo
   * keys on this string, and this string is derived STRUCTURALLY from the
   * whole profile — every field, including any a cohort or selection
   * mechanism adds later, and including a field this file has never heard of.
   * Nothing is enumerated by name here, deliberately: the failure mode of
   * forgetting to add one to a hand-written key is a wrong number, not a slow
   * one.
   *
   * A getter rather than a stored string, because a profile object may be
   * swapped or amended between decisions and a captured identity would then
   * be serving the previous profile's numbers.
   */
  get evaluationIdentity(): string {
    const base = `BoundEvaluator(${structuralIdentity(this.profile)})`;
    // THE ADVISORY LINEUP IS PART OF WHAT THIS EVALUATOR IS. Two evaluators
    // over one profile that differ in their advisory terms report different
    // `est` on the same board, and `est` is inside the memoised `Bound` — so a
    // shared key would serve one lineup's numbers to the other. Appended only
    // when the lineup is non-empty, so the default evaluator's identity is the
    // string it has always been, character for character.
    if (this.advisory.length === 0) return base;
    const lineup = this.advisory.map((t) => `${t.key}*${t.weight}`).join('+');
    return `${base}+advisory(${lineup})`;
  }

  scorePlan(sub: Substrate, plan: JointPlan, asTeam: number): Bound {
    return this.evaluatePlan(sub, plan, asTeam).bound;
  }

  evaluatePlan(sub: Substrate, plan: JointPlan, asTeam: number): PlanEvaluation {
    if (!(sub instanceof EngineSubstrate)) {
      throw new TypeError(
        'the evaluator needs the engine substrate: the per-team fold and the claim ' +
          'field are not on the Substrate interface'
      );
    }
    return sub.withResolution(plan, asTeam, ({ resolution, bounds }) => {
      const ctx = makeContext(
        sub,
        resolution,
        bounds,
        asTeam,
        this.profile.reachHorizonTurns,
        // One bag, carrying I1's royalReachers and I2's command /
        // healthReserveRatio. See makeContext's signature.
        this.profile
      );
      const evaluation: Evaluation = fold(this.features, ctx, this.weights);
      // The material weight is the fold's own denominator, and the terminal
      // mutual-wipe value has to land on the same scale — so it is the
      // PROFILE's, not the default, or a recalibrated profile would price its
      // terminals in the shipped profile's units.
      const sound = finish(ctx, evaluation, this.weights.material ?? CLIFF_MATERIAL_WEIGHT);
      // THE ADVISORY OVERLAY, LAST AND ON `est` ALONE. After the terminal
      // clamp, so a lattice end is never argued with, and clamped back inside
      // the interval the features proved — an advisory entry may reorder the
      // floor-tie class and may not move the floor that defines it. With no
      // lineup this returns `sound.bound` itself and the object below is the
      // one `finish` built.
      const withAdvisory = advisoryEst(sound.bound, this.advisory, ctx);
      return withAdvisory === sound.bound ? sound : { ...sound, bound: withAdvisory };
    });
  }
}

/** The empty lineup, shared, so "no advisory terms" is one identity rather
 * than a fresh array per evaluator. */
const NO_ADVISORY: ReadonlyArray<AdvisoryTerm<EvalContext>> = [];

/**
 * The clamp step, kept separate so the law harness can exercise it directly.
 *
 * ORDERING, AND WHY IT IS NOT A SUM. Our own elimination is checked before
 * anyone else's, in each reading independently. Adding a "my team wiped" term to
 * a "their team wiped" term lets the two cancel, and a mutual annihilation then
 * scores as a wash — which is how an evaluator ends up trading its own last unit
 * for the opponent's. It is not a wash.
 *
 * IS IT A LOSS, THOUGH. Not always, and this file used to say it was. TacticToes
 * settles a game in which every remaining team dies on the same turn from the
 * PREVIOUS COMMITTED TURN's board, and the metric this program optimizes is the
 * owner's continuous `sharePar` — share of the end weight times the team count,
 * par 1 — not a winner flag. So a mutual final wipe BANKS THE PREVIOUS TURN'S
 * POSITION, and it is worth more the further ahead we were. The ordering above
 * prices it at the lattice bottom whatever we were holding, and it is most
 * wrong when we were holding most. `./mutual-wipe.ts` is the repair —
 * UNCONDITIONAL, because it is a correction and not a strategy — and it carries
 * the rule, the value, the four guards it refuses on, and the R1–R3 argument
 * for the clamp shape below.
 *
 * `award` is that value — the previous board's subject-frame material fold on
 * the fold's own scale — and it is `null` whenever the flag is off or a guard
 * refused, which is what makes both expressions collapse term for term to the
 * ones that shipped: `X ? ((null !== null && Y) ? V : DEAD) : Z` is
 * `X ? DEAD : Z`. Nothing in `./mutual-wipe.ts` is even reached off the flag —
 * the environment is read only from inside a world where every team is gone.
 */
export function finish(
  ctx: EvalContext,
  evaluation: Evaluation,
  materialWeight: number = CLIFF_MATERIAL_WEIGHT
): PlanEvaluation {
  const { worst, best } = terminalVerdicts(ctx);

  const wipeWorst = worst.subjectGone && worst.othersGone;
  const wipeBest = best.subjectGone && best.othersGone;
  const award =
    wipeWorst || wipeBest ? mutualWipeAwardFor(ctx.sub, ctx.asTeam, materialWeight) : null;

  const lo = worst.subjectGone
    ? award !== null && worst.othersGone
      ? award
      : DEAD
    : worst.othersGone
      ? WIN
      : evaluation.total.lo;
  const hi = best.subjectGone
    ? award !== null && best.othersGone
      ? award
      : DEAD
    : best.othersGone
      ? WIN
      : evaluation.total.hi;

  if (award !== null) {
    // Endpoints this award actually moved off DEAD. Counted here rather than in
    // the module because only the clamp knows which end it changed.
    const c = mutualWipeCountersFor(ctx.sub);
    if (wipeWorst) c.movedLo += 1;
    if (wipeBest) c.movedHi += 1;
  }

  // Elimination in the BEST world implies elimination in the worst (our
  // best-world alive set contains our worst-world one), and a clean sweep in
  // the worst world implies one in the best. So the clamps can only ever
  // tighten an interval, never invert it — asserted rather than assumed. The
  // award preserves that: `lo = award` needs `worst.othersGone`, which implies
  // `best.othersGone`, so `hi` is either the same finite `award` or `WIN`, and
  // the award is finite.
  const clamped = clampTo(evaluation.total, Math.min(lo, hi), Math.max(lo, hi));

  const basis = ctx.resolution.state.field.assumptions();
  return {
    bound: {
      lo: clamped.lo,
      est: clampEst(evaluation.total.est, clamped.lo, clamped.hi),
      hi: clamped.hi,
    },
    parts: evaluation.parts,
    exact:
      evaluation.exact &&
      ctx.resolution.ledger.length === 0 &&
      basis.length === 0 &&
      clamped.lo === clamped.hi,
    basis,
    ledgerSize: ctx.resolution.ledger.length,
    terminal: {
      loClamped: worst.subjectGone || worst.othersGone,
      hiClamped: best.subjectGone || best.othersGone,
    },
  };
}

/** The evaluator with the calibrated profile — the TERRITORY profile, which is
 * what production runs. */
export const defaultEvaluator = new BoundEvaluator();

/** The same thing under the name that says what it carries. */
export const territoryEvaluator = defaultEvaluator;

/** A material-only evaluator: the reflex rung's, the differential's, and the
 * explicit fallback profile if territory ever has to be backed out. */
export const materialEvaluator = new BoundEvaluator(MATERIAL_ONLY_PROFILE);

/**
 * THE SLIDER-REPAIR PROFILE — territory plus the two terms the budget ladder's
 * replays say are missing, both gated on class properties so a board with no
 * piece on it scores identically to `territoryEvaluator`. See
 * `TERRITORY_SLIDER_PROFILE` for the measurement that motivates it.
 */
export const territorySliderEvaluator = new BoundEvaluator(TERRITORY_SLIDER_PROFILE);

/** The ablation arm — the repair with the royal exclusion lifted. Measured
 * against `territorySliderEvaluator`; never a production default. */
export const territorySliderRoyalEvaluator = new BoundEvaluator(
  TERRITORY_SLIDER_ROYAL_PROFILE
);
