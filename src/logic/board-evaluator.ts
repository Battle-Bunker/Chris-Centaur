/**
 * Unified board evaluator that provides a single scoring function for board states.
 * Returns both a score and structured statistics for each heuristic.
 * Now uses single-pass multi-source BFS for O(W×H) complexity.
 */

import { GameState, Snake, Coord } from '../types/battlesnake';
import { BoardGraph, BoardGraphConfig } from './board-graph';
import { MultiSourceBFS, BFSSource } from './multi-source-bfs';

export interface HeuristicStats {
  // My snake stats
  myLength: number;           // Our snake's length
  myTerritory: number;        // Our snake's voronoi territory cells
  myControlledFood: number;   // Food cells within our voronoi territory
  
  // Team stats (includes our snake)
  teamLength: number;         // Combined length of team snakes
  teamTerritory: number;      // Team voronoi territory cells
  teamControlledFood: number; // Food cells within team voronoi territory
  
  // Distance/proximity metrics
  foodDistance: number;       // Distance to nearest food (1000 if none reachable) - raw unweighted
  foodProximity: number;      // 1/foodDistance or 10 if just ate - this is what gets weighted
  
  // Enemy stats
  enemyTerritory: number;     // Enemy controlled territory
  enemyLength: number;        // Combined length of enemy snakes
  
  // Safety heuristics
  edgePenalty: number;        // Penalty for being on edge of board (-1 if on edge, 0 otherwise)
  spaceAvailable: number;     // Floodfill safety score: 10 if enough space, -10 + 5*reachable_enemy_tails otherwise
  
  // Life/death tracking
  kills: number;              // Number of enemy snakes that died
  deaths: number;             // Number of team snakes that died (including self)
}

export interface BoardEvaluation {
  score: number;              // Overall board score
  stats: HeuristicStats;      // Individual heuristic values
  weights: HeuristicWeights;  // Weights used for scoring
  weighted: WeightedScores;   // Individual weighted scores
}

export interface EvaluationContext {
  prevFoodSet?: Set<string>;  // Food positions from previous board state
}

export interface HeuristicWeights {
  // My snake weights
  myLength: number;
  myTerritory: number;
  myControlledFood: number;
  
  // Team weights
  teamLength: number;
  teamTerritory: number;
  teamControlledFood: number;
  
  // Distance/proximity weights
  foodProximity: number;      // Weight for food proximity (1/distance)
  
  // Enemy weights
  enemyTerritory: number;
  enemyLength: number;
  
  // Safety weights
  edgePenalty: number;        // Weight for edge penalty
  spaceAvailable: number;     // Weight for floodfill safety
  
  // Life/death weights
  kills: number;
  deaths: number;
}

export interface WeightedScores {
  // My snake weighted scores
  myLengthScore: number;
  myTerritoryScore: number;
  myControlledFoodScore: number;
  
  // Team weighted scores
  teamLengthScore: number;
  teamTerritoryScore: number;
  teamControlledFoodScore: number;
  
  // Distance/proximity weighted scores
  foodProximityScore: number;  // Weighted food proximity score
  
  // Enemy weighted scores
  enemyTerritoryScore: number;
  enemyLengthScore: number;
  
  // Safety weighted scores
  edgePenaltyScore: number;   // Weighted edge penalty score
  spaceAvailableScore: number;  // Weighted floodfill safety score
  
  // Life/death weighted scores
  killsScore: number;
  deathsScore: number;
}

export class BoardEvaluator {
  private weights: HeuristicWeights;
  private graphConfig: BoardGraphConfig;
  
  constructor(weights?: Partial<HeuristicWeights>, graphConfig?: Partial<BoardGraphConfig>) {
    // Default weights for each heuristic (can be overridden)
    this.weights = {
      // My snake weights
      myLength: 10.0,           // High weight for staying alive
      myTerritory: 1.0,         // Basic territory value
      myControlledFood: 10.0,   // High value for controlling food
      
      // Team weights
      teamLength: 10.0,         // Team coordination value
      teamTerritory: 1.0,       // Basic territory value
      teamControlledFood: 10.0, // High value for controlling food
      
      // Distance/proximity weights
      foodProximity: 50.0,      // Increased weight for food proximity (1/distance)
      
      // Enemy weights
      enemyTerritory: 0,        // Currently not used but tracked
      enemyLength: 0,           // Currently not used but tracked
      
      // Safety weights
      edgePenalty: 50.0,        // Penalty for being on edge of board
      spaceAvailable: 5.0,      // Weight for floodfill safety check
      
      // Life/death weights
      kills: 0,                 // Currently not used but tracked
      deaths: -500,             // Heavy penalty for death
      
      // Override with provided weights
      ...weights
    };
    
    this.graphConfig = {
      tailGrowthTiming: 'grow-next-turn' as const,
      ...graphConfig
    };
  }
  
