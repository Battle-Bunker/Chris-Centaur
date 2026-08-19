/**
 * Tests for BoardGraph's adjacency:
 *  - the lazily-built static adjacency table (CSR), the shared
 *    neighbor-iteration resource for heuristics that don't need turn-aware
 *    passability;
 *  - `fillUnitNeighbors`, the per-unit adjacency root every search enumerates
 *    through: snake steps, knight L-jumps, king steps, slider rays that stop
 *    at the first impassable square (which is still offered), and the pawn's
 *    forward-only step;
 *  - `searchSpaceFor`, that root lifted to (cell, orientation) nodes: a
 *    degenerate one-state passthrough for every orientation-invariant unit,
 *    and a layered space with quarter-turn edges for the pawn.
 */

import { BoardGraph, SNAKE_ADJACENCY, UnitAdjacency, isOrientationStateful, quarterTurnsFrom } from '../logic/board-graph';
import { GameState, Snake, Coord } from '../types/battlesnake';

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    orientation: { dx: 0, dy: -1 },
    id,
    name: id,
    health: 100,
    body,
    head: body[0],
    length: body.length,
    latency: '0',
    shout: '',
    squad: '',
    customizations: { color: '#888888', head: 'default', tail: 'default' },
    ...extra,
  };
}

function makeState(snakeBody: Coord[], width = 7, height = 7): GameState {
  const snake = makeSnake('s1', snakeBody);
  return {
    game: { id: 'adj-test', ruleset: { name: 'standard', version: '1', settings: {} }, timeout: 500, source: 'test', map: 'standard' },
    turn: 5,
    board: { width, height, snakes: [snake], food: [], hazards: [] },
    you: snake,
  };
}

describe('BoardGraph static adjacency', () => {
  const body: Coord[] = [
    { x: 3, y: 3 },  // head (not a segment — heads don't block)
    { x: 3, y: 2 },  // interior — statically blocked
    { x: 3, y: 1 },  // tail — vacates next turn (grow-next-turn), not blocked
  ];
  const graph = new BoardGraph(makeState(body));

  test('open cell lists exactly its in-bounds passable neighbors', () => {
    // Corner (0,0): two in-bounds neighbors, both open.
    const corner = Array.from(graph.staticNeighborsOf(graph.cellIndex(0, 0))).sort((a, b) => a - b);
    expect(corner).toEqual([graph.cellIndex(1, 0), graph.cellIndex(0, 1)].sort((a, b) => a - b));

    // Mid-board open cell: four neighbors.
    expect(graph.staticNeighborsOf(graph.cellIndex(5, 5)).length).toBe(4);
  });

  test('blocked segments are excluded as destinations and have no origin list', () => {
    const interiorIdx = graph.cellIndex(3, 2);
    // The blocked interior segment is not a usable origin.
    expect(graph.staticNeighborsOf(interiorIdx).length).toBe(0);
    // ...and no open neighbor lists it as a destination.
    for (const openNeighbor of [graph.cellIndex(2, 2), graph.cellIndex(4, 2)]) {
      expect(Array.from(graph.staticNeighborsOf(openNeighbor))).not.toContain(interiorIdx);
    }
  });

  test('the vacating tail is passable, matching isPassableStaticIdx', () => {
    const tailIdx = graph.cellIndex(3, 1);
    expect(graph.isPassableStaticIdx(tailIdx)).toBe(true);
    expect(Array.from(graph.staticNeighborsOf(graph.cellIndex(2, 1)))).toContain(tailIdx);
  });

  test('the CSR table is the snake-step adjacency, cell for cell', () => {
    const open = () => true;
    const buf = graph.neighborBuffer();
    for (let idx = 0; idx < graph.cellCount; idx++) {
      if (!graph.isPassableStaticIdx(idx)) continue;
      const listed = Array.from(graph.staticNeighborsOf(idx));
      const n = graph.fillUnitNeighbors(SNAKE_ADJACENCY, idx, open, buf);
      expect(listed).toEqual(
        Array.from(buf.subarray(0, n)).filter(c => graph.isPassableStaticIdx(c))
      );
    }
  });

  test('adjacency agrees with isPassableStaticIdx across the whole board', () => {
    for (let idx = 0; idx < graph.cellCount; idx++) {
      const listed = new Set(graph.staticNeighborsOf(idx));
      if (!graph.isPassableStaticIdx(idx)) {
        expect(listed.size).toBe(0);
        continue;
      }
      const x = idx % graph.boardWidth;
      const y = Math.floor(idx / graph.boardWidth);
      for (const [nx, ny] of [[x, y + 1], [x, y - 1], [x - 1, y], [x + 1, y]]) {
        if (!graph.isInBounds({ x: nx, y: ny })) continue;
        const n = graph.cellIndex(nx, ny);
        expect(listed.has(n)).toBe(graph.isPassableStaticIdx(n));
      }
    }
  });
});

