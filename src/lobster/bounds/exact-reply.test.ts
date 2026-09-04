/**
 * THE EXACT-REPLY ORACLE, AS A STANDING GATE.
 *
 * `soundness.test.ts` proves `floor ≤ true worst ≤ ceiling` over hand-picked
 * and generated boards, with the material fold as the evaluator. This file
 * asks the same question of the SHIPPED evaluator on the boards a GAME
 * produces, which is where both recorded inversions were actually found: a
 * cross-product of small boards does not generate a potion window, a promoted
 * pawn, or a held cloud standing where two claims meet.
 *
 * Three arms:
 *
 *  1. ANTI-VACUITY. An instrument that cannot fail proves nothing, so the
 *     first test hands the oracle a floor one unit above the one the bank
 *     proved and requires it to refute it — and the proved floor beside it,
 *     which it must not.
 *  2. THE GAME ARM. A sampled slice of the sixteen-arm gate, in process. Every
 *     world it settles is a complete concrete world through the same engine,
 *     so a floor above one of them is a proof that the floor is wrong,
 *     whichever rung produced it and whether or not the bank's own members
 *     ever disagreed about it.
 *  3. THE DUMP. A violation found in a sixty-turn game is a fact about one
 *     board, and the repair belongs beside a case that fails on that board —
 *     so the dump has to be a board, not a summary of one, and the round trip
 *     is asserted rather than hoped for.
 *
 * The full arm is the loop file's Baseline command; what runs here is the
 * sampled one an ordinary `npx jest` can afford.
 */

import { EngineSubstrate } from '../substrate';
import { BoundBank, DEFAULT_BANK_CONFIG } from './bank';
import {
  boardOfDump,
  exactReplyCheck,
  exactStats,
  resetExactCheckSettings,
  resetExactStats,
  type ExactBoardDump,
} from './exact-reply';
import { modelledView } from './substrate-ext';
import {
  allPlans,
  makeEvaluator,
  makeGenerator,
  makeSubstrate,
  makeTestBoard,
  seededBoard,
  unboundedBudget,
} from './testkit';
import { runGame, SCENARIOS } from '../../tests/local-game';

const OURS = 0;

describe('the oracle refutes a wrong floor and clears a right one', () => {
  test('a floor one unit above the proved one is refuted by a real world', () => {
    let refuted = 0;
    let cleared = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const board = makeTestBoard(seededBoard(seed, 6, 1, 1, 2));
      const gen = makeGenerator();
      const evaluate = makeEvaluator();
      const sub = makeSubstrate(board, OURS);
      const held = board.spec.units.filter((u) => u.team !== OURS).map((u) => u.id);
      const view = modelledView(sub, held);
      try {
        for (const plan of allPlans(sub, gen, OURS, 4)) {
          const bank = new BoundBank({
            sub,
            gen,
            evaluate,
            asTeam: OURS,
            budget: unboundedBudget(),
            basis: [],
            config: DEFAULT_BANK_CONFIG,
          });
          try {
            const priced = bank.price(plan);
            const ask = {
              sub: view.sub,
              base: plan,
              held,
              evaluate,
              asTeam: OURS,
              floorFrom: priced.floorFrom,
              ceiling: priced.bounds.best,
              memberFloors: [],
              cap: 512,
            };
            const honest = exactReplyCheck({ ...ask, floor: priced.bounds.worst });
            if (honest.skipped !== null) continue;
            expect(honest.violations).toEqual([]);
            cleared++;
            // The same worlds, against a floor that is a lie by one unit.
            const lie = exactReplyCheck({ ...ask, floor: (honest.minValue as number) + 1 });
            expect(lie.violations.length).toBeGreaterThan(0);
            expect(lie.violations[0]?.side).toBe('floor');
            refuted++;
          } finally {
            bank.release();
          }
        }
      } finally {
        view.release();
        sub.release();
      }
    }
    expect(cleared).toBeGreaterThan(10);
    expect(refuted).toBe(cleared);
  }, 300_000);
});

