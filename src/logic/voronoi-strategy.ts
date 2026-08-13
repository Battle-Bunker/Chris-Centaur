/**
 * Voronoi Strategy using the new clean architecture.
 * This replaces the old fragmented implementation with the principled approach.
 */

import { GameState, Direction, TeamInfo } from '../types/battlesnake';
import { BoardEvaluation } from './board-evaluator';
import { DecisionEngine, MoveDecision } from './decision-engine';
import { WaypointContext } from './waypoint-pathing';
import { DecisionLogEntry, DecisionLogger } from './decision-logger';
import { TeamDetector } from './team-detector';
import { ConfigStore } from '../server/configStore';
import { DEFAULT_CONFIG, GameConfig } from '../config/game-config';
import { HEURISTIC_KEYS, HeuristicWeights } from '../config/heuristics';
import { BoardGraph } from './board-graph';
import { MultiSourceBFS, BFSSource, CellOwnership, territoryCellsToObject, toCellOwnership } from './multi-source-bfs';

// The debug/UI payload every strategy decision resolves to.
export interface StrategyResult {
  move: Direction;
  safeMoves: Direction[];
  scores: Map<Direction, number>;
  moveEvaluations: any[];
  territoryCells: { [snakeId: string]: { x: number; y: number }[] };
  // Per-cell Voronoi owner + distance for the current board (cell inspector).
  cellOwnership: CellOwnership;
}

export class VoronoiStrategy {
  private decisionEngine: DecisionEngine;
  private decisionLogger: DecisionLogger;
  private teamDetector: TeamDetector;
  private configStore: ConfigStore;
  private cachedConfig: GameConfig | null = null;
  private configCacheTime: number = 0;
  private CACHE_DURATION_MS = 1000; // Cache config for 1 second
  
  constructor() {
    this.configStore = new ConfigStore();
    this.decisionLogger = DecisionLogger.getInstance();
    this.teamDetector = new TeamDetector();
    
    // Initialize with defaults
    this.decisionEngine = new DecisionEngine({
      timeoutMs: DEFAULT_CONFIG.timeoutMs,
      nearbyDistance: DEFAULT_CONFIG.nearbyDistance,
      weights: this.extractWeights(DEFAULT_CONFIG)
    });
    
    // Load config asynchronously (don't block constructor)
    this.loadConfig();
  }
  
  private async loadConfig(): Promise<void> {
    try {
      const storedConfig = await this.configStore.getAll();
      const mergedConfig = {
        ...DEFAULT_CONFIG,
        ...storedConfig
      };
      this.cachedConfig = mergedConfig;
      this.configCacheTime = Date.now();
      
      // Update decision engine with loaded config
      this.updateDecisionEngine(mergedConfig);
    } catch (error) {
      console.error('Error loading config from store, using defaults:', error);
      this.cachedConfig = DEFAULT_CONFIG;
      this.configCacheTime = Date.now();
    }
  }
  
  // The heuristic-weight half of the config, keyed by the registry — a new
  // heuristic key is picked up here automatically.
  private extractWeights(config: GameConfig): HeuristicWeights {
    const weights = {} as HeuristicWeights;
    for (const key of HEURISTIC_KEYS) weights[key] = config[key];
    return weights;
  }
  
  private updateDecisionEngine(config: GameConfig): void {
    this.decisionEngine = new DecisionEngine({
      timeoutMs: config.timeoutMs,
      nearbyDistance: config.nearbyDistance,
      weights: this.extractWeights(config)
    });
  }
  
  private async getConfig(): Promise<GameConfig> {
    // Check if cache is still valid
    const now = Date.now();
    if (this.cachedConfig && (now - this.configCacheTime) < this.CACHE_DURATION_MS) {
      return this.cachedConfig;
    }
    
    // Reload config
    await this.loadConfig();
    return this.cachedConfig || DEFAULT_CONFIG;
  }
  
  /**
   * Anytime variant: runs the engine's parallel iterative decision on the
   * shared worker pool, invoking onRecommendation with the current best move
   * every ~100ms until deadlineMs or full 3^k completion, then returning the
   * debug payload assembled from the final decision (logged once).
   */
  async getBestMoveIterative(
    gameState: GameState,
    _ourTeam: TeamInfo | undefined,
    waypoint: WaypointContext | null | undefined,
    options: {
      deadlineMs: number;
      updateIntervalMs?: number;
      onRecommendation?: (move: Direction, decision: MoveDecision) => void;
    }
  ): Promise<StrategyResult> {
    const config = await this.getConfig();
    this.updateDecisionEngine(config);

    const teams = this.teamDetector.detectTeams(gameState.board.snakes);
    const ourTeam = teams.find(t => t.snakes.some(s => s.id === gameState.you.id));
    const teamSnakeIds = new Set<string>(ourTeam ? ourTeam.snakes.map(s => s.id) : [gameState.you.id]);

    const decision = await this.decisionEngine.decideIteratively(gameState, teamSnakeIds, {
      waypoint,
      deadlineMs: options.deadlineMs,
      updateIntervalMs: options.updateIntervalMs,
      onUpdate: (partial) => options.onRecommendation?.(partial.move, partial)
    });

    this.logTurnInfo(gameState, decision);

    return this.assembleDebugResult(gameState, decision);
  }

