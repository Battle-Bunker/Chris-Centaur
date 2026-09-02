/**
 * THE MULTI-START SEED — a literally random safe baseline, then sampled
 * multi-start hill climbing, then a weighted-random selection among what was
 * found.
 *
 * ── WHY THIS EXISTS, AND WHAT IT REPLACES ──────────────────────────────────
 *
 * The previous joint-seed attempt (`./cluster-seed.ts`, `CENTAUR_CLUSTER_SEED`)
 * is REJECTED on measurement. Its failure shape is not "it picked bad moves":
 * it is a committed greedy argmax that builds ONE joint assignment, unit by
 * unit, each choice constraining the rest — and the plan it builds is so
 * plausible that the coordinate ascent above it settles beside it rather than
 * climbing away. The replay evidence is unambiguous:
 *
 *   · own-team head separation 10.70 → 6.51 cells (−3.97, controlled for
 *     survivorship over 949 matched full-strength turn-pairs);
 *   · distance to nearest wall 3.95 → 2.00 (−1.80), and mean wall distance
 *     below 2.0 by median turn 5 in 48 of 48 games, against 5 of 48 without;
 *   · from that pinned formation, collision deaths 46 → 220 per 48 games —
 *     `bodyBlock` 14 → 72, `contest` 13 → 70, `wall` 3 → 58;
 *   · and the search working twice as hard for it: +103% plans per decision
 *     with ten times the ratchet refusals, i.e. generating refinements to the
 *     deadline and refusing every one.
 *
 * TWO MECHANISMS PRODUCED THAT, and this module is built against both.
 *
 *   FORMATION PINNING. A purely spatial potential with de-confliction terms
 *   and one hair-width attractor has no boundary awareness and no dispersal at
 *   team scale, so its committed greedy collapses the team into a corner and
 *   holds it there. A seed must not have a systematic spatial preference at
 *   all — and the only assignment with no spatial preference whatsoever is a
 *   uniform draw over the moves the rules leave open. That is stage 0.
 *
 *   INTERLOCKED LOCAL MAXIMUM. One seed is one basin. A search handed one
 *   start can only climb out of it by paying for perturbed restarts at the far
 *   end of the budget, after the incumbent has already hardened. So the answer
 *   is not a better single start, it is MANY starts, cheap, before the
 *   expensive machinery runs — which is stage 1.
 *
 * ── WHAT THIS LAYER MAY AND MAY NOT DO ─────────────────────────────────────
 *
 * Everything here is SELECTION AMONG COMPLETE LEGAL PLANS. It chooses which
 * complete legal joint assignment the ascent starts from. It never removes a
 * candidate from any unit's set, never writes a `prunedLedger` entry, never
 * returns a set, and nothing here reaches `lo`, `est`, `hi`, a `Bound` or
 * `better()`. The plan it returns is priced by the real bank exactly like every
 * other trial, and the proved floor still adjudicates.
 *
 * That is the owner's placement law in its operative form: **a probability may
 * choose the ORDER or the SELECTION of exploration; never the set a floor
 * closes over.** And the safety floor is ALWAYS ON, not sampled: the fatality
 * tiering below runs on every unit on every call, and a rules-certain death is
 * only ever staged for a unit that has no other option at all.
 *
 * ── THE CURRENCY ───────────────────────────────────────────────────────────
 *
 * Every number in this file is denominated in WEIGHT UNITS — the material
 * lattice itself, where a unit of weight `w` dying is exactly `−w`. Heuristic
 * outputs tether to expected weight/score impact directly; there is no second
 * scale and no conversion. The edge-EV priors this module reads are already in
 * that currency, which is why composing them with the collision and fatality
 * charges below is literally addition.
 *
 * ── THE THIRD ROUND IS A SEAM, NOT A BUILD ─────────────────────────────────
 *
 * The owner's spec has a third stage: the same sampling apparatus run again
 * with more expensive board evaluations turned on. It is NOT built here, and
 * the seam it would attach to is named rather than left implicit — see
 * `MultiStartRequest.priorOf`. A round-two consumer supplies a costlier
 * `priorOf` (a surrogate joint evaluation, a scout finding, a real `price()`
 * over a shortlist) and everything else — the safety floor, the sampler, the
 * climb, the softmax, the budget slice — is unchanged. What such a round owes
 * before it ships is its own budget accounting: `priorOf` is called
 * `1 + climbSteps × vars × options` times per sample here, which is free for a
 * table lookup and ruinous for a `price()`.
 */

import { profileOf } from '../../partial-engine/index';
import type { Candidate, CandidateSet, CellIndex, JointPlan, UnitId } from '../contracts';
import { EngineSubstrate } from '../substrate';
import type { SubstrateUnit } from '../substrate';
import { allyBodyCollision, certainlySelfFatal } from '../staging-safety';
import { CertainOccupancy } from '../fatality';
import { gumbel, mix, uniform } from '../selection';
import { ConflictIndex, NO_CLAIM, subStepOf, subStepsFor } from './conflict-index';

