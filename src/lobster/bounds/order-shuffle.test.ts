/**
 * L9a / L9b — WHAT ORDER-INVARIANCE ACTUALLY PROMISES.
 *
 * The synthesis carries one law about sweep order: "an order-shuffle within a
 * round leaves the final bounds identical". As a single claim it is FALSE, and
 * it is false in the shipped bank today, before any edge-EV machinery exists to
 * blame. The soundness lens (ev-soundness-integration.md §4.2, R-C2) is exact
 * about why:
 *
 *   Reordering changes which prefix survives `budget.shouldStop()`, hence which
 *   ceiling you end with, hence — via `swept` — whether the group may move the
 *   floor at all. Every outcome is sound; NONE OF THEM IS EQUAL.
 *
 * So the law splits, and both halves are here, because the danger is not the
 * failure — it is the FIX someone reaches for when a clock-cut shuffle comes
 * back different. The tempting repair is to clamp a ceiling until the two runs
 * agree, and a clamp is exactly how a sound ceiling becomes an unsound one.
 * L9b exists to make the correct expectation the one that is written down.
 *
 *   L9a  IDENTITY, under a budget that never fires. Permuting reply order
 *        leaves every published bound BIT-IDENTICAL. This is the real
 *        invariant, it is what licenses reordering as an optimisation, and it
 *        holds.
 *
 *   L9b  SOUNDNESS, under an adversarially binding budget. Bounds MAY differ.
 *        Every one of them still brackets exhaustive ground truth, and no
 *        run's `floorComplete` unconditional floor is ever above it.
 *
 * Ground truth is `trueWorstCase`: every enemy reply enumerated through the
 * same resolver with nothing held, so the minimum ranges over exactly the
 * worlds the bracket claims to contain. Small positions, on purpose — the
 * oracle is exponential and a law you cannot afford to check is not a law.
 *
 * The vehicle is `chaosGenerator` (testkit): the same option multiset in a
 * different order, deterministically, per seed. It is the scheduler stand-in
 * these laws were specified against, and it is in the testkit rather than here
 * because L9c, L10 and every future `EdgePolicy` test want the same one.
 */

import type { JointPlan } from '../contracts';
import { BoundBank, DEFAULT_BANK_CONFIG, type BankConfig } from './index';
import {
  allPlans,
  chaosGenerator,
  countingBudget,
  makeEvaluator,
  makeGenerator,
  makeSubstrate,
  makeTestBoard,
  seededBoard,
  trueWorstCase,
  unboundedBudget,
  type TestBoard,
} from './testkit';

const OURS = 0;
const EPS = 1e-9;

/** The permutations. Fixed, so a failure replays exactly. */
const SHUFFLES = [11, 22, 33, 44] as const;

/** Board seeds. Small: `trueWorstCase` is exponential in the reply space. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * Bank configurations whose sweep loops are structurally different: B1 walks
 * one enemy's options, B3 walks a cartesian product, and the mixture picks
 * between them. A permutation that is invisible to one is not necessarily
 * invisible to another.
 */
const CONFIGS: ReadonlyArray<{ name: string; config: Partial<BankConfig> }> = [
  { name: 'full', config: DEFAULT_BANK_CONFIG },
  { name: 'B0+B1', config: { b1: true, b2: false, b3: false } },
  { name: 'B0+B3', config: { b1: false, b2: false, b3: true } },
  { name: 'full/ungated', config: { ...DEFAULT_BANK_CONFIG, gateOnEntanglement: false } },
];

