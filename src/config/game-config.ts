/**
 * Default configuration for the Battlesnake AI
 * These values can be overridden via the web interface
 */

export interface GameConfig {
  // Snake heuristic weights
  myLength: number;
  myTerritory: number;
  myControlledFood: number;
  
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
  alliesEnoughSpace: number;
  opponentsEnoughSpace: number;
  
  // Life/death weights
  kills: number;
  deaths: number;
  
  // Simulation parameters
  maxSimulationDepth: number;
  timeoutMs: number;
  nearbyDistance: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  // Snake heuristic weights
  myLength: 10.0,
  myTerritory: 1.0,
  myControlledFood: 10.0,
  
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
  alliesEnoughSpace: 5.0,
  opponentsEnoughSpace: -5.0,
  
  // Life/death weights
  kills: 0,
  deaths: -500,
  
  // Simulation parameters
  maxSimulationDepth: 1,
  timeoutMs: 400,
  nearbyDistance: 5
};