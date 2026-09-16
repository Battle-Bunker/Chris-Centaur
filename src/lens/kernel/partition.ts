/**
 * THE PARTITIONER — a cluster is a connected component of the occupancy-reach
 * graph over the units the bot may still move, and nothing else.
 *
 *     u ~ v   iff   influenceOf(u) ∩ influenceOf(v) ≠ ∅
 *
 * over `freeSet` = `commandable(asTeam)` minus reference-fixed, honourably
 * pinned and committed units (03 §1.2, 04 §2.1). NO SLIDER FIAT: the lookahead
 * branch's `cluster-partition.ts` augments every component with every
 * commandable slider, which makes one component of the board and turns the
 * operator's "the pieces near my queen" into "all of them" (T2). Where a
 * slider genuinely couples two groups its ray IS an occupancy-reach set
 * spanning both, so the geometry already has the coupling; what the fiat adds
 * over the geometry is coupling the geometry says is not there.
 *
 * THE EDGES ARE A FUNCTION OF THE BOARD ALONE — `influenceOf` reads positions
 * and grammar, never a plan — so they are built once per call from an inverted
 * cell → units index, at `O(Σ_u |influenceOf(u)|)` inserts and NO evaluation.
 * Only the vertex set moves, and it moves only on a constraint epoch.
 *
 * NOTHING HERE IS CACHED ACROSS A DETERMINATION (03 §7.7 (i)): a catch-up
 * replaces a premise rather than refining it, and a partition carried over one
 * would be a partition of a board that never existed.
 */

import type { Posture, Substrate, UnitId } from '../../lobster/contracts';
import type { BasisKey } from '../../lobster/bounds';
import type {
  BoundedUnit,
  CellIndex,
  ClusterEvent,
  ClusterId,
  ClusterView,
  FixityReason,
  OperatorId,
  UnitKey,
} from '../types';
import { unitKeyOf } from './keys';

/** A determination, with the operator who made it. */
export interface FixedUnit {
  readonly unit: UnitKey;
  readonly to: CellIndex;
  readonly by: OperatorId | null;
}

/**
 * Everything the partitioner reads. The vertex set is
 * `sub.commandable(asTeam)` minus reference-fixed, honourably-pinned and
 * committed units — and NOT minus `unreachablePins`, which are still searched
 * and are therefore still vertices (03 §1.2).
 */
export interface PartitionInput {
  readonly sub: Substrate;
  readonly asTeam: number;
  readonly epoch: number;
  readonly posture: Posture;
  readonly basis: BasisKey;
  readonly pins: ReadonlyArray<FixedUnit>;
  readonly committed: ReadonlyArray<FixedUnit>;
  readonly references: ReadonlyArray<FixedUnit>;
  /** A committed pin naming a cell the grammar cannot reach: a MEMBER, whose
   *  row says the operator asked for a cell this unit cannot reach. */
  readonly unreachablePins: ReadonlyArray<FixedUnit>;
  /** The previous partition, for `lineage` and the derived `ClusterEvent`s. */
  readonly previous?: ReadonlyArray<ClusterView>;
}

interface Fixity {
  readonly unitId: UnitId;
  readonly bound: BoundedUnit;
  /** Excluded from the vertex set. False for `pin-unreachable`. */
  readonly excludes: boolean;
}

function fixities(input: PartitionInput): ReadonlyArray<Fixity> {
  const out: Fixity[] = [];
  const add = (list: ReadonlyArray<FixedUnit>, why: FixityReason, excludes: boolean): void => {
    for (const f of list) {
      const unitId = input.sub.unitIdOf(f.unit);
      if (unitId === undefined) continue;
      out.push({
        unitId,
        bound: { unit: f.unit, to: f.to, why, by: f.by },
        excludes,
      });
    }
  };
  // Order matters only for the strip a consumer draws; the exclusion set is a
  // set. A unit named twice keeps its FIRST reason, which is the strongest:
  // a commit is permanent for the turn and a pin is not.
  add(input.committed, 'commit', true);
  add(input.pins, 'pin', true);
  add(input.references, 'reference', true);
  add(input.unreachablePins, 'pin-unreachable', false);
  const seen = new Set<UnitId>();
  return out.filter((f) => {
    if (seen.has(f.unitId)) return false;
    seen.add(f.unitId);
    return true;
  });
}

/** Units this decision may still move: the cluster graph's vertex set. */
export function freeSetOf(input: PartitionInput): ReadonlySet<UnitId> {
  const fixed = new Set<UnitId>();
  for (const f of fixities(input)) if (f.excludes) fixed.add(f.unitId);
  const free = new Set<UnitId>();
  for (const unitId of input.sub.commandable(input.asTeam)) {
    if (!fixed.has(unitId)) free.add(unitId);
  }
  return free;
}

