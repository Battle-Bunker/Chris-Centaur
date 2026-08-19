/**
 * Unit tests for the unit-tag display rules
 * (src/web/board-renderer.js — shared verbatim with the browser pages).
 *
 * Pins the tag-visibility state machine (the three-mode Alt-tap cycle crossed
 * with whose unit it is and where the pointer is on it), the mode gate that
 * decides WHICH pointer input each unit reads, the rule that makes a tag a
 * fallback rather than a default (a unit carrying all its information on its
 * own body never wears one), and the stat icons the on-board tags share with
 * the units table.
 */
const BoardRenderer = require('../web/board-renderer.js');

const { always: ALWAYS, ours: OURS, never: NEVER } = BoardRenderer.TAG_MODE;
const OUR_UNIT = true;
const THEIR_UNIT = false;
const { none: NONE, unit: ON_UNIT, tag: ON_TAG } = BoardRenderer.TAG_HOVER;

describe('the tag display mode cycle', () => {
  const { nextTagMode, normalizeTagMode, TAG_MODE_ORDER, TAG_MODE_LABEL } = BoardRenderer;

  test('Alt taps walk always → ours → never → always', () => {
    expect(nextTagMode(ALWAYS)).toBe(OURS);
    expect(nextTagMode(OURS)).toBe(NEVER);
    expect(nextTagMode(NEVER)).toBe(ALWAYS);
  });

  test('three taps are the identity, from wherever the cycle is entered', () => {
    for (const mode of TAG_MODE_ORDER) {
      expect(nextTagMode(nextTagMode(nextTagMode(mode)))).toBe(mode);
    }
  });

  test('anything unrecognised reads as the mode that hides nothing', () => {
    // A stale preference, a caller that never set one, a value from a future
    // build: none of them may leave the board in an unnamed state.
    for (const junk of [undefined, null, '', 'translucent', '1', true]) {
      expect(normalizeTagMode(junk)).toBe(ALWAYS);
    }
    expect(nextTagMode('nonsense')).toBe(OURS);
  });

  test('every mode can say its own name, for the shortcuts pane', () => {
    for (const mode of TAG_MODE_ORDER) {
      expect(typeof TAG_MODE_LABEL[mode]).toBe('string');
      expect(TAG_MODE_LABEL[mode].length).toBeGreaterThan(0);
    }
    expect(new Set(Object.values(TAG_MODE_LABEL)).size).toBe(TAG_MODE_ORDER.length);
  });

  test('the middle mode is the ONLY one that asks whose unit it is', () => {
    const { tagsHiddenFor } = BoardRenderer;
    expect(tagsHiddenFor(ALWAYS, OUR_UNIT)).toBe(false);
    expect(tagsHiddenFor(ALWAYS, THEIR_UNIT)).toBe(false);
    expect(tagsHiddenFor(NEVER, OUR_UNIT)).toBe(true);
    expect(tagsHiddenFor(NEVER, THEIR_UNIT)).toBe(true);
    expect(tagsHiddenFor(OURS, OUR_UNIT)).toBe(false);
    expect(tagsHiddenFor(OURS, THEIR_UNIT)).toBe(true);
  });
});

