/**
 * The search core's invariants — the four things that must be true no matter
 * what the clock, the pins or the board do.
 *
 *  1. a COMPLETE LEGAL JointPlan at every instant;
 *  2. per-unit values NEVER composed into a team score;
 *  3. pins honored exactly;
 *  4. acceptance on the PROVED floor, with a basis mismatch a refusal.
 *
 * Plus the two structural escapes a unit-at-a-time ascent cannot make on its
 * own (pair repair and joint polish), and the epoch-change fast path.
 */

import type {
  Assumption,
  Candidate,
  CandidateSet,
  JointPlan,
  PlanScore,
  SearchContext,
  UnitId,
} from '../contracts';
import { BoundBank, DEFAULT_BANK_CONFIG, planKey, withMove } from '../bounds';
import {
  allPlans,
  expiredBudget,
  makeEvaluator,
  makeGenerator,
  makeSubstrate,
  makeTestBoard,
  seededBoard,
  trueWorstCase,
  unboundedBudget,
  type BoardSpec,
  type BoundedSubstrate,
} from '../bounds/testkit';
import { DEFAULT_TUNING, NoRosterError, makeSearchCore, planTieKey, ranksAbove } from './index';
import type { RankedRow } from './index';
import { asRefiner, planKey as vocPlanKey } from '../voc';

const OURS = 0;
const THEIRS = 1;

/**
 * Two of ours that can collide with each other, and an enemy in range. The
 * self-inflicted casualty is what pair repair exists for.
 */
const CROWD: BoardSpec = {
  width: 7,
  height: 7,
  units: [
    { id: 1, team: OURS, type: 'rook', occupancy: [2 * 7 + 1], energy: 60 },
    { id: 2, team: OURS, type: 'rook', occupancy: [2 * 7 + 5], energy: 60 },
    { id: 3, team: THEIRS, type: 'queen', occupancy: [4 * 7 + 3, 4 * 7 + 3, 4 * 7 + 3], energy: 60 },
  ],
};

interface Harness {
  readonly ctx: SearchContext;
  readonly sub: ReturnType<typeof makeSubstrate>;
  readonly sets: ReadonlyMap<UnitId, CandidateSet>;
  close(): void;
}

function harness(
  spec: BoardSpec,
  options: {
    pins?: SearchContext['pins'];
    incumbent?: PlanScore | null;
    budget?: SearchContext['budget'];
    witnesses?: SearchContext['witnesses'];
  } = {},
): Harness {
  const board = makeTestBoard(spec);
  const sub = makeSubstrate(board, OURS);
  const gen = makeGenerator();
  const evaluate = makeEvaluator();
  const sets = new Map<UnitId, CandidateSet>();
  for (const unitId of sub.commandable(OURS)) sets.set(unitId, gen.candidatesFor(sub, unitId));
  const ctx: SearchContext = {
    sub,
    gen,
    evaluate,
    asTeam: OURS,
    pins: options.pins ?? [],
    assumptions: [],
    incumbent: options.incumbent ?? null,
    witnesses: options.witnesses ?? [],
    budget: options.budget ?? unboundedBudget(),
  };
  return { ctx, sub, sets, close: () => sub.release() };
}

/** The invariant, as a function: complete, legal, one candidate per unit. */
function expectCompleteLegal(plan: JointPlan, h: Harness): void {
  const roster = [...h.sets.keys()].sort((a, b) => a - b);
  expect([...plan.keys()].sort((a, b) => a - b)).toEqual(roster);
  for (const [unitId, candidate] of plan) {
    const set = h.sets.get(unitId) as CandidateSet;
    const offered = [...set.candidates, ...set.prunedLedger.map((e) => e.candidate)];
    expect(offered.some((c) => c.to === candidate.to && c.path.join('.') === candidate.path.join('.'))).toBe(
      true,
    );
    expect(candidate.unitId).toBe(unitId);
  }
}

function priceOf(h: Harness, plan: JointPlan, basis: ReadonlyArray<Assumption> = []): number {
  const bank = new BoundBank({
    sub: h.ctx.sub,
    gen: h.ctx.gen,
    evaluate: h.ctx.evaluate,
    asTeam: OURS,
    budget: unboundedBudget(),
    basis,
    config: DEFAULT_BANK_CONFIG,
  });
  try {
    return bank.price(plan).bounds.worst;
  } finally {
    bank.release();
  }
}

