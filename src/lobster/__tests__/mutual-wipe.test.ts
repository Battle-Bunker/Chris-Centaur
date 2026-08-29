/**
 * THE MUTUAL-WIPE AWARD — `CENTAUR_MUTUAL_WIPE_AWARD`, dark by default.
 *
 * TacticToes settles a game in which every remaining team dies on the same turn
 * from the PREVIOUS COMMITTED TURN's board, and the metric this program
 * optimizes is the owner's continuous `sharePar` — share of end weight times
 * team count, par 1 — not a winner flag. So a mutual final wipe BANKS THE
 * PREVIOUS TURN'S POSITION and is worth more the further ahead we were. The
 * shipped ordered clamps price it at the lattice bottom whatever we held. This
 * file holds the repair to its four guards, to its VALUE, to the bounds laws,
 * and — the part that matters most — to the promise that with the flag OFF
 * nothing changes at all.
 *
 *   GATE      the flag parses like every other CL flag, and off means the clamp
 *             expressions reduce to the ones that shipped, in every one of the
 *             sixteen worst/best terminal combinations.
 *   VERDICT   the four refusals, each on a board that exercises it, and the
 *             value the previous board produces when none of them fires.
 *   CLAMPS    what the award actually does to `lo` and `hi` — a FINITE value,
 *             not a lattice end.
 *   LAWS      R1 as the case argument states it, R3 collapse, and the
 *             non-inversion `clampTo` would otherwise throw on.
 *   ENGAGEMENT the counters an arm has to be read by, and the null that says
 *             "this decision never reached the branch".
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { EngineSubstrate } from '../substrate';
import {
  DEAD,
  MUTUAL_WIPE_AWARD_ENV,
  WIN,
  finish,
  mutualWipeAwardFrom,
  mutualWipeReportOf,
  mutualWipeVerdict,
} from '../evaluate';
import type { EvalContext, Evaluation, Standing } from '../evaluate';

// --------------------------------------------------------------------- fixtures

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

/** A snake of exactly `weight` cells, laid out in a column from `x, y`. */
const worm = (id: string, teamID: string, x: number, y: number, weight: number): Snake =>
  makeSnake(
    id,
    Array.from({ length: weight }, (_, i) => ({ x, y: y + i })),
    { teamID }
  );

const boardOf = (snakes: Snake[]): Board =>
  ({ width: 11, height: 11, food: [], hazards: [], snakes }) as Board;

const TURN = 30;

function substrateOf(
  snakes: Snake[],
  asTeam: string,
  observedTurns?: ReadonlyMap<string, number>
): EngineSubstrate {
  return makeSubstrate({ board: boardOf(snakes), turn: TURN, asTeam, observedTurns });
}

afterEach(() => {
  clearGeometryCache();
  delete process.env[MUTUAL_WIPE_AWARD_ENV];
});

/**
 * A context carrying only what `finish` and `terminalVerdicts` read: a real
 * substrate (for the roster the previous-turn rule is computed from and for
 * `regicideTeamNumbers`), a team, and a standing per team with its two alive
 * bits set by hand. The resolution is a stub because the clamp does not read
 * the position — only the two terminal verdicts and the fold's total.
 */
function contextOf(
  sub: EngineSubstrate,
  asTeam: number,
  alive: ReadonlyArray<{ team: number; worstAlive: boolean; bestAlive: boolean }>
): EvalContext {
  const standing = alive.map((a, i) => ({
    unitId: i,
    team: a.team,
    kind: 0,
    isKing: false,
    held: false,
    weightMin: 1,
    weightMax: 1,
    tierMin: 0,
    tierMax: 0,
    tierExpiresAtTurn: null,
    partialLossMax: 0,
    health: 100,
    cell: i,
    worstAlive: a.worstAlive,
    bestAlive: a.bestAlive,
  })) as unknown as ReadonlyArray<Standing>;
  return {
    sub,
    asTeam,
    standing,
    teams: new Set(alive.map((a) => a.team)),
    resolution: { state: { field: { assumptions: () => [] } }, ledger: [] },
  } as unknown as EvalContext;
}

const evaluationOf = (lo: number, hi: number): Evaluation => ({
  total: { lo, est: (lo + hi) / 2, hi },
  parts: {},
  exact: false,
});

/** The four terminal shapes, as (worstAlive, bestAlive) pairs per team. */
const GONE = { worstAlive: false, bestAlive: false }; // certainly eliminated
const ALIVE = { worstAlive: true, bestAlive: true }; // certainly standing
/** Ours: dead in the worst reading, alive in the best — a contingent unit. */
const OURS_MAYBE = { worstAlive: false, bestAlive: true };
/** Theirs: alive in OUR worst reading, dead in our best — their contingent. */
const THEIRS_MAYBE = { worstAlive: true, bestAlive: false };

