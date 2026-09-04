/**
 * ENTRAPMENT — the two constructed positions the repaired `room` is pinned on,
 * and the first one is the point.
 *
 * `docs/design/entrapment.md` §7.1. The repair is one changed relation inside
 * the per-unit reading: a trail unit's body bars on its own VACATING SCHEDULE
 * (`O[i]` while `i ≤ L − 1 − t`) rather than statically, its own body included.
 * Everything that follows from that is either a false alarm retired (P1) or a
 * real trap still seen (P2), and both are numbers here rather than behaviour
 * nobody can attribute.
 *
 * P1 is the position the first arm of this work — a separate `entrap` member
 * barred by `cells[0 .. len-2]` at every depth — fired hardest on, and it is a
 * snake that is completely fine. That arm cost `snakes` three extra deaths in
 * thirty turns, and this is the mechanism: it feared safe ground, and a snake
 * pushed out of its own safe coil goes where the other snakes are.
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import {
  checkCollapse,
  checkMonotone,
  checkSoundness,
  defaultEvaluator,
  makeContext,
  materialEvaluator,
} from '../lobster/evaluate';
import type { LawCase } from '../lobster/evaluate';
import type { Candidate, JointPlan, UnitId } from '../lobster/contracts';
import { ORTHOGONALS } from '../engine-vendor/engine/moveGrammar';
import { legalTargets } from '../engine-vendor/engine/queries';
import { marshalBoard } from '../logic/turn-oracle';
import { makeSnake, cellAt } from './board-fixtures';
import { entrappedAt, stepGame } from './local-game';

const P = (x: number, y: number): Coord => ({ x, y });
const TURN = 20;
// NOT converted to the shared `boardOf`: this board is 11×11, not the shared
// factory's 9×9 — see SIMPLIFY-PLAN-3.md item 1.
const boardOf = (snakes: Snake[]): Board =>
  ({ width: 11, height: 11, food: [], hazards: [], snakes }) as Board;
const at = (board: Board, cell: Coord): number => cellAt(board, TURN, cell);

afterEach(() => clearGeometryCache());

// --------------------------------------------------------------- the pieces

/**
 * P1's snake ONE MOVE EARLY, so the position under test is the one the
 * settlement produces rather than one asserted into existence: head `(2,0)`,
 * and the candidate is the step to `(1,0)`.
 */
const coilBefore = (): Snake =>
  makeSnake(
    's0',
    [P(2, 0), P(2, 1), P(2, 2), P(1, 2), P(0, 2), P(0, 3), P(0, 4), P(0, 5)],
    { teamID: 'red' }
  );
/** The same snake as the settlement leaves it — §7.1's occupancy exactly. */
const coilSettled = (): Snake =>
  makeSnake(
    's0',
    [P(1, 0), P(2, 0), P(2, 1), P(2, 2), P(1, 2), P(0, 2), P(0, 3), P(0, 4)],
    { teamID: 'red' }
  );
/** Far enough away that its whole claim horizon misses the corner. */
const bystander = (): Snake =>
  makeSnake('e0', [P(10, 10), P(10, 9), P(9, 9)], { teamID: 'blue' });

/** P2. `A` is ours; `E` walls column 0 and `F` walls row 0, head ends inward. */
const trapA = (): Snake => makeSnake('A', [P(1, 1), P(1, 2), P(1, 3), P(1, 4)], { teamID: 'red' });
const trapE = (): Snake =>
  makeSnake('E', [P(0, 0), P(0, 1), P(0, 2), P(0, 3), P(0, 4), P(0, 5)], { teamID: 'blue' });
const trapF = (): Snake => makeSnake('F', [P(2, 0), P(3, 0), P(4, 0), P(5, 0)], { teamID: 'blue' });

/** `A` after the candidate move, so the flood reads a settled board. */
const trapAAt = (head: Coord, tail: Coord[]): Snake =>
  makeSnake('A', [head, ...tail], { teamID: 'red' });

/** `room` and the per-unit rows for one plan over one board. */
function readPlan(
  board: Board,
  team: string,
  modeled: string[],
  orders: ReadonlyMap<string, Coord>
): { room: { lo: number; hi: number }; rows: string[] } {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: team, modeled });
  try {
    const asTeam = sub.teamNumber(team);
    const plan = new Map<UnitId, Candidate>();
    for (const u of sub.roster()) {
      const order = orders.get(u.wireId);
      if (order === undefined) continue;
      const to = at(board, order);
      plan.set(u.unitId, {
        unitId: u.unitId,
        from: u.cells[0] as number,
        to,
        path: sub.pathFor(u.unitId, to) ?? [],
      });
    }
    const ev = defaultEvaluator.evaluatePlan(sub, plan as JointPlan, asTeam);
    const rows = sub.withResolution(plan as JointPlan, asTeam, ({ resolution, bounds }) => {
      const p = makeContext(sub, resolution, bounds, asTeam, 4).partition('lo');
      return p.trails.map(
        (t) =>
          `${t.mine ? 'ours' : 'them'} ${sub.unitOf(t.subject.unitId)?.wireId} ${t.kept}/${t.need}`
      );
    });
    return {
      room: { lo: ev.parts['room']?.lo ?? 0, hi: ev.parts['room']?.hi ?? 0 },
      rows,
    };
  } finally {
    sub.release();
  }
}

