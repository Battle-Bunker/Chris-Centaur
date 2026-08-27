/**
 * S0b — THE FRAMING/CONDITIONING DISCHARGE SPLIT, and the defect it fixes.
 *
 * `basisKeyOf` was doing two jobs. It decided COMPARABILITY — right, and
 * unchanged here — and, through `assumptions.length === 0`, it also decided
 * DISCHARGE. Those are different questions:
 *
 *   CONDITIONING (reference-action, operator-pin, narrowing) narrows the GAME.
 *                Something is genuinely unknown or genuinely forbidden, so
 *                there IS more to learn. It must defeat discharge.
 *   FRAMING      (posture; later, cohort) names the QUESTION. A fully sighted,
 *                fully resolved position is fully resolved under either
 *                framing, so it must NOT defeat discharge — while still
 *                refusing comparison across framings.
 *
 * THE DEFECT. `kernel.ts`'s `searchContext` appends a posture assumption to
 * every context unconditionally, `search/basis.ts`'s `basisOf` passes it to the
 * bank, and the bank stamps it on every bound it mints. So in production
 * *no bound could ever report `exact`* — not in a fully sighted, fully
 * resolved, un-narrowed position, not anywhere. The tests below pin the fix at
 * three altitudes: the predicate, the bank, and the search core running the
 * real basis pipeline.
 */

import type { Assumption, CandidateSet, JointPlan, SearchContext, UnitId } from '../contracts';
import {
  BoundBank,
  DEFAULT_BANK_CONFIG,
  assumptionClassOf,
  basisKeyOf,
  compareFloors,
  conditioningAssumptions,
  dominates,
  isConditioning,
  isDischarged,
  isFraming,
  makeScoreBounds,
  onBasis,
  pointBounds,
  tighten,
} from '../bounds';
import {
  allPlans,
  makeEvaluator,
  makeGenerator,
  makeSubstrate,
  makeTestBoard,
  unboundedBudget,
  type BoardSpec,
} from '../bounds/testkit';
import { makeSearchCore } from '../search';
import { COHORTS, DEFAULT_COHORT_ID, cohortAssumptionOf, requireCohortRowIn } from '../evaluate/calibration';

const OURS = 0;
const THEIRS = 1;

const SIGHTED: Assumption = { kind: 'posture', posture: 'SIGHTED' };
const FOGGED: Assumption = { kind: 'posture', posture: 'FOGGED-DISCRIMINATING' };
const PIN: Assumption = { kind: 'operator-pin', unitId: 1, to: 40 };
const REF: Assumption = { kind: 'reference-action', unitId: 2, to: 41 };
const NARROW: Assumption = { kind: 'narrowing', unitId: 3, note: 'tail truncated' };
/** The SECOND framing assumption, added at Stage 1. Everything S0b claimed
 * about `posture` had to stay true of a union with two framing kinds in it,
 * and the tests below now say so of both together rather than of one. */
const COHORT: Assumption = cohortAssumptionOf(requireCohortRowIn(COHORTS, DEFAULT_COHORT_ID));

/** Opposite corners of a big board: nothing can reach anything, so the ledger
 * is empty and the position is genuinely determinate. */
const DISTANT: BoardSpec = {
  width: 11,
  height: 11,
  units: [
    { id: 1, team: OURS, type: 'king', occupancy: [1 * 11 + 1], health: 60 },
    { id: 2, team: THEIRS, type: 'king', occupancy: [9 * 11 + 9], health: 60 },
  ],
};

// ------------------------------------------------------------- the predicate

