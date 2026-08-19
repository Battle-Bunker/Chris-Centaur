/**
 * The board's drawing surface: CSS pixels in, device pixels out.
 *
 * The renderer draws in CSS pixels and backs the bitmap at the display's own
 * resolution, so everything that reads a coordinate has to agree on WHICH
 * pixels it is talking about. Covers:
 *  - the backing store being sized cssBox x scale, with the context carrying a
 *    matching transform (so every draw call keeps its CSS-pixel units);
 *  - the scale being the device pixel ratio, floored at 1 and capped;
 *  - grid strokes landing on whole device pixels at any scale;
 *  - hit-testing (cells and unit tags) answering identically whatever the
 *    resolution is — the buffer got bigger, the coordinate system did not.
 */

import { GameState, Snake, Coord } from '../types/battlesnake';

const BoardRenderer = require('../web/board-renderer.js');

// Head glyphs build Path2D objects; the stub only has to exist for them.
(globalThis as unknown as { Path2D: unknown }).Path2D = class {
  constructor(public d?: string) {}
};

type Op = { op: string; args: unknown[] };

// A 2D context that records every call with its arguments, and every property
// written to it — the grid's stroke widths and positions are read back from
// this, since a stroke's crispness is entirely a question of where it landed.
function recordingContext(ops: Op[]) {
  const state: Record<string, unknown> = {
    measureText: (t: string) => ({ width: String(t).length * 6 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  };
  return new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        ops.push({ op: prop, args });
        return undefined;
      };
    },
    set(target, prop: string, value) {
      ops.push({ op: `set:${prop}`, args: [value] });
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const CSS_SIZE = 550;

function fakeCanvas(ops: Op[]) {
  const ctx = recordingContext(ops);
  return {
    width: CSS_SIZE,
    height: CSS_SIZE,
    // The page's CSS box: a 2px border, so the border box the pointer is
    // measured against is 4px wider than the surface that gets drawn on.
    clientWidth: CSS_SIZE,
    clientHeight: CSS_SIZE,
    clientLeft: 2,
    clientTop: 2,
    getContext: () => ctx,
    getBoundingClientRect: () => ({
      left: 20, top: 40, width: CSS_SIZE + 4, height: CSS_SIZE + 4,
    }),
  };
}

// Pretend the page is on a display of the given density.
function withDevicePixelRatio(dpr: number) {
  (globalThis as unknown as { window: unknown }).window = { devicePixelRatio: dpr };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

function makeUnit(id: string, head: Coord): Snake {
  const body: Coord[] = [head, { x: head.x, y: head.y - 1 }];
  return {
    id,
    name: `${id} unit`,
    latency: '0',
    health: 90,
    body,
    head,
    length: body.length,
    shout: '',
    squad: '',
    orientation: { dx: 0, dy: -1 },
    customizations: { color: '#4CAF50', head: 'default', tail: 'default' },
    letter: id,
    unitType: 'snake',
  } as unknown as Snake;
}

function makeState(snakes: Snake[]): GameState {
  return {
    game: { id: 'g', ruleset: { name: 'standard', version: '1' }, timeout: 500 },
    turn: 3,
    board: { width: 11, height: 11, food: [], hazards: [], snakes },
    you: snakes[0],
  } as unknown as GameState;
}

const emptyMoveState = {
  selectedMove: null, moves: {}, safeMoves: [], territoryCells: {}, selectedSnake: null,
};

describe('canvas resolution', () => {
  test('the bitmap is backed at the display scale while drawing stays in CSS pixels', () => {
    withDevicePixelRatio(2);
    const ops: Op[] = [];
    const canvas = fakeCanvas(ops);
    const cellSize = BoardRenderer.renderBoard(
      canvas, makeState([makeUnit('S', { x: 5, y: 5 })]), emptyMoveState, {});

    // Buffer: CSS box x scale.
    expect(canvas.width).toBe(CSS_SIZE * 2);
    expect(canvas.height).toBe(CSS_SIZE * 2);
    // Transform: exactly the scale, so every coordinate below is CSS pixels.
    expect(ops.filter((o) => o.op === 'setTransform')[0].args).toEqual([2, 0, 0, 2, 0, 0]);
    // Cell size is the CSS box divided by the board, NOT the buffer.
    expect(cellSize).toBe(CSS_SIZE / 11);
  });

  test('the scale is the device pixel ratio, floored at 1 and capped', () => {
    withDevicePixelRatio(1);
    expect(BoardRenderer.renderScale()).toBe(1);
    withDevicePixelRatio(2);
    expect(BoardRenderer.renderScale()).toBe(2);
    // A fractional ratio (browser zoom) is used as-is.
    withDevicePixelRatio(1.5);
    expect(BoardRenderer.renderScale()).toBe(1.5);
    // Beyond the cap the extra fill rate buys nothing an eye collects.
    withDevicePixelRatio(4);
    expect(BoardRenderer.renderScale()).toBe(3);
    // A nonsense ratio never shrinks the board below its CSS size.
    withDevicePixelRatio(0);
    expect(BoardRenderer.renderScale()).toBe(1);
  });

  // The grid's every-cell strokes are the first thing to go soft under a
  // scaled context: a CSS-pixel "+0.5" is no longer a device-pixel boundary.
  // Whatever the scale, each line must sit a whole number of device pixels
  // wide and be centred so its edges land on device-pixel boundaries.
  test.each([1, 2, 3])('grid strokes land on whole device pixels at scale %s', (dpr) => {
    withDevicePixelRatio(dpr);
    const ops: Op[] = [];
    BoardRenderer.renderBoard(
      fakeCanvas(ops), makeState([makeUnit('S', { x: 5, y: 5 })]), emptyMoveState, {});

    // The grid is the run of moveTo/lineTo pairs before the board's outline.
    const outline = ops.findIndex((o) => o.op === 'strokeRect');
    let width = 0;
    let checked = 0;
    for (const entry of ops.slice(0, outline)) {
      if (entry.op === 'set:lineWidth') width = entry.args[0] as number;
      if (entry.op !== 'moveTo') continue;
      const devicePx = width * dpr;
      expect(Math.round(devicePx)).toBe(devicePx);
      // An odd device width is centred on a half pixel, an even one on a whole
      // pixel — either way both of its edges fall on device-pixel boundaries.
      const offset = devicePx % 2 === 0 ? 0 : 0.5;
      const [x, y] = entry.args as number[];
      const position = (x === 0 ? y : x) * dpr;
      expect(Math.abs(position - Math.round(position - offset) - offset)).toBeLessThan(1e-9);
      checked += 1;
    }
    // 12 verticals + 12 horizontals for an 11x11 board.
    expect(checked).toBe(24);
  });

  test('a click maps to the same cell whatever resolution the board is backed at', () => {
    const board = makeState([]).board;
    // A point 125 CSS px right and 25 CSS px down from the canvas's CONTENT
    // box — the border box the rect reports starts 2px earlier again.
    const event = { clientX: 20 + 2 + 125, clientY: 40 + 2 + 25 };
    for (const dpr of [1, 2, 3]) {
      withDevicePixelRatio(dpr);
      const ops: Op[] = [];
      const canvas = fakeCanvas(ops);
      BoardRenderer.renderBoard(canvas, makeState([]), emptyMoveState, {});
      expect(BoardRenderer.boardCellSize(canvas, board)).toBe(CSS_SIZE / 11);
      // Column 2 (125 / 50), top row — y counts up from the bottom.
      expect(BoardRenderer.getClickedCell(canvas, board, event)).toEqual({ x: 2, y: 10 });
    }
  });

  test('unit tags are hit-tested in CSS pixels, so the resolution cannot move them', () => {
    const snake = makeUnit('S', { x: 5, y: 5 });
    // Every pointer position over the board that lands on the unit's tag.
    const tagHits = (dpr: number) => {
      withDevicePixelRatio(dpr);
      const ops: Op[] = [];
      const canvas = fakeCanvas(ops);
      BoardRenderer.renderBoard(canvas, makeState([snake]), emptyMoveState, {});
      const hits: string[] = [];
      for (let x = 0; x < CSS_SIZE; x += 10) {
        for (let y = 0; y < CSS_SIZE; y += 10) {
          const at = BoardRenderer.getNameTagAt(
            canvas, { clientX: 22 + x, clientY: 42 + y });
          if (at === snake.id) hits.push(`${x},${y}`);
        }
      }
      return hits;
    };

    const atOne = tagHits(1);
    // The tag is really there — an empty set would make the rest vacuous.
    expect(atOne.length).toBeGreaterThan(0);
    expect(tagHits(2)).toEqual(atOne);
    expect(tagHits(3)).toEqual(atOne);
  });

  test('the minimap is backed the same way — one resolution path, not one per surface', () => {
    withDevicePixelRatio(3);
    const ops: Op[] = [];
    const canvas = fakeCanvas(ops);
    BoardRenderer.renderMinimap(canvas, makeState([makeUnit('S', { x: 5, y: 5 })]), 'S');
    expect(canvas.width).toBe(CSS_SIZE * 3);
    expect(ops.filter((o) => o.op === 'setTransform')[0].args).toEqual([3, 0, 0, 3, 0, 0]);
  });

  test('a change of display density re-renders, and re-arms for the next change', () => {
    const listeners: Array<() => void> = [];
    const queries: string[] = [];
    (globalThis as unknown as { window: unknown }).window = {
      devicePixelRatio: 2,
      matchMedia: (query: string) => {
        queries.push(query);
        return {
          addEventListener: (_type: string, fn: () => void) => listeners.push(fn),
          removeEventListener: () => {},
        };
      },
    };
    const onChange = jest.fn();
    BoardRenderer.watchRenderScale(onChange);
    // A media query can only watch ONE ratio: the current one.
    expect(queries).toEqual(['(resolution: 2dppx)']);

    // The display changes density; the page is told, and the watch re-arms
    // against the NEW ratio rather than going deaf after one change.
    (globalThis as unknown as { window: { devicePixelRatio: number } }).window
      .devicePixelRatio = 3;
    listeners[0]();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(queries).toEqual(['(resolution: 2dppx)', '(resolution: 3dppx)']);
  });
});
