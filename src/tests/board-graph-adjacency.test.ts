/**
 * Tests for the lazily-built static adjacency table (CSR): the shared
 * neighbor-iteration resource for heuristics that don't need turn-aware
 * passability.
 */

import { BoardGraph } from '../logic/board-graph';
import { GameState, Snake, Coord } from '../types/battlesnake';

function makeState(snakeBody: Coord[], width = 7, height = 7): GameState {
  const snake: Snake = {
    orientation: { dx: 0, dy: -1 },
    id: 's1',
    name: 's1',
    health: 100,
    body: snakeBody,
    head: snakeBody[0],
    length: snakeBody.length,
    latency: '0',
    shout: '',
    squad: '',
    customizations: { color: '#888888', head: 'default', tail: 'default' },
  };
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
