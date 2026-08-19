import { eq, sql } from 'drizzle-orm';
import { db, dbConfigured } from '../database/db';
import { transientDelay } from '../server/activity-controller';
import { commandEvents, commandTurnStates } from '../database/schema';

// The operator identity attached to commands: the enrolled player who issued
// the command, with the stable per-game colour their commands render in.
export interface OperatorRef {
  userId: string;
  name: string;
  color: string;
}

// One command event as handed to logEvent. `turn` is the board turn that was
// current when the command was issued; `operator` is null for system events
// (e.g. a goto queue shifting on arrival).
export interface CommandEventEntry {
  gameId: string;
  snakeId: string | null;
  turn: number;
  eventType: string;
  operator: OperatorRef | null;
  payload: unknown;
}

// Compact pre-serialized rows (same pattern as DecisionLogger): only
// primitives + already-stringified JSON, so the source object graphs are
// GC-eligible the moment logEvent/logTurnState returns.
interface SerializedEvent {
  gameId: string;
  snakeId: string | null;
  turn: number;
  eventType: string;
  operatorId: string | null;
  operatorName: string | null;
  operatorColor: string | null;
  payloadJson: string | null;
  retries: number;
}

interface SerializedTurnState {
  gameId: string;
  turn: number;
  stateJson: string;
  retries: number;
}

type QueueItem =
  | { kind: 'event'; row: SerializedEvent }
  | { kind: 'turnState'; row: SerializedTurnState };

const BATCH_SIZE = 100;

/**
 * Async, non-blocking writer for operator command events and per-turn command
 * state snapshots (see the schema comments on command_events /
 * command_turn_states). Mirrors DecisionLogger's queue-worker design: enqueue
 * is synchronous and never throws into the game path; a background loop
 * batches inserts with per-row retry fallback. Does NOT own the pg pool —
 * shutdown() only flushes.
 */
export class CommandLogger {
  private static instance: CommandLogger;

  private readonly MAX_QUEUE_SIZE = 20000;
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

  private workerRunning = true;
  private workerPromise: Promise<void>;
  private wakeup: (() => void) | null = null;

  private constructor() {
    this.workerPromise = this.runWorkerLoop();
  }

  public static getInstance(): CommandLogger {
    if (!CommandLogger.instance) {
      CommandLogger.instance = new CommandLogger();
    }
    return CommandLogger.instance;
  }

  public logEvent(entry: CommandEventEntry): void {
    let payloadJson: string | null = null;
    try {
      payloadJson = entry.payload === undefined ? null : JSON.stringify(entry.payload);
    } catch (e) {
      console.error('[CommandLogger] Failed to serialize event payload, logging without it:', e);
    }
    this.enqueue({
      kind: 'event',
      row: {
        gameId: entry.gameId,
        snakeId: entry.snakeId,
        turn: entry.turn,
        eventType: entry.eventType,
        operatorId: entry.operator?.userId ?? null,
        operatorName: entry.operator?.name ?? null,
        operatorColor: entry.operator?.color ?? null,
        payloadJson,
        retries: 0,
      },
    });
  }

  public logTurnState(gameId: string, turn: number, state: unknown): void {
    let stateJson: string;
    try {
      stateJson = JSON.stringify(state);
    } catch (e) {
      console.error('[CommandLogger] Failed to serialize turn state, dropping:', e);
      return;
    }
    this.enqueue({ kind: 'turnState', row: { gameId, turn, stateJson, retries: 0 } });
  }

  // When full, prefer dropping the oldest non-turnState item (same preference
  // as DecisionLogger): turn-state snapshots are captured once per turn and
  // never re-delivered, so losing one punches a permanent hole in the replay's
  // command overlays, while a dropped command event costs one audit row.
  private enqueue(item: QueueItem): void {
    // No database configured: skip persistence entirely (announced once at
    // boot by db.ts) instead of queueing rows destined for per-row retry spam
    // against a socket that can never connect.
    if (!dbConfigured) return;
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      let dropIdx = 0;
      if (this.droppableCount > 0) {
        // Amortized O(1): everything before dropScanFrom is turn-state, so
        // resume the scan there; droppableCount > 0 guarantees a hit.
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
        console.warn(`[CommandLogger] Queue full! Dropped ${this.droppedCount} total entries. Last dropped: kind=${dropped.kind}`);
      }
    }
    this.queue.push(item);
    if (item.kind !== 'turnState') this.droppableCount++;
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
      const events = batch
        .filter((i): i is { kind: 'event'; row: SerializedEvent } => i.kind === 'event')
        .map(i => i.row);
      const states = batch
        .filter((i): i is { kind: 'turnState'; row: SerializedTurnState } => i.kind === 'turnState')
        .map(i => i.row);
      this.droppableCount -= events.length;

      if (events.length > 0) {
        try {
          await this.insertEvents(events);
        } catch (error) {
          console.warn(`[CommandLogger] Batch event insert failed (${events.length} rows), falling back to per-row retry:`, (error as Error).message);
          for (const row of events) {
            await this.withRetry(() => this.insertEvents([row]), row, 'event');
          }
        }
      }

