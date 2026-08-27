/**
 * THE NO-OP GATE — Stage 1's hard acceptance criterion, as a standing test.
 *
 * Stage 1 introduces the cohort as a basis. With a single-row registry it must
 * change NOTHING a decision decides: the same plans, the same brackets, the
 * same slice counts, the same refusals, the same cache statistics. The one
 * thing it changes is that every number now says which objective it is a
 * number about — and that stamp is the whole stage, so it is the one
 * difference this gate is allowed to see.
 *
 * HOW IT WORKS. `fixtures/cohort-noop-baseline.json` was produced by running
 * the replay below on `arch/s0` — the branch immediately before this one, with
 * no cohort anywhere in it. This test re-runs the identical replay on the
 * current tree and asserts that, with every mention of a cohort removed, the
 * two are equal; and, separately, that the only thing the current tree added
 * is exactly one cohort assumption per emitted record.
 *
 * WHAT IT DRIVES. The real trio — `EngineSubstrate` +
 * `GrammarCandidateGenerator` + `defaultEvaluator` + `makeSearchCore` +
 * `LobsterKernel`, the assembly `TeamDecisionEngine` builds — over the
 * acceptance fixture's REAL MATCH boards (snakes11 seed 116 both swaps, twelve
 * positions, plus the mid11 mixed-slider board), at two budgets. Not stubs:
 * the only thing virtualised is the clock.
 *
 * TWO THINGS THAT HAD TO BE TRUE FOR THIS TO BE A TEST AT ALL:
 *
 *  - `StepClock` advances a fixed tick per read, so slice counts are a
 *    function of the search's own work and never of wall time.
 *  - `yieldIntervalMs: 0`. The event-loop yield is gated on the REAL clock —
 *    deliberately, since what it rations is real starvation — it takes real
 *    time, and each yield then costs two reads of the virtual clock. So the
 *    yield COUNT, a wall-time quantity, leaks into the virtual budget: with it
 *    on, two runs on one branch differed by a slice (147 vs 146, measured) and
 *    no cross-branch comparison would have meant anything. With it off, two
 *    runs on one branch are byte-identical.
 *
 * WHEN THIS FAILS. Either the change under test was not a no-op — read the
 * diff, it names the field — or the baseline is genuinely stale because a
 * later stage changed behaviour ON PURPOSE. Regenerating the baseline is a
 * decision to record in a build report, never a way to make a red test green.
 */

import type { Board } from '../types/battlesnake';
import type { EmitRecord, JointPlan } from '../lobster/contracts';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';
import { defaultEvaluator } from '../lobster/evaluate';
import { DEFAULT_COHORT_ID } from '../lobster/evaluate/calibration';
import { makeSearchCore } from '../lobster/search';
import { LobsterKernel } from '../lobster/kernel';
import fixture from './fixtures/territory-acceptance.json';
import baseline from './fixtures/cohort-noop-baseline.json';

jest.setTimeout(120_000);

interface Sample {
  seed: number;
  swap?: number;
  team: string;
  turn: number;
  board: Board;
}

/** Monotonic, deterministic, never wall clock: each read costs one tick. */
class StepClock {
  private t: number;
  constructor(
    private readonly tick = 0.02,
    start = 1_000
  ) {
    this.t = start;
  }
  readonly now = (): number => {
    const v = this.t;
    this.t += this.tick;
    return v;
  };
  readonly peek = (): number => this.t;
}

const planOf = (p: JointPlan): string =>
  [...p.entries()]
    .map(([u, c]) => `${u}>${c.to}`)
    .sort()
    .join(',');

const recordOf = (rec: EmitRecord): unknown => ({
  plan: planOf(rec.plan),
  est: rec.est,
  lo: rec.lo,
  hi: rec.hi,
  horizon: rec.horizon,
  slack: rec.slack,
  posture: rec.posture,
  epoch: rec.epoch,
  crossfade: rec.crossfade,
  assumptions: rec.assumptions.map((a) => JSON.stringify(a)),
});

/** The EWMA of a virtual clock has a float tail; the search's work does not. */
const round = (x: number): number => Math.round(x * 1e6) / 1e6;

/**
 * JSON cannot spell an infinity, and this corpus is full of them: an unbounded
 * ceiling, a floor at the lattice bottom. `JSON.stringify` writes `null` for
 * all three of `Infinity`, `-Infinity` and `NaN`, which would make a floor
 * that fell to the bottom indistinguishable from a ceiling that rose to the
 * top — and would quietly excuse a real change between them. Named instead, on
 * both sides, so the baseline records WHICH one it was.
 */
function jsonSafe(x: unknown): unknown {
  if (typeof x === 'number' && !Number.isFinite(x)) return `#${String(x)}`;
  if (Array.isArray(x)) return x.map(jsonSafe);
  if (x !== null && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) out[k] = jsonSafe(v);
    return out;
  }
  return x;
}

