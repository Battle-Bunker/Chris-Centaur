/**
 * BOARD GEOMETRY AND BITBOARDS — arithmetic, and nothing else.
 *
 * The territory sweep, the reach shells and the food flood all walk whole
 * boards cell by cell, and they walk them per evaluation. A `Set<number>` per
 * front is the honest shape and it is thirty times the cost; a word-packed
 * bitboard is the shape they were written against and the shape they stay in.
 *
 * NOTHING HERE IS A RULE. A cell index, a width, a wall board, popcount — none
 * of it decides who wins a contest, where a unit may be staged, or what a
 * path is. Those questions have exactly one answer in this repo and it is the
 * vendored engine's (`engine-vendor/engine/queries.ts`,
 * `engine-vendor/engine/turnEngine.ts`). This file is the ARENA those answers
 * are drawn on, which is why it may live here without being a second
 * encoding of anything.
 */

/** Full-board dimensions, in the engine's own cell indexing (row-major). */
export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly cells: number;
  /** 32-bit words a whole-board bitboard needs. */
  readonly words: number;
  /** A board with every in-range cell set — the mask trailing bits die on. */
  readonly full: Uint32Array;
}

export function makeGrid(width: number, height: number): Grid {
  const cells = width * height;
  const words = Math.max(1, Math.ceil(cells / 32));
  const full = new Uint32Array(words);
  for (let c = 0; c < cells; c++) full[c >>> 5] = ((full[c >>> 5] as number) | (1 << (c & 31))) >>> 0;
  return { width, height, cells, words, full };
}

export type Bitboard = Uint32Array;

export const newBoard = (grid: Grid): Bitboard => new Uint32Array(grid.words);

export function bbSet(board: Bitboard, cell: number): void {
  board[cell >>> 5] = ((board[cell >>> 5] as number) | (1 << (cell & 31))) >>> 0;
}

export function bbTest(board: Bitboard, cell: number): boolean {
  if (cell < 0) return false;
  const word = board[cell >>> 5];
  return word !== undefined && (word & (1 << (cell & 31))) !== 0;
}

export function bbForEach(board: Bitboard, words: number, fn: (cell: number) => void): void {
  for (let w = 0; w < words; w++) {
    let bits = board[w] as number;
    while (bits !== 0) {
      const bit = bits & -bits;
      bits ^= bit;
      fn((w << 5) + (31 - Math.clz32(bit >>> 0)));
    }
  }
}

/** Set bits in ONE 32-bit word. The whole-board count below is this, folded. */
export function popcount32(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(v, 0x01010101) >>> 24) & 0x3f;
}

export function bbPopcount(board: Bitboard, words: number): number {
  let total = 0;
  for (let w = 0; w < words; w++) total += popcount32((board[w] as number) >>> 0);
  return total;
}

export function boardOf(grid: Grid, cells: Iterable<number>): Bitboard {
  const board = newBoard(grid);
  for (const cell of cells) if (cell >= 0 && cell < grid.cells) bbSet(board, cell);
  return board;
}

/**
 * The board's static terrain, as bitboards.
 *
 * `open` is "not a wall", which is the only sense in which terrain blocks
 * anything: a hazard costs energy and stops nobody, exactly as the grammar and
 * the collision engine read it.
 */
export interface Terrain {
  readonly grid: Grid;
  readonly wall: Bitboard;
  readonly hazard: Bitboard;
  readonly open: Bitboard;
}

export function makeTerrain(
  grid: Grid,
  walls: ReadonlyArray<number>,
  hazards: ReadonlyArray<number>
): Terrain {
  const wall = boardOf(grid, walls);
  const hazard = boardOf(grid, hazards);
  const open = new Uint32Array(grid.words);
  for (let w = 0; w < grid.words; w++) {
    open[w] = ((grid.full[w] as number) & ~(wall[w] as number)) >>> 0;
  }
  return { grid, wall, hazard, open };
}