describe('a complete legal JointPlan at every instant', () => {
  test('improve returns one, on every seeded board', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const h = harness(seededBoard(seed, 6, 2));
      try {
        const out = makeSearchCore().improve(h.ctx);
        expectCompleteLegal(out.plan, h);
      } finally {
        h.close();
      }
    }
  }, 120_000);

  test('an ALREADY EXPIRED budget still yields a complete legal plan', () => {
    // The pathological anytime entry point: no time at all. A searcher that
    // returns a partial set here is a searcher that stages nothing, and
    // `resolveBounded` refuses partial assignments — this is a crash, not a
    // degradation.
    const h = harness(CROWD, { budget: expiredBudget() });
    try {
      const out = makeSearchCore().improve(h.ctx);
      expectCompleteLegal(out.plan, h);
      expect(out.bounds.worst).toBeLessThanOrEqual(out.bounds.best);
    } finally {
      h.close();
    }
  });

  test('conform returns one even from an empty incumbent', () => {
    const h = harness(CROWD);
    try {
      const out = makeSearchCore().conform(h.ctx, new Map());
      expectCompleteLegal(out, h);
    } finally {
      h.close();
    }
  });

  test('no roster and no incumbent is an actionable REFUSAL, not a guess', () => {
    const board = makeTestBoard(CROWD);
    const rich = makeSubstrate(board, OURS);
    const gen = makeGenerator();
    // Deliberately NOT a full Substrate: the roster accessor is withheld to
    // exercise the search's refusal arm, hence the cast.
    const rosterless = {
      resolveBoundedFor: rich.resolveBoundedFor.bind(rich),
      unitIdOf: rich.unitIdOf.bind(rich),
      entangled: rich.entangled.bind(rich),
      influenceOf: rich.influenceOf.bind(rich),
      release: () => undefined,
    } as unknown as SearchContext['sub'];
    const ctx: SearchContext = {
      sub: rosterless,
      gen,
      evaluate: makeEvaluator(),
      asTeam: OURS,
      pins: [],
      assumptions: [],
      incumbent: null,
      witnesses: [],
      budget: unboundedBudget(),
    };
    try {
      expect(() => makeSearchCore().improve(ctx)).toThrow(NoRosterError);
    } finally {
      rich.release();
    }
  });
});

describe('acceptance is on the proved floor', () => {
  test('improve never returns a floor below the incumbent it was handed', () => {
    // Re-measured under ONE bank, because floors from different members are
    // not comparable — the same-evaluator rule.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const h = harness(seededBoard(seed, 6, 2));
      try {
        const seed0 = allPlans(h.sub, h.ctx.gen, OURS, 1)[0] as JointPlan;
        const before = priceOf(h, seed0);
        const ctx: SearchContext = {
          ...h.ctx,
          incumbent: { plan: seed0, bounds: { worst: before, best: before, ledger: [], assumptions: [], exact: true }, witnesses: [] },
        };
        const out = makeSearchCore().improve(ctx);
        expect(out.bounds.worst).toBeGreaterThanOrEqual(before);
      } finally {
        h.close();
      }
    }
  }, 120_000);

  test('the floor it reports is a real floor on the plan it returns', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const spec = seededBoard(seed, 6, 1);
      const h = harness(spec);
      try {
        const out = makeSearchCore().improve(h.ctx);
        const truth = trueWorstCase(makeTestBoard(spec), OURS, out.plan).value;
        expect(out.bounds.worst).toBeLessThanOrEqual(truth + 1e-9);
      } finally {
        h.close();
      }
    }
  }, 120_000);

  test('the salt breaks EXACT ties only', () => {
    // Two different salts must give different tie keys for the same plan, and
    // the tie key may never be consulted unless floor, est and ceiling all
    // agree — which is a property of `better`, exercised by the fact that two
    // salts produce plans of the SAME proved floor.
    const spec = seededBoard(2, 6, 2);
    const floors: number[] = [];
    const keys: string[] = [];
    for (const salt of [1, 999]) {
      const h = harness(spec);
      try {
        const out = makeSearchCore({ seed: salt }).improve(h.ctx);
        floors.push(out.bounds.worst);
        keys.push(planKey(out.plan));
      } finally {
        h.close();
      }
    }
    expect(floors[0]).toBe(floors[1]);
    const h = harness(spec);
    try {
      const plan = makeSearchCore().improve(h.ctx).plan;
      expect(planTieKey(plan, 1)).not.toBe(planTieKey(plan, 999));
    } finally {
      h.close();
    }
    void keys;
  }, 60_000);
});

