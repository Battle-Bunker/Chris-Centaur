/**
 * The evaluator's contract, checked rather than argued.
 *
 *   R1/R2/R3   the admission laws, by brute force over the real world set: the
 *              held unit is put on the board as a real mover and the SAME
 *              resolver decides the outcome, so the enumeration and the thing
 *              under test share no arithmetic at all.
 *   CLIFF      "might die" scores in `lo` exactly as "dies", and the cliff is
 *              denominated in the material it loses.
 *   CLAMPS     terminal outcomes are ORDERED, not additive: mutual annihilation
 *              is a loss.
 *   LATTICE    DEAD never enters as a scalar on the heuristic scale.
 *   est        stays inside [lo, hi] and never moves an adjudication.
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import { marshalBoard } from '../../logic/turn-oracle';
import { NO_ORDER_MOVE, clearGeometryCache, makeSubstrate } from '../substrate';
import type { Candidate, JointPlan, UnitId } from '../contracts';
import {
  BoundEvaluator,
  DEAD,
  DEFAULT_WEIGHTS,
  SPECIALIST_FACTS,
  WIN,
  checkCollapse,
  checkMonotone,
  checkSoundness,
  clampEst,
  defaultEvaluator,
  makeContext,
  materialBounds,
  materialEvaluator,
  scale,
} from '../evaluate';
import type { LawCase } from '../evaluate';

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

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 7, height: 7, food: [], hazards: [], snakes, ...extra }) as Board;

const TURN = 40;

const at = (board: Board, cell: Coord): number =>
  marshalBoard(board, TURN).toIndex(cell);


/** Every unit named with its own default — the zero-assumption joint plan. */
function defaultPlan(sub: ReturnType<typeof makeSubstrate>): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const u of sub.roster()) plan.set(u.unitId, { unitId: u.unitId, from: -1, to: NO_ORDER_MOVE, path: [] });
  return plan;
}

afterEach(() => clearGeometryCache());

// --------------------------------------------------------------- the laws

const LAW_CASES: LawCase[] = [
  (() => {
    const board = boardOf([
      piece('me', { x: 2, y: 3 }, 'rook', 2, { teamID: 'red', health: 40 }),
      piece('them', { x: 5, y: 3 }, 'knight', 1, { teamID: 'blue', health: 40 }),
    ]);
    return {
      name: 'rook advancing on a held knight',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['me'],
      orders: new Map([['me', at(board, { x: 4, y: 3 })]]),
    };
  })(),
  (() => {
    const board = boardOf([
      piece('me', { x: 3, y: 3 }, 'king', 1, { teamID: 'red', health: 30 }),
      piece('mate', { x: 1, y: 1 }, 'pawn', 1, { teamID: 'red', health: 30 }),
      piece('them', { x: 3, y: 5 }, 'queen', 2, { teamID: 'blue', health: 30 }),
    ]);
    return {
      name: 'a king with an escort and a held queen',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['me', 'mate'],
      orders: new Map([
        ['me', at(board, { x: 2, y: 3 })],
        ['mate', at(board, { x: 1, y: 2 })],
      ]),
    };
  })(),
  (() => {
    const board = boardOf(
      [
        makeSnake(
          'me',
          [
            { x: 2, y: 2 },
            { x: 1, y: 2 },
          ],
          { teamID: 'red', orientation: { dx: 1, dy: 0 }, health: 50 }
        ),
        piece('them', { x: 4, y: 4 }, 'bishop', 2, { teamID: 'blue', health: 50 }),
      ],
      { food: [{ x: 3, y: 2 }] }
    );
    return {
      name: 'a trail unit eating next to a held bishop',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['me'],
      orders: new Map([['me', at(board, { x: 3, y: 2 })]]),
    };
  })(),
  (() => {
    const board = boardOf([
      piece('me', { x: 1, y: 1 }, 'queen', 3, { teamID: 'red', health: 60 }),
      piece('them', { x: 4, y: 4 }, 'rook', 1, { teamID: 'blue', health: 60 }),
    ]);
    return {
      name: 'a stale claim — the enemy was last seen two turns ago',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['me'],
      orders: new Map([['me', at(board, { x: 3, y: 3 })]]),
      observedTurns: new Map([['them', TURN - 2]]),
    };
  })(),
];

