/**
 * THE RAIL, END TO END: a frame → the view-model's transcript → the markup and
 * the board ink the page actually draws.
 *
 * `lens-view-model.test.ts` proves the transcript is the same from both
 * sources; this proves the transcript SAYS the things the design says it must,
 * and that the page's driver holds no lens logic of its own to disagree with.
 * Together they are the display contract: the rail and the board are two
 * renderings of one list of draw calls, and neither can drift from the other
 * without this file going red.
 *
 * The three properties worth naming, because each replaces a specific lie the
 * deleted panels told:
 *
 *  · the JOINT RESIDUAL is drawn even at zero. The old per-unit table showed
 *    components that did not add up to the total and said nothing about it;
 *    omitting a zero residual and omitting a large one are the same bug, and
 *    only "always draw the row" catches both.
 *  · an unpriced candidate reads `·`, never a bare number. The old table
 *    printed a score for every candidate whether or not one had been computed.
 *  · the empty state names what HAS happened and at which seq. The old panels
 *    said "no data" — twice, in two different ways, because live and replay
 *    each had their own.
 */

import { renderFrame, initialCursor, applyCursorEvent } from '../lens/view';
import type { CursorEvent, LensCursor, LensFrame, Moveset, UnitKey } from '../lens/types';
import {
  clusterView,
  depthColumn,
  lensAt,
  lensFrame,
  moveset,
  reading,
  unitKeysOf,
  SINGLETONS,
} from './lens-fixtures';

const LensPanel = require('../web/lens-panel.js');

const [C, Q] = unitKeysOf(SINGLETONS) as [UnitKey, UnitKey];

/** α = {C, Q}, three rows, R fixed by Ada's pin, and a priced breakdown. */
function frame(over: Partial<LensFrame> = {}): LensFrame {
  const rows: ReadonlyArray<Moveset> = [
    {
      ...moveset({ key: 'a1', rank: 1, lo: 12.4, est: 12.9, hi: 15.3, units: [C, Q], staged: true }),
      dominance: { kind: 'leader' },
    },
    {
      ...moveset({ key: 'a2', rank: 2, lo: 11.7, est: 12.0, hi: 15.8, units: [C, Q] }),
      moves: [
        { unit: C, to: 10, path: [10] },
        { unit: Q, to: 14, path: [14] },
      ],
      dominance: { kind: 'indifferent' },
    },
    moveset({ key: 'a3', rank: 3, lo: 11.1, est: 11.4, hi: 12.3, units: [C, Q] }),
  ];
  return lensFrame({
    partition: [
      clusterView({
        id: 0,
        members: [C, Q],
        boundedBy: [{ unit: 'A-R', to: 30, why: 'pin', by: 'ada' }],
      }),
    ],
    candidates: {
      [C]: [
        {
          key: 'c10',
          to: 10,
          path: [10],
          legal: true,
          conditionalBest: { aggregate: 12.4, grade: 'exact' },
          disposition: null,
        },
        // Never priced: the rail must show a grade and not a number.
        { key: 'c11', to: 11, path: [11], legal: true, conditionalBest: null, disposition: null },
      ],
      [Q]: [{ key: 'q11', to: 11, path: [11], legal: true, conditionalBest: null, disposition: null }],
    },
    movesets: { [`0|${C}|10`]: rows },
    staged: { [C]: { to: 10 }, [Q]: { to: 11 } },
    breakdown: {
      a1: {
        moveset: 'a1',
        basis: 'basis:[]',
        aggregate: {
          profile: 'lobster',
          bound: { lo: 12.4, est: 12.9, hi: 15.3 },
          features: [],
          exact: false,
          ledgerSize: 3,
        },
        marginals: [
          {
            unit: C,
            delta: { lo: 4.1, est: 4.1, hi: 4.1 },
            features: [{ key: 'reach', delta: { lo: 2.2, est: 2.2, hi: 2.2 } }],
            against: { to: 0 },
          },
          {
            unit: Q,
            delta: { lo: 3.6, est: 3.6, hi: 3.6 },
            features: [{ key: 'command', delta: { lo: 2.9, est: 2.9, hi: 2.9 } }],
            against: { to: 0 },
          },
        ],
        // ZERO, and it is still a row: a zero cross term is itself a finding.
        residual: { total: { lo: 0, est: 0, hi: 0 }, features: [] },
      },
    },
    ...over,
  });
}

