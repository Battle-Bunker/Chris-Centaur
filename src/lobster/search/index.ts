/**
 * The joint search core: coordinate ascent with pair repair, joint polish,
 * inherited witnesses, and the epoch-change conformance path.
 */

export { DEFAULT_TUNING, NoRosterError, makeSearchCore } from "./core";
export type { SearchTuning } from "./core";

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

export {
  DEFAULT_EDGE_EV_TUNING,
  DecisionEconomy,
  EDGE_EV_ENV,
  EdgeEvStore,
  LAT,
  MEAL_MATERIAL_LAT,
  RaceFronts,
  ZERO_PARTS,
  edgeEvEnabled,
  edgeEvFrom,
  nonMaterialSpan,
  pairKey,
  pairTable,
  unaryEv,
  unaryKey,
  unaryParts,
} from "./edge-ev";
export type {
  EdgeEvTuning,
  EdgeKey,
  PairCell,
  PairFamily,
  PairInput,
  PairTable,
  UnaryInput,
  UnaryParts,
} from "./edge-ev";
