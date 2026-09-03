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
  CLIFF_MATERIAL_WEIGHT,
  CONTEST_LOSS,
  DEAD,
  DEFAULT_PROFILE,
  DEFAULT_WEIGHTS,
  FEATURES,
  REACH_HORIZON_TURNS,
  SPECIALIST_FACTS,
  TERRITORY_PROFILE,
  WIN,
  checkCollapse,
  checkMonotone,
  checkSoundness,
  clampEst,
  contestFeature,
  contestField,
  defaultEvaluator,
  makeContext,
  commandFeature,
  worldsOf,
  tierFeature,
  materialBounds,
  materialEvaluator,
  scale,
  royalCommandEvaluator,
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
  (() => {
    // BOTH PLANES LIVE. Trail units partition, and a held enemy queen is heavy
    // enough to displace what our snake claims — so R1 here is checking the
    // displacement gate against real worlds, not just the argmin.
    const board = boardOf(
      [
        makeSnake(
          'me',
          [
            { x: 2, y: 3 },
            { x: 1, y: 3 },
          ],
          { teamID: 'red', orientation: { dx: 1, dy: 0 }, health: 60 }
        ),
        piece('guard', { x: 1, y: 0 }, 'rook', 3, { teamID: 'red', health: 60 }),
        piece('Q', { x: 5, y: 5 }, 'queen', 4, { teamID: 'blue', health: 60 }),
        makeSnake(
          'theirs',
          [
            { x: 5, y: 1 },
            { x: 6, y: 1 },
          ],
          { teamID: 'blue', orientation: { dx: -1, dy: 0 }, health: 60 }
        ),
      ],
      { food: [{ x: 3, y: 3 }] }
    );
    return {
      name: 'a trail partition with a held queen heavy enough to displace it',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['me', 'guard'],
      orders: new Map([
        ['me', at(board, { x: 3, y: 3 })],
        ['guard', at(board, { x: 1, y: 2 })],
      ]),
    };
  })(),
  (() => {
    // Two held enemies on the SAME team, so a narrowing of one can free a cell
    // the two of them were tying at. That is the case the per-unit tie rule's
    // held-teammate exemption exists for: without it, R2 fails here because the
    // enemy's ROOM rises on a refinement.
    // Each side keeps a spare in a far corner, so no world here eliminates a
    // team and the reading is the FEATURE rather than a terminal clamp. Ours is
    // held too, which puts the same exemption on the ceiling's side of the
    // asymmetry.
    const board = boardOf([
      makeSnake(
        'me',
        [
          { x: 1, y: 3 },
          { x: 0, y: 3 },
        ],
        { teamID: 'red', orientation: { dx: 1, dy: 0 }, health: 60 }
      ),
      piece('mySpare', { x: 0, y: 6 }, 'knight', 1, { teamID: 'red', health: 60 }),
      makeSnake(
        'e1',
        [
          { x: 5, y: 2 },
          { x: 6, y: 2 },
        ],
        { teamID: 'blue', orientation: { dx: -1, dy: 0 }, health: 60 }
      ),
      makeSnake(
        'e2',
        [
          { x: 5, y: 4 },
          { x: 6, y: 4 },
        ],
        { teamID: 'blue', orientation: { dx: -1, dy: 0 }, health: 60 }
      ),
      piece('theirSpare', { x: 6, y: 6 }, 'knight', 1, { teamID: 'blue', health: 60 }),
    ]);
    return {
      name: 'two held enemies of one team, tying over the same ground',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['me'],
      orders: new Map([['me', at(board, { x: 2, y: 3 })]]),
    };
  })(),
  (() => {
    // A HELD ENEMY TRAIL AND OUR OWN PIECE — the board the two-domain rule is
    // for. Everything of ours but the queen is held, so `lo` reads our piece
    // against a blue snake carried as a CLAIM, and a claim's cloud is a
    // superset of where the snake really is. See the block at the bottom of
    // this file for what the cloud used to buy us.
    const board = boardOf(
      [
        piece('q', { x: 2, y: 5 }, 'queen', 3, { teamID: 'red', health: 60 }),
        makeSnake('rs', [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 3, y: 1 },
        ], { teamID: 'red', health: 80 }),
        makeSnake('bs', [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
          { x: 4, y: 2 },
        ], { teamID: 'blue', health: 80 }),
        piece('bk', { x: 4, y: 4 }, 'king', 1, { teamID: 'blue', health: 60 }),
      ],
      { food: [{ x: 4, y: 3 }, { x: 5, y: 2 }] }
    );
    return {
      name: 'our queen holding, against a held enemy snake and food',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['q'],
      orders: new Map([['q', NO_ORDER_MOVE]]),
    };
  })(),
  (() => {
    // A MOVER WALKING OFF ITS OWN BODY, with two held units that can both
    // reach the segment it leaves behind. The engine ledgers every contact
    // naming our snake as a `sever` with `couldBeat: false` — the body rule's
    // other half, "a cut is a weight loss rather than a death" — which is a
    // proof of survival for ONE arrival and not for two: the first dies on the
    // segment and registers the segment's OWNER into that cell's durable pile
    // (`turnEngine.ts` c5), and the second arrival then contests the whole
    // pile and takes everyone that is not its unique strict maximum (c4).
    //
    // Sixteen of the four hundred worlds enumerated here end
    // `contest ... victimIDs ["br","rs"] Deadlock: no unique survivor`, and
    // before `bounds/material.ts` refused the proof they were sixteen R1 floor
    // violations against a finite floor — in the material profile too, where
    // the floor read -50 for a world that is a wipe. The engine side of it is
    // pinned as an executable defect report in
    // `src/tests/settle-partial-sever-pile.test.ts`.
    const board = boardOf([
      makeSnake('rs', [
        { x: 2, y: 5 },
        { x: 3, y: 5 },
        { x: 4, y: 5 },
      ], { teamID: 'red', health: 80 }),
      piece('rq', { x: 3, y: 4 }, 'queen', 3, { teamID: 'red', health: 60 }),
      makeSnake('bs', [
        { x: 3, y: 1 },
        { x: 4, y: 1 },
        { x: 5, y: 1 },
      ], { teamID: 'blue', health: 80 }),
      piece('br', { x: 2, y: 1 }, 'rook', 3, { teamID: 'blue', health: 60 }),
    ]);
    return {
      name: 'a snake stepping off its own body, under two claims that can pile on it',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['rs'],
      orders: new Map([['rs', at(board, { x: 1, y: 5 })]]),
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

  test('and for the slider-repair profile, on this same world set', () => {
    // These cases carry pieces on both sides and a held enemy of each kind, so
    // they exercise the command term's admission asymmetry against the same
    // brute-force enumeration the shipped profile is held to. The repair's own
    // fixtures live in src/tests/territory-slider.test.ts.
    for (const c of LAW_CASES) {
      expect([c.name, checkSoundness(royalCommandEvaluator, c).violations]).toEqual([
        c.name,
        [],
      ]);
      expect([c.name, checkCollapse(royalCommandEvaluator, c).violations]).toEqual([
        c.name,
        [],
      ]);
      expect([c.name, checkMonotone(royalCommandEvaluator, c).violations]).toEqual([
        c.name,
        [],
      ]);
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
    for (const action of sub.actionsOf(queen)) {
      const plan = new Map<UnitId, Candidate>([
        [rook, { unitId: rook, from: -1, to, path: sub.pathFor(rook, to) ?? [] }],
        [
          queen,
          {
            unitId: queen,
            from: action.from,
            to: action.to,
            path: action.path,
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
    // "FAR AWAY" NOW MEANS FAR FROM ITS OWN TEAM-MATE TOO. The blue spare used
    // to sit at (6,0), which its own queen's file reaches in one move — and
    // since the queen outweighs it six to one, that meeting kills the spare.
    // The claim layer could not see that until `CloudField.contestedClaims`
    // (engine backlog 7), so blue read as un-wipeable and the clamp stayed
    // quiet by accident. It is a real world, the ceiling is right to admit it,
    // and this test is not about it: the spare moved to (0,2), which shares
    // neither file nor rank nor diagonal with the queen and none of whose
    // knight-moves land on one.
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
        piece('q', { x: 0, y: 2 }, 'knight', 1, { teamID: 'blue', health: 50 }),
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

describe('this fold and the engine’s own agree, contested or not', () => {
  // These two boards used to pin the ONE place the fold differed: the claim
  // layer could not see this turn's movers, so a held unit that would walk
  // straight into one was reported certainly alive, and this file widened the
  // ceiling itself by intersecting the cloud with a snapshot of every touched
  // cell. THE ENGINE ANSWERS IT NOW (`Resolution.mayHaveDied`), so the fold
  // reads the engine's answer and the two agree on both boards. They are kept
  // because the widening still has to HAPPEN — the second board proves the
  // enemy is priced as possibly-dead in our best reading, which is the whole
  // point; it just is not this file's arithmetic any more.
  test('with no claim contested, the two folds agree exactly', () => {
    // Our rook is walled off in a corner of an 11x11 board and moves one cell;
    // the enemy's claim cannot reach anything a mover touched, so nothing is
    // contested and the fold must reproduce resolveBounded's own answer.
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
      ({ resolution, bounds }) => {
        const ctx = makeContext(sub, resolution, bounds, 0, 0);
        expect(materialBounds(ctx)).toEqual({ worst: bounds.worst, best: bounds.best });
      }
    );
    sub.release();
  });

  test('with a claim in reach, the enemy is possibly-dead in our BEST reading', () => {
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
      ({ resolution, bounds }) => {
        const ctx = makeContext(sub, resolution, bounds, 0, 0);
        // The widening HAPPENS: the held enemy is not counted alive in the
        // reading that hopes for its death.
        const enemy = ctx.standing.find((st) => st.held && st.team !== 0);
        expect(enemy).toBeDefined();
        expect(enemy?.worstAlive).toBe(true); // pessimistic: it survives
        expect(enemy?.bestAlive).toBe(false); // optimistic: it may have died
        // And the engine already accounts for it, so the two folds agree.
        const mine = materialBounds(ctx);
        expect(mine.worst).toBe(bounds.worst);
        expect(mine.best).toBe(bounds.best);
      }
    );
    sub.release();
  });
});

// --------------------------------------------------------- contest avoidance

/**
 * CONTEST AVOIDANCE, against the rule it prices.
 *
 * `turnEngine`'s arrival tier hands the cell to the UNIQUE strict maximum on
 * frozen tier and then frozen weight, so at equal tier a heavier enemy kills
 * us, an equal-weight one kills us both, and a lighter one dies to us. These
 * cases are that sentence, one clause at a time.
 */
describe('contest avoidance prices the rule turnEngine adjudicates', () => {
  /** The contest term alone, for one staged destination. */
  function contestOf(
    board: Board,
    ours: string,
    to: Coord,
    asTeam = 'red'
  ): { lo: number; est: number; hi: number } {
    const sub = makeSubstrate({ board, turn: TURN, asTeam, modeled: [ours] });
    try {
      const unit = sub.unitOfWireId(ours)?.unitId as UnitId;
      const dest = at(board, to);
      const plan: JointPlan = new Map([
        [unit, { unitId: unit, from: -1, to: dest, path: sub.pathFor(unit, dest) ?? [] }],
      ]);
      const team = sub.teamNumber(asTeam);
      const b = sub.withResolution(plan, team, ({ resolution, bounds }) =>
        contestFeature.evaluate(makeContext(sub, resolution, bounds, team, 0, DEFAULT_PROFILE))
      );
      return { lo: b.lo, est: b.est, hi: b.hi };
    } finally {
      sub.release();
    }
  }

  /** Our snake of weight two at (3,3); an enemy head two cells east of it. */
  const facing = (theirWeight: number): Board =>
    boardOf([
      makeSnake(
        'me',
        [
          { x: 3, y: 3 },
          { x: 2, y: 3 },
        ],
        { teamID: 'red', orientation: { dx: 1, dy: 0 } }
      ),
      makeSnake(
        'them',
        Array.from({ length: theirWeight }, (_, i) => ({ x: 5 + i, y: 3 })),
        { teamID: 'blue', orientation: { dx: -1, dy: 0 } }
      ),
    ]);

  test('a square a HEAVIER enemy head can reach is penalised', () => {
    // Their head at (5,3) can step to (4,3), and three beats our two: the cell
    // is theirs and we die on it.
    const contested = contestOf(facing(3), 'me', { x: 4, y: 3 });
    expect(contested.lo).toBeLessThan(0);
    expect(contested.est).toBeLessThan(0);
    // One unit of ours, so the charge is the whole CONTEST_LOSS.
    expect(contested.lo).toBeCloseTo(-CONTEST_LOSS, 9);
  });

  test('an EQUAL-weight enemy is penalised too, because a tie kills everyone', () => {
    expect(contestOf(facing(2), 'me', { x: 4, y: 3 }).lo).toBeCloseTo(-CONTEST_LOSS, 9);
  });

  test('a square only a LIGHTER enemy can reach is not penalised', () => {
    // The same geometry with their weight one against our two: the cell is
    // ours, we survive it, and a trade we win is not a thing to avoid.
    expect(contestOf(facing(1), 'me', { x: 4, y: 3 })).toEqual({ lo: 0, est: 0, hi: 0 });
  });

  test('a square no enemy can reach is untouched', () => {
    const board = facing(3);
    expect(contestOf(board, 'me', { x: 3, y: 4 })).toEqual({ lo: 0, est: 0, hi: 0 });
    // And the field agrees about which cells those are, and how heavy.
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['me'] });
    try {
      const field = contestField(sub, sub.teamNumber('red'));
      expect(field.reached[at(board, { x: 4, y: 3 })]).toBe(1);
      expect(field.weight[at(board, { x: 4, y: 3 })]).toBe(3);
      expect(field.reached[at(board, { x: 3, y: 4 })]).toBe(0);
    } finally {
      sub.release();
    }
  });

  test('the term is zero on a board with no enemies', () => {
    const alone = boardOf([
      makeSnake(
        'me',
        [
          { x: 3, y: 3 },
          { x: 2, y: 3 },
        ],
        { teamID: 'red', orientation: { dx: 1, dy: 0 } }
      ),
      makeSnake(
        'mate',
        [
          { x: 1, y: 1 },
          { x: 1, y: 0 },
        ],
        { teamID: 'red', orientation: { dx: 0, dy: 1 } }
      ),
    ]);
    for (const to of [
      { x: 4, y: 3 },
      { x: 3, y: 4 },
      { x: 3, y: 2 },
    ]) {
      expect([to, contestOf(alone, 'me', to)]).toEqual([to, { lo: 0, est: 0, hi: 0 }]);
    }
  });
});

// --------------------------------------------------------------- tier value

describe('tier value prices the window, and is free without one', () => {
  /**
   * One joint plan, scored two ways: the `tier` part alone, and the whole
   * fold's total. Both are needed — the part says the term saw what it was
   * supposed to see, the total says the fold ACTS on it, which is the whole
   * reason the term exists.
   */
  function scoreOf(
    board: Board,
    orders: ReadonlyArray<[string, Coord]>,
    asTeam = 'red'
  ): { tier: { lo: number; est: number; hi: number }; total: number; lo: number } {
    const sub = makeSubstrate({
      board,
      turn: TURN,
      asTeam,
      modeled: orders.map(([id]) => id),
    });
    try {
      const plan = new Map<UnitId, Candidate>();
      for (const [id, to] of orders) {
        const unit = sub.unitOfWireId(id)?.unitId as UnitId;
        const dest = at(board, to);
        plan.set(unit, { unitId: unit, from: -1, to: dest, path: sub.pathFor(unit, dest) ?? [] });
      }
      const team = sub.teamNumber(asTeam);
      const ev = defaultEvaluator.evaluatePlan(sub, plan, team);
      const part = ev.parts['tier'] as { lo: number; est: number; hi: number };
      return {
        tier: { lo: part.lo, est: part.est, hi: part.hi },
        total: ev.bound.est,
        lo: ev.bound.lo,
      };
    } finally {
      sub.release();
    }
  }

  // -- the zero -------------------------------------------------------------

  test('EXACTLY zero on every board with no live effect and no potion', () => {
    // The claim the whole seating rests on: with no tier anywhere, this term
    // is a point at zero, so every counter measured on a potion-free board is
    // the counter that was measured before it existed. Checked over the law
    // cases — pieces, snakes, kings, held units.
    for (const c of LAW_CASES) {
      const sub = makeSubstrate({
        board: c.board,
        turn: c.turn,
        asTeam: c.asTeam,
        modeled: c.stages,
        observedTurns: c.observedTurns,
      });
      try {
        const plan = new Map<UnitId, Candidate>();
        for (const wireId of c.stages) {
          const unit = sub.unitOfWireId(wireId)?.unitId as UnitId;
          const dest = c.orders.get(wireId) as number;
          plan.set(unit, {
            unitId: unit,
            from: -1,
            to: dest,
            path: sub.pathFor(unit, dest) ?? [],
          });
        }
        const team = sub.teamNumber(c.asTeam);
        const ev = defaultEvaluator.evaluatePlan(sub, plan, team);
        expect([c.name, ev.parts['tier']]).toEqual([c.name, { lo: 0, est: 0, hi: 0 }]);
      } finally {
        sub.release();
      }
    }
  });

  test('a potion the rules do not collect is still no tier', () => {
    // `invulnerabilityPotionsEnabled: false` makes a potion inert scenery, and
    // the term has to read the flag rather than the cells.
    const board = boardOf(
      [
        makeSnake('me', [{ x: 1, y: 3 }, { x: 0, y: 3 }], {
          teamID: 'red',
          orientation: { dx: 1, dy: 0 },
        }),
        makeSnake('them', [{ x: 5, y: 3 }, { x: 6, y: 3 }], {
          teamID: 'blue',
          orientation: { dx: -1, dy: 0 },
        }),
      ],
      { invulnerabilityPotions: [{ x: 2, y: 3 }], invulnerabilityPotionsEnabled: false }
    );
    expect(scoreOf(board, [['me', { x: 2, y: 3 }]]).tier).toEqual({ lo: 0, est: 0, hi: 0 });
  });

  // -- the buff side --------------------------------------------------------

  /**
   * THE ALLY-BUFF BOARD. Two of ours; one enemy that TIES our ally on weight.
   *
   *   ally (3,1) w2 --> (4,1)   <-- foe (5,1) w2
   *   taker (1,3) w2 --> (2,3), where the potion is
   *
   * A tie kills everyone (`strictMaximum` returns a survivor only where the
   * maximum is unique), so at tier 0 the ally's destination is a square it
   * dies on. Settlement pays every LIVING ally of a collector +1 for the
   * window, and at +1 the ally is the unique maximum and lives. Nothing else
   * on the board moves between the two plans below.
   */
  const allyBuffBoard = (): Board =>
    boardOf(
      [
        makeSnake('taker', [{ x: 1, y: 3 }, { x: 0, y: 3 }], {
          teamID: 'red',
          orientation: { dx: 1, dy: 0 },
        }),
        makeSnake('ally', [{ x: 3, y: 1 }, { x: 2, y: 1 }], {
          teamID: 'red',
          orientation: { dx: 1, dy: 0 },
        }),
        makeSnake('foe', [{ x: 5, y: 1 }, { x: 6, y: 1 }], {
          teamID: 'blue',
          orientation: { dx: -1, dy: 0 },
        }),
      ],
      { invulnerabilityPotions: [{ x: 2, y: 3 }] }
    );

  test('the fold prefers the line that collects the potion', () => {
    const board = allyBuffBoard();
    const ally: Coord = { x: 4, y: 1 };
    const takes = scoreOf(board, [
      ['taker', { x: 2, y: 3 }],
      ['ally', ally],
    ]);

    // The term sees the ally's window and nothing else: one of two units, an
    // edge of +1, over the two remaining turns of a three-turn window.
    expect(takes.tier.hi).toBeCloseTo((1 * (3 - 1)) / 3 / 2, 9);
    expect(takes.tier.est).toBeGreaterThan(0);
    // The CREDIT is a ceiling fact and the floor is right to refuse it: the
    // resolution adjudicates this turn's contest at the PRE-pickup tier, so
    // the ally is contingent in it, and a credit for a unit that might not be
    // there is exactly what a floor may not bank. `lo` therefore stays at
    // zero — the term can order a move and can never buy a unit's life.
    expect(takes.tier.lo).toBe(0);

    // And the FOLD acts on it: the same ally move, priced higher because the
    // teammate armed it, against every other move the taker has.
    for (const elsewhere of [{ x: 1, y: 2 }, { x: 1, y: 4 }] as Coord[]) {
      const declines = scoreOf(board, [
        ['taker', elsewhere],
        ['ally', ally],
      ]);
      expect([elsewhere, declines.tier]).toEqual([elsewhere, { lo: 0, est: 0, hi: 0 }]);
      expect([elsewhere, takes.total > declines.total]).toEqual([elsewhere, true]);
    }
  });

  test('the buff is worth nothing where no enemy contests the square', () => {
    // The same pickup, with the ally walking away from the contest instead.
    // A +1 over ground nobody wants buys exactly nothing, which is the half of
    // the contest rule this term is built on.
    const board = allyBuffBoard();
    expect(
      scoreOf(board, [
        ['taker', { x: 2, y: 3 }],
        ['ally', { x: 3, y: 2 }],
      ]).tier
    ).toEqual({ lo: 0, est: 0, hi: 0 });
  });

  // -- the debuff side ------------------------------------------------------

  /**
   * THE SELF-DEBUFF BOARD. One unit of ours, weight three, against a weight-two
   * enemy that reaches the potion cell. At tier 0 we are the unique maximum
   * there and live; settlement charges a collector −1, and at −1 the enemy
   * outranks us on TIER before weight is even read. So the pickup turns a
   * square we win into a square we lose, for the whole window it opens — the
   * exact case "an enemy who could not win now can".
   */
  const selfDebuffBoard = (): Board =>
    boardOf(
      [
        makeSnake('me', [{ x: 1, y: 3 }, { x: 0, y: 3 }, { x: 0, y: 2 }], {
          teamID: 'red',
          orientation: { dx: 1, dy: 0 },
        }),
        makeSnake('foe', [{ x: 3, y: 3 }, { x: 4, y: 3 }], {
          teamID: 'blue',
          orientation: { dx: -1, dy: 0 },
        }),
      ],
      { invulnerabilityPotions: [{ x: 2, y: 3 }] }
    );

  test('collecting a potion that costs us a square we were winning is a debit', () => {
    const board = selfDebuffBoard();
    const takes = scoreOf(board, [['me', { x: 2, y: 3 }]]);

    // One unit, an edge of −1, over the two remaining turns of the window —
    // and DETERMINATE in both readings, because at tier 0 this unit is the
    // unique maximum at that square and nothing about it is contingent. The
    // debit is therefore one the FLOOR carries, not merely the ceiling.
    expect(takes.tier).toEqual({
      lo: -((1 * (3 - 1)) / 3),
      est: -((1 * (3 - 1)) / 3),
      hi: -((1 * (3 - 1)) / 3),
    });

    // A line that does not collect is untouched by the term.
    expect(scoreOf(board, [['me', { x: 1, y: 2 }]]).tier).toEqual({ lo: 0, est: 0, hi: 0 });
  });

  test('the debuff costs nothing where the square was already lost', () => {
    // The same pickup against an enemy that OUT-weighs us: we lose the square
    // at tier 0 and we lose it at −1, so the debuff changed nothing and is not
    // charged for it. `contest` prices the loss; this term prices only the
    // part tier is responsible for.
    const board = boardOf(
      [
        makeSnake('me', [{ x: 1, y: 3 }, { x: 0, y: 3 }], {
          teamID: 'red',
          orientation: { dx: 1, dy: 0 },
        }),
        makeSnake('foe', [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }], {
          teamID: 'blue',
          orientation: { dx: -1, dy: 0 },
        }),
      ],
      { invulnerabilityPotions: [{ x: 2, y: 3 }] }
    );
    expect(scoreOf(board, [['me', { x: 2, y: 3 }]]).tier).toEqual({ lo: 0, est: 0, hi: 0 });
  });

  // -- a pre-existing window ------------------------------------------------

  test('a buff already held is worth its REMAINING turns, and nothing after them', () => {
    // Our snake ties the enemy on weight at (4,3) and carries a +1. The term
    // is positive while the window has turns left in it and zero once the
    // window has run out — the "over the remaining window" clause, with no
    // potion anywhere on the board.
    const held = (expiry: number): Board =>
      boardOf([
        makeSnake('me', [{ x: 3, y: 3 }, { x: 2, y: 3 }], {
          teamID: 'red',
          orientation: { dx: 1, dy: 0 },
          invulnerabilityLevel: 1,
          invulnerabilityExpiryTurn: expiry,
        }),
        makeSnake('foe', [{ x: 5, y: 3 }, { x: 6, y: 3 }], {
          teamID: 'blue',
          orientation: { dx: -1, dy: 0 },
        }),
      ]);
    const dest: Coord = { x: 4, y: 3 };
    const long = scoreOf(held(TURN + 9), [['me', dest]]).tier;
    const short = scoreOf(held(TURN + 1), [['me', dest]]).tier;
    const lapsed = scoreOf(held(TURN), [['me', dest]]).tier;

    expect(long.lo).toBeGreaterThan(0);
    expect(short.lo).toBeGreaterThan(0);
    // A window with one turn left is worth a third of one that outlives the
    // horizon; a window already over is worth nothing.
    expect(short.lo).toBeLessThan(long.lo);
    expect(long.lo).toBeCloseTo(1, 9);
    expect(short.lo).toBeCloseTo(1 / 3, 9);
    expect(lapsed).toEqual({ lo: 0, est: 0, hi: 0 });
  });

  test('the feature is seated after contest, and every shipped profile names it', () => {
    // Seated after `contest`, whose reach field it reads; later members
    // (energy) sit behind it.
    expect(FEATURES.indexOf(tierFeature)).toBeGreaterThan(FEATURES.findIndex((f) => f.key === 'contest'));
    expect(tierFeature.key).toBe('tier');
    expect(DEFAULT_WEIGHTS.tier).toBe(2);
    // The ordering the calibration argues for, checked rather than argued.
    expect(DEFAULT_WEIGHTS.tier as number).toBeGreaterThan(DEFAULT_WEIGHTS.momentum as number);
    expect(DEFAULT_WEIGHTS.tier as number).toBeLessThan(DEFAULT_WEIGHTS.contest as number);
    expect(DEFAULT_WEIGHTS.tier as number).toBeLessThan(DEFAULT_WEIGHTS.food as number);
    expect(materialEvaluator.profile.weights.tier).toBe(0);
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
    const target = free.actionsOf(free.unitOfWireId('r')?.unitId as UnitId)[0]?.to as number;
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

  test('material is the scale, and every ordering term is priced under it', () => {
    // The old form of this test asserted `material >= 10 × every other weight`,
    // which is a PROXY for the thing that actually matters and stops being a
    // safe one the moment a feature's range is not ~1. The real invariant is
    // the cliff inequality — `w_feature × observed range < 10 × lightest unit
    // weight` — and it is asserted against MEASURED ranges on the acceptance
    // boards in src/tests/territory-acceptance.test.ts. What belongs here is
    // the structural half: material sets the scale, and nothing else comes
    // close to the cost of one unit.
    for (const [key, w] of Object.entries(DEFAULT_WEIGHTS)) {
      if (key === 'material') continue;
      expect([key, w < DEFAULT_WEIGHTS.material]).toEqual([key, true]);
      // A single unit of material is 10; no ordering term may price a whole
      // unit's worth of anything per unit of its own range.
      expect([key, w * 1 < CLIFF_MATERIAL_WEIGHT]).toEqual([key, true]);
    }
  });

  test('the territory profile is what production runs, and material stays available', () => {
    expect(DEFAULT_PROFILE).toBe(TERRITORY_PROFILE);
    expect(TERRITORY_PROFILE.name).toBe('lobster-territory');
    expect(TERRITORY_PROFILE.weights.reach).toBe(1);
    expect(TERRITORY_PROFILE.weights.room).toBe(3);
    expect(TERRITORY_PROFILE.reachHorizonTurns).toBe(REACH_HORIZON_TURNS);
    expect(REACH_HORIZON_TURNS).toBe(4);
    // Every feature the shipped fold evaluates is named here, and no others: a
    // weight left unnamed silently takes the feature's `defaultWeight`, which
    // is how a profile ends up carrying a term nobody chose for it.
    expect(Object.keys(TERRITORY_PROFILE.weights).sort()).toEqual([
      // The slider repair, seated — see calibration.ts.
      'command',
      // Contest avoidance: the dominant remaining death cause.
      'contest',
      // The price of a move, in the energy the rules charge for it.
      'energy',
      'energyEconomy',
      // The distance gradient to the nearest meal, and the anti-dither term.
      'food',
      'kingMargin',
      'material',
      'momentum',
      'reach',
      'room',
      // Tier value: what a window is worth, over the window.
      'tier',
    ]);
    expect(Object.keys(TERRITORY_PROFILE.weights).sort()).toEqual(
      FEATURES.map((f) => f.key).sort()
    );
    expect(TERRITORY_PROFILE.weights.command).toBeGreaterThan(0);
    // The fallback profile is a real, reachable profile — not a comment.
    expect(materialEvaluator.profile.weights.reach).toBe(0);
    expect(materialEvaluator.profile.weights.room).toBe(0);
    expect(materialEvaluator.profile.reachHorizonTurns).toBe(0);
  });
});

// ------------------------------------------------- command, and the two domains

/**
 * A HELD ENEMY'S CLOUD IS NOT OUR GROUND — the R1 defect a randomised sweep
 * found in `commandFeature`, and the repair, pinned.
 *
 * `command` prices what a piece can act on next turn by intersecting its front
 * with the reading's trail domain and with the food board. Both of those were
 * read from the SAME reading for both sides, and both are supersets of the
 * truth when something is held:
 *
 *   THE DOMAIN. A held enemy trail is dilated from where it was OBSERVED, so
 *   its front is its whole claim cloud rather than where it is. Counted for
 *   THEIR pieces that is conservative — it subtracts. Counted for OURS it hands
 *   our own pieces ground no world guarantees.
 *
 *   THE FOOD. `resolution.food` is the food the settlement CLOSED with, and a
 *   settlement leaves a held unit's meal on the board because it does not know
 *   whether the unit went and took it. At `food: 20` against `ground: 1` one
 *   uncertain meal is most of the term.
 *
 * On the board below — our queen holding, our snake and both blue units held —
 * `command.lo` read 1.000 (saturated) against worlds at 0.776 and 0.694, and
 * the fold's floor sat above the floor of the worlds it claimed to bound. Our
 * own pieces now read `Partition.certainDomain` (a held enemy trail enters only
 * at the cells it cannot have left) and `EvalContext.certainFood` (minus every
 * cell a held cloud could be eating on); theirs still read the wide boards, so
 * the error stays on the conservative side in both directions.
 *
 * The floor this produces is LOWER, and that is the point: it is under the
 * worlds now instead of over them.
 */
describe('command reads two domains, because a claim cloud is not ground we hold', () => {
  const CASE = LAW_CASES.find(
    (c) => c.name === 'our queen holding, against a held enemy snake and food'
  ) as LawCase;

  const commandOf = (sub: ReturnType<typeof makeSubstrate>, plan: JointPlan, asTeam: number) =>
    sub.withResolution(plan, asTeam, ({ resolution, bounds }) =>
      commandFeature.evaluate(
        makeContext(sub, resolution, bounds, asTeam, TERRITORY_PROFILE.reachHorizonTurns, TERRITORY_PROFILE)
      )
    );

  const planOf = (sub: ReturnType<typeof makeSubstrate>, c: LawCase): JointPlan => {
    const plan = new Map<UnitId, Candidate>();
    for (const wireId of c.stages) {
      const u = sub.unitOfWireId(wireId);
      const to = c.orders.get(wireId) as number;
      plan.set((u as { unitId: UnitId }).unitId, {
        unitId: (u as { unitId: UnitId }).unitId,
        from: -1,
        to,
        path: sub.pathFor((u as { unitId: UnitId }).unitId, to) ?? [],
      });
    }
    return plan;
  };

  test('the whole fold is sound here, world by world', () => {
    const result = checkSoundness(defaultEvaluator, CASE);
    expect([CASE.name, result.violations]).toEqual([CASE.name, []]);
    // The board is worth measuring only because the world set is big.
    expect(result.checked).toBeGreaterThan(100);
  });

  test('and so is the command term on its own, which is where the defect was', () => {
    const sub = makeSubstrate({
      board: CASE.board,
      turn: CASE.turn,
      asTeam: CASE.asTeam,
      modeled: [...CASE.stages],
    });
    try {
      const asTeam = sub.teamNumber(CASE.asTeam);
      const partial = commandOf(sub, planOf(sub, CASE), asTeam);
      let worlds = 0;
      let worst = Number.POSITIVE_INFINITY;
      for (const w of worldsOf(sub, CASE, 400)) {
        const v = commandOf(sub, w.plan, asTeam);
        worlds++;
        // A world names every unit, so the term must be a point there.
        expect([worlds, v.lo]).toEqual([worlds, v.hi]);
        worst = Math.min(worst, v.lo);
      }
      expect(worlds).toBeGreaterThan(100);
      expect(partial.lo).toBeLessThanOrEqual(worst + 1e-9);
      // NOT the saturated reading the wide boards produced: 1.000 was the
      // measured value before the repair, and every world was under it.
      expect(partial.lo).toBeLessThan(1);
      expect(worst).toBeLessThan(1);
    } finally {
      sub.release();
    }
  });

  test('the certain domain is a subset of the wide one, and strictly smaller here', () => {
    const sub = makeSubstrate({
      board: CASE.board,
      turn: CASE.turn,
      asTeam: CASE.asTeam,
      modeled: [...CASE.stages],
    });
    try {
      const asTeam = sub.teamNumber(CASE.asTeam);
      sub.withResolution(planOf(sub, CASE), asTeam, ({ resolution, bounds }) => {
        const ctx = makeContext(
          sub,
          resolution,
          bounds,
          asTeam,
          TERRITORY_PROFILE.reachHorizonTurns,
          TERRITORY_PROFILE
        );
        const p = ctx.partition('lo');
        let wide = 0;
        let certain = 0;
        let outside = 0;
        for (let i = 0; i < sub.grid.words; i++) {
          const d = p.domain[i] as number;
          const c = p.certainDomain[i] as number;
          wide += popcount(d);
          certain += popcount(c);
          outside += popcount((c & ~d) >>> 0);
        }
        // A subset, by construction — never a different set.
        expect(outside).toBe(0);
        expect(certain).toBeLessThan(wide);
        // And the food board narrows for the same reason: two meals sit inside
        // the held snake's cloud.
        let food = 0;
        let certainFood = 0;
        for (let i = 0; i < sub.grid.words; i++) {
          food += popcount(ctx.food()[i] as number);
          certainFood += popcount(ctx.certainFood()[i] as number);
        }
        expect(certainFood).toBeLessThan(food);
        return null;
      });
    } finally {
      sub.release();
    }
  });
});

/** Bits set in a 32-bit word. Local: the production one is not exported. */
function popcount(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(v, 0x01010101) >>> 24) & 0x3f;
}
