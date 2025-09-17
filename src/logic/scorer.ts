import { GameState } from '../types/battlesnake';
import { TerritoryMetrics } from './bfs-metrics';

export interface ScorerConfig {
  weightFood: number;      // Weight for inverse food distance
  weightFertile: number;   // Weight for fertile territory
  weightTeamLength: number; // Weight for team length
}

export class Scorer {
  private readonly config: ScorerConfig;

  constructor(config: Partial<ScorerConfig> = {}) {
    this.config = {
      weightFood: config.weightFood ?? 10,
      weightFertile: config.weightFertile ?? 1,
      weightTeamLength: config.weightTeamLength ?? 2
    };
  }

  /**
   * Calculate heuristic score for a board state
   */
  public calculateScore(
    metrics: TerritoryMetrics,
    gameState: GameState,
    ourSnakeId: string
  ): number {
    const ourMetrics = metrics.perSnakeMetrics.get(ourSnakeId);
    if (!ourMetrics) {
      // Snake is dead in this simulation
      return -Infinity;
    }
    
    // Calculate team metrics
    const teamMetrics = this.calculateTeamMetrics(metrics, ourMetrics.teamId);
    
    // Calculate inverse food distance (avoid division by zero)
    const foodScore = ourMetrics.nearestFoodDistance === Number.MAX_VALUE ? 
      0 : 1 / (ourMetrics.nearestFoodDistance + 1);
    
    // Calculate weighted score
    const score = 
      this.config.weightFood * foodScore +
      this.config.weightFertile * teamMetrics.totalFertileScore +
      this.config.weightTeamLength * teamMetrics.totalLength;
    
    return score;
  }

  /**
   * Calculate aggregated team metrics
   */
  private calculateTeamMetrics(
    metrics: TerritoryMetrics,
    teamId: string
  ): { totalFertileScore: number; totalLength: number } {
    let totalFertileScore = 0;
    let totalLength = 0;
    
    for (const [snakeId, snakeMetrics] of metrics.perSnakeMetrics.entries()) {
      if (snakeMetrics.teamId === teamId) {
        totalFertileScore += snakeMetrics.fertileScore;
        // Note: Length is tracked in the actual snake object, not in metrics
        // We'll need to pass this information through or track it differently
        totalLength += 3; // Default length, will be updated with actual implementation
      }
    }
    
    return { totalFertileScore, totalLength };
  }
}