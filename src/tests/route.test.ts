/**
 * ROUTES OVER THE ENGINE'S LEGALITY — `logic/route.ts` as a boundary.
 *
 * `RouteBoard` is the passability-and-adjacency layer the goto/waypoint
 * pathfinder and the territory view run on, and it replaced `board-graph.ts`
 * precisely because the graph re-derived rules it had no business owning. The
 * property that keeps it honest is an INCLUSION, asserted here rather than
 * described in a comment:
 *
 *     every edge a route may take is a move the vendored grammar plans,
 *
 * and, when nothing is in the way, the two sets are EQUAL. Both directions
 * matter. Inclusion alone would let the layer silently drop a knight's jump;
 * equality on an open board is what says it does not. Neither is restated as
 * a table of offsets — the expectation is computed by calling `planUnitAction`
 * itself, the same function `resolveTurn` stages with, so a test here can
 * never become the fifth mirror of the grammar.
 *
 * What is NOT the grammar's, and so is asserted on its own terms:
 *  - which cells are OPEN at the turn a search arrives on them (tail vacate
 *    timing, hazards, other pieces' squares, the subject's own head);
 *  - how a ray is cut by that openness — the ray ends AT the first closed
 *    square, which is still offered, because whether entering it is a capture
 *    or a death is the engine's answer and not a routing layer's;
 *  - how a unit whose reachability depends on its FACING (only the pawn) is
 *    lifted into a (cell, orientation) search space.
 *
 * The routing BEHAVIOUR built on all this — shortest paths, queued legs,
 * progress stats — is `waypoint.test.ts`. This file pins the seam underneath.
 *
 * Board: api 9x9 (full board 11x11 with the perimeter wall). Cells are API
 * indices, `y * width + x`, y up — what every caller of this module holds.
 */

import {
  RouteBoard,
  RouteUnit,
  SNAKE_ROUTE_UNIT,
  fillNeighbors4,
  isOrientationStateful,
  quarterTurnsFrom,
} from '../logic/route';
import {
  Orientation,
  legalOrientations,
  planUnitAction,
  toIndex,
} from '../logic/staging-legality';
import type { BoardSnapshot, Coord, Snake } from '../types/battlesnake';
import type { UnitType } from '@shared/types/Game';

const W = 9;
const H = 9;
const FULL_W = W + 2;
const FULL_H = H + 2;

const KINDS: UnitType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

/** An api cell index. */
const cell = (x: number, y: number): number => y * W + x;
const xyOf = (idx: number): Coord => ({ x: idx % W, y: Math.floor(idx / W) });

/** The same api cell as a FULL-BOARD index: perimeter re-added, y flipped. */
const fullOf = (idx: number): number => toIndex((idx % W) + 1, H - Math.floor(idx / W), FULL_W);

function unit(
  id: string,
  head: Coord,
  opts: {
    unitType?: string;
    orientation?: Orientation;
    body?: Coord[];
    health?: number;
    length?: number;
  } = {}
): Snake {
  const isPiece = !!opts.unitType && opts.unitType !== 'snake';
  const body =
    opts.body ??
    (isPiece
      ? [head]
      : [head, { x: head.x, y: head.y - 1 }, { x: head.x, y: head.y - 2 }]);
  const s: Snake = {
    id,
    name: id,
    latency: '0',
    health: opts.health ?? 90,
    body,
    head,
    length: opts.length ?? body.length,
    shout: '',
    squad: '',
    orientation: opts.orientation ?? { dx: 0, dy: -1 },
    customizations: { color: '#fff', head: 'default', tail: 'default' },
  };
  if (opts.unitType) s.unitType = opts.unitType;
  return s;
}

function snapshot(
  snakes: Snake[],
  opts: { turn?: number; food?: Coord[]; hazards?: Coord[] } = {}
): BoardSnapshot {
  return {
    game: {
      id: 'route-test',
      ruleset: { name: 'teamsnek', version: 'v1', settings: {} },
      map: 'standard',
      timeout: 500,
      source: 'test',
    },
    turn: opts.turn ?? 0,
    board: {
      width: W,
      height: H,
      food: opts.food ?? [],
      hazards: opts.hazards ?? [],
      snakes,
    },
  };
}

