/**
 * `BotConfig.engine`: exact config semantics, and the proof that BOTH values
 * are whole routes rather than one route and a fallback.
 *
 *   lobster (default since 2026-08-26, and what any unrecognised value keeps):
 *   the full pass routes the TEAM decision through the new engine — the
 *   strategy is NOT called, the team engine receives the canonical board, the
 *   roster, and the guard's measured deadline, and staging leaves on the TEAM
 *   transport.
 *
 *   legacy: the full pass is the per-snake strategy fan-out it always was —
 *   the strategy is called, the team engine is never consulted, team staging
 *   is never enabled, and staging leaves on the PER-UNIT transport.
 *
 * The fast pass is identical under both values (same code path, before the
 * branch). The legacy route is not deprecated by the flip: it is one config
 * field away and this file is what keeps it working.
 *
 * IT WAS `CENTAUR_ENGINE`, read from the environment at every routing
 * decision. The tests below moved with it, and one of them changed SHAPE
 * rather than syntax — see "flipping BACK to legacy mid-game".
 */

import { Timestamp } from 'firebase/firestore';
import {
  FirebaseInterfaceConfig,
  TacticToesFirebaseInterface,
} from '../firebase/firebase-interface';
import { TTGameSetup, TTGameStateDoc, TTTurn } from '../firebase/tactictoes-types';
import { CENTAUR_ENGINE_DEFAULT, centaurEngineOf } from '../config/centaur-engine';
import type { CentaurEngineKind } from '../config/centaur-engine';
import { DEFAULT_BOT_CONFIG, resolveBotConfig } from '../lobster/bot-config';
import { ActiveGameManager } from '../server/active-game-manager';
import type { CentaurMove, Coord, Direction, GameState, Snake } from '../types/battlesnake';
import { MIN_COMPUTE_MS, MIN_RESERVE_MS } from '../wire/deadline';

jest.mock('../logic/command-logger', () => {
  const logEvent = jest.fn();
  const logTurnState = jest.fn();
  return { CommandLogger: { getInstance: () => ({ logEvent, logTurnState }) } };
});

// --------------------------------------------------------- config semantics

describe('the engine selection itself', () => {
  test('the default is lobster: absent, null or empty', () => {
    expect(CENTAUR_ENGINE_DEFAULT).toBe('lobster');
    expect(DEFAULT_BOT_CONFIG.engine).toBe('lobster');
    expect(centaurEngineOf(undefined)).toBe('lobster');
    expect(centaurEngineOf('')).toBe('lobster');
    expect(resolveBotConfig({}).engine).toBe('lobster');
  });

  test('legacy is still reachable, by name, exactly', () => {
    expect(centaurEngineOf('legacy')).toBe('legacy');
    expect(resolveBotConfig({ engine: 'legacy' }).engine).toBe('legacy');
  });

  test('junk keeps the default and says so — a typo must not reroute production', () => {
    const warnings: string[] = [];
    expect(centaurEngineOf('LOBSTER', (m) => warnings.push(m))).toBe(CENTAUR_ENGINE_DEFAULT);
    expect(centaurEngineOf('on', (m) => warnings.push(m))).toBe(CENTAUR_ENGINE_DEFAULT);
    expect(centaurEngineOf('LEGACY', (m) => warnings.push(m))).toBe(CENTAUR_ENGINE_DEFAULT);
    expect(warnings).toHaveLength(3);
  });

  test('THE ENVIRONMENT IS NOT CONSULTED — the whole point of the teardown', () => {
    // The variable that used to drive this is dead. Setting it moves nothing,
    // and this test is here so that re-introducing the read fails loudly rather
    // than quietly restoring the paradigm the owner removed.
    const before = process.env.CENTAUR_ENGINE;
    try {
      process.env.CENTAUR_ENGINE = 'legacy';
      expect(resolveBotConfig({}).engine).toBe('lobster');
      expect(resolveBotConfig({ engine: 'lobster' }).engine).toBe('lobster');
    } finally {
      if (before === undefined) delete process.env.CENTAUR_ENGINE;
      else process.env.CENTAUR_ENGINE = before;
    }
  });
});