/**
 * Connected components of the occupancy-reach graph over `vertices`, as sorted
 * arrays of unit ids, themselves sorted by anchor. Union-find over ≤ 26
 * vertices: not a line item against one `price()`.
 */
function componentsOf(sub: Substrate, vertices: ReadonlyArray<UnitId>): ReadonlyArray<UnitId[]> {
  const parent = vertices.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] as number;
    let walk = i;
    while (parent[walk] !== root) {
      const next = parent[walk] as number;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  // The inverted index: one pass over every unit's reach, and a union with the
  // first unit already claiming each cell. Two units meet iff they share a
  // cell, so unioning each arrival with the cell's first claimant produces the
  // same components as the pairwise intersection, at a fraction of the cost.
  const owner = new Map<CellIndex, number>();
  vertices.forEach((unitId, i) => {
    for (const cell of sub.influenceOf(unitId)) {
      const first = owner.get(cell);
      if (first === undefined) owner.set(cell, i);
      else union(i, first);
    }
  });
  const groups = new Map<number, UnitId[]>();
  vertices.forEach((unitId, i) => {
    const root = find(i);
    const bucket = groups.get(root) ?? [];
    bucket.push(unitId);
    groups.set(root, bucket);
  });
  return [...groups.values()]
    .map((g) => [...g].sort((a, b) => a - b))
    .sort((a, b) => (a[0] as number) - (b[0] as number));
}

/** `c:[A-A,A-B]@e2/SIGHTED` — sorted members plus the basis. A CONTENT HASH:
 *  what a consumer VALIDATES a retained moveset against before reusing it. */
function contentKey(members: ReadonlyArray<UnitKey>, epoch: number, posture: Posture): string {
  return `c:[${members.join(',')}]@e${epoch}/${posture}`;
}

/**
 * The partition, as `ClusterView`s: the anchor (a NAME — the smallest member
 * id, which survives a non-anchor member arriving or leaving), the content key
 * (a HASH), and the lineage that makes a merge and a split legible.
 */
export function partitionOf(input: PartitionInput): ReadonlyArray<ClusterView> {
  const free = freeSetOf(input);
  const vertices = [...free].sort((a, b) => a - b);
  const components = componentsOf(input.sub, vertices);
  const fixed = fixities(input);

  // EVERY CLUSTER CARRIES THE WHOLE FIXITY CONTEXT, and that is a departure
  // from 03 §1.5's "whose influence meets a member's" made on purpose. A
  // commit in the far corner meets nothing, and under the influence filter it
  // would appear in no strip at all — which is precisely the case Law F exists
  // to prevent ("it is drawn, it is named in the basis, and it is listed in
  // the cluster's boundedBy strip with its reason"). A strip that silently
  // drops a determination is worse than one that shows a distant one; the UI
  // may filter by influence, because it can also draw the geometry.
  const boundedBy: ReadonlyArray<BoundedUnit> = fixed.map((f) => f.bound);

  // THE PARENTS. With a previous partition the lineage is the previous
  // clusters this one shares members with. WITHOUT one — the first partition
  // of a decision — the parent is the component this cluster would sit in if
  // nothing were fixed, which is what makes "you pinned the rook; the king's
  // cluster split in two" legible on the very first frame of a decision that
  // STARTED with pins. With nothing fixed and no previous there is no parent,
  // and the lineage is empty exactly as 03 §1.5 says.
  const parentOf = ((): ((members: ReadonlyArray<UnitId>) => ReadonlyArray<ClusterId>) => {
    const previous = input.previous;
    if (previous !== undefined) {
      const byMember = new Map<UnitKey, ClusterId>();
      for (const c of previous) for (const m of c.members) byMember.set(m, c.id);
      return (members) => {
        const ids = new Set<ClusterId>();
        for (const unitId of members) {
          const parent = byMember.get(unitKeyOf(input.sub, unitId));
          if (parent !== undefined) ids.add(parent);
        }
        return [...ids].sort((a, b) => a - b);
      };
    }
    if (fixed.length === 0) return () => [];
    const unfixed = componentsOf(
      input.sub,
      [...new Set([...vertices, ...fixed.map((f) => f.unitId)])].sort((a, b) => a - b)
    );
    const anchorOf = new Map<UnitId, ClusterId>();
    for (const group of unfixed) {
      const anchor = group[0] as ClusterId;
      for (const unitId of group) anchorOf.set(unitId, anchor);
    }
    return (members) => {
      const ids = new Set<ClusterId>();
      for (const unitId of members) {
        const parent = anchorOf.get(unitId);
        if (parent !== undefined) ids.add(parent);
      }
      return [...ids].sort((a, b) => a - b);
    };
  })();

  const generations = new Map<ClusterId, { readonly generation: number; readonly members: string }>();
  for (const c of input.previous ?? []) {
    generations.set(c.id, { generation: c.generation, members: [...c.members].join(',') });
  }

  return components.map((group): ClusterView => {
    const members = group.map((unitId) => unitKeyOf(input.sub, unitId));
    const lineage = parentOf(group);
    // GENERATION BUMPS ON A MEMBERSHIP CHANGE, AND ONLY THEN. A generation is
    // what Law E's fiber is keyed on, so a partition recomputed over an
    // unchanged board must not supersede the rows the operator is reading.
    const joined = members.join(',');
    let generation = 0;
    let changed = lineage.length === 0 ? input.previous !== undefined : false;
    for (const parent of lineage) {
      const prior = generations.get(parent);
      if (prior === undefined) continue;
      generation = Math.max(generation, prior.generation);
      if (prior.members !== joined) changed = true;
    }
    if (lineage.length > 1) changed = true;
    return {
      id: group[0] as ClusterId,
      key: contentKey(members, input.epoch, input.posture),
      generation: changed ? generation + 1 : generation,
      members,
      boundedBy,
      lineage,
      epoch: input.epoch,
      posture: input.posture,
      basis: input.basis,
    };
  });
}

