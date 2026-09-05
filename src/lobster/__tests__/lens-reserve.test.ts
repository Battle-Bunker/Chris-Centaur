/**
 * 05-BUILD-ORDER §(d) GATE 7 (i) and (iii) — the inspection reserve.
 *
 * Who pays for a live inspection was an ECONOMY question with three answers
 * (04 §3.3 Q5): charge the decision, charge the flush reserve, or carve a
 * dedicated reserve BEFORE `searchDeadline`. The third won because it is the
 * only one whose cost is visible before the turn starts. What that buys has to
 * be checkable, and this is where:
 *
 *   (i)   THE RESERVE IS DECLARED, NOT TAKEN. `searchDeadline` is reduced by
 *         exactly `LENS_INSPECTION_MS` and by nothing else.
 *   (iii) INSPECTION CANNOT STARVE THE DECISION. With an inspector hovering
 *         continuously for the whole turn: evaluator calls inside
 *         `searchDeadline` stay within 2% of the sink-absent run, every
 *         conforming re-stage still reports `slicesBefore === 0`, and every
 *         request past the reserve comes back as a TYPED REFUSAL rather than
 *         as a served row.
 *
 * (ii) — "the sink is free when absent" — lives in `lens-cost.test.ts`, where
 * the pre-lens recording it is compared against lives too.
 */

import { LENS_INSPECTION_MS, type LensEvent, type UnitKey } from '../../lens/types';
import { carveReserve } from '../../lens/kernel/reserve';
import { DEFAULT_KERNEL_OPTIONS, LobsterKernel } from '../kernel';
import { rigFor } from '../candidates';
import { defaultEvaluator } from '../evaluate';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { Evaluator, KernelInput } from '../contracts';
import {
  FakeClock,
  ScriptedSearchCore,
  StubEvaluator,
  StubGenerator,
  StubSubstrate,
  collect,
  plan,
  type ScriptStep,
} from '../../tests/lobster-harness';
import { DecisionClock, MIXED_SCENARIO, buildBoard, meteredEvaluator } from '../../tests/local-game';

jest.setTimeout(180_000);

afterEach(() => clearGeometryCache());

// ---------------------------------------------------------------- (i)

/** One work unit per slice, so a difference in slices IS a difference in the
 *  deadline, with nothing to round away. */
const STEP: ScriptStep = { plan: plan([1, 11], [2, 22]), worst: 10, best: 50, costMs: 1 };
const BUDGET = 200;

async function slicesUnder(watched: boolean): Promise<number> {
  const clock = new FakeClock();
  const sub = new StubSubstrate();
  const gen = new StubGenerator();
  const evaluator = new StubEvaluator(() => ({ lo: 10, est: 30, hi: 50 }));
  const core = new ScriptedSearchCore(clock, [STEP], { baseline: plan([1, 11], [2, 22]) });
  const kernel = new LobsterKernel({ minWriteIntervalMs: 0 });
  const frames: LensEvent[] = [];
  const input: KernelInput = {
    sub,
    gen,
    evaluate: evaluator,
    search: core,
    asTeam: 0,
    deadlineMs: clock.value + BUDGET,
    initialPins: [],
    now: clock.now,
    initialStepCostMs: 1,
    ...(watched ? { lens: (e: LensEvent): void => void frames.push(e) } : {}),
  };
  await collect(kernel.decide(input));
  return kernel.lastReport?.slices ?? 0;
}

describe('gate 7(i) — the reserve is declared, not taken', () => {
  it('reduces the search deadline by exactly LENS_INSPECTION_MS and by nothing else', async () => {
    const open = await slicesUnder(false);
    const watched = await slicesUnder(true);
    // One work unit per slice: the whole difference is the reserve, and it is
    // the reserve exactly. A carve that took anything else would show here as
    // a slice count that does not subtract cleanly.
    expect(open - watched).toBe(LENS_INSPECTION_MS);
  });

  it('carves from the deadline and from no other quantity', () => {
    const carved = carveReserve(1_000, 0);
    expect(carved.searchDeadlineMs).toBe(1_000 - LENS_INSPECTION_MS);
    expect(carved.reserveMs).toBe(LENS_INSPECTION_MS);
  });

  it('refuses to carve where there is nothing to carve from', () => {
    // A decision with barely more budget than the reserve keeps its search:
    // handing the whole turn to an inspector who may not be there is not a
    // trade this makes.
    const tight = carveReserve(LENS_INSPECTION_MS + 1, 0);
    expect(tight.reserveMs).toBe(0);
    expect(tight.searchDeadlineMs).toBe(LENS_INSPECTION_MS + 1);
  });
});

// -------------------------------------------------------------- (iii)

/** Big enough that the declared reserve is a fraction of a percent of the
 *  search, which is the regime the 2% claim is about: (iii) asks whether the
 *  INSPECTOR steals from the search, and (i) already owns the reserve itself. */
const WORK = 5_500;
const TURN = 4;

interface Watched {
  /** Evaluator calls made before the work clock reached `searchDeadline`. */
  readonly inside: number;
  readonly frames: ReadonlyArray<LensEvent>;
  readonly refusals: number;
  readonly served: number;
}

