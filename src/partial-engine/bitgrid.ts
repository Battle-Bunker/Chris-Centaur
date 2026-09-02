/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/bitgrid.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// Bitboards over a rectangular cell grid — the primitive every claim in this
// subsystem is made of. See DESIGN.md §2/§3.1.
//
// One cell is one bit of a `Uint32Array(words)`, row-major, `c = y * width + x`.
// Uint32Array rather than BigInt or a number[]: 32-bit bit operations are the
// only ones V8 compiles to single instructions, and a board of ≤ 512 cells fits
// in ≤ 64 bytes, which is V8's threshold for storing typed-array data inline
// rather than in an external backing store (a ~100x allocation-cost cliff,
// measured in DESIGN.md §1.2).
//
// Every operation writes into a caller-supplied destination. Nothing here
// allocates, because everything here is on a path a search calls millions of
// times.

/** A board's fixed geometry, with the masks the shift operations need. */
export interface Grid {
  readonly width: number;
  readonly height: number;
  /** Cell count, `width * height`. */
  readonly cells: number;
  /** Word count, `ceil(cells / 32)`. */
  readonly words: number;
  /** Clears the bits past `cells` in the final word. */
  readonly tailMask: number;
  /**
   * `srcFileMask[dx + MAX_DX]` selects the cells whose `x + dx` is still on the
   * board. Pre-masking the source of a shift is what stops a shift by
   * `dy*width + dx` bits from wrapping the end of one row onto the next.
   */
  readonly srcFileMask: ReadonlyArray<Uint32Array>;
  /** Every cell. */
  readonly full: Uint32Array;
  /** Every cell off the outermost ring — where a piece is allowed to stand. */
  readonly interior: Uint32Array;
  /** `(x + y)` even / odd — a bishop never leaves its own colour. */
  readonly light: Uint32Array;
  readonly dark: Uint32Array;
}

/** Largest `|dx|` any grammar offset uses (a knight's 2). */
export const MAX_DX = 2;

export type Board = Uint32Array;

export function makeGrid(width: number, height: number): Grid {
  if (width < 3 || height < 3) throw new Error(`grid too small: ${width}x${height}`);
  const cells = width * height;
  if (cells > 65535) throw new Error(`grid too large: ${cells} cells (cell ids are u16)`);
  const words = Math.ceil(cells / 32);
  const rem = cells & 31;
  const tailMask = rem === 0 ? -1 : (1 << rem) - 1;

  const srcFileMask: Uint32Array[] = [];
  for (let dx = -MAX_DX; dx <= MAX_DX; dx++) {
    const mask = new Uint32Array(words);
    for (let c = 0; c < cells; c++) {
      const x = c % width;
      if (x + dx >= 0 && x + dx < width)
        mask[c >>> 5] = (mask[c >>> 5] as number) | (1 << (c & 31));
    }
    srcFileMask.push(mask);
  }

  const full = new Uint32Array(words);
  const interior = new Uint32Array(words);
  const light = new Uint32Array(words);
  const dark = new Uint32Array(words);
  for (let c = 0; c < cells; c++) {
    const x = c % width;
    const y = (c / width) | 0;
    const w = c >>> 5;
    const b = 1 << (c & 31);
    full[w] = (full[w] as number) | b;
    if (x > 0 && y > 0 && x < width - 1 && y < height - 1)
      interior[w] = (interior[w] as number) | b;
    if (((x + y) & 1) === 0) light[w] = (light[w] as number) | b;
    else dark[w] = (dark[w] as number) | b;
  }

  return { width, height, cells, words, tailMask, srcFileMask, full, interior, light, dark };
}

export function newBoard(grid: Grid): Board {
  return new Uint32Array(grid.words);
}

export const cellOf = (grid: Grid, x: number, y: number): number => y * grid.width + x;
export const xOf = (grid: Grid, c: number): number => c % grid.width;
export const yOf = (grid: Grid, c: number): number => (c / grid.width) | 0;

// ---------------------------------------------------------------------------
// Bit-level accessors
// ---------------------------------------------------------------------------

export const bbTest = (a: Board, c: number): boolean =>
  ((a[c >>> 5] as number) & (1 << (c & 31))) !== 0;

export function bbSet(a: Board, c: number): void {
  a[c >>> 5] = (a[c >>> 5] as number) | (1 << (c & 31));
}

export function bbUnset(a: Board, c: number): void {
  a[c >>> 5] = (a[c >>> 5] as number) & ~(1 << (c & 31));
}

// ---------------------------------------------------------------------------
// Word-level combinators. `w` is always `grid.words`; passing it rather than
// the grid keeps these monomorphic and inlineable.
// ---------------------------------------------------------------------------

export function bbZero(dst: Board, w: number): void {
  for (let i = 0; i < w; i++) dst[i] = 0;
}

export function bbCopy(dst: Board, src: Board, w: number): void {
  for (let i = 0; i < w; i++) dst[i] = src[i] as number;
}

export function bbOr(dst: Board, src: Board, w: number): void {
  for (let i = 0; i < w; i++) dst[i] = (dst[i] as number) | (src[i] as number);
}

export function bbAnd(dst: Board, src: Board, w: number): void {
  for (let i = 0; i < w; i++) dst[i] = (dst[i] as number) & (src[i] as number);
}

export function bbAndNot(dst: Board, src: Board, w: number): void {
  for (let i = 0; i < w; i++) dst[i] = (dst[i] as number) & ~(src[i] as number);
}

export function bbIsEmpty(a: Board, w: number): boolean {
  for (let i = 0; i < w; i++) if (a[i] !== 0) return false;
  return true;
}