/**
 * The four cluster events, DERIVED by diffing successive partitions and never
 * asserted. A consumer that ignores them still lands in the right state — they
 * are for animation and for the sentence "you pinned the rook; the king's
 * cluster split in two", not for the fold.
 */
export function diffPartitions(
  before: ReadonlyArray<ClusterView>,
  after: ReadonlyArray<ClusterView>
): ReadonlyArray<ClusterEvent> {
  const beforeOf = new Map<UnitKey, ClusterView>();
  for (const c of before) for (const m of c.members) beforeOf.set(m, c);
  const afterOf = new Map<UnitKey, ClusterView>();
  for (const c of after) for (const m of c.members) afterOf.set(m, c);

  const parents = new Map<ClusterId, ClusterId[]>();
  for (const c of after) {
    const ids = new Set<ClusterId>();
    for (const m of c.members) {
      const parent = beforeOf.get(m);
      if (parent !== undefined) ids.add(parent.id);
    }
    parents.set(c.id, [...ids].sort((a, b) => a - b));
  }
  const children = new Map<ClusterId, ClusterId[]>();
  for (const c of before) {
    const ids = new Set<ClusterId>();
    for (const m of c.members) {
      const child = afterOf.get(m);
      if (child !== undefined) ids.add(child.id);
    }
    children.set(c.id, [...ids].sort((a, b) => a - b));
  }

  const splits: ClusterEvent[] = [];
  const merges: ClusterEvent[] = [];
  const narrowed: ClusterEvent[] = [];
  const widened: ClusterEvent[] = [];

  for (const c of before) {
    const to = children.get(c.id) as ClusterId[];
    if (to.length > 1) splits.push({ kind: 'split', from: c.id, to });
  }
  for (const c of after) {
    const from = parents.get(c.id) as ClusterId[];
    if (from.length > 1) merges.push({ kind: 'merge', from, to: c.id });
  }
  for (const c of after) {
    const from = parents.get(c.id) as ClusterId[];
    if (from.length !== 1) continue;
    const parent = before.find((p) => p.id === from[0]) as ClusterView;
    if ((children.get(parent.id) as ClusterId[]).length > 1) continue; // a split, above
    const held = new Set(c.members);
    const lost = parent.members.filter((m) => !held.has(m));
    const had = new Set(parent.members);
    const gained = c.members.filter((m) => !had.has(m));
    // The id a narrowing carries is the cluster the operator was LOOKING at —
    // the one before the member left — because an anchor that was pinned takes
    // its name with it and the row on screen is named by the old one.
    if (lost.length > 0) narrowed.push({ kind: 'narrowed', id: parent.id, lost });
    if (gained.length > 0) widened.push({ kind: 'widened', id: c.id, gained });
  }
  // A cluster whose every member was fixed leaves no child at all: it narrowed
  // to nothing, and saying nothing about it would lose the operator's own act.
  for (const c of before) {
    if ((children.get(c.id) as ClusterId[]).length === 0) {
      narrowed.push({ kind: 'narrowed', id: c.id, lost: c.members });
    }
  }
  return [...splits, ...merges, ...narrowed, ...widened];
}
