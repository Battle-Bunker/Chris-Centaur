/**
 * Decision engine that orchestrates the principled architecture for move selection.
 * Uses MoveAnalyzer for move enumeration and BoardEvaluator for scoring.
 */

import { GameState, Snake, Direction, Coord } from '../types/battlesnake';
import { MoveAnalyzer, MoveAnalysis } from './move-analyzer';
import { BoardEvaluator, BoardEvaluation, EvaluationContext } from './board-evaluator';
import { Simulator } from './simulator';
import { BoardGraph } from './board-graph';

export interface MoveDecision {
  move: Direction;
  candidateMoves: Direction[];  // The actual moves we evaluated (safe OR risky, never both)
  evaluations: MoveEvaluationResult[];
}

export interface MoveEvaluationResult {
  move: Direction;
  averageScore: number;
  numStates: number;
  averageBreakdown: BoardEvaluation;
}

export interface DecisionConfig {
  maxSimulationDepth: number;
  timeoutMs: number;
  nearbyDistance: number;  // Focal distance: snakes within this Manhattan distance have all moves enumerated; snakes beyond are frozen
  tailSafetyRule?: 'official' | 'custom';  // Rule variant for tail safety
  tailGrowthTiming?: 'grow-same-turn' | 'grow-next-turn';  // When snake grows after eating
  weights?: {
    // My snake weights
    myLength?: number;
    myTerritory?: number;
    myControlledFood?: number;
    // Team weights
    teamLength?: number;
    teamTerritory?: number;
    teamControlledFood?: number;
    // Distance/proximity weights
    foodProximity?: number;
    // Enemy weights
    enemyTerritory?: number;
    enemyLength?: number;
    // Life/death weights
    kills?: number;
    deaths?: number;
  };
}

export class DecisionEngine {
  private moveAnalyzer: MoveAnalyzer;
  private boardEvaluator: BoardEvaluator;
  private simulator: Simulator;
  private config: DecisionConfig;
  private lastFoodSetByGameId: Map<string, Set<string>> = new Map();
  
  constructor(config?: Partial<DecisionConfig>) {
    this.config = {
      maxSimulationDepth: 1,
      timeoutMs: 400,
      nearbyDistance: 5,
      tailSafetyRule: 'custom',
      tailGrowthTiming: 'grow-next-turn',
      ...config
    };
    
    this.moveAnalyzer = new MoveAnalyzer(this.config.tailSafetyRule);
    this.boardEvaluator = new BoardEvaluator(
      this.config.weights,
      { tailGrowthTiming: this.config.tailGrowthTiming }
    );
    this.simulator = new Simulator();
  }
  
