/**
 * Unified board evaluator that provides a single scoring function for board states.
 * Returns both a score and structured statistics for each heuristic.
 * Now uses single-pass multi-source BFS for O(W×H) complexity.
 */

import { GameState, Snake, Coord } from '../types/battlesnake';
import { BoardGraph, BoardGraphConfig, ClearanceMode } from './board-graph';
import { MultiSourceBFS, BFSSource, BFSResult } from './multi-source-bfs';
import { unitContestData } from './piece-threats';
import { CasualtyContext } from './turn-oracle';
import { WaypointProgress } from './waypoint-pathing';
import {
  HEURISTIC_KEYS,
  HeuristicWeights,
  WeightedScores,
  defaultHeuristicWeights,
} from '../config/heuristics';

// The heuristic key set, weight/score types and defaults are DERIVED from the
// heuristic registry (config/heuristics.ts) — one entry there fans out to all
// of these. Re-exported so existing consumers keep their import path.
export { HeuristicWeights, WeightedScores } from '../config/heuristics';

/**
 * Individual heuristic values for a board state: one stat per registry key,
 * plus `foodDistance` — the raw unweighted BFS distance to the nearest food
 * (1000 if none reachable), tracked for logs/UI but never weighted (its
 * scored form is the normalized `foodProximity`).
 *
 * Stat semantics live where each stat is computed (calculateStatsWithTerritory
 * and its helpers); weight semantics live in the registry.
 */
export type HeuristicStats = { [K in keyof HeuristicWeights]: number } & {
  foodDistance: number;
};

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

export interface PieceThreatContext {
  enemyPieceThreat?: number;  // 1 if the move lands on a square a threatening enemy piece could take
  allyPieceThreat?: number;   // 1 if the move lands on a square an ally piece could take
}

export interface EvaluationContext {
  // Food positions of the PRE-MOVE board, supplied when evaluating a
  // SIMULATED state (the simulation consumes eaten food, so a head sitting on
  // a pre-move food cell means this branch ate). Absent for real states.
  prevFoodSet?: Set<string>;
  h2hRisk?: H2HRiskContext;   // Head-to-head risk info for the move being evaluated
  // Piece-threat info for the move being evaluated — same injection pattern
  // (and reason) as h2hRisk: a property of the candidate MOVE computed once
  // per decision from the pre-move board, not of the board being scored.
  pieceThreat?: PieceThreatContext;
  simulatedSnakeIds?: Set<string>;  // Snake IDs that were simulated (already moved) - get startDelay: 1
  // Per-move goto/near progress stats for the candidate move that produced this
  // board (centaur play mode). Computed once per decision from the PRE-move
  // board by the shared waypoint pathfinder and injected here — the same
  // injection pattern as h2hRisk, and for the same reason: it is a property of
  // the move under consideration, not of the board being scored.
  waypointProgress?: WaypointProgress | null;
  // Projected health cost of the candidate MOVE (movement + hazard damage, or
  // the mover's whole health when the projection resolves the move as DEATH —
  // turn-oracle.ts), computed once per decision from the
  // PRE-move board and injected here — same per-move-constant pattern as
  // h2hRisk/pieceThreat/waypointProgress, and for the same reason: the cost
  // describes the move, not the simulated board. Undefined/0 for states that
  // never had it computed (e.g. direct board-evaluator tests).
  healthCost?: number;
  // What the candidate MOVE does to the units on the board — the ally weight it
  // destroys, the enemies it kills, and whether it ends a team by taking its
  // last king, read off a resolved turn (turn-oracle.ts). Same per-move-constant
  // injection as healthCost, and for the same reason: these describe the move,
  // not the board it produces. The contest that resolves the move's cost is
  // the contest that decides who dies in it, so both come off ONE projection.
  casualties?: CasualtyContext;
  // Materialize per-snake territory cell lists (UI/visualization). Defaults to
  // true; the chunked minimax evaluation passes false — it reads only scores
  // and stats, and building coord arrays per state was measurable GC churn.
  collectTerritory?: boolean;
}

