/**
 * THE EXPLANATION EQUALS WHAT THE BOUNDS SAY.
 *
 * Four readings were added to the rail this round — what separates rank 1 from
 * rank 2, how sure the bot is that the separation is real, what the bounds are
 * open on, and what settlement the number was read in — and every one of them
 * is a SENTENCE about numbers the operator is about to act on. A sentence that
 * is nearly right is worse than no sentence at all: it is the mechanism by
 * which an explanation raises reliance on wrong advice, which is the failure
 * this whole round is about.
 *
 * So each assertion below compares the words against the FRAME'S OWN DATA
 * rather than against a fixture's expected string wherever it can: the decider
 * is asserted to be the only member whose assignment actually differs, the
 * threat ranking against the rows' own `atStake`, the proved/not-proved verdict
 * against the arithmetic it claims to have done. A pixel that lies is the
 * defect this file exists to catch.
 */

import {
  contrastOf,
  lineOf,
  renderFrame,
  threatsOf,
  unsureOf,
  initialCursor,
} from '../lens/view';
import type {
  DrawCall,
  LensCursor,
  LensFrame,
  LoudReading,
  Moveset,
  MovesetBreakdown,
  PlyStep,
  UnitKey,
} from '../lens/types';
import {
  clusterView,
  depthColumn,
  lensFrame,
  moveset,
  reading,
  unitKeysOf,
  SINGLETONS,
} from './lens-fixtures';

const LensPanel = require('../web/lens-panel.js');

const [C, Q] = unitKeysOf(SINGLETONS) as [UnitKey, UnitKey];

/** Two members, so "which one decides" is a question with an answer. */
function rowOf(over: Partial<Moveset> & { cells?: ReadonlyArray<number> } = {}): Moveset {
  const base = moveset({ units: [C, Q], ...(over as object) });
  const cells = over.cells ?? [10, 11];
  return {
    ...base,
    ...over,
    moves: [
      { unit: C, to: cells[0] as number, path: [cells[0] as number] },
      { unit: Q, to: cells[1] as number, path: [cells[1] as number] },
    ],
  } as Moveset;
}

function frameWith(rows: ReadonlyArray<Moveset>, over: Partial<LensFrame> = {}): LensFrame {
  return lensFrame({
    partition: [clusterView({ id: 0, members: [C, Q] })],
    candidates: {
      [C]: [{ key: 'c10', to: 10, path: [10], legal: true, conditionalBest: null, disposition: null }],
    },
    movesets: { [`0|${C}|10`]: rows },
    ...over,
  });
}

const FOCUSED: LensCursor = { ...initialCursor(), unit: C, candidate: 10 };

const argOf = (ops: ReadonlyArray<DrawCall>, op: string): unknown =>
  (ops.find((c) => c.op === op)?.args ?? [])[0];

// ---------------------------------------------------------------------------

