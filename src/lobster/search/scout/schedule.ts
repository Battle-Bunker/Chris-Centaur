/**
 * THE SCOUT'S SCHEDULER — a tithe, a barrier, and a value-per-millisecond
 * question that is not the same question as "has contact happened".
 *
 * ── NO FLAG. A RATION. ─────────────────────────────────────────────────────
 *
 * `CENTAUR_SCOUT` and its three positions are deleted. Depth is always
 * available; what a caller configures is how much of the decision it may buy —
 * `tithe`, bounded by `reserve`, spent in resolution-equivalents. Zero tithe
 * buys zero plies, which is a budget statement and not a dark path.
 *
 * ── THE TITHE, AND THE OWNER'S RESERVE ─────────────────────────────────────
 *
 * The advisory budget is a TITHE of the decision budget, default 20%. The
 * owner's standing answer to Q3 — *"at least half of every decision's budget
 * is reserved for the ply-1 search that actually stages"* — is not a second
 * knob competing with this one; it is the scout's CEILING. So the effective
 * tithe is `min(tithe, 1 − reserve)`, and a configuration that asked for 70%
 * silently gets 50% rather than silently starving the search that stages.
 *
 * The tithe is spent in TWO CURRENCIES that are never added (rule 23): the
 * advisory currency (spread, flip rate) and the sound currency (witnesses).
 * They get a fixed split of the tithe, and `advisoryRate`/`soundYield` are two
 * functions rather than one weighted sum for exactly that reason.
 *
 * ── THE DEPTH RULE: DEEPEN THE SHALLOWEST LIVE CLUSTER ─────────────────────
 *
 * `la-outside` L5: `est` compares only at EQUAL DEPTH, and the team decides at
 * the BARRIER DEPTH `d* = min over live clusters`. A deeper thread keeps its
 * extra depth as TIGHTNESS, never as est. Two consequences, and the second is
 * the one that makes this a rule rather than a heuristic:
 *
 *   · Depth spent above the barrier buys the DECISION nothing, because the
 *     comparison the decision makes happens at `d*`. So the marginal ply is
 *     worth most on the shallowest thread, and "deepen the shallowest live
 *     cluster" falls out as near-deterministic rather than being imposed.
 *   · There is no certifiable depth envelope (§3.3), so a deep thread cannot
 *     lend its depth to a shallow one. The barrier is a floor on the team's
 *     comparison and cannot be argued around.
 *
 * The king's cluster is never STARVED — §7.1 restates F-12 without a mandate:
 * a priority floor, not an exemption from the barrier.
 *
 * ── PARKING: A SCHEDULING CHOICE, NOT A MANDATE AT CONTACT ─────────────────
 *
 * Synthesis §7.1 supersedes the "CONTACT → park immediately" row outright.
 * Post-contact continuation is a PRIMARY mode: the thread keeps simulating
 * with every heuristic reading its dilated field, floors stay true and widen,
 * and what dies is discrimination rather than correctness. So the park test is
 * `ρ_thread` against the scheduler's alternatives, and the simplest honest
 * version of `ρ_thread` — the one this tranche implements — is ARGMAX
 * INSTABILITY among the cluster's own options: park when it FLATLINES.
 *
 * Flatline needs hysteresis or the scheduler thrashes on a single quiet ply,
 * so it is `flatPlies` consecutive plies with no spread and no argmax move.
 * That is the anti-thrash discipline §5.1 asks for, kept structurally apart
 * from the contact trigger, which is now telemetry.
 *
 * ── EXPANSION: PRICED BEFORE IT IS PAID ────────────────────────────────────
 *
 * §7.2 promotes T2/T3 from recovery to standing escalation. The trigger is
 * entanglement accumulation on high-value paths; the gate is that the cost is
 * KNOWN BEFORE PAYING — `refinementCost({op:"catchUp", …})` returns
 * `currentTurn − earliestEntangledTurn`, denominated in resolution-equivalents
 * and ZERO when the ledger never names the unit (T2's free-unfreeze payoff).
 * The arity guard precedes every expansion and `expandCluster` refuses rather
 * than silently building a table nothing can afford.
 */

