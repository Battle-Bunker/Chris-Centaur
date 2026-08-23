/**
 * LOBSTER posture governor — the partial-visibility channel-priority switch.
 *
 * Three postures, keyed on MEASURED BOARD CONDITIONS and never on the budget:
 *
 *   SIGHTED               no holds, or every hold discharged. The triple
 *                         collapses, the bound apparatus contributes nothing,
 *                         the floor leads and est breaks ties.
 *   FOGGED-DISCRIMINATING holds present, the floor still separates candidates,
 *                         claims unsaturated. Bound-led ascent; refinement
 *                         buys narrows/advances on entangled units.
 *   FOGGED-VACUOUS        every candidate's lo is cloud-contingent DEAD, or
 *                         the gated claims are saturated and the residue is
 *                         undischargeable — refinement has nothing left to
 *                         buy. The floor becomes a VETO ONLY; ordering
 *                         transfers to the est/gradient channel plus the
 *                         sticky-staged incumbent.
 *
 * Two rules this module exists to make structural rather than aspirational:
 *
 *   1. NEVER BUDGET-KEYED. `PostureConditions` carries no clock, no budget, no
 *      elapsed time and no work counter, and `classifyPosture` is a pure
 *      function of it. There is no code path by which a millisecond can change
 *      a posture. (A `PostureFlip` records an `at` stamp, but only as a label
 *      on the log line — it is never read back.)
 *   2. `est` NEVER ADJUDICATES. Under FOGGED-VACUOUS the ordering channel is
 *      est, but the ADMISSIBLE SET is still lo's: `vetoed()` removes certain
 *      material death whatever the posture. est orders what lo has already
 *      allowed; it never overrides a veto.
 *
 * Every flip is emitted as a named `Assumption` so it rides the emission
 * record and the basis-identity rule (a score computed under one posture is
 * never compared with one computed under another).
 */

import type { Assumption, Posture, ScoreBounds, UnitId, VacuityCause } from "./contracts"
import { DEAD } from "./bounds"

/**
 * Scores at or below this are DEAD — a lattice bottom, not a point on the
 * heuristic scale. The default IS the system's own sentinel (−∞, shared by
 * the engine, the evaluate module and the bounds layer; the agreement is
 * pinned by test), so the governor's cliff and the evaluator's cliff can
 * never disagree by default. Callers pairing the governor with an evaluator
 * that uses a DIFFERENT finite cliff (a scripted harness, say) pass that
 * value explicitly — every entry point takes it as a parameter.
 */
export const DEFAULT_DEAD_BELOW: number = DEAD

// ---------------------------------------------------------- vacuity detector

/** Re-exported from the contract, where the kernel/voc lever types read it. */
export type { VacuityCause }

export interface VacuityVerdict {
  readonly cause: VacuityCause
  /** true ⟺ cloud-contingent: the floor is asking for refinement, not reporting a result. */
  readonly demand: boolean
  /** Units whose feared presence depressed lo — the demand's addressees. */
  readonly citedUnits: ReadonlySet<UnitId>
}

/**
 * Cause-tagged vacuity detection (bot-orchestration DESIGN §3, RESULTS §3.2).
 *
 * The cause bit is derived from the two-polarity ledger and the bracket, not
 * from a separate engine flag: a floor on the cliff whose CEILING is not is a
 * death that some completion of the clouds avoids, and the `if_present`
 * entries name exactly the clouds that are responsible. A floor on the cliff
 * with no `if_present` citation is nobody's fault but the board's.
 */
export function detectVacuity(
  bounds: ScoreBounds,
  deadBelow: number = DEFAULT_DEAD_BELOW,
): VacuityVerdict {
  const cited = new Set<UnitId>()
  for (const e of bounds.ledger) if (e.polarity === "if_present") cited.add(e.unitId)
  if (bounds.worst > deadBelow) return { cause: "alive", demand: false, citedUnits: cited }
  if (bounds.best <= deadBelow || cited.size === 0) {
    return { cause: "material-dead", demand: false, citedUnits: cited }
  }
  return { cause: "cloud-contingent-dead", demand: true, citedUnits: cited }
}