function cursorAt(f: LensFrame, events: ReadonlyArray<CursorEvent>): LensCursor {
  return events.reduce<LensCursor>((c, e) => applyCursorEvent(c, f, e), initialCursor());
}

const FOCUSED = (f: LensFrame) => cursorAt(f, [{ t: 'focus', unit: C }]);

describe('the board ink comes off the transcript, and only disagreement draws', () => {
  test('the focused unit gets a filled arrow and an agreeing member gets a ring', () => {
    const f = frame();
    const ink = LensPanel.inkFromTranscript(renderFrame(f, FOCUSED(f)));
    expect(ink.arrows).toEqual([{ unit: C, to: 10, style: 'filled' }]);
    expect(ink.rings).toEqual([{ unit: Q, to: 11 }]);
  });

  test('walking to a row that moves the other member lights exactly that member', () => {
    const f = frame();
    const at2 = cursorAt(f, [{ t: 'focus', unit: C }, { t: 'moveset', key: 'a2' }]);
    const ink = LensPanel.inkFromTranscript(renderFrame(f, at2));
    expect(ink.arrows).toEqual([
      { unit: C, to: 10, style: 'filled' },
      { unit: Q, to: 14, style: 'hollow' },
    ]);
    expect(ink.rings).toEqual([]);
  });

  test('the cluster carries its members and its bounded units, and never mixes them', () => {
    const f = frame();
    const ink = LensPanel.inkFromTranscript(renderFrame(f, FOCUSED(f)));
    expect(ink.clusters).toHaveLength(1);
    expect(ink.clusters[0].members).toEqual([C, Q]);
    expect(ink.clusters[0].boundedBy).toEqual([{ unit: 'A-R', why: 'pin', by: 'ada', to: 30 }]);
    expect(ink.clusters[0].members).not.toContain('A-R');
  });

  test('an unfocused board draws no lens ink at all', () => {
    const ink = LensPanel.inkFromTranscript(renderFrame(frame()));
    expect(ink.arrows).toEqual([]);
    expect(ink.rings).toEqual([]);
  });
});

