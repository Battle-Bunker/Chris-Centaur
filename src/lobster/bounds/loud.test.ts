/**
 * THE LOUD PRODUCT — the instrument's own arithmetic.
 *
 * `Q` decides nothing, so what has to be true of it is narrow and exact: it
 * counts the options that meet the staged footprint IN SUB-STEP TIME, it is a
 * product over the gated units, and it carries the reply product beside it so
 * the two distributions are read off one population.
 */

import type { Candidate, JointPlan, UnitId } from '../contracts';
import { loudReadingOf, observeLoud } from './loud';

const candidate = (unitId: UnitId, from: number, path: number[]): Candidate => ({
  unitId,
  from,
  to: path.length === 0 ? from : (path[path.length - 1] as number),
  path,
});

/** Ours: through cell 10 at sub-step 1, coming to rest on 11. */
const OURS: JointPlan = new Map([[1, candidate(1, 9, [10, 11])]]);

const reading = (lists: Array<{ id: UnitId; options: Candidate[] }>, product = 1) =>
  loudReadingOf(OURS, lists, product, false, false);

describe('the loud product', () => {
  test('an option that meets the staged footprint in sub-step time is loud', () => {
    // Enters cell 10 at sub-step 1, exactly when we cross it.
    const r = reading([{ id: 2, options: [candidate(2, 30, [10])] }]);
    expect(r.units[0]?.loud).toBe(1);
    expect(r.q).toBe(1);
  });

  test('the same cell at a different sub-step is QUIET — the window is the test', () => {
    // Cell 10 is this option's SECOND path cell, so it is there at sub-step 2
    // and we were there at sub-step 1 only: the paths cross in space and not
    // in time, and nothing it does can touch us.
    const r = reading([{ id: 2, options: [candidate(2, 30, [31, 10])] }]);
    expect(r.units[0]?.loud).toBe(0);
    expect(r.q).toBe(0);
  });

  test('a resting cell holds its window open, so a late arrival there is loud', () => {
    // We come to rest on 11, which keeps that cell to the end of the turn.
    const r = reading([{ id: 2, options: [candidate(2, 30, [31, 32, 11])] }]);
    expect(r.units[0]?.loud).toBe(1);
  });

  test('an option nowhere near the footprint is quiet, and quiet options are not counted', () => {
    const r = reading([
      {
        id: 2,
        options: [candidate(2, 30, [31]), candidate(2, 30, [10]), candidate(2, 30, [40])],
      },
    ]);
    expect(r.units[0]).toEqual({ unitId: 2, options: 3, loud: 1 });
    expect(r.q).toBe(1);
  });

  test('Q is a product over the gated units, and P rides beside it', () => {
    const r = reading(
      [
        { id: 2, options: [candidate(2, 30, [10]), candidate(2, 30, [11]), candidate(2, 30, [40])] },
        { id: 3, options: [candidate(3, 50, [11]), candidate(3, 50, [51])] },
      ],
      6,
    );
    expect(r.units.map((u) => u.loud)).toEqual([2, 1]);
    expect(r.q).toBe(2);
    expect(r.product).toBe(6);
  });

  test('a path-less candidate is gated on the cell it stands on', () => {
    const standing = reading([{ id: 2, options: [candidate(2, 11, [])] }]);
    expect(standing.units[0]?.loud).toBe(1);
    const elsewhere = reading([{ id: 2, options: [candidate(2, 40, [])] }]);
    expect(elsewhere.units[0]?.loud).toBe(0);
  });

  test('no gated unit is not a product of one — an empty list reads Q = 0', () => {
    expect(reading([]).q).toBe(0);
  });

  test('the observer sees every occasion, and only while it is installed', () => {
    const seen: number[] = [];
    const stop = observeLoud((r) => seen.push(r.q));
    reading([{ id: 2, options: [candidate(2, 30, [10])] }]);
    reading([{ id: 2, options: [candidate(2, 30, [40])] }]);
    stop();
    reading([{ id: 2, options: [candidate(2, 30, [10])] }]);
    expect(seen).toEqual([1, 0]);
  });
});
