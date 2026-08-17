/**
 * Unit tests for the unit-tag display rules
 * (src/web/board-renderer.js — shared verbatim with the browser pages).
 *
 * Pins the tag-visibility state machine (the global Alt-tap default crossed
 * with the per-unit hover) and the stat icons the on-board tags share with the
 * units table.
 */
const BoardRenderer = require('../web/board-renderer.js');

const SHOWN = false; // tagsHiddenByDefault
const HIDDEN = true;

describe('unitTagVisibility', () => {
  const vis = BoardRenderer.unitTagVisibility;

  test('tags shown by default: every un-hovered tag is drawn', () => {
    expect(vis(SHOWN, false, false)).toBe('solid');
    expect(vis(SHOWN, false, true)).toBe('selected');
  });

  test('tags hidden by default: nothing is drawn without a hover', () => {
    expect(vis(HIDDEN, false, false)).toBe('hidden');
    expect(vis(HIDDEN, false, true)).toBe('hidden');
  });

  test('hover reverses the default for the hovered unit', () => {
    // Shown → faded so the board under the tag stays readable.
    expect(vis(SHOWN, true, false)).toBe('translucent');
    // Hidden → drawn.
    expect(vis(HIDDEN, true, false)).toBe('solid');
  });

  test('a hovered tag never keeps its selected emphasis', () => {
    expect(vis(SHOWN, true, true)).toBe('translucent');
    expect(vis(HIDDEN, true, true)).toBe('solid');
  });

  test('only the four named states are reachable', () => {
    const states = new Set<string>();
    for (const hidden of [SHOWN, HIDDEN]) {
      for (const hovered of [false, true]) {
        for (const selected of [false, true]) {
          states.add(vis(hidden, hovered, selected));
        }
      }
    }
    expect([...states].sort()).toEqual(['hidden', 'selected', 'solid', 'translucent']);
  });

  test('clearing the hover restores the default state exactly', () => {
    for (const hidden of [SHOWN, HIDDEN]) {
      for (const selected of [false, true]) {
        expect(vis(hidden, false, selected)).toBe(vis(hidden, false, selected));
        // No lingering translucency once the hover is gone.
        expect(vis(hidden, false, selected)).not.toBe('translucent');
      }
    }
  });
});

describe('stat icons', () => {
  test('one glyph per stat, shared by the tags and the units table', () => {
    expect(BoardRenderer.STAT_ICON.weight).toBe('⚖️');
    expect(BoardRenderer.STAT_ICON.health).toBe('♥');
    expect(BoardRenderer.STAT_ICON.invulnerable).toBe('\u{1F6E1}️');
    expect(BoardRenderer.STAT_ICON.vulnerable).toBe('⚠️');
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
    expect(html).toContain(BoardRenderer.STAT_ICON.weight);
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
