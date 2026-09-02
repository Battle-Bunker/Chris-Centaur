/**
 * LOBSTER VOC refinement orchestrator — two currencies, corrected lever order.
 *
 * Ported from bot-orchestration policy D with its real-engine correction
 * (RESULTS §3 supersedes §1). The four things this file is responsible for:
 *
 *  1. THE LEVER ORDER, corrected:
 *        catch-up  →  depth preview (while nothing is advanced)
 *                  →  narrow (deadline-veto-driven)
 *                  →  advance
 *                  →  rationed deepen
 *     An advance's cost RECURS through every later deepen, so the first
 *     multiplicative spend must come after the horizon is known. With the
 *     preview in place VOC reaches horizon 2 by ~150 work and regret 0.0 by
 *     1200; without it one seed cost 1000 regret until ~2600 work.
 *
 *  2. TWO CURRENCIES, NO EXCHANGE RATE. Slack (at a fixed horizon) and horizon
 *     are not commensurable: buying slack makes the h-decision reliable,
 *     buying horizon makes it relevant. `Confidence` is therefore a PAIR and
 *     `compareConfidence` is a PARTIAL order that answers "incomparable" —
 *     there is deliberately no scalar. Deepen is never selected by a
 *     Δslack/cost comparison; it is RATIONED by stability.
 *
 *  3. STICKY STAGING and the vacuity rules (RESULTS F1/F2, §3.2):
 *       - switch only on material collapse of the incumbent, or a ≥margin lo
 *         improvement at an equal-or-deeper horizon;
 *       - vacuity is a DEMAND, not a verdict: a cloud-contingent-DEAD
 *         incumbent stays staged while the demand is serviced;
 *       - a dead incumbent is dethroned only by a LIVING leader.
 *
 *  4. THE TIE-VACUITY JOIN DIRECTIONS: OR at MAX nodes, AND at MIN nodes.
 *     Having these backwards laundered cloud-contingent deaths into material
 *     ones whenever a genuinely-fatal sibling tied them, which disabled the
 *     sticky-staging protections at exactly the all-dark moments they exist
 *     for. `worstJoin`/`bestJoin` below carry the corrected directions and the
 *     inversion is pinned by test.
 *
 * The posture governor (postures.ts) supplies the channel policy; this module
 * consumes it and never decides a posture itself. Dependency runs one way:
 * voc → postures.
 */

import type {
  Candidate,
  CandidateView,
  HeldUnitView,
  JointPlan,
  Lever,
  LeverView,
  PlanScore,
  RefinementRung,
  SearchContext,
  StagingCandidate,
  UnitId,
} from "./contracts"
import {
  DEFAULT_DEAD_BELOW,
  detectVacuity,
  vetoed,
  type ChannelPolicy,
  type VacuityVerdict,
} from "./postures"

// ------------------------------------------------------------- plan identity

export function candidateKey(c: Candidate): string {
  return `${c.unitId}>${c.to}:${c.path.join(".")}`
}

/**
 * Canonical key of a joint plan. Sorted by unit id, and the PATH is part of
 * the identity: prefixes matter (capture-stops and exhaustion halt mid-ray),
 * so two plans that agree on destinations but not on route are different
 * plans.
 */
export function planKey(plan: JointPlan): string {
  const parts: string[] = []
  for (const [unitId, c] of plan) parts.push(`${unitId}>${c.to}:${c.path.join(".")}`)
  parts.sort()
  return parts.join("|")
}

// ----------------------------------------------------- the two currencies

/** Confidence is a PAIR. There is no scalar, and no function returning one. */
export interface Confidence {
  readonly horizon: number
  readonly slack: number
}

export type ConfidenceOrder = "better" | "worse" | "equal" | "incomparable"

/**
 * The partial order on confidence. Deeper-and-tighter dominates; deeper-but-
 * looser is INCOMPARABLE, and that is the whole point — a deepen may honestly
 * reopen a decided decision, and the report says so instead of pretending a
 * scalar fell.
 */
