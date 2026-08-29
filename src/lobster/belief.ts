/**
 * THE PER-BRANCH BELIEF — the core redesign's posterior object (§3.1).
 *
 * ── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 * Every branch the decision holds carries TWO channels with DIFFERENT LAWS:
 *
 *   the SOUND INTERVAL  [lo, hi] — moves only by proof (a bank price, a sound
 *                       tighten, a witness, a dominance). Nothing in this file
 *                       may widen or narrow it; it is copied in from the bank.
 *   the BELIEF          (mu, prec) — a density inside that interval, moved by
 *                       ANY observation at its earned precision.
 *
 * That is the marriage of alpha-beta (sound bounds) and MCTS-style statistics
 * (posterior sampling) the redesign asks for: not a new invention, but the two
 * machineries assigned to the two channels they are actually sound for.
 *
 * ── WHAT THIS IS *NOT*, IN THIS INCREMENT ──────────────────────────────────
 *
 * NON-DECIDING. The belief is computed, carried on every branch, and reported
 * — and nothing reads it. Every decision still flows through the existing
 * floor/est path unchanged: the stager reads `StagingCandidate.lo/est/hi`, the
 * comparator reads the proved floor, and neither has ever heard of this file.
 *
 * That is enforced structurally, not by review:
 *   · this module imports nothing from `bounds/`, `search/` or `evaluate/`, so
 *     it cannot participate in a comparison even by accident;
 *   · `eslint.config.js` FORBIDS `bounds/**`, `search/**`, `evaluate/**` and
 *     `selection/**` from importing it, which is the same shape rule 17's grep
 *     already has for the clock and rule 20 has for the RNG;
 *   · the only consumers are the kernel (which stores one per plan alongside
 *     `visits`/`evaluations`, both of which are likewise carried-and-unread)
 *     and the mechanism report.
 *
 * A later increment gives the belief its readers — the allocation weight
 * (§3.2) and staging rung 3 (§3.5). Until then the numbers exist so that the
 * increment which turns them on has a measured baseline to be judged against,
 * which is the same reason `planWork` records visits nobody reads yet.
 *
 * ── EARNED PRECISION, AND WHY IT IS DERIVED RATHER THAN CHOSEN ─────────────
 *
 * The redesign's whole argument against the scout's constant cap is that
 * influence must scale with the precision a reading EARNED, in both
 * directions. So there is no tuning constant anywhere in this file. A computed
 * evaluation's precision comes from the only uncertainty it actually has left
 * once it has run — the world-uncertainty the interval itself measures:
 *
 *     sigma = (hi - lo) / 2        prec = 1 / sigma^2 = 4 / (hi - lo)^2
 *
 * A collapsed interval is exact and earns infinite precision; an interval with
 * a non-finite end (a DEAD floor, a WIN ceiling) is unbounded and earns none.
 * Both are read off the arithmetic rather than clamped into range.
 *
 * OBSERVATION TYPES ARE DECLARED HERE AND NOT ALL POPULATED YET. `shadow` and
 * `deep-finding` name the two channels increment 2 and the aggregator socket
 * fill; on the legacy slate no shadow exists and no thread finding reaches the
 * kernel's plan table (the scout publishes into candidate ordering inside the
 * search core, and may not import a bound at all). Declaring them now is what
 * makes the report's provenance counts legible: a zero in `deep-finding` says
 * "no deep finding reached this branch", which on this slate is the truth and
 * on a later one is a finding.
 */

/** Where one observation about a branch's value came from. */
export type ObservationKind =
  /** The bound bank's price: the sound interval itself, highest precision. */
  | 'bank-price'
  /** A computed evaluator contribution (today: the whole folded triple). */
  | 'evaluation'
  /** An un-run evaluator's prior output distribution (redesign §2.1). Never
   * produced on the legacy slate — no shadow machinery is built yet. */
  | 'shadow'
  /** A thread's finding, folded at the precision its line earned (§3.3).
   * Never produced on the legacy slate: the scout's channel is candidate
   * ordering inside the search core, and it reaches no branch posterior. */
  | 'deep-finding'
  /** A child node's posterior, backed up across a ply (§3.4). Never produced
   * on the legacy slate: there is no second ply in the plan table. */
  | 'child-backup';

export const OBSERVATION_KINDS: ReadonlyArray<ObservationKind> = [
  'bank-price',
  'evaluation',
  'shadow',
  'deep-finding',
  'child-backup',
];

/**
 * One reading about a branch's value, in sharePar-denominated units.
 *
 * `precision` is `1/sigma^2` and may be `Number.POSITIVE_INFINITY` (a proof-
 * grade collapse) or `0` (a reading that positions the mean and claims nothing
 * about it). Both are meaningful and neither is clamped.
 */
export interface Observation {
  readonly kind: ObservationKind;
  readonly value: number;
  readonly precision: number;
}

