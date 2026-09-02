/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/bounds.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// ScoreBounds, backup, dominance and the confidence surface — deliberation
// delta §4, §6 (guardrails) and §8.
//
// A branch's value under uncertainty is an INTERVAL [worst, best] with
// worst ≤ true ≤ best, provenance for the gap, and a BASIS: the assumption
// set its claims are conditional on. The two reference-searcher bugs the
// adversary found are corrected here BY CONSTRUCTION:
//
//   (i) interior-node backup takes {max lo, max hi} at a MAX node and
//       {min lo, min hi} at a MIN node — EACH BOUND IS ITS OWN GAME, never
//       one child's bounds copied wholesale (cand-g search.ts:497 was
//       unsound: it selected a child by lo and took its hi along);
//  (ii) comparing bounds with different assumption sets is a TYPED REFUSAL,
//       not a false — an aggressive narrowing must be impossible to mistake
//       for a proof (cand-g's thaw laundered an aggression prior into an
//       unconditional lo).
//
// DEAD is the lattice bottom (-Infinity), never a scalar sharing the
// heuristic's scale: a 40×40 room count exceeded −1000 and inverted the
// cliff. The cliff itself: worst scores "might die" exactly as "dies" — else
// confirming a feared death RAISES lo and pruning breaks.

import type { Trit } from "./risk.js";

export type AssumptionId = number;

/** The lattice bottom. A dead subject's value in the worst coordinate. */
export const DEAD = Number.NEGATIVE_INFINITY;

export interface GapAttribution {
  /** Gap owed to unexplored enemy replies. */
  readonly enemyChoice: number;
  /** Gap owed to cloud (frozen-unit) uncertainty. */
  readonly cloud: number;
  /** Gap owed to narrowing assumptions. */
  readonly assumption: number;
}

/**
 * NOTE — MARGINALS DO NOT COMPOSE (measured by the anytime workstream):
 * per-unit bounds are marginals, and summed per-unit regret does NOT cover
 * joint regret — more search can lower a team floor while every unit's own
 * floor rises. A TEAM-level guarantee requires the joint fold
 * (`teamValueBounds` over one consistent world reading, or exact mode);
 * summing independently-refined per-unit intervals is a heuristic, not a
 * bound. Same family as the per-unit tier-marginal caveat in the claims.
 */
export interface ScoreBounds {
  /** worst ≤ true ≤ best, both under the SAME world set. */
  readonly worst: number;
  readonly best: number;
  readonly gapBy: GapAttribution;
  /** Sorted unit ids whose claims were narrowed — the bounds' BASIS. */
  readonly assumptions: ReadonlyArray<AssumptionId>;
  /** worst === best and nothing contingent contributed. */
  readonly exact: boolean;
}

export function scoreBounds(
  worst: number,
  best: number,
  gapBy: Partial<GapAttribution> = {},
  assumptions: ReadonlyArray<AssumptionId> = [],
): ScoreBounds {
  if (best < worst) throw new Error(`inverted bounds: [${worst}, ${best}]`);
  return {
    worst,
    best,
    gapBy: {
      enemyChoice: gapBy.enemyChoice ?? 0,
      cloud: gapBy.cloud ?? 0,
      assumption: gapBy.assumption ?? 0,
    },
    assumptions: [...assumptions].sort((a, b) => a - b),
    exact: worst === best && assumptions.length === 0,
  };
}

export const UNKNOWN_BOUNDS: ScoreBounds = scoreBounds(DEAD, Number.POSITIVE_INFINITY, {
  cloud: Number.POSITIVE_INFINITY,
});

function sameBasis(a: ScoreBounds, b: ScoreBounds): boolean {
  if (a.assumptions.length !== b.assumptions.length) return false;
  for (let i = 0; i < a.assumptions.length; i++) {
    if (a.assumptions[i] !== b.assumptions[i]) return false;
  }
  return true;
}

function mergeGap(children: ReadonlyArray<ScoreBounds>): GapAttribution {
  let enemyChoice = 0;
  let cloud = 0;
  let assumption = 0;
  for (const c of children) {
    enemyChoice = Math.max(enemyChoice, c.gapBy.enemyChoice);
    cloud = Math.max(cloud, c.gapBy.cloud);
    assumption = Math.max(assumption, c.gapBy.assumption);
  }
  return { enemyChoice, cloud, assumption };
}

function unionBasis(children: ReadonlyArray<ScoreBounds>): AssumptionId[] {
  const s = new Set<AssumptionId>();
  for (const c of children) for (const a of c.assumptions) s.add(a);
  return [...s].sort((a, b) => a - b);
}

