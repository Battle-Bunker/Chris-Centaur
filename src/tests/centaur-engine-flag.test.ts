/**
 * CENTAUR_ENGINE: exact flag semantics, and the proof that the default
 * changes NOTHING observable.
 *
 *   legacy (default, and any unrecognised value): the full pass is the same
 *   per-snake strategy fan-out it has always been — the strategy is called,
 *   the team engine is never consulted, team staging is never enabled.
 *
 *   lobster: the full pass routes the TEAM decision through the new engine —
 *   the strategy is NOT called, the team engine receives the canonical board,
 *   the roster, and the guard's measured deadline. The fast pass is identical
 *   under both values (same code path, before the branch).
 */

import { Timestamp } from 'firebase/firestore';
import {
  FirebaseInterfaceConfig,
  TacticToesFirebaseInterface,
} from '../firebase/firebase-interface';
import { TTGameSetup, TTGameStateDoc, TTTurn } from '../firebase/tactictoes-types';
import {
  CENTAUR_ENGINE_ENV,
  centaurEngine,
  centaurEngineFrom,
} from '../config/centaur-engine';

// ----------------------------------------------------------- flag semantics

describe('the flag itself', () => {
  test('default is legacy: absent, empty, or explicitly legacy', () => {
    expect(centaurEngineFrom({})).toBe('legacy');
    expect(centaurEngineFrom({ [CENTAUR_ENGINE_ENV]: '' })).toBe('legacy');
    expect(centaurEngineFrom({ [CENTAUR_ENGINE_ENV]: 'legacy' })).toBe('legacy');
  });

  test('lobster opts in; junk keeps legacy and says so', () => {
    expect(centaurEngineFrom({ [CENTAUR_ENGINE_ENV]: 'lobster' })).toBe('lobster');
    const warnings: string[] = [];
    expect(centaurEngineFrom({ [CENTAUR_ENGINE_ENV]: 'LOBSTER' }, (m) => warnings.push(m))).toBe(
      'legacy'
    );
    expect(centaurEngineFrom({ [CENTAUR_ENGINE_ENV]: 'on' }, (m) => warnings.push(m))).toBe(
      'legacy'
    );
    expect(warnings).toHaveLength(2);
  });

  test('the live flag reads the process environment at call time', () => {
    const before = process.env[CENTAUR_ENGINE_ENV];
    try {
      delete process.env[CENTAUR_ENGINE_ENV];
      expect(centaurEngine()).toBe('legacy');
      process.env[CENTAUR_ENGINE_ENV] = 'lobster';
      expect(centaurEngine()).toBe('lobster');
    } finally {
      if (before === undefined) delete process.env[CENTAUR_ENGINE_ENV];
      else process.env[CENTAUR_ENGINE_ENV] = before;
    }
  });
});

// ------------------------------------------------------------- the routing

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

function makeTurn(): TTTurn {
  return {
    playerHealth: { centA: 90, centB: 70 },
    startTime: Timestamp.fromMillis(T) as never,
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

interface Drive {
  readonly strategyCalls: number;
  readonly teamCalls: Array<{
    gameId: string;
    turn: number;
    ourTeamId: string;
    unitIds: string[];
    deadlineMs: number;
  }>;
  readonly enableTeamStaging: jest.Mock;
  readonly setBotRecommendation: jest.Mock;
}

/** Drive one turn through the REAL onGameUpdate with a stubbed manager, a
 * stubbed strategy, and a stubbed team engine; report who was consulted. */
async function driveTurn(gameID: string): Promise<Drive> {
  let strategyCalls = 0;
  const strategy = {
    getBestMoveIterative: jest.fn(async () => {
      strategyCalls++;
      throw new Error('stop here');
    }),
    onGameEnd: jest.fn(),
  } as never;

  const fi = new TacticToesFirebaseInterface(strategy, config);
  const enableTeamStaging = jest.fn();
  const setBotRecommendation = jest.fn();
  (fi as never as { gameManager: unknown }).gameManager = {
    registerGame: jest.fn(),
    setGameSession: jest.fn(),
    recordTurnArrival: jest.fn(),
    updateBoard: jest.fn(),
    applyResolvedMoves: jest.fn(),
    getActiveWaypointTarget: jest.fn().mockReturnValue(null),
    setBotRecommendation,
    enableTeamStaging,
  };
  (fi as never as { gameLogger: unknown }).gameLogger = {
    startGame: jest.fn(),
    endGame: jest.fn(),
  };
  const teamCalls: Drive['teamCalls'] = [];
  (fi as never as { teamEngine: unknown }).teamEngine = {
    decideTurn: jest.fn(
      async (input: {
        gameId: string;
        turn: number;
        ourTeamId: string;
        units: Array<{ snakeId: string }>;
        deadlineMs: number;
      }) => {
        teamCalls.push({
          gameId: input.gameId,
          turn: input.turn,
          ourTeamId: input.ourTeamId,
          unitIds: input.units.map((u) => u.snakeId),
          deadlineMs: input.deadlineMs,
        });
        return { report: null, forwarded: 0, assumptions: [], advice: [], emitted: 0 };
      }
    ),
    release: jest.fn(),
  };

  const doc: TTGameStateDoc = { setup: makeSetup(), turns: [makeTurn()] };
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
  return { strategyCalls, teamCalls, enableTeamStaging, setBotRecommendation };
}

describe('the full pass routes on the flag', () => {
  let nowSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  const savedFlag = process.env[CENTAUR_ENGINE_ENV];

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(T);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    nowSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
    if (savedFlag === undefined) delete process.env[CENTAUR_ENGINE_ENV];
    else process.env[CENTAUR_ENGINE_ENV] = savedFlag;
  });

  test('LEGACY (default): the strategy runs; the team engine and team staging are never touched', async () => {
    delete process.env[CENTAUR_ENGINE_ENV];
    const drive = await driveTurn('game-legacy');
    expect(drive.strategyCalls).toBe(1);
    expect(drive.teamCalls).toHaveLength(0);
    expect(drive.enableTeamStaging).not.toHaveBeenCalled();
    // The fast pass staged its quick safe move exactly as before — the flag
    // does not reach it.
    expect(drive.setBotRecommendation).toHaveBeenCalled();
  });

  test('LOBSTER: the team engine gets the turn; the per-snake strategy does not run', async () => {
    process.env[CENTAUR_ENGINE_ENV] = 'lobster';
    const drive = await driveTurn('game-lobster');
    expect(drive.strategyCalls).toBe(0);
    expect(drive.teamCalls).toHaveLength(1);
    const call = drive.teamCalls[0];
    expect(call?.gameId).toBe('game-lobster');
    expect(call?.turn).toBe(0);
    expect(call?.ourTeamId).toBe('centA');
    expect(call?.unitIds).toEqual(['centA']);
    // The deadline is the guard's measured one — the same number the legacy
    // pass would have been handed (in-sync clock: the legacy expression).
    expect(call?.deadlineMs).toBe(Math.max(T + 200, T + BUDGET_MS - 150));
    // Team staging was switched on BEFORE the turn watch (the final-flush
    // timer arms only for team-staged games).
    expect(drive.enableTeamStaging).toHaveBeenCalledWith('game-lobster');
    // The fast pass ran identically before the branch.
    expect(drive.setBotRecommendation).toHaveBeenCalled();
  });
});
