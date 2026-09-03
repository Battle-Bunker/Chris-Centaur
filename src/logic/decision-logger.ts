import { sql } from 'drizzle-orm';
import { db, dbConfigured } from '../database/db';
import { transientDelay } from '../server/activity-controller';
import { BoardSnapshot } from '../types/battlesnake';
import { TeamDetector } from './team-detector';
import {
  deleteMovesetsFor,
  writeDecision,
  writeMovesetRows,
  writeTurnBoard,
  writeUnitOutcome,
  type RosterEntry,
} from '../lens/store/persistence';
import type {
  CellIndex,
  DecisionRow,
  GameId,
  MovesetProjectionRow,
  Turn,
  UnitKey,
  UnitOutcomeRow,
} from '../lens/types';
import { rosterOf } from './turn-timeline';

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

/** One canonical board per (game, BOARD turn), as served to the timeline. */
export interface TimelineRow {
  turn: number;
  game_state: unknown;
  native: boolean;
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
// name doesn't follow that shape.
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

/** A `turn_boards` upsert. JSON is pre-serialized at enqueue time so the live
 *  object graph is GC-eligible the moment the call returns. */
interface BoardWrite {
  gameId: GameId;
  turn: Turn;
  settlementJson: string;
  boardHash: string | null;
  deadlineMs: number | null;
  rosterJson: string | null;
}

/**
 * The queue's four items, and the one that may be dropped.
 *
 * `movesets` is DROPPABLE and nothing else is, and that is not a convenience:
 * the projection's whole licence to exist is that `scripts/lens-rebuild.js`
 * regenerates it byte-identically from `turn_events` (04 §2.7). Losing a
 * projection row costs a rebuild. Losing a board, a decision seed or an
 * outcome loses the only copy of something nothing can recompute.
 */
type QueueItem =
  | { kind: 'board'; row: BoardWrite; retries: number }
  | { kind: 'decision'; row: DecisionRow; retries: number }
  | { kind: 'outcome'; row: UnitOutcomeRow; retries: number }
  | { kind: 'movesets'; decisionId: string; rows: ReadonlyArray<MovesetProjectionRow>; retries: number };

const BATCH_SIZE = 100;

/**
 * The lens store's writer: `turn_boards`, `decisions`, `movesets` and
 * `unit_outcomes`.
 *
 * WHAT IT NO LONGER DOES. There is no `logDecision` row path. The old one
 * wrote one row per unit per turn carrying `move_evaluations` — up to six
 * explained candidates per unit with full feature breakdowns — plus a
 * `game_state` blob duplicated across every unit of the turn. Its premise was
 * that a joint plan's value decomposes onto its units, which the evaluator
 * itself measures as false in both directions, so the table was an expensive
 * account of a question the bot does not ask. The account survives as the
 * `movesets` projection (a whole-board bracket per cluster restriction, with
 * the named joint residual) and `unit_outcomes` (what actually happened to
 * each unit), and it is roughly an order of magnitude smaller.
 *
 * The queue-worker design is unchanged and deliberately so: enqueue is
 * synchronous and never throws into the game path, and a background loop
 * batches with per-row retry fallback.
 */
export class DecisionLogger {
  private static instance: DecisionLogger;

  private readonly MAX_QUEUE_SIZE = 50000;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 100;
  private queue: QueueItem[] = [];
  private droppedCount = 0;
  // O(1) support for the drop preference in enqueue(): how many queued items
  // are droppable (kind === 'movesets'), and the index below which the queue is
  // known to hold only undroppable items, so the drop scan never re-reads that
  // prefix. Invariant: queue[i].kind !== 'movesets' for all i < dropScanFrom.
  private droppableCount = 0;
  private dropScanFrom = 0;

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