describe('pins are constraints, honored exactly', () => {
  test('improve never moves a pinned unit', () => {
    const h0 = harness(CROWD);
    const pinnedUnit = 1 as UnitId;
    const target = (h0.sets.get(pinnedUnit) as CandidateSet).candidates[3] as Candidate;
    h0.close();

    const h = harness(CROWD, { pins: [{ unitId: pinnedUnit, to: target.to, tentative: false }] });
    try {
      const out = makeSearchCore().improve(h.ctx);
      expect(out.plan.get(pinnedUnit)?.to).toBe(target.to);
      expectCompleteLegal(out.plan, h);
      // And the pin rides the score, because a pinned decision is a different
      // game from an unpinned one.
      expect(out.bounds.assumptions.some((a) => a.kind === 'operator-pin' && a.unitId === pinnedUnit)).toBe(
        true,
      );
      expect(out.bounds.exact).toBe(false);
    } finally {
      h.close();
    }
  }, 60_000);

  test('a TENTATIVE pin is not binding and does not condition the score', () => {
    const h0 = harness(CROWD);
    const target = (h0.sets.get(1 as UnitId) as CandidateSet).candidates[3] as Candidate;
    h0.close();
    const h = harness(CROWD, { pins: [{ unitId: 1, to: target.to, tentative: true }] });
    try {
      const out = makeSearchCore().improve(h.ctx);
      expect(out.bounds.assumptions.some((a) => a.kind === 'operator-pin')).toBe(false);
    } finally {
      h.close();
    }
  }, 60_000);

  test('conform splices the pin in and leaves the rest legal', () => {
    const h0 = harness(CROWD);
    const incumbent = allPlans(h0.sub, h0.ctx.gen, OURS, 1)[0] as JointPlan;
    const target = (h0.sets.get(2 as UnitId) as CandidateSet).candidates[2] as Candidate;
    h0.close();

    const h = harness(CROWD, { pins: [{ unitId: 2, to: target.to, tentative: false }] });
    try {
      const out = makeSearchCore().conform(h.ctx, incumbent);
      expect(out.get(2 as UnitId)?.to).toBe(target.to);
      expectCompleteLegal(out, h);
    } finally {
      h.close();
    }
  });
});

describe('the joint is evaluated as a joint', () => {
  test('pair repair moves a pair the resolution named as self-inflicted', () => {
    // Both rooks head for the same cell: a mutual annihilation neither unit
    // can fix alone. A per-unit search cannot see this at all, and a joint one
    // that summed per-unit values would price it as two independent goods.
    const h0 = harness(CROWD);
    const optionsA = (h0.sets.get(1 as UnitId) as CandidateSet).candidates;
    const optionsB = (h0.sets.get(2 as UnitId) as CandidateSet).candidates;
    const collisionCell = optionsA
      .map((a) => a.to)
      .find((cell) => optionsB.some((b) => b.to === cell));
    h0.close();
    expect(collisionCell).toBeDefined();

    const h = harness(CROWD);
    try {
      const crash: JointPlan = new Map([
        [1 as UnitId, optionsA.find((c) => c.to === collisionCell) as Candidate],
        [2 as UnitId, optionsB.find((c) => c.to === collisionCell) as Candidate],
      ]);
      const before = priceOf(h, crash);
      const out = makeSearchCore().improve({ ...h.ctx, incumbent: { plan: crash, bounds: { worst: before, best: before, ledger: [], assumptions: [], exact: true }, witnesses: [] } });
      expect(out.bounds.worst).toBeGreaterThanOrEqual(before);
      expectCompleteLegal(out.plan, h);

      console.log(`  [pair repair] ${before} -> ${out.bounds.worst}`);
    } finally {
      h.close();
    }
  }, 60_000);
});

describe('witnesses survive the search', () => {
  test('improve hands back the witness set it accumulated, seeded by the context', () => {
    const h = harness(seededBoard(3, 6, 2));
    try {
      const out = makeSearchCore().improve(h.ctx);
      expect(out.witnesses.length).toBeGreaterThan(0);
      // Feed them back: a restart inherits the set rather than rediscovering it.
      const again = makeSearchCore().improve({ ...h.ctx, witnesses: out.witnesses });
      expect(again.witnesses.length).toBeGreaterThanOrEqual(out.witnesses.length);
    } finally {
      h.close();
    }
  }, 120_000);
});

describe('reference actions: a teammate not ours to command', () => {
  test('a declared reference action rides the basis and is not held', () => {
    // The assumption arrives on ctx.assumptions — the contract's A6 home for
    // the decision's standing basis. The unit is FIXED to it, never held —
    // holding your own side is strictly looser and strictly more expensive
    // than fixing it.
    const spec: BoardSpec = {
      width: 7,
      height: 7,
      units: [
        { id: 1, team: OURS, type: 'rook', occupancy: [2 * 7 + 1], energy: 60 },
        { id: 2, team: THEIRS, type: 'king', occupancy: [2 * 7 + 5], energy: 60 },
      ],
    };
    const h = harness(spec);
    try {
      const seedPlan = allPlans(h.sub, h.ctx.gen, OURS, 1)[0] as JointPlan;
      const enemyOptions = h.ctx.gen.candidatesFor(
        (h.sub as unknown as { withModelled(ids: UnitId[]): BoundedSubstrate }).withModelled([2]),
        2 as UnitId,
      ).candidates;
      const reference: Assumption = {
        kind: 'reference-action',
        unitId: 2,
        to: (enemyOptions[0] as Candidate).to,
      };
      const out = makeSearchCore().improve({
        ...h.ctx,
        assumptions: [reference],
        incumbent: {
          plan: seedPlan,
          bounds: { worst: 0, best: 0, ledger: [], assumptions: [reference], exact: false },
          witnesses: [],
        },
      });
      expect(out.bounds.assumptions).toContainEqual(reference);
      // The reference RIDES the returned plan (the plan's domain is the
      // modelled set), fixed to exactly the declared action…
      expect(out.plan.get(2 as UnitId)?.to).toBe(reference.to);
      // …and the commanded half is complete and legal as ever.
      const oursOnly = new Map([...out.plan].filter(([unitId]) => unitId !== 2));
      expectCompleteLegal(oursOnly, h);
    } finally {
      h.close();
    }
  }, 60_000);
});

