import {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle schema definitions — the single source of truth for the database
 * shape. `db:push` (dev) and Replit's Publish diff (prod) apply this schema.
 * These tables reproduce the previously-startup-created schema exactly; do not
 * add or rename columns here without an accompanying migration plan.
 */

// Per-move decision log written asynchronously by the DecisionLogger worker and
// read back by the history viewer.
export const decisionLogs = pgTable(
  'decision_logs',
  {
    id: serial('id').primaryKey(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    gameId: varchar('game_id', { length: 255 }).notNull(),
    snakeId: varchar('snake_id', { length: 255 }).notNull(),
    snakeName: varchar('snake_name', { length: 255 }),
    turn: integer('turn').notNull(),
    positionX: integer('position_x').notNull(),
    positionY: integer('position_y').notNull(),
    health: integer('health').notNull(),
    safeMoves: text('safe_moves').array(),
    botRecommendation: varchar('bot_recommendation', { length: 10 }).notNull(),
    submittedMove: varchar('submitted_move', { length: 10 }),
    // True when the submitted move went through the fatal-move consent
    // confirmation (dialog confirm or kill-all). Null on rows logged before
    // this column existed or before the move was back-filled.
    fatalConsent: boolean('fatal_consent'),
    serverMove: varchar('server_move', { length: 10 }),
    moveEvaluations: jsonb('move_evaluations').notNull(),
    gameState: jsonb('game_state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_decision_logs_game_id').on(table.gameId),
    index('idx_decision_logs_snake_id').on(table.snakeId),
    index('idx_decision_logs_turn').on(table.turn),
    index('idx_decision_logs_timestamp').on(table.timestamp),
    index('idx_decision_logs_game_snake_turn').on(table.gameId, table.snakeId, table.turn),
  ],
);

// ONE canonical board state per (game, turn) — the shared truth the replay
// timeline is built from. Written by the canonical turn pipeline; the
// per-snake decision_logs rows carry only per-snake data (evaluations, moves,
// a slim {turn, you} game_state) and reference the board implicitly by turn.
// `turn` is in the BOARD domain (game_state.turn), NOT the decision-log
// domain (which is board turn + 1).
//
// Writes are COALESCE upserts (first non-null value wins per column), so the
// board write from the turn pipeline and the territory write from the
// decision pass can land in either order — and Firestore snapshot re-delivery
// can never regress a filled column.
export const turnStates = pgTable(
  'turn_states',
  {
    id: serial('id').primaryKey(),
    gameId: varchar('game_id', { length: 255 }).notNull(),
    turn: integer('turn').notNull(),
    // Canonical you-less state {game, turn, board, lastMoves?, winners?}.
    // Null until the board write lands (a territory write can arrive first).
    gameState: jsonb('game_state'),
    // Shared per-turn Voronoi data (snake-independent), formerly duplicated
    // into every snake's move_evaluations blob.
    territory: jsonb('territory'),
    cellOwnership: jsonb('cell_ownership'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('uidx_turn_states_game_turn').on(table.gameId, table.turn),
  ],
);

// Authoritative per-game metadata record. One row per game, keyed by the game
// server's game ID string (same value as decision_logs.game_id, so no FK
// refactoring is needed). Inserted at game start (or first /move as fallback),
// finalized by the /end webhook. Games that never receive /end keep null end
// fields. Historical games are backfilled from decision_logs (see GameRegistry).
export const games = pgTable(
  'games',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    finalTurn: integer('final_turn'),
    boardWidth: integer('board_width'),
    boardHeight: integer('board_height'),
    rulesetName: varchar('ruleset_name', { length: 64 }),
    gameMode: varchar('game_mode', { length: 64 }),
    timeoutMs: integer('timeout_ms'),
    // Where the game came from, per the game server (e.g. "custom", "league"),
    // or "backfill" for rows reconstructed from decision logs.
    source: varchar('source', { length: 64 }),
    winnerSnakeId: varchar('winner_snake_id', { length: 255 }),
    winnerName: varchar('winner_name', { length: 255 }),
    endReason: varchar('end_reason', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index('idx_games_started_at').on(table.startedAt)],
);

// Operator command events written by the CommandLogger worker: every command a
// human gives a controlled snake (goto/near targets, manual moves, clears,
// fatal-move confirmations, suicide, commits) plus the server-side transitions
// that alter command state (goto arrival shifts). Each row carries the issuing
// operator's identity so a replay can attribute every command.
export const commandEvents = pgTable(
  'command_events',
  {
    id: serial('id').primaryKey(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    gameId: varchar('game_id', { length: 255 }).notNull(),
    // Null for game-scoped events; the affected snake otherwise.
    snakeId: varchar('snake_id', { length: 255 }),
    // The board turn that was current when the command was issued.
    turn: integer('turn').notNull(),
    eventType: varchar('event_type', { length: 48 }).notNull(),
    // The operator who issued the command; all null for system events.
    operatorId: varchar('operator_id', { length: 255 }),
    operatorName: varchar('operator_name', { length: 255 }),
    operatorColor: varchar('operator_color', { length: 32 }),
    payload: jsonb('payload'),
  },
  table => [
    index('idx_command_events_game_id').on(table.gameId),
    index('idx_command_events_game_turn').on(table.gameId, table.turn),
  ],
);

// One snapshot per (game, turn) of every controlled snake's command state as
// it stood WHEN THE TURN ENDED (captured just before the next board is fed
// in, so goto queues are un-shifted and staged records still bind to the
// resolved turn). The state blob uses exactly the live WebSocket broadcast
// shape (stagedMoves / waypoints / routes / activeIntentModes / owners plus
// per-snake operators), so the history viewer can feed it straight into the
// same render paths the live client uses.
export const commandTurnStates = pgTable(
  'command_turn_states',
  {
    id: serial('id').primaryKey(),
    gameId: varchar('game_id', { length: 255 }).notNull(),
    turn: integer('turn').notNull(),
    state: jsonb('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [uniqueIndex('idx_command_turn_states_game_turn').on(table.gameId, table.turn)],
);

// Server lifecycle/activity events (boot, shutdown, woke, went-idle) powering
// the /activity autoscale audit page. Dev and prod databases are separate, so
// each database's rows are inherently their own environment — no env column.
export const serverEvents = pgTable(
  'server_events',
  {
    id: serial('id').primaryKey(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    eventType: varchar('event_type', { length: 32 }).notNull(),
    detail: jsonb('detail'),
  },
  table => [index('idx_server_events_timestamp').on(table.timestamp)],
);

// Single-row liveness heartbeat for the /activity autoscale audit. The running
// process upserts row id=1 every HEARTBEAT_INTERVAL (update-in-place, NOT an
// append-per-tick log) so the next boot can bound when the previous process
// actually died — Replit's autoscale kill sends no catchable signal, so
// without this the timeline can't distinguish "up but idle" from
// "scaled to zero". lastActivityAt mirrors the logger's last user/game
// activity so boot forensics can classify silent-kill vs crash.
export const serverLiveness = pgTable('server_liveness', {
  id: integer('id').primaryKey(), // always 1 — single row
  pid: integer('pid').notNull(),
  bootedAt: timestamp('booted_at', { withTimezone: true }).notNull(),
  lastAliveAt: timestamp('last_alive_at', { withTimezone: true }).notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
});

// Simple key/value configuration store backing the config UI.
export const configStore = pgTable('config_store', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
