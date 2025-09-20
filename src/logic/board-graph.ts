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
    this.buildGraph(gameState);
  }
  
  /**
   * Build the graph representation with passability rules.
   */
  private buildGraph(gameState: GameState): void {
    const { board } = gameState;
    
    // Create set of blocked cells (snake bodies except possibly tails)
    const blockedCells = new Set<CellKey>();
    
    for (const snake of board.snakes) {
      if (snake.health <= 0) continue;
      
      // Add all body segments as blocked except possibly the tail
      for (let i = 0; i < snake.body.length; i++) {
        const segment = snake.body[i];
        const key = this.coordToKey(segment);
        
        // Tail special case
        if (i === snake.body.length - 1) {
          // Check if snake just ate (will grow)
          const justAte = this.snakeJustAte(snake, board.food);
          
          if (this.config.tailGrowthTiming === 'grow-same-turn' && justAte) {
            // Tail won't move this turn if snake just ate
            blockedCells.add(key);
          } else if (this.config.tailGrowthTiming === 'grow-next-turn') {
            // In grow-next-turn mode, tail always moves unless length is 1
            if (snake.body.length === 1) {
              // Single segment snake - the head/tail doesn't leave a space
              blockedCells.add(key);
            }
            // Otherwise tail will move, so it's not blocked
          }
        } else {
          // Non-tail segments are always blocked
          blockedCells.add(key);
        }
      }
    }
    
    // Build adjacency list for all cells
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const cellKey = this.coordToKey({ x, y });
        
        // Skip if this cell itself is blocked
        if (blockedCells.has(cellKey)) {
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
          if (!blockedCells.has(neighborKey)) {
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
   * Check if a cell is passable (not blocked).
   */
  isPassable(coord: Coord): boolean {
    const key = this.coordToKey(coord);
    const neighbors = this.adjacencyList.get(key);
    // A cell is passable if it exists and has at least one neighbor
    // (blocked cells have empty neighbor sets)
    return neighbors !== undefined && neighbors.size > 0;
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