describe('the rail says what the design says it must', () => {
  test('the joint residual is a row even when it is zero', () => {
    const f = frame();
    const at = cursorAt(f, [{ t: 'focus', unit: C }, { t: 'moveset', key: 'a1' }]);
    const html = LensPanel.railHTML(renderFrame(f, at));
    expect(html).toContain('joint');
    expect(html).toContain('[why?]');
    expect(html).toContain('0.00…0.00');
  });

  test('an unpriced candidate reads a grade, never a bare number', () => {
    const f = frame();
    const html = LensPanel.candidatesHTML(renderFrame(f, FOCUSED(f)));
    expect(html).toContain('12.4');
    // The second candidate was never priced. `·` is what it says.
    expect(html).toContain('>·<');
    expect(html).toContain('incumbent');
  });

  test('every moveset row carries its depth cell, while every row is still h1', () => {
    const f = frame();
    const html = LensPanel.movesetsHTML(renderFrame(f, FOCUSED(f)));
    expect(html.match(/<td>h1/g)?.length).toBe(3);
    expect(html).toContain('·');
    expect(html).toContain('⌈');
  });

  test('a row that deepened says so, and one whose basis narrowed is not sorted', () => {
    const h1 = reading({ horizon: 1, lo: 11.0, hi: 15.0, basis: 'basis:[]' });
    const deep = reading({ horizon: 2, lo: 11.6, hi: 13.9, basis: 'basis:[]' });
    const narrowed = reading({ horizon: 2, lo: 11.6, hi: 13.9, basis: 'basis:[R]' });
    const rows: ReadonlyArray<Moveset> = [
      {
        ...moveset({ key: 'd1', rank: 1, lo: 11.6, hi: 13.9, units: [C, Q], staged: true }),
        depth: depthColumn({ h1, deepest: deep }),
      },
      {
        ...moveset({ key: 'd2', rank: 2, lo: 11.6, hi: 13.9, units: [C, Q] }),
        depth: depthColumn({ h1, deepest: narrowed }),
      },
    ];
    const f = frame({ movesets: { [`0|${C}|10`]: rows } });
    const transcript = renderFrame(f, FOCUSED(f));
    const html = LensPanel.movesetsHTML(transcript);
    expect(html).toContain('h2');
    expect(html).toContain('▲'); // the floor rose
    expect(html).toContain('▽'); // the ceiling fell
    expect(html).toContain('✂'); // a declared narrowing: present, and not sorted
    expect(html).toContain('lens-row-unsorted');
  });

  /**
   * THE THREAT/OPPORTUNITY MAP, PER ROW (08 §3.4). It used to reach the
   * operator for one pair of rows — the selected one and its foil — while the
   * condition was computed and stored for all of them. These are the clauses
   * the table now carries, one per row, on rows nobody selected.
   */
  test('every retained row draws its own `unless`, the leader included', () => {
    const rows: ReadonlyArray<Moveset> = [
      {
        ...moveset({ key: 'u1', rank: 1, lo: 12.4, est: 12.9, hi: 15.3, units: [C, Q], staged: true }),
        dominance: { kind: 'leader' },
      },
      {
        ...moveset({ key: 'u2', rank: 2, lo: 11.7, est: 12.0, hi: 15.8, units: [C, Q] }),
        dominance: { kind: 'contingent', onUnits: ['B-r3', 'B-q1'], atStake: 2.4 },
      },
      {
        ...moveset({ key: 'u3', rank: 3, lo: 11.1, est: 11.4, hi: 12.3, units: [C, Q] }),
        dominance: { kind: 'dominated', by: 1.9 },
      },
      {
        ...moveset({ key: 'u4', rank: 4, lo: 9.6, est: 9.9, hi: 18.4, units: [C, Q] }),
        dominance: { kind: 'advisory-only', estMargin: 0.3 },
      },
    ];
    const f = frame({ movesets: { [`0|${C}|10`]: rows } });
    const html = LensPanel.movesetsHTML(renderFrame(f, FOCUSED(f)));
    // The owner's own row: named by unit, priced in the aggregate's own units.
    expect(html).toContain('B-r3, B-q1 resolve against us · 2.4 at stake');
    expect(html).toContain('cannot win — dominated by 1.9');
    // The most important row in the table: the floors are equal and the leader
    // won on the channel that never adjudicates.
    expect(html).toContain('floors equal — advisory 0.3');
    // The absence of a condition is drawn too, rather than left blank.
    expect(html).toContain('leads on the proved floor');
    expect(html.match(/lens-unless/g)).toHaveLength(4);
  });

  test('an unsealed row says the barrier has not run — never a blank cell', () => {
    // `dominance` is null before the barrier by construction, and a blank cell
    // would read as "nothing at stake", which is the opposite claim.
    const rows: ReadonlyArray<Moveset> = [
      moveset({ key: 'p1', rank: 1, lo: 12.4, hi: 15.3, units: [C, Q], staged: true }),
    ];
    const f = frame({ movesets: { [`0|${C}|10`]: rows } });
    expect(LensPanel.movesetsHTML(renderFrame(f, FOCUSED(f)))).toContain(
      'unsealed — the barrier has not run'
    );
  });

  test('the tie-break row asks for the operator rather than reporting a number', () => {
    const f = frame();
    const at2 = cursorAt(f, [{ t: 'focus', unit: C }, { t: 'moveset', key: 'a2' }]);
    const html = LensPanel.movesetsHTML(renderFrame(f, at2));
    expect(html).toContain('your call beats my tie-break');
  });

  test('a fixed unit is a constant row with its reason and the operator who caused it', () => {
    const f = frame();
    const html = LensPanel.movesetsHTML(renderFrame(f, FOCUSED(f)));
    expect(html).toContain('🔒');
    expect(html).toContain('A-R');
    expect(html).toContain('ada');
  });

  test('the lock affordance shows the exact pin count before the press, with no ≤', () => {
    const f = frame();
    const rank1 = LensPanel.movesetsHTML(renderFrame(f, FOCUSED(f)));
    expect(rank1).toContain('pins 1 of 2');
    expect(rank1).not.toContain('≤');

    const at2 = cursorAt(f, [{ t: 'focus', unit: C }, { t: 'moveset', key: 'a2' }]);
    expect(LensPanel.movesetsHTML(renderFrame(f, at2))).toContain('pins 2 of 2');
  });

  test('provenance is on every rail, small and always', () => {
    const html = LensPanel.railHTML(renderFrame(frame()));
    expect(html).toContain('bot:lens-fixture');
    expect(html).toContain('eval:1');
    expect(html).toContain('12q');
  });
});

