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
import { DEAD, WIN, clampEst, clampTo, fold, meetClamps, type TerminalClamp } from './bound';
import type { Evaluation, Feature, Weights } from './bound';
import {
  DEFAULT_PROFILE,
  MATERIAL_ONLY_PROFILE,
  ROYAL_COMMAND_PROFILE,
} from './calibration';
import type { CriterionProfile } from './calibration';
import { FEATURES, makeContext, terminalVerdicts } from './features';
// model/terminal@1 — the OTHER half of the boundary (06 F-7). See terminal.ts.
import { capVerdicts } from './terminal';
import type { EvalContext } from './features';

export * from './bound';
export * from './calibration';
export {
  ADMISSION,
  FEATURES,
  budgetShare,
  buildArrivals,
  commandFeature,
  energyEconomyFeature,
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
export { NEVER, ShellTable, buildShells, earliestShells } from './shells';
export type { ShellRequest } from './shells';
export { partitionOf, tierAtTurn, workspaceFor } from './territory';
export { CONTEST_LOSS, contestFeature, contestField, winsContest } from './contest';
export type { ContestField } from './contest';
export { energyCostOf, energyFeature, tripOf } from './energy';
export { HUNGER_FLOOR, foodDistance, foodFeature } from './food';
export { IDLE_COST, REVERSAL_COST, momentumFeature } from './momentum';
export { PERIL_WEIGHT, potionFeature, tierFeature, tierIsLive } from './window';
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

  /**
   * ONE EVALUATION PER RESOLVED WORLD — the memo BELOW the metered door.
   *
   * WHAT AN EVALUATION IS A FUNCTION OF. Everything `makeContext` and the
   * fold read is (a) this evaluator — its profile, weights, features and
   * horizon, all fixed at construction; (b) the RESOLUTION object; (c)
   * `asTeam`; (d) the substrate FAMILY — grid, shape, roster, arrival turn,
   * geometry caches, all shared by a substrate and every modelled sibling of
   * it; and (e) exactly one view-dependent reading, `sub.perilOf()`. There is
   * no `claimsOf`, no `entangled` and no `modeled` anywhere in the fold —
   * audited, and the reason this cache can be keyed the way it is.
   *
   * WHY IT PAYS. `substrate.ts` now settles a plan once per FAMILY rather than
   * once per view, so the same resolution OBJECT reaches the evaluator from
   * every hold configuration the bank prices that plan under, and from the
   * runner's trace pricing as well. The bank's own evaluation memo
   * (`bounds/evalmemo.ts`) cannot collapse those: it namespaces on the view,
   * because the view is what it can see. This one is keyed on what the
   * evaluation actually depends on — the resolution, the peril set's identity
   * and the frame — so a repeat is a lookup. Measured on `mixed 20 1 --nodes`:
   * 72 068 evaluations over 45 942 distinct resolutions.
   *
   * IT DOES NOT MOVE THE CLOCK. The deterministic runner counts nodes at the
   * METERED WRAPPER, which is above this call and still runs once per call, so
   * the node budget spends exactly as it did — the work under it is what got
   * cheaper. `WeakMap`s keyed on the resolution and on the peril set, so an
   * entry dies with the settlement it describes and nothing outlives a
   * decision.
   */
  private readonly evaluations = new WeakMap<
    object,
    { peril: object; byTeam: Map<number, PlanEvaluation> }
  >();

  evaluatePlan(sub: Substrate, plan: JointPlan, asTeam: number): PlanEvaluation {
    if (!(sub instanceof EngineSubstrate)) {
      throw new TypeError(
        'the evaluator needs the engine substrate: the per-team fold and the claim ' +
          'field are not on the Substrate interface'
      );
    }
    return sub.withResolution(plan, asTeam, ({ resolution, bounds }) => {
      const peril = sub.perilOf() as object;
      let slot = this.evaluations.get(resolution as object);
      if (slot === undefined || slot.peril !== peril) {
        slot = { peril, byTeam: new Map<number, PlanEvaluation>() };
        this.evaluations.set(resolution as object, slot);
      }
      const hit = slot.byTeam.get(asTeam);
      if (hit !== undefined) return hit;
      const ctx = makeContext(
        sub,
        resolution,
        bounds,
        asTeam,
        this.profile.reachHorizonTurns,
        // One bag, carrying I1's royalReachers and I2's command /
        // energyReserveRatio. See makeContext's signature.
        this.profile
      );
      const evaluation: Evaluation = fold(this.features, ctx, this.weights);
      const made = finish(ctx, evaluation);
      slot.byTeam.set(asTeam, made);
      return made;
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
 *
 * THE COMMAND KNOBS ARE CHECKED THE SAME WAY, AND FOR THE SAME REASON. They
 * are the one part of a profile that is a number table and NOT the weight
 * table, they reach the fold through `EvalContext.command`, and a profile
 * assembled from a stored binding is a plain object that TypeScript never saw.
 * A knob left out reads `undefined`, `undefined * anything` is `NaN`, and a
 * `NaN` addend inside `Math.min(1, ...)` makes `c` NaN, which propagates
 * through the fold to a bound that compares false against everything — a
 * silent misconfiguration exactly like a forgotten weight, arriving by the
 * same door. A negative one is the other half: `scale` already refuses a
 * negative WEIGHT because it would flip which endpoint is the bound, and a
 * negative knob inside the clamp does the same thing one level down.
 */
export function checkWeights(
  profile: CriterionProfile,
  features: ReadonlyArray<Feature<EvalContext>>
): void {
  checkCommandKnobs(profile);
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

/** The numeric knobs of `CommandKnobs`, named once so adding one cannot forget
 *  to check it. `royal` is a flag and carries no arithmetic. */
const COMMAND_KNOB_KEYS = ['ground', 'food'] as const;

function checkCommandKnobs(profile: CriterionProfile): void {
  const knobs = profile.command;
  if (knobs === undefined) return;
  const bad: string[] = [];
  for (const key of COMMAND_KNOB_KEYS) {
    const v = knobs[key] as unknown;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) bad.push(`${key}=${String(v)}`);
  }
  if (bad.length === 0) return;
  throw new Error(
    `criterion profile "${profile.name}" has command knobs that are not finite and ` +
      `non-negative: ${bad.join(', ')} — every one of them multiplies a cell count ` +
      'inside the same clamp, so a missing or negative knob is a NaN or an inverted ' +
      'term in every piece evaluation on the board'
  );
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
  // THE OTHER HALF OF THE BOUNDARY (06 F-7). Elimination above, the turn cap
  // here, in the same ordering and by the same replacement — a game that ends
  // on the count has ended, and the fold has nothing to say about a board with
  // no next turn. `none` on every board but the last one, at the cost of one
  // comparison; a DRAW is `none` too, because a draw is neither lattice element
  // and replacing the interior value with either is the wash error again.
  const cap = capVerdicts(ctx);

  // EACH MEMBER STATES ITS OWN TWO ENDS, and a `null` is a silence rather than
  // a number: DEAD and "nothing to say about the floor" are both -Infinity, so
  // the two have to be different values or the silence becomes a claim.
  const elimination: TerminalClamp = {
    lo: worst.subjectGone ? DEAD : worst.othersGone ? WIN : null,
    hi: best.subjectGone ? DEAD : best.othersGone ? WIN : null,
  };
  const capClamp: TerminalClamp = {
    lo: cap.worst === 'loss' ? DEAD : cap.worst === 'win' ? WIN : null,
    hi: cap.best === 'loss' ? DEAD : cap.best === 'win' ? WIN : null,
  };

  // Elimination in the BEST world implies elimination in the worst (our
  // best-world alive set contains our worst-world one), and a clean sweep in
  // the worst world implies one in the best; each member's own pair is ordered
  // by its own proof. So the MEET of the two is ordered, and `clampTo` is
  // handed the pair AS GIVEN.
  //
  // WHAT USED TO BE HERE, AND WHY IT WAS THE BUG. The pair went through
  // `Math.min(lo, hi)` / `Math.max(lo, hi)` under a comment asserting the
  // clamps "can only ever tighten an interval, never invert it". That is true
  // of the elimination corners, whose worlds are ordered by inclusion, and it
  // was FALSE of the cap corners, which are read off two winner sets that are
  // not — `cap.worst === 'win'` (a WIN floor) could stand beside `cap.best ===
  // 'draw'` (no ceiling clamp at all, so `hi` stayed the INTERIOR ceiling), and
  // `Math.min` then handed the interior ceiling over as the floor. The plan
  // came back as `[interiorCeiling, +Infinity]`, a complete floor above another
  // rung's sound ceiling: 5,195 inversions over the twelve 30-turn gate arms
  // once the runner stated its cap. The cap's corners are ordered now
  // (`terminal.ts`), and the swap that hid the disorder is gone with them.
  const clamp = meetClamps(elimination, capClamp);
  const clamped = clampTo(evaluation.total, clamp);

  const basis = ctx.engineMaterial.assumptions;
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
    terminal: { loClamped: clamp.lo !== null, hiClamped: clamp.hi !== null },
  };
}

/** The evaluator with the calibrated profile — the TERRITORY profile, which is
 * what production runs. */
export const defaultEvaluator = new BoundEvaluator();

/** A material-only evaluator: the reflex rung's, the differential's, and the
 * explicit fallback profile if territory ever has to be backed out. */
export const materialEvaluator = new BoundEvaluator(MATERIAL_ONLY_PROFILE);

/** The ablation arm — the production profile with the royal exclusion lifted.
 * Measured against `defaultEvaluator`; never a production default. */
export const royalCommandEvaluator = new BoundEvaluator(ROYAL_COMMAND_PROFILE);
