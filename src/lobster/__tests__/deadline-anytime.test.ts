/**
 * THE ANYTIME PROPERTY AT THE DEADLINE'S EDGE — `docs/design/DEADLINE.md`.
 *
 * `BUDGET.md` §6 ends on the shape of the production risk: the danger is a
 * deadline that SHRINKS, not one that fails to grow. Everything below is the
 * bottom of that curve, driven rather than argued:
 *
 *   ANSWERED    a decision entered with its deadline already in the past still
 *               puts a legal joint plan on the wire, naming every unit it was
 *               asked about, having resolved no board and run no slice.
 *   SHORTER     the same for a deadline shorter than one slice, which is the
 *               case that actually enters the loop and leaves it immediately.
 *   HONEST      the report says how late the answer was against the deadline
 *               the CALLER gave, not against the clamped one — the clamp used
 *               to hide the whole of a decision's lateness.
 *   AFFORDABLE  the operator's inspection reserve is never carved out of a
 *               window that cannot pay for it.
 *
 * The last two blocks drive the REAL search core on a real board, because the
 * property under test is a property of `conform`'s seed and a stub can only
 * restate the stub.
 */

import { LENS_INSPECTION_MS, type LensEvent } from '../../lens/types';
import { carveReserve } from '../../lens/kernel/reserve';
import { DEFAULT_KERNEL_OPTIONS, LobsterKernel, type KernelReport } from '../kernel';
import { rigFor } from '../candidates';
import { defaultEvaluator } from '../evaluate';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { KernelInput } from '../contracts';
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

// --------------------------------------------------------------- the stub rig

const SEED = plan([1, 11], [2, 22]);
const STEP: ScriptStep = { plan: SEED, worst: 10, best: 50, costMs: 1 };

interface Driven {
  readonly records: number;
  readonly report: KernelReport;
  readonly core: ScriptedSearchCore;
  readonly sub: StubSubstrate;
  readonly units: ReadonlyArray<number>;
}

/**
 * One decision at an arbitrary offset from the deadline. `offsetMs` is what
 * `decide` is given RELATIVE to the clock's present: negative is a deadline
 * that had already passed when the decision started.
 */
async function driveAt(offsetMs: number, over: Partial<KernelInput> = {}): Promise<Driven> {
  const clock = new FakeClock();
  const sub = new StubSubstrate();
  const gen = new StubGenerator();
  const core = new ScriptedSearchCore(clock, [STEP], { baseline: SEED, conformCostMs: 1 });
  const kernel = new LobsterKernel({ minWriteIntervalMs: 0, sliceMs: 25 });
  const out = await collect(
    kernel.decide({
      sub,
      gen,
      evaluate: new StubEvaluator(() => ({ lo: 10, est: 30, hi: 50 })),
      search: core,
      asTeam: 0,
      deadlineMs: clock.value + offsetMs,
      initialPins: [],
      now: clock.now,
      initialStepCostMs: 1,
      ...over,
    })
  );
  const report = kernel.lastReport;
  if (report === null) throw new Error('no report');
  return { records: out.length, report, core, sub, units: [...SEED.keys()] };
}

describe('ANSWERED — a deadline already past on entry still gets an answer', () => {
  it('stages one legal joint plan naming every unit, with no slice and no resolution', async () => {
    const r = await driveAt(-50);
    // The anytime guarantee is rung 0 and rung 0 is unconditional: the loop is
    // never entered (`now() < searchDeadline` is false at t0), so what reaches
    // the wire is `conform(ctx, EMPTY_PLAN)` and nothing else.
    expect(r.records).toBeGreaterThanOrEqual(1);
    expect(r.core.callOrder).toEqual(['conform']);
    expect(r.report.slices).toBe(0);
    expect(r.report.stagedNothing).toBe(false);
    // A kernel that resolves a board has stopped being a kernel, deadline or
    // no deadline.
    expect(r.sub.resolveCalls).toBe(0);
  });

  it('reports the lateness it was handed instead of clamping it away', async () => {
    const r = await driveAt(-50);
    // `budgetMs` is still clamped at zero — the guard and the slice cap are
    // fractions of it and must stay non-negative — but the report no longer
    // pretends the deadline was `t0`.
    expect(r.report.budgetMs).toBe(0);
    expect(r.report.startedLateMs).toBe(50);
    // Overshoot is measured against what the wire asked for: 50 ms already
    // gone plus whatever rung 0 cost. Before this it read `elapsedMs` alone.
    expect(r.report.overshootMs).toBeGreaterThanOrEqual(50 + r.report.elapsedMs);
  });

  it('says nothing about lateness when there was none', async () => {
    const r = await driveAt(200);
    expect(r.report.startedLateMs).toBe(0);
  });
});

describe('SHORTER — a deadline shorter than one slice', () => {
  it('answers, and does not start a slice it cannot finish', async () => {
    // `sliceMs` is 25 and the whole window is 4: the loop may be entered, but
    // the affordability guard has nothing to afford.
    const r = await driveAt(4);
    expect(r.records).toBeGreaterThanOrEqual(1);
    expect(r.report.stagedNothing).toBe(false);
    expect(r.report.overshootMs).toBeLessThanOrEqual(r.report.elapsedMs);
  });

  it('answers at a window of exactly zero', async () => {
    const r = await driveAt(0);
    expect(r.records).toBeGreaterThanOrEqual(1);
    expect(r.report.budgetMs).toBe(0);
    expect(r.report.startedLateMs).toBe(0);
  });
});

