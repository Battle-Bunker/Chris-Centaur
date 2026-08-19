/**
 * Tests for safety heuristics: edge penalty, health loss
 */

import { BoardEvaluator } from '../logic/board-evaluator';
import { HEURISTICS } from '../config/heuristics';
import { GameState, Snake } from '../types/battlesnake';

describe('Safety Heuristics Tests', () => {
  
  test('Edge penalty should penalize snakes on board edges', () => {
    const evaluator = new BoardEvaluator();
    
    // Snake on edge (x=0)
    const edgeState: GameState = {
      game: { id: 'test', ruleset: { name: 'standard', version: '1', settings: {} }, timeout: 500, source: 'test', map: 'standard' },
      turn: 1,
      board: {
        width: 11,
        height: 11,
        snakes: [{
          orientation: { dx: 0, dy: -1 },
          id: 'snake1',
          name: 'Edge Snake',
          health: 100,
          body: [
            {x: 0, y: 5},  // Head on left edge
            {x: 1, y: 5},
            {x: 2, y: 5}
          ],
          head: {x: 0, y: 5},
          length: 3,
          latency: '100',
          shout: '',
          squad: '',
          customizations: {color: '#FF0000', head: 'default', tail: 'default'}
        }],
        food: [],
        hazards: []
      },
      you: {} as Snake  // Will be set by evaluator
    };
    
    const evaluation = evaluator.evaluateBoard(edgeState, 'snake1', new Set(['snake1']));
    console.log('Edge penalty for edge snake:', evaluation.stats.edgePenalty);
    console.log('Weighted edge penalty score:', evaluation.weighted.edgePenaltyScore);
    
    // Should have edge penalty of -1
    expect(evaluation.stats.edgePenalty).toBe(-1);
    // With weight of 50, should contribute -50 to the score
    expect(evaluation.weighted.edgePenaltyScore).toBe(-50);
    
    // Snake in middle of board
    const middleState: GameState = {
      ...edgeState,
      board: {
        ...edgeState.board,
        snakes: [{
          ...edgeState.board.snakes[0],
          body: [
            {x: 5, y: 5},  // Head in middle
            {x: 4, y: 5},
            {x: 3, y: 5}
          ],
          head: {x: 5, y: 5}
        }]
      }
    };
    
    const middleEval = evaluator.evaluateBoard(middleState, 'snake1', new Set(['snake1']));
    console.log('Edge penalty for middle snake:', middleEval.stats.edgePenalty);
    
    // Should have no edge penalty
    expect(middleEval.stats.edgePenalty).toBe(0);
    expect(middleEval.weighted.edgePenaltyScore).toBe(0);
  });
});

describe('Health Loss Heuristic Tests', () => {
  // The stat itself is a per-move constant injected via EvaluationContext
  // (computed once from the pre-move board by the shared projectedHealthCost
  // — see health-mechanics.test.ts), so it is exercised here directly through
  // the injection, same as h2hRisk/pieceThreat elsewhere.
  function stateWith(health: number): GameState {
    return {
      game: { id: 'test', ruleset: { name: 'standard', version: '1', settings: {} }, timeout: 500, source: 'test', map: 'standard' },
      turn: 1,
      board: {
        width: 11,
        height: 11,
        snakes: [{
          orientation: { dx: 0, dy: -1 },
          id: 'snake1',
          name: 'Health Snake',
          health,
          body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }],
          head: { x: 5, y: 5 },
          length: 3,
          latency: '100',
          shout: '',
          squad: '',
          customizations: { color: '#FF0000', head: 'default', tail: 'default' }
        }],
        food: [],
        hazards: []
      },
      you: {} as Snake
    };
  }

  test('an ordinary move (cost 1, the plain per-move decay) is a small negative contribution', () => {
    const evaluator = new BoardEvaluator();
    const evaluation = evaluator.evaluateBoard(stateWith(100), 'snake1', new Set(['snake1']), { healthCost: 1 });

    expect(evaluation.stats.healthLoss).toBe(1);
    expect(evaluation.weights.healthLoss).toBe(HEURISTICS.healthLoss.default);
    expect(evaluation.weighted.healthLossScore).toBe(1 * HEURISTICS.healthLoss.default);
  });

  test('no cost injected defaults to zero — never penalizes a state that never had it computed', () => {
    const evaluator = new BoardEvaluator();
    const evaluation = evaluator.evaluateBoard(stateWith(100), 'snake1', new Set(['snake1']));

    expect(evaluation.stats.healthLoss).toBe(0);
    expect(evaluation.weighted.healthLossScore).toBeCloseTo(0, 9); // 0 * weight can be -0
  });

  test('a hazard entry (cost 101 under the default hazardDamage) is decisively bad — comparable to deaths/trapped', () => {
    const evaluator = new BoardEvaluator();
    const evaluation = evaluator.evaluateBoard(stateWith(100), 'snake1', new Set(['snake1']), { healthCost: 101 });

    expect(evaluation.weighted.healthLossScore).toBe(101 * HEURISTICS.healthLoss.default);
    // At the default weight this rivals the deaths (-500) and trapped (-600)
    // penalties — decisively bad, not a marginal nudge.
    expect(evaluation.weighted.healthLossScore).toBeLessThan(-450);
  });

  test('death-level loss ranks below any non-fatal alternative', () => {
    const evaluator = new BoardEvaluator();
    // A candidate whose cost meets or exceeds current health is fatal by the
    // engine's own rule (health <= 0). Scored side by side with a merely
    // costly-but-survivable alternative, the fatal one must score decisively
    // lower — no non-fatal candidate should ever lose to it on health alone.
    const fatal = evaluator.evaluateBoard(stateWith(50), 'snake1', new Set(['snake1']), { healthCost: 50 });
    const survivable = evaluator.evaluateBoard(stateWith(50), 'snake1', new Set(['snake1']), { healthCost: 5 });

    expect(fatal.weighted.healthLossScore).toBeLessThan(survivable.weighted.healthLossScore);
    expect(fatal.score).toBeLessThan(survivable.score);
  });
});
