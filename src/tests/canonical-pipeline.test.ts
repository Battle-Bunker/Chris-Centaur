/**
 * Contract tests for the canonical-turn pipeline: one you-less BoardSnapshot
 * per turn feeds the manager (updateBoard), per-snake views are derived only
 * at the decision boundary (withYou), and endGame drains the whole game in a
 * single call while emitting the same per-snake events the old per-snake
 * endGame produced.
 */

import { ActiveGameManager, TurnData } from '../server/active-game-manager';
import { BoardSnapshot, Coord, Direction, GameState, Snake } from '../types/battlesnake';
import { buildBoardState, buildGameState, withYou } from '../firebase/translate';
import { TTGameSetup, TTTurn } from '../firebase/tactictoes-types';

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

function makeBoard(gameId: string, turn: number, snakes: Snake[]): BoardSnapshot {
  return {
    game: { id: gameId, ruleset: { name: 'standard', version: '1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
    turn,
    board: { width: 11, height: 11, food: [], hazards: [], snakes },
  };
}

function makeTurnData(gs: GameState, botMove: Direction): TurnData {
  return {
    gameState: gs,
    moveEvaluations: [],
    territoryCells: {},
    safeMoves: ['up', 'down', 'left', 'right'],
    botRecommendation: botMove,
    timestamp: Date.now(),
  };
}

// Minimal TacticToes fixtures for the translate equivalence checks. Full-board
// coords include the 1-cell perimeter wall (7x7 full = 5x5 api).
function makeSetup(): TTGameSetup {
  return {
    teams: [
      { id: 'centA', name: 'Alpha', color: '#ff0000' },
      { id: 'centB', name: 'Bravo', color: '#0000ff' },
    ],
    snakesPerTeam: 2,
    gamePlayers: [
      { id: 'centA', teamID: 'centA', letter: 'A' },
      { id: 'centA#2', teamID: 'centA', letter: 'B' },
      { id: 'centB', teamID: 'centB', letter: 'A' },
    ],
    boardWidth: 7,
    boardHeight: 7,
    maxTurnTime: 5,
  };
}

function makeTurn(): TTTurn {
  return {
    playerHealth: { centA: 90, 'centA#2': 80, centB: 70 },
    startTime: null as any,
    endTime: null as any,
    moves: {},
    alivePlayers: ['centA', 'centA#2', 'centB'],
    food: [24],
    hazards: [],
    playerPieces: {
      centA: [10, 11, 12],
      'centA#2': [30, 31, 32],
      centB: [17, 18, 19],
    },
    winners: [],
  };
}

describe('translate: buildBoardState / buildGameState / withYou', () => {
  test('buildGameState equals buildBoardState plus a per-snake you, for every player', () => {
    const setup = makeSetup();
    const turn = makeTurn();
    const canonical = buildBoardState('g1', setup, turn, 4, 123456);

    expect((canonical as any).you).toBeUndefined();

    for (const gp of setup.gamePlayers) {
      const legacy = buildGameState('g1', setup, turn, 4, gp.id, 123456);
      expect(legacy).toEqual({ ...canonical, you: legacy.you });
      // The one-shot view's `you` matches the same snake on the shared board.
      const onBoard = canonical.board.snakes.find((s) => s.id === gp.id);
      expect(legacy.you).toEqual(onBoard);
    }
  });

  test('withYou derives an isolated per-snake view: mutating it never bleeds into the shared board', () => {
    const setup = makeSetup();
    const turn = makeTurn();
    const canonical = buildBoardState('g1', setup, turn, 4, null);

    const view = withYou(canonical, 'centA#2')!;
    expect(view).not.toBeNull();
    expect(view.you.id).toBe('centA#2');
    expect(view.turn).toBe(canonical.turn);
    expect(view.board).toBe(canonical.board); // board is shared, not copied

    const onBoard = canonical.board.snakes.find((s) => s.id === 'centA#2')!;
    expect(view.you).toEqual(onBoard);
    view.you.head.x = 99;
    view.you.body[0].y = 99;
    expect(onBoard.head.x).not.toBe(99);
    expect(onBoard.body[0].y).not.toBe(99);

    expect(withYou(canonical, 'no-such-snake')).toBeNull();
  });

  test('lastMoves attached to the canonical state rides into withYou views', () => {
    const canonical = makeBoard('g1', 3, [makeSnake('A', { x: 5, y: 5 })]);
    canonical.lastMoves = { A: 'up' };
    const view = withYou(canonical, 'A')!;
    expect(view.lastMoves).toEqual({ A: 'up' });
  });
});

describe('ActiveGameManager: single updateBoard per turn', () => {
  let mgr: ActiveGameManager;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mgr = ActiveGameManager.getInstance();
    mgr.setMoveSubmitter(async () => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    jest.clearAllTimers();
    jest.useRealTimers();
    warnSpy.mockRestore();
  });

  test('one updateBoard advances the board once, broadcasts once, and shifts each snake\'s goto queue independently', () => {
    const gameId = 'g-canonical-arrival';
    const snakes0 = [makeSnake('A', { x: 2, y: 5 }), makeSnake('B', { x: 8, y: 5 })];
    const canonical0 = makeBoard(gameId, 0, snakes0);
    mgr.registerGame(canonical0, 'A');
    mgr.registerGame(canonical0, 'B');
    mgr.updateBoard(gameId, canonical0);

    const boardUpdates: number[] = [];
    mgr.onBoardUpdate((gid, gs) => {
      if (gid === gameId) boardUpdates.push(gs.turn);
    });

    const game = mgr.getGame(gameId)!;
    const csA = game.controlledSnakes.get('A')!;
    const csB = game.controlledSnakes.get('B')!;
    csA.intent = { kind: 'goto', targets: [{ x: 3, y: 5 }, { x: 5, y: 5 }] };
    csB.intent = { kind: 'goto', targets: [{ x: 0, y: 0 }] };

    // A's head lands on its first target; B is nowhere near its target.
    const snakes1 = [makeSnake('A', { x: 3, y: 5 }), makeSnake('B', { x: 8, y: 6 })];
    mgr.updateBoard(gameId, makeBoard(gameId, 1, snakes1));

    expect(csA.intent).toEqual({ kind: 'goto', targets: [{ x: 5, y: 5 }] });
    expect(csB.intent).toEqual({ kind: 'goto', targets: [{ x: 0, y: 0 }] });
    expect(game.boardStateTurn).toBe(1);
    expect(boardUpdates).toEqual([1]);

    // Same-turn re-delivery is idempotent: no advance, no extra broadcast.
    mgr.updateBoard(gameId, makeBoard(gameId, 1, snakes1));
    expect(boardUpdates).toEqual([1]);
  });

  test('body[1] "stepped through" arrival is detected from the canonical board', () => {
    const gameId = 'g-canonical-stepped';
    const start = [makeSnake('A', { x: 4, y: 5 })];
    const canonical0 = makeBoard(gameId, 0, start);
    mgr.registerGame(canonical0, 'A');
    mgr.updateBoard(gameId, canonical0);
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.intent = { kind: 'goto', targets: [{ x: 5, y: 5 }] };

    // The head is already one past the target; body[1] sits on it.
    const moved = makeSnake('A', { x: 6, y: 5 });
    moved.body = [{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 }];
    mgr.updateBoard(gameId, makeBoard(gameId, 1, [moved]));

    expect(cs.intent).toEqual({ kind: 'heuristic' });
  });

  test('setBotRecommendation no longer advances the board silently — the defensive path warns', () => {
    const gameId = 'g-defensive-advance';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const canonical0 = makeBoard(gameId, 0, snakes);
    mgr.registerGame(canonical0, 'A');
    mgr.updateBoard(gameId, canonical0);

    // Feed turn-1 decisions WITHOUT feeding the board first.
    const view1 = withYou(makeBoard(gameId, 1, snakes), 'A')!;
    mgr.setBotRecommendation(gameId, 'A', 'up', makeTurnData(view1, 'up'));

    expect(mgr.getGame(gameId)!.boardStateTurn).toBe(1); // still advances (defensive)
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes('updateBoard should have run first')),
    ).toBe(true);
  });
});