/** Every legal step of one snake, and what the RULES do to it — the engine
 *  asked rather than a fatality table written down beside it. */
function fatesOf(board: Board, wireId: string, turn: number): string[] {
  const m = marshalBoard(board, turn);
  const unit = m.units.find((u) => u.id === wireId);
  if (unit === undefined) throw new Error(`no unit ${wireId}`);
  const targets = legalTargets(
    { type: unit.type, occupancy: unit.occupancy, orientation: ORTHOGONALS[0] as never },
    {
      boardWidth: m.config.boardWidth,
      boardHeight: m.config.boardHeight,
      walls: m.config.walls,
      hazards: m.config.hazards,
      occupancy: m.units.map((u) => ({ id: u.id, cells: u.occupancy })),
      food: m.config.food,
    }
  );
  return targets.map((to) => {
    const out = stepGame(board, turn, new Map([[wireId, to]]), () => 0.5, 0);
    const death = out.deaths.find((d) => d.id === wireId);
    const cell = m.toCell(to);
    return `(${cell.x},${cell.y})=${death === undefined ? 'LIVES' : death.cause}`;
  });
}

// ---------------------------------------------------------------------------
// P1 — THE FALSE ALARM, and it is the whole reason the schedule is the repair
// ---------------------------------------------------------------------------

describe('P1 — a length-8 coil in the corner, which is a tail-chase and not a tomb', () => {
  /*
   *      y
   *  4   S . . .        S = the snake, head at (1,0)     need = 10
   *  3   S . . .        o = the free pocket              k    = 10
   *  2   S S S . .
   *  1   . o S . .      the pocket is (0,0) (0,1) (1,1)
   *  0   o o S . .          — three cells, and that is what the FIRST arm
   *      0 1 2 3 4  x         counted, for a fear of sqrt(7/10) = 0.837
   */

  test('the region is ten cells, because the snake\'s own coil opens behind it', () => {
    // O[i] opens at t >= 8 - i:
    //   t=1 {(0,0),(1,1)}  t=2 {(0,1)}  t=3 (0,2)=O[5]  t=4 (0,3)=O[6], (1,2)=O[4]
    //   t=5 (0,4)=O[7], (2,2)=O[3], (1,3)  ->  |R| >= 10 = need
    // A STATIC own-body barrier stops at three, which is a strong fear of
    // nothing. This is the number the whole repair turns on.
    expect(entrappedAt(boardOf([coilSettled()]), TURN)).toEqual([
      { id: 's0', kept: 10, need: 10 },
    ]);
  });

  test('and the term is therefore exactly zero on it, not 0.837', () => {
    const board = boardOf([coilBefore(), bystander()]);
    const read = readPlan(board, 'red', ['s0'], new Map([['s0', P(1, 0)]]));
    expect(read.rows).toEqual(['ours s0 10/10', 'them e0 5/5']);
    // Zero on BOTH endpoints: a roomy unit costs nothing and expresses no
    // preference among its options, which is what keeps `room` from being a
    // second, weaker `reach`.
    expect(read.room).toEqual({ lo: 0, hi: 0 });
  });
});

// ---------------------------------------------------------------------------
// P2 — THE TRUE TRAP, which needs another unit, because nothing else can build
// ---------------------------------------------------------------------------

