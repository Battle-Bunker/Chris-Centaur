// Minimal typings for the TacticToes Firestore documents the Firebase
// interface consumes. Mirrors TacticToes shared/types/Game.ts, but only the
// fields we read. Timestamps arrive as Firestore Timestamp instances.

import type { Timestamp } from 'firebase/firestore';

export interface TTTeam {
  id: string; // == centaur id
  name: string;
  color: string;
}

// Unit kinds (mirrors shared/types/Game.ts UnitType). Absent fields mean
// "snake" — snake-only games carry no unitTypes map.
export type TTUnitType =
  | 'snake'
  | 'pawn'
  | 'knight'
  | 'bishop'
  | 'rook'
  | 'queen'
  | 'king';

// One unit. The first unit of a team has id == team.id, the rest are
// `${team.id}#${k}`. teamID is the controlling centaur's id; letter is
// "A".."Z" by index within the team.
export interface TTGamePlayer {
  id: string;
  teamID: string;
  letter: string;
  unitType?: TTUnitType; // Initial unit type; absent means "snake"
}

export interface TTGameSetup {
  teams: TTTeam[];
  snakesPerTeam: number;
  // Per-team unit counts (mirrors shared/types/Game.ts UnitCounts). When
  // present, snakesPerTeam is ignored by the server's expansion.
  unitsPerTeam?: Partial<Record<TTUnitType, number>>;
  pawnPromotionWeight?: number; // Pawns promote to queens at this weight (default 10)
  gamePlayers: TTGamePlayer[];
  boardWidth: number; // includes the 1-cell perimeter wall
  boardHeight: number; // includes the 1-cell perimeter wall
  maxTurnTime: number; // seconds
  foodSpawnRate?: number;
  invulnerabilityPotionEnabled?: boolean;
  invulnerabilityPotionSpawnRate?: number;
  // Per-unit-type max health (mirrors shared/types/Game.ts maxHealthPerUnit).
  // A unit's health starts at its type's max and eating restores to it.
  // Absent map or absent key means the engine default of 100.
  maxHealthPerUnit?: Partial<Record<TTUnitType, number>>;
  // Damage a unit takes when it ENTERS a hazard square (mirrors
  // shared/types/Game.ts hazardDamage). Hazards are no longer instant death —
  // a unit dies only when its health reaches <= 0. Absent means the engine
  // default of 100.
  hazardDamage?: number;
}

export interface TTTurn {
  playerHealth: Record<string, number>;
  startTime: Timestamp;
  endTime: Timestamp;
  alivePlayers: string[];
  food: number[];
  hazards: number[];
  // Board indices, head first, full-board coords. A chess piece is a
  // weight-stack: N copies of its single square (weight = array length).
  playerPieces: Record<string, number[]>;
  // The move index the server actually applied for EVERY player alive at turn
  // start — staged or engine-defaulted alike. Authoritative and complete,
  // including for units that died this turn: a dead piece records the square
  // it actually died on (mid-path for a slider stopped in flight — never its
  // origin or staged destination); a dead snake its attempted head square.
  moves: Record<string, number>;
  winners: Array<{ playerID: string; score: number }>;
  // Current type per unit (changes on pawn promotion); absent in snake-only games.
  unitTypes?: Record<string, TTUnitType>;
  // Orientation for EVERY unit in EVERY game, per turn (full-board wire
  // convention, y down). Spawn: every unit faces toward the board centre
  // (chosen from its type's legal orientation set, ties randomized engine-side).
  // After each turn: the normalized moved direction (knight: the exact
  // L-offset, e.g. {1,-2}; snake: head-neck) — except pawns, whose orientation
  // changes ONLY via their rotation action. Holds KEEP the orientation; dead
  // units drop from the map.
  orientation: Record<string, { dx: number; dy: number }>;
  // Squares each chess piece actually traversed this turn (snakes excluded).
  // A dead piece's path ends at the square it died on.
  paths?: Record<string, number[]>;
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
  // 'finished' is written by a planned TacticToes-side change at game end;
  // the centaur already understands it (never watches a finished invite) so
  // the server can start stamping it without coordinating a deploy.
  status?: 'pending' | 'started' | 'finished';
  createdAt: Timestamp;
}
