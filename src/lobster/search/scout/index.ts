/**
 * THE SCOUT — Door A, advisory depth. Public surface, and the import law.
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
 *   3. **Nothing under `search/scout/` writes to a `BoundBank`.** The only way
 *      a scout finding reaches a decision is as an ordering term through CL3's
 *      `UnaryLookup` seam, which feeds a SURROGATE and never a bound.
 *
 * All three are asserted by a test that reads the files (`scout.test.ts`,
 * "the channels"), because a law nobody can violate by accident is worth more
 * than a law everybody remembers.
 *
 * ── WHAT DOOR A BUYS, AND WHAT IT DOES NOT ─────────────────────────────────
 *
 * BUYS: candidate ordering, sampling weights, `est` among floor ties at the
 * barrier depth, and — once CL6b builds the durable-witness path — punishing
 * replies that survive parking, epochs and the turn boundary.
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
  SCOUT_ENV,
  ScoutPurse,
  barrierDepth,
  deepenNext,
  effectiveTithe,
  emptyReport,
  priceExpansion,
  reportOf,
  resumePriority,
  scoutMode,
  scoutModeFrom,
  shouldPark,
} from './schedule';
export type {
  ExpansionProposal,
  ParkVerdict,
  ScoutMode,
  ScoutReport,
  ScoutTuning,
} from './schedule';

export { Scout, clampToLat, soleDifference } from './scout';
export type { ScoutFinding, ScoutRequest } from './scout';