import { refinementCost } from '../../../partial-engine/index';
import type { CloudField, Entanglement } from '../../../partial-engine/index';
import { expandCluster } from '../cluster-partition';
import type { Partition } from '../cluster-partition';
import { advisoryRate, depthOf, heaviestOutsider, lastDiscrimination } from './threads';
import type { ThreadEntry, ThreadLedger } from './threads';
import type { UnitId } from '../../contracts';

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

/*
 * `CENTAUR_SCOUT` (off | observe | advise) IS DELETED — TODO(teardown-search)
 * row retired here.
 *
 * The three positions answered a question the build no longer asks. `off` was
 * a dark path, `observe` was `off` with counters, and `advise` was the only
 * position where the machinery reached anything. Under the owner's ruling a
 * strategy alternative is a configuration of one bot against another, never a
 * switch guarding dormant code — so depth is ALWAYS AVAILABLE and what varies
 * is the RATION it is given: `ScoutTuning.tithe`, `reserve`, `depthMax`,
 * `plyCap`, all of them config on the search surface.
 *
 * A caller that wants no depth spends nothing on it: `tithe: 0` buys zero
 * plies, and that is a budget statement rather than a hidden code path.
 */

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export interface ScoutTuning {
  /** Share of the decision budget the scout may spend. Capped by `reserve`. */
  readonly tithe: number;
  /** The owner's Q3 answer, as the scout's ceiling: at least this share of the
   *  decision is reserved for the ply-1 search that actually stages. */
  readonly reserve: number;
  /** Of the tithe, the share that funds the SOUND currency (witness hunting).
   *  The remainder funds the advisory currency. Never a weighted sum. */
  readonly soundShare: number;
  /** Hard ply ceiling. `M1`'s fog horizon `k*` is what should set this per
   *  board class once measured; until then it is a knob with a defensible
   *  default — `la-inside` §4.3 says 1 s buys c=3,d=2 or c=2,d=3. */
  readonly depthMax: number;
  /** How many plies ahead the contact matrix scans. Reading `Infinity` as
   *  "cannot arrive" past this is F-1's silent-NEVER bug, so the verdict
   *  carries the horizon and consumers must check it. */
  readonly horizonPlies: number;
  /** Consecutive flat plies before a park. Hysteresis; §5.1's anti-thrash. */
  readonly flatPlies: number;
  /** Threads the ledger holds across a decision. */
  readonly capacity: number;
  /** Max variables a cluster may carry after an expansion. `expandCluster`'s
   *  arity guard reads this; a snake costs ~×2.5–2.8 post-exclusions. */
  readonly maxVariables: number;
  /** Minimum citation mass before an expansion is even priced. */
  readonly expandThreshold: number;
  /**
   * ONE-UNIT PERTURBATIONS OF THE ANCHOR PLAN, per cluster.
   *
   * The ordering sink can only attribute a FIRST DIFFERENCE — two threads
   * whose ply-1 plans differ in exactly one unit's candidate. CL3's k-best
   * joints are diverse by construction (they are shrunk on a minimum Hamming
   * distance), so they almost never supply one. So the scout builds its own:
   * the anchor plan, plus that plan with one member moved. That is the same
   * move `search/core.ts::perturb` makes for the same reason, and it is what
   * turns the sink from a channel that exists into a channel that fires.
   */
  readonly perturbationsPerCluster: number;
  /** Hard ceiling on plies per decision, whatever the clock says. */
  readonly plyCap: number;
  /**
   * WHAT ONE RESOLUTION-EQUIVALENT COSTS, IN MILLISECONDS — the only bridge
   * between the decision's wall-clock budget and the scout's own accounting,
   * and the only place a millisecond appears in this layer.
   *
   * The scout NEVER READS A CLOCK. It spends in RESOLUTION-EQUIVALENTS, which
   * is `la-inside` §4's own currency and `refinementCost`'s (*"denominated in
   * resolution-equivalents across every lever, so value-per-cost ratios are
   * comparable between lever types"*). Reading `Date.now()` per ply would make
   * the park decision — and therefore the thread set, the findings and the
   * candidate order — a function of how loaded the box was, which is a
   * non-reproducible search and fails its own determinism gate. It would also
   * break the repo's one-clock rule, which says every consumer times itself
   * against the injected `BudgetHandle` and never against `performance.now()`.
   *
   * So the tithe is converted ONCE, at the decision boundary, from the budget
   * the caller already read. The constant is a conservative estimate to be
   * re-fit (CL6a measured ~0.11 ms per priced resolution on an 11×11 six-unit
   * board); over-estimating it spends less than the tithe, which is the safe
   * direction for a layer whose whole promise is that it stays inside one.
   */
  readonly msPerResolution: number;
}

