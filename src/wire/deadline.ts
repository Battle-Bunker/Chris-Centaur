/**
 * The turn deadline, measured instead of assumed.
 *
 * A turn's `endTime` is a SERVER timestamp: the Cloud Function stamps it from
 * its own clock when it resolves the previous turn. The decision deadline the
 * centaur enforces is a comparison against the centaur host's `Date.now()` —
 * two different clocks, never reconciled. The legacy computation was
 *
 *     deadlineMs = Math.max(Date.now() + 200, endTimeMs - 150)
 *
 * which is exact only when the two clocks agree to within the 150 ms reserve.
 * They need not: a host clock running BEHIND server time under-reads the
 * present, so the decision keeps running past the real deadline and the last
 * staged write is silently discarded (the resolving transaction filters
 * `timestamp <= endTime`, and both sides floor to whole ms — there is no
 * meaningful grace).
 *
 * What can actually be measured, per turn, from data already on the wire:
 *
 *   startTimeMs   server-stamped, the instant the turn began
 *   endTimeMs     server-stamped, the instant it must be resolved by
 *   arrivalMs     LOCAL Date.now() when the turn snapshot was delivered here
 *
 *   lag = arrivalMs - startTimeMs = deliveryLatency + skew
 *
 * where `skew` is (local clock − server clock) and `deliveryLatency >= 0` is
 * the function-commit → listener-delivery time. One-way timing cannot split
 * those two, and this module does not pretend to: it uses the decomposition
 * only in the direction where it is SOUND.
 *
 *   - lag < 0 is proof of a slow local clock. Delivery latency cannot be
 *     negative, so the local clock is behind server time by at least |lag|.
 *     That is exactly the dangerous direction, so |lag| is subtracted from the
 *     deadline.
 *   - lag >= 0 is ambiguous — it may be all latency (harmless to the deadline
 *     comparison) or a fast clock (which stops the decision EARLY, wasteful
 *     but safe). No correction is applied, because none is provable.
 *
 * Jitter is handled separately and symmetrically: the reserve widens to
 * `max(150, 3σ)` where σ is the EWMA standard deviation of the lag samples.
 * Lag jitter IS deadline uncertainty — the same network and scheduling noise
 * that moves an arrival moves the moment a staged write lands.
 *
 * The guard is a strict tightening. With zero observations it reproduces the
 * legacy expression exactly (σ = 0, skew = 0 → `max(now + 200, endTime - 150)`),
 * and every correction it can apply moves the deadline EARLIER, never later.
 * The `now + 200` floor is kept verbatim: a turn that arrives already past its
 * deadline must still get a decision rather than a deadline in the past.
 *
 * Delivery latency is exposed too (R4 in the deployment report): it shortens
 * the usable budget by an amount nothing currently accounts for, and it is
 * only observable here.
 */

/** Reserve floor, in ms — the legacy constant, now a lower bound on `max(150, 3σ)`. */
export const MIN_RESERVE_MS = 150;

/** Floor on the compute window, in ms — the legacy `Date.now() + 200` term. */
export const MIN_COMPUTE_MS = 200;

/** EWMA smoothing factor. 0.25 ≈ a 7-sample effective window: fast enough to
 * follow a clock step within one exchange of turns, slow enough that a single
 * delayed snapshot cannot widen the reserve on its own. */
export const DEFAULT_SKEW_ALPHA = 0.25;

/**
 * A lag sample that exceeds this is treated as a delivery OUTLIER (a paused
 * process, a reconnect replaying a stale snapshot) and is excluded from the
 * estimator, which otherwise takes minutes to forget it. It is still reported.
 */
export const LAG_OUTLIER_MS = 30_000;

export interface TurnArrival {
  /** Server-stamped turn start, epoch ms. Null when the wire carried none. */
  readonly startTimeMs: number | null;
  /** Server-stamped turn deadline, epoch ms. */
  readonly endTimeMs: number;
  /** LOCAL Date.now() at the instant the turn snapshot was delivered. */
  readonly arrivalMs: number;
}

export interface TurnTiming {
  /** arrivalMs - startTimeMs: delivery latency plus clock skew. Null when the
   * turn carried no startTime. */
  readonly lagMs: number | null;
  /** EWMA of the lag samples. 0 before the first sample. */
  readonly meanLagMs: number;
  /** EWMA standard deviation of the lag samples. 0 before the second sample. */
  readonly sigmaMs: number;
  /** max(MIN_RESERVE_MS, 3σ) — how far ahead of endTime the decision stops. */
  readonly reserveMs: number;
  /** The PROVABLE slow-clock correction, <= 0. Widens the reserve further. */
  readonly skewCorrectionMs: number;
  /** Best available estimate of function-commit → delivery latency, >= 0. It is
   * an UPPER bound while the local clock is fast and a lower bound while it is
   * slow — one-way timing cannot do better. */
  readonly deliveryLatencyMs: number;
  /** Whether this sample was excluded from the estimator as an outlier. */
  readonly outlier: boolean;
  /** Samples folded into the estimator so far (outliers excluded). */
  readonly samples: number;
}