  /**
   * Shared debug/logging assembly for a finished decision: maps evaluations
   * for the UI/database, computes current-board territory, logs the decision
   * (non-blocking), and returns the strategy result payload.
   */
  // Cache of the current-board Voronoi keyed by `${gameId}:${turn}`: the five
  // controlled snakes' decisions for a turn all describe the same board, so
  // the first one computes and the rest reuse. Small LRU (games can overlap).
  private boardVoronoiCache = new Map<string, { territoryCells: { [snakeId: string]: { x: number; y: number }[] }; cellOwnership: CellOwnership; loggedTurnState?: boolean }>();
  private static readonly MAX_VORONOI_CACHE_ENTRIES = 8;

  private currentBoardVoronoi(gameState: GameState, graph: BoardGraph) {
    const key = `${gameState.game.id}:${gameState.turn}`;
    const cached = this.boardVoronoiCache.get(key);
    if (cached) return cached;

    const sources: BFSSource[] = gameState.board.snakes
      .filter(s => s.health > 0)
      .map(s => ({
        id: s.id,
        position: s.head,
        // Team flags only feed aggregate sums this consumer never reads;
        // owner/distance/territory are team-independent, which is what makes
        // the result shareable across snakes on different teams.
        isTeam: false
      }));
    // Turn-aware clearance (same physical vacate timing the evaluation BFS
    // uses): body cells count as territory for whoever arrives first AFTER
    // they clear, instead of being modeled as permanent walls.
    const bfs = new MultiSourceBFS(graph);
    const bfsResult = bfs.compute(sources, gameState.board.food, { optimistic: true }, gameState.board.fertileTiles);

    const entry: { territoryCells: { [snakeId: string]: { x: number; y: number }[] }; cellOwnership: CellOwnership; loggedTurnState?: boolean } = {
      territoryCells: territoryCellsToObject(bfsResult),
      cellOwnership: toCellOwnership(bfsResult, sources, graph),
    };
    this.boardVoronoiCache.set(key, entry);
    while (this.boardVoronoiCache.size > VoronoiStrategy.MAX_VORONOI_CACHE_ENTRIES) {
      const oldest = this.boardVoronoiCache.keys().next().value;
      if (oldest === undefined) break;
      this.boardVoronoiCache.delete(oldest);
    }
    return entry;
  }

  // The per-move breakdown blob logged to the DB and consumed by the UI: every
  // registry stat, the raw foodDistance, the weights/weighted tables, plus the
  // legacy wire aliases.
  private buildBreakdown(
    evaluation: BoardEvaluation
  ): NonNullable<DecisionLogEntry['moveEvaluations'][number]['breakdown']> {
    const { stats } = evaluation;
    const breakdown: { [key: string]: any } = {};
    for (const key of HEURISTIC_KEYS) breakdown[key] = stats[key];
    breakdown.foodDistance = stats.foodDistance;
    breakdown.weights = evaluation.weights;
    breakdown.weighted = evaluation.weighted;
    // LEGACY WIRE ALIASES — a UI/DB contract (history viewer and stored rows
    // read these names). Keep them exactly as-is; do not fold into the
    // registry-driven block above.
    breakdown.fertileTerritory = stats.teamTerritory + stats.teamControlledFood * 10;
    breakdown.foodDistanceInverse = stats.foodProximity;
    breakdown.myFoodCount = stats.myControlledFood;
    breakdown.teamFoodCount = stats.teamControlledFood;
    breakdown.teamFertileScore = stats.teamTerritory + stats.teamControlledFood * 10;
    return breakdown as NonNullable<DecisionLogEntry['moveEvaluations'][number]['breakdown']>;
  }

