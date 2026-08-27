/**
 * THE CONFLICT INDEX, and the budget it has to stay inside.
 *
 * Four claims:
 *
 *   KEYED     a slot is `(cell, subStep)`, so two units crossing one cell at
 *             DIFFERENT sub-steps are not in the same slot and never read as a
 *             conflict. This is the case a destination-only predicate gets
 *             wrong, and getting it wrong in the excluding direction is how a
 *             team gets boxed in.
 *   STANDING  a unit that has come to rest is a participant at every LATER
 *             sub-step, because a cell contest is a strict maximum over the
 *             whole pile and the engine registers incumbents whether they
 *             advanced or not.
 *   EXACT     the edge exchange is decided by the `from` column an arrival
 *             already carries, with no second structure.
 *   CHEAP     the build is measured against the naive pair table it replaces.
 */

import { ConflictIndex, MAX_SUB_STEPS, NO_CLAIM, subStepOf, subStepsFor } from './conflict-index';
import type { CellIndex, UnitId } from '../contracts';

const CELLS = 121; // an 11x11 grid

const claimants = (index: ConflictIndex, cell: number, step: number): UnitId[] => {
  const out: UnitId[] = [];
  for (let c = index.firstAt(cell as CellIndex, step); c !== NO_CLAIM; c = index.next(c)) {
    out.push(index.unitAt(c));
  }
  return out.sort((a, b) => a - b);
};

describe('the slot is (cell, subStep)', () => {
  it('puts two arrivals on one cell at one sub-step in the same slot', () => {
    const index = new ConflictIndex();
    index.begin(CELLS, 2);
    index.claim(1 as UnitId, 10 as CellIndex, [20 as CellIndex]);
    index.claim(2 as UnitId, 30 as CellIndex, [20 as CellIndex]);
    expect(claimants(index, 20, 1)).toEqual([1, 2]);
    expect(index.countAt(20 as CellIndex, 1)).toBe(2);
  });

  it('does NOT collide two rays that cross one cell at different sub-steps', () => {
    // The whole reason the sub-step is in the key. A destination-only or
    // sub-step-blind index reports a conflict here and there is none: the
    // first unit has already left when the second arrives.
    const index = new ConflictIndex();
    index.begin(CELLS, subStepsFor([[41, 42, 43], [51, 52, 42]] as CellIndex[][]));
    index.claim(1 as UnitId, 40 as CellIndex, [41, 42, 43] as CellIndex[]);
    index.claim(2 as UnitId, 50 as CellIndex, [51, 52, 42] as CellIndex[]);
    // Unit 1 is at 42 on sub-step 2; unit 2 arrives there on sub-step 3.
    expect(claimants(index, 42, 2)).toEqual([1]);
    expect(claimants(index, 42, 3)).toEqual([2]);
    // ...and nowhere do they share a slot while unit 1 is still moving.
    expect(index.countAt(42 as CellIndex, 1)).toBe(0);
  });

  it('reports an empty slot for a sub-step this generation does not index', () => {
    const index = new ConflictIndex();
    index.begin(CELLS, 2);
    index.claim(1 as UnitId, 10 as CellIndex, [20 as CellIndex]);
    expect(index.firstAt(20 as CellIndex, 9)).toBe(NO_CLAIM);
    expect(index.firstAt(20 as CellIndex, 0)).toBe(NO_CLAIM);
    expect(index.firstAt(-1 as CellIndex, 1)).toBe(NO_CLAIM);
  });

  it('refuses a sub-step bound it cannot honour, rather than truncating quietly', () => {
    const index = new ConflictIndex();
    expect(() => index.begin(CELLS, 1)).toThrow(/2\.\./);
    expect(() => index.begin(CELLS, MAX_SUB_STEPS + 1)).toThrow(/2\.\./);
    expect(() => index.begin(0, 2)).toThrow(/positive cell count/);
    expect(() => index.claim(1 as UnitId, 0 as CellIndex, [])).toThrow(/before begin/);
  });
});

describe('a rester is an incumbent', () => {
  it('holds its cell at every sub-step, so a later arrival contests it', () => {
    const index = new ConflictIndex();
    index.begin(CELLS, 5);
    index.claim(1 as UnitId, 60 as CellIndex, []); // holds
    index.claim(2 as UnitId, 20 as CellIndex, [21, 22, 60] as CellIndex[]); // arrives at s=3
    for (let s = 1; s < 5; s++) expect(claimants(index, 60, s)).toContain(1);
    expect(claimants(index, 60, 3)).toEqual([1, 2]);
    // And the arrival is itself standing there afterwards.
    expect(claimants(index, 60, 4)).toEqual([1, 2]);
  });

  it('marks the difference between passing through and standing there', () => {
    const index = new ConflictIndex();
    index.begin(CELLS, 4);
    index.claim(1 as UnitId, 10 as CellIndex, [11, 12] as CellIndex[]);
    const passing = index.firstAt(11 as CellIndex, 1);
    const landed = index.firstAt(12 as CellIndex, 3);
    expect(index.restingAt(passing)).toBe(false);
    expect(index.restingAt(landed)).toBe(true);
    expect(index.restingAt(index.firstAt(12 as CellIndex, 2))).toBe(false);
  });

  it('a plan of holders is the cheapest shape there is', () => {
    const index = new ConflictIndex();
    index.begin(CELLS, 2);
    for (let u = 0; u < 6; u++) index.claim(u as UnitId, (u * 7) as CellIndex, []);
    expect(index.size).toBe(6);
  });
});

