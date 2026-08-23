/**
 * The clock-skew guard, tested as what it claims to be: a strict tightening of
 * the legacy deadline expression.
 *
 * The properties that matter are the ones a wrong implementation would break
 * silently — that an unobserved guard is byte-identical to the old arithmetic,
 * that no observation can ever move a deadline LATER, and that the one
 * correction it applies is applied only where it is provable.
 */

import {
  DEFAULT_SKEW_ALPHA,
  LAG_OUTLIER_MS,
  MIN_COMPUTE_MS,
  MIN_RESERVE_MS,
  TurnDeadlineGuard,
  describeTiming,
} from '../wire/deadline';

/** The expression this guard replaces, verbatim. */
function legacyDeadline(nowMs: number, endTimeMs: number): number {
  return Math.max(nowMs + 200, endTimeMs - 150);
}

describe('with no observations the guard IS the legacy expression', () => {
  test('ordinary turn: endTime - 150', () => {
    const guard = new TurnDeadlineGuard();
    const now = 1_000_000;
    const end = now + 10_000;
    expect(guard.effectiveDeadlineMs(end, now)).toBe(legacyDeadline(now, end));
    expect(guard.effectiveDeadlineMs(end, now)).toBe(end - MIN_RESERVE_MS);
  });

  test('a turn that arrives already past its deadline still gets the compute floor', () => {
    const guard = new TurnDeadlineGuard();
    const now = 1_000_000;
    const end = now - 5_000;
    expect(guard.effectiveDeadlineMs(end, now)).toBe(legacyDeadline(now, end));
    expect(guard.effectiveDeadlineMs(end, now)).toBe(now + MIN_COMPUTE_MS);
  });

  test('a turn with no startTime on the wire folds no sample', () => {
    const guard = new TurnDeadlineGuard();
    const timing = guard.observeTurn({ startTimeMs: null, endTimeMs: 5_000, arrivalMs: 1_000 });
    expect(timing.lagMs).toBeNull();
    expect(timing.samples).toBe(0);
    expect(guard.effectiveDeadlineMs(11_000, 1_000)).toBe(legacyDeadline(1_000, 11_000));
  });
});

describe('the estimator', () => {
  test('seeds on the first sample instead of dragging up from zero', () => {
    const guard = new TurnDeadlineGuard();
    const t = guard.observeTurn({ startTimeMs: 0, endTimeMs: 10_000, arrivalMs: 400 });
    expect(t.lagMs).toBe(400);
    expect(t.meanLagMs).toBe(400);
    expect(t.sigmaMs).toBe(0);
    expect(t.samples).toBe(1);
  });

  test('a perfectly steady link reports zero jitter and the floor reserve', () => {
    const guard = new TurnDeadlineGuard();
    for (let i = 0; i < 12; i++) {
      guard.observeTurn({ startTimeMs: i * 10_000, endTimeMs: i * 10_000 + 10_000, arrivalMs: i * 10_000 + 300 });
    }
    const t = guard.currentTiming();
    expect(t.meanLagMs).toBeCloseTo(300, 6);
    expect(t.sigmaMs).toBeCloseTo(0, 6);
    expect(t.reserveMs).toBe(MIN_RESERVE_MS);
    // Steady 300 ms lag is ambiguous (all latency, or a fast clock) — neither
    // hurts the deadline, so nothing is corrected.
    expect(t.skewCorrectionMs).toBe(0);
    const now = 500_000;
    expect(guard.effectiveDeadlineMs(now + 10_000, now)).toBe(legacyDeadline(now, now + 10_000));
  });

  test('jitter widens the reserve to 3 sigma once it exceeds the floor', () => {
    const guard = new TurnDeadlineGuard();
    // Alternating 0 / 600 ms lag: a large, sustained jitter.
    for (let i = 0; i < 30; i++) {
      const lag = i % 2 === 0 ? 0 : 600;
      guard.observeTurn({ startTimeMs: i * 10_000, endTimeMs: i * 10_000 + 10_000, arrivalMs: i * 10_000 + lag });
    }
    const t = guard.currentTiming();
    expect(t.sigmaMs).toBeGreaterThan(MIN_RESERVE_MS / 3);
    expect(t.reserveMs).toBeCloseTo(3 * t.sigmaMs, 6);
    const now = 500_000;
    const end = now + 10_000;
    // Strictly earlier than legacy: more reserve, never less.
    expect(guard.effectiveDeadlineMs(end, now)).toBeLessThan(legacyDeadline(now, end));
  });

  test('a lag outlier is reported but never folded in', () => {
    const guard = new TurnDeadlineGuard();
    for (let i = 0; i < 6; i++) {
      guard.observeTurn({ startTimeMs: i * 10_000, endTimeMs: i * 10_000 + 10_000, arrivalMs: i * 10_000 + 200 });
    }
    const before = guard.currentTiming();
    const spike = guard.observeTurn({
      startTimeMs: 100_000,
      endTimeMs: 110_000,
      arrivalMs: 100_000 + LAG_OUTLIER_MS + 1,
    });
    expect(spike.outlier).toBe(true);
    expect(spike.lagMs).toBe(LAG_OUTLIER_MS + 1);
    expect(spike.samples).toBe(before.samples);
    expect(spike.meanLagMs).toBeCloseTo(before.meanLagMs, 6);
    expect(spike.sigmaMs).toBeCloseTo(before.sigmaMs, 6);
  });
});

