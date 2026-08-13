import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../database/db';
import { decisionLogs } from '../database/schema';
import { BoardSnapshot, Direction } from '../types/battlesnake';
import { TeamDetector } from './team-detector';
import {
  mergeTimelineRows,
  NativeTurnRow,
  slimGameStateForLog,
  SynthesizedTurnRow,
  TimelineRow,
} from './turn-timeline';

export interface DecisionLogEntry {
  gameId: string;
  snakeId: string;
  snakeName: string;
  turn: number;
  position: { x: number; y: number };
  health: number;
  safeMoves: Direction[];
  botRecommendation: Direction;
  moveEvaluations: {
    move: Direction;
    score: number;
    numStates: number;
    projectedTerritoryCells?: { [snakeId: string]: { x: number; y: number }[] };
    breakdown?: {
      myLength: number;
      myTerritory: number;
      myControlledFood: number;
      myControlledFertile: number;

      teamLength: number;
      teamTerritory: number;
      teamControlledFood: number;

      foodDistance: number;
      foodProximity: number;
      foodEaten: number;

      enemyTerritory?: number;
      enemyLength?: number;

      kills?: number;
      deaths?: number;

      gotoProgress?: number;
      nearProgress?: number;

      enemyH2HRisk?: number;
      allyH2HRisk?: number;

      selfSpace?: number;

      aggression?: number;
      trapped?: number;

      fertileTerritory?: number;
      foodDistanceInverse?: number;
      myFoodCount?: number;
      teamFoodCount?: number;
      teamFertileScore?: number;

      weights: any;
      weighted: any;
    };
  }[];
  gameState: any;
}

// Compact pre-serialized row. Holds only primitives + already-stringified
// JSON blobs so the original gameState / territoryCells object graphs can be
// GC'd immediately after logDecision() returns. This is the key memory win:
// even a backed-up queue only holds compact strings, not live nested objects.
interface SerializedRow {
  gameId: string;
  snakeId: string;
  snakeName: string;
  turn: number;
  positionX: number;
  positionY: number;
  health: number;
  safeMoves: Direction[];
  botRecommendation: Direction;
  moveEvaluationsJson: string;
  gameStateJson: string;
  retries: number;
}

// A single controlled snake within a (game, team) group, as surfaced to the
// history viewer's left panel.
export interface GameTeamMember {
  snake_id: string;
  snake_name: string;
  color: string | null;
  length: number | null;
  turns: number;
}

// One left-panel entry: a single team within a single game, framed from our
// team's perspective. `default_snake_id` is the member the viewer should load
// first (the longest/primary member).
export interface GameTeamGroup {
  game_id: string;
  team_key: string;
  team_label: string;
  team_color: string | null;
  timestamp: string;
  turns: number;
  default_snake_id: string;
  snakes: GameTeamMember[];
  // Game-level metadata from the authoritative `games` table. Null when the
  // information was never captured (e.g. no /end webhook was received).
  started_at: string | null;
  ended_at: string | null;
  final_turn: number | null;
  board_width: number | null;
  board_height: number | null;
  ruleset_name: string | null;
  winner_snake_id: string | null;
  winner_name: string | null;
  end_reason: string | null;
}