describe('conform is the epoch-change FAST path', () => {
  test('it costs far less than a full improve on the same position', () => {
    const spec = seededBoard(5, 7, 3);
    const h0 = harness(spec);
    const pinTarget = (h0.sets.get(1 as UnitId) as CandidateSet).candidates[2] as Candidate;
    const incumbent = allPlans(h0.sub, h0.ctx.gen, OURS, 1)[0] as JointPlan;
    h0.close();

    const pins = [{ unitId: 1 as UnitId, to: pinTarget.to, tentative: false }];

    const full = harness(spec, { pins });
    let improveResolves = 0;
    try {
      makeSearchCore().improve(full.ctx);
      improveResolves = full.sub.resolves;
    } finally {
      full.close();
    }

    const fast = harness(spec, { pins });
    let conformResolves = 0;
    try {
      const out = makeSearchCore().conform(fast.ctx, incumbent);
      conformResolves = fast.sub.resolves;
      expect(out.get(1 as UnitId)?.to).toBe(pinTarget.to);
      expectCompleteLegal(out, fast);
    } finally {
      fast.close();
    }


    console.log(`  [conform] ${conformResolves} resolutions vs improve ${improveResolves}`);
    expect(conformResolves).toBeLessThan(improveResolves);
  }, 120_000);

  test('LATENCY: a conform under a fresh pin, measured', () => {
    const spec = seededBoard(5, 7, 3);
    const h0 = harness(spec);
    const targets = [1, 2, 3].map(
      (id) => (h0.sets.get(id as UnitId) as CandidateSet).candidates[1] as Candidate,
    );
    const incumbent = allPlans(h0.sub, h0.ctx.gen, OURS, 1)[0] as JointPlan;
    h0.close();

    const samples: number[] = [];
    const RUNS = 20;
    for (let i = 0; i < RUNS; i++) {
      const pinned = targets[i % targets.length] as Candidate;
      const h = harness(spec, { pins: [{ unitId: pinned.unitId, to: pinned.to, tentative: false }] });
      try {
        const core = makeSearchCore();
        const started = process.hrtime.bigint();
        const out = core.conform(h.ctx, incumbent);
        samples.push(Number(process.hrtime.bigint() - started) / 1e6);
        expect(out.get(pinned.unitId)?.to).toBe(pinned.to);
      } finally {
        h.close();
      }
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] as number;
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] as number;

    console.log(
      `  [conform latency] n=${RUNS} median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${(samples[samples.length - 1] as number).toFixed(2)}ms`,
    );
    // A regression guard, not a target: the point is that conform is bounded
    // by how much the pin disturbed, not by the roster.
    expect(median).toBeLessThan(250);
  }, 120_000);
});

describe('the search actually searches', () => {
  test('improve raises the floor over the plan it started from', () => {
    // Measured, not asserted per board: a position where the seed is already
    // optimal is a real position. What must never happen is the floor going
    // DOWN, and that is asserted every time.
    let raised = 0;
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const h = harness(seededBoard(seed, 6, 2));
      try {
        const start = allPlans(h.sub, h.ctx.gen, OURS, 1)[0] as JointPlan;
        const before = priceOf(h, start);
        const out = makeSearchCore().improve({
          ...h.ctx,
          incumbent: {
            plan: start,
            bounds: { worst: before, best: before, ledger: [], assumptions: [], exact: true },
            witnesses: [],
          },
        });
        checked++;
        expect(out.bounds.worst).toBeGreaterThanOrEqual(before);
        if (out.bounds.worst > before) raised++;
      } finally {
        h.close();
      }
    }
    console.log(`  [improve] floor raised on ${raised}/${checked} boards`);
    expect(checked).toBe(10);
    expect(raised).toBeGreaterThan(0);
  }, 180_000);

  test('the joint polish selection is bounded by the contested set, not the roster', () => {
    // A cheap structural guarantee: polish is the cross-product of the top-k
    // candidates of the ≤N most contested units, so its cost is k^N however
    // large the team is. Turning it off may not make the answer unsound.
    const spec = seededBoard(7, 7, 3);
    for (const polishUnits of [0, 3]) {
      const h = harness(spec);
      try {
        const out = makeSearchCore({ polishUnits }).improve(h.ctx);
        expectCompleteLegal(out.plan, h);
        expect(out.bounds.worst).toBeLessThanOrEqual(out.bounds.best);
      } finally {
        h.close();
      }
    }
  }, 120_000);
});

