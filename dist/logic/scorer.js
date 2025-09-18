"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scorer = void 0;
class Scorer {
    /**
     * Get scorer weights for external use
     */
    getWeights() {
        return {
            foodDistance: this.config.weightFood,
            fertileTerritory: this.config.weightFertile,
            teamLength: this.config.weightTeamLength
        };
    }
    constructor(config = {}) {
        this.config = {
            weightFood: config.weightFood ?? 10,
            weightFertile: config.weightFertile ?? 1,
            weightTeamLength: config.weightTeamLength ?? 2
        };
    }
    /**
     * Calculate heuristic score breakdown for a board state
     */
    calculateScoreBreakdown(metrics, _gameState, ourSnakeId, aliveSnakes) {
        const ourMetrics = metrics.perSnakeMetrics.get(ourSnakeId);
        if (!ourMetrics) {
            // Snake is dead in this simulation
            return {
                total: -500, // Reduced death penalty for better tree search compatibility
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
    calculateScore(metrics, gameState, ourSnakeId, aliveSnakes) {
        return this.calculateScoreBreakdown(metrics, gameState, ourSnakeId, aliveSnakes).total;
    }
    /**
     * Calculate detailed team metrics with breakdown
     */
    calculateDetailedTeamMetrics(metrics, teamId, aliveSnakes) {
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
                }
                else {
                    totalLength += 3; // Default fallback
                }
            }
        }
        return { totalFertileScore, totalTerritory, totalFoodCount, totalLength };
    }
    /**
     * Calculate aggregated team metrics (backward compatibility)
     */
    calculateTeamMetrics(metrics, teamId, aliveSnakes) {
        const detailed = this.calculateDetailedTeamMetrics(metrics, teamId, aliveSnakes);
        return {
            totalFertileScore: detailed.totalFertileScore,
            totalLength: detailed.totalLength
        };
    }
}
exports.Scorer = Scorer;
//# sourceMappingURL=scorer.js.map