// ------------------------------------------------------------- the routing

const W = 7;
const H = 6;
const idx = (x: number, y: number) => y * W + x;

const T = 1_700_000_000_000;
const BUDGET_MS = 10_000;

function makeSetup(maxTurnTime = 10): TTGameSetup {
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
    maxTurnTime,
  };
}

function makeTurn(budgetMs = BUDGET_MS): TTTurn {
  return {
    playerHealth: { centA: 90, centB: 70 },
    startTime: Timestamp.fromMillis(T) as never,
    endTime: Timestamp.fromMillis(T + budgetMs) as never,
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
  /** Per-unit publishes the REAL manager made (the legacy transport). */
  readonly unitPublished: Array<{ snakeId: string; turn: number; move: CentaurMove }>;
  /** Team-batched publishes the REAL manager made (the team transport). */
  readonly teamPublished: Array<{ gameId: string; turn: number; snakeIds: string[] }>;
  readonly teamStagingEnabled: boolean;
  readonly setBotRecommendation: jest.Mock;
}

/**
 * Drive one turn through the REAL `onGameUpdate` against the REAL
 * ActiveGameManager.
 *
 * THE MANAGER IS NOT A MOCK (V4 H2). The flag's whole claim is that the
 * default changes nothing OBSERVABLE, and an eight-method stub can observe
 * nothing: it cannot see `stageMove`'s team-staging early return, so it cannot
 * tell the batched transport from the per-unit one, and a flag flip that left
 * the wrong transport wired would pass. The real manager is driven with both
 * submitters captured, so which transport a staged move actually travelled on
 * is a fact this test reads rather than a fact it assumes.
 *
 * The strategy and the team engine ARE stubs: the question they answer is
 * "who was consulted", and a real minimax run would only add wall clock.
 */
async function driveTurn(
  gameID: string,
  options: {
    maxTurnTime?: number;
    manager?: ActiveGameManager;
    /** The bot's engine. Absent plays the shipped default. */
    engine?: CentaurEngineKind;
  } = {}
): Promise<Drive> {
  let strategyCalls = 0;
  const strategy = {
    getBestMoveIterative: jest.fn(async () => {
      strategyCalls++;
      throw new Error('stop here');
    }),
    onGameEnd: jest.fn(),
  } as never;

  const fi = new TacticToesFirebaseInterface(strategy, {
    ...config,
    ...(options.engine === undefined ? {} : { bot: { engine: options.engine } }),
  });
  const manager = options.manager ?? ActiveGameManager.getInstance();
  const unitPublished: Drive['unitPublished'] = [];
  const teamPublished: Drive['teamPublished'] = [];
  manager.setMoveSubmitter(async (_gameId, snakeId, turn, move) => {
    unitPublished.push({ snakeId, turn, move });
  });
  manager.setTeamMoveSubmitter(async (gameId, turn, moves) => {
    teamPublished.push({ gameId, turn, snakeIds: moves.map((m) => m.snakeId) });
  });
  const setBotRecommendation = jest.fn(
    (gameId: string, snakeId: string, move: CentaurMove, turnData: never) => {
      manager.setBotRecommendation(gameId, snakeId, move as Direction, turnData);
    }
  );
  (fi as never as { gameManager: unknown }).gameManager = new Proxy(manager, {
    get(target, prop, receiver): unknown {
      if (prop === 'setBotRecommendation') return setBotRecommendation;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function'
        ? (value as (...a: never[]) => unknown).bind(target)
        : value;
    },
  });
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
        return {
          report: null,
          forwarded: 0,
          assumptions: [],
          advice: [],
          emitted: 0,
          refusals: {},
        };
      }
    ),
    release: jest.fn(),
  };

  const budgetMs = (options.maxTurnTime ?? 10) * 1000;
  const doc: TTGameStateDoc = {
    setup: makeSetup(options.maxTurnTime ?? 10),
    turns: [makeTurn(budgetMs)],
  };
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
  return {
    strategyCalls,
    teamCalls,
    unitPublished,
    teamPublished,
    teamStagingEnabled: manager.isTeamStagingEnabled(gameID),
    setBotRecommendation,
  };
}

