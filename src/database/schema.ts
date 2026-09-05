import {
  pgTable,
  serial,
  varchar,
  integer,
  bigint,
  doublePrecision,
  text,
  jsonb,
  timestamp,
  index,
  primaryKey,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle schema definitions — the single source of truth for the database
 * shape. `db:push` (dev) and Replit's Publish diff (prod) apply this schema.
 *
 * THE DECISION LENS' FIVE TABLES (04-SYNTHESIS §4.3, 01-DATA-MODEL §6.1).
 * `turn_boards`, `turn_events`, `decisions`, `movesets`, `unit_outcomes`.
 * `games`, `server_events`, `server_liveness` and `config_store` are
 * untouched. There is NO backwards compatibility: the previous telemetry
 * shape — `decision_logs`, `turn_states`, `command_events`,
 * `command_turn_states` — is DROPPED, and with it the per-unit
 * `move_evaluations` blob whose premise (that a joint plan's value decomposes
 * onto units) is false, the per-turn Voronoi ownership maps, and the
 * denormalised broadcast snapshot that was a copy of a fold's output kept
 * beside the inputs that generate it.
 *
 * WHAT THE OWNER RUNS: `npm run db:push`. `migrations/0001_decision_lens.sql`
 * carries the same statements for a hand-applied deploy. WHAT IS LOST: the old
 * telemetry rows only. No live behaviour reads them — the board timeline is
 * rebuilt from `turn_boards`, operator attribution from `turn_events`, and
 * per-unit results from `unit_outcomes`.
 */

// ---------------------------------------------------------------------------
// 1. turn_boards — the re-run input AND the fold's t0 anchor. Forever.
// ---------------------------------------------------------------------------

/**
 * ONE canonical board per (game, BOARD turn). Every turn's fold begins at
 * `board.arrived` and ends at the deadline, so a fold never crosses a turn
 * boundary and there is nothing to seek past: this row IS the checkpoint
 * `command_turn_states` was mistakenly kept for (04 §2.7).
 *
 * `settlement` is the canonical you-less state the renderer and every
 * re-derivation read; `roster` is the per-unit identity strip the games
 * listing groups on, so a listing never has to detoast a settlement.
 * Retained for the life of the game: without it nothing is derivable.
 */
export const turnBoards = pgTable(
  'turn_boards',
  {
    gameId: varchar('game_id', { length: 255 }).notNull(),
    // BOARD domain. ONE turn domain, everywhere: the `board turn + 1`
    // decision-log domain is deleted with the table that had it.
    turn: integer('turn').notNull(),
    settlement: jsonb('settlement').notNull(),
    boardHash: varchar('board_hash', { length: 128 }),
    deadlineMs: integer('deadline_ms'),
    // [{ unit, name, letter, color, teamId, squad, length }] — identity only.
    roster: jsonb('roster'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.gameId, table.turn] }),
    index('idx_turn_boards_created_at').on(table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// 2. turn_events — the intra-turn timeline. One writer per (game, turn).
// ---------------------------------------------------------------------------

/**
 * The one event log, written by the ONE `seq` writer the active game manager
 * owns (04 §3 O6). `payload` is the `TurnEvent` VERBATIM, so live and replay
 * fold IDENTICAL BYTES (02 D-d); the columns beside it exist because they are
 * indexed, not because they are different data.
 *
 * `at_work_ms` is the kernel's own clock from t0 and is NULL — never 0 — when
 * nothing measured it. `caused_by` is what made an event happen; `answers` is
 * the operator event it RESPONDS to, and those are different questions: an
 * emission is caused by a slice boundary and answers a pin.
 */
export const turnEvents = pgTable(
  'turn_events',
  {
    gameId: varchar('game_id', { length: 255 }).notNull(),
    turn: integer('turn').notNull(),
    // Total order within the turn, gapless and monotone. The only sort key.
    seq: integer('seq').notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    // UTC ms. `bigint` because a JS epoch overflows int4, and a WHOLE
    // millisecond because that is what a wall-clock reading is — the sink
    // rounds, so nothing fractional can reach a column that cannot hold one.
    atWall: bigint('at_wall', { mode: 'number' }).notNull(),
    // THE KERNEL'S CLOCK, and `double precision` rather than `integer`.
    //
    // It is not milliseconds rounded off: under the node clock it is
    // `nodes × NODE_COST + reads × READ_COST`, which is fractional BY
    // CONSTRUCTION, and under the wall clock it is a `performance.now()`
    // difference, which is fractional too. An `integer` column truncated the
    // axis that replays — the first three frames of a real decision are at
    // 0.01, 2.04 and 2.05 — and Postgres refused the write outright rather
    // than truncating, which is how the O1 run found it.
    atWorkMs: doublePrecision('at_work_ms'),
    actorKind: varchar('actor_kind', { length: 16 }).notNull(),
    actorId: varchar('actor_id', { length: 255 }),
    actorName: varchar('actor_name', { length: 255 }),
    actorColor: varchar('actor_color', { length: 32 }),
    unitKey: varchar('unit_key', { length: 255 }),
    causedBy: varchar('caused_by', { length: 320 }),
    answers: varchar('answers', { length: 320 }),
    payload: jsonb('payload').notNull(),
  },
  table => [
    primaryKey({ columns: [table.gameId, table.turn, table.seq] }),
    index('idx_turn_events_game_turn_kind').on(table.gameId, table.turn, table.kind),
    index('idx_turn_events_at_wall').on(table.atWall),
  ],
);

// ---------------------------------------------------------------------------
// 3. decisions — the audit seed and the lazy-derivation seed. Forever.
// ---------------------------------------------------------------------------

/**
 * One row per decision, carrying `DecisionInput` (01 §8.2) whole. Every field
 * is already computed and already thrown away; storing it is what makes
 * retention a latency decision rather than a loss, because a folded turn is
 * still re-derivable from the board plus this seed.
 */
export const decisions = pgTable(
  'decisions',
  {
    id: varchar('id', { length: 320 }).primaryKey(),
    gameId: varchar('game_id', { length: 255 }).notNull(),
    turn: integer('turn').notNull(),
    botId: varchar('bot_id', { length: 255 }).notNull(),
    behaviourId: varchar('behaviour_id', { length: 255 }),
    engine: varchar('engine', { length: 64 }),
    profile: varchar('profile', { length: 64 }),
    basis: jsonb('basis'),
    seed: integer('seed'),
    budgetMs: integer('budget_ms'),
    nodeBudget: integer('node_budget'),
    assumptions: jsonb('assumptions'),
    initialPins: jsonb('initial_pins'),
    modelled: jsonb('modelled'),
    kernelOptions: jsonb('kernel_options'),
    summary: jsonb('summary'),
    startedAt: bigint('started_at', { mode: 'number' }),
    endedAt: bigint('ended_at', { mode: 'number' }),
  },
  table => [
    uniqueIndex('uidx_decisions_game_turn_bot').on(table.gameId, table.turn, table.botId),
  ],
);

// ---------------------------------------------------------------------------
// 4. movesets — a MATERIALISED PROJECTION of the `movesets` frames.
// ---------------------------------------------------------------------------

/**
 * It exists for the index `(decision_id, cluster_id, rank)` and NOT for its
 * content. That licence holds only because `lens-schema.test.ts` asserts the
 * fold reproduces it and `scripts/lens-rebuild.js` regenerates it from
 * `turn_events` after a `DELETE` — the rule `command_turn_states` failed
 * (04 §2.7). A row here is therefore the only DROPPABLE thing the writer
 * queues: losing one costs a rebuild, losing an event costs the turn.
 */
export const movesets = pgTable(
  'movesets',
  {
    decisionId: varchar('decision_id', { length: 320 }).notNull(),
    emissionSeq: integer('emission_seq').notNull(),
    clusterId: integer('cluster_id').notNull(),
    clusterKey: varchar('cluster_key', { length: 512 }).notNull(),
    clusterGen: integer('cluster_gen').notNull(),
    rank: integer('rank').notNull(),
    movesetKey: varchar('moveset_key', { length: 512 }).notNull(),
    moves: jsonb('moves').notNull(),
    witnessPlanKey: varchar('witness_plan_key', { length: 512 }),
    seenIn: integer('seen_in'),
    // THE NUMBER: a whole-board proved bracket of a complete plan. Never a sum.
    lo: doublePrecision('lo').notNull(),
    est: doublePrecision('est').notNull(),
    hi: doublePrecision('hi').notNull(),
    channel: varchar('channel', { length: 8 }).notNull(),
    exact: boolean('exact').notNull(),
    ledgerSize: integer('ledger_size'),
    vacuity: varchar('vacuity', { length: 32 }),
    // THE FIBER (Law E): basis, generation and complement. All three must
    // match before two rows may be compared, differenced or sorted together.
    complementKey: varchar('complement_key', { length: 512 }),
    complementStale: boolean('complement_stale').notNull(),
    cited: jsonb('cited'),
    basisKey: varchar('basis_key', { length: 512 }),
    staged: boolean('staged').notNull(),
    // WHY IT IS NOT RANK 1 — `better()`'s branch, read backwards.
    dominanceKind: varchar('dominance_kind', { length: 32 }),
    dominance: jsonb('dominance'),
    // DEPTH (06 §3.3 rule 4): the delta on every row, the LINE on `staged`
    // only. `h1` is captured once on the row's first price and never
    // re-derived — recomputing it later would compute it under a different
    // complement, and the delta would be a difference between two questions.
    h1Lo: doublePrecision('h1_lo').notNull(),
    h1Hi: doublePrecision('h1_hi').notNull(),
    deepHorizon: integer('deep_horizon').notNull(),
    deepLo: doublePrecision('deep_lo').notNull(),
    deepHi: doublePrecision('deep_hi').notNull(),
    derived: boolean('derived').notNull(),
    line: jsonb('line'),
  },
  table => [
    primaryKey({
      columns: [table.decisionId, table.emissionSeq, table.clusterId, table.movesetKey],
    }),
    index('idx_movesets_decision_cluster_rank').on(
      table.decisionId,
      table.clusterId,
      table.rank,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 5. unit_outcomes — what a result IS, per unit per turn. Forever.
// ---------------------------------------------------------------------------

/**
 * Replaces `decision_logs`' back-filled move columns without its blob. The
 * request → confirm → commit → resolve lifecycle, reconstructed from the
 * event log, with the operator who determined it. `fatal_consent` is the one
 * field that survives the old table by name: it is a warning about a
 * determination, not a score.
 */
export const unitOutcomes = pgTable(
  'unit_outcomes',
  {
    gameId: varchar('game_id', { length: 255 }).notNull(),
    turn: integer('turn').notNull(),
    unitKey: varchar('unit_key', { length: 255 }).notNull(),
    unitName: varchar('unit_name', { length: 255 }),
    clusterId: integer('cluster_id'),
    stagedMove: integer('staged_move'),
    stagedSource: varchar('staged_source', { length: 64 }),
    confirmedMove: integer('confirmed_move'),
    committed: boolean('committed').notNull().default(false),
    resolvedMove: integer('resolved_move'),
    fatalConsent: boolean('fatal_consent'),
    operatorId: varchar('operator_id', { length: 255 }),
  },
  table => [
    primaryKey({ columns: [table.gameId, table.turn, table.unitKey] }),
    index('idx_unit_outcomes_game_unit').on(table.gameId, table.unitKey),
  ],
);

// ---------------------------------------------------------------------------
// Untouched by the lens (04 §4.3).
// ---------------------------------------------------------------------------

// Authoritative per-game metadata record. One row per game, keyed by the game
// server's game ID string. Inserted at game start (or first /move as
// fallback), finalized by the /end webhook. Games that never receive /end keep
// null end fields. Historical games are backfilled from `turn_boards` (see
// GameRegistry).
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
    // or "backfill" for rows reconstructed from stored boards.
    source: varchar('source', { length: 64 }),
    winnerSnakeId: varchar('winner_snake_id', { length: 255 }),
    winnerName: varchar('winner_name', { length: 255 }),
    endReason: varchar('end_reason', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index('idx_games_started_at').on(table.startedAt)],
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
