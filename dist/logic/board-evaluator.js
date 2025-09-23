"use strict";
/**
 * Unified board evaluator that provides a single scoring function for board states.
 * Returns both a score and structured statistics for each heuristic.
 * Now uses single-pass multi-source BFS for O(W×H) complexity.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoardEvaluator = void 0;
const board_graph_1 = require("./board-graph");
const multi_source_bfs_1 = require("./multi-source-bfs");
class BoardEvaluator {
    constructor(weights, graphConfig) {
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
            // Safety weights
            edgePenalty: 50.0, // Penalty for being on edge of board
            // Enhanced space detection weights
            selfEnoughSpace: 10.0, // Weight for our snake's space availability
            alliesEnoughSpace: 5.0, // Weight for allies having space (positive = good teamwork)
            opponentsEnoughSpace: -5.0, // Weight for opponents having space (negative = encourage trapping)
            // Life/death weights
            kills: 0, // Currently not used but tracked
            deaths: -500, // Heavy penalty for death
            // Override with provided weights
            ...weights
        };
        this.graphConfig = {
            tailGrowthTiming: 'grow-next-turn',
            ...graphConfig
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
     * Now uses single-pass multi-source BFS for efficiency.
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
                edgePenalty: 0,
                selfEnoughSpace: -3,
                alliesEnoughSpace: 0,
                opponentsEnoughSpace: 0,
                kills: 0,
                deaths: 1
            };
        }
        // Build graph and run single-pass multi-source BFS
        const graph = new board_graph_1.BoardGraph(gameState, this.graphConfig);
        const bfs = new multi_source_bfs_1.MultiSourceBFS(graph);
        // Prepare BFS sources
        const sources = board.snakes
            .filter((s) => s.health > 0)
            .map((s) => ({
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
        const headKey = graph.coordToKey(ourSnake.head);
        const justAte = !!ctx?.prevFoodSet?.has(headKey);
        // Check if we're currently on a food cell (about to eat it)
        const onFoodNow = board.food.some((f) => f.x === ourSnake.head.x && f.y === ourSnake.head.y);
        // Get food distance from BFS result
        let foodDistance;
        if (onFoodNow || justAte) {
            foodDistance = 0; // Currently on food or just ate from previous state
        }
        else {
            foodDistance = bfsResult.nearestFoodDistance.get(ourSnakeId) || 1000;
        }
        // Calculate food proximity using consistent formula
        let foodProximity;
        if (foodDistance >= 1000) {
            foodProximity = 0; // No reachable food
        }
        else {
            foodProximity = 1 / (foodDistance + 1); // Consistent proximity calculation
        }
        // Calculate edge penalty: -1 if on edge, 0 otherwise
        const edgePenalty = this.calculateEdgePenalty(ourSnake.head, board.width, board.height);
        // Calculate enhanced space detection for all snakes
        const spaceScores = this.calculateAllSnakeSpaces(graph, board.snakes, ourSnakeId, teamSnakeIds, board.width, board.height);
        return {
            myLength: ourSnake.length,
            myTerritory: bfsResult.territoryCounts.get(ourSnakeId) || 0,
            myControlledFood: bfsResult.controlledFood.get(ourSnakeId) || 0,
            teamLength,
            teamTerritory: bfsResult.teamTerritory,
            teamControlledFood: bfsResult.teamControlledFood,
            foodDistance, // Raw unweighted distance
            foodProximity, // 1/distance or 10 if just ate
            enemyTerritory: bfsResult.enemyTerritory,
            enemyLength,
            edgePenalty, // -1 if on edge, 0 otherwise
            selfEnoughSpace: spaceScores.self,
            alliesEnoughSpace: spaceScores.allies,
            opponentsEnoughSpace: spaceScores.opponents,
            kills: 0, // Would need before/after comparison to calculate
            deaths: isDead ? 1 : 0
        };
    }
    /**
     * Calculate edge penalty: returns -1 if head is on board edge, 0 otherwise.
     */
    calculateEdgePenalty(head, width, height) {
        const isOnEdge = head.x === 0 || head.x === width - 1 ||
            head.y === 0 || head.y === height - 1;
        return isOnEdge ? -1 : 0;
    }
    /**
     * Calculate enhanced space detection for all snakes
     * Returns scores for self, allies, and opponents
     */
    calculateAllSnakeSpaces(graph, allSnakes, ourSnakeId, teamSnakeIds, width, height) {
        let selfScore = 0;
        let alliesScore = 0;
        let opponentsScore = 0;
        for (const snake of allSnakes) {
            if (snake.health <= 0)
                continue; // Skip dead snakes
            // Calculate space score for this snake
            const spaceScore = this.calculateSnakeSpace(graph, snake, allSnakes, width, height);
            // Categorize and accumulate scores
            if (snake.id === ourSnakeId) {
                selfScore = spaceScore;
            }
            else if (teamSnakeIds.has(snake.id)) {
                alliesScore += spaceScore;
            }
            else {
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
     * Note: +1 per reachable non-self tail bonus is not yet implemented
     */
    calculateSnakeSpace(graph, snake, allSnakes, width, height) {
        const startPos = snake.head;
        const snakeLength = snake.length;
        const snakeTailKey = graph.coordToKey(snake.body[snake.body.length - 1]);
        // Track visited cells and queue for BFS floodfill
        const visited = new Set();
        const queue = [startPos];
        visited.add(graph.coordToKey(startPos));
        let cellsFound = 1; // Start with 1 for the head position
        let foundOwnTail = false;
        // Create a set of all snake bodies - we need to be careful about tails
        // For space detection, only our own tail should be considered reachable
        const blockedCells = new Set();
        for (const otherSnake of allSnakes) {
            if (otherSnake.health <= 0)
                continue;
            // For our own snake, block all segments except our tail
            // For other snakes, block all segments except their tails (since they'll move)
            const excludeTail = true; // Always exclude the tail from blocked cells
            const endIdx = excludeTail ? otherSnake.body.length - 1 : otherSnake.body.length;
            for (let i = 0; i < endIdx; i++) {
                const segment = otherSnake.body[i];
                blockedCells.add(graph.coordToKey(segment));
            }
        }
        // Now add all OTHER snakes' tails as blocked (not our own)
        // This prevents floodfill from escaping through enemy tail positions
        for (const otherSnake of allSnakes) {
            if (otherSnake.health <= 0)
                continue;
            if (otherSnake.id === snake.id)
                continue; // Skip our own tail
            const tail = otherSnake.body[otherSnake.body.length - 1];
            blockedCells.add(graph.coordToKey(tail));
        }
        while (queue.length > 0) {
            const current = queue.shift();
            // Get all four potential neighbors
            const neighbors = [
                { x: current.x, y: current.y + 1 }, // up
                { x: current.x, y: current.y - 1 }, // down
                { x: current.x - 1, y: current.y }, // left
                { x: current.x + 1, y: current.y } // right
            ];
            for (const neighbor of neighbors) {
                // Check bounds
                if (neighbor.x < 0 || neighbor.x >= width ||
                    neighbor.y < 0 || neighbor.y >= height) {
                    continue;
                }
                const neighborKey = graph.coordToKey(neighbor);
                // Skip if already visited
                if (visited.has(neighborKey))
                    continue;
                // Skip if blocked by snake body (but not tails)
                if (blockedCells.has(neighborKey))
                    continue;
                // Mark as visited and count
                visited.add(neighborKey);
                cellsFound++;
                // Check if we reached our own tail
                if (neighborKey === snakeTailKey) {
                    foundOwnTail = true;
                }
                // Continue searching from this cell
                queue.push(neighbor);
            }
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
            weighted.edgePenaltyScore +
            weighted.selfEnoughSpaceScore +
            weighted.alliesEnoughSpaceScore +
            weighted.opponentsEnoughSpaceScore +
            weighted.killsScore +
            weighted.deathsScore;
    }
}
exports.BoardEvaluator = BoardEvaluator;
