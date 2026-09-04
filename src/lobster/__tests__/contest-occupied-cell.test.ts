/**
 * REPRODUCTION A, PINNED AS THE FIX IT NOW IS — D1 of
 * `docs/design/BEHAVIOUR-AUDIT.md`.
 *
 * `mixed` seed 1, the board as turn 47 opened, read off the runner at the
 * commit that produced the audit:
 *
 *     T 47 blue-C  pawn  hp96 (0,2)->(0,3)  top3: (0,3)=19.33  (-1,2)=18.18  (0,2)=18.18
 *     T 47 green-A snake hp96 (0,3)->(0,2)
 *     DEATH blue-C (edge)
 *
 * blue-C stepped onto the cell green-A's head occupied and `turnEngine.ts` c1
 * adjudicated the head-on exchange against it. The arithmetic that produced the
 * step is what this file used to pin: green-A's own square was in NO arrival set
 * — a trail unit has no `stay` in its grammar — so `contest` charged it NOTHING,
 * while blue-C's hold, which is one of green-A's four legal continuations, was
 * charged the whole `CONTEST_LOSS`. The term paid the pawn to walk into the one
 * square on the board where a meeting is certain.
 *
 * THE TWO NUMBERS BELOW ARE NOW THE OTHER WAY ROUND, and this file says so on
 * purpose: the previous revision of it announced that "a fix INVERTS the two
 * numbers below", and this is that inversion, not a re-pinning of whatever the
 * code happens to do. `enemyArrivals` yields each enemy's action set union its
 * own turn-start cell, and the charge is the flat loss LIGHTENED by how certain
 * the meeting is, `CONTEST_LOSS x (1 - e + e x p)` with `e = CONTEST_CERTAINTY`:
 * the entry onto green-A's square pays the whole loss (`p = 1`) and the hold,
 * one of green-A's four continuations, pays `1 - 0.75 e` (`p = 1/4`).
 *
 * The first attempt at D1 — the same origin clause but with the charge REPLACED
 * by the certainty rather than lightened by it — took `edge` deaths 3 -> 0 and
 * was still reverted: dividing every non-origin charge by the enemy's action
 * count weakened the term about fourfold against a weight seated on the boolean
 * reading, and `potions` came back at 26 -> 28 deaths with `mixed` at 246 -> 215
 * meals. That is what `e` is for, and why it is small. See the D1 status note in
 * the audit for both arms.
  */

import type { Board, Coord, Snake } from '../../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { Candidate, JointPlan, UnitId } from '../contracts';
import {
  CONTEST_CERTAINTY,
  CONTEST_LOSS,
  DEFAULT_PROFILE,
  contestFeature,
  contestField,
  makeContext,
} from '../evaluate';
import { makeSnake, piece, cellAt } from '../../tests/board-fixtures';

const TURN = 47;

/**
 * THE BOARD ITSELF, unit for unit, as `runGame({...MIXED_SCENARIO, maxTurns:
 * 46, seed: 1, nodeBudget: 550})` left it. The two units the reproduction turns
 * on are blue-C (a pawn of weight 2 at (0,2)) and green-A (a snake of length 5
 * whose head is on (0,3), the square blue-C stepped onto); the rest are on the
 * board because a contest field is a fact about the whole roster.
 */
