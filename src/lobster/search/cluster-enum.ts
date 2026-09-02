/**
 * EXACT SMALL-CLUSTER JOINT ENUMERATION — the owner's core intervention.
 *
 *   The search is a greedy 1-opt hill climb whose per-unit option ORDERING is
 *   computed against a claim field that structurally excludes teammates, run
 *   under a budget that in half of all decisions does not complete one pass —
 *   so teammate collisions are not selected against at ordering time, are only
 *   discovered at pricing time, and are only repairable after they have already
 *   been priced.
 *
 * That is the defect, in the census's own words, and it is worth **30.7% of our
 * identifiable deaths** (3,080 of 10,019: contest 1,530 / bodyBlock 1,087 /
 * edge 463). This module is the replacement for the *generation* half: instead
 * of one greedy pass, the joint move of every small cluster is enumerated
 * EXACTLY on a µs-cost surrogate, the k best diverse joints are kept, and the
 * per-cluster answers are composed.
 *
 * ── WHAT COMES OUT IS A PROPOSAL, AND ONLY A PROPOSAL ──────────────────────
 *
 * Nothing here stages anything, removes anything, or writes a bound. The output
 * is a list of complete joint assignments handed to the search, which prices
 * every one of them through the unconditional one-ply bank and accepts only via
 * `better()` on the proved floor (law CL-22). The surrogate can be arbitrarily
 * wrong and the worst that happens is a price spent on a bad proposal.
 *
 * ── THE SURROGATE, AND WHY ITS ORDER-2 TRUNCATION IS EXACT ─────────────────
 *
 *     Ṽ(x)  =  Σ_u φ_u(x_u)  +  ½ Σ_{u≠v} φ_uv(x_u, x_v)
 *
 * φ is not a new scoring function. It is CL1's own seed potential, split into
 * its index-independent and index-dependent halves by taking a literal Möbius
 * difference against an EMPTY conflict index:
 *
 *     φ_u(a)      =  ψ_u(a)  +  pairPotential(∅, u, a)
 *     φ_uv(a,b)   =  pairPotential({v:b}, u, a)  −  pairPotential(∅, u, a)
 *
 * `pairPotential` sums `contestPotential` over the claimants at each
 * `(cell, subStep)` slot and adds the body and follow terms, which read only
 * per-decision static maps. It is therefore EXACTLY ADDITIVE in the index's
 * contents, so the order-2 truncation above is not an approximation of CL1's
 * potential — **it reproduces it identically**, with zero third-order residue.
 * That is asserted as a law in the suite, and it is what lets the enumeration
 * and the greedy seed be compared on the same number.
 *
 * (CL1's potential is itself a pairwise reading of a k-way rule — a three-way
 * pile is adjudicated as a strict maximum over the whole pile, not as three
 * pairs. That approximation is CL1's, it is documented there, and this module
 * inherits it rather than compounding it.)
 *
 * ── THE HALF, WHICH IS NOT DECORATION ──────────────────────────────────────
 *
 * `pairPotential` prices a contest from the MOVER's own side: the loser's view
 * is `−w_loser`, the winner's view of the same event is `−w_loser − λ·stop`.
 * Both views name the same single death, so summing over ordered pairs counts
 * every casualty twice. The ½ makes the pair channel mean exactly what it says
 * — material lost, in lat — which is the only way it can be added to CL2's
 * unary φ without a translation. A mutual annihilation costs `w_a + w_b`; a
 * one-sided kill costs `w_loser`; a self-fatal step costs `w_self`. Getting
 * that balance wrong is how a layer moves a death from one channel to another
 * and calls it a fix (CL1 §6.2 measured exactly that).
 *
 * ── CROSS-CLUSTER TERMS ARE PROVABLY ZERO ──────────────────────────────────
 *
 * Every term of φ_uv fires only where two claims meet at one cell: the same-cell
 * contest, the edge exchange. Two units in different components have DISJOINT
 * `influenceOf` sets, and a claimed cell is in the claimant's influence set by
 * construction. So φ_uv ≡ 0 across components — not approximately, identically.
 * Independent composition is therefore EXACT ON THE SURROGATE, and the
 * cross-component surrogate repair the factor-graph memo specifies (§5.6) is
 * VACUOUS under this relation and is deliberately not built. The coupling that
 * is real — the enemy min, which does not distribute over a sum (§5.5) — is not
 * a surrogate quantity at all: the bank computes it exactly, per proposal, at
 * price time.
 *
 * ── THE FALLBACK LADDER, TWO RUNGS OF IT ───────────────────────────────────
 *
 * Above the exact budget: THRESHOLD-E (drop edges below `edgeEpsilon` and
 * re-split the component — a max-side restriction on our own search order,
 * needing no declaration) and then ICM ON THE SURROGATE, which is today's sweep
 * run on a µs evaluator instead of an 18 ms one and can therefore never be
 * worse than the status quo. Rungs 1, 3 and 4 of the memo's ladder are not
 * built, and §"what is not built" at the foot of this file says why.
 */

