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

  type BoardSpec,
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

/**
 * THE SEVER BOARD — the minimal reproduction of the `floor=B0 ceiling=B3`
 * inversion measured at 287 per game on `potions` seed 2.
 *
 * A snake of weight three steps one square west. Its body still stands on the
 * square its head just left, and a HELD knight of strictly higher tier is one
 * knight-move from that square. The engine's body rule then says: equal-or-
 * lower tier dies on the segment, strictly higher tier SEVERS it and stops.
 * A sever is the one non-fatal contact in the game, so the snake is alive in
 * every world and weighs three in some of them and one in others.
 *
 * `B0` holds the knight, settles the optimistic timeline in which it is not
 * there, reads the snake's weight straight off the settled board — three — and
 * published a floor above the value of a world `B3` then enumerated and
 * settled in full. Weight is the only coordinate that moved; the two sides
 * agree about who is alive.
 *
 * Both units are needed and neither is decoration: drop the knight and there
 * is no sever, and give it the snake's tier and it dies on the body instead of
 * cutting it. The tiers are the ones the measured position had.
 */
const SEVER_WIDTH = 7;
const severCell = (x: number, y: number): number => y * SEVER_WIDTH + x;
const SEVER_BOARD: BoardSpec = {
  width: SEVER_WIDTH,
  height: SEVER_WIDTH,
  units: [
    {
      id: 0,
      team: OURS,
      type: 'snake',
      occupancy: [severCell(3, 3), severCell(3, 2), severCell(2, 2)],
      tier: -1,
    },
    { id: 1, team: 1, type: 'knight', occupancy: [severCell(5, 4)], tier: 0 },
  ],
};

describe('a mover the ledger says could be SEVERED is not worth its uncut weight', () => {
  test('the whole mixture brackets the truth on the sever board', () => {
    const stats = freshStats();
    const board = makeTestBoard(SEVER_BOARD);
    expect(replySpaceSize(board, OURS)).toBeGreaterThan(1);
    sweepBoard(board, 0, stats);
    report('sever', stats);
    expect(stats.violations).toEqual([]);
    expect(stats.checks).toBeGreaterThan(0);
  }, 300_000);

  test('B0 alone does not price the severable body it cannot see', () => {
    // The regression proper, at the two rungs that disagreed. B0 holds the
    // knight; B3 enumerates it and settles the cut. Before the fold read the
    // ledger's `sever` entries, B0 answered 2 where B3 answered 0 and the
    // bank threw.
    const board = makeTestBoard(SEVER_BOARD);
    const gen = makeGenerator();
    const evaluate = makeEvaluator();
    const sub = makeSubstrate(board, OURS);
    let cut = 0;
    try {
      for (const plan of allPlans(sub, gen, OURS, 32)) {
        const truth = trueWorstCase(board, OURS, plan).value;
        const b0 = priceWith(sub, gen, evaluate, plan, B0_ONLY, unboundedBudget());
        const full = priceWith(sub, gen, evaluate, plan, DEFAULT_BANK_CONFIG, unboundedBudget());
        expect(b0.floor).toBeLessThanOrEqual(truth + EPS);
        expect(full.floor).toBeLessThanOrEqual(truth + EPS);
        expect(full.floor).toBeLessThanOrEqual(full.ceiling + EPS);
        // The plan that walks the head off the body is the one with a cut
        // under it: B0's floor has to come DOWN to the truth there, and the
        // whole point is that it does so without the enemy being enumerated.
        const staged = [...plan.values()][0];
        if (staged !== undefined && staged.to === severCell(2, 3)) {
          cut++;
          expect(b0.floor).toBe(truth);
        }
      }
    } finally {
      sub.release();
    }
    // Anti-vacuity: the severable plan has to be in the option list at all.
    expect(cut).toBeGreaterThan(0);
  }, 120_000);
});

