/**
 * Default configuration for the Battlesnake AI
 * These values can be overridden via the web interface
 */

export interface GameConfig {
  // Snake heuristic weights
  myLength: number;
  myTerritory: number;
  myControlledFood: number;
  myControlledFertile: number;
  
  // Team heuristic weights
  teamLength: number;
  teamTerritory: number;
  teamControlledFood: number;
  
  // Distance/proximity weights
  foodProximity: number;
  foodEaten: number;         // Reward for actually eating food
  
  // Enemy weights
  enemyTerritory: number;
  enemyLength: number;
  
  // Safety weights
  edgePenalty: number;
  
  // Enhanced space detection weights
  selfSpace: number;       // Continuous contest-aware survival room (sqrt-scaled; room == length → 1.0)
  alliesEnoughSpace: number;
  opponentsEnoughSpace: number;
  
  // Life/death weights
  kills: number;
  deaths: number;
  
  // Head-to-head risk weights
  enemyH2HRisk: number;  // Penalty for potential h2h with equal/larger enemies
  allyH2HRisk: number;   // Penalty for potential h2h with equal/larger allies
  
  // User-directed waypoint weights (set via centaur UI: alt-click = green goto,
  // shift-click = blue near). Applied to the bounded per-move shortest-path
  // progress stat (optimal next move = +1, sideways 0, backward -1, cut off -2),
  // so the weight IS the bonus the goto/near-preferred move receives in the
  // heuristic matrix. Keep below deaths (500) / trapped (600) so survival wins.
  gotoProgress: number;  // Bonus for the optimal next move toward the green target
  nearProgress: number;  // Bonus for closing on the blue target without reaching/cutting it off

  // Offensive aggression weight
  aggression: number;            // Reward for hunting enemies we strictly out-invulnerate (closing in on / landing on their head/body)

  // Hard trap survival weight
  trapped: number;               // Strongly-negative penalty for entering a clearly-fatal dead-end pocket (no tail-chase, not enough room to outlast our length)
  
  // Simulation parameters
  maxSimulationDepth: number;
  timeoutMs: number;
  nearbyDistance: number;
  
  // Optimistic passability lookahead (turns to predict body segment disappearance)
  maxLookaheadTurns: number;
  
  // Centaur play mode settings
  autoFirstMove: boolean;
}

export const DEFAULT_CONFIG: GameConfig = {
  // Snake heuristic weights
  myLength: 10.0,
  myTerritory: 1.0,
  myControlledFood: 10.0,
  myControlledFertile: 2.0,
  
  // Team heuristic weights
  teamLength: 10.0,
  teamTerritory: 1.0,
  teamControlledFood: 10.0,
  
  // Distance/proximity weights
  foodProximity: 50.0,
  foodEaten: 200.0,          // High reward for actually eating food
  
  // Enemy weights
  enemyTerritory: 0,
  enemyLength: 0,
  
  // Safety weights
  edgePenalty: 50.0,
  
  // Enhanced space detection weights
  selfSpace: 120,
  alliesEnoughSpace: 15.0,
  opponentsEnoughSpace: -15.0,
  
  // Life/death weights
  kills: 0,
  deaths: -500,
  
  // Head-to-head risk weights
  enemyH2HRisk: -100,  // Penalty for potential h2h with equal/larger enemies
  allyH2HRisk: -50,    // Penalty for potential h2h with equal/larger allies
  
  // User-directed waypoint weights (only active when a waypoint is set). The
  // stat is the bounded per-move shortest-path progress (optimal step = +1), so
  // the weight is the flat bonus the optimal move gets over a sideways move.
  // 300/250 outvote food/territory pulls but stay below deaths (-500) and
  // trapped (-600), so the snake follows the target without dying for it.
  gotoProgress: 300,   // Bonus for the optimal next move toward the green target
  nearProgress: 250,   // Bonus for closing on the blue target without reaching/cutting it off

  // Offensive aggression weight (conservative: max stat 2 → max +50, far below the
  // death penalty of -500, so survival always dominates aggression)
  aggression: 25,

  // Hard trap survival weight: a clearly-fatal pocket is effectively a death, so
  // this dominates every non-survival heuristic. The candidate-level veto in the
  // decision engine is the hard guarantee; this weight ensures the signal also
  // dominates scoring when a veto is not possible.
  trapped: -600,
  
  // Simulation parameters
  maxSimulationDepth: 1,
  timeoutMs: 400,
  nearbyDistance: 5,  // Focal distance: snakes within this distance have all moves enumerated; snakes beyond are frozen
  
  // Optimistic passability lookahead
  maxLookaheadTurns: 5,
  
  // Centaur play mode settings
  autoFirstMove: false
};