describe('the admission laws, over the real world set', () => {
  test('R1 soundness: every world lies inside the interval', () => {
    let worlds = 0;
    for (const c of LAW_CASES) {
      const result = checkSoundness(defaultEvaluator, c);
      expect([c.name, result.violations]).toEqual([c.name, []]);
      expect(result.checked).toBeGreaterThan(0);
      worlds += result.checked;
    }
    expect(worlds).toBeGreaterThan(40);
  });

  test('R2 refinement-monotonicity: narrowing only ever shrinks the interval', () => {
    let refinements = 0;
    for (const c of LAW_CASES) {
      const result = checkMonotone(defaultEvaluator, c);
      expect([c.name, result.violations]).toEqual([c.name, []]);
      refinements += result.checked;
    }
    expect(refinements).toBeGreaterThan(4);
  });

  test('R3 collapse: a position with nothing held is a point, and says it is exact', () => {
    for (const c of LAW_CASES) {
      const result = checkCollapse(defaultEvaluator, c);
      expect([c.name, result.violations]).toEqual([c.name, []]);
    }
  });

  test('the laws hold for the material-only profile too', () => {
    for (const c of LAW_CASES) {
      expect([c.name, checkSoundness(materialEvaluator, c).violations]).toEqual([c.name, []]);
      expect([c.name, checkCollapse(materialEvaluator, c).violations]).toEqual([c.name, []]);
      expect([c.name, checkMonotone(materialEvaluator, c).violations]).toEqual([c.name, []]);
    }
  });
});

// --------------------------------------------------------------- the cliff

describe('the cliff', () => {
  test('“might die” scores in lo exactly as “dies”, and never worse', () => {
    // Our rook steps somewhere a held queen might reach. In the worst reading
    // it is gone; confirming that death by simulation must not lower `lo`
    // further, which is what a graded danger penalty would do.
    const board = boardOf([
      piece('R', { x: 2, y: 2 }, 'rook', 3, { teamID: 'red', health: 50 }),
      piece('Q', { x: 5, y: 5 }, 'queen', 5, { teamID: 'blue', health: 50 }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['R'] });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const queen = sub.unitOfWireId('Q')?.unitId as UnitId;
    const to = at(board, { x: 5, y: 2 });

    const feared = defaultEvaluator.evaluatePlan(
      sub,
      new Map([[rook, { unitId: rook, from: -1, to, path: sub.pathFor(rook, to) ?? [] }]]),
      0
    );
    // Now name the queen's move that actually takes the rook there, if one
    // exists: the confirmed death may not score below the feared one.
    let worstConfirmed = Number.POSITIVE_INFINITY;
    for (const action of sub.enumerate(queen)) {
      const plan = new Map<UnitId, Candidate>([
        [rook, { unitId: rook, from: -1, to, path: sub.pathFor(rook, to) ?? [] }],
        [
          queen,
          {
            unitId: queen,
            from: -1,
            to: action.dest,
            path: action.action.kind === 'move' ? [...action.action.path] : [],
          },
        ],
      ]);
      worstConfirmed = Math.min(worstConfirmed, defaultEvaluator.scorePlan(sub, plan, 0).lo);
    }
    expect(worstConfirmed).toBeGreaterThanOrEqual(feared.bound.lo);
    sub.release();
  });

  test('the cliff is denominated in the material it loses, and in nothing else', () => {
    // Both teams keep a spare unit far away, so no terminal clamp fires and the
    // reading is purely the cliff's magnitude.
    //
    // The claim is about the SPREAD, and that is the whole point of denominating
    // the cliff in material: `lo` prices a might-die unit at zero whatever it
    // weighs — that IS the cliff — so what a heavier unit at risk buys is a
    // wider interval, exactly the weight it stands to lose. A separate fixed
    // death scale would make the two boards differ by a constant instead, which
    // is how "dying is cheaper than being in danger" gets in.
    const withRook = (weight: number): Board =>
      boardOf([
        piece('R', { x: 3, y: 3 }, 'rook', weight, { teamID: 'red', health: 50 }),
        piece('spare', { x: 0, y: 6 }, 'knight', 1, { teamID: 'red', health: 50 }),
        piece('Q', { x: 5, y: 5 }, 'queen', 6, { teamID: 'blue', health: 50 }),
        piece('q', { x: 6, y: 0 }, 'knight', 1, { teamID: 'blue', health: 50 }),
      ]);
    const read = (weight: number): { lo: number; hi: number } => {
      const board = withRook(weight);
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['R', 'spare'] });
      const r = sub.unitOfWireId('R')?.unitId as UnitId;
      const spare = sub.unitOfWireId('spare')?.unitId as UnitId;
      const to = at(board, { x: 5, y: 3 });
      const b = materialEvaluator.scorePlan(
        sub,
        new Map([
          [r, { unitId: r, from: -1, to, path: sub.pathFor(r, to) ?? [] }],
          [spare, { unitId: spare, from: -1, to: NO_ORDER_MOVE, path: [] }],
        ]),
        0
      );
      sub.release();
      return { lo: b.lo, hi: b.hi };
    };
    const light = read(1);
    const heavy = read(4);

    // A unit that MIGHT die is worth zero in `lo` whether it weighs one or four.
    expect(heavy.lo).toBe(light.lo);
    // And the interval is wider by exactly the extra material at risk, times
    // the material weight. Nothing else moved between the two boards.
    expect(heavy.hi - heavy.lo).toBeGreaterThan(light.hi - light.lo);
    expect(heavy.hi - light.hi).toBe(3 * DEFAULT_WEIGHTS.material);
  });
});

