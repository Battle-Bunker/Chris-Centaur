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
    _gameState: GameState,
    ourSnakeId: string,
    aliveSnakes?: any[]
  ): number {
    const ourMetrics = metrics.perSnakeMetrics.get(ourSnakeId);
    if (!ourMetrics) {
      // Snake is dead in this simulation
      return -10000;
    }
    
    // Calculate team metrics
    const teamMetrics = this.calculateTeamMetrics(metrics, ourMetrics.teamId, aliveSnakes);
    
    // Calculate inverse food distance (zero benefit when unreachable)
    const foodScore = (ourMetrics.nearestFoodDistance >= 1000) ? 
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
    teamId: string,
    aliveSnakes?: any[]
  ): { totalFertileScore: number; totalLength: number } {
    let totalFertileScore = 0;
    let totalLength = 0;
    
    for (const [snakeId, snakeMetrics] of metrics.perSnakeMetrics.entries()) {
      if (snakeMetrics.teamId === teamId) {
        totalFertileScore += snakeMetrics.fertileScore;
        
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
    
    return { totalFertileScore, totalLength };
  }
}