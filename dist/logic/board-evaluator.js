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
            myControlledFertile: 2.0, // Value for controlling fertile ground
            // Team weights
            teamLength: 10.0, // Team coordination value
            teamTerritory: 1.0, // Basic territory value
            teamControlledFood: 10.0, // High value for controlling food
            // Distance/proximity weights
            foodProximity: 50.0, // Weight for food proximity (linear)
            foodEaten: 200.0, // High reward for actually eating food
            // Enemy weights
            enemyTerritory: 0, // Currently not used but tracked
            enemyLength: 0, // Currently not used but tracked
            // Safety weights
            edgePenalty: 50.0, // Penalty for being on edge of board
            // Enhanced space detection weights
            selfEnoughSpace: 10.0, // Weight for our snake's space availability
            selfSpaceOptimistic: 5.0, // Weight for optimistic space availability
            alliesEnoughSpace: 5.0, // Weight for allies having space (positive = good teamwork)
            opponentsEnoughSpace: -5.0, // Weight for opponents having space (negative = encourage trapping)
            // Life/death weights
            kills: 0, // Currently not used but tracked
            deaths: -500, // Heavy penalty for death
            // Head-to-head risk weights
            enemyH2HRisk: -100, // Penalty for h2h risk with enemy
            allyH2HRisk: -50, // Penalty for h2h risk with ally
            // Override with provided weights
            ...weights
        };
        this.graphConfig = {
            tailGrowthTiming: 'grow-next-turn',
            maxLookaheadTurns: 5,
            ...graphConfig
        };
    }
    /**
     * The single unified scoring function for any board state.
     * All board evaluations in the codebase must go through this function.
     */
    evaluateBoard(gameState, ourSnakeId, teamSnakeIds, ctx) {
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
    calculateStatsWithTerritory(gameState, ourSnakeId, teamSnakeIds, ctx) {
        const { board } = gameState;
        const ourSnake = board.snakes.find((s) => s.id === ourSnakeId);
        // Check if we're dead
        const isDead = !ourSnake || ourSnake.health <= 0;
        if (isDead) {
            return {
                stats: {
                    myLength: 0,
                    myTerritory: 0,
                    myControlledFood: 0,
                    myControlledFertile: 0,
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
                    selfSpaceOptimistic: -3,
                    alliesEnoughSpace: 0,
                    opponentsEnoughSpace: 0,
                    kills: 0,
                    deaths: 1,
                    enemyH2HRisk: 0,
                    allyH2HRisk: 0
                },
                territoryCells: new Map()
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
        // Run the single-pass BFS with optimistic passability
        // Territory calculations always use optimistic mode (body segments disappear over time)
        const bfsResult = bfs.compute(sources, board.food, { optimistic: true }, board.fertileTiles);
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
        // Calculate food eaten reward (1 if just ate or about to eat, 0 otherwise)
        const foodEaten = (justAte || onFoodNow) ? 1 : 0;
        // Calculate food proximity using normalized linear formula: (boardSize - distance) / boardSize
        // This provides smooth attraction to food in range [0, 1] without the harsh 1/distance curve
        // When eating or about to eat, proximity is zeroed so foodEaten reward dominates
        const boardSize = Math.max(board.width, board.height);
        let foodProximity;
        if (foodDistance >= 1000) {
            foodProximity = 0; // No reachable food
        }
        else if (justAte || onFoodNow) {
            foodProximity = 0; // When eating/about to eat, proximity is zeroed so foodEaten reward dominates
        }
        else {
            // Normalized linear proximity: ranges from 0 (far) to 1 (adjacent)
            foodProximity = Math.max(0, (boardSize - foodDistance) / boardSize);
        }
        // Calculate edge penalty: -1 if on edge, 0 otherwise
        const edgePenalty = this.calculateEdgePenalty(ourSnake.head, board.width, board.height);
        // Calculate enhanced space detection for all snakes (conservative mode)
        const spaceScores = this.calculateAllSnakeSpaces(graph, board.snakes, ourSnakeId, teamSnakeIds, board.width, board.height, false);
        // Calculate optimistic self space separately (always uses optimistic=true)
        const selfSpaceOptimistic = this.calculateSnakeSpace(graph, ourSnake, board.snakes, board.width, board.height, true);
        return {
            stats: {
                myLength: ourSnake.length,
                myTerritory: bfsResult.territoryCounts.get(ourSnakeId) || 0,
                myControlledFood: bfsResult.controlledFood.get(ourSnakeId) || 0,
                myControlledFertile: bfsResult.controlledFertile.get(ourSnakeId) || 0,
                teamLength,
                teamTerritory: bfsResult.teamTerritory,
                teamControlledFood: bfsResult.teamControlledFood,
                foodDistance, // Raw unweighted distance
                foodProximity, // Normalized [0,1]: (boardSize - distance)/boardSize, 0 if eating
                foodEaten, // 1 if eating (justAte or onFoodNow), 0 otherwise
                enemyTerritory: bfsResult.enemyTerritory,
                enemyLength,
                edgePenalty, // -1 if on edge, 0 otherwise
                selfEnoughSpace: spaceScores.self,
                selfSpaceOptimistic, // Optimistic space (body segments disappear over time)
                alliesEnoughSpace: spaceScores.allies,
                opponentsEnoughSpace: spaceScores.opponents,
                kills: 0, // Would need before/after comparison to calculate
                deaths: isDead ? 1 : 0,
                enemyH2HRisk: ctx?.h2hRisk?.enemyH2HRisk ?? 0, // From context, 1 if h2h risk with enemy
                allyH2HRisk: ctx?.h2hRisk?.allyH2HRisk ?? 0 // From context, 1 if h2h risk with ally
            },
            territoryCells: bfsResult.territoryCells
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
     * @param optimistic - If true, uses optimistic passability (body segments disappear over time)
     */
    calculateAllSnakeSpaces(graph, allSnakes, ourSnakeId, teamSnakeIds, width, height, optimistic = false) {
        let selfScore = 0;
        let alliesScore = 0;
        let opponentsScore = 0;
        for (const snake of allSnakes) {
            if (snake.health <= 0)
                continue; // Skip dead snakes
            // Calculate space score for this snake
            const spaceScore = this.calculateSnakeSpace(graph, snake, allSnakes, width, height, optimistic);
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
     *
     * @param optimistic - If true, uses optimistic passability where body segments
     *                     are considered passable if they will have disappeared by
     *                     the turn we reach them (using conservative disappear turn).
     */
    calculateSnakeSpace(graph, snake, allSnakes, width, height, optimistic = false) {
        const startPos = snake.head;
        const snakeLength = snake.length;
        const snakeTailKey = graph.coordToKey(snake.body[snake.body.length - 1]);
        // Build a set of cells that belong to our own snake's body (excluding tail)
        // We never want to consider our own body as passable even with optimistic mode
        const ownBodyCells = new Set();
        for (let i = 0; i < snake.body.length - 1; i++) { // Exclude tail
            ownBodyCells.add(graph.coordToKey(snake.body[i]));
        }
        // Build a set of other snakes' tails to block (we can chase our own tail, not others')
        const otherSnakeTails = new Set();
        for (const otherSnake of allSnakes) {
            if (otherSnake.health <= 0)
                continue;
            if (otherSnake.id === snake.id)
                continue;
            const tail = otherSnake.body[otherSnake.body.length - 1];
            otherSnakeTails.add(graph.coordToKey(tail));
        }
        // Track visited cells with their arrival turn for level-based BFS
        const visited = new Map(); // key -> arrivalTurn
        let currentLevel = [{ position: startPos, turn: 0 }];
        visited.set(graph.coordToKey(startPos), 0);
        let cellsFound = 1; // Start with 1 for the head position
        let foundOwnTail = false;
        while (currentLevel.length > 0) {
            const nextLevel = [];
            for (const { position: current, turn: currentTurn } of currentLevel) {
                const arrivalTurn = currentTurn + 1;
                // Get all four potential neighbors
                const neighbors = [
                    { x: current.x, y: current.y + 1 }, // up
                    { x: current.x, y: current.y - 1 }, // down
                    { x: current.x - 1, y: current.y }, // left
                    { x: current.x + 1, y: current.y } // right
                ];
                for (const neighbor of neighbors) {
                    // Check bounds using BoardGraph (single source of truth)
                    if (!graph.isInBounds(neighbor)) {
                        continue;
                    }
                    const neighborKey = graph.coordToKey(neighbor);
                    // Skip if already visited
                    if (visited.has(neighborKey))
                        continue;
                    // Never pass through our own body (except tail check below)
                    if (ownBodyCells.has(neighborKey))
                        continue;
                    // Block other snakes' tails for space calculation
                    if (otherSnakeTails.has(neighborKey))
                        continue;
                    // Check passability - either standard or optimistic
                    let isPassable;
                    if (optimistic) {
                        // Use optimistic passability - considers body segments passable
                        // if they will have disappeared by arrivalTurn
                        isPassable = graph.isPassableAtTurn(neighbor, arrivalTurn);
                    }
                    else {
                        // Standard passability check
                        isPassable = graph.isPassable(neighbor);
                    }
                    if (!isPassable)
                        continue;
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
    calculateWeightedScores(stats) {
        return {
            myLengthScore: stats.myLength * this.weights.myLength,
            myTerritoryScore: stats.myTerritory * this.weights.myTerritory,
            myControlledFoodScore: stats.myControlledFood * this.weights.myControlledFood,
            myControlledFertileScore: stats.myControlledFertile * this.weights.myControlledFertile,
            teamLengthScore: stats.teamLength * this.weights.teamLength,
            teamTerritoryScore: stats.teamTerritory * this.weights.teamTerritory,
            teamControlledFoodScore: stats.teamControlledFood * this.weights.teamControlledFood,
            foodProximityScore: stats.foodProximity * this.weights.foodProximity,
            foodEatenScore: stats.foodEaten * this.weights.foodEaten,
            enemyTerritoryScore: stats.enemyTerritory * this.weights.enemyTerritory,
            enemyLengthScore: stats.enemyLength * this.weights.enemyLength,
            edgePenaltyScore: stats.edgePenalty * this.weights.edgePenalty,
            selfEnoughSpaceScore: stats.selfEnoughSpace * this.weights.selfEnoughSpace,
            selfSpaceOptimisticScore: stats.selfSpaceOptimistic * this.weights.selfSpaceOptimistic,
            alliesEnoughSpaceScore: stats.alliesEnoughSpace * this.weights.alliesEnoughSpace,
            opponentsEnoughSpaceScore: stats.opponentsEnoughSpace * this.weights.opponentsEnoughSpace,
            killsScore: stats.kills * this.weights.kills,
            deathsScore: stats.deaths * this.weights.deaths,
            enemyH2HRiskScore: stats.enemyH2HRisk * this.weights.enemyH2HRisk,
            allyH2HRiskScore: stats.allyH2HRisk * this.weights.allyH2HRisk
        };
    }
    /**
     * Calculate total score from weighted scores.
     */
    calculateTotalScore(weighted) {
        return weighted.myLengthScore +
            weighted.myTerritoryScore +
            weighted.myControlledFoodScore +
            weighted.myControlledFertileScore +
            weighted.teamLengthScore +
            weighted.teamTerritoryScore +
            weighted.teamControlledFoodScore +
            weighted.foodProximityScore +
            weighted.foodEatenScore +
            weighted.enemyTerritoryScore +
            weighted.enemyLengthScore +
            weighted.edgePenaltyScore +
            weighted.selfEnoughSpaceScore +
            weighted.selfSpaceOptimisticScore +
            weighted.alliesEnoughSpaceScore +
            weighted.opponentsEnoughSpaceScore +
            weighted.killsScore +
            weighted.deathsScore +
            weighted.enemyH2HRiskScore +
            weighted.allyH2HRiskScore;
    }
}
exports.BoardEvaluator = BoardEvaluator;
