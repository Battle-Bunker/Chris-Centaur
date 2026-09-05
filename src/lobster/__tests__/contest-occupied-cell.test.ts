/**
 * REPRODUCTION A — D1 of `docs/design/BEHAVIOUR-AUDIT.md`. THE FLOOR IS
 * REPAIRED HERE; THE ORDERING IS NOT.
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
 * WHAT THE FLOOR REPAIR CHANGED, AND WHAT IT DID NOT. `contest` no longer reads
 * the charge at the one cell the optimistic timeline settles our unit on:
 * green-A is HELD, so blue-C's arrival at (0,3) is contingent, and the world
 * where green-A stands its ground leaves blue-C where it started — on (0,2),
 * which IS in green-A's fan. So the entry's worst reading is the whole
 * `CONTEST_LOSS` too, and the audit's gap of one `CONTEST_LOSS` in favour of
 * the certain meeting closes to ZERO. That is the bound made honest
 * (`law-sweep.test.ts`: `contest.lo` 30 -> 0), and it is only half the fix:
 * with the two options tied on every end of the interval, the move is decided
 * by `momentum`'s idleness charge, `0.5/3` = 0.167, which is on the entry's
 * side. The pawn still steps onto the snake — `contest` merely stops paying it
 * to.
 *
 * Turning it back needs a term that charges the CERTAIN meeting MORE than the
 * merely possible one: the enemy's own turn-start cell in the arrival field,
 * and the flat loss LIGHTENED by how certain the meeting is,
 * `CONTEST_LOSS x (1 - e + e p)`. That shape WAS measured on top of this
 * repair, at `e = 0.125` and `e = 0.25`, and it is not in the tree: it is
 * bound-clean at both doses (`contest.lo` stays closed, `totalLo` 0,
 * `exact-reply` exact) and it is refused by the play — `mixed` meals -3.3% and
 * -5.7% against a 3% budget, and `e = 0.125` takes `potions` deaths 26 -> 27.
 * See the D1 status note in the audit for the whole per-arm table.
 *
 * So what is pinned below is the repaired floor with the BOOLEAN charge and no
 * origin clause, which is the shipped pricing: the two options tie, and the
 * ordering half of D1 is still open.
 */
import type { Board, Coord, Snake } from '../../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { Bound, Candidate, JointPlan, UnitId } from '../contracts';
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

describe('reproduction A: the cell an enemy is standing on', () => {
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

  test('the entry is now an INTERVAL, because green-A can refuse to leave', () => {
    const board = reproductionA();
    const entry = contestOf(board, { x: 0, y: 3 });
    const hold = contestOf(board, { x: 0, y: 2 });
    // One unit of ours is modelled, so a charge is the whole `CONTEST_LOSS`.
    //
    // THE ENTRY. The optimistic timeline settles blue-C on (0,3) and charges
    // that cell nothing. But green-A is HELD, so the arrival is contingent, and
    // the world where green-A stands its ground leaves blue-C where it started
    // — on (0,2), which IS in green-A's fan. The worst reading pays for that
    // cell now, and the floor is no longer above a world the resolver produces.
    expect(entry.lo).toBeCloseTo(-CONTEST_LOSS, 9);
    // THE HOLD. One cell, already occupied, charged the whole loss.
    expect(hold.lo).toBeCloseTo(-CONTEST_LOSS, 9);
    // Both ceilings are 0, and that is the ALIVE-SET polarity rather than
    // anything this repair did: a contingent unit of ours is not alive in the
    // subject's worst world, so its cost is not paid in the best reading.
    expect(entry.hi).toBe(0);
    expect(hold.hi).toBe(0);
  });

  test('so `contest` no longer prefers the entry — and no longer refuses it either', () => {
    const board = reproductionA();
    const entry = contestOf(board, { x: 0, y: 3 });
    const hold = contestOf(board, { x: 0, y: 2 });
    // THE LINE THE AUDIT MEASURED, HALF-INVERTED. It used to read
    // `entry > hold` by a whole `CONTEST_LOSS` — the square where the meeting
    // is certain was the cheap one. The floor repair takes the gap to ZERO, on
    // every end of the interval: the two options are now indistinguishable to
    // this term.
    expect(entry.lo).toBeCloseTo(hold.lo, 9);
    expect(entry.est).toBeCloseTo(hold.est, 9);
    expect(entry.hi).toBeCloseTo(hold.hi, 9);
    // Which is NOT yet the fix reproduction A wants. With `contest` tied, the
    // move is decided by `momentum`'s idleness charge, `IDLE_COST / |ours|` =
    // 0.167, which is on the entry's side — the pawn still steps onto the
    // snake. Only a term that charges the CERTAIN meeting more than the merely
    // possible one turns it back, and that is `CONTEST_CERTAINTY`.
    expect(entry.est - hold.est).toBe(0);
  });
});