/**
 * MAX-node backup: {max lo, max hi} — each bound its own game. The lo of the
 * best-lo child and the hi of the best-hi child need not be the same child.
 */
export function backupMax(children: ReadonlyArray<ScoreBounds>): ScoreBounds {
  if (children.length === 0) throw new Error("backupMax over no children");
  let lo = DEAD;
  let hi = DEAD;
  for (const c of children) {
    if (c.worst > lo) lo = c.worst;
    if (c.best > hi) hi = c.best;
  }
  return {
    worst: lo,
    best: hi,
    gapBy: mergeGap(children),
    assumptions: unionBasis(children),
    exact: children.every((c) => c.exact) && lo === hi,
  };
}

/** MIN-node backup: {min lo, min hi} — the dual, same discipline. */
export function backupMin(children: ReadonlyArray<ScoreBounds>): ScoreBounds {
  if (children.length === 0) throw new Error("backupMin over no children");
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  for (const c of children) {
    if (c.worst < lo) lo = c.worst;
    if (c.best < hi) hi = c.best;
  }
  return {
    worst: lo,
    best: hi,
    gapBy: mergeGap(children),
    assumptions: unionBasis(children),
    exact: children.every((c) => c.exact) && lo === hi,
  };
}

/**
 * Simultaneous-node backup over the joint matrix (rows: our options, columns:
 * theirs): lo = maximin over the lo-matrix, hi = minimax over the hi-matrix.
 * Sound without an LP: both bounds quantify over the same world set,
 * separately (delta §4).
 */
export function backupSimultaneous(matrix: ReadonlyArray<ReadonlyArray<ScoreBounds>>): ScoreBounds {
  if (matrix.length === 0 || matrix.some((r) => r.length === 0)) {
    throw new Error("backupSimultaneous over an empty matrix");
  }
  let lo = DEAD;
  for (const row of matrix) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (const c of row) rowMin = Math.min(rowMin, c.worst);
    lo = Math.max(lo, rowMin);
  }
  let hi = Number.POSITIVE_INFINITY;
  const columns = (matrix[0] as ReadonlyArray<ScoreBounds>).length;
  for (let j = 0; j < columns; j++) {
    let colMax = DEAD;
    for (const row of matrix) colMax = Math.max(colMax, (row[j] as ScoreBounds).best);
    hi = Math.min(hi, colMax);
  }
  const flat = matrix.flat();
  // maximin(lo) ≤ maximin(hi) ≤ minimax(hi), entrywise lo ≤ hi — so the
  // interval is well-formed by construction.
  return {
    worst: lo,
    best: hi,
    gapBy: mergeGap(flat),
    assumptions: unionBasis(flat),
    exact: false,
  };
}

/**
 * DECLARE A MIN-SIDE RESTRICTION (orchestration demand). The one-sided
 * narrowing lemma: restricting OUR options only lowers what we can prove —
 * the floor stays a floor, no assumption needed. Restricting THEIRS (a top-k
 * enemy candidate cap, a combo cap, a per-ply schedule that skips enemy
 * replies) is an ASSUMPTION: the true worst may live in the discarded
 * options, so the bounds must carry it or the searcher launders a cap into a
 * proof. Every engine-level narrowing already rides the basis
 * (CloudField.withNarrowed); this is the SAME declaration for restrictions
 * the search loop imposes on its own — the API makes the declared path the
 * only path to a comparable bound, because dominance and confidence refuse
 * mixed bases.
 */
export function declareMinSideRestriction(
  bounds: ScoreBounds,
  restriction: AssumptionId,
): ScoreBounds {
  if (bounds.assumptions.includes(restriction)) return bounds;
  return {
    ...bounds,
    assumptions: [...bounds.assumptions, restriction].sort((a, b) => a - b),
    gapBy: {
      ...bounds.gapBy,
      assumption: Math.max(bounds.gapBy.assumption, bounds.best - bounds.worst),
    },
    exact: false,
  };
}

/**
 * Dominance with BASIS IDENTITY (delta §4): comparing bounds whose assumption
 * sets differ is a typed refusal, never a false. Sound given true ∈ [lo, hi]
 * and contraction-only refinement; cross-branch correlation is the
 * rectangular relaxation, which is never optimistic.
 */
export type DominanceVerdict =
  | { readonly comparable: true; readonly dominated: boolean }
  | {
      readonly comparable: false;
      readonly refusal: "basis_mismatch";
      readonly left: ReadonlyArray<AssumptionId>;
      readonly right: ReadonlyArray<AssumptionId>;
    };

