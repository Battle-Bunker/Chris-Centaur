/**
 * THE RECORDED RUN — G1 and G2's instrument.
 *
 * A live decision cannot be re-run bit-exactly and this module does not
 * pretend otherwise: production reads the wall clock, and the same 150 ms
 * bought 18 slices on one run and 92 on another. What IS bit-exact is a
 * decision under the NODE clock, where `now()` is a work counter. Everything
 * here runs under `--nodes`, exactly as `local-game-determinism.test.ts` does.
 */

import type { LensEvent } from '../types';

const NOT_IMPLEMENTED = 'not implemented: L2';

/** One fixture decision, run with the `lens` sink attached, under the node
 *  clock. G1 byte-compares two runs at the same seed and budget; G2 asserts a
 *  `2b`-work run's frames EXTEND the `b` run's. */
export interface LensRunSpec {
  readonly scenario: string;
  readonly seed: number;
  readonly nodes: number;
  readonly turns: number;
}

export function recordLensRun(_spec: LensRunSpec): Promise<ReadonlyArray<LensEvent>> {
  throw new Error(NOT_IMPLEMENTED);
}

/** The byte form G1 and G2 compare. Stable field order, no wall clock. */
export function serialiseLensEvent(_event: LensEvent): string {
  throw new Error(NOT_IMPLEMENTED);
}
