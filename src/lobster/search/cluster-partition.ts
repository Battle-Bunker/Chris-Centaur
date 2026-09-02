/**
 * THE CLUSTER PARTITION — the owner's decomposition, built new on `influenceOf`.
 *
 *   cluster(board) : the connected components of the NON-SLIDER interaction
 *                    graph (relation: influenceOf(u) ∩ influenceOf(v) ≠ ∅),
 *                    each component augmented, BY FIAT, with every live slider
 *                    we command.
 *
 * Measured over 563,557 team-turns: components ≤3 on **98.9%**, ≤4 on 99.9%;
 * 88.7% of components are singletons, 9.3% pairs, 1.6% triples. The
 * construction rescues exactly the strata the plain partition fails —
 * n=6-with-slider 16.1% → 96.5% — because the interaction graph is a STAR whose
 * hub is a slider 89.7% of the time. Lifting the hub out of the residual graph
 * and CONDITIONING on it is the same operation as the owner's fiat.
 *
 * ── WHY THIS IS NOT `exact.ts:638 componentsOf` ────────────────────────────
 *
 * The engine already vendors a union-find decomposition, and it is the wrong
 * one for this job in three independent ways: it has no slider fiat and no
 * size-cap policy (this is a per-decision SEARCH policy, not a lossless engine
 * decomposition); its joint branching runs over *frozen* members only, so it
 * decomposes the held side and never our own joint move choice; and it keys on
 * `reachOf`, which for a live unit is its staged path once an order is given —
 * the wrong lifetime for a partition built before any order exists.
 *
 * `componentsOf` is reused as the DIFFERENTIAL CROSS-CHECK instead: a property
 * test asserts this partition is a refinement of it restricted to the
 * non-slider set — the vendored theorem-checker for the home-grown policy. See
 * `cluster-partition.test.ts`.
 *
 * ── WHAT A SLIDER IS HERE, AND WHY THE READING IS PESSIMISTIC ──────────────
 *
 * A kind with rays. Plus — contract rule 25's conservative-fog reading — a kind
 * that PROMOTES to one, which on this board is the pawn. Membership is the
 * never-elided direction: calling a unit a slider makes it a member of every
 * cluster, so a false positive costs arity and can never drop a unit out of a
 * modelled field. A false NEGATIVE would leave a ray-bearing unit inside one
 * component while its ray crosses three others, which is the failure the fiat
 * exists to prevent.
 *
 * ── OUR SLIDERS, NOT ALL SLIDERS ───────────────────────────────────────────
 *
 * The fiat's literal all-sides reading was priced by the census at `8^(#sliders)`
 * per cluster — a 512× multiplier at the slider-board median of 3, p90 1e4 at
 * n=6-with-slider — for a coverage gain the clash-coverage test does not show as
 * needed. So the *variables* here are ours; the enemy's sliders are neither
 * elided nor approximated, they are inside every cluster's modelled field by
 * construction, because every proposal this partition produces is priced as one
 * whole-board joint resolution through the unconditional bank (law CL-22). The
 * adversary's slider reply is resolved once per world, never per cluster.
 *
 * ── NOTHING HERE REMOVES ANYTHING ──────────────────────────────────────────
 *
 * A partition is a way of GENERATING proposals. It writes no ledger entry,
 * returns no candidate set, and touches no bound. Every unit stays in every
 * candidate set, every sweep, and every price.
 */

import { profileOf } from '../../partial-engine/index';
import type { CellIndex, UnitId } from '../contracts';
import type { EngineSubstrate } from '../substrate';

/*
 * `CENTAUR_CLUSTER_ENUM` IS DELETED — TODO(teardown-search) row retired here.
 *
 * The partition and the exact enumeration are KERNEL MACHINERY, not a
 * candidate strategy, and they always run. The switch was also a silent switch
 * on the depth layer — whose threads are rooted at this enumeration's own
 * proposals — which is the dependency class that made one experiment race
 * three identical contenders and file the null against the wrong thing.
 */

// ---------------------------------------------------------------------------
// Sliders
// ---------------------------------------------------------------------------

/**
 * Does this kind carry a ray THIS TURN, or could it be carrying one by the time
 * the fiat's guarantee has to hold?
 *
 * Rays now, or a promotion into rays. The promotion half is contract rule 25's
 * pessimism (`sliderPossible` over `kindSet`, the owner's conservative-fog
 * ruling) applied to our own side, where the kind is known exactly and the only
 * uncertainty is the promotion horizon. It is the cheap, safe direction: it can
 * only ADD a unit to every cluster.
 */
export function sliderKind(kind: number): boolean {
  const profile = profileOf(kind);
  if (profile.rays.length > 0) return true;
  const promoted = profile.promotesTo;
  return promoted !== null && profileOf(promoted).rays.length > 0;
}

// ---------------------------------------------------------------------------
// The partition
// ---------------------------------------------------------------------------

