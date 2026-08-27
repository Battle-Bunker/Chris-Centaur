/**
 * THE INDEX-DRIVEN GREEDY PAIRWISE SEED.
 *
 *   ON A STARVED TURN, THE SEED IS THE ANSWER.
 *
 * Rung 0 stages a complete legal plan before anything is searched, and returns
 * it whatever the one `price()` it pays says. The median decision manages five
 * scored plans. So the plan the seed builds is, very often, the plan that goes
 * out — and until now it was built by taking each unit's ordered-first option
 * with one blunt de-confliction pass on top.
 *
 * That pass reserves every cell an earlier unit's path names and refuses any
 * candidate that touches one. It is `φ = −∞` on same-cell, sub-step-blind, and
 * subtract-only. Sub-step-blind over-fires: two units crossing one cell at
 * different sub-steps never meet. Subtract-only is worse — it is exactly the
 * shape that took `r01-snakes6` from 1.000 to 0.500, because refusing
 * everything and falling through to the least-bad option is what a layer with
 * nothing positive to say does on a dense board.
 *
 * This module replaces it with the graded form:
 *
 *     pick(u) = argmax_a [ ψ_u(a) + Σ_{v already placed} φ_{u,v}(a, π(v)) ]
 *
 * in danger order, committing each choice into the conflict index as it goes.
 * Measured at 0.66–2.64 µs per decision against a 200 µs `scorePlan`.
 *
 * ── WHAT MAY AND MAY NOT HAPPEN HERE ───────────────────────────────────────
 *
 * Everything below is ORDERING. The seed CHOOSES among a unit's candidates; it
 * never removes one, never writes a ledger entry, never returns a set. So:
 *
 *   · no `prunedLedger` entry, because nothing is pruned — plan-local friendly
 *     fire is `better()`-adjacent policy and MUST NOT be a ledger entry, since
 *     the very next sweep may move the team-mate;
 *   · the joint-emptiness guard is structural rather than a repair: an argmax
 *     over a non-empty list is non-empty, so there is no branch on which the
 *     seed can hand a unit nothing;
 *   · nothing here reaches `lo`, `est`, `hi`, a `Bound`, or `better()`.
 *
 * ── THE UNITS THE POTENTIALS ARE DENOMINATED IN ────────────────────────────
 *
 * Material weight, and only by analogy: these numbers are compared against
 * each other and against nothing else, ever. The one relation that is
 * load-bearing is the SCALE SEPARATION — a real conflict outranks any number
 * of ordering places the generator could have expressed, and a follow bonus
 * outranks exactly one. See `RANK_STEP`.
 *
 * ── THE POSITIVE TERM IS THE POINT ─────────────────────────────────────────
 *
 * `φ_follow` is the only row here that makes an option MORE attractive, and it
 * is the reason the layer can be shipped at all. The tail pop is unconditional
 * and precedes the head landing, so entering a team-mate's vacated tail cell
 * is provably collision-free — single-file motion, which is the principled
 * form of the accidental parallel-motion coherence the guard destroyed. It
 * cannot be unsound in the dangerous direction: it only ever raises an
 * option's rank, and the plan is still priced by the real evaluator.
 */

import { bbTest, cmpLex, profileOf, scalarOf } from '../../partial-engine/index';
import type { Candidate, CandidateSet, CellIndex, JointPlan, UnitId } from '../contracts';
import { EngineSubstrate } from '../substrate';
import type { SubstrateUnit } from '../substrate';
import { StampedInt32 } from '../scratch';
import { candidateKey } from '../bounds';
import { tieKey } from './order';
import { ConflictIndex, NO_CLAIM, subStepOf, subStepsFor } from './conflict-index';

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

export const CLUSTER_SEED_ENV = 'CENTAUR_CLUSTER_SEED';

/**
 * PER-ENGINE, NEVER PROCESS-WIDE — the lesson learned the hard way: *"a
 * process-wide flag moves every lobster seat on the board at once and a paired
 * experiment on it measures nothing."* The environment is only the default a
 * caller that names nothing inherits; `SearchTuning.clusterSeed` overrides it,
 * so one seat can carry the seed while the seat across the board does not.
 *
 * DEFAULT OFF, pending the empirical gate. With it off this module is not
 * reached and the seed is byte-for-byte the one that shipped.
 */
export function clusterSeedFrom(env: NodeJS.ProcessEnv): boolean {
  const raw = env[CLUSTER_SEED_ENV];
  return raw === '1' || raw === 'on' || raw === 'true';
}

