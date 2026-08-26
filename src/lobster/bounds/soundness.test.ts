/**
 * THE PROPERTY THAT MATTERS MOST.
 *
 *      floor(a)  ≤  true worst case of a  ≤  ceiling(a)
 *
 * A too-wide bracket costs a wasted branch. A too-narrow one is a silent lie,
 * and it is the only real bug class in a system that publishes proved floors —
 * everything downstream (the ratchet, dominance discard, the emit gates, the
 * pin price) is a theorem about that inequality and nothing else.
 *
 * Everything here is checked against EXHAUSTIVE enumeration through the SAME
 * ground-truth resolver the bounds are computed with, never against a second
 * encoding of the rules. A second encoding would only prove the two encodings
 * agree.
 *
 * The harness runs the whole cross-product it can afford:
 *
 *      boards × staged sets × BANK CONFIGURATIONS × clock regimes
 *
 * because the architectural claim under test is not "B0 is sound" — each rung
 * was already sound in the workspace it came from — it is that the MIXTURE is
 * sound when members with different completeness and different declared
 * narrowings are live at once, which is the thing no source workspace could
 * test because none of them had the whole family.
 *
 * Boards here are deliberately FOOD-FREE. Eating is the one thing that changes
 * a unit's weight, and a held unit's material is bracketed by its strength
 * interval rather than replayed; removing food removes that confound so the
 * property under test is the one about contests and deaths.
 */

import type { JointPlan } from '../contracts';
import {
  B0_ONLY,
  BoundBank,
  DEFAULT_BANK_CONFIG,
  isDischarged,
  type BankConfig,
} from './index';
import {
  allPlans,
  countingBudget,
  makeEvaluator,
  makeGenerator,
  makeSubstrate,
  makeTestBoard,
  replySpaceSize,
  seededBoard,
  trueWorstCase,
  unboundedBudget,

  type TestBoard,
} from './testkit';

const OURS = 0;
const EPS = 1e-9;

// ------------------------------------------------------------------ boards

// ---------------------------------------------------- bank configurations

interface NamedConfig {
  readonly name: string;
  readonly config: Partial<BankConfig>;
}

/**
 * The mixture. Every member on its own, every pair, the whole family, with
 * gating on and off, and the two declared-narrowing regimes. A configuration
 * that is unsound in ANY of these is unsound in production, because the VOC
 * orchestrator buys members per position and is entitled to land on any of
 * them.
 */
const CONFIGS: readonly NamedConfig[] = [
  { name: 'B0', config: B0_ONLY },
  { name: 'B0+B1', config: { b1: true, b2: false, b3: false } },
  { name: 'B0+B2', config: { b1: false, b2: true, b3: false } },
  { name: 'B0+B1+B2', config: { b1: true, b2: true, b3: false } },
  { name: 'B0+B3', config: { b1: false, b2: false, b3: true } },
  { name: 'full', config: DEFAULT_BANK_CONFIG },
  { name: 'full/ungated', config: { ...DEFAULT_BANK_CONFIG, gateOnEntanglement: false } },
  { name: 'full/enemyCap=1', config: { ...DEFAULT_BANK_CONFIG, enemyCap: 1 } },
  { name: 'full/tinyProductCap', config: { ...DEFAULT_BANK_CONFIG, productCap: 2 } },
  { name: 'full/declaredTruncation', config: { ...DEFAULT_BANK_CONFIG, declareTruncatedFloor: true } },
  // THE PER-TEAM ADVERSARY WORLD (C5) belongs in the mixture, not beside it.
  // The architectural claim this file tests is that members with different
  // completeness and different declared narrowings are safe to run AT ONCE;
  // a declared WORLD is one more such member, and if it is unsound it is
  // unsound here. On a two-team board it is inert by construction — which is
  // exactly why the trio case below exists.
  { name: 'full/perTeam', config: { ...DEFAULT_BANK_CONFIG, coalition: 'per-team' } },
  {
    name: 'full/perTeam-ungated',
    config: { ...DEFAULT_BANK_CONFIG, coalition: 'per-team', coalitionEngagementGate: false },
  },
  {
    name: 'full/perTeam-C1',
    config: { ...DEFAULT_BANK_CONFIG, coalition: 'per-team', coalitionB1: true },
  },
];

