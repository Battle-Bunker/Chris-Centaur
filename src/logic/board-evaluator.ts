/**
 * Unified board evaluator that provides a single scoring function for board states.
 * Returns both a score and structured statistics for each heuristic.
 * Now uses single-pass multi-source BFS for O(W×H) complexity.
 */

import { GameState, Snake, Coord } from '../types/battlesnake';
import { BoardGraph, BoardGraphConfig, ClearanceMode } from './board-graph';
import { MultiSourceBFS, BFSSource, BFSResult } from './multi-source-bfs';
import { WaypointProgress } from './waypoint-pathing';

export interface HeuristicStats {
  // My snake stats
  myLength: number;           // Our snake's length
  myTerritory: number;        // Our snake's voronoi territory cells
  myControlledFood: number;   // Food cells within our voronoi territory
  myControlledFertile: number; // Fertile tiles within our voronoi territory
  
  // Team stats (includes our snake)
  teamLength: number;         // Combined length of team snakes
  teamTerritory: number;      // Team voronoi territory cells
  teamControlledFood: number; // Food cells within team voronoi territory
  
  // Distance/proximity metrics
  foodDistance: number;       // Distance to nearest food (1000 if none reachable) - raw unweighted
  foodProximity: number;      // Normalized linear proximity [0,1]: (boardSize - distance)/boardSize, 0 when eating
  foodEaten: number;          // 1 if eating (justAte or onFoodNow), 0 otherwise - direct reward
  
  // Enemy stats
  enemyTerritory: number;     // Enemy controlled territory
  enemyLength: number;        // Combined length of enemy snakes
  
  // Safety heuristics
  edgePenalty: number;        // Penalty for being on edge of board (-1 if on edge, 0 otherwise)
  
  // Enhanced space detection heuristics
  selfSpace: number;          // Continuous survival room (sqrt-scaled, length-normalised) from the contest-aware conservative region: room == length → 1.0
  alliesEnoughSpace: number;  // Sum of space scores for allied snakes
  opponentsEnoughSpace: number; // Sum of space scores for opponent snakes
  
  // Life/death tracking
  kills: number;              // Number of enemy snakes that died
  deaths: number;             // Number of team snakes that died (including self)
  
  // Head-to-head risk tracking
  enemyH2HRisk: number;       // 1 if move has h2h risk with enemy, 0 otherwise
  allyH2HRisk: number;        // 1 if move has h2h risk with ally, 0 otherwise
  
  // User-directed waypoint heuristics (0 when no waypoint is set for this snake).
  // Both are BOUNDED [0,1] shortest-path progress ramps computed per candidate
  // move by the decision engine and injected via EvaluationContext — not derived
  // from the evaluated board. The optimal next move scores exactly 1, so the
  // config weight IS the bonus that move receives.
  gotoProgress: number;       // Goto (green): 1 on the optimal step, falling linearly to 0 at double the best path
  nearProgress: number;       // Near (blue): same ramp anchored one cell short; 0 for landing ON the target

  // Offensive aggression heuristic
  aggression: number;           // Reward [0,2] for closing in on / landing on the head/body of an enemy we strictly out-invulnerate; 0 otherwise

  // Hard trap survival signal
  trapped: number;              // 1 if the move leads into a clearly-fatal dead-end pocket (no tail-chase, not enough room to outlast our length), 0 otherwise
}

export interface BoardEvaluation {
  score: number;              // Overall board score
  stats: HeuristicStats;      // Individual heuristic values
  weights: HeuristicWeights;  // Weights used for scoring
  weighted: WeightedScores;   // Individual weighted scores
  territoryCells?: Map<string, { x: number; y: number }[]>;  // Territory cells per snake for visualization
}

export interface H2HRiskContext {
  enemyH2HRisk?: number;  // 1 if this move has h2h risk with enemy, 0 otherwise
  allyH2HRisk?: number;   // 1 if this move has h2h risk with ally, 0 otherwise
}

export interface EvaluationContext {
  prevFoodSet?: Set<string>;  // Food positions from previous board state
  optimistic?: boolean;       // Use optimistic passability for body segments
  h2hRisk?: H2HRiskContext;   // Head-to-head risk info for the move being evaluated
  simulatedSnakeIds?: Set<string>;  // Snake IDs that were simulated (already moved) - get startDelay: 1
  // Per-move goto/near progress stats for the candidate move that produced this
  // board (centaur play mode). Computed once per decision from the PRE-move
  // board by the shared waypoint pathfinder and injected here — the same
  // injection pattern as h2hRisk, and for the same reason: it is a property of
  // the move under consideration, not of the board being scored.
  waypointProgress?: WaypointProgress | null;
  // Materialize per-snake territory cell lists (UI/visualization). Defaults to
  // true; the chunked minimax evaluation passes false — it reads only scores
  // and stats, and building coord arrays per state was measurable GC churn.
  collectTerritory?: boolean;
}