// ------------------------------------------------------------------------ gate

describe('the flag', () => {
  test('parses like every other CL flag, and defaults OFF', () => {
    expect(mutualWipeAwardFrom({})).toBe(false);
    expect(mutualWipeAwardFrom({ [MUTUAL_WIPE_AWARD_ENV]: '1' })).toBe(true);
    expect(mutualWipeAwardFrom({ [MUTUAL_WIPE_AWARD_ENV]: 'on' })).toBe(true);
    expect(mutualWipeAwardFrom({ [MUTUAL_WIPE_AWARD_ENV]: 'true' })).toBe(true);
    expect(mutualWipeAwardFrom({ [MUTUAL_WIPE_AWARD_ENV]: '0' })).toBe(false);
    expect(mutualWipeAwardFrom({ [MUTUAL_WIPE_AWARD_ENV]: 'yes' })).toBe(false);
    expect(mutualWipeAwardFrom({ [MUTUAL_WIPE_AWARD_ENV]: '' })).toBe(false);
  });

  /**
   * THE DARK GATE, checked exhaustively rather than argued.
   *
   * Sixteen combinations of the two alive bits for two teams, on a board where
   * we are comfortably ahead — so if the flag leaked at all, at least one of
   * these would move. The reference is the expression that shipped:
   *
   *     lo = worst.subjectGone ? DEAD : worst.othersGone ? WIN : total.lo
   *     hi = best.subjectGone  ? DEAD : best.othersGone  ? WIN : total.hi
   */
  test('OFF reproduces the shipped clamps in all sixteen terminal combinations', () => {
    const sub = substrateOf([worm('a', 'red', 1, 1, 6), worm('b', 'blue', 5, 1, 3)], 'red');
    const bits = [
      { worstAlive: false, bestAlive: false },
      { worstAlive: false, bestAlive: true },
      { worstAlive: true, bestAlive: false },
      { worstAlive: true, bestAlive: true },
    ];
    for (const ours of bits) {
      for (const theirs of bits) {
        const ctx = contextOf(sub, 0, [
          { team: 0, ...ours },
          { team: 1, ...theirs },
        ]);
        const subjectGoneWorst = !ours.worstAlive;
        const subjectGoneBest = !ours.bestAlive;
        const othersGoneWorst = !theirs.worstAlive;
        const othersGoneBest = !theirs.bestAlive;
        const wantLo = subjectGoneWorst ? DEAD : othersGoneWorst ? WIN : -2;
        const wantHi = subjectGoneBest ? DEAD : othersGoneBest ? WIN : 7;
        const got = finish(ctx, evaluationOf(-2, 7)).bound;
        expect([got.lo, got.hi]).toEqual([
          Math.min(wantLo, wantHi),
          Math.max(wantLo, wantHi),
        ]);
      }
    }
    // Nothing was even allocated: the module is never reached off the flag.
    expect(mutualWipeReportOf(sub)).toBeNull();
  });
});

// --------------------------------------------------------------------- verdict

