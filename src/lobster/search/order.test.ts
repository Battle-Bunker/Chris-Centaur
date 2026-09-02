/**
 * The orderings, on their own.
 *
 * Nothing here may change WHICH plan wins — these are sweep orders and
 * indifferent tie-breaks. They are tested separately precisely so that a
 * regression in ordering shows up as an ordering failure rather than as a
 * mysterious quality drift in the search.
 */

import type { Candidate, JointPlan, Substrate, UnitId } from '../contracts';
import {
  makeGenerator,
  makeSubstrate,
  makeTestBoard,
  type BoardSpec,
} from '../bounds/testkit';
import { contestedUnits, dangerOrder, deadIn, involvedIn, planTieKey, selfInflictedPairs, tieKey, topCandidates } from './index';

const OURS = 0;
const THEIRS = 1;

/** Two of ours aimed at one cell: a self-inflicted casualty by construction. */
const COLLIDE: BoardSpec = {
  width: 7,
  height: 7,
  units: [
    { id: 1, team: OURS, type: 'king', occupancy: [3 * 7 + 2], energy: 60 },
    { id: 2, team: OURS, type: 'king', occupancy: [3 * 7 + 4], energy: 60 },
    { id: 3, team: THEIRS, type: 'king', occupancy: [1 * 7 + 1], energy: 60 },
  ],
};

function collisionWorld(): {
  sub: ReturnType<typeof makeSubstrate>;
  resolution: ReturnType<ReturnType<typeof makeSubstrate>['resolveBoundedFor']>['resolution'];
  plan: JointPlan;
  close(): void;
} {
  const board = makeTestBoard(COLLIDE);
  const sub = makeSubstrate(board, OURS);
  const gen = makeGenerator();
  const meet = 3 * 7 + 3;
  const pick = (unitId: UnitId): Candidate =>
    gen.candidatesFor(sub, unitId).candidates.find((c) => c.to === meet) as Candidate;
  const plan: JointPlan = new Map([
    [1 as UnitId, pick(1 as UnitId)],
    [2 as UnitId, pick(2 as UnitId)],
  ]);
  return {
    sub,
    resolution: sub.resolveBoundedFor(plan, OURS).resolution,
    plan,
    close: () => sub.release(),
  };
}

/** A substrate for the calls that never touch one — the null-resolution arms. */
const stubSub = (): Substrate =>
  ({ unitIdOf: () => undefined }) as unknown as Substrate;

describe('the salt', () => {
  test('it is deterministic, and different salts disagree', () => {
    expect(tieKey('a>1#2', 7)).toBe(tieKey('a>1#2', 7));
    expect(tieKey('a>1#2', 7)).not.toBe(tieKey('a>1#2', 8));
  });

  test('a plan tie key is order-free over the units', () => {
    const a: Candidate = { unitId: 1, from: -1, to: 5, path: [4, 5] };
    const b: Candidate = { unitId: 2, from: -1, to: 9, path: [9] };
    const forward: JointPlan = new Map([
      [1 as UnitId, a],
      [2 as UnitId, b],
    ]);
    const backward: JointPlan = new Map([
      [2 as UnitId, b],
      [1 as UnitId, a],
    ]);
    expect(planTieKey(forward, 3)).toBe(planTieKey(backward, 3));
  });

  test('two candidates with the same destination and different paths are different moves', () => {
    // PATH IDENTITY: a rook that stopped short because a capture halted it took
    // a different move, and the resolver adjudicates the prefix.
    const short: JointPlan = new Map([[1 as UnitId, { unitId: 1, from: -1, to: 5, path: [5] }]]);
    const long: JointPlan = new Map([[1 as UnitId, { unitId: 1, from: -1, to: 5, path: [3, 4, 5] }]]);
    expect(planTieKey(short, 0)).not.toBe(planTieKey(long, 0));
  });
});

describe('self-inflicted pairs', () => {
  test('the resolver names them, and only ours count', () => {
    const world = collisionWorld();
    try {
      const ours = new Set<UnitId>([1, 2]);
      const pairs = selfInflictedPairs(world.sub, world.resolution, ours, world.plan);
      expect(pairs.length).toBeGreaterThan(0);
      for (const [a, b] of pairs) {
        expect(ours.has(a)).toBe(true);
        expect(ours.has(b)).toBe(true);
        expect(a).not.toBe(b);
      }
      // Deduplicated: the 2-opt runs over accidents, not over orderings of them.
      const keys = pairs.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`));
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      world.close();
    }
  });

  test('an enemy killing one of ours is NOT a self-inflicted pair', () => {
    const world = collisionWorld();
    try {
      // Pretend only unit 1 is ours: the pair now has fewer than two of ours in
      // it, so there is nothing for a 2-opt to repair.
      expect(selfInflictedPairs(world.sub, world.resolution, new Set<UnitId>([1]), world.plan)).toEqual([]);
    } finally {
      world.close();
    }
  });
});

describe('danger order', () => {
  test('the dead go first, then the merely involved, then by id', () => {
    const world = collisionWorld();
    try {
      const dead = deadIn(world.sub, world.resolution);
      expect(dead.size).toBeGreaterThan(0);
      const order = dangerOrder(world.sub, [1, 2], world.resolution, new Set());
      expect(order.length).toBe(2);
      const rank = (id: UnitId): number =>
        dead.has(id) ? 0 : involvedIn(world.sub, world.resolution).has(id) ? 1 : 2;
      expect(rank(order[0] as UnitId)).toBeLessThanOrEqual(rank(order[1] as UnitId));
    } finally {
      world.close();
    }
  });

  test('a PINNED unit is not in the sweep at all', () => {
    const world = collisionWorld();
    try {
      expect(dangerOrder(world.sub, [1, 2], world.resolution, new Set([1 as UnitId]))).toEqual([2]);
    } finally {
      world.close();
    }
  });

  test('with no resolution it is still total and deterministic', () => {
    expect(dangerOrder(stubSub(), [3, 1, 2], null, new Set())).toEqual([1, 2, 3]);
  });
});

describe('contested units — the joint-polish selection', () => {
  test('units the resolver keeps naming come first, capped', () => {
    const world = collisionWorld();
    try {
      const picked = contestedUnits(world.sub, [1, 2], world.resolution, new Set(), 1);
      expect(picked.length).toBe(1);
      expect([1, 2]).toContain(picked[0]);
      expect(contestedUnits(world.sub, [1, 2], world.resolution, new Set([1, 2]), 3)).toEqual([]);
      expect(contestedUnits(stubSub(), [1, 2], null, new Set(), 3)).toEqual([]);
    } finally {
      world.close();
    }
  });
});

describe('candidate capping is a MAX-side restriction', () => {
  test('it takes a prefix of an already-ordered list and never reorders it', () => {
    const list: Candidate[] = [1, 2, 3, 4].map((to) => ({ unitId: 1, from: -1, to, path: [to] }));
    expect(topCandidates(list, 2)).toEqual(list.slice(0, 2));
    expect(topCandidates(list, 99)).toBe(list);
  });
});