export class BoardEvaluator {
  private weights: HeuristicWeights;
  private graphConfig: BoardGraphConfig;

  constructor(weights?: Partial<HeuristicWeights>, graphConfig?: Partial<BoardGraphConfig>) {
    // Registry defaults for each heuristic (can be overridden)
    this.weights = {
      ...defaultHeuristicWeights(),
      ...weights
    };

    this.graphConfig = {
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
      // Every stat zero except: no reachable food, the death itself, and what
      // the move did to everyone ELSE on its way — dying does not undo the
      // ally we killed, and it certainly does not undo regicide, which
      // eliminates the whole team whether or not we survived the move.
      // trapped stays 0 — death is already captured by deaths: 1; avoid
      // double-penalizing.
      const deadStats = {} as HeuristicStats;
      for (const key of HEURISTIC_KEYS) deadStats[key] = 0;
      deadStats.foodDistance = 1000;
      deadStats.deaths = 1;
      deadStats.kills = ctx?.casualties?.kills ?? 0;
      deadStats.allyCasualty = ctx?.casualties?.allyCasualty ?? 0;
      deadStats.regicide = ctx?.casualties?.regicide ?? 0;
      deadStats.enemyRegicide = ctx?.casualties?.enemyRegicide ?? 0;
      return {
        stats: deadStats,
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
        startDelay: simulatedSnakeIds ? (simulatedSnakeIds.has(s.id) ? 1 : 0) : 0,
        // Contest data: tier (projected onto the turn a cell is decided) then
        // weight, settling both same-level snake arrivals and whether a piece
        // can take a cell off the snake that claimed it.
        ...unitContestData(s, gameState.turn)
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
    // was 54% of every evaluation for a ±1 signal). Held territory is a LOWER
    // bound on a snake's reachable space — the cells it gets to before every
    // other snake and that no piece could take off it — so
    // `territory >= max(3, length/2)` is a conservative "has room" proxy
    // mirroring the old tail-chase threshold. It is only tightened by the
    // piece layer, never loosened, so it stays a lower bound. Our own survival
    // tier below keeps the full flood-fill treatment.
    const spaceScores = this.spaceScoresFromTerritory(bfsResult, board.snakes, ourSnakeId, teamSnakeIds);

    // SURVIVAL TIER (contest-aware, conservative clearance): flood only the cells
    // we HOLD in the Voronoi division, from our post-move head, under
    // conservative body-clearance timing. This is what we bank our survival on —
    // it refuses to count room another snake will reach first, and (since the
    // territory rule made pieces displacers) room a piece would take off us.
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
        // Casualties the candidate MOVE inflicts, from the shared projection
        // (see EvaluationContext.casualties). Enemy units killed…
        kills: ctx?.casualties?.kills ?? 0,
        deaths: isDead ? 1 : 0,
        enemyH2HRisk: ctx?.h2hRisk?.enemyH2HRisk ?? 0,  // From context, 1 if h2h risk with enemy
        allyH2HRisk: ctx?.h2hRisk?.allyH2HRisk ?? 0,    // From context, 1 if h2h risk with ally
        enemyPieceThreat: ctx?.pieceThreat?.enemyPieceThreat ?? 0,  // From context, 1 if a threatening enemy piece can take the landing square
        allyPieceThreat: ctx?.pieceThreat?.allyPieceThreat ?? 0,    // From context, 1 if an ally piece can take the landing square
        gotoProgress,
        nearProgress,
        aggression,
        trapped,
        healthLoss: ctx?.healthCost ?? 0,  // Projected health cost of this move; from context
        // …and the ones on our own side of the board: the weight we destroy,
        // and the two team-ending cases the engine's regicide rule creates.
        allyCasualty: ctx?.casualties?.allyCasualty ?? 0,
        regicide: ctx?.casualties?.regicide ?? 0,
        enemyRegicide: ctx?.casualties?.enemyRegicide ?? 0,
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
  // Scratch for the region flood's neighbor fill (never used while another
  // fill of the same buffer is in flight); grown to whatever the graph's
  // widest unit needs.
  private neighborScratch: Int32Array = new Int32Array(0);

  private ensureScratch(cells: number): void {
    if (this.scratchCells < cells) {
      this.scratchCells = cells;
      this.visitStamp = new Int32Array(cells);
      this.floodQueue = new Int32Array(cells);
      this.stamp = 0;
    }
  }

  private ensureNeighborScratch(graph: BoardGraph): Int32Array {
    if (this.neighborScratch.length < graph.neighborCapacity()) {
      this.neighborScratch = graph.neighborBuffer();
    }
    return this.neighborScratch;
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
    const nbuf = this.ensureNeighborScratch(graph);

    let reachableCount = 1; // head occupies a cell
    let tailReachable = false;
    let white = (snake.head.x + snake.head.y) % 2 === 0 ? 1 : 0;
    let black = 1 - white;
    let arrivalTurn = 1;
    const rayOpen = (cell: number): boolean => pass.passableIdx(cell, arrivalTurn);

    while (levelStart < levelEnd) {
      let nextEnd = levelEnd;
      for (let q = levelStart; q < levelEnd; q++) {
        const cur = queue[q];
        const nCount = graph.fillUnitNeighbors(snake, cur, rayOpen, nbuf);
        for (let t = 0; t < nCount; t++) {
          const n = nbuf[t];
          if (visit[n] === stamp) continue;
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
    this.ensureScratch(graph.cellCount);
    const visit = this.visitStamp;
    const stamp = ++this.stamp;

    // Two DISTINCT scratch buffers: degree counting runs while the candidate
    // buffer is still being iterated.
    const candBuf = graph.neighborBuffer();
    const degBuf = graph.neighborBuffer();

    let current = graph.cellIndexOf(snake.head);
    visit[current] = stamp;
    let steps = 0;
    let tailReached = false;
    // The turn the walk arrives at the cell being enumerated, and the turn
    // after it — read by the two ray-stop tests below.
    let arrivalTurn = 1;
    let nextArrival = 2;
    const rayOpen = (cell: number): boolean => pass.passableIdx(cell, arrivalTurn);
    const rayOpenNext = (cell: number): boolean => pass.passableIdx(cell, nextArrival);

    while (steps < cap) {
      arrivalTurn = steps + 1;
      nextArrival = arrivalTurn + 1;
      const nCount = graph.fillUnitNeighbors(snake, current, rayOpen, candBuf);
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
      for (let i = 0; i < candidates; i++) {
        const cand = candBuf[i];
        const dCount = graph.fillUnitNeighbors(snake, cand, rayOpenNext, degBuf);
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
   * we actually HOLD in the Voronoi division (the multi-source BFS owner array):
   * ground we reach before every other snake and that no piece could take off us.
   * This is the survival room we can bank on: it refuses to count space an
   * opponent would reach first or would win off us, and it refuses to bank on
   * bodies vacating on optimistic timing.
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
   * Calculate weighted scores for each heuristic (stat × weight, one entry
   * per registry key).
   */
  private calculateWeightedScores(stats: HeuristicStats): WeightedScores {
    const weighted = {} as WeightedScores;
    for (const key of HEURISTIC_KEYS) {
      weighted[`${key}Score`] = stats[key] * this.weights[key];
    }
    return weighted;
  }

  /**
   * Calculate total score from weighted scores: a flat sum in registry order.
   * (Registry order is the historical summation order — float addition is not
   * associative, and exact-value tests depend on it.)
   */
  private calculateTotalScore(weighted: WeightedScores): number {
    let total = 0;
    for (const key of HEURISTIC_KEYS) {
      total += weighted[`${key}Score`];
    }
    return total;
  }
}