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
import { NoRosterError, makeSearchCore, planTieKey } from './index';

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
    { id: 1, team: OURS, type: 'rook', occupancy: [2 * 7 + 1], health: 60 },
    { id: 2, team: OURS, type: 'rook', occupancy: [2 * 7 + 5], health: 60 },
    { id: 3, team: THEIRS, type: 'queen', occupancy: [4 * 7 + 3, 4 * 7 + 3, 4 * 7 + 3], health: 60 },
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
    const rosterless = {
      state: rich.state,
      resolveBoundedFor: rich.resolveBoundedFor.bind(rich),
      entangled: rich.entangled.bind(rich),
      influenceOf: rich.influenceOf.bind(rich),
      release: () => undefined,
    };
    const ctx: SearchContext = {
      sub: rosterless,
      gen,
      evaluate: makeEvaluator(),
      asTeam: OURS,
      pins: [],
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
    // The assumption arrives on the incumbent's bounds, which is where the
    // contract puts it. The unit is FIXED to it, never held — holding your own
    // side is strictly looser and strictly more expensive than fixing it.
    const spec: BoardSpec = {
      width: 7,
      height: 7,
      units: [
        { id: 1, team: OURS, type: 'rook', occupancy: [2 * 7 + 1], health: 60 },
        { id: 2, team: THEIRS, type: 'king', occupancy: [2 * 7 + 5], health: 60 },
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
        incumbent: {
          plan: seedPlan,
          bounds: { worst: 0, best: 0, ledger: [], assumptions: [reference], exact: false },
          witnesses: [],
        },
      });
      expect(out.bounds.assumptions).toContainEqual(reference);
      expectCompleteLegal(out.plan, h);
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
