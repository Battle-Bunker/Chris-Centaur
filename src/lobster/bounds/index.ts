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
  assumptionKey,
  backupMax,
  backupMin,
  basisKeyOf,
  compareFloors,
  dominates,
  isDischarged,
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
export type { BasisKey, BasisRefusal, BoundsInput, DominanceVerdict, FloorComparison, TightenResult } from "./score";

export {
  EVALUATOR_RESIDUE_UNIT,
  evaluatorResidueEntry,
  ledgerOf,
  residueOf,
} from "./ledger";

export { materialOf, scopedTeamValue, teamValue, unitValuesOf } from "./material";
export type { MaterialBounds, UnitValue } from "./material";

export { candidateKey, cellsOf, footprintOf, planKey, sameCandidate, unitsOf, withMove, withMoves } from "./plan";

export { memoizeSubstrate } from "./memo";
export type { MemoStats, MemoizedSubstrate } from "./memo";

export { EvaluationMemo, evalNamespace, evaluatorIdentity } from "./evalmemo";
export type { EvalMemoStats } from "./evalmemo";

export { hasRoster, isModelling, modelledView } from "./substrate-ext";
export type { ModelledView, ModellingSubstrate, RosterSubstrate } from "./substrate-ext";

export { WitnessSet, refutedAt, sameWitness, witnessKey, witnessOf, witnessUnits } from "./witness";

export { loudListsOf, loudReadingOf, observeLoud } from "./loud";
export type { LoudReading, LoudUnitCount, LoudUnitList } from "./loud";

export { advanceBoard, ceilingAtNextTurn } from "./ceiling";

export { B0_ONLY, BoundBank, DEFAULT_BANK_CONFIG, observeDeep } from "./bank";
export type { BankConfig, BankInput, BankResult, DeepReading, MemberReport, Rung } from "./bank";
