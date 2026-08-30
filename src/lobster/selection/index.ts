/**
 * SELECTION — where the search spends its prices, and nothing else.
 *
 * The one-way import rule for this directory (contract rules 17 and 18, tested
 * by grep in `selection.test.ts`):
 *
 *   · `selection/**` imports TYPES from `../contracts` and nothing else from
 *     the lobster tree. It never imports `bounds/**`, never imports
 *     `search/**`, and therefore cannot reach a `Bound`, a `ScoreBounds`, an
 *     `Assumption` or the comparator.
 *   · the comparator modules (`bounds/score.ts`, `bounds/bank.ts`,
 *     `search/core.ts`'s `better`) never import from here. `search/core.ts`
 *     imports the sampler to ORDER things and the grep asserts that `better()`
 *     itself reads nothing from it.
 *   · `Math.random`, `Date.now` and `performance.now` are lint-banned under
 *     `selection/**` (eslint.config.js). The clock reaches selection only as a
 *     remaining-budget FRACTION the search computed from `BudgetHandle`.
 */

export { decisionSeed, gumbel, hashString, mix, scramble, uniform } from "./rng";

export {
  LAMBDA_RANK,
  LAT,
  W_MATERIAL,
  W_SURROGATE,
  candidateWeights,
  clipCeilings,
  proposalWeights,
  rankLogit,
  unitCeiling,
  unitWeights,
} from "./prior";
export type { ClippedCeilings, WeightRegime } from "./prior";

export { DEFAULT_WIDEN, widenInert, widenTo } from "./widen";
export type { WidenSchedule } from "./widen";

export {
  ABLATED_SAMPLING,
  ALL_CHANNELS,
  DEFAULT_SAMPLING,
  NODE_PAIR_REPAIR,
  NODE_POLISH,
  NODE_PROPOSALS,
  NODE_SWEEP_CANDIDATES,
  NODE_SWEEP_UNITS,
  SelectionSampler,
  temperatureAt,
} from "./sample";
export type { SamplingTuning, SelectionReport } from "./sample";
