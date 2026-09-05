/**
 * THE TURN CAP'S ONE KNOB — the read-ahead WINDOW, and the two things that must
 * be true of it at every setting.
 *
 * `model/terminal@1` has no weight. It is not a feature, it never appears in
 * `parts`, and `finish` REPLACES the fold's ends with lattice elements rather
 * than adding a scaled term to them — so "price the end less keenly" has no
 * expression in this member, and giving it one means making `DEAD` a large
 * finite number, which is `calibration.ts` fact 3's already-refused change. The
 * only dial its shape admits is how many turns before the cap it may LOOK at
 * the board: `TERMINAL_READ_AHEAD_TURNS`, zero by default, overridable per
 * process by `CENTAUR_TERMINAL_READ_AHEAD` for the sweep in
 * `docs/design/TERMINAL-GAIN.md` §3.
 *
 * ── THE TWO CLAIMS ─────────────────────────────────────────────────────────
 *
 * 1. THE WINDOW IS A COST GATE, NEVER A SOUNDNESS ONE. Everything in
 *    `capVerdicts` below the turn test derives from `ended(kinds)` — *no world
 *    this settlement admits leaves the game running* — and never from the turn
 *    count (TERMINAL-SOUND §2.1). So widening it cannot make the member speak
 *    where it has no proof, and NARROWING it past zero would be the one
 *    direction that leaves an ended board scored by the interior fold: a
 *    negative setting is refused rather than clamped.
 *
 * 2. AND THAT IS EXACTLY WHY IT CANNOT BUY A RAMP. A "ramp over the last N
 *    turns" wants the boundary to start pricing the end before the end. It
 *    cannot: before the cap the game does not end on the count, `adjudicate`
 *    returns `continues`, `ended` is false and the member abstains — at every
 *    width. The test below is that abstention, on the SAME board the member
 *    speaks on one turn later, so the only difference between the two runs is
 *    the turn the cap falls on.
 */

import type { Board, Coord, Snake } from '../../types/battlesnake';
import { makeSubstrate, clearGeometryCache, NO_ORDER_MOVE } from '../substrate';
import type { Candidate, JointPlan, UnitId } from '../contracts';
import { makeContext } from '../evaluate';
import { TERMINAL_READ_AHEAD_TURNS } from '../evaluate/calibration';
import type { TerminalCap } from '../evaluate/terminal';
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

/**
 * The member's corners on `board`, read through a module graph loaded with
 * `CENTAUR_TERMINAL_READ_AHEAD` set to `window`.
 *
 * A FRESH GRAPH PER SETTING, because the knob is resolved ONCE AT MODULE LOAD
 * — a `process.env` lookup per evaluation is a trip through the real
 * environment on the hot path of every leaf (`features.ts`'s `royalReachers`
 * note measured that same lookup at 1.4% of self time). One runner game is one
 * process, which is the cadence the sweep needs and the cadence this reproduces.
 */
function cornersAt(window: number | null, board: Board): { worst: TerminalCap; best: TerminalCap } {
  const previous = process.env.CENTAUR_TERMINAL_READ_AHEAD;
  if (window === null) delete process.env.CENTAUR_TERMINAL_READ_AHEAD;
  else process.env.CENTAUR_TERMINAL_READ_AHEAD = String(window);
  try {
    let corners: { worst: TerminalCap; best: TerminalCap } | null = null;
    jest.isolateModules(() => {
      const { capVerdicts } = require('../evaluate/terminal') as typeof import('../evaluate/terminal');
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['me'] });
      try {
        const asTeam = sub.teamNumber('red');
        sub.withResolution(planFor(sub, caseOf(board)), asTeam, ({ resolution, bounds }) => {
          corners = capVerdicts(makeContext(sub, resolution, bounds, asTeam, 0));
        });
      } finally {
        sub.release();
      }
    });
    if (corners === null) throw new Error('no resolution');
    return corners;
  } finally {
    if (previous === undefined) delete process.env.CENTAUR_TERMINAL_READ_AHEAD;
    else process.env.CENTAUR_TERMINAL_READ_AHEAD = previous;
  }
}

/** Loading `terminal.ts` with the environment as given, for the refusals. */
function loadWith(raw: string): void {
  const previous = process.env.CENTAUR_TERMINAL_READ_AHEAD;
  process.env.CENTAUR_TERMINAL_READ_AHEAD = raw;
  try {
    jest.isolateModules(() => {
      require('../evaluate/terminal');
    });
  } finally {
    if (previous === undefined) delete process.env.CENTAUR_TERMINAL_READ_AHEAD;
    else process.env.CENTAUR_TERMINAL_READ_AHEAD = previous;
  }
}

afterEach(() => clearGeometryCache());

describe("model/terminal@1's read-ahead window", () => {
  it('ships at zero — a step exactly at the cap, and nothing before it', () => {
    expect(TERMINAL_READ_AHEAD_TURNS).toBe(0);
  });

  it('speaks at the count at every width, and says the same thing', () => {
    // ANTI-VACUITY for everything below: on the board that HAS ended, the
    // member's verdict is `[win, win]` and widening the window never moves it.
    // A width that changed a corner would be a width that changed a bound.
    const atCount = capBoard(CAP);
    for (const w of [null, 0, 1, 3, 12]) {
      expect(cornersAt(w, atCount)).toEqual({ worst: 'win', best: 'win' });
    }
  });

  it('abstains before the count at every width — there is no ramp to buy', () => {
    // THE CLAIM. The same board, one and three turns short of its cap. At width
    // 0 the turn test turns it away; at width 3 and width 12 the turn test lets
    // it THROUGH and `ended` turns it away instead, because a game that has not
    // reached its limit has `continues` among its reachable endings. Both
    // refusals are `none`, which is what makes a wider window inert rather than
    // gentler: there is no sound reading of the boundary at turn 55 of a
    // 60-turn game, because at turn 55 the game does not end.
    for (const short of [1, 3]) {
      const before = capBoard(CAP + short);
      for (const w of [null, 0, 1, 3, 12]) {
        expect({ short, w, ...cornersAt(w, before) }).toEqual({
          short,
          w,
          worst: 'none',
          best: 'none',
        });
      }
    }
  });

  it('refuses a setting that would NARROW the window past the cap', () => {
    // The one direction that is not a cost question: a negative width leaves a
    // board that HAS ended scored by the interior fold, which is the hole
    // `ENDGAME.md` §1 found. Refused at load rather than clamped, so a typo in
    // a sweep cannot quietly measure an unsound member.
    expect(() => loadWith('-1')).toThrow(/non-negative integer/);
    expect(() => loadWith('2.5')).toThrow(/non-negative integer/);
    expect(() => loadWith('lots')).toThrow(/non-negative integer/);
  });
});
