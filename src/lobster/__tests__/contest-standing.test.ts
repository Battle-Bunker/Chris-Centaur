/**
 * THE FLAT MEMBER — §2.2 and §3 of `docs/design/contest-gap.md`, on one board.
 *
 * The diagnosis's finding is not that `contest` prices a standing unit badly.
 * It is that once a unit's own cell is beaten the member prices it at a
 * CONSTANT. Two halves, and both of them fire here:
 *
 *   · `lo` IS PINNED BY THE ORIGIN. `settlesOn` returns
 *     `{settle} ∪ {origin} ∪ traversed` for any unit `fates` calls
 *     `contingent`, and `costOf` takes the MAX over that set. The origin is in
 *     the set of every candidate, so a beaten origin makes the worst charge
 *     `CONTEST_LOSS` at every candidate, whatever the destination costs.
 *   · `hi` IS ZEROED. `ourUnitTerm` pays a cost into the best accumulator only
 *     if `worstAlive`, which is false for exactly the units a ledger entry
 *     names — which is any unit in a fan.
 *
 * Both endpoints constant ⇒ `est` constant ⇒ the member expresses no
 * preference among that unit's options at all. That state is 5-6% of decider
 * unit-turns and it carries 67-73% of every contest death, at twenty times the
 * rate of equally exposed unit-turns where the member still has a gradient.
 *
 * §3's proposed repair — σ, a point-valued charge for staging a unit onto a
 * cell an enemy beats in `field⁺` (`contestField` ∪ each enemy's own turn-start
 * cell) — WAS BUILT AND IS NOT IN THE TREE. It shrank this state exactly as
 * predicted and the deaths went the other way; see the STATUS section of
 * `contest-gap.md` for the per-class table and the mechanism.
 *
 * What is left here is the state itself, asserted rather than argued: the
 * arrival charge is EXACTLY equal on every one of five options, and `field⁺`
 * still tells one of them apart. The gap between those two sentences is what a
 * fourth attempt has to spend, and this file is where it will find out whether
 * it has.
 *
 * ── THE BOARD ──────────────────────────────────────────────────────────────
 *
 * §3's own deciding comparison, reduced to the units it turns on, plus the one
 * unit that puts it in the flat state:
 *
 *   red-B    a pawn of ours, weight 2, at (0,2), facing up the x = 0 file
 *   blue-B   an enemy queen at (0,10): its arrival set is that whole file, so
 *            red-B's OWN cell and its forward step are both beaten
 *   blue-C   an enemy pawn of weight ONE at (1,4), whose forward step is
 *            (1,3) — the diagonal red-B can take because (1,3) holds food
 *
 * blue-C is what makes the case a flat one rather than an ordinary one. It
 * puts red-B's arrival at (1,3) in the ledger, so every one of red-B's five
 * options is `contingent` and every one of them is charged at the beaten
 * ORIGIN; and being LIGHTER it does not beat red-B at (1,3), so `field⁺` still
 * tells the diagonal apart from the other four. The arrival charge has thrown
 * that distinction away and `field⁺` has not: which is §2.2's whole claim, on
 * a board of three units.
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
import { standingField } from '../evaluate/contest';
import { piece, cellAt } from '../../tests/board-fixtures';

const TURN = 7;

const reproduction = (): Board =>
  ({
    width: 11,
    height: 11,
    hazards: [],
    food: [{ x: 1, y: 3 }],
    snakes: [
      piece('red-B', { x: 0, y: 2 }, 'pawn', 2, {
        teamID: 'red',
        health: 97,
        // The wire's y axis runs the other way from the board's, so `dy: -1`
        // is the pawn facing UP the file — the same orientation reproduction
        // A's pawn carries in `contest-occupied-cell.test.ts`.
        orientation: { dx: 0, dy: -1 },
      }),
      piece('blue-B', { x: 0, y: 10 }, 'queen', 31, {
        teamID: 'blue',
        health: 100,
        orientation: { dx: 0, dy: 1 },
      }),
      piece('blue-C', { x: 1, y: 4 }, 'pawn', 1, {
        teamID: 'blue',
        health: 100,
        orientation: { dx: 0, dy: 1 },
      }),
    ] as Snake[],
  }) as Board;

const at = (board: Board, c: Coord): number => cellAt(board, TURN, c);

/** The `contest` member alone, for one staged destination of red-B. */
function contestOf(board: Board, to: Coord): Bound {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['red-B'] });
  try {
    const unit = sub.unitOfWireId('red-B')?.unitId as UnitId;
    const dest = at(board, to);
    const plan: JointPlan = new Map<UnitId, Candidate>([
      [unit, { unitId: unit, from: -1, to: dest, path: sub.pathFor(unit, dest) ?? [] }],
    ]);
    const team = sub.teamNumber('red');
    return sub.withResolution(plan, team, ({ resolution, bounds }) =>
      contestFeature.evaluate(makeContext(sub, resolution, bounds, team, 0, DEFAULT_PROFILE))
    );
  } finally {
    sub.release();
  }
}

