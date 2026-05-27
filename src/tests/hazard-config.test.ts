/**
 * Tests for the configurable `hazardDamagePerTurn` and `maxHealth` game-rules.
 *
 * Covers:
 *   - BoardGraph floodfill / passability respects the configured hazard
 *     lethality threshold (Team Snek default: instant kill).
 *   - MoveAnalyzer classifies hazard-only moves as `'hazard'` under default
 *     config and `'safe'` under royale-style config.
 *   - Simulator deducts the configured damage and resets to the configured
 *     max health when eating.
 */

import { BoardGraph } from '../logic/board-graph';
import { MoveAnalyzer } from '../logic/move-analyzer';
import { Simulator, MoveSet } from '../logic/simulator';
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

function makeGameState(
  snakes: Snake[],
  food: Coord[] = [],
  hazards: Coord[] = [],
  width = 11,
  height = 11
): GameState {
  return {
    game: { id: 'test', ruleset: { name: 'standard', version: '1', settings: {} }, timeout: 500, source: 'test', map: 'standard' },
    turn: 1,
    board: { width, height, snakes, food, hazards },
    you: snakes[0],
  } as GameState;
}

describe('Hazard damage and max health config', () => {
  describe('BoardGraph floodfill respects hazard lethality', () => {
    test('hazard cells are blocked when damage >= current health', () => {
      // Snake at (5,5) with full health 100.
      // (6,5) is a hazard. Default hazardDamagePerTurn = 100 → instant kill.
      const us = makeSnake({
        id: 'us',
        body: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
        head: { x: 5, y: 5 },
        health: 100,
      });
      const gs = makeGameState([us], [], [{ x: 6, y: 5 }]);

      const graph = new BoardGraph(gs);

      expect(graph.isHazard({ x: 6, y: 5 })).toBe(true);
      // 100 damage >= 100 health → hazard cell is impassable.
      expect(graph.isPassable({ x: 6, y: 5 })).toBe(false);
    });

    test('hazard cells are passable when damage is below current health (royale-style)', () => {
      const us = makeSnake({
        id: 'us',
        body: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
        head: { x: 5, y: 5 },
        health: 100,
      });
      const gs = makeGameState([us], [], [{ x: 6, y: 5 }]);

      const graph = new BoardGraph(gs, { hazardDamagePerTurn: 15, maxHealth: 100 });

      expect(graph.isHazard({ x: 6, y: 5 })).toBe(true);
      // 15 damage < 100 health → hazard cell is passable but still tracked.
      expect(graph.isPassable({ x: 6, y: 5 })).toBe(true);
    });

    test('hazard-walled pocket is unreachable under default config', () => {
      // Build a 3x3 pocket fully surrounded by hazards. Under the default
      // (hazardDamagePerTurn=100), no neighbour of the hazard wall is reachable
      // from outside without stepping through a hazard cell.
      const us = makeSnake({
        id: 'us',
        body: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }],
        head: { x: 0, y: 0 },
        health: 100,
      });
      const hazards: Coord[] = [];
      // Wall at x=4 from y=4..7; x=8 same; y=4 from x=4..8; y=7 from x=4..8
      for (let y = 4; y <= 7; y++) {
        hazards.push({ x: 4, y });
        hazards.push({ x: 8, y });
      }
      for (let x = 5; x <= 7; x++) {
        hazards.push({ x, y: 4 });
        hazards.push({ x, y: 7 });
      }
      const gs = makeGameState([us], [], hazards);

      const defaultGraph = new BoardGraph(gs);
      // Cells inside the hazard ring should not be reachable from the head.
      // Run a BFS from head using passable neighbors only.
      const reachable = new Set<string>();
      const queue: Coord[] = [us.head];
      reachable.add(`${us.head.x},${us.head.y}`);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const n of defaultGraph.getNeighbors(cur)) {
          const key = `${n.x},${n.y}`;
          if (reachable.has(key)) continue;
          reachable.add(key);
          queue.push(n);
        }
      }
      // Inner cell (6,6) must be unreachable.
      expect(reachable.has('6,6')).toBe(false);

      // Same map under royale-style config (low damage) → pocket is reachable.
      const royaleGraph = new BoardGraph(gs, { hazardDamagePerTurn: 15, maxHealth: 100 });
      const reachable2 = new Set<string>();
      const queue2: Coord[] = [us.head];
      reachable2.add(`${us.head.x},${us.head.y}`);
      while (queue2.length > 0) {
        const cur = queue2.shift()!;
        for (const n of royaleGraph.getNeighbors(cur)) {
          const key = `${n.x},${n.y}`;
          if (reachable2.has(key)) continue;
          reachable2.add(key);
          queue2.push(n);
        }
      }
      expect(reachable2.has('6,6')).toBe(true);
    });
  });

  describe('MoveAnalyzer classification under hazard config', () => {
    test('hazard-only destination is classified as `hazard` under default config', () => {
      // Snake at (5,5). Cell (6,5) is a hazard, all other neighbors are safe.
      const us = makeSnake({
        id: 'us',
        body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }],
        head: { x: 5, y: 5 },
        health: 50,
      });
      const gs = makeGameState([us], [], [{ x: 6, y: 5 }]);
      const graph = new BoardGraph(gs);
      const analyzer = new MoveAnalyzer();
      const reasons = analyzer.classifyAllDirections(us, gs, graph);

      expect(reasons.get('right')).toBe('hazard');
      expect(reasons.get('left')).toBe('safe');
      expect(reasons.get('up')).toBe('safe');
    });

    test('hazard-only destination is classified as `safe` under low-damage config', () => {
      const us = makeSnake({
        id: 'us',
        body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }],
        head: { x: 5, y: 5 },
        health: 100,
      });
      const gs = makeGameState([us], [], [{ x: 6, y: 5 }]);
      const graph = new BoardGraph(gs, { hazardDamagePerTurn: 15, maxHealth: 100 });
      const analyzer = new MoveAnalyzer();
      const reasons = analyzer.classifyAllDirections(us, gs, graph);

      expect(reasons.get('right')).toBe('safe');
    });
  });

  describe('Simulator applies configured hazard damage and max health', () => {
    test('default config (hazardDamagePerTurn=100) kills snake stepping onto hazard', () => {
      const us = makeSnake({
        id: 'us',
        body: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
        head: { x: 5, y: 5 },
        health: 100,
      });
      const gs = makeGameState([us], [], [{ x: 6, y: 5 }]);
      const sim = new Simulator(); // defaults: 100 damage / 100 max health

      const moves: MoveSet = new Map([['us', 'right']]);
      const result = sim.simulateNextBoardState(gs, moves);

      expect(result.deadSnakeIds.has('us')).toBe(true);
    });

    test('royale-style config (hazardDamagePerTurn=15) deducts 15 from current health', () => {
      const us = makeSnake({
        id: 'us',
        body: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
        head: { x: 5, y: 5 },
        health: 100,
      });
      const gs = makeGameState([us], [], [{ x: 6, y: 5 }]);
      const sim = new Simulator({ hazardDamagePerTurn: 15, maxHealth: 100 });

      const moves: MoveSet = new Map([['us', 'right']]);
      const result = sim.simulateNextBoardState(gs, moves);

      expect(result.deadSnakeIds.has('us')).toBe(false);
      const survivor = result.board.snakes.find(s => s.id === 'us')!;
      // Started with 100, -1 for the move, -15 for the hazard.
      expect(survivor.health).toBe(100 - 1 - 15);
    });

    test('eating restores health to configured maxHealth', () => {
      const us = makeSnake({
        id: 'us',
        body: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
        head: { x: 5, y: 5 },
        health: 50,
      });
      // Food at the new head position.
      const gs = makeGameState([us], [{ x: 6, y: 5 }]);
      const sim = new Simulator({ hazardDamagePerTurn: 100, maxHealth: 150 });

      const moves: MoveSet = new Map([['us', 'right']]);
      const result = sim.simulateNextBoardState(gs, moves);

      const survivor = result.board.snakes.find(s => s.id === 'us')!;
      expect(survivor.health).toBe(150);
    });

    test('default simulator resets health to 100 (Team Snek max) on food', () => {
      const us = makeSnake({
        id: 'us',
        body: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
        head: { x: 5, y: 5 },
        health: 30,
      });
      const gs = makeGameState([us], [{ x: 6, y: 5 }]);
      const sim = new Simulator();

      const moves: MoveSet = new Map([['us', 'right']]);
      const result = sim.simulateNextBoardState(gs, moves);

      const survivor = result.board.snakes.find(s => s.id === 'us')!;
      expect(survivor.health).toBe(100);
    });
  });
});
