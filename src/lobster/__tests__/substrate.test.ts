/**
 * The substrate's silent failure modes, each pinned.
 *
 *   1. the weight-stack collapse (a grown piece arriving as one cell)
 *   2. the head-start double-count (staleness applied twice)
 *   3. the partial assignment (a live unit nobody named)
 *   4. the claim view answering the wrong question for a sibling
 *
 * Plus the in-situ differential: a fully-named plan run through the substrate
 * must agree with THIS repo's vendored resolver on the same board, marshalled
 * the same way. That is the only test that can catch a translation bug,
 * because a translation bug is invisible to every test written in one
 * vocabulary. After the cut it is also the cheapest of theorems — a settlement
 * with nothing held IS `settleTurn` — which is exactly why it is worth
 * writing down: what is being checked is the TRANSLATION, and the translation
 * is the only thing left on this side of the seam.
 */

import { Snake } from '../../types/battlesnake';
import { marshalBoard, resolveTurn } from '../../logic/turn-oracle';
import {
  EngineSubstrate,
  NO_ORDER_MOVE,
  UnknownUnitError,
  clearGeometryCache,
  geometryCacheStats,
  makeSubstrate,
  releaseGeometriesFor,
} from '../substrate';
import type { Candidate, JointPlan, UnitId } from '../contracts';
import { makeSnake, piece, boardOf } from '../../tests/board-fixtures';

// --------------------------------------------------------------------- fixtures

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
  for (const u of sub.roster()) {
    plan.set(u.unitId, { unitId: u.unitId, from: -1, to: NO_ORDER_MOVE, path: [] });
  }
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
    // The wire says [c,c,c,c,c]; the board reads one cell at weight 5, and the
    // engine record keeps the stack the rules actually adjudicate.
    expect(rook?.cells).toHaveLength(1);
    expect(rook?.weight).toBe(5);
    expect(sub.recordOf(rook?.unitId as UnitId)?.occupancy).toHaveLength(5);
    sub.release();
  });

  test('a trail unit passes straight through, head first', () => {
    const body = [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
    ];
    const board = boardOf([makeSnake('S', body, { teamID: 'red' })]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const m = marshalBoard(board, TURN);
    const snake = sub.unitOfWireId('S');
    expect(snake?.cells).toEqual(body.map((c) => m.toIndex(c)));
    expect(snake?.weight).toBe(3);
    sub.release();
  });

  test('the deciding team is engine team 0, whatever it is called', () => {
    const sub = makeSubstrate({
      board: boardOf([
        piece('A', { x: 1, y: 1 }, 'knight', 1, { teamID: 'zebra' }),
        piece('B', { x: 7, y: 7 }, 'knight', 1, { teamID: 'aardvark' }),
      ]),
      turn: TURN,
      asTeam: 'zebra',
    });
    expect(sub.teamNumber('zebra')).toBe(0);
    expect(sub.teamNumber('aardvark')).toBe(1);
    expect(sub.teamLabel(0)).toBe('zebra');
    sub.release();
  });
});

// -------------------------------------------------------------- differential

describe('in-situ differential against this repo’s vendored resolver', () => {
  const cases: Array<{
    name: string;
    snakes: Snake[];
    stage: (m: ReturnType<typeof marshalBoard>) => Record<string, number>;
  }> = [
    {
      name: 'two knights racing for one square',
      snakes: [
        piece('K1', { x: 2, y: 2 }, 'knight', 1, { teamID: 'red' }),
        piece('K2', { x: 5, y: 3 }, 'knight', 1, { teamID: 'blue' }),
      ],
      stage: (m) => ({ K1: m.toIndex({ x: 3, y: 4 }), K2: m.toIndex({ x: 3, y: 4 }) }),
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
      for (const u of sub.roster()) {
        plan.set(u.unitId, move(sub, u.unitId, staged[u.wireId] as number));
      }

      sub.withResolution(plan, 0, ({ resolution, bounds }) => {
        // Nothing is held, so the settlement is a PROOF: an empty ledger, no
        // contingency, no claims, and the two bounds coincide.
        expect(resolution.ledger).toHaveLength(0);
        expect(resolution.claims).toHaveLength(0);
        expect(Object.values(resolution.fates)).not.toContain('contingent');
        expect(bounds.best).toBe(bounds.worst);

        const mine = new Map<string, { cells: number[]; energy: number }>();
        for (const [wireId, settled] of Object.entries(resolution.board)) {
          mine.set(wireId, { cells: [...settled.occupancy], energy: settled.energy });
        }
        const theirs = new Map<string, { cells: number[]; energy: number }>();
        for (const [id, unit] of Object.entries(truth.board)) {
          theirs.set(id, { cells: [...unit.occupancy], energy: unit.energy });
        }
        expect([...mine.keys()].sort()).toEqual([...theirs.keys()].sort());
        for (const [id, a] of mine) expect([id, a]).toEqual([id, theirs.get(id)]);
      });
      sub.release();
    });
  }
});

