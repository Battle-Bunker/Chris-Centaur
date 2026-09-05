/**
 * THE INFORMATION ARCHITECTURE, HELD BY ASSERTION.
 *
 * `docs/design/ux/02-IA-AND-CONTROLS.md` makes claims that are cheap to state
 * and easy to break silently, because every one of them is about a *shape* the
 * operator reads in under a second rather than about a number anything else
 * checks. Screenshots cannot hold them: a walkthrough photograph of a stage
 * line that says the wrong sentence looks exactly like one that says the right
 * one. So each claim gets a falsifier here.
 *
 * The five that matter, and the specific regression each one catches:
 *
 *  · THE STAGE LINE IS ON THE TRANSCRIPT (§2.2). It is `panel.stage`, not a
 *    thing the page computes, so a replayed turn says the same sentence off
 *    the log as off the wire. The falsifier is somebody moving it into
 *    `play-game.html` for convenience, where replay would quietly lose it.
 *  · IT IS NEVER THE FIRST LEGAL CANDIDATE (§2.2). Where nothing is staged the
 *    line reads the rank-1 moveset's assignment — the incumbent the board
 *    already draws in violet. A first legal candidate is a guess wearing a
 *    plan's clothes, and this line is read by someone with no time to doubt it.
 *  · A COUNT THAT CANNOT BE TAKEN IS NOT PRINTED AS ZERO (§1.4 rule 3). The
 *    business strip has no `fatal` segment, and a segment that would be zero
 *    is absent rather than drawn.
 *  · NOTHING IS ENCODED BY HUE ALONE (§2.5). Rank 1 and the foil are the two
 *    rows the whole L2 layer is built on and they are separated by `▸`/`◇`,
 *    a word, and a border STYLE before any colour is spent.
 *  · THE THREE SCHEMES ARE THREE SPELLINGS OF ONE ACTION SET (§3.1), with no
 *    chord in the hot path and no collision with the shipped move schema. The
 *    falsifier is a fourth scheme, or a new binding, that quietly takes `w` or
 *    `Tab` away from the board.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { renderFrame, initialCursor, applyCursorEvent, stageSummary } from '../lens/view';
import type { CursorEvent, LensCursor, LensFrame, Moveset, UnitKey } from '../lens/types';
import { clusterView, lensFrame, moveset, unitKeysOf, SINGLETONS } from './lens-fixtures';

const LensPanel = require('../web/lens-panel.js');

const [C, Q] = unitKeysOf(SINGLETONS) as [UnitKey, UnitKey];

/** The cluster's own RETAINED reservoir list — keyed by the cluster id, which
 *  is what `stageSummary` reads for the incumbent, and deliberately not the
 *  `cluster|unit|cell` conditional list a cursor selects over. */
const RETAINED = '0';

/**
 * A frame where the plan and the first legal candidate DISAGREE, which is the
 * only shape that can tell the two apart: C's first legal candidate is cell
 * 10, and rank 1 assigns it cell 21.
 */
function planned(over: Partial<LensFrame> = {}): LensFrame {
  const rows: ReadonlyArray<Moveset> = [
    {
      ...moveset({ key: 'r1', rank: 1, lo: 12.4, est: 12.9, hi: 15.3, units: [C, Q] }),
      moves: [
        { unit: C, to: 21, path: [21] },
        { unit: Q, to: 22, path: [22] },
      ],
    },
    {
      ...moveset({ key: 'r2', rank: 2, lo: 11.7, est: 12.0, hi: 15.8, units: [C, Q] }),
      moves: [
        { unit: C, to: 31, path: [31] },
        { unit: Q, to: 32, path: [32] },
      ],
    },
  ];
  return lensFrame({
    partition: [clusterView({ id: 0, members: [C, Q] })],
    candidates: {
      [C]: [
        { key: 'c10', to: 10, path: [10], legal: true, conditionalBest: null, disposition: null },
        { key: 'c21', to: 21, path: [21], legal: true, conditionalBest: null, disposition: null },
      ],
      [Q]: [
        { key: 'q12', to: 12, path: [12], legal: true, conditionalBest: null, disposition: null },
        { key: 'q22', to: 22, path: [22], legal: true, conditionalBest: null, disposition: null },
      ],
    },
    movesets: { [RETAINED]: rows },
    staged: {},
    ...over,
  });
}