/**
 * WHAT BUILT A POSTERIOR — counts, not a log.
 *
 * The redesign writes this as an `ObservationLog`. It is COUNTS here, and that
 * is deliberate: on the measured 23x23 three-team board a ten-second decision
 * performed 48 556 evaluations of 152 distinct plans, one of them 1 547 times.
 * A per-branch list of every reading would be the largest allocation in the
 * system and would be, on this slate, 1 547 copies of the same number. Counts
 * are bounded, answer the question the report asks ("what channels spoke to
 * this branch"), and cannot grow with the decision's length.
 */
export type ObservationLog = Readonly<Record<ObservationKind, number>>;

const EMPTY_LOG: ObservationLog = Object.freeze({
  'bank-price': 0,
  evaluation: 0,
  shadow: 0,
  'deep-finding': 0,
  'child-backup': 0,
});

/** The redesign's §3.1 object: a sound interval plus a density inside it. */
export interface BranchPosterior {
  /** Sound frame endpoints. Moved only by proof, never by this module. */
  readonly lo: number;
  readonly hi: number;
  /** The density's mean, always truncated into `[lo, hi]`. */
  readonly mu: number;
  /** `1/sigma^2`. `0` = nothing known inside the interval; `Infinity` = exact. */
  readonly prec: number;
  readonly provenance: ObservationLog;
}

/**
 * THE PRECISION AN INTERVAL EARNS. Half-width as one sigma:
 * `prec = 1/sigma^2 = 4/(hi-lo)^2`.
 *
 * Two edge cases, both read off the arithmetic:
 *   · a COLLAPSED interval (`lo === hi`, the two lattice elements included) is
 *     exact — infinite precision, and the mean is the point;
 *   · a NON-FINITE width (a DEAD floor under a finite ceiling, a WIN ceiling
 *     over a finite floor) is unbounded — zero precision, so such a branch
 *     contributes a position and no confidence.
 */
export function precisionOfInterval(lo: number, hi: number): number {
  if (lo === hi) return Number.POSITIVE_INFINITY;
  const width = hi - lo;
  if (!Number.isFinite(width) || width <= 0) return 0;
  return 4 / (width * width);
}

/** Truncate a mean into the sound support. The density lives INSIDE the proof. */
function truncate(mu: number, lo: number, hi: number): number {
  if (Number.isNaN(mu)) return lo;
  if (hi < lo) return lo;
  return Math.min(Math.max(mu, lo), hi);
}

/**
 * A branch nothing has spoken about yet: the sound interval, and an IMPROPER
 * prior inside it (`prec = 0`). The first observation therefore lands whole,
 * which is the merge formula's own limit rather than a special case bolted on.
 */
export function emptyPosterior(lo: number, hi: number): BranchPosterior {
  return { lo, hi, mu: truncate(0, lo, hi), prec: 0, provenance: EMPTY_LOG };
}

/**
 * THE PRECISION-WEIGHTED MERGE — the redesign's default aggregation (§3.3):
 *
 *     mu   <- (prec*mu + pi*v) / (prec + pi)
 *     prec <- prec + pi
 *
 * with the two degenerate ends handled as limits and not as constants:
 * an infinitely precise reading replaces the mean outright, and a
 * zero-precision reading on a zero-precision posterior positions the mean
 * without claiming anything about it.
 *
 * NOTE ON REPEATS. This accumulates precision, which is correct for
 * INDEPENDENT readings and wrong for the same reading twice. The kernel
 * therefore REBUILDS a branch's posterior from its latest triple rather than
 * folding each re-evaluation in (see `posteriorOfBranch`): the evaluation memo
 * proves a re-priced plan returns the identical number, and accumulating
 * precision over identical numbers would manufacture confidence out of repeat
 * work. This function is the algebra; the kernel owns the accounting.
 */
export function foldObservation(post: BranchPosterior, obs: Observation): BranchPosterior {
  const p0 = post.prec;
  const p1 = obs.precision;
  let mu: number;
  let prec: number;
  if (p1 === Number.POSITIVE_INFINITY) {
    mu = obs.value;
    prec = Number.POSITIVE_INFINITY;
  } else if (p0 === Number.POSITIVE_INFINITY) {
    mu = post.mu;
    prec = Number.POSITIVE_INFINITY;
  } else if (p0 <= 0 && p1 <= 0) {
    // Neither side claims anything: take the position, keep the ignorance.
    mu = obs.value;
    prec = 0;
  } else if (p0 <= 0) {
    mu = obs.value;
    prec = p1;
  } else if (p1 <= 0) {
    mu = post.mu;
    prec = p0;
  } else {
    mu = (p0 * post.mu + p1 * obs.value) / (p0 + p1);
    prec = p0 + p1;
  }
  return {
    lo: post.lo,
    hi: post.hi,
    mu: truncate(mu, post.lo, post.hi),
    prec,
    provenance: { ...post.provenance, [obs.kind]: post.provenance[obs.kind] + 1 },
  };
}