describe('the edge exchange', () => {
  it('is read off the `from` column, at the same sub-step only', () => {
    const index = new ConflictIndex();
    index.begin(CELLS, 3);
    index.claim(1 as UnitId, 40 as CellIndex, [41 as CellIndex]);
    index.claim(2 as UnitId, 41 as CellIndex, [40 as CellIndex]);
    const partner = index.swapPartnerAt(40 as CellIndex, 41 as CellIndex, 1, 1 as UnitId);
    expect(partner).not.toBe(NO_CLAIM);
    expect(index.unitAt(partner)).toBe(2);
    // Symmetric, as an exchange must be.
    expect(index.unitAt(index.swapPartnerAt(41 as CellIndex, 40 as CellIndex, 1, 2 as UnitId))).toBe(
      1,
    );
  });

  it('is not an exchange when the two cross at different sub-steps', () => {
    const index = new ConflictIndex();
    index.begin(CELLS, 5);
    index.claim(1 as UnitId, 40 as CellIndex, [41 as CellIndex]);
    index.claim(2 as UnitId, 60 as CellIndex, [50, 41, 40] as CellIndex[]);
    // Unit 2 reaches 40 at sub-step 3, having come from 41 — but unit 1 made
    // its crossing at sub-step 1 and is not there to exchange with.
    expect(index.swapPartnerAt(40 as CellIndex, 41 as CellIndex, 1, 1 as UnitId)).toBe(NO_CLAIM);
  });

  it('is not an exchange with a unit that is merely standing there', () => {
    const index = new ConflictIndex();
    index.begin(CELLS, 3);
    index.claim(2 as UnitId, 40 as CellIndex, []); // holds on 40
    expect(index.swapPartnerAt(40 as CellIndex, 41 as CellIndex, 1, 1 as UnitId)).toBe(NO_CLAIM);
  });
});

describe('the generation stamp', () => {
  it('empties every slot without clearing anything', () => {
    const index = new ConflictIndex();
    index.begin(CELLS, 2);
    index.claim(1 as UnitId, 10 as CellIndex, [20 as CellIndex]);
    expect(index.countAt(20 as CellIndex, 1)).toBe(1);
    index.begin(CELLS, 2);
    expect(index.countAt(20 as CellIndex, 1)).toBe(0);
    expect(index.size).toBe(0);
  });

  it('survives a board and a sub-step bound that grow', () => {
    const index = new ConflictIndex(16, 2, 8);
    index.begin(16, 2);
    index.claim(1 as UnitId, 3 as CellIndex, [4 as CellIndex]);
    index.begin(529, 13);
    for (let u = 0; u < 12; u++) {
      index.claim(u as UnitId, (u * 11) as CellIndex, [u * 11 + 1, u * 11 + 2] as CellIndex[]);
    }
    expect(index.countAt(1 as CellIndex, 1)).toBe(1);
    expect(index.countAt(4 as CellIndex, 1)).toBe(0); // the old generation is gone
    // Every claim wrote its arrivals plus its rest slots.
    expect(index.size).toBe(12 * (2 + (13 - 3)));
  });

  it('otherAt skips the asking unit and finds the first foreign claim', () => {
    const index = new ConflictIndex();
    index.begin(CELLS, 3);
    index.claim(1 as UnitId, 10 as CellIndex, [20 as CellIndex]);
    index.claim(2 as UnitId, 30 as CellIndex, [20 as CellIndex]);
    expect(index.unitAt(index.otherAt(20 as CellIndex, 1, 1 as UnitId))).toBe(2);
    expect(index.unitAt(index.otherAt(20 as CellIndex, 1, 2 as UnitId))).toBe(1);
    expect(index.otherAt(20 as CellIndex, 1, 3 as UnitId)).not.toBe(NO_CLAIM);
  });
});

describe('the sub-step arithmetic lives in one place', () => {
  it('enters path[i] at sub-step i+1', () => {
    expect(subStepOf(0)).toBe(1);
    expect(subStepOf(7)).toBe(8);
  });

  it('sizes the bound off the longest path, and never below one sub-step', () => {
    expect(subStepsFor([])).toBe(2);
    expect(subStepsFor([[] as CellIndex[]])).toBe(2);
    expect(subStepsFor([[1, 2, 3] as CellIndex[], [1] as CellIndex[]])).toBe(4);
    // A path longer than the structure can index is clamped, never overflowed.
    const huge = new Array<CellIndex>(999).fill(1 as CellIndex);
    expect(subStepsFor([huge])).toBe(MAX_SUB_STEPS);
  });
});

// ---------------------------------------------------------------------------

