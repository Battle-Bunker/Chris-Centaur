/**
 * THE FLAG-OFF NO-OP GATE — Stage 2's hard acceptance criterion.
 *
 * Stage 1's gate asserted identity with the stage before it MODULO the cohort
 * stamp, because the stamp was that stage's entire content. This gate is
 * stricter and asserts identity with NOTHING stripped: with the cohort policy
 * off, Stage 2 must change nothing at all — not a plan, not a bracket, not a
 * slice count, not a refusal, not a cache statistic, and not the cohort id on
 * a single record. A stage that ships default-off owes exactly this, and the
 * `stripCohort` escape hatch the previous gate needed would hide the one thing
 * most likely to go wrong here (the registry gaining a row and something
 * quietly selecting it).
 *
 * HOW IT WORKS. `fixtures/admission-noop-baseline.json` was produced by running
 * the replay below on `arch/s1` — the branch immediately before this one, with
 * a one-row registry and no admission governor anywhere in it. This test
 * re-runs the identical replay on the current tree and asserts deep equality.
 *
 * WHAT IT DRIVES. The same corpus and the same real trio Stage 1's gate used:
 * `EngineSubstrate` + `GrammarCandidateGenerator` + `defaultEvaluator` +
 * `makeSearchCore` + `LobsterKernel` over the acceptance fixture's real match
 * boards, at two budgets. Twenty-six decisions. Not stubs: the only thing
 * virtualised is the clock.
 *
 * `yieldIntervalMs: 0`, for the reason the Stage 1 gate documents at length:
 * the event-loop yield is gated on the REAL clock and each yield costs two
 * reads of the VIRTUAL one, so the yield count — a wall-time quantity — leaks
 * into the virtual budget and two runs on one branch can differ by a slice.
 *
 * WHEN THIS FAILS. Either the flag-off path is not a no-op — read the diff, it
 * names the field — or the baseline is genuinely stale because a later stage
 * changed flag-off behaviour ON PURPOSE. Regenerating it is a decision to
 * record in a build report, never a way to make a red test green.
 */

import type { Board } from '../types/battlesnake';
import type { EmitRecord, JointPlan } from '../lobster/contracts';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';
import { defaultEvaluator } from '../lobster/evaluate';
import { DEFAULT_COHORT_ID } from '../lobster/evaluate/calibration';
import { makeSearchCore } from '../lobster/search';
import { DEFAULT_KERNEL_OPTIONS, LobsterKernel } from '../lobster/kernel';
import fixture from './fixtures/territory-acceptance.json';
import baseline from './fixtures/admission-noop-baseline.json';

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
  // The Stage 2 addition, captured so its ABSENCE is what the gate asserts.
  // Capturing it is what makes the gate sensitive to the change it is guarding
  // against: without this key a stamped record and an unstamped one would
  // compare equal.
  admission: rec.admission ?? null,
});

/** The EWMA of a virtual clock has a float tail; the search's work does not. */
const round = (x: number): number => Math.round(x * 1e6) / 1e6;

/**
 * JSON cannot spell an infinity, and this corpus is full of them. `Infinity`,
 * `-Infinity` and `NaN` all stringify to `null`, which would make a floor that
 * fell to the bottom indistinguishable from a ceiling that rose to the top.
 * Named instead, on both sides.
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
  // NO `admission` option and NO `evaluators`: the shipped default, which is
  // the configuration this gate is about.
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
      admission: r.admission,
      admissionState: r.admissionState,
    },
  };
}

const SAMPLES: Sample[] = [
  ...(fixture.snakes11 as unknown as Sample[]),
  fixture.mid11 as unknown as Sample,
];

describe('Stage 2 is a behavioural no-op with the cohort policy off', () => {
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

  test('replays the same corpus the baseline was taken on', () => {
    expect(current).toHaveLength(baseline.length);
    expect(current.map((r) => r.id)).toEqual(baseline.map((r) => r.id));
    // Non-vacuity: a corpus that emitted nothing would pass every assertion
    // below without proving anything at all.
    const emissions = current.reduce((n, r) => n + (r.emissions as unknown[]).length, 0);
    expect(emissions).toBeGreaterThan(20);
    expect(current.length).toBe(26);
  });

  test('IS IDENTICAL to arch/s1 — nothing stripped, the cohort id included', () => {
    // The hard acceptance criterion, and deliberately stricter than the stage
    // before it: no strip function, no modulo, no named exception.
    expect(current).toEqual(baseline);
  });

  test('and the reason it is identical is that the POLICY is off, not the table', () => {
    // Two facts that could each independently make the gate green, separated
    // so a future change cannot silently swap one for the other. The registry
    // has grown a second row; nothing selected it, because nothing but the
    // policy selects, and the policy is null.
    expect(DEFAULT_KERNEL_OPTIONS.admission).toBeNull();
    for (const run of current) {
      expect((run.report as { admission: unknown }).admission).toBeNull();
      for (const rec of run.emissions as Array<{ admission: unknown; assumptions: string[] }>) {
        expect(rec.admission).toBeNull();
        const cohorts = rec.assumptions.filter((a) => a.startsWith('{"kind":"cohort"'));
        expect(cohorts).toHaveLength(1);
        expect(cohorts[0]).toContain(`"id":"${DEFAULT_COHORT_ID}"`);
      }
    }
  });
});
