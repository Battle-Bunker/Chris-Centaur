/**
 * The bound algebra's laws, pinned one assertion at a time.
 *
 * None of these need a board: they are the algebra, and the algebra is what
 * every measured bound is composed with. A violation here is a violation
 * everywhere, silently.
 */

import type { Assumption, LedgerEntry, ScoreBounds } from '../contracts';
import {
  BoundsInversionError,
  DEAD,
  UNKNOWN_BOUNDS,
  backupMax,
  backupMin,
  basisKeyOf,
  compareFloors,
  dominates,
  isDischarged,
  makeScoreBounds,
  normalizeAssumptions,
  onBasis,
  pointBounds,
  tighten,
  widthOf,
  withNarrowing,
} from './index';

const entry = (unitId: number, note = 'x'): LedgerEntry => ({
  unitId,
  cell: 10 + unitId,
  subStep: 1,
  polarity: 'if_present',
  note,
});

const pin = (unitId: number, to: number): Assumption => ({ kind: 'operator-pin', unitId, to });

const b = (worst: number, best: number, ledger: LedgerEntry[] = [], assumptions: Assumption[] = []): ScoreBounds =>
  makeScoreBounds({ worst, best, ledger, assumptions });

describe('construction', () => {
  test('an inverted pair is a typed error, never a clamp', () => {
    // A clamped floor is a floor the caller cannot defend. The one bug class
    // that matters has to be loud.
    expect(() => b(5, 4)).toThrow(BoundsInversionError);
    expect(() => b(5, 4)).toThrow(/inverted ScoreBounds/);
  });

  test('float drift inside epsilon collapses to a point rather than inverting', () => {
    const drifted = b(0.1 + 0.2, 0.3);
    expect(drifted.worst).toBeCloseTo(0.3, 12);
    expect(widthOf(drifted)).toBeLessThanOrEqual(0);
  });

  test('exact is DERIVED — the discharge theorem, both directions', () => {
    expect(pointBounds(7).exact).toBe(true);
    expect(b(1, 5, [entry(2)]).exact).toBe(false);
    expect(b(1, 5, [], [pin(3, 40)]).exact).toBe(false);
    expect(isDischarged(pointBounds(7))).toBe(true);
    expect(isDischarged(b(7, 7, [entry(1)]))).toBe(false);
  });

  test('a gap with nothing to blame it on is refused', () => {
    // "Nothing left to learn" and "we do not know" cannot both be true. This
    // is the shape a laundered narrowing takes when nobody checks.
    expect(() => b(1, 5)).toThrow(/must mean a point bound/);
  });

  test('UNKNOWN_BOUNDS names its ignorance instead of claiming a discharge', () => {
    expect(UNKNOWN_BOUNDS.worst).toBe(DEAD);
    expect(UNKNOWN_BOUNDS.best).toBe(Number.POSITIVE_INFINITY);
    expect(UNKNOWN_BOUNDS.exact).toBe(false);
    expect(UNKNOWN_BOUNDS.assumptions.length).toBe(1);
  });
});

describe('the basis', () => {
  test('the key is order-free and duplicate-free', () => {
    expect(basisKeyOf([pin(2, 5), pin(1, 4)])).toBe(basisKeyOf([pin(1, 4), pin(2, 5)]));
    expect(normalizeAssumptions([pin(1, 4), pin(1, 4)]).length).toBe(1);
  });

  test('two assumption kinds on the same unit are different assumptions', () => {
    const a: Assumption = { kind: 'reference-action', unitId: 1, to: 4 };
    expect(basisKeyOf([a])).not.toBe(basisKeyOf([pin(1, 4)]));
  });
});