  /**
   * Main decision method that selects the best move for our snake.
   */
  public decide(gameState: GameState, teamSnakeIds: Set<string>): MoveDecision {
    const startTime = Date.now();
    const gameId = gameState.game.id;
    
    // Get previous food positions for this game
    const prevFoodSet = this.lastFoodSetByGameId.get(gameId);
    
    // Build current food set for simulated evaluations
    const currentFoodSet = new Set<string>();
    for (const food of gameState.board.food) {
      currentFoodSet.add(`${food.x},${food.y}`);
    }
    
    // Create BoardGraph once for this turn - single source of truth for passability
    const graph = new BoardGraph(gameState, { tailGrowthTiming: this.config.tailGrowthTiming });
    
    // Get candidate moves for our snake
    const ourMoves = this.getOurCandidateMoves(gameState.you, gameState, graph);
    
    if (ourMoves.length === 0) {
      // No moves available - we're dead
      return {
        move: 'up',
        candidateMoves: [],
        evaluations: []
      };
    }
    
    if (ourMoves.length === 1) {
      // Only one move available - still evaluate it properly
      const evaluation = this.boardEvaluator.evaluateBoard(
        gameState, 
        gameState.you.id, 
        teamSnakeIds,
        { prevFoodSet }
      );
      
      // Update food set for next turn
      this.lastFoodSetByGameId.set(gameId, currentFoodSet);
      
      return {
        move: ourMoves[0],
        candidateMoves: ourMoves,
        evaluations: [{
          move: ourMoves[0],
          averageScore: evaluation.score,  // Use actual score, not 0!
          numStates: 1,
          averageBreakdown: evaluation
        }]
      };
    }
    
    // Enumerate possible board states
    const boardStates = this.enumerateBoardStates(gameState, ourMoves, teamSnakeIds, startTime, graph);
    
    // Evaluate each of our candidate moves
    const evaluations: MoveEvaluationResult[] = [];
    let bestMove = ourMoves[0];
    let bestScore = -Infinity;
    
    for (const move of ourMoves) {
      const moveStates = boardStates.filter(state => state.ourMove === move);
      
      if (moveStates.length === 0) {
        // This shouldn't happen but handle gracefully
        evaluations.push({
          move,
          averageScore: -1000,
          numStates: 0,
          averageBreakdown: this.boardEvaluator.evaluateBoard(
            gameState, 
            gameState.you.id, 
            teamSnakeIds,
            { prevFoodSet }
          )
        });
        continue;
      }
      
      // Average the evaluations for this move
      let totalScore = 0;
      const allEvaluations: BoardEvaluation[] = [];
      
      for (const state of moveStates) {
        const evaluation = this.boardEvaluator.evaluateBoard(
          state.gameState, 
          gameState.you.id, 
          teamSnakeIds,
          { prevFoodSet: currentFoodSet }  // Current food is "previous" from simulated state's perspective
        );
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
    
    // Update food set for next turn
    this.lastFoodSetByGameId.set(gameId, currentFoodSet);
    
    return {
      move: bestMove,
      candidateMoves: ourMoves,
      evaluations
    };
  }
  
  /**
   * Get candidate moves for our snake using the principled rule:
   * Use safe moves if available, otherwise use all risky moves.
   */
  private getOurCandidateMoves(snake: Snake, gameState: GameState, graph: BoardGraph): Direction[] {
    const analysis = this.moveAnalyzer.analyzeMoves(snake, gameState, graph);
    
    // Use safe moves if available, otherwise use risky moves
    if (analysis.safe.length > 0) {
      return analysis.safe;
    } else {
      return analysis.risky;
    }
  }
  
  /**
   * Get candidate moves for other snakes.
   * All non-death moves (safe + risky) are considered.
   */
  private getOtherSnakeCandidateMoves(snake: Snake, gameState: GameState, graph: BoardGraph): Direction[] {
    const analysis = this.moveAnalyzer.analyzeMoves(snake, gameState, graph);
    
    // Other snakes consider all non-death moves
    return [...analysis.safe, ...analysis.risky];
  }
  
  /**
   * Enumerate possible board states based on move combinations.
   */
  private enumerateBoardStates(
    gameState: GameState, 
    ourMoves: Direction[], 
    teamSnakeIds: Set<string>,
    startTime: number,
    graph: BoardGraph
  ): { ourMove: Direction; gameState: GameState }[] {
    
    const results: { ourMove: Direction; gameState: GameState }[] = [];
    const { board } = gameState;
    
    // Identify nearby snakes within focal distance for full move enumeration
    // Distant snakes (outside nearbyDistance) are frozen and not simulated
    const nearbySnakes: Snake[] = [];
    
    for (const snake of board.snakes) {
      if (snake.id === gameState.you.id || snake.health <= 0) continue;
      
      const distance = this.manhattanDistance(gameState.you.head, snake.head);
      if (distance <= this.config.nearbyDistance) {
        nearbySnakes.push(snake);
      }
      // Snakes beyond nearbyDistance are frozen (not included in simulation)
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
        const fullMoveSet = new Map<string, Direction>();
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
        const nextGameState: GameState = {
          game: gameState.game,
          turn: gameState.turn + 1,
          board: simulatedBoard.board,
          you: simulatedBoard.board.snakes.find(s => s.id === gameState.you.id) || gameState.you
        };
        
        results.push({
          ourMove,
          gameState: nextGameState
        });
      }
    }
    
    return results;
  }
  
  /**
   * Generate all possible move combinations for nearby snakes.
   */
  private generateNearbyMoveSets(
    nearbySnakes: Snake[], 
    gameState: GameState,
    graph: BoardGraph
  ): Map<string, Direction>[] {
    
    if (nearbySnakes.length === 0) {
      return [new Map()]; // Single empty move set
    }
    
    // Get candidate moves for each nearby snake
    const snakeMovesMap = new Map<string, Direction[]>();
    for (const snake of nearbySnakes) {
      const moves = this.getOtherSnakeCandidateMoves(snake, gameState, graph);
      if (moves.length > 0) {
        snakeMovesMap.set(snake.id, moves);
      }
    }
    
    // Generate all combinations
    const moveSets: Map<string, Direction>[] = [];
    this.generateCombinations(
      Array.from(snakeMovesMap.entries()),
      0,
      new Map(),
      moveSets
    );
    
    return moveSets;
  }
  
  /**
   * Recursive helper to generate move combinations.
   */
  private generateCombinations(
    snakeMoves: [string, Direction[]][],
    index: number,
    current: Map<string, Direction>,
    results: Map<string, Direction>[]
  ): void {
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
  private manhattanDistance(a: Coord, b: Coord): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  
  /**
   * Average multiple board evaluations.
   */
  private averageEvaluations(evaluations: BoardEvaluation[]): BoardEvaluation {
    if (evaluations.length === 0) {
      throw new Error('Cannot average empty evaluations');
    }
    
    // Sum all stats
    const sumStats = {
      myLength: 0,
      myTerritory: 0,
      myControlledFood: 0,
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
      deaths: 0
    };
    
    const sumWeighted = {
      myLengthScore: 0,
      myTerritoryScore: 0,
      myControlledFoodScore: 0,
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
      deathsScore: 0
    };
    
    let totalScore = 0;
    
    for (const evaluation of evaluations) {
      // Sum stats
      sumStats.myLength += evaluation.stats.myLength;
      sumStats.myTerritory += evaluation.stats.myTerritory;
      sumStats.myControlledFood += evaluation.stats.myControlledFood;
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
      
      // Sum weighted scores
      sumWeighted.myLengthScore += evaluation.weighted.myLengthScore;
      sumWeighted.myTerritoryScore += evaluation.weighted.myTerritoryScore;
      sumWeighted.myControlledFoodScore += evaluation.weighted.myControlledFoodScore;
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
        deaths: sumStats.deaths / count
      },
      weights: evaluations[0].weights, // All evaluations use same weights
      weighted: {
        myLengthScore: sumWeighted.myLengthScore / count,
        myTerritoryScore: sumWeighted.myTerritoryScore / count,
        myControlledFoodScore: sumWeighted.myControlledFoodScore / count,
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
        deathsScore: sumWeighted.deathsScore / count
      }
    };
  }
}