/** Is `candidate` dominated by `by` — safe to discard? hi(c) ≤ lo(by). */
export function dominance(candidate: ScoreBounds, by: ScoreBounds): DominanceVerdict {
  if (!sameBasis(candidate, by)) {
    return {
      comparable: false,
      refusal: "basis_mismatch",
      left: candidate.assumptions,
      right: by.assumptions,
    };
  }
  return { comparable: true, dominated: candidate.best <= by.worst };
}

// ---------------------------------------------------------------------------
// The evaluation fold — monotone and separable in per-unit coordinates
// ---------------------------------------------------------------------------

/**
 * One unit's contribution to a team's value, as the risk layer bounds it.
 * `aliveWorst`/`aliveBest` bracket survival; weight is an interval; the
 * PARTIAL-LOSS coordinate carries sever-only risk so a trail unit's possible
 * sever does not cost its whole weight in `worst` (delta §4).
 */
export interface UnitValueBounds {
  readonly unitId: number;
  readonly team: number;
  readonly survival: Trit;
  readonly weightMin: number;
  readonly weightMax: number;
  /** Weight that could be lost WITHOUT death (severs). 0 for stacks. */
  readonly partialLossMax: number;
}

/**
 * The default separable evaluation: a team's value is Σ over its units of
 * (alive × weight), folded at interval endpoints. Monotone per coordinate —
 * which is what makes the fold's bounds true bounds:
 *
 *   worst: dead-if-possible, weightMin − partialLossMax when it survives;
 *   best : alive-if-possible, weightMax intact.
 *
 * THE CLIFF: worst scores "might die" exactly as "dies" (survival ≠ yes ⇒ the
 * unit contributes nothing to worst) — a graded penalty here would make lo
 * FALL when a feared death is merely confirmed, breaking monotone refinement.
 * A whole-team worst of nothing is still a number; the subject's OWN death is
 * the caller's DEAD bottom, applied where the subject is known.
 *
 * DENOMINATE THE CLIFF IN THE MATERIAL THE DEATH LOSES, never a fixed scalar:
 * a fixed death-penalty makes CERTAIN death cheaper than possible death — the
 * dead unit's cliff stops firing next position while the live-but-threatened
 * one keeps paying it (a live bug the heuristics workstream hit). Here the
 * cliff IS the unit's weight contribution going to zero, which scales with
 * exactly what the death costs.
 */
export function teamValueBounds(
  units: ReadonlyArray<UnitValueBounds>,
  team: number,
): { worst: number; best: number } {
  let worst = 0;
  let best = 0;
  for (const u of units) {
    if (u.team !== team) continue;
    if (u.survival === "yes") {
      worst += Math.max(0, u.weightMin - u.partialLossMax);
    }
    // survival maybe/no contributes 0 to worst — the cliff.
    if (u.survival !== "no") best += u.weightMax;
  }
  return { worst, best };
}

/**
 * THE PESSIMISM SCOPE (Bot B's demand). Worst-case is worst FOR A DECLARED
 * SUBJECT — adjudicating EVERY participant at its own worst endpoint kills
 * the enemy's movers too, which is the subject's BEST case wearing its worst
 * case's clothes (this silently broke a bot's floor). Endpoint selection
 * flips per participant relative to the subject:
 *
 *   scoring the SUBJECT's own team → worst drops its maybes (the cliff),
 *   best keeps them;
 *   scoring an OPPOSING team IN THE SUBJECT'S FRAME → the subject's worst
 *   world is the one where the enemy THRIVES: worst prices enemy maybes
 *   alive at weightMax with no partial loss; best prices them at the cliff.
 *
 * The risk layer's verdicts are frame-neutral trits; this fold is where the
 * frame is applied — never inside adjudication.
 */
export function scopedTeamValueBounds(
  units: ReadonlyArray<UnitValueBounds>,
  scoringTeam: number,
  subjectTeam: number,
): { worst: number; best: number } {
  if (scoringTeam === subjectTeam) return teamValueBounds(units, scoringTeam);
  let subjectWorst = 0; // enemy at its best
  let subjectBest = 0; // enemy at its worst
  for (const u of units) {
    if (u.team !== scoringTeam) continue;
    if (u.survival !== "no") subjectWorst += u.weightMax;
    if (u.survival === "yes") subjectBest += Math.max(0, u.weightMin - u.partialLossMax);
  }
  return { worst: subjectWorst, best: subjectBest };
}