export function compareConfidence(a: Confidence, b: Confidence): ConfidenceOrder {
  const dh = a.horizon - b.horizon
  const ds = b.slack - a.slack // less slack is better
  if (dh === 0 && ds === 0) return "equal"
  if (dh >= 0 && ds >= 0) return "better"
  if (dh <= 0 && ds <= 0) return "worse"
  return "incomparable"
}

// -------------------------------------------------------- the verdict algebra

/**
 * One node's interval verdict with two-polarity attribution and the vacuity
 * bit. Interior joins keep each bound its own game: {min lo, min hi} at MIN
 * nodes, {max lo, max hi} at MAX nodes.
 */
export interface NodeVerdict {
  readonly lo: number
  readonly hi: number
  readonly loCite: ReadonlySet<UnitId>
  readonly hiCite: ReadonlySet<UnitId>
  readonly loVacuous: boolean
}

function union(a: ReadonlySet<UnitId>, b: ReadonlySet<UnitId>): Set<UnitId> {
  const out = new Set(a)
  for (const x of b) out.add(x)
  return out
}

/**
 * MIN node (the adversary's choice). Tie-vacuity direction: AND — the
 * adversary picks the binding child, so the node's floor is refinable only if
 * EVERY tied-minimum child is.
 */
export function worstJoin(a: NodeVerdict, b: NodeVerdict): NodeVerdict {
  const lo = Math.min(a.lo, b.lo)
  const hi = Math.min(a.hi, b.hi)
  const loCite = a.lo === b.lo ? union(a.loCite, b.loCite) : a.lo < b.lo ? a.loCite : b.loCite
  const hiCite = a.hi === b.hi ? union(a.hiCite, b.hiCite) : a.hi < b.hi ? a.hiCite : b.hiCite
  const loVacuous =
    a.lo < b.lo ? a.loVacuous : b.lo < a.lo ? b.loVacuous : a.loVacuous && b.loVacuous
  return { lo, hi, loCite, hiCite, loVacuous }
}

/**
 * MAX node (our own choice). Tie-vacuity direction: OR — we pick, so ANY
 * refinable tied child keeps the demand alive.
 */
export function bestJoin(a: NodeVerdict, b: NodeVerdict): NodeVerdict {
  const lo = Math.max(a.lo, b.lo)
  const hi = Math.max(a.hi, b.hi)
  const loCite = a.lo === b.lo ? union(a.loCite, b.loCite) : a.lo > b.lo ? a.loCite : b.loCite
  const hiCite = a.hi === b.hi ? union(a.hiCite, b.hiCite) : a.hi > b.hi ? a.hiCite : b.hiCite
  const loVacuous =
    a.lo > b.lo ? a.loVacuous : b.lo > a.lo ? b.loVacuous : a.loVacuous || b.loVacuous
  return { lo, hi, loCite, hiCite, loVacuous }
}

// ------------------------------------------------------------ staging policy

/** What the stager compares — the contract's own type, re-exported. */
export type { StagingCandidate }

/** Derive a staging row from a scored plan. */
export function stagingRowOf(
  score: PlanScore,
  est: number,
  horizon: number,
  deadBelow: number = DEFAULT_DEAD_BELOW,
): StagingCandidate {
  const v = detectVacuity(score.bounds, deadBelow)
  return {
    key: planKey(score.plan),
    lo: score.bounds.worst,
    est,
    hi: score.bounds.best,
    horizon,
    vacuity: v.cause,
  }
}

/**
 * Leader selection under a channel policy.
 *
 * `adjudicate` (SIGHTED / FOGGED-DISCRIMINATING): highest lo among candidates
 * that are neither vetoed nor vacuous; ties by est. A vacuous lo may not WIN.
 *
 * `veto` (FOGGED-VACUOUS): lo removes the inadmissible (certain material
 * death) and does nothing else; est orders what is left, ties by hi. est is
 * ORDERING a set lo chose — it is not adjudicating.
 *
 * Both modes fall back, in order, to the un-vetoed candidates and then to the
 * whole set ordered by hi, so a leader always exists: staging nothing is never
 * an outcome of this function.
 */
