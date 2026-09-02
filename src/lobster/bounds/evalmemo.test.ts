/**
 * THE EVALUATION MEMO — its one soundness property, and its lifetime.
 *
 * The memo exists because a ten-second decision performed 48 556 evaluations
 * of 152 distinct plans. The property that makes it a cache rather than a bug
 * is that it REFUSES to serve one evaluator's number to another, or one
 * basis's to another: a resolution is evaluator-independent, an evaluation is
 * not. These tests are the fence around that.
 */

import {
  BoundBank,
  DEFAULT_BANK_CONFIG,
  EvaluationDivergenceError,
  EvaluationMemo,
  basisKeyOf,
  evalNamespace,
} from './index';
import type { Assumption, Bound, Evaluator, JointPlan, Substrate } from '../contracts';
import { BoundEvaluator, MATERIAL_ONLY_PROFILE, TERRITORY_PROFILE } from '../evaluate';
import {
  allPlans,
  makeEvaluator,
  makeGenerator,
  makeSubstrate,
  makeTestBoard,
  unboundedBudget,
  type BoardSpec,
  type BoundedSubstrate,
} from './testkit';

const OURS = 0;
const THEIRS = 1;

const CONTACT: BoardSpec = {
  width: 7,
  height: 7,
  units: [
    { id: 1, team: OURS, type: 'rook', occupancy: [2 * 7 + 2, 2 * 7 + 2], health: 60 },
    { id: 2, team: THEIRS, type: 'king', occupancy: [2 * 7 + 4], health: 60 },
    { id: 3, team: THEIRS, type: 'king', occupancy: [4 * 7 + 4], health: 60 },
  ],
};

const posture = (p: 'SIGHTED' | 'FOGGED-VACUOUS'): Assumption => ({ kind: 'posture', posture: p });

// --------------------------------------------------------------- the key

describe('the namespace is the soundness boundary', () => {
  const ev = new BoundEvaluator(TERRITORY_PROFILE);

  test('two criterion profiles never share a namespace', () => {
    const other = new BoundEvaluator(MATERIAL_ONLY_PROFILE);
    expect(evalNamespace(ev, '', OURS)).not.toBe(evalNamespace(other, '', OURS));
  });

  test('the SAME profile in a different object DOES share one', () => {
    // Object identity would be over-conservative here and merely slow; the
    // declared identity is what makes it exact. Asserted so a future change to
    // `evaluationIdentity` that silently drops to object identity is caught.
    expect(evalNamespace(new BoundEvaluator(TERRITORY_PROFILE), '', OURS)).toBe(
      evalNamespace(new BoundEvaluator(TERRITORY_PROFILE), '', OURS),
    );
  });

  test('a profile field this file has never heard of still enters the key', () => {
    // The cohort/selection mechanism being built in parallel adds fields to
    // CriterionProfile. Nothing here enumerates profile fields by name, and
    // this is the test that keeps it that way: adding one must invalidate.
    const grown = { ...TERRITORY_PROFILE, cohort: 'red' } as typeof TERRITORY_PROFILE;
    const other = { ...TERRITORY_PROFILE, cohort: 'blue' } as typeof TERRITORY_PROFILE;
    expect(evalNamespace(new BoundEvaluator(grown), '', OURS)).not.toBe(
      evalNamespace(new BoundEvaluator(other), '', OURS),
    );
  });

  test('two BASES never share a namespace', () => {
    expect(evalNamespace(ev, basisKeyOf([posture('SIGHTED')]), OURS)).not.toBe(
      evalNamespace(ev, basisKeyOf([posture('FOGGED-VACUOUS')]), OURS),
    );
    expect(evalNamespace(ev, basisKeyOf([]), OURS)).not.toBe(
      evalNamespace(ev, basisKeyOf([{ kind: 'operator-pin', unitId: 1, to: 5 }]), OURS),
    );
  });

  test('an assumption set is order-free, so a re-ordered basis is the SAME namespace', () => {
    const a: Assumption = { kind: 'operator-pin', unitId: 2, to: 5 };
    const b: Assumption = { kind: 'operator-pin', unitId: 1, to: 4 };
    expect(evalNamespace(ev, basisKeyOf([a, b]), OURS)).toBe(
      evalNamespace(ev, basisKeyOf([b, a]), OURS),
    );
  });

  test('two FRAMES never share a namespace', () => {
    expect(evalNamespace(ev, '', OURS)).not.toBe(evalNamespace(ev, '', THEIRS));
  });

  test('an evaluator that declares nothing gets a stable, per-object identity', () => {
    const anonymous = (): Evaluator =>
      ({ scorePlan: () => ({ lo: 0, est: 0, hi: 0 }) }) as unknown as Evaluator;
    const one = anonymous();
    expect(evalNamespace(one, '', OURS)).toBe(evalNamespace(one, '', OURS));
    expect(evalNamespace(one, '', OURS)).not.toBe(evalNamespace(anonymous(), '', OURS));
  });
});

