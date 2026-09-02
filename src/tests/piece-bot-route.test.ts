/**
 * The pieces bot route.
 *
 * Until this existed `updatePieceTurn` hard-coded `botRecommendation: null`
 * and `computePieceStagedMove` returned null without an operator command, so
 * an uncommanded piece staged nothing at all and the server defaulted it to
 * stay. The route is a widening of that one value to a CentaurMove — a
 * Direction for a snake, a full-board destination index for a piece — plus the
 * third rung of the piece ladder that consumes it.
 *
 * The load-bearing tests here are the NEGATIVE ones: the recommendation is the
 * LOWEST rung, so manual and waypoint must still beat it every time, and the
 * fatal-move consent gate must be exactly as unmovable as it was.
 */

import { ActiveGameManager, TurnData } from '../server/active-game-manager';
import { CentaurMove, Coord, Direction, GameState, Snake } from '../types/battlesnake';
import { apiCoordToIndex } from '../firebase/translate';

jest.mock('../logic/command-logger', () => {
  const logEvent = jest.fn();
  const logTurnState = jest.fn();
  return { CommandLogger: { getInstance: () => ({ logEvent, logTurnState }) } };
});

const FULL_W = 13;
const FULL_H = 13;
const fullIdx = (api: Coord) => apiCoordToIndex(api, FULL_W, FULL_H);

function makeUnit(
  id: string,
  head: Coord,
  opts: { unitType?: string; orientation?: { dx: number; dy: number }; length?: number } = {}
): Snake {
  const isPiece = !!opts.unitType && opts.unitType !== 'snake';
  const cells = isPiece ? 1 : opts.length ?? 3;
  const body: Coord[] = [];
  for (let i = 0; i < cells; i++) body.push({ x: head.x, y: head.y - i });
  const snake: Snake = {
    orientation: opts.orientation ?? { dx: 0, dy: -1 },
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head,
    length: isPiece ? opts.length ?? 1 : cells,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
  };
  if (opts.unitType) snake.unitType = opts.unitType;
  return snake;
}