function cursorAt(f: LensFrame, events: ReadonlyArray<CursorEvent>): LensCursor {
  return events.reduce<LensCursor>((c, e) => applyCursorEvent(c, f, e), initialCursor());
}

const argsOf = (transcript: ReadonlyArray<{ op: string; args: unknown[] }>, op: string): unknown[] =>
  (transcript.find((c) => c.op === op)?.args ?? []) as unknown[];

// ---------------------------------------------------------------------------

describe('L1 — the stage line answers "what is the bot about to do"', () => {
  test('it is a draw call on the transcript, not something the page computes', () => {
    const t = renderFrame(planned()) as ReadonlyArray<{ op: string; args: unknown[] }>;
    expect(t.some((c) => c.op === 'panel.stage')).toBe(true);
    // And it is there with NO unit focused: both L1 questions are asked every
    // turn whether or not the operator has clicked anything, which is exactly
    // what the shipped rail's "click one, or Tab" failed to answer.
    expect((argsOf(t, 'panel.stage')[0] as unknown[]).length).toBe(2);
  });

  test('where nothing is staged it reads the rank-1 assignment, never the first legal candidate', () => {
    const rows = stageSummary(planned());
    const c = rows.find((r) => r.unit === C);
    // 10 is C's first legal candidate. 21 is what rank 1 would actually do.
    expect(c).toMatchObject({ to: 21, source: 'plan' });
    expect(c?.to).not.toBe(10);
    expect(rows.find((r) => r.unit === Q)).toMatchObject({ to: 22, source: 'plan' });
  });

  test('a staged move outranks the plan, and says which it is', () => {
    const rows = stageSummary(planned({ staged: { [C]: { to: 10 } } }));
    expect(rows.find((r) => r.unit === C)).toMatchObject({ to: 10, source: 'staged' });
    // The other member is untouched: one staged move does not restate the rest.
    expect(rows.find((r) => r.unit === Q)).toMatchObject({ to: 22, source: 'plan' });
  });

  test('a unit with neither a staged move nor a plan says so rather than guessing', () => {
    const rows = stageSummary(planned({ movesets: {} }));
    expect(rows.every((r) => r.to === null && r.source === 'none')).toBe(true);
  });

  test('a bounded unit is on the line with its fixity verb, and is not a member', () => {
    const f = planned({
      partition: [
        clusterView({
          id: 0,
          members: [C],
          boundedBy: [{ unit: Q, to: 30, why: 'pin', by: 'ada' }],
        }),
      ],
    });
    const rows = stageSummary(f);
    expect(rows.find((r) => r.unit === C)?.fixity).toBe('free');
    // THE PIN IS THE ANSWER FOR A PINNED UNIT, and the retained rows are not.
    // Rank 1 still assigns Q cell 22 — it was priced before the determination
    // and the reservoir is not rewritten by one — so reading the plan here
    // printed `Q → 22 pinned`: a contradiction in a single clause, on the line
    // the operator reads fastest and doubts least.
    expect(rows.find((r) => r.unit === Q)).toMatchObject({
      fixity: 'pinned',
      to: 30,
      source: 'staged',
      by: 'ada',
    });
  });
});