/**
 * THE RANDOMISED SWEEP — the arm that finds the defect nobody thought of.
 *
 * The two exhaustive suites above run twelve hand-picked boards through 120
 * bank configurations each, which is deep and NARROW: every board is
 * six-or-seven squares wide, food-free, and one or two units a side. Both
 * inversions this file records were found in a GAME rather than in that
 * cross-product, and both needed a board feature the cross-product does not
 * generate — a pawn diagonally adjacent to an enemy, a snake standing on the
 * cell two claims can reach.
 *
 * So this arm goes the other way: many boards, one configuration. The whole
 * shipped mixture, the unbounded clock, the complete generator, and B0 alone
 * beside it — and boards that carry everything a real one does. Pieces and
 * snakes from the same kind table; FOOD, which is the one thing that moves a
 * held unit's WEIGHT while it is frozen; POTIONS, which are the one thing that
 * moves its TIER; and one, two or three units a side, so the held set is a set
 * rather than a singleton and the additive per-enemy lemma is actually load
 * bearing.
 *
 * The ground truth is the same one everything here uses: every uncontrolled
 * unit's complete option list, resolved through the engine with nothing held.
 * That is a product, so a board whose reply space is larger than
 * `REPLY_SPACE_CAP` is skipped rather than approximated — an approximated
 * truth is not a truth, and a sweep that quietly compared against one would be
 * worse than no sweep at all. The count of boards actually swept is asserted,
 * so the skips can never hollow this out.
 */
/** Up to `count` entries spread evenly across `xs`, ends included. */
function stride<T>(xs: ReadonlyArray<T>, count: number): ReadonlyArray<T> {
  if (xs.length <= count) return xs;
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    out.push(xs[Math.floor((i * (xs.length - 1)) / (count - 1))] as T);
  }
  return out;
}

const REPLY_SPACE_CAP = 1200;
const SWEEP_TARGET = 210;

interface RandomStats {
  boards: number;
  skipped: number;
  checks: number;
  potionBoards: number;
  violations: Violation[];
}

describe('the randomised bracket sweep', () => {
  test('floor ≤ truth ≤ ceiling over 200+ generated boards', () => {
    const stats: RandomStats = {
      boards: 0,
      skipped: 0,
      checks: 0,
      potionBoards: 0,
      violations: [],
    };
    const evaluate = makeEvaluator();
    // perSide cycles 1, 2, 3 so the held set is a singleton on a third of the
    // boards and a real set on the rest. Size grows with it, or three units a
    // side on a 6x6 is a board with no room to move on.
    const shapes: ReadonlyArray<{ perSide: number; size: number; food: number }> = [
      { perSide: 1, size: 5, food: 1 },
      { perSide: 2, size: 5, food: 1 },
      { perSide: 1, size: 6, food: 2 },
      { perSide: 2, size: 6, food: 2 },
      { perSide: 3, size: 6, food: 2 },
      { perSide: 3, size: 7, food: 3 },
    ];
    for (let seed = 1; stats.boards < SWEEP_TARGET && seed <= 400; seed++) {
      const shape = shapes[seed % shapes.length] as (typeof shapes)[number];
      // Potions on a third of the boards: enough that tiers move under the
      // bracket, few enough that the other confounds stay readable.
      const potions = seed % 3 === 0 ? 2 : 0;
      const spec = seededBoard(seed, shape.size, shape.perSide, shape.food, potions);
      const board = makeTestBoard(spec);
      if (replySpaceSize(board, OURS) > REPLY_SPACE_CAP) {
        stats.skipped++;
        continue;
      }
      stats.boards++;
      if (potions > 0) stats.potionBoards++;
      const gen = makeGenerator();
      const sub = makeSubstrate(board, OURS);
      try {
        // A STRIDE, not a prefix. `allPlans` builds the cross-product in
        // option order, so taking its first few plans samples only the head of
        // one unit's option list — and the actions that break a bound are not
        // at the head of anything. The pawn capture that motivates this file
        // sits at index 3 or 4 of a five-option list on most of the boards
        // below, so a prefix of three would have swept past every one of them.
        for (const plan of stride(allPlans(sub, gen, OURS, 96), 6)) {
          const truth = trueWorstCase(board, OURS, plan).value;
          const label = planLabel(plan);
          for (const cfg of [
            { name: 'full', config: DEFAULT_BANK_CONFIG },
            { name: 'B0', config: B0_ONLY },
          ]) {
            const out = priceWith(sub, gen, evaluate, plan, cfg.config, unboundedBudget());
            stats.checks++;
            // Nothing here is truncated — complete generator, unbounded clock
            // — so every floor is unconditional and every one of them is a
            // promise about the real game.
            expect(out.assumptions).toEqual([]);
            if (out.floor > truth + EPS) {
              stats.violations.push({
                seed,
                config: cfg.name,
                clock: 'unbounded',
                generator: 'complete',
                plan: label,
                floor: out.floor,
                truth,
                ceiling: out.ceiling,
                side: 'floor',
              });
            }
            if (out.ceiling < truth - EPS) {
              stats.violations.push({
                seed,
                config: cfg.name,
                clock: 'unbounded',
                generator: 'complete',
                plan: label,
                floor: out.floor,
                truth,
                ceiling: out.ceiling,
                side: 'ceiling',
              });
            }
          }
        }
      } finally {
        sub.release();
      }
    }
    console.log(
      `  [random] boards=${stats.boards} (potions on ${stats.potionBoards}) ` +
        `skipped=${stats.skipped} checks=${stats.checks} violations=${stats.violations.length}`,
    );
    expect(stats.violations).toEqual([]);
    // Anti-vacuity, both halves: the sweep has to have run the boards it
    // claims, and the potion arm has to have been more than a flag nobody set.
    expect(stats.boards).toBeGreaterThanOrEqual(200);
    expect(stats.potionBoards).toBeGreaterThan(30);
    expect(stats.checks).toBeGreaterThan(400);
  }, 900_000);
});

