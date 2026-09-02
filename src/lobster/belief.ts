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
 * ── THE BELIEF NOW DECIDES, AND WHERE ──────────────────────────────────────
 *
 * SUPERSEDED, DELIBERATELY. Increment 1 landed this object non-deciding, and
 * published `BeliefReport.deciding: false` precisely so the increment that
 * turned it on would be legible as a build difference rather than a claim. This
 * is that increment. The belief is now read in exactly one place —
 * `pickLeader`'s tie resolution among FLOOR-UNDOMINATED candidates, plus the
 * sticky stager's matching rung — and only when a deeper-than-one-turn
 * observation has actually spoken about some branch on the board. With no deep
 * observation anywhere the ladder is bit-for-bit the `lo`-then-`est` rule that
 * shipped, because a `mu` assembled from nothing but `(lo, hi, est)` carries no
 * information those three do not already carry and ordering by it would be
 * churn rather than evidence.
 *
 * The LAYER BAN STANDS and is unchanged: `eslint.config.js` still forbids
 * `bounds/**`, `search/**`, `evaluate/**` and `selection/**` from importing
 * this module, and this module still imports nothing from them. The scout does
 * not fold its own observations — it cannot reach this file — it publishes
 * `(value, sigma, plies)` as plain numbers and the KERNEL folds them. So the
 * one thing that changed is who reads the result, not who may build one.
 *
 * ── THE SOUND INTERVAL IS A ONE-PLY INTERVAL, AND THE DEEP CHANNEL SAYS SO ──
 *
 * The single most important law in this file, and the one increment 1 got
 * wrong by omission.
 *
 * `[lo, hi]` is the frame's endpoints for the position AFTER ONE TURN, priced
 * by the one-turn evaluator, bounded over WORLDS (fog, simultaneity). It is a
 * sound bound on that quantity. It is NOT a bound on the final score: a move
 * that certainly kills an enemy next turn has a ply-1 floor above par and may
 * still be losing, because the two units it costs us arrive on turn three and
 * the ply-1 evaluator has never heard of turn three.
 *
 * Truncating every observation into `[lo, hi]` is therefore right for readings
 * denominated at the SAME horizon as the interval (a bank price, a computed
 * evaluation, an un-run evaluator's shadow) and wrong for a reading denominated
 * DEEPER. A deep reading is a statement about a quantity the one-ply interval
 * does not bound, and clamping it back inside would annihilate exactly the
 * information depth exists to produce — silently, and in the direction that
 * always favours the near-term kill.
 *
 * So: near-horizon observations truncate; `deep-finding` and `child-backup` do
 * not, and the posterior records `plies`, the deepest horizon any observation
 * folded into it was denominated at. `lo`/`hi` never move — they are still the
 * sound one-ply interval, they are still what DOMINANCE reads, and nothing here
 * may widen or narrow them. What changed is that `mu` is allowed to leave them
 * when, and only when, something deeper has spoken.
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
  /**
   * A DEEPENED LINE'S OWN EVALUATION, backed up into the branch it started
   * from, at the precision that line earned (§3.3).
   *
   * Denominated at `plies > 1` and therefore NOT truncated into the one-ply
   * interval — see the header. It carries the near events rather than
   * competing with them: the value is priced on the ADVANCED board, so a first
   * turn that kills an enemy is already inside it, and a continuation that
   * loses two of ours nets out against it. That is why a deep observation may
   * be positive or negative, and why neither direction is capped.
   */
  | 'deep-finding'
  /** A child node's posterior, backed up across a ply (§3.4). Folded on the
   * same terms as `deep-finding`: deeper denomination, no truncation. */
  | 'child-backup';

/** Is this observation denominated deeper than the branch's own one-ply
 *  interval? The two kinds that are, named once. */
export function isDeepKind(kind: ObservationKind): boolean {
  return kind === 'deep-finding' || kind === 'child-backup';
}

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
  /**
   * How many turns of play this reading is denominated over. 1 (the default)
   * is the branch's own one-ply frame; 2 is "the position after this move and
   * one more turn of play"; and so on. Only meaningful on a deep kind, where
   * it is what the posterior's own `plies` is a max over.
   */
  readonly plies?: number;
}

/**
 * THE PRECISION A DEEP READING EARNED, from the spread its own line measured.
 *
 * `prec = 1/sigma^2`, the same law `precisionOfInterval` applies to a bound's
 * half-width — stated separately only because a deep line's sigma is not read
 * off an interval. It is assembled by the producer from the discrimination
 * state of the line that produced it (enumeration truncation, fog dilation,
 * un-modelled interference), in the same score units the value is in, and
 * arrives here as one number.
 *
 * A sigma of 0 is an exact reading and earns infinite precision; a non-finite
 * sigma is a reading that positions a mean and claims nothing, and earns none.
 * Neither is clamped, and there is no floor or ceiling on what a line may earn:
 * that is the whole of the replacement for the deleted constant cap.
 */
