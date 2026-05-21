/**
 * Unified board evaluator that provides a single scoring function for board states.
 * Returns both a score and structured statistics for each heuristic.
 * Now uses single-pass multi-source BFS for O(W×H) complexity.
 */

import { GameState, Snake, Coord } from '../types/battlesnake';
import { BoardGraph, BoardGraphConfig } from './board-graph';
import { MultiSourceBFS, BFSSource } from './multi-source-bfs';

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
  selfEnoughSpace: number;    // Space score for our snake: 3 if enough space, -3 if not
  selfSpaceOptimistic: number; // Space score using optimistic passability (body segments disappear over time)
  alliesEnoughSpace: number;  // Sum of space scores for allied snakes
  opponentsEnoughSpace: number; // Sum of space scores for opponent snakes
  
  // Life/death tracking
  kills: number;              // Number of enemy snakes that died
  deaths: number;             // Number of team snakes that died (including self)
  
  // Head-to-head risk tracking
  enemyH2HRisk: number;       // 1 if move has h2h risk with enemy, 0 otherwise
  allyH2HRisk: number;        // 1 if move has h2h risk with ally, 0 otherwise
  
  // User-directed waypoint heuristics (0 when no waypoint is set for this snake)
  waypointGoto: number;       // Green waypoint: closeness [0,1] + bonus 1 when on target → [0, 2]
  waypointNear: number;       // Blue waypoint: closeness [0,1] + reachability (+0 reachable, -1 cut off) → [-1, 1]

  // Tight-space survival heuristics
  connectivityPenalty: number;  // Number of cells stranded by entering an articulation point (0 = none stranded)
  tightSpaceScore: number;      // Bounded longest-path-in-region approximation; only nonzero when tight, else 0
  tailReachable: number;        // 1 if own tail is reachable (optimistic passability) within snake length, else 0
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

export interface WaypointContext {
  type: 'green' | 'blue';
  x: number;
  y: number;
}

export interface EvaluationContext {
  prevFoodSet?: Set<string>;  // Food positions from previous board state
  optimistic?: boolean;       // Use optimistic passability for body segments
  h2hRisk?: H2HRiskContext;   // Head-to-head risk info for the move being evaluated
  simulatedSnakeIds?: Set<string>;  // Snake IDs that were simulated (already moved) - get startDelay: 1
  waypoint?: WaypointContext | null;  // User-directed waypoint for our snake (centaur play mode)
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
  selfEnoughSpace: number;    // Weight for our snake's space score
  selfSpaceOptimistic: number; // Weight for optimistic space score
  alliesEnoughSpace: number;  // Weight for allies' space scores
  opponentsEnoughSpace: number; // Weight for opponents' space scores (negative to encourage trapping)
  
  // Life/death weights
  kills: number;
  deaths: number;
  
  // Head-to-head risk weights
  enemyH2HRisk: number;       // Penalty for h2h risk with enemy
  allyH2HRisk: number;        // Penalty for h2h risk with ally
  
  // Waypoint weights
  waypointGoto: number;
  waypointNear: number;

  // Tight-space survival weights
  connectivityPenalty: number;  // Weight applied to stranded cell count (typically negative)
  tightSpaceScore: number;      // Weight applied to longest-path-in-region approximation
  tailReachable: number;        // Weight applied to tail-reachable bonus (1/0)
  tightSpaceThreshold: number;  // Reachable < length*threshold gates tightSpaceScore + tailReachable
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
  selfEnoughSpaceScore: number;    // Weighted our snake's space score
  selfSpaceOptimisticScore: number; // Weighted optimistic space score
  alliesEnoughSpaceScore: number;  // Weighted allies' space scores
  opponentsEnoughSpaceScore: number; // Weighted opponents' space scores
  
  // Life/death weighted scores
  killsScore: number;
  deathsScore: number;
  
  // Head-to-head risk weighted scores
  enemyH2HRiskScore: number;
  allyH2HRiskScore: number;
  
  // Waypoint weighted scores
  waypointGotoScore: number;
  waypointNearScore: number;

  // Tight-space survival weighted scores
  connectivityPenaltyScore: number;
  tightSpaceScoreScore: number;
  tailReachableScore: number;
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
      selfEnoughSpace: 10.0,    // Weight for our snake's space availability
      selfSpaceOptimistic: 5.0, // Weight for optimistic space availability
      alliesEnoughSpace: 5.0,   // Weight for allies having space (positive = good teamwork)
      opponentsEnoughSpace: -5.0, // Weight for opponents having space (negative = encourage trapping)
      
