/**
 * THE PER-TEAM ADVERSARY WORLD — soundness, and the exact shape of the claim.
 *
 * The strict soundness law (`soundness.test.ts`) is
 *
 *      floor(a)  ≤  true worst case of a over the FULL reply set  ≤  ceiling(a)
 *
 * and a relaxed floor DOES NOT SATISFY IT, by construction. That is not a bug
 * being tolerated; it is the whole content of the declaration, and the tests
 * here state the replacement law precisely rather than weakening the original:
 *
 *   R1-W (CONDITIONAL SOUNDNESS). For the DECLARED world set W,
 *
 *        floor_W(a)  ≤  min over W of V(a, ·)  ≤  ceiling_W(a)
 *
 *      checked against exhaustive enumeration of W through the same resolver.
 *
 *   R1 (UNCONDITIONAL SOUNDNESS) still holds of `strictBounds`, which the bank
 *      computes on every plan whether or not it also computes a relaxed one —
 *      so the relaxation ADDS a game, it does not replace one.
 *
 *   MONOTONICITY. floor_W(a) ≥ floor(a) always: W is a subset of the full
 *      reply set, so its minimum cannot be lower.
 *
 *   NON-DECORATION. floor_W(a) > true worst case over the full set happens,
 *      and is ASSERTED to happen. A declared narrowing that never actually
 *      moved above the unconditional truth would be a no-op wearing a warning
 *      label, and the law protecting it would be untested.
 *
 *   INCOMPARABILITY. `compareFloors(strict, relaxed)` REFUSES. The machinery
 *      already refuses; this pins that the integration did not find a way
 *      around it.
 *
 *   PLAN-INVARIANCE. Every plan one bank prices carries the same basis key.
 *      Without this the ascent silently freezes the first time the narrowing
 *      appears on one plan and not another.
 *
 *   TWO-TEAM NO-OP. On a two-team board the relaxed path is not merely
 *      inactive but UNREACHABLE, and the reported bound is the strict one.
 */

import type { Assumption, Candidate, JointPlan, UnitId } from '../contracts';
import { NO_ORDER_MOVE } from '../contracts';
import {
  BoundBank,
  DEFAULT_BANK_CONFIG,
  basisKeyOf,
  compareFloors,
  engagedRivals,
  isTeamAware,
  planPerTeamWorlds,
  type BankConfig,
} from './index';
import {
  allPlans,
  countingBudget,
  makeEvaluator,
  makeGenerator,
  makeSubstrate,
  makeTestBoard,
  seededBoard,
  trueWorstCase,
  trueWorstCaseInWorlds,
  unboundedBudget,
  type TestBoard,
} from './testkit';

const OURS = 0;
const EPS = 1e-9;

const STRICT: Partial<BankConfig> = { ...DEFAULT_BANK_CONFIG, coalition: 'strict' };
const PER_TEAM: Partial<BankConfig> = { ...DEFAULT_BANK_CONFIG, coalition: 'per-team' };
const PER_TEAM_UNGATED: Partial<BankConfig> = {
  ...DEFAULT_BANK_CONFIG,
  coalition: 'per-team',
  coalitionEngagementGate: false,
};

/** Small enough for exhaustive world enumeration, big enough for three teams. */
const trioBoards = (): ReadonlyArray<{ seed: number; board: TestBoard }> => {
  const out: Array<{ seed: number; board: TestBoard }> = [];
  for (let seed = 1; seed <= 14; seed++) {
    out.push({ seed, board: makeTestBoard(seededBoard(seed, 6, 1, 0, 3)) });
  }
  return out;
};

const duoBoards = (): ReadonlyArray<{ seed: number; board: TestBoard }> => {
  const out: Array<{ seed: number; board: TestBoard }> = [];
  for (let seed = 1; seed <= 8; seed++) {
    out.push({ seed, board: makeTestBoard(seededBoard(seed, 6, 1, 0, 2)) });
  }
  return out;
};

function bankFor(board: TestBoard, config: Partial<BankConfig>, prune = 0): BoundBank {
  return new BoundBank({
    sub: makeSubstrate(board, OURS),
    gen: makeGenerator({ pruneTail: prune }),
    evaluate: makeEvaluator(),
    asTeam: OURS,
    budget: unboundedBudget(),
    basis: [],
    config,
  });
}