// --------------------------------------------------------------- the store

describe('the store', () => {
  const bound = (lo: number): Bound => ({ lo, est: lo, hi: lo });

  test('computes once per key and serves the same value after', () => {
    const memo = new EvaluationMemo(16);
    let calls = 0;
    const get = (k: string, v: number): Bound => memo.score(k, () => (calls++, bound(v)));
    expect(get('a', 1)).toEqual(bound(1));
    expect(get('a', 99)).toEqual(bound(1));
    expect(calls).toBe(1);
    expect(memo.stats).toMatchObject({ hits: 1, misses: 1, entries: 1 });
  });

  test('two namespaces over the same entry never cross', () => {
    const memo = new EvaluationMemo(16);
    expect(memo.score('nsA|plan', () => bound(1))).toEqual(bound(1));
    expect(memo.score('nsB|plan', () => bound(2))).toEqual(bound(2));
    expect(memo.stats.hits).toBe(0);
  });

  test('it is BOUNDED: the entry count never exceeds the capacity', () => {
    const memo = new EvaluationMemo(4);
    for (let i = 0; i < 200; i++) memo.score(`k${i}`, () => bound(i));
    expect(memo.stats.entries).toBe(4);
  });

  test('capacity 0 turns it off rather than caching forever', () => {
    const memo = new EvaluationMemo(0);
    let calls = 0;
    memo.score('a', () => (calls++, bound(1)));
    memo.score('a', () => (calls++, bound(1)));
    expect(calls).toBe(2);
    expect(memo.stats.entries).toBe(0);
  });

  test('clear() empties it — the per-decision lifetime', () => {
    const memo = new EvaluationMemo(16);
    memo.score('a', () => bound(1));
    memo.clear();
    expect(memo.stats).toMatchObject({ entries: 0, hits: 0, misses: 0 });
  });
});

// -------------------------------------------- entries somebody else computed