/**
 * Move the SOUND channel, and re-truncate the density into it.
 *
 * Called only with endpoints a proof produced. The density is not rescaled:
 * a proof that narrows the support does not make a belief more precise, it
 * only makes some of it unreachable — and the truncation is what expresses
 * that.
 */
export function withSoundInterval(
  post: BranchPosterior,
  lo: number,
  hi: number
): BranchPosterior {
  return { lo, hi, mu: truncate(post.mu, lo, hi), prec: post.prec, provenance: post.provenance };
}

/**
 * THE LEGACY-SLATE ASSEMBLY: what one branch's posterior is today.
 *
 * Two observations, in the order their laws demand:
 *
 *   1. the BANK PRICE establishes the sound support. It contributes the
 *      interval and, as a density observation, the midpoint at the precision
 *      the interval earns — the honest reading of "all I know is that the
 *      truth is in here".
 *   2. the COMPUTED EVALUATION contributes `est` at the same earned precision.
 *      Redesign §2.1: when a feature has run, "the density collapses to the
 *      computed `est` with residual variance from world-uncertainty only
 *      (interval width)".
 *
 * On this slate there is no third contributor: no shadow exists (increment 2)
 * and no deep finding reaches a branch posterior (the scout's only channel is
 * candidate ordering, inside the search core, and it may not import a bound).
 * Those provenance counts are therefore ZERO here, and a zero that is the
 * truth is exactly what a baseline is for.
 *
 * `soundLo`/`soundHi` are the bank's frame endpoints when the branch has been
 * scored, and the evaluator's own triple ends when it has not — the same
 * `bounds?.worst ?? bound.lo` fallback the kernel's staging rows already use,
 * so the belief and the staging row never disagree about which interval they
 * are talking about.
 */
export function posteriorOfBranch(
  soundLo: number,
  soundHi: number,
  est: number
): BranchPosterior {
  const prec = precisionOfInterval(soundLo, soundHi);
  const mid =
    soundLo === soundHi
      ? soundLo
      : Number.isFinite(soundLo) && Number.isFinite(soundHi)
        ? (soundLo + soundHi) / 2
        : truncate(est, soundLo, soundHi);
  let post = emptyPosterior(soundLo, soundHi);
  post = foldObservation(post, { kind: 'bank-price', value: mid, precision: prec });
  post = foldObservation(post, { kind: 'evaluation', value: est, precision: prec });
  return post;
}

// ------------------------------------------------------------------- report

/**
 * WHAT THE DECISION'S BELIEFS LOOKED LIKE — the mechanism row.
 *
 * Read-only telemetry, assembled after the kernel loop from the per-plan
 * posteriors the decision already carried. It is the increment's evidence that
 * the structure is populated: a report of zero branches, or of branches whose
 * precision never moved off zero, is the failure this row exists to make
 * visible.
 */
export interface BeliefReport {
  /** Branches (plans) the decision held a posterior for. */
  readonly branches: number;
  /** Branches whose sound interval had collapsed — exact, infinite precision. */
  readonly exact: number;
  /** Branches whose interval was unbounded (a DEAD end or a WIN end): zero
   * precision earned, a position and no confidence. */
  readonly unbounded: number;
  /** Mean `prec` over the branches with a FINITE precision. Null when none
   * had one — which is a different statement from zero. */
  readonly meanPrecision: number | null;
  /** The staged branch's posterior, or null when nothing was staged. */
  readonly staged: BranchPosterior | null;
  /** Observations by kind, summed over every branch. The zeros are load-
   * bearing: they say which channels have not been built yet. */
  readonly provenance: ObservationLog;
  /**
   * Whether any posterior was READ by a decision. Always false in this
   * increment, and published rather than assumed: the increment that gives the
   * belief its readers flips this, and a sweep can tell the two builds apart
   * without reading the source.
   */
  readonly deciding: boolean;
}

/** Fold a decision's per-branch posteriors into the mechanism row. */
export function beliefReportOf(
  posteriors: ReadonlyArray<BranchPosterior>,
  staged: BranchPosterior | null
): BeliefReport {
  let exact = 0;
  let unbounded = 0;
  let finiteSum = 0;
  let finiteCount = 0;
  const provenance: Record<ObservationKind, number> = { ...EMPTY_LOG };
  for (const p of posteriors) {
    if (p.prec === Number.POSITIVE_INFINITY) exact++;
    else if (p.prec === 0) unbounded++;
    else {
      finiteSum += p.prec;
      finiteCount++;
    }
    for (const k of OBSERVATION_KINDS) provenance[k] += p.provenance[k];
  }
  return {
    branches: posteriors.length,
    exact,
    unbounded,
    meanPrecision: finiteCount > 0 ? finiteSum / finiteCount : null,
    staged,
    provenance,
    deciding: false,
  };
}