export function clusterSeedEnabled(): boolean {
  return clusterSeedFrom(process.env);
}

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

/**
 * What one place in the generator's own ordering is worth.
 *
 * The candidate list arrives best-first from a layer that has already spent
 * real evidence on the order (safety tier, then what the move takes, then what
 * it costs). The seed's singleton term is that order, not a re-derivation of
 * it: `ψ_u(a) = −RANK_STEP × rank(a)`. A pair term only moves a choice when it
 * has something the per-unit layer structurally could not know.
 *
 * At `candidateCap: 8` the whole ordering spans 0.35, and the lightest unit on
 * any board weighs 1. So NO amount of ordering preference can outrank a single
 * real conflict, which is the separation the whole design rests on.
 */
const RANK_STEP = 0.05;

/**
 * The follow-the-tail bonus: one ordering place, and not two.
 *
 * Large enough to promote a tail-follow past the option the generator ranked
 * immediately above it — which is the tie-break toward coherent motion the
 * layer exists to supply. Small enough that it can never promote past a
 * conflict, past a safety tier, or past a meal. Over-rewarding single file
 * concentrates the whole team in one region, which is the opposite failure to
 * boxing-in and just as real; the territory features are what should price
 * that, and this must not overpower them.
 */
const EPS_FOLLOW = RANK_STEP * 1.2;

/** What a forfeited ray cell costs the winner of a contest it did not want. */
const LAMBDA_STOP = RANK_STEP;

/**
 * The ordering-channel stand-in for the lattice bottom.
 *
 * DEAD is `−∞` and must never be a scalar in a BOUND. This is not a bound: it
 * is an ordering key, and an ordering key needs an arithmetic that terminates.
 * The value is chosen so that no sum of the other terms over any board can
 * reach it — ending our own team is not a trade the seed may make for any
 * amount of material.
 */
const REGICIDE = 1e6;

// ---------------------------------------------------------------------------
// Per-decision facts
// ---------------------------------------------------------------------------

/**
 * The frozen facts the potentials read. Built once per decision from the
 * substrate: strength, kind shape, and where each of our trail units frees a
 * cell.
 */
export interface SeedFacts {
  readonly cells: number;
  /** Our own commandable units, by id. */
  readonly units: ReadonlyMap<UnitId, SubstrateUnit>;
  /** Team numbers that lose the game when their last king dies. */
  readonly regicideTeams: ReadonlySet<number>;
  /** Does a held claim reach this cell in any world? E1/E3's one bit test. */
  readonly enemyClaimAt: (cell: CellIndex) => boolean;
  /**
   * Sub-step at which one of our trail units frees this cell by popping its
   * tail, or 0 for none.
   *
   * THE PREDICATE IS `cells[len-1] !== cells[len-2]`, AND IT IS NOT THE ONE
   * THE MEMOS NAME. They gate the tail on `¬eats(v)`, on the reading that the
   * end-of-turn food phase re-appends the vacated tail. It does not: the
   * growth line is `arena[t+len] = arena[t+len-1]`, which DUPLICATES the
   * post-shift last cell — a cell the unit already occupies — and never writes
   * the vacated one. Resolved against the real engine in
   * `conflict-index.test.ts`: a team-mate entering the tail cell of an ally
   * that eats this turn survives, and one entering the tail cell of an ally
   * that ate LAST turn (so carries a duplicated tail, whose shift therefore
   * frees nothing) dies. Eating this turn is not the question; already having
   * eaten is.
   */
  readonly tailFreedAt: (cell: CellIndex) => number;
}

/** A workspace a session keeps between decisions. Nothing here is per-plan. */
export class SeedWorkspace {
  readonly index = new ConflictIndex();
  /** cell → sub-step a team-mate's tail pop frees it. */
  private freed = new StampedInt32(0);
  private freedCells = 0;

  private ensure(cells: number): StampedInt32 {
    if (this.freedCells < cells) {
      this.freed = new StampedInt32(cells * 2);
      this.freedCells = cells * 2;
    }
    return this.freed;
  }

