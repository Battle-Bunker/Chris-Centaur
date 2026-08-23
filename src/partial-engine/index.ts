/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/index.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// Partial evolution of board states for tree search.
//
// The public surface, in the order a caller meets it:
//
//   makeGrid / makeTerrain      the board's fixed geometry and terrain
//   PartialEngine               arena-backed live state; create / fork / release
//   engine.hold / holdMany      time-freeze units — their claims replace them
//   engine.resolve              one turn, plus the entanglement ledger and the
//                               per-unit fate (alive / dead / CONTINGENT)
//   engine.unfreeze             return to simulate it, at a placement its own
//                               claim permits
//   CloudField                  the frozen units' claims: maybeAt / certainAt /
//                               intersecting — the heuristic's whole view of
//                               what it does not know
//   Narrower                    near-before-far candidate ordering
//   earliestEntangledTurn       how far a catch-up actually has to rewind
//
// The contract, in one sentence: a resolution's state is the OPTIMISTIC
// timeline and its ledger names every point where that timeline could differ
// from the truth, so an empty ledger is a proof and a non-empty one is a
// work list. See DESIGN.md.

export type { Board, Grid } from "./bitgrid.js";
export {
  bbCells,
  bbForEach,
  bbIntersects,
  bbIsEmpty,
  bbPopcount,
  bbSet,
  bbSubset,
  bbTest,
  bbZero,
  cellOf,
  makeGrid,
  newBoard,
  xOf,
  yOf,
} from "./bitgrid.js";

export {
  UnitKind,
  UNIT_KIND_NAMES,
  enumerateActions,
  kindCount,
  kindProfiles,
  legalMoves,
  makeTerrain,
  orientationOf,
  orientedStepsOf,
  pathFor,
  pawnTargetsInto,
  planAction,
  profileOf,
  registerKindProfile,
  vectorOf,
} from "./grammar.js";
export type { Candidate, KindProfile, OrientationIndex, Terrain, UnitAction } from "./grammar.js";

export {
  CloudSource,
  CloudTimeline,
  DEFAULT_TIMELINE_CACHE,
  FROZEN_RECORD_KEY_FIELDS,
  NEVER,
  frozenRecordKey,
  headSubStepLBOf,
  maxHealthFor,
  meetingTime,
} from "./cloud.js";
export type {
  ArrivalGrid,
  ClaimBasis,
  Cloud,
  CloudPremise,
  CloudSourceOptions,
  FrozenRecord,
  StrengthBounds,
} from "./cloud.js";

export { beats, cmpLex, scalarOf, uniqueStrictMax } from "./contest.js";
export type { Scalar } from "./contest.js";

export { RiskAssessor, WHOLE_TURN, bracket, kAnd, kNot, kOr, ownerLabel } from "./risk.js";
export type {
  SubStep,
  ContingencyEntry,
  EncounterVerdict,
  Grade,
  Interval,
  MaybeEntry,
  MaybeRole,
  Mover,
  Polarity,
  RiskCause,
  StrengthBox,
  TierBox,
  TraversalVerdict,
  Trit,
} from "./risk.js";

export {
  DEAD,
  UNKNOWN_BOUNDS,
  backupMax,
  declareMinSideRestriction,
  scopedTeamValueBounds,
  backupMin,
  backupSimultaneous,
  confidence,
  dominance,
  evaluateOrReject,
  scoreBounds,
  teamValueBounds,
} from "./bounds.js";
export type {
  AssumptionId,
  CandidateReport,
  ConfidenceReport,
  DominanceVerdict,
  GapAttribution,
  ScoreBounds,
  UnitValueBounds,
} from "./bounds.js";

export {
  DependencyIndex,
  SubtreeCertificate,
  classifyCatchUp,
  residue,
  conflictingEntries,
  narrowUnit,
  refinementCost,
} from "./refine.js";
export type { RefineResult, RefinementOp } from "./refine.js";

export {
  candidatesOf,
  evolveJoint,
  projectExact,
  resolveBounded,
  resolveWitness,
  teamOf,
  teamScore,
} from "./exact.js";
export type {
  BudgetRefusal,
  ExactOptions,
  ExactProjection,
  ExactResult,
  Presence,
  UnitJoin,
} from "./exact.js";

export {
  CloudField,
  MAX_FROZEN,
  emptyField,
  maybeUnitsAt,
  slotCells,
  slotMaybeAt,
  teamArrivalInto,
} from "./field.js";
export type { FieldSlot, SlotMask } from "./field.js";

export {
  CHANNEL_NAMES,
  Channel,
  DEFAULT_ENGINE_CONFIG,
  Fate,
  NO_ORDER,
  NO_TIER_EXPIRY,
  PartialEngine,
  REASON,
  Standing,
  UnnamedUnitError,
} from "./engine.js";
export type {
  Clash,
  ClashKind,
  DeathRecord,
  EngineConfig,
  Entanglement,
  HoldSet,
  Resolution,
  ResolveOptions,
  StateHandle,
  UnitFate,
  UnitSpec,
  UnitView,
} from "./engine.js";

export { Narrower, earliestEntangledTurn, entangledSlots } from "./narrow.js";
export type { CandidateMove } from "./narrow.js";

// The SHIPPED twin-timeline property: an independent walker every bot
// author's claim engine can be run against. See ./twin.ts.
export { twinTimelineViolation } from "./twin.js";
export type { TwinClaim, TwinUnit, TwinWorld } from "./twin.js";
