/**
 * Unit tests for the unit-tag display rules
 * (src/web/board-renderer.js — shared verbatim with the browser pages).
 *
 * Pins the tag-visibility state machine (the global Alt-tap default crossed
 * with where the pointer is on a unit) and the stat icons the on-board tags
 * share with the units table.
 */
const BoardRenderer = require('../web/board-renderer.js');

const SHOWN = false; // tagsHiddenByDefault
const HIDDEN = true;
const { none: NONE, unit: ON_UNIT, tag: ON_TAG } = BoardRenderer.TAG_HOVER;

describe('unitTagVisibility', () => {
  const vis = BoardRenderer.unitTagVisibility;

  test('tags shown by default: every un-hovered tag is drawn', () => {
    expect(vis(SHOWN, NONE, false)).toBe('solid');
    expect(vis(SHOWN, NONE, true)).toBe('selected');
  });

  test('tags hidden by default: nothing is drawn without a hover', () => {
    expect(vis(HIDDEN, NONE, false)).toBe('hidden');
    expect(vis(HIDDEN, NONE, true)).toBe('hidden');
  });

  test('hovering a unit calls its tag up, whatever the default says', () => {
    expect(vis(SHOWN, ON_UNIT, false)).toBe('solid');
    expect(vis(HIDDEN, ON_UNIT, false)).toBe('solid');
    // Hover outranks selection: one hovered tag, one appearance.
    expect(vis(SHOWN, ON_UNIT, true)).toBe('solid');
    expect(vis(HIDDEN, ON_UNIT, true)).toBe('solid');
  });

  test('the pointer on a tag hides that tag, so what it covers can be read', () => {
    for (const hidden of [SHOWN, HIDDEN]) {
      for (const selected of [false, true]) {
        expect(vis(hidden, ON_TAG, selected)).toBe('hidden');
      }
    }
  });

  test('only the three named states are reachable', () => {
    const states = new Set<string>();
    for (const hidden of [SHOWN, HIDDEN]) {
      for (const hover of [NONE, ON_UNIT, ON_TAG]) {
        for (const selected of [false, true]) {
          states.add(vis(hidden, hover, selected));
        }
      }
    }
    expect([...states].sort()).toEqual(['hidden', 'selected', 'solid']);
  });

  test('clearing the hover restores the default state exactly', () => {
    for (const hidden of [SHOWN, HIDDEN]) {
      for (const selected of [false, true]) {
        // Whatever the pointer did on the way through, letting go of it lands
        // back on the state the default alone dictates.
        const dflt = hidden ? 'hidden' : selected ? 'selected' : 'solid';
        expect(vis(hidden, NONE, selected)).toBe(dflt);
        vis(hidden, ON_UNIT, selected);
        vis(hidden, ON_TAG, selected);
        expect(vis(hidden, NONE, selected)).toBe(dflt);
      }
    }
  });

  test('an unknown hover value is treated as no hover, never as a new state', () => {
    expect(vis(SHOWN, 'wat', false)).toBe('solid');
    expect(vis(HIDDEN, 'wat', false)).toBe('hidden');
  });
});

// The pure rule above can flip a tag hidden the moment the pointer touches it,
// which moves the pointer off a tag that is no longer drawn. The caller's LATCH
// (play-game.html syncHover, modelled here) is what makes that settle instead
// of oscillating: "pointer on tag" is held until the pointer leaves BOTH the
// tag and the unit's cells.
describe('hover latch (the caller\'s half of the rule)', () => {
  const vis = BoardRenderer.unitTagVisibility;

  function makeHover() {
    let latched: string | null = null;
    return {
      // overTag/overCell: the unit under the pointer's tag rect / cells.
      move(overTag: string | null, overCell: string | null) {
        if (latched && latched !== overTag && latched !== overCell) latched = null;
        if (overTag) latched = overTag;
        return { latched, overCell };
      },
    };
  }
  function state(step: { latched: string | null; overCell: string | null }, id: string) {
    const hover = step.latched === id ? ON_TAG : step.overCell === id ? ON_UNIT : NONE;
    return vis(HIDDEN, hover, false);
  }

  test('unit → tag → unit: the tag hides once and stays hidden, no flicker', () => {
    const h = makeHover();
    // Pointer on the unit's cell: the tag appears.
    expect(state(h.move(null, 'a'), 'a')).toBe('solid');
    // Pointer moves onto that tag: it hides. Its rect keeps being published
    // while hidden, so the next move still reports the pointer on it.
    expect(state(h.move('a', null), 'a')).toBe('hidden');
    expect(state(h.move('a', null), 'a')).toBe('hidden');
    // Back onto the unit's own cell: the pointer has left neither the tag nor
    // the unit, so the tag stays out of the way instead of re-appearing.
    expect(state(h.move(null, 'a'), 'a')).toBe('hidden');
    expect(state(h.move(null, 'a'), 'a')).toBe('hidden');
  });

  test('leaving both the tag and the unit releases the latch', () => {
    const h = makeHover();
    h.move(null, 'a');
    h.move('a', null);
    // Onto a different unit: 'a' is released and back on the default, and the
    // newly hovered unit shows its own tag.
    const step = h.move(null, 'b');
    expect(state(step, 'a')).toBe('hidden'); // hidden by default, not latched
    expect(state(step, 'b')).toBe('solid');
    // Returning to 'a' shows it again — the latch is genuinely gone.
    expect(state(h.move(null, 'a'), 'a')).toBe('solid');
  });

  test('one unit\'s latched tag never suppresses another unit\'s', () => {
    const h = makeHover();
    const step = h.move('a', 'b');
    expect(state(step, 'a')).toBe('hidden');
    expect(state(step, 'b')).toBe('solid');
  });

  test('the state settles: replaying the same pointer position never changes it', () => {
    const h = makeHover();
    h.move(null, 'a');
    // The pointer sits still on the tag; every redraw must land on the same
    // state, which is what "no flicker" means in practice.
    const first = state(h.move('a', 'a'), 'a');
    expect(first).toBe('hidden');
    for (let i = 0; i < 5; i++) {
      expect(state(h.move('a', 'a'), 'a')).toBe(first);
    }
  });
});