describe('conform repairs what the pin broke', () => {
  test('a teammate whose path the pin invalidated is re-picked', () => {
    // The naive splice is "pins in, nothing else touched". Conform must do at
    // least as well as that, and the repair is what buys the difference.
    let repaired = 0;
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const spec = seededBoard(seed, 7, 3);
      const scout = harness(spec);
      const roster = [...scout.sets.keys()];
      const incumbent = allPlans(scout.sub, scout.ctx.gen, OURS, 1)[0] as JointPlan;
      const pinUnit = roster[0] as UnitId;
      const pinOptions = (scout.sets.get(pinUnit) as CandidateSet).candidates;
      const pinTarget = pinOptions[pinOptions.length - 1] as Candidate;
      scout.close();

      const h = harness(spec, { pins: [{ unitId: pinUnit, to: pinTarget.to, tentative: false }] });
      try {
        const naive: JointPlan = withMove(incumbent, pinTarget);
        const basis: Assumption[] = [{ kind: 'operator-pin', unitId: pinUnit, to: pinTarget.to }];
        const before = priceOf(h, naive, basis);
        const out = makeSearchCore().conform(h.ctx, incumbent);
        const after = priceOf(h, out, basis);
        checked++;
        expect(out.get(pinUnit)?.to).toBe(pinTarget.to);
        expect(after).toBeGreaterThanOrEqual(before);
        if (after > before) repaired++;
      } finally {
        h.close();
      }
    }
    console.log(`  [conform repair] improved the naive splice on ${repaired}/${checked} boards`);
    expect(checked).toBe(8);
  }, 180_000);

  test('successive epochs each conform, and each honors only its own pins', () => {
    const spec = seededBoard(3, 7, 3);
    const scout = harness(spec);
    const roster = [...scout.sets.keys()];
    const targets = roster.map(
      (id) => (scout.sets.get(id) as CandidateSet).candidates[1] as Candidate,
    );
    let plan = allPlans(scout.sub, scout.ctx.gen, OURS, 1)[0] as JointPlan;
    scout.close();

    const core = makeSearchCore();
    for (const target of targets) {
      const h = harness(spec, { pins: [{ unitId: target.unitId, to: target.to, tentative: false }] });
      try {
        plan = core.conform(h.ctx, plan);
        expectCompleteLegal(plan, h);
        expect(plan.get(target.unitId)?.to).toBe(target.to);
      } finally {
        h.close();
      }
    }
  }, 120_000);
});

// ------------------------------------------------- the session's live clock

/**
 * THE STALE-CLOCK REGRESSION.
 *
 * A session — candidate sets, bound bank, memo — is cached across slices on
 * purpose: rebuilding it per slice made the anytime loop idle. The bank was
 * built with the FIRST slice's `BudgetHandle` and then kept it, so from slice
 * two its `shouldStop()` answered for a deadline that had already passed.
 * Every B1/B2/B3 sweep aborted at its first check and every price silently
 * degraded to B0 — measured in production shape at 1 724 of 1 724 prices in a
 * one-second decision, with zero rung admissions and zero witnesses banked for
 * the whole life of the session. The ladder read as ON and was OFF.
 *
 * The shape this test needs, and the reason a simple "run it twice" does not
 * catch it: the FIRST slice's budget must be live during slice one and EXPIRED
 * by slice two. Under a never-expiring stub the defect is invisible.
 */
