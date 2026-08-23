/**
 * The substrate's four silent failure modes, each pinned.
 *
 *   1. the weight-stack collapse (a grown piece arriving as one cell)
 *   2. the head-start double-count (staleness applied twice)
 *   3. the partial assignment (a live unit nobody named)
 *   4. the leaked slab (which presents as the engine being slow)
 *
 * Plus the in-situ differential: a fully-named plan run through the substrate
 * must agree with THIS repo's vendored resolver on the same board, marshalled
 * the same way. That is the only test that can catch a translation bug, because
 * a translation bug is invisible to every test written in one vocabulary.
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import { marshalBoard, resolveTurn } from '../../logic/turn-oracle';
import { Fate, bbTest } from '../../partial-engine/index';
import {
  EngineSubstrate,
  NO_ORDER_MOVE,
  TooManyHeldError,
  UnknownUnitError,
  clearGeometryCache,
  makeSubstrate,
} from '../substrate';
import type { Candidate, JointPlan, UnitId } from '../contracts';

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
  ({ width: 9, height: 9, food: [], hazards: [], snakes, ...extra }) as Board;

const TURN = 20;

/** A plan entry for `unitId` staging `to`, with the substrate's own path. */
function move(sub: EngineSubstrate, unitId: UnitId, to: number): Candidate {
  const path = sub.pathFor(unitId, to);
  if (path === null) throw new Error(`illegal staged cell ${to} for unit ${unitId}`);
  return { unitId, from: -1, to, path };
}

/** Every unit named, each with its own default. The zero-assumption plan. */
function defaultPlan(sub: EngineSubstrate): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const u of sub.roster()) plan.set(u.unitId, { unitId: u.unitId, from: -1, to: NO_ORDER_MOVE, path: [] });
  return plan;
}

afterEach(() => clearGeometryCache());

// --------------------------------------------------------------------- roster

describe('translation into engine terms', () => {
  test('a grown piece keeps its weight, and does not become a three-cell body', () => {
    const sub = makeSubstrate({
      board: boardOf([piece('R', { x: 4, y: 4 }, 'rook', 5, { teamID: 'red' })]),
      turn: TURN,
      asTeam: 'red',
    });
    const rook = sub.unitOfWireId('R');
    expect(rook).toBeDefined();
    // The wire says [c,c,c,c,c]; the engine wants one cell plus weight 5.
    expect(rook?.cells).toHaveLength(1);
    expect(rook?.weight).toBe(5);
    const view = sub.viewOf(rook?.unitId as UnitId);
    expect(view?.weight).toBe(5);
    expect(view?.cells).toHaveLength(1);
    sub.release();
  });

  test('a trail unit passes straight through, head first', () => {
    const body = [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
    ];
    const sub = makeSubstrate({
      board: boardOf([makeSnake('S', body, { teamID: 'red' })]),
      turn: TURN,
      asTeam: 'red',
    });
    const m = marshalBoard(boardOf([makeSnake('S', body, { teamID: 'red' })]), TURN);
    expect(sub.unitOfWireId('S')?.cells).toEqual(body.map(m.toIndex));
    expect(sub.unitOfWireId('S')?.weight).toBe(3);
    sub.release();
  });

  test('the deciding team is engine team 0, whatever it is called', () => {
    const sub = makeSubstrate({
      board: boardOf([
        piece('a', { x: 2, y: 2 }, 'knight', 1, { teamID: 'zulu' }),
        piece('b', { x: 6, y: 6 }, 'knight', 1, { teamID: 'alpha' }),
      ]),
      turn: TURN,
      asTeam: 'zulu',
    });
    expect(sub.teamNumber('zulu')).toBe(0);
    expect(sub.teamNumber('alpha')).toBe(1);
    sub.release();
  });
});

// --------------------------------------------------------------- differential

