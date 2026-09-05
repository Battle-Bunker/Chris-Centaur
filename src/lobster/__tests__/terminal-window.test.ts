/**
 * WHY THE TURN CAP IS A STEP AND NOT A RAMP — the fact the shape rests on,
 * pinned where it lives rather than argued in a comment.
 *
 * `model/terminal@1` has no weight. It is not a feature, it never appears in
 * `parts`, and `finish` REPLACES the fold's ends with lattice elements rather
 * than adding a scaled term to them — so "price the end less keenly" has no
 * expression in this member, and giving it one means making `DEAD` a large
 * finite number, which is `calibration.ts` fact 3's already-refused change.
 * That leaves the shape: a step at the cap, against a ramp that would let the
 * boundary start pricing the end over the last N turns.
 *
 * ── THE RAMP IS NOT A TUNING CHOICE, IT IS UNAVAILABLE ─────────────────────
 *
 * `capVerdicts` gates on the turn count first, and that gate is a COST gate —
 * "this member must cost nothing on every board but the last one". Every corner
 * BELOW it derives from `ended(kinds)`, *no world this settlement admits leaves
 * the game running*, and never from the turn count (TERMINAL-SOUND §2.1). So
 * one could let the member look earlier without unsounding it, and it would
 * still say nothing: **before the cap the game does not end on the count, so
 * the settlement's own bracket still carries `continues` and `ended` is false.**
 *
 * That is the load-bearing fact, and the third test below asserts it directly
 * on the `OutcomeBracket` — a statement about what `settlePartial` reports,
 * true whatever `terminal.ts` chooses to read. A window knob
 * (`TERMINAL_READ_AHEAD_TURNS`, one subtraction in the turn gate) was built and
 * swept over the 40-game corpus at widths 0, 4 and 12 and over the twenty
 * `long` arms at width 12: byte-identical traces and summaries at every width,
 * identical deterministic work counters to the node, `terminal.lo`/`terminal.hi`
 * still 0 in the law sweep. It is reverted, because an inert knob is a scaffold
 * for a refuted rule; the table is `docs/design/TERMINAL-GAIN.md` §3 and the
 * build is `git show e8d7193`.
 *
 * The complement of all this — the member DOES speak at the count, and both
 * corners are bounds there — is `terminal-sound.test.ts`, which also covers the
 * board that states no limit at all. The boards here state a limit and have not
 * reached it, which is the case a ramp would have had to live in.
 */

import type { Board, Coord, Snake } from '../../types/battlesnake';
import { makeSubstrate, clearGeometryCache, NO_ORDER_MOVE } from '../substrate';
import type { Candidate, JointPlan, UnitId } from '../contracts';
import { defaultEvaluator, makeContext } from '../evaluate';
import { capVerdicts, type TerminalCap } from '../evaluate/terminal';
import type { LawCase } from '../evaluate/laws';
import { makeSnake, piece, cellAt } from '../../tests/board-fixtures';

const TURN = 40;
/** The arrival turn is `TURN + 1`, so a game capped there ENDS on this board. */
const CAP = TURN + 1;

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 7, height: 7, food: [], hazards: [], snakes, ...extra }) as Board;

/** TERMINAL-SOUND's own board: our rook outweighs their whole side, their snake
 *  is held, so `certain` is null and the BRACKET branch is the one exercised. */
const capBoard = (maxTurns: number): Board =>
  boardOf(
    [
      piece('me', { x: 1, y: 1 }, 'rook', 6, { teamID: 'red', health: 90 }),
      makeSnake('them', [{ x: 5, y: 5 }, { x: 5, y: 4 }], {
        teamID: 'blue',
        health: 90,
        orientation: { dx: 0, dy: 1 },
      }),
    ],
    { food: [{ x: 4, y: 5 }], maxTurns }
  );

const caseOf = (board: Board): LawCase => ({
  name: 'a held enemy near the count',
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

/** Run `read` inside a resolution of the one-unit plan on `board`. */
function withResolved<T>(
  board: Board,
  read: (args: { corners: { worst: TerminalCap; best: TerminalCap }; kinds: ReadonlyArray<string> }) => T
): T {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['me'] });
  try {
    const asTeam = sub.teamNumber('red');
    let out: T | null = null;
    let seen = false;
    sub.withResolution(planFor(sub, caseOf(board)), asTeam, ({ resolution, bounds }) => {
      const bracket = resolution.outcome;
      out = read({
        corners: capVerdicts(makeContext(sub, resolution, bounds, asTeam, 0)),
        kinds: bracket.certain === null ? bracket.possibleKinds : [bracket.certain.kind],
      });
      seen = true;
    });
    if (!seen) throw new Error('no resolution');
    return out as T;
  } finally {
    sub.release();
  }
}

afterEach(() => clearGeometryCache());

describe('the turn cap is a step because there is nothing to ramp over', () => {
  it('speaks at the count, and says both corners are WIN', () => {
    // ANTI-VACUITY for the two tests below: the same board, one turn later,
    // is a board the member has a verdict on. A file that only ever watched it
    // abstain would pass with the member deleted.
    expect(withResolved(capBoard(CAP), (r) => r.corners)).toEqual({ worst: 'win', best: 'win' });
  });

  it('abstains on a board whose limit is STATED and not yet reached', () => {
    // The case a ramp would live in, and the one `terminal-sound.test.ts` does
    // not cover: it checks a board with no `maxTurns` at all, where the member
    // returns at `limit === null`. Here the limit is stated and the arrival
    // turn is one, three and ten turns short of it.
    for (const short of [1, 3, 10]) {
      const seen = withResolved(capBoard(CAP + short), (r) => r.corners);
      expect({ short, ...seen }).toEqual({ short, worst: 'none', best: 'none' });
    }
    // And the fold is left whole where the member is silent: finite at both
    // ends, no clamp on either side.
    const board = capBoard(CAP + 3);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['me'] });
    try {
      const asTeam = sub.teamNumber('red');
      const v = defaultEvaluator.evaluatePlan(sub, planFor(sub, caseOf(board)), asTeam);
      expect(v.terminal).toEqual({ loClamped: false, hiClamped: false });
      expect(Number.isFinite(v.bound.lo)).toBe(true);
      expect(Number.isFinite(v.bound.hi)).toBe(true);
    } finally {
      sub.release();
    }
  });

  it('and no width could have changed that: the bracket still says `continues`', () => {
    // THE LOAD-BEARING FACT, asserted on `settlePartial`'s own report rather
    // than on `terminal.ts`. `ended(kinds)` is `kinds.length > 0 &&
    // !kinds.includes('continues')`, and every reachable ending of a board
    // short of its limit includes the one that leaves the game running — so a
    // member allowed to look earlier would abstain for THIS reason instead of
    // for the turn count, at any width. The step is the only shape the
    // boundary admits; a ramp would have to be a different member, priced on
    // something other than the ending (`ENDGAME.md` §5's standing schedule,
    // which belongs to the drives branch).
    for (const short of [1, 3, 10]) {
      const kinds = withResolved(capBoard(CAP + short), (r) => r.kinds);
      expect({ short, continues: kinds.includes('continues') }).toEqual({ short, continues: true });
    }
    // At the count it is gone, which is what makes the assertion above a
    // property of the boundary and not of this board.
    expect(withResolved(capBoard(CAP), (r) => r.kinds).includes('continues')).toBe(false);
  });
});