describe('L1 — the unfinished-business strip counts only what the page can know', () => {
  const strip = (f: LensFrame): string => LensPanel.stageHTML(renderFrame(f), null);

  test('every unit is counted once and the segments name themselves with a glyph', () => {
    const html = strip(planned({ staged: { [C]: { to: 10 } } }));
    expect(html).toContain('2 units');
    expect(html).toContain('● 1 staged');
    expect(html).toContain('~ 1 planned');
  });

  test('a segment that would be zero is absent, not drawn as 0', () => {
    const html = strip(planned());
    expect(html).toContain('~ 2 planned');
    expect(html).not.toContain('0 staged');
    expect(html).not.toContain('◦ 0');
  });

  test('there is no fatal segment at all — fatality is not knowable from here', () => {
    for (const f of [planned(), planned({ movesets: {} }), planned({ staged: { [C]: { to: 10 } } })]) {
      expect(strip(f)).not.toContain('fatal');
    }
  });

  test('a unit with no plan is the one segment that is coloured, and it carries ◦ too', () => {
    const html = strip(planned({ movesets: {} }));
    expect(html).toContain('◦ 2 no plan');
    expect(html).toContain('lens-biz-open');
  });

  test('with no cluster at all the line says nothing is staged rather than drawing an empty strip', () => {
    expect(strip(planned({ partition: [] }))).toContain('nothing is staged yet');
  });
});

describe('L2 — the two rows that matter are separated before any colour is spent', () => {
  /** Rank 1 staged, rank 2 the foil, rank 3 walked past. */
  function table(): LensFrame {
    const rows: ReadonlyArray<Moveset> = [
      moveset({ key: 't1', rank: 1, lo: 12.4, est: 12.9, hi: 15.3, units: [C], staged: true }),
      moveset({ key: 't2', rank: 2, lo: 11.7, est: 12.0, hi: 15.8, units: [C] }),
      moveset({ key: 't3', rank: 3, lo: 11.1, est: 11.4, hi: 12.3, units: [C] }),
    ];
    return lensFrame({
      partition: [clusterView({ id: 0, members: [C] })],
      movesets: { [`0|${C}|10`]: rows, [RETAINED]: rows },
      staged: { [C]: { to: 10 } },
    });
  }

  test('rank 1 and the foil carry a glyph and a word, and the foil is not behind a key', () => {
    const f = table();
    const html = LensPanel.movesetsHTML(renderFrame(f, cursorAt(f, [{ t: 'focus', unit: C }])));
    // `▸ would be staged` and `◇ foil` — a deuteranope reading this table
    // loses the tint and nothing else.
    expect(html).toContain('▸');
    expect(html).toContain('would be staged');
    expect(html).toContain('◇');
    expect(html).toContain('foil');
    // Drawn at full size with NO foil cursor event: the runner-up is on the
    // surface without asking, which is the whole of §1.3's F-5.
    expect(html).toContain('lens-row-foil');
  });

  test('the two full-size rows are exactly two, however long the list is', () => {
    const f = table();
    const html: string = LensPanel.movesetsHTML(
      renderFrame(f, cursorAt(f, [{ t: 'focus', unit: C }]))
    );
    expect(html.match(/lens-row-lead/g)?.length).toBe(1);
    expect(html.match(/lens-row-foil/g)?.length).toBe(1);
  });
});

