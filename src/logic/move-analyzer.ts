/**
 * Unified move analyzer that provides a single source of truth for move safety.
 * Returns both safe moves (definite survival) and risky moves (possible head-to-head death).
 */

import { GameState, Snake, Direction, Coord } from '../types/battlesnake';
import { TurnStateManager } from './turn-state';
import { BoardGraph } from './board-graph';

export interface H2HRiskInfo {
  hasEnemyRisk: boolean;   // Risk of h2h with equal/larger enemy
  hasAllyRisk: boolean;    // Risk of h2h with equal/larger ally
  enemyRiskCount: number;  // Number of threatening enemies
  allyRiskCount: number;   // Number of threatening allies
}

export interface MoveAnalysis {
  safe: Direction[];   // Moves that definitely won't cause death
  risky: Direction[];  // Moves that could result in head-to-head death
  h2hRiskByMove: Map<Direction, H2HRiskInfo>;  // H2H risk details per move
}

export class MoveAnalyzer {
  private tailSafetyRule: 'official' | 'custom';
  
  constructor(tailSafetyRule: 'official' | 'custom' = 'custom') {
    this.tailSafetyRule = tailSafetyRule;
  }
  /**
   * Analyzes available moves for a snake and categorizes them as safe or risky.
   * This is the single source of truth for move safety in the entire codebase.
   * Uses BoardGraph as the single source of truth for passability.
   */
  public analyzeMoves(snake: Snake, gameState: GameState, graph: BoardGraph, teamSnakeIds?: Set<string>): MoveAnalysis {
    // Update turn state to track which snakes ate food
    const turnStateManager = TurnStateManager.getInstance();
    turnStateManager.updateState(
      gameState.game.id, 
      gameState.turn, 
      gameState.board.snakes.map(s => ({id: s.id, length: s.length}))
    );
    const head = snake.head;
    const allDirections: Direction[] = ['up', 'down', 'left', 'right'];
    const safe: Direction[] = [];
    const risky: Direction[] = [];
    const h2hRiskByMove = new Map<Direction, H2HRiskInfo>();
    
    // Analyze each possible move
    for (const direction of allDirections) {
      const newPosition = this.getNextPosition(head, direction);
      
      // Check for certain death using BoardGraph's passability (walls, bodies, hazards)
      if (!graph.isPassable(newPosition)) {
        // This move causes certain death - exclude it entirely
        continue;
      }
      
      // Get detailed head-to-head risk information
      const h2hRisk = this.getHeadToHeadRiskInfo(newPosition, snake, gameState, teamSnakeIds);
      h2hRiskByMove.set(direction, h2hRisk);
      
      // Check for head-to-head risk (any risk = risky move)
      if (h2hRisk.hasEnemyRisk || h2hRisk.hasAllyRisk) {
        risky.push(direction);
      } else {
        safe.push(direction);
      }
    }
    
    return { safe, risky, h2hRiskByMove };
  }
  
  /**
   * Checks if a position has risk of head-to-head collision.
   * Only considers collisions where we would lose or tie.
   */
  private hasHeadToHeadRisk(position: Coord, snake: Snake, gameState: GameState): boolean {
    const { board } = gameState;
    
    for (const enemySnake of board.snakes) {
      // Skip ourselves and dead snakes
      if (enemySnake.id === snake.id || enemySnake.health <= 0) continue;
      
      // Check if enemy head is adjacent to our potential position
      const enemyHead = enemySnake.head;
      const distance = Math.abs(position.x - enemyHead.x) + Math.abs(position.y - enemyHead.y);
      
      if (distance === 1) {
        // Enemy could move to our position next turn
        // This is risky if we would lose (smaller) or tie (same size)
        if (snake.length <= enemySnake.length) {
          return true; // Risky head-to-head
        }
      }
    }
    
    return false; // No head-to-head risk
  }
  
  /**
   * Gets detailed head-to-head risk information for a position.
   * Distinguishes between enemy and ally h2h risks.
   */
  private getHeadToHeadRiskInfo(position: Coord, snake: Snake, gameState: GameState, teamSnakeIds?: Set<string>): H2HRiskInfo {
    const { board } = gameState;
    const result: H2HRiskInfo = {
      hasEnemyRisk: false,
      hasAllyRisk: false,
      enemyRiskCount: 0,
      allyRiskCount: 0
    };
    
    for (const otherSnake of board.snakes) {
      // Skip ourselves and dead snakes
      if (otherSnake.id === snake.id || otherSnake.health <= 0) continue;
      
      // Check if other snake's head is adjacent to our potential position
      const otherHead = otherSnake.head;
      const distance = Math.abs(position.x - otherHead.x) + Math.abs(position.y - otherHead.y);
      
      if (distance === 1) {
        // Other snake could move to our position next turn
        // This is risky if we would lose (smaller) or tie (same size)
        if (snake.length <= otherSnake.length) {
          // Determine if this is an ally or enemy
          const isAlly = teamSnakeIds?.has(otherSnake.id) ?? false;
          
          if (isAlly) {
            result.hasAllyRisk = true;
            result.allyRiskCount++;
          } else {
            result.hasEnemyRisk = true;
            result.enemyRiskCount++;
          }
        }
      }
    }
    
    return result;
  }
  
  /**
   * Gets the next position given a current position and direction.
   */
  private getNextPosition(position: Coord, direction: Direction): Coord {
    switch (direction) {
      case 'up':
        return { x: position.x, y: position.y + 1 };
      case 'down':
        return { x: position.x, y: position.y - 1 };
      case 'left':
        return { x: position.x - 1, y: position.y };
      case 'right':
        return { x: position.x + 1, y: position.y };
    }
  }
}