export interface HeuristicWeights {
  // My snake weights
  myLength: number;
  myTerritory: number;
  myControlledFood: number;
  myControlledFertile: number;
  
  // Team weights
  teamLength: number;
  teamTerritory: number;
  teamControlledFood: number;
  
  // Distance/proximity weights
  foodProximity: number;      // Weight for food proximity (linear)
  foodEaten: number;          // Weight for actually eating food
  
  // Enemy weights
  enemyTerritory: number;
  enemyLength: number;
  
  // Safety weights
  edgePenalty: number;        // Weight for edge penalty
  
  // Enhanced space detection weights
  selfSpace: number;          // Weight for the continuous contest-aware survival room (sqrt-scaled; room == length → 1.0)
  alliesEnoughSpace: number;  // Weight for allies' space scores
  opponentsEnoughSpace: number; // Weight for opponents' space scores (negative to encourage trapping)
  
  // Life/death weights
  kills: number;
  deaths: number;
  
  // Head-to-head risk weights
  enemyH2HRisk: number;       // Penalty for h2h risk with enemy
  allyH2HRisk: number;        // Penalty for h2h risk with ally
  
  // Waypoint progress weights. Because the stat is a bounded [0,1] ramp whose
  // maximum is the optimal next move, the weight IS the bonus that move gets.
  // Keep both BELOW the deaths (-500) and trapped (-600) weights: that ordering
  // is what guarantees the snake never dies for a click-target.
  gotoProgress: number;
  nearProgress: number;

  // Offensive aggression weight
  aggression: number;           // Weight applied to the aggression reward (positive, conservative so survival dominates)

  // Hard trap survival weight
  trapped: number;              // Weight applied to the trapped signal (strongly negative; a fatal pocket should dominate non-survival heuristics)
}

export interface WeightedScores {
  // My snake weighted scores
  myLengthScore: number;
  myTerritoryScore: number;
  myControlledFoodScore: number;
  myControlledFertileScore: number;
  
  // Team weighted scores
  teamLengthScore: number;
  teamTerritoryScore: number;
  teamControlledFoodScore: number;
  
  // Distance/proximity weighted scores
  foodProximityScore: number;  // Weighted food proximity score
  foodEatenScore: number;      // Weighted food eaten score
  
  // Enemy weighted scores
  enemyTerritoryScore: number;
  enemyLengthScore: number;
  
  // Safety weighted scores
  edgePenaltyScore: number;   // Weighted edge penalty score
  
  // Enhanced space detection weighted scores
  selfSpaceScore: number;          // Weighted continuous contest-aware survival room
  alliesEnoughSpaceScore: number;  // Weighted allies' space scores
  opponentsEnoughSpaceScore: number; // Weighted opponents' space scores
  
  // Life/death weighted scores
  killsScore: number;
  deathsScore: number;
  
  // Head-to-head risk weighted scores
  enemyH2HRiskScore: number;
  allyH2HRiskScore: number;
  
  // Waypoint weighted scores
  gotoProgressScore: number;
  nearProgressScore: number;

  // Offensive aggression weighted score
  aggressionScore: number;

  // Hard trap survival weighted score
  trappedScore: number;
}

export class BoardEvaluator {
  private weights: HeuristicWeights;
  private graphConfig: BoardGraphConfig;
  