describe('the empty state is one honest sentence, not two different ones', () => {
  test('names what has happened and at which seq', () => {
    const bare = lensFrame({ partition: [], movesets: {}, candidates: {} });
    const html = LensPanel.railHTML(renderFrame(bare, initialCursor()));
    expect(html).toContain('no kernel emission yet at seq 3');
    expect(html).not.toContain('no data');
    expect(html).not.toContain('No decision data');
  });

  test('reads the same off a scrubbed live frame and a replayed one', () => {
    const f = frame();
    const cursor = FOCUSED(f);
    const scrub = renderFrame(
      { ...f, at: lensAt({ mode: 'live-scrub', isHead: false }) },
      cursor
    );
    const replay = renderFrame({ ...f, at: lensAt({ mode: 'replay', isHead: false }) }, cursor);
    expect(LensPanel.railHTML(replay)).toEqual(LensPanel.railHTML(scrub));
    // Off the head the affordance re-labels rather than vanishing: a greyed
    // control teaches nothing.
    expect(LensPanel.movesetsHTML(replay)).toContain('return to now');
  });
});

describe('the timeline lane', () => {
  test('lays a tick per event in its own lane, and hides attention ticks by default', () => {
    const events = [
      { lane: 'kernel', seq: 1, atWorkMs: 12, kind: 'emission', color: null, shape: 'solid' },
      { lane: 'operator', seq: 2, atWorkMs: null, kind: 'selection', color: '#7c4dff', shape: 'hollow' },
      { lane: 'staging', seq: 3, atWorkMs: 40, kind: 'stage.requested', color: null, shape: 'solid' },
    ];
    const closed = LensPanel.laneHTML(events, { seq: 3 });
    expect(closed.match(/data-seq=/g)?.length).toBe(2);
    expect(
      LensPanel.laneHTML(events, { seq: 3, expanded: true }).match(/data-seq=/g)?.length
    ).toBe(3);
    expect(closed).toContain('seq 3');
  });

  test('says so when a turn has no events yet', () => {
    expect(LensPanel.laneHTML([], { seq: 0 })).toContain('no events yet this turn');
  });

  test('reads its rows straight off the transcript', () => {
    const rows = LensPanel.laneEventsFromTranscript(renderFrame(frame()));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].lane).toBe('anchor');
  });
});

describe('the keymap extends the shipped schema and touches nothing in it', () => {
  const press = (key: string, mods: { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) =>
    LensPanel.keyBinding({ key, shiftKey: false, ctrlKey: false, altKey: false, ...mods });

  test('claims only keys the shortcuts pane left free', () => {
    expect(press('[')?.action).toBe('moveset.prev');
    expect(press(']')?.action).toBe('moveset.next');
    expect(press('f')?.action).toBe('foil');
    expect(press('b')?.action).toBe('drill');
    expect(press('B', { shiftKey: true })?.action).toBe('drill.all');
    expect(press(',')?.action).toBe('timeline.prev');
    expect(press('.')?.action).toBe('timeline.next');
    expect(press(',', { shiftKey: true })?.action).toBe('timeline.prevEmission');
    expect(press('Home')?.action).toBe('timeline.start');
    expect(press('End')?.action).toBe('timeline.head');
    expect(press('n')?.action).toBe('now');
    expect(press('u')?.action).toBe('release');
    expect(press(' ', { shiftKey: true })?.action).toBe('lock.moveset');
  });

  test('leaves every shipped binding alone', () => {
    // Space, H, Delete, Enter, Tab, Escape, the digits, the arrow pad and
    // WASD all keep exactly the meanings they have; the lens never sees them.
    for (const key of [
      ' ',
      'h',
      'Delete',
      'Enter',
      'Tab',
      'Escape',
      '1',
      '5',
      '9',
      'ArrowUp',
      'ArrowLeft',
      'w',
      'a',
      's',
      'd',
    ]) {
      expect(press(key)).toBeNull();
    }
    // And a modified press is somebody else's chord, always.
    expect(press('/', { ctrlKey: true })).toBeNull();
    expect(press('n', { ctrlKey: true })).toBeNull();
    expect(press('b', { altKey: true })).toBeNull();
  });

  test('every binding carries the help line the shortcuts pane renders', () => {
    for (const binding of LensPanel.KEYMAP) {
      expect(typeof binding.help).toBe('string');
      expect(binding.help.length).toBeGreaterThan(8);
    }
  });
});