/*
 * `CENTAUR_MULTISTART_SEED` IS DELETED — TODO(teardown-search) row retired here.
 *
 * The multi-start seed is now a CONFIGURATION of the search surface
 * (`SearchTuning.multistartSeed`) and not an environment switch: one seat
 * carries it while the seat across the board does not, and neither answer is a
 * property of the process. Default off, by stated default — the entry has not
 * been judged on a live race, and "off by config" is a decision somebody can
 * read rather than a dark path.
 */

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export interface MultiStartTuning {
  /**
   * The share of the DECISION's remaining budget the sampler may take.
   *
   * The whole point of a cheap multi-start is that it runs BEFORE the
   * expensive machinery and leaves that machinery its budget. A tenth of a
   * one-second turn is the ~100 ms slice the spec names, and at the measured
   * cost of one combo evaluation it buys thousands of samples.
   */
  readonly budgetFraction: number;
  /**
   * A HARD CEILING on the slice, in milliseconds, whatever the fraction says.
   *
   * The fraction alone is not a bound: an unbounded harness budget makes it
   * infinite, and a very long turn would spend a proportionally very long time
   * sampling a seed that stops improving long before that. The spec's own
   * figure is ~100 ms of a one-second turn, so the ceiling is set just above it
   * and the fraction is what binds on every real turn.
   */
  readonly maxBudgetMs: number;
  /**
   * Combo evaluations per millisecond, for sizing the sample count WITHOUT
   * reading a clock per sample.
   *
   * The count is computed ONCE from the budget and then the loop is a pure
   * function of it, so two runs at the same budget draw the same samples in
   * the same order. The clock is still consulted, but only as a backstop every
   * `CLOCK_STRIDE` samples — a truncation, never a re-plan. Deliberately
   * conservative: over-estimating the cost spends less than the slice, which
   * is the safe direction for a layer whose whole promise is not to starve the
   * ascent.
   */
  readonly evalsPerMs: number;
  /** Floor and ceiling on the samples one cluster may draw. */
  readonly minSamples: number;
  readonly maxSamples: number;
  /**
   * Coordinate-ascent passes from each sample. "A few", per the spec.
   *
   * Each pass walks the cluster's variables in a per-sample seeded order and
   * takes the best option for each, holding the rest. Two is enough for the
   * second pass to see the first pass's improvements; more buys little because
   * the objective is order-2 by construction.
   */
  readonly climbSteps: number;
  /**
   * Randomised orders stage 0 tries before it accepts the least-bad one.
   *
   * Stage 0's coordination is the ORDER units pick in: whoever picks first at a
   * contested cell gets it, and everyone after sees it taken. A different order
   * is a different assignment of the risky cell, so retrying the order IS the
   * search over safe joint combos the spec asks for.
   */
  readonly stage0Attempts: number;
  /** Opening softmax temperature, in weight units. */
  readonly t0: number;
  /** How sharply the temperature falls with the remaining decision budget. */
  readonly gamma: number;
  /** The floor. Above zero: the selection is weighted-random, never argmax. */
  readonly tMin: number;
  /** Distinct combos one cluster's pool holds. See `poolCap`'s use. */
  readonly poolCap: number;
  /**
   * Manhattan radius the polish's room/dispersion gate calls "near".
   *
   * Two, because that is the distance at which two of our heads can contest a
   * common cell, and it is the scale the compression was measured on: own-team
   * head separation 10.70 → 6.51 under the rejected seed. See `crowdedUnits`.
   */
  readonly crowdingRadius: number;
  /** The private per-match seed. NEVER ON THE WIRE — see `selection/rng.ts`. */
  readonly matchSeed: number;
}

export const DEFAULT_MULTISTART: MultiStartTuning = {
  budgetFraction: 0.1,
  maxBudgetMs: 120,
  evalsPerMs: 600,
  minSamples: 16,
  maxSamples: 4096,
  climbSteps: 2,
  stage0Attempts: 8,
  t0: 0.25,
  gamma: 2,
  tMin: 0.02,
  poolCap: 512,
  crowdingRadius: 2,
  matchSeed: 0,
};

/** Samples between clock reads. A backstop, not the schedule. */
const CLOCK_STRIDE = 64;

// ---------------------------------------------------------------------------
// Node addresses
// ---------------------------------------------------------------------------

/**
 * A node is a place where a set is ordered or an option drawn; an arm is a
 * member of that set. Distinct tags keep stage 0's draws for unit 3 out of
 * stage 1's draws for unit 3 — the same arm at two different decisions is two
 * different questions and must not share a stream.
 */
const NODE_STAGE0_ORDER = 0x5a_00_00_01;
const NODE_STAGE0_PICK = 0x5a_00_00_02;
const NODE_STAGE1_SAMPLE = 0x5a_00_00_03;
const NODE_STAGE1_CLIMB = 0x5a_00_00_04;
const NODE_STAGE1_SELECT = 0x5a_00_00_05;

// ---------------------------------------------------------------------------
// The option tiers — THE ALWAYS-ON SAFETY FLOOR
// ---------------------------------------------------------------------------

/**
 * One unit's options, split by what the RULES say about them, once per
 * decision.
 *
 *   `safe`         no rules-certain death of any kind against it.
 *   `ownTeamRisk`  no rules-certain death by the mover's OWN facts, but it
 *                  enters a team-mate's living body — the spec's "moves that
 *                  only risk own-team collisions".
 *   `all`          everything offered, in the generator's own order.
 *
 * The split is the safety floor and it is NOT sampled: it runs on every unit on
 * every call, and `chooseSet` below is what makes "never stage a provably-fatal
 * move when a safe one exists" a property of the algorithm rather than a
 * probability.
 */
export interface UnitOptions {
  readonly unitId: UnitId;
  readonly unit: SubstrateUnit | undefined;
  readonly all: ReadonlyArray<Candidate>;
  readonly safe: ReadonlyArray<Candidate>;
  readonly ownTeamRisk: ReadonlyArray<Candidate>;
  /** Rules-certain self-death per index into `all`. */
  readonly fatal: ReadonlyArray<boolean>;
  /** Enters a team-mate's living body, per index into `all`. */
  readonly allyRisk: ReadonlyArray<boolean>;
  /** The set stage 0 and stage 1 draw from. See the type doc. */
  readonly choose: ReadonlyArray<Candidate>;
  /** `choose`'s members as indices into `all`, for the prior lookup. */
  readonly chooseIndex: ReadonlyArray<number>;
}

/**
 * Split one unit's options. `cap` is a MAX-SIDE CAP on how many of the
 * generator's ordered options are considered — it can only lower an achievable
 * floor and therefore needs no declaration, exactly as `topCandidates` does.
 */
export function classifyOptions(
  sub: EngineSubstrate,
  unitId: UnitId,
  set: CandidateSet,
  cap: number,
): UnitOptions {
  const unit = sub.unitOf(unitId);
  const limit = Math.max(1, Math.min(cap, set.candidates.length));
  const all: Candidate[] = [];
  for (let i = 0; i < limit; i++) all.push(set.candidates[i] as Candidate);
  if (all.length === 0) {
    const restored = set.prunedLedger[0]?.candidate;
    if (restored !== undefined) all.push(restored);
  }
  const fatal: boolean[] = [];
  const allyRisk: boolean[] = [];
  const safe: Candidate[] = [];
  const risky: Candidate[] = [];
  const safeIdx: number[] = [];
  const riskyIdx: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const candidate = all[i] as Candidate;
    if (unit === undefined) {
      fatal.push(false);
      allyRisk.push(false);
      safe.push(candidate);
      safeIdx.push(i);
      continue;
    }
    const dead = certainlySelfFatal(sub, unit, candidate) !== null;
    fatal.push(dead);
    const ally = !dead && allyBodyCollision(sub, unit, candidate);
    allyRisk.push(ally);
    if (dead) continue;
    if (ally) {
      risky.push(candidate);
      riskyIdx.push(i);
    } else {
      safe.push(candidate);
      safeIdx.push(i);
    }
  }
  // THE FLOOR, IN ONE LINE. A rules-certain death is only ever drawn for a unit
  // that has nothing else — which is the precise statement of "never stage a
  // provably-fatal move when a safe combo exists", because a unit with no
  // survivable option has no safe combo to be part of.
  const [choose, chooseIndex] =
    safe.length > 0
      ? [safe, safeIdx]
      : risky.length > 0
        ? [risky, riskyIdx]
        : [all, all.map((_, i) => i)];
  return { unitId, unit, all, safe, ownTeamRisk: risky, fatal, allyRisk, choose, chooseIndex };
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