  constructor(weights?: Partial<HeuristicWeights>, graphConfig?: Partial<BoardGraphConfig>) {
    // Default weights for each heuristic (can be overridden)
    this.weights = {
      // My snake weights
      myLength: 10.0,           // High weight for staying alive
      myTerritory: 1.0,         // Basic territory value
      myControlledFood: 10.0,   // High value for controlling food
      myControlledFertile: 2.0, // Value for controlling fertile ground
      
      // Team weights
      teamLength: 10.0,         // Team coordination value
      teamTerritory: 1.0,       // Basic territory value
      teamControlledFood: 10.0, // High value for controlling food
      
      // Distance/proximity weights
      foodProximity: 50.0,      // Weight for food proximity (linear)
      foodEaten: 200.0,         // High reward for actually eating food
      
      // Enemy weights
      enemyTerritory: 0,        // Currently not used but tracked
      enemyLength: 0,           // Currently not used but tracked
      
      // Safety weights
      edgePenalty: 50.0,        // Penalty for being on edge of board
      
      // Enhanced space detection weights
      selfSpace: 120,           // Continuous contest-aware room (sqrt; room == length → 1.0), ~territory-scale
      alliesEnoughSpace: 15.0,  // Weight for allies having space (positive = good teamwork; ×3 for the flat ±1 tier)
      opponentsEnoughSpace: -15.0, // Weight for opponents having space (negative = encourage trapping; ×3 for the flat ±1 tier)
      
      // Life/death weights
      kills: 0,                 // Currently not used but tracked
      deaths: -500,             // Heavy penalty for death
      
      // Head-to-head risk weights
      enemyH2HRisk: -100,       // Penalty for h2h risk with enemy
      allyH2HRisk: -50,         // Penalty for h2h risk with ally
      
      // Waypoint weights (only active when a waypoint is set)
      gotoProgress: 300,        // Bonus for the optimal step toward a goto target (bounded: this IS the max)
      nearProgress: 250,        // Bonus for the optimal step toward a near target (bounded: this IS the max)

      // Offensive aggression weight (conservative: max stat 2 → max +50, far below
      // the death penalty of -500, so survival always dominates aggression)
      aggression: 25,              // Reward hunting enemies we strictly out-invulnerate

      // Hard trap survival weight: a clearly-fatal pocket is effectively a death,
      // so this dominates every non-survival heuristic. The candidate-level veto
      // in the decision engine is the hard guarantee; this weight ensures the
      // signal also dominates scoring when a veto is not possible.
      trapped: -600,
      
      // Override with provided weights
      ...weights
    };
    
    this.graphConfig = {
      tailGrowthTiming: 'grow-next-turn' as const,
      maxLookaheadTurns: 5,
      ...graphConfig
    };
  }
  
  /**
   * The single unified scoring function for any board state.
   * All board evaluations in the codebase must go through this function.
   */
  public evaluateBoard(gameState: GameState, ourSnakeId: string, teamSnakeIds: Set<string>, ctx?: EvaluationContext): BoardEvaluation {
    const { stats, territoryCells } = this.calculateStatsWithTerritory(gameState, ourSnakeId, teamSnakeIds, ctx);
    const weighted = this.calculateWeightedScores(stats);
    const score = this.calculateTotalScore(weighted);
    
    return {
      score,
      stats,
      weights: this.weights, // treated as immutable by all consumers
      weighted,
      territoryCells
    };
  }
  
