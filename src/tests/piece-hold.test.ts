/**
 * HOLD — the operator's standing "stand your ground" order.
 *
 * Movement costs health under the TacticToes rules and standing still does
 * not, so a piece with nothing worth reaching should be able to stop paying
 * for pointless steps. Hold is that command: it lives in the unit's `intent`
 * like every other one, resolves to the unit's own square (the wire's stay),
 * and re-resolves on every new board until it is lifted.
 *
 * Covered here:
 *  - canHold: pieces can, snakes (and unitType-less legacy units) cannot;
 *  - the toggle: h holds, h again reverts to no human input;
 *  - what it stages: the own-square index, sourced 'manual', published;
 *  - precedence: it outranks the engine's recommendation for the piece, and a
 *    goto / manual / clear command REPLACES it (one intent, newest wins);
 *  - the turn boundary: unlike manual, it re-stages on every new board;
 *  - the refusals: snakes, unselected units, dead units;
 *  - death: a unit gone from the canonical board loses its hold;
 *  - the command log: hold / unhold events with operator attribution, and the
 *    per-turn snapshot carrying the held set through activeIntentModes.
 *
 * Board: api 11x11 (full board 13x13 with the perimeter wall).
 */

import { ActiveGameManager, CommandTurnState } from '../server/active-game-manager';
import { CommandLogger, CommandEventEntry } from '../logic/command-logger';
import { canHold } from '../logic/piece-moves';
import { GameState, Snake, Coord, CentaurMove } from '../types/battlesnake';
import { apiCoordToIndex } from '../firebase/translate';

// Same pattern as command-logging.test.ts / piece-staging.test.ts: the logger
// is mocked so no DB writes leak out of the unit tests, and so the emitted
// command events can be asserted directly.
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

const FULL_W = 13;
const FULL_H = 13;
const fullIdx = (api: Coord) => apiCoordToIndex(api, FULL_W, FULL_H);

function makeUnit(
  id: string,
  head: Coord,
  opts: { unitType?: string; orientation?: { dx: number; dy: number }; health?: number } = {}
): Snake {
  const isPiece = !!opts.unitType && opts.unitType !== 'snake';
  const cells = isPiece ? 1 : 3;
  const body: Coord[] = [];
  for (let i = 0; i < cells; i++) body.push({ x: head.x, y: head.y - i });
  const unit: Snake = {
    orientation: opts.orientation ?? { dx: 0, dy: -1 },
    id,
    name: id,
    latency: '0',
    health: opts.health ?? 100,
    body,
    head,
    length: isPiece ? 1 : cells,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
  };
  if (opts.unitType) unit.unitType = opts.unitType;
  return unit;
}