export const DEFAULT_SCOUT_TUNING: ScoutTuning = {
  tithe: 0.2,
  reserve: 0.5,
  soundShare: 0.25,
  depthMax: 3,
  horizonPlies: 3,
  flatPlies: 2,
  capacity: 64,
  maxVariables: 4,
  expandThreshold: 1,
  perturbationsPerCluster: 3,
  plyCap: 24,
  msPerResolution: 0.15,
};

/** The tithe the scout may actually spend. The reserve is a CEILING on it. */
export function effectiveTithe(t: ScoutTuning): number {
  return Math.max(0, Math.min(t.tithe, 1 - t.reserve));
}

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/**
 * The scout's own purse — in RESOLUTION-EQUIVALENTS, in two currencies, with a
 * hard ply ceiling.
 *
 * No clock is read here or anywhere below it. The decision's millisecond
 * budget is converted to a resolution allowance ONCE, by the caller's single
 * read, through `msPerResolution`; everything after that is counting. That is
 * what makes the thread set, the findings and the candidate order a pure
 * function of the board — the property the determinism gate asserts and the
 * property a wall-clock read would silently destroy.
 *
 * `decisionMs` of 0 means the handle models no decision-level clock (every
 * harness budget in this program), and then only the ply cap binds.
 */
export class ScoutPurse {
  private spentUnits = 0;
  private spentPlies = 0;
  private spentSoundUnits = 0;
  /** Resolution-equivalents the tithe buys, or `Infinity` with no clock. */
  readonly unitCap: number;
  readonly plyCap: number;
  /** The tithe in ms, for telemetry only — never read by a decision. */
  readonly msCap: number;

  constructor(decisionMs: number, readonly tuning: ScoutTuning) {
    this.msCap = decisionMs > 0 ? decisionMs * effectiveTithe(tuning) : 0;
    this.unitCap =
      this.msCap > 0 ? Math.max(1, Math.floor(this.msCap / Math.max(1e-6, tuning.msPerResolution))) : Infinity;
    this.plyCap = tuning.plyCap;
  }

  get advisoryCap(): number {
    return this.unitCap === Infinity ? Infinity : this.unitCap * (1 - this.tuning.soundShare);
  }

  get soundCap(): number {
    return this.unitCap === Infinity ? Infinity : this.unitCap * this.tuning.soundShare;
  }

  /** Room for one more ply? The two currencies are checked SEPARATELY: a purse
   *  that summed them would let a witness hunt eat the advisory half, which is
   *  the two-currency violation rule 23 forbids. */
  canSpend(): boolean {
    if (this.spentPlies >= this.plyCap) return false;
    return this.spentUnits < this.advisoryCap;
  }

  canSpendSound(): boolean {
    return this.spentSoundUnits < this.soundCap;
  }

  /** `units` is resolutions priced; `plies` is plies taken. */
  spend(units: number, plies = 1): void {
    this.spentUnits += Math.max(0, units);
    this.spentPlies += plies;
  }

  spendSound(units: number): void {
    this.spentSoundUnits += Math.max(0, units);
  }

  get units(): number {
    return this.spentUnits;
  }

  get plies(): number {
    return this.spentPlies;
  }
}

// ---------------------------------------------------------------------------
// The depth rule
// ---------------------------------------------------------------------------