describe('§3.1 — three schemes, one action set', () => {
  const schemes: string[] = LensPanel.schemeNames();
  /** The eight the cheat strip prints: what an operator's hand does inside a
   *  turn. `drill.all` and `lock.moveset` are deliberately outside it. */
  const HOT = [
    'moveset.prev',
    'moveset.next',
    'foil',
    'drill',
    'timeline.prev',
    'timeline.next',
    'now',
    'release',
  ];
  /**
   * WHAT THE BOARD OWNS AND THE RAIL MAY NOT TAKE. Read off `play-game.html`'s
   * own keydown handler: the numpad move schema, the arrow pad and its WASD
   * aliases, hold, submit, cycle, clear and cancel. A scheme that binds one of
   * these steers the board instead of the rail, and the lens claims its keys
   * BEFORE the board does — so the collision is silent and total.
   */
  const RESERVED = new Set([
    'tab', 'escape', 'delete', 'enter', 'h', ' ',
    'w', 'a', 's', 'd',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
    '1', '2', '3', '4', '5', '6', '7', '8', '9',
  ]);

  test('there are three of them and bracket, the shipped schema, is the default', () => {
    expect(schemes).toEqual(['bracket', 'vim', 'lefthand']);
    expect(LensPanel.activeScheme()).toBe('bracket');
    // Binding for binding what it always was: nothing an operator has already
    // learned is re-taught.
    const bracket = LensPanel.keymapFor('bracket');
    for (const [action, key] of [
      ['moveset.prev', '['], ['moveset.next', ']'], ['foil', 'f'],
      ['drill', 'b'], ['now', 'n'], ['release', 'u'],
    ] as const) {
      expect(bracket.find((b: { action: string }) => b.action === action).display).toBe(key);
    }
  });

  test('every scheme spells the same action set', () => {
    // A SET, not a list: `Home` and `End` stay bound in every scheme even
    // where the scheme has its own `g`/`G` for the same two places, because
    // they are the keyboard's own names for the ends of a timeline. Two keys
    // for one action is a scheme being generous; a MISSING action is a scheme
    // that cannot do something another one can, and that is what this catches.
    const actions = (name: string): string[] =>
      [...new Set<string>(LensPanel.keymapFor(name).map((b: { action: string }) => b.action))].sort();
    for (const name of schemes) expect(actions(name)).toEqual(actions('bracket'));
  });

  test('no chord in the hot path, in any scheme', () => {
    for (const name of schemes) {
      const map = LensPanel.keymapFor(name);
      for (const action of HOT) {
        const b = map.find((x: { action: string }) => x.action === action);
        expect(b).toBeDefined();
        expect({ scheme: name, action, shift: !!b.shift }).toEqual({
          scheme: name,
          action,
          shift: false,
        });
      }
    }
  });

  test('no scheme takes a key the board owns', () => {
    for (const name of schemes) {
      for (const b of LensPanel.keymapFor(name)) {
        if (b.action === 'lock.moveset') continue; // Shift+Space, deliberately.
        expect({ scheme: name, action: b.action, key: b.key, taken: RESERVED.has(b.key) }).toEqual({
          scheme: name,
          action: b.action,
          key: b.key,
          taken: false,
        });
      }
    }
  });

  test('no scheme binds one key twice', () => {
    for (const name of schemes) {
      const seen = LensPanel.keymapFor(name).map(
        (b: { key: string; shift: boolean }) => `${b.shift ? 'S+' : ''}${b.key}`
      );
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  test('Home, End and Shift+Space survive every scheme', () => {
    for (const name of schemes) {
      const map = LensPanel.keymapFor(name);
      expect(map.some((b: { key: string }) => b.key === 'home')).toBe(true);
      expect(map.some((b: { key: string }) => b.key === 'end')).toBe(true);
      expect(
        map.some((b: { key: string; shift: boolean }) => b.key === ' ' && b.shift)
      ).toBe(true);
    }
  });
});

describe('§3.1 — the scheme is a spelling, and the press resolves through it', () => {
  afterEach(() => LensPanel.setScheme('bracket'));

  test('the same press means different things under two schemes, and only that', () => {
    expect(LensPanel.keyBinding({ key: 'j' }, 'bracket')).toBeNull();
    expect(LensPanel.keyBinding({ key: 'j' }, 'vim').action).toBe('moveset.next');
    expect(LensPanel.keyBinding({ key: ']' }, 'bracket').action).toBe('moveset.next');
    expect(LensPanel.keyBinding({ key: 'e' }, 'lefthand').action).toBe('moveset.next');
  });

  test('setScheme round-trips and an unknown name falls back rather than unbinding the rail', () => {
    expect(LensPanel.setScheme('vim')).toBe('vim');
    expect(LensPanel.activeScheme()).toBe('vim');
    expect(LensPanel.keyBinding({ key: 'k' }).action).toBe('moveset.prev');
    expect(LensPanel.setScheme('nonsense')).toBe('bracket');
    expect(LensPanel.keyBinding({ key: '[' }).action).toBe('moveset.prev');
  });

  test('a modifier the lens does not own is not the lens’s business', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      expect(LensPanel.keyBinding({ key: 'f', [mod]: true }, 'bracket')).toBeNull();
    }
  });

  /**
   * THE REGRESSION THIS TEST WAS WRITTEN FOR. `Shift+,` is bound as `<` and
   * stored under its bare name `,`; the browser reports the press as `'<'`.
   * A lookup that only lowercases the event key never matched it, so the
   * emission jump was inert from the day it was bound.
   */
  test('a shifted punctuation key resolves under the name the browser gives it', () => {
    const jump = LensPanel.keyBinding({ key: '<', shiftKey: true }, 'bracket');
    expect(jump?.action).toBe('timeline.prevEmission');
    expect(LensPanel.keyBinding({ key: '>', shiftKey: true }, 'vim')?.action).toBe(
      'timeline.nextEmission'
    );
    // And the unshifted key still steps one event, in both schemes.
    expect(LensPanel.keyBinding({ key: ',' }, 'bracket').action).toBe('timeline.prev');
    expect(LensPanel.keyBinding({ key: '.' }, 'vim').action).toBe('timeline.next');
  });
});

describe('§3.2 — the cheat strip and the modal cannot disagree', () => {
  test('every key the strip prints is a binding of the scheme it was asked for', () => {
    for (const name of LensPanel.schemeNames()) {
      const html: string = LensPanel.cheatSheetHTML(name);
      const displays = new Set(
        LensPanel.keymapFor(name).map((b: { display: string }) => b.display)
      );
      const printed = [...html.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]);
      expect(printed.length).toBeGreaterThan(0);
      for (const key of printed) {
        // `Space` and `Ctrl+/` are the two the strip states outright: the
        // determination and the way to the full reference.
        if (key === 'Space' || key === 'Ctrl+/') continue;
        expect({ scheme: name, key, known: displays.has(key) }).toEqual({
          scheme: name,
          key,
          known: true,
        });
      }
    }
  });

  test('switching scheme rewrites the strip', () => {
    expect(LensPanel.cheatSheetHTML('bracket')).toContain('<kbd>[</kbd>');
    expect(LensPanel.cheatSheetHTML('vim')).toContain('<kbd>k</kbd>');
    expect(LensPanel.cheatSheetHTML('vim')).not.toContain('<kbd>[</kbd>');
  });

  test('the page fills the modal from the same table rather than a second list of its own', () => {
    const page = readFileSync(join(__dirname, '..', 'web', 'play-game.html'), 'utf8');
    // The modal's legends are slots, filled from keymapFor. If a future edit
    // hard-codes `[` back into the shortcuts pane, the two drift the moment a
    // scheme changes and nothing else notices.
    expect(page).toContain('data-lens-key');
    expect(page).toContain('LensPanel.keymapFor(LensPanel.activeScheme())');
  });
});