import type { Candidate, CandidateSet, CellIndex, JointPlan, UnitId } from '../contracts';
import type { EngineSubstrate, SubstrateUnit } from '../substrate';
import { certainlySelfFatal } from '../staging-safety';
import { candidateKey } from '../bounds';
import { tieKey } from './order';
import { ConflictIndex, subStepsFor } from './conflict-index';
import { SeedWorkspace, pairPotential, singletonPotential, type SeedFacts } from './potentials';
import { mergeAll, type Cluster, type Partition } from './cluster-partition';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export interface ClusterTuning {
  /**
   * The exact regime's ceiling, as a joint-space size.
   *
   * 512 is not a taste: it is `bank.ts`'s own `productCap`, this codebase's
   * existing precedent for "a cross-product this size is affordable", and it is
   * three units at the shipped `candidateCap: 8`. The census says 98.9% of
   * team-turns have every non-slider component at ≤3.
   */
  readonly maxJointsPerCluster: number;
  /** Options per unit the enumeration considers. A max-side cap; no declaration. */
  readonly enumCandidateCap: number;
  /** Options per SLIDER considered as an outer coordinate. See `sliderBranches`. */
  readonly sliderCandidateCap: number;
  /** Slider joints (outer branches) enumerated per decision. */
  readonly maxSliderBranches: number;
  /** Diverse joints kept per cluster. */
  readonly perClusterK: number;
  /**
   * How many variables two kept joints must disagree on, MAP exempt.
   *
   * 2, and the reason is the whole point of the stage: a joint differing from
   * the MAP in ONE unit is a plan the sweep reaches on its own, at the same
   * price, without any of this. Offering it back is offering the coordinator
   * work it has already scheduled. Two-move-and-deeper is what a 1-opt hill
   * climb structurally cannot reach — which is also W1's stated condition for a
   * worker parcel to be worth its transport.
   */
  readonly minHamming: number;
  /** Composed proposals offered per decision, across every branch. */
  readonly composedK: number;
  /** Edges below this |φ| mass are dropped by rung 2. In lat. */
  readonly edgeEpsilon: number;
  /** ICM sweeps before rung 5 gives up. */
  readonly icmSweeps: number;
  /**
   * REFUSE A PROPOSAL EXACT SEARCH FOUND AND COORDINATE ASCENT WOULD TOO.
   *
   * Every branch is solved twice on the surrogate: exactly, and by ICM from the
   * per-unit argmax — rung 5, "today's algorithm on a µs evaluator", the
   * declared floor of this whole design. `noExactGain` counts the composed
   * joints whose Ṽ did not strictly beat that floor.
   *
   * DEFAULT OFF, and the reason is a measurement worth carrying: at the
   * component sizes the census reports (88.7% singletons, 9.3% pairs, 1.6%
   * triples, domains ≤8) **ICM finds the exact MAP on every board in both probe
   * families** — turning this on refused 100% of proposals and reduced the
   * layer to a no-op. Exact enumeration's value on these boards is therefore
   * NOT that it beats coordinate ascent on the surrogate; it is that it beats
   * the SEED, which is a one-sided greedy pass over a teammate-blind ordering
   * and is not a surrogate optimum at all. That comparison is
   * `requireSurrogateGain`, and it is the one that ships on.
   */
  readonly requireExactGain: boolean;
  /**
   * REFUSE A PROPOSAL THE SEARCH ALREADY HAS SOMETHING AS GOOD AS.
   *
   * `Ṽ(proposal) > Ṽ(incumbent)`, evaluated at offer time on the plan the
   * search is actually holding. A proposal that does not beat the incumbent on
   * the µs surrogate has no claim worth an 18 ms price, and spending one on it
   * is spending a price the sweep needed — measured at a mean 0.769 of final
   * floor on the scattered family at the production budget.
   *
   * This is the honest form of "cluster results are proposals": the surrogate
   * decides what is worth OFFERING, and the unconditional price decides what is
   * worth STAGING. Neither can be substituted for the other.
   */
  readonly requireSurrogateGain: boolean;
  /**
   * Our commandable roster at or below which the terminal guard treats our own
   * elimination as reachable and refuses composition.
   */
  readonly terminalRosterFloor: number;
  /**
   * ── THE SIZE RATION: how much reach-expansion arithmetic ONE cluster may buy.
   *
   * Measured in CLAIM SLOTS — the count of `pairPotential` slot visits the pair
   * tables of a cluster will do, which is `Σ over ordered pairs of
   * |D_u|·|D_v|·(reach_u + reach_v)` where `reach` is a domain's mean path
   * length. See `clusterCells`.
   *
   * ── WHY A SIZE RATION AND NOT A COUNT ONE ─────────────────────────────────
   *
   * Batch `20260831-batch2` priced the enumeration per decision across 2,472
   * games and found TWO cost regimes that want opposite remedies:
   *
   *     board            roster              ms/decision  joints  ms/joint
   *     null-snake6      6 snakes                   18.3    41.0      0.45
   *     snake5-knight    5 snakes + KNIGHT          18.0    42.5      0.42
   *     snake5-queen     5 snakes + QUEEN          223.8    52.9      4.23
   *     headline-mix-king mixed + king             474.5  2471.1      0.19
   *
   * A knight costs NOTHING — it is indistinguishable from an all-snake board on
   * both cost and cluster count — so the driver is not piece-presence. A queen
   * costs twelve times a knight on 1.25× the clusters, i.e. its cost is not
   * MORE clusters, it is BIGGER ones: a slider's reach makes each residual
   * cluster large, every pair table's cell walks the whole ray, and the
   * arithmetic explodes while the joint count barely moves. That is a SLIDER
   * regime and it wants a bound on the size of one cluster.
   *
   * The crowded king boards are the other regime — 47× the clusters at a
   * twentieth of the cost each — and they want the count ration below.
   * `search.clusterEnum: false` skips the partition wholesale and is the wrong
   * instrument for either.
   *
   * ── HOW IT DEGRADES ───────────────────────────────────────────────────────
   *
   * Gracefully, and to COARSER PRICING rather than to nothing: the cluster's
   * domains are shrunk from the bottom of the generator's own ordering until
   * the estimate fits, and a cluster still over the ration at the floor is
   * solved by ICM on the surrogate — rung 5, the declared floor of this design,
   * which is today's coordinate ascent on a µs evaluator and can therefore
   * never be worse than the status quo. Both are max-side restrictions on OUR
   * OWN search order and need no declaration (`score.ts`'s rule).
   *
   * Zero disables the ration.
   */
  readonly maxClusterCells: number;
  /**
   * ── THE COUNT RATION: how many clusters one decision may SOLVE.
   *
   * The crowd regime's remedy. Beyond this many, a cluster keeps the seed's own
   * assignment — the generator's ordered-first option for each of its members —
   * and no table is built for it at all. Clusters are solved in the partition's
   * order, so what is rationed is the tail.
   *
   * Zero disables the ration. This is also the ration a DEADLINE spends: an
   * enumeration whose `shouldStop` fires leaves every remaining cluster at the
   * seed, which is what makes the pass interruptible rather than all-or-nothing.
   */
  readonly maxClustersSolved: number;
  /**
   * The smallest domain the size ration may shrink a unit to. Two, because one
   * is not a variable and a cluster of forced units is not a cluster.
   */
  readonly rationDomainFloor: number;
  /**
   * ── THE TIME RATION: the share of the DECISION this pass may spend.
   *
   * A TURN-scale fraction, not a slice-scale one, and the distinction is the
   * whole of it. The enumeration runs inside a refinement slice, and a slice is
   * 25 ms while the pass is 340 — so reading the SLICE's `shouldStop()` would
   * truncate the enumeration on essentially every decision and quietly gut the
   * layer. `BudgetHandle.decisionFraction` is the turn-scale clock, and this is
   * how much of it the pass may consume before it stops solving and leaves the
   * rest of the partition at the seed.
   *
   * 0.35 sits above what the pass costs where it is affordable — 23.7% of a
   * 2,000 ms budget on the most expensive board batch 2 measured — and below
   * what makes it unaffordable, which is the 500 ms rung where the same fixed
   * cost is the whole turn. So a generous budget never truncates and reaches
   * the identical answer, and a tight one degrades instead of overrunning.
   *
   * Zero disables the time ration. It is also inert whenever the handle models
   * no turn (`decisionFraction` absent), which is every deterministic probe:
   * depth and this pass both take their ration from a real clock or from none,
   * and a counting budget must stay a pure function of call count.
   */
  readonly budgetFraction: number;
}

export const DEFAULT_CLUSTER_TUNING: ClusterTuning = {
  maxJointsPerCluster: 512,
  enumCandidateCap: 8,
  sliderCandidateCap: 4,
  maxSliderBranches: 8,
  perClusterK: 4,
  minHamming: 2,
  composedK: 8,
  edgeEpsilon: 0.05,
  icmSweeps: 4,
  requireExactGain: false,
  requireSurrogateGain: true,
  terminalRosterFloor: 2,
  // THE DEFAULTS, SET FROM THE MEASURED DISTRIBUTION, NOT FROM TASTE. See
  // `maxClusterCells` for the numbers and `search.maxClusterCells` in
  // `bot-config.ts` for how an arm moves them.
  // A CEILING, SIZED FROM THE MEASURED DISTRIBUTION — not a routine narrowing.
  //
  // Worst single-cluster estimate over the batch-2 replay corpus, 30 decisions
  // a board: 1,753 on `headline-mix-king`, 1,407 on `hazard-mix-king`, 143 on
  // `snake5-queen`, 39 on `snake5-knight`, 12 on `null-snake6`. 8,000 is 4.5×
  // the worst of those, so the shipped bot never meets it on any board this
  // program has measured and every decision it takes is the decision it took
  // before. What it catches is the tail — a cluster several times larger than
  // anything observed, which is exactly the shape a slider board can produce
  // and the shape that turned one turn into a forfeited one.
  //
  // A ration nobody can see engage is a ration nobody can trust, so an arm
  // names a smaller one (`search.maxClusterCells`) and the mechanism rows —
  // `cells`, `worstClusterCells`, `rungRation` — say what it bought.
  maxClusterCells: 8_000,
  // Cluster counts on the same corpus run 1.0–5.5 a decision, so this is the
  // crowd regime's ceiling on the same footing: inert on everything measured,
  // and the thing that stops a 2,500-cluster board from solving all of them.
  maxClustersSolved: 64,
  rationDomainFloor: 2,
  budgetFraction: 0.35,
};

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

/** A per-decision unary φ from another layer, in lat, or 0. CL2's store. */
export type UnaryLookup = (unitId: UnitId, candidate: Candidate) => number;