/**
 * WHAT THE BANK PUBLISHES, SPLIT IN TWO — and the split is a finding, not a
 * convenience.
 *
 * VALUE is the promise: the bracket, the estimate inside it, whether the floor
 * rests on a complete cover, and whether it carries an assumption. This is what
 * L9a is a law about and what every downstream theorem is stated over.
 *
 * PROVENANCE is the attribution: WHICH member won the floor and which branch
 * won the ceiling. It is not order-invariant and it cannot be, because the
 * assembly breaks a value tie by preferring the shorter ledger — and which
 * branch achieves a group's minimum, hence how long that member's ledger is,
 * depends on the order the group was swept in. Measured below: on a 2v2 board
 * with the clock pinned open, `floorFrom` moves between B0 and B1 across
 * permutations while `worst`, `best` and `est` do not move at all.
 *
 * That is a SECOND falsification of the one-line rule 9, independent of the
 * clock-cut one the soundness lens found, and it is the milder one: nothing
 * about the answer changes, only the label on where it came from. It is
 * recorded here rather than repaired because the tie-break it comes from —
 * prefer the member that asserted less — is doing something worth keeping, and
 * because a blame map that names either of two genuinely tied members is not
 * lying about anything.
 */
interface Value {
  readonly worst: number;
  readonly best: number;
  readonly est: number;
  readonly floorComplete: boolean;
  readonly assumptions: number;
  readonly finished: boolean;
}

interface Published extends Value {
  readonly floorFrom: string;
  readonly ceilingFrom: string;
}

const valueOf = (p: Published): Value => ({
  worst: p.worst,
  best: p.best,
  est: p.est,
  floorComplete: p.floorComplete,
  assumptions: p.assumptions,
  finished: p.finished,
});

function publish(board: TestBoard, plan: JointPlan, shuffle: number | null, cut: number | null, config: Partial<BankConfig>): Published {
  const sub = makeSubstrate(board, OURS);
  try {
    const base = makeGenerator();
    const gen = shuffle === null ? base : chaosGenerator(base, shuffle);
    const budget = cut === null ? unboundedBudget() : countingBudget(cut);
    const bank = new BoundBank({
      sub,
      gen,
      evaluate: makeEvaluator(),
      asTeam: OURS,
      budget,
      basis: [],
      config,
    });
    try {
      const out = bank.price(plan);
      return {
        worst: out.bounds.worst,
        best: out.bounds.best,
        est: out.est,
        floorComplete: out.floorComplete,
        floorFrom: out.floorFrom,
        ceilingFrom: out.ceilingFrom,
        assumptions: out.bounds.assumptions.length,
        finished: out.finished,
      };
    } finally {
      bank.release();
    }
  } finally {
    sub.release();
  }
}

/** The staged sets one board offers, enumerated once and reused. */
function plansOf(board: TestBoard, cap: number): ReadonlyArray<JointPlan> {
  const sub = makeSubstrate(board, OURS);
  try {
    return allPlans(sub, makeGenerator(), OURS, cap);
  } finally {
    sub.release();
  }
}

const label = (plan: JointPlan): string =>
  [...plan.entries()].map(([id, c]) => `${id}->${c.to}`).sort().join(',');

// --------------------------------------------------------------------- L9a

