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
  selfEnoughSpace: number;
  selfSpaceOptimistic: number;
  alliesEnoughSpace: number;
  opponentsEnoughSpace: number;
  
  // Life/death weights
  kills: number;
  deaths: number;
  
  // Head-to-head risk weights
  enemyH2HRisk: number;  // Penalty for potential h2h with equal/larger enemies
  allyH2HRisk: number;   // Penalty for potential h2h with equal/larger allies
  
  // User-directed waypoint weights (set via centaur UI: alt-click = green goto, shift-click = blue near)
  waypointGoto: number;  // Strong pull toward green waypoint (go to this cell ASAP)
  waypointNear: number;  // Pull toward blue waypoint + keep path open to it

  // Tight-space survival weights
  connectivityPenalty: number;   // Weight per stranded cell when head is an articulation point (typically negative)
  tightSpaceScore: number;       // Weight on bounded longest-path-in-region approximation
  tailReachable: number;         // Bonus when our own tail is reachable (gated by tight-space threshold)
  tightSpaceThreshold: number;   // tight when reachable < snakeLength * threshold; gates tightSpaceScore + tailReachable
  
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
  selfEnoughSpace: 10.0,
  selfSpaceOptimistic: 5.0,
  alliesEnoughSpace: 5.0,
  opponentsEnoughSpace: -5.0,
  
  // Life/death weights
  kills: 0,
  deaths: -500,
  
  // Head-to-head risk weights
  enemyH2HRisk: -100,  // Penalty for potential h2h with equal/larger enemies
  allyH2HRisk: -50,    // Penalty for potential h2h with equal/larger allies
  
  // User-directed waypoint weights (off by default — only active when user sets a waypoint)
  // Waypoint weights are intentionally huge: closeness gradient per cell-step
  // is ~1/boardSize ≈ 0.09, so the weight must be in the thousands for one
  // step toward the target to clearly dominate other heuristics. Death
  // penalty (-500) still wins because it's a flat per-death stat.
  waypointGoto: 2500,  // Strong pull toward green waypoint — top priority after survival
  waypointNear: 2000,  // Pull toward blue waypoint + path-open bonus

  // Tight-space survival weights
  connectivityPenalty: -20,
  tightSpaceScore: 30,
  tailReachable: 100,
  tightSpaceThreshold: 2.0,
  
  // Simulation parameters
  maxSimulationDepth: 1,
  timeoutMs: 400,
  nearbyDistance: 5,  // Focal distance: snakes within this distance have all moves enumerated; snakes beyond are frozen
  
  // Optimistic passability lookahead
  maxLookaheadTurns: 5,
  
  // Centaur play mode settings
  autoFirstMove: false
};