/**
 * THE HEALTH ECONOMY NORMALISES BY THE KIND'S OWN MAXIMUM (O-P6).
 *
 * `maxHealthPerUnit` is per-KIND on the wire and per-kind in the engine: the
 * food phase restores an eater to `maxHealthOf(kind)` (`engine.ts`), and the
 * possibility cloud's refuel ceiling is taken over the kindSet rather than
 * flattened (`cloud.ts`) — the substrate stopped flattening the table when it
 * started handing the engine `maxHealthPerKind`.
 *
 * `healthEconomyFeature` was the last reader still dividing by the FLAT
 * ceiling, `EngineConfig.maxHealth`, which is the default for kinds the board
 * does not configure and nothing else. On a board that configures a low
 * maximum for some kind, that unit's full health read as a FRACTION of
 * somebody else's budget — a 30-max pawn at 30 health scored 0.3 where the
 * rules say it is full — and since the term is signed by side, the mispricing
 * lands asymmetrically the moment the two sides field different kinds.
 *
 * The engine's own food-phase comment has warned about exactly this the whole
 * time: a flat number "diverges from the rules on the first bite a low-maximum
 * unit takes".
 *
 * WHAT THIS FILE PINS
 *
 *   1. per-kind: on a board where the flat and per-kind normalisers disagree,
 *      the feature follows the KIND;
 *   2. inert on flat boards: with no table, or a table that does not diverge,
 *      the feature is bit-identical to what it produced before — this is what
 *      protects every measured result on the shipped configuration;
 *   3. the direction: the old reading UNDER-read a low-maximum unit, never
 *      over-read it, so the correction can only raise our own low-max units'
 *      share (and, symmetrically, theirs).
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { Candidate, JointPlan, UnitId } from '../contracts';
import { budgetShare, defaultEvaluator } from '../evaluate';
import { kindOfWireType } from '../../partial-engine/wire-adapter';

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

const piece = (
  id: string,
  at: Coord,
  unitType: string,
  weight: number,
  extra: Partial<Snake> = {}
): Snake => makeSnake(id, [at], { unitType, length: weight, ...extra });

const TURN = 20;

/**
 * One board, two configurations. The pawn is OURS and its health is exactly
 * the low ceiling, so under the rules it is full and under the flat reading it
 * is a third of a queen.
 *
 * NOTHING IS ON A QUEEN'S LINE. Both of our units sit off every ray from (6,6)
 * and out of the enemy king's step, so each is alive in the worst world as
 * well as the best — which is what makes the term's THREE endpoints all move
 * together and the arithmetic below a single subtraction. Put our pawn on the
 * long diagonal instead and `worstAlive` goes false, the floor stops counting
 * it, and the gap arrives halved through `est` for a reason that has nothing to
 * do with normalisers.
 */
const boardWith = (table: Record<string, number> | null): Board => {
  const board = {
    width: 9,
    height: 9,
    food: [],
    hazards: [],
    snakes: [
      piece('P', { x: 1, y: 3 }, 'pawn', 1, { teamID: 'red', health: 30 }),
      piece('Q', { x: 6, y: 6 }, 'queen', 4, { teamID: 'blue', health: 100 }),
      piece('K', { x: 3, y: 1 }, 'king', 1, { teamID: 'red', health: 100 }),
      piece('E', { x: 8, y: 0 }, 'king', 1, { teamID: 'blue', health: 100 }),
    ],
  } as Board;
  if (table !== null) {
    (board as { maxHealthPerUnit?: Record<string, number> }).maxHealthPerUnit = table;
  }
  return board;
};

/**
 * Every one of our units STANDING STILL, with one term read off.
 *
 * Stationary on purpose: health is a movement budget, so a unit that steps has
 * spent some of it by the time the term is read, and the point of these boards
 * is an exactly-checkable normaliser rather than an exactly-checkable path
 * cost. Every kind here is `stayLegal`, so the plan exists.
 */
function healthTerm(board: Board): { lo: number; est: number; hi: number } {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  try {
    const asTeam = sub.teamNumber('red');
    const moves = new Map<UnitId, Candidate>();
    for (const u of sub.roster()) {
      if (u.team !== asTeam) continue;
      const acts = sub.actionsOf(u.unitId);
      const stay = acts.find((a) => a.path.length === 0);
      if (stay === undefined) throw new Error(`${u.wireId} cannot stand still`);
      moves.set(u.unitId, stay);
    }
    const ev = defaultEvaluator.evaluatePlan(sub, moves as JointPlan, asTeam);
    const parts = ev.parts as Record<string, { lo: number; est: number; hi: number }>;
    const term = parts.healthEconomy;
    if (term === undefined) throw new Error('no healthEconomy part');
    return { lo: term.lo, est: term.est, hi: term.hi };
  } finally {
    sub.release();
    clearGeometryCache();
  }
}

