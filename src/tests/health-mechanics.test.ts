/**
 * Health mechanics mirrored from the TacticToes engine:
 *
 *  - NO universal -1/turn decay. Health loss is MOVEMENT-based: a snake that
 *    moves pays 1 (snakes always move when given a move); units absent from
 *    the moveSet — frozen snakes and stationary chess pieces — lose nothing.
 *    Eating restores health to the unit's type max (snake.maxHealth).
 *  - Hazards deal configurable damage (GameSetup.hazardDamage, default 100)
 *    on ENTERING a hazard square; death only at health <= 0 — no longer
 *    instant death.
 *
 * Plus the owner's explicit conservatism guarantee, pinned here: the engine
 * spawns food AFTER movement, so this-turn survival is fully decidable from
 * the pre-move board — the simulator must predict death exactly when a unit
 * will definitely die this turn without eating, and must NEVER invent food.
 */

import { Simulator, MoveSet, healthAfterEntering } from '../logic/simulator';
import { MoveAnalyzer } from '../logic/move-analyzer';
import { BoardGraph } from '../logic/board-graph';
import { DecisionEngine } from '../logic/decision-engine';
import { GameState, Snake, Coord, Direction } from '../types/battlesnake';

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

function makeGameState(snakes: Snake[], you: Snake, turn = 10): GameState {
  return {
    game: {
      id: 'test',
      ruleset: { name: 'standard', version: '1', settings: {} },
      timeout: 500,
      source: 'test',
      map: 'standard'
    },
    turn,
    board: {
      width: 11,
      height: 11,
      snakes,
      food: [],
      hazards: []
    },
    you
  };
}

const moves = (entries: [string, Direction][]): MoveSet => new Map(entries);

describe('hazard damage (no longer instant death)', () => {
  const simulator = new Simulator();

  /** Us at (5,5) heading up, hazard at (6,5) — one step to the right. */
  function hazardScenario(health: number, hazardDamage?: number) {
    const us = makeSnake('us', [
      { x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }
    ], { health });
    const gs = makeGameState([us], us);
    gs.board.hazards = [{ x: 6, y: 5 }];
    if (hazardDamage !== undefined) gs.board.hazardDamage = hazardDamage;
    return gs;
  }

  test('entering a hazard at high health survives: 1 movement + hazardDamage deducted', () => {
    const gs = hazardScenario(100, 30);
    const result = simulator.simulateNextBoardState(gs, moves([['us', 'right']]));

    expect(result.deadSnakeIds.size).toBe(0);
    const us = result.board.snakes.find(s => s.id === 'us')!;
    expect(us.health).toBe(69); // 100 - 1 (move) - 30 (hazard)
  });

  test('hazardDamage defaults to 100 — entering at full default health still dies', () => {
    const gs = hazardScenario(100); // no hazardDamage on the board
    const result = simulator.simulateNextBoardState(gs, moves([['us', 'right']]));

    expect(result.deadSnakeIds).toEqual(new Set(['us']));
    expect(result.board.snakes).toHaveLength(0);
  });

  test('death exactly at health <= 0: boundary around movement + hazardDamage', () => {
    // 31 - 1 - 30 = 0 -> dead.
    const dead = simulator.simulateNextBoardState(
      hazardScenario(31, 30), moves([['us', 'right']])
    );
    expect(dead.deadSnakeIds).toEqual(new Set(['us']));

    // 32 - 1 - 30 = 1 -> alive.
    const alive = simulator.simulateNextBoardState(
      hazardScenario(32, 30), moves([['us', 'right']])
    );
    expect(alive.deadSnakeIds.size).toBe(0);
    expect(alive.board.snakes.find(s => s.id === 'us')!.health).toBe(1);
  });

  test('food on a hazard square: eat restores to max FIRST, then the damage lands', () => {
    const gs = hazardScenario(5, 30);
    gs.board.food = [{ x: 6, y: 5 }];
    const result = simulator.simulateNextBoardState(gs, moves([['us', 'right']]));

    expect(result.deadSnakeIds.size).toBe(0);
    const us = result.board.snakes.find(s => s.id === 'us')!;
    expect(us.health).toBe(70); // restored to 100, minus 30 hazard damage
    expect(result.board.food).toEqual([]);
  });

  test('hazardDamage survives deepCopyBoard (chained simulations keep the config)', () => {
    const gs = hazardScenario(100, 30);
    const result = simulator.simulateNextBoardState(gs, moves([['us', 'up']]));
    expect(result.board.hazardDamage).toBe(30);
  });

  test('healthAfterEntering mirrors the simulator on plain, food and hazard cells', () => {
    const gs = hazardScenario(50, 30);
    gs.board.food = [{ x: 5, y: 6 }];
    const us = gs.you;
    expect(healthAfterEntering(us, gs.board, { x: 4, y: 5 })).toBe(49); // plain step
    expect(healthAfterEntering(us, gs.board, { x: 5, y: 6 })).toBe(100); // eat -> max
    expect(healthAfterEntering(us, gs.board, { x: 6, y: 5 })).toBe(19); // hazard entry
  });

  describe('MoveAnalyzer fatality classification is health-aware', () => {
    const analyzer = new MoveAnalyzer();

    test('a survivable hazard step is a RISKY candidate, never safe, never excluded', () => {
      const gs = hazardScenario(100, 30);
      const analysis = analyzer.analyzeMoves(gs.you, gs, new BoardGraph(gs));

      expect(analysis.risky).toContain('right');
      expect(analysis.safe).not.toContain('right');
      // Non-hazard open moves stay safe.
      expect(analysis.safe).toEqual(expect.arrayContaining(['up', 'left']));
    });

    test('a hazard step the health cannot survive is excluded as certain death', () => {
      const gs = hazardScenario(20, 30); // 20 - 1 - 30 < 0
      const analysis = analyzer.analyzeMoves(gs.you, gs, new BoardGraph(gs));

      expect(analysis.safe).not.toContain('right');
      expect(analysis.risky).not.toContain('right');
      expect(analysis.h2hRiskByMove.has('right')).toBe(false);
    });

    test('under the default hazardDamage of 100, full default health still cannot survive', () => {
      const gs = hazardScenario(100); // 100 - 1 - 100 < 0
      const analysis = analyzer.analyzeMoves(gs.you, gs, new BoardGraph(gs));

      expect(analysis.safe).not.toContain('right');
      expect(analysis.risky).not.toContain('right');
    });

    test('food on a survivable hazard square counts the eat before the damage', () => {
      const gs = hazardScenario(5, 30); // 5 - 1 - 30 would die, but eat -> 100 - 30 survives
      gs.board.food = [{ x: 6, y: 5 }];
      const analysis = analyzer.analyzeMoves(gs.you, gs, new BoardGraph(gs));

      expect(analysis.risky).toContain('right');
    });
  });
});

