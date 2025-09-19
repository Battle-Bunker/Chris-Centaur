/**
 * Unified board evaluator that provides a single scoring function for board states.
 * Returns both a score and structured statistics for each heuristic.
 */

import { GameState, Snake, Coord } from '../types/battlesnake';

export interface HeuristicStats {
  fertileTerritory: number;  // Territory cells weighted by nearby food
  teamLength: number;         // Combined length of team snakes
  foodDistance: number;       // Distance to nearest food (1000 if none reachable) - raw unweighted
  foodProximity: number;      // 1/foodDistance or 10 if just ate - this is what gets weighted
  enemyTerritory: number;     // Enemy controlled territory
  enemyLength: number;        // Combined length of enemy snakes
  kills: number;              // Number of enemy snakes that died
  deaths: number;             // Number of team snakes that died (including self)
}

export interface BoardEvaluation {
  score: number;              // Overall board score
  stats: HeuristicStats;      // Individual heuristic values
  weights: HeuristicWeights;  // Weights used for scoring
  weighted: WeightedScores;   // Individual weighted scores
}

export interface HeuristicWeights {
  fertileTerritory: number;
  teamLength: number;
  foodProximity: number;      // Weight for food proximity (1/distance)
  enemyTerritory: number;
  enemyLength: number;
  kills: number;
  deaths: number;
}

export interface WeightedScores {
  fertileScore: number;
  teamLengthScore: number;
  foodProximityScore: number;  // Weighted food proximity score
  enemyTerritoryScore: number;
  enemyLengthScore: number;
  killsScore: number;
  deathsScore: number;
}

export class BoardEvaluator {
  private weights: HeuristicWeights;
  
  constructor() {
    // Default weights for each heuristic
    this.weights = {
      fertileTerritory: 1.0,
      teamLength: 2.0,
      foodProximity: 10.0,  // Weight for food proximity (1/distance)
      enemyTerritory: 0,    // Currently not used but tracked
      enemyLength: 0,       // Currently not used but tracked
      kills: 0,             // Currently not used but tracked
      deaths: -500          // Heavy penalty for death
    };
  }
  