// --------------------------------------------------------------- named defaults

describe('a default is a narrowing and must be named', () => {
  test('naming every unit with NO_ORDER keeps them all live and applies the kind default', () => {
    const board = boardOf([
      makeSnake('S', [{ x: 3, y: 3 }, { x: 3, y: 4 }], {
        teamID: 'red',
        orientation: { dx: 0, dy: -1 },
      }),
      piece('P', { x: 6, y: 6 }, 'rook', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const out = sub.resolveBoundedFor(defaultPlan(sub), 0);
    // Nothing is held, so nothing is a claim and nothing is contingent.
    expect(out.resolution.claims).toHaveLength(0);
    expect(out.resolution.ledger).toHaveLength(0);
    // The trail unit CONTINUED — it has no hold in its grammar — and the piece
    // held, because it has. Both are RULES, and both come back from settlement
    // rather than from this layer: the head is one step from where it stood,
    // wherever the unit was facing, and the piece is where it started.
    const m = marshalBoard(board, TURN);
    const snake = sub.unitOfWireId('S') as NonNullable<ReturnType<EngineSubstrate['unitOfWireId']>>;
    const head = out.resolution.board['S']?.occupancy[0] as number;
    const start = snake.cells[0] as number;
    const step = Math.abs(head - start);
    expect(step === 1 || step === m.fullWidth).toBe(true);
    expect(out.resolution.board['P']?.occupancy[0]).toBe(m.toIndex({ x: 6, y: 6 }));
    sub.release();
  });

  test('omitting a unit HOLDS it — a claim, not a mover — and never throws', () => {
    const board = boardOf([
      piece('A', { x: 3, y: 3 }, 'knight', 1, { teamID: 'red' }),
      piece('B', { x: 4, y: 4 }, 'knight', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const a = sub.unitOfWireId('A')?.unitId as UnitId;
    const plan = new Map<UnitId, Candidate>([[a, { unitId: a, from: -1, to: NO_ORDER_MOVE, path: [] }]]);
    const out = sub.resolveBoundedFor(plan, 0);
    expect(out.resolution.claims.map((c) => c.id)).toEqual(['B']);
    // A claim's own disposition is the claim, never a ledger entry.
    expect(out.resolution.ledger.every((e) => e.unitId !== 'B')).toBe(true);
    sub.release();
  });

  test('a plan naming a unit that is not on the board is a typed refusal', () => {
    const sub = makeSubstrate({
      board: boardOf([piece('A', { x: 3, y: 3 }, 'knight', 1, { teamID: 'red' })]),
      turn: TURN,
      asTeam: 'red',
    });
    const ghost = 99 as UnitId;
    expect(() =>
      sub.resolveBoundedFor(new Map([[ghost, { unitId: ghost, from: -1, to: 0, path: [] }]]), 0)
    ).toThrow(UnknownUnitError);
    sub.release();
  });
});

// ------------------------------------------------------------------ staleness

describe('staleness is currentTurn − observedTurn, applied exactly once', () => {
  const board = boardOf([
    piece('A', { x: 1, y: 1 }, 'knight', 1, { teamID: 'red' }),
    makeSnake('E', [{ x: 5, y: 5 }, { x: 5, y: 6 }], { teamID: 'blue' }),
  ]);

  test('a unit seen this turn covers one turn of unknown movement, not two', () => {
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const claim = sub.claimsOf().find((c) => c.id === 'E');
    expect(claim).toBeDefined();
    // The settled turn is `turn + 1` and the observation is `turn`, so the
    // span is exactly one: the head fronts are this turn's step, and nothing
    // beyond it.
    const m = marshalBoard(board, TURN);
    const front = (claim?.headPossible[claim.headPossible.length - 1] ?? []) as ReadonlyArray<number>;
    expect(front).toContain(m.toIndex({ x: 5, y: 4 })); // one step on
    expect(front).not.toContain(m.toIndex({ x: 5, y: 2 })); // two steps on
    sub.release();
  });

  test('a unit last seen three turns ago claims three extra turns of reach', () => {
    const fresh = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const stale = makeSubstrate({
      board,
      turn: TURN,
      asTeam: 'red',
      observedTurns: new Map([['E', TURN - 3]]),
    });
    const reachOf = (sub: EngineSubstrate): number =>
      (sub.claimsOf().find((c) => c.id === 'E')?.everPossible ?? []).length;
    expect(reachOf(stale)).toBeGreaterThan(reachOf(fresh));
    fresh.release();
    stale.release();
  });
});

// --------------------------------------------------------------- entanglement

describe('entanglement gates who has to be modelled', () => {
  test('a held unit whose claim cannot reach the path is not named', () => {
    const board = boardOf([
      piece('A', { x: 1, y: 1 }, 'knight', 1, { teamID: 'red' }),
      piece('E', { x: 8, y: 8 }, 'knight', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const m = marshalBoard(board, TURN);
    const near = m.toIndex({ x: 2, y: 3 });
    expect(sub.entangled([{ cell: near, fromSubStep: 1, toSubStep: 1 }])).toEqual([]);
    sub.release();
  });

  test('a cell the claim CAN hold names it, and the claim agrees', () => {
    const board = boardOf([
      piece('A', { x: 1, y: 1 }, 'knight', 1, { teamID: 'red' }),
      piece('E', { x: 4, y: 4 }, 'knight', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const m = marshalBoard(board, TURN);
    const jump = m.toIndex({ x: 5, y: 6 }); // one knight move from (4,4)
    const named = sub.entangled([
      { cell: jump, fromSubStep: 1, toSubStep: Number.MAX_SAFE_INTEGER },
    ]);
    expect(named).toEqual([sub.unitOfWireId('E')?.unitId]);
    // The gate is the CLAIM's own, never a second reading of the grammar.
    const claim = sub.claimsOf().find((c) => c.id === 'E');
    expect(claim?.headPossible[claim.headPossible.length - 1]).toContain(jump);
    sub.release();
  });
});

// ----------------------------------------------------------------- influence

describe('influenceOf over-approximates, in the safe direction', () => {
  test('it contains the unit’s own occupancy and every legal path it has', () => {
    const board = boardOf([
      makeSnake('S', [{ x: 3, y: 3 }, { x: 3, y: 4 }], { teamID: 'red' }),
      piece('E', { x: 7, y: 7 }, 'rook', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const s = sub.unitOfWireId('S') as NonNullable<ReturnType<EngineSubstrate['unitOfWireId']>>;
    const cells = sub.influenceOf(s.unitId);
    for (const cell of s.cells) expect(cells.has(cell)).toBe(true);
    for (const candidate of sub.actionsOf(s.unitId)) {
      for (const cell of candidate.path) expect(cells.has(cell)).toBe(true);
    }
    sub.release();
  });
});

// ------------------------------------------------------------------- siblings

describe('a modelled sibling answers its OWN claim question', () => {
  const board = boardOf([
    piece('A', { x: 3, y: 3 }, 'knight', 1, { teamID: 'red' }),
    piece('B', { x: 5, y: 5 }, 'knight', 1, { teamID: 'blue' }),
    piece('C', { x: 6, y: 2 }, 'knight', 1, { teamID: 'blue' }),
  ]);

  test('a WIDER sibling holds fewer units, and its claims say so', () => {
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const b = sub.unitOfWireId('B')?.unitId as UnitId;
    const wider = sub.withModelled([...sub.modeled(), b]) as unknown as EngineSubstrate;
    expect(sub.claimsOf().map((c) => c.id).sort()).toEqual(['B', 'C']);
    expect(wider.claimsOf().map((c) => c.id)).toEqual(['C']);
    wider.release();
    // The sibling's release must not disturb the parent.
    expect(sub.claimsOf().map((c) => c.id).sort()).toEqual(['B', 'C']);
    sub.release();
  });

  test('a NARROWER sibling is simply correct — there is no shared claim view', () => {
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const narrower = sub.withModelled([]) as unknown as EngineSubstrate;
    expect(narrower.claimsOf().map((c) => c.id).sort()).toEqual(['A', 'B', 'C']);
    narrower.release();
    sub.release();
  });

  test('a sibling answers its OWN peril, whichever view was asked first', () => {
    // B and C are two blue knights that can take each other, so with red's
    // units off the board both are possibly-gone: that is `perilOf`. A sibling
    // that models B holds only C, which nothing can reach — its peril is empty.
    //
    // The regression: `perilCache` used to live only on the family, so a
    // sibling read the PARENT's memo through the prototype and answered the
    // parent's question. Asked parent-first it said {B, C}; asked
    // sibling-first, {} — the same view, two answers, and the decision path
    // always resolves B0 first.
    const perilBoard = boardOf([
      piece('A', { x: 0, y: 0 }, 'knight', 1, { teamID: 'red' }),
      piece('B', { x: 5, y: 5 }, 'knight', 1, { teamID: 'blue' }),
      piece('C', { x: 6, y: 3 }, 'knight', 1, { teamID: 'blue' }),
    ]);
    const widerPeril = (parentFirst: boolean): ReadonlyArray<string> => {
      const sub = makeSubstrate({ board: perilBoard, turn: TURN, asTeam: 'red' });
      try {
        const b = sub.unitOfWireId('B')?.unitId as UnitId;
        if (parentFirst) expect([...sub.perilOf()].sort()).toEqual(['B', 'C']);
        const wider = sub.withModelled([...sub.modeled(), b]) as unknown as EngineSubstrate;
        return [...wider.perilOf()].sort();
      } finally {
        sub.release();
      }
    };
    expect(widerPeril(false)).toEqual([]);
    expect(widerPeril(true)).toEqual([]);
  });

  test('resolution on a sibling is unaffected: the plan is the modelled set', () => {
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const a = sub.unitOfWireId('A')?.unitId as UnitId;
    const sibling = sub.withModelled([a]);
    const plan = new Map<UnitId, Candidate>([
      [a, { unitId: a, from: -1, to: NO_ORDER_MOVE, path: [] }],
    ]);
    const viaParent = sub.resolveBoundedFor(plan, 0);
    const viaSibling = sibling.resolveBoundedFor(plan, 0);
    expect(viaSibling.bounds.worst).toBe(viaParent.bounds.worst);
    expect(viaSibling.bounds.best).toBe(viaParent.bounds.best);
    sibling.release();
    sub.release();
  });
});

// ------------------------------------------------------------ geometry cache

describe('the geometry cache has a scope and a lifetime', () => {
  const board = boardOf([piece('A', { x: 3, y: 3 }, 'knight', 1, { teamID: 'red' })]);

  test('two GAMES on the same board keep their own entries', () => {
    clearGeometryCache();
    const one = makeSubstrate({ board, turn: TURN, asTeam: 'red', gameId: 'g1' });
    const two = makeSubstrate({ board, turn: TURN, asTeam: 'red', gameId: 'g2' });
    expect(geometryCacheStats().entries).toBe(2);
    one.release();
    two.release();
  });

  test('the same game reuses its geometry turn after turn — the whole point', () => {
    clearGeometryCache();
    const a = makeSubstrate({ board, turn: TURN, asTeam: 'red', gameId: 'g1' });
    const b = makeSubstrate({ board, turn: TURN + 1, asTeam: 'red', gameId: 'g1' });
    expect(geometryCacheStats().entries).toBe(1);
    a.release();
    b.release();
  });

  test('a game that ends takes its geometry with it', () => {
    clearGeometryCache();
    const a = makeSubstrate({ board, turn: TURN, asTeam: 'red', gameId: 'g1' });
    a.release();
    expect(releaseGeometriesFor('g1')).toBe(1);
    expect(geometryCacheStats().entries).toBe(0);
  });
});

// ------------------------------------------------------------------- release

describe('release closes the door', () => {
  test('it is idempotent, and settling after it is a refusal', () => {
    const sub = makeSubstrate({
      board: boardOf([piece('A', { x: 3, y: 3 }, 'knight', 1, { teamID: 'red' })]),
      turn: TURN,
      asTeam: 'red',
    });
    sub.release();
    sub.release();
    expect(() => sub.resolveBoundedFor(defaultPlan(sub), 0)).toThrow(/after release/);
  });
});