  /**
   * The re-run input AND the fold's t0 anchor, once per (game, BOARD turn).
   * `roster` is derived here rather than asked of the caller: it is a
   * projection of the settlement, and asking two callers for it would be two
   * chances to disagree about who was on the board.
   */
  public logTurnBoard(entry: {
    gameId: GameId;
    turn: Turn;
    settlement: BoardSnapshot;
    boardHash?: string | null;
    deadlineMs?: number | null;
  }): void {
    let settlementJson: string;
    let rosterJson: string | null;
    try {
      settlementJson = JSON.stringify(entry.settlement);
      rosterJson = JSON.stringify(rosterOf(entry.settlement));
    } catch (e) {
      console.error('[DecisionLogger] Failed to serialize turn board, dropping:', e);
      return;
    }
    this.enqueue({
      kind: 'board',
      row: {
        gameId: entry.gameId,
        turn: entry.turn,
        settlementJson,
        boardHash: entry.boardHash ?? null,
        deadlineMs: entry.deadlineMs ?? null,
        rosterJson,
      },
      retries: 0,
    });
  }

  /** One decision's seed and summary. Small, and the basis of every lazy
   *  re-derivation a folded turn still answers. */
  public logDecisionRecord(row: DecisionRow): void {
    this.enqueue({ kind: 'decision', row, retries: 0 });
  }

  /** The `movesets` projection for one decision, replacing whatever is there:
   *  DELETE-then-insert is the only write path, so there is exactly one way to
   *  arrive at a row and nothing for a partial update to half-apply. */
  public logMovesets(decisionId: string, rows: ReadonlyArray<MovesetProjectionRow>): void {
    this.enqueue({ kind: 'movesets', decisionId, rows, retries: 0 });
  }

  /** One unit's outcome, merged into whatever is already known about it.
   *  Request, confirmation, commit and resolution are four facts about one row
   *  arriving in an order the network chooses. */
  public recordUnitOutcome(
    partial: Pick<UnitOutcomeRow, 'gameId' | 'turn' | 'unitKey'> & Partial<UnitOutcomeRow>
  ): void {
    this.enqueue({
      kind: 'outcome',
      row: {
        unitName: null,
        clusterId: null,
        stagedMove: null,
        stagedSource: null,
        confirmedMove: null,
        committed: false,
        resolvedMove: null,
        fatalConsent: null,
        operatorId: null,
        ...partial,
      },
      retries: 0,
    });
  }

  /**
   * The move we actually submitted for a unit's BOARD turn.
   *
   * `turn` is the board turn, full stop. The `board turn + 1` decision-log
   * domain is deleted with the table that had it: one turn domain, in every
   * table and on every event, so a reader never has to know which of two
   * numbering conventions a column was written under (01 §9.3).
   */
  public recordSubmittedMove(
    gameId: GameId,
    unitKey: UnitKey,
    turn: Turn,
    to: CellIndex,
    fatalConsent: boolean = false
  ): void {
    this.recordUnitOutcome({
      gameId,
      turn,
      unitKey,
      confirmedMove: to,
      committed: true,
      fatalConsent,
    });
  }

  /**
   * The moves the server actually applied, from an arriving board's
   * `lastMoves`. `lastMoves` on board turn T describes the transition
   * T-1 → T, so the outcome row it fills is turn T-1's — and, again, that is
   * the board turn and nothing offset from it.
   */
  public recordServerMoves(
    gameId: GameId,
    resolvedTurn: Turn,
    moves: ReadonlyArray<{ unit: UnitKey; to: CellIndex }>
  ): void {
    for (const move of moves) {
      this.recordUnitOutcome({
        gameId,
        turn: resolvedTurn,
        unitKey: move.unit,
        resolvedMove: move.to,
      });
    }
  }

