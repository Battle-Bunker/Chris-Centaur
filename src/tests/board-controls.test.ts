/**
 * The board's display switch and the "no human input" reset.
 *
 * Covers:
 *  - the Voronoi overlay switch actually SKIPPING the overlay's work in the
 *    renderer (no owner map, no boundary walk, no gradients) rather than
 *    painting it invisibly — including a candidate's projected grid, which
 *    rides on the selected move rather than on the board;
 *  - Delete's one clear-human-input path dropping every command kind through
 *    the same call, and leaving the unit on whatever no-input resolves to for
 *    its kind without that outcome being named at the clear site.
 */

import { ActiveGameManager, TurnData } from '../server/active-game-manager';
import { GameState, Snake, Coord } from '../types/battlesnake';

const BoardRenderer = require('../web/board-renderer.js');

jest.mock('../logic/command-logger', () => {
  const logEvent = jest.fn();
  const logTurnState = jest.fn();
  return { CommandLogger: { getInstance: () => ({ logEvent, logTurnState }) } };
});

// ── A canvas 2D context that records which drawing ops were asked for ───────
// Everything the renderer touches is answered generically; only the calls are
// interesting. `createLinearGradient` is the territory glow's own op — nothing
// else in renderBoard makes one — so its count is a direct read of whether the
// overlay ran at all.
function recordingContext(calls: string[]): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
    measureText: (t: string) => ({ width: String(t).length * 6 }),
    createLinearGradient: () => {
      calls.push('createLinearGradient');
      return gradient;
    },
  };
  return new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push(prop);
        return args.length === 0 ? undefined : undefined;
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

// Head glyphs build Path2D objects; the stub only has to exist for them.
(globalThis as unknown as { Path2D: unknown }).Path2D = class {
  constructor(public d?: string) {}
};

function fakeCanvas(calls: string[]) {
  const ctx = recordingContext(calls);
  return { width: 550, height: 550, clientWidth: 550, clientHeight: 550, getContext: () => ctx };
}

function makeUnit(id: string, head: Coord, unitType = 'snake'): Snake {
  const isPiece = unitType !== 'snake';
  const body: Coord[] = isPiece
    ? [head]
    : [head, { x: head.x, y: head.y - 1 }, { x: head.x, y: head.y - 2 }];
  const snake: Snake = {
    id,
    name: `${id} unit`,
    latency: '0',
    health: 100,
    body,
    head,
    length: body.length,
    shout: '',
    squad: '',
    orientation: { dx: 0, dy: -1 },
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
  };
  if (isPiece) snake.unitType = unitType;
  return snake;
}

