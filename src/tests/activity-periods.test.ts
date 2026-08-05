/**
 * Unit tests for the /activity timeline period reconstruction
 * (src/web/activity-periods.js — shared verbatim with the browser page).
 *
 * Covers: graceful shutdown, silent kill (scaled to zero) bounded by the last
 * liveness heartbeat, crash-with-recent-activity, legacy boots without
 * heartbeat forensics, suspend markers, and the live open-ended period.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildPeriods } = require('../web/activity-periods.js');

type Ev = { ts: number; type: string; detail?: Record<string, unknown> | null };

const M = 60 * 1000;
const T0 = 1_000_000_000_000;

describe('activity period reconstruction', () => {
  test('graceful shutdown closes the period with endKnown and endClass graceful', () => {
    const events: Ev[] = [
      { ts: T0, type: 'boot' },
      { ts: T0 + 1 * M, type: 'woke' },
      { ts: T0 + 5 * M, type: 'went-idle' },
      { ts: T0 + 6 * M, type: 'shutdown', detail: { signal: 'SIGTERM' } },
    ];
    const periods = buildPeriods(events, T0 + 10 * M);
    expect(periods).toHaveLength(1);
    const p = periods[0];
    expect(p.endKnown).toBe(true);
    expect(p.endClass).toBe('graceful');
    expect(p.end).toBe(T0 + 6 * M);
    expect(p.segments).toEqual([
      { start: T0, end: T0 + 1 * M, state: 'idle' },
      { start: T0 + 1 * M, end: T0 + 5 * M, state: 'active' },
      { start: T0 + 5 * M, end: T0 + 6 * M, state: 'idle' },
    ]);
  });

  test('silent kill: end bounded at last heartbeat, gap to next boot is scaled-to-zero', () => {
    const lastAlive = T0 + 10 * M;
    const nextBoot = T0 + 60 * M;
    const events: Ev[] = [
      { ts: T0, type: 'boot' },
      { ts: T0 + 1 * M, type: 'woke' },
      { ts: T0 + 6 * M, type: 'went-idle' },
      // No shutdown — autoscale killed us silently.
      { ts: nextBoot, type: 'boot', detail: { prevEndClass: 'silent-kill', prevLastAliveAt: lastAlive } },
    ];
    const periods = buildPeriods(events, nextBoot + M);
    expect(periods).toHaveLength(2);
    const dead = periods[0];
    expect(dead.endKnown).toBe(false);
    expect(dead.endClass).toBe('silent-kill');
    expect(dead.end).toBe(lastAlive); // bounded by heartbeat, NOT next boot
    expect(dead.deadUntil).toBe(nextBoot); // gap rendered as scaled to zero
    // The idle tail is only went-idle → lastAlive (4 min), not a multi-day band.
    const idleTail = dead.segments[dead.segments.length - 1];
    expect(idleTail).toEqual({ start: T0 + 6 * M, end: lastAlive, state: 'idle' });
  });

  test('crash: died with recent activity, classified via boot forensics', () => {
    const lastAlive = T0 + 5 * M;
    const nextBoot = T0 + 30 * M;
    const events: Ev[] = [
      { ts: T0, type: 'boot' },
      { ts: T0 + 1 * M, type: 'woke' },
      { ts: nextBoot, type: 'boot', detail: { prevEndClass: 'crash', prevLastAliveAt: lastAlive } },
    ];
    const periods = buildPeriods(events, nextBoot + M);
    expect(periods[0].endKnown).toBe(false);
    expect(periods[0].endClass).toBe('crash');
    expect(periods[0].end).toBe(lastAlive);
    expect(periods[0].deadUntil).toBe(nextBoot);
    // Was active at death.
    expect(periods[0].segments[periods[0].segments.length - 1].state).toBe('active');
  });

  test('caught fatal error shutdown is classified as crash', () => {
    const events: Ev[] = [
      { ts: T0, type: 'boot' },
      { ts: T0 + M, type: 'woke' },
      { ts: T0 + 2 * M, type: 'shutdown', detail: { signal: 'uncaughtException', cause: 'boom' } },
    ];
    const periods = buildPeriods(events, T0 + 3 * M);
    expect(periods[0].endKnown).toBe(true);
    expect(periods[0].endClass).toBe('crash');
  });

  test('legacy boot without heartbeat forensics falls back to closing at the boot', () => {
    const nextBoot = T0 + 30 * M;
    const events: Ev[] = [
      { ts: T0, type: 'boot' },
      { ts: T0 + M, type: 'woke' },
      { ts: nextBoot, type: 'boot' }, // pre-feature boot: no detail
    ];
    const periods = buildPeriods(events, nextBoot + M);
    expect(periods[0].endKnown).toBe(false);
    expect(periods[0].endClass).toBe('unknown');
    expect(periods[0].end).toBe(nextBoot);
  });

  test('out-of-range prevLastAliveAt is ignored (falls back to boot close)', () => {
    const nextBoot = T0 + 30 * M;
    const events: Ev[] = [
      { ts: T0, type: 'boot' },
      // lastAlive before this period even started (stale row from long ago)
      { ts: nextBoot, type: 'boot', detail: { prevEndClass: 'silent-kill', prevLastAliveAt: T0 - 5 * M } },
    ];
    const periods = buildPeriods(events, nextBoot + M);
    expect(periods[0].end).toBe(nextBoot);
    expect(periods[0].endClass).toBe('unknown');
  });

  test('suspended events do not change activity state or split periods', () => {
    const events: Ev[] = [
      { ts: T0, type: 'boot' },
      { ts: T0 + M, type: 'woke' },
      { ts: T0 + 2 * M, type: 'suspended', detail: { gapMs: 5 * M } },
      { ts: T0 + 3 * M, type: 'went-idle' },
    ];
    const periods = buildPeriods(events, T0 + 4 * M);
    expect(periods).toHaveLength(1);
    expect(periods[0].segments.map((s: any) => s.state)).toEqual(['idle', 'active', 'idle']);
  });

  test('still-running process yields an open-ended period extended to serverNow', () => {
    const now = T0 + 10 * M;
    const events: Ev[] = [
      { ts: T0, type: 'boot' },
      { ts: T0 + M, type: 'woke' },
    ];
    const periods = buildPeriods(events, now);
    expect(periods).toHaveLength(1);
    expect(periods[0].openEnded).toBe(true);
    expect(periods[0].endKnown).toBe(true);
    expect(periods[0].end).toBe(now);
  });

  test('events before the first loaded boot synthesize an unknown-start period', () => {
    const events: Ev[] = [
      { ts: T0, type: 'woke' },
      { ts: T0 + M, type: 'shutdown', detail: { signal: 'SIGINT' } },
    ];
    const periods = buildPeriods(events, T0 + 2 * M);
    expect(periods).toHaveLength(1);
    expect(periods[0].startUnknown).toBe(true);
    expect(periods[0].endKnown).toBe(true);
  });
});
