/**
 * Tests for safety heuristics: edge penalty and space availability
 */

import { BoardEvaluator } from '../logic/board-evaluator';
import { GameState, Snake, Coord } from '../types/battlesnake';

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
  
  test('Space available should detect enclosed spaces', () => {
    const evaluator = new BoardEvaluator();
    
    // Snake in open space
    const openState: GameState = {
      game: { id: 'test', ruleset: { name: 'standard', version: '1', settings: {} }, timeout: 500, source: 'test', map: 'standard' },
      turn: 1,
      board: {
        width: 11,
        height: 11,
        snakes: [{
          id: 'snake1',
          name: 'Open Snake',
          health: 100,
          body: [
            {x: 5, y: 5},  // Head
            {x: 4, y: 5},
            {x: 3, y: 5},
            {x: 2, y: 5}
          ],
          head: {x: 5, y: 5},
          length: 4,
          latency: '100',
          shout: '',
          squad: '',
          customizations: {color: '#FF0000', head: 'default', tail: 'default'}
        }],
        food: [],
        hazards: []
      },
      you: {} as Snake
    };
    
    const openEval = evaluator.evaluateBoard(openState, 'snake1', new Set(['snake1']));
    console.log('Space available for open snake:', openEval.stats.spaceAvailable);
    
    // Should have plenty of space
    expect(openEval.stats.spaceAvailable).toBe(10);
    expect(openEval.weighted.spaceAvailableScore).toBe(50); // 10 * weight of 5
    
    // Snake completely surrounded (trapped in 2x2 area)
    const trappedState: GameState = {
      ...openState,
      board: {
        ...openState.board,
        snakes: [
          {
            id: 'snake1',
            name: 'Trapped Snake',
            health: 100,
            body: [
              {x: 1, y: 1},  // Head
              {x: 1, y: 0},
              {x: 0, y: 0}
            ],
            head: {x: 1, y: 1},
            length: 3,
            latency: '100',
            shout: '',
            squad: '',
            customizations: {color: '#FF0000', head: 'default', tail: 'default'}
          },
          // Enemy snake forming walls
          {
            id: 'enemy',
            name: 'Enemy',
            health: 100,
            body: [
              {x: 2, y: 0},
              {x: 2, y: 1},
              {x: 2, y: 2},
              {x: 1, y: 2},
              {x: 0, y: 2},
              {x: 0, y: 1}  // Almost complete enclosure
            ],
            head: {x: 2, y: 0},
            length: 6,
            latency: '100',
            shout: '',
            squad: '',
            customizations: {color: '#00FF00', head: 'default', tail: 'default'}
          }
        ]
      }
    };
    
    const trappedEval = evaluator.evaluateBoard(trappedState, 'snake1', new Set(['snake1']));
    console.log('Space available for trapped snake:', trappedEval.stats.spaceAvailable);
    
    // Should detect limited space and be negative but credit for enemy tail
    expect(trappedEval.stats.spaceAvailable).toBeLessThan(10);
    // With only ~3 cells available for a 3-length snake, might be exactly at the boundary
    // But the enemy tail is reachable which adds +5
  });
  
  test('Space available should give credit for reachable enemy tails', () => {
    const evaluator = new BoardEvaluator();
    
    // Snake with limited space but can reach enemy tail
    const limitedState: GameState = {
      game: { id: 'test', ruleset: { name: 'standard', version: '1', settings: {} }, timeout: 500, source: 'test', map: 'standard' },
      turn: 1,
      board: {
        width: 5,
        height: 5,
        snakes: [
          {
            id: 'snake1',
            name: 'Our Snake',
            health: 100,
            body: [
              {x: 1, y: 1},  // Head
              {x: 1, y: 0},
              {x: 0, y: 0},
              {x: 0, y: 1}   // 4-length snake
            ],
            head: {x: 1, y: 1},
            length: 4,
            latency: '100',
            shout: '',
            squad: '',
            customizations: {color: '#FF0000', head: 'default', tail: 'default'}
          },
          // Enemy snake with reachable tail
          {
            id: 'enemy',
            name: 'Enemy',
            health: 100,
            body: [
              {x: 3, y: 3},  // Head far away
              {x: 3, y: 2},
              {x: 2, y: 2},
              {x: 2, y: 1}   // Tail near our snake
            ],
            head: {x: 3, y: 3},
            length: 4,
            latency: '100',
            shout: '',
            squad: '',
            customizations: {color: '#00FF00', head: 'default', tail: 'default'}
          }
        ],
        food: [],
        hazards: []
      },
      you: {} as Snake
    };
    
    const evaluation = evaluator.evaluateBoard(limitedState, 'snake1', new Set(['snake1']));
    console.log('Space available with enemy tail:', evaluation.stats.spaceAvailable);
    console.log('Available cells should include credit for enemy tail movement');
    
    // If less than 4 spaces but can reach enemy tail, gets +5 credit
    // So result should be -10 + 5 = -5 or better
    expect(evaluation.stats.spaceAvailable).toBeGreaterThanOrEqual(-5);
  });
  
  test('Space available should return 10 if can reach own tail', () => {
    const evaluator = new BoardEvaluator();
    
    // Snake that can chase its own tail (forms a cycle)
    const cyclicState: GameState = {
      game: { id: 'test', ruleset: { name: 'standard', version: '1', settings: {} }, timeout: 500, source: 'test', map: 'standard' },
      turn: 1,
      board: {
        width: 11,
        height: 11,
        snakes: [{
          id: 'snake1',
          name: 'Cyclic Snake',
          health: 100,
          body: [
            {x: 5, y: 5},  // Head
            {x: 4, y: 5},
            {x: 3, y: 5},
            {x: 3, y: 6},
            {x: 4, y: 6},
            {x: 5, y: 6}   // Tail adjacent to where head could move
          ],
          head: {x: 5, y: 5},
          length: 6,
          latency: '100',
          shout: '',
          squad: '',
          customizations: {color: '#FF0000', head: 'default', tail: 'default'}
        }],
        food: [],
        hazards: []
      },
      you: {} as Snake
    };
    
    const evaluation = evaluator.evaluateBoard(cyclicState, 'snake1', new Set(['snake1']));
    console.log('Space available for cyclic snake:', evaluation.stats.spaceAvailable);
    
    // Should detect that tail is reachable and return 10 (infinite space via cycle)
    expect(evaluation.stats.spaceAvailable).toBe(10);
    expect(evaluation.weighted.spaceAvailableScore).toBe(50); // 10 * weight of 5
  });
});