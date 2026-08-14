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

// Coord-based conveniences over the integer-indexed BoardGraph API.
const passAt = (graph: BoardGraph, coord: Coord, turn: number): boolean =>
  graph.isPassableAtTurnIdx(graph.cellIndexOf(coord), turn);
const passFor = (graph: BoardGraph, id: string, clearance: 'static' | 'conservative' | 'optimistic') => {
  const p = graph.passabilityIdxFor(id, { clearance });
  return (coord: Coord, turn: number): boolean => p.passableIdx(graph.cellIndexOf(coord), turn);
};


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
    facing: { dx: 0, dy: -1 },
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
      // Open board: room >> length, so sqrt(room/length) scores above 1.0
      expect(result.stats.selfSpace).toBeGreaterThan(1);
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
      // Sealed box: no reachable room, so sqrt(room/length) stays well under 1.0
      expect(result.stats.selfSpace).toBeLessThan(1);
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
      // selfSpace is sqrt(room/length): a fatal pocket has a little reachable room
      // but far below the body length, so it stays strictly between 0 and 1.
      expect(result.stats.selfSpace).toBeGreaterThan(0);
      expect(result.stats.selfSpace).toBeLessThan(1);
    });
  });

  describe('greedy longest-path walk (constructive lower bound)', () => {
    // The `trapped` signal's over-count fix relies on greedyLongestWalk: a
    // Warnsdorff-ordered simple-path walk whose achieved length is a guaranteed
    // LOWER bound on survivable moves (unlike the parity/area figure, which is an
    // upper bound that over-counts dead-end pockets). These exercise the helper
    // directly, since triggering the branch through evaluateBoard requires a large
    // permanently-sealed pocket that is impractical to encode compactly.
    const callWalk = (
      graph: BoardGraph,
      snake: Snake,
      cap: number
    ): { walkLength: number; tailReached: boolean } => {
      const evaluator = new BoardEvaluator();
      return (evaluator as any).greedyLongestWalk(graph, snake, 'optimistic', cap);
    };

    it('walks freely up to the cap in open space', () => {
      const snake = makeSnake('our-snake', [
        { x: 5, y: 5 },
        { x: 5, y: 4 },
        { x: 5, y: 3 }
      ]);
      const gameState = makeGameState([snake], snake);
      const graph = new BoardGraph(gameState);

      const walk = callWalk(graph, snake, 10);

      // Open 11x11 board: the walk easily reaches the requested cap of 10 moves.
      expect(walk.walkLength).toBe(10);
    });

    it('stalls far short of body length inside a sealed box (a true dead end)', () => {
      // Same closed-box coil as the sealed-box trapped test: the head at (1,1) can
      // only reach the tiny pocket cell (1,2), then dead-ends. A constructive walk
      // therefore stalls almost immediately, well under the body length of 11.
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
      const graph = new BoardGraph(gameState);

      const walk = callWalk(graph, snake, snake.length);

      expect(walk.walkLength).toBeLessThan(snake.length);
      expect(walk.tailReached).toBe(false);
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
      expect(downEval!.worstEvaluation.stats.trapped).toBe(1);
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

      // Goto target sits inside the fatal pocket (0,0), so the move into the
      // pocket earns the full goto progress bonus. The veto must still keep the
      // snake out of it.
      const decision = engine.decide(gameState, new Set(['our-snake']), { kind: 'goto', target: { x: 0, y: 0 } });

      expect(decision.move).toBe('up');
    });
  });

  describe('tail-vacate assumption', () => {
    it('treats a normal tail as passable (it vacates on the next move)', () => {
      const body: Coord[] = [
        { x: 5, y: 5 },
        { x: 5, y: 4 },
        { x: 5, y: 3 }
      ];
      const snake = makeSnake('our-snake', body, { health: 90 });
      const gameState = makeGameState([snake], snake);
      const tail = body[body.length - 1];

      const graph = new BoardGraph(gameState);
      // The engine pops tails before resolving collisions, eating or not, so
      // the tail cell is vacated next turn and passable on arrival.
      expect(passAt(graph, tail, 1)).toBe(true);
    });

    it('keeps a stacked tail blocked for one extra turn (the snake ate last turn)', () => {
      // The engine grows a snake by duplicating its tail segment, so a snake
      // that ate last turn carries a stacked tail: the next pop still leaves a
      // copy behind, and the cell only frees on the SECOND move. Stepping onto
      // a stacked tail is fatal and must be treated as blocked.
      const body: Coord[] = [
        { x: 5, y: 5 },
        { x: 5, y: 4 },
        { x: 5, y: 3 },
        { x: 5, y: 3 } // duplicated tail: ate last turn
      ];
      const snake = makeSnake('our-snake', body, { health: 100 });
      const gameState = makeGameState([snake], snake);
      const tail = body[body.length - 1];

      const graph = new BoardGraph(gameState);
      expect(passAt(graph, tail, 1)).toBe(false);
      expect(passAt(graph, tail, 2)).toBe(true);
      expect(graph.isPassableStaticIdx(graph.cellIndexOf(tail))).toBe(false);
    });
  });

  describe('per-segment disappear-turn eat accounting', () => {
    // Regression tests for the off-by-one that made the red fatal marker
    // misfire: the "could eat this turn" bump used to be applied uniformly to
    // EVERY body segment, including the tail. The engine pops tails before
    // food is processed, so an eat at turn t only delays segments whose vacate
    // turn is strictly greater than t — the tail (vacate turn 1) is never
    // delayed by a turn-1 eat.
    const body: Coord[] = [
      { x: 5, y: 5 }, // head
      { x: 5, y: 4 }, // second-to-last (vacates turn 2)
      { x: 5, y: 3 }  // tail (vacates turn 1)
    ];
    const tail = body[2];
    const secondToLast = body[1];

    it('keeps the tail passable at turn 1 with food adjacent to the head', () => {
      const snake = makeSnake('our-snake', body, { health: 90 });
      // Food one step from the head: the snake COULD eat this turn, but that
      // eat lands the same turn the tail vacates, so the tail is NOT delayed.
      const food: Coord[] = [{ x: 6, y: 5 }];
      const gameState = makeGameState([snake], snake, food);
      const graph = new BoardGraph(gameState);

      // Physical layer: tail free on arrival.
      expect(passAt(graph, tail, 1)).toBe(true);
      // Optimistic subject-relative layer (drives the fatal-move marker).
      const optimistic = passFor(graph, 'our-snake', 'optimistic');
      expect(optimistic(tail, 1)).toBe(true);
    });

    it('delays the second-to-last segment by a possible turn-1 eat', () => {
      const snake = makeSnake('our-snake', body, { health: 90 });
      const food: Coord[] = [{ x: 6, y: 5 }];
      const gameState = makeGameState([snake], snake, food);
      const graph = new BoardGraph(gameState);

      // Geometric vacate turn 2 > eat turn 1, so the eat pushes it to turn 3.
      // (Physical layer only: a snake's OWN interior is never passable to
      // itself in passabilityFor, by design.)
      expect(passAt(graph, secondToLast, 2)).toBe(false);
      expect(passAt(graph, secondToLast, 3)).toBe(true);
    });

    it('does not delay anything when no food is reachable', () => {
      const snake = makeSnake('our-snake', body, { health: 90 });
      const gameState = makeGameState([snake], snake);
      const graph = new BoardGraph(gameState);
      const optimistic = passFor(graph, 'our-snake', 'optimistic');
      expect(optimistic(tail, 1)).toBe(true);
      expect(passAt(graph, secondToLast, 2)).toBe(true);
    });

    it('still blocks a stacked (just-ate) tail at turn 1 in all layers', () => {
      const stackedBody: Coord[] = [...body, { ...body[body.length - 1] }];
      const snake = makeSnake('our-snake', stackedBody, { health: 100 });
      const gameState = makeGameState([snake], snake);
      const graph = new BoardGraph(gameState);
      expect(passAt(graph, tail, 1)).toBe(false);
      const optimistic = passFor(graph, 'our-snake', 'optimistic');
      expect(optimistic(tail, 1)).toBe(false);
    });

    it('keeps the conservative +1 buffer on top of the corrected physical timing', () => {
      const snake = makeSnake('our-snake', body, { health: 90 });
      const food: Coord[] = [{ x: 6, y: 5 }];
      const gameState = makeGameState([snake], snake, food);
      const graph = new BoardGraph(gameState);

      const conservative = passFor(graph, 'our-snake', 'conservative');
      // Tail: physical vacate turn 1 (not delayed by the turn-1 eat) + 1 buffer.
      expect(conservative(tail, 1)).toBe(false);
      expect(conservative(tail, 2)).toBe(true);
    });
  });

  describe('consolidated snake-relative passability (clearance model)', () => {
    it('blocks own interior in all modes, allows own vacating tail, and gates enemy interior by clearance', () => {
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
      // Distinct color => distinct team, so severability/clearance reasoning applies.
      const enemy = makeSnake('enemy', enemyBody, {
        health: 90,
        customizations: { color: '#00FF00', head: 'default', tail: 'default' }
      });
      const gameState = makeGameState([our, enemy], our);
      const graph = new BoardGraph(gameState);

      const staticPass = passFor(graph, 'our-snake', 'static');
      const conservative = passFor(graph, 'our-snake', 'conservative');
      const optimistic = passFor(graph, 'our-snake', 'optimistic');

      // Our own interior segment is never passable, in ANY clearance mode: we can
      // never bank on our own body vacating ahead of our head.
      for (const pass of [staticPass, conservative, optimistic]) {
        expect(pass({ x: 5, y: 4 }, 1)).toBe(false);
      }

      // Our own tail vacates next turn (not stacked). Static and
      // optimistic clearance treat it as passable on arrival (turn 1).
      expect(staticPass({ x: 5, y: 3 }, 1)).toBe(true);
      expect(optimistic({ x: 5, y: 3 }, 1)).toBe(true);
      // Conservative clearance adds a one-turn survival safety buffer, so the same
      // tail cell is not banked on until turn 2 (physical vacate turn + 1).
      expect(conservative({ x: 5, y: 3 }, 1)).toBe(false);
      expect(conservative({ x: 5, y: 3 }, 2)).toBe(true);

      // Enemy INTERIOR segment (8,7) vacates on turn 2 under optimistic timing but
      // is a hard wall under static clearance. This is the tier that replaced the
      // old opponentTailsAlwaysImpassable flag: static never banks on bodies moving.
      expect(staticPass({ x: 8, y: 7 }, 2)).toBe(false);
      expect(optimistic({ x: 8, y: 7 }, 2)).toBe(true);
    });
  });
});
