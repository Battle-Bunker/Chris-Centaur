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
  
  // User-directed waypoint progress weights (centaur UI: alt-click = goto/green, shift-click = near/blue)
  gotoProgress: number;  // Bonus for the optimal step toward the active goto target
  nearProgress: number;  // Bonus for the optimal step toward the near target (never arriving)

  // Offensive aggression weight
  aggression: number;            // Reward for hunting enemies we strictly out-invulnerate (closing in on / landing on their head/body)

  // Hard trap survival weight
  trapped: number;               // Strongly-negative penalty for entering a clearly-fatal dead-end pocket (no tail-chase, not enough room to outlast our length)
  
  // Simulation parameters
  timeoutMs: number;
  nearbyDistance: number;

  // Centaur play mode settings
  autoFirstMove: boolean;

  // Idle policy: minutes without user activity before WebSocket connections
  // are considered idle (client shows overlay, server sweeps the socket),
  // releasing the autoscale deployment to scale to zero. Runtime-configurable
  // so idle behavior can be tested in production without a redeploy.
  idleTimeoutMinutes: number;
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
  
  // User-directed waypoint progress weights (only active when the user sets a target).
  // The progress stat is a BOUNDED [0,1] ramp that equals 1 for the optimal next
  // step, so the weight IS the bonus that step receives — not a multiplier on a
  // gradient. Keep both above the food/territory pulls but BELOW deaths (-500)
  // and trapped (-600): that ordering is the whole safety argument, and raising
  // them past the death penalty re-creates "snake dies for the waypoint".
  // (The pre-redesign keys used a ~1/boardSize Manhattan-closeness gradient,
  // hence their magnitudes in the thousands — never port those numbers here.)
  gotoProgress: 300,   // Bonus for the optimal step toward the active goto target
  nearProgress: 250,   // Bonus for the optimal step toward the near target

  // Offensive aggression weight (conservative: max stat 2 → max +50, far below the
  // death penalty of -500, so survival always dominates aggression)
  aggression: 25,

  // Hard trap survival weight: a clearly-fatal pocket is effectively a death, so
  // this dominates every non-survival heuristic. The candidate-level veto in the
  // decision engine is the hard guarantee; this weight ensures the signal also
  // dominates scoring when a veto is not possible.
  trapped: -600,
  
  // Simulation parameters
  timeoutMs: 400,
  nearbyDistance: 5,  // Focal distance: snakes within this distance have all moves enumerated; snakes beyond are frozen

  // Centaur play mode settings
  autoFirstMove: false,

  // Idle policy
  idleTimeoutMinutes: 30
};