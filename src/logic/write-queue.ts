import { dbConfigured } from '../database/db';
import { transientDelay } from '../server/activity-controller';

const BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

/**
 * A DURABLE WRITE QUEUE: a bounded queue with a drop preference, a batching
 * worker, per-item exponential retry and a deadline-capped shutdown flush.
 * Enqueue is synchronous and never throws into the game path.
 */
export interface WriteQueueOptions<I> {
  /** The log prefix, e.g. 'CommandLogger'. */
  readonly name: string;
  readonly maxQueue: number;
  /** True for an item losing which costs nothing recomputable. */
  readonly droppable: (item: I) => boolean;
  /** The identifying tail of the "queue full" (and retries-exceeded) log lines. */
  readonly describe: (item: I) => string;
  /**
   * One batch, in whatever order this queue's writes must land. Called with
   * `retry`, which applies ONE item under the retry ladder.
   */
  readonly flush: (batch: ReadonlyArray<I>, retry: (item: I) => Promise<void>) => Promise<void>;
  /** One item, once. Throwing schedules a retry. */
  readonly write: (item: I) => Promise<void>;
  /** The default shutdown-flush deadline; a per-call `shutdown(timeoutMs)` overrides it. */
  readonly shutdownMs: number;
}

/**
 * The queue-worker `CommandLogger` and `DecisionLogger` each wrote out in
 * full: a bounded queue with an amortised-O(1) drop scan for a caller-chosen
 * droppable item, a wake-on-enqueue background worker, per-item exponential
 * retry, and a deadline-capped shutdown flush. What differs between the two
 * loggers is the drop test, the batch step (a single logger may need its
 * batch applied in a fixed order — the `flush` callback is where that lives)
 * and the per-item write — everything else is one policy, stated once.
 */
export class WriteQueue<I extends { retries: number }> {
  private queue: I[] = [];
  private droppedCount = 0;
  // O(1) support for the drop preference in enqueue(): how many queued items
  // are droppable, and the index below which the queue is known to hold only
  // undroppable ones, so the drop scan never re-reads that prefix.
  // Invariant: !opts.droppable(queue[i]) for all i < dropScanFrom.
  private droppableCount = 0;
  private dropScanFrom = 0;

  private workerRunning = true;
  /**
   * Set by `shutdown` when the flush deadline passes. The worker stops at its
   * next checkpoint and the retry ladder stops writing, so the deadline BOUNDS
   * the drain instead of merely timing it: without this the loop's own
   * condition (`workerRunning || queue.length > 0`) kept it draining, the
   * "dropping N unflushed entries" line described something that never
   * happened, and a slow-but-alive database held the process open for exactly
   * as long as the deadline was added to prevent.
   */
  private abandoned = false;
  /** The batch currently inside `opts.flush` — not in `queue`, not yet
   *  written, and the reason the deadline's own count used to read 0. */
  private inFlight = 0;
  private workerPromise: Promise<void>;
  private wakeup: (() => void) | null = null;

  constructor(private readonly opts: WriteQueueOptions<I>) {
    this.workerPromise = this.runWorkerLoop();
  }

  /**
   * The drop preference: when an outage backs the queue up to its cap, drop
   * the oldest item `opts.droppable` says may be lost, and nothing else.
   */
  public enqueue(item: I): void {
    // No database configured: skip persistence entirely (announced once at
    // boot by db.ts) instead of queueing rows destined for per-row retry spam
    // against a socket that can never connect.
    if (!dbConfigured) return;
    if (this.queue.length >= this.opts.maxQueue) {
      let dropIdx = 0;
      if (this.droppableCount > 0) {
        // Amortized O(1): everything before dropScanFrom is undroppable, so
        // resume the scan there; droppableCount > 0 guarantees a hit.
        let i = this.dropScanFrom;
        while (!this.opts.droppable(this.queue[i])) i++;
        dropIdx = i;
        this.dropScanFrom = i;
      }
      const dropped = this.queue.splice(dropIdx, 1)[0];
      if (this.opts.droppable(dropped)) this.droppableCount--;
      if (dropIdx < this.dropScanFrom) this.dropScanFrom--;
      this.droppedCount++;
      if (this.droppedCount % 100 === 0) {
        console.warn(
          `[${this.opts.name}] Queue full! Dropped ${this.droppedCount} total entries. ` +
            `Last dropped: ${this.opts.describe(dropped)}`
        );
      }
    }
    this.queue.push(item);
    if (this.opts.droppable(item)) this.droppableCount++;
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
    while (!this.abandoned && (this.workerRunning || this.queue.length > 0)) {
      if (this.queue.length === 0) {
        if (!this.workerRunning) break;
        await this.waitForWork();
        continue;
      }

      const batch = this.queue.splice(0, BATCH_SIZE);
      this.dropScanFrom = Math.max(0, this.dropScanFrom - batch.length);
      for (const item of batch) {
        if (this.opts.droppable(item)) this.droppableCount--;
      }

      this.inFlight = batch.length;
      try {
        await this.opts.flush(batch, item => this.withRetry(item));
      } finally {
        this.inFlight = 0;
      }
    }
  }