/** The edge set `route.ts` offers, as a set of api cells. */
function edgesOf(
  board: RouteBoard,
  routeUnit: RouteUnit,
  from: number,
  passable: (idx: number) => boolean = () => true
): Set<number> {
  const out = board.neighborBuffer();
  const n = board.fillUnitNeighbors(routeUnit, from, passable, out);
  return new Set(Array.from(out.slice(0, n)));
}

/**
 * The edge set the ENGINE licenses from `from`, computed by asking
 * `planUnitAction` about every square on the board. This is the oracle: it
 * knows nothing about rays, jumps or facings, only that a destination is an
 * edge exactly when staging it plans a MOVE.
 */
function engineMovesFrom(kind: UnitType, from: number, orientation: Orientation): Set<number> {
  const origin = fullOf(from);
  const moves = new Set<number>();
  for (let idx = 0; idx < W * H; idx++) {
    const action = planUnitAction(kind, origin, fullOf(idx), FULL_W, FULL_H, orientation);
    if (action && action.kind === 'move') moves.add(idx);
  }
  return moves;
}

describe('route edges are engine moves', () => {
  test('on an empty board, every kind’s edge set EQUALS the grammar’s move set', () => {
    // Two origins and two facings, so a slider is tested both boxed against
    // the perimeter and running free, and the pawn is tested facing each way.
    for (const from of [cell(4, 4), cell(0, 0), cell(8, 3)]) {
      for (const orientation of [
        { dx: 0, dy: -1 },
        { dx: 1, dy: 0 },
      ]) {
        for (const kind of KINDS) {
          const head = xyOf(from);
          const board = new RouteBoard(
            snapshot([unit('U', head, { unitType: kind, orientation })])
          );
          const got = edgesOf(board, board.unitFor('U'), from);
          const want = engineMovesFrom(kind, from, orientation);
          expect({ kind, from, orientation, edges: [...got].sort((a, b) => a - b) }).toEqual({
            kind,
            from,
            orientation,
            edges: [...want].sort((a, b) => a - b),
          });
        }
      }
    }
  });

  test('with squares closed, the edge set stays a SUBSET of the grammar’s', () => {
    // A crowded board: bodies, a piece, hazards and food, so every reason a
    // route square can close is in play at once.
    const snakes = [
      unit('Q', { x: 4, y: 4 }, { unitType: 'queen', orientation: { dx: 0, dy: -1 } }),
      unit('R', { x: 4, y: 7 }, { unitType: 'rook' }),
      unit('S', { x: 6, y: 4 }, { body: [{ x: 6, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 2 }] }),
    ];
    const board = new RouteBoard(
      snapshot(snakes, { hazards: [{ x: 2, y: 4 }], food: [{ x: 5, y: 5 }] })
    );
    const pass = board.passabilityFor('Q');
    const got = edgesOf(board, board.unitFor('Q'), cell(4, 4), (idx) => pass.passableIdx(idx, 1));
    const want = engineMovesFrom('queen', cell(4, 4), { dx: 0, dy: -1 });
    for (const edge of got) expect(want.has(edge)).toBe(true);
    expect(got.size).toBeLessThan(want.size); // something really was cut
  });

  test('a trail unit’s edges are its four orthogonal steps, and the perimeter is not one', () => {
    const board = new RouteBoard(snapshot([unit('S', { x: 0, y: 0 })]));
    expect(edgesOf(board, SNAKE_ROUTE_UNIT, cell(0, 0))).toEqual(
      new Set([cell(0, 1), cell(1, 0)])
    );
    expect(edgesOf(board, SNAKE_ROUTE_UNIT, cell(4, 4))).toEqual(
      new Set([cell(4, 5), cell(4, 3), cell(3, 4), cell(5, 4)])
    );
  });

  test('a pawn contributes its forward step ONLY — never a rotation, never a diagonal', () => {
    // Its side squares plan a ROTATE (a turn spent turning, not a
    // displacement) and its diagonals need a capture target a multi-turn
    // search cannot promise will still be standing there.
    const orientation = { dx: 0, dy: -1 }; // full-board dy -1 is api y+1
    const board = new RouteBoard(
      snapshot([
        unit('P', { x: 4, y: 4 }, { unitType: 'pawn', orientation }),
        unit('X', { x: 5, y: 5 }, { unitType: 'rook' }), // a capturable diagonal
      ])
    );
    expect(edgesOf(board, board.unitFor('P'), cell(4, 4))).toEqual(new Set([cell(4, 5)]));
  });
});