describe('a sampled arm of the standing gate', () => {
  const arms: ReadonlyArray<{ scenario: string; seed: number; turns: number; rate: number }> = [
    // The arm the defect was reported on, at the sampled rate an ordinary test
    // run can afford. The Baseline command runs it to sixty turns at rate 10.
    { scenario: 'potions', seed: 4, turns: 10, rate: 40 },
    // One piece board and one snake board beside it: the floor rungs are the
    // same everywhere and a class that only fires on potions is a hypothesis,
    // not a finding.
    { scenario: 'mixed', seed: 1, turns: 6, rate: 60 },
    { scenario: 'snakes', seed: 2, turns: 6, rate: 60 },
  ];

  for (const arm of arms) {
    test(`${arm.scenario} seed ${arm.seed}: no floor above a concrete reply`, async () => {
      process.env.CENTAUR_EXACT_CHECK = String(arm.rate);
      process.env.CENTAUR_EXACT_CAP = '128';
      resetExactCheckSettings();
      resetExactStats();
      try {
        const spec = SCENARIOS[arm.scenario];
        expect(spec).toBeDefined();
        await runGame({
          ...(spec as (typeof SCENARIOS)[string]),
          seed: arm.seed,
          maxTurns: arm.turns,
          nodeBudget: 550,
        });
      } finally {
        delete process.env.CENTAUR_EXACT_CHECK;
        delete process.env.CENTAUR_EXACT_CAP;
        resetExactCheckSettings();
      }
      console.log(
        `  [exact ${arm.scenario}/${arm.seed}] checks=${exactStats.checks} ` +
          `worlds=${exactStats.worlds} complete=${exactStats.complete} ` +
          `floor=${exactStats.floorViolations} ceiling=${exactStats.ceilingViolations} ` +
          `skips=${JSON.stringify(exactStats.skips)}`,
      );
      // Anti-vacuity: the arm has to have looked at real worlds at all.
      expect(exactStats.checks).toBeGreaterThan(20);
      expect(exactStats.worlds).toBeGreaterThan(200);
      expect(exactStats.floorViolations).toBe(0);
      expect(exactStats.ceilingViolations).toBe(0);
    }, 600_000);
  }
});

describe('the dump is a board, not a summary of one', () => {
  test('a dumped position stands back up with the same roster and options', () => {
    const board = makeTestBoard(seededBoard(3, 6, 2, 1, 2));
    const dump: ExactBoardDump = {
      turn: board.turn,
      asTeam: 't0',
      width: board.marshalled.fullWidth,
      height: board.marshalled.fullHeight,
      units: board.marshalled.units,
      walls: [],
      hazards: [],
      hazardDamage: board.marshalled.config.hazardDamage,
      food: board.marshalled.config.food,
      regicideTeamIDs: board.marshalled.config.regicideTeamIDs ?? [],
      potions: board.marshalled.potions,
      potionsEnabled: board.marshalled.potionsEnabled,
      potionWindowTurns: board.marshalled.potionWindowTurns,
      pawnPromotionWeight: board.marshalled.pawnPromotionWeight,
      maxTurns: board.marshalled.maxTurns,
      arrivalTurn: board.marshalled.arrivalTurn,
      effects: [],
      tierExpiry: board.marshalled.tierExpiry,
      observedTurns: [],
      plan: [],
      held: [],
    };
    // JSON is the wire the dump actually travels on — a stderr line — so the
    // round trip is asserted through it rather than around it.
    const rebuilt = boardOfDump(JSON.parse(JSON.stringify(dump)) as ExactBoardDump);
    const before = new EngineSubstrate({ marshalled: board.marshalled, turn: board.turn, asTeam: 't0' });
    const after = new EngineSubstrate({ marshalled: rebuilt, turn: dump.turn, asTeam: 't0' });
    try {
      expect(after.roster().map((u) => u.wireId)).toEqual(before.roster().map((u) => u.wireId));
      for (const unit of before.roster()) {
        expect(after.actionsOf(unit.unitId).map((c) => c.to)).toEqual(
          before.actionsOf(unit.unitId).map((c) => c.to),
        );
      }
    } finally {
      before.release();
      after.release();
    }
  });
});