/**
 * Guard for caller-supplied heuristics: the fold is sound only for monotone,
 * separable evaluations over per-unit (alive × weight) coordinates. A
 * non-separable heuristic must be REJECTED — the honest fallback is the
 * trivial bounds, never a guessed interval (delta §4).
 */
export interface SeparableEvaluation {
  readonly separable: true;
  readonly unitValue: (u: UnitValueBounds) => { worst: number; best: number };
}

export function evaluateOrReject(
  evaluation: {
    readonly separable: boolean;
    readonly unitValue?: (u: UnitValueBounds) => { worst: number; best: number };
  },
  units: ReadonlyArray<UnitValueBounds>,
  team: number,
): { worst: number; best: number } {
  if (evaluation.separable !== true || evaluation.unitValue === undefined) {
    return { worst: DEAD, best: Number.POSITIVE_INFINITY };
  }
  let worst = 0;
  let best = 0;
  for (const u of units) {
    if (u.team !== team) continue;
    const v = evaluation.unitValue(u);
    if (v.best < v.worst) return { worst: DEAD, best: Number.POSITIVE_INFINITY };
    worst += v.worst;
    best += v.best;
  }
  return { worst, best };
}

// ---------------------------------------------------------------------------
// Confidence and the saturation guardrails — delta §6, §8
// ---------------------------------------------------------------------------

export interface CandidateReport {
  readonly id: number;
  readonly bounds: ScoreBounds;
  /** Arrival/cost gradient value used for saturated ordering (lower = nearer). */
  readonly gradient: number;
}

export interface ConfidenceReport {
  readonly best: number | null;
  /** margin = lo(best) − max hi(others); decisive ⟺ margin ≥ 0. */
  readonly margin: number;
  readonly decisive: boolean;
  /** Candidates whose hi still exceeds lo(best). */
  readonly contestants: ReadonlyArray<number>;
  /** Per-candidate regret (hi − lo): what a refinement could still buy. */
  readonly regret: ReadonlyArray<{ readonly id: number; readonly regret: number }>;
  readonly gapBy: GapAttribution;
  /**
   * SATURATION SENTINEL, distinct from budget exhaustion: the lo spread
   * across candidates is zero, so ordering fell back to the arrival/cost
   * GRADIENT — never to hi (a hi tie-break silently flips a worst-case search
   * into a best-case one). A paranoid-by-saturation answer is labelled.
   */
  readonly paranoidBySaturation: boolean;
}

export function confidence(candidates: ReadonlyArray<CandidateReport>): ConfidenceReport {
  if (candidates.length === 0) {
    return {
      best: null,
      margin: DEAD,
      decisive: false,
      contestants: [],
      regret: [],
      gapBy: { enemyChoice: 0, cloud: 0, assumption: 0 },
      paranoidBySaturation: false,
    };
  }
  const basis = candidates[0] as CandidateReport;
  for (const c of candidates) {
    const v = dominance(c.bounds, basis.bounds);
    if (!v.comparable) {
      throw new Error(
        `confidence over mixed bases: candidate ${c.id} assumes [${c.bounds.assumptions}] vs [${basis.bounds.assumptions}] — refine to a common basis first`,
      );
    }
  }
  let loMax = DEAD;
  let loMin = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    loMax = Math.max(loMax, c.bounds.worst);
    loMin = Math.min(loMin, c.bounds.worst);
  }
  const saturated = candidates.length > 1 && loMax === loMin;
  // Ordering: by lo; on a zero lo-spread, by the GRADIENT — never by hi.
  const ranked = [...candidates].sort((a, b) =>
    saturated
      ? a.gradient - b.gradient || a.id - b.id
      : b.bounds.worst - a.bounds.worst || a.id - b.id,
  );
  const best = ranked[0] as CandidateReport;
  let othersHi = DEAD;
  for (const c of candidates) {
    if (c.id === best.id) continue;
    othersHi = Math.max(othersHi, c.bounds.best);
  }
  const margin = candidates.length === 1 ? Number.POSITIVE_INFINITY : best.bounds.worst - othersHi;
  return {
    best: best.id,
    margin,
    decisive: margin >= 0,
    contestants: candidates
      .filter((c) => c.id !== best.id && c.bounds.best > best.bounds.worst)
      .map((c) => c.id),
    regret: candidates.map((c) => ({ id: c.id, regret: c.bounds.best - c.bounds.worst })),
    gapBy: mergeGap(candidates.map((c) => c.bounds)),
    paranoidBySaturation: saturated,
  };
}
