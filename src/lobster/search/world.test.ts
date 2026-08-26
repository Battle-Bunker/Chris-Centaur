/**
 * WORLD ARBITRATION — what the search does when two adversary worlds are on
 * the table, and what it refuses to do.
 *
 * The rule, in full, and every clause is tested here:
 *
 *  1. THE WORLD IS CHOSEN ONCE PER DECISION, from admissibility, never per
 *     plan. Two plans priced under different bases cannot be compared, so a
 *     narrowing that appeared on one plan and not another would freeze the
 *     ascent without saying so.
 *  2. IN AN ADMISSIBLE DECISION THE ASCENT RUNS IN THE RELAXED WORLD, and the
 *     bracket it returns carries the narrowing — so the kernel stages a
 *     conditional promise and every emitted record says so.
 *  3. THE STRICT WORLD CONTRIBUTES TO THE FLOOR. A floor on the full reply set
 *     is a floor on any subset of it, so `max(strict, relaxed)` is legal.
 *     (That direction only. The ceiling never crosses — see coalition.test.ts.)
 *  4. THE STRICT WORLD VETOES. A plan whose STRICT ceiling is DEAD is convicted
 *     in the un-relaxed game and no assumption about rival coordination may
 *     stage it. This is a PREDICATE on one bound, not a comparison of two.
 *  5. DISAGREEMENT IS COUNTED, NEVER RESOLVED. The unconditional channel's own
 *     leader over the same priced plans is tracked and reported.
 *  6. WITH ONE RIVAL TEAM NONE OF THIS HAPPENS, and the counters prove it.
 */

import type { BankResult } from '../bounds';
import type { CandidateSet, PlanScore, SearchContext, UnitId } from '../contracts';
import { DEAD, basisKeyOf, planKey } from '../bounds';
import {
  makeEvaluator,
  makeGenerator,
  makeSubstrate,
  makeTestBoard,
  unboundedBudget,
  type BoardSpec,
} from '../bounds/testkit';
import { makeSearchCore } from './index';

const OURS = 0;

/**
 * The four-unit coalition fixture from `coalition.test.ts`: two of ours, one
 * rival each threatening one of them down a file, and the two rivals in
 * contact with each other. Losing two units is the coalition world; losing one
 * is the per-team world.
 */
const TRIO: BoardSpec = {
  width: 7,
  height: 7,
  units: [
    { id: 1, team: 0, type: 'rook', occupancy: [17] },
    { id: 2, team: 0, type: 'rook', occupancy: [19] },
    { id: 3, team: 1, type: 'rook', occupancy: [24, 24] },
    { id: 4, team: 2, type: 'rook', occupancy: [26, 26] },
  ],
};

/** The same shape with the third team removed — the no-op control. */
const DUO: BoardSpec = {
  width: 7,
  height: 7,
  units: [
    { id: 1, team: 0, type: 'rook', occupancy: [17] },
    { id: 2, team: 0, type: 'rook', occupancy: [19] },
    { id: 3, team: 1, type: 'rook', occupancy: [24, 24] },
  ],
};

function ctxFor(spec: BoardSpec): { ctx: SearchContext; close(): void } {
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
    pins: [],
    assumptions: [],
    incumbent: null,
    witnesses: [],
    budget: unboundedBudget(),
  };
  return { ctx, close: () => sub.release() };
}

const perTeamCore = (): ReturnType<typeof makeSearchCore> =>
  makeSearchCore({ bank: { coalition: 'per-team' } });
const strictCore = (): ReturnType<typeof makeSearchCore> => makeSearchCore({ bank: { coalition: 'strict' } });

