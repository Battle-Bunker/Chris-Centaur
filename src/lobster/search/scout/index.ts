/**
 * THE SCOUT — the depth layer. Public surface, and the import law.
 *
 * ── THE IMPORT LAW, WHICH IS THE FIREWALL IN ITS STRUCTURAL FORM ───────────
 *
 * `la-outside` L8: *the scheduler may be wrong; the bounds may not be.* L2:
 * *under a `V¹` frame, depth may move `est`, candidate order and scheduler
 * priors, and nothing else — any route from a deep computation into `lo` or
 * `hi` is either a declared frame change or a declared assumption, and there is
 * no third route.*
 *
 * Those are claims about a whole layer, so the way to keep them is a property
 * of the layer rather than a habit at each call site:
 *
 *   1. **Nothing under `bounds/` imports anything under `search/scout/`.**
 *      There is no path, so there is no bug.
 *   2. **Nothing under `search/scout/` constructs, meets, tightens or publishes
 *      a `ScoreBounds`.** Thread values are plain numbers on
 *      `ThreadPly.advisory`, and the type is different on purpose: a channel
 *      that cannot be confused at the type level cannot be confused at the call
 *      site either.
 *   3. **Nothing under `search/scout/` writes to a `BoundBank`, and nothing
 *      under it imports `belief.ts`.** A deepened line reaches a decision by
 *      two routes and no others: an ordering term through CL3's `UnaryLookup`
 *      seam, which feeds a SURROGATE; and a `DeepObservation` — three plain
 *      numbers and the root plan they are about — which the consumer folds
 *      into that branch's BELIEF. Neither route is a bound, and this directory
 *      cannot construct, fold or compare a belief either.
 *
 * All three are asserted by a test that reads the files (`scout.test.ts`,
 * "the channels"), because a law nobody can violate by accident is worth more
 * than a law everybody remembers.
 *
 * ── WHAT THIS BUYS, AND WHAT IT DOES NOT ───────────────────────────────────
 *
 * BUYS: candidate ordering, sampling weights, and — the change that made depth
 * decision-relevant — a VALUE for the branch a line started from, folded into
 * that branch's belief at the precision the line earned, which resolves the
 * choice among floor-undominated candidates. Plus, once the durable-witness
 * path exists, punishing replies that survive parking, epochs and the turn
 * boundary.
 *
 * DOES NOT BUY: sound multi-turn floors. "I have proven this 3-turn line is
 * worth at least X" needs the non-interference discharge, and M4 measured that
 * at 13.7% of decisions at depth 2 / 7.5% at depth 3 under the most favourable
 * reading, collapsing to 4.3%/0.8% at the shipped roster of six — and 58.4% of
 * the decisions that do discharge are near-eliminations. Door B is not built
 * and this directory contains nothing that would help build it.
 */

export { continueFrom, tierAtRoot, tierPremiseAdmits } from './door';
export type {
  Continuation,
  ContinuationOptions,
  ContinuationRefusal,
  ContinuationResult,
  RefusalReason,
} from './door';

export {
  ContactMatrix,
  FLAT,
  ThreadLedger,
  accumulate,
  advisoryRate,
  boardOfCells,
  buildContactMatrix,
  cleanPrefixOf,
  contactOf,
  depthOf,
  heaviestOutsider,
  lastDiscrimination,
  soundYield,
  threadKey,
} from './threads';
export type {
  ContactVerdict,
  Discrimination,
  ThreadEntry,
  ThreadPly,
  ThreadState,
} from './threads';

export {
  DEFAULT_SCOUT_TUNING,
  ScoutPurse,
  barrierDepth,
  deepenNext,
  effectiveTithe,
  emptyReport,
  priceExpansion,
  reportOf,
  resumePriority,
  shouldPark,
} from './schedule';
export type { ExpansionProposal, ParkVerdict, ScoutReport, ScoutTuning } from './schedule';

export { Scout, sigmaOfPly, soleDifference } from './scout';
export type { DeepObservation, ScoutFinding, ScoutRequest } from './scout';