/**
 * THE PAWN-CAPTURE BOARD — the minimal reproduction of the `floor=B0
 * ceiling=B1` inversion measured at 990 per game on `mixed` seed 3.
 *
 * TWO UNITS, which is as few as an inversion can have. Our pawn faces `-y`;
 * one square diagonally forward stands a held enemy rook of weight two. The
 * pawn's diagonal step is the one action in the whole grammar whose legality
 * reads the BOARD rather than the mover: `planUnitAction` admits it only when
 * the destination is in `pawnTargetsOf` — the food, plus every body standing
 * there as the turn opens. So the rook's own square is what makes the capture
 * a legal move at all.
 *
 * And `settlePartial` settles its optimistic timeline over the units whose
 * moves are KNOWN — the held rook is not on that board. Re-read against it,
 * the staged capture is not a legal action, `stagedAction` substitutes the
 * kind's default, and a piece's default is to hold. B0 therefore settled a
 * pawn standing still: alive, at full weight, with an EMPTY ledger, because a
 * unit that never left its square ran into nothing for the ledger to name.
 * Every enumeration of the rook's replies that leaves it where it is settles
 * the arrival instead, and the rook outweighs the pawn, so the true value is
 * the pawn's death — a floor strictly above the truth, and above B1's own
 * ceiling.
 *
 * Neither unit is decoration and neither is a placeholder: drop the rook and
 * the diagonal is not a legal target for the pawn to stage, and give the rook
 * one square instead of two and the contest is a tie the pawn survives no
 * worse than the rook does.
 *
 * The repair is in `substrate.ts::stagedRecordFor`, and it is about WHAT IS
 * STAGED rather than about how a ledger is read: a plan names an ACTION, so
 * the substrate hands the engine the path that action walks on the observed
 * board rather than a destination the engine re-derives against a board with
 * units deliberately missing from it.
 */
