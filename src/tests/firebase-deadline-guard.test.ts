/**
 * The clock-skew guard's one behavioural claim: the full decision pass's
 * deadline is MEASURED rather than assumed.
 *
 * `src/tests/wire-deadline.test.ts` pins the arithmetic. This pins the WIRING —
 * that the transport actually feeds the guard the turn's server timestamps and
 * hands the decision engine what the guard returns, so a host clock behind
 * server time shortens the decision instead of silently overrunning the
 * deadline (an overrun is invisible: the late write is accepted and then
 * discarded).
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
    playerEnergy: { centA: 90, centB: 70 },
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
};

/** Drives one turn through onGameUpdate and reports the deadline the full
 * decision pass was handed. */
async function deadlineForTurn(gameID: string, startTimeMs: number | null): Promise<number> {
  const deadlines: number[] = [];
  const fi = new TacticToesFirebaseInterface(config);
  // The one decision engine, stubbed at the seam the transport hands the
  // deadline across. There is no flag and no second pass to distinguish any
  // more, so this IS the full pass.
  (fi as never as { teamEngine: unknown }).teamEngine = {
    decideTurn: jest.fn(async (input: { deadlineMs: number }) => {
      deadlines.push(input.deadlineMs);
      throw new Error('stop here — the deadline is all this test wants');
    }),
    release: jest.fn(),
  };
  (fi as never as { gameManager: unknown }).gameManager = {
    registerGame: jest.fn(),
    setGameSession: jest.fn(),
    recordTurnArrival: jest.fn(),
    updateBoard: jest.fn(),
    applyResolvedMoves: jest.fn(),
    getActiveWaypointTarget: jest.fn().mockReturnValue(null),
    setBotRecommendation: jest.fn(),
    enableTeamStaging: jest.fn(),
    updatePieceTurn: jest.fn(),
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
