/**
 * Unit tests for the unit-tag display rules
 * (src/web/board-renderer.js — shared verbatim with the browser pages).
 *
 * Pins the tag-visibility state machine (the global Alt-tap default crossed
 * with where the pointer is on a unit), the mode gate that decides WHICH
 * pointer input that default reads, and the stat icons the on-board tags
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

// Which pointer input a tag reads depends on the display default, and that
// mode gate — not a latch — is what keeps the rule from fighting itself. The
// caller (play-game.html syncHover) tracks only the input its current mode
// reads; the model below is that caller, and the assertions are the owner's
// spec for the two modes.
describe('tagHoverState + syncHover (the caller\'s half of the rule)', () => {
  const gate = BoardRenderer.tagHoverState;
  const vis = BoardRenderer.unitTagVisibility;

  // The caller: one pointer position in (the unit whose BODY it is over, and
  // the unit whose TAG rect it is over), the two tracked ids out.
  function syncHover(hiddenDefault: boolean, overBody: string | null, overTag: string | null) {
    return {
      hoveredUnitId: hiddenDefault ? overBody : null,
      tagHoverUnitId: hiddenDefault ? null : overTag,
    };
  }
  function state(
    hiddenDefault: boolean,
    hover: { hoveredUnitId: string | null; tagHoverUnitId: string | null },
    id: string,
    selected = false,
  ) {
    return vis(
      hiddenDefault,
      gate(hiddenDefault, hover.hoveredUnitId === id, hover.tagHoverUnitId === id),
      selected,
    );
  }

  test('default OFF: hovering any body cell shows the tag, leaving hides it', () => {
    expect(state(HIDDEN, syncHover(HIDDEN, null, null), 'a')).toBe('hidden');
    // Body cell — head or any other segment, the caller reports the same id.
    expect(state(HIDDEN, syncHover(HIDDEN, 'a', null), 'a')).toBe('solid');
    // Pointer off the unit again.
    expect(state(HIDDEN, syncHover(HIDDEN, null, null), 'a')).toBe('hidden');
  });

  test('default OFF: a tag drawn over its own unit\'s body cannot hide itself', () => {
    // THE BUG: the tag lands on cells the unit's body occupies, so the pointer
    // is on the body AND inside the tag's published rect at the same time. In
    // this mode the rect says nothing, so the tag stays up instead of
    // switching itself off the frame after it appeared.
    const hover = syncHover(HIDDEN, 'a', 'a');
    expect(hover.tagHoverUnitId).toBeNull();
    expect(state(HIDDEN, hover, 'a')).toBe('solid');
    // And it settles: replaying the same position never changes the state.
    for (let i = 0; i < 5; i++) {
      expect(state(HIDDEN, syncHover(HIDDEN, 'a', 'a'), 'a')).toBe('solid');
    }
  });

  test('default OFF: only the hovered unit\'s tag comes up', () => {
    const hover = syncHover(HIDDEN, 'a', null);
    expect(state(HIDDEN, hover, 'a')).toBe('solid');
    expect(state(HIDDEN, hover, 'b')).toBe('hidden');
  });

  test('default ON: body hover is not tracked at all', () => {
    const hover = syncHover(SHOWN, 'a', null);
    expect(hover.hoveredUnitId).toBeNull();
    expect(state(SHOWN, hover, 'a')).toBe('solid'); // the default, not a hover
    expect(state(SHOWN, hover, 'a', true)).toBe('selected');
  });

  test('default ON: resting on a tag steps it aside, leaving it brings it back', () => {
    expect(state(SHOWN, syncHover(SHOWN, null, 'a'), 'a')).toBe('hidden');
    // The rect keeps being published while hidden, so a still pointer settles.
    for (let i = 0; i < 5; i++) {
      expect(state(SHOWN, syncHover(SHOWN, null, 'a'), 'a')).toBe('hidden');
    }
    expect(state(SHOWN, syncHover(SHOWN, null, null), 'a')).toBe('solid');
  });

  test('default ON: one unit\'s stepped-aside tag never suppresses another\'s', () => {
    const hover = syncHover(SHOWN, 'b', 'a');
    expect(state(SHOWN, hover, 'a')).toBe('hidden');
    expect(state(SHOWN, hover, 'b')).toBe('solid');
  });

  test('the gate never reports the input its mode does not own', () => {
    expect(gate(HIDDEN, false, true)).toBe(NONE);
    expect(gate(HIDDEN, true, true)).toBe(ON_UNIT);
    expect(gate(SHOWN, true, false)).toBe(NONE);
    expect(gate(SHOWN, true, true)).toBe(ON_TAG);
  });
});

describe('stat icons', () => {
  test('one glyph per stat, shared by the tags and the units table', () => {
    expect(BoardRenderer.STAT_ICON.health).toBe('♥');
    expect(BoardRenderer.STAT_ICON.invulnerable).toBe('\u{1F6E1}️');
  });

  test('weight is a drawn silver anvil, not a character', () => {
    // No emoji entry to drift: the tags draw the path, the table inlines it.
    expect(BoardRenderer.STAT_ICON.weight).toBeUndefined();
    const svg = BoardRenderer.anvilIconSVG(13);
    expect(svg).toContain('<svg');
    expect(svg).toContain('height="13"');
    expect(svg.toLowerCase()).toContain('#c2c7cd'); // silver
  });

  test('extra-vulnerability is a drawn RED hazard mark, not a character', () => {
    // The warning emoji is gone: it arrived in the platform's own amber and
    // read as decoration next to the board's red hazard lattice.
    expect(BoardRenderer.STAT_ICON.vulnerable).toBeUndefined();
    const svg = BoardRenderer.hazardIconSVG(13);
    expect(svg).toContain('<svg');
    expect(svg).toContain('height="13"');
    expect(svg.toLowerCase()).toContain('#d81b1b'); // red
    // ONE path definition, inlined twice: the nonzero backing under the
    // even-odd fill that punches the exclamation out of it.
    const paths = svg.match(/ d="([^"]+)"/g) || [];
    expect(paths).toHaveLength(2);
    expect(paths[0]).toBe(paths[1]);
    expect(svg).toContain('fill-rule="nonzero"');
    expect(svg).toContain('fill-rule="evenodd"');
  });

  test('invulnerability mark: shield glyph when protected, hazard path when negative', () => {
    expect(BoardRenderer.invulnerabilityMark(2)).toEqual({
      icon: BoardRenderer.STAT_ICON.invulnerable,
    });
    expect(BoardRenderer.invulnerabilityMark(-1)).toEqual({ mark: 'hazard' });
  });
});

describe('tag outline', () => {
  const { TAG_OUTLINE } = BoardRenderer;

  test('both weights are fat, and the selected one is fatter still', () => {
    for (const fontSize of [12, 14, 20, 30]) {
      const plain = TAG_OUTLINE.width(fontSize, false);
      const selected = TAG_OUTLINE.width(fontSize, true);
      // Fatter than the hairline this replaced, at every size.
      expect(plain).toBeGreaterThan(1.5);
      expect(selected).toBeGreaterThan(plain);
    }
  });

  test('the unowned outline is a desaturated grey, so colour only means ownership', () => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(TAG_OUTLINE.unowned.slice(i, i + 2), 16));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(16);
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

  test('a negative invulnerability level wears the drawn hazard mark', () => {
    const idsEl: Record<string, unknown> = {};
    const container = {
      innerHTML: '',
      querySelector: (sel: string) => (sel === '[data-unit-ids]' ? idsEl : null),
    };
    const vulnerable = { ...snake, invulnerabilityLevel: -2 };
    BoardRenderer.renderSnakeInfo(
      container, { turn: 7, board: { snakes: [vulnerable] } }, vulnerable.id);
    expect(container.innerHTML).toContain(BoardRenderer.hazardIconSVG(13));
    expect(container.innerHTML).not.toContain(BoardRenderer.STAT_ICON.invulnerable);
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