      // Life/death weights
      kills: 0,                 // Currently not used but tracked
      deaths: -500,             // Heavy penalty for death
      
      // Head-to-head risk weights
      enemyH2HRisk: -100,       // Penalty for h2h risk with enemy
      allyH2HRisk: -50,         // Penalty for h2h risk with ally
      
      // Waypoint weights (only active when a waypoint is set)
      waypointGoto: 2500,       // Strong pull toward green waypoint (utmost priority after survival)
      waypointNear: 2000,       // Pull toward blue waypoint + path-open bonus

      // Tight-space survival weights
      connectivityPenalty: -20,    // Each stranded cell hurts a lot
      tightSpaceScore: 30,         // Reward longest-path approximation when tight
      tailReachable: 100,          // Strong bonus for being able to tail-chase
      tightSpaceThreshold: 2.0,    // tight when reachable < snakeLength * threshold
      
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
          selfEnoughSpace: -3,
          selfSpaceOptimistic: -3,
          alliesEnoughSpace: 0,
          opponentsEnoughSpace: 0,
          kills: 0,
          deaths: 1,
          enemyH2HRisk: 0,
          allyH2HRisk: 0,
          waypointGoto: 0,
          waypointNear: 0,
          connectivityPenalty: 0,
          tightSpaceScore: 0,
          tailReachable: 0
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
    
    // Calculate enhanced space detection for all snakes (conservative mode)
    const spaceScores = this.calculateAllSnakeSpaces(graph, board.snakes, ourSnakeId, teamSnakeIds, board.width, board.height, false);
    
    // Calculate optimistic self space separately (always uses optimistic=true)
    const selfSpaceOptimistic = this.calculateSnakeSpace(graph, ourSnake, board.snakes, board.width, board.height, true);
    
    // Calculate user-directed waypoint heuristics (centaur play mode)
    const { waypointGoto, waypointNear } = this.calculateWaypointStats(
      graph, ourSnake, board.snakes, ctx?.waypoint ?? null, board.width, board.height
    );