describe('the previous-turn verdict', () => {
  const verdictOf = (sub: EngineSubstrate, team: number) =>
    mutualWipeVerdict(sub, team).verdict;

  test('awards a strict lead on a fully observed board, and prices it', () => {
    const sub = substrateOf([worm('a', 'red', 1, 1, 6), worm('b', 'blue', 5, 1, 5)], 'red');
    // Subject-frame fold of the PREVIOUS board: 6 ours minus 5 theirs.
    expect(mutualWipeVerdict(sub, sub.teamNumber('red'))).toMatchObject({
      verdict: 'awarded',
      differential: 1,
    });
  });

  test('refuses an exact tie, which the game itself would pay as a joint win', () => {
    // Deliberately stricter than the metric needs. A tie has a real value; the
    // guard leaves DEAD standing anyway, which errs toward declining a trade.
    const sub = substrateOf([worm('a', 'red', 1, 1, 5), worm('b', 'blue', 5, 1, 5)], 'red');
    expect(mutualWipeVerdict(sub, sub.teamNumber('red'))).toMatchObject({
      verdict: 'not-ahead',
      differential: null,
    });
  });

  test('refuses when behind', () => {
    const sub = substrateOf([worm('a', 'red', 1, 1, 3), worm('b', 'blue', 5, 1, 5)], 'red');
    expect(verdictOf(sub, sub.teamNumber('red'))).toBe('not-ahead');
  });

  test('needs to beat EVERY other team, not the total and not the best of them', () => {
    const ahead = substrateOf(
      [worm('a', 'red', 1, 1, 6), worm('b', 'blue', 5, 1, 4), worm('c', 'green', 9, 1, 4)],
      'red'
    );
    // Ahead of both, and the subject-frame fold is NEGATIVE: 6 - (4 + 4). That
    // is the documented boundary — materialFeature is subject-frame everywhere,
    // and this module inherits it rather than inventing a second currency.
    expect(mutualWipeVerdict(ahead, ahead.teamNumber('red'))).toMatchObject({
      verdict: 'awarded',
      differential: -2,
    });
    // Ahead of blue, level with green: the game would draw with green, so no award.
    const level = substrateOf(
      [worm('a', 'red', 1, 1, 6), worm('b', 'blue', 5, 1, 4), worm('c', 'green', 9, 1, 6)],
      'red'
    );
    expect(verdictOf(level, level.teamNumber('red'))).toBe('not-ahead');
  });

  /**
   * The affine identity the header rests on: within a decision the previous
   * board is fixed, so the differential and the owner's metric order the same
   * way. differential = total x (2 x sharePar / n - 1).
   */
  test('the differential is the previous-turn share, rescaled by the board', () => {
    for (const [ours, theirs] of [[6, 5], [9, 2], [7, 3]]) {
      const sub = substrateOf(
        [worm('a', 'red', 1, 1, ours), worm('b', 'blue', 5, 1, theirs)],
        'red'
      );
      const award = mutualWipeVerdict(sub, sub.teamNumber('red'));
      const total = ours + theirs;
      expect(award.sharePar).toBeCloseTo((2 * ours) / total, 10);
      expect(award.differential).toBeCloseTo(total * ((2 * award.sharePar!) / 2 - 1), 10);
      clearGeometryCache();
    }
  });

  test('refuses the whole award on a board carrying an unobserved unit', () => {
    const sub = substrateOf(
      [worm('a', 'red', 1, 1, 6), worm('b', 'blue', 5, 1, 3)],
      'red',
      new Map([['b', TURN - 4]])
    );
    expect(verdictOf(sub, sub.teamNumber('red'))).toBe('stale-board');
  });

  test('refuses a board with nobody to beat', () => {
    const sub = substrateOf([worm('a', 'red', 1, 1, 6)], 'red');
    expect(verdictOf(sub, sub.teamNumber('red'))).toBe('no-rivals');
  });

  test('refuses a team with no weight on the previous board', () => {
    const sub = substrateOf([worm('a', 'red', 1, 1, 6), worm('b', 'blue', 5, 1, 3)], 'red');
    // A team number nobody on this board holds: zero weight, nothing to award.
    expect(verdictOf(sub, 7)).toBe('no-weight');
  });
});

// ---------------------------------------------------------------------- clamps