  /**
   * The single unified scoring function for any board state.
   * All board evaluations in the codebase must go through this function.
   */
  public evaluateBoard(gameState: GameState, ourSnakeId: string, teamSnakeIds: Set<string>, ctx?: EvaluationContext): BoardEvaluation {
    const stats = this.calculateStats(gameState, ourSnakeId, teamSnakeIds, ctx);
    const weighted = this.calculateWeightedScores(stats);
    const score = this.calculateTotalScore(weighted);
    
    return {
      score,
      stats,
      weights: { ...this.weights }, // Return copy of weights
      weighted
    };
  }
  
  /**
   * Calculate all heuristic statistics for the board state.
   * Now uses single-pass multi-source BFS for efficiency.
   */
  private calculateStats(gameState: GameState, ourSnakeId: string, teamSnakeIds: Set<string>, ctx?: EvaluationContext): HeuristicStats {
    const { board } = gameState;
    const ourSnake = board.snakes.find((s: Snake) => s.id === ourSnakeId);
    
    // Check if we're dead
    const isDead = !ourSnake || ourSnake.health <= 0;
    if (isDead) {
      return {
        myLength: 0,
        myTerritory: 0,
        myControlledFood: 0,
        teamLength: 0,
        teamTerritory: 0,
        teamControlledFood: 0,
        foodDistance: 1000,
        foodProximity: 0,
        enemyTerritory: 0,
        enemyLength: 0,
        edgePenalty: 0,
        spaceAvailable: -10,
        kills: 0,
        deaths: 1
      };
    }
    
    // Build graph and run single-pass multi-source BFS
    const graph = new BoardGraph(gameState, this.graphConfig);
    const bfs = new MultiSourceBFS(graph);
    
    // Prepare BFS sources
    const sources: BFSSource[] = board.snakes
      .filter((s: Snake) => s.health > 0)
      .map((s: Snake) => ({
        id: s.id,
        position: s.head,
        isTeam: teamSnakeIds.has(s.id)
      }));
    
    // Run the single-pass BFS
    const bfsResult = bfs.compute(sources, board.food);
    
    // Calculate team and enemy lengths
    let teamLength = 0;
    let enemyLength = 0;
    for (const snake of board.snakes) {
      if (snake.health <= 0) continue;
      
      if (teamSnakeIds.has(snake.id)) {
        teamLength += snake.length;
      } else {
        enemyLength += snake.length;
      }
    }
    
    // Check if we just ate food (our head is where food was in previous state)
    const headKey = graph.coordToKey(ourSnake.head);
    const justAte = !!ctx?.prevFoodSet?.has(headKey);
    
    // Check if we're currently on a food cell (about to eat it)
    const onFoodNow = board.food.some((f: Coord) => 
      f.x === ourSnake.head.x && f.y === ourSnake.head.y
    );
    
    // Get food distance from BFS result
    let foodDistance: number;
    if (onFoodNow || justAte) {
      foodDistance = 0; // Currently on food or just ate from previous state
    } else {
      foodDistance = bfsResult.nearestFoodDistance.get(ourSnakeId) || 1000;
    }
    
    // Calculate food proximity using consistent formula
    let foodProximity: number;
    if (foodDistance >= 1000) {
      foodProximity = 0; // No reachable food
    } else {
      foodProximity = 1 / (foodDistance + 1); // Consistent proximity calculation
    }
    
    // Calculate edge penalty: -1 if on edge, 0 otherwise
    const edgePenalty = this.calculateEdgePenalty(ourSnake.head, board.width, board.height);
    
    // Calculate space available using floodfill from our head
    const spaceAvailable = this.calculateSpaceAvailable(graph, ourSnake, board.snakes);
    
    return {
      myLength: ourSnake.length,
      myTerritory: bfsResult.territoryCounts.get(ourSnakeId) || 0,
      myControlledFood: bfsResult.controlledFood.get(ourSnakeId) || 0,
      teamLength,
      teamTerritory: bfsResult.teamTerritory,
      teamControlledFood: bfsResult.teamControlledFood,
      foodDistance,  // Raw unweighted distance
      foodProximity, // 1/distance or 10 if just ate
      enemyTerritory: bfsResult.enemyTerritory,
      enemyLength,
      edgePenalty,   // -1 if on edge, 0 otherwise
      spaceAvailable, // Floodfill safety score
      kills: 0,  // Would need before/after comparison to calculate
      deaths: isDead ? 1 : 0
    };
  }
  
