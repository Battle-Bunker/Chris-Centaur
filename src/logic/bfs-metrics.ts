import { Board, Snake } from '../types/battlesnake';

export interface TerritoryMetrics {
  perSnakeMetrics: Map<string, SnakeMetrics>;
  totalAssigned: number;
  totalUnassigned: number;
}

export interface SnakeMetrics {
  territory: number;
  foodCount: number;
  fertileScore: number;
  nearestFoodDistance: number; // Distance from head to nearest food in territory
  teamId: string;
}

interface CellClaim {
  snakeIdx: number;
  distance: number;
}

export class MultiHeadMetricsBFS {
  private readonly FOOD_BONUS = 10;

  /**
   * Compute all metrics in a single level-synchronous BFS pass
   */
  public computeMetrics(board: Board, aliveSnakes: Snake[]): TerritoryMetrics {
    const width = board.width;
    const height = board.height;
    const gridSize = width * height;
    
    // Use typed arrays for performance
    const owners = new Int16Array(gridSize);
    owners.fill(-1); // -1 = unassigned
    
    // Create snake index map for quick lookup
    const snakeIndexMap = new Map<string, number>();
    const snakeByIndex = new Map<number, Snake>();
    const snakeFoodDistances = new Map<number, number>();
    
    aliveSnakes.forEach((snake, index) => {
      snakeIndexMap.set(snake.id, index);
      snakeByIndex.set(index, snake);
      snakeFoodDistances.set(index, Number.MAX_SAFE_INTEGER);
    });
    
    // Pre-calculate food positions for quick lookup
    const foodPositions = new Set<number>();
    for (const food of board.food) {
      foodPositions.add(width * food.y + food.x);
    }
    
    // Pre-calculate occupied positions (snake bodies)
    const occupied = new Set<number>();
    for (const snake of aliveSnakes) {
      for (const segment of snake.body) {
        occupied.add(width * segment.y + segment.x);
      }
    }
    
    // Level-synchronous BFS
    let currentLevel: Array<{pos: number, snakeIdx: number}> = [];
    let visited = new Set<number>();
    
    // Initialize with snake heads
    for (const snake of aliveSnakes) {
      const idx = snakeIndexMap.get(snake.id)!;
      const pos = width * snake.head.y + snake.head.x;
      
      currentLevel.push({ pos, snakeIdx: idx });
      owners[pos] = idx;
      visited.add(pos);
      
      // Check if head is on food
      if (foodPositions.has(pos)) {
        snakeFoodDistances.set(idx, 0);
      }
    }
    
    let distance = 0;
    
    // Process level by level
    while (currentLevel.length > 0) {
      const nextLevel: Array<{pos: number, snakeIdx: number}> = [];
      const levelClaims = new Map<number, CellClaim[]>(); // pos -> list of claims
      
      // Expand all nodes in current level
      for (const {pos, snakeIdx} of currentLevel) {
        const x = pos % width;
        const y = Math.floor(pos / width);
        
        // Try all 4 directions
        const moves = [
          { dx: 0, dy: 1 },  // up
          { dx: 0, dy: -1 }, // down
          { dx: -1, dy: 0 }, // left
          { dx: 1, dy: 0 }   // right
        ];
        
        for (const {dx, dy} of moves) {
          const newX = x + dx;
          const newY = y + dy;
          
          // Check bounds
          if (newX < 0 || newX >= width || newY < 0 || newY >= height) {
            continue;
          }
          
          const newPos = width * newY + newX;
          
          // Skip if occupied by snake body
          if (occupied.has(newPos)) {
            continue;
          }
          
          // Skip if already visited
          if (visited.has(newPos)) {
            continue;
          }
          
          // Add claim for this cell
          if (!levelClaims.has(newPos)) {
            levelClaims.set(newPos, []);
          }
          levelClaims.get(newPos)!.push({
            snakeIdx,
            distance: distance + 1
          });
        }
      }
      
      // Resolve ownership for all cells in this level
      for (const [pos, claims] of levelClaims.entries()) {
        visited.add(pos);
        
        if (claims.length === 1) {
          // Single claim - easy case
          const claim = claims[0];
          owners[pos] = claim.snakeIdx;
          nextLevel.push({ pos, snakeIdx: claim.snakeIdx });
          
          // Check for food and update distance if this is the first food found
          if (foodPositions.has(pos)) {
            const currentDist = snakeFoodDistances.get(claim.snakeIdx)!;
            if (claim.distance < currentDist) {
              snakeFoodDistances.set(claim.snakeIdx, claim.distance);
            }
          }
        } else {
          // Multiple claims - resolve by snake length
          const claimingSnakes = claims.map(c => ({
            idx: c.snakeIdx,
            length: snakeByIndex.get(c.snakeIdx)!.length,
            distance: c.distance
          }));
          
          const maxLength = Math.max(...claimingSnakes.map(s => s.length));
          const winners = claimingSnakes.filter(s => s.length === maxLength);
          
          if (winners.length === 1) {
            // Longest snake wins
            const winner = winners[0];
            owners[pos] = winner.idx;
            nextLevel.push({ pos, snakeIdx: winner.idx });
            
            // Check for food
            if (foodPositions.has(pos)) {
              const currentDist = snakeFoodDistances.get(winner.idx)!;
              if (winner.distance < currentDist) {
                snakeFoodDistances.set(winner.idx, winner.distance);
              }
            }
          } else {
            // Equal length - neutral territory, no one expands from here
            owners[pos] = -1;
          }
        }
      }
      
      // Move to next level
      currentLevel = nextLevel;
      distance++;
    }
    
    // Calculate final metrics
    return this.calculateMetrics(
      board,
      aliveSnakes,
      owners,
      snakeFoodDistances,
      snakeIndexMap,
      width,
      height
    );
  }

