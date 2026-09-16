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

/** Union of the possible: widens. Used when extremizing a non-monotone input. */
export const join = (a: Bound, b: Bound): Bound =>
  bound(Math.min(a.lo, b.lo), (a.est + b.est) / 2, Math.max(a.hi, b.hi));

/**
 * The two-reading envelope: which endpoint is which is a property of the
 * term's sign, not of the reading, so the constructor decides it.
 */
export const envelope = (a: number, b: number): Bound => bound(Math.min(a, b), (a + b) / 2, Math.max(a, b));

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
 * WHAT A TERMINAL MEMBER SAYS ABOUT ONE READING, and the silence that is not a
 * number.
 *
 * A member that reads the boundary answers per READING — the worst-case world
 * and the best-case one — and each answer is either the lattice element that
 * world is WORTH (`DEAD`, `WIN`) or nothing at all. `null` is the nothing, and
 * it is a distinct value rather than a sentinel number because DEAD and "no
 * floor to state" are both `-Infinity`: collapsing them is exactly how a
 * silence becomes a claim.
 *
 * `lo` is the worst reading's value and `hi` the best reading's, and a member
 * MUST hand them over already ordered (`lo <= hi` where both speak). That is
 * not a convenience: the two are a floor and a ceiling over the same set of
 * completion worlds, so an unordered pair is a member that has contradicted
 * itself, and no reordering here can turn it back into a bound — see
 * `docs/design/TERMINAL-SOUND.md` for what `Math.min`/`Math.max` did instead.
 */
export interface TerminalClamp {
  /** The worst reading's terminal value, or null where it has none to state. */
  readonly lo: number | null;
  /** The best reading's terminal value, or null where it has none to state. */
  readonly hi: number | null;
}

/** A member with nothing to say about either end. */
export const NO_CLAMP: TerminalClamp = { lo: null, hi: null };

/**
 * MEET the terminal readings of two independent members of the SAME board.
 *
 * Per side: a member that is silent yields to one that speaks, and where both
 * speak the result CONTAINS both claims — the lower floor, the higher ceiling.
 * That direction is the load-bearing one. Two sound members of the same board
 * cannot disagree (elimination and the turn cap both read the same
 * adjudication, and a team that is gone is not the sole winner of anything), so
 * a disagreement is a defect somewhere, and the only combination that cannot
 * MANUFACTURE a bound out of one is the widening one. Narrowing on a
 * disagreement is how a ceiling ends up standing in for a floor.
 */
export const meetClamps = (a: TerminalClamp, b: TerminalClamp): TerminalClamp => ({
  lo: a.lo === null ? b.lo : b.lo === null ? a.lo : Math.min(a.lo, b.lo),
  hi: a.hi === null ? b.hi : b.hi === null ? a.hi : Math.max(a.hi, b.hi),
});

/**
 * Replace the ends the terminal members SPOKE FOR with their lattice elements,
 * ORDERED, never added, and never crossed.
 *
 * The ordering is the rules' own: a team whose last unit dies has lost,
 * WHATEVER happened to anyone else. Scoring the two terminal outcomes
 * additively makes them cancel, and a mutual annihilation then reads as a wash
 * — which is how an evaluator ends up trading its own last unit for the
 * opponent's.
 *
 * A REPLACEMENT AND NOT AN INTERSECTION WITH `total`, because the interior fold
 * is defined only in the interior: on a board that has ENDED its number is not
 * a bound on anything, so meeting with it would keep a floor no world stands
 * under. A side the clamp is SILENT on is the other case, and there the
 * interior endpoint is all there is — that is the meet, and it is why `lo` can
 * only ever be a lattice element or the interior FLOOR, and `hi` a lattice
 * element or the interior CEILING. An interior ceiling can no longer reach the
 * floor by any path through this function.
 *
 * An inverted pair throws. It is a member contradicting itself about the same
 * world set, the fatal bug class the bank exists to catch, and there is no
 * repair for it here that is not a guess.
 */
export const clampTo = (total: Bound, clamp: TerminalClamp): Bound => {
  const lo = clamp.lo ?? total.lo;
  const hi = clamp.hi ?? total.hi;
  if (hi < lo) {
    throw new Error(
      `terminal clamps inverted the interval: [${lo}, ${hi}] ` +
        `(clamp [${String(clamp.lo)}, ${String(clamp.hi)}], interior [${total.lo}, ${total.hi}])`
    );
  }
  return bound(lo, clampEst(total.est, lo, hi), hi);
};