describe('the full pass routes on the bot', () => {
  let nowSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  const manager = ActiveGameManager.getInstance();

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(T);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    nowSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
    manager.setMoveSubmitter(null);
    manager.setTeamMoveSubmitter(null);
  });

  test('LEGACY (opt-in): the strategy runs, and the staged move rides the PER-UNIT transport', async () => {
    const drive = await driveTurn('game-legacy', { engine: 'legacy' });
    expect(drive.strategyCalls).toBe(1);
    expect(drive.teamCalls).toHaveLength(0);
    // The real manager's own switch, read from the real manager: OFF.
    expect(drive.teamStagingEnabled).toBe(false);
    // The fast pass staged its quick safe move exactly as before — and it went
    // out on the per-unit submitter, which is `stageMove`'s legacy branch
    // actually executing rather than a mock recording the call.
    expect(drive.setBotRecommendation).toHaveBeenCalled();
    expect(drive.unitPublished.length).toBeGreaterThan(0);
    expect(new Set(drive.unitPublished.map((p) => p.snakeId))).toEqual(new Set(['centA']));
    expect(drive.teamPublished).toEqual([]);
  });

  test('LOBSTER (default): the team engine gets the turn, and staging is the TEAM transport', async () => {
    const drive = await driveTurn('game-lobster');
    expect(drive.strategyCalls).toBe(0);
    expect(drive.teamCalls).toHaveLength(1);
    const call = drive.teamCalls[0];
    expect(call?.gameId).toBe('game-lobster');
    expect(call?.turn).toBe(0);
    expect(call?.ourTeamId).toBe('centA');
    expect(call?.unitIds).toEqual(['centA']);
    // The deadline is the guard's measured one. On a ten-second turn the
    // reserve branch is the binding one (see the short-turn case below for the
    // floor branch, which these numbers would otherwise never exercise).
    expect(call?.deadlineMs).toBe(T + BUDGET_MS - MIN_RESERVE_MS);
    // Team staging is on, and `stageMove`'s early return actually fired: the
    // fast pass's staged move left on the TEAM submitter, not the per-unit one.
    expect(drive.teamStagingEnabled).toBe(true);
    expect(drive.setBotRecommendation).toHaveBeenCalled();
    expect(drive.unitPublished).toEqual([]);
    expect(drive.teamPublished.map((p) => p.snakeIds)).toEqual([['centA']]);
  });

  test('the deadline FLOOR is a real branch: a short turn is held at now + minCompute', async () => {
    // De-coincidence (V4 H2). At maxTurnTime = 10 s both branches of
    // `max(now + MIN_COMPUTE_MS, endTime - reserve)` land on the same number,
    // so dropping the floor entirely still passes. At 300 ms they differ:
    // endTime - 150 = T + 150, and the floor is T + 200.
    const drive = await driveTurn('game-short-turn', { maxTurnTime: 0.3, engine: 'lobster' });
    expect(drive.teamCalls).toHaveLength(1);
    expect(drive.teamCalls[0]?.deadlineMs).toBe(T + MIN_COMPUTE_MS);
    expect(T + MIN_COMPUTE_MS).not.toBe(T + 300 - MIN_RESERVE_MS);
  });

  test('a LEGACY interface turns the team transport off for a game a lobster one enabled (V4 H3)', async () => {
    // WHAT THIS TEST USED TO BE, and why it changed shape. Under the flag the
    // selection was re-read at every routing decision, so it could flip
    // mid-game, and leaving `teamStagedGames` set under the per-snake path
    // would route a legacy game's staged writes through the batched submitter.
    // A bot cannot flip mid-game, so that exact race is gone — but the manager
    // is a PROCESS-WIDE singleton and its team-staging bit survives the
    // interface that set it, so the branch still has to be driven in both
    // directions. Two interfaces on one gameID is the shape that still
    // reaches it, and it is the shape a redeploy actually produces.
    const first = await driveTurn('game-flip', { engine: 'lobster' });
    expect(first.teamStagingEnabled).toBe(true);
    expect(first.teamPublished.map((p) => p.snakeIds)).toEqual([['centA']]);

    const second = await driveTurn('game-flip', { engine: 'legacy' });
    expect(second.teamStagingEnabled).toBe(false);
    expect(second.teamCalls).toHaveLength(0);
    expect(second.strategyCalls).toBe(1);
    // And the staged move is back on the per-unit transport.
    expect(second.unitPublished.length).toBeGreaterThan(0);
    expect(new Set(second.unitPublished.map((p) => p.snakeId))).toEqual(new Set(['centA']));
    expect(second.teamPublished).toEqual([]);
  });
});

