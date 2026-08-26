/**
 * S0a — THE PER-FEATURE INVOKED GATE.
 *
 * Before this gate the only way to make an evaluator cheap was
 * `reachHorizonTurns: 0`, a SHARED knob that killed reach, room and kingMargin
 * together and could not express per-feature choice. Zeroing a weight bought
 * nothing at all: `fold` called `evaluateFeature` for every feature regardless
 * and only skipped the addition, so a "material-only" profile at a live horizon
 * still paid for the shells and the two-plane partition.
 *
 * Three things are checked here, and the third is the one that matters:
 *
 *   IDENTITY   an invoked-gated material profile at the FULL horizon reproduces
 *              today's `MATERIAL_ONLY_PROFILE` (horizon 0) bit for bit, on the
 *              acceptance boards. The gate is a compute change, not a scoring
 *              change.
 *   HONESTY    an un-invoked feature writes no `parts` entry. Absence says "not
 *              computed"; a zero would say "computed, and it was zero".
 *   COST       the gated evaluation never calls `shells()` or `partition()`,
 *              and the fold is measurably cheaper than the weights-only form.
 *              `features.ts` memoises both per context, so "never called" is
 *              the whole of the saving and is directly observable.
 */

import type { Board } from '../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import type { EngineSubstrate } from '../lobster/substrate';
import {
  ALL_FEATURES,
  ALL_FEATURE_KEYS,
  BoundEvaluator,
  FEATURES,
  MATERIAL_ONLY_PROFILE,
  REACH_HORIZON_TURNS,
  assertProfileCoherent,
  defaultEvaluator,
  fold,
  makeContext,
  materialEvaluator,
} from '../lobster/evaluate';
import type { CriterionProfile, EvalContext, Evaluation } from '../lobster/evaluate';
import type { Candidate, JointPlan, UnitId } from '../lobster/contracts';
import fixture from './fixtures/territory-acceptance.json';

interface Sample {
  seed: number;
  swap: number;
  team: string;
  turn: number;
  board: Board;
}

const SNAKES11 = fixture.snakes11 as unknown as Sample[];
const MID11 = fixture.mid11 as unknown as Sample;

/** The acceptance boards `territory-acceptance.test.ts` reads, plus the mixed
 * slider board — the two shapes whose feature costs differ most. */
const SAMPLES: Sample[] = [...SNAKES11.slice(0, 4), MID11];

/** Same deterministic plan enumeration the acceptance test uses. */
function ourPlans(sub: EngineSubstrate, asTeam: number, cap: number): JointPlan[] {
  let plans: Array<Map<UnitId, Candidate>> = [new Map()];
  for (const u of sub.roster()) {
    if (u.team !== asTeam) continue;
    const next: Array<Map<UnitId, Candidate>> = [];
    for (const p of plans) {
      for (const a of sub.enumerate(u.unitId)) {
        if (next.length >= cap) break;
        const m = new Map(p);
        m.set(u.unitId, {
          unitId: u.unitId,
          from: -1,
          to: a.dest,
          path: a.action.kind === 'move' ? [...a.action.path] : [],
        });
        next.push(m);
      }
      if (next.length >= cap) break;
    }
    plans = next;
  }
  return plans;
}

function substrateFor(sample: Sample): { sub: EngineSubstrate; asTeam: number } {
  const ourIds = (sample.board.snakes ?? [])
    .filter((s) => (s.teamID ?? s.id) === sample.team && s.health > 0 && s.body.length > 0)
    .map((s) => s.id);
  const sub = makeSubstrate({
    board: sample.board,
    turn: sample.turn,
    asTeam: sample.team,
    modeled: ourIds,
  });
  return { sub, asTeam: sub.teamNumber(sample.team) };
}

afterEach(() => clearGeometryCache());

// --------------------------------------------------------------- the profiles

/**
 * The gate expressed WITHOUT the old workaround: a full live horizon, and the
 * territory features simply not invoked. If this profile disagrees with
 * `MATERIAL_ONLY_PROFILE` by one ulp, the gate changed the objective.
 */