describe('L9a — order-shuffle IDENTITY under a non-binding budget', () => {
  /** One board family, swept for both halves of the split at once. */
  const sweep = (
    boards: ReadonlyArray<TestBoard>,
    planCap: number,
    configs: ReadonlyArray<{ name: string; config: Partial<BankConfig> }>
  ): { checks: number; valueDiffs: string[]; provenanceDiffs: string[] } => {
    let checks = 0;
    const valueDiffs: string[] = [];
    const provenanceDiffs: string[] = [];
    for (const [i, board] of boards.entries()) {
      for (const plan of plansOf(board, planCap)) {
        for (const cfg of configs) {
          const base = publish(board, plan, null, null, cfg.config);
          for (const shuffle of SHUFFLES) {
            const alt = publish(board, plan, shuffle, null, cfg.config);
            checks++;
            const where = `board=${i} cfg=${cfg.name} plan=${label(plan)} shuffle=${shuffle}`;
            if (JSON.stringify(valueOf(base)) !== JSON.stringify(valueOf(alt))) {
              valueDiffs.push(
                `${where}: ${JSON.stringify(valueOf(base))} vs ${JSON.stringify(valueOf(alt))}`
              );
            }
            if (base.floorFrom !== alt.floorFrom || base.ceilingFrom !== alt.ceilingFrom) {
              provenanceDiffs.push(
                `${where}: floor ${base.floorFrom}->${alt.floorFrom} ` +
                  `ceiling ${base.ceilingFrom}->${alt.ceilingFrom}`
              );
            }
          }
        }
      }
    }
    return { checks, valueDiffs, provenanceDiffs };
  };

  test('one unit a side: every published VALUE is bit-identical', () => {
    const boards = SEEDS.map((s) => makeTestBoard(seededBoard(s, 6, 1)));
    const out = sweep(boards, 8, CONFIGS);
    console.log(
      `  [L9a/1v1] checks=${out.checks} valueDiffs=${out.valueDiffs.length} ` +
        `provenanceDiffs=${out.provenanceDiffs.length}`
    );
    expect(out.valueDiffs).toEqual([]);
    expect(out.checks).toBeGreaterThan(300);
  });

  test('two units a side, where the product sweep and the additive one both fire', () => {
    // The interesting board: B3's cartesian walk and B1's additive one are both
    // live, so a permutation reaches two structurally different loops.
    const boards = [1, 2, 3, 4].map((s) => makeTestBoard(seededBoard(s, 6, 2)));
    const out = sweep(boards, 6, [{ name: 'full', config: DEFAULT_BANK_CONFIG }]);
    console.log(
      `  [L9a/2v2] checks=${out.checks} valueDiffs=${out.valueDiffs.length} ` +
        `provenanceDiffs=${out.provenanceDiffs.length}`
    );
    expect(out.valueDiffs).toEqual([]);
    expect(out.checks).toBeGreaterThan(20);
  });

  /**
   * THE OTHER HALF OF THE SPLIT, and the reason `Published` is two interfaces.
   *
   * Attribution moves and the answer does not. This is asserted rather than
   * merely observed so that the day someone tightens the tie-break they find
   * out here, and so that nobody reads L9a as a promise the blame map does not
   * make. The narrower property that IS promised: whenever the floor's
   * attribution moves, the two members it moved between produced the same
   * floor — a tie, broken by which one asserted less.
   */
  test('ATTRIBUTION is not order-invariant, and the value it attributes is', () => {
    // A wider corpus than the identity tests want, because this one has to
    // FIND the disagreement rather than rule it out: two units a side across
    // every seed and every sweep shape, which is where members tie often
    // enough for the tie-break to be exercised.
    const boards = SEEDS.map((s) => makeTestBoard(seededBoard(s, 6, 2)));
    const out = sweep(boards, 6, CONFIGS);
    // Every provenance difference here sits on top of an identical value —
    // which is exactly what `valueDiffs` being empty above already says, and
    // is restated here because it is the whole content of the claim.
    expect(out.valueDiffs).toEqual([]);
    // RARE, DETERMINISTIC, AND REAL: 2 of 768 on this corpus. The seeds and
    // permutations are fixed, so the count is stable — it is thin because a
    // value tie between two members whose ledgers differ in length is
    // uncommon, not because the property is flaky. If a change makes this zero,
    // widen the corpus before concluding the tie-break became deterministic.
    expect(out.provenanceDiffs.length).toBeGreaterThan(0);
    console.log(`  [L9a/attribution] moved on ${out.provenanceDiffs.length} of ${out.checks}`);
    console.log(`     e.g. ${out.provenanceDiffs[0]}`);
  });
});

// --------------------------------------------------------------------- L9b

