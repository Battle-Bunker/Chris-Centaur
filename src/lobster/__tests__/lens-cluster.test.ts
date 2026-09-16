/**
 * THE CLUSTER LAW.
 *
 * A cluster is a connected component of the occupancy-reach graph over
 * `freeSet` — `u ~ v iff influenceOf(u) ∩ influenceOf(v) ≠ ∅` — and nothing
 * else (04 §2.1, 03 §1.2). Everything below is a predicate on the REAL
 * `Substrate.influenceOf` over boards built by `local-game.ts`'s own
 * `UnitSpec` helpers, because a partition asserted against a hand-drawn
 * picture of the geometry is a partition that will disagree with the search.
 *
 * THE THREE FALSIFIERS THIS FILE EXISTS TO CATCH:
 *
 *   · a slider fiat creeping back in. `cluster-partition.ts` on the lookahead
 *     branch augments every component with every commandable slider, which
 *     makes one component of the board and turns the operator's "the pieces
 *     near my queen" into "all of them" (T2). `TWO_ISLANDS` must stay two
 *     clusters and `COUPLED_BY_RAY` must be one BECAUSE OF THE RAY — the
 *     geometry, not a rule about sliders.
 *   · a pinned unit surviving as a member. Law F: a unit the bot cannot move
 *     is drawn, is named in the basis, and is NOT a member. If the panel shows
 *     a unit as a member, the bot is still choosing its move, full stop.
 *   · overlapping clusters. Components of one graph partition the vertex set
 *     (04 §3 Q3), so `\`-cycling between a unit's clusters is unrepresentable
 *     and T5 is deleted.
 */

import {
  diffPartitions,
  freeSetOf,
  partitionOf,
  type FixedUnit,
  type PartitionInput,
} from '../../lens/kernel';
import type { ClusterView, UnitKey } from '../../lens/types';
import {
  COUPLED_BY_RAY,
  FOG_SPAN,
  FOG_SUBJECT_STALENESS,
  OURS,
  SINGLETONS,
  THEIRS,
  TWO_ISLANDS,
  substrateOf,
  unitKeysOf,
} from '../../tests/lens-fixtures';
import type { EngineSubstrate } from '../substrate';
import { clearGeometryCache } from '../substrate';
import type { GameSpec } from '../../tests/local-game';

const NO_FIXITY = {
  pins: [] as ReadonlyArray<FixedUnit>,
  committed: [] as ReadonlyArray<FixedUnit>,
  references: [] as ReadonlyArray<FixedUnit>,
  unreachablePins: [] as ReadonlyArray<FixedUnit>,
};

function inputFor(sub: EngineSubstrate, over: Partial<PartitionInput> = {}): PartitionInput {
  return {
    sub,
    asTeam: sub.teamNumber(OURS),
    epoch: 0,
    posture: 'SIGHTED',
    basis: 'basis:[]',
    ...NO_FIXITY,
    ...over,
  };
}

/** The law itself, computed here from the real substrate so the assertion is
 *  a statement about the graph rather than a restatement of the code. */
function componentsByGeometry(
  sub: EngineSubstrate,
  free: ReadonlyArray<UnitKey>
): ReadonlyArray<ReadonlyArray<UnitKey>> {
  const ids = free.map((k) => sub.unitIdOf(k) as number);
  const reach = ids.map((id) => sub.influenceOf(id));
  const parent = ids.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      let meets = false;
      for (const cell of reach[i] as ReadonlySet<number>) {
        if ((reach[j] as ReadonlySet<number>).has(cell)) {
          meets = true;
          break;
        }
      }
      if (meets) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, UnitKey[]>();
  free.forEach((key, i) => {
    const root = find(i);
    const bucket = groups.get(root) ?? [];
    bucket.push(key);
    groups.set(root, bucket);
  });
  return [...groups.values()].map((g) => [...g].sort());
}

function memberSets(clusters: ReadonlyArray<ClusterView>): ReadonlyArray<ReadonlyArray<UnitKey>> {
  return clusters.map((c) => [...c.members].sort()).sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
}

let open: EngineSubstrate[] = [];

function sub(spec: GameSpec, opts: Parameters<typeof substrateOf>[1] = {}): EngineSubstrate {
  const s = substrateOf(spec, opts);
  open.push(s);
  return s;
}

afterEach(() => {
  for (const s of open) s.release();
  open = [];
  clearGeometryCache();
});

