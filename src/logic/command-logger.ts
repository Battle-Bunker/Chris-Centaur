import { and, gte, lte, sql } from 'drizzle-orm';
import { db, dbConfigured } from '../database/db';
import { transientDelay } from '../server/activity-controller';
import { turnEvents } from '../database/schema';
import { encodeEventRow } from '../lens/store';
import { writeEventRows } from '../lens/store/persistence';
import type { SelectionPayload, TurnEvent, TurnEventRow } from '../lens/types';

// The operator identity attached to commands: the enrolled player who issued
// the command, with the stable per-game colour their commands render in.
export interface OperatorRef {
  userId: string;
  name: string;
  color: string;
}

interface QueueItem {
  row: TurnEventRow;
  /**
   * Whether losing this row costs anything. See `enqueue`: only an ATTENTION
   * tick is droppable. Everything else is a fact about what happened, and the
   * `seq` sequence it sits in is asserted gapless.
   */
  droppable: boolean;
  retries: number;
}

const BATCH_SIZE = 100;

/**
 * The `turn_events` writer.
 *
 * The manager assigns `seq`; this class only gets the row to Postgres. It
 * keeps the queue-worker design the old command log had — a synchronous,
 * exception-free enqueue that never throws into the game path, and a
 * background loop that batches inserts with per-row retry fallback — because
 * that discipline was never the problem. What changed underneath it is the
 * SHAPE: one event log with a total order and operator attribution on every
 * row, in place of `command_events` beside a `command_turn_states` snapshot of
 * the live broadcast shape. The snapshot was a copy of a fold's OUTPUT kept
 * next to the inputs that generate it, with nothing able to regenerate it;
 * folding `turn_events` is what replaces it, and the fold is the same function
 * the live client runs, so it cannot drift from the live path either.
 *
 * Does NOT own the pg pool — `shutdown()` only flushes.
 */
export class CommandLogger {
  private static instance: CommandLogger;

  private readonly MAX_QUEUE_SIZE = 20000;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 100;
  private queue: QueueItem[] = [];
  private droppedCount = 0;
  // O(1) support for the drop preference in enqueue(): how many queued items
  // are droppable, and the index below which the queue is known to hold only
  // undroppable ones, so the drop scan never re-reads that prefix.
  // Invariant: !queue[i].droppable for all i < dropScanFrom.
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

  /**
   * Append one already-sequenced event. The caller is the ONE writer for its
   * `(gameId, turn)`; nothing here assigns or reorders anything, because a
   * second opinion about `seq` is precisely the failure the single writer
   * exists to prevent.
   */
  public logEvent(event: TurnEvent): void {
    let row: TurnEventRow;
    try {
      row = encodeEventRow(event);
      // Serialise once, here, so a payload that cannot be stored is caught at
      // the game path's doorstep rather than in the worker three batches later.
      JSON.stringify(row.payload);
    } catch (e) {
      console.error('[CommandLogger] Failed to serialize event, dropping:', e);
      return;
    }
    this.enqueue({ row, droppable: isAttention(event), retries: 0 });
  }

