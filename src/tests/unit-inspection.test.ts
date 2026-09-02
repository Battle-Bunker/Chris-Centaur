/**
 * The selection/inspection seam: the behaviours a user drives by picking a
 * unit must be the same for a snake and for a chess piece, and the same live
 * and while scrubbing history.
 *
 * Covers:
 *  - the board-wide Voronoi partition living on the GAME (not on whichever
 *    unit's decision happened to compute it), so a piece's selection shows the
 *    territory overlay exactly as a snake's does;
 *  - the orientation eye being a PIECE affordance (a snake's facing is already
 *    in its head/neck geometry);
 *  - letter-rank unit ordering, shared by the units table and Tab cycling;
 *  - units-table row selection surviving a re-render mid-press (one delegated
 *    handler on the container, not one click listener per row);
 *  - inspectability being a read of the board on screen, independent of live
 *    control and of whether the unit ever logged a decision.
 */

import { ActiveGameManager, TurnData } from '../server/active-game-manager';
import { GameState, Snake, Coord } from '../types/battlesnake';
import { CellOwnership } from '../logic/territory-view';

const BoardRenderer = require('../web/board-renderer.js');

jest.mock('../logic/command-logger', () => {
  const logEvent = jest.fn();
  const logTurnState = jest.fn();
  return { CommandLogger: { getInstance: () => ({ logEvent, logTurnState }) } };
});

