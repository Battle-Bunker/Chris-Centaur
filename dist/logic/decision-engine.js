"use strict";
/**
 * Decision engine that orchestrates the principled architecture for move selection.
 * Uses MoveAnalyzer for move enumeration and BoardEvaluator for scoring.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DecisionEngine = void 0;
const move_analyzer_1 = require("./move-analyzer");
const board_evaluator_1 = require("./board-evaluator");
const simulator_1 = require("./simulator");
const board_graph_1 = require("./board-graph");
const multi_source_bfs_1 = require("./multi-source-bfs");
class DecisionEngine {
    constructor(config) {
        this.lastFoodSetByGameId = new Map();
        this.config = {
            maxSimulationDepth: 1,
            timeoutMs: 400,
            nearbyDistance: 5,
            tailSafetyRule: 'custom',
            tailGrowthTiming: 'grow-next-turn',
            ...config
        };
        this.moveAnalyzer = new move_analyzer_1.MoveAnalyzer(this.config.tailSafetyRule);
        this.boardEvaluator = new board_evaluator_1.BoardEvaluator(this.config.weights, { tailGrowthTiming: this.config.tailGrowthTiming });
        this.simulator = new simulator_1.Simulator();
    }
    /**
     * Main decision method that selects the best move for our snake.
     * Now considers all non-lethal moves (safe + risky) and applies h2h risk penalties.
     */
    decide(gameState, teamSnakeIds) {
        const startTime = Date.now();
        const gameId = gameState.game.id;
        // Get previous food positions for this game
        const prevFoodSet = this.lastFoodSetByGameId.get(gameId);
        // Build current food set for simulated evaluations
        const currentFoodSet = new Set();
        for (const food of gameState.board.food) {
            currentFoodSet.add(`${food.x},${food.y}`);
        }
        // Create BoardGraph once for this turn - single source of truth for passability
        const graph = new board_graph_1.BoardGraph(gameState, { tailGrowthTiming: this.config.tailGrowthTiming });
        // Get move analysis with h2h risk details
        const moveAnalysis = this.moveAnalyzer.analyzeMoves(gameState.you, gameState, graph, teamSnakeIds);
        // Consider ALL non-lethal moves (safe + risky) - h2h risk is now a weighted penalty
        const ourMoves = [...moveAnalysis.safe, ...moveAnalysis.risky];
        if (ourMoves.length === 0) {
            // No moves available - we're dead
            return {
                move: 'up',
                candidateMoves: [],
                evaluations: [],
                h2hRiskByMove: new Map()
            };
        }
        if (ourMoves.length === 1) {
            // Only one move available - still evaluate it properly
            const h2hRisk = moveAnalysis.h2hRiskByMove.get(ourMoves[0]);
            const evaluation = this.boardEvaluator.evaluateBoard(gameState, gameState.you.id, teamSnakeIds, {
                prevFoodSet,
                h2hRisk: {
                    enemyH2HRisk: h2hRisk?.hasEnemyRisk ? 1 : 0,
                    allyH2HRisk: h2hRisk?.hasAllyRisk ? 1 : 0
                }
            });
            // Compute projected territory for the single move
            const singleMovePos = this.getMovePosition(gameState.you.head, ourMoves[0]);
            const singleProjSources = [{
                    id: gameState.you.id,
                    position: singleMovePos,
                    isTeam: true,
                    startDelay: 1
                }];
            for (const snake of gameState.board.snakes) {
                if (snake.id === gameState.you.id || snake.health <= 0)
                    continue;
                singleProjSources.push({
                    id: snake.id,
                    position: snake.head,
                    isTeam: teamSnakeIds.has(snake.id),
                    startDelay: 0
                });
            }
            const singleProjBfs = new multi_source_bfs_1.MultiSourceBFS(graph);
            const singleProjResult = singleProjBfs.compute(singleProjSources, gameState.board.food, undefined, gameState.board.fertileTiles);
            const singleProjTerritory = {};
            for (const [snakeId, cells] of singleProjResult.territoryCells) {
                singleProjTerritory[snakeId] = cells;
            }
            // Update food set for next turn
            this.lastFoodSetByGameId.set(gameId, currentFoodSet);
            return {
                move: ourMoves[0],
                candidateMoves: ourMoves,
                evaluations: [{
                        move: ourMoves[0],
                        averageScore: evaluation.score,
                        numStates: 1,
                        averageBreakdown: evaluation,
                        projectedTerritoryCells: singleProjTerritory
                    }],
                h2hRiskByMove: moveAnalysis.h2hRiskByMove
            };
        }
        // Enumerate possible board states
        const boardStates = this.enumerateBoardStates(gameState, ourMoves, teamSnakeIds, startTime, graph);
        // Evaluate each of our candidate moves
        const evaluations = [];
        let bestMove = ourMoves[0];
        let bestScore = -Infinity;
        for (const move of ourMoves) {
            const moveStates = boardStates.filter(state => state.ourMove === move);
            // Get h2h risk for this move
            const h2hRisk = moveAnalysis.h2hRiskByMove.get(move);
            const h2hRiskCtx = {
                enemyH2HRisk: h2hRisk?.hasEnemyRisk ? 1 : 0,
                allyH2HRisk: h2hRisk?.hasAllyRisk ? 1 : 0
            };
            if (moveStates.length === 0) {
                // This shouldn't happen but handle gracefully
                evaluations.push({
                    move,
                    averageScore: -1000,
                    numStates: 0,
                    averageBreakdown: this.boardEvaluator.evaluateBoard(gameState, gameState.you.id, teamSnakeIds, { prevFoodSet, h2hRisk: h2hRiskCtx })
                });
                continue;
            }
            // Average the evaluations for this move
            let totalScore = 0;
            const allEvaluations = [];
            for (const state of moveStates) {
                const evaluation = this.boardEvaluator.evaluateBoard(state.gameState, gameState.you.id, teamSnakeIds, {
                    prevFoodSet: currentFoodSet, // Current food is "previous" from simulated state's perspective
                    h2hRisk: h2hRiskCtx, // Pass h2h risk to evaluator
                    simulatedSnakeIds: state.simulatedSnakeIds // Snakes that were simulated get startDelay: 1
                });
                totalScore += evaluation.score;
                allEvaluations.push(evaluation);
            }
            const averageScore = totalScore / moveStates.length;
            // Calculate average breakdown
            const averageBreakdown = this.averageEvaluations(allEvaluations);
            evaluations.push({
                move,
                averageScore,
                numStates: moveStates.length,
                averageBreakdown
            });
            if (averageScore > bestScore) {
                bestScore = averageScore;
                bestMove = move;
            }
        }
        // Compute projected territory per move (asymmetric BFS)
        const teamSnakeIdsForBFS = new Set();
        const teams = gameState.board.snakes.filter((s) => s.health > 0 && teamSnakeIds.has(s.id));
        for (const s of teams)
            teamSnakeIdsForBFS.add(s.id);
        for (const evalResult of evaluations) {
            const candidatePos = this.getMovePosition(gameState.you.head, evalResult.move);
            if (!candidatePos)
                continue;
            const projSources = [];
            projSources.push({
                id: gameState.you.id,
                position: candidatePos,
                isTeam: true,
                startDelay: 1
            });
            for (const snake of gameState.board.snakes) {
                if (snake.id === gameState.you.id || snake.health <= 0)
                    continue;
                projSources.push({
                    id: snake.id,
                    position: snake.head,
                    isTeam: teamSnakeIds.has(snake.id),
                    startDelay: 0
                });
            }
            const projBfs = new multi_source_bfs_1.MultiSourceBFS(graph);
            const projResult = projBfs.compute(projSources, gameState.board.food, undefined, gameState.board.fertileTiles);
            const projTerritoryCells = {};
            for (const [snakeId, cells] of projResult.territoryCells) {
                projTerritoryCells[snakeId] = cells;
            }
            evalResult.projectedTerritoryCells = projTerritoryCells;
        }
        // Update food set for next turn
        this.lastFoodSetByGameId.set(gameId, currentFoodSet);
        return {
            move: bestMove,
            candidateMoves: ourMoves,
            evaluations,
            h2hRiskByMove: moveAnalysis.h2hRiskByMove
        };
    }
    /**
     * Get candidate moves for our snake using the principled rule:
     * Use safe moves if available, otherwise use all risky moves.
     */
    getOurCandidateMoves(snake, gameState, graph) {
        const analysis = this.moveAnalyzer.analyzeMoves(snake, gameState, graph);
        // Use safe moves if available, otherwise use risky moves
        if (analysis.safe.length > 0) {
            return analysis.safe;
        }
        else {
            return analysis.risky;
        }
    }
    /**
     * Get candidate moves for other snakes.
     * All non-death moves (safe + risky) are considered.
     */
    getOtherSnakeCandidateMoves(snake, gameState, graph) {
        const analysis = this.moveAnalyzer.analyzeMoves(snake, gameState, graph);
        // Other snakes consider all non-death moves
        return [...analysis.safe, ...analysis.risky];
    }
    /**
     * Enumerate possible board states based on move combinations.
     */
    enumerateBoardStates(gameState, ourMoves, teamSnakeIds, startTime, graph) {
        const results = [];
        const { board } = gameState;
        // Identify nearby snakes within focal distance for full move enumeration
        // Distant snakes (outside nearbyDistance) are frozen and not simulated
        const nearbySnakes = [];
        for (const snake of board.snakes) {
            if (snake.id === gameState.you.id || snake.health <= 0)
                continue;
            const distance = this.manhattanDistance(gameState.you.head, snake.head);
            if (distance <= this.config.nearbyDistance) {
                nearbySnakes.push(snake);
            }
            // Snakes beyond nearbyDistance are frozen (not included in simulation)
        }
        // Build the set of simulated snake IDs (our snake + nearby snakes)
        const simulatedSnakeIds = new Set([gameState.you.id]);
        for (const snake of nearbySnakes) {
            simulatedSnakeIds.add(snake.id);
        }
        // For each of our moves
        for (const ourMove of ourMoves) {
            // Check time budget
            if (Date.now() - startTime > this.config.timeoutMs) {
                break;
            }
            // Generate move combinations for nearby snakes
            const nearbyMoveSets = this.generateNearbyMoveSets(nearbySnakes, gameState, graph);
            // For each nearby move combination
            for (const nearbyMoveSet of nearbyMoveSets) {
                // Check time budget
                if (Date.now() - startTime > this.config.timeoutMs) {
                    break;
                }
                // Create full move set
                const fullMoveSet = new Map();
                fullMoveSet.set(gameState.you.id, ourMove);
                // Add nearby snake moves
                for (const [snakeId, move] of nearbyMoveSet) {
                    fullMoveSet.set(snakeId, move);
                }
                // Distant snakes are frozen (not included in move set) to avoid
                // noise from random move selection affecting board evaluation
                // Simulate the board state
                const simulatedBoard = this.simulator.simulateNextBoardState(gameState, fullMoveSet);
                // Construct new GameState from simulated board
                const nextGameState = {
                    game: gameState.game,
                    turn: gameState.turn + 1,
                    board: simulatedBoard.board,
                    you: simulatedBoard.board.snakes.find(s => s.id === gameState.you.id) || gameState.you
                };
                results.push({
                    ourMove,
                    gameState: nextGameState,
                    simulatedSnakeIds
                });
            }
        }
        return results;
    }
    /**
     * Generate all possible move combinations for nearby snakes.
     */
    generateNearbyMoveSets(nearbySnakes, gameState, graph) {
        if (nearbySnakes.length === 0) {
            return [new Map()]; // Single empty move set
        }
        // Get candidate moves for each nearby snake
        const snakeMovesMap = new Map();
        for (const snake of nearbySnakes) {
            const moves = this.getOtherSnakeCandidateMoves(snake, gameState, graph);
            if (moves.length > 0) {
                snakeMovesMap.set(snake.id, moves);
            }
        }
        // Generate all combinations
        const moveSets = [];
        this.generateCombinations(Array.from(snakeMovesMap.entries()), 0, new Map(), moveSets);
        return moveSets;
    }
    /**
     * Recursive helper to generate move combinations.
     */
    generateCombinations(snakeMoves, index, current, results) {
        if (index >= snakeMoves.length) {
            results.push(new Map(current));
            return;
        }
        const [snakeId, moves] = snakeMoves[index];
        for (const move of moves) {
            current.set(snakeId, move);
            this.generateCombinations(snakeMoves, index + 1, current, results);
        }
    }
    /**
     * Calculate Manhattan distance between two coordinates.
     */
    manhattanDistance(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }
    getMovePosition(head, direction) {
        switch (direction) {
            case 'up': return { x: head.x, y: head.y + 1 };
            case 'down': return { x: head.x, y: head.y - 1 };
            case 'left': return { x: head.x - 1, y: head.y };
            case 'right': return { x: head.x + 1, y: head.y };
        }
    }
    /**
     * Average multiple board evaluations.
     */
    averageEvaluations(evaluations) {
        if (evaluations.length === 0) {
            throw new Error('Cannot average empty evaluations');
        }
        // Sum all stats
        const sumStats = {
            myLength: 0,
            myTerritory: 0,
            myControlledFood: 0,
            myControlledFertile: 0,
            teamLength: 0,
            teamTerritory: 0,
            teamControlledFood: 0,
            foodDistance: 0,
            foodProximity: 0,
            foodEaten: 0,
            enemyTerritory: 0,
            enemyLength: 0,
            edgePenalty: 0,
            selfEnoughSpace: 0,
            selfSpaceOptimistic: 0,
            alliesEnoughSpace: 0,
            opponentsEnoughSpace: 0,
            kills: 0,
            deaths: 0,
            enemyH2HRisk: 0,
            allyH2HRisk: 0
        };
        const sumWeighted = {
            myLengthScore: 0,
            myTerritoryScore: 0,
            myControlledFoodScore: 0,
            myControlledFertileScore: 0,
            teamLengthScore: 0,
            teamTerritoryScore: 0,
            teamControlledFoodScore: 0,
            foodProximityScore: 0,
            foodEatenScore: 0,
            enemyTerritoryScore: 0,
            enemyLengthScore: 0,
            edgePenaltyScore: 0,
            selfEnoughSpaceScore: 0,
            selfSpaceOptimisticScore: 0,
            alliesEnoughSpaceScore: 0,
            opponentsEnoughSpaceScore: 0,
            killsScore: 0,
            deathsScore: 0,
            enemyH2HRiskScore: 0,
            allyH2HRiskScore: 0
        };
        let totalScore = 0;
        for (const evaluation of evaluations) {
            // Sum stats
            sumStats.myLength += evaluation.stats.myLength;
            sumStats.myTerritory += evaluation.stats.myTerritory;
            sumStats.myControlledFood += evaluation.stats.myControlledFood;
            sumStats.myControlledFertile += evaluation.stats.myControlledFertile;
            sumStats.teamLength += evaluation.stats.teamLength;
            sumStats.teamTerritory += evaluation.stats.teamTerritory;
            sumStats.teamControlledFood += evaluation.stats.teamControlledFood;
            sumStats.foodDistance += evaluation.stats.foodDistance;
            sumStats.foodProximity += evaluation.stats.foodProximity;
            sumStats.foodEaten += evaluation.stats.foodEaten;
            sumStats.enemyTerritory += evaluation.stats.enemyTerritory;
            sumStats.enemyLength += evaluation.stats.enemyLength;
            sumStats.edgePenalty += evaluation.stats.edgePenalty;
            sumStats.selfEnoughSpace += evaluation.stats.selfEnoughSpace;
            sumStats.selfSpaceOptimistic += evaluation.stats.selfSpaceOptimistic;
            sumStats.alliesEnoughSpace += evaluation.stats.alliesEnoughSpace;
            sumStats.opponentsEnoughSpace += evaluation.stats.opponentsEnoughSpace;
            sumStats.kills += evaluation.stats.kills;
            sumStats.deaths += evaluation.stats.deaths;
            sumStats.enemyH2HRisk += evaluation.stats.enemyH2HRisk;
            sumStats.allyH2HRisk += evaluation.stats.allyH2HRisk;
            // Sum weighted scores
            sumWeighted.myLengthScore += evaluation.weighted.myLengthScore;
            sumWeighted.myTerritoryScore += evaluation.weighted.myTerritoryScore;
            sumWeighted.myControlledFoodScore += evaluation.weighted.myControlledFoodScore;
            sumWeighted.myControlledFertileScore += evaluation.weighted.myControlledFertileScore;
            sumWeighted.teamLengthScore += evaluation.weighted.teamLengthScore;
            sumWeighted.teamTerritoryScore += evaluation.weighted.teamTerritoryScore;
            sumWeighted.teamControlledFoodScore += evaluation.weighted.teamControlledFoodScore;
            sumWeighted.foodProximityScore += evaluation.weighted.foodProximityScore;
            sumWeighted.foodEatenScore += evaluation.weighted.foodEatenScore;
            sumWeighted.enemyTerritoryScore += evaluation.weighted.enemyTerritoryScore;
            sumWeighted.enemyLengthScore += evaluation.weighted.enemyLengthScore;
            sumWeighted.edgePenaltyScore += evaluation.weighted.edgePenaltyScore;
            sumWeighted.selfEnoughSpaceScore += evaluation.weighted.selfEnoughSpaceScore;
            sumWeighted.selfSpaceOptimisticScore += evaluation.weighted.selfSpaceOptimisticScore;
            sumWeighted.alliesEnoughSpaceScore += evaluation.weighted.alliesEnoughSpaceScore;
            sumWeighted.opponentsEnoughSpaceScore += evaluation.weighted.opponentsEnoughSpaceScore;
            sumWeighted.killsScore += evaluation.weighted.killsScore;
            sumWeighted.deathsScore += evaluation.weighted.deathsScore;
            sumWeighted.enemyH2HRiskScore += evaluation.weighted.enemyH2HRiskScore;
            sumWeighted.allyH2HRiskScore += evaluation.weighted.allyH2HRiskScore;
            totalScore += evaluation.score;
        }
        const count = evaluations.length;
        // Return averaged evaluation
        return {
            score: totalScore / count,
            stats: {
                myLength: sumStats.myLength / count,
                myTerritory: sumStats.myTerritory / count,
                myControlledFood: sumStats.myControlledFood / count,
                myControlledFertile: sumStats.myControlledFertile / count,
                teamLength: sumStats.teamLength / count,
                teamTerritory: sumStats.teamTerritory / count,
                teamControlledFood: sumStats.teamControlledFood / count,
                foodDistance: sumStats.foodDistance / count,
                foodProximity: sumStats.foodProximity / count,
                foodEaten: sumStats.foodEaten / count,
                enemyTerritory: sumStats.enemyTerritory / count,
                enemyLength: sumStats.enemyLength / count,
                edgePenalty: sumStats.edgePenalty / count,
                selfEnoughSpace: sumStats.selfEnoughSpace / count,
                selfSpaceOptimistic: sumStats.selfSpaceOptimistic / count,
                alliesEnoughSpace: sumStats.alliesEnoughSpace / count,
                opponentsEnoughSpace: sumStats.opponentsEnoughSpace / count,
                kills: sumStats.kills / count,
                deaths: sumStats.deaths / count,
                enemyH2HRisk: sumStats.enemyH2HRisk / count,
                allyH2HRisk: sumStats.allyH2HRisk / count
            },
            weights: evaluations[0].weights, // All evaluations use same weights
            weighted: {
                myLengthScore: sumWeighted.myLengthScore / count,
                myTerritoryScore: sumWeighted.myTerritoryScore / count,
                myControlledFoodScore: sumWeighted.myControlledFoodScore / count,
                myControlledFertileScore: sumWeighted.myControlledFertileScore / count,
                teamLengthScore: sumWeighted.teamLengthScore / count,
                teamTerritoryScore: sumWeighted.teamTerritoryScore / count,
                teamControlledFoodScore: sumWeighted.teamControlledFoodScore / count,
                foodProximityScore: sumWeighted.foodProximityScore / count,
                foodEatenScore: sumWeighted.foodEatenScore / count,
                enemyTerritoryScore: sumWeighted.enemyTerritoryScore / count,
                enemyLengthScore: sumWeighted.enemyLengthScore / count,
                edgePenaltyScore: sumWeighted.edgePenaltyScore / count,
                selfEnoughSpaceScore: sumWeighted.selfEnoughSpaceScore / count,
                selfSpaceOptimisticScore: sumWeighted.selfSpaceOptimisticScore / count,
                alliesEnoughSpaceScore: sumWeighted.alliesEnoughSpaceScore / count,
                opponentsEnoughSpaceScore: sumWeighted.opponentsEnoughSpaceScore / count,
                killsScore: sumWeighted.killsScore / count,
                deathsScore: sumWeighted.deathsScore / count,
                enemyH2HRiskScore: sumWeighted.enemyH2HRiskScore / count,
                allyH2HRiskScore: sumWeighted.allyH2HRiskScore / count
            }
        };
    }
}
exports.DecisionEngine = DecisionEngine;
