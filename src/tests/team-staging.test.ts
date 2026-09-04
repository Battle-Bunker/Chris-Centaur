/**
 * Team staging as the manager sees it: the opt-in switch between the per-unit
 * MoveSubmitter and the team-scoped one, and the pin-shaped observation of
 * staged intent.
 *
 * `src/tests/wire-team-submitter.test.ts` proves the chunking, exclusion and
 * confirm/retry. This proves the two things only the manager can: that the
 * legacy path is EXACTLY what happens until a game opts in, and that when it
 * does, the joint set handed over is the whole set, coalesced, with committed
 * units already gone.
 */

import { ActiveGameManager, PinIntentEvent, TurnData } from '../server/active-game-manager';
import { CentaurMove, Coord, Direction, GameState, Snake } from '../types/battlesnake';
import type { TeamStagedUnit } from '../wire/team-submitter';

jest.mock('../logic/command-logger', () => {
  const logEvent = jest.fn();
  const logTurnState = jest.fn();
  return { CommandLogger: { getInstance: () => ({ logEvent, logTurnState }) } };
});

function makeSnake(id: string, head: Coord, length = 3): Snake {
  const body: Coord[] = [];
  for (let i = 0; i < length; i++) body.push({ x: head.x, y: head.y - i });
  return {
    orientation: { dx: 0, dy: -1 },
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head,
    length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
  };
}