export interface EnumRequest {
  readonly sub: EngineSubstrate;
  readonly partition: Partition;
  readonly roster: ReadonlyArray<UnitId>;
  readonly sets: ReadonlyMap<UnitId, CandidateSet>;
  /** Pins and reference actions: they ride every proposal, unchanged. */
  readonly fixed: JointPlan;
  /** Units dead in every world — E4's input, straight off the classifier. */
  readonly doomed: ReadonlySet<UnitId>;
  readonly asTeam: number;
  readonly tuning: ClusterTuning;
  readonly salt: number;
  /** CL2's φ_u, when the edge-EV pass ran. Absent ⇒ the geometric channel alone. */
  readonly unary?: UnaryLookup;
  /**
   * THE DEADLINE, AND WHAT MAKES THIS PASS INTERRUPTIBLE.
   *
   * Consulted once per cluster and once per slider branch — never inside a
   * table — so it costs a handful of clock reads on a board with a handful of
   * clusters. When it fires, every cluster not yet solved keeps the seed's own
   * assignment and the composition proceeds over what IS solved: the pass
   * degrades to a smaller proposal set rather than to a thrown-away decision.
   *
   * Absent ⇒ no deadline, which is what every deterministic probe runs under.
   */
  readonly shouldStop?: () => boolean;
}

export interface ClusterStats {
  readonly clusters: number;
  readonly sliders: number;
  /** Largest non-slider component on this board. */
  readonly maxComponent: number;
  /** Joint-space size actually enumerated, summed over clusters and branches. */
  readonly jointsEnumerated: number;
  /** Joint-space size BEFORE the domain shrink — the reducer's denominator. */
  readonly jointsBeforeShrink: number;
  /** Clusters that fell past the exact regime, by rung. */
  readonly rungThreshold: number;
  readonly rungIcm: number;
  /**
   * PER-CLUSTER COST, EXPOSED — the row the batch-2 mining had to reconstruct
   * from wall clock because no build published it.
   *
   * `cells` is the estimated reach-expansion arithmetic this decision bought,
   * summed over every cluster and branch, and `worstClusterCells` is the single
   * most expensive cluster's share. The two together separate the SLIDER regime
   * (few clusters, one of them enormous) from the CROWD regime (thousands of
   * cheap ones) on a mechanism row instead of on a stopwatch.
   */
  readonly cells: number;
  readonly worstClusterCells: number;
  /** Clusters the SIZE ration degraded — shrunk domains, or pushed to ICM. */
  readonly rungRation: number;
  /** Clusters left at the seed by the COUNT ration or by the deadline. */
  readonly clustersRationed: number;
  /** Composed joints refused because exact search did not beat ICM. */
  readonly noExactGain: number;
  /** Did the terminal guard refuse independent composition? */
  readonly merged: boolean;
  readonly proposals: number;
}

export interface ClusterProposals {
  /**
   * Complete joint plans, best surrogate first. Complete, never partial: law
   * L22 is that a staged set is whole at every instant, and a proposal that is
   * not a whole plan is a proposal the bank cannot price.
   */
  readonly plans: ReadonlyArray<JointPlan>;
  readonly stats: ClusterStats;
  /**
   * Ṽ OF AN ARBITRARY PLAN, for the offer gate.
   *
   * The order-2 truncation is exact (see the header), so this needs no table:
   * build the plan's own conflict index once and read each unit's potential off
   * it, halving the index-dependent half exactly as the enumeration does. Any
   * candidate is admissible, in or out of the enumeration's shrunk domain —
   * which is the whole point, since the incumbent is a plan this module did not
   * produce.
   *
   * Ṽ(x) = Σ_u [ ψ_u(x_u) + ½·pair(full\u, u, x_u) + ½·pair(∅, u, x_u) ]
   *
   * `null` when the enumeration did not run, and then the caller offers
   * unconditionally rather than silently gating on a number nobody computed.
   */
  readonly score: ((plan: JointPlan) => number) | null;
}

const EMPTY_STATS: ClusterStats = {
  clusters: 0,
  sliders: 0,
  maxComponent: 0,
  jointsEnumerated: 0,
  jointsBeforeShrink: 0,
  rungThreshold: 0,
  rungIcm: 0,
  cells: 0,
  worstClusterCells: 0,
  rungRation: 0,
  clustersRationed: 0,
  noExactGain: 0,
  merged: false,
  proposals: 0,
};

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

/** One variable's shrunk domain: the options the enumeration ranges over. */
interface Domain {
  readonly unitId: UnitId;
  readonly unit: SubstrateUnit;
  readonly options: ReadonlyArray<Candidate>;
  /** Each option's rank in the generator's own ordering — ψ's input. */
  readonly ranks: ReadonlyArray<number>;
}

/**
 * THE DOMAIN REDUCER — CL1's marks and the rules-certain fatality classifier,
 * applied to the enumeration's own search order and to nothing else.
 *
 * Two shrinks, in order:
 *
 *  · **FORCED collapses the dimension exactly.** One survivor means the unit's
 *    move is determined, so there is nothing to enumerate. This is CL1's own
 *    set-level, monotone mark and it is a rules fact when `provenance` is
 *    `rules-only`.
 *  · **Certainly-self-fatal options are dropped WHEN A SURVIVOR REMAINS.** The
 *    classifier calls 31–38% of a trail unit's option set certain-fatal for
 *    25 ns, which is where the measured 9.3–17.2× joint-space shrink for a
 *    6-unit cluster comes from — the number that makes exact enumeration
 *    affordable at all. The guard is monotone by construction: if every option
 *    is fatal the domain is left whole, so this can never empty a set.
 *
 * NEITHER IS A PRUNE. The candidate sets are untouched; this narrows what the
 * PROPOSAL GENERATOR ranges over, which is a max-side restriction on our own
 * search order and needs no declaration (`score.ts`'s own rule). Every option
 * dropped here is still tried by the sweep, still in `prunedLedger`-free
 * `candidates`, and still priceable.
 */
function domainOf(
  sub: EngineSubstrate,
  unitId: UnitId,
  set: CandidateSet,
  unit: SubstrateUnit,
  cap: number,
): Domain | null {
  const all = set.candidates;
  if (all.length === 0) return null;
  const limit = Math.max(1, Math.min(cap, all.length));

  if (set.marks?.forced === true) {
    return { unitId, unit, options: [all[0] as Candidate], ranks: [0] };
  }

  const options: Candidate[] = [];
  const ranks: number[] = [];
  const fatal: Candidate[] = [];
  const fatalRanks: number[] = [];
  for (let i = 0; i < limit; i++) {
    const candidate = all[i] as Candidate;
    if (certainlySelfFatal(sub, unit, candidate) !== null) {
      fatal.push(candidate);
      fatalRanks.push(i);
      continue;
    }
    options.push(candidate);
    ranks.push(i);
  }
  // Monotone: an all-fatal unit keeps its whole domain. A unit with no option at
  // all is impossible (the completeness invariant), but a defensive fallback
  // costs one branch and removes a whole class of "how did that happen".
  if (options.length === 0) return { unitId, unit, options: fatal, ranks: fatalRanks };
  return { unitId, unit, options, ranks };
}

// ---------------------------------------------------------------------------
// The rations — what one cluster, and one decision, may spend
// ---------------------------------------------------------------------------

/**
 * A domain's REACH: the mean number of claim slots one of its options occupies.
 *
 * This is the quantity that separates a queen from a knight. A knight's move
 * claims two cells; a queen's ray claims up to the width of the board, and
 * every pair-table cell walks the whole ray. Batch 2 measured the consequence
 * as 4.23 ms per cluster joint on `snake5-queen` against 0.42 on
 * `snake5-knight` — ten times, on 1.25× the clusters.
 *
 * Floored at 1: a domain with no path information still costs one slot.
 */
function reachOf(d: Domain): number {
  let slots = 0;
  for (const option of d.options) slots += option.path.length;
  return Math.max(1, slots / Math.max(1, d.options.length));
}

/**
 * THE ARITHMETIC ONE CLUSTER WILL BUY, in claim slots, before any of it is
 * spent.
 *
 * `Surrogate.pair(u, v)` fills a `|D_u| × |D_v|` table and every cell is one
 * `pairPotential` over `u`'s path against an index holding `v`'s, so a cell
 * costs `reach_u + reach_v`. Every ordered pair inside the cluster is built,
 * and every member is additionally paired both ways with each conditioning
 * slider. That is the whole estimate, and it needs nothing from the board: it
 * is domain sizes and path lengths, both already in hand.
 *
 * The estimate is per BRANCH — the slider tables are shared across branches by
 * the surrogate's own cache, so charging them to each branch over-counts a
 * little. Deliberately: the ration is a ceiling on what a cluster may commit
 * to, and a ceiling that under-counts is not one.
 */