// ------------------------------------------------------------- the conditions

/**
 * Everything the governor is allowed to look at. Note what is absent: budget,
 * elapsed time, work spent, slice count, deadline. Adding any of them here is
 * the design error this type exists to prevent.
 */
export interface PostureConditions {
  /** Any un-discharged hold contributing to the bounds (ledger non-empty / not exact). */
  readonly holdsPresent: boolean
  /** Does the floor still order the candidates? (Two distinct non-DEAD lo values.) */
  readonly floorSeparates: boolean
  /** Are the gated claims saturated — membership vacuous, only gradients left? */
  readonly claimsSaturated: boolean
  /**
   * Can refinement still buy anything: is at least one cited unit refinable
   * (not stale-unrefinable, not already at the bottom rung)? Defaults TRUE
   * where unknown, which keeps the governor in DISCRIMINATING — the
   * conservative direction, since VACUOUS is the posture that stops paying for
   * slack.
   */
  readonly residueDischargeable: boolean
  /** Every candidate's lo is cloud-contingent DEAD (the all-dark case). */
  readonly allCandidatesCloudContingentDead: boolean
}

/**
 * The classification, total and in precedence order. Each clause cites the
 * sentence of the architecture it implements.
 */
export function classifyPosture(c: PostureConditions): Posture {
  // "no holds, or all holds discharged": the triple collapses.
  if (!c.holdsPresent) return "SIGHTED"
  // "every candidate's lo is cloud-contingent-DEAD".
  if (c.allCandidatesCloudContingentDead) return "FOGGED-VACUOUS"
  // "the gated claims are saturated and the residue is undischargeable,
  //  i.e. refinement has nothing left to buy".
  if (c.claimsSaturated && !c.residueDischargeable) return "FOGGED-VACUOUS"
  // "holds present, floor still separates candidates, claims unsaturated".
  if (c.floorSeparates) return "FOGGED-DISCRIMINATING"
  // A flat floor with nothing left to buy is vacuous by the same argument; a
  // flat floor that refinement can still un-flatten is not.
  return c.residueDischargeable ? "FOGGED-DISCRIMINATING" : "FOGGED-VACUOUS"
}

// -------------------------------------------------------------- channel policy

/**
 * What a posture actually changes: which channel orders moves above the floor,
 * what job lo is doing, and where refinement budget goes.
 */
export interface ChannelPolicy {
  readonly posture: Posture
  /** Which channel ORDERS the admissible candidates. */
  readonly orderBy: "lo" | "est"
  /** lo's job: adjudicate the ordering, or only forbid the inadmissible. */
  readonly loRole: "adjudicate" | "veto"
  /** What breaks ties in the ordering channel. */
  readonly tieBreak: "est" | "hi"
  /** May a candidate with a cloud-contingent-DEAD floor be staged? */
  readonly vacuousMayWin: boolean
  /** Where refinement budget goes. Under VACUOUS, slack-buying is worthless by construction. */
  readonly spend: "slack" | "depth-and-gradient"
  /** Is the horizon ration active (deepen only when the current horizon is stable)? */
  readonly depthRation: boolean
}

const POLICIES: Readonly<Record<Posture, ChannelPolicy>> = {
  SIGHTED: {
    posture: "SIGHTED",
    orderBy: "lo",
    loRole: "adjudicate",
    tieBreak: "est",
    vacuousMayWin: false,
    spend: "slack",
    depthRation: true,
  },
  "FOGGED-DISCRIMINATING": {
    posture: "FOGGED-DISCRIMINATING",
    orderBy: "lo",
    loRole: "adjudicate",
    tieBreak: "est",
    vacuousMayWin: false,
    spend: "slack",
    depthRation: true,
  },
  "FOGGED-VACUOUS": {
    posture: "FOGGED-VACUOUS",
    orderBy: "est",
    loRole: "veto",
    tieBreak: "hi",
    // The stage record is marked vacuous and stands on the gradient: refusing
    // to stage anything here is the passivity the posture exists to escape.
    vacuousMayWin: true,
    spend: "depth-and-gradient",
    depthRation: false,
  },
}