const reproductionA = (): Board =>
  ({
    width: 11,
    height: 11,
    hazards: [],
    food: [
      { x: 0, y: 10 },
      { x: 2, y: 4 },
      { x: 3, y: 2 },
      { x: 2, y: 10 },
      { x: 10, y: 1 },
    ],
    snakes: [
      makeSnake(
        'red-A',
        (
          [
            [1, 10],
            [1, 9],
            [1, 8],
            [2, 8],
            [2, 7],
            [1, 7],
            [1, 6],
          ] as const
        ).map(([x, y]) => ({ x, y })),
        { teamID: 'red', health: 97, orientation: { dx: 0, dy: -1 } }
      ),
      piece('red-C', { x: 3, y: 3 }, 'knight', 5, {
        teamID: 'red',
        health: 92,
        orientation: { dx: -1, dy: -2 },
      }),
      makeSnake(
        'blue-A',
        (
          [
            [4, 3],
            [4, 4],
            [4, 5],
            [5, 5],
            [5, 6],
            [5, 7],
            [5, 8],
            [4, 8],
          ] as const
        ).map(([x, y]) => ({ x, y })),
        { teamID: 'blue', health: 91, orientation: { dx: 0, dy: 1 } }
      ),
      piece('blue-B', { x: 10, y: 9 }, 'queen', 31, {
        teamID: 'blue',
        health: 100,
        orientation: { dx: 1, dy: -1 },
      }),
      piece('blue-C', { x: 0, y: 2 }, 'pawn', 2, {
        teamID: 'blue',
        health: 96,
        orientation: { dx: 0, dy: -1 },
      }),
      makeSnake(
        'green-A',
        (
          [
            [0, 3],
            [0, 4],
            [0, 5],
            [1, 5],
            [1, 4],
          ] as const
        ).map(([x, y]) => ({ x, y })),
        { teamID: 'green', health: 96, orientation: { dx: 0, dy: 1 } }
      ),
      piece('green-B', { x: 3, y: 8 }, 'knight', 16, {
        teamID: 'green',
        health: 98,
        orientation: { dx: -1, dy: -2 },
      }),
    ] as Snake[],
  }) as Board;

const at = (board: Board, c: Coord): number => cellAt(board, TURN, c);

afterEach(() => clearGeometryCache());

describe('reproduction A: the cell an enemy is standing on is the certain meeting', () => {
  /** The contest term alone, for one staged destination of blue-C. */
  function contestOf(board: Board, to: Coord): number {
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'blue', modeled: ['blue-C'] });
    try {
      const unit = sub.unitOfWireId('blue-C')?.unitId as UnitId;
      const dest = at(board, to);
      const plan: JointPlan = new Map<UnitId, Candidate>([
        [unit, { unitId: unit, from: -1, to: dest, path: sub.pathFor(unit, dest) ?? [] }],
      ]);
      const team = sub.teamNumber('blue');
      return sub.withResolution(plan, team, ({ resolution, bounds }) =>
        contestFeature.evaluate(
          makeContext(sub, resolution, bounds, team, 0, DEFAULT_PROFILE)
        )
      ).lo;
    } finally {
      sub.release();
    }
  }

  test('green-A occupies (0,3), the grammar has no hold there, and the field reaches it anyway', () => {
    const board = reproductionA();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'blue', modeled: ['blue-C'] });
    try {
      const team = sub.teamNumber('blue');
      const greenA = sub.unitOfWireId('green-A')?.unitId as UnitId;
      // Four legal continuations, and its own square is not one of them: the
      // grammar's `stay` is what a trail unit does not have. UNCHANGED — the
      // repair is in the field the term reads, not in the rules it reads it
      // from.
      expect(sub.actionsOf(greenA).length).toBe(4);
      const cell = at(board, { x: 0, y: 3 });
      expect(sub.actionsOf(greenA).some((a) => a.to === cell)).toBe(false);
      // The origin clause: reached, and reached at full certainty.
      const field = contestField(sub, team);
      expect(field.reached[cell]).toBe(1);
      expect(field.certainty[cell]).toBe(1);
      // While blue-C's own square is reached too, because green-A can step on
      // to it — one of four continuations, so a quarter certain.
      const held = at(board, { x: 0, y: 2 });
      expect(field.reached[held]).toBe(1);
      expect(field.certainty[held]).toBeCloseTo(0.25, 9);
    } finally {
      sub.release();
    }
  });

  test('so the entry costs the whole loss and the hold costs less — the right way round', () => {
    const board = reproductionA();
    const entry = contestOf(board, { x: 0, y: 3 });
    const hold = contestOf(board, { x: 0, y: 2 });
    // One unit of ours is modelled, so a charge is the whole per-unit charge.
    expect(entry).toBeCloseTo(-CONTEST_LOSS, 9);
    expect(hold).toBeCloseTo(-CONTEST_LOSS * (1 - CONTEST_CERTAINTY + CONTEST_CERTAINTY * 0.25), 9);
    // THE INVERTED LINE. The square where the meeting is certain is now the
    // dear one, and the gap is `0.75 e` in the term's own units — which has to
    // clear the 0.15 that decided the move, i.e. `e > 0.20`.
    expect(entry).toBeLessThan(hold);
    expect(hold - entry).toBeCloseTo(0.75 * CONTEST_CERTAINTY, 9);
    expect(hold - entry).toBeGreaterThan(0.15);
  });
});