describe('what the award does to the bound', () => {
  // red 6, blue 3: the previous board's subject-frame fold is +3, and the
  // clamp lands it on the fold's own scale — x10, the default material weight.
  const AHEAD_VALUE = 30;
  const ahead = () =>
    substrateOf([worm('a', 'red', 1, 1, 6), worm('b', 'blue', 5, 1, 3)], 'red');
  const behind = () =>
    substrateOf([worm('a', 'red', 1, 1, 3), worm('b', 'blue', 5, 1, 6)], 'red');

  test('a CERTAIN mutual wipe while ahead prices at the previous turn, not at DEAD', () => {
    const sub = ahead();
    const ctx = contextOf(sub, 0, [
      { team: 0, ...GONE },
      { team: 1, ...GONE },
    ]);
    expect(finish(ctx, evaluationOf(-2, 7)).bound).toMatchObject({ lo: DEAD, hi: DEAD });

    process.env[MUTUAL_WIPE_AWARD_ENV] = '1';
    const on = substrateOf([worm('a', 'red', 1, 1, 6), worm('b', 'blue', 5, 1, 3)], 'red');
    const onCtx = contextOf(on, 0, [
      { team: 0, ...GONE },
      { team: 1, ...GONE },
    ]);
    // Finite and exact — the previous board is fully observed, so there is
    // nothing left to be uncertain about. NOT the lattice top: a wipe while
    // three ahead is worth three ahead, and no more.
    expect(finish(onCtx, evaluationOf(-2, 7)).bound).toMatchObject({
      lo: AHEAD_VALUE,
      hi: AHEAD_VALUE,
    });
  });

  test('the value scales with the PROFILE\'s material weight, not with a constant', () => {
    process.env[MUTUAL_WIPE_AWARD_ENV] = '1';
    const sub = ahead();
    const ctx = contextOf(sub, 0, [
      { team: 0, ...GONE },
      { team: 1, ...GONE },
    ]);
    // A recalibrated profile must price its terminals in its own units, or the
    // terminal and the fold would be denominated differently.
    expect(finish(ctx, evaluationOf(-2, 7), 3).bound).toMatchObject({ lo: 9, hi: 9 });
  });

  test('a wipe while further ahead is worth MORE — the metric is continuous', () => {
    process.env[MUTUAL_WIPE_AWARD_ENV] = '1';
    const wipeAt = (ours: number, theirs: number) => {
      const sub = substrateOf(
        [worm('a', 'red', 1, 1, ours), worm('b', 'blue', 5, 1, theirs)],
        'red'
      );
      const bound = finish(
        contextOf(sub, 0, [
          { team: 0, ...GONE },
          { team: 1, ...GONE },
        ]),
        evaluationOf(-2, 7)
      ).bound;
      clearGeometryCache();
      return bound.lo;
    };
    const narrow = wipeAt(4, 3);
    const wide = wipeAt(9, 3);
    expect(narrow).toBeLessThan(wide);
    // And neither is a lattice end: this is the whole difference from a
    // winner-take-all reading, which would have scored both identically.
    expect(Number.isFinite(narrow)).toBe(true);
    expect(Number.isFinite(wide)).toBe(true);
  });

  test('a certain mutual wipe while BEHIND stays DEAD with the flag on', () => {
    process.env[MUTUAL_WIPE_AWARD_ENV] = '1';
    const sub = behind();
    const ctx = contextOf(sub, 0, [
      { team: 0, ...GONE },
      { team: 1, ...GONE },
    ]);
    expect(finish(ctx, evaluationOf(-2, 7)).bound).toMatchObject({ lo: DEAD, hi: DEAD });
  });

  test('certainly gone while they only MIGHT be: a TIGHT finite ceiling', () => {
    process.env[MUTUAL_WIPE_AWARD_ENV] = '1';
    const sub = ahead();
    // Their unit is alive in our worst reading and dead in our best — the
    // contingent enemy. So `worst.othersGone` is false and `best.othersGone` is
    // true: a mutual wipe is possible, not certain. The world is either the
    // wipe (finite) or us alone gone (DEAD), so the ceiling is the wipe's own
    // value — not WIN, which a binary reading would have had to claim.
    const ctx = contextOf(sub, 0, [
      { team: 0, ...GONE },
      { team: 1, ...THEIRS_MAYBE },
    ]);
    expect(finish(ctx, evaluationOf(-2, 7)).bound).toMatchObject({
      lo: DEAD,
      hi: AHEAD_VALUE,
    });
  });

  test('certainly gone while they certainly survive is a loss at both ends', () => {
    process.env[MUTUAL_WIPE_AWARD_ENV] = '1';
    const sub = ahead();
    const ctx = contextOf(sub, 0, [
      { team: 0, ...GONE },
      { team: 1, ...ALIVE },
    ]);
    expect(finish(ctx, evaluationOf(-2, 7)).bound).toMatchObject({ lo: DEAD, hi: DEAD });
  });

  test('we might survive and they are certainly gone: banked value up to a win', () => {
    process.env[MUTUAL_WIPE_AWARD_ENV] = '1';
    const sub = ahead();
    const ctx = contextOf(sub, 0, [
      { team: 0, ...OURS_MAYBE },
      { team: 1, ...GONE },
    ]);
    // Worst reading: our contingent unit dies too, so this is the wipe and it
    // banks the previous turn. Best reading: we stand alone on an empty board,
    // which is the whole share and stays the lattice top.
    expect(finish(ctx, evaluationOf(-2, 7)).bound).toMatchObject({
      lo: AHEAD_VALUE,
      hi: WIN,
    });
  });

  test('a position nobody died in is untouched by the flag', () => {
    process.env[MUTUAL_WIPE_AWARD_ENV] = '1';
    const sub = ahead();
    const ctx = contextOf(sub, 0, [
      { team: 0, ...ALIVE },
      { team: 1, ...ALIVE },
    ]);
    expect(finish(ctx, evaluationOf(-2, 7)).bound).toMatchObject({ lo: -2, hi: 7 });
    expect(mutualWipeReportOf(sub)).toBeNull();
  });
});