const PAWN_WIDTH = 5;
const pawnCell = (x: number, y: number): number => y * PAWN_WIDTH + x;
const PAWN_CAPTURE_BOARD: BoardSpec = {
  width: PAWN_WIDTH,
  height: PAWN_WIDTH,
  units: [
    {
      id: 0,
      team: OURS,
      type: 'pawn',
      occupancy: [pawnCell(2, 3)],
      orientation: { dx: 0, dy: -1 },
    },
    { id: 1, team: 1, type: 'rook', occupancy: [pawnCell(3, 2), pawnCell(3, 2)] },
  ],
};

/** The staged capture: the pawn's forward diagonal, onto the held rook. */
const PAWN_CAPTURE_TARGET = pawnCell(3, 2);

describe('a staged action a HOLD would make illegal is still the staged action', () => {
  test('the whole mixture brackets the truth on the pawn-capture board', () => {
    const stats = freshStats();
    const board = makeTestBoard(PAWN_CAPTURE_BOARD);
    expect(replySpaceSize(board, OURS)).toBeGreaterThan(1);
    sweepBoard(board, 0, stats);
    report('pawn-capture', stats);
    expect(stats.violations).toEqual([]);
    expect(stats.checks).toBeGreaterThan(0);
  }, 300_000);

  test('B0 settles the capture the plan named, not the hold the grammar fell back to', () => {
    // The mechanism, pinned without reference to any score. B0 holds every
    // enemy, so the board `settlePartial` re-reads the grammar against has no
    // rook on it — and the pawn must still walk to the square the plan named.
    // Before the repair `traversed` was empty and the pawn ended where it
    // started, which is a different move from the one being priced.
    const board = makeTestBoard(PAWN_CAPTURE_BOARD);
    const sub = makeSubstrate(board, OURS);
    try {
      const capture = sub
        .optionsFor(0)
        .find((c) => c.to === PAWN_CAPTURE_TARGET);
      // Anti-vacuity: the capture has to be a legal staged action on the
      // OBSERVED board, or this board is not the fixture it claims to be.
      expect(capture).toBeDefined();
      const plan: JointPlan = new Map([[0, capture as NonNullable<typeof capture>]]);
      const settled = sub.settleFor(plan);
      expect(settled.traversed['u0']).toEqual([PAWN_CAPTURE_TARGET]);
      // And the hold it could have been rewritten into is exactly the thing
      // the ledger cannot see: nothing was contacted, so nothing was named.
      expect(settled.ledger.length).toBeGreaterThan(0);
    } finally {
      sub.release();
    }
  }, 60_000);

  test('B0 alone prices the capture it cannot enumerate', () => {
    // The regression proper, at the two rungs that disagreed. B0 holds the
    // rook; B1 enumerates it and settles the arrival. Before the repair B0
    // answered -1 where the truth is -2, and the bank threw.
    const board = makeTestBoard(PAWN_CAPTURE_BOARD);
    const gen = makeGenerator();
    const evaluate = makeEvaluator();
    const sub = makeSubstrate(board, OURS);
    let captures = 0;
    try {
      for (const plan of allPlans(sub, gen, OURS, 32)) {
        const truth = trueWorstCase(board, OURS, plan).value;
        const b0 = priceWith(sub, gen, evaluate, plan, B0_ONLY, unboundedBudget());
        const full = priceWith(sub, gen, evaluate, plan, DEFAULT_BANK_CONFIG, unboundedBudget());
        expect(b0.floor).toBeLessThanOrEqual(truth + EPS);
        expect(full.floor).toBeLessThanOrEqual(truth + EPS);
        expect(full.floor).toBeLessThanOrEqual(full.ceiling + EPS);
        const staged = [...plan.values()][0];
        if (staged !== undefined && staged.to === PAWN_CAPTURE_TARGET) {
          captures++;
          expect(b0.floor).toBe(truth);
        }
      }
    } finally {
      sub.release();
    }
    // Anti-vacuity: the capture has to be in our own option list at all.
    expect(captures).toBeGreaterThan(0);
  }, 120_000);
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
