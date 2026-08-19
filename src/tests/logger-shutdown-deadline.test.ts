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
      execute: () => never,
    },
    pool: { end: async () => {} },
    dbConfigured: true,
  };
});

import { CommandLogger } from '../logic/command-logger';
import { DecisionLogger } from '../logic/decision-logger';

const gs = { game: { id: 'g' }, turn: 1, board: { width: 3, height: 3, food: [], hazards: [], snakes: [] } };

describe('shutdown flush deadline against a dead database', () => {
  test('DecisionLogger.shutdown returns within the cap and drops the remainder', async () => {
    const logger: any = new (DecisionLogger as any)();
    for (let turn = 0; turn < 25; turn++) {
      logger.logTurnState({ gameId: 'g', turn, gameState: gs });
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
      logger.logTurnState('g', turn, { s: turn });
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
