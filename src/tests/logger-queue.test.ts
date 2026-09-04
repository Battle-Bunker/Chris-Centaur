/**
 * Queue-full drop preference for the async DB writers — RETYPED, not deleted.
 *
 * The discipline it pins survives the schema change; what changed is WHICH row
 * a full queue may throw away, and in both writers the new answer is better
 * grounded than the old one.
 *
 * `CommandLogger` writes `turn_events`. The only droppable row is an ATTENTION
 * TICK — focus and candidate hover, riding `selection` with `hover: true`.
 * They are numerous, low-grade, off by default in the timeline lane and
 * dropped at the 30-day fold anyway, so losing one costs nothing anybody will
 * look for. Every other row is a fact in a sequence asserted gapless, and a
 * fold has no way to notice it came up short.
 *
 * `DecisionLogger` writes `turn_boards`, `decisions`, `movesets` and
 * `unit_outcomes`. The only droppable item is a `movesets` batch, and that is
 * exactly the licence condition the projection lives under: it is regenerable
 * from `turn_events` by the rebuild command, so losing one costs a rebuild.
 * A board, a decision seed or an outcome is the only copy of something nothing
 * can recompute.
 *
 * Both tests also pin that the bookkeeping survives the worker consuming
 * batches — the amortised drop scan is the part that historically got this
 * wrong.
 */

jest.mock('../database/db', () => {
  const chain: any = {};
  chain.values = () => chain;
  chain.onConflictDoNothing = () => chain;
  chain.onConflictDoUpdate = () => chain;
  chain.where = () => chain;
  chain.then = (onOk: any, onErr: any) => Promise.resolve(undefined).then(onOk, onErr);
  chain.catch = (onErr: any) => Promise.resolve(undefined).catch(onErr);
  return {
    db: {
      insert: () => chain,
      delete: () => chain,
      execute: async () => ({ rows: [] }),
    },
    pool: { end: async () => {} },
    dbConfigured: true,
  };
});

import { CommandLogger } from '../logic/command-logger';
import { DecisionLogger } from '../logic/decision-logger';
import type { MovesetProjectionRow, TurnEvent, TurnEventKind } from '../lens/types';
import { anchorEvent, moveset, operatorActor, turnEvent } from './lens-fixtures';

// Fresh non-singleton instances with a tiny cap so tests stay fast. The
// constructor parks the worker on waitForWork (empty queue), and everything
// below enqueues + asserts synchronously, so the worker cannot consume items
// mid-test unless a test explicitly awaits. The cap is a constructor
// argument now (see write-queue.ts's WriteQueueOptions.maxQueue).
function freshCommandLogger(cap: number): CommandLogger {
  return new (CommandLogger as any)(cap);
}
function freshDecisionLogger(cap: number): DecisionLogger {
  return new (DecisionLogger as any)(cap);
}

function kinds(logger: any): string[] {
  return logger.wq.queue.map((q: any) => q.row?.kind ?? q.kind);
}

async function drain(logger: any): Promise<void> {
  for (let i = 0; i < 200 && logger.wq.queue.length > 0; i++) {
    await new Promise((r) => setImmediate(r));
  }
  expect(logger.wq.queue.length).toBe(0);
}

const SETTLEMENT: any = {
  game: { id: 'g' },
  turn: 1,
  board: { width: 3, height: 3, food: [], hazards: [], snakes: [] },
};

let seq = 0;
function event(kind: TurnEventKind, payload: unknown): TurnEvent {
  seq += 1;
  return turnEvent({ kind, seq, payload, actor: operatorActor('ada'), unit: 'A-A' });
}
function hover(): TurnEvent {
  return event('selection', { cluster: 0, unit: 'A-A', candidate: 20, hover: true });
}
function determination(): TurnEvent {
  return event('pin', { unit: 'A-A', to: 20, tentative: false });
}