function makeGameState(gameId: string, turn: number, snakes: Snake[], youId: string): GameState {
  const you = snakes.find(s => s.id === youId)!;
  return {
    game: { id: gameId, ruleset: { name: 'teamsnek', version: 'v1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
    turn,
    board: { width: 11, height: 11, food: [], hazards: [], snakes },
    you,
  };
}

interface Published {
  gameId: string;
  snakeId: string;
  turn: number;
  move: CentaurMove;
  source: string;
}

function eventsOfType(type: string): CommandEventEntry[] {
  return mockLogger.logEvent.mock.calls
    .map(c => c[0] as CommandEventEntry)
    .filter(e => e.eventType === type);
}

describe('canHold', () => {
  test('every chess piece can hold — its stay is a real staged move', () => {
    for (const type of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']) {
      expect(canHold(type)).toBe(true);
    }
  });

  test('a snake cannot hold — its head must vacate its square every turn', () => {
    expect(canHold('snake')).toBe(false);
  });

  test('a unit with no declared type is a snake (the legacy shape) and cannot hold', () => {
    expect(canHold(undefined)).toBe(false);
  });
});

describe('Hold command (ActiveGameManager.toggleHold)', () => {
  let mgr: ActiveGameManager;
  let published: Published[];
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mgr = ActiveGameManager.getInstance();
    published = [];
    mgr.setMoveSubmitter(async (gameId, snakeId, turn, move, source) => {
      published.push({ gameId, snakeId, turn, move, source });
    });
    mockLogger.logEvent.mockClear();
    mockLogger.logTurnState.mockClear();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    mgr.setMoveCommitter(null);
    jest.clearAllTimers();
    jest.useRealTimers();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function publishedFor(gameId: string, snakeId: string): Published[] {
    return published.filter(p => p.gameId === gameId && p.snakeId === snakeId);
  }

  // The transport intake for a controlled PIECE, in the canonical-pipeline
  // order the Firebase interface uses (see piece-staging.test.ts).
  function processPieceTurn(
    gameId: string,
    unitId: string,
    snakes: Snake[],
    turn: number,
    botRecommendation: number | null = null
  ) {
    const gs = makeGameState(gameId, turn, snakes, unitId);
    const existing = mgr.getGame(gameId);
    if (!existing || !existing.controlledSnakes.has(unitId)) {
      mgr.registerGame(gs, unitId);
    }
    mgr.updateBoard(gameId, gs);
    mgr.updatePieceTurn(gameId, unitId, gs, botRecommendation);
  }

  // Enrol + select, so commands resolve to a real operator identity.
  function enrolAndSelect(gameId: string, unitId: string, userId: string, name: string): string {
    const enrol = mgr.addConnectedUser(gameId, userId, name);
    expect(enrol && 'user' in enrol).toBe(true);
    expect(mgr.selectSnake(gameId, unitId, userId).success).toBe(true);
    return (enrol as unknown as { user: { color: string } }).user.color;
  }

  test('holding a piece stages its own square as a stay, sourced manual, and publishes it', () => {
    const gameId = 'hold-basic';
    const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook], 0);
    enrolAndSelect(gameId, 'R', 'u1', 'Alice');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    // Uncommanded: nothing staged at all.
    expect(cs.staged).toBeNull();

    expect(mgr.toggleHold(gameId, 'R', 'u1')).toEqual({ ok: true, held: true });
    expect(cs.intent.kind).toBe('hold');
    const stay = fullIdx({ x: 5, y: 5 });
    expect(cs.staged).toMatchObject({ snakeId: 'R', turn: 0, move: stay, source: 'manual' });
    expect(cs.staged!.action).toEqual({ kind: 'stay' });
    expect(publishedFor(gameId, 'R')).toEqual([
      { gameId, snakeId: 'R', turn: 0, move: stay, source: 'manual' },
    ]);
  });

  test('pressing hold again toggles it off, back to no human input', () => {
    const gameId = 'hold-toggle';
    processPieceTurn(gameId, 'K', [makeUnit('K', { x: 4, y: 4 }, { unitType: 'knight' })], 0);
    enrolAndSelect(gameId, 'K', 'u1', 'Alice');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('K')!;

    expect(mgr.toggleHold(gameId, 'K', 'u1')).toEqual({ ok: true, held: true });
    expect(mgr.toggleHold(gameId, 'K', 'u1')).toEqual({ ok: true, held: false });
    expect(cs.intent.kind).toBe('heuristic');
    expect(cs.intentBy).toBeNull();
  });

  test('hold outranks the engine: a bot recommendation for a held piece is not staged', () => {
    const gameId = 'hold-precedence';
    const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook], 0);
    enrolAndSelect(gameId, 'R', 'u1', 'Alice');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    expect(mgr.toggleHold(gameId, 'R', 'u1').held).toBe(true);

    // The engine wants the rook four squares up the file; hold refuses it.
    const botDest = fullIdx({ x: 5, y: 9 });
    const rook1 = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook1], 1, botDest);
    expect(cs.botRecommendation).toBe(botDest);
    expect(cs.staged).toMatchObject({ turn: 1, move: fullIdx({ x: 5, y: 5 }), source: 'manual' });
  });

  test('hold survives the turn boundary: the stay is re-staged on every new board', () => {
    const gameId = 'hold-turns';
    const bishop = makeUnit('B', { x: 3, y: 7 }, { unitType: 'bishop' });
    processPieceTurn(gameId, 'B', [bishop], 0);
    enrolAndSelect(gameId, 'B', 'u1', 'Alice');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('B')!;
    mgr.toggleHold(gameId, 'B', 'u1');

    const stay = fullIdx({ x: 3, y: 7 });
    for (const turn of [1, 2, 3]) {
      processPieceTurn(gameId, 'B', [makeUnit('B', { x: 3, y: 7 }, { unitType: 'bishop' })], turn);
      expect(cs.intent.kind).toBe('hold');
      expect(cs.staged).toMatchObject({ turn, move: stay, source: 'manual' });
    }
    // One published stay per turn, all of them the piece's own square.
    expect(publishedFor(gameId, 'B').map(p => p.turn)).toEqual([0, 1, 2, 3]);
    expect(new Set(publishedFor(gameId, 'B').map(p => p.move))).toEqual(new Set([stay]));
  });

  test('a goto command replaces the hold, and a manual destination replaces it too', () => {
    const gameId = 'hold-replaced';
    processPieceTurn(gameId, 'R', [makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' })], 0);
    enrolAndSelect(gameId, 'R', 'u1', 'Alice');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;

    mgr.toggleHold(gameId, 'R', 'u1');
    expect(mgr.setWaypoint(gameId, 'R', { type: 'green', x: 5, y: 9 }, 'u1')).toBe(true);
    expect(cs.intent.kind).toBe('goto');
    expect(cs.staged!.move).toBe(fullIdx({ x: 5, y: 9 }));

    // And back the other way: hold replaces the goto queue.
    expect(mgr.toggleHold(gameId, 'R', 'u1').held).toBe(true);
    expect(cs.intent.kind).toBe('hold');
    expect(cs.staged!.move).toBe(fullIdx({ x: 5, y: 5 }));

    mgr.setUserSelection(gameId, 'R', fullIdx({ x: 8, y: 5 }));
    expect(cs.intent.kind).toBe('manual');
    expect(cs.staged!.move).toBe(fullIdx({ x: 8, y: 5 }));
  });

  test('clearing human input (Del) clears a hold like any other command', () => {
    const gameId = 'hold-cleared';
    processPieceTurn(gameId, 'Q', [makeUnit('Q', { x: 6, y: 6 }, { unitType: 'queen' })], 0);
    enrolAndSelect(gameId, 'Q', 'u1', 'Alice');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('Q')!;

    mgr.toggleHold(gameId, 'Q', 'u1');
    expect(mgr.clearHumanInput(gameId, 'Q', 'u1')).toBe(true);
    expect(cs.intent.kind).toBe('heuristic');
    expect(eventsOfType('input-clear')[0].payload).toEqual({ cleared: 'hold' });
  });

  test('a snake is refused: there is no stay on the wire for it', () => {
    const gameId = 'hold-snake';
    const snake = makeUnit('S', { x: 5, y: 5 });
    const gs = makeGameState(gameId, 0, [snake], 'S');
    mgr.registerGame(gs, 'S');
    mgr.updateBoard(gameId, gs);
    enrolAndSelect(gameId, 'S', 'u1', 'Alice');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('S')!;

    expect(mgr.toggleHold(gameId, 'S', 'u1')).toEqual({ ok: false, reason: 'cannot-hold' });
    expect(cs.intent.kind).toBe('heuristic');
    expect(eventsOfType('hold')).toHaveLength(0);
  });

  test('only the operator who has the unit selected may hold it', () => {
    const gameId = 'hold-unselected';
    processPieceTurn(gameId, 'R', [makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' })], 0);
    enrolAndSelect(gameId, 'R', 'u1', 'Alice');
    expect(mgr.toggleHold(gameId, 'R', 'u2')).toEqual({ ok: false, reason: 'not-selected' });
    expect(mgr.toggleHold(gameId, 'nobody', 'u1')).toEqual({ ok: false, reason: 'unknown-unit' });
  });

  test('a dead unit is refused, and death lifts a hold already in force', () => {
    const gameId = 'hold-death';
    processPieceTurn(gameId, 'R', [makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' })], 0);
    enrolAndSelect(gameId, 'R', 'u1', 'Alice');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    expect(mgr.toggleHold(gameId, 'R', 'u1').held).toBe(true);

    // The rook is gone from the next canonical board — captured.
    const survivor = makeUnit('S', { x: 1, y: 1 });
    mgr.updateBoard(gameId, makeGameState(gameId, 1, [survivor], 'S'));
    expect(cs.intent.kind).toBe('heuristic');
    expect(eventsOfType('command-cleared-on-death')[0].payload).toEqual({ cleared: 'hold' });

    // And it cannot be re-held while it is off the board.
    expect(mgr.toggleHold(gameId, 'R', 'u1')).toEqual({ ok: false, reason: 'dead' });
  });

  test('hold and unhold are logged with operator attribution and what they displaced', () => {
    const gameId = 'hold-log';
    processPieceTurn(gameId, 'R', [makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' })], 0);
    const color = enrolAndSelect(gameId, 'R', 'u1', 'Alice');

    mgr.setWaypoint(gameId, 'R', { type: 'green', x: 5, y: 9 }, 'u1');
    mgr.toggleHold(gameId, 'R', 'u1');
    mgr.toggleHold(gameId, 'R', 'u1');

    const holds = eventsOfType('hold');
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({
      gameId,
      snakeId: 'R',
      turn: 0,
      operator: { userId: 'u1', name: 'Alice', color },
      payload: { unitType: 'rook', previous: 'goto' },
    });
    const unholds = eventsOfType('unhold');
    expect(unholds).toHaveLength(1);
    expect(unholds[0]).toMatchObject({
      operator: { userId: 'u1', name: 'Alice', color },
      payload: { unitType: 'rook', previous: 'hold' },
    });
  });

  test('the per-turn command snapshot carries the held set (activeIntentModes)', () => {
    const gameId = 'hold-snapshot';
    processPieceTurn(gameId, 'R', [makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' })], 0);
    processPieceTurn(gameId, 'B', [
      makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' }),
      makeUnit('B', { x: 2, y: 2 }, { unitType: 'bishop' }),
    ], 0);
    enrolAndSelect(gameId, 'R', 'u1', 'Alice');
    mgr.toggleHold(gameId, 'R', 'u1');

    const state = mgr.getCommandStateForGame(gameId) as CommandTurnState;
    expect(state.activeIntentModes['R']).toBe('hold');
    expect(state.activeIntentModes['B']).toBe('heuristic');
    // The replay draws the shield from this map, so the held unit's staged
    // stay must ride along with it in the same snapshot.
    expect(state.stagedMoves['R'].requestedMove).toBe(fullIdx({ x: 5, y: 5 }));
    expect(state.operators['R']).toMatchObject({ userId: 'u1', name: 'Alice' });
  });
});
