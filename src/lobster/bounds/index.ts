/**
 * ScoreBounds, the ledger, and the bound bank — the min side of the decision.
 *
 * Everything the search is allowed to believe about a plan comes from here,
 * and everything here is either a proof or a declared assumption. There is no
 * third category.
 */

export {
  BOUND_EPSILON,
  BoundsInversionError,
  DEAD,
  UNKNOWN_BOUNDS,
  assumptionClassOf,
  assumptionKey,
  backupMax,
  backupMin,
  basisKeyOf,
  compareFloors,
  conditioningAssumptions,
  dominates,
  isConditioning,
  isDischarged,
  isFraming,
  ledgerKey,
  makeScoreBounds,
  normalizeAssumptions,
  normalizeLedger,
  onBasis,
  pointBounds,
  tighten,
  unionAssumptions,
  unionLedgers,
  widthOf,
  withNarrowing,
} from "./score";
export type {
  AssumptionClass,
  BasisKey,
  BasisRefusal,
  BoundsInput,
  DominanceVerdict,
  FloorComparison,
  TightenResult,
} from "./score";

export {
  EVALUATOR_RESIDUE_UNIT,
  evaluatorResidueEntry,
  frozenUnitBySlot,
  heldUnitsOf,
  heldUnitsOfTeam,
  ledgerOf,
  residueOf,
  teamOfHeld,
} from "./ledger";

export { candidateKey, cellsOf, footprintOf, planKey, sameCandidate, unitsOf, withMove, withMoves } from "./plan";

export { memoizeSubstrate } from "./memo";
export type { MemoStats, MemoizedSubstrate } from "./memo";

export { hasRoster, isModelling, modelledView } from "./substrate-ext";
export type { ModelledView, ModellingSubstrate, RosterSubstrate } from "./substrate-ext";

export { WitnessSet, refutedAt, sameWitness, witnessKey, witnessOf, witnessUnits } from "./witness";

export { B0_ONLY, BoundBank, DEFAULT_BANK_CONFIG } from "./bank";
export type { BankConfig, BankInput, BankResult, MemberReport, Rung } from "./bank";
