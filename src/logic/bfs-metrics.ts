import { Board, Coord, Snake } from '../types/battlesnake';

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

export class MultiHeadMetricsBFS {
  private readonly FOOD_BONUS = 10;

  /**
   * Compute all metrics in a single unified BFS pass
   */
  public computeMetrics(board: Board, aliveSnakes: Snake[]): TerritoryMetrics {
    const width = board.width;
    const height = board.height;
    const gridSize = width * height;
    
    // Use typed arrays for performance
    const owners = new Int16Array(gridSize);
    const distances = new Int16Array(gridSize);
    const foodDistances = new Int16Array(gridSize);
    
    // Initialize arrays
    owners.fill(-1); // -1 = unassigned
    distances.fill(Number.MAX_SAFE_INTEGER);
    foodDistances.fill(Number.MAX_SAFE_INTEGER);
    
    // Create snake index map for quick lookup
    const snakeIndexMap = new Map<string, number>();
    const snakeByIndex = new Map<number, Snake>();
    aliveSnakes.forEach((snake, index) => {
      snakeIndexMap.set(snake.id, index);
      snakeByIndex.set(index, snake);
    });
    
    // Phase 1: Multi-source BFS from all snake heads
    this.computeTerritoryOwnership(
      board, 
      aliveSnakes, 
      owners, 
      distances, 
      snakeIndexMap,
      snakeByIndex
    );
    
    // Phase 2: BFS from food to compute territory-restricted distances
    this.computeFoodDistances(
      board,
      owners,
      foodDistances,
      width,
      height
    );
    
    // Calculate metrics
    return this.calculateMetrics(
      board,
      aliveSnakes,
      owners,
      foodDistances,
      snakeIndexMap,
      width,
      height
    );
  }

  /**
   * Phase 1: Multi-source BFS to determine territory ownership
   */
  private computeTerritoryOwnership(
    board: Board,
    snakes: Snake[],
    owners: Int16Array,
    distances: Int16Array,
    snakeIndexMap: Map<string, number>,
    snakeByIndex: Map<number, Snake>
  ): void {
    const width = board.width;
    const height = board.height;
    const queue: Array<{x: number, y: number, dist: number, snakeIdx: number}> = [];
    
    // Initialize queue with all snake heads
    for (const snake of snakes) {
      const idx = snakeIndexMap.get(snake.id)!;
      const pos = width * snake.head.y + snake.head.x;
      
      queue.push({
        x: snake.head.x,
        y: snake.head.y,
        dist: 0,
        snakeIdx: idx
      });
      
      owners[pos] = idx;
      distances[pos] = 0;
    }
    
    // Track cells with equal distance claims for tie resolution
    const tiedCells = new Map<number, number[]>(); // position -> [snakeIdx1, snakeIdx2, ...]
    
    // BFS
    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const current = queue[queueIndex++];
      
      // Check all 4 directions
      const moves = [
        { x: current.x, y: current.y + 1 }, // up
        { x: current.x, y: current.y - 1 }, // down
        { x: current.x - 1, y: current.y }, // left
        { x: current.x + 1, y: current.y }  // right
      ];
      
      for (const move of moves) {
        // Check bounds
        if (move.x < 0 || move.x >= width || move.y < 0 || move.y >= height) {
          continue;
        }
        
        const pos = width * move.y + move.x;
        
        // Check if occupied by snake body
        if (this.isOccupied(move, snakes)) {
          continue;
        }
        
        const newDist = current.dist + 1;
        
        if (newDist < distances[pos]) {
          // This snake is closer, claim the cell
          owners[pos] = current.snakeIdx;
          distances[pos] = newDist;
          
          // Remove from tied cells if it was tied
          tiedCells.delete(pos);
          
          queue.push({
            x: move.x,
            y: move.y,
            dist: newDist,
            snakeIdx: current.snakeIdx
          });
        } else if (newDist === distances[pos] && owners[pos] !== current.snakeIdx) {
          // Equal distance - mark as tied for later resolution
          if (!tiedCells.has(pos)) {
            tiedCells.set(pos, [owners[pos]]);
          }
          tiedCells.get(pos)!.push(current.snakeIdx);
        }
      }
    }
    
