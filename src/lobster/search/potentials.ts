/**
 * THE CONFLICT POTENTIALS — psi_u and phi_{u,v}, the microsecond surrogate the
 * cluster enumeration maximises over.
 *
 * ── WHAT USED TO BE HERE, AND WHY IT IS NOT ────────────────────────────────
 *
 * This file was `cluster-seed.ts`, and its headline export was `greedySeed`:
 * an index-driven greedy pairwise SEED that placed each unit in danger order
 * at the argmax of these same potentials. That policy was measured and
 * REJECTED. It passed its deterministic gate outright — fatal stagings 41 to 0
 * — and then lost the six-snake cell 1.00 to 0.15 on a live race, through a
 * travel-economy channel (exhaustion) the deterministic probe never looked at.
 *
 * Rejected code does not stay in the tree as an off-arm, so `greedySeed`,
 * `SeedRequest` and `CENTAUR_CLUSTER_SEED` are DELETED. The negative result is
 * kept where a negative result belongs — on the record of the entry that
 * superseded it (`search/multistart-seed.ts`) — because a measurement that
 * cost a live race is the most expensive thing this programme owns and losing
 * it would mean paying for it twice.
 *
 * WHAT SURVIVES IS THE ARITHMETIC, which was never the rejected part: the
 * conflict index, the workspace that makes a rebuild an integer increment, and
 * the two potentials. `search/cluster-enum.ts` maximises over exactly these to
 * enumerate a component's joint move, and the enumeration is machinery the
 * whole search (and all of depth, whose threads root at its proposals) stands
 * on.
 *
 * ── WHAT MAY AND MAY NOT HAPPEN HERE ───────────────────────────────────────
 *
 * Everything below is ORDERING. A potential CHOOSES among a unit's candidates;
 * it never removes one, never writes a ledger entry, never returns a set. So:
 *
 *   · no `prunedLedger` entry, because nothing is pruned — plan-local friendly
 *     fire is `better()`-adjacent policy and MUST NOT be a ledger entry, since
 *     the very next sweep may move the team-mate;
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
 * `phi_follow` is the only row here that makes an option MORE attractive, and
 * it is the reason the layer can be used at all. The tail pop is unconditional
 * and precedes the head landing, so entering a team-mate's vacated tail cell
 * is provably collision-free — single-file motion, which is the principled
 * form of the accidental parallel-motion coherence a blunt guard destroys. It
 * cannot be unsound in the dangerous direction: it only ever raises an
 * option's rank, and the plan is still priced by the real evaluator.
 */

import { bbTest, cmpLex, profileOf, scalarOf } from '../../partial-engine/index';
import type { Candidate, CellIndex, UnitId } from '../contracts';
import { EngineSubstrate } from '../substrate';
import type { SubstrateUnit } from '../substrate';
import { StampedInt32 } from '../scratch';
import { certainlySelfFatal } from '../staging-safety';
import { ConflictIndex, NO_CLAIM, subStepOf } from './conflict-index';

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
 * ψ's ONE non-ordering term: a move the rules certainly kill the mover on.
 *
 * Priced at the mover's own weight, which is exactly what it loses — the same
 * number a team-mate's body or a lost contest costs it, because it is the same
 * loss. Consistency here is not decoration: the seed compares these terms
 * against each other, and a self-inflicted death that scored differently from
 * an ally-inflicted one would make the choice between them arbitrary.
 *
 * WHY THE SEED CARRIES THIS AT ALL. The candidate layer's tier CORRECTION —
 * the thing that stops a wall step being the ordered-FIRST option — is gated
 * on the same knob as the REFUSAL, so on a board where the refusal is off
 * (every snake-only board, by the shipped ship condition) the ordering is off
 * too and a certainly-fatal move can still sort first. The refusal is what
 * measured badly on those boards; the ordering never did. This is the ordering
 * half on its own, in graded form, where it cannot box anything in.
 *
 * MEASURED: without it the pair terms push units off a team-mate's body and
 * onto their own — self-inflicted deaths rose 39 to 50 per sixty boards in the
 * replay probe while team-mate kills fell 25 to 0. A layer that moves a death
 * from one channel to another has done nothing.
 */
const SELF_FATAL = 1;