describe('basis identity is a TYPED REFUSAL, not a false', () => {
  test('dominance across different bases refuses', () => {
    const plain = b(1, 2, [entry(1)]);
    const pinned = onBasis(b(9, 10, [entry(1)]), [pin(1, 3)]);
    const verdict = dominates(plain, pinned);
    expect(verdict.comparable).toBe(false);
    if (!verdict.comparable) expect(verdict.refusal).toBe('basis_mismatch');
    // The numbers WOULD have said "dominated". That is exactly the answer an
    // untyped comparison would have laundered into a proof.
    expect(plain.best <= pinned.worst).toBe(true);
  });

  test('dominance on a shared basis answers', () => {
    const low = onBasis(b(1, 2, [entry(1)]), [pin(1, 3)]);
    const high = onBasis(b(9, 10, [entry(1)]), [pin(1, 3)]);
    expect(dominates(low, high)).toEqual({ comparable: true, dominated: true });
    expect(dominates(high, low)).toEqual({ comparable: true, dominated: false });
  });

  test('floor comparison refuses across bases too', () => {
    expect(compareFloors(b(1, 2, [entry(1)]), withNarrowing(b(1, 2, [entry(1)]), { kind: 'narrowing', unitId: 4, note: 'k' })).comparable).toBe(false);
  });

  test('tighten refuses across bases', () => {
    const out = tighten(b(1, 9, [entry(1)]), onBasis(b(3, 5, [entry(1)]), [pin(2, 2)]));
    expect(out.ok).toBe(false);
  });
});

describe('backup — each bound is its own game', () => {
  test('MAX takes max lo and max hi from DIFFERENT children', () => {
    // Child A has the better floor, child B the better ceiling. A backup that
    // selected a child by lo and took its hi along would report [4, 6].
    const out = backupMax([b(4, 6, [entry(1)]), b(2, 9, [entry(2)])]);
    expect(out.worst).toBe(4);
    expect(out.best).toBe(9);
  });

  test('MIN takes min lo and min hi from DIFFERENT children', () => {
    const out = backupMin([b(4, 6, [entry(1)]), b(2, 9, [entry(2)])]);
    expect(out.worst).toBe(2);
    expect(out.best).toBe(6);
  });

  test('a MIN over exact children stays exact', () => {
    const out = backupMin([pointBounds(3), pointBounds(-1), pointBounds(7)]);
    expect(out).toMatchObject({ worst: -1, best: -1, exact: true });
  });

  test('an assumption on ANY child contaminates the whole min', () => {
    // The min could sit inside the conditional child's true (unknown) value,
    // so the result is conditional whether or not that child set an endpoint.
    const out = backupMin([
      pointBounds(3),
      withNarrowing(b(5, 9, [entry(2)]), { kind: 'narrowing', unitId: 2, note: 'capped' }),
    ]);
    expect(out.worst).toBe(3);
    expect(out.assumptions.length).toBe(1);
    expect(out.exact).toBe(false);
  });

  test('a ledger entry on a LOSING child does not suppress a discharge', () => {
    // The endpoint-setting child proved a point; the other child's ledger
    // explains a gap this answer does not have.
    const out = backupMin([pointBounds(3), b(5, 9, [entry(2)])]);
    expect(out).toMatchObject({ worst: 3, best: 3, exact: true });
  });
});

describe('tighten — two independent statements about one quantity', () => {
  test('the floor rises and the ceiling falls', () => {
    const out = tighten(b(1, 9, [entry(1)]), b(3, 5, [entry(2)]));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.bounds).toMatchObject({ worst: 3, best: 5 });
  });

  test('a point statement discharges the pair', () => {
    const out = tighten(pointBounds(4), b(1, 9, [entry(1)]));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.bounds).toMatchObject({ worst: 4, best: 4, exact: true });
  });

  test('contradictory statements are an error, not a clamp', () => {
    expect(() => tighten(b(6, 9, [entry(1)]), b(1, 4, [entry(2)]))).toThrow(BoundsInversionError);
  });
});

describe('declared narrowing', () => {
  test('a min-side restriction rides the bounds and kills exactness', () => {
    const declared = withNarrowing(pointBounds(3), { kind: 'narrowing', unitId: 8, note: 'top-2 replies only' });
    expect(declared.exact).toBe(false);
    expect(declared.assumptions).toHaveLength(1);
    // And it is now incomparable with the unconditional statement it came from.
    expect(compareFloors(declared, pointBounds(3)).comparable).toBe(false);
  });

  test('declaring the same narrowing twice does not widen the basis', () => {
    const n: Assumption = { kind: 'narrowing', unitId: 8, note: 'top-2 replies only' };
    expect(withNarrowing(withNarrowing(pointBounds(3), n), n).assumptions).toHaveLength(1);
  });
});