    // Calculate tight-space survival metrics (connectivity, longest path, tail reachable)
    const tightMetrics = this.calculateTightSpaceMetrics(graph, ourSnake, board.snakes);
    
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
        selfEnoughSpace: spaceScores.self,
        selfSpaceOptimistic,  // Optimistic space (body segments disappear over time)
        alliesEnoughSpace: spaceScores.allies,
        opponentsEnoughSpace: spaceScores.opponents,
        kills: 0,  // Would need before/after comparison to calculate
        deaths: isDead ? 1 : 0,
        enemyH2HRisk: ctx?.h2hRisk?.enemyH2HRisk ?? 0,  // From context, 1 if h2h risk with enemy
        allyH2HRisk: ctx?.h2hRisk?.allyH2HRisk ?? 0,    // From context, 1 if h2h risk with ally
        waypointGoto,
        waypointNear,
        connectivityPenalty: tightMetrics.stranded,
        tightSpaceScore: tightMetrics.tightSpaceScore,
        tailReachable: tightMetrics.tailReachable
      },
      territoryCells: bfsResult.territoryCells
    };
  }
  
  /**
   * Calculate the two waypoint heuristics for a user-set waypoint.
   * Returns 0 for both if no waypoint is set.
   *
   * Green (goto): closeness [0,1] + flat +1 bonus when head is exactly on the waypoint.
   *   Range [0, 2]. With weight 150 the max contribution is +300, well below the
   *   deaths penalty (-500), so the snake will never willingly die for a waypoint.
   *
   * Blue (near): closeness [0,1] PLUS a path-openness term — small BFS from the
   *   new head; if the waypoint is reachable we add 0, if it isn't we add -1.
   *   This penalises moves that cut the snake off from the waypoint, encouraging
   *   "stay near AND keep the path open" behaviour the user asked for.
   */
  private calculateWaypointStats(
    graph: BoardGraph,
    ourSnake: Snake,
    allSnakes: Snake[],
    waypoint: WaypointContext | null | undefined,
    width: number,
    height: number
  ): { waypointGoto: number; waypointNear: number } {
    if (!waypoint) return { waypointGoto: 0, waypointNear: 0 };
    if (waypoint.x < 0 || waypoint.x >= width || waypoint.y < 0 || waypoint.y >= height) {
      return { waypointGoto: 0, waypointNear: 0 };
    }
    
    const head = ourSnake.head;
    const distance = Math.abs(head.x - waypoint.x) + Math.abs(head.y - waypoint.y);
    const boardSize = Math.max(width, height);
    const closeness = Math.max(0, (boardSize - distance) / boardSize);
    const onTarget = head.x === waypoint.x && head.y === waypoint.y;
    
    if (waypoint.type === 'green') {
      // Goto: head on the cell is the goal. Give a big flat bonus on arrival,
      // otherwise closeness pulls us in.
      return {
        waypointGoto: onTarget ? 2 : closeness,
        waypointNear: 0
      };
    }
    
    // Blue: "be near, keep the path open". Closeness + reachability penalty.
    const reachable = onTarget || this.isCellReachableFrom(graph, head, waypoint, allSnakes, ourSnake);
    return {
      waypointGoto: 0,
      waypointNear: closeness + (reachable ? 0 : -1)
    };
  }
  
  /**
   * Small BFS from `start` checking whether `target` is reachable, treating
   * our own body (except tail) as blocked and using optimistic passability for
   * everyone else. Bounded so it can't blow up on big empty boards.
   */
  private isCellReachableFrom(
    graph: BoardGraph,
    start: Coord,
    target: Coord,
    allSnakes: Snake[],
    ourSnake: Snake
  ): boolean {
    const targetKey = graph.coordToKey(target);
    
    // Our own body (except tail) blocks reachability
    const ownBody = new Set<string>();
    for (let i = 0; i < ourSnake.body.length - 1; i++) {
      ownBody.add(graph.coordToKey(ourSnake.body[i]));
    }
    
    const visited = new Set<string>();
    visited.add(graph.coordToKey(start));
    let level: Coord[] = [start];
    let turn = 0;
    const maxCells = 400;  // cap work — board is at most ~19x19 → 361 cells
    
    while (level.length > 0 && visited.size < maxCells) {
      const next: Coord[] = [];
      turn++;
      for (const cur of level) {
        const neighbors: Coord[] = [
          { x: cur.x, y: cur.y + 1 },
          { x: cur.x, y: cur.y - 1 },
          { x: cur.x - 1, y: cur.y },
          { x: cur.x + 1, y: cur.y },
        ];
        for (const n of neighbors) {
          if (!graph.isInBounds(n)) continue;
          const k = graph.coordToKey(n);
          if (visited.has(k)) continue;
          if (k === targetKey) return true;  // reached
          if (ownBody.has(k)) continue;
          if (!graph.isPassableAtTurn(n, turn)) continue;
          visited.add(k);
          next.push(n);
        }
      }
      level = next;
    }
    return false;
  }

  /**
   * Compute tight-space survival metrics for our snake from its current head position.
   *
   * Returns:
   *  - stranded: number of cells stranded by the snake's head being an articulation point
   *              of the optimistically-reachable region (sum of all components reachable
   *              from a head-neighbor EXCEPT the largest such component).
   *  - tightSpaceScore: bounded longest-path-in-region approximation, only nonzero when
   *                     reachable < snakeLength * tightSpaceThreshold. Uses checkerboard
   *                     parity bound (2*min(white,black)+1) intersected with a bounded
   *                     wall-hugging DFS for refinement.
   *  - tailReachable: 1 if our own tail cell is reachable under optimistic passability
   *                   within `snakeLength` turns, gated by the same tight-space threshold.
   */
  private calculateTightSpaceMetrics(
    graph: BoardGraph,
    ourSnake: Snake,
    allSnakes: Snake[]
  ): { stranded: number; tightSpaceScore: number; tailReachable: number } {
    const head = ourSnake.head;
    const snakeLength = ourSnake.length;
    const tailKey = graph.coordToKey(ourSnake.body[ourSnake.body.length - 1]);
    const headKey = graph.coordToKey(head);
    
    // Block other snakes' tails (we can chase our own tail, not others')
    const ourInvulnerability = ourSnake.invulnerabilityLevel ?? 0;
    const otherTails = new Set<string>();
    for (const s of allSnakes) {
      if (s.health <= 0) continue;
      if (s.id === ourSnake.id) continue;
      if ((s.invulnerabilityLevel ?? 0) < ourInvulnerability) continue;
      otherTails.add(graph.coordToKey(s.body[s.body.length - 1]));
    }
    
    // Build set of our own body cells (excluding tail and head); we never walk through these
    const ownBody = new Set<string>();
    for (let i = 0; i < ourSnake.body.length - 1; i++) {
      const k = graph.coordToKey(ourSnake.body[i]);
      if (k === headKey) continue;
      ownBody.add(k);
    }
    
    const isPassable = (coord: Coord, turn: number): boolean => {
      if (!graph.isInBounds(coord)) return false;
      const k = graph.coordToKey(coord);
      if (k === headKey) return false; // treat head as removed for reachability
      if (ownBody.has(k)) return false;
      if (otherTails.has(k)) return false;
      return graph.isPassableAtTurn(coord, turn);
    };
    
    // Step 1: identify head-neighbors (turn-1 passable from head)
    const headNeighbors: Coord[] = [
      { x: head.x, y: head.y + 1 },
      { x: head.x, y: head.y - 1 },
      { x: head.x - 1, y: head.y },
      { x: head.x + 1, y: head.y }
    ].filter(n => isPassable(n, 1));
    
    if (headNeighbors.length === 0) {
      return { stranded: 0, tightSpaceScore: 0, tailReachable: 0 };
    }
    
    // Step 2: BFS from each head-neighbor (head treated as blocked), label component ids.
    // Cells reached by multiple neighbors get the first label; we still treat components as
    // potentially overlapping (i.e. neighbors that reach each other belong to one component
    // from the snake's perspective).
    const compIdByKey = new Map<string, number>();
    const componentSizes: number[] = [];
    const componentContainsTail: boolean[] = [];
    const visitedAll = new Set<string>();
    visitedAll.add(headKey);
    
    // Union-find over component ids to merge overlapping neighbor-BFS results
    const parent: number[] = [];
    const findRoot = (i: number): number => {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    };
    const union = (a: number, b: number): void => {
      const ra = findRoot(a), rb = findRoot(b);
      if (ra !== rb) parent[ra] = rb;
    };
    
    for (const seed of headNeighbors) {
      const seedKey = graph.coordToKey(seed);
      if (compIdByKey.has(seedKey)) continue;
      
      const compId = componentSizes.length;
      componentSizes.push(0);
      componentContainsTail.push(false);
      parent.push(compId);
      
      // BFS
      const queue: { pos: Coord; turn: number }[] = [{ pos: seed, turn: 1 }];
      compIdByKey.set(seedKey, compId);
      visitedAll.add(seedKey);
      componentSizes[compId]++;
      if (seedKey === tailKey) componentContainsTail[compId] = true;
      
      while (queue.length > 0) {
        const { pos, turn } = queue.shift()!;
        const nextTurn = turn + 1;
        const neighbors: Coord[] = [
          { x: pos.x, y: pos.y + 1 },
          { x: pos.x, y: pos.y - 1 },
          { x: pos.x - 1, y: pos.y },
          { x: pos.x + 1, y: pos.y }
        ];
        for (const n of neighbors) {
          const nk = graph.coordToKey(n);
          if (!isPassable(n, nextTurn)) continue;
          const existing = compIdByKey.get(nk);
          if (existing !== undefined) {
            if (existing !== compId) union(existing, compId);
            continue;
          }
          compIdByKey.set(nk, compId);
          visitedAll.add(nk);
          componentSizes[compId]++;
          if (nk === tailKey) componentContainsTail[compId] = true;
          queue.push({ pos: n, turn: nextTurn });
        }
      }
    }
    
    // Merge sizes by union-find roots
    const rootSize = new Map<number, number>();
    const rootHasTail = new Map<number, boolean>();
    for (let i = 0; i < componentSizes.length; i++) {
      const r = findRoot(i);
      rootSize.set(r, (rootSize.get(r) ?? 0) + componentSizes[i]);
      if (componentContainsTail[i]) rootHasTail.set(r, true);
    }
    
    // Maximum component the snake could actually end up in
    let maxComponent = 0;
    let maxRoot: number | null = null;
    for (const [root, size] of rootSize) {
      if (size > maxComponent) { maxComponent = size; maxRoot = root; }
    }
    
    // Stranded cells = total reachable (excl. head) - largest component
    let totalReachable = 0;
    for (const size of rootSize.values()) totalReachable += size;
    const stranded = Math.max(0, totalReachable - maxComponent);
    
    // Tail reachable: did the largest component contain our tail?
    const tailReachableRaw = (maxRoot !== null && rootHasTail.get(maxRoot)) ? 1 : 0;
    
    // Gate tightSpaceScore + tailReachable by tight-space threshold
    const reachableIncludingHead = totalReachable + 1;
    const isTight = reachableIncludingHead < snakeLength * this.weights.tightSpaceThreshold;
    
    if (!isTight) {
      return { stranded, tightSpaceScore: 0, tailReachable: 0 };
    }
    
    // Tight-space score: parity-bounded longest path within the largest accessible region.
    // Checkerboard parity gives an upper bound: a snake alternates colors with each step,
    // so longest simple path <= 2 * min(white, black) + 1.
    let whiteCount = (head.x + head.y) % 2 === 0 ? 1 : 0;
    let blackCount = 1 - whiteCount;
    for (const [key, compId] of compIdByKey) {
      if (findRoot(compId) !== maxRoot) continue;
      const [x, y] = key.split(',').map(Number);
      if ((x + y) % 2 === 0) whiteCount++; else blackCount++;
    }
    const parityBound = 2 * Math.min(whiteCount, blackCount) + 1;
    const sizeBound = maxComponent + 1; // includes head
    const tightSpaceScore = Math.min(parityBound, sizeBound);
    
    // Tail reachable only useful when tight
    return { stranded, tightSpaceScore, tailReachable: tailReachableRaw };
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
   * @param optimistic - If true, uses optimistic passability (body segments disappear over time)
   */
  private calculateAllSnakeSpaces(graph: BoardGraph, allSnakes: Snake[], ourSnakeId: string, teamSnakeIds: Set<string>, width: number, height: number, optimistic: boolean = false): 
    { self: number; allies: number; opponents: number } {
    
    let selfScore = 0;
    let alliesScore = 0;
    let opponentsScore = 0;
    
    for (const snake of allSnakes) {
      if (snake.health <= 0) continue; // Skip dead snakes
      
      // Calculate space score for this snake
      const spaceScore = this.calculateSnakeSpace(graph, snake, allSnakes, width, height, optimistic);
      
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
   * @param optimistic - If true, uses optimistic passability where body segments
   *                     are considered passable if they will have disappeared by
   *                     the turn we reach them (using conservative disappear turn).
   */
  private calculateSnakeSpace(graph: BoardGraph, snake: Snake, allSnakes: Snake[], width: number, height: number, optimistic: boolean = false): number {
    const startPos = snake.head;
    const snakeLength = snake.length;
    const snakeTailKey = graph.coordToKey(snake.body[snake.body.length - 1]);
    
    // Build a set of cells that belong to our own snake's body (excluding tail)
    // We never want to consider our own body as passable even with optimistic mode
    const ownBodyCells = new Set<string>();
    for (let i = 0; i < snake.body.length - 1; i++) {  // Exclude tail
      ownBodyCells.add(graph.coordToKey(snake.body[i]));
    }
    
    // Build a set of other snakes' tails to block (we can chase our own tail, not others')
    // Skip tails of snakes with lower invulnerability level than ours (their bodies are passable)
    const ourInvulnerability = snake.invulnerabilityLevel ?? 0;
    const otherSnakeTails = new Set<string>();
    for (const otherSnake of allSnakes) {
      if (otherSnake.health <= 0) continue;
      if (otherSnake.id === snake.id) continue;
      // If we can sever through this snake, its tail is not an additional blocker
      if ((otherSnake.invulnerabilityLevel ?? 0) < ourInvulnerability) continue;
      const tail = otherSnake.body[otherSnake.body.length - 1];
      otherSnakeTails.add(graph.coordToKey(tail));
    }
    
    // Track visited cells with their arrival turn for level-based BFS
    const visited = new Map<string, number>();  // key -> arrivalTurn
    
    interface QueueItem {
      position: Coord;
      turn: number;
    }
    
    let currentLevel: QueueItem[] = [{ position: startPos, turn: 0 }];
    visited.set(graph.coordToKey(startPos), 0);
    
    let cellsFound = 1; // Start with 1 for the head position
    let foundOwnTail = false;
    
    while (currentLevel.length > 0) {
      const nextLevel: QueueItem[] = [];
      
      for (const { position: current, turn: currentTurn } of currentLevel) {
        const arrivalTurn = currentTurn + 1;
        
        // Get all four potential neighbors
        const neighbors: Coord[] = [
          { x: current.x, y: current.y + 1 },  // up
          { x: current.x, y: current.y - 1 },  // down
          { x: current.x - 1, y: current.y },  // left
          { x: current.x + 1, y: current.y }   // right
        ];
        
        for (const neighbor of neighbors) {
          // Check bounds using BoardGraph (single source of truth)
          if (!graph.isInBounds(neighbor)) {
            continue;
          }
          
          const neighborKey = graph.coordToKey(neighbor);
          
          // Skip if already visited
          if (visited.has(neighborKey)) continue;
          
          // Never pass through our own body (except tail check below)
          if (ownBodyCells.has(neighborKey)) continue;
          
          // Block other snakes' tails for space calculation
          if (otherSnakeTails.has(neighborKey)) continue;
          
          // Check passability - either standard or optimistic
          let isPassable: boolean;
          if (optimistic) {
            // Use optimistic passability - considers body segments passable
            // if they will have disappeared by arrivalTurn
            isPassable = graph.isPassableAtTurn(neighbor, arrivalTurn);
          } else {
            // Standard passability check
            isPassable = graph.isPassable(neighbor);
          }
          
          if (!isPassable) continue;
          
          // Mark as visited and count
          visited.set(neighborKey, arrivalTurn);
          cellsFound++;
          
          // Check if we reached our own tail
          if (neighborKey === snakeTailKey) {
            foundOwnTail = true;
          }
          
          // Continue searching from this cell
          nextLevel.push({ position: neighbor, turn: arrivalTurn });
        }
      }
      
      currentLevel = nextLevel;
    }
    
    // Base: +3 if enough space, -3 if not
    // Having enough space means EITHER:
    // 1. Can reach at least as many cells as our length
    // 2. Can reach our own tail AND have reasonable space (at least half our length)
    const hasEnoughSpace = cellsFound >= snakeLength || 
                          (foundOwnTail && cellsFound >= Math.max(3, Math.floor(snakeLength / 2)));
    const baseScore = hasEnoughSpace ? 3 : -3;
    return baseScore;
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
      selfEnoughSpaceScore: stats.selfEnoughSpace * this.weights.selfEnoughSpace,
      selfSpaceOptimisticScore: stats.selfSpaceOptimistic * this.weights.selfSpaceOptimistic,
      alliesEnoughSpaceScore: stats.alliesEnoughSpace * this.weights.alliesEnoughSpace,
      opponentsEnoughSpaceScore: stats.opponentsEnoughSpace * this.weights.opponentsEnoughSpace,
      killsScore: stats.kills * this.weights.kills,
      deathsScore: stats.deaths * this.weights.deaths,
      enemyH2HRiskScore: stats.enemyH2HRisk * this.weights.enemyH2HRisk,
      allyH2HRiskScore: stats.allyH2HRisk * this.weights.allyH2HRisk,
      waypointGotoScore: stats.waypointGoto * this.weights.waypointGoto,
      waypointNearScore: stats.waypointNear * this.weights.waypointNear,
      connectivityPenaltyScore: stats.connectivityPenalty * this.weights.connectivityPenalty,
      tightSpaceScoreScore: stats.tightSpaceScore * this.weights.tightSpaceScore,
      tailReachableScore: stats.tailReachable * this.weights.tailReachable
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
           weighted.selfEnoughSpaceScore +
           weighted.selfSpaceOptimisticScore +
           weighted.alliesEnoughSpaceScore +
           weighted.opponentsEnoughSpaceScore +
           weighted.killsScore +
           weighted.deathsScore +
           weighted.enemyH2HRiskScore +
           weighted.allyH2HRiskScore +
           weighted.waypointGotoScore +
           weighted.waypointNearScore +
           weighted.connectivityPenaltyScore +
           weighted.tightSpaceScoreScore +
           weighted.tailReachableScore;
  }
}