async function replay(sample: Sample, budgetMs: number): Promise<Record<string, unknown>> {
  const clock = new StepClock();
  const sub = makeSubstrate({ board: sample.board, turn: sample.turn, asTeam: sample.team });
  const kernel = new LobsterKernel({
    sliceMs: 2,
    reserveMs: 1,
    minWriteIntervalMs: 0,
    yieldIntervalMs: 0,
  });
  const emissions: unknown[] = [];
  try {
    for await (const rec of kernel.decide({
      sub,
      gen: new GrammarCandidateGenerator(),
      evaluate: defaultEvaluator,
      search: makeSearchCore(),
      asTeam: sub.teamNumber(sample.team),
      deadlineMs: clock.peek() + budgetMs,
      initialPins: [],
      now: clock.now,
    })) {
      emissions.push(recordOf(rec));
    }
  } finally {
    sub.release();
  }
  const r = kernel.lastReport;
  if (r === null) throw new Error('no report');
  return {
    budgetMs,
    id: `${sample.seed}/${sample.swap ?? '-'}/${sample.turn}/${sample.team}`,
    emissions,
    report: {
      slices: r.slices,
      idleSlices: r.idleSlices,
      improveCalls: r.improveCalls,
      refineCalls: r.refineCalls,
      conformCalls: r.conformCalls,
      evaluateCalls: r.evaluateCalls,
      emits: r.emits,
      probes: r.probes,
      refusals: r.refusals,
      boundViolations: r.boundViolations,
      epochs: r.epochs,
      cache: r.cache,
      postureFlips: r.postureFlips,
      basisHistory: r.basisHistory,
      crossfade: r.crossfade,
      committedUnits: r.committedUnits,
      contexts: r.contexts.map((c) => ({ ...c, stepCostMs: round(c.stepCostMs) })),
      speculative: r.speculative,
      activeContextKey: r.activeContextKey,
      stagedNothing: r.stagedNothing,
      leverOrderBinding: r.leverOrderBinding,
    },
  };
}

/** Every mention of a cohort, removed: the `cohort` field wherever the report
 * grew one, and the cohort assumption wherever a record carries one. */
function stripCohort(x: unknown): unknown {
  if (Array.isArray(x)) {
    return x
      .filter((v) => !(typeof v === 'string' && v.startsWith('{"kind":"cohort"')))
      .map(stripCohort);
  }
  if (x !== null && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (k === 'cohort') continue;
      out[k] = stripCohort(v);
    }
    return out;
  }
  return x;
}

const SAMPLES: Sample[] = [
  ...(fixture.snakes11 as unknown as Sample[]),
  fixture.mid11 as unknown as Sample,
];

describe('Stage 1 is a behavioural no-op with the single-cohort registry', () => {
  let current: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    for (const budgetMs of [40, 120]) {
      for (const s of SAMPLES) {
        current.push(jsonSafe(await replay(s, budgetMs)) as Record<string, unknown>);
        clearGeometryCache();
      }
    }
  });

  afterAll(() => {
    current = [];
  });

  it('replays the same corpus the baseline was taken on', () => {
    expect(current).toHaveLength(baseline.length);
    expect(current.map((r) => r.id)).toEqual(baseline.map((r) => r.id));
    // Non-vacuity: a corpus that emitted nothing would pass every assertion
    // below without proving anything at all.
    const emissions = current.reduce((n, r) => n + (r.emissions as unknown[]).length, 0);
    expect(emissions).toBeGreaterThan(20);
  });

  it('IS BYTE-IDENTICAL to arch/s0 with the cohort stamp removed', () => {
    // The hard acceptance criterion. Plans, brackets, slice counts, refusals,
    // cache statistics, posture flips, basis history, crossfade verdicts,
    // context bookkeeping — everything a decision decided — unchanged.
    expect(stripCohort(current)).toEqual(stripCohort(baseline));
  });

  it('and the ONLY thing it added is one cohort assumption per record', () => {
    // The other half of "byte-identical modulo X": X is exactly what we say it
    // is. Nothing was removed, nothing was reordered out of existence, and no
    // record carries two objectives.
    for (let i = 0; i < current.length; i++) {
      const now = current[i].emissions as Array<{ assumptions: string[] }>;
      const was = baseline[i].emissions as Array<{ assumptions: string[] }>;
      expect(now).toHaveLength(was.length);
      for (let j = 0; j < now.length; j++) {
        const cohorts = now[j].assumptions.filter((a) => a.startsWith('{"kind":"cohort"'));
        expect(cohorts).toHaveLength(1);
        expect(cohorts[0]).toContain(`"id":"${DEFAULT_COHORT_ID}"`);
        expect(now[j].assumptions.filter((a) => !cohorts.includes(a))).toEqual(was[j].assumptions);
      }
    }
  });
});
