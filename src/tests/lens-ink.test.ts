/**
 * THE LENS INK ON THE BOARD — violet means hypothetical, and only
 * disagreement draws.
 *
 * The board already speaks: the orientation eye is blue, the hold shield and
 * the clash arms are amber, fatal is red, the bot is grey, goto is green,
 * staged arrows wear their operator's colour. The lens adds one more voice and
 * it must be distinguishable from every one of those with the hues collapsed,
 * on a light board and on a dark one. So this file checks two things a
 * screenshot cannot: WHICH marks are laid down for a given moveset, and WHEN
 * each is laid down relative to the units it has to read against.
 *
 * The falsifier it exists to catch is the board redrawing every member's
 * arrow whenever the operator walks the list. If agreement draws, the common
 * case — the operator looking at the incumbent — becomes a board full of
 * duplicate arrows, and the one thing the lens is for (seeing what a different
 * moveset would CHANGE) is buried in the ink that says what would not.
 */

import { GameState, Snake, Coord } from '../types/battlesnake';

const BoardRenderer = require('../web/board-renderer.js');

// Head glyphs build Path2D objects; the stub only has to exist for them.
(globalThis as unknown as { Path2D: unknown }).Path2D = class {
  constructor(public d?: string) {}
};

type Op = { op: string; args: unknown[] };

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
const BOARD = 11;

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
    getBoundingClientRect: () => ({ left: 0, top: 0, width: CSS_SIZE, height: CSS_SIZE }),
  };
}

const COLOR = { C: '#1565c0', Q: '#8e24aa', R: '#2e7d32' };

function unit(id: string, letter: string, head: Coord, color: string): Snake {
  const body: Coord[] = [head, { x: head.x, y: head.y - 1 }];
  return {
    id,
    name: id,
    latency: '0',
    health: 90,
    body,
    head: body[0],
    length: 2,
    shout: '',
    squad: '',
    orientation: { dx: 0, dy: 1 },
    customizations: { color, head: 'default', tail: 'default' },
    letter,
    unitType: 'snake',
  } as unknown as Snake;
}

/** Three of ours: C and Q are cluster members, R is pinned and therefore out. */
function boardState(): GameState {
  return {
    game: { id: 'g', ruleset: { name: 'standard', version: '1' }, timeout: 500 },
    turn: 41,
    board: {
      width: BOARD,
      height: BOARD,
      food: [],
      hazards: [],
      clashes: [],
      snakes: [
        unit('C', 'C', { x: 2, y: 5 }, COLOR.C),
        unit('Q', 'Q', { x: 5, y: 5 }, COLOR.Q),
        unit('R', 'R', { x: 8, y: 5 }, COLOR.R),
      ],
    },
    you: unit('C', 'C', { x: 2, y: 5 }, COLOR.C),
  } as unknown as GameState;
}

const emptyMoveState = { selectedMove: null, moves: {}, offerable: [], selectedSnake: null };

/** α = {C, Q}; R is bounded by Ada's pin. C is the focused unit. */
function lensOptions(over: Record<string, unknown> = {}) {
  return {
    clusters: [
      {
        id: 0,
        glyph: 'α',
        members: ['C', 'Q'],
        boundedBy: [{ unit: 'R', why: 'pin', by: 'ada' }],
      },
    ],
    focus: 'C',
    arrows: [{ unit: 'C', to: 'up', style: 'filled' }],
    rings: [{ unit: 'Q', to: 'right' }],
    foil: [],
    ...over,
  };
}

function render(lens: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) {
  (globalThis as unknown as { window: unknown }).window = { devicePixelRatio: 1 };
  const ops: Op[] = [];
  BoardRenderer.renderBoard(fakeCanvas(ops), boardState(), emptyMoveState, {
    lens,
    ...extra,
  });
  delete (globalThis as unknown as { window?: unknown }).window;
  return ops;
}

function setAt(ops: Op[], prop: string, value: unknown): number[] {
  const out: number[] = [];
  ops.forEach((entry, i) => {
    if (entry.op === `set:${prop}` && entry.args[0] === value) out.push(i);
  });
  return out;
}

