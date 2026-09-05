/**
 * THE CONTESTED-MEAL DISCOUNT — `docs/design/GLUTTON-CLASS.md` §2.
 *
 * `contest` (3) under `food` (4) decides the LAST STEP onto a meal: a starving
 * unit takes a contested one, a healthy one declines it. It says nothing about
 * the WALK that puts a unit beside the meal, because `food`'s flood seeds every
 * meal on the board at distance 0 whatever is standing next to it. The discount
 * applies the same doctrine to the gradient, scaled by the same hunger the term
 * already carries, and this file pins the four properties it rests on.
 *
 * The board is built for the purpose rather than replayed: two meals, one under
 * a heavy enemy snake's one-ply arrival and one clear on the far corner, and one
 * pawn of ours whose energy is the only thing that varies between the cases.
 */
import type { Board, Coord, Snake } from '../../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { Candidate, JointPlan, UnitId } from '../contracts';
import {
  CONTESTED_MEAL_DISCOUNT,
  DEFAULT_PROFILE,
  HUNGER_FLOOR,
  foodDistance,
  foodFeature,
  freeFoodDistance,
  makeContext,
} from '../evaluate';
import { makeSnake, piece, cellAt } from '../../tests/board-fixtures';

const TURN = 12;

/** The board's Manhattan diameter, as `food.ts` reads it: grid width + height,
 * and the grid is the 11x11 play area inside its perimeter ring. */
const DIAMETER = 26;

/**
 * ONE BOARD. `blue-C` is a pawn of weight 2 at (5,5) whose forward step is
 * (5,6). The meal at (5,7) is one further along that line and `red-A`, a snake
 * of weight 7 with its head at (5,8), reaches it this turn and OUTWEIGHS the
 * pawn — so `beatenAt` is true there. The meal at (0,0) is on the far corner
 * and nothing reaches it.
 */
const board = (health: number): Board =>
  ({
    width: 11,
    height: 11,
    hazards: [],
    food: [
      { x: 5, y: 7 },
      { x: 0, y: 0 },
    ],
    snakes: [
      makeSnake(
        'red-A',
        (
          [
            [5, 8],
            [5, 9],
            [5, 10],
            [6, 10],
            [7, 10],
            [8, 10],
            [9, 10],
          ] as const
        ).map(([x, y]) => ({ x, y })),
        { teamID: 'red', health: 100, orientation: { dx: 0, dy: -1 } }
      ),
      piece('blue-C', { x: 5, y: 5 }, 'pawn', 2, {
        teamID: 'blue',
        health,
        orientation: { dx: 0, dy: -1 },
      }),
    ] as Snake[],
  }) as Board;

const at = (b: Board, c: Coord): number => cellAt(b, TURN, c);

afterEach(() => clearGeometryCache());

/** `food`'s own reading, for one staged destination of blue-C at a given
 * health. One unit of ours is standing, so the feature's division by `|ours|`
 * is by one and the number below is the unit's own pull. */
function pullAt(health: number, to: Coord): number {
  const b = board(health);
  const sub = makeSubstrate({ board: b, turn: TURN, asTeam: 'blue', modeled: ['blue-C'] });
  try {
    const unit = sub.unitOfWireId('blue-C')?.unitId as UnitId;
    const dest = at(b, to);
    // The destination must be one the grammar offers, or the plan settles the
    // unit back on its origin and the reading is about the wrong cell.
    expect(sub.actionsOf(unit).some((a) => a.to === dest)).toBe(true);
    const plan: JointPlan = new Map<UnitId, Candidate>([
      [unit, { unitId: unit, from: -1, to: dest, path: sub.pathFor(unit, dest) ?? [] }],
    ]);
    const team = sub.teamNumber('blue');
    return sub.withResolution(plan, team, ({ resolution, bounds }) =>
      foodFeature.evaluate(makeContext(sub, resolution, bounds, team, 0, DEFAULT_PROFILE))
    ).est;
  } finally {
    sub.release();
  }
}