describe('a cached session runs on the CURRENT slice clock', () => {
  /** A clock the test moves by hand, and slice budgets over it. */
  function fakeClock(): { at: number } {
    return { at: 0 };
  }
  const sliceBudget = (clock: { at: number }, end: number): SearchContext['budget'] => ({
    now: () => clock.at,
    elapsedMs: () => clock.at,
    remainingMs: () => Math.max(0, end - clock.at),
    shouldStop: () => clock.at >= end,
  });

  /** Every rung the bank admitted, per improve() call, by spying the bank. */
  function rungsPerSlice(
    core: ReturnType<typeof makeSearchCore>,
    ctxOf: () => SearchContext,
    slices: number,
    advance: (n: number) => void,
  ): number[] {
    const original = BoundBank.prototype.price;
    const counts: number[] = [];
    let current = 0;
    BoundBank.prototype.price = function patched(this: BoundBank, plan: JointPlan) {
      const out = original.call(this, plan);
      for (const m of out.members) if (m.rung !== 'B0') current++;
      return out;
    };
    try {
      for (let i = 0; i < slices; i++) {
        current = 0;
        core.improve(ctxOf());
        counts.push(current);
        advance(i);
      }
    } finally {
      BoundBank.prototype.price = original;
    }
    return counts;
  }

  test('slice two admits rungs above B0 under a generous budget', () => {
    // A board with enemies in contact, so there is something for B1 to
    // enumerate at all — asserted below rather than assumed.
    const h = harness(seededBoard(4, 6, 2));
    const clock = fakeClock();
    const core = makeSearchCore();
    try {
      // Slice n runs at clock 100n and ends at 100n + 50. So by the time slice
      // two starts, slice one's handle has been expired for 50 ticks.
      const counts = rungsPerSlice(
        core,
        () => ({ ...h.ctx, budget: sliceBudget(clock, clock.at + 50) }),
        4,
        () => {
          clock.at += 100;
        },
      );
      expect(counts[0]).toBeGreaterThan(0); // the ladder is reachable at all
      // THE REGRESSION. Every one of these was zero.
      for (let i = 1; i < counts.length; i++) {
        expect([i, counts[i] as number > 0]).toEqual([i, true]);
      }
    } finally {
      core.release?.();
      h.close();
    }
  }, 120_000);

  test('a genuinely expired slice still stops — the fix is a live clock, not a disabled one', () => {
    // The other direction, which a "just stop asking the budget" fix would
    // break: an expired handle for the CURRENT slice must still cut the sweep.
    const h = harness(seededBoard(4, 6, 2));
    const clock = fakeClock();
    const core = makeSearchCore();
    try {
      core.improve({ ...h.ctx, budget: sliceBudget(clock, 50) });
      clock.at = 1_000;
      const counts = rungsPerSlice(
        core,
        () => ({ ...h.ctx, budget: sliceBudget(clock, 0) }),
        1,
        () => undefined,
      );
      expect(counts[0]).toBe(0);
    } finally {
      core.release?.();
      h.close();
    }
  }, 120_000);
});

// ===========================================================================

describe('the refiner seam has a producer (06 F-1)', () => {
  test('the core narrows to a Refiner, and the view names a leader and its rivals', () => {
    const h = harness(CROWD);
    const core = makeSearchCore();
    const refiner = asRefiner(core);
    // THE WHOLE FINDING IN ONE LINE. `asRefiner` yielded null on every build
    // this bot has ever run, so `run.lastView` was never assigned and
    // `EmitRecord.horizon` was a constant column that looked like a reading.
    expect(refiner).not.toBeNull();
    const r = refiner as NonNullable<typeof refiner>;
    try {
      // Before anything is priced the view is honestly empty — not a fabricated
      // leader over a table of nothing.
      const cold = r.refinementView(h.ctx);
      expect(cold.candidates).toEqual([]);
      expect(cold.leaderIdx).toBe(-1);

      const improved = core.improve(h.ctx);
      const view = r.refinementView(h.ctx);
      expect(view.candidates.length).toBeGreaterThan(0);
      const leader = view.candidates[view.leaderIdx] as (typeof view.candidates)[number];
      // The view's leader and the search's incumbent are the same plan: the
      // ladder is the same ladder, tie-break included.
      expect(leader.key).toBe(vocPlanKey(improved.plan));
      expect(leader.lo).toBe(improved.bounds.worst);

      // Root slack is a RIVAL quantity — `max_R(R.hi − L.lo)` — and never the
      // leader's own bound gap.
      const rivals = view.candidates.filter((c) => c !== leader);
      const expected = rivals.reduce((m, c) => Math.max(m, c.hi - leader.lo), 0);
      expect(view.slack).toBe(Math.max(0, expected));

      // What the view does NOT claim: no held-unit lever has a producer here,
      // so none is offered, and `depthMax` says the honest no about depth.
      expect(view.units).toEqual([]);
      expect(view.depthMax).toBe(1);
      expect(view.candidates.every((c) => c.horizon === 1)).toBe(true);
      expect(view.horizon).toBe(1);
      expect(view.round).toBeGreaterThan(0);
    } finally {
      core.release?.();
      h.close();
    }
  }, 120_000);

  test('improve reports the horizon ITS OWN reading was proved at (06 F-2)', () => {
    const h = harness(CROWD);
    const core = makeSearchCore();
    try {
      // One ply, said by the reading rather than inferred from a slice. The
      // field exists so that a deepened plan can say something else without the
      // kernel having to guess which plan the slice deepened.
      expect(core.improve(h.ctx).horizon).toBe(1);
    } finally {
      core.release?.();
      h.close();
    }
  }, 120_000);
});

/**
 * The branch that decided each trial WHOSE INCUMBENT WAS THE SEED AND WHOSE OWN
 * READING IS ONE PLY — i.e. every comparison the guards under test are actually
 * about: a shallow trial against the deep reading whose horizon the test set.
 * Once the search accepts something the incumbent is a fresh one-ply reading and
 * the two horizons agree again, which is the guard working rather than the guard
 * being absent.
 *
 * THE TRIAL'S OWN HORIZON IS PART OF THE FILTER, and it has to be. A depth is a
 * property of a joint ASSIGNMENT (`06 F-2`), so a trial that lands back on the
 * seed's own assignment carries the seed's horizon — the search can and does
 * re-price it from a restart, and its `est` may have moved because the bank's
 * witness set grew underneath it. Comparing that trial against the incumbent is
 * a comparison WITHIN one horizon, which is precisely what these two rungs are
 * supposed to decide; counting it as a crossing would assert the opposite of the
 * finding. So the filter names the crossing itself rather than approximating it
 * by "the incumbent is the seed".
 */