describe('stat icons', () => {
  test('one glyph per stat, shared by the tags and the units table', () => {
    expect(BoardRenderer.STAT_ICON.health).toBe('♥');
    expect(BoardRenderer.STAT_ICON.invulnerable).toBe('\u{1F6E1}️');
    expect(BoardRenderer.STAT_ICON.vulnerable).toBe('⚠️');
  });

  test('weight is a drawn silver anvil, not a character', () => {
    // No emoji entry to drift: the tags draw the path, the table inlines it.
    expect(BoardRenderer.STAT_ICON.weight).toBeUndefined();
    const svg = BoardRenderer.anvilIconSVG(13);
    expect(svg).toContain('<svg');
    expect(svg).toContain('height="13"');
    expect(svg.toLowerCase()).toContain('#c2c7cd'); // silver
  });

  test('invulnerability icon: shield when protected, warning when negative', () => {
    expect(BoardRenderer.invulnerabilityIcon(2)).toBe(BoardRenderer.STAT_ICON.invulnerable);
    expect(BoardRenderer.invulnerabilityIcon(-1)).toBe(BoardRenderer.STAT_ICON.vulnerable);
  });
});

describe('units table', () => {
  const snake = {
    id: 'doc-id-9f3c1b',
    name: 'Red Rockets A',
    letter: 'A',
    health: 40,
    maxHealth: 100,
    length: 4,
    unitType: 'snake',
    color: '#e53935',
    invulnerabilityLevel: 2,
    body: [{ x: 1, y: 1 }, { x: 1, y: 0 }],
  };

  function render() {
    const idsEl: Record<string, unknown> = {};
    const container = {
      innerHTML: '',
      querySelector: (sel: string) => (sel === '[data-unit-ids]' ? idsEl : null),
    };
    BoardRenderer.renderSnakeInfo(container, { turn: 7, board: { snakes: [snake] } }, snake.id);
    return { html: container.innerHTML, idsEl };
  }

  test('rows show the shared stat icons, not the internal document id', () => {
    const { html } = render();
    expect(html).toContain(snake.name);
    expect(html).not.toContain(snake.id);
    // Weight rides the same anvil path the on-board tags draw.
    expect(html).toContain(BoardRenderer.anvilIconSVG(13));
    expect(html).toContain(BoardRenderer.STAT_ICON.health);
    expect(html).toContain(BoardRenderer.STAT_ICON.invulnerable);
  });

  test('the (i) affordance reveals every unit id on hover', () => {
    const { html, idsEl } = render();
    expect(html).toContain('data-unit-ids');
    expect(idsEl.title).toContain(snake.id);
    expect(idsEl.title).toContain(snake.name);
  });
});

describe('candidate-cell overlay', () => {
  test('candidate buttons carry no hover label of their own', () => {
    const board = { width: 3, height: 3, snakes: [], food: [], hazards: [] };
    const moveState = {
      selectedMove: null,
      moves: {
        '4': { key: '4', move: 4, direction: null, kind: 'stay', label: 'STAY',
               position: { x: 1, y: 1 }, isSafe: true, score: null },
        '5': { key: '5', move: 5, direction: null, kind: 'move', label: '(1,2)',
               position: { x: 1, y: 2 }, isSafe: true, score: 1.25 },
      },
    };
    const buttons: Record<string, unknown>[] = [];
    const overlayEl = {
      innerHTML: '',
      style: {} as Record<string, string>,
      appendChild: (el: Record<string, unknown>) => { buttons.push(el); },
    };
    const canvas = { clientWidth: 300, clientHeight: 300, width: 300, height: 300,
                     offsetLeft: 0, offsetTop: 0 };
    const realDocument = (global as unknown as { document?: unknown }).document;
    (global as unknown as { document: unknown }).document = {
      createElement: () => ({ className: '', style: {} as Record<string, string> }),
    };
    try {
      BoardRenderer.createBoardOverlay(overlayEl, canvas, board, moveState, null);
    } finally {
      (global as unknown as { document?: unknown }).document = realDocument;
    }
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.title).toBeUndefined();
    }
  });
});
