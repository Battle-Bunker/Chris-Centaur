"use strict";
/**
 * Default configuration for the Battlesnake AI
 * These values can be overridden via the web interface
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.DEFAULT_CONFIG = {
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