describe('the two classes of assumption', () => {
  test('every kind is classified, once, in one place', () => {
    expect(assumptionClassOf(REF)).toBe('conditioning');
    expect(assumptionClassOf(PIN)).toBe('conditioning');
    expect(assumptionClassOf(NARROW)).toBe('conditioning');
    expect(assumptionClassOf(SIGHTED)).toBe('framing');
    expect(assumptionClassOf(COHORT)).toBe('framing');
    expect([REF, PIN, NARROW].every(isConditioning)).toBe(true);
    expect(isFraming(SIGHTED)).toBe(true);
    expect(isFraming(COHORT)).toBe(true);
    expect(conditioningAssumptions([SIGHTED, COHORT, PIN, NARROW])).toEqual([PIN, NARROW]);
    expect(conditioningAssumptions([SIGHTED, COHORT])).toEqual([]);
  });

  test('a framing assumption does not defeat discharge', () => {
    const b = makeScoreBounds({ worst: 3, best: 3, assumptions: [SIGHTED] });
    expect(b.exact).toBe(true);
    expect(isDischarged(b)).toBe(true);
    // `exact` and `isDischarged` are the SAME predicate, so they cannot drift.
    expect(b.exact).toBe(isDischarged(b));
  });

  test('BOTH framing assumptions together still do not defeat discharge', () => {
    // S1's extension of the test above, and the reason S0b had to land first:
    // the kernel stamps posture AND cohort on every context, so if framing
    // defeated discharge the second stamp would have made `exact` unreachable
    // twice over — one defect on top of the one S0b removed.
    const b = makeScoreBounds({ worst: 3, best: 3, assumptions: [SIGHTED, COHORT] });
    expect(b.assumptions).toHaveLength(2);
    expect(b.exact).toBe(true);
    expect(isDischarged(b)).toBe(true);
  });

  test('every conditioning assumption still defeats discharge', () => {
    for (const a of [PIN, REF, NARROW]) {
      const b = makeScoreBounds({ worst: 3, best: 3, assumptions: [a] });
      expect([a.kind, b.exact]).toEqual([a.kind, false]);
      expect([a.kind, isDischarged(b)]).toEqual([a.kind, false]);
    }
    // And one conditioning assumption is enough, however much framing rides
    // alongside it.
    expect(makeScoreBounds({ worst: 3, best: 3, assumptions: [SIGHTED, PIN] }).exact).toBe(false);
  });

  test('a non-empty ledger still defeats discharge under any framing', () => {
    const b = makeScoreBounds({
      worst: 1,
      best: 5,
      ledger: [{ unitId: 7, cell: 3, subStep: 0, polarity: 'if_present', note: 'held' }],
      assumptions: [SIGHTED],
    });
    expect(b.exact).toBe(false);
  });

  test('the honesty guard still fires: a discharged bound must be a point', () => {
    // A gap with nothing to blame it on is an unrecorded narrowing, and that
    // stays a throw — the split widens WHICH bounds are exact, not what an
    // exact bound is allowed to look like.
    expect(() => makeScoreBounds({ worst: 1, best: 5, assumptions: [SIGHTED] })).toThrow(
      /no conditioning assumption must mean a point bound/,
    );
  });
});

// --------------------------------------------------------- comparability, kept

describe('comparability still runs over ALL assumptions', () => {
  test('two exact bounds under different postures refuse comparison', () => {
    const a = makeScoreBounds({ worst: 3, best: 3, assumptions: [SIGHTED] });
    const b = makeScoreBounds({ worst: 4, best: 4, assumptions: [FOGGED] });
    expect(a.exact && b.exact).toBe(true);
    expect(basisKeyOf(a.assumptions)).not.toBe(basisKeyOf(b.assumptions));
    expect(dominates(a, b)).toMatchObject({ comparable: false, refusal: 'basis_mismatch' });
    expect(compareFloors(a, b)).toMatchObject({ comparable: false, refusal: 'basis_mismatch' });
    expect(tighten(a, b)).toMatchObject({ ok: false, refusal: 'basis_mismatch' });
  });

  test('an exact posture-framed bound is still not comparable with an unframed one', () => {
    const framed = makeScoreBounds({ worst: 3, best: 3, assumptions: [SIGHTED] });
    expect(pointBounds(3).exact).toBe(true);
    expect(framed.exact).toBe(true);
    // Both discharged, and still a typed refusal: discharge is not licence.
    expect(compareFloors(framed, pointBounds(3))).toMatchObject({ comparable: false });
  });
});

// -------------------------------------------------------------- R3, framed

describe('R3 collapse survives a framing assumption', () => {
  test('a determinate evaluation put on a posture basis stays exact', () => {
    const ctx = bankFor(DISTANT, []);
    try {
      const plan = allPlans(ctx.sub, ctx.gen, OURS, 1)[0] as JointPlan;
      const bare = ctx.bank.price(plan).bounds;
      expect(bare.exact).toBe(true);
      // `onBasis` is how the kernel's advice layer re-frames a proved bracket.
      // Before the split this line silently destroyed the discharge.
      const framed = onBasis(bare, [SIGHTED]);
      expect(framed.exact).toBe(true);
      expect(framed.worst).toBe(bare.worst);
      expect(framed.best).toBe(bare.best);
      // …and a conditioning assumption applied the same way still destroys it.
      expect(onBasis(bare, [PIN]).exact).toBe(false);
    } finally {
      ctx.close();
    }
  });
});

// ----------------------------------------------------------- the defect, fixed

function bankFor(
  spec: BoardSpec,
  basis: ReadonlyArray<Assumption>,
): {
  bank: BoundBank;
  sub: ReturnType<typeof makeSubstrate>;
  gen: ReturnType<typeof makeGenerator>;
  close(): void;
} {
  const board = makeTestBoard(spec);
  const sub = makeSubstrate(board, OURS);
  const gen = makeGenerator();
  const bank = new BoundBank({
    sub,
    gen,
    evaluate: makeEvaluator(),
    asTeam: OURS,
    budget: unboundedBudget(),
    basis,
    config: DEFAULT_BANK_CONFIG,
  });
  return {
    bank,
    sub,
    gen,
    close: () => {
      bank.release();
      sub.release();
    },
  };
}

