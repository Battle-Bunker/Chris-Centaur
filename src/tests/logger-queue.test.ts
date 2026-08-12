/**
 * Queue-full drop preference for the async DB loggers.
 *
 * Both CommandLogger and DecisionLogger bound their in-memory queues; when an
 * outage backs a queue up to its cap, the drop must prefer the oldest
 * NON-turnState item: turn-state rows are captured once per turn and never
 * re-delivered, so losing one punches a permanent hole in the replay, while a
 * dropped event/decision costs a single row. These tests pin that preference
 * (including the all-turnState fallback of dropping the head) and that the
 * bookkeeping survives the worker consuming batches.
 */

jest.mock('../database/db', () => {
  const chain: any = {};
  chain.values = () => chain;
  chain.onConflictDoNothing = () => chain;
  chain.then = (onOk: any, onErr: any) => Promise.resolve(undefined).then(onOk, onErr);
  chain.catch = (onErr: any) => Promise.resolve(undefined).catch(onErr);
  return {
    db: {
      insert: () => chain,
      execute: async () => ({ rows: [] }),
    },
    pool: { end: async () => {} },
  };
});

import { CommandLogger } from '../logic/command-logger';
import { DecisionLogger } from '../logic/decision-logger';

// Fresh non-singleton instances with a tiny cap so tests stay fast. The
// constructor parks the worker on waitForWork (empty queue), and everything
// below enqueues + asserts synchronously, so the worker cannot consume items
// mid-test unless a test explicitly awaits.
function freshCommandLogger(cap: number): CommandLogger {
  const logger = new (CommandLogger as any)();
  (logger as any).MAX_QUEUE_SIZE = cap;
  return logger;
}
function freshDecisionLogger(cap: number): DecisionLogger {
  const logger = new (DecisionLogger as any)();
  (logger as any).MAX_QUEUE_SIZE = cap;
  return logger;
}

function kinds(logger: any): string[] {
  return logger.queue.map((q: any) => q.kind);
}

async function drain(logger: any): Promise<void> {
  for (let i = 0; i < 200 && logger.queue.length > 0; i++) {
    await new Promise((r) => setImmediate(r));
  }
  expect(logger.queue.length).toBe(0);
}

const gs = { game: { id: 'g' }, turn: 1, board: { width: 3, height: 3, food: [], hazards: [], snakes: [] } };

describe('CommandLogger queue-full drop preference', () => {
  test('drops the oldest event, never a turn-state snapshot', async () => {
    const logger = freshCommandLogger(4);
    logger.logEvent({ gameId: 'g', snakeId: 'A', turn: 1, eventType: 'e1', operator: null, payload: null });
    logger.logTurnState('g', 1, { s: 1 });
    logger.logEvent({ gameId: 'g', snakeId: 'A', turn: 2, eventType: 'e2', operator: null, payload: null });
    logger.logTurnState('g', 2, { s: 2 });
    // Full. This snapshot must displace the OLDEST event (e1), not shift the head blindly.
    logger.logTurnState('g', 3, { s: 3 });
    expect(kinds(logger)).toEqual(['turnState', 'event', 'turnState', 'turnState']);
    expect((logger as any).queue.filter((q: any) => q.kind === 'event')[0].row.eventType).toBe('e2');
    // Next overflow drops the remaining event.
    logger.logTurnState('g', 4, { s: 4 });
    expect(kinds(logger)).toEqual(['turnState', 'turnState', 'turnState', 'turnState']);
    await logger.shutdown();
  });

  test('all-turnState queue falls back to dropping the head', async () => {
    const logger = freshCommandLogger(3);
    logger.logTurnState('g', 1, { s: 1 });
    logger.logTurnState('g', 2, { s: 2 });
    logger.logTurnState('g', 3, { s: 3 });
    logger.logTurnState('g', 4, { s: 4 });
    expect((logger as any).queue.map((q: any) => q.row.turn)).toEqual([2, 3, 4]);
    await logger.shutdown();
  });

  test('drop preference stays correct after the worker consumes batches', async () => {
    const logger = freshCommandLogger(4);
    for (let t = 1; t <= 4; t++) logger.logEvent({ gameId: 'g', snakeId: 'A', turn: t, eventType: `e${t}`, operator: null, payload: null });
    await drain(logger);
    // Refill: snapshots first, then events — the internal scan bookkeeping
    // from the drained generation must not skew what gets dropped now.
    logger.logTurnState('g', 10, { s: 10 });
    logger.logTurnState('g', 11, { s: 11 });
    logger.logEvent({ gameId: 'g', snakeId: 'A', turn: 12, eventType: 'e12', operator: null, payload: null });
    logger.logEvent({ gameId: 'g', snakeId: 'A', turn: 13, eventType: 'e13', operator: null, payload: null });
    logger.logTurnState('g', 14, { s: 14 });
    expect(kinds(logger)).toEqual(['turnState', 'turnState', 'event', 'turnState']);
    expect((logger as any).queue[2].row.eventType).toBe('e13');
    await logger.shutdown();
  });
});

describe('DecisionLogger queue-full drop preference', () => {
  function decision(logger: DecisionLogger, turn: number): void {
    logger.logDecision({
      gameId: 'g', snakeId: 'A', snakeName: 'A', turn,
      position: { x: 0, y: 0 }, health: 100, safeMoves: ['up'],
      botRecommendation: 'up', moveEvaluations: [], gameState: { turn, you: { id: 'A' } },
    });
  }

  test('drops the oldest non-turnState item (insert or moveUpdate), never a turn state', async () => {
    const logger = freshDecisionLogger(4);
    decision(logger, 1);
    logger.logTurnState({ gameId: 'g', turn: 1, gameState: gs as any });
    logger.recordSubmittedMove('g', 'A', 2, 'up');
    logger.logTurnState({ gameId: 'g', turn: 2, gameState: gs as any });
    // Full: displace the oldest droppable (the turn-1 insert).
    logger.logTurnState({ gameId: 'g', turn: 3, gameState: gs as any });
    expect(kinds(logger)).toEqual(['turnState', 'moveUpdate', 'turnState', 'turnState']);
    // Then the moveUpdate; then, all-turnState, the head.
    logger.logTurnState({ gameId: 'g', turn: 4, gameState: gs as any });
    expect(kinds(logger)).toEqual(['turnState', 'turnState', 'turnState', 'turnState']);
    logger.logTurnState({ gameId: 'g', turn: 5, gameState: gs as any });
    expect((logger as any).queue.map((q: any) => q.row.turn)).toEqual([2, 3, 4, 5]);
    await logger.shutdown();
  });

  test('drop preference stays correct after the worker consumes batches', async () => {
    const logger = freshDecisionLogger(4);
    for (let t = 1; t <= 4; t++) decision(logger, t);
    await drain(logger);
    logger.logTurnState({ gameId: 'g', turn: 10, gameState: gs as any });
    logger.logTurnState({ gameId: 'g', turn: 11, gameState: gs as any });
    decision(logger, 12);
    decision(logger, 13);
    logger.logTurnState({ gameId: 'g', turn: 14, gameState: gs as any });
    expect(kinds(logger)).toEqual(['turnState', 'turnState', 'insert', 'turnState']);
    expect((logger as any).queue[2].row.turn).toBe(13);
    await logger.shutdown();
  });
});