describe('unitTagVisibility', () => {
  const vis = BoardRenderer.unitTagVisibility;

  test('always: every un-hovered tag is drawn, ours or theirs', () => {
    for (const ours of [OUR_UNIT, THEIR_UNIT]) {
      expect(vis(ALWAYS, ours, NONE, false)).toBe('solid');
      expect(vis(ALWAYS, ours, NONE, true)).toBe('selected');
    }
  });

  test('never: nothing is drawn without a hover, ours or theirs', () => {
    for (const ours of [OUR_UNIT, THEIR_UNIT]) {
      expect(vis(NEVER, ours, NONE, false)).toBe('hidden');
      expect(vis(NEVER, ours, NONE, true)).toBe('hidden');
    }
  });

  test('ours: our team is up by default, everyone else waits to be asked', () => {
    expect(vis(OURS, OUR_UNIT, NONE, false)).toBe('solid');
    expect(vis(OURS, OUR_UNIT, NONE, true)).toBe('selected');
    expect(vis(OURS, THEIR_UNIT, NONE, false)).toBe('hidden');
    expect(vis(OURS, THEIR_UNIT, NONE, true)).toBe('hidden');
  });

  test('hovering a unit calls its tag up, whatever the mode says', () => {
    for (const mode of BoardRenderer.TAG_MODE_ORDER) {
      for (const ours of [OUR_UNIT, THEIR_UNIT]) {
        expect(vis(mode, ours, ON_UNIT, false)).toBe('solid');
        // Hover outranks selection: one hovered tag, one appearance.
        expect(vis(mode, ours, ON_UNIT, true)).toBe('solid');
      }
    }
  });

  test('the pointer on a tag hides that tag, so what it covers can be read', () => {
    for (const mode of BoardRenderer.TAG_MODE_ORDER) {
      for (const ours of [OUR_UNIT, THEIR_UNIT]) {
        for (const selected of [false, true]) {
          expect(vis(mode, ours, ON_TAG, selected)).toBe('hidden');
        }
      }
    }
  });

  test('only the three named states are reachable', () => {
    const states = new Set<string>();
    for (const mode of BoardRenderer.TAG_MODE_ORDER) {
      for (const ours of [OUR_UNIT, THEIR_UNIT]) {
        for (const hover of [NONE, ON_UNIT, ON_TAG]) {
          for (const selected of [false, true]) {
            states.add(vis(mode, ours, hover, selected));
          }
        }
      }
    }
    expect([...states].sort()).toEqual(['hidden', 'selected', 'solid']);
  });

  test('clearing the hover restores the default state exactly', () => {
    for (const mode of BoardRenderer.TAG_MODE_ORDER) {
      for (const ours of [OUR_UNIT, THEIR_UNIT]) {
        for (const selected of [false, true]) {
          // Whatever the pointer did on the way through, letting go of it
          // lands back on the state the mode alone dictates.
          const hidden = BoardRenderer.tagsHiddenFor(mode, ours);
          const dflt = hidden ? 'hidden' : selected ? 'selected' : 'solid';
          expect(vis(mode, ours, NONE, selected)).toBe(dflt);
          vis(mode, ours, ON_UNIT, selected);
          vis(mode, ours, ON_TAG, selected);
          expect(vis(mode, ours, NONE, selected)).toBe(dflt);
        }
      }
    }
  });

  test('an unknown hover value is treated as no hover, never as a new state', () => {
    expect(vis(ALWAYS, OUR_UNIT, 'wat', false)).toBe('solid');
    expect(vis(NEVER, OUR_UNIT, 'wat', false)).toBe('hidden');
  });
});

