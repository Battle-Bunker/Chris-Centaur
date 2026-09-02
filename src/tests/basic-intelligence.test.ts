/**
 * THE GATES A HUMAN WATCHING ONE GAME WOULD APPLY.
 *
 * Everything else in this suite measures the bot against a specification or
 * against another arm of itself. This file measures it against "does that look
 * stupid", which is the criterion that caught every defect in
 * `docs/BASIC-INTELLIGENCE.md` and which no relative experiment can express:
 * two arms sharing a defect score exactly even on it.
 *
 * The games are short and few — this is a regression fence, not a measurement.
 * The real reading is done by `src/tests/local-game.ts`, by eye, over thirty
 * turns. What is asserted here is only the part that can be asserted: that food
 * gets eaten, that nothing starves beside a meal, that units do not undo
 * themselves, that a piece does not spend the game turning on the spot, and
 * that nothing walks into a wall it did not have to.
 */

import type { Coord, Snake, Board } from '../types/battlesnake';
import { marshalBoard } from '../logic/turn-oracle';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import type { EngineSubstrate } from '../lobster/substrate';
import {
  BoundEvaluator,
  CLIFF_MATERIAL_WEIGHT,
  DEFAULT_PROFILE,
  DEFAULT_WEIGHTS,
  FEATURES,
  IDLE_COST,
  REVERSAL_COST,
  checkWeights,
  foodDistance,
  makeContext,
  momentumFeature,
} from '../lobster/evaluate';
import type { EvalContext } from '../lobster/evaluate';
import { MIXED_SCENARIO, SNAKE_SCENARIO, runGame } from './local-game';
import type { Candidate, JointPlan, UnitId } from '../lobster/contracts';

jest.setTimeout(180_000);

// --------------------------------------------------------------------- fixtures

const TURN = 12;

function snake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: body[0],
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  } as Snake;
}

const piece = (
  id: string,
  at: Coord,
  unitType: string,
  extra: Partial<Snake> = {}
): Snake => snake(id, [at], { unitType, length: 1, ...extra });

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 9, height: 9, food: [], hazards: [], snakes, ...extra }) as Board;

const cell = (board: Board, c: Coord): number => marshalBoard(board, TURN).toIndex(c);

/** Score one joint plan and hand back the momentum part alone. */
function momentumOf(sub: EngineSubstrate, plan: JointPlan, asTeam: number): number {
  return sub.withResolution(plan, asTeam, ({ resolution, bounds }) => {
    const ctx: EvalContext = makeContext(
      sub,
      resolution,
      bounds,
      asTeam,
      DEFAULT_PROFILE.reachHorizonTurns,
      DEFAULT_PROFILE
    );
    return momentumFeature.evaluate(ctx).est;
  });
}

function planOf(sub: EngineSubstrate, orders: ReadonlyArray<readonly [string, number]>): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const [wireId, to] of orders) {
    const unit = sub.unitOfWireId(wireId);
    if (unit === undefined) throw new Error(`no unit ${wireId}`);
    plan.set(unit.unitId, {
      unitId: unit.unitId,
      from: unit.cells[0] as number,
      to,
      path: sub.pathFor(unit.unitId, to) ?? [],
    } as Candidate);
  }
  return plan;
}

afterEach(() => clearGeometryCache());

// ---------------------------------------------------------------------------
// Hysteresis
// ---------------------------------------------------------------------------