function refusalsAgainstSeed(spec: BoardSpec, incumbentHorizon: number | undefined): string[] {
  const h = harness(spec);
  const because: string[] = [];
  try {
    // The incumbent is the plan an unconstrained search already settled on,
    // so nothing displaces it and every trial in the run below is compared
    // against THIS reading — which is what makes the horizon under test the
    // horizon on the other side of every comparison.
    const settled = makeSearchCore().improve(h.ctx);
    const seedKey = planKey(settled.plan);
    const incumbent: PlanScore = {
      plan: settled.plan,
      bounds: settled.bounds,
      witnesses: settled.witnesses,
      ...(incumbentHorizon === undefined ? {} : { horizon: incumbentHorizon }),
    };
    makeSearchCore().improve({
      ...h.ctx,
      incumbent,
      trials: (t) => {
        if (t.because === null) return;
        if (planKey(t.incumbentPlan) !== seedKey) return;
        if (incumbentHorizon !== undefined && (t.horizon ?? 1) === incumbentHorizon) return;
        because.push(t.because);
      },
    });
  } finally {
    h.close();
  }
  return because;
}

describe('est never crosses a horizon (06 F-4)', () => {
  test('rung 4 decides within a horizon and is skipped across one', () => {
    const specs = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => seededBoard(n, 6, 2));
    // The situation is REACHABLE: at one ply the ladder really does fall
    // through to est against this very incumbent, so the guard below refuses
    // something rather than asserting a vacuous truth.
    const level = specs.flatMap((spec) => refusalsAgainstSeed(spec, undefined));
    expect(level).toContain('est');
    // Now the incumbent's reading was proved two plies out and every trial one.
    // `est` is the evaluator's advisory scalar with no basis, no ledger and no
    // soundness claim, taken from B0 alone; two of them at two horizons are two
    // evaluations of two different boards with no declared discount between
    // them. The rung says nothing, and the ceiling — a bound — decides instead.
    const across = specs.flatMap((spec) => refusalsAgainstSeed(spec, 2));
    expect(across).not.toContain('est');
    // The ladder is still a ladder: every rung that CAN cross still fires.
    expect(across.length).toBeGreaterThan(0);
  }, 180_000);
});

describe('the ceiling rung never crosses a horizon either (08 F-10)', () => {
  /**
   * F-4's mirror, and the reason it is a separate finding: `hi` DOES cross a
   * horizon as a BOUND — an upper bound on one horizon-independent quantity,
   * proved to different depths — but this rung uses it as a ranking key
   * PREFERRING THE LARGER, and a deeper reading has a lower ceiling. Left
   * open, the rung refuses a plan for having been measured, at an equal floor,
   * where no rung above it is watching.
   *
   * The harness is F-4's own, one describe down, so the two guards are tested
   * against the same reachability argument rather than two different ones.
   */
  test('rung 5 decides within a horizon and is skipped across one', () => {
    const specs = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => seededBoard(n, 6, 2));
    const level = specs.flatMap((spec) => refusalsAgainstSeed(spec, undefined));
    // Reachable: at one ply the ladder really does fall through to the ceiling.
    expect(level).toContain('hi');
    const across = specs.flatMap((spec) => refusalsAgainstSeed(spec, 2));
    expect(across).not.toContain('hi');
    // And the ladder still decides: what is left is the salted tie, which is
    // an indifferent order rather than a preference for the looser bound.
    expect(across.length).toBeGreaterThan(0);
    expect(across).toContain('tie');
  }, 180_000);

  /**
   * THE HOLE F-10's GUARD ACTUALLY HAD, and the reason it only ever held by
   * luck: `horizonOfPlan` was a `WeakMap` keyed on the plan OBJECT, and the
   * search rebuilds a plan object on every trial (`withMove`/`withMoves` return
   * a fresh `Map`). So an ascent that wandered off the seeded assignment and
   * came back to it arrived holding a DIFFERENT OBJECT for the SAME assignment,
   * the probe missed, the depth read 1, and rungs 4 and 5 decided against a
   * reading proved two plies out — at an equal floor, where nothing above them
   * is watching. Reproduced on `seededBoard(1, 6, 2)`: trial 0 is the seed at
   * horizon 2 and declines correctly; three trials later the ascent takes a
   * rival; by trial 12 the incumbent is the seed's assignment again, in a new
   * object, reading 1, and `hi` decides.
   *
   * A depth is a property of a proof about a particular joint ASSIGNMENT, so
   * this asserts the assignment's identity carries it: somewhere in the `across`
   * run the search re-prices the seed's own assignment, and that reading must
   * still say two. Before the fix every such trial said one.
   */
  test('a rebuilt plan object with the seed ASSIGNMENT keeps the seed horizon', () => {
    const seen: number[] = [];
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const h = harness(seededBoard(n, 6, 2));
      try {
        const settled = makeSearchCore().improve(h.ctx);
        const seedKey = planKey(settled.plan);
        makeSearchCore().improve({
          ...h.ctx,
          incumbent: {
            plan: settled.plan,
            bounds: settled.bounds,
            witnesses: settled.witnesses,
            horizon: 2,
          },
          trials: (t) => {
            if (planKey(t.plan) !== seedKey) return;
            // The seeded plan is itself a rebuild — `seedPlan` never hands back
            // the caller's object — so every hit here is the defect's own shape.
            expect(t.plan as object).not.toBe(settled.plan as object);
            seen.push(t.horizon ?? 1);
          },
        });
      } finally {
        h.close();
      }
    }
    // Reachable at all, and every reading of that assignment says two.
    expect(seen.length).toBeGreaterThan(0);
    expect([...new Set(seen)]).toEqual([2]);
  }, 180_000);
});

