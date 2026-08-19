/**
 * dbConfigured gate: when DATABASE_URL is unset, the DB write paths must be
 * off up front — the loggers enqueue nothing (so no per-decision retry spam
 * against a dead socket, and a trivially instant shutdown flush), and the
 * ServerEventLogger writes and liveness upserts are no-ops. One boot log line
 * in db.ts is the whole footprint.
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

const gs = { game: { id: 'g' }, turn: 1, board: { width: 3, height: 3, food: [], hazards: [], snakes: [] } };

describe('unconfigured database gates the write paths', () => {
  test('DecisionLogger enqueues nothing', async () => {
    const logger: any = new (DecisionLogger as any)();
    logger.logTurnState({ gameId: 'g', turn: 1, gameState: gs });
    logger.logDecision({
      gameId: 'g', snakeId: 's', snakeName: 's', turn: 1,
      position: { x: 0, y: 0 }, health: 100, safeMoves: [],
      botRecommendation: 'up', moveEvaluations: [], gameState: gs,
    });
    logger.recordSubmittedMove('g', 's', 1, 'up');
    logger.recordServerMoves('g', 1, { s: 'up' });
    expect(logger.queue.length).toBe(0);
    // Empty queue → the flush is instant even with a generous deadline.
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await logger.shutdown();
    logSpy.mockRestore();
  });

  test('CommandLogger enqueues nothing', async () => {
    const logger: any = new (CommandLogger as any)();
    logger.logEvent({ gameId: 'g', snakeId: null, turn: 1, eventType: 'e', operator: null, payload: null });
    logger.logTurnState('g', 1, { s: 1 });
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