describe('the contrastive strip names the member that decides the order', () => {
  it('names the ONE member whose assignment differs, and it is really the only one', () => {
    const mine = rowOf({ key: 'a', rank: 1, lo: 12.4, est: 12.9, hi: 15.3, cells: [10, 11] });
    const theirs = rowOf({ key: 'b', rank: 2, lo: 11.7, est: 12, hi: 15.8, cells: [10, 14] });
    const frame = frameWith([mine, theirs]);
    const line = contrastOf(frame, mine, theirs);

    expect(line).not.toBeNull();
    expect(line?.attribution).toBe('sole');
    // ASSERTED AGAINST THE ROWS, not against a literal: the named member is the
    // one whose two assignments really are different, and it is the only one.
    const differ = mine.moves.filter(
      (m) => theirs.moves.find((t) => t.unit === m.unit)?.to !== m.to
    );
    expect(differ.map((m) => m.unit)).toEqual([line?.decider]);
    expect(line?.mine).toBe(differ[0]?.to);
    expect(line?.agreed).toBe(mine.moves.length - differ.length);
    expect(line?.margin).toBeCloseTo(mine.lo - theirs.lo, 5);
  });

  it('counts and stops when more than one member differs and nothing has priced them', () => {
    const mine = rowOf({ key: 'a', rank: 1, lo: 3, cells: [10, 11] });
    const theirs = rowOf({ key: 'b', rank: 2, lo: 2, cells: [12, 14] });
    const line = contrastOf(frameWith([mine, theirs]), mine, theirs);
    expect(line?.attribution).toBe('unattributed');
    expect(line?.decider).toBeNull();
    expect(line?.differing).toBe(2);
  });

  it('uses the two rows’ own marginals when both have been drilled', () => {
    const mine = rowOf({ key: 'a', rank: 1, lo: 3, cells: [10, 11] });
    const theirs = rowOf({ key: 'b', rank: 2, lo: 2, cells: [12, 14] });
    const bd = (unit: UnitKey, delta: number, key: string): MovesetBreakdown => ({
      moveset: key,
      basis: 'basis:[]',
      aggregate: null,
      marginals: [
        { unit: C, delta: { lo: unit === C ? delta : 0, est: 0, hi: 0 }, features: [], against: { to: 0 } },
        { unit: Q, delta: { lo: unit === Q ? delta : 0, est: 0, hi: 0 }, features: [], against: { to: 0 } },
      ],
      residual: { total: { lo: 0, est: 0, hi: 0 }, features: [] },
    });
    const frame = frameWith([mine, theirs], {
      breakdown: { a: bd(Q, 0, 'a'), b: bd(Q, 9, 'b') },
    });
    const line = contrastOf(frame, mine, theirs);
    // Q's marginal moves by 9 between the two rows and C's by 0, so Q carries it.
    expect(line?.attribution).toBe('marginal');
    expect(line?.decider).toBe(Q);
  });

  /**
   * A5's FAMILY. The rung is the LOSER's own condition. Reading the winner's
   * `leader` back at the operator answers nothing, and it is the exact bug the
   * foil line was already caught doing once.
   */
  it('reads the rung off the loser and never off the winner', () => {
    const mine = rowOf({ key: 'a', rank: 1, lo: 3, cells: [10, 11], dominance: { kind: 'leader' } });
    const theirs = rowOf({
      key: 'b',
      rank: 2,
      lo: 3,
      cells: [10, 14],
      dominance: { kind: 'indifferent' },
    });
    const line = contrastOf(frameWith([mine, theirs]), mine, theirs);
    expect(line?.rung).toBe('tie');
    expect(line?.says).toContain('tie-break');
    // Equal floors: a margin of zero is not a reason, and the sentence says the
    // rung before it says the number.
    expect(line?.margin).toBe(0);
  });

  it('says so, rather than nothing, when the barrier has not sealed the loser', () => {
    const mine = rowOf({ key: 'a', rank: 1, cells: [10, 11], unpriced: true });
    const theirs = rowOf({ key: 'b', rank: 2, cells: [10, 14], unpriced: true });
    const line = contrastOf(frameWith([mine, theirs]), mine, theirs);
    expect(line?.rung).toBe('unsealed');
    expect(line?.margin).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('“how sure is the bot” is the margin read against the width', () => {
  const pair = (lo1: number, hi1: number, lo2: number): [Moveset, Moveset] => [
    rowOf({ key: 'a', rank: 1, lo: lo1, est: lo1, hi: hi1, cells: [10, 11] }),
    rowOf({ key: 'b', rank: 2, lo: lo2, est: lo2, hi: hi1, cells: [10, 14] }),
  ];

  it('calls the order NOT proved when the gap is inside the bracket', () => {
    const [a, b] = pair(-41.4, 31.4, -41.5);
    const u = unsureOf(a, b);
    expect(u?.proved).toBe(false);
    expect(u?.headline).toContain('NOT proved');
    // The verdict is the arithmetic it claims: gap ≤ width.
    expect((u?.margin as number) <= (u?.width as number)).toBe(true);
  });

  it('calls the order proved when the gap is wider than the bracket', () => {
    const [a, b] = pair(10, 11, 4);
    const u = unsureOf(a, b);
    expect(u?.proved).toBe(true);
    expect((u?.margin as number) > (u?.width as number)).toBe(true);
  });

  /** THE CLIFF IS NOT A LOW NUMBER. `DEAD` is the lattice bottom, so the worst
   *  world is our elimination — a different statement from "worth very
   *  little", and the one an operator must never read as the other. */
  it('says the floor is on the cliff rather than reporting a very wide bracket', () => {
    const a = rowOf({ key: 'a', rank: 1, lo: -Infinity, est: 0, hi: 12, cells: [10, 11] });
    const b = rowOf({ key: 'b', rank: 2, lo: -Infinity, est: 0, hi: 12, cells: [10, 14] });
    const u = unsureOf(a, b);
    expect(u?.headline).toContain('CLIFF');
    expect(u?.headline).toContain('elimination');
    expect(u?.width).toBeNull();
  });

  it('says the ceiling is open rather than drawing infinity as a big number', () => {
    const a = rowOf({ key: 'a', rank: 1, lo: 1, est: 2, hi: Infinity, cells: [10, 11] });
    expect(unsureOf(a, null)?.headline).toContain('nothing is proved above');
  });

  it('refuses the question on an unpriced list instead of answering it with zeros', () => {
    const a = rowOf({ key: 'a', rank: 1, cells: [10, 11], unpriced: true });
    const u = unsureOf(a, rowOf({ key: 'b', rank: 2, cells: [10, 14], unpriced: true }));
    expect(u?.proved).toBeNull();
    expect(u?.headline).toContain('no row here carries a price');
  });

  it('names the adjudicating channel, and never calls `est` a proof', () => {
    const a = rowOf({ key: 'a', rank: 1, lo: 1, est: 2, hi: 3, cells: [10, 11], channel: 'est' });
    expect(unsureOf(a, null)?.points.join(' ')).toContain('never proves anything');
  });
});

// ---------------------------------------------------------------------------

describe('the threat ranking is the rows’ own atStake, ranked', () => {
  const loud: LoudReading = { units: [], q: 0, product: 33, b3: false, covers: false };

  it('ranks by what each row says is at stake and names the residue as prose', () => {
    const leader = rowOf({
      key: 'a',
      rank: 1,
      lo: 1,
      cells: [10, 11],
      citedUnits: ['B-far'],
      dominance: { kind: 'leader' },
    });
    const rival = rowOf({
      key: 'b',
      rank: 2,
      lo: 0,
      cells: [10, 14],
      dominance: { kind: 'contingent', onUnits: ['#-1', 'B-near'], atStake: 72.75 },
    });
    const map = threatsOf([leader, rival], leader, loud);
    expect(map.items.map((i) => i.unit)).toEqual(['B-near', 'the evaluator residue', 'B-far']);
    // The number is the row's own, rounded to the rail's resolution.
    expect(map.items[0]?.atStake).toBeCloseTo(72.8, 5);
    expect(map.items[2]?.atStake).toBeNull();
    expect(map.items[2]?.why).toContain('floor is open on it');
  });

  it('reads the loud product as a sentence, and says when nothing can touch us', () => {
    const leader = rowOf({ key: 'a', rank: 1, lo: 1, cells: [10, 11] });
    expect(threatsOf([leader], leader, loud).loud).toContain('NONE of them touches');
    const some: LoudReading = { units: [], q: 4, product: 33, b3: true, covers: true };
    expect(threatsOf([leader], leader, some).loud).toContain('4 of 33');
  });

  /** ALWAYS DRAWN. The one thing this build cannot say about the other side is
   *  said, rather than left for the reader to infer the enemy has no plan. */
  it('draws its own absence, in every state', () => {
    const leader = rowOf({ key: 'a', rank: 1, lo: 1, cells: [10, 11] });
    expect(threatsOf([leader], leader, loud).absence).toContain('no enemy CELL is stored');
    expect(threatsOf([], null, null).absence).toContain('nothing is named');
  });

  /** LAW E. The conditional context adds an `operator-pin` assumption, so its
   *  basis differs; borrowing the cluster's unconditional threat map for it
   *  would be a statement from another fiber. */
  it('refuses to borrow the cluster’s answer for an unpriced list', () => {
    const unpriced = rowOf({ key: 'a', rank: 1, cells: [10, 11], unpriced: true });
    const map = threatsOf([unpriced], unpriced, loud);
    expect(map.loud).toBeNull();
    expect(map.absence).toContain('different basis');
  });
});

// ---------------------------------------------------------------------------

describe('the line strip draws the settlement the bound was read on', () => {
  it('draws the PREMISE, and says it is one, where no ply was taken', () => {
    const row = rowOf({ key: 'a', rank: 1, lo: 1, est: 2, hi: 3, cells: [10, 11], citedUnits: ['B-r'] });
    const strip = lineOf(row, { units: [], q: 2, product: 9, b3: false, covers: true });
    expect(strip?.premise).toBe(true);
    expect(strip?.plies.map((p) => p.side)).toEqual(['ours', 'theirs', 'leaf']);
    expect(strip?.plies[0]?.what).toBe(`${C}→10 · ${Q}→11`);
    // The `them` layer is a CLAIM SET and names no cell, because none exists.
    expect(strip?.plies[1]?.what).toContain('claim clouds');
    expect(strip?.plies[1]?.what).not.toMatch(/→\d/);
    expect(strip?.note).toContain('no ply was taken');
  });

  it('draws the real line, and stops calling it a premise, the moment one exists', () => {
    const line: ReadonlyArray<PlyStep> = [
      { ply: 1, side: 'ours', moves: [{ unit: C, to: 10 }], lo: 1, hi: 5, ledgerSize: 7, narrowed: false, witnessSeq: null },
      { ply: 1, side: 'theirs', moves: [{ unit: 'B-r', to: 44 }], lo: 1, hi: 4, ledgerSize: 5, narrowed: false, witnessSeq: 9 },
    ];
    const row = {
      ...rowOf({ key: 'a', rank: 1, lo: 1, hi: 5, cells: [10, 11] }),
      depth: depthColumn({ h1: reading({ lo: 1, hi: 5 }), line, derived: true }),
    } as Moveset;
    const strip = lineOf(row, null);
    expect(strip?.premise).toBe(false);
    expect(strip?.plies).toHaveLength(2);
    expect(strip?.plies[1]?.what).toBe('B-r→44');
    expect(strip?.plies[1]?.ledger).toBe(5);
  });

  it('says the leaf is unpriced rather than printing a bracket of zeros', () => {
    const row = rowOf({ key: 'a', rank: 1, cells: [10, 11], unpriced: true });
    expect(lineOf(row, null)?.plies[2]?.what).toContain('unpriced');
  });
});

// ---------------------------------------------------------------------------

describe('the transcript carries all four readings, and the rail draws them', () => {
  const mine = rowOf({ key: 'a', rank: 1, lo: 12.4, est: 12.9, hi: 15.3, cells: [10, 11], dominance: { kind: 'leader' } });
  const theirs = rowOf({
    key: 'b',
    rank: 2,
    lo: 11.7,
    est: 12,
    hi: 15.8,
    cells: [10, 14],
    dominance: { kind: 'contingent', onUnits: ['B-near'], atStake: 4.1 },
  });
  const frame = frameWith([mine, theirs]);
  const ops = renderFrame(frame, FOCUSED);

  it('emits one op per reading', () => {
    for (const op of ['panel.contrast', 'panel.unsure', 'panel.threats', 'panel.line']) {
      expect(ops.filter((c) => c.op === op)).toHaveLength(1);
    }
  });

  it('the strip’s sentence is the strip’s own data', () => {
    const html: string = LensPanel.movesetsHTML(ops);
    const contrast = argOf(ops, 'panel.contrast') as { decider: string; mine: number };
    expect(html).toContain(contrast.decider);
    expect(html).toContain(String(contrast.mine));
    const unsure = argOf(ops, 'panel.unsure') as { headline: string };
    expect(html).toContain(LensPanel.escapeHTML(unsure.headline));
    const threats = argOf(ops, 'panel.threats') as { items: ReadonlyArray<{ unit: string }> };
    for (const item of threats.items) expect(html).toContain(item.unit);
  });
});

// ---------------------------------------------------------------------------

describe('the band reads worst / expected / best, and marks the cliff', () => {
  const rows = (over: Partial<Moveset> = {}): ReadonlyArray<Moveset> => [
    rowOf({ key: 'a', rank: 1, lo: 4, est: 6, hi: 9, cells: [10, 11] }),
    { ...rowOf({ key: 'b', rank: 2, lo: 1, est: 2, hi: 8, cells: [10, 14] }), ...over } as Moveset,
  ];

  const htmlFor = (list: ReadonlyArray<Moveset>): string =>
    LensPanel.movesetsHTML(renderFrame(frameWith(list), FOCUSED));

  /**
   * THE DEFECT THIS REPLACES. `bandScale` folded a non-finite endpoint into its
   * min, so `lo` became `−Infinity`, the finiteness guard returned null, and
   * EVERY band in the table vanished — silently, on the one turn an operator
   * most needs the intervals.
   */
  it('one DEAD floor does not erase the other rows’ bands', () => {
    const html = htmlFor(rows({ lo: -Infinity }));
    expect((html.match(/lens-band-span/g) ?? []).length).toBe(2);
    expect(html).toContain('lens-band-cliff');
    expect(html).toContain('lens-band-dead');
  });

  it('a finite floor draws no cliff', () => {
    expect(htmlFor(rows())).not.toContain('lens-band-cliff');
  });

  it('an open ceiling draws an arrowhead rather than a bar', () => {
    expect(htmlFor(rows({ hi: Infinity }))).toContain('lens-band-open');
  });

  it('every band carries the leader’s floor as a reference mark', () => {
    const html = htmlFor(rows());
    expect((html.match(/lens-band-lead/g) ?? []).length).toBe(2);
  });

  it('the label reads worst, expected and best in that order', () => {
    const html = htmlFor(rows());
    expect(html).toMatch(/aria-label="worst [^"]*expected [^"]*best /);
  });

  /** The scale is built from the rows' OWN endpoints, so a non-finite one is
   *  skipped rather than collapsing the whole table's geometry. */
  it('bandScale ignores a non-finite endpoint instead of returning nothing', () => {
    const calls = renderFrame(frameWith(rows({ lo: -Infinity })), FOCUSED).filter(
      (c) => c.op === 'panel.movesets.row'
    );
    const scale = LensPanel.bandScale(calls);
    expect(scale).not.toBeNull();
    expect(Number.isFinite(scale.lo)).toBe(true);
    expect(scale.span).toBeGreaterThan(0);
  });
});