export function pickLeader(
  rows: ReadonlyArray<StagingCandidate>,
  policy: ChannelPolicy,
): number {
  if (rows.length === 0) return -1
  const admissible: number[] = []
  for (let i = 0; i < rows.length; i++) if (!vetoed(rows[i].vacuity)) admissible.push(i)

  if (policy.loRole === "veto") {
    const pool = admissible.length > 0 ? admissible : rows.map((_, i) => i)
    return bestOf(rows, pool, (r) => r.est, (r) => r.hi)
  }

  const alive = admissible.filter((i) => rows[i].vacuity === "alive")
  if (alive.length > 0) return bestOf(rows, alive, (r) => r.lo, (r) => r.est)
  if (admissible.length > 0) return bestOf(rows, admissible, (r) => r.hi, (r) => r.est)
  return bestOf(rows, rows.map((_, i) => i), (r) => r.hi, (r) => r.est)
}

function bestOf(
  rows: ReadonlyArray<StagingCandidate>,
  pool: ReadonlyArray<number>,
  primary: (r: StagingCandidate) => number,
  secondary: (r: StagingCandidate) => number,
): number {
  let best = pool[0]
  for (const i of pool) {
    const a = rows[i]
    const b = rows[best]
    if (primary(a) > primary(b) || (primary(a) === primary(b) && secondary(a) > secondary(b))) {
      best = i
    }
  }
  return best
}

/** Root slack: `max over rivals (R.hi − L.lo)`. NOT the leader's bound gap. */
export function rootSlack(rows: ReadonlyArray<StagingCandidate>, leaderIdx: number): number {
  if (rows.length <= 1) return 0
  const lo = rows[leaderIdx].lo
  let slack = Number.NEGATIVE_INFINITY
  for (let i = 0; i < rows.length; i++) {
    if (i === leaderIdx) continue
    slack = Math.max(slack, rows[i].hi - lo)
  }
  return slack
}

/**
 * Minimum lo improvement before the staged move switches leader at the same
 * horizon (RESULTS F1). Raw anytime streams without it had mid-budget regret
 * spikes of ~1000 from tie-flips and ≤4-point h=1 refutations that reversed at
 * h=2.
 *
 * ── WHY IT IS NOT FIVE ANY MORE ────────────────────────────────────────────
 *
 * Five was calibrated against material, and against a stream that reached
 * horizon 2. Neither holds. On this build the horizon is always 1
 * (`kernel.ts` reads `run.lastView?.horizon ?? 1` and the production search
 * core is not a `Refiner`, so the view is never built) — so the "refutation
 * that reverses at h=2" the margin was protecting against cannot occur. And the
 * whole POSITIONAL vocabulary — reach, room, command, food, momentum,
 * energyEconomy — spans about four points at its widest, against material's ten
 * per unit of weight. A margin of five therefore did not damp positional churn:
 * it made positional value UNSTAGEABLE. Nothing the evaluator could say about
 * where a unit should go was ever worth five, so the staged plan was whatever
 * `seedPlan` picked first — the generator's ordered-first candidate — for the
 * whole game unless half a unit of material changed hands.
 *
 * That is what a bot looks like when its snakes walk in straight lines past the
 * food and its pieces never move: the traces are in
 * `docs/BASIC-INTELLIGENCE.md`, and 80% of all staged moves in a recorded game
 * were the seed, untouched.
 *
 * The margin's real job is to refuse a switch that is worth nothing — floating
 * point noise, and exact ties. Exact ties are already refused by the strict
 * `>`; noise is bounded well below a hundredth. So the margin is now one
 * thousandth of the lightest unit's material: large enough that no rounding
 * difference can restage a move, small enough that every distinction the
 * criterion profile is capable of drawing can.
 */
