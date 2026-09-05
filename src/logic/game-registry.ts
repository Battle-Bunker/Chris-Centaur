import { sql } from 'drizzle-orm';
import { db } from '../database/db';
import { games } from '../database/schema';
import { BoardSnapshot } from '../types/battlesnake';

/**
 * GameRegistry owns the authoritative `games` metadata table.
 *
 * - recordGameStart: upsert a row when a game starts (or on first /move as a
 *   fallback for missed starts). Deduped in-memory so hot /move traffic doesn't
 *   hammer the DB.
 * - recordGameEnd: finalize the row from the /end webhook (end time, final
 *   turn, winner, end reason).
 * - backfillFromStoredBoards: one-time, idempotent reconstruction of rows for
 *   games that predate this table, derived from the boards stored in `turn_boards`.
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

  private extractMeta(gameState: BoardSnapshot) {
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
  public recordGameStart(gameState: BoardSnapshot): void {
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
  public recordGameEnd(gameState: BoardSnapshot): void {
    const gameId = gameState?.game?.id;
    if (!gameId || this.ended.has(gameId)) return;
    this.ended.add(gameId);

    // The canonical final state carries a top-level `winners` array of
    // { playerID, score, teamID, teamName } — every snake of each winning
    // team, enriched by the Firebase interface. Prefer that: it covers both
    // elimination finishes and turn-limit score finishes (where losing teams
    // are still on the board). Fall back to the standard-engine shape (sole
    // surviving board snake) only when no winners array is present.
    let winnerSnakeId: string | null = null;
    let winnerName: string | null = null;
    let endReason: string | null = null;
    const winners = (gameState as any)?.winners;
    if (Array.isArray(winners)) {
      if (winners.length > 0) {
        // Winners spanning more than one team = a tie at the turn limit — the
        // engine emits every tied team's snakes. That's a draw, not a win for
        // whichever team happens to be listed first.
        const teamIDs = new Set(
          winners.map((w: any) => w?.teamID).filter((t: any) => t != null)
        );
        if (teamIDs.size > 1) {
          endReason = 'draw';
        } else {
          winnerSnakeId = winners[0]?.playerID ?? null;
          // Display name (team name), never a raw team id if we can help it.
          winnerName = winners[0]?.teamName ?? winners[0]?.teamID ?? null;
          endReason = 'winner';
        }
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

  /**
   * Idempotent backfill: create `games` rows for every distinct game already in
   * `turn_boards` that has no row yet, deriving the timestamps from the stored
   * boards and the dimensions and ruleset from the latest settlement.
   *
   * It reads `turn_boards` because that is where a board lives now — one
   * canonical settlement per (game, BOARD turn) rather than one embedded copy
   * per unit per turn — so the scan touches one row per turn instead of
   * twenty-six, and there is no "prefer a board-bearing row" clause because
   * every row bears one. Never overwrites existing rows (ON CONFLICT DO
   * NOTHING), so it is safe to run on every boot.
   */
  public async backfillFromStoredBoards(): Promise<void> {
    try {
      const result = await db.execute(sql`
        WITH missing AS (
          SELECT DISTINCT t.game_id
          FROM turn_boards t
          WHERE NOT EXISTS (SELECT 1 FROM games g WHERE g.id = t.game_id)
        ),
        agg AS (
          SELECT
            game_id,
            MIN(created_at) AS started_at,
            MAX(created_at) AS ended_at,
            MAX(turn) AS final_turn
          FROM turn_boards
          WHERE game_id IN (SELECT game_id FROM missing)
          GROUP BY game_id
        ),
        rep AS (
          SELECT DISTINCT ON (game_id)
            game_id,
            (settlement->'board'->>'width')::int AS board_width,
            (settlement->'board'->>'height')::int AS board_height,
            settlement->'game'->'ruleset'->>'name' AS ruleset_name,
            settlement->'game'->>'map' AS game_mode,
            (settlement->'game'->>'timeout')::int AS timeout_ms
          FROM turn_boards
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
      const count = (result as { rowCount?: number }).rowCount ?? 0;
      if (count > 0) {
        console.log(`[GameRegistry] Backfilled ${count} games from stored boards`);
      }
    } catch (error) {
      console.error('[GameRegistry] Backfill from stored boards failed:', error);
    }
  }
}