function makeUnit(id: string, head: Coord, unitType = 'snake', letter = ''): Snake {
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
  if (unitType !== 'snake') snake.unitType = unitType;
  if (letter) snake.letter = letter;
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

function makeOwnership(sources: string[]): CellOwnership {
  return {
    width: 2, height: 1, sources,
    owner: [0, sources.length > 1 ? 1 : 0],
    distance: [1, 1],
    vacatesAt: [0, 0],
  };
}

// ── The board-wide Voronoi partition is a property of the GAME ─────────────
describe('board territory is per game, not per selected unit', () => {
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

  function turnData(gs: GameState, cells: Record<string, Coord[]>, ownership: CellOwnership | null): TurnData {
    return {
      gameState: gs,
      moveEvaluations: [],
      territoryCells: cells,
      safeMoves: [],
      botRecommendation: 'up',
      timestamp: Date.now(),
      ...(ownership ? { cellOwnership: ownership } : {}),
    };
  }

  test("a snake's decision lifts the shared grid onto the game, where a piece's view reads it", () => {
    const gameId = 'g-territory';
    const snake = makeUnit('S', { x: 3, y: 3 });
    const rook = makeUnit('R', { x: 7, y: 7 }, 'rook');
    const gs = makeGameState(gameId, 4, [snake, rook], 'S');

    mgr.registerGame(gs, 'S');
    mgr.registerGame(makeGameState(gameId, 4, [snake, rook], 'R'), 'R');
    mgr.updateBoard(gameId, gs);

    // No decision has run yet: nothing to show, for either unit.
    expect(mgr.getBoardTerritory(gameId)).toBeNull();

    const cells = { S: [{ x: 3, y: 3 }], R: [{ x: 7, y: 7 }] };
    mgr.setBotRecommendation(gameId, 'S', 'up', turnData(gs, cells, makeOwnership(['S', 'R'])));

    const shared = mgr.getBoardTerritory(gameId)!;
    expect(shared.turn).toBe(4);
    // The grid covers EVERY unit on the board, the chess piece included — the
    // point of holding it per game rather than per unit.
    expect(Object.keys(shared.territoryCells).sort()).toEqual(['R', 'S']);
    expect(shared.cellOwnership!.sources).toEqual(['S', 'R']);

    // The piece's own turn intake carries no grids of its own (it gets no
    // engine pass), and must not blank the board's.
    mgr.updatePieceTurn(gameId, 'R', makeGameState(gameId, 4, [snake, rook], 'R'));
    expect(mgr.getBoardTerritory(gameId)).toEqual(shared);

    // ...and it is handed to a subscribing client without naming a unit.
    expect(mgr.getGameState(gameId)!.boardTerritory).toEqual(shared);
  });

  test('an empty interim grid never blanks the partition for the same turn', () => {
    const gameId = 'g-territory-interim';
    const snake = makeUnit('S', { x: 3, y: 3 });
    const gs = makeGameState(gameId, 2, [snake], 'S');
    mgr.registerGame(gs, 'S');
    mgr.updateBoard(gameId, gs);

    const cells = { S: [{ x: 3, y: 3 }] };
    mgr.setBotRecommendation(gameId, 'S', 'up', turnData(gs, cells, makeOwnership(['S'])));
    // The quick staging pass and interim recommendations carry {} — they are
    // not a partition, so they leave the real one alone.
    mgr.setBotRecommendation(gameId, 'S', 'down', turnData(gs, {}, null));
    expect(mgr.getBoardTerritory(gameId)!.territoryCells).toEqual(cells);
  });
});

// ── The orientation eye is a piece affordance ──────────────────────────────
describe('orientation eye', () => {
  const facing = { dx: 0, dy: -1 };

  test('pieces carry it; snakes do not (their head/neck already says which way)', () => {
    expect(BoardRenderer.unitDrawsOrientationEye({ unitType: 'rook', orientation: facing })).toBe(true);
    expect(BoardRenderer.unitDrawsOrientationEye({ unitType: 'pawn', orientation: facing })).toBe(true);
    expect(BoardRenderer.unitDrawsOrientationEye({ unitType: 'snake', orientation: facing })).toBe(false);
    // Historic rows predating unitType are snakes too.
    expect(BoardRenderer.unitDrawsOrientationEye({ orientation: facing })).toBe(false);
  });

  test('an orientation-less unit (ghost, corpse) draws none either way', () => {
    expect(BoardRenderer.unitDrawsOrientationEye({ unitType: 'rook' })).toBe(false);
    expect(BoardRenderer.unitDrawsOrientationEye({ unitType: 'rook', orientation: { dx: 0, dy: 0 } })).toBe(false);
  });

  test('the piece/snake split has ONE definition', () => {
    expect(BoardRenderer.isPieceUnit({ unitType: 'queen' })).toBe(true);
    expect(BoardRenderer.isPieceUnit({ unitType: 'snake' })).toBe(false);
    expect(BoardRenderer.isPieceUnit({})).toBe(false);
    expect(BoardRenderer.isPieceUnit(null)).toBe(false);
  });

  // ONE rotation indicator: the pawn's staged-rotation badge and every planned
  // rotation drawn along a goto route read the same glyph from this function,
  // so the two can never drift into different visual languages.
  test('the rotation indicator has ONE definition, in the wire convention', () => {
    const up = { dx: 0, dy: -1 };   // wire dy grows downward = api +y
    // Cross product > 0 is a clockwise quarter turn on screen.
    expect(BoardRenderer.rotationGlyph(up, { dx: 1, dy: 0 })).toBe('↻');
    expect(BoardRenderer.rotationGlyph(up, { dx: -1, dy: 0 })).toBe('↺');
    expect(BoardRenderer.rotationGlyph({ dx: 1, dy: 0 }, { dx: 0, dy: 1 })).toBe('↻');
    // No usable "from" still marks the cell rather than drawing nothing.
    expect(BoardRenderer.rotationGlyph(null, { dx: 1, dy: 0 })).toBe('↻');
    expect(BoardRenderer.rotationGlyph({ dx: 0, dy: 0 }, { dx: 1, dy: 0 })).toBe('↻');
  });
});

// ── Letter-rank ordering ───────────────────────────────────────────────────
describe('unit ordering', () => {
  test('units sort by letter rank, letterless ones last', () => {
    const units = [
      { id: '3', letter: 'C', name: 'c' },
      { id: '1', letter: 'A', name: 'a' },
      { id: '4', name: 'zz' },
      { id: '2', letter: 'B', name: 'b' },
    ];
    expect(units.slice().sort(BoardRenderer.compareUnitsByLetter).map((u) => u.id))
      .toEqual(['1', '2', '3', '4']);
  });

  test('the order is total and stable for units sharing a letter', () => {
    const a = { id: 'x', letter: 'A', name: 'aa' };
    const b = { id: 'y', letter: 'A', name: 'aa' };
    expect(BoardRenderer.compareUnitsByLetter(a, b)).toBeLessThan(0);
    expect(BoardRenderer.compareUnitsByLetter(b, a)).toBeGreaterThan(0);
    expect(BoardRenderer.compareUnitsByLetter(a, a)).toBe(0);
  });
});

// ── Inspectability follows the board on screen ─────────────────────────────
describe('inspectable units', () => {
  const board = {
    snakes: [
      makeUnit('S', { x: 1, y: 1 }, 'snake', 'A'),
      makeUnit('P', { x: 5, y: 5 }, 'rook', 'B'),
      makeUnit('E', { x: 9, y: 9 }, 'snake', 'A'),
    ],
  };

  test('every unit on the board is inspectable, with no live state involved', () => {
    const ids = BoardRenderer.inspectableUnitIds(board, []);
    // The chess piece is in, though it never logs a decision; so is the enemy.
    expect([...ids].sort()).toEqual(['E', 'P', 'S']);
  });

  test('extra ids (units already dead, logged perspectives) fold in on top', () => {
    const ids = BoardRenderer.inspectableUnitIds(board, ['GONE', 'S']);
    expect([...ids].sort()).toEqual(['E', 'GONE', 'P', 'S']);
  });

  test('no board at all degrades to the extras, never to a crash', () => {
    expect([...BoardRenderer.inspectableUnitIds(null, ['A'])]).toEqual(['A']);
    expect([...BoardRenderer.inspectableUnitIds(undefined, undefined)]).toEqual([]);
  });
});

// ── The units table ────────────────────────────────────────────────────────
// A minimal stand-in for the container element: enough DOM surface for the
// table to render into and for its delegated handler to be exercised.
function makeContainer() {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  return {
    innerHTML: '',
    addEventListener(type: string, fn: (e: any) => void) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    listenerCount(type: string) { return (listeners[type] || []).length; },
    fire(type: string, event: any) { (listeners[type] || []).forEach((fn) => fn(event)); },
    querySelector: () => ({ title: '' }),
  };
}

// An event whose target resolves `closest` against a fixed attribute map —
// the shape the delegated handler reads.
function pointerOnRow(unitId: string | null) {
  return {
    target: {
      closest: (sel: string) =>
        sel === '[data-select-snake]' && unitId
          ? { getAttribute: () => unitId }
          : null,
    },
  };
}

// A press on a row's copy control. The control sits INSIDE a selectable row,
// so `closest` answers for both selectors — which is exactly the ambiguity the
// delegated handler has to resolve in the copy control's favour.
function makeCopyControl(unitId: string) {
  return {
    getAttribute: (attr: string) => (attr === 'data-copy-id' ? unitId : null),
    textContent: 'ID',
    classList: { add: jest.fn(), remove: jest.fn() },
  };
}

function pointerOnCopyControl(control: ReturnType<typeof makeCopyControl>, unitId: string) {
  return {
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    target: {
      closest: (sel: string) => {
        if (sel === '[data-copy-id]') return control;
        if (sel === '[data-select-snake]') return { getAttribute: () => unitId };
        return null;
      },
    },
  };
}

// Install a clipboard for the duration of one test. `navigator` is a real
// global in modern Node, so it is defined over rather than assigned to.
function withClipboard(writeText: unknown) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText } }, configurable: true, writable: true,
  });
  return () => {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete (globalThis as Record<string, unknown>).navigator;
  };
}

