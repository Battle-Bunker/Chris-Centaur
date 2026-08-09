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
import { BoardEvaluator, BoardEvaluation, WaypointContext } from './board-evaluator';
import { Simulator } from './simulator';
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
  tailGrowthTiming?: 'grow-same-turn' | 'grow-next-turn';
  h2hRisk: { enemyH2HRisk: number; allyH2HRisk: number };
  waypoint: WaypointContext | null;
}

export interface ChunkResult {
  ourMove: Direction;
  statesEvaluated: number;
  worstScore: number;
  /** Full evaluation of the worst state (territoryCells stripped for transfer). */
  worstEvaluation: BoardEvaluation | null;
}

export function evaluateChunk(job: ChunkJob): ChunkResult {
  const { gameState } = job;
  const teamSet = new Set(job.teamSnakeIds);
  const simulatedSet = new Set(job.simulatedSnakeIds);
  const evaluator = new BoardEvaluator(job.weights, { tailGrowthTiming: job.tailGrowthTiming });
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
      simulatedSnakeIds: simulatedSet,
      waypoint: job.waypoint ?? undefined,
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

  // Strip the per-state territory cell lists — they're only used for UI on
  // the finally-chosen evaluation and are recomputed there; shipping them
  // back for every chunk would dominate transfer cost.
  if (worstEvaluation) {
    worstEvaluation = { ...worstEvaluation, territoryCells: new Map() };
  }

  return {
    ourMove: job.ourMove,
    statesEvaluated,
    worstScore: statesEvaluated > 0 ? worstScore : Infinity,
    worstEvaluation,
  };
}