  /**
   * Calculate all heuristic statistics for the board state.
   * Now uses single-pass multi-source BFS for efficiency.
   * Returns both stats and territory cells for visualization.
   */
  private calculateStatsWithTerritory(gameState: GameState, ourSnakeId: string, teamSnakeIds: Set<string>, ctx?: EvaluationContext): { stats: HeuristicStats; territoryCells: Map<string, { x: number; y: number }[]> } {
    const { board } = gameState;
    const ourSnake = board.snakes.find((s: Snake) => s.id === ourSnakeId);
    
    // Check if we're dead
    const isDead = !ourSnake || ourSnake.health <= 0;
    if (isDead) {
      return {
        stats: {
          myLength: 0,
          myTerritory: 0,
          myControlledFood: 0,
          myControlledFertile: 0,
          teamLength: 0,
          teamTerritory: 0,
          teamControlledFood: 0,
          foodDistance: 1000,
          foodProximity: 0,
          foodEaten: 0,
          enemyTerritory: 0,
          enemyLength: 0,
          edgePenalty: 0,
          selfSpace: 0,
          alliesEnoughSpace: 0,
          opponentsEnoughSpace: 0,
          kills: 0,
          deaths: 1,
          enemyH2HRisk: 0,
          allyH2HRisk: 0,
          gotoProgress: 0,
          nearProgress: 0,
          aggression: 0,
          trapped: 0   // death is already captured by deaths:1; avoid double-penalizing
        },
        territoryCells: new Map()
      };
    }
    
    // Build graph and run single-pass multi-source BFS
    const graph = new BoardGraph(gameState, this.graphConfig);
    const bfs = new MultiSourceBFS(graph);
    
    // Prepare BFS sources
    const simulatedSnakeIds = ctx?.simulatedSnakeIds;
    const sources: BFSSource[] = board.snakes
      .filter((s: Snake) => s.health > 0)
      .map((s: Snake) => ({
        id: s.id,
        position: s.head,
        isTeam: teamSnakeIds.has(s.id),
        startDelay: simulatedSnakeIds ? (simulatedSnakeIds.has(s.id) ? 1 : 0) : 0
      }));
    
    // Run the single-pass BFS with optimistic passability
    // Territory calculations always use optimistic mode (body segments disappear over time)
    const bfsResult = bfs.compute(
      sources,
      board.food,
      { optimistic: true, collectCells: ctx?.collectTerritory ?? true },
      board.fertileTiles
    );
    
    // Calculate team and enemy lengths
    let teamLength = 0;
    let enemyLength = 0;
    for (const snake of board.snakes) {
      if (snake.health <= 0) continue;
      
      if (teamSnakeIds.has(snake.id)) {
        teamLength += snake.length;
      } else {
        enemyLength += snake.length;
      }
    }
    
    // Check if we just ate food (our head is where food was in previous state).
    // prevFoodSet crosses turn/graph boundaries, so it stays "x,y"-keyed.
    const justAte = !!ctx?.prevFoodSet?.has(`${ourSnake.head.x},${ourSnake.head.y}`);
    
    // Check if we're currently on a food cell (about to eat it)
    const onFoodNow = board.food.some((f: Coord) => 
      f.x === ourSnake.head.x && f.y === ourSnake.head.y
    );
    
    // Get food distance from BFS result
    let foodDistance: number;
    if (onFoodNow || justAte) {
      foodDistance = 0; // Currently on food or just ate from previous state
    } else {
      foodDistance = bfsResult.nearestFoodDistance.get(ourSnakeId) || 1000;
    }
    
    // Calculate food eaten reward (1 if just ate or about to eat, 0 otherwise)
    const foodEaten = (justAte || onFoodNow) ? 1 : 0;
    
    // Calculate food proximity using normalized linear formula: (boardSize - distance) / boardSize
    // This provides smooth attraction to food in range [0, 1] without the harsh 1/distance curve
    // When eating or about to eat, proximity is zeroed so foodEaten reward dominates
    const boardSize = Math.max(board.width, board.height);
    let foodProximity: number;
    if (foodDistance >= 1000) {
      foodProximity = 0; // No reachable food
    } else if (justAte || onFoodNow) {
      foodProximity = 0; // When eating/about to eat, proximity is zeroed so foodEaten reward dominates
    } else {
      // Normalized linear proximity: ranges from 0 (far) to 1 (adjacent)
      foodProximity = Math.max(0, (boardSize - foodDistance) / boardSize);
    }
    
    // Calculate edge penalty: -1 if on edge, 0 otherwise
    const edgePenalty = this.calculateEdgePenalty(ourSnake.head, board.width, board.height);

    // Ally / opponent "has enough space" derived from the Voronoi result we
    // already computed, instead of a whole-board flood fill per snake (which
    // was 54% of every evaluation for a ±1 signal). Won territory is a LOWER
    // bound on a snake's reachable space — the cells it gets to before anyone
    // else — so `territory >= max(3, length/2)` is a conservative "has room"
    // proxy mirroring the old tail-chase threshold. Our own survival tier
    // below keeps the full flood-fill treatment.
    const spaceScores = this.spaceScoresFromTerritory(bfsResult, board.snakes, ourSnakeId, teamSnakeIds);

    // SURVIVAL TIER (contest-aware, conservative clearance): flood only the cells
    // we win the Voronoi arrival race for, from our post-move head, under
    // conservative body-clearance timing. This is what we bank our survival on —
    // it refuses to count room an enemy will reach first.
    // Our snake is always a live BFS source here (the dead case returned above).
    const ourSourceIdx = bfsResult.sourceIndexOf.get(ourSnakeId)!;
    const contestRegion = this.computeContestAwareRegion(graph, ourSnake, bfsResult.ownerIndex, ourSourceIdx);
    // Continuous survival room from the contest-aware conservative region: the raw
    // parity-bounded longest simple path we can keep out of contest, sqrt-scaled and
    // length-normalised (see selfSpaceScore) so that room exactly equal to our body
    // length scores 1.0 (the survival threshold), 4× length → 2.0, ¼ length → 0.5.
    // Sub-linear but strictly increasing, so more room is always preferred and
    // "plenty" stays interpretable instead of saturating to a near-constant.
    const conservativeRoom = Math.min(contestRegion.reachableCount, contestRegion.parityBound);
    const selfSpace = this.selfSpaceScore(conservativeRoom, ourSnake.length);

    // Optimistic reachable region drives only the hard "trapped" survival signal.
    const ourOptimisticRegion = this.computeReachableRegion(graph, ourSnake, 'optimistic');
    // Trapped: a clearly-fatal pocket. We are NOT trapped if we can reach our own
    // tail (tail-chase survives forever). Otherwise we must confirm a real escape:
    //  - The parity/area figure (optimisticRoom) is an UPPER bound. If it's already
    //    below our length, no body-length path can exist -> trapped (cheap early-out).
    //  - If it's large enough that a path MIGHT fit, that bound over-counts dead-end
    //    pockets ("fits but no return journey"), so we confirm constructively with a
    //    Warnsdorff greedy walk (a longest-path LOWER bound). Not trapped only if the
    //    walk actually reaches body length (or stumbles onto the tail).
    const optimisticRoom = Math.min(ourOptimisticRegion.reachableCount, ourOptimisticRegion.parityBound);
    let trapped: number;
    if (ourOptimisticRegion.tailReachable) {
      trapped = 0;
    } else if (optimisticRoom < ourSnake.length) {
      trapped = 1;
    } else {
      const walk = this.greedyLongestWalk(graph, ourSnake, 'optimistic', ourSnake.length);
      trapped = (walk.tailReached || walk.walkLength >= ourSnake.length) ? 0 : 1;
    }
    
    // User-directed waypoint progress (centaur play mode). NOT derived here:
    // the stat belongs to the candidate MOVE, so the decision engine computes
    // it once per move from the pre-move board (shared waypoint pathfinder) and
    // injects it. 0 when no waypoint is set.
    const gotoProgress = ctx?.waypointProgress?.gotoProgress ?? 0;
    const nearProgress = ctx?.waypointProgress?.nearProgress ?? 0;

    // Calculate offensive aggression toward enemies we strictly out-invulnerate
    const aggression = this.calculateAggression(ourSnake, board.snakes, teamSnakeIds, board.width, board.height);
    
    return {
      stats: {
        myLength: ourSnake.length,
        myTerritory: bfsResult.territoryCounts.get(ourSnakeId) || 0,
        myControlledFood: bfsResult.controlledFood.get(ourSnakeId) || 0,
        myControlledFertile: bfsResult.controlledFertile.get(ourSnakeId) || 0,
        teamLength,
        teamTerritory: bfsResult.teamTerritory,
        teamControlledFood: bfsResult.teamControlledFood,
        foodDistance,  // Raw unweighted distance
        foodProximity, // Normalized [0,1]: (boardSize - distance)/boardSize, 0 if eating
        foodEaten,     // 1 if eating (justAte or onFoodNow), 0 otherwise
        enemyTerritory: bfsResult.enemyTerritory,
        enemyLength,
        edgePenalty,   // -1 if on edge, 0 otherwise
        selfSpace,             // Continuous contest-aware survival room (sqrt; room == length → 1.0)
        alliesEnoughSpace: spaceScores.allies,
        opponentsEnoughSpace: spaceScores.opponents,
        kills: 0,  // Would need before/after comparison to calculate
        deaths: isDead ? 1 : 0,
        enemyH2HRisk: ctx?.h2hRisk?.enemyH2HRisk ?? 0,  // From context, 1 if h2h risk with enemy
        allyH2HRisk: ctx?.h2hRisk?.allyH2HRisk ?? 0,    // From context, 1 if h2h risk with ally
        gotoProgress,
        nearProgress,
        aggression,
        trapped
      },
      territoryCells: bfsResult.territoryCells
    };
  }
  
