/**
 * The joint search core: coordinate ascent with pair repair, joint polish,
 * inherited witnesses, and the epoch-change conformance path.
 */

export { DEFAULT_TUNING, NoRosterError, makeSearchCore, ranksAbove } from "./core";
export type { RankedRow, SearchTuning } from "./core";

export { basisOf, referenceActionsOf } from "./basis";

export {
  contestedUnits,
  dangerOrder,
  deadIn,
  involvedIn,
  planTieKey,
  selfInflictedPairs,
  tieKey,
  topCandidates,
} from "./order";