describe('§2.4 — one affordance language: glyph, verb, key, state', () => {
  test('a chip draws its four parts in that order', () => {
    const html: string = LensPanel.chipHTML({
      glyph: '⦿',
      label: 'lock',
      key: 'Space',
      note: 'pins 2 of 3',
      tone: 'primary',
    });
    expect(html.indexOf('⦿')).toBeLessThan(html.indexOf('lock'));
    expect(html.indexOf('lock')).toBeLessThan(html.indexOf('Space'));
    expect(html.indexOf('Space')).toBeLessThan(html.indexOf('pins 2 of 3'));
    expect(html).toContain('lens-aff-primary');
  });

  test('a chip with no key is still a chip, and a clickable one names its action', () => {
    expect(LensPanel.chipHTML({ glyph: '◎', label: 'goto' })).not.toContain('<kbd>');
    expect(LensPanel.chipHTML({ glyph: '↺', label: 'undo', action: 'undo' })).toContain(
      'data-lens-action="undo"'
    );
  });

  test('a chip escapes its own state — the note carries operator names', () => {
    const html: string = LensPanel.chipHTML({ glyph: '↺', label: 'undo', note: '<ada>' });
    expect(html).toContain('&lt;ada&gt;');
    expect(html).not.toContain('<ada>');
  });
});
