/**
 * REPRODUCTION A, PINNED AS THE DEFECT IT STILL IS — D1 of
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
 * step is what this file pins: green-A's own square is in NO arrival set — a
 * trail unit has no `stay` in its grammar — so `contest` charges it NOTHING,
 * while blue-C's hold, which is one of green-A's four legal continuations, is
 * charged the whole `CONTEST_LOSS`. The term pays the pawn to walk into the one
 * square on the board where a meeting is certain.
 *
 * THIS IS A CHARACTERISATION TEST, NOT AN APPROVAL. D1's rule — the enemy's own
 * turn-start cell in the field, and a certainty weight
 * `p_e(c) = |{a : a.to = c}| / |actions(e)|` in place of the boolean charge —
 * was implemented and measured over the audit's corpus, and REVERTED: it took
 * `edge` deaths 3 -> 0 on `mixed` + `potions` but dividing every other charge by
 * the enemy's action count weakened the term about fourfold, and `potions` came
 * back at 26 -> 28 deaths (contest +1, bodyBlock +1, self +1, and the corpus's
 * first `deathsWhileDebuffed`), `mixed` at 246 -> 215 meals with the parked
 * share 7.2% -> 12.3% and the longest park 8 -> 49 turns. See the D1 status note
 * in the audit for the whole reading.
 *
 * So a fix INVERTS the two numbers below, and it is meant to: this file exists
 * so that the board, the arithmetic and the ordering are already written down
 * when someone re-opens D1, and so that a change to `contest` cannot alter this
 * position's pricing silently.
 */

import type { Board, Coord, Snake } from '../../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { Candidate, JointPlan, UnitId } from '../contracts';
import {
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

describe('reproduction A: today the cell an enemy is standing on is priced at nothing', () => {
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

  test('green-A occupies (0,3), and the arrival field does not reach it', () => {
    const board = reproductionA();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'blue', modeled: ['blue-C'] });
    try {
      const team = sub.teamNumber('blue');
      const greenA = sub.unitOfWireId('green-A')?.unitId as UnitId;
      // Four legal continuations, and its own square is not one of them: the
      // grammar's `stay` is what a trail unit does not have.
      expect(sub.actionsOf(greenA).length).toBe(4);
      const cell = at(board, { x: 0, y: 3 });
      expect(sub.actionsOf(greenA).some((a) => a.to === cell)).toBe(false);
      expect(contestField(sub, team).reached[cell]).toBe(0);
      // While blue-C's own square IS in the field, because green-A can step on
      // to it — which is exactly the move that killed the pawn.
      expect(contestField(sub, team).reached[at(board, { x: 0, y: 2 })]).toBe(1);
    } finally {
      sub.release();
    }
  });

  test('so the entry costs NOTHING and the hold costs the whole loss — the wrong way round', () => {
    const board = reproductionA();
    const entry = contestOf(board, { x: 0, y: 3 });
    const hold = contestOf(board, { x: 0, y: 2 });
    // One unit of ours is modelled, so a charge is the whole `CONTEST_LOSS`.
    expect(entry).toBe(0);
    expect(hold).toBeCloseTo(-CONTEST_LOSS, 9);
    // The gap the audit measured, in the term's own units: the square where the
    // meeting is certain is the CHEAP one. A repair inverts this line.
    expect(entry).toBeGreaterThan(hold);
  });
});
