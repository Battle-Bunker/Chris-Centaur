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
  normalizeLedger,
  onBasis,
  pointBounds,
  tighten,
  unionAssumptions,
  unionLedgers,
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

// ---------------------------------------------------------------------------
// THE CANONICAL REGISTER, AND THE INTERNING AROUND IT
//
// These pin the exact behaviour the W2 allocation work leans on: normalisation
// is idempotent, and the SHORTCUTS taken because it is idempotent produce the
// same array a full normalisation would. Every one of them is a place where a
// wrong answer would be a wrong bound identity, not a slow one.
// ---------------------------------------------------------------------------

describe('ledger normalisation', () => {
  const led = (unitId: number, cell: number, subStep = 1, note = 'n'): LedgerEntry => ({
    unitId,
    cell,
    subStep,
    polarity: 'if_present',
    note,
  });

  test('orders by the STRING key, which is not the numeric one', () => {
    // "10:..." sorts before "9:..." as a string and after it as a number. The
    // string order is the one a bound's identity is built on.
    const out = normalizeLedger([led(9, 1), led(10, 1)]);
    expect(out.map((e) => e.unitId)).toEqual([10, 9]);
  });

  test('deduplicates on (unitId, cell, subStep, polarity), keeping the FIRST', () => {
    const first = led(3, 7, 1, 'first');
    const second = led(3, 7, 1, 'second');
    const out = normalizeLedger([first, second, led(1, 2)]);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.unitId === 3)?.note).toBe('first');
  });

  test('keeps the first occurrence even when the duplicates straddle a sort move', () => {
    const a = led(2, 5, 1, 'A');
    const b2 = led(2, 5, 1, 'B');
    const out = normalizeLedger([led(9, 9), a, led(1, 1), b2]);
    expect(out.filter((e) => e.unitId === 2).map((e) => e.note)).toEqual(['A']);
  });

  test('is idempotent, and re-normalising returns the SAME array', () => {
    const once = normalizeLedger([led(9, 1), led(10, 1), led(9, 1)]);
    const twice = normalizeLedger(once);
    expect(twice).toBe(once);
    expect(twice.map((e) => e.unitId)).toEqual([10, 9]);
  });

  test('the shortcut agrees with a full normalisation of an unregistered copy', () => {
    const raw = [led(9, 1), led(10, 1), led(2, 3), led(9, 1), led(10, 1)];
    const once = normalizeLedger(raw);
    // A structurally identical array the register has never seen takes the
    // long path; the two must agree entry for entry and in order.
    const fresh = normalizeLedger(raw.map((e) => ({ ...e })));
    expect(fresh.map((e) => `${e.unitId}:${e.cell}:${e.subStep}`)).toEqual(
      once.map((e) => `${e.unitId}:${e.cell}:${e.subStep}`),
    );
  });

  test('a union of one canonical ledger with itself is that ledger', () => {
    const one = normalizeLedger([led(4, 4), led(3, 3)]);
    expect(unionLedgers(one, one)).toBe(one);
    expect(unionLedgers(one, [])).toBe(one);
    expect(unionLedgers([], one)).toBe(one);
  });

  test('a union of two DIFFERENT ledgers is still a full normalisation', () => {
    const a = normalizeLedger([led(4, 4), led(3, 3)]);
    const c = normalizeLedger([led(5, 5), led(3, 3)]);
    const u = unionLedgers(a, c);
    expect(u.map((e) => e.unitId)).toEqual([3, 4, 5]);
  });

  test('a bound built from an already-normalised ledger carries it unchanged', () => {
    const one = normalizeLedger([led(9, 1), led(10, 1)]);
    expect(makeScoreBounds({ worst: 0, best: 1, ledger: one }).ledger).toBe(one);
  });
});

describe('assumption normalisation and basis keys', () => {
  test('normalisation is idempotent and returns the SAME array', () => {
    const once = normalizeAssumptions([pin(2, 5), pin(1, 4), pin(2, 5)]);
    expect(normalizeAssumptions(once)).toBe(once);
    expect(once).toHaveLength(2);
  });

  test('a union over one canonical basis is that basis', () => {
    const basis = normalizeAssumptions([pin(2, 5), pin(1, 4)]);
    expect(unionAssumptions(basis, basis, basis)).toBe(basis);
    expect(unionAssumptions(basis, [])).toBe(basis);
  });

  test('a union that really adds something still normalises', () => {
    const basis = normalizeAssumptions([pin(1, 4)]);
    const wider = unionAssumptions(basis, [pin(2, 5)]);
    expect(wider).toHaveLength(2);
    expect(basisKeyOf(wider)).not.toBe(basisKeyOf(basis));
  });

  test('the cached basis key is the key a fresh array would get', () => {
    const a = [pin(2, 5), pin(1, 4)];
    const first = basisKeyOf(a);
    expect(basisKeyOf(a)).toBe(first);
    expect(basisKeyOf([pin(2, 5), pin(1, 4)])).toBe(first);
    // ...and it is order-free.
    expect(basisKeyOf([pin(1, 4), pin(2, 5)])).toBe(first);
  });

  test('the empty basis is the empty key', () => {
    expect(basisKeyOf([])).toBe('');
  });
});

describe('the provenance note is lazy', () => {
  test('a thunk is not called when the bound is fine', () => {
    let calls = 0;
    makeScoreBounds({
      worst: 1,
      best: 2,
      ledger: [{ unitId: 1, cell: 1, subStep: 1, polarity: 'if_present', note: 'n' }],
      note: () => {
        calls++;
        return 'expensive';
      },
    });
    expect(calls).toBe(0);
  });

  test('a thunk IS called when the bound inverts, and its text reaches the error', () => {
    let calls = 0;
    expect(() =>
      makeScoreBounds({
        worst: 9,
        best: 1,
        note: () => {
          calls++;
          return 'B2 branch 7>3';
        },
      }),
    ).toThrow(/B2 branch 7>3/);
    expect(calls).toBe(1);
  });

  test('a plain string still works, on both error paths', () => {
    expect(() => makeScoreBounds({ worst: 9, best: 1, note: 'plain' })).toThrow(/plain/);
    expect(() => makeScoreBounds({ worst: 0, best: 5, note: 'plain' })).toThrow(/plain/);
  });
});