export const DEFAULT_SWITCH_MARGIN = 0.01

export interface StagingDecision {
  readonly staged: StagingCandidate
  readonly leader: StagingCandidate
  readonly switched: boolean
  readonly reason: "initial" | "collapse" | "improved" | "gradient" | "sticky"
  readonly slack: number
  readonly horizon: number
}

/**
 * Sticky staging. Holds the staged key across rounds and applies F1/F2 plus
 * the dead-dethroned-only-by-the-living rule.
 */
export class StickyStager {
  private stagedKey: string | null = null

  constructor(
    private readonly margin: number = DEFAULT_SWITCH_MARGIN,
    private readonly deadBelow: number = DEFAULT_DEAD_BELOW,
  ) {}

  get key(): string | null {
    return this.stagedKey
  }

  /** Forced adoption — the epoch-change conformance path re-stages outright. */
  adopt(key: string): void {
    this.stagedKey = key
  }

  stage(rows: ReadonlyArray<StagingCandidate>, policy: ChannelPolicy): StagingDecision {
    if (rows.length === 0) throw new Error("StickyStager.stage: no candidates")
    const leaderIdx = pickLeader(rows, policy)
    const leader = rows[leaderIdx]
    const slack = rootSlack(rows, leaderIdx)
    const horizon = Math.min(...rows.map((r) => r.horizon))
    const incumbent = rows.find((r) => r.key === this.stagedKey)

    if (this.stagedKey === null || incumbent === undefined) {
      this.stagedKey = leader.key
      return { staged: leader, leader, switched: true, reason: "initial", slack, horizon }
    }

    // A dead incumbent is dethroned only by a LIVING leader. When everything
    // reads DEAD there is no information to switch on and hi-order churn flips
    // the staged move for nothing. And a cloud-contingent-DEAD incumbent is
    // not "dead" for this purpose at all — it is a demand being serviced.
    const incumbentMaterialDead = incumbent.vacuity === "material-dead"
    const leaderLiving = leader.vacuity === "alive"
    if (incumbentMaterialDead && leaderLiving) {
      this.stagedKey = leader.key
      return { staged: leader, leader, switched: true, reason: "collapse", slack, horizon }
    }

    // F2: a cloud-contingent-DEAD (vacuous) incumbent stays staged while the
    // demand is serviced. Switching to a shallower-informed rival is preferring
    // ignorance. The one exception is the governed FOGGED-VACUOUS posture,
    // where by construction nothing will ever stop being vacuous and the stage
    // record explicitly stands on the gradient — there, the ORDERING channel
    // (est, over an lo-vetoed set) may dethrone by the same margin rule.
    const incumbentVacuous = incumbent.vacuity === "cloud-contingent-dead"
    if (incumbentVacuous && !policy.vacuousMayWin) {
      return { staged: incumbent, leader, switched: false, reason: "sticky", slack, horizon }
    }
    if (incumbentVacuous && policy.vacuousMayWin) {
      const better =
        leader.horizon >= incumbent.horizon && leader.est > incumbent.est + this.margin
      if (better) {
        this.stagedKey = leader.key
        return { staged: leader, leader, switched: true, reason: "gradient", slack, horizon }
      }
      return { staged: incumbent, leader, switched: false, reason: "sticky", slack, horizon }
    }

    // F1: a ≥margin lo improvement at an equal-or-deeper horizon.
    if (leader.horizon >= incumbent.horizon && leader.lo > incumbent.lo + this.margin) {
      this.stagedKey = leader.key
      return { staged: leader, leader, switched: true, reason: "improved", slack, horizon }
    }
    return { staged: incumbent, leader, switched: false, reason: "sticky", slack, horizon }
  }

  /** Exposed so callers can name the cliff they are staging against. */
  get dead(): number {
    return this.deadBelow
  }
}