export interface MultiStartRequest {
  readonly sub: EngineSubstrate;
  /** EVERY unit this decision commands, pinned and referenced ones included. */
  readonly roster: ReadonlyArray<UnitId>;
  /** The units the sampler may move, in the order the caller ranked them. */
  readonly order: ReadonlyArray<UnitId>;
  readonly sets: ReadonlyMap<UnitId, CandidateSet>;
  /** Units whose choice is settled before anything is sampled. */
  readonly fixed: JointPlan;
  /**
   * The clusters, as a PARTITION OF THE VARIABLES — each free unit in exactly
   * one group.
   *
   * This is the cluster partition's components, plus one group holding our
   * sliders. It deviates from the standing "every slider is a member of every
   * cluster" ruling in one direction only and on purpose: that ruling is about
   * what a cluster's SEARCH must see, and this layer's objective is evaluated
   * over the WHOLE joint plan every time, so every group's sampling is already
   * conditional on every other group's current assignment. What the partition
   * decides here is only which coordinates one group is allowed to VARY, and a
   * coordinate two groups both varied would have no well-defined merge.
   *
   * Empty, or missing a free unit, is not an error: anything unlisted is
   * swept into a final catch-all group so no unit is ever left unassigned.
   */
  readonly clusters: ReadonlyArray<ReadonlyArray<UnitId>>;
  readonly tuning: MultiStartTuning;
  /** The decision seed. Path-addressed draws hang off it; see `selection/rng`. */
  readonly seed: number;
  /** Options per unit the sampler considers. A max-side cap. */
  readonly cap: number;
  /** Milliseconds this whole call may spend. */
  readonly budgetMs: number;
  /** The share of the DECISION's budget still unspent, for the temperature. */
  readonly remainingFraction: number;
  /** The caller's clock. Injected so a fake-clock suite is never flaky. */
  readonly now: () => number;
  /**
   * THE ROUND-2 SEAM. Per-candidate prior, in WEIGHT UNITS.
   *
   * Stage 1 asks this for every option of every unit it evaluates. Absent, or
   * returning 0, the priors are UNIFORM and the objective is the safety terms
   * alone — which is the honest reading when nothing cheap has an opinion.
   * Present, it is the integrated prior the selection is weighted by: today the
   * rung-1/2 edge-EV unary term where the edge-EV pass computed one, and the
   * place a richer round-2 evaluation attaches without touching anything else
   * in this file.
   */
  readonly priorOf?: (unitId: UnitId, optionIndex: number) => number;
}

/** What the layer did. Telemetry; never on the wire. */
export interface MultiStartReport {
  readonly seed: number;
  /** Groups actually sampled. */
  readonly clusters: number;
  /** Free units the sampler could move. */
  readonly variables: number;
  /** Stage-0 orders tried, and whether one came back conflict-free. */
  readonly stage0Attempts: number;
  readonly stage0Clean: boolean;
  /** Units stage 0 could not give a non-colliding option. */
  readonly stage0Conflicts: number;
  /** Units for which every offered option was rules-certain death. */
  readonly stage0Forced: number;
  /** Units the spec's second clause coordinated — no fatality-safe move at all.
   * Zero is the common case, and the case in which stage 0 de-conflicts
   * NOTHING: see `stageZero` on why that is the correction, not an oversight. */
  readonly stage0Coordinated: number;
  /** Stage-1 samples drawn, climb passes run, combo evaluations paid. */
  readonly samples: number;
  readonly climbs: number;
  readonly evaluations: number;
  /** Distinct combos the pools held, and how often the clock cut a pool short. */
  readonly pooled: number;
  readonly truncated: number;
  /** The slice asked for, and what the sampler reports having spent. */
  readonly budgetMs: number;
  readonly spentMs: number;
  /** The temperature the selection ran at. */
  readonly temperature: number;
  /** Objective of the stage-0 baseline, and of the plan actually selected. */
  readonly stage0Score: number;
  readonly selectedScore: number;

  // ------------------------------------------------- the opening instrument
  //
  // THE LAYER'S OWN CLAIM, MEASURED FOR THE FIRST TIME.
  //
  // The multi-start seed's stated benefit is OPENING DIVERSITY, and its first
  // live reading measured end-state share and death causes instead: it cost
  // 113 scout threads and 63 ms a game and, where anything was readable, gave
  // the weakest opponent more board. That is a verdict on the downstream
  // consequence of an upstream claim nobody instrumented, and the honest
  // response is to instrument the claim rather than to argue about the
  // consequence.
  //
  // Both rows below are read off state the sampler already holds, after the
  // selection and before anything is returned. They are TELEMETRY: no
  // objective, no draw and no selection reads them, so a decision with them
  // present is the decision that would have been taken without them.

  /**
   * OWN-TEAM SEPARATION of the plan actually selected — the mean pairwise
   * Manhattan distance, in cells, between where our units come to rest.
   *
   * This is the quantity the rejected seed's follow-the-tail bonus destroyed:
   * it converted a drifting formation into single file, own-team separation
   * FELL where it was supposed to rise, and the failure was legible only
   * afterwards in collision deaths. Publishing the number per decision makes
   * the mechanism claim checkable in the same run that measures the outcome.
   *
   * Zero when fewer than two units have a landing to compare.
   */
  readonly openingSeparation: number;
  /**
   * THE SAME QUANTITY FOR THE STAGE-0 BASELINE — the literally-random safe
   * assignment, before any sampling.
   *
   * The pair is the reading, not either number: `openingSeparation` alone says
   * how spread this decision's opening is, and only the difference says
   * whether the SAMPLER spread it. A layer whose two rows agree on every
   * decision has diversified nothing, however diverse the board looks.
   */
  readonly stage0Separation: number;
  /**
   * STAGED-ASSIGNMENT DIVERSITY ACROSS THE STARTS, in [0, 1].
   *
   * Per group, the mean over its slots of the chance that two distinct pooled
   * starts assign that unit a different option — `(p² − Σ_v c_v²) / (p(p−1))`
   * over the pool's per-slot choice counts — then averaged across groups
   * weighted by how many units each varies. One means every pair of starts
   * disagrees about every unit; zero means the pool holds one assignment
   * wearing many labels, which is the failure mode a multi-start has (a start
   * climbed to its local maximum has thrown away what made it different).
   *
   * Computed from the per-slot counts rather than pairwise, so it is one pass
   * over the pool and not `poolCap²` comparisons.
   */
  readonly startDiversity: number;
}