// ------------------------------------------------- the additive manager delta

/**
 * `updatePieceTurn`'s new `botRecommendation` argument is the piece bot route,
 * and its DEFAULT is the whole legacy-preservation claim for pieces: omitting
 * it must reproduce, exactly, the behaviour that existed before the argument
 * did — an uncommanded piece stages nothing and the server defaults it to
 * stay. The flag suite drives it directly because nothing else can: the flag
 * routing tests run a snake board, and a mock manager has no default to test.
 */
describe('updatePieceTurn: the default argument is the legacy behaviour', () => {
  const manager = ActiveGameManager.getInstance();
  const gameId = 'g-piece-default';
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  const published: Array<{ snakeId: string; move: CentaurMove }> = [];

  const at = (x: number, y: number): Coord => ({ x, y });
  const pieceSnake = (id: string, head: Coord): Snake =>
    ({
      id,
      name: id,
      latency: '0',
      health: 100,
      body: [head],
      head,
      length: 1,
      shout: '',
      squad: '',
      unitType: 'king',
      orientation: { dx: 0, dy: -1 },
      customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    }) as Snake;

  const state = (turn: number, youId: string): GameState => {
    const snakes = [pieceSnake('P', at(2, 2)), pieceSnake('Q', at(6, 6))];
    return {
      game: { id: gameId, ruleset: { name: 't', version: 'v', settings: {} }, map: 'm', timeout: 500, source: 't' },
      turn,
      board: { width: 9, height: 9, food: [], hazards: [], snakes },
      you: snakes.find((s) => s.id === youId) as Snake,
    };
  };

  beforeEach(() => {
    published.length = 0;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    manager.setMoveSubmitter(async (_g, snakeId, _t, move) => {
      published.push({ snakeId, move });
    });
    manager.registerGame(state(0, 'P'), 'P');
    manager.updateBoard(gameId, state(0, 'P'));
    manager.recordTurnArrival(gameId, T, 500, T + 1_000_000);
  });

  afterEach(() => {
    manager.setMoveSubmitter(null);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('omitted: nothing is staged and the turn data carries no bot rung', () => {
    manager.updatePieceTurn(gameId, 'P', state(0, 'P'));
    const controlled = manager.getGame(gameId)?.controlledSnakes.get('P');
    expect(controlled?.latestTurnData?.botRecommendation).toBeNull();
    expect(controlled?.staged ?? null).toBeNull();
    expect(published).toEqual([]);
  });

  test('supplied: the bot rung stages the destination — below manual, never above', () => {
    const destination = 2 + 3 * 11; // an arbitrary full-board index
    manager.updatePieceTurn(gameId, 'P', state(0, 'P'), destination);
    const controlled = manager.getGame(gameId)?.controlledSnakes.get('P');
    expect(controlled?.latestTurnData?.botRecommendation).toBe(destination);
    expect(controlled?.botRecommendation).toBe(destination);
    // A later call with no recommendation clears it — a stale destination from
    // the previous turn must never survive into this one.
    manager.updatePieceTurn(gameId, 'P', state(0, 'P'));
    expect(manager.getGame(gameId)?.controlledSnakes.get('P')?.botRecommendation).toBeNull();
  });
});