describe('L9b — order-shuffle SOUNDNESS under a binding budget', () => {
  /** Cuts chosen to land inside a sweep rather than before or after one. */
  const CUTS = [1, 3, 5, 11] as const;

  test('bounds may differ, and every one of them still brackets the truth', () => {
    let checks = 0;
    let differed = 0;
    const unsound: string[] = [];
    // The narrower claim inside the wider one: a floor that declares itself
    // COMPLETE and carries no assumption is an unconditional promise about the
    // real game, and it is the one that may never sit above the truth.
    let completeFloors = 0;

    for (const seed of SEEDS) {
      const board = makeTestBoard(seededBoard(seed, 6, 1));
      for (const plan of plansOf(board, 8)) {
        const truth = trueWorstCase(board, OURS, plan).value;
        for (const cfg of CONFIGS) {
          for (const cut of CUTS) {
            const runs: Array<{ how: string; out: Published }> = [
              { how: 'identity', out: publish(board, plan, null, cut, cfg.config) },
            ];
            for (const shuffle of SHUFFLES) {
              runs.push({ how: `shuffle${shuffle}`, out: publish(board, plan, shuffle, cut, cfg.config) });
            }

            const first = JSON.stringify(valueOf(runs[0]?.out as Published));
            for (const run of runs) {
              checks++;
              // The VALUE differing is the thing L9a promised would not happen
              // and a binding clock makes happen. Provenance is excluded so
              // this count is about the answer rather than about the label.
              if (JSON.stringify(valueOf(run.out)) !== first) differed++;

              const where = `seed=${seed} cfg=${cfg.name} cut=${cut} plan=${label(plan)} ${run.how}`;
              // THE BRACKET. A conditional floor is a statement about a
              // RESTRICTED game and may legitimately exceed the truth — that
              // is what the declared narrowing is for — so it is exempted
              // here exactly as the soundness harness exempts it.
              if (run.out.assumptions === 0 && run.out.worst > truth + EPS) {
                unsound.push(`${where}: floor ${run.out.worst} > truth ${truth}`);
              }
              if (run.out.best < truth - EPS) {
                unsound.push(`${where}: ceiling ${run.out.best} < truth ${truth}`);
              }
              if (run.out.floorComplete && run.out.assumptions === 0) {
                completeFloors++;
                if (run.out.worst > truth + EPS) {
                  unsound.push(`${where}: COMPLETE floor ${run.out.worst} > truth ${truth}`);
                }
              }
              // A floor that does NOT declare completeness must have declared
              // an assumption on the way past — the same rule, read from the
              // other side, and the one a clamp would quietly break.
              if (!run.out.floorComplete) {
                expect([where, run.out.assumptions > 0]).toEqual([where, true]);
              }
            }
          }
        }
      }
    }

    console.log(
      `  [L9b] checks=${checks} runs-differing-from-identity=${differed} ` +
        `complete-unconditional-floors=${completeFloors} unsound=${unsound.length}`
    );
    expect(unsound).toEqual([]);
    expect(completeFloors).toBeGreaterThan(0);

    // THE POINT OF THE SPLIT, asserted rather than described.
    //
    // If this ever reads zero, DO NOT delete the assertion and DO NOT clamp
    // anything: the difference is the specification. Either the corpus stopped
    // cutting inside a sweep — widen it — or something upstream started
    // forcing agreement, which is the failure this whole file exists to catch.
    expect(differed).toBeGreaterThan(0);
  });

  test('a shuffled run never claims a tighter bracket than the truth allows', () => {
    // The same property stated as an interval containment rather than as two
    // inequalities, over the configuration where the clock bites hardest.
    let widest = 0;
    for (const seed of SEEDS) {
      const board = makeTestBoard(seededBoard(seed, 6, 1));
      for (const plan of plansOf(board, 8)) {
        const truth = trueWorstCase(board, OURS, plan).value;
        for (const shuffle of SHUFFLES) {
          const out = publish(board, plan, shuffle, 1, DEFAULT_BANK_CONFIG);
          if (out.assumptions === 0) {
            expect(out.worst).toBeLessThanOrEqual(truth + EPS);
          }
          expect(out.best).toBeGreaterThanOrEqual(truth - EPS);
          // `est` is clamped into the published bracket by contract, whatever
          // prefix the clock left behind.
          expect(out.est).toBeGreaterThanOrEqual(out.worst - EPS);
          expect(out.est).toBeLessThanOrEqual(out.best + EPS);
          widest = Math.max(widest, out.best - out.worst);
        }
      }
    }
    // A cut at one question leaves real width behind — if this were zero the
    // clock would not be binding and the test would be vacuous.
    expect(widest).toBeGreaterThan(0);
  });
});