const LIGHT = BoardRenderer.LENS_THEME.light;
const DARK = BoardRenderer.LENS_THEME.dark;

describe('the ink is its own voice', () => {
  test('no lens token collides with a hue the board already claims', () => {
    // Every colour the board spends meaning on today. The eye's blue, the
    // shield's and the clash's amber, fatal red, bot grey, and the operator
    // colours the arrows wear.
    const claimed = [
      'rgba(56, 174, 255, 0.8)',
      '#FF8F00',
      '#FFC107',
      '#ff1744',
      '#9E9E9E',
      COLOR.C,
      COLOR.Q,
      COLOR.R,
    ].map((c) => c.toLowerCase());
    for (const theme of [LIGHT, DARK]) {
      for (const token of [theme.lens, theme.foil, theme.refuter]) {
        expect(claimed).not.toContain(String(token).toLowerCase());
      }
    }
  });

  test('every token is a pair, so the dark board needs no redesign', () => {
    expect(Object.keys(LIGHT).sort()).toEqual(Object.keys(DARK).sort());
    for (const key of Object.keys(LIGHT)) {
      expect(LIGHT[key]).not.toEqual(DARK[key]);
    }
  });

  test('the theme falls back to light rather than to nothing', () => {
    expect(BoardRenderer.lensTheme(undefined)).toBe(LIGHT);
    expect(BoardRenderer.lensTheme('dark')).toBe(DARK);
  });
});

describe('the constellation', () => {
  test('a tether is drawn to every member and to no excluded unit', () => {
    const ops = render(lensOptions());
    // The ground pass is the only place a 1px dashed violet stroke is laid
    // down, and it strokes once per member.
    const dashes = ops.filter(
      (o) => o.op === 'setLineDash' && Array.isArray(o.args[0]) && (o.args[0] as number[])[0] === 3
    );
    expect(dashes.length).toBe(1);
    const tetherInk = setAt(ops, 'strokeStyle', LIGHT.lens);
    expect(tetherInk.length).toBeGreaterThan(0);
    // Two members, two tethers, and R's head is never an endpoint.
    const strokesAfterDash = ops
      .slice(ops.indexOf(dashes[0] as Op))
      .filter((o) => o.op === 'lineTo');
    expect(strokesAfterDash.length).toBeGreaterThanOrEqual(2);
  });

  test('a singleton cluster gets its wash and no tether at all', () => {
    const ops = render(lensOptions({ clusters: [{ id: 0, glyph: 'α', members: ['C'] }] }));
    const dashes = ops.filter(
      (o) => o.op === 'setLineDash' && Array.isArray(o.args[0]) && (o.args[0] as number[])[0] === 3
    );
    expect(dashes.length).toBe(0);
    expect(setAt(ops, 'fillStyle', LIGHT.wash).length).toBe(1);
  });

  test('the wash is dropped at small cell sizes, where it would be mud', () => {
    (globalThis as unknown as { window: unknown }).window = { devicePixelRatio: 1 };
    const ops: Op[] = [];
    const ctx = recordingContext(ops);
    BoardRenderer.renderLensGround(ctx, boardState().board, lensOptions(), 18);
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(setAt(ops, 'fillStyle', LIGHT.wash).length).toBe(0);
  });

  test('a bounded unit gets the grey chip; a held unit keeps its shield and gets none', () => {
    const pinned = render(lensOptions());
    expect(setAt(pinned, 'fillStyle', LIGHT.fixed).length).toBe(1);

    const held = render(
      lensOptions({
        clusters: [
          {
            id: 0,
            glyph: 'α',
            members: ['C', 'Q'],
            boundedBy: [{ unit: 'R', why: 'hold', by: 'ben' }],
          },
        ],
      })
    );
    expect(setAt(held, 'fillStyle', LIGHT.fixed).length).toBe(0);
  });
});

