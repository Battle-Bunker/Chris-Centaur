/**
 * L3 — the conditional ranking, and the promotion that makes Law B literally
 * true. Declared here at L2 so the module graph is the one L3 fills in.
 */

import type { SearchContext, SearchCore } from '../../lobster/contracts';
import type { ClusterId, Lock, RankConditionalResult } from '../types';

const NOT_IMPLEMENTED = 'not implemented: L3';

export interface RankConditionalInput {
  /** The decision's own context — `rankConditional` is a pure function of
   *  `(substrate, basis, locks, cursor)` and never searches on the caller's
   *  thread. It schedules, and returns what is known. */
  readonly ctx: SearchContext;
  readonly search: SearchCore;
  readonly cluster: ClusterId;
  readonly generation: number;
  readonly locks: ReadonlyArray<Lock>;
  /** What is LEFT of `LENS_INSPECTION_MS`. Zero ⇒ a typed refusal, never
   *  silence and never a served row. */
  readonly reserveMs: number;
}

export function rankConditional(_req: RankConditionalInput): RankConditionalResult {
  throw new Error(NOT_IMPLEMENTED);
}

/** [CHANGE 2]. On an epoch change, `retarget` promotes a matching speculative
 *  entry (`spec:[…]`) into the committed namespace (`pin:[…]`). */
export function promotedContextKey(_speculativeKey: string): string {
  throw new Error(NOT_IMPLEMENTED);
}
