import { Direction, GameState } from '../types/battlesnake';
import { MoveEnumerator, MoveSet } from './move-enumerator';
import { Simulator } from './simulator';
import { MultiHeadMetricsBFS } from './bfs-metrics';
import { Scorer } from './scorer';

export interface EvaluatorConfig {
  maxNearbyDistance: number;
  maxStates: number;
  timeoutMs: number;
  scorerConfig?: {
    weightFood: number;
    weightFertile: number;
    weightTeamLength: number;
  };
}

export interface MoveEvaluation {
  move: Direction;
  averageScore: number;
  numStates: number;
}

export class Evaluator {
  private readonly config: EvaluatorConfig;
  private readonly moveEnumerator: MoveEnumerator;
  private readonly simulator: Simulator;
  private readonly bfsMetrics: MultiHeadMetricsBFS;
  private readonly scorer: Scorer;

  constructor(config: Partial<EvaluatorConfig> = {}) {
    this.config = {
      maxNearbyDistance: config.maxNearbyDistance ?? 3,
      maxStates: config.maxStates ?? 729,
      timeoutMs: config.timeoutMs ?? 400,
      scorerConfig: config.scorerConfig
    };

    this.moveEnumerator = new MoveEnumerator({
      maxNearbyDistance: this.config.maxNearbyDistance,
      maxStates: this.config.maxStates,
      timeoutMs: this.config.timeoutMs
    });

    this.simulator = new Simulator();
    this.bfsMetrics = new MultiHeadMetricsBFS();
    this.scorer = new Scorer(this.config.scorerConfig);
  }

  /**
   * Evaluate all possible moves and return the best one
   */
  public evaluateMoves(gameState: GameState): Direction {
    const startTime = Date.now();
    
    // Get our valid moves
    const ourValidMoves = this.getValidMoves(gameState.you, gameState);
    if (ourValidMoves.length === 0) {
      console.log('No valid moves available, defaulting to up');
      return 'up';
    }
    
    if (ourValidMoves.length === 1) {
      console.log(`Only one valid move: ${ourValidMoves[0]}`);
      return ourValidMoves[0];
    }
    
    // Enumerate all possible move sets
    const moveSets = this.moveEnumerator.enumerateMoveSets(gameState, startTime);
    console.log(`Enumerated ${moveSets.length} move sets`);
    
    // Evaluate each of our moves
    const moveEvaluations = new Map<Direction, MoveEvaluation>();
    
    for (const ourMove of ourValidMoves) {
      const scores: number[] = [];
      
      // Filter move sets that start with our move
      const relevantMoveSets = moveSets.filter(moveSet => 
        moveSet.get(gameState.you.id) === ourMove
      );
      
      // Early abort if this move leads to immediate death
      if (relevantMoveSets.length === 0) {
        console.log(`Move ${ourMove} has no valid scenarios`);
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
          console.log('Time budget exceeded during evaluation');
          break;
        }
        
        // Simulate the next board state
        const simulatedState = this.simulator.simulateNextBoardState(gameState, moveSet);
        
        // Skip if we died in this simulation
        if (simulatedState.deadSnakeIds.has(gameState.you.id)) {
          scores.push(-Infinity);
          continue;
        }
        
        // Calculate metrics for the simulated state
        const aliveSnakes = simulatedState.board.snakes.filter(s => 
          !simulatedState.deadSnakeIds.has(s.id)
        );
        const metrics = this.bfsMetrics.computeMetrics(simulatedState.board, aliveSnakes);
        
        // Calculate score
        const score = this.scorer.calculateScore(metrics, gameState, gameState.you.id, aliveSnakes);
        scores.push(score);
      }
      
      // Calculate average score for this move
      const validScores = scores.filter(s => s !== -Infinity);
      const averageScore = validScores.length > 0 ?
        validScores.reduce((a, b) => a + b, 0) / validScores.length :
        -Infinity;
      
      moveEvaluations.set(ourMove, {
        move: ourMove,
        averageScore,
        numStates: scores.length
      });
      
      console.log(`Move ${ourMove}: avg score ${averageScore.toFixed(2)} from ${scores.length} states`);
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
    
    const timeTaken = Date.now() - startTime;
    console.log(`Selected move ${bestMove} with score ${bestScore.toFixed(2)} in ${timeTaken}ms`);
    
    return bestMove;
  }

  /**
   * Get valid moves for a snake (non-death moves)
   */
  private getValidMoves(snake: any, gameState: GameState): Direction[] {
    const validMoves: Direction[] = [];
    const head = snake.head;
    
    const moves: { dir: Direction, coord: any }[] = [
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

  private isSafeMove(coord: any, snake: any, gameState: GameState): boolean {
    // Check bounds
    if (coord.x < 0 || coord.x >= gameState.board.width ||
        coord.y < 0 || coord.y >= gameState.board.height) {
      return false;
    }
    
    // Check collision with snake bodies
    for (const otherSnake of gameState.board.snakes) {
      if (otherSnake.health <= 0) continue;
      
      for (let i = 0; i < otherSnake.body.length; i++) {
        const segment = otherSnake.body[i];
        
        // Allow moving into own tail if not eating
        if (otherSnake.id === snake.id && i === otherSnake.body.length - 1) {
          // Check if snake will eat at its NEW position
          const onFood = gameState.board.food.some(f => 
            f.x === coord.x && f.y === coord.y
          );
          if (!onFood) continue;
        }
        
        if (segment.x === coord.x && segment.y === coord.y) {
          return false;
        }
      }
    }
    
    return true;
  }
}