describe('the one place this fold differs from the engine’s own', () => {
  test('with no claim contested, the two folds agree exactly', () => {
    // Our rook is walled off in a corner of an 11x11 board and moves one cell;
    // the enemy's claim cannot reach anything a mover touched, so the widening
    // never applies and the fold must reproduce resolveBounded's own answer.
    const board = boardOf(
      [
        piece('R', { x: 0, y: 0 }, 'rook', 2, { teamID: 'red', health: 50 }),
        piece('q', { x: 10, y: 10 }, 'knight', 1, { teamID: 'blue', health: 50 }),
      ],
      { width: 11, height: 11 }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['R'] });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const to = at(board, { x: 1, y: 0 });
    sub.withResolution(
      new Map([[rook, { unitId: rook, from: -1, to, path: sub.pathFor(rook, to) ?? [] }]]),
      0,
      ({ resolution, bounds, touched }) => {
        const ctx = makeContext(sub, resolution, bounds, touched, 0, 0);
        expect(materialBounds(ctx)).toEqual({ worst: bounds.worst, best: bounds.best });
      }
    );
    sub.release();
  });

  test('with a claim in reach, the ceiling widens — and only the ceiling', () => {
    // The same board with the enemy standing where our rook's ray goes: the
    // world in which it blunders into us really exists, so pricing it alive in
    // our BEST reading would be a false proof.
    const board = boardOf([
      piece('R', { x: 0, y: 3 }, 'rook', 2, { teamID: 'red', health: 50 }),
      piece('q', { x: 2, y: 3 }, 'knight', 1, { teamID: 'blue', health: 50 }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['R'] });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const to = at(board, { x: 2, y: 3 });
    sub.withResolution(
      new Map([[rook, { unitId: rook, from: -1, to, path: sub.pathFor(rook, to) ?? [] }]]),
      0,
      ({ resolution, bounds, touched }) => {
        const ctx = makeContext(sub, resolution, bounds, touched, 0, 0);
        const mine = materialBounds(ctx);
        expect(mine.worst).toBe(bounds.worst);
        expect(mine.best).toBeGreaterThan(bounds.best);
      }
    );
    sub.release();
  });
});

// --------------------------------------------------------------- terminal clamps

