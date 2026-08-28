/**
 * THE CLAIM-COLLISION CEILING GAP, closed — the downstream half of engine
 * backlog 7.
 *
 * Reported by the idea/i3 arm as a pre-existing tier-1 defect it found and did
 * not own (its `closing.test.ts`, "the pre-existing claim-collision ceiling
 * gap"), which pinned the BROKEN behaviour so the gap could not close silently:
 *
 *     // If this ever comes back [false, false] the gap was fixed upstream:
 *     // delete this describe block and put sliders back in law case 3.
 *     expect(held.map((s) => s.bestAlive).sort()).toEqual([false, true]);
 *
 * It has. The engine now computes `CloudField.contestedClaims` — the frozen
 * slots another frozen CLAIM could have killed — and folds it into
 * `Resolution.mayHaveDied` beside the modelled-footprint half, so `standingOf`
 * reads both without a line of its own.
 *
 * WHY IT MATTERED. `standingOf` flagged ONE side of a mutually fatal pair. A
 * cell contest with no unique strict maximum kills everyone in it, so two
 * claims of equal strength that can meet produce a real world in which BOTH
 * are gone — here that is both enemy TEAMS gone, which the evaluator's
 * terminal clamp reads as a WIN. Naming one side left that win outside a
 * ceiling that read a finite −20, and the search's decisive test
 * `hi[m] <= lo[best]` retires a line whose ceiling loses. An understated
 * ceiling therefore retires lines that are in fact wins, permanently.
 *
 * The board is i3's, unchanged: our king alone in a corner with one step to
 * make, and two enemy claims on DIFFERENT teams that can occupy one cell at
 * equal tier and equal weight.
 */

import { Board, Coord, Snake } from '../types/battlesnake';
import { marshalBoard } from '../logic/turn-oracle';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import type { Candidate, UnitId } from '../lobster/contracts';
import { materialEvaluator, standingOf } from '../lobster/evaluate';

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
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
  weight: number,
  extra: Partial<Snake> = {}
): Snake => makeSnake(id, [at], { unitType, length: weight, ...extra });

const boardOf = (snakes: Snake[]): Board =>
  ({ width: 9, height: 9, food: [], hazards: [], snakes }) as Board;

const TURN = 30;
const at = (board: Board, cell: Coord): number => marshalBoard(board, TURN).toIndex(cell);

afterEach(() => clearGeometryCache());

/** i3's board: two enemy claims that can annihilate each other. */
const HOSTILE = (): Board =>
  boardOf([
    piece('rk', { x: 0, y: 0 }, 'king', 1, { teamID: 'red', health: 70 }),
    piece('bq', { x: 7, y: 7 }, 'queen', 3, { teamID: 'blue', health: 70 }),
    piece('gr', { x: 5, y: 7 }, 'rook', 3, { teamID: 'green', health: 70 }),
  ]);

function contextFor(board: Board): {
  sub: ReturnType<typeof makeSubstrate>;
  asTeam: number;
  plan: Map<UnitId, Candidate>;
} {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['rk'] });
  const asTeam = sub.teamNumber('red');
  const king = sub.unitOfWireId('rk');
  if (king === undefined) throw new Error('no king');
  const to = at(board, { x: 0, y: 1 });
  const plan = new Map<UnitId, Candidate>([
    [king.unitId, { unitId: king.unitId, from: -1, to, path: sub.pathFor(king.unitId, to) ?? [] }],
  ]);
  return { sub, asTeam, plan };
}

describe('a mutually fatal claim pair is flagged on BOTH sides', () => {
  test("i3's repro: standingOf no longer leaves one of the pair certainly alive", () => {
    const { sub, asTeam, plan } = contextFor(HOSTILE());
    try {
      sub.withResolution(plan, asTeam, ({ resolution }) => {
        const held = standingOf(sub, resolution, asTeam).filter((s) => s.held);
        expect(held).toHaveLength(2);
        // The assertion i3 wrote as the fix's signature. It used to be
        // [false, true]: the blue queen came back possibly-dead and the green
        // rook certainly-alive, from one claim-collision pass that stopped at
        // the first side it found.
        expect(held.map((s) => s.bestAlive).sort()).toEqual([false, false]);
        // Neither is dead in the FLOOR reading, which is unchanged: an enemy
        // the subject cannot rule out is priced alive in the subject's worst
        // world whatever the survival trit says.
        expect(held.map((s) => s.worstAlive)).toEqual([true, true]);
        return null;
      });
    } finally {
      sub.release();
    }
  });

  test('and the ceiling that was finite now admits the win', () => {
    const { sub, asTeam, plan } = contextFor(HOSTILE());
    try {
      const bound = materialEvaluator.scorePlan(sub, plan, asTeam);
      // Both enemy TEAMS can be gone in one world, so the subject's best
      // reading is a win. It used to be a finite number, and every line whose
      // ceiling lost to some incumbent's floor was retired on the strength of
      // it.
      expect(bound.hi).toBe(Number.POSITIVE_INFINITY);
      expect(Number.isFinite(bound.lo)).toBe(true);
    } finally {
      sub.release();
    }
  });

  test('the win world is real: they take each other, and our king survives', () => {
    // The claim layer's ceiling is only allowed to admit worlds the RULES
    // admit. Named exhaustively, with nothing held, the two enemies stepping
    // onto one cell kills both — a tie has no survivor — and our king, which
    // is nowhere near them, is left standing alone.
    const board = HOSTILE();
    const sub = makeSubstrate({
      board,
      turn: TURN,
      asTeam: 'red',
      modeled: board.snakes.map((s) => s.id),
    });
    try {
      const asTeam = sub.teamNumber('red');
      const idOf = (wire: string): UnitId => {
        const u = sub.unitOfWireId(wire);
        if (u === undefined) throw new Error(`no ${wire}`);
        return u.unitId;
      };
      const meeting = at(board, { x: 6, y: 7 });
      const step = (unit: UnitId, to: number): Candidate => ({
        unitId: unit,
        from: -1,
        to,
        path: sub.pathFor(unit, to) ?? [],
      });
      const world = new Map<UnitId, Candidate>([
        [idOf('rk'), step(idOf('rk'), at(board, { x: 0, y: 1 }))],
        [idOf('bq'), step(idOf('bq'), meeting)],
        [idOf('gr'), step(idOf('gr'), meeting)],
      ]);
      const bound = materialEvaluator.scorePlan(sub, world, asTeam);
      // Nothing is held, so the interval is a point — and that point is the
      // win. This is the world the ceiling above has to contain.
      expect(bound.lo).toBe(Number.POSITIVE_INFINITY);
      expect(bound.hi).toBe(Number.POSITIVE_INFINITY);
    } finally {
      sub.release();
    }
  });
});