describe('the contested-meal discount', () => {
  test('the free flood drops the beaten meal and keeps the clear one', () => {
    const b = board(100);
    const sub = makeSubstrate({ board: b, turn: TURN, asTeam: 'blue', modeled: ['blue-C'] });
    try {
      const team = sub.teamNumber('blue');
      const all = foodDistance(sub);
      const free = freeFoodDistance(sub, team, 0, 2);
      const contested = at(b, { x: 5, y: 7 });
      const clear = at(b, { x: 0, y: 0 });
      // Both meals are sources of the full flood; only the clear one seeds the
      // free flood, so the contested cell is now its Manhattan distance from
      // the far corner rather than zero.
      expect(all[contested]).toBe(0);
      expect(all[clear]).toBe(0);
      expect(free[clear]).toBe(0);
      expect(free[contested]).toBe(12);
    } finally {
      sub.release();
    }
  });

  test('a HEAVIER or HIGHER-TIER unit of ours keeps it — the discount never refuses a capture', () => {
    const b = board(100);
    const sub = makeSubstrate({ board: b, turn: TURN, asTeam: 'blue', modeled: ['blue-C'] });
    try {
      const team = sub.teamNumber('blue');
      const contested = at(b, { x: 5, y: 7 });
      // The seed set is keyed on OUR frozen (tier, weight). At weight 9 the
      // pawn out-weighs the snake, `winsContest` is true, the meal is a capture
      // rather than a loss, and the free flood is the full flood again.
      expect(freeFoodDistance(sub, team, 0, 9)[contested]).toBe(0);
      // Tier is read first, exactly as the rules read it.
      expect(freeFoodDistance(sub, team, 1, 2)[contested]).toBe(0);
      // And at the pawn's real weight it is dropped.
      expect(freeFoodDistance(sub, team, 0, 2)[contested]).toBe(12);
    } finally {
      sub.release();
    }
  });

  test('a HUNGRY unit still prefers the contested meal, and at hunger 1 it is the old reading', () => {
    // At twenty health `hunger` is 0.8, so the discount is a fifth of the knob
    // and the step toward the contested meal still wins — which is the recorded
    // `contest < food` relation, in the gradient, at the end it is about.
    // (One health is not the case to read: a pawn at one health does not
    // survive the move's own energy cost, so it is not in either alive set and
    // the term skips it.)
    const forward = pullAt(20, { x: 5, y: 6 });
    const hold = pullAt(20, { x: 5, y: 5 });
    expect(forward).toBeGreaterThan(hold);
    const hunger = 1 - 20 / 100;
    const discount = CONTESTED_MEAL_DISCOUNT * (1 - hunger);
    const scale = HUNGER_FLOOR + (1 - HUNGER_FLOOR) * hunger;
    const near = (dAll: number, dFree: number): number =>
      1 - dFree / DIAMETER + (1 - discount) * (dFree / DIAMETER - dAll / DIAMETER);
    expect(forward).toBeCloseTo(near(1, 11) * scale, 9);
    expect(hold).toBeCloseTo(near(2, 10) * scale, 9);
    // AT HUNGER 1 THE DISCOUNT IS ZERO AT EVERY KNOB SETTING, so `near` is the
    // undiscounted `1 - d/D` and the term is the function it was before this
    // knob existed. That is arithmetic rather than a board reading, and it is
    // the half of the relation the knob may not touch.
    const atEmpty = (dAll: number, dFree: number): number =>
      1 - dFree / DIAMETER + (1 - CONTESTED_MEAL_DISCOUNT * 0) * (dFree / DIAMETER - dAll / DIAMETER);
    expect(atEmpty(1, 11)).toBeCloseTo(1 - 1 / DIAMETER, 12);
    expect(atEmpty(2, 10)).toBeCloseTo(1 - 2 / DIAMETER, 12);
  });

  test('a FULL unit is priced off the meal it could keep, and the preference FLIPS', () => {
    // At full health `hunger` is 0 and the discount is the whole knob: at knob
    // 1 the contested meal contributes nothing, and the only gradient left is
    // the one toward the corner — which points the other way.
    const forward = pullAt(100, { x: 5, y: 6 });
    const hold = pullAt(100, { x: 5, y: 5 });
    const near = (dAll: number, dFree: number): number =>
      1 - dFree / DIAMETER + (1 - CONTESTED_MEAL_DISCOUNT) * (dFree / DIAMETER - dAll / DIAMETER);
    expect(forward).toBeCloseTo(near(1, 11) * HUNGER_FLOOR, 9);
    expect(hold).toBeCloseTo(near(2, 10) * HUNGER_FLOOR, 9);
    // THE POINT OF THE RULE: undiscounted, `forward` is the nearer meal and
    // wins. Discounted, the healthy pawn is no longer walked toward a square a
    // heavier snake takes this turn.
    expect(1 - 1 / DIAMETER).toBeGreaterThan(1 - 2 / DIAMETER);
    expect(forward).toBeLessThan(hold);
    // The discount only ever LOWERS the pull, so the feature's declared range
    // does not move and the cliff inequality is untouched.
    expect(forward).toBeGreaterThanOrEqual(0);
    expect(forward).toBeLessThanOrEqual((1 - 1 / DIAMETER) * HUNGER_FLOOR + 1e-12);
  });
});
