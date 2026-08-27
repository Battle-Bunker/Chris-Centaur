/**
 * THE RESIDENT ARENA — one WebAssembly linear memory the evaluator's workspace
 * LIVES IN, rather than one it is copied into.
 *
 * ── THE WHOLE POINT ────────────────────────────────────────────────────────
 *
 * The prototype measured `displace` at 2.43× in wasm with its arrays already in
 * linear memory and 2.06× with them copied in per call
 * (`scratchpad/perf/RESULTS.md`). W2 then took `partitionOf` from 55.42 µs to
 * 26.51 µs in plain JS, which spends most of that headroom — so the per-call
 * copy is no longer a cost the win can absorb. The only version of this worth
 * shipping is the one where NOTHING is copied.
 *
 * So the memory is IMPORTED by the module and OWNED here, and every slab the
 * territory workspace allocates is a typed-array VIEW onto it:
 *
 *     const grid = arena.allocI32(cells);   // Int32Array over wasm memory
 *     grid[c] = t;                          // an ordinary JS store…
 *     kernels.displace(desc.byteOffset);    // …the kernel reads in place
 *
 * A view's own `byteOffset` IS the wasm pointer, so there is no offset
 * bookkeeping either. The JS sweep writes the bitboards, the JS ranker writes
 * the rank column, `shells.ts` stamps each unit's arrival grid ONCE per `Shells`
 * object — and every later partition on that board reads all of it with zero
 * marshalling.
 *
 * ── WHY THE MEMORY NEVER GROWS ─────────────────────────────────────────────
 *
 * `memory.grow()` DETACHES every existing view. A growable arena would mean
 * every holder of a slab re-deriving it after every allocation, which is a
 * silent-stale-read bug generator on the hottest path in the system. So the
 * memory is created with `initial === maximum`, sized from the grid and the
 * measured working set, and `alloc*` returns **null** when it is full. A null
 * allocation is not an error: the caller keeps a heap array instead, the
 * residency check fails for that buffer, and that partition runs the JS kernel.
 * Degrading is always available and is always correct.
 *
 * ── SIZING ─────────────────────────────────────────────────────────────────
 *
 * Measured on the five W2 board classes, a one-second decision creates 35–140
 * distinct `Shells` objects and evicts none (`scratchpad/w3bench/shellstats.js`).
 * `RESIDENT_SHELLS` is 512 — roughly 4× the worst observed — and everything
 * past it falls back to the heap. At 625 cells that is 1.25 MB of arrival grids;
 * the whole arena is under 2 MB, which is why one per decision is not a memory
 * story worth managing.
 */

import { WASM_BASE64 } from './module';

/** The kernels, as the host calls them. Every argument is a byte offset. */
export interface TerritoryKernels {
  displace(desc: number): void;
  stampDecisive(newT: number, words: number, decisive: number, t: number): void;
  stampFronts(
    fronts: number,
    count: number,
    words: number,
    cells: number,
    heldAtTurn: number,
    out: number
  ): void;
  sweepTurn(desc: number): number;
  foldPlanes(
    planes: number,
    nT: number,
    words: number,
    notWall: number,
    owned: number,
    coveredPrev: number,
    domain: number
  ): void;
  countSides(
    oursBoard: number,
    theirsBoard: number,
    notWall: number,
    words: number,
    out: number
  ): void;
}

/** Descriptor field offsets, READ OFF THE MODULE so the two sides cannot drift. */
export interface DescriptorLayout {
  readonly [field: string]: number;
}

const PAGE = 65536;

/**
 * The first page is left unused. AssemblyScript places any static data it emits
 * at low addresses; this module emits none today, but a constant string added to
 * the kernel tomorrow would land there, and an arena that starts at 0 would
 * quietly overwrite it.
 */
const ARENA_BASE = PAGE;

/** Compiled once per process. `null` when this runtime has no WebAssembly. */
let compiled: WebAssembly.Module | null | undefined;