const GATED_MATERIAL: CriterionProfile = assertProfileCoherent({
  name: 'material-only-invoked',
  weights: MATERIAL_ONLY_PROFILE.weights,
  invoked: new Set(['material', 'healthEconomy']),
  reachHorizonTurns: REACH_HORIZON_TURNS,
});

/**
 * The pre-S0a way to ask for a cheap evaluator at a live horizon: zero the
 * weights and invoke everything anyway. Identical numbers, and it pays for the
 * shells, the partition and the whole two-plane sweep. This is the "before" the
 * bench measures against.
 */
const WEIGHTS_ONLY_MATERIAL: CriterionProfile = assertProfileCoherent({
  name: 'material-only-by-weights',
  weights: MATERIAL_ONLY_PROFILE.weights,
  invoked: ALL_FEATURES,
  reachHorizonTurns: REACH_HORIZON_TURNS,
});

const gatedEvaluator = new BoundEvaluator(GATED_MATERIAL);
const weightsOnlyEvaluator = new BoundEvaluator(WEIGHTS_ONLY_MATERIAL);

// --------------------------------------------------------------- the registry

describe('the feature registry is one list, in one place', () => {
  test('ALL_FEATURE_KEYS is exactly FEATURES, in fold order', () => {
    expect(ALL_FEATURE_KEYS).toEqual(FEATURES.map((f) => f.key));
  });

  test('the shipped profiles invoke what they weight', () => {
    expect([...MATERIAL_ONLY_PROFILE.invoked].sort()).toEqual(['healthEconomy', 'material']);
    expect([...defaultEvaluator.profile.invoked].sort()).toEqual([...ALL_FEATURE_KEYS].sort());
  });

  test('a profile that weights a key it never computes is refused', () => {
    expect(() =>
      assertProfileCoherent({
        name: 'incoherent',
        weights: { material: 10, reach: 1 },
        invoked: new Set(['material']),
        reachHorizonTurns: REACH_HORIZON_TURNS,
      })
    ).toThrow(/does not invoke it/);
  });
});

// --------------------------------------------------------------- bit identity

describe('the invoked gate does not move a number', () => {
  test('gated material at a live horizon === MATERIAL_ONLY_PROFILE, bit for bit', () => {
    let compared = 0;
    for (const sample of SAMPLES) {
      const { sub, asTeam } = substrateFor(sample);
      try {
        for (const plan of ourPlans(sub, asTeam, 24)) {
          const old = materialEvaluator.evaluatePlan(sub, plan, asTeam);
          const gated = gatedEvaluator.evaluatePlan(sub, plan, asTeam);
          // Object.is, not toBeCloseTo: this is an identity claim.
          expect(Object.is(gated.bound.lo, old.bound.lo)).toBe(true);
          expect(Object.is(gated.bound.est, old.bound.est)).toBe(true);
          expect(Object.is(gated.bound.hi, old.bound.hi)).toBe(true);
          expect(gated.exact).toBe(old.exact);
          expect(gated.ledgerSize).toBe(old.ledgerSize);
          expect(gated.terminal).toEqual(old.terminal);
          compared++;
        }
      } finally {
        sub.release();
      }
    }
    expect(compared).toBeGreaterThan(40);
  });

  test('the weights-only form agrees too — the gate is the only difference', () => {
    for (const sample of SAMPLES) {
      const { sub, asTeam } = substrateFor(sample);
      try {
        for (const plan of ourPlans(sub, asTeam, 8)) {
          const slow = weightsOnlyEvaluator.evaluatePlan(sub, plan, asTeam);
          const fast = gatedEvaluator.evaluatePlan(sub, plan, asTeam);
          expect(Object.is(fast.bound.lo, slow.bound.lo)).toBe(true);
          expect(Object.is(fast.bound.est, slow.bound.est)).toBe(true);
          expect(Object.is(fast.bound.hi, slow.bound.hi)).toBe(true);
        }
      } finally {
        sub.release();
      }
    }
  });

  test('the default profile is untouched: every part still reported', () => {
    const { sub, asTeam } = substrateFor(SAMPLES[0] as Sample);
    try {
      const plan = ourPlans(sub, asTeam, 1)[0] as JointPlan;
      const full = defaultEvaluator.evaluatePlan(sub, plan, asTeam);
      expect(Object.keys(full.parts).sort()).toEqual([...ALL_FEATURE_KEYS].sort());
    } finally {
      sub.release();
    }
  });

  test('an un-invoked feature writes no parts entry — absence, not a zero', () => {
    const { sub, asTeam } = substrateFor(SAMPLES[0] as Sample);
    try {
      const plan = ourPlans(sub, asTeam, 1)[0] as JointPlan;
      const gated = gatedEvaluator.evaluatePlan(sub, plan, asTeam);
      expect(Object.keys(gated.parts).sort()).toEqual(['healthEconomy', 'material']);
      expect(gated.parts['reach']).toBeUndefined();
      expect(gated.parts['room']).toBeUndefined();
      expect(gated.parts['kingMargin']).toBeUndefined();
    } finally {
      sub.release();
    }
  });
});

