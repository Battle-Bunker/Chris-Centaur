"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Evaluator = void 0;
const move_enumerator_1 = require("./move-enumerator");
const simulator_1 = require("./simulator");
const bfs_metrics_1 = require("./bfs-metrics");
const scorer_1 = require("./scorer");
class Evaluator {
    constructor(config = {}) {
        this.config = {
            maxNearbyDistance: config.maxNearbyDistance ?? 3,
            maxStates: config.maxStates ?? 729,
            timeoutMs: config.timeoutMs ?? 400,
            scorerConfig: config.scorerConfig
        };
        this.moveEnumerator = new move_enumerator_1.MoveEnumerator({
            maxNearbyDistance: this.config.maxNearbyDistance,
            maxStates: this.config.maxStates,
            timeoutMs: this.config.timeoutMs
        });
        this.simulator = new simulator_1.Simulator();
        this.bfsMetrics = new bfs_metrics_1.MultiHeadMetricsBFS();
        this.scorer = new scorer_1.Scorer(this.config.scorerConfig);
    }
    /**
     * Evaluate all moves with detailed breakdown for logging
     */
    evaluateMovesWithBreakdown(gameState) {
        const startTime = Date.now();
        // Get our valid moves
        const ourValidMoves = this.getValidMoves(gameState.you, gameState);
        if (ourValidMoves.length === 0) {
            return { bestMove: 'up', evaluations: new Map() };
        }
        if (ourValidMoves.length === 1) {
            return { bestMove: ourValidMoves[0], evaluations: new Map() };
        }
        // Enumerate all possible move sets
        const moveSets = this.moveEnumerator.enumerateMoveSets(gameState, startTime);
        // Evaluate each of our moves
        const moveEvaluations = new Map();
        for (const ourMove of ourValidMoves) {
            const scoreBreakdowns = [];
            // Filter move sets that start with our move
            const relevantMoveSets = moveSets.filter(moveSet => moveSet.get(gameState.you.id) === ourMove);
            // Early abort if this move leads to immediate death
            if (relevantMoveSets.length === 0) {
                moveEvaluations.set(ourMove, {
                    move: ourMove,
                    averageScore: -Infinity,
                    numStates: 0
                });
                continue;
            }
            // Evaluate each move set
            for (const moveSet of relevantMoveSets) {
                // Check time budget
                if (Date.now() - startTime > this.config.timeoutMs) {
                    break;
                }
                // Simulate the next board state
                const simulatedState = this.simulator.simulateNextBoardState(gameState, moveSet);
                // Skip if we died in this simulation
                if (simulatedState.deadSnakeIds.has(gameState.you.id)) {
                    // Add death score breakdown
                    scoreBreakdowns.push({
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
                        weights: this.scorer.getWeights(),
                        weighted: {
                            foodDistanceScore: 0,
                            fertileScore: 0,
                            teamLengthScore: 0
                        }
                    });
                    continue;
                }
                // Calculate metrics for the simulated state
                const aliveSnakes = simulatedState.board.snakes.filter(s => !simulatedState.deadSnakeIds.has(s.id));
                const metrics = this.bfsMetrics.computeMetrics(simulatedState.board, aliveSnakes);
                // Calculate score breakdown
                const scoreBreakdown = this.scorer.calculateScoreBreakdown(metrics, gameState, gameState.you.id, aliveSnakes);
                scoreBreakdowns.push(scoreBreakdown);
            }
            // Calculate average breakdown for this move, INCLUDING death scenarios
            // This ensures moves with death risk are properly penalized
            const averageBreakdown = this.averageBreakdowns(scoreBreakdowns);
            const averageScore = averageBreakdown?.total ?? -Infinity;
            // Also track death probability for additional safety
            const deathCount = scoreBreakdowns.filter(s => s.total === -500).length;
            const deathProbability = scoreBreakdowns.length > 0 ? deathCount / scoreBreakdowns.length : 0;
            moveEvaluations.set(ourMove, {
                move: ourMove,
                averageScore,
                numStates: scoreBreakdowns.length,
                averageBreakdown
            });
        }
        // Select the move with highest average score
        let bestMove = ourValidMoves[0];
        let bestScore = -Infinity;
        for (const [move, evaluation] of moveEvaluations.entries()) {
            if (evaluation.averageScore > bestScore) {
                bestScore = evaluation.averageScore;
                bestMove = move;
            }
        }
        // const timeTaken = Date.now() - startTime;
        return { bestMove, evaluations: moveEvaluations };
    }
    /**
     * Evaluate all possible moves and return the best one
     */
    evaluateMoves(gameState) {
        return this.evaluateMovesWithBreakdown(gameState).bestMove;
    }
    /**
     * Average multiple score breakdowns
     */
    averageBreakdowns(breakdowns) {
        if (breakdowns.length === 0)
            return undefined;
        const avg = {
            total: 0,
            components: {
                foodDistance: 0,
                myTerritory: 0,
                myFoodCount: 0,
                myLength: 0,
                teamTerritory: 0,
                teamFoodCount: 0,
                teamLength: 0
            },
            weights: breakdowns[0].weights, // Weights are the same for all
            weighted: {
                foodDistanceScore: 0,
                fertileScore: 0,
                teamLengthScore: 0
            }
        };
        // Sum all components
        for (const breakdown of breakdowns) {
            avg.total += breakdown.total;
            avg.components.foodDistance += breakdown.components.foodDistance;
            avg.components.myTerritory += breakdown.components.myTerritory;
            avg.components.myFoodCount += breakdown.components.myFoodCount;
            avg.components.myLength += breakdown.components.myLength;
            avg.components.teamTerritory += breakdown.components.teamTerritory;
            avg.components.teamFoodCount += breakdown.components.teamFoodCount;
            avg.components.teamLength += breakdown.components.teamLength;
            avg.weighted.foodDistanceScore += breakdown.weighted.foodDistanceScore;
            avg.weighted.fertileScore += breakdown.weighted.fertileScore;
            avg.weighted.teamLengthScore += breakdown.weighted.teamLengthScore;
        }
        // Average all values
        const count = breakdowns.length;
        avg.total /= count;
        avg.components.foodDistance /= count;
        avg.components.myTerritory /= count;
        avg.components.myFoodCount /= count;
        avg.components.myLength /= count;
        avg.components.teamTerritory /= count;
        avg.components.teamFoodCount /= count;
        avg.components.teamLength /= count;
        avg.weighted.foodDistanceScore /= count;
        avg.weighted.fertileScore /= count;
        avg.weighted.teamLengthScore /= count;
        return avg;
    }
    /**
     * Get valid moves for a snake (non-death moves)
     */
    getValidMoves(snake, gameState) {
        const validMoves = [];
        const head = snake.head;
        const moves = [
            { dir: 'up', coord: { x: head.x, y: head.y + 1 } },
            { dir: 'down', coord: { x: head.x, y: head.y - 1 } },
            { dir: 'left', coord: { x: head.x - 1, y: head.y } },
            { dir: 'right', coord: { x: head.x + 1, y: head.y } }
        ];
        for (const move of moves) {
            if (this.isSafeMove(move.coord, snake, gameState)) {
                validMoves.push(move.dir);
            }
        }
        return validMoves.length > 0 ? validMoves : ['up']; // Fallback if no safe moves
    }
    isSafeMove(coord, snake, gameState) {
        // Check bounds
        if (coord.x < 0 || coord.x >= gameState.board.width ||
            coord.y < 0 || coord.y >= gameState.board.height) {
            return false;
        }
        // Check collision with snake bodies
        for (const otherSnake of gameState.board.snakes) {
            if (otherSnake.health <= 0)
                continue;
            for (let i = 0; i < otherSnake.body.length; i++) {
                const segment = otherSnake.body[i];
                // Allow moving into own tail if not eating
                if (otherSnake.id === snake.id && i === otherSnake.body.length - 1) {
                    // Check if snake will eat at its NEW position
                    const onFood = (gameState.board.food ?? []).some(f => f.x === coord.x && f.y === coord.y);
                    if (!onFood)
                        continue;
                }
                if (segment.x === coord.x && segment.y === coord.y) {
                    return false;
                }
            }
        }
        // Head-to-head filtering is now handled by move-enumerator for our snake only
        // This allows other snakes (potentially human allies) to coordinate
        return true;
    }
}
exports.Evaluator = Evaluator;
//# sourceMappingURL=evaluator.js.map