describe('momentum charges a unit for undoing itself', () => {
  /**
   * A knight is the case that matters and the case the first attempt got wrong:
   * its orientation is an L-offset, and the substrate's `OrientationIndex`
   * cannot hold one — `orientationIndexOf` returns -1 for a non-orthogonal
   * vector and the spec falls back to "up". So a momentum term reading the
   * SUBSTRATE's orientation charges a knight for moving south, which is not a
   * reversal and is not anything. It reads the wire's vector instead.
   */
  test('a knight going back where it came from costs a reversal; every other move costs nothing', () => {
    const board = boardOf([
      // Arrived at (4,4) from (2,3): an L of dx +2, dy +1 in api terms, which
      // the wire carries as dy DOWNWARD, hence { dx: 2, dy: -1 }.
      piece('N', { x: 4, y: 4 }, 'knight', { teamID: 'red', orientation: { dx: 2, dy: -1 } }),
      snake('E', [{ x: 8, y: 8 }, { x: 8, y: 7 }], { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['N'] });
    try {
      const asTeam = sub.teamNumber('red');
      const back = momentumOf(sub, planOf(sub, [['N', cell(board, { x: 2, y: 3 })]]), asTeam);
      const on = momentumOf(sub, planOf(sub, [['N', cell(board, { x: 6, y: 5 })]]), asTeam);
      expect(on).toBe(0);
      expect(back).toBeLessThan(0);
      // One unit on our side, so the whole reversal cost lands undivided.
      expect(back).toBeCloseTo(-REVERSAL_COST, 6);
    } finally {
      sub.release();
    }
  });

  test('a piece that holds is charged idleness, at half a reversal', () => {
    const board = boardOf([
      piece('N', { x: 4, y: 4 }, 'knight', { teamID: 'red', orientation: { dx: 2, dy: -1 } }),
      snake('E', [{ x: 8, y: 8 }, { x: 8, y: 7 }], { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['N'] });
    try {
      const asTeam = sub.teamNumber('red');
      const hold = momentumOf(sub, planOf(sub, [['N', cell(board, { x: 4, y: 4 })]]), asTeam);
      expect(hold).toBeCloseTo(-IDLE_COST, 6);
      expect(IDLE_COST).toBeLessThan(REVERSAL_COST);
    } finally {
      sub.release();
    }
  });

  test('a trail unit is never charged idleness — it has no stay to decline', () => {
    const board = boardOf([
      snake('S', [{ x: 4, y: 4 }, { x: 4, y: 3 }], {
        teamID: 'red',
        orientation: { dx: 0, dy: -1 },
      }),
      snake('E', [{ x: 8, y: 8 }, { x: 8, y: 7 }], { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['S'] });
    try {
      const asTeam = sub.teamNumber('red');
      // North: the direction it is already going. Nothing owed.
      const on = momentumOf(sub, planOf(sub, [['S', cell(board, { x: 4, y: 5 })]]), asTeam);
      expect(on).toBe(0);
    } finally {
      sub.release();
    }
  });

  /**
   * THE CONSTRAINT THE WHOLE TERM LIVES UNDER. Hysteresis may break a tie and
   * may never negotiate with the safety floor: the cliff inequality is
   * `w x range < 10 x lightest unit weight`, the range is one whole reversal
   * per unit divided by the number of units, so the range is 1 whatever the
   * roster, and the ceiling is 10.
   */
  test('and it cannot outrank a single unit of material', () => {
    const w = DEFAULT_WEIGHTS.momentum as number;
    expect(w * REVERSAL_COST).toBeLessThan(CLIFF_MATERIAL_WEIGHT * 1);
    expect(w).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The food flood
// ---------------------------------------------------------------------------

describe('the food gradient is a real distance, not a landing-cell flag', () => {
  test('it falls off by one step per step and stops at a wall', () => {
    const board = boardOf(
      [snake('S', [{ x: 0, y: 0 }, { x: 0, y: 1 }], { teamID: 'red' })],
      { food: [{ x: 4, y: 4 }] }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['S'] });
    try {
      const d = foodDistance(sub);
      expect(d[cell(board, { x: 4, y: 4 })]).toBe(0);
      expect(d[cell(board, { x: 4, y: 5 })]).toBe(1);
      expect(d[cell(board, { x: 6, y: 4 })]).toBe(2);
      expect(d[cell(board, { x: 0, y: 0 })]).toBe(8);
      // The perimeter is wall and the flood never enters it, so no cell on the
      // board is ever reached THROUGH one.
      expect(d[cell(board, { x: 8, y: 8 })]).toBe(8);
    } finally {
      sub.release();
    }
  });

  test('and a board with no food gives every cell the same (absent) reading', () => {
    const board = boardOf([snake('S', [{ x: 0, y: 0 }, { x: 0, y: 1 }], { teamID: 'red' })]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['S'] });
    try {
      const d = foodDistance(sub);
      expect([...d].every((x) => x === -1)).toBe(true);
    } finally {
      sub.release();
    }
  });
});

// ---------------------------------------------------------------------------
// Profile validation
// ---------------------------------------------------------------------------

describe('a criterion profile must name every feature it folds, and nothing else', () => {
  /**
   * `fold` reads `weights[key] ?? feature.defaultWeight`, so a forgotten weight
   * is not zero — it is whatever the feature author picked. Three shipped
   * profiles silently began folding two new terms the moment those terms were
   * added to `FEATURES`; this is the check that turns that into a loud failure.
   */
  test('a missing weight is refused, and the message names the key', () => {
    const partial = { ...DEFAULT_WEIGHTS } as Record<string, number>;
    delete partial.food;
    expect(() =>
      checkWeights({ name: 'partial', weights: partial, reachHorizonTurns: 4 }, FEATURES)
    ).toThrow(/partial.*food/s);
  });

  test('a weight for a feature that is not folded is refused too', () => {
    expect(() =>
      checkWeights(
        {
          name: 'typo',
          weights: { ...DEFAULT_WEIGHTS, momenutm: 1 },
          reachHorizonTurns: 4,
        },
        FEATURES
      )
    ).toThrow(/typo.*momenutm/s);
  });

  test('and the check is enforced where a profile enters the system', () => {
    expect(
      () => new BoundEvaluator({ name: 'empty', weights: {}, reachHorizonTurns: 4 })
    ).toThrow(/criterion profile "empty"/);
    expect(() => new BoundEvaluator(DEFAULT_PROFILE)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The behavioural gates
// ---------------------------------------------------------------------------

describe('the bot does the obvious things', () => {
  /**
   * One short game. The budget has to clear the kernel's 40 ms flush reserve
   * with room to search in — below about 60 ms the decision IS the seed, every
   * turn, and this file would be measuring `seedPlan` rather than the bot.
   */
  const play = (spec: typeof SNAKE_SCENARIO, seed: number) =>
    runGame({ ...spec, maxTurns: 40, seed, budgetMs: 120 }, { scores: false });

  test('snakes eat, and nothing starves while there is food to reach', async () => {
    const { metrics } = await play(SNAKE_SCENARIO, 1);
    expect(metrics.crashed).toBeNull();
    expect(metrics.unitTurns).toBeGreaterThan(100);
    // Clearly nonzero: the shipped bot before this pass managed under one meal
    // per hundred unit-turns on a sparse board and starved on it.
    expect((100 * metrics.foodEaten) / metrics.unitTurns).toBeGreaterThan(4);
    expect(metrics.starvationDeaths).toBe(0);
  });

  test('nothing walks into the perimeter', async () => {
    for (const seed of [1, 2]) {
      const { metrics } = await play(SNAKE_SCENARIO, seed);
      expect([seed, metrics.deathsByCause.wall ?? 0]).toEqual([seed, 0]);
    }
  });

  test('pieces act: they do not spend the game turning on the spot', async () => {
    const { metrics } = await play(MIXED_SCENARIO, 1);
    expect(metrics.crashed).toBeNull();
    // Before the command term was seated and the switch margin corrected, 22.7%
    // of unit-turns on this board ended where they began and the pawns never
    // advanced a square in forty turns.
    expect((100 * metrics.stationary) / metrics.unitTurns).toBeLessThan(12);
    expect((100 * metrics.dithers) / metrics.unitTurns).toBeLessThan(3);
  });

  test('and units do not undo last turn s move for nothing', async () => {
    const { metrics } = await play(MIXED_SCENARIO, 2);
    expect((100 * metrics.reversals) / metrics.unitTurns).toBeLessThan(6);
  });

  test('a full game at three teams completes without crashing or overrunning', async () => {
    const { metrics } = await runGame(
      { ...MIXED_SCENARIO, maxTurns: 100, seed: 3, budgetMs: 50 },
      { scores: false }
    );
    expect(metrics.crashed).toBeNull();
    expect(metrics.turns).toBeGreaterThan(20);
    // The kernel reserves 40 ms of a decision for its final flush, so a 50 ms
    // budget may legitimately run a little past itself; what must not happen is
    // a decision that ignores the deadline.
    expect(metrics.worstDecisionMs).toBeLessThan(150);
  });
});
