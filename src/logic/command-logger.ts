import { and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../database/db';
import { turnEvents } from '../database/schema';
import { encodeEventRow } from '../lens/store';
import { writeEventRows } from '../lens/store/persistence';
import { WriteQueue } from './write-queue';
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
   * Whether losing this row costs anything. See `write-queue.ts`'s drop
   * preference: only an ATTENTION tick is droppable. Everything else is a
   * fact about what happened, and the `seq` sequence it sits in is asserted
   * gapless.
   */
  droppable: boolean;
  retries: number;
}

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

  private readonly wq: WriteQueue<QueueItem>;

  private constructor(maxQueue = 20000) {
    this.wq = new WriteQueue<QueueItem>({
      name: 'CommandLogger',
      maxQueue,
      droppable: item => item.droppable,
      describe: item => `${item.row.kind} at ${item.row.gameId}:${item.row.turn}:${item.row.seq}`,
      // ONE bulk insert per batch, falling back to per-row retry only when the
      // bulk insert throws — `turn_events` has no cross-row foreign keys
      // within a batch, so there is no ordering requirement to preserve.
      flush: async (batch, retry) => {
        try {
          await writeEventRows(batch.map(i => i.row));
        } catch (error) {
          console.warn(
            `[CommandLogger] Batch event insert failed (${batch.length} rows), falling back to per-row retry:`,
            (error as Error).message
          );
          for (const item of batch) {
            await retry(item);
          }
        }
      },
      write: item => writeEventRows([item.row]),
      shutdownMs: 2000,
    });
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
    this.wq.enqueue({ row, droppable: isAttention(event), retries: 0 });
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
    await this.wq.shutdown(timeoutMs);
  }
}

/** An attention tick: focus and candidate hover ride `selection` with
 *  `hover: true` rather than being a kind of their own. They fund compute, so
 *  they must reach the kernel; they are numerous and low-grade, so they are
 *  the one thing a full queue may throw away. */
function isAttention(event: TurnEvent): boolean {
  return event.kind === 'selection' && (event.payload as SelectionPayload).hover === true;
}