// Which pointer input a tag reads depends on whether that unit's tag is up by
// default, and that gate — not a latch — is what keeps the rule from fighting
// itself. The caller (play-game.html syncHover) tracks BOTH inputs and lets
// the gate pick per unit, which is the only thing that can work in "ours"
// mode: both defaults are live on one board at once.
describe('tagHoverState + syncHover (the caller\'s half of the rule)', () => {
  const gate = BoardRenderer.tagHoverState;
  const vis = BoardRenderer.unitTagVisibility;

  // The caller: one pointer position in (the unit whose BODY it is over, and
  // the unit whose TAG rect it is over), both tracked, both handed on.
  function syncHover(overBody: string | null, overTag: string | null) {
    return { hoveredUnitId: overBody, tagHoverUnitId: overTag };
  }
  function state(
    mode: string,
    ours: boolean,
    hover: { hoveredUnitId: string | null; tagHoverUnitId: string | null },
    id: string,
    selected = false,
  ) {
    return vis(
      mode,
      ours,
      gate(mode, ours, hover.hoveredUnitId === id, hover.tagHoverUnitId === id),
      selected,
    );
  }

  test('tag down: hovering any body cell shows it, leaving hides it again', () => {
    expect(state(NEVER, OUR_UNIT, syncHover(null, null), 'a')).toBe('hidden');
    // Body cell — head or any other segment, the caller reports the same id.
    expect(state(NEVER, OUR_UNIT, syncHover('a', null), 'a')).toBe('solid');
    // Pointer off the unit again.
    expect(state(NEVER, OUR_UNIT, syncHover(null, null), 'a')).toBe('hidden');
  });

  test('tag down: a tag drawn over its own unit\'s body cannot hide itself', () => {
    // THE BUG: the tag lands on cells the unit's body occupies, so the pointer
    // is on the body AND inside the tag's published rect at the same time. In
    // this mode the rect says nothing, so the tag stays up instead of
    // switching itself off the frame after it appeared.
    const hover = syncHover('a', 'a');
    expect(gate(NEVER, OUR_UNIT, true, true)).toBe(ON_UNIT);
    expect(state(NEVER, OUR_UNIT, hover, 'a')).toBe('solid');
    // And it settles: replaying the same position never changes the state.
    for (let i = 0; i < 5; i++) {
      expect(state(NEVER, OUR_UNIT, syncHover('a', 'a'), 'a')).toBe('solid');
    }
  });

  test('tag down: only the hovered unit\'s tag comes up', () => {
    const hover = syncHover('a', null);
    expect(state(NEVER, OUR_UNIT, hover, 'a')).toBe('solid');
    expect(state(NEVER, OUR_UNIT, hover, 'b')).toBe('hidden');
  });

  test('tag up: body hover is not read at all', () => {
    const hover = syncHover('a', null);
    expect(gate(ALWAYS, OUR_UNIT, true, false)).toBe(NONE);
    expect(state(ALWAYS, OUR_UNIT, hover, 'a')).toBe('solid'); // the default
    expect(state(ALWAYS, OUR_UNIT, hover, 'a', true)).toBe('selected');
  });

  test('tag up: resting on it steps it aside, leaving it brings it back', () => {
    expect(state(ALWAYS, OUR_UNIT, syncHover(null, 'a'), 'a')).toBe('hidden');
    // The rect keeps being published while hidden, so a still pointer settles.
    for (let i = 0; i < 5; i++) {
      expect(state(ALWAYS, OUR_UNIT, syncHover(null, 'a'), 'a')).toBe('hidden');
    }
    expect(state(ALWAYS, OUR_UNIT, syncHover(null, null), 'a')).toBe('solid');
  });

  test('tag up: one unit\'s stepped-aside tag never suppresses another\'s', () => {
    const hover = syncHover('b', 'a');
    expect(state(ALWAYS, OUR_UNIT, hover, 'a')).toBe('hidden');
    expect(state(ALWAYS, OUR_UNIT, hover, 'b')).toBe('solid');
  });

  test('ours mode: the two gates run side by side on one board', () => {
    // Our unit's tag is up, so its own rect is its switch; a foreign unit's
    // is down, so its body is. One pointer, one position, two behaviours —
    // which is exactly why the choice is made per unit.
    const onOurTag = syncHover('mine', 'mine');
    expect(state(OURS, OUR_UNIT, onOurTag, 'mine')).toBe('hidden');
    const onTheirBody = syncHover('yours', null);
    expect(state(OURS, THEIR_UNIT, onTheirBody, 'yours')).toBe('solid');
    // And neither reaches across: an untouched foreign unit stays down.
    expect(state(OURS, THEIR_UNIT, onOurTag, 'other')).toBe('hidden');
  });

  test('the gate never reports the input its unit\'s default does not own', () => {
    expect(gate(NEVER, OUR_UNIT, false, true)).toBe(NONE);
    expect(gate(NEVER, OUR_UNIT, true, true)).toBe(ON_UNIT);
    expect(gate(ALWAYS, OUR_UNIT, true, false)).toBe(NONE);
    expect(gate(ALWAYS, OUR_UNIT, true, true)).toBe(ON_TAG);
    // Ours mode splits the two along team lines.
    expect(gate(OURS, THEIR_UNIT, true, true)).toBe(ON_UNIT);
    expect(gate(OURS, OUR_UNIT, true, true)).toBe(ON_TAG);
  });
});

