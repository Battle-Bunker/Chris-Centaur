/**
 * The re-staging rate limit.
 *
 * The behaviour worth pinning is not "it counts to a thousand" — it is the two
 * rules that make the limit safe: a FINAL flush is never refused, and the
 * budget arithmetic the default was chosen from actually holds.
 */

import {
  DEFAULT_MIN_WRITE_INTERVAL_MS,
  MIN_WRITE_INTERVAL_ENV,
  StageThrottle,
  minWriteIntervalFromEnv,
} from '../wire/stage-throttle';

describe('the min-write-interval gate', () => {
  test('the first write for a key is always admitted', () => {
    const t = new StageThrottle({ minWriteIntervalMs: 1000 });
    expect(t.admit('g:7', 0)).toMatchObject({ admit: true, reason: 'first' });
  });

  test('a second write inside the interval is refused with the wait it needs', () => {
    const t = new StageThrottle({ minWriteIntervalMs: 1000 });
    t.admit('g:7', 10_000);
    const d = t.admit('g:7', 10_300);
    expect(d.admit).toBe(false);
    expect(d.reason).toBe('throttled');
    expect(d.retryAfterMs).toBe(700);
  });

  test('the interval boundary itself is admitted', () => {
    const t = new StageThrottle({ minWriteIntervalMs: 1000 });
    t.admit('g:7', 10_000);
    expect(t.admit('g:7', 11_000)).toMatchObject({ admit: true, reason: 'interval' });
  });

  test('a refusal does NOT consume the allowance', () => {
    const t = new StageThrottle({ minWriteIntervalMs: 1000 });
    t.admit('g:7', 10_000);
    t.admit('g:7', 10_100);
    t.admit('g:7', 10_200);
    // The refusals must not have moved the clock forward — 11_000 is still the
    // boundary measured from the ADMITTED write.
    expect(t.admit('g:7', 11_000).admit).toBe(true);
  });

  test('keys are independent — one team’s turn never throttles another', () => {
    const t = new StageThrottle({ minWriteIntervalMs: 1000 });
    t.admit('gameA:7', 10_000);
    expect(t.admit('gameB:7', 10_001).admit).toBe(true);
    expect(t.admit('gameA:8', 10_001).admit).toBe(true);
  });

  test('a backwards clock jump never yields a negative wait', () => {
    const t = new StageThrottle({ minWriteIntervalMs: 1000 });
    t.admit('g:7', 10_000);
    const d = t.check('g:7', 5_000);
    expect(d.admit).toBe(false);
    expect(d.retryAfterMs).toBeGreaterThanOrEqual(0);
  });

  test('check is pure — it never consumes the allowance', () => {
    const t = new StageThrottle({ minWriteIntervalMs: 1000 });
    expect(t.check('g:7', 0).admit).toBe(true);
    expect(t.size).toBe(0);
    t.record('g:7', 0);
    expect(t.size).toBe(1);
  });
});

describe('the final flush is exempt, by rule', () => {
  test('a final write immediately after an admitted one goes through', () => {
    const t = new StageThrottle({ minWriteIntervalMs: 1000 });
    t.admit('g:7', 10_000);
    // Without the final flag the very same write is refused …
    expect(t.check('g:7', 10_001)).toMatchObject({ admit: false, reason: 'throttled' });
    // … and with it, admitted.
    expect(t.admit('g:7', 10_001, true)).toMatchObject({ admit: true, reason: 'final' });
  });

  test('a final flush resets the clock like any other admitted write', () => {
    const t = new StageThrottle({ minWriteIntervalMs: 1000 });
    t.admit('g:7', 10_000, true);
    expect(t.admit('g:7', 10_500).admit).toBe(false);
    expect(t.admit('g:7', 11_000).admit).toBe(true);
  });

  test('a final flush with no prior write at all is admitted', () => {
    const t = new StageThrottle({ minWriteIntervalMs: 1000 });
    expect(t.admit('never-written', 0, true).admit).toBe(true);
  });
});

