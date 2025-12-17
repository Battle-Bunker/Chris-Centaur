/**
 * Board graph representation for unified pathfinding.
 * Builds an unweighted graph with edges only for passable boundaries.
 */

import { GameState, Coord, Snake } from '../types/battlesnake';

export type CellKey = string;

export interface BoardGraphConfig {
  // Tail growth variant: 
  // 'grow-same-turn' - snake grows immediately when eating (tail doesn't move)
  // 'grow-next-turn' - snake grows on turn after eating (tail moves when eating)
  tailGrowthTiming: 'grow-same-turn' | 'grow-next-turn';
}

export class BoardGraph {
  private adjacencyList: Map<CellKey, Set<CellKey>>;
  private blockedCells: Set<CellKey>;
  private width: number;
  private height: number;
  private config: BoardGraphConfig;
  
  constructor(gameState: GameState, config?: Partial<BoardGraphConfig>) {
    this.width = gameState.board.width;
    this.height = gameState.board.height;
    this.config = {
      tailGrowthTiming: 'grow-next-turn',
      ...config
    };
    
    this.adjacencyList = new Map();
    this.blockedCells = new Set();
    this.buildGraph(gameState);
  }
  
  /**
   * Build the graph representation with passability rules.
   * Snake heads are NOT blocked - they are starting points for territory calculation.
   * Only snake body segments (excluding heads and possibly tails) are blocked.
   */
  private buildGraph(gameState: GameState): void {
    const { board } = gameState;
    
    // Clear and rebuild blocked cells set
    this.blockedCells.clear();
    
    // Add snake bodies as blocked (except heads and possibly tails)
    for (const snake of board.snakes) {
      if (snake.health <= 0) continue;
      
      // Add body segments as blocked (but NOT the head at index 0)
      for (let i = 1; i < snake.body.length; i++) {  // Start from 1 to skip head
        const segment = snake.body[i];
        const key = this.coordToKey(segment);
        
        // Tail special case (last segment)
        if (i === snake.body.length - 1) {
          // Check if snake just ate (will grow)
          const justAte = this.snakeJustAte(snake, board.food);
          
          if (this.config.tailGrowthTiming === 'grow-same-turn' && justAte) {
            // Tail won't move this turn if snake just ate
            this.blockedCells.add(key);
          } else if (this.config.tailGrowthTiming === 'grow-next-turn') {
            // In grow-next-turn mode, tail always moves unless it's the only body segment after head
            // (Note: we already skip head, so length-1 here means 2 total segments)
            if (snake.body.length === 2) {
              // Two segment snake - tail doesn't leave a space
              this.blockedCells.add(key);
            }
            // Otherwise tail will move, so it's not blocked
          }
        } else {
          // Non-tail, non-head segments are always blocked
          this.blockedCells.add(key);
        }
      }
    }
    
    // Add hazards as blocked (impassable terrain)
    for (const hazard of board.hazards) {
      this.blockedCells.add(this.coordToKey(hazard));
    }
    
    // Build adjacency list for all cells
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const cellKey = this.coordToKey({ x, y });
        
        // Skip if this cell itself is blocked
        if (this.blockedCells.has(cellKey)) {
          this.adjacencyList.set(cellKey, new Set());
          continue;
        }
        
        // Check all four neighbors
        const neighbors: Coord[] = [
          { x: x, y: y + 1 },  // up
          { x: x, y: y - 1 },  // down
          { x: x - 1, y: y },  // left
          { x: x + 1, y: y }   // right
        ];
        
        const passableNeighbors = new Set<CellKey>();
        
        for (const neighbor of neighbors) {
          // Check bounds
          if (neighbor.x < 0 || neighbor.x >= this.width ||
              neighbor.y < 0 || neighbor.y >= this.height) {
            continue;  // Out of bounds
          }
          
          const neighborKey = this.coordToKey(neighbor);
          
          // Check if neighbor is blocked
          if (!this.blockedCells.has(neighborKey)) {
            passableNeighbors.add(neighborKey);
          }
        }
        
        this.adjacencyList.set(cellKey, passableNeighbors);
      }
    }
  }
  
  /**
   * Check if a snake just ate food (head is on food).
   */
  private snakeJustAte(snake: Snake, food: Coord[]): boolean {
    return food.some(f => 
      f.x === snake.head.x && f.y === snake.head.y
    );
  }
  
  /**
   * Get passable neighbors for a cell.
   */
  getNeighbors(coord: Coord): Coord[] {
    const key = this.coordToKey(coord);
    const neighborKeys = this.adjacencyList.get(key);
    
    if (!neighborKeys) {
      return [];
    }
    
    return Array.from(neighborKeys).map(k => this.keyToCoord(k));
  }
  
  /**
   * Check if a coordinate is within board bounds.
   */
  isInBounds(coord: Coord): boolean {
    return coord.x >= 0 && coord.x < this.width &&
           coord.y >= 0 && coord.y < this.height;
  }
  
  /**
   * Check if a cell is passable (in bounds and not blocked).
   * This is the single source of truth for passability.
   */
  isPassable(coord: Coord): boolean {
    if (!this.isInBounds(coord)) {
      return false;
    }
    const key = this.coordToKey(coord);
    return !this.blockedCells.has(key);
  }
  
  /**
   * Get the set of blocked cell keys (for direct iteration if needed).
   */
  getBlockedCells(): Set<CellKey> {
    return this.blockedCells;
  }
  
  /**
   * Convert coordinate to string key.
   */
  coordToKey(coord: Coord): CellKey {
    return `${coord.x},${coord.y}`;
  }
  
  /**
   * Convert string key to coordinate.
   */
  keyToCoord(key: CellKey): Coord {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  }
  
  /**
   * Get all cells in the board.
   */
  getAllCells(): Coord[] {
    const cells: Coord[] = [];
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        cells.push({ x, y });
      }
    }
    return cells;
  }
}