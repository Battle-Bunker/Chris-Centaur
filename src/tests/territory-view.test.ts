/**
 * THE TERRITORY VIEW — the partition the interface draws.
 *
 * `logic/territory-view.ts` replaced a by-product. The Alt-click inspector and
 * the overlay used to be fed `multi-source-bfs`'s ownership planes, handed up
 * by `voronoi-strategy` on the way past the legacy decision path; when the
 * shipped decision path stopped being that one, the overlay went dark and
 * nothing in the suite noticed. This file is what would have noticed.
 *
 * Two things are pinned, and they are different in kind.
 *
 * THE SHAPE is a contract with the wire and the DB: `{ width, height, sources,
 * owner, distance, vacatesAt }` in api index order, which is the assertion
 * `unit-inspection.test.ts` makes downstream of here and what
 * `decision_logs.cell_ownership` stores.
 *
 * THE PARTITION is the claim the picture makes: one BFS level is one TURN of
 * the unit's OWN moves, so a rook's territory grows along its rays and a
 * knight's in L-jumps without either being special-cased — the frontier walks
 * `route.ts`'s per-unit search space, which is the vendored grammar. The
 * nearest unit owns a cell; a tie owns nothing, because a square two units
 * reach together is a square neither controls. Nothing here predicts what
 * would HAPPEN if both went: that is a contest and the engine owns it.
 *
 * Board: api 9x9 unless a test says otherwise.
 */

import {
  CellOwnership,
  OWNER_NEUTRAL,
  OWNER_UNREACHED,
  computeTerritoryView,
  territoryCellsOf,
} from '../logic/territory-view';
import { RouteBoard } from '../logic/route';
import type { BoardSnapshot, Coord, Snake } from '../types/battlesnake';

const W = 9;
const H = 9;
const cell = (x: number, y: number): number => y * W + x;