/**
 * One cluster: a component of the residual graph, plus the shared sliders.
 *
 * `members` is the component. `variables` is what the enumerator solves over:
 * `members` ∪ the sliders, sorted, so a joint's coordinates are addressable by
 * position and two runs over the same board produce the same vector.
 */
export interface Cluster {
  readonly id: number;
  /** The non-slider component. Sorted by unit id. */
  readonly members: ReadonlyArray<UnitId>;
  /** The units this cluster solves over: `members` ∪ shared sliders, sorted. */
  readonly variables: ReadonlyArray<UnitId>;
}

export interface Partition {
  /** Components of the non-slider graph, each carrying the sliders. */
  readonly clusters: ReadonlyArray<Cluster>;
  /**
   * Our live sliders — MAX-SIDE VARIABLES SHARED ACROSS CLUSTERS. The slider
   * joint is chosen once per proposed branch (an outer coordinate) and every
   * component is solved CONDITIONAL on it. Condition, never marginalise: that
   * is what keeps two clusters' proposals commensurable.
   */
  readonly sliders: ReadonlyArray<UnitId>;
  /** Every unit the partition treats as a variable, sorted. */
  readonly variables: ReadonlyArray<UnitId>;
  /** Units held out: pinned, referenced, or unknown to the substrate. */
  readonly fixed: ReadonlySet<UnitId>;
  /** The residual-graph adjacency, exposed for the dirty-set and the tests. */
  neighboursOf(unitId: UnitId): ReadonlySet<UnitId>;
  /** Do these two units' influence footprints meet? The relation itself. */
  adjacent(a: UnitId, b: UnitId): boolean;
}

export interface PartitionRequest {
  readonly sub: EngineSubstrate;
  /** Every unit this decision commands. */
  readonly roster: ReadonlyArray<UnitId>;
  /** Units whose choice is already settled — pins and reference actions. */
  readonly fixed: ReadonlySet<UnitId>;
}

/**
 * ONE PASS OVER THE ROSTER, ONE UNION-FIND OVER THE RESIDUAL.
 *
 * `influenceOf` is cached per (substrate, unit) and deliberately
 * over-approximates — the union over the unit's WHOLE option set, which is the
 * safe direction for a partition: a footprint too big merges two components
 * that could have been solved apart (work, never a wrong answer), a footprint
 * too small splits a pair that interacts (a coordinated joint the enumeration
 * would never reach). The census measured this exact relation at 99.88% clash
 * coverage.
 *
 * Cost is `O(k²)` set intersections over the NON-SLIDER units only, and the
 * non-slider set averages 3.5 units pooled and 2.6 on slider-bearing rosters.
 */
export function partitionOf(req: PartitionRequest): Partition {
  const { sub, roster, fixed } = req;

  const free: UnitId[] = [];
  const sliders: UnitId[] = [];
  for (const unitId of [...roster].sort((a, b) => a - b)) {
    if (fixed.has(unitId)) continue;
    const unit = sub.unitOf(unitId);
    // A unit the substrate cannot name is not one this layer can reason about.
    if (unit === undefined) continue;
    if (sliderKind(unit.kind)) sliders.push(unitId);
    else free.push(unitId);
  }

  // The influence footprints, read once each. `influenceOf` caches, but the
  // union-find below asks O(k²) questions and a map lookup beats a cache probe.
  const influence = new Map<UnitId, ReadonlySet<CellIndex>>();
  for (const unitId of free) influence.set(unitId, sub.influenceOf(unitId));

  const n = free.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    // Path compression, one pass.
    let c = i;
    while (parent[c] !== r) {
      const up = parent[c] as number;
      parent[c] = r;
      c = up;
    }
    return r;
  };

  const adjacency = new Map<UnitId, Set<UnitId>>();
  for (const unitId of free) adjacency.set(unitId, new Set<UnitId>());

  for (let i = 0; i < n; i++) {
    const a = influence.get(free[i] as UnitId) as ReadonlySet<CellIndex>;
    for (let j = i + 1; j < n; j++) {
      const b = influence.get(free[j] as UnitId) as ReadonlySet<CellIndex>;
      if (!meets(a, b)) continue;
      (adjacency.get(free[i] as UnitId) as Set<UnitId>).add(free[j] as UnitId);
      (adjacency.get(free[j] as UnitId) as Set<UnitId>).add(free[i] as UnitId);
      const ra = find(i);
      const rb = find(j);
      if (ra !== rb) parent[ra] = rb;
    }
  }

  const byRoot = new Map<number, UnitId[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = byRoot.get(r);
    if (g === undefined) byRoot.set(r, [free[i] as UnitId]);
    else g.push(free[i] as UnitId);
  }

  // Deterministic cluster order: by the component's smallest unit id. Two runs
  // over the same board must produce the same proposal sequence, and the
  // union-find's root ids are an allocation detail.
  const groups = [...byRoot.values()].sort((a, b) => (a[0] as UnitId) - (b[0] as UnitId));

  const clusters: Cluster[] = groups.map((members, id) => ({
    id,
    members,
    variables: [...members, ...sliders].sort((a, b) => a - b),
  }));

  // A board of nothing but sliders has no residual component at all, and the
  // slider joint IS the whole problem. One empty-membered cluster keeps every
  // downstream loop from needing a special case.
  if (clusters.length === 0 && sliders.length > 0) {
    clusters.push({ id: 0, members: [], variables: [...sliders] });
  }

  const variables = [...free, ...sliders].sort((a, b) => a - b);
  const empty: ReadonlySet<UnitId> = new Set<UnitId>();

  return {
    clusters,
    sliders,
    variables,
    fixed,
    neighboursOf: (unitId) => adjacency.get(unitId) ?? empty,
    adjacent: (a, b) => {
      if (a === b) return true;
      // A slider is adjacent to everything by fiat — it is a member of every
      // cluster, so nothing it does is ever independent of anything else.
      const sa = adjacency.has(a);
      const sb = adjacency.has(b);
      if (!sa || !sb) return true;
      return (adjacency.get(a) as Set<UnitId>).has(b);
    },
  };
}