export function channelPolicyFor(posture: Posture): ChannelPolicy {
  return POLICIES[posture]
}

/**
 * lo's veto, in every posture. A certain material death is never admissible —
 * this is the part of the floor that survives the transfer of ordering to est,
 * and it is why "est orders" is not "est adjudicates".
 */
export function vetoed(cause: VacuityCause): boolean {
  return cause === "material-dead"
}

// ----------------------------------------------------------------- the governor

export interface PostureFlip {
  readonly from: Posture
  readonly to: Posture
  /** Label only — the governor never reads it back. */
  readonly at: number
  readonly conditions: PostureConditions
  readonly assumption: Assumption
}

export function postureAssumption(posture: Posture): Assumption {
  return { kind: "posture", posture }
}

/** Consecutive measurements a new classification must survive before the
 * governor acts on it. See `PostureGovernor`. */
export const DEFAULT_POSTURE_DWELL = 2

/**
 * Holds the current posture and logs every transition as a named assumption.
 *
 * DWELL, AND WHY IT IS NOT BUDGET-KEYING. A flip replaces the ratchet's basis
 * and resets its floor to −∞, so posture chatter is not a log-tidiness
 * question: it is the ratchet being reset. `measure()` recomputes the
 * conditions from the CURRENT incumbent's ledger on every slice, and an
 * incumbent that alternates between two plans with and without a residual hold
 * alternates the classification with it — several times inside one wire write
 * interval.
 *
 * So a classification has to HOLD for `dwell` consecutive measurements before
 * the governor acts on it. It is counted in MEASUREMENTS, never in
 * milliseconds: `PostureConditions` still carries no clock, no budget and no
 * work counter, `classifyPosture` is still a pure function of it, and there is
 * still no code path by which a millisecond can change a posture. What the
 * dwell adds is the requirement that the board say the same thing twice.
 *
 * `dwell = 1` restores the old flip-on-first-sight behaviour for a harness
 * that wants to drive classifications directly.
 */
export class PostureGovernor {
  private posture: Posture
  private readonly log: PostureFlip[] = []
  /** The classification waiting out its dwell, and how long it has held. */
  private pending: Posture | null = null
  private held = 0

  constructor(
    initial: Posture = "SIGHTED",
    private readonly dwell: number = DEFAULT_POSTURE_DWELL,
  ) {
    this.posture = initial
  }

  /** How many consecutive measurements the CURRENT dissenting classification
   * has held. Zero when the board agrees with the standing posture. */
  get pendingHeld(): number {
    return this.pending === null ? 0 : this.held
  }

  get current(): Posture {
    return this.posture
  }

  get policy(): ChannelPolicy {
    return channelPolicyFor(this.posture)
  }

  get flips(): ReadonlyArray<PostureFlip> {
    return this.log
  }

  /** Classify, flip if the classification moved AND held, and return the flip. */
  observe(conditions: PostureConditions, at: number): PostureFlip | null {
    const next = classifyPosture(conditions)
    if (next === this.posture) {
      // The board agrees with where we are: whatever was pending is gone.
      this.pending = null
      this.held = 0
      return null
    }
    if (this.pending === next) this.held++
    else {
      this.pending = next
      this.held = 1
    }
    if (this.held < Math.max(1, this.dwell)) return null
    this.pending = null
    this.held = 0
    const flip: PostureFlip = {
      from: this.posture,
      to: next,
      at,
      conditions,
      assumption: postureAssumption(next),
    }
    this.posture = next
    this.log.push(flip)
    return flip
  }
}
