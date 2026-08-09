/**
 * Decision engine that orchestrates the principled architecture for move selection.
 * Uses MoveAnalyzer for move enumeration and BoardEvaluator for scoring.
 */

import { GameState, Snake, Direction, Coord } from '../types/battlesnake';
import { MoveAnalyzer, MoveAnalysis, H2HRiskInfo } from './move-analyzer';
import { BoardEvaluator, BoardEvaluation, EvaluationContext, WaypointContext } from './board-evaluator';
import { Simulator } from './simulator';
import { BoardGraph } from './board-graph';
import { MultiSourceBFS, BFSSource } from './multi-source-bfs';
import { ChunkJob, ChunkResult } from './decision-chunk';
import { DecisionWorkerPool } from './decision-worker-pool';
import { recordDecisionTelemetry } from './decision-telemetry';

export interface MoveDecision {
  move: Direction;
  candidateMoves: Direction[];  // The actual moves we evaluated (all non-lethal moves)
  evaluations: MoveEvaluationResult[];
  h2hRiskByMove: Map<Direction, H2HRiskInfo>;  // H2H risk info for each move
}

export interface MoveEvaluationResult {
  move: Direction;
  averageScore: number;
  numStates: number;
  averageBreakdown: BoardEvaluation;
  projectedTerritoryCells?: { [snakeId: string]: { x: number; y: number }[] };
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
    // Head-to-head risk weights
    enemyH2HRisk?: number;
    allyH2HRisk?: number;
    // Waypoint weights
    waypointGoto?: number;
    waypointNear?: number;
  };
}

