"use strict";
/**
 * Unified board evaluator that provides a single scoring function for board states.
 * Returns both a score and structured statistics for each heuristic.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoardEvaluator = void 0;
class BoardEvaluator {
    constructor(weights) {
        // Default weights for each heuristic (can be overridden)
        this.weights = {
            // My snake weights
            myLength: 10.0, // High weight for staying alive
            myTerritory: 1.0, // Basic territory value
            myControlledFood: 10.0, // High value for controlling food
            // Team weights
            teamLength: 10.0, // Team coordination value
            teamTerritory: 1.0, // Basic territory value
            teamControlledFood: 10.0, // High value for controlling food
            // Distance/proximity weights
            foodProximity: 50.0, // Increased weight for food proximity (1/distance)
            // Enemy weights
            enemyTerritory: 0, // Currently not used but tracked
            enemyLength: 0, // Currently not used but tracked
            // Life/death weights
            kills: 0, // Currently not used but tracked
            deaths: -500, // Heavy penalty for death
            // Override with provided weights
            ...weights
        };
    }
    /**
     * The single unified scoring function for any board state.
     * All board evaluations in the codebase must go through this function.
     */
    evaluateBoard(gameState, ourSnakeId, teamSnakeIds, ctx) {
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
     */
    calculateStats(gameState, ourSnakeId, teamSnakeIds, ctx) {
        const { board } = gameState;
        const ourSnake = board.snakes.find((s) => s.id === ourSnakeId);
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
                kills: 0,
                deaths: 1
            };
        }
        // Calculate voronoi territory and controlled food
        const territoryData = this.calculateVoronoiTerritory(gameState, teamSnakeIds, ourSnakeId);
        // Calculate team and enemy lengths
        let teamLength = 0;
        let enemyLength = 0;
        for (const snake of board.snakes) {
            if (snake.health <= 0)
                continue;
            if (teamSnakeIds.has(snake.id)) {
                teamLength += snake.length;
            }
            else {
                enemyLength += snake.length;
            }
        }
        // Check if we just ate food (our head is where food was in previous state)
        const headKey = `${ourSnake.head.x},${ourSnake.head.y}`;
        const justAte = !!ctx?.prevFoodSet?.has(headKey);
        // Check if we're currently on a food cell (about to eat it)
        const onFoodNow = board.food.some((f) => f.x === ourSnake.head.x && f.y === ourSnake.head.y);
        // Calculate food distance - 0 if on food now or just ate, otherwise use BFS
        let foodDistance;
        if (onFoodNow || justAte) {
            foodDistance = 0; // Currently on food or just ate from previous state
        }
        else {
            foodDistance = this.calculateFoodDistance(ourSnake.head, gameState);
        }
        // Calculate food proximity using consistent formula
        let foodProximity;
        if (foodDistance >= 1000) {
            foodProximity = 0; // No reachable food
        }
        else {
            foodProximity = 1 / (foodDistance + 1); // Consistent proximity calculation
        }
        return {
            myLength: ourSnake.length,
            myTerritory: territoryData.myTerritory,
            myControlledFood: territoryData.myControlledFood,
            teamLength,
            teamTerritory: territoryData.teamTerritory,
            teamControlledFood: territoryData.teamControlledFood,
            foodDistance, // Raw unweighted distance
            foodProximity, // 1/distance or 10 if just ate
            enemyTerritory: territoryData.enemyTerritory,
            enemyLength,
            kills: 0, // Would need before/after comparison to calculate
            deaths: isDead ? 1 : 0
        };
    }
    /**
     * Calculate voronoi territory and controlled food separately.
     */
    calculateVoronoiTerritory(gameState, teamSnakeIds, ourSnakeId) {
        const { board } = gameState;
        let myTerritory = 0;
        let myControlledFood = 0;
        let teamTerritory = 0;
        let teamControlledFood = 0;
        let enemyTerritory = 0;
        // For each cell on the board
        for (let x = 0; x < board.width; x++) {
            for (let y = 0; y < board.height; y++) {
                const cell = { x, y };
                // Find closest snake to this cell
                let minDistance = Infinity;
                let closestSnakeId = null;
                for (const snake of board.snakes) {
                    if (snake.health <= 0)
                        continue;
                    const distance = this.bfsDistance(snake.head, cell, gameState);
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestSnakeId = snake.id;
                    }
                }
                if (closestSnakeId && minDistance < 1000) {
                    // Check if this cell has food
                    const hasFood = board.food.some((f) => f.x === x && f.y === y);
                    // Track territory and food separately
                    if (closestSnakeId === ourSnakeId) {
                        myTerritory += 1;
                        if (hasFood)
                            myControlledFood += 1;
                    }
                    if (teamSnakeIds.has(closestSnakeId)) {
                        teamTerritory += 1;
                        if (hasFood)
                            teamControlledFood += 1;
                    }
                    else {
                        enemyTerritory += 1;
                    }
                }
            }
        }
        return { myTerritory, myControlledFood, teamTerritory, teamControlledFood, enemyTerritory };
    }
    /**
     * Calculate distance to nearest food using BFS.
     */
    calculateFoodDistance(head, gameState) {
        const { board } = gameState;
        if (board.food.length === 0) {
            return 1000; // No food available
        }
        // BFS to find nearest food
        const visited = new Set();
        const queue = [{ pos: head, dist: 0 }];
        visited.add(`${head.x},${head.y}`);
        while (queue.length > 0) {
            const { pos, dist } = queue.shift();
            // Check if this position has food
            if (board.food.some((f) => f.x === pos.x && f.y === pos.y)) {
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
                if (visited.has(key))
                    continue;
                // Check if blocked by snake body
                let blocked = false;
                for (const snake of board.snakes) {
                    if (snake.health <= 0)
                        continue;
                    // Don't count tail as blocking (it will move)
                    for (let i = 0; i < snake.body.length - 1; i++) {
                        const segment = snake.body[i];
                        if (segment.x === next.x && segment.y === next.y) {
                            blocked = true;
                            break;
                        }
                    }
                    if (blocked)
                        break;
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
    bfsDistance(from, to, gameState) {
        const { board } = gameState;
        const visited = new Set();
        const queue = [{ pos: from, dist: 0 }];
        visited.add(`${from.x},${from.y}`);
        while (queue.length > 0) {
            const { pos, dist } = queue.shift();
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
                if (visited.has(key))
                    continue;
                visited.add(key);
                queue.push({ pos: next, dist: dist + 1 });
            }
        }
        return 1000; // Unreachable
    }
    /**
     * Calculate weighted scores for each heuristic.
     */
    calculateWeightedScores(stats) {
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
            killsScore: stats.kills * this.weights.kills,
            deathsScore: stats.deaths * this.weights.deaths
        };
    }
    /**
     * Calculate total score from weighted scores.
     */
    calculateTotalScore(weighted) {
        return weighted.myLengthScore +
            weighted.myTerritoryScore +
            weighted.myControlledFoodScore +
            weighted.teamLengthScore +
            weighted.teamTerritoryScore +
            weighted.teamControlledFoodScore +
            weighted.foodProximityScore +
            weighted.enemyTerritoryScore +
            weighted.enemyLengthScore +
            weighted.killsScore +
            weighted.deathsScore;
    }
}
exports.BoardEvaluator = BoardEvaluator;