describe('units table selection', () => {
  const ourSnake = makeUnit('S', { x: 1, y: 1 }, 'snake', 'B');
  const ourPiece = makeUnit('P', { x: 2, y: 2 }, 'rook', 'A');
  ourSnake.squad = 'blue';
  ourPiece.squad = 'blue';
  const enemy = makeUnit('E', { x: 9, y: 9 }, 'snake', 'A');
  enemy.squad = 'red';
  const gameState = { turn: 3, board: { snakes: [ourSnake, ourPiece, enemy] } };

  test('rows within a team are listed in letter rank order', () => {
    const c = makeContainer();
    BoardRenderer.renderSnakeInfo(c, gameState, 'S', { groupByTeam: true });
    // P is letter A, S is letter B: the piece comes first despite the board
    // order, and Tab cycles the same way. Grouped rows are labelled by LETTER
    // (the team's name is already the group's heading), so the row's identity
    // is read off its own id control.
    expect(c.innerHTML.indexOf('data-copy-id="P"'))
      .toBeLessThan(c.innerHTML.indexOf('data-copy-id="S"'));
  });

  test('an explicit selectable set is honoured verbatim — pieces and enemies included', () => {
    const c = makeContainer();
    BoardRenderer.renderSnakeInfo(c, gameState, 'S', {
      groupByTeam: true,
      onSelectSnake: () => {},
      selectableSnakeIds: new Set(['S', 'P', 'E']),
    });
    expect(c.innerHTML).toContain('data-select-snake="P"');
    expect(c.innerHTML).toContain('data-select-snake="E"');
  });

  test('one delegated handler serves every row, however many rows there are', () => {
    const c = makeContainer();
    const opts = { groupByTeam: true, onSelectSnake: jest.fn(), selectableSnakeIds: new Set(['S', 'P', 'E']) };
    BoardRenderer.renderSnakeInfo(c, gameState, 'S', opts);
    BoardRenderer.renderSnakeInfo(c, { turn: 4, board: { snakes: [ourSnake, ourPiece, enemy] } }, 'P', opts);
    expect(c.listenerCount('pointerdown')).toBe(1);
  });

  test('a row replaced between press and release still selects', () => {
    const c = makeContainer();
    const onSelectSnake = jest.fn();
    const opts = { groupByTeam: true, onSelectSnake, selectableSnakeIds: new Set(['S', 'P']) };
    BoardRenderer.renderSnakeInfo(c, gameState, 'S', opts);

    // The board advances (a fresh turn rebuilds every row) and only THEN does
    // the press land. Selection is resolved on pointerdown from the container,
    // which outlives the rows, so the rebuild cannot swallow it — the reason a
    // per-row `click` listener made row selection feel arbitrarily slow.
    BoardRenderer.renderSnakeInfo(c, { turn: 9, board: { snakes: [ourSnake, ourPiece, enemy] } }, 'S', opts);
    c.fire('pointerdown', pointerOnRow('P'));
    expect(onSelectSnake).toHaveBeenCalledWith('P');
  });

  test('a press that misses every row selects nothing', () => {
    const c = makeContainer();
    const onSelectSnake = jest.fn();
    BoardRenderer.renderSnakeInfo(c, gameState, 'S', {
      groupByTeam: true, onSelectSnake, selectableSnakeIds: new Set(['S']),
    });
    c.fire('pointerdown', pointerOnRow(null));
    expect(onSelectSnake).not.toHaveBeenCalled();
  });

  test('the latest callback wins after a re-render, with no listener piling up', () => {
    const c = makeContainer();
    const first = jest.fn();
    const second = jest.fn();
    const ids = new Set(['S']);
    BoardRenderer.renderSnakeInfo(c, gameState, 'S', { groupByTeam: true, onSelectSnake: first, selectableSnakeIds: ids });
    BoardRenderer.renderSnakeInfo(c, gameState, 'S', { groupByTeam: true, onSelectSnake: second, selectableSnakeIds: ids });
    c.fire('pointerdown', pointerOnRow('S'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('S');
  });

  test("the copy control copies its OWN row's id, and does not select the row", () => {
    const c = makeContainer();
    const onSelectSnake = jest.fn();
    const writeText = jest.fn(() => new Promise(() => { /* never settles */ }));
    const restore = withClipboard(writeText);
    try {
      BoardRenderer.renderSnakeInfo(c, gameState, 'S', {
        groupByTeam: true, onSelectSnake, selectableSnakeIds: new Set(['S', 'P']),
      });
      const control = makeCopyControl('P');
      const event = pointerOnCopyControl(control, 'P');
      c.fire('pointerdown', event);
      expect(writeText).toHaveBeenCalledWith('P');
      // The whole point: a press on the control is not a press on the row.
      expect(onSelectSnake).not.toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test('a copy says so in place, then goes back to being a control', async () => {
    jest.useFakeTimers();
    const c = makeContainer();
    const restore = withClipboard(jest.fn(() => Promise.resolve()));
    try {
      BoardRenderer.renderSnakeInfo(c, gameState, 'S', {
        groupByTeam: true, onSelectSnake: jest.fn(), selectableSnakeIds: new Set(['S']),
      });
      const control = makeCopyControl('S');
      c.fire('pointerdown', pointerOnCopyControl(control, 'S'));
      await Promise.resolve();
      expect(control.textContent).toBe('\u2713');
      jest.runAllTimers();
      expect(control.textContent).toBe('ID');
    } finally {
      restore();
      jest.useRealTimers();
    }
  });

  test('without the async clipboard the id still copies, through the legacy path', () => {
    // The confirmation flash schedules a revert; fake timers keep it off the
    // real clock once the assertions are done.
    jest.useFakeTimers();
    const c = makeContainer();
    const restore = withClipboard(undefined);
    const realDocument = (global as unknown as { document?: unknown }).document;
    const field: Record<string, unknown> = { style: {} };
    const commands: string[] = [];
    (global as unknown as { document: unknown }).document = {
      body: { appendChild: () => {} },
      createElement: () => Object.assign(field, {
        setAttribute: () => {}, select: () => {}, remove: () => {},
      }),
      execCommand: (cmd: string) => { commands.push(cmd); return true; },
    };
    try {
      BoardRenderer.renderSnakeInfo(c, gameState, 'S', {
        groupByTeam: true, onSelectSnake: jest.fn(), selectableSnakeIds: new Set(['S']),
      });
      c.fire('pointerdown', pointerOnCopyControl(makeCopyControl('S'), 'S'));
      expect(field.value).toBe('S');
      expect(commands).toEqual(['copy']);
    } finally {
      (global as unknown as { document?: unknown }).document = realDocument;
      restore();
      jest.runAllTimers();
      jest.useRealTimers();
    }
  });

  test('an unchanged table is not rewritten, so nothing under the pointer is torn out', () => {
    const c = makeContainer();
    const opts = { groupByTeam: true, onSelectSnake: () => {}, selectableSnakeIds: new Set(['S']) };
    BoardRenderer.renderSnakeInfo(c, gameState, 'S', opts);
    const rendered = c.innerHTML;
    c.innerHTML = 'SENTINEL';
    // Same inputs → same markup → the renderer leaves the DOM untouched.
    BoardRenderer.renderSnakeInfo(c, gameState, 'S', opts);
    expect(c.innerHTML).toBe('SENTINEL');
    // A real change is still written through.
    BoardRenderer.renderSnakeInfo(c, { turn: 3, board: { snakes: [ourSnake, enemy] } }, 'S', opts);
    expect(c.innerHTML).not.toBe('SENTINEL');
    expect(c.innerHTML).not.toBe(rendered);
  });
});