    // Resolve ties: longest snake wins, or neutral if equal length
    for (const [pos, snakeIndices] of tiedCells.entries()) {
      const uniqueIndices = [...new Set(snakeIndices)];
      const snakeLengths = uniqueIndices.map(idx => ({
        idx,
        length: snakeByIndex.get(idx)!.length
      }));
      
      const maxLength = Math.max(...snakeLengths.map(s => s.length));
      const winners = snakeLengths.filter(s => s.length === maxLength);
      
      if (winners.length === 1) {
        // Longest snake wins
        owners[pos] = winners[0].idx;
      } else {
        // Equal length - neutral territory
        owners[pos] = -1;
      }
    }
  }

  /**
   * Phase 2: BFS from food to compute territory-restricted distances
   */
  private computeFoodDistances(
    board: Board,
    owners: Int16Array,
    foodDistances: Int16Array,
    width: number,
    height: number
  ): void {
    // For each snake, do a BFS from its head through its territory to find food
    const uniqueOwners = new Set<number>();
    for (let i = 0; i < owners.length; i++) {
      if (owners[i] >= 0) uniqueOwners.add(owners[i]);
    }
    
    // Get snake positions
    const snakeHeads = new Map<number, Coord>();
    for (const snake of board.snakes) {
      const idx = Array.from(uniqueOwners).findIndex(i => {
        // Match snake index by finding which territory contains this head
        const headPos = width * snake.head.y + snake.head.x;
        return owners[headPos] === i;
      });
      if (idx >= 0) {
        snakeHeads.set(Array.from(uniqueOwners)[idx], snake.head);
      }
    }
    
    // For each snake owner, find nearest food in their territory
    for (const ownerIdx of uniqueOwners) {
      const head = snakeHeads.get(ownerIdx);
      if (!head) continue;
      
      const queue: Array<{x: number, y: number, dist: number}> = [];
      const visited = new Set<number>();
      const headPos = width * head.y + head.x;
      
      queue.push({ x: head.x, y: head.y, dist: 0 });
      visited.add(headPos);
      
      let minFoodDist = Number.MAX_SAFE_INTEGER;
      let queueIndex = 0;
      
      while (queueIndex < queue.length) {
        const current = queue[queueIndex++];
        const currentPos = width * current.y + current.x;
        
        // Check if this cell has food
        const hasFood = board.food.some(f => f.x === current.x && f.y === current.y);
        if (hasFood) {
          minFoodDist = Math.min(minFoodDist, current.dist);
          // Continue searching for closer food
        }
        
        // Explore neighbors within territory
        const moves = [
          { x: current.x, y: current.y + 1 }, // up
          { x: current.x, y: current.y - 1 }, // down
          { x: current.x - 1, y: current.y }, // left
          { x: current.x + 1, y: current.y }  // right
        ];
        
        for (const move of moves) {
          // Check bounds
          if (move.x < 0 || move.x >= width || move.y < 0 || move.y >= height) {
            continue;
          }
          
          const pos = width * move.y + move.x;
          
          // Only traverse through cells owned by this snake
          if (owners[pos] !== ownerIdx) {
            continue;
          }
          
          // Skip if already visited
          if (visited.has(pos)) {
            continue;
          }
          
          visited.add(pos);
          queue.push({
            x: move.x,
            y: move.y,
            dist: current.dist + 1
          });
        }
      }
      
      // Store the minimum food distance for this snake's head
      foodDistances[headPos] = minFoodDist;
    }
  }

  /**
   * Calculate final metrics from computed arrays
   */
  private calculateMetrics(
    board: Board,
    snakes: Snake[],
    owners: Int16Array,
    foodDistances: Int16Array,
    snakeIndexMap: Map<string, number>,
    width: number,
    height: number
  ): TerritoryMetrics {
    const perSnakeMetrics = new Map<string, SnakeMetrics>();
    
    // Initialize metrics for each snake
    for (const snake of snakes) {
      const headPos = width * snake.head.y + snake.head.x;
      perSnakeMetrics.set(snake.id, {
        territory: 0,
        foodCount: 0,
        fertileScore: 0,
        nearestFoodDistance: foodDistances[headPos] === Number.MAX_SAFE_INTEGER ? 
          Number.MAX_VALUE : foodDistances[headPos],
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
    for (const [snakeId, metrics] of perSnakeMetrics.entries()) {
      metrics.fertileScore = metrics.territory + (metrics.foodCount * this.FOOD_BONUS);
    }
    
    return {
      perSnakeMetrics,
      totalAssigned,
      totalUnassigned
    };
  }

  private isOccupied(coord: Coord, snakes: Snake[]): boolean {
    for (const snake of snakes) {
      for (const segment of snake.body) {
        if (segment.x === coord.x && segment.y === coord.y) {
          return true;
        }
      }
    }
    return false;
  }
}