describe('CommandLogger drops attention, never a determination', () => {
  test('a full queue displaces the oldest hover tick', async () => {
    const logger = freshCommandLogger(4);
    logger.logEvent(hover());
    logger.logEvent(determination());
    logger.logEvent(hover());
    logger.logEvent(determination());
    // Full. This row must displace the OLDEST hover, not shift the head blindly.
    logger.logEvent(determination());
    expect(kinds(logger)).toEqual(['pin', 'selection', 'pin', 'pin']);
    // Next overflow takes the remaining hover.
    logger.logEvent(determination());
    expect(kinds(logger)).toEqual(['pin', 'pin', 'pin', 'pin']);
    await logger.shutdown();
  });

  test('an all-determination queue falls back to dropping the head', async () => {
    const logger = freshCommandLogger(3);
    const first = determination();
    logger.logEvent(first);
    logger.logEvent(determination());
    logger.logEvent(determination());
    logger.logEvent(determination());
    expect((logger as any).wq.queue.map((q: any) => q.row.seq)).not.toContain(first.seq);
    expect((logger as any).wq.queue.length).toBe(3);
    await logger.shutdown();
  });

  test('drop preference stays correct after the worker consumes batches', async () => {
    const logger = freshCommandLogger(4);
    for (let i = 0; i < 4; i++) logger.logEvent(determination());
    await drain(logger);
    // Refill: determinations first, then hovers — the scan bookkeeping from the
    // drained generation must not skew what gets dropped now.
    logger.logEvent(determination());
    logger.logEvent(determination());
    const keptHover = hover();
    logger.logEvent(hover());
    logger.logEvent(keptHover);
    logger.logEvent(determination());
    expect(kinds(logger)).toEqual(['pin', 'pin', 'selection', 'pin']);
    expect((logger as any).wq.queue[2].row.seq).toBe(keptHover.seq);
    await logger.shutdown();
  });

  test('the anchor and every staging outcome are undroppable', async () => {
    const logger = freshCommandLogger(3);
    logger.logEvent(anchorEvent());
    logger.logEvent(event('stage.confirmed', { unit: 'A-A', to: 20, source: 'kernel', serverTs: 1 }));
    logger.logEvent(event('turn.resolved', { moves: [], deaths: [], winners: [] }));
    logger.logEvent(hover());
    // Nothing droppable was queued, so the head goes — and what is left is
    // still three facts rather than two facts and a hover.
    expect(kinds(logger)).toEqual(['stage.confirmed', 'turn.resolved', 'selection']);
    await logger.shutdown();
  });
});

describe('DecisionLogger drops the regenerable projection, never a source of truth', () => {
  function projection(rank: number): ReadonlyArray<MovesetProjectionRow> {
    return [
      {
        decisionId: 'd1',
        emissionSeq: 5,
        clusterId: 0,
        clusterKey: 'c0#0',
        clusterGen: 0,
        rank,
        movesetKey: `m:${rank}`,
        moves: moveset().moves,
        witnessPlanKey: 'plan:witness',
        seenIn: 1,
        lo: 1,
        est: 1,
        hi: 1,
        channel: 'lo',
        exact: false,
        ledgerSize: 0,
        vacuity: 'alive',
        complementKey: 'comp:live',
        complementStale: false,
        cited: [],
        basisKey: 'basis:[]',
        staged: false,
        dominanceKind: null,
        dominance: null,
        h1Lo: 1,
        h1Hi: 1,
        deepHorizon: 1,
        deepLo: 1,
        deepHi: 1,
        derived: true,
        line: null,
      },
    ];
  }

  function board(logger: DecisionLogger, turn: number): void {
    logger.logTurnBoard({ gameId: 'g', turn, settlement: SETTLEMENT });
  }

  test('drops the oldest movesets batch, never a board, decision or outcome', async () => {
    const logger = freshDecisionLogger(4);
    logger.logMovesets('d1', projection(1));
    board(logger, 1);
    logger.recordUnitOutcome({ gameId: 'g', turn: 1, unitKey: 'A-A', stagedMove: 20 });
    board(logger, 2);
    // Full: displace the oldest droppable (the projection).
    board(logger, 3);
    expect(kinds(logger)).toEqual(['board', 'outcome', 'board', 'board']);
    // Then, with nothing droppable left, the head.
    board(logger, 4);
    expect(kinds(logger)).toEqual(['outcome', 'board', 'board', 'board']);
    await logger.shutdown();
  });

  test('drop preference stays correct after the worker consumes batches', async () => {
    const logger = freshDecisionLogger(4);
    for (let t = 1; t <= 4; t++) board(logger, t);
    await drain(logger);
    board(logger, 10);
    board(logger, 11);
    logger.logMovesets('d1', projection(1));
    logger.logMovesets('d2', projection(2));
    board(logger, 14);
    expect(kinds(logger)).toEqual(['board', 'board', 'movesets', 'board']);
    expect((logger as any).wq.queue[2].decisionId).toBe('d2');
    await logger.shutdown();
  });

  test('a decision seed is never the item that goes', async () => {
    const logger = freshDecisionLogger(2);
    logger.logMovesets('d1', projection(1));
    logger.logDecisionRecord({
      id: 'd1',
      gameId: 'g',
      turn: 1,
      botId: 'bot:test',
      behaviourId: 'behaviour:test',
      engine: 'lobster',
      profile: 'default',
      input: {
        boardHash: 'h',
        asTeam: 0,
        seed: 1,
        assumptions: [],
        initialPins: [],
        modelled: [],
        botId: 'bot:test',
        behaviourId: 'behaviour:test',
        nodeBudget: 1,
        liveBudgetMs: 1,
        kernelOptions: {},
      },
      summary: {},
      startedAt: 0,
      endedAt: null,
    });
    board(logger, 1);
    expect(kinds(logger)).toEqual(['decision', 'board']);
    await logger.shutdown();
  });
});