// Turns a raw game-server team id like "team_red" into a friendly label
// ("Team Red"). Returns null when there's nothing usable so callers can fall
// back to squad/color.
function prettifyTeamName(teamId: string | null | undefined): string | null {
  if (!teamId) return null;
  const trimmed = teamId.trim();
  if (!trimmed) return null;
  return trimmed
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// The team's display name from a member snake's own name: translate.ts builds
// snake names as `${team.name} ${letter}`, so stripping the trailing letter
// token recovers the human-readable team (centaur) name. Returns null when the
// name doesn't follow that shape (e.g. legacy games where name is a raw id).
function deriveTeamName(
  snakeName: string | null | undefined,
  letter: string | null | undefined
): string | null {
  if (!snakeName || !letter) return null;
  const suffix = ` ${letter}`;
  if (!snakeName.endsWith(suffix)) return null;
  const team = snakeName.slice(0, -suffix.length).trim();
  return team || null;
}

// A back-fill onto an already-inserted decision row: the final move we actually
// submitted to the server (submitted_move) or the move the server reported it
// made (server_move, read from the next turn's lastMoves map). Both target a
// specific (game, snake, turn) row and always land on decision_logs.turn = the
// board turn's decision row (see recordSubmittedMove / recordServerMoves for the
// turn-offset math).
interface MoveUpdate {
  gameId: string;
  snakeId: string;
  turn: number;
  column: 'submitted_move' | 'server_move';
  move: Direction;
  // Only for submitted_move: whether the move carried fatal-move consent.
  fatalConsent?: boolean;
  retries: number;
}

// One canonical turn-state write: a COALESCE upsert onto turn_states keyed by
// (game, BOARD turn). The board write (canonical pipeline) and the territory
// write (decision pass) arrive as separate items in either order; per-column
// COALESCE means the first non-null value wins and re-delivery can never
// regress a filled column. JSON is pre-serialized at enqueue time, same as
// decision rows, so the live object graphs are GC-eligible immediately.
interface TurnStateRow {
  gameId: string;
  turn: number; // BOARD domain (game_state.turn), not board turn + 1
  gameStateJson: string | null;
  territoryJson: string | null;
  cellOwnershipJson: string | null;
  retries: number;
}

// The async worker queue holds per-move inserts, move-column back-fills, or
// turn-state upserts. A back-fill always targets a row inserted at least a
// full turn earlier, and the worker processes all inserts in a batch before
// any move-updates in the same batch, so the row a back-fill targets exists
// by the time we UPDATE it. Turn-state upserts are self-contained (COALESCE)
// and processed first within their batch.
type QueueItem =
  | { kind: 'insert'; row: SerializedRow }
  | { kind: 'moveUpdate'; update: MoveUpdate }
  | { kind: 'turnState'; row: TurnStateRow };

const BATCH_SIZE = 100;

export class DecisionLogger {
  private static instance: DecisionLogger;

  private readonly MAX_QUEUE_SIZE = 50000;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 100;
  private queue: QueueItem[] = [];
  private droppedCount = 0;
  // O(1) support for the drop preference in enqueue(): how many queued items
  // are droppable (kind !== 'turnState'), and the index below which the queue
  // is known to hold only turn-state items, so the drop scan never re-reads
  // that prefix. Invariant: queue[i].kind === 'turnState' for all i < dropScanFrom.
  private droppableCount = 0;
  private dropScanFrom = 0;

  // Worker loop coordination
  private workerRunning = true;
  private workerPromise: Promise<void>;
  private wakeup: (() => void) | null = null;

  private constructor() {
    // Schema is owned by Drizzle (db:push in dev, Publish diff in prod); this
    // class assumes the tables already exist and does no startup-time DDL.
    this.workerPromise = this.runWorkerLoop();
  }

  public static getInstance(): DecisionLogger {
    if (!DecisionLogger.instance) {
      DecisionLogger.instance = new DecisionLogger();
    }
    return DecisionLogger.instance;
  }

  // Synchronous, non-blocking enqueue. Pre-serializes everything so the live
  // gameState object graph becomes GC-eligible immediately.
  //
  // Decision rows are PER-SNAKE data only: the stored game_state is the slim
  // {turn, you} identity (see slimGameStateForLog) and the move_evaluations
  // blob no longer embeds the shared territory/ownership grids — the board
  // and the grids live once per turn in turn_states (see logTurnState),
  // instead of once per snake per turn. Rows logged before this change keep
  // their full embedded game_state; every read path handles both formats
  // per row.
  public logDecision(entry: DecisionLogEntry): void {
    let moveEvaluationsJson: string;
    let gameStateJson: string;
    try {
      moveEvaluationsJson = JSON.stringify({ evaluations: entry.moveEvaluations });
      gameStateJson = JSON.stringify(slimGameStateForLog(entry.gameState));
    } catch (e) {
      console.error('[DecisionLogger] Failed to serialize entry, dropping:', e);
      return;
    }

    const row: SerializedRow = {
      gameId: entry.gameId,
      snakeId: entry.snakeId,
      snakeName: entry.snakeName,
      turn: entry.turn,
      positionX: entry.position.x,
      positionY: entry.position.y,
      health: entry.health,
      safeMoves: entry.safeMoves,
      botRecommendation: entry.botRecommendation,
      moveEvaluationsJson,
      gameStateJson,
      retries: 0,
    };

    this.enqueue({ kind: 'insert', row });
  }

  // Single bounded enqueue for EVERY queue item, so a prolonged DB outage
  // can't grow the queue without bound no matter which producer is hot. When
  // full, prefer dropping the oldest per-snake item: turn-state rows are the
  // canonical board (one per turn, never re-delivered once the game moves
  // on), so losing one punches a permanent hole in the replay timeline while
  // a dropped decision row costs one snake's breakdown for one turn.
  private enqueue(item: QueueItem): void {
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      // Oldest droppable (non-turnState) item, else the queue head — found in
      // amortized O(1): everything before dropScanFrom is turn-state, so the
      // scan resumes there instead of walking the queue from 0 on every
      // enqueue while full; droppableCount > 0 guarantees the scan hits.
      let dropIdx = 0;
      if (this.droppableCount > 0) {
        let i = this.dropScanFrom;
        while (this.queue[i].kind === 'turnState') i++;
        dropIdx = i;
        this.dropScanFrom = i;
      }
      const dropped = this.queue.splice(dropIdx, 1)[0];
      if (dropped.kind !== 'turnState') this.droppableCount--;
      if (dropIdx < this.dropScanFrom) this.dropScanFrom--;
      this.droppedCount++;
      if (this.droppedCount % 100 === 0) {
        const d: any = dropped?.kind === 'moveUpdate' ? dropped.update : (dropped as any)?.row;
        console.warn(`[DecisionLogger] Queue full! Dropped ${this.droppedCount} total entries. Last dropped: kind=${dropped?.kind}, game=${d?.gameId}, turn=${d?.turn}`);
      }
    }
    this.queue.push(item);
    if (item.kind !== 'turnState') this.droppableCount++;
    this.signalWakeup();
  }

  // Record the final move we actually submitted to the game server for a snake's
  // turn. Called from the commit path (resolvePendingMove). `turn` must be the
  // decision_logs.turn of the target row: a move committed for board turn N was
  // logged with decision_logs.turn = N+1, so callers pass boardTurn + 1.
  public recordSubmittedMove(gameId: string, snakeId: string, turn: number, move: Direction, fatalConsent: boolean = false): void {
    this.enqueue({
      kind: 'moveUpdate',
      update: { gameId, snakeId, turn, column: 'submitted_move', move, fatalConsent, retries: 0 },
    });
  }

  // Back-fill the server-decided move for every snake from a freshly-arrived
  // game state's `lastMoves` map. `lastMoves` on board turn T describes the moves
  // that transitioned turn T-1 → T; those are the server-decided moves for each
  // snake's decision at board turn T-1, whose rows were logged with
  // decision_logs.turn = (T-1)+1 = T. So the update key is exactly the arriving
  // turn T. Iterating ALL entries lets a still-alive peer's next move back-fill a
  // snake that has since died (it takes no further /move of its own). Updates for
  // snakes we never logged (enemies) simply match zero rows.
  public recordServerMoves(gameId: string, turn: number, lastMoves: Record<string, Direction> | null | undefined): void {
    if (!lastMoves) return;
    for (const [snakeId, move] of Object.entries(lastMoves)) {
      if (!move) continue;
      this.enqueue({
        kind: 'moveUpdate',
        update: { gameId, snakeId, turn, column: 'server_move', move, retries: 0 },
      });
    }
  }

  // Enqueue a canonical turn-state write (COALESCE upsert; see TurnStateRow).
  // Called from two places with complementary halves of the row:
  //  - the canonical turn pipeline, with the you-less game_state (+lastMoves),
  //  - the decision pass, with the shared territory/ownership grids, once per
  //    (game, turn).
  public logTurnState(entry: {
    gameId: string;
    turn: number;
    gameState?: BoardSnapshot | null;
    territory?: any | null;
    cellOwnership?: any | null;
  }): void {
    let gameStateJson: string | null = null;
    let territoryJson: string | null = null;
    let cellOwnershipJson: string | null = null;
    try {
      if (entry.gameState) gameStateJson = JSON.stringify(entry.gameState);
      if (entry.territory) territoryJson = JSON.stringify(entry.territory);
      if (entry.cellOwnership) cellOwnershipJson = JSON.stringify(entry.cellOwnership);
    } catch (e) {
      console.error('[DecisionLogger] Failed to serialize turn state, dropping:', e);
      return;
    }
    if (!gameStateJson && !territoryJson && !cellOwnershipJson) return;

    this.enqueue({
      kind: 'turnState',
      row: {
        gameId: entry.gameId,
        turn: entry.turn,
        gameStateJson,
        territoryJson,
        cellOwnershipJson,
        retries: 0,
      },
    });
  }

  private signalWakeup(): void {
    if (this.wakeup) {
      const w = this.wakeup;
      this.wakeup = null;
      w();
    }
  }

  private waitForWork(): Promise<void> {
    return new Promise<void>(resolve => {
      this.wakeup = resolve;
    });
  }

  private async runWorkerLoop(): Promise<void> {
    while (this.workerRunning || this.queue.length > 0) {
      if (this.queue.length === 0) {
        if (!this.workerRunning) break;
        await this.waitForWork();
        continue;
      }

      const batch = this.queue.splice(0, BATCH_SIZE);
      this.dropScanFrom = Math.max(0, this.dropScanFrom - batch.length);
      for (const consumed of batch) {
        if (consumed.kind !== 'turnState') this.droppableCount--;
      }
      // Process turn-state upserts first (self-contained COALESCE writes),
      // then all inserts, then move-column back-fills, so a back-fill enqueued
      // in the same batch as its target's insert finds the row.
      const turnStateRows = batch
        .filter((item): item is { kind: 'turnState'; row: TurnStateRow } => item.kind === 'turnState')
        .map(item => item.row);
      const rows = batch
        .filter((item): item is { kind: 'insert'; row: SerializedRow } => item.kind === 'insert')
        .map(item => item.row);
      const moveUpdates = batch
        .filter((item): item is { kind: 'moveUpdate'; update: MoveUpdate } => item.kind === 'moveUpdate')
        .map(item => item.update);

      for (const tsRow of turnStateRows) {
        await this.applyTurnStateWithRetry(tsRow);
      }

      if (rows.length > 0) {
        try {
          await this.insertBatch(rows);
        } catch (error) {
          // Batched insert failed — fall back to per-row retry with backoff so
          // one poison row can't block the whole queue.
          console.warn(`[DecisionLogger] Batch insert failed (${rows.length} rows), falling back to per-row retry:`, (error as Error).message);
          for (const row of rows) {
            await this.insertSingleWithRetry(row);
          }
        }
      }

      for (const update of moveUpdates) {
        await this.applyMoveUpdateWithRetry(update);
      }
    }
  }

  // COALESCE upsert: whichever half (board / territory) lands first inserts
  // the row; the other fills its columns in. Real SQL NULLs (never 'null'::
  // jsonb) so IS NULL / IS NOT NULL filters classify rows correctly.
  private async applyTurnState(row: TurnStateRow): Promise<void> {
    const gs = row.gameStateJson === null ? sql`NULL` : sql`${row.gameStateJson}::jsonb`;
    const terr = row.territoryJson === null ? sql`NULL` : sql`${row.territoryJson}::jsonb`;
    const own = row.cellOwnershipJson === null ? sql`NULL` : sql`${row.cellOwnershipJson}::jsonb`;
    await db.execute(sql`
      INSERT INTO turn_states (game_id, turn, game_state, territory, cell_ownership)
      VALUES (${row.gameId}, ${row.turn}, ${gs}, ${terr}, ${own})
      ON CONFLICT (game_id, turn) DO UPDATE SET
        game_state = COALESCE(turn_states.game_state, EXCLUDED.game_state),
        territory = COALESCE(turn_states.territory, EXCLUDED.territory),
        cell_ownership = COALESCE(turn_states.cell_ownership, EXCLUDED.cell_ownership)
    `);
  }

  private async applyTurnStateWithRetry(row: TurnStateRow): Promise<void> {
    while (true) {
      try {
        await this.applyTurnState(row);
        return;
      } catch (error) {
        row.retries++;
        if (row.retries > this.MAX_RETRIES) {
          console.error(`[DecisionLogger] Failed to write turn state after ${this.MAX_RETRIES} retries for game ${row.gameId}, turn ${row.turn}:`, error);
          return;
        }
        const delay = this.RETRY_DELAY_MS * Math.pow(2, row.retries - 1) * (0.5 + Math.random() * 0.5);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private async applyMoveUpdate(update: MoveUpdate): Promise<void> {
    // Back-fill submitted_move / server_move onto the exact decision row for this
    // (game, snake, turn). No-op (zero rows) if the row doesn't exist — e.g. an
    // enemy snake we never logged, or turn 0 (which is answered without a strategy
    // decision, so it's never logged).
    if (update.column === 'submitted_move') {
      await db.execute(sql`
        UPDATE decision_logs
        SET submitted_move = ${update.move}, fatal_consent = ${update.fatalConsent ?? false}
        WHERE game_id = ${update.gameId}
          AND snake_id = ${update.snakeId}
          AND turn = ${update.turn}
      `);
      return;
    }
    await db.execute(sql`
      UPDATE decision_logs SET server_move = ${update.move}
      WHERE game_id = ${update.gameId}
        AND snake_id = ${update.snakeId}
        AND turn = ${update.turn}
    `);
  }

  private async applyMoveUpdateWithRetry(update: MoveUpdate): Promise<void> {
    while (true) {
      try {
        await this.applyMoveUpdate(update);
        return;
      } catch (error) {
        update.retries++;
        if (update.retries > this.MAX_RETRIES) {
          console.error(`[DecisionLogger] Failed to record ${update.column} after ${this.MAX_RETRIES} retries for game ${update.gameId}, snake ${update.snakeId}, turn ${update.turn}:`, error);
          return;
        }
        const delay = this.RETRY_DELAY_MS * Math.pow(2, update.retries - 1) * (0.5 + Math.random() * 0.5);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private async insertBatch(rows: SerializedRow[]): Promise<void> {
    if (rows.length === 0) return;

    // The JSON blobs are kept as pre-serialized strings (memory win) and cast to
    // jsonb via sql`...` so Drizzle doesn't double-encode them. Omitted columns
    // (id/timestamp/created_at/submitted_move/server_move) use their defaults; the
    // two move columns are back-filled later via recordSubmittedMove/recordServerMoves.
    await db.insert(decisionLogs).values(
      rows.map(r => ({
        gameId: r.gameId,
        snakeId: r.snakeId,
        snakeName: r.snakeName,
        turn: r.turn,
        positionX: r.positionX,
        positionY: r.positionY,
        health: r.health,
        safeMoves: r.safeMoves,
        botRecommendation: r.botRecommendation,
        moveEvaluations: sql`${r.moveEvaluationsJson}::jsonb`,
        gameState: sql`${r.gameStateJson}::jsonb`,
      })),
    );
  }

  private async insertSingleWithRetry(row: SerializedRow): Promise<void> {
    while (true) {
      try {
        await this.insertBatch([row]);
        return;
      } catch (error) {
        row.retries++;
        if (row.retries > this.MAX_RETRIES) {
          console.error(`[DecisionLogger] Failed to log after ${this.MAX_RETRIES} retries. Dropping entry for game ${row.gameId}, turn ${row.turn}:`, error);
          this.droppedCount++;
          return;
        }
        const delay = this.RETRY_DELAY_MS * Math.pow(2, row.retries - 1) * (0.5 + Math.random() * 0.5);
        console.warn(`[DecisionLogger] Insert failed, retry ${row.retries}/${this.MAX_RETRIES} after ${Math.round(delay)}ms:`, (error as Error).message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  public async queryLogs(filters: {
    gameId?: string;
    snakeId?: string;
    startTurn?: number;
    endTurn?: number;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    try {
      const conditions = [];
      if (filters.gameId) conditions.push(eq(decisionLogs.gameId, filters.gameId));
      if (filters.snakeId) conditions.push(eq(decisionLogs.snakeId, filters.snakeId));
      if (filters.startTurn !== undefined) conditions.push(gte(decisionLogs.turn, filters.startTurn));
      if (filters.endTurn !== undefined) conditions.push(lte(decisionLogs.turn, filters.endTurn));

      // Alias to snake_case so the returned shape matches what the routes/UI
      // already read (position_x, safe_moves, bot_recommendation, etc.).
      let query = db
        .select({
          id: decisionLogs.id,
          timestamp: decisionLogs.timestamp,
          game_id: decisionLogs.gameId,
          snake_id: decisionLogs.snakeId,
          snake_name: decisionLogs.snakeName,
          turn: decisionLogs.turn,
          position_x: decisionLogs.positionX,
          position_y: decisionLogs.positionY,
          health: decisionLogs.health,
          safe_moves: decisionLogs.safeMoves,
          bot_recommendation: decisionLogs.botRecommendation,
          submitted_move: decisionLogs.submittedMove,
          fatal_consent: decisionLogs.fatalConsent,
          server_move: decisionLogs.serverMove,
          move_evaluations: decisionLogs.moveEvaluations,
          game_state: decisionLogs.gameState,
          created_at: decisionLogs.createdAt,
        })
        .from(decisionLogs)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(decisionLogs.gameId, decisionLogs.snakeId, decisionLogs.turn)
        .$dynamic();

      if (filters.limit) query = query.limit(filters.limit);
      if (filters.offset) query = query.offset(filters.offset);

      return await query;
    } catch (error) {
      console.error('[DecisionLogger] Failed to query logs:', error);
      return [];
    }
  }

  // The per-game board timeline: native turn_states rows merged PER TURN with
  // boards synthesized from old-format decision rows (whose game_state still
  // embeds the full board). Per-turn merging is what makes hybrid games —
  // early turns logged in the old format, later turns in the new, after a
  // mid-game deploy — come out contiguous. `sinceTurn` (BOARD domain) makes
  // the fetch incremental for the client's tail refreshes.
  public async getTurnTimeline(
    gameId: string,
    sinceTurn?: number,
  ): Promise<{ turns: TimelineRow[]; finalTurn: number | null; hasNative: boolean }> {
    try {
      const sinceNative = sinceTurn != null ? sql` AND turn >= ${sinceTurn}` : sql``;
      const sinceSynth = sinceTurn != null
        ? sql` AND (game_state->>'turn')::int >= ${sinceTurn}`
        : sql``;

      const [nativeRes, metaRes, anyNativeRes, anyLegacyRes] = await Promise.all([
        db.execute(sql`
          SELECT turn, game_state, territory, cell_ownership
          FROM turn_states
          WHERE game_id = ${gameId} AND game_state IS NOT NULL${sinceNative}
          ORDER BY turn
        `),
        db.execute(sql`SELECT final_turn FROM games WHERE id = ${gameId}`),
        // Game-level fact, independent of the sinceTurn window: whether ANY
        // native row exists. The client's completeness predicate keys on it
        // (native timelines include the final /end board; synthesized ones
        // end one turn earlier).
        db.execute(sql`
          SELECT 1 FROM turn_states
          WHERE game_id = ${gameId} AND game_state IS NOT NULL
          LIMIT 1
        `),
        // Cheap probe gating the synthesis below: modern games have no
        // board-bearing decision rows, and the synthesis query detoasts every
        // one it scans — skip it entirely unless legacy rows exist.
        db.execute(sql`
          SELECT 1 FROM decision_logs
          WHERE game_id = ${gameId} AND game_state->'board' IS NOT NULL
          LIMIT 1
        `),
      ]);

      // One board candidate per turn from old-format rows. The board is
      // identical across the team's rows for a turn (only `you` differs, and
      // the merge strips it) — snake_id is just a deterministic tiebreak.
      const synthRes = anyLegacyRes.rows.length > 0
        ? await db.execute(sql`
            SELECT DISTINCT ON (((game_state->>'turn')::int))
              game_state,
              move_evaluations->'territoryCells' AS territory,
              move_evaluations->'cellOwnership' AS cell_ownership
            FROM decision_logs
            WHERE game_id = ${gameId}
              AND game_state->'board' IS NOT NULL${sinceSynth}
            ORDER BY ((game_state->>'turn')::int), snake_id
          `)
        : { rows: [] as any[] };

      const turns = mergeTimelineRows(
        nativeRes.rows as unknown as NativeTurnRow[],
        synthRes.rows as unknown as SynthesizedTurnRow[],
      );
      const finalTurnRaw = (metaRes.rows[0] as any)?.final_turn;
      const finalTurn = finalTurnRaw == null ? null : Number(finalTurnRaw);
      return { turns, finalTurn, hasNative: anyNativeRes.rows.length > 0 };
    } catch (error) {
      console.error('[DecisionLogger] Failed to build turn timeline:', error);
      throw error;
    }
  }

  public async getGames(): Promise<GameTeamGroup[]> {
    try {
      // Per (game, snake) aggregate stats joined with a representative (latest)
      // logged game state so we can derive each snake's team identity. We only
      // pull the squad/color/length out of the JSONB blob rather than the whole
      // game_state to keep the listing payload small.
      // The `games` table is the source of truth for which games exist and
      // their metadata; decision_logs is joined only for per-snake/team detail
      // (colors, lengths, turn counts). Games with a row but no decision logs
      // yet (e.g. just-started) are naturally excluded, matching prior behavior.
      const result = await db.execute(sql`
        WITH g AS (
          SELECT id, started_at, ended_at, final_turn,
                 board_width, board_height, ruleset_name,
                 winner_snake_id, winner_name, end_reason
          FROM games
          ORDER BY COALESCE(started_at, created_at) DESC
          LIMIT 500
        ),
        agg AS (
          SELECT
            game_id,
            snake_id,
            MAX(turn) - MIN(turn) + 1 AS turns,
            MAX(timestamp) AS timestamp
          FROM decision_logs
          WHERE game_id IN (SELECT id FROM g)
          GROUP BY game_id, snake_id
        ),
        latest AS (
          SELECT DISTINCT ON (game_id, snake_id)
            game_id,
            snake_id,
            snake_name,
            game_state->'you'->>'squad' AS squad,
            -- Modern slim rows carry teamID directly on 'you'; legacy rows
            -- only carried it on the board snakes.
            COALESCE(
              game_state->'you'->>'teamID',
              (SELECT s->>'teamID'
                 FROM jsonb_array_elements(game_state->'board'->'snakes') s
                 WHERE s->>'id' = snake_id
                 LIMIT 1)) AS team_id,
            game_state->'you'->>'name' AS you_name,
            game_state->'you'->>'letter' AS letter,
            game_state->'you'->'customizations'->>'color' AS color,
            (game_state->'you'->>'length')::int AS length
          FROM decision_logs
          WHERE game_id IN (SELECT id FROM g)
          ORDER BY game_id, snake_id, turn DESC
        )
        SELECT
          a.game_id,
          a.snake_id,
          l.snake_name,
          a.turns,
          a.timestamp,
          l.squad,
          l.team_id,
          l.you_name,
          l.letter,
          l.color,
          l.length,
          g.started_at,
          g.ended_at,
          g.final_turn,
          g.board_width,
          g.board_height,
          g.ruleset_name,
          g.winner_snake_id,
          g.winner_name,
          g.end_reason
        FROM g
        JOIN agg a ON a.game_id = g.id
        JOIN latest l USING (game_id, snake_id)
        ORDER BY a.timestamp DESC
      `);
      return this.groupGamesByTeam(result.rows as any);
    } catch (error) {
      console.error('[DecisionLogger] Failed to get games:', error);
      return [];
    }
  }

  // Collapses per-snake rows into one entry per (game, team) pair. Team identity
  // is derived with the same squad → color → id rule the live bot uses, so the
  // history grouping matches in-game team behavior. Rows are already ordered by
  // timestamp DESC, so the first time a group is seen sets its sort position.
  private groupGamesByTeam(
    rows: {
      game_id: string;
      snake_id: string;
      snake_name: string | null;
      turns: number | string;
      timestamp: string;
      squad: string | null;
      team_id: string | null;
      you_name: string | null;
      letter: string | null;
      color: string | null;
      length: number | null;
      started_at: string | null;
      ended_at: string | null;
      final_turn: number | null;
      board_width: number | null;
      board_height: number | null;
      ruleset_name: string | null;
      winner_snake_id: string | null;
      winner_name: string | null;
      end_reason: string | null;
    }[],
  ): GameTeamGroup[] {
    const groups = new Map<string, GameTeamGroup>();

    for (const row of rows) {
      const teamKey = TeamDetector.getTeamKey({
        id: row.snake_id,
        squad: row.squad ?? '',
        customizations: { color: row.color ?? '', head: '', tail: '' },
      });
      const groupKey = `${row.game_id}::${teamKey}`;
      const turns = typeof row.turns === 'string' ? parseInt(row.turns, 10) : row.turns;

      let group = groups.get(groupKey);
      if (!group) {
        group = {
          game_id: row.game_id,
          team_key: teamKey,
          // Prefer the human-readable team name derived from the snake's own
          // name ("<team name> <letter>" per translate.ts) — this is the
          // centaur identity we played as. Fall back to the game-server team
          // id, squad, then color so we never surface a raw hex code or uuid.
          team_label:
            deriveTeamName(row.you_name, row.letter) ||
            prettifyTeamName(row.team_id) ||
            row.squad ||
            row.color ||
            'Team',
          team_color: row.color,
          timestamp: row.timestamp,
          turns,
          default_snake_id: row.snake_id,
          snakes: [],
          started_at: row.started_at ?? null,
          ended_at: row.ended_at ?? null,
          final_turn: row.final_turn ?? null,
          board_width: row.board_width ?? null,
          board_height: row.board_height ?? null,
          ruleset_name: row.ruleset_name ?? null,
          winner_snake_id: row.winner_snake_id ?? null,
          winner_name: row.winner_name ?? null,
          end_reason: row.end_reason ?? null,
        };
        groups.set(groupKey, group);
      }

      group.snakes.push({
        snake_id: row.snake_id,
        snake_name: row.snake_name || 'Unknown',
        color: row.color,
        length: row.length,
        turns,
      });

      // Keep the group timestamp/turn count as the max across its members.
      if (row.timestamp > group.timestamp) group.timestamp = row.timestamp;
      if (turns > group.turns) group.turns = turns;
      if (!group.team_color && row.color) group.team_color = row.color;
    }

    // Default perspective per group = the longest member (primary), a neutral
    // default for the viewer.
    for (const group of groups.values()) {
      let primary = group.snakes[0];
      for (const member of group.snakes) {
        if ((member.length ?? 0) > (primary.length ?? 0)) primary = member;
      }
      group.default_snake_id = primary.snake_id;
    }

    return Array.from(groups.values());
  }

  public async clearOldLogs(daysToKeep: number = 7): Promise<void> {
    try {
      await db.execute(sql`
        DELETE FROM decision_logs
        WHERE timestamp < NOW() - (${daysToKeep} * INTERVAL '1 day')
      `);
      // The board timelines age out with their decision rows — turn_states is
      // where the bulky per-turn game_state blobs live now, so pruning only
      // decision_logs would leave storage growing unbounded.
      await db.execute(sql`
        DELETE FROM turn_states
        WHERE created_at < NOW() - (${daysToKeep} * INTERVAL '1 day')
      `);
      console.log(`[DecisionLogger] Cleared logs older than ${daysToKeep} days`);
    } catch (error) {
      console.error('[DecisionLogger] Failed to clear old logs:', error);
    }
  }

  // Flush and stop the worker. Does NOT close the shared pg pool — pool.end()
  // is owned by the controller-orchestrated graceful shutdown in src/index.ts,
  // which runs it after BOTH the CommandLogger and DecisionLogger flushes.
  public async shutdown(): Promise<void> {
    console.log(`[DecisionLogger] Shutting down, flushing ${this.queue.length} queued entries...`);

    this.workerRunning = false;
    this.signalWakeup();

    await this.workerPromise;

    if (this.droppedCount > 0) {
      console.warn(`[DecisionLogger] Shutdown complete. Total dropped entries: ${this.droppedCount}`);
    } else {
      console.log('[DecisionLogger] Shutdown complete. All entries flushed.');
    }
  }

  public getQueueStats(): { queueSize: number; droppedCount: number; maxQueueSize: number } {
    return {
      queueSize: this.queue.length,
      droppedCount: this.droppedCount,
      maxQueueSize: this.MAX_QUEUE_SIZE,
    };
  }
}