export class DecisionEngine {
  private moveAnalyzer: MoveAnalyzer;
  private boardEvaluator: BoardEvaluator;
  private simulator: Simulator;
  private config: DecisionConfig;
  private lastFoodSetByGameId: Map<string, Set<string>> = new Map();
  private static readonly MAX_FOOD_SET_ENTRIES = 20;
  
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
   * Now considers all non-lethal moves (safe + risky) and applies h2h risk penalties.
   */
  public decide(gameState: GameState, teamSnakeIds: Set<string>, waypoint?: WaypointContext | null): MoveDecision {
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
    
    // Get move analysis with h2h risk details
    const moveAnalysis = this.moveAnalyzer.analyzeMoves(gameState.you, gameState, graph, teamSnakeIds);
    
    // Consider ALL non-lethal moves (safe + risky) - h2h risk is now a weighted penalty
    let ourMoves = [...moveAnalysis.safe, ...moveAnalysis.risky];
    
    // Deterministic ally-collision veto: a head-to-head with a teammate is only
    // ever something to avoid, never to pursue. If any candidate move does NOT
    // collide head-on with an ally, drop every ally-colliding candidate before
    // scoring so the bot can never choose to walk into a teammate's head when an
    // alternative exists. Enemy head-to-head behaviour is untouched.
    const nonAllyMoves = ourMoves.filter(
      move => !(moveAnalysis.h2hRiskByMove.get(move)?.hasAllyRisk ?? false)
    );
    if (nonAllyMoves.length > 0) {
      ourMoves = nonAllyMoves;
    }
    
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
      const evaluation = this.boardEvaluator.evaluateBoard(
        gameState, 
        gameState.you.id, 
        teamSnakeIds,
        { 
          prevFoodSet,
          h2hRisk: {
            enemyH2HRisk: h2hRisk?.hasEnemyRisk ? 1 : 0,
            allyH2HRisk: h2hRisk?.hasAllyRisk ? 1 : 0
          },
          waypoint
        }
      );
      
      // Compute projected territory for the single move
      const singleMovePos = this.getMovePosition(gameState.you.head, ourMoves[0]);
      const singleProjSources: BFSSource[] = [{
        id: gameState.you.id,
        position: singleMovePos,
        isTeam: true,
        startDelay: 1
      }];
      for (const snake of gameState.board.snakes) {
        if (snake.id === gameState.you.id || snake.health <= 0) continue;
        singleProjSources.push({
          id: snake.id,
          position: snake.head,
          isTeam: teamSnakeIds.has(snake.id),
          startDelay: 0
        });
      }
      const singleProjBfs = new MultiSourceBFS(graph);
      const singleProjResult = singleProjBfs.compute(singleProjSources, gameState.board.food, undefined, gameState.board.fertileTiles);
      const singleProjTerritory: { [snakeId: string]: { x: number; y: number }[] } = {};
      for (const [snakeId, cells] of singleProjResult.territoryCells) {
        singleProjTerritory[snakeId] = cells;
      }
      
      // Update food set for next turn
      this.setLastFoodSet(gameId, currentFoodSet);
      
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

    // Evaluate simulated states ROUND-ROBIN across candidate moves under a
    // hard time budget. Evaluation (a multi-source BFS per state) is the
    // expensive phase; interleaving means a budget cut leaves every move
    // with a comparable sample instead of fully scoring the first move and
    // starving the rest. The i=0 pass always runs so every move with states
    // gets at least one evaluation.
    const h2hCtxByMove = new Map<Direction, { enemyH2HRisk: number; allyH2HRisk: number }>();
    const statesByMove = new Map<Direction, typeof boardStates>();
    const evaluatedByMove = new Map<Direction, BoardEvaluation[]>();
    let maxStatesForAnyMove = 0;
    for (const move of ourMoves) {
      const h2hRisk = moveAnalysis.h2hRiskByMove.get(move);
      h2hCtxByMove.set(move, {
        enemyH2HRisk: h2hRisk?.hasEnemyRisk ? 1 : 0,
        allyH2HRisk: h2hRisk?.hasAllyRisk ? 1 : 0
      });
      const states = boardStates.filter(state => state.ourMove === move);
      statesByMove.set(move, states);
      evaluatedByMove.set(move, []);
      maxStatesForAnyMove = Math.max(maxStatesForAnyMove, states.length);
    }

    const evalDeadline = startTime + this.config.timeoutMs * 2;
    outer:
    for (let i = 0; i < maxStatesForAnyMove; i++) {
      for (const move of ourMoves) {
        const states = statesByMove.get(move)!;
        if (i >= states.length) continue;
        if (i > 0 && Date.now() > evalDeadline) break outer;
        const state = states[i];
        const evaluation = this.boardEvaluator.evaluateBoard(
          state.gameState,
          gameState.you.id,
          teamSnakeIds,
          {
            prevFoodSet: currentFoodSet,  // Current food is "previous" from simulated state's perspective
            h2hRisk: h2hCtxByMove.get(move)!,
            simulatedSnakeIds: state.simulatedSnakeIds,  // Snakes that were simulated get startDelay: 1
            waypoint
          }
        );
        evaluatedByMove.get(move)!.push(evaluation);
      }
    }

    // MINIMAX aggregation: a candidate move is scored by the WORST evaluated
    // state (overall weighted score) conditional on making it — the bot plays
    // conservatively against the worst world its neighbours can force. The
    // MoveEvaluationResult field names are kept for wire/UI compatibility:
    // `averageScore` carries the worst-case score, `averageBreakdown` the
    // worst state's full evaluation.
    const evaluations: MoveEvaluationResult[] = [];
    for (const move of ourMoves) {
      const allEvaluations = evaluatedByMove.get(move)!;
      if (allEvaluations.length === 0) {
        // No simulated states for this move — score the current board.
        evaluations.push({
          move,
          averageScore: -1000,
          numStates: 0,
          averageBreakdown: this.boardEvaluator.evaluateBoard(
            gameState,
            gameState.you.id,
            teamSnakeIds,
            { prevFoodSet, h2hRisk: h2hCtxByMove.get(move)!, waypoint }
          )
        });
        continue;
      }

      let worst = allEvaluations[0];
      for (const evaluation of allEvaluations) {
        if (evaluation.score < worst.score) worst = evaluation;
      }
      evaluations.push({
        move,
        averageScore: worst.score,
        numStates: allEvaluations.length,
        averageBreakdown: worst
      });
    }

    const bestMove = DecisionEngine.selectBestMove(evaluations);
    this.computeProjectedTerritories(gameState, graph, teamSnakeIds, evaluations);

    // Update food set for next turn (with LRU cap to avoid unbounded growth)
    this.setLastFoodSet(gameId, currentFoodSet);

    return {
      move: bestMove,
      candidateMoves: ourMoves,
      evaluations,
      h2hRiskByMove: moveAnalysis.h2hRiskByMove
    };
  }