function makeGameState(gameId: string, turn: number, snakes: Snake[], youId: string): GameState {
  return {
    game: { id: gameId, ruleset: { name: 'teamsnek', version: 'v1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
    turn,
    board: { width: 11, height: 11, food: [], hazards: [], snakes },
    you: snakes.find((s) => s.id === youId)!,
  };
}

// ── The Voronoi overlay switch ─────────────────────────────────────────────
describe('territory overlay switch', () => {
  const snake = makeUnit('S', { x: 3, y: 3 });
  const other = makeUnit('T', { x: 7, y: 7 });
  const gs = makeGameState('g-overlay', 5, [snake, other], 'S');
  const territoryCells = {
    S: [{ x: 3, y: 3 }, { x: 3, y: 4 }, { x: 4, y: 3 }],
    T: [{ x: 7, y: 7 }, { x: 7, y: 6 }],
  };

  function render(moveState: unknown, showTerritory?: boolean): string[] {
    const calls: string[] = [];
    BoardRenderer.renderBoard(fakeCanvas(calls), gs, moveState, {
      snakeId: 'S',
      showChosenArrow: false,
      ...(showTerritory === undefined ? {} : { showTerritory }),
    });
    return calls;
  }

  test('drawn by default, and by an explicit showTerritory:true', () => {
    const moveState = { selectedMove: null, moves: {}, territoryCells, selectedSnake: 'S' };
    expect(render(moveState).filter((c) => c === 'createLinearGradient').length).toBeGreaterThan(0);
    expect(render(moveState, true).filter((c) => c === 'createLinearGradient').length)
      .toBeGreaterThan(0);
  });

  test('showTerritory:false skips the overlay work entirely', () => {
    const moveState = { selectedMove: null, moves: {}, territoryCells, selectedSnake: 'S' };
    const off = render(moveState, false);
    expect(off.filter((c) => c === 'createLinearGradient')).toHaveLength(0);
    // The rest of the board is unaffected — this is a switch on one overlay,
    // not on rendering.
    expect(off).toContain('fillRect');
  });

  test('the switch also covers a candidate\'s PROJECTED grid', () => {
    // A selected candidate replaces the board's partition with its own
    // hypothetical one, which arrives on the move rather than on the board —
    // the exact grid a page-level gate alone would miss.
    const moveState = {
      selectedMove: 'up',
      moves: {
        up: {
          key: 'up',
          direction: 'up',
          position: { x: 3, y: 4 },
          isSafe: true,
          projectedTerritoryCells: territoryCells,
        },
      },
      territoryCells: {},
      selectedSnake: 'S',
    };
    expect(render(moveState, true).filter((c) => c === 'createLinearGradient').length)
      .toBeGreaterThan(0);
    expect(render(moveState, false).filter((c) => c === 'createLinearGradient'))
      .toHaveLength(0);
  });

  test('an empty grid costs nothing either way', () => {
    const moveState = { selectedMove: null, moves: {}, territoryCells: {}, selectedSnake: 'S' };
    expect(render(moveState, true).filter((c) => c === 'createLinearGradient')).toHaveLength(0);
  });
});

// ── Delete: one path back to null human input ──────────────────────────────
describe('clearHumanInput', () => {
  let mgr: ActiveGameManager;

  beforeEach(() => {
    jest.useFakeTimers();
    mgr = ActiveGameManager.getInstance();
    mgr.setMoveSubmitter(async () => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    mgr.setMoveCommitter(null);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function turnData(gs: GameState): TurnData {
    return {
      gameState: gs,
      moveEvaluations: [],
      territoryCells: {},
      safeMoves: ['up', 'left', 'right'],
      botRecommendation: 'left',
      timestamp: Date.now(),
    };
  }

  function setUpSnake(gameId: string) {
    const snake = makeUnit('S', { x: 3, y: 3 });
    const gs = makeGameState(gameId, 1, [snake], 'S');
    mgr.registerGame(gs, 'S');
    mgr.updateBoard(gameId, gs);
    mgr.addConnectedUser(gameId, 'u1', 'Player One');
    mgr.selectSnake(gameId, 'S', 'u1');
    mgr.setBotRecommendation(gameId, 'S', 'left', turnData(gs));
    return gs;
  }

  const modeOf = (gameId: string) => mgr.getActiveIntentModesForGame(gameId)['S'];

  test.each([
    ['a staged manual move', (gameId: string) => mgr.setUserSelection(gameId, 'S', 'up')],
    ['a goto queue', (gameId: string) => {
      mgr.setWaypoint(gameId, 'S', { type: 'green', x: 8, y: 8 }, 'u1');
      mgr.setWaypoint(gameId, 'S', { type: 'green', x: 9, y: 9 }, 'u1', true);
    }],
    ['a near target', (gameId: string) => mgr.setWaypoint(gameId, 'S', { type: 'blue', x: 8, y: 2 }, 'u1')],
  ])('one call cancels %s', (label, command) => {
    const gameId = `g-clear-${label.replace(/\s+/g, '-')}`;
    setUpSnake(gameId);
    command(gameId);
    expect(modeOf(gameId)).not.toBe('heuristic');

    expect(mgr.clearHumanInput(gameId, 'S', 'u1')).toBe(true);
    expect(modeOf(gameId)).toBe('heuristic');
    // No waypoint survives the clear either — the queue and the near target
    // ARE the intent, so replacing it drops them with everything else.
    expect(mgr.getWaypointsForGame(gameId)['S']).toBeUndefined();
    expect(mgr.getActiveWaypointTarget(gameId, 'S')).toBeNull();
  });

  test('the unit falls back to what no input means for it, unnamed at the clear site', () => {
    const gameId = 'g-clear-fallback';
    setUpSnake(gameId);
    mgr.setUserSelection(gameId, 'S', 'up');
    expect(mgr.computeIntendedMove(gameId, 'S').source).toBe('manual');

    mgr.clearHumanInput(gameId, 'S', 'u1');
    // For a snake that is the bot's own recommendation, resolved by the
    // ordinary staging path rather than written by the clear.
    const intended = mgr.computeIntendedMove(gameId, 'S');
    expect(intended.source).toBe('bot');
    expect(intended.direction).toBe('left');
  });

  test('only the user currently selecting the unit may clear it', () => {
    const gameId = 'g-clear-owner';
    setUpSnake(gameId);
    mgr.setUserSelection(gameId, 'S', 'up');

    expect(mgr.clearHumanInput(gameId, 'S', 'someone-else')).toBe(false);
    expect(modeOf(gameId)).toBe('manual');
    expect(mgr.clearHumanInput(gameId, 'no-such-unit', 'u1')).toBe(false);
    expect(mgr.clearHumanInput('no-such-game', 'S', 'u1')).toBe(false);
  });

  test('clearing an already-clear unit is a no-op that still succeeds', () => {
    const gameId = 'g-clear-idempotent';
    setUpSnake(gameId);
    expect(modeOf(gameId)).toBe('heuristic');
    expect(mgr.clearHumanInput(gameId, 'S', 'u1')).toBe(true);
    expect(modeOf(gameId)).toBe('heuristic');
  });
});
