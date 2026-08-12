/**
 * Command-event logging and per-turn command-state snapshots.
 *
 * Every operator command (goto/near/manual/clear/…) must be recorded with the
 * issuing operator's identity, and applyResolvedMoves must persist a snapshot
 * of each snake's command state exactly as it stood when the turn ended — in
 * the live broadcast shape — so the history viewer can re-enact who commanded
 * what through the same render paths live play uses.
 */

import { ActiveGameManager, TurnData, MoveEvaluation, CommandTurnState } from '../server/active-game-manager';
import { CommandLogger, CommandEventEntry } from '../logic/command-logger';
import { GameState, Snake, Coord, Direction } from '../types/battlesnake';

jest.mock('../logic/command-logger', () => {
  const logEvent = jest.fn();
  const logTurnState = jest.fn();
  return {
    CommandLogger: {
      getInstance: () => ({ logEvent, logTurnState }),
    },
  };
});

const mockLogger = CommandLogger.getInstance() as unknown as {
  logEvent: jest.Mock;
  logTurnState: jest.Mock;
};

function makeSnake(id: string, head: Coord, length = 3): Snake {
  const body: Coord[] = [];
  for (let i = 0; i < length; i++) {
    body.push({ x: head.x, y: head.y - i });
  }
  return {
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

// Per-move evaluations where `best` outscores every other candidate, carrying
// the waypoint weights the goto/near re-bias needs.
function makeEvaluations(best: Direction): MoveEvaluation[] {
  return (['up', 'down', 'left', 'right'] as Direction[]).map((move) => ({
    move,
    score: move === best ? 500 : 10,
    numStates: 1,
    breakdown: {
      trapped: 0,
      weights: { gotoProgress: 300, nearProgress: 250 },
      weighted: { gotoProgressScore: 0, nearProgressScore: 0 },
    },
  }));
}

function makeTurnData(gs: GameState, botMove: Direction): TurnData {
  return {
    gameState: gs,
    moveEvaluations: makeEvaluations(botMove),
    territoryCells: {},
    safeMoves: ['up', 'down', 'left', 'right'],
    botRecommendation: botMove,
    timestamp: Date.now(),
  };
}

function eventsOfType(type: string): CommandEventEntry[] {
  return mockLogger.logEvent.mock.calls
    .map((c) => c[0] as CommandEventEntry)
    .filter((e) => e.eventType === type);
}

describe('Command logging and turn-end command-state snapshots', () => {
  let mgr: ActiveGameManager;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    mgr = ActiveGameManager.getInstance();
    mgr.setMoveSubmitter(async () => {});
    mockLogger.logEvent.mockClear();
    mockLogger.logTurnState.mockClear();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function processTurn(gameId: string, snakeId: string, snakes: Snake[], turn: number, botMove: Direction) {
    const gs = makeGameState(gameId, turn, snakes, snakeId);
    const existing = mgr.getGame(gameId);
    if (!existing || !existing.controlledSnakes.has(snakeId)) {
      mgr.registerGame(gs);
    }
    mgr.updateGameState(gameId, snakeId, gs);
    mgr.setBotRecommendation(gameId, snakeId, botMove, makeTurnData(gs, botMove));
  }

  // Enrol + select: the standard operator setup for command entry points.
  function enrolAndSelect(gameId: string, snakeId: string, userId: string, name: string): { color: string } {
    const enrol = mgr.addConnectedUser(gameId, userId, name);
    expect(enrol && 'user' in enrol).toBe(true);
    const sel = mgr.selectSnake(gameId, snakeId, userId);
    expect(sel.success).toBe(true);
    return { color: (enrol as any).user.color };
  }

  test('goto command logs a goto-set event attributed to the operator', () => {
    const gameId = 'cmd-goto';
    processTurn(gameId, 'A', [makeSnake('A', { x: 5, y: 5 })], 1, 'right');
    const { color } = enrolAndSelect(gameId, 'A', 'user-1', 'Alice');

    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, 'user-1');

    const events = eventsOfType('goto-set');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      gameId,
      snakeId: 'A',
      turn: 1,
      operator: { userId: 'user-1', name: 'Alice', color },
      payload: { target: { x: 8, y: 5 }, targets: [{ x: 8, y: 5 }] },
    });
  });

  test('near command logs near-set; clearing logs waypoint-clear and drops attribution', () => {
    const gameId = 'cmd-near';
    processTurn(gameId, 'A', [makeSnake('A', { x: 5, y: 5 })], 1, 'up');
    enrolAndSelect(gameId, 'A', 'user-2', 'Bob');

    mgr.setWaypoint(gameId, 'A', { type: 'blue', x: 2, y: 9 }, 'user-2');
    expect(eventsOfType('near-set')).toHaveLength(1);
    expect(eventsOfType('near-set')[0].payload).toEqual({ target: { x: 2, y: 9 } });
    expect(mgr.getCommandStateForGame(gameId)!.operators['A']?.name).toBe('Bob');

    mgr.setWaypoint(gameId, 'A', null, 'user-2');
    const clears = eventsOfType('waypoint-clear');
    expect(clears).toHaveLength(1);
    expect(clears[0].payload).toEqual({ cleared: 'near' });
    expect(mgr.getCommandStateForGame(gameId)!.operators['A']).toBeNull();
  });

  test('goto queue toggles log goto-append / goto-remove with the resulting queue', () => {
    const gameId = 'cmd-toggle';
    processTurn(gameId, 'A', [makeSnake('A', { x: 5, y: 5 })], 1, 'right');
    enrolAndSelect(gameId, 'A', 'user-3', 'Cara');

    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, 'user-3');
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 8 }, 'user-3', true);
    expect(eventsOfType('goto-append')[0].payload).toEqual({
      target: { x: 8, y: 8 },
      targets: [{ x: 8, y: 5 }, { x: 8, y: 8 }],
    });

    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, 'user-3', true);
    expect(eventsOfType('goto-remove')[0].payload).toEqual({
      target: { x: 8, y: 5 },
      targets: [{ x: 8, y: 8 }],
    });
  });

  test('manual move logs manual-move attributed to the selecting user', () => {
    const gameId = 'cmd-manual';
    processTurn(gameId, 'A', [makeSnake('A', { x: 5, y: 5 })], 1, 'up');
    enrolAndSelect(gameId, 'A', 'user-4', 'Dee');

    mgr.setUserSelection(gameId, 'A', 'left');

    const events = eventsOfType('manual-move');
    expect(events).toHaveLength(1);
    expect(events[0].operator?.name).toBe('Dee');
    expect(events[0].payload).toEqual({ move: 'left' });
  });

  test('applyResolvedMoves persists the turn-end snapshot in the live broadcast shape', () => {
    const gameId = 'cmd-snapshot';
    processTurn(gameId, 'A', [makeSnake('A', { x: 5, y: 5 })], 1, 'right');
    const { color } = enrolAndSelect(gameId, 'A', 'user-5', 'Eve');
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, 'user-5');

    mgr.applyResolvedMoves(gameId, 1, { A: 'right' });

    expect(mockLogger.logTurnState).toHaveBeenCalledTimes(1);
    const [loggedGameId, loggedTurn, state] = mockLogger.logTurnState.mock.calls[0] as [string, number, CommandTurnState];
    expect(loggedGameId).toBe(gameId);
    expect(loggedTurn).toBe(1);
    // The snapshot mirrors what the live WebSocket broadcast carries.
    expect(state.activeIntentModes['A']).toBe('goto');
    expect(state.waypoints['A']).toEqual({ type: 'green', cells: [{ x: 8, y: 5 }] });
    expect(state.routes['A'].cells.length).toBeGreaterThan(0);
    expect(state.operators['A']).toEqual({ userId: 'user-5', name: 'Eve', color });
    expect(state.owners['A']).toEqual({ userId: 'user-5', name: 'Eve', color });
    expect(state.stagedMoves['A']).toMatchObject({
      requestedMove: 'right',
      source: 'waypoint',
      color, // human-commanded move renders in the operator's colour
    });
  });

  test('command attribution survives deselect until the command is cleared', () => {
    const gameId = 'cmd-deselect';
    processTurn(gameId, 'A', [makeSnake('A', { x: 5, y: 5 })], 1, 'right');
    const { color } = enrolAndSelect(gameId, 'A', 'user-6', 'Fay');
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 9, y: 5 }, 'user-6');

    mgr.deselectSnake(gameId, 'user-6');

    const state = mgr.getCommandStateForGame(gameId)!;
    expect(state.operators['A']).toEqual({ userId: 'user-6', name: 'Fay', color });
    expect(state.stagedMoves['A'].color).toBe(color);
  });

  test('goto arrival shift logs a system event and preserves attribution on the remaining queue', () => {
    const gameId = 'cmd-arrival';
    processTurn(gameId, 'A', [makeSnake('A', { x: 5, y: 5 })], 1, 'right');
    enrolAndSelect(gameId, 'A', 'user-7', 'Gus');
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 6, y: 5 }, 'user-7');
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 9, y: 5 }, 'user-7', true);

    // Next turn: the snake arrived on the first target — the queue shifts.
    const arrived = makeSnake('A', { x: 6, y: 5 });
    mgr.updateGameState(gameId, 'A', makeGameState(gameId, 2, [arrived], 'A'));

    const shifts = eventsOfType('goto-target-reached');
    expect(shifts).toHaveLength(1);
    expect(shifts[0].operator).toBeNull();
    expect(shifts[0].payload).toEqual({ target: { x: 6, y: 5 }, targets: [{ x: 9, y: 5 }] });

    const state = mgr.getCommandStateForGame(gameId)!;
    expect(state.activeIntentModes['A']).toBe('goto');
    expect(state.operators['A']?.name).toBe('Gus');
    expect(state.waypoints['A'].cells).toEqual([{ x: 9, y: 5 }]);
  });

  test('a snake dead since an earlier turn is dropped from the snapshot stagedMoves', () => {
    const gameId = 'cmd-stale';
    processTurn(gameId, 'A', [makeSnake('A', { x: 5, y: 5 }), makeSnake('B', { x: 1, y: 1 })], 1, 'right');
    processTurn(gameId, 'B', [makeSnake('A', { x: 5, y: 5 }), makeSnake('B', { x: 1, y: 1 })], 1, 'up');

    // Only A gets fresh turn data for turn 2 — B's staged record stays bound
    // to turn 1 (as it would after B died).
    processTurn(gameId, 'A', [makeSnake('A', { x: 5, y: 6 })], 2, 'right');

    mgr.applyResolvedMoves(gameId, 2, { A: 'right' });
    const calls = mockLogger.logTurnState.mock.calls;
    const state = calls[calls.length - 1][2] as CommandTurnState;
    expect(state.stagedMoves['A']).toBeDefined();
    expect(state.stagedMoves['B']).toBeUndefined();
  });
});