  /**
   * Calculate final metrics from computed data
   */
  private calculateMetrics(
    board: Board,
    snakes: Snake[],
    owners: Int16Array,
    snakeFoodDistances: Map<number, number>,
    snakeIndexMap: Map<string, number>,
    width: number,
    height: number
  ): TerritoryMetrics {
    const perSnakeMetrics = new Map<string, SnakeMetrics>();
    
    // Initialize metrics for each snake
    for (const snake of snakes) {
      const idx = snakeIndexMap.get(snake.id)!;
      const foodDist = snakeFoodDistances.get(idx)!;
      
      perSnakeMetrics.set(snake.id, {
        territory: 0,
        foodCount: 0,
        fertileScore: 0,
        nearestFoodDistance: foodDist === Number.MAX_SAFE_INTEGER ? 1000 : foodDist,
        teamId: snake.squad || snake.id // Use squad as team ID, fallback to snake ID
      });
    }
    
    // Count territory and food for each snake
    let totalAssigned = 0;
    let totalUnassigned = 0;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pos = width * y + x;
        const owner = owners[pos];
        
        if (owner === -1) {
          totalUnassigned++;
        } else {
          totalAssigned++;
          
          // Find snake by index
          const snake = snakes.find(s => snakeIndexMap.get(s.id) === owner);
          if (snake && perSnakeMetrics.has(snake.id)) {
            const metrics = perSnakeMetrics.get(snake.id)!;
            metrics.territory++;
            
            // Check if this cell has food
            const hasFood = board.food.some(f => f.x === x && f.y === y);
            if (hasFood) {
              metrics.foodCount++;
            }
          }
        }
      }
    }
    
    // Calculate fertile scores
    for (const [, metrics] of perSnakeMetrics.entries()) {
      metrics.fertileScore = metrics.territory + (metrics.foodCount * this.FOOD_BONUS);
    }
    
    return {
      perSnakeMetrics,
      totalAssigned,
      totalUnassigned
    };
  }
}