  /**
   * Read the decision's frozen facts. One pass over the roster; the tail map
   * is stamped, so a rebuild is an integer increment.
   */
  facts(sub: EngineSubstrate, ours: ReadonlyArray<UnitId>): SeedFacts {
    const cells = sub.grid.cells;
    const freed = this.ensure(cells);
    freed.begin();
    const units = new Map<UnitId, SubstrateUnit>();
    for (const id of ours) {
      const unit = sub.unitOf(id);
      if (unit === undefined) continue;
      units.set(id, unit);
      if (!profileOf(unit.kind).leavesTrail) continue;
      const len = unit.cells.length;
      if (len < 2) continue;
      const tail = unit.cells[len - 1] as number;
      // A duplicated tail is a unit that ate LAST turn: the shift consumes the
      // duplicate and the cell stays occupied. Nothing is freed.
      if (tail === (unit.cells[len - 2] as number)) continue;
      // A trail unit has momentum and must step, so the pop is certain and it
      // happens at the first advance.
      freed.set(tail, 1);
    }
    const field = sub.claimField();
    return {
      cells,
      units,
      regicideTeams: sub.regicideTeamNumbers(),
      // MODELLED units carry no claim slot, so this union is exactly the units
      // we do not command — every enemy, plus any team-mate held out of the
      // model. Counting a held team-mate as a contest participant makes the
      // sacrifice gate slightly PERMISSIVE, which is the safe direction: the
      // consequence is a teammate kill this layer declines to discourage, not
      // one it forces.
      enemyClaimAt: (cell) => bbTest(field.unionPossible, cell as number),
      tailFreedAt: (cell) => freed.get(cell as number, 0),
    };
  }
}

// ---------------------------------------------------------------------------
// The sacrifice gate
// ---------------------------------------------------------------------------

/**
 * P7 — SACRIFICE LEGITIMACY. A team-mate kill is sometimes correct, and a
 * layer that cannot say when reproduces the snake-only regression with extra
 * steps. Five clauses; the exclusion must NOT fire when any holds.
 *
 *   E1  CORPSE-BLOCKER. The dying ally's occupancy and death cell become
 *       durable collision material for the rest of the turn, adjudicated on
 *       (tier, WEIGHT) where a living body is (tier) alone. The prune
 *       vocabulary already names the tactic.
 *   E2  SEVER-TO-FREE. A strictly higher tier severs an ally to pass through.
 *       NOT TESTED HERE: severing is the BODY channel and this layer carries
 *       no body channel. Named so the omission is a decision, not a gap.
 *   E3  CONTESTED-CELL WIN. An enemy also claims the cell, so ours + ours +
 *       theirs is a three-way pile and the ally's death is the price of
 *       denying it.
 *   E4  DOOMED ALLY. The ally is already dead in every world, so a potential
 *       against it contorts a healthy unit into a rescue that cannot happen.
 *   E5  JOINT EMPTINESS. Excluding would empty the joint feasible set.
 *       STRUCTURAL here: the seed takes an argmax over a non-empty list and
 *       cannot empty anything. Asserted in the suite rather than branched on.
 *
 * E1 and E3 share one bit test. A corpse only blocks something that was coming
 * for the cell, and something coming for the cell is exactly what makes the
 * contest three-way — so `an enemy claim reaches this cell` covers both, and
 * covering them together is why this costs a bit test rather than a scan.
 *
 * NEVER LEGITIMATE: our own LAST king. Regicide takes the killer with the
 * team; the outcome is `fatal`, the cost is the whole game, and `pickBestMove`
 * vetoes regicidal candidates above even the fatal-pocket veto. No exception
 * reaches it.
 */
export function sacrificeLegitimate(
  facts: SeedFacts,
  cell: CellIndex,
  mover: SubstrateUnit,
  victim: SubstrateUnit,
  victimDoomed: boolean,
): boolean {
  if (endsOurTeam(facts, mover, victim)) return false;
  if (victimDoomed) return true; // E4
  return facts.enemyClaimAt(cell); // E1 ∪ E3
}

/** Would losing `victim` end `mover`'s team outright? F9, and it is absolute. */
function endsOurTeam(facts: SeedFacts, mover: SubstrateUnit, victim: SubstrateUnit): boolean {
  if (!victim.isKing || victim.team !== mover.team) return false;
  return facts.regicideTeams.has(victim.team);
}

// ---------------------------------------------------------------------------
// The potentials
// ---------------------------------------------------------------------------

/**
 * How a claim contest between two of OURS resolves, in ordering units.
 *
 * Survival is being the unique strict maximum of the whole pile, compared
 * lexicographically on (tier, weight). A tie is not a draw: `bestCount > 1`
 * means NOBODY survives and every standing participant dies. Two same-kind,
 * same-weight, tier-0 allies — the modal pair on a snake board — tie.
 */