function makeGameState(gameId: string, turn: number, snakes: Snake[], youId: string): GameState {
  const you = snakes.find((s) => s.id === youId)!;
  return {
    game: { id: gameId, ruleset: { name: 'standard', version: '1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
    turn,
    board: { width: 11, height: 11, food: [], hazards: [], snakes },
    you,
  };
}

function makeTurnData(gs: GameState, move: Direction): TurnData {
  return {
    gameState: gs,
    moveEvaluations: [],
    territoryCells: {},
    botRecommendation: move,
    timestamp: Date.now(),
  };
}

interface UnitPublish {
  snakeId: string;
  turn: number;
  move: CentaurMove;
  source: string;
}
interface TeamPublish {
  gameId: string;
  turn: number;
  moves: TeamStagedUnit[];
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('team staging', () => {
  let mgr: ActiveGameManager;
  let unitPublished: UnitPublish[];
  let teamPublished: TeamPublish[];
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    mgr = ActiveGameManager.getInstance();
    unitPublished = [];
    teamPublished = [];
    mgr.setMoveSubmitter(async (_gameId, snakeId, turn, move, source) => {
      unitPublished.push({ snakeId, turn, move, source });
    });
    mgr.setTeamMoveSubmitter(async (gameId, turn, moves) => {
      teamPublished.push({ gameId, turn, moves: [...moves] });
    });
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    mgr.setTeamMoveSubmitter(null);
    mgr.setMoveCommitter(null);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  /** Register a team and drive one turn of bot recommendations. */
  function processTeamTurn(
    gameId: string,
    snakes: Snake[],
    turn: number,
    moves: Record<string, Direction>
  ) {
    for (const snake of snakes) {
      const gs = makeGameState(gameId, turn, snakes, snake.id);
      const existing = mgr.getGame(gameId);
      if (!existing || !existing.controlledSnakes.has(snake.id)) mgr.registerGame(gs, snake.id);
    }
    const board = makeGameState(gameId, turn, snakes, snakes[0].id);
    mgr.updateBoard(gameId, board);
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
    for (const snake of snakes) {
      const gs = makeGameState(gameId, turn, snakes, snake.id);
      mgr.setBotRecommendation(gameId, snake.id, moves[snake.id], makeTurnData(gs, moves[snake.id]));
    }
  }

  const team = () => [
    makeSnake('A', { x: 3, y: 3 }),
    makeSnake('B', { x: 6, y: 6 }),
    makeSnake('C', { x: 9, y: 3 }),
  ];

  describe('the legacy path is the default and is untouched', () => {
    test('without opting in, every unit publishes on its own', async () => {
      const gameId = 'g-legacy-default';
      processTeamTurn(gameId, team(), 0, { A: 'right', B: 'left', C: 'up' });
      await tick();
      expect(mgr.isTeamStagingEnabled(gameId)).toBe(false);
      expect(unitPublished.map((p) => p.snakeId).sort()).toEqual(['A', 'B', 'C']);
      expect(teamPublished).toEqual([]);
    });

    test('turning team staging off again returns to the per-unit path', async () => {
      const gameId = 'g-off-again';
      mgr.enableTeamStaging(gameId, true);
      processTeamTurn(gameId, team(), 0, { A: 'right', B: 'left', C: 'up' });
      await tick();
      expect(unitPublished).toEqual([]);

      mgr.enableTeamStaging(gameId, false);
      unitPublished = [];
      teamPublished = [];
      processTeamTurn(gameId, team(), 1, { A: 'left', B: 'right', C: 'down' });
      await tick();
      expect(unitPublished.map((p) => p.snakeId).sort()).toEqual(['A', 'B', 'C']);
      expect(teamPublished).toEqual([]);
    });
  });

  describe('opted in, the whole set goes over at once', () => {
    test('three units become ONE publish carrying all three', async () => {
      const gameId = 'g-team-set';
      mgr.enableTeamStaging(gameId, true);
      processTeamTurn(gameId, team(), 0, { A: 'right', B: 'left', C: 'up' });
      await tick();

      expect(unitPublished).toEqual([]);
      expect(teamPublished).toHaveLength(1);
      expect(teamPublished[0].gameId).toBe(gameId);
      expect(teamPublished[0].turn).toBe(0);
      expect([...teamPublished[0].moves].sort((a, b) => a.snakeId.localeCompare(b.snakeId))).toEqual([
        { snakeId: 'A', move: 'right', source: 'bot' },
        { snakeId: 'B', move: 'left', source: 'bot' },
        { snakeId: 'C', move: 'up', source: 'bot' },
      ]);
    });

    test('a mid-turn re-stage publishes the whole set again, not a delta', async () => {
      const gameId = 'g-team-restage';
      const snakes = team();
      mgr.enableTeamStaging(gameId, true);
      processTeamTurn(gameId, snakes, 0, { A: 'right', B: 'left', C: 'up' });
      await tick();
      teamPublished = [];

      const gs = makeGameState(gameId, 0, snakes, 'B');
      mgr.setBotRecommendation(gameId, 'B', 'down', makeTurnData(gs, 'down'));
      await tick();
      expect(teamPublished).toHaveLength(1);
      expect(teamPublished[0].moves).toHaveLength(3);
      expect(teamPublished[0].moves.find((m) => m.snakeId === 'B')!.move).toBe('down');
    });

    test('a human command rides the same set, with its own source', async () => {
      const gameId = 'g-team-human';
      const snakes = team();
      mgr.enableTeamStaging(gameId, true);
      processTeamTurn(gameId, snakes, 0, { A: 'right', B: 'left', C: 'up' });
      await tick();
      teamPublished = [];

      mgr.getGame(gameId)!.controlledSnakes.get('A')!.selectedBy = 'u1';
      mgr.setUserSelection(gameId, 'A', 'left');
      await tick();
      expect(teamPublished).toHaveLength(1);
      expect(teamPublished[0].moves.find((m) => m.snakeId === 'A')).toEqual({
        snakeId: 'A',
        move: 'left',
        source: 'manual',
      });
    });

    test('a committed unit is already gone from the set the submitter is handed', async () => {
      const gameId = 'g-team-committed';
      const snakes = team();
      mgr.setMoveCommitter(async () => {});
      mgr.enableTeamStaging(gameId, true);
      processTeamTurn(gameId, snakes, 0, { A: 'right', B: 'left', C: 'up' });
      await tick();

      // Submit All for B only: the commit needs the confirmation first, which
      // is what makes the freeze provably lock the move the human saw.
      mgr.setConfirmedStagedMove(gameId, 'B', 0, 'left');
      const cs = mgr.getGame(gameId)!.controlledSnakes.get('B')!;
      cs.selectedBy = 'u1';
      mgr.getGame(gameId)!.controlledSnakes.get('A')!.staged = null;
      mgr.getGame(gameId)!.controlledSnakes.get('C')!.staged = null;
      mgr.commitAllStaged(gameId, 'u1');
      expect(mgr.hasCommittedTurn(gameId, 'B', 0)).toBe(true);

      expect(mgr.stagedTeamSet(gameId, 0).map((m) => m.snakeId)).toEqual([]);
      // Re-stage A and C for the turn; B stays excluded because it is frozen.
      processTeamTurn(gameId, snakes, 0, { A: 'up', B: 'down', C: 'down' });
      await tick();
      const last = teamPublished[teamPublished.length - 1];
      expect(last.moves.map((m) => m.snakeId).sort()).toEqual(['A', 'C']);
    });

    test('the publish is coalesced to once per tick however many units bind', async () => {
      const gameId = 'g-team-coalesce';
      mgr.enableTeamStaging(gameId, true);
      processTeamTurn(gameId, team(), 0, { A: 'right', B: 'left', C: 'up' });
      await tick();
      expect(teamPublished).toHaveLength(1);
    });

    test('a new turn publishes against the new turn number', async () => {
      const gameId = 'g-team-turns';
      const snakes = team();
      mgr.enableTeamStaging(gameId, true);
      processTeamTurn(gameId, snakes, 0, { A: 'right', B: 'left', C: 'up' });
      await tick();
      processTeamTurn(gameId, snakes, 1, { A: 'up', B: 'up', C: 'up' });
      await tick();
      expect(teamPublished.map((p) => p.turn)).toEqual([0, 1]);
    });

    test('no team submitter wired is an error, never a silent local-only stage', async () => {
      const gameId = 'g-team-unwired';
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mgr.setTeamMoveSubmitter(null);
      mgr.enableTeamStaging(gameId, true);
      processTeamTurn(gameId, team(), 0, { A: 'right', B: 'left', C: 'up' });
      await tick();
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('no team submitter wired'))).toBe(
        true
      );
      expect(unitPublished).toEqual([]);
      errSpy.mockRestore();
    });
  });

  describe('the read-back accessors the team submitter reads through', () => {
    test('confirmedStagedMove reports the wire state for the right turn only', async () => {
      const gameId = 'g-team-confirm';
      mgr.enableTeamStaging(gameId, true);
      processTeamTurn(gameId, team(), 0, { A: 'right', B: 'left', C: 'up' });
      await tick();
      expect(mgr.confirmedStagedMove(gameId, 'A', 0)).toBeNull();
      mgr.setConfirmedStagedMove(gameId, 'A', 0, 'right');
      expect(mgr.confirmedStagedMove(gameId, 'A', 0)).toBe('right');
      expect(mgr.confirmedStagedMove(gameId, 'A', 1)).toBeNull();
      expect(mgr.confirmedStagedMove(gameId, 'nobody', 0)).toBeNull();
    });

    test('stagedTeamSet is empty for a turn nothing is bound to', () => {
      const gameId = 'g-team-empty';
      expect(mgr.stagedTeamSet(gameId, 0)).toEqual([]);
    });
  });
});

describe('pin-shaped intent observation', () => {
  let mgr: ActiveGameManager;
  let events: PinIntentEvent[];
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let observing = false;

  beforeAll(() => {
    mgr = ActiveGameManager.getInstance();
    mgr.onPinIntent((event) => {
      if (observing) events.push(event);
    });
  });

  beforeEach(() => {
    events = [];
    observing = true;
    mgr.setMoveSubmitter(async () => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    observing = false;
    mgr.setMoveSubmitter(null);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function register(gameId: string): Snake[] {
    const snakes = [makeSnake('A', { x: 3, y: 3 })];
    const gs = makeGameState(gameId, 0, snakes, 'A');
    mgr.registerGame(gs, 'A');
    mgr.updateBoard(gameId, gs);
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
    return snakes;
  }

  test('a bot stage reports source bot — not a pin', () => {
    const gameId = 'g-pin-bot';
    const snakes = register(gameId);
    const gs = makeGameState(gameId, 0, snakes, 'A');
    mgr.setBotRecommendation(gameId, 'A', 'right', makeTurnData(gs, 'right'));
    expect(events.filter((e) => e.kind === 'staged')).toContainEqual({
      gameId,
      snakeId: 'A',
      turn: 0,
      move: 'right',
      source: 'bot',
      kind: 'staged',
    });
  });

  test('a manual selection reports source manual', () => {
    const gameId = 'g-pin-manual';
    const snakes = register(gameId);
    const gs = makeGameState(gameId, 0, snakes, 'A');
    mgr.setBotRecommendation(gameId, 'A', 'right', makeTurnData(gs, 'right'));
    events = [];
    mgr.getGame(gameId)!.controlledSnakes.get('A')!.selectedBy = 'u1';
    mgr.setUserSelection(gameId, 'A', 'left');
    expect(events).toContainEqual({
      gameId,
      snakeId: 'A',
      turn: 0,
      move: 'left',
      source: 'manual',
      kind: 'staged',
    });
  });

  test('the observation is of the move the GATE let through, not the one asked for', () => {
    const gameId = 'g-pin-gated';
    const snakes = [makeSnake('A', { x: 3, y: 3 }, 4)];
    const gs = makeGameState(gameId, 0, snakes, 'A');
    mgr.registerGame(gs, 'A');
    mgr.updateBoard(gameId, gs);
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
    mgr.setBotRecommendation(gameId, 'A', 'right', makeTurnData(gs, 'right'));
    events = [];

    // 'down' is a certain 180-degree self-collision — the consent gate swaps
    // in the bot's move, and THAT is what gets staged and observed.
    mgr.getGame(gameId)!.controlledSnakes.get('A')!.selectedBy = 'u1';
    mgr.setUserSelection(gameId, 'A', 'down');
    const staged = events.filter((e) => e.kind === 'staged');
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({ move: 'right', source: 'bot' });
  });

  test('consideration and clearing are reported without touching anything', () => {
    const gameId = 'g-pin-tentative';
    const snakes = register(gameId);
    const gs = makeGameState(gameId, 0, snakes, 'A');
    mgr.setBotRecommendation(gameId, 'A', 'right', makeTurnData(gs, 'right'));
    const before = mgr.getGame(gameId)!.controlledSnakes.get('A')!.staged;
    events = [];

    mgr.notePinConsideration(gameId, 'A', 'up');
    mgr.clearPinConsideration(gameId, 'A');
    expect(events).toEqual([
      { gameId, snakeId: 'A', turn: 0, move: 'up', source: null, kind: 'considering' },
      { gameId, snakeId: 'A', turn: 0, move: null, source: null, kind: 'cleared' },
    ]);
    // Nothing staged changed, and nothing new was published.
    expect(mgr.getGame(gameId)!.controlledSnakes.get('A')!.staged).toBe(before);
  });

  test('consideration for an unknown game or unit is a no-op', () => {
    mgr.notePinConsideration('no-such-game', 'A', 'up');
    const gameId = 'g-pin-unknown-unit';
    register(gameId);
    mgr.notePinConsideration(gameId, 'ghost', 'up');
    mgr.clearPinConsideration(gameId, 'ghost');
    expect(events.filter((e) => e.kind !== 'staged')).toEqual([]);
  });
});
