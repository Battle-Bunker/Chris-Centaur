/**
 * Shutdown-flush deadline for the async DB loggers (SIGTERM latency).
 *
 * Against an unreachable Postgres the flush worker (batch insert + per-row
 * retries + backoff) was observed grinding for ~3 minutes under SIGTERM,
 * delaying process exit only to drop most entries anyway. shutdown() must be
 * deadline-capped: with a database that never answers, it returns within the
 * cap and drops the remainder with a log line — mirroring ServerEventLogger's
 * bounded shutdown-flush.
 *
 * The dbConfigured gate (no DATABASE_URL → write paths enqueue nothing) is
 * pinned separately in logger-db-gate.test.ts — it needs a different mock of
 * the db module, which is per-file (jest.mock factories are hoisted).
 */

// A database that accepts calls but never answers — the shape of a dead
// socket mid-connect (pg's connectionTimeoutMillis alone is 10s per attempt).
jest.mock('../database/db', () => {
  const never = new Promise(() => {});
  const chain: any = {};
  chain.values = () => chain;
  chain.onConflictDoNothing = () => chain;
  chain.onConflictDoUpdate = () => chain;
  chain.then = (onOk: any, onErr: any) => never.then(onOk, onErr);
  chain.catch = (onErr: any) => never.catch(onErr);
  return {
    db: {
      insert: () => chain,
      delete: () => chain,
      execute: () => never,
    },
    pool: { end: async () => {} },
    dbConfigured: true,
  };
});

import { CommandLogger } from '../logic/command-logger';
import { DecisionLogger } from '../logic/decision-logger';
import { WriteQueue } from '../logic/write-queue';
import { turnEvent } from './lens-fixtures';

const settlement: any = {
  game: { id: 'g' },
  turn: 1,
  board: { width: 3, height: 3, food: [], hazards: [], snakes: [] },
};

describe('shutdown flush deadline against a dead database', () => {
  test('DecisionLogger.shutdown returns within the cap and drops the remainder', async () => {
    const logger: any = new (DecisionLogger as any)();
    for (let turn = 0; turn < 25; turn++) {
      logger.logTurnBoard({ gameId: 'g', turn, settlement });
    }
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const started = Date.now();
    await logger.shutdown(250);
    const elapsed = Date.now() - started;
    warnSpy.mockRestore();
    logSpy.mockRestore();
    // Well under the historical minutes-long drain; generous upper bound for
    // slow CI, but strictly bounded.
    expect(elapsed).toBeLessThan(2000);
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });

  test('CommandLogger.shutdown returns within the cap and drops the remainder', async () => {
    const logger: any = new (CommandLogger as any)();
    for (let turn = 0; turn < 25; turn++) {
      logger.logEvent(turnEvent({ kind: 'pin', seq: turn, unit: 'A-A', payload: { unit: 'A-A', to: 20, tentative: false } }));
    }
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const started = Date.now();
    await logger.shutdown(250);
    const elapsed = Date.now() - started;
    warnSpy.mockRestore();
    logSpy.mockRestore();
    expect(elapsed).toBeLessThan(2000);
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });
});

/**
 * THE DEADLINE STOPS THE WORKER, against a database that is SLOW rather than
 * dead — the case the two tests above cannot see, because a write that never
 * answers looks the same whether the worker gave up or not.
 *
 * The regression: `runWorkerLoop`'s condition is `workerRunning ||
 * queue.length > 0`, so before the `abandoned` flag the worker kept draining
 * after `shutdown` had already returned false and warned that it was
 * "dropping N unflushed entries". Nothing was dropped, every entry eventually
 * landed, the process stayed open for the whole drain — and the N it printed
 * was `queue.length`, which excludes the batch in flight and read 0 in exactly
 * the case where every stranded entry was in that batch.
 */
describe('the shutdown deadline abandons the remainder', () => {
  interface Item {
    retries: number;
    n: number;
  }

  function slowQueue(written: number[], perWriteMs: number): WriteQueue<Item> {
    return new WriteQueue<Item>({
      name: 'DeadlineProbe',
      maxQueue: 1000,
      droppable: () => false,
      describe: (i) => `#${i.n}`,
      flush: async (batch, retry) => {
        for (const item of batch) await retry(item);
      },
      write: async (item) => {
        await new Promise((r) => setTimeout(r, perWriteMs));
        written.push(item.n);
      },
      shutdownMs: 10_000,
    });
  }

  test('nothing more is written once the deadline has passed, and the count is the real one', async () => {
    const written: number[] = [];
    const q = slowQueue(written, 30);
    for (let n = 0; n < 20; n++) q.enqueue({ retries: 0, n });

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const drained = await q.shutdown(120);
    const atDeadline = written.length;
    const line = warn.mock.calls.map((c) => String(c[0])).join(' | ');

    // Long enough that an unbounded worker would have finished all twenty.
    await new Promise((r) => setTimeout(r, 800));
    warn.mockRestore();
    log.mockRestore();

    expect(drained).toBe(false);
    // At most the ONE write already inside `opts.write` when the flag was set
    // lands after the deadline; it cannot be recalled. Everything the ladder
    // had not reached is dropped.
    expect(written.length).toBeLessThanOrEqual(atDeadline + 1);
    expect(written.length).toBeLessThan(20);
    // The count is what was really stranded — the queue AND the batch in
    // flight — and not the 0 that `queue.length` alone used to report.
    expect(line).toContain(`dropping ${20 - atDeadline} unflushed entries`);
    expect(q.stats().droppedCount).toBe(20 - atDeadline);
    expect(q.stats().queueSize).toBe(0);
  }, 20_000);

  test('a queue that drains inside the deadline still reports true and drops nothing', async () => {
    const written: number[] = [];
    const q = slowQueue(written, 1);
    for (let n = 0; n < 5; n++) q.enqueue({ retries: 0, n });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const drained = await q.shutdown(5_000);
    log.mockRestore();
    expect(drained).toBe(true);
    expect(written).toEqual([0, 1, 2, 3, 4]);
    expect(q.stats().droppedCount).toBe(0);
  }, 20_000);
});