      for (const row of states) {
        await this.withRetry(() => this.insertTurnState(row), row, 'turnState');
      }
    }
  }

  private async insertEvents(rows: SerializedEvent[]): Promise<void> {
    if (rows.length === 0) return;
    await db.insert(commandEvents).values(
      rows.map(r => ({
        gameId: r.gameId,
        snakeId: r.snakeId,
        turn: r.turn,
        eventType: r.eventType,
        operatorId: r.operatorId,
        operatorName: r.operatorName,
        operatorColor: r.operatorColor,
        payload: r.payloadJson === null ? null : sql`${r.payloadJson}::jsonb`,
      })),
    );
  }

  private async insertTurnState(row: SerializedTurnState): Promise<void> {
    // A turn resolves exactly once per game, but process restarts / replayed
    // snapshots must never poison the queue — first write wins.
    await db
      .insert(commandTurnStates)
      .values({
        gameId: row.gameId,
        turn: row.turn,
        state: sql`${row.stateJson}::jsonb`,
      })
      .onConflictDoNothing();
  }

  private async withRetry(
    op: () => Promise<void>,
    row: { retries: number; gameId: string; turn: number },
    label: string
  ): Promise<void> {
    while (true) {
      try {
        await op();
        return;
      } catch (error) {
        row.retries++;
        if (row.retries > this.MAX_RETRIES) {
          console.error(`[CommandLogger] Failed to write ${label} after ${this.MAX_RETRIES} retries for game ${row.gameId}, turn ${row.turn}:`, error);
          this.droppedCount++;
          return;
        }
        const delay = this.RETRY_DELAY_MS * Math.pow(2, row.retries - 1) * (0.5 + Math.random() * 0.5);
        await transientDelay(delay);
      }
    }
  }

  // Everything the history viewer needs for one game: the raw command events
  // in issue order, and the per-turn command-state snapshots keyed by the
  // board turn they describe the END of.
  public async getGameCommands(gameId: string): Promise<{
    events: Array<{
      id: number;
      timestamp: Date | string;
      turn: number;
      snake_id: string | null;
      event_type: string;
      operator: OperatorRef | null;
      payload: unknown;
    }>;
    turnStates: { [turn: number]: unknown };
  }> {
    try {
      const [eventRows, stateRows] = await Promise.all([
        db
          .select({
            id: commandEvents.id,
            timestamp: commandEvents.timestamp,
            turn: commandEvents.turn,
            snakeId: commandEvents.snakeId,
            eventType: commandEvents.eventType,
            operatorId: commandEvents.operatorId,
            operatorName: commandEvents.operatorName,
            operatorColor: commandEvents.operatorColor,
            payload: commandEvents.payload,
          })
          .from(commandEvents)
          .where(eq(commandEvents.gameId, gameId))
          .orderBy(commandEvents.id),
        db
          .select({
            turn: commandTurnStates.turn,
            state: commandTurnStates.state,
          })
          .from(commandTurnStates)
          .where(eq(commandTurnStates.gameId, gameId))
          .orderBy(commandTurnStates.turn),
      ]);

      const turnStates: { [turn: number]: unknown } = {};
      for (const row of stateRows) {
        turnStates[row.turn] = row.state;
      }
      return {
        events: eventRows.map(r => ({
          id: r.id,
          timestamp: r.timestamp,
          turn: r.turn,
          snake_id: r.snakeId,
          event_type: r.eventType,
          operator: r.operatorId
            ? { userId: r.operatorId, name: r.operatorName || 'Player', color: r.operatorColor || '#888888' }
            : null,
          payload: r.payload,
        })),
        turnStates,
      };
    } catch (error) {
      console.error('[CommandLogger] Failed to query game commands:', error);
      return { events: [], turnStates: {} };
    }
  }

  public async clearOldCommands(daysToKeep: number = 7): Promise<void> {
    try {
      await db.execute(sql`
        DELETE FROM command_events
        WHERE timestamp < NOW() - (${daysToKeep} * INTERVAL '1 day')
      `);
      await db.execute(sql`
        DELETE FROM command_turn_states
        WHERE created_at < NOW() - (${daysToKeep} * INTERVAL '1 day')
      `);
      console.log(`[CommandLogger] Cleared command logs older than ${daysToKeep} days`);
    } catch (error) {
      console.error('[CommandLogger] Failed to clear old command logs:', error);
    }
  }

  // Flush and stop the worker. Does NOT close the shared pg pool — pool.end()
  // is owned by the controller-orchestrated graceful shutdown in src/index.ts,
  // which runs it after BOTH logger flushes.
  //
  // Deadline-capped like DecisionLogger.shutdown (and ServerEventLogger's
  // bounded shutdown-flush): an unreachable database must cost seconds, not
  // minutes, of shutdown time.
  public async shutdown(timeoutMs = 2000): Promise<void> {
    console.log(`[CommandLogger] Shutting down, flushing ${this.queue.length} queued entries...`);
    this.workerRunning = false;
    this.signalWakeup();
    const flushed = await Promise.race([
      this.workerPromise.then(() => true),
      transientDelay(timeoutMs).then(() => false),
    ]);
    if (!flushed) {
      console.warn(
        `[CommandLogger] Shutdown flush deadline (${timeoutMs}ms) reached; ` +
        `dropping ${this.queue.length} unflushed entries.`
      );
      return;
    }
    if (this.droppedCount > 0) {
      console.warn(`[CommandLogger] Shutdown complete. Total dropped entries: ${this.droppedCount}`);
    }
  }
}