/**
 * PLAN-LOCAL FRIENDLY-FIRE AVOIDANCE, as a tie-break and nothing more.
 *
 * Half an ordering place: too small to change any comparison the material
 * terms decide, big enough to settle the one they cannot. Two of our units of
 * equal weight, one dying to its own body and one dying to a team-mate, cost
 * the team exactly the same material — so the choice between them was being
 * made by the salt. This makes it by policy instead.
 *
 * It is POLICY and it lives here rather than in a ledger, deliberately. The
 * plan-local form of "this kills a team-mate" is a reason for `better()` to
 * return false, never a prune: the incumbent keeps its seat, the judgement is
 * recoverable, and the very next sweep may move the team-mate. Writing it into
 * `prunedLedger` would convert a recoverable policy into a permanent proof.
 */
const EPS_FRIENDLY = RANK_STEP * 0.5;

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
  /**
   * Which of our own trail units certainly holds this cell as a LIVING BODY
   * next turn, or `-1`.
   *
   * `cells[0 .. len-2]` — index 0 INCLUDED, because the cell a team-mate's
   * head is vacating becomes its own new neck — extended to `len-1` when the
   * tail does not vacate. The head cell of a HOLDER is the claim channel's
   * business and not this one, but a trail unit has momentum and must step, so
   * for the units this map covers the two never disagree.
   */
  readonly bodyOwnerAt: (cell: CellIndex) => number;
  /** The body index at that cell — the cut a higher-tier mover severs at. */
  readonly bodyIndexAt: (cell: CellIndex) => number;
}

/** A workspace a session keeps between decisions. Nothing here is per-plan. */
export class SeedWorkspace {
  readonly index = new ConflictIndex();
  /** cell → sub-step a team-mate's tail pop frees it. */
  private freed = new StampedInt32(0);
  /** cell → the team-mate whose living body holds it, and at which index. */
  private bodyOwner = new StampedInt32(0);
  private bodyIndex = new StampedInt32(0);
  private freedCells = 0;

  private ensure(cells: number): void {
    if (this.freedCells >= cells) return;
    const size = cells * 2;
    this.freed = new StampedInt32(size);
    this.bodyOwner = new StampedInt32(size);
    this.bodyIndex = new StampedInt32(size);
    this.freedCells = size;
  }