describe('THE DEFECT: exact was unreachable in production', () => {
  test('a sighted, resolved, un-narrowed position IS exact with a posture present', () => {
    const ctx = bankFor(DISTANT, [SIGHTED]);
    try {
      const plan = allPlans(ctx.sub, ctx.gen, OURS, 1)[0] as JointPlan;
      const out = ctx.bank.price(plan);
      expect(out.bounds.ledger).toEqual([]);
      expect(out.bounds.worst).toBe(out.bounds.best);
      // The posture rides on the basis — this is the kernel's own construction,
      // not a contrived one — and the bound is exact anyway.
      expect(out.bounds.assumptions).toEqual([SIGHTED]);
      expect(out.bounds.exact).toBe(true);
      expect(isDischarged(out.bounds)).toBe(true);
    } finally {
      ctx.close();
    }
  });

  test('an operator-pin in the same basis still defeats discharge', () => {
    const ctx = bankFor(DISTANT, [SIGHTED, PIN]);
    try {
      const plan = allPlans(ctx.sub, ctx.gen, OURS, 1)[0] as JointPlan;
      const out = ctx.bank.price(plan);
      expect(out.bounds.ledger).toEqual([]);
      expect(out.bounds.worst).toBe(out.bounds.best);
      expect(out.bounds.exact).toBe(false);
      expect(isDischarged(out.bounds)).toBe(false);
    } finally {
      ctx.close();
    }
  });
});

// ------------------------------------------- end to end, through the real basis

/** The search core's own pipeline: `basisOf(ctx)` collects the pins and
 * `ctx.assumptions` — including the posture the kernel puts there — and hands
 * them to the bank. Nothing here reaches past a public seam. */
function searchContextFor(
  spec: BoardSpec,
  assumptions: ReadonlyArray<Assumption>,
  pins: SearchContext['pins'] = [],
): { ctx: SearchContext; close(): void } {
  const board = makeTestBoard(spec);
  const sub = makeSubstrate(board, OURS);
  const gen = makeGenerator();
  const sets = new Map<UnitId, CandidateSet>();
  for (const unitId of sub.commandable(OURS)) sets.set(unitId, gen.candidatesFor(sub, unitId));
  const ctx: SearchContext = {
    sub,
    gen,
    evaluate: makeEvaluator(),
    asTeam: OURS,
    pins,
    assumptions,
    incumbent: null,
    witnesses: [],
    budget: unboundedBudget(),
  };
  return { ctx, close: () => sub.release() };
}

describe('the search core reports a discharge it has actually earned', () => {
  test('improve() on a determinate board is exact WITH the posture the kernel stamps', () => {
    const h = searchContextFor(DISTANT, [SIGHTED]);
    try {
      const out = makeSearchCore().improve(h.ctx);
      expect(out.bounds.assumptions.map((a) => a.kind)).toEqual(['posture']);
      expect(out.bounds.ledger).toEqual([]);
      expect(out.bounds.exact).toBe(true);
    } finally {
      h.close();
    }
  });

  test('...and STILL exact with the cohort the kernel now stamps beside it', () => {
    // The real pipeline, with the exact basis `searchContext` builds at
    // Stage 1: both framing assumptions, nothing else. This is the assertion
    // that would have broken if `cohort` had been classified as conditioning,
    // and it breaks at the altitude that matters — a bound the production
    // search actually minted, not a hand-built one.
    const h = searchContextFor(DISTANT, [SIGHTED, COHORT]);
    try {
      const out = makeSearchCore().improve(h.ctx);
      expect(out.bounds.assumptions.map((a) => a.kind).sort()).toEqual(['cohort', 'posture']);
      expect(out.bounds.ledger).toEqual([]);
      expect(out.bounds.exact).toBe(true);
    } finally {
      h.close();
    }
  });

  test('a pin defeats it again with both framings present', () => {
    const h = searchContextFor(DISTANT, [SIGHTED, COHORT], [
      { unitId: 1, to: 1 * 11 + 2, tentative: false },
    ]);
    try {
      const out = makeSearchCore().improve(h.ctx);
      expect(out.bounds.exact).toBe(false);
    } finally {
      h.close();
    }
  });

  test('a committed operator pin on the same board is NOT exact', () => {
    const h = searchContextFor(DISTANT, [SIGHTED], [{ unitId: 1, to: 1 * 11 + 2, tentative: false }]);
    try {
      const out = makeSearchCore().improve(h.ctx);
      expect(out.bounds.assumptions.some((a) => a.kind === 'operator-pin')).toBe(true);
      expect(out.bounds.exact).toBe(false);
    } finally {
      h.close();
    }
  });
});
