// Minimal typings for the TacticToes Firestore documents the Firebase
// interface consumes. Mirrors TacticToes shared/types/Game.ts, but only the
// fields we read. Timestamps arrive as Firestore Timestamp instances.

import type { Timestamp } from 'firebase/firestore';

export interface TTTeam {
  id: string; // == centaur id
  name: string;
  color: string;
}

// One snake. The first snake of a team has id == team.id, the rest are
// `${team.id}#${k}` (k = 2..snakesPerTeam). teamID is the controlling
// centaur's id; letter is "A".."Z" by index within the team.
export interface TTGamePlayer {
  id: string;
  teamID: string;
  letter: string;
}

export interface TTGameSetup {
  teams: TTTeam[];
  snakesPerTeam: number;
  gamePlayers: TTGamePlayer[];
  boardWidth: number; // includes the 1-cell perimeter wall
  boardHeight: number; // includes the 1-cell perimeter wall
  maxTurnTime: number; // seconds
  firstTurnTime?: number;
  foodSpawnRate?: number;
  invulnerabilityPotionSpawnRate?: number;
}

export interface TTTurn {
  playerHealth: Record<string, number>;
  startTime: Timestamp;
  endTime: Timestamp;
  scores: Record<string, number>;
  alivePlayers: string[];
  food: number[];
  hazards: number[];
  playerPieces: Record<string, number[]>; // board indices, head first, full-board coords
  // Submitted move indices that produced this turn (server-defaulted moves for
  // players who never staged are absent — derive those from the head delta).
  moves?: Record<string, number>;
  winners: Array<{ playerID: string; score: number }>;
  fertileTiles?: number[];
  invulnerabilityPotions?: number[];
  playerInvulnerabilityLevel?: Record<string, number>;
  // Per-player invulnerability effects with their scheduled expiry turns. The
  // aggregate level above is the SUM of these; each expires independently, so
  // this is what tells us how long the current level will hold.
  activeEffects?: TTActiveEffect[];
}

export interface TTActiveEffect {
  playerID: string;
  type: 'invulnerability_buff' | 'invulnerability_debuff';
  level: number;
  // Absolute game turn at which the server removes this effect. The server
  // expires effects at the END of turn processing — AFTER collisions — so the
  // effect still governs a collision resolved during turn `expiryTurn` itself.
  expiryTurn: number;
  sourcePlayerID: string;
}

export interface TTGameStateDoc {
  setup: TTGameSetup;
  turns: TTTurn[];
}

/**
 * centaurs/{centaurId}/games/{gameId} invite doc. The server creates it with
 * status 'pending' while the lobby is being configured (and deletes it if the
 * team is removed), then overwrites the same doc with status 'started' (plus
 * snakeIDs) at game start. A missing status is treated as 'started'.
 */
export interface TTGameInvite {
  sessionID: string;
  gameID: string;
  status?: 'pending' | 'started';
  snakeIDs?: string[]; // absent on pending invites
  createdAt: Timestamp;
}