function clusterCells(members: ReadonlyArray<Domain>, sliders: ReadonlyArray<Domain>): number {
  const reach = members.map(reachOf);
  const sliderReach = sliders.map(reachOf);
  let cells = 0;
  for (let i = 0; i < members.length; i++) {
    const u = members[i] as Domain;
    const ru = reach[i] as number;
    for (let j = 0; j < members.length; j++) {
      if (i === j) continue;
      const v = members[j] as Domain;
      cells += u.options.length * v.options.length * (ru + (reach[j] as number));
    }
    for (let k = 0; k < sliders.length; k++) {
      const s = sliders[k] as Domain;
      cells += 2 * u.options.length * s.options.length * (ru + (sliderReach[k] as number));
    }
  }
  return cells;
}

/**
 * SHRINK A CLUSTER'S DOMAINS UNTIL ITS ESTIMATE FITS THE RATION.
 *
 * Options are dropped from the BOTTOM of the generator's own ordering, largest
 * domain first, so what survives is what the candidate layer already ranked
 * highest — the same prefix the sweep would have reached first anyway. No unit
 * falls below `rationDomainFloor`.
 *
 * This is a MAX-SIDE restriction on our own search order and needs no
 * declaration: it narrows what the proposal generator ranges over, and every
 * option dropped here is still offered by the candidate sets, still swept and
 * still priceable. `score.ts`'s law 4 is about MIN-side restrictions, and this
 * is not one.
 *
 * Returns the domains to solve over and whether anything was given up.
 */
function rationDomains(
  members: ReadonlyArray<Domain>,
  sliders: ReadonlyArray<Domain>,
  tuning: ClusterTuning,
): { domains: ReadonlyArray<Domain>; rationed: boolean; cells: number } {
  const cap = tuning.maxClusterCells;
  let cells = clusterCells(members, sliders);
  if (cap <= 0 || cells <= cap) return { domains: members, rationed: false, cells };
  const floor = Math.max(1, tuning.rationDomainFloor);
  const working = members.map((d) => ({ ...d, options: [...d.options], ranks: [...d.ranks] }));
  for (;;) {
    let widest = -1;
    let width = floor;
    for (let i = 0; i < working.length; i++) {
      const n = (working[i] as Domain).options.length;
      if (n > width) {
        width = n;
        widest = i;
      }
    }
    if (widest < 0) break; // every domain is at the floor
    const d = working[widest] as { options: Candidate[]; ranks: number[] };
    d.options.pop();
    d.ranks.pop();
    cells = clusterCells(working, sliders);
    if (cells <= cap) break;
  }
  return { domains: working, rationed: true, cells };
}

// ---------------------------------------------------------------------------
// The surrogate
// ---------------------------------------------------------------------------

/**
 * φ_u and φ_uv, materialised once per decision and read O(1) thereafter.
 *
 * Every pair matrix is built with the OUTER loop over `v`'s options, because
 * the index is what is expensive to rebuild and one rebuild serves all of `u`'s
 * options: `|D_v|` rebuilds per ordered pair instead of `|D_u| × |D_v|`.
 */
class Surrogate {
  private readonly index = new ConflictIndex();
  private readonly unaryCache = new Map<string, number>();
  private readonly pairCache = new Map<string, Float64Array>();
  /** max |φ_uv| per unordered pair — rung 2's threshold reads this. */
  private readonly massCache = new Map<string, number>();

  constructor(
    private readonly sub: EngineSubstrate,
    private readonly facts: SeedFacts,
    private readonly doomed: ReadonlySet<UnitId>,
    private readonly subSteps: number,
    private readonly extraUnary: UnaryLookup | undefined,
  ) {}

  /** φ_u(a) — ψ plus the index-independent half of CL1's potential. */
  unary(d: Domain, i: number): number {
    const key = `${d.unitId}:${i}`;
    const hit = this.unaryCache.get(key);
    if (hit !== undefined) return hit;
    const candidate = d.options[i] as Candidate;
    this.index.begin(this.facts.cells, this.subSteps);
    const base = pairPotential(this.facts, this.index, d.unit, candidate, this.doomed);
    const psi = singletonPotential(this.sub, d.unit, candidate, d.ranks[i] as number);
    const extra = this.extraUnary?.(d.unitId, candidate) ?? 0;
    const value = psi + base + extra;
    this.unaryCache.set(key, value);
    return value;
  }

  /** φ_uv(a,b), for the ORDERED pair — `u`'s own view of `v`'s claim. */
  pair(u: Domain, v: Domain): Float64Array {
    const key = `${u.unitId}>${v.unitId}`;
    const hit = this.pairCache.get(key);
    if (hit !== undefined) return hit;
    const rows = u.options.length;
    const cols = v.options.length;
    const table = new Float64Array(rows * cols);
    // The index-independent half, subtracted out so what remains is the pure
    // second difference. Computed once per option of `u`.
    const base = new Float64Array(rows);
    this.index.begin(this.facts.cells, this.subSteps);
    for (let a = 0; a < rows; a++) {
      base[a] = pairPotential(
        this.facts,
        this.index,
        u.unit,
        u.options[a] as Candidate,
        this.doomed,
      );
    }
    for (let b = 0; b < cols; b++) {
      const other = v.options[b] as Candidate;
      this.index.begin(this.facts.cells, this.subSteps);
      this.index.claim(v.unitId, other.from, other.path);
      for (let a = 0; a < rows; a++) {
        const withOther = pairPotential(
          this.facts,
          this.index,
          u.unit,
          u.options[a] as Candidate,
          this.doomed,
        );
        table[a * cols + b] = withOther - (base[a] as number);
      }
    }
    this.pairCache.set(key, table);
    return table;
  }

  /** max |φ_uv| over both directions — the edge's mass. */
  mass(u: Domain, v: Domain): number {
    const key = u.unitId < v.unitId ? `${u.unitId}|${v.unitId}` : `${v.unitId}|${u.unitId}`;
    const hit = this.massCache.get(key);
    if (hit !== undefined) return hit;
    let m = 0;
    for (const table of [this.pair(u, v), this.pair(v, u)]) {
      for (let i = 0; i < table.length; i++) {
        const abs = Math.abs(table[i] as number);
        if (abs > m) m = abs;
      }
    }
    this.massCache.set(key, m);
    return m;
  }
}

/** The ½ of the ordered-pair sum. See the file header. */
const PAIR_SHARE = 0.5;

/** Leaves between two deadline reads inside an exact walk, minus one — used as
 *  a mask, so it must stay `2^k − 1`. 63 is one read per 64 leaves, which is
 *  one read per eighth of a cluster at the shipped `maxJointsPerCluster`. */
const STOP_STRIDE_MASK = 63;

/**
 * Ṽ over an assignment, given the domains it ranges over.
 *
 * `pick[i]` is an index into `domains[i].options`. Every ordered pair is
 * counted and the sum is halved, so a casualty is priced once.
 */