// ----------------------------------------------------------------------- laws

describe('the bounds laws under the award', () => {
  /**
   * The readings are NESTED — ours contingent-dead and theirs contingent-alive
   * in the worst, the mirror in the best — so `subjectGone` can only go from
   * true in the best to true in the worst, and `othersGone` the other way. The
   * clamp must never invert, because `clampTo` throws when it does, and it must
   * COLLAPSE when the two readings agree.
   */
  test('never inverts, and collapses on a single world', () => {
    process.env[MUTUAL_WIPE_AWARD_ENV] = '1';
    const bits = [GONE, ALIVE, OURS_MAYBE, THEIRS_MAYBE];
    for (const ours of bits) {
      for (const theirs of bits) {
        const sub = substrateOf(
          [worm('a', 'red', 1, 1, 6), worm('b', 'blue', 5, 1, 3)],
          'red'
        );
        const ctx = contextOf(sub, 0, [
          { team: 0, ...ours },
          { team: 1, ...theirs },
        ]);
        // R3 is a statement about a position with ONE world, so the fold it is
        // checked against has to be a point too — a two-ended fold interval
        // survives a clamp that does not fire, and rightly.
        const { lo, hi } = finish(ctx, evaluationOf(3, 3)).bound;
        expect(lo).toBeLessThanOrEqual(hi);
        const oneWorld =
          ours.worstAlive === ours.bestAlive && theirs.worstAlive === theirs.bestAlive;
        if (oneWorld) expect(lo).toBe(hi);
        // And with a two-ended fold the clamp still may not invert.
        const wide = finish(ctx, evaluationOf(-2, 7)).bound;
        expect(wide.lo).toBeLessThanOrEqual(wide.hi);
        clearGeometryCache();
      }
    }
  });

  /**
   * R1, in the form the case argument makes: the floor is only lifted off DEAD
   * where every other team is gone in the reading that keeps ALL of their
   * contingent units alive — so they are gone in every consistent world, and
   * whether we survive (last team standing, the lattice top) or die with them
   * (the wipe, worth the previous turn's position), the floor holds.
   */
  test('the floor only lifts off DEAD where every rival is certainly gone', () => {
    process.env[MUTUAL_WIPE_AWARD_ENV] = '1';
    const bits = [GONE, ALIVE, OURS_MAYBE, THEIRS_MAYBE];
    for (const ours of bits) {
      for (const theirs of bits) {
        const sub = substrateOf(
          [worm('a', 'red', 1, 1, 6), worm('b', 'blue', 5, 1, 3)],
          'red'
        );
        const ctx = contextOf(sub, 0, [
          { team: 0, ...ours },
          { team: 1, ...theirs },
        ]);
        const { lo } = finish(ctx, evaluationOf(-2, 7)).bound;
        // A floor above the fold's own worst end can only come from a terminal.
        if (lo === WIN || lo === 30) expect(theirs.worstAlive).toBe(false);
        clearGeometryCache();
      }
    }
  });
});

// ------------------------------------------------------------------ engagement

describe('engagement', () => {
  test('counts what the arm actually did, and stays null when it did nothing', () => {
    process.env[MUTUAL_WIPE_AWARD_ENV] = '1';
    const sub = substrateOf([worm('a', 'red', 1, 1, 6), worm('b', 'blue', 5, 1, 3)], 'red');
    expect(mutualWipeReportOf(sub)).toBeNull();

    const wipe = contextOf(sub, 0, [
      { team: 0, ...GONE },
      { team: 1, ...GONE },
    ]);
    finish(wipe, evaluationOf(-2, 7));
    finish(wipe, evaluationOf(-2, 7));
    const report = mutualWipeReportOf(sub);
    expect(report).toMatchObject({
      reached: 2,
      awarded: 2,
      refusedNotAhead: 0,
      movedLo: 2,
      movedHi: 2,
    });
  });

  test('records the refusal rather than the award when the lead is not there', () => {
    process.env[MUTUAL_WIPE_AWARD_ENV] = '1';
    const sub = substrateOf([worm('a', 'red', 1, 1, 3), worm('b', 'blue', 5, 1, 6)], 'red');
    const wipe = contextOf(sub, 0, [
      { team: 0, ...GONE },
      { team: 1, ...GONE },
    ]);
    finish(wipe, evaluationOf(-2, 7));
    expect(mutualWipeReportOf(sub)).toMatchObject({
      reached: 1,
      awarded: 0,
      refusedNotAhead: 1,
      movedLo: 0,
      movedHi: 0,
    });
  });
});
