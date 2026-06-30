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
          tailReachable: 0,
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
    
    // Calculate enhanced space detection for all snakes (conservative mode)
    const spaceScores = this.calculateAllSnakeSpaces(graph, board.snakes, ourSnakeId, teamSnakeIds, false);
    
    // Calculate the optimistic reachable region for our snake ONCE and derive both
    // the optimistic self-space score and the hard "trapped" survival signal from it.
    const ourOptimisticRegion = this.computeReachableRegion(graph, ourSnake, true);
    const selfSpaceOptimistic = this.spaceScoreFromRegion(ourOptimisticRegion, ourSnake.length);
    // Trapped: a clearly-fatal pocket. We are NOT trapped if we can reach our own
    // tail (tail-chase survives) OR the parity-bounded longest path through the
    // reachable region is at least our length (enough room to outlast our body).
    const ourLongestPathBound = Math.min(ourOptimisticRegion.reachableCount, ourOptimisticRegion.parityBound);
    const trapped = (ourOptimisticRegion.tailReachable || ourLongestPathBound >= ourSnake.length) ? 0 : 1;
    
    // Calculate user-directed waypoint heuristics (centaur play mode)
    const { waypointGoto, waypointNear } = this.calculateWaypointStats(
      graph, ourSnake, board.snakes, ctx?.waypoint ?? null, board.width, board.height
    );

    // Calculate tight-space survival metrics (connectivity, longest path, tail reachable)
    const tightMetrics = this.calculateTightSpaceMetrics(graph, ourSnake);

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
        tailReachable: tightMetrics.tailReachable,
        aggression,
        trapped
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
    const reachable = onTarget || this.isCellReachableFrom(graph, head, waypoint, ourSnake);
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
    ourSnake: Snake
  ): boolean {
    const targetKey = graph.coordToKey(target);

    // Single source of truth for our own passability (own body blocks, own tail
    // and other snakes' bodies recede under optimistic turn-aware passability).
    const pass = graph.passabilityFor(ourSnake.id, { optimistic: true });

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
          if (!pass.passable(n, turn)) continue;
          visited.add(k);
          next.push(n);
        }
      }
      level = next;
    }
    return false;
  }

  /**
   * Produce the full sequence of cells the waypoint pathfinder would follow
   * from our head to a green ("goto") waypoint, EXCLUDING the head cell. This
   * is the live "goto route" rendered on the centaur play board.
   *
   * Reuses exactly the same passability as `isCellReachableFrom` (our own body
   * except the tail blocks; everyone else uses optimistic turn-aware
   * passability), so the drawn route matches what the goto heuristic actually
   * rewards. A breadth-first search guarantees a shortest legal path, which is
   * what the closeness-driven goto heuristic pulls toward.
   *
   * Returns [] when there's no green waypoint, it's out of bounds / on the
   * head, or the target is unreachable.
   */
  computeWaypointRoute(
    gameState: GameState,
    ourSnakeId: string,
    waypoint: WaypointContext | null | undefined,
    startHead?: Coord
  ): Coord[] {
    if (!waypoint || waypoint.type !== 'green') return [];
    const board = gameState.board;
    if (waypoint.x < 0 || waypoint.x >= board.width || waypoint.y < 0 || waypoint.y >= board.height) {
      return [];
    }
    const ourSnake = board.snakes.find(s => s.id === ourSnakeId);
    if (!ourSnake) return [];
    // Path from `startHead` when supplied (the cell the snake will occupy after
    // a move it has already committed this turn) so the route — and its first
    // step — anchor where the snake will actually be, not the stale head.
    const head = startHead ?? ourSnake.head;
    if (head.x === waypoint.x && head.y === waypoint.y) return [];

    const graph = new BoardGraph(gameState);
    const targetKey = graph.coordToKey(waypoint);

    // Same passability as reachability: our own body blocks, everyone else uses
    // optimistic turn-aware passability.
    const pass = graph.passabilityFor(ourSnake.id, { optimistic: true });

    const startKey = graph.coordToKey(head);
    const parent = new Map<string, Coord>();
    const visited = new Set<string>([startKey]);
    let level: Coord[] = [head];
    let turn = 0;
    const maxCells = 400;  // board is at most ~19x19 → 361 cells

    let found = false;
    while (level.length > 0 && visited.size < maxCells && !found) {
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
          if (k === targetKey) {
            parent.set(k, cur);
            found = true;
            break;
          }
          if (!pass.passable(n, turn)) continue;
          visited.add(k);
          parent.set(k, cur);
          next.push(n);
        }
        if (found) break;
      }
      level = next;
    }

    if (!found) return [];

    // Reconstruct head → target, then drop the head (the overlay anchors at it).
    const route: Coord[] = [];
    let cur: Coord | undefined = { x: waypoint.x, y: waypoint.y };
    while (cur && !(cur.x === head.x && cur.y === head.y)) {
      route.push(cur);
      cur = parent.get(graph.coordToKey(cur));
    }
    route.reverse();
    return route;
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
    ourSnake: Snake
  ): { stranded: number; tightSpaceScore: number; tailReachable: number } {
    const head = ourSnake.head;
    const snakeLength = ourSnake.length;

    // Shared snake-relative passability (single source of truth on BoardGraph).
    // Survival reasoning: don't bank on enemy tails vacating.
    const pass = graph.passabilityFor(ourSnake.id, { optimistic: true, opponentTailsAlwaysImpassable: true });
    const tailKey = pass.tailKey;
    const headKey = pass.headKey;

    const isPassable = (coord: Coord, turn: number): boolean =>
      pass.passable(coord, turn);
    
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
  private calculateAllSnakeSpaces(graph: BoardGraph, allSnakes: Snake[], ourSnakeId: string, teamSnakeIds: Set<string>, optimistic: boolean = false): 
    { self: number; allies: number; opponents: number } {
    
    let selfScore = 0;
    let alliesScore = 0;
    let opponentsScore = 0;
    
    for (const snake of allSnakes) {
      if (snake.health <= 0) continue; // Skip dead snakes
      
      // Calculate space score for this snake
      const spaceScore = this.calculateSnakeSpace(graph, snake, optimistic);
      
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
  private calculateSnakeSpace(graph: BoardGraph, snake: Snake, optimistic: boolean = false): number {
    const region = this.computeReachableRegion(graph, snake, optimistic);
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
   * @param optimistic - if true, body segments are passable once they will have
   *                     receded by the BFS arrival turn (turn-aware passability).
   */
  private computeReachableRegion(
    graph: BoardGraph,
    snake: Snake,
    optimistic: boolean
  ): { reachableCount: number; tailReachable: boolean; parityBound: number } {
    // Survival reasoning: don't bank on enemy tails vacating.
    const pass = graph.passabilityFor(snake.id, { optimistic, opponentTailsAlwaysImpassable: true });
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
    return hasEnoughSpace ? 3 : -3;
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
      tailReachableScore: stats.tailReachable * this.weights.tailReachable,
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
           weighted.tailReachableScore +
           weighted.aggressionScore +
           weighted.trappedScore;
  }
}