/**
 * Per-game clock guard. One instance per watched game: delivery latency and
 * host-clock behaviour are properties of the connection, and a game that has
 * just started should not inherit another game's jitter history.
 */
export class TurnDeadlineGuard {
  private mean = 0;
  private variance = 0;
  private count = 0;
  private lastTiming: TurnTiming | null = null;

  constructor(
    private readonly alpha: number = DEFAULT_SKEW_ALPHA,
    private readonly minReserveMs: number = MIN_RESERVE_MS,
    private readonly minComputeMs: number = MIN_COMPUTE_MS
  ) {}

  /**
   * Fold one turn's arrival into the estimator and report the timing it
   * implies. Safe to call with `startTimeMs: null` — the sample is skipped and
   * the standing estimate is reported unchanged.
   */
  observeTurn(arrival: TurnArrival): TurnTiming {
    const lagMs =
      arrival.startTimeMs === null ? null : arrival.arrivalMs - arrival.startTimeMs;

    let outlier = false;
    if (lagMs !== null) {
      if (Math.abs(lagMs) > LAG_OUTLIER_MS) {
        outlier = true;
      } else if (this.count === 0) {
        // Seed on the first sample rather than dragging up from 0: an EWMA
        // started at zero reports a spurious multi-sample "improvement" that
        // would show up as jitter (and so as a widened reserve) on a link
        // that is merely slow and perfectly steady.
        this.mean = lagMs;
        this.variance = 0;
        this.count = 1;
      } else {
        const deviation = lagMs - this.mean;
        this.mean += this.alpha * deviation;
        // West's incremental EWMA variance: E[(x-mean)^2] under the same decay.
        this.variance = (1 - this.alpha) * (this.variance + this.alpha * deviation * deviation);
        this.count += 1;
      }
    }

    const timing = this.timingFrom(lagMs, outlier);
    this.lastTiming = timing;
    return timing;
  }

  /** The timing implied by the samples seen so far, without folding a new one. */
  currentTiming(): TurnTiming {
    return this.lastTiming ?? this.timingFrom(null, false);
  }

  /**
   * The deadline a decision for this turn must stop at, in LOCAL clock terms.
   *
   * With no observations this is `Math.max(nowMs + 200, endTimeMs - 150)` —
   * byte-for-byte the legacy computation. Every observation can only move the
   * result earlier.
   */
  effectiveDeadlineMs(endTimeMs: number, nowMs: number): number {
    const t = this.currentTiming();
    return Math.max(nowMs + this.minComputeMs, endTimeMs - t.reserveMs + t.skewCorrectionMs);
  }

  private timingFrom(lagMs: number | null, outlier: boolean): TurnTiming {
    const sigmaMs = this.count >= 2 ? Math.sqrt(this.variance) : 0;
    const reserveMs = Math.max(this.minReserveMs, 3 * sigmaMs);
    // Only a PROVABLY slow clock earns a correction, and it is always negative
    // (or zero), so the deadline can only move earlier. An estimator with no
    // samples reports mean 0 and corrects nothing.
    const skewCorrectionMs = this.count === 0 ? 0 : Math.min(0, this.mean);
    return {
      lagMs,
      meanLagMs: this.count === 0 ? 0 : this.mean,
      sigmaMs,
      reserveMs,
      skewCorrectionMs,
      deliveryLatencyMs: Math.max(0, lagMs ?? (this.count === 0 ? 0 : this.mean)),
      outlier,
      samples: this.count,
    };
  }
}

/**
 * A one-line summary for the per-turn log. Kept here so the format is defined
 * next to the numbers it prints rather than in the transport.
 */
export function describeTiming(t: TurnTiming): string {
  const lag = t.lagMs === null ? 'n/a' : `${t.lagMs}ms`;
  return (
    `lag=${lag}${t.outlier ? ' (outlier)' : ''} ` +
    `mean=${t.meanLagMs.toFixed(1)}ms sigma=${t.sigmaMs.toFixed(1)}ms ` +
    `reserve=${t.reserveMs.toFixed(1)}ms skew=${t.skewCorrectionMs.toFixed(1)}ms ` +
    `latency~${t.deliveryLatencyMs.toFixed(1)}ms n=${t.samples}`
  );
}
