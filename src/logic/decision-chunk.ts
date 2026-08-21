/**
 * The parallelizable unit of decision work: simulate + evaluate a batch of
 * board states for ONE candidate move of ONE snake. Pure function of its
 * inputs (no per-game state), so it runs identically on a worker thread or
 * inline on the main thread — the worker entry (decision-worker.ts) and the
 * pool's inline fallback both call evaluateChunk.
 *
 * Results carry MINIMAX aggregates: the WORST evaluated state (by overall
 * weighted score) conditional on making the move. The engine takes the min
 * across chunks, so a candidate move is scored by the worst world an
 * opponent/ally move combination can force after it.
 */

import { GameState, Direction } from '../types/battlesnake';
import { BoardEvaluator, BoardEvaluation } from './board-evaluator';
import { WaypointProgress } from './waypoint-pathing';
import { Simulator } from './simulator';
import { CasualtyContext } from './turn-oracle';
import { DecisionConfig } from './decision-engine';

export interface ChunkJob {
  gameState: GameState;                     // per-snake view (you = the deciding snake)
  teamSnakeIds: string[];
  ourMove: Direction;
  /** Move combinations for the simulated nearby snakes (excluding us). */
  moveSets: [string, Direction][][];
  /** Ids treated as simulated (us + nearby) — evaluation startDelay handling. */
  simulatedSnakeIds: string[];
  weights?: DecisionConfig['weights'];
  h2hRisk: { enemyH2HRisk: number; allyH2HRisk: number };
  /**
   * Piece-threat flags for THIS chunk's candidate move, computed once per
   * decision on the main thread from the pre-move board (same per-move
   * constant contract as h2hRisk). Plain object — structured-clones into
   * worker threads for free. Optional so piece-free callers pay nothing.
   */
  pieceThreat?: { enemyPieceThreat: number; allyPieceThreat: number };
  /**
   * The goto/near progress stats for THIS chunk's candidate move, computed on
   * the main thread from the pre-move board. A per-move constant (the stat
   * describes the move, not the simulated board), so it is injected unchanged
   * into every state this chunk evaluates.
   */
  waypointProgress: WaypointProgress | null;
  /**
   * Projected health cost of THIS chunk's candidate move (movement + hazard
   * damage — turn-oracle.ts's projectedHealthCost), computed once per decision
   * on the main thread from the pre-move board. Same per-move-constant
   * contract as h2hRisk/pieceThreat/waypointProgress. Optional so callers
   * that construct a ChunkJob directly (tests) default to no cost.
   */
  healthCost?: number;
  /**
   * What THIS chunk's candidate move does to the units on the board — ally
   * weight destroyed, enemies killed, and the regicide flags, read off a
   * resolved turn (turn-oracle.ts). Plain numbers, so it structured-clones into worker
   * threads for free. Same per-move-constant contract as healthCost; optional
   * so callers that construct a ChunkJob directly (tests) default to none.
   */
  casualties?: CasualtyContext;
}

export interface ChunkResult {
  ourMove: Direction;
  statesEvaluated: number;
  worstScore: number;
  /** Full evaluation of the worst state. */
  worstEvaluation: BoardEvaluation | null;
}

export function evaluateChunk(job: ChunkJob): ChunkResult {
  const { gameState } = job;
  const teamSet = new Set(job.teamSnakeIds);
  const simulatedSet = new Set(job.simulatedSnakeIds);
  const evaluator = new BoardEvaluator(job.weights);
  const simulator = new Simulator();

  // Current board food is "previous" food from a simulated state's perspective.
  const currentFoodSet = new Set<string>();
  for (const food of gameState.board.food) {
    currentFoodSet.add(`${food.x},${food.y}`);
  }

  let worstScore = Infinity;
  let worstEvaluation: BoardEvaluation | null = null;
  let statesEvaluated = 0;

  for (const moveSetEntries of job.moveSets) {
    const fullMoveSet = new Map<string, Direction>();
    fullMoveSet.set(gameState.you.id, job.ourMove);
    for (const [snakeId, move] of moveSetEntries) {
      fullMoveSet.set(snakeId, move);
    }

    const simulated = simulator.simulateNextBoardState(gameState, fullMoveSet, teamSet);
    const nextGameState: GameState = {
      game: gameState.game,
      turn: gameState.turn + 1,
      board: simulated.board,
      you: simulated.board.snakes.find(s => s.id === gameState.you.id) || gameState.you,
    };

    const evaluation = evaluator.evaluateBoard(nextGameState, gameState.you.id, teamSet, {
      prevFoodSet: currentFoodSet,
      h2hRisk: job.h2hRisk,
      pieceThreat: job.pieceThreat,
      simulatedSnakeIds: simulatedSet,
      waypointProgress: job.waypointProgress ?? null,
      healthCost: job.healthCost ?? 0,
      casualties: job.casualties,
      // Chunk evaluations feed only the minimax score aggregation — per-state
      // territory cell lists are never shipped back (see the strip below), so
      // don't build them at all.
      collectTerritory: false,
    });
    statesEvaluated++;
    if (evaluation.score < worstScore) {
      worstScore = evaluation.score;
      worstEvaluation = evaluation;
    }
  }

  return {
    ourMove: job.ourMove,
    statesEvaluated,
    worstScore: statesEvaluated > 0 ? worstScore : Infinity,
    worstEvaluation,
  };
}
