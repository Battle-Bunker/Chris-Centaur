/**
 * Decision engine that orchestrates the principled architecture for move selection.
 * Uses MoveAnalyzer for move enumeration and BoardEvaluator for scoring.
 */

import { GameState, Snake, Direction, Coord } from '../types/battlesnake';
import { MoveAnalyzer, H2HRiskInfo, PieceThreatInfo } from './move-analyzer';
import { BoardEvaluator, BoardEvaluation, HeuristicWeights } from './board-evaluator';
import { BoardGraph } from './board-graph';
import { MultiSourceBFS, BFSSource, CellOwnership, territoryCellsToObject, toCellOwnership } from './multi-source-bfs';
import { unitContestData } from './piece-threats';
import { ChunkJob, ChunkResult, evaluateChunk } from './decision-chunk';
import { DecisionWorkerPool } from './decision-worker-pool';
import { recordDecisionTelemetry } from './decision-telemetry';
import { WaypointContext, computeWaypointProgressByMove } from './waypoint-pathing';
import { transientInterval, transientTimeout } from '../server/activity-controller';
import { projectedHealthCost } from './simulator';

// Re-exported for consumers that take a waypoint alongside a DecisionConfig.
export { WaypointContext } from './waypoint-pathing';

export interface MoveDecision {
  move: Direction;
  candidateMoves: Direction[];  // The actual moves we evaluated (all non-lethal moves)
  evaluations: MoveEvaluationResult[];
  h2hRiskByMove: Map<Direction, H2HRiskInfo>;  // H2H risk info for each move
  // The turn's board graph (subject-agnostic, built once per decision).
  // Consumers needing board-level queries (e.g. the strategy's UI Voronoi)
  // reuse this instead of rebuilding — one graph per decision, one config.
  graph: BoardGraph;
}

export interface MoveEvaluationResult {
  move: Direction;
  worstScore: number;
  numStates: number;
  worstEvaluation: BoardEvaluation;
  // The candidate's destination cell (api coords). Attached where the
  // projection BFS already computes it; optional so evaluation rows that skip
  // the projection pass (and legacy stored rows) stay valid. Generalizes the
  // row shape so destination-keyed candidates (chess pieces) and
  // direction-keyed candidates (snakes) share one contract.
  dest?: { x: number; y: number };
  projectedTerritoryCells?: { [snakeId: string]: { x: number; y: number }[] };
  // Per-cell owner/distance for the HYPOTHETICAL board where our head has
  // moved onto this candidate cell — the same projection BFS that produces
  // projectedTerritoryCells. Drives the UI cell inspector while a candidate
  // move is selected.
  projectedCellOwnership?: CellOwnership;
}

export interface DecisionConfig {
  timeoutMs: number;
  nearbyDistance: number;  // Focal distance: snakes within this Manhattan distance have all moves enumerated; snakes beyond are frozen
  // Heuristic weight overrides, forwarded to the BoardEvaluator (and into
  // worker chunk jobs). Registry-derived, so this can never silently miss
  // keys the runtime supplies — the old hand-listed shape was ~8 keys short
  // and only typechecked via excess-property-check evasion.
  weights?: Partial<HeuristicWeights>;
}

// The candidate-level fatal-pocket veto threshold: a move whose worst-case
// `trapped` signal is at/above this leads into a clearly-fatal dead-end pocket
// in some reachable branch and must never be picked while a non-fatal
// alternative exists.
export const FATAL_TRAP_THRESHOLD = 0.5;

/**
 * The single move-selection rule, shared by the decision engine and the
 * server's waypoint re-bias (ActiveGameManager): apply the fatal-pocket veto
 * (drop candidates with trapped >= threshold unless ALL are fatal), then take
 * the highest score. Returns null for an empty candidate list.
 *
 * Exported because staging re-scores this turn's evaluations when the goto/near
 * target moves mid-turn; a second copy of the rule would drift from the engine
 * and the staged move would stop matching what the bot would actually pick.
 */
export function pickBestMove(
  candidates: Array<{ move: Direction; score: number; trapped: number }>
): Direction | null {
  if (candidates.length === 0) return null;
  const nonFatal = candidates.filter(c => c.trapped < FATAL_TRAP_THRESHOLD);
  const pool = nonFatal.length > 0 ? nonFatal : candidates;
  let best = pool[0];
  for (const c of pool) {
    if (c.score > best.score) best = c;
  }
  return best.move;
}

