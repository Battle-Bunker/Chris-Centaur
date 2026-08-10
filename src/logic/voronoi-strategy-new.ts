/**
 * Voronoi Strategy using the new clean architecture.
 * This replaces the old fragmented implementation with the principled approach.
 */

import { GameState, Direction, TeamInfo, SimulationConfig } from '../types/battlesnake';
import { DecisionEngine, MoveDecision } from './decision-engine';
import { WaypointContext } from './board-evaluator';
import { DecisionLogger } from './decision-logger';
import { TeamDetector } from './team-detector';
import { ConfigStore } from '../server/configStore';
import { DEFAULT_CONFIG, GameConfig } from '../config/game-config';
import { BoardGraph } from './board-graph';
import { MultiSourceBFS, BFSSource, CellOwnership } from './multi-source-bfs';

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
  
  private extractWeights(config: GameConfig) {
    return {
      myLength: config.myLength,
      myTerritory: config.myTerritory,
      myControlledFood: config.myControlledFood,
      myControlledFertile: config.myControlledFertile,
      teamLength: config.teamLength,
      teamTerritory: config.teamTerritory,
      teamControlledFood: config.teamControlledFood,
      foodProximity: config.foodProximity,
      foodEaten: config.foodEaten,
      enemyTerritory: config.enemyTerritory,
      enemyLength: config.enemyLength,
      edgePenalty: config.edgePenalty,
      selfSpace: config.selfSpace,
      alliesEnoughSpace: config.alliesEnoughSpace,
      opponentsEnoughSpace: config.opponentsEnoughSpace,
      kills: config.kills,
      deaths: config.deaths,
      enemyH2HRisk: config.enemyH2HRisk,
      allyH2HRisk: config.allyH2HRisk,
      waypointGoto: config.waypointGoto,
      waypointNear: config.waypointNear,
      aggression: config.aggression,
      trapped: config.trapped
    };
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
  
  setConfig(config: Partial<SimulationConfig>) {
    // Get weights from environment variables or use defaults
    const weights = {
      myLength: parseFloat(process.env.WEIGHT_MY_LENGTH || '10'),
      myTerritory: parseFloat(process.env.WEIGHT_MY_TERRITORY || '1'),
      myControlledFood: parseFloat(process.env.WEIGHT_MY_CONTROLLED_FOOD || '10'),
      myControlledFertile: parseFloat(process.env.WEIGHT_MY_CONTROLLED_FERTILE || '2'),
      teamLength: parseFloat(process.env.WEIGHT_TEAM_LENGTH || '10'),
      teamTerritory: parseFloat(process.env.WEIGHT_TEAM_TERRITORY || '1'),
      teamControlledFood: parseFloat(process.env.WEIGHT_TEAM_CONTROLLED_FOOD || '10'),
      foodProximity: parseFloat(process.env.WEIGHT_FOOD_PROXIMITY || '50'),
      enemyTerritory: parseFloat(process.env.WEIGHT_ENEMY_TERRITORY || '0'),
      enemyLength: parseFloat(process.env.WEIGHT_ENEMY_LENGTH || '0'),
      edgePenalty: parseFloat(process.env.WEIGHT_EDGE_PENALTY || '0'),
      selfSpace: parseFloat(process.env.WEIGHT_SELF_SPACE || '120'),
      alliesEnoughSpace: parseFloat(process.env.WEIGHT_ALLIES_ENOUGH_SPACE || '30'),
      opponentsEnoughSpace: parseFloat(process.env.WEIGHT_OPPONENTS_ENOUGH_SPACE || '-45'),
      kills: parseFloat(process.env.WEIGHT_KILLS || '0'),
      deaths: parseFloat(process.env.WEIGHT_DEATHS || '-500')
    };
    
    // Update decision engine config
    this.decisionEngine = new DecisionEngine({
      timeoutMs: config.maxEvaluationTimeMs || 400,
      nearbyDistance: config.maxDistance || 3,
      weights
    });
  }
  
  async getBestMove(gameState: GameState, _ourTeam?: TeamInfo): Promise<Direction> {
    // Reload config if needed (cached for 1 second)
    const config = await this.getConfig();
    this.updateDecisionEngine(config);
    
    // Detect teams
    const teams = this.teamDetector.detectTeams(gameState.board.snakes);
    const ourTeam = teams.find(t => t.snakes.some(s => s.id === gameState.you.id));
    const teamSnakeIds = new Set<string>(ourTeam ? ourTeam.snakes.map(s => s.id) : [gameState.you.id]);
    
    // Use decision engine to get best move
    const decision = this.decisionEngine.decide(gameState, teamSnakeIds);
    
    // Log turn info
    this.logTurnInfo(gameState, decision);
    
    return decision.move;
  }
  
  async getBestMoveWithDebug(gameState: GameState, _ourTeam?: TeamInfo, waypoint?: WaypointContext | null): Promise<StrategyResult> {
    // Reload config if needed (cached for 1 second)
    const config = await this.getConfig();
    this.updateDecisionEngine(config);
    
    // Detect teams
    const teams = this.teamDetector.detectTeams(gameState.board.snakes);
    const ourTeam = teams.find(t => t.snakes.some(s => s.id === gameState.you.id));
    const teamSnakeIds = new Set<string>(ourTeam ? ourTeam.snakes.map(s => s.id) : [gameState.you.id]);
    
    // Use decision engine to get best move (with optional user-directed waypoint)
    const decision = this.decisionEngine.decide(gameState, teamSnakeIds, waypoint);

    // Log turn info to console
    this.logTurnInfo(gameState, decision);

    return this.assembleDebugResult(gameState, teamSnakeIds, decision);
  }

  /**
   * Anytime variant: runs the engine's parallel iterative decision on the
   * shared worker pool, invoking onRecommendation with the current best move
   * every ~100ms until deadlineMs or full 3^k completion, then returning the
   * same debug payload as getBestMoveWithDebug (assembled from the final
   * decision, logged once).
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

    return this.assembleDebugResult(gameState, teamSnakeIds, decision);
  }

  /**
   * Shared debug/logging assembly for a finished decision: maps evaluations
   * for the UI/database, computes current-board territory, logs the decision
   * (non-blocking), and returns the strategy result payload.
   */
  private assembleDebugResult(
    gameState: GameState,
    teamSnakeIds: Set<string>,
    decision: MoveDecision
  ): StrategyResult {
    // Prepare decision data for database logging
    const moveEvaluations = decision.evaluations.map(evaluation => ({
      move: evaluation.move,
      score: evaluation.worstScore,
      numStates: evaluation.numStates,
      projectedTerritoryCells: evaluation.projectedTerritoryCells || {},
      projectedCellOwnership: evaluation.projectedCellOwnership || null,
      breakdown: {
        myLength: evaluation.worstEvaluation.stats.myLength,
        myTerritory: evaluation.worstEvaluation.stats.myTerritory,
        myControlledFood: evaluation.worstEvaluation.stats.myControlledFood,
        myControlledFertile: evaluation.worstEvaluation.stats.myControlledFertile,
        teamLength: evaluation.worstEvaluation.stats.teamLength,
        teamTerritory: evaluation.worstEvaluation.stats.teamTerritory,
        teamControlledFood: evaluation.worstEvaluation.stats.teamControlledFood,
        foodDistance: evaluation.worstEvaluation.stats.foodDistance,
        foodProximity: evaluation.worstEvaluation.stats.foodProximity,
        foodEaten: evaluation.worstEvaluation.stats.foodEaten,
        enemyTerritory: evaluation.worstEvaluation.stats.enemyTerritory,
        enemyLength: evaluation.worstEvaluation.stats.enemyLength,
        edgePenalty: evaluation.worstEvaluation.stats.edgePenalty,
        selfSpace: evaluation.worstEvaluation.stats.selfSpace,
        alliesEnoughSpace: evaluation.worstEvaluation.stats.alliesEnoughSpace,
        opponentsEnoughSpace: evaluation.worstEvaluation.stats.opponentsEnoughSpace,
        kills: evaluation.worstEvaluation.stats.kills,
        deaths: evaluation.worstEvaluation.stats.deaths,
        enemyH2HRisk: evaluation.worstEvaluation.stats.enemyH2HRisk,
        allyH2HRisk: evaluation.worstEvaluation.stats.allyH2HRisk,
        waypointGoto: evaluation.worstEvaluation.stats.waypointGoto,
        waypointNear: evaluation.worstEvaluation.stats.waypointNear,
        aggression: evaluation.worstEvaluation.stats.aggression,
        trapped: evaluation.worstEvaluation.stats.trapped,
        weights: evaluation.worstEvaluation.weights,
        weighted: evaluation.worstEvaluation.weighted,
        fertileTerritory: evaluation.worstEvaluation.stats.teamTerritory + evaluation.worstEvaluation.stats.teamControlledFood * 10,
        foodDistanceInverse: evaluation.worstEvaluation.stats.foodProximity,
        myFoodCount: evaluation.worstEvaluation.stats.myControlledFood,
        teamFoodCount: evaluation.worstEvaluation.stats.teamControlledFood,
        teamFertileScore: evaluation.worstEvaluation.stats.teamTerritory + evaluation.worstEvaluation.stats.teamControlledFood * 10
      }
    }));
    
    // Compute territory cells for current board state visualization
    const graph = new BoardGraph(gameState);
    const bfs = new MultiSourceBFS(graph);
    const sources: BFSSource[] = gameState.board.snakes
      .filter(s => s.health > 0)
      .map(s => ({
        id: s.id,
        position: s.head,
        isTeam: teamSnakeIds.has(s.id)
      }));
    const bfsResult = bfs.compute(sources, gameState.board.food, undefined, gameState.board.fertileTiles);
    
    // Convert Map to plain object for JSON serialization
    const territoryCellsObj: { [snakeId: string]: { x: number; y: number }[] } = {};
    for (const [snakeId, cells] of bfsResult.territoryCells) {
      territoryCellsObj[snakeId] = cells;
    }

    // Serializable per-cell owner/distance snapshot for the UI cell inspector.
    const cellOwnership: CellOwnership = {
      width: gameState.board.width,
      height: gameState.board.height,
      sources: sources.map(s => s.id),
      owner: Array.from(bfsResult.ownerIndex),
      distance: Array.from(bfsResult.distanceIndex),
    };
    
    // Log the decision to database (non-blocking)
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
      territoryCells: territoryCellsObj,
      cellOwnership
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
   * Called from the /end route so per-game state in the decision engine
   * (notably lastFoodSetByGameId) doesn't accumulate over the process lifetime.
   */
  public onGameEnd(gameId: string): void {
    this.decisionEngine.onGameEnd(gameId);
  }

  private logTurnInfo(gameState: GameState, decision: MoveDecision): void {
    const turn = gameState.turn + 1;
    
    console.log(`\n=== TURN ${turn} ===`);
    console.log(`Position: (${gameState.you.head.x}, ${gameState.you.head.y}), Health: ${gameState.you.health}`);
    console.log(`Candidate moves: ${decision.candidateMoves.join(', ')}`);
    
    // Log detailed breakdown for each evaluated move
    for (const evaluation of decision.evaluations) {
      if (evaluation.worstScore === -Infinity) {
        console.log(`\nMove ${evaluation.move}: DEATH (no valid scenarios)`);
        continue;
      }
      
      const breakdown = evaluation.worstEvaluation;
      console.log(`\nMove ${evaluation.move}: Total Score = ${breakdown.score.toFixed(2)} (${evaluation.numStates} states evaluated)`);
      console.log('┌─────────────────────┬──────────┬──────────┬──────────┐');
      console.log('│ Component           │  Average │ × Weight │  = Score │');
      console.log('├─────────────────────┼──────────┼──────────┤');
      
      // My Snake Stats
      console.log(`│ My Length           │ ${breakdown.stats.myLength.toFixed(1).padStart(8)} │ ×${breakdown.weights.myLength.toString().padStart(7)} │ ${breakdown.weighted.myLengthScore.toFixed(2).padStart(8)} │`);
      console.log(`│ My Territory        │ ${breakdown.stats.myTerritory.toFixed(1).padStart(8)} │ ×${breakdown.weights.myTerritory.toString().padStart(7)} │ ${breakdown.weighted.myTerritoryScore.toFixed(2).padStart(8)} │`);
      console.log(`│ My Controlled Food  │ ${breakdown.stats.myControlledFood.toFixed(1).padStart(8)} │ ×${breakdown.weights.myControlledFood.toString().padStart(7)} │ ${breakdown.weighted.myControlledFoodScore.toFixed(2).padStart(8)} │`);
      console.log(`│ My Fertile Ground   │ ${breakdown.stats.myControlledFertile.toFixed(1).padStart(8)} │ ×${breakdown.weights.myControlledFertile.toString().padStart(7)} │ ${breakdown.weighted.myControlledFertileScore.toFixed(2).padStart(8)} │`);
      
      // Team Stats
      console.log(`│ Team Length         │ ${breakdown.stats.teamLength.toFixed(1).padStart(8)} │ ×${breakdown.weights.teamLength.toString().padStart(7)} │ ${breakdown.weighted.teamLengthScore.toFixed(2).padStart(8)} │`);
      console.log(`│ Team Territory      │ ${breakdown.stats.teamTerritory.toFixed(1).padStart(8)} │ ×${breakdown.weights.teamTerritory.toString().padStart(7)} │ ${breakdown.weighted.teamTerritoryScore.toFixed(2).padStart(8)} │`);
      console.log(`│ Team Controlled Food│ ${breakdown.stats.teamControlledFood.toFixed(1).padStart(8)} │ ×${breakdown.weights.teamControlledFood.toString().padStart(7)} │ ${breakdown.weighted.teamControlledFoodScore.toFixed(2).padStart(8)} │`);
      
      // Food Distance and Proximity
      console.log(`│ Food Distance       │ ${breakdown.stats.foodDistance.toFixed(1).padStart(8)} │          │  (raw)   │`);
      console.log(`│ Food Proximity      │ ${breakdown.stats.foodProximity.toFixed(3).padStart(8)} │ ×${breakdown.weights.foodProximity.toString().padStart(7)} │ ${breakdown.weighted.foodProximityScore.toFixed(2).padStart(8)} │`);
      console.log(`│ Food Eaten          │ ${breakdown.stats.foodEaten.toFixed(1).padStart(8)} │ ×${breakdown.weights.foodEaten.toString().padStart(7)} │ ${breakdown.weighted.foodEatenScore.toFixed(2).padStart(8)} │`);
      
      // Enhanced Space Detection
      if (breakdown.stats.selfSpace !== undefined && breakdown.weights.selfSpace !== undefined) {
        console.log(`│ Self Space          │ ${(breakdown.stats.selfSpace || 0).toFixed(2).padStart(8)} │ ×${(breakdown.weights.selfSpace || 0).toString().padStart(7)} │ ${(breakdown.weighted.selfSpaceScore || 0).toFixed(2).padStart(8)} │`);
      }
      if (breakdown.stats.alliesEnoughSpace !== undefined && breakdown.weights.alliesEnoughSpace !== undefined) {
        console.log(`│ Allies Space        │ ${(breakdown.stats.alliesEnoughSpace || 0).toFixed(1).padStart(8)} │ ×${(breakdown.weights.alliesEnoughSpace || 0).toString().padStart(7)} │ ${(breakdown.weighted.alliesEnoughSpaceScore || 0).toFixed(2).padStart(8)} │`);
      }
      if (breakdown.stats.opponentsEnoughSpace !== undefined && breakdown.weights.opponentsEnoughSpace !== undefined) {
        console.log(`│ Opponents Space     │ ${(breakdown.stats.opponentsEnoughSpace || 0).toFixed(1).padStart(8)} │ ×${(breakdown.weights.opponentsEnoughSpace || 0).toString().padStart(7)} │ ${(breakdown.weighted.opponentsEnoughSpaceScore || 0).toFixed(2).padStart(8)} │`);
      }
      
      // Edge Penalty
      if (breakdown.stats.edgePenalty !== 0) {
        console.log(`│ Edge Penalty        │ ${breakdown.stats.edgePenalty.toFixed(1).padStart(8)} │ ×${breakdown.weights.edgePenalty.toString().padStart(7)} │ ${breakdown.weighted.edgePenaltyScore.toFixed(2).padStart(8)} │`);
      }
      
      // Enemy stats (currently zero weight but tracked)
      if (breakdown.weights.enemyTerritory > 0 || breakdown.weights.enemyLength > 0) {
        console.log(`│ Enemy Territory     │ ${breakdown.stats.enemyTerritory.toFixed(1).padStart(8)} │ ×${breakdown.weights.enemyTerritory.toString().padStart(7)} │ ${breakdown.weighted.enemyTerritoryScore.toFixed(2).padStart(8)} │`);
        console.log(`│ Enemy Length        │ ${breakdown.stats.enemyLength.toFixed(1).padStart(8)} │ ×${breakdown.weights.enemyLength.toString().padStart(7)} │ ${breakdown.weighted.enemyLengthScore.toFixed(2).padStart(8)} │`);
      }
      
      // Deaths penalty
      if (breakdown.stats.deaths > 0) {
        console.log(`│ Deaths              │ ${breakdown.stats.deaths.toFixed(1).padStart(8)} │ ×${breakdown.weights.deaths.toString().padStart(7)} │ ${breakdown.weighted.deathsScore.toFixed(2).padStart(8)} │`);
      }
      
      console.log('└─────────────────────┴──────────┴──────────┴──────────┘');
    }
    
    console.log(`\nCHOSEN: ${decision.move.toUpperCase()}`);
  }
}