// The tag is the FALLBACK, not the default: what a unit can spell out on its
// own body it never wears a tag for. The plan is the single answer to both
// halves of that — what each body cell draws, and whether anything was left
// over — so the board and its tags cannot disagree.
describe('unitBodyInfoPlan (what the body carries, and what is left over)', () => {
  const plan = BoardRenderer.unitBodyInfoPlan;
  const CELL = 50;
  const HEIGHT = 12;

  // A canvas context stub good enough to measure with: text width is
  // proportional to the font size the caller set, which is the only property
  // the fit maths depends on.
  function ctxStub() {
    return {
      font: '',
      measureText(text: string) {
        const m = /(\d+(?:\.\d+)?)px/.exec(this.font as string);
        const size = m ? parseFloat(m[1]) : 10;
        return { width: String(text).length * size * 0.56 };
      },
      save() {}, restore() {},
    };
  }

  function snake(over: Record<string, unknown> = {}) {
    return {
      id: 'u', letter: 'A', health: 88, maxHealth: 100,
      color: '#156cdd',
      body: [{ x: 1, y: 9 }, { x: 1, y: 8 }, { x: 1, y: 7 }],
      ...over,
    };
  }
  function keysOf(p: { placements: { item: { key: string } }[] }) {
    return p.placements.map((pl) => pl.item.key);
  }
  function run(unit: Record<string, unknown>, opts: Record<string, unknown> = {}) {
    return plan(ctxStub(), unit, HEIGHT, CELL, opts);
  }

  test('a snake long enough for every applicable item wears NO tag', () => {
    const p = run(snake());
    expect(keysOf(p)).toEqual(['letter', 'weight', 'health']);
    expect(p.tagWarranted).toBe(false);
  });

  test('items fill head → tail, and what does not fit is what warrants a tag', () => {
    // Two cells: the letter and the weight land, the health does not.
    const p = run(snake({ body: [{ x: 1, y: 9 }, { x: 1, y: 8 }] }));
    expect(keysOf(p)).toEqual(['letter', 'weight']);
    expect(p.tagWarranted).toBe(true);
  });

  test('a one-cell snake carries its letter and warrants a tag for the rest', () => {
    const p = run(snake({ body: [{ x: 1, y: 9 }] }));
    expect(keysOf(p)).toEqual(['letter']);
    expect(p.tagWarranted).toBe(true);
  });

  test('the buff cell counts the TURNS left, and says nothing of the level', () => {
    // The level is what the body's outline colour is for; repeating it here
    // would spend a cell saying what one glance already says.
    const p = run(
      snake({
        body: [{ x: 1, y: 9 }, { x: 1, y: 8 }, { x: 1, y: 7 }, { x: 1, y: 6 }],
        invulnerabilityLevel: 2,
        invulnerabilityExpiryTurn: 28,
      }),
      { turn: 25 },
    );
    expect(keysOf(p)).toEqual(['letter', 'weight', 'health', 'invulnerable']);
    expect(p.tagWarranted).toBe(false);
    const buff = p.placements[3];
    expect(buff.item.text).toBe('4');
    // One reading only: a bare integer, with the shield when it fits.
    expect(buff.item.shortText).toBeUndefined();
    expect(buff.item.icon).toBe(BoardRenderer.STAT_ICON.invulnerable);
  });

  test('a negative buff counts its turns behind the hazard mark, not a level', () => {
    const p = run(
      snake({
        body: [{ x: 1, y: 9 }, { x: 1, y: 8 }, { x: 1, y: 7 }, { x: 1, y: 6 }],
        invulnerabilityLevel: -1,
        invulnerabilityExpiryTurn: 30,
      }),
      { turn: 25 },
    );
    expect(p.placements[3].item.text).toBe('6');
    expect(p.placements[3].item.mark).toBe('hazard');
  });

  test('with no expiry on the wire the buff has no count, so it writes nothing', () => {
    // A historic row carries a level but no expiry: there is no countdown to
    // write, and the outline colour still says the unit is buffed — so the
    // body simply has no buff item, and nothing was dropped to warrant a tag.
    const p = run(
      snake({
        body: [{ x: 1, y: 9 }, { x: 1, y: 8 }, { x: 1, y: 7 }, { x: 1, y: 6 }],
        invulnerabilityLevel: -1,
      }),
      { turn: 25 },
    );
    expect(keysOf(p)).toEqual(['letter', 'weight', 'health']);
    expect(p.tagWarranted).toBe(false);
  });

  test('the tail stack OUTRANKS the flow: its cell is reserved first', () => {
    // Four distinct cells, a tail carrying three parts, and a buff: the tail
    // takes the last cell, so the buff is the item pushed off the body.
    const p = run(
      snake({
        body: [
          { x: 1, y: 9 }, { x: 1, y: 8 }, { x: 1, y: 7 },
          { x: 1, y: 6 }, { x: 1, y: 6 }, { x: 1, y: 6 },
        ],
        invulnerabilityLevel: 1,
        invulnerabilityExpiryTurn: 29,
      }),
      { turn: 25 },
    );
    expect(keysOf(p)).toEqual(['letter', 'weight', 'health', 'stack']);
    expect(p.placements[3].item.text).toBe('×3');
    expect(p.tagWarranted).toBe(true);
  });

  test('an unstacked tail reserves nothing, so the flow runs to the end', () => {
    const p = run(
      snake({
        body: [{ x: 1, y: 9 }, { x: 1, y: 8 }, { x: 1, y: 7 }, { x: 1, y: 6 }],
        invulnerabilityLevel: 1,
        invulnerabilityExpiryTurn: 29,
      }),
      { turn: 25 },
    );
    expect(keysOf(p)).toEqual(['letter', 'weight', 'health', 'invulnerable']);
    expect(p.tagWarranted).toBe(false);
  });

  test('every item is drawn on the SAME square, the head letter included', () => {
    // One plate size for the whole run: a body reads as a column of identical
    // squares, not as pills each as wide as the number it happens to carry.
    const p = run(
      snake({
        body: [{ x: 1, y: 9 }, { x: 1, y: 8 }, { x: 1, y: 7 }, { x: 1, y: 6 }],
        health: 100,
        invulnerabilityLevel: 2,
        invulnerabilityExpiryTurn: 28,
      }),
      { turn: 25 },
    );
    expect(keysOf(p)).toEqual(['letter', 'weight', 'health', 'invulnerable']);
    const boxes = p.placements.map((pl: { box: { x: number; y: number; w: number; h: number } }) => pl.box);
    for (const box of boxes) {
      expect(box.w).toBeCloseTo(boxes[0].w, 6);
      expect(box.h).toBeCloseTo(box.w, 6); // square, never a band
      // Centred in its cell, and inside the body's own thickness so the
      // unit's colour still shows all the way round the plate.
      expect(((box.x % CELL) + CELL) % CELL).toBeCloseTo((CELL - box.w) / 2, 6);
      expect(((box.y % CELL) + CELL) % CELL).toBeCloseTo((CELL - box.h) / 2, 6);
      expect(box.w).toBeLessThan(CELL - BoardRenderer.getSnakeGap(CELL) * 2);
    }
  });

  test('overlapping body cells count once — one cell, one item', () => {
    // The body doubles back over the cell it came from; the screen shows two
    // cells, so it carries two items and the third is left over.
    const p = run(
      snake({ body: [{ x: 1, y: 9 }, { x: 1, y: 8 }, { x: 1, y: 9 }] }),
    );
    expect(BoardRenderer.distinctBodyCells(
      [{ x: 1, y: 9 }, { x: 1, y: 8 }, { x: 1, y: 9 }],
    )).toHaveLength(2);
    expect(keysOf(p)).toEqual(['letter', 'weight']);
    expect(p.tagWarranted).toBe(true);
  });

  test('the letter square wears the OPERATOR\'s colour, or the unit\'s own', () => {
    const owned = run(snake(), { owner: { name: 'ada', color: '#7b4fd8' } });
    expect(owned.placements[0].item.fill).toBe('#7b4fd8');
    expect(run(snake()).placements[0].item.fill).toBe('#156cdd');
  });

  test('weight is the unit-generic stat, not the body\'s cell count', () => {
    // A snake still growing into what it ate is longer than it looks.
    const p = run(snake({ length: 7 }));
    expect(p.placements[1].item.text).toBe('7');
  });

  test('a piece has no body to write on: icon on the cell, tag as ever', () => {
    const p = run(snake({ unitType: 'rook', body: [{ x: 1, y: 9 }] }));
    expect(p.placements).toHaveLength(0);
    expect(p.tagWarranted).toBe(true);
  });

  test('cells too small to be read in drop everything, and the tag says it', () => {
    const p = plan(ctxStub(), snake(), HEIGHT, 12, {});
    expect(p.placements).toHaveLength(0);
    expect(p.tagWarranted).toBe(true);
  });

  test('a health-less historic row simply has no health item to place', () => {
    const p = run(snake({ health: undefined }));
    expect(keysOf(p)).toEqual(['letter', 'weight']);
    expect(p.tagWarranted).toBe(false);
  });
});

