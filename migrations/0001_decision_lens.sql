-- The decision lens' storage, in one migration.
--
-- WHAT THE OWNER RUNS: `npm run db:push` (drizzle-kit diffs
-- `src/database/schema.ts` against the live database and applies exactly
-- this). This file is the same statements written out, for a deploy that
-- applies SQL by hand rather than by diff, and as the record of what the push
-- will do.
--
-- WHAT IS LOST: the old telemetry rows, and only those. `decision_logs` (one
-- row per unit per turn, carrying a `move_evaluations` blob whose premise —
-- that a joint plan's value decomposes onto units — is false, plus a
-- `game_state` blob duplicated across every unit of a turn), `turn_states`
-- (its `game_state` moves to `turn_boards.settlement`; its `territory` and
-- `cell_ownership` Voronoi maps are deleted outright, answered on demand by
-- `logic/territory-view.ts` instead of painted per turn), `command_events`
-- (subsumed by `turn_events`, which carries the same operator attribution with
-- a total order beside it) and `command_turn_states` (a denormalised copy of
-- the live broadcast shape — the fold's OUTPUT — kept beside the inputs that
-- generate it; nothing regenerated it, which is why it goes).
--
-- No live behaviour reads any of them after this branch: the board timeline is
-- served from `turn_boards`, operator attribution from `turn_events`, and the
-- per-unit result from `unit_outcomes`. `games`, `server_events`,
-- `server_liveness` and `config_store` are untouched.
--
-- THERE IS NO BACKFILL AND NO DUAL-READ. Rows written before this migration
-- describe a search this bot no longer runs.

BEGIN;

DROP TABLE IF EXISTS decision_logs;
DROP TABLE IF EXISTS turn_states;
DROP TABLE IF EXISTS command_turn_states;
DROP TABLE IF EXISTS command_events;

-- 1. The re-run input AND the fold's t0 anchor. Retained forever.
CREATE TABLE IF NOT EXISTS turn_boards (
  game_id     varchar(255) NOT NULL,
  turn        integer      NOT NULL,
  settlement  jsonb        NOT NULL,
  board_hash  varchar(128),
  deadline_ms integer,
  roster      jsonb,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT turn_boards_pkey PRIMARY KEY (game_id, turn)
);
CREATE INDEX IF NOT EXISTS idx_turn_boards_created_at ON turn_boards (created_at);

-- 2. The intra-turn timeline. `payload` is the TurnEvent verbatim.
CREATE TABLE IF NOT EXISTS turn_events (
  game_id     varchar(255) NOT NULL,
  turn        integer      NOT NULL,
  seq         integer      NOT NULL,
  kind        varchar(32)  NOT NULL,
  at_wall     bigint       NOT NULL,   -- UTC ms, whole: the sink rounds
  -- The KERNEL's clock, fractional by construction (nodes x NODE_COST +
  -- reads x READ_COST under the node clock, a performance.now() difference
  -- under the wall clock). An integer column truncated the axis that replays.
  at_work_ms  double precision,
  actor_kind  varchar(16)  NOT NULL,
  actor_id    varchar(255),
  actor_name  varchar(255),
  actor_color varchar(32),
  unit_key    varchar(255),
  caused_by   varchar(320),
  answers     varchar(320),
  payload     jsonb        NOT NULL,
  CONSTRAINT turn_events_pkey PRIMARY KEY (game_id, turn, seq)
);
CREATE INDEX IF NOT EXISTS idx_turn_events_game_turn_kind ON turn_events (game_id, turn, kind);
CREATE INDEX IF NOT EXISTS idx_turn_events_at_wall ON turn_events (at_wall);

-- 3. One row per decision: the audit seed and the lazy-derivation seed.
CREATE TABLE IF NOT EXISTS decisions (
  id             varchar(320) PRIMARY KEY,
  game_id        varchar(255) NOT NULL,
  turn           integer      NOT NULL,
  bot_id         varchar(255) NOT NULL,
  behaviour_id   varchar(255),
  engine         varchar(64),
  profile        varchar(64),
  basis          jsonb,
  seed           integer,
  budget_ms      integer,
  node_budget    integer,
  assumptions    jsonb,
  initial_pins   jsonb,
  modelled       jsonb,
  kernel_options jsonb,
  summary        jsonb,
  started_at     bigint,
  ended_at       bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_decisions_game_turn_bot ON decisions (game_id, turn, bot_id);

-- 4. A materialised projection of the `movesets` frames. It exists for its
--    index; `scripts/lens-rebuild.js` regenerates it from turn_events.
CREATE TABLE IF NOT EXISTS movesets (
  decision_id      varchar(320)     NOT NULL,
  emission_seq     integer          NOT NULL,
  cluster_id       integer          NOT NULL,
  cluster_key      varchar(512)     NOT NULL,
  cluster_gen      integer          NOT NULL,
  rank             integer          NOT NULL,
  moveset_key      varchar(512)     NOT NULL,
  moves            jsonb            NOT NULL,
  witness_plan_key varchar(512),
  seen_in          integer,
  lo               double precision NOT NULL,
  est              double precision NOT NULL,
  hi               double precision NOT NULL,
  channel          varchar(8)       NOT NULL,
  exact            boolean          NOT NULL,
  ledger_size      integer,
  vacuity          varchar(32),
  complement_key   varchar(512),
  complement_stale boolean          NOT NULL,
  cited            jsonb,
  basis_key        varchar(512),
  staged           boolean          NOT NULL,
  dominance_kind   varchar(32),
  dominance        jsonb,
  h1_lo            double precision NOT NULL,
  h1_hi            double precision NOT NULL,
  deep_horizon     integer          NOT NULL,
  deep_lo          double precision NOT NULL,
  deep_hi          double precision NOT NULL,
  derived          boolean          NOT NULL,
  line             jsonb,
  CONSTRAINT movesets_pkey PRIMARY KEY (decision_id, emission_seq, cluster_id, moveset_key)
);
CREATE INDEX IF NOT EXISTS idx_movesets_decision_cluster_rank
  ON movesets (decision_id, cluster_id, rank);

-- 5. What a result IS, per unit per turn.
CREATE TABLE IF NOT EXISTS unit_outcomes (
  game_id        varchar(255) NOT NULL,
  turn           integer      NOT NULL,
  unit_key       varchar(255) NOT NULL,
  unit_name      varchar(255),
  cluster_id     integer,
  staged_move    integer,
  staged_source  varchar(64),
  confirmed_move integer,
  committed      boolean      NOT NULL DEFAULT false,
  resolved_move  integer,
  fatal_consent  boolean,
  operator_id    varchar(255),
  CONSTRAINT unit_outcomes_pkey PRIMARY KEY (game_id, turn, unit_key)
);
CREATE INDEX IF NOT EXISTS idx_unit_outcomes_game_unit ON unit_outcomes (game_id, unit_key);

COMMIT;