  private async withRetry(item: I): Promise<void> {
    try {
      while (true) {
        // PAST THE DEADLINE NOTHING MORE IS WRITTEN. The batch already handed
        // to `opts.flush` cannot be recalled, but every item it has not
        // reached yet returns here rather than being retried — which is what
        // bounds the drain to at most one in-flight write. Already counted:
        // `shutdown` charged the whole stranded remainder to `droppedCount`
        // when it set the flag.
        if (this.abandoned) return;
        try {
          await this.opts.write(item);
          return;
        } catch (error) {
          item.retries++;
          if (item.retries > MAX_RETRIES) {
            console.error(
              `[${this.opts.name}] Failed to write ${this.opts.describe(item)} after ${MAX_RETRIES} retries:`,
              error
            );
            this.droppedCount++;
            return;
          }
          const delay = RETRY_DELAY_MS * Math.pow(2, item.retries - 1) * (0.5 + Math.random() * 0.5);
          await transientDelay(delay);
        }
      }
    } finally {
      // Settled one way or the other, so it is no longer part of what a
      // deadline would strand.
      if (this.inFlight > 0) this.inFlight--;
    }
  }

  /**
   * Flush and stop the worker. `timeoutMs` overrides `opts.shutdownMs` for
   * this call only (tests use this to keep the deadline gate fast). Returns
   * whether the queue drained within the deadline.
   *
   * FALSE MEANS ABANDONED, and it is true of the queue rather than only of the
   * clock: the deadline sets `abandoned`, which stops the worker at its next
   * checkpoint and stops the retry ladder writing, and the entries still
   * queued are counted into `droppedCount` and discarded. Returning false
   * while the worker kept draining made the log line false in both halves —
   * nothing was dropped, and the count it printed excluded the batch in
   * flight, which is where the entries actually were.
   */
  public async shutdown(timeoutMs?: number): Promise<boolean> {
    const ms = timeoutMs ?? this.opts.shutdownMs;
    console.log(`[${this.opts.name}] Shutting down, flushing ${this.queue.length} queued entries...`);
    this.workerRunning = false;
    this.signalWakeup();
    const flushed = await Promise.race([
      this.workerPromise.then(() => true),
      transientDelay(ms).then(() => false),
    ]);
    if (!flushed) {
      this.abandoned = true;
      const stranded = this.queue.length + this.inFlight;
      this.queue.length = 0;
      this.droppableCount = 0;
      this.dropScanFrom = 0;
      this.droppedCount += stranded;
      this.signalWakeup();
      console.warn(
        `[${this.opts.name}] Shutdown flush deadline (${ms}ms) reached; ` +
        `dropping ${stranded} unflushed entries.`
      );
      return false;
    }
    if (this.droppedCount > 0) {
      console.warn(`[${this.opts.name}] Shutdown complete. Total dropped entries: ${this.droppedCount}`);
    }
    return true;
  }

  public stats(): { queueSize: number; droppedCount: number; maxQueueSize: number } {
    return {
      queueSize: this.queue.length,
      droppedCount: this.droppedCount,
      maxQueueSize: this.opts.maxQueue,
    };
  }
}