function surrogateScore(
  surrogate: Surrogate,
  domains: ReadonlyArray<Domain>,
  pick: ReadonlyArray<number>,
): number {
  let total = 0;
  for (let i = 0; i < domains.length; i++) {
    total += surrogate.unary(domains[i] as Domain, pick[i] as number);
  }
  for (let i = 0; i < domains.length; i++) {
    const u = domains[i] as Domain;
    for (let j = 0; j < domains.length; j++) {
      if (i === j) continue;
      const v = domains[j] as Domain;
      const table = surrogate.pair(u, v);
      total += PAIR_SHARE * (table[(pick[i] as number) * v.options.length + (pick[j] as number)] as number);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// One cluster, exactly
// ---------------------------------------------------------------------------

interface Joint {
  readonly pick: ReadonlyArray<number>;
  readonly score: number;
  readonly tie: number;
}

/**
 * EXACT ENUMERATION OVER A CARTESIAN PRODUCT, then k-best with a Hamming floor.
 *
 * No bucket elimination and no junction tree. At `k_c ≤ 3` and `|D| ≤ 8` the
 * table is ≤512 entries and materialising it is cheaper than the message
 * bookkeeping that would avoid it — the factor-graph memo says so in as many
 * words (*"do not build a general junction-tree library"*), and the fallback
 * for anything that does not fit is the ladder, which is cheaper to maintain
 * and cannot be wrong in a way that matters.
 */
function enumerateExact(
  surrogate: Surrogate,
  domains: ReadonlyArray<Domain>,
  conditioned: ReadonlyArray<Domain>,
  conditionedPick: ReadonlyArray<number>,
  tuning: ClusterTuning,
  salt: number,
  stop?: () => boolean,
): { joints: ReadonlyArray<Joint>; enumerated: number } {
  if (domains.length === 0) return { joints: [{ pick: [], score: 0, tie: 0 }], enumerated: 1 };

  const sizes = domains.map((d) => d.options.length);
  let product = 1;
  for (const s of sizes) product *= s;

  const all: Joint[] = [];
  const pick = new Array<number>(domains.length).fill(0);
  // THE DEADLINE, ON A STRIDE. A cluster at the exact ceiling is 512 leaves and
  // each leaf is an O(m²) table read, so checking every leaf would spend more
  // on the clock than on the answer; checking every `STOP_STRIDE` bounds the
  // overshoot at a stride's worth of leaves and costs one read per stride.
  // The joints already found are kept — a truncated exact walk is a smaller
  // k-best list over a real subset, which is still a proposal set.
  let leaves = 0;
  let cut = false;
  const walk = (i: number): void => {
    if (cut) return;
    if (i === domains.length) {
      if ((leaves++ & STOP_STRIDE_MASK) === STOP_STRIDE_MASK && stop?.() === true) {
        cut = true;
        return;
      }
      let score = surrogateScore(surrogate, domains, pick);
      // The conditioning terms: every variable of this cluster against every
      // shared slider, both directions, halved exactly as the internal pairs
      // are. This is what "solved conditional on the slider assignment" means
      // arithmetically — condition, never marginalise.
      for (let a = 0; a < domains.length; a++) {
        const u = domains[a] as Domain;
        for (let b = 0; b < conditioned.length; b++) {
          const v = conditioned[b] as Domain;
          const forward = surrogate.pair(u, v);
          const back = surrogate.pair(v, u);
          const ia = pick[a] as number;
          const ib = conditionedPick[b] as number;
          score += PAIR_SHARE * (forward[ia * v.options.length + ib] as number);
          score += PAIR_SHARE * (back[ib * u.options.length + ia] as number);
        }
      }
      all.push({ pick: [...pick], score, tie: jointTie(domains, pick, salt) });
      return;
    }
    const width = sizes[i] as number;
    for (let v = 0; v < width; v++) {
      pick[i] = v;
      walk(i + 1);
    }
  };
  walk(0);

  return { joints: kBestDiverse(all, tuning), enumerated: product };
}

/**
 * A MIRROR-SAFE TIE KEY. Two identical bots breaking exact ties identically
 * walk into the same square, and in this game a tie leaves nobody standing.
 * The salt is the searcher's own; this adds no second seed.
 */
function jointTie(
  domains: ReadonlyArray<Domain>,
  pick: ReadonlyArray<number>,
  salt: number,
): number {
  const parts: string[] = [];
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i] as Domain;
    parts.push(candidateKey(d.options[pick[i] as number] as Candidate));
  }
  return tieKey(parts.join('|'), salt);
}

/**
 * TOP-k WITH A HAMMING FLOOR, THE MAP EXEMPT.
 *
 * The MAP always rides. After it, a joint is kept only if it disagrees with
 * every kept joint on at least `minHamming` variables — because a joint one
 * move from another is a plan the coordinate ascent reaches unaided, and
 * offering it back is offering the coordinator work it has already scheduled.
 */
function kBestDiverse(all: Joint[], tuning: ClusterTuning): ReadonlyArray<Joint> {
  all.sort((a, b) => b.score - a.score || b.tie - a.tie);
  const out: Joint[] = [];
  for (const joint of all) {
    if (out.length >= tuning.perClusterK) break;
    if (out.length === 0) {
      out.push(joint);
      continue;
    }
    let ok = true;
    for (const kept of out) {
      if (hamming(joint.pick, kept.pick) < tuning.minHamming) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(joint);
  }
  return out;
}

function hamming(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/**
 * RUNG 5 — ICM ON THE SURROGATE. Today's sweep, on a µs evaluator.
 *
 * Cannot fail, cannot loop forever, cannot be worse than the status quo. It is
 * the floor of the whole design and the only rung that runs when a component is
 * too big for anything better.
 */
function icm(
  surrogate: Surrogate,
  domains: ReadonlyArray<Domain>,
  conditioned: ReadonlyArray<Domain>,
  conditionedPick: ReadonlyArray<number>,
  tuning: ClusterTuning,
  salt: number,
): Joint {
  const pick = new Array<number>(domains.length).fill(0);
  const score = (): number => {
    let total = surrogateScore(surrogate, domains, pick);
    for (let a = 0; a < domains.length; a++) {
      const u = domains[a] as Domain;
      for (let b = 0; b < conditioned.length; b++) {
        const v = conditioned[b] as Domain;
        const forward = surrogate.pair(u, v);
        const back = surrogate.pair(v, u);
        const ia = pick[a] as number;
        const ib = conditionedPick[b] as number;
        total += PAIR_SHARE * (forward[ia * v.options.length + ib] as number);
        total += PAIR_SHARE * (back[ib * u.options.length + ia] as number);
      }
    }
    return total;
  };
  let best = score();
  for (let sweep = 0; sweep < tuning.icmSweeps; sweep++) {
    let moved = false;
    for (let i = 0; i < domains.length; i++) {
      const width = (domains[i] as Domain).options.length;
      const was = pick[i] as number;
      let bestAt = was;
      for (let v = 0; v < width; v++) {
        if (v === was) continue;
        pick[i] = v;
        const trial = score();
        if (trial > best) {
          best = trial;
          bestAt = v;
        }
      }
      pick[i] = bestAt;
      if (bestAt !== was) moved = true;
    }
    if (!moved) break;
  }
  return { pick: [...pick], score: best, tie: jointTie(domains, pick, salt) };
}

/**
 * RUNG 2 — THRESHOLD `E`, then re-split.
 *
 * Drop every internal edge whose mass is under `edgeEpsilon` lat (half the
 * smallest ordering family's whole span) and take the connected components of
 * what is left. Dropping a near-zero edge moves the surrogate by less than the
 * threshold BY CONSTRUCTION, and it is a restriction on our own search order,
 * so it needs no declaration.
 *
 * Returns the sub-components, smallest-unit-id first for determinism.
 */
function thresholdSplit(
  surrogate: Surrogate,
  domains: ReadonlyArray<Domain>,
  epsilon: number,
): ReadonlyArray<ReadonlyArray<Domain>> {
  const n = domains.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (surrogate.mass(domains[i] as Domain, domains[j] as Domain) < epsilon) continue;
      const ra = find(i);
      const rb = find(j);
      if (ra !== rb) parent[ra] = rb;
    }
  }
  const byRoot = new Map<number, Domain[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = byRoot.get(r);
    if (g === undefined) byRoot.set(r, [domains[i] as Domain]);
    else g.push(domains[i] as Domain);
  }
  return [...byRoot.values()].sort(
    (a, b) => ((a[0] as Domain).unitId as number) - ((b[0] as Domain).unitId as number),
  );
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

interface Composed {
  readonly parts: ReadonlyArray<Joint>;
  readonly score: number;
  readonly tie: number;
}

/**
 * THE k-WAY MERGE — the exact top-k of a Cartesian product of sorted lists.
 *
 * Because `Ṽ` has NO term spanning two components, the composed score is the
 * sum of the parts and the top-k of the product is reachable best-first from
 * `(0,0,…,0)` by advancing one coordinate at a time. Exact, `O(k · c · log)`,
 * and it is the whole of the owner's "independent composition" on the
 * surrogate side.
 */
function composeBestFirst(
  lists: ReadonlyArray<ReadonlyArray<Joint>>,
  k: number,
): ReadonlyArray<Composed> {
  if (lists.length === 0) return [];
  for (const list of lists) if (list.length === 0) return [];

  const start = new Array<number>(lists.length).fill(0);
  const seen = new Set<string>([start.join(',')]);
  const scoreOf = (at: ReadonlyArray<number>): { score: number; tie: number } => {
    let score = 0;
    let tie = 0;
    for (let i = 0; i < lists.length; i++) {
      const joint = (lists[i] as ReadonlyArray<Joint>)[at[i] as number] as Joint;
      score += joint.score;
      tie ^= joint.tie;
    }
    return { score, tie };
  };
  // A frontier this small does not want a heap: `k · c` is a couple of dozen
  // entries and a linear scan beats the allocation.
  const frontier: Array<{ at: number[]; score: number; tie: number }> = [
    { at: start, ...scoreOf(start) },
  ];
  const out: Composed[] = [];
  while (out.length < k && frontier.length > 0) {
    let bestAt = 0;
    for (let i = 1; i < frontier.length; i++) {
      const a = frontier[i] as { score: number; tie: number };
      const b = frontier[bestAt] as { score: number; tie: number };
      if (a.score > b.score || (a.score === b.score && a.tie > b.tie)) bestAt = i;
    }
    const taken = frontier.splice(bestAt, 1)[0] as { at: number[]; score: number; tie: number };
    out.push({
      parts: taken.at.map((v, i) => (lists[i] as ReadonlyArray<Joint>)[v] as Joint),
      score: taken.score,
      tie: taken.tie,
    });
    for (let i = 0; i < lists.length; i++) {
      const next = [...taken.at];
      next[i] = (next[i] as number) + 1;
      if ((next[i] as number) >= (lists[i] as ReadonlyArray<Joint>).length) continue;
      const key = next.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      frontier.push({ at: next, ...scoreOf(next) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The terminal guard
// ---------------------------------------------------------------------------

/**
 * IS A TERMINAL CLAMP LIVE? Composition is refused when one is, and the
 * components are merged instead.
 *
 * Independent composition is optimistic about anything that cannot be added:
 * a clamp is exactly such a thing — our own elimination, an enemy's last king,
 * an emptied `worstAlive`. The factor-graph memo's §5.4 names three conditions
 * and each maps to a predicate that is one pass over the roster:
 *
 *  · **OUR ELIMINATION IS REACHABLE.** Our commandable roster is at or below
 *    the floor, so a joint that loses one unit is a joint near the bottom of
 *    the lattice; or we are a regicide team and our king is a variable.
 *  · **A TERMINAL TAKE IS ON OFFER.** Some variable's option touches the square
 *    of a team's LAST king, or of a team's LAST unit.
 *
 * The guard is CONSERVATIVE and that is free: refusing composition costs a
 * merged component (one rung down the ladder), never an unsound stage.
 */
function terminalClampLive(
  sub: EngineSubstrate,
  asTeam: number,
  variables: ReadonlyArray<UnitId>,
  domains: ReadonlyMap<UnitId, Domain>,
  rosterSize: number,
  tuning: ClusterTuning,
): boolean {
  if (rosterSize <= tuning.terminalRosterFloor) return true;

  const regicide = sub.regicideTeamNumbers();
  if (regicide.has(asTeam)) {
    for (const unitId of variables) {
      const unit = sub.unitOf(unitId);
      if (unit !== undefined && unit.isKing && unit.team === asTeam) return true;
    }
  }

  // Last unit / last king per team, as occupied cells. One pass.
  const byTeam = new Map<number, { units: number; kings: number }>();
  for (const unit of sub.roster()) {
    const at = byTeam.get(unit.team) ?? { units: 0, kings: 0 };
    at.units++;
    if (unit.isKing) at.kings++;
    byTeam.set(unit.team, at);
  }
  const terminalCells = new Set<CellIndex>();
  for (const unit of sub.roster()) {
    if (unit.team === asTeam) continue;
    const at = byTeam.get(unit.team) as { units: number; kings: number };
    const lastUnit = at.units <= 1;
    const lastKing = unit.isKing && at.kings <= 1 && regicide.has(unit.team);
    if (!lastUnit && !lastKing) continue;
    for (const cell of unit.cells) terminalCells.add(cell);
  }
  if (terminalCells.size === 0) return false;

  for (const unitId of variables) {
    const domain = domains.get(unitId);
    if (domain === undefined) continue;
    for (const option of domain.options) {
      if (terminalCells.has(option.to)) return true;
      for (const cell of option.path) if (terminalCells.has(cell)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * THE COMPOSED k-BEST JOINTS, AS COMPLETE PLANS, BEST SURROGATE FIRST.
 *
 * One pass, per decision, over the whole partition:
 *
 *   1. domains, shrunk (FORCED collapse, rules-certain fatal drop)
 *   2. the terminal guard — merge instead of composing when a clamp is live
 *   3. the slider branches — one outer coordinate, capped, NEVER marginalised
 *   4. per cluster, per branch: exact enumeration if it fits, else the ladder
 *   5. compose across clusters, exactly, by k-way merge
 *   6. merge across branches into one ordered proposal list
 */
export function enumerateProposals(req: EnumRequest): ClusterProposals {
  const { sub, partition, roster, sets, fixed, doomed, tuning, salt } = req;
  if (partition.clusters.length === 0) {
    return { plans: [], stats: EMPTY_STATS, score: null };
  }

  // The workspace's facts are read over the WHOLE roster, pinned units
  // included: a pinned team-mate is not a variable, but its claim can still
  // kill one of ours and its tail pop can still free a cell. Reading them over
  // the variable set alone made a pinned unit invisible to every potential —
  // CL1 learned that one the hard way.
  const workspace = new SeedWorkspace();
  const facts = workspace.facts(sub, roster);

  const domains = new Map<UnitId, Domain>();
  const paths: Array<ReadonlyArray<CellIndex>> = [];
  for (const candidate of fixed.values()) paths.push(candidate.path);
  for (const unitId of partition.variables) {
    const set = sets.get(unitId);
    const unit = sub.unitOf(unitId);
    if (set === undefined || unit === undefined) continue;
    const cap = partition.sliders.includes(unitId)
      ? tuning.sliderCandidateCap
      : tuning.enumCandidateCap;
    const domain = domainOf(sub, unitId, set, unit, cap);
    if (domain === null) continue;
    domains.set(unitId, domain);
    for (const option of domain.options) paths.push(option.path);
  }
  if (domains.size === 0) return { plans: [], stats: EMPTY_STATS, score: null };

  const subSteps = subStepsFor(paths);
  const surrogate = new Surrogate(sub, facts, doomed, subSteps, req.unary);
  const emptyIndex = new ConflictIndex();

  // The guard runs BEFORE any table is built, because merging changes which
  // tables there are to build.
  const merged = terminalClampLive(
    sub,
    req.asTeam,
    partition.variables,
    domains,
    roster.length,
    tuning,
  );
  const effective = merged ? mergeAll(partition) : partition;

  const sliderDomains = partition.sliders
    .map((id) => domains.get(id))
    .filter((d): d is Domain => d !== undefined);

  // THE OUTER COORDINATE. Every branch is a whole slider joint and every
  // cluster is solved conditional on it; the branches are then compared as
  // whole proposals. Nothing is ever averaged over a slider.
  const branches = sliderBranches(sliderDomains, tuning);

  let jointsEnumerated = 0;
  let jointsBeforeShrink = 0;
  let rungThreshold = 0;
  let rungIcm = 0;
  let rungRation = 0;
  let clustersRationed = 0;
  let cells = 0;
  let worstClusterCells = 0;
  let maxComponent = 0;
  // The two rations' handles, read once. `maxClustersSolved` counts clusters
  // per BRANCH, and the deadline is the same gate spent by the clock.
  const countCap = tuning.maxClustersSolved;
  const stop = req.shouldStop;
  for (const cluster of effective.clusters) {
    if (cluster.members.length > maxComponent) maxComponent = cluster.members.length;
    let before = 1;
    for (const unitId of cluster.members) {
      const set = sets.get(unitId);
      before *= Math.max(1, Math.min(tuning.enumCandidateCap, set?.candidates.length ?? 1));
    }
    jointsBeforeShrink += before;
  }

  const scored: Array<{ plan: JointPlan; score: number; tie: number }> = [];
  const seenPlans = new Set<string>();
  let noExactGain = 0;

  for (const branch of branches) {
    // THE OUTER COORDINATE IS ALSO RATIONED. Every branch re-solves every
    // cluster, so a slider board's cost is the per-branch cost times
    // `maxSliderBranches` — and a branch begun after the deadline would solve
    // nothing and compose the seed. The branches already scored stand; they are
    // whole proposals and were never averaged over.
    if (scored.length > 0 && stop?.() === true) break;
    const perCluster: Array<ReadonlyArray<Joint>> = [];
    const clusterDomains: Array<ReadonlyArray<Domain>> = [];
    let icmFloor = 0;
    let feasible = true;
    // The COUNT ration and the deadline are per branch: every branch is a whole
    // proposal and a branch that solved nothing is a branch that offers the
    // seed back, which is not worth the composition it would cost.
    let solvedHere = 0;

    for (const cluster of effective.clusters) {
      const members = memberDomains(cluster, domains);
      if (members.length === 0) {
        perCluster.push([{ pick: [], score: 0, tie: 0 }]);
        clusterDomains.push([]);
        continue;
      }
      // ---- THE COUNT RATION, AND THE DEADLINE ------------------------------
      //
      // Both leave the cluster at the SEED — option 0 of every member, which is
      // the candidate layer's own ordered-first choice and exactly what the
      // greedy pass would have taken. No table is built, so a rationed cluster
      // costs nothing rather than costing less. This is the crowd regime's
      // remedy (2,500 cheap clusters a decision on the mix-king boards) and it
      // is what makes the pass interruptible.
      //
      // ── THE INTERRUPTION STATE IS PER CLUSTER, DELIBERATELY ───────────────
      //
      // There is no global cursor and no checkpoint. Each cluster is
      // independently either SOLVED or LEFT AT THE SEED, decided here, counted
      // here, and composed either way — so a deadline that fires halfway
      // through the partition keeps every cluster it had already solved
      // instead of discarding the pass.
      //
      // That shape is chosen for a second reason it does not yet collect on. A
      // mid-turn operator commit moves ONE unit from `partition.variables` to
      // `fixed`, which changes ONE cluster; a global checkpoint would force the
      // whole enumeration to be redone on every human intervention, while
      // per-cluster state admits redoing only the touched cluster and reusing
      // the rest. The reuse itself is NOT built here — a session is keyed by
      // basis, so an epoch change still opens a new session and re-enumerates —
      // and this is the seam it hangs on when it is.
      const overCount = countCap > 0 && solvedHere >= countCap;
      if (overCount || stop?.() === true) {
        perCluster.push([{ pick: members.map(() => 0), score: 0, tie: 0 }]);
        clusterDomains.push(members);
        icmFloor = Number.NEGATIVE_INFINITY;
        clustersRationed++;
        continue;
      }
      const solved = solveCluster(
        surrogate,
        members,
        sliderDomains,
        branch,
        tuning,
        salt,
        stop,
      );
      if (solved.joints.length === 0) {
        feasible = false;
        break;
      }
      solvedHere++;
      jointsEnumerated += solved.enumerated;
      rungThreshold += solved.rungThreshold;
      rungIcm += solved.rungIcm;
      rungRation += solved.rungRation;
      cells += solved.cells;
      if (solved.cells > worstClusterCells) worstClusterCells = solved.cells;
      icmFloor += Number.isFinite(solved.icmScore) ? solved.icmScore : -Infinity;
      perCluster.push(solved.joints);
      clusterDomains.push(solved.domains);
    }
    if (!feasible) continue;

    // The branch's own score: the sliders against each other, plus their
    // unaries. The cluster scores already carry the cross terms.
    let branchScore = 0;
    for (let i = 0; i < sliderDomains.length; i++) {
      branchScore += surrogate.unary(sliderDomains[i] as Domain, branch[i] as number);
    }
    for (let i = 0; i < sliderDomains.length; i++) {
      const u = sliderDomains[i] as Domain;
      for (let j = 0; j < sliderDomains.length; j++) {
        if (i === j) continue;
        const v = sliderDomains[j] as Domain;
        const table = surrogate.pair(u, v);
        branchScore +=
          PAIR_SHARE *
          (table[(branch[i] as number) * v.options.length + (branch[j] as number)] as number);
      }
    }

    for (const composed of composeBestFirst(perCluster, tuning.composedK)) {
      // THE GAIN TEST. `icmFloor` is `-Infinity` whenever any cluster reached
      // the fallback ladder, and a comparison against it is then vacuously
      // true — which is the right answer: a cluster that could not be solved
      // exactly has made no exact claim to check.
      if (!(composed.score > icmFloor)) {
        noExactGain++;
        if (tuning.requireExactGain) continue;
      }
      const plan = new Map<UnitId, Candidate>(fixed);
      for (let i = 0; i < sliderDomains.length; i++) {
        const d = sliderDomains[i] as Domain;
        plan.set(d.unitId, d.options[branch[i] as number] as Candidate);
      }
      for (let c = 0; c < composed.parts.length; c++) {
        const part = composed.parts[c] as Joint;
        const ds = clusterDomains[c] as ReadonlyArray<Domain>;
        for (let i = 0; i < ds.length; i++) {
          const d = ds[i] as Domain;
          plan.set(d.unitId, d.options[part.pick[i] as number] as Candidate);
        }
      }
      const key = planKeyOf(plan);
      if (seenPlans.has(key)) continue;
      seenPlans.add(key);
      scored.push({ plan, score: composed.score + branchScore, tie: composed.tie });
    }
  }

  scored.sort((a, b) => b.score - a.score || b.tie - a.tie);
  const plans = scored.slice(0, tuning.composedK).map((s) => s.plan);

  // The scorer keeps the facts and the sub-step bound alive; it allocates one
  // index of its own so a later call can never disturb the enumeration's.
  const scoreIndex = new ConflictIndex();
  const rankOf = (unitId: UnitId, candidate: Candidate): number => {
    const set = sets.get(unitId);
    if (set === undefined) return 0;
    const at = set.candidates.indexOf(candidate);
    if (at >= 0) return at;
    for (let i = 0; i < set.candidates.length; i++) {
      const other = set.candidates[i] as Candidate;
      if (other.to === candidate.to && samePath(other, candidate)) return i;
    }
    // Not offered at all — the incumbent may hold a pruned candidate. Rank it
    // last, which is the honest reading of "the generator did not rank it".
    return set.candidates.length;
  };
  const score = (plan: JointPlan): number => {
    scoreIndex.begin(facts.cells, subSteps);
    for (const [unitId, candidate] of plan) {
      scoreIndex.claim(unitId, candidate.from, candidate.path);
    }
    let total = 0;
    for (const unitId of partition.variables) {
      const unit = sub.unitOf(unitId);
      const chosen = plan.get(unitId);
      if (unit === undefined || chosen === undefined) continue;
      const withAll = pairPotential(facts, scoreIndex, unit, chosen, doomed);
      total += singletonPotential(sub, unit, chosen, rankOf(unitId, chosen));
      total += PAIR_SHARE * withAll;
      emptyIndex.begin(facts.cells, subSteps);
      total += PAIR_SHARE * pairPotential(facts, emptyIndex, unit, chosen, doomed);
      total += req.unary?.(unitId, chosen) ?? 0;
    }
    return total;
  };

  return {
    plans,
    score,
    stats: {
      clusters: effective.clusters.length,
      sliders: partition.sliders.length,
      maxComponent,
      jointsEnumerated,
      jointsBeforeShrink,
      rungThreshold,
      rungIcm,
      cells,
      worstClusterCells,
      rungRation,
      clustersRationed,
      noExactGain,
      merged,
      proposals: plans.length,
    },
  };
}

function memberDomains(
  cluster: Cluster,
  domains: ReadonlyMap<UnitId, Domain>,
): ReadonlyArray<Domain> {
  const out: Domain[] = [];
  for (const unitId of cluster.members) {
    const domain = domains.get(unitId);
    if (domain !== undefined) out.push(domain);
  }
  return out;
}

/**
 * ONE CLUSTER, CONDITIONAL ON ONE SLIDER BRANCH — the fallback ladder, in
 * order, each rung strictly cheaper to be wrong on than the last.
 */
function solveCluster(
  surrogate: Surrogate,
  requested: ReadonlyArray<Domain>,
  sliders: ReadonlyArray<Domain>,
  branch: ReadonlyArray<number>,
  tuning: ClusterTuning,
  salt: number,
  stop: (() => boolean) | undefined,
): {
  joints: ReadonlyArray<Joint>;
  domains: ReadonlyArray<Domain>;
  enumerated: number;
  rungThreshold: number;
  rungIcm: number;
  /** The size ration's verdict on this cluster: the arithmetic it was
   *  estimated to want, and whether the ration had to take some away. */
  cells: number;
  rungRation: number;
  /** Ṽ of the ICM fixpoint — rung 5, the declared floor of the design. */
  icmScore: number;
} {
  // ---- RUNG 0 OF THE LADDER: the size ration, before any table is built ----
  //
  // It runs FIRST because everything below it — the exact walk, the threshold
  // split, the ICM fixpoint — reads the same pair tables, so a ration applied
  // after the tables exist would have already paid for what it is refusing.
  const rationed = rationDomains(requested, sliders, tuning);
  const members = rationed.domains;
  const rungRation = rationed.rationed ? 1 : 0;

  let product = 1;
  for (const d of members) product *= d.options.length;

  // Still over the ration with every domain at its floor: this is a cluster no
  // amount of narrowing makes affordable, and it takes the design's declared
  // floor — coordinate ascent on the µs surrogate, which is today's algorithm
  // and can never be worse than the status quo.
  if (tuning.maxClusterCells > 0 && rationed.cells > tuning.maxClusterCells) {
    return {
      joints: [icm(surrogate, members, sliders, branch, tuning, salt)],
      domains: members,
      enumerated: 0,
      rungThreshold: 0,
      rungIcm: 1,
      cells: rationed.cells,
      rungRation,
      icmScore: Number.NEGATIVE_INFINITY,
    };
  }

  if (product <= tuning.maxJointsPerCluster) {
    const { joints, enumerated } = enumerateExact(
      surrogate,
      members,
      sliders,
      branch,
      tuning,
      salt,
      stop,
    );
    // THE FLOOR, MEASURED RATHER THAN ASSUMED. Coordinate ascent on the same
    // surrogate from the same start: what this stage has to beat to be worth a
    // price. µs, and it is the only honest way to say whether exact inference
    // earned its place on THIS board.
    const floor = icm(surrogate, members, sliders, branch, tuning, salt).score;
    return {
      joints,
      domains: members,
      enumerated,
      rungThreshold: 0,
      rungIcm: 0,
      cells: rationed.cells,
      rungRation,
      icmScore: floor,
    };
  }

  // RUNG 2 — threshold and re-split. Exact on the thresholded graph.
  const pieces = thresholdSplit(surrogate, members, tuning.edgeEpsilon);
  if (pieces.length > 1) {
    const perPiece: Array<ReadonlyArray<Joint>> = [];
    const order: Domain[] = [];
    let enumerated = 0;
    let icmCount = 0;
    for (const piece of pieces) {
      let size = 1;
      for (const d of piece) size *= d.options.length;
      // Once the deadline has fired every remaining piece takes the ICM
      // fixpoint rather than the exact walk: coarser pricing, on the rung the
      // design already declares as its floor, and bounded.
      if (size <= tuning.maxJointsPerCluster && stop?.() !== true) {
        const solved = enumerateExact(surrogate, piece, sliders, branch, tuning, salt, stop);
        perPiece.push(solved.joints);
        enumerated += solved.enumerated;
      } else {
        perPiece.push([icm(surrogate, piece, sliders, branch, tuning, salt)]);
        icmCount++;
      }
      order.push(...piece);
    }
    // Splice the piece answers back into ONE joint over the cluster's own
    // variable order, so the caller never has to know a split happened.
    const composed = composeBestFirst(perPiece, tuning.perClusterK);
    const joints: Joint[] = composed.map((c) => ({
      pick: c.parts.flatMap((p) => [...p.pick]),
      score: c.score,
      tie: c.tie,
    }));
    return {
      joints,
      domains: order,
      enumerated,
      rungThreshold: 1,
      rungIcm: icmCount,
      cells: rationed.cells,
      rungRation,
      // A cluster that reached the ladder has already conceded the exact
      // claim; the gain test would compare it against itself.
      icmScore: Number.NEGATIVE_INFINITY,
    };
  }

  // RUNG 5 — ICM on the surrogate. The floor.
  return {
    joints: [icm(surrogate, members, sliders, branch, tuning, salt)],
    domains: members,
    enumerated: 0,
    rungThreshold: 0,
    rungIcm: 1,
    cells: rationed.cells,
    rungRation,
    icmScore: Number.NEGATIVE_INFINITY,
  };
}

/**
 * THE SLIDER BRANCHES — the outer coordinate, capped by count and never
 * averaged over.
 *
 * Our side carries 0–1 sliders on 70.7% of team-turns and ≤2 on 97.5%, so this
 * is a one-element list in the median game and at most a handful in the rest.
 * The cap is a max-side restriction on our own search order (`order.ts`'s own
 * rule) and needs no declaration.
 */
function sliderBranches(
  sliders: ReadonlyArray<Domain>,
  tuning: ClusterTuning,
): ReadonlyArray<ReadonlyArray<number>> {
  if (sliders.length === 0) return [[]];
  const out: number[][] = [];
  const pick = new Array<number>(sliders.length).fill(0);
  const walk = (i: number): void => {
    if (out.length >= tuning.maxSliderBranches) return;
    if (i === sliders.length) {
      out.push([...pick]);
      return;
    }
    const width = (sliders[i] as Domain).options.length;
    for (let v = 0; v < width; v++) {
      pick[i] = v;
      walk(i + 1);
      if (out.length >= tuning.maxSliderBranches) return;
    }
  };
  walk(0);
  return out;
}

function samePath(a: Candidate, b: Candidate): boolean {
  return a.path.length === b.path.length && a.path.every((cell, i) => cell === b.path[i]);
}

function planKeyOf(plan: JointPlan): string {
  const parts: string[] = [];
  for (const [unitId, candidate] of plan) parts.push(`${unitId}:${candidateKey(candidate)}`);
  parts.sort();
  return parts.join('|');
}

// ---------------------------------------------------------------------------
// WHAT IS NOT BUILT, AND WHY
// ---------------------------------------------------------------------------
//
// · RUNG 1 (tighten `E` with sub-step windows). `influenceOf` is a cell SET
//   with no time coordinate; the sub-step window lives on `entangled`'s probe
//   shape and would need a second, per-candidate footprint the substrate does
//   not cache. It splits pass-through coincidences, which the census measured
//   at 1.89× over-reporting — real, but the rung below it already handles the
//   only cases that reach the ladder at all.
//
// · RUNG 3 (cluster, solve, repair the cut). Rung 2's re-split IS the cluster
//   half; the repair half is the cross-piece 2-opt, and under this relation it
//   is provably vacuous — see the file header. What rung 3 buys over rung 2 is
//   a chosen minimum cut rather than a thresholded one, and the threshold is
//   the cheaper thing to be wrong about.
//
// · RUNG 4 (loopy max-product). No convergence guarantee, and its output would
//   be a proposal like every other — so it can only ever compete with rung 5,
//   which always terminates and is the algorithm the search already trusts.
//
// · BUCKET ELIMINATION. `k_c ≤ 4` on 99.9% of team-turns and the whole table is
//   ≤4,096 entries; the message bookkeeping costs more than the table it saves.
//
// · THE CROSS-COMPONENT SURROGATE REPAIR. Vacuous: φ_uv ≡ 0 across components
//   under `influenceOf`, identically. Asserted in the suite.
//
// · ENEMY SLIDERS AS ENUMERATION VARIABLES. Priced by the census at 8^(#sliders)
//   per cluster for a coverage gain the clash-coverage test does not show as
//   needed. They are never elided: every proposal is priced as one whole-board
//   joint resolution, so the adversary's reply is resolved once per world.