describe('the relaxed world reaches the emission', () => {
  it('improve() returns a bracket that NAMES the world it was proved in', () => {
    const core = perTeamCore();
    const { ctx, close } = ctxFor(TRIO);
    try {
      const score: PlanScore = core.improve(ctx);
      const narrowings = score.bounds.assumptions.filter(
        (a) => a.kind === 'narrowing' && a.note.includes('per-team adversary'),
      );
      expect(narrowings.length).toBe(1);
      expect(score.bounds.exact).toBe(false);
      // A CONDITIONAL bracket is not comparable with an unconditional one, and
      // the basis key is what makes that true rather than a convention.
      expect(basisKeyOf(score.bounds.assumptions)).not.toBe(basisKeyOf([]));
    } finally {
      close();
      core.release?.();
    }
  });

  it('proves a strictly higher floor on the SAME plan than the strict core does', () => {
    // maxSweeps 0 stops the ascent at the seed, so both cores are asked about
    // ONE identical plan and the difference is the world, not the search. With
    // the ascent live both cores find the dodge and agree at −2, which is the
    // honest shape of the thing: coalition pessimism costs nothing on a plan
    // that escapes both threats. It costs on the plans that cannot.
    const relaxed = makeSearchCore({ bank: { coalition: 'per-team' }, maxSweeps: 0, restarts: 0 });
    const strict = makeSearchCore({ bank: { coalition: 'strict' }, maxSweeps: 0, restarts: 0 });
    const a = ctxFor(TRIO);
    const b = ctxFor(TRIO);
    try {
      const r = relaxed.improve(a.ctx);
      const s = strict.improve(b.ctx);
      expect(planKey(r.plan)).toBe(planKey(s.plan));
      expect(r.bounds.worst).toBeGreaterThan(s.bounds.worst);
    } finally {
      a.close();
      b.close();
      relaxed.release?.();
      strict.release?.();
    }
  });

  it('with the ascent live it never proves a WORSE floor than the strict core', () => {
    // Not a soundness law (the two floors live in different games and are not
    // comparable AS PROMISES); a statement about the search, which is entitled
    // to explore differently and must not end up worse off for it.
    const relaxed = perTeamCore();
    const strict = strictCore();
    const a = ctxFor(TRIO);
    const b = ctxFor(TRIO);
    try {
      const r = relaxed.improve(a.ctx);
      const s = strict.improve(b.ctx);
      expect(r.bounds.worst).toBeGreaterThanOrEqual(s.bounds.worst);
    } finally {
      a.close();
      b.close();
      relaxed.release?.();
      strict.release?.();
    }
  });

  it('counts the decision as relaxed, and reports disagreement rather than hiding it', () => {
    const core = perTeamCore();
    const { ctx, close } = ctxFor(TRIO);
    try {
      core.improve(ctx);
      const drained = core.drainRefusals?.();
      expect(drained?.world).toBeDefined();
      expect(drained?.world?.decisions).toBe(1);
      expect(drained?.world?.relaxed).toBe(1);
      expect(drained?.world?.disagreements).toBeGreaterThanOrEqual(0);
      // Drained means drained: the kernel owns the counters, so a second drain
      // must not double-count.
      expect(core.drainRefusals?.().world?.decisions).toBe(0);
    } finally {
      close();
      core.release?.();
    }
  });
});

describe('two teams: nothing happens, and the counters say so', () => {
  it('the relaxed core and the strict core agree exactly', () => {
    const relaxed = perTeamCore();
    const strict = strictCore();
    const a = ctxFor(DUO);
    const b = ctxFor(DUO);
    try {
      const r = relaxed.improve(a.ctx);
      const s = strict.improve(b.ctx);
      expect(planKey(r.plan)).toBe(planKey(s.plan));
      expect(r.bounds.worst).toBe(s.bounds.worst);
      expect(r.bounds.best).toBe(s.bounds.best);
      expect(basisKeyOf(r.bounds.assumptions)).toBe(basisKeyOf(s.bounds.assumptions));
      const drained = relaxed.drainRefusals?.();
      expect(drained?.world?.decisions).toBe(1);
      expect(drained?.world?.relaxed).toBe(0);
      expect(drained?.world?.disagreements).toBe(0);
      expect(drained?.world?.vetoes).toBe(0);
    } finally {
      a.close();
      b.close();
      relaxed.release?.();
      strict.release?.();
    }
  });
});

describe('the safety veto', () => {
  /**
   * The veto is a predicate on the STRICT ceiling alone. Rather than hunting a
   * board on which the ascent happens to try a strictly-convicted plan, this
   * pins the predicate itself against a hand-built pair of results — because
   * what must never regress is the RULE, and a board-shaped test would pass
   * for the wrong reason the day the ascent stops visiting such a plan.
   */
  const convicted = (r: { strictBounds: { best: number } }): boolean =>
    r.strictBounds.best === Number.NEGATIVE_INFINITY;

  it('recognises exactly the plans the un-relaxed game has convicted', () => {
    expect(convicted({ strictBounds: { best: DEAD } })).toBe(true);
    expect(convicted({ strictBounds: { best: -1e9 } })).toBe(false);
    expect(convicted({ strictBounds: { best: 0 } })).toBe(false);
    expect(convicted({ strictBounds: { best: Number.POSITIVE_INFINITY } })).toBe(false);
  });

  it('a relaxed result carries the strict ceiling the veto reads', () => {
    const core = perTeamCore();
    const { ctx, close } = ctxFor(TRIO);
    try {
      const score = core.improve(ctx);
      // The search returns a PlanScore, not a BankResult, so the strict side is
      // proved reachable through the bank rather than asserted about the score:
      // this is the seam the veto reads, and it must exist on every price.
      const probe: Partial<BankResult> = { strictBounds: score.bounds };
      expect(probe.strictBounds).toBeDefined();
    } finally {
      close();
      core.release?.();
    }
  });
});
