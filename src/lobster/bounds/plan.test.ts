/**
 * PLAN KEY IDENTITY, under interning.
 *
 * `planKey` is the memo key for both the resolution memo and the evaluation
 * memo, so an interning bug here is not a slow answer — it is one plan served
 * another plan's bound. These pin the two properties that make the candidate
 * key cache safe: the key is a pure function of the candidate's VALUE, and a
 * plan whose map key disagrees with the candidate's own `unitId` still keys on
 * the map key.
 */

import type { Candidate, UnitId } from '../contracts';
import { candidateKey, cellsOf, planKey, sameCandidate, unitsOf, withMove, withMoves } from './plan';

const cand = (unitId: number, to: number, path: number[] = []): Candidate => ({
  unitId,
  from: -1,
  to,
  path,
});

const planOf = (...cs: Candidate[]): ReadonlyMap<UnitId, Candidate> =>
  new Map(cs.map((c) => [c.unitId as UnitId, c]));

describe('candidateKey', () => {
  test('is the value, not the object', () => {
    expect(candidateKey(cand(3, 7, [5, 7]))).toBe(candidateKey(cand(3, 7, [5, 7])));
    expect(candidateKey(cand(3, 7, [5, 7]))).toBe('3>7#5.7');
  });

  test('distinguishes PATH, not just destination', () => {
    const straight = cand(3, 7, [6, 7]);
    const round = cand(3, 7, [4, 7]);
    expect(candidateKey(straight)).not.toBe(candidateKey(round));
    expect(sameCandidate(straight, round)).toBe(false);
    expect(sameCandidate(straight, cand(3, 7, [6, 7]))).toBe(true);
  });

  test('the second ask for the SAME object is the same string', () => {
    const c = cand(9, 11, [10, 11]);
    const first = candidateKey(c);
    expect(candidateKey(c)).toBe(first);
    // and a fresh object with the same value agrees with it
    expect(candidateKey(cand(9, 11, [10, 11]))).toBe(first);
  });
});

describe('planKey', () => {
  test('is order-free over the plan', () => {
    const a = cand(1, 2, [2]);
    const b = cand(7, 8, [8]);
    expect(planKey(planOf(a, b))).toBe(planKey(planOf(b, a)));
  });

  test('is path-sensitive', () => {
    expect(planKey(planOf(cand(1, 9, [5, 9])))).not.toBe(planKey(planOf(cand(1, 9, [6, 9]))));
  });

  test('two plans differing in one unit differ in the key', () => {
    const base = planOf(cand(1, 2, [2]), cand(3, 4, [4]));
    expect(planKey(withMove(base, cand(3, 5, [5])))).not.toBe(planKey(base));
  });

  test('keys on the MAP key when it disagrees with the candidate', () => {
    // A hand-built plan that files a candidate under a different id. The
    // interned key belongs to the candidate; the plan's key must not use it.
    const mis = new Map<UnitId, Candidate>([[42 as UnitId, cand(3, 7, [7])]]);
    expect(planKey(mis)).toBe('42>7#7');
    // ...and the candidate's own key is untouched by having been in that plan.
    expect(candidateKey(cand(3, 7, [7]))).toBe('3>7#7');
  });

  test('repeated calls on the same plan agree', () => {
    const p = planOf(cand(1, 2, [2]), cand(3, 4, [4]), cand(5, 6, [6]));
    const first = planKey(p);
    for (let i = 0; i < 5; i++) expect(planKey(p)).toBe(first);
  });

  test('the scratch parts array does not leak between calls', () => {
    const big = planOf(cand(1, 2), cand(3, 4), cand(5, 6), cand(7, 8));
    const small = planOf(cand(1, 2));
    planKey(big);
    expect(planKey(small)).toBe('1>2#');
    expect(planKey(big).split('|')).toHaveLength(4);
  });

  test('an empty plan has an empty key', () => {
    expect(planKey(new Map())).toBe('');
  });
});

describe('plan plumbing is unchanged', () => {
  test('withMoves replaces several at once and leaves the original alone', () => {
    const base = planOf(cand(1, 2, [2]), cand(3, 4, [4]));
    const next = withMoves(base, [cand(1, 9, [9]), cand(3, 10, [10])]);
    expect(planKey(base)).toBe('1>2#2|3>4#4');
    expect(planKey(next)).toBe('1>9#9|3>10#10');
  });

  test('cellsOf and unitsOf still read the plan', () => {
    const p = planOf(cand(1, 3, [2, 3]), cand(5, 6, [6]));
    expect([...cellsOf(p)].sort((x, y) => x - y)).toEqual([2, 3, 6]);
    expect(unitsOf(p)).toEqual([1, 5]);
  });
});
