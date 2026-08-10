// Minimal typings for the TacticToes Firestore documents the Firebase
// interface consumes. Mirrors TacticToes shared/types/Game.ts, but only the
// fields we read. Timestamps arrive as Firestore Timestamp instances.

import type { Timestamp } from 'firebase/firestore';

export interface TTTeam {
  id: string;
  name: string;
  color: string;
}

export interface TTGamePlayer {
  id: string;
  type: 'bot' | 'human';
  teamID?: string;
  isKing?: boolean;
  /** For bot clones: the underlying bots/<id> doc. Unset for the original instance. */
  botRef?: string;
  displayName?: string;
  displayEmoji?: string;
}

export interface TTGameSetup {
  gameType: string;
  gamePlayers: TTGamePlayer[];
  boardWidth: number; // includes the 1-cell perimeter wall
  boardHeight: number; // includes the 1-cell perimeter wall
  maxTurnTime: number; // seconds
  firstTurnTime?: number;
  teams?: TTTeam[];
  gameMode?: 'individual' | 'team';
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

export interface TTMoveStatus {
  moveNumber: number;
  alivePlayerIDs: string[];
  movedPlayerIDs: string[];
}

/** bots/{botId}/games/{gameId} invite doc written by the server at game start. */
export interface TTGameInvite {
  sessionID: string;
  gameID: string;
  gameType: string;
  snakeIDs: string[];
  createdAt: Timestamp;
}