/** The engine's own verdict on where red-B's arrival could settle. */
function fateOf(board: Board, to: Coord): string {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['red-B'] });
  try {
    const unit = sub.unitOfWireId('red-B')?.unitId as UnitId;
    const wireId = sub.unitOf(unit)?.wireId as string;
    const dest = at(board, to);
    const plan: JointPlan = new Map<UnitId, Candidate>([
      [unit, { unitId: unit, from: -1, to: dest, path: sub.pathFor(unit, dest) ?? [] }],
    ]);
    const team = sub.teamNumber('red');
    return sub.withResolution(plan, team, ({ resolution }) => String(resolution.fates[wireId]));
  } finally {
    sub.release();
  }
}

const FORWARD = { x: 0, y: 3 } as Coord;
const DIAGONAL = { x: 1, y: 3 } as Coord;
const HOLD = { x: 0, y: 2 } as Coord;

afterEach(() => clearGeometryCache());

describe('the flat member: a unit whose own cell is beaten', () => {
  test('the queen holds the file and the light pawn reaches the diagonal without beating us', () => {
    const board = reproduction();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['red-B'] });
    try {
      const team = sub.teamNumber('red');
      const field = contestField(sub, team);
      const origin = at(board, HOLD);
      const forward = at(board, FORWARD);
      const diagonal = at(board, DIAGONAL);
      // THE ENTRY CONDITION of §2.2: the pawn's OWN cell is in the fan, and
      // everything below follows from it.
      expect(field.reached[origin]).toBe(1);
      expect(field.weight[origin]).toBe(31);
      expect(field.reached[forward]).toBe(1);
      // The diagonal is reached — by blue-C — but at weight ONE against our
      // weight two, so `winsContest` says we survive there and the charge is
      // nothing. This is the one option the field can still tell apart.
      expect(field.reached[diagonal]).toBe(1);
      expect(field.weight[diagonal]).toBe(1);
      // And all three options really are offered.
      const pawn = sub.unitOfWireId('red-B')?.unitId as UnitId;
      const targets = sub.actionsOf(pawn).map((a) => a.to);
      expect(targets).toEqual(expect.arrayContaining([forward, diagonal, origin]));
    } finally {
      sub.release();
    }
  });

  test('every option is contingent, which is what puts the origin in every settle set', () => {
    const board = reproduction();
    expect(fateOf(board, FORWARD)).toBe('contingent');
    expect(fateOf(board, DIAGONAL)).toBe('contingent');
    expect(fateOf(board, HOLD)).toBe('contingent');
  });

  test('§2.2 — the ARRIVAL charge is the same on the forward step and the hold, on BOTH ends', () => {
    const board = reproduction();
    const forward = contestOf(board, FORWARD);
    const hold = contestOf(board, HOLD);
    expect(hold).toEqual(forward);
    // One unit of ours is modelled, so a charge is the whole `CONTEST_LOSS`.
    expect(forward.lo).toBeCloseTo(-CONTEST_LOSS, 9);
    // The alive-polarity's half: `worstAlive` is false for a unit the ledger
    // names, so the cost is paid into `lo` and not into `hi` at all.
    expect(forward.hi).toBe(0);
  });

  test('§3 — `field⁺` separates the diagonal from the other four staged cells', () => {
    const board = reproduction();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['red-B'] });
    try {
      const team = sub.teamNumber('red');
      const plus = standingField(sub, team);
      // `field⁺` only ever WIDENS the arrival field, so the file stays beaten
      // and the diagonal stays winnable: the discrimination the bracket threw
      // away is still there to be spent.
      expect(plus.weight[at(board, HOLD)]).toBe(31);
      expect(plus.weight[at(board, FORWARD)]).toBe(31);
      expect(plus.weight[at(board, DIAGONAL)]).toBe(1);
      // And each enemy's own cell, which no arrival set contains for a kind
      // without `stay`, is in this one.
      expect(plus.reached[at(board, { x: 0, y: 10 } as Coord)]).toBe(1);
      expect(plus.reached[at(board, { x: 1, y: 4 } as Coord)]).toBe(1);
    } finally {
      sub.release();
    }
  });

  test('THE DEFECT — the member is exactly equal on the step INTO the file and the step OUT of it', () => {
    const board = reproduction();
    const forward = contestOf(board, FORWARD);
    const diagonal = contestOf(board, DIAGONAL);
    // `chargeAt(diagonal) = 0` and `chargeAt(forward) = CONTEST_LOSS` — the
    // per-cell charge DOES discriminate — and the max over a settle set that
    // contains the beaten origin makes both of them `CONTEST_LOSS` anyway. So
    // the member expresses no preference between walking up an enemy queen's
    // file and walking off it, on every end of the interval, and the move is
    // decided by whatever else moves.
    expect(diagonal).toEqual(forward);
    expect(diagonal.lo).toBeCloseTo(-CONTEST_LOSS, 9);
    // ANY repair to this has to be paid somewhere `costOf`'s bracket does not
    // read, because a bracket containing the origin is pinned by the origin —
    // which is the theorem §4 leaves to the next attempt.
  });
});
