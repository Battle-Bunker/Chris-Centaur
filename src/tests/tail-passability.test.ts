/**
 * Tests for tail-vacate edge cases in BoardGraph passability.
 *
 * Regression coverage for: a length-2 snake's tail must NOT be unconditionally
 * blocked — the tail vacates on the next move just like any other snake unless
 * the snake just ate or the last two body coords are stacked.
 */

import { BoardGraph } from '../logic/board-graph';
import { MoveAnalyzer } from '../logic/move-analyzer';
import { GameState, Snake, Coord } from '../types/battlesnake';

function makeSnake(overrides: Partial<Snake> & Pick<Snake, 'id' | 'body' | 'head'>): Snake {
  return {
    name: overrides.name ?? overrides.id,
    health: overrides.health ?? 100,
    length: overrides.length ?? overrides.body.length,
    latency: overrides.latency ?? '50',
    shout: overrides.shout ?? '',
    squad: overrides.squad ?? '',
    customizations: overrides.customizations ?? { color: '#FFD700', head: 'default', tail: 'default' },
    ...overrides,
  } as Snake;
}

function makeGameState(snakes: Snake[], food: Coord[] = [], width = 11, height = 11): GameState {
  return {
    game: { id: 'test', ruleset: { name: 'standard', version: '1', settings: {} }, timeout: 500, source: 'test', map: 'standard' },
    turn: 1,
    board: { width, height, snakes, food, hazards: [] },
    you: snakes[0],
  } as GameState;
}

describe('Tail passability edge cases', () => {
  test('length-2 snake tail is treated as passable (tail will vacate)', () => {
    // Length-2 enemy whose tail (the cell immediately right of us) vacates
    // on the next move — chasing into it must be allowed.
    const us = makeSnake({ id: 'us', body: [{ x: 1, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 4 }], head: { x: 1, y: 5 } });
    const enemy = makeSnake({
      id: 'enemy',
      body: [{ x: 3, y: 5 }, { x: 2, y: 5 }],
      head: { x: 3, y: 5 },
    });
    const gs = makeGameState([us, enemy]);
    const graph = new BoardGraph(gs);
    const analyzer = new MoveAnalyzer();
    const reasons = analyzer.classifyAllDirections(us, gs, graph);

    expect(reasons.get('right')).toBe('safe');
  });

  test('length-2 snake that just ate has a blocked tail', () => {
    // Enemy's head sits on food → it just ate, so its tail does NOT vacate.
    const us = makeSnake({ id: 'us', body: [{ x: 1, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 4 }], head: { x: 1, y: 5 } });
    const enemy = makeSnake({
      id: 'enemy',
      body: [{ x: 3, y: 5 }, { x: 2, y: 5 }],
      head: { x: 3, y: 5 },
    });
    const gs = makeGameState([us, enemy], [{ x: 3, y: 5 }]);
    const graph = new BoardGraph(gs);
    const analyzer = new MoveAnalyzer();
    const reasons = analyzer.classifyAllDirections(us, gs, graph);

    // 'right' → (2,5) is enemy tail; enemy just ate so tail stays.
    expect(reasons.get('right')).not.toBe('safe');
  });

  test('snake with stacked tail (last two body coords equal) has a blocked tail', () => {
    const us = makeSnake({ id: 'us', body: [{ x: 1, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 4 }], head: { x: 1, y: 5 } });
    const enemy = makeSnake({
      id: 'enemy',
      // Stacked tail: last two segments overlap at (2,5).
      body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }, { x: 2, y: 5 }],
      head: { x: 4, y: 5 },
    });
    const gs = makeGameState([us, enemy]);
    const graph = new BoardGraph(gs);
    const analyzer = new MoveAnalyzer();
    const reasons = analyzer.classifyAllDirections(us, gs, graph);

    // Tail at (2,5) won't vacate — chasing into it is unsafe.
    expect(reasons.get('right')).not.toBe('safe');
  });

  test('normal length-3 snake tail is passable', () => {
    const us = makeSnake({ id: 'us', body: [{ x: 1, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 4 }], head: { x: 1, y: 5 } });
    const enemy = makeSnake({
      id: 'enemy',
      body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
      head: { x: 4, y: 5 },
    });
    const gs = makeGameState([us, enemy]);
    const graph = new BoardGraph(gs);
    const analyzer = new MoveAnalyzer();
    const reasons = analyzer.classifyAllDirections(us, gs, graph);

    // Tail at (2,5) vacates next turn — chasing it is fine.
    expect(reasons.get('right')).toBe('safe');
  });
});