describe('an imported entry is indistinguishable from a local one', () => {
  const bound = (lo: number): Bound => ({ lo, est: lo, hi: lo });

  test('an import is served instead of computing, and is counted apart', () => {
    const memo = new EvaluationMemo(16);
    let calls = 0;
    expect(memo.import('a', bound(7))).toBe(true);
    expect(memo.score('a', () => (calls++, bound(99)))).toEqual(bound(7));
    expect(calls).toBe(0);
    expect(memo.stats).toMatchObject({ imported: 1, hits: 1, misses: 0, entries: 1 });
  });

  test('an import never OVERWRITES: the entry already here is the same value', () => {
    const memo = new EvaluationMemo(16);
    memo.score('a', () => bound(1));
    expect(memo.import('a', bound(2))).toBe(false);
    expect(memo.score('a', () => bound(3))).toEqual(bound(1));
    expect(memo.stats.imported).toBe(0);
  });

  test('imports respect the capacity — a prefetch cannot grow the ceiling', () => {
    const memo = new EvaluationMemo(4);
    for (let i = 0; i < 50; i++) memo.import(`k${i}`, bound(i));
    expect(memo.stats.entries).toBe(4);
  });

  test('capacity 0 refuses imports rather than caching forever', () => {
    const memo = new EvaluationMemo(0);
    expect(memo.import('a', bound(1))).toBe(false);
    expect(memo.stats.entries).toBe(0);
  });

  test('AUDIT recomputes an imported entry once and agrees', () => {
    const memo = new EvaluationMemo(16, true);
    memo.import('a', bound(5));
    let calls = 0;
    expect(memo.score('a', () => (calls++, bound(5)))).toEqual(bound(5));
    expect(calls).toBe(1);
    expect(memo.stats).toMatchObject({ importHits: 1, audited: 1 });
    // Audited once, then it is an ordinary entry.
    expect(memo.score('a', () => (calls++, bound(5)))).toEqual(bound(5));
    expect(calls).toBe(1);
  });

  test('AUDIT throws on a disagreement — the divergence the key cannot express', () => {
    const memo = new EvaluationMemo(16, true);
    memo.import('a', bound(5));
    expect(() => memo.score('a', () => bound(6))).toThrow(EvaluationDivergenceError);
    // And it is loud about WHICH pair disagreed, because a counter would not
    // identify the board that is wrong.
    const other = new EvaluationMemo(16, true);
    other.import('b', bound(5));
    expect(() => other.score('b', () => bound(6))).toThrow(/imported \(5, 5, 5\) vs local \(6, 6, 6\)/);
  });

  test('recording hands back exactly what this memo computed, once', () => {
    const memo = new EvaluationMemo(16);
    memo.startRecording();
    memo.score('a', () => bound(1));
    memo.score('a', () => bound(1)); // a hit: not new work, not recorded twice
    memo.score('b', () => bound(2));
    expect(memo.takeRecording()).toEqual([
      ['a', bound(1)],
      ['b', bound(2)],
    ]);
    expect(memo.takeRecording()).toEqual([]);
  });
});

// ------------------------------------------------------- through the bank

/** An evaluator whose identity — and answer — can be switched under a LIVE
 *  bank. This is the cohort/profile-selection shape, and the one way a single
 *  bank can be asked to serve two evaluators. */
function switchable(): {
  evaluate: Evaluator;
  select(which: string, offset: number): void;
  calls(): number;
} {
  let which = 'A';
  let offset = 0;
  let calls = 0;
  const scorePlan = (sub: Substrate, plan: JointPlan, asTeam: number): Bound => {
    calls++;
    const { worst, best } = (sub as BoundedSubstrate).boundedFor(plan, asTeam);
    return { lo: worst + offset, est: (worst + best) / 2 + offset, hi: best + offset };
  };
  return {
    evaluate: {
      get evaluationIdentity(): string {
        return `switchable:${which}`;
      },
      scorePlan,
      evaluatePlan: (sub: Substrate, plan: JointPlan, asTeam: number) => ({
        bound: scorePlan(sub, plan, asTeam),
        parts: {},
        exact: false,
        basis: [],
        ledgerSize: 0,
      }),
    } as unknown as Evaluator,
    select: (w, o) => {
      which = w;
      offset = o;
    },
    calls: () => calls,
  };
}

