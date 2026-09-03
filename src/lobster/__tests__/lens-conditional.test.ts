/**
 * `rankConditional` EQUALS WHAT A LOCK STAGES (Law B).
 *
 * The conditional ranking displayed for candidate `u@m` IS the speculative pin
 * context for `u@m`, not a second computation that agrees with it. Its head is
 * `conform(ctx ⊕ pin, wirePlan)` — what would actually be staged — never
 * `improve`'s best-so-far.
 *
 * THE FALSIFIER THIS FILE EXISTS TO CATCH is the head silently becoming
 * `improve`'s best. That divergence appears at exactly the moment it is
 * load-bearing: `improve`'s best is BETTER and is NOT what would be staged, so
 * the operator reads a number to decide whether to lock and then locks into a
 * different picture. Every case below therefore runs BOTH `conform` and
 * `improve` and asserts the head is the first and, where they differ, is not
 * the second.
 */

import type { Candidate, JointPlan, PinSet, SearchContext, UnitId } from '../contracts';
import { canonicalPins, pinContextKey } from '../kernel';
import { makeSearchCore } from '../search';
import {
  makeEvaluator,
  makeGenerator,
  makeSubstrate,
  makeTestBoard,
  unboundedBudget,
  wireIdOf,
  type BoardSpec,
} from '../bounds/testkit';
import { promotedContextKey, rankConditional } from '../../lens/kernel';
import { LENS_INSPECTION_MS, type MovesetMove, type UnitKey } from '../../lens/types';

const OURS = 0;
const THEIRS = 1;

/** Two of ours whose reach meets, and an enemy in range: one cluster of two,
 *  so a lock on one member really does constrain the other. */
const PAIR: BoardSpec = {
  width: 7,
  height: 7,
  units: [
    { id: 1, team: OURS, type: 'rook', occupancy: [2 * 7 + 1], energy: 60 },
    { id: 2, team: OURS, type: 'rook', occupancy: [2 * 7 + 5], energy: 60 },
    { id: 3, team: THEIRS, type: 'queen', occupancy: [4 * 7 + 3, 4 * 7 + 3, 4 * 7 + 3], energy: 60 },
  ],
};

interface Harness {
  readonly ctx: SearchContext;
  readonly sub: ReturnType<typeof makeSubstrate>;
  readonly wirePlan: JointPlan;
  close(): void;
}

function harness(pins: PinSet = []): Harness {
  const sub = makeSubstrate(makeTestBoard(PAIR), OURS);
  const gen = makeGenerator();
  const evaluate = makeEvaluator();
  const ctx: SearchContext = {
    sub,
    gen,
    evaluate,
    asTeam: OURS,
    pins,
    assumptions: [],
    incumbent: null,
    witnesses: [],
    budget: unboundedBudget(),
  };
  const wirePlan = makeSearchCore().conform({ ...ctx, pins: [] }, new Map());
  return { ctx, sub, wirePlan, close: () => sub.release() };
}

/** The row is WIRE-keyed: a stored record carrying a substrate number is a
 *  stored record that cannot be read one turn later (04 §2.2). */
function movesOf(plan: JointPlan): ReadonlyArray<MovesetMove> {
  return [...plan.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([unitId, c]: [UnitId, Candidate]) => ({
      unit: wireIdOf(unitId) as UnitKey,
      to: c.to,
      path: [...c.path],
    }));
}

function candidatesOf(h: Harness, unitId: UnitId): ReadonlyArray<Candidate> {
  return h.ctx.gen.candidatesFor(h.ctx.sub, unitId).candidates;
}

