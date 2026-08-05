import { sql } from 'drizzle-orm';
import { db } from '../database/db';
import { games } from '../database/schema';
import { GameState } from '../types/battlesnake';

/**
 * GameRegistry owns the authoritative `games` metadata table.
 *
 * - recordGameStart: upsert a row when a game starts (or on first /move as a
 *   fallback for missed starts). Deduped in-memory so hot /move traffic doesn't
 *   hammer the DB.
 * - recordGameEnd: finalize the row from the /end webhook (end time, final
 *   turn, winner, end reason).
 * - backfillFromDecisionLogs: one-time, idempotent reconstruction of rows for
 *   games that predate this table, derived from logged game states.
 *
 * All lifecycle writes are fire-and-forget: a DB error is logged and never
 * blocks gameplay.
 */
export class GameRegistry {
  private static instance: GameRegistry;

  // Game IDs we've already upserted a start row for this process lifetime.
  private started = new Set<string>();
  // Game IDs we've already finalized this process lifetime (dedupe the one
  // /end per controlled snake).
  private ended = new Set<string>();

  private constructor() {}

  public static getInstance(): GameRegistry {
    if (!GameRegistry.instance) {
      GameRegistry.instance = new GameRegistry();
    }
    return GameRegistry.instance;
  }

  private extractMeta(gameState: GameState) {
    const game: any = gameState?.game ?? {};
    return {
      boardWidth: gameState?.board?.width ?? null,
      boardHeight: gameState?.board?.height ?? null,
      rulesetName: game?.ruleset?.name ?? null,
      gameMode: game?.map ?? null,
      timeoutMs: game?.timeout ?? null,
      source: game?.source || 'battlesnake',
    };
  }

  // Insert the game's row if it doesn't exist yet. First writer wins; a later
  // /move for an already-registered game is a no-op.
  public recordGameStart(gameState: GameState): void {
    const gameId = gameState?.game?.id;
    if (!gameId || this.started.has(gameId)) return;
    this.started.add(gameId);

    const meta = this.extractMeta(gameState);
    db.insert(games)
      .values({
        id: gameId,
        startedAt: new Date(),
        ...meta,
      })
      .onConflictDoNothing()
      .catch((error: unknown) => {
        // Never block gameplay on a DB error; allow a retry on a later call.
        this.started.delete(gameId);
        console.error(`[GameRegistry] Failed to record game start for ${gameId}:`, error);
      });
  }

  // Finalize the game's row from the /end payload. Upserts so a game whose
  // /start and /move rows were all missed still ends up with a usable record.
  public recordGameEnd(gameState: GameState): void {
    const gameId = gameState?.game?.id;
    if (!gameId || this.ended.has(gameId)) return;
    this.ended.add(gameId);

    // The custom team engine's /end payload has no `board`; it carries a
    // top-level `winners` array of { playerID, teamID, ... }. Prefer that.
    // Fall back to the standard-engine shape (sole surviving board snake).
    let winnerSnakeId: string | null = null;
    let winnerName: string | null = null;
    let endReason: string | null = null;
    const winners = (gameState as any)?.winners;
    if (Array.isArray(winners)) {
      if (winners.length > 0) {
        winnerSnakeId = winners[0]?.playerID ?? null;
        winnerName = winners[0]?.teamID ?? null;
        endReason = 'winner';
      } else {
        endReason = 'draw';
      }
    } else if (gameState?.board?.snakes) {
      const remaining = gameState.board.snakes;
      if (remaining.length === 1) {
        winnerSnakeId = remaining[0].id;
        winnerName = remaining[0].name;
        endReason = 'elimination';
      } else if (remaining.length === 0) {
        endReason = 'draw';
      }
    }

    const meta = this.extractMeta(gameState);
    const endFields = {
      endedAt: new Date(),
      finalTurn: gameState?.turn ?? null,
      winnerSnakeId,
      winnerName,
      endReason,
      updatedAt: new Date(),
    };

    db.insert(games)
      .values({
        id: gameId,
        startedAt: new Date(),
        ...meta,
        ...endFields,
      })
      .onConflictDoUpdate({
        target: games.id,
        set: endFields,
      })
      .catch((error: unknown) => {
        this.ended.delete(gameId);
        console.error(`[GameRegistry] Failed to record game end for ${gameId}:`, error);
      });
  }

  // Idempotent backfill: create games rows for every distinct game already in
  // decision_logs that has no row yet. Derives the start/end timestamps from
  // log timestamps, the final turn / board / ruleset from the latest logged
  // game state. Never touches decision_logs, never overwrites existing rows
  // (ON CONFLICT DO NOTHING), so it's safe to run on every boot — subsequent
  // runs only scan games not yet present.
  public async backfillFromDecisionLogs(): Promise<void> {
    try {
      const result = await db.execute(sql`
        WITH missing AS (
          SELECT DISTINCT d.game_id
          FROM decision_logs d
          WHERE NOT EXISTS (SELECT 1 FROM games g WHERE g.id = d.game_id)
        ),
        agg AS (
          SELECT
            game_id,
            MIN(timestamp) AS started_at,
            MAX(timestamp) AS ended_at,
            MAX((game_state->>'turn')::int) AS final_turn
          FROM decision_logs
          WHERE game_id IN (SELECT game_id FROM missing)
          GROUP BY game_id
        ),
        rep AS (
          SELECT DISTINCT ON (game_id)
            game_id,
            (game_state->'board'->>'width')::int AS board_width,
            (game_state->'board'->>'height')::int AS board_height,
            game_state->'game'->'ruleset'->>'name' AS ruleset_name,
            game_state->'game'->>'map' AS game_mode,
            (game_state->'game'->>'timeout')::int AS timeout_ms
          FROM decision_logs
          WHERE game_id IN (SELECT game_id FROM missing)
          ORDER BY game_id, turn DESC
        )
        INSERT INTO games (
          id, started_at, ended_at, final_turn,
          board_width, board_height, ruleset_name, game_mode, timeout_ms, source
        )
        SELECT
          a.game_id, a.started_at, a.ended_at, a.final_turn,
          r.board_width, r.board_height, r.ruleset_name, r.game_mode, r.timeout_ms,
          'backfill'
        FROM agg a
        JOIN rep r USING (game_id)
        ON CONFLICT (id) DO NOTHING
      `);
      const count = (result as any).rowCount ?? 0;
      if (count > 0) {
        console.log(`[GameRegistry] Backfilled ${count} games from decision logs`);
      }
    } catch (error) {
      console.error('[GameRegistry] Backfill from decision logs failed:', error);
    }
  }
}