export class DecisionEngine {
  private moveAnalyzer: MoveAnalyzer;
  private boardEvaluator: BoardEvaluator;
  private config: DecisionConfig;

  constructor(config?: Partial<DecisionConfig>) {
    this.config = {
      timeoutMs: 400,
      nearbyDistance: 5,
      ...config
    };

    this.moveAnalyzer = new MoveAnalyzer();
    this.boardEvaluator = new BoardEvaluator(this.config.weights);
  }
  
  /**
   * Main decision method that selects the best move for our snake.
   * Now considers all non-lethal moves (safe + risky) and applies h2h risk penalties.
   *
   * Enumerates candidate worlds with the SAME generateNearbyMoveSets output
   * and evaluates them through the SAME evaluateChunk unit as
   * decideIteratively — inline on this thread, no worker pool. Kept as the
   * synchronous minimax parity oracle (decision-iterative.test.ts) and as the
   * trivial-fanout path decideIteratively delegates to.
   */
  public decide(gameState: GameState, teamSnakeIds: Set<string>, waypoint?: WaypointContext | null): MoveDecision {
    const startTime = Date.now();

    // Create BoardGraph once for this turn - single source of truth for passability
    const graph = new BoardGraph(gameState);

    // Get move analysis with h2h risk details
    const moveAnalysis = this.moveAnalyzer.analyzeMoves(gameState.you, gameState, graph, teamSnakeIds);

    // Per-move waypoint progress (centaur goto/near): computed ONCE here from the
    // pre-move board with the shared waypoint pathfinder, then injected into every
    // evaluation of that move. The optimal next move along a shortest path to the
    // target gets the maximum stat; the weight (config gotoProgress/nearProgress)
    // decides how strongly it pulls against the rest of the matrix.
    const waypointProgressByMove = computeWaypointProgressByMove(gameState, waypoint, { graph });

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
        h2hRiskByMove: new Map(),
        graph
      };
    }

    if (ourMoves.length === 1) {
      // Only one move available - still evaluate it properly
      const h2hRisk = moveAnalysis.h2hRiskByMove.get(ourMoves[0]);
      const pieceThreat = moveAnalysis.pieceThreatByMove.get(ourMoves[0]);
      const healthCost = this.healthCostContexts(gameState, ourMoves).get(ourMoves[0]);
      const evaluation = this.boardEvaluator.evaluateBoard(
        gameState,
        gameState.you.id,
        teamSnakeIds,
        {
          h2hRisk: {
            enemyH2HRisk: h2hRisk?.hasEnemyRisk ? 1 : 0,
            allyH2HRisk: h2hRisk?.hasAllyRisk ? 1 : 0
          },
          pieceThreat: {
            enemyPieceThreat: pieceThreat?.hasEnemyThreat ? 1 : 0,
            allyPieceThreat: pieceThreat?.hasAllyThreat ? 1 : 0
          },
          waypointProgress: waypointProgressByMove?.[ourMoves[0]] ?? null,
          healthCost
        }
      );

      // Projected territory/ownership via the shared per-candidate path.
      const evaluations: MoveEvaluationResult[] = [{
        move: ourMoves[0],
        worstScore: evaluation.score,
        numStates: 1,
        worstEvaluation: evaluation
      }];
      this.computeProjectedTerritories(gameState, graph, teamSnakeIds, evaluations);

      return {
        move: ourMoves[0],
        candidateMoves: ourMoves,
        evaluations,
        h2hRiskByMove: moveAnalysis.h2hRiskByMove,
        graph
      };
    }

    // Shared enumeration: the same nearby-snake selection and full 3^k move
    // combinations decideIteratively fans out to the pool.
    const { simulatedSnakeIds, nearbyMoveSets } = this.enumerateNearby(gameState, graph);
    const h2hCtxByMove = this.h2hContexts(ourMoves, moveAnalysis.h2hRiskByMove);
    const pieceThreatCtxByMove = this.pieceThreatContexts(ourMoves, moveAnalysis.pieceThreatByMove);
    const healthCostByMove = this.healthCostContexts(gameState, ourMoves);

    // Evaluate through the SAME evaluateChunk unit the workers run, inline,
    // in chunk-sized ROUND-ROBIN order across candidate moves under a hard
    // time budget: a budget cut leaves every move with a comparable sample
    // instead of fully scoring the first move and starving the rest. The
    // i=0 pass always runs so every move gets at least one chunk. Minimax
    // accumulation across chunks matches decideIteratively's: worst state
    // wins, first-seen on ties.
    const CHUNK_STATES = 32;
    const chunkCount = Math.ceil(nearbyMoveSets.length / CHUNK_STATES);
    const evalDeadline = startTime + this.config.timeoutMs * 2;
    const worstByMove = new Map<Direction, { score: number; evaluation: BoardEvaluation | null; states: number }>();
    for (const move of ourMoves) {
      worstByMove.set(move, { score: Infinity, evaluation: null, states: 0 });
    }

    outer:
    for (let i = 0; i < chunkCount; i++) {
      for (const move of ourMoves) {
        if (i > 0 && Date.now() > evalDeadline) break outer;
        const result = evaluateChunk({
          gameState,
          teamSnakeIds: Array.from(teamSnakeIds),
          ourMove: move,
          moveSets: nearbyMoveSets.slice(i * CHUNK_STATES, (i + 1) * CHUNK_STATES),
          simulatedSnakeIds,
          weights: this.config.weights,
          h2hRisk: h2hCtxByMove.get(move)!,
          pieceThreat: pieceThreatCtxByMove.get(move)!,
          waypointProgress: waypointProgressByMove?.[move] ?? null,
          healthCost: healthCostByMove.get(move)!
        });
        const acc = worstByMove.get(move)!;
        if (result.statesEvaluated > 0) {
          acc.states += result.statesEvaluated;
          if (result.worstScore < acc.score || !acc.evaluation) {
            acc.score = result.worstScore;
            acc.evaluation = result.worstEvaluation;
          }
        }
      }
    }

    const evaluations: MoveEvaluationResult[] = ourMoves.map(move => {
      const acc = worstByMove.get(move)!;
      if (acc.states === 0 || !acc.evaluation) {
        // No simulated states for this move — score the current board.
        return {
          move,
          worstScore: -1000,
          numStates: 0,
          worstEvaluation: this.boardEvaluator.evaluateBoard(
            gameState,
            gameState.you.id,
            teamSnakeIds,
            {
              h2hRisk: h2hCtxByMove.get(move)!,
              pieceThreat: pieceThreatCtxByMove.get(move)!,
              waypointProgress: waypointProgressByMove?.[move] ?? null,
              healthCost: healthCostByMove.get(move)!
            }
          )
        };
      }
      return {
        move,
        worstScore: acc.score,
        numStates: acc.states,
        worstEvaluation: acc.evaluation
      };
    });

    const bestMove = DecisionEngine.selectBestMove(evaluations);
    this.computeProjectedTerritories(gameState, graph, teamSnakeIds, evaluations);

    return {
      move: bestMove,
      candidateMoves: ourMoves,
      evaluations,
      h2hRiskByMove: moveAnalysis.h2hRiskByMove,
      graph
    };
  }

  /**
   * Shared candidate-world enumeration for both decision paths: the nearby
   * snakes within focal distance (NO count cap; board geometry bounds how
   * many heads fit within nearbyDistance), the simulated-snake id list, and
   * the full 3^k nearby move combinations as plain arrays (independent of our
   * move, and structured-clone-safe for worker threads).
   */
  private enumerateNearby(gameState: GameState, graph: BoardGraph): {
    nearbySnakes: Snake[];
    simulatedSnakeIds: string[];
    nearbyMoveSets: [string, Direction][][];
  } {
    const nearbySnakes: Snake[] = [];
    for (const snake of gameState.board.snakes) {
      if (snake.id === gameState.you.id || snake.health <= 0) continue;
      // Documented v1 approximation: chess pieces are treated as STATIONARY
      // 1-cell snakes in lookahead. They never enter the move sets (moveSet
      // absence = frozen in the Simulator), so the engine plans around where
      // they stand, not where they could jump.
      if ((snake.unitType ?? 'snake') !== 'snake') continue;
      if (this.manhattanDistance(gameState.you.head, snake.head) <= this.config.nearbyDistance) {
        nearbySnakes.push(snake);
      }
      // Snakes beyond nearbyDistance are frozen (not included in simulation)
    }
    const nearbyMoveSets = this.generateNearbyMoveSets(nearbySnakes, gameState, graph)
      .map(moveSet => Array.from(moveSet.entries()) as [string, Direction][]);
    return {
      nearbySnakes,
      simulatedSnakeIds: [gameState.you.id, ...nearbySnakes.map(s => s.id)],
      nearbyMoveSets
    };
  }

  /** Per-move h2h risk context (0/1 flags) injected into every evaluation. */
  private h2hContexts(
    ourMoves: Direction[],
    h2hRiskByMove: Map<Direction, H2HRiskInfo>
  ): Map<Direction, { enemyH2HRisk: number; allyH2HRisk: number }> {
    const h2hCtxByMove = new Map<Direction, { enemyH2HRisk: number; allyH2HRisk: number }>();
    for (const move of ourMoves) {
      const h2hRisk = h2hRiskByMove.get(move);
      h2hCtxByMove.set(move, {
        enemyH2HRisk: h2hRisk?.hasEnemyRisk ? 1 : 0,
        allyH2HRisk: h2hRisk?.hasAllyRisk ? 1 : 0
      });
    }
    return h2hCtxByMove;
  }

  /**
   * Per-move piece-threat context (0/1 flags), the piece counterpart of
   * h2hContexts: computed once per decision from the pre-move board (the
   * analyzer's per-decision threat map) and injected into every evaluation
   * of that move — plain objects, so they ride into worker chunk jobs.
   */
  private pieceThreatContexts(
    ourMoves: Direction[],
    pieceThreatByMove: Map<Direction, PieceThreatInfo>
  ): Map<Direction, { enemyPieceThreat: number; allyPieceThreat: number }> {
    const ctxByMove = new Map<Direction, { enemyPieceThreat: number; allyPieceThreat: number }>();
    for (const move of ourMoves) {
      const threat = pieceThreatByMove.get(move);
      ctxByMove.set(move, {
        enemyPieceThreat: threat?.hasEnemyThreat ? 1 : 0,
        allyPieceThreat: threat?.hasAllyThreat ? 1 : 0
      });
    }
    return ctxByMove;
  }

  /**
   * Per-move projected health cost, the health-loss counterpart of
   * h2hContexts/pieceThreatContexts: computed once per decision from the
   * PRE-move board via the ONE shared cost projection (simulator.ts's
   * projectedHealthCost — the same function ActiveGameManager's piece
   * candidate scoring uses), then injected unchanged into every evaluation
   * of that move. A snake's candidate path is always its single landing
   * square.
   */
  private healthCostContexts(gameState: GameState, ourMoves: Direction[]): Map<Direction, number> {
    const costByMove = new Map<Direction, number>();
    for (const move of ourMoves) {
      const dest = this.getMovePosition(gameState.you.head, move);
      costByMove.set(move, projectedHealthCost(gameState.board, [dest]));
    }
    return costByMove;
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
  //
  // Delegates to the exported `pickBestMove` so the server's mid-turn waypoint
  // re-bias selects by exactly the same rule.
  private static selectBestMove(evaluations: MoveEvaluationResult[]): Direction {
    return pickBestMove(evaluations.map(e => ({
      move: e.move,
      score: e.worstScore,
      trapped: e.worstEvaluation.stats.trapped,
    }))) ?? evaluations[0].move;
  }

  // Compute projected territory per candidate move (asymmetric BFS) for the
  // UI overlays.
  private computeProjectedTerritories(
    gameState: GameState,
    graph: BoardGraph,
    teamSnakeIds: Set<string>,
    evaluations: MoveEvaluationResult[]
  ): void {
    // The enemy/ally sources are identical for every candidate move — only
    // our own head position (slot 0) changes per candidate. Build them once.
    const otherSources: BFSSource[] = [];
    for (const snake of gameState.board.snakes) {
      if (snake.id === gameState.you.id || snake.health <= 0) continue;
      otherSources.push({
        id: snake.id,
        position: snake.head,
        isTeam: teamSnakeIds.has(snake.id),
        startDelay: 0,
        // Contest data for same-level arrivals (tier at the arriving turn,
        // then weight) — identical to what the evaluation BFS feeds.
        ...unitContestData(snake, gameState.turn)
      });
    }

    for (const evalResult of evaluations) {
      const candidatePos = this.getMovePosition(gameState.you.head, evalResult.move);
      if (!candidatePos) continue;
      // The only engine-side spot where a candidate's board position exists —
      // attach it so every downstream row is destination-carrying.
      evalResult.dest = candidatePos;

      const projSources: BFSSource[] = [
        {
          id: gameState.you.id,
          position: candidatePos,
          isTeam: true,
          startDelay: 1,
          ...unitContestData(gameState.you, gameState.turn)
        },
        ...otherSources
      ];

      const projBfs = new MultiSourceBFS(graph);
      // Turn-aware clearance, matching the evaluation BFS: projected
      // territory includes body cells that clear before the winner arrives.
      const projResult = projBfs.compute(projSources, gameState.board.food, { optimistic: true }, gameState.board.fertileTiles);

      evalResult.projectedTerritoryCells = territoryCellsToObject(projResult);
      evalResult.projectedCellOwnership = toCellOwnership(projResult, projSources, graph);
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

    const currentFoodSet = new Set<string>();
    for (const food of gameState.board.food) {
      currentFoodSet.add(`${food.x},${food.y}`);
    }

    const graph = new BoardGraph(gameState);
    const moveAnalysis = this.moveAnalyzer.analyzeMoves(gameState.you, gameState, graph, teamSnakeIds);

    // Per-move waypoint progress, computed ONCE on the main thread from the
    // pre-move board. Chunks are per-candidate-move, so each job carries just
    // its own move's stats — a plain {gotoProgress, nearProgress} pair that
    // structured-clones into the worker for free, instead of every worker
    // re-running the waypoint BFS against a board it would have to re-graph.
    const waypointProgressByMove = computeWaypointProgressByMove(gameState, waypoint, { graph });

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

    // Shared enumeration with decide(): nearby snakes within focal distance
    // and the full 3^k move combinations (plain arrays, so they survive the
    // structured-clone to worker threads).
    const { nearbySnakes, simulatedSnakeIds, nearbyMoveSets } = this.enumerateNearby(gameState, graph);
    const h2hCtxByMove = this.h2hContexts(ourMoves, moveAnalysis.h2hRiskByMove);
    const pieceThreatCtxByMove = this.pieceThreatContexts(ourMoves, moveAnalysis.pieceThreatByMove);
    const healthCostByMove = this.healthCostContexts(gameState, ourMoves);

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
          h2hRisk: h2hCtxByMove.get(move)!,
          pieceThreat: pieceThreatCtxByMove.get(move)!,
          waypointProgress: waypointProgressByMove?.[move] ?? null,
          healthCost: healthCostByMove.get(move)!
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
          {
            h2hRisk: h2hCtxByMove.get(move)!,
            pieceThreat: pieceThreatCtxByMove.get(move)!,
            waypointProgress: waypointProgressByMove?.[move] ?? null,
            healthCost: healthCostByMove.get(move)!
          }
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
            worstScore: -1000,
            numStates: 0,
            worstEvaluation: getFallbackEval(move)
          };
        }
        return {
          move,
          worstScore: acc.score,
          numStates: acc.states,
          worstEvaluation: acc.evaluation
        };
      });
    };

    const buildDecision = (): MoveDecision => {
      const evaluations = buildEvaluations();
      return {
        move: DecisionEngine.selectBestMove(evaluations),
        candidateMoves: ourMoves,
        evaluations,
        h2hRiskByMove: moveAnalysis.h2hRiskByMove,
        graph
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

      updateTimer = transientInterval(() => {
        if (done) return;
        updatesEmitted++;
        onUpdate?.(buildDecision());
      }, updateIntervalMs);

      const remaining = Math.max(0, deadlineMs - Date.now());
      deadlineTimer = transientTimeout(finalize, remaining);

      pump();
    });
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