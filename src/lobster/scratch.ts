/**
 * GENERATION-STAMPED SCRATCH — the O(1) clear.
 *
 * Every hot kernel in this layer wants the same thing: a per-cell (or per-unit)
 * buffer that is written sparsely, read sparsely, and must look EMPTY at the
 * start of each use. The two obvious answers are both wrong on the hot path:
 *
 *   - allocate a fresh array per use → garbage at ten thousand uses a second,
 *     and the evaluator's GC share was measured at 13.2% of a one-second
 *     decision before this module existed;
 *   - keep one array and `fill()` it → an O(cells) clear to service an O(k)
 *     write set, paid whether or not anything was written.
 *
 * The answer here is the standard one: keep a parallel STAMP array, bump a
 * generation counter per use, and treat a slot whose stamp is not the current
 * generation as absent. Clearing is one integer increment. The only real cost
 * is one extra word per slot and one extra store per write.
 *
 * ── WHY THIS IS A MODULE AND NOT A LOCAL TRICK ─────────────────────────────
 *
 * Three consumers want it already — the territory evaluator's decisive-turn
 * grid, the pair-team memo's cell-claim index, and the cheap-heuristic ladder's
 * per-cell scores — and a generation counter is exactly the kind of thing that
 * is written four times, wrapped correctly in three of them, and produces a
 * silent stale read in the fourth. The wrap is handled ONCE, here, and it is
 * tested.
 *
 * ── THE WRAP, WHICH IS THE ONLY SUBTLE PART ────────────────────────────────
 *
 * A stamp array is `Int32Array`, so the generation counter cannot run past
 * 2^31 − 1 without aliasing an old stamp and resurrecting a stale slot. At the
 * measured rate (two `begin()` calls per evaluation, ~10^4 evaluations a
 * second) that is ~1.2 days of continuous search per buffer — long enough that
 * nothing would ever catch it in a test and short enough that a long-lived
 * process really would reach it. So `begin()` checks, and on overflow pays one
 * genuine `fill(0)` and restarts at 1. Generation 0 is never live, which is
 * what makes a freshly allocated (all-zero) stamp array read as empty.
 */

/** Shared by every stamped buffer: the counter and its wrap. */
abstract class Stamped {
  protected readonly stamp: Int32Array;
  /** The live generation. Never 0 — see the header. */
  protected gen = 0;
  readonly size: number;

  // Not `protected`: `StampedSet` adds nothing to it, and a subclass whose only
  // body is a constructor that forwards its argument is a lint error waiting to
  // happen. The class is abstract and unexported, so nothing can construct it.
  constructor(size: number) {
    if (!Number.isInteger(size) || size < 0) {
      throw new RangeError(`stamped scratch needs a non-negative integer size, got ${size}`);
    }
    this.size = size;
    this.stamp = new Int32Array(size);
  }

  /**
   * Start a new use: every slot reads as absent again. O(1), except on the one
   * call in 2^31 − 1 that has to reset the stamps.
   */
  begin(): void {
    if (this.gen === 0x7fffffff) {
      this.stamp.fill(0);
      this.gen = 1;
      this.wraps++;
      return;
    }
    this.gen++;
  }

  /** Has `i` been written in the CURRENT generation? */
  has(i: number): boolean {
    return this.stamp[i] === this.gen;
  }

  /** The current generation, for a caller keeping its own parallel stamps. */
  get generation(): number {
    return this.gen;
  }

  /** Number of `begin()` calls that had to pay the O(size) reset. Telemetry. */
  wraps = 0;
}

/**
 * An `Int32Array` with an O(1) clear.
 *
 * `get` takes the value to report for an unwritten slot rather than baking one
 * in, because the two consumers in this repository want different ones (a
 * `NEVER` turn sentinel and a −1 index) and a buffer that hard-codes either is
 * a buffer the other one has to remember to special-case.
 */
export class StampedInt32 extends Stamped {
  private readonly buf: Int32Array;