  /**
   * Offensive aggression heuristic. Rewards a candidate position for closing in
   * on (or landing on) the head/body of any enemy we are STRICTLY more invulnerable
   * than. When our invulnerability is equal to or lower than an enemy's, that enemy
   * contributes nothing (normal length-based logic applies elsewhere). Allies are
   * never targeted.
   *
   * Per huntable enemy: closeness = max(0, (boardSize - manhattanToNearestCell)/boardSize)
   * in [0,1], plus a +1 contact bonus when we land directly on their head/body
   * (distance 0 — only possible because we out-invulnerate and can sever them).
   * We take the strongest signal (the best/closest target) so the reward stays
   * bounded in [0, 2] regardless of how many weak enemies are around.
   */
  private calculateAggression(
    ourSnake: Snake,
    allSnakes: Snake[],
    teamSnakeIds: Set<string>,
    width: number,
    height: number
  ): number {
    const ourInvulnerability = ourSnake.invulnerabilityLevel ?? 0;
    const head = ourSnake.head;
    const boardSize = Math.max(width, height);
    let best = 0;
    
    for (const enemy of allSnakes) {
      if (enemy.id === ourSnake.id) continue;
      if (enemy.health <= 0) continue;
      if (teamSnakeIds.has(enemy.id)) continue;                       // never hunt allies
      if (ourInvulnerability <= (enemy.invulnerabilityLevel ?? 0)) continue; // only strictly more invulnerable
      
      // Manhattan distance to the nearest cell of the enemy's head/body
      let minDist = Infinity;
      for (const segment of enemy.body) {
        const d = Math.abs(head.x - segment.x) + Math.abs(head.y - segment.y);
        if (d < minDist) minDist = d;
      }
      if (minDist === Infinity) continue;
      
      const closeness = Math.max(0, (boardSize - minDist) / boardSize);
      const contactBonus = minDist === 0 ? 1 : 0; // landed on their head/body → kill/sever
      const reward = closeness + contactBonus;
      if (reward > best) best = reward;
    }
    
    return best;
  }
  