  // Select the best move with a candidate-level fatal-pocket veto.
  // A move whose worst-case `trapped` signal is at/above the fatal threshold
  // leads into a clearly-fatal dead-end pocket (no tail-chase, not enough room
  // to outlast our length) in SOME reachable branch. We must never pick such a
  // move when a non-fatal alternative exists — even if it happens to score
  // higher (e.g. a waypoint sitting inside the pocket). This is the hard
  // guarantee on top of the strongly-negative `trapped` weight. If EVERY
  // candidate is fatal, we fall back to scoring among all of them (least-bad
  // death).
  private static selectBestMove(evaluations: MoveEvaluationResult[]): Direction {
    const FATAL_TRAP_THRESHOLD = 0.5;
    const nonFatal = evaluations.filter(e => e.averageBreakdown.stats.trapped < FATAL_TRAP_THRESHOLD);
    const selectionPool = nonFatal.length > 0 ? nonFatal : evaluations;

    let bestMove = selectionPool[0].move;
    let bestScore = -Infinity;
    for (const evalResult of selectionPool) {
      if (evalResult.averageScore > bestScore) {
        bestScore = evalResult.averageScore;
        bestMove = evalResult.move;
      }
    }
    return bestMove;
  }

  // Compute projected territory per candidate move (asymmetric BFS) for the
  // UI overlays.
  private computeProjectedTerritories(
    gameState: GameState,
    graph: BoardGraph,
    teamSnakeIds: Set<string>,
    evaluations: MoveEvaluationResult[]
  ): void {
    for (const evalResult of evaluations) {
      const candidatePos = this.getMovePosition(gameState.you.head, evalResult.move);
      if (!candidatePos) continue;

      const projSources: BFSSource[] = [];
      projSources.push({
        id: gameState.you.id,
        position: candidatePos,
        isTeam: true,
        startDelay: 1
      });

      for (const snake of gameState.board.snakes) {
        if (snake.id === gameState.you.id || snake.health <= 0) continue;
        projSources.push({
          id: snake.id,
          position: snake.head,
          isTeam: teamSnakeIds.has(snake.id),
          startDelay: 0
        });
      }

      const projBfs = new MultiSourceBFS(graph);
      const projResult = projBfs.compute(projSources, gameState.board.food, undefined, gameState.board.fertileTiles);

      const projTerritoryCells: { [snakeId: string]: { x: number; y: number }[] } = {};
      for (const [snakeId, cells] of projResult.territoryCells) {
        projTerritoryCells[snakeId] = cells;
      }
      evalResult.projectedTerritoryCells = projTerritoryCells;
    }
  }
  
