/**
 * The clash affordance: the mark that says "something collided on this square,
 * and the board can tell you what".
 *
 * The requirement it exists to keep is an ordering one — a unit that SURVIVED a
 * clash is still standing on that square, and the survivor must read as the
 * thing on the square, not the mark. So the affordance is drawn in two passes:
 * a GROUND pass under the units (scorch + a frame on the cell's edge) and a
 * HANDLE pass over them (the frame's four corner ticks). Covers:
 *  - the cells the two passes walk, and that they walk the same ones;
 *  - the ordering: ground BEFORE the survivor's body, handle AFTER it;
 *  - the geometry that makes the handle safe to draw on top — every tick stays
 *    inside the cell's corner squares, which a unit body never occupies;
 *  - the cell under the pointer drawing lit, which is what the page's pointer
 *    cursor is answering at the same moment.
 */

import { GameState, Snake, Coord } from '../types/battlesnake';

const BoardRenderer = require('../web/board-renderer.js');

// Head glyphs build Path2D objects; the stub only has to exist for them.
(globalThis as unknown as { Path2D: unknown }).Path2D = class {
  constructor(public d?: string) {}
};

type Op = { op: string; args: unknown[] };

// A 2D context that records every call and every property written to it. The
// whole question here is WHEN each mark was laid down relative to the others,
// and this is the only thing that can answer it.
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
const BOARD = 8;
const CELL = CSS_SIZE / BOARD;

function fakeCanvas(ops: Op[]) {
  const ctx = recordingContext(ops);
  return {
    width: CSS_SIZE,
    height: CSS_SIZE,
    clientWidth: CSS_SIZE,
    clientHeight: CSS_SIZE,
    clientLeft: 0,
    clientTop: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({
      left: 0, top: 0, width: CSS_SIZE, height: CSS_SIZE,
    }),
  };
}

const SURVIVOR_COLOR = '#1565c0';

// A two-cell unit standing with its head on (2,4) — the square it survived a
// clash on.
function survivor(): Snake {
  const body: Coord[] = [{ x: 2, y: 4 }, { x: 2, y: 3 }];
  return {
    id: 'keep', name: 'Keeper', latency: '0', health: 90,
    body, head: body[0], length: 2, shout: '', squad: '',
    orientation: { dx: 0, dy: 1 },
    customizations: { color: SURVIVOR_COLOR, head: 'default', tail: 'default' },
    letter: 'K', unitType: 'snake',
  } as unknown as Snake;
}

// Two clash cells: one the survivor is standing on, one nobody walked away
// from. The second record repeats a cell, as the wire does when several bodies
// collided on one square.
function clashState(): GameState {
  return {
    game: { id: 'g', ruleset: { name: 'standard', version: '1' }, timeout: 500 },
    turn: 12,
    board: {
      width: BOARD, height: BOARD, food: [], hazards: [], snakes: [survivor()],
      clashes: [
        { cell: { x: 2, y: 4 }, playerIDs: ['keep', 'gone'], reason: 'Head-on collision', subStep: 2 },
        { cell: { x: 2, y: 4 }, playerIDs: ['gone', 'keep'], reason: 'Head-on collision', subStep: 2 },
        { cell: { x: 5, y: 1 }, playerIDs: ['gone'], reason: 'Collided with wall', subStep: 3 },
      ],
    },
    you: survivor(),
  } as unknown as GameState;
}

const emptyMoveState = {
  selectedMove: null, moves: {}, safeMoves: [], territoryCells: {}, selectedSnake: null,
};

function render(options: Record<string, unknown> = {}) {
  (globalThis as unknown as { window: unknown }).window = { devicePixelRatio: 1 };
  const ops: Op[] = [];
  BoardRenderer.renderBoard(fakeCanvas(ops), clashState(), emptyMoveState, options);
  delete (globalThis as unknown as { window?: unknown }).window;
  return ops;
}

// Every index at which the given property was set to the given value.
function setAt(ops: Op[], prop: string, value: string): number[] {
  const out: number[] = [];
  ops.forEach((entry, i) => {
    if (entry.op === `set:${prop}` && entry.args[0] === value) out.push(i);
  });
  return out;
}

const CLASH_INK = '#FF8F00';
const CLASH_INK_HOT = '#FFC107';

// The body pass: where the survivor's own colour is laid down as filled cell
// rects. The same colour turns up again later in the unit's TAG, which is drawn
// above the affordance on purpose — a tag is a readout, not a mark on the
// square — so the pass has to be identified by its run of rects, not by the
// colour alone.
function bodyPass(ops: Op[]): { start: number; end: number } {
  const start = setAt(ops, 'fillStyle', SURVIVOR_COLOR)[0];
  expect(start).toBeDefined();
  let end = start;
  for (let i = start + 1; i < ops.length; i++) {
    if (ops[i].op !== 'fillRect') break;
    end = i;
  }
  expect(end).toBeGreaterThan(start);
  return { start, end };
}