function contestPotential(
  facts: SeedFacts,
  mover: SubstrateUnit,
  other: SubstrateUnit,
  cell: CellIndex,
  stopLoss: number,
  otherDoomed: boolean,
): number {
  if (sacrificeLegitimate(facts, cell, mover, other, otherDoomed)) return 0;
  const cmp = cmpLex(
    scalarOf(mover.tier, mover.weight),
    scalarOf(other.tier, other.weight),
  );
  if (cmp === 0) {
    // Mutual annihilation. Both corpses, nothing taken, no enemy involved.
    const bottom =
      endsOurTeam(facts, mover, other) || endsOurTeam(facts, other, mover) ? REGICIDE : 0;
    return -(mover.weight + other.weight) - bottom;
  }
  if (cmp < 0) return -mover.weight;
  // We win, and even winning costs distance: the survivor capture-stops and
  // forfeits the rest of its ray.
  return -other.weight - LAMBDA_STOP * stopLoss;
}

/**
 * THE PAIR SUM for one candidate against everything already in the index.
 *
 * Three reads per claimed cell, all off the index:
 *
 *   P1/P10  someone else claims `(cell, subStep)` — the k-way pile is the same
 *           object as the pair, because the contest is over the WHOLE pile;
 *   P2      someone else crosses the same edge the other way at the same
 *           sub-step — decided by the `from` column the arrival already has,
 *           and only for kinds that cross edges at all (a knight jumps);
 *   P4      a team-mate's tail pop frees this cell at this sub-step.
 */
export function pairPotential(
  facts: SeedFacts,
  index: ConflictIndex,
  mover: SubstrateUnit,
  candidate: Candidate,
  doomed: ReadonlySet<UnitId>,
): number {
  const path = candidate.path;
  if (path.length === 0) {
    // A holder is an incumbent from sub-step 1: everything that arrives on its
    // square contests it. One slot read per sub-step, which is why a decision
    // of holders is the cheapest shape there is.
    let total = 0;
    for (let s = 1; s < index.subSteps; s++) {
      total += sameCellTerm(facts, index, mover, candidate.from, s, 0, doomed);
    }
    return total;
  }
  const jumps = !profileOf(mover.kind).traversesEdges;
  let total = 0;
  let prev = candidate.from as number;
  for (let i = 0; i < path.length; i++) {
    const cell = path[i] as CellIndex;
    const s = subStepOf(i);
    if (s >= index.subSteps) break;
    total += sameCellTerm(facts, index, mover, cell, s, path.length - 1 - i, doomed);
    if (!jumps) total += edgeTerm(facts, index, mover, prev as CellIndex, cell, s, doomed);
    prev = cell as number;
  }
  // The landing rests here for every later sub-step, and a rester is a
  // standing participant in every contest at its cell.
  const rest = path[path.length - 1] as CellIndex;
  for (let s = subStepOf(path.length - 1) + 1; s < index.subSteps; s++) {
    total += sameCellTerm(facts, index, mover, rest, s, 0, doomed);
  }
  // FOLLOW THE TAIL, NEVER THE HEAD. Only the landing earns it — a ray that
  // merely crosses a freed cell has not made single-file motion of anything.
  if (facts.tailFreedAt(rest) === subStepOf(path.length - 1)) total += EPS_FOLLOW;
  return total;
}

function sameCellTerm(
  facts: SeedFacts,
  index: ConflictIndex,
  mover: SubstrateUnit,
  cell: CellIndex,
  subStep: number,
  stopLoss: number,
  doomed: ReadonlySet<UnitId>,
): number {
  let total = 0;
  for (let c = index.firstAt(cell, subStep); c !== NO_CLAIM; c = index.next(c)) {
    const id = index.unitAt(c);
    if (id === mover.unitId) continue;
    const other = facts.units.get(id);
    if (other === undefined) continue;
    total += contestPotential(facts, mover, other, cell, stopLoss, doomed.has(id));
  }
  return total;
}

function edgeTerm(
  facts: SeedFacts,
  index: ConflictIndex,
  mover: SubstrateUnit,
  from: CellIndex,
  to: CellIndex,
  subStep: number,
  doomed: ReadonlySet<UnitId>,
): number {
  let total = 0;
  for (
    let c = index.swapPartnerAt(from, to, subStep, mover.unitId);
    c !== NO_CLAIM;
    c = nextSwap(index, c, to, mover.unitId)
  ) {
    const other = facts.units.get(index.unitAt(c));
    if (other === undefined) continue;
    if (profileOf(other.kind).traversesEdges) {
      // The loser dies squashed on its own neck and NEITHER crosses on a tie,
      // so nothing whatsoever is gained. There is no forfeited ray to charge:
      // the exchange settles the move where it started.
      total += contestPotential(facts, mover, other, from, 0, doomed.has(other.unitId));
    }
  }
  return total;
}

