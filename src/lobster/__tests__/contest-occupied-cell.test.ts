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
 * step is what this file pins: green-A's own square is in NO arrival set — a
 * trail unit has no `stay` in its grammar — so the charge AT THAT CELL is
 * nothing, while blue-C's hold, which is one of green-A's four legal
 * continuations, is charged the whole `CONTEST_LOSS`.
 *
 * BOTH HALVES OF THE REPAIR ARE IN, AND THE TWO NUMBERS ARE THE OTHER WAY
 * ROUND. This file's previous revision announced that "a fix INVERTS the two
 * numbers below"; this is that inversion, not a re-pinning of whatever the code
 * happens to do.
 *
 * THE FLOOR. `contest` no longer reads the charge at the one cell the
 * optimistic timeline settles our unit on. green-A is HELD, so blue-C's arrival
 * at (0,3) is contingent, and the world where green-A stands its ground leaves
 * blue-C where it started — on (0,2), which is in green-A's fan. The worst
 * reading pays the dearest cell of that set (`contest.ts`, `settlesOn`), which
 * takes `law-sweep`'s `contest.lo` class 30 -> 0 and is what lets the ordering
 * repair below be measured at all: the second attempt at D1 was refused by that
 * ratchet and by nothing else.
 *
 * THE ORDERING. `enemyArrivals` yields each enemy's action set union its own
 * turn-start cell, and the charge is the flat loss LIGHTENED by how certain the
 * meeting is, `CONTEST_LOSS x (1 - e + e x p)` with `e = CONTEST_CERTAINTY`:
 * the entry onto green-A's square is the certain meeting (`p = 1`) and pays the
 * whole loss, while the hold — one of green-A's four continuations — pays
 * `1 - 0.75 e`. The gap is `0.75 e`, and it has to clear the 0.167 that
 * actually decided the move: `momentum`'s idleness charge, `IDLE_COST / |ours|`
 * = 0.5/3.
 *
 * The first attempt at D1 — the same origin clause but with the charge REPLACED
 * by the certainty rather than lightened by it — took `edge` deaths 3 -> 0 and
 * was still reverted: dividing every non-origin charge by the enemy's action
 * count weakened the term about fourfold against a weight seated on the boolean
 * reading, and `potions` came back at 26 -> 28 deaths with `mixed` at 246 -> 215
 * meals. That is what `e` is for, and why it is small. See the D1 status note in
 * the audit for all three arms.
 */
import type { Board, Coord, Snake } from '../../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { Bound, Candidate, JointPlan, UnitId } from '../contracts';
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
  function contestOf(board: Board, to: Coord): Bound {
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
      );
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
    // THE ENTRY is charged at the dearest cell of its own contingent set: the
    // cell it settles on is green-A's own square (`p = 1`), and the cell a
    // world could leave it standing on is (0,2) at `1 - 0.75 e`. The certain
    // meeting is the dearer of the two, so it is the one the floor pays.
    expect(entry.lo).toBeCloseTo(-CONTEST_LOSS, 9);
    // THE HOLD is settled — the one cell its arrival can reach is the one it is
    // already on — so it is a point at the lightened charge.
    expect(hold.lo).toBeCloseTo(
      -CONTEST_LOSS * (1 - CONTEST_CERTAINTY + CONTEST_CERTAINTY * 0.25),
      9
    );
    // Both ceilings are 0, and that is the ALIVE-SET polarity rather than
    // anything either half of the repair did: a contingent unit of ours is not
    // alive in the subject's worst world, so its cost is not paid in the best
    // reading.
    expect(entry.hi).toBe(0);
    expect(hold.hi).toBe(0);
  });

  test('THE INVERTED LINE: the certain square is now the dear one, by 0.75 e', () => {
    const board = reproductionA();
    const entry = contestOf(board, { x: 0, y: 3 });
    const hold = contestOf(board, { x: 0, y: 2 });
    // The audit measured `entry > hold` by a whole `CONTEST_LOSS` — the square
    // where the meeting is certain was the CHEAP one. It is the dear one now,
    // on the floor the bank adjudicates with, and the gap has to clear the
    // 0.167 that decided the move.
    expect(entry.lo).toBeLessThan(hold.lo);
    expect(hold.lo - entry.lo).toBeCloseTo(0.75 * CONTEST_CERTAINTY, 9);
    expect(hold.lo - entry.lo).toBeGreaterThan(0.167);
    // And `est` orders them the same way, so a floor tie elsewhere in the fold
    // cannot hand the square back.
    expect(entry.est).toBeLessThan(hold.est);
  });
});
