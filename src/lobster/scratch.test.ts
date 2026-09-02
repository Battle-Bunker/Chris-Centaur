import { cmpLex, scalarOf } from '../partial-engine/index';
import type { Scalar } from '../partial-engine/index';
import {
  DenseRanker,
  Int32Column,
  SlabPool,
  StampedInt32,
  StampedSet,
  Uint8Column,
} from './scratch';

describe('StampedInt32', () => {
  it('reads as empty before anything is written', () => {
    const b = new StampedInt32(8);
    b.begin();
    for (let i = 0; i < 8; i++) {
      expect(b.has(i)).toBe(false);
      expect(b.get(i, -7)).toBe(-7);
    }
  });

  it('reads back what this generation wrote', () => {
    const b = new StampedInt32(8);
    b.begin();
    b.set(3, 42);
    expect(b.has(3)).toBe(true);
    expect(b.get(3, -1)).toBe(42);
    expect(b.get(4, -1)).toBe(-1);
  });

  it('forgets the previous generation on begin(), without touching memory', () => {
    const b = new StampedInt32(8);
    b.begin();
    b.set(3, 42);
    b.begin();
    expect(b.has(3)).toBe(false);
    expect(b.get(3, -1)).toBe(-1);
    // ...and the raw store still holds the stale value, which is exactly why
    // `raw` is documented as unsafe outside a proved write-set superset.
    expect(b.raw[3]).toBe(42);
  });

  it('setMin keeps the smallest and reports whether it changed', () => {
    const b = new StampedInt32(4);
    b.begin();
    expect(b.setMin(0, 5)).toBe(true);
    expect(b.setMin(0, 7)).toBe(false);
    expect(b.get(0, -1)).toBe(5);
    expect(b.setMin(0, 2)).toBe(true);
    expect(b.get(0, -1)).toBe(2);
  });

  it('survives the generation wrap without resurrecting a stale slot', () => {
    const b = new StampedInt32(4);
    b.begin();
    b.set(1, 99);
    // Drive the counter to the last generation before the wrap. Reaching into
    // the private field is the only way to exercise the branch that would
    // otherwise take 1.2 days of continuous search to reach.
    (b as unknown as { gen: number }).gen = 0x7ffffffe;
    b.begin(); // gen = 0x7fffffff
    b.set(2, 7);
    expect(b.get(2, -1)).toBe(7);
    b.begin(); // wraps to 1, stamps cleared
    expect(b.wraps).toBe(1);
    for (let i = 0; i < 4; i++) expect(b.has(i)).toBe(false);
    b.set(0, 3);
    expect(b.get(0, -1)).toBe(3);
    expect(b.get(2, -1)).toBe(-1);
  });

  it('refuses a nonsense size', () => {
    expect(() => new StampedInt32(-1)).toThrow(RangeError);
    expect(() => new StampedInt32(1.5)).toThrow(RangeError);
  });
});

describe('StampedSet', () => {
  it('is a set with an O(1) clear', () => {
    const s = new StampedSet(16);
    s.begin();
    expect(s.add(4)).toBe(true);
    expect(s.add(4)).toBe(false);
    expect(s.has(4)).toBe(true);
    s.begin();
    expect(s.has(4)).toBe(false);
    expect(s.add(4)).toBe(true);
  });

  it('a fresh buffer is empty at generation 1', () => {
    const s = new StampedSet(4);
    s.begin();
    expect(s.generation).toBe(1);
    for (let i = 0; i < 4; i++) expect(s.has(i)).toBe(false);
  });
});

describe('SlabPool', () => {
  it('hands back the SAME slab for the same index', () => {
    const p = new SlabPool<Uint32Array>(3, (n) => new Uint32Array(n));
    const a = p.at(2);
    expect(a.length).toBe(3);
    expect(p.at(2)).toBe(a);
    expect(p.allocated).toBe(3);
    p.at(5);
    expect(p.allocated).toBe(6);
    expect(p.at(2)).toBe(a);
  });
});

describe('Int32Column / Uint8Column', () => {
  it('grows by doubling and keeps the same object while it fits', () => {
    const c = new Int32Column(4);
    const a = c.ensure(3);
    expect(a).toBe(c.array);
    expect(c.ensure(4)).toBe(a);
    const b = c.ensure(5);
    expect(b).not.toBe(a);
    expect(b.length).toBe(8);
    expect(c.ensure(9).length).toBe(16);
  });

  it('the byte column does the same', () => {
    const c = new Uint8Column(2);
    const a = c.ensure(2);
    expect(c.ensure(3)).not.toBe(a);
    expect(c.array.length).toBe(4);
  });
});

describe('DenseRanker', () => {
  /** The ranking contract, checked pairwise against the comparator itself. */
  function checkAgainst(values: ReadonlyArray<Scalar>): void {
    const r = new DenseRanker<Scalar>();
    r.reset();
    for (const v of values) r.add(v);
    const ranks = r.rank(cmpLex);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < values.length; j++) {
        const c = cmpLex(values[i] as Scalar, values[j] as Scalar);
        const d = (ranks[i] as number) - (ranks[j] as number);
        expect(Math.sign(d)).toBe(Math.sign(c));
      }
    }
  }

  it('orders and ties exactly as the comparator does', () => {
    checkAgainst([
      scalarOf(0, 3),
      scalarOf(1, 1),
      scalarOf(0, 3),
      scalarOf(0, 1),
      scalarOf(2, 0),
      scalarOf(1, 9),
    ]);
  });

  it('handles the degenerate batches', () => {
    checkAgainst([]);
    checkAgainst([scalarOf(1, 1)]);
    checkAgainst([scalarOf(1, 1), scalarOf(1, 1), scalarOf(1, 1)]);
  });

  it('is exact for values a bit-packed key would corrupt', () => {
    // Negative tiers, fractional weights, weights past 2^16 — every one of
    // which breaks `(tier << 16) | weight`, and none of which breaks a ranking
    // computed by calling the comparator.
    checkAgainst([
      scalarOf(-1, 70000),
      scalarOf(0, 0.5),
      scalarOf(0, 0.25),
      scalarOf(-1, 69999),
      scalarOf(0, 65536),
      scalarOf(3, -2),
    ]);
  });

  it('ranks are dense and start at zero', () => {
    const r = new DenseRanker<Scalar>();
    for (const v of [scalarOf(5, 5), scalarOf(1, 1), scalarOf(5, 5), scalarOf(3, 3)]) r.add(v);
    const ranks = r.rank(cmpLex);
    expect([...ranks.slice(0, 4)]).toEqual([2, 0, 2, 1]);
  });

  it('reset() reuses the batch and a random batch always agrees', () => {
    const r = new DenseRanker<Scalar>();
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let trial = 0; trial < 50; trial++) {
      const n = 1 + Math.floor(rnd() * 30);
      const vs: Scalar[] = [];
      r.reset();
      for (let i = 0; i < n; i++) {
        const v = scalarOf(Math.floor(rnd() * 3), Math.floor(rnd() * 5));
        vs.push(v);
        r.add(v);
      }
      expect(r.count).toBe(n);
      const ranks = r.rank(cmpLex);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          expect(Math.sign((ranks[i] as number) - (ranks[j] as number))).toBe(
            Math.sign(cmpLex(vs[i] as Scalar, vs[j] as Scalar)),
          );
        }
      }
    }
  });
});
