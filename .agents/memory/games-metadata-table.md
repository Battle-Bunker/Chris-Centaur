---
name: Authoritative games table
description: The `games` table is the source of truth for game-level metadata; /end winner parsing quirks.
---

- The `games` table (PK = game server's game ID string, same as `decision_logs.game_id`) is the authoritative per-game metadata record: start/end timestamps, final turn, board dims, ruleset, source, winner, end reason. The history list is driven by it, joining decision_logs only for per-snake detail.
- Lifecycle writes go through GameRegistry (fire-and-forget upserts; never block gameplay). Backfill from decision_logs runs on every boot and is idempotent (only inserts missing game IDs, ON CONFLICT DO NOTHING).
- **Why winner parsing is dual-path:** the custom team engine's /end payload has NO `board` but a top-level `winners: [{playerID, teamID, score, teamScore}]` array; the standard engine has a board with the sole survivor. Prefer `winners` when present; empty winners array = draw.
- Backfilled rows have `source='backfill'` and null winner/end_reason (end webhook data was never persisted before); `ended_at` = last log timestamp.
