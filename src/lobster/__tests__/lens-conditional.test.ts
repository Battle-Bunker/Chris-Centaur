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
import { planPartsOf, promotedContextKey, rankConditional } from '../../lens/kernel';
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

/** A third unit, ISOLATED from PAIR's rook pair — a knight in the far corner,
 *  whose own landing squares fall on neither rook's row nor column, so it is
 *  its own single-member cluster. Locking IT leaves the rook pair's two
 *  candidates — unit ids 3 and 10, chosen for different digit counts — in the
 *  complement together, which is the shape §5.2's two producers disagreed on. */
const PAIR_PLUS_ISOLATED: BoardSpec = {
  width: 9,
  height: 9,
  units: [
    { id: 2, team: OURS, type: 'knight', occupancy: [8 * 9 + 8], energy: 60 },
    { id: 3, team: OURS, type: 'rook', occupancy: [4 * 9 + 1], energy: 60 },
    { id: 10, team: OURS, type: 'rook', occupancy: [4 * 9 + 5], energy: 60 },
    { id: 20, team: THEIRS, type: 'queen', occupancy: [6 * 9 + 3, 6 * 9 + 3, 6 * 9 + 3], energy: 60 },
  ],
};

interface Harness {
  readonly ctx: SearchContext;
  readonly sub: ReturnType<typeof makeSubstrate>;
  readonly wirePlan: JointPlan;
  close(): void;
}

