/**
 * THE BOUND ALGEBRA AND THE FEATURE ADMISSION CONTRACT.
 *
 * A heuristic that returns one number with no bound story cannot be folded into
 * a search whose verdicts are [worst, best]. This module is where that is made
 * non-negotiable: a `Feature` cannot be declared without stating, for each
 * uncertain input it reads, which way it is monotone in that input — and the
 * law harness (./laws.ts) verifies the three laws by brute force over the
 * actual world set rather than by inspection of the code.
 *
 *   R1 SOUNDNESS     for every world w consistent with the partial state,
 *                    lo ≤ f(w) ≤ hi.
 *   R2 MONOTONICITY  if P′ refines P (strictly fewer worlds), lo′ ≥ lo and
 *                    hi′ ≤ hi. The interval only ever shrinks.
 *   R3 COLLAPSE      when P has exactly one world, lo === est === hi.
 *
 * R2 is the one that earns its keep: it is exactly what makes the search's
 * decisive test valid. If `hi[m] ≤ lo[best]` then no amount of further
 * refinement can make candidate m beat `best` — the branch is dead WITHOUT
 * having been simulated. Without R2 that test is a guess.
 *
 * ── WHY THE THIRD NUMBER ───────────────────────────────────────────────────
 *
 * `est` is the consumer-policy point estimate, constrained only by
 * lo ≤ est ≤ hi. Splitting it out is the design's load-bearing move: a
 * gradient-rich number that orders moves well is NOT a sound bound, and a sound
 * bound is too blunt to order moves — the death cliff ties every candidate that
 * might die. Making one number do both is what makes a heuristic incompatible
 * with a worst-case search.
 *
 * `est` NEVER ADJUDICATES. Floors compare `lo`, ceilings compare `hi`, and
 * `est` orders moves among floor ties. Nothing in this library reads `est` to
 * decide anything, and nothing above it may either.
 *
 * ── THE CLIFF ──────────────────────────────────────────────────────────────
 *
 * A feature representing a catastrophe scores "might die" in `lo` EXACTLY as it
 * scores "dies", because the worst case of might-die IS die. A graded penalty
 * reads better and is wrong: it makes `lo` FALL when a feared death is merely
 * confirmed by simulation, which violates R2 and quietly turns a worst-case
 * search into one that is optimistic about its own survival.
 *
 * ── THE TWO LATTICE ENDS ───────────────────────────────────────────────────
 *
 * DEAD and WIN are LATTICE ELEMENTS, never scalars sharing the heuristic's
 * scale. A large finite death penalty inverts the cliff the moment some other
 * term outgrows it (a 40×40 room count exceeding −1000 did exactly that), and
 * it makes terminal states tradeable against material, which they are not.
 * They enter by MEET and JOIN, never by addition — see `clampTo`.
 */


import type { Bound } from '../contracts';

export type { Bound };

/** The lattice bottom: our team is gone. */
export const DEAD: number = Number.NEGATIVE_INFINITY;
/** The lattice top: every other team is gone. */
export const WIN: number = Number.POSITIVE_INFINITY;

export const bound = (lo: number, est: number, hi: number): Bound => ({ lo, est, hi });

/** A determinate answer: no world-dependence at all. */
export const point = (v: number): Bound => ({ lo: v, est: v, hi: v });

export const ZERO: Bound = point(0);

export const isPoint = (a: Bound, eps = 1e-9): boolean =>
  a.lo === a.hi || Math.abs(a.hi - a.lo) <= eps;

export const add = (a: Bound, b: Bound): Bound =>
  bound(a.lo + b.lo, a.est + b.est, a.hi + b.hi);

/**
 * Weights are non-negative by contract, so the fold is a straight interval sum
 * with no sign gymnastics: a PENALTY feature returns negative numbers itself
 * rather than being negated by its weight. A negative weight would flip which
 * endpoint is the bound and silently unsound the whole fold.
 */
export const scale = (a: Bound, k: number): Bound => {
  if (k < 0) {
    throw new Error('feature weights must be non-negative; put the sign inside the feature');
  }
  return bound(a.lo * k, a.est * k, a.hi * k);
};

/** Sound negation: the interval flips end for end. */
export const negate = (a: Bound): Bound => bound(-a.hi, -a.est, -a.lo);