describe('clash affordance — which cells are marked', () => {
  test('every cell a clash record names is marked, once, whoever is standing on it', () => {
    const board = clashState().board;
    expect(BoardRenderer.clashCells(board)).toEqual([{ x: 2, y: 4 }, { x: 5, y: 1 }]);
    // The key set and the cell list are the same set — the drawing passes and
    // the hit-test can never disagree about which squares are inspectable.
    expect([...BoardRenderer.clashCellKeys(board)].sort()).toEqual(['2,4', '5,1']);
  });

  test('a cell either carries a clash record or it does not, cheaply', () => {
    const board = clashState().board;
    expect(BoardRenderer.hasClashAt(board, { x: 2, y: 4 })).toBe(true);
    expect(BoardRenderer.hasClashAt(board, { x: 5, y: 1 })).toBe(true);
    expect(BoardRenderer.hasClashAt(board, { x: 0, y: 0 })).toBe(false);
    expect(BoardRenderer.hasClashAt(board, null)).toBe(false);
    expect(BoardRenderer.hasClashAt({ snakes: [] }, { x: 2, y: 4 })).toBe(false);
  });
});

describe('clash affordance — the survivor draws on top', () => {
  // THE requirement. A clash mark that painted over the unit standing on the
  // square would hide the very thing the square is about.
  test('the ground goes down before the survivor’s body, the handle after it', () => {
    const ops = render();
    const body = bodyPass(ops);
    const ink = setAt(ops, 'strokeStyle', CLASH_INK);
    // Two passes, so the ink is laid twice per cell: once under the unit, once
    // over it.
    expect(ink.length).toBe(2 * BoardRenderer.clashCells(clashState().board).length);
    expect(Math.min(...ink)).toBeLessThan(body.start);
    expect(Math.max(...ink)).toBeGreaterThan(body.end);
    // The scorch is ground, always: it is the part a body is meant to cover.
    const scorch = setAt(ops, 'fillStyle', 'rgba(255, 143, 0, 0.16)');
    expect(scorch.length).toBe(2);
    expect(Math.max(...scorch)).toBeLessThan(body.start);
  });

  test('the handle’s ticks stay in the cell corners a unit body never reaches', () => {
    const ops = render();
    const body = bodyPass(ops);
    const handleStart = setAt(ops, 'strokeStyle', CLASH_INK)
      .filter((i) => i > body.end)[0];
    expect(handleStart).toBeDefined();
    // Points drawn from there on, up to the next thing that changes the ink.
    const points: Array<[number, number]> = [];
    for (const entry of ops.slice(handleStart)) {
      if (entry.op === 'moveTo' || entry.op === 'lineTo') {
        points.push([entry.args[0] as number, entry.args[1] as number]);
      }
    }
    expect(points.length).toBeGreaterThan(0);
    // A body is inset by getSnakeGap() on every side and only reaches an edge
    // along the middle band of a connection, so the cell's corner squares are
    // exactly the ink-free margin. Every tick point has to live in one.
    const gap = BoardRenderer.getSnakeGap ? BoardRenderer.getSnakeGap(CELL) : Math.max(2, Math.floor(CELL * 0.15));
    const inCorner = (v: number) => {
      const within = ((v % CELL) + CELL) % CELL;
      return within <= gap + 0.001 || within >= CELL - gap - 0.001;
    };
    for (const [px, py] of points) {
      expect(inCorner(px)).toBe(true);
      expect(inCorner(py)).toBe(true);
    }
  });

  test('a clash cell with no survivor is marked exactly the same way', () => {
    // Nothing stands on (5,1): the mark is all there is, and both passes still
    // run so live play, historic scrubbing and /history show one thing.
    const ops = render();
    const scorch = setAt(ops, 'fillStyle', 'rgba(255, 143, 0, 0.16)');
    const lonely = ops
      .slice(scorch[1], scorch[1] + 6)
      .find((o) => o.op === 'fillRect');
    expect(lonely).toBeDefined();
    expect(lonely!.args.slice(0, 2)).toEqual([5 * CELL, (BOARD - 1 - 1) * CELL]);
  });
});

describe('clash affordance — the pointer’s own cell', () => {
  test('the cell under the pointer is drawn lit, and only that cell', () => {
    const cold = render();
    expect(setAt(cold, 'strokeStyle', CLASH_INK_HOT)).toEqual([]);

    const hot = render({ clashHoverCell: { x: 5, y: 1 } });
    // One lit cell, both of its passes; the other clash cell stays cold.
    expect(setAt(hot, 'strokeStyle', CLASH_INK_HOT).length).toBe(2);
    expect(setAt(hot, 'strokeStyle', CLASH_INK).length).toBe(2);
    expect(setAt(hot, 'fillStyle', 'rgba(255, 143, 0, 0.3)').length).toBe(1);
  });

  test('a pointer resting on a cell with no clash lights nothing', () => {
    const ops = render({ clashHoverCell: { x: 0, y: 0 } });
    expect(setAt(ops, 'strokeStyle', CLASH_INK_HOT)).toEqual([]);
    expect(setAt(ops, 'strokeStyle', CLASH_INK).length).toBe(4);
  });
});