describe('forgetting', () => {
  test('forget clears one key', () => {
    const t = new StageThrottle({ minWriteIntervalMs: 1000 });
    t.admit('g:7', 10_000);
    t.forget('g:7');
    expect(t.admit('g:7', 10_001)).toMatchObject({ admit: true, reason: 'first' });
  });

  test('forgetPrefix clears one game’s turns and leaves the others', () => {
    const t = new StageThrottle({ minWriteIntervalMs: 1000 });
    t.admit('gameA:7', 10_000);
    t.admit('gameA:8', 10_000);
    t.admit('gameB:7', 10_000);
    t.forgetPrefix('gameA:');
    expect(t.size).toBe(1);
    expect(t.admit('gameB:7', 10_001).admit).toBe(false);
  });
});

describe('the default is the one the budget arithmetic asks for', () => {
  test('one second, in phase with the confirm backstop', () => {
    expect(DEFAULT_MIN_WRITE_INTERVAL_MS).toBe(1000);
    expect(new StageThrottle().intervalMs).toBe(1000);
  });

  // docs = units x ceil(turnMs / interval); every one of them is a document
  // the turn's resolution transaction has to read, because privateMoves is
  // append-only with no cleanup.
  function docsPerTurn(units: number, turnMs: number, intervalMs: number): number {
    return units * Math.ceil(turnMs / intervalMs);
  }

  test('the default bounds a 26-unit team on an ordinary 10 s turn', () => {
    expect(docsPerTurn(26, 10_000, DEFAULT_MIN_WRITE_INTERVAL_MS)).toBe(260);
  });

  test('and keeps even the 60 s opening turn under the flagged ~1900-read case', () => {
    expect(docsPerTurn(26, 60_000, DEFAULT_MIN_WRITE_INTERVAL_MS)).toBe(1560);
    expect(docsPerTurn(26, 60_000, DEFAULT_MIN_WRITE_INTERVAL_MS)).toBeLessThan(1900);
  });

  test('the cadences it exists to stop are an order of magnitude worse', () => {
    // The anytime kernel emits about every 100 ms; 4 Hz was the figure the
    // conformance pass measured against.
    expect(docsPerTurn(26, 10_000, 100)).toBe(2600);
    expect(docsPerTurn(26, 10_000, 250)).toBe(1040);
    expect(docsPerTurn(26, 60_000, 100)).toBe(15_600);
  });

  test('a throttled turn actually delivers that bound, tick by tick', () => {
    const t = new StageThrottle({ minWriteIntervalMs: DEFAULT_MIN_WRITE_INTERVAL_MS });
    let admitted = 0;
    // Drive a 10 s turn at the kernel's 100 ms emit cadence.
    for (let now = 0; now < 10_000; now += 100) {
      if (t.admit('g:1', now).admit) admitted += 1;
    }
    expect(admitted).toBe(10);
    // Plus the deadline flush, which is never counted against the budget.
    expect(t.admit('g:1', 9_950, true).admit).toBe(true);
  });
});

describe('the environment override', () => {
  test('an unset variable takes the default', () => {
    expect(minWriteIntervalFromEnv({})).toBe(DEFAULT_MIN_WRITE_INTERVAL_MS);
    expect(minWriteIntervalFromEnv({ [MIN_WRITE_INTERVAL_ENV]: '' })).toBe(
      DEFAULT_MIN_WRITE_INTERVAL_MS
    );
  });

  test('a positive number is honoured', () => {
    expect(minWriteIntervalFromEnv({ [MIN_WRITE_INTERVAL_ENV]: '2500' })).toBe(2500);
  });

  test('junk, zero and negatives keep the default and say so', () => {
    for (const bad of ['nonsense', '0', '-1', 'NaN']) {
      const said: string[] = [];
      expect(minWriteIntervalFromEnv({ [MIN_WRITE_INTERVAL_ENV]: bad }, (m) => said.push(m))).toBe(
        DEFAULT_MIN_WRITE_INTERVAL_MS
      );
      expect(said).toHaveLength(1);
      expect(said[0]).toContain(MIN_WRITE_INTERVAL_ENV);
    }
  });

  test('the override cannot be used to uncap the write rate', () => {
    // The transaction-read cost the limit bounds does not go away because
    // somebody would rather it did.
    expect(minWriteIntervalFromEnv({ [MIN_WRITE_INTERVAL_ENV]: '0' }, () => {})).toBeGreaterThan(0);
    expect(
      minWriteIntervalFromEnv({ [MIN_WRITE_INTERVAL_ENV]: 'Infinity' }, () => {})
    ).toBe(DEFAULT_MIN_WRITE_INTERVAL_MS);
  });
});
