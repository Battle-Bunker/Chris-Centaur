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
import type { Candidate, Evaluator, PlanEvaluation } from '../contracts';
import { defaultEvaluator } from '../evaluate';
import { BoundBank, DEFAULT_BANK_CONFIG } from './bank';
import {
  boardOfDump,
  exactReplyCheck,
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
import { SEED_ONE_ARMS, armLine, runExactArm } from './exact-arms';

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

/**
 * THE CLASSIFIER, AGAINST A DEFECT WHOSE CAUSE IS KNOWN.
 *
 * `classOf` earns its place only if a violation it reports names the TERM
 * responsible, so it is asked about a defect that was put there on purpose: an
 * evaluator identical to the shipped one except that ONE feature's `lo` is
 * far too high wherever the reading is an interval. A concrete world is
 * a point in every feature, so the worlds are untouched and every world value
 * is the honest one; only the held readings lie, which is exactly the shape of
 * every real floor defect. The class every violation carries must name that
 * feature and no other.
 */
function liarOn(real: Evaluator, key: string): Evaluator {
  const LIE = 1000;
  const doctor = (ev: PlanEvaluation): PlanEvaluation => {
    const part = ev.parts[key];
    // A POINT IS LEFT ALONE — the concrete worlds have to keep their real
    // values or the "defect" would be in the oracle's own arithmetic. The
    // guard is on the TOTAL rather than on the part, because a feature can
    // collapse on a board whose fold has not: what a world is entitled to is
    // that NOTHING about it moved.
    if (part === undefined || ev.bound.hi - ev.bound.lo <= 1e-9) return ev;
    return {
      ...ev,
      bound: { ...ev.bound, lo: ev.bound.lo + LIE },
      parts: { ...ev.parts, [key]: { ...part, lo: part.lo + LIE } },
    };
  };
  const self: Evaluator = {
    scorePlan: (sub, plan, asTeam) => self.evaluatePlan(sub, plan, asTeam).bound,
    evaluatePlan: (sub, plan, asTeam) => doctor(real.evaluatePlan(sub, plan, asTeam)),
  };
  return self;
}

describe('the classifier names the term, not just the number', () => {
  test('a feature doctored above its own worlds is the class every violation carries', () => {
    let named = 0;
    let clamped = 0;
    for (const seed of [1, 2, 3, 4]) {
      const board = makeTestBoard(seededBoard(seed, 7, 1, 1, 2));
      const sub = new EngineSubstrate({
        marshalled: board.marshalled,
        turn: board.turn,
        asTeam: 't0',
      });
      const views: Array<{ release(): void }> = [];
      try {
        const asTeam = sub.teamNumber('t0');
        const ours = sub.commandable(asTeam);
        const held = sub.roster().filter((u) => u.team !== asTeam).map((u) => u.unitId);
        if (ours.length === 0 || held.length === 0) continue;
        const base = new Map(ours.map((id) => [id, sub.actionsOf(id)[0] as Candidate]));
        const viewOf = (ids: ReadonlyArray<number>) => {
          const v = modelledView(sub, [...ids]);
          views.push(v);
          return v.sub;
        };
        const all = viewOf(held);
        const ask = {
          sub: all,
          base,
          held,
          asTeam,
          floorFrom: 'the doctored feature',
          ceiling: Number.POSITIVE_INFINITY,
          memberFloors: [],
          cap: 48,
          viewOf,
        };
        const honest = exactReplyCheck({
          ...ask,
          evaluate: defaultEvaluator,
          floor: Number.NEGATIVE_INFINITY,
        });
        // A board whose worst world is the lattice bottom has no number to
        // plant a lie one unit above, so it is not one of these seeds' jobs.
        if (honest.skipped !== null || !Number.isFinite(honest.minValue)) continue;
        expect(honest.violations).toEqual([]);
        const lie = exactReplyCheck({
          ...ask,
          evaluate: liarOn(defaultEvaluator, 'material'),
          floor: (honest.minValue as number) + 1,
        });
        for (const v of lie.violations) {
          if (v.klass === 'clamp' || v.klass === 'unattributed') clamped++;
          else {
            expect(v.klass.split('+')).toContain('material');
            named++;
          }
        }
      } finally {
        for (const v of views) v.release();
        sub.release();
      }
    }
    // The instrument has to have named the planted term, and it may not have
    // named a term on a world the plant does not reach — hence the two
    // counters rather than one.
    expect(named).toBeGreaterThan(0);
    expect(named).toBeGreaterThan(clamped);
  }, 300_000);
});

/**
 * THE GATE, AT THE WIDTH AN ORDINARY `npx jest` CAN AFFORD.
 *
 * The oracle's real subject is the sixteen arms `CENTAUR_DEBUG_INVERSION`
 * runs, and settling worlds inside sixteen games costs about four minutes —
 * too much for the default suite to pay on every run. So the default suite
 * takes ONE ARM PER SCENARIO and `npm run gate:exact` takes all sixteen
 * (`exact-reply.gate.test.ts`). That is a test SELECTION and not a switch
 * inside the instrument: the arms it does run are run exactly as the full
 * gate runs them, so a defect on `mixed` seed 1 fails the default suite
 * without anybody opting in.
 *
 * Each arm reports its DEFECT COUNTS PER CLASS (`exactStats.classes`, see
 * `classOf`): a violation is attributed to the feature keys whose own `lo`
 * sits above that feature's value in the refuting world, so a run that finds
 * anything says which term to repair rather than only that something is wrong.
 */
describe('the gate arms, one per scenario: no floor above a concrete reply', () => {
  for (const arm of SEED_ONE_ARMS) {
    test(`${arm.scenario} seed ${arm.seed}`, async () => {
      const stats = await runExactArm(arm);
      console.log(armLine(arm, stats));
      // Anti-vacuity: the arm has to have looked at real worlds at all.
      expect(stats.checks).toBeGreaterThan(10);
      expect(stats.worlds).toBeGreaterThan(100);
      expect(stats.classes).toEqual({});
      expect(stats.floorViolations).toBe(0);
      expect(stats.ceilingViolations).toBe(0);
    }, 900_000);
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