describe('the slow-clock correction is applied only where it is provable', () => {
  test('a negative lag proves a slow local clock and moves the deadline earlier', () => {
    const guard = new TurnDeadlineGuard();
    // Local arrival BEFORE the server says the turn started: delivery latency
    // cannot be negative, so the local clock is behind by at least 400 ms.
    for (let i = 0; i < 20; i++) {
      guard.observeTurn({
        startTimeMs: i * 10_000,
        endTimeMs: i * 10_000 + 10_000,
        arrivalMs: i * 10_000 - 400,
      });
    }
    const t = guard.currentTiming();
    expect(t.meanLagMs).toBeCloseTo(-400, 0);
    expect(t.skewCorrectionMs).toBeCloseTo(-400, 0);

    const now = 500_000;
    const end = now + 10_000;
    const guarded = guard.effectiveDeadlineMs(end, now);
    expect(guarded).toBeLessThan(legacyDeadline(now, end));
    expect(guarded).toBeCloseTo(end - MIN_RESERVE_MS - 400, 0);
  });

  test('a fast clock is already safe, so nothing is corrected', () => {
    const guard = new TurnDeadlineGuard();
    for (let i = 0; i < 20; i++) {
      guard.observeTurn({
        startTimeMs: i * 10_000,
        endTimeMs: i * 10_000 + 10_000,
        arrivalMs: i * 10_000 + 900,
      });
    }
    expect(guard.currentTiming().skewCorrectionMs).toBe(0);
  });
});

describe('the guard can never make a deadline later than the legacy one', () => {
  test('over a spread of lag histories and turn shapes', () => {
    const lagPatterns = [
      [0, 0, 0],
      [50, 60, 55, 70],
      [-10, -20, -15],
      [1000, 5, 1000, 5],
      [-800, 400, -800, 400],
      [LAG_OUTLIER_MS * 2, 30, 30],
    ];
    for (const pattern of lagPatterns) {
      const guard = new TurnDeadlineGuard();
      pattern.forEach((lag, i) => {
        guard.observeTurn({
          startTimeMs: i * 10_000,
          endTimeMs: i * 10_000 + 10_000,
          arrivalMs: i * 10_000 + lag,
        });
      });
      for (const budget of [0, 500, 10_000, 60_000]) {
        for (const now of [0, 1_000, 999_999]) {
          const end = now + budget;
          expect(guard.effectiveDeadlineMs(end, now)).toBeLessThanOrEqual(
            legacyDeadline(now, end)
          );
        }
      }
    }
  });
});

describe('delivery latency is exposed, not just consumed', () => {
  test('a positive lag is reported as the latency estimate', () => {
    const guard = new TurnDeadlineGuard();
    const t = guard.observeTurn({ startTimeMs: 0, endTimeMs: 10_000, arrivalMs: 250 });
    expect(t.deliveryLatencyMs).toBe(250);
  });

  test('a negative lag reports zero latency, never a negative one', () => {
    const guard = new TurnDeadlineGuard();
    const t = guard.observeTurn({ startTimeMs: 1_000, endTimeMs: 11_000, arrivalMs: 600 });
    expect(t.lagMs).toBe(-400);
    expect(t.deliveryLatencyMs).toBe(0);
  });

  test('the log line names every number it reports', () => {
    const guard = new TurnDeadlineGuard();
    guard.observeTurn({ startTimeMs: 0, endTimeMs: 10_000, arrivalMs: 120 });
    const line = describeTiming(guard.currentTiming());
    expect(line).toContain('lag=120ms');
    expect(line).toContain('reserve=');
    expect(line).toContain('sigma=');
    expect(line).toContain('latency~');
  });
});

describe('configuration', () => {
  test('the default alpha is the documented one', () => {
    expect(DEFAULT_SKEW_ALPHA).toBe(0.25);
  });

  test('a caller may tighten the reserve floor and the compute floor', () => {
    const guard = new TurnDeadlineGuard(DEFAULT_SKEW_ALPHA, 400, 50);
    const now = 1_000;
    const end = now + 10_000;
    expect(guard.effectiveDeadlineMs(end, now)).toBe(end - 400);
    expect(guard.effectiveDeadlineMs(now - 5_000, now)).toBe(now + 50);
  });
});
