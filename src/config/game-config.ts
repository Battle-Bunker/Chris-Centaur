/**
 * Default configuration for the snake AI.
 * These values can be overridden via the web interface.
 *
 * The heuristic-weight half is DERIVED from the heuristic registry
 * (./heuristics.ts) — never re-list heuristic keys here. Only the
 * non-heuristic runtime settings are declared in this module.
 */

import { HeuristicWeights, defaultHeuristicWeights } from './heuristics';

export interface NonHeuristicConfig {
  // Simulation parameters
  timeoutMs: number;
  nearbyDistance: number; // Focal distance: snakes within this distance have all moves enumerated; snakes beyond are frozen

  // Centaur play mode settings
  autoFirstMove: boolean;

  // Idle policy: minutes without user activity before WebSocket connections
  // are considered idle (client shows overlay, server sweeps the socket),
  // releasing the autoscale deployment to scale to zero. Runtime-configurable
  // so idle behavior can be tested in production without a redeploy.
  idleTimeoutMinutes: number;
}

export type GameConfig = HeuristicWeights & NonHeuristicConfig;

export const DEFAULT_CONFIG: GameConfig = {
  // Heuristic weights — single-sourced from the registry.
  ...defaultHeuristicWeights(),

  // Simulation parameters
  timeoutMs: 400,
  nearbyDistance: 5,

  // Centaur play mode settings
  autoFirstMove: false,

  // Idle policy
  idleTimeoutMinutes: 30,
};
