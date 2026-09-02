/**
 * The joint search core: coordinate ascent with pair repair, joint polish,
 * inherited witnesses, and the epoch-change conformance path.
 */

export { DEFAULT_TUNING, NoRosterError, makeSearchCore } from "./core";
export type { SearchTuning } from "./core";

export { basisOf, referenceActionsOf } from "./basis";

export {
  expandCluster,
  mergeAll,
  partitionOf,
  sliderKind,
} from "./cluster-partition";
export type { Cluster, Expansion, Partition, PartitionRequest } from "./cluster-partition";

// The owner's search-seeding redesign: a random safe baseline, sampled
// multi-start hill climbing, and a weighted-random selection among what was
// found. `./multistart-seed.ts` states what it may and may not do.
export {
  DEFAULT_MULTISTART,
  classifyOptions,
  crowdedUnits,
  multiStartSeed,
} from "./multistart-seed";
export type {
  MultiStartReport,
  MultiStartRequest,
  MultiStartResult,
  MultiStartTuning,
  UnitOptions,
} from "./multistart-seed";

export { DEFAULT_CLUSTER_TUNING, enumerateProposals } from "./cluster-enum";
export type {
  ClusterProposals,
  ClusterStats,
  ClusterTuning,
  EnumRequest,
  UnaryLookup,
} from "./cluster-enum";

export {
  ABLATED_SAMPLING,
  ALL_CHANNELS,
  DEFAULT_SAMPLING,
  DEFAULT_WIDEN,
  SelectionSampler,
  clipCeilings,
  decisionSeed,
  temperatureAt,
  widenInert,
  widenTo,
} from "../selection";
export type {
  SamplingTuning,
  SelectionReport,
  WeightRegime,
  WidenSchedule,
} from "../selection";

export { SweepDirty } from "./sweep-dirty";
export type { DirtyStats } from "./sweep-dirty";

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
  EdgeEvStore,
  LAT,
  MEAL_MATERIAL_LAT,
  RaceFronts,
  ZERO_PARTS,
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

// CL6 — DOOR A. The scout's whole surface. Its import law lives in
// `./scout/index.ts` and is asserted by `__tests__/scout.test.ts`.
export {
  DEFAULT_SCOUT_TUNING,
  Scout,
  ScoutPurse,
  ThreadLedger,
  barrierDepth,
  buildContactMatrix,
  cleanPrefixOf,
  contactOf,
  continueFrom,
  deepenNext,
  effectiveTithe,
  priceExpansion,
  resumePriority,
  shouldPark,
  soleDifference,
  tierAtRoot,
  tierPremiseAdmits,
} from "./scout";
export type {
  ContactVerdict,
  Continuation,
  Discrimination,
  ScoutFinding,
  ScoutReport,
  ScoutRequest,
  ScoutTuning,
  ThreadEntry,
} from "./scout";