/**
 * A term that is a mean over OUR live, non-held units of a per-unit signed
 * reading, folded so a dead unit can never invert the bracket.
 *
 * ── THE ALIVE-SET POLARITY RULE, STATED HERE AND NOWHERE ELSE ───────────────
 *
 * Costs over the SUPERSET, credits over the subset, in the worst reading; the
 * other way round in the best — a dead unit contributes nothing to either
 * accumulator, whichever reading killed it. Our best world keeps a superset of
 * the units our worst world keeps, so that bracket contains every world between
 * the two and cannot invert, whatever sign the per-unit reading carries.
 * `valueOf` returns `[lo, hi]` for one unit; a term that is never positive (a
 * straight cost) passes `[-cost, -cost]`, which is the special case of the
 * signed rule below. Every member that means this inherits it from this
 * signature rather than restating it in a paragraph of its own.
 *
 * `gate`, when given, may zero the whole term even though `ours` is
 * non-empty — the board has nothing the term can price at all, not merely
 * nothing that costs anything this decision.
 *
 * `aliveOf` names the pair of worlds a unit's reading is PAID IN, which is not
 * always the pair the unit survives in: where the rules pay a reading only if
 * some OTHER unit also lives — a pickup's credit and its cost both die with the
 * collector — the pair is conjoined with that unit's. The default is the unit's
 * own survival. A conjunction is the only admissible shape: a reading paid in
 * MORE worlds than the unit lives in is exactly the inversion this fold exists
 * to refuse.
 */
export function ourUnitTerm<S extends { readonly team: number; readonly held: boolean; readonly bestAlive: boolean; readonly worstAlive: boolean }>(
  ctx: { readonly asTeam: number; readonly standing: ReadonlyArray<S> },
  valueOf: (s: S) => readonly [lo: number, hi: number],
  gate?: (ctx: { readonly asTeam: number; readonly standing: ReadonlyArray<S> }, ours: ReadonlyArray<S>) => boolean,
  aliveOf?: (s: S) => readonly [best: boolean, worst: boolean]
): Bound {
  const ours: S[] = [];
  for (const s of ctx.standing) if (s.team === ctx.asTeam && !s.held) ours.push(s);
  if (ours.length === 0) return point(0);
  if (gate !== undefined && !gate(ctx, ours)) return point(0);

  let worst = 0;
  let best = 0;
  for (const s of ours) {
    // The SKIP is the unit's own survival and never the conditioned pair: a
    // unit gone from both readings prices nothing, and one whose payer is gone
    // still has a reading to be paid zero of.
    if (!s.bestAlive && !s.worstAlive) continue;
    const [vLo, vHi] = valueOf(s);
    // Not `aliveOf?.(s) ?? [s.bestAlive, s.worstAlive]`: the default must not
    // allocate a pair per unit per node in the hottest loop in the fold.
    const paid = aliveOf === undefined ? undefined : aliveOf(s);
    const paidBest = paid === undefined ? s.bestAlive : paid[0];
    const paidWorst = paid === undefined ? s.worstAlive : paid[1];
    if (vLo < 0 && paidBest) worst += vLo;
    if (vLo > 0 && paidWorst) worst += vLo;
    if (vHi > 0 && paidBest) best += vHi;
    if (vHi < 0 && paidWorst) best += vHi;
  }
  const lo = worst / ours.length;
  const hi = best / ours.length;
  return envelope(lo, hi);
}

/**
 * A term that is one scalar per READING, with the horizon guard the three
 * members that have one all write identically.
 *
 * The endpoint choice is `envelope`'s and so the constructor's, not the
 * caller's — see `envelope` above — and the guard is here because a term whose
 * horizon is zero has no reading to take, not because each member decided so.
 */
export function perReading<C extends { readonly horizonTurns: number }>(
  ctx: C,
  of: (ctx: C, reading: 'lo' | 'hi') => number
): Bound {
  if (ctx.horizonTurns <= 0) return point(0);
  return envelope(of(ctx, 'lo'), of(ctx, 'hi'));
}

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
