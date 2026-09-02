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
  FeatureContribution,
  JointPlan,
  PlanEvaluation as ContractPlanEvaluation,
  PlanExplanation,
} from '../contracts';
import { EngineSubstrate } from '../substrate';
import type { Substrate } from '../contracts';
import { DEAD, WIN, clampEst, clampTo, fold } from './bound';
import type { Evaluation, Feature, Weights } from './bound';
import {
  DEFAULT_PROFILE,
  MATERIAL_ONLY_PROFILE,
  ROYAL_COMMAND_PROFILE,
} from './calibration';
import type { CriterionProfile } from './calibration';
import { FEATURES, makeContext, terminalVerdicts } from './features';
import type { EvalContext } from './features';

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
export { CONTEST_LOSS, contestFeature, contestField, winsContest } from './contest';
export type { ContestField } from './contest';
export { HUNGER_FLOOR, foodDistance, foodFeature } from './food';
export { IDLE_COST, REVERSAL_COST, momentumFeature } from './momentum';
export { tierFeature, tierIsLive } from './tier';
export type { Admission, Partition, TrailRoom } from './territory';
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
  private readonly weights: Weights;

  constructor(
    profile: CriterionProfile = DEFAULT_PROFILE,
    features: ReadonlyArray<Feature<EvalContext>> = FEATURES
  ) {
    checkWeights(profile, features);
    this.profile = profile;
    this.features = features;
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
    return `BoundEvaluator(${structuralIdentity(this.profile)})`;
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
      return finish(ctx, evaluation);
    });
  }

  /**
   * THE EXPLAIN SURFACE. One evaluation, then the fold's own `parts` paired
   * with the weights that folded them — so a reader sees `value × weight =
   * contribution` per feature and can name the term that carried the verdict.
   *
   * NOT ON THE HOT PATH, and it does not open a second one: it re-uses
   * `evaluatePlan` rather than re-deriving anything, so an explained candidate
   * is priced by exactly the pipeline that priced the decision. The weight
   * read is `weights[key] ?? feature.defaultWeight` — the same expression
   * `fold` uses, because reporting a weight the fold did not apply would be a
   * breakdown that does not add up to its own total.
   */
  explainPlan(sub: Substrate, plan: JointPlan, asTeam: number): PlanExplanation {
    const evaluation = this.evaluatePlan(sub, plan, asTeam);
    const features: FeatureContribution[] = [];
    for (const feature of this.features) {
      const value = evaluation.parts[feature.key];
      if (value === undefined) continue;
      const weight = this.weights[feature.key] ?? feature.defaultWeight;
      features.push({
        key: feature.key,
        value,
        weight,
        contribution: { lo: value.lo * weight, est: value.est * weight, hi: value.hi * weight },
      });
    }
    return {
      profile: this.profile.name,
      bound: evaluation.bound,
      features,
      exact: evaluation.exact,
      ledgerSize: evaluation.ledgerSize,
    };
  }
}

/**
 * A PROFILE MUST NAME EVERY FEATURE IT FOLDS, AND NOTHING ELSE.
 *
 * `fold` reads `weights[f.key] ?? f.defaultWeight`, so a weight a profile
 * forgets is not zero — it is whatever the feature author chose, silently, for
 * a profile that has never heard of the feature. That is not hypothetical: the
 * material-only profile and both closing arms are hand-written weight tables,
 * and the moment two features were added to `FEATURES` all three of them
 * quietly began folding terms they were built to exclude. The admission laws
 * caught it, which is luck — a profile that stayed sound would simply have been
 * measuring something other than what its name says.
 *
 * A key with no feature is the same defect read from the other end: a typo in a
 * weight table is a number that does nothing, and nothing anywhere says so.
 *
 * So both directions are refused, at construction, where the cheapest possible
 * check turns a silent misconfiguration into a startup failure that names the
 * key. Every shipped profile passes; a caller assembling one for an experiment
 * finds out immediately.
 */
export function checkWeights(
  profile: CriterionProfile,
  features: ReadonlyArray<Feature<EvalContext>>
): void {
  const folded = new Set(features.map((f) => f.key));
  const named = new Set(Object.keys(profile.weights));
  const missing: string[] = [];
  for (const key of folded) if (!named.has(key)) missing.push(key);
  const unknown: string[] = [];
  for (const key of named) if (!folded.has(key)) unknown.push(key);
  if (missing.length === 0 && unknown.length === 0) return;
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      `does not name ${missing.sort().join(', ')} — each would silently fold at its ` +
        "feature's own defaultWeight"
    );
  }
  if (unknown.length > 0) {
    parts.push(`names ${unknown.sort().join(', ')}, which this fold has no feature for`);
  }
  throw new Error(`criterion profile "${profile.name}" ${parts.join('; and it ')}`);
}

/**
 * The clamp step, kept separate so the law harness can exercise it directly.
 *
 * ORDERING, AND WHY IT IS NOT A SUM. Our own elimination is checked before
 * anyone else's, in each reading independently. Adding a "my team wiped" term to
 * a "their team wiped" term lets the two cancel, and a mutual annihilation then
 * scores as a wash — which is how an evaluator ends up trading its own last unit
 * for the opponent's. It is not a wash: it is a loss.
 */
export function finish(ctx: EvalContext, evaluation: Evaluation): PlanEvaluation {
  const { worst, best } = terminalVerdicts(ctx);

  const lo = worst.subjectGone ? DEAD : worst.othersGone ? WIN : evaluation.total.lo;
  const hi = best.subjectGone ? DEAD : best.othersGone ? WIN : evaluation.total.hi;

  // Elimination in the BEST world implies elimination in the worst (our
  // best-world alive set contains our worst-world one), and a clean sweep in
  // the worst world implies one in the best. So the clamps can only ever
  // tighten an interval, never invert it — asserted rather than assumed.
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

/** The ablation arm — the production profile with the royal exclusion lifted.
 * Measured against `defaultEvaluator`; never a production default. */
export const royalCommandEvaluator = new BoundEvaluator(ROYAL_COMMAND_PROFILE);