export function precisionOfSigma(sigma: number): number {
  if (sigma === 0) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(sigma) || sigma < 0) return 0;
  return 1 / (sigma * sigma);
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
  /**
   * Sound ONE-PLY frame endpoints. Moved only by proof, never by this module,
   * and never by a deep reading. This is what dominance compares.
   */
  readonly lo: number;
  readonly hi: number;
  /**
   * The density's mean. Truncated into `[lo, hi]` while every reading is
   * one-ply; free of that truncation once a deeper reading has spoken, because
   * the interval does not bound the quantity a deeper reading is about (see
   * the header).
   */
  readonly mu: number;
  /** `1/sigma^2`. `0` = nothing known inside the interval; `Infinity` = exact. */
  readonly prec: number;
  /**
   * THE DEEPEST HORIZON ANY READING IN HERE WAS DENOMINATED AT, in turns of
   * play. 1 = nothing but this turn has spoken.
   *
   * This is the branch's HONEST horizon and it is the number the staging row,
   * the emission record and the mechanism report all carry. It is a max over
   * observations actually folded — never a constant, never a configured
   * ceiling, and never the `?? 1` a missing view used to fall back to.
   */
  readonly plies: number;
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
  return { lo, hi, mu: truncate(0, lo, hi), prec: 0, plies: 1, provenance: EMPTY_LOG };
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
  // THE TRUNCATION IS HORIZON-CONDITIONAL. A same-horizon reading lives inside
  // the proof; a deeper one is about a quantity the proof does not bound, and
  // clamping it back inside would delete the finding rather than discount it.
  const deep = isDeepKind(obs.kind);
  const plies = deep ? Math.max(post.plies, Math.max(1, obs.plies ?? 2)) : post.plies;
  const free = deep || post.plies > 1;
  return {
    lo: post.lo,
    hi: post.hi,
    mu: free ? (Number.isNaN(mu) ? post.mu : mu) : truncate(mu, post.lo, post.hi),
    prec,
    plies,
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
  return {
    lo,
    hi,
    // A belief that has heard from a deeper horizon is not re-truncated: the
    // new endpoints are still one-ply endpoints, and re-clamping would undo
    // the deep reading a proof about this turn never contradicted.
    mu: post.plies > 1 ? post.mu : truncate(post.mu, lo, hi),
    prec: post.prec,
    plies: post.plies,
    provenance: post.provenance,
  };
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
 * A THIRD CONTRIBUTOR IS NOW POSSIBLE and is folded by the caller, not here:
 * every deepened line rooted at this branch arrives as a `deep-finding` at the
 * precision its own line earned. `posteriorOfBranch` builds the near half; the
 * kernel folds the deep half on top, in canonical order, and rebuilds both
 * together whenever the near reading is replaced (`refreshBelief`).
 *
 * The shadow channel is still zero — no shadow machinery is built (increment
 * 2) — and a zero that is the truth is exactly what a baseline is for.
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
   * Whether any posterior was READ by a decision. True from the increment that
   * gave the belief its readers, and published rather than assumed so a sweep
   * can tell the two builds apart without reading the source.
   */
  readonly deciding: boolean;
  /**
   * HOW DEEP THE DECISION ACTUALLY LOOKED — the max `plies` over every branch.
   * 1 means nothing deeper than this turn ever spoke, which is a measurement
   * and not a fallback constant.
   */
  readonly deepestPlies: number;
  /** Branches carrying at least one deep observation. */
  readonly deepBranches: number;
  /**
   * WOULD THE SEARCH HAVE ANSWERED DIFFERENTLY WITH THE DEEP CHANNEL SILENT?
   *
   * The search core's own counterfactual: a shadow incumbent maintained under
   * the shipped ladder over exactly the trial stream this decision generated,
   * starting from the same seed. Exact about the argmax over that stream;
   * approximate only in that a depthless search would have generated a
   * slightly different stream, because the incumbent steers the sweep.
   */
  readonly depthChangedSearchAnswer: boolean;
  /**
   * WOULD THE STAGER HAVE LED WITH A DIFFERENT ROW?
   *
   * The kernel's counterfactual, and this one is exact: the same comparator,
   * on the same rows, with the belief rung removed. It can only fire where a
   * deep value actually reached a staging row.
   */
  readonly depthChangedLeader: boolean;
  /**
   * WAS DEPTH LOAD-BEARING ON THIS DECISION? The disjunction of the two above.
   *
   * The per-decision indicator the DEPTH-EFFECT RATE is a mean of. It is
   * deliberately a disjunction rather than an end-to-end paired run, which is
   * the one thing a single decision cannot compute about itself: the honest
   * end-to-end measurement is two decisions on one board, one of them with the
   * depth ration set to zero, and the acceptance harness runs exactly that.
   */
  readonly depthChangedStaging: boolean;
}

/** Fold a decision's per-branch posteriors into the mechanism row. */
export function beliefReportOf(
  posteriors: ReadonlyArray<BranchPosterior>,
  staged: BranchPosterior | null,
  depth: { readonly changedSearchAnswer: boolean; readonly changedLeader: boolean } = {
    changedSearchAnswer: false,
    changedLeader: false,
  }
): BeliefReport {
  let exact = 0;
  let unbounded = 0;
  let finiteSum = 0;
  let finiteCount = 0;
  let deepestPlies = 1;
  let deepBranches = 0;
  const provenance: Record<ObservationKind, number> = { ...EMPTY_LOG };
  for (const p of posteriors) {
    if (p.prec === Number.POSITIVE_INFINITY) exact++;
    else if (p.prec === 0) unbounded++;
    else {
      finiteSum += p.prec;
      finiteCount++;
    }
    if (p.plies > deepestPlies) deepestPlies = p.plies;
    if (p.plies > 1) deepBranches++;
    for (const k of OBSERVATION_KINDS) provenance[k] += p.provenance[k];
  }
  return {
    branches: posteriors.length,
    exact,
    unbounded,
    meanPrecision: finiteCount > 0 ? finiteSum / finiteCount : null,
    staged,
    provenance,
    deciding: true,
    deepestPlies,
    deepBranches,
    depthChangedSearchAnswer: depth.changedSearchAnswer,
    depthChangedLeader: depth.changedLeader,
    depthChangedStaging: depth.changedSearchAnswer || depth.changedLeader,
  };
}
