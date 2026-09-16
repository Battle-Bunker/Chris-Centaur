/**
 * THE INPUT LAYER'S PURE HALF — the gesture recogniser and the preference
 * resolver (src/web/input-layer.js, shared verbatim with play-game.html).
 *
 * A browser drill can show that a drag selects a candidate; it cannot show
 * that a press which became a long-press never ALSO fires a tap, or that a
 * preference falls back to the shipped default when the store holds rubbish.
 * Those are properties of the machine, and this is where they are asserted —
 * the same split `keynav-machine.test.ts` makes for the destination cursor.
 *
 * The three properties that matter:
 *
 *   · THE OUTCOMES ARE DISJOINT. One press yields exactly one of tap /
 *     longpress / dragend. Three independent listeners over one press is how
 *     an interface ends up staging a move AND opening a panel on one gesture.
 *   · LONG-PRESS IS A TOUCH GESTURE. Both desktop platforms bind a held
 *     primary button to a simulated secondary click, so binding our own
 *     meaning to it on a mouse collides with the operating system
 *     (12 §1.5).
 *   · A PREFERENCE IS A PREFERENCE. `window.Prefs` wins where it exists,
 *     localStorage mirrors it where it does not, and an unrecognised value is
 *     the default rather than a new mode.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Gesture = {
  active: boolean;
  down: (e: any) => any;
  move: (e: any) => any;
  tick: (t: number) => any;
  up: (e: any) => any;
  cancel: () => void;
};

const InputLayer = require('../web/input-layer.js') as {
  DEFAULTS: Record<string, unknown>;
  ALLOWED: Record<string, string[]>;
  SLOP_PX: number;
  pref: (name: string) => unknown;
  setPref: (name: string, value: string) => boolean;
  createGesture: (opts?: Record<string, unknown>) => Gesture;
  applyClasses: (doc: unknown, get?: (n: string) => unknown) => unknown;
  install: (host: Record<string, unknown>) => unknown;
};

const TOUCH = { pointerId: 1, pointerType: 'touch' as const };
const MOUSE = { pointerId: 1, pointerType: 'mouse' as const };

describe('the gesture recogniser', () => {
  it('a short press that does not move is a tap, and nothing else', () => {
    const g = InputLayer.createGesture();
    expect(g.down({ ...TOUCH, x: 100, y: 100, t: 0 })).toBeNull();
    expect(g.tick(100)).toBeNull(); // well inside the long-press threshold
    const up = g.up({ ...TOUCH, x: 100, y: 100, t: 120 });
    expect(up).toMatchObject({ t: 'tap', pointerType: 'touch', held: 120 });
    expect(g.active).toBe(false);
  });

  it('a held press fires ONE long-press and then no tap on release', () => {
    const g = InputLayer.createGesture({ longPressMs: 450 });
    g.down({ ...TOUCH, x: 10, y: 10, t: 0 });
    expect(g.tick(449)).toBeNull();
    expect(g.tick(450)).toMatchObject({ t: 'longpress' });
    // The press is spent: the timer does not re-fire and the release is silent.
    expect(g.tick(900)).toBeNull();
    expect(g.up({ ...TOUCH, x: 10, y: 10, t: 900 })).toBeNull();
  });

  it('a long-press is not bound on a mouse — the OS owns the held primary button', () => {
    const g = InputLayer.createGesture({ longPressMs: 450 });
    g.down({ ...MOUSE, x: 10, y: 10, t: 0 });
    expect(g.tick(2000)).toBeNull();
    // ...and the release is still an ordinary tap, not a swallowed press.
    expect(g.up({ ...MOUSE, x: 10, y: 10, t: 2000 })).toMatchObject({ t: 'tap' });
  });

  it('crossing the slop starts a drag, and the drag is not also a tap', () => {
    const g = InputLayer.createGesture({ slop: 8 });
    g.down({ ...MOUSE, x: 0, y: 0, t: 0 });
    expect(g.move({ ...MOUSE, x: 6, y: 0, t: 10 })).toBeNull(); // inside the slop
    expect(g.move({ ...MOUSE, x: 20, y: 0, t: 20 })).toMatchObject({ t: 'dragstart' });
    expect(g.move({ ...MOUSE, x: 40, y: 0, t: 30 })).toMatchObject({ t: 'drag' });
    const up = g.up({ ...MOUSE, x: 40, y: 0, t: 40 });
    expect(up).toMatchObject({ t: 'dragend', from: { x: 0, y: 0 }, to: { x: 40, y: 0 } });
  });

  it('a press that moved never becomes a long-press, however long it is held', () => {
    const g = InputLayer.createGesture({ longPressMs: 450, slop: 8 });
    g.down({ ...TOUCH, x: 0, y: 0, t: 0 });
    g.move({ ...TOUCH, x: 30, y: 0, t: 10 });
    expect(g.tick(5000)).toBeNull();
    expect(g.up({ ...TOUCH, x: 30, y: 0, t: 5000 })).toMatchObject({ t: 'dragend' });
  });

  it('a press that long-pressed never becomes a drag either', () => {
    const g = InputLayer.createGesture({ longPressMs: 450, slop: 8 });
    g.down({ ...TOUCH, x: 0, y: 0, t: 0 });
    expect(g.tick(500)).toMatchObject({ t: 'longpress' });
    expect(g.move({ ...TOUCH, x: 90, y: 0, t: 600 })).toBeNull();
  });

  it('a second pointer cannot steer or end the first one’s gesture', () => {
    const g = InputLayer.createGesture();
    g.down({ pointerId: 1, pointerType: 'touch', x: 0, y: 0, t: 0 });
    expect(g.move({ pointerId: 2, pointerType: 'touch', x: 90, y: 0, t: 10 })).toBeNull();
    expect(g.up({ pointerId: 2, pointerType: 'touch', x: 90, y: 0, t: 20 })).toBeNull();
    expect(g.active).toBe(true);
    expect(g.up({ pointerId: 1, pointerType: 'touch', x: 0, y: 0, t: 30 })).toMatchObject({ t: 'tap' });
  });

  it('a cancelled press yields nothing at all', () => {
    const g = InputLayer.createGesture();
    g.down({ ...TOUCH, x: 0, y: 0, t: 0 });
    g.cancel();
    expect(g.active).toBe(false);
    expect(g.tick(9999)).toBeNull();
    expect(g.up({ ...TOUCH, x: 0, y: 0, t: 9999 })).toBeNull();
  });
});

describe('the input preferences', () => {
  const store: Record<string, string> = {};
  const g = globalThis as unknown as { localStorage?: unknown; Prefs?: unknown };
  const originalStorage = g.localStorage;

  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    g.localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    delete g.Prefs;
  });
  afterAll(() => {
    if (originalStorage === undefined) delete g.localStorage;
    else g.localStorage = originalStorage;
    delete g.Prefs;
  });

  it('the shipped defaults are the shipped defaults', () => {
    expect(InputLayer.pref('input.moveGesture')).toBe('both');
    expect(InputLayer.pref('input.handedness')).toBe('right');
    expect(InputLayer.pref('input.targets')).toBe('auto');
  });

  it('reads and writes the localStorage mirror under the `input.*` name', () => {
    expect(InputLayer.setPref('input.handedness', 'left')).toBe(true);
    expect(store['input.handedness']).toBe('left');
    expect(InputLayer.pref('input.handedness')).toBe('left');
  });

  it('`window.Prefs` WINS where it exists — one store, not two', () => {
    store['input.handedness'] = 'left';
    g.Prefs = { get: (name: string, fallback: unknown) => (name === 'input.handedness' ? 'right' : fallback) };
    expect(InputLayer.pref('input.handedness')).toBe('right');
  });

  it('a value outside the allowed set is the DEFAULT, never a new mode', () => {
    store['input.moveGesture'] = 'wiggle';
    expect(InputLayer.pref('input.moveGesture')).toBe('both');
    expect(InputLayer.setPref('input.moveGesture', 'wiggle')).toBe(false);
    // ...and the refusal did not write anything through.
    expect(store['input.moveGesture']).toBe('wiggle');
  });

  it('a Prefs that throws falls back rather than taking the page down', () => {
    g.Prefs = {
      get: () => {
        throw new Error('prefs unavailable');
      },
    };
    store['input.targets'] = 'large';
    expect(InputLayer.pref('input.targets')).toBe('large');
  });

  it('every allowed value is reachable, and only those', () => {
    for (const [name, values] of Object.entries(InputLayer.ALLOWED)) {
      for (const v of values) expect(InputLayer.setPref(name, v)).toBe(true);
      expect(InputLayer.setPref(name, 'nope')).toBe(false);
    }
  });
});

describe('the preference classes', () => {
  function fakeDoc(): { documentElement: { classList: { list: Set<string>; toggle: (c: string, on: boolean) => void } } } {
    const list = new Set<string>();
    return {
      documentElement: {
        classList: {
          list,
          toggle: (c: string, on: boolean) => {
            if (on) list.add(c);
            else list.delete(c);
          },
        },
      },
    };
  }

  it('stamps the handedness and target-size classes, and nothing else', () => {
    const doc = fakeDoc();
    InputLayer.applyClasses(doc, (n: string) =>
      n === 'input.handedness' ? 'left' : n === 'input.targets' ? 'large' : null
    );
    expect([...doc.documentElement.classList.list].sort()).toEqual([
      'input-hand-left',
      'input-targets-large',
    ]);
  });

  it('the defaults stamp NOTHING — a right-handed desktop is untouched', () => {
    const doc = fakeDoc();
    InputLayer.applyClasses(doc, (n: string) =>
      n === 'input.handedness' ? 'right' : n === 'input.targets' ? 'auto' : null
    );
    expect([...doc.documentElement.classList.list]).toEqual([]);
  });
});