export interface MultiStartResult {
  readonly plan: JointPlan;
  /** The stage-0 baseline, before any sampling. Kept for the gate tests. */
  readonly stage0: JointPlan;
  readonly report: MultiStartReport;
}

// ---------------------------------------------------------------------------
// The objective
// ---------------------------------------------------------------------------

/**
 * `T(f) = max(T_min, T₀ · f^γ)` — the standing schedule, in weight units.
 *
 * Hot early to spread the selection across basins, cold late to settle on the
 * leader; the floor is above zero, so the selection is weighted-random for the
 * whole decision and never collapses to a deterministic argmax.
 */
function temperature(tuning: MultiStartTuning, fraction: number): number {
  if (tuning.t0 <= 0) return 0;
  const f = fraction > 1 ? 1 : fraction > 0 ? fraction : 0;
  const t = tuning.t0 * Math.pow(f, tuning.gamma);
  return t > tuning.tMin ? t : tuning.tMin;
}

/** A uniform integer in `[0, n)` from one path-addressed draw. */
function pickIndex(seed: number, node: number, arm: number, draw: number, n: number): number {
  if (n <= 1) return 0;
  const i = Math.floor(uniform(seed, node, arm, draw) * n);
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * THE OBJECTIVE, over a COMPLETE joint plan, in weight units.
 *
 *     score = Σ_u prior(u, a_u)          the integrated cheap priors
 *           − Σ_u weight(u) · [a_u is rules-certain death]
 *           − Σ_u weight(u) · [a_u enters a team-mate's living body]
 *           − Σ_u weight(u) · [a_u meets one of ours at a cell or an edge]
 *
 * Every penalty is the mover's OWN weight, because that is exactly what it
 * loses — the same number a team-mate's body or a lost contest costs it. A
 * self-inflicted death that scored differently from an ally-inflicted one would
 * make the choice between them arbitrary.
 *
 * NOTHING SPATIAL. No spacing term, no boundary term, NO FOLLOW-THE-TAIL TERM,
 * no distance to anything — deliberately, and it is the whole correction to the
 * rejected seed. Every term above is a fact about a collision or a rule; none
 * of them has a preferred direction on the board, so no formation can be
 * preferred and none can be pinned. Anything spatial that belongs in a seed
 * belongs in the priors, where the evaluator that measured it owns it.
 *
 * THE FOLLOW BONUS IS NAMED BECAUSE IT IS THE ONE THAT LOOKS HARMLESS. The
 * rejected seed carried `EPS_FOLLOW = +0.06` against an ordering step of 0.05 —
 * one ordering place, provably collision-free, and defensible on its own terms.
 * Measured live, it took landings on a team-mate's freed tail from 0.3% to 26%
 * and converted a drifting formation into single file, which is why own-team
 * separation FELL instead of rising. It is an amplifier rather than the driver
 * (the lowest-follow tercile of games is still pinned at wall 2.33 against
 * 3.82, and still carries five times the collision deaths) — but an amplifier
 * of exactly this failure has no business in the objective a seed is drawn
 * against, so it is not here and must not be added.
 */
class Objective {
  private readonly index = new ConflictIndex();
  /**
   * PER SLOT PER OPTION, FOLDED ONCE — the prior and the two rules charges.
   *
   *     base[slot][k] = prior(u, k) − w_u·[rules-certain death] − w_u·[ally body]
   *
   * All three are properties of ONE unit's ONE option and none of them depends
   * on what the rest of the team does, so they are computed once at construction
   * and read as a single float in the inner loop. What is left per evaluation is
   * the only genuinely joint term — whether the claim meets one of ours.
   */
  private readonly base: ReadonlyArray<Float64Array>;
  private readonly weight: Float64Array;
  private readonly jumps: Uint8Array;

  constructor(
    private readonly cells: number,
    private readonly subSteps: number,
    private readonly units: ReadonlyArray<UnitId>,
    private readonly opts: ReadonlyArray<UnitOptions>,
    private readonly fixed: JointPlan,
    priorOf: (unitId: UnitId, optionIndex: number) => number,
  ) {
    const base: Float64Array[] = [];
    this.weight = new Float64Array(units.length);
    this.jumps = new Uint8Array(units.length);
    for (let slot = 0; slot < units.length; slot++) {
      const o = opts[slot] as UnitOptions;
      const w = o.unit?.weight ?? 1;
      this.weight[slot] = w;
      this.jumps[slot] = o.unit !== undefined && !profileOf(o.unit.kind).traversesEdges ? 1 : 0;
      const row = new Float64Array(o.all.length);
      for (let k = 0; k < o.all.length; k++) {
        row[k] =
          priorOf(o.unitId, k) -
          (o.fatal[k] === true ? w : 0) -
          (o.allyRisk[k] === true ? w : 0);
      }
      base.push(row);
    }
    this.base = base;
  }

  /** `choice[slot]` is that unit's option INDEX INTO `UnitOptions.all`. */
  score(choice: Int32Array): number {
    const index = this.index;
    const units = this.units;
    const opts = this.opts;
    index.begin(this.cells, this.subSteps);
    for (const [unitId, candidate] of this.fixed) {
      index.claim(unitId, candidate.from, candidate.path);
    }
    for (let slot = 0; slot < units.length; slot++) {
      const candidate = (opts[slot] as UnitOptions).all[choice[slot] as number] as Candidate;
      index.claim(units[slot] as UnitId, candidate.from, candidate.path);
    }
    let total = 0;
    for (let slot = 0; slot < units.length; slot++) {
      const k = choice[slot] as number;
      total += (this.base[slot] as Float64Array)[k] as number;
      const candidate = (opts[slot] as UnitOptions).all[k] as Candidate;
      if (meets(index, units[slot] as UnitId, candidate, this.jumps[slot] === 1)) {
        total -= this.weight[slot] as number;
      }
    }
    return total;
  }

  /** The index the last `score` built — read it before the next call. */
  get lastIndex(): ConflictIndex {
    return this.index;
  }
}

/**
 * Does this claim meet one of ours — at a cell, at a sub-step, or across an
 * edge?
 *
 * Both channels, because a same-cell predicate alone misses the exchange
 * entirely: two units one apart that step through each other share no cell and
 * both die. Read off the index the caller already built, so this costs one slot
 * probe per claimed cell.
 */
function meets(
  index: ConflictIndex,
  unitId: UnitId,
  candidate: Candidate,
  jumps: boolean,
): boolean {
  const path = candidate.path;
  const steps = index.subSteps;
  if (path.length === 0) {
    for (let s = 1; s < steps; s++) {
      if (index.countAt(candidate.from, s) > 1) return true;
    }
    return false;
  }
  let prev = candidate.from;
  for (let i = 0; i < path.length; i++) {
    const cell = path[i] as CellIndex;
    const s = subStepOf(i);
    if (s >= steps) break;
    if (index.countAt(cell, s) > 1) return true;
    if (!jumps && index.swapPartnerAt(prev, cell, s, unitId) !== NO_CLAIM) return true;
    prev = cell;
  }
  const rest = path[path.length - 1] as CellIndex;
  for (let s = subStepOf(path.length - 1) + 1; s < steps; s++) {
    if (index.countAt(rest, s) > 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

/**
 * STAGE 0 + STAGE 1, in that order, and stage 0 is the answer whenever stage 1
 * has no budget.
 *
 * Returns a complete legal joint plan over `roster`: `fixed` verbatim, every
 * other commanded unit assigned one of its own offered options.
 */
export function multiStartSeed(req: MultiStartRequest): MultiStartResult {
  const { sub, order, sets, fixed, tuning, seed, cap } = req;
  const started = req.now();

  // ---- the options, and the safety floor, once ----------------------------
  const units: UnitId[] = [];
  const opts: UnitOptions[] = [];
  const slotOf = new Map<UnitId, number>();
  const paths: Array<ReadonlyArray<CellIndex>> = [];
  for (const candidate of fixed.values()) paths.push(candidate.path);
  for (const unitId of order) {
    if (fixed.has(unitId)) continue;
    const set = sets.get(unitId);
    if (set === undefined) continue;
    const classified = classifyOptions(sub, unitId, set, cap);
    if (classified.all.length === 0) {
      throw new Error(
        `multi-start seed: no candidate at all for unit ${unitId} — a hard filter ` +
          'emptied the option set, which the completeness invariant forbids',
      );
    }
    slotOf.set(unitId, units.length);
    units.push(unitId);
    opts.push(classified);
    for (const candidate of classified.all) paths.push(candidate.path);
  }
  // ONE sub-step bound for the whole call, taken over the fixed assignments and
  // every option the seed could choose. Hoisted out of the evaluation because
  // it is a property of the position, not of a combo, and re-deriving it per
  // sample is most of what an evaluation would otherwise cost.
  const subSteps = subStepsFor(paths);
  const objective = new Objective(
    sub.grid.cells,
    subSteps,
    units,
    opts,
    fixed,
    req.priorOf ?? ((): number => 0),
  );
  const temp = temperature(tuning, req.remainingFraction);

  // ---- STAGE 0 ------------------------------------------------------------
  const base = stageZero(req, units, opts, subSteps, objective);
  const stage0Plan = materialise(base.choice, units, opts, fixed);
  const stage0Separation = separationOf(stage0Plan, sub.grid.width);

  if (units.length === 0 || req.budgetMs <= 0) {
    return {
      plan: stage0Plan,
      stage0: stage0Plan,
      report: report(req, base, units.length, temp, {
        clusters: 0,
        samples: 0,
        climbs: 0,
        evaluations: base.evaluations,
        pooled: 0,
        truncated: 0,
        selectedScore: base.score,
        spentMs: req.now() - started,
        // Stage 1 never ran, so the selected opening IS the stage-0 one and
        // there is no pool to be diverse. Zero here is a measured zero.
        openingSeparation: stage0Separation,
        stage0Separation,
        startDiversity: 0,
      }),
    };
  }

  // ---- STAGE 1 ------------------------------------------------------------
  const groups = groupsOf(req.clusters, units, slotOf);
  const working = Int32Array.from(base.choice);
  const trial = new Int32Array(units.length);
  const deadline = started + req.budgetMs;
  const totalEvals = Math.max(1, Math.round(req.budgetMs * tuning.evalsPerMs));

  let samples = 0;
  let climbs = 0;
  let evaluations = base.evaluations;
  let pooled = 0;
  let truncated = 0;
  // The diversity reading, accumulated per group and weighted by how many
  // units each group varies, so one nine-unit group does not weigh the same as
  // one two-unit group in the average.
  let diversityWeighted = 0;
  let diversitySlots = 0;

  for (let g = 0; g < groups.length; g++) {
    const vars = groups[g] as Int32Array;
    if (vars.length === 0) continue;
    // The group's share of the evaluation budget, and how many evaluations one
    // sample costs at this group's shape. Computed BEFORE the loop and never
    // revisited: the sample count is what makes two runs at one budget draw the
    // same samples in the same order.
    let optionSlots = 0;
    for (let v = 0; v < vars.length; v++) {
      optionSlots += (opts[vars[v] as number] as UnitOptions).choose.length;
    }
    const perSample = 1 + tuning.climbSteps * optionSlots;
    const share = Math.floor((totalEvals * vars.length) / units.length / perSample);
    const budgetSamples = Math.min(
      tuning.maxSamples,
      Math.max(tuning.minSamples, Number.isFinite(share) ? share : tuning.maxSamples),
    );

    const pool: Array<{ readonly choice: Int32Array; readonly score: number }> = [];
    const seen = new Set<string>();
    const admit = (choice: Int32Array, score: number): void => {
      const key = comboKey(vars, choice);
      if (seen.has(key)) return;
      // FIRST-COME, CAPPED — never "keep the best k".
      //
      // A pool that evicted its worst member would be a deterministic filter
      // wearing a lottery's clothes, and it would also break the prefix
      // property: a smaller budget's pool must be a PREFIX of a bigger one's,
      // or two budgets are not two lengths of the same decision.
      if (pool.length >= tuning.poolCap) return;
      seen.add(key);
      pool.push({ choice: Int32Array.from(choice), score });
    };
    // The stage-0 baseline is arm zero of every group's lottery. It is the
    // literally-random safe assignment and it competes on its merits like every
    // sampled combo — but it is always IN the pool, so a group whose budget
    // bought nothing still has something to select.
    admit(working, objective.score(working));
    evaluations++;

    let drawn = 0;
    for (let i = 0; i < budgetSamples; i++) {
      if (i % CLOCK_STRIDE === 0 && i > 0 && req.now() >= deadline) {
        truncated++;
        break;
      }
      const node = mix(NODE_STAGE1_SAMPLE, g);
      trial.set(working);
      for (let v = 0; v < vars.length; v++) {
        const slot = vars[v] as number;
        const o = opts[slot] as UnitOptions;
        const k = pickIndex(seed, node, v, i, o.choose.length);
        trial[slot] = o.chooseIndex[k] as number;
      }
      // A FEW COORDINATE-ASCENT STEPS. Not to convergence: the point of a
      // multi-start is coverage, and a start climbed to its local maximum is a
      // start that has thrown away everything that made it different — which is
      // also, exactly, the fixed point the rejected seed handed over.
      let current = objective.score(trial);
      evaluations++;
      for (let step = 0; step < tuning.climbSteps; step++) {
        let moved = false;
        const climbNode = mix(mix(NODE_STAGE1_CLIMB, g), step);
        const startAt = pickIndex(seed, climbNode, i, step, vars.length);
        for (let n = 0; n < vars.length; n++) {
          const slot = vars[(startAt + n) % vars.length] as number;
          const o = opts[slot] as UnitOptions;
          const held = trial[slot] as number;
          let bestIdx = held;
          let bestScore = current;
          for (const idx of o.chooseIndex) {
            if (idx === held) continue;
            trial[slot] = idx;
            const value = objective.score(trial);
            evaluations++;
            if (value > bestScore) {
              bestScore = value;
              bestIdx = idx;
            }
          }
          trial[slot] = bestIdx;
          if (bestIdx !== held) {
            moved = true;
            current = bestScore;
          }
        }
        climbs++;
        if (!moved) break;
      }
      admit(trial, current);
      drawn++;
    }
    samples += drawn;

    // ---- SOFTMAX SELECTION, over what this group found --------------------
    //
    // `argmax(score/T + Gumbel)` is an exact categorical draw with probability
    // proportional to `softmax(score/T)` — the owner's weighted-random
    // selection over integrated priors, in one pass and no sort. It chooses a
    // START, not a plan: the bank prices what comes out and `better()` still
    // adjudicates on the proved floor.
    let chosen = pool[0] as { readonly choice: Int32Array; readonly score: number };
    if (pool.length > 1) {
      const node = mix(NODE_STAGE1_SELECT, g);
      let bestKey = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < pool.length; i++) {
        const arm = pool[i] as { readonly choice: Int32Array; readonly score: number };
        const key = temp > 0 ? arm.score / temp + gumbel(seed, node, i, 0) : arm.score - i * 1e-9;
        if (key > bestKey) {
          bestKey = key;
          chosen = arm;
        }
      }
    }
    pooled += pool.length;
    // AFTER the selection and off the pool the selection read, so the number
    // describes the starts this decision actually chose among.
    diversityWeighted += diversityOf(pool, vars) * vars.length;
    diversitySlots += vars.length;
    for (let v = 0; v < vars.length; v++) {
      const slot = vars[v] as number;
      working[slot] = chosen.choice[slot] as number;
    }
  }

  const selectedScore = objective.score(working);
  evaluations++;
  const plan = materialise(working, units, opts, fixed);
  return {
    plan,
    stage0: stage0Plan,
    report: report(req, base, units.length, temp, {
      clusters: groups.length,
      samples,
      climbs,
      evaluations,
      pooled,
      truncated,
      selectedScore,
      spentMs: req.now() - started,
      openingSeparation: separationOf(plan, sub.grid.width),
      stage0Separation,
      startDiversity: diversitySlots === 0 ? 0 : diversityWeighted / diversitySlots,
    }),
  };
}

// ---------------------------------------------------------------------------
// Stage 0
// ---------------------------------------------------------------------------

interface StageZero {
  readonly choice: Int32Array;
  readonly score: number;
  readonly conflicts: number;
  readonly forced: number;
  /** Units the spec's second clause coordinated — no fatality-safe move. */
  readonly coordinated: number;
  readonly attempts: number;
  readonly clean: boolean;
  readonly evaluations: number;
}

/**
 * A LITERALLY RANDOM SELECTION OF MAXIMALLY SAFE MOVES — the spec's two
 * clauses, and they are two clauses on purpose.
 *
 *   CLAUSE 1, THE COMMON CASE. A unit that HAS a fatality-safe move draws
 *   UNIFORMLY over its fatality-safe moves. Nothing is scored, nothing is
 *   preferred, and — the part that matters — the draw is NOT de-conflicted
 *   against what its team-mates have already claimed. Two units may want one
 *   cell, and that is allowed.
 *
 *   CLAUSE 2, THE COORDINATION CASE. A unit that has NO guaranteed-safe move
 *   but has moves risking only an own-team collision is coordinated: it draws
 *   uniformly over the ones that touch nothing already claimed, so the risky
 *   cell is taken by exactly ONE unit and the combo as a whole is safe. These
 *   units are placed AFTER the clause-1 units, which is what makes "already
 *   claimed" mean the whole rest of the team rather than a prefix of it.
 *
 * ── WHY CLAUSE 1 MUST NOT DE-CONFLICT, WHICH IS THE WHOLE CORRECTION ────────
 *
 * The rejected seed's measured defect is not the plan it picked. It is that a
 * FULLY DE-CONFLICTED plan is accident-free, and an accident-free plan empties
 * the triggers of both multi-unit escape operators the search owns:
 * `selfInflictedPairs` (which arms `pairRepair`) and `contestedUnits` (which
 * arms `jointPolish`) both read the resolver's accident report and both come
 * back empty. What is left is `perturb`, which moves ONE unit off a plan the
 * surrogate already de-conflicted, loses on the floor, and breaks the loop. The
 * measured consequence is a search that goes inert: 0.2% improving slices
 * against 37% without the seed, at equal plan counts, from turn 1.
 *
 * So a multi-start that de-conflicted every start would pick the best of k
 * equally un-escapable fixed points, and would reproduce the failure it exists
 * to fix. THE SAFETY FLOOR AND DE-CONFLICTION ARE DIFFERENT THINGS, and only
 * the first is owed: clause 1 still guarantees no provably-fatal staging, while
 * leaving the accidents that arm the repair operators in the plan for the real
 * evaluator to price and the real operators to fix.
 *
 * ── AND THE DIVERSITY IS AT TEAM SCALE ─────────────────────────────────────
 *
 * Every attempt re-draws EVERY unit and re-draws the ORDER they are placed in.
 * A one-unit perturbation of a de-conflicted plan is measurably useless here
 * (`perturb` already is one); what has to move is the whole assignment at once.
 * Re-drawing the order also dissolves the fixed positional hierarchy the seed
 * path inherits — `dangerOrder` with a null resolution falls through to
 * ascending unit id, the same ranking on every turn of every game.
 *
 * A clean attempt — every coordinated unit placed without a conflict and no
 * unit forced onto a rules-certain death — is accepted immediately. Otherwise
 * the least-bad attempt stands and the report says so: there are positions
 * where no safe combo exists, and inventing one would be worse than staging the
 * least-bad and letting the ascent price it.
 */
function stageZero(
  req: MultiStartRequest,
  units: ReadonlyArray<UnitId>,
  opts: ReadonlyArray<UnitOptions>,
  subSteps: number,
  objective: Objective,
): StageZero {
  const { fixed, sub, seed, tuning } = req;
  const empty: StageZero = {
    choice: new Int32Array(0),
    score: 0,
    conflicts: 0,
    forced: 0,
    coordinated: 0,
    attempts: 0,
    clean: true,
    evaluations: 0,
  };
  if (units.length === 0) return empty;

  // The two clauses, split once. A unit is COORDINATED exactly when it has no
  // fatality-safe move at all — which is the only condition the spec's second
  // clause names.
  const plain: number[] = [];
  const coordinated: number[] = [];
  for (let slot = 0; slot < units.length; slot++) {
    ((opts[slot] as UnitOptions).safe.length > 0 ? plain : coordinated).push(slot);
  }

  const index = new ConflictIndex();
  let best: StageZero | null = null;
  const attempts = Math.max(1, tuning.stage0Attempts);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const orderNode = mix(NODE_STAGE0_ORDER, attempt);
    const order = [
      ...shuffled(plain, seed, orderNode),
      ...shuffled(coordinated, seed, mix(orderNode, 1)),
    ];
    index.begin(sub.grid.cells, subSteps);
    for (const [unitId, candidate] of fixed) index.claim(unitId, candidate.from, candidate.path);
    const choice = new Int32Array(units.length);
    let conflicts = 0;
    let forced = 0;
    for (let position = 0; position < order.length; position++) {
      const slot = order[position] as number;
      const o = opts[slot] as UnitOptions;
      const unitId = units[slot] as UnitId;
      const coordinate = o.safe.length === 0;
      if (coordinate && o.ownTeamRisk.length === 0) forced++;
      let pool = o.chooseIndex as ReadonlyArray<number>;
      if (coordinate) {
        // CLAUSE 2 ONLY. The clear subset: the tier's options that meet nothing
        // already staged, so the risky cell has exactly one claimant.
        const jumps =
          o.unit !== undefined && !profileOf(o.unit.kind).traversesEdges;
        const clear: number[] = [];
        for (const idx of o.chooseIndex) {
          if (!meets(index, unitId, o.all[idx] as Candidate, jumps)) clear.push(idx);
        }
        if (clear.length > 0) pool = clear;
        else conflicts++;
      }
      const k = pickIndex(seed, mix(NODE_STAGE0_PICK, attempt), position, 0, pool.length);
      const idx = pool[k] as number;
      choice[slot] = idx;
      const candidate = o.all[idx] as Candidate;
      index.claim(unitId, candidate.from, candidate.path);
    }
    const clean = conflicts === 0 && forced === 0;
    const made: StageZero = {
      choice,
      score: 0,
      conflicts,
      forced,
      coordinated: coordinated.length,
      attempts: attempt + 1,
      clean,
      evaluations: 0,
    };
    if (best === null || conflicts + forced < best.conflicts + best.forced) best = made;
    if (clean) break;
  }
  const chosen = best as StageZero;
  return { ...chosen, score: objective.score(chosen.choice), evaluations: 1 };
}

// ---------------------------------------------------------------------------
// KEEPING THE MULTI-UNIT REPAIR OPERATORS ARMED
// ---------------------------------------------------------------------------

/**
 * THE UNITS A PLAN IS CROWDED AROUND — a room/dispersion gate for the joint
 * polish, armed by GEOMETRY rather than by an accident report.
 *
 * `contestedUnits` weights units off `resolution.clashes` and
 * `resolution.ledger`: it fires when the resolver says something went wrong.
 * That is the right gate for a plan with accidents in it and the wrong one for
 * the failure this layer exists to prevent, where nothing goes wrong for thirty
 * turns while the team walks into a corner it cannot leave. Measured: at turn 3,
 * the turn on which the un-seeded search executes its 85.8% centre-ward pivot
 * and the seeded one does not, staged self-clashes are 0.000 per decision in
 * BOTH arms. There is no accident to report and therefore no polish.
 *
 * So this gate reads the two quantities the failure is actually made of, both
 * off the staged plan and neither needing a resolution:
 *
 *   COMPRESSION  how many other landings of ours sit within `radius` of this
 *                one. Own-team head separation fell 10.70 → 6.51 under the
 *                rejected seed; this is that number, per unit, before the fact.
 *   ROOM         how few free neighbours the landing has, counting our own
 *                certain occupancy and the wall. Free neighbours per head fell
 *                2.91 → 1.81 by turn 11, and 39% of heads had one or none.
 *
 * A unit scores zero on an open board with a dispersed team, so on the boards
 * where nothing is wrong the polish still returns immediately and costs
 * nothing. It arms on exactly the configurations that were killing the team.
 *
 * ORDERING ONLY, like everything else here: it selects which units the polish
 * pays to move together. It removes no option, writes no ledger entry, and the
 * polish's own `better()` still adjudicates every trial it produces.
 */
export function crowdedUnits(
  sub: EngineSubstrate,
  units: ReadonlyArray<UnitId>,
  plan: JointPlan,
  frozen: ReadonlySet<UnitId>,
  limit: number,
  radius = 2,
): ReadonlyArray<UnitId> {
  if (limit <= 0 || units.length < 2) return [];
  const grid = sub.grid;
  const landings = new Map<UnitId, number>();
  for (const unitId of units) {
    const candidate = plan.get(unitId);
    if (candidate === undefined) continue;
    landings.set(unitId, landingOf(candidate) as number);
  }
  if (landings.size < 2) return [];
  let occupancy: CertainOccupancy | null = null;
  const weight = new Map<UnitId, number>();
  for (const [unitId, cell] of landings) {
    if (frozen.has(unitId)) continue;
    const unit = sub.unitOf(unitId);
    if (unit === undefined) continue;
    const x = cell % grid.width;
    const y = (cell / grid.width) | 0;
    let near = 0;
    for (const [other, otherCell] of landings) {
      if (other === unitId) continue;
      const ox = otherCell % grid.width;
      const oy = (otherCell / grid.width) | 0;
      if (Math.abs(ox - x) + Math.abs(oy - y) <= radius) near++;
    }
    if (occupancy === null) occupancy = new CertainOccupancy(sub, unit.team);
    let free = 0;
    for (const [dx, dy] of profileOf(unit.kind).steps) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      if (occupancy.has(ny * grid.width + nx)) continue;
      free++;
    }
    // Two ways to be worth moving jointly, and they add: a crowded landing, and
    // a landing with nowhere to go next. Both are counted against the same
    // thresholds the findings name.
    const score = near * 2 + Math.max(0, 2 - free);
    if (score > 0) weight.set(unitId, score);
  }
  return [...weight.keys()]
    .sort((a, b) => (weight.get(b) as number) - (weight.get(a) as number) || a - b)
    .slice(0, limit);
}

/** Where a staged move comes to rest — its own square when it does not move. */
function landingOf(candidate: Candidate): CellIndex {
  return candidate.path.length === 0
    ? candidate.from
    : (candidate.path[candidate.path.length - 1] as CellIndex);
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

/** A seeded permutation of slot indices, by Fisher-Yates over addressed draws. */
function shuffled(
  items: ReadonlyArray<number>,
  seed: number,
  node: number,
): ReadonlyArray<number> {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = pickIndex(seed, node, i, 0, i + 1);
    const swap = out[i] as number;
    out[i] = out[j] as number;
    out[j] = swap;
  }
  return out;
}

/**
 * The caller's clusters as a PARTITION OF THE SLOTS: each group keeps only the
 * free units it names and only the first group that names them, and anything
 * left over becomes one final group. A unit is never dropped and never varied
 * by two groups.
 */
function groupsOf(
  clusters: ReadonlyArray<ReadonlyArray<UnitId>>,
  units: ReadonlyArray<UnitId>,
  slotOf: ReadonlyMap<UnitId, number>,
): ReadonlyArray<Int32Array> {
  const taken = new Uint8Array(units.length);
  const groups: Int32Array[] = [];
  for (const cluster of clusters) {
    const group: number[] = [];
    for (const unitId of cluster) {
      const slot = slotOf.get(unitId);
      if (slot === undefined || taken[slot] === 1) continue;
      taken[slot] = 1;
      group.push(slot);
    }
    if (group.length > 0) groups.push(Int32Array.from(group));
  }
  const rest: number[] = [];
  for (let slot = 0; slot < units.length; slot++) if (taken[slot] !== 1) rest.push(slot);
  if (rest.length > 0) groups.push(Int32Array.from(rest));
  return groups;
}

/** A combo's identity over one group's slots, for the pool's de-duplication. */
function comboKey(vars: Int32Array, choice: Int32Array): string {
  let key = '';
  for (let v = 0; v < vars.length; v++) key += `${choice[vars[v] as number] as number},`;
  return key;
}

/** Option indices back into a joint plan, with the fixed assignments riding. */
function materialise(
  choice: Int32Array,
  units: ReadonlyArray<UnitId>,
  opts: ReadonlyArray<UnitOptions>,
  fixed: JointPlan,
): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const [unitId, candidate] of fixed) plan.set(unitId, candidate);
  for (let slot = 0; slot < units.length; slot++) {
    plan.set(units[slot] as UnitId, (opts[slot] as UnitOptions).all[choice[slot] as number] as Candidate);
  }
  return plan;
}

