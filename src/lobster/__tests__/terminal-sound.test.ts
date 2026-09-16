/**
 * R1 FOR THE TURN CAP — the boundary's own soundness, checked against the
 * worlds rather than against the member's reasoning.
 *
 * `model/terminal@1` supplies the flow fold's missing value AT the boundary,
 * and a boundary member is a bound like any other: for every completion world
 * `w` the plan admits, `lo ≤ v(w) ≤ hi`. The value of a decided board is the
 * lattice element the rules give it — `WIN` where we are the sole winner,
 * `DEAD` where we neither win nor tie — and the interior fold's own number for
 * a draw, which is the convention `finish` has always held.
 *
 * The oracle is a DIRECT ENUMERATION: the held unit is put on the board as a
 * real mover (`worldsOf`) and the SAME evaluator prices the resolved plan, so
 * the check and the thing under test share no arithmetic. Every world is a
 * point — nothing is held in it — so `lo === hi` there and the two comparisons
 * are the two halves of "the bracket covers this world".
 *
 * ── WHAT THIS FILE WAS WRITTEN TO CATCH ────────────────────────────────────
 *
 * `capVerdicts`'s bracket branch read `best` as "us in `possibleWinners` ⇒ a
 * draw", which is not a CEILING: `us ∈ possibleWinners` is exactly the
 * statement that some world has us winning, and a world we win ALONE is worth
 * `WIN`. So the ceiling sat at the interior fold's own finite number while a
 * real world was worth `+∞`, and — the half that reached the bank — the same
 * bracket let `worst` say `win` while `best` said `draw`, an unordered pair
 * that `finish` then handed to `clampTo` through `Math.min`/`Math.max`. The
 * swap turned the INTERIOR CEILING into a floor and the plan came back as
 * `[interiorCeiling, +∞]`: 5,195 `BoundsInversionError`s over the twelve
 * 30-turn arms of the standing gate. See `docs/design/TERMINAL-SOUND.md`.
 */

import type { Board, Coord, Snake } from '../../types/battlesnake';
import { makeSubstrate, clearGeometryCache, NO_ORDER_MOVE } from '../substrate';
import type { Candidate, JointPlan, UnitId } from '../contracts';
import { DEAD, WIN, defaultEvaluator, makeContext } from '../evaluate';
import { capVerdicts, type TerminalCap } from '../evaluate/terminal';
import { worldsOf, type LawCase } from '../evaluate/laws';
import { makeSnake, piece, cellAt } from '../../tests/board-fixtures';

const TURN = 40;
/** The arrival turn is `TURN + 1`, so a game capped there ENDS on this board. */
const CAP = TURN + 1;

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 7, height: 7, food: [], hazards: [], snakes, ...extra }) as Board;

afterEach(() => clearGeometryCache());

/**
 * THE BOARD. Our rook outweighs their whole side six to two and stands where
 * nothing can reach it; their snake is HELD, so the settlement cannot say what
 * it weighs at the count — it could be severed to one cell, or eat the food
 * beside it and be three. That interval is the point: it is what makes
 * `certain` null and sends the member down the BRACKET branch, which is the
 * one that carried the defect. The `certain` branch reduces to one adjudication
 * and has always been exact.
 *
 * Every world of this board ends the same way — we are the heaviest team in all
 * of them, so we win the count ALONE — which is what makes it a one-line
 * oracle: the value is `WIN` in every world, so BOTH of the member's corners
 * must be `WIN` and the plan's whole bracket must be `[WIN, WIN]`.
 */
const capBoard = (maxTurns: number | null): Board =>
  boardOf(
    [
      piece('me', { x: 1, y: 1 }, 'rook', 6, { teamID: 'red', health: 90 }),
      makeSnake('them', [{ x: 5, y: 5 }, { x: 5, y: 4 }], {
        teamID: 'blue',
        health: 90,
        orientation: { dx: 0, dy: 1 },
      }),
    ],
    { food: [{ x: 4, y: 5 }], ...(maxTurns === null ? {} : { maxTurns }) }
  );

const caseOf = (board: Board): LawCase => ({
  name: 'a held enemy at the count',
  board,
  turn: TURN,
  asTeam: 'red',
  stages: ['me'],
  orders: new Map([['me', cellAt(board, TURN, { x: 1, y: 1 } as Coord)]]),
});

function planFor(sub: ReturnType<typeof makeSubstrate>, c: LawCase): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const wireId of c.stages) {
    const unit = sub.unitOfWireId(wireId);
    if (unit === undefined) throw new Error(`no unit ${wireId}`);
    plan.set(unit.unitId, { unitId: unit.unitId, from: -1, to: NO_ORDER_MOVE, path: [] });
  }
  return plan;
}

/** The member's two corners on this board, read through a real context. */
function cornersOf(board: Board): { worst: TerminalCap; best: TerminalCap } {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['me'] });
  try {
    const asTeam = sub.teamNumber('red');
    let out: { worst: TerminalCap; best: TerminalCap } | null = null;
    sub.withResolution(planFor(sub, caseOf(board)), asTeam, ({ resolution, bounds }) => {
      out = capVerdicts(makeContext(sub, resolution, bounds, asTeam, 0));
    });
    if (out === null) throw new Error('no resolution');
    return out;
  } finally {
    sub.release();
  }
}