// ------------------------------------------------------------------- levers
//
// The lever vocabulary — Rung, Lever, HeldUnitView, CandidateView, LeverView —
// was PROMOTED to contracts.ts with the SearchCore refiner amendment (the
// optional refinementView/refine members are typed against it there).
// Re-exported here so this module remains the reference point for VOC
// consumers and the pre-promotion import paths keep working.

/** The pre-promotion name for the contract's RefinementRung. */
export type Rung = RefinementRung

export type LeverFamily = "prove" | "disprove" | "repair" | "depth"

export type { CandidateView, HeldUnitView, Lever, LeverView }

interface LeverEstimate {
  readonly lever: Lever
  readonly value: number
  readonly cost: number
  readonly family: LeverFamily
}

interface Attribution {
  readonly unit: HeldUnitView
  readonly citeLo: number
  readonly citeHi: number
  readonly branchesCiting: number
}

function attributions(view: LeverView): Attribution[] {
  const open = view.candidates.filter((c) => !c.refuted)
  const leader = view.candidates[view.leaderIdx]
  const out: Attribution[] = []
  for (const unit of view.units) {
    if (unit.rung === "advanced") continue
    let citeLo = 0
    let citeHi = 0
    let branchesCiting = 0
    for (const c of open) {
      const isLeader = c === leader
      let cited = false
      if (c.loCite.has(unit.unitId)) {
        citeLo += isLeader ? 2 : 1
        cited = true
      }
      // Rival optimism crossing this cloud as if absent: the disprove signal.
      if (!isLeader && c.hiCite.has(unit.unitId)) {
        citeHi += 1
        cited = true
      }
      if (cited) branchesCiting++
    }
    out.push({ unit, citeLo, citeHi, branchesCiting })
  }
  return out
}

/**
 * The §4 value-of-computation estimates. Forecasts, not guarantees: they only
 * ORDER levers. Slack itself is always recomputed on the fully joint re-scored
 * tree, so a chased marginal that does not move the joint decision costs one
 * round of budget, never a wrong confidence claim.
 */
function estimates(view: LeverView, gate: boolean, leverage: boolean): LeverEstimate[] {
  const out: LeverEstimate[] = []
  const advancedCount = view.units.filter((u) => u.rung === "advanced").length
  for (const a of attributions(view)) {
    const h = a.unit
    // The gate: possible relevance (meeting time within the next ring) OR
    // direct evidence of relevance (a ledger citation).
    const gated = h.meet <= view.horizon + 1 || a.citeLo > 0 || a.citeHi > 0
    if (gate && !gated) continue

    if (h.staleness > 0) {
      // Shared-refinement leverage: a root-level repair is inherited by every
      // branch containing the unit, so its value multiplies by the open
      // branches citing it while its cost stays single.
      const mult = leverage ? 1 + a.branchesCiting : 1
      out.push({
        lever: { kind: "catchup", unit: h.unitId },
        value: (a.citeLo + a.citeHi + 0.5) * mult * (1 + 0.5 * h.staleness),
        cost: h.staleness + 1,
        family: "repair",
      })
      continue // stale units cannot be narrowed or advanced (lever preconditions)
    }
    if (h.rung === "free" && a.citeLo > 0) {
      // Saturation ordering: the cloud nearest to covering the room is the one
      // about to go blind, and the one whose narrowing buys the most.
      const satRatio = Math.min(1, h.cloudSize / Math.max(1, view.interiorCells))
      out.push({
        lever: { kind: "narrow", unit: h.unitId },
        value:
          a.citeLo * (1 - Math.min(1, 4 / Math.max(4, h.cloudSize))) * (0.5 + satRatio) + 0.01,
        cost: 2,
        family: "prove",
      })
    }
    if (a.citeLo > 0 || a.citeHi > 0) {
      const stillCited = h.rung === "narrowed" && a.citeLo > 0 ? 0.5 : 0
      // An advance's cost RECURS: every future deepen multiplies by this
      // unit's option count. Price the remaining horizon in, or advance
      // underprices narrow and the ladder is climbed from the wrong end.
      const remainingDepth = Math.max(0, view.depthMax - view.horizon)
      out.push({
        lever: { kind: "advance", unit: h.unitId },
        value: 0.7 * a.citeLo + 1.2 * a.citeHi + stillCited,
        cost: 3 * (advancedCount + 1) * Math.max(1, view.horizon) * (1 + 2 * remainingDepth),
        family: a.citeHi > a.citeLo ? "disprove" : "prove",
      })
    }
  }
  return out
}