function makeGameState(gameId: string, turn: number, snakes: Snake[], youId: string): GameState {
  const you = snakes.find((s) => s.id === youId)!;
  return {
    game: { id: gameId, ruleset: { name: 'teamsnek', version: 'v1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
    turn,
    board: { width: 11, height: 11, food: [], hazards: [], snakes },
    you,
  };
}

function makeTurnData(gs: GameState, move: CentaurMove | null): TurnData {
  return {
    gameState: gs,
    moveEvaluations: [],
    territoryCells: {},
    safeMoves: [],
    botRecommendation: move,
    timestamp: Date.now(),
  };
}

interface Published {
  snakeId: string;
  turn: number;
  move: CentaurMove;
  source: string;
}

describe('the pieces bot route', () => {
  let mgr: ActiveGameManager;
  let published: Published[];
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mgr = ActiveGameManager.getInstance();
    published = [];
    mgr.setMoveSubmitter(async (_gameId, snakeId, turn, move, source) => {
      published.push({ snakeId, turn, move, source });
    });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    mgr.setMoveCommitter(null);
    jest.clearAllTimers();
    jest.useRealTimers();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  /** Transport intake for a piece, with an optional bot destination. */
  function processPieceTurn(
    gameId: string,
    unitId: string,
    snakes: Snake[],
    turn: number,
    botDest: number | null = null
  ) {
    const gs = makeGameState(gameId, turn, snakes, unitId);
    const existing = mgr.getGame(gameId);
    if (!existing || !existing.controlledSnakes.has(unitId)) mgr.registerGame(gs, unitId);
    mgr.updateBoard(gameId, gs);
    mgr.updatePieceTurn(gameId, unitId, gs, botDest);
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
  }

  describe('the legacy shape is exactly preserved', () => {
    test('omitting the recommendation leaves an uncommanded piece staging nothing', () => {
      const gameId = 'g-legacy-null';
      processPieceTurn(gameId, 'R', [makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' })], 0);
      const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
      expect(cs.botRecommendation).toBeNull();
      expect(cs.staged).toBeNull();
      expect(published).toHaveLength(0);
    });

    test('an explicit null recommendation is the same thing', () => {
      const gameId = 'g-legacy-explicit-null';
      processPieceTurn(gameId, 'R', [makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' })], 0, null);
      expect(mgr.getGame(gameId)!.controlledSnakes.get('R')!.staged).toBeNull();
      expect(published).toHaveLength(0);
    });
  });

  describe('a recommendation reaches the wire as a destination index', () => {
    test('a legal rook ray is staged, sourced as bot', () => {
      const gameId = 'g-bot-rook';
      const dest = fullIdx({ x: 5, y: 9 });
      processPieceTurn(gameId, 'R', [makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' })], 0, dest);
      const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
      expect(cs.botRecommendation).toBe(dest);
      expect(cs.staged).toMatchObject({ snakeId: 'R', turn: 0, move: dest, source: 'bot' });
      expect(published).toEqual([{ snakeId: 'R', turn: 0, move: dest, source: 'bot' }]);
    });

    test('a knight is staged by its own move vocabulary', () => {
      const gameId = 'g-bot-knight';
      const dest = fullIdx({ x: 6, y: 7 });
      processPieceTurn(gameId, 'N', [makeUnit('N', { x: 5, y: 5 }, { unitType: 'knight' })], 0, dest);
      expect(mgr.getGame(gameId)!.controlledSnakes.get('N')!.staged).toMatchObject({
        move: dest,
        source: 'bot',
      });
    });

    test('an ILLEGAL destination stages the piece’s own square, never a rejected write', () => {
      const gameId = 'g-bot-illegal';
      // (6,7) is not on a rook's rank or file.
      processPieceTurn(
        gameId,
        'R',
        [makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' })],
        0,
        fullIdx({ x: 6, y: 7 })
      );
      const stay = fullIdx({ x: 5, y: 5 });
      expect(mgr.getGame(gameId)!.controlledSnakes.get('R')!.staged).toMatchObject({
        move: stay,
        source: 'bot',
        action: { kind: 'stay' },
      });
      expect(published.slice(-1)[0].move).toBe(stay);
    });

    test('a recommendation does not survive into the next turn on its own', () => {
      const gameId = 'g-bot-single-turn';
      const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
      processPieceTurn(gameId, 'R', [rook], 0, fullIdx({ x: 5, y: 9 }));
      processPieceTurn(gameId, 'R', [makeUnit('R', { x: 5, y: 9 }, { unitType: 'rook' })], 1);
      const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
      expect(cs.botRecommendation).toBeNull();
      expect(cs.staged).toBeNull();
    });

    test('the recommendation rides the piece’s turn data for the UI', () => {
      const gameId = 'g-bot-turndata';
      const dest = fullIdx({ x: 5, y: 9 });
      processPieceTurn(gameId, 'R', [makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' })], 0, dest);
      const td = mgr.getGame(gameId)!.controlledSnakes.get('R')!.latestTurnData!;
      expect(td.botRecommendation).toBe(dest);
      // The candidate rows are still the piece's own scored candidates.
      expect(td.moveEvaluations.length).toBeGreaterThan(0);
    });
  });

  describe('the bot rung stays BELOW every human rung', () => {
    test('a manual destination beats the bot’s', () => {
      const gameId = 'g-prec-manual';
      const botDest = fullIdx({ x: 5, y: 9 });
      const humanDest = fullIdx({ x: 9, y: 5 });
      processPieceTurn(gameId, 'R', [makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' })], 0, botDest);
      const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
      cs.selectedBy = 'u1';
      mgr.setUserSelection(gameId, 'R', humanDest);
      expect(cs.staged).toMatchObject({ move: humanDest, source: 'manual' });
    });

    test('a waypoint beats the bot’s', () => {
      const gameId = 'g-prec-waypoint';
      const botDest = fullIdx({ x: 5, y: 9 });
      processPieceTurn(gameId, 'R', [makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' })], 0, botDest);
      const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
      cs.selectedBy = 'u1';
      expect(mgr.setWaypoint(gameId, 'R', { type: 'green', x: 9, y: 5 }, 'u1')).toBe(true);
      expect(cs.staged).toMatchObject({ move: fullIdx({ x: 9, y: 5 }), source: 'waypoint' });
    });

    test('a recommendation arriving DURING a manual command does not displace it', () => {
      const gameId = 'g-prec-race';
      const humanDest = fullIdx({ x: 9, y: 5 });
      const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
      processPieceTurn(gameId, 'R', [rook], 0);
      const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
      cs.selectedBy = 'u1';
      mgr.setUserSelection(gameId, 'R', humanDest);
      expect(cs.staged).toMatchObject({ move: humanDest, source: 'manual' });

      // The anytime pass reports a better destination mid-turn.
      const gs = makeGameState(gameId, 0, [rook], 'R');
      mgr.setBotRecommendation(gameId, 'R', fullIdx({ x: 5, y: 9 }), makeTurnData(gs, fullIdx({ x: 5, y: 9 })));
      expect(cs.staged).toMatchObject({ move: humanDest, source: 'manual' });
    });

    test('clearing the human command falls back to the bot, not to nothing', () => {
      const gameId = 'g-prec-revert';
      const botDest = fullIdx({ x: 5, y: 9 });
      const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
      processPieceTurn(gameId, 'R', [rook], 0, botDest);
      const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
      cs.selectedBy = 'u1';
      mgr.setUserSelection(gameId, 'R', fullIdx({ x: 9, y: 5 }));
      expect(cs.staged!.source).toBe('manual');

      expect(mgr.clearHumanInput(gameId, 'R', 'u1')).toBe(true);
      expect(cs.staged).toMatchObject({ move: botDest, source: 'bot' });
    });
  });

  describe('setBotRecommendation carries the piece destination', () => {
    test('a numeric move for a piece stages it', () => {
      const gameId = 'g-sbr-piece';
      const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
      processPieceTurn(gameId, 'R', [rook], 0);
      const gs = makeGameState(gameId, 0, [rook], 'R');
      const dest = fullIdx({ x: 5, y: 9 });
      mgr.setBotRecommendation(gameId, 'R', dest, makeTurnData(gs, dest));
      expect(mgr.getGame(gameId)!.controlledSnakes.get('R')!.staged).toMatchObject({
        move: dest,
        source: 'bot',
      });
    });

    test('a DIRECTION for a piece is refused — shapes must match the unit', () => {
      const gameId = 'g-sbr-shape-piece';
      const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
      processPieceTurn(gameId, 'R', [rook], 0);
      const gs = makeGameState(gameId, 0, [rook], 'R');
      mgr.setBotRecommendation(gameId, 'R', 'up' as Direction, makeTurnData(gs, 'up'));
      const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
      expect(cs.botRecommendation).toBeNull();
      expect(cs.staged).toBeNull();
    });

    test('a numeric move for a SNAKE is refused too', () => {
      const gameId = 'g-sbr-shape-snake';
      const snake = makeUnit('S', { x: 5, y: 5 });
      const gs = makeGameState(gameId, 0, [snake], 'S');
      mgr.registerGame(gs, 'S');
      mgr.updateBoard(gameId, gs);
      mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
      mgr.setBotRecommendation(gameId, 'S', 42, makeTurnData(gs, 42));
      const cs = mgr.getGame(gameId)!.controlledSnakes.get('S')!;
      expect(cs.botRecommendation).toBeNull();
      expect(cs.staged).toBeNull();
    });
  });

  describe('the snake path is untouched by the widening', () => {
    test('a snake still stages its Direction recommendation', () => {
      const gameId = 'g-snake-unchanged';
      const snake = makeUnit('S', { x: 5, y: 5 });
      const gs = makeGameState(gameId, 0, [snake], 'S');
      mgr.registerGame(gs, 'S');
      mgr.updateBoard(gameId, gs);
      mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
      mgr.setBotRecommendation(gameId, 'S', 'right', makeTurnData(gs, 'right'));
      expect(mgr.getGame(gameId)!.controlledSnakes.get('S')!.staged).toMatchObject({
        move: 'right',
        source: 'bot',
      });
      expect(published.slice(-1)[0]).toMatchObject({ move: 'right', source: 'bot' });
    });

    test('computeIntendedMove still reports the direction ladder', () => {
      const gameId = 'g-snake-ladder';
      const snake = makeUnit('S', { x: 5, y: 5 });
      const gs = makeGameState(gameId, 0, [snake], 'S');
      mgr.registerGame(gs, 'S');
      mgr.updateBoard(gameId, gs);
      mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
      mgr.setBotRecommendation(gameId, 'S', 'left', makeTurnData(gs, 'left'));
      expect(mgr.computeIntendedMove(gameId, 'S')).toMatchObject({
        direction: 'left',
        source: 'bot',
      });
    });

    test('the fatal-move consent gate still falls back to the bot’s DIRECTION', () => {
      const gameId = 'g-gate-unchanged';
      // A snake whose neck is directly below its head: 'down' is a certain
      // 180-degree self-collision, so an unconsented manual 'down' is gated.
      const snake = makeUnit('S', { x: 5, y: 5 }, { length: 4 });
      const gs = makeGameState(gameId, 0, [snake], 'S');
      mgr.registerGame(gs, 'S');
      mgr.updateBoard(gameId, gs);
      mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
      mgr.setBotRecommendation(gameId, 'S', 'right', makeTurnData(gs, 'right'));

      const cs = mgr.getGame(gameId)!.controlledSnakes.get('S')!;
      cs.selectedBy = 'u1';
      mgr.setUserSelection(gameId, 'S', 'down');
      expect(cs.staged).toMatchObject({ move: 'right', source: 'bot', fatalConsented: false });
    });
  });
});