  /**
   * Calculate edge penalty: returns -1 if head is on board edge, 0 otherwise.
   */
  private calculateEdgePenalty(head: Coord, width: number, height: number): number {
    const isOnEdge = head.x === 0 || head.x === width - 1 || 
                     head.y === 0 || head.y === height - 1;
    return isOnEdge ? -1 : 0;
  }
  
  /**
   * Calculate space available using floodfill from snake head.
   * Returns:
   * - 10 if enough space (including if our tail is reachable)
   * - -10 + 5 * number_of_reachable_enemy_tails if not enough space
   */
  private calculateSpaceAvailable(graph: BoardGraph, ourSnake: Snake, allSnakes: Snake[]): number {
    const startPos = ourSnake.head;
    const ourLength = ourSnake.length;
    const ourTailKey = graph.coordToKey(ourSnake.body[ourSnake.body.length - 1]);
    
    // Track visited cells and queue for BFS floodfill
    const visited = new Set<string>();
    const queue: Coord[] = [startPos];
    visited.add(graph.coordToKey(startPos));
    
    let cellsFound = 0;
    let reachableEnemyTails = 0;
    let foundOurTail = false;
    
    while (queue.length > 0 && cellsFound < ourLength) {
      const current = queue.shift()!;
      cellsFound++;
      
      // Check if we reached our own tail
      const currentKey = graph.coordToKey(current);
      if (currentKey === ourTailKey) {
        foundOurTail = true;
        // If we can reach our tail, we have a cycle and infinite space
        return 10;
      }
      
      // Check neighbors
      const neighbors = graph.getNeighbors(current);
      for (const neighbor of neighbors) {
        const neighborKey = graph.coordToKey(neighbor);
        
        // Skip if already visited
        if (visited.has(neighborKey)) continue;
        
        // Check if this cell is passable (not blocked by snake body)
        if (!graph.isPassable(neighbor)) {
          // Check if this is an enemy tail (will move next turn)
          for (const snake of allSnakes) {
            if (snake.id === ourSnake.id || snake.health <= 0) continue;
            
            const tail = snake.body[snake.body.length - 1];
            if (tail.x === neighbor.x && tail.y === neighbor.y) {
              // This is an enemy tail - it will move, so we can potentially use this space
              reachableEnemyTails++;
              visited.add(neighborKey);
              queue.push(neighbor);
              break;
            }
          }
          continue;
        }
        
        visited.add(neighborKey);
        queue.push(neighbor);
      }
    }
    
    // Check if we found enough space
    if (cellsFound >= ourLength || foundOurTail) {
      return 10; // Enough space available
    } else {
      // Not enough space, apply penalty but give credit for reachable enemy tails
      return -10 + (5 * reachableEnemyTails);
    }
  }
  
  /**
   * Calculate weighted scores for each heuristic.
   */
  private calculateWeightedScores(stats: HeuristicStats): WeightedScores {
    return {
      myLengthScore: stats.myLength * this.weights.myLength,
      myTerritoryScore: stats.myTerritory * this.weights.myTerritory,
      myControlledFoodScore: stats.myControlledFood * this.weights.myControlledFood,
      teamLengthScore: stats.teamLength * this.weights.teamLength,
      teamTerritoryScore: stats.teamTerritory * this.weights.teamTerritory,
      teamControlledFoodScore: stats.teamControlledFood * this.weights.teamControlledFood,
      foodProximityScore: stats.foodProximity * this.weights.foodProximity,
      enemyTerritoryScore: stats.enemyTerritory * this.weights.enemyTerritory,
      enemyLengthScore: stats.enemyLength * this.weights.enemyLength,
      edgePenaltyScore: stats.edgePenalty * this.weights.edgePenalty,
      spaceAvailableScore: stats.spaceAvailable * this.weights.spaceAvailable,
      killsScore: stats.kills * this.weights.kills,
      deathsScore: stats.deaths * this.weights.deaths
    };
  }
  
  /**
   * Calculate total score from weighted scores.
   */
  private calculateTotalScore(weighted: WeightedScores): number {
    return weighted.myLengthScore +
           weighted.myTerritoryScore +
           weighted.myControlledFoodScore +
           weighted.teamLengthScore +
           weighted.teamTerritoryScore +
           weighted.teamControlledFoodScore +
           weighted.foodProximityScore +
           weighted.enemyTerritoryScore +
           weighted.enemyLengthScore +
           weighted.edgePenaltyScore +
           weighted.spaceAvailableScore +
           weighted.killsScore +
           weighted.deathsScore;
  }
}