  // Single bounded enqueue for EVERY queue item, so a prolonged DB outage
  // can't grow the queue without bound no matter which producer is hot. When
  // full, drop the oldest projection batch: `movesets` is regenerable from
  // `turn_events` by the rebuild command, and every other item is the only
  // copy of something nothing can recompute.
  private enqueue(item: QueueItem): void {
    // No database configured: skip persistence entirely (announced once at
    // boot by db.ts) instead of queueing rows destined for per-row retry spam
    // against a socket that can never connect.
    if (!dbConfigured) return;
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      let dropIdx = 0;
      if (this.droppableCount > 0) {
        // Amortized O(1): everything before dropScanFrom is undroppable, so
        // the scan resumes there; droppableCount > 0 guarantees a hit.
        let i = this.dropScanFrom;
        while (this.queue[i].kind !== 'movesets') i++;
        dropIdx = i;
        this.dropScanFrom = i;
      }
      const dropped = this.queue.splice(dropIdx, 1)[0];
      if (dropped.kind === 'movesets') this.droppableCount--;
      if (dropIdx < this.dropScanFrom) this.dropScanFrom--;
      this.droppedCount++;
      if (this.droppedCount % 100 === 0) {
        console.warn(
          `[DecisionLogger] Queue full! Dropped ${this.droppedCount} total entries. ` +
            `Last dropped: kind=${dropped.kind}`
        );
      }
    }
    this.queue.push(item);
    if (item.kind === 'movesets') this.droppableCount++;
    this.signalWakeup();
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
      for (const item of batch) {
        if (item.kind === 'movesets') this.droppableCount--;
      }