describe('P2 — a length-4 snake with one survivable option and one tomb', () => {
  const south = boardOf([trapAAt(P(1, 0), [P(1, 1), P(1, 2), P(1, 3)]), trapE(), trapF()]);
  const east = boardOf([trapAAt(P(2, 1), [P(1, 1), P(1, 2), P(1, 3)]), trapE(), trapF()]);

  test('the two settlements read one cell and six, on the same board', () => {
    // SOUTH. At t=1 every neighbour is barred: (0,0) is E[0] (0 <= 5-1),
    // (2,0) is F[0] (0 <= 3-1), (1,1) is A's own O[1] (1 <= 3-1), (1,-1) is
    // wall. The front is empty and the region is a singleton, so there is
    // nowhere to loiter and the flood ends. (1,1) does open at t=3 — but E's
    // unbarred front holds it from t=2, so clause (d) bars it for good.
    const a = (rows: ReadonlyArray<{ id: string; kept: number; need: number }>) =>
      rows.find((r) => r.id === 'A');
    expect(a(entrappedAt(south, TURN))).toEqual({ id: 'A', kept: 1, need: 6 });
    expect(a(entrappedAt(east, TURN))).toEqual({ id: 'A', kept: 6, need: 6 });
  });

  test('which is a fear of 0.913 against 0.000 — five times momentum\'s reversal charge', () => {
    const fear = (kept: number, need: number): number => Math.sqrt((need - kept) / need);
    expect(fear(1, 6)).toBeCloseTo(0.9129, 4);
    expect(fear(6, 6)).toBe(0);
    // At the shipped weights: 3 x 0.913 against `momentum`'s 1 x 1 for a
    // reversal, both over |ours|. Backing out of a closing pocket beats the
    // anti-dither charge by three to one, which is the clause `momentum.ts`
    // already declares it must never break.
    expect(3 * fear(1, 6)).toBeGreaterThan(3 * 1 * (1 / 3));
  });

  test('and the RULES agree: every continuation of the south settlement kills it', () => {
    // The engine asked, not a fatality table written down beside it. Two of
    // east's four continuations survive; none of south's do.
    expect(fatesOf(south, 'A', TURN + 1)).toEqual([
      '(1,1)=self',
      '(0,0)=contest',
      '(2,0)=contest',
      '(1,-1)=wall',
    ]);
    expect(fatesOf(east, 'A', TURN + 1).filter((f) => f.endsWith('LIVES'))).toEqual([
      '(2,2)=LIVES',
      '(3,1)=LIVES',
    ]);
  });

  test('the ALREADY-BOXED unit is priced flat, and material decides — as §6 says it must', () => {
    // With E and F HELD, their claims can take A on either option, so the
    // settlement leaves A contingent and `ADMISSION.lo.ours` drops it: the
    // worst reading charges the full fear on BOTH options and the term orders
    // nothing between them. That is not a defect being excused — it is the
    // clause the design states in advance, pinned as a number: when every
    // option of a unit is fully feared the term is flat and `material`'s cliff
    // decides. The member's claim is about the turns BEFORE this one, and board
    // B of `territory-acceptance.test.ts` is where that claim is measured.
    const board = boardOf([trapA(), trapE(), trapF()]);
    const go = (to: Coord) => readPlan(board, 'red', ['A'], new Map([['A', to]]));
    const flat = { lo: -Math.sqrt(5 / 6), hi: 0 };
    expect(go(P(1, 0)).room).toEqual(flat);
    expect(go(P(2, 1)).room).toEqual(flat);
  });
});

// ---------------------------------------------------------------------------
// The admission laws, over P2's real world set
// ---------------------------------------------------------------------------

describe('the laws over the entrapment boards', () => {
  const CASES: LawCase[] = [
    (() => {
      const board = boardOf([trapA(), trapE(), trapF()]);
      return {
        name: 'P2 south — into the closing pocket, E and F held',
        board,
        turn: TURN,
        asTeam: 'red',
        stages: ['A'],
        orders: new Map([['A', at(board, P(1, 0))]]),
      };
    })(),
    (() => {
      const board = boardOf([trapA(), trapE(), trapF()]);
      return {
        name: 'P2 east — out of it, same held set',
        board,
        turn: TURN,
        asTeam: 'red',
        stages: ['A'],
        orders: new Map([['A', at(board, P(2, 1))]]),
      };
    })(),
    (() => {
      const board = boardOf([coilBefore(), bystander()]);
      return {
        name: 'P1 — the coil, with the bystander held',
        board,
        turn: TURN,
        asTeam: 'red',
        stages: ['s0'],
        orders: new Map([['s0', at(board, P(1, 0))]]),
      };
    })(),
  ];

  test('R1 soundness: every world lies inside the interval', () => {
    for (const c of CASES) {
      const result = checkSoundness(defaultEvaluator, c);
      expect([c.name, result.violations]).toEqual([c.name, []]);
      expect([c.name, result.checked > 0]).toEqual([c.name, true]);
    }
  });

  test('R2 refinement-monotonicity: narrowing only ever shrinks the interval', () => {
    for (const c of CASES) {
      expect([c.name, checkMonotone(defaultEvaluator, c).violations]).toEqual([c.name, []]);
    }
  });

  test('R3 collapse: nothing held is a point', () => {
    for (const c of CASES) {
      expect([c.name, checkCollapse(defaultEvaluator, c).violations]).toEqual([c.name, []]);
    }
  });

  test('and all three hold for the material-only profile on the same world set', () => {
    for (const c of CASES) {
      expect([c.name, checkSoundness(materialEvaluator, c).violations]).toEqual([c.name, []]);
      expect([c.name, checkMonotone(materialEvaluator, c).violations]).toEqual([c.name, []]);
      expect([c.name, checkCollapse(materialEvaluator, c).violations]).toEqual([c.name, []]);
    }
  });
});