function report(
  req: MultiStartRequest,
  base: StageZero,
  variables: number,
  temp: number,
  stage1: {
    clusters: number;
    samples: number;
    climbs: number;
    evaluations: number;
    pooled: number;
    truncated: number;
    selectedScore: number;
    spentMs: number;
    openingSeparation: number;
    stage0Separation: number;
    startDiversity: number;
  },
): MultiStartReport {
  return {
    seed: req.seed,
    clusters: stage1.clusters,
    variables,
    stage0Attempts: base.attempts,
    stage0Clean: base.clean,
    stage0Conflicts: base.conflicts,
    stage0Forced: base.forced,
    stage0Coordinated: base.coordinated,
    samples: stage1.samples,
    climbs: stage1.climbs,
    evaluations: stage1.evaluations,
    pooled: stage1.pooled,
    truncated: stage1.truncated,
    budgetMs: req.budgetMs,
    spentMs: stage1.spentMs,
    temperature: temp,
    stage0Score: base.score,
    selectedScore: stage1.selectedScore,
    openingSeparation: stage1.openingSeparation,
    stage0Separation: stage1.stage0Separation,
    startDiversity: stage1.startDiversity,
  };
}

// ---------------------------------------------------------------------------
// The opening instrument
// ---------------------------------------------------------------------------