describe('the bank memoises evaluations without laundering them', () => {
  test('re-pricing the same plan does not re-evaluate it', () => {
    const board = makeTestBoard(CONTACT);
    const sub = makeSubstrate(board, OURS);
    const gen = makeGenerator();
    const ev = switchable();
    const bank = new BoundBank({
      sub,
      gen,
      evaluate: ev.evaluate,
      asTeam: OURS,
      budget: unboundedBudget(),
      basis: [],
      config: DEFAULT_BANK_CONFIG,
    });
    try {
      const plan = allPlans(sub, gen, OURS, 1)[0] as JointPlan;
      const first = bank.price(plan);
      const spent = ev.calls();
      expect(spent).toBeGreaterThan(0);
      const second = bank.price(plan);
      // Not one more evaluation, and not one different number.
      expect(ev.calls()).toBe(spent);
      expect(bank.evalMemoStats.hits).toBe(spent);
      expect(second.bounds.worst).toBe(first.bounds.worst);
      expect(second.bounds.best).toBe(first.bounds.best);
    } finally {
      bank.release();
      sub.release();
    }
  });

  test('an evaluator that CHANGES under a live bank is not served the old numbers', () => {
    // The soundness constraint, at the level it actually bites: the bank
    // outlives a slice, and a cohort mechanism may re-point the evaluator
    // between slices. A memo keyed on the plan alone would hand profile B the
    // numbers profile A computed.
    const board = makeTestBoard(CONTACT);
    const sub = makeSubstrate(board, OURS);
    const gen = makeGenerator();
    const ev = switchable();
    const bank = new BoundBank({
      sub,
      gen,
      evaluate: ev.evaluate,
      asTeam: OURS,
      budget: unboundedBudget(),
      basis: [],
      config: DEFAULT_BANK_CONFIG,
    });
    try {
      const plan = allPlans(sub, gen, OURS, 1)[0] as JointPlan;
      const underA = bank.price(plan);
      ev.select('B', 1000);
      const underB = bank.price(plan);
      expect(underB.bounds.worst).toBe(underA.bounds.worst + 1000);
      // And switching back must find A's entry still there and still A's.
      ev.select('A', 0);
      expect(bank.price(plan).bounds.worst).toBe(underA.bounds.worst);
    } finally {
      bank.release();
      sub.release();
    }
  });

  test('the memo changes no bound the bank publishes, on any plan of a board', () => {
    // The differential: the same bank config with the memo on and off must
    // agree exactly, plan for plan. A cache that moves a number is not a cache.
    const board = makeTestBoard(CONTACT);
    const on = makeSubstrate(board, OURS);
    const off = makeSubstrate(board, OURS);
    const gen = makeGenerator();
    const mk = (sub: Substrate, capacity: number): BoundBank =>
      new BoundBank({
        sub,
        gen,
        // The testkit's evaluator, not the production one: `BoundEvaluator`
        // requires the engine substrate, and what is under test here is the
        // memo, not the fold.
        evaluate: makeEvaluator(),
        asTeam: OURS,
        budget: unboundedBudget(),
        basis: [],
        config: { ...DEFAULT_BANK_CONFIG, evalMemoCapacity: capacity },
      });
    const memoised = mk(on, DEFAULT_BANK_CONFIG.evalMemoCapacity);
    const plain = mk(off, 0);
    try {
      let compared = 0;
      for (const plan of allPlans(on, gen, OURS, 24)) {
        const a = memoised.price(plan);
        const b = plain.price(plan);
        expect([a.bounds.worst, a.bounds.best, a.est]).toEqual([
          b.bounds.worst,
          b.bounds.best,
          b.est,
        ]);
        expect(a.members.map((m) => [m.rung, m.floor, m.ceiling])).toEqual(
          b.members.map((m) => [m.rung, m.floor, m.ceiling]),
        );
        compared++;
      }
      expect(compared).toBeGreaterThan(0);
      expect(memoised.evalMemoStats.hits).toBeGreaterThan(0);
      expect(plain.evalMemoStats.hits).toBe(0);
    } finally {
      memoised.release();
      plain.release();
      on.release();
      off.release();
    }
  });

  test('release() empties it — a per-decision cache may not outlive the decision', () => {
    const board = makeTestBoard(CONTACT);
    const sub = makeSubstrate(board, OURS);
    const gen = makeGenerator();
    const bank = new BoundBank({
      sub,
      gen,
      evaluate: makeEvaluator(),
      asTeam: OURS,
      budget: unboundedBudget(),
      basis: [],
      config: DEFAULT_BANK_CONFIG,
    });
    try {
      for (const plan of allPlans(sub, gen, OURS, 4)) bank.price(plan);
      expect(bank.evalMemoStats.entries).toBeGreaterThan(0);
      bank.release();
      expect(bank.evalMemoStats.entries).toBe(0);
      // And the slab contract is untouched: this cache holds no slabs, so
      // `outstanding()` is back to the base state exactly as before.
      expect(sub.outstanding()).toBe(1);
    } finally {
      sub.release();
    }
  });
});
