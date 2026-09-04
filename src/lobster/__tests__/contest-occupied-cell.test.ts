/**
 * REPRODUCTION A, PINNED — `docs/design/BEHAVIOUR-AUDIT.md` D1.
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
 * step: green-A's own square was in NO arrival set — a trail unit has no `stay`
 * in its grammar — so `contest` charged it nothing, while both of blue-C's idle
 * options sat inside green-A's one-step reach and were charged the whole
 * `CONTEST_LOSS`. The term paid the pawn to walk into the one square on the
 * board where a meeting was certain.
 *
 * What this file pins is the price, not the plan: on this board, the entry onto
 * the occupied cell is the most expensive option blue-C has, and it is charged
 * at CERTAINTY 1 while a cell that is merely one of three legal continuations
 * of the same snake is charged 1/3.
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
import { contestPressure } from '../evaluate/contest';
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

describe("reproduction A: the cell an enemy is standing on is priced as the contest it is", () => {
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

  test('green-A occupies (0,3), so the field reaches it and the certainty there is 1', () => {
    const board = reproductionA();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'blue', modeled: ['blue-C'] });
    try {
      const team = sub.teamNumber('blue');
      const blueC = sub.unitOfWireId('blue-C');
      const cell = at(board, { x: 0, y: 3 });
      // The boolean field: the occupied cell is IN it. It was not before, and
      // that absence is the whole defect.
      expect(contestField(sub, team).reached[cell]).toBe(1);
      // And the graded reading: certain, because the enemy either holds this
      // square (a c4 contest) or leaves it across our edge (a c1 exchange).
      const pressure = contestPressure(
        sub,
        team,
        blueC?.tier ?? 0,
        blueC?.weight ?? 0
      );
      expect(pressure[cell]).toBeCloseTo(1, 12);
    } finally {
      sub.release();
    }
  });

  test('a cell that is merely one of green-A s four continuations is charged a quarter', () => {
    const board = reproductionA();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'blue', modeled: ['blue-C'] });
    try {
      const team = sub.teamNumber('blue');
      const blueC = sub.unitOfWireId('blue-C');
      const greenA = sub.unitOfWireId('green-A')?.unitId as UnitId;
      // (0,2) is blue-C's own square and one of green-A's legal moves — it is
      // the square green-A actually played, and the exchange that killed the
      // pawn ran across this edge.
      expect(sub.actionsOf(greenA).length).toBe(4);
      const pressure = contestPressure(sub, team, blueC?.tier ?? 0, blueC?.weight ?? 0);
      expect(pressure[at(board, { x: 0, y: 2 })]).toBeCloseTo(1 / 4, 12);
    } finally {
      sub.release();
    }
  });

  test('so the entry costs strictly more than holding, and it is the whole loss', () => {
    const board = reproductionA();
    const entry = contestOf(board, { x: 0, y: 3 });
    const hold = contestOf(board, { x: 0, y: 2 });
    // One unit of ours is modelled here, so the whole `CONTEST_LOSS` is what a
    // certain loss costs and a quarter of it is what a one-in-four continuation
    // costs. Both are read off the term itself rather than asserted as a bare
    // inequality, because the ORDER between them is what the audit's 1.15 gap
    // was made of — and under the old boolean rule the two were 0 and
    // -CONTEST_LOSS, the wrong way round.
    expect(entry).toBeCloseTo(-CONTEST_LOSS, 9);
    expect(hold).toBeCloseTo(-CONTEST_LOSS / 4, 9);
    expect(entry).toBeLessThan(hold);
  });
});