  /**
   * Calculate edge penalty: returns -1 if head is on board edge, 0 otherwise.
   */
  private calculateEdgePenalty(head: Coord, width: number, height: number): number {
    const isOnEdge = head.x === 0 || head.x === width - 1 || 
                     head.y === 0 || head.y === height - 1;
    return isOnEdge ? -1 : 0;
  }
  
  /**
   * Ally / opponent "has enough space" from the shared Voronoi result — no
   * per-snake flood fills. A snake's won territory is a LOWER bound on its
   * reachable space (cells it reaches strictly before every other snake), so
   * territory >= max(3, floor(length / 2)) is a conservative proxy for the old
   * flood-fill rule (which accepted tail-chase room of half the body length).
   * ±1 per snake, matching the old flat tier. Our own snake's score is NOT
   * taken from here — the contest-aware survival tier handles it properly.
   */
  private spaceScoresFromTerritory(
    bfsResult: BFSResult,
    allSnakes: Snake[],
    ourSnakeId: string,
    teamSnakeIds: Set<string>
  ): { allies: number; opponents: number } {
    let alliesScore = 0;
    let opponentsScore = 0;

    for (const snake of allSnakes) {
      if (snake.health <= 0 || snake.id === ourSnakeId) continue;
      const territory = bfsResult.territoryCounts.get(snake.id) ?? 0;
      const hasEnough = territory >= Math.max(3, Math.floor(snake.length / 2));
      const score = hasEnough ? 1 : -1;
      if (teamSnakeIds.has(snake.id)) alliesScore += score;
      else opponentsScore += score;
    }

    return { allies: alliesScore, opponents: opponentsScore };
  }

  // Lazily-sized scratch buffers for the integer flood fills below. The
  // epoch-stamp trick makes "visited" reset O(1) per flood instead of O(cells).
  private scratchCells = 0;
  private visitStamp: Int32Array = new Int32Array(0);
  private floodQueue: Int32Array = new Int32Array(0);
  private stamp = 0;

  private ensureScratch(cells: number): void {
    if (this.scratchCells < cells) {
      this.scratchCells = cells;
      this.visitStamp = new Int32Array(cells);
      this.floodQueue = new Int32Array(cells);
      this.stamp = 0;
    }
  }

  /**
   * Flood-fill the cells reachable by a snake from its head, using the shared
   * BoardGraph snake-relative passability (single source of truth). Returns the
   * data needed for survival reasoning:
   *  - reachableCount: number of reachable cells INCLUDING the head;
   *  - tailReachable: whether the snake's own tail cell is reachable (tail-chase);
   *  - parityBound: checkerboard upper bound on the longest simple path through the
   *    reachable region: 2 * min(white, black) + 1. A snake alternates cell colors
   *    each step, so no simple path can exceed this. This is what prevents the
   *    optimistic flood-fill from over-counting a 1-wide dead-end corridor as
   *    survivable space.
   *
   * Integer-indexed core; optionally restricted to a won-cell mask (the
   * contest-aware region) via `restrictOwner`/`restrictIdx`.
   *
   * @param clearance - body-segment clearance model: cells are passable once
   *                     they have receded by the BFS arrival turn under this mode.
   */
  private computeReachableRegion(
    graph: BoardGraph,
    snake: Snake,
    clearance: ClearanceMode,
    restrictOwner?: Int16Array,
    restrictIdx?: number
  ): { reachableCount: number; tailReachable: boolean; parityBound: number } {
    const pass = graph.passabilityIdxFor(snake.id, { clearance });
    const W = graph.boardWidth;
    const N = graph.cellCount;
    this.ensureScratch(N);
    const visit = this.visitStamp;
    const queue = this.floodQueue;
    const stamp = ++this.stamp;

    const startIdx = graph.cellIndexOf(snake.head);
    visit[startIdx] = stamp;
    queue[0] = startIdx;
    let levelStart = 0;
    let levelEnd = 1;

    let reachableCount = 1; // head occupies a cell
    let tailReachable = false;
    let white = (snake.head.x + snake.head.y) % 2 === 0 ? 1 : 0;
    let black = 1 - white;
    let arrivalTurn = 1;

    while (levelStart < levelEnd) {
      let nextEnd = levelEnd;
      for (let q = levelStart; q < levelEnd; q++) {
        const cur = queue[q];
        const x = cur % W;
        const n0 = cur + W < N ? cur + W : -1;
        const n1 = cur - W >= 0 ? cur - W : -1;
        const n2 = x > 0 ? cur - 1 : -1;
        const n3 = x < W - 1 ? cur + 1 : -1;
        for (let t = 0; t < 4; t++) {
          const n = t === 0 ? n0 : t === 1 ? n1 : t === 2 ? n2 : n3;
          if (n < 0 || visit[n] === stamp) continue;
          // Contest-aware restriction: expansion limited to cells we win the
          // Voronoi arrival race for; the tail cell is always allowed
          // (tail-chase survival).
          if (restrictOwner && restrictOwner[n] !== restrictIdx && n !== pass.tailIdx) continue;
          if (!pass.passableIdx(n, arrivalTurn)) continue;

          visit[n] = stamp;
          reachableCount++;
          const nx = n % W;
          const ny = (n - nx) / W;
          if ((nx + ny) % 2 === 0) white++; else black++;
          if (n === pass.tailIdx) tailReachable = true;
          queue[nextEnd++] = n;
        }
      }
      levelStart = levelEnd;
      levelEnd = nextEnd;
      arrivalTurn++;
    }

    const parityBound = 2 * Math.min(white, black) + 1;
    return { reachableCount, tailReachable, parityBound };
  }