describe('the partition is the plain connected component', () => {
  it('splits two islands the geometry does not connect', () => {
    const s = sub(TWO_ISLANDS);
    const keys = unitKeysOf(TWO_ISLANDS);
    const clusters = partitionOf(inputFor(s));
    expect(memberSets(clusters)).toEqual(componentsByGeometry(s, keys));
    expect(clusters).toHaveLength(2);
  });

  it('merges across a slider RAY, because the ray is an occupancy-reach set', () => {
    const s = sub(COUPLED_BY_RAY);
    const keys = unitKeysOf(COUPLED_BY_RAY);
    const clusters = partitionOf(inputFor(s));
    expect(memberSets(clusters)).toEqual([[...keys].sort()]);
  });

  it('pinning the slider SPLITS the component the ray was holding open', () => {
    const s = sub(COUPLED_BY_RAY);
    const [left, slider, right] = unitKeysOf(COUPLED_BY_RAY) as [UnitKey, UnitKey, UnitKey];
    const clusters = partitionOf(
      inputFor(s, { pins: [{ unit: slider, to: 7 * 15 + 7, by: 'ada' }] })
    );
    expect(memberSets(clusters)).toEqual([[left], [right]]);
    // The falsifier: under a slider fiat the pinned rook would still couple
    // them, and this would be one cluster of three.
    expect(clusters.every((c) => !c.members.includes(slider))).toBe(true);
  });

  it('leaves three distant snakes as three singletons (T3, the 88.7% case)', () => {
    const s = sub(SINGLETONS);
    expect(partitionOf(inputFor(s))).toHaveLength(3);
  });
});

describe('fixity excludes, and says why (Law F)', () => {
  it('a pinned unit is absent from members and present in boundedBy as `pin`', () => {
    const s = sub(TWO_ISLANDS);
    const [a] = unitKeysOf(TWO_ISLANDS) as [UnitKey];
    const clusters = partitionOf(inputFor(s, { pins: [{ unit: a, to: 20, by: 'ada' }] }));
    expect(clusters.some((c) => c.members.includes(a))).toBe(false);
    const bound = clusters.flatMap((c) => c.boundedBy).find((b) => b.unit === a);
    expect(bound).toEqual({ unit: a, to: 20, why: 'pin', by: 'ada' });
  });

  it('a committed unit is `commit`, and a reference-fixed one is `reference`', () => {
    const s = sub(TWO_ISLANDS);
    const [a, b] = unitKeysOf(TWO_ISLANDS) as [UnitKey, UnitKey];
    const clusters = partitionOf(
      inputFor(s, {
        committed: [{ unit: a, to: 20, by: 'ben' }],
        references: [{ unit: b, to: -1, by: null }],
      })
    );
    const why = new Map(clusters.flatMap((c) => c.boundedBy).map((x) => [x.unit, x.why]));
    expect(why.get(a)).toBe('commit');
    expect(why.get(b)).toBe('reference');
    expect(clusters.some((c) => c.members.includes(a) || c.members.includes(b))).toBe(false);
  });

  it('a pin-unreachable unit IS a member — the operator has not fixed it', () => {
    const s = sub(TWO_ISLANDS);
    const [a] = unitKeysOf(TWO_ISLANDS) as [UnitKey];
    // A cell this unit's grammar cannot reach: `auditPins` refuses the pin, the
    // unit keeps its own choice, and it is still searched.
    const clusters = partitionOf(
      inputFor(s, { unreachablePins: [{ unit: a, to: 14 * 15 + 14, by: 'ada' }] })
    );
    expect(clusters.some((c) => c.members.includes(a))).toBe(true);
    const bound = clusters.flatMap((c) => c.boundedBy).find((x) => x.unit === a);
    expect(bound?.why).toBe('pin-unreachable');
  });

  it('freeSet is exactly commandable minus pinned, committed and reference-fixed', () => {
    const s = sub(TWO_ISLANDS);
    const [a, b, c] = unitKeysOf(TWO_ISLANDS) as [UnitKey, UnitKey, UnitKey];
    const free = freeSetOf(
      inputFor(s, {
        pins: [{ unit: a, to: 20, by: 'ada' }],
        committed: [{ unit: b, to: 21, by: 'ben' }],
        references: [{ unit: c, to: -1, by: null }],
      })
    );
    const commandable = s.commandable(s.teamNumber(OURS));
    expect(free.size).toBe(commandable.length - 3);
    expect(free.has(s.unitIdOf(a) as number)).toBe(false);
  });

  it('never puts an enemy unit in freeSet — foreign is not a fixity we choose', () => {
    const s = sub(TWO_ISLANDS);
    const enemy = unitKeysOf(TWO_ISLANDS, THEIRS)[0] as UnitKey;
    const free = freeSetOf(inputFor(s));
    expect(free.has(s.unitIdOf(enemy) as number)).toBe(false);
  });
});

describe('the components partition (04 §3 Q3)', () => {
  it('are pairwise disjoint and cover freeSet exactly', () => {
    const s = sub(TWO_ISLANDS);
    const free = freeSetOf(inputFor(s));
    const clusters = partitionOf(inputFor(s));
    const seen = new Set<UnitKey>();
    for (const c of clusters) {
      for (const m of c.members) {
        expect(seen.has(m)).toBe(false);
        seen.add(m);
      }
    }
    expect(seen.size).toBe(free.size);
  });

  it('names each cluster by its ANCHOR — the smallest member id, not a joined key', () => {
    const s = sub(TWO_ISLANDS);
    const clusters = partitionOf(inputFor(s));
    for (const c of clusters) {
      const ids = c.members.map((m) => s.unitIdOf(m) as number);
      expect(c.id).toBe(Math.min(...ids));
      // The hash is a SEPARATE field: names find, hashes validate.
      expect(c.key).not.toBe(String(c.id));
    }
  });
});