function moduleOnce(): WebAssembly.Module | null {
  if (compiled !== undefined) return compiled;
  try {
    compiled = new WebAssembly.Module(Buffer.from(WASM_BASE64, 'base64'));
  } catch {
    compiled = null;
  }
  return compiled;
}

export class WasmArena {
  readonly memory: WebAssembly.Memory;
  readonly kernels: TerritoryKernels;
  /** `D_*` and `S_*` descriptor field indices, as the module declares them. */
  readonly layout: DescriptorLayout;
  /** The module's own `NEVER`. Checked against the engine's by the caller. */
  readonly never: number;
  private readonly buffer: ArrayBuffer;
  private top = ARENA_BASE;
  private readonly limit: number;
  /** Bytes handed out. Telemetry: an arena that fills is one that is too small. */
  get used(): number {
    return this.top - ARENA_BASE;
  }
  get capacity(): number {
    return this.limit - ARENA_BASE;
  }
  /** Allocations refused for want of room. Nonzero means partitions degraded. */
  refusals = 0;

  private constructor(memory: WebAssembly.Memory, instance: WebAssembly.Instance) {
    this.memory = memory;
    this.buffer = memory.buffer as ArrayBuffer;
    this.limit = this.buffer.byteLength;
    const ex = instance.exports as unknown as Record<string, unknown>;
    this.kernels = ex as unknown as TerritoryKernels;
    const layout: Record<string, number> = {};
    for (const key of Object.keys(ex)) {
      if (!key.startsWith('D_') && !key.startsWith('S_')) continue;
      const g = ex[key];
      if (g instanceof WebAssembly.Global) layout[key] = g.value as number;
    }
    this.layout = layout;
    const never = ex['NEVER'];
    this.never = never instanceof WebAssembly.Global ? (never.value as number) : -1;
  }

  /**
   * An arena of at least `bytes`, or null when WebAssembly is unavailable or the
   * allocation fails. Never throws: a host without wasm runs the JS path.
   */
  static make(bytes: number): WasmArena | null {
    const mod = moduleOnce();
    if (mod === null) return null;
    const pages = Math.ceil((ARENA_BASE + bytes) / PAGE);
    try {
      // initial === maximum: the memory never grows, so no view ever detaches.
      const memory = new WebAssembly.Memory({ initial: pages, maximum: pages });
      const instance = new WebAssembly.Instance(mod, { env: { memory } });
      return new WasmArena(memory, instance);
    } catch {
      return null;
    }
  }

  private take(bytes: number): number {
    // 8-byte alignment: every view here is 1- or 4-byte, but an aligned bump
    // keeps `Float64Array` available to a later kernel without a repack.
    const off = (this.top + 7) & ~7;
    if (off + bytes > this.limit) {
      this.refusals++;
      return -1;
    }
    this.top = off + bytes;
    return off;
  }

  allocI32(length: number): Int32Array | null {
    const off = this.take(length * 4);
    return off < 0 ? null : new Int32Array(this.buffer, off, length);
  }

  allocU32(length: number): Uint32Array | null {
    const off = this.take(length * 4);
    return off < 0 ? null : new Uint32Array(this.buffer, off, length);
  }

  allocU8(length: number): Uint8Array | null {
    const off = this.take(length);
    return off < 0 ? null : new Uint8Array(this.buffer, off, length);
  }

  /**
   * The wasm pointer for a view, or −1 when the view is not in THIS arena.
   *
   * The whole residency contract runs through this one function: a kernel is
   * called only when every buffer it reads answers ≥ 0, so a slab that fell back
   * to the heap — because the arena was full, or because a caller passed its own
   * array — cannot be handed to wasm as a pointer into somebody else's bytes.
   */
  pointerOf(view: ArrayBufferView | null | undefined): number {
    if (view === null || view === undefined) return -1;
    return view.buffer === this.buffer ? view.byteOffset : -1;
  }
}