  /**
   * The drop preference, restated for the event log: when an outage backs the
   * queue up to its cap, drop the oldest ATTENTION TICK and nothing else.
   *
   * A hover is numerous, low-grade, off by default in the timeline lane and
   * dropped at the 30-day fold anyway (04 §3 Q9), so losing one costs nothing
   * anybody will ever look for. Every other row is a fact — a command, a pin, a
   * staging outcome, an emission — sitting in a sequence asserted gapless, and
   * dropping one punches a hole in a fold that has no way to know it is short.
   */
  private enqueue(item: QueueItem): void {
    // No database configured: skip persistence entirely (announced once at
    // boot by db.ts) instead of queueing rows destined for per-row retry spam
    // against a socket that can never connect.
    if (!dbConfigured) return;
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      let dropIdx = 0;
      if (this.droppableCount > 0) {
        // Amortized O(1): everything before dropScanFrom is undroppable, so
        // resume the scan there; droppableCount > 0 guarantees a hit.
        let i = this.dropScanFrom;
        while (!this.queue[i].droppable) i++;
        dropIdx = i;
        this.dropScanFrom = i;
      }
      const dropped = this.queue.splice(dropIdx, 1)[0];
      if (dropped.droppable) this.droppableCount--;
      if (dropIdx < this.dropScanFrom) this.dropScanFrom--;
      this.droppedCount++;
      if (this.droppedCount % 100 === 0) {
        console.warn(
          `[CommandLogger] Queue full! Dropped ${this.droppedCount} total entries. ` +
            `Last dropped: ${dropped.row.kind} at ${dropped.row.gameId}:${dropped.row.turn}:${dropped.row.seq}`
        );
      }
    }
    this.queue.push(item);
    if (item.droppable) this.droppableCount++;
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
        if (item.droppable) this.droppableCount--;
      }

      try {
        await writeEventRows(batch.map(i => i.row));
      } catch (error) {
        console.warn(
          `[CommandLogger] Batch event insert failed (${batch.length} rows), falling back to per-row retry:`,
          (error as Error).message
        );
        for (const item of batch) {
          await this.withRetry(item);
        }
      }
    }
  }

  private async withRetry(item: QueueItem): Promise<void> {
    while (true) {
      try {
        await writeEventRows([item.row]);
        return;
      } catch (error) {
        item.retries++;
        if (item.retries > this.MAX_RETRIES) {
          console.error(
            `[CommandLogger] Failed to write ${item.row.kind} after ${this.MAX_RETRIES} retries ` +
              `for ${item.row.gameId}:${item.row.turn}:${item.row.seq}:`,
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
   * One game's operator-visible history: every event an operator authored, in
   * `(turn, seq)` order, with the identity that authored it.
   *
   * `command_turn_states` used to ride along here as a per-turn snapshot the
   * history viewer fed straight into the live render paths. It is gone: the
   * client folds these events through the same reducer the live client uses,
   * which is a stronger form of the same intent — the same state machine over
   * the same event type, rather than two representations of one state that
   * disagree on a schedule.
   */
  public async getGameCommands(gameId: string): Promise<{
    events: Array<{
      id: string;
      turn: number;
      seq: number;
      kind: string;
      at_wall: number;
      unit: string | null;
      operator: OperatorRef | null;
      payload: unknown;
    }>;
  }> {
    try {
      const rows = await db
        .select({
          turn: turnEvents.turn,
          seq: turnEvents.seq,
          kind: turnEvents.kind,
          atWall: turnEvents.atWall,
          actorKind: turnEvents.actorKind,
          actorId: turnEvents.actorId,
          actorName: turnEvents.actorName,
          actorColor: turnEvents.actorColor,
          unitKey: turnEvents.unitKey,
          payload: turnEvents.payload,
        })
        .from(turnEvents)
        .where(sql`${turnEvents.gameId} = ${gameId} AND ${turnEvents.actorKind} = 'operator'`)
        .orderBy(turnEvents.turn, turnEvents.seq);

      return {
        events: rows.map(r => ({
          id: `${gameId}:${r.turn}:${r.seq}`,
          turn: r.turn,
          seq: r.seq,
          kind: r.kind,
          at_wall: r.atWall,
          unit: r.unitKey,
          operator: r.actorId
            ? {
                userId: r.actorId,
                name: r.actorName || 'Player',
                color: r.actorColor || '#888888',
              }
            : null,
          payload: r.payload,
        })),
      };
    } catch (error) {
      console.error('[CommandLogger] Failed to query game events:', error);
      return { events: [] };
    }
  }

  /**
   * The hot window's floor. `turn_events` is hot for 30 days and then folded
   * to a per-turn digest (04 §4.3) — this is the crude form of that fold, and
   * it is safe to run because the board (`turn_boards`) and the basis
   * (`decisions`) are retained forever: what it removes is latency, not the
   * turn.
   */
  public async clearOldEvents(daysToKeep: number = 7): Promise<void> {
    try {
      const floor = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
      await db.delete(turnEvents).where(lte(turnEvents.atWall, floor));
      console.log(`[CommandLogger] Cleared turn events older than ${daysToKeep} days`);
    } catch (error) {
      console.error('[CommandLogger] Failed to clear old turn events:', error);
    }
  }

  /** One turn's events, oldest first. The replay source's read path. */
  public async getTurnEvents(gameId: string, fromTurn: number, toTurn: number): Promise<unknown[]> {
    try {
      const rows = await db
        .select({ payload: turnEvents.payload })
        .from(turnEvents)
        .where(
          and(
            sql`${turnEvents.gameId} = ${gameId}`,
            gte(turnEvents.turn, fromTurn),
            lte(turnEvents.turn, toTurn)
          )
        )
        .orderBy(turnEvents.turn, turnEvents.seq);
      return rows.map(r => r.payload);
    } catch (error) {
      console.error('[CommandLogger] Failed to query turn events:', error);
      return [];
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

/** An attention tick: focus and candidate hover ride `selection` with
 *  `hover: true` rather than being a kind of their own. They fund compute, so
 *  they must reach the kernel; they are numerous and low-grade, so they are
 *  the one thing a full queue may throw away. */
function isAttention(event: TurnEvent): boolean {
  return event.kind === 'selection' && (event.payload as SelectionPayload).hover === true;
}
