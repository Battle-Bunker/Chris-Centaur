import { GameState } from '../types/battlesnake';
import { TerritoryMetrics } from './bfs-metrics';

export interface ScorerConfig {
  weightFood: number;      // Weight for inverse food distance
  weightFertile: number;   // Weight for fertile territory
  weightTeamLength: number; // Weight for team length
}

export interface ScoreBreakdown {
  total: number;
  components: {
    foodDistance: number;        // Raw average food distance
    myTerritory: number;         // My voronoi territory
    myFoodCount: number;         // Food in my territory
    myLength: number;            // My snake length
    teamTerritory: number;       // Team's total voronoi territory
    teamFoodCount: number;       // Food in team's territory
    teamLength: number;          // Team's total length
  };
  weights: {
    foodDistance: number;        // Weight for food distance (inverse)
    fertileTerritory: number;    // Weight for fertile territory (territory + food bonus)
    teamLength: number;          // Weight for team length
  };
  weighted: {
    foodDistanceScore: number;   // Weighted food distance contribution
    fertileScore: number;        // Weighted fertile territory contribution
    teamLengthScore: number;     // Weighted team length contribution
  };
}

export class Scorer {
  private readonly config: ScorerConfig;

  /**
   * Get scorer weights for external use
   */
  public getWeights(): { weightFood: number; weightFertile: number; weightTeamLength: number } {
    return { ...this.config };
  }

  constructor(config: Partial<ScorerConfig> = {}) {
    this.config = {
      weightFood: config.weightFood ?? 10,
      weightFertile: config.weightFertile ?? 1,
      weightTeamLength: config.weightTeamLength ?? 2
    };
  }

  /**
   * Calculate heuristic score breakdown for a board state
   */
  public calculateScoreBreakdown(
    metrics: TerritoryMetrics,
    _gameState: GameState,
    ourSnakeId: string,
    aliveSnakes?: any[]
  ): ScoreBreakdown {
    const ourMetrics = metrics.perSnakeMetrics.get(ourSnakeId);
    if (!ourMetrics) {
      // Snake is dead in this simulation
      return {
        total: -10000,
        components: {
          foodDistance: 1000,
          myTerritory: 0,
          myFoodCount: 0,
          myLength: 0,
          teamTerritory: 0,
          teamFoodCount: 0,
          teamLength: 0
        },
        weights: {
          foodDistance: this.config.weightFood,
          fertileTerritory: this.config.weightFertile,
          teamLength: this.config.weightTeamLength
        },
        weighted: {
          foodDistanceScore: 0,
          fertileScore: 0,
          teamLengthScore: 0
        }
      };
    }
    
    // Get my snake length
    const mySnake = aliveSnakes?.find(s => s.id === ourSnakeId);
    const myLength = mySnake?.length || 3;
    
    // Calculate team metrics with breakdown
    const teamMetrics = this.calculateDetailedTeamMetrics(metrics, ourMetrics.teamId, aliveSnakes);
    
    // Calculate inverse food distance (zero benefit when unreachable)
    const foodScore = (ourMetrics.nearestFoodDistance >= 1000) ? 
      0 : 1 / (ourMetrics.nearestFoodDistance + 1);
    
    // Calculate weighted scores
    const weightedFood = this.config.weightFood * foodScore;
    const weightedFertile = this.config.weightFertile * teamMetrics.totalFertileScore;
    const weightedTeamLength = this.config.weightTeamLength * teamMetrics.totalLength;
    
    return {
      total: weightedFood + weightedFertile + weightedTeamLength,
      components: {
        foodDistance: ourMetrics.nearestFoodDistance,
        myTerritory: ourMetrics.territory,
        myFoodCount: ourMetrics.foodCount,
        myLength: myLength,
        teamTerritory: teamMetrics.totalTerritory,
        teamFoodCount: teamMetrics.totalFoodCount,
        teamLength: teamMetrics.totalLength
      },
      weights: {
        foodDistance: this.config.weightFood,
        fertileTerritory: this.config.weightFertile,
        teamLength: this.config.weightTeamLength
      },
      weighted: {
        foodDistanceScore: weightedFood,
        fertileScore: weightedFertile,
        teamLengthScore: weightedTeamLength
      }
    };
  }

  /**
   * Calculate heuristic score for a board state (backward compatibility)
   */
  public calculateScore(
    metrics: TerritoryMetrics,
    gameState: GameState,
    ourSnakeId: string,
    aliveSnakes?: any[]
  ): number {
    return this.calculateScoreBreakdown(metrics, gameState, ourSnakeId, aliveSnakes).total;
  }

  /**
   * Calculate detailed team metrics with breakdown
   */
  private calculateDetailedTeamMetrics(
    metrics: TerritoryMetrics,
    teamId: string,
    aliveSnakes?: any[]
  ): { 
    totalFertileScore: number; 
    totalTerritory: number; 
    totalFoodCount: number; 
    totalLength: number 
  } {
    let totalFertileScore = 0;
    let totalTerritory = 0;
    let totalFoodCount = 0;
    let totalLength = 0;
    
    for (const [snakeId, snakeMetrics] of metrics.perSnakeMetrics.entries()) {
      if (snakeMetrics.teamId === teamId) {
        totalFertileScore += snakeMetrics.fertileScore;
        totalTerritory += snakeMetrics.territory;
        totalFoodCount += snakeMetrics.foodCount;
        
        // Find the actual snake to get its length
        if (aliveSnakes) {
          const snake = aliveSnakes.find(s => s.id === snakeId);
          if (snake) {
            totalLength += snake.length;
          }
        } else {
          totalLength += 3; // Default fallback
        }
      }
    }
    
    return { totalFertileScore, totalTerritory, totalFoodCount, totalLength };
  }

  /**
   * Calculate aggregated team metrics (backward compatibility)
   */
  private calculateTeamMetrics(
    metrics: TerritoryMetrics,
    teamId: string,
    aliveSnakes?: any[]
  ): { totalFertileScore: number; totalLength: number } {
    const detailed = this.calculateDetailedTeamMetrics(metrics, teamId, aliveSnakes);
    return {
      totalFertileScore: detailed.totalFertileScore,
      totalLength: detailed.totalLength
    };
  }
}