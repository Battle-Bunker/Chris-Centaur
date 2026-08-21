/**
 * Health mechanics mirrored from the TacticToes engine:
 *
 *  - NO universal -1/turn decay. Health loss is MOVEMENT-based: a snake that
 *    moves pays 1 (snakes always move when given a move); units absent from
 *    the moveSet — frozen snakes and stationary chess pieces — lose nothing.
 *  - Hazards deal configurable damage (GameSetup.hazardDamage, default 100)
 *    on ENTERING a hazard square; death only at health <= 0 — no longer
 *    instant death.
 *  - CHARGE FIRST, EAT AFTER — but EXHAUSTION IS PROVISIONAL DEATH. The engine
 *    charges movement and hazard cost in the sub-step the cell is entered;
 *    health reaching <= 0 stops MOVEMENT and nothing else. Whether it kills is
 *    settled at end of turn, after the food phase, which runs at the unit's
 *    FINAL cell and ASSIGNS the type max (snake.maxHealth). So a unit that
 *    halted on food eats, recovers and lives; one at zero anywhere else dies.
 *    A snake's move is one cell, so its halt cell IS its destination: food at
 *    the destination rescues a step that would otherwise kill, hazard dose and
 *    all — and the dose is wiped along with the movement cost.
 *
 * Plus the owner's explicit conservatism guarantee, pinned here: the engine
 * spawns food AFTER movement, so this-turn survival is fully decidable from
 * the pre-move board — the simulator must predict death exactly when a unit
 * will definitely die this turn without eating, and must NEVER invent food.
 */