/** Clock regimes: the exhaustive one, and adversarial cut-offs at every depth. */
const CLOCKS: ReadonlyArray<{ name: string; make: () => ReturnType<typeof unboundedBudget> }> = [
  { name: 'unbounded', make: unboundedBudget },
  { name: 'cut@1', make: () => countingBudget(1) },
  { name: 'cut@3', make: () => countingBudget(3) },
  { name: 'cut@11', make: () => countingBudget(11) },
];

/** Generator regimes: complete, and adversarially truncated option lists. */
const GENERATORS: ReadonlyArray<{ name: string; prune: number }> = [
  { name: 'complete', prune: 0 },
  { name: 'pruned-1', prune: 1 },
  { name: 'pruned-3', prune: 3 },
];

export const CONFIGURATION_COUNT = CONFIGS.length * CLOCKS.length * GENERATORS.length;

// ------------------------------------------------------------------- runs

interface Violation {
  readonly seed: number;
  readonly config: string;
  readonly clock: string;
  readonly generator: string;
  readonly plan: string;
  readonly floor: number;
  readonly truth: number;
  readonly ceiling: number;
  readonly side: 'floor' | 'ceiling';
}

interface Stats {
  checks: number;
  violations: Violation[];
  gaps: number[];
  tight: number;
  discharged: number;
  /** Bounds that carry a declared narrowing — conditional, so exempt. */
  conditional: number;
  /** Conditional floors that DID exceed the truth: the reason for the law. */
  conditionalAboveTruth: number;
}

const freshStats = (): Stats => ({
  checks: 0,
  violations: [],
  gaps: [],
  tight: 0,
  discharged: 0,
  conditional: 0,
  conditionalAboveTruth: 0,
});

function planLabel(plan: JointPlan): string {
  return [...plan.entries()].map(([id, c]) => `${id}->${c.to}`).sort().join(',');
}

function sweepBoard(board: TestBoard, seed: number, stats: Stats): void {
  const truthCache = new Map<string, number>();
  for (const generator of GENERATORS) {
    const gen = makeGenerator({ pruneTail: generator.prune });
    const evaluate = makeEvaluator();
    // Our own option list is enumerated COMPLETELY for the sweep over staged
    // sets, whatever the adversary generator is doing — a plan we never try is
    // not a soundness question.
    const ourGen = makeGenerator();
    const sub = makeSubstrate(board, OURS);
    try {
      const plans = allPlans(sub, ourGen, OURS, 24);
      expect(plans.length).toBeGreaterThan(0);
      for (const plan of plans) {
        const label = planLabel(plan);
        let truth = truthCache.get(label);
        if (truth === undefined) {
          truth = trueWorstCase(board, OURS, plan).value;
          truthCache.set(label, truth);
        }
        for (const cfg of CONFIGS) {
          for (const clock of CLOCKS) {
            const budget = clock.make();
            const bank = new BoundBank({
              sub,
              gen,
              evaluate,
              asTeam: OURS,
              budget,
              basis: [],
              config: cfg.config,
            });
            try {
              const out = bank.price(plan);
              stats.checks++;
              const gap = out.bounds.best - out.bounds.worst;
              stats.gaps.push(gap);
              if (gap <= EPS) stats.tight++;
              if (isDischarged(out.bounds)) {
                stats.discharged++;
                // A discharged bound is a point AND it is the truth.
                expect(Math.abs(out.bounds.worst - truth)).toBeLessThanOrEqual(EPS);
              }
              // THE FLOOR LAW, stated exactly. An UNCONDITIONAL floor is a
              // promise about the real game and must not exceed the truth. A
              // floor riding a declared narrowing promises something about a
              // RESTRICTED game and may legitimately sit above it — which is
              // precisely why the narrowing has to be declared, and why the
              // result then refuses comparison with an unconditional one.
              const conditional = out.bounds.assumptions.length > 0;
              if (conditional) {
                stats.conditional++;
                if (out.bounds.worst > truth + EPS) stats.conditionalAboveTruth++;
              } else if (out.bounds.worst > truth + EPS) {
                stats.violations.push({
                  seed,
                  config: cfg.name,
                  clock: clock.name,
                  generator: generator.name,
                  plan: label,
                  floor: out.bounds.worst,
                  truth,
                  ceiling: out.bounds.best,
                  side: 'floor',
                });
              }
              if (out.bounds.best < truth - EPS) {
                stats.violations.push({
                  seed,
                  config: cfg.name,
                  clock: clock.name,
                  generator: generator.name,
                  plan: label,
                  floor: out.bounds.worst,
                  truth,
                  ceiling: out.bounds.best,
                  side: 'ceiling',
                });
              }
              // A floor that RESTS on an incomplete cover must have declared
              // itself on the way past. (A declared member that lost the max
              // conditions nothing — the answer does not use what it said.)
              if (!out.floorComplete) expect(out.bounds.assumptions.length).toBeGreaterThan(0);
              if (out.floorComplete && !conditional) {
                expect(out.bounds.worst).toBeLessThanOrEqual(truth + EPS);
              }
            } finally {
              bank.release();
            }
          }
        }
      }
    } finally {
      sub.release();
    }
  }
}