function argmaxPerCost(ests: ReadonlyArray<LeverEstimate>): LeverEstimate | undefined {
  let best: LeverEstimate | undefined
  for (const e of ests) {
    if (e.value <= 0) continue
    if (best === undefined || e.value / e.cost > best.value / best.cost) best = e
  }
  return best
}

/** Prove/disprove alternation: within 2× of the argmax, prefer the family not used last. */
function alternate(
  ests: ReadonlyArray<LeverEstimate>,
  lastFamily: LeverFamily | null,
): LeverEstimate | undefined {
  const best = argmaxPerCost(ests)
  if (best === undefined) return undefined
  if (lastFamily === null || best.family !== lastFamily) return best
  const bestRatio = best.value / best.cost
  let other: LeverEstimate | undefined
  for (const e of ests) {
    if (e.value <= 0 || e.family === lastFamily) continue
    if (e.value / e.cost < bestRatio / 2) continue
    if (other === undefined || e.value / e.cost > other.value / other.cost) other = e
  }
  return other ?? best
}

/**
 * The orchestrator proper: gated, two-ledger VOC with a horizon ration, in the
 * corrected macro-order, restricted by the posture's channel policy.
 *
 * Stateful only in `lastFamily` (the alternation) and `slackScale` (the
 * decision's own value scale, since the evaluator's units are arbitrary).
 */
export class VocOrchestrator {
  private lastFamily: LeverFamily | null = null
  private slackScale: number | null = null
  private readonly log: Lever[] = []

  constructor(private readonly deadBelow: number = DEFAULT_DEAD_BELOW) {}

  get levers(): ReadonlyArray<Lever> {
    return this.log
  }

  next(view: LeverView, policy: ChannelPolicy): Lever {
    const lever = this.choose(view, policy)
    this.log.push(lever)
    return lever
  }

