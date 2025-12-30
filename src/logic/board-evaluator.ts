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
  foodProximity: number;      // Normalized linear proximity [0,1]: (boardSize - distance)/boardSize, 0 when eating
  foodEaten: number;          // 1 if eating (justAte or onFoodNow), 0 otherwise - direct reward
  
  // Enemy stats
  enemyTerritory: number;     // Enemy controlled territory
  enemyLength: number;        // Combined length of enemy snakes
  
  // Safety heuristics
  edgePenalty: number;        // Penalty for being on edge of board (-1 if on edge, 0 otherwise)
  
  // Enhanced space detection heuristics
  selfEnoughSpace: number;    // Space score for our snake: 3 if enough space, -3 if not, +1 per reachable non-self tail
  alliesEnoughSpace: number;  // Sum of space scores for allied snakes
  opponentsEnoughSpace: number; // Sum of space scores for opponent snakes
  
  // Life/death tracking
  kills: number;              // Number of enemy snakes that died
  deaths: number;             // Number of team snakes that died (including self)
}

export interface BoardEvaluation {
  score: number;              // Overall board score
  stats: HeuristicStats;      // Individual heuristic values
  weights: HeuristicWeights;  // Weights used for scoring
  weighted: WeightedScores;   // Individual weighted scores
  territoryCells?: Map<string, { x: number; y: number }[]>;  // Territory cells per snake for visualization
}

export interface EvaluationContext {
  prevFoodSet?: Set<string>;  // Food positions from previous board state
  optimistic?: boolean;       // Use optimistic passability for body segments
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
  foodProximity: number;      // Weight for food proximity (linear)
  foodEaten: number;          // Weight for actually eating food
  
  // Enemy weights
  enemyTerritory: number;
  enemyLength: number;
  
  // Safety weights
  edgePenalty: number;        // Weight for edge penalty
  
  // Enhanced space detection weights
  selfEnoughSpace: number;    // Weight for our snake's space score
  alliesEnoughSpace: number;  // Weight for allies' space scores
  opponentsEnoughSpace: number; // Weight for opponents' space scores (negative to encourage trapping)
  
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
  foodEatenScore: number;      // Weighted food eaten score
  
  // Enemy weighted scores
  enemyTerritoryScore: number;
  enemyLengthScore: number;
  
  // Safety weighted scores
  edgePenaltyScore: number;   // Weighted edge penalty score
  
  // Enhanced space detection weighted scores
  selfEnoughSpaceScore: number;    // Weighted our snake's space score
  alliesEnoughSpaceScore: number;  // Weighted allies' space scores
  opponentsEnoughSpaceScore: number; // Weighted opponents' space scores
  
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
      foodProximity: 50.0,      // Weight for food proximity (linear)
      foodEaten: 200.0,         // High reward for actually eating food
      
      // Enemy weights
      enemyTerritory: 0,        // Currently not used but tracked
      enemyLength: 0,           // Currently not used but tracked
      
      // Safety weights
      edgePenalty: 50.0,        // Penalty for being on edge of board
      
      // Enhanced space detection weights
      selfEnoughSpace: 10.0,    // Weight for our snake's space availability
      alliesEnoughSpace: 5.0,   // Weight for allies having space (positive = good teamwork)
      opponentsEnoughSpace: -5.0, // Weight for opponents having space (negative = encourage trapping)
      
      // Life/death weights
      kills: 0,                 // Currently not used but tracked
      deaths: -500,             // Heavy penalty for death
      