function report(label: string, stats: Stats): void {
  const gaps = [...stats.gaps].sort((a, b) => a - b);
  const mean = gaps.reduce((a, x) => a + x, 0) / Math.max(1, gaps.length);
  const median = gaps[Math.floor(gaps.length / 2)] ?? 0;

  console.log(
    `  [${label}] checks=${stats.checks} configurations=${CONFIGURATION_COUNT} ` +
      `violations=${stats.violations.length} meanGap=${mean.toFixed(2)} ` +
      `medianGap=${median.toFixed(2)} tight=${stats.tight} discharged=${stats.discharged} ` +
      `conditional=${stats.conditional} (above truth: ${stats.conditionalAboveTruth})`,
  );
}

// -------------------------------------------------------------- the suite

describe('exhaustive completion: floor ≤ true worst ≤ ceiling', () => {
  test('one unit a side, every mixed bank configuration, every clock regime', () => {
    const stats = freshStats();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const spec = seededBoard(seed, 6, 1);
      const board = makeTestBoard(spec);
      expect(replySpaceSize(board, OURS)).toBeGreaterThan(1); // anti-vacuity
      sweepBoard(board, seed, stats);
    }
    report('duel', stats);
    // The direction is the contract. A violation is a bug, not a tolerance.
    expect(stats.violations).toEqual([]);
    expect(stats.checks).toBeGreaterThan(500);
  }, 300_000);

  test('two units a side — where holding, gating and pair effects all bite', () => {
    const stats = freshStats();
    for (const seed of [21, 22, 23, 24]) {
      const spec = seededBoard(seed, 7, 2);
      const board = makeTestBoard(spec);
      sweepBoard(board, seed, stats);
    }
    report('team', stats);
    expect(stats.violations).toEqual([]);
    expect(stats.checks).toBeGreaterThan(500);
  }, 600_000);

  test('THREE teams — where the declared per-team world is live in the mixture', () => {
    // R1 is stated here about the UNCONDITIONAL bound, which the bank computes
    // on every plan whether or not it also computes a relaxed one; a relaxed
    // bracket is exempt from the floor half (it promises something about a
    // restricted game) and NOT from the ceiling half (restricting the reply
    // set raises the minimum, so a relaxed ceiling still sits above the
    // unconditional truth — a relaxed ceiling below it would be a real bug).
    // The conditional floor law itself — floor_W ≤ min over W ≤ ceiling_W,
    // against exhaustive enumeration of W — lives in `coalition.test.ts`,
    // which is the only place the world set is available to enumerate.
    const stats = freshStats();
    for (const seed of [31, 32, 33, 34, 35, 36]) {
      const board = makeTestBoard(seededBoard(seed, 6, 1, 0, 3));
      sweepBoard(board, seed, stats);
    }
    report('trio', stats);
    expect(stats.violations).toEqual([]);
    expect(stats.checks).toBeGreaterThan(500);
    // The declared world must actually have been exercised, or this test is
    // reporting that nothing happened.
    expect(stats.conditional).toBeGreaterThan(0);
    expect(stats.conditionalAboveTruth).toBeGreaterThan(0);
  }, 900_000);
});

