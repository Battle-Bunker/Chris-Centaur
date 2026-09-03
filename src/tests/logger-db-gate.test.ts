/**
 * dbConfigured gate: when DATABASE_URL is unset, the DB write paths must be
 * off up front — the loggers enqueue nothing (so no per-decision retry spam
 * against a dead socket, and a trivially instant shutdown flush), and the
 * ServerEventLogger writes and liveness upserts are no-ops. One boot log line
 * in db.ts is the whole footprint.
 *
 * RETYPED, not deleted: the gate survives the schema change untouched, and the
 * only thing that moved is which methods the loggers offer. That is the point
 * of keeping it — the five tables changed what is written, not whether an
 * unconfigured instance is allowed to try.
 */

// db throws on any touch: with the gate working, nothing may reach it.
jest.mock('../database/db', () => ({
  db: new Proxy({}, {
    get() {
      throw new Error('db must not be touched when dbConfigured=false');
    },
  }),
  pool: { end: async () => {} },
  dbConfigured: false,
}));

import { CommandLogger } from '../logic/command-logger';
import { DecisionLogger } from '../logic/decision-logger';
import { ServerEventLogger } from '../logic/server-event-logger';
import { anchorEvent } from './lens-fixtures';

const settlement: any = {
  game: { id: 'g' },
  turn: 1,
  board: { width: 3, height: 3, food: [], hazards: [], snakes: [] },
};

describe('unconfigured database gates the write paths', () => {
  test('DecisionLogger enqueues nothing', async () => {
    const logger: any = new (DecisionLogger as any)();
    logger.logTurnBoard({ gameId: 'g', turn: 1, settlement });
    logger.logMovesets('d1', []);
    logger.recordUnitOutcome({ gameId: 'g', turn: 1, unitKey: 'A-A', stagedMove: 20 });
    logger.recordSubmittedMove('g', 'A-A', 1, 20);
    logger.recordServerMoves('g', 1, [{ unit: 'A-A', to: 20 }]);
    expect(logger.queue.length).toBe(0);
    // Empty queue → the flush is instant even with a generous deadline.
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await logger.shutdown();
    logSpy.mockRestore();
  });

  test('CommandLogger enqueues nothing', async () => {
    const logger: any = new (CommandLogger as any)();
    logger.logEvent(anchorEvent());
    expect(logger.queue.length).toBe(0);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await logger.shutdown();
    logSpy.mockRestore();
  });

  test('ServerEventLogger writes and heartbeats are no-ops', async () => {
    (ServerEventLogger as any).instance = undefined;
    const logger: any = ServerEventLogger.getInstance();
    // recordBoot runs forensics (gated read) + boot write + first heartbeat
    // upsert; recordUserIntent triggers a woke write. None may touch db (the
    // Proxy above throws on any access).
    logger.recordBoot({ port: 0, pid: 1 });
    logger.recordUserIntent();
    await logger.recordShutdownAndFlush('test');
    // pendingWrites resolved without touching the throwing db proxy.
    await (logger as any).pendingWrites;
  });
});