describe('a ray ends AT the first closed square', () => {
  test('the blocker is offered and the ray stops there', () => {
    const board = new RouteBoard(
      snapshot([unit('R', { x: 4, y: 0 }, { unitType: 'rook', orientation: { dx: 0, dy: -1 } })])
    );
    const closed = cell(4, 3);
    const got = edgesOf(board, board.unitFor('R'), cell(4, 0), (idx) => idx !== closed);
    // Up the file: 1, 2, 3 offered; 4 and beyond are behind the blocker.
    expect(got.has(cell(4, 1))).toBe(true);
    expect(got.has(cell(4, 2))).toBe(true);
    expect(got.has(closed)).toBe(true);
    expect(got.has(cell(4, 4))).toBe(false);
    expect(got.has(cell(4, 8))).toBe(false);
    // The other three files are untouched by the block.
    expect(got.has(cell(8, 0))).toBe(true);
  });

  test('a knight jumps over a closed square: only its own landings are cut', () => {
    const board = new RouteBoard(
      snapshot([unit('N', { x: 4, y: 4 }, { unitType: 'knight' })])
    );
    const open = edgesOf(board, board.unitFor('N'), cell(4, 4));
    const overIt = edgesOf(board, board.unitFor('N'), cell(4, 4), (idx) => idx !== cell(4, 5));
    expect(overIt).toEqual(open); // the square jumped over is not on any ray
  });
});

describe('passability: what is open, and when', () => {
  const crowd = () =>
    new RouteBoard(
      snapshot(
        [
          unit('S', { x: 4, y: 4 }, { body: [
            { x: 4, y: 4 },
            { x: 4, y: 3 },
            { x: 4, y: 2 },
            { x: 4, y: 1 },
          ] }),
          unit('T', { x: 1, y: 1 }, { body: [
            { x: 1, y: 1 },
            { x: 1, y: 2 },
            { x: 1, y: 3 },
          ] }),
          unit('B', { x: 7, y: 7 }, { unitType: 'bishop' }),
        ],
        { hazards: [{ x: 6, y: 6 }] }
      )
    );

  test('a hazard is closed — this layer is health-blind, and says so', () => {
    const pass = crowd().passabilityFor('S');
    expect(pass.passableIdx(cell(6, 6), 5)).toBe(false);
  });

  test('opting out of the hazard veto reopens it, and nothing else', () => {
    const board = crowd();
    const pass = board.passabilityFor('S', { ignoreHazards: true });
    expect(pass.passableIdx(cell(6, 6), 1)).toBe(true);
    expect(pass.passableIdx(cell(7, 7), 1)).toBe(false); // still a piece's square
  });

  test('another unit’s PIECE square is closed at every arrival turn — the contest is the engine’s', () => {
    const pass = crowd().passabilityFor('S');
    for (const turn of [0, 1, 5, 50]) expect(pass.passableIdx(cell(7, 7), turn)).toBe(false);
  });

  test('the subject’s own head is an origin, never a destination', () => {
    const pass = crowd().passabilityFor('S');
    expect(pass.headIdx).toBe(cell(4, 4));
    expect(pass.passableIdx(cell(4, 4), 3)).toBe(false);
  });

  test('another unit’s body opens on the turn it recedes, tail first', () => {
    const pass = crowd().passabilityFor('S');
    // T is 3 long: its tail (1,3) frees next turn, its middle (1,2) the turn after.
    expect(pass.tailIdx).toBe(cell(4, 1));
    expect(pass.passableIdx(cell(1, 3), 0)).toBe(false);
    expect(pass.passableIdx(cell(1, 3), 1)).toBe(true);
    expect(pass.passableIdx(cell(1, 2), 1)).toBe(false);
    expect(pass.passableIdx(cell(1, 2), 2)).toBe(true);
    // T's head is not a body segment: another unit's head is an empty square
    // as far as ROUTING goes; whether arriving there kills is the engine's.
    expect(pass.passableIdx(cell(1, 1), 0)).toBe(true);
  });

  test('the subject’s OWN body never opens ahead of its head — only its tail follows the clock', () => {
    const pass = crowd().passabilityFor('S');
    for (const turn of [0, 1, 2, 9]) expect(pass.passableIdx(cell(4, 3), turn)).toBe(false);
    expect(pass.passableIdx(cell(4, 1), 0)).toBe(false);
    expect(pass.passableIdx(cell(4, 1), 1)).toBe(true);
  });

  test('a confirmable meal delays every segment but the bare tail', () => {
    const fed = new RouteBoard(
      snapshot(
        [unit('S', { x: 4, y: 4 }, { body: [
          { x: 4, y: 4 },
          { x: 4, y: 3 },
          { x: 4, y: 2 },
          { x: 4, y: 1 },
        ] })],
        { food: [{ x: 5, y: 4 }] } // one step from the head: it could eat now
      )
    );
    const pass = fed.passabilityFor('X'); // a stranger's view, so nothing is "own"
    expect(pass.passableIdx(cell(4, 1), 1)).toBe(true); // a bare tail still pops
    expect(pass.passableIdx(cell(4, 2), 2)).toBe(false); // pushed out by the meal
    expect(pass.passableIdx(cell(4, 2), 3)).toBe(true);
  });

  test('a dead unit leaves no body behind, and an unknown subject has no head', () => {
    const board = new RouteBoard(
      snapshot([
        unit('S', { x: 4, y: 4 }),
        unit('D', { x: 2, y: 2 }, { health: 0 }),
      ])
    );
    const pass = board.passabilityFor('nobody');
    expect(pass.headIdx).toBe(-1);
    expect(pass.tailIdx).toBe(-1);
    expect(pass.passableIdx(cell(2, 1), 0)).toBe(true);
    expect(board.sources().map((s) => s.id)).toEqual(['S']);
  });
});