  constructor(size: number) {
    super(size);
    this.buf = new Int32Array(size);
  }

  get(i: number, absent: number): number {
    return this.stamp[i] === this.gen ? (this.buf[i] as number) : absent;
  }

  set(i: number, v: number): void {
    this.stamp[i] = this.gen;
    this.buf[i] = v;
  }

  /**
   * Write `v` only if the slot is absent or currently holds something larger —
   * the "keep the earliest" idiom, which is what every arrival stamp wants.
   * Returns true when the slot changed.
   */
  setMin(i: number, v: number): boolean {
    if (this.stamp[i] === this.gen) {
      if ((this.buf[i] as number) <= v) return false;
      this.buf[i] = v;
      return true;
    }
    this.stamp[i] = this.gen;
    this.buf[i] = v;
    return true;
  }

  /**
   * The raw backing store. For a consumer that has ALREADY established that
   * every index it will read was written this generation — the territory
   * evaluator reads its decisive grid only over the cells the same sweep just
   * stamped — and wants the read without the stamp compare. Using this on an
   * unstamped index reads the PREVIOUS generation's value, silently: only
   * reach for it where the write set is a proved superset of the read set.
   */
  get raw(): Int32Array {
    return this.buf;
  }
}

/**
 * A membership set over `[0, size)` with an O(1) clear — the stamp array on its
 * own, with no payload. `add` twice is idempotent, which is what a "cells this
 * plan claims" index wants.
 */
export class StampedSet extends Stamped {
  /** Returns true when `i` was NOT already present this generation. */
  add(i: number): boolean {
    if (this.stamp[i] === this.gen) return false;
    this.stamp[i] = this.gen;
    return true;
  }
}

/**
 * A pool of reusable, GROWING typed arrays keyed by a small integer slot.
 *
 * The territory workspace grows one ownership plane per admitted trail unit and
 * one `seen`/`multi` pair per team; both are "give me the k-th buffer of this
 * length, allocating only the first time". Written once here rather than three
 * times as `while (arr.length <= k) arr.push(new Uint32Array(n))`.
 */
export class SlabPool<T extends Uint32Array | Int32Array | Float64Array> {
  private readonly slabs: T[] = [];
  constructor(
    private readonly length: number,
    private readonly make: (n: number) => T,
  ) {}

  /** The k-th slab, allocated on first ask. Never null. */
  at(k: number): T {
    while (this.slabs.length <= k) this.slabs.push(this.make(this.length));
    return this.slabs[k] as T;
  }

  /** How many slabs exist. Telemetry — a pool that keeps growing is a leak. */
  get allocated(): number {
    return this.slabs.length;
  }
}

/**
 * WHERE A BUFFER COMES FROM.
 *
 * `null` means "I could not give you one" — never an error. The one caller that
 * passes a non-default allocator is the territory workspace under
 * `CENTAUR_WASM=on`, where a slab is a view onto a fixed-size WebAssembly linear
 * memory (`lobster/wasm/arena.ts`); when that memory is full the column takes an
 * ordinary heap array instead and the wasm path simply declines to run on it.
 * A degraded allocation therefore costs throughput and nothing else, which is
 * the only reason it is allowed to be silent.
 */
export type SlabAlloc<T> = (length: number) => T | null;

/**
 * A growable `Int32Array` column, for a per-unit or per-(unit × turn) fact the
 * hot loop reads by index. Capacity doubles; the contents are NOT preserved
 * across a grow, because every consumer writes the whole prefix it reads.
 */
export class Int32Column {
  private buf: Int32Array;
  private readonly alloc: SlabAlloc<Int32Array>;
  constructor(initial = 64, alloc: SlabAlloc<Int32Array> | null = null) {
    this.alloc = alloc ?? ((n) => new Int32Array(n));
    const cap = Math.max(1, initial);
    this.buf = this.alloc(cap) ?? new Int32Array(cap);
  }

