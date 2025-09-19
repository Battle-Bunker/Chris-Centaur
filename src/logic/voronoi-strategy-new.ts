/**
 * Voronoi Strategy using the new clean architecture.
 * This replaces the old fragmented implementation with the principled approach.
 */

import { GameState, Direction, TeamInfo, SimulationConfig } from '../types/battlesnake';
import { DecisionEngine, MoveDecision } from './decision-engine';
import { DecisionLogger } from './decision-logger';
import { TeamDetector } from './team-detector';

export class VoronoiStrategy {
  private decisionEngine: DecisionEngine;
  private decisionLogger: DecisionLogger;
  private teamDetector: TeamDetector;
  
  constructor() {
    this.decisionEngine = new DecisionEngine({
      maxSimulationDepth: 1,
      timeoutMs: 400,
      nearbyDistance: 3
    });
    this.decisionLogger = DecisionLogger.getInstance();
    this.teamDetector = new TeamDetector();
  }
  
  setConfig(config: Partial<SimulationConfig>) {
    // Update decision engine config
    this.decisionEngine = new DecisionEngine({
      maxSimulationDepth: 1,
      timeoutMs: config.maxEvaluationTimeMs || 400,
      nearbyDistance: config.maxDistance || 3
    });
  }
  
  getBestMove(gameState: GameState, _ourTeam?: TeamInfo): Direction {
    // Detect teams
    const teams = this.teamDetector.detectTeams(gameState.board.snakes);
    const ourTeam = teams.find(t => t.snakes.some(s => s.id === gameState.you.id));
    const teamSnakeIds = new Set<string>(ourTeam ? ourTeam.snakes.map(s => s.id) : [gameState.you.id]);
    
    // Use decision engine to get best move
    const decision = this.decisionEngine.decide(gameState, teamSnakeIds);
    
    // Log turn info
    this.logTurnInfo(gameState, decision);
    
    return decision.move;
  }
  
  getBestMoveWithDebug(gameState: GameState, _ourTeam?: TeamInfo): { 
    move: Direction; 
    safeMoves: Direction[]; 
    scores: Map<Direction, number> 
  } {
    // Detect teams
    const teams = this.teamDetector.detectTeams(gameState.board.snakes);
    const ourTeam = teams.find(t => t.snakes.some(s => s.id === gameState.you.id));
    const teamSnakeIds = new Set<string>(ourTeam ? ourTeam.snakes.map(s => s.id) : [gameState.you.id]);
    
    // Use decision engine to get best move
    const decision = this.decisionEngine.decide(gameState, teamSnakeIds);
    
    // Log turn info to console
    this.logTurnInfo(gameState, decision);
    
    // Prepare decision data for database logging
    const moveEvaluations = decision.evaluations.map(evaluation => ({
      move: evaluation.move,
      score: evaluation.averageScore,
      numStates: evaluation.numStates,
      breakdown: {
        fertileTerritory: evaluation.averageBreakdown.stats.fertileTerritory,
        teamLength: evaluation.averageBreakdown.stats.teamLength,
        foodDistance: evaluation.averageBreakdown.stats.foodDistance,
        enemyTerritory: evaluation.averageBreakdown.stats.enemyTerritory,
        enemyLength: evaluation.averageBreakdown.stats.enemyLength,
        kills: evaluation.averageBreakdown.stats.kills,
        deaths: evaluation.averageBreakdown.stats.deaths,
        weights: evaluation.averageBreakdown.weights,
        weighted: evaluation.averageBreakdown.weighted,
        // Legacy fields for compatibility
        myTerritory: evaluation.averageBreakdown.stats.fertileTerritory,
        teamTerritory: evaluation.averageBreakdown.stats.fertileTerritory,
        teamFertileScore: evaluation.averageBreakdown.stats.fertileTerritory,
        myLength: evaluation.averageBreakdown.stats.teamLength,
        foodDistanceInverse: evaluation.averageBreakdown.stats.foodDistance >= 1000 ? 0 : 
                            1 / (evaluation.averageBreakdown.stats.foodDistance + 1),
        myFoodCount: 0,
        teamFoodCount: 0
      }
    }));
    
    // Log the decision to database (non-blocking)
    // IMPORTANT: Only log the actual candidate moves, not all possible moves
    this.decisionLogger.logDecision({
      gameId: gameState.game.id,
      snakeId: gameState.you.id,
      snakeName: gameState.you.name,
      turn: gameState.turn + 1,
      position: gameState.you.head,
      health: gameState.you.health,
      safeMoves: decision.candidateMoves,  // Only the moves we actually evaluated!
      chosenMove: decision.move,
      moveEvaluations,
      gameState
    });
    
    // Return for backwards compatibility
    const scores = new Map<Direction, number>();
    for (const evaluation of decision.evaluations) {
      scores.set(evaluation.move, evaluation.averageScore);
    }
    
    return { 
      move: decision.move, 
      safeMoves: decision.candidateMoves,  // Return actual candidate moves
      scores 
    };
  }
  
