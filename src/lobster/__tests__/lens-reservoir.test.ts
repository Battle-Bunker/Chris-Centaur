/**
 * RETENTION.
 *
 * The lens's rows are the search's own discarded work: `better()` already
 * computes the ranking and drops the loser (`search/core.ts:410`), and the
 * reservoir writes at that call site, at `O(k)` comparisons per priced trial
 * and ZERO evaluations.
 *
 * THE FALSIFIER THIS FILE EXISTS TO CATCH is the reservoir's order drifting
 * from the search's — the failure that would make a displayed rank a lie. So
 * the ordering assertion does not restate the implementation: it writes out
 * `better()`'s own key, strict improvement on `(floor, est, ceiling, salted
 * tie key)`, all four descending, and demands the reservoir agree with a sort
 * under that key regardless of the order rows were offered in.
 */

import { makeReservoir, slackFrom, type MovesetReservoir } from '../../lens/kernel';
import { LENS_ROW_CAP, LENS_TOPK, type Moveset } from '../../lens/types';
import { moveset } from '../../tests/lens-fixtures';

const LIVE = 'comp:live';
const OTHER = 'comp:other';

/** `better()`'s key, written out rather than imported, so a refactor of the
 *  hottest function in the search cannot quietly redefine what "rank" means. */
function byBetter(a: Moveset, b: Moveset): number {
  if (a.lo !== b.lo) return b.lo - a.lo;
  if (a.est !== b.est) return b.est - a.est;
  if (a.hi !== b.hi) return b.hi - a.hi;
  return b.tie - a.tie;
}

function offerAll(r: MovesetReservoir, rows: ReadonlyArray<Moveset>): void {
  for (const row of rows) r.offer(row);
}

const SPREAD: ReadonlyArray<Moveset> = [
  moveset({ key: 'm-a', lo: 9.0, est: 9.4, hi: 12.0, tie: 3 }),
  moveset({ key: 'm-b', lo: 12.4, est: 12.9, hi: 15.3, tie: 1 }),
  moveset({ key: 'm-c', lo: 11.7, est: 12.0, hi: 15.8, tie: 7 }),
  moveset({ key: 'm-d', lo: 12.4, est: 12.9, hi: 15.9, tie: 2 }),
  moveset({ key: 'm-e', lo: 12.4, est: 13.1, hi: 14.0, tie: 5 }),
  moveset({ key: 'm-f', lo: 8.1, est: 8.1, hi: 8.1, tie: 9 }),
  moveset({ key: 'm-g', lo: 12.4, est: 12.9, hi: 15.9, tie: 8 }),
];

describe('the reservoir is bounded at two layers', () => {
  it('holds at most LENS_TOPK per (cluster, complement)', () => {
    const r = makeReservoir();
    offerAll(r, SPREAD);
    expect(r.rows(0, LIVE)).toHaveLength(LENS_TOPK);
  });

  it('holds at most LENS_ROW_CAP per decision, across every cluster', () => {
    const r = makeReservoir();
    for (let cluster = 0; cluster < 8; cluster++) {
      offerAll(
        r,
        SPREAD.map((m) => ({ ...m, cluster, key: `c${cluster}:${m.key}` }))
      );
    }
    expect(r.all().length).toBeLessThanOrEqual(LENS_ROW_CAP);
    expect(r.size).toBe(r.all().length);
  });

  it('keeps the BEST k, not the first k — offer order must not decide', () => {
    const forwards = makeReservoir();
    offerAll(forwards, SPREAD);
    const backwards = makeReservoir();
    offerAll(backwards, [...SPREAD].reverse());
    expect(backwards.rows(0, LIVE).map((m) => m.key)).toEqual(
      forwards.rows(0, LIVE).map((m) => m.key)
    );
    const best = [...SPREAD].sort(byBetter).slice(0, LENS_TOPK);
    expect(forwards.rows(0, LIVE).map((m) => m.key)).toEqual(best.map((m) => m.key));
  });
});