// ------------------------------------------------------- the compute is skipped

/**
 * A context that counts the expensive doors a FEATURE knocks on. All three are
 * memoised inside `makeContext`, so a call count of zero is the entire claim:
 * the shells are never built, the partition never swept, and no amount of
 * caching is doing the work quietly somewhere else.
 *
 * `shells` counts only DIRECT calls from a feature. `partition()` reaches the
 * shells through the real context's own closure, which this wrapper is not in
 * the path of — so the control below asserts on `partition`, the door
 * `reach`/`room` actually use, and `shells` is the door `kingMargin` uses
 * (and only on a board that has a king of ours at all).
 */
function counting(base: EvalContext): {
  ctx: EvalContext;
  counts: { shells: number; partition: number; arrivals: number };
} {
  const counts = { shells: 0, partition: 0, arrivals: 0 };
  const ctx: EvalContext = {
    ...base,
    shells() {
      counts.shells++;
      return base.shells();
    },
    partition(reading) {
      counts.partition++;
      return base.partition(reading);
    },
    arrivals() {
      counts.arrivals++;
      return base.arrivals();
    },
  };
  return { ctx, counts };
}

describe('a gated evaluation never pays the shells/partition cost', () => {
  test('shells() and partition() are called zero times under the gate', () => {
    const { sub, asTeam } = substrateFor(SAMPLES[0] as Sample);
    try {
      const plan = ourPlans(sub, asTeam, 1)[0] as JointPlan;
      sub.withResolution(plan, asTeam, ({ resolution, bounds }) => {
        const base = makeContext(sub, resolution, bounds, asTeam, REACH_HORIZON_TURNS);
        const gated = counting(base);
        const gatedEval: Evaluation = fold(
          FEATURES,
          gated.ctx,
          GATED_MATERIAL.weights,
          GATED_MATERIAL.invoked
        );
        expect(gated.counts).toEqual({ shells: 0, partition: 0, arrivals: 0 });

        // And the control: the same weights without the gate DOES pay.
        const loose = counting(
          makeContext(sub, resolution, bounds, asTeam, REACH_HORIZON_TURNS)
        );
        const looseEval: Evaluation = fold(
          FEATURES,
          loose.ctx,
          WEIGHTS_ONLY_MATERIAL.weights,
          WEIGHTS_ONLY_MATERIAL.invoked
        );
        expect(loose.counts.partition).toBeGreaterThan(0);

        // Same total, either way.
        expect(Object.is(gatedEval.total.lo, looseEval.total.lo)).toBe(true);
        expect(Object.is(gatedEval.total.hi, looseEval.total.hi)).toBe(true);
        return null;
      });
    } finally {
      sub.release();
    }
  });
});

// ----------------------------------------------------------------- the bench