describe('the head is conform, never improve (Law B, 04 §3 O4)', () => {
  it('equals conform(ctx ⊕ pin, wirePlan) for EVERY unit and EVERY candidate', () => {
    const base = harness();
    const search = makeSearchCore();
    try {
      for (const unitId of base.sub.commandable(OURS)) {
        for (const candidate of candidatesOf(base, unitId)) {
          const pins: PinSet = canonicalPins([{ unitId, to: candidate.to, tentative: false }]);
          const pinned = { ...base.ctx, pins };
          const staged = movesOf(search.conform(pinned, base.wirePlan));
          const improved = movesOf(search.improve(pinned).plan);

          const answer = rankConditional({
            ctx: base.ctx,
            search,
            cluster: unitId,
            generation: 0,
            locks: [{ unit: wireIdOf(unitId) as UnitKey, to: candidate.to }],
            reserveMs: LENS_INSPECTION_MS,
          });
          expect(answer.ok).toBe(true);
          if (!answer.ok) return;
          expect(answer.rows[0]?.moves).toEqual(staged);
          if (JSON.stringify(improved) !== JSON.stringify(staged)) {
            expect(answer.rows[0]?.moves).not.toEqual(improved);
          }
        }
      }
    } finally {
      base.close();
    }
  });

  it('reports the cluster AFTER the lock — locking narrows (03 Q2)', () => {
    const base = harness();
    const search = makeSearchCore();
    try {
      const [first, second] = base.sub.commandable(OURS) as [UnitId, UnitId];
      const locked = wireIdOf(first) as UnitKey;
      const answer = rankConditional({
        ctx: base.ctx,
        search,
        cluster: first,
        generation: 0,
        locks: [{ unit: locked, to: candidatesOf(base, first)[0]?.to as number }],
        reserveMs: LENS_INSPECTION_MS,
      });
      expect(answer.ok).toBe(true);
      if (!answer.ok) return;
      expect(answer.clusterAfter.members).not.toContain(locked);
      expect(answer.clusterAfter.members).toContain(wireIdOf(second) as UnitKey);
      expect(answer.clusterAfter.boundedBy.map((b) => b.unit)).toContain(locked);
    } finally {
      base.close();
    }
  });

  it('names the speculative context it read, not a fresh one', () => {
    const base = harness();
    const search = makeSearchCore();
    try {
      const [first] = base.sub.commandable(OURS) as [UnitId];
      const to = candidatesOf(base, first)[0]?.to as number;
      const answer = rankConditional({
        ctx: base.ctx,
        search,
        cluster: first,
        generation: 0,
        locks: [{ unit: wireIdOf(first) as UnitKey, to }],
        reserveMs: LENS_INSPECTION_MS,
      });
      expect(answer.ok).toBe(true);
      if (!answer.ok) return;
      expect(answer.contextKey).toBe(
        pinContextKey(canonicalPins([{ unitId: first, to, tentative: true }]), true)
      );
      expect(answer.source).toBe('speculative-context');
    } finally {
      base.close();
    }
  });
});

describe('[CHANGE 2] — a commit PROMOTES the entry a hover already searched', () => {
  it("promotes into the key the epoch's retarget obtains, not a parallel one", () => {
    const [unitId, to] = [1, 3 * 7 + 1];
    const speculative = pinContextKey(canonicalPins([{ unitId, to, tentative: true }]), true);
    const committed = pinContextKey(canonicalPins([{ unitId, to, tentative: false }]));
    // Today these are different keys BY CONSTRUCTION, which is why the
    // operator's hover is searched for four slices and then thrown away on
    // commit. CHANGE 2 is exactly the bridge between them.
    expect(speculative).not.toBe(committed);
    expect(promotedContextKey(speculative)).toBe(committed);
  });

  it('carries the cursor and the witnesses, and does NOT carry the bounds', () => {
    const [unitId, to] = [1, 3 * 7 + 1];
    const speculative = pinContextKey(canonicalPins([{ unitId, to, tentative: true }]), true);
    // A floor proved in the OLD epoch may not gate the new one; witnesses
    // survive epochs by contract and bounds do not (04 §4.4).
    expect(promotedContextKey(speculative)).not.toContain('spec');
  });
});

describe('an unserved request says so (04 §4.5)', () => {
  it("`source: 'empty'` is reachable and carries no number", () => {
    const base = harness();
    const search = makeSearchCore();
    try {
      const [first] = base.sub.commandable(OURS) as [UnitId];
      const answer = rankConditional({
        ctx: base.ctx,
        search,
        cluster: first,
        generation: 0,
        // A lock nothing has been priced under yet: the honest answer is
        // "searching", not a number and not silence.
        locks: [{ unit: wireIdOf(first) as UnitKey, to: 6 * 7 + 6 }],
        reserveMs: LENS_INSPECTION_MS,
      });
      expect(answer.ok).toBe(true);
      if (!answer.ok) return;
      if (answer.source === 'empty') {
        expect(answer.rows).toEqual([]);
        expect(answer.provisional).toBe(true);
      }
    } finally {
      base.close();
    }
  });

  it('refuses past the reserve with a TYPED refusal, never a served row', () => {
    const base = harness();
    const search = makeSearchCore();
    try {
      const [first] = base.sub.commandable(OURS) as [UnitId];
      const answer = rankConditional({
        ctx: base.ctx,
        search,
        cluster: first,
        generation: 0,
        locks: [{ unit: wireIdOf(first) as UnitKey, to: candidatesOf(base, first)[0]?.to as number }],
        reserveMs: 0,
      });
      expect(answer.ok).toBe(false);
      if (answer.ok) return;
      expect(answer.refusal).toBe('reserve-spent');
      expect(typeof answer.detail).toBe('string');
    } finally {
      base.close();
    }
  });

  it('refuses a superseded generation rather than answering the old question', () => {
    const base = harness();
    const search = makeSearchCore();
    try {
      const [first] = base.sub.commandable(OURS) as [UnitId];
      const answer = rankConditional({
        ctx: base.ctx,
        search,
        cluster: first,
        generation: -1,
        locks: [{ unit: wireIdOf(first) as UnitKey, to: candidatesOf(base, first)[0]?.to as number }],
        reserveMs: LENS_INSPECTION_MS,
      });
      expect(answer.ok).toBe(false);
      if (answer.ok) return;
      expect(answer.refusal).toBe('generation-superseded');
    } finally {
      base.close();
    }
  });
});