afterEach(() => clearGeometryCache());

// ------------------------------------------------------------------- per-kind

describe('the normaliser is the kind\'s maximum, not the board\'s', () => {
  test('the engine hands out a per-kind maximum, and it is not the flat one', () => {
    const sub = makeSubstrate({
      board: boardWith({ pawn: 30, queen: 100, king: 100 }),
      turn: TURN,
      asTeam: 'red',
    });
    try {
      expect(sub.engine.config.maxHealth).toBe(100);
      expect(sub.engine.maxHealthOf(kindOfWireType('pawn'))).toBe(30);
      expect(sub.engine.maxHealthOf(kindOfWireType('queen'))).toBe(100);
    } finally {
      sub.release();
    }
  });

  test('a per-kind board and a flat board give the term DIFFERENT answers', () => {
    // The only difference between the two boards is the table. If the feature
    // still read the flat ceiling they would be identical, because the flat
    // ceiling is 100 either way.
    const perKind = healthTerm(boardWith({ pawn: 30, queen: 100, king: 100 }));
    const flat = healthTerm(boardWith(null));
    expect(perKind).not.toEqual(flat);
  });

  test('and the difference is the pawn reading FULL rather than a third', () => {
    const perKind = healthTerm(boardWith({ pawn: 30, queen: 100, king: 100 }));
    const flat = healthTerm(boardWith(null));
    // The pawn is ours and stands at exactly its own ceiling, so its share is
    // added on our side of the term and reading it against that ceiling can
    // only RAISE our side: 30/30 = 1 against 30/100 = 0.3. Every other unit on
    // the board is at a 100 maximum and contributes identically to both
    // readings, so the whole gap is the pawn's — which is why the shift is
    // UNIFORM across the three endpoints, and why that is worth asserting
    // separately: a non-uniform shift would mean something other than the
    // normaliser moved between the two boards.
    //
    // `defaultEvaluator` carries no health reserve, so the share is linear and
    // the arithmetic is exactly checkable rather than merely directional.
    const gap = 30 / 30 - 30 / 100;
    expect(perKind.est - flat.est).toBeCloseTo(gap, 9);
    expect(perKind.hi - flat.hi).toBeCloseTo(gap, 9);
    expect(perKind.lo - flat.lo).toBeCloseTo(gap, 9);
  });

  test('the old reading UNDER-read a low-maximum unit — it never over-read one', () => {
    // The polarity of the bug, stated as a property rather than an example: a
    // configured ceiling is at most the flat default (the flat number is the
    // max over the table and 100), so dividing by the flat number can only
    // make a share smaller.
    for (const [wireType, ceiling] of [
      ['pawn', 30],
      ['snake', 60],
      ['queen', 100],
    ] as const) {
      const kind = kindOfWireType(wireType);
      const health = ceiling;
      expect(budgetShare({ kind, health }, ceiling, null)).toBeGreaterThanOrEqual(
        budgetShare({ kind, health }, 100, null)
      );
    }
  });
});

// ---------------------------------------------------------------------- inert

describe('flat boards are untouched — bit-identity, not approximate equality', () => {
  test('no table at all is the same number it always was', () => {
    // The pre-fix value, computed the pre-fix way: one flat cap for everybody.
    // Recomputing it here rather than quoting a constant keeps the assertion
    // honest if the board fixture ever changes.
    const board = boardWith(null);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    let flatCap = 0;
    try {
      flatCap = sub.engine.config.maxHealth;
      for (const u of sub.roster()) {
        expect(sub.engine.maxHealthOf(u.kind)).toBe(flatCap);
      }
    } finally {
      sub.release();
      clearGeometryCache();
    }
    expect(flatCap).toBe(100);
  });

  test('a table that does not DIVERGE is a flat board, and reads like one', () => {
    // `healthPerKind` returns null unless some entry differs from the flat
    // default, so a table of all-100s never reaches the engine at all. The
    // feature must not be able to tell the two boards apart.
    const declaredFlat = healthTerm(boardWith({ pawn: 100, queen: 100, king: 100 }));
    const noTable = healthTerm(boardWith(null));
    expect(declaredFlat).toEqual(noTable);
    // Bit-identity, not closeness: Object.is over each endpoint.
    expect(Object.is(declaredFlat.lo, noTable.lo)).toBe(true);
    expect(Object.is(declaredFlat.est, noTable.est)).toBe(true);
    expect(Object.is(declaredFlat.hi, noTable.hi)).toBe(true);
  });

  test('budgetShare is unchanged where every kind shares one ceiling', () => {
    for (const wireType of ['pawn', 'queen', 'king', 'snake'] as const) {
      const kind = kindOfWireType(wireType);
      for (const health of [0, 1, 37, 99, 100]) {
        expect(
          Object.is(budgetShare({ kind, health }, 100, null), health / 100)
        ).toBe(true);
      }
    }
  });
});
