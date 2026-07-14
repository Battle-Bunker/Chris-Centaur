/**
 * Unified board evaluator that provides a single scoring function for board states.
 * Returns both a score and structured statistics for each heuristic.
 * Now uses single-pass multi-source BFS for O(W×H) complexity.
 */

import { GameState, Snake, Coord } from '../types/battlesnake';
import { BoardGraph, BoardGraphConfig, ClearanceMode } from './board-graph';
import { MultiSourceBFS, BFSSource } from './multi-source-bfs';
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
  // Per-move shortest-path progress stats, computed by the decision engine from
  // the shared waypoint pathfinder and injected via EvaluationContext:
  //   +1 the move is the first step of a shortest path to the target,
  //    0 sideways, -1 backward, -2 target cut off (near also: -2 landing ON it).
  gotoProgress: number;       // Green "goto" target progress ∈ [-2, 1]
  nearProgress: number;       // Blue "near" target progress ∈ [-2, 1]

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
  // Per-move waypoint progress stats for the move being evaluated (centaur play
  // mode). Computed once per candidate move in the decision engine via the
  // shared waypoint pathfinder — the evaluator just weighs them.
  waypointProgress?: WaypointProgress | null;
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
  
  // Waypoint weights: applied to the bounded per-move progress stats. High
  // enough that the optimal step toward a target outvotes ordinary positional
  // heuristics, but bounded (stat ∈ [-2, 1]) so death/trapped still dominate.
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
      
      // Waypoint weights (only active when a waypoint is set). The stat is the
      // bounded per-move shortest-path progress (optimal step = +1), so the
      // weight IS the bonus the optimal move gets. 300 outvotes food/territory
      // pulls but stays below deaths (-500) / trapped (-600), so the snake
      // follows the user's target without ever dying for it.
      gotoProgress: 300,        // Bonus for the optimal next move toward the green target
      nearProgress: 250,        // Bonus for closing on the blue target without reaching/cutting it off

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
      weights: { ...this.weights }, // Return copy of weights
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
    const bfsResult = bfs.compute(sources, board.food, { optimistic: true }, board.fertileTiles);
    
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
    
    // Check if we just ate food (our head is where food was in previous state)
    const headKey = graph.coordToKey(ourSnake.head);
    const justAte = !!ctx?.prevFoodSet?.has(headKey);
    
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
    
    // Ally / opponent space detection uses static clearance (bodies as walls).
    const spaceScores = this.calculateAllSnakeSpaces(graph, board.snakes, ourSnakeId, teamSnakeIds, 'static');

    // SURVIVAL TIER (contest-aware, conservative clearance): flood only the cells
    // we win the Voronoi arrival race for, from our post-move head, under
    // conservative body-clearance timing. This is what we bank our survival on —
    // it refuses to count room an enemy will reach first.
    const wonCells = new Set<string>(
      (bfsResult.territoryCells.get(ourSnakeId) || []).map(c => graph.coordToKey(c))
    );
    const contestRegion = this.computeContestAwareRegion(graph, ourSnake, wonCells);
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
    
    // User-directed waypoint progress stats are per-move context (like h2hRisk):
    // the decision engine computes them once per candidate move with the shared
    // waypoint pathfinder and injects them here for weighing.
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
   * Calculate enhanced space detection for all snakes
   * Returns scores for self, allies, and opponents
   * @param clearance - Body-segment clearance model to use for the flood-fill.
   */
  private calculateAllSnakeSpaces(graph: BoardGraph, allSnakes: Snake[], ourSnakeId: string, teamSnakeIds: Set<string>, clearance: ClearanceMode = 'static'): 
    { self: number; allies: number; opponents: number } {
    
    let selfScore = 0;
    let alliesScore = 0;
    let opponentsScore = 0;
    
    for (const snake of allSnakes) {
      if (snake.health <= 0) continue; // Skip dead snakes
      
      // Calculate space score for this snake
      const spaceScore = this.calculateSnakeSpace(graph, snake, clearance);
      
      // Categorize and accumulate scores
      if (snake.id === ourSnakeId) {
        selfScore = spaceScore;
      } else if (teamSnakeIds.has(snake.id)) {
        alliesScore += spaceScore;
      } else {
        opponentsScore += spaceScore;
      }
    }
    
    return { self: selfScore, allies: alliesScore, opponents: opponentsScore };
  }
  
  /**
   * Calculate space score for a single snake using floodfill.
   * Returns:
   * - 3 if enough space (can reach cells >= length OR can reach own tail)
   * - -3 if not enough space  
   * 
   * @param clearance - Body-segment clearance model used to decide when a cell
   *                     has vacated by the BFS arrival turn.
   */
  private calculateSnakeSpace(graph: BoardGraph, snake: Snake, clearance: ClearanceMode = 'static'): number {
    const region = this.computeReachableRegion(graph, snake, clearance);
    return this.spaceScoreFromRegion(region, snake.length);
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
   * @param clearance - body-segment clearance model: cells are passable once
   *                     they have receded by the BFS arrival turn under this mode.
   */
  private computeReachableRegion(
    graph: BoardGraph,
    snake: Snake,
    clearance: ClearanceMode
  ): { reachableCount: number; tailReachable: boolean; parityBound: number } {
    const pass = graph.passabilityFor(snake.id, { clearance });
    const startPos = snake.head;

    const visited = new Set<string>();
    visited.add(graph.coordToKey(startPos));

    let reachableCount = 1; // head occupies a cell
    let tailReachable = false;
    let white = (startPos.x + startPos.y) % 2 === 0 ? 1 : 0;
    let black = 1 - white;

    let currentLevel: { pos: Coord; turn: number }[] = [{ pos: startPos, turn: 0 }];

    while (currentLevel.length > 0) {
      const nextLevel: { pos: Coord; turn: number }[] = [];

      for (const { pos, turn } of currentLevel) {
        const arrivalTurn = turn + 1;
        const neighbors: Coord[] = [
          { x: pos.x, y: pos.y + 1 },
          { x: pos.x, y: pos.y - 1 },
          { x: pos.x - 1, y: pos.y },
          { x: pos.x + 1, y: pos.y }
        ];

        for (const neighbor of neighbors) {
          const key = graph.coordToKey(neighbor);
          if (visited.has(key)) continue;
          if (!pass.passable(neighbor, arrivalTurn)) continue;

          visited.add(key);
          reachableCount++;
          if ((neighbor.x + neighbor.y) % 2 === 0) white++; else black++;
          if (key === pass.tailKey) tailReachable = true;

          nextLevel.push({ pos: neighbor, turn: arrivalTurn });
        }
      }

      currentLevel = nextLevel;
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
    const pass = graph.passabilityFor(snake.id, { clearance });
    const neighborsOf = (c: Coord): Coord[] => [
      { x: c.x, y: c.y + 1 },
      { x: c.x, y: c.y - 1 },
      { x: c.x - 1, y: c.y },
      { x: c.x + 1, y: c.y }
    ];

    const visited = new Set<string>();
    visited.add(graph.coordToKey(snake.head));
    let current = snake.head;
    let steps = 0;
    let tailReached = false;

    while (steps < cap) {
      const arrivalTurn = steps + 1;
      const candidates = neighborsOf(current).filter(n => {
        const k = graph.coordToKey(n);
        if (visited.has(k)) return false;
        return pass.passable(n, arrivalTurn);
      });
      if (candidates.length === 0) break;

      // Warnsdorff: step to the most-constrained neighbour (fewest onward free
      // cells), breaking ties deterministically by cell key for reproducibility.
      let best: Coord | null = null;
      let bestDegree = Infinity;
      let bestKey = '';
      for (const cand of candidates) {
        const candKey = graph.coordToKey(cand);
        const nextArrival = arrivalTurn + 1;
        let degree = 0;
        for (const nn of neighborsOf(cand)) {
          const nk = graph.coordToKey(nn);
          if (nk === candKey || visited.has(nk)) continue;
          if (nn.x === current.x && nn.y === current.y) continue;
          if (pass.passable(nn, nextArrival)) degree++;
        }
        if (degree < bestDegree || (degree === bestDegree && candKey < bestKey)) {
          bestDegree = degree;
          best = cand;
          bestKey = candKey;
        }
      }
      if (!best) break;

      const bestK = graph.coordToKey(best);
      visited.add(bestK);
      if (bestK === pass.tailKey) tailReached = true;
      current = best;
      steps++;
    }

    return { walkLength: steps, tailReached };
  }

  /**
   * Contest-aware survival region. Flood-fills from our snake's (post-move) head
   * under CONSERVATIVE body-segment clearance, but restricted to the set of cells
   * we actually win the Voronoi arrival race for (`wonCells`, from the multi-source
   * BFS territory). This is the survival room we can bank on: it refuses to count
   * space an opponent would reach first, and it refuses to bank on bodies vacating
   * on optimistic timing.
   *
   * The head cell is always included as the flood origin even though it isn't part
   * of the won-territory set (territory excludes snake-occupied cells).
   *
   * Returns the same shape as computeReachableRegion so callers can reuse
   * spaceScoreFromRegion and the parity/tail survival reasoning.
   */
  private computeContestAwareRegion(
    graph: BoardGraph,
    snake: Snake,
    wonCells: Set<string>
  ): { reachableCount: number; tailReachable: boolean; parityBound: number } {
    const pass = graph.passabilityFor(snake.id, { clearance: 'conservative' });
    const startPos = snake.head;

    const visited = new Set<string>();
    visited.add(graph.coordToKey(startPos));

    let reachableCount = 1; // head occupies a cell
    let tailReachable = false;
    let white = (startPos.x + startPos.y) % 2 === 0 ? 1 : 0;
    let black = 1 - white;

    let currentLevel: { pos: Coord; turn: number }[] = [{ pos: startPos, turn: 0 }];

    while (currentLevel.length > 0) {
      const nextLevel: { pos: Coord; turn: number }[] = [];

      for (const { pos, turn } of currentLevel) {
        const arrivalTurn = turn + 1;
        const neighbors: Coord[] = [
          { x: pos.x, y: pos.y + 1 },
          { x: pos.x, y: pos.y - 1 },
          { x: pos.x - 1, y: pos.y },
          { x: pos.x + 1, y: pos.y }
        ];

        for (const neighbor of neighbors) {
          const key = graph.coordToKey(neighbor);
          if (visited.has(key)) continue;
          // Restrict expansion to cells we win the Voronoi contest for. The tail
          // cell is allowed even if it's not in wonCells (tail-chase survival).
          if (!wonCells.has(key) && key !== pass.tailKey) continue;
          if (!pass.passable(neighbor, arrivalTurn)) continue;

          visited.add(key);
          reachableCount++;
          if ((neighbor.x + neighbor.y) % 2 === 0) white++; else black++;
          if (key === pass.tailKey) tailReachable = true;

          nextLevel.push({ pos: neighbor, turn: arrivalTurn });
        }
      }

      currentLevel = nextLevel;
    }

    const parityBound = 2 * Math.min(white, black) + 1;
    return { reachableCount, tailReachable, parityBound };
  }

  /**
   * Map a reachable region to the coarse ±3 space score.
   * Having enough space means EITHER:
   *  1. we can chase our own tail (tail reachable) AND have reasonable room
   *     (parity-bounded longest path >= half our length), OR
   *  2. the parity-bounded longest path through the region is at least our length
   *     (enough genuine room to outlast our body without trapping ourselves).
   * Using the parity bound instead of the raw reachable count prevents a 1-wide
   * dead-end from being scored as enough space.
   */
  private spaceScoreFromRegion(
    region: { reachableCount: number; tailReachable: boolean; parityBound: number },
    snakeLength: number
  ): number {
    const longestPathBound = Math.min(region.reachableCount, region.parityBound);
    const hasEnoughSpace = region.tailReachable
      ? longestPathBound >= Math.max(3, Math.floor(snakeLength / 2))
      : longestPathBound >= snakeLength;
    return hasEnoughSpace ? 1 : -1;
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