/**
 * MEAN PAIRWISE MANHATTAN DISTANCE between our units' landings, in cells.
 *
 * Manhattan and not Chebyshev because it is the metric a trail unit actually
 * travels in, and the collisions this number exists to predict are collisions
 * between units walking toward each other one step at a time. Mean and not
 * minimum because a minimum is a fact about one pair and the claim is about a
 * FORMATION: a file of six units a cell apart and a pair of clumps at opposite
 * corners have the same minimum and nothing else in common.
 */
function separationOf(plan: JointPlan, width: number): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const candidate of plan.values()) {
    const cell = landingOf(candidate);
    xs.push(cell % width);
    ys.push((cell / width) | 0);
  }
  const n = xs.length;
  if (n < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      total +=
        Math.abs((xs[i] as number) - (xs[j] as number)) +
        Math.abs((ys[i] as number) - (ys[j] as number));
      pairs++;
    }
  }
  return pairs === 0 ? 0 : total / pairs;
}

/**
 * ONE GROUP'S STAGED-ASSIGNMENT DIVERSITY, from per-slot choice counts.
 *
 * For a slot whose `p` pooled starts choose options with multiplicities `c_v`,
 * the chance that two DISTINCT starts differ there is
 * `(p² − Σ c_v²) / (p(p − 1))`. Averaging that over the group's slots gives a
 * number in [0, 1] with the same meaning whatever the group's shape, so groups
 * of two units and groups of nine are comparable and can be pooled.
 *
 * One pass over the pool. A pairwise count would be `poolCap²` (512² per
 * group) comparisons for the same answer.
 */
function diversityOf(
  pool: ReadonlyArray<{ readonly choice: Int32Array }>,
  vars: Int32Array,
): number {
  const p = pool.length;
  if (p < 2 || vars.length === 0) return 0;
  let sum = 0;
  const counts = new Map<number, number>();
  for (let v = 0; v < vars.length; v++) {
    const slot = vars[v] as number;
    counts.clear();
    for (const arm of pool) {
      const choice = arm.choice[slot] as number;
      counts.set(choice, (counts.get(choice) ?? 0) + 1);
    }
    let same = 0;
    for (const c of counts.values()) same += c * c;
    sum += (p * p - same) / (p * (p - 1));
  }
  return sum / vars.length;
}