  /**
   * Constructive longest-path LOWER bound via a Warnsdorff-ordered greedy walk.
   *
   * The parity/area figures from computeReachableRegion are UPPER bounds: they say
   * how long a survival path *could* be, not that one *exists*. That over-counts a
   * dead-end pocket you fit into but can't escape ("no return journey"). This walk
   * instead builds a single real, non-revisiting path from the head — at each step
   * moving to the passable, unvisited neighbour with the FEWEST onward free
   * neighbours (Warnsdorff's rule, the classic near-optimal Hamiltonian-path
   * heuristic) — so the number of steps it achieves is a guaranteed lower bound on
   * the survivable move count. A simple path of length >= our body length is a
   * sufficient survival guarantee: our body fits along it and our tail keeps
   * vacating cells behind us.
   *
   * Uses the same time-aware `passabilityFor` as the trapped signal, so body
   * segments that recede by the arrival turn are walkable. Visited cells are
   * treated as our own trail (a simple path). Capped at `cap` steps since callers
   * only need to know whether the walk reaches the survival threshold.
   */
  private greedyLongestWalk(
    graph: BoardGraph,
    snake: Snake,
    clearance: ClearanceMode,
    cap: number
  ): { walkLength: number; tailReached: boolean } {
    const pass = graph.passabilityIdxFor(snake.id, { clearance });
    const W = graph.boardWidth;
    const N = graph.cellCount;
    this.ensureScratch(N);
    const visit = this.visitStamp;
    const stamp = ++this.stamp;

    const neighborsOf = (c: number, out: number[]): number => {
      const x = c % W;
      let count = 0;
      if (c + W < N) out[count++] = c + W;
      if (c - W >= 0) out[count++] = c - W;
      if (x > 0) out[count++] = c - 1;
      if (x < W - 1) out[count++] = c + 1;
      return count;
    };
    const candBuf = [0, 0, 0, 0];
    const degBuf = [0, 0, 0, 0];

    let current = graph.cellIndexOf(snake.head);
    visit[current] = stamp;
    let steps = 0;
    let tailReached = false;

    while (steps < cap) {
      const arrivalTurn = steps + 1;
      const nCount = neighborsOf(current, candBuf);
      let candidates = 0;
      for (let i = 0; i < nCount; i++) {
        const n = candBuf[i];
        if (visit[n] === stamp) continue;
        if (!pass.passableIdx(n, arrivalTurn)) continue;
        candBuf[candidates++] = n;
      }
      if (candidates === 0) break;

      // Warnsdorff: step to the most-constrained neighbour (fewest onward free
      // cells). Tie-break: LOWEST cell index. The old string-key tie-break
      // ordered lexicographically ("10,2" < "9,2"), which was itself arbitrary;
      // numeric order keeps determinism with a simpler rule.
      let best = -1;
      let bestDegree = Infinity;
      const nextArrival = arrivalTurn + 1;
      for (let i = 0; i < candidates; i++) {
        const cand = candBuf[i];
        const dCount = neighborsOf(cand, degBuf);
        let degree = 0;
        for (let j = 0; j < dCount; j++) {
          const nn = degBuf[j];
          if (nn === cand || nn === current || visit[nn] === stamp) continue;
          if (pass.passableIdx(nn, nextArrival)) degree++;
        }
        if (degree < bestDegree || (degree === bestDegree && (best === -1 || cand < best))) {
          bestDegree = degree;
          best = cand;
        }
      }
      if (best === -1) break;

      visit[best] = stamp;
      if (best === pass.tailIdx) tailReached = true;
      current = best;
      steps++;
    }

    return { walkLength: steps, tailReached };
  }