describe('conservative starvation prediction (owner guarantee)', () => {
  const simulator = new Simulator();

  /** Us at (5,5) with health 1; food at (6,5) only. */
  function starvingScenario(extra: Partial<Snake> = {}) {
    const us = makeSnake('us', [
      { x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }
    ], { health: 1, ...extra });
    const gs = makeGameState([us], us);
    gs.board.food = [{ x: 6, y: 5 }];
    return gs;
  }

  test('simulateNextBoardState never adds food — food spawns AFTER movement, outside the simulator', () => {
    // No food at all: none may appear.
    const empty = starvingScenario({ health: 100 });
    empty.board.food = [];
    const noFood = simulator.simulateNextBoardState(empty, moves([['us', 'up']]));
    expect(noFood.board.food).toEqual([]);

    // Existing, uneaten food passes through untouched — and nothing new joins it.
    const gs = starvingScenario({ health: 100 });
    const result = simulator.simulateNextBoardState(gs, moves([['us', 'up']]));
    expect(result.board.food).toEqual([{ x: 6, y: 5 }]);
  });

  test('at health 1, every non-food move is certain death in the simulated board', () => {
    for (const move of ['up', 'left'] as Direction[]) {
      const result = simulator.simulateNextBoardState(starvingScenario(), moves([['us', move]]));
      expect(result.deadSnakeIds).toEqual(new Set(['us']));
      expect(result.board.snakes.find(s => s.id === 'us')).toBeUndefined();
    }
  });

  test('at health 1, the food-adjacent move survives at the type max', () => {
    const result = simulator.simulateNextBoardState(starvingScenario(), moves([['us', 'right']]));
    expect(result.deadSnakeIds.size).toBe(0);
    expect(result.board.snakes.find(s => s.id === 'us')!.health).toBe(100);

    const custom = simulator.simulateNextBoardState(
      starvingScenario({ maxHealth: 40 }), moves([['us', 'right']])
    );
    expect(custom.deadSnakeIds.size).toBe(0);
    expect(custom.board.snakes.find(s => s.id === 'us')!.health).toBe(40);
  });

  test('decide() consequently avoids the starvation moves and takes the reachable food', () => {
    const gs = starvingScenario();
    const engine = new DecisionEngine();
    const decision = engine.decide(gs, new Set(['us']));

    expect(decision.candidateMoves).toContain('right');
    expect(decision.move).toBe('right');
  });

  test('a stationary chess piece at health 1 survives the turn — no per-turn tick', () => {
    const us = makeSnake('us', [
      { x: 1, y: 1 }, { x: 1, y: 0 }
    ]);
    const rook = makeSnake('rook', [{ x: 8, y: 8 }], {
      health: 1,
      length: 5, // weight-stack: length is WEIGHT for pieces
      unitType: 'rook'
    });
    const gs = makeGameState([us, rook], us);

    // The piece is absent from the moveSet (frozen in lookahead) and must
    // not be decremented: health loss is movement-based.
    const result = simulator.simulateNextBoardState(gs, moves([['us', 'up']]));
    expect(result.deadSnakeIds.size).toBe(0);
    const simRook = result.board.snakes.find(s => s.id === 'rook')!;
    expect(simRook.health).toBe(1);
    expect(simRook.body).toEqual([{ x: 8, y: 8 }]);
  });

  test('a frozen snake (no move this sub-turn) at health 1 also keeps its health', () => {
    const us = makeSnake('us', [
      { x: 1, y: 1 }, { x: 1, y: 0 }
    ]);
    const far = makeSnake('far', [
      { x: 9, y: 9 }, { x: 9, y: 8 }, { x: 9, y: 7 }
    ], { health: 1 });
    const gs = makeGameState([us, far], us);

    const result = simulator.simulateNextBoardState(gs, moves([['us', 'up']]));
    expect(result.deadSnakeIds.size).toBe(0);
    expect(result.board.snakes.find(s => s.id === 'far')!.health).toBe(1);
  });
});