function unit(
  id: string,
  head: Coord,
  opts: {
    unitType?: string;
    orientation?: { dx: number; dy: number };
    body?: Coord[];
    health?: number;
  } = {}
): Snake {
  const isPiece = !!opts.unitType && opts.unitType !== 'snake';
  const body =
    opts.body ??
    (isPiece ? [head] : [head, { x: head.x, y: head.y - 1 }, { x: head.x, y: head.y - 2 }]);
  const s: Snake = {
    id,
    name: id,
    latency: '0',
    health: opts.health ?? 90,
    body,
    head,
    length: body.length,
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
  opts: { turn?: number; food?: Coord[]; hazards?: Coord[]; width?: number; height?: number } = {}
): BoardSnapshot {
  return {
    game: {
      id: 'territory-test',
      ruleset: { name: 'teamsnek', version: 'v1', settings: {} },
      map: 'standard',
      timeout: 500,
      source: 'test',
    },
    turn: opts.turn ?? 0,
    board: {
      width: opts.width ?? W,
      height: opts.height ?? H,
      food: opts.food ?? [],
      hazards: opts.hazards ?? [],
      snakes,
    },
  };
}

const ownerOf = (o: CellOwnership, id: string): number => o.sources.indexOf(id);

describe('the shape the interface and the log both read', () => {
  test('one entry per cell in api index order, on every plane', () => {
    const o = computeTerritoryView(snapshot([unit('S', { x: 4, y: 4 })]));
    expect(o.width).toBe(W);
    expect(o.height).toBe(H);
    expect(o.owner).toHaveLength(W * H);
    expect(o.distance).toHaveLength(W * H);
    expect(o.vacatesAt).toHaveLength(W * H);
    expect(o.sources).toEqual(['S']);
  });

  test('sources are every LIVING unit in board order, whatever their kind', () => {
    const o = computeTerritoryView(
      snapshot([
        unit('S', { x: 1, y: 1 }),
        unit('R', { x: 7, y: 7 }, { unitType: 'rook' }),
        unit('D', { x: 4, y: 0 }, { health: 0 }),
      ])
    );
    expect(o.sources).toEqual(['S', 'R']); // the corpse is not a source
  });

  test('a board with nobody on it partitions to nothing, and does not crash', () => {
    const o = computeTerritoryView(snapshot([]));
    expect(o.sources).toEqual([]);
    expect(new Set(o.owner)).toEqual(new Set([OWNER_UNREACHED]));
    expect(new Set(o.distance)).toEqual(new Set([-1]));
  });

  test('vacatesAt is the route board’s own clock, not a second one', () => {
    const state = snapshot([
      unit('S', { x: 4, y: 4 }, { body: [
        { x: 4, y: 4 },
        { x: 4, y: 3 },
        { x: 4, y: 2 },
      ] }),
    ]);
    expect(computeTerritoryView(state).vacatesAt).toEqual(new RouteBoard(state).vacateTurns());
  });

  test('a non-square board keeps its own dimensions', () => {
    const o = computeTerritoryView(
      snapshot([unit('S', { x: 2, y: 2 })], { width: 11, height: 7 })
    );
    expect([o.width, o.height]).toEqual([11, 7]);
    expect(o.owner).toHaveLength(11 * 7);
  });
});

describe('the partition', () => {
  test('a unit owns its own square at distance 0, and nobody contests it', () => {
    const o = computeTerritoryView(
      snapshot([unit('S', { x: 1, y: 1 }), unit('T', { x: 7, y: 7 })])
    );
    expect(o.owner[cell(1, 1)]).toBe(ownerOf(o, 'S'));
    expect(o.distance[cell(1, 1)]).toBe(0);
    expect(o.owner[cell(7, 7)]).toBe(ownerOf(o, 'T'));
    expect(o.distance[cell(7, 7)]).toBe(0);
  });

  test('alone on the board, a trail unit owns everything it can walk to, in steps', () => {
    const o = computeTerritoryView(snapshot([unit('S', { x: 4, y: 4 })]));
    const me = ownerOf(o, 'S');
    // Its own body is not walkable through, but everything else is.
    expect(o.owner[cell(3, 4)]).toBe(me);
    expect(o.distance[cell(3, 4)]).toBe(1);
    expect(o.distance[cell(2, 4)]).toBe(2);
    expect(o.distance[cell(0, 8)]).toBe(8); // manhattan, on an open board
  });

  test('DISTANCE is turns of the unit’s OWN moves: a rook takes its whole file in one', () => {
    const o = computeTerritoryView(snapshot([unit('R', { x: 4, y: 4 }, { unitType: 'rook' })]));
    const me = ownerOf(o, 'R');
    for (const c of [cell(4, 0), cell(4, 8), cell(0, 4), cell(8, 4)]) {
      expect(o.owner[c]).toBe(me);
      expect(o.distance[c]).toBe(1);
    }
    // Off the rays takes a second turn — one to the rank, one along the file.
    expect(o.distance[cell(0, 0)]).toBe(2);
    expect(o.distance[cell(7, 2)]).toBe(2);
  });

  test('a knight’s territory grows in L-jumps, from the same loop', () => {
    const o = computeTerritoryView(snapshot([unit('N', { x: 4, y: 4 }, { unitType: 'knight' })]));
    expect(o.distance[cell(5, 6)]).toBe(1);
    expect(o.distance[cell(6, 5)]).toBe(1);
    // An orthogonal neighbour is THREE knight moves away, not one.
    expect(o.distance[cell(4, 5)]).toBe(3);
  });

  test('a tie owns nothing: the midline between two equal units is neutral', () => {
    // Two trail units facing each other across an odd gap, so a whole column
    // is reached by both on the same turn.
    const o = computeTerritoryView(
      snapshot([
        unit('L', { x: 0, y: 4 }, { body: [{ x: 0, y: 4 }] }),
        unit('R', { x: 8, y: 4 }, { body: [{ x: 8, y: 4 }] }),
      ])
    );
    expect(o.owner[cell(4, 4)]).toBe(OWNER_NEUTRAL);
    // A tie still carries the distance: it is how far the arrival was, and the
    // inspector says "both reach this in 4" rather than "unknown".
    expect(o.distance[cell(4, 4)]).toBe(4);
    expect(o.owner[cell(3, 4)]).toBe(ownerOf(o, 'L'));
    expect(o.owner[cell(5, 4)]).toBe(ownerOf(o, 'R'));
  });

  test('the nearer unit takes the cell outright — proximity, not strength', () => {
    // A pawn is the weakest thing on the board and still owns what it is
    // closest to: this map partitions distance and adjudicates nothing.
    const o = computeTerritoryView(
      snapshot([
        unit('P', { x: 1, y: 1 }, { unitType: 'pawn', orientation: { dx: 1, dy: 0 } }),
        unit('Q', { x: 8, y: 8 }, { unitType: 'queen' }),
      ])
    );
    expect(o.owner[cell(1, 1)]).toBe(ownerOf(o, 'P'));
    expect(o.owner[cell(2, 1)]).toBe(ownerOf(o, 'P')); // one pawn step forward
  });

  test('a distance is present exactly where something arrived — UNREACHED alone has none', () => {
    // The three states are distinct and the two planes agree on which is
    // which: owned and neutral cells were both REACHED (on the turn recorded),
    // and only a cell nothing got to carries no arrival at all.
    const o = computeTerritoryView(
      snapshot(
        [unit('S', { x: 1, y: 1 }), unit('R', { x: 7, y: 7 }, { unitType: 'rook' })],
        { hazards: [{ x: 4, y: 4 }] }
      )
    );
    let unreached = 0;
    o.owner.forEach((owner, idx) => {
      if (owner === OWNER_UNREACHED) {
        unreached++;
        expect(o.distance[idx]).toBe(-1);
      } else {
        expect(o.distance[idx]).toBeGreaterThanOrEqual(0);
      }
    });
    expect(unreached).toBeGreaterThan(0); // the hazard, at least
  });

  test('a cell nothing can reach stays UNREACHED, distinct from a tie', () => {
    // A hazard is closed to routing, so a unit sealed behind hazards in the
    // corner reaches nothing but its own square.
    const o = computeTerritoryView(
      snapshot([unit('S', { x: 0, y: 0 }, { body: [{ x: 0, y: 0 }] })], {
        hazards: [{ x: 1, y: 0 }, { x: 0, y: 1 }],
      })
    );
    expect(o.owner[cell(0, 0)]).toBe(ownerOf(o, 'S'));
    expect(o.owner[cell(1, 0)]).toBe(OWNER_UNREACHED);
    expect(o.owner[cell(4, 4)]).toBe(OWNER_UNREACHED);
    expect(o.distance[cell(4, 4)]).toBe(-1);
  });

  test('another unit’s piece square is nobody’s to route through, so it is not owned', () => {
    const o = computeTerritoryView(
      snapshot([
        unit('S', { x: 4, y: 4 }),
        unit('B', { x: 4, y: 6 }, { unitType: 'bishop' }),
      ])
    );
    // The bishop owns its own square at 0; the snake cannot claim it.
    expect(o.owner[cell(4, 6)]).toBe(ownerOf(o, 'B'));
    expect(o.distance[cell(4, 6)]).toBe(0);
  });
});

describe('territoryCellsOf', () => {
  test('lists every owned cell under its owner, and nothing else', () => {
    const o = computeTerritoryView(
      snapshot([
        unit('L', { x: 0, y: 4 }, { body: [{ x: 0, y: 4 }] }),
        unit('R', { x: 8, y: 4 }, { body: [{ x: 8, y: 4 }] }),
      ])
    );
    const cells = territoryCellsOf(o);
    expect(Object.keys(cells).sort()).toEqual(['L', 'R']);

    const owned = o.owner.filter((x) => x >= 0).length;
    expect(cells.L.length + cells.R.length).toBe(owned);
    // Neutral and unreached cells appear in no list at all.
    for (const [id, list] of Object.entries(cells)) {
      for (const c of list) expect(o.owner[cell(c.x, c.y)]).toBe(ownerOf(o, id));
    }
    expect(cells.L).toContainEqual({ x: 0, y: 4 });
    expect(cells.L).not.toContainEqual({ x: 4, y: 4 }); // the neutral midline
  });

  test('a unit that owns nothing but its square still gets an (almost) empty list', () => {
    const o = computeTerritoryView(
      snapshot([unit('S', { x: 0, y: 0 }, { body: [{ x: 0, y: 0 }] })], {
        hazards: [{ x: 1, y: 0 }, { x: 0, y: 1 }],
      })
    );
    expect(territoryCellsOf(o)).toEqual({ S: [{ x: 0, y: 0 }] });
  });

  test('an empty board yields an empty map, not a crash', () => {
    expect(territoryCellsOf(computeTerritoryView(snapshot([])))).toEqual({});
  });
});