/** The lattice order the two corners live in: DEAD < interior < WIN. */
const RANK: Readonly<Record<TerminalCap, number>> = { loss: 0, none: 1, draw: 1, win: 2 };

describe('model/terminal@1 is a BOUND, and the worlds are what says so', () => {
  it('brackets every completion world at the count', () => {
    const board = capBoard(CAP);
    const c = caseOf(board);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['me'] });
    try {
      const asTeam = sub.teamNumber('red');
      const partial = defaultEvaluator.evaluatePlan(sub, planFor(sub, c), asTeam);

      // ANTI-VACUITY. The member has to have FIRED — a board the cap says
      // nothing about proves nothing about the cap — and the enumeration has to
      // have worlds to check.
      expect(partial.terminal).toEqual({ loClamped: true, hiClamped: true });
      const worlds = [...worldsOf(sub, c, 400)];
      expect(worlds.length).toBeGreaterThan(1);

      const violations: string[] = [];
      for (const world of worlds) {
        const v = defaultEvaluator.evaluatePlan(sub, world.plan, asTeam);
        // A LATTICE END IS NOT A NUMBER: `DEAD - DEAD` is NaN, and equality is
        // agreement rather than slack.
        if (v.bound.lo !== partial.bound.lo && v.bound.lo < partial.bound.lo) {
          violations.push(`lo: world ${v.bound.lo} < plan ${partial.bound.lo}`);
        }
        if (v.bound.hi !== partial.bound.hi && v.bound.hi > partial.bound.hi) {
          violations.push(`hi: world ${v.bound.hi} > plan ${partial.bound.hi}`);
        }
      }
      expect(violations).toEqual([]);
      // And the bracket is not merely sound but EXACT here, because every world
      // agrees: a board we win alone whatever the held unit does is worth WIN,
      // and nothing finite may stand at either end of it.
      expect(partial.bound.lo).toBe(WIN);
      expect(partial.bound.hi).toBe(WIN);
    } finally {
      sub.release();
    }
  });

  it('never reports a worst corner above its own best corner', () => {
    // The member-level statement of the same law, and the one the bank pays
    // for: `worst` is a FLOOR over the completion worlds and `best` a CEILING
    // over the same set, so `worst ≤ best` in the lattice — whatever the
    // bracket's two winner sets say. When it does not hold, `finish` has an
    // unordered pair to clamp with and no repair for it that is not a guess.
    const cap = cornersOf(capBoard(CAP));
    expect(RANK[cap.worst]).toBeLessThanOrEqual(RANK[cap.best]);
    expect(cap).toEqual({ worst: 'win', best: 'win' });
  });

  it('leaves a running game to the interior fold', () => {
    // The overwhelmingly common board, and the one the member must cost
    // nothing on: no limit stated, so nothing is read off the bracket at all.
    const board = capBoard(null);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['me'] });
    try {
      const asTeam = sub.teamNumber('red');
      const v = defaultEvaluator.evaluatePlan(sub, planFor(sub, caseOf(board)), asTeam);
      expect(Number.isFinite(v.bound.lo)).toBe(true);
      expect(Number.isFinite(v.bound.hi)).toBe(true);
      expect(v.terminal).toEqual({ loClamped: false, hiClamped: false });
      expect(cornersOf(board)).toEqual({ worst: 'none', best: 'none' });
    } finally {
      sub.release();
    }
  });

  it('says DEAD at both ends when no world has us winning or tying', () => {
    // The other side of the same rule, and the reason `best` may still say
    // `loss`: `us ∉ possibleWinners` is a proof about EVERY world, so DEAD is a
    // sound ceiling as well as a sound floor.
    // TWO held enemies, so their team's FLOOR — the sum of what each of them
    // weighs in every world — already outruns our whole ceiling. That is what
    // takes us out of `possibleWinners` rather than merely out of
    // `certainWinners`, and it is the only reading that licenses a DEAD ceiling.
    const board = boardOf(
      [
        piece('me', { x: 1, y: 1 }, 'rook', 1, { teamID: 'red', health: 90 }),
        makeSnake('them', [{ x: 5, y: 5 }, { x: 5, y: 4 }], {
          teamID: 'blue',
          health: 90,
          orientation: { dx: 0, dy: 1 },
        }),
        makeSnake('them2', [{ x: 2, y: 5 }, { x: 2, y: 4 }], {
          teamID: 'blue',
          health: 90,
          orientation: { dx: 0, dy: 1 },
        }),
      ],
      { maxTurns: CAP }
    );
    const cap = cornersOf(board);
    expect(RANK[cap.worst]).toBeLessThanOrEqual(RANK[cap.best]);
    expect(cap).toEqual({ worst: 'loss', best: 'loss' });
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['me'] });
    try {
      const asTeam = sub.teamNumber('red');
      const v = defaultEvaluator.evaluatePlan(sub, planFor(sub, caseOf(board)), asTeam);
      expect(v.bound.lo).toBe(DEAD);
      expect(v.bound.hi).toBe(DEAD);
    } finally {
      sub.release();
    }
  });
});