function harnessFor(spec: BoardSpec, pins: PinSet = []): Harness {
  const sub = makeSubstrate(makeTestBoard(spec), OURS);
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

function harness(pins: PinSet = []): Harness {
  return harnessFor(PAIR, pins);
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
      // NOT `canonicalPins` on this side: it filters tentative pins OUT (it is
      // the COMMITTED context's canonicaliser), so wrapping a tentative pin in
      // it asks for `spec:[]` — a key naming no unit, which nothing could
      // produce from a lock on one. The handle the advice layer already grips
      // is `pinContextKey([...committed, lock], true)`, and that is this.
      expect(answer.contextKey).toBe(
        pinContextKey([{ unitId: first, to, tentative: true }], true)
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
    // Tentative pins survive into the SPECULATIVE key and are filtered out of
    // the committed one — which is `canonicalPins`'s whole job — so the two
    // sides of this pair are built differently on purpose.
    const speculative = pinContextKey([{ unitId, to, tentative: true }], true);
    const committed = pinContextKey(canonicalPins([{ unitId, to, tentative: false }]));
    // Today these are different keys BY CONSTRUCTION, which is why the
    // operator's hover is searched for four slices and then thrown away on
    // commit. CHANGE 2 is exactly the bridge between them.
    expect(speculative).not.toBe(committed);
    expect(promotedContextKey(speculative)).toBe(committed);
  });

  it('carries the cursor and the witnesses, and does NOT carry the bounds', () => {
    const [unitId, to] = [1, 3 * 7 + 1];
    // Tentative pins survive into the SPECULATIVE key and are filtered out of
    // the committed one — which is `canonicalPins`'s whole job — so the two
    // sides of this pair are built differently on purpose.
    const speculative = pinContextKey([{ unitId, to, tentative: true }], true);
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

/**
 * §5.2 — THE TWO `complementKey` PRODUCERS SORT DIFFERENTLY (SIMPLIFY-PLAN-2).
 *
 * `Moveset.complementKey` is the second half of the reservoir's grouping key
 * (Law E, `reservoir.ts:143`'s `keyOf(cluster, complementKey)`): two spellings
 * of one complement are two groups. `lobster/kernel.ts`'s `cutPlan`
 * (2546-2557, the reservoir's actual producer, out of this change's reach —
 * owned elsewhere in this pass) sorts a plan's parts LEXICOGRAPHICALLY once
 * and splits that sorted list per cluster, so a cluster's `key` and
 * `complementKey` are always two contiguous slices of ONE sorted list.
 * `conditional.ts`'s `complementKey` used to sort by `unitId` instead — a
 * different order whenever the plan spans unit ids of different digit counts
 * (unit 2 and unit 10: lexicographic gives `10…|2…`, numeric gives `2…|10…`)
 * — disagreeing with `cutPlan`, and with its OWN `key`/`witness` in the same
 * row, on one field of three.
 *
 * The fix folds `complementKey` and `witness` into one producer,
 * `planPartsOf`, sorted the way `cutPlan` already sorts. The two tests below
 * are the two halves of that claim: the sort order itself, and — on a real
 * fixture board, for every cluster it has — that `witness`, `key` and
 * `complementKey` are one sorted list split at the membership boundary, which
 * is the exact relationship `cutPlan` guarantees for the reservoir's own
 * `key`/`complementKey` pair.
 */
describe('§5.2 — complementKey is one producer, sorted the way the reservoir sorts', () => {
  it('sorts LEXICOGRAPHICALLY, not by unitId — the digit-count case that used to disagree', () => {
    const partAt = (unitId: UnitId): Candidate => ({ unitId, from: 0, to: 5, path: [1] });
    const parts: ReadonlyArray<[UnitId, Candidate]> = [
      [2, partAt(2)],
      [10, partAt(10)],
    ];
    // Lexicographic: '1' < '2', so unit 10's part sorts FIRST.
    expect(planPartsOf(parts)).toBe('10>5:1|2>5:1');
    // The numeric-unitId spelling this file used to produce, and cutPlan never did.
    expect(planPartsOf(parts)).not.toBe('2>5:1|10>5:1');
  });

  it("witness splits into key and complementKey at the membership boundary, for EVERY cluster — the reservoir's own key/complementKey relationship (cutPlan), reproduced here", () => {
    const base = harness();
    const search = makeSearchCore();
    let exercised = 0;
    try {
      for (const unitId of base.sub.commandable(OURS)) {
        for (const candidate of candidatesOf(base, unitId)) {
          const answer = rankConditional({
            ctx: base.ctx,
            search,
            cluster: unitId,
            generation: 0,
            locks: [{ unit: wireIdOf(unitId) as UnitKey, to: candidate.to }],
            reserveMs: LENS_INSPECTION_MS,
          });
          if (!answer.ok || answer.rows.length === 0) continue;
          const row = answer.rows[0]!;
          const memberIds = new Set(
            row.moves.map((m) => base.ctx.sub.unitIdOf(m.unit)).filter((id): id is UnitId => id !== undefined)
          );
          const parts = row.witness.length === 0 ? [] : row.witness.split('|');
          const isMember = (part: string): boolean => memberIds.has(Number(part.slice(0, part.indexOf('>'))));
          // The reservoir's own guarantee (cutPlan): key and complementKey
          // are the member/non-member halves of witness's ALREADY-SORTED
          // list, split in place — never independently re-derived.
          expect(parts.filter(isMember).join('|')).toBe(row.key);
          expect(parts.filter((p) => !isMember(p)).join('|')).toBe(row.complementKey);
          exercised++;
        }
      }
      // The property holds vacuously for zero clusters; make sure the fixture
      // board actually exercised it.
      expect(exercised).toBeGreaterThan(0);
    } finally {
      base.close();
    }
  });

  it('reproduces the exact digit-count case, on a real board: locking unit 2 leaves units 3 and 10 in the complement, unit 10 first', () => {
    // Unit 2 (the corner knight) is its own single-member cluster: its
    // landing squares fall on neither rook's row nor column. Locking it
    // leaves rooks 3 and 10 — clustered with EACH OTHER, not with 2 — as the
    // complement, together, in one plan: exactly the shape where the old
    // by-unitId sort (`3…` then `10…`) and the lexicographic sort (`10…`
    // then `3…`) used to name two different groups for one complement.
    const base = harnessFor(PAIR_PLUS_ISOLATED);
    const search = makeSearchCore();
    let exercised = 0;
    try {
      for (const candidate of candidatesOf(base, 2)) {
        const answer = rankConditional({
          ctx: base.ctx,
          search,
          cluster: 2,
          generation: 0,
          locks: [{ unit: wireIdOf(2) as UnitKey, to: candidate.to }],
          reserveMs: LENS_INSPECTION_MS,
        });
        if (!answer.ok || answer.rows.length === 0) continue;
        const row = answer.rows[0]!;
        expect(row.key).toBe(`2>${candidate.to}:${candidate.path.join('.')}`);
        // Lexicographic: '10' < '3' ('1' < '3'), so unit 10 sorts BEFORE
        // unit 3 — the reverse of numeric order, and the reverse of what
        // this file's complementKey produced before this fix.
        expect(row.complementKey.startsWith('10>')).toBe(true);
        expect(row.complementKey).toMatch(/^10>\d+:[\d.]*\|3>\d+:[\d.]*$/);
        exercised++;
      }
      expect(exercised).toBeGreaterThan(0);
    } finally {
      base.close();
    }
  });
});