import { Simulator, MoveSet, healthAfterEntering, projectedHealthCost } from '../logic/simulator';
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
    orientation: { dx: 0, dy: -1 },
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

  // Food on a hazard square RESCUES, and restores to the FULL type max — the
  // dose is charged first and then wiped, because the food phase assigns the
  // max rather than subtracting from it. (This lands between two older
  // readings: it is not "eat to 100 then take 30" — the answer is 100, not 70
  // — and it is not "the dose kills first and the meal is never taken", which
  // was the starved-is-dead reading exhaustion-is-provisional replaced.)
  test('food on a hazard square rescues an exhausted unit, at the FULL type max', () => {
    const gs = hazardScenario(5, 30); // 5 - 1 - 30 = -26: exhausted on arrival
    gs.board.food = [{ x: 6, y: 5 }];
    const result = simulator.simulateNextBoardState(gs, moves([['us', 'right']]));

    expect(result.deadSnakeIds.size).toBe(0);
    expect(result.board.snakes.find(s => s.id === 'us')!.health).toBe(100);
    expect(result.board.food).toEqual([]);
  });

  test('food on a hazard square the unit survives outright restores it the same way', () => {
    // 50 - 1 - 30 = 19 > 0, never exhausted — and still assigned the max.
    const gs = hazardScenario(50, 30);
    gs.board.food = [{ x: 6, y: 5 }];
    const result = simulator.simulateNextBoardState(gs, moves([['us', 'right']]));

    expect(result.deadSnakeIds.size).toBe(0);
    expect(result.board.snakes.find(s => s.id === 'us')!.health).toBe(100);
    expect(result.board.food).toEqual([]);
  });

  test('the SAME hazard square without food is death — the meal is the whole difference', () => {
    const gs = hazardScenario(5, 30);
    const result = simulator.simulateNextBoardState(gs, moves([['us', 'right']]));
    expect(result.deadSnakeIds).toEqual(new Set(['us']));
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
    expect(healthAfterEntering(us, gs.board, { x: 5, y: 6 })).toBe(100); // survive, then eat -> max
    expect(healthAfterEntering(us, gs.board, { x: 6, y: 5 })).toBe(19); // hazard entry
  });

  // INVERTED (was: "healthAfterEntering charges BEFORE the meal, so a step
  // that kills stays killed"). The charge does come first, but exhaustion only
  // HALTS — and for a one-cell step the halt cell is the destination, so the
  // end-of-turn meal there still lands.
  test('healthAfterEntering: the charge comes first, and the meal at the halt cell still saves', () => {
    // Health 1 onto food: 1 - 1 = 0, exhausted — and the food phase runs at
    // that very cell, so it recovers to the type max.
    const dying = hazardScenario(1, 30);
    dying.board.food = [{ x: 4, y: 5 }];
    expect(healthAfterEntering(dying.you, dying.board, { x: 4, y: 5 })).toBe(100);

    // The charge is still real: the same step onto a bare cell is at zero.
    expect(healthAfterEntering(dying.you, dying.board, { x: 3, y: 5 })).toBe(0);
  });

  describe('projectedHealthCost — the one shared cost projection for snakes and pieces', () => {
    test('a plain single-square step costs 1 (the ordinary movement decay)', () => {
      const gs = hazardScenario(50, 30);
      expect(projectedHealthCost(gs, [{ x: 4, y: 5 }])).toBe(1);
    });

    test('eating at the destination cancels the movement cost — it is not charged as loss', () => {
      const gs = hazardScenario(50, 30);
      gs.board.food = [{ x: 5, y: 6 }];
      expect(projectedHealthCost(gs, [{ x: 5, y: 6 }])).toBe(0);
    });

    test('a hazard entry costs movement PLUS hazardDamage, matching healthAfterEntering exactly', () => {
      const gs = hazardScenario(50, 30);
      const cost = projectedHealthCost(gs, [{ x: 6, y: 5 }]);
      expect(cost).toBe(31); // 1 movement + 30 hazard
      // The cost is exactly the health healthAfterEntering deducts when the
      // move does not eat: current health minus cost equals the after-health.
      expect(gs.you.health - cost).toBe(healthAfterEntering(gs.you, gs.board, { x: 6, y: 5 }));
    });

    // INVERTED (was: "eating on a hazard square still charges the hazard
    // damage"). The engine deals hazard doses inside the movement/sub-step
    // phase and settles food afterwards, and the food phase ASSIGNS the type
    // max (TeamSnekProcessor.processFood: `newPlayerHealth[id] =
    // maxHealthFor(type)`) rather than adding to the running health. So a meal
    // wipes every hazard dose the traversal accrued, at the destination and
    // mid-flight alike — the cost of a survived hazard crossing that ends on
    // food is zero, not the doses.
    test('eating wipes the hazard damage too — the food phase SETS health to the type max', () => {
      const gs = hazardScenario(50, 30);
      gs.board.food = [{ x: 6, y: 5 }]; // food sits ON the hazard cell
      expect(projectedHealthCost(gs, [{ x: 6, y: 5 }])).toBe(0);
    });

    test('a stay/rotate action (empty path) costs nothing', () => {
      const gs = hazardScenario(50, 30);
      expect(projectedHealthCost(gs, [])).toBe(0);
    });

    test('a multi-square piece ray costs 1 per square traversed, no hazards', () => {
      const gs = hazardScenario(100, 30);
      // A 3-square rook-style ray, none of them the hazard cell.
      const path = [{ x: 5, y: 6 }, { x: 5, y: 7 }, { x: 5, y: 8 }];
      expect(projectedHealthCost(gs, path)).toBe(3);
    });

    test('a ray crossing N hazard squares (mid-flight included) costs N full hazard doses', () => {
      const gs = hazardScenario(100, 30);
      gs.board.hazards = [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }];
      // A 4-square ray that passes through all three hazard cells mid-flight
      // before landing on a clear square.
      const path = [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }];
      expect(projectedHealthCost(gs, path)).toBe(4 + 3 * 30); // 4 movement + 3 hazard doses
    });

    test('hazardDamage defaults to 100 when unset on the board', () => {
      const gs = hazardScenario(200); // no hazardDamage override
      expect(projectedHealthCost(gs, [{ x: 6, y: 5 }])).toBe(101); // 1 + 100
    });
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

    test('food on the hazard square makes an otherwise-lethal step survivable', () => {
      // 5 - 1 - 30 exhausts on arrival, but the halt cell feeds it: risky, not
      // excluded. The damage still lands first — the meal is what undoes it.
      const gs = hazardScenario(5, 30);
      gs.board.food = [{ x: 6, y: 5 }];
      const analysis = analyzer.analyzeMoves(gs.you, gs, new BoardGraph(gs));

      expect(analysis.risky).toContain('right');
      expect(analysis.safe).not.toContain('right');
    });

    test('a hazard step the health DOES survive is risky, food or no food', () => {
      const gs = hazardScenario(50, 30); // 50 - 1 - 30 = 19, then the meal
      gs.board.food = [{ x: 6, y: 5 }];
      expect(analyzer.analyzeMoves(gs.you, gs, new BoardGraph(gs)).risky).toContain('right');
    });
  });

  describe('decide() steers around hazards via the health-loss heuristic (no hazard-specific rule)', () => {
    test('a survivable-but-costly hazard entry is avoided when a safe alternative exists', () => {
      // 100 health, hazard one step to the right, hazardDamage 30: entering
      // survives (100 - 1 - 30 = 69) so MoveAnalyzer offers it as risky, not
      // excluded — the health-loss heuristic is what has to turn the bot away.
      const gs = hazardScenario(100, 30);
      const engine = new DecisionEngine();
      const decision = engine.decide(gs, new Set(['us']));

      expect(decision.candidateMoves).toEqual(expect.arrayContaining(['up', 'left', 'right']));
      expect(decision.move).not.toBe('right');

      const rightEval = decision.evaluations.find(e => e.move === 'right')!;
      const upEval = decision.evaluations.find(e => e.move === 'up')!;
      expect(rightEval.worstEvaluation.stats.healthLoss).toBe(31); // 1 movement + 30 hazard
      expect(upEval.worstEvaluation.stats.healthLoss).toBe(1);     // plain movement only
      expect(rightEval.worstScore).toBeLessThan(upEval.worstScore);
    });
  });
});

describe('conservative starvation prediction (owner guarantee)', () => {
  const simulator = new Simulator();

  /** Us at (5,5); food at (6,5) only. Health 1 unless overridden. */
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

  test('at health 1, every NON-food move is certain death in the simulated board', () => {
    for (const move of ['up', 'left'] as Direction[]) {
      const result = simulator.simulateNextBoardState(starvingScenario(), moves([['us', move]]));
      expect(result.deadSnakeIds).toEqual(new Set(['us']));
      expect(result.board.snakes.find(s => s.id === 'us')).toBeUndefined();
    }
  });

  // The last point of health is still enough to reach food, because exhaustion
  // only HALTS: the snake ends the turn on the meal and the food phase runs
  // there. (This is the half of "at health 1 every move is death" that the
  // provisional-death ruling took back; the non-food half above stands.)
  test('at health 1, the food-adjacent move survives at the type max', () => {
    const result = simulator.simulateNextBoardState(starvingScenario(), moves([['us', 'right']]));
    expect(result.deadSnakeIds.size).toBe(0);
    expect(result.board.snakes.find(s => s.id === 'us')!.health).toBe(100);
    expect(result.board.food).toEqual([]);

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