/** Union of the possible: widens. Used when extremizing a non-monotone input. */
export const join = (a: Bound, b: Bound): Bound =>
  bound(Math.min(a.lo, b.lo), (a.est + b.est) / 2, Math.max(a.hi, b.hi));

/**
 * Put `est` back inside `[lo, hi]`. Written so that an infinite end behaves:
 * with lo = DEAD and hi = WIN the estimate passes through untouched, and with
 * both ends at the same lattice element the estimate becomes it. A finite `e`
 * is required, so no arithmetic ever produces NaN from ∞ − ∞.
 */
export const clampEst = (e: number, lo: number, hi: number): number => {
  const finite = Number.isFinite(e) ? e : 0;
  return Math.min(Math.max(finite, lo), hi);
};

/**
 * Replace the ends with lattice elements, ORDERED, never added.
 *
 * The ordering is the rules' own: a team whose last unit dies has lost,
 * WHATEVER happened to anyone else. Scoring the two terminal outcomes
 * additively makes them cancel, and a mutual annihilation then reads as a wash
 * — which is how an evaluator ends up trading its own last unit for the
 * opponent's. So the caller passes the two verdicts already ordered, and this
 * function only refuses to let an inverted interval out.
 */
export const clampTo = (total: Bound, lo: number, hi: number): Bound => {
  if (hi < lo) {
    throw new Error(`terminal clamps inverted the interval: [${lo}, ${hi}]`);
  }
  return bound(lo, clampEst(total.est, lo, hi), hi);
};

// ---------------------------------------------------------------------------
// The admission contract
// ---------------------------------------------------------------------------

/** The uncertain inputs a feature may read. Naming them is the admission fee. */
export type UncertainInput =
  | 'maybe-head-presence'
  | 'maybe-body-presence'
  | 'held-weight'
  | 'held-tier'
  | 'held-arrival'
  | 'held-energy'
  | 'contingent-survival';

export interface BoundContract {
  /** Uncertain inputs read, and the direction the feature moves in each. */
  readonly reads: ReadonlyArray<{
    readonly input: UncertainInput;
    readonly monotone: 'up' | 'down' | 'extremized';
  }>;
  /** True when the feature is a catastrophe cliff: `lo` must jump, never slide. */
  readonly cliff: boolean;
  /**
   * True when the feature collapses to a point the moment nothing is held. This
   * is the discharge theorem's local form: an empty ledger proves the subtree is
   * exact, and it must be VISIBLE as lo === hi rather than merely believed.
   */
  readonly dischargeable: boolean;
}

export interface Feature<C> {
  readonly key: string;
  readonly defaultWeight: number;
  readonly contract: BoundContract;
  /** MUST return lo ≤ est ≤ hi. Enforced by `evaluateFeature`. */
  evaluate(ctx: C): Bound;
}

export function evaluateFeature<C>(f: Feature<C>, ctx: C): Bound {
  const b = f.evaluate(ctx);
  if (!(b.lo <= b.est + 1e-9) || !(b.est <= b.hi + 1e-9)) {
    throw new Error(`feature ${f.key} violated lo <= est <= hi: ${JSON.stringify(b)}`);
  }
  return b;
}

export type Weights = Readonly<Record<string, number>>;

export interface Evaluation {
  readonly total: Bound;
  readonly parts: Readonly<Record<string, Bound>>;
  /** True when every feature collapsed: the position's value is exact. */
  readonly exact: boolean;
}

/**
 * The fold. A non-negatively weighted sum of monotone-bounded features is
 * itself monotone-bounded, so R1–R3 lift to the total for free — which is the
 * only reason demanding a per-feature contract is worth anything.
 */
export function fold<C>(
  features: ReadonlyArray<Feature<C>>,
  ctx: C,
  weights?: Weights
): Evaluation {
  let total = ZERO;
  const parts: Record<string, Bound> = {};
  for (const f of features) {
    const w = weights?.[f.key] ?? f.defaultWeight;
    const b = evaluateFeature(f, ctx);
    parts[f.key] = b;
    if (w !== 0) total = add(total, scale(b, w));
  }
  return { total, parts, exact: isPoint(total, 1e-6) };
}