      // Override with provided weights
      ...weights
    };
    
    this.graphConfig = {
      tailGrowthTiming: 'grow-next-turn' as const,
      maxLookaheadTurns: 5,
      ...graphConfig
    };
  }
  
  /**
   * The single unified scoring function for any board state.
   * All board evaluations in the codebase must go through this function.
   */
  public evaluateBoard(gameState: GameState, ourSnakeId: string, teamSnakeIds: Set<string>, ctx?: EvaluationContext): BoardEvaluation {
    const { stats, territoryCells } = this.calculateStatsWithTerritory(gameState, ourSnakeId, teamSnakeIds, ctx);
    const weighted = this.calculateWeightedScores(stats);
    const score = this.calculateTotalScore(weighted);
    
    return {
      score,
      stats,
      weights: { ...this.weights }, // Return copy of weights
      weighted,
      territoryCells
    };
  }
  
  /**
   * Calculate all heuristic statistics for the board state.
   * Now uses single-pass multi-source BFS for efficiency.
   * Returns both stats and territory cells for visualization.
   */
  private calculateStatsWithTerritory(gameState: GameState, ourSnakeId: string, teamSnakeIds: Set<string>, ctx?: EvaluationContext): { stats: HeuristicStats; territoryCells: Map<string, { x: number; y: number }[]> } {
    const { board } = gameState;
    const ourSnake = board.snakes.find((s: Snake) => s.id === ourSnakeId);
    
    // Check if we're dead
    const isDead = !ourSnake || ourSnake.health <= 0;
    if (isDead) {
      return {
        stats: {
          myLength: 0,
          myTerritory: 0,
          myControlledFood: 0,
          teamLength: 0,
          teamTerritory: 0,
          teamControlledFood: 0,
          foodDistance: 1000,
          foodProximity: 0,
          foodEaten: 0,
          enemyTerritory: 0,
          enemyLength: 0,
          edgePenalty: 0,
          selfEnoughSpace: -3,
          alliesEnoughSpace: 0,
          opponentsEnoughSpace: 0,
          kills: 0,
          deaths: 1
        },
        territoryCells: new Map()
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
    
    // Run the single-pass BFS (with optimistic passability if enabled)
    const useOptimistic = ctx?.optimistic ?? false;
    const bfsResult = bfs.compute(sources, board.food, { optimistic: useOptimistic });
    
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
    
    // Calculate food eaten reward (1 if just ate or about to eat, 0 otherwise)
    const foodEaten = (justAte || onFoodNow) ? 1 : 0;
    
    // Calculate food proximity using normalized linear formula: (boardSize - distance) / boardSize
    // This provides smooth attraction to food in range [0, 1] without the harsh 1/distance curve
    // When eating or about to eat, proximity is zeroed so foodEaten reward dominates
    const boardSize = Math.max(board.width, board.height);
    let foodProximity: number;
    if (foodDistance >= 1000) {
      foodProximity = 0; // No reachable food
    } else if (justAte || onFoodNow) {
      foodProximity = 0; // When eating/about to eat, proximity is zeroed so foodEaten reward dominates
    } else {
      // Normalized linear proximity: ranges from 0 (far) to 1 (adjacent)
      foodProximity = Math.max(0, (boardSize - foodDistance) / boardSize);
    }
    
    // Calculate edge penalty: -1 if on edge, 0 otherwise
    const edgePenalty = this.calculateEdgePenalty(ourSnake.head, board.width, board.height);
    
    // Calculate enhanced space detection for all snakes (with optimistic passability if enabled)
    const spaceScores = this.calculateAllSnakeSpaces(graph, board.snakes, ourSnakeId, teamSnakeIds, board.width, board.height, useOptimistic);
    
    return {
      stats: {
        myLength: ourSnake.length,
        myTerritory: bfsResult.territoryCounts.get(ourSnakeId) || 0,
        myControlledFood: bfsResult.controlledFood.get(ourSnakeId) || 0,
        teamLength,
        teamTerritory: bfsResult.teamTerritory,
        teamControlledFood: bfsResult.teamControlledFood,
        foodDistance,  // Raw unweighted distance
        foodProximity, // Normalized [0,1]: (boardSize - distance)/boardSize, 0 if eating
        foodEaten,     // 1 if eating (justAte or onFoodNow), 0 otherwise
        enemyTerritory: bfsResult.enemyTerritory,
        enemyLength,
        edgePenalty,   // -1 if on edge, 0 otherwise
        selfEnoughSpace: spaceScores.self,
        alliesEnoughSpace: spaceScores.allies,
        opponentsEnoughSpace: spaceScores.opponents,
        kills: 0,  // Would need before/after comparison to calculate
        deaths: isDead ? 1 : 0
      },
      territoryCells: bfsResult.territoryCells
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
   * Calculate enhanced space detection for all snakes
   * Returns scores for self, allies, and opponents
   * @param optimistic - If true, uses optimistic passability (body segments disappear over time)
   */
  private calculateAllSnakeSpaces(graph: BoardGraph, allSnakes: Snake[], ourSnakeId: string, teamSnakeIds: Set<string>, width: number, height: number, optimistic: boolean = false): 
    { self: number; allies: number; opponents: number } {
    
    let selfScore = 0;
    let alliesScore = 0;
    let opponentsScore = 0;
    
    for (const snake of allSnakes) {
      if (snake.health <= 0) continue; // Skip dead snakes
      
      // Calculate space score for this snake
      const spaceScore = this.calculateSnakeSpace(graph, snake, allSnakes, width, height, optimistic);
      
      // Categorize and accumulate scores
      if (snake.id === ourSnakeId) {
        selfScore = spaceScore;
      } else if (teamSnakeIds.has(snake.id)) {
        alliesScore += spaceScore;
      } else {
        opponentsScore += spaceScore;
      }
    }
    
    return { self: selfScore, allies: alliesScore, opponents: opponentsScore };
  }
  
  /**
   * Calculate space score for a single snake using floodfill.
   * Returns:
   * - 3 if enough space (can reach cells >= length OR can reach own tail)
   * - -3 if not enough space  
   * 
   * @param optimistic - If true, uses optimistic passability where body segments
   *                     are considered passable if they will have disappeared by
   *                     the turn we reach them (using conservative disappear turn).
   */
  private calculateSnakeSpace(graph: BoardGraph, snake: Snake, allSnakes: Snake[], width: number, height: number, optimistic: boolean = false): number {
    const startPos = snake.head;
    const snakeLength = snake.length;
    const snakeTailKey = graph.coordToKey(snake.body[snake.body.length - 1]);
    
    // Build a set of cells that belong to our own snake's body (excluding tail)
    // We never want to consider our own body as passable even with optimistic mode
    const ownBodyCells = new Set<string>();
    for (let i = 0; i < snake.body.length - 1; i++) {  // Exclude tail
      ownBodyCells.add(graph.coordToKey(snake.body[i]));
    }
    
    // Build a set of other snakes' tails to block (we can chase our own tail, not others')
    const otherSnakeTails = new Set<string>();
    for (const otherSnake of allSnakes) {
      if (otherSnake.health <= 0) continue;
      if (otherSnake.id === snake.id) continue;
      const tail = otherSnake.body[otherSnake.body.length - 1];
      otherSnakeTails.add(graph.coordToKey(tail));
    }
    
    // Track visited cells with their arrival turn for level-based BFS
    const visited = new Map<string, number>();  // key -> arrivalTurn
    
    interface QueueItem {
      position: Coord;
      turn: number;
    }
    
    let currentLevel: QueueItem[] = [{ position: startPos, turn: 0 }];
    visited.set(graph.coordToKey(startPos), 0);
    
    let cellsFound = 1; // Start with 1 for the head position
    let foundOwnTail = false;
    
    while (currentLevel.length > 0) {
      const nextLevel: QueueItem[] = [];
      
      for (const { position: current, turn: currentTurn } of currentLevel) {
        const arrivalTurn = currentTurn + 1;
        
        // Get all four potential neighbors
        const neighbors: Coord[] = [
          { x: current.x, y: current.y + 1 },  // up
          { x: current.x, y: current.y - 1 },  // down
          { x: current.x - 1, y: current.y },  // left
          { x: current.x + 1, y: current.y }   // right
        ];
        
        for (const neighbor of neighbors) {
          // Check bounds using BoardGraph (single source of truth)
          if (!graph.isInBounds(neighbor)) {
            continue;
          }
          
          const neighborKey = graph.coordToKey(neighbor);
          
          // Skip if already visited
          if (visited.has(neighborKey)) continue;
          
          // Never pass through our own body (except tail check below)
          if (ownBodyCells.has(neighborKey)) continue;
          
          // Block other snakes' tails for space calculation
          if (otherSnakeTails.has(neighborKey)) continue;
          
          // Check passability - either standard or optimistic
          let isPassable: boolean;
          if (optimistic) {
            // Use optimistic passability - considers body segments passable
            // if they will have disappeared by arrivalTurn
            isPassable = graph.isPassableAtTurn(neighbor, arrivalTurn);
          } else {
            // Standard passability check
            isPassable = graph.isPassable(neighbor);
          }
          
          if (!isPassable) continue;
          
          // Mark as visited and count
          visited.set(neighborKey, arrivalTurn);
          cellsFound++;
          
          // Check if we reached our own tail
          if (neighborKey === snakeTailKey) {
            foundOwnTail = true;
          }
          
          // Continue searching from this cell
          nextLevel.push({ position: neighbor, turn: arrivalTurn });
        }
      }
      
      currentLevel = nextLevel;
    }
    
    // Base: +3 if enough space, -3 if not
    // Having enough space means EITHER:
    // 1. Can reach at least as many cells as our length
    // 2. Can reach our own tail AND have reasonable space (at least half our length)
    const hasEnoughSpace = cellsFound >= snakeLength || 
                          (foundOwnTail && cellsFound >= Math.max(3, Math.floor(snakeLength / 2)));
    const baseScore = hasEnoughSpace ? 3 : -3;
    return baseScore;
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
      foodEatenScore: stats.foodEaten * this.weights.foodEaten,
      enemyTerritoryScore: stats.enemyTerritory * this.weights.enemyTerritory,
      enemyLengthScore: stats.enemyLength * this.weights.enemyLength,
      edgePenaltyScore: stats.edgePenalty * this.weights.edgePenalty,
      selfEnoughSpaceScore: stats.selfEnoughSpace * this.weights.selfEnoughSpace,
      alliesEnoughSpaceScore: stats.alliesEnoughSpace * this.weights.alliesEnoughSpace,
      opponentsEnoughSpaceScore: stats.opponentsEnoughSpace * this.weights.opponentsEnoughSpace,
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
           weighted.foodEatenScore +
           weighted.enemyTerritoryScore +
           weighted.enemyLengthScore +
           weighted.edgePenaltyScore +
           weighted.selfEnoughSpaceScore +
           weighted.alliesEnoughSpaceScore +
           weighted.opponentsEnoughSpaceScore +
           weighted.killsScore +
           weighted.deathsScore;
  }
}