/** Do two cell sets meet? Walks the smaller one. */
function meets(a: ReadonlySet<CellIndex>, b: ReadonlySet<CellIndex>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const cell of small) if (large.has(cell)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// The expansion seam (CL6 drives this; CL3 only has to expose it)
// ---------------------------------------------------------------------------

/**
 * ADD AN OUTSIDER TO A CLUSTER — synthesis §7.2's `expandCluster(thread, u)`,
 * as the shape CL6 will call.
 *
 * Three properties this must have, and they are the reason it lives here rather
 * than being open-coded at the call site when CL6 arrives:
 *
 *  · **MONOTONE ON THE MODELLED SET.** Units are only ever ADDED. Dropping one
 *    would be an elision, and an elision needs the full shell-3 discipline that
 *    contract rule 25 forbids for a slider and rule 24 gates for anything else.
 *    So there is no `contractCluster`, and its absence is a decision.
 *  · **THE ARITY GUARD PRECEDES THE EXPANSION.** The caller is handed the new
 *    variable count before it pays; `expandCluster` refuses (returns the
 *    partition unchanged, and says so) rather than silently building a table
 *    nothing can afford. A snake costs ~×2.5–2.8 post-exclusions.
 *  · **IT RETURNS A NEW PARTITION.** The old one stays valid, because a thread
 *    that has already published a prefix under the old partition must keep
 *    reading the object it published against.
 *
 * The residual adjacency is NOT recomputed: an expansion is a policy decision
 * ("this outsider's citation mass earns a seat"), not a discovery that the
 * relation was wrong. `neighboursOf` therefore keeps reporting the influence
 * graph, and `expanded` records who was added by fiat.
 */
export interface Expansion {
  readonly partition: Partition;
  /** False when the arity guard refused. The partition is then unchanged. */
  readonly applied: boolean;
  /** Variables the target cluster would carry after the expansion. */
  readonly arity: number;
  readonly reason: 'applied' | 'already-member' | 'arity-guard' | 'no-such-cluster';
}

export function expandCluster(
  partition: Partition,
  clusterId: number,
  unitId: UnitId,
  maxVariables: number,
): Expansion {
  const target = partition.clusters.find((c) => c.id === clusterId);
  if (target === undefined) {
    return { partition, applied: false, arity: 0, reason: 'no-such-cluster' };
  }
  if (target.variables.includes(unitId)) {
    return { partition, applied: false, arity: target.variables.length, reason: 'already-member' };
  }
  const arity = target.variables.length + 1;
  if (arity > maxVariables) {
    return { partition, applied: false, arity, reason: 'arity-guard' };
  }
  const grown: Cluster = {
    id: target.id,
    members: [...target.members, unitId].sort((a, b) => a - b),
    variables: [...target.variables, unitId].sort((a, b) => a - b),
  };
  const clusters = partition.clusters.map((c) => (c.id === clusterId ? grown : c));
  const variables = partition.variables.includes(unitId)
    ? partition.variables
    : [...partition.variables, unitId].sort((a, b) => a - b);
  return {
    partition: { ...partition, clusters, variables },
    applied: true,
    arity,
    reason: 'applied',
  };
}

/**
 * MERGE EVERY CLUSTER INTO ONE — what the terminal guard does instead of
 * composing.
 *
 * Refusing composition costs a merged component (one rung down the fallback
 * ladder), never an unsound stage. That asymmetry is the whole reason the guard
 * can be conservative for free.
 */
export function mergeAll(partition: Partition): Partition {
  if (partition.clusters.length <= 1) return partition;
  const members = partition.clusters.flatMap((c) => c.members).sort((a, b) => a - b);
  const merged: Cluster = {
    id: 0,
    members,
    variables: [...members, ...partition.sliders].sort((a, b) => a - b),
  };
  return { ...partition, clusters: [merged] };
}