  private choose(view: LeverView, policy: ChannelPolicy): Lever {
    if (view.candidates.length === 0) return { kind: "stop" }
    let ests = estimates(view, true, true)

    // Posture gate. Under FOGGED-VACUOUS, slack-buying is worthless BY
    // CONSTRUCTION (the cited units cannot be refined into a discriminating
    // floor), so narrow/advance are struck out and the budget transfers to
    // depth on our own plan plus repairs — a catch-up is the one lever that
    // can still make the demand serviceable and end the posture.
    if (policy.spend === "depth-and-gradient") {
      ests = ests.filter((e) => e.family === "repair")
    }

    // Stability is RELATIVE to the decision's own scale. Vacuous-scale slacks
    // (the DEAD cliff) are not a scale, so they never set it.
    if (view.slack > 0 && view.slack < Math.abs(this.deadBelow) / 2) {
      this.slackScale = this.slackScale === null ? view.slack : Math.max(this.slackScale, view.slack)
    }
    const stable =
      view.slack <= Math.max(view.epsilon, this.slackScale === null ? 0 : 0.2 * this.slackScale)

    // ---- DEPTH PREVIEW ----------------------------------------------------
    // While NOTHING is advanced a deepen costs almost nothing, and an advance's
    // cost recurs through every later deepen. So before the first
    // multiplicative spend only REPAIRS may pre-empt depth: stale clouds make
    // deep leaves vacuous, so catch-up first — but narrowing can wait, because
    // the depth section's deadline veto already forces exactly the narrows the
    // new ply needs, and no others.
    const anyAdvanced = view.units.some((u) => u.rung === "advanced")
    const leader = view.candidates[view.leaderIdx]
    const previewDue = !anyAdvanced && leader !== undefined && leader.horizon < view.depthMax
    const pool = previewDue ? ests.filter((e) => e.family === "repair") : ests

    if (!stable || previewDue) {
      const chosen = alternate(pool, this.lastFamily)
      if (chosen !== undefined) {
        this.lastFamily = chosen.family
        return chosen.lever
      }
      // Nothing to repair at this horizon: fall through to depth.
    }

    // ---- the depth ration -------------------------------------------------
    // Deepen only the branches that DEFINE the decision: the leader (its lo
    // must survive depth) and the un-refuted rival with the highest hi (its
    // optimism must be confronted). Never the already-refuted. Deepen is never
    // chosen by a Δslack comparison — the two currencies do not exchange.
    const rival = view.candidates
      .filter((c) => c !== leader && !c.refuted)
      .sort((a, b) => b.hi - a.hi)[0]
    for (const target of [leader, rival]) {
      if (target === undefined || target.horizon >= view.depthMax) continue
      // The deadline law: never deepen past a FREE gated unit's meeting time —
      // narrow it first, or the new leaves arrive vacuous.
      const free = view.units
        .filter(
          (u) => u.rung === "free" && u.staleness === 0 && u.refinable && u.meet <= target.horizon + 1,
        )
        .sort((a, b) => a.meet - b.meet)[0]
      if (free !== undefined && policy.spend === "slack") {
        this.lastFamily = "prove"
        return { kind: "narrow", unit: free.unitId }
      }
      const stale = view.units
        .filter((u) => u.staleness > 0 && u.refinable && u.meet <= target.horizon + 1)
        .sort((a, b) => a.meet - b.meet)[0]
      if (stale !== undefined) {
        this.lastFamily = "repair"
        return { kind: "catchup", unit: stale.unitId }
      }
      this.lastFamily = "depth"
      return { kind: "deepen", planKey: target.key, reason: previewDue ? "preview" : "ration" }
    }

    // Horizon exhausted: keep closing slack if any lever remains.
    const chosen = alternate(ests, this.lastFamily)
    if (chosen !== undefined) {
      this.lastFamily = chosen.family
      return chosen.lever
    }
    return { kind: "stop" }
  }
}

// -------------------------------------------------------- the refiner seam

/**
 * The lever surface a search exposes for VOC's ordering to bind.
 *
 * LANDED as the contract's optional `SearchCore.refinementView`/`refine`
 * members. `asRefiner` narrows a SearchCore that implements BOTH, and the
 * kernel runs the plain `improve()` loop when it does not — the lever order
 * is then advisory rather than binding, and the kernel says so in its report
 * (`leverOrderBinding: false`; watch it in the integration profile — the
 * production search core does not implement the surface yet).
 */
export interface Refiner {
  refinementView(ctx: SearchContext): LeverView
  refine(ctx: SearchContext, lever: Lever): PlanScore
}

export function asRefiner(core: unknown): Refiner | null {
  const c = core as Partial<Refiner> | null | undefined
  if (c == null) return null
  return typeof c.refinementView === "function" && typeof c.refine === "function"
    ? (c as Refiner)
    : null
}

// ------------------------------------------------------------- demand service

/**
 * The demand a vacuous floor makes, expressed as the units it is asking about.
 * `serviceable` is false when no cited unit can be refined — which is exactly
 * the condition that flips the posture to FOGGED-VACUOUS.
 */
export interface VacuityDemand extends VacuityVerdict {
  readonly serviceable: boolean
}

export function demandOf(
  score: PlanScore,
  units: ReadonlyArray<HeldUnitView>,
  deadBelow: number = DEFAULT_DEAD_BELOW,
): VacuityDemand {
  const v = detectVacuity(score.bounds, deadBelow)
  if (!v.demand) return { ...v, serviceable: false }
  const serviceable = units.some((u) => v.citedUnits.has(u.unitId) && u.refinable)
  return { ...v, serviceable }
}