describe('the search space of a unit', () => {
  test('only the pawn is orientation-stateful; every other kind collapses to one layer', () => {
    expect(isOrientationStateful('pawn')).toBe(true);
    for (const kind of ['snake', 'knight', 'bishop', 'rook', 'queen', 'king', undefined]) {
      expect(isOrientationStateful(kind)).toBe(false);
    }
    const board = new RouteBoard(snapshot([unit('R', { x: 4, y: 4 }, { unitType: 'rook' })]));
    const space = board.searchSpaceFor(board.unitFor('R'));
    expect(space.nodeCount).toBe(W * H);
    expect(space.startNode(cell(3, 2))).toBe(cell(3, 2));
    expect(space.cellOf(cell(3, 2))).toBe(cell(3, 2));
  });

  test('a pawn gets one layer per orientation, its CURRENT facing first', () => {
    const orientation = { dx: 1, dy: 0 };
    const board = new RouteBoard(
      snapshot([unit('P', { x: 4, y: 4 }, { unitType: 'pawn', orientation })])
    );
    const space = board.searchSpaceFor(board.unitFor('P'));
    expect(space.nodeCount).toBe(W * H * legalOrientations('pawn').length);
    // State 0 is where the unit stands, so `startNode` is the plain cell index.
    expect(space.startNode(cell(4, 4))).toBe(cell(4, 4));
    expect(space.orientationOf(space.startNode(cell(4, 4)))).toEqual(orientation);
    // Every node decodes back to its cell, on every layer.
    for (let node = 0; node < space.nodeCount; node++) {
      expect(space.cellOf(node)).toBe(node % (W * H));
      expect(legalOrientations('pawn')).toContainEqual(space.orientationOf(node));
    }
  });

  test('a pawn’s quarter turns are edges that cost a turn and change no square', () => {
    const orientation = { dx: 1, dy: 0 };
    const board = new RouteBoard(
      snapshot([unit('P', { x: 4, y: 4 }, { unitType: 'pawn', orientation })])
    );
    const space = board.searchSpaceFor(board.unitFor('P'));
    const out = new Int32Array(space.neighborCapacity + 2);
    const n = space.fillNeighbors(space.startNode(cell(4, 4)), () => true, out);
    const neighbors = Array.from(out.slice(0, n));

    const turned = neighbors.filter((node) => space.cellOf(node) === cell(4, 4));
    expect(turned).toHaveLength(2);
    expect(turned.map((node) => space.orientationOf(node))).toEqual(
      quarterTurnsFrom(orientation)
    );
    // Moves are enumerated before turns, so among equal-length plans BFS keeps
    // the one that starts by actually going somewhere.
    expect(neighbors.indexOf(turned[0])).toBeGreaterThan(
      neighbors.findIndex((node) => space.cellOf(node) !== cell(4, 4))
    );
    // The one displacement is the forward step: full-board dx +1 is api x+1.
    const moved = neighbors.filter((node) => space.cellOf(node) !== cell(4, 4));
    expect(moved.map((node) => space.cellOf(node))).toEqual([cell(5, 4)]);
    expect(moved.map((node) => space.orientationOf(node))).toEqual([orientation]);
  });

  test('quarter turns are the perpendiculars, and carry no negative zero', () => {
    expect(quarterTurnsFrom({ dx: 0, dy: -1 })).toEqual([
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
    ]);
    expect(quarterTurnsFrom({ dx: 1, dy: 0 })).toEqual([
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ]);
    for (const o of legalOrientations('pawn' as UnitType)) {
      for (const t of quarterTurnsFrom(o)) {
        expect(Object.is(t.dx, -0)).toBe(false);
        expect(Object.is(t.dy, -0)).toBe(false);
        // Perpendicular, by construction. (The dot product of two axis
        // vectors can land on -0, which is 0 for every purpose but `Object.is`.)
        expect(t.dx * o.dx + t.dy * o.dy === 0).toBe(true);
      }
    }
  });
});