describe('ActiveGameManager: single endGame drains the whole game', () => {
  let mgr: ActiveGameManager;

  beforeEach(() => {
    jest.useFakeTimers();
    mgr = ActiveGameManager.getInstance();
    mgr.setMoveSubmitter(async () => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('emits one snake-ended per controlled snake with gameOver only on the last, and one board update', () => {
    const gameId = 'g-end-fanout';
    const snakes = [makeSnake('A', { x: 5, y: 5 }), makeSnake('B', { x: 8, y: 8 })];
    const canonical0 = makeBoard(gameId, 0, snakes);
    mgr.registerGame(canonical0, 'A');
    mgr.registerGame(canonical0, 'B');
    mgr.updateBoard(gameId, canonical0);

    const ends: Array<{ snakeId: string; turn: number; gameOver: boolean }> = [];
    const boards: number[] = [];
    mgr.onGameEnd((gid, snakeId, finalState, gameOver) => {
      if (gid === gameId) ends.push({ snakeId, turn: finalState.turn, gameOver });
    });
    mgr.onBoardUpdate((gid, gs) => {
      if (gid === gameId) boards.push(gs.turn);
    });

    const final = makeBoard(gameId, 7, [makeSnake('B', { x: 9, y: 9 })]);
    mgr.endGame(gameId, final);

    expect(ends).toEqual([
      { snakeId: 'A', turn: 7, gameOver: false },
      { snakeId: 'B', turn: 7, gameOver: true },
    ]);
    expect(boards).toEqual([7]);
    expect(mgr.getGame(gameId)).toBeUndefined();

    // Duplicate end signal after the game is gone: a no-op, no re-fired events.
    mgr.endGame(gameId, final);
    expect(ends).toHaveLength(2);
  });

  test('a stale final state is rejected: snakes are removed but no snake-ended fires and the board never rewinds', () => {
    const gameId = 'g-end-stale';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const canonical5 = makeBoard(gameId, 5, snakes);
    mgr.registerGame(canonical5, 'A');
    mgr.updateBoard(gameId, canonical5);
    // Advance to turn 6 so a turn-5 final state is stale.
    mgr.updateBoard(gameId, makeBoard(gameId, 6, snakes));

    const ends: string[] = [];
    mgr.onGameEnd((gid, snakeId) => {
      if (gid === gameId) ends.push(snakeId);
    });

    mgr.endGame(gameId, makeBoard(gameId, 5, snakes));
    expect(ends).toEqual([]);
    expect(mgr.getGame(gameId)).toBeUndefined();
  });

  test('endGame without a final state (deleted game doc) removes snakes silently', () => {
    const gameId = 'g-end-nostate';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const canonical0 = makeBoard(gameId, 0, snakes);
    mgr.registerGame(canonical0, 'A');

    const ends: string[] = [];
    mgr.onGameEnd((gid, snakeId) => {
      if (gid === gameId) ends.push(snakeId);
    });

    mgr.endGame(gameId);
    expect(ends).toEqual([]);
    expect(mgr.getGame(gameId)).toBeUndefined();
  });
});
