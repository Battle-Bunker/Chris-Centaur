/**
 * Regression: the fire-and-forget full decision pass in onGameUpdate must
 * never surface an unhandled rejection. Historically the per-snake catch
 * block called gameManager.setBotRecommendation(..., 'up', ...) unguarded —
 * a synchronous throw there rejected the voided Promise.all, which index.ts's
 * unhandledRejection handler turns into process.exit(1). One snake's failed
 * fallback staging must cost a log line, not the whole process.
 */

import { TacticToesFirebaseInterface, FirebaseInterfaceConfig } from '../firebase/firebase-interface';
import { TTGameSetup, TTGameStateDoc, TTTurn } from '../firebase/tactictoes-types';

// Full board 7x6 (perimeter walls included), same layout as translate tests.
const W = 7;
const H = 6;
const idx = (x: number, y: number) => y * W + x;

function makeSetup(): TTGameSetup {
  return {
    teams: [
      { id: 'centA', name: 'Reds', color: '#ff0000' },
      { id: 'centB', name: 'Blues', color: '#0000ff' },
    ],
    snakesPerTeam: 1,
    gamePlayers: [
      { id: 'centA', teamID: 'centA', letter: 'A' },
      { id: 'centB', teamID: 'centB', letter: 'A' },
    ],
    boardWidth: W,
    boardHeight: H,
    maxTurnTime: 10,
  };
}

function makeTurn(): TTTurn {
  return {
    playerHealth: { centA: 90, centB: 70 },
    startTime: null as any,
    endTime: null as any,
    moves: {},
    // The death registry is written on every turn; empty means nobody died.
    deaths: {},
    alivePlayers: ['centA', 'centB'],
    food: [],
    hazards: [],
    playerPieces: {
      centA: [idx(1, 1), idx(1, 2)],
      centB: [idx(5, 4), idx(5, 3)],
    },
    // Head-minus-neck for each snake (wire coords, y down).
    orientation: {
      centA: { dx: 0, dy: -1 },
      centB: { dx: 0, dy: 1 },
    },
    winners: [],
  };
}

const config: FirebaseInterfaceConfig = {
  projectId: 'test',
  apiKey: 'test',
  region: 'test',
  centaurId: 'centA',
  centaurApiKey: 'test',
  bot: { engine: 'legacy' },
};

// THIS SUITE ASSERTS ON THE LEGACY PATH, so it names the engine EXPLICITLY in
// the config rather than riding the ambient default. The default is a measured
// decision that can move; what this file is about does not. Without it, a
// default flip would reroute the full pass out from under these assertions and
// read as a regression in something unrelated.
//
// It used to pin `CENTAUR_ENGINE` in a beforeEach/afterEach pair, which is one
// more reason the environment was the wrong home for this: a suite could only
// pin it by mutating process state it then had to remember to restore.

describe('fire-and-forget decision pass', () => {
  test('a throwing setBotRecommendation in the error path never rejects the voided pass', async () => {
    // Strategy whose full pass always fails — drives every snake into the
    // per-snake catch block.
    const strategy = {
      getBestMoveIterative: jest.fn().mockRejectedValue(new Error('decision blew up')),
    } as any;

    const fi = new TacticToesFirebaseInterface(strategy, config);

    // Stub manager: fallback staging throws SYNCHRONOUSLY (the historical
    // process-killer). Everything else is inert.
    const setBotRecommendation = jest.fn(() => {
      throw new Error('staging blew up');
    });
    (fi as any).gameManager = {
      registerGame: jest.fn(),
      setGameSession: jest.fn(),
      recordTurnArrival: jest.fn(),
      updateBoard: jest.fn(),
      applyResolvedMoves: jest.fn(),
      getActiveWaypointTarget: jest.fn().mockReturnValue(null),
      setBotRecommendation,
      enableTeamStaging: jest.fn(),
    };
    (fi as any).gameLogger = { startGame: jest.fn(), endGame: jest.fn() };

    const doc: TTGameStateDoc = { setup: makeSetup(), turns: [makeTurn()] };
    const watched = {
      sessionID: 'sess1',
      gameID: 'game1',
      unsubscribe: () => {},
      lastProcessedTurn: -1,
      registered: false,
      latestDoc: doc,
      turnWatch: null,
      lastSnapshotMs: Date.now(),
    };

    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await (fi as any).onGameUpdate(watched, doc);
      // Let the detached decision pass (strategy rejection → catch →
      // throwing fallback staging) fully settle.
      for (let i = 0; i < 5; i++) {
        await new Promise((res) => setImmediate(res));
      }
    } finally {
      process.off('unhandledRejection', onUnhandled);
      errSpy.mockRestore();
    }

    // The doomed pass actually ran: the fast pass staged (throwing), and the
    // error-path fallback staging was attempted for our snake.
    expect(strategy.getBestMoveIterative).toHaveBeenCalled();
    expect(setBotRecommendation).toHaveBeenCalled();
    // ...and none of it escaped as an unhandled rejection.
    expect(unhandled).toEqual([]);
    // The turn was still consumed (fast pass bookkeeping succeeded).
    expect(watched.lastProcessedTurn).toBe(0);
  });
});