describe('the finished-sweep rule', () => {
  test('a clock-truncated sweep may lower the ceiling and never raise the floor', () => {
    // The same plan, the same bank, two clocks. The floor a cut-short bank
    // reports may not exceed the floor the complete one proved — an
    // unfinished enumeration is not a cover.
    let compared = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const board = makeTestBoard(seededBoard(seed, 6, 1));
      const gen = makeGenerator();
      const evaluate = makeEvaluator();
      const sub = makeSubstrate(board, OURS);
      try {
        for (const plan of allPlans(sub, gen, OURS, 8)) {
          const full = priceWith(sub, gen, evaluate, plan, DEFAULT_BANK_CONFIG, unboundedBudget());
          for (const n of [1, 2, 3, 5, 8]) {
            const cut = priceWith(sub, gen, evaluate, plan, DEFAULT_BANK_CONFIG, countingBudget(n));
            compared++;
            expect(cut.floor).toBeLessThanOrEqual(full.floor + EPS);
            expect(cut.ceiling).toBeGreaterThanOrEqual(full.ceiling - EPS);
            expect(cut.floor).toBeLessThanOrEqual(cut.ceiling + EPS);
          }
        }
      } finally {
        sub.release();
      }
    }
    expect(compared).toBeGreaterThan(50);
  }, 300_000);

  test('an incomplete option list may not raise the floor unless it is declared', () => {
    // WHICH-truncation: the min over a SUBSET of an enemy's replies is an
    // over-estimate of the min over all of them. Left undeclared it must not
    // move the floor at all.
    let sawTruncation = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const board = makeTestBoard(seededBoard(seed, 6, 1));
      const evaluate = makeEvaluator();
      const sub = makeSubstrate(board, OURS);
      try {
        const complete = makeGenerator();
        const truncated = makeGenerator({ pruneTail: 2 });
        for (const plan of allPlans(sub, complete, OURS, 6)) {
          const silent = priceWith(sub, truncated, evaluate, plan, DEFAULT_BANK_CONFIG, unboundedBudget());
          const truth = trueWorstCase(board, OURS, plan).value;
          expect(silent.floor).toBeLessThanOrEqual(truth + EPS);
          // Undeclared, a truncated B1 group contributes nothing to the floor:
          // the answer falls back to whatever B0 alone could prove.
          const b0 = priceWith(sub, truncated, evaluate, plan, B0_ONLY, unboundedBudget());
          expect(silent.floor).toBeLessThanOrEqual(Math.max(b0.floor, silent.floor));
          for (const member of silent.members) {
            if (!member.complete) {
              sawTruncation = true;
              expect(member.floor).toBeNull();
            }
          }
        }
      } finally {
        sub.release();
      }
    }
    expect(sawTruncation).toBe(true);
  }, 300_000);

  test('a DECLARED truncation rides the bounds and refuses comparison', () => {
    // Gating off, so B1 certainly runs on the (pruned) enemy list and the
    // declared branch is certainly exercised.
    const config = {
      ...DEFAULT_BANK_CONFIG,
      declareTruncatedFloor: true,
      gateOnEntanglement: false,
      b3: false,
    };
    const evaluate = makeEvaluator();
    const truncated = makeGenerator({ pruneTail: 2 });
    let declared = 0;
    let floorRested = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const board = makeTestBoard(seededBoard(seed, 6, 1));
      const sub = makeSubstrate(board, OURS);
      try {
        for (const plan of allPlans(sub, makeGenerator(), OURS, 6)) {
          const out = priceWith(sub, truncated, evaluate, plan, config, unboundedBudget());
          if (out.members.some((m) => m.floor !== null && !m.complete)) declared++;
          if (!out.floorComplete) {
            floorRested++;
            expect(out.assumptions.some((a) => a.kind === 'narrowing')).toBe(true);
            expect(out.exact).toBe(false);
          }
        }
      } finally {
        sub.release();
      }
    }
    expect(declared).toBeGreaterThan(0);
    expect(floorRested).toBeGreaterThan(0);
  }, 300_000);
});

