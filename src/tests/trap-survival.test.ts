/**
 * Regression tests for fatal dead-end-pocket survival.
 *
 * These cover the bug where the bot would drive into a clearly-fatal pocket
 * (a cell that is legal to step into this turn but leaves no survivable space
 * next turn) instead of an available safe move. The fix introduces:
 *  - a survival-aware reachable-region computation with a checkerboard parity
 *    bound so a true dead-end is never scored as "enough space";
 *  - a `trapped` heuristic (1 = fatal pocket) with a strongly-negative weight;
 *  - a candidate-level veto in the decision engine that refuses a fatal pocket
 *    whenever a non-fatal alternative exists.
 */

import { BoardEvaluator } from '../logic/board-evaluator';
import { DecisionEngine } from '../logic/decision-engine';
import { BoardGraph } from '../logic/board-graph';
import { GameState, Snake, Coord } from '../types/battlesnake';

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    health: 100,
    body,
    head: body[0],
    length: body.length,
    latency: '0',
    shout: '',
    squad: '',
    customizations: { color: '#FF0000', head: 'default', tail: 'default' },
    ...extra
  };
}

function makeGameState(snakes: Snake[], you: Snake, food: Coord[] = []): GameState {
  return {
    game: {
      id: 'test',
      ruleset: { name: 'standard', version: '1', settings: {} },
      timeout: 500,
      source: 'test',
      map: 'standard'
    },
    turn: 10,
    board: {
      width: 11,
      height: 11,
      snakes,
      food,
      hazards: []
    },
    you
  };
}