  private logTurnInfo(gameState: GameState, decision: MoveDecision): void {
    const turn = gameState.turn + 1;
    
    console.log(`\n=== TURN ${turn} ===`);
    console.log(`Position: (${gameState.you.head.x}, ${gameState.you.head.y}), Health: ${gameState.you.health}`);
    console.log(`Candidate moves: ${decision.candidateMoves.join(', ')}`);
    
    // Log detailed breakdown for each evaluated move
    for (const evaluation of decision.evaluations) {
      if (evaluation.averageScore === -Infinity) {
        console.log(`\nMove ${evaluation.move}: DEATH (no valid scenarios)`);
        continue;
      }
      
      const breakdown = evaluation.averageBreakdown;
      console.log(`\nMove ${evaluation.move}: Total Score = ${breakdown.score.toFixed(2)} (${evaluation.numStates} states evaluated)`);
      console.log('┌─────────────────────┬──────────┬──────────┬──────────┐');
      console.log('│ Component           │  Average │ × Weight │  = Score │');
      console.log('├─────────────────────┼──────────┼──────────┤');
      
      // Fertile Territory
      console.log(`│ Fertile Territory   │ ${breakdown.stats.fertileTerritory.toFixed(1).padStart(8)} │ ×${breakdown.weights.fertileTerritory.toString().padStart(7)} │ ${breakdown.weighted.fertileScore.toFixed(2).padStart(8)} │`);
      
      // Team Length
      console.log(`│ Team Length         │ ${breakdown.stats.teamLength.toFixed(1).padStart(8)} │ ×${breakdown.weights.teamLength.toString().padStart(7)} │ ${breakdown.weighted.teamLengthScore.toFixed(2).padStart(8)} │`);
      
      // Food Distance (inverse)
      const invFoodDist = breakdown.stats.foodDistance >= 1000 ? 0 : 1 / (breakdown.stats.foodDistance + 1);
      console.log(`│ Food Distance       │ ${breakdown.stats.foodDistance.toFixed(1).padStart(8)} │ ×${breakdown.weights.foodDistance.toString().padStart(7)} │ ${breakdown.weighted.foodDistanceScore.toFixed(2).padStart(8)} │`);
      console.log(`│   (1/(dist+1))      │ ${invFoodDist.toFixed(3).padStart(8)} │          │          │`);
      
      // Enemy stats (currently zero weight but tracked)
      if (breakdown.weights.enemyTerritory > 0 || breakdown.weights.enemyLength > 0) {
        console.log(`│ Enemy Territory     │ ${breakdown.stats.enemyTerritory.toFixed(1).padStart(8)} │ ×${breakdown.weights.enemyTerritory.toString().padStart(7)} │ ${breakdown.weighted.enemyTerritoryScore.toFixed(2).padStart(8)} │`);
        console.log(`│ Enemy Length        │ ${breakdown.stats.enemyLength.toFixed(1).padStart(8)} │ ×${breakdown.weights.enemyLength.toString().padStart(7)} │ ${breakdown.weighted.enemyLengthScore.toFixed(2).padStart(8)} │`);
      }
      
      // Deaths penalty
      if (breakdown.stats.deaths > 0) {
        console.log(`│ Deaths              │ ${breakdown.stats.deaths.toFixed(1).padStart(8)} │ ×${breakdown.weights.deaths.toString().padStart(7)} │ ${breakdown.weighted.deathsScore.toFixed(2).padStart(8)} │`);
      }
      
      console.log('└─────────────────────┴──────────┴──────────┴──────────┘');
    }
    
    console.log(`\nCHOSEN: ${decision.move.toUpperCase()}`);
  }
}