export function bbEquals(a: Board, b: Board, w: number): boolean {
  for (let i = 0; i < w; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * THE HOT ONE. "Does my plan touch this unknown?" — the entanglement test.
 * A full scan is 1.4 ns/word and, crucially, its cost does not grow with how
 * saturated either side is (DESIGN.md §2 R3).
 */
export function bbIntersects(a: Board, b: Board, w: number): boolean {
  for (let i = 0; i < w; i++) if (((a[i] as number) & (b[i] as number)) !== 0) return true;
  return false;
}

/** `a ⊆ b` — the containment check the soundness property test runs. */
export function bbSubset(a: Board, b: Board, w: number): boolean {
  for (let i = 0; i < w; i++) if (((a[i] as number) & ~(b[i] as number)) !== 0) return false;
  return true;
}

export function bbPopcount(a: Board, w: number): number {
  let n = 0;
  for (let i = 0; i < w; i++) {
    let v = a[i] as number;
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    n += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return n;
}

/** Visits set cells in ascending order. Allocation-free. */
export function bbForEach(a: Board, w: number, fn: (cell: number) => void): void {
  for (let i = 0; i < w; i++) {
    let v = a[i] as number;
    while (v !== 0) {
      const lsb = v & -v;
      fn((i << 5) + (31 - Math.clz32(lsb)));
      v ^= lsb;
    }
  }
}

/** Collects set cells into an array. For tests and cold paths only. */
export function bbCells(a: Board, w: number): number[] {
  const out: number[] = [];
  bbForEach(a, w, (c) => out.push(c));
  return out;
}

// ---------------------------------------------------------------------------
// Geometry: shifts and ray fills
// ---------------------------------------------------------------------------

/**
 * `dst := shift(src, dx, dy)`. `dst` must not alias `src`.
 *
 * The whole trick is the file pre-mask: a shift by `dy*width + dx` bits would
 * otherwise slide the last cell of a row onto the first cell of the next, so
 * source cells that would leave the board horizontally are dropped first.
 * Vertical overflow needs no mask — it shifts out of the array, or into the
 * tail bits the final mask clears.
 */
export function bbShift(grid: Grid, dst: Board, src: Board, dx: number, dy: number): void {
  const w = grid.words;
  const pm = grid.srcFileMask[dx + MAX_DX];
  if (pm === undefined) throw new Error(`|dx| > ${MAX_DX}: ${dx}`);
  const k = dy * grid.width + dx;

  if (k === 0) {
    for (let i = 0; i < w; i++) dst[i] = (src[i] as number) & (pm[i] as number);
  } else if (k > 0) {
    const ws = k >>> 5;
    const bs = k & 31;
    if (bs === 0) {
      for (let i = w - 1; i >= 0; i--) {
        const j = i - ws;
        dst[i] = j >= 0 ? (src[j] as number) & (pm[j] as number) : 0;
      }
    } else {
      for (let i = w - 1; i >= 0; i--) {
        const j = i - ws;
        let v = 0;
        if (j >= 0) v = ((src[j] as number) & (pm[j] as number)) << bs;
        if (j - 1 >= 0) v |= ((src[j - 1] as number) & (pm[j - 1] as number)) >>> (32 - bs);
        dst[i] = v;
      }
    }
  } else {
    const m = -k;
    const ws = m >>> 5;
    const bs = m & 31;
    if (bs === 0) {
      for (let i = 0; i < w; i++) {
        const j = i + ws;
        dst[i] = j < w ? (src[j] as number) & (pm[j] as number) : 0;
      }
    } else {
      for (let i = 0; i < w; i++) {
        const j = i + ws;
        let v = 0;
        if (j < w) v = ((src[j] as number) & (pm[j] as number)) >>> bs;
        if (j + 1 < w) v |= ((src[j + 1] as number) & (pm[j + 1] as number)) << (32 - bs);
        dst[i] = v;
      }
    }
  }
  dst[w - 1] = (dst[w - 1] as number) & grid.tailMask;
}

/**
 * `dst |= ` every cell reachable from `seed` by repeating the step `(dx, dy)`
 * through `open`, up to `maxSteps` times — a slider's ray, as a set operation.
 *
 * `open` is STATIC terrain (DESIGN.md §3.4): mobile blockers are deliberately
 * ignored, which over-approximates (sound) and is what makes a cloud a pure
 * function of the frozen unit and therefore shareable across every sibling
 * state in the tree.
 */
export function bbFill(
  grid: Grid,
  dst: Board,
  seed: Board,
  dx: number,
  dy: number,
  open: Board,
  frontier: Board,
  next: Board,
  maxSteps: number,
): void {
  const w = grid.words;
  bbCopy(frontier, seed, w);
  // A ray direction is monotone, so the frontier can never revisit a cell and
  // needs no visited set — it dies out on its own at a blocker or the edge.
  // Guarding on `~dst` instead would be a bug: a second seed already sitting on
  // the ray would cut the frontier short.
  for (let step = 0; step < maxSteps; step++) {
    bbShift(grid, next, frontier, dx, dy);
    let any = 0;
    for (let i = 0; i < w; i++) {
      const v = (next[i] as number) & (open[i] as number);
      next[i] = v;
      dst[i] = (dst[i] as number) | v;
      any |= v;
    }
    if (any === 0) return;
    bbCopy(frontier, next, w);
  }
}

/** A Chebyshev square of radius `r` around `origin`, as the health-budget cap. */
export function bbChebyshevBall(grid: Grid, dst: Board, origin: number, r: number): void {
  bbZero(dst, grid.words);
  const ox = xOf(grid, origin);
  const oy = yOf(grid, origin);
  const x0 = Math.max(0, ox - r);
  const x1 = Math.min(grid.width - 1, ox + r);
  const y0 = Math.max(0, oy - r);
  const y1 = Math.min(grid.height - 1, oy + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) bbSet(dst, y * grid.width + x);
  }
}
