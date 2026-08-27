/**
 * THE ARENA'S TWO PROMISES.
 *
 *   1. A slab handed out is a VIEW onto the module's own linear memory, so what
 *      JS writes is what the kernel reads — no copy, no synchronisation, and
 *      `pointerOf` is the view's own `byteOffset`.
 *   2. It NEVER GROWS, so a view never detaches; when it is full it says so by
 *      returning null and the caller keeps a heap array instead.
 *
 * Promise 2 is the one that would fail silently: a `memory.grow()` slipped in
 * later detaches every existing view, and a detached typed array reads as zeros
 * rather than throwing. The test that catches that is the one asserting the
 * buffer identity is stable across a full allocation cycle.
 */

import { NEVER } from '../../partial-engine/index';
import { WasmArena } from './arena';
import { wasmModeFrom } from './policy';

describe('WasmArena', () => {
  it('hands out views onto its own memory, at their own byteOffset', () => {
    const a = WasmArena.make(1 << 16) as WasmArena;
    expect(a).not.toBeNull();
    const x = a.allocI32(16) as Int32Array;
    const y = a.allocU32(16) as Uint32Array;
    expect(x.buffer).toBe(a.memory.buffer);
    expect(y.buffer).toBe(a.memory.buffer);
    expect(a.pointerOf(x)).toBe(x.byteOffset);
    expect(a.pointerOf(y)).toBe(y.byteOffset);
    // Distinct regions, 8-aligned.
    expect(y.byteOffset).toBeGreaterThanOrEqual(x.byteOffset + 64);
    expect(x.byteOffset % 8).toBe(0);
    expect(y.byteOffset % 8).toBe(0);
  });

  it('refuses a foreign array rather than reading somebody else`s bytes', () => {
    const a = WasmArena.make(1 << 16) as WasmArena;
    expect(a.pointerOf(new Int32Array(4))).toBe(-1);
    expect(a.pointerOf(null)).toBe(-1);
    const b = WasmArena.make(1 << 16) as WasmArena;
    expect(a.pointerOf(b.allocI32(4))).toBe(-1);
  });

  it('returns null when full, and the memory never grows', () => {
    const a = WasmArena.make(4096) as WasmArena;
    const pages = a.memory.buffer.byteLength;
    const buffer = a.memory.buffer;
    let handed = 0;
    for (let i = 0; i < 10000; i++) {
      if (a.allocI32(64) === null) break;
      handed++;
    }
    expect(a.refusals).toBeGreaterThan(0);
    expect(handed).toBeGreaterThan(0);
    // The identity of the ArrayBuffer is the whole safety property: a grow
    // would replace it and detach every view already handed out.
    expect(a.memory.buffer).toBe(buffer);
    expect(a.memory.buffer.byteLength).toBe(pages);
  });

  it('agrees with the engine about NEVER, and publishes the descriptor layout', () => {
    const a = WasmArena.make(1 << 16) as WasmArena;
    expect(a.never).toBe(NEVER);
    // Read off the instance, not restated here: the point of exporting them is
    // that the host cannot hold a stale copy.
    expect(a.layout['D_WORDS']).toBe(0);
    expect(a.layout['D_LEN']).toBeGreaterThan(a.layout['D_OUT_THEIRS'] as number);
    expect(a.layout['S_LEN']).toBeGreaterThan(a.layout['S_DECISIVE'] as number);
    expect(typeof a.kernels.displace).toBe('function');
    expect(typeof a.kernels.sweepTurn).toBe('function');
  });

  it('runs a kernel over host-written memory with no marshalling', () => {
    const a = WasmArena.make(1 << 16) as WasmArena;
    const newT = a.allocU32(2) as Uint32Array;
    const decisive = a.allocI32(64) as Int32Array;
    decisive.fill(NEVER);
    newT[0] = 0b1011;
    newT[1] = 1 << 5;
    a.kernels.stampDecisive(newT.byteOffset, 2, decisive.byteOffset, 7);
    expect(Array.from(decisive.slice(0, 5))).toEqual([7, 7, NEVER, 7, NEVER]);
    expect(decisive[37]).toBe(7);
    expect(decisive[36]).toBe(NEVER);
  });
});

describe('CENTAUR_WASM', () => {
  it('defaults to off, accepts on/off, and warns about anything else', () => {
    const said: string[] = [];
    const log = (m: string): void => void said.push(m);
    expect(wasmModeFrom({}, log)).toBe('off');
    expect(wasmModeFrom({ CENTAUR_WASM: '' }, log)).toBe('off');
    expect(wasmModeFrom({ CENTAUR_WASM: 'on' }, log)).toBe('on');
    expect(wasmModeFrom({ CENTAUR_WASM: 'off' }, log)).toBe('off');
    expect(said).toEqual([]);
    expect(wasmModeFrom({ CENTAUR_WASM: 'yes' }, log)).toBe('off');
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('CENTAUR_WASM');
  });
});