describe('AFFORDABLE — the inspection reserve is never taken on credit', () => {
  it('carves nothing from a window that is not more than twice the reserve', () => {
    expect(carveReserve(LENS_INSPECTION_MS * 2, 0).reserveMs).toBe(0);
    expect(carveReserve(LENS_INSPECTION_MS * 2 + 1, 0).reserveMs).toBe(LENS_INSPECTION_MS);
    // A window already spent is the case a shrinking deadline actually
    // produces, and it must not go further into deficit.
    expect(carveReserve(-1, 0)).toEqual({ searchDeadlineMs: -1, reserveMs: 0 });
  });

  it('leaves a watched decision at an expired deadline exactly as long as an unwatched one', async () => {
    const frames: LensEvent[] = [];
    const watched = await driveAt(-50, { lens: (e: LensEvent): void => void frames.push(e) });
    const open = await driveAt(-50);
    // Both answer, and the watched one is not made LATER by an inspector it
    // could not have afforded: `carveReserve` declined, so the two decisions
    // do the same work against the same deadline.
    expect(watched.records).toBeGreaterThanOrEqual(1);
    expect(watched.report.slices).toBe(open.report.slices);
    expect(watched.report.startedLateMs).toBe(open.report.startedLateMs);
  });
});

// ------------------------------------------------------- the real search core

const TURN = 4;

interface RealAnswer {
  readonly staged: ReadonlyMap<string, number>;
  readonly ourIds: ReadonlyArray<string>;
  readonly emitted: number;
  readonly slices: number;
  readonly startedLateMs: number;
}

/**
 * One decision on a real `mixed` board under the node clock, at an arbitrary
 * budget. `budgetNodes` of 0 is the expired deadline (`deadlineMs === t0`) and
 * a negative value is a deadline already behind the decision's own start.
 */
async function decideReal(budgetNodes: number): Promise<RealAnswer> {
  const board = buildBoard({ ...MIXED_SCENARIO, seed: 1 });
  const teamId = (MIXED_SCENARIO.teams[0] as { id: string }).id;
  const ourIds = (board.snakes ?? [])
    .filter((s) => s.teamID === teamId && s.health > 0)
    .map((s) => s.id);
  const sub = makeSubstrate({
    gameId: 'deadline-anytime',
    board,
    turn: TURN,
    asTeam: teamId,
    modeled: ourIds,
  });
  try {
    const asTeam = sub.teamNumber(teamId);
    const clock = new DecisionClock(true);
    const { gen, search } = rigFor(sub);
    const kernel = new LobsterKernel({
      ...DEFAULT_KERNEL_OPTIONS,
      crossfade: 'teammate',
      reserveMs: 0,
      sliceMs: 550 / 6,
      minWriteIntervalMs: 0,
      yieldIntervalMs: 0,
    });
    const staged = new Map<string, number>();
    let emitted = 0;
    for await (const rec of kernel.decide({
      sub,
      gen,
      evaluate: meteredEvaluator(defaultEvaluator, clock),
      search,
      asTeam,
      deadlineMs: clock.now() + budgetNodes,
      initialPins: [],
      assumptions: [],
      now: clock.now,
    })) {
      emitted++;
      staged.clear();
      for (const [unitId, cand] of rec.plan) {
        const unit = sub.unitOf(unitId);
        if (unit !== undefined) staged.set(unit.wireId, cand.to);
      }
    }
    return {
      staged,
      ourIds,
      emitted,
      slices: kernel.lastReport?.slices ?? 0,
      startedLateMs: kernel.lastReport?.startedLateMs ?? 0,
    };
  } finally {
    sub.release();
  }
}

describe('the real core answers at every cutoff', () => {
  it('names every one of our live units at a budget of zero, and at one below zero', async () => {
    for (const budget of [0, -50]) {
      const r = await decideReal(budget);
      expect(r.emitted).toBeGreaterThanOrEqual(1);
      // THE WHOLE ROSTER, NOT MOST OF IT. `conform(ctx, EMPTY_PLAN)` returns
      // the candidate layer's ordered-first option for every unit, and the
      // ordered-first option is never a rule-certain self-kill (the staging
      // safety layer's ORDERED claim). A cutoff cannot take either away.
      expect([...r.staged.keys()].sort()).toEqual([...r.ourIds].sort());
      expect(r.slices).toBe(0);
    }
  });

  it('names every unit at a budget shorter than one slice, and at half the shipped one', async () => {
    for (const budget of [1, 16, 275]) {
      const r = await decideReal(budget);
      expect(r.emitted).toBeGreaterThanOrEqual(1);
      expect([...r.staged.keys()].sort()).toEqual([...r.ourIds].sort());
    }
  });

  it('runs no refinement slice it was not given the budget for', async () => {
    // The loop's condition is `now() < searchDeadline`, so the budget is the
    // slice count's only gate. An expired window buys NONE — the loop is never
    // entered and the answer is rung 0's seed — and the count is non-decreasing
    // in the budget above it. (This rig sets a production-shaped `sliceMs` of
    // 550/6 rather than a sixth of each arm's own budget, so the counts here
    // are small: what is asserted is the ordering, not a magnitude.)
    const expired = (await decideReal(0)).slices;
    const short = (await decideReal(16)).slices;
    const half = (await decideReal(275)).slices;
    expect(expired).toBe(0);
    expect(short).toBeGreaterThanOrEqual(expired);
    expect(half).toBeGreaterThan(expired);
    expect(half).toBeGreaterThanOrEqual(short);
  });
});