/**
 * THE BUDGET.
 *
 * The design rests on one ratio: the index build must be a rounding error
 * against the pair table it replaces (measured at 8–150 µs per decision) and
 * against one `scorePlan` (≈200 µs).
 *
 * MEASURED, compiled and standalone under `nice -n 10` on the build box:
 * 0.205 / 0.308 / 0.398 / 0.663 / 0.937 µs for the five shapes below — inside
 * the 0.12–0.94 µs the design was costed at. Under ts-jest the same builds
 * read 1.3–2.2 µs, which is the harness and not the structure (the empty-body
 * floor is 6× higher here too). The ceilings are therefore set against the
 * IN-HARNESS number with room for a loaded box: they exist to catch a rewrite
 * that reintroduces the quadratic, not to police a nanosecond.
 */
describe('the budget', () => {
  interface Shape {
    readonly name: string;
    readonly units: number;
    readonly pathLen: number;
    /** The sub-step bound the decision's longest path forces on everyone. */
    readonly steps: number;
    readonly ceilingUs: number;
  }

  const shapes: ReadonlyArray<Shape> = [
    { name: 'snake-only 6u path1', units: 6, pathLen: 1, steps: 2, ceilingUs: 12 },
    { name: 'mixed 5u path3', units: 5, pathLen: 3, steps: 4, ceilingUs: 12 },
    { name: 'piece-heavy 6u path6', units: 6, pathLen: 6, steps: 7, ceilingUs: 12 },
    { name: 'worst seen 8u path8', units: 8, pathLen: 8, steps: 9, ceilingUs: 20 },
    // The rest-write case: six trail units on a board that also carries a
    // slider with an 11-cell ray, so every holder is an incumbent for eleven
    // sub-steps. This is the shape that pays the most per unit.
    { name: 'six trail units under an 11-ray', units: 6, pathLen: 1, steps: 12, ceilingUs: 20 },
  ];

  /** The staged plan, built ONCE: the bench measures the index, not `push`. */
  const planFor = (shape: Shape): ReadonlyArray<{ from: CellIndex; path: CellIndex[] }> => {
    const out: Array<{ from: CellIndex; path: CellIndex[] }> = [];
    for (let u = 0; u < shape.units; u++) {
      const from = ((u * 37) % 400) + 24;
      const path: CellIndex[] = [];
      for (let i = 1; i <= shape.pathLen; i++) path.push(((from + i) % 500) as CellIndex);
      out.push({ from: from as CellIndex, path });
    }
    return out;
  };

  const build = (
    index: ConflictIndex,
    shape: Shape,
    plan: ReadonlyArray<{ from: CellIndex; path: CellIndex[] }>,
  ): void => {
    index.begin(529, shape.steps);
    for (let u = 0; u < plan.length; u++) {
      const entry = plan[u] as { from: CellIndex; path: CellIndex[] };
      index.claim(u as UnitId, entry.from, entry.path);
    }
  };

  /** The shape being replaced: every ordered pair of (unit, candidate, cell). */
  const naive = (shape: Shape, cap: number): number => {
    let touched = 0;
    for (let u = 0; u < shape.units; u++) {
      for (let v = u + 1; v < shape.units; v++) {
        for (let a = 0; a < cap; a++) {
          for (let b = 0; b < cap; b++) {
            for (let i = 0; i < shape.pathLen; i++) {
              for (let j = 0; j < shape.pathLen; j++) {
                if (((u * 37 + a + i) % 500) === ((v * 37 + b + j) % 500)) touched++;
              }
            }
          }
        }
      }
    }
    return touched;
  };

  const timeUs = (fn: () => void, iters: number): number => {
    for (let i = 0; i < 200; i++) fn(); // warm
    let best = Infinity;
    for (let round = 0; round < 5; round++) {
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < iters; i++) fn();
      const us = Number(process.hrtime.bigint() - t0) / 1000 / iters;
      if (us < best) best = us;
    }
    return best;
  };

  for (const shape of shapes) {
    it(`builds ${shape.name} inside its ceiling`, () => {
      const index = new ConflictIndex(529, 16, 256);
      const plan = planFor(shape);
      const us = timeUs(() => build(index, shape, plan), 20000);
      // Reported so a regression bisect has the number, not just the verdict.
      console.log(`  index build ${shape.name}: ${us.toFixed(3)} µs`);
      expect(us).toBeLessThan(shape.ceilingUs);
    });
  }

  it('is far cheaper than the pair table it replaces', () => {
    const shape = shapes[2] as Shape;
    const index = new ConflictIndex(529, 16, 256);
    const plan = planFor(shape);
    const indexUs = timeUs(() => build(index, shape, plan), 20000);
    let sink = 0;
    const naiveUs = timeUs(() => {
      sink += naive(shape, 8);
    }, 20);
    console.log(`  index ${indexUs.toFixed(3)} µs vs naive pair table ${naiveUs.toFixed(3)} µs`);
    expect(sink).toBeGreaterThanOrEqual(0);
    // A ratio, not an absolute: it is the same box, the same process, and the
    // same round. The memo's own numbers put this at 40–400×; a build that
    // came within 5× of the quadratic has stopped being an index.
    expect(naiveUs / indexUs).toBeGreaterThan(5);
  });
});