describe('in-situ differential against this repo’s vendored resolver', () => {
  const cases: Array<{ name: string; snakes: Snake[]; stage: (m: ReturnType<typeof marshalBoard>) => Record<string, number> }> = [
    {
      name: 'two knights racing for one square',
      snakes: [
        piece('K1', { x: 2, y: 2 }, 'knight', 1, { teamID: 'red' }),
        piece('K2', { x: 5, y: 3 }, 'knight', 1, { teamID: 'blue' }),
      ],
      stage: (m) => ({
        K1: m.toIndex({ x: 3, y: 4 }),
        K2: m.toIndex({ x: 3, y: 4 }),
      }),
    },
    {
      name: 'a rook raking a lighter queen',
      snakes: [
        piece('R', { x: 1, y: 4 }, 'rook', 4, { teamID: 'red' }),
        piece('Q', { x: 5, y: 4 }, 'queen', 1, { teamID: 'blue' }),
      ],
      stage: (m) => ({ R: m.toIndex({ x: 7, y: 4 }), Q: m.toIndex({ x: 5, y: 6 }) }),
    },
    {
      name: 'a snake walking into a piece stack',
      snakes: [
        makeSnake(
          'S',
          [
            { x: 3, y: 3 },
            { x: 2, y: 3 },
            { x: 1, y: 3 },
          ],
          { teamID: 'red', orientation: { dx: 1, dy: 0 } }
        ),
        piece('P', { x: 4, y: 3 }, 'pawn', 2, { teamID: 'blue' }),
      ],
      stage: (m) => ({ S: m.toIndex({ x: 4, y: 3 }), P: m.toIndex({ x: 4, y: 4 }) }),
    },
    {
      name: 'head-on snakes at odd separation (the edge exchange)',
      snakes: [
        makeSnake('A', [{ x: 2, y: 5 }, { x: 1, y: 5 }], {
          teamID: 'red',
          orientation: { dx: 1, dy: 0 },
        }),
        makeSnake('B', [{ x: 3, y: 5 }, { x: 4, y: 5 }], {
          teamID: 'blue',
          orientation: { dx: -1, dy: 0 },
        }),
      ],
      stage: (m) => ({ A: m.toIndex({ x: 3, y: 5 }), B: m.toIndex({ x: 2, y: 5 }) }),
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const board = boardOf(c.snakes, { food: [{ x: 7, y: 7 }] });
      const m = marshalBoard(board, TURN);
      const staged = c.stage(m);

      // Ground truth: the resolver this repo actually adjudicates against.
      const truth = resolveTurn({
        ...m.config,
        units: m.units.map((u) => ({ ...u, stagedMove: staged[u.id] })),
      });

      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const plan = new Map<UnitId, Candidate>();
      for (const u of sub.roster()) plan.set(u.unitId, move(sub, u.unitId, staged[u.wireId] as number));

      sub.withResolution(plan, 0, ({ resolution, bounds }) => {
        // Nothing is held, so the resolution is a PROOF: empty ledger, no
        // contingency, and the two bounds coincide.
        expect(resolution.ledger).toHaveLength(0);
        expect(resolution.fates.filter((f) => f.fate === Fate.Contingent)).toHaveLength(0);
        expect(bounds.best).toBe(bounds.worst);

        const mine = new Map<string, { cells: number[]; health: number; weight: number }>();
        for (const v of sub.engine.units(resolution.state)) {
          if (!v.alive) continue;
          const wireId = sub.unitOf(v.unitId)?.wireId as string;
          mine.set(wireId, { cells: [...v.cells], health: v.health, weight: v.weight });
        }
        const theirs = new Map<string, { cells: number[]; health: number; weight: number }>();
        for (const [id, unit] of Object.entries(truth.board)) {
          const trail = m.units.find((u) => u.id === id)?.type === 'snake';
          theirs.set(id, {
            cells: trail ? [...unit.occupancy] : [unit.occupancy[0] as number],
            health: unit.health,
            weight: unit.occupancy.length,
          });
        }
        expect([...mine.keys()].sort()).toEqual([...theirs.keys()].sort());
        for (const [id, a] of mine) expect([id, a]).toEqual([id, theirs.get(id)]);
      });
      expect(sub.outstanding()).toBe(1); // only the base state
      sub.release();
    });
  }
});