  /**
   * Anytime, parallel variant of decide(). Enumerates the FULL 3^k cartesian
   * product of nearby-snake move combinations for every candidate move, splits
   * it into chunks, and evaluates them on the shared worker pool. Emits an
   * updated best-guess MoveDecision via onUpdate every updateIntervalMs
   * (default 100ms) and finalizes when either every chunk has completed or
   * deadlineMs (absolute epoch ms) is reached — whichever comes first.
   * Aggregation is minimax: each candidate move is scored by the worst
   * evaluated state found so far conditional on making it.
   */
  public async decideIteratively(
    gameState: GameState,
    teamSnakeIds: Set<string>,
    options: {
      waypoint?: WaypointContext | null;
      deadlineMs: number;
      updateIntervalMs?: number;
      pool?: DecisionWorkerPool;
      onUpdate?: (decision: MoveDecision) => void;
    }
  ): Promise<MoveDecision> {
    const { waypoint = null, deadlineMs, updateIntervalMs = 100, onUpdate } = options;
    const pool = options.pool ?? DecisionWorkerPool.getShared();
    const gameId = gameState.game.id;
    const startTime = Date.now();

    const prevFoodSet = this.lastFoodSetByGameId.get(gameId);
    const currentFoodSet = new Set<string>();
    for (const food of gameState.board.food) {
      currentFoodSet.add(`${food.x},${food.y}`);
    }

    const graph = new BoardGraph(gameState, { tailGrowthTiming: this.config.tailGrowthTiming });
    const moveAnalysis = this.moveAnalyzer.analyzeMoves(gameState.you, gameState, graph, teamSnakeIds);

    let ourMoves = [...moveAnalysis.safe, ...moveAnalysis.risky];
    const nonAllyMoves = ourMoves.filter(
      move => !(moveAnalysis.h2hRiskByMove.get(move)?.hasAllyRisk ?? false)
    );
    if (nonAllyMoves.length > 0) {
      ourMoves = nonAllyMoves;
    }

    // 0 or 1 candidate moves: no simulation fan-out to parallelize — the
    // synchronous path already handles these fully (including territory).
    if (ourMoves.length <= 1) {
      const decision = this.decide(gameState, teamSnakeIds, waypoint);
      onUpdate?.(decision);
      recordDecisionTelemetry({
        ts: Date.now(),
        gameId,
        snakeId: gameState.you.id,
        boardTurn: gameState.turn,
        mode: 'trivial',
        candidateMoves: ourMoves.length,
        nearbySnakes: 0,
        moveSetsPerMove: 0,
        plannedStates: decision.evaluations.reduce((n, e) => n + e.numStates, 0),
        statesEvaluated: decision.evaluations.reduce((n, e) => n + e.numStates, 0),
        chunksTotal: 0,
        chunksCompleted: 0,
        durationMs: Date.now() - startTime,
        deadlineHit: false,
        updatesEmitted: 0,
        poolSize: pool.size,
        poolInline: pool.isInline
      });
      return decision;
    }

    // Nearby snakes within focal distance — NO count cap; board geometry
    // bounds how many heads fit within nearbyDistance.
    const nearbySnakes: Snake[] = [];
    for (const snake of gameState.board.snakes) {
      if (snake.id === gameState.you.id || snake.health <= 0) continue;
      if (this.manhattanDistance(gameState.you.head, snake.head) <= this.config.nearbyDistance) {
        nearbySnakes.push(snake);
      }
    }
    const simulatedSnakeIds = [gameState.you.id, ...nearbySnakes.map(s => s.id)];

    // Full 3^k move combinations for the nearby snakes (independent of our move),
    // as plain arrays so they survive the structured-clone to worker threads.
    const nearbyMoveSets = this.generateNearbyMoveSets(nearbySnakes, gameState, graph)
      .map(moveSet => Array.from(moveSet.entries()) as [string, Direction][]);

    const h2hCtxByMove = new Map<Direction, { enemyH2HRisk: number; allyH2HRisk: number }>();
    for (const move of ourMoves) {
      const h2hRisk = moveAnalysis.h2hRiskByMove.get(move);
      h2hCtxByMove.set(move, {
        enemyH2HRisk: h2hRisk?.hasEnemyRisk ? 1 : 0,
        allyH2HRisk: h2hRisk?.hasAllyRisk ? 1 : 0
      });
    }

    // Chunk the combination space per candidate move, then interleave chunks
    // ROUND-ROBIN across moves so partial results cover every move instead of
    // fully scoring the first move while starving the rest.
    // Sized so per-chunk worker-message overhead (a gameState clone per job)
    // stays small relative to evaluation: ~0.14ms/state after the typed-array
    // core, so 32 states ≈ 4.5ms per chunk — still fine-grained against the
    // 100ms update cadence and the turn deadline.
    const CHUNK_STATES = 32;
    const chunksByMove = new Map<Direction, ChunkJob[]>();
    for (const move of ourMoves) {
      const chunks: ChunkJob[] = [];
      for (let i = 0; i < nearbyMoveSets.length; i += CHUNK_STATES) {
        chunks.push({
          gameState,
          teamSnakeIds: Array.from(teamSnakeIds),
          ourMove: move,
          moveSets: nearbyMoveSets.slice(i, i + CHUNK_STATES),
          simulatedSnakeIds,
          weights: this.config.weights,
          tailGrowthTiming: this.config.tailGrowthTiming,
          h2hRisk: h2hCtxByMove.get(move)!,
          waypoint
        });
      }
      chunksByMove.set(move, chunks);
    }
    const jobQueue: ChunkJob[] = [];
    const maxChunksPerMove = Math.max(...ourMoves.map(m => chunksByMove.get(m)!.length));
    for (let i = 0; i < maxChunksPerMove; i++) {
      for (const move of ourMoves) {
        const chunks = chunksByMove.get(move)!;
        if (i < chunks.length) jobQueue.push(chunks[i]);
      }
    }
    const totalChunks = jobQueue.length;

    // Minimax accumulators per move.
    const worstByMove = new Map<Direction, { score: number; evaluation: BoardEvaluation | null; states: number }>();
    for (const move of ourMoves) {
      worstByMove.set(move, { score: Infinity, evaluation: null, states: 0 });
    }

    // Fallback current-board evaluations for moves with no completed chunks yet
    // (also decide()'s convention for zero-state moves: score -1000).
    const fallbackEvalByMove = new Map<Direction, BoardEvaluation>();
    const getFallbackEval = (move: Direction): BoardEvaluation => {
      let cached = fallbackEvalByMove.get(move);
      if (!cached) {
        cached = this.boardEvaluator.evaluateBoard(
          gameState,
          gameState.you.id,
          teamSnakeIds,
          { prevFoodSet, h2hRisk: h2hCtxByMove.get(move)!, waypoint }
        );
        fallbackEvalByMove.set(move, cached);
      }
      return cached;
    };

    const buildEvaluations = (): MoveEvaluationResult[] => {
      return ourMoves.map(move => {
        const acc = worstByMove.get(move)!;
        if (acc.states === 0 || !acc.evaluation) {
          return {
            move,
            averageScore: -1000,
            numStates: 0,
            averageBreakdown: getFallbackEval(move)
          };
        }
        return {
          move,
          averageScore: acc.score,
          numStates: acc.states,
          averageBreakdown: acc.evaluation
        };
      });
    };

    const buildDecision = (): MoveDecision => {
      const evaluations = buildEvaluations();
      return {
        move: DecisionEngine.selectBestMove(evaluations),
        candidateMoves: ourMoves,
        evaluations,
        h2hRiskByMove: moveAnalysis.h2hRiskByMove
      };
    };

    return new Promise<MoveDecision>((resolve) => {
      let done = false;
      let completedChunks = 0;
      let updatesEmitted = 0;
      // Per-decision in-flight cap so several concurrent snake decisions
      // interleave on the shared pool instead of the first submitter's chunks
      // monopolizing the FIFO queue.
      const IN_FLIGHT_CAP = 4;
      let inFlight = 0;
      let updateTimer: ReturnType<typeof setInterval> | null = null;
      let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

      const finalize = () => {
        if (done) return;
        done = true;
        if (updateTimer) clearInterval(updateTimer);
        if (deadlineTimer) clearTimeout(deadlineTimer);
        const decision = buildDecision();
        this.computeProjectedTerritories(gameState, graph, teamSnakeIds, decision.evaluations);
        this.setLastFoodSet(gameId, currentFoodSet);
        onUpdate?.(decision);
        recordDecisionTelemetry({
          ts: Date.now(),
          gameId,
          snakeId: gameState.you.id,
          boardTurn: gameState.turn,
          mode: 'iterative',
          candidateMoves: ourMoves.length,
          nearbySnakes: nearbySnakes.length,
          moveSetsPerMove: nearbyMoveSets.length,
          plannedStates: ourMoves.length * nearbyMoveSets.length,
          statesEvaluated: ourMoves.reduce((n, m) => n + worstByMove.get(m)!.states, 0),
          chunksTotal: totalChunks,
          chunksCompleted: completedChunks,
          durationMs: Date.now() - startTime,
          deadlineHit: completedChunks < totalChunks,
          updatesEmitted,
          poolSize: pool.size,
          poolInline: pool.isInline
        });
        resolve(decision);
      };

      const pump = () => {
        while (!done && inFlight < IN_FLIGHT_CAP && jobQueue.length > 0) {
          const job = jobQueue.shift()!;
          inFlight++;
          pool.submit(job).then(
            (result: ChunkResult) => {
              inFlight--;
              completedChunks++;
              if (!done) {
                const acc = worstByMove.get(result.ourMove);
                if (acc && result.statesEvaluated > 0) {
                  acc.states += result.statesEvaluated;
                  if (result.worstScore < acc.score || !acc.evaluation) {
                    acc.score = result.worstScore;
                    acc.evaluation = result.worstEvaluation;
                  }
                }
              }
              if (completedChunks >= totalChunks) {
                finalize();
              } else {
                pump();
              }
            },
            (err: Error) => {
              inFlight--;
              completedChunks++;
              console.error('[DecisionEngine] chunk evaluation failed:', err.message);
              if (completedChunks >= totalChunks) {
                finalize();
              } else {
                pump();
              }
            }
          );
        }
      };

      updateTimer = setInterval(() => {
        if (done) return;
        updatesEmitted++;
        onUpdate?.(buildDecision());
      }, updateIntervalMs);
      // Timers must not keep the process alive on their own.
      updateTimer.unref?.();

      const remaining = Math.max(0, deadlineMs - Date.now());
      deadlineTimer = setTimeout(finalize, remaining);
      deadlineTimer.unref?.();

      pump();
    });
  }