/** The barrier: the depth at which the team's comparison actually happens. */
export function barrierDepth(threads: ReadonlyArray<ThreadEntry>): number {
  let min = Infinity;
  for (const t of threads) {
    // A PARKED thread still counts. Parking is truncation, not deletion: the
    // sound prefix republishes unchanged the instant a thread parks, so its
    // depth is available to the team's comparison exactly as a live thread's
    // is. Only an INVALIDATED thread — whose premise no longer holds — leaves
    // the barrier, and a thread that never got a ply has nothing to offer it.
    if (t.state === 'invalidated') continue;
    if (depthOf(t) === 0) continue;
    min = Math.min(min, depthOf(t));
  }
  return min === Infinity ? 0 : min;
}

/**
 * DEEPEN THE SHALLOWEST LIVE CLUSTER. Ties broken by the king's cluster first
 * (its priority floor), then by cluster id — deterministic, because a
 * scheduler whose order depends on iteration order is a scheduler whose
 * findings are not reproducible from a seed.
 */
export function deepenNext(
  threads: ReadonlyArray<ThreadEntry>,
  isKingCluster: (t: ThreadEntry) => boolean,
  depthMax: number
): ThreadEntry | null {
  let best: ThreadEntry | null = null;
  for (const t of threads) {
    if (t.state !== 'live') continue;
    if (depthOf(t) >= depthMax) continue;
    if (best === null) {
      best = t;
      continue;
    }
    const d = depthOf(t);
    const bd = depthOf(best);
    if (d !== bd) {
      if (d < bd) best = t;
      continue;
    }
    const king = isKingCluster(t);
    const bestKing = isKingCluster(best);
    if (king !== bestKing) {
      if (king) best = t;
      continue;
    }
    if (t.clusterId < best.clusterId) best = t;
    else if (t.clusterId === best.clusterId && t.key < best.key) best = t;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Parking
// ---------------------------------------------------------------------------

export interface ParkVerdict {
  readonly park: boolean;
  readonly reason: 'flat' | 'depth' | 'budget' | 'live';
  /** `ρ_thread`, advisory half, per resolution-equivalent. Telemetry and the
   *  resume priority. */
  readonly rate: number;
}

/**
 * Should this thread stop getting plies?
 *
 * NOT "has contact happened". Contact is telemetry now (§7.1). The question is
 * whether the thread's marginal discrimination per ms still clears the
 * alternatives, and the flatline test is the honest cheap version of it: a
 * thread whose root options no longer spread and whose argmax no longer moves
 * is telling the cluster nothing it did not already know, however sound its
 * floors remain.
 *
 * Hysteresis is `flatPlies` consecutive flat plies, so one quiet ply in a
 * corridor does not park a thread that is about to reach an intersection.
 */
export function shouldPark(
  entry: ThreadEntry,
  tuning: ScoutTuning,
  purse: ScoutPurse
): ParkVerdict {
  const d = lastDiscrimination(entry);
  const rate = advisoryRate(d, Math.max(entry.stepCost, 1));
  if (depthOf(entry) >= tuning.depthMax) return { park: true, reason: 'depth', rate };
  if (!purse.canSpend()) return { park: true, reason: 'budget', rate };
  let flat = 0;
  for (let i = entry.plies.length - 1; i >= 0 && flat < tuning.flatPlies; i--) {
    const p = entry.plies[i] as ThreadEntry['plies'][number];
    if (p.discrimination.floorSpread === 0 &&
        p.discrimination.estSpread === 0 &&
        !p.discrimination.argmaxMoved) {
      flat++;
    } else break;
  }
  if (flat >= tuning.flatPlies) return { park: true, reason: 'flat', rate };
  return { park: false, reason: 'live', rate };
}

/**
 * A PARKED THREAD'S RESUME PRIORITY, and the reason it needs no decay term.
 *
 * *"A parked thread's prefix shrinks by ≥1 ply per real turn (clouds dilate
 * monotonically)"* — so the passage of time already degrades a parked thread's
 * usefulness, in the sound currency, without anybody multiplying a score by a
 * confidence factor. L4 is preserved by arithmetic rather than by discipline.
 *
 * The priority is the thread's last advisory rate, decayed by skew — where
 * "decayed by skew" means DIVIDED BY THE PLIES OF DILATION IT HAS TAKEN, which
 * is a statement about how much wider its clouds are, not a haircut on its
 * value. CL4's sampler consumes this as an arm weight.
 */
export function resumePriority(entry: ThreadEntry): number {
  const d = lastDiscrimination(entry);
  const rate = advisoryRate(d, Math.max(entry.stepCost, 1));
  return rate / (1 + Math.max(0, entry.skew));
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

export interface ExpansionProposal {
  readonly unitId: UnitId;
  /** Citation mass on high-value paths. §7.2's `accum(thread, u)`. */
  readonly mass: number;
  /** Resolution-equivalents, KNOWN BEFORE PAYING. Zero is T2's free unfreeze:
   *  `earliestEntangledTurn === null` means the prefix is provably unaffected
   *  and the newcomer enters at any claim-permitted placement for free. */
  readonly cost: number;
  /** `ρ_expand` = mass / max(cost, 1). Rides the same seeded weighted sampling
   *  as every other spend (R-A) rather than being a special case. */
  readonly rate: number;
  /** Variables the cluster would carry afterwards. */
  readonly arity: number;
  readonly admitted: boolean;
  readonly reason: 'applied' | 'already-member' | 'arity-guard' | 'no-such-cluster' | 'below-threshold';
}

/**
 * Price an expansion without paying for it.
 *
 * Two gates, in this order, because the second is the expensive one:
 *   1. MASS — an outsider cited on branches that decided nothing has earned
 *      nothing, so a mass below threshold is refused before any cost is read.
 *   2. ARITY — `expandCluster` is the seam CL3 built for exactly this, and it
 *      refuses rather than building a table nothing can afford. Monotone on
 *      the modelled set: units are only ever ADDED, and there is no
 *      `contractCluster` because dropping one would be an elision needing the
 *      full shell-3 discipline.
 */
export function priceExpansion(args: {
  readonly entry: ThreadEntry;
  readonly partition: Partition;
  readonly ledger: Iterable<Entanglement>;
  readonly field: CloudField;
  readonly currentTurn: number;
  readonly tuning: ScoutTuning;
}): ExpansionProposal | null {
  const top = heaviestOutsider(args.entry);
  if (top === null) return null;
  if (top.mass < args.tuning.expandThreshold) {
    return {
      unitId: top.unitId,
      mass: top.mass,
      cost: 0,
      rate: 0,
      arity: 0,
      admitted: false,
      reason: 'below-threshold',
    };
  }
  const cost = refinementCost(
    { op: 'catchUp', unitId: top.unitId, depth: 0 },
    args.ledger,
    args.field,
    args.currentTurn
  );
  const trial = expandCluster(
    args.partition,
    args.entry.clusterId,
    top.unitId,
    args.tuning.maxVariables
  );
  return {
    unitId: top.unitId,
    mass: top.mass,
    cost,
    rate: top.mass / Math.max(1, cost),
    arity: trial.arity,
    admitted: trial.applied,
    reason: trial.reason,
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/**
 * WHAT THE OPERATOR AND THE SIM HARNESS SEE. Telemetry only, and it never
 * reaches the wire: the emission path is `TeamDecisionEngine.forwardPlan`,
 * which reads `rec.plan` and nothing else. Same shape and same argument as
 * `EmitRecord.selection`.
 */
export interface ScoutReport {
  /**
   * WHY THE SCOUT NEVER RAN, or `null` when it did.
   *
   * `scout.run` has exactly one call site — inside `search/core.ts`'s
   * `openCluster` — because the threads' seeds are the enumeration's own
   * proposals. A board the door refuses, a roster with nothing to vary or a
   * substrate that is not the engine's therefore produces no thread at all,
   * and a report that said only `threads=0 findings=0` read as "it ran and
   * found nothing".
   *
   * Those are different facts and a measurement cannot be allowed to confuse
   * them: the first is a null about the scout, the second is a null about the
   * harness. This field is the difference, in the report, in words.
   */
  readonly gatedBy: string | null;
  readonly threads: number;
  readonly deepened: number;
  readonly parked: number;
  readonly resumed: number;
  readonly expanded: number;
  readonly evicted: number;
  readonly invalidatedByEpoch: number;
  readonly invalidatedByCatchUp: number;
  readonly refoldedByPosture: number;
  /** Max thread depth reached this decision. */
  readonly maxDepth: number;
  /** The team's comparison depth — `min` over live threads (L5). */
  readonly barrier: number;
  /** Plies that ran before the first contact, summed. §7.1's re-read of the
   *  [8.5%, 13.7%] bracket: this is the CLEAN-PREFIX measurement. */
  readonly cleanPrefixPlies: number;
  /** Plies that ran AFTER contact — the primary mode's own number. */
  readonly postContactPlies: number;
  /** Threads that reached contact at all. */
  readonly contacted: number;
  /** Ordering advice produced. */
  readonly findings: number;
  /**
   * DEEP OBSERVATIONS PUBLISHED — lines whose value reached a branch belief.
   *
   * The number that separates "depth ran" from "depth was consulted". Findings
   * are the ordering channel; this is the VALUE channel, and a decision with
   * plies and no observations is a decision whose depth changed nothing it
   * could not have changed before.
   */
  readonly observations: number;
  /** Deepest ply any thread reached, as a turn count: 0 when none ran. Never
   *  a configured ceiling and never a fallback constant. */
  readonly deepestPlies: number;
  /** Door refusals by reason, so a silent no-op is legible. */
  readonly refusals: Readonly<Record<string, number>>;
  /** The tithe the caller's budget bought, in ms. Telemetry. */
  readonly msCap: number;
  /** Resolution-equivalents actually spent. The scout's real currency. */
  readonly units: number;
  readonly plies: number;
}

export function emptyReport(gatedBy: string | null = null): ScoutReport {
  return {
    gatedBy,
    threads: 0,
    deepened: 0,
    parked: 0,
    resumed: 0,
    expanded: 0,
    evicted: 0,
    invalidatedByEpoch: 0,
    invalidatedByCatchUp: 0,
    refoldedByPosture: 0,
    maxDepth: 0,
    barrier: 0,
    cleanPrefixPlies: 0,
    postContactPlies: 0,
    contacted: 0,
    findings: 0,
    observations: 0,
    deepestPlies: 0,
    refusals: {},
    msCap: 0,
    units: 0,
    plies: 0,
  };
}

/** Fold a ledger into a report. Pure; the caller owns the counters. */
export function reportOf(
  ledger: ThreadLedger,
  purse: ScoutPurse,
  findings: number,
  observations: number,
  deepestPlies: number,
  refusals: Readonly<Record<string, number>>,
  gatedBy: string | null = null
): ScoutReport {
  const threads = ledger.all();
  let maxDepth = 0;
  let clean = 0;
  let post = 0;
  let contacted = 0;
  for (const t of threads) {
    maxDepth = Math.max(maxDepth, depthOf(t));
    let sawContact = false;
    for (const ply of t.plies) {
      if (ply.contact.contactIn <= 0) sawContact = true;
      if (sawContact) post++;
      else clean++;
    }
    if (sawContact) contacted++;
  }
  return {
    gatedBy,
    threads: threads.length,
    deepened: ledger.counters.deepened,
    parked: ledger.counters.parked,
    resumed: ledger.counters.resumed,
    expanded: ledger.counters.expanded,
    evicted: ledger.counters.evicted,
    invalidatedByEpoch: ledger.counters.invalidatedByEpoch,
    invalidatedByCatchUp: ledger.counters.invalidatedByCatchUp,
    refoldedByPosture: ledger.counters.refoldedByPosture,
    maxDepth,
    barrier: barrierDepth(threads),
    cleanPrefixPlies: clean,
    postContactPlies: post,
    contacted,
    findings,
    observations,
    deepestPlies,
    refusals,
    msCap: purse.msCap,
    units: purse.units,
    plies: purse.plies,
  };
}
