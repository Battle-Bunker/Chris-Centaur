-- Snake decision logging schema
CREATE TABLE IF NOT EXISTS decision_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  game_id VARCHAR(255) NOT NULL,
  snake_id VARCHAR(255) NOT NULL,
  snake_name VARCHAR(255),
  turn INTEGER NOT NULL,
  position_x INTEGER NOT NULL,
  position_y INTEGER NOT NULL,
  health INTEGER NOT NULL,
  safe_moves TEXT[], -- Array of safe moves
  chosen_move VARCHAR(10) NOT NULL,
  
  -- Move evaluation data (stored as JSONB for flexibility)
  move_evaluations JSONB NOT NULL,
  
  -- Full game state for reconstruction (stored as JSONB)
  game_state JSONB NOT NULL,
  
  -- Indexes for efficient querying
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_decision_logs_game_id ON decision_logs(game_id);
CREATE INDEX IF NOT EXISTS idx_decision_logs_snake_id ON decision_logs(snake_id);
CREATE INDEX IF NOT EXISTS idx_decision_logs_turn ON decision_logs(turn);
CREATE INDEX IF NOT EXISTS idx_decision_logs_timestamp ON decision_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_decision_logs_game_snake_turn ON decision_logs(game_id, snake_id, turn);