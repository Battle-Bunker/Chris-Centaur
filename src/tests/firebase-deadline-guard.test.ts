/**
 * The one behavioural change the clock-skew guard makes to the legacy path:
 * the full decision pass's deadline is now measured rather than assumed.
 *
 * `src/tests/wire-deadline.test.ts` pins the arithmetic. This pins the WIRING —
 * that the transport actually feeds the guard the turn's server timestamps and
 * hands the strategy what the guard returns, so a host clock behind server time
 * shortens the decision instead of silently overrunning the deadline (an
 * overrun is invisible: the late write is accepted and then discarded).
 */

import { Timestamp } from 'firebase/firestore';
import { FirebaseInterfaceConfig, TacticToesFirebaseInterface } from '../firebase/firebase-interface';
import { TTGameSetup, TTGameStateDoc, TTTurn } from '../firebase/tactictoes-types';

const W = 7;
const H = 6;
const idx = (x: number, y: number) => y * W + x;

const T = 1_700_000_000_000;
const BUDGET_MS = 10_000;

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

function makeTurn(startTimeMs: number | null): TTTurn {
  return {
    playerHealth: { centA: 90, centB: 70 },
    startTime: (startTimeMs === null ? null : Timestamp.fromMillis(startTimeMs)) as never,
    endTime: Timestamp.fromMillis(T + BUDGET_MS) as never,
    moves: {},
    deaths: {},
    alivePlayers: ['centA', 'centB'],
    food: [],
    hazards: [],
    playerPieces: {
      centA: [idx(1, 1), idx(1, 2)],
      centB: [idx(5, 4), idx(5, 3)],
    },
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

/** Drives one turn through onGameUpdate and reports the deadline the full
 * decision pass was handed. */
async function deadlineForTurn(gameID: string, startTimeMs: number | null): Promise<number> {
  const deadlines: number[] = [];
  const strategy = {
    getBestMoveIterative: jest.fn(async (_view, _team, _wp, opts: { deadlineMs: number }) => {
      deadlines.push(opts.deadlineMs);
      throw new Error('stop here — the deadline is all this test wants');
    }),
    onGameEnd: jest.fn(),
  } as never;

  const fi = new TacticToesFirebaseInterface(strategy, config);
  (fi as never as { gameManager: unknown }).gameManager = {
    registerGame: jest.fn(),
    setGameSession: jest.fn(),
    recordTurnArrival: jest.fn(),
    updateBoard: jest.fn(),
    applyResolvedMoves: jest.fn(),
    getActiveWaypointTarget: jest.fn().mockReturnValue(null),
    setBotRecommendation: jest.fn(),
    // The flag branch drives this switch in BOTH directions (V4 H3): under
    // legacy it must actively turn the team transport off, so a stub of the
    // manager has to carry it.
    enableTeamStaging: jest.fn(),
  };
  (fi as never as { gameLogger: unknown }).gameLogger = {
    startGame: jest.fn(),
    endGame: jest.fn(),
  };

  const doc: TTGameStateDoc = { setup: makeSetup(), turns: [makeTurn(startTimeMs)] };
  const watched = {
    sessionID: 'sess1',
    gameID,
    unsubscribe: () => {},
    lastProcessedTurn: -1,
    registered: false,
    latestDoc: doc,
    turnWatch: null,
    lastSnapshotMs: T,
  };

  await (fi as never as { onGameUpdate: (w: unknown, d: unknown) => Promise<void> }).onGameUpdate(
    watched,
    doc
  );
  for (let i = 0; i < 5; i++) await new Promise((res) => setImmediate(res));

  expect(deadlines.length).toBe(1);
  return deadlines[0];
}

// THIS SUITE ASSERTS ON THE LEGACY PATH, so it names the engine EXPLICITLY in
// the config rather than riding the ambient default. The default is a measured
// decision that can move; what this file is about does not. Without it, a
// default flip would reroute the full pass out from under these assertions and
// read as a regression in something unrelated.
//
// It used to pin `CENTAUR_ENGINE` in a beforeEach/afterEach pair, which is one
// more reason the environment was the wrong home for this: a suite could only
// pin it by mutating process state it then had to remember to restore.

describe('the full pass deadline comes from the guard', () => {
  let nowSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(T);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    nowSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('a turn whose arrival matches its server start is the legacy endTime - 150', async () => {
    const deadline = await deadlineForTurn('game-in-sync', T);
    expect(deadline).toBe(T + BUDGET_MS - 150);
    expect(deadline).toBe(Math.max(T + 200, T + BUDGET_MS - 150));
  });

  test('a turn with no startTime on the wire falls back to the legacy expression', async () => {
    const deadline = await deadlineForTurn('game-no-start', null);
    expect(deadline).toBe(Math.max(T + 200, T + BUDGET_MS - 150));
  });

  test('a local clock provably behind the server shortens the decision by the proven gap', async () => {
    // The turn says it started 400 ms in this host's FUTURE. Delivery latency
    // cannot be negative, so the local clock is behind by at least 400 ms —
    // exactly the case that used to overrun endTime in silence.
    const deadline = await deadlineForTurn('game-slow-clock', T + 400);
    expect(deadline).toBe(T + BUDGET_MS - 150 - 400);
    expect(deadline).toBeLessThan(Math.max(T + 200, T + BUDGET_MS - 150));
  });

  test('a slow arrival is latency, not skew, and costs the decision nothing', async () => {
    // The turn started 900 ms ago in server time: that is delivery latency,
    // which shortens the usable window but does NOT move the deadline, and
    // guessing a fast clock from it would throw away budget for nothing.
    const deadline = await deadlineForTurn('game-latency', T - 900);
    expect(deadline).toBe(Math.max(T + 200, T + BUDGET_MS - 150));
  });

  test('a turn already past its deadline still gets the legacy compute floor', async () => {
    const nowPastEnd = T + BUDGET_MS + 5_000;
    nowSpy.mockReturnValue(nowPastEnd);
    const deadline = await deadlineForTurn('game-late', nowPastEnd);
    expect(deadline).toBe(nowPastEnd + 200);
  });
});
