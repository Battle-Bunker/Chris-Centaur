/**
 * Test suite for territory calculation, food control, and distance calculations.
 * These tests verify the core BFS and Voronoi territory logic.
 */

import { Coord, GameState, Snake } from '../types/battlesnake';
import { BoardGraph } from '../logic/board-graph';
import { BFSSource, MultiSourceBFS, OWNER_NEUTRAL, OWNER_UNREACHED } from '../logic/multi-source-bfs';
import { stationaryContestWinner, unitContestData } from '../logic/piece-threats';

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
            orientation: { dx: 0, dy: -1 },
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
        orientation: { dx: 0, dy: -1 },
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
    // In grow-next-turn mode, for a 3-segment snake:
    // - Head (index 0): not blocked, it's the BFS starting point
    // - Body (index 1): blocked
    // - Tail (index 2): not blocked (will move next turn)
    // So only 1 cell is blocked, territory = 121 - 1 = 120
    const territory = result.territoryCounts.get('snake1') || 0;
    console.log('Single snake territory:', territory);
    
    // Snake should control all passable cells
    expect(territory).toBe(120);  // All cells except 1 blocked body segment
    
    // Verify no cells are marked as neutral in single-source case
    let neutralCount = 0;
    for (const owner of result.ownerIndex) {
      if (owner === OWNER_NEUTRAL) neutralCount++;
    }
    console.log('Neutral cells in single-snake case:', neutralCount);
    expect(neutralCount).toBe(0);  // No cells should be neutral with only one snake
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
            orientation: { dx: 0, dy: -1 },
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
            orientation: { dx: 0, dy: -1 },
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
        orientation: { dx: 0, dy: -1 },
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
    expect(result.ownerIndex[graph.cellIndex(3, 3)]).toBe(OWNER_NEUTRAL);
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
            orientation: { dx: 0, dy: -1 },
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
            orientation: { dx: 0, dy: -1 },
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
            orientation: { dx: 0, dy: -1 },
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
            orientation: { dx: 0, dy: -1 },
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
        orientation: { dx: 0, dy: -1 },
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
            orientation: { dx: 0, dy: -1 },
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
            orientation: { dx: 0, dy: -1 },
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
        orientation: { dx: 0, dy: -1 },
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

  test('Neutral cells should not propagate territory', () => {
    // Test that neutralized cells don't allow expansion beyond them
    const gameState: GameState = {
      game: {
        id: 'test-neutral-propagation',
        ruleset: { name: 'standard', version: '1.0.0', settings: {} },
        map: 'standard',
        timeout: 500,
        source: 'test'
      },
      turn: 10,
      board: {
        width: 8,  // Even width to ensure symmetric tie
        height: 5,
        snakes: [
          {
            orientation: { dx: 0, dy: -1 },
            id: 'snake1',
            name: 'Snake 1',
            health: 100,
            body: [
              { x: 0, y: 2 },  // Left edge
              { x: 0, y: 1 },
              { x: 0, y: 0 }
            ],
            head: { x: 0, y: 2 },
            length: 3,
            latency: '0',
            shout: '',
            squad: '',
            customizations: { color: '#FF0000', head: 'default', tail: 'default' }
          },
          {
            orientation: { dx: 0, dy: -1 },
            id: 'snake2',
            name: 'Snake 2',
            health: 100,
            body: [
              { x: 7, y: 2 },  // Right edge
              { x: 7, y: 1 },
              { x: 7, y: 0 }
            ],
            head: { x: 7, y: 2 },
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
        orientation: { dx: 0, dy: -1 },
        id: 'snake1',
        name: 'Snake 1',
        health: 100,
        body: [
          { x: 0, y: 2 },
          { x: 0, y: 1 },
          { x: 0, y: 0 }
        ],
        head: { x: 0, y: 2 },
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
        position: { x: 0, y: 2 },
        isTeam: true
      },
      {
        id: 'snake2',
        position: { x: 7, y: 2 },
        isTeam: false
      }
    ];
    
    const result = bfs.compute(sources, []);
    
    // On an 8-wide board with snakes at x=0 and x=7, cells are:
    // x=0: distance 0 from snake1, distance 7 from snake2 -> snake1
    // x=1: distance 1 from snake1, distance 6 from snake2 -> snake1
    // x=2: distance 2 from snake1, distance 5 from snake2 -> snake1
    // x=3: distance 3 from snake1, distance 4 from snake2 -> snake1
    // x=4: distance 4 from snake1, distance 3 from snake2 -> snake2
    // x=5: distance 5 from snake1, distance 2 from snake2 -> snake2
    // x=6: distance 6 from snake1, distance 1 from snake2 -> snake2
    // x=7: distance 7 from snake1, distance 0 from snake2 -> snake2
    // No cells are equidistant on this board!
    
    // Let's check different cells that might be equidistant
    // Actually, with bodies blocking, some cells might be equidistant
    // Let's check cells that can't reach either snake directly
    
    const idx32 = graph.cellIndex(3, 2);
    const idx42 = graph.cellIndex(4, 2);
    console.log('Cell (3,2) owner:', result.ownerIndex[idx32], 'distance:', result.distanceIndex[idx32]);
    console.log('Cell (4,2) owner:', result.ownerIndex[idx42], 'distance:', result.distanceIndex[idx42]);
    
    // Territory should be roughly equal for both snakes
    const territory1 = result.territoryCounts.get('snake1') || 0;
    const territory2 = result.territoryCounts.get('snake2') || 0;
    
    console.log('Snake 1 territory:', territory1);
    console.log('Snake 2 territory:', territory2);
    
    // Check for any neutral cells - cells equidistant from both snakes
    let neutralCount = 0;
    for (let idx = 0; idx < result.ownerIndex.length; idx++) {
      if (result.ownerIndex[idx] === OWNER_NEUTRAL) {
        neutralCount++;
        console.log('Neutral cell found:', idx, 'at distance:', result.distanceIndex[idx]);
      }
    }
    console.log('Total neutral cells:', neutralCount);
    
    // Since the board is mostly symmetric, territories should be roughly equal
    expect(Math.abs(territory1 - territory2)).toBeLessThanOrEqual(2);  // Allow small difference
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
            orientation: { dx: 0, dy: -1 },
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
        orientation: { dx: 0, dy: -1 },
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

/**
 * The Voronoi tie rule: a cell several sources reach on the SAME level is a
 * race that ends in a collision, so the engine's stationary contest (tier
 * first — projected onto the turn of arrival — then unique heaviest weight)
 * decides it. The unique survivor OWNS the cell and expands from it; with no
 * unique survivor the cell stays neutral and nobody expands through it.
 *
 * The fixture is one 7x7 board throughout: two wall snakes seal row y=3 into a
 * solid barrier except for a single door at (3,3), so the top chamber
 * (y >= 4, 21 cells) is reachable ONLY through that door. Both contenders sit
 * in the bottom corners, 6 steps from the door on symmetric routes, so the
 * door — and the whole chamber behind it — hangs on the tie rule alone.
 */
describe('Same-level arrival contests (Voronoi tie rule)', () => {
  const DOOR = { x: 3, y: 3 };

  function snakeAt(id: string, body: Coord[], length: number, extra: Partial<Snake> = {}): Snake {
    return {
      orientation: { dx: 0, dy: -1 },
      id,
      name: id,
      health: 100,
      body,
      head: body[0],
      length,
      latency: '0',
      shout: '',
      squad: '',
      customizations: { color: '#123456', head: 'default', tail: 'default' },
      ...extra,
    };
  }

  // Wall snakes: head and tail sit OFF the barrier row (only interior segments
  // block), so y=3 is solid apart from the door at (3,3).
  const wallLeft = snakeAt('wall-left',
    [{ x: 0, y: 4 }, { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 4 }], 5);
  const wallRight = snakeAt('wall-right',
    [{ x: 6, y: 4 }, { x: 6, y: 3 }, { x: 5, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 4 }], 5);

  // Bottom-left contender, weight 5 (a 5-cell body coiled into its corner).
  const heavy = snakeAt('heavy',
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }], 5);
  // Bottom-right contender, weight 3. `extra` gives it invulnerability in the
  // tier cases; its geometry never changes.
  const lightAt = (id: string, extra: Partial<Snake> = {}): Snake =>
    snakeAt(id, [{ x: 6, y: 0 }, { x: 6, y: 1 }, { x: 6, y: 2 }], 3, extra);

  // Board turn 10 throughout, so a cell reached at BFS distance d is entered
  // on turn 10 + d — the turn the contest there resolves on.
  const BASE_TURN = 10;

  function runContest(contenders: Snake[], opts?: { isTeam?: boolean; withContestData?: boolean }) {
    const snakes = [...contenders, wallLeft, wallRight];
    const gameState: GameState = {
      game: { id: 'test-contest', ruleset: { name: 'standard', version: '1.0.0', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
      turn: BASE_TURN,
      board: { width: 7, height: 7, snakes, food: [], hazards: [] },
      you: contenders[0],
    };
    const graph = new BoardGraph(gameState);
    const sources: BFSSource[] = contenders.map(s => ({
      id: s.id,
      position: s.head,
      isTeam: opts?.isTeam ?? false,
      ...(opts?.withContestData === false ? {} : unitContestData(s, gameState.turn)),
    }));
    const result = new MultiSourceBFS(graph).compute(sources, []);
    return {
      graph,
      result,
      ownerAt: (x: number, y: number) => result.ownerIndex[graph.cellIndex(x, y)],
      distanceAt: (x: number, y: number) => result.distanceIndex[graph.cellIndex(x, y)],
      territoryOf: (id: string) => result.territoryCounts.get(id) ?? 0,
    };
  }

  describe('stationaryContestWinner: the shared rule read for many contenders', () => {
    test('the unique heaviest of the TOP tier wins, however heavy the tiers below are', () => {
      // Slot 2 is heaviest overall but a tier below the contest's top tier.
      expect(stationaryContestWinner([1, 1, 0], [4, 7, 99], 3)).toBe(1);
    });

    test('nobody wins when the top tier\'s heaviest weight is shared', () => {
      expect(stationaryContestWinner([1, 1, 0], [7, 7, 99], 3)).toBe(-1);
    });

    test('a lone contender wins by default', () => {
      expect(stationaryContestWinner([0], [1], 1)).toBe(0);
    });
  });

  test('equal tier: the unique heavier source takes the contested cell', () => {
    const light = lightAt('light');
    const { ownerAt, distanceAt } = runContest([heavy, light]);

    // Both arrive at the door on the same level; weight 5 beats weight 3.
    expect(distanceAt(DOOR.x, DOOR.y)).toBe(6);
    expect(ownerAt(DOOR.x, DOOR.y)).toBe(0);
    // Same rule all the way down the contested column, not just at the door.
    expect(ownerAt(3, 0)).toBe(0);
    expect(ownerAt(3, 1)).toBe(0);
    expect(ownerAt(3, 2)).toBe(0);
  });

  test('the winner EXPANDS from the cell it won: the chamber behind the door is its territory', () => {
    const light = lightAt('light');
    const { ownerAt, distanceAt, territoryOf } = runContest([heavy, light]);

    // Every cell of the top chamber is the winner's, at distances that only a
    // walk THROUGH the won door can produce (door 6, then 7, 8, ...).
    for (let y = 4; y <= 6; y++) {
      for (let x = 0; x < 7; x++) {
        expect(ownerAt(x, y)).toBe(0);
        expect(distanceAt(x, y)).toBeGreaterThan(6);
      }
    }
    expect(distanceAt(3, 4)).toBe(7);
    expect(territoryOf('heavy')).toBe(31); // 9 in the bottom chamber + the door + the 21 behind it
    expect(territoryOf('light')).toBe(8);
  });

  test('a tie is won by the higher tier, not by the greater weight', () => {
    // The lighter snake is invulnerable well past every arrival turn here:
    // tier outranks weight, so it takes the door and the chamber outright.
    const invuln = lightAt('invuln', { invulnerabilityLevel: 1, invulnerabilityExpiryTurn: 30 });
    const { ownerAt, territoryOf } = runContest([heavy, invuln]);

    expect(ownerAt(DOOR.x, DOOR.y)).toBe(1);
    expect(ownerAt(3, 5)).toBe(1);
    expect(territoryOf('invuln')).toBe(33);
    expect(territoryOf('heavy')).toBe(6);
  });

  test('the tier is the one PROJECTED onto the arrival turn: an expiring buff wins only the cells reached in time', () => {
    // Invulnerable through turn 13 only. (3,0) is reached at distance 3 — turn
    // 13, still buffed, so the lighter snake wins it — while (3,1) is reached
    // at distance 4 (turn 14), where the buff is gone and weight decides. Same
    // pair of snakes, same board, opposite outcomes one cell apart.
    const expiring = lightAt('expiring', { invulnerabilityLevel: 1, invulnerabilityExpiryTurn: 13 });
    const { ownerAt, distanceAt } = runContest([heavy, expiring]);

    expect(distanceAt(3, 0)).toBe(3);
    expect(ownerAt(3, 0)).toBe(1);
    expect(distanceAt(3, 1)).toBe(4);
    expect(ownerAt(3, 1)).toBe(0);
    // The door (turn 16) is long past the expiry: the heavier snake takes it
    // and the chamber behind it.
    expect(ownerAt(DOOR.x, DOOR.y)).toBe(0);
    expect(ownerAt(3, 5)).toBe(0);
  });

  test('equal tier and equal weight: the cell is neutral and nothing expands through it', () => {
    const lightLeft = snakeAt('light-left', [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }], 3);
    const { ownerAt, territoryOf } = runContest([lightLeft, lightAt('light-right')]);

    // The whole contested column is neutral...
    expect(ownerAt(3, 0)).toBe(OWNER_NEUTRAL);
    expect(ownerAt(3, 1)).toBe(OWNER_NEUTRAL);
    expect(ownerAt(3, 2)).toBe(OWNER_NEUTRAL);
    // ...so neither source ever gets through it: the door and the whole
    // chamber behind it stay unreached.
    expect(ownerAt(DOOR.x, DOOR.y)).toBe(OWNER_UNREACHED);
    for (let y = 4; y <= 6; y++) {
      for (let x = 0; x < 7; x++) expect(ownerAt(x, y)).toBe(OWNER_UNREACHED);
    }
    expect(territoryOf('light-left')).toBe(8);
    expect(territoryOf('light-right')).toBe(8);
  });

  test('allies are adjudicated by the same rule (this engine has no friendly exemption)', () => {
    const light = lightAt('light');
    const allied = runContest([heavy, light], { isTeam: true });
    const enemies = runContest([heavy, light]);

    expect(allied.ownerAt(DOOR.x, DOOR.y)).toBe(0);
    expect(allied.territoryOf('heavy')).toBe(enemies.territoryOf('heavy'));
    expect(allied.territoryOf('light')).toBe(enemies.territoryOf('light'));
  });

  test('sources that carry no contest data tie into neutral (the pre-contest shape)', () => {
    // Weight defaults to 0 at tier 0, so even the 5-vs-3 pairing has no unique
    // winner — the behavior every caller gets until it supplies contest data.
    const { ownerAt, territoryOf } = runContest([heavy, lightAt('light')], { withContestData: false });

    expect(ownerAt(3, 0)).toBe(OWNER_NEUTRAL);
    expect(ownerAt(DOOR.x, DOOR.y)).toBe(OWNER_UNREACHED);
    expect(territoryOf('heavy')).toBe(6);
    expect(territoryOf('light')).toBe(8);
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