describe('fillNeighbors4', () => {
  test('enumerates +W, -W, -1, +1 in that order — BFS parents depend on it', () => {
    const out = new Int32Array(4);
    const n = fillNeighbors4(cell(4, 4), W, W * H, out);
    expect(Array.from(out.slice(0, n))).toEqual([
      cell(4, 5),
      cell(4, 3),
      cell(3, 4),
      cell(5, 4),
    ]);
  });

  test('clips at every edge, and never wraps a row', () => {
    const out = new Int32Array(4);
    expect(Array.from(out.slice(0, fillNeighbors4(cell(0, 0), W, W * H, out)))).toEqual([
      cell(0, 1),
      cell(1, 0),
    ]);
    expect(Array.from(out.slice(0, fillNeighbors4(cell(8, 8), W, W * H, out)))).toEqual([
      cell(8, 7),
      cell(7, 8),
    ]);
  });
});

describe('board bookkeeping', () => {
  test('an unknown unit routes as a trail unit — the safe default', () => {
    const board = new RouteBoard(snapshot([unit('S', { x: 4, y: 4 })]));
    expect(board.unitFor('nobody')).toBe(SNAKE_ROUTE_UNIT);
  });

  test('vacateTurns is the per-cell clock the passability reads', () => {
    const board = new RouteBoard(
      snapshot([unit('S', { x: 4, y: 4 }, { body: [
        { x: 4, y: 4 },
        { x: 4, y: 3 },
        { x: 4, y: 2 },
      ] })])
    );
    const vacate = board.vacateTurns();
    expect(vacate[cell(4, 2)]).toBe(1); // the tail, gone next turn
    expect(vacate[cell(4, 3)]).toBe(2);
    expect(vacate[cell(4, 4)]).toBe(0); // the head is not a segment
    expect(vacate[cell(0, 0)]).toBe(0);
  });

  test('geometry helpers agree with the api indexing every caller uses', () => {
    const board = new RouteBoard(snapshot([unit('S', { x: 4, y: 4 })]));
    expect(board.cellIndex(3, 2)).toBe(cell(3, 2));
    expect(board.cellIndexOf({ x: 3, y: 2 })).toBe(cell(3, 2));
    expect(board.isInBounds({ x: 0, y: 0 })).toBe(true);
    expect(board.isInBounds({ x: 9, y: 0 })).toBe(false);
    expect(board.isInBounds({ x: 0, y: -1 })).toBe(false);
    expect(board.turn).toBe(0);
    expect(board.cellCount).toBe(W * H);
  });
});