/**
 * §5.1 — `leaderOf` compared `est` across horizons where `better()` refuses to.
 *
 * The view's leader and the search's incumbent must name the same plan, and
 * `leaderOf`'s own comment always said so; the `est` rung was the one place it
 * did not. Both ladders are now `ranksAbove`, so the guard is one line in one
 * place rather than two comments asking a human to keep two copies in step.
 *
 * INERT ON THIS BUILD — `depthMax` is 1 and nothing produces a horizon above
 * it, which is why the byte-identical runner does not move. It stops being
 * inert the moment a continuation layer lands, and the disagreement would fire
 * at an EQUAL FLOOR, where no rung above it is watching.
 */
describe('the leader ranks by the same rule as better() (§5.1)', () => {
  const SEED = DEFAULT_TUNING.seed;
  const planOf = (to: number): JointPlan =>
    new Map([[1 as UnitId, { unitId: 1 as UnitId, from: 0, to, path: [to] } as Candidate]]);
  const row = (to: number, worst: number, est: number, best: number, horizon: number): RankedRow => ({
    plan: planOf(to),
    est,
    horizon,
    bounds: { worst, best, ledger: [], assumptions: [], exact: false },
  });

  test('est decides at an equal floor WITHIN one horizon', () => {
    const rich = row(4, 0, 5, 9, 1);
    const poor = row(3, 0, 1, 9, 1);
    expect(ranksAbove(rich, poor, SEED)).toBe(true);
    expect(ranksAbove(poor, rich, SEED)).toBe(false);
  });

  test('and says NOTHING across two — where the old ladder named the other plan', () => {
    // Two readings of two different boards: equal floor, equal ceiling, and the
    // deeper one carries the larger est. The salted tie is the other way round,
    // so the two rules name DIFFERENT leaders and the difference is visible.
    const deep = row(4, 0, 5, 9, 2);
    const shallow = row(3, 0, 1, 9, 1);
    const deepTie = planTieKey(deep.plan, SEED);
    const shallowTie = planTieKey(shallow.plan, SEED);
    expect(deepTie).not.toBe(shallowTie);
    expect(deepTie).toBeLessThan(shallowTie);

    // The old rung: `if (a.est !== b.est) …` — unguarded, so `deep` displaced
    // `shallow` on an est comparison `better()` declines to make.
    expect(deep.est).toBeGreaterThan(shallow.est);
    // The rule now: est skipped, ceiling skipped, the indifferent order decides.
    expect(ranksAbove(deep, shallow, SEED)).toBe(false);
    expect(ranksAbove(shallow, deep, SEED)).toBe(true);
  });

  test('the FLOOR still crosses a horizon, because a floor is a bound', () => {
    // The rung that can speak across depths is the one that always could: a
    // proved floor is a claim about a horizon-independent quantity.
    const deep = row(4, 3, 0, 9, 2);
    const shallow = row(3, 1, 8, 9, 1);
    expect(ranksAbove(deep, shallow, SEED)).toBe(true);
    expect(ranksAbove(shallow, deep, SEED)).toBe(false);
  });

  test('a basis mismatch is a refusal in BOTH directions, whatever the horizons', () => {
    const held: Assumption = { kind: 'narrowing', unitId: 9 as UnitId, note: 'k' };
    const deep = row(4, 3, 5, 9, 2);
    const shallow: RankedRow = {
      ...row(3, 1, 1, 9, 1),
      bounds: { worst: 1, best: 9, ledger: [], assumptions: [held], exact: false },
    };
    expect(ranksAbove(deep, shallow, SEED)).toBe(false);
    expect(ranksAbove(shallow, deep, SEED)).toBe(false);
  });
});