  private assembleDebugResult(gameState: GameState, decision: MoveDecision): StrategyResult {
    // Prepare decision data for database logging
    const moveEvaluations = decision.evaluations.map(evaluation => ({
      move: evaluation.move,
      score: evaluation.worstScore,
      numStates: evaluation.numStates,
      // Destination cell (api coords) when the projection pass computed it —
      // keeps the wire/DB row destination-carrying alongside the move id.
      dest: evaluation.dest,
      projectedTerritoryCells: evaluation.projectedTerritoryCells || {},
      projectedCellOwnership: evaluation.projectedCellOwnership || null,
      breakdown: this.buildBreakdown(evaluation.worstEvaluation)
    }));
    
    // Current-board territory + ownership for visualization. Owner/distance
    // are snake-independent, so ONE computation per (game, turn) serves every
    // controlled snake's decision; the engine's already-built graph is reused
    // (one graph per decision, one clearance config).
    const voronoiEntry = this.currentBoardVoronoi(gameState, decision.graph);
    const { territoryCells: territoryCellsObj, cellOwnership } = voronoiEntry;

    // The shared grids are persisted ONCE per (game, turn) onto the turn-state
    // row (they used to be duplicated into every snake's decision blob). The
    // cache entry doubles as the once-per-turn latch.
    if (!voronoiEntry.loggedTurnState) {
      voronoiEntry.loggedTurnState = true;
      this.decisionLogger.logTurnState({
        gameId: gameState.game.id,
        turn: gameState.turn,
        territory: territoryCellsObj,
        cellOwnership,
      });
    }

    // Log the decision to database (non-blocking). The row carries only this
    // snake's data (slim game_state; per-move evaluations with their
    // per-candidate projections).
    // IMPORTANT: Only log the actual candidate moves, not all possible moves
    this.decisionLogger.logDecision({
      gameId: gameState.game.id,
      snakeId: gameState.you.id,
      snakeName: gameState.you.name,
      turn: gameState.turn + 1,
      position: gameState.you.head,
      health: gameState.you.health,
      safeMoves: decision.candidateMoves,  // Only the moves we actually evaluated!
      botRecommendation: decision.move,
      moveEvaluations,
      gameState,
    });
    
    // Return for backwards compatibility
    const scores = new Map<Direction, number>();
    for (const evaluation of decision.evaluations) {
      scores.set(evaluation.move, evaluation.worstScore);
    }
    
    // NOTE: the live green "goto" route is owned by the server
    // (ActiveGameManager), which recomputes it anchored at the snake's PROJECTED
    // head. The strategy must NOT return a competing route anchored at the live
    // head — that mismatch is what made a Goto snake silently revert to the
    // bot's straight move after committing a move this turn.
    return {
      move: decision.move,
      safeMoves: decision.candidateMoves,
      scores,
      moveEvaluations,
      territoryCells: territoryCellsObj,
      cellOwnership
    };
  }
  
  /**
   * Called when a game ends so per-game cache entries don't accumulate over
   * the process lifetime.
   */
  public onGameEnd(gameId: string): void {
    for (const key of this.boardVoronoiCache.keys()) {
      if (key.startsWith(`${gameId}:`)) this.boardVoronoiCache.delete(key);
    }
  }

  private logTurnInfo(gameState: GameState, decision: MoveDecision): void {
    const turn = gameState.turn + 1;
    
    console.log(`\n=== TURN ${turn} ===`);
    console.log(`Position: (${gameState.you.head.x}, ${gameState.you.head.y}), Health: ${gameState.you.health}`);
    console.log(`Candidate moves: ${decision.candidateMoves.join(', ')}`);
    
    // Log detailed breakdown for each evaluated move. Rows are derived from
    // the heuristic registry: one row per key (labelled by the key itself),
    // shown when the stat or its weighted score is non-zero, plus the raw
    // (never-weighted) foodDistance row.
    for (const evaluation of decision.evaluations) {
      if (evaluation.worstScore === -Infinity) {
        console.log(`\nMove ${evaluation.move}: DEATH (no valid scenarios)`);
        continue;
      }

      const breakdown = evaluation.worstEvaluation;
      console.log(`\nMove ${evaluation.move}: Total Score = ${breakdown.score.toFixed(2)} (${evaluation.numStates} states evaluated)`);
      console.log('┌──────────────────────┬──────────┬──────────┬──────────┐');
      console.log('│ Component            │     Stat │ × Weight │  = Score │');
      console.log('├──────────────────────┼──────────┼──────────┤');

      for (const key of HEURISTIC_KEYS) {
        if (key === 'foodProximity') {
          console.log(`│ ${'foodDistance'.padEnd(20)} │ ${breakdown.stats.foodDistance.toFixed(1).padStart(8)} │          │  (raw)   │`);
        }
        const stat = breakdown.stats[key];
        const weighted = breakdown.weighted[`${key}Score`];
        if (stat === 0 && weighted === 0) continue;
        console.log(`│ ${key.padEnd(20)} │ ${stat.toFixed(2).padStart(8)} │ ×${breakdown.weights[key].toString().padStart(7)} │ ${weighted.toFixed(2).padStart(8)} │`);
      }

      console.log('└──────────────────────┴──────────┴──────────┴──────────┘');
    }
    
    console.log(`\nCHOSEN: ${decision.move.toUpperCase()}`);
  }
}