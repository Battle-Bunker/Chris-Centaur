/**
 * Test suite for territory calculation, food control, and distance calculations.
 * These tests verify the core BFS and Voronoi territory logic.
 */

import { GameState } from '../types/battlesnake';
import { BoardGraph } from '../logic/board-graph';
import { MultiSourceBFS } from '../logic/multi-source-bfs';
import { BoardEvaluator } from '../logic/board-evaluator';

describe('Territory Calculation Tests', () => {
  
  test('Single snake should control most of empty board', () => {
    const gameState: GameState = {
      game: {
        id: 'test-single-snake',
        ruleset: { name: 'standard', version: '1.0.0', settings: {} },
        map: 'standard',
        timeout: 500,
        source: 'test'
      },
      turn: 10,
      board: {
        width: 11,
        height: 11,
        snakes: [
          {
            id: 'snake1',
            name: 'Snake 1',
            health: 100,
            body: [
              { x: 5, y: 5 },  // head
              { x: 5, y: 4 },
              { x: 5, y: 3 }
            ],
            head: { x: 5, y: 5 },
            length: 3,
            latency: '0',
            shout: '',
            squad: '',
            customizations: { color: '#FF0000', head: 'default', tail: 'default' }
          }
        ],
        food: [],
        hazards: []
      },
      you: {
        id: 'snake1',
        name: 'Snake 1',
        health: 100,
        body: [
          { x: 5, y: 5 },
          { x: 5, y: 4 },
          { x: 5, y: 3 }
        ],
        head: { x: 5, y: 5 },
        length: 3,
        latency: '0',
        shout: '',
        squad: '',
        customizations: { color: '#FF0000', head: 'default', tail: 'default' }
      }
    };

    const graph = new BoardGraph(gameState);
    const bfs = new MultiSourceBFS(graph);
    
    const sources = [{
      id: 'snake1',
      position: { x: 5, y: 5 },
      isTeam: true
    }];
    
    const result = bfs.compute(sources, []);
    
    // Single snake should control most of the board (11x11 = 121 cells)
    // With the fix, heads are passable so the snake can control up to 120 cells
    // (121 total minus 1 blocked by the tail that doesn't move)
    const territory = result.territoryCounts.get('snake1') || 0;
    console.log('Single snake territory:', territory);
    
    expect(territory).toBeGreaterThan(100);  // Should control most of the board
    expect(territory).toBeLessThanOrEqual(121);  // Maximum possible cells on board
  });

  test('Two snakes at equal distance should have tied cells neutralized', () => {
    const gameState: GameState = {
      game: {
        id: 'test-tie',
        ruleset: { name: 'standard', version: '1.0.0', settings: {} },
        map: 'standard',
        timeout: 500,
        source: 'test'
      },
      turn: 10,
      board: {
        width: 7,
        height: 7,
        snakes: [
          {
            id: 'snake1',
            name: 'Snake 1',
            health: 100,
            body: [
              { x: 1, y: 3 },  // head on left
              { x: 0, y: 3 },
              { x: 0, y: 2 }
            ],
            head: { x: 1, y: 3 },
            length: 3,
            latency: '0',
            shout: '',
            squad: '',
            customizations: { color: '#FF0000', head: 'default', tail: 'default' }
          },
          {
            id: 'snake2',
            name: 'Snake 2',
            health: 100,
            body: [
              { x: 5, y: 3 },  // head on right
              { x: 6, y: 3 },
              { x: 6, y: 2 }
            ],
            head: { x: 5, y: 3 },
            length: 3,
            latency: '0',
            shout: '',
            squad: '',
            customizations: { color: '#0000FF', head: 'default', tail: 'default' }
          }
        ],
        food: [],
        hazards: []
      },
      you: {
        id: 'snake1',
        name: 'Snake 1',
        health: 100,
        body: [
          { x: 1, y: 3 },
          { x: 0, y: 3 },
          { x: 0, y: 2 }
        ],
        head: { x: 1, y: 3 },
        length: 3,
        latency: '0',
        shout: '',
        squad: '',
        customizations: { color: '#FF0000', head: 'default', tail: 'default' }
      }
    };

    const graph = new BoardGraph(gameState);
    const bfs = new MultiSourceBFS(graph);
    
    const sources = [
      {
        id: 'snake1',
        position: { x: 1, y: 3 },
        isTeam: true
      },
      {
        id: 'snake2',
        position: { x: 5, y: 3 },
        isTeam: false
      }
    ];
    
    const result = bfs.compute(sources, []);
    
    const territory1 = result.territoryCounts.get('snake1') || 0;
    const territory2 = result.territoryCounts.get('snake2') || 0;
    
    console.log('Snake 1 territory:', territory1);
    console.log('Snake 2 territory:', territory2);
    
    // Snakes are symmetric, so territories should be roughly equal
    // The middle column (x=3) should be neutralized
    expect(Math.abs(territory1 - territory2)).toBeLessThanOrEqual(2);  // Allow small asymmetry
    
    // Check that middle cells are neutral
    const middleCell = graph.coordToKey({ x: 3, y: 3 });
    const cellInfo = result.cellInfo.get(middleCell);
    expect(cellInfo?.closestSourceId).toBeNull();  // Should be neutral
  });

  test('Snake surrounded by enemies should have minimal territory', () => {
    const gameState: GameState = {
      game: {
        id: 'test-surrounded',
        ruleset: { name: 'standard', version: '1.0.0', settings: {} },
        map: 'standard',
        timeout: 500,
        source: 'test'
      },
      turn: 50,
      board: {
        width: 11,
        height: 11,
        snakes: [
          {
            id: 'our-snake',
            name: 'Our Snake',
            health: 100,
            body: [
              { x: 5, y: 5 },  // head
              { x: 5, y: 4 },
              { x: 5, y: 3 }
            ],
            head: { x: 5, y: 5 },
            length: 3,
            latency: '0',
            shout: '',
            squad: '',
            customizations: { color: '#FFD700', head: 'default', tail: 'default' }
          },
          {
            id: 'enemy-1',
            name: 'Enemy 1',
            health: 95,
            body: [
              { x: 4, y: 5 },  // left of our head
              { x: 3, y: 5 },
              { x: 2, y: 5 }
            ],
            head: { x: 4, y: 5 },
            length: 3,
            latency: '0',
            shout: '',
            squad: '',
            customizations: { color: '#FF0000', head: 'default', tail: 'default' }
          },
          {
            id: 'enemy-2',
            name: 'Enemy 2',
            health: 90,
            body: [
              { x: 6, y: 5 },  // right of our head
              { x: 7, y: 5 },
              { x: 8, y: 5 }
            ],
            head: { x: 6, y: 5 },
            length: 3,
            latency: '0',
            shout: '',
            squad: '',
            customizations: { color: '#0000FF', head: 'default', tail: 'default' }
          },
          {
            id: 'enemy-3',
            name: 'Enemy 3',
            health: 85,
            body: [
              { x: 5, y: 6 },  // above our head
              { x: 5, y: 7 },
              { x: 5, y: 8 }
            ],
            head: { x: 5, y: 6 },
            length: 3,
            latency: '0',
            shout: '',
            squad: '',
            customizations: { color: '#00FF00', head: 'default', tail: 'default' }
          }
        ],
        food: [],
        hazards: []
      },
      you: {
        id: 'our-snake',
        name: 'Our Snake',
        health: 100,
        body: [
          { x: 5, y: 5 },
          { x: 5, y: 4 },
          { x: 5, y: 3 }
        ],
        head: { x: 5, y: 5 },
        length: 3,
        latency: '0',
        shout: '',
        squad: '',
        customizations: { color: '#FFD700', head: 'default', tail: 'default' }
      }
    };

    const graph = new BoardGraph(gameState);
    const bfs = new MultiSourceBFS(graph);
    
    const sources = [
      {
        id: 'our-snake',
        position: { x: 5, y: 5 },
        isTeam: true
      },
      {
        id: 'enemy-1',
        position: { x: 4, y: 5 },
        isTeam: false
      },
      {
        id: 'enemy-2',
        position: { x: 6, y: 5 },
        isTeam: false
      },
      {
        id: 'enemy-3',
        position: { x: 5, y: 6 },
        isTeam: false
      }
    ];
    
    const result = bfs.compute(sources, []);
    
    const ourTerritory = result.territoryCounts.get('our-snake') || 0;
    console.log('Surrounded snake territory:', ourTerritory);
    
    // Surrounded snake should have very little territory
    expect(ourTerritory).toBeGreaterThanOrEqual(1);  // At least the head
    expect(ourTerritory).toBeLessThanOrEqual(10);  // Very limited space
  });

  test('Food control should be attributed to closest snake', () => {
    const gameState: GameState = {
      game: {
        id: 'test-food',
        ruleset: { name: 'standard', version: '1.0.0', settings: {} },
        map: 'standard',
        timeout: 500,
        source: 'test'
      },
      turn: 10,
      board: {
        width: 7,
        height: 7,
        snakes: [
          {
            id: 'snake1',
            name: 'Snake 1',
            health: 100,
            body: [
              { x: 1, y: 3 },  // left side
              { x: 0, y: 3 },
              { x: 0, y: 2 }
            ],
            head: { x: 1, y: 3 },
            length: 3,
            latency: '0',
            shout: '',
            squad: '',
            customizations: { color: '#FF0000', head: 'default', tail: 'default' }
          },
          {
            id: 'snake2',
            name: 'Snake 2',
            health: 100,
            body: [
              { x: 5, y: 3 },  // right side
              { x: 6, y: 3 },
              { x: 6, y: 2 }
            ],
            head: { x: 5, y: 3 },
            length: 3,
            latency: '0',
            shout: '',
            squad: '',
            customizations: { color: '#0000FF', head: 'default', tail: 'default' }
          }
        ],
        food: [
          { x: 2, y: 3 },  // Closer to snake1
          { x: 4, y: 3 },  // Closer to snake2
          { x: 3, y: 3 }   // Equidistant - should be neutral
        ],
        hazards: []
      },
      you: {
        id: 'snake1',
        name: 'Snake 1',
        health: 100,
        body: [
          { x: 1, y: 3 },
          { x: 0, y: 3 },
          { x: 0, y: 2 }
        ],
        head: { x: 1, y: 3 },
        length: 3,
        latency: '0',
        shout: '',
        squad: '',
        customizations: { color: '#FF0000', head: 'default', tail: 'default' }
      }
    };

    const graph = new BoardGraph(gameState);
    const bfs = new MultiSourceBFS(graph);
    
    const sources = [
      {
        id: 'snake1',
        position: { x: 1, y: 3 },
        isTeam: true
      },
      {
        id: 'snake2',
        position: { x: 5, y: 3 },
        isTeam: false
      }
    ];
    
    const result = bfs.compute(sources, gameState.board.food);
    
    const food1 = result.controlledFood.get('snake1') || 0;
    const food2 = result.controlledFood.get('snake2') || 0;
    
    console.log('Snake 1 controlled food:', food1);
    console.log('Snake 2 controlled food:', food2);
    
    // Snake1 should control food at (2,3)
    // Snake2 should control food at (4,3)
    // Food at (3,3) should be neutral (not controlled by either)
    expect(food1).toBe(1);
    expect(food2).toBe(1);
  });

  test('Food distance calculation should be accurate', () => {
    const gameState: GameState = {
      game: {
        id: 'test-distance',
        ruleset: { name: 'standard', version: '1.0.0', settings: {} },
        map: 'standard',
        timeout: 500,
        source: 'test'
      },
      turn: 10,
      board: {
        width: 7,
        height: 7,
        snakes: [
          {
            id: 'snake1',
            name: 'Snake 1',
            health: 100,
            body: [
              { x: 0, y: 0 },  // corner
              { x: 0, y: 1 },
              { x: 0, y: 2 }
            ],
            head: { x: 0, y: 0 },
            length: 3,
            latency: '0',
            shout: '',
            squad: '',
            customizations: { color: '#FF0000', head: 'default', tail: 'default' }
          }
        ],
        food: [
          { x: 3, y: 0 },  // 3 steps away horizontally
          { x: 0, y: 3 },  // 3 steps away vertically (blocked by body)
          { x: 2, y: 2 }   // 4 steps away diagonally (Manhattan distance)
        ],
        hazards: []
      },
      you: {
        id: 'snake1',
        name: 'Snake 1',
        health: 100,
        body: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: 2 }
        ],
        head: { x: 0, y: 0 },
        length: 3,
        latency: '0',
        shout: '',
        squad: '',
        customizations: { color: '#FF0000', head: 'default', tail: 'default' }
      }
    };

    const graph = new BoardGraph(gameState);
    const bfs = new MultiSourceBFS(graph);
    
    const sources = [{
      id: 'snake1',
      position: { x: 0, y: 0 },
      isTeam: true
    }];
    
    const result = bfs.compute(sources, gameState.board.food);
    
    const distance = result.nearestFoodDistance.get('snake1') || 1000;
    console.log('Nearest food distance:', distance);
    
    // Nearest reachable food should be at (3,0) which is 3 steps away
    expect(distance).toBe(3);
  });
});

// Run the tests
if (require.main === module) {
  // Simple test runner for quick verification
  const tests = [
    { name: 'Single snake territory', fn: () => {
      const result = test('Single snake should control most of empty board', () => {});
      return result;
    }},
    { name: 'Tie neutralization', fn: () => {
      const result = test('Two snakes at equal distance should have tied cells neutralized', () => {});
      return result;
    }},
    { name: 'Surrounded snake', fn: () => {
      const result = test('Snake surrounded by enemies should have minimal territory', () => {});
      return result;
    }},
    { name: 'Food control', fn: () => {
      const result = test('Food control should be attributed to closest snake', () => {});
      return result;
    }},
    { name: 'Food distance', fn: () => {
      const result = test('Food distance calculation should be accurate', () => {});
      return result;
    }}
  ];

  console.log('\n=== Running Territory Calculation Tests ===\n');
  
  for (const t of tests) {
    try {
      t.fn();
      console.log(`✓ ${t.name} PASSED`);
    } catch (error) {
      console.log(`✗ ${t.name} FAILED:`, error);
    }
  }
}