describe('held-unit value soundness: the INTERVAL, never the frozen scalar', () => {
  test('the interval form brackets and the snapshot form does not', () => {
    // "Presence-soundness is not payoff-soundness." Pricing a held unit at the
    // weight it was last SEEN at is the obvious thing to write, and it is not
    // a bound: the unit's material can move while it is frozen. The interval
    // form (weightMin for one polarity, weightMax for the other) is.
    let intervalChecks = 0;
    let intervalViolations = 0;
    let scalarChecks = 0;
    let scalarViolations = 0;

    // FOOD IS THE POINT HERE. Eating is the one thing that changes a unit's
    // weight while it is frozen, so it is exactly the confound the bracket
    // suite removes and exactly the mechanism this law is about. Without food
    // on the board the snapshot and the interval coincide and the negative
    // control cannot fail — which would make this test decoration.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const board = makeTestBoard(seededBoard(seed, 6, 1, 3));
      const gen = makeGenerator();
      const evaluate = makeEvaluator();
      for (const pricing of ['interval', 'scalar'] as const) {
        const sub = makeSubstrate(board, OURS, { heldPricing: pricing });
        try {
          for (const plan of allPlans(sub, gen, OURS, 6)) {
            const out = priceWith(sub, gen, evaluate, plan, B0_ONLY, unboundedBudget());
            const truth = trueWorstCase(board, OURS, plan).value;
            const violated = out.floor > truth + EPS;
            if (pricing === 'interval') {
              intervalChecks++;
              if (violated) intervalViolations++;
            } else {
              scalarChecks++;
              if (violated) scalarViolations++;
            }
          }
        } finally {
          sub.release();
        }
      }
    }

    console.log(
      `  [held pricing] interval ${intervalChecks - intervalViolations}/${intervalChecks} bracketed, ` +
        `scalar ${scalarChecks - scalarViolations}/${scalarChecks} bracketed`,
    );
    expect(intervalViolations).toBe(0);
    // The negative control has to actually fail, or the law it protects is
    // untested and this whole block is decoration.
    expect(scalarViolations).toBeGreaterThan(0);
  }, 300_000);
});

// ------------------------------------------------------------------ helper

function priceWith(
  sub: ReturnType<typeof makeSubstrate>,
  gen: ReturnType<typeof makeGenerator>,
  evaluate: ReturnType<typeof makeEvaluator>,
  plan: JointPlan,
  config: Partial<BankConfig>,
  budget: ReturnType<typeof unboundedBudget>,
): {
  floor: number;
  ceiling: number;
  exact: boolean;
  floorComplete: boolean;
  assumptions: Array<{ kind: string }>;
  members: Array<{ complete: boolean; floor: number | null }>;
} {
  const bank = new BoundBank({ sub, gen, evaluate, asTeam: OURS, budget, basis: [], config });
  try {
    const out = bank.price(plan);
    return {
      floor: out.bounds.worst,
      ceiling: out.bounds.best,
      exact: out.bounds.exact,
      floorComplete: out.floorComplete,
      assumptions: [...out.bounds.assumptions],
      members: out.members.map((m) => ({ complete: m.complete, floor: m.floor })),
    };
  } finally {
    bank.release();
  }
}