describe('BoardGraph per-unit adjacency (fillUnitNeighbors)', () => {
  // An 11x11 board holding one unit per test, always mid-board at (5,5).
  function pieceState(unit: Snake, others: Snake[] = []): GameState {
    return {
      game: { id: 'unit-adj', ruleset: { name: 'teamsnek', version: 'v1', settings: {} }, timeout: 500, source: 'test', map: 'standard' },
      turn: 5,
      board: { width: 11, height: 11, snakes: [unit, ...others], food: [], hazards: [] },
      you: unit,
    };
  }

  function piece(id: string, square: Coord, unitType: string, orientation = { dx: 0, dy: -1 }): Snake {
    return makeSnake(id, [square], { unitType, orientation, length: 1 });
  }

  /** Every cell `unit` reaches in one move from `from`, as api coords, sorted. */
  function neighbors(graph: BoardGraph, unit: UnitAdjacency, from: Coord, passable: (c: number) => boolean = () => true): Coord[] {
    const buf = graph.neighborBuffer();
    const n = graph.fillUnitNeighbors(unit, graph.cellIndexOf(from), passable, buf);
    return Array.from(buf.subarray(0, n))
      .map(c => ({ x: graph.xOf(c), y: graph.yOf(c) }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }

  const HERE = { x: 5, y: 5 };

  test('a snake steps to its four orthogonal neighbors', () => {
    const graph = new BoardGraph(pieceState(makeSnake('s', [HERE, { x: 5, y: 4 }])));
    expect(neighbors(graph, graph.unitAdjacencyFor('s'), HERE)).toEqual([
      { x: 5, y: 4 }, { x: 4, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 },
    ]);
  });

  test('a knight jumps the 8 L-offsets and nothing in between', () => {
    const graph = new BoardGraph(pieceState(piece('n', HERE, 'knight')));
    expect(neighbors(graph, graph.unitAdjacencyFor('n'), HERE)).toEqual([
      { x: 4, y: 3 }, { x: 6, y: 3 },
      { x: 3, y: 4 }, { x: 7, y: 4 },
      { x: 3, y: 6 }, { x: 7, y: 6 },
      { x: 4, y: 7 }, { x: 6, y: 7 },
    ]);
  });

  test('a king steps to the 8 surrounding squares', () => {
    const graph = new BoardGraph(pieceState(piece('k', HERE, 'king')));
    expect(neighbors(graph, graph.unitAdjacencyFor('k'), HERE)).toHaveLength(8);
    expect(neighbors(graph, graph.unitAdjacencyFor('k'), HERE)).toContainEqual({ x: 6, y: 6 });
  });

  test('a rook reaches every square on its rank and file — one graph edge each', () => {
    const graph = new BoardGraph(pieceState(piece('r', HERE, 'rook')));
    const reach = neighbors(graph, graph.unitAdjacencyFor('r'), HERE);
    expect(reach).toHaveLength(20); // 10 file + 10 rank on an 11x11 board
    expect(reach).toContainEqual({ x: 5, y: 10 });
    expect(reach).toContainEqual({ x: 0, y: 5 });
    expect(reach).not.toContainEqual({ x: 6, y: 6 });
  });

  test('a bishop reaches its diagonals only; a queen reaches both', () => {
    const graph = new BoardGraph(pieceState(piece('b', HERE, 'bishop'), [piece('q', { x: 0, y: 0 }, 'queen')]));
    const bishop = neighbors(graph, graph.unitAdjacencyFor('b'), HERE);
    expect(bishop).toContainEqual({ x: 10, y: 10 });
    expect(bishop).not.toContainEqual({ x: 5, y: 10 });
    const queen = neighbors(graph, { unitType: 'queen', orientation: { dx: 0, dy: -1 } }, HERE);
    expect(queen).toEqual(expect.arrayContaining(bishop));
    expect(queen).toContainEqual({ x: 5, y: 10 });
  });

  test('a ray stops AT the first impassable square, which is still offered', () => {
    const graph = new BoardGraph(pieceState(piece('r', HERE, 'rook')));
    const blocked = graph.cellIndexOf({ x: 5, y: 8 });
    const reach = neighbors(graph, graph.unitAdjacencyFor('r'), HERE, c => c !== blocked);
    // Up the file: (5,6), (5,7) and the blocker itself — nothing beyond it.
    expect(reach).toContainEqual({ x: 5, y: 8 });
    expect(reach).not.toContainEqual({ x: 5, y: 9 });
    expect(reach).not.toContainEqual({ x: 5, y: 10 });
    // The other three rays are untouched.
    expect(reach).toContainEqual({ x: 5, y: 0 });
  });

  test('a pawn contributes only its forward step (rotations displace it nowhere)', () => {
    // Wire orientation +x (y grows downward on the wire) faces api +x.
    const graph = new BoardGraph(pieceState(piece('p', HERE, 'pawn', { dx: 1, dy: 0 })));
    expect(neighbors(graph, graph.unitAdjacencyFor('p'), HERE)).toEqual([{ x: 6, y: 5 }]);

    // Wire dy -1 faces api +y — the orientation is what the step follows.
    const up = new BoardGraph(pieceState(piece('p', HERE, 'pawn', { dx: 0, dy: -1 })));
    expect(neighbors(up, up.unitAdjacencyFor('p'), HERE)).toEqual([{ x: 5, y: 6 }]);
  });

  test('rays and jumps stop at the board edge, never wrapping a row', () => {
    const corner = { x: 0, y: 0 };
    const graph = new BoardGraph(pieceState(piece('n', corner, 'knight')));
    expect(neighbors(graph, graph.unitAdjacencyFor('n'), corner)).toEqual([
      { x: 2, y: 1 }, { x: 1, y: 2 },
    ]);
    const king = new BoardGraph(pieceState(piece('k', corner, 'king')));
    expect(neighbors(king, king.unitAdjacencyFor('k'), corner)).toEqual([
      { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 },
    ]);
  });

  test('an unknown id falls back to snake steps rather than throwing', () => {
    const graph = new BoardGraph(pieceState(piece('n', HERE, 'knight')));
    expect(graph.unitAdjacencyFor('nobody')).toBe(SNAKE_ADJACENCY);
    expect(neighbors(graph, graph.unitAdjacencyFor('nobody'), HERE)).toHaveLength(4);
  });

  describe('BoardGraph per-unit search space', () => {
    const HERE = { x: 5, y: 5 };

    /** Every node `unit` reaches in one TURN from `from`, as (cell, orientation). */
    function nodes(graph: BoardGraph, unit: UnitAdjacency, from: Coord) {
      const space = graph.searchSpaceFor(unit);
      const buf = new Int32Array(space.neighborCapacity);
      const n = space.fillNeighbors(space.startNode(graph.cellIndexOf(from)), () => true, buf);
      return Array.from(buf.subarray(0, n)).map(node => {
        const cell = space.cellOf(node);
        return { x: graph.xOf(cell), y: graph.yOf(cell), orientation: space.orientationOf(node) };
      });
    }

    test('only the pawn is orientation-stateful; everything else collapses to one state', () => {
      expect(isOrientationStateful('pawn')).toBe(true);
      for (const type of ['snake', 'rook', 'bishop', 'queen', 'king', 'knight', undefined]) {
        expect(isOrientationStateful(type)).toBe(false);
      }
    });

    test('an orientation-invariant unit gets a one-state space whose nodes ARE its cells', () => {
      const graph = new BoardGraph(pieceState(piece('r', HERE, 'rook')));
      const space = graph.searchSpaceFor(graph.unitAdjacencyFor('r'));
      expect(space.nodeCount).toBe(graph.cellCount);
      const cell = graph.cellIndexOf(HERE);
      expect(space.startNode(cell)).toBe(cell);
      expect(space.cellOf(cell)).toBe(cell);
      // Identical edges to fillUnitNeighbors — the passthrough changes nothing.
      expect(
        nodes(graph, graph.unitAdjacencyFor('r'), HERE)
          .map(n => ({ x: n.x, y: n.y }))
          .sort((a, b) => a.y - b.y || a.x - b.x)
      ).toEqual(neighbors(graph, graph.unitAdjacencyFor('r'), HERE));
    });

    test('a pawn gets one layer per orientation, with quarter turns as ordinary edges', () => {
      // Wire dy -1 faces api +y; its quarter turns are api +x and api -x.
      const graph = new BoardGraph(pieceState(piece('p', HERE, 'pawn', { dx: 0, dy: -1 })));
      const space = graph.searchSpaceFor(graph.unitAdjacencyFor('p'));
      expect(space.nodeCount).toBe(graph.cellCount * 4);
      // The unit's CURRENT orientation is state 0, so its start node is the cell.
      expect(space.startNode(graph.cellIndexOf(HERE))).toBe(graph.cellIndexOf(HERE));

      const reach = nodes(graph, graph.unitAdjacencyFor('p'), HERE);
      // One forward step, then the two quarter turns — same square, new facing.
      expect(reach).toEqual([
        { x: 5, y: 6, orientation: { dx: 0, dy: -1 } },
        { x: 5, y: 5, orientation: { dx: 1, dy: 0 } },
        { x: 5, y: 5, orientation: { dx: -1, dy: 0 } },
      ]);
      expect(quarterTurnsFrom({ dx: 0, dy: -1 })).toEqual([{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }]);
    });

    test('a pawn layer steps the way that layer faces, not the way the unit does now', () => {
      const graph = new BoardGraph(pieceState(piece('p', HERE, 'pawn', { dx: 0, dy: -1 })));
      const space = graph.searchSpaceFor(graph.unitAdjacencyFor('p'));
      const buf = new Int32Array(space.neighborCapacity);
      // Take the api +x layer (a quarter turn from the start) and step from it.
      const turned = Array.from(
        buf.subarray(0, space.fillNeighbors(space.startNode(graph.cellIndexOf(HERE)), () => true, buf))
      ).find(node => space.orientationOf(node).dx === 1)!;
      const n = space.fillNeighbors(turned, () => true, buf);
      const stepped = Array.from(buf.subarray(0, n)).filter(node => space.cellOf(node) !== space.cellOf(turned));
      expect(stepped).toHaveLength(1);
      expect(graph.xOf(space.cellOf(stepped[0]))).toBe(6);
      expect(graph.yOf(space.cellOf(stepped[0]))).toBe(5);
    });
  });
});
