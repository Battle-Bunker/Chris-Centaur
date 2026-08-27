/**
 * CENTAUR_WASM — whether the territory evaluator's hot kernels run in
 * WebAssembly.
 *
 * ── WHY THE DEFAULT IS OFF ─────────────────────────────────────────────────
 *
 * The JS path is the source of truth and stays fully maintained: every kernel
 * here has a JS twin that the differential suite runs beside it, and the wasm
 * arm is REFUSED at runtime — silently, per partition — the moment any input it
 * needs is not resident in linear memory. So `on` is never a correctness bet.
 * It is a THROUGHPUT bet, and W2 already took `partitionOf` from 55 µs to 26 µs,
 * which means the naive "wasm is faster than JS" gap this was aimed at is
 * mostly gone. The default follows the measurement in `perf-w3-report.md`, not
 * the expectation.
 *
 * ── WHY PER-ENGINE AND NOT PER-PROCESS ─────────────────────────────────────
 *
 * Same reason `CENTAUR_STAGING_SAFETY` is per-engine: the experiment that has
 * to be possible is ONE SEAT against unchanged opponents. A process-wide flag
 * moves every lobster seat on the board at once and a paired arm on it measures
 * nothing. `TeamDecisionOptions.wasm` overrides the env for one engine
 * instance; the env is the process default.
 *
 * The mode is resolved once per decision, where the substrate is built, and
 * pinned to that substrate — because the workspace (and the linear memory its
 * slabs are views onto) is built per substrate and lives exactly as long.
 * Flipping the flag mid-decision would mean rebuilding the arena underneath
 * live views, so it is not offered: `modeFor` answers whatever was pinned when
 * the substrate was made, and an unpinned substrate falls back to the env.
 */

import type { EngineSubstrate } from '../substrate';

export type WasmMode = 'off' | 'on';

export const WASM_ENV = 'CENTAUR_WASM';

/** Absent, empty or unrecognised resolves here. */
export const WASM_DEFAULT: WasmMode = 'off';

export function wasmModeFrom(
  env: NodeJS.ProcessEnv,
  log: (message: string) => void = (m) => console.warn(m)
): WasmMode {
  const raw = env[WASM_ENV];
  if (raw === undefined || raw === '') return WASM_DEFAULT;
  if (raw === 'off' || raw === 'on') return raw;
  log(
    `[centaur-wasm] Ignoring ${WASM_ENV}="${raw}" — expected "off" or "on"; ` +
      `keeping ${WASM_DEFAULT}`
  );
  return WASM_DEFAULT;
}

/** Read live, not cached at import: a test flips it per case. */
export function wasmMode(): WasmMode {
  return wasmModeFrom(process.env);
}

const pinned = new WeakMap<EngineSubstrate, WasmMode>();

/**
 * Pin the mode for one substrate. Called once, immediately after the substrate
 * is built and before anything evaluates on it — the workspace reads it when it
 * is constructed, and a workspace already built keeps the mode it was built
 * with.
 */
export function pinWasmMode(sub: EngineSubstrate, mode: WasmMode): void {
  pinned.set(sub, mode);
}

/** The mode this substrate was pinned to, or the process default. */
export function wasmModeFor(sub: EngineSubstrate): WasmMode {
  return pinned.get(sub) ?? wasmMode();
}