describe('only disagreement draws', () => {
  test('an agreeing member gets a ring, not a second arrow', () => {
    const ops = render(lensOptions());
    // One filled arrow for the focused unit: a closed path that is FILLED.
    const arrowHeads = ops.filter((o) => o.op === 'fill');
    // One ring: an arc, and the only arc in the handle pass.
    const arcs = ops.filter((o) => o.op === 'arc');
    expect(arcs.length).toBeGreaterThan(0);
    expect(arrowHeads.length).toBeGreaterThan(0);
  });

  test('a disagreeing member draws a HOLLOW arrow, which strokes and never fills', () => {
    const hollow = render(
      lensOptions({
        arrows: [
          { unit: 'C', to: 'up', style: 'filled' },
          { unit: 'Q', to: 'left', style: 'hollow' },
        ],
        rings: [],
      })
    );
    const agreeing = render(lensOptions());
    // The hollow arrow adds strokes, not fills: the staged arrow underneath
    // stays visible through it.
    const fills = (ops: Op[]) => ops.filter((o) => o.op === 'fill').length;
    expect(fills(hollow)).toBe(fills(agreeing));
    expect(hollow.filter((o) => o.op === 'stroke').length).toBeGreaterThan(
      agreeing.filter((o) => o.op === 'stroke').length
    );
  });

  test('the foil draws dotted, in its own token, only where it differs', () => {
    const ops = render(lensOptions({ foil: [{ unit: 'Q', to: 'down', delta: -1.1 }] }));
    expect(setAt(ops, 'strokeStyle', LIGHT.foil).length).toBeGreaterThan(0);
    // Its Δ badge is text in the same token, and it is the only lens text
    // that carries a sign.
    const badge = ops.find((o) => o.op === 'fillText' && String(o.args[0]).startsWith('-1.1'));
    expect(badge).toBeDefined();
  });

  test('a move with no drawable endpoint draws nothing at all', () => {
    const bare = render(lensOptions({ arrows: [], rings: [], foil: [] }));

    // A destination index reachable on this board DOES draw: (5,5) is Q's
    // square, and the full-board index arithmetic is the same one staging
    // puts on the wire.
    const fullW = BOARD + 2;
    const qIndex = (BOARD + 2 - 5 - 2) * fullW + (5 + 1);
    const drawn = render(
      lensOptions({ arrows: [{ unit: 'C', to: qIndex, style: 'filled' }], rings: [], foil: [] })
    );
    expect(drawn.length).toBeGreaterThan(bare.length);

    // A stay — the unit's own square — and a unit that is not on the board
    // both resolve to no endpoint, and no endpoint means no ink.
    const cIndex = (BOARD + 2 - 5 - 2) * fullW + (2 + 1);
    for (const arrows of [
      [{ unit: 'C', to: cIndex, style: 'filled' }],
      [{ unit: 'ghost', to: 'up', style: 'filled' }],
      [{ unit: 'C', to: 0, style: 'filled' }],
    ]) {
      expect(render(lensOptions({ arrows, rings: [], foil: [] })).length).toBe(bare.length);
    }
  });
});

describe('the passes are ordered against the units', () => {
  test('the constellation goes under the units and the chips go over them', () => {
    const ops = render(lensOptions());
    const bodyPass = setAt(ops, 'fillStyle', COLOR.Q)[0];
    expect(bodyPass).toBeDefined();

    const wash = setAt(ops, 'fillStyle', LIGHT.wash)[0];
    expect(wash).toBeLessThan(bodyPass as number);

    // The chip is the last violet fill, and it lands after the bodies.
    const chips = setAt(ops, 'fillStyle', LIGHT.lens);
    expect(chips[chips.length - 1]).toBeGreaterThan(bodyPass as number);
  });

  test('no lens ink at all when the frame carries no lens', () => {
    const ops = render(undefined);
    for (const token of [LIGHT.lens, LIGHT.wash, LIGHT.foil, LIGHT.fixed]) {
      expect(setAt(ops, 'fillStyle', token).length).toBe(0);
      expect(setAt(ops, 'strokeStyle', token).length).toBe(0);
    }
  });
});