  /**
   * Called when a game ends. Releases per-game state so it doesn't leak.
   */
  public onGameEnd(gameId: string): void {
    this.lastFoodSetByGameId.delete(gameId);
  }

  /**
   * Set the last-food-set for a game, capping the map to MAX_FOOD_SET_ENTRIES
   * via LRU eviction (oldest insertion key first). Belt-and-suspenders against
   * the case where /end never arrives for some game.
   */
  private setLastFoodSet(gameId: string, foodSet: Set<string>): void {
    // Re-insert to refresh insertion order for LRU.
    if (this.lastFoodSetByGameId.has(gameId)) {
      this.lastFoodSetByGameId.delete(gameId);
    }
    this.lastFoodSetByGameId.set(gameId, foodSet);
    while (this.lastFoodSetByGameId.size > DecisionEngine.MAX_FOOD_SET_ENTRIES) {
      const oldest = this.lastFoodSetByGameId.keys().next().value;
      if (oldest === undefined) break;
      this.lastFoodSetByGameId.delete(oldest);
    }
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
  ): { ourMove: Direction; gameState: GameState; simulatedSnakeIds: Set<string> }[] {
    
    const results: { ourMove: Direction; gameState: GameState; simulatedSnakeIds: Set<string> }[] = [];
    const { board } = gameState;
    
    // Identify nearby snakes within focal distance for full move enumeration
    // Distant snakes (outside nearbyDistance) are frozen and not simulated.
    // Board geometry keeps this small: heads can't pack densely within focal
    // distance, so the 3^k cartesian product stays tractable and the time
    // budgets below are the only compute governors.
    const nearbySnakes: Snake[] = [];

    for (const snake of board.snakes) {
      if (snake.id === gameState.you.id || snake.health <= 0) continue;

      const distance = this.manhattanDistance(gameState.you.head, snake.head);
      if (distance <= this.config.nearbyDistance) {
        nearbySnakes.push(snake);
      }
      // Snakes beyond nearbyDistance are frozen (not included in simulation)
    }

    // Build the set of simulated snake IDs (our snake + nearby snakes)
    const simulatedSnakeIds = new Set<string>([gameState.you.id]);
    for (const snake of nearbySnakes) {
      simulatedSnakeIds.add(snake.id);
    }

    // Nearby-snake move combinations don't depend on our move — generate once.
    const nearbyMoveSets = this.generateNearbyMoveSets(nearbySnakes, gameState, graph);

    // For each of our moves
    for (const ourMove of ourMoves) {
      // Check time budget
      if (Date.now() - startTime > this.config.timeoutMs) {
        break;
      }

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
        const simulatedBoard = this.simulator.simulateNextBoardState(gameState, fullMoveSet, teamSnakeIds);
        
        // Construct new GameState from simulated board
        const nextGameState: GameState = {
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
  
  private getMovePosition(head: Coord, direction: Direction): Coord {
    switch (direction) {
      case 'up': return { x: head.x, y: head.y + 1 };
      case 'down': return { x: head.x, y: head.y - 1 };
      case 'left': return { x: head.x - 1, y: head.y };
      case 'right': return { x: head.x + 1, y: head.y };
    }
  }
}