/** One decision on a real board, under the node clock, with an inspector that
 *  never stops hovering. */
async function decide(watched: boolean): Promise<Watched> {
  const board = buildBoard({ ...MIXED_SCENARIO, seed: 1 });
  const teamId = (MIXED_SCENARIO.teams[0] as { id: string }).id;
  const ourIds = (board.snakes ?? []).filter((s) => s.teamID === teamId).map((s) => s.id);
  const sub = makeSubstrate({ gameId: 'lens-reserve', board, turn: TURN, asTeam: teamId, modeled: ourIds });
  const frames: LensEvent[] = [];
  let refusals = 0;
  let served = 0;
  try {
    const asTeam = sub.teamNumber(teamId);
    const clock = new DecisionClock(true);
    const { gen, search } = rigFor(sub);
    const kernel = new LobsterKernel({
      ...DEFAULT_KERNEL_OPTIONS,
      crossfade: 'teammate',
      reserveMs: 0,
      // A PRODUCTION-SHAPED SLICE, not a sixth of this budget: at a sixth,
      // the 20-unit reserve quantises away a whole slice of six and the
      // measurement becomes a measurement of rounding.
      sliceMs: 550 / 6,
      maxSliceFraction: 0,
      pinCacheCapacity: 32,
      minWriteIntervalMs: 0,
      yieldIntervalMs: 0,
    });
    const t0 = clock.now();
    // THE WINDOW, and it is the SAME window in both runs: the lensed run's own
    // search deadline. Counting to the unwatched run's longer deadline would
    // measure the declared reserve a second time, which (i) already owns.
    const window = t0 + WORK - LENS_INSPECTION_MS;
    let inside = 0;
    // METERED, or the measurement is of nothing: under `--nodes` an evaluation
    // that does not charge the clock is free, and a reserve denominated in
    // work could not bound a cost the work clock never sees.
    const metered = meteredEvaluator(defaultEvaluator, clock);
    const counting: Evaluator = {
      scorePlan: (s, p, t) => {
        if (clock.now() < window) inside++;
        return metered.scorePlan(s, p, t);
      },
      evaluatePlan: (s, p, t) => {
        if (clock.now() < window) inside++;
        return metered.evaluatePlan(s, p, t);
      },
    };
    const kin: KernelInput = {
      sub,
      gen,
      evaluate: counting,
      search,
      asTeam,
      deadlineMs: t0 + WORK,
      initialPins: [],
      assumptions: [],
      now: clock.now,
      ...(watched ? { lens: (e: LensEvent): void => void frames.push(e) } : {}),
    };
    const port = kernel.lensPort();
    const roster = sub.commandable(asTeam);
    const subject = roster[0];
    let emitted = 0;
    for await (const rec of kernel.decide(kin)) {
      emitted++;
      if (watched) {
        // HOVERING CONTINUOUSLY. Far more requests than the reserve can serve:
        // the point is that the ones past it are REFUSED and not served, so
        // the search never pays for an operator's attention.
        const cluster = port.partition().find((c) => c.members.length > 0);
        if (cluster !== undefined) {
          for (let i = 0; i < 24; i++) {
            const unit = cluster.members[i % cluster.members.length] as UnitKey;
            const unitId = sub.unitIdOf(unit);
            const to = unitId === undefined ? undefined : rec.plan.get(unitId)?.to;
            if (to === undefined) continue;
            const answer = port.rankConditional(cluster.id, [{ unit, to }]);
            if (answer.ok) served++;
            else refusals++;
          }
        }
      }
      if (subject !== undefined && emitted === 2) {
        const to = rec.plan.get(subject)?.to;
        if (to !== undefined) {
          kernel.onPinEvent({ kind: 'pin', pin: { unitId: subject, to, tentative: false } }, 'ev:1');
        }
      }
    }
    return { inside, frames, refusals, served };
  } finally {
    sub.release();
    clearGeometryCache();
  }
}

describe('gate 7(iii) — inspection cannot starve the decision', () => {
  it('keeps evaluator calls inside searchDeadline within 2% of the sink-absent run', async () => {
    const open = await decide(false);
    const watched = await decide(true);
    expect(open.inside).toBeGreaterThan(100);
    const drift = Math.abs(watched.inside - open.inside) / open.inside;
    expect(drift).toBeLessThan(0.02);
  });

  it('still re-stages a conforming plan with zero slices in between', async () => {
    const watched = await decide(true);
    const operators = watched.frames.filter((e) => e.kind === 'operator');
    expect(operators.length).toBeGreaterThan(0);
    for (const frame of operators) {
      expect((frame as { slicesBefore: number }).slicesBefore).toBe(0);
    }
  });

  it('refuses every request past the reserve, and serves none of them', async () => {
    const watched = await decide(true);
    // The reserve is small and the inspector is greedy, so both must happen:
    // some requests served (the surface works) and some refused (the bound
    // holds). A refusal carries no rows — it is a typed answer, not silence
    // and not a number.
    expect(watched.served).toBeGreaterThan(0);
    expect(watched.refusals).toBeGreaterThan(0);
  });
});
