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

import {
  renderFrame,
  initialCursor,
  applyCursorEvent,
  modeBadge,
  renderTimeline,
} from '../lens/view';
import type {
  CursorEvent,
  DrawTranscript,
  LensCursor,
  LensFrame,
  Moveset,
  UnitKey,
} from '../lens/types';
import {
  clusterView,
  depthColumn,
  lensAt,
  lensFrame,
  moveset,
  operatorActor,
  reading,
  turnEvent,
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

/**
 * THE LOCK AFFORDANCE, AT ITS ONE SOURCE. It used to be read out of the
 * movesets panel's HTML, because the panel drew it — a second lock affordance
 * a few pixels above the control bar's chip, in a second grammar, for one
 * gesture (05 H-6). Only the chip draws it now, and the chip reads this
 * transcript call, so this is where the label's content is asserted. The
 * `affordance.lock` op is unchanged; what went away is its second drawing.
 */
const lockAffordance = (transcript: DrawTranscript): string =>
  String(transcript.find((c) => c.op === 'affordance.lock')?.args[0] ?? '');

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
    const rank1 = lockAffordance(renderFrame(f, FOCUSED(f)));
    expect(rank1).toContain('pins 1 of 2');
    expect(rank1).not.toContain('≤');
    // AND NOWHERE ELSE. The count is the chip's state; a panel that drew it
    // too is the duplicate affordance H-6 measured.
    expect(LensPanel.movesetsHTML(renderFrame(f, FOCUSED(f)))).not.toContain('pins 1 of 2');

    const at2 = cursorAt(f, [{ t: 'focus', unit: C }, { t: 'moveset', key: 'a2' }]);
    expect(lockAffordance(renderFrame(f, at2))).toContain('pins 2 of 2');
  });

  /**
   * 10 §4 O1. The panel is a LIST OF ONE on the shipped build — no conditional
   * is ever answered, so what draws is the cluster's retained rows restricted
   * to those that play this candidate. The head must say which list it is and
   * how much was narrowed away, or the operator reads a broken table with two
   * dead keys and no way to tell that from a bug.
   */
  test('the moveset head says which list it is and how much it narrowed away', () => {
    const conditional = LensPanel.movesetsHTML(renderFrame(frame(), FOCUSED(frame())));
    expect(conditional).toContain('conditional list');

    // The A2 fallback: the cluster's retained rows under the reservoir key,
    // restricted to the one that plays C→10.
    const rows: ReadonlyArray<Moveset> = [
      moveset({ key: 'r1', rank: 1, lo: 12.4, hi: 15.3, units: [C, Q], staged: true }),
      {
        ...moveset({ key: 'r2', rank: 2, lo: 11.7, hi: 15.8, units: [C, Q] }),
        moves: [
          { unit: C, to: 11, path: [11] },
          { unit: Q, to: 14, path: [14] },
        ],
      },
    ];
    const f = frame({ movesets: { '0': rows } });
    const html = LensPanel.movesetsHTML(renderFrame(f, FOCUSED(f)));
    expect(html).toContain('no conditional was answered');
    expect(html).toContain('1 of 2 retained rows play this candidate');
    expect(html).toContain('[ and ] have nowhere to go');
  });

  /**
   * 10 §4 O1, the CAUSE. A conditional ranking that stopped short and a
   * cluster with nothing else in it are the same table on screen unless the
   * head says which one this is — and the two stops are not the same
   * sentence: the reserve running out is the typed refusal a request past it
   * would have got, and a full list is not a refusal at all.
   */
  test('the head names where the ranking stopped, and only the reserve reads as a refusal', () => {
    const rows: ReadonlyArray<Moveset> = [
      { ...moveset({ key: 'k1', rank: 1, units: [C, Q], staged: true }), unpriced: true },
    ];
    const spent = frame({
      movesets: { [`0|${C}|10`]: rows },
      movesetTruncation: {
        [`0|${C}|10`]: {
          why: 'reserve-spent',
          notRanked: 7,
          detail: '7 more assignments of the rest of the cluster went unranked: the inspection reserve is spent',
        },
      },
    });
    const refused = LensPanel.movesetsHTML(renderFrame(spent, FOCUSED(spent)));
    expect(refused).toContain('the inspection reserve is spent');
    expect(refused).toContain('lens-refused');
    // And the foil line carries the same cause, because the runner-up is
    // exactly what the reserve took away.
    expect(refused).toContain('no runner-up');

    const full = frame({
      movesets: { [`0|${C}|10`]: rows },
      movesetTruncation: {
        [`0|${C}|10`]: {
          why: 'row-cap',
          notRanked: 2,
          detail: '2 more assignments of the rest of the cluster are not drawn: a list holds 5',
        },
      },
    });
    const capped = LensPanel.movesetsHTML(renderFrame(full, FOCUSED(full)));
    expect(capped).toContain('a list holds 5');
    expect(capped).not.toContain('lens-refused');
  });

  /**
   * LAW A, ON THE CONDITIONAL LIST. `conform` returns a plan, not a price, so
   * a conditional ranking's rows are ASSIGNMENTS. Drawing `0.0 ⌈0.0⌉` for
   * them prints a reading nobody took — and a foil margin between two of them
   * is a difference of two numbers that do not exist.
   */
  test('an unpriced row draws no number, no bracket and no margin', () => {
    const rows: ReadonlyArray<Moveset> = [
      { ...moveset({ key: 'u1', rank: 1, units: [C, Q], staged: true }), unpriced: true },
      {
        ...moveset({ key: 'u2', rank: 2, units: [C, Q] }),
        moves: [
          { unit: C, to: 10, path: [10] },
          { unit: Q, to: 14, path: [14] },
        ],
        unpriced: true,
      },
    ];
    const f = frame({ movesets: { [`0|${C}|10`]: rows } });
    const html = LensPanel.movesetsHTML(renderFrame(f, FOCUSED(f)));
    // The legend still glosses `⌈w⌉`; no ROW draws one.
    expect(html).not.toContain('lens-width');
    expect(html).toContain('foil #2');
    expect(html).not.toContain('margin');
    // The assignment IS the row's content, and it is still drawn.
    expect(html).toContain(`${C}→10`);
  });

  /**
   * 10 §4 O3. §3.5 says the panel-side foil is ALWAYS visible; it was drawn
   * only where the list held a rank 2, which by O1 is the uncommon case — so
   * the highest-value cheap signal on the surface was silently absent in the
   * ordinary case.
   */
  test('the foil line is on screen even when there is no runner-up', () => {
    const withFoil = LensPanel.movesetsHTML(renderFrame(frame(), FOCUSED(frame())));
    expect(withFoil).toContain('foil #2');

    const one: ReadonlyArray<Moveset> = [
      moveset({ key: 'o1', rank: 1, lo: 12.4, hi: 15.3, units: [C, Q], staged: true }),
    ];
    const f = frame({ movesets: { [`0|${C}|10`]: one } });
    const html = LensPanel.movesetsHTML(renderFrame(f, FOCUSED(f)));
    expect(html).toContain('no runner-up');
    expect(html).toContain('the conditional list has one row');
  });

  /**
   * 10 §4 O5. T3 and T6 both name a click — on a candidate cell, on a moveset
   * row — as a source of the cursor transition, and the rail's rows carried no
   * way to say WHICH row was clicked, so the panel was keyboard-only. The
   * markup names the target; the page binds it. Hover stays inert (T4).
   */
  test('the rail names its click targets for T3 and T6', () => {
    const f = frame();
    const transcript = renderFrame(f, FOCUSED(f));
    expect(LensPanel.candidatesHTML(transcript)).toContain('data-lens-candidate="10"');
    const rows = LensPanel.movesetsHTML(transcript);
    expect(rows).toContain('data-lens-moveset="a1"');
    expect(rows).toContain('data-lens-moveset="a2"');
    // No pointer handlers and no hover classes in the markup: the rail is a
    // place to look until something is pressed.
    expect(rows).not.toMatch(/onmouse|onclick|:hover/);
  });

  /**
   * 10 §4 O6, in the rail. The partition's `boundedBy[].by` is the KERNEL's
   * field and the kernel does not know operators — every producer fills it
   * null. The fold does know, because it folds the `pin` rows the gesture now
   * writes and puts the author on the unit's row. Rule E's sentence must read
   * the one that has an answer.
   */
  test('Rule E names the operator off the fold when the partition cannot', () => {
    const f = frame();
    const anonymous = {
      ...f,
      partition: [
        clusterView({
          id: 0,
          members: [C, Q],
          // The kernel's own field, as every producer actually fills it.
          boundedBy: [{ unit: 'A-R', to: 30, why: 'pin' as const, by: null }],
        }),
      ],
      units: [
        ...f.units,
        {
          unit: 'A-R' as UnitKey,
          kind: 'snake',
          letter: 'R',
          weight: 3,
          health: 99,
          orientation: { dx: 0, dy: 1 },
          // What the fold writes once a `pin` row exists to fold.
          fixity: 'pinned' as const,
          owner: 'u7',
          operator: 'Ada',
        },
      ],
    };
    const html = LensPanel.movesetsHTML(renderFrame(anonymous, FOCUSED(anonymous)));
    expect(html).toContain('Ada');

    const cursorOnBound = applyCursorEvent(initialCursor(), anonymous, {
      t: 'focus',
      unit: 'A-R' as UnitKey,
    });
    expect(LensPanel.railHTML(renderFrame(anonymous, cursorOnBound))).toContain('by Ada');
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
    const scrubFrame = { ...f, at: lensAt({ mode: 'live-scrub', isHead: false }) };
    const replayFrame = { ...f, at: lensAt({ mode: 'replay', isHead: false }) };
    const scrub = renderFrame(scrubFrame, cursor);
    const replay = renderFrame(replayFrame, cursor);
    expect(LensPanel.railHTML(replay)).toEqual(LensPanel.railHTML(scrub));

    // 10 §4 O7. Off the head the affordance re-labels rather than vanishing —
    // a greyed control teaches nothing — and what it says is true of BOTH
    // off-head modes: determinations are legal only from the live head. The
    // WAY BACK is a fact about the source, not about the frame, so it rides
    // the badge component: only a scrubbed live turn has a `now`, and a
    // replayed one is no longer offered one it does not have.
    expect(lockAffordance(replay)).toContain('— read-only —');
    expect(LensPanel.movesetsHTML(replay)).not.toContain('return to now');
    expect(modeBadge(scrubFrame)).toContain('[N] return to now');
    expect(modeBadge(replayFrame)).not.toContain('return to now');
    expect(modeBadge({ ...f, at: lensAt({ mode: 'live-head', isHead: true }) })).not.toContain(
      'return to now'
    );
  });

  /**
   * §1.4's other replay label: `locked by Ada at +812ms → [jump]` where such a
   * lock exists at this seq. It is a READ of the turn's own rows — so it is
   * the same sentence off the socket and off the log — and it could not be
   * said at all until the pin gesture became a row (O6).
   */
  test('a determined cluster names the operator who determined it', () => {
    const f = frame();
    const determined = {
      ...f,
      at: lensAt({ mode: 'replay', isHead: false }),
      events: [
        ...f.events,
        turnEvent({
          kind: 'pin',
          seq: 2,
          atWorkMs: 812,
          unit: C,
          actor: operatorActor('Ada'),
          payload: { unit: C, to: 10, tentative: false },
        }),
      ],
    };
    expect(lockAffordance(renderFrame(determined, FOCUSED(determined)))).toContain(
      'locked by Ada at +812ms → [jump]'
    );

    // A LOOK IS NOT A LOCK. A tentative pin is a hint the search may
    // speculate on, and reporting it as a determination would be the display
    // contract lying about who decided.
    const considered = {
      ...determined,
      events: [
        ...f.events,
        turnEvent({
          kind: 'pin',
          seq: 2,
          atWorkMs: 812,
          unit: C,
          actor: operatorActor('Ada'),
          payload: { unit: C, to: 10, tentative: true },
        }),
      ],
    };
    expect(lockAffordance(renderFrame(considered, FOCUSED(considered)))).toContain(
      '— read-only —'
    );
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

  /**
   * 10 §4 O4. The lane's hollow ticks and the expand toggle were built and
   * unfed: nothing writes a `selection` with `hover`, so `operator.attention`
   * was absent from the log entirely. The look that DOES reach the kernel is
   * a TENTATIVE pin, and that is the shape the renderer must read as hollow —
   * a tentative pin drawn solid would report a determination nobody made.
   */
  test('a tentative pin is an attention tick, hollow and hidden by default', () => {
    const attention = renderTimeline([
      turnEvent({ kind: 'emission', seq: 1, payload: { planKey: 'p', hover: false } }),
      turnEvent({
        kind: 'pin',
        seq: 2,
        actor: operatorActor('ada'),
        payload: { unit: 'A-C', to: 10, tentative: true },
      }),
      turnEvent({
        kind: 'pin',
        seq: 3,
        actor: operatorActor('ada'),
        payload: { unit: 'A-C', to: 10, tentative: false },
      }),
    ]).filter((c) => c.op === 'timeline.tick');
    expect(attention.map((c) => c.args[6])).toEqual(['solid', 'hollow', 'solid']);
  });

  test('says so when a turn has no events yet', () => {
    expect(LensPanel.laneHTML([], { seq: 0 })).toContain('no events yet this turn');
  });

  /**
   * 10 §4 O6, in the lane. §2.2 asks for `●Ada near(s2)`: the verb, the unit
   * and the operator, in the operator's own colour. The tick said the kind and
   * the time and nothing else, because no `pin` row existed to carry a name.
   */
  test('an operator tick carries the verb, the unit, the operator and the colour', () => {
    const ticks = renderTimeline([
      turnEvent({
        kind: 'pin',
        seq: 4,
        atWorkMs: 149,
        unit: 'red-A',
        actor: operatorActor('Ada', '#7c4dff'),
        payload: { unit: 'red-A', to: 94, tentative: false },
      }),
    ]).filter((c) => c.op === 'timeline.tick');
    expect(ticks[0]?.args[0]).toBe('operator');

    const html = LensPanel.laneHTML(
      [
        {
          lane: 'operator',
          seq: 4,
          atWorkMs: 149,
          kind: 'pin',
          color: '#7c4dff',
          shape: 'solid',
          operator: 'Ada',
          unit: 'red-A',
        },
      ],
      { seq: 4 }
    );
    expect(html).toContain('title="Ada pin(red-A) · seq 4 · +149ms"');
    expect(html).toContain('color:#7c4dff');
    expect(html).toContain('●');
  });

  test('gives the turn anchors a lane of their own', () => {
    // `board.arrived` and `turn.resolved` are the two ends the lane is
    // DEFINED between, and neither had a row to be drawn in.
    const anchored = [
      { lane: 'anchor', seq: 0, atWorkMs: null, kind: 'board.arrived', color: null, shape: 'solid' },
      { lane: 'kernel', seq: 1, atWorkMs: 12, kind: 'emission', color: null, shape: 'solid' },
    ];
    const html = LensPanel.laneHTML(anchored, { seq: 1 });
    expect(html).toContain('data-lane="anchor"');
    expect(html.match(/data-seq=/g)?.length).toBe(2);
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