  /** A buffer of at least `n` slots. The same object when it already fits. */
  ensure(n: number): Int32Array {
    if (this.buf.length < n) {
      let cap = this.buf.length;
      while (cap < n) cap *= 2;
      this.buf = this.alloc(cap) ?? new Int32Array(cap);
    }
    return this.buf;
  }

  get array(): Int32Array {
    return this.buf;
  }
}

/** The same, for a per-index byte flag. */
export class Uint8Column {
  private buf: Uint8Array;
  private readonly alloc: SlabAlloc<Uint8Array>;
  constructor(initial = 64, alloc: SlabAlloc<Uint8Array> | null = null) {
    this.alloc = alloc ?? ((n) => new Uint8Array(n));
    const cap = Math.max(1, initial);
    this.buf = this.alloc(cap) ?? new Uint8Array(cap);
  }

  ensure(n: number): Uint8Array {
    if (this.buf.length < n) {
      let cap = this.buf.length;
      while (cap < n) cap *= 2;
      this.buf = this.alloc(cap) ?? new Uint8Array(cap);
    }
    return this.buf;
  }

  get array(): Uint8Array {
    return this.buf;
  }
}

/**
 * DENSE RANKS OVER A CALLER'S COMPARATOR.
 *
 * The territory evaluator compares unit strengths millions of times per
 * decision through the resolver's own lexicographic comparator, on objects it
 * had to allocate to hand to it. Ranking the handful of DISTINCT strengths once
 * per sweep turns every one of those comparisons into an integer compare —
 * without restating the contest, because the ranking itself is computed by
 * calling the comparator.
 *
 * `rank[i] < rank[j] ⟺ cmp(v[i], v[j]) < 0` and `rank[i] === rank[j] ⟺
 * cmp(v[i], v[j]) === 0`, for every pair in the batch. That is the whole
 * contract, and it holds for ANY total preorder — no assumption about the
 * values' magnitudes, signs, or integrality, which is what an ad-hoc bit-packed
 * key would be quietly assuming.
 *
 * Insertion sort on the index permutation: the batches are the distinct
 * strengths on one board (tens, not thousands), and an insertion sort over that
 * beats a comparator-driven `Array.prototype.sort` — which allocates a closure
 * frame per call — by enough to matter at this call rate.
 */
export class DenseRanker<T> {
  private readonly items: T[] = [];
  private order = new Int32Array(64);
  private ranks = new Int32Array(64);

  /** Forget the batch. O(1). */
  reset(): void {
    this.items.length = 0;
  }

  /** Add one value, returning its index in the batch. Duplicates are fine. */
  add(v: T): number {
    this.items.push(v);
    return this.items.length - 1;
  }

  get count(): number {
    return this.items.length;
  }

  /**
   * Assign dense ranks. Returns an `Int32Array` whose first `count` entries are
   * the ranks, in `add` order. The array is REUSED across calls — read it
   * before the next `rank()`.
   */
  rank(cmp: (a: T, b: T) => number): Int32Array {
    const n = this.items.length;
    if (this.order.length < n) {
      this.order = new Int32Array(n * 2);
      this.ranks = new Int32Array(n * 2);
    }
    const order = this.order;
    const ranks = this.ranks;
    for (let i = 0; i < n; i++) order[i] = i;
    // Insertion sort on the permutation — stable, allocation-free, and fast on
    // the tens-of-elements batches this is for.
    for (let i = 1; i < n; i++) {
      const cur = order[i] as number;
      const item = this.items[cur] as T;
      let j = i - 1;
      while (j >= 0 && cmp(this.items[order[j] as number] as T, item) > 0) {
        order[j + 1] = order[j] as number;
        j--;
      }
      order[j + 1] = cur;
    }
    let r = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0 && cmp(this.items[order[i - 1] as number] as T, this.items[order[i] as number] as T) !== 0) {
        r++;
      }
      ranks[order[i] as number] = r;
    }
    return ranks;
  }
}