  /**
   * The single unified scoring function for any board state.
   * All board evaluations in the codebase must go through this function.
   */
  public evaluateBoard(gameState: GameState, ourSnakeId: string, teamSnakeIds: Set<string>): BoardEvaluation {
    const stats = this.calculateStats(gameState, ourSnakeId, teamSnakeIds);
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
   */
  private calculateStats(gameState: GameState, ourSnakeId: string, teamSnakeIds: Set<string>): HeuristicStats {
    const { board } = gameState;
    const ourSnake = board.snakes.find((s: Snake) => s.id === ourSnakeId);
    
    // Check if we're dead
    const isDead = !ourSnake || ourSnake.health <= 0;
    if (isDead) {
      return {
        fertileTerritory: 0,
        teamLength: 0,
        foodDistance: 1000,
        foodProximity: 0,
        enemyTerritory: 0,
        enemyLength: 0,
        kills: 0,
        deaths: 1
      };
    }
    
    // Calculate fertile territory using Voronoi
    const territoryData = this.calculateFertileTerritory(gameState, teamSnakeIds);
    
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
    
    // Calculate food distance using BFS
    const foodDistance = this.calculateFoodDistance(ourSnake.head, gameState);
    
    // Check if we just ate food (on a food cell now)
    const justAteFood = board.food.some((f: Coord) => 
      f.x === ourSnake.head.x && f.y === ourSnake.head.y
    );
    
    // Calculate food proximity
    let foodProximity: number;
    if (justAteFood) {
      foodProximity = 10; // Special case: just ate food
    } else if (foodDistance >= 1000) {
      foodProximity = 0; // No reachable food
    } else {
      foodProximity = 1 / (foodDistance + 1); // Normal proximity calculation
    }
    
    return {
      fertileTerritory: territoryData.teamTerritory,
      teamLength,
      foodDistance,  // Raw unweighted distance
      foodProximity, // 1/distance or 10 if just ate
      enemyTerritory: territoryData.enemyTerritory,
      enemyLength,
      kills: 0,  // Would need before/after comparison to calculate
      deaths: isDead ? 1 : 0
    };
  }
  
  /**
   * Calculate fertile territory (Voronoi cells weighted by food).
   */
  private calculateFertileTerritory(gameState: GameState, teamSnakeIds: Set<string>): 
    { teamTerritory: number; enemyTerritory: number } {
    
    const { board } = gameState;
    let teamTerritory = 0;
    let enemyTerritory = 0;
    
    // For each cell on the board
    for (let x = 0; x < board.width; x++) {
      for (let y = 0; y < board.height; y++) {
        const cell = { x, y };
        
        // Find closest snake to this cell
        let minDistance = Infinity;
        let closestSnakeId: string | null = null;
        
        for (const snake of board.snakes) {
          if (snake.health <= 0) continue;
          
          const distance = this.bfsDistance(snake.head, cell, gameState);
          if (distance < minDistance) {
            minDistance = distance;
            closestSnakeId = snake.id;
          }
        }
        
        if (closestSnakeId && minDistance < 1000) {
          // Calculate cell value (higher if near food)
          let cellValue = 1;
          
          // Add food bonus
          const hasFood = board.food.some((f: Coord) => f.x === x && f.y === y);
          if (hasFood) {
            cellValue += 10; // Fertile bonus for food cells
          }
          
          // Assign to team or enemy
          if (teamSnakeIds.has(closestSnakeId)) {
            teamTerritory += cellValue;
          } else {
            enemyTerritory += cellValue;
          }
        }
      }
    }
    
    return { teamTerritory, enemyTerritory };
  }
  
  /**
   * Calculate distance to nearest food using BFS.
   */
  private calculateFoodDistance(head: Coord, gameState: GameState): number {
    const { board } = gameState;
    
    if (board.food.length === 0) {
      return 1000; // No food available
    }
    
    // BFS to find nearest food
    const visited = new Set<string>();
    const queue: { pos: Coord; dist: number }[] = [{ pos: head, dist: 0 }];
    visited.add(`${head.x},${head.y}`);
    
    while (queue.length > 0) {
      const { pos, dist } = queue.shift()!;
      
      // Check if this position has food
      if (board.food.some((f: Coord) => f.x === pos.x && f.y === pos.y)) {
        return dist;
      }
      
      // Explore neighbors
      const neighbors = [
        { x: pos.x, y: pos.y + 1 },
        { x: pos.x, y: pos.y - 1 },
        { x: pos.x - 1, y: pos.y },
        { x: pos.x + 1, y: pos.y }
      ];
      
      for (const next of neighbors) {
        // Check bounds
        if (next.x < 0 || next.x >= board.width ||
            next.y < 0 || next.y >= board.height) {
          continue;
        }
        
        const key = `${next.x},${next.y}`;
        if (visited.has(key)) continue;
        
        // Check if blocked by snake body
        let blocked = false;
        for (const snake of board.snakes) {
          if (snake.health <= 0) continue;
          
          // Don't count tail as blocking (it will move)
          for (let i = 0; i < snake.body.length - 1; i++) {
            const segment = snake.body[i];
            if (segment.x === next.x && segment.y === next.y) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        
        if (!blocked) {
          visited.add(key);
          queue.push({ pos: next, dist: dist + 1 });
        }
      }
    }
    
    return 1000; // No reachable food
  }
  
  /**
   * Calculate BFS distance between two points considering obstacles.
   */
  private bfsDistance(from: Coord, to: Coord, gameState: GameState): number {
    const { board } = gameState;
    
    const visited = new Set<string>();
    const queue: { pos: Coord; dist: number }[] = [{ pos: from, dist: 0 }];
    visited.add(`${from.x},${from.y}`);
    
    while (queue.length > 0) {
      const { pos, dist } = queue.shift()!;
      
      // Reached target
      if (pos.x === to.x && pos.y === to.y) {
        return dist;
      }
      
      // Explore neighbors
      const neighbors = [
        { x: pos.x, y: pos.y + 1 },
        { x: pos.x, y: pos.y - 1 },
        { x: pos.x - 1, y: pos.y },
        { x: pos.x + 1, y: pos.y }
      ];
      
      for (const next of neighbors) {
        // Check bounds
        if (next.x < 0 || next.x >= board.width ||
            next.y < 0 || next.y >= board.height) {
          continue;
        }
        
        const key = `${next.x},${next.y}`;
        if (visited.has(key)) continue;
        
        visited.add(key);
        queue.push({ pos: next, dist: dist + 1 });
      }
    }
    
    return 1000; // Unreachable
  }
  
  /**
   * Calculate weighted scores for each heuristic.
   */
  private calculateWeightedScores(stats: HeuristicStats): WeightedScores {
    return {
      fertileScore: stats.fertileTerritory * this.weights.fertileTerritory,
      teamLengthScore: stats.teamLength * this.weights.teamLength,
      foodProximityScore: stats.foodProximity * this.weights.foodProximity,
      enemyTerritoryScore: stats.enemyTerritory * this.weights.enemyTerritory,
      enemyLengthScore: stats.enemyLength * this.weights.enemyLength,
      killsScore: stats.kills * this.weights.kills,
      deathsScore: stats.deaths * this.weights.deaths
    };
  }
  
  /**
   * Calculate total score from weighted scores.
   */
  private calculateTotalScore(weighted: WeightedScores): number {
    return weighted.fertileScore +
           weighted.teamLengthScore +
           weighted.foodProximityScore +
           weighted.enemyTerritoryScore +
           weighted.enemyLengthScore +
           weighted.killsScore +
           weighted.deathsScore;
  }
}