/** Continue an edge-partner walk from a claim already found. */
function nextSwap(index: ConflictIndex, claim: number, to: CellIndex, self: UnitId): number {
  for (let c = index.next(claim); c !== NO_CLAIM; c = index.next(c)) {
    if (index.unitAt(c) === self || index.restingAt(c)) continue;
    if (index.fromAt(c) === to) return c;
  }
  return NO_CLAIM;
}

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

export interface SeedRequest {
  readonly sub: EngineSubstrate;
  readonly workspace: SeedWorkspace;
  /** Our commandable units, in the order the seed should place them. */
  readonly order: ReadonlyArray<UnitId>;
  readonly sets: ReadonlyMap<UnitId, CandidateSet>;
  /** Units whose choice is fixed before the greedy pass runs (pins, refs). */
  readonly fixed: JointPlan;
  /** Units already known to die in every world — E4's input. */
  readonly doomed: ReadonlySet<UnitId>;
  /** How many of a unit's own options the seed considers. A max-side cap. */
  readonly cap: number;
  /** The per-decision salt. Exact ties are desymmetrised, never index-broken. */
  readonly salt: number;
}

/**
 * ONE PASS, WORST SITUATION FIRST, COMMITTING AS IT GOES.
 *
 * Greedy is greedy: the first unit placed constrains the rest. Danger order is
 * the mitigation the search already computes — the unit whose situation is
 * worst chooses while it still has options — and the perturbed restarts above
 * are what actually escape a bad first placement.
 *
 * MIRROR MATCHES. The final tie-break is the salted key, never the cell index.
 * Two identical bots breaking ties identically walk into the same square, and
 * in this game a tie leaves nobody standing. The salt is the one the searcher
 * already carries; this adds no second seed.
 */
export function greedySeed(req: SeedRequest): JointPlan {
  const { sub, workspace, order, sets, fixed, doomed, cap, salt } = req;
  const facts = workspace.facts(sub, order);
  const index = workspace.index;

  // The sub-step bound is the longest path the seed could stage, taken over
  // the fixed assignments and every option it may choose. Confirmed against
  // the real `maxPath` rather than assumed: a slider ray of 11 has been
  // observed, and sizing this short would silently drop late-sub-step claims.
  const paths: Array<ReadonlyArray<CellIndex>> = [];
  for (const c of fixed.values()) paths.push(c.path);
  for (const id of order) {
    const set = sets.get(id);
    if (set === undefined) continue;
    for (let i = 0; i < set.candidates.length && i < cap; i++) {
      paths.push((set.candidates[i] as Candidate).path);
    }
  }
  index.begin(facts.cells, subStepsFor(paths));

  const plan = new Map<UnitId, Candidate>();
  for (const [unitId, candidate] of fixed) {
    plan.set(unitId, candidate);
    index.claim(unitId, candidate.from, candidate.path);
  }

  for (const unitId of order) {
    if (plan.has(unitId)) continue;
    const set = sets.get(unitId);
    const mover = facts.units.get(unitId);
    const first = set?.candidates[0] ?? set?.prunedLedger[0]?.candidate;
    if (set === undefined || first === undefined) {
      throw new Error(
        `no candidate at all for unit ${unitId}: a hard filter emptied the option set, ` +
          'which the completeness invariant forbids',
      );
    }
    // A unit the substrate cannot name is not one this layer can reason about;
    // it keeps the generator's own answer.
    if (mover === undefined) {
      plan.set(unitId, first);
      index.claim(unitId, first.from, first.path);
      continue;
    }
    let pick = first;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestTie = -1;
    const limit = Math.min(cap, set.candidates.length);
    for (let i = 0; i < limit; i++) {
      const candidate = set.candidates[i] as Candidate;
      const value = -RANK_STEP * i + pairPotential(facts, index, mover, candidate, doomed);
      if (value > bestScore) {
        pick = candidate;
        bestScore = value;
        bestTie = -1;
        continue;
      }
      if (value < bestScore) continue;
      // An EXACT tie in a quantity built out of frozen material weights is a
      // position the seed genuinely cannot tell apart. Desymmetrise it.
      if (bestTie < 0) bestTie = tieKey(candidateKey(pick), salt);
      const tie = tieKey(candidateKey(candidate), salt);
      if (tie > bestTie) {
        pick = candidate;
        bestTie = tie;
      }
    }
    plan.set(unitId, pick);
    index.claim(unitId, pick.from, pick.path);
  }
  return plan;
}