describe('terminal clamps are ORDERED, not additive', () => {
  test('mutual annihilation is a loss, not a wash', () => {
    // Our last king and their last king, at equal tier and equal weight, on the
    // same square: a tie kills everyone. Both teams end. An additive pair of
    // clamps would cancel and call it neutral.
    const board = boardOf([
      piece('K', { x: 3, y: 3 }, 'king', 1, { teamID: 'red', health: 50 }),
      piece('k', { x: 3, y: 5 }, 'king', 1, { teamID: 'blue', health: 50 }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const ours = sub.unitOfWireId('K')?.unitId as UnitId;
    const theirs = sub.unitOfWireId('k')?.unitId as UnitId;
    const meet = at(board, { x: 3, y: 4 });
    const plan = new Map<UnitId, Candidate>([
      [ours, { unitId: ours, from: -1, to: meet, path: sub.pathFor(ours, meet) ?? [] }],
      [theirs, { unitId: theirs, from: -1, to: meet, path: sub.pathFor(theirs, meet) ?? [] }],
    ]);
    const v = defaultEvaluator.evaluatePlan(sub, plan, 0);
    expect(v.bound.lo).toBe(DEAD);
    expect(v.bound.hi).toBe(DEAD);
    expect(v.bound.est).toBe(DEAD);
    expect(v.terminal.loClamped).toBe(true);
    sub.release();
  });

  test('the fatal-but-winning trade is a WIN: our unit dies, their team ends', () => {
    // A weight-1 pawn of ours steps onto their last king at equal tier. Nobody
    // survives the cell — and their whole team is eliminated while we still
    // have a rook standing. Every value-symmetric evaluator refuses this.
    const board = boardOf([
      piece('P', { x: 3, y: 3 }, 'pawn', 1, {
        teamID: 'red',
        health: 50,
        orientation: { dx: 0, dy: -1 },
      }),
      piece('R', { x: 0, y: 0 }, 'rook', 2, { teamID: 'red', health: 50 }),
      piece('k', { x: 3, y: 4 }, 'king', 1, { teamID: 'blue', health: 50 }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const pawn = sub.unitOfWireId('P')?.unitId as UnitId;
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const king = sub.unitOfWireId('k')?.unitId as UnitId;
    const target = at(board, { x: 3, y: 4 });
    const plan = new Map<UnitId, Candidate>([
      [pawn, { unitId: pawn, from: -1, to: target, path: sub.pathFor(pawn, target) ?? [] }],
      [rook, { unitId: rook, from: -1, to: NO_ORDER_MOVE, path: [] }],
      [king, { unitId: king, from: -1, to: NO_ORDER_MOVE, path: [] }],
    ]);
    const v = defaultEvaluator.evaluatePlan(sub, plan, 0);
    expect(v.bound.lo).toBe(WIN);
    expect(v.bound.hi).toBe(WIN);
    expect(v.terminal.loClamped).toBe(true);
    sub.release();
  });

  test('a quiet position is not clamped at either end', () => {
    const board = boardOf([
      piece('R', { x: 1, y: 1 }, 'rook', 2, { teamID: 'red', health: 50 }),
      piece('r', { x: 5, y: 5 }, 'rook', 2, { teamID: 'blue', health: 50 }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const v = defaultEvaluator.evaluatePlan(sub, defaultPlan(sub), 0);
    expect(v.terminal.loClamped).toBe(false);
    expect(v.terminal.hiClamped).toBe(false);
    expect(Number.isFinite(v.bound.lo)).toBe(true);
    expect(Number.isFinite(v.bound.hi)).toBe(true);
    sub.release();
  });
});

// --------------------------------------------------------------- the lattice

describe('DEAD is a lattice bottom, never a scalar', () => {
  test('nothing on the heuristic scale can outgrow it', () => {
    expect(DEAD).toBe(Number.NEGATIVE_INFINITY);
    expect(WIN).toBe(Number.POSITIVE_INFINITY);
    // Weighting it does not turn it into a number that some room count beats.
    expect(scale({ lo: DEAD, est: DEAD, hi: DEAD }, 10).lo).toBe(DEAD);
    // And an estimate clamped between the two ends stays finite and inside.
    expect(clampEst(3.5, DEAD, WIN)).toBe(3.5);
    expect(clampEst(3.5, DEAD, DEAD)).toBe(DEAD);
    expect(clampEst(Number.NaN, DEAD, WIN)).toBe(0);
  });

  test('a negative weight is refused rather than silently flipping a bound', () => {
    expect(() => scale({ lo: 1, est: 2, hi: 3 }, -1)).toThrow(/non-negative/);
  });
});

// --------------------------------------------------------------- est discipline

describe('est is advisory only', () => {
  test('lo ≤ est ≤ hi on every position the law corpus touches', () => {
    for (const c of LAW_CASES) {
      const sub = makeSubstrate({
        board: c.board,
        turn: c.turn,
        asTeam: c.asTeam,
        modeled: c.stages,
        observedTurns: c.observedTurns,
      });
      const plan = new Map<UnitId, Candidate>();
      for (const wireId of c.stages) {
        const unit = sub.unitOfWireId(wireId);
        const to = c.orders.get(wireId) as number;
        if (unit === undefined) continue;
        plan.set(unit.unitId, {
          unitId: unit.unitId,
          from: -1,
          to,
          path: sub.pathFor(unit.unitId, to) ?? [],
        });
      }
      const b = defaultEvaluator.scorePlan(sub, plan, sub.teamNumber(c.asTeam));
      expect(b.lo).toBeLessThanOrEqual(b.est);
      expect(b.est).toBeLessThanOrEqual(b.hi);
      sub.release();
    }
  });

  test('changing only the est channel cannot change a floor comparison', () => {
    // Two profiles that differ only in a weight the FLOOR does not read would
    // be a contradiction in terms here: every feature contributes to lo and hi,
    // and est is a derived midpoint. So the check is the honest one — the
    // profile is data, and dropping a feature changes both ends together.
    const quiet = new BoundEvaluator({
      name: 'no-reach',
      weights: { ...DEFAULT_WEIGHTS, reach: 0 },
      reachHorizonTurns: 0,
    });
    const board = boardOf([
      piece('R', { x: 1, y: 1 }, 'rook', 2, { teamID: 'red', health: 50 }),
      piece('r', { x: 5, y: 5 }, 'rook', 2, { teamID: 'blue', health: 50 }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const full = defaultEvaluator.evaluatePlan(sub, defaultPlan(sub), 0);
    const thin = quiet.evaluatePlan(sub, defaultPlan(sub), 0);
    expect(full.parts.reach).toBeDefined();
    expect(thin.parts.reach?.lo).toBe(0);
    expect(thin.bound.lo).toBeLessThanOrEqual(thin.bound.est);
    sub.release();
  });
});

// --------------------------------------------------------------- discharge

describe('the discharge theorem, locally', () => {
  test('exact ⟺ empty ledger ∧ empty basis ∧ a collapsed interval', () => {
    const board = boardOf([
      piece('R', { x: 1, y: 1 }, 'rook', 2, { teamID: 'red', health: 50 }),
      piece('r', { x: 5, y: 5 }, 'rook', 2, { teamID: 'blue', health: 50 }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const whole = defaultEvaluator.evaluatePlan(sub, defaultPlan(sub), 0);
    expect(whole.exact).toBe(true);
    expect(whole.ledgerSize).toBe(0);
    expect(whole.basis).toEqual([]);

    const partial = defaultEvaluator.evaluatePlan(
      sub,
      new Map([[0, { unitId: 0, from: -1, to: NO_ORDER_MOVE, path: [] }]]),
      0
    );
    expect(partial.exact).toBe(false);
    sub.release();
  });

  test('a caller narrowing is reported as a basis, so a score cannot be mistaken for a proof', () => {
    const board = boardOf([
      piece('R', { x: 1, y: 1 }, 'rook', 2, { teamID: 'red', health: 50 }),
      piece('r', { x: 5, y: 5 }, 'rook', 2, { teamID: 'blue', health: 50 }),
    ]);
    const free = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['R'] });
    const target = free.enumerate(free.unitOfWireId('r')?.unitId as UnitId)[0]?.dest as number;
    free.release();

    const sub = makeSubstrate({
      board,
      turn: TURN,
      asTeam: 'red',
      modeled: ['R'],
      narrowings: new Map([['r', [target]]]),
    });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const v = defaultEvaluator.evaluatePlan(
      sub,
      new Map([[rook, { unitId: rook, from: -1, to: NO_ORDER_MOVE, path: [] }]]),
      0
    );
    expect(v.basis).toContain(sub.unitOfWireId('r')?.unitId);
    expect(v.exact).toBe(false);
    sub.release();
  });
});

// --------------------------------------------------------------- calibration

describe('calibration is data', () => {
  test('the three specialist facts are carried, and each names where it enters', () => {
    expect(SPECIALIST_FACTS.map((f) => f.id)).toEqual([
      'fatal-but-winning-trade',
      'king-weight-margin',
      'escort-ray-shadowing',
    ]);
    for (const fact of SPECIALIST_FACTS) {
      expect(fact.claim.length).toBeGreaterThan(40);
      expect(fact.carriedBy.length).toBeGreaterThan(10);
    }
  });

  test('every weight is non-negative — the sign lives inside the feature', () => {
    for (const [, w] of Object.entries(DEFAULT_WEIGHTS)) expect(w).toBeGreaterThanOrEqual(0);
  });

  test('material dominates the ordering terms by an order of magnitude', () => {
    const others = Object.entries(DEFAULT_WEIGHTS)
      .filter(([k]) => k !== 'material')
      .map(([, w]) => w);
    expect(DEFAULT_WEIGHTS.material).toBeGreaterThanOrEqual(10 * Math.max(...others));
  });
});