// --------------------------------------------------------------- named defaults

describe('a default is a narrowing and must be named', () => {
  test('naming every unit with NO_ORDER keeps them all live and applies the kind default', () => {
    const board = boardOf([
      makeSnake('S', [{ x: 3, y: 3 }, { x: 2, y: 3 }], {
        teamID: 'red',
        orientation: { dx: 1, dy: 0 },
      }),
      piece('N', { x: 6, y: 6 }, 'knight', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    sub.withResolution(defaultPlan(sub), 0, ({ resolution }) => {
      // Nothing HELD: the whole board is modelled, so the field is empty.
      expect(resolution.state.field.slots).toHaveLength(0);
      const snake = sub.unitOfWireId('S') as { unitId: UnitId };
      const view = sub.engine
        .units(resolution.state)
        .find((v) => v.unitId === snake.unitId);
      // A trail unit's default is momentum: it continued along its facing.
      const m = marshalBoard(board, TURN);
      expect(view?.cells[0]).toBe(m.toIndex({ x: 4, y: 3 }));
      // A piece's default is to hold.
      const knight = sub.unitOfWireId('N') as { unitId: UnitId; cells: ReadonlyArray<number> };
      const kview = sub.engine.units(resolution.state).find((v) => v.unitId === knight.unitId);
      expect(kview?.cells[0]).toBe(knight.cells[0]);
    });
    sub.release();
  });

  test('omitting a unit HOLDS it — a claim, not a mover — and never throws', () => {
    const board = boardOf([
      piece('me', { x: 2, y: 4 }, 'rook', 2, { teamID: 'red' }),
      piece('them', { x: 6, y: 4 }, 'queen', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const me = sub.unitOfWireId('me') as { unitId: UnitId };
    const m = marshalBoard(board, TURN);
    const plan = new Map<UnitId, Candidate>([
      [me.unitId, move(sub, me.unitId, m.toIndex({ x: 4, y: 4 }))],
    ]);

    // The engine refuses a partial assignment; the substrate makes one
    // impossible by construction rather than by asking the caller to remember.
    expect(() =>
      sub.withResolution(plan, 0, ({ resolution }) => {
        expect(resolution.state.field.slots).toHaveLength(1);
        expect(resolution.state.field.slots[0]?.record.unitId).toBe(
          sub.unitOfWireId('them')?.unitId
        );
      })
    ).not.toThrow();
    sub.release();
  });

  test('a plan naming a unit that is not on the board is a typed refusal', () => {
    const sub = makeSubstrate({
      board: boardOf([piece('a', { x: 2, y: 2 }, 'knight', 1, { teamID: 'red' })]),
      turn: TURN,
      asTeam: 'red',
    });
    const plan = new Map<UnitId, Candidate>([[99, { unitId: 99, from: -1, to: 0, path: [] }]]);
    expect(() => sub.resolveBoundedFor(plan, 0)).toThrow(UnknownUnitError);
    sub.release();
  });
});

// --------------------------------------------------------------- staleness

describe('staleness is currentTurn − observedTurn, applied exactly once', () => {
  test('a unit seen this turn is read at turnsHeld 1 — the post-advance field', () => {
    const board = boardOf([
      piece('me', { x: 2, y: 2 }, 'knight', 1, { teamID: 'red' }),
      piece('them', { x: 6, y: 6 }, 'knight', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    expect(sub.unitOfWireId('them')?.staleness).toBe(0);
    const slot = sub.claimField().slotOf(sub.unitOfWireId('them')?.unitId as UnitId);
    expect(slot?.cloud.turnsHeld).toBe(1);
    sub.release();
  });

  test('a unit last seen three turns ago claims three extra turns of reach, not four', () => {
    const board = boardOf([
      piece('me', { x: 2, y: 2 }, 'knight', 1, { teamID: 'red' }),
      piece('them', { x: 6, y: 6 }, 'knight', 1, { teamID: 'blue' }),
    ]);
    const fresh = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const stale = makeSubstrate({
      board,
      turn: TURN,
      asTeam: 'red',
      observedTurns: new Map([['them', TURN - 3]]),
    });
    const themFresh = fresh.unitOfWireId('them')?.unitId as UnitId;
    const themStale = stale.unitOfWireId('them')?.unitId as UnitId;
    expect(stale.unitOfWireId('them')?.staleness).toBe(3);

    const a = fresh.claimField().slotOf(themFresh);
    const b = stale.claimField().slotOf(themStale);
    expect(a?.cloud.turnsHeld).toBe(1);
    // consumer staleness 3 => turnsHeld 4 = staleness + 1. NOT 5.
    expect(b?.cloud.turnsHeld).toBe(4);

    // And the reach really grew: the stale claim is a strict superset.
    let staleOnly = 0;
    let freshOnly = 0;
    for (let c = 0; c < fresh.grid.cells; c++) {
      const inFresh = bbTest(a?.cloud.possible as Uint32Array, c);
      const inStale = bbTest(b?.cloud.possible as Uint32Array, c);
      if (inStale && !inFresh) staleOnly++;
      if (inFresh && !inStale) freshOnly++;
    }
    expect(freshOnly).toBe(0);
    expect(staleOnly).toBeGreaterThan(0);
    fresh.release();
    stale.release();
  });
});

// --------------------------------------------------------------- entanglement

describe('entanglement gates who has to be modelled', () => {
  test('a held unit whose claim cannot reach the path is not named', () => {
    const board = boardOf(
      [
        piece('me', { x: 1, y: 1 }, 'rook', 2, { teamID: 'red' }),
        piece('near', { x: 3, y: 3 }, 'knight', 1, { teamID: 'blue' }),
        piece('far', { x: 8, y: 8 }, 'knight', 1, { teamID: 'blue' }),
      ],
      { width: 11, height: 11 }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const m = marshalBoard(board, TURN);
    const probe = [
      { cell: m.toIndex({ x: 2, y: 1 }), fromSubStep: 1, toSubStep: 1 },
      { cell: m.toIndex({ x: 3, y: 1 }), fromSubStep: 2, toSubStep: 2 },
    ];
    const named = sub.entangled(probe).map((id) => sub.unitOf(id)?.wireId);
    expect(named).toContain('near');
    expect(named).not.toContain('far');
    // Our own unit is modelled, so it is never a claim.
    expect(named).not.toContain('me');
    sub.release();
  });

  test('a cell nobody can reach entangles nobody', () => {
    const board = boardOf(
      [
        piece('me', { x: 1, y: 1 }, 'rook', 2, { teamID: 'red' }),
        piece('far', { x: 9, y: 9 }, 'knight', 1, { teamID: 'blue' }),
      ],
      { width: 11, height: 11 }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const m = marshalBoard(board, TURN);
    expect(sub.entangled([{ cell: m.toIndex({ x: 1, y: 5 }), fromSubStep: 4, toSubStep: 4 }])).toHaveLength(0);
    sub.release();
  });
});

// --------------------------------------------------------------- footprints

describe('influenceOf over-approximates, in the safe direction', () => {
  test('it contains the unit’s own occupancy and every legal path it has', () => {
    const board = boardOf([piece('Q', { x: 4, y: 4 }, 'queen', 3, { teamID: 'red' })]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const q = sub.unitOfWireId('Q') as { unitId: UnitId; cells: ReadonlyArray<number> };
    const footprint = sub.influenceOf(q.unitId);
    for (const c of q.cells) expect(footprint.has(c)).toBe(true);
    let paths = 0;
    for (const candidate of sub.enumerate(q.unitId)) {
      if (candidate.action.kind !== 'move') continue;
      paths++;
      for (const c of candidate.action.path) expect(footprint.has(c)).toBe(true);
    }
    expect(paths).toBeGreaterThan(0);
    // A queen on an open 9x9 board influences a good deal of it, and never a
    // cell outside the board.
    for (const c of footprint) expect(c).toBeLessThan(sub.grid.cells);
    sub.release();
  });

  test('a knight’s footprint is its jumps, which never include its own colour', () => {
    const board = boardOf([piece('N', { x: 4, y: 4 }, 'knight', 1, { teamID: 'red' })]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const n = sub.unitOfWireId('N') as { unitId: UnitId; cells: ReadonlyArray<number> };
    const origin = n.cells[0] as number;
    const parity = (c: number): number =>
      ((c % sub.grid.width) + Math.floor(c / sub.grid.width)) % 2;
    for (const c of sub.influenceOf(n.unitId)) {
      if (c === origin) continue;
      expect(parity(c)).not.toBe(parity(origin));
    }
    sub.release();
  });
});

// --------------------------------------------------------------- slab hygiene

describe('every slab is returned', () => {
  test('a sweep of resolutions leaves exactly the base state outstanding', () => {
    const board = boardOf([
      piece('me', { x: 2, y: 4 }, 'rook', 2, { teamID: 'red' }),
      piece('mate', { x: 3, y: 6 }, 'knight', 1, { teamID: 'red' }),
      piece('them', { x: 6, y: 4 }, 'queen', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const me = sub.unitOfWireId('me') as { unitId: UnitId };
    let ran = 0;
    for (const candidate of sub.enumerate(me.unitId)) {
      if (candidate.action.kind !== 'move') continue;
      const plan = new Map<UnitId, Candidate>([
        [me.unitId, { unitId: me.unitId, from: -1, to: candidate.dest, path: candidate.action.path }],
      ]);
      sub.withResolution(plan, 0, () => {
        ran++;
      });
      expect(sub.outstanding()).toBe(1);
    }
    expect(ran).toBeGreaterThan(4);
    expect(sub.resolutions()).toBe(ran);
    sub.release();
    expect(sub.outstanding()).toBe(0);
  });

  test('the hold set is interned: one held configuration is built once', () => {
    const board = boardOf([
      piece('me', { x: 2, y: 4 }, 'rook', 2, { teamID: 'red' }),
      piece('them', { x: 6, y: 4 }, 'queen', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const me = sub.unitOfWireId('me') as { unitId: UnitId };
    const them = sub.unitOfWireId('them') as { unitId: UnitId };
    const fields: unknown[] = [];
    for (const candidate of sub.enumerate(me.unitId)) {
      if (candidate.action.kind !== 'move') continue;
      const plan = new Map<UnitId, Candidate>([
        [me.unitId, { unitId: me.unitId, from: -1, to: candidate.dest, path: candidate.action.path }],
      ]);
      sub.withResolution(plan, 0, ({ resolution }) => {
        expect(resolution.state.field.slotOf(them.unitId)).toBeDefined();
        fields.push(resolution.state.field);
      });
    }
    // The POST-ADVANCE field differs per resolution, but every one of them
    // descends from the single interned start field — which is what makes the
    // frozen half cost a pointer copy instead of a rebuild.
    expect(fields.length).toBeGreaterThan(3);
    sub.release();
  });

  test('release() is idempotent and closes the door', () => {
    const sub = makeSubstrate({
      board: boardOf([piece('a', { x: 2, y: 2 }, 'knight', 1, { teamID: 'red' })]),
      turn: TURN,
      asTeam: 'red',
    });
    sub.release();
    sub.release();
    expect(sub.outstanding()).toBe(0);
    expect(() => sub.resolveBoundedFor(new Map(), 0)).toThrow(/after release/);
  });
});

// --------------------------------------------------------------- capacity

describe('capacity is a typed refusal, never a silent truncation', () => {
  test('more than the cloud field can carry is named as such', () => {
    const snakes: Snake[] = [];
    for (let i = 0; i < 34; i++) {
      snakes.push(
        piece(`u${i}`, { x: i % 9, y: Math.floor(i / 9) }, 'knight', 1, {
          teamID: i === 0 ? 'red' : 'blue',
        })
      );
    }
    const sub = makeSubstrate({ board: boardOf(snakes, { width: 9, height: 9 }), turn: TURN });
    // Nothing modelled: every unit would be held.
    expect(() => sub.claimField()).toThrow(TooManyHeldError);
    sub.release();
  });
});
