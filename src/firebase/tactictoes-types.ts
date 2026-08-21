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
  // The square each unit actually ENDED its move on, for EVERY player alive at
  // turn start — staged or engine-defaulted alike. This is the death-square
  // guarantee: anything that died records the cell it died on, never a staged
  // destination it was blocked from entering. A slider truncated in flight —
  // by a capture-stop or by its health running out mid-ray — records its stop
  // square, which can be well short of what was staged; an edge-contest loser
  // records its OWN start square, because it never crossed. `deaths[id].cell`
  // agrees with this for every unit that died, and IS the primary source: this
  // map exists for the living too.
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
  /**
   * The AUTHORITATIVE death registry for this turn, and the only thing a
   * renderer reads to draw a death (mirrors shared/types/Game.ts Turn.deaths).
   * Every unit removed this turn appears here — killed, walled, severed to
   * nothing, and STARVED alike (a unit whose health ran out mid-turn halts
   * where it stood, keeps fighting as a collision object for the rest of the
   * turn, and is removed at the end of it). Written on every turn; an empty
   * object means nobody died.
   *
   * REQUIRED, exactly as on the wire — the registry is not an enrichment the
   * bot may or may not get, it is the death channel. Readers still guard the
   * field (`turn.deaths ?? {}`) against a malformed document rather than
   * trusting the compiler about someone else's JSON.
   */
  deaths: Record<string, TTUnitDeath>;
  /**
   * Cells cut from each SURVIVING snake this turn by a sever — non-fatal
   * damage, for damage indicators (mirrors shared/types/Game.ts
   * Turn.severedCells). Absent when no sever truncated anything. A sever whose
   * owner died the same turn is a clash record but truncates nothing, so it
   * never appears here.
   */
  severedCells?: Record<string, number[]>;
  fertileTiles?: number[];
  invulnerabilityPotions?: number[];
  playerInvulnerabilityLevel?: Record<string, number>;
  // Per-player invulnerability effects with their scheduled expiry turns. The
  // aggregate level above is the SUM of these; each expires independently, so
  // this is what tells us how long the current level will hold.
  activeEffects?: TTActiveEffect[];
  // Collisions the server resolved while producing THIS turn's board (mirrors
  // shared/types/Game.ts Turn.clashes). ONE RECORD PER CELL PER EVENT — a
  // multi-cell snake that died no longer contributes a record per body cell,
  // and the only event that spans two cells is an edge-contest tie (one record
  // on each unit's own cell). Who died is stated outright by `victimIDs`, so
  // nothing has to be inferred from the resulting board. Absent on turns where
  // nothing collided.
  clashes?: TTClash[];
  // NOTE: the wire also carries a per-team `teamScores` map. It is
  // deliberately NOT typed here, because nothing reads it: the scoreboard
  // derives each team's score from the board it is rendering (the summed
  // weight of the team's living units — the engine's own rule), which is the
  // only way a historic log or a mid-game reconnect can score at all.
}

/**
 * What produced a clash record, and — in TTUnitDeath.cause — what killed the
 * unit (mirrors shared/types/Game.ts ClashKind). This, together with the
 * explicit id lists, is what a reader branches on. The `reason` string is
 * display text and MUST NOT be branched on: the server rewrites its wording
 * freely.
 */
export type TTClashKind =
  | 'contest' // same-cell (or durable collision cell) tier-then-weight contest
  // In-flight edge exchange: two units whose HEADS cross the same edge in one
  // sub-step. Uniform across every unit kind and length — the loser is
  // squashed at the cell its head started from, and dies there.
  | 'edge'
  | 'bodyBlock' // died entering a cell occupied by a unit's body/trail
  | 'sever' // body cut by a strictly-higher-tier unit — non-fatal for the owner
  | 'hazard' // health exhausted by hazard damage (starved where it stood)
  | 'starvation' // health exhausted by movement cost (starved where it stood)
  | 'wall' // hit a boundary wall
  | 'self' // collided with own body
  | 'regicide'; // removed with its team when the team's last king fell

/**
 * One adjudicated event at one cell, verbatim from the TacticToes wire
 * (shared/types/Game.ts Clash). A single collision that spans two cells (an
 * edge-contest tie) emits one record per cell; nothing else ever produces two
 * records for one event.
 */
export interface TTClash {
  // FULL-board index (perimeter included) of the cell this event happened on.
  index: number;
  // Which within-turn sub-step the event happened on. ALWAYS present: a
  // whole-move unit (every snake, a knight's jump, a king's step) records 1,
  // and a slider walking its ray records the sub-step it was on.
  subStep: number;
  // What produced the record — the thing readers branch on.
  kind: TTClashKind;
  // Every unit involved in this record, survivors included.
  playerIDs: string[];
  // The subset of playerIDs that died (or starved) HERE. Empty for a sever,
  // which is non-fatal for the body's owner.
  victimIDs: string[];
  // The unique unit left standing at this cell, when there is one. Withdrawn
  // by the server when the named unit was itself condemned in the same
  // sub-step (two snakes can annihilate each other simultaneously).
  survivorID?: string;
  // Display text ONLY, written by the game processor. Never load-bearing.
  reason: string;
}

/** Where, when and how one unit died this turn (shared/types/Game.ts UnitDeath). */
export interface TTUnitDeath {
  // FULL-board index of the cell the unit died on — the last cell it actually
  // reached, never a staged destination it was blocked from entering.
  cell: number;
  subStep: number;
  cause: TTClashKind;
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
