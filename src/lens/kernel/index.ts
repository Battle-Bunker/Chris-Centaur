/**
 * THE K TRACK'S SURFACE — the kernel side of the decision lens.
 *
 * Everything the lens shows about a decision was computed BY that decision:
 * the partition is a component of a graph the substrate already memoises, the
 * rows are trials `better()` already priced and already threw away, and the
 * conditional ranking is the speculative pin context the kernel already
 * searches one slice in four. The headline cost claim is that the lens adds no
 * evaluation to the hot loop, and `05-BUILD-ORDER.md` §(d) gate 7 is where it
 * is made falsifiable rather than argued.
 *
 * L2 fills `freeSetOf` / `partitionOf` / `diffPartitions` / the reservoir and
 * the sink; L3 fills `rankConditional` / `explainMoveset` and the reserve.
 * Signatures may move here — this file is NOT frozen. `../types.ts` is.
 */

import type { KernelInput } from '../../lobster/contracts';
import {
  LENS_INSPECTION_MS,
  type LensSink,
  type MovesetBreakdown,
  type MovesetKey,
  type LensRefusal,
  type UnitKey,
} from '../types';

export { unitKeyOf } from './keys';
export {
  diffPartitions,
  freeSetOf,
  partitionOf,
  type FixedUnit,
  type PartitionInput,
} from './partition';
export {
  byBetter,
  makeReservoir,
  slackFrom,
  type MovesetReservoir,
  type Refusal,
  type TrialOrder,
} from './reservoir';
export { recordLensRun, serialiseLensEvent, type LensRunSpec } from './record';
export {
  promotedContextKey,
  rankConditional,
  type RankConditionalInput,
} from './conditional';

const NOT_IMPLEMENTED = 'not implemented: L3';

/**
 * [CHANGE 3] at the seam. Returns the input with the `lens` sink attached —
 * the one place a caller declares that this decision is being watched. Absent
 * ⇒ the lens costs exactly nothing, which G-L2 (ii) makes falsifiable.
 */
export function attachLens(input: KernelInput, sink: LensSink): KernelInput {
  return { ...input, lens: sink };
}

/**
 * `LENS_INSPECTION_MS` carved BEFORE `searchDeadline`, and by nothing else —
 * the reserve is DECLARED, not taken (G-L2 (i)). The search is
 * unconditionally shorter by a fixed amount that is visible before the turn
 * starts; inspection is unconditionally affordable; and no exchange rate
 * between compute and operator attention is ever computed, because a rate
 * would let the scheduler spend the human.
 *
 * Carved only where there is something to carve from: a decision with less
 * budget than the reserve keeps its search rather than handing the whole turn
 * to an inspector who may not be there.
 */
export function carveReserve(
  searchDeadlineMs: number,
  nowMs: number
): { readonly searchDeadlineMs: number; readonly reserveMs: number } {
  const available = searchDeadlineMs - nowMs;
  if (!(available > LENS_INSPECTION_MS * 2)) return { searchDeadlineMs, reserveMs: 0 };
  return { searchDeadlineMs: searchDeadlineMs - LENS_INSPECTION_MS, reserveMs: LENS_INSPECTION_MS };
}

export function explainMoveset(
  _key: MovesetKey,
  _members?: ReadonlyArray<UnitKey>
): Promise<MovesetBreakdown | LensRefusal> {
  throw new Error(NOT_IMPLEMENTED);
}