describe('tail stacking', () => {
  const { tailStackCount } = BoardRenderer;

  test('counts only the trailing run that shares the tail cell', () => {
    expect(tailStackCount([{ x: 1, y: 1 }])).toBe(1);
    expect(tailStackCount([{ x: 1, y: 1 }, { x: 1, y: 0 }])).toBe(1);
    expect(tailStackCount([{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 0 }])).toBe(2);
    expect(tailStackCount([
      { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 },
    ])).toBe(3);
    // A cell revisited EARLIER in the body is not a stacked tail.
    expect(tailStackCount([
      { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 },
    ])).toBe(1);
  });
});

describe('invulnerability countdown', () => {
  const { invulnerabilityTurnsRemaining: left } = BoardRenderer;

  test('counts the current turn in, and stops at the expiry turn', () => {
    expect(left({ invulnerabilityExpiryTurn: 28 }, 25)).toBe(4);
    expect(left({ invulnerabilityExpiryTurn: 25 }, 25)).toBe(1);
    expect(left({ invulnerabilityExpiryTurn: 24 }, 25)).toBeNull();
  });

  test('no expiry on the wire, and no turn to measure against, mean no count', () => {
    expect(left({}, 25)).toBeNull();
    expect(left({ invulnerabilityExpiryTurn: 28 }, undefined)).toBeNull();
    expect(left(null, 25)).toBeNull();
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

  // The table's input is delegated to the container, so even the plain
  // (ungrouped) render needs a container that can carry a listener.
  function makeTableContainer() {
    return { innerHTML: '', addEventListener: () => {} };
  }

  function render(unit = snake) {
    const container = makeTableContainer();
    BoardRenderer.renderSnakeInfo(container, { turn: 7, board: { snakes: [unit] } }, unit.id);
    return container.innerHTML as string;
  }

  test('rows show the shared stat icons', () => {
    const html = render();
    expect(html).toContain(snake.name);
    // Weight rides the same anvil path the on-board tags draw.
    expect(html).toContain(BoardRenderer.anvilIconSVG(13));
    expect(html).toContain(BoardRenderer.STAT_ICON.health);
    expect(html).toContain(BoardRenderer.STAT_ICON.invulnerable);
  });

  test('a negative invulnerability level wears the drawn hazard mark', () => {
    const html = render({ ...snake, invulnerabilityLevel: -2 });
    expect(html).toContain(BoardRenderer.hazardIconSVG(13));
    expect(html).not.toContain(BoardRenderer.STAT_ICON.invulnerable);
  });

  test('every row carries its OWN unit id, on hover and on a copy control', () => {
    const html = render();
    expect(html).toContain(`data-copy-id="${snake.id}"`);
    // Hover readout: the id is the control's title, so it needs no click to be
    // read and no second surface to be shown in.
    expect(html).toContain(`title="${snake.id}`);
  });

  test('the corner (i) id list is gone — ids belong on the rows they name', () => {
    expect(render()).not.toContain('data-unit-ids');
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