describe("the order is exactly better()'s", () => {
  it('ranks on (lo, est, hi, tie), each descending, and ranks are 1..n', () => {
    const r = makeReservoir();
    offerAll(r, SPREAD);
    const rows = r.rows(0, LIVE);
    expect(rows.map((m) => m.key)).toEqual(
      [...SPREAD].sort(byBetter).slice(0, LENS_TOPK).map((m) => m.key)
    );
    expect(rows.map((m) => m.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it('breaks a floor tie on est, an est tie on the ceiling, and that tie on the salt', () => {
    const r = makeReservoir();
    // m-b / m-d / m-g share a floor; m-d and m-g share est AND ceiling.
    offerAll(r, SPREAD);
    const keys = r.rows(0, LIVE).map((m) => m.key);
    expect(keys.indexOf('m-e')).toBeLessThan(keys.indexOf('m-d')); // est decides
    expect(keys.indexOf('m-d')).toBeLessThan(keys.indexOf('m-b')); // ceiling decides
    expect(keys.indexOf('m-g')).toBeLessThan(keys.indexOf('m-d')); // salt decides
  });
});

describe('the staged plan is always retained (03 §7.3 coverage)', () => {
  it("keeps the staged plan's cluster restriction at rank 1 for the live complement", () => {
    const r = makeReservoir();
    offerAll(r, SPREAD);
    // A staged row arriving late and NOT at the top of the ordering key must
    // still be present, and must be rank 1 of the live complement: it is what
    // the bot will actually do, and a table whose first row is not the staged
    // plan is a table that answers a question nobody asked.
    r.offer(moveset({ key: 'm-staged', lo: 10.0, est: 10.0, hi: 10.0, tie: 0, staged: true }));
    const rows = r.rows(0, LIVE);
    expect(rows[0]?.key).toBe('m-staged');
    expect(rows[0]?.rank).toBe(1);
    expect(rows.filter((m) => m.staged)).toHaveLength(1);
  });

  it('never evicts the staged row to make room under the cap', () => {
    const r = makeReservoir();
    r.offer(moveset({ key: 'm-staged', lo: 0.1, est: 0.1, hi: 0.1, staged: true }));
    offerAll(r, SPREAD);
    expect(r.rows(0, LIVE).some((m) => m.key === 'm-staged')).toBe(true);
  });
});

describe('the fiber: rows from two complements are never one list (Law E)', () => {
  it('groups by complementKey and never returns a stale row beside a fresh one', () => {
    const r = makeReservoir();
    offerAll(r, SPREAD);
    offerAll(
      r,
      SPREAD.map((m) => ({ ...m, key: `stale:${m.key}`, complementKey: OTHER }))
    );
    const live = r.rows(0, LIVE);
    const other = r.rows(0, OTHER);
    expect(live.every((m) => m.complementKey === LIVE)).toBe(true);
    expect(other.every((m) => m.complementKey === OTHER)).toBe(true);
    expect(live.map((m) => m.key)).not.toEqual(expect.arrayContaining(other.map((m) => m.key)));
  });

  it("marks a row whose complement is no longer the incumbent's as `stale`", () => {
    const r = makeReservoir();
    offerAll(r, SPREAD);
    r.seal(OTHER); // the incumbent's complement moved on
    expect(r.rows(0, LIVE).every((m) => m.complement === 'stale')).toBe(true);
    expect(r.rows(0, OTHER).every((m) => m.complement === 'live')).toBe(true);
  });

  it('keeps a stale row SOUND — it was a real bracket of a real plan', () => {
    const r = makeReservoir();
    offerAll(r, SPREAD);
    const beforeSeal = r.rows(0, LIVE).map((m) => [m.lo, m.est, m.hi]);
    r.seal(OTHER);
    expect(r.rows(0, LIVE).map((m) => [m.lo, m.est, m.hi])).toEqual(beforeSeal);
  });
});

describe('dominance is filled at the barrier and not before', () => {
  it('is null on every row before the seal', () => {
    const r = makeReservoir();
    offerAll(r, SPREAD);
    expect(r.rows(0, LIVE).every((m) => m.dominance === null)).toBe(true);
  });

  it('is non-null on every row after it, with the leader named `leader`', () => {
    const r = makeReservoir();
    offerAll(r, SPREAD);
    r.seal(LIVE);
    const rows = r.rows(0, LIVE);
    expect(rows.every((m) => m.dominance !== null)).toBe(true);
    expect(rows[0]?.dominance).toEqual({ kind: 'leader' });
    expect(rows.slice(1).every((m) => m.dominance?.kind !== 'leader')).toBe(true);
  });
});

/**
 * THE THREAT/OPPORTUNITY MAP (03 §2.4, 08 §3.4).
 *
 * `better()`'s refusal branch is the whole content of the set-valued
 * reduction, and the reservoir is where it becomes a statement about a row.
 * Every branch is asserted here, because the panel now draws one clause PER
 * ROW rather than one per decision: a branch that mapped to the wrong
 * condition used to be invisible on four rows out of five.
 *
 * The leader is offered with a floor nothing else reaches, so every other
 * row's condition is a statement about the same leader.
 */
describe('every retained row carries the condition its refusal branch names', () => {
  const LEADER = moveset({ key: 'lead', lo: 20, est: 20, hi: 24, tie: 9 });

  /** One rival, offered with `because`, sealed against that leader. */
  function conditionOf(row: Moveset, refusal: Parameters<MovesetReservoir['offer']>[1]) {
    const r = makeReservoir();
    r.offer(LEADER);
    r.offer(row, refusal);
    r.seal(LIVE);
    return r.rows(0, LIVE)[1]?.dominance;
  }

  it('the witness branch carries the certificate itself, when one was banked', () => {
    const witness = { replies: new Map(), note: 'B1 minimiser for unit 3' };
    expect(conditionOf(moveset({ key: 'w', lo: 5, est: 5, hi: 9 }), { because: 'witness', witness })).toEqual(
      { kind: 'refuted-by-witness', witness }
    );
  });

  it('the witness branch with NO certificate says `dominated`, not a fabricated one', () => {
    // `refutedAt` is arithmetic — this plan's ceiling under the leader's proved
    // floor — and that is exactly what `dominated` claims. A witness nobody
    // holds would be a certificate nobody can check.
    expect(conditionOf(moveset({ key: 'w2', lo: 5, est: 5, hi: 9 }), { because: 'witness' })).toEqual({
      kind: 'dominated',
      by: 20 - 9,
    });
  });

  it('a basis mismatch is INCOMPARABLE and carries the assumptions that made it so', () => {
    const assumptions = [{ kind: 'narrowing' as const, unitId: 3, note: 'option list unproved' }];
    const row = { ...moveset({ key: 'b', lo: 5, est: 5, hi: 9 }), assumptions };
    expect(conditionOf(row, { because: 'basis' })).toEqual({
      kind: 'incomparable-basis',
      theirs: assumptions,
    });
  });

  it('an est refusal is ADVISORY-ONLY — the floors are equal and est never adjudicates', () => {
    const row = moveset({ key: 'e', lo: 20, est: 14, hi: 24, tie: 1 });
    expect(conditionOf(row, { because: 'est' })).toEqual({ kind: 'advisory-only', estMargin: 6 });
  });

  it('a tie refusal is INDIFFERENT — the proof rungs are silent and a coin decided', () => {
    const row = moveset({ key: 't', lo: 20, est: 20, hi: 24, tie: 1 });
    expect(conditionOf(row, { because: 'tie' })).toEqual({ kind: 'indifferent' });
  });

  it('a floor refusal whose CEILING clears the leader floor is CONTINGENT, named and priced', () => {
    // The row can still lead — but only if everything it cites resolves its
    // way, and `atStake` is what that resolution is worth.
    const row = { ...moveset({ key: 'c', lo: 12, est: 12, hi: 26 }), citedUnits: ['B-r3', 'B-q1'] };
    expect(conditionOf(row, { because: 'floor' })).toEqual({
      kind: 'contingent',
      onUnits: ['B-r3', 'B-q1'],
      atStake: 6,
    });
  });

  it('a floor refusal whose ceiling does NOT is DOMINATED — it cannot win under any resolution', () => {
    const row = moveset({ key: 'd', lo: 12, est: 12, hi: 18 });
    expect(conditionOf(row, { because: 'floor' })).toEqual({ kind: 'dominated', by: 2 });
  });

  it('a row retained with NO refusal recorded still gets a condition, on the same rule', () => {
    // A trial that was ACCEPTED when it was offered is still a row the operator
    // reads at the barrier, and "no clause" and "leads" are different states.
    const row = { ...moveset({ key: 'n', lo: 12, est: 12, hi: 26 }), citedUnits: ['B-r3'] };
    expect(conditionOf(row, null)).toEqual({
      kind: 'contingent',
      onUnits: ['B-r3'],
      atStake: 6,
    });
  });

  it('fills a condition on EVERY retained row, not just the pair the foil draws', () => {
    const r = makeReservoir();
    offerAll(r, SPREAD);
    r.seal(LIVE);
    const rows = r.rows(0, LIVE);
    expect(rows.length).toBe(LENS_TOPK);
    expect(rows.filter((m) => m.dominance !== null)).toHaveLength(LENS_TOPK);
  });
});

describe('slack is re-derived from the reservoir (04 §5.2 #12)', () => {
  it('is max over retained rivals of (rᵢ.hi − leader.lo), not the leader own gap', () => {
    const rows = [...SPREAD].sort(byBetter).slice(0, LENS_TOPK);
    const leader = rows[0] as Moveset;
    const expected = Math.max(...rows.slice(1).map((m) => m.hi - leader.lo));
    expect(slackFrom(rows)).toBeCloseTo(expected, 10);
    expect(slackFrom(rows)).not.toBeCloseTo(leader.hi - leader.lo, 10);
  });

  it('is zero when the leader is the only retained row', () => {
    expect(slackFrom([moveset({ lo: 3, est: 3, hi: 9 })])).toBe(0);
  });
});