      // Boards first, then decisions, then the projection that references a
      // decision, then outcomes. Ordering within a batch is what lets a
      // projection enqueued alongside its decision find one already written.
      for (const item of batch.filter(i => i.kind === 'board')) await this.withRetry(item);
      for (const item of batch.filter(i => i.kind === 'decision')) await this.withRetry(item);
      for (const item of batch.filter(i => i.kind === 'movesets')) await this.withRetry(item);
      for (const item of batch.filter(i => i.kind === 'outcome')) await this.withRetry(item);
    }
  }

  private async apply(item: QueueItem): Promise<void> {
    switch (item.kind) {
      case 'board':
        return writeTurnBoard(item.row);
      case 'decision':
        return writeDecision(item.row);
      case 'outcome':
        return writeUnitOutcome(item.row);
      case 'movesets':
        await deleteMovesetsFor(item.decisionId);
        return writeMovesetRows(item.rows);
    }
  }

  private async withRetry(item: QueueItem): Promise<void> {
    while (true) {
      try {
        await this.apply(item);
        return;
      } catch (error) {
        item.retries++;
        if (item.retries > this.MAX_RETRIES) {
          console.error(
            `[DecisionLogger] Failed to write ${item.kind} after ${this.MAX_RETRIES} retries:`,
            error
          );
          this.droppedCount++;
          return;
        }
        const delay = this.RETRY_DELAY_MS * Math.pow(2, item.retries - 1) * (0.5 + Math.random() * 0.5);
        await transientDelay(delay);
      }
    }
  }

  /**
   * The per-game board timeline: one canonical board per turn, straight out of
   * `turn_boards`.
   *
   * There is no merge any more. The old path synthesised a board from a
   * per-snake decision row for games logged before `turn_states` existed, and
   * merged that per turn with native rows so a mid-deploy hybrid game came out
   * contiguous. Both halves are gone: there is no per-snake row to synthesise
   * from, and no backwards compatibility to preserve. `native` stays on the
   * row and is always true, because the client's completeness predicate reads
   * it and a field that is always true is cheaper to keep honest than a
   * protocol change is to coordinate across three tracks.
   */
  public async getTurnTimeline(
    gameId: string,
    sinceTurn?: number,
  ): Promise<{ turns: TimelineRow[]; finalTurn: number | null; hasNative: boolean }> {
    try {
      const since = sinceTurn != null ? sql` AND turn >= ${sinceTurn}` : sql``;
      const [boardRes, metaRes] = await Promise.all([
        db.execute(sql`
          SELECT turn, settlement
          FROM turn_boards
          WHERE game_id = ${gameId}${since}
          ORDER BY turn
        `),
        db.execute(sql`SELECT final_turn FROM games WHERE id = ${gameId}`),
      ]);

      const turns: TimelineRow[] = (boardRes.rows as unknown as {
        turn: number;
        settlement: unknown;
      }[]).map(r => ({ turn: Number(r.turn), game_state: r.settlement, native: true }));

      const finalTurnRaw = (metaRes.rows[0] as { final_turn?: number | string } | undefined)?.final_turn;
      const finalTurn = finalTurnRaw == null ? null : Number(finalTurnRaw);
      return { turns, finalTurn, hasNative: turns.length > 0 };
    } catch (error) {
      console.error('[DecisionLogger] Failed to build turn timeline:', error);
      throw error;
    }
  }

  /**
   * The event log, filtered. This is what `/api/logs` answers now: the rows
   * the decision actually produced, in the one order there is, rather than a
   * per-unit projection of a joint object.
   */
  public async queryLogs(filters: {
    gameId?: string;
    unitKey?: string;
    kind?: string;
    startTurn?: number;
    endTurn?: number;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]> {
    try {
      const clauses = [sql`TRUE`];
      if (filters.gameId) clauses.push(sql`game_id = ${filters.gameId}`);
      if (filters.unitKey) clauses.push(sql`unit_key = ${filters.unitKey}`);
      if (filters.kind) clauses.push(sql`kind = ${filters.kind}`);
      if (filters.startTurn !== undefined) clauses.push(sql`turn >= ${filters.startTurn}`);
      if (filters.endTurn !== undefined) clauses.push(sql`turn <= ${filters.endTurn}`);
      const where = clauses.reduce((acc, c) => sql`${acc} AND ${c}`);

      const result = await db.execute(sql`
        SELECT payload
        FROM turn_events
        WHERE ${where}
        ORDER BY turn, seq
        LIMIT ${filters.limit ?? 1000}
        OFFSET ${filters.offset ?? 0}
      `);
      return (result.rows as unknown as { payload: unknown }[]).map(r => r.payload);
    } catch (error) {
      console.error('[DecisionLogger] Failed to query turn events:', error);
      return [];
    }
  }

  /**
   * The history viewer's left panel: one entry per (game, team).
   *
   * Grouped off `turn_boards.roster` — the identity strip stored beside each
   * settlement — rather than off a per-snake decision row's embedded
   * `game_state`. That is one row per turn instead of one per unit per turn,
   * and it means a listing never detoasts a board.
   */
  public async getGames(): Promise<GameTeamGroup[]> {
    try {
      const result = await db.execute(sql`
        WITH g AS (
          SELECT id, started_at, ended_at, final_turn,
                 board_width, board_height, ruleset_name,
                 winner_snake_id, winner_name, end_reason,
                 COALESCE(started_at, created_at) AS sort_at
          FROM games
          ORDER BY COALESCE(started_at, created_at) DESC
          LIMIT 500
        ),
        span AS (
          SELECT game_id,
                 MAX(turn) - MIN(turn) + 1 AS turns,
                 MAX(created_at) AS timestamp
          FROM turn_boards
          WHERE game_id IN (SELECT id FROM g)
          GROUP BY game_id
        ),
        latest AS (
          SELECT DISTINCT ON (game_id) game_id, roster
          FROM turn_boards
          WHERE game_id IN (SELECT id FROM g) AND roster IS NOT NULL
          ORDER BY game_id, turn DESC
        )
        SELECT g.id AS game_id, g.started_at, g.ended_at, g.final_turn,
               g.board_width, g.board_height, g.ruleset_name,
               g.winner_snake_id, g.winner_name, g.end_reason,
               s.turns, s.timestamp, l.roster
        FROM g
        JOIN span s ON s.game_id = g.id
        LEFT JOIN latest l ON l.game_id = g.id
        ORDER BY s.timestamp DESC
      `);
      return groupGamesByTeam(result.rows as unknown as GameListingRow[]);
    } catch (error) {
      console.error('[DecisionLogger] Failed to get games:', error);
      return [];
    }
  }

  /**
   * The hot window's floor for everything the lens writes EXCEPT the two
   * classes retained forever. `turn_boards` and `decisions` stay: they are the
   * re-run input and the basis, they are small, and without them a folded turn
   * stops being inspectable and starts being lost.
   */
  public async clearOldLogs(daysToKeep: number = 7): Promise<void> {
    try {
      await db.execute(sql`
        DELETE FROM movesets WHERE decision_id IN (
          SELECT id FROM decisions
          WHERE started_at < ${Date.now() - daysToKeep * 24 * 60 * 60 * 1000}
        )
      `);
      console.log(`[DecisionLogger] Cleared moveset projections older than ${daysToKeep} days`);
    } catch (error) {
      console.error('[DecisionLogger] Failed to clear old projections:', error);
    }
  }

  // Flush and stop the worker. Does NOT close the shared pg pool — pool.end()
  // is owned by the controller-orchestrated graceful shutdown in src/index.ts,
  // which runs it after BOTH the CommandLogger and DecisionLogger flushes.
  //
  // The flush is DEADLINE-CAPPED: against an unreachable database the batch +
  // per-row retry + backoff worker was observed grinding for ~3 minutes under
  // SIGTERM, delaying exit only to drop most entries anyway.
  public async shutdown(timeoutMs = 4000): Promise<void> {
    console.log(`[DecisionLogger] Shutting down, flushing ${this.queue.length} queued entries...`);

    this.workerRunning = false;
    this.signalWakeup();

    const flushed = await Promise.race([
      this.workerPromise.then(() => true),
      transientDelay(timeoutMs).then(() => false),
    ]);
    if (!flushed) {
      console.warn(
        `[DecisionLogger] Shutdown flush deadline (${timeoutMs}ms) reached; ` +
        `dropping ${this.queue.length} unflushed entries.`
      );
      return;
    }

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

interface GameListingRow {
  game_id: string;
  turns: number | string;
  timestamp: string;
  roster: RosterEntry[] | null;
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

/**
 * Collapses one game's roster into one entry per (game, team) pair. Team
 * identity is derived with the same squad → color → id rule the live bot uses,
 * so the history grouping matches in-game team behaviour.
 */
function groupGamesByTeam(rows: GameListingRow[]): GameTeamGroup[] {
  const groups = new Map<string, GameTeamGroup>();

  for (const row of rows) {
    const turns = typeof row.turns === 'string' ? parseInt(row.turns, 10) : row.turns;
    for (const member of row.roster ?? []) {
      const teamKey = TeamDetector.getTeamKey({
        id: member.unit,
        squad: member.squad ?? '',
        customizations: { color: member.color ?? '', head: '', tail: '' },
      });
      const groupKey = `${row.game_id}::${teamKey}`;

      let group = groups.get(groupKey);
      if (!group) {
        group = {
          game_id: row.game_id,
          team_key: teamKey,
          // Prefer the human-readable team name: the snapshotted centaur name
          // first, then the one derived from the snake's own name
          // ("<team name> <letter>" per translate.ts), then the game-server
          // team id, squad and colour — so a raw hex code or uuid is the last
          // thing a reader is ever shown, not the first.
          team_label:
            member.teamName ||
            deriveTeamName(member.name, member.letter) ||
            prettifyTeamName(member.teamId) ||
            member.squad ||
            member.color ||
            'Team',
          team_color: member.color,
          timestamp: row.timestamp,
          turns,
          default_snake_id: member.unit,
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
        snake_id: member.unit,
        snake_name: member.name || 'Unknown',
        color: member.color,
        length: member.length,
        turns,
      });
      if (!group.team_color && member.color) group.team_color = member.color;
    }
  }

  // Default perspective per group = the longest member (primary), a neutral
  // default for the viewer.
  for (const group of groups.values()) {
    let primary = group.snakes[0];
    for (const member of group.snakes) {
      if ((member.length ?? 0) > (primary.length ?? 0)) primary = member;
    }
    if (primary) group.default_snake_id = primary.snake_id;
  }

  return [...groups.values()];
}