  /**
   * Contest-aware survival region. Flood-fills from our snake's (post-move) head
   * under CONSERVATIVE body-segment clearance, but restricted to the set of cells
   * we actually win the Voronoi arrival race for (the multi-source BFS owner
   * array). This is the survival room we can bank on: it refuses to count
   * space an opponent would reach first, and it refuses to bank on bodies vacating
   * on optimistic timing.
   *
   * The head cell is always included as the flood origin, and the tail cell is
   * allowed even when not won (tail-chase survival).
   */
  private computeContestAwareRegion(
    graph: BoardGraph,
    snake: Snake,
    ownerIndex: Int16Array,
    ourSourceIdx: number
  ): { reachableCount: number; tailReachable: boolean; parityBound: number } {
    return this.computeReachableRegion(graph, snake, 'conservative', ownerIndex, ourSourceIdx);
  }

  /**
   * Continuous space score. Normalises the raw parity-bounded reachable room by
   * snake length and takes the square root, so that room exactly equal to our body
   * length scores 1.0 (the survival threshold), 4× length → 2.0, ¼ length → 0.5.
   * Sub-linear (diminishing returns) but strictly increasing, so more room is always
   * preferred and "plenty" stays interpretable instead of saturating to a constant.
   */
  private selfSpaceScore(room: number, snakeLength: number): number {
    if (snakeLength <= 0) return 0;
    return Math.sqrt(Math.max(0, room) / snakeLength);
  }
  
  /**
   * Calculate weighted scores for each heuristic.
   */
  private calculateWeightedScores(stats: HeuristicStats): WeightedScores {
    return {
      myLengthScore: stats.myLength * this.weights.myLength,
      myTerritoryScore: stats.myTerritory * this.weights.myTerritory,
      myControlledFoodScore: stats.myControlledFood * this.weights.myControlledFood,
      myControlledFertileScore: stats.myControlledFertile * this.weights.myControlledFertile,
      teamLengthScore: stats.teamLength * this.weights.teamLength,
      teamTerritoryScore: stats.teamTerritory * this.weights.teamTerritory,
      teamControlledFoodScore: stats.teamControlledFood * this.weights.teamControlledFood,
      foodProximityScore: stats.foodProximity * this.weights.foodProximity,
      foodEatenScore: stats.foodEaten * this.weights.foodEaten,
      enemyTerritoryScore: stats.enemyTerritory * this.weights.enemyTerritory,
      enemyLengthScore: stats.enemyLength * this.weights.enemyLength,
      edgePenaltyScore: stats.edgePenalty * this.weights.edgePenalty,
      selfSpaceScore: stats.selfSpace * this.weights.selfSpace,
      alliesEnoughSpaceScore: stats.alliesEnoughSpace * this.weights.alliesEnoughSpace,
      opponentsEnoughSpaceScore: stats.opponentsEnoughSpace * this.weights.opponentsEnoughSpace,
      killsScore: stats.kills * this.weights.kills,
      deathsScore: stats.deaths * this.weights.deaths,
      enemyH2HRiskScore: stats.enemyH2HRisk * this.weights.enemyH2HRisk,
      allyH2HRiskScore: stats.allyH2HRisk * this.weights.allyH2HRisk,
      gotoProgressScore: stats.gotoProgress * this.weights.gotoProgress,
      nearProgressScore: stats.nearProgress * this.weights.nearProgress,
      aggressionScore: stats.aggression * this.weights.aggression,
      trappedScore: stats.trapped * this.weights.trapped
    };
  }
  
  /**
   * Calculate total score from weighted scores.
   */
  private calculateTotalScore(weighted: WeightedScores): number {
    return weighted.myLengthScore +
           weighted.myTerritoryScore +
           weighted.myControlledFoodScore +
           weighted.myControlledFertileScore +
           weighted.teamLengthScore +
           weighted.teamTerritoryScore +
           weighted.teamControlledFoodScore +
           weighted.foodProximityScore +
           weighted.foodEatenScore +
           weighted.enemyTerritoryScore +
           weighted.enemyLengthScore +
           weighted.edgePenaltyScore +
           weighted.selfSpaceScore +
           weighted.alliesEnoughSpaceScore +
           weighted.opponentsEnoughSpaceScore +
           weighted.killsScore +
           weighted.deathsScore +
           weighted.enemyH2HRiskScore +
           weighted.allyH2HRiskScore +
           weighted.gotoProgressScore +
           weighted.nearProgressScore +
           weighted.aggressionScore +
           weighted.trappedScore;
  }
}