  /**
   * Read the decision's frozen facts. One pass over the roster; the tail map
   * is stamped, so a rebuild is an integer increment.
   */
  facts(sub: EngineSubstrate, ours: ReadonlyArray<UnitId>): SeedFacts {
    const cells = sub.grid.cells;
    this.ensure(cells);
    const freed = this.freed;
    const owner = this.bodyOwner;
    const index = this.bodyIndex;
    freed.begin();
    owner.begin();
    index.begin();
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
      const pops = tail !== (unit.cells[len - 2] as number);
      // A trail unit has momentum and must step, so the pop is certain and it
      // happens at the first advance.
      if (pops) freed.set(tail, 1);
      const last = pops ? len - 2 : len - 1;
      for (let i = 0; i <= last; i++) {
        const cell = unit.cells[i] as number;
        // FIRST WRITER WINS, which is the deepest cut: two of our bodies
        // cannot share a cell, so this only ever resolves a unit against its
        // own repeated cell (a duplicated tail).
        if (owner.has(cell)) continue;
        owner.set(cell, id as number);
        index.set(cell, i);
      }
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
      bodyOwnerAt: (cell) => owner.get(cell as number, -1),
      bodyIndexAt: (cell) => index.get(cell as number, -1),
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
  const cmp = cmpLex(
    scalarOf(mover.tier, mover.weight),
    scalarOf(other.tier, other.weight),
  );
  if (cmp === 0) {
    // MUTUAL ANNIHILATION, AND NO EXCEPTION REACHES IT.
    //
    // E1 and E3 both presuppose a winner: a corpse-block is one ally dying so
    // another may hold a cell, and a three-way win is our heavier unit being
    // the unique strict max of the pile. A tie has neither. Nobody survives,
    // nothing is taken, and the cell is held by two of our corpses instead of
    // one of our units.
    //
    // This was MEASURED, not reasoned: gating the tie on the enemy-claim bit
    // test alongside the other branches introduced two mutual annihilations
    // per sixty boards in the replay probe, on exactly the crowded boards
    // where an enemy claim reaches everything. The permissive direction is the
    // safe one for a sacrifice gate and the wrong one for a tie.
    //
    // E4 still applies: an ally already dead in every world cannot be saved,
    // and contorting a healthy unit into rescuing it is the failure the clause
    // exists to prevent.
    if (otherDoomed) return 0;
    const bottom =
      endsOurTeam(facts, mover, other) || endsOurTeam(facts, other, mover) ? REGICIDE : 0;
    return -(mover.weight + other.weight) - bottom;
  }
  if (sacrificeLegitimate(facts, cell, mover, other, otherDoomed)) return 0;
  if (cmp < 0) return -mover.weight - EPS_FRIENDLY;
  // We win, and even winning costs distance: the survivor capture-stops and
  // forfeits the rest of its ray.
  return -other.weight - LAMBDA_STOP * stopLoss - EPS_FRIENDLY;
}

/**
 * P3 — THE TEAM-MATE'S LIVING BODY, as an ORDERING term and never a refusal.
 *
 * A living body is adjudicated by TIER ALONE where a claim contest is
 * adjudicated by (tier, weight): at parity the entrant dies whatever it
 * weighs, and at strictly higher tier it SEVERS the body at the cut index and
 * capture-stops, costing the ally `len − cut` weight with no death recorded.
 * Both branches are negative for us.
 *
 * THIS IS THE GRADED FORM OF THE PRUNE THAT MEASURED BADLY. The candidate
 * layer's `ally-body` refusal is a veto: it deletes the option, and on a dense
 * board deleting every option is how a unit ends up sealed in with nothing but
 * the least-bad restore. Here the same fact only DEPRIORITISES, so a unit
 * whose alternatives are all worse still takes it, and the plan is still
 * priced by the real evaluator. It needs no declaration for the same reason
 * the rest of this file does not: nothing is removed from any set.
 *
 * Read off a stamped per-decision map rather than by scanning the roster per
 * candidate — one load per claimed cell, which is what keeps the whole pass
 * inside its budget.
 */
function bodyPotential(
  facts: SeedFacts,
  mover: SubstrateUnit,
  cell: CellIndex,
  stopLoss: number,
  doomed: ReadonlySet<UnitId>,
): number {
  const owner = facts.bodyOwnerAt(cell);
  if (owner < 0 || owner === (mover.unitId as number)) return 0;
  const other = facts.units.get(owner as UnitId);
  if (other === undefined) return 0;
  // E4: an ally dead in every world leaves a pile settled on WEIGHT, not a
  // body settled on tier, so the tier rule below is not the one that applies
  // and a heavy enough mover may cross freely. Say nothing rather than
  // something wrong.
  if (doomed.has(owner as UnitId)) return 0;
  if (mover.tier <= other.tier) return -mover.weight - EPS_FRIENDLY;
  // A strictly higher tier severs and lives. The cut is where the body was
  // entered; everything beyond it is removed from the ally.
  const cut = facts.bodyIndexAt(cell);
  const lost = Math.max(1, other.cells.length - Math.max(0, cut));
  return -lost - LAMBDA_STOP * stopLoss - EPS_FRIENDLY;
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
/**
 * ψ — the singleton term: the generator's own ordering, plus what the rules
 * say about the mover's own move.
 *
 * The candidate list arrives best-first from a layer that has already spent
 * real evidence on the order, so rank IS the prior and the seed does not
 * re-derive it. `SELF_FATAL` is the one thing rank can be wrong about, and it
 * is wrong about it in exactly one configuration — see the constant.
 */
export function singletonPotential(
  sub: EngineSubstrate,
  mover: SubstrateUnit,
  candidate: Candidate,
  rank: number,
): number {
  const fatal = certainlySelfFatal(sub, mover, candidate) !== null;
  return -RANK_STEP * rank - (fatal ? SELF_FATAL * mover.weight : 0);
}

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
  let bodyHit = false;
  for (let i = 0; i < path.length; i++) {
    const cell = path[i] as CellIndex;
    const s = subStepOf(i);
    if (s >= index.subSteps) break;
    total += sameCellTerm(facts, index, mover, cell, s, path.length - 1 - i, doomed);
    if (!jumps) total += edgeTerm(facts, index, mover, prev as CellIndex, cell, s, doomed);
    if (!bodyHit) {
      // THE FIRST body cell on the ray is the whole story: the mover dies
      // there or severs there, and either way it goes no further. Charging
      // every later cell too would price a journey the rules do not allow.
      const body = bodyPotential(facts, mover, cell, path.length - 1 - i, doomed);
      if (body !== 0) {
        total += body;
        bodyHit = true;
      }
    }
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
