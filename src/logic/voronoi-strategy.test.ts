import { VoronoiStrategy } from './voronoi-strategy';
import { GameState, Snake, Board, Game } from '../types/battlesnake';

describe('VoronoiStrategy', () => {
  let strategy: VoronoiStrategy;
  
  beforeEach(() => {
    strategy = new VoronoiStrategy();
  });

  function createBasicGameState(
    yourSnake: Partial<Snake>,
    otherSnakes: Partial<Snake>[] = [],
    boardSize = 11
  ): GameState {
    const defaultSnake: Snake = {
      id: 'test-snake',
      name: 'Test Snake',
      latency: '100',
      health: 100,
      body: [],
      head: { x: 0, y: 0 },
      length: 3,
      shout: '',
      squad: '',
      customizations: { color: '#FF0000', head: 'default', tail: 'default' }
    };

    const you = { ...defaultSnake, ...yourSnake };
    
    const snakes = [
      you,
      ...otherSnakes.map((s, i) => ({
        ...defaultSnake,
        id: `enemy-${i}`,
        name: `Enemy ${i}`,
        ...s
      }))
    ];

    const board: Board = {
      width: boardSize,
      height: boardSize,
      snakes,
      food: [],
      hazards: []
    };

    const game: Game = {
      id: 'test-game',
      ruleset: { name: 'standard', version: '1.0.0', settings: {} },
      map: 'standard',
      timeout: 500,
      source: 'test'
    };

    return {
      game,
      turn: 0,
      board,
      you
    };
  }

  describe('Boundary Detection', () => {
    test('should not move out of bounds when snake is at top edge', () => {
      const gameState = createBasicGameState({
        head: { x: 5, y: 0 },
        body: [{ x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }]
      });

      const result = strategy.getBestMoveWithDebug(gameState);
      
      // Should not move up when at y=0
      expect(result.move).not.toBe('up');
      expect(result.safeMoves).not.toContain('up');
    });

    test('should not move out of bounds when snake is at bottom edge', () => {
      const gameState = createBasicGameState({
        head: { x: 5, y: 10 },
        body: [{ x: 5, y: 10 }, { x: 5, y: 9 }, { x: 5, y: 8 }]
      });

      const result = strategy.getBestMoveWithDebug(gameState);
      
      // Should not move down when at y=10 (board height is 11, so max y is 10)
      expect(result.move).not.toBe('down');
      expect(result.safeMoves).not.toContain('down');
    });

    test('should not move out of bounds when snake is at left edge', () => {
      const gameState = createBasicGameState({
        head: { x: 0, y: 5 },
        body: [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }]
      });

      const result = strategy.getBestMoveWithDebug(gameState);
      
      // Should not move left when at x=0
      expect(result.move).not.toBe('left');
      expect(result.safeMoves).not.toContain('left');
    });

    test('should not move out of bounds when snake is at right edge', () => {
      const gameState = createBasicGameState({
        head: { x: 10, y: 5 },
        body: [{ x: 10, y: 5 }, { x: 9, y: 5 }, { x: 8, y: 5 }]
      });

      const result = strategy.getBestMoveWithDebug(gameState);
      
      // Should not move right when at x=10 (board width is 11, so max x is 10)
      expect(result.move).not.toBe('right');
      expect(result.safeMoves).not.toContain('right');
    });

    test('should handle corner positions correctly', () => {
      // Top-left corner
      const topLeft = createBasicGameState({
        head: { x: 0, y: 0 },
        body: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]
      });

      const topLeftResult = strategy.getBestMoveWithDebug(topLeft);
      expect(topLeftResult.safeMoves).not.toContain('up');
      expect(topLeftResult.safeMoves).not.toContain('left');
      expect(topLeftResult.safeMoves).toContain('down');
      // Right might be blocked by body

      // Bottom-right corner
      const bottomRight = createBasicGameState({
        head: { x: 10, y: 10 },
        body: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }]
      });

      const bottomRightResult = strategy.getBestMoveWithDebug(bottomRight);
      expect(bottomRightResult.safeMoves).not.toContain('down');
      expect(bottomRightResult.safeMoves).not.toContain('right');
      expect(bottomRightResult.safeMoves).toContain('up');
      // Left might be blocked by body
    });
  });

  describe('Collision Detection', () => {
    test('should not collide with own body', () => {
      const gameState = createBasicGameState({
        head: { x: 5, y: 5 },
        body: [
          { x: 5, y: 5 }, // head
          { x: 5, y: 6 }, // body
          { x: 4, y: 6 }, // body
          { x: 4, y: 5 }  // body (blocks left)
        ]
      });

      const result = strategy.getBestMoveWithDebug(gameState);
      
      // Should not move left into own body at (4,5)
      expect(result.safeMoves).not.toContain('left');
      // Should not move down into own body at (5,6)
      expect(result.safeMoves).not.toContain('down');
    });

    test('should not collide with enemy snakes', () => {
      const gameState = createBasicGameState(
        {
          head: { x: 5, y: 5 },
          body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }]
        },
        [{
          head: { x: 6, y: 5 },
          body: [
            { x: 6, y: 5 }, // enemy head
            { x: 7, y: 5 }, // enemy body
            { x: 7, y: 6 }  // enemy body
          ]
        }]
      );

      const result = strategy.getBestMoveWithDebug(gameState);
      
      // Should not move right into enemy at (6,5)
      expect(result.safeMoves).not.toContain('right');
    });

    test('should allow moving to tail positions', () => {
      const gameState = createBasicGameState({
        head: { x: 5, y: 5 },
        body: [
          { x: 5, y: 5 }, // head
          { x: 4, y: 5 }, // body
          { x: 3, y: 5 }, // body
          { x: 3, y: 6 }  // tail
        ]
      });

      // Place the snake so it can move to where its tail currently is
      gameState.you.head = { x: 3, y: 7 };
      gameState.you.body[0] = { x: 3, y: 7 };
      gameState.board.snakes[0] = gameState.you;

      const result = strategy.getBestMoveWithDebug(gameState);
      
      // Moving up from (3,7) to (3,6) where the tail is should be safe
      expect(result.safeMoves).toContain('up');
    });
  });

  describe('Head-to-Head Collision', () => {
    test('should avoid head-to-head with longer snakes', () => {
      const gameState = createBasicGameState(
        {
          head: { x: 5, y: 5 },
          body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }],
          length: 3
        },
        [{
          head: { x: 7, y: 5 },
          body: [{ x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }, { x: 10, y: 5 }],
          length: 4
        }]
      );

      const result = strategy.getBestMoveWithDebug(gameState);
      
      // Position (6,5) could lead to head-to-head with longer snake
      // The strategy should prefer other moves
      if (result.safeMoves.includes('right')) {
        // Right is technically "safe" but should have lower score
        expect(result.scores.get('right')).toBeLessThanOrEqual(
          Math.max(...Array.from(result.scores.values()).filter((_, i) => i !== 1))
        );
      }
    });

    test('should be willing to face head-to-head with shorter snakes', () => {
      const gameState = createBasicGameState(
        {
          head: { x: 5, y: 5 },
          body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 2 }],
          length: 4
        },
        [{
          head: { x: 7, y: 5 },
          body: [{ x: 7, y: 5 }, { x: 8, y: 5 }],
          length: 2
        }]
      );

      const result = strategy.getBestMoveWithDebug(gameState);
      
      // Moving right toward shorter snake should be considered safe
      expect(result.safeMoves).toContain('right');
    });
  });

  describe('Basic Movement', () => {
    test('should find at least one safe move in open space', () => {
      const gameState = createBasicGameState({
        head: { x: 5, y: 5 },
        body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }]
      });

      const result = strategy.getBestMoveWithDebug(gameState);
      
      expect(result.safeMoves.length).toBeGreaterThan(0);
      expect(result.move).toBeDefined();
      expect(['up', 'down', 'left', 'right']).toContain(result.move);
    });

    test('should return fallback move when no safe moves exist', () => {
      // Create an impossible situation where snake is surrounded
      const gameState = createBasicGameState(
        {
          head: { x: 1, y: 1 },
          body: [{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }]
        },
        [
          {
            head: { x: 2, y: 1 },
            body: [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }]
          },
          {
            head: { x: 0, y: 1 },
            body: [{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }]
          }
        ]
      );

      const result = strategy.getBestMoveWithDebug(gameState);
      
      // Should still return a move even if no safe moves
      expect(result.move).toBeDefined();
      expect(['up', 'down', 'left', 'right']).toContain(result.move);
    });
  });

  describe('Territory Calculation', () => {
    test('should calculate non-zero territory for valid board states', () => {
      const gameState = createBasicGameState(
        {
          head: { x: 2, y: 2 },
          body: [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }]
        },
        [{
          head: { x: 8, y: 8 },
          body: [{ x: 8, y: 8 }, { x: 8, y: 7 }, { x: 8, y: 6 }]
        }]
      );

      const result = strategy.getBestMoveWithDebug(gameState);
      
      // Should have calculated scores for safe moves
      expect(result.scores.size).toBeGreaterThan(0);
      
      // All scores should be non-negative (territory can't be negative)
      result.scores.forEach(score => {
        expect(score).toBeGreaterThanOrEqual(0);
      });
    });
  });
});