// ------------------------------------------------------------ admissibility

describe('admissibility is structural, not tuned', () => {
  it('refuses on a two-team board: there is no cross-team coordination to relax', () => {
    let checked = 0;
    for (const { board } of duoBoards()) {
      const sub = makeSubstrate(board, OURS);
      try {
        const uncontrolled = sub.unitIds().filter((id) => !sub.commandable(OURS).includes(id));
        const worlds = planPerTeamWorlds(sub, uncontrolled, OURS);
        expect(worlds.admissible).toBe(false);
        expect(worlds.narrowing).toBeNull();
        expect(worlds.reason).toContain('rival team');
        checked++;
      } finally {
        sub.release();
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('refuses when the substrate cannot name a unit team', () => {
    const { board } = trioBoards()[0] as { board: TestBoard };
    const sub = makeSubstrate(board, OURS);
    try {
      // A substrate that answers everything EXCEPT `teamOf` — the honest
      // degradation path, and the only one that may not silently relax.
      const blind = new Proxy(sub, {
        get(target, prop, receiver): unknown {
          if (prop === 'teamOf') return undefined;
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? (value as (...a: never[]) => unknown).bind(target) : value;
        },
        has: (target, prop): boolean => prop !== 'teamOf' && Reflect.has(target, prop),
      });
      expect(isTeamAware(blind)).toBe(false);
      const worlds = planPerTeamWorlds(blind, sub.unitIds(), OURS);
      expect(worlds.admissible).toBe(false);
      expect(worlds.reason).toContain('team');
    } finally {
      sub.release();
    }
  });

  it('offers one world per rival team on a three-team board', () => {
    let admissible = 0;
    for (const { board } of trioBoards()) {
      const sub = makeSubstrate(board, OURS);
      try {
        const ours = new Set(sub.commandable(OURS));
        const uncontrolled = sub.unitIds().filter((id) => !ours.has(id));
        const worlds = planPerTeamWorlds(sub, uncontrolled, OURS, { requireEngagement: false });
        if (!worlds.admissible) continue;
        admissible++;
        expect(worlds.rivalTeams).toEqual([1, 2]);
        expect(worlds.worlds.length).toBe(2);
        for (const world of worlds.worlds) {
          expect(world.fixes.length).toBeGreaterThan(0);
          for (const fix of world.fixes) {
            // Every fixed unit belongs to a DIFFERENT rival team, and is fixed
            // to the kind's own default — a rule of the game, never a guess.
            expect(sub.teamOf(fix.unitId)).not.toBe(world.hostile);
            expect(fix.to).toBe(NO_ORDER_MOVE);
          }
        }
      } finally {
        sub.release();
      }
    }
    expect(admissible).toBeGreaterThan(0);
  });

  it('the engagement gate is a real filter, not a formality', () => {
    let gatedOut = 0;
    let engagedSomewhere = 0;
    for (const { board } of trioBoards()) {
      const sub = makeSubstrate(board, OURS);
      try {
        const ours = new Set(sub.commandable(OURS));
        const uncontrolled = sub.unitIds().filter((id) => !ours.has(id));
        const byTeam = new Map<number, UnitId[]>();
        for (const id of uncontrolled) {
          const team = sub.teamOf(id) as number;
          const list = byTeam.get(team);
          if (list === undefined) byTeam.set(team, [id]);
          else list.push(id);
        }
        if (engagedRivals(sub, byTeam).size > 0) engagedSomewhere++;
        const gated = planPerTeamWorlds(sub, uncontrolled, OURS, { requireEngagement: true });
        const ungated = planPerTeamWorlds(sub, uncontrolled, OURS, { requireEngagement: false });
        if (ungated.admissible && !gated.admissible) gatedOut++;
      } finally {
        sub.release();
      }
    }
    expect(engagedSomewhere).toBeGreaterThan(0);
    expect(gatedOut).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------- the no-op

describe('two teams: the relaxation is unreachable, not merely off', () => {
  it('reports the strict bound, identically, at identical cost', () => {
    let plans = 0;
    for (const { board } of duoBoards()) {
      const strict = bankFor(board, STRICT);
      const relaxed = bankFor(board, PER_TEAM_UNGATED);
      try {
        const sub = makeSubstrate(board, OURS);
        const gen = makeGenerator();
        const list = allPlans(sub, gen, OURS, 8);
        sub.release();
        for (const plan of list) {
          const a = strict.price(plan);
          const b = relaxed.price(plan);
          expect(b.speaks).toBe('strict');
          expect(b.relaxedBounds).toBeNull();
          expect(b.worldsPriced).toBe(0);
          expect(b.bounds.worst).toBe(a.bounds.worst);
          expect(b.bounds.best).toBe(a.bounds.best);
          expect(basisKeyOf(b.bounds.assumptions)).toBe(basisKeyOf(a.bounds.assumptions));
          expect(b.resolutions).toBe(a.resolutions);
          plans++;
        }
      } finally {
        strict.release();
        relaxed.release();
      }
    }
    expect(plans).toBeGreaterThan(10);
  });
});

// ----------------------------------------------------------------- the laws

interface WorldStats {
  checks: number;
  relaxedChecks: number;
  floorViolations: string[];
  ceilingViolations: string[];
  strictViolations: string[];
  monotonicityViolations: string[];
  aboveUnconditionalTruth: number;
  widthStrict: number[];
  widthRelaxed: number[];
  floorPairs: Array<{ strict: number; relaxed: number }>;
}

function runWorldLaws(config: Partial<BankConfig>, prune: number, cutAt: number | null): WorldStats {
  const stats: WorldStats = {
    checks: 0,
    relaxedChecks: 0,
    floorViolations: [],
    ceilingViolations: [],
    strictViolations: [],
    monotonicityViolations: [],
    aboveUnconditionalTruth: 0,
    widthStrict: [],
    widthRelaxed: [],
    floorPairs: [],
  };
  for (const { seed, board } of trioBoards()) {
    const sub = makeSubstrate(board, OURS);
    const gen = makeGenerator({ pruneTail: prune });
    const list = allPlans(sub, gen, OURS, 6);
    sub.release();

    const bank = new BoundBank({
      sub: makeSubstrate(board, OURS),
      gen,
      evaluate: makeEvaluator(),
      asTeam: OURS,
      budget: cutAt === null ? unboundedBudget() : countingBudget(cutAt),
      basis: [],
      config,
    });
    try {
      const declared = bank.worlds;
      for (const plan of list as ReadonlyArray<JointPlan>) {
        const out = bank.price(plan);
        stats.checks++;

        // R1 — the UNCONDITIONAL law, on the unconditional bound, always.
        const truth = trueWorstCase(board, OURS, plan).value;
        if (out.strictBounds.worst > truth + EPS || out.strictBounds.best < truth - EPS) {
          stats.strictViolations.push(
            `seed ${seed}: strict [${out.strictBounds.worst}, ${out.strictBounds.best}] excludes ${truth}`,
          );
        }
        stats.widthStrict.push(out.strictBounds.best - out.strictBounds.worst);

        if (out.relaxedBounds === null) continue;
        stats.relaxedChecks++;
        stats.widthRelaxed.push(out.relaxedBounds.best - out.relaxedBounds.worst);
        stats.floorPairs.push({ strict: out.strictBounds.worst, relaxed: out.relaxedBounds.worst });

        // MONOTONICITY — a subset's minimum cannot be lower.
        if (out.relaxedBounds.worst < out.strictBounds.worst - EPS) {
          stats.monotonicityViolations.push(
            `seed ${seed}: relaxed floor ${out.relaxedBounds.worst} below strict ${out.strictBounds.worst}`,
          );
        }

        // R1-W — the CONDITIONAL law, against exhaustive enumeration of W.
        const conditional = trueWorstCaseInWorlds(board, OURS, plan, declared.worlds).value;
        if (out.relaxedBounds.worst > conditional + EPS) {
          stats.floorViolations.push(
            `seed ${seed}: relaxed floor ${out.relaxedBounds.worst} above world truth ${conditional}`,
          );
        }
        if (out.relaxedBounds.best < conditional - EPS) {
          stats.ceilingViolations.push(
            `seed ${seed}: relaxed ceiling ${out.relaxedBounds.best} below world truth ${conditional}`,
          );
        }
        if (out.relaxedBounds.worst > truth + EPS) stats.aboveUnconditionalTruth++;
      }
    } finally {
      bank.release();
    }
  }
  return stats;
}

describe('R1-W: soundness WITHIN the declared world set', () => {
  const regimes: ReadonlyArray<{ name: string; config: Partial<BankConfig>; prune: number; cut: number | null }> = [
    { name: 'gated/complete/unbounded', config: PER_TEAM, prune: 0, cut: null },
    { name: 'ungated/complete/unbounded', config: PER_TEAM_UNGATED, prune: 0, cut: null },
    { name: 'ungated/pruned-1/unbounded', config: PER_TEAM_UNGATED, prune: 1, cut: null },
    { name: 'ungated/complete/cut@3', config: PER_TEAM_UNGATED, prune: 0, cut: 3 },
    { name: 'ungated/complete/cut@11', config: PER_TEAM_UNGATED, prune: 0, cut: 11 },
    {
      name: 'ungated/C1/unbounded',
      config: { ...PER_TEAM_UNGATED, coalitionB1: true },
      prune: 0,
      cut: null,
    },
  ];

  for (const regime of regimes) {
    it(`${regime.name}: floor_W ≤ min over W ≤ ceiling_W, and R1 still holds of the strict bound`, () => {
      const stats = runWorldLaws(regime.config, regime.prune, regime.cut);
      expect(stats.checks).toBeGreaterThan(0);
      expect(stats.strictViolations).toEqual([]);
      expect(stats.floorViolations).toEqual([]);
      expect(stats.ceilingViolations).toEqual([]);
      expect(stats.monotonicityViolations).toEqual([]);
    });
  }

  it('the declaration is not decoration: the relaxed floor DOES rise above the unconditional truth', () => {
    const stats = runWorldLaws(PER_TEAM_UNGATED, 0, null);
    expect(stats.relaxedChecks).toBeGreaterThan(0);
    expect(stats.aboveUnconditionalTruth).toBeGreaterThan(0);
  });

  it('the relaxed FLOOR is strictly higher on average — the thing does something', () => {
    const stats = runWorldLaws(PER_TEAM_UNGATED, 0, null);
    expect(stats.floorPairs.length).toBeGreaterThan(0);
    const lift = stats.floorPairs.filter((p) => p.relaxed > p.strict + EPS).length;
    expect(lift).toBeGreaterThan(0);
    // NOT a claim about the whole bracket. The relaxed CEILING is the min over
    // the declared worlds only — an unconditional ceiling is not an upper
    // bound on a restricted minimum — so it is legitimately LOOSER than the
    // strict ceiling, which gets to use B1/B3 branches the relaxed world may
    // not borrow. The floor is the side the search maximises and the side M4
    // measured, and it is the side this asserts.
  });
});

// ---------------------------------------------------------- basis identity

describe('the two games never compare', () => {
  it('compareFloors refuses a strict-vs-relaxed comparison', () => {
    let refusals = 0;
    for (const { board } of trioBoards()) {
      const bank = bankFor(board, PER_TEAM_UNGATED);
      try {
        const sub = makeSubstrate(board, OURS);
        const list = allPlans(sub, makeGenerator(), OURS, 4);
        sub.release();
        for (const plan of list) {
          const out = bank.price(plan);
          if (out.relaxedBounds === null) continue;
          const cmp = compareFloors(out.relaxedBounds, out.strictBounds);
          expect(cmp.comparable).toBe(false);
          refusals++;
        }
      } finally {
        bank.release();
      }
    }
    expect(refusals).toBeGreaterThan(0);
  });

  it('the narrowing is PLAN-INVARIANT, so the ascent can still compare its own plans', () => {
    let banks = 0;
    for (const { board } of trioBoards()) {
      const bank = bankFor(board, PER_TEAM_UNGATED);
      try {
        const sub = makeSubstrate(board, OURS);
        const list = allPlans(sub, makeGenerator(), OURS, 8);
        sub.release();
        const keys = new Set<string>();
        let relaxed = 0;
        for (const plan of list) {
          const out = bank.price(plan);
          if (out.relaxedBounds === null) continue;
          relaxed++;
          keys.add(basisKeyOf(out.relaxedBounds.assumptions));
        }
        if (relaxed === 0) continue;
        expect(keys.size).toBe(1);
        banks++;
      } finally {
        bank.release();
      }
    }
    expect(banks).toBeGreaterThan(0);
  });

  it('every relaxed bound names the world it was proved in', () => {
    let named = 0;
    for (const { board } of trioBoards()) {
      const bank = bankFor(board, PER_TEAM_UNGATED);
      try {
        const sub = makeSubstrate(board, OURS);
        const list = allPlans(sub, makeGenerator(), OURS, 4);
        sub.release();
        for (const plan of list) {
          const out = bank.price(plan);
          if (out.relaxedBounds === null) continue;
          const narrowings = out.relaxedBounds.assumptions.filter(
            (a: Assumption) => a.kind === 'narrowing' && a.note.includes('per-team adversary'),
          );
          expect(narrowings.length).toBe(1);
          expect(out.relaxedBounds.exact).toBe(false);
          named++;
        }
      } finally {
        bank.release();
      }
    }
    expect(named).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------- the fixtures

describe('a hand-built engaged trio', () => {
  /**
   * THE COALITION FICTION IN FOUR UNITS.
   *
   *   . . . . . . .
   *   . . . . . . .
   *   . . . P . Q .      P,Q ours (weight 1, row 2, files 3 and 5)
   *   . . . A . B .      A team 1, B team 2 (weight 2, row 3, same files)
   *
   * A can take P down its file; B can take Q down its file; and A and B are in
   * contact with each other through the empty cell between them, which is what
   * makes the relaxation arguable at all.
   *
   * Under the ONE-COALITION worst case both captures happen in the same world
   * and we lose two units. Under the per-team world set we lose ONE — whichever
   * team is the hostile one — because the other team's unit is fixed to the
   * kind's own default. The gap between −4 and −3 is the entire subject of this
   * cluster, on the smallest board that can show it.
   */
  const spec = {
    width: 7,
    height: 7,
    units: [
      { id: 1, team: 0, type: 'rook' as const, occupancy: [17] },
      { id: 2, team: 0, type: 'rook' as const, occupancy: [19] },
      { id: 3, team: 1, type: 'rook' as const, occupancy: [24, 24] },
      { id: 4, team: 2, type: 'rook' as const, occupancy: [26, 26] },
    ],
  };

  it('is admissible, engagement-gated, and both rivals are named engaged', () => {
    const board = makeTestBoard(spec);
    const sub = makeSubstrate(board, OURS);
    try {
      const worlds = planPerTeamWorlds(sub, [3, 4], OURS, { requireEngagement: true });
      expect(worlds.admissible).toBe(true);
      expect(worlds.engaged).toEqual([3, 4]);
      expect(worlds.worlds.map((w) => w.hostile)).toEqual([1, 2]);
      expect(worlds.worlds[0]?.fixes.map((c: Candidate) => c.unitId)).toEqual([4]);
      expect(worlds.worlds[1]?.fixes.map((c: Candidate) => c.unitId)).toEqual([3]);
    } finally {
      sub.release();
    }
  });

  it('narrows the floor on this board, and the narrowed floor is sound in W', () => {
    const board = makeTestBoard(spec);
    const bank = bankFor(board, PER_TEAM);
    try {
      const sub = makeSubstrate(board, OURS);
      const list = allPlans(sub, makeGenerator(), OURS, 6);
      sub.release();
      let improved = 0;
      for (const plan of list) {
        const out = bank.price(plan);
        expect(out.speaks).toBe('per-team');
        const relaxed = out.relaxedBounds;
        expect(relaxed).not.toBeNull();
        if (relaxed === null) continue;
        const conditional = trueWorstCaseInWorlds(board, OURS, plan, bank.worlds.worlds).value;
        expect(relaxed.worst).toBeLessThanOrEqual(conditional + EPS);
        expect(relaxed.best).toBeGreaterThanOrEqual(conditional - EPS);
        if (relaxed.worst > out.strictBounds.worst + EPS) improved++;
      }
      expect(improved).toBeGreaterThan(0);
    } finally {
      bank.release();
    }
  });
});