/**
 * Micro-bench, min-of-repeats. It is a MEASUREMENT with a loose floor under it,
 * not a performance gate: the box is shared, so the assertion is only that the
 * gate saves the bulk of the feature cost, and the printed numbers are what the
 * report quotes.
 *
 * The FOLD is timed rather than `evaluatePlan`, on purpose. Resolutions are
 * memo-cached evaluator-independently (`bounds/memo.ts`), so what a cheap
 * profile actually saves per evaluation is exactly the fold — the engine cost
 * is paid once whatever the profile.
 */
interface BenchJob {
  readonly sub: EngineSubstrate;
  readonly plan: JointPlan;
  readonly asTeam: number;
}

/**
 * One pass over every job under one profile, returning µs per evaluation. The
 * ENGINE RESOLVE IS OUTSIDE THE CLOCK: it is ~50 µs and identical under every
 * profile, so leaving it in would swamp the very quantity being measured — and
 * it is also the cost a cohort escalation genuinely does not re-pay, since
 * resolutions are memo-cached evaluator-independently (`bounds/memo.ts`).
 */
function foldPass(jobs: ReadonlyArray<BenchJob>, profile: CriterionProfile): number {
  let nanos = 0n;
  for (const job of jobs) {
    const out = job.sub.resolveBoundedFull(job.plan, job.asTeam);
    try {
      const t0 = process.hrtime.bigint();
      // A FRESH context every time: the per-context memo is what makes "shells()
      // was never called" the whole of the saving, so reusing one context would
      // measure the memo instead of the gate.
      const ctx = makeContext(
        job.sub,
        out.resolution,
        out.bounds,
        job.asTeam,
        profile.reachHorizonTurns
      );
      fold(FEATURES, ctx, profile.weights, profile.invoked);
      nanos += process.hrtime.bigint() - t0;
    } finally {
      job.sub.releaseResolution(out.resolution);
    }
  }
  return Number(nanos) / 1000 / jobs.length;
}

describe('BENCH — the gate buys milliseconds, not just a smaller sum', () => {
  test('material+healthEconomy folds well under the all-invoked cost', () => {
    const subs: EngineSubstrate[] = [];
    const jobs: BenchJob[] = [];
    for (const sample of SAMPLES) {
      const { sub, asTeam } = substrateFor(sample);
      subs.push(sub);
      for (const plan of ourPlans(sub, asTeam, 8)) jobs.push({ sub, plan, asTeam });
    }
    try {
      const profiles: ReadonlyArray<readonly [string, CriterionProfile]> = [
        ['gated (material+health, live horizon)', GATED_MATERIAL],
        ['weights-only (all invoked)', WEIGHTS_ONLY_MATERIAL],
        ['territory (all invoked)', defaultEvaluator.profile],
        ['legacy MATERIAL_ONLY (horizon 0)', MATERIAL_ONLY_PROFILE],
      ];
      const best = new Map<string, number>();
      // Round-robin, min-of-reps: the box is shared, so interleaving is what
      // stops one profile wearing another's drift.
      for (const [, p] of profiles) foldPass(jobs, p); // warm
      for (let r = 0; r < 7; r++) {
        for (const [name, p] of profiles) {
          const us = foldPass(jobs, p);
          best.set(name, Math.min(best.get(name) ?? Number.POSITIVE_INFINITY, us));
        }
      }

      const gated = best.get(profiles[0]![0]) as number;
      const weightsOnly = best.get(profiles[1]![0]) as number;
      const legacy = best.get(profiles[3]![0]) as number;
      console.log(
        `[S0a bench] fold µs/eval over ${jobs.length} plans, min of 7 — ` +
          profiles.map(([n]) => `${n}: ${(best.get(n) as number).toFixed(2)}`).join(' | ') +
          ` || gate saves ${(100 * (1 - gated / weightsOnly)).toFixed(1)}% of the fold`
      );

      // The gate must recover the bulk of the cost, not a sliver of it.
      expect(gated).toBeLessThan(weightsOnly * 0.6);
      // And it must be no worse than the accidental workaround it replaces.
      expect(gated).toBeLessThan(legacy * 2);
    } finally {
      for (const sub of subs) sub.release();
    }
  });
});