describe('Trap survival', () => {
  describe('trapped heuristic stat', () => {
    it('is 0 for a snake in open space', () => {
      const evaluator = new BoardEvaluator();
      const snake = makeSnake('our-snake', [
        { x: 5, y: 5 },
        { x: 5, y: 4 },
        { x: 5, y: 3 }
      ]);
      const gameState = makeGameState([snake], snake);

      const result = evaluator.evaluateBoard(gameState, 'our-snake', new Set(['our-snake']));

      expect(result.stats.trapped).toBe(0);
      expect(result.stats.selfEnoughSpace).toBeGreaterThanOrEqual(3);
    });

    it('is 1 for a snake sealed inside a box it cannot escape or tail-chase out of', () => {
      const evaluator = new BoardEvaluator();
      // Length-11 snake coiled into a closed box: head has no escape and the
      // tail cannot be reached, so this is a fatal pocket.
      const body: Coord[] = [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 1, y: 3 },
        { x: 0, y: 3 },
        { x: 0, y: 2 },
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 }
      ];
      const snake = makeSnake('our-snake', body);
      const gameState = makeGameState([snake], snake);

      const result = evaluator.evaluateBoard(gameState, 'our-snake', new Set(['our-snake']));

      expect(result.stats.trapped).toBe(1);
      expect(result.stats.selfEnoughSpace).toBe(-3);
    });

    it('applies the strongly-negative trapped weight in the weighted score', () => {
      const evaluator = new BoardEvaluator();
      const body: Coord[] = [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 1, y: 3 },
        { x: 0, y: 3 },
        { x: 0, y: 2 },
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 }
      ];
      const snake = makeSnake('our-snake', body);
      const gameState = makeGameState([snake], snake);

      const result = evaluator.evaluateBoard(gameState, 'our-snake', new Set(['our-snake']));

      expect(result.weights.trapped).toBeLessThan(0);
      expect(result.weighted.trappedScore).toBe(result.stats.trapped * result.weights.trapped);
      expect(result.weighted.trappedScore).toBeLessThan(0);
    });
  });

  describe('floodfill no longer over-counts a true dead-end', () => {
    it('flags a small self-walled corner pocket as trapped', () => {
      const evaluator = new BoardEvaluator();
      // Head at (0,0). The only open neighbours are (0,1) and (1,0), and the
      // snake body walls them into a tiny pocket that cannot fit the body.
      // Reachable cells from the head are far fewer than the snake length, so
      // even an optimistic floodfill must report a fatal pocket.
      const body: Coord[] = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 0, y: 2 },
        { x: 0, y: 3 },
        { x: 0, y: 4 }
      ];
      // Pocket open cells reachable from (0,0): (0,1) only — (1,0) is body.
      // (0,1) neighbours: (0,2) body, (1,1) body, (0,0) head. Dead end size 2.
      const snake = makeSnake('our-snake', body);
      const gameState = makeGameState([snake], snake);

      const result = evaluator.evaluateBoard(gameState, 'our-snake', new Set(['our-snake']));

      expect(result.stats.trapped).toBe(1);
      expect(result.stats.selfEnoughSpace).toBe(-3);
      expect(result.stats.selfSpaceOptimistic).toBe(-3);
    });
  });

  describe('candidate-level fatal-pocket veto', () => {
    it('chooses the safe move over a one-step-fatal pocket', () => {
      const engine = new DecisionEngine();
      // Head at (0,1). Body walls cell (1,0) and (1,1).
      //  - moving down to (0,0) leads into a sealed 1-cell pocket (fatal)
      //  - moving up to (0,2) leads into the open board (safe)
      const body: Coord[] = [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 }
      ];
      const snake = makeSnake('our-snake', body);
      const gameState = makeGameState([snake], snake);

      const decision = engine.decide(gameState, new Set(['our-snake']));

      expect(decision.move).toBe('up');

      const downEval = decision.evaluations.find(e => e.move === 'down');
      expect(downEval).toBeDefined();
      expect(downEval!.averageBreakdown.stats.trapped).toBe(1);
    });

    it('vetoes a fatal pocket even when a waypoint points straight into it', () => {
      const engine = new DecisionEngine();
      const body: Coord[] = [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 }
      ];
      const snake = makeSnake('our-snake', body);
      const gameState = makeGameState([snake], snake);

      // Waypoint sits inside the fatal pocket (0,0). The waypoint reward is large,
      // but the veto must still keep the snake out of the pocket.
      const decision = engine.decide(gameState, new Set(['our-snake']), { type: 'green', x: 0, y: 0 });

      expect(decision.move).toBe('up');
    });
  });

  describe('tail-vacate-on-eat assumption', () => {
    it('treats a normal tail as passable (it vacates) in both timing variants', () => {
      const body: Coord[] = [
        { x: 5, y: 5 },
        { x: 5, y: 4 },
        { x: 5, y: 3 }
      ];
      const snake = makeSnake('our-snake', body, { health: 90 });
      const gameState = makeGameState([snake], snake);
      const tail = body[body.length - 1];

      for (const timing of ['grow-same-turn', 'grow-next-turn'] as const) {
        const graph = new BoardGraph(gameState, { tailGrowthTiming: timing });
        // The tail cell is vacated next turn, so it is passable on arrival.
        expect(graph.isPassableAtTurn(tail, 1)).toBe(true);
      }
    });

    it('keeps the tail blocked when the snake just ate (tail does not vacate)', () => {
      // A snake "just ate" when its head is sitting on food: it will grow, so its
      // tail does NOT vacate next turn. Stepping onto a just-ate snake's tail is
      // therefore always fatal and must be treated as blocked in both variants.
      const body: Coord[] = [
        { x: 5, y: 5 },
        { x: 5, y: 4 },
        { x: 5, y: 3 }
      ];
      const snake = makeSnake('our-snake', body, { health: 100 });
      const food: Coord[] = [{ x: 5, y: 5 }]; // head is on food => just ate
      const gameState = makeGameState([snake], snake, food);
      const tail = body[body.length - 1];

      for (const timing of ['grow-same-turn', 'grow-next-turn'] as const) {
        const graph = new BoardGraph(gameState, { tailGrowthTiming: timing });
        // The tail will not vacate next turn because the snake is still growing.
        expect(graph.isPassableAtTurn(tail, 1)).toBe(false);
        expect(graph.isPassable(tail)).toBe(false);
      }
    });
  });

  describe('consolidated snake-relative passability', () => {
    it('blocks own body, allows own tail, and only force-blocks enemy tails on request', () => {
      const ourBody: Coord[] = [
        { x: 5, y: 5 },
        { x: 5, y: 4 },
        { x: 5, y: 3 }
      ];
      const enemyBody: Coord[] = [
        { x: 8, y: 8 },
        { x: 8, y: 7 },
        { x: 8, y: 6 }
      ];
      const our = makeSnake('our-snake', ourBody, { health: 90 });
      // Distinct color => distinct team, so opponent-tail blocking applies.
      const enemy = makeSnake('enemy', enemyBody, {
        health: 90,
        customizations: { color: '#00FF00', head: 'default', tail: 'default' }
      });
      const gameState = makeGameState([our, enemy], our);
      const graph = new BoardGraph(gameState, { tailGrowthTiming: 'grow-next-turn' });

      const pass = graph.passabilityFor('our-snake', { optimistic: true });

      // Own mid-body is never passable.
      expect(pass.passable({ x: 5, y: 4 }, 1)).toBe(false);
      // Own tail is passable (we can chase it).
      expect(pass.passable({ x: 5, y: 3 }, 1)).toBe(true);
      // By default an enemy tail is assumed to vacate, so it is passable.
      expect(pass.passable({ x: 8, y: 6 }, 1)).toBe(true);
      // ...but is force-blocked when opponentTailsAlwaysImpassable is set.
      const passBlocked = graph.passabilityFor('our-snake', {
        optimistic: true,
        opponentTailsAlwaysImpassable: true
      });
      expect(passBlocked.passable({ x: 8, y: 6 }, 1)).toBe(false);
    });
  });
});