describe('a lock only narrows and an unlock only widens (Law F, T1)', () => {
  it('pinning any single member never grows a cluster', () => {
    const s = sub(COUPLED_BY_RAY);
    const before = partitionOf(inputFor(s));
    const beforeMax = Math.max(...before.map((c) => c.members.length));
    for (const unit of unitKeysOf(COUPLED_BY_RAY)) {
      const after = partitionOf(inputFor(s, { pins: [{ unit, to: 7 * 15 + 7, by: 'ada' }] }));
      expect(Math.max(...after.map((c) => c.members.length))).toBeLessThanOrEqual(beforeMax);
      expect(after.flatMap((c) => c.members)).not.toContain(unit);
    }
  });

  it('releasing a pin never shrinks a cluster', () => {
    const s = sub(COUPLED_BY_RAY);
    const [, slider] = unitKeysOf(COUPLED_BY_RAY) as [UnitKey, UnitKey];
    const locked = partitionOf(inputFor(s, { pins: [{ unit: slider, to: 7 * 15 + 7, by: 'ada' }] }));
    const released = partitionOf(inputFor(s));
    const total = (cs: ReadonlyArray<ClusterView>): number =>
      cs.reduce((n, c) => n + c.members.length, 0);
    expect(total(released)).toBeGreaterThan(total(locked));
    expect(released.length).toBeLessThan(locked.length);
  });
});

describe('lineage and the derived cluster events', () => {
  it('a merge names BOTH parents; a split names the ONE parent', () => {
    const s = sub(COUPLED_BY_RAY);
    const [, slider] = unitKeysOf(COUPLED_BY_RAY) as [UnitKey, UnitKey];
    const split = partitionOf(inputFor(s, { pins: [{ unit: slider, to: 7 * 15 + 7, by: 'ada' }] }));
    const merged = partitionOf(inputFor(s, { previous: split }));

    const toMerged = diffPartitions(split, merged);
    expect(toMerged).toEqual([
      { kind: 'merge', from: split.map((c) => c.id).sort((a, b) => a - b), to: merged[0]?.id },
    ]);
    expect([...(merged[0] as ClusterView).lineage].sort((a, b) => a - b)).toEqual(
      split.map((c) => c.id).sort((a, b) => a - b)
    );

    const backToSplit = diffPartitions(merged, split);
    expect(backToSplit).toEqual([
      { kind: 'split', from: merged[0]?.id, to: split.map((c) => c.id).sort((a, b) => a - b) },
    ]);
    for (const c of split) expect(c.lineage).toEqual([merged[0]?.id]);
  });

  it('bumps generation on any membership change, and only then', () => {
    const s = sub(TWO_ISLANDS);
    const first = partitionOf(inputFor(s));
    const again = partitionOf(inputFor(s, { previous: first }));
    expect(again.map((c) => c.generation)).toEqual(first.map((c) => c.generation));

    const [a] = unitKeysOf(TWO_ISLANDS) as [UnitKey];
    const narrowed = partitionOf(
      inputFor(s, { previous: first, pins: [{ unit: a, to: 20, by: 'ada' }] })
    );
    const touched = narrowed.find((c) => c.lineage.includes(first[0]?.id as number));
    expect(touched?.generation).toBeGreaterThan(first[0]?.generation as number);
    expect(diffPartitions(first, narrowed)).toEqual([
      { kind: 'narrowed', id: first[0]?.id, lost: [a] },
    ]);
  });
});

/**
 * D-5′ — THE FOG CASE (03 §7.7, 04 §3 O2).
 *
 * Law D2′ says occupancy IS the cloud when a position is uncertain; there is
 * no separate fog clause and therefore no badge to draw — the cluster simply
 * widens. `influenceOf` computes reach from the LAST-SEEN POINT, which
 * under-approximates, and under-approximation misses pair terms: the unsound
 * direction. At `staleness = 0` the two coincide exactly, which is why nothing
 * is wrong today.
 *
 * This case is written NOW, with the falsifier built in, and is un-skipped
 * when the substrate exposes cloud reach. `.failing` is the honest state: the
 * assertion is real and the code does not yet meet it.
 */
describe('D-5′ — a stale subject whose cloud spans two components', () => {
  it.failing('merges the components its cloud spans, with no badge', () => {
    const enemy = unitKeysOf(FOG_SPAN, THEIRS)[0] as UnitKey;
    const s = sub(FOG_SPAN, {
      turn: FOG_SUBJECT_STALENESS + 1,
      observedTurns: new Map([[enemy, 1]]),
    });
    const clusters = partitionOf(inputFor(s));
    // The two pawns are unreachable from each other by POINT reach and joined
    // by CLOUD reach, so exactly one cluster is the law's answer.
    expect(memberSets(clusters)).toEqual([[...unitKeysOf(FOG_SPAN)].sort()]);
    // And `members` stays a list of units: there is no fog member and no badge.
    expect((clusters[0] as ClusterView).members.every((m) => typeof m === 'string')).toBe(true);
  });
});
